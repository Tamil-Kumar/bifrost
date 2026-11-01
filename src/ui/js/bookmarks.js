// Bifrost browser UI — the bookmarks bar, the star button's bookmark editor, and "bookmark these tabs".
import { on, emit, activeTab, setting } from './state.js';
import { h, faviconEl, isNewTab, displayUrl, debounce, animate, anim } from './util.js';
import { icon } from './icons.js';
import { showMenu, popover } from './menus.js';
import { promptDialog, confirmDialog, dialog, toast } from './prompts.js';
import * as T from './tabs.js';
import * as TB from './toolbar.js';
import { howFromEvent } from './results.js';

const wb = window.wb;
const barEl = document.getElementById('bookmarks-bar');
const BAR = 2, OTHER = 3;
let lastFolder = BAR;
let barItems = [];

// ------------------------------------------------------------- opening
function openBookmark(b, how = 'current') {
  if (!b.url) return;
  T.openUrl(b.url, { where: how, allowScript: true, opener: how === 'background' ? activeTab() : null });
}

async function openAll(folderId, how = 'background') {
  const kids = (await wb.invoke('bookmarks:children', folderId)).filter((c) => c.type === 'bookmark' && /^(https?|file|ftp):/i.test(c.url));
  if (kids.length > 12 && !(await confirmDialog(`Open ${kids.length} tabs?`, { ok: 'Open all' }))) return;
  kids.forEach((c, i) => T.openTab({ url: c.url, active: how !== 'background' && i === 0, position: 'end' }));
}

// Menu items for a folder's contents (submenus load as you open them).
async function folderItems(folderId) {
  const kids = await wb.invoke('bookmarks:children', folderId).catch(() => []);
  const items = kids.map((c) => {
    if (c.type === 'separator') return '-';
    if (c.type === 'folder') return { label: c.title || 'Untitled folder', icon: 'folder', submenu: () => folderItems(c.id) };
    return { label: c.title || displayUrl(c.url) || c.url, iconEl: faviconEl(c.url, c.favicon, icon, 'mi-fav', { hi: true }), action: (e) => openBookmark(c, (e && howFromEvent(e)) || 'current') };
  });
  const links = kids.filter((c) => c.type === 'bookmark');
  if (links.length > 1) items.push('-', { label: `Open all (${links.length})`, icon: 'layers', action: () => openAll(folderId) });
  return items.length ? items : [{ label: 'Empty folder', disabled: true }];
}

// ------------------------------------------------------------------ bar
const otherShown = () => setting('appearance.bookmarksBar.showOtherBookmarks') !== false;
const labelMode = () => setting('appearance.bookmarksBar.labels') || 'all';

let barShown = false;
async function renderBar() {
  if (!setting('appearance.showBookmarksBar')) { barEl.replaceChildren(); barShown = false; return; }
  const arriving = !barShown && document.documentElement.classList.contains('ready');
  barShown = true;
  barItems = await wb.invoke('bookmarks:children', BAR).catch(() => []);
  const els = barItems.map((b) => barItem(b));
  const more = h('button.bm-more.no-drag', { type: 'button', title: 'More bookmarks', hidden: true }, icon('chevronRight'));
  more.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('click', () => {
    const hidden = els.filter((el) => el.classList.contains('overflow')).map((el) => el._bm);
    showMenu(hidden.map((c) => c.type === 'separator' ? '-' : c.type === 'folder'
      ? { label: c.title || 'Untitled folder', icon: 'folder', submenu: () => folderItems(c.id) }
      : { label: c.title || displayUrl(c.url), iconEl: faviconEl(c.url, c.favicon, icon, 'mi-fav', { hi: true }), action: (e) => openBookmark(c, (e && howFromEvent(e)) || 'current') }),
    { anchor: more, side: 'bottom', align: 'end' });
  });
  let other = null;
  if (otherShown()) {
    const label = labelMode() === 'none' ? null : h('span', null, 'Other bookmarks');
    other = h('button.bm-item.bm-other.folder.no-drag' + (label ? '' : '.icon-only'), { type: 'button', title: 'Other bookmarks' }, icon('folder'), label);
    other.addEventListener('mousedown', (e) => { if (e.button !== 2) e.preventDefault(); });
    other.addEventListener('click', () => folderItems(OTHER).then((items) => showMenu(items, { anchor: other, side: 'bottom', align: 'end' })));
    other.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); otherMenu({ x: e.clientX, y: e.clientY }); });
  }
  const empty = !barItems.length ? h('span.bm-empty', null, 'Bookmarks you add to the bar show up here. Press ', h('kbd', null, 'Ctrl+D'), ' to bookmark a page.') : null;
  barEl.replaceChildren(...[h('div.bm-items', null, empty, els), more, other].filter(Boolean));
  requestAnimationFrame(() => fitBar(els, more));
  // The bar was just turned on: its items arrive one after another.
  if (arriving && anim('bookmarksBar')) {
    els.slice(0, 24).forEach((el, i) => animate(el, [{ opacity: 0, transform: 'translateY(-4px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 18, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }, 'bookmarksBar'));
  }
}

function barItem(b) {
  let el;
  const mode = labelMode();
  if (b.type === 'separator') el = h('span.bm-sep');
  else if (b.type === 'folder') {
    // A folder without a name is shown as just its icon (as Firefox does), not as "Untitled".
    const label = b.title && mode !== 'none' ? h('span', null, b.title) : null;
    el = h('button.bm-item.folder.no-drag' + (label ? '' : '.icon-only'), { type: 'button', title: b.title || 'Folder' }, icon('folder'), label);
    el.addEventListener('click', () => folderItems(b.id).then((items) => showMenu(items, { anchor: el, side: 'bottom', align: 'start' })));
  } else {
    const label = mode === 'all' ? b.title || '' : '';
    el = h('button.bm-item.no-drag' + (label ? '' : '.icon-only'), { type: 'button', title: (b.title ? b.title + '\n' : '') + (b.url || '') }, faviconEl(b.url, b.favicon, icon, 'bm-fav', { hi: true, lookup: true }), label ? h('span', null, label) : null);
    el.addEventListener('click', (e) => openBookmark(b, howFromEvent(e) || 'current'));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openBookmark(b, 'background'); } });
  }
  el._bm = b;
  el.addEventListener('mousedown', (e) => { if (e.button !== 2) e.preventDefault(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); itemMenu(b, { x: e.clientX, y: e.clientY }); });
  return el;
}

// "Other bookmarks": hide the button, or remove the folder (its contents move to the bar or go away).
function otherMenu(pos) {
  showMenu([
    { label: 'Open all in tabs', icon: 'layers', action: () => openAll(OTHER) },
    { label: 'Show in bookmark manager', icon: 'book', action: () => emit('command', 'openBookmarks') },
    '-',
    { label: 'Hide “Other bookmarks”', icon: 'eyeOff', action: () => wb.invoke('settings:set', 'appearance.bookmarksBar.showOtherBookmarks', false) },
    { label: 'Remove “Other bookmarks”…', icon: 'trash', danger: true, action: () => retireOther() },
  ], pos);
}

export async function retireOther() {
  const kids = await wb.invoke('bookmarks:children', OTHER).catch(() => []);
  let mode = 'move';
  if (kids.length) {
    const n = kids.length;
    mode = await dialog({
      title: 'Remove “Other bookmarks”?', iconName: 'folder', width: 470,
      body: h('div', null,
        h('p', { style: { margin: '0 0 8px' } }, `It has ${n} item${n === 1 ? '' : 's'} in it. Move ${n === 1 ? 'it' : 'them'} to the end of the bookmarks bar, or delete ${n === 1 ? 'it' : 'them'}?`),
        h('p.muted', { style: { margin: 0 } }, 'Imported bookmarks will go to the bookmarks bar from now on. Settings → Appearance brings the folder back.')),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Delete them', value: 'delete', danger: true }, { label: 'Move to the bar', value: 'move', primary: true }],
      dismissValue: null,
    });
    if (!mode) return;
    if (mode === 'delete' && !(await confirmDialog(`Delete ${n} bookmark${n === 1 ? '' : 's'} and folder${n === 1 ? '' : 's'} for good?`, { ok: 'Delete', danger: true }))) return;
  }
  const moved = await wb.invoke('bookmarks:retire-other', mode);
  toast({ text: moved ? (mode === 'delete' ? `Removed “Other bookmarks” and the ${moved} item${moved === 1 ? '' : 's'} in it` : `Removed “Other bookmarks”; its ${moved} item${moved === 1 ? ' is' : 's are'} now at the end of the bar`) : 'Removed “Other bookmarks”', iconName: 'folder' });
}

function fitBar(els, more) {
  if (!els.length) { more.hidden = true; return; }
  for (const el of els) el.classList.remove('overflow');
  const box = barEl.querySelector('.bm-items');
  if (!box) return;
  const limit = box.getBoundingClientRect().right;
  let overflow = false;
  for (const el of els) {
    if (overflow || el.getBoundingClientRect().right > limit + 1) { overflow = true; el.classList.add('overflow'); }
  }
  more.hidden = !overflow;
}

function itemMenu(b, pos) {
  const isLink = b.type === 'bookmark';
  showMenu([
    isLink ? { label: 'Open in new tab', icon: 'plus', action: () => openBookmark(b, 'background') } : { label: 'Open all in tabs', icon: 'layers', action: () => openAll(b.id) },
    isLink ? { label: 'Open in new window', icon: 'window', action: () => openBookmark(b, 'window') } : null,
    isLink ? { label: 'Open in private window', icon: 'mask', action: () => openBookmark(b, 'private') } : null,
    isLink ? { label: 'Open in split view', icon: 'split', action: () => openBookmark(b, 'split') } : null,
    '-',
    b.type !== 'separator' ? { label: 'Edit…', icon: 'edit', action: () => editDialog(b) } : null,
    { label: 'Delete', icon: 'trash', danger: true, action: async () => {
      if (b.type === 'folder') {
        const n = (await wb.invoke('bookmarks:children', b.id)).length;
        if (n && !(await confirmDialog(`Delete “${b.title}” and the ${n} item${n === 1 ? '' : 's'} in it?`, { ok: 'Delete', danger: true }))) return;
      }
      await wb.invoke('bookmarks:remove', b.id);
    } },
    '-',
    { label: 'Add this page', icon: 'star', action: () => addCurrent(b.parentId, b.index + 1) },
    { label: 'Add folder…', icon: 'folder', action: async () => { const name = await promptDialog({ title: 'New folder', value: 'New folder', ok: 'Create' }); if (name) wb.invoke('bookmarks:create', { parentId: b.parentId, index: b.index + 1, title: name, type: 'folder' }); } },
    { label: 'Add separator', action: () => wb.invoke('bookmarks:create', { parentId: b.parentId, index: b.index + 1, type: 'separator' }) },
    '-',
    { label: 'Hide the bookmarks bar', icon: 'eye', accel: '', action: () => emit('command', 'toggleBookmarksBar') },
    { label: 'Bookmark manager', icon: 'book', action: () => emit('command', 'openBookmarks') },
  ], pos);
}

async function addCurrent(parentId = BAR, index) {
  const t = activeTab();
  if (!t || isNewTab(t.url)) return;
  await wb.invoke('bookmarks:create', { parentId, index, title: t.title || displayUrl(t.url), url: t.url });
}

// ----------------------------------------------------------------- dialogs
async function folderOptions(selectedId) {
  const tree = await wb.invoke('bookmarks:tree');
  const out = [];
  const walk = (n, depth) => {
    if (n.type !== 'folder') return;
    if (n.parentId != null) out.push(h('option', { value: String(n.id), selected: n.id === selectedId }, ' '.repeat(Math.max(0, depth - 1)) + (n.title || 'Untitled folder')));
    for (const c of n.children || []) walk(c, depth + 1);
  };
  walk(tree, 0);
  return out;
}

async function editDialog(b) {
  const name = h('input.field', { type: 'text', autofocus: true, 'data-select': '' });
  name.value = b.title || '';
  const url = h('input.field', { type: 'text', spellcheck: 'false' });
  url.value = b.url || '';
  const folder = h('select.field');
  folder.append(...await folderOptions(b.parentId));
  const body = h('div.form', null,
    h('label.dialog-field', null, h('span', null, 'Name'), name),
    b.type === 'bookmark' ? h('label.dialog-field', null, h('span', null, 'Address'), url) : null,
    h('label.dialog-field', null, h('span', null, 'Folder'), folder));
  const ok = await dialog({ title: b.type === 'folder' ? 'Edit folder' : 'Edit bookmark', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }], dismissValue: false, width: 460 });
  if (!ok) return;
  await wb.invoke('bookmarks:update', b.id, { title: name.value, url: b.type === 'bookmark' ? url.value : undefined }).catch((e) => toast({ text: e.message, iconName: 'warn' }));
  const pid = Number(folder.value);
  if (pid && pid !== b.parentId) await wb.invoke('bookmarks:move', b.id, { parentId: pid }).catch((e) => toast({ text: e.message, iconName: 'warn' }));
}

// The star: bookmarks the page right away, then offers to rename, move or remove it.
async function starPopover(anchor) {
  const t = activeTab();
  if (!t || isNewTab(t.url)) return;
  let [b] = await wb.invoke('bookmarks:by-url', t.url).catch(() => []);
  const isNew = !b;
  if (!b) {
    b = await wb.invoke('bookmarks:create', { parentId: lastFolder, title: t.title || displayUrl(t.url), url: t.url }).catch(() => null);
    if (!b) b = await wb.invoke('bookmarks:create', { parentId: BAR, title: t.title || displayUrl(t.url), url: t.url });
    TB.bump('star');
  }
  const name = h('input.field', { type: 'text', autofocus: true, 'data-select': '' });
  name.value = b.title || '';
  const folder = h('select.field');
  folder.append(...await folderOptions(b.parentId));
  const save = debounce(() => wb.invoke('bookmarks:update', b.id, { title: name.value }).catch(() => {}), 300);
  name.addEventListener('input', save);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pop.close(); } });
  folder.addEventListener('change', () => {
    const pid = Number(folder.value);
    lastFolder = pid;
    wb.invoke('bookmarks:move', b.id, { parentId: pid }).then((nb) => { if (nb) b = nb; }).catch(() => {});
  });
  const body = h('div.star-pop', null,
    h('div.star-head', null, h('span.star-ico', null, icon('star')), h('b', null, isNew ? 'Bookmark added' : 'Edit bookmark')),
    h('label.dialog-field', null, h('span', null, 'Name'), name),
    h('label.dialog-field', null, h('span', null, 'Folder'), folder),
    h('div.star-actions', null,
      h('button.btn', { type: 'button', onclick: async () => { save.cancel(); await wb.invoke('bookmarks:remove', b.id); pop.close(); } }, 'Remove'),
      h('button.btn.primary', { type: 'button', onclick: () => { save.flush(); pop.close(); } }, 'Done')));
  const pop = popover(body, { anchor, side: 'bottom', align: 'end' }, { className: 'star-popover', onClose: () => save.flush() });
}

async function bookmarkTabs(tabs) {
  tabs = tabs.filter((t) => /^(https?|file|ftp):/i.test(t.url));
  if (!tabs.length) return;
  if (tabs.length === 1) {
    const t = tabs[0];
    await wb.invoke('bookmarks:create', { parentId: lastFolder, title: t.title || displayUrl(t.url), url: t.url });
    toast({ text: 'Bookmarked', iconName: 'star', timeout: 1800 });
    return;
  }
  const d = new Date();
  const title = await promptDialog({ title: `Bookmark ${tabs.length} tabs`, label: 'Folder name', value: `Saved tabs ${d.toLocaleDateString()}`, ok: 'Bookmark' });
  if (!title) return;
  const parent = otherShown() ? OTHER : BAR;
  const f = await wb.invoke('bookmarks:create', { parentId: parent, title, type: 'folder' });
  for (const t of tabs) await wb.invoke('bookmarks:create', { parentId: f.id, title: t.title || displayUrl(t.url), url: t.url });
  toast({ text: `Saved ${tabs.length} tabs to “${title}” in ${parent === OTHER ? 'Other bookmarks' : 'the bookmarks bar'}`, iconName: 'star' });
}

// ------------------------------------------------------------------ star state
const refreshStar = debounce(async () => {
  const t = activeTab();
  if (!t || isNewTab(t.url) || !/^(https?|file|ftp|bifrost):/i.test(t.url)) { TB.setStarred(false); return; }
  const list = await wb.invoke('bookmarks:by-url', t.url).catch(() => []);
  TB.setStarred(list.length > 0);
}, 60);

export function init() {
  renderBar();
  refreshStar();
  on('bookmarks-changed', () => { renderBar(); refreshStar(); });
  on('active', () => refreshStar());
  on('tab', (t, patch) => { if (t === activeTab() && 'url' in patch) refreshStar(); });
  on('toolbar-built', () => refreshStar());
  on('settings', (path) => { if (!path || path.startsWith('appearance.showBookmarksBar') || path.startsWith('appearance.bookmarksBar') || path === 'appearance') renderBar(); });
  on('bookmark-star', (anchor) => starPopover(anchor));
  on('bookmark-page', () => { const b = TB.button('star'); if (b && b.offsetParent) starPopover(b); else bookmarkTabs([activeTab()].filter(Boolean)); });
  on('bookmark-tabs', (tabs) => bookmarkTabs(tabs));
  // A sharper icon was found for a site on the bar: redraw the bar (once for a burst of them).
  const iconsArrived = debounce(() => renderBar(), 250);
  wb.on('site-icon', (e) => {
    const host = e && e.host;
    if (host && barItems.some((b) => { try { return new URL(b.url).hostname.replace(/^www\./, '') === host.replace(/^www\./, ''); } catch { return false; } })) iconsArrived();
  });
  barEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.bm-item')) return;
    e.preventDefault();
    showMenu([
      { label: 'Add this page', icon: 'star', action: () => addCurrent(BAR) },
      { label: 'Add folder…', icon: 'folder', action: async () => { const name = await promptDialog({ title: 'New folder', value: 'New folder', ok: 'Create' }); if (name) wb.invoke('bookmarks:create', { parentId: BAR, title: name, type: 'folder' }); } },
      '-',
      { label: 'Show names', icon: 'type', submenu: () => [['all', 'For bookmarks and folders'], ['folders', 'For folders only'], ['none', 'Icons only']].map(([v, l]) => ({ label: l, checked: labelMode() === v, action: () => wb.invoke('settings:set', 'appearance.bookmarksBar.labels', v) })) },
      otherShown() ? null : { label: 'Show “Other bookmarks”', icon: 'folder', action: () => wb.invoke('settings:set', 'appearance.bookmarksBar.showOtherBookmarks', true) },
      '-',
      { label: 'Hide the bookmarks bar', icon: 'eye', action: () => emit('command', 'toggleBookmarksBar') },
      { label: 'Bookmark manager', icon: 'book', action: () => emit('command', 'openBookmarks') },
    ], { x: e.clientX, y: e.clientY });
  });
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const els = [...barEl.querySelectorAll('.bm-items > *')].filter((x) => x._bm); const more = barEl.querySelector('.bm-more'); if (more) fitBar(els, more); }, 80); });
}
