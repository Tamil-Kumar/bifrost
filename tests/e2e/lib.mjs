// Bifrost end-to-end test library: starts Bifrost (Electron) under Playwright, a small local web server,
// a step reporter, and real pointer/keyboard input through the X server (tools/xinput.py), so hover,
// clicks and drags reach Bifrost the way a person's would. Run suites as a normal user under Xvfb:
//   xvfb-run -a -s '-screen 0 1920x1080x24' node <suite>.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }
const { _electron } = playwright;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const ELECTRON = process.env.ELECTRON || '/home/claude/cache/electron-linux/electron';
export const OUT = process.env.OUT || '/home/claude/bf-test/shots';
export const PROFILES = process.env.PROFILES || '/home/claude/bf-test/profiles';
fs.mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// ------------------------------------------------------------------ web server
const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.zip': 'application/zip' };
// A static site from `dir`; `routes` maps a path (or a RegExp) to (req, res, url) for anything dynamic.
export async function startSite(dir = path.join(ROOT, 'tests', 'site'), { routes = {} } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    for (const [k, fn] of Object.entries(routes)) {
      if (k === url.pathname) return fn(req, res, url);
    }
    if (routes.match) { const r = routes.match(req, res, url); if (r !== false) return; }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Not found</title><h1>404</h1>'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, port, server, stop: () => { try { server.closeAllConnections(); } catch { /* old node */ } server.close(); } };
}

// ------------------------------------------------------------------ reporting
export function reporter(name) {
  const results = [];
  return {
    async step(title, fn) {
      const t0 = Date.now();
      try {
        await fn();
        results.push({ title, ok: true });
        console.log(`  ✓ ${title}` + (process.env.TIMES ? ` (${Date.now() - t0} ms)` : ''));
      } catch (e) {
        results.push({ title, ok: false, error: e });
        console.log(`  ✗ ${title}\n      ${String((e && e.message) || e).split('\n').join('\n      ')}`);
        if (process.env.STACK) console.log(e && e.stack);
      }
    },
    // Prints the total; returns how many failed.
    summary() {
      const ok = results.filter((r) => r.ok).length;
      console.log(`\n${name}: ${ok}/${results.length} passed`);
      return results.length - ok;
    },
    results,
  };
}
export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// --------------------------------------------------------- real pointer and keys
// One long-running helper that sends XTest input to the display Bifrost is on.
export function xinput() {
  const proc = spawn('python3', ['-I', path.join(HERE, 'tools', 'xinput.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = [];
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const w = waiting.shift(); if (w) w(line); }
  });
  const cmd = (...a) => new Promise((resolve) => { waiting.push(resolve); proc.stdin.write(a.join(' ') + '\n'); });
  return {
    move: (x, y) => cmd('move', Math.round(x), Math.round(y)),
    down: (b = 1) => cmd('down', b),
    up: (b = 1) => cmd('up', b),
    async click(x, y, b = 1) { if (x != null) await cmd('move', Math.round(x), Math.round(y)); await sleep(40); await cmd('down', b); await sleep(30); return cmd('up', b); },
    wheel: (dir = 'down', n = 1) => cmd('wheel', dir, n),
    key: (keysym) => cmd('key', keysym),
    keyDown: (keysym) => cmd('keydown', keysym),
    keyUp: (keysym) => cmd('keyup', keysym),
    pos: () => cmd('pos').then((s) => s.split(' ').map(Number)),
    close() { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } },
  };
}

// ------------------------------------------------------------------ Bifrost
// Starts Bifrost with its own profile folder (fresh: emptied first). The window is moved to (0, 0) and
// sized to width×height so screen and window coordinates line up for real pointer input.
export async function launch({ profile = 'default', args = [], env = {}, fresh = true, width = 1440, height = 900, settings = null, wait = true } = {}) {
  const dir = path.isAbsolute(profile) ? profile : path.join(PROFILES, profile);
  if (fresh) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Settings to start with (written before the first start, the way they'd be after using it).
  if (settings && fresh) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--profile=${dir}`, ...args],
    env: { ...process.env, BIFROST_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env },
    timeout: 60000,
  });
  const logs = [];
  app.process().stdout.on('data', (d) => logs.push(...String(d).split('\n').filter(Boolean)));
  app.process().stderr.on('data', (d) => logs.push(...String(d).split('\n').filter(Boolean)));
  // Under the test driver Electron sometimes stalls while quitting: give it a few seconds, then end it.
  const closeApp = app.close.bind(app);
  app.close = async () => {
    const ok = await Promise.race([closeApp().then(() => true, () => true), sleep(8000).then(() => false)]);
    if (!ok) { try { app.process().kill('SIGKILL'); } catch { /* gone */ } }
  };
  const pageLogs = [];
  const watch = (p) => {
    p.on('console', (m) => pageLogs.push(`[${p.url().slice(0, 60)}] ${m.type()}: ${m.text()}`));
    p.on('pageerror', (e) => pageLogs.push(`[${p.url().slice(0, 60)}] pageerror: ${e.message}`));
    p.on('dialog', () => { /* Bifrost answers pages' dialogs itself */ });
  };
  app.context().pages().forEach(watch);
  app.context().on('page', watch);
  let win = null;
  const t = {
    app, logs, dir,
    get win() { return win; },
    pageLogs: async () => pageLogs.slice(),
    main: (fn, arg) => app.evaluate(fn, arg),
    ui: (fn, arg) => win.evaluate(fn, arg),
    // Runs `code` in the first tab whose address contains `match`.
    guest: (match, code) => app.evaluate(async ({ webContents }, [match, code]) => {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().includes(match));
      if (!wc) throw new Error('no tab with ' + match);
      return wc.executeJavaScript(code, true);
    }, [match, code]),
    async until(fn, arg, ms = 5000, label = '') {
      const end = Date.now() + ms;
      let last;
      while (Date.now() < end) {
        try { last = await win.evaluate(fn, arg); if (last) return last; } catch (e) { last = e.message; }
        await sleep(80);
      }
      throw new Error('timed out' + (label ? ' waiting for ' + label : '') + (last !== undefined && last !== false && last !== null ? ' (last: ' + JSON.stringify(last).slice(0, 300) + ')' : ''));
    },
    // The window as it is on screen, web pages included.
    async shot(name, { window: which = 'focused' } = {}) {
      const png = await app.evaluate(async ({ BrowserWindow }, which) => {
        const list = BrowserWindow.getAllWindows().filter((w) => w.isVisible());
        const w = (which === 'focused' && BrowserWindow.getFocusedWindow()) || list.find((x) => x.webContents.getURL().startsWith('bifrost://ui')) || list[0];
        const img = await w.webContents.capturePage();
        return img.toPNG().toString('base64');
      }, which);
      const file = path.join(OUT, name.endsWith('.png') ? name : name + '.png');
      fs.writeFileSync(file, Buffer.from(png, 'base64'));
      return file;
    },
    // The browser window's content area on screen: { x, y, width, height }.
    bounds: () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.isVisible() && x.webContents.getURL().startsWith('bifrost://ui'));
      return w.getContentBounds();
    }),
    async close() { await app.close(); },
  };
  if (!wait) return t;
  // The browser window (bifrost://ui), not a tab or an extension page.
  const end = Date.now() + 30000;
  while (!win && Date.now() < end) {
    win = app.windows().find((p) => p.url().startsWith('bifrost://ui/browser.html')) || null;
    if (!win) await sleep(100);
  }
  if (!win) throw new Error('no browser window: ' + app.windows().map((p) => p.url()).join(', '));
  await win.waitForFunction(() => window.__wbTest && document.readyState === 'complete', null, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
    if (w.isMaximized()) w.unmaximize();
    w.setContentBounds({ x: 0, y: 0, width, height });
    w.focus();
  }, [width, height]);
  await sleep(300);
  return t;
}

// Looks for things in the UI that shouldn't be there: text overflowing its box, elements past the window's
// edge, images that didn't load, and text too faint to read. Returns a list of findings.
export const DOM_AUDIT = `(() => {
  const out = [];
  const W = innerWidth, H = innerHeight;
  const lum = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const opaqueBg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.9)) return c; } return 'rgb(0,0,0)'; };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    if (el.tagName === 'IMG' && el.complete && !el.naturalWidth && el.getAttribute('src')) out.push('broken image: ' + name);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (text && cs.overflow === 'visible' && el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace === 'nowrap' && cs.textOverflow !== 'ellipsis') out.push('text overflows: ' + name + ' "' + text.slice(0, 40) + '"');
    if (text && cs.color) { const a = lum(cs.color), b = lum(opaqueBg(el)); if (a != null && b != null) { const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (ratio < 2.6 && !el.closest('[aria-hidden="true"]')) out.push('faint text (' + ratio.toFixed(2) + '): ' + name + ' "' + text.slice(0, 40) + '"'); } }
  }
  return out;
})()`;
