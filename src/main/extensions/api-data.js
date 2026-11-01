'use strict';
// chrome.bookmarks, chrome.history, chrome.topSites, chrome.search and chrome.downloads, backed by
// Bifrost's own bookmarks, history and downloads.
const { app, shell } = require('electron');
const fs = require('node:fs');
const ctx = require('../context');
const downloads = require('../downloads');

// chrome.bookmarks ids are strings counting from "0" (root), "1" (bar), "2" (other), "3" (mobile); ours
// count from 1, so the mapping is a fixed offset.
const toChromeId = (id) => String(Number(id) - 1);
function toDbId(cid) {
  const s = String(cid);
  if (!/^\d+$/.test(s)) throw new Error(`Can't find bookmark for id.`);
  return Number(s) + 1;
}
const FOLDER_TYPE = { bar: 'bookmarks-bar', other: 'other', mobile: 'mobile' };

function install({ handle, router }) {
  const db = ctx.db;

  // ------------------------------------------------------------ bookmarks
  // A db node (optionally with children) as a chrome BookmarkTreeNode.
  function node(n, { deep = false, index } = {}) {
    const out = { id: toChromeId(n.id), title: n.title || '', dateAdded: n.dateAdded || 0, syncing: false };
    if (n.parentId != null) {
      out.parentId = toChromeId(n.parentId);
      out.index = index != null ? index : db.visibleIndex(n.parentId, n.index);
    }
    if (n.type === 'bookmark') {
      out.url = n.url;
      if (n.dateLastUsed) out.dateLastUsed = n.dateLastUsed;
    } else {
      out.dateGroupModified = n.dateModified || 0;
      if (n.role && FOLDER_TYPE[n.role]) out.folderType = FOLDER_TYPE[n.role];
      if (deep) {
        let i = 0;
        out.children = (n.children || db.children(n.id)).filter((c) => c.type !== 'separator').map((c) => node(c, { deep: true, index: i++ }));
      }
    }
    return out;
  }
  const mustGet = (cid) => {
    const n = db.bookmark(toDbId(cid));
    if (!n || n.type === 'separator') throw new Error(`Can't find bookmark for id.`);
    return n;
  };
  // A chrome index (separators not counted) to a position in our folder (separators counted).
  function positionFor(parentId, index) {
    if (index == null) return undefined;
    const kids = db.children(parentId);
    let seen = 0;
    for (const k of kids) {
      if (k.type === 'separator') continue;
      if (seen === index) return k.index;
      seen++;
    }
    return kids.length;
  }
  const checkUrl = (url) => {
    if (url == null) return;
    try { new URL(url); } catch { throw new Error('Invalid URL.'); }
  };

  handle('bookmarks.get', (ev, ids) => [].concat(ids).map((id) => node(mustGet(id))), { permission: 'bookmarks' });
  handle('bookmarks.getChildren', (ev, id) => {
    const n = mustGet(id);
    let i = 0;
    return db.children(n.id).filter((c) => c.type !== 'separator').map((c) => node(c, { index: i++ }));
  }, { permission: 'bookmarks' });
  handle('bookmarks.getRecent', (ev, count) => {
    const n = Math.max(1, Number(count) || 1);
    return db.flatBookmarks().sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0)).slice(0, n).map((b) => node(db.bookmark(b.id)));
  }, { permission: 'bookmarks' });
  handle('bookmarks.getTree', () => [node(db.bookmarkTree(), { deep: true })], { permission: 'bookmarks' });
  handle('bookmarks.getSubTree', (ev, id) => [node(db.subtree(mustGet(id).id), { deep: true })], { permission: 'bookmarks' });
  handle('bookmarks.search', (ev, query) => {
    const q = typeof query === 'string' ? { query } : (query || {});
    const words = String(q.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (c.type === 'separator') continue;
        const title = (c.title || '').toLowerCase(), url = (c.url || '').toLowerCase();
        let ok = !c.role;
        if (ok && words.length) ok = words.every((w) => title.includes(w) || url.includes(w));
        if (ok && q.url != null) ok = c.url === q.url;
        if (ok && q.title != null) ok = c.title === q.title;
        if (ok && (words.length || q.url != null || q.title != null)) out.push(node(c));
        if (c.children) walk(c);
      }
    };
    walk(db.bookmarkTree());
    return out;
  }, { permission: 'bookmarks' });
  handle('bookmarks.create', (ev, details = {}) => {
    checkUrl(details.url);
    const parentId = details.parentId != null ? toDbId(details.parentId) : 3;
    const parent = db.bookmark(parentId);
    if (!parent || parent.type !== 'folder') throw new Error(`Can't find parent bookmark for id.`);
    const created = db.createBookmark({ parentId, index: positionFor(parentId, details.index), type: details.url ? 'bookmark' : 'folder', title: String(details.title || ''), url: details.url || undefined });
    return node(created);
  }, { permission: 'bookmarks' });
  handle('bookmarks.move', (ev, id, dest = {}) => {
    const n = mustGet(id);
    const parentId = dest.parentId != null ? toDbId(dest.parentId) : n.parentId;
    return node(db.moveBookmark(n.id, { parentId, index: positionFor(parentId, dest.index) }));
  }, { permission: 'bookmarks' });
  handle('bookmarks.update', (ev, id, changes = {}) => {
    const n = mustGet(id);
    checkUrl(changes.url);
    return node(db.updateBookmark(n.id, { title: changes.title, url: changes.url }));
  }, { permission: 'bookmarks' });
  handle('bookmarks.remove', (ev, id) => {
    const n = mustGet(id);
    if (n.type === 'folder' && db.children(n.id).length) throw new Error(`Can't remove non-empty folder (use recursive to remove a folder).`);
    db.removeBookmark(n.id);
  }, { permission: 'bookmarks' });
  handle('bookmarks.removeTree', (ev, id) => { db.removeBookmark(mustGet(id).id); }, { permission: 'bookmarks' });

  db.on('bookmarks-changed', (e) => {
    if (!e) return;
    try {
      const cid = e.id != null ? toChromeId(e.id) : null;
      if (e.type === 'created') {
        const n = db.bookmark(e.id);
        if (n && n.type !== 'separator') router.broadcastEvent('bookmarks.onCreated', cid, node(n));
      } else if (e.type === 'changed') {
        const n = db.bookmark(e.id);
        if (n) router.broadcastEvent('bookmarks.onChanged', cid, n.type === 'bookmark' ? { title: n.title, url: n.url } : { title: n.title });
      } else if (e.type === 'moved') {
        const n = db.bookmark(e.id);
        if (n) router.broadcastEvent('bookmarks.onMoved', cid, { parentId: toChromeId(n.parentId), index: db.visibleIndex(n.parentId, n.index), oldParentId: toChromeId(e.oldParentId), oldIndex: e.oldIndex });
      } else if (e.type === 'removed') {
        if (e.node && e.node.type !== 'separator') router.broadcastEvent('bookmarks.onRemoved', cid, { parentId: toChromeId(e.parentId), index: e.index, node: node(e.node, { deep: e.node.type === 'folder', index: e.index }) });
      } else if (e.type === 'imported' || e.type === 'synced') {
        router.broadcastEvent('bookmarks.onImportBegan');
        router.broadcastEvent('bookmarks.onImportEnded');
      }
    } catch (err) { console.error('[extensions] bookmarks event', err); }
  });

  // -------------------------------------------------------------- history
  const historyItem = (r) => ({ id: String(r.id), url: r.url, title: r.title || '', lastVisitTime: r.lastVisitTime, visitCount: r.visitCount, typedCount: r.typedCount || 0 });
  handle('history.search', (ev, q = {}) => {
    const start = q.startTime != null ? Number(new Date(q.startTime)) : Date.now() - 24 * 3600e3;
    const end = q.endTime != null ? Number(new Date(q.endTime)) : Date.now() + 1;
    return db.historySearch({ text: q.text || '', start, end, limit: q.maxResults != null ? q.maxResults : 100 }).map(historyItem);
  }, { permission: 'history' });
  handle('history.getVisits', (ev, d = {}) => db.urlVisits(String(d.url || '')).map((v) => ({
    id: String(v.urlId), visitId: String(v.id), visitTime: v.time, referringVisitId: '0', transition: v.transition === 'imported' ? 'link' : v.transition, isLocal: true,
  })), { permission: 'history' });
  handle('history.addUrl', (ev, d = {}) => {
    const url = String(d.url || '');
    if (!/^(https?|file|ftp):/i.test(url)) throw new Error('Invalid URL.');
    db.addVisit({ url, title: d.title || '', time: d.visitTime != null ? Number(d.visitTime) : Date.now(), transition: d.transition || 'link' });
  }, { permission: 'history' });
  handle('history.deleteUrl', (ev, d = {}) => { db.deleteUrl(String(d.url || '')); }, { permission: 'history' });
  handle('history.deleteRange', (ev, r = {}) => { db.deleteHistoryRange(Number(r.startTime) || 0, Number(r.endTime) || 0); }, { permission: 'history' });
  handle('history.deleteAll', () => { db.clearHistory(); }, { permission: 'history' });

  db.on('visit', (e) => { if (e && e.id != null) router.broadcastEvent('history.onVisited', historyItem(e)); });
  db.on('history-changed', (e) => {
    if (!e || (!e.all && !(e.urls && e.urls.length))) return;
    router.broadcastEvent('history.onVisitRemoved', { allHistory: !!e.all, urls: e.all ? [] : e.urls });
  });

  // ------------------------------------------------------- topSites, search
  handle('topSites.get', () => db.topSites(10).map((r) => ({ url: r.url, title: r.title || r.url })), { permission: 'topSites' });
  handle('search.query', async (ev, info = {}) => {
    const text = String(info.text || '').trim();
    if (!text) throw new Error('Empty text parameter.');
    const engine = ctx.search.defaultEngine();
    const url = engine.url.replace(/%s|\{searchTerms\}/g, encodeURIComponent(text));
    const ext = ctx.extensions;
    if (info.disposition === 'NEW_WINDOW') { ctx.windows.create({ urls: [url] }); return; }
    if (info.disposition === 'NEW_TAB') { await ext.createTab({ url, active: true }); return; }
    const tab = info.tabId != null ? ext.tabWebContents(info.tabId) : ext.activeTabWebContents();
    if (tab) tab.loadURL(url); else await ext.createTab({ url, active: true });
  }, { permission: 'search' });

  // ------------------------------------------------------------ downloads
  const STATE = { progressing: 'in_progress', completed: 'complete', cancelled: 'interrupted', interrupted: 'interrupted' };
  function dlItem(r) {
    const item = downloads.liveItem(r.id);
    const exists = r.path ? fs.existsSync(r.path) : false;
    return {
      id: r.id, url: r.url, finalUrl: r.url, referrer: r.referrer || '', filename: r.path || '', incognito: false, danger: 'safe', mime: r.mime || '',
      startTime: new Date(r.started).toISOString(), endTime: r.ended ? new Date(r.ended).toISOString() : undefined,
      state: STATE[r.state] || 'interrupted', paused: !!r.paused, canResume: !!(item && item.canResume()),
      error: r.state === 'cancelled' ? 'USER_CANCELED' : r.state === 'interrupted' ? 'NETWORK_FAILED' : undefined,
      bytesReceived: r.received || 0, totalBytes: r.total || -1, fileSize: r.state === 'completed' ? r.total || 0 : -1, exists,
      byExtensionId: r.byExtensionId || undefined,
    };
  }
  const allDownloads = () => downloads.list().filter((r) => !r.private);
  handle('downloads.download', async (ev, opts = {}) => {
    const url = String(opts.url || '');
    if (!/^(https?|ftp|data|blob):/i.test(url)) throw new Error('Invalid URL.');
    const waiting = downloads.expect(url, { filename: opts.filename, saveAs: opts.saveAs, conflictAction: opts.conflictAction, extensionId: ev.extension && ev.extension.id });
    const headers = {};
    for (const h of opts.headers || []) if (h && h.name) headers[h.name] = String(h.value || '');
    ctx.mainSession.downloadURL(url, Object.keys(headers).length ? { headers } : undefined);
    return waiting;
  }, { permission: 'downloads' });
  handle('downloads.search', (ev, q = {}) => {
    let list = allDownloads().map(dlItem);
    if (q.id != null) list = list.filter((d) => d.id === q.id);
    if (q.url) list = list.filter((d) => d.url === q.url);
    if (q.urlRegex) { const re = new RegExp(q.urlRegex); list = list.filter((d) => re.test(d.url)); }
    if (q.filename) list = list.filter((d) => d.filename === q.filename);
    if (q.filenameRegex) { const re = new RegExp(q.filenameRegex); list = list.filter((d) => re.test(d.filename)); }
    if (q.state) list = list.filter((d) => d.state === q.state);
    if (q.mime) list = list.filter((d) => d.mime === q.mime);
    if (q.exists != null) list = list.filter((d) => d.exists === !!q.exists);
    if (q.paused != null) list = list.filter((d) => d.paused === !!q.paused);
    if (q.query) {
      const terms = [].concat(q.query).map((t) => String(t).toLowerCase());
      list = list.filter((d) => terms.every((t) => (t.startsWith('-') ? !(d.url + d.filename).toLowerCase().includes(t.slice(1)) : (d.url + d.filename).toLowerCase().includes(t))));
    }
    if (q.startedAfter) list = list.filter((d) => d.startTime > new Date(q.startedAfter).toISOString());
    if (q.startedBefore) list = list.filter((d) => d.startTime < new Date(q.startedBefore).toISOString());
    const order = [].concat(q.orderBy || ['-startTime']);
    list.sort((a, b) => {
      for (const o of order) {
        const desc = o.startsWith('-'), k = desc ? o.slice(1) : o;
        if (a[k] === b[k]) continue;
        return (a[k] > b[k] ? 1 : -1) * (desc ? -1 : 1);
      }
      return 0;
    });
    return q.limit === 0 ? list : list.slice(0, q.limit || 1000);
  }, { permission: 'downloads' });
  const act = (what) => async (ev, id) => { await downloads.action(Number(id), what); };
  handle('downloads.pause', act('pause'), { permission: 'downloads' });
  handle('downloads.resume', act('resume'), { permission: 'downloads' });
  handle('downloads.cancel', act('cancel'), { permission: 'downloads' });
  // Like Chrome: opening a file needs "downloads.open" as well as "downloads" (and runnable files ask first).
  handle('downloads.open', async (ev, id) => {
    if (!((ev.extension && ev.extension.manifest.permissions) || []).includes('downloads')) throw new Error('The "downloads" permission is required.');
    await downloads.action(Number(id), 'open');
  }, { permission: 'downloads.open' });
  handle('downloads.show', act('show'), { permission: 'downloads' });
  handle('downloads.removeFile', act('deleteFile'), { permission: 'downloads' });
  handle('downloads.showDefaultFolder', () => { shell.openPath(downloads.folder()); }, { permission: 'downloads' });
  handle('downloads.erase', (ev, q = {}) => {
    const ids = allDownloads().filter((r) => r.state !== 'progressing' && (q.id == null || r.id === q.id) && (!q.url || r.url === q.url)).map((r) => r.id);
    for (const id of ids) downloads.action(id, 'remove');
    return ids;
  }, { permission: 'downloads' });
  handle('downloads.acceptDanger', () => undefined, { permission: 'downloads' });
  handle('downloads.setUiOptions', () => undefined, { permission: 'downloads' });
  handle('downloads.setShelfEnabled', () => undefined, { permission: 'downloads' });
  handle('downloads.getFileIcon', async (ev, id, opts = {}) => {
    const r = allDownloads().find((x) => x.id === Number(id));
    if (!r || !r.path) throw new Error('Download file not found.');
    const img = await app.getFileIcon(r.path, { size: opts.size === 16 ? 'small' : 'normal' });
    return img.toDataURL();
  }, { permission: 'downloads' });

  const last = new Map();
  downloads.events.on('created', (rec) => { last.set(rec.id, dlItem(rec)); router.broadcastEvent('downloads.onCreated', dlItem(rec)); });
  const changed = (rec) => {
    const now = dlItem(rec), prev = last.get(rec.id) || {};
    const delta = { id: rec.id };
    for (const k of ['url', 'finalUrl', 'filename', 'danger', 'mime', 'startTime', 'endTime', 'state', 'canResume', 'paused', 'error', 'totalBytes', 'fileSize', 'exists']) {
      if (now[k] !== prev[k] && now[k] !== undefined) delta[k] = { previous: prev[k], current: now[k] };
    }
    last.set(rec.id, now);
    if (Object.keys(delta).length > 1) router.broadcastEvent('downloads.onChanged', delta);
    if (now.state !== 'in_progress') last.delete(rec.id);
  };
  downloads.events.on('updated', changed);
  downloads.events.on('done', changed);
  downloads.events.on('erased', (id) => router.broadcastEvent('downloads.onErased', id));
}

module.exports = { install, toChromeId, toDbId };
