// How long Bifrost takes to start: launched on its own (no test driver), `runs` times with a profile that's
// been used before. Prints the median time until its window was shown, its UI had loaded and the first page
// was in (startup-main.js: seen from outside, so any version can be measured), then each of the marks it
// prints itself (main/timing.js) with the time between them.
//   xvfb-run -a node tests/bench/startup.mjs [runs] [--fresh] [--history=<pages>] [--tabs=<n>] [--env=NAME=value] [--root=<dir>] [--each]
// --root=<another checkout of Bifrost>: to compare two versions on the same machine, one after the other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = process.env.ELECTRON || '/home/claude/cache/electron-linux/electron';
const args = process.argv.slice(2);
const ROOT = path.resolve((args.find((a) => a.startsWith('--root=')) || '').slice(7) || path.join(HERE, '..', '..'));
const runs = Number(args.find((a) => /^\d+$/.test(a)) || 7);
const fresh = args.includes('--fresh');
const tabs = Number((args.find((a) => a.startsWith('--tabs=')) || '').slice(7) || 0);
const label = (args.find((a) => a.startsWith('--label=')) || '').slice(8);
const history = Number((args.find((a) => a.startsWith('--history=')) || '').slice(10) || 0);
const env = Object.fromEntries(args.filter((a) => a.startsWith('--env=')).map((a) => a.slice(6).split('=')));

// A local page to open (nothing from the network in the numbers).
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end('<!doctype html><title>Bench</title><body style="font:20px sans-serif"><h1>Bench page ' + req.url + '</h1><p>' + 'Lorem ipsum dolor sit amet. '.repeat(200) + '</p>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const url = (args.find((a) => a.startsWith('--url=')) || '').slice(6) || base + '/first';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-bench-'));
function once(extra = [], more = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ELECTRON, ['-r', path.join(HERE, 'startup-main.js'), ROOT, '--profile=' + dir, ...extra], { env: { ...process.env, BIFROST_TIMING: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env, ...more } });
    let out = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timed out\n' + out.slice(-2000))); }, 60000);
    const on = (d) => { out += d; };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', () => {
      clearTimeout(t);
      const seen = /\[startup\] (\{.*\})/.exec(out);
      if (!seen) return reject(new Error('no result\n' + out.slice(-2000)));
      const m = /\[timing\] (\[.*\])/.exec(out);
      resolve({ seen: JSON.parse(seen[1]), marks: m ? JSON.parse(m[1]) : [] });
    });
  });
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// A profile that's been used: started once (its lists built, its settings written), with tabs to bring back.
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboarding: { done: true } }));
if (!fresh) {
  // (it stays open until the ad blocker's lists are built and kept, as they are in a profile in use: a start
  // that finds them missing builds them behind the scenes, and is quicker than a real one)
  const built = () => { const found = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (/^(engine|domains)-[0-9a-f]+\.bin$/.test(e.name)) found.push(e.name.split('-')[0]); } }; try { walk(dir); } catch { /* not there yet */ } return found.includes('engine') && found.includes('domains'); };
  await once([url], { BENCH_STAY_MS: '3000' });
  for (let i = 0; i < 4 && !built(); i++) await once([], { BENCH_STAY_MS: '6000' });
  if (!built()) console.log('(the ad blocker’s lists weren’t kept in the profile: these starts build them)');
  // (a browser that's been used: that many pages in its history)
  if (history) {
    const db = createRequire(import.meta.url)(path.join(ROOT, 'src', 'main', 'db.js')).open(dir);
    db.db.exec('BEGIN');
    const now = Date.now();
    for (let i = 0; i < history; i++) db.addVisit({ url: `https://site${i % 900}.example.com/section/${i % 37}/article-${i}?ref=${i % 11}`, title: `Article ${i}: something worth reading about topic ${i % 53}`, time: now - i * 60000 });
    db.db.exec('COMMIT');
    try { db.db.close(); } catch { /* closed */ }
  }
  if (tabs) {
    const f = path.join(dir, 'session.json');
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const w = Object.values(s.windows)[0];
    const ws = w.ui.workspaces[0];
    const first = w.ui.tabs[0];
    for (let i = 1; i < tabs; i++) w.ui.tabs.push({ ...first, id: first.id + '-' + i, url: base + '/tab' + i, title: 'Tab ' + i, history: null });
    if (ws && Array.isArray(ws.tabIds)) for (let i = 1; i < tabs; i++) ws.tabIds.push(first.id + '-' + i);
    fs.writeFileSync(f, JSON.stringify(s));
    try { fs.rmSync(f + '.bak'); } catch { /* none */ }
  }
}
const all = [];
for (let i = 0; i < runs; i++) {
  if (fresh) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboarding: { done: true } })); }
  all.push(await once(fresh || !tabs ? (fresh ? [url] : []) : []));
}
const names = all[0].marks.map((m) => m[0]);
console.log((label ? label + ': ' : '') + runs + ' starts' + (fresh ? ' (a new profile each)' : '') + (tabs ? ', ' + tabs + ' tabs' : '') + (history ? ', ' + history + ' pages in history' : ''));
const seen = (k) => String(median(all.map((r) => r.seen[k]))).padStart(5);
console.log('  window shown ' + seen('shown') + ' ms   UI loaded ' + seen('ui') + ' ms   first page in ' + seen('page') + ' ms');
// (--each: every start's, to see how far apart they are)
if (args.includes('--each')) for (const r of all) console.log('    ' + String(r.seen.shown).padStart(5) + '  ' + String(r.seen.ui).padStart(5) + '  ' + String(r.seen.page).padStart(5));
let prev = 0;
for (const n of names) {
  const v = median(all.map((r) => (r.marks.find((m) => m[0] === n) || [n, NaN])[1]));
  console.log('  ' + n.padEnd(18) + String(v).padStart(6) + ' ms' + ('  +' + (v - prev)).padStart(8));
  prev = v;
}
server.close();
fs.rmSync(dir, { recursive: true, force: true });
