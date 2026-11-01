'use strict';
// chrome.sidePanel: an extension's page shown in Bifrost's side panel, next to the tabs. Panels show up
// as extra buttons at the top of the side panel; extensions can open them, or have their toolbar button
// open them (setPanelBehavior).
const ctx = require('../context');

const BEHAVIOR_KEY = 'extensions.sidePanelBehavior';

function install({ handle, router, extensions }) {
  const opts = new Map(); // extId -> { global: { path, enabled }, tabs: Map(tabId -> { path, enabled }) }
  const openIn = new Map(); // window id -> extId whose panel is showing

  const ext = (id) => extensions.ses.extensions.getExtension(id);
  const manifestPath = (e) => (e && e.manifest && e.manifest.side_panel && e.manifest.side_panel.default_path) || '';
  function state(extId) {
    let s = opts.get(extId);
    if (!s) {
      const path = manifestPath(ext(extId));
      s = { global: { path, enabled: !!path }, tabs: new Map() };
      opts.set(extId, s);
    }
    return s;
  }
  function effective(extId, tabId) {
    const s = state(extId);
    const t = tabId != null ? s.tabs.get(tabId) : null;
    return { path: (t && t.path) || s.global.path, enabled: t && t.enabled !== undefined ? t.enabled : s.global.enabled };
  }
  const activeTabId = (ctl) => { const t = ctl && ctl.tabs.find((x) => x.active); return t && t.wcId != null ? t.wcId : null; };
  const urlFor = (extId, path) => `chrome-extension://${extId}/${String(path || '').replace(/^\//, '')}`;
  const idOf = (ev) => { if (!ev.extension) throw new Error('Unknown extension'); return ev.extension.id; };
  function windowFor(ev, o = {}) {
    if (o.windowId != null) { const c = ctx.registry.get(o.windowId); if (!c || c.isPrivate) throw new Error(`No window with id: ${o.windowId}.`); return c; }
    if (o.tabId != null) { const f = ctx.registry.find(o.tabId); if (!f) throw new Error(`No tab with id: ${o.tabId}.`); return f.ctl; }
    const id = extensions.currentWindowId(ev);
    const c = ctx.registry.get(id);
    if (!c) throw new Error('No window.');
    return c;
  }
  const notify = () => { for (const ctl of ctx.registry.list()) if (!ctl.isPrivate) ctl.send('extension-side-panels-changed'); };

  handle('sidePanel.setOptions', (ev, o = {}) => {
    const id = idOf(ev);
    const s = state(id);
    const target = o.tabId != null ? (s.tabs.get(o.tabId) || {}) : s.global;
    if (o.path !== undefined) target.path = String(o.path || '');
    if (o.enabled !== undefined) target.enabled = !!o.enabled;
    if (o.tabId != null) s.tabs.set(o.tabId, target);
    notify();
    // A panel that just got disabled closes.
    for (const [winId, open] of openIn) {
      if (open !== id) continue;
      const ctl = ctx.registry.get(winId);
      if (ctl && !effective(id, activeTabId(ctl)).enabled) close(id, ctl);
    }
  }, { permission: 'sidePanel' });
  handle('sidePanel.getOptions', (ev, o = {}) => Object.assign(o.tabId != null ? { tabId: o.tabId } : {}, effective(idOf(ev), o.tabId)), { permission: 'sidePanel' });
  handle('sidePanel.setPanelBehavior', (ev, b = {}) => {
    const all = ctx.db.kvGet(BEHAVIOR_KEY, {}) || {};
    if (b.openPanelOnActionClick !== undefined) all[idOf(ev)] = !!b.openPanelOnActionClick;
    ctx.db.kvSet(BEHAVIOR_KEY, all);
  }, { permission: 'sidePanel' });
  handle('sidePanel.getPanelBehavior', (ev) => ({ openPanelOnActionClick: !!(ctx.db.kvGet(BEHAVIOR_KEY, {}) || {})[idOf(ev)] }), { permission: 'sidePanel' });
  handle('sidePanel.open', (ev, o = {}) => { open(idOf(ev), windowFor(ev, o), o.tabId); }, { permission: 'sidePanel' });
  handle('sidePanel.close', (ev, o = {}) => { close(idOf(ev), windowFor(ev, o)); }, { permission: 'sidePanel' });
  handle('sidePanel.getLayout', () => ({ side: ctx.settings.get('appearance.sidebarSide') === 'right' ? 'right' : 'left' }), { permission: 'sidePanel' });

  function open(extId, ctl, tabId) {
    if (!ctl || ctl.isPrivate) return false;
    const e = effective(extId, tabId != null ? tabId : activeTabId(ctl));
    if (!e.path || !e.enabled) throw new Error('No active side panel for tabId: ' + (tabId != null ? tabId : activeTabId(ctl)));
    ctl.send('extension-side-panel', { id: extId, url: urlFor(extId, e.path), open: true });
    return true;
  }
  function close(extId, ctl) {
    if (!ctl) return;
    ctl.send('extension-side-panel', { id: extId, open: false });
  }

  // The UI reports what's actually showing, which is when extensions hear about it.
  extensions.sidePanelShown = (ctl, extId, path, shown) => {
    const was = openIn.get(ctl.id);
    if (shown) {
      openIn.set(ctl.id, extId);
      if (was && was !== extId) router.sendEvent(was, 'sidePanel.onClosed', { windowId: ctl.id, path: effective(was, null).path });
      if (was !== extId) router.sendEvent(extId, 'sidePanel.onOpened', { windowId: ctl.id, path });
    } else if (was === extId) {
      openIn.delete(ctl.id);
      router.sendEvent(extId, 'sidePanel.onClosed', { windowId: ctl.id, path });
    }
  };

  // Side panels available in a window (for its active tab), for the panel's buttons.
  extensions.sidePanels = (ctl) => {
    const tabId = activeTabId(ctl);
    const out = [];
    for (const e of extensions.ses.extensions.getAllExtensions()) {
      if (!manifestPath(e) && !(opts.get(e.id) && opts.get(e.id).global.path)) continue;
      const perms = (e.manifest && e.manifest.permissions) || [];
      if (!perms.includes('sidePanel')) continue;
      const eff = effective(e.id, tabId);
      if (!eff.path || !eff.enabled) continue;
      out.push({ id: e.id, name: extensions.localizeString(e, e.name), icon: extensions.iconFor(e), url: urlFor(e.id, eff.path) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };
  extensions.openSidePanel = (extId, ctl) => { try { return open(extId, ctl); } catch (e) { ctl.send('toast', { text: e.message }); return false; } };
  extensions.panelOnActionClick = (extId) => !!(ctx.db.kvGet(BEHAVIOR_KEY, {}) || {})[extId];

  extensions.ses.extensions.on('extension-unloaded', (e, x) => {
    opts.delete(x.id);
    for (const [winId, open] of openIn) if (open === x.id) { const ctl = ctx.registry.get(winId); if (ctl) close(x.id, ctl); }
    notify();
  });
  extensions.ses.extensions.on('extension-loaded', () => notify());
  ctx.registry.on('tabs-changed', (ctl) => {
    // Tab-specific panels follow the active tab.
    const tabId = activeTabId(ctl);
    if (ctl.__wbPanelTab === tabId) return;
    ctl.__wbPanelTab = tabId;
    if ([...opts.values()].some((s) => s.tabs.size)) ctl.send('extension-side-panels-changed');
  });
}

module.exports = { install };
