// Translating pages, and warnings for dangerous sites. Made-up sites (fr.example.com and so on) are mapped
// to the local test server; Google Translate is mapped to nowhere (nothing leaves this computer), and the
// dangerous-sites lists are the test's own (BIFROST_SAFETY_LISTS).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startSite, reporter, assert, sleep, xinput } from './lib.mjs';

const R = reporter('web');
const html = (body, { title = 'Test', lang = '' } = {}) => (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html${lang ? ` lang="${lang}"` : ''}><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif;margin:30px">${body}</body></html>`); };
const seen = [];   // every request the server got: host + path
const logged = (routes) => Object.fromEntries(Object.entries(routes).map(([k, fn]) => [k, k === 'match' ? fn : (req, res, url) => { seen.push(String(req.headers.host || '').replace(/:\d+$/, '') + req.url); return fn(req, res, url); }]));
const site = await startSite(undefined, { routes: logged({
  '/fr.html': html('<h1>Bonjour</h1><p>Ceci est une page en français.</p>', { title: 'Une page', lang: 'fr-FR' }),
  '/en.html': html('<h1>Hello</h1><p>This page is in English.</p>', { title: 'A page', lang: 'en-GB' }),
  '/login.html': html('<h1>Sign in to your bank</h1><input type=password>', { title: 'Bank' }),
  '/framed.html': html('<h1>A page with a frame</h1><iframe id=f src="http://scam.example.com/frame.html" width=300 height=100></iframe>', { title: 'Framed' }),
  '/frame.html': html('<p>frame</p>', { title: 'Frame' }),
  '/opener.html': html('<button id=b style="font-size:30px;padding:30px" onclick="window.open(\'http://phish.example.net/login.html\', \'w\', \'width=480,height=520\')">Sign in</button>', { title: 'Opener' }),
  '/dl.html': html('<a id=d href="http://files.example.org/payload.exe" download style="font-size:28px">Get the file</a>', { title: 'Downloads' }),
  '/payload.exe': (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=payload.exe' }); res.end('MZ not really'); },
  match: (req) => { seen.push(String(req.headers.host || '').replace(/:\d+$/, '') + req.url); return false; },
}) });
const lists = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-safety-'));
fs.writeFileSync(path.join(lists, 'phishing.txt'), '! test\n||phish.example.net^$all\n');
fs.writeFileSync(path.join(lists, 'malware.txt'), '! test\n||files.example.org/payload.exe\n');
fs.writeFileSync(path.join(lists, 'badware.txt'), '! test\n||scam.example.com^$all\n');
const hosts = ['fr.example.com', 'en.example.com', 'phish.example.net', 'scam.example.com', 'files.example.org'];
const rules = [...hosts.map((hst) => `MAP ${hst} 127.0.0.1:${site.port}`), 'MAP translate.google.com 127.0.0.1:1', 'MAP *.translate.goog 127.0.0.1:1'].join(',');
const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({ profile: 'web', args: [site.url + '/a.html', `--host-resolver-rules=${rules}`], env: { ...NO_PROXY, BIFROST_SAFETY_LISTS: lists } });
const x = xinput();

const active = () => t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const tb = S.tabs.find((y) => y.id === ws.activeTabId); return { url: tb.url, pendingUrl: tb.pendingUrl || '', error: tb.error, danger: tb.danger || null, lang: tb.lang || '', canGoBack: !!tb.canGoBack, loading: !!tb.loading, title: tb.title || '' }; });
const go = (url) => t.ui((url) => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const tb = S.tabs.find((y) => y.id === ws.activeTabId); tb.wv.loadURL(url).catch(() => {}); }, url);
const open = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 240) + ')' : ''));
};
const rect = (sel) => t.ui((sel) => { const e = [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: e.textContent.trim(), title: e.title || '', hidden: e.hidden }; }, sel);
const clickUi = async (sel, button = 1) => { const r = await until(() => rect(sel), 4000, sel); await x.click(Math.round(r.x), Math.round(r.y), button); return r; };
const clickItem = async (re) => {
  const r = await until(() => t.ui((src) => { const it = [...document.querySelectorAll('.menu .menu-item')].find((e) => new RegExp(src).test(e.textContent)); if (!it) return null; const q = it.getBoundingClientRect(); return { x: q.x + 30, y: q.y + q.height / 2 }; }, re.source), 3000, 'menu item ' + re);
  await x.click(Math.round(r.x), Math.round(r.y));
};
const overlay = () => t.ui(() => { const o = [...document.querySelectorAll('.pane-overlay.err.danger')].find((e) => e.getClientRects().length); return o ? { title: o.querySelector('h2').textContent, text: o.textContent } : null; });
const translateBtn = () => t.ui(() => { const b = document.querySelector('.addr-btn.translateb'); return b ? { hidden: b.hidden, on: b.classList.contains('on'), title: b.title } : null; });

let L = '', S = '';   // the local-file steps' folders
try {
  await sleep(1200);

  // ---------------------------------------------------------------------------------------- translation
  await R.step('a page in another language offers a Translate button, which sends it to Google Translate', async () => {
    await go('http://fr.example.com/fr.html');
    await until(async () => (await active()).lang === 'fr-FR', 6000, 'the page’s language');
    const b = await until(async () => { const v = await translateBtn(); return v && !v.hidden ? v : null; }, 3000, 'the Translate button');
    assert(/Translate this page into English/.test(b.title), 'its tooltip: ' + b.title);
    await clickUi('.addr-btn.translateb');
    const want = 'https://translate.google.com/translate?sl=auto&tl=en&hl=en&u=' + encodeURIComponent('http://fr.example.com/fr.html');
    await until(async () => { const a = await active(); return a.url === want || a.pendingUrl === want; }, 5000, 'the tab to go to ' + want);
  });

  await R.step('…and a translated page has the button lit, which goes back to the original page', async () => {
    await go('https://fr-example-com.translate.goog/fr.html?_x_tr_sch=http&_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en');
    await until(async () => { const v = await translateBtn(); return v && !v.hidden && v.on ? v : null; }, 6000, 'the lit button on a translated page');
    await clickUi('.addr-btn.translateb');
    await until(async () => (await active()).url === 'http://fr.example.com/fr.html', 6000, 'the original page');
  });

  await R.step('the page’s right-click menu offers it too; a page in your language doesn’t get the button', async () => {
    const v = await t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
    await x.click(Math.round(v.x + v.w / 2), Math.round(v.y + 260), 3);
    const items = await until(() => t.ui(() => { const m = document.querySelector('.menu'); return m ? [...m.querySelectorAll('.menu-item')].map((e) => e.textContent.trim()) : null; }), 4000, 'the page menu');
    assert(items.some((s) => /Translate into English/.test(s)), 'menu items: ' + items.join(' | '));
    await x.key('Escape'); await sleep(300);
    await go('http://en.example.com/en.html');
    await until(async () => (await active()).lang === 'en-GB', 6000, 'the English page’s language');
    await sleep(300);
    const b = await translateBtn();
    assert(b && b.hidden, 'an English page offers translation into English');
  });

  await R.step('“Never offer to translate French” (the button’s right-click menu) hides it on French pages', async () => {
    await go('http://fr.example.com/fr.html');
    await until(async () => { const v = await translateBtn(); return v && !v.hidden ? v : null; }, 6000, 'the Translate button');
    await clickUi('.addr-btn.translateb', 3);
    await clickItem(/Never offer to translate French/);
    await until(async () => (await translateBtn()).hidden, 3000, 'the button to go');
    const never = await t.main(() => global.__bifrost.settings.get('translate.neverFor'));
    assert(JSON.stringify(never) === '["fr"]', 'translate.neverFor: ' + JSON.stringify(never));
  });

  // ------------------------------------------------------------------------------------ dangerous sites
  await R.step('a phishing page never loads: the tab warns instead, and Back to safety goes back', async () => {
    await go(site.url + '/a.html');
    await until(async () => (await active()).url.endsWith('/a.html'), 5000, 'the first page');
    seen.length = 0;
    await go('http://phish.example.net/login.html');
    const o = await until(overlay, 6000, 'the warning');
    assert(o.title === 'Deceptive site ahead', 'title: ' + o.title);
    assert(/phish\.example\.net/.test(o.text), 'the warning doesn’t say which site');
    assert(!seen.some((s) => s.startsWith('phish.example.net')), 'the phishing page was requested: ' + seen.join(', '));
    await sleep(1200);
    const st = await active();
    assert(!st.loading && st.title === 'Dangerous site' && st.url === 'http://phish.example.net/login.html', 'the tab while warning: ' + JSON.stringify(st));
    await t.shot('web-danger');
    await clickUi('.pane-overlay.err.danger .btn.safety');
    const back = await until(async () => { const a = await active(); return a.url.endsWith('/a.html') && !a.error && !a.danger ? a : null; }, 5000, 'back on the first page');
    assert(back.title === 'Page A', 'its title: ' + back.title);
    assert(!(await overlay()), 'the warning is still showing');
  });

  await R.step('…Details → Visit anyway opens it (and it isn’t stopped again)', async () => {
    await go('http://phish.example.net/login.html');
    await until(overlay, 6000, 'the warning');
    await clickUi('.pane-overlay.err.danger .btn.ghost');
    await clickUi('.pane-overlay.err.danger .btn.danger-text');
    await until(async () => { const a = await active(); return a.url === 'http://phish.example.net/login.html' && !a.error && !a.danger ? a : null; }, 6000, 'the page to load');
    await until(() => seen.includes('phish.example.net/login.html'), 4000, 'the page to be requested (got ' + seen.join(', ') + ')');
    await go(site.url + '/b.html'); await sleep(600);
    await go('http://phish.example.net/login.html');
    await until(async () => { const a = await active(); return a.url === 'http://phish.example.net/login.html' && !a.error && !a.danger ? a : null; }, 6000, 'the page again, without a warning');
  });

  await R.step('a site opened in a new tab (nothing to go back to): Back to safety opens the start page', async () => {
    await open('http://scam.example.com/frame.html');
    const o = await until(overlay, 6000, 'the warning');
    assert(o.title === 'This site is known for scams', 'title: ' + o.title);
    await clickUi('.pane-overlay.err.danger .btn.safety');
    await until(async () => (await active()).url.startsWith('bifrost://newtab'), 5000, 'the start page');
  });

  await R.step('a pop-up window opening a dangerous site shows the warning as its page', async () => {
    await t.main(() => global.__bifrost.safety.allowed.clear());
    seen.length = 0;
    await go(site.url + '/opener.html');
    await until(async () => (await active()).url.endsWith('/opener.html'), 5000, 'the page');
    const r = await t.guest('/opener.html', '(() => { const e = document.getElementById("b").getBoundingClientRect(); return { x: e.x + 20, y: e.y + e.height / 2 }; })()');
    const v = await t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50); const q = w.getBoundingClientRect(); return { x: q.x, y: q.y }; });
    await x.click(Math.round(v.x + r.x), Math.round(v.y + r.y));
    const pop = await until(() => t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((b) => !b.isDestroyed() && b.webContents.getURL().startsWith('data:text/html')); const title = w ? w.webContents.getTitle() : ''; return title && !title.startsWith('data:') ? title : null; }), 6000, 'the warning in the pop-up');
    assert(pop === 'Deceptive site ahead', 'its title: ' + pop);
    assert(!seen.some((s) => s.startsWith('phish.example.net')), 'the page was requested: ' + seen.join(', '));
    await t.main(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('data:text/html')) w.close(); });
  });

  await R.step('a frame from a dangerous site inside a page is blocked; the page itself loads', async () => {
    seen.length = 0;
    await go(site.url + '/framed.html');
    await until(async () => { const a = await active(); return a.url.endsWith('/framed.html') && !a.error ? a : null; }, 5000, 'the page');
    await sleep(800);
    assert(!(await overlay()), 'the page got a warning');
    assert(!seen.some((s) => s.startsWith('scam.example.com')), 'the frame was requested: ' + seen.join(', '));
  });

  await R.step('a download from a malware address is blocked, and says so', async () => {
    await go('http://files.example.org/dl.html');
    await until(async () => (await active()).url.endsWith('/dl.html'), 5000, 'the page');
    seen.length = 0;
    const r = await t.guest('/dl.html', '(() => { const e = document.getElementById("d").getBoundingClientRect(); return { x: e.x + 10, y: e.y + e.height / 2 }; })()');
    const v = await t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50); const q = w.getBoundingClientRect(); return { x: q.x, y: q.y }; });
    await x.click(Math.round(v.x + r.x), Math.round(v.y + r.y));
    const toast = await until(() => t.ui(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ') || null), 5000, 'a toast');
    assert(/dangerous download|blocked files\.example\.org/i.test(toast), "toast: " + toast);
    await sleep(500);
    const dls = await t.main(() => global.__bifrost.downloads.list().map((d) => d.url));
    assert(!dls.some((u) => /payload\.exe/.test(u)), 'it was downloaded: ' + dls.join(', '));
    const folder = await t.main(() => global.__bifrost.downloads.folder());
    assert(!fs.existsSync(path.join(folder, 'payload.exe')), 'the file was saved');
  });

  await R.step('with the warnings turned off, nothing is stopped', async () => {
    await t.main(() => global.__bifrost.settings.set('privacy.dangerousSites', false));
    await go('http://scam.example.com/frame.html');
    await until(async () => { const a = await active(); return a.url === 'http://scam.example.com/frame.html' && !a.error ? a : null; }, 6000, 'the page to load');
    await t.main(() => global.__bifrost.settings.set('privacy.dangerousSites', true));
  });

  // A page opened from a file: Electron would let it read any other file (src/main/file-guard.js).
  L = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-local-'));    // its site folder
  S = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-secret-'));   // somewhere else on the disk
  const u = (p) => 'file://' + p;
  const png = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'site', 'icons', 'red.png'));
  fs.writeFileSync(path.join(S, 'secret.txt'), 'TOP SECRET');
  fs.writeFileSync(path.join(S, 'secret.html'), '<p>TOP SECRET</p>');
  fs.writeFileSync(path.join(S, 'secret.png'), png);
  fs.mkdirSync(path.join(L, '.hidden'));
  fs.writeFileSync(path.join(L, '.hidden', 'secret.html'), '<p>TOP SECRET</p>');
  fs.mkdirSync(path.join(L, 'site', 'docs'), { recursive: true });
  fs.mkdirSync(path.join(L, 'site', '_static'));
  fs.writeFileSync(path.join(L, 'site', '_static', 'style.css'), '#styled { color: rgb(1, 2, 3) }');
  fs.writeFileSync(path.join(L, 'site', '_static', 'pic.png'), png);
  fs.writeFileSync(path.join(L, 'site', '_static', 'lib.js'), 'window.libLoaded = true;');
  fs.writeFileSync(path.join(L, 'site', 'docs', 'frame.html'), '<p>frame text</p>');
  fs.writeFileSync(path.join(L, 'site', 'docs', 'worker.js'), `fetch(${JSON.stringify(u(path.join(S, 'secret.txt')))}).then((r) => r.text()).then((t) => postMessage('read ' + t));`);
  fs.writeFileSync(path.join(L, 'site', 'docs', 'sw.js'), '');
  const secret = u(path.join(S, 'secret.txt'));
  fs.writeFileSync(path.join(L, 'site', 'docs', 'page.html'), `<!doctype html><meta charset="utf-8"><title>Local page</title>
<link rel="stylesheet" href="../_static/style.css"><p id="styled">styled</p>
<img id="ok" src="../_static/pic.png"><img id="bad" src="${u(path.join(S, 'secret.png'))}">
<iframe id="same" src="frame.html"></iframe><iframe id="far" src="${u(path.join(S, 'secret.html'))}"></iframe><iframe id="dot" src="${u(path.join(L, '.hidden', 'secret.html'))}"></iframe>
<script src="../_static/lib.js"></script>
<script>
const r = window.__r = {};
const secret = ${JSON.stringify(secret)};
const attempt = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = 'blocked: ' + ((e && e.message) || e); } };
const worker = (w) => new Promise((res, rej) => { w.onmessage = (m) => res(m.data); w.onerror = () => rej(new Error('refused')); setTimeout(() => rej(new Error('no answer')), 3000); });
(async () => {
  await attempt('fetch', async () => (await (await fetch(secret)).text()).trim());
  await attempt('fetchSameFolder', async () => (await (await fetch('frame.html')).text()).length);
  await attempt('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', secret, false); x.send(); return x.responseText.trim(); });
  await attempt('fileWorker', () => worker(new Worker('worker.js')));
  await attempt('blobWorker', () => worker(new Worker(URL.createObjectURL(new Blob(['fetch(' + JSON.stringify(secret) + ').then((r) => r.text()).then((t) => postMessage("read " + t), () => postMessage("its fetch failed"))'], { type: 'text/javascript' })))));
  await attempt('serviceWorker', async () => (await navigator.serviceWorker.register('sw.js')).scope);
  await attempt('web', async () => (await fetch('${site.url}/a.html', { mode: 'no-cors' })).type);
  await new Promise((res) => setTimeout(res, 1000));
  const text = (id) => { try { const d = document.getElementById(id).contentDocument; return d && d.body ? d.body.innerText.trim() : '(nothing)'; } catch (e) { return 'blocked: ' + e.message; } };
  Object.assign(r, { frameSame: text('same'), frameFar: text('far'), frameDot: text('dot') });
  r.imgOk = document.getElementById('ok').naturalWidth; r.imgBad = document.getElementById('bad').naturalWidth;
  r.style = getComputedStyle(document.getElementById('styled')).color;
  r.lib = window.libLoaded === true;
  try { localStorage.setItem('k', 'v'); r.storage = localStorage.getItem('k'); } catch (e) { r.storage = 'blocked: ' + e.message; }
  r.done = true;
})();
</script>`);
  const page = u(path.join(L, 'site', 'docs', 'page.html'));

  await R.step('a page opened from a file can’t read your other files (fetch, XHR, workers, service workers, frames, images), as in Chrome', async () => {
    await go(page);
    const r = await until(() => t.guest('page.html', 'window.__r && window.__r.done ? JSON.stringify(window.__r) : ""').then((s) => (s ? JSON.parse(s) : null)), 15000, 'the page’s results');
    const leaked = Object.entries(r).filter(([, v]) => /TOP SECRET/.test(String(v))).map(([k]) => k);
    assert(!leaked.length, 'it read the secret through: ' + leaked.join(', ') + ' ' + JSON.stringify(r));
    for (const k of ['fetch', 'fetchSameFolder', 'xhr', 'fileWorker', 'serviceWorker']) assert(/^blocked/.test(String(r[k])), k + ': ' + r[k]);
    assert(r.imgBad === 0, 'an image from elsewhere loaded');
    assert(r.blobWorker === 'its fetch failed', 'a worker from a blob runs (as in Chrome) but can’t read files: ' + r.blobWorker);
    t.__localResults = r;
  });

  await R.step('…while its own site folder’s frames, images, styles and scripts load (from folders above it too), and it keeps local storage', async () => {
    const r = t.__localResults;
    assert(r.frameSame === 'frame text', 'its frame: ' + r.frameSame);
    assert(r.imgOk > 0, 'its image');
    assert(r.style === 'rgb(1, 2, 3)', 'its style sheet: ' + r.style);
    assert(r.lib === true, 'its script');
    assert(r.storage === 'v', 'local storage: ' + r.storage);
    assert(r.web && !/^blocked/.test(String(r.web)), 'a request to a website: ' + r.web);
  });

  await R.step('…and a pop-up it opens becomes a tab it can’t reach into', async () => {
    const got = await t.guest('page.html', `String(window.open(${JSON.stringify(u(path.join(S, 'secret.html')))}, 'p', 'width=300,height=300'))`);
    assert(got === 'null', 'window.open gave it: ' + got);
    await until(() => t.ui((url) => window.__wbTest.state.tabs.some((tb) => tb.url === url || tb.pendingUrl === url), u(path.join(S, 'secret.html'))), 5000, 'the tab');
    const popups = await t.main(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => /secret/.test(w.webContents.getURL())).length);
    assert(popups === 0, 'a pop-up window opened');
  });
} finally {
  x.close();
  await t.close();
  site.stop();
  fs.rmSync(lists, { recursive: true, force: true });
  for (const d of [L, S]) if (d) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
