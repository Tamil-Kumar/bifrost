// Bifrost browser UI — Ctrl+Tab (the nextTab/prevTab shortcuts) and how it moves between tabs.
//
// tabs.ctrlTab:
//   'order'   left to right through the tabs, like Chrome.
//   'recent'  a quick Ctrl+Tab flips between your two most recently used tabs. Hold Ctrl for a moment
//             first (tabs.ctrlTabHoldMs) and Tab goes through the tabs in order instead; each further Tab
//             while Ctrl is still held keeps going the same way.
//   'mru'     goes back through tabs in the order you used them for as long as Ctrl is held.
//
// While a key is held, tabs passed along the way don't count as "used": when Ctrl comes up, the tab you
// started on becomes the previous tab and the one you ended on the current one, like Alt+Tab in Windows.
// Modifier keys pressed while a page has focus come from the main process ('modifier-key').
//
// tabs.ctrlTabMenu: while Ctrl is held, a list of the tabs shows (in the order Ctrl+Tab goes through them),
// Tab moves down it and Shift+Tab up, and letting go of Ctrl switches to the one picked (Esc stays). A quick
// press switches straight away, with no list, and so does the quick press of 'recent' (your last tab).
import { S, activeTab, wsTabs, setting, groupById } from './state.js';
import { h, faviconEl, displayUrl, hostOf, animate } from './util.js';
import { icon } from './icons.js';
import * as T from './tabs.js';

const wb = window.wb;
const NAMES = { control: 'Control', alt: 'Alt', meta: 'Meta' };
const down = {};      // 'Control' | 'Alt' | 'Meta' -> when it went down (performance.now())
let cycle = null;     // { kind, mods, start, before: Map(tab -> lastActive), list, i }

function modifierChanged(key, isDown) {
  if (!(key === 'Control' || key === 'Alt' || key === 'Meta')) return;
  if (isDown) {
    // Pressed again without our hearing it come up (it came up in a page that had just had a shortcut taken
    // from it, which Chromium doesn't pass on, or in a tab that shortcut closed): it did come up in between,
    // so what it was holding is over, and it's held from now.
    if (down[key] != null) { delete down[key]; if (cycle && !cycle.mods.some((k) => down[k] != null)) finish(); }
    down[key] = performance.now();
    return;
  }
  delete down[key];
  if (cycle && !cycle.mods.some((k) => down[k] != null)) finish();
}

function releaseAll() {
  for (const k of Object.keys(down)) delete down[k];
  // (the window lost the keyboard: a list showing goes, without switching)
  if (cycle) finish({ cancel: !!cycle.pick });
}

// Ctrl came up: switch to the tab picked in the list, if there is one, and settle which tabs count as used.
function finish({ cancel = false } = {}) {
  const c = cycle;
  cycle = null;
  if (!c) return;
  if (c.pick) {
    clearTimeout(c.pick.timer);
    closeMenu(c);
    const t = c.pick.list[c.pick.sel];
    if (!cancel && t && S.tabs.includes(t) && t !== activeTab()) T.selectTab(t);
    else if (c.pick.tookFocus) T.focusTab(activeTab());
  }
  if (c.kind === 'flip') return;
  const end = activeTab();
  const now = Date.now();
  for (const [t, at] of c.before) if (t !== end && t !== c.start && S.tabs.includes(t)) t.lastActive = at;
  if (c.start && c.start !== end && S.tabs.includes(c.start)) c.start.lastActive = now - 1;
  if (end) end.lastActive = now;
}

const byRecent = (list) => list.slice().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

// dir: 1 for nextTab, -1 for prevTab. info: { key, mods } of the key press, when it came from a key.
export function step(dir, info = {}) {
  const mode = setting('tabs.ctrlTab') || 'order';
  const menu = !!setting('tabs.ctrlTabMenu');
  const mods = Object.keys(NAMES).filter((m) => info.mods && info.mods[m]).map((m) => NAMES[m]);
  // Only a held-modifier Tab chord can tell "quick" from "held" (Ctrl+PageDown and Vim keys go in order).
  if ((mode === 'order' && !menu) || info.key !== 'Tab' || !mods.length) { T.selectRelative(dir); return; }
  // A cycle whose keys were let go without us hearing about it (focus moved away) is over.
  if (cycle && !cycle.mods.some((k) => down[k] != null)) finish();
  if (!cycle) {
    const since = Math.min(...mods.map((k) => (down[k] == null ? Infinity : down[k])));
    const held = Number.isFinite(since) && performance.now() - since >= (Number(setting('tabs.ctrlTabHoldMs')) || 350);
    const kind = mode === 'mru' ? 'mru' : mode === 'order' || held ? 'order' : 'flip';
    const tabs = wsTabs();
    cycle = { kind, mods, start: activeTab(), before: new Map(tabs.map((t) => [t, t.lastActive || 0])), list: byRecent(tabs), i: 0, pick: null };
    // Nothing tells us when the keys come up if we never saw them go down: treat this as a single press.
    if (!Number.isFinite(since)) { const c = cycle; if (c.kind === 'order') T.selectRelative(dir); else run(c, dir); if (cycle === c) finish(); return; }
    // The list: nothing changes until Ctrl comes up. It shows once Ctrl's been held a moment (at once when
    // holding it was what picked "in order"), so a quick press just switches.
    if (menu && kind !== 'flip') {
      const list = kind === 'order' ? orderList() : cycle.list;
      if (list.length < 2) { cycle = null; return; }
      const at = Math.max(0, list.indexOf(cycle.start));
      cycle.pick = { list, sel: (at + dir + list.length) % list.length, el: null, timer: 0, tookFocus: false };
      const c = cycle;
      c.pick.timer = setTimeout(() => openMenu(c), mode === 'recent' ? 0 : MENU_AFTER_MS);
      holdKeys(c);
      return;
    }
  }
  run(cycle, dir);
}

function run(c, dir) {
  if (c.pick) { move(c, dir); holdKeys(c); return; }
  go(c, dir);
  holdKeys(c);
}

// The page on screen took this key press as a shortcut: tell it the keys still held, or it won't hear them
// come up (see 'tab:held-keys'). Not once the list has the keyboard.
function holdKeys(c) {
  if (c.pick && c.pick.tookFocus) return;
  const now = activeTab();
  const held = c.mods.filter((k) => down[k] != null);
  if (now && now.wcId != null && held.length) wb.send('tab:held-keys', now.wcId, held);
}

function go(c, dir) {
  const cur = activeTab();
  if (c.kind === 'order') { T.selectRelative(dir); return; }
  if (c.kind === 'flip') {
    const prev = byRecent(wsTabs().filter((t) => t !== cur))[0];
    if (prev) T.selectTab(prev);
    return;
  }
  // mru: walk the list as it was when Ctrl went down.
  const list = c.list.filter((t) => S.tabs.includes(t) && t.workspaceId === S.activeWorkspaceId);
  if (list.length < 2) return;
  c.list = list;
  c.i = (Math.max(0, list.indexOf(cur)) + dir + list.length) % list.length;
  T.selectTab(list[c.i]);
}

// ------------------------------------------------------------------ the list
const MENU_AFTER_MS = 200;
// The tabs in the order Ctrl+Tab goes through them (selectRelative's: a collapsed group's tabs are skipped).
const orderList = () => wsTabs().filter((t) => !t.groupId || !groupById(t.groupId).collapsed || t === activeTab());

function move(c, dir) {
  const p = c.pick;
  p.list = p.list.filter((t) => S.tabs.includes(t));
  if (p.list.length < 2) { finish({ cancel: true }); return; }
  p.sel = (Math.min(p.sel, p.list.length - 1) + dir + p.list.length) % p.list.length;
  renderMenu(c);
}

function openMenu(c) {
  if (cycle !== c || !c.pick || c.pick.el) return;
  const list = h('div.ts-list', { role: 'listbox', 'aria-label': 'Tabs' });
  const el = h('div.tab-switcher', { tabIndex: -1 },
    h('div.ts-card', null, list, h('div.ts-foot', null, h('kbd', null, 'Tab'), ' next · ', h('kbd', null, 'Shift+Tab'), ' back · let go of Ctrl to switch · ', h('kbd', null, 'Esc'), ' to stay')));
  c.pick.el = el;
  // Over the whole window while it shows: the pointer with Ctrl no longer held says it came up (should its
  // release have been missed), and a click outside the list leaves you where you are.
  el.addEventListener('pointermove', (e) => { if (cycle === c && released(c, e)) { for (const k of c.mods) delete down[k]; finish(); } });
  el.addEventListener('pointerdown', (e) => { if (cycle === c && !e.target.closest('.ts-card')) { e.preventDefault(); finish({ cancel: true }); } });
  (document.getElementById('overlay-root') || document.body).append(el);
  renderMenu(c);
  animate(el.firstChild, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: 'cubic-bezier(.16,1,.3,1)' }, 'menus');
  // The keyboard comes here while it shows (Tab, the arrows, Esc, and Ctrl coming up), wherever it was.
  c.pick.tookFocus = true;
  try { el.focus({ preventScroll: true }); } catch { /* fine */ }
}

function closeMenu(c) {
  const el = c.pick && c.pick.el;
  if (!el) return;
  c.pick.el = null;
  el.remove();
}

function renderMenu(c) {
  const p = c.pick;
  if (!p || !p.el) return;
  const list = p.el.querySelector('.ts-list');
  list.replaceChildren(...p.list.map((t, i) => {
    const g = groupById(t.groupId);
    const row = h('div.ts-row' + (i === p.sel ? '.sel' : '') + (t === c.start ? '.current' : ''), { role: 'option', 'aria-selected': String(i === p.sel), dataset: { i: String(i) } },
      g ? h('span.ts-group', { style: { background: `var(--${g.color || 'blue'})` } }) : null,
      faviconEl(t.url, t.favicon, icon, 'ts-fav'),
      h('span.ts-title', null, t.title || displayUrl(t.url) || 'New tab'),
      t === c.start ? h('span.ts-note', null, 'this tab') : h('span.ts-host', null, hostOf(t.url).replace(/^www\./, '')),
      t.pinned ? h('span.ts-pin', null, icon('pin')) : null);
    // The pointer picks too: over a row, it's the one; a click switches.
    row.addEventListener('pointermove', (e) => { if (cycle === c && !released(c, e) && p.sel !== i) { p.sel = i; renderMenu(c); } });
    row.addEventListener('click', () => { if (cycle !== c) return; p.sel = i; finish(); });
    return row;
  }));
  const sel = list.children[p.sel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// While the list shows and has the keyboard: Tab / Shift+Tab and the arrows move, Enter switches, Esc stays.
// A key or the pointer with Ctrl no longer held says it came up, should its release have been missed.
function released(c, e) { return c.mods.every((k) => !e.getModifierState(k)); }
function onMenuKey(e) {
  const c = cycle;
  if (!c || !c.pick || !c.pick.el) return;
  if (!NAMES[e.key.toLowerCase()] && released(c, e)) { e.preventDefault(); e.stopImmediatePropagation(); for (const k of c.mods) delete down[k]; finish({ cancel: e.key === 'Escape' }); return; }
  const step1 = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
  if (step1) { e.preventDefault(); e.stopImmediatePropagation(); move(c, step1); return; }
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish({ cancel: true }); return; }
  if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finish(); return; }
  if (!NAMES[e.key.toLowerCase()] && e.key !== 'Shift') { e.preventDefault(); e.stopImmediatePropagation(); }
}

export function init() {
  wb.on('modifier-key', ({ key, down: isDown }) => modifierChanged(key, isDown));
  window.addEventListener('keydown', onMenuKey, true);
  window.addEventListener('keydown', (e) => { if (!e.repeat) modifierChanged(e.key, true); }, true);
  window.addEventListener('keyup', (e) => modifierChanged(e.key, false), true);
  wb.on('window-focus', (f) => { if (!f) releaseAll(); });
}

// For tests.
export const _state = () => ({ down: Object.keys(down), cycle: cycle && { kind: cycle.kind, mods: cycle.mods, menu: !!(cycle.pick && cycle.pick.el), sel: cycle.pick ? cycle.pick.sel : null } });
