'use strict';
// Main-process mirror of every browser window and its tabs. The UI in each window owns its tab model and
// pushes snapshots here; extensions, the launcher, session saving and permission prompts read from it.
const { EventEmitter } = require('node:events');

class Registry extends EventEmitter {
  constructor() {
    super();
    this.windows = new Map();   // window id -> controller
    this.byWc = new Map();      // guest webContents id -> { ctl, tab }
    this.focusOrder = [];       // window ids, most recently focused last
  }

  addWindow(ctl) {
    this.windows.set(ctl.id, ctl);
    this.focus(ctl.id);
    this.emit('window-added', ctl);
  }

  removeWindow(id) {
    const ctl = this.windows.get(id);
    if (!ctl) return;
    for (const t of ctl.tabs) if (t.wcId != null) this.byWc.delete(t.wcId);
    this.windows.delete(id);
    this.focusOrder = this.focusOrder.filter((x) => x !== id);
    this.emit('window-removed', ctl);
  }

  focus(id) {
    this.focusOrder = this.focusOrder.filter((x) => x !== id);
    this.focusOrder.push(id);
  }

  lastFocused(opts = {}) {
    for (let i = this.focusOrder.length - 1; i >= 0; i--) {
      const ctl = this.windows.get(this.focusOrder[i]);
      if (!ctl || ctl.win.isDestroyed()) continue;
      if (opts.private === false && ctl.isPrivate) continue;
      return ctl;
    }
    return null;
  }

  // Snapshot from a window's UI: [{ id, wcId, url, title, favicon, pinned, groupId, workspaceId, splitId, active, lastActive, audible, muted, discarded, index }]
  syncTabs(ctl, tabs) {
    for (const t of ctl.tabs) if (t.wcId != null && this.byWc.get(t.wcId)?.ctl === ctl) this.byWc.delete(t.wcId);
    ctl.tabs = Array.isArray(tabs) ? tabs : [];
    for (const t of ctl.tabs) if (t.wcId != null) this.byWc.set(t.wcId, { ctl, tab: t });
    this.emit('tabs-changed', ctl);
  }

  find(wcId) { return this.byWc.get(wcId) || null; }

  allTabs({ includePrivate = false, onlyWindow = null } = {}) {
    const out = [];
    for (const ctl of this.windows.values()) {
      if (onlyWindow && ctl !== onlyWindow) continue;
      if (ctl.isPrivate && !includePrivate && ctl !== onlyWindow) continue;
      for (const t of ctl.tabs) out.push({ ctl, tab: t });
    }
    return out;
  }

  get(id) { return this.windows.get(id) || null; }
  list() { return [...this.windows.values()]; }
}

module.exports = new Registry();
