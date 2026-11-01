// Packages Bifrost for Windows: one zip with "Install Bifrost.cmd", which builds portable Bifrost (x64 +
// ARM64) and both installers on the user's PC from the Electron runtime (see tools/setup). Releases are
// made by the release workflow instead (tools/release.mjs): those are signed for Widevine, so Netflix
// plays, and update themselves; this is for building Bifrost on your own PC.
//
//   node tools/package.mjs win-setup [--out=dist] [--shasums=<SHASUMS256.txt for the Electron version>]
//
// Makes <out>/Bifrost-<version>-Windows.zip containing Bifrost-<version>-Windows/:
//   Install Bifrost.cmd      the one thing to run
//   README.txt
//   files/app                Bifrost itself (package.json, src, assets)
//   files/win                the launcher and installer stubs (tools/win/bin), with their C sources in src/
//   files/setup.ps1          tools/setup/setup.ps1 with this version and Electron's checksums filled in
//   files/assemble.cjs, resedit.cjs (+ its license)
// The Windows stubs must be built for this version first: sh tools/win/build.sh
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const cmd = process.argv[2];
if (cmd !== 'win-setup') { console.error('usage: node tools/package.mjs win-setup [--out=dist] [--shasums=file]'); process.exit(2); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const ELECTRON = pkg.engines.electron;
const OUT = path.resolve(ROOT, args.out || 'dist');
const NAME = `Bifrost-${VERSION}-Windows`;
// castlabs' Electron for Content Security (with Widevine) for a "+wvcus" version, else official Electron.
const CASTLABS = /\+wvcus$/.test(ELECTRON);
const BASE = CASTLABS ? `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(ELECTRON)}/` : `https://github.com/electron/electron/releases/download/v${ELECTRON}/`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------- checksums
function shasums() {
  const candidates = [args.shasums, ...[os.homedir() + '/cache', '/home/claude/cache'].flatMap((d) => [path.join(d, `SHASUMS256-${ELECTRON}.txt`), path.join(d, 'SHASUMS256.txt')])].filter(Boolean);
  for (const f of candidates) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes(`electron-v${ELECTRON}-win32-x64.zip`)) return text;
    } catch { /* next */ }
  }
  const tmp = path.join(os.tmpdir(), `electron-${ELECTRON}-SHASUMS256.txt`);
  execFileSync('curl', ['-sSfL', '-o', tmp, BASE + 'SHASUMS256.txt']);
  return fs.readFileSync(tmp, 'utf8');
}
const sums = shasums();
const shaFor = (arch) => {
  const m = new RegExp(`^([0-9a-f]{64}) \\*?${escape(`electron-v${ELECTRON}-win32-${arch}.zip`)}$`, 'm').exec(sums);
  if (!m) throw new Error(`no checksum for electron-v${ELECTRON}-win32-${arch}.zip`);
  return m[1];
};
const SHA = { x64: shaFor('x64'), arm64: shaFor('arm64') };

// ------------------------------------------------------------------ checks
// The stubs carry the version (in their properties): they must have been built for this one.
for (const stub of ['BifrostPortable.exe', 'installer-x64.exe', 'installer-arm64.exe']) {
  const buf = fs.readFileSync(path.join(ROOT, 'tools', 'win', 'bin', stub));
  const want = Buffer.from(VERSION.split('').join('\0') + '\0', 'latin1');   // UTF-16LE in the version resource
  if (!buf.includes(want)) throw new Error(`tools/win/bin/${stub} wasn't built for ${VERSION}: run sh tools/win/build.sh`);
}

// ------------------------------------------------------------------ staging
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-pkg-'));
const top = path.join(stage, NAME);
const files = path.join(top, 'files');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const copyDir = (from, to, skip = () => false) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (skip(a, e)) continue;
    if (e.isDirectory()) copyDir(a, b, skip); else fs.copyFileSync(a, b);
  }
};

// The app: package.json, src and assets only (no tests, tools or editor leftovers).
const junk = (p, e) => /(^|[\\/])(\.DS_Store|Thumbs\.db|.*~|.*\.orig|.*\.rej)$/.test(e.name);
fs.mkdirSync(path.join(files, 'app'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(files, 'app', 'package.json'));
copyDir(path.join(ROOT, 'src'), path.join(files, 'app', 'src'), junk);
// (Not the logo's source picture or the biggest icons: nothing in the app uses them.)
const notShipped = (p, e) => junk(p, e) || /[\\/]assets[\\/]icons[\\/](source|icon-(512|1024)\.png)$/.test(p);
copyDir(path.join(ROOT, 'assets'), path.join(files, 'app', 'assets'), notShipped);

// The Windows programs, and their sources (so what runs can be checked and rebuilt).
fs.mkdirSync(path.join(files, 'win', 'src'), { recursive: true });
for (const f of ['BifrostPortable.exe', 'installer-x64.exe', 'installer-arm64.exe', 'miniz-LICENSE.txt']) fs.copyFileSync(path.join(ROOT, 'tools', 'win', 'bin', f), path.join(files, 'win', f));
for (const f of ['launcher.c', 'installer.c', 'build.sh', 'res.rc.in', 'app.manifest']) fs.copyFileSync(path.join(ROOT, 'tools', 'win', f), path.join(files, 'win', 'src', f));

// The setup itself.
const ps = fs.readFileSync(path.join(ROOT, 'tools', 'setup', 'setup.ps1'), 'utf8')
  .replaceAll('@VERSION@', VERSION).replaceAll('@ELECTRON@', ELECTRON).replaceAll('@ELECTRON_BASE@', BASE).replaceAll('@SHA_X64@', SHA.x64).replaceAll('@SHA_ARM64@', SHA.arm64);
if (/@[A-Z0-9_]+@/.test(ps)) throw new Error('setup.ps1 has a placeholder left: ' + /@[A-Z0-9_]+@/.exec(ps)[0]);
if (/[^\x00-\x7F]/.test(ps)) throw new Error('setup.ps1 must be plain ASCII (Windows PowerShell 5.1 reads it as ANSI)');
fs.writeFileSync(path.join(files, 'setup.ps1'), crlf(ps));
fs.copyFileSync(path.join(ROOT, 'tools', 'assemble.cjs'), path.join(files, 'assemble.cjs'));
fs.copyFileSync(path.join(ROOT, 'tools', 'vendor', 'resedit.cjs'), path.join(files, 'resedit.cjs'));
fs.copyFileSync(path.join(ROOT, 'tools', 'vendor', 'resedit-LICENSE.txt'), path.join(files, 'resedit-LICENSE.txt'));
fs.writeFileSync(path.join(top, 'Install Bifrost.cmd'), crlf(fs.readFileSync(path.join(ROOT, 'tools', 'setup', 'Install Bifrost.cmd'), 'utf8')));

// README.txt (Windows paths: backslashes are literal here).
const readme = String.raw`Bifrost ${VERSION} for Windows
${'='.repeat(`Bifrost ${VERSION} for Windows`.length)}

Double-click "Install Bifrost.cmd". That's the only thing to run.
(Windows may ask whether to run it; choose Run, or "More info" -> "Run anyway".)

It downloads the Electron ${ELECTRON} runtime that Bifrost runs on, for both x64 and ARM64 (about
160 MB each, straight from its GitHub releases), checks each against its published checksum, and
makes, next to this file:

  BifrostPortable\                               portable Bifrost with both builds inside.
                                                 Start it with BifrostPortable\BifrostPortable.exe: it
                                                 runs the ARM64 build on ARM64 PCs (Snapdragon laptops)
                                                 and the x64 build everywhere else. Both share one Data
                                                 folder, so the folder can move between your computers.
  Installers\Bifrost-Setup-${VERSION}-x64.exe     installs Bifrost as an app on x64 PCs
  Installers\Bifrost-Setup-${VERSION}-arm64.exe   installs Bifrost as an app on ARM64 PCs

At the end it offers to install Bifrost on this PC, or to start the portable copy.

The installers install for the current user (no administrator rights), to
%LOCALAPPDATA%\Programs\Bifrost by default, with a Start menu shortcut, an entry in Settings > Apps
(to uninstall), and the registration that lets you pick Bifrost as your default browser. An installed
Bifrost keeps its profile in %APPDATA%\Bifrost; uninstalling keeps it unless you tick the box to
delete it. They also run silently: Bifrost-Setup-...exe /S [/desktop] [/D=C:\some\folder]

PortableApps.com: unzip this into the platform's PortableApps folder (so you have
PortableApps\@NAME@) and run it there. BifrostPortable then goes straight into PortableApps,
next to your other apps; use Apps -> Refresh App Icons in the platform's menu. A WaypointPortable
profile next to it is brought over the first time.

To update later, unzip a newer setup and run it again: BifrostPortable is rebuilt and its Data folder
is kept; the new installers update an installed Bifrost in place.

Bifrost built this way isn't signed for Widevine, so Netflix and some other streaming services
won't play in it, and it doesn't update itself. The installers on Bifrost's releases page
(https://github.com/Tamil-Kumar/bifrost/releases) are, and do.

No internet on the PC? Download electron-v${ELECTRON}-win32-x64.zip and -arm64.zip from
${BASE.replace(/\/download\//, '/tag/').replace(/\/$/, '')} elsewhere, then run in PowerShell,
in this folder:
  .\files\setup.ps1 -X64Zip <path to the x64 zip> -Arm64Zip <path to the arm64 zip>
`;
fs.writeFileSync(path.join(top, 'README.txt'), crlf(readme.replaceAll('@NAME@', NAME)));

// ------------------------------------------------------------------ zip
fs.mkdirSync(OUT, { recursive: true });
const zip = path.join(OUT, NAME + '.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qrX9', zip, NAME], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });
const size = fs.statSync(zip).size;
console.log(`${path.relative(process.cwd(), zip) || zip}  (${(size / 1048576).toFixed(2)} MB)  Electron ${ELECTRON}  x64 ${SHA.x64.slice(0, 12)}…  arm64 ${SHA.arm64.slice(0, 12)}…`);
