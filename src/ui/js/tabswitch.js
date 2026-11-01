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
import { S, activeTab, wsTabs, setting } from './state.js';
import * as T from './tabs.js';

const wb = window.wb;
const NAMES = { control: 'Control', alt: 'Alt', meta: 'Meta' };
const down = {};      // 'Control' | 'Alt' | 'Meta' -> when it went down (performance.now())
let cycle = null;     // { kind, mods, start, before: Map(tab -> lastActive), list, i }

function modifierChanged(key, isDown) {
  if (!(key === 'Control' || key === 'Alt' || key === 'Meta')) return;
  if (isDown) { if (down[key] == null) down[key] = performance.now(); return; }
  delete down[key];
  if (cycle && !cycle.mods.some((k) => down[k] != null)) finish();
}

function releaseAll() {
  for (const k of Object.keys(down)) delete down[k];
  if (cycle) finish();
}

// Ctrl came up: settle which tabs count as used.
function finish() {
  const c = cycle;
  cycle = null;
  if (!c || c.kind === 'flip') return;
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
  const mods = Object.keys(NAMES).filter((m) => info.mods && info.mods[m]).map((m) => NAMES[m]);
  // Only a held-modifier Tab chord can tell "quick" from "held" (Ctrl+PageDown and Vim keys go in order).
  if (mode === 'order' || info.key !== 'Tab' || !mods.length) { T.selectRelative(dir); return; }
  // A cycle whose keys were let go without us hearing about it (focus moved away) is over.
  if (cycle && !cycle.mods.some((k) => down[k] != null)) finish();
  if (!cycle) {
    const since = Math.min(...mods.map((k) => (down[k] == null ? Infinity : down[k])));
    const held = Number.isFinite(since) && performance.now() - since >= (Number(setting('tabs.ctrlTabHoldMs')) || 350);
    const kind = mode === 'mru' ? 'mru' : held ? 'order' : 'flip';
    const tabs = wsTabs();
    cycle = { kind, mods, start: activeTab(), before: new Map(tabs.map((t) => [t, t.lastActive || 0])), list: byRecent(tabs), i: 0 };
    // Nothing tells us when the keys come up if we never saw them go down: treat this as a single press.
    if (!Number.isFinite(since)) { const c = cycle; run(c, dir); if (cycle === c) finish(); return; }
  }
  run(cycle, dir);
}

function run(c, dir) {
  go(c, dir);
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

export function init() {
  wb.on('modifier-key', ({ key, down: isDown }) => modifierChanged(key, isDown));
  window.addEventListener('keydown', (e) => { if (!e.repeat) modifierChanged(e.key, true); }, true);
  window.addEventListener('keyup', (e) => modifierChanged(e.key, false), true);
  wb.on('window-focus', (f) => { if (!f) releaseAll(); });
}

// For tests.
export const _state = () => ({ down: Object.keys(down), cycle: cycle && { kind: cycle.kind, mods: cycle.mods } });
