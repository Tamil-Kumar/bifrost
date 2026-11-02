// Settings → Launcher → Backup (shared/launcher-settings.js): every setting of the Waypoint extension has a
// place in Bifrost, Waypoint's settings files come in whole, and Bifrost's own exports go back as they were.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LS = require(path.join(ROOT, 'src', 'shared', 'launcher-settings.js'));
const D = require(path.join(ROOT, 'src', 'shared', 'defaults.js'));
const WAYPOINT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'waypoint-settings.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Where each of Waypoint's settings (1.5.1, and 1.3.3 for Firefox) ends up in Bifrost's settings.
// [Waypoint path, Bifrost path, the value Bifrost should have for the fixture's value]
const MAP = [
  ['ranking.wMatch', 'launcher.wMatch'], ['ranking.wVisits', 'launcher.wVisits'], ['ranking.wRecency', 'launcher.wRecency'],
  ['ranking.recencyHalfLifeDays', 'launcher.recencyHalfLifeDays'], ['ranking.visitsSaturation', 'launcher.visitsSaturation'],
  ['ranking.fuzzy', 'launcher.fuzzy'], ['ranking.minScore', 'launcher.minScore'], ['ranking.maxResults', 'launcher.maxResults'],
  ['ranking.searchRowPosition', 'launcher.searchRowPosition'], ['ranking.autoThreshold', 'launcher.autoThreshold'],
  ['ranking.suggestionDecay', 'launcher.suggestionDecay'], ['ranking.historyIndexSize', 'launcher.historyIndex'],
  ['sources.bookmarks.enabled', 'launcher.sources.bookmarks.enabled'], ['sources.bookmarks.weight', 'launcher.sources.bookmarks.weight'], ['sources.bookmarks.max', 'launcher.sources.bookmarks.max'],
  ['sources.bookmarks.folderMode', 'launcher.bookmarkFolders.mode', 'all'], ['sources.bookmarks.folderIds', 'launcher.bookmarkFolders.ids', []],
  ['sources.tabs.enabled', 'launcher.sources.tabs.enabled'], ['sources.tabs.weight', 'launcher.sources.tabs.weight'], ['sources.tabs.max', 'launcher.sources.tabs.max'],
  ['sources.tabs.currentWindowOnly', 'launcher.sources.tabs.currentWindowOnly'],
  ['sources.history.enabled', 'launcher.sources.history.enabled'], ['sources.history.weight', 'launcher.sources.history.weight'], ['sources.history.max', 'launcher.sources.history.max'],
  ['sources.suggestions.enabled', 'launcher.sources.suggestions.enabled'], ['sources.suggestions.weight', 'launcher.sources.suggestions.weight'], ['sources.suggestions.max', 'launcher.sources.suggestions.max'],
  ['sources.suggestions.provider', 'search.suggestionProvider'],
  ['boosts.domains', 'launcher.boosts.domains'], ['boosts.folders', 'launcher.boosts.folders'],
  ['search.prefixes.bookmarks', 'launcher.prefixes.bookmarks'], ['search.prefixes.history', 'launcher.prefixes.history'],
  ['search.prefixes.tabs', 'launcher.prefixes.tabs'], ['search.prefixes.suggestions', 'launcher.prefixes.suggestions'],
  ['behavior.enterAction', 'launcher.open.enter', 'newtab'], ['behavior.shiftEnterAction', 'launcher.open.shift'],
  ['behavior.switchToOpenTab', 'launcher.switchToOpenTab'], ['behavior.emptyState', 'launcher.emptyState'], ['behavior.escClears', 'launcher.escClears'],
  ['behavior.suggestDelayMs', 'launcher.suggestDelayMs'], ['behavior.debounceMs', 'launcher.typingDelayMs'], ['behavior.omnibox', 'launcher.omnibox'],
  ['behavior.openMode', 'launcher.openMode'], ['behavior.windowHeight', 'launcher.windowHeight'], ['behavior.toolbarButton', 'launcher.toolbarButton'],
  ['behavior.newTabPage', 'tabs.newTabOpensLauncher', true],
  ['appearance.theme', 'launcher.theme'], ['appearance.useCustomAccent', 'launcher.useCustomAccent'], ['appearance.accent', 'launcher.accent'],
  ['appearance.font', 'launcher.font'], ['appearance.fontSize', 'launcher.fontSize'], ['appearance.width', 'launcher.width'], ['appearance.radius', 'launcher.radius'],
  ['appearance.density', 'launcher.density'], ['appearance.favicons', 'launcher.favicons'], ['appearance.showUrls', 'launcher.showUrls'],
  ['appearance.showFolders', 'launcher.showFolders'], ['appearance.showBadges', 'launcher.showBadges'], ['appearance.showHints', 'launcher.showHints'],
  ['appearance.showScores', 'launcher.showScores'], ['appearance.animations', 'launcher.animations'],
  ['appearance.overlayTop', 'launcher.top'], ['appearance.overlayDim', 'launcher.dim'], ['appearance.overlayBlur', 'launcher.blur'],
  ['customCss', 'launcher.customCss'],
];
// Waypoint's only setting with nothing to set in Bifrost: where its shortcut went on pages extensions
// can't draw on (Bifrost's launcher opens over every page). The search engine settings are checked below.
const NOTHING_TO_SET = ['behavior.fallback', 'search.engineName', 'search.engineUrl', 'search.engines'];

// Applies an import the way the settings page does, through the main process's validation (deepMerge).
function apply(result, settings) {
  let next = JSON.parse(JSON.stringify(settings));
  for (const [p, v] of Object.entries(result.set)) { D.setPath(next, p, v); next = D.deepMerge(D.DEFAULTS, next); }
  return next;
}
const fresh = () => D.deepMerge(D.DEFAULTS, {});

check('every one of Waypoint’s settings has a place in Bifrost’s', () => {
  const leaves = [];
  const walk = (o, pre) => { for (const [k, v] of Object.entries(o)) { const p = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p); else leaves.push(p); } };
  walk(WAYPOINT, '');
  const known = new Set(MAP.map((m) => m[0]).concat(NOTHING_TO_SET));
  const missing = leaves.filter((p) => !known.has(p));
  assert(!missing.length, 'no place for: ' + missing.join(', '));
  for (const [, to] of MAP) assert(get(D.DEFAULTS, to) !== undefined, 'Bifrost has no setting ' + to);
});

check('a Waypoint settings file comes in whole: each setting with its value', () => {
  const r = LS.importData(WAYPOINT, fresh());
  assert(r.kind === 'waypoint', 'not recognized as Waypoint’s: ' + r.kind);
  const s = apply(r, fresh());
  const wrong = [];
  for (const [from, to, want] of MAP) {
    const expected = want !== undefined ? want : get(WAYPOINT, from);
    if (!same(get(s, to), expected)) wrong.push(`${from} → ${to}: ${JSON.stringify(get(s, to))}, not ${JSON.stringify(expected)}`);
  }
  assert(!wrong.length, wrong.join('\n      '));
});

check('its search engines: keywords merge into Bifrost’s list, and its default engine is the default', () => {
  const s = apply(LS.importData(WAYPOINT, fresh()), fresh());
  const list = s.search.engines;
  const by = (kw) => list.filter((e) => e.keyword === kw);
  assert(by('yt').length === 1 && by('gh').length === 1, 'duplicated keywords: ' + JSON.stringify(list.map((e) => e.keyword)));
  assert(by('gh')[0].url === 'https://github.com/search?q=%s&type=code' && by('gh')[0].name === 'GitHub code', 'gh not Waypoint’s: ' + JSON.stringify(by('gh')[0]));
  assert(by('aw').length === 1 && by('aw')[0].url.includes('wiki.archlinux.org'), 'Arch Wiki not added');
  assert(by('r').length === 1 && by('mdn').length === 1, 'Bifrost’s own engines were lost');
  const def = list.find((e) => e.id === s.search.defaultEngine);
  assert(def && def.url === 'https://kagi.com/search?q=%s' && def.name === 'Kagi', 'default engine: ' + JSON.stringify(def));
  // Waypoint's own defaults (Google) find Bifrost's Google, with no copy.
  const w2 = JSON.parse(JSON.stringify(WAYPOINT));
  w2.search.engineName = 'Google'; w2.search.engineUrl = 'https://www.google.com/search?q=%s';
  const s2 = apply(LS.importData(w2, fresh()), fresh());
  assert(s2.search.defaultEngine === 'google' && s2.search.engines.filter((e) => /google\.com\/search/.test(e.url)).length === 1, 'Google doubled or not the default');
});

check('bookmark folders picked in Waypoint: searching all folders, with a note to pick them again', () => {
  const r = LS.importData(WAYPOINT, fresh());
  assert(r.notes.length === 1 && /folders/i.test(r.notes[0]), 'notes: ' + JSON.stringify(r.notes));
  const w2 = JSON.parse(JSON.stringify(WAYPOINT));
  w2.sources.bookmarks.folderMode = 'all';
  assert(!LS.importData(w2, fresh()).notes.length, 'a note without picked folders');
});

check('Bifrost’s own export goes back exactly as it was', () => {
  const mine = fresh();
  Object.assign(mine.launcher, { theme: 'nord', density: 'compact', customCss: '.title { font-weight: 700 }', width: 760 });
  Object.assign(mine.launcher.open, { enter: 'newtab', shift: 'current', ctrl: 'split' });
  mine.launcher.keys.next = ['Ctrl+Shift+J'];
  mine.launcher.boosts.domains = [{ domain: 'example.com', factor: 3 }];
  mine.search.defaultEngine = 'ddg';
  mine.tabs.newTabOpensLauncher = false;
  const file = JSON.parse(JSON.stringify(LS.exportData(mine)));
  assert(file.format === LS.FORMAT, 'no format mark');
  const r = LS.importData(file, fresh());
  assert(r.kind === 'bifrost', 'not recognized as Bifrost’s');
  const back = apply(r, fresh());
  assert(same(back.launcher, mine.launcher), 'launcher settings changed on the way');
  assert(back.search.defaultEngine === 'ddg' && back.tabs.newTabOpensLauncher === false, 'search or Ctrl+T settings lost');
  // A whole settings export (Import & backup → Export settings) works too.
  const whole = LS.importData(JSON.parse(JSON.stringify(mine)), fresh());
  assert(whole.kind === 'bifrost' && same(apply(whole, fresh()).launcher, mine.launcher), 'whole settings export');
});

check('a value of the wrong kind is left out, not stored', () => {
  const bad = { ranking: { wMatch: 'lots', maxResults: null, fuzzy: 'yes' }, behavior: { enterAction: 'teleport', openMode: 'sideways' }, appearance: { accent: 'red', density: 'tiny', theme: 42 } };
  const s = apply(LS.importData(bad, fresh()), fresh());
  const L = s.launcher, d = D.DEFAULTS.launcher;
  assert(L.wMatch === d.wMatch && L.maxResults === d.maxResults && L.fuzzy === d.fuzzy, 'ranking garbage stored');
  assert(L.open.enter === d.open.enter && L.openMode === d.openMode, 'behavior garbage stored');
  assert(L.accent === d.accent && L.density === d.density && L.theme === d.theme, 'appearance garbage stored');
});

check('a 0.24.4 export (a setting each for Enter and Shift+Enter) comes in as the Enter table', () => {
  const file = LS.exportData(fresh());
  delete file.launcher.open;
  Object.assign(file.launcher, { enterAction: 'background', shiftEnterAction: 'newtab' });
  const s = apply(LS.importData(file, fresh()), fresh());
  assert(s.launcher.open.enter === 'background' && s.launcher.open.shift === 'newtab' && s.launcher.open.ctrl === D.DEFAULTS.launcher.open.ctrl, JSON.stringify(s.launcher.open));
  assert(!('enterAction' in s.launcher), 'the old setting stayed');
});

// ------------------------------------------------------------------ keys
const ev = (mods = {}, code = 'Enter') => Object.assign({ code, key: code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, mods);
check('Enter and a click: each combination of Shift, Ctrl and Alt has its own action; a middle-click too', () => {
  const cfg = { open: { enter: 'newtab', shift: 'current', ctrl: 'split', alt: 'background', ctrlShift: 'window', altShift: 'private', ctrlAlt: 'web', middle: 'copy' } };
  const want = [[{}, 'newtab'], [{ shiftKey: true }, 'current'], [{ ctrlKey: true }, 'split'], [{ metaKey: true }, 'split'], [{ altKey: true }, 'background'],
    [{ ctrlKey: true, shiftKey: true }, 'window'], [{ altKey: true, shiftKey: true }, 'private'], [{ ctrlKey: true, altKey: true }, 'web'], [{ ctrlKey: true, altKey: true, shiftKey: true }, 'none']];
  for (const [m, a] of want) assert(LS.openAction(cfg, ev(m)) === a, JSON.stringify(m) + ' → ' + LS.openAction(cfg, ev(m)) + ', not ' + a);
  assert(LS.openAction(cfg, ev(), true) === 'copy', 'middle-click');
  assert(LS.openAction({ open: { enter: 'teleport' } }, ev()) === 'current' && LS.openAction({ open: { shift: 'teleport' } }, ev({ shiftKey: true })) === 'none', 'an unknown action');
  assert(LS.webPlace(cfg) === 'newtab' && LS.webPlace({ open: { enter: 'copy' } }) === 'current', 'where a web search opens');
});
check('the launcher’s other keys: defaults, your own, and Alt+1…9 (or Ctrl+1…9, or none) for the first nine results', () => {
  const m = LS.keyMatcher(D.DEFAULTS.launcher);
  const act = (code, mods) => (m(ev(mods, code)) || {}).act || null;
  assert(act('ArrowDown') === 'next' && act('Tab') === 'next' && act('KeyN', { ctrlKey: true }) === 'next' && act('KeyJ', { ctrlKey: true }) === 'next', 'next');
  assert(act('ArrowUp') === 'prev' && act('Tab', { shiftKey: true }) === 'prev' && act('KeyK', { ctrlKey: true }) === 'prev', 'previous');
  assert(act('Escape') === 'close' && act('Delete', { shiftKey: true }) === 'remove' && act('KeyC', { ctrlKey: true, shiftKey: true }) === 'copy' && act('Comma', { ctrlKey: true }) === 'settings', 'close, remove, copy, settings');
  assert(act('KeyN') === null && act('Delete') === null, 'plain keys are left for typing');
  const pick = m(ev({ altKey: true }, 'Digit4'));
  assert(pick && pick.act === 'pick' && pick.index === 3, 'Alt+4: ' + JSON.stringify(pick));
  assert(!m(ev({ ctrlKey: true }, 'Digit4')), 'Ctrl+4 with Alt chosen');
  const mine = LS.keyMatcher(Object.assign({}, D.DEFAULTS.launcher, { quickPick: 'ctrl', keys: Object.assign({}, D.DEFAULTS.launcher.keys, { next: ['Ctrl+Shift+J'], close: ['Escape', 'Ctrl+W'] }) }));
  assert((mine(ev({ ctrlKey: true, shiftKey: true }, 'KeyJ')) || {}).act === 'next' && !mine(ev({}, 'ArrowDown')), 'your own key for next');
  assert((mine(ev({ ctrlKey: true }, 'KeyW')) || {}).act === 'close', 'a second key for close');
  assert((mine(ev({ ctrlKey: true }, 'Digit2')) || {}).index === 1 && !mine(ev({ altKey: true }, 'Digit2')), 'Ctrl+1…9');
  const none = LS.keyMatcher(Object.assign({}, D.DEFAULTS.launcher, { quickPick: 'none' }));
  assert(!none(ev({ altKey: true }, 'Digit2')), 'quick open off');
});
check('keys that type something need Ctrl or Alt; Enter belongs to the Enter table', () => {
  const ok = (a) => LS.keyAllowed(D.parseAccelerator(a));
  for (const a of ['Down', 'Tab', 'Shift+Tab', 'Escape', 'PageDown', 'F2', 'Ctrl+N', 'Alt+J', 'Ctrl+Space', 'Shift+Delete', 'Ctrl+Shift+Backspace']) assert(ok(a), a + ' refused');
  for (const a of ['A', 'Shift+A', '5', 'Space', 'Backspace', 'Enter', 'Ctrl+Enter', 'Comma']) assert(!ok(a), a + ' allowed');
});

check('anything else is turned away', () => {
  for (const x of [null, 42, 'text', [], {}, { hello: 1 }, { appearance: { theme: 'mocha' } }]) {
    let threw = false;
    try { LS.importData(x, fresh()); } catch { threw = true; }
    assert(threw, 'accepted ' + JSON.stringify(x));
  }
});

console.log(`\nlauncher-settings: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
