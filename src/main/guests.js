'use strict';
// Setup for every page that runs in a tab (<webview> guests): new windows, keyboard shortcuts,
// context menus, history, per-site zoom and user agents, and navigation guards for internal pages.
const { app, webContents, BrowserWindow, clipboard, nativeImage, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ctx = require('./context');
const touchpad = require('./touchpad');
const protocol = require('./protocol');
const { compileShortcuts, findCommand, VIM_KEYS } = require('../shared/defaults');
const ua = require('./useragent');
const PRELOAD_TAB = require('node:path').join(__dirname, '..', 'preload', 'tab.js');

// Shortcuts the page never gets to see (like Chrome's reserved keys). Everything else is offered to the
// page first and only runs if the page didn't handle it (see preload/tab.js).
const RESERVED = new Set(['newTab', 'closeTab', 'reopenTab', 'nextTab', 'prevTab', 'tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'lastTab',
  'newWindow', 'newPrivateWindow', 'closeWindow', 'focusAddress', 'fullscreen', 'taskManager', 'nextWorkspace', 'prevWorkspace',
  'workspace1', 'workspace2', 'workspace3', 'workspace4', 'workspace5', 'workspace6', 'workspace7', 'workspace8', 'workspace9',
  'focusNextPane', 'focusPrevPane']);

// Ctrl+Tab's "quick press or held" choice (ui/js/tabswitch.js) needs to know when Ctrl, Alt or the
// Windows key go down and up, including while a page has focus.
const MODIFIERS = new Set(['Control', 'Alt', 'Meta']);
function forwardModifier(ctl, input) {
  if (!MODIFIERS.has(input.key) || input.isAutoRepeat || (input.type !== 'keyDown' && input.type !== 'keyUp')) return;
  ctl.send('modifier-key', { key: input.key, down: input.type === 'keyDown' });
}
const keyInfo = (input) => ({ key: input.key, mods: { control: !!input.control, alt: !!input.alt, meta: !!input.meta, shift: !!input.shift } });
// Ctrl+Tab with its list of tabs (tabs.ctrlTabMenu) stays on this page until Ctrl comes up, which it has to hear:
// Chromium ignores a page's key-ups until its next key-down once a shortcut was taken from it, so a repeat
// key-down of the keys still held (what holding a key sends anyway) goes in right after (the UI does the same,
// a moment later, for a tab Ctrl+Tab moved to: 'tab:held-keys').
function stillHeld(guest, input) {
  const mods = ['control', 'alt', 'meta'].filter((m) => input[m]);
  if (!mods.length) return;
  setImmediate(() => {
    if (guest.isDestroyed()) return;
    for (const m of mods) guest.sendInputEvent({ type: 'keyDown', keyCode: { control: 'Control', alt: 'Alt', meta: 'Meta' }[m], modifiers: [...mods, 'isAutoRepeat'] });
  });
}

let compiledAll = [], compiledReserved = [];
function compile() {
  compiledAll = compileShortcuts(ctx.settings.get());
  compiledReserved = compiledAll.filter((c) => RESERVED.has(c.id));
}

const capturing = new Set();   // guests recording a shortcut (settings page): no browser shortcuts
const menuActions = new Map(); // context-menu id -> { items, guest }
let menuSeq = 0;

// Electron gives a <webview>'s page its window's visibility (document.hidden and visibilityState, which it
// pins on the page's document), whatever the <webview> itself is: every tab said "visible", the one in front
// or not. It does that with this message, on each page load and whenever the window is shown or hidden;
// here, each page gets its own: hidden when the window is, or when the page isn't on screen in it.
const VISIBILITY = 'GUEST_INSTANCE_VISIBILITY_CHANGE';
function watchVisibility(wc) {
  if (!wc || wc.__bfVis || typeof wc._sendInternal !== 'function') return;
  const send = wc._sendInternal;
  const v = { send, windowState: 'visible', told: 'visible' };
  wc.__bfVis = v;
  wc._sendInternal = function sendInternal(channel, ...args) {
    if (channel === VISIBILITY) {
      v.windowState = args[0] === 'hidden' ? 'hidden' : 'visible';
      v.told = visibilityOf(wc);
      args = [v.told];
    }
    return Reflect.apply(send, this, [channel, ...args]);
  };
  // (each new page starts out "visible", and Electron only says otherwise once the window has been hidden)
  wc.on('did-navigate', () => { v.told = 'visible'; retellVisibility(wc); });
}
function visibilityOf(wc) { return wc.__bfVis.windowState === 'hidden' || !pageShown(wc) ? 'hidden' : 'visible'; }
function retellVisibility(wc) {
  const v = wc.__bfVis;
  if (!v) return;
  const now = visibilityOf(wc);
  if (now === v.told) return;
  v.told = now;
  try { Reflect.apply(v.send, wc, [VISIBILITY, now]); } catch { /* gone */ }
}

// Whether a page is on screen, as its window last said (ui/js/views.js): one the window doesn't know of yet
// (it has just started loading) counts as shown until it says.
function pageShown(wc) {
  try {
    const win = wc.hostWebContents && BrowserWindow.fromWebContents(wc.hostWebContents);
    const ctl = win && ctx.registry.get(win.id);
    if (!ctl || !ctl.pagesKnown || !ctl.pagesKnown.has(wc.id)) return true;
    return ctl.pagesShown.has(wc.id);
  } catch { return true; }
}

function init() {
  compile();
  // Which of a window's pages are on screen, and each page told when that changes, so it sees what it
  // would in Chrome: hidden (watchVisibility above) and without the focus (preload/tab.js) behind another.
  require('./ipc').on('tabs:shown', 'ui', (event, d) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const ctl = win && ctx.registry.get(win.id);
    if (!ctl || !d) return;
    const ids = (a) => new Set((Array.isArray(a) ? a : []).filter(Number.isInteger));
    const known = ids(d.known), shown = ids(d.shown);
    const prevKnown = ctl.pagesKnown || new Set(), prevShown = ctl.pagesShown || new Set();
    // (what a page was told last: shown, unless the window had said otherwise)
    const told = (id) => !prevKnown.has(id) || prevShown.has(id);
    ctl.pagesKnown = known;
    ctl.pagesShown = shown;
    for (const id of known) {
      if (told(id) === shown.has(id)) continue;
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) continue;
      retellVisibility(wc);
      // (and the preload, for document.hasFocus() and the window's blur and focus)
      let frames = [];
      try { frames = wc.mainFrame.framesInSubtree; } catch { continue; }
      for (const f of frames) { try { f.send('tab-shown', shown.has(id)); } catch { /* frame gone */ } }
    }
  });
  ipcMain.on('tab:shown', (event) => { event.returnValue = pageShown(event.sender); });

  ctx.settings.on('changed', ({ path }) => {
    if (!path || path.startsWith('keyboard')) {
      compile();
      for (const wc of webContents.getAllWebContents()) {
        if (wc.getType() === 'webview' && !wc.isDestroyed()) wc.send('tab-config', tabConfig(wc.getURL()));
      }
    }
  });
  // A two-finger swipe in a tab (preload/tab.js): on to the window, which shows the arrow and goes back or
  // forward (ui/js/swipe.js) once the fingers lift (see swipeInput below).
  ipcMain.on('tab:swipe', (event, msg) => {
    const wc = event.sender;
    if (!msg || typeof msg !== 'object') return;
    // Swiping turned off, or what's left of the touchpad coasting after a swipe (on the page it went to, say):
    // the page stops following this one, and the rest of its gesture, straight away (until the coasting is
    // over: endCoast).
    const coastingNow = msg.phase === 'start' && coasting.get(wc.id);
    if (ctx.settings.get('gestures.swipe') === false || coastingNow) {
      if (msg.phase === 'start') { try { event.senderFrame.send('tab-swipe-done', { ignore: true }); } catch { /* gone */ } }
      if (coastingNow) coastingNow.frames.add(event.senderFrame);
      return;
    }
    let host = null;
    try { if (wc.getType() === 'webview') host = wc.hostWebContents; } catch { /* gone */ }
    if (!host || host.isDestroyed()) return;
    const phase = ['start', 'move', 'end'].includes(msg.phase) ? msg.phase : null;
    if (!phase) return;
    // (tracked: the touchpad says when the fingers lift; they're down, or lifted just before the page said)
    const f = touchpad.fingers;
    const late = f !== null && f < 2 && !touchpad.lifting && Date.now() - touchpad.liftedAt < LATE;
    if (phase === 'start') swipes.set(wc.id, { frame: event.senderFrame, lifted: false, tracked: f !== null && (f >= 2 || touchpad.lifting || late), ended: false });
    else if (phase === 'end') swipes.delete(wc.id);
    const steps = Array.isArray(msg.steps) ? msg.steps.slice(0, 64).map(Number).filter(Number.isFinite) : [];
    // (down: the touchpad says it's fingers on it, so no leftover coasting from the swipe before, however soon)
    host.send('swipe', { wcId: wc.id, phase, dir: Math.sign(Number(msg.dir) || 0), steps, down: phase === 'start' && f !== null && f >= 2 });
    // (after a moment: should the touchpad only now be saying fingers came down again, it's a new swipe instead)
    if (phase === 'start' && late) {
      const s = swipes.get(wc.id);
      setTimeout(() => { if (swipes.get(wc.id) === s && !wc.isDestroyed() && touchpad.fingers !== null && touchpad.fingers < 2) liftSwipe(wc); }, LATE_CHECK);
    }
  });
  // A link was pressed (or hovered) in a tab, or a launcher result highlighted: connect ahead.
  ipcMain.on('tab:preconnect', (event, url) => {
    try { if (event.sender.getType() === 'webview' && typeof url === 'string') require('./predictor').preconnect(event.sender.session, url, 1); } catch { /* ignore */ }
  });
  // The user agent this page should report (navigator.userAgent), asked by the tab preload before the
  // page's own scripts run, so it matches what its request sent (see useragent.headerHook).
  ipcMain.on('tab:ua', (event, url) => {
    let want = null;
    // Tabs, and popup windows sites open (sign-in windows); never the browser's own windows.
    try { const ty = event.sender.getType(); if (ty === 'webview' || (ty === 'window' && !protocol.isInternal(event.sender.getURL()))) want = ua.forUrl(String(url || '')); } catch { /* not a page */ }
    event.returnValue = want ? { ua: want, hints: !ua.noHints(want), safari: /Version\/[\d.]+ Safari/.test(want), firefox: /Firefox\//.test(want) } : null;
  });
  // alert(), confirm() and prompt() from a page (preload/tab.js): shown by the window the tab is in, which
  // answers when you do. The page waits meanwhile (it asked synchronously, as these functions are).
  ipcMain.on('tab:js-dialog', async (event, d) => {
    const type = d && ['alert', 'confirm', 'prompt'].includes(d.type) ? d.type : 'alert';
    const none = type === 'confirm' ? false : type === 'prompt' ? null : undefined;
    const reply = (v) => { try { event.returnValue = v; } catch { /* gone */ } };
    try {
      const guest = event.sender;
      const ctl = guest.getType() === 'webview' ? ownerOf(guest) : null;
      if (!ctl) return reply(none);
      const frame = event.senderFrame;
      const r = await ctl.request('js-dialog', {
        wcId: guest.id, type,
        message: String((d && d.message) || '').slice(0, 20000),
        value: String((d && d.value) || '').slice(0, 4000),
        url: (frame && frame.url) || guest.getURL(), top: !!(frame && !frame.parent),
      }, 7 * 24 * 3600e3);
      if (guest.isDestroyed()) return;
      reply(type === 'confirm' ? r === true : type === 'prompt' ? (typeof r === 'string' ? r : null) : undefined);
    } catch { reply(none); }
  });
  // Keyboard config for the tab preload: browser shortcuts the page may override, and Vim keys.
  ipcMain.handle('tab:config', (event) => {
    if (event.sender.getType() !== 'webview') return null;
    return tabConfig((event.senderFrame && event.senderFrame.url) || event.sender.getURL());
  });
  // Pop-ups a page opens by itself (not in answer to a click or a key) are blocked by the tab preload,
  // unless you've allowed them for that site.
  ipcMain.on('tab:popup-allowed', (event) => {
    let ok = false;
    try { const host = hostOf((event.senderFrame && event.senderFrame.url) || event.sender.getURL()); ok = !!(host && ctx.db.siteSettings(host).popups); } catch { ok = false; }
    event.returnValue = ok;
  });
  // …and ones it opens in answer to a click, to a site on the ad blocker's domain list: pop-up ads
  // (adblock.js isAdPopup), blocked the same way.
  ipcMain.on('tab:popup-ad', (event, url) => {
    let ad = false;
    try {
      let top = '';
      try { top = (event.senderFrame && event.senderFrame.top && event.senderFrame.top.url) || event.sender.getURL(); } catch { top = event.sender.getURL(); }
      ad = !!(ctx.adblock && ctx.adblock.isAdPopup(top, String(url || '')));
    } catch { ad = false; }
    event.returnValue = ad;
  });
  // Your own style for a site (the site's info popover → Add a style): the tab preload applies it like a
  // userstyle, to every frame from that site.
  ipcMain.handle('tab:site-css', (event, url) => {
    if (event.sender.getType() !== 'webview') return '';
    const host = hostOf((event.senderFrame && event.senderFrame.url) || url);
    return (host && ctx.db.siteSettings(host).css) || '';
  });
}

// A site's style changed: every frame showing that site gets it straight away (no reload).
function pushSiteCss(host) {
  const css = (host && ctx.db.siteSettings(host).css) || '';
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
    let frames = [];
    try { frames = wc.mainFrame.framesInSubtree; } catch { continue; }
    for (const f of frames) {
      const h = hostOf(f.url);
      if (h && (h === host)) { try { f.send('tab-site-css', css); } catch { /* frame gone */ } }
    }
  }
}

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

function tabConfig(url) {
  const vim = ctx.settings.get('keyboard.vim');
  const host = hostOf(url);
  let pass = null;
  for (const entry of vim.excludedSites || []) {
    const [h, ...keys] = String(entry).trim().split(/\s+/);
    if (!h || !host) continue;
    if (host === h || host.endsWith('.' + h)) { pass = keys.length ? keys : true; break; }
  }
  return {
    shortcuts: compiledAll.filter((c) => !RESERVED.has(c.id)).map((c) => ({ id: c.id, chord: c.chord })),
    vim: { enabled: vim.enabled, hintChars: vim.hintChars || 'asdfghjkl', scrollStep: vim.scrollStep, smoothScroll: vim.smoothScroll },
    keys: Object.assign({}, VIM_KEYS, vim.keys || {}),
    pass,
  };
}

function ownerOf(guest) {
  const host = guest.hostWebContents;
  if (!host) return null;
  const win = BrowserWindow.fromWebContents(host);
  return win ? ctx.registry.get(win.id) : null;
}

// Swipes in progress: guest webContents id -> { frame (the one the swipe is in), lifted, tracked, ended }. A page
// can't tell when the fingers leave the touchpad (it only sees the wheel), and nothing Chromium passes on says
// either: the scroll gesture's end (gestureScrollEnd) comes once the fingers have lifted and any coasting after a
// quick swipe is over too, a second or two later on Windows, and its wheel steps look the same for coasting and
// for fingers moving (one that doesn't move at all comes now and then while they do, too). Windows' precision
// touchpads say it themselves (touchpad.js): with one, a swipe goes the moment the fingers lift ('lift':
// ui/js/swipe.js), and the gesture's end means nothing while they're still down. Without one (or before it has
// said anything) a swipe waits for the gesture's end, as it always did.
const swipes = new Map();
// After a swipe let go: guest id -> its coasting ({ since, t }), steps still coming (onto the page it went to,
// say) until fingers touch the touchpad again, a moment goes by without any, or the gesture ends. A swipe that
// starts in it is what's left of that one.
const coasting = new Map();
const COAST_QUIET = 150;   // ms without a step: the coasting is over
const COAST_MAX = 4000;    // and over after this long in any case
const LATE = 500;          // a page that only says it's a swipe after the fingers lifted (a busy one): this long
const LATE_CHECK = 40;
// Tests move the fingers with Electron's own wheel events, each a little scroll gesture of its own, so they end
// the gesture themselves (global.__swipeManualRelease), and say what the touchpad would (global.__touchpad).
const manual = () => process.env.BIFROST_TEST === '1' && !!global.__swipeManualRelease;
function swipeInput(guest, input) {
  const id = guest.id, type = input.type;
  if (type === 'mouseWheel') { if (coasting.has(id)) coast(id); return; }
  // (touchpads whose coasting Chromium makes itself start it as the fingers lift: Linux, ChromeOS)
  if (type === 'gestureFlingStart') { const s = swipes.get(id); if (s && !s.lifted && !manual()) liftSwipe(guest); return; }
  if (type !== 'gestureScrollEnd' || manual()) return;
  endCoast(id);
  gestureEnded(guest);
}
// The gesture is over: so is the swipe, unless the touchpad says the fingers are still down (then it's over
// when they lift: it's only just seen them go, say, or the gesture turned into pinching).
function gestureEnded(guest) {
  const s = swipes.get(guest.id);
  if (!s) return;
  if (s.tracked && !s.lifted && touchpad.fingers >= 2) { s.ended = true; return; }
  releaseSwipe(guest);
}
function liftSwipe(guest) {
  const s = swipes.get(guest.id);
  if (!s || s.lifted) return;
  s.lifted = true;
  coast(guest.id, true);
  try { const host = guest.hostWebContents; if (host && !host.isDestroyed()) host.send('swipe', { wcId: guest.id, phase: 'lift' }); } catch { /* gone */ }
  if (s.ended) releaseSwipe(guest);
}
function eachSwipe(fn) {
  for (const [id, s] of [...swipes]) {
    const wc = webContents.fromId(id);
    if (wc && !wc.isDestroyed()) fn(wc, s);
  }
}
// The touchpad: fingers lifting let the swipe go; fingers touching it again end what's left of the coasting.
touchpad.on('lift', () => eachSwipe((wc, s) => { if (s.tracked && !s.lifted) liftSwipe(wc); }));
touchpad.on('down', () => { for (const id of [...coasting.keys()]) endCoast(id); });
// (it stopped saying: a swipe whose gesture is over doesn't wait for it)
touchpad.on('unknown', () => eachSwipe((wc, s) => { if (s.ended) releaseSwipe(wc); }));
function coast(id, fresh = false) {
  if (fresh) endCoast(id);
  let c = coasting.get(id);
  if (!c) { c = { since: Date.now(), t: null, frames: new Set() }; coasting.set(id, c); }
  clearTimeout(c.t);
  if (Date.now() - c.since > COAST_MAX) { endCoast(id); return; }
  c.t = setTimeout(() => { if (coasting.get(id) === c) endCoast(id); }, COAST_QUIET);
}
// The coasting is over: the frames that were told to ignore it (it looked like a swipe) hear that what comes
// next is a gesture of its own (fingers touching the touchpad again stop the coasting with no pause between).
function endCoast(id) {
  const c = coasting.get(id);
  if (!c) return;
  clearTimeout(c.t);
  coasting.delete(id);
  for (const f of c.frames) { try { if (!f.isDestroyed()) f.send('tab-swipe-done', { over: true }); } catch { /* gone */ } }
}
function releaseSwipe(guest) {
  const s = swipes.get(guest.id);
  swipes.delete(guest.id);
  try { if (s && s.frame && !s.frame.isDestroyed()) s.frame.send('tab-swipe-done'); } catch { /* frame gone */ }
  try { const host = guest.hostWebContents; if (host && !host.isDestroyed()) host.send('swipe', { wcId: guest.id, phase: 'release' }); } catch { /* gone */ }
}
if (process.env.BIFROST_TEST === '1') {
  // The fingers lifting (as the touchpad would say), and the gesture's end (gestureScrollEnd).
  global.__swipeLift = (id) => { const wc = webContents.fromId(id); if (wc && swipes.has(id)) liftSwipe(wc); return !!wc; };
  global.__swipeRelease = (id) => { const wc = webContents.fromId(id); endCoast(id); if (wc && swipes.has(id)) gestureEnded(wc); return !!wc; };
  global.__swipeCoasting = (id) => coasting.has(id);
  global.__swipeState = (id) => { const s = swipes.get(id); return s ? { lifted: s.lifted, tracked: s.tracked, ended: !!s.ended } : null; };
}

function setup(guest, ctl) {
  const isPrivate = ctl.isPrivate;
  guest.on('input-event', (e, input) => swipeInput(guest, input));
  guest.once('destroyed', () => { swipes.delete(guest.id); endCoast(guest.id); });
  guest.__wbWindow = ctl.id;
  let lastUrl = '';
  let typedUrl = null;
  let navStart = null;   // where the page being loaded was asked for (before any server redirects)

  if (!isPrivate && ctx.extensions) ctx.extensions.addTab(guest, ctl.win);

  guest.setWindowOpenHandler((details) => onWindowOpen(guest, details));
  require('./web-theme').attach(guest);

  // A page with unsaved changes asks before you leave it (a link, reload, back): left alone, Electron would
  // just cancel the navigation without a word. The question has to be answered right here, so it's the
  // system's own dialog. (Closing the tab asks with Bifrost's, see unloadCheck.)
  guest.on('will-prevent-unload', (e) => {
    if (process.env.BIFROST_TEST === '1' && global.__unloadAnswer) { if (global.__unloadAnswer(guest) === 'leave') e.preventDefault(); return; }
    let win = null;
    try { win = BrowserWindow.fromWebContents(guest.hostWebContents) || ctl.win; } catch { win = ctl.win; }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Leave', 'Stay'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Leave site?', message: 'Leave site?', detail: 'Changes you made may not be saved.',
    });
    if (choice === 0) e.preventDefault();
  });

  // Web content can't navigate itself (or its iframes) to internal pages.
  guest.on('will-navigate', (e) => {
    if (protocol.isInternal(e.url) && !protocol.isInternal(guest.getURL())) e.preventDefault();
  });
  guest.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && protocol.isInternal(e.url)) e.preventDefault();
  });
  // …nor get there through a server redirect (no server has a reason to send you to one).
  guest.on('will-redirect', (e) => {
    if (protocol.isInternal(e.url)) e.preventDefault();
  });

  // A page in full screen (a video, say): Esc always brings it back, like in Chrome, whatever the page
  // does with the key.
  let htmlFullscreen = false;
  guest.on('enter-html-full-screen', () => { htmlFullscreen = true; });
  guest.on('leave-html-full-screen', () => { htmlFullscreen = false; });
  guest.on('before-input-event', (e, input) => {
    forwardModifier(ctl, input);
    if (input.type === 'keyDown' && htmlFullscreen && input.key === 'Escape' && !input.isAutoRepeat) {
      e.preventDefault();
      guest.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false', true).catch(() => {});
      return;
    }
    if (input.type !== 'keyDown' || capturing.has(guest.id)) return;
    if (ctx.extensions && ctx.extensions.commands && ctx.extensions.commands.handleKey(input, ctl)) { e.preventDefault(); return; }
    const id = findCommand(compiledReserved, input);
    if (id) {
      e.preventDefault();
      ctl.send('command', id, { wcId: guest.id, ...keyInfo(input) });
      if ((id === 'nextTab' || id === 'prevTab') && ctx.settings.get('tabs.ctrlTabMenu')) stillHeld(guest, input);
    }
  });

  guest.on('context-menu', (e, params) => onContextMenu(guest, ctl, params));

  // History, title and favicon (never for private windows).
  const record = (url, transition) => {
    if (isPrivate || !/^https?:|^file:/i.test(url)) return;
    const typed = typedUrl && sameish(typedUrl, url);
    if (typed) typedUrl = null;
    ctx.db.addVisit({ url, title: guest.getTitle(), transition: typed ? 'typed' : transition, typed });
  };
  guest.on('did-start-navigation', (e) => {
    if (!e.isMainFrame || e.isSameDocument) return;
    navStart = e.url;
    ua.applyForUrl(guest, e.url);
  });
  guest.on('did-navigate', (e, url, code) => {
    // (a bookmark's address that sent you on: the launcher counts the visits where you ended up as using it)
    const start = navStart;
    navStart = null;
    if (start && !isPrivate && ctx.search && start !== url) { try { ctx.search.noteRedirect(start, url); } catch { /* not ready */ } }
    if (code && code >= 400 && code !== 404) { lastUrl = url; return; }
    record(url, 'link');
    lastUrl = url;
    applyZoom(guest, url);
    if (ctx.adblock) ctx.adblock.resetCount(guest.id);
  });
  guest.on('did-navigate-in-page', (e, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (url.split('#')[0] === lastUrl.split('#')[0]) { lastUrl = url; return; } // fragment-only change
    lastUrl = url;
    record(url, 'link');
  });
  guest.on('page-title-updated', (e, title) => { if (!isPrivate) ctx.db.setTitle(guest.getURL(), title); });
  guest.on('page-favicon-updated', (e, favicons) => { if (!isPrivate && favicons && favicons[0]) ctx.db.setFavicon(guest.getURL(), favicons[0]); });
  // Large icons for Speed Dial tiles (icons.js), looked for once a page has finished loading.
  if (!isPrivate) guest.on('did-stop-loading', () => { setTimeout(() => require('./icons').fromPage(guest).catch(() => {}), 400); });

  guest.on('zoom-changed', (e, dir) => {
    const z = guest.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5);
    setZoom(guest, Math.max(-7.6, Math.min(9, z)));
  });

  guest.on('destroyed', () => {
    capturing.delete(guest.id);
    if (ctx.adblock) ctx.adblock.forget(guest.id);
  });

  guest.__wbSetTyped = (url) => { typedUrl = url; };
}

function sameish(a, b) {
  const n = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return n(a) === n(b);
}

// ------------------------------------------------------------------ new windows
function onWindowOpen(guest, { url, disposition, features, frameName }) {
  const ctl = ownerOf(guest);
  if (protocol.isInternal(url) && !protocol.isInternal(guest.getURL())) return { action: 'deny' };
  if (/^(javascript|data):/i.test(url) && !/^data:(image|video|audio|application\/pdf)/i.test(url)) {
    if (/^javascript:/i.test(url)) return { action: 'deny' };
  }
  // Real popups (window.open with size features: sign-in flows, payment windows) stay windows so
  // window.opener keeps working. Everything else becomes a tab, and so does anything a page from a local
  // file opens (it mustn't reach into another local file through it: file-guard.js).
  const fromFile = /^file:/i.test(guest.getURL());
  const wantsPopup = disposition === 'new-window' && /(width|height|left|top|popup)/i.test(features || '');
  const isPopup = wantsPopup && !fromFile;
  if (isPopup) {
    const size = {};
    for (const part of String(features).split(',')) {
      const [k, v] = part.split('=').map((s) => s && s.trim().toLowerCase());
      if (['width', 'height', 'left', 'top'].includes(k) && /^\d+$/.test(v || '')) size[k === 'left' ? 'x' : k === 'top' ? 'y' : k] = Math.max(k === 'width' || k === 'height' ? 200 : 0, Number(v));
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: Object.assign({
        width: 520, height: 680, autoHideMenuBar: true, show: true,
        backgroundColor: '#ffffff',
        // The tab preload, for the user agent sign-in pages need (see 'tab:ua').
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, preload: PRELOAD_TAB },
      }, size),
      outlivesOpener: false,
    };
  }
  if (ctl) {
    // foreground-tab: target=_blank or Ctrl+Shift+click · background-tab: Ctrl/middle click · new-window: Shift+click
    // (Settings → Tabs → Switch to links you open in a new tab turns the clicks round: the UI, openFromMain)
    ctl.send('open-url', { url, background: disposition === 'background-tab', foreground: disposition === 'foreground-tab', newWindow: disposition === 'new-window' && !wantsPopup, openerWcId: guest.id });
  }
  return { action: 'deny' };
}

// An extension's side panel, or a website in it: its links open as tabs, browser and extension shortcuts keep
// working, and it gets the page context menu (Inspect included, for extension developers). A website's
// sign-in windows stay windows (as they do from a tab), and it gets a tab's user agent.
function setupPanel(guest, ctl, panel) {
  guest.__wbPanel = panel.id;
  if (panel.web) {
    guest.setWindowOpenHandler((details) => onWindowOpen(guest, details));
    guest.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) ua.applyForUrl(guest, e.url); });
    guest.on('will-frame-navigate', (e) => { if (!e.isMainFrame && protocol.isInternal(e.url)) e.preventDefault(); });
    ua.applyForUrl(guest, panel.url);
  } else {
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if (/^(https?|ftp|chrome-extension):/i.test(url)) ctl.send('open-url', { url, background: disposition === 'background-tab', newWindow: disposition === 'new-window' });
      return { action: 'deny' };
    });
  }
  guest.on('will-navigate', (e) => { if (protocol.isInternal(e.url)) e.preventDefault(); });
  guest.on('before-input-event', (e, input) => {
    forwardModifier(ctl, input);
    if (input.type !== 'keyDown') return;
    if (ctx.extensions && ctx.extensions.commands && ctx.extensions.commands.handleKey(input, ctl)) { e.preventDefault(); return; }
    const id = findCommand(compiledReserved, input);
    if (id) {
      e.preventDefault();
      ctl.send('command', id, keyInfo(input));
      if ((id === 'nextTab' || id === 'prevTab') && ctx.settings.get('tabs.ctrlTabMenu')) stillHeld(guest, input);
    }
  });
  guest.on('context-menu', (e, params) => onContextMenu(guest, ctl, params));
}

// Popup windows created by window.open get the same protections.
function setupPopup(child) {
  child.setWindowOpenHandler((details) => {
    const ctl = ctx.registry.lastFocused();
    if (protocol.isInternal(details.url)) return { action: 'deny' };
    if (details.disposition === 'new-window' && /(width|height)/i.test(details.features || '')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, preload: PRELOAD_TAB } } };
    }
    if (ctl) ctl.send('open-url', { url: details.url, background: false });
    return { action: 'deny' };
  });
  child.on('will-navigate', (e) => { if (protocol.isInternal(e.url)) e.preventDefault(); });
  child.on('will-redirect', (e) => { if (protocol.isInternal(e.url)) e.preventDefault(); });
  child.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) ua.applyForUrl(child, e.url); });
  showSiteInTitle(child);
}

// Windows without an address bar (popups, sign-in windows) say in their title bar which site they're on.
function showSiteInTitle(wc) {
  const update = () => {
    const win = BrowserWindow.fromWebContents(wc);
    if (!win || win.isDestroyed() || wc.isDestroyed()) return;
    let site = '';
    try {
      const u = new URL(wc.getURL());
      site = u.protocol === 'https:' ? u.host : u.protocol === 'http:' ? `Not secure · ${u.host}` : '';
    } catch { /* about:blank and the like */ }
    const title = wc.getTitle();
    const own = title && title !== wc.getURL() && !(site && title.startsWith(site)) ? title : '';
    win.setTitle(site ? (own ? `${site} — ${own}` : site) : own || 'Bifrost');
  };
  wc.on('page-title-updated', (e) => { e.preventDefault(); update(); });
  wc.on('did-navigate', update);
  wc.on('did-navigate-in-page', update);
  update();
}

// ------------------------------------------------------------------ zoom per site
function siteKey(url) { try { const u = new URL(url); return u.protocol === 'bifrost:' ? 'bifrost:' + u.hostname : u.hostname; } catch { return ''; } }

function applyZoom(guest, url) {
  const host = siteKey(url);
  if (!host) return;
  const s = ctx.db.siteSettings(host);
  const level = typeof s.zoom === 'number' ? s.zoom : 0;
  if (guest.getZoomLevel() !== level) guest.setZoomLevel(level);
}

function setZoom(guest, level) {
  guest.setZoomLevel(level);
  const host = siteKey(guest.getURL());
  if (host) ctx.db.setSiteSetting(host, 'zoom', Math.abs(level) < 0.01 ? null : level);
  const ctl = ownerOf(guest);
  if (ctl) ctl.send('zoom-changed', { wcId: guest.id, level, factor: Math.pow(1.2, level) });
}

// ------------------------------------------------------------------ context menus
function onContextMenu(guest, ctl, params) {
  let extItems = [];
  if (ctx.extensions && !ctl.isPrivate) {
    try { extItems = ctx.extensions.getContextMenuItems(guest, params) || []; } catch (e) { extItems = []; }
  }
  const id = ++menuSeq;
  const flat = [];
  const serialize = (items) => items.map((it) => {
    const idx = flat.push(it) - 1;
    return { id: idx, label: it.label, type: it.type, enabled: it.enabled !== false, checked: !!it.checked, icon: null, submenu: it.submenu ? serialize(it.submenu.items || it.submenu) : null };
  });
  const ext = serialize(extItems);
  menuActions.set(id, { items: flat, guest });
  if (menuActions.size > 20) menuActions.delete(menuActions.keys().next().value);
  const p = params;
  // Where the pointer is in the window (Chromium's own x and y for the click are relative to the whole
  // window in some versions and to the page in others: the window uses this to tell, see contextmenu.js).
  let cx = null, cy = null;
  try {
    const c = require('electron').screen.getCursorScreenPoint(), b = ctl.win.getContentBounds();
    cx = c.x - b.x; cy = c.y - b.y;
  } catch { /* no pointer */ }
  ctl.send('context-menu', {
    menuId: id, wcId: guest.id, x: p.x, y: p.y, cx, cy, source: p.menuSourceType || '',
    pageURL: p.pageURL, frameURL: p.frameURL, linkURL: p.linkURL, linkText: p.linkText, srcURL: p.srcURL,
    mediaType: p.mediaType, hasImageContents: p.hasImageContents, isEditable: p.isEditable, selectionText: p.selectionText,
    titleText: p.titleText, misspelledWord: p.misspelledWord, dictionarySuggestions: p.dictionarySuggestions,
    editFlags: p.editFlags, mediaFlags: p.mediaFlags, inputFieldType: p.inputFieldType, spellcheckEnabled: p.spellcheckEnabled,
    canGoBack: guest.navigationHistory.canGoBack(), canGoForward: guest.navigationHistory.canGoForward(),
    isInternal: protocol.isInternal(p.pageURL),
    extensions: ext,
  });
}

function runExtensionMenuItem(menuId, index) {
  const m = menuActions.get(menuId);
  if (!m) return;
  const item = m.items[index];
  if (item && typeof item.click === 'function') item.click(item, null, {});
}

// Actions the UI can't do through the <webview> element itself.
// Whether the page would ask "Leave site?" if it were closed now (it has unsaved changes): its beforeunload
// handlers are run the way Chromium runs them, from a world of Bifrost's own, and, as in Chrome, only a page
// you've interacted with gets to ask. A page that doesn't answer in time is closed anyway.
const UNLOAD_PROBE = `(() => {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
    const ev = document.createEvent('BeforeUnloadEvent');
    ev.initEvent('beforeunload', false, true);
    window.dispatchEvent(ev);
    return !!(ev.defaultPrevented || ev.returnValue);
  } catch (e) { return false; }
})()`;
function unloadCheck(guest) {
  if (guest.isCrashed()) return Promise.resolve(false);
  return Promise.race([
    guest.executeJavaScriptInIsolatedWorld(1013, [{ code: UNLOAD_PROBE }]).then((v) => !!v, () => false),
    new Promise((r) => setTimeout(() => r(false), 900)),
  ]);
}

function guestAction(wcId, action, args = {}) {
  const guest = webContents.fromId(wcId);
  if (!guest || guest.isDestroyed() || guest.getType() !== 'webview') throw new Error('no such tab');
  switch (action) {
    case 'unloadCheck': return unloadCheck(guest);
    case 'copyImageAt': guest.copyImageAt(args.x, args.y); return true;
    case 'inspect': guest.inspectElement(args.x, args.y); return true;
    case 'replaceMisspelling': guest.replaceMisspelling(String(args.word || '')); return true;
    case 'addToDictionary': guest.session.addWordToSpellCheckerDictionary(String(args.word || '')); return true;
    case 'setZoom': setZoom(guest, Number(args.level) || 0); return guest.getZoomLevel();
    case 'zoomBy': setZoom(guest, Math.max(-7.6, Math.min(9, guest.getZoomLevel() + Number(args.delta || 0)))); return guest.getZoomLevel();
    case 'getZoom': return guest.getZoomLevel();
    case 'typed': if (guest.__wbSetTyped) guest.__wbSetTyped(String(args.url || '')); return true;
    case 'savePage': return savePage(guest);
    case 'download': guest.downloadURL(String(args.url)); return true;
    case 'copyText': clipboard.writeText(String(args.text || '')); return true;
    case 'pip': return guest.executeJavaScript(PIP_JS, true);
    case 'navigationEntries': {
      const h = guest.navigationHistory;
      return { index: h.getActiveIndex(), entries: h.getAllEntries().map((e) => ({ url: e.url, title: e.title })), zoom: guest.getZoomLevel() };
    }
    case 'goToIndex': guest.navigationHistory.goToIndex(Number(args.index)); return true;
    case 'restoreHistory': {
      const entries = (args.entries || []).filter((e) => e && typeof e.url === 'string' && !/^javascript:/i.test(e.url)).slice(-50);
      if (!entries.length) return false;
      const want = Number(args.index);
      const index = Math.max(0, Math.min(entries.length - 1, Number.isFinite(want) ? want : entries.length - 1));
      return guest.navigationHistory.restore({ entries: entries.map((e) => ({ url: e.url, title: e.title || '' })), index }).then(() => true, () => false);
    }
    case 'captureThumb': return guest.capturePage().then((img) => (img.isEmpty() ? null : img.resize({ width: Math.min(360, img.getSize().width) }).toDataURL()));
    case 'pageLook': return pageLook(guest, args);
    case 'memory': return guest.getOSProcessId();
    case 'captureKeyboard': if (args.on) capturing.add(guest.id); else capturing.delete(guest.id); return true;
    case 'isAudible': return guest.isCurrentlyAudible();
    case 'openExternal': if (/^(mailto|tel|https?):/i.test(args.url || '')) shell.openExternal(args.url); return true;
    case 'screenshot': return screenshot(guest, args);
    case 'readerSnapshot': return readerSnapshot(guest);
    default: throw new Error('unknown action ' + action);
  }
}

const PIP_JS = `(() => {
  const vids = [...document.querySelectorAll('video')].filter(v => v.readyState > 0);
  const v = vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight) + (b.paused ? 0 : 1e9) - (a.paused ? 0 : 1e9))[0];
  if (!v) return 'no-video';
  if (document.pictureInPictureElement) { document.exitPictureInPicture(); return 'exited'; }
  return v.requestPictureInPicture().then(() => 'entered', (e) => 'error: ' + e.message);
})()`;

async function savePage(guest) {
  const { dialog } = require('electron');
  const win = BrowserWindow.fromWebContents(guest.hostWebContents);
  const title = (guest.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'page';
  const r = await dialog.showSaveDialog(win, {
    defaultPath: require('node:path').join(ctx.downloads ? ctx.downloads.folder() : require('electron').app.getPath('downloads'), title + '.html'),
    filters: [{ name: 'Web page, complete', extensions: ['html'] }, { name: 'Web page, single file (MHTML)', extensions: ['mhtml'] }],
  });
  if (r.canceled || !r.filePath) return false;
  await guest.savePage(r.filePath, r.filePath.toLowerCase().endsWith('.mhtml') ? 'MHTML' : 'HTMLComplete');
  return true;
}

// ------------------------------------------------------------------ screenshots
function screenshotDir() {
  let base;
  try { base = app.getPath('pictures'); } catch { base = app.getPath('downloads'); }
  return path.join(base, 'Bifrost Screenshots');
}

async function fullPageCapture(guest) {
  const dbg = guest.debugger;
  let attached = false;
  if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const width = Math.max(1, Math.min(Math.ceil(size.width), 10000));
    const height = Math.max(1, Math.min(Math.ceil(size.height), 16000));
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
  } finally {
    if (attached) { try { dbg.detach(); } catch { /* already detached */ } }
  }
}

// What the page looks like right now, for "Match the page" and "Blur the page" (ui/js/ambient.js): the
// colors along its edges (the one most of each edge shares), the average color of its left part (what a
// blurred copy shows behind the sidebar), and with `thumb`, a small picture of it to blur.
async function pageLook(guest, { thumb = false } = {}) {
  const img = await guest.capturePage();
  if (!img || img.isEmpty()) return null;
  const small = img.resize({ width: 120, quality: 'good' });
  const { width: w, height: h } = small.getSize();
  if (w < 8 || h < 8) return null;
  const px = small.toBitmap();   // BGRA
  const rgb = (x, y) => { const i = (y * w + x) * 4; return [px[i + 2], px[i + 1], px[i]]; };
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  // The color most of these pixels share (to within a little), averaged over those pixels.
  const dominant = (pts) => {
    const groups = new Map();
    for (const c of pts) {
      const k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4);
      const g = groups.get(k) || { n: 0, s: [0, 0, 0] };
      g.n++; g.s[0] += c[0]; g.s[1] += c[1]; g.s[2] += c[2];
      groups.set(k, g);
    }
    const best = [...groups.values()].sort((a, b) => b.n - a.n)[0];
    return hex(best.s.map((v) => v / best.n));
  };
  const column = (x) => Array.from({ length: h - 2 }, (_, i) => rgb(x, i + 1));
  const row = (y) => Array.from({ length: w - 2 }, (_, i) => rgb(i + 1, y));
  const mean = (x0, x1, y0 = 0, y1 = h) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = rgb(x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; }
    return hex(s.map((v) => v / n));
  };
  const out = {
    left: dominant(column(0).concat(column(1))),
    // (in from the right: the page's scrollbar is there)
    right: dominant(column(w - 4).concat(column(w - 3))),
    top: dominant(row(0).concat(row(1))),
    ambient: { left: mean(0, Math.ceil(w * 0.3)), right: mean(Math.floor(w * 0.7), w), top: mean(0, w, 0, Math.ceil(h * 0.3)) },
  };
  // The picture behind the bars ("Blur the page"): small enough (a pixel per 30-70 px of page) that rows
  // of text and icons along the page's edge average out to their colors. At the 120 px above, they showed
  // through the blur as grey smudges.
  const pic = thumb ? 'data:image/jpeg;base64,' + img.resize({ width: 32, quality: 'best' }).toJPEG(88).toString('base64') : null;
  return { edges: out, thumb: pic };
}

async function screenshot(guest, { full = false } = {}) {
  let img = null;
  if (full) img = await fullPageCapture(guest).catch(() => null);
  if (!img || img.isEmpty()) img = await guest.capturePage();
  if (!img || img.isEmpty()) throw new Error('there was nothing to capture');
  clipboard.write({ image: img });
  const dir = screenshotDir();
  fs.mkdirSync(dir, { recursive: true });
  let host = 'page';
  try { host = new URL(guest.getURL()).hostname.replace(/^www\./, '') || 'page'; } catch { /* keep */ }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  const file = path.join(dir, `${host.replace(/[^\w.-]+/g, '_')} ${stamp}.png`);
  fs.writeFileSync(file, img.toPNG());
  return { file };
}

// ------------------------------------------------------------------ reader view
// The page's HTML is read in an isolated world (page scripts can't fake it) and handed to the reader page.
const readerStore = new Map(); // token -> { html, url, title, t }

async function readerSnapshot(guest) {
  const url = guest.getURL();
  if (!/^https?:/i.test(url)) throw new Error('not a web page');
  const res = await guest.executeJavaScriptInIsolatedWorld(1001, [{ code: 'document.documentElement ? document.documentElement.outerHTML : ""' }], true);
  const token = crypto.randomUUID();
  for (const [k, v] of readerStore) if (Date.now() - v.t > 30 * 60e3) readerStore.delete(k);
  readerStore.set(token, { html: String(res || '').slice(0, 8e6), url, title: guest.getTitle(), t: Date.now() });
  return token;
}

async function readerData(token, url) {
  const d = token && readerStore.get(token);
  if (d) return { html: d.html, url: d.url, title: d.title };
  if (!/^https?:/i.test(url)) throw new Error('no page to show');
  const r = await ctx.mainSession.fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { html: (await r.text()).slice(0, 8e6), url: r.url || url, title: '' };
}

// The browser shortcut (a reserved one: new tab, close tab, switch tab…) a key press is, if any, for
// other things that take the keyboard (extension popups); with what the window needs to run it.
function browserShortcut(input) {
  if (!input || input.type !== 'keyDown') return null;
  const id = findCommand(compiledReserved, input);
  return id ? { id, args: keyInfo(input) } : null;
}

module.exports = { init, setup, setupPanel, setupPopup, watchVisibility, showSiteInTitle, guestAction, runExtensionMenuItem, ownerOf, applyZoom, setZoom, RESERVED, tabConfig, screenshotDir, readerData, pushSiteCss, browserShortcut };
