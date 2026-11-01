'use strict';
// Reading what a Firefox add-on has saved, so its settings can come with it into Bifrost:
//   storage.local  IndexedDB "webExtensions-storage-local" in storage/default/moz-extension+++<uuid>^userContextId=4294967295
//                  (from older Firefox versions: browser-extension-data/<add-on id>/storage.js, plain JSON)
//   storage.sync   storage-sync-v2.sqlite, one JSON object per add-on
//   localStorage   storage/default/moz-extension+++<uuid>/ls/data.sqlite
//   IndexedDB      storage/default/moz-extension+++<uuid>/idb/*.sqlite (Stylus keeps its styles there, for one)
// <uuid> is the add-on's internal ID in this profile (prefs.js: extensions.webextensions.uuids).
//
// Firefox's IndexedDB is SQLite underneath: each record's key is in Firefox's sortable key encoding and its
// value is a SpiderMonkey structured clone compressed with snappy (big ones live in a file next to the
// database, snappy-framed). All of that is decoded here. Everything is read from private copies, so Firefox
// can stay open, and nothing is ever written to its profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// --------------------------------------------------------------------- snappy
function snappyRaw(src) {
  let pos = 0, len = 0, mul = 1;
  for (;;) {
    if (pos >= src.length || mul > 2 ** 28) throw new Error('snappy: bad length');
    const b = src[pos++];
    len += (b & 0x7f) * mul;
    if (!(b & 0x80)) break;
    mul *= 128;
  }
  if (len > 512 * 1024 * 1024) throw new Error('snappy: too large');
  const out = Buffer.allocUnsafe(len);
  let op = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const type = tag & 3;
    if (type === 0) {
      let n = tag >>> 2;
      if (n >= 60) {
        const bytes = n - 59;
        n = 0;
        for (let i = 0; i < bytes; i++) n += src[pos++] * 2 ** (8 * i);
      }
      n += 1;
      if (pos + n > src.length || op + n > len) throw new Error('snappy: bad literal');
      src.copy(out, op, pos, pos + n);
      pos += n; op += n;
    } else {
      let n, off;
      if (type === 1) { n = ((tag >>> 2) & 7) + 4; off = ((tag >>> 5) << 8) | src[pos++]; }
      else if (type === 2) { n = (tag >>> 2) + 1; off = src[pos] | (src[pos + 1] << 8); pos += 2; }
      else { n = (tag >>> 2) + 1; off = src.readUInt32LE(pos); pos += 4; }
      if (!off || off > op || op + n > len) throw new Error('snappy: bad copy');
      if (off >= n) { out.copyWithin(op, op - off, op - off + n); op += n; }
      else for (let i = 0; i < n; i++, op++) out[op] = out[op - off];   // overlapping: byte by byte
    }
  }
  if (op !== len) throw new Error('snappy: truncated');
  return out;
}

const SNAPPY_MAGIC = Buffer.from([0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);
function snappyFramed(src) {
  const parts = [];
  let pos = 0;
  while (pos + 4 <= src.length) {
    const type = src[pos];
    const n = src[pos + 1] | (src[pos + 2] << 8) | (src[pos + 3] << 16);
    pos += 4;
    if (pos + n > src.length) throw new Error('snappy: truncated frame');
    const chunk = src.subarray(pos, pos + n);
    pos += n;
    if (type === 0x00) parts.push(snappyRaw(chunk.subarray(4)));   // (after a checksum)
    else if (type === 0x01) parts.push(chunk.subarray(4));
    else if (type === 0xff || type >= 0x80) continue;              // stream identifier, padding, skippable
    else throw new Error('snappy: unknown chunk ' + type);
  }
  return Buffer.concat(parts);
}

// ------------------------------------------------------------- structured clone
// SpiderMonkey's format (js/src/vm/StructuredClone.cpp): 64-bit little-endian words, each a (tag, data) pair
// or a double; strings and byte arrays are padded to a whole word.
const T = {
  FLOAT_MAX: 0xFFF00000, HEADER: 0xFFF10000,
  NULL: 0xFFFF0000, UNDEFINED: 0xFFFF0001, BOOLEAN: 0xFFFF0002, INT32: 0xFFFF0003, STRING: 0xFFFF0004,
  DATE: 0xFFFF0005, REGEXP: 0xFFFF0006, ARRAY: 0xFFFF0007, OBJECT: 0xFFFF0008, ARRAY_BUFFER_V2: 0xFFFF0009,
  BOOLEAN_OBJECT: 0xFFFF000A, STRING_OBJECT: 0xFFFF000B, NUMBER_OBJECT: 0xFFFF000C, BACK_REFERENCE: 0xFFFF000D,
  TYPED_ARRAY_V2: 0xFFFF0010, MAP: 0xFFFF0011, SET: 0xFFFF0012, END_OF_KEYS: 0xFFFF0013,
  BIGINT: 0xFFFF001D, BIGINT_OBJECT: 0xFFFF001E, ARRAY_BUFFER: 0xFFFF001F, TYPED_ARRAY: 0xFFFF0020,
  TYPED_ARRAY_V1_MIN: 0xFFFF0100, TYPED_ARRAY_V1_MAX: 0xFFFF01FF,
};
// Scalar types of typed arrays, in SpiderMonkey's order.
const TYPED = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8ClampedArray, BigInt64Array, BigUint64Array];

class Unsupported extends Error {}

function readClone(buf) {
  let p = 0;
  const all = [];   // every object, in order, for back references
  const pair = () => {
    if (p + 8 > buf.length) throw new Error('structured clone: truncated');
    const data = buf.readUInt32LE(p), tag = buf.readUInt32LE(p + 4);
    p += 8;
    return [tag, data];
  };
  const u64 = () => { if (p + 8 > buf.length) throw new Error('structured clone: truncated'); const v = buf.readBigUInt64LE(p); p += 8; return v; };
  const dbl = () => { if (p + 8 > buf.length) throw new Error('structured clone: truncated'); const v = buf.readDoubleLE(p); p += 8; return v; };
  const pad = (n) => (n + 7) & ~7;
  const str = (data) => {
    const len = data & 0x7fffffff, latin1 = data >>> 31;
    const bytes = latin1 ? len : len * 2;
    if (p + bytes > buf.length) throw new Error('structured clone: truncated string');
    const s = latin1 ? buf.latin1Slice(p, p + len) : buf.toString('utf16le', p, p + bytes);
    p += pad(bytes);
    return s;
  };
  const bytes = (n) => {
    if (n > buf.length - p) throw new Error('structured clone: truncated bytes');
    const b = Buffer.from(buf.subarray(p, p + n));
    p += pad(n);
    return b;
  };
  const peekEnd = () => p + 8 <= buf.length && buf.readUInt32LE(p + 4) === T.END_OF_KEYS;
  const typed = (type, n, buffer, offset) => {
    const C = TYPED[type];
    if (!C) throw new Unsupported('typed array ' + type);
    const ab = new ArrayBuffer(buffer.length);   // (an aligned copy of its own)
    new Uint8Array(ab).set(buffer);
    try { return new C(ab, Number(offset), Number(n)); } catch { return Buffer.from(buffer); }
  };
  let depth = 0;
  function value() {
    const [tag, data] = pair();
    if (tag <= T.FLOAT_MAX) { p -= 8; return dbl(); }
    switch (tag) {
      case T.NULL: return null;
      case T.UNDEFINED: return undefined;
      case T.BOOLEAN: return !!data;
      case T.INT32: return data | 0;
      case T.STRING: return str(data);
      case T.BOOLEAN_OBJECT: { const v = !!data; all.push(v); return v; }
      case T.STRING_OBJECT: { const v = str(data); all.push(v); return v; }
      case T.NUMBER_OBJECT: { const v = dbl(); all.push(v); return v; }
      case T.BIGINT: case T.BIGINT_OBJECT: {
        const n = data & 0x7fffffff, neg = data >>> 31;
        let v = 0n;
        for (let i = 0; i < n; i++) v |= u64() << BigInt(64 * i);
        if (neg) v = -v;
        if (tag === T.BIGINT_OBJECT) all.push(v);
        return v;
      }
      case T.DATE: { const v = new Date(dbl()); all.push(v); return v; }
      case T.REGEXP: {
        const [t2, d2] = pair();
        if (t2 !== T.STRING) throw new Error('structured clone: bad regexp');
        const source = str(d2);
        const flags = ['g', 'i', 'm', 's', 'u', 'y', 'v', 'd'].filter((f, i) => [2, 1, 4, 32, 16, 8, 128, 64][i] & data).join('');
        let v;
        try { v = new RegExp(source, flags); } catch { v = new RegExp(source); }
        all.push(v);
        return v;
      }
      case T.BACK_REFERENCE: {
        if (data >= all.length) throw new Error('structured clone: bad back reference');
        return all[data];
      }
      case T.ARRAY: case T.OBJECT: {
        if (++depth > 400) throw new Unsupported('nested too deep');
        const o = tag === T.ARRAY ? new Array(data) : {};
        all.push(o);
        while (!peekEnd()) {
          const k = value();
          const v = value();
          if (typeof k !== 'string' && typeof k !== 'number') throw new Error('structured clone: bad key');
          if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
          else o[k] = v;
        }
        p += 8;
        depth--;
        return o;
      }
      case T.MAP: {
        const m = new Map();
        all.push(m);
        while (!peekEnd()) { const k = value(); m.set(k, value()); }
        p += 8;
        return m;
      }
      case T.SET: {
        const s = new Set();
        all.push(s);
        while (!peekEnd()) s.add(value());
        p += 8;
        return s;
      }
      case T.ARRAY_BUFFER_V2: { const v = bytes(data); all.push(v); return v; }
      case T.ARRAY_BUFFER: { const n = Number(u64()); const v = bytes(n); all.push(v); return v; }
      case T.TYPED_ARRAY: case T.TYPED_ARRAY_V2: {
        const slot = all.length;
        all.push(null);   // the view comes before its buffer
        // (current format: the type in the pair, then the length; older: the length, then the type)
        const n = tag === T.TYPED_ARRAY ? u64() : BigInt(data >>> 0);
        const type = tag === T.TYPED_ARRAY ? data : Number(u64());
        const b = value();
        const off = u64();
        const v = typed(type, n, Buffer.isBuffer(b) ? b : Buffer.alloc(0), off);
        all[slot] = v;
        return v;
      }
      default:
        if (tag >= T.TYPED_ARRAY_V1_MIN && tag <= T.TYPED_ARRAY_V1_MAX) {
          const n = data;
          const C = TYPED[tag - T.TYPED_ARRAY_V1_MIN];
          if (!C) throw new Unsupported('typed array');
          const v = bytes(n * C.BYTES_PER_ELEMENT);
          all.push(v);
          return v;
        }
        // Blobs, files, errors, wasm and the like can't be carried over.
        throw new Unsupported('value type 0x' + tag.toString(16));
    }
  }
  if (buf.length >= 8 && buf.readUInt32LE(4) === T.HEADER) p = 8;
  return value();
}

// ------------------------------------------------------------------ IDB keys
// Firefox's key encoding (dom/indexedDB/Key.cpp): a type byte, then the value; arrays fold their type into
// the first element's byte; trailing zero bytes are trimmed, so reads past the end are zeros.
const K = { TERM: 0, FLOAT: 0x10, DATE: 0x20, STRING: 0x30, BINARY: 0x40, ARRAY: 0x50 };
function decodeKey(buf) {
  let p = 0;
  const at = (i) => (i < buf.length ? buf[i] : 0);
  const number = () => {
    p++;
    let n = 0n;
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(at(p + i));
    p += 8;
    const SIGN = 1n << 63n;
    const bits = n & SIGN ? n & ~SIGN : (0n - n) & 0xFFFFFFFFFFFFFFFFn;
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(bits);
    return b.readDoubleBE(0);
  };
  const units = () => {   // shared by strings and binary keys
    p++;
    const out = [];
    while (p < buf.length && buf[p] !== K.TERM) {
      const b0 = buf[p++];
      if (!(b0 & 0x80)) out.push(b0 - 1);
      else if (!(b0 & 0x40)) { const b1 = at(p++); out.push((((b0 << 8) | b1) - 0x8000 + 0x7f) & 0xffff); }
      else { const b1 = at(p++), b2 = at(p++); out.push(((b0 << 10) | (b1 << 2) | (b2 >> 6)) & 0xffff); }
    }
    p++;
    return out;
  };
  function val(offset, depth) {
    if (depth > 64) throw new Error('key nested too deep');
    const t = at(p) - offset;
    if (t >= K.ARRAY) {
      offset += K.ARRAY;
      if (offset === K.ARRAY * 3) { p++; offset = 0; }
      const arr = [];
      while (p < buf.length && at(p) - offset !== K.TERM) { arr.push(val(offset, depth + 1)); offset = 0; }
      p++;
      return arr;
    }
    if (t === K.STRING) { const u = units(); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.slice(i, i + 8192)); return s; }
    if (t === K.FLOAT) return number();
    if (t === K.DATE) return new Date(number());
    if (t === K.BINARY) return Buffer.from(units().map((x) => x & 0xff));
    throw new Error('unknown key type ' + t);
  }
  return val(0, 0);
}

// ------------------------------------------------------------------- reading
// Firefox keeps its databases open: work on a private copy (with its write-ahead log).
function withCopy(file, fn) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-ff-'));
  const dest = path.join(tmp, path.basename(file));
  try {
    fs.copyFileSync(file, dest);
    for (const ext of ['-wal', '-shm']) if (exists(file + ext)) { try { fs.copyFileSync(file + ext, dest + ext); } catch { /* optional */ } }
    const db = new DatabaseSync(dest);
    try { return fn(db); } finally { try { db.close(); } catch { /* closed */ } }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const columns = (db, table) => { try { return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); } catch { return []; } };
const toBuf = (v) => (v == null ? null : Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : typeof v === 'string' ? Buffer.from(v, 'utf8') : null);

// A key path as Firefox stores it: a string, or (for several) the parts after a leading comma.
function keyPath(s) {
  if (s == null) return null;
  s = String(s);
  return s.startsWith(',') ? s.slice(1).split(',') : s;
}

const MAX_RECORDS = 200000;
// One IndexedDB database file: its name, version and object stores with every record that can be read.
function readIdb(file, { maxBytes = 256 * 1024 * 1024 } = {}) {
  const filesDir = file.replace(/\.sqlite$/, '.files');
  return withCopy(file, (db) => {
    const meta = db.prepare('SELECT name, version FROM database').get() || {};
    const out = { name: String(meta.name || ''), version: Number(meta.version) || 1, stores: [], skipped: 0 };
    const stores = db.prepare('SELECT id, auto_increment, name, key_path FROM object_store ORDER BY id').all();
    const idxCols = columns(db, 'object_store_index');
    const indexes = idxCols.length ? db.prepare('SELECT * FROM object_store_index').all() : [];
    let total = 0;
    for (const s of stores) {
      const store = {
        name: String(s.name), keyPath: keyPath(s.key_path), autoIncrement: !!Number(s.auto_increment),
        indexes: indexes.filter((i) => Number(i.object_store_id) === Number(s.id)).map((i) => ({ name: String(i.name), keyPath: keyPath(i.key_path), unique: !!Number(i.unique_index), multiEntry: !!Number(i.multientry) })),
        records: [],
      };
      const rows = db.prepare('SELECT key, data, file_ids FROM object_data WHERE object_store_id = ? ORDER BY key').all(s.id);
      for (const r of rows) {
        if (store.records.length >= MAX_RECORDS || total > maxBytes) { out.skipped++; continue; }
        try {
          let raw;
          if (typeof r.data === 'number' || typeof r.data === 'bigint') {
            // Too big to keep inline: it's in a file next to the database.
            const id = Number(BigInt(r.data) & 0xFFFFFFFFn);
            const f = fs.readFileSync(path.join(filesDir, String(id)));
            raw = f.subarray(0, SNAPPY_MAGIC.length).equals(SNAPPY_MAGIC) ? snappyFramed(f) : f;
          } else raw = snappyRaw(toBuf(r.data));
          total += raw.length;
          const value = readClone(raw);
          const rec = { value };
          if (store.keyPath == null) rec.key = decodeKey(toBuf(r.key));
          store.records.push(rec);
        } catch (e) {
          out.skipped++;
          if (!(e instanceof Unsupported)) console.warn('[import] a Firefox IndexedDB record couldn’t be read: ' + e.message);
        }
      }
      out.stores.push(store);
    }
    return out;
  });
}

// prefs.js: { add-on id: internal UUID }.
function extensionUuids(profileDir) {
  try {
    const text = fs.readFileSync(path.join(profileDir, 'prefs.js'), 'utf8');
    const m = /user_pref\(\s*"extensions\.webextensions\.uuids"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(text);
    return m ? JSON.parse(JSON.parse('"' + m[1] + '"')) : {};
  } catch { return {}; }
}

const STORAGE_LOCAL_DB = 'webExtensions-storage-local';
const originDir = (profileDir, uuid, local) => path.join(profileDir, 'storage', 'default', 'moz-extension+++' + uuid + (local ? '^userContextId=4294967295' : ''));
const sqliteFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).map((f) => path.join(dir, f)); } catch { return []; } };

// Which add-ons have anything saved (cheap: looks at files, decodes nothing).
function addonsWithData(profileDir) {
  const uuids = extensionUuids(profileDir);
  const out = new Set();
  let synced = [];
  const syncFile = path.join(profileDir, 'storage-sync-v2.sqlite');
  if (exists(syncFile)) { try { synced = withCopy(syncFile, (db) => db.prepare("SELECT ext_id FROM storage_sync_data WHERE data IS NOT NULL AND data != '{}'").all().map((r) => String(r.ext_id))); } catch { /* unreadable */ } }
  for (const id of synced) out.add(id);
  for (const [id, uuid] of Object.entries(uuids)) {
    if (exists(path.join(profileDir, 'browser-extension-data', id, 'storage.js'))
      || sqliteFiles(path.join(originDir(profileDir, uuid, true), 'idb')).length
      || sqliteFiles(path.join(originDir(profileDir, uuid, false), 'idb')).length
      || exists(path.join(originDir(profileDir, uuid, false), 'ls', 'data.sqlite'))) out.add(id);
  }
  return out;
}

function readLocalStorage(file) {
  return withCopy(file, (db) => {
    const cols = columns(db, 'data');
    const out = {};
    const v4 = cols.includes('compression_type');
    for (const r of db.prepare('SELECT * FROM data').all()) {
      try {
        let b = toBuf(r.value);
        if (!b) continue;
        if (v4 ? Number(r.compression_type) === 1 : Number(r.compressed) === 1) b = snappyRaw(b);
        const units = Number(v4 ? r.utf16_length : r.utf16Length);
        let s;
        if (v4 && Number(r.conversion_type) === 1) s = b.toString('utf8');
        else if (units && b.length === units * 2 && b.toString('utf8').length !== units) s = b.toString('utf16le');
        else s = b.toString('utf8');
        out[String(r.key)] = s;
      } catch { /* skip it */ }
    }
    return out;
  });
}

// Everything one add-on has saved. Never throws: what can't be read is left out (and counted).
function readAddonData(profileDir, addonId) {
  const out = { local: {}, sync: {}, localStorage: {}, indexedDb: [], uuid: null, skipped: 0 };
  const uuid = extensionUuids(profileDir)[addonId] || null;
  out.uuid = uuid;
  // storage.local
  const legacy = path.join(profileDir, 'browser-extension-data', addonId, 'storage.js');
  if (exists(legacy)) { try { Object.assign(out.local, JSON.parse(fs.readFileSync(legacy, 'utf8'))); } catch (e) { console.warn('[import] ' + addonId + ' storage.js: ' + e.message); } }
  if (uuid) {
    for (const f of sqliteFiles(path.join(originDir(profileDir, uuid, true), 'idb'))) {
      try {
        const d = readIdb(f);
        if (d.name !== STORAGE_LOCAL_DB) continue;
        const st = d.stores.find((s) => s.name === 'storage-local-data') || d.stores[0];
        for (const r of (st && st.records) || []) if (typeof r.key === 'string') out.local[r.key] = r.value;
        out.skipped += d.skipped;
      } catch (e) { console.warn('[import] ' + addonId + ' storage.local: ' + e.message); }
    }
  }
  // storage.sync
  const syncFile = path.join(profileDir, 'storage-sync-v2.sqlite');
  if (exists(syncFile)) {
    try {
      const row = withCopy(syncFile, (db) => db.prepare('SELECT data FROM storage_sync_data WHERE ext_id = ?').get(addonId));
      if (row && row.data) Object.assign(out.sync, JSON.parse(String(row.data)));
    } catch (e) { console.warn('[import] ' + addonId + ' storage.sync: ' + e.message); }
  }
  if (uuid) {
    const own = originDir(profileDir, uuid, false);
    const ls = path.join(own, 'ls', 'data.sqlite');
    if (exists(ls)) { try { out.localStorage = readLocalStorage(ls); } catch (e) { console.warn('[import] ' + addonId + ' localStorage: ' + e.message); } }
    for (const f of sqliteFiles(path.join(own, 'idb'))) {
      try {
        const d = readIdb(f);
        out.skipped += d.skipped;
        if (d.name && d.stores.length) out.indexedDb.push({ name: d.name, version: d.version, stores: d.stores });
      } catch (e) { console.warn('[import] ' + addonId + ' IndexedDB ' + path.basename(f) + ': ' + e.message); }
    }
  }
  return out;
}

// For carrying values to an extension page (JSON can't hold dates, maps, binary…): tagged plain data that
// the page turns back into the real thing. Firefox's moz-extension:// addresses become the extension's own.
const TAG = '\u0000bifrost';
function toWire(v, rewrite, seen = new Map()) {
  if (typeof v === 'string') return rewrite ? rewrite(v) : v;
  if (v === undefined) return { [TAG]: 'u' };
  if (typeof v === 'number') return Number.isFinite(v) ? v : { [TAG]: 'n', v: String(v) };
  if (typeof v === 'bigint') return { [TAG]: 'i', v: String(v) };
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);   // (shared objects are copied, cycles cut)
  if (v instanceof Date) return { [TAG]: 'd', v: v.getTime() };
  if (v instanceof RegExp) return { [TAG]: 'r', s: v.source, f: v.flags };
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return { [TAG]: 'b', v: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  seen.set(v, null);
  let out;
  if (v instanceof Map) out = { [TAG]: 'm', v: [...v].map(([k, x]) => [toWire(k, rewrite, seen), toWire(x, rewrite, seen)]) };
  else if (v instanceof Set) out = { [TAG]: 's', v: [...v].map((x) => toWire(x, rewrite, seen)) };
  else if (Array.isArray(v)) out = Array.from(v, (x) => toWire(x, rewrite, seen));
  else { out = {}; for (const [k, x] of Object.entries(v)) out[rewrite ? rewrite(k) : k] = toWire(x, rewrite, seen); }
  seen.set(v, out);
  return out;
}
// The page side of toWire, as source text to run in the extension.
const FROM_WIRE_JS = `(function fromWire(v) {
  const TAG = '\\u0000bifrost';
  if (Array.isArray(v)) return v.map(fromWire);
  if (!v || typeof v !== 'object') return v;
  if (TAG in v) {
    const t = v[TAG];
    if (t === 'u') return undefined;
    if (t === 'n') return Number(v.v);
    if (t === 'i') return BigInt(v.v);
    if (t === 'd') return new Date(v.v);
    if (t === 'r') { try { return new RegExp(v.s, v.f); } catch { return new RegExp(v.s); } }
    if (t === 'b') { const s = atob(v.v); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; }
    if (t === 'm') return new Map(v.v.map(([k, x]) => [fromWire(k), fromWire(x)]));
    if (t === 's') return new Set(v.v.map(fromWire));
  }
  const o = {};
  for (const k of Object.keys(v)) o[k] = fromWire(v[k]);
  return o;
})`;

module.exports = { readAddonData, addonsWithData, extensionUuids, readIdb, readClone, decodeKey, snappyRaw, snappyFramed, toWire, FROM_WIRE_JS, STORAGE_LOCAL_DB };
