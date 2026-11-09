// How websites look (src/main/web-styles.js, src/main/web-theme.js, the tab preload's styles), against local
// stand-in sites (pointed at a local server with --host-resolver-rules):
//  · dark mode for every website, turned on in Settings: open tabs darkened at once, a site with a dark theme
//    of its own using it, the color read off the screen;
//  · per site: Alt+Shift+A on the site you're on (its subdomains too), the info popover's switch, Settings'
//    list; Alt+Shift+D for every site; brightness, contrast and sepia over it, on the top page only;
//  · your styles: installed from a link in Settings (variables filled in), there from the page's first paint,
//    only on its site, through a Content-Security-Policy that forbids styles; off and on, edited (a variable),
//    deleted, all at once in open tabs; listed in the site info popover with a switch;
//  · a Stylus backup brought in (the CSS Stylus built, LESS ones too); a .user.css link opened in a tab
//    offering to install it.
import http from 'node:http';
import { launch, reporter, assert, sleep, xinput } from './lib.mjs';

const R = reporter('webstyles');
const HOSTS = ['light.test', 'sub.light.test', 'owndark.test', 'styled.test', 'other.test', 'csp.test'];
// A page that writes down, from a script at the top of its head, what its root looked like before anything
// of its own was drawn (a style there from the first paint already shows in it).
const page = (title, extra = '', body = '') => `<!doctype html><html><head><meta charset=utf-8><title>${title}</title>
<script>window.__first = getComputedStyle(document.documentElement).getPropertyValue('--styled').trim() + '|' + getComputedStyle(document.documentElement).backgroundColor;</script>
${extra}<style>html,body{margin:0;height:100%} body{background:#ffffff;color:#000000;font:18px sans-serif}</style></head>
<body><p style="padding:20px">${title}</p>${body}</body></html>`;
const STYLE = (color) => `/* ==UserStyle==
@name Styled test
@namespace bifrost.test
@version 1.0.${color === '#3355ff' ? '0' : '1'}
@description For the tests
@var color bg "Background" ${color}
==/UserStyle== */
@-moz-document domain("styled.test"), domain("csp.test") {
  :root { --styled: yes; background: var(--bg) !important; }
  body { background: var(--bg) !important; }
}`;
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const send = (type, body, headers = {}) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };
  if (req.url.startsWith('/blue.user.css')) return send('text/css', STYLE('#3355ff'));
  if (req.url.startsWith('/green.user.css')) return send('text/css', STYLE('#22aa44').replace('@name Styled test', '@name Green test').replace('@namespace bifrost.test', '@namespace bifrost.green'));
  if (host === 'owndark.test') return send('text/html', page('Own dark theme', '<meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme: dark){body{background:#202030 !important;color:#eeeeee !important}}</style>'));
  if (host === 'csp.test') return send('text/html', page('Strict CSP'), { 'content-security-policy': "style-src 'none'; script-src 'unsafe-inline'" });
  if (req.url.startsWith('/framed')) return send('text/html', page('With a frame', '', '<iframe id=f src="http://other.test/" style="width:300px;height:150px;border:0"></iframe>'));
  send('text/html', page(host));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const t = await launch({
  profile: 'webstyles',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`],
  env: { HTTP_PROXY: '', http_proxy: '', HTTPS_PROXY: '', https_proxy: '', NO_PROXY: '*', no_proxy: '*' },
  settings: { onboarding: { done: true } },
});
const x = xinput();
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 300) + ')' : ''));
};
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const get = (p) => t.main((_, p) => global.__bifrost.settings.get(p), p);
const ctl = () => 'global.__bifrost.registry.list().find((c) => !c.isPrivate)';
let n = 0;
// Opens url in a new tab in front; its webContents id once loaded.
const open = async (url) => {
  const k = ++n;
  const full = url + (url.includes('?') ? '&' : '?') + 'n=' + k;
  await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), full);
  return until(() => t.main(({ webContents }, full) => { const w = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL() === full); return w && !w.isLoading() ? w.id : null; }, full), 10000, 'the page ' + full);
};
const inTab = (id, js) => t.main(({ webContents }, [id, js]) => webContents.fromId(id).executeJavaScript(js, true), [id, js]);
// The color on screen in the middle of a tab's page (BGRA from the capture).
const pixel = (id) => t.main(async ({ webContents }, id) => {
  const w = webContents.fromId(id);
  const img = await w.capturePage({ x: 200, y: 200, width: 1, height: 1 });
  const b = img.toBitmap();
  return [b[2], b[1], b[0]];
}, id);
const dark = (c) => c[0] < 60 && c[1] < 60 && c[2] < 70;
const white = (c) => c[0] > 240 && c[1] > 240 && c[2] > 240;
const front = (id) => t.main((_, id) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('focus-wc', id), id);
const settingsPage = (js) => t.guest('bifrost://settings', js);
const toSettings = async () => {
  await t.main(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings'));
    global.__bifrost.registry.list().find((c) => !c.isPrivate).send('focus-wc', wc.id);
  });
  await sleep(400);
};
const keys = async (...names) => { for (const k of names.slice(0, -1)) await x.keyDown(k); await x.key(names[names.length - 1]); for (const k of names.slice(0, -1).reverse()) await x.keyUp(k); };
// Clicks a guest page's element for real: the pointer to where it is on screen.
const clickIn = async (id, sel) => {
  const p = await until(() => inTab(id, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`), 5000, sel);
  const v = await t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => e.getBoundingClientRect().width > 50 && getComputedStyle(e).visibility !== 'hidden'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await x.click(v.x + p.x, v.y + p.y);
};

try {
  let light, own, settingsId;
  await R.step('dark mode for every website, turned on in Settings: open tabs darkened at once, a site with its own dark theme uses it', async () => {
    light = await open('http://light.test/');
    own = await open('http://owndark.test/');
    await front(light);
    await sleep(400);
    assert(white(await pixel(light)), 'before: ' + (await pixel(light)));
    await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), 'bifrost://settings/#web-dark');
    settingsId = await until(() => t.main(({ webContents }) => { const w = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')); return w && !w.isLoading() ? w.id : null; }), 8000, 'Settings');
    await until(() => settingsPage("!!document.querySelector('[data-path=\"webStyles.dark\"] input')"), 8000, 'the switch');
    await sleep(600);
    await clickIn(settingsId, '[data-path="webStyles.dark"] .switch');
    await until(async () => (await get('webStyles.dark')) === true, 3000, 'dark mode on');
    await front(light);
    const c = await until(async () => { const c = await pixel(light); return dark(c) ? c : null; }, 5000, 'the light page darkened');
    await front(own);
    const o = await until(async () => { const c = await pixel(own); return c[0] === 0x20 && c[1] === 0x20 && c[2] === 0x30 ? c : null; }, 5000, 'its own dark theme');
    assert(dark(c) && o, JSON.stringify({ c, o }));
    await t.shot('webstyles-dark');
  });

  await R.step('per site: Alt+Shift+A for the site you’re on (and its subdomains), the info popover’s switch, Settings’ list; Alt+Shift+D for every site', async () => {
    await front(light);
    await sleep(300);
    await clickIn(light, 'p');
    await keys('Alt_L', 'Shift_L', 'a');
    await until(async () => JSON.stringify(await get('webStyles.darkSites')) === '{"light.test":false}', 3000, 'light.test off');
    await until(async () => white(await pixel(light)), 5000, 'light.test as drawn');
    const sub = await open('http://sub.light.test/');
    assert(white(await pixel(sub)), 'its subdomain: ' + (await pixel(sub)));
    const other = await open('http://other.test/');
    assert(dark(await pixel(other)), 'another site: ' + (await pixel(other)));
    // The info popover's switch, on light.test.
    await front(light);
    await sleep(300);
    await t.ui(() => document.getElementById('site-btn').click());
    const row = await until(() => t.ui(() => { const r = document.querySelector('.si-pop [data-row=dark]'); return r ? r.textContent : null; }), 3000, 'the dark mode row');
    assert(/Dark mode/.test(row) && /As the site draws it/.test(row), 'the row: ' + row);
    await t.ui(() => document.querySelector('.si-pop [data-row=dark] input').click());
    await until(async () => JSON.stringify(await get('webStyles.darkSites')) === '{}', 3000, 'its own setting gone (the same as every site’s)');
    await until(async () => dark(await pixel(light)), 5000, 'light.test dark again');
    await t.ui(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    // Settings' list.
    await set('webStyles.darkSites', { 'light.test': false, 'example.org': true });
    await toSettings();
    const listed = await until(() => settingsPage("(() => { const r = [...document.querySelectorAll('.dark-sites .erow[data-site]')]; return r.length === 2 ? r.map((e) => e.dataset.site + '=' + e.querySelector('select').value) : null; })()"), 3000, 'the list');
    assert(JSON.stringify(listed) === '["example.org=on","light.test=off"]', 'listed: ' + JSON.stringify(listed));
    await set('webStyles.darkSites', {});
    // Alt+Shift+D: every site.
    await front(other);
    await sleep(300);
    await clickIn(other, 'p');
    await keys('Alt_L', 'Shift_L', 'd');
    await until(async () => (await get('webStyles.dark')) === false, 3000, 'dark mode off everywhere');
    await until(async () => white(await pixel(other)), 5000, 'other.test as drawn');
    await keys('Alt_L', 'Shift_L', 'd');
    await until(async () => (await get('webStyles.dark')) === true, 3000, 'and on again');
  });

  await R.step('brightness, contrast and sepia over dark mode, on the top page only', async () => {
    const framed = await open('http://light.test/framed');
    await set('webStyles.brightness', 80);
    await set('webStyles.sepia', 20);
    const top = await until(async () => { const f = await inTab(framed, 'getComputedStyle(document.documentElement).filter'); return f !== 'none' ? f : null; }, 3000, 'the filter');
    assert(top === 'brightness(0.8) sepia(0.2)', 'top page: ' + top);
    const inFrame = await t.main(({ webContents }, id) => { const w = webContents.fromId(id); const f = w.mainFrame.frames[0]; return f.executeJavaScript('getComputedStyle(document.documentElement).filter'); }, framed);
    assert(inFrame === 'none', 'in its frame: ' + inFrame);
    await set('webStyles.brightness', 100);
    await set('webStyles.sepia', 0);
    await until(async () => (await inTab(framed, 'getComputedStyle(document.documentElement).filter')) === 'none', 3000, 'the filter gone');
    await set('webStyles.dark', false);
  });

  let styled, csp;
  await R.step('your styles: installed from a link in Settings, there from the first paint, only on its sites, through a CSP that forbids styles', async () => {
    await toSettings();
    await settingsPage("document.getElementById('user-styles').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await settingsPage("document.querySelector('[data-act=install-link]').click()");
    await until(() => settingsPage("!!document.querySelector('.dialog input')"), 3000, 'the link box');
    await settingsPage(`(() => { const i = document.querySelector('.dialog input'); i.value = 'http://styled.test/blue.user.css'; i.dispatchEvent(new Event('input')); [...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Next').click(); })()`);
    const q = await until(() => settingsPage("(() => { const d = document.querySelector('.dialog'); return d && /Install Styled test/.test(d.textContent) ? d.textContent : null; })()"), 5000, 'the question');
    assert(/Install Styled test 1\.0\.0\?/.test(q) && /For styled\.test, csp\.test\./.test(q), 'it asks: ' + q);
    await settingsPage("[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Install').click()");
    const listed = await until(() => settingsPage("(() => { const r = document.querySelector('.ustyle'); return r ? r.textContent : null; })()"), 5000, 'the style listed');
    assert(/Styled test 1\.0\.0/.test(listed) && /styled\.test, csp\.test/.test(listed), 'listed: ' + listed);
    styled = await open('http://styled.test/');
    const first = await inTab(styled, 'window.__first');
    assert(first === 'yes|rgb(51, 85, 255)', 'at its first script: ' + first);
    await front(styled);
    await sleep(300);
    const c = await pixel(styled);
    assert(c[0] === 0x33 && c[1] === 0x55 && c[2] === 0xff, 'on screen: ' + c);
    const other = await open('http://other.test/');
    assert((await inTab(other, 'window.__first')) === '|rgba(0, 0, 0, 0)', 'another site: ' + (await inTab(other, 'window.__first')));
    csp = await open('http://csp.test/');
    assert((await inTab(csp, 'getComputedStyle(document.body).backgroundColor')) === 'rgb(51, 85, 255)', 'through the CSP: ' + (await inTab(csp, 'getComputedStyle(document.body).backgroundColor')));
  });

  await R.step('…off and on, edited (its variable), listed in the site info popover with a switch, deleted: all at once in open tabs', async () => {
    const bg = () => inTab(styled, 'getComputedStyle(document.body).backgroundColor');
    await toSettings();
    await settingsPage("document.querySelector('.ustyle .switch input').click()");
    await until(async () => (await bg()) === 'rgb(255, 255, 255)', 3000, 'off');
    await settingsPage("document.querySelector('.ustyle .switch input').click()");
    await until(async () => (await bg()) === 'rgb(51, 85, 255)', 3000, 'on');
    // The editor: its variable.
    await settingsPage("document.querySelector('.ustyle [data-act=edit]').click()");
    await until(() => settingsPage("!!document.querySelector('.style-var[data-var=bg] input')"), 3000, 'the editor');
    await settingsPage("(() => { const i = document.querySelector('.style-var[data-var=bg] input'); i.value = '#aa2266'; i.dispatchEvent(new Event('change')); document.querySelector('[data-act=save-style]').click(); })()");
    await until(async () => (await bg()) === 'rgb(170, 34, 102)', 3000, 'the new color');
    // A broken edit says why and keeps the editor open.
    await settingsPage("document.querySelector('.ustyle [data-act=edit]').click()");
    await until(() => settingsPage("!!document.querySelector('.style-code')"), 3000, 'the editor again');
    await settingsPage("(() => { const t = document.querySelector('.style-code'); t.value = 'body { color: red }'; document.querySelector('[data-act=save-style]').click(); })()");
    const err = await until(() => settingsPage("(() => { const e = document.querySelector('.style-error'); return e && !e.hidden ? e.textContent : null; })()"), 3000, 'the error');
    assert(/no ==UserStyle== header/.test(err), 'error: ' + err);
    await settingsPage("[...document.querySelectorAll('.style-editor .btn')].find((b) => b.textContent.trim() === 'Cancel').click()");
    // The site info popover.
    await front(styled);
    await sleep(300);
    await t.ui(() => document.getElementById('site-btn').click());
    const row = await until(() => t.ui(() => { const r = document.querySelector('.si-pop [data-style]'); return r ? r.textContent : null; }), 3000, 'the style in the popover');
    assert(/Styled test/.test(row), 'popover: ' + row);
    await t.ui(() => document.querySelector('.si-pop [data-style] input').click());
    await until(async () => (await bg()) === 'rgb(255, 255, 255)', 3000, 'off from the popover');
    await t.ui(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    // Deleted.
    await toSettings();
    await settingsPage("document.querySelector('.ustyle [data-act=delete]').click()");
    await until(() => settingsPage("!!document.querySelector('.dialog')"), 3000, 'the question');
    await settingsPage("[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Delete').click()");
    await until(() => settingsPage("!document.querySelector('.ustyle')"), 3000, 'gone from the list');
    assert((await t.main(() => global.__bifrost.webStyles.styles.length)) === 0, 'still kept');
  });

  await R.step('a Stylus backup brought in (the CSS Stylus built, a LESS one too, on or off); a .user.css link opened in a tab offers to install it', async () => {
    const backup = JSON.stringify([
      { settings: { updateInterval: 24 } },
      { enabled: true, name: 'Catppuccin for styled.test', sourceCode: '/* ==UserStyle==\n@name Catppuccin for styled.test\n@preprocessor less\n==/UserStyle== */', usercssData: { name: 'Catppuccin for styled.test', namespace: 'ctp', version: '2026.1.1', preprocessor: 'less', vars: {} },
        sections: [{ code: 'body { background: #1e1e2e !important; }', domains: ['styled.test'], urls: [], urlPrefixes: [], regexps: [] }] },
      { enabled: false, name: 'Off one', sections: [{ code: 'body { background: red !important; }', urlPrefixes: ['http://other.test/'] }] },
    ]);
    await toSettings();
    const r = await settingsPage(`wb.invoke('styles:import-stylus', ${JSON.stringify(backup)})`);
    assert(r.added === 2, 'imported: ' + JSON.stringify(r));
    await until(async () => (await inTab(styled, 'getComputedStyle(document.body).backgroundColor')) === 'rgb(30, 30, 46)', 3000, 'the Stylus-built CSS applied');
    const list = await until(() => settingsPage("(() => { const r = [...document.querySelectorAll('.ustyle')]; return r.length === 2 ? r.map((e) => e.textContent) : null; })()"), 3000, 'listed');
    assert(/built by Stylus/.test(list[0]) && !/Edit/.test(list[0]), 'a LESS one is kept as Stylus built it: ' + list[0]);
    // A .user.css link.
    const tab = await open('http://styled.test/green.user.css');
    const toast = await until(() => t.ui(() => { const e = [...document.querySelectorAll('.toast')].find((x) => /Green test/.test(x.textContent)); return e ? e.textContent : null; }), 6000, 'the offer');
    assert(/Green test 1\.0\.1 is a userstyle for styled\.test, csp\.test/.test(toast) && /Install/.test(toast), 'offer: ' + toast);
    await t.ui(() => [...document.querySelectorAll('.toast button')].find((b) => b.textContent.trim() === 'Install').click());
    await until(() => t.main(() => global.__bifrost.webStyles.styles.some((s) => s.name === 'Green test')), 5000, 'installed');
    assert(tab, 'tab');
    await t.shot('webstyles-styles');
  });

  await R.step('nothing on the pages broke', async () => {
    const errs = (await t.pageLogs()).filter((l) => /pageerror/.test(l));
    assert(!errs.length, errs.join('\n'));
  });
} finally {
  const errs = t.logs.filter((l) => /Uncaught|TypeError|\[styles\]/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log:\n  ' + errs.join('\n  '));
  x.close();
  await t.close();
  server.close();
}
process.exit(R.summary() ? 1 : 0);
