'use strict';
// Browser windows: creation, title bar, bounds persistence, and the hardening applied to every <webview>.
const { BrowserWindow, screen, dialog, nativeTheme, app, session } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const ctx = require('./context');
const guests = require('./guests');
const themes = require('../shared/themes');

const PRELOAD_UI = path.join(__dirname, '..', 'preload', 'ui.js');
const PRELOAD_TAB = path.join(__dirname, '..', 'preload', 'tab.js');
const IS_WIN = process.platform === 'win32';
const CAPTION_HEIGHT = 40;
// The toolbar height setting moves Windows' caption buttons with it.
function captionHeight() {
  const v = ctx.settings ? ctx.settings.get('appearance.sizes.toolbarHeight') : -1;
  return typeof v === 'number' && v >= 0 ? Math.max(28, Math.min(64, Math.round(v))) : CAPTION_HEIGHT;
}

class WindowController {
  constructor({ isPrivate, key, restoreState }) {
    this.isPrivate = !!isPrivate;
    this.key = key || crypto.randomUUID();
    this.restoreState = restoreState || null; // UI state to restore (tabs, workspaces…)
    this.pendingUrls = [];
    this.tabs = [];
    this.requests = new Map();
    this.reqSeq = 0;
    this.closeConfirmed = false;
    this.win = null;
    this.id = 0;
    this.partition = null;
  }

  send(channel, ...args) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, ...args);
  }

  // Ask the UI to do something and wait for its answer (e.g. an extension creating a tab).
  request(method, args = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.reqSeq;
      const t = setTimeout(() => { this.requests.delete(id); reject(new Error('UI did not answer ' + method)); }, timeoutMs);
      this.requests.set(id, { resolve, reject, t });
      this.send('ui-request', { id, method, args });
    });
  }

  resolveRequest(id, error, result) {
    const r = this.requests.get(id);
    if (!r) return;
    this.requests.delete(id);
    clearTimeout(r.t);
    if (error) r.reject(new Error(error)); else r.resolve(result);
  }
}

function themeColors() {
  const a = ctx.settings.get('appearance');
  const t = themes.resolve(a, { systemDark: nativeTheme.shouldUseDarkColors });
  return t;
}

function visibleBounds(b) {
  if (!b) return null;
  const displays = screen.getAllDisplays();
  const ok = displays.some((d) => {
    const w = d.workArea;
    return b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y >= w.y - 20 && b.y < w.y + w.height - 60;
  });
  return ok ? b : null;
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, Math.round(wa.width * 0.86));
  const height = Math.min(940, Math.round(wa.height * 0.88));
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}

function create({ isPrivate = false, urls = [], key = null, restoreState = null, bounds = null, maximized = false, show = true } = {}) {
  const ctl = new WindowController({ isPrivate, key, restoreState });
  ctl.pendingUrls = urls.slice();
  const a = ctx.settings.get('appearance');
  const t = themeColors();
  const saved = !bounds && !isPrivate ? ctx.db.kvGet('windowBounds') : null;
  const b = visibleBounds(bounds) || visibleBounds(saved && saved.bounds) || defaultBounds();
  if (!bounds && ctx.registry.list().length) { b.x += 28; b.y += 28; }

  const useSystemFrame = a.useSystemTitleBar;
  const opts = {
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: 520, minHeight: 360,
    show: false,
    title: 'Bifrost',
    backgroundColor: isPrivate ? '#1a1325' : t.mantle,
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_UI,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  };
  // With an auto-hiding top bar, Windows' own caption buttons (drawn by the system over the corner) would
  // stay on screen over the page; Bifrost draws its own in the top bar instead, so they hide with it.
  ctl.ownCaption = IS_WIN && !useSystemFrame && !!a.topbarAutoHide;
  if (!useSystemFrame) {
    if (ctl.ownCaption) {
      opts.frame = false;
    } else if (IS_WIN) {
      opts.titleBarStyle = 'hidden';
      opts.titleBarOverlay = { color: t.mantle, symbolColor: t.text, height: captionHeight() };
    } else if (process.platform === 'darwin') {
      opts.titleBarStyle = 'hiddenInset';
    } else {
      opts.frame = false;
    }
  }
  if (IS_WIN && !useSystemFrame && (a.windowMaterial === 'mica' || a.windowMaterial === 'acrylic')) {
    opts.backgroundMaterial = a.windowMaterial;
    opts.backgroundColor = '#00000000';
  }

  const win = new BrowserWindow(opts);
  ctl.win = win;
  ctl.id = win.id;
  ctl.partition = isPrivate ? 'private-' + ctl.key : 'persist:main';
  ctl.ses = isPrivate ? session.fromPartition(ctl.partition, { cache: true }) : ctx.mainSession;
  if (isPrivate) ctx.setupBrowsingSession(ctl.ses, { isPrivate: true });
  ctx.registry.addWindow(ctl);

  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    if (params.partition !== ctl.partition) { e.preventDefault(); return; }
    delete webPreferences.preloadURL;
    // An extension's side panel, or a website in it (announced by the UI just before), isn't a tab. A website
    // gets what a page in a tab gets from the tab preload (the user agent its site needs, notifications it can
    // ask for, Bifrost's dialogs, the pop-up blocker, site styles, browser shortcuts the page lets through), and
    // the ad blocker's, in its frames too.
    const i = (ctl.pendingPanels || []).findIndex((p) => p.url === params.src && Date.now() - p.at < 10000);
    const panel = i >= 0 ? ctl.pendingPanels.splice(i, 1)[0] : null;
    if (panel && (panel.web || !ctl.isPrivate)) {
      ctl.attachingPanels = (ctl.attachingPanels || []).slice(-8).concat({ panel, instanceId: params.instanceId, url: params.src });
      delete webPreferences.preload;
      Object.assign(webPreferences, {
        nodeIntegration: false, nodeIntegrationInSubFrames: !!panel.web, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: ctx.settings.get('advanced.spellcheck'),
      });
      if (panel.web) Object.assign(webPreferences, { preload: PRELOAD_TAB, plugins: true, enableWebSQL: false, safeDialogs: true, safeDialogsMessage: 'Stop this site from showing more dialogs', scrollBounce: true });
      return;
    }
    // A tab coming back with its back/forward history starts with no page at all, because history
    // can only be restored into a webContents that has never loaded anything (the UI restores it next).
    if (/^about:blank#wb-restore$/.test(params.src || '')) params.src = '';
    // nodeIntegrationInSubFrames only makes preloads run in iframes too (the ad blocker's hiding rules and
    // page scripts, extensions' content); tabs are sandboxed, so no Node.js is exposed anywhere.
    Object.assign(webPreferences, {
      preload: PRELOAD_TAB,
      nodeIntegration: false, nodeIntegrationInSubFrames: true, nodeIntegrationInWorker: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, plugins: true, enableWebSQL: false, navigateOnDragDrop: false,
      spellcheck: ctx.settings.get('advanced.spellcheck'),
      safeDialogs: true, safeDialogsMessage: 'Stop this site from showing more dialogs',
      scrollBounce: true, backgroundThrottling: !!require('./perf').current().backgroundThrottling,
    });
    // Windows: clicking the mouse wheel and moving scrolls the page, as in Chrome there.
    if (process.platform === 'win32' && ctx.settings.get('advanced.middleClickAutoscroll') !== false) webPreferences.enableBlinkFeatures = 'MiddleClickAutoscroll';
  });
  win.webContents.on('did-attach-webview', (e, guest) => {
    // (which one this is: by the <webview> it's for, else by the address it's loading)
    const list = ctl.attachingPanels || [];
    let i = list.findIndex((a) => a.instanceId != null && a.instanceId === guest.viewInstanceId);
    if (i < 0) { let url = ''; try { url = guest.getURL(); } catch { /* gone */ } i = list.findIndex((a) => a.url === url); }
    const panel = i >= 0 ? list.splice(i, 1)[0].panel : null;
    guests.watchVisibility(guest);
    if (panel) guests.setupPanel(guest, ctl, panel);
    else guests.setup(guest, ctl);
  });

  // Extension shortcuts work while the browser UI has focus too.
  win.webContents.on('before-input-event', (e, input) => {
    if (ctx.extensions && ctx.extensions.commands && ctx.extensions.commands.handleKey(input, ctl)) e.preventDefault();
  });

  // The UI itself never navigates or opens windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => {
    if (!show) return;
    if (maximized || (!bounds && saved && saved.maximized && !ctx.registry.list().some((c) => c !== ctl))) win.maximize();
    win.show();
  });
  win.on('focus', () => { ctx.registry.focus(win.id); ctl.send('window-focus', true); });
  win.on('blur', () => ctl.send('window-focus', false));
  win.on('enter-full-screen', () => ctl.send('fullscreen', true));
  win.on('leave-full-screen', () => ctl.send('fullscreen', false));
  win.on('maximize', () => ctl.send('maximized', true));
  win.on('unmaximize', () => ctl.send('maximized', false));
  win.on('enter-html-full-screen', () => ctl.send('html-fullscreen', true));
  win.on('leave-html-full-screen', () => ctl.send('html-fullscreen', false));
  // The mouse's back and forward buttons (and the Back/Forward keys some keyboards have), as in any browser.
  win.on('app-command', (e, command) => {
    if (command === 'browser-backward') { e.preventDefault(); ctl.send('command', 'back', { source: 'mouse' }); }
    else if (command === 'browser-forward') { e.preventDefault(); ctl.send('command', 'forward', { source: 'mouse' }); }
  });

  const saveBounds = debounce(() => {
    if (win.isDestroyed() || isPrivate || win.isFullScreen() || win.isMinimized()) return;
    ctx.db.kvSet('windowBounds', { bounds: win.isMaximized() ? (ctx.db.kvGet('windowBounds') || {}).bounds || win.getNormalBounds() : win.getNormalBounds(), maximized: win.isMaximized() });
  }, 500);
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);

  win.on('close', (e) => {
    if (ctx.quitting || ctl.closeConfirmed || ctl.rebuilding) return;
    e.preventDefault();
    if (ctl.closing) return;
    ctl.closing = true;
    (async () => {
      // Pages with changes that aren't saved get to say so first, as when closing a tab. (A window that
      // doesn't answer in time closes anyway.)
      let dirty = 0;
      try { dirty = Number(await ctl.request('unload-dirty', {}, 4000)) || 0; } catch { dirty = 0; }
      if (dirty > 0) {
        const r = await dialog.showMessageBox(win, {
          type: 'question', buttons: ['Leave', 'Stay'], defaultId: 0, cancelId: 1, noLink: true,
          message: dirty === 1 ? 'Leave site?' : `Leave ${dirty} sites?`, detail: 'Changes you made may not be saved.',
        });
        if (r.response !== 0) return;
      }
      const liveTabs = ctl.tabs.length;
      const others = ctx.registry.list().filter((c) => c !== ctl && !c.isPrivate).length;
      // Closing the last window keeps its tabs for next time, so only confirm when they'd be lost.
      const losing = isPrivate || others > 0;
      if (losing && liveTabs > 1 && ctx.settings.get('tabs.confirmCloseWindow')) {
        const r = await dialog.showMessageBox(win, {
          type: 'question', buttons: ['Close window', 'Cancel'], defaultId: 0, cancelId: 1,
          message: `Close ${liveTabs} tabs?`, detail: isPrivate ? 'Private tabs can’t be restored.' : 'You can reopen them from History.',
          checkboxLabel: 'Don’t ask again', checkboxChecked: false,
        });
        if (r.checkboxChecked) ctx.settings.set('tabs.confirmCloseWindow', false);
        if (r.response !== 0) return;
      }
      ctl.closeConfirmed = true;
      if (!win.isDestroyed()) win.close();
    })().catch((err) => { console.error('[windows] closing', err); ctl.closeConfirmed = true; if (!win.isDestroyed()) win.close(); })
      .finally(() => { ctl.closing = false; });
  });
  // Windows signing out or shutting down: close straight away (no questions that would hold it up).
  win.on('query-session-end', () => { ctx.quitting = true; });
  win.on('session-end', () => { ctx.quitting = true; });
  win.on('closed', () => {
    require('./edges').stop(ctl);
    for (const r of ctl.requests.values()) { clearTimeout(r.t); r.reject(new Error('window closed')); }
    const others = ctx.registry.list().filter((c) => c !== ctl && !c.isPrivate).length;
    if (!isPrivate && others > 0 && !ctx.quitting && !ctl.rebuilding) ctx.sessionStore.removeWindow(ctl.key);
    ctx.registry.removeWindow(ctl.id);
    if (isPrivate) clearPrivateSession(ctl.ses);
  });

  const q = new URLSearchParams({ id: String(ctl.id), key: ctl.key });
  if (isPrivate) q.set('private', '1');
  win.loadURL('bifrost://ui/browser.html?' + q.toString());
  return ctl;
}

async function clearPrivateSession(ses) {
  try { await ses.clearStorageData(); await ses.clearCache(); } catch { /* best effort */ }
}

// Reopens a window just as it is (tabs, spaces, splits, size), for a frame change that only takes effect
// when a window is made: on Windows, the auto-hiding top bar draws its own caption buttons (see create).
// Pages reload. Private windows keep their frame until they're closed (their tabs can't be saved).
async function rebuild(ctl) {
  if (!ctl || ctl.isPrivate || !ctl.win || ctl.win.isDestroyed() || ctl.rebuilding) return null;
  let ui = null;
  try { ui = await ctl.request('session-state', {}, 4000); } catch { /* use the saved copy */ }
  if (!ui) { const saved = ctx.sessionStore.state.windows[ctl.key]; ui = saved && saved.ui; }
  if (!ui || !Array.isArray(ui.workspaces)) return null;
  const win = ctl.win;
  const maximized = win.isMaximized();
  const fullscreen = win.isFullScreen();
  const bounds = win.getNormalBounds();
  const focused = win.isFocused();
  ctl.rebuilding = true;
  ctl.closeConfirmed = true;
  const next = create({ key: ctl.key, restoreState: ui, bounds, maximized });
  next.win.once('ready-to-show', () => {
    if (fullscreen) next.win.setFullScreen(true);
    if (focused) next.win.focus();
    if (!win.isDestroyed()) win.close();
  });
  return next;
}

// Windows whose frame doesn't match the settings any more (top bar auto-hide switched on Windows).
function rebuildMismatched() {
  if (!IS_WIN) return;
  const a = ctx.settings.get('appearance');
  const want = !a.useSystemTitleBar && !!a.topbarAutoHide;
  for (const ctl of ctx.registry.list()) if (!ctl.isPrivate && !!ctl.ownCaption !== want && !a.useSystemTitleBar) rebuild(ctl);
}

function updateTitleBars() {
  const t = themeColors();
  for (const ctl of ctx.registry.list()) {
    if (!IS_WIN || ctl.win.isDestroyed() || ctl.ownCaption) continue;
    ctl.captionColors = { background: ctl.isPrivate ? '#221a30' : t.mantle, symbol: t.text };
    applyOverlay(ctl);
  }
}

function setCaptionColors(ctl, colors) {
  if (!IS_WIN || ctl.win.isDestroyed() || ctl.ownCaption) return;
  ctl.captionColors = colors;
  applyOverlay(ctl);
}

// A window made before the top bar was set to auto-hide still has Windows' caption buttons: while the bar
// is hidden they're shrunk to nothing and painted in the page's colors (a new window gets Bifrost's own).
function setCaptionHidden(ctl, hidden) {
  if (!IS_WIN || ctl.win.isDestroyed() || ctl.ownCaption) return;
  ctl.captionHidden = !!hidden;
  applyOverlay(ctl);
}

function applyOverlay(ctl) {
  const c = ctl.captionColors || {};
  const hidden = ctl.captionHidden;
  try {
    ctl.win.setTitleBarOverlay(hidden
      ? { color: '#00000000', symbolColor: '#00000000', height: 1 }
      : { color: c.background || themeColors().mantle, symbolColor: c.symbol || themeColors().text, height: captionHeight() });
  } catch { /* system frame */ }
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Opens URLs in the most recent normal window (or a new one).
function openUrls(urls, { newWindow = false } = {}) {
  const ctl = !newWindow && ctx.registry.lastFocused({ private: false });
  if (ctl) {
    for (const url of urls) ctl.send('open-url', { url, background: false });
    if (ctl.win.isMinimized()) ctl.win.restore();
    ctl.win.focus();
    return ctl;
  }
  return create({ urls });
}

module.exports = { create, openUrls, updateTitleBars, setCaptionColors, setCaptionHidden, rebuild, rebuildMismatched, WindowController, CAPTION_HEIGHT, captionHeight };
