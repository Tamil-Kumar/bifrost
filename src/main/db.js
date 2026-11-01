'use strict';
// SQLite storage (Node's built-in node:sqlite, so there are no native modules to ship per architecture).
// Tables: history urls + visits, bookmarks tree, downloads, per-site settings, misc key/value.
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { keyBetween, keysAfter, valid: validKey } = require('./sync/order');

// node:sqlite prints an ExperimentalWarning once; it's expected, so keep the console clean.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : w && w.message;
  if (msg && /SQLite is an experimental feature/i.test(msg)) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 5;
const ROOT = 1, BAR = 2, OTHER = 3, MOBILE = 4;
// A bookmark's lasting id, the same on every computer it syncs to (the fixed folders use their role).
const newGuid = () => crypto.randomBytes(9).toString('base64url');

class Database extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    // When something changed, for sync's "latest change wins" (main/sync replaces it with a clock that
    // never goes back, even if this computer's does).
    this.stamp = () => Date.now();
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
    this.prepare();
  }

  migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    if (v < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS urls (
          id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
          visit_count INTEGER NOT NULL DEFAULT 0, typed_count INTEGER NOT NULL DEFAULT 0,
          last_visit INTEGER NOT NULL DEFAULT 0, favicon TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS urls_last_visit ON urls(last_visit DESC);
        CREATE TABLE IF NOT EXISTS visits (
          id INTEGER PRIMARY KEY, url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
          time INTEGER NOT NULL, transition TEXT NOT NULL DEFAULT 'link'
        );
        CREATE INDEX IF NOT EXISTS visits_time ON visits(time DESC);
        CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id);
        CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
          url TEXT, date_added INTEGER NOT NULL DEFAULT 0, date_modified INTEGER NOT NULL DEFAULT 0,
          role TEXT, favicon TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS bookmarks_parent ON bookmarks(parent_id, position);
        CREATE INDEX IF NOT EXISTS bookmarks_url ON bookmarks(url);
        CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY, url TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
          mime TEXT NOT NULL DEFAULT '', total INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'progressing', started INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0,
          referrer TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS site_settings (
          host TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (host, key)
        );
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      const now = Date.now();
      const ins = this.db.prepare('INSERT OR IGNORE INTO bookmarks (id, parent_id, position, type, title, role, date_added, date_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      ins.run(ROOT, null, 0, 'folder', 'Bookmarks', 'root', now, now);
      ins.run(BAR, ROOT, 0, 'folder', 'Bookmarks bar', 'bar', now, now);
      ins.run(OTHER, ROOT, 1, 'folder', 'Other bookmarks', 'other', now, now);
      ins.run(MOBILE, ROOT, 2, 'folder', 'Mobile bookmarks', 'mobile', now, now);
    }
    if (v < 2) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS closed_tabs (id INTEGER PRIMARY KEY, closed INTEGER NOT NULL, data TEXT NOT NULL);`);
    }
    if (v < 3) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS urls_visit_count ON urls(visit_count DESC);`);
    }
    if (v < 4) {
      // Each site's best large icon (Speed Dial tiles), see icons.js. A row with no data marks a failed lookup.
      this.db.exec(`CREATE TABLE IF NOT EXISTS site_icons (
        host TEXT PRIMARY KEY, data BLOB, mime TEXT NOT NULL DEFAULT '', width INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL DEFAULT 0
      );`);
    }
    if (v < 5) {
      // For sync (main/sync): every bookmark gets a lasting id, a position key (its place in its folder, see
      // sync/order.js) and the times its title or address (changed) and its folder or place in it (placed) last
      // changed. Deleting one leaves a tombstone; aliases record bookmarks found to be the same as one made on
      // another computer. Visits remember which computer they happened on ('' = this one).
      this.tx(() => {
        const cols = (t) => new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
        const bc = cols('bookmarks');
        if (!bc.has('guid')) this.db.exec('ALTER TABLE bookmarks ADD COLUMN guid TEXT');
        if (!bc.has('sort_key')) this.db.exec("ALTER TABLE bookmarks ADD COLUMN sort_key TEXT NOT NULL DEFAULT ''");
        for (const c of ['changed', 'placed']) if (!bc.has(c)) this.db.exec(`ALTER TABLE bookmarks ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`);
        const setGuid = this.db.prepare('UPDATE bookmarks SET guid = ? WHERE id = ?');
        for (const r of this.db.prepare('SELECT id, role FROM bookmarks WHERE guid IS NULL').all()) setGuid.run(r.role || newGuid(), r.id);
        const setKey = this.db.prepare('UPDATE bookmarks SET sort_key = ? WHERE id = ?');
        const folders = this.db.prepare('SELECT DISTINCT parent_id FROM bookmarks WHERE parent_id IS NOT NULL').all();
        for (const f of folders) {
          const kids = this.db.prepare('SELECT id FROM bookmarks WHERE parent_id = ? ORDER BY position, id').all(f.parent_id);
          keysAfter(null, kids.length).forEach((k, i) => setKey.run(k, kids[i].id));
        }
        this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_guid ON bookmarks(guid);
          CREATE TABLE IF NOT EXISTS bookmark_tombstones (guid TEXT PRIMARY KEY, deleted INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS bookmark_aliases (guid TEXT PRIMARY KEY, target TEXT NOT NULL, added INTEGER NOT NULL);`);
        if (!cols('visits').has('source')) this.db.exec("ALTER TABLE visits ADD COLUMN source TEXT NOT NULL DEFAULT ''");
        this.db.exec('CREATE INDEX IF NOT EXISTS visits_source ON visits(source, time)');
      });
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  prepare() {
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      urlByUrl: p('SELECT * FROM urls WHERE url = ?'),
      insertUrl: p('INSERT INTO urls (url, title, visit_count, typed_count, last_visit, favicon) VALUES (?, ?, ?, ?, ?, ?)'),
      bumpUrl: p('UPDATE urls SET visit_count = visit_count + 1, typed_count = typed_count + ?, last_visit = ?, title = CASE WHEN ? != \'\' THEN ? ELSE title END, hidden = 0 WHERE id = ?'),
      insertVisit: p('INSERT INTO visits (url_id, time, transition) VALUES (?, ?, ?)'),
      setTitle: p('UPDATE urls SET title = ? WHERE url = ?'),
      setFavicon: p('UPDATE urls SET favicon = ? WHERE url = ?'),
      recentUrls: p('SELECT url, title, visit_count AS visitCount, typed_count AS typedCount, last_visit AS lastVisitTime, favicon FROM urls WHERE hidden = 0 ORDER BY last_visit DESC LIMIT ?'),
      searchUrls: p(`SELECT url, title, visit_count AS visitCount, typed_count AS typedCount, last_visit AS lastVisitTime, favicon FROM urls
                     WHERE hidden = 0 AND (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') ORDER BY last_visit DESC LIMIT ?`),
      topUrls: p('SELECT url, title, visit_count AS visitCount, last_visit AS lastVisitTime, favicon FROM urls WHERE hidden = 0 ORDER BY visit_count DESC, last_visit DESC LIMIT ?'),
      deleteUrl: p('DELETE FROM urls WHERE url = ?'),
      bm: p('SELECT * FROM bookmarks WHERE id = ?'),
      bmChildren: p('SELECT * FROM bookmarks WHERE parent_id = ? ORDER BY position'),
      bmAll: p('SELECT * FROM bookmarks ORDER BY parent_id, position'),
      bmByUrl: p('SELECT * FROM bookmarks WHERE url = ?'),
      bmMaxPos: p('SELECT COALESCE(MAX(position), -1) AS m FROM bookmarks WHERE parent_id = ?'),
      bmShift: p('UPDATE bookmarks SET position = position + ? WHERE parent_id = ? AND position >= ?'),
      bmInsert: p('INSERT INTO bookmarks (parent_id, position, type, title, url, date_added, date_modified, favicon, guid, sort_key, changed, placed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      bmUpdate: p('UPDATE bookmarks SET title = ?, url = ?, date_modified = ?, changed = ? WHERE id = ?'),
      bmMove: p('UPDATE bookmarks SET parent_id = ?, position = ?, date_modified = ?, sort_key = ?, placed = ? WHERE id = ?'),
      bmKeys: p('SELECT id, sort_key FROM bookmarks WHERE parent_id = ? AND id != ? ORDER BY position'),
      bmSetKey: p('UPDATE bookmarks SET sort_key = ?, placed = ? WHERE id = ?'),
      bmTomb: p('INSERT INTO bookmark_tombstones (guid, deleted) VALUES (?, ?) ON CONFLICT(guid) DO UPDATE SET deleted = MAX(deleted, excluded.deleted)'),
      bmDelete: p('DELETE FROM bookmarks WHERE id = ?'),
      bmSetFavicon: p('UPDATE bookmarks SET favicon = ? WHERE url = ?'),
      dlInsert: p('INSERT INTO downloads (url, filename, path, mime, total, received, state, started, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      dlUpdate: p('UPDATE downloads SET filename = ?, path = ?, total = ?, received = ?, state = ?, ended = ? WHERE id = ?'),
      dlAll: p('SELECT * FROM downloads ORDER BY started DESC LIMIT ?'),
      dlDelete: p('DELETE FROM downloads WHERE id = ?'),
      ssGet: p('SELECT key, value FROM site_settings WHERE host = ?'),
      ssAll: p('SELECT host, key, value FROM site_settings ORDER BY host'),
      ssSet: p('INSERT INTO site_settings (host, key, value) VALUES (?, ?, ?) ON CONFLICT(host, key) DO UPDATE SET value = excluded.value'),
      ssDel: p('DELETE FROM site_settings WHERE host = ? AND key = ?'),
      kvGet: p('SELECT value FROM kv WHERE key = ?'),
      kvSet: p('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      kvDel: p('DELETE FROM kv WHERE key = ?'),
      closedPush: p('INSERT INTO closed_tabs (closed, data) VALUES (?, ?)'),
      closedPop: p('SELECT id, data FROM closed_tabs ORDER BY id DESC LIMIT 1'),
      closedList: p('SELECT id, closed, data FROM closed_tabs ORDER BY id DESC LIMIT ?'),
      closedDel: p('DELETE FROM closed_tabs WHERE id = ?'),
      closedTrim: p('DELETE FROM closed_tabs WHERE id NOT IN (SELECT id FROM closed_tabs ORDER BY id DESC LIMIT 50)'),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ----------------------------------------------------------------- history
  addVisit({ url, title = '', time = Date.now(), transition = 'link', typed = false }) {
    if (!url || !/^(https?|file|ftp):/i.test(url)) return null;
    const row = this.q.urlByUrl.get(url);
    let entry;
    if (row) {
      this.q.bumpUrl.run(typed ? 1 : 0, time, title, title, row.id);
      this.q.insertVisit.run(row.id, time, transition);
      entry = { id: row.id, url, title: title || row.title, visitCount: row.visit_count + 1, typedCount: row.typed_count + (typed ? 1 : 0), lastVisitTime: time, favicon: row.favicon, transition };
    } else {
      const r = this.q.insertUrl.run(url, title, 1, typed ? 1 : 0, time, '');
      this.q.insertVisit.run(r.lastInsertRowid, time, transition);
      entry = { id: Number(r.lastInsertRowid), url, title, visitCount: 1, typedCount: typed ? 1 : 0, lastVisitTime: time, favicon: '', transition };
    }
    this.emit('visit', entry);
    return entry;
  }

  setTitle(url, title) {
    if (!title) return;
    const r = this.q.setTitle.run(title, url);
    if (r.changes) this.emit('title', { url, title });
  }

  setFavicon(url, favicon) {
    if (!favicon || favicon.length > 2048) return;
    this.q.setFavicon.run(favicon, url);
    this.q.bmSetFavicon.run(favicon, url);
  }

  recentHistory(limit) { return this.q.recentUrls.all(limit); }
  topSites(limit = 12) { return this.q.topUrls.all(limit); }

  searchHistory(text, limit = 100) {
    const like = '%' + String(text).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    return this.q.searchUrls.all(like, like, limit);
  }

  // History page: visits newest first, optionally filtered and paged.
  visits({ text = '', before = Date.now() + 1, limit = 200 } = {}) {
    const like = '%' + String(text).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    return this.db.prepare(`
      SELECT v.id, v.time, v.transition, v.source, u.url, u.title, u.favicon FROM visits v JOIN urls u ON u.id = v.url_id
      WHERE v.time < ? AND (? = '' OR u.url LIKE ? ESCAPE '\\' OR u.title LIKE ? ESCAPE '\\')
      ORDER BY v.time DESC LIMIT ?`).all(before, text, like, like, limit);
  }

  // 'history-changed' carries the URLs that left history completely ({ all: true } when everything did).
  // 'history-deleted' describes what you deleted, for sync to delete on your other computers too (not sent for
  // clearing history as the browser closes: { local: true }).
  deleteVisit(id) {
    const row = this.db.prepare('SELECT v.url_id, v.time, u.url FROM visits v JOIN urls u ON u.id = v.url_id WHERE v.id = ?').get(id);
    if (!row) return;
    let gone = false;
    this.tx(() => {
      this.db.prepare('DELETE FROM visits WHERE id = ?').run(id);
      const left = this.db.prepare('SELECT COUNT(*) AS n, MAX(time) AS t FROM visits WHERE url_id = ?').get(row.url_id);
      if (!left.n) { this.db.prepare('DELETE FROM urls WHERE id = ?').run(row.url_id); gone = true; }
      else this.db.prepare('UPDATE urls SET visit_count = ?, last_visit = ? WHERE id = ?').run(left.n, left.t, row.url_id);
    });
    this.emit('history-changed', { all: false, urls: gone ? [row.url] : [] });
    this.emit('history-deleted', { kind: 'visit', url: row.url, time: row.time });
  }

  deleteUrl(url) {
    const r = this.q.deleteUrl.run(url);
    this.emit('history-changed', { all: false, urls: r.changes ? [url] : [] });
    this.emit('history-deleted', { kind: 'url', url });
  }

  deleteHistoryRange(start, end, { local = false } = {}) {
    let urls = [];
    this.tx(() => {
      urls = this.db.prepare(`SELECT url FROM urls WHERE id IN (SELECT url_id FROM visits WHERE time >= ? AND time < ?)
                              AND id NOT IN (SELECT url_id FROM visits WHERE time < ? OR time >= ?)`).all(start, end, start, end).map((r) => r.url);
      this.db.prepare('DELETE FROM visits WHERE time >= ? AND time < ?').run(start, end);
      this.db.prepare('DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)').run();
      this.db.exec(`UPDATE urls SET visit_count = (SELECT COUNT(*) FROM visits WHERE url_id = urls.id),
                    last_visit = (SELECT COALESCE(MAX(time), 0) FROM visits WHERE url_id = urls.id)`);
    });
    this.emit('history-changed', { all: false, urls });
    if (!local) this.emit('history-deleted', { kind: 'range', start, end });
  }

  clearHistory({ local = false } = {}) {
    this.db.exec('DELETE FROM visits; DELETE FROM urls;');
    this.emit('history-changed', { all: true, urls: [] });
    if (!local) this.emit('history-deleted', { kind: 'range', start: 0, end: Date.now() + 1 });
  }

  // ------------------------------------------------------------ history sync
  // Visits made on this computer since `since`, newest first.
  ownVisits(since, limit) {
    return this.db.prepare(`SELECT v.time, v.transition, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url_id
      WHERE v.source = '' AND v.time >= ? ORDER BY v.time DESC LIMIT ?`).all(since, limit);
  }

  // Number of visits and the latest one, again, after visits to these URLs (ids) came or went; URLs with no
  // visits left leave history. Returns the URLs that left.
  recount(urlIds) {
    const gone = [];
    const get = this.db.prepare('SELECT url FROM urls WHERE id = ?');
    const left = this.db.prepare('SELECT COUNT(*) AS n, MAX(time) AS t FROM visits WHERE url_id = ?');
    const upd = this.db.prepare('UPDATE urls SET visit_count = ?, last_visit = ? WHERE id = ?');
    const del = this.db.prepare('DELETE FROM urls WHERE id = ?');
    for (const id of urlIds) {
      const l = left.get(id);
      if (l.n) upd.run(l.n, l.t, id);
      else { const r = get.get(id); if (r) { gone.push(r.url); del.run(id); } }
    }
    return gone;
  }

  // Makes the visits that came from another computer (source) since `since` the same as `list`
  // ([{ url, title, time, transition }]), leaving out what `skip(url, time)` says was deleted here.
  // Returns whether anything changed.
  syncVisits(source, since, list, skip) {
    const have = this.db.prepare(`SELECT v.id, v.url_id, v.time, v.transition, u.url FROM visits v JOIN urls u ON u.id = v.url_id
      WHERE v.source = ? AND v.time >= ?`).all(source, since);
    const key = (url, time) => time + ' ' + url;
    const want = new Map();
    for (const e of list) {
      if (!e || typeof e.url !== 'string' || !/^(https?|file|ftp):/i.test(e.url) || !Number.isFinite(e.time) || e.time < since) continue;
      if (skip && skip(e.url, e.time)) continue;
      want.set(key(e.url, e.time), e);
    }
    const haveKeys = new Set(have.map((r) => key(r.url, r.time)));
    const add = [...want.entries()].filter(([k]) => !haveKeys.has(k)).map(([, e]) => e);
    const drop = have.filter((r) => !want.has(key(r.url, r.time)));
    if (!add.length && !drop.length) return false;
    let gone = [];
    this.tx(() => {
      const touched = new Set();
      const ins = this.db.prepare('INSERT INTO visits (url_id, time, transition, source) VALUES (?, ?, ?, ?)');
      const typed = this.db.prepare('UPDATE urls SET typed_count = MAX(0, typed_count + ?) WHERE id = ?');
      const title = this.db.prepare("UPDATE urls SET title = ? WHERE id = ? AND (title = '' OR last_visit <= ?)");
      for (const e of add) {
        const row = this.q.urlByUrl.get(e.url);
        const id = row ? row.id : Number(this.q.insertUrl.run(e.url, String(e.title || ''), 0, 0, 0, '').lastInsertRowid);
        if (row && e.title) title.run(String(e.title), id, e.time);
        ins.run(id, e.time, String(e.transition || 'link'), source);
        if (e.transition === 'typed') typed.run(1, id);
        touched.add(id);
      }
      const del = this.db.prepare('DELETE FROM visits WHERE id = ?');
      for (const r of drop) { del.run(r.id); if (r.transition === 'typed') typed.run(-1, r.url_id); touched.add(r.url_id); }
      gone = this.recount(touched);
    });
    this.emit('history-changed', { all: false, urls: gone });
    return true;
  }

  // Deletes what deletions made on other computers cover ({ kind: 'url', url, at } | { kind: 'visit', url, time }
  // | { kind: 'range', start, end, at }), visits that happened after a deletion staying. Returns whether anything went.
  applyHistoryDeletions(records) {
    let gone = [], any = false;
    this.tx(() => {
      const touched = new Set();
      for (const r of records) {
        let where, args;
        if (r.kind === 'url' && typeof r.url === 'string') { where = 'url_id = (SELECT id FROM urls WHERE url = ?) AND time <= ?'; args = [r.url, Number(r.at) || 0]; }
        else if (r.kind === 'visit' && typeof r.url === 'string') { where = 'url_id = (SELECT id FROM urls WHERE url = ?) AND time = ?'; args = [r.url, Number(r.time) || 0]; }
        else if (r.kind === 'range') { where = 'time >= ? AND time < ? AND time <= ?'; args = [Number(r.start) || 0, Number(r.end) || 0, Number(r.at) || 0]; }
        else continue;
        const ids = this.db.prepare(`SELECT DISTINCT url_id FROM visits WHERE ${where}`).all(...args);
        if (!ids.length) continue;
        this.db.prepare(`DELETE FROM visits WHERE ${where}`).run(...args);
        for (const x of ids) touched.add(x.url_id);
        any = true;
      }
      gone = this.recount(touched);
    });
    if (any) this.emit('history-changed', { all: false, urls: gone });
    return any;
  }

  // chrome.history-style queries.
  historySearch({ text = '', start = 0, end = Date.now() + 1, limit = 100 } = {}) {
    const words = String(text).trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const where = ['hidden = 0', 'last_visit >= ?', 'last_visit < ?'];
    const args = [start, end];
    for (const w of words) {
      const like = '%' + w.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push("(url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    args.push(Math.max(1, Math.min(100000, limit | 0 || 100)));
    return this.db.prepare(`SELECT id, url, title, visit_count AS visitCount, typed_count AS typedCount, last_visit AS lastVisitTime
      FROM urls WHERE ${where.join(' AND ')} ORDER BY last_visit DESC LIMIT ?`).all(...args);
  }

  urlVisits(url) {
    return this.db.prepare('SELECT v.id, v.url_id AS urlId, v.time, v.transition FROM visits v JOIN urls u ON u.id = v.url_id WHERE u.url = ? ORDER BY v.time').all(url);
  }

  // Bulk import (other browsers). entries: [{url, title, visitCount, lastVisitTime, typedCount}]
  importHistory(entries) {
    let added = 0;
    this.tx(() => {
      const upd = this.db.prepare('UPDATE urls SET visit_count = visit_count + ?, last_visit = MAX(last_visit, ?), title = CASE WHEN title = \'\' THEN ? ELSE title END WHERE id = ?');
      for (const e of entries) {
        if (!e.url || !/^(https?|file|ftp):/i.test(e.url)) continue;
        const vc = Math.max(1, e.visitCount | 0), t = e.lastVisitTime || Date.now();
        const row = this.q.urlByUrl.get(e.url);
        let id;
        if (row) { upd.run(vc, t, e.title || '', row.id); id = row.id; }
        else { id = this.q.insertUrl.run(e.url, e.title || '', vc, e.typedCount | 0, t, '').lastInsertRowid; added++; }
        this.q.insertVisit.run(id, t, 'imported');
      }
    });
    this.emit('history-changed');
    return added;
  }

  // --------------------------------------------------------------- bookmarks
  static get ROOTS() { return { ROOT, BAR, OTHER, MOBILE }; }

  bookmark(id) { return this.rowToBm(this.q.bm.get(id)); }
  children(id) { return this.q.bmChildren.all(id).map((r) => this.rowToBm(r)); }
  bookmarksByUrl(url) { return this.q.bmByUrl.all(url).map((r) => this.rowToBm(r)); }

  rowToBm(r) {
    if (!r) return null;
    return { id: r.id, parentId: r.parent_id, index: r.position, type: r.type, title: r.title, url: r.url || undefined, dateAdded: r.date_added, dateModified: r.date_modified, role: r.role || undefined, favicon: r.favicon || undefined };
  }

  // Whole tree as nested nodes (chrome.bookmarks-like).
  bookmarkTree() {
    const rows = this.q.bmAll.all();
    const byId = new Map();
    for (const r of rows) byId.set(r.id, Object.assign(this.rowToBm(r), r.type === 'folder' ? { children: [] } : {}));
    let root = null;
    for (const n of byId.values()) {
      if (n.parentId == null) root = n;
      else { const p = byId.get(n.parentId); if (p && p.children) p.children.push(n); }
    }
    for (const n of byId.values()) if (n.children) n.children.sort((a, b) => a.index - b.index);
    return root;
  }

  // Flat list of bookmarks with folder path (titles) and ancestor ids, for search and pickers.
  flatBookmarks() {
    const out = [];
    const walk = (n, path, ancestors) => {
      if (n.type === 'bookmark') { out.push({ id: n.id, title: n.title, url: n.url, path, ancestors, dateAdded: n.dateAdded, favicon: n.favicon }); return; }
      if (!n.children) return;
      const isRoot = n.parentId == null;
      const nextPath = isRoot ? path : path.concat(n.title || '');
      const nextAnc = isRoot ? ancestors : ancestors.concat(n.id);
      for (const c of n.children) walk(c, nextPath, nextAnc);
    };
    const root = this.bookmarkTree();
    if (root) walk(root, [], []);
    return out;
  }

  createBookmark({ parentId = BAR, index, type, title = '', url }) {
    if (!type) type = url ? 'bookmark' : 'folder';
    if (!['bookmark', 'folder', 'separator'].includes(type)) throw new Error('bad bookmark type');
    const parent = this.q.bm.get(parentId);
    if (!parent || parent.type !== 'folder') throw new Error('parent is not a folder');
    const now = Date.now(), st = this.stamp();
    const id = this.tx(() => {
      const max = this.q.bmMaxPos.get(parentId).m;
      const pos = index == null || index > max + 1 || index < 0 ? max + 1 : index;
      const key = this.keyAt(parentId, pos, null);
      if (pos <= max) this.q.bmShift.run(1, parentId, pos);
      const fav = url ? (this.q.urlByUrl.get(url) || {}).favicon || '' : '';
      return this.q.bmInsert.run(parentId, pos, type, title, type === 'bookmark' ? url : null, now, now, fav, newGuid(), key, st, st).lastInsertRowid;
    });
    this.emit('bookmarks-changed', { type: 'created', id: Number(id) });
    return this.bookmark(Number(id));
  }

  updateBookmark(id, { title, url }) {
    const r = this.q.bm.get(id);
    if (!r || r.role) throw new Error('cannot edit this bookmark');
    this.q.bmUpdate.run(title != null ? title : r.title, url != null && r.type === 'bookmark' ? url : r.url, Date.now(), this.stamp(), id);
    this.emit('bookmarks-changed', { type: 'changed', id });
    return this.bookmark(id);
  }

  moveBookmark(id, { parentId, index }) {
    const r = this.q.bm.get(id);
    if (!r || r.role) throw new Error('cannot move this bookmark');
    const target = parentId != null ? parentId : r.parent_id;
    const parent = this.q.bm.get(target);
    if (!parent || parent.type !== 'folder') throw new Error('target is not a folder');
    // A folder can't move into itself or its descendants.
    for (let p = parent; p; p = p.parent_id != null ? this.q.bm.get(p.parent_id) : null) if (p.id === id) throw new Error('cannot move a folder into itself');
    const old = { oldParentId: r.parent_id, oldIndex: this.visibleIndex(r.parent_id, r.position) };
    this.tx(() => {
      // Take the item out of its sibling sequence, close the gap, then open one at the new position.
      // Like Chrome, an index in the same folder refers to positions before the item was removed.
      this.db.prepare('UPDATE bookmarks SET position = -1 WHERE id = ?').run(id);
      this.db.prepare('UPDATE bookmarks SET position = position - 1 WHERE parent_id = ? AND position > ?').run(r.parent_id, r.position);
      const max = this.db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM bookmarks WHERE parent_id = ? AND id != ?').get(target, id).m;
      let pos = index;
      if (pos != null && target === r.parent_id && pos > r.position) pos -= 1;
      if (pos == null || pos < 0 || pos > max + 1) pos = max + 1;
      this.db.prepare('UPDATE bookmarks SET position = position + 1 WHERE parent_id = ? AND position >= ? AND id != ?').run(target, pos, id);
      const key = this.keyAt(target, pos, id);
      this.q.bmMove.run(target, pos, Date.now(), key, this.stamp(), id);
    });
    this.emit('bookmarks-changed', Object.assign({ type: 'moved', id }, old));
    return this.bookmark(id);
  }

  removeBookmark(id) {
    const r = this.q.bm.get(id);
    if (!r || r.role) throw new Error('cannot remove this bookmark');
    const info = { parentId: r.parent_id, index: this.visibleIndex(r.parent_id, r.position), node: this.subtree(id) };
    this.tx(() => {
      // Tombstones for it and everything in it, so sync removes them on your other computers too.
      const st = this.stamp();
      const bury = (rid) => { const g = this.q.bm.get(rid); if (g && g.guid) this.q.bmTomb.run(g.guid, st); for (const c of this.q.bmChildren.all(rid)) bury(c.id); };
      bury(id);
      this.q.bmDelete.run(id);
      this.db.prepare('UPDATE bookmarks SET position = position - 1 WHERE parent_id = ? AND position > ?').run(r.parent_id, r.position);
    });
    this.emit('bookmarks-changed', Object.assign({ type: 'removed', id }, info));
  }

  // A position key for something going to place `pos` in a folder (`self`: the one moving, left out). If the
  // neighbors' keys leave no room (two computers put bookmarks in the same spot at once), the folder is
  // renumbered first.
  keyAt(parentId, pos, self) {
    const sib = this.q.bmKeys.all(parentId, self == null ? -1 : self);
    const keyOf = (x) => (x && validKey(x.sort_key) ? x.sort_key : null);
    const a = pos > 0 ? keyOf(sib[pos - 1]) : null, b = pos < sib.length ? keyOf(sib[pos]) : null;
    if ((pos === 0 || a) && (pos >= sib.length || b) && (!a || !b || a < b)) return keyBetween(a, b);
    const st = this.stamp();
    const keys = keysAfter(null, sib.length + 1);
    sib.forEach((x, i) => { const k = keys[i < pos ? i : i + 1]; if (x.sort_key !== k) this.q.bmSetKey.run(k, st, x.id); });
    return keys[pos];
  }

  // Position among a folder's bookmarks and folders, not counting separators (what chrome.bookmarks calls index).
  visibleIndex(parentId, position) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE parent_id = ? AND position < ? AND type != 'separator'").get(parentId, position).n;
  }

  // A node with its descendants (folders get a children array).
  subtree(id) {
    const node = this.bookmark(id);
    if (!node) return null;
    if (node.type === 'folder') node.children = this.q.bmChildren.all(id).map((c) => this.subtree(c.id));
    return node;
  }

  // Import a nested tree ({title, url?, children?}) into a folder. Returns the number of bookmarks added.
  importBookmarks(parentId, nodes) {
    let count = 0;
    const now = Date.now(), st = this.stamp();
    this.tx(() => {
      const put = (pid, list) => {
        let pos = this.q.bmMaxPos.get(pid).m + 1;
        let key = this.keyAt(pid, pos, null);
        const next = () => { const k = key; key = keyBetween(key, null); return k; };
        for (const n of list) {
          if (n.url) {
            if (!/^(https?|file|ftp|javascript|about|chrome|vivaldi|edge|brave|place):/i.test(n.url) || /^place:/i.test(n.url)) continue;
            this.q.bmInsert.run(pid, pos++, 'bookmark', n.title || '', n.url, n.dateAdded || now, now, '', newGuid(), next(), st, st);
            count++;
          } else if (n.separator) {
            this.q.bmInsert.run(pid, pos++, 'separator', '', null, now, now, '', newGuid(), next(), st, st);
          } else {
            const fid = this.q.bmInsert.run(pid, pos++, 'folder', n.title || '', null, n.dateAdded || now, now, '', newGuid(), next(), st, st).lastInsertRowid;
            put(Number(fid), n.children || []);
          }
        }
      };
      put(parentId, nodes);
    });
    this.emit('bookmarks-changed', { type: 'imported' });
    return count;
  }

  searchBookmarks(text, limit = 100) {
    const t = String(text || '').toLowerCase();
    return this.flatBookmarks().filter((b) => (b.title || '').toLowerCase().includes(t) || (b.url || '').toLowerCase().includes(t)).slice(0, limit);
  }

  // ---------------------------------------------------------- bookmark sync
  // Every bookmark and folder by lasting id (the root itself left out) with its folder, position key and when
  // each part last changed; the tombstones of deleted ones; and aliases (bookmarks found to be the same as one
  // from another computer: their id → the one kept).
  bookmarkSnapshot() {
    const rows = this.q.bmAll.all();
    const guidOf = new Map(rows.map((r) => [r.id, r.guid]));
    const nodes = [];
    for (const r of rows) {
      if (r.role === 'root' || !r.guid) continue;
      const n = { guid: r.guid, parent: guidOf.get(r.parent_id) || null, key: r.sort_key, type: r.type, title: r.title, added: r.date_added, changed: r.changed, placed: r.placed };
      if (r.type === 'bookmark') n.url = r.url || '';
      if (r.favicon && r.favicon.length <= 300 && /^https?:/i.test(r.favicon)) n.icon = r.favicon;   // (not pictures: too big)
      if (r.role) n.role = r.role;
      nodes.push(n);
    }
    const dead = {}, aliases = {};
    for (const t of this.db.prepare('SELECT guid, deleted FROM bookmark_tombstones').all()) dead[t.guid] = t.deleted;
    for (const a of this.db.prepare('SELECT guid, target, added FROM bookmark_aliases').all()) aliases[a.guid] = [a.target, a.added];
    return { nodes, dead, aliases };
  }

  // Makes the bookmarks what sync worked out (main/sync/merge.js): `nodes` every live one, parents before what's
  // in them, each with its folder (parent), position key and place in it (index); `dead` the tombstones;
  // `aliases` as in bookmarkSnapshot. Returns whether anything you'd see changed.
  applyBookmarkSync({ nodes, dead = {}, aliases = {} }) {
    let changed = false;
    const now = Date.now();
    this.tx(() => {
      // Bookmarks now known by another id take it (unless that one is here too: then this one goes, below).
      const has = this.db.prepare('SELECT 1 FROM bookmarks WHERE guid = ?');
      const rename = this.db.prepare('UPDATE bookmarks SET guid = ? WHERE guid = ? AND role IS NULL');
      const resolve = (g) => { const seen = new Set(); while (aliases[g] && !seen.has(g)) { seen.add(g); g = aliases[g][0]; } return g; };
      for (const g of Object.keys(aliases)) { const to = resolve(g); if (to !== g && has.get(g) && !has.get(to)) rename.run(to, g); }
      const rows = this.db.prepare('SELECT * FROM bookmarks').all();
      const byGuid = new Map(rows.map((r) => [r.guid, r]));
      const ins = this.db.prepare('INSERT INTO bookmarks (parent_id, position, type, title, url, date_added, date_modified, favicon, guid, sort_key, changed, placed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const setContent = this.db.prepare('UPDATE bookmarks SET title = ?, url = ?, date_modified = ? WHERE id = ?');
      const setParent = this.db.prepare('UPDATE bookmarks SET parent_id = ?, position = ? WHERE id = ?');
      const setMeta = this.db.prepare('UPDATE bookmarks SET sort_key = ?, changed = ?, placed = ? WHERE id = ?');
      const setIcon = this.db.prepare('UPDATE bookmarks SET favicon = ? WHERE id = ?');
      const setPos = this.db.prepare('UPDATE bookmarks SET position = ? WHERE id = ?');
      const live = new Set(['root']);
      const kids = new Map();
      let temp = 1e6;
      for (const n of nodes) {
        const parent = byGuid.get(n.parent);
        live.add(n.guid);
        if (!parent || parent.type !== 'folder') continue;   // (never happens: parents come first) left as it is
        if (!kids.has(parent.id)) kids.set(parent.id, []);
        let r = byGuid.get(n.guid);
        const key = String(n.key || ''), ch = Number(n.changed) || 0, pl = Number(n.placed) || 0;
        if (!r) {
          const type = ['bookmark', 'folder', 'separator'].includes(n.type) ? n.type : 'bookmark';
          const id = Number(ins.run(parent.id, temp, type, String(n.title || ''), type === 'bookmark' ? String(n.url || '') : null, Number(n.added) || now, now, String(n.icon || ''), n.guid, key, ch, pl).lastInsertRowid);
          r = { id, guid: n.guid, parent_id: parent.id, position: temp++, type, title: n.title, url: n.url, role: null, favicon: n.icon || '', sort_key: key, changed: ch, placed: pl };
          byGuid.set(n.guid, r);
          changed = true;
        } else {
          if (!r.role) {
            const url = r.type === 'bookmark' ? String(n.url || '') : null;
            if (r.title !== String(n.title || '') || (r.type === 'bookmark' && r.url !== url)) { setContent.run(String(n.title || ''), url, now, r.id); r.title = n.title; r.url = url; changed = true; }
            if (r.parent_id !== parent.id) { setParent.run(parent.id, temp, r.id); r.parent_id = parent.id; r.position = temp++; changed = true; }
            if (!r.favicon && n.icon) setIcon.run(String(n.icon), r.id);
          }
          if (r.sort_key !== key || r.changed !== ch || r.placed !== pl) setMeta.run(key, ch, pl, r.id);
        }
        kids.get(parent.id).push([n.index, r]);
      }
      // What isn't there any more (anything in it that stays has moved out already).
      const del = this.db.prepare('DELETE FROM bookmarks WHERE id = ?');
      for (const r of rows) if (!r.role && !live.has(r.guid) && this.q.bm.get(r.id)) { del.run(r.id); changed = true; }
      for (const list of kids.values()) {
        list.sort((a, b) => a[0] - b[0]);
        list.forEach(([, r], i) => { if (r.position !== i) { setPos.run(i, r.id); r.position = i; changed = true; } });
      }
      const tomb = this.db.prepare('INSERT INTO bookmark_tombstones (guid, deleted) VALUES (?, ?) ON CONFLICT(guid) DO UPDATE SET deleted = MAX(deleted, excluded.deleted)');
      for (const [g, t] of Object.entries(dead)) if (!live.has(g)) tomb.run(g, Number(t) || 0);
      const alias = this.db.prepare('INSERT INTO bookmark_aliases (guid, target, added) VALUES (?, ?, ?) ON CONFLICT(guid) DO UPDATE SET target = excluded.target, added = MAX(added, excluded.added)');
      for (const [g, [to, at]] of Object.entries(aliases)) alias.run(g, String(to), Number(at) || now);
    });
    if (changed) this.emit('bookmarks-changed', { type: 'synced' });
    return changed;
  }

  // Tombstones older than this go (a computer that was away longer may bring a deleted bookmark back).
  pruneTombstones(before) {
    this.db.prepare('DELETE FROM bookmark_tombstones WHERE deleted < ?').run(before);
    this.db.prepare('DELETE FROM bookmark_aliases WHERE added < ?').run(before);
  }

  // --------------------------------------------------------------- downloads
  addDownload(d) {
    const r = this.q.dlInsert.run(d.url, d.filename, d.path || '', d.mime || '', d.total || 0, d.received || 0, d.state || 'progressing', d.started || Date.now(), d.referrer || '');
    return Number(r.lastInsertRowid);
  }
  updateDownload(id, d) { this.q.dlUpdate.run(d.filename, d.path || '', d.total || 0, d.received || 0, d.state, d.ended || 0, id); }
  downloads(limit = 500) { return this.q.dlAll.all(limit); }
  removeDownload(id) { this.q.dlDelete.run(id); }
  clearDownloads() { this.db.exec("DELETE FROM downloads WHERE state != 'progressing'"); }

  // ----------------------------------------------------------- site settings
  siteSettings(host) {
    const out = {};
    for (const r of this.q.ssGet.all(host)) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
    return out;
  }
  allSiteSettings() {
    const out = {};
    for (const r of this.q.ssAll.all()) { (out[r.host] || (out[r.host] = {}))[r.key] = JSON.parse(r.value); }
    return out;
  }
  setSiteSetting(host, key, value) {
    if (value === undefined || value === null) this.q.ssDel.run(host, key);
    else this.q.ssSet.run(host, key, JSON.stringify(value));
    this.emit('site-settings-changed', { host, key, value });
  }
  clearSiteSettings(host) { this.db.prepare('DELETE FROM site_settings WHERE host = ?').run(host); this.emit('site-settings-changed', { host }); }

  // -------------------------------------------------------------- key/value
  kvGet(key, fallback = null) { const r = this.q.kvGet.get(key); if (!r) return fallback; try { return JSON.parse(r.value); } catch { return fallback; } }
  kvSet(key, value) { if (value === undefined) this.q.kvDel.run(key); else this.q.kvSet.run(key, JSON.stringify(value)); }

  // -------------------------------------------------------------- site icons
  siteIcon(host) { return this.db.prepare('SELECT host, data, mime, width, source, updated FROM site_icons WHERE host = ?').get(host) || null; }
  setSiteIcon(host, icon) {
    this.db.prepare('INSERT INTO site_icons (host, data, mime, width, source, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(host) DO UPDATE SET data = excluded.data, mime = excluded.mime, width = excluded.width, source = excluded.source, updated = excluded.updated')
      .run(host, icon && icon.data ? icon.data : null, (icon && icon.mime) || '', (icon && icon.width) || 0, (icon && icon.source) || '', Date.now());
  }
  clearSiteIcons() { this.db.exec('DELETE FROM site_icons'); }

  // ------------------------------------------------------------ closed tabs
  pushClosedTab(data) { this.q.closedPush.run(Date.now(), JSON.stringify(data)); this.q.closedTrim.run(); }
  popClosedTab() { const r = this.q.closedPop.get(); if (!r) return null; this.q.closedDel.run(r.id); return JSON.parse(r.data); }
  closedTabs(limit = 25) { return this.q.closedList.all(limit).map((r) => Object.assign(JSON.parse(r.data), { closedId: r.id, closed: r.closed })); }
  removeClosedTab(id) { const r = this.db.prepare('SELECT data FROM closed_tabs WHERE id = ?').get(id); this.q.closedDel.run(id); return r ? JSON.parse(r.data) : null; }

  close() { try { this.db.close(); } catch { /* already closed */ } }
}

let instance = null;
function open(dir) {
  instance = new Database(path.join(dir, 'bifrost.sqlite'));
  return instance;
}
function get() { return instance; }

module.exports = { Database, open, get, ROOTS: { ROOT, BAR, OTHER, MOBILE } };
