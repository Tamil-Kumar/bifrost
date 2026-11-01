'use strict';
// Puts a portable Bifrost together from an unpacked Electron release and Bifrost's app files.
// Used by tools/package.mjs, and by the Windows setup (run with Electron's own Node), so it needs only
// Node's built-in modules plus the bundled resedit.cjs next to it.
//
//   node assemble.cjs --runtime=<unpacked Electron> --app=<folder with package.json, src, assets> --out=<folder>
//       one portable Bifrost for that runtime's platform
//   node assemble.cjs dual --x64=<unpacked Electron win32-x64> --arm64=<… win32-arm64> --app=<…> --out=<folder>
//                          [--installers=<folder> --stubs=<folder with installer-*.exe, BifrostPortable.exe>]
//       Windows: a BifrostPortable folder with both builds (BifrostPortable.exe starts the right one, and
//       both share one Data folder), plus Bifrost-Setup-x64.exe and Bifrost-Setup-arm64.exe installers
//
// An existing output folder is updated in place: its Data folder (the profile) is kept.
const fs = require('node:fs');
const path = require('node:path');

// Under Electron's Node (the Windows setup), .asar archives would otherwise look like folders.
process.noAsar = true;

const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
// Electron's build-time switches: off for running as plain Node, NODE_OPTIONS, --inspect and file://
// extra privileges. Cookie encryption stays off so a portable profile works on any computer.
const FUSES = { 0: false, 2: false, 3: false, 7: false };

function flipFuses(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(FUSE_SENTINEL);
  if (at < 0 || buf.indexOf(FUSE_SENTINEL, at + 1) >= 0) throw new Error('expected exactly one fuse wire in ' + path.basename(file));
  const version = buf[at + FUSE_SENTINEL.length];
  const count = buf[at + FUSE_SENTINEL.length + 1];
  if (version !== 1) throw new Error('unknown fuse format ' + version);
  const start = at + FUSE_SENTINEL.length + 2;
  for (const [i, on] of Object.entries(FUSES)) {
    const k = Number(i);
    if (k >= count || buf[start + k] === 0x72 /* 'r': removed */) continue;
    buf[start + k] = on ? 0x31 : 0x30;
  }
  fs.writeFileSync(file, buf);
  return [...buf.subarray(start, start + count)].map((b) => String.fromCharCode(b)).join('');
}

// Windows: Bifrost's icon and version details in the .exe (it isn't code-signed).
function brandExe(file, pkg, icoFile) {
  const ResEdit = require(path.join(__dirname, fs.existsSync(path.join(__dirname, 'resedit.cjs')) ? 'resedit.cjs' : 'vendor/resedit.cjs'));
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const groups = res.entries.filter((e) => e.type === 14);
  if (!groups.length) throw new Error('no icon group in ' + path.basename(file));
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoFile));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = pkg.version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0);
  vi.setProductVersion(a, b, c, 0);
  for (const lang of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(lang, {
      ProductName: pkg.productName, FileDescription: pkg.productName, CompanyName: pkg.author || '', InternalName: pkg.productName,
      OriginalFilename: 'Bifrost.exe', LegalCopyright: `${pkg.productName} (GPL-3.0-or-later), built on Electron ${pkg.engines.electron}`,
      FileVersion: pkg.version, ProductVersion: pkg.version,
    });
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
}

function copyTree(from, to, skip) {
  if (skip && skip(from)) return;
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) copyTree(path.join(from, e), path.join(to, e), skip);
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    if (st.mode & 0o111) fs.chmodSync(to, st.mode & 0o777);
  }
}

function readme(pkg, windows) {
  return `Bifrost ${pkg.version} (portable)
=====================================

A keyboard-first browser: vertical or horizontal tabs, spaces, split view, a launcher that searches
bookmarks, tabs, history and the web, a built-in ad blocker, Vim keys and Chrome extensions.

Running it
----------
${windows ? `Double-click Bifrost.exe.

PortableApps.com: put the whole BifrostPortable folder into your platform's PortableApps folder, then
use Apps -> Refresh App Icons in the platform's menu.` : `Run ./bifrost. If it refuses to start because of the sandbox, your system blocks unprivileged user
namespaces (Ubuntu 24.04 does by default): run it with --no-sandbox, or make chrome-sandbox
setuid root (sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox).`}

Your data
---------
Everything (bookmarks, history, settings, extensions, cookies) is kept in the Data folder next to the
program, because of the file named "portable". Delete that file to use the normal per-user profile
instead. To move to another computer, copy the whole folder.

First steps
-----------
Ctrl+T          search and open (the launcher)
Ctrl+Shift+P    every command
Ctrl+Shift+\\    split view with the next tab
Alt+1..9        switch spaces
?               (on a page, with Vim keys on) all the Vim keys
Ctrl+,          settings (every animation can be turned off there, together or one by one)

Extensions
----------
Install from the Chrome Web Store, from a .crx or .zip file, or load an unpacked folder from the
Extensions page. Extensions run in normal windows, not private ones. Extensions that block requests
with declarativeNetRequest rules (e.g. uBlock Origin Lite) don't apply those rules in Bifrost; use the
built-in blocker (Settings -> Privacy) instead.

License
-------
Bifrost is free software under the GNU General Public License v3 or later (LICENSE.txt). It includes
Electron (MIT, LICENSE.electron.txt) and Chromium (LICENSES.chromium.html), electron-chrome-extensions
(GPL-3.0), Ghostery's adblocker (MPL-2.0) and Mozilla's Readability (Apache-2.0); see
resources/app/src/vendor.
`;
}

function appInfo(pkg) {
  return `[Format]
Type=PortableApps.comFormat
Version=3.9

[Details]
Name=Bifrost
AppID=BifrostPortable
Publisher=${pkg.author || 'Bifrost'}
Category=Internet
Description=A keyboard-first browser built around a launcher.
Language=Multilingual

[License]
Shareable=true
OpenSource=true
Freeware=true
CommercialUse=true

[Version]
PackageVersion=${pkg.version}.0
DisplayVersion=${pkg.version}

[Control]
Icons=1
Start=Bifrost.exe
`;
}

// Empties an existing package folder except for its Data folder (the profile lives there). Refuses to
// touch a folder that isn't empty and isn't a Bifrost package.
function clearKeepingData(out) {
  if (!fs.existsSync(out)) return;
  const entries = fs.readdirSync(out);
  const ours = ['Bifrost.exe', 'bifrost'].some((e) => entries.includes(e)) || fs.existsSync(path.join(out, 'resources', 'app', 'package.json'));
  if (entries.length && !ours && !(entries.length === 1 && entries[0] === 'Data')) throw new Error(out + ' already has other files in it; choose an empty folder or an existing Bifrost folder');
  for (const e of entries) {
    if (e === 'Data') continue;
    fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
}

// layout: 'single'    a portable folder of its own (a "portable" marker, Data, README, PortableApps info)
//         'build'     one build inside a dual portable folder (portable.ini points at the shared Data)
//         'installed' what the installer puts in Program Files (no portable marker; uninstaller added)
// keepFuses: leave Electron's fuses as they are (castlabs' Widevine signing refuses a binary with changed
// fuses; the release builds keep them, and src/main/file-guard.js makes up for the file:// one).
function assemble({ runtime, app, out, log = () => {}, layout = 'single', uninstaller = null, keepFuses = false }) {
  const windows = fs.existsSync(path.join(runtime, 'electron.exe'));
  const exeFrom = path.join(runtime, windows ? 'electron.exe' : 'electron');
  if (!fs.existsSync(exeFrom)) throw new Error('No Electron program found in ' + runtime);
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  for (const need of ['src/main/index.js', 'assets/icons/icon.ico']) if (!fs.existsSync(path.join(app, need))) throw new Error('The app files are incomplete: missing ' + need);

  clearKeepingData(out);
  fs.mkdirSync(out, { recursive: true });
  log('copying Electron');
  copyTree(runtime, out, (f) => /default_app\.asar$/.test(f) || path.resolve(f) === path.resolve(path.join(runtime, 'LICENSE')));
  log('copying Bifrost');
  const appOut = path.join(out, 'resources', 'app');
  for (const f of ['package.json', 'src', 'assets']) copyTree(path.join(app, f), path.join(appOut, f), (x) => /\.map$|(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(x));

  const exe = path.join(out, windows ? 'Bifrost.exe' : 'bifrost');
  fs.renameSync(path.join(out, path.basename(exeFrom)), exe);
  if (windows) { log('icon and version info'); brandExe(exe, pkg, path.join(app, 'assets', 'icons', 'icon.ico')); }
  const fuses = keepFuses ? null : flipFuses(exe);
  log(keepFuses ? 'fuses: Electron’s own (for Widevine signing)' : 'fuses ' + fuses);
  if (!windows) fs.chmodSync(exe, 0o755);

  const nl = (s) => (windows ? s.replace(/\r?\n/g, '\r\n') : s);
  if (fs.existsSync(path.join(runtime, 'LICENSE'))) fs.copyFileSync(path.join(runtime, 'LICENSE'), path.join(out, 'LICENSE.electron.txt'));
  fs.copyFileSync(path.join(app, 'src', 'vendor', 'chrome-extensions', 'LICENSE-GPL-3.0'), path.join(out, 'LICENSE.txt'));
  if (layout === 'build') {
    fs.writeFileSync(path.join(out, 'portable.ini'), nl('; Bifrost keeps its profile in the shared Data folder of this portable install.\nDataDir=..\\..\\Data\n'));
  } else if (layout === 'installed') {
    if (uninstaller) fs.copyFileSync(uninstaller, path.join(out, 'Uninstall Bifrost.exe'));
  } else {
    fs.writeFileSync(path.join(out, 'portable'), nl('This file makes Bifrost keep its profile in the Data folder next to it. Delete it to use the normal per-user profile.\n'));
    fs.mkdirSync(path.join(out, 'Data'), { recursive: true });
    fs.writeFileSync(path.join(out, 'README.txt'), nl(readme(pkg, windows)));
    if (windows) writeAppInfo(out, app, pkg, 'Bifrost.exe');
  }
  return { exe, windows, version: pkg.version, fuses };
}

function writeAppInfo(out, app, pkg, start) {
  const nl = (s) => s.replace(/\r?\n/g, '\r\n');
  const info = path.join(out, 'App', 'AppInfo');
  fs.mkdirSync(info, { recursive: true });
  fs.copyFileSync(path.join(app, 'assets', 'icons', 'icon.ico'), path.join(info, 'appicon.ico'));
  for (const s of [16, 32, 75, 128]) fs.copyFileSync(path.join(app, 'assets', 'icons', `icon-${s}.png`), path.join(info, `appicon_${s}.png`));
  fs.writeFileSync(path.join(info, 'appinfo.ini'), nl(appInfo(pkg).replace('Start=Bifrost.exe', 'Start=' + start)));
}

// ------------------------------------------------------------------- zip
// A small zip writer (deflate, UTF-8 names, no zip64: fine below 4 GB), enough for the installers.
const zlib = require('node:zlib');
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function listTree(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { out.push({ rel: r + '/', dir: true }); walk(path.join(dir, e.name), r); } else out.push({ rel: r, file: path.join(dir, e.name) });
    }
  };
  walk(root, '');
  return out;
}

// Writes a zip of everything in root to fd, at the file's current end (its offsets count from there).
function writeZip(fd, root, { level = 6, log = () => {} } = {}) {
  const start = fs.fstatSync(fd).size;
  let pos = start;
  const write = (buf) => { let off = 0; while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off, pos + off); pos += buf.length; };
  const central = [];
  let bytes = 0;
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const entries = listTree(root);
  let n = 0;
  for (const e of entries) {
    const name = Buffer.from(e.rel, 'utf8');
    let data = Buffer.alloc(0), method = 0, crc = 0, usize = 0;
    if (!e.dir) {
      const raw = fs.readFileSync(e.file);
      usize = raw.length;
      bytes += usize;
      crc = crc32(raw);
      const packed = usize ? zlib.deflateRawSync(raw, { level }) : raw;
      if (packed.length < usize) { data = packed; method = 8; } else data = raw;
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const offset = pos - start;
    write(local); write(name); write(data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(usize, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(e.dir ? 0x10 : 0x20, 38); c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, name]));
    if (++n % 200 === 0) log(`zipped ${n}/${entries.length}`);
  }
  const cdStart = pos - start;
  const cd = Buffer.concat(central);
  write(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(cdStart, 16);
  write(end);
  if (pos - start > 0xffffffff) throw new Error('the archive is too big for a plain zip');
  return { offset: start, size: pos - start, bytes, files: entries.length };
}

// An installer: the stub program, then a zip of the installed folder, then the trailer the stub reads
// ([meta][u32 meta length][u64 zip offset][u64 zip size]["BFRSTPK1"]).
function makeInstaller({ stub, folder, out, version, arch, log = () => {} }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.partial';
  fs.copyFileSync(stub, tmp);
  const fd = fs.openSync(tmp, 'r+');
  let zip;
  try {
    zip = writeZip(fd, folder, { log });
    const meta = Buffer.from(`version=${version}\narch=${arch}\nbytes=${zip.bytes}\n`, 'utf8');
    const tail = Buffer.alloc(28);
    tail.writeUInt32LE(meta.length, 0);
    tail.writeBigUInt64LE(BigInt(zip.offset), 4);
    tail.writeBigUInt64LE(BigInt(zip.size), 12);
    tail.write('BFRSTPK1', 20, 'latin1');
    const end = fs.fstatSync(fd).size;
    fs.writeSync(fd, meta, 0, meta.length, end);
    fs.writeSync(fd, tail, 0, tail.length, end + meta.length);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, out);
  return Object.assign({ file: out }, zip);
}

// ------------------------------------------------------------- dual build
function readmeDual(pkg) {
  return readme(pkg, true)
    .replace('Double-click Bifrost.exe.', 'Double-click BifrostPortable.exe. It starts the build made for this PC: App\\Bifrost-arm64 on\nARM64 Windows (Snapdragon and other Arm laptops), App\\Bifrost-x64 everywhere else. Both use the same\nData folder, so the folder can move between your computers.')
    .replace('program, because of the file named "portable". Delete that file to use the normal per-user profile\ninstead.', 'program (App\\Bifrost-*\\portable.ini points there).');
}

function assembleDual({ runtimes, app, out, installers = null, stubs = null, log = () => {}, keepFuses = false }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const arches = Object.keys(runtimes).filter((a) => runtimes[a]);
  if (!arches.length) throw new Error('no runtimes given');
  // Replace an older BifrostPortable (single build or dual) but keep its Data.
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out);
    const ours = entries.some((e) => /^(Bifrost|BifrostPortable)\.exe$/i.test(e)) || fs.existsSync(path.join(out, 'App', 'AppInfo', 'appinfo.ini'));
    if (entries.length && !ours && !(entries.length === 1 && entries[0] === 'Data')) throw new Error(out + ' already has other files in it; choose an empty folder or an existing Bifrost folder');
    for (const e of entries) if (e !== 'Data') fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(out, 'Data'), { recursive: true });
  // Coming from Waypoint (Bifrost's old name): bring its portable profile over once.
  const old = path.join(path.dirname(out), 'WaypointPortable', 'Data');
  if (fs.existsSync(old) && !fs.readdirSync(path.join(out, 'Data')).length) {
    log('bringing over the WaypointPortable profile');
    copyTree(old, path.join(out, 'Data'), (f) => /[\\/](Temp|Crashpad)$/.test(f));
  }
  for (const arch of arches) {
    log(`building ${arch}`);
    assemble({ runtime: runtimes[arch], app, out: path.join(out, 'App', 'Bifrost-' + arch), layout: 'build', log: (m) => log(`${arch}: ${m}`), keepFuses });
  }
  const launcher = stubs && path.join(stubs, 'BifrostPortable.exe');
  if (launcher && fs.existsSync(launcher)) {
    fs.copyFileSync(launcher, path.join(out, 'BifrostPortable.exe'));
  } else throw new Error('BifrostPortable.exe (the launcher) is missing from ' + stubs);
  writeAppInfo(out, app, pkg, 'BifrostPortable.exe');
  const nl = (s) => s.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path.join(out, 'README.txt'), nl(readmeDual(pkg)));
  fs.copyFileSync(path.join(app, 'src', 'vendor', 'chrome-extensions', 'LICENSE-GPL-3.0'), path.join(out, 'LICENSE.txt'));

  const made = [];
  if (installers) {
    for (const arch of arches) {
      const stub = path.join(stubs, `installer-${arch}.exe`);
      if (!fs.existsSync(stub)) throw new Error('missing ' + stub);
      const stage = path.join(installers, `.stage-${arch}`);
      fs.rmSync(stage, { recursive: true, force: true });
      log(`installer ${arch}: staging`);
      assemble({ runtime: runtimes[arch], app, out: stage, layout: 'installed', uninstaller: stub, log: () => {}, keepFuses });
      log(`installer ${arch}: compressing`);
      const r = makeInstaller({ stub, folder: stage, out: path.join(installers, `Bifrost-Setup-${pkg.version}-${arch}.exe`), version: pkg.version, arch, log: (m) => log(`installer ${arch}: ${m}`) });
      fs.rmSync(stage, { recursive: true, force: true });
      log(`installer ${arch}: ${path.basename(r.file)} (${(fs.statSync(r.file).size / 1048576).toFixed(1)} MB)`);
      made.push(r.file);
    }
  }
  return { out, arches, installers: made, version: pkg.version };
}

module.exports = { assemble, assembleDual, makeInstaller, writeZip, flipFuses, brandExe };

if (require.main === module) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const log = (m) => console.log('[assemble] ' + m);
  try {
    if (process.argv[2] === 'dual') {
      const app = arg('app'), out = arg('out');
      const runtimes = { x64: arg('x64') && path.resolve(arg('x64')), arm64: arg('arm64') && path.resolve(arg('arm64')) };
      if (!app || !out || (!runtimes.x64 && !runtimes.arm64)) {
        console.error('usage: node assemble.cjs dual --x64=<runtime> --arm64=<runtime> --app=<app files> --out=<folder> [--installers=<folder> --stubs=<folder>]');
        process.exit(2);
      }
      const r = assembleDual({ runtimes, app: path.resolve(app), out: path.resolve(out), installers: arg('installers') && path.resolve(arg('installers')), stubs: path.resolve(arg('stubs') || path.join(__dirname, 'win', 'bin')), log });
      log(`Bifrost ${r.version} is ready: ${r.out} (${r.arches.join(' + ')})`);
      for (const f of r.installers) log('installer: ' + f);
    } else {
      const runtime = arg('runtime'), app = arg('app'), out = arg('out');
      if (!runtime || !app || !out) {
        console.error('usage: node assemble.cjs --runtime=<unpacked Electron> --app=<app files> --out=<folder>');
        process.exit(2);
      }
      const r = assemble({ runtime: path.resolve(runtime), app: path.resolve(app), out: path.resolve(out), log });
      log(`Bifrost ${r.version} is ready: ${r.exe}`);
    }
  } catch (e) {
    console.error('[assemble] failed: ' + (e && e.stack || e));
    process.exit(1);
  }
}
