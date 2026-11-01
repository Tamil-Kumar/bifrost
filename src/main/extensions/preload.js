'use strict';
// Runs in every extension page and extension service worker, after electron-chrome-extensions' preload.
// It adds the chrome.* APIs that neither Electron nor that library provide (bookmarks, history, sidePanel,
// identity, fontSettings, a real storage.sync, observable webRequest, more of chrome.tabs…), routes them
// through the same IPC router as the library's own APIs (see apis.js), then freezes chrome.*.
const { contextBridge, ipcRenderer } = require('electron');

const isWorker = process.type === 'service-worker';
const isExtensionPage = !isWorker && typeof location === 'object' && String(location.href).startsWith('chrome-extension://');

if (isWorker) { try { ipcRenderer.send('bifrost-sw-pid', process.pid); } catch { /* old Electron */ } }

// Electron before 44.10 (castlabs' 44.9.3, which Bifrost runs on for Widevine, too) never delivers native
// extension events to extension service workers (electron/electron#55152): storage.onChanged and
// alarms.onAlarm don't reach background workers, and extensions that keep their state in sync with them
// (Bitwarden: stuck "Loading" after signing in) break. On those, Bifrost brings both itself (see below).
const workerEventsBroken = (() => {
  const [major, minor] = String((process.versions && process.versions.electron) || '').split('.').map(Number);
  return major === 44 && minor < 10;
})();

if (isWorker || isExtensionPage) {
  const hooked = new Set();
  const bridge = {
    isWorker,
    workerEventsBroken,
    invoke: (extensionId, name, ...args) => ipcRenderer.invoke('crx-msg', extensionId, name, ...args),
    // One IPC subscription per event name per context; the main world fans out to its listeners.
    on: (extensionId, name, callback) => {
      if (hooked.has(name)) return;
      hooked.add(name);
      ipcRenderer.on('crx-' + name, (_event, ...args) => { try { callback(...args); } catch (e) { console.error(e); } });
      ipcRenderer.send('crx-add-listener', extensionId, name);
    },
  };
  try {
    contextBridge.executeInMainWorld({ func: installApis, args: [bridge] });
  } catch (e) {
    console.error('[bifrost] extension APIs could not be installed:', e);
  }
}

// Everything below runs in the extension's own JavaScript world: it can't use anything from this file
// except the bridge it's given.
function installApis(B) {
  const chrome = globalThis.chrome;
  if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
  const ID = chrome.runtime.id;
  let manifest = {};
  try { manifest = chrome.runtime.getManifest() || {}; } catch { /* keep empty */ }
  const perms = new Set((manifest.permissions || []).filter((p) => typeof p === 'string'));
  const has = (p) => perms.has(p);

  const define = (obj, key, value) => {
    try { Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true }); } catch (e) { console.error('[bifrost] chrome.' + key, e); }
  };
  const cleanError = (e) => new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, ''));

  // A chrome.* method: returns a promise, or calls a trailing callback (Chrome supports both).
  const call = (name, opts) => function (...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const sent = opts && opts.args ? opts.args(...args) : args;
    const p = B.invoke(ID, name, ...sent).then((r) => (opts && opts.out ? opts.out(r) : r), (e) => { throw cleanError(e); });
    if (!cb) return p;
    p.then((r) => cb(r), (e) => { console.error(`Unchecked runtime.lastError: ${e.message}`); try { cb(); } catch (x) { console.error(x); } });
    return undefined;
  };

  // A chrome.* event. Listeners added here receive events the main process sends under `name`.
  class Ev {
    constructor(name, onFirst) { this._name = name; this._ls = []; this._onFirst = onFirst || null; this._hooked = false; }
    addListener(fn) {
      if (typeof fn !== 'function' || this._ls.includes(fn)) return;
      this._ls.push(fn);
      if (!this._hooked) {
        this._hooked = true;
        if (this._name) B.on(ID, this._name, (...a) => this._emit(...a));
        if (this._onFirst) this._onFirst();
      }
    }
    removeListener(fn) { const i = this._ls.indexOf(fn); if (i >= 0) this._ls.splice(i, 1); }
    hasListener(fn) { return this._ls.includes(fn); }
    hasListeners() { return this._ls.length > 0; }
    _emit(...a) { for (const fn of this._ls.slice()) { try { fn(...a); } catch (e) { console.error(e); } } }
  }

  // ------------------------------------------------------------- bookmarks
  if (has('bookmarks')) {
    const b = {};
    for (const m of ['get', 'getChildren', 'getRecent', 'getTree', 'getSubTree', 'search', 'create', 'move', 'update', 'remove', 'removeTree']) b[m] = call('bookmarks.' + m);
    for (const e of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded']) b[e] = new Ev('bookmarks.' + e);
    b.MAX_WRITE_OPERATIONS_PER_HOUR = 1000000;
    b.MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE = 1000000;
    b.FolderType = { BOOKMARKS_BAR: 'bookmarks-bar', OTHER: 'other', MOBILE: 'mobile', MANAGED: 'managed' };
    define(chrome, 'bookmarks', b);
  }

  // --------------------------------------------------------------- history
  if (has('history')) {
    const hi = {};
    for (const m of ['search', 'getVisits', 'addUrl', 'deleteUrl', 'deleteRange', 'deleteAll']) hi[m] = call('history.' + m);
    hi.onVisited = new Ev('history.onVisited');
    hi.onVisitRemoved = new Ev('history.onVisitRemoved');
    hi.TransitionType = { LINK: 'link', TYPED: 'typed', AUTO_BOOKMARK: 'auto_bookmark', AUTO_SUBFRAME: 'auto_subframe', MANUAL_SUBFRAME: 'manual_subframe', GENERATED: 'generated', AUTO_TOPLEVEL: 'auto_toplevel', FORM_SUBMIT: 'form_submit', RELOAD: 'reload', KEYWORD: 'keyword', KEYWORD_GENERATED: 'keyword_generated' };
    define(chrome, 'history', hi);
  }

  // ---------------------------------------------------------- contextMenus
  // update() really updates (the library's does nothing); see api-misc.js.
  if (has('contextMenus') && chrome.contextMenus) {
    define(chrome.contextMenus, 'update', call('contextMenus.update'));
  }

  // ---------------------------------------------- storage.sync and .managed
  // Electron has no sync storage (and electron-chrome-extensions aliases it to local, so keys collide).
  // Bifrost keeps a separate, local-only sync area; managed storage is an empty read-only area.
  if (has('storage') && chrome.storage) {
    const st = chrome.storage;
    const native = st.onChanged;
    const extra = [];
    const syncEv = new Ev(null, () => hookAreas());
    const managedEv = new Ev(null, () => hookAreas());
    let areasHooked = false;
    const hookAreas = () => {
      if (areasHooked) return;
      areasHooked = true;
      B.on(ID, 'storage.onAreaChanged', (changes, areaName) => {
        (areaName === 'managed' ? managedEv : syncEv)._emit(changes);
        for (const fn of extra.slice()) { try { fn(changes, areaName); } catch (e) { console.error(e); } }
      });
    };
    const area = (name, ev, consts) => Object.assign({
      get: call(`storage.${name}.get`), set: call(`storage.${name}.set`), remove: call(`storage.${name}.remove`),
      clear: call(`storage.${name}.clear`), getBytesInUse: call(`storage.${name}.getBytesInUse`), getKeys: call(`storage.${name}.getKeys`),
      setAccessLevel: call(`storage.${name}.setAccessLevel`), onChanged: ev,
    }, consts);
    define(st, 'sync', area('sync', syncEv, { QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512, MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120, MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: 1000000 }));
    define(st, 'managed', area('managed', managedEv, {}));
    if (native && typeof native.addListener === 'function') {
      define(st, 'onChanged', {
        addListener(fn) { if (typeof fn !== 'function') return; native.addListener(fn); if (!extra.includes(fn)) extra.push(fn); hookAreas(); },
        removeListener(fn) { native.removeListener(fn); const i = extra.indexOf(fn); if (i >= 0) extra.splice(i, 1); },
        hasListener(fn) { return extra.includes(fn) || native.hasListener(fn); },
        hasListeners() { return extra.length > 0 || native.hasListeners(); },
      });
    }

    // Where the worker can't hear storage.onChanged (workerEventsBroken): every extension page and worker
    // reports what it writes to the local and session areas, and the main process passes that on to the
    // worker (which also hears of its own writes straight away). Pages still hear the native events.
    // Both storage.onChanged and each area's own onChanged (storage.local.onChanged, which Bitwarden uses)
    // get them.
    if (B.workerEventsBroken) {
      const areaListeners = {};
      const emit = (changes, areaName) => {
        for (const fn of extra.slice()) { try { fn(changes, areaName); } catch (e) { console.error(e); } }
        for (const fn of (areaListeners[areaName] || []).slice()) { try { fn(changes); } catch (e) { console.error(e); } }
      };
      if (B.isWorker) B.on(ID, 'storage.onWorkerChanged', (changes, areaName) => emit(changes, areaName));
      const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
      const copy = (v) => { try { return structuredClone(v); } catch { return v; } };
      const report = (areaName, changes) => {
        if (!Object.keys(changes).length) return;
        if (B.isWorker) setTimeout(() => emit(changes, areaName), 0);
        else B.invoke(ID, 'storage.wrote', areaName, changes).catch(() => {});
      };
      const settle = (p, cb) => {
        if (!cb) return p;
        p.then((r) => cb(r), (e) => { console.error('Unchecked runtime.lastError: ' + ((e && e.message) || e)); try { cb(); } catch (x) { console.error(x); } });
        return undefined;
      };
      for (const name of ['local', 'session']) {
        const a = st[name];
        if (!a || typeof a.set !== 'function') continue;
        const wrapped = Object.create(a);
        const get = (keys) => a.get(keys);
        wrapped.set = (items, cb) => settle((async () => {
          const keys = items && typeof items === 'object' ? Object.keys(items).filter((k) => items[k] !== undefined) : [];
          const before = keys.length ? await get(keys) : {};
          await a.set(items);
          const changes = {};
          for (const k of keys) {
            if (!(k in before)) changes[k] = { newValue: copy(items[k]) };
            else if (!same(before[k], items[k])) changes[k] = { oldValue: before[k], newValue: copy(items[k]) };
          }
          report(name, changes);
        })(), cb);
        wrapped.remove = (keys, cb) => settle((async () => {
          const list = [].concat(keys || []);
          const before = list.length ? await get(list) : {};
          await a.remove(keys);
          const changes = {};
          for (const k of Object.keys(before)) changes[k] = { oldValue: before[k] };
          report(name, changes);
        })(), cb);
        wrapped.clear = (cb) => settle((async () => {
          const before = await get(null);
          await a.clear();
          const changes = {};
          for (const k of Object.keys(before || {})) changes[k] = { oldValue: before[k] };
          report(name, changes);
        })(), cb);
        for (const m of ['get', 'getBytesInUse', 'getKeys', 'setAccessLevel']) if (typeof a[m] === 'function') wrapped[m] = a[m].bind(a);
        // (read from the real area: its getters may not work on another object)
        for (const k of ['QUOTA_BYTES', 'QUOTA_BYTES_PER_ITEM', 'MAX_ITEMS']) { try { if (a[k] !== undefined) Object.defineProperty(wrapped, k, { value: a[k], enumerable: true }); } catch { /* skip */ } }
        const areaEv = a.onChanged;
        const own = areaListeners[name] = [];
        Object.defineProperty(wrapped, 'onChanged', {
          enumerable: true,
          value: {
            addListener(fn) { if (typeof fn !== 'function') return; if (areaEv) areaEv.addListener(fn); if (!own.includes(fn)) own.push(fn); },
            removeListener(fn) { if (areaEv) areaEv.removeListener(fn); const i = own.indexOf(fn); if (i >= 0) own.splice(i, 1); },
            hasListener(fn) { return own.includes(fn) || !!(areaEv && areaEv.hasListener(fn)); },
            hasListeners() { return own.length > 0 || !!(areaEv && areaEv.hasListeners()); },
          },
        });
        define(st, name, wrapped);
      }
    }
  }

  // ---------------------------------------------------------------- alarms
  // Where workers can't hear alarms.onAlarm (workerEventsBroken), Bifrost keeps the extension's alarms
  // itself and fires them through its own events, which reach workers (and wake them).
  if (B.workerEventsBroken && has('alarms')) {
    define(chrome, 'alarms', {
      create: call('alarms.create', { args: (name, info) => (typeof name === 'object' && name !== null ? ['', name] : [name == null ? '' : String(name), info || {}]) }),
      get: call('alarms.get', { args: (name) => [name == null || typeof name === 'function' ? '' : String(name)] }),
      getAll: call('alarms.getAll'), clear: call('alarms.clear', { args: (name) => [name == null || typeof name === 'function' ? '' : String(name)] }),
      clearAll: call('alarms.clearAll'),
      onAlarm: new Ev('alarms.onAlarm'),
    });
  }

  // ------------------------------------------------------------- sidePanel
  if (has('sidePanel')) {
    define(chrome, 'sidePanel', {
      setOptions: call('sidePanel.setOptions'), getOptions: call('sidePanel.getOptions'),
      setPanelBehavior: call('sidePanel.setPanelBehavior'), getPanelBehavior: call('sidePanel.getPanelBehavior'),
      open: call('sidePanel.open'), close: call('sidePanel.close'), getLayout: call('sidePanel.getLayout'),
      onOpened: new Ev('sidePanel.onOpened'), onClosed: new Ev('sidePanel.onClosed'),
      Side: { LEFT: 'left', RIGHT: 'right' },
    });
  }

  // -------------------------------------------------------------- identity
  if (has('identity')) {
    define(chrome, 'identity', {
      getRedirectURL: (path) => `https://${ID}.chromiumapp.org/` + String(path || '').replace(/^\//, ''),
      launchWebAuthFlow: call('identity.launchWebAuthFlow'),
      getAuthToken: call('identity.getAuthToken'),
      removeCachedAuthToken: call('identity.removeCachedAuthToken'),
      clearAllCachedAuthTokens: call('identity.clearAllCachedAuthTokens'),
      getProfileUserInfo: call('identity.getProfileUserInfo'),
      getAccounts: call('identity.getAccounts'),
      onSignInChanged: new Ev('identity.onSignInChanged'),
      AccountStatus: { SYNC: 'SYNC', ANY: 'ANY' },
    });
  }

  // ----------------------------------------------------------- fontSettings
  if (has('fontSettings')) {
    const f = {};
    for (const m of ['getFontList', 'getFont', 'setFont', 'clearFont', 'getDefaultFontSize', 'setDefaultFontSize', 'clearDefaultFontSize',
      'getDefaultFixedFontSize', 'setDefaultFixedFontSize', 'clearDefaultFixedFontSize', 'getMinimumFontSize', 'setMinimumFontSize', 'clearMinimumFontSize']) f[m] = call('fontSettings.' + m);
    for (const e of ['onFontChanged', 'onDefaultFontSizeChanged', 'onDefaultFixedFontSizeChanged', 'onMinimumFontSizeChanged']) f[e] = new Ev('fontSettings.' + e);
    f.GenericFamily = { STANDARD: 'standard', SANSSERIF: 'sansserif', SERIF: 'serif', FIXED: 'fixed', CURSIVE: 'cursive', FANTASY: 'fantasy', MATH: 'math' };
    f.LevelOfControl = { NOT_CONTROLLABLE: 'not_controllable', CONTROLLED_BY_OTHER_EXTENSIONS: 'controlled_by_other_extensions', CONTROLLABLE_BY_THIS_EXTENSION: 'controllable_by_this_extension', CONTROLLED_BY_THIS_EXTENSION: 'controlled_by_this_extension' };
    define(chrome, 'fontSettings', f);
  }

  // --------------------------------------------------------------- privacy
  // Settings extensions can read and change (Bitwarden turns off browser password saving, WebRTC
  // leak blockers set the IP handling policy, which Bifrost applies to every tab).
  if (chrome.privacy || has('privacy')) {
    const setting = (path) => ({
      get: call('privacy.get', { args: (details) => [path, details || {}] }),
      set: call('privacy.set', { args: (details) => [path, details || {}] }),
      clear: call('privacy.clear', { args: (details) => [path, details || {}] }),
      onChange: new Ev('privacy.onChange.' + path),
    });
    const groups = {
      network: ['networkPredictionEnabled', 'webRTCIPHandlingPolicy'],
      services: ['alternateErrorPagesEnabled', 'autofillAddressEnabled', 'autofillCreditCardEnabled', 'autofillEnabled', 'passwordSavingEnabled', 'safeBrowsingEnabled', 'safeBrowsingExtendedReportingEnabled', 'searchSuggestEnabled', 'spellingServiceEnabled', 'translationServiceEnabled'],
      websites: ['adMeasurementEnabled', 'doNotTrackEnabled', 'fledgeEnabled', 'hyperlinkAuditingEnabled', 'protectedContentEnabled', 'referrersEnabled', 'relatedWebsiteSetsEnabled', 'thirdPartyCookiesAllowed', 'topicsEnabled'],
    };
    const p = {};
    for (const [g, names] of Object.entries(groups)) { p[g] = {}; for (const n of names) p[g][n] = setting(g + '.' + n); }
    p.IPHandlingPolicy = { DEFAULT: 'default', DEFAULT_PUBLIC_AND_PRIVATE_INTERFACES: 'default_public_and_private_interfaces', DEFAULT_PUBLIC_INTERFACE_ONLY: 'default_public_interface_only', DISABLE_NON_PROXIED_UDP: 'disable_non_proxied_udp' };
    define(chrome, 'privacy', p);
  }

  // ------------------------------------------------------------ webRequest
  // Electron never fires extension webRequest events once the browser itself watches requests (as
  // Bifrost's ad blocker does), so Bifrost forwards what it sees. Events are informational: blocking
  // or rewriting from extensions isn't supported.
  if (has('webRequest') && chrome.webRequest) {
    const native = chrome.webRequest;
    const wr = {};
    for (const k in native) { try { wr[k] = native[k]; } catch { /* skip */ } }
    const context = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let seq = 0;
    const byId = new Map();
    let dispatchHooked = false;
    const hookDispatch = () => {
      if (dispatchHooked) return;
      dispatchHooked = true;
      B.on(ID, 'webRequest.dispatch', (ids, details) => {
        for (const id of ids) { const l = byId.get(id); if (l) { try { l.fn(Object.assign({}, details)); } catch (e) { console.error(e); } } }
      });
    };
    const ev = (event) => ({
      addListener(fn, filter, extraInfoSpec) {
        if (typeof fn !== 'function') return;
        for (const l of byId.values()) if (l.fn === fn && l.event === event) return;
        hookDispatch();
        const id = context + ':' + (++seq);
        byId.set(id, { fn, event });
        B.invoke(ID, 'webRequest.addListener', { context, worker: B.isWorker, id, event, filter: filter || { urls: ['<all_urls>'] }, extraInfoSpec: Array.isArray(extraInfoSpec) ? extraInfoSpec : [] })
          .catch((e) => console.error('chrome.webRequest.' + event + ': ' + cleanError(e).message));
      },
      removeListener(fn) {
        for (const [id, l] of byId) if (l.fn === fn && l.event === event) { byId.delete(id); B.invoke(ID, 'webRequest.removeListener', id).catch(() => {}); }
      },
      hasListener(fn) { for (const l of byId.values()) if (l.fn === fn && l.event === event) return true; return false; },
      hasListeners() { for (const l of byId.values()) if (l.event === event) return true; return false; },
    });
    for (const e of ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred']) wr[e] = ev(e);
    if (!wr.onAuthRequired) wr.onAuthRequired = new Ev(null);
    if (!wr.onActionIgnored) wr.onActionIgnored = new Ev(null);
    if (typeof wr.handlerBehaviorChanged !== 'function') wr.handlerBehaviorChanged = (cb) => { if (typeof cb === 'function') { cb(); return undefined; } return Promise.resolve(); };
    if (wr.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES == null) wr.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES = 20;
    define(chrome, 'webRequest', wr);
    // A fresh worker or page: listeners from its previous run are dropped in the main process.
    B.invoke(ID, 'webRequest.contextStarted', { context, worker: B.isWorker }).catch(() => {});
  }

  // ------------------------------------------------------------------ tabs
  if (chrome.tabs) {
    const t = chrome.tabs;
    const add = (k, v) => { if (t[k] == null) define(t, k, v); };
    for (const m of ['move', 'duplicate', 'discard', 'highlight', 'captureVisibleTab', 'getZoom', 'setZoom', 'getZoomSettings', 'setZoomSettings', 'detectLanguage']) add(m, call('tabs.' + m));
    for (const e of ['onMoved', 'onAttached', 'onDetached', 'onHighlighted', 'onZoomChange']) add(e, new Ev('tabs.' + e));
    add('TAB_ID_NONE', -1);
    add('TAB_INDEX_NONE', -1);
    add('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND', 2);
  }

  // -------------------------------------------------------------- commands
  if (chrome.commands) {
    define(chrome.commands, 'update', call('commands.update'));
    define(chrome.commands, 'reset', call('commands.reset'));
    if (!chrome.commands.onChanged) define(chrome.commands, 'onChanged', new Ev('commands.onChanged'));
  }

  // ------------------------------------------------- topSites, search, sessions
  if (has('topSites')) define(chrome, 'topSites', { get: call('topSites.get') });
  if (has('search')) define(chrome, 'search', { query: call('search.query'), Disposition: { CURRENT_TAB: 'CURRENT_TAB', NEW_TAB: 'NEW_TAB', NEW_WINDOW: 'NEW_WINDOW' } });

  // -------------------------------------------------------------- downloads
  if (has('downloads')) {
    const d = {};
    for (const m of ['download', 'search', 'pause', 'resume', 'cancel', 'open', 'show', 'showDefaultFolder', 'erase', 'removeFile', 'acceptDanger', 'getFileIcon', 'setUiOptions', 'setShelfEnabled']) d[m] = call('downloads.' + m);
    for (const e of ['onCreated', 'onChanged', 'onErased', 'onDeterminingFilename']) d[e] = new Ev('downloads.' + e);
    define(chrome, 'downloads', d);
  }

  // ------------------------------------------------------------- extension
  // Bifrost loads every extension with file access; private windows never run extensions.
  if (chrome.extension) {
    define(chrome.extension, 'isAllowedFileSchemeAccess', (cb) => { if (typeof cb === 'function') { cb(true); return undefined; } return Promise.resolve(true); });
    define(chrome.extension, 'isAllowedIncognitoAccess', (cb) => { if (typeof cb === 'function') { cb(false); return undefined; } return Promise.resolve(false); });
  }

  // ---------------------------------------------------------- action icons
  // Toolbar icons an extension draws itself (setIcon({ imageData })), which electron-chrome-extensions
  // drops for Manifest V3 (Stylus draws its icon this way, so it showed as a letter). Each size becomes a
  // PNG here, in the extension's own world (pages and service workers both have OffscreenCanvas).
  const toPng = async (img) => {
    if (typeof img === 'string') return img;
    if (!img || !(img.width > 0) || !(img.height > 0) || !img.data) return null;
    const c = new OffscreenCanvas(img.width, img.height);
    const data = typeof ImageData === 'function' && img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    c.getContext('2d').putImageData(data, 0, 0);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:image/png;base64,' + btoa(s);
  };
  for (const ns of ['action', 'browserAction']) {
    const api = chrome[ns];
    if (!api || typeof api.setIcon !== 'function') continue;
    const original = api.setIcon;
    define(api, 'setIcon', function setIcon(details, cb) {
      if (!details || details.imageData == null) return original.apply(this, arguments);
      const p = (async () => {
        const d = Object.assign({}, details);
        const src = d.imageData;
        const out = {};
        if (src && src.data && src.width > 0) { const u = await toPng(src); if (u) out[String(src.width)] = u; }
        else for (const [size, img] of Object.entries(src || {})) { const u = await toPng(img); if (u) out[size] = u; }
        d.imageData = out;
        delete d.path;
        await B.invoke(ID, 'browserAction.setIcon', d);
      })().catch((e) => { throw cleanError(e); });
      if (typeof cb === 'function') { p.then(() => cb(), (e) => { console.error('Unchecked runtime.lastError: ' + e.message); cb(); }); return undefined; }
      return p;
    });
  }

  // ------------------------------------------------- runtime.onInstalled / onStartup
  // Electron never fires these, and extensions set themselves up in them (context menus, defaults, alarms,
  // rules). The background asks the main process what it missed the first time it listens, and its
  // listeners get it once the script that added them has finished (as if Chrome had just fired it).
  const bg = manifest.background || {};
  const bgPage = bg.page || (Array.isArray(bg.scripts) && bg.scripts.length ? '_generated_background_page.html' : '');
  const isBackground = B.isWorker || (!!bgPage && typeof location === 'object' && location.pathname.replace(/^\//, '') === bgPage);
  if (isBackground && chrome.runtime) {
    for (const [name, kind] of [['onInstalled', 'installed'], ['onStartup', 'startup']]) {
      const native = chrome.runtime[name];
      if (!native || typeof native.addListener !== 'function') continue;
      const mine = [];
      let asked = false;
      const ask = () => {
        if (asked) return;
        asked = true;
        B.invoke(ID, 'runtime.pendingLifecycle', kind).then((details) => {
          if (!details) return;
          setTimeout(() => {
            for (const fn of mine.slice()) { try { if (kind === 'installed') fn(details); else fn(); } catch (e) { console.error(e); } }
          }, 0);
        }, () => {});
      };
      const ev = {
        addListener(fn) { if (typeof fn !== 'function') return; native.addListener(fn); if (!mine.includes(fn)) mine.push(fn); ask(); },
        removeListener(fn) { native.removeListener(fn); const i = mine.indexOf(fn); if (i >= 0) mine.splice(i, 1); },
        hasListener(fn) { return mine.includes(fn) || native.hasListener(fn); },
        hasListeners() { return mine.length > 0 || native.hasListeners(); },
      };
      try { Object.defineProperty(chrome.runtime, name, { value: ev, enumerable: true, configurable: true, writable: true }); } catch {
        // (a native property that can't be replaced: wrap its methods instead)
        try { const add = native.addListener.bind(native); native.addListener = (fn) => { add(fn); if (typeof fn === 'function' && !mine.includes(fn)) mine.push(fn); ask(); }; } catch (e) { console.error('[bifrost] runtime.' + name, e); }
      }
    }
  }

  try { Object.freeze(chrome); } catch { /* already frozen */ }

  // Chromium also exposes a separate `browser` object with only its built-in APIs. Point it at the
  // complete `chrome` so extensions written against `browser.*` get the same APIs.
  if (globalThis.browser && globalThis.browser !== chrome) {
    try { Object.defineProperty(globalThis, 'browser', { value: chrome, enumerable: true, configurable: true, writable: true }); } catch (e) { console.error('[bifrost] browser alias', e); }
  }
}
