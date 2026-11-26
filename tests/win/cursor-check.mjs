// On Windows, with real input: a video's player that hides the pointer once it's in full screen (as YouTube's
// does when its controls go), the mouse still since it clicked the player's full screen button. Does the pointer
// go? Windows is asked what it shows (GetCursorInfo), the mouse moved and clicked with SendInput
// (tests/win/input.ps1). It tries a few ways of getting Chromium to look at the pointer again once the window is
// full screen, each in a Bifrost of its own, and prints what happened in each: what Windows showed over time,
// what the page saw, and what Chromium said the page's and the window's pointers were. Elsewhere (Linux, X) it
// runs the same, with tests/e2e/tools/xinput.py (only "shown" or "none" for the pointer there).
//
//   node tests/win/cursor-check.mjs [--runtime=<folder with electron.exe>] [--ways=as-is,nudge,...] [--runs=1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[cursor-check] ' + m);
let playwright;
try { playwright = require('playwright-core'); } catch { playwright = require('playwright'); }

// ------------------------------------------------------------------ Electron
function runtime() {
  if (args.runtime) return path.join(path.resolve(args.runtime), WIN ? 'electron.exe' : 'electron');
  if (!WIN) return process.env.ELECTRON || '/home/claude/cache/electron-linux/electron';
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const v = pkg.engines.electron;
  const base = `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(v)}/`;
  const cache = path.join(os.homedir(), 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const name = `electron-v${v}-win32-x64.zip`;
  const get = (url, file) => { if (!fs.existsSync(file)) execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file, url], { stdio: 'inherit' }); };
  const sums = path.join(cache, `SHASUMS256-${v}.txt`);
  get(base + 'SHASUMS256.txt', sums);
  const zip = path.join(cache, name);
  get(base + encodeURIComponent(name), zip);
  const want = new RegExp(`^([0-9a-f]{64}) \\*?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(fs.readFileSync(sums, 'utf8'));
  const got = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (!want || want[1] !== got) throw new Error(name + " doesn't match its checksum");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cursor-electron-'));
  require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(zip, dir);
  return path.join(dir, 'electron.exe');
}

// ------------------------------------------------------------------ input
function input() {
  const proc = WIN
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tests', 'win', 'input.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn('python3', [path.join(ROOT, 'tests', 'e2e', 'tools', 'xinput.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let rest = '';
  const waiting = [];
  let ready;
  const isReady = new Promise((r) => { ready = r; });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    rest += d;
    for (let i; (i = rest.indexOf('\n')) >= 0;) {
      const line = rest.slice(0, i).trim();
      rest = rest.slice(i + 1);
      if (line === 'ready') { ready(); continue; }
      const w = waiting.shift();
      if (w) w(line);
    }
  });
  if (!WIN) ready();
  let chain = Promise.resolve();
  const raw = (line) => (chain = chain.then(() => isReady).then(() => new Promise((r) => { waiting.push(r); proc.stdin.write(line + '\n'); })));
  // (X: what xinput.py has; "cursor" is how many of the pointer's pixels show)
  const pos = async () => (await raw('pos')).split(' ').map(Number);
  return {
    move: (x, y) => raw(`move ${Math.round(x)} ${Math.round(y)}`),
    click: () => (WIN ? raw('click') : raw('down 1').then(() => raw('up 1'))),
    nudge: async (dx, dy) => { if (WIN) return raw(`nudge ${dx} ${dy}`); const [x, y] = await pos(); return raw(`move ${x + dx} ${y + dy}`); },
    setpos: async () => { if (!WIN) { const [x, y] = await pos(); return raw(`move ${x} ${y}`); } const c = JSON.parse(await raw('cursor')); return raw(`setpos ${c.x} ${c.y}`); },
    cursor: async () => { const s = await raw('cursor'); if (!WIN) return { shape: Number(s) > 0 ? 'shown' : 'none' }; try { return JSON.parse(s); } catch { return { shape: 'error ' + s }; } },
    close() { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } },
  };
}

// ------------------------------------------------------------------ the pages
// A player like YouTube's: controls that go 2 s after the mouse last moved over it (and at once when it leaves),
// and the pointer with them (cursor: none); a full screen button at its bottom right.
const SCRIPT = `
const P = document.getElementById('player'); const log = window.__log = [];
const L = (m) => log.push([Date.now(), m]);
let timer = 0, moves = 0, inside = false;
const active = () => { P.classList.remove('autohide'); clearTimeout(timer); timer = setTimeout(() => { P.classList.add('autohide'); L('controls go (cursor: none)'); }, 2000); };
P.addEventListener('mousemove', (e) => { inside = true; if (moves++ < 40) L('move ' + e.clientX + ',' + e.clientY + (e.isTrusted ? '' : ' (untrusted)')); active(); });
P.addEventListener('mouseleave', () => { inside = false; L('leave'); clearTimeout(timer); P.classList.add('autohide'); });
document.addEventListener('mouseleave', () => L('left the page'));
document.addEventListener('mouseover', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) L('over a link'); });
`;
const STYLE = `html,body{margin:0;background:#0f0f0f;color:#ddd;font:14px system-ui,sans-serif}
#player{position:relative;width:520px;height:292px;background:#1d2a3a;flex:none}
#player.autohide{cursor:none}
#controls{position:absolute;left:0;right:0;bottom:0;height:44px;background:rgba(0,0,0,.6)}
#player.autohide #controls{opacity:0}
#fs{position:absolute;right:10px;bottom:7px;width:40px;height:30px;cursor:pointer}
a{display:block;background:#333;color:#ddd}`;
const links = (n, w, h) => Array.from({ length: n }, (_, i) => `<a href="#${i}" style="width:${w}px;height:${h}px">${i}</a>`).join('');
const PAGES = {
  // the player itself goes full screen, at once
  simple: { match: '/simple.html', fs: '#fs', hover: '#player', html: `<!doctype html><meta charset=utf-8><title>Player</title>
<style>${STYLE}#wrap{display:flex;gap:20px;padding:30px}#player:fullscreen{width:100vw;height:100vh}</style>
<div id=wrap><div id=player><div id=controls><button id=fs>[ ]</button></div></div><div>${links(4, 180, 70)}</div></div>
<script>${SCRIPT}
document.getElementById('fs').addEventListener('click', () => { L('click'); P.requestFullscreen(); });
document.addEventListener('fullscreenchange', () => { L('full screen ' + !!document.fullscreenElement); if (document.fullscreenElement) active(); });
</script>` },
  // as YouTube does it: the whole page goes full screen, and the player fills it a moment later (links all
  // around it meanwhile, where the pointer may be then)
  ytlike: { match: '/ytlike.html', fs: '#fs', hover: '#player', html: `<!doctype html><meta charset=utf-8><title>Player</title>
<style>${STYLE}#wrap{display:grid;grid-template-columns:520px 1fr;gap:12px;padding:24px;width:1800px}
.links{display:grid;grid-template-columns:repeat(9,150px);gap:6px}
body.fsmode #player{position:fixed;inset:0;width:auto;height:auto;z-index:10}</style>
<div id=wrap><div id=player><div id=controls><button id=fs>[ ]</button></div></div><div class=links>${links(27, 150, 84)}</div>
<div class=links style="grid-column:1/3;grid-template-columns:repeat(12,150px)">${links(96, 150, 84)}</div></div>
<script>${SCRIPT}
document.getElementById('fs').addEventListener('click', () => { L('click'); document.documentElement.requestFullscreen(); });
document.addEventListener('fullscreenchange', () => {
  L('full screen ' + !!document.fullscreenElement);
  if (document.fullscreenElement) setTimeout(() => { document.body.classList.add('fsmode'); L('the player fills it'); if (inside) active(); }, 400);
  else document.body.classList.remove('fsmode');
});
</script>` },
  // the simple page, but Chromium left thinking the mouse is over Bifrost's own window (a cover of Bifrost's over
  // the page as the mouse moved, then gone), the page then going full screen by itself
  stale: { match: '/stale.html', fs: '#fs', hover: '#player', stale: true },
  // YouTube itself (playing; its own full screen button)
  youtube: { match: 'youtube.com/watch', fs: '.ytp-fullscreen-button', hover: '#movie_player', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
};

// ------------------------------------------------------------------ ways
// What's done 700 ms after the window went full screen, to get Chromium to look at the pointer again.
const WAYS = {
  // (Bifrost as it is)
  'as-is': null,
  // a move that goes nowhere, as real input (SendInput)
  nudge: ({ io }) => io.nudge(0, 0),
  // SetCursorPos where it is
  setpos: ({ io }) => io.setpos(),
  // a small view put under the pointer and taken away (Aura moves the mouse where it is, for windows that change)
  view: ({ app }) => app.evaluate(async ({ BrowserWindow, WebContentsView, screen }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
    const p = screen.getCursorScreenPoint(); const cb = win.getContentBounds();
    const v = new WebContentsView();
    v.setBounds({ x: p.x - cb.x - 2, y: p.y - cb.y - 2, width: 4, height: 4 });
    win.contentView.addChildView(v);
    await new Promise((r) => setTimeout(r, 80));
    win.contentView.removeChildView(v);
    v.webContents.close();
    return 'ok';
  }),
  // a mouse move sent to the page by Electron (sendInputEvent), where the pointer is
  guestmove: ({ app }) => app.evaluate(({ BrowserWindow, webContents, screen }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
    const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(global.__match));
    const p = screen.getCursorScreenPoint(); const cb = win.getContentBounds();
    g.sendInputEvent({ type: 'mouseMove', x: p.x - cb.x, y: p.y - cb.y });
    return 'ok';
  }),
  // the window let mouse events through for a moment
  ignore: ({ app }) => app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
    win.setIgnoreMouseEvents(true);
    await new Promise((r) => setTimeout(r, 60));
    win.setIgnoreMouseEvents(false);
    return 'ok';
  }),
};

// ------------------------------------------------------------------ one run
const exe = runtime();
const server = http.createServer((req, res) => {
  const page = Object.values(PAGES).find((p) => p.html && req.url.startsWith(p.match));
  res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page ? page.html : 'no');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PAGES.stale.html = PAGES.simple.html;
const urlOf = (page) => page.url || `http://127.0.0.1:${server.address().port}${page.match}`;

async function launch(scale, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cursor-profile-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboarding: { done: true }, tabs: { restoreOnStartup: 'newtab' } }));
  const extra = scale !== 1 ? [`--force-device-scale-factor=${scale}`] : [];
  const app = await playwright._electron.launch({ executablePath: exe, args: [ROOT, `--profile=${dir}`, ...extra], env: { ...process.env, BIFROST_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env }, timeout: 90000 });
  const end = Date.now() + 60000;
  let win = null;
  while (!win && Date.now() < end) { win = app.windows().find((p) => p.url().startsWith('bifrost://ui/browser.html')) || null; if (!win) await sleep(150); }
  if (!win) throw new Error('no browser window');
  await win.waitForFunction(() => window.__wbTest && document.readyState === 'complete', null, { timeout: 60000 });
  return { app, win };
}

const guestOf = (app, match, code) => app.evaluate(({ webContents }, [match, code]) => {
  const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(match));
  return g ? g.executeJavaScript(code, true) : null;
}, [match, code]);

// Where an element of the page is on the screen (Windows' pixels); null when it isn't there.
const where = (app, match, sel) => app.evaluate(async ({ BrowserWindow, webContents, screen }, [match, sel]) => {
  const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
  const cb = win.getContentBounds();
  const wv = await win.webContents.executeJavaScript(`(() => { const v = [...document.querySelectorAll('webview.view')].find((e) => !e.classList.contains('hidden') && e.getBoundingClientRect().width); const r = v.getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
  const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(match));
  if (!g) return null;
  const r = await g.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!r) return null;
  const dip = { x: Math.round(cb.x + wv.x + r.x), y: Math.round(cb.y + wv.y + r.y) };
  if (process.platform === 'win32') return screen.dipToScreenPoint(dip);
  const k = screen.getDisplayNearestPoint(dip).scaleFactor;
  return { x: Math.round(dip.x * k), y: Math.round(dip.y * k) };
}, [match, sel]);

async function run({ page: pageName, scale, way }) {
  const page = PAGES[pageName];
  const io = input();
  const { app, win } = await launch(scale, way === 'no-repoint' ? { BIFROST_REPOINT: '0' } : {});
  const out = { page: pageName, scale, way };
  try {
    await app.evaluate(({ BrowserWindow }, match) => { global.__match = match; const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui')); w.maximize(); w.focus(); }, page.match);
    await sleep(1200);
    await app.evaluate((_e, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), urlOf(page));
    const lend = Date.now() + 30000;
    while (Date.now() < lend) {
      const ok = await app.evaluate(({ webContents }, match) => webContents.getAllWebContents().some((w) => w.getType() === 'webview' && w.getURL().includes(match) && !w.isLoading()), page.match);
      if (ok) break;
      await sleep(200);
    }
    await sleep(1500);
    if (pageName === 'youtube') {
      // (playing: its controls only go then; the page's log is what's set up here)
      const fend = Date.now() + 25000;
      while (Date.now() < fend && !(await where(app, page.match, page.fs))) await sleep(500);
      out.youtube = await guestOf(app, page.match, `(async () => {
        const log = window.__log = []; const L = (m) => log.push([Date.now(), m]);
        const P = document.querySelector('#movie_player'); const v = document.querySelector('video');
        if (!P || !v) return 'no player: ' + document.title + ' ' + location.href;
        try { v.muted = true; await Promise.race([v.play(), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { L('play: ' + e.message); }
        new MutationObserver(() => L('player ' + (P.classList.contains('ytp-autohide') ? 'controls gone' : 'controls shown'))).observe(P, { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('fullscreenchange', () => L('full screen ' + !!document.fullscreenElement));
        P.addEventListener('mouseleave', () => L('leave'));
        return 'playing ' + !v.paused + ', ' + document.title;
      })()`);
      await sleep(1500);
    }
    // What Chromium says the pointers are, and when things go full screen.
    await app.evaluate(({ BrowserWindow, webContents }, match) => {
      const ev = global.__cc = [];
      const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(match));
      win.webContents.on('cursor-changed', (_e, type) => ev.push([Date.now(), 'window says ' + type]));
      g.on('cursor-changed', (_e, type) => ev.push([Date.now(), 'page says ' + type]));
      win.on('enter-full-screen', () => { ev.push([Date.now(), 'window full screen']); global.__fsAt = Date.now(); });
      g.on('enter-html-full-screen', () => ev.push([Date.now(), 'page asks for full screen']));
      win.webContents.executeJavaScript(`(() => { window.__wvc = []; for (const v of document.querySelectorAll('webview.view')) new MutationObserver(() => window.__wvc.push([Date.now(), 'webview cursor: ' + (v.style.cursor || '(none set)')])).observe(v, { attributes: true, attributeFilter: ['style'] }); })()`);
    }, page.match);
    const hover = await where(app, page.match, page.hover);
    await io.move(hover.x, hover.y); await sleep(500);
    const fsb = await where(app, page.match, page.fs);
    if (!fsb) throw new Error('no full screen button on the page');
    out.at = { hover, fs: fsb, before: await io.cursor() };
    let t0;
    if (page.stale) {
      await win.evaluate(() => { const o = document.createElement('div'); o.id = 'pointer-cover'; o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent'; document.body.appendChild(o); });
      await sleep(250);
      await io.nudge(15, 15); await sleep(400);
      await win.evaluate(() => document.getElementById('pointer-cover').remove());
      await sleep(400);
      out.overButton = await io.cursor();
      t0 = Date.now();
      await guestOf(app, page.match, 'document.getElementById("player").requestFullscreen().then(() => 1)');
    } else {
      await io.move(fsb.x, fsb.y); await sleep(600);
      out.overButton = await io.cursor();
      t0 = Date.now();
      await io.click();
    }
    // the pointer as Windows shows it, every 100 ms for 6 s; then a small real move, and 4.5 s more
    const samples = [];
    let did = false, fsAt = 0;
    const sampleUntil = async (end) => {
      while (Date.now() < end) {
        const c = await io.cursor();
        samples.push([Date.now() - t0, c.shape, c.under || '']);
        if (!fsAt) fsAt = (await app.evaluate(() => global.__fsAt || 0)) || 0;
        if (fsAt && !did && Date.now() >= fsAt + 900 && WAYS[way]) { did = true; out.did = await WAYS[way]({ app, io }).then((r) => String(r), (e) => 'failed: ' + e.message); samples.push([Date.now() - t0, '(' + way + ')', '']); }
        await sleep(100);
      }
    };
    await sampleUntil(t0 + 6000);
    out.atEnd = await io.cursor();
    await io.nudge(3, 0);
    samples.push([Date.now() - t0, '(moved 3 px)', '']);
    await sampleUntil(t0 + 10500);
    out.afterMove = await io.cursor();
    const plog = (await guestOf(app, page.match, 'window.__log || []')) || [];
    const cc = await app.evaluate(() => global.__cc);
    const wvc = await win.evaluate(() => window.__wvc || []);
    out.fsAt = fsAt ? fsAt - t0 : null;
    // (the pointer's changes only)
    const changes = [];
    for (const s of samples) { const last = changes[changes.length - 1]; if (!last || last[1] !== s[1] || last[2] !== s[2]) changes.push(s); }
    out.pointer = changes.map(([t, shape, under]) => `${t}:${shape}${under && under !== 'Chrome_RenderWidgetHostHWND' ? '/' + under : ''}`).join('  ');
    out.events = [...plog.map(([t, m]) => [t, 'page: ' + m]), ...cc, ...wvc].sort((a, b) => a[0] - b[0]).filter(([, m]) => !/^page: move /.test(m)).map(([t, m]) => `${t - t0}: ${m}`);
  } finally {
    io.close();
    await Promise.race([app.close().catch(() => {}), sleep(8000)]);
    if (WIN) { try { execFileSync('taskkill', ['/F', '/T', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { /* none left */ } }
    await sleep(1500);
  }
  return out;
}

// What to run: page:scale:way, or every page × scale × way given.
const cases = [];
if (args.cases) for (const c of String(args.cases).split(',')) { const [page, scale, way] = c.split(':'); cases.push({ page, scale: Number(scale), way }); }
else for (const page of String(args.pages || 'simple').split(',')) for (const scale of String(args.scales || '1').split(',').map(Number)) for (const way of String(args.ways || 'as-is').split(',')) cases.push({ page, scale, way });
const runs = Number(args.runs || 1);
const results = [];
for (const c of cases) {
  for (let i = 0; i < runs; i++) {
    const name = `${c.page} at ${c.scale * 100}%, ${c.way}${runs > 1 ? ' #' + (i + 1) : ''}`;
    log('— ' + name);
    let r;
    try { r = await Promise.race([run(c), sleep(150000).then(() => { throw new Error('took over 150 s'); })]); } catch (e) { r = { ...c, error: e.message }; if (WIN) { try { execFileSync('taskkill', ['/F', '/T', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { /* none */ } } }
    r.name = name;
    results.push(r);
    if (r.youtube) log('  YouTube: ' + r.youtube);
    if (r.error) { log('  error: ' + r.error); continue; }
    log(`  the button at ${JSON.stringify(r.at.fs)}, the pointer over it: ${JSON.stringify(r.overButton)}`);
    log(`  window full screen at ${r.fsAt} ms; ${c.way}: ${r.did || '-'}`);
    log('  the pointer (ms after the click: shape): ' + r.pointer);
    for (const e of r.events) log('    ' + e);
    log(`  ${r.atEnd.shape === 'none' ? '✓ hidden' : '✗ still shown (' + r.atEnd.shape + ')'} 6 s after the click; after a small move and 4.5 s: ${r.afterMove.shape === 'none' ? 'hidden' : 'shown (' + r.afterMove.shape + ')'}`);
  }
}
log('summary:');
for (const r of results) log(`  ${r.name}: ${r.error ? 'error' : (r.atEnd.shape === 'none' ? 'hidden' : 'SHOWN') + ', after a move ' + (r.afterMove.shape === 'none' ? 'hidden' : 'SHOWN')}`);
server.close();
const bad = results.filter((r) => !r.error && (r.atEnd.shape !== 'none' || r.afterMove.shape !== 'none'));
const errors = results.filter((r) => r.error);
if (!bad.length && results.length > errors.length) log(`✓ the pointer hid every time (${results.length - errors.length} of ${results.length} ran)`);
else log(`✗ the pointer stayed on screen: ${bad.map((r) => r.name).join('; ') || 'nothing ran'}`);
process.exit(bad.length || results.length === errors.length ? 1 : 0);
