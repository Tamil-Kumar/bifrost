'use strict';
// The launcher and address bar search service: keeps a warm, prepared index of bookmarks and recent
// history in memory (updated as you browse), so every keystroke is answered without touching the disk.
const { net } = require('electron');
const E = require('../shared/engine');
const { COMMANDS } = require('../shared/defaults');
const ctx = require('./context');

const SUGGEST = {
  google: (q) => 'https://suggestqueries.google.com/complete/search?client=firefox&oe=utf-8&q=' + encodeURIComponent(q),
  duckduckgo: (q) => 'https://duckduckgo.com/ac/?type=list&q=' + encodeURIComponent(q),
};

class SearchService {
  constructor() {
    this.visitIndex = new Map();
    this.bookmarks = null;
    this.cache = {};
    this.commands = COMMANDS.filter((c) => !/^(tab[1-8]|workspace[1-9])$/.test(c.id)).map((c) => E.prep({ id: c.id, title: c.title, category: c.category, url: '', keys: c.keys }));
    // Commands match on their names; in the palette (after ">") their category counts too ("tabs", "page").
    for (const c of this.commands) { c.tl = c.title.toLowerCase(); c.palette = Object.assign({}, c, { tl: (c.title + ' ' + c.category).toLowerCase() }); }
    this.historySize = 0;
  }

  init() {
    this.loadHistory();
    ctx.db.on('visit', (e) => {
      const h = E.prep({ url: e.url, title: e.title || '', visitCount: e.visitCount, lastVisitTime: e.lastVisitTime, favicon: e.favicon });
      this.visitIndex.delete(h.key);
      this.visitIndex.set(h.key, h);
      this.cache = {};
      if (this.visitIndex.size > this.historySize + 200) this.trim();
    });
    ctx.db.on('title', ({ url, title }) => {
      const key = E.prep({ url }).key;
      const h = this.visitIndex.get(key);
      if (h) { h.title = title; h.tl = title.toLowerCase(); }
    });
    ctx.db.on('history-changed', () => this.loadHistory());
    ctx.db.on('bookmarks-changed', () => { this.bookmarks = null; this.cache = {}; });
  }

  loadHistory() {
    this.historySize = require('./perf').current().historyIndexSize || 10000;
    const rows = ctx.db.recentHistory(this.historySize);
    this.visitIndex = new Map();
    for (let i = rows.length - 1; i >= 0; i--) {
      const h = E.prep(rows[i]);
      this.visitIndex.set(h.key, h);
    }
    this.cache = {};
  }

  trim() {
    const extra = this.visitIndex.size - this.historySize;
    if (extra <= 0) return;
    let i = 0;
    for (const k of this.visitIndex.keys()) { if (i++ >= extra) break; this.visitIndex.delete(k); }
  }

  getBookmarks() {
    if (!this.bookmarks) this.bookmarks = ctx.db.flatBookmarks().map((b) => E.prep(b));
    return this.bookmarks;
  }

  // Search context for one window: open tabs from every normal window (private windows see only their own).
  context(ctl, activeWcId) {
    const tabs = [];
    const tabByKey = new Map();
    for (const { ctl: c, tab } of ctx.registry.allTabs({ onlyWindow: ctl && ctl.isPrivate ? ctl : null })) {
      if (!tab.url || /^bifrost:\/\/(newtab|blank)/.test(tab.url)) continue;
      const t = E.prep({ url: tab.url, title: tab.title || '', favicon: tab.favicon, lastActive: tab.lastActive || 0, ref: { windowId: c.id, tabId: tab.id, wcId: tab.wcId } });
      tabs.push(t);
      if (!tabByKey.has(t.key)) tabByKey.set(t.key, t);
    }
    return { bookmarks: this.getBookmarks(), visitIndex: this.visitIndex, tabs, tabByKey, commands: this.commands, activeTab: activeWcId != null ? { wcId: activeWcId } : null, cache: this.cache };
  }

  engines() { return ctx.settings.get('search.engines') || []; }
  defaultEngine() {
    const s = ctx.settings.get('search');
    return s.engines.find((e) => e.id === s.defaultEngine) || s.engines[0] || { name: 'Google', url: 'https://www.google.com/search?q=%s' };
  }

  options() {
    // A shallow copy: the settings object itself must not change here.
    const L = Object.assign({}, ctx.settings.get('launcher'));
    const s = ctx.settings.get('search');
    // Suggestions follow the search settings too.
    if (!s.suggestions || s.suggestionProvider === 'none') L.sources = Object.assign({}, L.sources, { suggestions: Object.assign({}, L.sources.suggestions, { enabled: false }) });
    return L;
  }

  describe(q) {
    return { text: q.text, only: q.only, engine: q.engine ? { name: q.engine.name, keyword: q.engine.keyword } : null, isUrl: q.isUrl };
  }

  // Instant pass: in-memory only.
  query({ raw, ctl, activeWcId, suggestions = null, extraHistory = null }) {
    const L = this.options();
    const q = E.parseQuery(raw, L, this.engines());
    const c = this.context(ctl, activeWcId);
    if (!q.text && !q.engine) return { query: this.describe(q), items: q.only ? E.browse(q.only, L, c) : E.startState(L, c) };
    let local = E.searchLocal(q, L, c);
    if (extraHistory && extraHistory.length) {
      const extraCtx = Object.assign({}, c, { visitIndex: new Map(extraHistory.map((h) => { const p = E.prep(h); return [p.key, p]; })) });
      const more = E.searchLocal(Object.assign({}, q, { only: 'history' }), L, extraCtx).filter((it) => !this.visitIndex.has(it.key));
      local = local.concat(more);
    }
    return { query: this.describe(q), items: E.rank(q, L, local, suggestions || [], c, this.defaultEngine()) };
  }

  // Second pass: web suggestions and older history from the database.
  async more({ raw, ctl, activeWcId }) {
    const L = this.options();
    const q = E.parseQuery(raw, L, this.engines());
    const [suggestions, extraHistory] = await Promise.all([
      E.wantsSuggestions(q, L) ? this.suggest(q.text, q.engine) : Promise.resolve(null),
      q.text && q.text.length >= 2 && !q.engine && (!q.only || q.only === 'history') && L.sources.history.enabled
        ? Promise.resolve(ctx.db.searchHistory(q.text, 150)) : Promise.resolve(null),
    ]);
    const res = this.query({ raw, ctl, activeWcId, suggestions, extraHistory });
    res.hadSuggestions = !!suggestions;
    return res;
  }

  async suggest(text, engine) {
    const s = ctx.settings.get('search');
    let provider = s.suggestionProvider;
    if (engine && engine.suggest !== undefined) provider = engine.suggest || 'none';
    const make = SUGGEST[provider];
    if (!make || !text) return null;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      const r = await net.fetch(make(text), { signal: ac.signal, credentials: 'omit', cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) return null;
      const data = await r.json();
      return Array.isArray(data && data[1]) ? data[1].filter((x) => typeof x === 'string').slice(0, 10) : null;
    } catch { return null; }
  }
}

module.exports = { SearchService };
