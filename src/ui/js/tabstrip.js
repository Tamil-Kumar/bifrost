// Bifrost browser UI — the tab strip: vertical (sidebar) or horizontal, pinned tabs, groups,
// split-view pairs, drag and drop, hover previews and tab context menus.
import {
  S, on, emit, wsTabs, activeTab, visibleTabs, groupById, splitOf, tabById, setting, accelFor, groupTabs,
  createGroup, addToGroup, removeFromGroup, ungroup, moveTab, GROUP_COLORS,
} from './state.js';
import * as T from './tabs.js';
import * as V from './views.js';
import { h, faviconEl, displayUrl, hostOf, syncChildren, animate, anim, flip, copyText, isNewTab } from './util.js';
import { icon } from './icons.js';
import { showMenu, popover, place } from './menus.js';
import { confirmDialog, toast } from './prompts.js';

const wb = window.wb;
const pinnedEl = document.getElementById('pinned');
const tablistEl = document.getElementById('tablist');
const tablistWrap = document.getElementById('tablist-wrap');
const hbarEl = document.getElementById('hbar');
let htabsEl, hscrollEl, hnewBtn, newRow;

const tabEls = new Map();    // tab id -> element
const groupEls = new Map();  // group id -> { el, head, inner, title, count, chip, chipTitle }
const selection = new Set(); // multi-selected tab ids (Ctrl/Shift+click)
let lastClicked = null;

const mode = () => (S.settings.appearance.tabLayout === 'horizontal' ? 'h' : 'v');

// --------------------------------------------------------------- elements
function tabEl(t) {
  let el = tabEls.get(t.id);
  if (el) return el;
  const fav = h('span.tab-fav');
  const title = h('span.tab-title');
  const audio = h('button.tab-audio', { tabIndex: -1, type: 'button' });
  const close = h('button.tab-close', { tabIndex: -1, type: 'button', title: 'Close tab' }, icon('close'));
  el = h('div.tab', { role: 'tab', dataset: { id: t.id } }, h('span.tab-icon', null, fav, h('span.tab-spinner')), title, audio, close);
  el._fav = fav; el._title = title; el._audio = audio;
  el.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 1) e.preventDefault(); });
  el.addEventListener('pointerdown', (e) => onTabDown(e, t));
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && setting('tabs.middleClickCloses')) { e.preventDefault(); closeFromStrip(t); } });
  el.addEventListener('dblclick', (e) => { if (setting('tabs.doubleClickToClose') && !e.target.closest('button')) closeFromStrip(t); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); tabMenu(t, { x: e.clientX, y: e.clientY }); });
  close.addEventListener('pointerdown', (e) => e.stopPropagation());
  close.addEventListener('click', (e) => { e.stopPropagation(); closeFromStrip(t); });
  audio.addEventListener('pointerdown', (e) => e.stopPropagation());
  audio.addEventListener('click', (e) => { e.stopPropagation(); T.toggleMute(t); });
  el.addEventListener('pointerenter', () => previewSoon(t, el));
  el.addEventListener('pointerleave', () => previewLeave());
  // Links and text dropped from pages or other apps.
  el.addEventListener('dragover', (e) => { if (droppableUrl(e)) { e.preventDefault(); el.classList.add('drop-target'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => { el.classList.remove('drop-target'); const url = droppedUrl(e); if (url) { e.preventDefault(); e.stopPropagation(); V.loadUrl(t, url); T.selectTab(t); } });
  tabEls.set(t.id, el);
  if (S.ready && anim('tabOpenClose')) {
    el.classList.add('entering');
    // (A new tab in front of a full, scrolling strip grows into place: bring it into view once it has.)
    el.addEventListener('animationend', () => { el.classList.remove('entering'); if (t === activeTab()) scrollToActive(); }, { once: true });
  }
  return el;
}

function updateTab(t) {
  const el = tabEl(t);
  const act = activeTab();
  const vis = visibleTabs();
  el.classList.toggle('active', t === act);
  el.classList.toggle('in-view', t !== act && vis.includes(t));
  el.classList.toggle('pinned', !!t.pinned);
  const wasLoading = el.classList.contains('loading');
  el.classList.toggle('loading', !!t.loading && !t.crashed);
  // A page that just finished loading: its icon pops back in (Animations → Loading spinners and bars).
  if (wasLoading && !t.loading && !t.crashed && anim('loadingIndicator') && el._fav) animate(el._fav, [{ transform: 'scale(.55)', opacity: 0.4 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }, 'loadingIndicator');
  el.classList.toggle('asleep', !t.wv);
  el.classList.toggle('audible', !!t.audible);
  el.classList.toggle('is-muted', !!t.muted);
  el.classList.toggle('broken', !!(t.crashed || t.error));
  el.classList.toggle('attention', !!t.attention && t !== act);
  el.classList.toggle('selected', selection.has(t.id));
  const title = t.title || displayUrl(t.pendingUrl || t.url) || 'New tab';
  if (el._title.textContent !== title) el._title.textContent = title;
  el.setAttribute('aria-selected', t === act ? 'true' : 'false');
  el.setAttribute('aria-label', title);
  if (t.pinned) el.title = title; else el.removeAttribute('title');
  const favKey = (t.url || '') + '|' + (t.favicon || '');
  if (el._favKey !== favKey) { el._favKey = favKey; el._fav.replaceChildren(faviconEl(t.url, t.favicon, icon)); }
  // (Settings → Tabs → "Show which tabs are playing sound" off: no speaker on them; a muted tab still says so.)
  const audioIcon = t.muted ? 'volumeOff' : t.audible && setting('tabs.showAudioIndicator') !== false ? 'volume' : '';
  if (el._audioIcon !== audioIcon) {
    el._audioIcon = audioIcon;
    el._audio.replaceChildren(...(audioIcon ? [icon(audioIcon)] : []));
    el._audio.title = t.muted ? 'Unmute tab' : 'Mute tab';
  }
  const g = groupById(t.groupId);
  if (g) el.style.setProperty('--g', `var(--${g.color})`); else el.style.removeProperty('--g');
  el.classList.toggle('grouped', !!g);
  return el;
}

function groupEl(g) {
  let ge = groupEls.get(g.id);
  if (!ge) {
    const title = h('span.group-title');
    const count = h('span.group-count');
    const head = h('div.group-head', { role: 'button', tabIndex: -1 }, h('span.group-dot'), title, count, h('span.group-chev', null, icon('chevronDown')));
    const inner = h('div.group-inner');
    const el = h('div.group', { dataset: { group: g.id } }, head, h('div.group-body', null, inner));
    const chipTitle = h('span.hgroup-title');
    const chip = h('div.hgroup', { dataset: { group: g.id }, role: 'button' }, chipTitle);
    for (const target of [head, chip]) {
      target.addEventListener('mousedown', (e) => e.preventDefault());
      target.addEventListener('click', () => toggleGroup(g));
      target.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); groupMenu(g, { x: e.clientX, y: e.clientY }, target); });
    }
    title.addEventListener('dblclick', (e) => { e.stopPropagation(); editGroup(g, head); });
    ge = { el, head, inner, title, count, chip, chipTitle };
    groupEls.set(g.id, ge);
  }
  ge.el.style.setProperty('--g', `var(--${g.color})`);
  ge.chip.style.setProperty('--g', `var(--${g.color})`);
  ge.title.textContent = g.title || '';
  ge.title.classList.toggle('empty', !g.title);
  ge.chipTitle.textContent = g.title || '';
  ge.chip.classList.toggle('empty', !g.title);
  const n = groupTabs(g).length;
  ge.count.textContent = String(n);
  ge.el.classList.toggle('collapsed', !!g.collapsed);
  ge.chip.classList.toggle('collapsed', !!g.collapsed);
  ge.chip.title = (g.title || 'Group') + ` · ${n} tab${n === 1 ? '' : 's'}` + (g.collapsed ? ' (collapsed)' : '');
  const hasActive = groupTabs(g).includes(activeTab());
  ge.el.classList.toggle('has-active', hasActive);
  ge.chip.classList.toggle('has-active', hasActive);
  return ge;
}

function ensureHbar() {
  if (htabsEl) return;
  htabsEl = h('div#htabs', { role: 'tablist', 'aria-label': 'Tabs' });
  hscrollEl = h('div#htabs-scroll.no-drag', null, htabsEl);
  hnewBtn = h('button.htab-new.no-drag', { title: 'New tab (' + accelFor('newTab') + ')', onclick: () => emit('command', 'newTab', { source: 'button' }) }, icon('plus'));
  hscrollEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { hscrollEl.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  hscrollEl.addEventListener('dblclick', (e) => { if (e.target === hscrollEl || e.target === htabsEl) emit('command', 'newTab', { source: 'button' }); });
  hscrollEl.addEventListener('contextmenu', (e) => { if (e.target === hscrollEl || e.target === htabsEl) { e.preventDefault(); stripMenu({ x: e.clientX, y: e.clientY }); } });
  hbarEl.addEventListener('pointerleave', unfreeze);
  // [space button] [tabs…] [drag area] [window buttons]
  const ws = document.getElementById('hws-button');
  if (ws) ws.after(hscrollEl, h('div.hbar-drag')); else hbarEl.prepend(hscrollEl, h('div.hbar-drag'));
  for (const el of [hscrollEl, tablistWrap]) {
    el.addEventListener('dragover', (e) => { if (droppableUrl(e)) e.preventDefault(); });
    el.addEventListener('drop', (e) => { const url = droppedUrl(e); if (url) { e.preventDefault(); T.openTab({ url, position: 'end' }); } });
  }
}

// ----------------------------------------------------------------- render
export function render() {
  ensureHbar();
  const list = wsTabs();
  for (const t of list) updateTab(t);
  markSplits(list);
  for (const g of S.groups) if (g.workspaceId === S.activeWorkspaceId) groupEl(g);
  if (mode() === 'v') {
    syncChildren(pinnedEl, list.filter((t) => t.pinned).map(tabEl));
    const items = [];
    const kids = new Map();
    for (const t of list) {
      if (t.pinned) continue;
      const g = groupById(t.groupId);
      if (g) {
        const ge = groupEls.get(g.id);
        if (!kids.has(g.id)) { kids.set(g.id, []); items.push(ge.el); }
        kids.get(g.id).push(tabEl(t));
      } else items.push(tabEl(t));
    }
    items.push(newTabRow());
    syncChildren(tablistEl, items);
    for (const [gid, els] of kids) syncChildren(groupEls.get(gid).inner, els);
    syncChildren(htabsEl, []);
    pinnedEl.classList.toggle('empty', !list.some((t) => t.pinned));
  } else {
    const items = [];
    const seen = new Set();
    for (const t of list) {
      const g = groupById(t.groupId);
      if (g && !seen.has(g.id)) { seen.add(g.id); items.push(groupEls.get(g.id).chip); }
      if (g && g.collapsed && t !== activeTab()) continue;
      items.push(tabEl(t));
    }
    items.push(hnewBtn);
    syncChildren(htabsEl, items);
    syncChildren(pinnedEl, []);
    syncChildren(tablistEl, []);
  }
  // Forget elements of tabs and groups that no longer exist.
  const ids = new Set(S.tabs.map((t) => t.id));
  for (const [id, el] of tabEls) if (!ids.has(id) && !el.dataset.leaving) { el.remove(); tabEls.delete(id); }
  const gids = new Set(S.groups.map((g) => g.id));
  for (const [id, ge] of groupEls) if (!gids.has(id)) { ge.el.remove(); ge.chip.remove(); groupEls.delete(id); }
  for (const id of [...selection]) if (!ids.has(id) || tabById(id).workspaceId !== S.activeWorkspaceId) selection.delete(id);
}

function markSplits(list) {
  for (let i = 0; i < list.length; i++) {
    const t = list[i], el = tabEls.get(t.id);
    const prev = list[i - 1], next = list[i + 1];
    const sp = t.splitId;
    el.classList.toggle('split', !!sp);
    el.classList.toggle('split-first', !!sp && (!prev || prev.splitId !== sp) && next && next.splitId === sp);
    el.classList.toggle('split-mid', !!sp && prev && prev.splitId === sp && next && next.splitId === sp);
    el.classList.toggle('split-last', !!sp && prev && prev.splitId === sp && (!next || next.splitId !== sp));
  }
}

function newTabRow() {
  if (!newRow) {
    newRow = h('div.newtab-row', { role: 'button', title: 'New tab (' + accelFor('newTab') + ')' }, h('span.tab-icon', null, icon('plus')), h('span.tab-title', null, 'New tab'));
    newRow.addEventListener('mousedown', (e) => e.preventDefault());
    newRow.addEventListener('click', () => emit('command', 'newTab', { source: 'button' }));
  }
  return newRow;
}

function scrollToActive() {
  const t = activeTab();
  const el = t && tabEls.get(t.id);
  if (el && el.isConnected) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: anim('tabSwitch') ? 'smooth' : 'auto' });
}

// Horizontal tabs keep their widths while you close several in a row (like Chrome).
function freeze() {
  if (!htabsEl || htabsEl.classList.contains('frozen')) return;
  for (const el of htabsEl.querySelectorAll('.tab:not(.pinned)')) el.style.width = el.getBoundingClientRect().width + 'px';
  htabsEl.classList.add('frozen');
}
function unfreeze() {
  if (!htabsEl || !htabsEl.classList.contains('frozen')) return;
  htabsEl.classList.remove('frozen');
  for (const el of htabsEl.querySelectorAll('.tab')) el.style.width = '';
}

function closeFromStrip(t) {
  if (mode() === 'h') freeze();
  const targets = selection.has(t.id) && selection.size > 1 ? [...selection].map(tabById).filter(Boolean) : [t];
  selection.clear();
  T.requestClose(targets);
}

function animateOut(t) {
  const el = tabEls.get(t.id);
  if (!el) return;
  tabEls.delete(t.id);
  if (!el.isConnected || !anim('tabOpenClose')) { el.remove(); return; }
  el.dataset.leaving = '1';
  el.classList.add('leaving');
  el.style.pointerEvents = 'none';
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 600);
}

// ------------------------------------------------------------------ groups
function toggleGroup(g) {
  const members = groupTabs(g);
  const act = activeTab();
  if (!g.collapsed && members.includes(act)) {
    // Collapsing hides the active tab, so move to the nearest tab outside the group.
    const list = wsTabs();
    const outside = list.filter((t) => t.groupId !== g.id);
    if (!outside.length) return;
    const i = list.indexOf(act);
    const after = list.slice(i).find((t) => t.groupId !== g.id);
    const before = list.slice(0, i).reverse().find((t) => t.groupId !== g.id);
    g.collapsed = true;
    T.selectTab(after || before);
  } else g.collapsed = !g.collapsed;
  emit('structure');
}

export function newGroup(tabs) {
  const g = createGroup(tabs);
  if (!g) return null;
  emit('structure');
  requestAnimationFrame(() => {
    const ge = groupEls.get(g.id);
    const anchor = ge && (mode() === 'v' ? ge.head : ge.chip);
    if (anchor && anchor.isConnected) editGroup(g, anchor);
  });
  return g;
}

function swatches(current, onPick) {
  const row = h('div.swatches');
  const draw = (cur) => row.replaceChildren(...GROUP_COLORS.map((c) => h('button.swatch' + (c === cur ? '.on' : ''), {
    type: 'button', title: c, style: { '--c': `var(--${c})` },
    onclick: (e) => { e.stopPropagation(); onPick(c); draw(c); },
  })));
  draw(current);
  return row;
}

function editGroup(g, anchor) {
  const input = h('input.field', { type: 'text', placeholder: 'Name this group', autofocus: true, spellcheck: 'false', 'data-select': '' });
  input.value = g.title || '';
  input.addEventListener('input', () => { g.title = input.value; emit('structure'); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pop.close(); } });
  const pop = popover(h('div.group-editor', null, input, swatches(g.color, (c) => { g.color = c; emit('structure'); })),
    { anchor, side: mode() === 'v' ? 'right' : 'bottom', align: 'start' }, { className: 'group-pop' });
}

function groupMenu(g, pos, anchor) {
  const others = S.workspaces.filter((w) => w.id !== g.workspaceId);
  showMenu([
    { label: 'Rename and recolor…', icon: 'edit', action: () => editGroup(g, anchor) },
    { type: 'custom', el: swatches(g.color, (c) => { g.color = c; emit('structure'); }) },
    '-',
    { label: g.collapsed ? 'Expand group' : 'Collapse group', icon: g.collapsed ? 'chevronDown' : 'chevronUp', action: () => toggleGroup(g) },
    { label: 'New tab in group', icon: 'plus', action: () => { const m = groupTabs(g); T.openTab({ after: m[m.length - 1], groupId: g.id }); } },
    others.length ? { label: 'Move group to space', icon: 'layers', submenu: others.map((w) => ({ label: w.name, action: () => { for (const t of groupTabs(g)) T.moveTabToWorkspace(t, w.id); } })) } : null,
    '-',
    { label: 'Ungroup', icon: 'layers', action: () => { ungroup(g); emit('structure'); } },
    { label: 'Close group', icon: 'close', danger: true, action: async () => {
      const m = groupTabs(g);
      if (m.length > 3 && !(await confirmDialog(`Close ${m.length} tabs in “${g.title || 'this group'}”?`, { ok: 'Close tabs', danger: true }))) return;
      T.requestClose(m);
    } },
  ], pos);
}

// ------------------------------------------------------------------- menus
function dot(color) { return h('span.menu-dot', { style: { '--c': `var(--${color})` } }); }

export function tabMenu(t, pos) {
  const sel = selection.has(t.id) && selection.size > 1 ? wsTabs().filter((x) => selection.has(x.id)) : [t];
  const multi = sel.length > 1;
  const list = wsTabs();
  const groups = S.groups.filter((g) => g.workspaceId === t.workspaceId && g.id !== t.groupId);
  const others = S.workspaces.filter((w) => w.id !== t.workspaceId);
  const after = list.slice(list.indexOf(t) + 1).filter((x) => !x.pinned);
  const h_ = mode() === 'h';
  showMenu([
    { label: h_ ? 'New tab to the right' : 'New tab below', icon: 'plus', action: () => T.openTab({ after: t, groupId: t.groupId }) },
    '-',
    { label: multi ? `Reload ${sel.length} tabs` : 'Reload', icon: 'reload', accel: multi ? '' : accelFor('reload'), action: () => sel.forEach((x) => V.reload(x)) },
    { label: 'Duplicate', icon: 'copy', action: () => sel.forEach((x) => T.duplicateTab(x)) },
    { label: t.pinned ? (multi ? 'Unpin tabs' : 'Unpin') : (multi ? 'Pin tabs' : 'Pin'), icon: 'pin', action: () => sel.forEach((x) => { if (x.pinned === t.pinned) T.togglePin(x); }) },
    { label: t.muted ? (multi ? 'Unmute tabs' : 'Unmute') : (multi ? 'Mute tabs' : 'Mute'), icon: t.muted ? 'volume' : 'volumeOff', accel: multi ? '' : accelFor('muteTab'), action: () => sel.forEach((x) => V.setMuted(x, !t.muted)) },
    { label: multi ? 'Put tabs to sleep' : 'Put to sleep', icon: 'moon', disabled: !sel.some((x) => x.wv), action: () => sel.forEach((x) => T.sleep(x)) },
    '-',
    { label: multi ? 'Add tabs to a new group' : 'Add to a new group', icon: 'tag', accel: multi ? '' : accelFor('groupTab'), disabled: sel.every((x) => x.pinned), action: () => newGroup(sel) },
    groups.length ? { label: 'Add to group', icon: 'layers', submenu: groups.map((g) => ({ label: g.title || 'Unnamed group', iconEl: dot(g.color), action: () => { sel.forEach((x) => addToGroup(x, g)); emit('structure'); } })) } : null,
    t.groupId ? { label: 'Remove from group', action: () => { sel.forEach((x) => removeFromGroup(x)); emit('structure'); } } : null,
    '-',
    t.splitId
      ? { label: 'Close split view', icon: 'split', action: () => T.unsplit(t) }
      : multi
        ? { label: `Show ${Math.min(4, sel.length)} tabs in split view`, icon: 'split', action: () => T.splitTabs(sel.slice(0, 4)) }
        : { label: 'Split view with', icon: 'split', submenu: () => [
          { label: 'A new tab', icon: 'plus', action: () => { T.selectTab(t); emit('command', 'splitNewTab'); } },
          '-',
          ...list.filter((x) => x !== t).slice(0, 40).map((x) => ({ label: x.title || displayUrl(x.url) || 'New tab', iconEl: faviconEl(x.url, x.favicon, icon, 'mi-fav'), action: () => T.splitTabs([t, x], { focusTab: t }) })),
        ] },
    { label: 'Move to space', icon: 'layers', submenu: () => [
      ...others.map((w) => ({ label: w.name, iconEl: wsIconEl(w), action: () => sel.forEach((x) => T.moveTabToWorkspace(x, w.id)) })),
      others.length ? '-' : null,
      { label: 'New space…', icon: 'plus', action: () => emit('new-workspace', { tabs: sel }) },
    ] },
    { label: 'Move to window', icon: 'window', submenu: async () => {
      const wins = await wb.invoke('window:list').catch(() => []);
      const rest = wins.filter((w) => !w.current);
      return [
        ...rest.map((w) => ({ label: w.title || 'Window', sub: w.tabs + (w.tabs === 1 ? ' tab' : ' tabs'), action: () => sel.forEach((x) => T.moveTabToWindow(x, w.id)) })),
        rest.length ? '-' : null,
        { label: 'New window', icon: 'window', action: () => sel.forEach((x) => T.moveTabToWindow(x, 'new')) },
      ];
    } },
    '-',
    { label: multi ? 'Bookmark tabs…' : 'Bookmark', icon: 'star', action: () => emit('bookmark-tabs', sel) },
    { label: 'Copy link' + (multi ? 's' : ''), icon: 'link', action: () => copyText(sel.map((x) => x.url).join('\n')).then(() => toast({ text: multi ? 'Links copied' : 'Link copied', iconName: 'check', timeout: 1600 })) },
    '-',
    { label: multi ? `Close ${sel.length} tabs` : 'Close', icon: 'close', accel: multi ? '' : accelFor('closeTab'), action: () => { selection.clear(); T.requestClose(sel); } },
    { label: 'Close other tabs', disabled: list.filter((x) => !sel.includes(x) && !x.pinned).length === 0, action: () => T.requestClose(list.filter((x) => !sel.includes(x) && !x.pinned)) },
    { label: h_ ? 'Close tabs to the right' : 'Close tabs below', disabled: !after.length, action: () => T.requestClose(after) },
    '-',
    { label: 'Reopen closed tab', icon: 'rotate', accel: accelFor('reopenTab'), action: () => T.reopenClosed() },
  ], pos);
}

export function stripMenu(pos) {
  const v = mode() === 'v';
  showMenu([
    { label: 'New tab', icon: 'plus', accel: accelFor('newTab'), action: () => emit('command', 'newTab', { source: 'button' }) },
    { label: 'Reopen closed tab', icon: 'rotate', accel: accelFor('reopenTab'), action: () => T.reopenClosed() },
    '-',
    { label: v ? 'Horizontal tabs' : 'Vertical tabs', icon: v ? 'window' : 'sidebar', accel: accelFor('toggleTabLayout'), action: () => emit('command', 'toggleTabLayout') },
    v ? { label: S.settings.appearance.sidebarCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar', icon: 'sidebar', accel: accelFor('toggleSidebar'), action: () => emit('command', 'toggleSidebar') } : null,
    { label: 'Customize toolbar and sidebar…', icon: 'layout', action: () => emit('command', 'customizeLayout') },
    '-',
    { label: 'Bookmark all tabs…', icon: 'star', action: () => emit('bookmark-tabs', wsTabs()) },
    { label: 'Close all tabs in this space', icon: 'close', danger: true, action: async () => {
      const list = wsTabs().filter((t) => !t.pinned);
      if (list.length > 2 && !(await confirmDialog(`Close ${list.length} tabs?`, { detail: 'Pinned tabs stay open. You can reopen closed tabs from History.', ok: 'Close tabs', danger: true }))) return;
      T.requestClose(list);
    } },
  ], pos);
}

export function wsIconEl(w) {
  if (!w) return null;
  const isIcon = /^[a-zA-Z]+$/.test(w.icon || '');
  return h('span.ws-ico', { style: w.color ? { '--wc': w.color } : null }, isIcon ? icon(w.icon) : h('span.ws-emoji', null, w.icon || '•'));
}

// --------------------------------------------------------------- selection
function onTabDown(e, t) {
  if (e.button !== 0 || e.target.closest('button')) return;
  previewHide();
  if (e.ctrlKey || e.metaKey) {
    if (selection.has(t.id)) selection.delete(t.id); else selection.add(t.id);
    const act = activeTab();
    if (act && act.workspaceId === t.workspaceId) selection.add(act.id);
    lastClicked = t;
    render();
    return;
  }
  if (e.shiftKey) {
    const list = wsTabs();
    const a = list.indexOf(lastClicked && list.includes(lastClicked) ? lastClicked : activeTab());
    const b = list.indexOf(t);
    selection.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(list[i].id);
    render();
    return;
  }
  lastClicked = t;
  if (selection.size) { selection.clear(); render(); }
  if (t !== activeTab()) T.selectTab(t);
  else T.focusTab(t);
  trackDrag(e, t);
}

// --------------------------------------------------------------- dragging
let drag = null;

function trackDrag(e, t) {
  const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
  const move = (ev) => {
    if (ev.pointerId !== pid) return;
    if (!drag) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      beginDrag(t, ev, sx, sy);
    }
    dragMove(ev);
  };
  const up = (ev) => { if (ev.pointerId !== pid) return; cleanup(); if (drag) dropDrag(); };
  const key = (ev) => { if (ev.key === 'Escape' && drag) { ev.preventDefault(); ev.stopPropagation(); cleanup(); cancelDrag(); } };
  function cleanup() {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('keydown', key, true);
}

function beginDrag(t, ev, sx, sy) {
  const el = tabEls.get(t.id);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('tab-ghost');
  ghost.classList.remove('entering', 'leaving');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.getElementById('overlay-root').append(ghost);
  const ph = h('div.tab-placeholder');
  ph.style.setProperty('--w', r.width + 'px');
  ph.style.setProperty('--h', r.height + 'px');
  if (t.pinned) ph.classList.add('pinned');
  el.after(ph);
  el.classList.add('drag-source');
  const shield = V.dragShield('grabbing');
  try { shield.setPointerCapture(ev.pointerId); } catch { /* fine */ }
  document.documentElement.classList.add('tab-dragging');
  drag = { tab: t, el, ghost, ph, offX: sx - r.left, offY: sy - r.top, shield, target: null, splitPreview: null, hot: null };
}

function rectHas(r, x, y, pad = 0) { return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; }

// Where an element sits in the layout, leaving out the slide it may be in the middle of (tabs slide out
// of the placeholder's way), so where a tab lands doesn't depend on how far the others have slid.
function layoutRect(el) {
  const r = el.getBoundingClientRect();
  const tf = getComputedStyle(el).transform;
  if (!tf || tf === 'none') return r;
  let m;
  try { m = new DOMMatrixReadOnly(tf); } catch { return r; }
  return { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42, width: r.width, height: r.height };
}

function dragMove(ev) {
  const d = drag;
  const x = ev.clientX, y = ev.clientY;
  // Once the tabs have finished sliding, place it again where the pointer is now (it may not move again
  // before you let go).
  clearTimeout(d.settle);
  d.settle = setTimeout(() => { if (drag === d) dragMove({ clientX: x, clientY: y }); }, 200);
  d.ghost.style.transform = `translate(${x - d.offX}px, ${y - d.offY}px)`;
  if (d.hot) { d.hot.classList.remove('drop-hot'); d.hot = null; }
  showSplitPreview(null);
  // Outside the window: becomes a new window.
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    d.target = { type: 'window' };
    d.ghost.classList.add('detach');
    d.ph.hidden = true;
    return;
  }
  d.ghost.classList.remove('detach');
  // A space in the switcher.
  for (const b of document.querySelectorAll('[data-ws-drop]')) {
    if (b.offsetParent && rectHas(b.getBoundingClientRect(), x, y)) {
      d.target = { type: 'workspace', id: b.dataset.wsDrop };
      d.hot = b; b.classList.add('drop-hot');
      d.ph.hidden = true;
      return;
    }
  }
  // The page area: split view with the current tab.
  const stage = document.getElementById('stage').getBoundingClientRect();
  if (rectHas(stage, x, y) && !(mode() === 'h' && y < stage.top + 24)) {
    const act = activeTab();
    if (act && act !== d.tab && !(splitOf(act) && splitOf(act).tabIds.includes(d.tab.id))) {
      const side = x < stage.left + stage.width / 2 ? 'left' : 'right';
      d.target = { type: 'split', side };
      d.ph.hidden = true;
      showSplitPreview(side);
      return;
    }
  }
  d.ph.hidden = false;
  if (mode() === 'v') {
    // The pin drop zone (when nothing is pinned yet) opens once the tab is taken up past the top of the
    // list, and then stays open until the drop, so the list doesn't jump back and forth under the pointer.
    const root = document.documentElement;
    if (pinnedEl.classList.contains('empty') && !root.classList.contains('pin-drop-open') && y < tablistWrap.getBoundingClientRect().top + 4) {
      root.classList.add('pin-drop-open');
    }
    placeV(x, y);
  } else placeH(x);
  d.target = { type: 'list' };
}

function showSplitPreview(side) {
  const d = drag;
  if (!side) { if (d.splitPreview) { d.splitPreview.remove(); d.splitPreview = null; } return; }
  if (!d.splitPreview) {
    d.splitPreview = h('div.split-preview', null, h('div.split-preview-label', null, icon('split'), 'Split view'));
    document.getElementById('stage-ui').append(d.splitPreview);
  }
  d.splitPreview.dataset.side = side;
}

function placeV(x, y) {
  const d = drag;
  const pr = pinnedEl.getBoundingClientRect();
  const list = tablistWrap.getBoundingClientRect();
  if (rectHas(pr, x, y, 2) || (y < list.top && x >= pr.left && x <= pr.right)) {
    const items = [...pinnedEl.children].filter((c) => c !== d.ph && c !== d.el && !c.dataset.leaving);
    let before = null;
    for (const it of items) {
      const r = layoutRect(it);
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) { before = it; break; }
    }
    if (d.ph.parentElement !== pinnedEl || d.ph.nextSibling !== before) movePh(pinnedEl, before);
    d.ph.classList.add('pinned');
    return;
  }
  d.ph.classList.remove('pinned');
  const cands = [...tablistEl.querySelectorAll('.tab, .group-head')].filter((c) => c !== d.el && !c.dataset.leaving && c.offsetParent && !c.closest('.group.collapsed .group-body'));
  for (const c of cands) {
    const r = layoutRect(c);
    if (c.classList.contains('group-head')) {
      const gel = c.parentElement;
      if (gel.classList.contains('collapsed') && rectHas(r, x, y)) {
        // Drop onto a collapsed group: joins it.
        d.target = { type: 'group', id: gel.dataset.group };
        if (d.hot !== c) { if (d.hot) d.hot.classList.remove('drop-hot'); d.hot = c; c.classList.add('drop-hot'); }
        d.ph.hidden = true;
        return;
      }
      if (y < r.top + r.height / 2) { if (d.ph.nextSibling !== gel) movePh(tablistEl, gel); return; }
      continue;
    }
    if (y < r.top + r.height / 2) { if (d.ph.nextSibling !== c) movePh(c.parentElement, c); return; }
    const inner = c.parentElement;
    if (inner.classList.contains('group-inner') && y <= r.bottom) {
      const rest = [...inner.children].filter((k) => k !== d.el && k !== d.ph);
      if (rest[rest.length - 1] === c) { if (d.ph.previousSibling !== c) movePh(inner, c.nextSibling); return; }
    }
  }
  if (d.ph.nextSibling !== newRow) movePh(tablistEl, newRow);
}

function placeH(x) {
  const d = drag;
  const items = [...htabsEl.children].filter((c) => c !== d.ph && c !== d.el && c !== hnewBtn && !c.dataset.leaving);
  let before = hnewBtn;
  for (const c of items) {
    const r = layoutRect(c);
    if (x < r.left + r.width / 2) { before = c; break; }
  }
  if (d.ph.nextSibling !== before) movePh(htabsEl, before);
  const next = before && before.classList && before.classList.contains('tab') ? tabById(before.dataset.id) : null;
  d.ph.classList.toggle('pinned', !!(next && next.pinned) || (!!d.tab.pinned && isPinnedBefore(d.ph)));
}

function isPinnedBefore(ph) {
  const prev = ph.previousElementSibling;
  return !!(prev && prev.classList.contains('tab') && prev.classList.contains('pinned'));
}

// Moves the placeholder, sliding the tabs around it.
function movePh(parent, before) {
  const d = drag;
  const container = mode() === 'v' ? document.getElementById('sidebar') : htabsEl;
  flip(() => [...container.querySelectorAll('.tab, .group-head, .hgroup, .newtab-row')].filter((e) => e !== d.el && e.offsetParent),
    () => parent.insertBefore(d.ph, before || null), 'tabDrag', { duration: 160 });
}

// The first tab after the placeholder, in model order (a collapsed group means its first tab).
function tabAfterPlaceholder() {
  const d = drag;
  const scope = mode() === 'v' ? [pinnedEl, tablistEl] : [htabsEl];
  const all = [];
  for (const s of scope) all.push(...s.querySelectorAll('.tab-placeholder, .tab[data-id], .hgroup'));
  const i = all.indexOf(d.ph);
  for (const el of all.slice(i + 1)) {
    if (el === d.el) continue;
    if (el.classList.contains('hgroup')) {
      const g = groupById(el.dataset.group);
      const first = g && groupTabs(g)[0];
      if (first && first !== d.tab) return first;
      continue;
    }
    const t = tabById(el.dataset.id);
    if (t && t !== d.tab) return t;
  }
  return null;
}

function groupForPlaceholder() {
  const d = drag;
  if (mode() === 'v') {
    const gel = d.ph.parentElement && d.ph.parentElement.closest('.group');
    return gel ? gel.dataset.group : null;
  }
  const prev = d.ph.previousElementSibling, next = d.ph.nextElementSibling;
  const gOf = (el) => (!el ? null : el.classList.contains('hgroup') ? el.dataset.group : el.classList.contains('tab') ? (tabById(el.dataset.id) || {}).groupId || null : null);
  const pg = prev && prev !== d.el ? gOf(prev) : null;
  const ng = next && next !== d.el && !(next.classList && next.classList.contains('hgroup')) ? gOf(next) : null;
  if (prev && prev.classList.contains('hgroup')) return prev.dataset.group;
  if (pg && pg === ng) return pg;
  if (pg && pg === d.tab.groupId) return pg;
  return null;
}

function finishDrag() {
  const d = drag;
  drag = null;
  d.ghost.remove();
  d.ph.remove();
  d.shield.remove();
  if (d.hot) d.hot.classList.remove('drop-hot');
  if (d.splitPreview) d.splitPreview.remove();
  d.el.classList.remove('drag-source');
  document.documentElement.classList.remove('tab-dragging', 'pin-drop-open');
}

function cancelDrag() { finishDrag(); render(); }

function dropDrag() {
  const d = drag;
  const t = d.tab;
  const target = d.target || { type: 'list' };
  if (target.type === 'list') {
    const pinned = d.ph.classList.contains('pinned');
    const groupId = pinned ? null : groupForPlaceholder();
    const next = tabAfterPlaceholder();
    const phRect = d.ph.getBoundingClientRect();
    const settle = anim('tabDrag') ? animate(d.ghost, [{ transform: d.ghost.style.transform }, { transform: `translate(${phRect.left}px, ${phRect.top}px)` }], { duration: 140, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }, 'tabDrag') : Promise.resolve();
    settle.then(() => {
      finishDrag();
      if (t.splitId && pinned !== t.pinned) T.unsplit(t);
      t.pinned = pinned;
      const list = wsTabs(t.workspaceId).filter((x) => x !== t);
      const index = next ? list.indexOf(next) : list.length;
      moveTab(t, index, { groupId });
      emit('structure');
    });
    return;
  }
  finishDrag();
  if (target.type === 'window') {
    if (S.tabs.length > 1) T.moveTabToWindow(t, 'new');
  } else if (target.type === 'workspace') {
    if (target.id !== t.workspaceId) {
      T.moveTabToWorkspace(t, target.id);
      if (setting('workspaces.switchOnDrop')) T.switchWorkspace(target.id, { select: t });
    } else render();
  } else if (target.type === 'group') {
    const g = groupById(target.id);
    if (g) { addToGroup(t, g); emit('structure'); }
  } else if (target.type === 'split') {
    const act = activeTab();
    if (act) {
      const sp = splitOf(act);
      const base = sp ? sp.tabIds.map(tabById).filter(Boolean) : [act];
      const tabs = target.side === 'left' ? [t, ...base] : [...base, t];
      T.splitTabs(tabs.slice(0, 4), { focusTab: t });
    }
  } else render();
}

// Links and text dragged in from pages and other apps.
function droppableUrl(e) {
  const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
  return types.includes('text/uri-list') || types.includes('text/plain');
}
function droppedUrl(e) {
  const dt = e.dataTransfer;
  if (!dt) return '';
  let url = (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#')) || '';
  if (!url) {
    const text = (dt.getData('text/plain') || '').trim();
    if (window.WBEngine.looksLikeUrl(text)) url = window.WBEngine.toUrl(text);
  }
  return /^(https?|ftp|file):/i.test(url) ? url.trim() : '';
}

// --------------------------------------------------------------- previews
// Hover cards (and the thumbnails kept for them) are off when the setting or the performance profile says so.
const previewsOn = () => setting('appearance.showTabPreviews') && window.WBDefaults.perf(S.settings).tabPreviews;
let previewTimer = null, previewEl = null, previewFor = null, leaveTimer = null;

function previewSoon(t, el) {
  if (!previewsOn() || drag) return;
  clearTimeout(previewTimer);
  clearTimeout(leaveTimer);
  previewTimer = setTimeout(() => showPreview(t, el), previewEl ? 60 : Math.max(0, Math.min(3000, Number(setting('appearance.tabPreviewDelay')) || 0)));
}
function previewLeave() {
  clearTimeout(previewTimer);
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(previewHide, 140);
}
export function previewHide() {
  clearTimeout(previewTimer);
  if (!previewEl) return;
  const el = previewEl;
  previewEl = null; previewFor = null;
  animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 90 }, 'tabHover').then(() => el.remove());
}

function showPreview(t, anchor) {
  if (!anchor.isConnected || drag || !S.tabs.includes(t)) return;
  const fresh = !previewEl;
  if (!previewEl) { previewEl = h('div.tab-preview'); document.getElementById('overlay-root').append(previewEl); }
  previewFor = t;
  const isActive = t === activeTab();
  const state = t.crashed ? 'Crashed' : !t.wv ? 'Sleeping · loads when you open it' : t.audible ? 'Playing audio' : t.loading ? 'Loading…' : '';
  previewEl.replaceChildren(...[
    h('div.tp-title', null, t.title || displayUrl(t.url) || 'New tab'),
    h('div.tp-url', null, faviconEl(t.url, t.favicon, icon, 'tp-fav'), h('span', null, isNewTab(t.url) ? 'New tab' : hostOf(t.url) || displayUrl(t.url))),
    state ? h('div.tp-state', null, state) : null,
    t.thumb && !isActive ? h('div.tp-thumb', null, h('img', { src: t.thumb, alt: '' })) : null,
  ].filter(Boolean));
  place(previewEl, { anchor, side: mode() === 'v' ? (S.settings.appearance.sidebarSide === 'right' ? 'left' : 'right') : 'bottom', align: 'start' }, { gap: 10 });
  if (fresh) animate(previewEl, [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 140 }, 'tabHover');
}

// Thumbnails come from the active tab while it's on screen.
const captureSoon = (() => {
  let timer = null;
  return (delay = 900) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const t = activeTab();
      if (!t || !t.wv || t.loading || !S.focused || document.hidden || !previewsOn()) return;
      try { const url = await V.guest(t, 'captureThumb'); if (url) t.thumb = url; } catch { /* not ready */ }
    }, delay);
  };
})();

// ------------------------------------------------------------------- init
export function init() {
  render();
  on('structure', () => render());
  on('workspace', (ws, prev) => {
    previewHide();
    const dir = prev ? Math.sign(S.workspaces.indexOf(ws) - S.workspaces.indexOf(prev)) || 1 : 0;
    render();
    if (dir && anim('workspaceSwitch')) {
      for (const el of [pinnedEl, tablistEl, htabsEl]) {
        if (!el || !el.offsetParent) continue;
        animate(el, [{ opacity: 0, transform: `translateX(${mode() === 'v' ? dir * 22 : 0}px) translateY(${mode() === 'h' ? 4 : 0}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' }, 'workspaceSwitch');
      }
    }
  });
  on('active', (t, prev) => {
    if (prev && S.tabs.includes(prev)) updateTab(prev);
    for (const x of visibleTabs()) updateTab(x);
    if (t) updateTab(t);
    if (prev && prev.groupId && groupById(prev.groupId)) groupEl(groupById(prev.groupId));
    if (t && t.groupId && groupById(t.groupId)) groupEl(groupById(t.groupId));
    markSplits(wsTabs());
    requestAnimationFrame(scrollToActive);
    captureSoon(1200);
  });
  on('tab', (t, patch) => {
    if (t.workspaceId !== S.activeWorkspaceId) return;
    if (!tabEls.has(t.id)) return;
    updateTab(t);
    if (previewFor === t && previewEl) showPreview(t, tabEls.get(t.id));
    if ('loading' in patch && !t.loading && t === activeTab()) captureSoon(900);
  });
  on('tab-closing', (t) => { if (previewFor === t) previewHide(); animateOut(t); selection.delete(t.id); });
  on('settings', (path) => { if (!path || path.startsWith('appearance') || path === 'tabs.showAudioIndicator' || path === 'tabs') { render(); } });
  tablistWrap.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tab, .group-head, .newtab-row')) return;
    e.preventDefault();
    stripMenu({ x: e.clientX, y: e.clientY });
  });
  tablistWrap.addEventListener('dblclick', (e) => { if (e.target === tablistWrap || e.target === tablistEl) emit('command', 'newTab', { source: 'button' }); });
  tablistWrap.addEventListener('scroll', () => previewHide(), { passive: true });
  setInterval(() => captureSoon(0), 30000);
  window.addEventListener('blur', () => previewHide());
  // Any key or command (a dialog, the launcher, a tab switch…) puts the hover card away.
  window.addEventListener('keydown', () => previewHide(), true);
  on('command', () => previewHide());
}

export function selectedTabs() { return wsTabs().filter((x) => selection.has(x.id)); }
export function tabElement(t) { return tabEls.get(t.id) || null; }
