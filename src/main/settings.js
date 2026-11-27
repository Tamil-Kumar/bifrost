'use strict';
// Settings: one JSON file (settings.json in the profile), merged over the shared defaults.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DEFAULTS, deepMerge, setPath, getPath, clone } = require('../shared/defaults');

// One-time changes to settings saved by older versions. settingsVersion records which have run.
const SETTINGS_VERSION = 6;
function migrate(raw) {
  const v = Number(raw.settingsVersion) || 1;
  if (v < 2) {
    // 0.13 and older sent a Firefox user agent to Google's sign-in, which Google now turns away.
    const rules = raw.advanced && Array.isArray(raw.advanced.siteUserAgents) ? raw.advanced.siteUserAgents : null;
    if (rules) for (const r of rules) if (r && r.host === 'accounts.google.com' && r.ua === 'firefox') r.ua = 'embedded';
  }
  if (v < 3 && Object.keys(raw).length) {
    // Vim keys were on by default up to 0.21 and took single letters from every page (F and K from YouTube,
    // X closed the tab). Never set up by hand: now off, like the new default. Either way, sites with
    // shortcuts of their own are excluded.
    const vim = raw.keyboard && raw.keyboard.vim;
    if (vim && typeof vim === 'object') {
      const OLD = ['mail.google.com', 'docs.google.com', 'www.figma.com'];
      const sites = Array.isArray(vim.excludedSites) ? vim.excludedSites : null;
      const untouched = (!vim.keys || !Object.keys(vim.keys).length) && (!sites || sites.join('|') === OLD.join('|'))
        && (vim.hintChars == null || vim.hintChars === 'asdfghjkl') && (vim.scrollStep == null || vim.scrollStep === 70);
      if (untouched && vim.enabled !== false) vim.enabled = false;
      if (sites) for (const h of DEFAULTS.keyboard.vim.excludedSites) if (!sites.includes(h)) sites.push(h);
    }
    // Websites followed the computer's light or dark by default up to 0.21, so with a dark Bifrost on a light
    // Windows they came out light (and extensions like Dark Reader then darkened them, half-matching any
    // userstyles). Now they follow Bifrost's theme by default, as in Firefox; "Like your computer is set" is still
    // there in Settings → Appearance.
    if (raw.appearance && raw.appearance.webTheme === 'system') raw.appearance.webTheme = 'browser';
  }
  if (v < 4 && raw.launcher && typeof raw.launcher === 'object') {
    // 0.24.4 had a setting each for Enter and Shift+Enter; now every Enter combination has one.
    raw.launcher = require('../shared/launcher-settings').upgrade(raw.launcher);
  }
  if (v < 5 && raw.appearance && raw.appearance.blendTone === 'theme') {
    // 0.33.0's "Tint my theme" (the bars in the theme's shade next to every page) is what "Stay dark" now
    // does next to bright pages; dark pages give the bars their own color.
    raw.appearance.blendTone = 'soft';
  }
  if (v < 6 && raw.appearance && Array.isArray(raw.appearance.toolbar)) {
    // 0.41.0's VPN: its button on a toolbar of your own too (before the ad blocker's, or the menu), unless it's
    // somewhere already.
    const ap = raw.appearance;
    const lists = [ap.toolbar, ap.sidebarTop, ap.sidebarBottom].filter(Array.isArray);
    if (!lists.some((l) => l.includes('vpn'))) {
      const at = ap.toolbar.indexOf('adblock') >= 0 ? ap.toolbar.indexOf('adblock') : ap.toolbar.indexOf('menu');
      if (at >= 0) ap.toolbar.splice(at, 0, 'vpn'); else ap.toolbar.push('vpn');
    }
  }
  raw.settingsVersion = SETTINGS_VERSION;
  return raw;
}

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'settings.json');
    this.data = deepMerge(DEFAULTS, migrate(this.read()));
    this.timer = null;
  }

  read() {
    for (const f of [this.file, this.file + '.bak']) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* missing or corrupt: try the backup, then defaults */ }
    }
    return {};
  }

  get(p) { return p ? getPath(this.data, p) : this.data; }

  // Sets one value by dotted path and re-validates the whole object against the defaults.
  set(p, value) {
    const next = clone(this.data);
    setPath(next, p, value);
    this.data = deepMerge(DEFAULTS, next);
    this.saveSoon();
    this.emit('changed', { path: p, value: getPath(this.data, p), settings: this.data });
    return this.data;
  }

  // Applies many changes at once (import, reset of a section).
  patch(obj) {
    this.data = deepMerge(DEFAULTS, Object.assign(clone(this.data), obj));
    this.saveSoon();
    this.emit('changed', { path: '', value: null, settings: this.data });
    return this.data;
  }

  replace(obj) {
    this.data = deepMerge(DEFAULTS, obj || {});
    this.saveSoon();
    this.emit('changed', { path: '', value: null, settings: this.data });
    return this.data;
  }

  resetSection(section) {
    if (!(section in DEFAULTS)) throw new Error('unknown section');
    return this.set(section, clone(DEFAULTS[section]));
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.file + '.tmp';
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[settings] save failed', e);
    }
  }
}

let instance = null;
function open(dir) { instance = new Settings(dir); return instance; }
function get() { return instance; }

module.exports = { Settings, open, get };
