'use strict';
// Unpacks a zip file (stored or deflated entries, UTF-8 names; what tools/assemble.cjs and most tools
// write) into a folder. Runs in a worker thread when started as one, so big archives don't hold up the
// browser: new Worker(__filename, { workerData: { zip, dest } }) posts { done } or { error }.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) { const n = fs.readSync(fd, buf, off, len - off, pos + off); if (!n) throw new Error('the archive is cut short'); off += n; }
  return buf;
}

function entries(fd, size) {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  const tailLen = Math.min(size, 65557);
  const tail = readAt(fd, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('zip64 archives aren’t supported');
  const cd = readAt(fd, cdOff, cdSize);
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('the archive’s index is damaged');
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
    const local = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    out.push({ name, method, crc, csize, usize, local, flags });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// Where an entry goes, refusing names that would land outside dest.
function target(dest, name) {
  const clean = name.replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..')) throw new Error('unsafe name in the archive: ' + name);
  return path.join(dest, ...clean.split('/').filter(Boolean));
}

function unzip(zipFile, dest, onProgress) {
  const fd = fs.openSync(zipFile, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const list = entries(fd, size);
    let done = 0;
    fs.mkdirSync(dest, { recursive: true });
    for (const e of list) {
      const to = target(dest, e.name);
      if (e.name.endsWith('/')) { fs.mkdirSync(to, { recursive: true }); continue; }
      if (e.flags & 1) throw new Error('encrypted archives aren’t supported');
      const lh = readAt(fd, e.local, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('the archive is damaged at ' + e.name);
      const start = e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = readAt(fd, start, e.csize);
      const data = e.method === 0 ? raw : e.method === 8 ? zlib.inflateRawSync(raw) : null;
      if (!data) throw new Error('unsupported compression in ' + e.name);
      if (data.length !== e.usize) throw new Error('the archive is damaged at ' + e.name);
      if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== e.crc) throw new Error('the archive is damaged at ' + e.name + ' (checksum)');
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, list.length);
    }
    return { files: done };
  } finally { fs.closeSync(fd); }
}

// In the background (a worker thread).
function unzipInWorker(zipFile, dest) {
  const { Worker } = require('node:worker_threads');
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { zip: zipFile, dest } });
    w.once('message', (m) => (m && m.error ? reject(new Error(m.error)) : resolve(m)));
    w.once('error', reject);
    w.once('exit', (code) => { if (code) reject(new Error('unzipping stopped (' + code + ')')); });
  });
}

module.exports = { unzip, unzipInWorker, entries };

const wt = (() => { try { return require('node:worker_threads'); } catch { return null; } })();
if (wt && !wt.isMainThread && wt.workerData && wt.workerData.zip) {
  try { const r = unzip(wt.workerData.zip, wt.workerData.dest); wt.parentPort.postMessage({ done: true, files: r.files }); } catch (e) { wt.parentPort.postMessage({ error: e.message }); }
}
