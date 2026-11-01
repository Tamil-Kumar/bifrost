'use strict';
// Sync between your computers through a folder that a cloud service (OneDrive, Google Drive, Dropbox, iCloud)
// or Syncthing keeps the same on each. In it, "Bifrost Sync/<computer id>/" holds each computer's own files,
// written only by that computer and read by the others:
//   device.json      its name, Bifrost version and open tabs
//   bookmarks.json.gz  all its bookmarks, with when each part changed, tombstones and aliases (merge.js)
//   history.json.gz  the visits made on it in the last 60 days, and history deleted on it lately
//   settings.json    its settings that follow you, with when each changed
// Nobody writes another computer's files, so a cloud service never sees two computers change one file, and
// every computer merges the others' copies into its own the same way, so they all end up alike.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const ctx = require('../context');
const merge = require('./merge');
const P = require('./payloads');
const { DEFAULTS, setPath, clone } = require('../../shared/defaults');

const DIR = 'Bifrost Sync';
const FORMAT = 1;
const FILES = { device: 'device.json', bookmarks: 'bookmarks.json.gz', history: 'history.json.gz', settings: 'settings.json' };
const DAY = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const POLL_MS = 60000;

// The largest stamp in a bookmarks payload (this computer's clock moves past it).
function maxStamp(b) {
  let m = 0;
  for (const n of b.nodes || []) m = Math.max(m, Number(n.changed) || 0, Number(n.placed) || 0);
  for (const t of Object.values(b.dead || {})) m = Math.max(m, Number(t) || 0);
  for (const v of Object.values(b.aliases || {})) m = Math.max(m, Array.isArray(v) ? Number(v[1]) || 0 : 0);
  return m;
}

// What a payload holds, without when it was written (to tell whether there's anything new to write).
const body = (payload) => JSON.stringify(Object.assign({}, payload, { updated: 0 }));

class Sync extends EventEmitter {
  constructor() {
    super();
    this.root = '';
    this.device = null;
    this.clock = 0;
    this.timers = {};
    this.writing = {};        // kind → the write under way (one at a time, each writing what's there then)
    this.since = {};          // kind → when it first became due (for maxWait)
    this.written = {};        // kind → body of what's in our file
    this.seen = new Map();    // another computer's file → its 'mtime:size' when read
    this.remote = new Map();  // computer id → { device, bookmarks, history, settings, updated }
    this.state = { state: 'off', error: '', lastSync: 0, newer: false };
    this.running = null;
    this.again = false;
    this.applying = false;
    this.paths = merge.syncedPaths(DEFAULTS);
  }

  init() {
    const db = ctx.db;
    try { this.version = require('electron').app.getVersion(); } catch { this.version = ''; }
    this.clock = Math.max(Date.now(), Number(db.kvGet('sync.clock', 0)) || 0);
    db.stamp = () => this.stamp();
    db.on('bookmarks-changed', () => this.soon('bookmarks', 1500));
    db.on('visit', () => this.soon('history', 60000, 240000));
    db.on('history-deleted', (r) => this.noteDeletion(r));
    ctx.settings.on('changed', (e) => this.onSettings(e));
    ctx.sessionStore.onWrite = () => this.soon('device', 8000, 30000);
    // Old tombstones and aliases go (a computer away longer than this may bring a deleted bookmark back).
    try { db.pruneTombstones(Date.now() - 180 * DAY); } catch { /* best effort */ }
    this.configure();
  }

  // A clock for "latest change wins" that never goes back, and moves past any stamp seen from elsewhere, so a
  // change made after seeing another computer's counts as later even if this computer's clock is behind.
  stamp() { this.clock = Math.max(Date.now(), this.clock + 1); return this.clock; }
  observe(t) { if (Number.isFinite(t) && t > this.clock && t < Date.now() + 365 * DAY) this.clock = t; }

  cfg() { return ctx.settings.get('sync'); }
  name() { return (this.cfg().deviceName || '').trim() || os.hostname() || 'This computer'; }

  // Starts, stops or moves sync to match its settings.
  configure() {
    const cfg = this.cfg();
    const folder = cfg.enabled && cfg.folder ? String(cfg.folder) : '';
    const root = folder ? (path.basename(folder) === DIR ? folder : path.join(folder, DIR)) : '';
    const key = JSON.stringify([root, cfg.bookmarks, cfg.history, cfg.tabs, cfg.settings, this.name()]);
    if (key === this.key) return;
    const moved = root !== this.root;
    this.key = key;
    this.stop();
    this.root = root;
    this.seen.clear();   // read everything again (what wasn't synced before may be now)
    if (!root) { this.setState({ state: 'off', error: '' }); return; }
    if (moved) {
      this.remote.clear(); this.written = {};
      // Another sync folder: this computer joins it, so the settings already there win.
      if (ctx.db.kvGet('sync.root', '') !== root) { ctx.db.kvSet('sync.settings', undefined); ctx.db.kvSet('sync.root', root); }
    }
    this.device = this.identity();
    this.mine = path.join(root, this.device.id);
    this.setState({ state: 'syncing', error: '' });
    this.watch();
    this.poller = setInterval(() => this.pull(), POLL_MS);
    this.pull({ first: true });
  }

  stop() {
    if (this.watcher) { try { this.watcher.close(); } catch { /* closed */ } this.watcher = null; }
    clearInterval(this.poller);
    this.poller = null;
    for (const t of Object.values(this.timers)) clearTimeout(t);
    this.timers = {};
    this.since = {};
  }

  // This computer's id, kept in its profile. A profile copied to another computer (a portable Bifrost on a USB
  // stick) gets an id of its own there, so two computers never write the same files.
  identity() {
    const host = os.hostname();
    let d = ctx.db.kvGet('sync.device', null);
    if (!d || !ID_RE.test(String(d.id)) || d.host !== host) { d = { id: crypto.randomBytes(8).toString('hex'), host }; ctx.db.kvSet('sync.device', d); }
    return d;
  }

  watch() {
    try {
      fs.mkdirSync(this.root, { recursive: true });
      this.watcher = fs.watch(this.root, { recursive: true }, (type, name) => {
        const n = String(name || '');
        if (!n || n.startsWith(this.device.id) || /\.tmp$/i.test(n)) return;   // our own writing
        clearTimeout(this.timers.watch);
        this.timers.watch = setTimeout(() => this.pull(), 1500);
      });
      this.watcher.on('error', () => { /* the poll still runs */ });
    } catch { /* not there yet: the poll keeps trying */ }
  }

  setState(patch) {
    const before = JSON.stringify([this.state.state, this.state.error, this.state.newer]);
    Object.assign(this.state, patch);
    if (JSON.stringify([this.state.state, this.state.error, this.state.newer]) !== before) this.emit('changed');
  }

  fail(e) {
    const code = e && e.code;
    const error = code === 'ENOENT' || code === 'ENOTDIR' ? 'Can’t find the sync folder. Is its drive connected?'
      : code === 'EACCES' || code === 'EPERM' ? 'Bifrost isn’t allowed to write to the sync folder.'
      : code === 'ENOSPC' ? 'The sync folder’s drive is full.'
      : 'Sync stopped: ' + ((e && e.message) || e);
    console.warn('[sync]', (e && e.message) || e);
    this.setState({ state: 'error', error });
  }

  // ---------------------------------------------------------------- reading
  pull(opts = {}) {
    if (!this.root) return Promise.resolve();
    if (this.running) {
      // Once the read under way is done (a first read for a new folder stays a first read).
      this.again = true;
      if (opts.first) this.againFirst = true;
      return this.running.then(() => this.next || undefined);
    }
    const root = this.root;
    this.running = this.read(opts).catch((e) => { if (root === this.root) this.fail(e); }).finally(() => {
      this.running = null;
      if (this.again) {
        const first = !!this.againFirst;
        this.again = this.againFirst = false;
        this.next = this.pull({ first });
      } else this.next = null;
    });
    return this.running;
  }

  async readFile(file) {
    let buf = await fsp.readFile(file);
    if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
    return JSON.parse(buf.toString('utf8'));
  }

  async read({ first = false } = {}) {
    const root = this.root;
    await fsp.mkdir(this.mine, { recursive: true });
    if (first) {
      // What's in our own files already (so starting up doesn't write them again for nothing).
      for (const [kind, file] of Object.entries(FILES)) {
        try { this.written[kind] = body(await this.readFile(path.join(this.mine, file))); } catch { delete this.written[kind]; }
      }
    }
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const ids = entries.filter((e) => e.isDirectory() && ID_RE.test(e.name) && e.name !== this.device.id).map((e) => e.name);
    const got = { bookmarks: false, history: new Set(), settings: false, device: false };
    let newer = false;
    for (const id of ids) {
      const r = this.remote.get(id) || {};
      for (const [kind, file] of Object.entries(FILES)) {
        const p = path.join(root, id, file);
        let st;
        try { st = await fsp.stat(p); } catch {
          if (r[kind]) { delete r[kind]; got.device = true; }
          continue;
        }
        r.updated = Math.max(r.updated || 0, st.mtimeMs);
        const sig = st.mtimeMs + ':' + st.size;
        if (this.seen.get(p) === sig) continue;
        let data;
        try { data = await this.readFile(p); } catch { continue; }   // half written, or still downloading: next time
        if (!data || typeof data !== 'object') continue;
        if (Number(data.format) > FORMAT) { newer = true; continue; }
        this.seen.set(p, sig);
        r[kind] = data;
        if (kind === 'history') got.history.add(id); else got[kind] = true;
      }
      this.remote.set(id, r);
    }
    for (const id of [...this.remote.keys()]) if (!ids.includes(id)) { this.remote.delete(id); got.device = true; }
    if (root !== this.root) return;   // sync was moved or turned off meanwhile

    // Put it together with this computer's (all at once: nothing here changes meanwhile).
    const cfg = this.cfg();
    const others = [...this.remote.values()];
    if (cfg.bookmarks && (got.bookmarks || first)) {
      const remotes = others.map((r) => r.bookmarks).filter((b) => b && Array.isArray(b.nodes));
      for (const b of remotes) this.observe(maxStamp(b));
      // The first time this computer meets others' bookmarks in this folder, its own go after theirs.
      if (remotes.length) {
        const joining = ctx.db.kvGet('sync.joined', '') !== root;
        P.applyBookmarks(ctx.db, remotes, this.stamp(), { joining });
        if (joining) ctx.db.kvSet('sync.joined', root);
      }
    }
    if (cfg.history && got.history.size) {
      const known = this.deletions().concat(...others.map((r) => (r.history && Array.isArray(r.history.deletions) ? r.history.deletions : [])));
      for (const id of got.history) P.applyHistory(ctx.db, id, this.remote.get(id).history, known);
    }
    if (cfg.settings && (got.settings || first)) this.mergeSettings(others);
    this.writeAll(first);
    this.setState({ state: 'ok', error: '', lastSync: Date.now(), newer });
    if (first || got.device || got.bookmarks || got.history.size || got.settings) this.emit('changed');
  }

  syncNow() { return this.pull().then(() => this.writeAll(true)).then(() => this.info()); }

  // ---------------------------------------------------------------- settings
  settingsState() { return ctx.db.kvGet('sync.settings', null); }

  mergeSettings(others) {
    const remotes = others.map((r) => r.settings && r.settings.values).filter((v) => v && typeof v === 'object');
    let state = this.settingsState();
    if (!state) {
      // First time in this folder: if other computers already sync settings, theirs win.
      state = {};
      merge.noteSettings(state, ctx.settings.get(), this.paths, () => this.stamp(), remotes.length ? -1 : 0);
    } else {
      // Changed while sync was off: counts as changed now.
      merge.noteSettings(state, ctx.settings.get(), this.paths, () => this.stamp(), 0);
    }
    for (const r of remotes) for (const e of Object.values(r)) if (e && typeof e.t === 'number') this.observe(e.t);
    const apply = merge.mergeSettings(state, remotes, this.paths);
    if (Object.keys(apply).length) {
      const next = clone(ctx.settings.get());
      for (const [p, v] of Object.entries(apply)) setPath(next, p, v);
      this.applying = true;
      try { ctx.settings.replace(next); } finally { this.applying = false; }
      // What the settings took (a value this version can't use stays as it was here, without passing that on).
      const now = ctx.settings.get();
      for (const p of Object.keys(apply)) state[p].v = JSON.stringify(p.split('.').reduce((o, k) => (o == null ? o : o[k]), now) ?? null);
    }
    ctx.db.kvSet('sync.settings', state);
  }

  onSettings(e) {
    const p = e && e.path ? e.path : '';
    if (!p || p === 'sync' || p.startsWith('sync.')) this.configure();
    if (this.applying || !this.root) return;
    const state = this.settingsState();
    if (!state) return;   // noted when the first read finds out whether other computers already sync settings
    if (merge.noteSettings(state, ctx.settings.get(), this.paths, () => this.stamp(), 0)) {
      ctx.db.kvSet('sync.settings', state);
      this.soon('settings', 1500);
    }
  }

  // ---------------------------------------------------------------- history
  deletions() { return ctx.db.kvGet('sync.deletions', []) || []; }

  noteDeletion(r) {
    const list = this.deletions();
    list.push(Object.assign({ at: Date.now() }, r));
    ctx.db.kvSet('sync.deletions', P.recentDeletions(list));
    this.soon('history', 2000);
  }

  // ---------------------------------------------------------------- writing
  // Writes a kind of file a little later (changes in a row go out together; maxWait: at the latest then).
  soon(kind, ms, maxWait) {
    if (!this.root) return;
    if (!this.since[kind]) this.since[kind] = Date.now();
    const wait = maxWait ? Math.max(0, Math.min(ms, this.since[kind] + maxWait - Date.now())) : ms;
    clearTimeout(this.timers[kind]);
    const fire = () => {
      if (this.running) { this.timers[kind] = setTimeout(fire, 500); return; }   // after the read under way
      delete this.timers[kind];
      this.since[kind] = 0;
      this.write(kind);
    };
    this.timers[kind] = setTimeout(fire, wait);
  }

  payload(kind) {
    const cfg = this.cfg();
    const base = { format: FORMAT, updated: Date.now() };
    if (kind === 'device') {
      return Object.assign(base, { id: this.device.id, name: this.name(), platform: process.platform, version: this.version,
        windows: cfg.tabs ? P.tabsPayload(ctx.sessionStore.state) : [] });
    }
    if (kind === 'bookmarks') return cfg.bookmarks ? Object.assign(base, P.bookmarksPayload(ctx.db)) : null;
    if (kind === 'history') return cfg.history ? Object.assign(base, P.historyPayload(ctx.db, this.deletions())) : null;
    if (kind === 'settings') {
      if (!cfg.settings) return null;
      const state = this.settingsState();
      return state ? Object.assign(base, { values: merge.settingsPayload(state) }) : undefined;
    }
    return undefined;
  }

  write(kind) {
    const p = (this.writing[kind] || Promise.resolve()).then(() => this.writeNow(kind)).catch((e) => this.fail(e));
    this.writing[kind] = p;
    return p;
  }

  async writeNow(kind) {
    if (!this.root || !this.device) return;
    const data = this.payload(kind);
    if (data === undefined) return;
    const file = path.join(this.mine, FILES[kind]);
    if (data === null) {
      if (this.written[kind] !== null) { await fsp.rm(file, { force: true }); this.written[kind] = null; }
      return;
    }
    const b = body(data);
    if (this.written[kind] === b) return;
    let buf = Buffer.from(JSON.stringify(data));
    if (file.endsWith('.gz')) buf = zlib.gzipSync(buf);
    await fsp.mkdir(this.mine, { recursive: true });
    const tmp = path.join(this.mine, '~' + FILES[kind] + '.' + crypto.randomBytes(3).toString('hex') + '.tmp');
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, file).catch(async (e) => { await fsp.rm(tmp, { force: true }); throw e; });
    this.written[kind] = b;
    if (kind === 'bookmarks') ctx.db.kvSet('sync.clock', this.clock);
  }

  writeAll(force) {
    const kinds = force ? Object.keys(FILES) : Object.keys(FILES).filter((k) => this.timers[k]);
    for (const k of kinds) { clearTimeout(this.timers[k]); delete this.timers[k]; this.since[k] = 0; }
    return Promise.all(kinds.map((k) => this.write(k)));
  }

  // As Bifrost closes: what's still waiting goes out now.
  flushSync() {
    if (!this.root || !this.device) return;
    try { ctx.db.kvSet('sync.clock', this.clock); } catch { /* closing */ }
    const kinds = Object.keys(this.timers).filter((k) => FILES[k]).concat('device');
    for (const kind of new Set(kinds)) {
      clearTimeout(this.timers[kind]);
      delete this.timers[kind];
      try {
        const data = this.payload(kind);
        if (!data) continue;
        const b = body(data);
        if (this.written[kind] === b) continue;
        let buf = Buffer.from(JSON.stringify(data));
        if (FILES[kind].endsWith('.gz')) buf = zlib.gzipSync(buf);
        fs.mkdirSync(this.mine, { recursive: true });
        const tmp = path.join(this.mine, '~' + FILES[kind] + '.' + crypto.randomBytes(3).toString('hex') + '.tmp');
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, path.join(this.mine, FILES[kind]));
        this.written[kind] = b;
      } catch (e) { console.warn('[sync] couldn’t save', kind, e.message); }
    }
  }

  // ---------------------------------------------------------------- for the UI
  info() {
    const cfg = this.cfg();
    const devices = [...this.remote.entries()].map(([id, r]) => {
      const d = r.device || {};
      return { id, name: String(d.name || 'Another computer'), platform: d.platform || '', version: d.version || '', updated: r.updated || 0,
        tabs: Array.isArray(d.windows) ? d.windows.reduce((n, w) => n + ((w && Array.isArray(w.tabs)) ? w.tabs.length : 0), 0) : 0 };
    }).sort((a, b) => b.updated - a.updated);
    return { enabled: !!(cfg.enabled && cfg.folder), folder: cfg.folder || '', root: this.root, state: this.state.state, error: this.state.error,
      lastSync: this.state.lastSync, newer: this.state.newer, device: { id: this.device ? this.device.id : '', name: this.name(), host: os.hostname() }, devices };
  }

  // Open tabs on the other computers: [{ id, name, updated, windows: [{ tabs: [{ url, title, icon }] }] }].
  remoteTabs() {
    if (!this.root || !this.cfg().tabs) return [];
    return [...this.remote.entries()].map(([id, r]) => {
      const d = r.device || {};
      const windows = (Array.isArray(d.windows) ? d.windows : []).map((w) => ({ tabs: (w && Array.isArray(w.tabs) ? w.tabs : []).filter((t) => t && typeof t.url === 'string' && /^(https?|ftp):/i.test(t.url)).map((t) => ({ url: t.url, title: String(t.title || ''), icon: typeof t.icon === 'string' ? t.icon : '', space: String(t.space || ''), pinned: !!t.pinned })) })).filter((w) => w.tabs.length);
      return { id, name: String(d.name || 'Another computer'), updated: Math.max(r.updated || 0, Number(d.updated) || 0), windows };
    }).filter((d) => d.windows.length).sort((a, b) => b.updated - a.updated);
  }

  // Removes another computer's files from the sync folder (one you don't use any more).
  async removeDevice(id) {
    if (!this.root || !ID_RE.test(id) || id === this.device.id) throw new Error('unknown computer');
    await fsp.rm(path.join(this.root, id), { recursive: true, force: true });
    this.remote.delete(id);
    for (const k of [...this.seen.keys()]) if (k.startsWith(path.join(this.root, id) + path.sep)) this.seen.delete(k);
    this.emit('changed');
    return this.info();
  }

  // Cloud folders on this computer, to offer as the sync folder.
  suggestFolders() {
    const home = os.homedir();
    const out = [];
    const add = (name, p) => { try { if (p && fs.statSync(p).isDirectory() && !out.some((x) => x.path === p)) out.push({ name, path: p }); } catch { /* not there */ } };
    const env = process.env;
    add('OneDrive', env.OneDriveConsumer);
    add('OneDrive', env.OneDrive);
    add('OneDrive (work or school)', env.OneDriveCommercial);
    for (const base of [env.APPDATA, env.LOCALAPPDATA, path.join(home, '.dropbox')]) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(base || '', 'Dropbox', 'info.json'), 'utf8'));
        if (info.personal) add('Dropbox', info.personal.path);
        if (info.business) add('Dropbox (work)', info.business.path);
      } catch { /* no Dropbox */ }
      try {
        const info = JSON.parse(fs.readFileSync(path.join(base || '', 'info.json'), 'utf8'));
        if (info.personal) add('Dropbox', info.personal.path);
      } catch { /* no Dropbox */ }
    }
    add('Dropbox', path.join(home, 'Dropbox'));
    if (process.platform === 'win32') { add('Google Drive', 'G:\\My Drive'); add('iCloud Drive', path.join(home, 'iCloudDrive')); }
    add('Google Drive', path.join(home, 'Google Drive'));
    add('Google Drive', path.join(home, 'My Drive'));
    if (process.platform === 'darwin') add('iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    add('OneDrive', path.join(home, 'OneDrive'));
    add('Syncthing', path.join(home, 'Sync'));
    return out;
  }
}

module.exports = { Sync, DIR, FILES };
