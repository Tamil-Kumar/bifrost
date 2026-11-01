'use strict';
// Extension keyboard shortcuts (the manifest's "commands"): suggested keys, keys you set in Settings,
// and running them. They work in tabs and in the browser UI, in normal windows.
const ctx = require('../context');
const D = require('../../shared/defaults');

const KEY = 'extensions.shortcuts'; // { extId: { commandName: "Ctrl+Shift+Y" | "" } }
const ACTION = new Set(['_execute_action', '_execute_browser_action', '_execute_page_action']);
const PANEL = '_execute_side_panel';

function platformKey(sk) {
  if (!sk) return '';
  if (typeof sk === 'string') return sk;
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'default';
  return sk[plat] || sk.default || '';
}

// Chrome's accelerator syntax ("Command+Shift+Y", "MacCtrl+Comma", "Alt+Up") in Bifrost's form.
const MODS = { command: 'Meta', macctrl: 'Ctrl', search: 'Meta', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta' };
const KEYS = { comma: 'Comma', period: 'Period', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: 'Space', insert: 'Insert', delete: 'Delete',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', medianexttrack: 'MediaTrackNext', mediaplaypause: 'MediaPlayPause', mediaprevtrack: 'MediaTrackPrevious', mediastop: 'MediaStop' };
function normalize(acc) {
  const parts = String(acc || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const key = parts.pop();
  return [...parts.map((m) => MODS[m.toLowerCase()] || m), KEYS[key.toLowerCase()] || key].join('+');
}
const label = (acc) => { const c = acc && D.parseAccelerator(acc); return c ? D.chordToString(c) : ''; };

class Commands {
  constructor(extensions) {
    this.x = extensions;
    this.byExt = new Map(); // extId -> [{ name, description, suggested }]
    this.compiled = [];     // [{ extId, name, chord, acc }]
    this.resolved = new Map(); // "extId\nname" -> acc ('' for none)
    ctx.settings.on('changed', ({ path }) => { if (!path || path.startsWith('keyboard')) this.rebuild(); });
  }

  overrides() { return ctx.db.kvGet(KEY, {}) || {}; }

  load(ext) {
    const m = ext.manifest || {};
    const list = [];
    for (const [name, c] of Object.entries(m.commands || {})) {
      const desc = this.x.localizeString(ext, (c && c.description) || '');
      list.push({ name, description: desc || (ACTION.has(name) ? 'Activate the extension' : PANEL === name ? 'Open the side panel' : name), suggested: normalize(platformKey(c && c.suggested_key)) });
    }
    if (list.length) this.byExt.set(ext.id, list); else this.byExt.delete(ext.id);
    this.rebuild();
  }

  unload(id) { if (this.byExt.delete(id)) this.rebuild(); }

  forget(id) {
    const over = this.overrides();
    if (over[id]) { delete over[id]; ctx.db.kvSet(KEY, over); }
    this.unload(id);
  }

  // Keys you chose come first; suggested keys are used unless the browser or an earlier extension has them.
  rebuild() {
    const browser = new Set(D.compileShortcuts(ctx.settings.get()).map((c) => D.chordToString(c.chord)));
    const over = this.overrides();
    const taken = new Set();
    const resolved = new Map();
    const all = [];
    for (const [extId, cmds] of this.byExt) for (const c of cmds) all.push({ extId, c, k: extId + '\n' + c.name });
    for (const { extId, c, k } of all) {
      if (!over[extId] || !Object.prototype.hasOwnProperty.call(over[extId], c.name)) continue;
      const acc = over[extId][c.name];
      const l = label(acc);
      resolved.set(k, l ? acc : '');
      if (l) taken.add(l);
    }
    for (const { c, k } of all) {
      if (resolved.has(k)) continue;
      const l = label(c.suggested);
      if (l && !browser.has(l) && !taken.has(l)) { taken.add(l); resolved.set(k, c.suggested); } else resolved.set(k, '');
    }
    this.resolved = resolved;
    this.compiled = [];
    for (const { extId, c, k } of all) {
      const acc = resolved.get(k);
      const chord = acc && D.parseAccelerator(acc);
      if (chord) this.compiled.push({ extId, name: c.name, chord, acc });
    }
  }

  shortcutOf(extId, name) { return label(this.resolved.get(extId + '\n' + name)); }

  // For chrome.commands.getAll.
  getAll(extId) {
    return (this.byExt.get(extId) || []).map((c) => ({ name: c.name, description: c.description, shortcut: this.shortcutOf(extId, c.name) }));
  }

  // Settings: every extension's commands with their keys.
  list() {
    const browser = new Map(D.compileShortcuts(ctx.settings.get()).map((c) => [D.chordToString(c.chord), c.id]));
    const out = [];
    for (const [extId, cmds] of this.byExt) {
      const ext = this.x.ses.extensions.getExtension(extId);
      if (!ext) continue;
      out.push({
        extensionId: extId, name: this.x.localizeString(ext, ext.name), icon: this.x.iconFor(ext),
        commands: cmds.map((c) => {
          const shortcut = this.shortcutOf(extId, c.name);
          const other = shortcut && this.compiled.find((x) => (x.extId !== extId || x.name !== c.name) && label(x.acc) === shortcut);
          return {
            name: c.name, description: c.description, shortcut, suggested: label(c.suggested), isAction: ACTION.has(c.name),
            changed: !!(this.overrides()[extId] && Object.prototype.hasOwnProperty.call(this.overrides()[extId], c.name)),
            conflict: shortcut ? (browser.has(shortcut) ? 'browser' : other ? 'extension' : '') : '',
          };
        }),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // acc: "Ctrl+Shift+Y" to set, "" for no shortcut, null to go back to the extension's suggestion.
  set(extId, name, acc) {
    const cmds = this.byExt.get(extId);
    if (!cmds || !cmds.some((c) => c.name === name)) throw new Error('Unknown command');
    const before = this.shortcutOf(extId, name);
    const over = this.overrides();
    if (acc === null || acc === undefined) {
      if (over[extId]) { delete over[extId][name]; if (!Object.keys(over[extId]).length) delete over[extId]; }
    } else {
      const norm = acc ? normalize(acc) : '';
      if (norm && !label(norm)) throw new Error('That isn’t a valid shortcut');
      const chord = norm && D.parseAccelerator(norm);
      if (chord && !chord.ctrl && !chord.alt && !chord.meta && !/^F\d+$/.test(chord.code) && !/^Media/.test(chord.code)) throw new Error('Shortcuts need Ctrl or Alt');
      (over[extId] || (over[extId] = {}))[name] = norm;
    }
    ctx.db.kvSet(KEY, over);
    this.rebuild();
    const after = this.shortcutOf(extId, name);
    if (after !== before) this.x.router.sendEvent(extId, 'commands.onChanged', { name, newShortcut: after, oldShortcut: before });
    this.x.broadcast();
    return after;
  }

  // Keyboard input from a tab or the browser UI. Returns true if a command ran.
  handleKey(input, ctl) {
    if (!this.compiled.length || input.type !== 'keyDown' || input.isAutoRepeat || !ctl || ctl.isPrivate) return false;
    const chord = D.eventToChord(input);
    const hit = this.compiled.find((c) => D.chordMatches(c.chord, chord));
    if (!hit || !this.x.ses.extensions.getExtension(hit.extId)) return false;
    this.run(hit.extId, hit.name, ctl);
    return true;
  }

  run(extId, name, ctl) {
    if (ACTION.has(name)) {
      if (this.x.panelOnActionClick(extId)) this.x.openSidePanel(extId, ctl);
      else ctl.send('extension-activate-action', { id: extId });
      return;
    }
    if (name === PANEL) { this.x.openSidePanel(extId, ctl); return; }
    const t = ctl.tabs.find((x) => x.active);
    const wc = t && t.wcId != null ? require('electron').webContents.fromId(t.wcId) : null;
    const tab = wc ? this.x.tabDetailsFor(wc) : undefined;
    this.x.router.sendEvent(extId, 'commands.onCommand', name, tab);
  }
}

module.exports = { Commands, normalize, platformKey };
