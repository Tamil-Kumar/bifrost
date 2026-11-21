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
//    (styles-themed.json: nothing built again); off, their own options again;
//  · Catppuccin for every site (src/preload/recolor.js), turned on in Settings: a light page that none of your
//    styles is for in Catppuccin's colors, at once and from its first paint (its backgrounds, text, links, lines;
//    its variables, as Bootstrap, shadcn and Tailwind write them; style="", bgcolor, SVG fill; another site's
//    stylesheet; styles its scripts add; a web component's shadow root; a frame, and one it writes itself, as a
//    rich text editor does), each color what Bifrost's color
//    work makes it (tested on its own: tests/unit/recolor.test.mjs); your style for the site over it; a page a
//    style of yours is for left to that style; off for a site in its info popover; in your theme's colors while
//    websites match it (Frost, Latte), Latte for websites told they're light; off, the site's own colors again.
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { launch, reporter, assert, sleep, xinput } from './lib.mjs';

const R = reporter('webstyles');
const HOSTS = ['light.test', 'sub.light.test', 'owndark.test', 'halfdark.test', 'styled.test', 'other.test', 'csp.test', 'ctp.test', 'stylus2.test', 'paint.test', 'cdn.test', 'gsite.test', 'gstatic.test', 'gframe.test'];
const CORE = createRequire(import.meta.url)('../../src/preload/recolor.js');
const CAT = createRequire(import.meta.url)('../../src/shared/catppuccin.js');
const THEMES = createRequire(import.meta.url)('../../src/shared/themes.js');
// A light page as sites write them now (for Catppuccin for every site): variables, Bootstrap's numbers in one,
// shadcn's, Tailwind's, style="", bgcolor, an SVG's fill, another site's stylesheet (through a redirect), a rule its
// script adds, a web component, a frame, and a frame it writes itself; letters with a gradient on them, and a
// select whose arrow is an SVG written into the stylesheet (as Bootstrap's is). Its first script writes down its background before anything of its own was drawn.
const PAINT = `<!doctype html><html><head><meta charset=utf-8><title>Paint</title>
<script>window.__first = getComputedStyle(document.documentElement).backgroundColor;</script>
<link rel=stylesheet href="http://cdn.test/r.css">
<style>
:root { --canvas: #ffffff; --fg: #1f2328; --accent: #0969da; --border: #d1d9e0; --bs-body-bg-rgb: 255, 255, 255; --background: 0 0% 100%; }
body { margin: 0; font: 16px/1.5 sans-serif; background: var(--canvas); color: var(--fg); }
header { background: #f6f8fa; border-bottom: 1px solid var(--border); padding: 12px 20px; }
a { color: var(--accent); }
.err { color: #d1242f; }
.btn { background: #1f883d; color: #fff; border: 0; padding: 6px 14px; }
.alert { background: #ddf4ff; color: #0550ae; padding: 10px; }
.bs { background: rgba(var(--bs-body-bg-rgb), 1); border: 1px solid #dee2e6; }
.shad { background: hsl(var(--background)); }
.tw { --tw-bg-opacity: 1; background-color: rgb(243 244 246 / var(--tw-bg-opacity)); }
.gt { background: linear-gradient(90deg, #ff0080, #7928ca); -webkit-background-clip: text; background-clip: text; color: transparent; }
.form-select { appearance: none; background: #fff url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23343a40' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e") no-repeat right 8px center / 16px 12px; border: 1px solid #dee2e6; padding: 4px 32px 4px 8px; }
</style></head><body>
<header id=hd>Header</header>
<main style="padding:20px">
<p id=tx>Text <a id=ln href="#">a link</a> <span class=err id=er>error</span></p>
<button class=btn id=bt>Button</button>
<div class=alert id=al>Alert</div>
<div class=bs id=bs>Bootstrap</div><div class=shad id=sh>shadcn</div><div class=tw id=tw>Tailwind</div>
<h2 class=gt id=gt>Gradient letters</h2>
<select id=se class=form-select><option>A select, its arrow drawn in SVG</option></select>
<div class=xo id=xo>Another site's stylesheet</div>
<div id=in style="background:#ffeeee;color:#990000">style=""</div>
<table><tr><td bgcolor="#ff6600" id=td>bgcolor</td></tr></table>
<svg width=20 height=20><path id=sv fill="#000" d="M0 0h20v20H0z"/></svg>
<div id=js>CSS-in-JS</div>
<x-card id=wc></x-card>
<iframe id=fr src="http://paint.test/frame" style="width:300px;height:60px"></iframe>
<iframe id=ed style="width:300px;height:60px"></iframe>
</main>
<script>
const ed = document.getElementById('ed').contentDocument;
ed.open(); ed.write('<!doctype html><style>body{background:#ffffff;color:#000000}</style><body contenteditable>A rich text editor</body>'); ed.close();
const st = document.createElement('style'); document.head.append(st);
st.sheet.insertRule('#js { background: #fdecea; color: #611a15; }');
customElements.define('x-card', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<style>p { background: #e7f5ff; color: #1864ab; margin: 0 }</style><p>In a shadow root</p>'; } });
</script></body></html>`;
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
// A LESS style with an option (for Stylus 2's backup, which saves such a style without the CSS it built).
const STYLUS2 = `/* ==UserStyle==
@name Stylus 2 test
@namespace bifrost.test/stylus2
@version 1.0.0
@preprocessor less
@var select tone "Tone" ["dark:Dark*", "light:Light"]
==/UserStyle== */
@-moz-document domain("stylus2.test") {
  body when (@tone = dark) { background: #101820 !important; }
  body when (@tone = light) { background: #f0f4f8 !important; }
}`;
// A page built the way Google builds theirs (for dark mode and Catppuccin for every site): icons as black glyphs
// in pictures from another site (a sprite as a background, <img>s: a PNG, an SVG), icons drawn as masks over
// their background-color (in the same rule, and in another), a logo (a colored PNG, an inline SVG in Google's
// four colors), a photo, a file icon in one color with white on it, a banner with white letters over a picture,
// a page drawn on a canvas (white paper, as Docs did, and black ink on nothing, as it does), a frame from
// another site, and white letters on a strong blue.
// (pictures: PNGs made here, RGBA)
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PICS = {
  '/icon.png': png(24, 24, (x, y) => ((y > 5 && y < 9) || (y > 11 && y < 14) || (y > 16 && y < 19) ? [0, 0, 0, 255] : [0, 0, 0, 0])),
  '/logo.png': png(60, 20, (x) => (x < 15 ? [66, 133, 244, 255] : x < 30 ? [234, 67, 53, 255] : x < 45 ? [251, 188, 5, 255] : [52, 168, 83, 255]).map((v, i) => (i === 3 && x % 15 > 11 ? 0 : v))),
  '/photo.png': png(60, 40, (x, y) => [120 + x * 2, 80 + y * 3, 200 - x, 255]),
  '/banner.png': png(400, 100, (x, y) => [25 + (x % 40), 90 + (y % 30), 200, 255]),
};
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 5h18v3H3zm0 6h18v3H3zm0 6h18v3H3z"/></svg>';
const GSITE = `<!doctype html><html><head><meta charset=utf-8><title>Google-like</title><style>
body { margin: 0; background: #f8fafd; color: #1f1f1f; font: 14px sans-serif; }
.ic { width: 24px; height: 24px; background: url(http://gstatic.test/icon.png) no-repeat; display: inline-block; }
.mi { width: 24px; height: 24px; -webkit-mask: url(http://gstatic.test/icon.svg) center / 24px no-repeat; background-color: #444746; display: inline-block; }
.m2 { width: 24px; height: 24px; -webkit-mask: url(http://gstatic.test/icon.svg) center / 24px no-repeat; display: inline-block; }
#mask2 { background-color: #444746; }
.banner { width: 400px; height: 100px; background: url(/banner.png) center / cover; position: relative; }
.banner h1 { position: absolute; left: 16px; bottom: 8px; margin: 0; color: #fff; font-size: 26px; }
.chip { background: #1a73e8; color: #fff; padding: 4px 10px; }
canvas, iframe { display: block; margin: 8px 0; }
/* SpeechDrop's file cards: a page icon in the header's corner, the file's name over the header in black */
.fh { width: 220px; height: 149px; background: #fff url(http://gstatic.test/icon.svg) no-repeat right bottom; background-size: 100px 95px; }
.fh > h3 { margin: 0; color: black; }
/* a picture its own size, all of the element */
.b2 { width: 400px; height: 100px; background: url(/banner.png) no-repeat; }
.b2 h2 { margin: 0; color: #fff; }
</style></head><body>
<div style="padding:8px"><span class=ic id=sprite></span> <img id=pic src="http://gstatic.test/icon.png" width=24 height=24> <img id=svgimg src="http://gstatic.test/icon.svg" width=24 height=24>
<img id=logo src="http://gstatic.test/logo.png" width=60 height=20> <img id=photo src="http://gstatic.test/photo.png" width=60 height=40>
<span class=mi id=mask></span> <span class=m2 id=mask2></span> <span class=mi id=mask3>&nbsp;</span>
<svg id=glogo width=60 height=20 viewBox="0 0 60 20"><rect width=15 height=20 fill="#4285F4"/><rect x=15 width=15 height=20 fill="#EA4335"/><rect x=30 width=15 height=20 fill="#FBBC05"/><rect x=45 width=15 height=20 fill="#34A853"/></svg>
<svg id=duo width=20 height=20 viewBox="0 0 20 20"><rect width=20 height=20 rx=2 fill="#4285f4"/><rect id=duoline x=4 y=8 width=12 height=3 fill="#fff"/></svg>
<span class=chip id=chip>Joined</span></div>
<div style="display:flex;flex-wrap:wrap;gap:0 12px;align-items:flex-start;max-width:1000px">
<div class=banner id=banner><h1 id=bt>CS 37300 Data Mining</h1></div>
<div class=b2 id=b2><h2 id=b2t>Unit 3: Stoichiometry</h2></div>
<canvas id=paper width=400 height=160></canvas>
<canvas id=ink width=400 height=160></canvas>
<canvas id=sheet width=400 height=160></canvas>
<div class=fh id=fh><h3 id=fht>Aff 1AC - Round 3.docx</h3></div>
<iframe id=xf src="http://gframe.test/" style="width:300px;height:80px;border:0"></iframe>
</div>
<script>
for (const [id, white] of [['paper', true], ['ink', false]]) {
  const c = document.getElementById(id).getContext('2d');
  if (white) { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 400, 160); }
  c.fillStyle = '#000000'; c.font = 'bold 22px sans-serif';
  for (let i = 0; i < 5; i++) c.fillText('Lab report: titration, page ' + (i + 1), 10, 28 + i * 28);
}
// (as Sheets draws its grid: a canvas with no see-through, black where it isn't drawn yet, drawn a piece at a time;
// a column filled light red, the header of the column you're in blue)
const s = document.getElementById('sheet').getContext('2d', { alpha: false });
setTimeout(() => { s.fillStyle = '#ffffff'; s.fillRect(0, 0, 200, 160); }, 300);
setTimeout(() => {
  s.fillStyle = '#ffffff'; s.fillRect(0, 0, 400, 160);
  s.fillStyle = '#d3e3fd'; s.fillRect(100, 0, 100, 20);
  s.fillStyle = '#f4cccc'; s.fillRect(300, 20, 100, 140);
  s.strokeStyle = '#e1e1e1';
  for (let x = 0; x < 400; x += 100) { s.beginPath(); s.moveTo(x + 0.5, 0); s.lineTo(x + 0.5, 160); s.stroke(); }
  for (let y = 20; y < 160; y += 20) { s.beginPath(); s.moveTo(0, y + 0.5); s.lineTo(400, y + 0.5); s.stroke(); }
  s.fillStyle = '#000000'; s.font = 'bold 15px sans-serif';
  [['Name', 'Lab 1', 'Lab 2', 'Late?'], ['Ana', '92', '88', 'no'], ['Ben', '75', '81', 'yes'], ['Chloe', '98', '95', 'no']].forEach((row, r) => row.forEach((v, i) => s.fillText(v, i * 100 + 6, 36 + r * 20)));
}, 1800);
</script></body></html>`;
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const send = (type, body, headers = {}) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };
  if (req.url.startsWith('/blue.user.css')) return send('text/css', STYLE('#3355ff'));
  if (req.url.startsWith('/green.user.css')) return send('text/css', STYLE('#22aa44').replace('@name Styled test', '@name Green test').replace('@namespace bifrost.test', '@namespace bifrost.green'));
  if (host === 'owndark.test') return send('text/html', page('Own dark theme', '<meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme: dark){body{background:#202030 !important;color:#eeeeee !important}}</style>'));
  // Says it has a dark theme, and has only part of one (as Google Classroom: its bar dark, its page white).
  if (host === 'halfdark.test') return send('text/html', page('Half a dark theme', '<meta name="color-scheme" content="light dark"><style>header{height:64px;background:light-dark(#ffffff,#1f1f1f);color:light-dark(#202124,#e8eaed)}</style>', '<header>Bar</header>'));
  if (host === 'csp.test') return send('text/html', page('Strict CSP'), { 'content-security-policy': "style-src 'none'; script-src 'unsafe-inline'" });
  if (req.url.startsWith('/frames-styled')) return send('text/html', page('With a styled frame', '', '<iframe id=f src="http://styled.test/?framed=1" style="width:300px;height:150px;border:0"></iframe>'));
  if (req.url.startsWith('/framed')) return send('text/html', page('With a frame', '', '<iframe id=f src="http://other.test/" style="width:300px;height:150px;border:0"></iframe>'));
  if (host === 'ctp.test' && req.url.startsWith('/extra.css')) return send('text/css', 'p { color: rgb(1, 2, 3) !important; }');
  if (host === 'cdn.test' && req.url.startsWith('/r.css')) { res.writeHead(302, { location: '/x.css' }); res.end(); return; }
  if (host === 'cdn.test' && req.url.startsWith('/x.css')) return send('text/css', '.xo { background: #fff3cd; color: #664d03; }');
  if (host === 'paint.test' && req.url.startsWith('/frame')) return send('text/html', '<!doctype html><style>body{background:#fff;color:#333}</style><body>frame</body>');
  if (host === 'paint.test') return send('text/html', PAINT);
  // (as Google's gstatic does: a mask's picture is read with CORS)
  if (host === 'gstatic.test' && req.url.startsWith('/icon.svg')) return send('image/svg+xml', ICON_SVG, { 'access-control-allow-origin': '*' });
  if (PICS[req.url.split('?')[0]]) return send('image/png', PICS[req.url.split('?')[0]], { 'access-control-allow-origin': '*' });
  if (host === 'gsite.test') return send('text/html', GSITE);
  if (host === 'gframe.test') return send('text/html', '<!doctype html><style>body{margin:0;background:#ffffff;color:#1f1f1f;font:14px sans-serif}</style><body><p style="padding:8px">student@purdue.edu</p></body>');
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

  // Where things are on a tab's page, and what's on screen there.
  const centerOf = (id, sel) => inTab(id, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
  const pixelAt = (id, x, y) => t.main(async ({ webContents }, [id, x, y]) => { const img = await webContents.fromId(id).capturePage({ x, y, width: 1, height: 1 }); const b = img.toBitmap(); return [b[2], b[1], b[0]]; }, [id, x, y]);
  // (the lightest green in a strip of the page: letters drawn light somewhere in it)
  const lightest = (id, x, y, w, h) => t.main(async ({ webContents }, [id, x, y, w, h]) => { const b = (await webContents.fromId(id).capturePage({ x, y, width: w, height: h })).toBitmap(); let max = 0; for (let i = 1; i < b.length; i += 4) max = Math.max(max, b[i]); return max; }, [id, x, y, w, h]);
  const lightness = (c) => CORE.toLab(c[0], c[1], c[2])[0];
  const inkMarks = (id) => inTab(id, "Object.fromEntries([...document.querySelectorAll('[data-bifrost-ink]')].map((e) => [e.id, e.getAttribute('data-bifrost-ink')]))");

  await R.step('dark mode on a page built as Google builds theirs: a frame from another site darkened too (Google’s account card stayed white), a page drawn on a canvas turned around (white paper; black ink on nothing, as Docs draws), icons drawn as masks over a dark color shown; all as it was with dark mode off', async () => {
    await set('webStyles.dark', true);
    const g = await open('http://gsite.test/');
    await front(g);
    await until(async () => { const [x, y] = await centerOf(g, '#xf'); return lightness(await pixelAt(g, x, y)) < 0.3; }, 8000, 'the frame from another site dark');
    const m = await until(async () => { const k = await inkMarks(g); return k.paper === 'paper' && k.ink === 'ink' && k.sheet === 'paper' && k.mask === 'mask' && k.mask2 === 'mask' && k.mask3 === 'mask' ? k : null; }, 8000, 'the canvases and the masks marked').catch(async (e) => { throw new Error(e.message + ' ' + JSON.stringify(await inkMarks(g))); });
    assert(!m.photo && !m.sprite, 'nothing else marked: ' + JSON.stringify(m));
    for (const id of ['#paper', '#ink']) {
      const [x, y] = await centerOf(g, id);
      assert(lightness(await pixelAt(g, x + 190, y + 70)) < 0.3, id + ': its paper dark');
      assert(await lightest(g, x - 190, y - 70, 300, 26) > 180, id + ': its letters light');
    }
    {
      const [x, y] = await centerOf(g, '#sheet');
      assert(lightness(await pixelAt(g, x - 50, y + 50)) < 0.3, 'the spreadsheet’s white cells dark');
      assert(await lightest(g, x - 200, y - 60, 300, 20) > 180, 'the spreadsheet’s letters light');
    }
    await sleep(300);
    await t.shot('webstyles-dark-google');
    for (const id of ['#mask', '#mask3']) {
      const [mx, my] = await centerOf(g, id);
      assert(await lightest(g, mx - 12, my - 12, 24, 24) > 150, id + ': the mask icon light');
    }
    await set('webStyles.dark', false);
    await until(async () => Object.keys(await inkMarks(g)).length === 0, 5000, 'the marks gone');
    const [x, y] = await centerOf(g, '#xf');
    await until(async () => lightness(await pixelAt(g, x, y)) > 0.9, 5000, 'the frame its own white again');
    await t.main(({ webContents }, id) => webContents.fromId(id).close(), g);
  });

  let styled, csp;
  await R.step('your styles: installed from a link in Settings, there from the first paint, only on its sites, through a CSP that forbids styles, in a frame inside another site’s page', async () => {
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
    // In a frame inside another site's page too (a frame doesn't hold its page up for it: it's there a moment
    // after); and the page itself asked the main process once for all it starts with, its frame not at all.
    const asked = await t.main(() => global.__tabStarts || 0);
    const holder = await open('http://other.test/frames-styled');
    const inFrame = () => t.main(({ webContents }, id) => { const f = webContents.fromId(id).mainFrame.frames[0]; return f ? f.executeJavaScript('getComputedStyle(document.body).backgroundColor') : null; }, holder);
    await until(async () => (await inFrame()) === 'rgb(51, 85, 255)', 4000, 'the style in a frame');
    assert((await inTab(holder, 'getComputedStyle(document.body).backgroundColor')) === 'rgb(255, 255, 255)', 'the page around the frame was styled too');
    const now = await t.main(() => global.__tabStarts || 0);
    assert(now - asked === 1, 'the page asked ' + (now - asked) + ' times as it started');
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

  await R.step('Stylus 2’s backup (its Export): a usercss style it saved without the CSS it built is built here, with the options you chose in Stylus; a style of the old kind with its CSS; one in Stylus’s own language said plainly', async () => {
    const less = STYLUS2;
    const styl = less.replace('@name Stylus 2 test', '@name Stylus language test').replace('@namespace bifrost.test/stylus2', '@namespace bifrost.test/styl').replace('@preprocessor less', '@preprocessor stylus');
    // As Stylus 2 saves them: its settings first; a usercss style's CSS left out (sections: [{ code: '' }]).
    const file = JSON.stringify([
      { settings: { updateInterval: 24 }, order: { main: ['a1', 'a2', 'a3'] } },
      { _id: 'a1', _rev: 1731500000000, id: 1, enabled: true, name: 'Stylus 2 test', sourceCode: less, originalDigest: 'x',
        usercssData: { name: 'Stylus 2 test', namespace: 'bifrost.test/stylus2', version: '1.0.0', preprocessor: 'less', vars: { tone: { type: 'select', name: 'tone', label: 'Tone', default: 'dark', value: 'light', options: [{ name: 'dark', label: 'Dark', value: 'dark' }, { name: 'light', label: 'Light', value: 'light' }] } } },
        sections: [{ code: '' }] },
      { _id: 'a2', _rev: 1731500000000, id: 2, enabled: true, name: 'Old kind', sections: [{ code: 'p { color: rgb(9, 8, 7) !important; }', domains: ['stylus2.test'] }] },
      { _id: 'a3', _rev: 1731500000000, id: 3, enabled: true, name: 'Stylus language test', sourceCode: styl, usercssData: { name: 'Stylus language test', namespace: 'bifrost.test/styl', preprocessor: 'stylus', vars: {} }, sections: [{ code: '' }] },
    ]);
    await toSettings();
    await settingsPage("document.getElementById('user-styles').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await settingsPage(`(() => {
      const input = document.querySelector('.ustyles input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(file)}], 'stylus-2026-11-14-10-00.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    const failedDialog = `[...document.querySelectorAll('${OPEN} .dialog')].find((d) => /couldn’t be built/.test(d.textContent))`;
    const failed = await until(() => settingsPage(`(() => { const d = ${failedDialog}; return d ? d.textContent : null; })()`), 20000, 'the style that couldn’t be built');
    assert(/1 of the styles couldn’t be built/.test(failed) && /Stylus language test/.test(failed) && /Shift\+click Export/.test(failed), 'said: ' + failed);
    await settingsPage(`[...${failedDialog}.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'OK').click()`);
    const st = await t.main(() => global.__bifrost.webStyles.styles.filter((x) => /Stylus 2 test|Old kind/.test(x.name)).map((x) => x.name + ':' + x.sections.length + ':' + JSON.stringify(x.values || {})));
    assert(JSON.stringify(st.sort()) === JSON.stringify(['Old kind:1:{}', 'Stylus 2 test:1:{"tone":"light"}']), 'brought in: ' + JSON.stringify(st));
    const page2 = await open('http://stylus2.test/');
    const looks = await inTab(page2, "[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('p')).color].join(' | ')");
    assert(looks === 'rgb(240, 244, 248) | rgb(9, 8, 7)', 'on the page (Light, as chosen in Stylus; the old kind’s CSS): ' + looks);
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

  await R.step('…kept for the next start: pages in your theme from the start, nothing built again; off, the style’s own options again (and a style an older Bifrost brought in empty from Stylus 2’s backup, built at the start)', async () => {
    // (as Bifrost 0.30.0 and before brought one in: its code and options, no CSS)
    const empty = STYLUS2.replace('@name Stylus 2 test', '@name Came empty').replace('@namespace bifrost.test/stylus2', '@namespace bifrost.test/empty').replace(/#f0f4f8/g, '#e1e2e3');
    await t.main((_, code) => { const ws = global.__bifrost.webStyles; ws.styles.push({ id: 'st-cameempty', name: 'Came empty', enabled: true, code, meta: { name: 'Came empty', namespace: 'bifrost.test/empty', preprocessor: 'less' }, vars: [], values: { tone: 'light' }, sections: [], exclusions: [], origin: 'stylus', installedFrom: '', installedAt: Date.now(), updatedAt: Date.now(), error: '' }); ws.save(); }, empty);
    await until(() => t.main(() => { const ws = global.__bifrost.webStyles; return !ws.theming && !ws.dirty && !ws.themedDirty && !ws.writing; }), 5000, 'saved');
    const dir = await t.main(() => global.__bifrost.profile.dir);
    await t.close();
    t = await launch({ ...OPTS, fresh: false });
    const st = await t.main(() => { const ws = global.__bifrost.webStyles; ws.__built = 0; const b = ws.buildThemed.bind(ws); ws.buildThemed = (...a) => { ws.__built++; return b(...a); }; return JSON.stringify([ws.themeStatus().ready, ws.cssFor('http://ctp.test/').includes('#24273a')]); });
    assert(st === '[1,true]', 'at the start (in your theme, Macchiato): ' + st);
    const came = await until(() => t.main(() => { const s = global.__bifrost.webStyles.styles.find((x) => x.id === 'st-cameempty'); return s && s.sections.length ? s.sections[0].code.replace(/\s+/g, ' ') : null; }), 8000, 'the empty one built');
    assert(/background: #e1e2e3 !important/.test(came) && !/#101820/.test(came), 'built with its options: ' + came);
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

  // ---- Catppuccin for every site
  // What a color becomes (Bifrost's own color work, the same as the page's), as getComputedStyle writes it.
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  const turned = (P, c, role) => rgb(CORE.format(CORE.mapColor(P, CORE.parse(c), role)));
  const LOOK = `(() => {
    const g = (sel, p, root = document) => { const e = root.querySelector(sel); return e ? getComputedStyle(e)[p] : 'none'; };
    const sh = document.querySelector('x-card').shadowRoot;
    return {
      first: window.__first, body: g('body', 'backgroundColor'), text: g('#tx', 'color'), link: g('#ln', 'color'), error: g('#er', 'color'),
      header: g('#hd', 'backgroundColor'), headerLine: g('#hd', 'borderBottomColor'), button: g('#bt', 'backgroundColor') + ' / ' + g('#bt', 'color'),
      alert: g('#al', 'backgroundColor') + ' / ' + g('#al', 'color'), bootstrap: g('#bs', 'backgroundColor') + ' / ' + g('#bs', 'borderTopColor'),
      shadcn: g('#sh', 'backgroundColor'), tailwind: g('#tw', 'backgroundColor'), otherSite: g('#xo', 'backgroundColor') + ' / ' + g('#xo', 'color'),
      styleAttr: g('#in', 'backgroundColor') + ' / ' + g('#in', 'color'), bgcolor: g('#td', 'backgroundColor'), svg: g('#sv', 'fill'),
      script: g('#js', 'backgroundColor') + ' / ' + g('#js', 'color'), component: g('p', 'backgroundColor', sh) + ' / ' + g('p', 'color', sh),
      editor: (() => { const d = document.getElementById('ed').contentDocument; return getComputedStyle(d.body).backgroundColor + ' / ' + getComputedStyle(d.body).color; })(),
      letters: g('#gt', 'backgroundImage'), arrow: (g('#se', 'backgroundImage').match(/stroke='%23([0-9a-f]{6})'/) || [])[1],
    };
  })()`;
  const want = (P) => ({
    first: turned(P, '#ffffff', 'b'), body: turned(P, '#ffffff', 'b'), text: turned(P, '#1f2328', 't'), link: turned(P, '#0969da', 't'), error: turned(P, '#d1242f', 't'),
    header: turned(P, '#f6f8fa', 'b'), headerLine: turned(P, '#d1d9e0', 'd'), button: turned(P, '#1f883d', 'b') + ' / ' + turned(P, '#ffffff', 't'),
    alert: turned(P, '#ddf4ff', 'b') + ' / ' + turned(P, '#0550ae', 't'), bootstrap: turned(P, '#ffffff', 'b') + ' / ' + turned(P, '#dee2e6', 'd'),
    shadcn: turned(P, '#ffffff', 'b'), tailwind: turned(P, '#f3f4f6', 'b'), otherSite: turned(P, '#fff3cd', 'b') + ' / ' + turned(P, '#664d03', 't'),
    styleAttr: turned(P, '#ffeeee', 'b') + ' / ' + turned(P, '#990000', 't'), bgcolor: turned(P, '#ff6600', 'b'), svg: turned(P, '#000000', 't'),
    script: turned(P, '#fdecea', 'b') + ' / ' + turned(P, '#611a15', 't'), component: turned(P, '#e7f5ff', 'b') + ' / ' + turned(P, '#1864ab', 't'),
    editor: turned(P, '#ffffff', 'b') + ' / ' + turned(P, '#000000', 't'),
    letters: 'linear-gradient(90deg, ' + turned(P, '#ff0080', 't') + ', ' + turned(P, '#7928ca', 't') + ')', arrow: CORE.format(CORE.mapColor(P, CORE.parse('#343a40'), 't')).slice(1),
  });
  const MOCHA = CORE.prepare(CAT.PALETTES.mocha);
  const differ = (got, exp) => Object.keys(exp).filter((k) => got[k] !== exp[k]).map((k) => `${k}: ${got[k]} (want ${exp[k]})`);
  let paint;

  await R.step('Catppuccin for every site, turned on in Settings: a light page in Catppuccin’s colors at once, and from its first paint: backgrounds, text, links, lines, variables (Bootstrap’s, shadcn’s, Tailwind’s), style="", bgcolor, an SVG’s fill, another site’s stylesheet, a rule its script adds, a web component, a frame, a frame the page writes itself (a rich text editor), a gradient on letters, an SVG arrow written into the stylesheet', async () => {
    await set('webStyles.dark', false);
    await set('webStyles.darkSites', {});
    paint = await open('http://paint.test/');
    assert((await inTab(paint, 'getComputedStyle(document.body).backgroundColor')) === 'rgb(255, 255, 255)', 'before: its own white');
    // (Settings: not open since Bifrost started again, or when this step runs on its own)
    const hasSettings = await t.main(({ webContents }) => webContents.getAllWebContents().some((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')));
    if (!hasSettings) {
      await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), 'bifrost://settings/#web-theme');
      settingsId = await until(() => t.main(({ webContents }) => { const w = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')); return w && !w.isLoading() ? w.id : null; }), 8000, 'Settings');
      await until(() => settingsPage("!!document.querySelector('[data-path=\"webStyles.recolor\"] input')"), 8000, 'the switch');
    }
    await toSettings();
    await settingsPage("document.getElementById('web-theme').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await sleep(300);
    await clickIn(settingsId, '[data-path="webStyles.recolor"] .switch');
    await until(async () => (await get('webStyles.recolor')) === true, 3000, 'on');
    // The open page, at once (its first paint was before: that one's its own white).
    const exp = want(MOCHA);
    await until(async () => { const got = await inTab(paint, LOOK); return differ(got, { ...exp, first: got.first }).length === 0; }, 8000, 'the open page in Mocha');
    // A page opened now: from its first paint.
    const again = await open('http://paint.test/?again');
    const got = await until(async () => { const g = await inTab(again, LOOK); return differ(g, exp).length ? null : g; }, 8000, 'a new page in Mocha').catch(async (e) => { throw new Error(e.message + '\n' + differ(await inTab(again, LOOK), exp).join('\n')); });
    assert(got.first === rgb(CAT.PALETTES.mocha.base), 'its first paint: ' + got.first);
    const frame = await t.main(({ webContents }, id) => webContents.fromId(id).mainFrame.frames[0].executeJavaScript('getComputedStyle(document.body).backgroundColor + " / " + getComputedStyle(document.body).color'), again);
    assert(frame === turned(MOCHA, '#ffffff', 'b') + ' / ' + turned(MOCHA, '#333333', 't'), 'the frame: ' + frame);
    // (the page's own colors aren't changed: Bifrost's stylesheets go after them; style="" keeps its own too)
    const own = await inTab(again, "(() => { const s = document.getElementById('in').style; return [getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(), s.backgroundColor, s.color]; })()");
    assert(JSON.stringify(own) === '["#ffffff","rgb(255, 238, 238)","rgb(153, 0, 0)"]', 'its own: ' + JSON.stringify(own));
    await front(again);
    await sleep(300);
    await t.shot('webstyles-recolor');
    await t.main(({ webContents }, id) => webContents.fromId(id).close(), again);
  });

  await R.step('Catppuccin for every site on a page built as Google builds theirs: icons drawn as pictures from another site (a sprite, an <img>, an SVG) in text’s colors; a logo and a photo kept; icons drawn as masks in text’s color; Google’s four colors in an SVG kept; white on a one-color icon base; the banner’s white letters kept; pages drawn on a canvas turned around; white on a strong blue still reads; in Latte, a black icon left as it is', async () => {
    const was = { webTheme: await get('appearance.webTheme'), match: await get('webStyles.matchTheme'), recolor: await get('webStyles.recolor') };
    await set('webStyles.matchTheme', false);
    await set('webStyles.recolor', true);
    const g = await open('http://gsite.test/');
    await front(g);
    const look = () => inTab(g, `(() => { const cs = (s) => getComputedStyle(document.querySelector(s)); return {
      sprite: cs('#sprite').backgroundImage.slice(0, 27), pic: cs('#pic').content.slice(0, 27), svg: cs('#svgimg').content.slice(0, 29), logo: cs('#logo').content, photo: cs('#photo').content,
      mask: cs('#mask').backgroundColor, mask2: cs('#mask2').backgroundColor, mask3: cs('#mask3').backgroundColor, glogo: cs('#glogo rect').fill, duo: cs('#duoline').fill, banner: cs('#bt').color, b2: cs('#b2t').color,
      card: cs('#fht').color, cardPic: document.getElementById('fht').getAttribute('data-bifrost-pic'),
      paper: document.getElementById('paper').getAttribute('data-bifrost-ink'), ink: document.getElementById('ink').getAttribute('data-bifrost-ink'), sheet: document.getElementById('sheet').getAttribute('data-bifrost-ink'), chip: [cs('#chip').color, cs('#chip').backgroundColor] }; })()`);
    const M = CAT.PALETTES.mocha;
    const exp = { sprite: 'url("data:image/png;base64,', pic: 'url("data:image/png;base64,', svg: 'url("data:image/svg+xml;base6', logo: 'normal', photo: 'normal',
      mask: turned(MOCHA, '#444746', 't'), mask2: rgb(M.subtext1), mask3: turned(MOCHA, '#444746', 't'), glogo: 'rgb(66, 133, 244)', duo: rgb(M.base), banner: 'rgb(255, 255, 255)', b2: 'rgb(255, 255, 255)',
      card: turned(MOCHA, '#000000', 't'), cardPic: null, paper: 'paper', ink: 'ink', sheet: 'paper' };
    const diff = (got, want) => Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: ${got[k]} (want ${want[k]})`);
    const got = await until(async () => { const x = await look(); return diff(x, exp).length ? null : x; }, 12000, 'the page in Mocha').catch(async (e) => { throw new Error(e.message + '\n' + diff(await look(), exp).join('\n')); });
    const [fg, bg] = got.chip.map((c) => CORE.parse(c));
    assert(CORE.ratio(CORE.lum(fg), CORE.lum(bg)) >= 2.4, 'white on the strong blue: ' + got.chip);
    // (on screen: the sprite's glyph light, a canvas page dark with light letters)
    const [sx, sy] = await centerOf(g, '#sprite');
    assert(await lightest(g, sx - 12, sy - 12, 24, 24) > 180, 'the sprite’s glyph light');
    const [px, py] = await centerOf(g, '#paper');
    assert(lightness(await pixelAt(g, px + 190, py + 70)) < 0.3 && await lightest(g, px - 190, py - 70, 300, 26) > 180, 'the canvas page');
    await sleep(300);
    await t.shot('webstyles-recolor-google');
    // Latte (websites told they're light): a black icon shows on it as it is; the banner's letters still white.
    await set('appearance.webTheme', 'light');
    await until(async () => { const x = await look(); return x.pic === 'normal' && /^url\("http/.test(x.sprite) && x.banner === 'rgb(255, 255, 255)' && x.b2 === 'rgb(255, 255, 255)' && x.card === turned(CORE.prepare(CAT.PALETTES.latte), '#000000', 't') && !x.cardPic && !x.paper ? x : null; }, 10000, 'Latte').catch(async (e) => { throw new Error(e.message + ' ' + JSON.stringify(await look())); });
    await set('appearance.webTheme', was.webTheme);
    await set('webStyles.matchTheme', was.match);
    await set('webStyles.recolor', was.recolor);
    await t.main(({ webContents }, id) => webContents.fromId(id).close(), g);
  });

  await R.step('…Catppuccin for every site and your style for the site: yours over it; a page one of your styles is for left to that style; off for a site in its info popover (and by the launcher’s command), and on again; in your theme’s colors while websites match it (Frost, Latte); Latte for websites told they’re light; no other site’s stylesheet read from your own network; off in Settings: the site’s own colors', async () => {
    const look = () => inTab(paint, LOOK);
    // Your style for the site (its info popover's): after Bifrost's, so it wins.
    await t.main((_, css) => { global.__bifrost.db.setSiteSetting('paint.test', 'css', css); global.__bifrost.webStyles.pushAll(); }, 'header { background: rgb(1, 2, 3) }');
    await until(async () => (await look()).header === 'rgb(1, 2, 3)', 3000, 'your style over it');
    await t.main(() => { global.__bifrost.db.setSiteSetting('paint.test', 'css', ''); global.__bifrost.webStyles.pushAll(); });
    await until(async () => (await look()).header === turned(MOCHA, '#f6f8fa', 'b'), 3000, 'without it');
    // ctp.test has a style of yours (Catppuccin's, from the steps before; and one more here): Bifrost leaves it to that.
    const ownId = await t.main(async (_, code) => (await global.__bifrost.webStyles.put(code)).id, '/* ==UserStyle==\n@name Recolor test\n@namespace bifrost.test/recolor\n@version 1.0.0\n==/UserStyle== */\n@-moz-document domain("ctp.test") { html { outline: 0 } }');
    const ctp = await open('http://ctp.test/?recolor');
    const sheets = await inTab(ctp, 'document.adoptedStyleSheets.length');
    assert(sheets === 1, 'ctp.test: only its style (' + sheets + ' stylesheets)');
    await front(ctp);
    await sleep(300);
    await t.ui(() => document.getElementById('site-btn').click());
    const said = await until(() => t.ui(() => { const r = document.querySelector('.si-pop [data-row=recolor]'); return r ? r.textContent : null; }), 3000, 'the row on ctp.test');
    assert(/One of your styles is for this page/.test(said), 'ctp.test’s row: ' + said);
    await t.ui(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await t.main((_, id) => global.__bifrost.webStyles.remove(id), ownId);
    // Off for paint.test in its info popover: its own colors at once; on again.
    await front(paint);
    await sleep(300);
    await t.ui(() => document.getElementById('site-btn').click());
    const row = await until(() => t.ui(() => { const r = document.querySelector('.si-pop [data-row=recolor]'); return r ? r.textContent : null; }), 3000, 'the row');
    assert(/Catppuccin colors/.test(row) && /In Catppuccin’s colors/.test(row), 'the row: ' + row);
    await t.ui(() => document.querySelector('.si-pop [data-row=recolor] input').click());
    await until(async () => JSON.stringify(await get('webStyles.recolorSites')) === '{"paint.test":false}', 3000, 'off for paint.test');
    await until(async () => { const l = await look(); return l.body === 'rgb(255, 255, 255)' && l.link === 'rgb(9, 105, 218)' && l.styleAttr === 'rgb(255, 238, 238) / rgb(153, 0, 0)'; }, 5000, 'its own colors');
    const left = await inTab(paint, "[document.querySelectorAll('[data-bifrost-c]').length, document.adoptedStyleSheets.length, document.getElementById('in').style.cssText]");
    assert(JSON.stringify(left) === '[0,0,"background: rgb(255, 238, 238); color: rgb(153, 0, 0);"]', 'nothing of Bifrost’s left: ' + JSON.stringify(left));
    await t.ui(() => document.querySelector('.si-pop [data-row=recolor] input').click());
    await until(async () => JSON.stringify(await get('webStyles.recolorSites')) === '{}', 3000, 'on again (as every site)');
    await until(async () => differ(await look(), { ...want(MOCHA), first: (await look()).first }).length === 0, 5000, 'Mocha again').catch(async (e) => { throw new Error(e.message + '\n' + differ(await look(), want(MOCHA)).join('\n')); });
    await t.ui(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    // The same from the launcher's command, "Catppuccin colors on this site".
    await t.ui(() => window.__wbTest.command('toggleRecolorSite'));
    await until(async () => JSON.stringify(await get('webStyles.recolorSites')) === '{"paint.test":false}' && (await look()).body === 'rgb(255, 255, 255)', 5000, 'off by the command');
    await t.ui(() => window.__wbTest.command('toggleRecolorSite'));
    await until(async () => JSON.stringify(await get('webStyles.recolorSites')) === '{}' && (await look()).body === rgb(CAT.PALETTES.mocha.base), 5000, 'on by the command');
    // Your theme's colors, while websites match it.
    await set('appearance.theme', 'frost');
    await set('webStyles.matchTheme', true);
    const frost = CAT.fullPalette(CAT.themeBuild(THEMES.resolve({ theme: 'frost' }, {})));
    await until(async () => (await look()).body === rgb(frost.base) && (await look()).link === turned(CORE.prepare(frost), '#0969da', 't'), 8000, 'Frost');
    await set('appearance.theme', 'latte');
    const LATTE = CORE.prepare(CAT.PALETTES.latte);
    await until(async () => differ(await look(), { ...want(LATTE), first: (await look()).first }).length === 0, 8000, 'Latte').catch(async (e) => { throw new Error(e.message + '\n' + differ(await look(), want(LATTE)).join('\n')); });
    await t.shot('webstyles-recolor-latte');
    // Not matching it: Latte for websites told they're light, Mocha for dark.
    await set('webStyles.matchTheme', false);
    await set('appearance.theme', 'mocha');
    await set('appearance.webTheme', 'light');
    await until(async () => (await look()).body === rgb(CAT.PALETTES.latte.base), 8000, 'Latte for light websites');
    await set('appearance.webTheme', 'browser');
    await until(async () => (await look()).body === rgb(CAT.PALETTES.mocha.base), 8000, 'Mocha again');
    // Other sites' stylesheets Bifrost reads for a page: none from your own network for a page from the web
    // (a router's, a printer's), though a page on your own network may have them.
    const reach = await t.main(async ({ session }) => {
      const ws = global.__bifrost.webStyles, ses = session.defaultSession;
      return [await ws.cssReachable(ses, 'http://192.168.1.10/a.css', 'https://site.invalid/'), await ws.cssReachable(ses, 'http://[::1]/a.css', 'https://site.invalid/'),
        await ws.cssReachable(ses, 'http://printer/a.css', 'https://site.invalid/'), await ws.cssReachable(ses, 'http://10.0.0.5/a.css', 'http://intranet.corp/'),
        await ws.cssReachable(ses, 'https://cdn.invalid/a.css', 'https://site.invalid/')];
    });
    assert(JSON.stringify(reach) === '[false,false,false,true,true]', 'what’s read: ' + JSON.stringify(reach));
    // Off in Settings.
    await toSettings();
    await settingsPage("document.getElementById('web-theme').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await sleep(300);
    await clickIn(settingsId, '[data-path="webStyles.recolor"] .switch');
    await until(async () => (await get('webStyles.recolor')) === false, 3000, 'off');
    await until(async () => { const l = await look(); return l.body === 'rgb(255, 255, 255)' && l.component === 'rgb(231, 245, 255) / rgb(24, 100, 171)' && l.editor === 'rgb(255, 255, 255) / rgb(0, 0, 0)' && l.arrow === '343a40'; }, 5000, 'its own colors again');
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
