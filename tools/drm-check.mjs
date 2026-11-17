// Checks that protected (Widevine) video plays in a Bifrost build: starts it with a fresh profile on
// tests/site/drm.html (served here, on 127.0.0.1, which counts as a secure site), which plays Google's
// Widevine test stream and posts back what happened. Then starts it again with that profile, Widevine in it
// now, as every start after the first is: the page has to play at once there too (Bifrost doesn't wait for
// Widevine's update check then: main/drm.js), and how long Bifrost took to start is printed. The release
// workflow runs it on the portable build.
//
//   node tools/drm-check.mjs <BifrostPortable-<v>.zip | a folder with Bifrost.exe> [--timeout=180]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const timeout = Number((process.argv.find((a) => a.startsWith('--timeout=')) || '--timeout=180').split('=')[1]) * 1000;
const log = (m) => console.log('[drm-check] ' + m);

function findExe(dir) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  for (const c of [path.join(dir, 'BifrostPortable', 'App', 'Bifrost-' + arch), path.join(dir, 'App', 'Bifrost-' + arch), dir]) {
    if (fs.existsSync(path.join(c, 'Bifrost.exe'))) return path.join(c, 'Bifrost.exe');
  }
  return null;
}

let dir = path.resolve(target || '');
if (fs.statSync(dir).isDirectory() && !findExe(dir)) {
  const zip = fs.readdirSync(dir).find((f) => /^BifrostPortable-.*\.zip$/.test(f));
  if (zip) dir = path.join(dir, zip);
}
if (dir.endsWith('.zip')) {
  const to = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-drm-'));
  log('unzipping ' + path.basename(dir));
  require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(dir, to);
  dir = to;
}
const exe = findExe(dir);
if (!exe) { console.error('[drm-check] no Bifrost.exe in ' + dir); process.exit(2); }

const page = fs.readFileSync(path.join(ROOT, 'tests', 'site', 'drm.html'));
let result = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { try { result = JSON.parse(body); } catch { result = { ok: false, error: 'unreadable result' }; } res.end('ok'); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/drm.html`;

// A fresh profile that has been through the welcome page already.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-drm-profile-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ onboarding: { done: true }, tabs: { restoreOnStartup: 'newtab' } }));

async function play(what, env = {}) {
  result = null;
  log(`starting ${exe} on ${url} (${what})`);
  const began = Date.now();
  const child = spawn(exe, [`--profile=${profile}`, '--no-update', url], { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code) => log('Bifrost exited (' + code + ')'));
  const end = Date.now() + timeout;
  while (!result && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
  const took = Date.now() - began;
  try { child.kill(); } catch { /* gone */ }
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/F', '/T', '/IM', 'Bifrost.exe'], { stdio: 'ignore' }); } catch { /* none left */ } }
  await new Promise((r) => setTimeout(r, 1500));
  if (!result) { console.error(`[drm-check] no answer from the page in ${timeout / 1000} s (${what})`); process.exit(1); }
  log(JSON.stringify(result));
  if (!result.ok) { console.error(`[drm-check] protected video didn’t play (${what}): ` + (result.step || '') + ' ' + (result.error || '')); process.exit(1); }
  log(`✓ Widevine video played (${what}: ${result.width}x${result.height}, ${Number(result.played).toFixed(1)} s; ${(took / 1000).toFixed(1)} s from the start)`);
}

await play('the first start, which installs Widevine');
await play('a start with Widevine installed', { BIFROST_TIMING: '1' });
server.close();
process.exit(0);
