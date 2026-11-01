// Updates (src/main/updater.js) against a release served here: Bifrost finds a newer version, downloads it,
// checks its checksum and stages it next to its builds (only its own files when the Electron is the same;
// the whole build otherwise), says so (menu button, menu, toast, Settings), and "Restart to update" hands
// over to the program that swaps it in. The swap itself is in tests/setup (it's Windows code).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launch, startSite, reporter, assert, sleep, ROOT } from './lib.mjs';

const require = createRequire(import.meta.url);
const { writeZip } = require(path.join(ROOT, 'tools', 'assemble.cjs'));
const R = reporter('updates');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NEXT = VERSION.replace(/(\d+)$/, (n) => String(Number(n) + 1));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-updates-'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const zip = (folder, file) => { const fd = fs.openSync(file, 'w'); try { writeZip(fd, folder); } finally { fs.closeSync(fd); } return file; };

// What a release holds: Bifrost's own files at NEXT, and a portable folder with both builds.
const rel = path.join(TMP, 'release');
fs.mkdirSync(rel);
const appDir = path.join(TMP, 'app-src');
fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'bifrost-browser', productName: 'Bifrost', version: NEXT }, null, 2));
fs.writeFileSync(path.join(appDir, 'src', 'new.txt'), 'the new version');
const appZip = zip(appDir, path.join(rel, `Bifrost-${NEXT}-app.zip`));
const portSrc = path.join(TMP, 'portable-src', 'BifrostPortable');
for (const a of ['x64', 'arm64']) {
  fs.mkdirSync(path.join(portSrc, 'App', 'Bifrost-' + a, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(portSrc, 'App', 'Bifrost-' + a, 'Bifrost.exe'), 'new build ' + a);
  fs.writeFileSync(path.join(portSrc, 'App', 'Bifrost-' + a, 'resources', 'app', 'package.json'), JSON.stringify({ version: NEXT }));
}
const portZip = zip(path.dirname(portSrc), path.join(rel, `BifrostPortable-${NEXT}.zip`));
const setupFile = path.join(rel, `Bifrost-Setup-${NEXT}-${process.arch}.exe`);
fs.writeFileSync(setupFile, 'MZ an installer');
const desc = (f) => ({ file: path.basename(f), size: fs.statSync(f).size, sha256: sha(f) });
let feed = null;   // what latest.json says (set per step)
const site = await startSite(rel, { routes: { '/latest.json': (req, res) => { if (!feed) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(feed)); } } });
const asset = (f, extra = {}) => Object.assign(desc(f), { url: `${site.url}/${path.basename(f)}` }, extra);

// This Bifrost "is" a portable one: BifrostPortable/App/Bifrost-x64 (and an ARM64 build next to it).
const port = path.join(TMP, 'BifrostPortable');
for (const a of ['x64', 'arm64']) {
  const b = path.join(port, 'App', 'Bifrost-' + a);
  fs.mkdirSync(path.join(b, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(b, 'portable.ini'), 'DataDir=..\\..\\Data\n');
  fs.writeFileSync(path.join(b, 'resources', 'app', 'package.json'), JSON.stringify({ version: VERSION }));
}
const build = path.join(port, 'App', 'Bifrost-x64');
const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const env = (b) => ({ ...NO_PROXY, BIFROST_UPDATE_FEED: site.url + '/latest.json', BIFROST_UPDATE_BUILD: b, BIFROST_UPDATE_FIRST_MS: '600000' });
let t = await launch({ profile: 'updates', env: env(build) });

const info = () => t.main(() => global.__bifrost.updater.info());
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + String(JSON.stringify(last)).slice(0, 300) + ')' : ''));
};
const check = (opts) => t.main((_, o) => global.__bifrost.updater.check(o), opts || { download: true });
const reset = () => t.main(() => { const u = global.__bifrost.updater; u.state.state = 'idle'; u.state.error = ''; });
const helper = () => t.main(() => global.__helperCalls || []);
const watchHelper = () => t.main(() => { global.__helperCalls = []; global.__bifrost.updater.on('helper', (h) => global.__helperCalls.push(h)); });
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

try {
  await sleep(1000);
  await watchHelper();

  await R.step('no release yet, or nothing newer: says so', async () => {
    let i = await check();
    assert(i.state === 'error' && /no release has been published yet/.test(i.error), JSON.stringify(i));
    feed = { version: VERSION, runtime: 'x', app: asset(appZip) };
    i = await check();
    assert(i.state === 'current' && i.mode === 'portable' && i.enabled, JSON.stringify(i));
  });

  await R.step('a newer version on the same Electron: only Bifrost’s own files come, staged next to both builds', async () => {
    // (As package.json and the release name it: castlabs' Electron reports just "44.9.3".)
    const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.electron;
    assert(runtime === await t.main((_, root) => global.__require(root + '/src/main/updater.js').RUNTIME, ROOT), 'this Bifrost runs on the Electron package.json names');
    feed = { version: NEXT, runtime, app: asset(appZip), portable: asset(portZip), notes: 'Fixes' };
    const i = await check({ auto: true });
    assert(i.state === 'ready' && i.kind === 'app' && i.latest === NEXT, JSON.stringify(i));
    for (const a of ['x64', 'arm64']) {
      const next = path.join(port, 'App', 'Bifrost-' + a, 'resources', 'app.next');
      assert(readJson(path.join(next, 'package.json')).version === NEXT, 'the new files for ' + a);
      assert(fs.readFileSync(path.join(next, 'src', 'new.txt'), 'utf8') === 'the new version', 'all of them for ' + a);
      assert(readJson(path.join(next, 'bifrost-update.json')).version === NEXT, 'marked complete for ' + a);
    }
    assert(!fs.existsSync(path.join(port, 'App', 'Bifrost-x64.next')), 'no whole build');
  });

  await R.step('the window says so: a dot on the menu button, the menu offers to restart, and a toast', async () => {
    await until(() => t.ui(() => document.documentElement.hasAttribute('data-update-ready')), 4000, 'the menu button’s dot');
    const toast = await until(() => t.ui(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).find((s) => /is ready/.test(s)) || ''), 4000, 'the toast');
    assert(toast.includes(NEXT) && /Restart now/.test(toast), toast);
    await t.ui(() => document.querySelector('[data-tb="menu"]').click());
    const first = await until(() => t.ui(() => { const m = document.querySelector('.menu .menu-item'); return m ? m.textContent : ''; }), 3000, 'the menu');
    assert(first.includes('Restart to update Bifrost (' + NEXT + ')'), first);
    await t.shot('updates-01-menu');
    await t.ui(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await sleep(300);
  });

  await R.step('Settings shows it, and Restart to update hands over to BifrostPortable.exe', async () => {
    await t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: false }), 'bifrost://settings/#updates');
    const text = await until(() => t.guest('bifrost://settings', `(() => { const g = document.getElementById('updates'); return g && /is ready/.test(g.textContent) ? g.textContent : ''; })()`), 8000, 'the Updates section');
    assert(text.includes(NEXT) && /Restart to update/.test(text), text);
    await sleep(500);
    await t.shot('updates-02-settings');
    await t.guest('bifrost://settings', `[...document.querySelectorAll('#updates button')].find((b) => /Restart to update/.test(b.textContent)).click(); true`);
    const calls = await until(async () => { const c = await helper(); return c.length ? c : null; }, 4000, 'the helper');
    assert(calls[0].cmd === path.join(port, 'BifrostPortable.exe') && calls[0].args.join(' ') === '--bifrost-apply-update', JSON.stringify(calls));
  });

  await R.step('next start: the staged update is handed over before anything else; one already in is tidied away', async () => {
    const calls = await t.main((_, root) => {
      global.__helperCalls = [];
      const { Updater } = global.__require(root + '/src/main/updater.js');
      const u = new Updater();
      u.on('helper', (h) => global.__helperCalls.push(h));
      return { now: u.applyPendingAtStartup(), calls: global.__helperCalls };
    }, ROOT);
    assert(calls.now === true && calls.calls.length === 1, JSON.stringify(calls));
    // An update that's no newer than what runs (already in): removed, nothing to hand over.
    for (const a of ['x64', 'arm64']) fs.writeFileSync(path.join(port, 'App', 'Bifrost-' + a, 'resources', 'app.next', 'bifrost-update.json'), JSON.stringify({ version: VERSION }));
    const again = await t.main((_, root) => { const { Updater } = global.__require(root + '/src/main/updater.js'); return new Updater().applyPendingAtStartup(); }, ROOT);
    assert(again === false, 'nothing handed over');
    assert(!fs.existsSync(path.join(build, 'resources', 'app.next')), 'the old staged files are gone');
  });

  await R.step('a download that doesn’t match its checksum is refused', async () => {
    await reset();
    const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.electron;
    feed = { version: NEXT, runtime, app: Object.assign(asset(appZip), { sha256: '0'.repeat(64) }) };
    const i = await check();
    assert(i.state === 'error' && /damaged/.test(i.error), JSON.stringify(i));
    assert(!fs.existsSync(path.join(build, 'resources', 'app.next')), 'nothing staged');
  });

  await R.step('a newer Electron too: portable gets both whole builds, staged next to the old ones', async () => {
    await reset();
    feed = { version: NEXT, runtime: '99.0.0+wvcus', app: asset(appZip), portable: asset(portZip) };
    const i = await check();
    assert(i.state === 'ready' && i.kind === 'full', JSON.stringify(i));
    for (const a of ['x64', 'arm64']) {
      const next = path.join(port, 'App', 'Bifrost-' + a + '.next');
      assert(fs.readFileSync(path.join(next, 'Bifrost.exe'), 'utf8') === 'new build ' + a, 'the new build for ' + a);
      assert(readJson(path.join(next, 'bifrost-update.json')).kind === 'full', 'marked complete');
    }
    for (const a of ['x64', 'arm64']) fs.rmSync(path.join(port, 'App', 'Bifrost-' + a + '.next'), { recursive: true, force: true });
  });

  await R.step('a release signed for Widevine replaces an unsigned build whole (same Electron); a signed build takes only the new files', async () => {
    await reset();
    const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.electron;
    feed = { version: NEXT, runtime, signed: true, app: asset(appZip), portable: asset(portZip) };
    let i = await check();
    assert(i.state === 'ready' && i.kind === 'full', 'unsigned build: ' + JSON.stringify(i));
    assert(fs.existsSync(path.join(port, 'App', 'Bifrost-x64.next', 'Bifrost.exe')), 'the whole build is staged');
    for (const a of ['x64', 'arm64']) fs.rmSync(path.join(port, 'App', 'Bifrost-' + a + '.next'), { recursive: true, force: true });
    fs.writeFileSync(path.join(build, 'Bifrost.exe.sig'), 'signature');
    try {
      await reset();
      i = await check();
      assert(i.state === 'ready' && i.kind === 'app', 'signed build: ' + JSON.stringify(i));
    } finally {
      fs.rmSync(path.join(build, 'Bifrost.exe.sig'), { force: true });
      for (const a of ['x64', 'arm64']) fs.rmSync(path.join(port, 'App', 'Bifrost-' + a, 'resources', 'app.next'), { recursive: true, force: true });
    }
  });

  await R.step('an installed Bifrost gets the installer for a newer Electron, run with /S /wait /start', async () => {
    await t.close();
    const inst = path.join(TMP, 'Programs', 'Bifrost');
    fs.mkdirSync(path.join(inst, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'resources', 'app', 'package.json'), JSON.stringify({ version: VERSION }));
    t = await launch({ profile: 'updates', fresh: false, env: env(inst) });
    await sleep(800);
    await watchHelper();
    feed = { version: NEXT, runtime: '99.0.0+wvcus', app: asset(appZip), ['win-' + process.arch]: { setup: asset(setupFile) } };
    const i = await check();
    assert(i.state === 'ready' && i.mode === 'installed' && i.kind === 'full', JSON.stringify(i));
    const staged = await t.main(() => global.__require('node:fs').readFileSync(global.__require('electron').app.getPath('userData') + '/update.json', 'utf8'));
    const s = JSON.parse(staged);
    assert(s.version === NEXT && fs.readFileSync(s.file, 'utf8') === 'MZ an installer', staged);
    await t.main(() => global.__bifrost.updater.restart());
    const calls = await until(async () => { const c = await helper(); return c.length ? c : null; }, 3000, 'the helper');
    assert(calls[0].cmd === s.file && calls[0].args.join(' ') === '/S /wait /start', JSON.stringify(calls));
  });

  await R.step('an installed Bifrost with only its own files to update hands over to its uninstaller program (/apply)', async () => {
    await t.main(() => { const fs = global.__require('node:fs'); fs.rmSync(global.__require('electron').app.getPath('userData') + '/update.json', { force: true }); });
    await reset();
    await watchHelper();
    const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.electron;
    feed = { version: NEXT, runtime, app: asset(appZip) };
    const i = await check();
    assert(i.state === 'ready' && i.kind === 'app', JSON.stringify(i));
    await t.main(() => global.__bifrost.updater.restart());
    const calls = await until(async () => { const c = await helper(); return c.length ? c : null; }, 3000, 'the helper');
    assert(/Uninstall Bifrost\.exe$/.test(calls[0].cmd) && calls[0].args.join(' ') === '/apply /start /wait', JSON.stringify(calls));
  });
} finally {
  const errs = t.logs.filter((l) => /pageerror|Uncaught|\[ui error\]/.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close().catch(() => {});
  site.stop();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(R.summary() ? 1 : 0);
}
