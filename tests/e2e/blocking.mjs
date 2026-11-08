// The ad blocker's domain list (HaGeZi's DNS blocklists; src/main/domain-list.js), against local stand-ins for
// the sites (pointed at a local HTTPS server with --host-resolver-rules) and a small list of its own
// (tests/fixtures/domains-test.txt) in place of HaGeZi's:
//  · what pages load from listed domains is blocked (scripts, frames, requests) and counted; the rest loads;
//  · never the site you're on: a listed site you visit works, and so does what it loads from its own domains;
//    a site's tracker subdomain is blocked on the site, though;
//  · a company's own services on its own sites (Google's console calling googleapis.com), or in a frame of its,
//    aren't blocked; on anybody else's site they are;
//  · the list's exceptions only let through what it would have stopped (EasyList's blocks stay), and Bifrost's
//    (domains-keep.txt: bot checks…) let theirs through;
//  · the other lists' exceptions (your own @@ rules) count here too, and their stand-ins (redirect-rule) take
//    the place of a script the domain list blocks;
//  · with the list off, or ads allowed on a site, it all loads;
//  · pop-up ads (a page opening a listed site on a click) are blocked, and say so; other pop-ups open, and so do
//    a site's own;
//  · updating: the list is made again from HaGeZi's files (served here), even when the other lists can't be
//    fetched; a download that comes out much smaller, or a file that doesn't come, leaves the list as it was.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { launch, reporter, assert, sleep, ROOT } from './lib.mjs';

const R = reporter('blocking');
const HOSTS = ['news.example', 'friendly.example', 'tracker.example', 'cdn.tracker.example', 'ok.tracker.example', 'ads.adnet.example', 'www.shop.example', 'metrics.shop.example', 'console.cloud.google.com', 'monitoring.googleapis.com', 'client.px-cloud.net', 'ad.doubleclick.net', 'popads.example', 'other.example', 'frames.example', 'newly.example', 'lists.example'];
const tls = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-block-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'key.pem'), '-out', path.join(tls, 'cert.pem'), '-days', '2', '-subj', '/CN=news.example', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });

// Every request that reached the server (host + path): a blocked one never does.
let served = [];
const reached = (hostPath) => served.some((s) => s === hostPath);
// HaGeZi's files, as the update finds them: 'good', 'small' (a download gone wrong) or 'missing' (one isn't there).
let hagezi = 'good';
const HZ_GOOD = ['tracker.example', 'newly.example', 'ads.adnet.example', 'popads.example', 'doubleclick.net', 'px-cloud.net', 'monitoring.googleapis.com', 'frames.example'];
function hz(rel) {
  if (hagezi === 'missing' && rel === 'adblock/popupads.txt') return null;
  if (rel.startsWith('share/')) return rel.includes('ad-shield') ? '||popads.example^\n' : '# allowed\nok.tracker.example\n';
  if (rel === 'adblock/whitelist-referral.txt') return '[Adblock Plus]\n@@||ad.doubleclick.net^\n';
  if (rel === 'adblock/ultimate.txt') return '[Adblock Plus]\n! Title: stand-in\n' + (hagezi === 'small' ? ['newly.example'] : HZ_GOOD).map((d) => `||${d}^`).join('\n') + '\n';
  return '[Adblock Plus]\n||newly.example^\n';
}

const PROBE = `<!doctype html><meta charset=utf-8><title>Probe</title><h1>Probe</h1><script>
  // Each script: whether it ran (the real one), loaded something else in its place (a stand-in), or was blocked.
  window.probe = (urls) => Promise.all(urls.map((u) => new Promise((done) => {
    const s = document.createElement('script');
    const key = new URL(u).host + new URL(u).pathname;
    s.src = u + '?n=' + Math.random();
    s.onload = () => done((window.__ran || []).includes(key) ? 'ran' : 'stand-in');
    s.onerror = () => done('blocked');
    document.head.appendChild(s);
  })));
  window.frame = (u) => new Promise((done) => { const f = document.createElement('iframe'); f.src = u; f.onload = () => done(true); document.body.appendChild(f); setTimeout(() => done(false), 4000); });
  window.request = (u) => fetch(u + '?n=' + Math.random(), { mode: 'no-cors' }).then(() => 'ok', () => 'blocked');
</script>`;
const server = https.createServer({ key: fs.readFileSync(path.join(tls, 'key.pem')), cert: fs.readFileSync(path.join(tls, 'cert.pem')) }, (req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const u = new URL(req.url, 'https://' + host);
  served.push(host + u.pathname);
  const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(body); };
  if (u.pathname.startsWith('/hz/')) { const t = hz(u.pathname.slice(4)); return t === null ? send(404, 'text/plain', 'no') : send(200, 'text/plain', t); }
  if (u.pathname.startsWith('/ghostery/')) return send(404, 'text/plain', 'no');
  if (u.pathname === '/probe.html') return send(200, 'text/html; charset=utf-8', PROBE);
  // A frame that loads a script of its own company's (Google's console, embedded somewhere else).
  if (u.pathname === '/frame.html') return send(200, 'text/html', '<!doctype html><p>A frame</p><script src="https://monitoring.googleapis.com/from-frame.js"></script>');
  if (u.pathname.endsWith('.js')) return send(200, 'application/javascript', `(window.__ran = window.__ran || []).push(${JSON.stringify(host + u.pathname)});`);
  send(200, 'text/html', '<!doctype html><title>Page</title><p>' + host + u.pathname + '</p>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({
  profile: 'blocking',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`, '--ignore-certificate-errors'],
  env: Object.assign({
    BIFROST_DOMAINS_LIST: path.join(ROOT, 'tests', 'fixtures', 'domains-test.txt'),
    BIFROST_DOMAINS_REMOTE: `https://lists.example:${port}/hz/`,
    BIFROST_LISTS_REMOTE: `https://lists.example:${port}/ghostery/`,
  }, NO_PROXY),
  settings: { onboarding: { done: true } },
});
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 400) + ')' : ''));
};
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const engines = () => t.main(() => { const a = global.__bifrost.adblock; return { lists: a.engineKey, domains: a.domainsKey, loading: !!a.loading, hasDomains: !!a.domains }; });
// Waits for the engines to be built again after a change (the lists', or the domain list's).
const rebuilt = async (before, which, label) => until(async () => { const e = await engines(); return !e.loading && e[which] !== before[which] && e; }, 60000, label);
let n = 0;
// Opens https://<host>/probe.html in a tab of its own and waits for it.
const page = async (host) => {
  const url = `https://${host}/probe.html?p=${++n}`;
  await t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
  await until(() => t.guest(`p=${n}`, 'typeof window.probe === "function"'), 15000, 'the page ' + url);
  return `p=${n}`;
};
const probe = (tab, urls) => t.guest(tab, `window.probe(${JSON.stringify(urls)})`);
const blockedHere = (tab) => t.main(({ webContents }, tab) => {
  const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(tab));
  return global.__bifrost.adblock.countFor(wc.id);
}, tab);

try {
  await R.step('the ad blocker and its domain list are ready', async () => {
    await until(async () => { const e = await engines(); return !e.loading && e.lists && e.hasDomains && e; }, 120000, 'the engines');
  });

  await R.step('what a page loads from listed domains is blocked (scripts, requests, frames) and counted; the rest loads', async () => {
    served = [];
    const tab = await page('news.example');
    const r = await probe(tab, ['https://tracker.example/a.js', 'https://cdn.tracker.example/b.js', 'https://ads.adnet.example/c.js', 'https://other.example/d.js', 'https://ok.tracker.example/e.js']);
    assert(JSON.stringify(r) === JSON.stringify(['blocked', 'blocked', 'blocked', 'ran', 'ran']), 'scripts: ' + JSON.stringify(r));
    const req = await t.guest(tab, 'window.request("https://tracker.example/api")');
    assert(req === 'blocked', 'the request: ' + req);
    await t.guest(tab, 'window.frame("https://frames.example/inner.html")');
    await sleep(300);
    assert(!reached('tracker.example/a.js') && !reached('cdn.tracker.example/b.js') && !reached('ads.adnet.example/c.js') && !reached('tracker.example/api') && !reached('frames.example/inner.html'), 'reached the server: ' + served.join(' '));
    assert(reached('other.example/d.js') && reached('ok.tracker.example/e.js'), 'didn’t reach the server: ' + served.join(' '));
    const count = await blockedHere(tab);
    assert(count >= 5, 'counted ' + count);
  });

  await R.step('never the site you’re on: a listed site works, and so does what it loads from its own domains', async () => {
    served = [];
    const tab = await page('tracker.example');
    const r = await probe(tab, ['https://tracker.example/own.js', 'https://cdn.tracker.example/lib.js', 'https://ads.adnet.example/c.js']);
    assert(JSON.stringify(r) === JSON.stringify(['ran', 'ran', 'blocked']), JSON.stringify(r));
    assert(reached('tracker.example/probe.html'), 'the page itself');
  });

  await R.step('…a site’s own tracker subdomain is blocked on it, though', async () => {
    const tab = await page('www.shop.example');
    const r = await probe(tab, ['https://metrics.shop.example/m.js', 'https://www.shop.example/app.js']);
    assert(JSON.stringify(r) === JSON.stringify(['blocked', 'ran']), JSON.stringify(r));
  });

  await R.step('a company’s own services on its own sites aren’t blocked (Google’s console calling googleapis.com), nor in a frame of its; elsewhere they are', async () => {
    served = [];
    let tab = await page('console.cloud.google.com');
    let r = await probe(tab, ['https://monitoring.googleapis.com/v3.js']);
    assert(r[0] === 'ran', 'on Google’s console: ' + r[0]);
    tab = await page('news.example');
    r = await probe(tab, ['https://monitoring.googleapis.com/v3b.js']);
    assert(r[0] === 'blocked', 'on another site: ' + r[0]);
    await t.guest(tab, 'window.frame("https://console.cloud.google.com/frame.html")');
    await until(() => reached('monitoring.googleapis.com/from-frame.js'), 5000, 'Google’s frame’s own request');
  });

  await R.step('the list’s exceptions only let through what it stopped (EasyList’s blocks stay); Bifrost’s own let theirs through', async () => {
    served = [];
    const tab = await page('news.example');
    const r = await probe(tab, ['https://ad.doubleclick.net/ddm/ad.js', 'https://client.px-cloud.net/main.min.js']);
    assert(r[0] !== 'ran' && !reached('ad.doubleclick.net/ddm/ad.js'), 'ad.doubleclick.net, the list’s exception: ' + r[0]);
    assert(r[1] === 'ran', 'a bot check, Bifrost’s exception: ' + r[1]);
  });

  await R.step('your own exceptions count here too, and the lists’ stand-ins take the place of a script it blocks', async () => {
    const before = await engines();
    await set('privacy.adblock.customFilters', '@@||ads.adnet.example^$domain=friendly.example\n||tracker.example^$script,redirect-rule=noopjs,domain=news.example');
    await rebuilt(before, 'lists', 'the lists with your filters');
    served = [];
    let tab = await page('friendly.example');
    let r = await probe(tab, ['https://ads.adnet.example/c.js']);
    assert(r[0] === 'ran', 'your exception: ' + r[0]);
    tab = await page('news.example');
    r = await probe(tab, ['https://ads.adnet.example/c.js', 'https://tracker.example/s.js']);
    assert(r[0] === 'blocked', 'on another site: ' + r[0]);
    assert(r[1] === 'stand-in' && !reached('tracker.example/s.js'), 'the stand-in: ' + r[1]);
    const b2 = await engines();
    await set('privacy.adblock.customFilters', '');
    await rebuilt(b2, 'lists', 'the lists without them');
  });

  await R.step('with the list off, or ads allowed on the site, it all loads', async () => {
    const before = await engines();
    await set('privacy.adblock.lists.domains', false);
    await rebuilt(before, 'domains', 'the domain list off');
    let tab = await page('news.example');
    let r = await probe(tab, ['https://tracker.example/off.js']);
    assert(r[0] === 'ran', 'the list off: ' + r[0]);
    const b2 = await engines();
    await set('privacy.adblock.lists.domains', true);
    await rebuilt(b2, 'domains', 'the domain list on');
    await set('privacy.adblock.allowlist', ['news.example']);
    tab = await page('news.example');
    r = await probe(tab, ['https://tracker.example/allowed.js']);
    assert(r[0] === 'ran', 'ads allowed on the site: ' + r[0]);
    await set('privacy.adblock.allowlist', []);
    tab = await page('news.example');
    r = await probe(tab, ['https://tracker.example/again.js']);
    assert(r[0] === 'blocked', 'back: ' + r[0]);
  });

  await R.step('pop-up ads (a listed site opened on a click) are blocked and say so; other pop-ups open, and so do a site’s own', async () => {
    served = [];
    const tabs = () => t.ui(() => window.__wbTest.state.tabs.map((tb) => tb.url));
    let tab = await page('news.example');
    const before = (await tabs()).length;
    const opened = await t.guest(tab, 'window.open("https://popads.example/landing.html") === null ? "null" : "window"');
    assert(opened === 'null', 'window.open gave ' + opened);
    const toast = await until(() => t.ui(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ')), 3000, 'the notice');
    assert(/Pop-up ad blocked on news\.example/.test(toast), 'the notice: ' + toast);
    await sleep(500);
    assert(!reached('popads.example/landing.html') && (await tabs()).length === before, 'it opened: ' + (await tabs()).slice(-2).join(' '));
    await t.guest(tab, 'window.open("https://other.example/opened.html")');
    await until(async () => (await tabs()).some((u) => u.includes('other.example/opened.html')), 5000, 'another site’s pop-up');
    tab = await page('tracker.example');
    await t.guest(tab, 'window.open("https://tracker.example/next.html")');
    await until(async () => (await tabs()).some((u) => u.includes('tracker.example/next.html')), 5000, 'the site’s own pop-up');
  });

  await R.step('updating makes the list again from HaGeZi’s files, even when the other lists can’t be fetched', async () => {
    const before = await engines();
    hagezi = 'good';
    const err = await t.ui(() => window.wb.invoke('adblock:update').then(() => '', (e) => e.message));
    assert(/EasyList and uBlock Origin’s lists \(.*HTTP 404/.test(err) && !/HaGeZi/.test(err), 'the error: ' + err);
    await rebuilt(before, 'domains', 'the new domain list');
    const file = path.join(t.dir, 'adblock', 'lists', 'domains.txt');
    const text = fs.readFileSync(file, 'utf8');
    assert(/^! Block rules: 8 \| Exception rules: 2$/m.test(text) && text.includes('||newly.example^') && text.includes('@@||ok.tracker.example^') && text.includes('@@||ad.doubleclick.net^'), 'the list: ' + text.slice(0, 600));
    const st = await t.ui(() => window.wb.invoke('adblock:status'));
    assert(st.domainsUpdated > 0 && !st.filtersUpdated, 'status: ' + JSON.stringify(st));
    let tab = await page('news.example');
    const r = await probe(tab, ['https://newly.example/n.js', 'https://tracker.example/t.js', 'https://ok.tracker.example/ok.js']);
    assert(JSON.stringify(r) === JSON.stringify(['blocked', 'blocked', 'ran']), JSON.stringify(r));
    tab = await page('www.shop.example');
    const r2 = await probe(tab, ['https://metrics.shop.example/m2.js']);
    assert(r2[0] === 'ran', 'no longer on the list: ' + r2[0]);
  });

  await R.step('…a download that comes out much smaller, or a file that doesn’t come, leaves the list as it was', async () => {
    const file = path.join(t.dir, 'adblock', 'lists', 'domains.txt');
    const was = fs.readFileSync(file, 'utf8');
    hagezi = 'small';
    let err = await t.ui(() => window.wb.invoke('adblock:update').then(() => '', (e) => e.message));
    assert(/HaGeZi’s domain list \(it came with 2 rules, against 8 before/.test(err), 'too small: ' + err);
    hagezi = 'missing';
    err = await t.ui(() => window.wb.invoke('adblock:update').then(() => '', (e) => e.message));
    assert(/HaGeZi’s domain list \(adblock\/popupads\.txt: HTTP 404\)/.test(err), 'a file missing: ' + err);
    assert(fs.readFileSync(file, 'utf8') === was, 'the list changed');
    const tab = await page('news.example');
    const r = await probe(tab, ['https://newly.example/n2.js']);
    assert(r[0] === 'blocked', 'the list still works: ' + r[0]);
  });

  await R.step('nothing on the pages broke', async () => {
    const errs = (await t.pageLogs()).filter((l) => /pageerror/.test(l));
    assert(!errs.length, errs.join('\n'));
  });
} finally {
  const errs = t.logs.filter((l) => /Uncaught|TypeError|\[adblock\]/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log:\n  ' + errs.join('\n  '));
  await t.close();
  server.close();
  fs.rmSync(tls, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
