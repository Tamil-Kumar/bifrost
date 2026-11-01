'use strict';
// Updates. Bifrost checks its releases on GitHub (Tamil-Kumar/bifrost) a minute after it starts and every
// few hours, downloads a newer version in the background, checks it against the release's checksums, and
// puts it in place when Bifrost next starts (or right away: "Restart to update").
//   - Most releases change only Bifrost's own files: just those come (a few MB), into resources\app.next.
//   - A release on a newer Electron: the installer (installed Bifrost), or both new builds (portable),
//     into App\Bifrost-<arch>.next.
// The swap happens while Bifrost isn't running: an installed Bifrost's "Uninstall Bifrost.exe" (/apply)
// or the installer (/wait), and a portable Bifrost's BifrostPortable.exe, do it before they start it again.
// A signed release (Widevine) replaces an unsigned build whole: the signature belongs to Bifrost.exe.
// Only the Windows builds that the release workflow makes update themselves; Bifrost run from source,
// or on Linux, doesn't.
const electron = require('electron');
const { app, net } = electron;
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const ctx = require('./context');
const { unzipInWorker } = require('./unzip');

const REPO = 'Tamil-Kumar/bifrost';
const TEST = process.env.BIFROST_TEST === '1';
const FEED = (TEST && process.env.BIFROST_UPDATE_FEED) || `https://github.com/${REPO}/releases/latest/download/latest.json`;
const FIRST_CHECK_MS = TEST && process.env.BIFROST_UPDATE_FIRST_MS ? Number(process.env.BIFROST_UPDATE_FIRST_MS) : 60 * 1000;
const EVERY_MS = 6 * 3600 * 1000;
const MARK = 'bifrost-update.json';     // written last into a staged folder: it's complete
// The Electron this runs on, as package.json's engines.electron (and a release's latest.json) names it:
// castlabs' builds (with Widevine) report a plain version, but carry the components API.
const RUNTIME = process.versions.electron + (electron.components ? '+wvcus' : '');

// "1.10.2" > "1.9.9"
function newer(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// How this Bifrost was installed: { kind: 'installed' | 'portable', build (folder of Bifrost.exe), root
// (portable: the BifrostPortable folder), helper (the program that swaps in an update) } or { kind: null,
// why } when it can't update itself.
function layout() {
  const exe = app.getPath('exe');
  const build = TEST && process.env.BIFROST_UPDATE_BUILD ? process.env.BIFROST_UPDATE_BUILD : path.dirname(exe);
  if (!TEST && process.platform !== 'win32') return { kind: null, why: 'Bifrost updates itself on Windows; elsewhere, get new versions from its releases page.' };
  if (!TEST && path.basename(exe).toLowerCase() !== 'bifrost.exe') return { kind: null, why: 'This Bifrost runs from its source files, so it doesn’t update itself.' };
  if (fs.existsSync(path.join(build, 'portable.ini'))) {
    const root = path.dirname(path.dirname(build));
    const helper = path.join(root, 'BifrostPortable.exe');
    if (path.basename(path.dirname(build)) === 'App' && (TEST || fs.existsSync(helper))) return { kind: 'portable', build, root, helper };
    return { kind: null, why: 'This portable Bifrost isn’t in a BifrostPortable folder, so it doesn’t update itself.' };
  }
  if (fs.existsSync(path.join(build, 'portable'))) return { kind: null, why: 'This portable Bifrost (one build on its own) doesn’t update itself.' };
  const helper = path.join(build, 'Uninstall Bifrost.exe');
  if (TEST || fs.existsSync(helper)) return { kind: 'installed', build, helper };
  return { kind: null, why: 'This Bifrost wasn’t installed by its installer, so it doesn’t update itself.' };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// Whether this build is signed for Widevine (its Bifrost.exe.sig). An update of only Bifrost's own files
// keeps Bifrost.exe and its signature as they are, so an unsigned build takes a signed release whole.
function signedBuild(where) { return !!(where && where.build) && fs.existsSync(path.join(where.build, 'Bifrost.exe.sig')); }

// What's waiting to be swapped in: [{ folder, version, kind }].
function staged(where) {
  const out = [];
  const look = (folder) => { const m = readJson(path.join(folder, MARK)); if (m && m.version) out.push({ folder, version: String(m.version), kind: m.kind || '' }); };
  if (where.kind === 'installed') look(path.join(where.build, 'resources', 'app.next'));
  if (where.kind === 'portable') {
    const appDir = path.join(where.root, 'App');
    let names = [];
    try { names = fs.readdirSync(appDir); } catch { /* none */ }
    for (const n of names) {
      if (/^Bifrost-(x64|arm64)\.next$/i.test(n)) look(path.join(appDir, n));
      else if (/^Bifrost-(x64|arm64)$/i.test(n)) look(path.join(appDir, n, 'resources', 'app.next'));
    }
  }
  return out;
}

class Updater extends EventEmitter {
  constructor() {
    super();
    this.where = layout();
    this.state = { state: this.where.kind ? 'idle' : 'off', latest: '', progress: 0, error: '', checkedAt: 0, kind: '', notes: '', url: `https://github.com/${REPO}/releases` };
    this.timer = null;
    this.busy = null;
  }

  // At startup, before anything else: an update downloaded last time goes in now (the helper swaps it in and
  // starts Bifrost again). Returns true if Bifrost should quit at once.
  applyPendingAtStartup() {
    if (!this.where.kind || process.argv.includes('--no-update')) return false;
    const current = app.getVersion();
    const ready = staged(this.where);
    const fresh = ready.filter((s) => newer(s.version, current));
    // Left over from an update that's already in (or older than this one): tidy up.
    for (const s of ready) if (!fresh.includes(s)) fs.rmSync(s.folder, { recursive: true, force: true });
    const installer = this.stagedInstaller();
    if (installer && !newer(installer.version, current)) { fs.rmSync(installer.file, { force: true }); this.setStaged(null); }
    if (!fresh.length && !(installer && newer(installer.version, current))) return false;
    try { this.runHelper({ wait: false }); return true; } catch (e) { console.warn('[updates] couldn’t put the update in: ' + e.message); return false; }
  }

  init() {
    if (!this.where.kind) return;
    ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('updates')) this.schedule(); });
    this.schedule(FIRST_CHECK_MS);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (!this.where.kind) return;
    this.timer = setTimeout(() => { this.check({ auto: true }).catch(() => {}); this.schedule(EVERY_MS); }, ms != null ? ms : EVERY_MS);
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('changed', this.info());
  }

  info() {
    return Object.assign({ enabled: !!this.where.kind, why: this.where.why || '', mode: this.where.kind || '', current: app.getVersion(), auto: ctx.settings ? ctx.settings.get('updates.auto') !== false : true }, this.state);
  }

  stagedFile() { return path.join(app.getPath('userData'), 'update.json'); }
  stagedInstaller() { const s = readJson(this.stagedFile()); return s && s.file && fs.existsSync(s.file) ? s : null; }
  setStaged(s) { if (s) fs.writeFileSync(this.stagedFile(), JSON.stringify(s)); else fs.rmSync(this.stagedFile(), { force: true }); }

  async feed() {
    const res = await net.fetch(FEED + (FEED.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'no release has been published yet' : `GitHub answered ${res.status}`);
    const f = await res.json();
    if (!f || typeof f.version !== 'string') throw new Error('the release information is unreadable');
    return f;
  }

  // Looks for a newer version; with auto (or download: true), downloads it too.
  check({ auto = false, download } = {}) {
    if (!this.where.kind) return Promise.resolve(this.info());
    if (this.busy) return this.busy;
    const run = async () => {
      if (this.state.state === 'ready') return;
      this.set({ state: 'checking', error: '' });
      let f;
      try { f = await this.feed(); } catch (e) { this.set({ state: 'error', error: 'Couldn’t check for updates: ' + e.message, checkedAt: Date.now() }); return; }
      const current = app.getVersion();
      if (!newer(f.version, current)) { this.set({ state: 'current', latest: f.version, checkedAt: Date.now() }); return; }
      const kind = f.runtime && f.runtime === RUNTIME && f.app && !(f.signed && !signedBuild(this.where)) ? 'app' : 'full';
      this.set({ state: 'available', latest: f.version, kind, notes: String(f.notes || ''), checkedAt: Date.now(), url: `https://github.com/${REPO}/releases/tag/v${f.version}` });
      const go = download != null ? download : (!auto || ctx.settings.get('updates.auto') !== false);
      if (go) await this.fetchAndStage(f, kind);
    };
    this.busy = run().finally(() => { this.busy = null; });
    return this.busy.then(() => this.info());
  }

  async download(asset, dest) {
    const url = asset.url || `https://github.com/${REPO}/releases/download/v${this.state.latest}/${encodeURIComponent(asset.file)}`;
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || Number(asset.size) || 0;
    const hash = crypto.createHash('sha256');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest + '.part');
    let got = 0, shown = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        got += buf.length;
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        if (total && got - shown > total / 50) { shown = got; this.set({ progress: Math.min(0.99, got / total) }); }
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (e) { out.destroy(); await fsp.rm(dest + '.part', { force: true }); throw e; }
    const digest = hash.digest('hex');
    if (asset.sha256 && digest !== String(asset.sha256).toLowerCase()) { await fsp.rm(dest + '.part', { force: true }); throw new Error('the download was damaged on the way (its checksum doesn’t match); it’ll be tried again later'); }
    await fsp.rm(dest, { force: true });
    await fsp.rename(dest + '.part', dest);
    return dest;
  }

  async fetchAndStage(f, kind) {
    const w = this.where;
    const work = path.join(app.getPath('userData'), 'updates');
    this.set({ state: 'downloading', progress: 0, error: '' });
    try {
      await fsp.mkdir(work, { recursive: true });
      const mark = (folder, k) => fs.writeFileSync(path.join(folder, MARK), JSON.stringify({ version: f.version, kind: k, at: Date.now() }));
      if (kind === 'app') {
        const zip = await this.download(f.app, path.join(work, `Bifrost-${f.version}-app.zip`));
        const builds = w.kind === 'portable' ? this.portableBuilds() : [w.build];
        for (const b of builds) {
          const dest = path.join(b, 'resources', 'app.next');
          await fsp.rm(dest, { recursive: true, force: true });
          await unzipInWorker(zip, dest);
          const pkg = readJson(path.join(dest, 'package.json'));
          if (!pkg || pkg.version !== f.version) throw new Error('the update doesn’t hold Bifrost ' + f.version);
          mark(dest, 'app');
        }
        await fsp.rm(zip, { force: true });
      } else if (w.kind === 'installed') {
        const a = f['win-' + process.arch];
        if (!a || !a.setup) throw new Error('this release has no installer for ' + process.arch);
        const file = await this.download(a.setup, path.join(work, a.setup.file));
        this.setStaged({ version: f.version, file });
      } else {
        if (!f.portable) throw new Error('this release has no portable Bifrost');
        const zip = await this.download(f.portable, path.join(work, f.portable.file));
        const tmp = path.join(work, 'portable');
        await fsp.rm(tmp, { recursive: true, force: true });
        await unzipInWorker(zip, tmp);
        // The zip holds BifrostPortable\App\Bifrost-<arch>: each build this folder has goes next to it as .next.
        const inner = fs.existsSync(path.join(tmp, 'App')) ? tmp : path.join(tmp, fs.readdirSync(tmp)[0] || '');
        for (const b of this.portableBuilds()) {
          const from = path.join(inner, 'App', path.basename(b));
          if (!fs.existsSync(path.join(from, 'Bifrost.exe')) && !TEST) continue;
          const dest = b + '.next';
          await fsp.rm(dest, { recursive: true, force: true });
          await fsp.rename(from, dest).catch(() => fsp.cp(from, dest, { recursive: true }));
          mark(dest, 'full');
        }
        await fsp.rm(tmp, { recursive: true, force: true });
        await fsp.rm(zip, { force: true });
      }
      this.set({ state: 'ready', progress: 1 });
    } catch (e) {
      this.set({ state: 'error', error: 'Couldn’t download Bifrost ' + f.version + ': ' + e.message, progress: 0 });
    }
  }

  portableBuilds() {
    const appDir = path.join(this.where.root, 'App');
    return fs.readdirSync(appDir).filter((n) => /^Bifrost-(x64|arm64)$/i.test(n)).map((n) => path.join(appDir, n)).filter((b) => fs.existsSync(path.join(b, 'resources', 'app')));
  }

  // The program that swaps the update in (once Bifrost has quit) and starts Bifrost again.
  runHelper({ wait }) {
    const w = this.where;
    const installer = this.stagedInstaller();
    let cmd, args;
    if (w.kind === 'installed' && installer && newer(installer.version, app.getVersion())) { cmd = installer.file; args = ['/S', '/wait', '/start']; }
    else if (w.kind === 'installed') { cmd = w.helper; args = ['/apply', '/start'].concat(wait ? ['/wait'] : []); }
    else { cmd = w.helper; args = ['--bifrost-apply-update']; }
    if (TEST) { this.emit('helper', { cmd, args }); return; }
    // Coming back with the tabs that were open, whatever happens at startup otherwise.
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'restore-once'), ''); } catch { /* best effort */ }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: path.dirname(cmd) });
    child.unref();
  }

  // "Restart to update".
  restart() {
    if (this.state.state !== 'ready') return false;
    this.runHelper({ wait: true });
    if (!TEST) { ctx.quitting = true; app.quit(); }
    return true;
  }
}

module.exports = { Updater, newer, layout, staged, MARK, RUNTIME };
