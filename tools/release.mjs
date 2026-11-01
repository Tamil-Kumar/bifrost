// Builds a Bifrost release for Windows, ready to publish on GitHub (the release workflow runs it; it also
// runs on Linux for testing, without the signing).
//
//   node tools/release.mjs [--out=dist/release] [--cache=<folder for downloads>] [--sign] [--notes=<file>]
//                          [--notes-out=<file>]   (the release notes as published: unsigned builds say so)
//
// 1. the Electron runtime (castlabs' Electron for Content Security, with Widevine: package.json's
//    engines.electron) for x64 and ARM64, checked against the release's SHASUMS256.txt
// 2. Bifrost put together on it: the portable folder (both builds) and what each installer installs
// 3. --sign: each build signed for Widevine (castlabs EVS: python -m castlabs_evs.vmp sign-pkg, with the
//    account in EVS_ACCOUNT_NAME / EVS_PASSWD), after everything that changes Bifrost.exe
// 4. into <out>: Bifrost-Setup-<v>-x64.exe and -arm64.exe, BifrostPortable-<v>.zip, Bifrost-<v>-app.zip
//    (Bifrost's own files: what updates on the same Electron need), latest.json (what Bifrost's updater
//    reads) and SHA256SUMS.txt
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = require(path.join(ROOT, 'tools', 'assemble.cjs'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const RUNTIME = pkg.engines.electron;
const OUT = path.resolve(ROOT, args.out || 'dist/release');
const CACHE = path.resolve(args.cache || path.join(os.homedir(), 'cache'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-release-'));
const ARCHES = ['x64', 'arm64'];
const STUBS = path.join(ROOT, 'tools', 'win', 'bin');
const log = (m) => console.log('[release] ' + m);

const castlabs = /\+wvcus$/.test(RUNTIME);
const base = castlabs
  ? `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(RUNTIME)}/`
  : `https://github.com/electron/electron/releases/download/v${RUNTIME}/`;
const zipName = (arch) => `electron-v${RUNTIME}-win32-${arch}.zip`;
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fetchTo(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file + '.part', url], { stdio: 'inherit' });
  fs.renameSync(file + '.part', file);
}

// ------------------------------------------------------------------ 1. runtime
function runtime() {
  const sumsFile = path.join(CACHE, `SHASUMS256-${RUNTIME}.txt`);
  if (!fs.existsSync(sumsFile)) fetchTo(base + 'SHASUMS256.txt', sumsFile);
  const sums = fs.readFileSync(sumsFile, 'utf8');
  const out = {};
  for (const arch of ARCHES) {
    const m = new RegExp(`^([0-9a-f]{64}) \\*?${escape(zipName(arch))}$`, 'm').exec(sums);
    if (!m) throw new Error('no checksum for ' + zipName(arch));
    const zip = path.join(CACHE, zipName(arch));
    if (!fs.existsSync(zip) || sha256(zip) !== m[1]) { log('downloading ' + zipName(arch)); fetchTo(base + encodeURIComponent(zipName(arch)), zip); }
    const got = sha256(zip);
    if (got !== m[1]) throw new Error(`${zipName(arch)} doesn't match its checksum (${got})`);
    log(`${zipName(arch)} ✓ ${got.slice(0, 16)}…`);
    const dir = path.join(WORK, 'runtime-' + arch);
    require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(zip, dir);
    out[arch] = dir;
  }
  return out;
}

// ------------------------------------------------------------------ 2. assemble
// (The runtime's own Widevine signature is for electron.exe as it came; Bifrost.exe gets its own.)
const dropOldSig = (dir) => fs.rmSync(path.join(dir, 'electron.exe.sig'), { force: true });

function assembleAll(runtimes) {
  const portable = path.join(WORK, 'portable', 'BifrostPortable');
  A.assembleDual({ runtimes, app: ROOT, out: portable, stubs: STUBS, log });
  const stages = {};
  for (const arch of ARCHES) {
    dropOldSig(path.join(portable, 'App', 'Bifrost-' + arch));
    const stage = path.join(WORK, 'stage-' + arch);
    // Without the uninstaller for now: it goes in after signing (it isn't part of what's signed).
    A.assemble({ runtime: runtimes[arch], app: ROOT, out: stage, layout: 'installed', uninstaller: null, log: () => {} });
    dropOldSig(stage);
    stages[arch] = stage;
  }
  return { portable, stages };
}

// ------------------------------------------------------------------ 3. sign
function evs(...a) {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return execFileSync(py, ['-m', ...a], { stdio: 'inherit', env: Object.assign({}, process.env, { EVS_NO_ASK: '1' }) });
}

function sign(dirs) {
  if (!process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWD) throw new Error('--sign needs EVS_ACCOUNT_NAME and EVS_PASSWD (the castlabs EVS account)');
  // Logs in (on a fresh machine) or refreshes the login (its tokens expire every month). (`refresh` is the
  // account command documented to take -A/-P.)
  evs('castlabs_evs.account', 'refresh', '-A', process.env.EVS_ACCOUNT_NAME, '-P', process.env.EVS_PASSWD);
  for (const d of dirs) {
    log('signing for Widevine: ' + d);
    evs('castlabs_evs.vmp', 'sign-pkg', d);
    evs('castlabs_evs.vmp', 'verify-pkg', d);
    if (!fs.existsSync(path.join(d, 'Bifrost.exe.sig'))) throw new Error('no Bifrost.exe.sig in ' + d + ' after signing');
  }
}

// ------------------------------------------------------------------ 4. package
function zipFolder(root, file) {
  fs.rmSync(file, { force: true });
  const fd = fs.openSync(file, 'w');
  try { A.writeZip(fd, root, { level: 9 }); } finally { fs.closeSync(fd); }
  return file;
}

function describe(file) {
  return { file: path.basename(file), size: fs.statSync(file).size, sha256: sha256(file) };
}

// The release notes; an unsigned build says what that means, under the heading.
const UNSIGNED = '**This build isn’t signed for Widevine,** so services that require that (Netflix, Disney+, Prime Video) won’t play in it. A signed version comes as an automatic update.';
function releaseNotes(signed) {
  const text = args.notes && fs.existsSync(args.notes) ? fs.readFileSync(args.notes, 'utf8').trim() : '';
  if (signed || !text) return text;
  const lines = text.split('\n');
  const at = /^#/.test(lines[0]) ? 1 : 0;
  lines.splice(at, 0, ...(at ? ['', UNSIGNED] : [UNSIGNED, '']));
  return lines.join('\n');
}

function packageAll({ portable, stages }, signed) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const notes = releaseNotes(signed);
  if (args['notes-out']) { fs.mkdirSync(path.dirname(path.resolve(args['notes-out'])), { recursive: true }); fs.writeFileSync(args['notes-out'], notes + '\n'); }
  const latest = { version: VERSION, date: new Date().toISOString(), runtime: RUNTIME, signed, notes: notes.slice(0, 2000) };
  for (const arch of ARCHES) {
    fs.copyFileSync(path.join(STUBS, `installer-${arch}.exe`), path.join(stages[arch], 'Uninstall Bifrost.exe'));
    log(`installer ${arch}: compressing`);
    const r = A.makeInstaller({ stub: path.join(STUBS, `installer-${arch}.exe`), folder: stages[arch], out: path.join(OUT, `Bifrost-Setup-${VERSION}-${arch}.exe`), version: VERSION, arch });
    latest['win-' + arch] = { setup: describe(r.file) };
  }
  log('portable zip');
  latest.portable = describe(zipFolder(path.dirname(portable), path.join(OUT, `BifrostPortable-${VERSION}.zip`)));
  log('app zip');
  latest.app = describe(zipFolder(path.join(stages.x64, 'resources', 'app'), path.join(OUT, `Bifrost-${VERSION}-app.zip`)));
  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  const sums = fs.readdirSync(OUT).filter((f) => f !== 'SHA256SUMS.txt').sort().map((f) => `${sha256(path.join(OUT, f))}  ${f}`).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums);
  return latest;
}

try {
  for (const stub of ['BifrostPortable.exe', 'installer-x64.exe', 'installer-arm64.exe']) {
    const buf = fs.readFileSync(path.join(STUBS, stub));
    if (!buf.includes(Buffer.from(VERSION.split('').join('\0') + '\0', 'latin1'))) throw new Error(`tools/win/bin/${stub} wasn't built for ${VERSION}: run sh tools/win/build.sh`);
  }
  log(`Bifrost ${VERSION} on Electron ${RUNTIME}`);
  const built = assembleAll(runtime());
  const dirs = [...ARCHES.map((a) => path.join(built.portable, 'App', 'Bifrost-' + a)), ...ARCHES.map((a) => built.stages[a])];
  if (args.sign) sign(dirs);
  else log('not signed for Widevine (no --sign): streaming services that check it (Netflix) won’t play');
  const latest = packageAll(built, !!args.sign);
  for (const f of fs.readdirSync(OUT)) log(`${f}  ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} MB`);
  log('latest.json: ' + JSON.stringify({ version: latest.version, runtime: latest.runtime, signed: latest.signed }));
} catch (e) {
  console.error('[release] failed: ' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  if (!args.keep) fs.rmSync(WORK, { recursive: true, force: true });
  else log('work folder kept: ' + WORK);
}
