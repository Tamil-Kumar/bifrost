// Bifrost browser UI — the window's model: workspaces, tabs, groups and split views.
// Pure data and invariants; modules render from it and listen to its events:
//   'structure'  tabs/groups/splits/workspaces added, removed, moved, pinned…
//   'tab'        (tab, patch) a tab's properties changed (title, url, loading…)
//   'active'     (tab, prev) the selected tab changed
//   'workspace'  (ws, prev) the active workspace changed (or was edited)
//   'settings'   (path) settings changed
import { uid, debounce, isNewTab, NEWTAB_URL } from './util.js';

const wb = window.wb;

export const S = {
  init: null,
  settings: null,
  systemDark: true,
  windowId: 0,
  isPrivate: false,
  partition: '',
  platform: wb.platform,
  tabs: [],
  groups: [],
  splits: [],
  workspaces: [],
  activeWorkspaceId: null,
  focused: true,
  fullscreen: false,
  maximized: false,
  htmlFullscreenTab: null,
  ready: false,
};

// ------------------------------------------------------------------ events
const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev).delete(fn);
}
export function emit(ev, ...args) {
  for (const fn of [...(listeners.get(ev) || [])]) {
    try { fn(...args); } catch (e) { console.error('[ui]', ev, e); }
  }
}

// ----------------------------------------------------------------- lookups
export const setting = (path) => window.WBDefaults.getPath(S.settings, path);
// The first shortcut bound to a command, for menus ("Ctrl+T").
export function accelFor(id) {
  const map = window.WBDefaults.shortcutMap(S.settings);
  const acc = (map[id] || [])[0];
  if (!acc) return '';
  const c = window.WBDefaults.parseAccelerator(acc);
  return c ? window.WBDefaults.chordToString(c) : acc;
}
export const tabById = (id) => (id ? S.tabs.find((t) => t.id === id) || null : null);
export const tabByWc = (wcId) => (wcId != null ? S.tabs.find((t) => t.wcId === wcId) || null : null);
export const wsById = (id) => S.workspaces.find((w) => w.id === id) || null;
export const curWs = () => wsById(S.activeWorkspaceId);
export const wsTabs = (wsId = S.activeWorkspaceId) => S.tabs.filter((t) => t.workspaceId === wsId);
export const groupById = (id) => (id ? S.groups.find((g) => g.id === id) || null : null);
export const splitById = (id) => (id ? S.splits.find((s) => s.id === id) || null : null);
export const splitOf = (t) => (t && t.splitId ? splitById(t.splitId) : null);
export const groupTabs = (g) => S.tabs.filter((t) => t.groupId === g.id);
export function activeTab() {
  const w = curWs();
  return w ? tabById(w.activeTabId) : null;
}
// Tabs on screen: the active tab, or every pane of its split view.
export function visibleTabs() {
  const t = activeTab();
  const sp = splitOf(t);
  return sp ? sp.tabIds.map(tabById).filter(Boolean) : t ? [t] : [];
}

// -------------------------------------------------------------------- tabs
let groupSeq = 0;

export function makeTab(p = {}) {
  return {
    id: p.id || uid('t'),
    workspaceId: p.workspaceId || S.activeWorkspaceId,
    url: p.url || NEWTAB_URL,
    title: p.title || '',
    favicon: p.favicon || '',
    pinned: !!p.pinned,
    groupId: p.groupId || null,
    splitId: p.splitId || null,
    muted: !!p.muted,
    audible: false,
    loading: false,
    crashed: null,
    error: null,
    history: p.history || null,       // { entries: [{url,title}], index } for restoring
    lastActive: p.lastActive || 0,
    created: Date.now(),
    openerId: p.openerId || null,
    canGoBack: false,
    canGoForward: false,
    zoom: 0,
    blocked: 0,
    themeColor: null,
    wcId: null,
    wv: null,                          // the <webview>, when loaded
    sleeping: false,                   // unloaded to save memory (or restored and not opened yet)
    lazy: !!p.lazy,
    find: null,
    prompts: [],                       // pending permission prompts
    permAsks: null,                    // what this site asked for and got: { host, list: [{ key, allowed, asked }] }
    typed: false,
  };
}

// Inserts at a position within its workspace (index counts that workspace's tabs), keeping pinned tabs first.
export function insertTab(tab, { index = null, after = null } = {}) {
  const list = wsTabs(tab.workspaceId);
  let globalAt;
  if (after && S.tabs.includes(after)) globalAt = S.tabs.indexOf(after) + 1;
  else if (index != null && index < list.length) globalAt = S.tabs.indexOf(list[Math.max(0, index)]);
  else if (list.length) globalAt = S.tabs.indexOf(list[list.length - 1]) + 1;
  else globalAt = S.tabs.length;
  S.tabs.splice(globalAt, 0, tab);
  normalize();
}

export function removeTab(tab) {
  const i = S.tabs.indexOf(tab);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  normalize();
}

// Moves a tab to an index within its workspace's list (after removal), optionally into a group.
export function moveTab(tab, index, { groupId } = {}) {
  const from = S.tabs.indexOf(tab);
  if (from < 0) return;
  S.tabs.splice(from, 1);
  if (groupId !== undefined) tab.groupId = groupId;
  const list = wsTabs(tab.workspaceId);
  let at;
  if (index >= list.length) at = list.length ? S.tabs.indexOf(list[list.length - 1]) + 1 : S.tabs.length;
  else at = S.tabs.indexOf(list[Math.max(0, index)]);
  S.tabs.splice(at, 0, tab);
  normalize();
}

export function setPinned(tab, pinned) {
  if (tab.pinned === pinned) return;
  const list = wsTabs(tab.workspaceId);
  const pinnedCount = list.filter((t) => t.pinned && t !== tab).length;
  tab.pinned = pinned;
  if (pinned) tab.groupId = null;
  // Pinning goes to the end of the pinned tabs; unpinning to the start of the rest.
  moveTab(tab, pinnedCount);
}

// ------------------------------------------------------------------ groups
export const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'accent', 'teal', 'peach', 'lavender'];

export function createGroup(tabs, { title = '', color = null } = {}) {
  tabs = tabs.filter((t) => !t.pinned);
  if (!tabs.length) return null;
  const used = new Set(S.groups.map((g) => g.color));
  const g = { id: uid('g'), title, color: color || GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[S.groups.length % GROUP_COLORS.length], collapsed: false, workspaceId: tabs[0].workspaceId, numeric: ++groupSeq };
  S.groups.push(g);
  // Members gather at the first tab's position.
  const first = tabs[0];
  for (const t of tabs) { t.groupId = g.id; t.workspaceId = first.workspaceId; }
  const rest = tabs.slice(1);
  for (const t of rest) S.tabs.splice(S.tabs.indexOf(t), 1);
  S.tabs.splice(S.tabs.indexOf(first) + 1, 0, ...rest);
  normalize();
  return g;
}

export function addToGroup(tab, g) {
  if (tab.pinned) return;
  const members = groupTabs(g);
  tab.groupId = g.id;
  tab.workspaceId = g.workspaceId;
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  const last = members.filter((t) => t !== tab).pop();
  S.tabs.splice(last ? S.tabs.indexOf(last) + 1 : S.tabs.length, 0, tab);
  normalize();
}

export function removeFromGroup(tab) {
  const g = groupById(tab.groupId);
  if (!g) return;
  const members = groupTabs(g);
  tab.groupId = null;
  // Leaves the group just after its last member.
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  const last = members.filter((t) => t !== tab).pop();
  if (last) S.tabs.splice(S.tabs.indexOf(last) + 1, 0, tab);
  else S.tabs.push(tab);
  normalize();
}

export function ungroup(g) {
  for (const t of groupTabs(g)) t.groupId = null;
  normalize();
}

// ------------------------------------------------------------------ splits
export function createSplit(tabs, { orientation } = {}) {
  tabs = [...new Set(tabs)].slice(0, 4);
  if (tabs.length < 2) return null;
  for (const t of tabs) if (t.splitId) leaveSplit(t, { quiet: true });
  const sp = { id: uid('s'), tabIds: tabs.map((t) => t.id), orientation: orientation || setting('split.orientation') || 'row', sizes: tabs.map(() => 1 / tabs.length), workspaceId: tabs[0].workspaceId, focused: tabs[0].id };
  for (const t of tabs) { t.splitId = sp.id; t.workspaceId = sp.workspaceId; }
  // Partners sit next to the first tab (and share its pinned state and group).
  const first = tabs[0];
  for (const t of tabs.slice(1)) {
    t.pinned = first.pinned;
    t.groupId = first.groupId;
    S.tabs.splice(S.tabs.indexOf(t), 1);
  }
  S.tabs.splice(S.tabs.indexOf(first) + 1, 0, ...tabs.slice(1));
  S.splits.push(sp);
  normalize();
  return sp;
}

export function leaveSplit(tab, { quiet = false } = {}) {
  const sp = splitOf(tab);
  if (!sp) return;
  const i = sp.tabIds.indexOf(tab.id);
  sp.tabIds.splice(i, 1);
  const removed = sp.sizes.splice(i, 1)[0] || 0;
  if (sp.sizes.length) { const share = removed / sp.sizes.length; sp.sizes = sp.sizes.map((s) => s + share); }
  tab.splitId = null;
  if (!quiet) normalize();
}

export function dissolveSplit(sp) {
  for (const id of sp.tabIds) { const t = tabById(id); if (t) t.splitId = null; }
  sp.tabIds = [];
  normalize();
}

// -------------------------------------------------------------- workspaces
export const WS_ICONS = ['home', 'compass', 'star', 'book', 'code', 'globe', 'layers', 'bolt', 'sparkle', 'palette', 'user', 'folder', 'moon', 'camera', 'mic', 'cpu'];

export function createWorkspace({ name, icon, color } = {}) {
  const n = S.workspaces.length + 1;
  const w = { id: uid('w'), name: name || `Space ${n}`, icon: icon || WS_ICONS[n % WS_ICONS.length], color: color || null, activeTabId: null };
  S.workspaces.push(w);
  return w;
}

// --------------------------------------------------------------- invariants
// Runs after every change: pinned tabs first, group and split members together, no orphans.
export function normalize() {
  if (!S.workspaces.length) createWorkspace({ name: 'Home', icon: 'home' });
  const wsIds = new Set(S.workspaces.map((w) => w.id));
  if (!wsIds.has(S.activeWorkspaceId)) S.activeWorkspaceId = S.workspaces[0].id;
  for (const t of S.tabs) if (!wsIds.has(t.workspaceId)) t.workspaceId = S.activeWorkspaceId;

  // Groups: only unpinned tabs in the group's workspace; empty groups go away.
  const groups = new Map(S.groups.map((g) => [g.id, g]));
  for (const t of S.tabs) {
    const g = t.groupId && groups.get(t.groupId);
    if (!g || t.pinned) t.groupId = null;
    else if (g.workspaceId !== t.workspaceId) {
      // The group follows its first member.
      const first = S.tabs.find((x) => x.groupId === g.id);
      if (first === t) g.workspaceId = t.workspaceId; else t.groupId = null;
    }
  }
  const usedGroups = new Set(S.tabs.map((t) => t.groupId).filter(Boolean));
  S.groups = S.groups.filter((g) => usedGroups.has(g.id));

  // Splits: members exist, share a workspace; fewer than two members dissolves it.
  const byId = new Map(S.tabs.map((t) => [t.id, t]));
  for (const sp of S.splits) {
    sp.tabIds = sp.tabIds.filter((id) => { const t = byId.get(id); return t && t.splitId === sp.id && t.workspaceId === sp.workspaceId; });
    if (sp.sizes.length !== sp.tabIds.length) sp.sizes = sp.tabIds.map(() => 1 / Math.max(1, sp.tabIds.length));
    const sum = sp.sizes.reduce((a, b) => a + b, 0) || 1;
    sp.sizes = sp.sizes.map((s) => s / sum);
  }
  for (const sp of S.splits) if (sp.tabIds.length < 2) for (const id of sp.tabIds) { const t = byId.get(id); if (t) t.splitId = null; }
  S.splits = S.splits.filter((sp) => sp.tabIds.length >= 2);
  const splitIds = new Set(S.splits.map((s) => s.id));
  for (const t of S.tabs) if (t.splitId && !splitIds.has(t.splitId)) t.splitId = null;

  // Order: per workspace, pinned first, then each group gathered at its first member.
  const out = [];
  for (const w of S.workspaces) {
    const list = S.tabs.filter((t) => t.workspaceId === w.id);
    out.push(...list.filter((t) => t.pinned));
    const rest = list.filter((t) => !t.pinned);
    const seen = new Set();
    for (const t of rest) {
      if (!t.groupId) { out.push(t); continue; }
      if (seen.has(t.groupId)) continue;
      seen.add(t.groupId);
      out.push(...rest.filter((x) => x.groupId === t.groupId));
    }
    if (w.activeTabId && !list.some((t) => t.id === w.activeTabId)) w.activeTabId = null;
    if (!w.activeTabId && list.length) w.activeTabId = list.slice().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0].id;
  }
  S.tabs = out;
}

// ------------------------------------------------------------- persistence
function cleanHistory(hist) {
  if (!hist || !Array.isArray(hist.entries)) return null;
  let entries = hist.entries.filter((e) => e && typeof e.url === 'string' && e.url.length < 8192 && !/^(javascript|data|blob):/i.test(e.url) && e.url !== 'about:blank');
  let index = Math.min(entries.length - 1, Math.max(0, hist.index | 0));
  if (entries.length > 30) { const cut = entries.length - 30; entries = entries.slice(cut); index = Math.max(0, index - cut); }
  return entries.length ? { entries: entries.map((e) => ({ url: e.url, title: (e.title || '').slice(0, 300) })), index } : null;
}

export function serialize() {
  return {
    version: 1,
    activeWorkspaceId: S.activeWorkspaceId,
    workspaces: S.workspaces.map((w) => ({ id: w.id, name: w.name, icon: w.icon, color: w.color, activeTabId: w.activeTabId })),
    tabs: S.tabs.filter((t) => !t.transient).map((t) => ({
      id: t.id, workspaceId: t.workspaceId, url: t.url, title: (t.title || '').slice(0, 300), favicon: (t.favicon || '').length < 2048 ? t.favicon : '',
      pinned: t.pinned, groupId: t.groupId, splitId: t.splitId, muted: t.muted, lastActive: t.lastActive, history: cleanHistory(t.history),
    })),
    groups: S.groups.map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed, workspaceId: g.workspaceId })),
    splits: S.splits.map((s) => ({ id: s.id, tabIds: s.tabIds.slice(), orientation: s.orientation, sizes: s.sizes.slice(), workspaceId: s.workspaceId })),
  };
}

// Rebuilds the model from a saved session. Tabs come back unloaded; they load when first shown.
export function restore(state) {
  if (!state || !Array.isArray(state.workspaces) || !state.workspaces.length) return false;
  S.workspaces = state.workspaces.filter((w) => w && w.id).map((w) => ({ id: w.id, name: String(w.name || 'Space'), icon: w.icon || 'compass', color: w.color || null, activeTabId: w.activeTabId || null }));
  S.groups = (state.groups || []).filter((g) => g && g.id).map((g) => ({ id: g.id, title: g.title || '', color: g.color || 'blue', collapsed: !!g.collapsed, workspaceId: g.workspaceId, numeric: ++groupSeq }));
  S.splits = (state.splits || []).filter((s) => s && s.id && Array.isArray(s.tabIds)).map((s) => ({ id: s.id, tabIds: s.tabIds.slice(), orientation: s.orientation === 'column' ? 'column' : 'row', sizes: Array.isArray(s.sizes) ? s.sizes.slice() : [], workspaceId: s.workspaceId }));
  S.tabs = (state.tabs || []).filter((t) => t && t.id && typeof t.url === 'string').map((t) => makeTab(Object.assign({}, t, { lazy: true })));
  for (const t of S.tabs) t.sleeping = true;
  S.activeWorkspaceId = state.activeWorkspaceId;
  normalize();
  return true;
}

// Snapshot for the main process (extensions' chrome.tabs, the launcher's tab search).
export function syncPayload() {
  const act = activeTab();
  return S.tabs.map((t, index) => {
    const g = groupById(t.groupId);
    return {
      id: t.id, wcId: t.wcId, url: t.url, title: t.title || '', favicon: t.favicon || '', pinned: t.pinned,
      groupId: t.groupId, groupNumeric: g ? g.numeric : null, workspaceId: t.workspaceId, splitId: t.splitId,
      active: t === act, lastActive: t.lastActive || 0, audible: !!t.audible, muted: !!t.muted, discarded: !t.wv, index,
    };
  });
}

// (Pages that keep changing their title, like chats flashing "(1) New message", never let the debounces
// settle: the snapshot still goes out every quarter second, and the session is still saved every few.)
const sendSync = debounce(() => { if (S.ready) wb.send('tabs:sync', syncPayload()); }, 50, 250);
const sendSave = debounce(() => { if (S.ready && !S.isPrivate) wb.send('session:save', serialize()); }, 900, 5000);
export function syncSoon() { sendSync(); }
export function saveSoon() { sendSave(); }
export function flushSave() { sendSync.flush(); if (!S.isPrivate && S.ready) sendSave.flush(); }

// Which tab is active, and which page each tab is, go out at once: 'tab:selected' (sent right after these)
// fires the extensions' tabs.onActivated, whose listeners ask chrome.tabs which tab is active, and a new
// tab's page can ask before a delayed snapshot would arrive. (Messages to the main process keep their order.)
on('structure', () => { syncSoon(); saveSoon(); });
on('active', () => { sendSync.flush(); saveSoon(); });
on('workspace', () => { syncSoon(); saveSoon(); });
on('tab', (tab, patch) => {
  if ('wcId' in patch) { sendSync.flush(); saveSoon(); return; }
  if ('url' in patch || 'title' in patch || 'favicon' in patch || 'muted' in patch || 'audible' in patch || 'history' in patch) { syncSoon(); saveSoon(); }
});

export function setTab(tab, patch) {
  let changed = false;
  for (const k of Object.keys(patch)) if (tab[k] !== patch[k]) { changed = true; break; }
  if (!changed) return;
  Object.assign(tab, patch);
  emit('tab', tab, patch);
}

export { isNewTab };
