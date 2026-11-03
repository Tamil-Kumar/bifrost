// YouTube's ads, against a local stand-in for YouTube (www.youtube.com and the rest pointed at it with
// --host-resolver-rules, over HTTPS with a certificate made for this run; tests/fixtures/yt):
//  · a video ad is covered and muted from the moment it starts and skipped, whatever kind it is (a stream of
//    its own, stitched into the video's stream, one the player can't tell), and the video comes back with its
//    sound and speed; one whose stream turns out to be the video's own isn't run to its end;
//  · the ads in YouTube's pages are hidden and nothing else is;
//  · Shorts: the reels marked as ads are taken out of what YouTube fetches and parses; an ad reel that's in the
//    page anyway is hidden, silenced and passed;
//  · a YouTube player embedded in another site gets the same; other sites are left alone;
//  · with element hiding off the pages' ads stay, and with the setting off YouTube is left as it is.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { launch, startSite, reporter, assert, sleep, ROOT } from './lib.mjs';

const R = reporter('youtube');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'yt');
const HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'];

const tls = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-yt-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'key.pem'), '-out', path.join(tls, 'cert.pem'), '-days', '2', '-subj', '/CN=www.youtube.com', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });

// The reels YouTube fetches for Shorts: one of them an ad.
const reel = (id, ad) => ({ command: { reelWatchEndpoint: Object.assign({ videoId: id }, ad ? { adClientParams: { isAd: true, adSlotId: 'slot-1' } } : {}) } });
const SEQUENCE = { entries: [reel('r1'), reel('r-ad', true), reel('r2')], continuationEndpoint: { token: 'next' } };
const yt = https.createServer({ key: fs.readFileSync(path.join(tls, 'key.pem')), cert: fs.readFileSync(path.join(tls, 'cert.pem')) }, (req, res) => {
  const u = new URL(req.url, 'https://x');
  const json = (obj, pre = '') => { res.writeHead(200, { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' }); res.end(pre + JSON.stringify(obj)); };
  if (u.pathname === '/youtubei/v1/reel/reel_watch_sequence') {
    if (u.searchParams.get('nested')) return json({ reelWatchSequenceResponse: SEQUENCE });
    return json(SEQUENCE, u.searchParams.get('xssi') ? ")]}'\n" : '');
  }
  if (u.pathname === '/youtubei/v1/next') return json(SEQUENCE);
  const page = u.pathname === '/watch' || u.pathname.startsWith('/embed/') ? 'watch.html'
    : u.pathname.startsWith('/shorts/') ? 'shorts.html'
      : u.pathname === '/' || u.pathname === '/results' ? 'feed.html' : null;
  if (!page) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(FIX, page)));
});
await new Promise((r) => yt.listen(0, '127.0.0.1', r));
const port = yt.address().port;

const site = await startSite(path.join(ROOT, 'tests', 'site'), { routes: {
  '/embedder.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Embedder</title><h1>A page with a YouTube video</h1><iframe width="700" height="420" src="https://www.youtube-nocookie.com/embed/abc?mode=stream&skip=0"></iframe>'); },
  '/plain.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Plain</title><p>Not YouTube</p>'); },
} });

const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({
  profile: 'youtube',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`, '--ignore-certificate-errors'],
  // (a player that says "ad" for 8 seconds is taken as stuck saying it, instead of 2 minutes)
  env: Object.assign({ BIFROST_YT_STUCK_MS: '8000' }, NO_PROXY),
  settings: { onboarding: { done: true } },
});
const open = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 400) + ')' : ''));
};
const setSetting = (p, v) => t.ui(([p, v]) => window.wb.invoke('settings:set', p, v), [p, v]);
// The player as the page sees it: its cover, its video's look, sound and speed.
const PLAYER = `(() => { const p = document.getElementById('movie_player'), v = document.getElementById('v');
  return { ad: p.classList.contains('ad-showing'), cover: getComputedStyle(p, '::after').content, opacity: getComputedStyle(v).opacity, muted: v.muted, rate: v.playbackRate, at: v.currentTime }; })()`;
const covered = (s) => /Skipping an ad/.test(s.cover) && s.opacity === '0' && s.muted;
const back = (s) => s.cover === 'none' && s.opacity === '1' && !s.muted && s.rate === 1;
// What the page saw while its ad was on, and how it ended.
const adRan = async (match, n = 1) => {
  const log = await until(() => t.guest(match, 'window.__log').then((l) => l.filter((e) => e.ended).length >= n && l), 10000, 'the ad to end');
  const seen = log.filter((e) => e.why);
  return { log, seen: seen[seen.length - 1], ended: log.filter((e) => e.ended).map((e) => e.ended) };
};
const display = (match, ids) => t.guest(match, `(${JSON.stringify(ids)}).map((id) => { const e = document.getElementById(id); return id + ':' + (e ? getComputedStyle(e).display : 'missing'); })`);

try {
  await R.step('the ad blocker is ready', async () => {
    await until(() => t.main(() => !!(global.__bifrost.adblock && global.__bifrost.adblock.engine)), 90000, 'the ad blocker’s lists');
  });

  await R.step('a video ad is covered and silent from the moment it starts, and run to its end (a stream of its own)', async () => {
    await open('https://www.youtube.com/watch?v=a1&mode=stream&skip=0');
    const { seen, ended } = await adRan('v=a1&');
    assert(seen && seen.why === 'ran to its end', 'not run to its end: ' + JSON.stringify(seen) + ' ended: ' + ended);
    assert(covered(seen), 'while it was on, the ad showed: ' + JSON.stringify(seen));
    const now = await until(() => t.guest('v=a1&', PLAYER).then((s) => back(s) && s), 3000, 'the video with its sound');
    assert(!now.ad, 'still an ad');
  });

  await R.step('…and the next one, in the middle of the video', async () => {
    await t.guest('v=a1&', 'startAd(), 1');
    const { seen, ended } = await adRan('v=a1&', 2);
    assert(ended.length === 2 && covered(seen), JSON.stringify({ seen, ended }));
    await until(() => t.guest('v=a1&', PLAYER).then(back), 3000, 'the video with its sound');
  });

  await R.step('one stitched into the video’s stream is passed with the player’s own seek, covered and silent', async () => {
    await open('https://www.youtube.com/watch?v=b2&mode=ssap&skip=0');
    const { seen, ended } = await adRan('v=b2&');
    assert(seen && seen.why === 'seekTo' && ended[0] === 'seekTo', JSON.stringify({ seen, ended }));
    assert(covered(seen), 'while it was on, the ad showed: ' + JSON.stringify(seen));
    await until(() => t.guest('v=b2&', PLAYER).then(back), 3000, 'the video with its sound');
  });

  await R.step('one the player can’t tell about: Skip is pressed, covered and silent', async () => {
    await open('https://www.youtube.com/watch?v=c3&mode=unknown');
    const { seen, ended } = await adRan('v=c3&');
    assert(seen && seen.why === 'skip' && ended[0] === 'skip', JSON.stringify({ seen, ended }));
    assert(covered(seen), 'while it was on, the ad showed: ' + JSON.stringify(seen));
    await until(() => t.guest('v=c3&', PLAYER).then(back), 3000, 'the video with its sound');
  });

  await R.step('an ad whose stream is the video’s own isn’t run to its end (that would skip the video), but stays covered', async () => {
    await open('https://www.youtube.com/watch?v=d4&mode=stitched&skip=0');
    await until(() => t.guest('v=d4&', 'document.getElementById("v").duration > 0'), 5000, 'the stream');
    await sleep(1500);
    const s = await t.guest('v=d4&', PLAYER);
    assert(s.ad && s.at < 1, 'run to its end: ' + JSON.stringify(s));
    assert(covered(s) && s.rate === 16, 'not covered, silent and sped up: ' + JSON.stringify(s));
    await t.shot('youtube-ad-covered');
    await t.guest('v=d4&', 'endAd("test"), 1');
    await until(() => t.guest('v=d4&', PLAYER).then(back), 3000, 'the video with its sound');
  });

  await R.step('a player stuck saying it’s showing an ad is left alone after a while: you see and hear what it plays', async () => {
    // (the last step's player, uncovered, is this one again)
    await t.guest('v=d4&', 'startAd(), 1');
    const s0 = await until(() => t.guest('v=d4&', PLAYER).then((s) => covered(s) && s), 3000, 'the cover');
    const s = await until(() => t.guest('v=d4&', PLAYER).then((s) => s.ad && back(s) && s), 15000, 'the player to be left alone');
    assert(await t.guest('v=d4&', 'document.getElementById("movie_player").hasAttribute("data-bifrost-ad-stuck")'), 'not marked: ' + JSON.stringify({ s0, s }));
    await t.guest('v=d4&', 'endAd("test"), 1');
    await until(() => t.guest('v=d4&', '!document.getElementById("movie_player").hasAttribute("data-bifrost-ad-stuck")'), 3000, 'the mark to go');
    // …and the next ad is covered again.
    await t.guest('v=d4&', 'startAd(), 1');
    await until(() => t.guest('v=d4&', PLAYER).then(covered), 3000, 'the next ad’s cover');
    await t.guest('v=d4&', 'endAd("test"), 1');
    await until(() => t.guest('v=d4&', PLAYER).then(back), 3000, 'the video with its sound');
  });

  await R.step('the ads in YouTube’s pages are hidden (feed, masthead, search, next to the video), and nothing else', async () => {
    await open('https://www.youtube.com/?feed=1');
    await until(() => t.guest('?feed=1', 'document.readyState === "complete"'), 5000, 'the page');
    const ads = await display('?feed=1', ['masthead-ad', 'ad-banner-promo', 'ad-tile', 'ad-search', 'ad-search-slot', 'ad-panel', 'ad-related', 'ad-merch']);
    assert(ads.every((x) => x.endsWith(':none')), 'shown: ' + ads.filter((x) => !x.endsWith(':none')).join(', '));
    const ok = await display('?feed=1', ['ok-1', 'ok-2', 'ok-3', 'ok-result', 'ok-panel', 'ok-related']);
    assert(ok.every((x) => !x.endsWith(':none') && !x.endsWith(':missing')), 'hidden: ' + ok.filter((x) => x.endsWith(':none')).join(', '));
    // The box for companion ads next to the video: out of sight, not taken out.
    const box = await t.guest('?feed=1', '(() => { const e = document.getElementById("player-ads"), s = getComputedStyle(e); return { display: s.display, visibility: s.visibility, h: e.getBoundingClientRect().height }; })()');
    assert(box.display !== 'none' && box.visibility === 'hidden' && box.h <= 1, JSON.stringify(box));
    // No gap where the ad was: the next video takes its place.
    const x = await t.guest('?feed=1', '[1, 2].map((n) => Math.round(document.getElementById("ok-" + n).getBoundingClientRect().x))');
    assert(x[1] - x[0] === 216, 'a gap in the feed: ' + x.join(', '));
  });

  await R.step('Shorts: the reels marked as ads are taken out of what YouTube fetches, read as JSON or as text', async () => {
    await open('https://www.youtube.com/shorts/abc');
    const got = await until(() => t.guest('/shorts/abc', 'window.__got'), 8000, 'the reels');
    assert(!got.error, got.error);
    assert(got.json.ids.join() === 'r1,r2', 'as JSON: ' + got.json.ids.join());
    assert(got.json.ok && got.json.status === 200 && /reel_watch_sequence\?prettyPrint=false$/.test(got.json.url) && /^application\/json/.test(got.json.type), 'the answer changed: ' + JSON.stringify(got.json));
    assert(got.text.join() === 'r1,r2', 'as text: ' + got.text.join());
    assert(got.xssi.prefixed && got.xssi.ids.join() === 'r1,r2', 'with )]}\': ' + JSON.stringify(got.xssi));
    assert(got.other.join() === 'r1,r-ad,r2', 'another answer was changed: ' + got.other.join());
    const parsed = await t.guest('/shorts/abc', 'window.__parsed');
    assert(parsed.join() === 'p1,p2', 'parsed: ' + parsed.join());
  });

  await R.step('…and an ad reel that’s in the page anyway is hidden, silenced and passed', async () => {
    const shown = await display('/shorts/abc', ['reel-0', 'reel-1', 'reel-2']);
    assert(shown.join() === 'reel-0:block,reel-1:none,reel-2:block', shown.join());
    const played = await t.guest('/shorts/abc', 'playAd()');
    assert(played === 'playing', 'the ad’s video didn’t play: ' + played);
    const s = await until(() => t.guest('/shorts/abc', '(() => { const v = document.getElementById("ad-video"); return v.muted && v.paused && { next: window.__next || 0 }; })()'), 3000, 'the ad’s video to stop (it was ' + played + ')');
    assert(s.next >= 1, 'not passed: ' + JSON.stringify(s));
  });

  await R.step('a YouTube player embedded in another site gets the same', async () => {
    await open(site.url + '/embedder.html');
    const inFrame = (code) => t.main(async ({ webContents }, code) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
        const f = wc.mainFrame.framesInSubtree.find((x) => x.url.includes('youtube-nocookie.com/embed/'));
        if (f) return f.executeJavaScript(code);
      }
      return null;
    }, code);
    const log = await until(() => inFrame('window.__log').then((l) => l && l.some((e) => e.ended) && l), 10000, 'the embedded player’s ad to end');
    const seen = log.find((e) => e.why);
    assert(seen && seen.why === 'ran to its end' && covered(seen), JSON.stringify(log));
  });

  await R.step('other sites are left alone', async () => {
    await open(site.url + '/plain.html');
    await until(() => t.guest('/plain.html', 'document.readyState === "complete"'), 5000, 'the page');
    const r = await t.guest('/plain.html', `(() => {
      const n = JSON.parse(JSON.stringify({ entries: [{ command: { reelWatchEndpoint: { videoId: 'x', adClientParams: { isAd: true } } } }] })).entries.length;
      const p = document.createElement('div'); p.className = 'html5-video-player ad-showing'; p.style.position = 'relative'; document.body.append(p);
      return { n, cover: getComputedStyle(p, '::after').content };
    })()`);
    assert(r.n === 1 && r.cover === 'none', JSON.stringify(r));
  });

  await R.step('with element hiding off, video ads are still covered and skipped and the pages’ ads stay', async () => {
    await setSetting('privacy.adblock.cosmetic', false);
    try {
      await sleep(300);
      await open('https://www.youtube.com/watch?v=e5&mode=stream&skip=0');
      const { seen } = await adRan('v=e5&');
      assert(seen && seen.why === 'ran to its end' && covered(seen), JSON.stringify(seen));
      await open('https://www.youtube.com/results?search_query=x');
      await until(() => t.guest('/results', 'document.readyState === "complete"'), 5000, 'the page');
      const ads = await display('/results', ['ad-tile', 'ad-search-slot']);
      assert(ads.every((x) => !x.endsWith(':none')), 'hidden: ' + ads.join(', '));
    } finally { await setSetting('privacy.adblock.cosmetic', true); }
  });

  await R.step('with “Hide and skip YouTube ads” off, YouTube is left as it is', async () => {
    await setSetting('privacy.adblock.youtubeSkip', false);
    try {
      await sleep(300);
      await open('https://www.youtube.com/watch?v=f6&mode=stitched&skip=0');
      await until(() => t.guest('v=f6&', 'document.getElementById("v").duration > 0'), 5000, 'the stream');
      await sleep(1000);
      const s = await t.guest('v=f6&', PLAYER);
      assert(s.ad && s.cover === 'none' && s.opacity === '1' && !s.muted && s.rate === 1, JSON.stringify(s));
      await open('https://www.youtube.com/shorts/off');
      const parsed = await until(() => t.guest('/shorts/off', 'window.__parsed'), 5000, 'the page');
      assert(parsed.join() === 'p1,p-ad,p2', 'parsed: ' + parsed.join());
    } finally { await setSetting('privacy.adblock.youtubeSkip', true); }
  });

  await R.step('nothing on the pages broke', async () => {
    const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
    assert(!errs.length, errs.slice(0, 6).join('\n'));
  });
} finally {
  const errs = t.logs.filter((l) => /Uncaught|TypeError/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log errors:\n  ' + errs.join('\n  '));
  await t.close();
  site.stop();
  yt.close();
  fs.rmSync(tls, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
