'use strict';
// Extension files: CRX2/CRX3 and ZIP unpacking, extension IDs, and human-readable permission warnings.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Chrome's ID alphabet: hex digits 0-f mapped to letters a-p.
function idFromHash(buf) {
  return Buffer.from(buf).subarray(0, 16).toString('hex').split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function idForKey(base64Key) {
  return idFromHash(crypto.createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest());
}

// Same as Chromium's GenerateIdForPath (unpacked extensions without a "key" in their manifest).
function idForPath(p) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8'));
    if (m.key) return idForKey(m.key);
  } catch { /* fall through */ }
  let abs = path.resolve(p);
  let bytes;
  if (process.platform === 'win32') {
    if (/^[a-z]:/.test(abs)) abs = abs[0].toUpperCase() + abs.slice(1);
    bytes = Buffer.from(abs, 'utf16le');
  } else {
    bytes = Buffer.from(abs, 'utf8');
  }
  return idFromHash(crypto.createHash('sha256').update(bytes).digest());
}

// --------------------------------------------------------------------- protobuf (just enough for CRX3)
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do { b = buf[pos++]; result += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
  return [result, pos];
}

function readFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      out.push({ field, data: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 0) { [, pos] = readVarint(buf, pos); } else if (wire === 5) pos += 4; else if (wire === 1) pos += 8; else break;
  }
  return out;
}

const DAMAGED = 'The extension file is damaged';
const BAD_SIGNATURE = 'The extension file’s signature doesn’t match its contents, so it wasn’t installed';

function verifies(algorithm, parts, key, signature) {
  try {
    const v = crypto.createVerify(algorithm);
    for (const p of parts) v.update(p);
    return v.verify({ key: Buffer.from(key), format: 'der', type: 'spki' }, signature);
  } catch { return false; }
}

// A .crx must be signed by the key its extension ID comes from (as Chrome checks), so a file can't take
// another extension's ID, and with it that extension's saved data. A plain .zip has no signature.
// Returns { zip: Buffer, publicKey: base64 | null, id: string | null }
function parseCrx(buf) {
  if (buf.length < 4 || buf.subarray(0, 4).toString() !== 'Cr24') return { zip: buf, publicKey: null, id: null };
  if (buf.length < 16) throw new Error(DAMAGED);
  const version = buf.readUInt32LE(4);
  if (version === 2) {
    const keyLen = buf.readUInt32LE(8), sigLen = buf.readUInt32LE(12);
    if (16 + keyLen + sigLen > buf.length) throw new Error(DAMAGED);
    const key = buf.subarray(16, 16 + keyLen);
    const sig = buf.subarray(16 + keyLen, 16 + keyLen + sigLen);
    const zip = buf.subarray(16 + keyLen + sigLen);
    if (!verifies('sha1', [zip], key, sig)) throw new Error(BAD_SIGNATURE);
    return { zip, publicKey: key.toString('base64'), id: idFromHash(crypto.createHash('sha256').update(key).digest()) };
  }
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8);
    if (12 + headerLen > buf.length) throw new Error(DAMAGED);
    const fields = readFields(buf.subarray(12, 12 + headerLen));
    const zip = buf.subarray(12 + headerLen);
    const signedHeader = (fields.find((f) => f.field === 10000) || {}).data || Buffer.alloc(0);
    const idField = readFields(signedHeader).find((f) => f.field === 1);
    if (!idField || idField.data.length !== 16) throw new Error(DAMAGED);
    const crxId = Buffer.from(idField.data);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(signedHeader.length);
    const signedData = [Buffer.from('CRX3 SignedData\x00', 'latin1'), size, signedHeader, zip];
    // RSA (field 2) and ECDSA (field 3) proofs; the one whose key hashes to the ID has to verify.
    for (const proof of fields.filter((x) => x.field === 2 || x.field === 3)) {
      const parts = readFields(proof.data);
      const key = (parts.find((x) => x.field === 1) || {}).data;
      const sig = (parts.find((x) => x.field === 2) || {}).data;
      if (!key || !sig) continue;
      if (!crypto.createHash('sha256').update(key).digest().subarray(0, 16).equals(crxId)) continue;
      if (verifies('sha256', signedData, key, sig)) return { zip, publicKey: Buffer.from(key).toString('base64'), id: idFromHash(crxId) };
    }
    throw new Error(BAD_SIGNATURE);
  }
  throw new Error('Unsupported CRX version ' + version);
}

// ----------------------------------------------------------------------- zip
// Limits, so a hostile archive can't fill the disk or memory ("zip bombs").
const MAX_FILE = 256 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024, MAX_ENTRIES = 50000;

function unzip(buf, dest) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('The extension has too many files');
  let off = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Unsafe path in zip: ' + name);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Corrupt zip entry: ' + name);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    const limit = Math.max(1, usize === 0xffffffff ? MAX_FILE : Math.min(usize, MAX_FILE));
    let out;
    if (method === 0) out = data;
    else if (method === 8) {
      try { out = zlib.inflateRawSync(data, { maxOutputLength: limit }); } catch { throw new Error('Corrupt or oversized file in the extension: ' + name); }
    } else throw new Error('Unsupported zip compression ' + method);
    total += out.length;
    if (out.length > MAX_FILE || total > MAX_TOTAL) throw new Error('The extension is too large');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
  }
}

// One file from a zip (or null), e.g. an icon from a Firefox add-on's .xpi. Same limits as unzip.
function readZipEntry(buf, wanted, maxSize = 4 * 1024 * 1024) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = Math.min(buf.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let off = buf.readUInt32LE(eocd + 16);
  wanted = String(wanted).replace(/^\.?\//, '');
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (usize > maxSize || local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) { try { return zlib.inflateRawSync(data, { maxOutputLength: maxSize }); } catch { return null; } }
    return null;
  }
  return null;
}

// The extension's name, translated when the manifest uses a __MSG_name__ placeholder.
function plainName(manifest, root) {
  const name = String(manifest.name || '');
  const m = /^__MSG_(\w+)__$/.exec(name);
  if (!m) return name;
  for (const loc of [manifest.default_locale, 'en', 'en_US'].filter(Boolean)) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales', loc, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      const hit = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase());
      if (hit && messages[hit] && messages[hit].message) return String(messages[hit].message);
    } catch { /* try the next locale */ }
  }
  return name;
}

// A stand-in "key" for an unsigned extension: Chromium derives the ID from the key's bytes.
function localKey(manifest, root) {
  return crypto.createHash('sha256').update('bifrost-local-extension:' + plainName(manifest, root).trim().toLowerCase()).digest().toString('base64');
}

// Unpacks a .crx or .zip into <extensionsPath>/<id>/<version>/ and pins the ID with a manifest key.
// confirm({ id, manifest, root }) runs before anything already installed is touched; returning false
// cancels (nothing changes).
async function unpackToExtensions(file, extensionsPath, { confirm } = {}) {
  const buf = fs.readFileSync(file);
  const { zip, publicKey, id: crxId } = parseCrx(buf);
  const tmp = path.join(extensionsPath, '.tmp-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(tmp, { recursive: true });
  try {
    unzip(zip, tmp);
    // Some zips wrap everything in one folder.
    let root = tmp;
    if (!fs.existsSync(path.join(root, 'manifest.json'))) {
      const dirs = fs.readdirSync(tmp).filter((d) => fs.existsSync(path.join(tmp, d, 'manifest.json')));
      if (dirs.length === 1) root = path.join(tmp, dirs[0]); else throw new Error('No manifest.json in that file');
    }
    const mfile = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(mfile, 'utf8').replace(/^﻿/, ''));
    // A signed .crx keeps the ID its signature proves (whatever "key" its manifest claims). A plain .zip
    // without a "key" gets one made from its name, so a newer zip of the same extension keeps its ID and
    // data, and the folder it's unpacked to matches the ID it loads with.
    const key = publicKey || manifest.key || localKey(manifest, root);
    if (manifest.key !== key) { manifest.key = key; fs.writeFileSync(mfile, JSON.stringify(manifest, null, 2)); }
    const id = idForKey(key);
    if (crxId && id !== crxId) throw new Error(BAD_SIGNATURE);
    if (confirm && !(await confirm({ id, manifest, root }))) {
      const e = new Error('Installation cancelled');
      e.cancelled = true;
      throw e;
    }
    const dir = path.join(extensionsPath, id, String(manifest.version || '0') + '_0');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(root, dir);
    return { id, dir, manifest };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- warnings
const WARN = {
  tabs: 'Read your browsing history', history: 'Read and change your browsing history', bookmarks: 'Read and change your bookmarks',
  downloads: 'Manage your downloads', clipboardRead: 'Read data you copy and paste', clipboardWrite: 'Change data you copy and paste',
  notifications: 'Display notifications', geolocation: 'Detect your physical location', cookies: 'Read and change cookies',
  nativeMessaging: 'Communicate with cooperating native applications', management: 'Manage your apps, extensions, and themes',
  privacy: 'Change your privacy-related settings', proxy: 'Read and change all your data on all websites', debugger: 'Access the page debugger backend',
  topSites: 'Read a list of your most frequently visited websites', webNavigation: 'Read your browsing history', identity: 'Know your email address',
  pageCapture: 'Read and change all your data on all websites', desktopCapture: 'Capture content of your screen', tabCapture: 'Read and change all your data on all websites',
  declarativeNetRequest: 'Block content on any page', declarativeNetRequestWithHostAccess: 'Block content on pages you allow', sessions: 'Read your browsing history on all your signed-in devices',
  contentSettings: 'Change your settings that control websites’ access to features', fontSettings: 'Read and change your font settings',
};

function permissionWarnings(m) {
  const perms = [].concat(m.permissions || [], m.host_permissions || []);
  const cs = (m.content_scripts || []).flatMap((c) => c.matches || []);
  const hosts = perms.concat(cs).filter((p) => typeof p === 'string' && (p.includes('://') || p === '<all_urls>'));
  const out = [];
  if (hosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\/\*$|^https?:\/\/\*\/\*$/.test(h))) out.push('Read and change all your data on all websites');
  else if (hosts.length) {
    const names = [...new Set(hosts.map((h) => h.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))].slice(0, 4);
    out.push('Read and change your data on ' + names.join(', ') + (hosts.length > 4 ? ' and more' : ''));
  }
  for (const p of perms) if (typeof p === 'string' && WARN[p] && !out.includes(WARN[p])) out.push(WARN[p]);
  return out;
}

module.exports = { idForPath, idForKey, parseCrx, unzip, readZipEntry, unpackToExtensions, permissionWarnings };
