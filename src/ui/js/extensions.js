// Bifrost browser UI — extension buttons in the toolbar (pinned ones), and the extensions menu.
import { S, on, emit, activeTab, setting } from './state.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { showMenu, closeMenus } from './menus.js';

const wb = window.wb;
let state = { activeTabId: -1, actions: [] };
let list = [];
let observing = false;

async function refresh() {
  if (S.isPrivate) { render(); return; }
  try {
    const [st, ls] = await Promise.all([wb.crx('browserAction.getState'), wb.invoke('extensions:list')]);
    state = st || state;
    list = ls || [];
  } catch { /* extensions not ready yet */ }
  if (!observing) { observing = true; wb.crx('browserAction.addObserver').catch(() => {}); }
  render();
}

function infoFor(a) {
  const t = activeTab();
  const tabId = t && t.wcId != null ? t.wcId : -1;
  const tabInfo = a.tabs && tabId >= 0 ? a.tabs[tabId] || {} : {};
  return Object.assign({}, a, tabInfo, { tabId });
}

function iconUrl(a, info) {
  const q = new URLSearchParams({ tabId: String(info.tabId), partition: 'persist:main' });
  if (info.iconModified) q.set('t', String(info.iconModified));
  return `crx://extension-icon/${a.id}/32/2?${q}`;
}

async function activate(id, el, type = 'click') {
  // Some extensions have their toolbar button open their side panel instead of a popup.
  if (type === 'click') {
    const r = await wb.invoke('extensions:action-click', id, (el && el.__pressedAt) || 0).catch(() => null);
    if (r && (r.panel || r.justClosed)) return;
  }
  const r = el.getBoundingClientRect();
  const t = activeTab();
  wb.crx('browserAction.activate', {
    eventType: type, extensionId: id, tabId: t && t.wcId != null ? t.wcId : -1,
    alignment: 'bottom',
    anchorRect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
  }).catch((e) => emit('toast', { text: 'The extension couldn’t open: ' + e.message, iconName: 'warn' }));
}

// An extension's "open" shortcut (_execute_action): anchored to its toolbar button when it's pinned,
// otherwise to the extensions button.
export function activateById(id) {
  const box = document.getElementById('ext-actions');
  const el = (box && box.querySelector(`[data-ext="${CSS.escape(id)}"]`)) || (box && box.querySelector('.tb-btn:last-child'));
  if (el) activate(id, el);
}

function actionIcon(a, info, cls = 'ext-icon') {
  const img = h('img.' + cls, { alt: '', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(h('span.' + cls + '.letter', null, (info.title || a.name || '?').charAt(0).toUpperCase())), { once: true });
  img.src = iconUrl(a, info);
  return img;
}

function extMenu(ext, anchor) {
  const pinned = (setting('extensions.pinned') || []).includes(ext.id);
  showMenu([
    { type: 'header', label: ext.name },
    { label: pinned ? 'Unpin from toolbar' : 'Pin to toolbar', icon: 'pin', action: () => wb.invoke('extensions:pin', ext.id, !pinned) },
    ext.hasOptions ? { label: 'Options', icon: 'sliders', action: () => wb.invoke('extensions:options', ext.id) } : null,
    { label: 'Manage extensions', icon: 'puzzle', action: () => emit('command', 'openExtensions') },
    '-',
    { label: 'Remove…', icon: 'trash', danger: true, action: () => wb.invoke('extensions:remove', ext.id) },
  ], { anchor, side: 'bottom', align: 'end' });
}

function render() {
  const box = document.getElementById('ext-actions');
  if (!box) return;
  if (S.isPrivate) { box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  const enabled = new Map(list.filter((e) => e.enabled).map((e) => [e.id, e]));
  const actions = (state.actions || []).filter((a) => enabled.has(a.id));
  const pinned = (setting('extensions.pinned') || []).filter((id) => actions.some((a) => a.id === id));
  const buttons = pinned.map((id) => {
    const a = actions.find((x) => x.id === id);
    const info = infoFor(a);
    const ext = enabled.get(id);
    const b = h('button.tb-btn.ext-btn.no-drag', { type: 'button', title: info.title || ext.name, dataset: { ext: id } }, actionIcon(a, info));
    if (info.text) b.append(h('span.ext-badge', { style: { background: info.color || 'var(--red)' } }, info.text));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('pointerdown', () => { b.__pressedAt = Date.now(); });
    b.addEventListener('click', () => activate(id, b));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); extMenu(ext, b); });
    return b;
  });
  const puzzle = h('button.tb-btn.no-drag', { type: 'button', title: 'Extensions' }, icon('puzzle'));
  puzzle.addEventListener('mousedown', (e) => e.preventDefault());
  puzzle.addEventListener('click', () => puzzleMenu(puzzle, actions, enabled));
  box.replaceChildren(...buttons, puzzle);
}

function puzzleMenu(anchor, actions, enabled) {
  const pinnedIds = setting('extensions.pinned') || [];
  const rows = actions.map((a) => {
    const ext = enabled.get(a.id);
    const info = infoFor(a);
    const pinned = pinnedIds.includes(a.id);
    const pinBtn = h('button.ext-pin' + (pinned ? '.on' : ''), { type: 'button', title: pinned ? 'Unpin from toolbar' : 'Pin to toolbar' }, icon('pin'));
    pinBtn.addEventListener('click', (e) => { e.stopPropagation(); wb.invoke('extensions:pin', a.id, !pinned); closeMenus(); });
    const more = h('button.ext-pin', { type: 'button', title: 'More' }, icon('dots'));
    more.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); extMenu(ext, anchor); });
    const row = h('div.menu-item.ext-row', { role: 'menuitem', tabIndex: -1 }, h('span.mi-icon', null, actionIcon(a, info, 'ext-mini')), h('span.mi-label', null, ext ? ext.name : a.id), pinBtn, more);
    row.addEventListener('click', () => { closeMenus(); requestAnimationFrame(() => activate(a.id, anchor)); });
    row.addEventListener('mouseenter', () => row.classList.add('hot'));
    row.addEventListener('mouseleave', () => row.classList.remove('hot'));
    return { type: 'custom', el: row };
  });
  showMenu([
    { type: 'header', label: 'Extensions' },
    ...(rows.length ? rows : [{ label: 'No extensions yet', disabled: true }]),
    '-',
    { label: 'Get extensions from the Chrome Web Store', icon: 'external', action: () => emit('open-url', { url: 'https://chromewebstore.google.com/' }) },
    { label: 'Manage extensions', icon: 'puzzle', action: () => emit('command', 'openExtensions') },
  ], { anchor, side: 'bottom', align: 'end' }, { minWidth: 280 });
}

// The shadow under an extension's popup (the popup itself is a native view on top of this page, which
// can't draw outside its own rounded box), and its button shown as pressed while it's open.
let popupOpen = false;
function popupShadow(rect) {
  popupOpen = !!rect;
  let el = document.getElementById('ext-popup-shadow');
  document.querySelectorAll('.ext-btn.open').forEach((b) => b.classList.remove('open'));
  if (!rect) { if (el) { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 200); } return; }
  if (!el) { el = h('div#ext-popup-shadow', { 'aria-hidden': 'true' }); document.body.append(el); }
  Object.assign(el.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', borderRadius: rect.radius + 'px' });
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
  const btn = document.querySelector(`#ext-actions [data-ext="${CSS.escape(rect.id || '')}"]`);
  if (btn) btn.classList.add('open');
}

// Closes an open extension popup: when you switch tabs or spaces, or click anywhere else in the window.
// (Clicking its own button closes it too: the button then doesn't open it again, see activate.)
function closePopup(reason) { if (popupOpen) wb.send('ext-popup:close', reason); }

export function init() {
  if (S.isPrivate) return;
  wb.on('ext-popup', (rect) => popupShadow(rect));
  on('active', () => closePopup('switch'));
  on('workspace', () => closePopup('switch'));
  window.addEventListener('pointerdown', () => closePopup('pointer'), true);
  refresh();
  wb.on('browserAction.update', () => refresh());
  wb.on('extensions-changed', () => refresh());
  on('toolbar-built', () => render());
  on('active', () => render());
  on('settings', (path) => { if (!path || path.startsWith('extensions')) render(); });
}
