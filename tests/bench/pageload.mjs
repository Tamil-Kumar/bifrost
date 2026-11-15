// How long a page takes to load in Bifrost: a local page with a couple of hundred requests over several origins
// (scripts, styles, pictures, fetches, frames; some of them to ad servers the blocker stops), loaded `runs` times
// in a tab. Prints the median time to the page's load event for each way of running it:
//   as it comes · with "Block YouTube ads" off · with the ad blocker off · with nothing of Bifrost's on requests
//   xvfb-run -a node tests/bench/pageload.mjs [runs] [--only=default,bare] [--no-ads] [--root=<dir>]
// --only also takes the ones that take the request hooks apart, to see what each costs: before-only, no-received,
// no-send, nosession, trivial. --no-ads leaves the ad servers' requests out of the page (to compare with the
// blocker off: blocked, they cost nothing; let through, they fail slowly).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = process.env.ELECTRON || '/home/claude/cache/electron-linux/electron';
const args = process.argv.slice(2);
// (--root=<another checkout of Bifrost>: to compare two versions on the same machine, one after the other)
const ROOT = path.resolve((args.find((a) => a.startsWith('--root=')) || '').slice(7) || path.join(HERE, '..', '..'));
const runs = Number(args.find((a) => /^\d+$/.test(a)) || 15);
const only = ((args.find((a) => a.startsWith('--only=')) || '').slice(7) || '').split(',').filter(Boolean);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const servers = [];
const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (type, body) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(body); };
  if (u.pathname.endsWith('.js')) return send('text/javascript', `window.__n = (window.__n || 0) + 1; for (let i = 0, s = 0; i < 20000; i++) s += i;`);
  if (u.pathname.endsWith('.css')) return send('text/css', `.c${u.searchParams.get('i') || 0} { color: #123; margin: 1px; }`);
  if (u.pathname.endsWith('.png')) return send('image/png', PNG);
  if (u.pathname.endsWith('.json')) return send('application/json', JSON.stringify({ ok: true, data: 'x'.repeat(2000) }));
  if (u.pathname === '/frame') return send('text/html', `<!doctype html><title>Frame</title><script>parent.postMessage('frame', '*')</script>${Array.from({ length: 6 }, (_, i) => `<script src="/f${i}.js"></script><img src="/f${i}.png">`).join('')}`);
  if (u.pathname === '/page') {
    const o = (i) => 'http://127.0.0.1:' + servers[i % servers.length].address().port;
    const parts = [];
    for (let i = 0; i < 24; i++) parts.push(`<link rel="stylesheet" href="${o(i)}/s${i}.css?i=${i}">`);
    for (let i = 0; i < 60; i++) parts.push(`<script src="${o(i)}/a${i}.js"${i % 3 ? ' async' : ''}></script>`);
    for (let i = 0; i < 60; i++) parts.push(`<img src="${o(i)}/i${i}.png" width="8" height="8">`);
    for (let i = 0; i < 4; i++) parts.push(`<iframe src="${o(i + 1)}/frame" width="100" height="40"></iframe>`);
    // (what the ad blocker stops: they never leave; left out with --no-ads, to compare with the blocker off)
    if (u.searchParams.get('ads') !== '0') for (let i = 0; i < 12; i++) parts.push(`<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt${i}.js"></script><img src="https://www.google-analytics.com/collect?v=1&i=${i}" width="1" height="1">`);
    parts.push(`<script>window.__frames = 0; addEventListener('message', () => window.__frames++); Promise.all(Array.from({ length: 30 }, (_, i) => fetch('${o(0)}/d' + i + '.json').then((r) => r.json()))).then(() => { window.__fetched = true; });</script>`);
    return send('text/html', `<!doctype html><html><head><title>Bench page</title></head><body><h1>Bench</h1><p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(300)}</p>${parts.join('\n')}</body></html>`);
  }
  res.writeHead(404); res.end();
};
for (let i = 0; i < 5; i++) { const s = http.createServer(handler); await new Promise((r) => s.listen(0, '127.0.0.1', r)); servers.push(s); }
const url = 'http://127.0.0.1:' + servers[0].address().port + '/page' + (args.includes('--no-ads') ? '?ads=0&' : '?');

const MODES = {
  default: { label: 'as it comes', settings: {} },
  noyt: { label: '"Block YouTube ads" off', settings: { privacy: { adblock: { youtubeSkip: false } } } },
  noblock: { label: 'the ad blocker off', settings: { privacy: { adblock: { enabled: false } } } },
  'before-only': { label: '(only the first of the three hooks)', settings: { privacy: { adblock: { youtubeSkip: false } } }, mode: 'before-only', extra: true },
  'no-received': { label: '(without the hook on answers)', settings: { privacy: { adblock: { youtubeSkip: false } } }, mode: 'no-received', extra: true },
  'no-send': { label: '(without the hook on headers sent)', settings: { privacy: { adblock: { youtubeSkip: false } } }, mode: 'no-send', extra: true },
  nosession: { label: '(no protocol session on the tab)', settings: { appearance: { webTheme: 'system' }, privacy: { adblock: { youtubeSkip: false } } }, extra: true },
  trivial: { label: '(one hook that does nothing)', settings: { privacy: { adblock: { youtubeSkip: false } } }, mode: 'trivial', extra: true },
  bare: { label: 'nothing of Bifrost’s on requests', settings: { privacy: { adblock: { enabled: false, youtubeSkip: false } } }, mode: 'bare' },
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function run(key) {
  const m = MODES[key];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-bench-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(Object.assign({ onboarding: { done: true } }, m.settings)));
  return new Promise((resolve, reject) => {
    const p = spawn(ELECTRON, ['-r', path.join(HERE, 'pageload-main.js'), ROOT, '--profile=' + dir, url + 'first'], { env: { ...process.env, BENCH_URL: url, BENCH_RUNS: String(runs), BENCH_MODE: m.mode || '', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
    let out = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(key + ' timed out\n' + out.slice(-1500))); }, 180000);
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', () => {
      clearTimeout(t);
      fs.rmSync(dir, { recursive: true, force: true });
      const r = /\[bench\] (\[.*\])/.exec(out);
      if (!r) return reject(new Error(key + ': no result\n' + out.slice(-1500)));
      resolve(JSON.parse(r[1]));
    });
  });
}
console.log(`${runs} loads each (median, ms)`);
for (const key of Object.keys(MODES)) {
  if (only.length ? !only.includes(key) : MODES[key].extra) continue;
  const r = await run(key);
  console.log('  ' + MODES[key].label.padEnd(36) + ' load ' + String(Math.round(median(r.map((x) => x.load)))).padStart(5) + '   DOM ready ' + String(Math.round(median(r.map((x) => x.dcl)))).padStart(5) + '   first byte ' + String(Math.round(median(r.map((x) => x.first)))).padStart(4) + '   (' + median(r.map((x) => x.resources)) + ' requests, ' + median(r.map((x) => x.frames)) + ' frames)');
}
for (const s of servers) s.close();
