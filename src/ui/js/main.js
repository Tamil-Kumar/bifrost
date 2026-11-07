// Bifrost browser UI — startup, events from the main process, keyboard shortcuts and layout glue.
import { S, on, emit, restore, normalize, activeTab, tabByWc, tabById, setTab, flushSave, syncSoon, saveSoon, setting, serialize } from './state.js';
import * as Theme from './theme.js';
import * as V from './views.js';
import * as T from './tabs.js';
import * as Strip from './tabstrip.js';
import * as WS from './workspaces.js';
import * as TB from './toolbar.js';
import * as Omni from './omnibox.js';
import * as Launcher from './launcher.js';
import * as Prompts from './prompts.js';
import * as Cmd from './commands.js';
import * as TabSwitch from './tabswitch.js';
import * as Flyouts from './flyouts.js';
import * as Ambient from './ambient.js';
import * as Swipe from './swipe.js';
import * as BM from './bookmarks.js';
import * as DL from './downloads.js';
import * as EXT from './extensions.js';
import * as Find from './findbar.js';
import * as Panels from './panels.js';
import * as Site from './siteinfo.js';
import * as AppMenu from './appmenu.js';
import { showPageMenu } from './contextmenu.js';
import { menuOpen } from './menus.js';
import { isEditable, isEditingChord, isInternal, h, setupRipples, hostOf } from './util.js';
import { icon } from './icons.js';

const wb = window.wb;
const root = document.documentElement;
let compiled = [];

function compileKeys() { compiled = window.WBDefaults.compileShortcuts(S.settings); }

// ------------------------------------------------------------ main process
function listen() {
  wb.on('command', (id, args) => Cmd.run(id, args || {}));
  wb.on('open-url', (o) => openFromMain(o || {}));
  wb.on('context-menu', (p) => showPageMenu(p));
  wb.on('zoom-changed', ({ wcId, level }) => { const t = tabByWc(wcId); if (t) setTab(t, { zoom: level }); });
  wb.on('window-focus', (f) => { S.focused = !!f; Theme.applyWindowState(); });
  wb.on('fullscreen', (f) => { S.fullscreen = !!f; Theme.applyWindowState(); });
  wb.on('maximized', (m) => { S.maximized = !!m; Theme.applyWindowState(); TB.refreshCaption(); });
  wb.on('adblock-count', ({ wcId, count }) => { const t = tabByWc(wcId); if (t) setTab(t, { blocked: count }); });
  wb.on('settings-changed', ({ path, settings }) => {
    S.settings = settings;
    if (!path || path.startsWith('keyboard')) compileKeys();
    emit('settings', path || '');
  });
  wb.on('bookmarks-changed', (e) => emit('bookmarks-changed', e));
  wb.on('system-theme', ({ dark }) => { S.systemDark = !!dark; Theme.applyTheme(); });
  // A page or a download on the dangerous-sites lists was stopped (main/safety.js): the tab shows why.
  wb.on('dangerous-site', function onDanger({ wcId, url, kind, list }, tries = 0) {
    const t = tabByWc(wcId);
    // (A tab whose page was just created may not know its page's id yet.)
    if (!t) { if (tries < 10) setTimeout(() => onDanger({ wcId, url, kind, list }, tries + 1), 100); return; }
    // The page the tab was opening: the warning, over it. Anything else (a link that downloads, say): say so.
    const started = t.navStarted && t.navStarted.url === url && Date.now() - t.navStarted.at < 15000;
    if (started || t.pendingUrl === url) V.showDanger(t, { url, kind, list });
    else Prompts.toast({ text: `Bifrost blocked ${hostOf(url) || 'a dangerous address'}: it’s on the ${list}`, iconName: 'warn', timeout: 8000 });
  });
  wb.on('dangerous-download', ({ url, filename, list }) => {
    Prompts.toast({ text: `Bifrost blocked a dangerous download: ${filename || hostOf(url)} (from ${hostOf(url)}, which is on the ${list})`, iconName: 'warn', timeout: 8000 });
  });
  wb.on('extension-tab-action', ({ wcId, action }) => {
    const t = tabByWc(wcId);
    if (!t) return;
    if (action === 'select') T.selectTab(t); else if (action === 'close') T.closeTab(t);
  });
  wb.on('select-tab', (tabId) => { const t = tabById(tabId); if (t) T.selectTab(t); });
  // A site asked for a permission (camera, notifications…) and got it or not (main/permissions.js): the
  // address bar's permissions button shows it.
  wb.on('perm-asked', ({ wcId, host, keys, allowed, asked }) => {
    const t = tabByWc(wcId);
    if (!t || !Array.isArray(keys)) return;
    const prev = t.permAsks && t.permAsks.host === host ? t.permAsks.list.filter((x) => !keys.includes(x.key)) : [];
    setTab(t, { permAsks: { host, list: prev.concat(keys.map((key) => ({ key, allowed: !!allowed, asked: !!asked }))) } });
  });
  // One of a site's notifications was clicked: its tab, in front.
  wb.on('focus-wc', (wcId) => { const t = tabByWc(wcId); if (t) T.selectTab(t); else Panels.showByWc(wcId); });
  wb.on('adopt-tab', (data) => T.adopt(data));
  wb.on('extension-activate-action', ({ id }) => EXT.activateById(id));
  wb.on('extension-side-panel', (o) => Panels.extensionPanel(o || {}));
  wb.on('extension-side-panels-changed', () => Panels.refreshExtensionPanels());
  wb.on('toast', (o) => emit('toast', o || {}));
  wb.on('ui-request', async ({ id, method, args }) => {
    try {
      const result = await handleRequest(method, args || {});
      wb.send('ui:response', { id, result });
    } catch (e) {
      wb.send('ui:response', { id, error: String((e && e.message) || e) });
    }
  });
}

function openFromMain({ url, background, foreground, newWindow, openerWcId, split }) {
  if (!url) return;
  const opener = tabByWc(openerWcId);
  if (newWindow) T.openUrl(url, { where: 'window' });
  else if (split) { if (opener) T.selectTab(opener, { focus: false }); T.openUrl(url, { where: 'split' }); }
  else T.openTab({ url, active: linkInFront(!background, foreground, opener), opener });
}

// A link a page opens in a new tab: Ctrl+click and middle-click put it behind, and with Shift as well in front
// (as Chromium has it); with Settings → Tabs → "Switch to links you open in a new tab", the other way round
// (as Firefox has it). A link that opens a tab by itself (target=_blank, a plain click) always comes to the
// front: told apart from Ctrl+Shift+click by Shift, held in the press that opened it (preload/tab.js).
function linkInFront(active, foreground, opener) {
  if (!setting('tabs.switchToNewTabs')) return active;
  if (!active) return true;
  const p = opener && opener.lastPointer;
  if (foreground && p && p.shift && performance.now() - p.at < 4000) return false;
  return active;
}

async function handleRequest(method, args) {
  switch (method) {
    // The window is about to be rebuilt (main/windows.js rebuild): everything it has, to restore.
    case 'session-state': return serialize();
    case 'extension-create-tab': {
      const t = T.openTab({ url: args.url || T.newTabUrl(), active: args.active !== false, index: args.index, pinned: !!args.pinned, position: 'end' });
      const wcId = await V.waitForWc(t);
      return { wcId };
    }
    case 'extension-tab-op': {
      const t = tabByWc(args.wcId);
      if (!t) throw new Error(`No tab with id: ${args.wcId}.`);
      switch (args.op) {
        case 'pin': if (!!t.pinned !== !!args.pinned) T.togglePin(t); return { ok: true };
        case 'select': T.selectTab(t); return { ok: true };
        case 'move': T.moveToIndex(t, Number.isInteger(args.index) ? args.index : -1); return { ok: true };
        case 'move-window': await T.moveTabToWindow(t, args.windowId); return { ok: true };
        case 'duplicate': { const d = T.duplicateTab(t); return { wcId: await V.waitForWc(d) }; }
        case 'discard': await T.sleep(t); return { ok: !t.wv };
        default: throw new Error('unknown tab operation ' + args.op);
      }
    }
    case 'permission-prompt': return Prompts.permissionPrompt(args);
    case 'screen-picker': return Prompts.screenPicker(args);
    case 'js-dialog': return Prompts.jsDialog(args);
    case 'unload-dirty': return T.dirtyCount();
    case 'extension-install-prompt': return Prompts.extensionInstallPrompt(args);
    case 'extension-permission-prompt': return Prompts.extensionPermissionPrompt(args);
    default: throw new Error('unknown request ' + method);
  }
}

// Messages from the tab preload (browser shortcuts the page didn't use, Vim actions).
function onGuestMessage(tab, channel, args) {
  if (channel === 'wb-command') {
    const id = String(args[0] || '');
    if (tab !== activeTab()) T.selectTab(tab, { focus: false });
    Cmd.run(id, { wcId: tab.wcId, source: 'page' });
  } else if (channel === 'wb-open') {
    const o = args[0] || {};
    const url = String(o.url || '');
    const ok = /^(https?|ftp):/i.test(url) || (isInternal(url) && isInternal(tab.url));
    if (!ok) { if (/^mailto:/i.test(url)) V.guest(tab, 'openExternal', { url }); return; }
    if (o.split) { T.selectTab(tab, { focus: false }); T.openUrl(url, { where: 'split' }); }
    else T.openTab({ url, active: !o.background, opener: tab });
  } else if (channel === 'wb-copy') {
    V.guest(tab, 'copyText', { text: String(args[0] || '') }).catch(() => {});
  } else if (channel === 'wb-pointer') {
    const o = args[0] || {};
    tab.lastPointer = { shift: !!o.shift, button: Number(o.button) || 0, at: performance.now() };
    emit('page-pointer', tab);
  } else if (channel === 'wb-popup-blocked') {
    popupBlocked(tab, String(args[0] || ''), String(args[1] || tab.url || ''));
  } else if (channel === 'wb-page-color') {
    // The page's colors at its edges (preload/tab.js), for "Match the page" (theme.js).
    const c = args[0] || {};
    const ok = (v) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : '');
    const pc = { left: ok(c.left), right: ok(c.right), top: ok(c.top) };
    const was = tab.pageColor || {};
    if (pc.left !== was.left || pc.right !== was.right || pc.top !== was.top) { tab.pageColor = pc; emit('page-look', tab); }
  }
}

// A page tried to open a pop-up by itself: say so (once per page and a few seconds), with a way to open it
// anyway or to allow pop-ups on that site from now on.
const popupNotes = new Map();   // tab id -> { from, count, time }
function popupBlocked(tab, url, from) {
  if (!/^(https?|ftp):/i.test(url) && url !== '') return;
  const host = hostOf(from).replace(/^www\./, '');
  const prev = popupNotes.get(tab.id);
  const now = Date.now();
  if (prev && now - prev.time < 8000) { prev.count++; prev.time = now; return; }
  popupNotes.set(tab.id, { from, count: 1, time: now });
  emit('toast', {
    text: `Pop-up blocked${host ? ' on ' + host : ''}`, iconName: 'shield', timeout: 7000,
    actions: [
      url ? { label: 'Open it', action: () => T.openTab({ url, opener: tab }) } : null,
      host ? { label: 'Always allow here', action: () => wb.invoke('site:set', hostOf(from), 'popups', true).then(() => emit('toast', { text: `Pop-ups allowed on ${host}`, iconName: 'shield', timeout: 2500 })) } : null,
    ].filter(Boolean),
  });
}

// --------------------------------------------------------------- keyboard
function onKey(e) {
  // A page in full screen: Esc brings it back, wherever the keyboard focus is (like in Chrome), unless it's
  // closing a menu or a dialog shown over the page.
  if (e.key === 'Escape' && S.htmlFullscreenTab && !e.repeat && !e.defaultPrevented && !menuOpen()) {
    if (V.exitHtmlFullscreen()) { e.preventDefault(); return; }
  }
  if (e.defaultPrevented || e.isComposing || menuOpen()) return;
  const id = window.WBDefaults.findCommand(compiled, e);
  if (!id) return;
  if (isEditable(e.target) && isEditingChord(e)) return;
  e.preventDefault();
  e.stopPropagation();
  Cmd.run(id, { source: 'key', key: e.key, mods: { control: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey } });
}

// ------------------------------------------------------------------ layout
function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const shield = V.dragShield('col-resize');
    const right = root.dataset.side === 'right';
    const startX = e.clientX, startW = sidebar.getBoundingClientRect().width;
    let w = startW;
    const move = (ev) => {
      w = Math.round(Math.max(180, Math.min(520, startW + (right ? startX - ev.clientX : ev.clientX - startX))));
      root.style.setProperty('--sidebar-w', w + 'px');
    };
    const up = () => {
      shield.remove();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (w !== startW) wb.invoke('settings:set', 'appearance.sidebarWidth', w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  resizer.addEventListener('dblclick', () => wb.invoke('settings:set', 'appearance.sidebarWidth', 264));

  setupRipples();

  // (Private windows get a badge in the sidebar: see workspaces.js.)
}

function setupTitlebarArea() {
  // Windows draws its caption buttons over our top-right corner; measure the space they take.
  const wco = navigator.windowControlsOverlay;
  const apply = () => {
    let w = 0;
    if (S.platform === 'win32' && !setting('appearance.useSystemTitleBar') && !S.ownCaption) {
      w = 140;
      try {
        if (wco && wco.visible) { const r = wco.getTitlebarAreaRect(); if (r && r.width) w = Math.max(0, window.innerWidth - (r.x + r.width)); }
      } catch { /* not available */ }
      if (S.fullscreen) w = 0;
    }
    root.style.setProperty('--caption-w', w + 'px');
  };
  if (wco && wco.addEventListener) wco.addEventListener('geometrychange', apply);
  window.addEventListener('resize', apply);
  on('settings', apply);
  wb.on('fullscreen', () => setTimeout(apply, 50));
  apply();
}

// ----------------------------------------------------------------- startup
async function start() {
  const init = await wb.invoke('ui:init');
  S.init = init;
  S.settings = init.settings;
  S.windowId = init.windowId;
  S.isPrivate = !!init.isPrivate;
  S.partition = init.partition;
  S.systemDark = init.systemDark !== false;
  S.maximized = !!init.maximized;
  S.fullscreen = !!init.fullscreen;
  S.ownCaption = !!init.ownCaption;
  compileKeys();
  Theme.init();

  if (!(init.restore && restore(init.restore))) normalize();

  V.init(); T.init(); Prompts.init(); Strip.init(); WS.init(); TB.init(); Omni.init(); Launcher.init();
  Cmd.init(); BM.init(); DL.init(); EXT.init(); Find.init(); Panels.init(); Site.init(); AppMenu.init();
  listen();
  setupSidebar();
  setupTitlebarArea();

  on('guest-message', onGuestMessage);
  on('focus-tab', (t) => T.focusTab(t || activeTab()));
  on('focus-view', (t) => V.focusView(t));
  on('open-url', (o) => T.openTab({ url: o.url, active: o.background !== true, opener: o.opener || null }));
  on('settings', (path) => {
    if (!path || path.startsWith('appearance.tabLayout') || path.startsWith('appearance.sidebar') || path === 'appearance') { TB.placeCaption(); V.layout(); }
  });
  window.addEventListener('keydown', onKey);
  TabSwitch.init();
  Flyouts.init();
  Ambient.init();
  Swipe.init();
  window.addEventListener('beforeunload', () => flushSave());

  // First tabs: the restored session, links this window was opened with, or a new tab.
  const urls = init.urls || [];
  if (!S.tabs.length && !urls.length) T.openTab({ url: init.firstRun && !S.isPrivate ? 'bifrost://welcome/' : T.newTabUrl() });
  urls.forEach((u, i) => T.openTab({ url: u, active: i === urls.length - 1, position: 'end' }));
  const t = activeTab();
  S.ready = true;
  if (t) T.selectTab(t);
  emit('structure');
  syncSoon();
  saveSoon();
  wb.send('ui:ready');
  // Hooks for automated tests and debugging from the window's DevTools.
  window.__wbTest = { command: (id, args) => Cmd.run(id, args || {}), state: S, render: () => emit('structure'), tabSwitch: () => TabSwitch._state(), flyouts: () => Flyouts._state(), swipe: () => Swipe._state(), swipeLast: () => Swipe._last(), panels: () => Panels._state() };
  requestAnimationFrame(() => root.classList.add('ready'));
}

start().catch((e) => {
  console.error('[ui] startup failed', e);
  document.body.append(h('pre.fatal', null, 'Bifrost’s window failed to start:\n\n' + ((e && e.stack) || e)));
});

