'use strict';
// chrome.runtime.onInstalled and chrome.runtime.onStartup, which Electron never fires. Extensions set
// themselves up in them all the time (context menus, default settings, alarms, rules, a welcome page), so
// without them many only half work. Bifrost works out which one applies to each extension as it loads:
//   onInstalled  "install" the first time, "update" when its version changed (or an unpacked one was
//                reloaded), "chrome_update" when Bifrost itself was updated
//   onStartup    each time Bifrost starts with the extension already installed
// and its background (service worker or background page) gets it the first time it listens: preload.js
// asks for it then (runtime.pendingLifecycle), so nothing can arrive before its listeners exist.
const { app } = require('electron');
const ctx = require('../context');

class Lifecycle {
  constructor(extensions) {
    this.extensions = extensions;
    this.starting = true;          // until the extensions that were there at startup have loaded
    this.installed = new Map();    // id -> pending onInstalled details (or null once handed over)
    this.startupDue = new Set();   // ids that get onStartup this run
    this.reloading = new Set();    // ids being reloaded (an unpacked extension's "Reload")
    const lastApp = ctx.db.kvGet('extensions.appVersion', null);
    this.appUpdated = !!lastApp && lastApp !== app.getVersion();
    // Bifrost versions before this one kept no record: extensions already there when it first runs get
    // "update" (they set themselves up again) rather than "install" (which opens welcome pages).
    this.noRecord = ctx.db.kvGet('extensions.versions', null) == null;
  }

  versions() { return ctx.db.kvGet('extensions.versions', {}); }

  // An extension finished loading.
  loaded(ext) {
    if (!ext || !ext.id) return;
    const seen = this.versions();
    const prev = Object.prototype.hasOwnProperty.call(seen, ext.id) ? seen[ext.id] : null;
    const version = String((ext.manifest && ext.manifest.version) || ext.version || '');
    let details = null;
    if (prev == null) details = this.starting && this.noRecord ? { reason: 'update', previousVersion: version } : { reason: 'install' };
    else if (prev !== version || this.reloading.has(ext.id)) details = { reason: 'update', previousVersion: prev };
    else if (this.starting && this.appUpdated) details = { reason: 'chrome_update' };
    this.reloading.delete(ext.id);
    this.installed.set(ext.id, details);
    if (this.starting && prev != null) this.startupDue.add(ext.id);
    if (prev !== version) { seen[ext.id] = version; ctx.db.kvSet('extensions.versions', seen); }
  }

  // The extension's background asks what it has missed: 'installed' -> details or null, 'startup' -> bool.
  take(id, kind) {
    if (kind === 'startup') {
      if (!this.startupDue.has(id)) return false;
      this.startupDue.delete(id);
      return true;
    }
    if (!this.installed.has(id)) {
      // (It asked before its "loaded" event got here.)
      const ext = this.extensions.ses && this.extensions.ses.extensions.getExtension(id);
      if (ext) this.loaded(ext);
    }
    const d = this.installed.get(id) || null;
    this.installed.set(id, null);
    return d;
  }

  startedUp() {
    this.starting = false;
    ctx.db.kvSet('extensions.appVersion', app.getVersion());
  }

  reloadingSoon(id) { this.reloading.add(id); }

  // Removed: installing it again is an install again.
  forget(id) {
    const seen = this.versions();
    if (Object.prototype.hasOwnProperty.call(seen, id)) { delete seen[id]; ctx.db.kvSet('extensions.versions', seen); }
    this.installed.delete(id);
    this.startupDue.delete(id);
  }
}

module.exports = { Lifecycle };
