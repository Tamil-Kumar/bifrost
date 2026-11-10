'use strict';
// IPC handlers for the browser UI and internal pages. Access is checked per channel (see ipc.js).
const { app, BrowserWindow, dialog, shell, webContents: WC, clipboard, nativeTheme, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ipc = require('./ipc');
const ctx = require('./context');
const guests = require('./guests');
const windows = require('./windows');
const downloads = require('./downloads');
const permissions = require('./permissions');
const { DEFAULTS, COMMANDS, VIM_KEYS } = require('../shared/defaults');

function ctlOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
  return win ? ctx.registry.get(win.id) : null;
}

function isInternalGuest(wc) {
  return wc && !wc.isDestroyed() && wc.getType() === 'webview' && wc.getURL().startsWith('bifrost://');
}

function broadcastToPages(channel, payload, hostFilter) {
  for (const wc of WC.getAllWebContents()) {
    if (!isInternalGuest(wc)) continue;
    if (hostFilter && !wc.getURL().startsWith('bifrost://' + hostFilter)) continue;
    wc.send(channel, payload);
  }
}

function broadcastAll(channel, payload) {
  for (const ctl of ctx.registry.list()) ctl.send(channel, payload);
  broadcastToPages(channel, payload);
}

function register() {
  // Pages' own view of their notifications permission, and their notifications' clicks (permissions.js);
  // the ones they show through their service worker (notifications.js).
  permissions.initIpc();
  require('./notifications').initIpc();
  // --------------------------------------------------------------- window/UI
  ipc.handle('ui:init', 'ui', (event) => {
    const ctl = ctlOf(event);
    if (!ctl) throw new Error('unknown window');
    const restore = ctl.restoreState;
    ctl.restoreState = null;
    const urls = ctl.pendingUrls;
    ctl.pendingUrls = [];
    return {
      windowId: ctl.id, key: ctl.key, isPrivate: ctl.isPrivate, partition: ctl.partition,
      platform: process.platform, captionHeight: windows.CAPTION_HEIGHT, ownCaption: !!ctl.ownCaption,
      settings: ctx.settings.get(), restore, urls,
      profile: ctx.profile, systemDark: nativeTheme.shouldUseDarkColors,
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome },
      firstRun: !ctx.settings.get('onboarding.done'),
      commands: COMMANDS, vimKeys: VIM_KEYS,
      maximized: ctl.win.isMaximized(), fullscreen: ctl.win.isFullScreen(),
    };
  });
  ipc.on('ui:ready', 'ui', (event) => { const ctl = ctlOf(event); if (ctl) ctl.uiReady = true; });
  ipc.on('ui:response', 'ui', (event, { id, error, result }) => { const ctl = ctlOf(event); if (ctl) ctl.resolveRequest(id, error, result); });
  ipc.on('session:save', 'ui', (event, ui) => {
    const ctl = ctlOf(event);
    if (!ctl || ctl.isPrivate || !ui) return;
    const b = ctl.win.isDestroyed() ? null : ctl.win.getNormalBounds();
    ctx.sessionStore.save(ctl.key, ui, { bounds: b, maximized: !ctl.win.isDestroyed() && ctl.win.isMaximized() });
  });
  ipc.on('tabs:sync', 'ui', (event, tabs) => { const ctl = ctlOf(event); if (ctl) ctx.registry.syncTabs(ctl, tabs); });
  ipc.on('tab:selected', 'ui', (event, wcId) => {
    const wc = wcId != null && WC.fromId(wcId);
    if (wc && ctx.extensions) ctx.extensions.selectTab(wc);
    const ctl = ctlOf(event);
    if (ctl) ctx.sessionStore.touch(ctl.key);
  });
  // Ctrl+Tab with Ctrl still held just moved to this tab. Chromium ignores a page's key-ups until its next
  // key-down once a shortcut was taken from it, which would lose the Ctrl release; a repeat key-down of the
  // keys still held (what holding a key sends anyway) makes the release get through.
  ipc.on('tab:held-keys', 'ui', (event, wcId, keys) => {
    const wc = wcId != null && WC.fromId(wcId);
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents !== event.sender || !Array.isArray(keys)) return;
    const mods = keys.filter((k) => k === 'Control' || k === 'Alt' || k === 'Meta').map((k) => ({ Control: 'control', Alt: 'alt', Meta: 'meta' })[k]);
    for (const m of mods) wc.sendInputEvent({ type: 'keyDown', keyCode: { control: 'Control', alt: 'Alt', meta: 'Meta' }[m], modifiers: [...mods, 'isAutoRepeat'] });
  });
  ipc.handle('guest:action', 'ui', (event, wcId, action, args) => {
    const found = ctx.registry.find(wcId);
    const ctl = ctlOf(event);
    const wc = WC.fromId(wcId);
    // Only tabs that belong to this window (or are being attached to it).
    if (!wc || (found && found.ctl !== ctl) || (wc.hostWebContents && wc.hostWebContents !== event.sender)) throw new Error('not your tab');
    return guests.guestAction(wcId, action, args);
  });
  ipc.on('menu:ext-click', 'ui', (event, menuId, index) => guests.runExtensionMenuItem(menuId, index));
  ipc.on('window:control', 'ui', (event, action) => {
    const ctl = ctlOf(event);
    if (!ctl) return;
    const w = ctl.win;
    switch (action) {
      case 'minimize': w.minimize(); break;
      case 'maximize': w.isMaximized() ? w.unmaximize() : w.maximize(); break;
      case 'close': w.close(); break;
      case 'fullscreen': w.setFullScreen(!w.isFullScreen()); break;
      case 'newWindow': windows.create(); break;
      case 'newPrivateWindow': windows.create({ isPrivate: true }); break;
      case 'quit': app.quit(); break;
    }
  });
  ipc.on('window:caption-colors', 'ui', (event, colors) => { const ctl = ctlOf(event); if (ctl) windows.setCaptionColors(ctl, colors); });
  ipc.on('net:preconnect', 'ui', (event, url) => { const ctl = ctlOf(event); if (ctl && typeof url === 'string') require('./predictor').preconnect(ctl.ses, url, 1); });
  // Auto-hiding bars: follow the pointer for this window, and hide Windows' caption buttons with the top bar.
  ipc.on('window:edges', 'ui', (event, on) => { const ctl = ctlOf(event); if (ctl) require('./edges').set(ctl, !!on); });
  ipc.on('window:caption-hidden', 'ui', (event, hidden) => { const ctl = ctlOf(event); if (ctl) windows.setCaptionHidden(ctl, !!hidden); });
  ipc.on('window:open', 'ui', (event, opts) => {
    const urls = (Array.isArray(opts && opts.urls) ? opts.urls : []).map(String).filter((u) => /^(https?|ftp|file|bifrost):/i.test(u)).slice(0, 50);
    windows.create({ urls, isPrivate: !!(opts && opts.isPrivate) });
  });
  // Screenshots are saved by guestAction('screenshot'); the toast's buttons open them.
  ipc.handle('screenshot:open', 'ui', (event, file, reveal) => {
    const dir = guests.screenshotDir();
    const p = path.resolve(String(file || ''));
    if (!p.startsWith(dir + path.sep) || !fs.existsSync(p)) return false;
    if (reveal) shell.showItemInFolder(p); else shell.openPath(p);
    return true;
  });
  ipc.handle('reader:get', ['reader'], async (event, token, url) => guests.readerData(String(token || ''), String(url || '')));
  ipc.handle('window:list', 'ui', (event) => ctx.registry.list().filter((c) => !c.isPrivate).map((c) => ({ id: c.id, title: c.win.getTitle(), tabs: c.tabs.length, current: c === ctlOf(event) })));
  ipc.on('window:title', 'ui', (event, title) => { const ctl = ctlOf(event); if (ctl && !ctl.win.isDestroyed()) ctl.win.setTitle(String(title || 'Bifrost').slice(0, 300)); });
  ipc.handle('window:move-tab', 'ui', async (event, { windowId, tab }) => {
    // Moving a tab to another window reopens it there (with its back/forward history).
    const target = windowId === 'new' ? windows.create({ urls: [] }) : ctx.registry.get(windowId);
    if (!target) throw new Error('no such window');
    if (!target.uiReady) await new Promise((r) => { const t = setInterval(() => { if (target.uiReady) { clearInterval(t); r(); } }, 50); setTimeout(() => { clearInterval(t); r(); }, 8000); });
    target.send('adopt-tab', tab);
    target.win.focus();
    return true;
  });

  // ------------------------------------------------------------------ search
  ipc.handle('search:query', 'ui', (event, { raw, activeWcId }) => ctx.search.query({ raw, ctl: ctlOf(event), activeWcId }));
  ipc.handle('search:more', 'ui', (event, { raw, activeWcId }) => ctx.search.more({ raw, ctl: ctlOf(event), activeWcId }));
  // (a result opened from the launcher or the address bar's list: it ranks higher next time, search.js picks)
  ipc.on('search:picked', 'ui', (event, data) => { if (data && typeof data === 'object') ctx.search.picked({ raw: data.raw, url: data.url, command: data.command, ctl: ctlOf(event) }); });
  ipc.handle('search:forget-picks', 'internal', () => { ctx.search.forgetPicks(); return true; });
  ipc.handle('search:focus-tab', 'ui', (event, ref) => {
    const target = ref && ctx.registry.get(ref.windowId);
    if (!target) return false;
    target.send('select-tab', ref.tabId);
    if (target.win.isMinimized()) target.win.restore();
    target.win.focus();
    return true;
  });

  // ------------------------------------------------------------- closed tabs
  ipc.on('closed:push', 'ui', (event, data) => { const ctl = ctlOf(event); if (ctl && !ctl.isPrivate && data && data.url) ctx.db.pushClosedTab(data); });
  ipc.handle('closed:pop', 'ui', () => ctx.db.popClosedTab());
  ipc.handle('closed:list', 'internal', () => ctx.db.closedTabs(25));
  ipc.handle('closed:take', 'ui', (event, id) => ctx.db.removeClosedTab(id));

  // ---------------------------------------------------------------- settings
  ipc.handle('settings:get', 'internal', () => ctx.settings.get());
  ipc.handle('settings:set', 'internal', (event, p, value) => { ctx.settings.set(p, value); return ctx.settings.get(); });
  ipc.handle('settings:replace', ['settings'], (event, obj) => ctx.settings.replace(obj));
  ipc.handle('settings:reset', ['settings'], (event, section) => (section ? ctx.settings.resetSection(section) : ctx.settings.replace({})));
  ipc.handle('settings:defaults', 'internal', () => DEFAULTS);
  ipc.handle('settings:export', ['settings'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), 'bifrost-settings.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(ctx.settings.get(), null, 2));
    return r.filePath;
  });
  ipc.handle('settings:import', ['settings'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return false;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!data || typeof data !== 'object' || !('appearance' in data || 'tabs' in data || 'launcher' in data)) throw new Error('That file isn’t a Bifrost settings export');
    ctx.settings.replace(data);
    return true;
  });
  // Settings → Launcher → Backup: the launcher's settings to and from a file (the page makes and reads the
  // JSON: shared/launcher-settings.js).
  ipc.handle('settings:save-json', ['settings'], async (event, data, name) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const file = String(name || 'settings.json').replace(/[^\w.-]+/g, '-');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), file), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    return r.filePath;
  });
  ipc.handle('settings:open-json', ['settings'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 4 * 1024 * 1024) throw new Error('That file is too big to be a settings file');
    try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { throw new Error('That file isn’t a settings file (it isn’t JSON)'); }
  });
  ipc.handle('settings:pick-folder', ['settings', 'welcome'], async (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipc.handle('settings:pick-image', ['settings', 'newtab'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a background image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ------------------------------------------------------------------ history
  ipc.handle('history:visits', 'internal', (event, opts) => ctx.db.visits(opts || {}));
  ipc.handle('history:delete-visit', 'internal', (event, id) => ctx.db.deleteVisit(Number(id)));
  ipc.handle('history:delete-url', 'internal', (event, url) => ctx.db.deleteUrl(String(url)));
  ipc.handle('history:delete-range', 'internal', (event, start, end) => ctx.db.deleteHistoryRange(Number(start), Number(end)));
  ipc.handle('history:top', 'internal', (event, n) => ctx.db.topSites(n || 12));
  ipc.handle('history:recent', 'internal', (event, n) => ctx.db.recentHistory(n || 50));

  // ---------------------------------------------------------------- bookmarks
  ipc.handle('bookmarks:tree', 'internal', () => ctx.db.bookmarkTree());
  ipc.handle('bookmarks:children', 'internal', (event, id) => ctx.db.children(Number(id)));
  ipc.handle('bookmarks:get', 'internal', (event, id) => ctx.db.bookmark(Number(id)));
  ipc.handle('bookmarks:by-url', 'internal', (event, url) => ctx.db.bookmarksByUrl(String(url)));
  ipc.handle('bookmarks:create', 'internal', (event, d) => ctx.db.createBookmark(d));
  ipc.handle('bookmarks:update', 'internal', (event, id, d) => ctx.db.updateBookmark(Number(id), d));
  ipc.handle('bookmarks:move', 'internal', (event, id, d) => ctx.db.moveBookmark(Number(id), d));
  ipc.handle('bookmarks:remove', 'internal', (event, id) => ctx.db.removeBookmark(Number(id)));
  ipc.handle('bookmarks:search', 'internal', (event, text) => ctx.db.searchBookmarks(String(text || '')));
  ipc.handle('bookmarks:flat', 'internal', () => ctx.db.flatBookmarks());
  ipc.handle('bookmarks:speed-dial', 'internal', () => speedDial());
  // "Remove Other bookmarks": its contents move to the end of the bookmarks bar (or are deleted), and
  // the folder disappears from the bar, the side panel and the bookmark manager. Bifrost always keeps
  // the folder itself (extensions expect it), it just stays hidden and empty.
  ipc.handle('bookmarks:retire-other', 'internal', (event, mode) => {
    const OTHER = 3, BAR = 2;
    const kids = ctx.db.children(OTHER);
    for (const k of kids) {
      if (mode === 'delete') ctx.db.removeBookmark(k.id);
      else ctx.db.moveBookmark(k.id, { parentId: BAR });
    }
    ctx.settings.set('appearance.bookmarksBar.showOtherBookmarks', false);
    return kids.length;
  });
  ipc.handle('bookmarks:export-html', ['bookmarks', 'settings'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), 'bookmarks.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, require('./import/bookmarks-html').exportHtml(ctx.db.bookmarkTree()));
    return r.filePath;
  });

  // ---------------------------------------------------------------- downloads
  ipc.handle('downloads:list', 'internal', () => downloads.list());
  ipc.handle('downloads:action', 'internal', (event, id, action) => downloads.action(id, action));
  ipc.handle('downloads:clear', 'internal', () => downloads.clear());
  ipc.handle('downloads:folder', 'internal', () => downloads.folder());

  // --------------------------------------------------------------- site info
  ipc.handle('site:info', 'ui', (event, url) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* no host */ }
    const s = host ? ctx.db.siteSettings(host) : {};
    const ctl = ctlOf(event);
    return {
      host, permissions: host ? permissions.listForHost(host, !!(ctl && ctl.isPrivate)) : {}, zoom: s.zoom || 0,
      adblockAllowed: ctx.adblock ? ctx.adblock.allowlisted(host) : false,
      youtube: require('./adblock').isYouTube(host),
      vimOff: (ctx.settings.get('keyboard.vim.excludedSites') || []).some((h) => host === h || host.endsWith('.' + h)),
      httpAllowed: !!s.httpAllowed, siteCss: s.css || '', popups: !!s.popups,
      // dark mode here, and the styles that are for this page (main/web-styles.js)
      dark: ctx.webStyles ? ctx.webStyles.darkFor(url) : false,
      styles: ctx.webStyles ? ctx.webStyles.forPage(url) : [],
    };
  });
  ipc.handle('site:set', 'internal', (event, host, key, value) => {
    if (!host || !/^[a-z0-9.:\-\[\]]+$/i.test(host)) throw new Error('bad host');
    if (!/^(perm:[a-zA-Z-]+|zoom|httpAllowed|css|popups)$/.test(key)) throw new Error('bad key');
    // (a permission: its answer for now goes too, and the site's open pages hear of it)
    if (key.startsWith('perm:')) { permissions.setDecision(host, key.slice(5), value === 'allow' || value === 'block' ? value : null); return true; }
    ctx.db.setSiteSetting(host, key, value);
    if (key === 'css') { broadcastAll('site-css-changed', { host }); require('./guests').pushSiteCss(host); }
    return true;
  });
  ipc.handle('site:all', 'internal', () => ctx.db.allSiteSettings());
  ipc.handle('cert:allow', 'ui', (event, url) => require('./certs').allow(String(url || '')));

  // A menu drawn by the system rather than by the window: what the window shows for a page in full screen
  // (the page then covers the window, and only the system's menus can go over it). Resolves to the id of
  // the item chosen, or null.
  ipc.handle('menu:native', 'ui', (event, spec, pos) => new Promise((resolve) => {
    const { Menu } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const build = (list, withKeys) => (Array.isArray(list) ? list : []).slice(0, 80).map((o) => {
      if (!o || o.type === 'separator') return { type: 'separator' };
      // (On Windows "&" marks the letter to press: "&&" is a plain "&".)
      let label = String(o.label || '').slice(0, 200);
      if (process.platform === 'win32') label = label.replace(/&/g, '&&');
      const item = { label, enabled: o.enabled !== false };
      if (o.type === 'checkbox') { item.type = 'checkbox'; item.checked = !!o.checked; }
      if (withKeys && o.accel) { item.accelerator = String(o.accel); item.registerAccelerator = false; }
      if (Array.isArray(o.submenu)) item.submenu = build(o.submenu, withKeys);
      else if (Number.isInteger(o.id)) item.click = () => finish(o.id);
      return item;
    });
    let menu;
    try { menu = Menu.buildFromTemplate(build(spec, true)); } catch { menu = Menu.buildFromTemplate(build(spec, false)); }
    if (process.env.BIFROST_TEST) global.__bifrostLastNativeMenu = { spec, menu };
    const at = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {};
    // A choice comes in just before or just after the menu closes.
    menu.popup({ window: win || undefined, ...at, callback: () => setTimeout(() => finish(null), 150) });
  }));
  ipc.handle('site:clear', 'internal', (event, host) => ctx.db.clearSiteSettings(String(host)));
  ipc.handle('site:cookies', 'ui', async (event, url) => {
    const ctl = ctlOf(event);
    const ses = ctl ? ctl.ses : ctx.mainSession;
    try { return (await ses.cookies.get({ url })).length; } catch { return 0; }
  });
  ipc.handle('site:clear-data', 'ui', async (event, url) => {
    const ctl = ctlOf(event);
    const ses = ctl ? ctl.ses : ctx.mainSession;
    const origin = new URL(url).origin;
    await ses.clearStorageData({ origin });
    for (const c of await ses.cookies.get({ url })) await ses.cookies.remove(url, c.name).catch(() => {});
    return true;
  });

  // ------------------------------------------------------------------ adblock
  ipc.handle('adblock:status', 'internal', () => (ctx.adblock ? ctx.adblock.status() : { enabled: false }));
  ipc.handle('adblock:set-site', 'internal', (event, host, allowed) => { ctx.adblock.setAllowed(String(host), !!allowed); return true; });
  // A dangerous site you chose to visit anyway (until Bifrost quits); the warnings' lists.
  ipc.handle('safety:allow', 'ui', (event, url) => !!(ctx.safety && ctx.safety.allow(String(url))));
  ipc.handle('safety:status', 'internal', () => (ctx.safety ? ctx.safety.status() : null));
  ipc.handle('safety:update', ['settings'], () => (ctx.safety ? ctx.safety.update().then(() => ctx.safety.status()) : null));
  ipc.handle('adblock:count', 'ui', (event, wcId) => (ctx.adblock ? ctx.adblock.countFor(wcId) : 0));
  ipc.handle('adblock:update', ['settings'], () => ctx.adblock.updateLists());

  // --------------------------------------------------------------- extensions
  ipc.handle('extensions:list', 'internal', () => (ctx.extensions ? ctx.extensions.list() : []));
  ipc.handle('extensions:set-enabled', ['extensions'], (event, id, on) => ctx.extensions.setEnabled(String(id), !!on));
  ipc.handle('extensions:remove', 'internal', async (event, id) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const info = ctx.extensions.list().find((e) => e.id === id);
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1, message: `Remove ${info ? info.name : 'this extension'}?` });
    if (r.response !== 0) return false;
    return ctx.extensions.remove(String(id));
  });
  ipc.handle('extensions:reload', ['extensions'], (event, id) => ctx.extensions.reload(String(id)));
  ipc.handle('extensions:pin', 'internal', (event, id, pinned) => ctx.extensions.setPinned(String(id), !!pinned));
  ipc.handle('extensions:options', 'internal', (event, id) => ctx.extensions.openOptions(String(id)));
  ipc.handle('extensions:load-unpacked', ['extensions'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose an extension folder (with manifest.json)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return ctx.extensions.loadUnpacked(r.filePaths[0]);
  });
  ipc.handle('extensions:install-file', ['extensions'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a .crx or .zip extension', properties: ['openFile'], filters: [{ name: 'Extensions', extensions: ['crx', 'zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return ctx.extensions.installFile(r.filePaths[0]);
  });
  ipc.handle('extensions:install-store', ['extensions'], (event, id) => {
    const m = /([a-p]{32})/.exec(String(id || ''));
    if (!m) throw new Error('Paste a Chrome Web Store link or a 32-letter extension ID');
    return ctx.extensions.installFromStore(m[1]);
  });
  ipc.handle('extensions:shortcuts', 'internal', () => (ctx.extensions ? ctx.extensions.commandList() : []));
  // acc: a shortcut, "" for none, or null to go back to the extension's own suggestion.
  ipc.handle('extensions:set-shortcut', ['extensions', 'settings'], (event, extId, name, acc) => ctx.extensions.setCommandShortcut(String(extId), String(name), acc === null || acc === undefined ? null : String(acc)));
  // Side panels: which ones a window can show, which one it's about to attach, and what's showing.
  ipc.handle('extensions:side-panels', 'ui', (event) => { const ctl = ctlOf(event); return ctl && !ctl.isPrivate && ctx.extensions.sidePanels ? ctx.extensions.sidePanels(ctl) : []; });
  // (several can be on their way at once: each is matched to its <webview> by address, windows.js)
  const expect = (ctl, panel) => {
    const now = Date.now();
    ctl.pendingPanels = (ctl.pendingPanels || []).filter((p) => now - p.at < 10000 && p.id !== panel.id).concat(Object.assign(panel, { at: now })).slice(-8);
    return true;
  };
  ipc.handle('extensions:side-panel-attach', 'ui', (event, id, url) => {
    const ctl = ctlOf(event);
    if (!ctl || ctl.isPrivate || !/^chrome-extension:\/\/[a-p]{32}\//.test(String(url)) || !String(url).startsWith(`chrome-extension://${id}/`)) return false;
    return expect(ctl, { id: String(id), url: String(url) });
  });
  // A website in the side panel: the UI says which just before its <webview> attaches.
  ipc.handle('panels:web-attach', 'ui', (event, id, url) => {
    const ctl = ctlOf(event);
    if (!ctl || !/^https?:\/\/[^\s]+$/i.test(String(url || '')) || !/^[\w-]{1,40}$/.test(String(id || ''))) return false;
    return expect(ctl, { id: 'web:' + id, url: String(url), web: true });
  });
  ipc.handle('panels:extension-candidates', ['settings'], () => (ctx.extensions && ctx.extensions.panelCandidates ? ctx.extensions.panelCandidates() : []));
  ipc.on('extensions:side-panel-state', 'ui', (event, { id, path: p, shown }) => { const ctl = ctlOf(event); if (ctl && ctx.extensions.sidePanelShown) ctx.extensions.sidePanelShown(ctl, String(id), String(p || ''), !!shown); });
  // Switching tabs, or a click elsewhere in the window, closes an extension's popup (as in Chrome: there,
  // it's a separate window that loses focus).
  ipc.on('ext-popup:close', 'ui', (event, reason) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) require('./extensions/popup-host').PopupHost.closeAllIn(win, reason === 'switch' ? 'switch' : 'pointer');
  });
  // A toolbar button click: some extensions open their side panel instead of a popup.
  ipc.handle('extensions:action-click', 'ui', (event, id, pressedAt) => {
    const ctl = ctlOf(event);
    // This click is what just closed this extension's popup (pressing the button took the focus from it):
    // leave it closed. (A popup that closed before the button was pressed — a click on the page a moment
    // earlier — doesn't count.)
    const last = require('./extensions/popup-host').PopupHost.lastClosed;
    const pressed = Number(pressedAt) || 0;
    if (last.id === String(id) && Date.now() - last.at < 1000 && (!pressed || last.at >= pressed - 150)) return { panel: false, justClosed: true };
    if (!ctl || !ctx.extensions.panelOnActionClick || !ctx.extensions.panelOnActionClick(String(id))) return { panel: false };
    return { panel: ctx.extensions.openSidePanel(String(id), ctl) };
  });

  ipc.handle('perf:usage', ['settings', 'tasks'], () => require('./perf').usage());

  // ------------------------------------------------------- start page modules
  const NTP_KEYS = new Set(['notes', 'todo']);
  ipc.handle('ntp:data-get', ['newtab', 'settings'], (event, key) => (NTP_KEYS.has(key) ? ctx.db.kvGet('ntp.' + key, null) : null));
  ipc.handle('ntp:data-set', ['newtab'], (event, key, value) => {
    if (!NTP_KEYS.has(key)) throw new Error('unknown start page data ' + key);
    if (JSON.stringify(value || null).length > 256 * 1024) throw new Error('That’s too much to keep here');
    ctx.db.kvSet('ntp.' + key, value);
    broadcastToPages('ntp-data', { key, from: event.sender.id });
    return true;
  });
  ipc.handle('ntp:weather', ['newtab', 'settings'], (event, city, units) => require('./weather').forecast(String(city || ''), String(units || 'auto')));
  ipc.handle('ntp:stats', ['newtab'], () => {
    const u = require('./perf').usage();
    const tabs = require('electron').webContents.getAllWebContents().filter((w) => w.getType() === 'webview' && !w.isDestroyed()).length;
    return { memory: u.total, processes: u.processes, pagesLoaded: tabs, adsBlocked: ctx.adblock ? ctx.adblock.total : 0, adblock: !!(ctx.adblock && ctx.adblock.settings && ctx.adblock.settings.enabled) };
  });

  // --------------------------------------------------------------------- app
  ipc.handle('app:info', 'internal', async () => ({
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, profile: ctx.profile, exe: app.getPath('exe'),
    userAgent: require('./useragent').defaultUA(), isDefault: await require('./default-browser').isDefault(),
    drm: require('./drm').info(), updates: ctx.updater ? ctx.updater.info() : null,
  }));
  ipc.handle('app:open-path', ['settings', 'about'], (event, which) => {
    const p = which === 'profile' ? ctx.profile.dir : which === 'downloads' ? downloads.folder() : null;
    if (p) shell.openPath(p);
    return !!p;
  });
  ipc.handle('app:relaunch', ['settings'], () => { app.relaunch(); ctx.quitting = true; app.quit(); });
  ipc.handle('app:make-default', ['settings', 'about', 'welcome'], () => require('./default-browser').makeDefault());
  ipc.handle('app:install-shortcuts', ['settings', 'about'], (event, opts) => require('./default-browser').installShortcuts(opts || {}));
  ipc.handle('app:open-external', 'internal', (event, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); return true; });
  ipc.on('app:open-url', 'internal', (event, url, opts) => {
    const ctl = ctlOf(event);
    if (ctl) ctl.send('open-url', Object.assign({ url: String(url) }, opts || {}));
  });
  ipc.on('app:command', 'internal', (event, id, args) => {
    const ctl = ctlOf(event);
    if (ctl) ctl.send('command', String(id), args || {});
  });
  ipc.handle('app:clear-data', 'internal', (event, what, since) => require('./clear-data').clear(what || {}, Number(since) || 0));
  ipc.handle('app:metrics', 'internal', () => require('./tasks').metrics());
  ipc.handle('app:kill-process', ['tasks'], (event, pid) => require('./tasks').kill(Number(pid)));
  ipc.handle('app:clipboard-text', 'ui', () => clipboard.readText());

  // ------------------------------------------------------------------ import
  ipc.handle('import:detect', ['settings', 'welcome', 'bookmarks'], () => require('./import').detect());
  ipc.handle('import:run', ['settings', 'welcome', 'bookmarks'], (event, source, what) => require('./import').run(source, what || {}));
  ipc.handle('import:extensions-scan', ['settings', 'welcome', 'extensions'], (event, source) => require('./import/extensions').scan(String(source)));
  ipc.handle('import:extensions-run', ['settings', 'welcome', 'extensions'], (event, source, keys, opts) => require('./import/extensions').run(String(source), Array.isArray(keys) ? keys.map(String) : [], opts || {}));
  ipc.handle('import:extensions-lookup', ['settings', 'welcome', 'extensions'], (event, source, keys) => require('./import/extensions').lookup(String(source), Array.isArray(keys) ? keys.map(String) : []));
  // Picks a browser profile folder and says what's in it (for importing just its extensions).
  ipc.handle('import:pick-folder', ['settings', 'welcome', 'extensions'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a browser’s profile folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = require('./import').sourceFromFolder(r.filePaths[0]);
    if (!src) throw new Error('No Firefox or Chromium profile was found in that folder');
    return src;
  });
  // A browser profile folder you pick (portable browsers keep theirs next to the app).
  ipc.handle('import:folder', ['settings', 'welcome'], async (event, what) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a browser’s profile folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const imp = require('./import');
    const src = imp.sourceFromFolder(r.filePaths[0]);
    if (!src) throw new Error('No Firefox or Chromium profile was found in that folder');
    return Object.assign({ name: src.name }, await imp.run(src.id, what || {}));
  });
  ipc.handle('import:html', ['settings', 'welcome', 'bookmarks'], async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender.hostWebContents || event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a bookmarks HTML file', properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return require('./import').importFile(r.filePaths[0]);
  });

  // ---------------------------------------------------------------- updates
  ipc.handle('updates:info', 'internal', () => ctx.updater.info());
  ipc.handle('updates:check', ['settings', 'about'], () => ctx.updater.check({ download: true }));
  ipc.handle('updates:restart', ['settings', 'about'], () => ctx.updater.restart());
  ctx.updater.on('changed', (i) => broadcastAll('updates-changed', i));

  // ------------------------------------------------------------------- sync
  ipc.handle('sync:info', ['settings', 'history', 'welcome'], () => ctx.sync.info());
  ipc.handle('sync:tabs', ['history'], () => ctx.sync.remoteTabs());
  ipc.handle('sync:now', ['settings'], () => ctx.sync.syncNow());
  ipc.handle('sync:remove-device', ['settings'], (event, id) => ctx.sync.removeDevice(String(id || '')));
  ipc.handle('sync:suggest', ['settings', 'welcome'], () => ctx.sync.suggestFolders());

  // ---------------------------------------------------------- keyboard capture
  ipc.on('kbd:capture', 'internal', (event, on) => {
    const wc = event.sender;
    if (wc.getType() === 'webview') guests.guestAction(wc.id, 'captureKeyboard', { on: !!on });
  });

  // Push setting changes to every window and internal page.
  ctx.settings.on('changed', ({ path: p, settings }) => {
    broadcastAll('settings-changed', { path: p, settings });
    if (!p || p.startsWith('appearance')) windows.updateTitleBars();
    // Windows: the auto-hiding top bar needs windows that draw their own caption buttons; remake them.
    if (p === 'appearance.topbarAutoHide' || p === 'appearance' || !p) setTimeout(() => windows.rebuildMismatched(), 150);
    if (!p || p.startsWith('advanced')) require('./sessions').refreshAll(p);
    if (!p || p.startsWith('performance')) require('./perf').applyToTabs();
    // (how much history the launcher searches instantly: its own setting, or the performance profile's)
    if (!p || p.startsWith('performance') || p === 'launcher' || p === 'launcher.historyIndex') { if (ctx.search && ctx.search.loadHistory) { try { ctx.search.loadHistory(); } catch { /* not ready */ } } }
  });
  ctx.db.on('bookmarks-changed', (e) => broadcastAll('bookmarks-changed', e));
  ctx.db.on('history-changed', () => broadcastToPages('history-changed', {}));
  if (ctx.sync) ctx.sync.on('changed', () => broadcastAll('sync-changed', {}));
  // How websites look (main/web-styles.js): dark mode for a site, and your styles (Settings → Website styles,
  // the site info popover).
  const WS = () => { if (!ctx.webStyles) throw new Error('Bifrost isn’t ready'); return ctx.webStyles; };
  ipc.handle('web:dark-site', ['settings'], (event, host, on) => { WS().setSiteDark(String(host || ''), !!on); return WS().darkFor('https://' + String(host || '') + '/'); });
  ipc.handle('styles:list', ['settings'], () => WS().list());
  ipc.handle('styles:get', ['settings'], (event, id) => WS().get(String(id || '')));
  ipc.handle('styles:save', ['settings'], (event, o) => WS().put(String((o && o.code) || ''), { id: (o && o.id) || null, values: (o && o.values) || null }));
  ipc.handle('styles:set-enabled', ['settings'], (event, id, on) => WS().setEnabled(String(id || ''), !!on));
  ipc.handle('styles:delete', ['settings'], (event, id) => WS().remove(String(id || '')));
  ipc.handle('styles:preview', ['settings'], (event, url) => WS().preview(String(url || '')));
  ipc.handle('styles:install', ['settings'], (event, o) => WS().put(String((o && o.code) || ''), { from: 'url', url: String((o && o.url) || '') }));
  ipc.handle('styles:import-stylus', ['settings'], (event, text) => WS().importStylus(String(text || '')));
  ipc.handle('styles:check-updates', ['settings'], () => WS().checkUpdates());
  ipc.handle('styles:theme', ['settings'], () => WS().themeStatus());
  if (ctx.webStyles) {
    ctx.webStyles.on('changed', () => broadcastToPages('styles-changed', {}, 'settings'));
    ctx.webStyles.on('progress', (p) => broadcastToPages('styles-progress', p, 'settings'));
    ctx.webStyles.on('theme', (s) => broadcastToPages('styles-theme', s, 'settings'));
  }
  // Settings → Accounts: your Google accounts, as Google lists them (main/google-accounts.js).
  ipc.handle('google:accounts', ['settings'], (event, opts) => ctx.googleAccounts.accounts(!!(opts && opts.refresh)));
  if (ctx.googleAccounts) ctx.googleAccounts.on('changed', (s) => broadcastToPages('google-accounts-changed', s, 'settings'));
  require('./icons').onChange((e) => broadcastAll('site-icon', e));
  nativeTheme.on('updated', () => broadcastAll('system-theme', { dark: nativeTheme.shouldUseDarkColors }));
}

// The Speed Dial folder for the new tab page: the chosen folder, a folder named "Speed Dial", or the bar.
function speedDial() {
  const want = ctx.settings.get('appearance.newTab.speedDialFolder');
  const tree = ctx.db.bookmarkTree();
  let folder = null;
  const walk = (n) => {
    if (folder || !n.children) return;
    if (want ? String(n.id) === String(want) : /^speed ?dial$/i.test(n.title)) { folder = n; return; }
    n.children.forEach(walk);
  };
  walk(tree);
  if (!folder) folder = (tree.children || []).find((c) => c.role === 'bar');
  const items = (folder && folder.children ? folder.children : []).filter((c) => c.type !== 'separator');
  return { folder: folder ? { id: folder.id, title: folder.title } : null, items };
}

module.exports = { register, broadcastAll, broadcastToPages };
