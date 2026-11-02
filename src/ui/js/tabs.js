// Bifrost browser UI — tab, workspace and split-view operations (the controller between the model
// in state.js and the pages in views.js).
import {
  S, on, emit, makeTab, insertTab, removeTab, moveTab, setPinned, normalize, tabById, tabByWc, wsTabs, wsById, curWs,
  activeTab, visibleTabs, splitOf, groupById, createSplit, leaveSplit, dissolveSplit, setting, createWorkspace,
} from './state.js';
import * as V from './views.js';
import { NEWTAB_URL, isNewTab, fixupUrl, displayUrl, isInternal, hostOf } from './util.js';

const wb = window.wb;
const privateClosed = [];

export function newTabUrl() {
  const mode = setting('tabs.newTabPage');
  if (mode === 'blank') return 'bifrost://blank/';
  if (mode === 'url' && setting('tabs.newTabUrl')) return fixupUrl(setting('tabs.newTabUrl'));
  return NEWTAB_URL;
}

// ------------------------------------------------------------------- open
export function openTab(opts = {}) {
  const workspaceId = opts.workspaceId && wsById(opts.workspaceId) ? opts.workspaceId : S.activeWorkspaceId;
  const opener = opts.opener && S.tabs.includes(opts.opener) ? opts.opener : null;
  const tab = makeTab({
    url: opts.url || newTabUrl(), workspaceId, pinned: !!opts.pinned, history: opts.history || null,
    title: opts.title || '', favicon: opts.favicon || '', openerId: opener ? opener.id : null, muted: !!opts.muted,
  });
  let after = null, index = null;
  const list = wsTabs(workspaceId);
  if (opts.index != null) index = opts.index;
  else if (opts.after && S.tabs.includes(opts.after)) after = opts.after;
  else if (opener && opener.workspaceId === workspaceId) {
    // Links open next to the page they came from, after earlier links from it (like Chrome).
    let i = list.indexOf(opener);
    const sp = splitOf(opener);
    if (sp) i = Math.max(...sp.tabIds.map((id) => list.indexOf(tabById(id))));
    while (i + 1 < list.length && list[i + 1].openerId === opener.id && !list[i + 1].pinned) i++;
    after = list[i];
    if (!tab.pinned && opener.groupId) tab.groupId = opener.groupId;
  } else if ((opts.position || setting('tabs.newTabPosition')) === 'afterActive') {
    const act = activeTab();
    if (act && act.workspaceId === workspaceId) {
      const sp = splitOf(act);
      after = sp ? tabById(sp.tabIds[sp.tabIds.length - 1]) || act : act;
      if (!tab.pinned && act.groupId && !act.pinned) tab.groupId = act.groupId;
    }
  }
  if (opts.groupId !== undefined) tab.groupId = opts.groupId;
  insertTab(tab, { index, after });
  if (opts.lazy) tab.sleeping = true;
  else V.ensureView(tab);
  emit('structure', { added: tab });
  if (opts.active !== false) selectTab(tab, { focus: opts.focus !== false });
  else V.layout();
  return tab;
}

// Opens a URL somewhere: 'current' | 'newtab' | 'background' | 'window' | 'private' | 'split'.
export function openUrl(url, { where = 'current', opener = null, typed = false, focus = true, allowScript = false } = {}) {
  url = fixupUrl(String(url || '').trim());
  if (!url) return null;
  if (/^javascript:/i.test(url)) {
    // Bookmarklets run in the current page, and only from bookmarks.
    if (!allowScript) return null;
    const t = activeTab();
    if (t && t.wv && !isInternal(t.url)) V.loadUrl(t, url);
    return t;
  }
  if (where === 'window' && S.isPrivate) where = 'private';
  switch (where) {
    case 'newtab': return openTab({ url, active: true, opener, focus });
    case 'background': return openTab({ url, active: false, opener });
    case 'window': wb.send('window:open', { urls: [url] }); return null;
    case 'private': wb.send('window:open', { urls: [url], isPrivate: true }); return null;
    case 'split': {
      const cur = activeTab();
      const t = openTab({ url, active: false, opener: cur });
      if (cur) splitWith(t);
      return t;
    }
    default: {
      const t = activeTab();
      if (!t) return openTab({ url });
      V.loadUrl(t, url, { typed });
      if (focus) V.focusView(t);
      return t;
    }
  }
}

// ----------------------------------------------------------------- select
// from: the tab that was in front, when it's gone already (closed, moved to another space): by then the
// space has quietly made another tab its current one, which mustn't stop everything hearing of the switch.
export function selectTab(tab, { focus = true, from } = {}) {
  if (!tab || !S.tabs.includes(tab)) return;
  if (tab.workspaceId !== S.activeWorkspaceId) { switchWorkspace(tab.workspaceId, { select: tab, focus }); return; }
  const ws = curWs();
  const prev = from !== undefined ? from : activeTab();
  ws.activeTabId = tab.id;
  tab.lastActive = Date.now();
  const sp = splitOf(tab);
  if (sp) sp.focused = tab.id;
  const g = groupById(tab.groupId);
  if (g && g.collapsed) { g.collapsed = false; emit('structure'); }
  for (const t of visibleTabs()) V.ensureView(t);
  V.layout();
  if (prev !== tab) emit('active', tab, prev);
  if (tab.wcId != null) wb.send('tab:selected', tab.wcId);
  if (focus) focusTab(tab);
  updateTitle();
}

export function focusTab(tab) {
  if (!tab) return;
  if (isNewTab(tab.url) && !tab.canGoBack) emit('focus-address', tab);
  else V.focusView(tab);
}

export function updateTitle() {
  const t = activeTab();
  const title = t ? (t.title || displayUrl(t.url) || 'New tab') : 'Bifrost';
  wb.send('window:title', title + (S.isPrivate ? ' — Bifrost (Private)' : ' — Bifrost'));
}

export function selectRelative(delta) {
  const list = wsTabs().filter((t) => !t.groupId || !groupById(t.groupId).collapsed || t === activeTab());
  if (!list.length) return;
  const i = list.indexOf(activeTab());
  selectTab(list[(i + delta + list.length) % list.length]);
}

export function selectIndex(n) {
  const list = wsTabs();
  if (!list.length) return;
  selectTab(n < 0 ? list[list.length - 1] : list[Math.min(n, list.length - 1)]);
}

// ------------------------------------------------------------------ close
function pickNext(tab) {
  const sp = splitOf(tab);
  if (sp) {
    const other = sp.tabIds.map(tabById).filter((t) => t && t !== tab);
    if (other.length) return other[0];
  }
  const all = wsTabs(tab.workspaceId);
  const rest = all.filter((t) => t !== tab);
  if (!rest.length) return null;
  const i = all.indexOf(tab);
  const mode = setting('tabs.activateOnClose');
  if (mode === 'right') return all[i + 1] || all[i - 1];
  if (mode === 'left') return all[i - 1] || all[i + 1];
  // A tab opened from another and closed before you switched away returns to where you were.
  const opener = tabById(tab.openerId);
  if (opener && opener.workspaceId === tab.workspaceId && (opener.lastActive || 0) >= Math.max(...rest.map((t) => t.lastActive || 0))) return opener;
  return rest.slice().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
}

function rememberClosed(tab) {
  if (isNewTab(tab.url) && !(tab.history && tab.history.entries && tab.history.entries.length > 1)) return;
  const data = { url: tab.url, title: tab.title, favicon: tab.favicon, history: tab.history, workspaceId: tab.workspaceId, pinned: tab.pinned, index: wsTabs(tab.workspaceId).indexOf(tab) };
  if (S.isPrivate) { privateClosed.push(data); if (privateClosed.length > 25) privateClosed.shift(); }
  else wb.send('closed:push', data);
}

export function closeTab(tab, { remember = true } = {}) {
  if (!tab || !S.tabs.includes(tab)) return;
  const wasActive = tab === activeTab();
  const wasVisible = visibleTabs().includes(tab);
  const next = wasActive ? pickNext(tab) : null;
  if (remember) rememberClosed(tab);
  emit('tab-closing', tab);
  if (S.htmlFullscreenTab === tab) S.htmlFullscreenTab = null;
  V.destroyView(tab);
  removeTab(tab);
  if (!wsTabs(tab.workspaceId).length) {
    if (setting('tabs.closeWindowWithLastTab') && !S.tabs.length) {
      emit('structure');
      wb.send('window:control', 'close');
      return;
    }
    openTab({ workspaceId: tab.workspaceId, active: tab.workspaceId === S.activeWorkspaceId });
    return;
  }
  emit('structure', { removed: tab });
  if (wasActive && next) selectTab(next, { from: tab });
  else if (wasVisible) V.layout();
}

export function closeTabs(list) {
  const set = new Set(list);
  // Close from the end so selection lands sensibly.
  for (const t of [...S.tabs].reverse()) if (set.has(t)) closeTab(t);
}

// Closing tabs you asked to close (Ctrl+W, the × on a tab, its menu…): a page with changes that aren't
// saved gets to say so first, like Chrome's "Leave site?", once for all of them.
// How many of this window's pages would ask "Leave site?" if the window closed now (main/windows.js asks).
export async function dirtyCount() {
  const live = S.tabs.filter((t) => t.wcId != null && !t.sleeping && !t.crashed && t.wv);
  const answers = await Promise.all(live.map((t) => V.guest(t, 'unloadCheck').catch(() => false)));
  return answers.filter(Boolean).length;
}

let asking = false;   // (one "Leave site?" at a time)
export async function requestClose(list) {
  list = (Array.isArray(list) ? list : [list]).filter((t) => t && S.tabs.includes(t));
  if (!list.length) return false;
  const live = list.filter((t) => t.wcId != null && !t.sleeping && !t.crashed && t.wv);
  if (live.length) {
    const answers = await Promise.all(live.map((t) => V.guest(t, 'unloadCheck').catch(() => false)));
    const dirty = live.filter((_, i) => answers[i]).filter((t) => S.tabs.includes(t));
    if (dirty.length) {
      if (asking) return false;
      asking = true;
      try {
        if (!dirty.includes(activeTab())) selectTab(dirty[0]);
        const { confirmDialog } = await import('/_/common/dialogs.js');
        const one = dirty.length === 1;
        const where = one ? hostOf(dirty[0].url).replace(/^www\./, '') : '';
        const ok = await confirmDialog(one ? `Changes you made${where ? ' on ' + where : ''} may not be saved.` : 'Changes you made on them may not be saved.', {
          title: one ? 'Leave site?' : `Leave ${dirty.length} sites?`, ok: 'Leave', cancel: 'Stay',
        });
        if (!ok) return false;
      } finally { asking = false; }
    }
  }
  closeTabs(list.filter((t) => S.tabs.includes(t)));
  return true;
}

export async function reopenClosed(data) {
  if (!data) data = S.isPrivate ? privateClosed.pop() : await wb.invoke('closed:pop').catch(() => null);
  if (!data || !data.url) return null;
  const wsId = wsById(data.workspaceId) ? data.workspaceId : S.activeWorkspaceId;
  return openTab({ url: data.url, title: data.title, favicon: data.favicon, history: data.history, workspaceId: wsId, pinned: data.pinned, index: data.index, active: true });
}

export function privateClosedList() { return privateClosed.slice().reverse(); }

// ------------------------------------------------------------------ misc
export function duplicateTab(tab) {
  const list = wsTabs(tab.workspaceId);
  return openTab({
    url: tab.url, title: tab.title, favicon: tab.favicon, workspaceId: tab.workspaceId, index: list.indexOf(tab) + 1,
    history: tab.history ? JSON.parse(JSON.stringify(tab.history)) : null, groupId: tab.groupId, pinned: tab.pinned, active: true,
  });
}

export function togglePin(tab) {
  if (tab.splitId) leaveSplit(tab);
  setPinned(tab, !tab.pinned);
  emit('structure');
  V.layout();
}

export function toggleMute(tab) { V.setMuted(tab, !tab.muted); }

export async function sleep(tab) {
  if (tab === activeTab()) {
    const next = pickNext(tab);
    if (!next) return;
    selectTab(next);
  }
  await V.sleepTab(tab, { force: true });
  V.layout();
}

export function moveRelative(tab, delta) {
  const list = wsTabs(tab.workspaceId).filter((t) => t.pinned === tab.pinned);
  const i = list.indexOf(tab);
  const target = list[i + delta];
  if (!target) return;
  const all = wsTabs(tab.workspaceId);
  const g = groupById(target.groupId);
  if (tab.groupId && target.groupId !== tab.groupId) {
    // At the edge of its group: leave the group and stay put (like Chrome).
    tab.groupId = null;
    normalize();
  } else if (!tab.groupId && g) {
    if (g.collapsed) {
      // Hop over a collapsed group.
      const members = all.filter((t) => t.groupId === g.id);
      const edge = delta > 0 ? members[members.length - 1] : members[0];
      moveTab(tab, all.indexOf(edge));
    } else {
      tab.groupId = g.id;
      normalize();
    }
  } else {
    moveTab(tab, all.indexOf(target));
  }
  emit('structure');
}

// For extensions (chrome.tabs.move): index counts every tab in the window, -1 means the end. The tab
// stays in its space; pinned tabs and groups keep their usual order.
export function moveToIndex(tab, index) {
  const others = S.tabs.filter((x) => x !== tab);
  const before = index < 0 || index >= others.length ? others : others.slice(0, index);
  moveTab(tab, before.filter((x) => x.workspaceId === tab.workspaceId).length);
  emit('structure');
}

// -------------------------------------------------------------- workspaces
export function switchWorkspace(id, { select = null, focus = true } = {}) {
  const target = wsById(id);
  if (!target) return;
  const prev = curWs();
  if (prev && prev.id === id) { if (select) selectTab(select, { focus }); return; }
  S.activeWorkspaceId = id;
  if (select) target.activeTabId = select.id;
  if (!wsTabs(id).length) {
    const t = makeTab({ url: newTabUrl(), workspaceId: id });
    insertTab(t);
    V.ensureView(t);
    target.activeTabId = t.id;
    emit('structure');
  }
  emit('workspace', target, prev);
  const t = activeTab();
  if (t) {
    t.lastActive = Date.now();
    for (const v of visibleTabs()) V.ensureView(v);
    V.layout();
    emit('active', t, null);
    if (t.wcId != null) wb.send('tab:selected', t.wcId);
    if (focus) focusTab(t);
  }
  updateTitle();
}

export function switchWorkspaceRelative(delta) {
  const i = S.workspaces.findIndex((w) => w.id === S.activeWorkspaceId);
  const n = S.workspaces.length;
  if (n < 2) return;
  switchWorkspace(S.workspaces[(i + delta + n) % n].id);
}

export function addWorkspace(props = {}, { switchTo = true } = {}) {
  const w = createWorkspace(props);
  emit('structure');
  if (switchTo) switchWorkspace(w.id);
  return w;
}

export function removeWorkspace(id) {
  if (S.workspaces.length < 2) return false;
  const w = wsById(id);
  if (!w) return false;
  for (const t of wsTabs(id)) { rememberClosed(t); V.destroyView(t); }
  S.tabs = S.tabs.filter((t) => t.workspaceId !== id);
  const idx = S.workspaces.indexOf(w);
  S.workspaces.splice(idx, 1);
  const wasActive = S.activeWorkspaceId === id;
  normalize();
  emit('structure');
  if (wasActive) {
    S.activeWorkspaceId = null;
    switchWorkspace(S.workspaces[Math.max(0, idx - 1)].id);
  }
  return true;
}

export function moveTabToWorkspace(tab, wsId) {
  if (!wsById(wsId) || tab.workspaceId === wsId) return;
  const from = tab.workspaceId;
  const wasActive = tab === activeTab();
  const next = wasActive ? pickNext(tab) : null;
  if (tab.splitId) leaveSplit(tab);
  tab.groupId = null;
  tab.workspaceId = wsId;
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  S.tabs.push(tab);
  normalize();
  const target = wsById(wsId);
  target.activeTabId = target.activeTabId || tab.id;
  if (!wsTabs(from).length) {
    const t = makeTab({ url: newTabUrl(), workspaceId: from });
    insertTab(t);
    if (from === S.activeWorkspaceId) V.ensureView(t);
  }
  emit('structure');
  if (wasActive) selectTab(next && next.workspaceId === from ? next : wsTabs(from)[0], { from: tab });
  else V.layout();
}

// ------------------------------------------------------------------ split
export function splitTabs(tabs, { orientation, focusTab: focusT } = {}) {
  tabs = tabs.filter((t) => t && S.tabs.includes(t));
  const sp = createSplit(tabs, { orientation });
  if (!sp) return null;
  emit('structure');
  for (const t of tabs) V.ensureView(t);
  const act = activeTab();
  selectTab(focusT || (tabs.includes(act) ? act : tabs[0]));
  emit('split-changed', sp);
  return sp;
}

// tab beside the one in front: added to the split view that one is in (next to it, up to four), or the
// two in a new split view.
export function splitWith(tab, { focusTab: focusT = tab } = {}) {
  const cur = activeTab();
  if (!tab || !cur || tab === cur || !S.tabs.includes(tab)) return null;
  const sp = splitOf(cur);
  if (sp && sp.tabIds.includes(tab.id)) { selectTab(tab); return sp; }
  if (sp && sp.tabIds.length < 4) {
    const ids = sp.tabIds.slice();
    ids.splice(ids.indexOf(cur.id) + 1, 0, tab.id);
    return splitTabs(ids.map(tabById).filter(Boolean), { orientation: sp.orientation, focusTab: focusT });
  }
  return splitTabs([cur, tab], { focusTab: focusT });
}

export function splitWithNext(tab = activeTab()) {
  if (!tab) return;
  const sp = splitOf(tab);
  if (sp && sp.tabIds.length >= 4) return;
  const list = wsTabs(tab.workspaceId).filter((t) => !t.splitId || t.splitId !== tab.splitId);
  const i = list.indexOf(tab);
  const other = list[i + 1] || list[i - 1];
  if (other) splitTabs(sp ? sp.tabIds.map(tabById).concat(other) : [tab, other], { focusTab: tab });
  else openUrl(newTabUrl(), { where: 'split' });
}

export function unsplit(tab = activeTab()) {
  const sp = splitOf(tab);
  if (!sp) return;
  dissolveSplit(sp);
  emit('structure');
  selectTab(tab);
}

export function rotateSplit(tab = activeTab()) {
  const sp = splitOf(tab);
  if (!sp) return;
  sp.orientation = sp.orientation === 'column' ? 'row' : 'column';
  emit('structure');
  V.layout();
}

export function swapPanes(tab) {
  const sp = splitOf(tab);
  if (!sp) return;
  const i = sp.tabIds.indexOf(tab.id);
  const j = (i + 1) % sp.tabIds.length;
  [sp.tabIds[i], sp.tabIds[j]] = [sp.tabIds[j], sp.tabIds[i]];
  [sp.sizes[i], sp.sizes[j]] = [sp.sizes[j], sp.sizes[i]];
  // Keep tab order in step with pane order.
  const tabs = sp.tabIds.map(tabById);
  const first = Math.min(...tabs.map((t) => S.tabs.indexOf(t)));
  for (const t of tabs) S.tabs.splice(S.tabs.indexOf(t), 1);
  S.tabs.splice(first, 0, ...tabs);
  normalize();
  emit('structure');
  V.layout();
}

export function focusPane(delta) {
  const t = activeTab();
  const sp = splitOf(t);
  if (!sp) return;
  const i = sp.tabIds.indexOf(t.id);
  selectTab(tabById(sp.tabIds[(i + delta + sp.tabIds.length) % sp.tabIds.length]));
}

// ------------------------------------------------------------ other windows
export async function moveTabToWindow(tab, windowId) {
  await V.refreshNav(tab, 0);
  const data = { url: tab.url, title: tab.title, favicon: tab.favicon, history: tab.history, pinned: tab.pinned, muted: tab.muted };
  try {
    await wb.invoke('window:move-tab', { windowId, tab: data });
    closeTab(tab, { remember: false });
  } catch (e) { emit('toast', { text: 'Couldn’t move the tab: ' + e.message }); }
}

export function adopt(data) {
  if (!data || !data.url) return null;
  return openTab({ url: data.url, title: data.title, favicon: data.favicon, history: data.history, pinned: data.pinned, muted: data.muted, active: true, position: 'end' });
}

// ------------------------------------------------------------------- init
export function init() {
  on('guest-close', (tab) => closeTab(tab));
  on('tab', (tab, patch) => { if (tab === activeTab() && ('title' in patch || 'url' in patch)) updateTitle(); });
  on('pane-click', (tab) => { if (tab !== activeTab()) selectTab(tab); });
  on('view-focus', (tab) => { if (tab !== activeTab() && visibleTabs().includes(tab)) selectTab(tab, { focus: false }); });
  on('pane-command', (tab, cmd) => {
    if (cmd === 'close') closeTab(tab);
    else if (cmd === 'maximize') unsplit(tab);
    else if (cmd === 'swap') swapPanes(tab);
  });
  on('search-for', (tab, text) => emit('launcher-search', text));
}

export { tabByWc };
