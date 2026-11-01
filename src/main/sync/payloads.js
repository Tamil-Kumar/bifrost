'use strict';
// What each computer writes to the sync folder, and putting what the others wrote into this computer's
// bookmarks and history. No Electron here (tests/unit/sync-merge.test.mjs runs it against real databases).
const merge = require('./merge');

const DAY = 86400000;
const HISTORY_DAYS = 60;          // how far back a computer's own visits go out
const HISTORY_MAX = 15000;        // and at most this many
const DELETIONS_DAYS = 90;        // how long a deletion is passed on

// ------------------------------------------------------------------ bookmarks
function bookmarksPayload(db) { return db.bookmarkSnapshot(); }

// Merges the other computers' bookmarks (their payloads) into this one's. now: a stamp later than any so far;
// joining: see merge.mergeBookmarks. Returns whether anything changed here.
function applyBookmarks(db, remotes, now, opts) {
  const local = db.bookmarkSnapshot();
  const result = merge.mergeBookmarks(local, remotes, now, opts);
  if (merge.sameBookmarks(local, result)) return false;
  db.applyBookmarkSync(result);
  return true;
}

// ------------------------------------------------------------------ history
// This computer's visits of the last 60 days (each address once, visits pointing at it) and the history it
// deleted lately.
function historyPayload(db, deletions, now = Date.now()) {
  let since = Math.floor((now - HISTORY_DAYS * DAY) / DAY) * DAY;   // (a whole day, so the file doesn't change every moment)
  const rows = db.ownVisits(since, HISTORY_MAX);
  if (rows.length >= HISTORY_MAX) since = rows[rows.length - 1].time;
  const urls = [], index = new Map(), visits = [];
  for (const r of rows) {
    let i = index.get(r.url);
    if (i == null) { i = urls.length; index.set(r.url, i); urls.push([r.url, r.title || '']); }
    visits.push(r.transition && r.transition !== 'link' ? [r.time, i, r.transition] : [r.time, i]);
  }
  return { since, urls, visits, deletions: recentDeletions(deletions, now) };
}

function recentDeletions(list, now = Date.now()) {
  return (list || []).filter((d) => d && (Number(d.at) || 0) > now - DELETIONS_DAYS * DAY);
}

// Puts another computer's history (its payload) into this one's: its visits since it says (what it no longer
// has goes here too), less what was deleted here or by anyone since; and what it deleted.
// deletions: every deletion known here (this computer's and the others'). Returns whether anything changed.
function applyHistory(db, source, payload, deletions) {
  if (!payload || !Array.isArray(payload.urls) || !Array.isArray(payload.visits)) return false;
  const list = [];
  for (const v of payload.visits) {
    if (!Array.isArray(v)) continue;
    const u = payload.urls[v[1]];
    if (!Array.isArray(u) || typeof u[0] !== 'string') continue;
    list.push({ time: Number(v[0]), url: u[0], title: String(u[1] || ''), transition: typeof v[2] === 'string' ? v[2] : 'link' });
  }
  const skip = merge.deletedBy(deletions);
  const a = db.syncVisits(source, Number(payload.since) || 0, list, skip);
  const b = Array.isArray(payload.deletions) && payload.deletions.length ? db.applyHistoryDeletions(payload.deletions) : false;
  return a || b;
}

// ------------------------------------------------------------------ open tabs
// The open tabs of each window (from the saved session), most recently used window first. Only web pages:
// Bifrost's own pages and files on this computer mean nothing on another.
function tabsPayload(sessionState) {
  const wins = Object.values((sessionState && sessionState.windows) || {}).filter((w) => w && w.ui && Array.isArray(w.ui.tabs));
  wins.sort((a, b) => (b.focusedAt || b.savedAt || 0) - (a.focusedAt || a.savedAt || 0));
  return wins.map((w) => {
    const spaces = new Map((w.ui.workspaces || []).map((s) => [s.id, s.name || '']));
    const tabs = w.ui.tabs.filter((t) => t && typeof t.url === 'string' && /^(https?|ftp):/i.test(t.url)).slice(0, 500).map((t) => {
      const o = { url: t.url, title: String(t.title || '').slice(0, 300) };
      if (t.favicon && t.favicon.length < 2048) o.icon = t.favicon;
      const sp = spaces.get(t.workspaceId);
      if (sp && spaces.size > 1) o.space = sp;
      if (t.pinned) o.pinned = true;
      return o;
    });
    return { tabs };
  }).filter((w) => w.tabs.length);
}

module.exports = { bookmarksPayload, applyBookmarks, historyPayload, applyHistory, recentDeletions, tabsPayload, HISTORY_DAYS, DAY };
