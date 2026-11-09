'use strict';
// Sync's merging: what your bookmarks, settings and history become when each computer's copy is put together.
// Free of Electron and the database, so it can be tested on its own (tests/unit/sync-merge.test.mjs).
//
// Every computer keeps its own copy and writes it to the sync folder; each reads the others' and merges them
// into its own. Merging is the same on every computer (latest change wins, ties settled the same way
// everywhere), so they all end up alike.

const ROLES = ['bar', 'other', 'mobile'];          // the fixed folders, in the root
const FIXED = new Set(['root', ...ROLES]);

// ------------------------------------------------------------------ bookmarks
// A snapshot: { nodes: [{ guid, parent, key, type, title, url?, icon?, added, changed, placed }],
// dead: { guid: when deleted }, aliases: { guid: [guid it's the same as, when found] } }. key: its place in
// its folder (order.js); changed: when its title or address last changed; placed: when it last moved (to
// another folder or within one).

const { valid: validKey, keysAfter } = require('./order');
const better = (cur, stamp, val) => !cur || stamp > cur.stamp || (stamp === cur.stamp && val > cur.val);
const finalOf = (aliases, g) => { const seen = new Set(); while (aliases[g] && !seen.has(g)) { seen.add(g); g = aliases[g][0]; } return g; };

// Every computer's aliases together (a bookmark given two, by two computers, takes the smaller id).
function allAliases(snaps) {
  const map = {};
  for (const snap of snaps) {
    for (const [g, v] of Object.entries(snap.aliases || {})) {
      const to = Array.isArray(v) ? v[0] : v, at = Array.isArray(v) ? Number(v[1]) || 0 : 0;
      if (typeof to !== 'string' || to === g || FIXED.has(g)) continue;
      const cur = map[g];
      if (!cur || to < cur[0]) map[g] = [to, Math.max(at, cur ? cur[1] : 0)];
      else if (to === cur[0]) cur[1] = Math.max(cur[1], at);
    }
  }
  return map;
}

// Uses the ids bookmarks are known by now (in place).
function rename(snap, aliases) {
  for (const n of snap.nodes) { n.guid = finalOf(aliases, n.guid); if (n.parent) n.parent = finalOf(aliases, n.parent); }
  const dead = {};
  for (const [g, t] of Object.entries(snap.dead)) { const f = finalOf(aliases, g); if (!(dead[f] >= t)) dead[f] = t; }
  snap.dead = dead;
}

// Bookmarks made on two computers before they first synced, in the same folder with the same title and
// address, are the same bookmark: the one with the larger id becomes an alias of the other, everywhere.
// Returns the new aliases.
function findSame(local, remotes, now) {
  const remoteKnown = new Set(), localKnown = new Set();
  for (const r of remotes) { for (const n of r.nodes) remoteKnown.add(n.guid); for (const g of Object.keys(r.dead)) remoteKnown.add(g); }
  for (const n of local.nodes) localKnown.add(n.guid);
  for (const g of Object.keys(local.dead)) localKnown.add(g);
  const localOnly = local.nodes.filter((n) => !remoteKnown.has(n.guid) && !FIXED.has(n.guid));
  if (!localOnly.length) return {};
  const remoteDead = {};
  for (const r of remotes) for (const [g, t] of Object.entries(r.dead)) if (!(remoteDead[g] >= t)) remoteDead[g] = t;
  const remoteOnly = new Map();
  for (const r of remotes) {
    for (const n of r.nodes) {
      if (localKnown.has(n.guid) || FIXED.has(n.guid)) continue;
      if (remoteDead[n.guid] >= Math.max(n.changed || 0, n.placed || 0)) continue;
      const cur = remoteOnly.get(n.guid);
      if (!cur || (n.placed || 0) > (cur.placed || 0)) remoteOnly.set(n.guid, n);
    }
  }
  if (!remoteOnly.size) return {};
  const byKey = (a, b) => (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : a.guid < b.guid ? -1 : 1);
  const group = (list) => { const m = new Map(); for (const n of list) { if (!m.has(n.parent)) m.set(n.parent, []); m.get(n.parent).push(n); } for (const l of m.values()) l.sort(byKey); return m; };
  const lk = group(localOnly), rk = group([...remoteOnly.values()]);
  const key = (n) => n.type + '\n' + (n.type === 'separator' ? '' : (n.title || '') + '\n' + (n.url || ''));
  const found = {};
  const queue = [...lk.keys()].filter((p) => FIXED.has(p) || remoteKnown.has(p));
  while (queue.length) {
    const p = queue.shift();
    const mine = lk.get(p), theirs = rk.get(p);
    if (!mine || !theirs) continue;
    const pool = new Map();
    for (const n of theirs) { const k = key(n); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(n); }
    for (const n of mine) {
      const m = (pool.get(key(n)) || []).shift();
      if (!m) continue;
      const [keep, drop] = n.guid < m.guid ? [n.guid, m.guid] : [m.guid, n.guid];
      found[drop] = [keep, now];
      // What's in the two folders is compared next (as what's in the other's).
      if (n.type === 'folder' && lk.has(n.guid)) { lk.set(m.guid, (lk.get(m.guid) || []).concat(lk.get(n.guid))); lk.delete(n.guid); queue.push(m.guid); }
    }
  }
  return found;
}

// A joining computer's own bookmarks go after what the others already have in each folder (in their order).
function after(local, remotes) {
  const known = new Set();
  const last = new Map();
  for (const r of remotes) {
    for (const g of Object.keys(r.dead)) known.add(g);
    for (const n of r.nodes) {
      known.add(n.guid);
      if (FIXED.has(n.guid)) continue;
      const k = validKey(n.key) ? n.key : 'a0';
      if (!last.has(n.parent) || k > last.get(n.parent)) last.set(n.parent, k);
    }
  }
  const mine = new Map();
  for (const n of local.nodes) {
    if (known.has(n.guid) || FIXED.has(n.guid) || !last.has(n.parent)) continue;
    if (!mine.has(n.parent)) mine.set(n.parent, []);
    mine.get(n.parent).push(n);
  }
  for (const [p, list] of mine) {
    list.sort((a, b) => (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : a.guid < b.guid ? -1 : 1));
    keysAfter(last.get(p), list.length).forEach((k, i) => { list[i].key = k; });
  }
}

const copySnap = (s) => ({
  nodes: (Array.isArray(s.nodes) ? s.nodes : []).filter((n) => n && typeof n.guid === 'string' && n.guid !== 'root').map((n) => Object.assign({}, n)),
  dead: s.dead && typeof s.dead === 'object' ? Object.assign({}, s.dead) : {},
  aliases: s.aliases && typeof s.aliases === 'object' ? s.aliases : {},
});

// local: this computer's snapshot; remotes: the other computers'. now: a stamp later than any in them.
// joining: this computer's first sync with computers that already sync (its own bookmarks then go after
// theirs in each folder, rather than in among them). Returns { nodes, dead, aliases }: nodes are every
// bookmark and folder that stays (the fixed folders included), parents before what's in them, each with its
// folder (parent), key and place in it (index).
function mergeBookmarks(local, remotes, now = Date.now(), { joining = false } = {}) {
  local = copySnap(local);
  remotes = (remotes || []).filter((r) => r && Array.isArray(r.nodes)).map(copySnap);
  const all = [local, ...remotes];
  const aliases = allAliases(all);
  for (const snap of all) rename(snap, aliases);
  const found = findSame(local, remotes, now);
  if (Object.keys(found).length) { Object.assign(aliases, found); for (const snap of all) rename(snap, aliases); }
  if (joining) after(local, remotes);

  // The latest of each part of each bookmark.
  const content = new Map(), place = new Map(), icons = new Map();
  for (const snap of all) {
    for (const n of snap.nodes) {
      const type = ['bookmark', 'folder', 'separator'].includes(n.type) ? n.type : 'bookmark';
      const cv = JSON.stringify([type, String(n.title || ''), type === 'bookmark' ? String(n.url || '') : '']);
      if (better(content.get(n.guid), Number(n.changed) || 0, cv)) content.set(n.guid, { stamp: Number(n.changed) || 0, val: cv, type, title: String(n.title || ''), url: type === 'bookmark' ? String(n.url || '') : undefined, added: Number(n.added) || 0 });
      const k = validKey(n.key) ? n.key : 'a0';
      const pv = String(n.parent || '') + '\n' + k;
      if (better(place.get(n.guid), Number(n.placed) || 0, pv)) place.set(n.guid, { stamp: Number(n.placed) || 0, val: pv, parent: n.parent || null, key: k });
      if (n.icon && typeof n.icon === 'string' && !icons.has(n.guid)) icons.set(n.guid, n.icon);
    }
  }
  ROLES.forEach((g, i) => {
    const c = content.get(g);
    if (!c || c.type !== 'folder') content.set(g, { stamp: c ? c.stamp : 0, val: '', type: 'folder', title: '', added: 0 });
    place.set(g, { stamp: 0, val: '', parent: 'root', key: 'a' + i });
  });
  const dead = {};
  for (const snap of all) for (const [g, t] of Object.entries(snap.dead)) { const v = Number(t) || 0; if (!(dead[g] >= v)) dead[g] = v; }

  // Deleted unless changed again after it was deleted (then it's back).
  const alive = (g) => FIXED.has(g) || (content.has(g) && !(dead[g] >= Math.max(content.get(g).stamp, place.get(g).stamp)));
  const isFolder = (g) => FIXED.has(g) || (content.has(g) && content.get(g).type === 'folder');

  // Where each one goes. One whose folder was deleted (it was moved there, or made there, after the folder was
  // deleted elsewhere) goes up to the nearest folder that's still there; Other bookmarks if there's none.
  const parentOf = new Map();
  for (const g of content.keys()) {
    if (!alive(g)) continue;
    if (ROLES.includes(g)) { parentOf.set(g, 'root'); continue; }
    let p = place.get(g).parent;
    const seen = new Set([g]);
    while (p && !(p !== 'root' && alive(p) && isFolder(p))) {
      if (seen.has(p) || p === 'root') { p = null; break; }
      seen.add(p);
      const pp = place.get(p);
      p = pp ? pp.parent : null;
    }
    parentOf.set(g, p || 'other');
  }

  // A folder can't end up inside itself (moved into each other on two computers): the one moved last of the
  // loop goes to Other bookmarks.
  for (let again = true; again;) {
    again = false;
    for (const g of parentOf.keys()) {
      const path = [], on = new Set();
      let c = g;
      while (c && !FIXED.has(c)) {
        if (on.has(c)) {
          const loop = path.slice(path.indexOf(c));
          loop.sort((a, b) => (place.get(b).stamp - place.get(a).stamp) || (a < b ? 1 : a > b ? -1 : 0));
          parentOf.set(loop[0], 'other');
          again = true;
          break;
        }
        on.add(c); path.push(c);
        c = parentOf.get(c);
      }
      if (again) break;
    }
  }

  // Each folder's contents in key order (the same key, put there on two computers at once: by id).
  const kids = new Map();
  for (const [g, p] of parentOf) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(g); }
  const nodes = [];
  const visit = (folder) => {
    const list = folder === 'root' ? ROLES.filter((r) => parentOf.has(r)) : (kids.get(folder) || []).slice().sort((a, b) => {
      const ka = place.get(a).key, kb = place.get(b).key;
      return ka < kb ? -1 : ka > kb ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    list.forEach((g, i) => {
      const c = content.get(g), pl = place.get(g);
      const n = { guid: g, parent: folder, key: pl.key, index: i, type: c.type, title: c.title, added: c.added, changed: c.stamp, placed: pl.stamp };
      if (c.type === 'bookmark') n.url = c.url;
      if (icons.has(g)) n.icon = icons.get(g);
      if (ROLES.includes(g)) n.role = g;
      nodes.push(n);
      if (c.type === 'folder') visit(g);
    });
  };
  visit('root');
  const live = new Set(nodes.map((n) => n.guid));
  const outDead = {};
  for (const [g, t] of Object.entries(dead)) if (!live.has(g) && !FIXED.has(g)) outDead[g] = t;
  return { nodes, dead: outDead, aliases };
}

// Whether a merge result is what a snapshot already has (nothing to change here).
function sameBookmarks(snapshot, result) {
  const mine = new Map(snapshot.nodes.map((n) => [n.guid, n]));
  if (mine.size !== result.nodes.length) return false;
  const index = new Map();
  const byParent = new Map();
  for (const n of snapshot.nodes) { if (!byParent.has(n.parent)) byParent.set(n.parent, []); byParent.get(n.parent).push(n.guid); }
  for (const l of byParent.values()) l.forEach((g, i) => index.set(g, i));
  for (const n of result.nodes) {
    const m = mine.get(n.guid);
    if (!m || m.parent !== n.parent || m.title !== n.title || (m.url || '') !== (n.url || '') || m.type !== n.type) return false;
    if ((m.changed || 0) !== n.changed || (m.placed || 0) !== n.placed) return false;
    if (!n.role && (m.key !== n.key || index.get(n.guid) !== n.index)) return false;
  }
  for (const g of Object.keys(result.dead)) if (!(snapshot.dead && snapshot.dead[g] >= result.dead[g])) return false;
  for (const [g, v] of Object.entries(result.aliases)) { const m = snapshot.aliases && snapshot.aliases[g]; if (!m || m[0] !== v[0]) return false; }
  return true;
}

// ------------------------------------------------------------------ settings
// Settings that follow you. Left out: what belongs to one computer (its screen, its folders, its hardware,
// its performance profile and how much history the launcher keeps in memory), bookmark folders (their ids
// are this computer's), and sync's own settings.
const SYNCED = ['appearance', 'animations', 'tabs', 'workspaces', 'split', 'search', 'launcher', 'privacy', 'keyboard', 'gestures', 'translate', 'accounts',
  'extensions.allowWebStore', 'extensions.popupsInWindow', 'advanced.spellcheck', 'advanced.spellcheckLanguages'];
const LOCAL = ['appearance.uiScale', 'appearance.sidebarWidth', 'appearance.sidebarCollapsed', 'appearance.newTab.background', 'appearance.newTab.image',
  'appearance.newTab.speedDialFolder', 'appearance.newTab.moduleCfg.folder', 'launcher.bookmarkFolders', 'launcher.boosts.folders', 'launcher.historyIndex', 'privacy.clearOnExit'];
const OPEN = new Set(['keyboard.shortcuts', 'keyboard.vim.keys', 'appearance.customTheme']);

const under = (p, prefixes) => prefixes.some((x) => p === x || p.startsWith(x + '.'));
// Every setting that syncs, as a dotted path, from the defaults (lists and the maps you fill in count as one).
function syncedPaths(defaults) {
  const out = [];
  const walk = (o, pre) => {
    for (const k of Object.keys(o)) {
      const p = pre ? pre + '.' + k : k;
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !OPEN.has(p)) walk(v, p);
      else if (under(p, SYNCED) && !under(p, LOCAL)) out.push(p);
    }
  };
  walk(defaults, '');
  return out;
}

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const json = (v) => JSON.stringify(v === undefined ? null : v);

// Notes which settings changed since last time: state is { path: { v (as JSON), t } }. A setting seen for the
// first time gets stamp `first`: 0 on the first computer to sync, -1 on one joining computers that already
// do (so theirs win). Returns whether anything changed.
function noteSettings(state, settings, paths, stamp, first) {
  let changed = false;
  for (const p of paths) {
    const v = json(getPath(settings, p));
    const s = state[p];
    if (!s) { state[p] = { v, t: first }; changed = true; }
    else if (s.v !== v) { state[p] = { v, t: stamp() }; changed = true; }
  }
  return changed;
}

// What a computer writes: { path: { v: value, t } }.
function settingsPayload(state) {
  const out = {};
  for (const [p, e] of Object.entries(state)) { try { out[p] = { v: JSON.parse(e.v), t: e.t }; } catch { /* skip */ } }
  return out;
}

// Settings from other computers (their payloads) that are newer than this one's: { path: value }. Updates
// state to match.
function mergeSettings(state, remotes, paths) {
  const apply = {};
  const allowed = new Set(paths);
  for (const r of remotes) {
    if (!r || typeof r !== 'object') continue;
    for (const [p, e] of Object.entries(r)) {
      if (!allowed.has(p) || !e || typeof e !== 'object' || typeof e.t !== 'number') continue;
      const v = json(e.v);
      const s = state[p];
      if (!s || e.t > s.t || (e.t === s.t && v > s.v)) {
        if (!s || s.v !== v) apply[p] = JSON.parse(v);
        state[p] = { v, t: e.t };
      }
    }
  }
  return apply;
}

// ------------------------------------------------------------------ history
// Whether a visit (url at time) was deleted by one of these deletions ({ kind: 'url' | 'visit' | 'range' }).
function deletedBy(records) {
  const urls = new Map(), visits = new Set(), ranges = [];
  for (const r of records || []) {
    if (!r) continue;
    if (r.kind === 'url' && typeof r.url === 'string') urls.set(r.url, Math.max(urls.get(r.url) || 0, Number(r.at) || 0));
    else if (r.kind === 'visit' && typeof r.url === 'string') visits.add(Number(r.time) + ' ' + r.url);
    else if (r.kind === 'range') ranges.push([Number(r.start) || 0, Number(r.end) || 0, Number(r.at) || 0]);
  }
  return (url, time) => (urls.has(url) && time <= urls.get(url)) || visits.has(time + ' ' + url) || ranges.some(([s, e, at]) => time >= s && time < e && time <= at);
}

module.exports = { mergeBookmarks, sameBookmarks, syncedPaths, noteSettings, settingsPayload, mergeSettings, deletedBy, ROLES };
