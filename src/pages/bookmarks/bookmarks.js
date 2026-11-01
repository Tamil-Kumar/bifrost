// Bifrost — the bookmark manager: folders on the left, contents on the right, drag to reorganize.
import { boot, wb, h, icon, get, faviconEl, displayUrl, debounce, showMenu, dialog, confirmDialog, promptDialog, toast, openUrl } from '/_/common/page.js';

const BAR = 2;
let tree = null;
let current = BAR;                    // folder being shown
const open = new Set(JSON.parse(localStorageGet('bm.open') || '[1,2,3]'));
let treeEl, listEl, crumbsEl, search;
let dragId = null;

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage off */ } }

function index(node, map = new Map(), parent = null) {
  map.set(node.id, Object.assign(node, { _parent: parent }));
  for (const c of node.children || []) index(c, map, node);
  return map;
}
let byId = new Map();

async function load() {
  tree = await wb.invoke('bookmarks:tree');
  byId = index(tree);
  if (!byId.has(current)) current = BAR;
  render();
}

// ------------------------------------------------------------------ tree
function renderTree() {
  const rowFor = (n, depth) => {
    if (n.type !== 'folder') return [];
    const kids = (n.children || []).filter((c) => c.type === 'folder');
    const isOpen = open.has(n.id);
    const row = h('div.tnode' + (n.id === current ? '.on' : ''), { style: { paddingLeft: 8 + depth * 16 + 'px' }, dataset: { id: String(n.id) } },
      h('button.tchev' + (kids.length ? '' : '.none') + (isOpen ? '.open' : ''), { type: 'button', onclick: (e) => { e.stopPropagation(); if (isOpen) open.delete(n.id); else open.add(n.id); localStorageSet('bm.open', JSON.stringify([...open])); renderTree(); } }, icon('chevronRight')),
      icon(n.role === 'bar' ? 'star' : n.role === 'mobile' ? 'monitor' : isOpen && kids.length ? 'folderOpen' : 'folder'),
      h('span.tname', null, n.title || 'Untitled'),
      h('span.tcount', null, String((n.children || []).length)));
    row.addEventListener('click', () => { current = n.id; search.value = ''; render(); });
    dropTarget(row, () => ({ parentId: n.id }));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(n, { x: e.clientX, y: e.clientY }); });
    const out = [row];
    if (isOpen) for (const c of kids) out.push(...rowFor(c, depth + 1));
    return out;
  };
  // "Other bookmarks" can be removed in Settings; it stays out of sight while it's empty.
  const hideOther = get('appearance.bookmarksBar.showOtherBookmarks') === false;
  const roots = (tree.children || []).filter((c) => !(hideOther && c.role === 'other' && !(c.children || []).length));
  treeEl.replaceChildren(...roots.flatMap((c) => rowFor(c, 0)));
}

// ------------------------------------------------------------------ list
function crumbs() {
  const parts = [];
  for (let n = byId.get(current); n && n._parent; n = n._parent) parts.unshift(n);
  crumbsEl.replaceChildren(...parts.flatMap((n, i) => [
    i ? h('span.sep', null, icon('chevronRight')) : null,
    h('button.crumb', { type: 'button', onclick: () => { current = n.id; render(); } }, n.title || 'Untitled'),
  ]).filter(Boolean));
}

async function renderList() {
  const q = search.value.trim();
  let items;
  if (q) {
    items = (await wb.invoke('bookmarks:search', q)).map((b) => Object.assign({ type: 'bookmark' }, b));
    crumbsEl.replaceChildren(h('span.muted', null, `${items.length} bookmark${items.length === 1 ? '' : 's'} matching “${q}”`));
  } else {
    items = (byId.get(current) || { children: [] }).children || [];
    crumbs();
  }
  if (!items.length) { listEl.replaceChildren(h('div.empty-state', null, icon('star'), h('div', null, q ? 'No bookmarks match.' : 'This folder is empty.'))); return; }
  listEl.replaceChildren(...items.map((b) => itemRow(b, !!q)));
}

function itemRow(b, flat) {
  let el;
  if (b.type === 'separator') {
    el = h('div.li.bsep', { draggable: 'true', dataset: { id: String(b.id) } }, h('span.sepline'));
  } else if (b.type === 'folder') {
    el = h('div.li.bfolder', { draggable: 'true', dataset: { id: String(b.id) }, tabIndex: 0 },
      h('span.bico', null, icon('folder')),
      h('div.li-main', null, h('span.li-title', null, b.title || 'Untitled'), h('span.li-sub', null, `${(b.children || []).length} items`)),
      actions(b));
    el.addEventListener('dblclick', () => { current = b.id; render(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { current = b.id; render(); } });
  } else {
    el = h('div.li', { draggable: 'true', dataset: { id: String(b.id) } },
      faviconEl(b.url, b.favicon, icon, 'fav', { hi: true }),
      h('a.li-main', { href: b.url, title: b.url, draggable: 'false' }, h('span.li-title', null, b.title || displayUrl(b.url)), h('span.li-sub', null, flat && b.path ? b.path.join(' › ') + ' · ' + displayUrl(b.url) : displayUrl(b.url))),
      actions(b));
  }
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(b, { x: e.clientX, y: e.clientY }); });
  if (!flat) {
    el.addEventListener('dragstart', (e) => { dragId = b.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.url || b.title || ''); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; clearMarks(); });
    dropTarget(el, (e) => {
      const r = el.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (b.type === 'folder' && y > 0.25 && y < 0.75) return { parentId: b.id };
      return { parentId: current, index: b.index + (y >= 0.5 ? 1 : 0) };
    });
  }
  return el;
}

function actions(b) {
  return h('div.li-actions', null,
    h('button.icon-btn', { type: 'button', title: 'Edit', onclick: (e) => { e.stopPropagation(); edit(b); } }, icon('edit')),
    h('button.icon-btn', { type: 'button', title: 'Delete', onclick: (e) => { e.stopPropagation(); remove(b); } }, icon('trash')));
}

function clearMarks() { for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into'); }

function dropTarget(el, where) {
  el.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    const w = where(e);
    if (w.parentId === dragId) return;
    e.preventDefault();
    clearMarks();
    if (w.index == null) el.classList.add('drop-into');
    else el.classList.add((e.clientY - el.getBoundingClientRect().top) / el.getBoundingClientRect().height >= 0.5 ? 'drop-after' : 'drop-before');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
  el.addEventListener('drop', async (e) => {
    if (dragId == null) return;
    e.preventDefault();
    const w = where(e);
    const id = dragId;
    clearMarks();
    try { await wb.invoke('bookmarks:move', id, w); } catch (err) { toast({ text: err.message, iconName: 'warn' }); }
  });
}

// -------------------------------------------------------------- actions
async function edit(b) {
  if (b.role) return;
  const name = h('input.field', { type: 'text', autofocus: true });
  name.value = b.title || '';
  const url = h('input.field.mono', { type: 'text', spellcheck: 'false' });
  url.value = b.url || '';
  const ok = await dialog({ title: b.type === 'folder' ? 'Edit folder' : 'Edit bookmark', iconName: 'edit', width: 480, dismissValue: false,
    body: h('div.form', null, h('label.dialog-field', null, h('span', null, 'Name'), name), b.type === 'bookmark' ? h('label.dialog-field', null, h('span', null, 'Address'), url) : null),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (ok) await wb.invoke('bookmarks:update', b.id, { title: name.value, url: b.type === 'bookmark' ? url.value.trim() : undefined }).catch((e) => toast({ text: e.message, iconName: 'warn' }));
}

async function remove(b) {
  if (b.role) return;
  if (b.type === 'folder' && (b.children || []).length && !(await confirmDialog(`Delete “${b.title}” and everything in it?`, { ok: 'Delete', danger: true }))) return;
  await wb.invoke('bookmarks:remove', b.id);
  toast({ text: `Deleted “${b.title || displayUrl(b.url) || 'separator'}”`, iconName: 'trash' });
}

function openAll(folder, how = { background: true }) {
  const links = (folder.children || []).filter((c) => c.type === 'bookmark');
  links.forEach((l) => openUrl(l.url, how));
}

function itemMenu(b, pos) {
  const link = b.type === 'bookmark';
  showMenu([
    link ? { label: 'Open', icon: 'globe', action: () => openUrl(b.url, {}) } : { label: 'Open folder', icon: 'folderOpen', action: () => { current = b.id; render(); } },
    link ? { label: 'Open in new tab', icon: 'plus', action: () => openUrl(b.url, { background: true }) } : { label: 'Open all in tabs', icon: 'layers', action: () => openAll(b) },
    link ? { label: 'Open in new window', icon: 'window', action: () => openUrl(b.url, { newWindow: true }) } : null,
    link ? { label: 'Copy link', icon: 'link', action: () => navigator.clipboard.writeText(b.url) } : null,
    '-',
    !b.role ? { label: 'Edit…', icon: 'edit', action: () => edit(b) } : null,
    !b.role ? { label: 'Delete', icon: 'trash', danger: true, action: () => remove(b) } : null,
    b.type === 'folder' ? '-' : null,
    b.type === 'folder' ? { label: 'New bookmark here…', icon: 'star', action: () => { current = b.id; newBookmark(); } } : null,
    b.type === 'folder' ? { label: 'New folder here…', icon: 'folder', action: () => { current = b.id; newFolder(); } } : null,
    b.type === 'folder' ? { label: 'Sort by name', icon: 'menu', action: () => sortFolder(b) } : null,
  ], pos);
}

async function newBookmark() {
  const name = h('input.field', { type: 'text', autofocus: true, placeholder: 'Name' });
  const url = h('input.field.mono', { type: 'text', spellcheck: 'false', placeholder: 'https://…' });
  const ok = await dialog({ title: 'New bookmark', iconName: 'star', width: 480, dismissValue: false,
    body: h('div.form', null, h('label.dialog-field', null, h('span', null, 'Name'), name), h('label.dialog-field', null, h('span', null, 'Address'), url)),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }] });
  if (!ok || !url.value.trim()) return;
  let u = url.value.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  await wb.invoke('bookmarks:create', { parentId: current, title: name.value.trim() || u, url: u }).catch((e) => toast({ text: e.message, iconName: 'warn' }));
}

async function newFolder() {
  const name = await promptDialog({ title: 'New folder', value: 'New folder', ok: 'Create' });
  if (name) await wb.invoke('bookmarks:create', { parentId: current, title: name, type: 'folder' });
}

// Folders first, then A–Z: moving each item to the end in sorted order leaves the folder sorted.
async function sortFolder(f) {
  const kids = (f.children || []).filter((c) => c.type !== 'separator').slice()
    .sort((a, b) => (b.type === 'folder') - (a.type === 'folder') || (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  for (const k of kids) await wb.invoke('bookmarks:move', k.id, { parentId: f.id }).catch(() => {});
}

function render() { renderTree(); renderList(); }

// ---------------------------------------------------------------- start
await boot({ title: 'Bookmarks', onSettings: (p) => { if (!p || p.startsWith('appearance.bookmarksBar')) { if (tree) renderTree(); } } });
search = h('input.field', { type: 'search', placeholder: 'Search bookmarks', spellcheck: 'false' });
treeEl = h('nav.btree');
listEl = h('div.blist');
crumbsEl = h('div.crumbs');
document.body.append(h('div.pg', null,
  h('header.pg-head', null,
    h('h1.pg-title', null, h('span.pg-ico', null, icon('star')), 'Bookmarks'),
    h('div.pg-spacer'),
    h('label.pg-search', null, icon('search'), search),
    h('button.btn', { type: 'button', onclick: newBookmark }, icon('plus'), 'Bookmark'),
    h('button.btn', { type: 'button', onclick: newFolder }, icon('folder'), 'Folder'),
    h('button.icon-btn', { type: 'button', title: 'Import and export', onclick: (e) => showMenu([
      { label: 'Import a bookmarks file…', icon: 'import', action: async () => { try { const r = await wb.invoke('import:html'); if (r) toast({ text: `Imported ${r.bookmarks} bookmarks`, iconName: 'check' }); } catch (err) { toast({ text: err.message, iconName: 'warn' }); } } },
      { label: 'Import from another browser…', icon: 'compass', action: () => openUrl('bifrost://settings/#import', {}) },
      { label: 'Export bookmarks…', icon: 'save', action: () => wb.invoke('bookmarks:export-html') },
    ], { anchor: e.currentTarget, side: 'bottom', align: 'end' }) }, icon('dotsH'))),
  h('div.pg-body', null, treeEl, h('div', null, crumbsEl, listEl))));
search.addEventListener('input', debounce(renderList, 120));
await load();
wb.on('bookmarks-changed', debounce(load, 60));
