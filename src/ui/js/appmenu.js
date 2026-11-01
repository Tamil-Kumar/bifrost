// Bifrost browser UI — the main menu (the ≡ button).
import { S, on, emit, activeTab, setting, accelFor, wsTabs } from './state.js';
import { h, displayUrl, faviconEl } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './menus.js';
import * as T from './tabs.js';
import * as V from './views.js';
import * as Tr from '/_/common/translate.js';
import { toast } from './prompts.js';

const wb = window.wb;
const set = (p, v) => wb.invoke('settings:set', p, v);
const cmd = (id, args) => () => emit('command', id, args || {});
const item = (label, iconName, id, extra = {}) => Object.assign({ label, icon: iconName, accel: accelFor(id), action: cmd(id) }, extra);

function zoomRow() {
  const t = activeTab();
  const label = h('span.zr-val', null, Math.round(Math.pow(1.2, (t && t.zoom) || 0) * 100) + '%');
  const upd = (z) => { label.textContent = Math.round(Math.pow(1.2, z || 0) * 100) + '%'; };
  const zbtn = (ic, title, fn) => h('button.icon-btn', { type: 'button', title, onclick: async (e) => { e.stopPropagation(); if (t) upd(await fn().catch(() => t.zoom)); } }, icon(ic));
  return h('div.menu-row.zoom-row', null, h('span.mi-icon', null, icon('zoomIn')), h('span.mi-label', null, 'Zoom'),
    zbtn('zoomOut', 'Zoom out', () => V.guest(t, 'zoomBy', { delta: -0.5 })), label,
    zbtn('zoomIn', 'Zoom in', () => V.guest(t, 'zoomBy', { delta: 0.5 })),
    h('button.icon-btn', { type: 'button', title: 'Full screen (' + accelFor('fullscreen') + ')', onclick: (e) => { e.stopPropagation(); emit('command', 'fullscreen'); } }, icon('maximize')));
}

// Tabs open on your other computers (sync): a submenu for each.
async function otherComputers() {
  if (S.isPrivate || !setting('sync.enabled') || !setting('sync.tabs')) return [];
  const devices = await wb.invoke('sync:tabs').catch(() => []);
  if (!devices.length) return [];
  return [
    '-',
    { type: 'header', label: 'Tabs on your other computers' },
    ...devices.slice(0, 6).map((d) => {
      const tabs = d.windows.flatMap((w) => w.tabs);
      return { label: d.name, icon: 'laptop', submenu: [
        ...tabs.slice(0, 30).map((t) => ({ label: t.title || displayUrl(t.url) || t.url, iconEl: faviconEl(t.url, t.icon, icon, 'mi-fav'), action: () => emit('open-url', { url: t.url }) })),
        ...(tabs.length > 30 ? ['-', item(`All ${tabs.length} tabs…`, 'clock', 'openHistory')] : []),
      ] };
    }),
  ];
}

async function recentlyClosed() {
  const list = S.isPrivate ? T.privateClosedList() : await wb.invoke('closed:list').catch(() => []);
  const items = list.slice(0, 15).map((c) => ({
    label: c.title || displayUrl(c.url) || c.url, iconEl: faviconEl(c.url, c.favicon, icon, 'mi-fav'),
    action: async () => {
      if (S.isPrivate) { T.reopenClosed(c); return; }
      const data = await wb.invoke('closed:take', c.closedId).catch(() => null);
      if (data) T.reopenClosed(data);
    },
  }));
  return [
    { type: 'header', label: 'Recently closed' },
    ...(items.length ? items : [{ label: 'Nothing closed yet', disabled: true }]),
    ...(await otherComputers()),
    '-',
    item('Full history', 'clock', 'openHistory'),
    item('History panel', 'sidebar', 'panelHistory'),
    item('Clear browsing data…', 'trash', 'clearData'),
  ];
}

// Updates (main/updater.js): once a new version is downloaded, the menu button has a dot, the menu offers to
// restart, and a toast says so (once, in the window you're using).
let update = null;
const told = new Set();
const restartToUpdate = () => wb.invoke('updates:restart').catch(() => {});
function onUpdate(i) {
  update = i || null;
  const ready = !!(update && update.state === 'ready');
  document.documentElement.toggleAttribute('data-update-ready', ready);
  if (ready && !told.has(update.latest)) {
    told.add(update.latest);
    if (document.hasFocus() && !S.isPrivate) toast({ text: `Bifrost ${update.latest} is ready. It goes in the next time Bifrost starts.`, iconName: 'download', timeout: 15000, actions: [{ label: 'Restart now', action: restartToUpdate }] });
  }
}

export function appMenu(anchor) {
  const a = S.settings.appearance;
  const vertical = a.tabLayout !== 'horizontal';
  const themes = window.WBThemes.THEMES;
  const ready = update && update.state === 'ready';
  showMenu([
    ...(ready ? [{ label: `Restart to update Bifrost (${update.latest})`, icon: 'download', accent: true, action: restartToUpdate }, '-'] : []),
    item('New tab', 'plus', 'newTab', { action: cmd('newTabPage') }),
    item('New window', 'window', 'newWindow'),
    item('New private window', 'mask', 'newPrivateWindow'),
    '-',
    { type: 'custom', el: zoomRow() },
    '-',
    { label: 'Bookmarks', icon: 'star', submenu: [
      item('Bookmark this page', 'star', 'bookmarkPage'),
      { label: 'Bookmark all tabs…', icon: 'layers', action: () => emit('bookmark-tabs', wsTabs()) },
      { label: 'Show the bookmarks bar', checked: a.showBookmarksBar, accel: accelFor('toggleBookmarksBar'), action: cmd('toggleBookmarksBar') },
      '-',
      item('Bookmarks panel', 'sidebar', 'panelBookmarks'),
      item('Bookmark manager', 'book', 'openBookmarks'),
      item('Import bookmarks and settings…', 'import', 'importData'),
    ] },
    { label: 'History', icon: 'clock', submenu: recentlyClosed },
    item('Downloads', 'download', 'openDownloads', { accel: accelFor('panelDownloads') }),
    item('Extensions', 'puzzle', 'openExtensions'),
    '-',
    item('Find in page…', 'search', 'find'),
    item('Reader view', 'reader', 'readerMode'),
    item(activeTab() && Tr.isTranslated(activeTab().url) ? 'Show the original page' : 'Translate page', 'translate', 'translatePage'),
    { label: 'Screenshot', icon: 'camera', submenu: [
      item('Visible area', 'camera', 'screenshot'),
      { label: 'Whole page', icon: 'file', action: cmd('screenshot', { full: true }) },
    ] },
    item('Print…', 'print', 'print'),
    item('Save page as…', 'save', 'savePage'),
    { label: 'More tools', icon: 'wrench', submenu: [
      item('Task manager', 'cpu', 'taskManager'),
      item('Developer tools', 'code', 'devtools'),
      item('View page source', 'code', 'viewSource'),
      item('Picture-in-picture', 'pip', 'pictureInPicture'),
      item('Copy page address', 'link', 'copyUrl'),
      '-',
      item('Command palette', 'bolt', 'commandPalette'),
      item('Clear browsing data…', 'trash', 'clearData'),
    ] },
    '-',
    { label: 'Layout', icon: 'sidebar', submenu: [
      { label: 'Vertical tabs', checked: vertical, action: () => set('appearance.tabLayout', 'vertical') },
      { label: 'Horizontal tabs', checked: !vertical, action: () => set('appearance.tabLayout', 'horizontal') },
      '-',
      { label: 'Sidebar on the right', checked: a.sidebarSide === 'right', disabled: !vertical, action: () => set('appearance.sidebarSide', a.sidebarSide === 'right' ? 'left' : 'right') },
      { label: 'Collapsed sidebar', checked: a.sidebarCollapsed, disabled: !vertical, accel: accelFor('toggleSidebar'), action: () => set('appearance.sidebarCollapsed', !a.sidebarCollapsed) },
      { label: 'Hide the sidebar until you point at it', checked: a.sidebarAutoHide, disabled: !vertical, action: () => set('appearance.sidebarAutoHide', !a.sidebarAutoHide) },
      { label: 'Hide the top bar until you point at it', checked: a.topbarAutoHide, accel: accelFor('toggleTopbarAutoHide'), action: () => set('appearance.topbarAutoHide', !a.topbarAutoHide) },
      '-',
      { label: 'Compact toolbar', checked: a.compactToolbar, accel: accelFor('toggleCompact'), action: cmd('toggleCompact') },
      { label: 'Bookmarks bar', checked: a.showBookmarksBar, accel: accelFor('toggleBookmarksBar'), action: cmd('toggleBookmarksBar') },
      '-',
      { label: 'Density', submenu: ['compact', 'comfortable', 'spacious'].map((d) => ({ label: d[0].toUpperCase() + d.slice(1), checked: a.density === d, action: () => set('appearance.density', d) })) },
      '-',
      item('Customize toolbar and sidebar…', 'layout', 'customizeLayout'),
      { label: 'Sizes and corner rounding…', icon: 'ruler', action: cmd('openSettings', { section: 'look' }) },
    ] },
    { label: 'Theme', icon: 'palette', submenu: [
      { label: 'Match the system', checked: a.theme === 'auto', action: () => set('appearance.theme', 'auto') },
      '-',
      ...Object.entries(themes).map(([k, th]) => ({ label: th.name, iconEl: h('span.menu-dot', { style: { '--c': th.accent, boxShadow: `inset 0 0 0 3px ${th.base}` } }), checked: a.theme === k, action: () => set('appearance.theme', k) })),
      '-',
      { label: 'Customize…', icon: 'sliders', action: cmd('openSettings', { section: 'appearance' }) },
    ] },
    { label: 'Animations', icon: 'sparkle', toggle: true, checked: setting('animations.enabled'), accel: accelFor('toggleAnimations'), action: cmd('toggleAnimations') },
    { label: 'Vim keys', icon: 'vim', toggle: true, checked: setting('keyboard.vim.enabled'), accel: accelFor('toggleVim'), action: cmd('toggleVim') },
    '-',
    item('Customize toolbar and sidebar…', 'layout', 'customizeLayout'),
    item('Settings', 'sliders', 'openSettings'),
    { label: 'About Bifrost', icon: 'info', action: cmd('openAbout') },
    '-',
    { label: 'Quit', icon: 'close', action: () => wb.send('window:control', 'quit') },
  ], { anchor, side: 'bottom', align: 'end' }, { minWidth: 290 });
}

export function init() {
  on('app-menu', (anchor) => appMenu(anchor));
  wb.invoke('updates:info').then(onUpdate).catch(() => {});
  wb.on('updates-changed', onUpdate);
}
