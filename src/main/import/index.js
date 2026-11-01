'use strict';
// Importing bookmarks and history from Firefox and Chromium-based browsers (Chrome, Vivaldi, Edge, Brave),
// from a profile folder you point at (portable browsers), or from a bookmarks file.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ctx = require('../context');
const html = require('./bookmarks-html');

const HOME = os.homedir();
const OTHER = 3, BAR = 2;
const HISTORY_LIMIT = 50000;

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

// --------------------------------------------------------------- detection
function chromiumRoots() {
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const cfg = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
  const mac = path.join(HOME, 'Library', 'Application Support');
  const list = {
    win32: [['Chrome', path.join(local, 'Google', 'Chrome', 'User Data')], ['Vivaldi', path.join(local, 'Vivaldi', 'User Data')], ['Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')], ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')], ['Chromium', path.join(local, 'Chromium', 'User Data')], ['Opera', path.join(process.env.APPDATA || '', 'Opera Software', 'Opera Stable')]],
    linux: [['Chrome', path.join(cfg, 'google-chrome')], ['Vivaldi', path.join(cfg, 'vivaldi')], ['Edge', path.join(cfg, 'microsoft-edge')], ['Brave', path.join(cfg, 'BraveSoftware', 'Brave-Browser')], ['Chromium', path.join(cfg, 'chromium')], ['Chromium (snap)', path.join(HOME, 'snap', 'chromium', 'common', 'chromium')]],
    darwin: [['Chrome', path.join(mac, 'Google', 'Chrome')], ['Vivaldi', path.join(mac, 'Vivaldi')], ['Edge', path.join(mac, 'Microsoft Edge')], ['Brave', path.join(mac, 'BraveSoftware', 'Brave-Browser')], ['Chromium', path.join(mac, 'Chromium')]],
  };
  return list[process.platform] || [];
}

function firefoxRoots() {
  const roaming = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const mac = path.join(HOME, 'Library', 'Application Support');
  const list = {
    win32: [
      path.join(roaming, 'Mozilla', 'Firefox'),
      // Firefox from the Microsoft Store keeps its profiles in its own package folder.
      path.join(local, 'Packages', 'Mozilla.Firefox_n80bbvh6b1yt2', 'LocalCache', 'Roaming', 'Mozilla', 'Firefox'),
      path.join(roaming, 'LibreWolf'), path.join(roaming, 'zen'), path.join(roaming, 'Waterfox'), path.join(roaming, 'Floorp'),
    ],
    linux: [
      path.join(HOME, '.mozilla', 'firefox'), path.join(HOME, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), path.join(HOME, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
      path.join(HOME, '.librewolf'), path.join(HOME, '.var', 'app', 'io.gitlab.librewolf-community', '.librewolf'),
      path.join(HOME, '.zen'), path.join(HOME, '.var', 'app', 'app.zen_browser.zen', '.zen'),
      path.join(HOME, '.waterfox'), path.join(HOME, '.floorp'), path.join(HOME, '.var', 'app', 'one.ablaze.floorp', '.floorp'),
    ],
    darwin: [path.join(mac, 'Firefox'), path.join(mac, 'zen'), path.join(mac, 'LibreWolf'), path.join(mac, 'Waterfox'), path.join(mac, 'Floorp')],
  };
  return list[process.platform] || [];
}
const firefoxBrand = (root) => (/librewolf/i.test(root) ? 'LibreWolf' : /[\\/]\.?zen([\\/]|$)/i.test(root) ? 'Zen' : /waterfox/i.test(root) ? 'Waterfox' : /floorp/i.test(root) ? 'Floorp' : 'Firefox');

// The profiles Firefox actually starts with ([Install…] Default=), so they can be listed first.
function profilesInUse(root) {
  const out = new Set();
  try {
    const text = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8');
    let inInstall = false;
    for (const line of text.split(/\r?\n/)) {
      const sec = /^\[(.+)\]$/.exec(line.trim());
      if (sec) { inInstall = sec[1].startsWith('Install'); continue; }
      const kv = /^Default=(.+)$/.exec(line.trim());
      if (inInstall && kv) out.add(path.resolve(root, kv[1]));
    }
  } catch { /* none */ }
  return out;
}

function readProfilesIni(root) {
  const ini = path.join(root, 'profiles.ini');
  if (!exists(ini)) return [];
  const out = [];
  let cur = null;
  for (const line of fs.readFileSync(ini, 'utf8').split(/\r?\n/)) {
    const sec = /^\[(.+)\]$/.exec(line.trim());
    if (sec) { cur = sec[1].startsWith('Profile') ? {} : null; if (cur) out.push(cur); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line.trim());
    if (cur && kv) cur[kv[1]] = kv[2];
  }
  return out.map((p) => ({ name: p.Name || 'Profile', dir: p.IsRelative === '1' ? path.join(root, p.Path || '') : (p.Path || '') })).filter((p) => exists(path.join(p.dir, 'places.sqlite')));
}

function chromiumProfiles(root) {
  if (!exists(root)) return [];
  let names = {};
  try { names = (JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')).profile || {}).info_cache || {}; } catch { /* no Local State */ }
  const out = [];
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    if (exists(path.join(dir, 'Bookmarks')) || exists(path.join(dir, 'History'))) out.push({ name: (names[d] && names[d].name) || d, dir });
  }
  // Opera keeps its profile files at the root.
  if (exists(path.join(root, 'Bookmarks')) && !out.some((p) => p.dir === root)) out.push({ name: 'Default', dir: root });
  return out;
}

// A browser folder that can't be read (locked, or owned by another user) is skipped, not fatal.
function safely(fn, root) {
  try { return fn(root); } catch (e) { console.warn('[import] skipped ' + root + ': ' + (e.code || e.message)); return []; }
}

let lastDetected = [];
function detect() {
  const out = [];
  const seen = new Set();
  for (const root of firefoxRoots()) {
    const brand = firefoxBrand(root);
    const used = safely((r) => [...profilesInUse(r)], root);
    const profiles = safely(readProfilesIni, root).sort((a, b) => used.includes(path.resolve(b.dir)) - used.includes(path.resolve(a.dir)));
    for (const p of profiles) {
      if (seen.has(path.resolve(p.dir))) continue;
      seen.add(path.resolve(p.dir));
      out.push({ id: 'ff:' + p.dir, kind: 'firefox', brand, name: `${brand} · ${p.name}`, path: p.dir, detail: p.dir, inUse: used.includes(path.resolve(p.dir)) });
    }
  }
  for (const [brand, root] of chromiumRoots()) {
    for (const p of safely(chromiumProfiles, root)) out.push({ id: 'cr:' + p.dir, kind: 'chromium', brand, name: `${brand} · ${p.name}`, path: p.dir, detail: p.dir });
  }
  lastDetected = out;
  return out;
}

// A folder you point at: a Firefox or Chromium profile (portable browsers keep theirs next to the app).
function sourceFromFolder(dir) {
  const candidates = [dir, path.join(dir, 'Data', 'profile'), path.join(dir, 'profile'), path.join(dir, 'Default'), path.join(dir, 'Data', 'profile', 'Default'), path.join(dir, 'User Data', 'Default')];
  for (const d of candidates) {
    if (exists(path.join(d, 'places.sqlite'))) return { id: 'ff:' + d, kind: 'firefox', name: 'Firefox profile', path: d };
    if (exists(path.join(d, 'Bookmarks')) || exists(path.join(d, 'History'))) return { id: 'cr:' + d, kind: 'chromium', brand: 'Chromium', name: 'Browser profile', path: d };
  }
  return null;
}

// ---------------------------------------------------------------- reading
// Browsers keep their databases open; read from a private copy.
function openCopy(file) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'wp-import-'));
  const dest = path.join(tmp, path.basename(file));
  fs.copyFileSync(file, dest);
  for (const ext of ['-wal', '-shm']) if (exists(file + ext)) { try { fs.copyFileSync(file + ext, dest + ext); } catch { /* optional */ } }
  const db = new DatabaseSync(dest);
  return { db, done: () => { try { db.close(); } catch { /* closed */ } fs.rmSync(tmp, { recursive: true, force: true }); } };
}

function firefoxBookmarks(dir) {
  const { db, done } = openCopy(path.join(dir, 'places.sqlite'));
  try {
    const rows = db.prepare(`SELECT b.id, b.parent, b.type, b.position, b.title, b.dateAdded, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all();
    const byId = new Map(rows.map((r) => [r.id, Object.assign(r, { kids: [] })]));
    for (const r of rows) { const p = byId.get(r.parent); if (p && p !== r) p.kids.push(r); }
    const conv = (r) => {
      if (r.type === 3) return { separator: true };
      if (r.type === 2) return { title: r.title || '', children: r.kids.map(conv).filter(Boolean), dateAdded: r.dateAdded ? Math.floor(r.dateAdded / 1000) : undefined };
      if (r.type === 1 && r.url && !/^place:/.test(r.url)) return { title: r.title || '', url: r.url, dateAdded: r.dateAdded ? Math.floor(r.dateAdded / 1000) : undefined };
      return null;
    };
    const byGuid = new Map(rows.map((r) => [r.guid, r]));
    const take = (guid) => (byGuid.get(guid) ? byGuid.get(guid).kids.map(conv).filter(Boolean) : []);
    return { toolbar: take('toolbar_____'), menu: take('menu________'), other: take('unfiled_____'), mobile: take('mobile______') };
  } finally { done(); }
}

// Times are microseconds in both browsers; they're converted to milliseconds in SQL because Chromium's
// (counted from 1601) are too big for a JavaScript number.
function firefoxHistory(dir) {
  const { db, done } = openCopy(path.join(dir, 'places.sqlite'));
  try {
    return db.prepare(`SELECT url, title, visit_count AS visitCount, typed AS typedCount, last_visit_date / 1000 AS t FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 AND url LIKE 'http%' ORDER BY last_visit_date DESC LIMIT ?`).all(HISTORY_LIMIT)
      .map((r) => ({ url: r.url, title: r.title || '', visitCount: r.visitCount || 1, typedCount: r.typedCount || 0, lastVisitTime: Number(r.t) || undefined }));
  } finally { done(); }
}

const CHROME_EPOCH_OFFSET = 11644473600000; // ms between 1601-01-01 and 1970-01-01
// Chromium bookmark times are decimal strings of microseconds since 1601.
const chromeTime = (v) => {
  const s = String(v || '').trim();
  if (!/^\d{4,}$/.test(s)) return undefined;
  const ms = Number(s.slice(0, -3)) - CHROME_EPOCH_OFFSET;
  return ms > 0 ? ms : undefined;
};

function chromiumBookmarks(dir) {
  const file = path.join(dir, 'Bookmarks');
  if (!exists(file)) return { toolbar: [], other: [], mobile: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const conv = (n) => {
    const meta = n.meta_info || {};
    if (meta.Trash === 'true' || /^vivaldi:\/\/|^chrome:\/\//i.test(n.url || '')) return null;
    if (n.type === 'folder') return { title: n.name || '', children: (n.children || []).map(conv).filter(Boolean), dateAdded: chromeTime(n.date_added) };
    if (n.type === 'url' && n.url) return { title: n.name || '', url: n.url, dateAdded: chromeTime(n.date_added) };
    return null;
  };
  const r = data.roots || {};
  return {
    toolbar: ((r.bookmark_bar || {}).children || []).map(conv).filter(Boolean),
    other: ((r.other || {}).children || []).map(conv).filter(Boolean),
    mobile: ((r.synced || {}).children || []).map(conv).filter(Boolean),
  };
}

function chromiumHistory(dir) {
  const file = path.join(dir, 'History');
  if (!exists(file)) return [];
  const { db, done } = openCopy(file);
  try {
    return db.prepare(`SELECT url, title, visit_count AS visitCount, typed_count AS typedCount, last_visit_time / 1000 AS t FROM urls WHERE hidden = 0 AND url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ?`).all(HISTORY_LIMIT)
      .map((r) => ({ url: r.url, title: r.title || '', visitCount: r.visitCount || 1, typedCount: r.typedCount || 0, lastVisitTime: Number(r.t) ? Number(r.t) - CHROME_EPOCH_OFFSET : undefined }));
  } finally { done(); }
}

// ---------------------------------------------------------------- writing
// Toolbar bookmarks go to our bar when it's empty; everything else lands in a folder in Other bookmarks.
function importTree(label, parts) {
  const db = ctx.db;
  let count = 0;
  const barEmpty = db.children(BAR).length === 0;
  // With "Other bookmarks" removed (Settings → Appearance), imports land in the bookmarks bar instead.
  const home = ctx.settings.get('appearance.bookmarksBar.showOtherBookmarks') === false ? BAR : OTHER;
  const folder = db.createBookmark({ parentId: home, title: label, type: 'folder' });
  if (parts.toolbar && parts.toolbar.length) {
    if (barEmpty) count += db.importBookmarks(BAR, parts.toolbar);
    else count += db.importBookmarks(folder.id, [{ title: 'Bookmarks bar', children: parts.toolbar }]);
  }
  if (parts.menu && parts.menu.length) count += db.importBookmarks(folder.id, [{ title: 'Bookmarks menu', children: parts.menu }]);
  if (parts.other && parts.other.length) count += db.importBookmarks(folder.id, parts.other);
  if (parts.mobile && parts.mobile.length) count += db.importBookmarks(folder.id, [{ title: 'Mobile bookmarks', children: parts.mobile }]);
  if (!db.children(folder.id).length) db.removeBookmark(folder.id);
  return count;
}

async function run(id, what = {}) {
  let src = (lastDetected.length ? lastDetected : detect()).find((s) => s.id === id);
  if (!src && /^(ff|cr):/.test(id)) src = sourceFromFolder(id.slice(3));
  if (!src) throw new Error('That browser profile wasn’t found');
  const out = { bookmarks: 0, history: 0 };
  const label = 'From ' + (src.brand || (src.kind === 'firefox' ? 'Firefox' : 'Chromium'));
  if (what.bookmarks !== false) {
    const parts = src.kind === 'firefox' ? firefoxBookmarks(src.path) : chromiumBookmarks(src.path);
    out.bookmarks = importTree(label, parts);
  }
  if (what.history !== false) {
    const entries = src.kind === 'firefox' ? firefoxHistory(src.path) : chromiumHistory(src.path);
    ctx.db.importHistory(entries);
    out.history = entries.length;
  }
  return out;
}

// A bookmarks file: Netscape HTML (any browser's export) or a Chromium "Bookmarks" JSON file.
async function importFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  let parts;
  if (/^\s*\{/.test(text)) {
    const data = JSON.parse(text);
    if (data.roots) {
      const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'wp-import-'));
      fs.writeFileSync(path.join(tmpDir, 'Bookmarks'), text);
      try { parts = chromiumBookmarks(tmpDir); } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
    } else if (data.children) {
      // Firefox's JSON backup.
      const conv = (n) => (n.type === 'text/x-moz-place-container' ? { title: n.title || '', children: (n.children || []).map(conv).filter(Boolean) }
        : n.type === 'text/x-moz-place' && n.uri && !/^place:/.test(n.uri) ? { title: n.title || '', url: n.uri } : n.type === 'text/x-moz-place-separator' ? { separator: true } : null);
      const kids = (data.children || []).map((c) => ({ guid: c.guid, items: (c.children || []).map(conv).filter(Boolean) }));
      const find = (g) => (kids.find((k) => k.guid === g) || { items: [] }).items;
      parts = { toolbar: find('toolbar_____'), menu: find('menu________'), other: find('unfiled_____'), mobile: find('mobile______') };
    } else throw new Error('That file isn’t a bookmarks backup');
  } else {
    const nodes = html.parse(text);
    // A toolbar folder marked in the file goes to the bar; the rest keeps its structure.
    const tb = nodes.find((n) => n.toolbar);
    parts = { toolbar: tb ? tb.children : [], other: nodes.filter((n) => n !== tb) };
  }
  return { bookmarks: importTree('Imported bookmarks', parts) };
}

module.exports = { detect, run, importFile, sourceFromFolder };
