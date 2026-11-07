'use strict';
// Bifrost browser — main process entry.
const { app, session, BrowserWindow, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const paths = require('./paths');
const protocol = require('./protocol');
const ctx = require('./context');

// ----------------------------------------------------------------- before ready
// Every renderer is sandboxed (they all were already, one by one). Doing it for the whole app is also what
// makes Electron run preload scripts in extensions' service workers, and that is where the chrome.* APIs
// Electron lacks (permissions, contextMenus, windows, tabs.create, webNavigation, notifications…) come from:
// without it, Manifest V3 extensions like Stylus and Dark Reader fail as they start.
app.enableSandbox();
const profile = paths.setup();
ctx.profile = profile;
protocol.registerSchemes();

// Settings that must be applied before ready.
const settingsMod = require('./settings');
const settings = settingsMod.open(profile.dir);
ctx.settings = settings;
if (!settings.get('advanced.hardwareAcceleration')) app.disableHardwareAcceleration();
if (!settings.get('advanced.smoothScrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling');
if (process.platform === 'linux' && settings.get('advanced.waylandNative')) app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,BackForwardCache');
// The performance profile's startup switches (renderer process limit, background throttling).
require('./perf').applyStartupSwitches(settings);
// Keep background tabs' timers alive enough for media/notifications; sleeping tabs handle memory.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// One instance per profile: later launches (e.g. links from other apps) open in the running browser.
if (!app.requestSingleInstanceLock({ profile: profile.dir })) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const urls = urlsFromArgv(argv);
    const windows = require('./windows');
    if (argv.includes('--new-window') || !ctx.registry.lastFocused({ private: false })) windows.create({ urls });
    else if (argv.includes('--private')) windows.create({ urls, isPrivate: true });
    else windows.openUrls(urls.length ? urls : []);
    const last = ctx.registry.lastFocused();
    if (last) { if (last.win.isMinimized()) last.win.restore(); last.win.focus(); }
  });
  start();
}

function urlsFromArgv(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    if (/^(https?|file|ftp|bifrost):/i.test(a)) out.push(a);
    else if (/\.(html?|pdf|xhtml|svg|txt|png|jpe?g|webp)$/i.test(a)) {
      try { const p = path.resolve(a); if (require('node:fs').existsSync(p)) out.push(require('node:url').pathToFileURL(p).toString()); } catch { /* ignore */ }
    }
  }
  return out;
}

function start() {
  // An update downloaded last time goes in first (its helper starts Bifrost again once it's in).
  const { Updater } = require('./updater');
  ctx.updater = new Updater();
  if (ctx.updater.applyPendingAtStartup()) { app.exit(0); return; }

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (process.platform === 'win32') {
      app.setAppUserModelId('Bifrost.Browser');
      // (and Windows told who that is, or notifications don't show without a Start menu shortcut, as in
      // BifrostPortable: default-browser.js)
      setTimeout(() => require('./default-browser').registerAppId().catch((e) => console.warn('[notifications] not registered with Windows:', e.message)), 3000);
    }
    // Widevine (protected content): starts installing or checking now; windows open once it's there, or
    // after a few seconds at most.
    const drm = require('./drm');
    drm.init();
    // Chromium's own DNS resolver (as in Chrome) instead of the system's one-at-a-time lookups, with secure
    // DNS used automatically when your DNS provider supports it.
    try { app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'automatic' }); } catch (e) { console.warn('[dns]', e.message); }

    const db = require('./db').open(profile.dir);
    ctx.db = db;
    ctx.registry = require('./registry');
    const { SessionStore } = require('./session-store');
    ctx.sessionStore = new SessionStore(profile.dir);
    const { Sync } = require('./sync');
    ctx.sync = new Sync();
    try { ctx.sync.init(); } catch (e) { console.error('[sync] couldn’t start', e); }
    const { SearchService } = require('./search');
    ctx.search = new SearchService();
    ctx.search.init();
    ctx.downloads = require('./downloads');
    ctx.windows = require('./windows');
    require('./guests').init();
    require('./web-theme').init();

    // The browser UI runs in the default session; pages run in persist:main (or private sessions).
    protocol.attach(session.defaultSession);
    protocol.setWallpaperGetter(() => settings.get('appearance.newTab.image'));
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read'].includes(perm)));

    const { AdBlock } = require('./adblock');
    ctx.adblock = new AdBlock();
    ctx.adblock.init();
    const { Safety } = require('./safety');
    ctx.safety = new Safety();
    ctx.safety.init();

    ctx.mainSession = session.fromPartition('persist:main');
    const sessions = require('./sessions');
    ctx.setupBrowsingSession = (ses, opts) => sessions.setup(ses, opts);

    const { Extensions } = require('./extensions');
    ctx.extensions = new Extensions();
    sessions.setup(ctx.mainSession, { isPrivate: false });
    const extReady = ctx.extensions.init(ctx.mainSession);

    require('./api').register();
    ctx.updater.init();
    // Automated tests reach the main process's state through this (never set in normal use).
    if (process.env.BIFROST_TEST === '1') { global.__bifrost = ctx; global.__require = require; }

    const urls = urlsFromArgv(process.argv);
    // (Automated tests run offline: they don't wait, unless they ask to.)
    await drm.waitBriefly(process.env.BIFROST_TEST === '1' ? Number(process.env.BIFROST_DRM_WAIT_MS || 0) : 4000);
    restoreOrOpen(urls);
    await extReady;

    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) ctx.windows.create(); });
  }).catch((e) => {
    console.error('[startup]', e);
    require('electron').dialog.showErrorBox('Bifrost couldn’t start', String(e && e.stack || e));
    app.quit();
  });

  require('./certs').init();
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let exitCleared = false;
  app.on('before-quit', (e) => {
    ctx.quitting = true;
    try { ctx.sessionStore && ctx.sessionStore.writeNow(); } catch { /* ignore */ }
    try { ctx.settings && ctx.settings.saveNow(); } catch { /* ignore */ }
    try { ctx.sync && ctx.sync.flushSync(); } catch { /* ignore */ }
    const clearData = require('./clear-data');
    const pending = ctx.db && clearData.pendingOnExit();
    if (pending && !exitCleared) {
      e.preventDefault();
      exitCleared = true;
      clearData.clear(pending, 0, { local: true }).catch((err) => console.error('[clear on exit]', err)).finally(() => app.quit());
    }
  });
  app.on('will-quit', () => {
    try { ctx.db && ctx.db.close(); } catch { /* ignore */ }
  });
  app.on('web-contents-created', (e, wc) => {
    // window.open popups get the same rules as tabs.
    if (wc.getType() === 'window') {
      wc.once('did-start-navigation', () => {
        const opener = wc.opener;
        if (opener) require('./guests').setupPopup(wc);
      });
    }
  });
}

function restoreOrOpen(urls) {
  // After "Restart to update", the tabs come back whatever the startup setting says.
  const once = path.join(profile.dir, 'restore-once');
  const forced = require('node:fs').existsSync(once);
  if (forced) { try { require('node:fs').rmSync(once, { force: true }); } catch { /* best effort */ } }
  const mode = forced ? 'last' : settings.get('tabs.restoreOnStartup');
  const saved = ctx.sessionStore.windowsToRestore();
  if (mode === 'last' && saved.length) {
    saved.forEach((w, i) => {
      ctx.windows.create({ key: w.key, restoreState: w.ui, bounds: w.bounds, maximized: w.maximized, urls: i === saved.length - 1 ? urls : [] });
    });
    return;
  }
  ctx.sessionStore.clear();
  const start = mode === 'urls' ? (settings.get('tabs.startupUrls') || []).filter(Boolean) : [];
  ctx.windows.create({ urls: start.concat(urls) });
}
