// Bifrost browser UI — spaces (workspaces): the switcher in the sidebar or tab bar, and the editor.
import { S, on, emit, curWs, wsTabs, accelFor, setting, WS_ICONS } from './state.js';
import { h, animate } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './menus.js';
import { dialog, confirmDialog } from './prompts.js';
import * as T from './tabs.js';
import { wsIconEl } from './tabstrip.js';
import * as TB from './toolbar.js';

const D = window.WBDefaults;

const sidebarTop = document.getElementById('sidebar-top');
const sidebarBottom = document.getElementById('sidebar-bottom');
const hbarEl = document.getElementById('hbar');
const WS_COLORS = ['#cba6f7', '#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#94e2d5', '#89b4fa', '#74c7ec', '#f5c2e7', '#b4befe'];

let wsBtn = null, wsName = null, wsIco = null, hWsBtn = null, strip = null;

// The sidebar's top row and bottom row hold whatever Settings → Appearance → Toolbar & sidebar
// puts there (appearance.sidebarTop / sidebarBottom); the toolbar's items work here too.
function sidebarItem(id, where) {
  if (id === 'workspace') {
    wsIco = h('span.wsb-ico');
    wsName = h('span.wsb-name');
    wsBtn = h('button#ws-button.wsb.no-drag', { type: 'button', title: 'Spaces' }, wsIco, wsName, h('span.wsb-chev', null, icon('chevronDown')));
    wsBtn.addEventListener('mousedown', (e) => e.preventDefault());
    wsBtn.addEventListener('click', () => wsMenu({ anchor: wsBtn, side: where === 'top' ? 'bottom' : 'top', align: 'start' }));
    wsBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); wsMenu({ x: e.clientX, y: e.clientY }, TB.placementItems(wsBtn, false)); });
    return wsBtn;
  }
  if (id === 'spaces') {
    strip = h('div.ws-strip');
    return strip;
  }
  return TB.makeItem(id, 'sidebar');
}

function fill(ids, where) {
  const seen = new Set();
  const nodes = [];
  for (const id of ids || []) {
    const meta = D.layoutItem(id);
    if (!meta || (seen.has(id) && !meta.multi)) continue;
    seen.add(id);
    const node = sidebarItem(id, where);
    if (node) nodes.push(node);
  }
  return nodes;
}

function build() {
  wsBtn = wsName = wsIco = strip = null;
  const top = fill(setting('appearance.sidebarTop'), 'top');
  // Private windows say so, right after the space button (or first).
  if (S.isPrivate) {
    const badge = h('span.private-badge', { title: 'Private window: history, cookies and site data are forgotten when you close it' }, icon('mask'), h('span', null, 'Private'));
    top.splice(wsBtn ? top.indexOf(wsBtn) + 1 : 0, 0, badge);
  }
  sidebarTop.replaceChildren(...top);
  const bottom = fill(setting('appearance.sidebarBottom'), 'bottom');
  sidebarBottom.replaceChildren(...bottom);
  sidebarBottom.classList.toggle('empty', !bottom.length);
  sidebarBottom.classList.toggle('has-strip', !!strip);
  TB.placeCaption();
  for (const el of [sidebarTop, sidebarBottom]) {
    el.oncontextmenu = (e) => {
      if (e.target.closest('.ws-dot, .wsb, [data-tb]')) return;
      e.preventDefault();
      TB.customizeMenu({ x: e.clientX, y: e.clientY });
    };
  }

  // Horizontal tab bar: a compact space button at the start.
  if (!hWsBtn) {
    hWsBtn = h('button#hws-button.tb-btn.no-drag', { type: 'button', title: 'Spaces', dataset: { wsDrop: '' } });
    hWsBtn.addEventListener('mousedown', (e) => e.preventDefault());
    hWsBtn.addEventListener('click', () => wsMenu({ anchor: hWsBtn, side: 'bottom', align: 'start' }));
    hbarEl.prepend(hWsBtn);
  }
}

function render() {
  const ws = curWs();
  if (!ws) return;
  if (wsBtn) {
    wsIco.replaceChildren(wsIconEl(ws));
    wsName.textContent = ws.name;
    wsBtn.style.setProperty('--wc', ws.color || 'var(--accent)');
  }
  hWsBtn.replaceChildren(wsIconEl(ws));
  hWsBtn.title = `Space: ${ws.name}`;
  hWsBtn.dataset.wsDrop = ws.id;
  hWsBtn.hidden = S.workspaces.length < 2 && !setting('workspaces.showSwitcher');
  if (!strip) return;
  strip.replaceChildren(...S.workspaces.map((w, i) => {
    const n = wsTabs(w.id).length;
    const b = h('button.ws-dot.no-drag' + (w.id === S.activeWorkspaceId ? '.on' : ''), {
      type: 'button', title: `${w.name} · ${n} tab${n === 1 ? '' : 's'}${i < 9 ? ' (' + accelFor('workspace' + (i + 1)) + ')' : ''}`,
      dataset: { wsDrop: w.id }, style: w.color ? { '--wc': w.color } : null,
    }, wsIconEl(w));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => T.switchWorkspace(w.id));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); wsItemMenu(w, { x: e.clientX, y: e.clientY }); });
    return b;
  }), (() => {
    const add = h('button.ws-dot.add.no-drag', { type: 'button', title: 'New space' }, icon('plus'));
    add.addEventListener('mousedown', (e) => e.preventDefault());
    add.addEventListener('click', () => newWorkspace());
    return add;
  })());
}

function wsMenu(pos, extra = null) {
  const cur = curWs();
  const items = S.workspaces.map((w, i) => ({
    label: w.name, iconEl: wsIconEl(w), checked: w === cur, sub: String(wsTabs(w.id).length),
    accel: i < 9 ? accelFor('workspace' + (i + 1)) : '',
    action: () => T.switchWorkspace(w.id),
  }));
  showMenu([
    { type: 'header', label: 'Spaces' },
    ...items,
    '-',
    { label: 'New space…', icon: 'plus', action: () => newWorkspace() },
    { label: `Edit “${cur.name}”…`, icon: 'edit', action: () => editWorkspace(cur) },
    S.workspaces.length > 1 ? { label: `Delete “${cur.name}”…`, icon: 'trash', danger: true, action: () => deleteWorkspace(cur) } : null,
    ...(extra ? ['-', ...extra] : []),
  ], pos, { minWidth: 240 });
}

function wsItemMenu(w, pos) {
  const i = S.workspaces.indexOf(w);
  showMenu([
    { label: 'Switch to it', icon: 'layers', action: () => T.switchWorkspace(w.id) },
    { label: 'Edit…', icon: 'edit', action: () => editWorkspace(w) },
    i > 0 ? { label: 'Move up', icon: 'chevronLeft', action: () => { S.workspaces.splice(i, 1); S.workspaces.splice(i - 1, 0, w); emit('structure'); emit('workspace', curWs(), curWs()); } } : null,
    i < S.workspaces.length - 1 ? { label: 'Move down', icon: 'chevronRight', action: () => { S.workspaces.splice(i, 1); S.workspaces.splice(i + 1, 0, w); emit('structure'); emit('workspace', curWs(), curWs()); } } : null,
    '-',
    S.workspaces.length > 1 ? { label: 'Delete…', icon: 'trash', danger: true, action: () => deleteWorkspace(w) } : null,
  ], pos);
}

// The editor: name, icon (or emoji) and color.
async function workspaceDialog(w, { title, ok }) {
  const name = h('input.field', { type: 'text', autofocus: true, 'data-select': '', placeholder: 'Name' });
  name.value = w.name || '';
  let pickedIcon = w.icon || 'compass';
  let pickedColor = w.color || null;
  const emoji = h('input.field.emoji-field', { type: 'text', maxlength: '4', placeholder: '😀', title: 'Or type an emoji' });
  if (!/^[a-zA-Z]+$/.test(pickedIcon)) emoji.value = pickedIcon;
  const icons = h('div.icon-grid');
  const drawIcons = () => icons.replaceChildren(...WS_ICONS.map((n) => h('button.icon-pick' + (n === pickedIcon ? '.on' : ''), { type: 'button', title: n, onclick: () => { pickedIcon = n; emoji.value = ''; drawIcons(); } }, icon(n))));
  drawIcons();
  emoji.addEventListener('input', () => { if (emoji.value.trim()) { pickedIcon = emoji.value.trim(); drawIcons(); } });
  const colors = h('div.swatches');
  const drawColors = () => colors.replaceChildren(
    h('button.swatch.none' + (!pickedColor ? '.on' : ''), { type: 'button', title: 'Theme accent', onclick: () => { pickedColor = null; drawColors(); } }),
    ...WS_COLORS.map((c) => h('button.swatch' + (c === pickedColor ? '.on' : ''), { type: 'button', title: c, style: { '--c': c }, onclick: () => { pickedColor = c; drawColors(); } })));
  drawColors();
  const body = h('div.form', null,
    h('label.dialog-field', null, h('span', null, 'Name'), name),
    h('div.dialog-field', null, h('span', null, 'Icon'), h('div.icon-row', null, icons, emoji)),
    h('div.dialog-field', null, h('span', null, 'Color'), colors),
    setting('appearance.workspaceAccents') ? h('p.muted.small', null, 'The color tints the browser while you’re in this space.') : null);
  const r = await dialog({ title, iconName: 'layers', body, buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true, value: () => ({ name: name.value.trim() || w.name || 'Space', icon: pickedIcon, color: pickedColor }) }], width: 440 });
  return r;
}

export async function newWorkspace({ tabs = null } = {}) {
  const r = await workspaceDialog({ name: `Space ${S.workspaces.length + 1}`, icon: WS_ICONS[S.workspaces.length % WS_ICONS.length] }, { title: 'New space', ok: 'Create' });
  if (!r) return null;
  const w = T.addWorkspace(r, { switchTo: !tabs });
  if (tabs) for (const t of tabs) T.moveTabToWorkspace(t, w.id);
  return w;
}

async function editWorkspace(w) {
  const r = await workspaceDialog(w, { title: 'Edit space', ok: 'Save' });
  if (!r) return;
  Object.assign(w, r);
  emit('structure');
  emit('workspace', curWs(), curWs());
}

async function deleteWorkspace(w) {
  const n = wsTabs(w.id).length;
  if (n && !(await confirmDialog(`Delete “${w.name}”?`, { detail: `Its ${n} tab${n === 1 ? '' : 's'} will close. You can reopen them from History.`, ok: 'Delete space', danger: true }))) return;
  T.removeWorkspace(w.id);
}

export function init() {
  build();
  render();
  on('workspace', (ws, prev) => {
    render();
    if (prev && ws && prev !== ws && wsBtn) animate(wsBtn, [{ opacity: 0.4, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 200 }, 'workspaceSwitch');
  });
  on('structure', () => render());
  on('settings', (p) => {
    if (!p || p === 'appearance' || p.startsWith('appearance.sidebarTop') || p.startsWith('appearance.sidebarBottom') || p.startsWith('keyboard')) { build(); render(); TB.update(); emit('toolbar-built'); }
    else if (p.startsWith('workspaces')) render();
  });
  on('new-workspace', (opts) => newWorkspace(opts || {}));
}
