/* Bifrost browser — the launcher's search and ranking engine (ported from the Waypoint launcher extension).
   Pure functions over prepared data; the main process supplies bookmarks, history, tabs and commands. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------ url utils
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  function normUrl(u) {
    try {
      const x = new URL(u);
      x.hash = '';
      let s = x.href.replace(/^https?:\/\/(www\.)?/, '');
      if (s.endsWith('/')) s = s.slice(0, -1);
      return s;
    } catch (_) { return u; }
  }

  function displayUrl(u) {
    let s = (u || '').replace(/^https?:\/\/(www\.)?/, '');
    if (s.endsWith('/')) s = s.slice(0, -1);
    try { s = decodeURI(s); } catch (_) { /* keep encoded */ }
    return s;
  }

  function pathKey(u) {
    try {
      const x = new URL(u);
      if (!/^https?:$/.test(x.protocol)) return null;
      return x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '');
    } catch (_) { return null; }
  }

  const TLDS = /\.(com|org|net|io|dev|app|edu|gov|co|uk|de|fr|jp|ai|me|tv|gg|xyz|info|us|ca|au|in|ru|nl|it|es|ch|se|no|fi|be|at|pl|br|mx|ly|so|sh|rs|to|fm|cc|tech|site|online|blog|page|wiki|news|link|life|world|club|store|shop|zone|space)$/i;

  function looksLikeUrl(t) {
    if (!t || /\s/.test(t)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
    if (/^(about|bifrost|chrome|view-source|data|file|mailto):/i.test(t)) return true;
    if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return true;
    if (/^\[[0-9a-f:]+\](:\d+)?(\/|$)/i.test(t)) return true;
    const m = /^([^\s/:?#]+)(:\d+)?([/?#].*)?$/i.exec(t);
    if (!m || !m[1].includes('.')) return false;
    // A dotted word ending in a known TLD, or with a path/port, is an address ("node.js" alone is a search).
    return TLDS.test(m[1]) || !!m[2] || !!m[3];
  }

  function toUrl(t) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|bifrost|chrome|view-source|data|file|mailto):/i.test(t)) return t;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[)/i.test(t)) return 'http://' + t;
    return 'https://' + t;
  }

  function fillTemplate(tpl, text) {
    const enc = encodeURIComponent(text);
    return tpl.includes('%s') ? tpl.split('%s').join(enc) : tpl + enc;
  }

  // ------------------------------------------------------------- matching
  function isWordStart(s, i) {
    return i === 0 || /[^\p{L}\p{N}]/u.test(s[i - 1]);
  }

  // Ratio of token length to the span its letters occupy, in order. 0 = no match.
  function fuzzyRatio(tok, s) {
    let best = 0;
    for (let start = s.indexOf(tok[0]); start !== -1; start = s.indexOf(tok[0], start + 1)) {
      let j = start, k = 0;
      while (j < s.length && k < tok.length) { if (s[j] === tok[k]) k++; j++; }
      if (k < tok.length) break;
      const span = j - start;
      if (span <= tok.length * 4) best = Math.max(best, tok.length / span);
    }
    return best;
  }

  // Lowercased title, display address, host and keys, computed once per entry.
  function prep(o) {
    if (o.key !== undefined) return o;
    const url = o.url || '';
    let x = null;
    try { x = new URL(url); } catch (_) { x = null; }
    if (x) {
      const host = x.hostname.replace(/^www\./, '').toLowerCase();
      let k = x.href.split('#')[0].replace(/^https?:\/\/(www\.)?/, '');
      if (k.endsWith('/')) k = k.slice(0, -1);
      o.key = k;
      o.host = host;
      o.pk = /^https?:$/.test(x.protocol) ? host + x.pathname.replace(/\/+$/, '') : null;
    } else {
      o.key = url; o.host = ''; o.pk = null;
    }
    o.ul = displayUrl(url).toLowerCase();
    o.tl = (o.title || '').toLowerCase();
    return o;
  }

  function matchPrepped(tokens, full, o, fuzzy) {
    if (!tokens.length) return 0;
    const t = o.tl, u = o.ul, host = o.host;
    let sum = 0;
    for (const tok of tokens) {
      let best = 0;
      const ti = t.indexOf(tok);
      if (ti === 0) best = 1;
      else if (ti > 0) best = isWordStart(t, ti) ? 0.9 : 0.65;
      if (host.startsWith(tok)) best = Math.max(best, 0.95);
      else if (best < 0.6) {
        const ui = u.indexOf(tok);
        if (ui >= 0) best = Math.max(best, isWordStart(u, ui) ? 0.6 : 0.45);
      }
      if (!best && fuzzy && tok.length >= 2) {
        const f = Math.max(fuzzyRatio(tok, t), fuzzyRatio(tok, host));
        if (f) best = 0.15 + 0.3 * f;
      }
      if (!best) return 0;
      sum += best;
    }
    let m = sum / tokens.length;
    if (t === full) m += 0.2;
    else if (full && t.startsWith(full)) m += 0.1;
    return Math.min(1, m);
  }

  // ---------------------------------------------------------------- query
  function parseQuery(raw, L, engines) {
    let q = (raw || '').replace(/^\s+/, '');
    const res = { raw: raw || '', text: '', tokens: [], only: null, engine: null, isUrl: false };
    const prefixes = Object.entries(L.prefixes || {}).filter(([, p]) => p).sort((a, b) => b[1].length - a[1].length);
    for (const [src, pre] of prefixes) {
      if (q.startsWith(pre)) { res.only = src; q = q.slice(pre.length).replace(/^\s+/, ''); break; }
    }
    if (!res.only) {
      const m = q.match(/^(\S+)\s+([\s\S]*)$/);
      if (m) {
        const kw = m[1].toLowerCase();
        const eng = (engines || []).find((e) => e.keyword && e.keyword.toLowerCase() === kw && e.url);
        if (eng) { res.engine = eng; q = m[2]; }
      }
    }
    res.text = q.trim();
    res.tokens = res.text.toLowerCase().split(/\s+/).filter(Boolean);
    res.isUrl = !res.engine && !res.only && looksLikeUrl(res.text);
    return res;
  }

  // -------------------------------------------------------------- boosts
  const COMPILED = new WeakMap();
  function compiled(L) {
    let c = COMPILED.get(L.boosts || L);
    if (c) return c;
    const b = L.boosts || { domains: [], folders: [] };
    c = {
      domains: (b.domains || []).map((d) => ({ dom: String(d.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''), factor: Number(d.factor) }))
        .filter((d) => d.dom && Number.isFinite(d.factor)),
      folders: (b.folders || []).map((x) => ({ name: String(x.folder || '').toLowerCase().trim(), factor: Number(x.factor) }))
        .filter((x) => x.name && Number.isFinite(x.factor)),
    };
    COMPILED.set(L.boosts || L, c);
    return c;
  }

  function domainFactorHost(h, L) {
    let f = 1;
    for (const d of compiled(L).domains) if (h === d.dom || h.endsWith('.' + d.dom)) f *= d.factor;
    return f;
  }

  function folderFactor(path, L) {
    if (!path || !path.length) return 1;
    const list = compiled(L).folders;
    if (!list.length) return 1;
    const parts = path.map((p) => String(p).toLowerCase());
    let f = 1;
    for (const b of list) if (parts.includes(b.name)) f *= b.factor;
    return f;
  }

  function folderAllowed(b, L) {
    const F = L.bookmarkFolders || { mode: 'all' };
    if (F.mode !== 'selected') return true;
    const ids = (F.ids || []).map(Number);
    return !!(b.ancestors && b.ancestors.some((id) => ids.includes(Number(id))));
  }

  // ---------------------------------------------------------------- picks
  // What you opened from the launcher (or the address bar's list), learned so it comes up first:
  // ctx.picks = { byKey: Map(key -> { n, last, pk }), byInput: Map(what you'd typed -> Map(key -> { n, last })) }.
  // A pick counts as PICK_VISITS visits of the page (you chose it; a visit may be any link), and for what you
  // type, what you picked when you typed the same (or the start of it, or more) is raised (Firefox's
  // "adaptive history", Chrome's shortcuts).
  const PICK_VISITS = 3;
  const PICK_HALF = 864e5 * 30;   // a pick a month old counts half
  function pickOf(key, ctx) { return (key && ctx.picks && ctx.picks.byKey && ctx.picks.byKey.get(key)) || null; }
  // For the text typed: key → how strongly it was picked for that text (0…1).
  function learnedFor(full, ctx) {
    const P = ctx.picks;
    if (!full || !P || !P.byInput || !P.byInput.size) return null;
    const holder = ctx.cache || ctx;
    if (holder._learned && holder._learned.full === full && holder._learned.P === P) return holder._learned.map;
    const now = Date.now();
    const map = new Map();
    for (const [input, keys] of P.byInput) {
      if (!(input.startsWith(full) || full.startsWith(input))) continue;
      const closeness = Math.min(full.length, input.length) / Math.max(full.length, input.length);
      for (const [key, e] of keys) {
        const s = closeness * Math.min(1, Math.log1p(e.n || 0) / Math.log1p(4)) * Math.pow(0.5, Math.max(0, now - (e.last || 0)) / PICK_HALF);
        if (s > (map.get(key) || 0)) map.set(key, s);
      }
    }
    holder._learned = { full, P, map };
    return map;
  }

  // -------------------------------------------------------------- scoring
  // ctx: { bookmarks:[prepped], visitIndex: Map(key -> history entry), tabs:[prepped], tabByKey: Map, commands:[prepped], activeTab: {windowId, wcId},
  //        redirects: Map(bookmark key -> { key, pk } of where opening it ends up), picks (see above) }
  // use: how much a bookmark is used (bookmarkUsage: its page and the pages under it), in place of its
  // own page's history entry. learned: how much it was picked for what's typed (learnedFor).
  function makeScorer(L, ctx) {
    const now = Date.now();
    const wSum = (L.wMatch + L.wVisits + L.wRecency) || 1;
    const sat = Math.log1p(Math.max(1, L.visitsSaturation));
    const half = 864e5 * Math.max(0.1, L.recencyHalfLifeDays);
    const learn = L.learnPicks !== false;
    const wPicks = Number.isFinite(L.wPicks) ? Math.max(0, L.wPicks) : 1;
    return function score(src, m, o, path, fallbackTs, h, use, learned) {
      let vc, ts;
      if (use) { vc = use.visits || 0; ts = use.last || fallbackTs || 0; }
      else {
        if (h === undefined) h = ctx.visitIndex.get(o.key);
        vc = h ? h.visitCount || 0 : 0;
        ts = (h && h.lastVisitTime) || 0;
        const p = learn ? pickOf(o.key, ctx) : null;
        if (p) { vc += PICK_VISITS * (p.n || 0); ts = Math.max(ts, p.last || 0); }
        ts = ts || fallbackTs || 0;
      }
      const v = vc ? Math.min(1, Math.log1p(vc) / sat) : 0;
      const r = ts ? Math.pow(0.5, Math.max(0, now - ts) / half) : 0;
      const base = m * (L.wMatch + L.wVisits * v + L.wRecency * r) / wSum;
      const sw = L.sources[src].weight;
      const df = o.host ? domainFactorHost(o.host, L) : 1;
      const ff = folderFactor(path, L);
      const p = learn && learned ? learned.get(o.key) || 0 : 0;
      return { score: base * sw * df * ff * (1 + wPicks * p), breakdown: { m, v, r, sw, df, ff, p } };
    };
  }

  function searchLocal(q, L, ctx) {
    if (!q.text || q.engine) return [];
    const S = L.sources;
    const want = (src) => S[src] && S[src].enabled && S[src].max > 0 && (!q.only || q.only === src);
    const full = q.text.toLowerCase();
    const score = makeScorer(L, ctx);
    const learned = L.learnPicks !== false ? learnedFor(full, ctx) : null;
    const out = [];

    if (want('bookmarks')) {
      for (const b of ctx.bookmarks) {
        if (!folderAllowed(b, L)) continue;
        const m = matchPrepped(q.tokens, full, prep(b), L.fuzzy);
        if (!m) continue;
        // (a bookmark counts as used whenever its site is: its own page, the pages under it, and where it
        // sends you; not just the one address saved in it)
        const sc = score('bookmarks', m, b, b.path, b.dateAdded, undefined, bookmarkUsage(b, ctx, L), learned);
        out.push({ type: 'bookmark', title: b.title || displayUrl(b.url), url: b.url, key: b.key, folder: b.path, bookmarkId: b.id, favicon: b.favicon, bookmarked: true, score: sc.score, breakdown: sc.breakdown });
      }
    }
    if (want('history')) {
      for (const h of ctx.visitIndex.values()) {
        const m = matchPrepped(q.tokens, full, prep(h), L.fuzzy);
        if (!m) continue;
        const sc = score('history', m, h, null, h.lastVisitTime, h, undefined, learned);
        out.push({ type: 'history', title: h.title || displayUrl(h.url), url: h.url, key: h.key, favicon: h.favicon, score: sc.score, breakdown: sc.breakdown });
      }
    }
    if (want('tabs')) {
      for (const t of ctx.tabs) {
        const m = matchPrepped(q.tokens, full, prep(t), L.fuzzy);
        if (!m) continue;
        const sc = score('tabs', m, t, null, t.lastActive, undefined, undefined, learned);
        out.push({ type: 'tab', title: t.title || displayUrl(t.url), url: t.url, key: t.key, tab: t.ref, favicon: t.favicon, score: sc.score, breakdown: sc.breakdown });
      }
    }
    // Mixed in with everything else, commands rank like a page you've never visited and wait for
    // two typed characters; after the ">" prefix they're all there is.
    const palette = q.only === 'commands';
    if (want('commands') && (palette || full.replace(/\s+/g, '').length >= 2)) {
      const base = palette ? 2 : L.wMatch / ((L.wMatch + L.wVisits + L.wRecency) || 1);
      const wPicks = Number.isFinite(L.wPicks) ? Math.max(0, L.wPicks) : 1;
      for (const c of ctx.commands) {
        const m = matchPrepped(q.tokens, full, palette && c.palette ? c.palette : c, L.fuzzy);
        if (!m) continue;
        // (a command you run from here comes up first for what you typed to find it)
        const p = learned ? learned.get('cmd:' + c.id) || 0 : 0;
        const s = m * L.sources.commands.weight * base * (1 + wPicks * p);
        out.push({ type: 'command', title: c.title, command: c.id, category: c.category, keys: c.keys, key: 'cmd:' + c.id, score: s, breakdown: { m, v: 0, r: 0, sw: L.sources.commands.weight, df: 1, ff: 1, p } });
      }
    }
    return out;
  }

  function wantsSuggestions(q, L) {
    const S = L.sources.suggestions;
    return !!(q.text && S && S.enabled && S.max > 0 && (!q.only || q.only === 'suggestions') && !q.isUrl);
  }

  // ---------------------------------------------------------------- rank
  function rank(q, L, local, suggestions, ctx, defaultEngine) {
    const S = L.sources;
    const engine = q.engine || defaultEngine;
    const engineTpl = engine.url, engineName = engine.name;

    // Merge duplicates by URL; the best-scoring copy wins and inherits flags.
    const byUrl = new Map();
    for (const it of local) {
      if (it.score < L.minScore || (it.breakdown && (it.breakdown.df === 0 || it.breakdown.ff === 0))) continue;
      const k = it.key || normUrl(it.url);
      const prev = byUrl.get(k);
      if (!prev) { byUrl.set(k, it); continue; }
      const win = prev.score >= it.score ? prev : it;
      const lose = win === prev ? it : prev;
      win.bookmarked = !!(win.bookmarked || lose.bookmarked);
      if (!win.tab && lose.tab) win.tab = lose.tab;
      win.folder = win.folder || lose.folder;
      win.favicon = win.favicon || lose.favicon;
      byUrl.set(k, win);
    }

    const counts = { bookmark: 0, history: 0, tab: 0, command: 0 };
    const caps = { bookmark: S.bookmarks.max, history: S.history.max, tab: S.tabs.max, command: q.only === 'commands' ? 50 : S.commands.max };
    const merged = [...byUrl.values()].sort((a, b) => b.score - a.score).filter((it) => {
      if (counts[it.type] >= caps[it.type]) return false;
      counts[it.type]++;
      return true;
    });

    // Results already open in a tab switch to it.
    if (ctx && ctx.tabByKey) {
      for (const it of merged) {
        if (!it.tab && it.type !== 'command') {
          const t = ctx.tabByKey.get(it.key || normUrl(it.url));
          if (t && !(ctx.activeTab && t.ref.wcId === ctx.activeTab.wcId)) it.tab = t.ref;
        }
      }
    }

    const sugg = [];
    if (wantsSuggestions(q, L)) {
      const seen = new Set([q.text.toLowerCase()]);
      for (const str of suggestions || []) {
        const key = String(str).toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (sugg.length >= S.suggestions.max) break;
        const m = Math.max(0, 1 - sugg.length * L.suggestionDecay);
        const sc = m * S.suggestions.weight;
        if (sc < L.minScore) continue;
        sugg.push({ type: 'suggestion', title: str, query: str, url: fillTemplate(engineTpl, str), engineName, score: sc, breakdown: { m, v: 0, r: 0, sw: S.suggestions.weight, df: 1, ff: 1 } });
      }
    }

    let list = merged.concat(sugg).sort((a, b) => b.score - a.score).slice(0, q.only === 'commands' ? 50 : L.maxResults);
    if (!q.text && !q.engine) return list;

    if (q.engine) {
      list = sugg.slice(0, L.maxResults);
      list.unshift({ type: 'engine', title: q.text, query: q.text, url: q.text ? fillTemplate(engineTpl, q.text) : null, engineName, score: Infinity });
      return list;
    }
    if (q.only === 'commands') return list;
    const searchRow = { type: 'search', title: q.text, query: q.text, url: fillTemplate(engineTpl, q.text), engineName, score: 0 };
    let pos;
    if (q.only && q.only !== 'suggestions') pos = list.length;
    else if (L.searchRowPosition === 'top') pos = 0;
    else if (L.searchRowPosition === 'bottom') pos = list.length;
    else {
      pos = 0;
      while (pos < list.length && list[pos].type !== 'suggestion' && list[pos].score >= L.autoThreshold) pos++;
    }
    list.splice(pos, 0, searchRow);
    if (q.isUrl) list.unshift({ type: 'url', title: displayUrl(toUrl(q.text)), url: toUrl(q.text), score: Infinity });
    return list;
  }

  // -------------------------------------------------------- empty state
  function subtreeVisits(ctx) {
    const holder = ctx.cache || ctx;
    if (holder._subtree && holder._subtree.index === ctx.visitIndex && holder._subtree.size === ctx.visitIndex.size) return holder._subtree.map;
    const map = new Map();
    for (const h of ctx.visitIndex.values()) {
      const key = h.pk !== undefined ? h.pk : pathKey(h.url);
      if (!key) continue;
      const vc = h.visitCount || 0, last = h.lastVisitTime || 0;
      const parts = key.split('/');
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc = i === 0 ? parts[0] : acc + '/' + parts[i];
        const e = map.get(acc);
        if (e) { e.visits += vc; if (last > e.last) e.last = last; }
        else map.set(acc, { visits: vc, last });
      }
    }
    holder._subtree = { index: ctx.visitIndex, size: ctx.visitIndex.size, map };
    return map;
  }

  // Visits to a bookmark and every page under it; bookmarks with a query string count only themselves.
  // A bookmark whose address sends you somewhere else (a sign-in, mail.example.com → its inbox) counts
  // the visits there too (ctx.redirects: noted as you open it).
  function usageAt(key, pk, exact, ctx, picks) {
    let u = { visits: 0, last: 0 };
    if (!exact && pk) {
      const e = subtreeVisits(ctx).get(pk);
      if (e) u = { visits: e.visits, last: e.last };
    }
    if (!u.visits && !u.last) {
      const h = key && ctx.visitIndex.get(key);
      if (h) u = { visits: h.visitCount || 0, last: h.lastVisitTime || 0 };
    }
    if (picks) {
      // (opened from here: its own page, or a page under it, such as the tab it's open in)
      const p = !exact && pk ? subtreePicks(ctx).get(pk) : pickOf(key, ctx);
      if (p) u = { visits: u.visits + PICK_VISITS * p.n, last: Math.max(u.last, p.last) };
    }
    return u;
  }
  function bookmarkUsage(b, ctx, L) {
    prep(b);
    const picks = !L || L.learnPicks !== false;
    const exact = /\?./.test((b.url || '').split('#')[0]);
    const u = usageAt(b.key, b.pk, exact, ctx, picks);
    const to = ctx.redirects && ctx.redirects.get(b.key);
    // (unless it ends up somewhere already counted: under the bookmark's own address)
    if (to && to.key !== b.key && !(b.pk && to.pk && !exact && (to.pk === b.pk || to.pk.startsWith(b.pk + '/')))) {
      const v = usageAt(to.key, to.pk, exact, ctx, picks);
      return { visits: u.visits + v.visits, last: Math.max(u.last, v.last) };
    }
    return u;
  }
  // Picks of each page and every page under it, by path ("github.com/me" holds picks of github.com/me/repo).
  function subtreePicks(ctx) {
    const holder = ctx.cache || ctx;
    const P = ctx.picks && ctx.picks.byKey;
    if (!P || !P.size) return new Map();
    if (holder._subPicks && holder._subPicks.P === P && holder._subPicks.size === P.size) return holder._subPicks.map;
    const map = new Map();
    for (const e of P.values()) {
      if (!e.pk) continue;
      const parts = e.pk.split('/');
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc = i === 0 ? parts[0] : acc + '/' + parts[i];
        const x = map.get(acc);
        if (x) { x.n += e.n || 0; if ((e.last || 0) > x.last) x.last = e.last || 0; }
        else map.set(acc, { n: e.n || 0, last: e.last || 0 });
      }
    }
    holder._subPicks = { P, size: P.size, map };
    return map;
  }

  function emptyState(L, ctx) {
    const n = L.maxResults;
    const mode = L.emptyState;
    const withTab = (it) => {
      const t = ctx.tabByKey && ctx.tabByKey.get(it.key || normUrl(it.url));
      if (t && !(ctx.activeTab && t.ref.wcId === ctx.activeTab.wcId)) it.tab = t.ref;
      return it;
    };
    if (mode === 'tabs') {
      return ctx.tabs.filter((t) => !(ctx.activeTab && t.ref.wcId === ctx.activeTab.wcId))
        .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0)).slice(0, n)
        .map((t) => ({ type: 'tab', title: t.title || displayUrl(t.url), url: t.url, key: t.key, tab: t.ref, favicon: t.favicon, score: 0 }));
    }
    if (mode === 'history') {
      return [...ctx.visitIndex.values()].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0)).slice(0, n)
        .map((h) => withTab({ type: 'history', title: h.title || displayUrl(h.url), url: h.url, key: h.key, favicon: h.favicon, score: 0 }));
    }
    if (mode === 'bookmarks') {
      const firsts = new Map();
      for (const b of ctx.bookmarks) {
        prep(b);
        if (!(folderAllowed(b, L) && (!b.host || domainFactorHost(b.host, L) !== 0) && folderFactor(b.path, L) !== 0)) continue;
        const prev = firsts.get(b.key);
        if (!prev || (b.dateAdded || 0) < (prev.dateAdded || 0)) firsts.set(b.key, b);
      }
      return [...firsts.values()]
        .map((b) => { const u = bookmarkUsage(b, ctx, L); return { b, u, w: u.visits * (b.host ? domainFactorHost(b.host, L) : 1) * folderFactor(b.path, L) }; })
        .sort((a, b) => b.w - a.w || b.u.last - a.u.last || (b.b.dateAdded || 0) - (a.b.dateAdded || 0))
        .slice(0, n)
        .map(({ b, u }) => withTab({ type: 'bookmark', title: b.title || displayUrl(b.url), url: b.url, key: b.key, folder: b.path, bookmarkId: b.id, favicon: b.favicon, bookmarked: true, score: 0, visits: u.visits }));
    }
    return [];
  }

  // Before anything is typed: what the launcher setting asks for, and, when that's empty (no bookmarks
  // yet, say), recent tabs and then recent history, so there's always something useful to pick.
  function startState(L, ctx) {
    if (L.emptyState === 'none') return [];
    let list = emptyState(L, ctx);
    for (const mode of ['tabs', 'history']) {
      if (list.length >= Math.min(4, L.maxResults) || mode === L.emptyState) continue;
      const seen = new Set(list.map((it) => it.key));
      list = list.concat(emptyState(Object.assign({}, L, { emptyState: mode }), ctx).filter((it) => !seen.has(it.key)));
    }
    return list.slice(0, L.maxResults);
  }

  // A source prefix with nothing after it ("> ", "% "…): everything from that source, in a useful order.
  function browse(only, L, ctx) {
    if (only === 'commands') {
      return ctx.commands.map((c) => ({ type: 'command', title: c.title, command: c.id, category: c.category, keys: c.keys, key: 'cmd:' + c.id, score: 0 }));
    }
    if (only === 'tabs' || only === 'history' || only === 'bookmarks') {
      return emptyState(Object.assign({}, L, { emptyState: only, maxResults: 50 }), ctx);
    }
    return [];
  }

  return {
    hostOf, normUrl, displayUrl, pathKey, looksLikeUrl, toUrl, fillTemplate,
    prep, matchPrepped, fuzzyRatio, parseQuery, searchLocal, wantsSuggestions, rank, emptyState, startState, browse,
    bookmarkUsage, folderAllowed, domainFactorHost, folderFactor, learnedFor, PICK_VISITS,
  };
});
