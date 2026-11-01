'use strict';
// Saves each window's tabs, workspaces and splits continuously (session.json), so the browser comes back
// the way you left it, including after a crash.
const fs = require('node:fs');
const path = require('node:path');

class SessionStore {
  constructor(dir) {
    this.file = path.join(dir, 'session.json');
    this.state = this.read() || { version: 1, windows: {} };
    this.timer = null;
  }

  read() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const s = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (s && typeof s.windows === 'object') return s;
      } catch { /* missing or corrupt */ }
    }
    return null;
  }

  // Windows from last time, most recently focused last.
  windowsToRestore() {
    return Object.entries(this.state.windows)
      .map(([key, w]) => Object.assign({ key }, w))
      .filter((w) => w.ui && Array.isArray(w.ui.workspaces))
      .sort((a, b) => (a.focusedAt || 0) - (b.focusedAt || 0));
  }

  save(key, ui, extra = {}) {
    const prev = this.state.windows[key] || {};
    this.state.windows[key] = Object.assign(prev, extra, { ui, savedAt: Date.now() });
    this.writeSoon();
  }

  touch(key) {
    if (this.state.windows[key]) { this.state.windows[key].focusedAt = Date.now(); this.writeSoon(); }
  }

  removeWindow(key) {
    delete this.state.windows[key];
    this.writeSoon();
  }

  clear() { this.state.windows = {}; this.writeNow(); }

  writeSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.writeNow(), 400);
  }

  writeNow() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      const tmp = this.file + '.tmp';
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[session] save failed', e);
    }
    // Sync passes your open tabs on to your other computers.
    if (this.onWrite) { try { this.onWrite(); } catch { /* best effort */ } }
  }
}

module.exports = { SessionStore };
