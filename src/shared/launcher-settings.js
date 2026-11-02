/* Bifrost — the launcher's settings in a file of their own (Settings → Launcher → Backup): what an export
   holds, and what an import changes. Imports take Bifrost's own launcher exports, whole Bifrost settings
   exports, and settings exported from the Waypoint launcher extension (its "Export settings" file), whose
   every setting has a place in Bifrost's launcher. Pure functions; the settings page applies the result. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBLauncher = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  // b's values over a's, object by object (arrays and values replace).
  function merge(a, b) {
    if (!isObj(a) || !isObj(b)) return clone(b === undefined ? a : b);
    const out = clone(a);
    for (const k of Object.keys(b)) out[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : clone(b[k]);
    return out;
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const bool = (v) => (typeof v === 'boolean' ? v : undefined);
  const str = (v) => (typeof v === 'string' ? v : undefined);
  const oneOf = (v, list) => (list.includes(v) ? v : undefined);
  // Only the keys that came with a usable value.
  function defined(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined && !(isObj(v) && !Object.keys(v).length)) out[k] = v;
    return out;
  }

  const FORMAT = 'bifrost-launcher';

  // What "Export launcher settings" writes: the launcher's own settings, and the search settings it uses.
  function exportData(settings) {
    const s = settings || {};
    const search = s.search || {};
    return {
      format: FORMAT, version: 1,
      launcher: clone(s.launcher || {}),
      search: { engines: clone(search.engines || []), defaultEngine: search.defaultEngine, suggestions: search.suggestions, suggestionProvider: search.suggestionProvider },
      tabs: { newTabOpensLauncher: !!(s.tabs && s.tabs.newTabOpensLauncher) },
    };
  }

  function isWaypoint(d) {
    return isObj(d) && !d.format && (isObj(d.ranking) || isObj(d.behavior)) && (isObj(d.sources) || isObj(d.appearance) || isObj(d.search));
  }
  function isBifrost(d) {
    return isObj(d) && (d.format === FORMAT || (isObj(d.launcher) && (isObj(d.search) || isObj(d.appearance) || isObj(d.tabs))));
  }

  const ACTION = { current: 'current', newTab: 'newtab', newtab: 'newtab', background: 'background', split: 'split' };
  const PROVIDERS = ['google', 'duckduckgo'];
  const keyOf = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '');

  // Waypoint's search engines, into Bifrost's list: same keyword, same engine (its name and address are
  // Waypoint's); new ones are added. Its default engine becomes the default (added if it isn't there).
  function mergeEngines(current, w) {
    const list = clone(Array.isArray(current) ? current : []);
    let id = 0;
    const newId = () => 'wp' + Date.now().toString(36) + (id++);
    for (const e of Array.isArray(w.engines) ? w.engines : []) {
      if (!e || typeof e.url !== 'string' || !e.url.trim()) continue;
      const kw = String(e.keyword || '').trim().replace(/\s+/g, '');
      const url = e.url.includes('%s') ? e.url.trim() : e.url.trim() + '%s';
      const same = kw ? list.find((x) => (x.keyword || '') === kw) : list.find((x) => keyOf(x.url) === keyOf(url));
      if (same) Object.assign(same, { name: String(e.name || same.name), url });
      else list.push({ id: newId(), name: String(e.name || kw || 'Search'), keyword: kw, url, suggest: '' });
    }
    let def;
    if (typeof w.engineUrl === 'string' && w.engineUrl.trim()) {
      const url = w.engineUrl.includes('%s') ? w.engineUrl.trim() : w.engineUrl.trim() + '%s';
      let e = list.find((x) => keyOf(x.url) === keyOf(url));
      if (!e) { e = { id: newId(), name: String(w.engineName || 'Search'), keyword: '', url, suggest: '' }; list.push(e); }
      def = e.id;
    }
    return { engines: list, defaultEngine: def };
  }

  // Waypoint's settings file, as Bifrost settings. Returns { set: { path: value }, notes: [text] }.
  function fromWaypoint(w, settings) {
    const s = settings || {};
    const r = isObj(w.ranking) ? w.ranking : {};
    const src = isObj(w.sources) ? w.sources : {};
    const b = isObj(w.behavior) ? w.behavior : {};
    const a = isObj(w.appearance) ? w.appearance : {};
    const se = isObj(w.search) ? w.search : {};
    const notes = [];
    const source = (o, extra = {}) => (isObj(o) ? defined(Object.assign({ enabled: bool(o.enabled), weight: num(o.weight), max: num(o.max) }, extra)) : undefined);
    const L = defined({
      wMatch: num(r.wMatch), wVisits: num(r.wVisits), wRecency: num(r.wRecency),
      recencyHalfLifeDays: num(r.recencyHalfLifeDays), visitsSaturation: num(r.visitsSaturation),
      fuzzy: bool(r.fuzzy), minScore: num(r.minScore), maxResults: num(r.maxResults),
      searchRowPosition: oneOf(r.searchRowPosition, ['auto', 'top', 'bottom']), autoThreshold: num(r.autoThreshold), suggestionDecay: num(r.suggestionDecay),
      historyIndex: num(r.historyIndexSize),
      sources: defined({
        bookmarks: source(src.bookmarks),
        tabs: source(src.tabs, { currentWindowOnly: isObj(src.tabs) ? bool(src.tabs.currentWindowOnly) : undefined }),
        history: source(src.history),
        suggestions: source(src.suggestions),
      }),
      prefixes: isObj(se.prefixes) ? defined({ bookmarks: str(se.prefixes.bookmarks), history: str(se.prefixes.history), tabs: str(se.prefixes.tabs), suggestions: str(se.prefixes.suggestions) }) : undefined,
      boosts: isObj(w.boosts) ? defined({
        domains: Array.isArray(w.boosts.domains) ? w.boosts.domains.filter((x) => x && typeof x.domain === 'string').map((x) => ({ domain: x.domain, factor: num(x.factor) ?? 1 })) : undefined,
        folders: Array.isArray(w.boosts.folders) ? w.boosts.folders.filter((x) => x && typeof x.folder === 'string').map((x) => ({ folder: x.folder, factor: num(x.factor) ?? 1 })) : undefined,
      }) : undefined,
      openMode: oneOf(b.openMode, ['overlay', 'window']), windowHeight: num(b.windowHeight),
      toolbarButton: oneOf(b.toolbarButton, ['popup', 'same']),
      enterAction: ACTION[b.enterAction], shiftEnterAction: ACTION[b.shiftEnterAction],
      switchToOpenTab: bool(b.switchToOpenTab), emptyState: oneOf(b.emptyState, ['bookmarks', 'tabs', 'history', 'none']),
      escClears: bool(b.escClears), suggestDelayMs: num(b.suggestDelayMs), typingDelayMs: num(b.debounceMs), omnibox: bool(b.omnibox),
      theme: str(a.theme), useCustomAccent: bool(a.useCustomAccent), accent: /^#[0-9a-f]{6}$/i.test(a.accent || '') ? a.accent : undefined,
      font: str(a.font), fontSize: num(a.fontSize), width: num(a.width), radius: num(a.radius),
      density: oneOf(a.density, ['comfortable', 'compact']), favicons: oneOf(a.favicons, ['browser', 'google', 'duckduckgo', 'none']),
      showUrls: bool(a.showUrls), showFolders: bool(a.showFolders), showBadges: bool(a.showBadges), showHints: bool(a.showHints), showScores: bool(a.showScores),
      animations: bool(a.animations), top: num(a.overlayTop), dim: num(a.overlayDim), blur: bool(a.overlayBlur),
      customCss: str(w.customCss),
    });
    // (Waypoint's bookmark folder ids are Firefox's or Chrome's; Bifrost's bookmarks have their own.)
    const bm = src.bookmarks;
    if (isObj(bm) && bm.folderMode === 'selected' && Array.isArray(bm.folderIds) && bm.folderIds.length) {
      L.bookmarkFolders = { mode: 'all', ids: [] };
      notes.push('Waypoint searched only some bookmark folders. Bifrost’s bookmarks are its own, so pick those folders again under Sources.');
    }
    const set = { launcher: merge(s.launcher || {}, L) };
    // "On an empty new tab, open Waypoint in the tab": Bifrost's Ctrl+T opens the launcher.
    if (b.newTabPage === 'tab') set['tabs.newTabOpensLauncher'] = true;
    const prov = isObj(src.suggestions) ? src.suggestions.provider : undefined;
    if (PROVIDERS.includes(prov)) set['search.suggestionProvider'] = prov;
    if (Array.isArray(se.engines) || se.engineUrl) {
      const m = mergeEngines(s.search && s.search.engines, se);
      set['search.engines'] = m.engines;
      if (m.defaultEngine) set['search.defaultEngine'] = m.defaultEngine;
    }
    return { set, notes };
  }

  // A Bifrost launcher export (or a whole settings export): its launcher and search settings.
  function fromBifrost(d, settings) {
    const s = settings || {};
    const set = { launcher: merge(s.launcher || {}, isObj(d.launcher) ? d.launcher : {}) };
    const search = isObj(d.search) ? d.search : {};
    if (Array.isArray(search.engines) && search.engines.length) set['search.engines'] = clone(search.engines);
    if (typeof search.defaultEngine === 'string') set['search.defaultEngine'] = search.defaultEngine;
    if (typeof search.suggestions === 'boolean') set['search.suggestions'] = search.suggestions;
    if (typeof search.suggestionProvider === 'string') set['search.suggestionProvider'] = search.suggestionProvider;
    if (isObj(d.tabs) && typeof d.tabs.newTabOpensLauncher === 'boolean') set['tabs.newTabOpensLauncher'] = d.tabs.newTabOpensLauncher;
    return { set, notes: [] };
  }

  // Any of the above. Returns { kind: 'waypoint' | 'bifrost', set, notes }, or throws for anything else.
  function importData(d, settings) {
    if (isWaypoint(d)) return Object.assign({ kind: 'waypoint' }, fromWaypoint(d, settings));
    if (isBifrost(d)) return Object.assign({ kind: 'bifrost' }, fromBifrost(d, settings));
    throw new Error('That file isn’t a launcher settings export from Bifrost or Waypoint');
  }

  return { FORMAT, exportData, importData, fromWaypoint, fromBifrost, isWaypoint, isBifrost, merge };
});
