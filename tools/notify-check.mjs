// Checks that a Bifrost build's notifications reach Windows. Starts the build with a fresh profile that lets
// 127.0.0.1 show notifications, on a page (served here) that shows one itself (new Notification) and two
// through its service worker (from the page, and from the worker), then asks Windows which of Bifrost's
// notifications it has (its notification history: what the notification center lists). The portable
// build has no Start menu shortcut, so Windows knows Bifrost only from what Bifrost registers itself
// (src/main/default-browser.js). Before that, it checks what Windows does with a notification from an app
// it doesn't know, and from one it knows from the registry alone, so a CI machine that can't show any
// says so instead of failing. The release workflow runs it on the portable build.
//
//   node tools/notify-check.mjs <BifrostPortable-<v>.zip | a folder with Bifrost.exe> [--timeout=120]
//   node tools/notify-check.mjs --exe=<electron> --app=<checkout>     (a development copy, any system)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, fallback) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : fallback; };
const timeout = Number(opt('timeout', '120')) * 1000;
const log = (m) => console.log('[notify-check] ' + m);
const WIN = process.platform === 'win32';
const AUMID = 'Bifrost.Browser';

function findExe(dir) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  for (const c of [path.join(dir, 'BifrostPortable', 'App', 'Bifrost-' + arch), path.join(dir, 'App', 'Bifrost-' + arch), dir]) {
    if (fs.existsSync(path.join(c, 'Bifrost.exe'))) return path.join(c, 'Bifrost.exe');
  }
  return null;
}

let exe = opt('exe', '');
const appDir = opt('app', '');
if (!exe) {
  let dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '');
  if (fs.statSync(dir).isDirectory() && !findExe(dir)) {
    const zip = fs.readdirSync(dir).find((f) => /^BifrostPortable-.*\.zip$/.test(f));
    if (zip) dir = path.join(dir, zip);
  }
  if (dir.endsWith('.zip')) {
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-notify-'));
    log('unzipping ' + path.basename(dir));
    require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(dir, to);
    dir = to;
  }
  exe = findExe(dir);
  if (!exe) { console.error('[notify-check] no Bifrost.exe in ' + dir); process.exit(2); }
}

// Windows PowerShell (5.1: it can use Windows' own notification classes).
function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 60000 }).trim();
  } catch (e) { return 'powershell failed: ' + String((e && e.stderr) || e.message).trim(); }
}
const WINRT = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
function Count($id) { try { return @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($id)).Count } catch { return 'unknown (' + $_.Exception.Message + ')' } }
function Items($id) { try { return @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($id)) } catch { return @() } }
`;

let platform = 'n/a';
if (WIN) {
  // What Windows does with one from an app it doesn't know, then from one it knows from the registry alone.
  const out = ps(WINRT + `
function Show($id, $what) {
  $x = New-Object Windows.Data.Xml.Dom.XmlDocument
  $x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>Notification check</text><text>$what</text></binding></visual></toast>")
  $t = New-Object Windows.UI.Notifications.ToastNotification $x
  $t.Tag = $what
  try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show($t); "shown" } catch { "refused: " + $_.Exception.Message }
}
$id = 'Bifrost.NotifyCheck'
$k = "HKCU:\\Software\\Classes\\AppUserModelId\\$id"
Remove-Item $k -Recurse -ErrorAction SilentlyContinue
"unknown app: " + (Show $id 'unknown')
Start-Sleep -Seconds 2
"unknown app, in the history: " + (Count $id)
New-Item $k -Force | Out-Null
New-ItemProperty $k -Name DisplayName -Value 'Bifrost check' -Force | Out-Null
"registered app: " + (Show $id 'registered')
Start-Sleep -Seconds 2
"registered app, in the history: " + (Count $id)
Remove-Item $k -Recurse -ErrorAction SilentlyContinue
`);
  for (const l of out.split(/\r?\n/)) log('windows: ' + l);
  const reg = out.match(/registered app, in the history: (\d+)/);
  platform = reg && Number(reg[1]) > 0 ? 'works' : 'none';
  // (Bifrost registers itself when it starts: none from before)
  ps(`Remove-Item 'HKCU:\\Software\\Classes\\AppUserModelId\\${AUMID}' -Recurse -ErrorAction SilentlyContinue`);
}

const WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => e.waitUntil(self.registration.showNotification('Bifrost check', { body: 'From its service worker', tag: 'worker' })
  .then(() => e.source.postMessage('ok'), (err) => e.source.postMessage('err ' + err.message))));
`;
const PAGE = `<!doctype html><meta charset="utf-8"><title>Notification check</title><p>Notification check</p><script>
(async () => {
  const r = { permission: Notification.permission };
  try {
    r.page = await new Promise((res) => {
      const n = new Notification('Bifrost check', { body: 'From the page', tag: 'page' });
      n.onshow = () => res('shown'); n.onerror = () => res('error'); setTimeout(() => res('no answer'), 8000);
    });
  } catch (e) { r.page = 'threw ' + e.message; }
  try {
    await navigator.serviceWorker.register('/check-sw.js');
    const reg = await navigator.serviceWorker.ready;
    r.viaPage = await reg.showNotification('Bifrost check', { body: 'Through its service worker, from the page', tag: 'via-page' }).then(() => 'ok', (e) => 'err ' + e.message);
    r.fromWorker = await new Promise((res) => { navigator.serviceWorker.onmessage = (e) => res(e.data); reg.active.postMessage('show'); setTimeout(() => res('no answer'), 8000); });
    r.listed = (await reg.getNotifications()).map((n) => n.tag);
  } catch (e) { r.swError = String(e); }
  fetch('/result', { method: 'POST', body: JSON.stringify(r) });
})();
</script>`;
let result = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { try { result = JSON.parse(body); } catch { result = { error: 'unreadable result' }; } res.end('ok'); });
    return;
  }
  const sw = req.url === '/check-sw.js';
  res.writeHead(200, { 'content-type': sw ? 'text/javascript' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(sw ? WORKER : PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/check.html`;

// A fresh profile that has been through the welcome page already, and has said yes to this site's notifications.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-notify-profile-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ onboarding: { done: true }, tabs: { restoreOnStartup: 'newtab' } }));
const db = require(path.join(ROOT, 'src', 'main', 'db.js')).open(profile);
db.setSiteSetting('127.0.0.1', 'perm:notifications', 'allow');
db.close();

log(`starting ${exe} on ${url}`);
const args = [...(appDir ? [appDir] : []), `--profile=${profile}`, '--no-update', url];
const child = spawn(exe, args, { stdio: 'inherit' });
child.on('exit', (code) => log('Bifrost exited (' + code + ')'));

const end = Date.now() + timeout;
while (!result && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
log('the page: ' + JSON.stringify(result));
// (a moment for the last one to reach Windows)
await new Promise((r) => setTimeout(r, 3000));
let found = -1;
if (WIN) {
  const out = ps(WINRT + `
"in the history: " + (Count '${AUMID}')
foreach ($t in @(Items '${AUMID}')) { "  " + (($t.Content.GetXml() -replace '<[^>]+>', ' ') -replace '\\s+', ' ').Trim() }
try { $p = Get-ItemProperty 'HKCU:\\Software\\Classes\\AppUserModelId\\${AUMID}'; "registered as: " + $p.DisplayName + ", picture " + $p.IconUri + " (there: " + (Test-Path $p.IconUri) + ")" } catch { "not registered" }
`);
  for (const l of out.split(/\r?\n/)) log('windows: ' + l);
  const m = out.match(/in the history: (\d+)/);
  found = m ? Number(m[1]) : -1;
}
try { child.kill(); } catch { /* gone */ }
if (WIN) { try { execFileSync('taskkill', ['/F', '/T', '/IM', 'Bifrost.exe'], { stdio: 'ignore' }); } catch { /* none left */ } }
server.close();

const pageOk = result && result.permission === 'granted' && result.viaPage === 'ok' && result.fromWorker === 'ok' && JSON.stringify((result.listed || []).sort()) === '["via-page","worker"]';
if (!pageOk) { console.error('[notify-check] the page didn’t get its notifications out: ' + JSON.stringify(result)); process.exit(1); }
if (!WIN) { log('✓ the page’s notifications went out (Windows not asked: not on Windows)'); process.exit(0); }
if (found >= 3) { log(`✓ Windows has Bifrost’s notifications (${found})`); process.exit(0); }
if (platform !== 'works') { log(`(this machine shows no notifications at all, so Bifrost’s can’t be checked here: ${found} of 3)`); process.exit(0); }
console.error(`[notify-check] Windows has ${found} of Bifrost’s 3 notifications, though it shows other apps’`);
process.exit(1);
