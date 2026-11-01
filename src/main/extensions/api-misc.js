'use strict';
// chrome.storage.sync / .managed, chrome.identity, chrome.fontSettings and chrome.privacy.
const { app, BrowserWindow, webContents: WC } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const ctx = require('../context');

// -------------------------------------------------------------- sync storage
// Per-extension JSON files under the profile. Nothing leaves the computer; "sync" here just means a
// separate area from storage.local, which is what extensions rely on.
class SyncStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
  }
  file(id) { return path.join(this.dir, id.replace(/[^a-z0-9]/gi, '') + '.json'); }
  data(id) {
    let d = this.cache.get(id);
    if (!d) {
      try { d = JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { d = {}; }
      if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
      this.cache.set(id, d);
    }
    return d;
  }
  save(id) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.flush(id), 250));
  }
  flush(id) {
    this.timers.delete(id);
    const d = this.cache.get(id);
    if (!d) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file(id) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(d));
      fs.renameSync(tmp, this.file(id));
    } catch (e) { console.error('[extensions] storage.sync write', e.message); }
  }
  flushAll() { for (const id of [...this.timers.keys()]) { clearTimeout(this.timers.get(id)); this.flush(id); } }
  drop(id) { this.cache.delete(id); clearTimeout(this.timers.get(id)); this.timers.delete(id); fs.rmSync(this.file(id), { force: true }); }
}

// storage.get's argument: null (everything), a key, a list of keys, or an object of defaults.
function pick(data, keys) {
  if (keys == null) return JSON.parse(JSON.stringify(data));
  const out = {};
  if (typeof keys === 'string') { if (keys in data) out[keys] = clone(data[keys]); return out; }
  if (Array.isArray(keys)) { for (const k of keys) if (typeof k === 'string' && k in data) out[k] = clone(data[k]); return out; }
  if (typeof keys === 'object') { for (const [k, def] of Object.entries(keys)) out[k] = k in data ? clone(data[k]) : def; return out; }
  throw new Error('Invalid key specification.');
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sizeOf = (k, v) => Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v) || '');

function install({ handle, router, extensions }) {
  // contextMenus.update (the library has none), and items hidden with visible: false.
  const cm = extensions.ece.api && extensions.ece.api.contextMenus;
  if (cm) {
    handle('contextMenus.update', (ev, id, props = {}) => {
      const items = cm.menus.get(ev.extension.id);
      const cur = items && items.get(id);
      if (!cur) throw new Error(`Cannot find menu item with id ${id}`);
      for (const [k, v] of Object.entries(props || {})) if (k !== 'id' && k !== 'onclick' && v !== undefined) cur[k] = v;
      return undefined;
    }, { permission: 'contextMenus' });
    const visibleOnly = (fn) => (...args) => {
      const all = cm.menus;
      cm.menus = new Map([...all].map(([ext, items]) => [ext, new Map([...items].filter(([, p]) => p.visible !== false))]));
      try { return fn(...args); } finally { cm.menus = all; }
    };
    cm.buildMenuItemsForParams = visibleOnly(cm.buildMenuItemsForParams.bind(cm));
    cm.buildMenuItemsForExtension = visibleOnly(cm.buildMenuItemsForExtension.bind(cm));
    cm.ctx.store.buildMenuItems = cm.buildMenuItemsForExtension;   // (what the toolbar button's menu uses)
  }

  // ------------------------------------------- events workers don't hear
  // On Electron before 44.10 (see workerEventsBroken in preload.js): what an extension page wrote to its
  // local or session storage reaches its worker as storage.onChanged ...
  handle('storage.wrote', (ev, areaName, changes) => {
    if (ev.type === 'service-worker' || !ev.extension || !changes || typeof changes !== 'object') return;   // (a worker hears its own writes itself)
    if (areaName !== 'local' && areaName !== 'session') return;
    router.sendEvent(ev.extension.id, 'storage.onWorkerChanged', changes, areaName);
  }, { permission: 'storage' });
  // ... and alarms are Bifrost's own: kept (across restarts too) and fired as alarms.onAlarm.
  const alarms = new Map();   // extension id -> Map(name -> { name, scheduledTime, periodInMinutes, timer })
  const ALARMS_KEY = 'extensions.alarms';
  const saveAlarms = () => {
    const out = {};
    for (const [id, m] of alarms) if (m.size) out[id] = [...m.values()].map(({ name, scheduledTime, periodInMinutes }) => ({ name, scheduledTime, periodInMinutes }));
    try { require('../context').db.kvSet(ALARMS_KEY, out); } catch { /* closing */ }
  };
  const plain = (a) => (a ? Object.assign({ name: a.name, scheduledTime: a.scheduledTime }, a.periodInMinutes ? { periodInMinutes: a.periodInMinutes } : {}) : undefined);
  const arm = (id, a) => {
    clearTimeout(a.timer);
    a.timer = setTimeout(() => {
      const m = alarms.get(id);
      if (!m || m.get(a.name) !== a) return;
      router.sendEvent(id, 'alarms.onAlarm', plain(a));
      if (a.periodInMinutes) { a.scheduledTime = Math.max(Date.now(), a.scheduledTime) + a.periodInMinutes * 60000; arm(id, a); }
      else m.delete(a.name);
      saveAlarms();
    }, Math.min(Math.max(0, a.scheduledTime - Date.now()), 2147483647));
  };
  const setAlarm = (id, name, scheduledTime, periodInMinutes) => {
    if (!alarms.has(id)) alarms.set(id, new Map());
    const m = alarms.get(id);
    if (m.has(name)) clearTimeout(m.get(name).timer);
    const a = { name, scheduledTime, periodInMinutes: periodInMinutes > 0 ? periodInMinutes : undefined, timer: null };
    m.set(name, a);
    arm(id, a);
  };
  try {
    for (const [id, list] of Object.entries(require('../context').db.kvGet(ALARMS_KEY, {}) || {})) for (const a of list || []) setAlarm(id, String(a.name || ''), Number(a.scheduledTime) || Date.now(), Number(a.periodInMinutes) || 0);
  } catch { /* none */ }
  handle('alarms.create', (ev, name, info = {}) => {
    const delay = Number(info.delayInMinutes), period = Number(info.periodInMinutes), when = Number(info.when);
    const at = Number.isFinite(when) ? when : Date.now() + (Number.isFinite(delay) ? delay : Number.isFinite(period) ? period : 0) * 60000;
    setAlarm(ev.extension.id, String(name || ''), at, Number.isFinite(period) ? period : 0);
    saveAlarms();
  }, { permission: 'alarms' });
  handle('alarms.get', (ev, name) => plain((alarms.get(ev.extension.id) || new Map()).get(String(name || ''))), { permission: 'alarms' });
  handle('alarms.getAll', (ev) => [...(alarms.get(ev.extension.id) || new Map()).values()].map(plain), { permission: 'alarms' });
  handle('alarms.clear', (ev, name) => {
    const m = alarms.get(ev.extension.id);
    const a = m && m.get(String(name || ''));
    if (!a) return false;
    clearTimeout(a.timer); m.delete(a.name); saveAlarms();
    return true;
  }, { permission: 'alarms' });
  handle('alarms.clearAll', (ev) => {
    const m = alarms.get(ev.extension.id);
    if (!m || !m.size) return false;
    for (const a of m.values()) clearTimeout(a.timer);
    m.clear(); saveAlarms();
    return true;
  }, { permission: 'alarms' });
  extensions.forgetAlarms = (id) => { const m = alarms.get(id); if (m) { for (const a of m.values()) clearTimeout(a.timer); alarms.delete(id); saveAlarms(); } };

  // ------------------------------------------------------- storage.sync
  const store = new SyncStore(path.join(app.getPath('userData'), 'Extension Sync Storage'));
  extensions.syncStore = store;
  app.on('before-quit', () => store.flushAll());
  const changed = (id, changes) => { if (Object.keys(changes).length) router.sendEvent(id, 'storage.onAreaChanged', changes, 'sync'); };
  const idOf = (ev) => { if (!ev.extension) throw new Error('Unknown extension'); return ev.extension.id; };

  handle('storage.sync.get', (ev, keys) => pick(store.data(idOf(ev)), keys), { permission: 'storage' });
  handle('storage.sync.getKeys', (ev) => Object.keys(store.data(idOf(ev))), { permission: 'storage' });
  handle('storage.sync.getBytesInUse', (ev, keys) => {
    const d = store.data(idOf(ev));
    const list = keys == null ? Object.keys(d) : [].concat(keys);
    return list.reduce((n, k) => n + (k in d ? sizeOf(k, d[k]) : 0), 0);
  }, { permission: 'storage' });
  handle('storage.sync.set', (ev, items) => {
    if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('Invalid items.');
    const id = idOf(ev), d = store.data(id), changes = {};
    for (const [k, v] of Object.entries(items)) {
      if (v === undefined) continue;
      const before = d[k];
      const next = clone(v);
      if (JSON.stringify(before) === JSON.stringify(next)) continue;
      changes[k] = before === undefined ? { newValue: next } : { oldValue: before, newValue: next };
      d[k] = next;
    }
    store.save(id);
    changed(id, changes);
  }, { permission: 'storage' });
  handle('storage.sync.remove', (ev, keys) => {
    const id = idOf(ev), d = store.data(id), changes = {};
    for (const k of [].concat(keys || [])) if (k in d) { changes[k] = { oldValue: d[k] }; delete d[k]; }
    store.save(id);
    changed(id, changes);
  }, { permission: 'storage' });
  handle('storage.sync.clear', (ev) => {
    const id = idOf(ev), d = store.data(id), changes = {};
    for (const k of Object.keys(d)) { changes[k] = { oldValue: d[k] }; delete d[k]; }
    store.save(id);
    changed(id, changes);
  }, { permission: 'storage' });
  handle('storage.sync.setAccessLevel', () => undefined, { permission: 'storage' });

  // Managed storage holds administrator policy; Bifrost has none.
  const readOnly = () => { throw new Error('This is a read-only store.'); };
  handle('storage.managed.get', (ev, keys) => pick({}, keys), { permission: 'storage' });
  handle('storage.managed.getKeys', () => [], { permission: 'storage' });
  handle('storage.managed.getBytesInUse', () => 0, { permission: 'storage' });
  handle('storage.managed.set', readOnly, { permission: 'storage' });
  handle('storage.managed.remove', readOnly, { permission: 'storage' });
  handle('storage.managed.clear', readOnly, { permission: 'storage' });
  handle('storage.managed.setAccessLevel', readOnly, { permission: 'storage' });

  // ----------------------------------------------------------- identity
  handle('identity.launchWebAuthFlow', (ev, details = {}) => launchWebAuthFlow(idOf(ev), details), { permission: 'identity' });
  handle('identity.getAuthToken', () => { throw new Error('The user is not signed in.'); }, { permission: 'identity' });
  handle('identity.removeCachedAuthToken', () => undefined, { permission: 'identity' });
  handle('identity.clearAllCachedAuthTokens', () => undefined, { permission: 'identity' });
  handle('identity.getProfileUserInfo', () => ({ email: '', id: '' }), { permission: 'identity' });
  handle('identity.getAccounts', () => [], { permission: 'identity' });

  // ------------------------------------------------------- fontSettings
  const level = 'controllable_by_this_extension';
  handle('fontSettings.getFontList', () => fontList(), { permission: 'fontSettings' });
  handle('fontSettings.getFont', () => ({ fontId: '', levelOfControl: level }), { permission: 'fontSettings' });
  handle('fontSettings.getDefaultFontSize', () => ({ pixelSize: 16, levelOfControl: level }), { permission: 'fontSettings' });
  handle('fontSettings.getDefaultFixedFontSize', () => ({ pixelSize: 13, levelOfControl: level }), { permission: 'fontSettings' });
  handle('fontSettings.getMinimumFontSize', () => ({ pixelSize: 0, levelOfControl: level }), { permission: 'fontSettings' });
  for (const m of ['setFont', 'clearFont', 'setDefaultFontSize', 'clearDefaultFontSize', 'setDefaultFixedFontSize', 'clearDefaultFixedFontSize', 'setMinimumFontSize', 'clearMinimumFontSize']) {
    handle('fontSettings.' + m, () => undefined, { permission: 'fontSettings' });
  }

  // ------------------------------------------------------------ privacy
  const PRIVACY_DEFAULTS = {
    'network.networkPredictionEnabled': true, 'network.webRTCIPHandlingPolicy': 'default',
    'services.alternateErrorPagesEnabled': false, 'services.autofillAddressEnabled': false, 'services.autofillCreditCardEnabled': false,
    'services.autofillEnabled': false, 'services.passwordSavingEnabled': false, 'services.safeBrowsingEnabled': false,
    'services.safeBrowsingExtendedReportingEnabled': false, 'services.searchSuggestEnabled': true, 'services.spellingServiceEnabled': false,
    'services.translationServiceEnabled': false, 'websites.adMeasurementEnabled': false, 'websites.doNotTrackEnabled': false,
    'websites.fledgeEnabled': false, 'websites.hyperlinkAuditingEnabled': true, 'websites.protectedContentEnabled': true,
    'websites.referrersEnabled': true, 'websites.relatedWebsiteSetsEnabled': false, 'websites.thirdPartyCookiesAllowed': true, 'websites.topicsEnabled': false,
  };
  const KEY = 'extensions.privacy';
  const stored = () => ctx.db.kvGet(KEY, {}) || {};
  const checkPath = (p) => { if (!Object.prototype.hasOwnProperty.call(PRIVACY_DEFAULTS, p)) throw new Error('Unknown setting'); };
  const current = (p) => {
    const s = stored()[p];
    if (s) return s.value;
    if (p === 'websites.doNotTrackEnabled') return !!ctx.settings.get('privacy.doNotTrack');
    if (p === 'websites.referrersEnabled') return !!ctx.settings.get('privacy.sendReferrer');
    return PRIVACY_DEFAULTS[p];
  };
  handle('privacy.get', (ev, p) => {
    checkPath(p);
    const s = stored()[p];
    return { value: current(p), levelOfControl: s ? (s.by === ev.extension.id ? 'controlled_by_this_extension' : 'controlled_by_other_extensions') : 'controllable_by_this_extension' };
  });
  handle('privacy.set', (ev, p, details = {}) => {
    checkPath(p);
    if (typeof details.value !== typeof PRIVACY_DEFAULTS[p]) throw new Error('Invalid value for ' + p);
    const all = stored();
    all[p] = { value: details.value, by: ev.extension.id };
    ctx.db.kvSet(KEY, all);
    applyPrivacy(p, details.value);
    router.broadcastEvent('privacy.onChange.' + p, { value: details.value, levelOfControl: 'controlled_by_other_extensions' });
  });
  handle('privacy.clear', (ev, p) => {
    checkPath(p);
    const all = stored();
    if (all[p] && all[p].by === ev.extension.id) {
      delete all[p];
      ctx.db.kvSet(KEY, all);
      applyPrivacy(p, current(p));
      router.broadcastEvent('privacy.onChange.' + p, { value: current(p), levelOfControl: 'controllable_by_this_extension' });
    }
  });

  // Applies settings Bifrost can act on; called for new tabs too.
  function applyPrivacy(p, value) {
    if (p !== 'network.webRTCIPHandlingPolicy') return;
    for (const wc of WC.getAllWebContents()) {
      if (wc.getType() === 'webview' && wc.session === ctx.mainSession) { try { wc.setWebRTCIPHandlingPolicy(value); } catch { /* destroyed */ } }
    }
  }
  extensions.webrtcPolicy = () => current('network.webRTCIPHandlingPolicy');
  extensions.forgetPrivacy = (id) => {
    const all = stored();
    let any = false;
    for (const [p, s] of Object.entries(all)) if (s.by === id) { delete all[p]; any = true; applyPrivacy(p, PRIVACY_DEFAULTS[p]); }
    if (any) ctx.db.kvSet(KEY, all);
  };
}

// --------------------------------------------------------- web auth flow
// Opens the provider's sign-in page; finishes when it redirects to https://<id>.chromiumapp.org/.
function launchWebAuthFlow(extensionId, details) {
  const start = String(details.url || '');
  if (!/^https?:\/\//i.test(start)) return Promise.reject(new Error('Invalid URL.'));
  const interactive = !!details.interactive;
  const prefix = `https://${extensionId}.chromiumapp.org/`;
  return new Promise((resolve, reject) => {
    const parent = ctx.registry.lastFocused({ private: false });
    const win = new BrowserWindow({
      width: 520, height: 700, show: false, parent: parent ? parent.win : undefined, modal: false, autoHideMenuBar: true,
      title: 'Sign in', webPreferences: { session: ctx.mainSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let done = false;
    let timer = null;
    const finish = (err, url) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err); else resolve(url);
    };
    const check = (e, url) => {
      if (String(url).startsWith(prefix)) { if (e && e.preventDefault) e.preventDefault(); finish(null, String(url)); }
    };
    win.webContents.on('will-redirect', (e) => check(e, e.url));
    win.webContents.on('will-navigate', (e) => check(e, e.url));
    win.webContents.on('did-navigate', (e, url) => check(null, url));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const internal = (e) => { if (require('../protocol').isInternal(e.url)) e.preventDefault(); };
    win.webContents.on('will-navigate', internal);
    win.webContents.on('will-redirect', internal);
    require('../guests').showSiteInTitle(win.webContents);
    win.on('closed', () => finish(new Error('The user did not approve access.')));
    if (interactive) {
      win.once('ready-to-show', () => { if (!done) win.show(); });
      timer = setTimeout(() => finish(new Error('The user did not approve access.')), 15 * 60e3);
    } else {
      // Without the user the provider has to redirect straight away (or within the allowed time).
      const total = Math.max(0, Number(details.timeoutMsForNonInteractive) || 0);
      if (details.abortOnLoadForNonInteractive !== false) {
        win.webContents.on('did-finish-load', () => setTimeout(() => finish(new Error('User interaction required.')), 50));
      }
      timer = setTimeout(() => finish(new Error('User interaction required.')), total || 30000);
    }
    win.loadURL(start).catch((e) => { if (!done && !/ERR_ABORTED/.test(e.message)) finish(new Error('Authorization page could not be loaded.')); });
  });
}

// ------------------------------------------------------------- font list
let fontCache = null;
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}
const STYLE_WORDS = /\s+(Thin|Hairline|ExtraLight|Extra Light|UltraLight|Light|SemiLight|Semilight|Regular|Book|Normal|Medium|SemiBold|Semibold|Demibold|DemiBold|Bold|ExtraBold|Extra Bold|UltraBold|Black|Heavy|ExtraBlack|Italic|Oblique|Condensed|SemiCondensed|Narrow|Cond|It)$/i;
async function fontList() {
  if (fontCache) return fontCache;
  const names = new Set();
  if (process.platform === 'win32') {
    for (const hive of ['HKLM', 'HKCU']) {
      const out = await run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts`]);
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}/.exec(line);
        if (!m) continue;
        for (let n of m[1].replace(/\s*\((TrueType|OpenType|All res|VGA res|[^)]*res[^)]*)\)\s*$/i, '').split(/\s+&\s+/)) {
          n = n.replace(/\s+\d+(,\d+)*$/, '');
          let prev;
          do { prev = n; n = n.replace(STYLE_WORDS, ''); } while (n !== prev);
          if (n.trim()) names.add(n.trim());
        }
      }
    }
  } else if (process.platform === 'linux') {
    const out = await run('fc-list', [':', 'family']);
    for (const line of out.split('\n')) { const n = line.split(',')[0].trim(); if (n) names.add(n); }
  } else if (process.platform === 'darwin') {
    const out = await run('/usr/bin/system_profiler', ['SPFontsDataType']);
    for (const m of out.matchAll(/^\s+Family:\s*(.+)$/gm)) names.add(m[1].trim());
  }
  if (!names.size) ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'].forEach((n) => names.add(n));
  fontCache = [...names].filter((n) => !n.startsWith('.') && !n.startsWith('@')).sort((a, b) => a.localeCompare(b)).map((n) => ({ fontId: n, displayName: n }));
  return fontCache;
}

module.exports = { install, SyncStore, fontList, launchWebAuthFlow };
