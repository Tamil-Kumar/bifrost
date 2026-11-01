'use strict';
// chrome.tabs as Bifrost sees it: real tab order and windows, the calling tab, moving, duplicating,
// discarding (Bifrost's sleeping tabs), zoom and screenshots, plus onMoved/onHighlighted events.
// electron-chrome-extensions handles the rest (create, update, remove, reload, navigation, events).
const { webContents: WC, BrowserWindow } = require('electron');
const ctx = require('../context');
const patterns = require('./patterns');

const WINDOW_ID_CURRENT = -2;

function install({ handle, router, extensions }) {
  const original = (name) => router.handlers.get(name);

  // Every live tab in normal windows: [{ wc, ctl, tab }] in window, then tab order.
  function liveTabs() {
    const out = [];
    for (const ctl of ctx.registry.list()) {
      if (ctl.isPrivate || ctl.win.isDestroyed()) continue;
      for (const tab of ctl.tabs.slice().sort((a, b) => a.index - b.index)) {
        if (tab.wcId == null) continue;
        const wc = WC.fromId(tab.wcId);
        if (wc && !wc.isDestroyed()) out.push({ wc, ctl, tab });
      }
    }
    return out;
  }
  // A tab by id. The window's UI reports new tabs a moment after they exist, so a tab it hasn't
  // reported yet is described from its webContents and window directly.
  function byTabId(id) {
    const found = liveTabs().find((x) => x.wc.id === Number(id));
    if (found) return found;
    const wc = WC.fromId(Number(id));
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.session !== extensions.ses || wc.__wbPanel) return null;
    const host = wc.hostWebContents;
    const win = host && BrowserWindow.fromWebContents(host);
    const ctl = win && ctx.registry.get(win.id);
    if (!ctl || ctl.isPrivate) return null;
    return { wc, ctl, tab: { wcId: wc.id, index: ctl.tabs.length, active: false, pinned: false, url: wc.getURL(), title: wc.getTitle() } };
  }
  const mustTab = (id) => { const x = byTabId(id); if (!x) throw new Error(`No tab with id: ${id}.`); return x; };

  function details({ wc, ctl, tab }) {
    const [width, height] = ctl.win.getContentSize();
    const out = {
      id: wc.id, index: tab.index, windowId: ctl.id, openerTabId: undefined,
      active: !!tab.active, highlighted: !!tab.active, selected: !!tab.active, pinned: !!tab.pinned,
      audible: wc.isCurrentlyAudible(), mutedInfo: { muted: wc.isAudioMuted() }, discarded: false, autoDiscardable: true, frozen: false,
      status: wc.isLoading() ? 'loading' : 'complete', title: wc.getTitle() || tab.title || '', url: wc.getURL() || tab.url,
      favIconUrl: tab.favicon || undefined, incognito: false, width, height,
      groupId: tab.groupNumeric != null ? tab.groupNumeric : -1, lastAccessed: tab.lastActive || undefined,
    };
    if (out.status === 'loading' && tab.url && tab.url !== out.url) out.pendingUrl = tab.url;
    return out;
  }
  extensions.tabDetailsFor = (wc) => { const x = byTabId(wc.id); return x ? details(x) : null; };
  extensions.tabWebContents = (id) => { const x = byTabId(id); return x ? x.wc : null; };
  extensions.activeTabWebContents = () => {
    const ctl = ctx.registry.lastFocused({ private: false });
    const t = ctl && ctl.tabs.find((x) => x.active);
    const wc = t && t.wcId != null ? WC.fromId(t.wcId) : null;
    return wc && !wc.isDestroyed() ? wc : null;
  };

  // The window an extension context means by "current": the tab's own window for pages in tabs,
  // otherwise the last focused normal window (popups and service workers).
  function currentWindowId(ev) {
    if (ev && ev.type === 'frame' && ev.sender) {
      const found = ctx.registry.find(ev.sender.id);
      if (found) return found.ctl.id;
    }
    const ctl = ctx.registry.lastFocused({ private: false });
    return ctl ? ctl.id : -1;
  }
  extensions.currentWindowId = currentWindowId;

  handle('tabs.query', (ev, info = {}) => {
    const cur = currentWindowId(ev);
    const last = ctx.registry.lastFocused({ private: false });
    const set = (k) => info[k] !== undefined && info[k] !== null;
    return liveTabs().map(details).filter((t) => {
      if (set('active') && t.active !== info.active) return false;
      if (set('highlighted') && t.highlighted !== info.highlighted) return false;
      if (set('pinned') && t.pinned !== info.pinned) return false;
      if (set('audible') && t.audible !== info.audible) return false;
      if (set('muted') && t.mutedInfo.muted !== info.muted) return false;
      if (set('discarded') && t.discarded !== info.discarded) return false;
      if (set('autoDiscardable') && t.autoDiscardable !== info.autoDiscardable) return false;
      if (set('frozen') && t.frozen !== info.frozen) return false;
      if (set('status') && t.status !== info.status) return false;
      if (set('groupId') && t.groupId !== info.groupId) return false;
      if (set('index') && t.index !== info.index) return false;
      if (set('windowType') && info.windowType !== 'normal') return false;
      if (set('currentWindow') && (t.windowId === cur) !== !!info.currentWindow) return false;
      if (set('lastFocusedWindow') && (t.windowId === (last ? last.id : -1)) !== !!info.lastFocusedWindow) return false;
      if (set('windowId') && t.windowId !== (info.windowId === WINDOW_ID_CURRENT ? cur : info.windowId)) return false;
      if (set('title') && !patterns.globMatches(info.title, t.title)) return false;
      if (set('url') && !patterns.matchesAny([].concat(info.url), t.url)) return false;
      return true;
    });
  });
  handle('tabs.get', (ev, id) => details(mustTab(id)));
  handle('tabs.getCurrent', (ev) => {
    if (ev.type !== 'frame' || !ev.sender) return undefined;
    const x = byTabId(ev.sender.id);
    return x ? details(x) : undefined;
  });

  // tabs.update also handles pinned and active (the window puts the tab in front, then reports it, which
  // fires tabs.onActivated); the library does url and muted.
  const update0 = original('tabs.update');
  handle('tabs.update', async (ev, a1, a2) => {
    const id = typeof a1 === 'number' ? a1 : undefined;
    const props = (typeof a1 === 'object' ? a1 : a2) || {};
    const x = id != null ? mustTab(id) : byTabId((extensions.activeTabWebContents() || {}).id);
    if (!x) throw new Error('No active tab.');
    const rest = Object.assign({}, props);
    if (typeof props.pinned === 'boolean') {
      delete rest.pinned;
      await x.ctl.request('extension-tab-op', { op: 'pin', wcId: x.wc.id, pinned: props.pinned });
    }
    if (props.active === true || props.highlighted === true || props.selected === true) {
      await x.ctl.request('extension-tab-op', { op: 'select', wcId: x.wc.id });
    }
    delete rest.active; delete rest.highlighted; delete rest.autoDiscardable; delete rest.openerTabId; delete rest.selected;
    if (Object.keys(rest).length && update0) await update0.callback(ev, x.wc.id, rest);
    const fresh = byTabId(x.wc.id);
    return fresh ? details(fresh) : undefined;
  });

  handle('tabs.move', async (ev, ids, props = {}) => {
    const list = [].concat(ids);
    const out = [];
    let index = Number.isInteger(props.index) ? props.index : -1;
    for (const id of list) {
      const x = mustTab(id);
      const windowId = props.windowId != null && props.windowId !== WINDOW_ID_CURRENT ? Number(props.windowId) : x.ctl.id;
      if (windowId !== x.ctl.id) {
        const target = ctx.registry.get(windowId);
        if (!target || target.isPrivate) throw new Error(`No window with id: ${windowId}.`);
        // Moving between windows reopens the page there (with its history), so it gets a new id.
        const r = await x.ctl.request('extension-tab-op', { op: 'move-window', wcId: x.wc.id, windowId });
        if (r && r.wcId != null) { const moved = byTabId(r.wcId); if (moved) out.push(details(moved)); }
        continue;
      }
      await x.ctl.request('extension-tab-op', { op: 'move', wcId: x.wc.id, index });
      const moved = byTabId(x.wc.id);
      if (moved) out.push(details(moved));
      if (index >= 0) index++;
    }
    return Array.isArray(ids) ? out : out[0];
  });

  handle('tabs.duplicate', async (ev, id) => {
    const x = mustTab(id);
    const r = await x.ctl.request('extension-tab-op', { op: 'duplicate', wcId: x.wc.id });
    const d = r && r.wcId != null ? byTabId(r.wcId) : null;
    return d ? details(d) : undefined;
  });

  handle('tabs.discard', async (ev, id) => {
    const x = id != null ? mustTab(id) : liveTabs().find((t) => !t.tab.active && !t.tab.pinned && !t.wc.isCurrentlyAudible());
    if (!x) return undefined;
    const snapshot = Object.assign(details(x), { discarded: true, status: 'unloaded' });
    const r = await x.ctl.request('extension-tab-op', { op: 'discard', wcId: x.wc.id });
    return r && r.ok ? snapshot : undefined;
  });

  handle('tabs.highlight', async (ev, info = {}) => {
    const windowId = info.windowId != null && info.windowId !== WINDOW_ID_CURRENT ? info.windowId : currentWindowId(ev);
    const ctl = ctx.registry.get(windowId);
    if (!ctl) throw new Error(`No window with id: ${windowId}.`);
    const first = [].concat(info.tabs)[0];
    const tab = ctl.tabs.find((t) => t.index === first);
    if (!tab) throw new Error(`No tab at index: ${first}.`);
    if (tab.wcId != null) ctl.send('extension-tab-action', { wcId: tab.wcId, action: 'select' });
    else ctl.send('select-tab', tab.id);
    return { id: ctl.id, focused: ctl.win.isFocused(), top: ctl.win.getBounds().y, left: ctl.win.getBounds().x, width: ctl.win.getBounds().width, height: ctl.win.getBounds().height, incognito: false, type: 'normal', state: ctl.win.isMaximized() ? 'maximized' : ctl.win.isMinimized() ? 'minimized' : 'normal', alwaysOnTop: false };
  });

  handle('tabs.captureVisibleTab', async (ev, a1, a2) => {
    const windowId = typeof a1 === 'number' && a1 !== WINDOW_ID_CURRENT ? a1 : currentWindowId(ev);
    const opts = (typeof a1 === 'object' && a1) || (typeof a2 === 'object' && a2) || {};
    const ctl = ctx.registry.get(windowId);
    const t = ctl && ctl.tabs.find((x) => x.active);
    const wc = t && t.wcId != null ? WC.fromId(t.wcId) : null;
    if (!wc) throw new Error('No active tab.');
    const m = ev.extension.manifest || {};
    const hosts = patterns.hostPatterns(m);
    const allowed = (m.permissions || []).includes('activeTab') || patterns.matchesAny(hosts, wc.getURL()) || wc.getURL().startsWith(`chrome-extension://${ev.extension.id}/`);
    if (!allowed) throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
    const img = await wc.capturePage();
    if (opts.format === 'png') return img.toDataURL();
    const q = Number.isFinite(opts.quality) ? Math.max(0, Math.min(100, opts.quality)) : 92;
    return 'data:image/jpeg;base64,' + img.toJPEG(q).toString('base64');
  });

  const ZOOM_SETTINGS = { mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1 };
  const tabOrActive = (ev, id) => (id != null ? mustTab(id) : byTabId((extensions.activeTabWebContents() || {}).id));
  handle('tabs.getZoom', (ev, id) => { const x = tabOrActive(ev, id); if (!x) throw new Error('No active tab.'); return x.wc.getZoomFactor(); });
  handle('tabs.setZoom', (ev, a1, a2) => {
    const id = typeof a2 === 'number' ? a1 : undefined;
    const factor = typeof a2 === 'number' ? a2 : a1;
    const x = tabOrActive(ev, id);
    if (!x) throw new Error('No active tab.');
    const old = x.wc.getZoomFactor();
    const f = !factor ? 1 : Math.max(0.25, Math.min(5, Number(factor)));
    require('../guests').setZoom(x.wc, Math.log(f) / Math.log(1.2));
    router.broadcastEvent('tabs.onZoomChange', { tabId: x.wc.id, oldZoomFactor: old, newZoomFactor: f, zoomSettings: ZOOM_SETTINGS });
  });
  handle('tabs.getZoomSettings', () => ZOOM_SETTINGS);
  handle('tabs.setZoomSettings', () => undefined);
  handle('tabs.detectLanguage', async (ev, id) => {
    const x = tabOrActive(ev, id);
    if (!x) throw new Error('No active tab.');
    const lang = await x.wc.executeJavaScript('document.documentElement.lang || ""', false).catch(() => '');
    return String(lang || '').split(/[-_]/)[0].toLowerCase() || 'und';
  });

  // ---------------------------------------------------- events from snapshots
  // The UI pushes its tab list whenever it changes; work out what extensions should hear.
  const prev = new Map(); // window id -> { order: [wcId], tabs: Map(wcId -> tab) }
  ctx.registry.on('tabs-changed', (ctl) => {
    if (ctl.isPrivate) return;
    const before = prev.get(ctl.id) || { order: [], tabs: new Map() };
    const live = ctl.tabs.filter((t) => t.wcId != null).sort((a, b) => a.index - b.index);
    const now = { order: live.map((t) => t.wcId), tabs: new Map(live.map((t) => [t.wcId, Object.assign({}, t)])) };
    prev.set(ctl.id, now);
    for (const t of live) {
      const was = before.tabs.get(t.wcId);
      if (!was) continue;
      const wc = WC.fromId(t.wcId);
      if (!wc || wc.isDestroyed()) continue;
      if (was.pinned !== t.pinned || was.groupNumeric !== t.groupNumeric) wc.emit('tab-updated');
      if (!was.active && t.active) router.broadcastEvent('tabs.onHighlighted', { windowId: ctl.id, tabIds: [t.wcId] });
    }
    for (const id of movedTabs(before.order, now.order)) {
      const t = now.tabs.get(id), was = before.tabs.get(id);
      router.broadcastEvent('tabs.onMoved', id, { windowId: ctl.id, fromIndex: was.index, toIndex: t.index });
    }
  });
  ctx.registry.on('window-removed', (ctl) => prev.delete(ctl.id));

  // Tabs whose position among the tabs present before and after changed: the ones outside the longest
  // run that kept its order (so opening or closing tabs doesn't count as moving the others).
  function movedTabs(beforeOrder, afterOrder) {
    const common = afterOrder.filter((id) => beforeOrder.includes(id));
    if (common.length < 2) return [];
    const pos = new Map(beforeOrder.map((id, i) => [id, i]));
    const seq = common.map((id) => pos.get(id));
    // Longest increasing subsequence (patience sorting with back-pointers).
    const tails = [], tailIdx = [], back = new Array(seq.length).fill(-1);
    for (let i = 0; i < seq.length; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < seq[i]) lo = mid + 1; else hi = mid; }
      tails[lo] = seq[i]; tailIdx[lo] = i;
      back[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    }
    const keep = new Set();
    for (let i = tailIdx[tails.length - 1]; i >= 0; i = back[i]) keep.add(common[i]);
    return common.filter((id) => !keep.has(id));
  }
  extensions.movedTabs = movedTabs; // for tests

  // electron-chrome-extensions asks for these when it builds its own tab details (tabs.create and
  // tabs.update results, tab events).
  extensions.assignTabDetails = (d, wc) => {
    const found = ctx.registry.find(wc.id);
    if (!found) return;
    const t = found.tab;
    d.pinned = !!t.pinned;
    if (typeof t.index === 'number') d.index = t.index;
    d.groupId = t.groupNumeric != null ? t.groupNumeric : -1;
    d.windowId = found.ctl.id;
    d.active = !!t.active;
    d.highlighted = !!t.active;
    if (t.favicon) d.favIconUrl = t.favicon;
    if (t.lastActive) d.lastAccessed = t.lastActive;
  };
}

module.exports = { install };
