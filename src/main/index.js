'use strict';
// Bifrost browser — main process entry.
const { app, session, BrowserWindow, Menu, nativeTheme } = require('electron');
const timing = require('./timing');
timing.mark('main');
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
// This process's code (Bifrost's main process, a few megabytes of it with the ad blocker's engine and the
// extensions' support) compiled once and kept in the profile: later starts read it back instead of compiling it
// again. Node keeps it current (a file that changed is compiled again) and writes it as Bifrost quits.
try { require('node:module').enableCompileCache(path.join(profile.dir, 'Code Cache', 'main')); } catch { /* not this Node */ }
protocol.registerSchemes();

// Settings that must be applied before ready.
const settingsMod = require('./settings');
const settings = settingsMod.open(profile.dir);
ctx.settings = settings;
timing.mark('settings');
if (!settings.get('advanced.hardwareAcceleration')) app.disableHardwareAcceleration();
if (!settings.get('advanced.smoothScrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling');
if (process.platform === 'linux' && settings.get('advanced.waylandNative')) app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,BackForwardCache');
// The performance profile's startup switches (renderer process limit, background throttling).
require('./perf').applyStartupSwitches(settings);
// Keep background tabs' timers alive enough for media/notifications; sleeping tabs handle memory.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// One instance per profile: later launches (links from other apps, files opened with Bifrost) open in the
// running browser. A later start sends what it was asked to open, as it read it (main/open-args.js).
const openArgs = require('./open-args');
const launchUrls = openArgs.fromArgv(process.argv);
openArgs.note({ start: true, argv: process.argv.slice(1), opening: launchUrls });
if (!app.requestSingleInstanceLock({ profile: profile.dir, open: launchUrls })) {
  app.quit();
} else {
  app.on('second-instance', (e, argv, workingDirectory, data) => {
    const read = openArgs.fromArgv(argv, { cwd: workingDirectory });
    const urls = openArgs.merge(read, openArgs.fromData(data));
    openArgs.note({ laterStart: true, argv: argv.slice(1), cwd: workingDirectory, read, sent: data && data.open, opening: urls });
    if (!urls.length && !process.defaultApp && argv.slice(1).some((a) => !String(a).startsWith('-'))) console.warn('[open] nothing to open in ' + JSON.stringify(argv.slice(1)) + ' (sent: ' + JSON.stringify(data && data.open) + ')');
    const windows = require('./windows');
    if (argv.includes('--new-window') || !ctx.registry.lastFocused({ private: false })) windows.create({ urls });
    else if (argv.includes('--private')) windows.create({ urls, isPrivate: true });
    else windows.openUrls(urls.length ? urls : []);
    const last = ctx.registry.lastFocused();
    if (last) { if (last.win.isMinimized()) last.win.restore(); last.win.focus(); }
  });
  start();
}

function start() {
  // An update downloaded last time goes in first (its helper starts Bifrost again once it's in).
  const { Updater } = require('./updater');
  ctx.updater = new Updater();
  if (ctx.updater.applyPendingAtStartup()) { app.exit(0); return; }

  app.whenReady().then(async () => {
    timing.mark('ready');
    Menu.setApplicationMenu(null);
    if (process.platform === 'win32') {
      app.setAppUserModelId('Bifrost.Browser');
      // (and Windows told who that is, or notifications don't show without a Start menu shortcut, as in
      // BifrostPortable: default-browser.js)
      setTimeout(() => require('./default-browser').registerAppId().catch((e) => console.warn('[notifications] not registered with Windows:', e.message)), 3000);
    }
    // Widevine (protected content): starts installing or checking now; tabs start once it's there, or after
    // a few seconds at most.
    const drm = require('./drm');
    drm.init();
    // Chromium's own DNS resolver (as in Chrome) instead of the system's one-at-a-time lookups, with secure
    // DNS used automatically when your DNS provider supports it.
    try { app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'automatic' }); } catch (e) { console.warn('[dns]', e.message); }

    // What a window needs to open: where it was and its tabs (the database, the saved session), Bifrost's own
    // pages (bifrost://), and the answers its UI asks for (api.js; its parts are made here and started below).
    const db = require('./db').open(profile.dir);
    ctx.db = db;
    timing.mark('db');
    ctx.registry = require('./registry');
    const { SessionStore } = require('./session-store');
    ctx.sessionStore = new SessionStore(profile.dir);
    const { Sync } = require('./sync');
    ctx.sync = new Sync();
    const { SearchService } = require('./search');
    ctx.search = new SearchService();
    ctx.downloads = require('./downloads');
    ctx.windows = require('./windows');
    const guests = require('./guests');
    const { WebStyles } = require('./web-styles');
    ctx.webStyles = new WebStyles();
    const { AdBlock } = require('./adblock');
    ctx.adblock = new AdBlock();
    const { YouTubeRules } = require('./youtube-rules');
    ctx.youtubeRules = new YouTubeRules();
    const { Safety } = require('./safety');
    ctx.safety = new Safety();
    const { GoogleAccounts } = require('./google-accounts');
    ctx.googleAccounts = new GoogleAccounts();
    const { Extensions } = require('./extensions');
    ctx.extensions = new Extensions();
    const sessions = require('./sessions');
    ctx.setupBrowsingSession = (ses, opts) => sessions.setup(ses, opts);
    // The VPN (main/vpn.js): on before any page asks for anything, if it was on.
    const { Vpn } = require('./vpn');
    ctx.vpn = new Vpn();
    try { ctx.vpn.init(); } catch (e) { console.error('[vpn] couldn’t start', e); }
    // The browser UI runs in the default session; pages run in persist:main (or private sessions).
    protocol.attach(session.defaultSession);
    protocol.setWallpaperGetter(() => settings.get('appearance.newTab.image'));
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read'].includes(perm)));
    ctx.mainSession = session.fromPartition('persist:main');
    require('./api').register();
    // Automated tests reach the main process's state through this (never set in normal use).
    if (process.env.BIFROST_TEST === '1') { global.__bifrost = ctx; global.__require = require; }
    timing.mark('made');

    // The window opens now, and its UI loads while the rest of Bifrost starts (a step at a time, so the
    // window's own files are served in between). The UI waits for the parts it asks about to be started
    // (ctx.ready: api.js 'ui:init'), and can be used from then; its web pages wait for the rest
    // (ctx.started: 'ui:started', ui/js/views.js): a page's requests go through the ad blocker from the very
    // first one, and protected video needs Widevine there before its page starts.
    let ready, started;
    ctx.ready = new Promise((resolve) => { ready = resolve; });
    ctx.started = new Promise((resolve) => { started = resolve; });
    restoreOrOpen(launchUrls);
    timing.mark('window');
    const breathe = () => new Promise((resolve) => setImmediate(resolve));
    await breathe();

    try { ctx.sync.init(); } catch (e) { console.error('[sync] couldn’t start', e); }
    ctx.search.init();
    timing.mark('search');
    guests.init();
    // (how many fingers are on the touchpad, for swipes: Windows' precision touchpads)
    require('./touchpad').init(ctx);
    // Dark mode for websites and your userstyles (before the tabs' color schemes: they ask it).
    ctx.webStyles.init();
    require('./web-theme').init();
    timing.mark('web-styles');
    await breathe();

    ctx.adblock.init();
    // YouTube's ads, out of what it sends before its pages see it (by rules kept up to date: youtube-rules.js).
    ctx.youtubeRules.init();
    require('./youtube-ads').init();
    ctx.safety.init();
    timing.mark('blockers');
    await breathe();

    sessions.setup(ctx.mainSession, { isPrivate: false });
    await breathe();
    const extReady = ctx.extensions.init(ctx.mainSession);
    await breathe();
    ctx.updater.init();
    timing.mark('session');
    ready();
    // The ad blocker's lists, when they only have to be read back (built anew, which takes seconds, the
    // window doesn't wait: the first pages' ads show, as before).
    await ctx.adblock.whenRead();
    timing.mark('lists');
    // Widevine (protected content): there already unless this is the first start, or it's being updated.
    // (Automated tests run offline: they don't wait, unless they ask to.)
    const drmIn = await drm.waitBriefly(process.env.BIFROST_TEST === '1' ? Number(process.env.BIFROST_DRM_WAIT_MS || 0) : 4000);
    timing.mark(drmIn === 'installed' ? 'drm-installed' : 'drm');
    // (the VPN's proxy there before the first pages go through it)
    await ctx.vpn.whenListening(3000);
    // (automated tests: a start that takes this much longer, to look at the window meanwhile)
    if (process.env.BIFROST_TEST === '1' && process.env.BIFROST_START_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.BIFROST_START_HOLD_MS) || 0));
    timing.mark('started');
    ctx.isStarted = true;
    started();
    await extReady;
    timing.mark('extensions-ready');
    // (what's been compiled so far kept now, not only when Bifrost quits: a start that ends otherwise, an update's
    // restart, still finds it)
    setTimeout(() => { try { require('node:module').flushCompileCache(); } catch { /* not this Node */ } }, 10000).unref();

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
    try { ctx.webStyles && ctx.webStyles.saveNow(); } catch { /* ignore */ }
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
