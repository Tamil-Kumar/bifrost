// YouTube's ads, against a local stand-in for YouTube (www.youtube.com and the rest pointed at it with
// --host-resolver-rules, over HTTPS with a certificate made for this run; tests/fixtures/yt):
//  · its ads taken out of what it sends before the page sees it (the player data a watch page starts with, the
//    player's answers, a watch page the page asks for), nothing else in them changed, its cookies still set; the
//    player's check for a video without ads passes; nothing it asks for is blocked (Google's ad status script
//    loads there, and is blocked elsewhere); what would tell it you block ads is quiet (the callback it hands a
//    promise does nothing, its 17-second wait is cut short), and what's changed in the page looks untouched;
//  · a video ad is covered and muted from the moment it starts and skipped, whatever kind it is (a stream of
//    its own, stitched into the video's stream, one the player can't tell), and the video comes back with its
//    sound and speed; one whose stream turns out to be the video's own isn't run to its end;
//  · the ads in YouTube's pages are hidden and nothing else is;
//  · Shorts: the reels marked as ads are taken out of what YouTube sends; an ad reel that's in the page anyway is
//    hidden, silenced and passed;
//  · a YouTube player embedded in another site gets the same (Google's ad servers blocked there as on the site
//    it's in); other sites are left alone;
//  · with element hiding off the pages' ads stay, and with the setting off YouTube is left as it is;
//  · newer rules (src/shared/youtube-rules.json, fetched: here from the local site) are taken at once, in tabs
//    already open too, and kept; rules that aren't right, or older, change nothing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { launch, startSite, reporter, assert, sleep, ROOT, xinput } from './lib.mjs';

const R = reporter('youtube');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'yt');
const HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'static.doubleclick.net'];

const tls = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-yt-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'key.pem'), '-out', path.join(tls, 'cert.pem'), '-days', '2', '-subj', '/CN=www.youtube.com', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });

// The player's data, as YouTube sends it to a viewer without Premium: ads and all.
const PLAYER_DATA = { responseContext: {}, playabilityStatus: { status: 'OK' }, streamingData: { formats: [] },
  adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } } } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }], adSlots: [{ adSlotRenderer: {} }], videoDetails: { videoId: 'data' } };
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
  // The player's data, with ads (as YouTube answers a viewer without Premium).
  if (u.pathname === '/youtubei/v1/player') return json(PLAYER_DATA);
  // YouTube, changed: the player's data from a new address, its ads under a new name too.
  if (u.pathname === '/youtubei/v2/player') return json(Object.assign({ adBreaks: [{ adBreakRenderer: {} }] }, PLAYER_DATA));
  if (u.pathname === '/watch' && /^new/.test(u.searchParams.get('v') || '')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>YouTube, changed</title><link rel="icon" href="data:,"><div class="yt-new-ad" id="newad" style="height:40px">An ad of a new kind</div><p id="kept">A video</p>
<script>window.__ask = () => fetch('/youtubei/v2/player?prettyPrint=false', { method: 'POST', body: '{}' }).then((r) => r.json()).then((j) => Object.keys(j).sort()); window.__ask().then((k) => { window.__v2 = k; }, (e) => { window.__v2 = [String(e)]; });</script>`);
  }
  // A service worker that fetches everything for the pages it controls (as YouTube's may).
  if (u.pathname === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim())); self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));");
  }
  if (u.pathname === '/watch' && /^(data|sw)$/.test(u.searchParams.get('v') || '')) {
    if (u.searchParams.get('pbj')) return json([{ page: 'watch', playerResponse: PLAYER_DATA }], ")]}'\n");
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': ['YSC=stand-in; Path=/; Secure; SameSite=None', 'VISITOR_INFO1_LIVE=two; Path=/; Secure; SameSite=None'] });
    return res.end(fs.readFileSync(path.join(FIX, 'data.html')));
  }
  // The player's script: its check for a video that came without ads.
  if (/^\/s\/player\/[^/]+\/player_ias\.vflset\/[^/]+\/base\.js$/.test(u.pathname)) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end("window.__check = (function (U) { if(!U||!U.adPlacements&&!U.adSlots)return 'told on'; return 'passed'; })({ videoDetails: {} });");
  }
  // Google's ad status script (what ad blockers are spotted with).
  if (req.headers.host && req.headers.host.startsWith('static.doubleclick.net') && u.pathname === '/instream/ad_status.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end("window.google_ad_status = 1; window.__adStatusFrom = 'Google';");
  }
  const page = u.pathname === '/watch' || u.pathname.startsWith('/embed/') ? 'watch.html'
    : u.pathname.startsWith('/shorts/space') ? 'shorts-space.html'
      : u.pathname.startsWith('/shorts/') ? 'shorts.html'
      : u.pathname === '/' || u.pathname === '/results' ? 'feed.html' : null;
  if (!page) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(FIX, page)));
});
await new Promise((r) => yt.listen(0, '127.0.0.1', r));
const port = yt.address().port;

// The rules for YouTube's ads, as Bifrost's repository would serve them (what it serves: set by the test).
let rulesBody = '';
const site = await startSite(path.join(ROOT, 'tests', 'site'), { routes: {
  '/yt-rules.json': (req, res) => { if (!rulesBody) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(rulesBody); },
  '/embedder.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Embedder</title><h1>A page with a YouTube video</h1><iframe width="700" height="420" src="https://www.youtube-nocookie.com/embed/abc?mode=stream&skip=0"></iframe>'); },
  '/plain.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Plain</title><p>Not YouTube</p>'); },
  // Another site's link that sends you on to YouTube (a link shortener, a search result).
  '/to-youtube': (req, res) => { res.writeHead(302, { location: 'https://www.youtube.com/watch?v=data&via=redirect' }); res.end(); },
} });

const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({
  profile: 'youtube',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`, '--ignore-certificate-errors'],
  // (a player that says "ad" for 8 seconds is taken as stuck saying it, instead of 2 minutes)
  // (and the rules for YouTube's ads are looked for at the local site, when the test asks)
  env: Object.assign({ BIFROST_YT_STUCK_MS: '8000', BIFROST_YT_RULES_URL: site.url + '/yt-rules.json', BIFROST_YT_RULES_FIRST_MS: String(6 * 3600e3) }, NO_PROXY),
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

  await R.step('its ads taken out of what YouTube sends before the page sees it (a watch page’s player data, the player’s answers, a watch page asked for by the page), nothing else in them changed, its cookies still set; the player’s check for a video without ads passes', async () => {
    await open('https://www.youtube.com/watch?v=data');
    const seen = await until(() => t.guest('v=data', 'window.__seen && window.__seen.got && window.__seen'), 10000, 'the page’s data');
    assert(!seen.got.error, seen.got.error);
    const NO_ADS = ['no_ads', 'playabilityStatus', 'responseContext', 'videoDetails'];
    assert(JSON.stringify(seen.inline) === JSON.stringify(NO_ADS), 'the data it starts with: ' + seen.inline.join());
    assert(JSON.stringify(seen.got.player) === JSON.stringify(['no_ads', 'playabilityStatus', 'responseContext', 'streamingData', 'videoDetails']), 'the player’s answer: ' + seen.got.player.join());
    assert(JSON.stringify(seen.got.pbj) === JSON.stringify(['no_ads', 'playabilityStatus', 'responseContext', 'streamingData', 'videoDetails']), 'a watch page asked for: ' + seen.got.pbj.join());
    assert(seen.data === 'kept' && JSON.stringify(seen.got.next) === '["continuationEndpoint","entries"]', 'something else changed: ' + JSON.stringify([seen.data, seen.got.next]));
    assert(seen.check === 'passed', 'the player’s check: ' + seen.check);
    const cookie = await t.guest('v=data', 'document.cookie');
    assert(/(^|; )YSC=stand-in(;|$)/.test(cookie) && /(^|; )VISITOR_INFO1_LIVE=two(;|$)/.test(cookie), 'its cookies: ' + cookie);
  });

  await R.step('nothing YouTube asks for is blocked (Google’s own ad status script loads there), and elsewhere it still is (or the lists’ harmless copy of it is loaded instead, as before)', async () => {
    const there = await t.guest('v=data', 'window.__seen.adStatus');
    assert(there === 'Google', 'on YouTube: ' + there);
    await open(site.url + '/plain.html?ad-status');
    await until(() => t.guest('ad-status', 'document.readyState === "complete"'), 5000, 'the page');
    const elsewhere = await t.guest('ad-status', `new Promise((resolve) => { const s = document.createElement('script'); s.src = 'https://static.doubleclick.net/instream/ad_status.js'; s.onload = () => resolve(window.__adStatusFrom || (window.google_ad_status ? 'a copy' : 'none')); s.onerror = () => resolve('blocked'); document.head.append(s); })`);
    assert(elsewhere === 'a copy' || elsewhere === 'blocked', 'elsewhere: ' + elsewhere);
  });

  await R.step('what would tell YouTube you block its ads is quiet: the callback it hands a promise does nothing, its 17-second wait is cut short; what’s changed in the page looks untouched', async () => {
    const seen = await until(() => t.guest('v=data', 'window.__seen.waited !== null && window.__seen'), 5000, 'the wait');
    assert(seen.abnormal === 'quiet', 'the callback ran: ' + seen.abnormal);
    assert(seen.waited < 2000, 'waited ' + seen.waited + ' ms');
    assert(JSON.stringify(seen.native) === JSON.stringify(['function toString() { [native code] }', 'function then() { [native code] }', 'function setTimeout() { [native code] }']), 'they look changed: ' + JSON.stringify(seen.native));
  });

  await R.step('…and the same where YouTube’s service worker would fetch them for the page: the tab goes past it, and it stays registered', async () => {
    const reg = await t.guest('v=data', `navigator.serviceWorker.register('/sw.js', { scope: '/watch?v=sw' }).then((r) => new Promise((resolve) => { const w = r.installing || r.waiting || r.active; if (w.state === 'activated') return resolve(w.state); w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(w.state); }); setTimeout(() => resolve(w.state), 5000); }), (e) => String(e))`);
    assert(reg === 'activated', 'the service worker: ' + reg);
    await open('https://www.youtube.com/watch?v=sw');
    const seen = await until(() => t.guest('v=sw', 'window.__seen && window.__seen.got && window.__seen'), 10000, 'the page’s data');
    const via = await t.guest('v=sw', `navigator.serviceWorker.getRegistration('/watch?v=sw').then((r) => ({ registered: !!(r && r.active), controlled: !!navigator.serviceWorker.controller, page: performance.getEntriesByType('navigation')[0].workerStart > 0, player: performance.getEntriesByType('resource').filter((e) => e.name.includes('/youtubei/v1/player') || e.name.includes('/base.js')).map((e) => e.workerStart > 0) }))`);
    assert(via.registered && !via.controlled && !via.page && via.player.length === 2 && !via.player.some(Boolean), 'the service worker: ' + JSON.stringify(via));
    assert(!seen.got.error, seen.got.error);
    assert(seen.inline.join() === 'no_ads,playabilityStatus,responseContext,videoDetails', 'the data it starts with: ' + seen.inline.join());
    assert(seen.got.player.join() === 'no_ads,playabilityStatus,responseContext,streamingData,videoDetails' && seen.got.pbj.includes('no_ads') && !seen.got.pbj.includes('adSlots'), 'the player’s answers: ' + JSON.stringify(seen.got));
    assert(seen.check === 'passed' && seen.adStatus === 'Google', 'the check, the ad status: ' + JSON.stringify([seen.check, seen.adStatus]));
  });

  await R.step('only a tab on YouTube has its answers held (others’ requests go untouched by it): from the moment the tab goes to YouTube, by a link from another site that sends it on too, until the tab has left', async () => {
    // (whether a tab's answers are held: main/youtube-ads.js)
    const attached = (match) => t.main(({ webContents }, match) => { const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().includes(match)); return wc ? global.__require('./youtube-ads').isOn(wc) : null; }, match);
    assert(await attached('v=data') === true, 'the YouTube tab’s answers aren’t held');
    assert(await attached('/plain.html') === false, 'a tab on another site has its answers held: ' + await attached('/plain.html'));
    // Sent on to YouTube by another site: its ads are out all the same.
    await open(site.url + '/to-youtube');
    const seen = await until(() => t.guest('via=redirect', 'window.__seen && window.__seen.got && window.__seen'), 10000, 'the page, by way of another site');
    assert(await attached('via=redirect') === true, 'sent on to YouTube: its answers aren’t held');
    assert(seen.inline.join() === 'no_ads,playabilityStatus,responseContext,videoDetails' && seen.got.player.includes('no_ads') && seen.check === 'passed', 'sent on to YouTube: ' + JSON.stringify(seen));
    // (the tab as after any link: YouTube's page, no error, nothing before it to go back to)
    const tab = await t.ui(() => { const tb = window.__wbTest.state.tabs.find((x) => x.url.includes('via=redirect')); return tb ? { error: tb.error || null, back: !!tb.canGoBack, loading: !!tb.loading } : null; });
    assert(tab && !tab.error && !tab.back, 'the tab sent on to YouTube: ' + JSON.stringify(tab));
    // …and leaving YouTube ends it.
    await t.main(({ webContents }, url) => webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('via=redirect')).loadURL(url), site.url + '/plain.html?left');
    await until(async () => (await attached('plain.html?left')) === false, 5000, 'the holding over after leaving YouTube');
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

  await R.step('Shorts: Space plays and pauses the Short on screen wherever the keyboard is in the page (YouTube only hears it in its player), once even when its player has it; a space in the search box, a button’s own Space; K as before', async () => {
    const x = xinput();
    try {
      await open('https://www.youtube.com/shorts/space');
      const S = (code) => t.guest('/shorts/space', code);
      const state = () => S('({ paused: document.getElementById("sv").paused, toggles: window.__toggles, likes: window.__likes || 0, search: document.getElementById("search").value })');
      await until(() => S('!document.getElementById("sv").paused'), 8000, 'the Short playing');
      await until(() => t.ui(() => { const W = window.__wbTest.state; const ws = W.workspaces.find((w) => w.id === W.activeWorkspaceId); const tb = W.tabs.find((y) => y.id === ws.activeTabId); return !!(tb && tb.url.includes('/shorts/space')); }), 6000, 'the Short’s tab in front');
      await sleep(300);
      // (a click on an empty part of the page: the keyboard on the page, on nothing in it)
      const at = await t.main(async ({ webContents, BrowserWindow }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/shorts/space'));
        const host = wc.hostWebContents;
        const r = await host.executeJavaScript(`(() => { const v = [...document.querySelectorAll('webview')].find((w) => { try { return w.getWebContentsId() === ${wc.id}; } catch { return false; } }); const b = v.getBoundingClientRect(); return [b.x, b.y]; })()`);
        const b = BrowserWindow.fromWebContents(host).getContentBounds();
        return { x: Math.round(b.x + r[0] + 600), y: Math.round(b.y + r[1] + 300) };
      });
      await x.click(at.x, at.y);
      await until(() => S('document.hasFocus() && document.activeElement === document.body'), 3000, 'the keyboard on the Short’s page');
      await sleep(200);
      await x.key('space'); await sleep(400);
      let st = await state();
      assert(st.paused && st.toggles === 0, 'Space didn’t pause it: ' + JSON.stringify(st));
      await x.key('space'); await sleep(400);
      st = await state();
      assert(!st.paused, 'Space didn’t play it again: ' + JSON.stringify(st));
      // Its player with the keyboard: one step, not two (YouTube's own doesn't go too).
      await S('document.getElementById("shorts-player").focus(), 1');
      await x.key('space'); await sleep(400);
      st = await state();
      assert(st.paused && st.toggles === 0, 'with its player chosen: ' + JSON.stringify(st));
      await x.key('space'); await sleep(400);
      // The search box: a space typed, the Short as it was.
      await S('document.getElementById("search").focus(), 1');
      await x.key('space'); await sleep(300);
      st = await state();
      assert(!st.paused && st.search === ' ', 'in the search box: ' + JSON.stringify(st));
      // A button: its own.
      await S('document.getElementById("like").focus(), 1');
      await x.key('space'); await sleep(300);
      st = await state();
      assert(!st.paused && st.likes === 1, 'on a button: ' + JSON.stringify(st));
      // K: YouTube's, as before.
      await S('document.activeElement.blur(), 1');
      await x.key('k'); await sleep(300);
      st = await state();
      assert(st.paused && st.toggles === 1, 'K: ' + JSON.stringify(st));
    } finally { x.close(); }
  });

  await R.step('Shorts: the reels marked as ads are taken out of what YouTube sends, read as JSON or as text', async () => {
    await open('https://www.youtube.com/shorts/abc');
    const got = await until(() => t.guest('/shorts/abc', 'window.__got'), 8000, 'the reels');
    assert(!got.error, got.error);
    assert(got.json.ids.join() === 'r1,r2', 'as JSON: ' + got.json.ids.join());
    assert(got.json.ok && got.json.status === 200 && /reel_watch_sequence\?prettyPrint=false$/.test(got.json.url) && /^application\/json/.test(got.json.type), 'the answer changed: ' + JSON.stringify(got.json));
    assert(got.text.join() === 'r1,r2', 'as text: ' + got.text.join());
    assert(got.xssi.prefixed && got.xssi.ids.join() === 'r1,r2', 'with )]}\': ' + JSON.stringify(got.xssi));
    assert(got.other.join() === 'r1,r-ad,r2', 'another answer was changed: ' + got.other.join());
    // (nothing of the page's own is changed for it: what it parses is as it was)
    const parsed = await t.guest('/shorts/abc', 'window.__parsed');
    assert(parsed.join() === 'p1,p-ad,p2', 'parsed: ' + parsed.join());
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
    // (Google's ad servers stay blocked there, as on the site it's in)
    const adStatus = await inFrame(`new Promise((resolve) => { const s = document.createElement('script'); s.src = 'https://static.doubleclick.net/instream/ad_status.js'; s.onload = () => resolve(window.__adStatusFrom || (window.google_ad_status ? 'a copy' : 'none')); s.onerror = () => resolve('blocked'); document.head.append(s); })`);
    assert(adStatus === 'a copy' || adStatus === 'blocked', 'Google’s ad status script in the embedded player: ' + adStatus);
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

  await R.step('with “Block YouTube ads” off, YouTube is left as it is', async () => {
    await setSetting('privacy.adblock.youtubeSkip', false);
    try {
      await sleep(300);
      await open('https://www.youtube.com/watch?v=data&off=1');
      const seen = await until(() => t.guest('off=1', 'window.__seen && window.__seen.got && window.__seen'), 10000, 'the page’s data');
      assert(seen.inline.includes('adPlacements') && seen.got.player.includes('adSlots') && seen.check === 'told on' && seen.abnormal === 'told', 'changed: ' + JSON.stringify(seen));
      // (and YouTube's service worker answers for its pages again)
      await open('https://www.youtube.com/watch?v=sw&off=2');
      const sw = await until(() => t.guest('off=2', 'window.__seen && window.__seen.got && ({ inline: window.__seen.inline, controlled: !!navigator.serviceWorker.controller })'), 10000, 'the page’s data');
      assert(sw.controlled && sw.inline.includes('adPlacements'), 'past the service worker: ' + JSON.stringify(sw));
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

  await R.step('newer rules for YouTube’s ads are fetched and taken at once (a new address, a new name for its ads, a new ad in its pages), in a tab already open too, and kept; rules that aren’t right, or older, change nothing', async () => {
    const builtin = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'youtube-rules.json'), 'utf8'));
    const refresh = () => t.main(async () => { const y = global.__bifrost.youtubeRules; const found = await y.refresh(); return Object.assign({ found }, y.info()); });
    const file = () => t.main(({ app }) => { const p = global.__require('node:path').join(app.getPath('userData'), 'youtube-rules.json'); const f = global.__require('node:fs'); return f.existsSync(p) ? JSON.parse(f.readFileSync(p, 'utf8')).version : null; });
    const ads = (keys) => keys.filter((k) => /^ad|Ads$/.test(k));
    // YouTube, changed: with the rules Bifrost came with, its new answers keep their ads.
    await open('https://www.youtube.com/watch?v=new1');
    let keys = await until(() => t.guest('v=new1', 'window.__v2'), 10000, 'the page’s data');
    assert(ads(keys).join() === 'adBreaks,adPlacements,adSlots,playerAds', 'with the built-in rules: ' + keys.join());
    assert(await t.guest('v=new1', 'getComputedStyle(document.getElementById("newad")).display') === 'block', 'the new kind of ad is hidden already');
    let was = await t.main(() => global.__bifrost.youtubeRules.info());
    assert(was.version === builtin.version && !was.downloaded, 'the rules in use at first: ' + JSON.stringify(was));
    // None to be had (the server says so): nothing changes.
    let r = await refresh();
    assert(r.found === 'failed' && r.version === builtin.version && /404/.test(r.error), 'with none there: ' + JSON.stringify(r));
    // Newer, but with something in them this version doesn't know; newer, but not rules; and older ones.
    const next = JSON.parse(JSON.stringify(builtin));
    next.version = builtin.version + 1;
    next.hold.push('/youtubei/v2/player*');
    next.answers.unshift({ kind: 'player', path: '^/youtubei/v2/player(/|$)' });
    next.edits.player[0].keys.push('adBreaks');
    next.page.hide.push('.yt-new-ad');
    rulesBody = JSON.stringify(Object.assign({}, next, { edits: Object.assign({}, next.edits, { player: [{ do: 'run', code: 'x' }] }) }));
    r = await refresh();
    assert(r.found === 'failed' && r.version === builtin.version, 'rules with something unknown in them were taken: ' + JSON.stringify(r));
    rulesBody = '<!doctype html><title>Not found</title>';
    r = await refresh();
    assert(r.found === 'failed' && r.version === builtin.version, 'a web page was taken for rules: ' + JSON.stringify(r));
    rulesBody = JSON.stringify(Object.assign({}, next, { version: builtin.version - 1 }));
    r = await refresh();
    assert(r.found === 'same' && r.version === builtin.version && !r.downloaded && (await file()) === null, 'older rules: ' + JSON.stringify(r));
    // Newer ones: taken, and kept for the next start.
    rulesBody = JSON.stringify(next);
    r = await refresh();
    assert(r.found === 'newer' && r.version === next.version && r.downloaded && !r.error, 'newer rules: ' + JSON.stringify(r));
    assert((await file()) === next.version, 'not kept: ' + await file());
    // The tab already on YouTube: its next answers are without their ads.
    keys = await until(() => t.guest('v=new1', 'window.__ask()').then((k) => !ads(k).length && k), 8000, 'the open tab’s next answer without ads');
    assert(keys.includes('no_ads') && keys.includes('videoDetails'), 'the open tab’s answer: ' + keys.join());
    // A page opened now: the same, and the new kind of ad in it is hidden (nothing else is).
    await open('https://www.youtube.com/watch?v=new2');
    keys = await until(() => t.guest('v=new2', 'window.__v2'), 10000, 'the page’s data');
    assert(!ads(keys).length && keys.includes('no_ads'), 'a page opened after: ' + keys.join());
    const shown = await t.guest('v=new2', '[getComputedStyle(document.getElementById("newad")).display, getComputedStyle(document.getElementById("kept")).display]');
    assert(shown.join() === 'none,block', 'the new kind of ad in the page: ' + shown.join());
    // …and what was held before still is.
    await open('https://www.youtube.com/watch?v=data&after=rules');
    const seen = await until(() => t.guest('after=rules', 'window.__seen && window.__seen.got && window.__seen'), 10000, 'the page’s data');
    assert(!ads(seen.inline).length && !ads(seen.got.player).length && seen.check === 'passed', 'with the newer rules, what the old ones did: ' + JSON.stringify(seen));
    // The same again: nothing to do. And at the next start they're the ones in use.
    r = await refresh();
    assert(r.found === 'same' && r.version === next.version, 'asked again: ' + JSON.stringify(r));
    const atStart = await t.main(async () => { const { YouTubeRules } = global.__require('./youtube-rules'); const y = new YouTubeRules(); y.init(); clearTimeout(y.timer); await new Promise((res) => setTimeout(res, 400)); clearTimeout(y.timer); return y.info(); });
    assert(atStart.version === next.version && atStart.downloaded, 'at the next start: ' + JSON.stringify(atStart));
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
