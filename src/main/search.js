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
    // Bookmarks whose address sends you on somewhere else (mail.example.com → its inbox, a sign-in page and
    // back): their key → where they end up ({ key, pk }), so visits there count for the bookmark. Noted as
    // you open them (guests.js), kept with the profile.
    this.redirects = new Map();
    this.bmKeys = null;
    // What you open from the launcher or the address bar's list, and for what you'd typed (engine.js picks):
    // it comes up first next time. Kept with the profile (never from a private window); clearing history
    // clears it.
    this.picks = { byKey: new Map(), byInput: new Map() };
  }

  init() {
    this.loadHistory();
    try {
      const saved = ctx.db.kvGet('launcherRedirects', {}) || {};
      for (const [k, v] of Object.entries(saved)) if (v && typeof v.key === 'string') this.redirects.set(k, { key: v.key, pk: typeof v.pk === 'string' ? v.pk : null });
    } catch { /* none yet */ }
    this.loadPicks();
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
    ctx.db.on('history-changed', (e) => {
      // (history cleared: so is where bookmarks were seen to go; a page that left history, likewise)
      if (!e || e.all) { this.redirects.clear(); this.forgetPicks(); }
      else if (e.urls && e.urls.length) {
        const gone = new Set(e.urls.map((u) => E.prep({ url: u }).key));
        for (const [k, v] of this.redirects) if (gone.has(v.key)) this.redirects.delete(k);
        this.forgetPicks(gone);
      }
      this.saveRedirects();
      this.loadHistory();
    });
    ctx.db.on('bookmarks-changed', () => { this.bookmarks = null; this.bmKeys = null; this.cache = {}; });
  }

  // A page opened at startUrl was shown at url (server redirects in between): for a bookmark's address, where
  // it ends up, so the visits there count as using the bookmark.
  noteRedirect(startUrl, url) {
    if (!startUrl || !url || !/^https?:/i.test(startUrl)) return;
    const a = E.prep({ url: startUrl }), b = E.prep({ url });
    if (!a.key || !b.key || a.key === b.key) return;
    if (!this.bmKeys) this.bmKeys = new Set(this.getBookmarks().map((x) => x.key));
    if (!this.bmKeys.has(a.key)) return;
    const prev = this.redirects.get(a.key);
    if (prev && prev.key === b.key) return;
    this.redirects.delete(a.key);
    this.redirects.set(a.key, { key: b.key, pk: b.pk });
    while (this.redirects.size > 500) this.redirects.delete(this.redirects.keys().next().value);
    this.cache = {};
    this.saveRedirects();
  }

  // ------------------------------------------------------------------ picks
  loadPicks() {
    const P = { byKey: new Map(), byInput: new Map() };
    try {
      const saved = ctx.db.kvGet('launcherPicks', null);
      if (saved && typeof saved === 'object') {
        for (const [k, e] of Object.entries(saved.keys || {})) if (e && e.n > 0) P.byKey.set(k, { n: Math.min(1000, e.n | 0), last: Number(e.last) || 0, pk: typeof e.pk === 'string' ? e.pk : null });
        for (const [input, keys] of Object.entries(saved.inputs || {})) {
          const m = new Map();
          for (const [k, e] of Object.entries(keys || {})) if (e && e.n > 0) m.set(k, { n: Math.min(1000, e.n | 0), last: Number(e.last) || 0 });
          if (m.size) P.byInput.set(input, m);
        }
      }
    } catch { /* none yet */ }
    this.picks = P;
  }

  savePicks() {
    clearTimeout(this.pickT);
    this.pickT = setTimeout(() => {
      const keys = Object.fromEntries(this.picks.byKey);
      const inputs = {};
      for (const [input, m] of this.picks.byInput) inputs[input] = Object.fromEntries(m);
      try { ctx.db.kvSet('launcherPicks', { keys, inputs }); } catch { /* closing */ }
    }, 1500);
  }

  // You opened it from the launcher or the address bar's list ({ raw: what was typed, url, key, command }).
  picked({ raw, url, key, command, ctl }) {
    if (ctl && ctl.isPrivate) return;
    if (ctx.settings.get('launcher.learnPicks') === false) return;
    let k, pk = null;
    if (command) k = 'cmd:' + command;
    else {
      if (typeof url !== 'string' || !/^(https?|file):/i.test(url)) return;
      const p = E.prep({ url });
      k = p.key; pk = p.pk;
    }
    if (!k) return;
    const now = Date.now();
    const P = this.picks;
    // (a fresh Map each time: the engine's caches notice the change)
    const byKey = new Map(P.byKey);
    const e = byKey.get(k);
    byKey.delete(k);
    byKey.set(k, { n: Math.min(1000, (e ? e.n : 0) + 1), last: now, pk });
    while (byKey.size > 3000) byKey.delete(byKey.keys().next().value);
    const byInput = new Map(P.byInput);
    const L = this.options();
    const q = E.parseQuery(String(raw || ''), L, this.engines());
    const input = (q.text || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (input) {
      const m = new Map(byInput.get(input) || []);
      const ie = m.get(k);
      m.delete(k);
      m.set(k, { n: Math.min(1000, (ie ? ie.n : 0) + 1), last: now });
      while (m.size > 12) m.delete(m.keys().next().value);
      byInput.delete(input);
      byInput.set(input, m);
      while (byInput.size > 1500) byInput.delete(byInput.keys().next().value);
    }
    this.picks = { byKey, byInput };
    this.cache = {};
    this.savePicks();
  }

  // gone: keys that left history (or all of it).
  forgetPicks(gone = null) {
    if (!gone) this.picks = { byKey: new Map(), byInput: new Map() };
    else {
      const byKey = new Map([...this.picks.byKey].filter(([k]) => !gone.has(k)));
      const byInput = new Map();
      for (const [input, m] of this.picks.byInput) {
        const left = new Map([...m].filter(([k]) => !gone.has(k)));
        if (left.size) byInput.set(input, left);
      }
      this.picks = { byKey, byInput };
    }
    this.cache = {};
    this.savePicks();
  }

  saveRedirects() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => { try { ctx.db.kvSet('launcherRedirects', Object.fromEntries(this.redirects)); } catch { /* closing */ } }, 1500);
  }

  loadHistory() {
    // Settings → Launcher → History pages indexed; unset, the performance profile's amount.
    const own = Math.round(Number(ctx.settings.get('launcher.historyIndex')) || 0);
    this.historySize = own > 0 ? Math.max(500, Math.min(200000, own)) : require('./perf').current().historyIndexSize || 10000;
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

  // Search context for one window: open tabs from every normal window (private windows see only their own;
  // with Settings → Launcher → "Only tabs in this window", every window does).
  context(ctl, activeWcId) {
    const tabs = [];
    const tabByKey = new Map();
    const own = ctl && (ctl.isPrivate || ctx.settings.get('launcher.sources.tabs.currentWindowOnly'));
    for (const { ctl: c, tab } of ctx.registry.allTabs({ onlyWindow: own ? ctl : null })) {
      if (!tab.url || /^bifrost:\/\/(newtab|blank)/.test(tab.url)) continue;
      const t = E.prep({ url: tab.url, title: tab.title || '', favicon: tab.favicon, lastActive: tab.lastActive || 0, ref: { windowId: c.id, tabId: tab.id, wcId: tab.wcId } });
      tabs.push(t);
      if (!tabByKey.has(t.key)) tabByKey.set(t.key, t);
    }
    return { bookmarks: this.getBookmarks(), visitIndex: this.visitIndex, redirects: this.redirects, picks: this.picks, tabs, tabByKey, commands: this.commands, activeTab: activeWcId != null ? { wcId: activeWcId } : null, cache: this.cache };
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
