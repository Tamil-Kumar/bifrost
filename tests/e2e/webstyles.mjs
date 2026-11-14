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
//    offering to install it;
//  · a file made for importing into Stylus (Catppuccin's import.json): its LESS styles built here, Catppuccin's
//    library from Bifrost's copy when it can't be downloaded, the CSS a style @imports put in it, Settings
//    saying how far along it is and which couldn't be built; a LESS style's options changed, and it's rebuilt;
//  · your theme on websites, turned on in Settings: Catppuccin's styles built in Bifrost's theme (Frost: its
//    colors and filters; Catppuccin Macchiato: that flavor), at once in open tabs; kept for the next start
//    (styles-themed.json: nothing built again); off, their own options again.
import http from 'node:http';
import { launch, reporter, assert, sleep, xinput } from './lib.mjs';

const R = reporter('webstyles');
const HOSTS = ['light.test', 'sub.light.test', 'owndark.test', 'halfdark.test', 'styled.test', 'other.test', 'csp.test', 'ctp.test'];
// A Catppuccin style as Catppuccin writes them (its library @imported from userstyles.catppuccin.com, which these
// tests send nowhere: Bifrost's copy has to do), with CSS of another site's @imported too.
const CTP = `/* ==UserStyle==
@name ctp.test Catppuccin
@namespace bifrost.test/catppuccin
@version 2026.11.01
@preprocessor less
@var select darkFlavor "Dark Flavor" ["latte:Latte", "frappe:Frappé", "macchiato:Macchiato", "mocha:Mocha*"]
@var select accentColor "Accent" ["rosewater:Rosewater", "mauve:Mauve*", "red:Red"]
==/UserStyle== */
@import "https://userstyles.catppuccin.com/lib/lib.less";
@-moz-document domain("ctp.test") {
  @import url("http://ctp.test/extra.css");
  :root { #catppuccin(@darkFlavor); }
  #catppuccin(@flavor) {
    #lib.palette();
    --ctp-accent: @accent;
    body { background: @base !important; }
    a { color: fade(@accent, 80%); }
  }
}`;
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
  // Says it has a dark theme, and has only part of one (as Google Classroom: its bar dark, its page white).
  if (host === 'halfdark.test') return send('text/html', page('Half a dark theme', '<meta name="color-scheme" content="light dark"><style>header{height:64px;background:light-dark(#ffffff,#1f1f1f);color:light-dark(#202124,#e8eaed)}</style>', '<header>Bar</header>'));
  if (host === 'csp.test') return send('text/html', page('Strict CSP'), { 'content-security-policy': "style-src 'none'; script-src 'unsafe-inline'" });
  if (req.url.startsWith('/framed')) return send('text/html', page('With a frame', '', '<iframe id=f src="http://other.test/" style="width:300px;height:150px;border:0"></iframe>'));
  if (host === 'ctp.test' && req.url.startsWith('/extra.css')) return send('text/css', 'p { color: rgb(1, 2, 3) !important; }');
  send('text/html', page(host));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const OPTS = {
  profile: 'webstyles',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')},MAP userstyles.catppuccin.com 127.0.0.1:1`],
  env: { HTTP_PROXY: '', http_proxy: '', HTTPS_PROXY: '', https_proxy: '', NO_PROXY: '*', no_proxy: '*' },
  settings: { onboarding: { done: true } },
};
let t = await launch(OPTS);
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
// A dialog that's open (not one on its way out).
const OPEN = '.dialog-layer:not(.closing)';
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

  await R.step('a site whose own dark theme is partly white (as Google Classroom’s): Bifrost darkens it itself, from the start next time; listed in Settings, forgotten there; a site you choose Bifrost’s dark mode for', async () => {
    const half = await open('http://halfdark.test/');
    await front(half);
    // (its bar is dark, its page white: until it's looked at)
    const c = await until(async () => { const c = await pixel(half); return dark(c) ? c : null; }, 9000, 'its page darkened');
    const bar = await t.main(async ({ webContents }, id) => { const b = (await webContents.fromId(id).capturePage({ x: 400, y: 30, width: 1, height: 1 })).toBitmap(); return [b[2], b[1], b[0]]; }, half);
    assert(dark(bar), 'its bar: ' + bar);
    const dir = await t.main(() => global.__bifrost.profile.dir);
    const fs = await import('node:fs');
    await until(() => { try { return /halfdark\.test/.test(fs.readFileSync(dir + '/web-dark-learned.json', 'utf8')); } catch { return false; } }, 3000, 'remembered');
    // Next time: dark from the start.
    const again = await open('http://halfdark.test/again');
    assert(dark(await pixel(again)), 'opened again: ' + (await pixel(again)));
    // Listed in Settings; forgotten there: looked at again (and darkened again).
    await toSettings();
    await settingsPage("document.getElementById('web-dark').scrollIntoView({ block: 'start', behavior: 'instant' })");
    const listed = await until(() => settingsPage("(() => { const l = [...document.querySelectorAll('.dark-learned [data-learned]')].map((e) => e.dataset.learned); return l.length ? l : null; })()"), 3000, 'listed');
    assert(JSON.stringify(listed) === '["halfdark.test"]', 'listed: ' + JSON.stringify(listed));
    await t.shot('webstyles-dark-learned');
    await settingsPage("document.querySelector('.dark-learned [data-learned=\"halfdark.test\"] button').click()");
    await until(() => settingsPage("!document.querySelector('.dark-learned')"), 3000, 'forgotten');
    await until(() => settingsPage("!!document.querySelector('.dark-learned [data-learned]')"), 12000, 'looked at again, and listed again');
    // (a tab is captured only while it's drawn: in front)
    await front(half);
    await sleep(300);
    assert(dark(await pixel(half)), 'darkened again: ' + (await pixel(half)));
    // Your choice for a site: Bifrost's dark mode, though it has a dark theme of its own.
    await front(own);
    await sleep(300);
    const before = await pixel(own);
    assert(before[0] === 0x20 && before[1] === 0x20 && before[2] === 0x30, 'its own dark theme: ' + before);
    await set('webStyles.darkSites', { 'owndark.test': 'bifrost' });
    const after = await until(async () => { const c = await pixel(own); return dark(c) && !(c[0] === 0x20 && c[1] === 0x20 && c[2] === 0x30) ? c : null; }, 5000, 'darkened by Bifrost');
    await toSettings();
    const choice = await until(() => settingsPage("(() => { const r = document.querySelector('.dark-sites .erow[data-site=\"owndark.test\"] select'); return r ? r.value : null; })()"), 3000, 'its choice');
    assert(choice === 'bifrost', 'in Settings: ' + choice);
    await set('webStyles.darkSites', {});
    await front(own);
    await sleep(300);
    await until(async () => { const c = await pixel(own); return c[0] === 0x20 && c[1] === 0x20 && c[2] === 0x30; }, 5000, 'its own again');
    assert(dark(c) && dark(after), JSON.stringify({ c, after }));
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
    await until(() => settingsPage(`!!document.querySelector('${OPEN} .style-var[data-var=bg] input')`), 3000, 'the editor');
    await settingsPage(`(() => { const i = document.querySelector('${OPEN} .style-var[data-var=bg] input'); i.value = '#aa2266'; i.dispatchEvent(new Event('change')); document.querySelector('${OPEN} [data-act=save-style]').click(); })()`);
    await until(async () => (await bg()) === 'rgb(170, 34, 102)', 3000, 'the new color');
    await until(() => settingsPage(`!document.querySelector('${OPEN}')`), 3000, 'the editor closed');
    // A broken edit says why and keeps the editor open.
    await settingsPage("document.querySelector('.ustyle [data-act=edit]').click()");
    await until(() => settingsPage(`!!document.querySelector('${OPEN} .style-code')`), 3000, 'the editor again');
    await settingsPage(`(() => { const t = document.querySelector('${OPEN} .style-code'); t.value = 'body { color: red }'; document.querySelector('${OPEN} [data-act=save-style]').click(); })()`);
    const err = await until(() => settingsPage(`(() => { const e = document.querySelector('${OPEN} .style-error'); return e && !e.hidden ? e.textContent : null; })()`), 3000, 'the error');
    assert(/no ==UserStyle== header/.test(err), 'error: ' + err);
    await settingsPage(`[...document.querySelectorAll('${OPEN} .style-editor .btn')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    await until(() => settingsPage(`!document.querySelector('${OPEN}')`), 3000, 'the editor closed');
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
    assert(/Edit/.test(list[0]) && !/built by Stylus/.test(list[0]), 'a LESS one can be edited (and rebuilt) here: ' + list[0]);
    // A .user.css link.
    const tab = await open('http://styled.test/green.user.css');
    const toast = await until(() => t.ui(() => { const e = [...document.querySelectorAll('.toast')].find((x) => /Green test/.test(x.textContent)); return e ? e.textContent : null; }), 6000, 'the offer');
    assert(/Green test 1\.0\.1 is a userstyle for styled\.test, csp\.test/.test(toast) && /Install/.test(toast), 'offer: ' + toast);
    await t.ui(() => [...document.querySelectorAll('.toast button')].find((b) => b.textContent.trim() === 'Install').click());
    await until(() => t.main(() => global.__bifrost.webStyles.styles.some((s) => s.name === 'Green test')), 5000, 'installed');
    assert(tab, 'tab');
    await t.shot('webstyles-styles');
  });

  await R.step('a file for importing into Stylus (Catppuccin’s): its LESS styles built here (Catppuccin’s library from Bifrost’s copy), the CSS they import put in, how far along and what failed said; a LESS style’s options changed, rebuilt', async () => {
    const entry = (code, extra = {}) => ({ enabled: true, name: /@name (.*)/.exec(code)[1], updateUrl: '', sourceCode: code, originalDigest: 'x', ...extra });
    const broken = CTP.replace('@name ctp.test Catppuccin', '@name Broken Catppuccin').replace('@namespace bifrost.test/catppuccin', '@namespace bifrost.test/broken').replace('background: @base', 'background: @nope');
    const file = JSON.stringify([{ settings: { updateInterval: 24 } }, entry(CTP), entry(broken)]);
    await toSettings();
    await settingsPage("document.getElementById('user-styles').scrollIntoView({ block: 'start', behavior: 'instant' })");
    // Picked in Settings' file box, as you would.
    await settingsPage(`(() => {
      window.__progress = [];
      wb.on('styles-progress', (p) => window.__progress.push(p.done + '/' + p.total));
      const input = document.querySelector('.ustyles input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(file)}], 'import.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    const failedDialog = `[...document.querySelectorAll('${OPEN} .dialog')].find((d) => /couldn’t be built/.test(d.textContent))`;
    const failed = await until(() => settingsPage(`(() => { const d = ${failedDialog}; return d ? d.textContent : null; })()`), 20000, 'the styles that couldn’t be built');
    assert(/1 of the styles couldn’t be built/.test(failed) && /Broken Catppuccin/.test(failed) && /variable @nope is undefined \(line 16\)/.test(failed), 'said: ' + failed);
    await settingsPage(`[...${failedDialog}.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'OK').click()`);
    const progress = await settingsPage('window.__progress');
    assert(JSON.stringify(progress) === '["0/2","1/2","2/2"]', 'how far along: ' + JSON.stringify(progress));
    const s = await t.main(() => { const s = global.__bifrost.webStyles.styles.find((x) => x.name === 'ctp.test Catppuccin'); return s && { sections: s.sections.length, code: s.sections[0].code, domains: s.sections[0].domains }; });
    assert(s && s.sections === 1 && JSON.stringify(s.domains) === '["ctp.test"]' && /p \{ color: rgb\(1, 2, 3\) !important; \}/.test(s.code) && !/@import/.test(s.code), 'built: ' + JSON.stringify(s).slice(0, 400));
    const ctp = await open('http://ctp.test/');
    const looks = () => inTab(ctp, "[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('p')).color, getComputedStyle(document.documentElement).getPropertyValue('--ctp-accent').trim()].join(' | ')");
    assert((await looks()) === 'rgb(30, 30, 46) | rgb(1, 2, 3) | #cba6f7', 'on the page (Mocha, mauve; the imported CSS): ' + (await looks()));
    // Its options, changed in the editor: built again.
    await toSettings();
    const row = await until(() => settingsPage("(() => { const r = [...document.querySelectorAll('.ustyle')].find((e) => /ctp\\.test Catppuccin/.test(e.textContent)); if (!r) return null; r.querySelector('[data-act=edit]').click(); return r.textContent; })()"), 3000, 'its row');
    assert(/ctp\.test Catppuccin/.test(row), 'row: ' + row);
    await until(() => settingsPage(`!!document.querySelector('${OPEN} .style-var[data-var=darkFlavor] select')`), 3000, 'its options');
    await settingsPage(`(() => { const f = document.querySelector('${OPEN} .style-var[data-var=darkFlavor] select'); f.value = 'latte'; f.dispatchEvent(new Event('change')); const a = document.querySelector('${OPEN} .style-var[data-var=accentColor] select'); a.value = 'red'; a.dispatchEvent(new Event('change')); document.querySelector('${OPEN} [data-act=save-style]').click(); })()`);
    await until(async () => (await looks()) === 'rgb(239, 241, 245) | rgb(1, 2, 3) | #d20f39', 8000, 'Latte with red');
    await until(() => settingsPage(`!document.querySelector('${OPEN}')`), 3000, 'the editor closed');
    await t.shot('webstyles-catppuccin');
  });

  await R.step('your theme on websites: Catppuccin’s styles in Bifrost’s theme (Frost: its colors; Macchiato: that flavor), at once in open tabs, the style’s own accent kept', async () => {
    const ctp = await until(() => t.main(({ webContents }) => { const w = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && /^http:\/\/ctp\.test\//.test(w.getURL())); return w ? w.id : null; }), 3000, 'the ctp.test tab');
    const looks = () => inTab(ctp, "[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--ctp-accent').trim()].join(' | ')");
    assert((await looks()) === 'rgb(239, 241, 245) | #d20f39', 'before (its own options, Latte and red): ' + (await looks()));
    await set('appearance.theme', 'frost');
    await toSettings();
    await settingsPage("document.getElementById('web-theme').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await sleep(300);
    await clickIn(settingsId, '[data-path="webStyles.matchTheme"] .switch');
    await until(async () => (await get('webStyles.matchTheme')) === true, 3000, 'on');
    // Frost's base, and its red for the red accent the style was given.
    await until(async () => (await looks()) === 'rgb(14, 28, 51) | #ff7a93', 10000, 'Frost on ctp.test');
    const status = await until(() => settingsPage("(() => { const e = document.querySelector('.theme-match'); return e && /1 of Catppuccin’s 1 style in your theme/.test(e.textContent) ? e.textContent : null; })()"), 5000, 'Settings saying so');
    assert(/Catppuccin’s styles/.test(status), 'status: ' + status);
    await t.shot('webstyles-theme-settings');
    // Catppuccin's own flavor for a Catppuccin theme.
    await set('appearance.theme', 'macchiato');
    await until(async () => (await looks()) === 'rgb(36, 39, 58) | #ed8796', 10000, 'Macchiato on ctp.test');
    const kept = await t.main(() => { const s = global.__bifrost.webStyles.styles.find((x) => x.name === 'ctp.test Catppuccin'); return JSON.stringify([s.values, !!s.themed]); });
    assert(kept === '[{"darkFlavor":"latte","accentColor":"red"},true]', 'its own options kept: ' + kept);
    await front(ctp);
    await sleep(300);
    await t.shot('webstyles-theme');
  });

  await R.step('…kept for the next start: pages in your theme from the start, nothing built again; off, the style’s own options again', async () => {
    await until(() => t.main(() => { const ws = global.__bifrost.webStyles; return !ws.theming && !ws.dirty && !ws.themedDirty && !ws.writing; }), 5000, 'saved');
    const dir = await t.main(() => global.__bifrost.profile.dir);
    await t.close();
    t = await launch({ ...OPTS, fresh: false });
    const st = await t.main(() => { const ws = global.__bifrost.webStyles; ws.__built = 0; const b = ws.buildThemed.bind(ws); ws.buildThemed = (...a) => { ws.__built++; return b(...a); }; return JSON.stringify([ws.themeStatus().ready, ws.cssFor('http://ctp.test/').includes('#24273a')]); });
    assert(st === '[1,true]', 'at the start (in your theme, Macchiato): ' + st);
    const ctp = await open('http://ctp.test/');
    const looks = () => inTab(ctp, "[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--ctp-accent').trim()].join(' | ')");
    assert((await looks()) === 'rgb(36, 39, 58) | #ed8796', 'on the page: ' + (await looks()));
    await sleep(3500);
    const built = await t.main(() => global.__bifrost.webStyles.__built);
    assert(built === 0, 'built again: ' + built);
    // (your styles' file as it was: their builds in your theme are kept on their own)
    const fs = await import('node:fs');
    const kept = JSON.parse(fs.readFileSync(dir + '/styles.json', 'utf8')).styles;
    const themed = JSON.parse(fs.readFileSync(dir + '/styles-themed.json', 'utf8')).styles;
    assert(kept.length && !kept.some((s) => s.themed) && Object.keys(themed).length === 1, 'styles.json and styles-themed.json: ' + JSON.stringify([kept.length, kept.some((s) => s.themed), Object.keys(themed).length]));
    // Off: its own options again.
    await set('webStyles.matchTheme', false);
    await until(async () => (await looks()) === 'rgb(239, 241, 245) | #d20f39', 8000, 'its own colors again');
    await set('appearance.theme', 'mocha');
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
