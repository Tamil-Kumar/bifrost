'use strict';
// A small read-only LevelDB reader, for bringing extension data over from Chrome, Edge, Brave, Vivaldi
// and other Chromium browsers (chrome.storage.local and .sync, and localStorage, are LevelDB databases).
//
// Reads every table (.ldb / .sst) and write-ahead log (.log) in the folder, and keeps the newest value of
// each key by sequence number, deletions included. Snappy-compressed blocks are supported (what Chromium
// writes); blocks in other compressions are skipped. It works on a copy-free basis and never writes, so
// the other browser can stay open.
const fs = require('node:fs');
const path = require('node:path');

// ------------------------------------------------------------------ varints
function varint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error('truncated varint');
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

// ------------------------------------------------------------------- snappy
function unsnappy(src) {
  let [len, pos] = varint(src, 0);
  const out = Buffer.alloc(len);
  let o = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const kind = tag & 3;
    if (kind === 0) {
      let n = tag >> 2;
      if (n >= 60) { const bytes = n - 59; n = 0; for (let i = 0; i < bytes; i++) n |= src[pos++] << (8 * i); }
      n += 1;
      src.copy(out, o, pos, pos + n);
      pos += n; o += n;
      continue;
    }
    let length, offset;
    if (kind === 1) { length = ((tag >> 2) & 7) + 4; offset = ((tag >> 5) << 8) | src[pos++]; }
    else if (kind === 2) { length = (tag >> 2) + 1; offset = src[pos] | (src[pos + 1] << 8); pos += 2; }
    else { length = (tag >> 2) + 1; offset = src.readUInt32LE(pos); pos += 4; }
    if (!offset || offset > o) throw new Error('bad snappy copy');
    for (let i = 0; i < length; i++, o++) out[o] = out[o - offset];
  }
  return out;
}

// ------------------------------------------------------------------- tables
// A block's entries share key prefixes; the restart array at its end is only needed for seeking.
function blockEntries(block) {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - restarts * 4;
  const out = [];
  let pos = 0, last = Buffer.alloc(0);
  while (pos < end) {
    let shared, nonShared, valueLen;
    [shared, pos] = varint(block, pos);
    [nonShared, pos] = varint(block, pos);
    [valueLen, pos] = varint(block, pos);
    const key = Buffer.concat([last.subarray(0, shared), block.subarray(pos, pos + nonShared)]);
    pos += nonShared;
    out.push([key, block.subarray(pos, pos + valueLen)]);
    pos += valueLen;
    last = key;
  }
  return out;
}

function readBlock(file, offset, size) {
  const raw = file.subarray(offset, offset + size);
  const type = file[offset + size];   // then a 4-byte checksum
  if (type === 0) return raw;
  if (type === 1) return unsnappy(raw);
  return null;   // zstd or something newer: skip the block
}

// Internal keys in tables: user key + 8 bytes of (sequence << 8 | type); type 1 = value, 0 = deletion.
function readTable(file, put) {
  if (file.length < 48) return;
  const footer = file.subarray(file.length - 48);
  let pos = 0, metaOff, metaSize, indexOff, indexSize;
  [metaOff, pos] = varint(footer, pos);
  [metaSize, pos] = varint(footer, pos);
  [indexOff, pos] = varint(footer, pos);
  [indexSize, pos] = varint(footer, pos);
  const index = readBlock(file, indexOff, indexSize);
  if (!index) return;
  for (const [, handle] of blockEntries(index)) {
    let p = 0, off, size;
    [off, p] = varint(handle, p);
    [size, p] = varint(handle, p);
    let block;
    try { block = readBlock(file, off, size); } catch { block = null; }
    if (!block) continue;
    for (const [ikey, value] of blockEntries(block)) {
      if (ikey.length < 8) continue;
      const tail = ikey.subarray(ikey.length - 8);
      const type = tail[0];
      const seq = tail.readUIntLE(1, 6) + tail[7] * 2 ** 48;
      put(ikey.subarray(0, ikey.length - 8), seq, type === 1 ? value : null);
    }
  }
}

// --------------------------------------------------------------------- logs
// 32 KB blocks of records (checksum 4, length 2, type 1: full, first, middle, last); records join into
// write batches: sequence 8, count 4, then (tag, key[, value]) with tag 1 = put, 0 = delete.
function readLog(file, put) {
  const BLOCK = 32768;
  let pos = 0, pending = [];
  const batch = (b) => {
    if (b.length < 12) return;
    let seq = Number(b.readBigUInt64LE(0));
    const count = b.readUInt32LE(8);
    let p = 12;
    for (let i = 0; i < count && p < b.length; i++, seq++) {
      const tag = b[p++];
      let kl, vl;
      [kl, p] = varint(b, p);
      const key = b.subarray(p, p + kl);
      p += kl;
      if (tag === 1) { [vl, p] = varint(b, p); put(key, seq, b.subarray(p, p + vl)); p += vl; } else put(key, seq, null);
    }
  };
  while (pos + 7 <= file.length) {
    const left = BLOCK - (pos % BLOCK);
    if (left < 7) { pos += left; continue; }
    const len = file.readUInt16LE(pos + 4);
    const type = file[pos + 6];
    const data = file.subarray(pos + 7, pos + 7 + len);
    pos += 7 + len;
    if (type === 0 && len === 0) { pos += BLOCK - (pos % BLOCK || BLOCK); continue; }   // padding
    if (type === 1) { pending = []; try { batch(Buffer.from(data)); } catch { /* torn write */ } }
    else if (type === 2) pending = [data];
    else if (type === 3) pending.push(data);
    else if (type === 4) { pending.push(data); try { batch(Buffer.concat(pending)); } catch { /* torn */ } pending = []; }
  }
}

// ------------------------------------------------------------------ the API
// Returns Map(key Buffer as latin1 string -> value Buffer) of the live entries.
function readAll(dir) {
  const best = new Map();   // key (latin1) -> { seq, value|null }
  const put = (key, seq, value) => {
    const k = key.toString('latin1');
    const cur = best.get(k);
    if (!cur || seq >= cur.seq) best.set(k, { seq, value: value ? Buffer.from(value) : null });
  };
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return new Map(); }
  for (const f of files) {
    const p = path.join(dir, f);
    let buf;
    try {
      if (/\.(ldb|sst)$/i.test(f)) { buf = fs.readFileSync(p); readTable(buf, put); }
      else if (/\.log$/i.test(f) && /^\d+\.log$/.test(f)) { buf = fs.readFileSync(p); readLog(buf, put); }
    } catch (e) { console.warn('[leveldb] skipped ' + f + ': ' + e.message); }
  }
  const out = new Map();
  for (const [k, v] of best) if (v.value) out.set(k, v.value);
  return out;
}

// chrome.storage (local or sync) folders: key = UTF-8 storage key, value = JSON text.
function readExtensionStorage(dir) {
  const out = {};
  for (const [k, v] of readAll(dir)) {
    const key = Buffer.from(k, 'latin1').toString('utf8');
    try { out[key] = JSON.parse(v.toString('utf8')); } catch { /* not JSON: not a storage entry */ }
  }
  return out;
}

// localStorage of one origin, from "Local Storage/leveldb": keys are "_<origin>\0\x01<key>", values are
// a one-byte encoding marker (0 = UTF-16LE, 1 = Latin-1) then the text.
function readLocalStorage(dir, origin) {
  const prefix = '_' + origin + '\u0000';
  const out = {};
  const decode = (b) => (b[0] === 0 ? b.subarray(1).toString('utf16le') : b.subarray(1).toString('latin1'));
  for (const [k, v] of readAll(dir)) {
    if (!k.startsWith(prefix)) continue;
    const raw = Buffer.from(k.slice(prefix.length), 'latin1');
    try { out[decode(raw)] = decode(v); } catch { /* skip */ }
  }
  return out;
}

module.exports = { readAll, readExtensionStorage, readLocalStorage, unsnappy };
