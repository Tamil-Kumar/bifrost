// Bifrost browser UI — every command (keyboard shortcuts, menus, the command palette, Vim keys).
import { S, on, emit, activeTab, wsTabs, setting, removeFromGroup } from './state.js';
import { h, hostOf, isInternal, isNewTab, copyText } from './util.js';
import { dialog, toast } from './prompts.js';
import * as T from './tabs.js';
import * as TabSwitch from './tabswitch.js';
import * as V from './views.js';
import * as Omni from './omnibox.js';
import * as Panels from './panels.js';
import { openLauncher, closeLauncher, isOpen as launcherOpen, editAddress } from './launcher.js';
import { openFind, findNext } from './findbar.js';
import { newGroup, selectedTabs } from './tabstrip.js';
import * as Tr from '/_/common/translate.js';

const wb = window.wb;
const set = (path, value) => wb.invoke('settings:set', path, value).catch((e) => toast({ text: e.message, iconName: 'warn' }));

// Internal pages open once per window: an existing tab is reused.
export function openInternal(host, hash = '') {
  const url = `bifrost://${host}/${hash}`;
  const existing = wsTabs().find((t) => t.url.startsWith(`bifrost://${host}/`)) || S.tabs.find((t) => t.url.startsWith(`bifrost://${host}/`));
  if (existing) {
    T.selectTab(existing);
    if (hash && existing.url !== url) V.loadUrl(existing, url);
    return existing;
  }
  const t = activeTab();
  if (t && isNewTab(t.url) && !t.canGoBack && !t.loading) { V.loadUrl(t, url); T.selectTab(t); return t; }
  return T.openTab({ url, opener: t });
}

function tabsPrefix() { return (setting('launcher.prefixes.tabs') || '%') + ' '; }

async function openClipboard(where) {
  const text = String(await wb.invoke('app:clipboard-text').catch(() => '') || '').trim();
  if (!text) { toast({ text: 'The clipboard is empty', iconName: 'info', timeout: 1600 }); return; }
  const E = window.WBEngine;
  const engines = S.settings.search.engines;
  const eng = engines.find((x) => x.id === S.settings.search.defaultEngine) || engines[0];
  T.openUrl(E.looksLikeUrl(text) ? E.toUrl(text) : E.fillTemplate(eng.url, text), { where });
}

async function screenshot(t, full = false) {
  if (!t || !t.wv) return;
  try {
    const r = await V.guest(t, 'screenshot', { full });
    toast({
      text: 'Screenshot copied to the clipboard and saved', iconName: 'camera', timeout: 6000,
      actions: r && r.file ? [{ label: 'Open', action: () => wb.invoke('screenshot:open', r.file, false) }, { label: 'Show', action: () => wb.invoke('screenshot:open', r.file, true) }] : [],
    });
  } catch (e) { toast({ text: 'Couldn’t take a screenshot: ' + e.message, iconName: 'warn' }); }
}

// Translate the page into your language (or `to`), or, on a translated page, go back to the original.
function translate(t, to) {
  if (!t) return;
  if (Tr.isTranslated(t.url)) {
    const orig = Tr.originalUrl(t.url);
    if (orig) V.loadUrl(t, orig);
    return;
  }
  if (!Tr.canTranslate(t.url)) { toast({ text: 'Only public websites can be translated', iconName: 'translate', timeout: 2500 }); return; }
  const target = Tr.translateCode(to) || targetLanguage();
  V.loadUrl(t, Tr.translateUrl(t.url, target));
}
export function targetLanguage() { return Tr.translateCode(setting('translate.target')) || Tr.translateCode(navigator.language) || 'en'; }

async function reader(t) {
  if (!t) return;
  if (t.url.startsWith('bifrost://reader/')) {
    const u = new URL(t.url).searchParams.get('url');
    if (t.canGoBack) V.goBack(t); else if (u) V.loadUrl(t, u);
    return;
  }
  if (!/^https?:/i.test(t.url) || !t.wv) { toast({ text: 'Reader view works on web pages', iconName: 'reader', timeout: 2000 }); return; }
  try {
    const token = await V.guest(t, 'readerSnapshot');
    V.loadUrl(t, `bifrost://reader/?t=${encodeURIComponent(token || '')}&url=${encodeURIComponent(t.url)}`);
  } catch (e) { toast({ text: 'Reader view isn’t available for this page', iconName: 'reader' }); }
}

function toggleVimSite(host, on) {
  if (!host) return;
  const list = (setting('keyboard.vim.excludedSites') || []).slice();
  const i = list.findIndex((e) => String(e).trim().split(/\s+/)[0] === host);
  const excluded = i >= 0;
  const wantOn = on == null ? excluded : on;
  if (wantOn && excluded) list.splice(i, 1);
  if (!wantOn && !excluded) list.push(host);
  set('keyboard.vim.excludedSites', list);
  toast({ text: wantOn ? `Vim keys on for ${host}` : `Vim keys off for ${host}`, iconName: 'vim', timeout: 1800 });
}

function vimHelp() {
  const keys = Object.assign({}, S.init.vimKeys, setting('keyboard.vim.keys') || {});
  const NAMES = {
    scrollDown: 'Scroll down', scrollUp: 'Scroll up', scrollLeft: 'Scroll left', scrollRight: 'Scroll right', halfPageDown: 'Half a page down', halfPageUp: 'Half a page up',
    pageDown: 'Page down', pageUp: 'Page up', top: 'Top of the page', bottom: 'Bottom of the page', hints: 'Click a link', hintsNewTab: 'Open a link in a new tab',
    hintsCopy: 'Copy a link', hintsSplit: 'Open a link in split view', back: 'Back', forward: 'Forward', reload: 'Reload', closeTab: 'Close tab', reopenTab: 'Reopen closed tab',
    nextTab: 'Next tab', prevTab: 'Previous tab', firstTab: 'First tab', lastTab: 'Last tab', launcher: 'Launcher', launcherNewTab: 'Launcher (new tab)', tabSearch: 'Search tabs',
    find: 'Find', findNext: 'Next match', findPrev: 'Previous match', copyUrl: 'Copy page address', openClipboard: 'Open the clipboard', openClipboardNewTab: 'Open the clipboard in a new tab',
    focusInput: 'Focus the first text field', upUrl: 'Up one level', rootUrl: 'Site root', insertMode: 'Insert mode (Esc leaves)', passNext: 'Send the next key to the page', help: 'This help',
  };
  const groups = [
    ['Scrolling', ['scrollDown', 'scrollUp', 'scrollLeft', 'scrollRight', 'halfPageDown', 'halfPageUp', 'pageDown', 'pageUp', 'top', 'bottom']],
    ['Links', ['hints', 'hintsNewTab', 'hintsSplit', 'hintsCopy', 'focusInput']],
    ['Tabs', ['nextTab', 'prevTab', 'firstTab', 'lastTab', 'closeTab', 'reopenTab', 'tabSearch']],
    ['Pages', ['back', 'forward', 'reload', 'upUrl', 'rootUrl', 'copyUrl', 'openClipboard', 'openClipboardNewTab', 'launcher', 'launcherNewTab', 'find', 'findNext', 'findPrev']],
    ['Modes', ['insertMode', 'passNext', 'help']],
  ];
  const body = h('div.vim-help', null, groups.map(([title, ids]) => h('section', null, h('h3', null, title),
    h('dl', null, ids.filter((id) => keys[id]).map((id) => [h('dt', null, h('kbd', null, keys[id])), h('dd', null, NAMES[id] || id)])))),
  h('p.muted.small', null, 'Change keys or turn Vim mode off for some sites in Settings → Keyboard.'));
  dialog({ title: 'Vim keys', iconName: 'vim', body, width: 720, buttons: [{ label: 'Keyboard settings', value: 'settings' }, { label: 'Close', value: null, primary: true }] })
    .then((v) => { if (v === 'settings') run('openSettings', { section: 'keyboard' }); });
}

function runVim(a) {
  const t = activeTab();
  switch (a) {
    case 'back': if (t) V.goBack(t); return;
    case 'forward': if (t) V.goForward(t); return;
    case 'reload': if (t) V.reload(t); return;
    case 'closeTab': if (t) T.requestClose(t); return;
    case 'reopenTab': T.reopenClosed(); return;
    case 'nextTab': T.selectRelative(1); return;
    case 'prevTab': T.selectRelative(-1); return;
    case 'firstTab': T.selectIndex(0); return;
    case 'lastTab': T.selectIndex(-1); return;
    case 'launcher': openLauncher({ mode: 'current' }); return;
    case 'launcherNewTab': openLauncher({ mode: 'newtab' }); return;
    case 'tabSearch': openLauncher({ mode: 'current', text: tabsPrefix() }); return;
    case 'find': openFind(t); return;
    case 'findNext': findNext(true); return;
    case 'findPrev': findNext(false); return;
    case 'openClipboard': openClipboard('current'); return;
    case 'openClipboardNewTab': openClipboard('newtab'); return;
    default:
  }
}

// Commands that work over a page in full screen. Anything else shows something of Bifrost's (the launcher,
// a panel, the find bar, a dialog…), which the page would cover: the page leaves full screen first, as in
// Chrome.
// (Switching tabs takes the page out of full screen by itself, see views.js.)
const OVER_FULLSCREEN = new Set(['muteTab', 'zoomIn', 'zoomOut', 'zoomReset', 'pictureInPicture', 'toggleAnimations', 'toggleVim', 'copyUrl', 'cycleTheme', 'sleepBackgroundTabs', 'nextTab', 'prevTab', 'lastTab']);

// A keyboard's Back and Forward keys reach Bifrost twice on Windows: as keys, and as the system's "browser
// back/forward" command (which is also how the mouse's side buttons arrive). One press, one step.
let lastNav = { id: '', sys: false, at: 0 };
function duplicateNav(id, args) {
  if (id !== 'back' && id !== 'forward') return false;
  const viaKey = /^Browser(Back|Forward)$/.test((args && args.key) || '');
  const viaSys = !!(args && args.source === 'mouse');
  if (!viaKey && !viaSys) return false;
  const now = performance.now();
  if (lastNav.id === id && lastNav.sys !== viaSys && now - lastNav.at < 400) { lastNav = { id: '', sys: false, at: 0 }; return true; }
  lastNav = { id, sys: viaSys, at: now };
  return false;
}

export function run(id, args = {}) {
  const t = activeTab();
  if (duplicateNav(id, args)) return;
  if (/^tab[1-8]$/.test(id)) { T.selectIndex(Number(id.slice(3)) - 1); return; }
  if (/^workspace[1-9]$/.test(id)) { const w = S.workspaces[Number(id.slice(9)) - 1]; if (w) T.switchWorkspace(w.id); return; }
  if (id.startsWith('vim:')) { runVim(id.slice(4)); return; }
  if (S.htmlFullscreenTab && !OVER_FULLSCREEN.has(id)) {
    // Full screen (F11) just brings the page back.
    if (id === 'fullscreen') { V.exitHtmlFullscreen(); return; }
    V.leaveHtmlFullscreen().then(() => run(id, args));
    return;
  }
  switch (id) {
    // ---- tabs
    case 'newTab':
      if (launcherOpen()) { closeLauncher(); T.openTab({}); return; }
      if (setting('tabs.newTabOpensLauncher')) openLauncher({ mode: 'newtab' });
      else T.openTab({});
      return;
    case 'newTabPage': T.openTab({}); return;
    case 'closeTab': if (t) T.requestClose(t); return;
    case 'reopenTab': T.reopenClosed(); return;
    case 'nextTab': TabSwitch.step(1, args); return;
    case 'prevTab': TabSwitch.step(-1, args); return;
    case 'lastTab': T.selectIndex(-1); return;
    case 'duplicateTab': if (t) T.duplicateTab(t); return;
    case 'pinTab': if (t) T.togglePin(t); return;
    case 'muteTab': if (t) T.toggleMute(t); return;
    case 'closeOtherTabs': if (t) T.requestClose(wsTabs().filter((x) => x !== t && !x.pinned)); return;
    case 'sleepTab': if (t) T.sleep(t); return;
    case 'sleepBackgroundTabs': { const n = V.sleepBackgroundTabs(); emit('toast', { text: n ? `Put ${n} tab${n === 1 ? '' : 's'} to sleep` : 'No tabs could be put to sleep', iconName: 'moon' }); return; }
    case 'moveTabLeft': if (t) T.moveRelative(t, -1); return;
    case 'moveTabRight': if (t) T.moveRelative(t, 1); return;
    case 'groupTab': { const sel = selectedTabs(); newGroup(sel.length ? sel : [t].filter(Boolean)); return; }
    case 'ungroupTab': if (t && t.groupId) { removeFromGroup(t); emit('structure'); } return;
    // ---- spaces
    case 'newWorkspace': emit('new-workspace'); return;
    case 'nextWorkspace': T.switchWorkspaceRelative(1); return;
    case 'prevWorkspace': T.switchWorkspaceRelative(-1); return;
    // ---- split view
    case 'splitWithNext': T.splitWithNext(t); return;
    case 'splitPick': openLauncher({ mode: 'split', text: tabsPrefix() }); return;
    case 'splitNewTab': T.openUrl(T.newTabUrl(), { where: 'split' }); return;
    case 'unsplit': T.unsplit(t); return;
    case 'splitRotate': T.rotateSplit(t); return;
    case 'focusNextPane': T.focusPane(1); return;
    case 'focusPrevPane': T.focusPane(-1); return;
    // ---- navigation
    case 'launcher':
      if (args.text != null || args.mode) { openLauncher({ mode: args.mode || 'current', text: args.text || '' }); return; }
      if (launcherOpen()) closeLauncher(); else openLauncher({ mode: 'current' });
      return;
    case 'commandPalette': openLauncher({ mode: 'current', text: (setting('launcher.prefixes.commands') || '>') + ' ' }); return;
    case 'focusAddress': if (!Omni.focus(true)) editAddress(); return;
    case 'back': if (t) V.goBack(t); return;
    case 'forward': if (t) V.goForward(t); return;
    case 'reload': if (t) V.reload(t); return;
    case 'hardReload': if (t) V.reload(t, true); return;
    case 'stop': if (t) V.stopLoading(t); return;
    case 'home': T.openUrl(setting('tabs.homeUrl') || T.newTabUrl(), { where: 'current' }); return;
    // ---- page
    case 'find': openFind(t); return;
    case 'findNext': findNext(true); return;
    case 'findPrev': findNext(false); return;
    case 'zoomIn': if (t) V.guest(t, 'zoomBy', { delta: 0.5 }).catch(() => {}); return;
    case 'zoomOut': if (t) V.guest(t, 'zoomBy', { delta: -0.5 }).catch(() => {}); return;
    case 'zoomReset': if (t) V.guest(t, 'setZoom', { level: 0 }).catch(() => {}); return;
    case 'bookmarkPage': emit('bookmark-page'); return;
    case 'readerMode': reader(t); return;
    case 'translatePage': translate(args.wcId != null ? (S.tabs.find((x) => x.wcId === args.wcId) || t) : t, args.to); return;
    case 'screenshot': screenshot(t, !!args.full); return;
    case 'pictureInPicture': if (t) V.guest(t, 'pip').then((r) => { if (r === 'no-video') toast({ text: 'There’s no video on this page', iconName: 'pip', timeout: 2000 }); }).catch(() => {}); return;
    case 'print': if (t) V.call(t, 'print'); return;
    case 'savePage': if (t) V.guest(t, 'savePage').catch(() => {}); return;
    case 'viewSource': if (t && /^https?:/i.test(t.url)) T.openTab({ url: 'view-source:' + t.url, opener: t }); return;
    case 'devtools': if (t && t.wv) { if (V.call(t, 'isDevToolsOpened')) V.call(t, 'closeDevTools'); else V.call(t, 'openDevTools'); } return;
    case 'copyUrl': if (t) { copyText(t.url); toast({ text: 'Address copied', iconName: 'link', timeout: 1500 }); } return;
    case 'toggleAdblockSite': {
      const host = t && hostOf(t.url);
      if (!host || isInternal(t.url)) return;
      const allowed = (setting('privacy.adblock.allowlist') || []).includes(host);
      wb.invoke('adblock:set-site', host, !allowed).then(() => { V.reload(t); toast({ text: allowed ? `Blocking ads on ${host}` : `Ads allowed on ${host}`, iconName: allowed ? 'shieldCheck' : 'shieldOff', timeout: 2000 }); });
      return;
    }
    case 'toggleVimSite': toggleVimSite(args.host || (t && hostOf(t.url)), args.on); return;
    // ---- window
    case 'newWindow': wb.send('window:control', 'newWindow'); return;
    case 'newPrivateWindow': wb.send('window:control', 'newPrivateWindow'); return;
    case 'closeWindow': wb.send('window:control', 'close'); return;
    case 'fullscreen': wb.send('window:control', 'fullscreen'); return;
    case 'toggleSidebar':
      if (setting('appearance.tabLayout') === 'horizontal') set('appearance.tabLayout', 'vertical');
      else set('appearance.sidebarCollapsed', !setting('appearance.sidebarCollapsed'));
      return;
    case 'toggleTabLayout': set('appearance.tabLayout', setting('appearance.tabLayout') === 'horizontal' ? 'vertical' : 'horizontal'); return;
    case 'toggleBookmarksBar': set('appearance.showBookmarksBar', !setting('appearance.showBookmarksBar')); return;
    case 'toggleCompact': set('appearance.compactToolbar', !setting('appearance.compactToolbar')); return;
    case 'toggleBlend': set('appearance.blend', { window: 'page', page: 'blur', blur: 'window' }[setting('appearance.blend')] || 'page'); return;
    case 'toggleTopbarAutoHide': set('appearance.topbarAutoHide', !setting('appearance.topbarAutoHide')); return;
    case 'toggleSidebarAutoHide': set('appearance.sidebarAutoHide', !setting('appearance.sidebarAutoHide')); return;
    // ---- panels and pages
    case 'panelBookmarks': Panels.toggle('bookmarks'); return;
    case 'panelHistory': Panels.toggle('history'); return;
    case 'panelDownloads': Panels.toggle('downloads'); return;
    case 'customizeLayout': openInternal('settings', '#customize'); return;
    case 'openSettings': openInternal('settings', args.section ? '#' + args.section + (args.host ? '/' + encodeURIComponent(args.host) : '') : ''); return;
    case 'openHistory': openInternal('history'); return;
    case 'openBookmarks': openInternal('bookmarks'); return;
    case 'openDownloads': openInternal('downloads'); return;
    case 'openExtensions': openInternal('extensions'); return;
    case 'openAbout': openInternal('about'); return;
    case 'taskManager': openInternal('tasks'); return;
    case 'clearData': openInternal('settings', '#clear'); return;
    case 'importData': openInternal('settings', '#import'); return;
    // ---- tools
    case 'toggleVim': {
      const on = !setting('keyboard.vim.enabled');
      set('keyboard.vim.enabled', on);
      toast({ text: on ? 'Vim keys are on. Press ? on a page for help.' : 'Vim keys are off', iconName: 'vim', timeout: 2200 });
      return;
    }
    case 'toggleAnimations': {
      const on = !setting('animations.enabled');
      set('animations.enabled', on);
      toast({ text: on ? 'Animations are on' : 'Animations are off', iconName: 'sparkle', timeout: 1800 });
      return;
    }
    case 'cycleTheme': {
      const keys = Object.keys(window.WBThemes.THEMES);
      const cur = setting('appearance.theme');
      const next = keys[(keys.indexOf(cur) + 1) % keys.length];
      set('appearance.theme', next);
      toast({ text: 'Theme: ' + window.WBThemes.THEMES[next].name, iconName: 'palette', timeout: 1600 });
      return;
    }
    case 'vimHelp': vimHelp(); return;
    case 'noop': return;
    default:
      console.warn('[ui] unknown command', id);
  }
}

export function init() {
  on('command', (id, args) => run(id, args || {}));
}
