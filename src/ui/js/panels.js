// Bifrost browser UI — the side panel: bookmarks, history and downloads next to your tabs.
import { S, on, emit, activeTab, setting } from './state.js';
import { h, faviconEl, displayUrl, debounce, animate, fmtBytes, timeAgo } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './menus.js';
import * as T from './tabs.js';
import * as V from './views.js';
import { howFromEvent } from './results.js';

const wb = window.wb;
const panelEl = document.getElementById('panel');
let view = null;       // 'bookmarks' | 'history' | 'downloads' | 'ext:<extension id>' | null
let bodyEl, searchEl, tabsEl;
const VIEWS = { bookmarks: ['Bookmarks', 'book'], history: ['History', 'clock'], downloads: ['Downloads', 'download'] };
let extPanels = [];    // extensions with a side panel: [{ id, name, icon, url }]
let extShown = null;   // { id, url, el } of the extension page in the panel

function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem('wb.' + key)); return v == null ? fallback : v; } catch { return fallback; } }
function save(key, v) { try { localStorage.setItem('wb.' + key, JSON.stringify(v)); } catch { /* private storage */ } }

function build() {
  tabsEl = h('div.seg.panel-seg');
  searchEl = h('input.field.panel-search', { type: 'search', placeholder: 'Search', spellcheck: 'false' });
  searchEl.addEventListener('input', debounce(() => renderView(), 120));
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (searchEl.value) { searchEl.value = ''; renderView(); } else close(); } });
  bodyEl = h('div.panel-body');
  const closeBtn = h('button.icon-btn', { type: 'button', title: 'Close panel', onclick: () => close() }, icon('close'));
  const resizer = h('div.panel-resizer');
  resizer.addEventListener('pointerdown', startResize);
  panelEl.replaceChildren(h('div.panel-head.drag', null, tabsEl, h('div.tb-spacer'), closeBtn), h('div.panel-search-row', null, searchEl), bodyEl, resizer);
  panelEl.style.setProperty('--panel-w', load('panelWidth', 320) + 'px');
}

function startResize(e) {
  e.preventDefault();
  const shield = V.dragShield('col-resize');
  const startX = e.clientX;
  const startW = panelEl.getBoundingClientRect().width;
  const right = document.documentElement.dataset.side === 'right' && document.documentElement.dataset.layout === 'vertical';
  const move = (ev) => {
    const w = Math.max(240, Math.min(640, startW + (right ? startX - ev.clientX : ev.clientX - startX)));
    panelEl.style.setProperty('--panel-w', w + 'px');
  };
  const up = () => {
    shield.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    save('panelWidth', Math.round(panelEl.getBoundingClientRect().width));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function toggle(which) {
  if (view === which) { close(); return; }
  open(which);
}

export function open(which, { url } = {}) {
  if (!bodyEl) build();
  const ext = which.startsWith('ext:') ? extPanels.find((p) => 'ext:' + p.id === which) : null;
  if (!VIEWS[which] && !ext && !url) return;
  const was = view;
  view = which;
  document.documentElement.classList.add('panel-open');
  panelEl.classList.toggle('ext-view', which.startsWith('ext:'));
  renderTabs();
  if (which.startsWith('ext:')) {
    showExtension(which.slice(4), url || ext.url);
  } else {
    hideExtension();
    searchEl.value = '';
    searchEl.placeholder = 'Search ' + VIEWS[which][0].toLowerCase();
    renderView();
  }
  if (!was) animate(panelEl, [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' }, 'panels');
  for (const b of document.querySelectorAll('[data-panel]')) b.classList.toggle('on', b.dataset.panel === 'panel' + which[0].toUpperCase() + which.slice(1));
  emit('layout-changed');
}

export function close() {
  if (!view) return;
  view = null;
  hideExtension();
  panelEl.classList.remove('ext-view');
  document.documentElement.classList.remove('panel-open');
  for (const b of document.querySelectorAll('[data-panel]')) b.classList.remove('on');
  emit('layout-changed');
}

function renderTabs() {
  const builtIn = Object.entries(VIEWS).map(([k, [label, ic]]) => h('button.seg-btn' + (k === view ? '.on' : ''), { type: 'button', title: label, onclick: () => open(k) }, icon(ic), h('span', null, label)));
  const exts = extPanels.map((p) => {
    const img = h('img.panel-ext-ico', { src: p.icon || '', alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(h('span.panel-ext-ico.letter', null, (p.name || '?').charAt(0).toUpperCase())), { once: true });
    if (!p.icon) queueMicrotask(() => img.dispatchEvent(new Event('error')));
    return h('button.seg-btn.panel-ext' + ('ext:' + p.id === view ? '.on' : ''), { type: 'button', title: p.name, onclick: () => open('ext:' + p.id) }, img, h('span', null, p.name));
  });
  tabsEl.replaceChildren(...builtIn, ...exts);
}

function renderView() {
  if (!view || view.startsWith('ext:')) return;
  if (view === 'bookmarks') renderBookmarks();
  else if (view === 'history') renderHistory();
  else renderDownloads();
}

// ------------------------------------------------------- extension panels
// The extension's page runs in a <webview> of its own (not a tab); the main process is told first so it
// sets it up as an extension panel.
async function showExtension(id, url) {
  if (extShown && extShown.id === id && extShown.url === url) return;
  hideExtension();
  bodyEl.replaceChildren();
  const ok = await wb.invoke('extensions:side-panel-attach', id, url).catch(() => false);
  if (!ok || view !== 'ext:' + id) return;
  const wv = document.createElement('webview');
  wv.className = 'panel-webview';
  wv.setAttribute('partition', 'persist:main');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', url);
  extShown = { id, url, el: wv };
  bodyEl.append(wv);
  wb.send('extensions:side-panel-state', { id, path: new URL(url).pathname.slice(1), shown: true });
}

function hideExtension() {
  if (!extShown) return;
  const { id, url, el } = extShown;
  extShown = null;
  el.remove();
  wb.send('extensions:side-panel-state', { id, path: new URL(url).pathname.slice(1), shown: false });
}

// The side panel's extension page, if that's the webContents asking (for its context menu).
export function panelWebview(wcId) {
  if (!extShown) return null;
  try { return extShown.el.getWebContentsId() === wcId ? extShown.el : null; } catch { return null; }
}

// From the main process: an extension opened or closed its panel (chrome.sidePanel.open/close).
export function extensionPanel({ id, url, open: show }) {
  if (show) {
    if (!extPanels.some((p) => p.id === id)) extPanels.push({ id, name: id, icon: '', url });
    open('ext:' + id, { url });
    refreshExtensionPanels();
  } else if (view === 'ext:' + id) close();
}

export async function refreshExtensionPanels() {
  extPanels = await wb.invoke('extensions:side-panels').catch(() => []);
  if (!view) return;
  if (view.startsWith('ext:')) {
    const p = extPanels.find((x) => 'ext:' + x.id === view);
    if (!p) { close(); return; }
    if (extShown && extShown.url !== p.url) showExtension(p.id, p.url);
  }
  renderTabs();
}

function openUrl(url, e) {
  T.openUrl(url, { where: (e && howFromEvent(e)) || 'current', allowScript: true, opener: activeTab() });
}

function linkRow(url, title, favicon, extra = {}) {
  const row = h('div.p-row', { title: url }, faviconEl(url, favicon, icon, 'p-fav', { hi: true }), h('span.p-title', null, title || displayUrl(url) || url), extra.meta ? h('span.p-meta', null, extra.meta) : null, extra.actions || null);
  row.addEventListener('click', (e) => { if (!e.target.closest('button')) openUrl(url, e); });
  row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); T.openUrl(url, { where: 'background', opener: activeTab() }); } });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu([
      { label: 'Open', action: () => openUrl(url) },
      { label: 'Open in new tab', icon: 'plus', action: () => T.openUrl(url, { where: 'background' }) },
      { label: 'Open in new window', icon: 'window', action: () => T.openUrl(url, { where: 'window' }) },
      { label: 'Open in split view', icon: 'split', action: () => T.openUrl(url, { where: 'split' }) },
      '-',
      { label: 'Copy link', icon: 'link', action: () => navigator.clipboard.writeText(url).catch(() => {}) },
      ...(extra.menu || []),
    ], { x: e.clientX, y: e.clientY });
  });
  return row;
}

// ---------------------------------------------------------------- bookmarks
const expanded = new Set(load('panelExpanded', [2]));

async function renderBookmarks() {
  const q = searchEl.value.trim();
  if (q) {
    const found = await wb.invoke('bookmarks:search', q).catch(() => []);
    if (view !== 'bookmarks') return;
    bodyEl.replaceChildren(...(found.length ? found.slice(0, 200).map((b) => linkRow(b.url, b.title, b.favicon, { meta: (b.path || []).slice(-1)[0] || '' })) : [h('p.p-empty', null, 'No bookmarks match')]));
    return;
  }
  const tree = await wb.invoke('bookmarks:tree').catch(() => null);
  if (view !== 'bookmarks' || !tree) return;
  const draw = (node, depth) => {
    const out = [];
    for (const c of node.children || []) {
      if (c.type === 'separator') { out.push(h('div.p-sep', { style: { marginLeft: depth * 14 + 'px' } })); continue; }
      if (c.type === 'folder') {
        const open = expanded.has(c.id);
        const head = h('div.p-row.p-folder' + (open ? '.open' : ''), { style: { paddingLeft: 8 + depth * 14 + 'px' } }, h('span.p-chev', null, icon('chevronRight')), icon(open ? 'folderOpen' : 'folder'), h('span.p-title', null, c.title || 'Untitled folder'), h('span.p-meta', null, String((c.children || []).length)));
        head.addEventListener('click', () => { if (open) expanded.delete(c.id); else expanded.add(c.id); save('panelExpanded', [...expanded]); renderBookmarks(); });
        head.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const links = (c.children || []).filter((x) => x.type === 'bookmark');
          showMenu([
            { label: `Open all (${links.length})`, icon: 'layers', disabled: !links.length, action: () => links.forEach((l) => T.openTab({ url: l.url, active: false, position: 'end' })) },
            { label: 'Bookmark manager', icon: 'book', action: () => emit('command', 'openBookmarks') },
          ], { x: e.clientX, y: e.clientY });
        });
        out.push(head);
        if (open) out.push(...draw(c, depth + 1));
        continue;
      }
      const r = linkRow(c.url, c.title, c.favicon, { menu: ['-', { label: 'Delete bookmark', icon: 'trash', danger: true, action: () => wb.invoke('bookmarks:remove', c.id) }] });
      r.style.paddingLeft = 8 + depth * 14 + 18 + 'px';
      out.push(r);
    }
    return out;
  };
  const hideOther = setting('appearance.bookmarksBar.showOtherBookmarks') === false;
  const roots = (tree.children || []).filter((c) => (c.role !== 'mobile' && !(hideOther && c.role === 'other')) || (c.children || []).length);
  bodyEl.replaceChildren(...draw({ children: roots }, 0), h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openBookmarks') }, icon('book'), 'Bookmark manager'));
}

// ------------------------------------------------------------------ history
let histBefore = null, histLoading = false;

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (start(now) - start(d)) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

async function renderHistory(append = false) {
  if (histLoading) return;
  histLoading = true;
  const text = searchEl.value.trim();
  if (!append) histBefore = null;
  const rows = await wb.invoke('history:visits', { text, before: histBefore || Date.now() + 1, limit: 120 }).catch(() => []);
  histLoading = false;
  if (view !== 'history') return;
  if (!append) bodyEl.replaceChildren();
  bodyEl.querySelector('.p-more')?.remove();
  let lastDay = append ? bodyEl.dataset.lastDay : '';
  for (const v of rows) {
    const day = dayLabel(v.time);
    if (day !== lastDay) { bodyEl.append(h('div.p-day', null, day)); lastDay = day; }
    const del = h('button.icon-btn.p-del', { type: 'button', title: 'Remove from history', onclick: async (e) => { e.stopPropagation(); await wb.invoke('history:delete-visit', v.id); row.remove(); } }, icon('close'));
    const row = linkRow(v.url, v.title, v.favicon, { meta: new Date(v.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), actions: del, menu: ['-', { label: 'Remove from history', icon: 'trash', action: () => wb.invoke('history:delete-url', v.url).then(() => renderHistory()) }] });
    bodyEl.append(row);
  }
  bodyEl.dataset.lastDay = lastDay;
  if (!append && !rows.length) bodyEl.append(h('p.p-empty', null, text ? 'Nothing in your history matches' : 'Pages you visit show up here'));
  if (rows.length === 120) {
    histBefore = rows[rows.length - 1].time;
    bodyEl.append(h('button.link-btn.p-more', { type: 'button', onclick: () => renderHistory(true) }, 'Show more'));
  }
  if (!append) bodyEl.append(h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openHistory') }, icon('clock'), 'Full history'));
}

// ---------------------------------------------------------------- downloads
const warn = (e) => emit('toast', { text: e.message, iconName: 'warn' });
async function renderDownloads() {
  const text = searchEl.value.trim().toLowerCase();
  const list = (await wb.invoke('downloads:list').catch(() => [])).filter((d) => !text || (d.filename || '').toLowerCase().includes(text) || (d.url || '').toLowerCase().includes(text));
  if (view !== 'downloads') return;
  bodyEl.replaceChildren(...(list.length ? list.slice(0, 100).map((d) => {
    const row = h('div.p-row.p-dl', { title: d.path || d.url },
      h('span.p-dl-ico', null, icon('file')),
      h('div.p-dl-main', null, h('span.p-title', null, d.filename), h('small', null, d.state === 'completed' ? `${fmtBytes(d.total)} · ${timeAgo(d.ended || d.started)}` : d.state === 'progressing' ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : d.state)),
      d.state === 'completed' ? h('button.icon-btn', { type: 'button', title: 'Show in folder', onclick: (e) => { e.stopPropagation(); wb.invoke('downloads:action', d.id, 'show').catch(warn); } }, icon('folderOpen')) : null);
    if (d.state === 'completed') row.addEventListener('click', () => wb.invoke('downloads:action', d.id, 'open').catch(warn));
    return row;
  }) : [h('p.p-empty', null, 'No downloads')]),
  h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openDownloads') }, icon('download'), 'All downloads'));
}

export function init() {
  if (!S.isPrivate) {
    refreshExtensionPanels();
    wb.on('extensions-changed', () => refreshExtensionPanels());
  }
  on('bookmarks-changed', () => { if (view === 'bookmarks') renderBookmarks(); });
  wb.on('download-updated', debounce(() => { if (view === 'downloads') renderDownloads(); }, 400));
  on('panel', (which) => toggle(which));
}
