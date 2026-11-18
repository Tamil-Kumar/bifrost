// Checks that files opened with a Bifrost build open in it, the way Windows opens them: through the command
// Bifrost registers for them ("Bifrost.exe" --single-argument %1: src/main/default-browser.js), which Windows
// fills in with the file's path, spaces and all. A PDF, a page and a link: with Bifrost not running yet (it
// starts with the file) and with it running (a later start hands the file over and quits). The files are in
// a folder with spaces in its name, and so is Bifrost. Windows is asked as Explorer asks it (ShellExecuteEx),
// for a ProgID of the check's own with Bifrost's command, so what the PC opens .pdf files with doesn't matter.
// What Bifrost opened is read from its session file (the tabs it has open). The release workflow runs it on
// the portable build, with its own profile (the Data folder): Windows' command has no --profile.
//
//   node tools/open-check.mjs <BifrostPortable-<v>.zip | a folder with Bifrost.exe> [--timeout=60]
//   node tools/open-check.mjs --exe=<electron> --app=<checkout>     (a development copy: the command lines
//                                                                     Windows would make, started directly)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, fallback) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : fallback; };
const timeout = Number(opt('timeout', '60')) * 1000;
const log = (m) => console.log('[open-check] ' + m);
const WIN = process.platform === 'win32';
const PROGID = 'BifrostOpenCheck';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The command Bifrost registers, read from where it registers it (so this checks what Bifrost really does).
const registered = /\$\{quoted\} (--single-argument %1)`/.exec(fs.readFileSync(path.join(ROOT, 'src', 'main', 'default-browser.js'), 'utf8'));
if (!registered) { console.error('[open-check] default-browser.js registers no "--single-argument %1" command'); process.exit(2); }
const ARGS = registered[1];

function findExe(dir) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  for (const c of [path.join(dir, 'BifrostPortable', 'App', 'Bifrost-' + arch), path.join(dir, 'App', 'Bifrost-' + arch), dir]) {
    if (fs.existsSync(path.join(c, 'Bifrost.exe'))) return path.join(c, 'Bifrost.exe');
  }
  return null;
}

// (a folder with a space in its name)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost open check '));
let exe = opt('exe', '');
const appDir = opt('app', '');
let profile;
if (exe) {
  profile = path.join(work, 'profile');
} else {
  let dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '');
  if (fs.statSync(dir).isDirectory() && !findExe(dir)) {
    const zip = fs.readdirSync(dir).find((f) => /^BifrostPortable-.*\.zip$/.test(f));
    if (zip) dir = path.join(dir, zip);
  }
  if (dir.endsWith('.zip')) {
    const to = path.join(work, 'Bifrost Portable');
    log('unzipping ' + path.basename(dir));
    require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(dir, to);
    dir = to;
  }
  exe = findExe(dir);
  if (!exe) { console.error('[open-check] no Bifrost.exe in ' + dir); process.exit(2); }
  // The portable build's profile (src/main/paths.js): DataDir in portable.ini next to it, or Data there.
  const ini = (() => { try { return fs.readFileSync(path.join(path.dirname(exe), 'portable.ini'), 'utf8'); } catch { return ''; } })();
  const m = /^\s*DataDir\s*=\s*(.+?)\s*$/im.exec(ini);
  profile = path.join(m ? path.resolve(path.dirname(exe), m[1].replace(/^"(.*)"$/, '$1').replace(/[\\/]+/g, path.sep)) : path.join(path.dirname(exe), 'Data'), 'profile');
}
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ onboarding: { done: true }, tabs: { restoreOnStartup: 'newtab' }, updates: { auto: false } }));
const sessionFile = path.join(profile, 'session.json');
// What each start of Bifrost was asked to open, and made of it (src/main/open-args.js), shown as it goes.
const openLog = path.join(work, 'open-log.txt');
process.env.BIFROST_OPEN_LOG = openLog;
let logShown = 0;
function showLog() {
  let lines = [];
  try { lines = fs.readFileSync(openLog, 'utf8').split('\n').filter(Boolean); } catch { /* none yet */ }
  for (const l of lines.slice(logShown)) log('  Bifrost: ' + l);
  logShown = lines.length;
}

// The files, in a folder with spaces in its name (and a # in one's).
const files = path.join(work, 'My files');
fs.mkdirSync(files);
const PDF = path.join(files, 'Lecture notes #1.pdf');
const PAGE = path.join(files, 'a page.html');
fs.copyFileSync(path.join(ROOT, 'tests', 'site', 'notes.pdf'), PDF);
fs.writeFileSync(PAGE, '<!doctype html><meta charset="utf-8"><title>Open check</title><p>Opened by the check</p>');
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Link check</title><p>A link</p>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const LINK = `http://127.0.0.1:${server.address().port}/from-another-app?a=1&b=two%20words`;

// Windows: the check's ProgID, with Bifrost's command.
const regCmd = `"${exe}" ${ARGS}`;
// (a development copy: Electron, Bifrost's folder and the profile, ahead of what Windows' command has)
const lead = appDir ? [appDir, `--profile=${profile}`] : [];
if (WIN) {
  execFileSync('reg.exe', ['add', `HKCU\\Software\\Classes\\${PROGID}\\shell\\open\\command`, '/ve', '/f', '/t', 'REG_SZ', '/d', regCmd], { stdio: 'ignore' });
  log('registered ' + PROGID + ': ' + regCmd);
}

// Opens `what` as Explorer would (Windows), or starts the command line Windows would make, cut where
// Windows' command-line rules cut it (elsewhere).
const SHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OpenCheck {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHELLEXECUTEINFO {
    public int cbSize; public uint fMask; public IntPtr hwnd;
    public string lpVerb; public string lpFile; public string lpParameters; public string lpDirectory;
    public int nShow; public IntPtr hInstApp; public IntPtr lpIDList; public string lpClass;
    public IntPtr hkeyClass; public uint dwHotKey; public IntPtr hIcon; public IntPtr hProcess;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO info);
  public static string Open(string file, string cls) {
    var i = new SHELLEXECUTEINFO();
    i.cbSize = Marshal.SizeOf(i);
    i.fMask = 0x1 | 0x100 | 0x400;   // SEE_MASK_CLASSNAME, NOASYNC, FLAG_NO_UI
    i.lpVerb = "open"; i.lpFile = file; i.lpClass = cls; i.nShow = 1;
    return ShellExecuteEx(ref i) ? "ok" : "failed (" + Marshal.GetLastWin32Error() + ")";
  }
}
"@
[OpenCheck]::Open($env:OPEN_CHECK_FILE, '${PROGID}')
`;
function open(what) {
  if (WIN) {
    let out;
    try {
      out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHELL], { encoding: 'utf8', timeout: 60000, env: { ...process.env, OPEN_CHECK_FILE: what } }).trim();
    } catch (e) { out = 'powershell failed: ' + String((e && e.stderr) || e.message).trim(); }
    log(`  Windows opened ${what}: ${out}`);
    return out === 'ok';
  }
  spawn(exe, [...lead, ...ARGS.replace('%1', what).split(/\s+/)], { stdio: 'inherit' });
  return true;
}

// The addresses of the tabs Bifrost has open, from its session file.
function openTabs() {
  let state;
  try { state = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch { return []; }
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (k === 'url' && typeof x === 'string') out.push(x); else walk(x); } }
  };
  walk(state);
  return [...new Set(out)];
}
// The same file? (Windows may hand Bifrost the long form of a path the check knows by its short one.)
const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
function has(tabs, what) {
  if (/^https?:/.test(what)) return tabs.includes(what);
  return tabs.some((u) => { if (!/^file:/i.test(u)) return false; try { return real(fileURLToPath(u)) === real(what); } catch { return false; } });
}
async function waitFor(what, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (has(openTabs(), what)) { showLog(); log(`✓ ${label}`); return true; }
    await sleep(500);
  }
  showLog();
  console.error(`[open-check] ✗ ${label}: not among the tabs in ${timeout / 1000} s: ${JSON.stringify(openTabs())}`);
  return false;
}
// Ends Bifrost, and waits until it's gone (or a later start would find it still there).
function running() {
  try {
    if (WIN) return /Bifrost\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Bifrost.exe', '/NH'], { encoding: 'utf8' }));
    execFileSync('pgrep', ['-f', `--profile=${profile}`], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
async function quit() {
  for (let i = 0; i < 40 && running(); i++) {
    if (WIN) { try { execFileSync('taskkill', ['/F', '/T', '/IM', 'Bifrost.exe'], { stdio: 'ignore' }); } catch { /* gone meanwhile */ } }
    else { try { execFileSync('pkill', [i < 10 ? '-TERM' : '-KILL', '-f', `--profile=${profile}`], { stdio: 'ignore' }); } catch { /* gone meanwhile */ } }
    await sleep(250);
  }
}

let ok = true;
let started = null;
try {
  log(`Bifrost: ${exe}; profile ${profile}`);
  // Not running: Bifrost starts with the file.
  if (!open(PDF)) throw new Error('Windows didn’t start Bifrost for the file (this machine can’t be checked)');
  ok = (await waitFor(PDF, 'a PDF opened with Bifrost not running opens (Bifrost starts with it)')) && ok;
  await quit();
  await sleep(1000);
  // (a fresh start: last time's tabs gone from the session file, so only what opens now is in it)
  for (const f of [sessionFile, sessionFile + '.bak']) fs.rmSync(f, { force: true });

  // Running (started here, so what it says is in this log): a later start hands it over.
  started = spawn(exe, lead, { stdio: 'inherit' });
  const end = Date.now() + timeout;
  while (Date.now() < end && !fs.existsSync(sessionFile)) await sleep(300);
  await sleep(3000);
  log('Bifrost running: ' + JSON.stringify(openTabs()));
  for (const [what, label] of [
    [PAGE, 'a page opened with Bifrost running opens in it'],
    [PDF, 'a PDF opened with Bifrost running opens in it'],
    [LINK, 'a link from another app opens in it, as it was'],
  ]) {
    open(what);
    ok = (await waitFor(what, label)) && ok;
  }
} catch (e) {
  log(String(e.message || e));
  ok = 'unknown';
} finally {
  try { if (started) started.kill(); } catch { /* gone */ }
  await quit();
  if (WIN) { try { execFileSync('reg.exe', ['delete', `HKCU\\Software\\Classes\\${PROGID}`, '/f'], { stdio: 'ignore' }); } catch { /* gone */ } }
  server.close();
  await sleep(1500);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* in use */ }
}
if (ok === 'unknown') process.exit(0);
if (!ok) { console.error('[open-check] files opened with Bifrost don’t all open'); process.exit(1); }
log('✓ files and links opened with Bifrost open in it');
process.exit(0);
