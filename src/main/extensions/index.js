'use strict';
// Chrome extensions: electron-chrome-extensions for the chrome.* APIs Electron lacks (action, tabs,
// windows, context menus…), electron-chrome-web-store for installing from the Chrome Web Store, plus
// Bifrost's own additions (apis.js: bookmarks, history, side panels, shortcuts…) and unpacked/CRX installs.
const { app, session, webContents: WC, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ctx = require('../context');
const crx = require('./crx');

const VENDOR = path.join(__dirname, '..', '..', 'vendor');

class Extensions {
  constructor() {
    this.ece = null;
    this.ses = null;
    this.ready = null;
    this.hub = null;
    this.errors = new Map(); // id or path -> message
    this.messages = new Map(); // extension path -> default-locale messages
  }

  get extensionsPath() { return path.join(app.getPath('userData'), 'Extensions'); }
  get unpackedList() { return ctx.db.kvGet('extensions.unpacked', []); }
  set unpackedList(v) { ctx.db.kvSet('extensions.unpacked', v); }
  get disabled() { return new Set(ctx.db.kvGet('extensions.disabled', [])); }
  set disabled(set) { ctx.db.kvSet('extensions.disabled', [...set]); }

  init(ses) {
    this.ses = ses;
    // The library and each of Bifrost's API modules follow extensions loading and unloading.
    ses.extensions.setMaxListeners(40);
    const { ElectronChromeExtensions } = require(path.join(VENDOR, 'chrome-extensions', 'index.js'));
    this.ece = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: ses,
      createTab: (details) => this.createTab(details),
      // (Not for the tab the window itself just reported in front: see selectTab below.)
      selectTab: (tab) => { if (this.reporting !== tab.id) this.uiTabAction(tab, 'select'); },
      removeTab: (tab) => this.uiTabAction(tab, 'close'),
      createWindow: (details) => this.createWindow(details),
      removeWindow: (win) => { if (!win.isDestroyed()) win.close(); },
      requestPermissions: (extension, permissions) => this.confirmPermissions(extension, permissions),
      assignTabDetails: (details, wc) => { if (this.assignTabDetails) this.assignTabDetails(details, wc); },
    });
    // Which tab is in front is the window's to say (selectTab below, from its 'tab:selected'). The library
    // would otherwise announce tabs.onActivated for every tab it starts following, background tabs too,
    // and before the window has reported the tab (so a listener asking chrome.tabs which tab is active,
    // as many do, gets none or the old one); and its toolbar badges would follow those tabs.
    this.fronts = new Map();       // window id -> the tab last announced in front there
    this.reporting = null;         // the tab id selectTab is reporting, while it does
    if (this.ece.api && this.ece.api.tabs) this.ece.api.tabs.onActivated = () => {};
    // contextMenus.onClicked as Chrome sends it. The library sends parentMenuItemId and frameId as -1, a
    // tab record that can be out of date, and never ticks checkboxes; extensions tell their items apart by
    // the parent (Bitwarden's "Autofill login" and "Copy password" lists hold the same logins).
    const cm = this.ece.api && this.ece.api.contextMenus;
    if (cm) {
      const build = cm.buildMenuItem;
      cm.buildMenuItem = (opts) => {
        const o = build(opts);
        if (opts && opts.props && (opts.props.type === 'checkbox' || opts.props.type === 'radio')) o.checked = !!opts.props.checked;
        return o;
      };
      cm.onClicked = (extensionId, menuItemId, wc, params) => {
        if (!wc || wc.isDestroyed()) return;
        const items = cm.menus.get(extensionId);
        const props = items ? items.get(menuItemId) : null;
        const p = params || {};
        let frameId = 0;
        try { const f = p.frame; if (f && f.top && f !== f.top) frameId = f.frameTreeNodeId; } catch { frameId = 0; }
        const data = { menuItemId, editable: !!p.isEditable, pageUrl: p.pageURL, frameId };
        if (props && props.parentId != null) data.parentMenuItemId = props.parentId;
        if (p.frameURL) data.frameUrl = p.frameURL;
        if (p.linkURL) data.linkUrl = p.linkURL;
        if (p.srcURL) data.srcUrl = p.srcURL;
        if (p.mediaType && p.mediaType !== 'none') data.mediaType = p.mediaType;
        if (p.selectionText) data.selectionText = p.selectionText;
        if (props && (props.type === 'checkbox' || props.type === 'radio')) {
          data.wasChecked = !!props.checked;
          if (props.type === 'checkbox') props.checked = !props.checked;
          else for (const other of radioGroup(items, props)) other.checked = other === props;
          data.checked = !!props.checked;
        }
        const tab = (this.tabDetailsFor && this.tabDetailsFor(wc)) || cm.ctx.store.tabDetailsCache.get(wc.id);
        if (tab) cm.ctx.router.sendEvent(extensionId, 'contextMenus.onClicked', data, tab);
      };
    }
    // Toolbar icons (crx://extension-icon/...) are requested by the browser UI's session.
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
    // Toolbar popups open inside the browser window, under their button (see popup-host.js), unless
    // Settings → Extensions says to use separate windows.
    const lib = require(path.join(VENDOR, 'chrome-extensions', 'index.js'));
    if (lib.PopupView) {
      const { PopupHost } = require('./popup-host');
      lib.PopupView.createHost = ctx.settings.get('extensions.popupsInWindow') === false ? null : (opts) => new PopupHost(opts);
      ctx.settings.on('changed', ({ path: p }) => {
        if (!p || p.startsWith('extensions')) lib.PopupView.createHost = ctx.settings.get('extensions.popupsInWindow') === false ? null : (opts) => new PopupHost(opts);
      });
    }

    this.ece.on('browser-action-popup-created', (popup) => {
      const win = popup.browserWindow;
      if (!win || win.isDestroyed()) return;
      win.webContents.once('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.focus(); });
      sizePopup(popup);
    });

    // runtime.onInstalled / onStartup, which Electron doesn't fire (see lifecycle.js).
    const { Lifecycle } = require('./lifecycle');
    this.lifecycle = new Lifecycle(this);
    ses.extensions.on('extension-loaded', (e, ext) => this.lifecycle.loaded(ext));

    require('./apis').install(this);
    ses.extensions.on('extension-unloaded', (e, ext) => this.messages.delete(ext.path));

    this.ready = this.loadAll().catch((e) => console.error('[extensions] load', e)).finally(() => this.lifecycle.startedUp());
    return this.ready;
  }

  // The session's request hub feeds chrome.webRequest (see api-webrequest.js).
  attachSession(ses, hub) { this.hub = hub; if (this.onHub) this.onHub(hub); }

  async loadAll() {
    fs.mkdirSync(this.extensionsPath, { recursive: true });
    const { installChromeWebStore } = require(path.join(VENDOR, 'chrome-web-store', 'index.js'));
    await installChromeWebStore({
      session: this.ses,
      extensionsPath: this.extensionsPath,
      loadExtensions: true,
      allowUnpackedExtensions: false,
      autoUpdate: true,
      minimumManifestVersion: 2,
      beforeInstall: (details) => this.confirmInstall(details),
    });
    // Disabled store extensions get unloaded; unpacked ones are loaded from where they live.
    const disabled = this.disabled;
    for (const ext of this.ses.extensions.getAllExtensions()) if (disabled.has(ext.id)) this.ses.extensions.removeExtension(ext.id);
    for (const p of this.unpackedList) {
      try {
        if (!fs.existsSync(path.join(p, 'manifest.json'))) { this.errors.set(p, 'Folder not found'); continue; }
        const id = crx.idForPath(p);
        if (disabled.has(id)) continue;
        await this.ses.extensions.loadExtension(p, { allowFileAccess: true });
      } catch (e) {
        this.errors.set(p, e.message);
      }
    }
    this.broadcast();
  }

  // -------------------------------------------------------------- tabs glue
  async createTab(details) {
    const ctl = (details.windowId && ctx.registry.get(details.windowId)) || ctx.registry.lastFocused({ private: false }) || require('../windows').create();
    await waitForUi(ctl);
    const r = await ctl.request('extension-create-tab', { url: details.url || '', active: details.active !== false, index: details.index, pinned: !!details.pinned });
    const wc = WC.fromId(r.wcId);
    if (!wc) throw new Error('tab was not created');
    return [wc, ctl.win];
  }

  uiTabAction(wc, action) {
    const found = ctx.registry.find(wc.id);
    if (found) found.ctl.send('extension-tab-action', { wcId: wc.id, action });
  }

  async createWindow(details) {
    const urls = [].concat(details.url || []);
    if (details.type === 'popup' || details.type === 'panel') {
      // Extension popouts (Bitwarden's "pop out" etc.) are plain windows.
      const win = new BrowserWindow({
        width: details.width || 400, height: details.height || 600, x: details.left, y: details.top,
        autoHideMenuBar: true, show: details.focused !== false,
        icon: path.join(__dirname, '..', '..', '..', 'assets', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
        webPreferences: { session: this.ses, sandbox: true, contextIsolation: true },
      });
      if (urls[0]) win.loadURL(urls[0]);
      return win;
    }
    const ctl = require('../windows').create({ urls, isPrivate: !!details.incognito });
    await waitForUi(ctl);
    return ctl.win;
  }

  // ----------------------------------------------------------- confirmations
  async confirmInstall(details) {
    const ctl = ctx.registry.lastFocused({ private: false });
    // Settings → Extensions → "Install from the Chrome Web Store" off: the store's Add button does nothing.
    if (!details.fromFile && ctx.settings.get('extensions.allowWebStore') === false) {
      if (ctl) ctl.send('toast', { text: 'Installing from the Chrome Web Store is turned off (Settings → Extensions)', iconName: 'puzzle' });
      return { action: 'deny' };
    }
    const m = details.manifest || {};
    const warnings = crx.permissionWarnings(m);
    if (ctl) {
      try {
        const r = await ctl.request('extension-install-prompt', {
          id: details.id, name: details.localizedName || m.name, icon: details.icon && details.icon.toDataURL ? details.icon.toDataURL() : '', warnings,
          replaces: details.replaces || '', fromFile: !!details.fromFile,
        }, 300000);
        return { action: r && r.allow ? 'allow' : 'deny' };
      } catch { return { action: 'deny' }; }
    }
    return { action: 'deny' };
  }

  async confirmPermissions(extension, permissions) {
    const ctl = ctx.registry.lastFocused({ private: false });
    if (!ctl) return false;
    const warnings = crx.permissionWarnings({ permissions: permissions.permissions || [], host_permissions: permissions.origins || [] });
    try {
      const r = await ctl.request('extension-permission-prompt', { id: extension.id, name: this.localizeString(extension, extension.name), warnings }, 300000);
      return !!(r && r.allow);
    } catch { return false; }
  }

  // ------------------------------------------------------------ management
  list() {
    const loaded = new Map(this.ses.extensions.getAllExtensions().map((e) => [e.id, e]));
    const disabled = this.disabled;
    const out = [];
    const seen = new Set();
    const pinned = ctx.settings.get('extensions.pinned') || [];
    const describe = (id, ext, extra) => {
      const m = ext ? ext.manifest : extra.manifest || {};
      const where = ext ? ext.path : extra.path;
      const perms = (m.permissions || []).filter((p) => typeof p === 'string');
      return {
        id, name: this.localizeString({ path: where, manifest: m }, ext ? ext.name : (m.name || id)), version: ext ? ext.version : m.version,
        description: this.localizeString({ path: where, manifest: m }, m.description || ''),
        enabled: !!ext, path: where, manifestVersion: m.manifest_version,
        hasOptions: !!(m.options_ui || m.options_page), optionsUrl: ext ? optionsUrl(ext) : '',
        hasPopup: !!((m.action || m.browser_action || {}).default_popup), hasAction: !!(m.action || m.browser_action), pinned: pinned.includes(id),
        homepage: m.homepage_url || '', permissions: crx.permissionWarnings(m), error: this.errors.get(id) || this.errors.get(extra.path) || '',
        source: extra.source, icon: iconData(where, m),
        commands: Object.keys(m.commands || {}).length,
        // Extensions that block or rewrite requests with declarativeNetRequest rules: Electron skips those
        // rules while the browser watches requests itself (Bifrost's ad blocker does).
        networkRules: perms.includes('declarativeNetRequest') || perms.includes('declarativeNetRequestWithHostAccess'),
        sidePanel: !!(m.side_panel && m.side_panel.default_path) || perms.includes('sidePanel'),
      };
    };
    for (const p of this.unpackedList) {
      const id = crx.idForPath(p);
      seen.add(id);
      let manifest = {};
      try { manifest = JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8')); } catch { /* reported as error */ }
      out.push(describe(id, loaded.get(id), { path: p, manifest, source: 'unpacked' }));
    }
    for (const ext of loaded.values()) {
      if (seen.has(ext.id)) continue;
      seen.add(ext.id);
      out.push(describe(ext.id, ext, { path: ext.path, source: ext.path.startsWith(this.extensionsPath) ? 'store' : 'unpacked' }));
    }
    for (const id of disabled) {
      if (seen.has(id)) continue;
      const dir = latestVersionDir(path.join(this.extensionsPath, id));
      if (!dir) continue;
      let manifest = {};
      try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* ignore */ }
      out.push(describe(id, null, { path: dir, manifest, source: 'store' }));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async loadUnpacked(dir) {
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('That folder has no manifest.json');
    const ext = await this.ses.extensions.loadExtension(dir, { allowFileAccess: true });
    const list = this.unpackedList.filter((p) => p !== dir);
    list.push(dir);
    this.unpackedList = list;
    this.errors.delete(dir);
    const d = this.disabled; d.delete(ext.id); this.disabled = d;
    this.broadcast();
    return { id: ext.id, name: this.localizeString(ext, ext.name) };
  }

  // A .crx or .zip file: check it, ask (showing what it can do, and what it replaces), unpack into the
  // profile, then load like a store extension.
  async installFile(file) {
    let replacing = null;
    const { id, dir } = await crx.unpackToExtensions(file, this.extensionsPath, {
      confirm: async ({ id: newId, manifest, root }) => {
        const have = this.list().find((e) => e.id === newId);
        replacing = have || null;
        const name = this.localizeString({ path: root, manifest }, manifest.name || newId);
        const r = await this.confirmInstall({ id: newId, manifest, localizedName: name, replaces: have ? have.name : '', fromFile: true });
        return r.action === 'allow';
      },
    }).catch((e) => { if (e.cancelled) return {}; throw e; });
    if (!id) return null;
    if (this.ses.extensions.getExtension(id)) this.ses.extensions.removeExtension(id);
    // It takes the place of an unpacked folder with the same ID, and of older versions' folders.
    if (replacing && replacing.source === 'unpacked') this.unpackedList = this.unpackedList.filter((p) => crx.idForPath(p) !== id);
    const parent = path.join(this.extensionsPath, id);
    for (const v of fs.readdirSync(parent)) {
      if (path.join(parent, v) !== dir) { try { fs.rmSync(path.join(parent, v), { recursive: true, force: true }); } catch { /* in use; replaced on the next start */ } }
    }
    const ext = await this.ses.extensions.loadExtension(dir, { allowFileAccess: true });
    const d = this.disabled; d.delete(ext.id); this.disabled = d;
    this.broadcast();
    return { id: ext.id, name: this.localizeString(ext, ext.name), replaced: !!replacing };
  }

  // An extension folder from another Chromium browser's profile (Extensions/<id>/<version>): copied into
  // Bifrost's own Extensions folder, so it loads like a Web Store install and keeps updating.
  async importFolder(src, id) {
    const have = this.ses.extensions.getExtension(id);
    if (have) return { id, name: this.localizeString(have, have.name), already: true };
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (!manifest.key || crx.idForKey(manifest.key) !== id) throw new Error('This extension’s files don’t match its ID');
    const dest = path.join(this.extensionsPath, id, String(manifest.version || '0').replace(/[^\w.-]/g, '') + '_0');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => !/[\\/]\.git([\\/]|$)/.test(p) });
    const ext = await this.ses.extensions.loadExtension(dest, { allowFileAccess: true });
    const d = this.disabled; d.delete(ext.id); this.disabled = d;
    this.errors.delete(dest);
    this.broadcast();
    return { id: ext.id, name: this.localizeString(ext, ext.name) };
  }

  // Settings brought over from another browser (src/main/import/extensions.js): chrome.storage.sync goes
  // into Bifrost's own sync store; chrome.storage.local and localStorage are written from inside the
  // extension (a blank page added to it for the moment), so they merge with anything already there.
  // Then the extension restarts, so it reads them.
  // indexedDb: [{ name, version, stores: [{ name, keyPath, autoIncrement, indexes, records: [{ key?, value }] }] }]
  // (from Firefox, see import/firefox-storage.js): records go into the extension's own databases, which a
  // first run usually made already; a database it hasn't made is only created when opts.createDatabases.
  // opts.wire: the values are in firefox-storage.js's tagged form (dates, binary… that JSON can't hold).
  async writeImportedData(id, { local = {}, sync = {}, localStorage = {}, indexedDb = [] } = {}, { wire = false, createDatabases = false } = {}) {
    const records = (indexedDb || []).reduce((n, d) => n + (d.stores || []).reduce((m, s) => m + (s.records || []).length, 0), 0);
    const done = { local: Object.keys(local).length, sync: Object.keys(sync).length, localStorage: Object.keys(localStorage).length, indexedDb: 0, skipped: 0 };
    if (!done.local && !done.sync && !done.localStorage && !records) return done;
    const ext = this.ses.extensions.getExtension(id);
    if (!ext) throw new Error('The extension isn’t loaded');
    if (done.sync && this.syncStore) {
      Object.assign(this.syncStore.data(id), wire ? jsonFromWire(sync) : JSON.parse(JSON.stringify(sync)));
      this.syncStore.save(id);
      this.syncStore.flushAll();
    }
    if (done.local || done.localStorage || records) {
      const page = '_bifrost_import_' + process.pid + '.html';
      const file = path.join(ext.path, page);
      fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Bifrost import</title>');
      const win = new BrowserWindow({ show: false, webPreferences: { session: this.ses, sandbox: true, contextIsolation: true } });
      const run = (code) => win.webContents.executeJavaScript(code, true);
      try {
        await win.loadURL(`chrome-extension://${id}/${page}`);
        await run(`window.__fromWire = ${wire ? require('../import/firefox-storage').FROM_WIRE_JS : '((v) => v)'}; window.__idb = ${IDB_WRITER_JS}; 1`);
        const r = await run(`(async (local, ls) => {
          local = __fromWire(local);
          let local_ = 0, ls_ = 0;
          if (Object.keys(local).length && globalThis.chrome && chrome.storage && chrome.storage.local) { await chrome.storage.local.set(local); local_ = Object.keys(local).length; }
          for (const [k, v] of Object.entries(ls)) { try { localStorage.setItem(k, typeof v === 'string' ? v : String(__fromWire(v))); ls_++; } catch { /* full */ } }
          return { local: local_, localStorage: ls_ };
        })(${JSON.stringify(local)}, ${JSON.stringify(localStorage)})`);
        done.local = r.local; done.localStorage = r.localStorage;
        for (const d of indexedDb || []) {
          const meta = { name: d.name, version: d.version, stores: (d.stores || []).map((s) => ({ name: s.name, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: s.indexes || [] })) };
          const count = (d.stores || []).reduce((m, s) => m + (s.records || []).length, 0);
          let opened;
          try { opened = await run(`__idb.open(${JSON.stringify(meta)}, ${!!createDatabases})`); } catch (e) { opened = { ok: false, why: e.message }; }
          if (!opened || !opened.ok) { done.skipped += count; console.warn(`[extensions] import into ${id}'s database ${d.name}: ${opened ? opened.why : 'failed'}`); continue; }
          for (const s of d.stores || []) {
            // A few MB at a time.
            let batch = [], size = 0;
            const flush = async () => {
              if (!batch.length) return;
              const res = await run(`__idb.put(${JSON.stringify(d.name)}, ${JSON.stringify(s.name)}, ${JSON.stringify(batch)})`).catch(() => ({ ok: 0, skipped: batch.length }));
              done.indexedDb += res.ok; done.skipped += res.skipped;
              batch = []; size = 0;
            };
            for (const rec of s.records || []) {
              const n = JSON.stringify(rec).length;
              batch.push(rec); size += n;
              if (size > 3 * 1024 * 1024) await flush();
            }
            await flush();
          }
          await run(`__idb.close(${JSON.stringify(d.name)})`).catch(() => {});
        }
      } finally {
        if (!win.isDestroyed()) win.destroy();
        fs.rmSync(file, { force: true });
      }
    }
    // Restart the extension so its background picks the settings up.
    try {
      const where = ext.path;
      this.ses.extensions.removeExtension(id);
      await this.ses.extensions.loadExtension(where, { allowFileAccess: true });
      this.broadcast();
    } catch (e) { console.warn('[extensions] restart after import', e.message); }
    return done;
  }

  async installFromStore(id) {
    // (Tests have no Web Store: they stand in for it.)
    if (process.env.BIFROST_TEST === '1' && typeof global.__fakeStoreInstall === 'function') { const r = await global.__fakeStoreInstall(id); this.broadcast(); return r; }
    const { installExtension } = require(path.join(VENDOR, 'chrome-web-store', 'index.js'));
    const ext = await installExtension(id, { session: this.ses, extensionsPath: this.extensionsPath });
    this.broadcast();
    return { id: ext.id, name: this.localizeString(ext, ext.name) };
  }

  async setEnabled(id, enabled) {
    const d = this.disabled;
    if (enabled) {
      d.delete(id);
      this.disabled = d;
      if (!this.ses.extensions.getExtension(id)) {
        const p = this.unpackedList.find((x) => crx.idForPath(x) === id) || latestVersionDir(path.join(this.extensionsPath, id));
        if (p) await this.ses.extensions.loadExtension(p, { allowFileAccess: true });
      }
    } else {
      d.add(id);
      this.disabled = d;
      if (this.ses.extensions.getExtension(id)) this.ses.extensions.removeExtension(id);
    }
    this.broadcast();
    return true;
  }

  async reload(id) {
    const ext = this.ses.extensions.getExtension(id);
    if (!ext) return false;
    const p = ext.path;
    if (this.lifecycle) this.lifecycle.reloadingSoon(id);
    this.ses.extensions.removeExtension(id);
    await this.ses.extensions.loadExtension(p, { allowFileAccess: true });
    this.broadcast();
    return true;
  }

  async remove(id) {
    const ext = this.ses.extensions.getExtension(id);
    if (ext) this.ses.extensions.removeExtension(id);
    const unpacked = this.unpackedList;
    const keep = unpacked.filter((p) => crx.idForPath(p) !== id);
    if (keep.length !== unpacked.length) this.unpackedList = keep;
    else fs.rmSync(path.join(this.extensionsPath, id), { recursive: true, force: true });
    const d = this.disabled; d.delete(id); this.disabled = d;
    const pinned = (ctx.settings.get('extensions.pinned') || []).filter((x) => x !== id);
    ctx.settings.set('extensions.pinned', pinned);
    // Its data goes with it: sync storage, shortcuts, side panel and privacy settings it made.
    if (this.syncStore) this.syncStore.drop(id);
    if (this.commands) this.commands.forget(id);
    if (this.forgetPrivacy) this.forgetPrivacy(id);
    if (this.forgetAlarms) this.forgetAlarms(id);
    if (this.lifecycle) this.lifecycle.forget(id);
    const behavior = ctx.db.kvGet('extensions.sidePanelBehavior', {}) || {};
    if (id in behavior) { delete behavior[id]; ctx.db.kvSet('extensions.sidePanelBehavior', behavior); }
    this.broadcast();
    return true;
  }

  setPinned(id, pinned) {
    const list = (ctx.settings.get('extensions.pinned') || []).filter((x) => x !== id);
    if (pinned) list.push(id);
    ctx.settings.set('extensions.pinned', list);
    this.broadcast();
  }

  openOptions(id) {
    const ext = this.ses.extensions.getExtension(id);
    const url = ext && optionsUrl(ext);
    if (!url) return false;
    const ctl = ctx.registry.lastFocused({ private: false });
    if (ctl) ctl.send('open-url', { url, background: false });
    return true;
  }

  commandList() { return this.commands ? this.commands.list() : []; }
  setCommandShortcut(id, name, acc) { return this.commands.set(id, name, acc); }

  broadcast() {
    for (const ctl of ctx.registry.list()) ctl.send('extensions-changed');
    for (const wc of WC.getAllWebContents()) {
      if (wc.getType() === 'webview' && /^bifrost:\/\/(extensions|settings)/.test(wc.getURL())) wc.send('extensions-changed');
    }
  }

  // __MSG_name__ placeholders resolved from the extension's default locale.
  localizeString(ext, str) {
    str = String(str || '');
    if (!/__MSG_/.test(str) || !ext || !ext.path) return str;
    let msgs = this.messages.get(ext.path);
    if (!msgs) {
      msgs = {};
      try {
        const m = ext.manifest || JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
        const raw = JSON.parse(fs.readFileSync(path.join(ext.path, '_locales', m.default_locale || 'en', 'messages.json'), 'utf8'));
        for (const [k, v] of Object.entries(raw)) msgs[k.toLowerCase()] = v && v.message;
      } catch { /* leave placeholders */ }
      this.messages.set(ext.path, msgs);
    }
    return str.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (all, k) => (msgs[k.toLowerCase()] != null ? msgs[k.toLowerCase()] : k));
  }

  iconFor(ext) { return iconData(ext.path, ext.manifest); }

  addTab(wc, win) {
    try { this.ece.addTab(wc, win); wc.once('destroyed', () => { try { this.ece.removeTab(wc); } catch { /* gone */ } }); } catch (e) { console.warn('[extensions] addTab', e.message); }
    const policy = this.webrtcPolicy && this.webrtcPolicy();
    if (policy && policy !== 'default') { try { wc.setWebRTCIPHandlingPolicy(policy); } catch { /* destroyed */ } }
  }
  // The window put this tab in front (its UI's 'tab:selected', sent after the tab snapshot that says so).
  selectTab(wc) {
    const store = this.ece && this.ece.ctx && this.ece.ctx.store;
    if (!store || !store.tabs.has(wc)) return;               // not a tab extensions see (private, a panel)
    const win = store.tabToWindow.get(wc);
    if (!win || win.isDestroyed()) return;
    // The library's own record (toolbar badges and popups, calls made without a tab id).
    this.reporting = wc.id;
    try { store.setActiveTab(wc); } catch { /* gone */ } finally { this.reporting = null; }
    if (this.fronts.get(win.id) === wc.id) return;            // the same tab, reported again
    this.fronts.set(win.id, wc.id);
    store.tabDetailsCache.forEach((info, id) => { info.active = id === wc.id; });
    this.ece.ctx.router.broadcastEvent('tabs.onActivated', { tabId: wc.id, windowId: win.id });
  }
  getContextMenuItems(wc, params) { return this.ece.getContextMenuItems(wc, params); }
}

// The radio items a radio item is grouped with: as in Chrome, the run of radio items next to each other
// under the same parent.
function radioGroup(items, props) {
  const level = [...items.values()].filter((x) => (x.parentId == null ? null : String(x.parentId)) === (props.parentId == null ? null : String(props.parentId)));
  const i = level.indexOf(props);
  let a = i, b = i;
  while (a > 0 && level[a - 1].type === 'radio') a--;
  while (b < level.length - 1 && level[b + 1].type === 'radio') b++;
  return level.slice(a, b + 1);
}

// Toolbar popups open right under their button, sized to their page like Chrome's: as wide as the content
// wants to be (up to 800 px) and as tall as it is (up to 600 px). Bifrost measures the page itself rather
// than trusting Chromium's "preferred size", which for extension pages can come back as the largest size
// (a mostly empty 800x600 window) or not at all.
const POPUP_MAX = { width: 800, height: 600 };
// Measured with <html> laid out at its content's size (then put back), so a page whose html/body fill
// the window still reports what it needs. The natural width is taken while the popup opens.
const MEASURE = (natural) => `(() => {
  const d = document.documentElement, b = document.body;
  const w = d.style.width, h = d.style.height;
  ${natural ? "d.style.width = 'max-content';" : ''}
  d.style.height = 'max-content';
  const r = d.getBoundingClientRect(), br = b ? b.getBoundingClientRect() : r;
  // The page's own background, for the popup's edges and rounded corners (white when it has none).
  const bgOf = (el) => el ? getComputedStyle(el).backgroundColor : '';
  const clear = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const bg = !clear(bgOf(b)) ? bgOf(b) : !clear(bgOf(d)) ? bgOf(d) : '';
  // (What spills past the window counts; filling it doesn't: a page laid out wider than it needs, as it is
  // while it opens, has things as wide as the window, w-screen, that aren't what it needs.)
  const spill = d.scrollWidth > innerWidth + 1 ? d.scrollWidth : 0;
  const out = { width: Math.ceil(Math.max(r.width, br.right, spill)), height: Math.ceil(Math.max(r.height, br.bottom)), bg };
  d.style.width = w; d.style.height = h;
  return out;
})()`;

async function sizePopup(popup) {
  const win = popup.browserWindow;
  try { win.webContents.removeListener('preferred-size-changed', popup.updatePreferredSize); } catch { /* not there */ }
  popup.usingPreferredSize = true;   // the library then leaves sizing (and showing) to us
  try { await popup.whenReady(); } catch { return; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let width = 0, last = '', fails = 0, lastBg = '';
  for (let i = 0; !popup.isDestroyed(); i++) {
    let size = null;
    try { size = await win.webContents.executeJavaScript(MEASURE(i < 4), false); } catch { size = null; }
    if (popup.isDestroyed()) return;
    if (!size || !size.width) {
      if (++fails < 40) { await sleep(75); continue; }
      size = { width: 360, height: 480 };   // a page that never answers still gets a sensible box
    }
    // Width settles from the content's natural width and then only grows (so text doesn't reflow back
    // and forth); height follows the content.
    width = Math.min(POPUP_MAX.width, Math.max(i < 4 ? 0 : width, size.width, 25));
    const height = Math.min(POPUP_MAX.height, Math.max(size.height, 25));
    const key = width + 'x' + height;
    if (key !== last) {
      last = key;
      popup.setSize({ width, height });
      popup.updatePosition();
    }
    if (size.bg && size.bg !== lastBg && win.setPageBackground) { lastBg = size.bg; win.setPageBackground(size.bg); }
    if (popup.hidden && i >= 1) popup.show();
    await sleep(i < 20 ? 50 : 400);
  }
}

// Runs in an extension page during an import (see writeImportedData): opens one of the extension's
// IndexedDB databases (making it, with its stores and indexes, only when asked to and it isn't there) and
// puts records into it. A record that doesn't fit (a unique index already has its key…) is skipped, not fatal.
const IDB_WRITER_JS = `(() => {
  const dbs = new Map();
  return {
    async open(meta, mayCreate) {
      const list = indexedDB.databases ? await indexedDB.databases() : [];
      const have = list.find((x) => x.name === meta.name);
      if (!have && !mayCreate) return { ok: false, why: 'the extension has no such database' };
      const version = have ? have.version : Math.max(1, meta.version | 0);
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(meta.name, version);
        r.onupgradeneeded = () => {
          const db = r.result;
          for (const s of meta.stores) {
            if (db.objectStoreNames.contains(s.name)) continue;
            let os;
            try { os = db.createObjectStore(s.name, { keyPath: s.keyPath == null ? undefined : s.keyPath, autoIncrement: !!s.autoIncrement }); } catch (e) { continue; }
            for (const ix of s.indexes || []) { try { os.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry }); } catch (e) { /* skip it */ } }
          }
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('the database is in use'));
      });
      db.onversionchange = () => db.close();
      dbs.set(meta.name, db);
      return { ok: true, version, stores: [...db.objectStoreNames] };
    },
    async put(name, store, records) {
      const db = dbs.get(name);
      if (!db || !db.objectStoreNames.contains(store)) return { ok: 0, skipped: records.length };
      let ok = 0, skipped = 0;
      await new Promise((res) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const rec of records) {
          let r;
          try {
            const v = __fromWire(rec.value);
            r = os.keyPath == null ? os.put(v, __fromWire(rec.key)) : os.put(v);
          } catch (e) { skipped++; continue; }
          r.onsuccess = () => { ok++; };
          r.onerror = (e) => { e.preventDefault(); e.stopPropagation(); skipped++; };
        }
        tx.oncomplete = () => res();
        tx.onabort = () => res();
      });
      return { ok, skipped };
    },
    close(name) { const db = dbs.get(name); if (db) db.close(); dbs.delete(name); return true; },
  };
})()`;

// Values in firefox-storage.js's tagged form, made plain JSON the way chrome.storage would store them.
function jsonFromWire(v) {
  const TAG = '\u0000bifrost';
  if (Array.isArray(v)) return v.map((x) => { const y = jsonFromWire(x); return y === undefined ? null : y; });
  if (!v || typeof v !== 'object') return v;
  if (TAG in v) {
    const t = v[TAG];
    if (t === 'u') return undefined;
    if (t === 'n') return null;
    if (t === 'i') return String(v.v);
    return {};
  }
  const o = {};
  for (const [k, x] of Object.entries(v)) { const y = jsonFromWire(x); if (y !== undefined) o[k] = y; }
  return o;
}

function optionsUrl(ext) {
  const m = ext.manifest || {};
  const page = (m.options_ui && m.options_ui.page) || m.options_page;
  return page ? `chrome-extension://${ext.id}/${page.replace(/^\//, '')}` : '';
}

// The extension's icon as a data URL (internal pages can't load crx:// icons).
function iconData(dir, manifest) {
  if (!dir) return '';
  const icons = (manifest && (manifest.icons || (manifest.action || manifest.browser_action || {}).default_icon)) || {};
  let file = null;
  if (typeof icons === 'string') file = icons;
  else {
    const sizes = Object.keys(icons).map(Number).filter(Boolean).sort((a, b) => a - b);
    const pick = sizes.find((s) => s >= 48) || sizes[sizes.length - 1];
    if (pick) file = icons[String(pick)];
  }
  if (!file) return '';
  const p = path.resolve(dir, String(file).replace(/^\//, ''));
  if (!p.startsWith(path.resolve(dir) + path.sep)) return '';
  try {
    const buf = fs.readFileSync(p);
    if (buf.length > 512 * 1024) return '';
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

function latestVersionDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const vers = fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, 'manifest.json')));
  vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return vers.length ? path.join(dir, vers[vers.length - 1]) : null;
}

function waitForUi(ctl) {
  if (ctl.uiReady) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setInterval(() => { if (ctl.uiReady || ctl.win.isDestroyed()) { clearInterval(t); resolve(); } }, 50);
    setTimeout(() => { clearInterval(t); resolve(); }, 10000);
  });
}

module.exports = { Extensions };
