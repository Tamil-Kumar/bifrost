// The VPN helper on its own, against the real Cloudflare WARP: signs up, starts the tunnel (on WARP's other ports
// if one doesn't answer, and again after a wait), and fetches Cloudflare's trace page through its proxy
// (warp=on when it went through WARP), a 25 MB download and a 25 MB upload, through it and straight. Then takes
// the sign-up off Cloudflare's list. Needs curl.
//   node tools/vpn/check.mjs <bifrost-vpn executable>
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exe = process.argv[2];
const log = (m) => console.log('[vpn-check] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (args) => execFileSync('curl', ['-sS', '--max-time', '40', ...args], { encoding: 'utf8' });
const NUL = process.platform === 'win32' ? 'NUL' : '/dev/null';

function once(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = readline.createInterface({ input: p.stdout });
    rl.once('line', (l) => { rl.close(); try { resolve(JSON.parse(l)); } catch { reject(new Error('not JSON: ' + l)); } });
    p.once('exit', (code) => reject(new Error('exited ' + code)));
    if (input) p.stdin.write(JSON.stringify(input) + '\n');
    p.stdin.end();
  });
}

// The tunnel with this configuration: { proc, socks, hs (seconds to its handshake, or 0), lines }.
async function tunnel(conf, waitMs) {
  const proc = spawn(exe, ['run'], { stdio: ['pipe', 'pipe', 'inherit'] });
  proc.stdin.write(JSON.stringify({ conf }) + '\n');
  const rl = readline.createInterface({ input: proc.stdout });
  const lines = [];
  rl.on('line', (l) => { try { lines.push(JSON.parse(l)); } catch { /* not ours */ } });
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs && !lines.some((o) => o.handshake > 0 || o.error)) await sleep(200);
  const up = lines.find((o) => o.socks);
  const hs = lines.some((o) => o.handshake > 0) ? (Date.now() - t0) / 1000 : 0;
  return { proc, socks: up && up.socks, hs, lines, stop: () => { try { proc.stdin.end(); } catch { /* gone */ } } };
}

let failed = false;
const r = await once(['register']);
if (r.error) { log('✗ sign-up: ' + r.error); process.exit(1); }
log(`signed up: device ${r.id.slice(0, 8)}…, enabled ${r.enabled}, account ${r.account}, ${r.conf.split('\n').find((l) => l.startsWith('Endpoint'))}`);

let t = null;
const tried = [];
for (const [port, wait] of [[2408, 8000], [500, 8000], [1701, 8000], [4500, 8000], [2408, 0], [2408, 12000]]) {
  if (wait === 0) { log('waiting 30 s, then 2408 again'); await sleep(30000); continue; }
  const c = r.conf.replace(/^(Endpoint = [^:]+):\d+/m, `$1:${port}`);
  const x = await tunnel(c, wait);
  const last = x.lines.filter((o) => o.handshake !== undefined).slice(-1)[0];
  tried.push(`${port}: ${x.hs ? 'handshake in ' + x.hs.toFixed(1) + ' s' : 'none (' + JSON.stringify(last) + ')'}`);
  if (x.hs) { t = x; break; }
  x.stop();
}
log('ports: ' + tried.join('; '));
if (!t) { failed = true; log('✗ no handshake on any port'); }
else {
  const proxy = ['--socks5-hostname', t.socks];
  try {
    const trace = curl([...proxy, 'https://www.cloudflare.com/cdn-cgi/trace']);
    const g = (txt, k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(txt) || [])[1];
    const direct = curl(['https://www.cloudflare.com/cdn-cgi/trace']);
    log(`through it: warp=${g(trace, 'warp')}, ip ${g(trace, 'ip')}, ${g(trace, 'colo')}; straight: ip ${g(direct, 'ip')}, warp=${g(direct, 'warp')}`);
    if (g(trace, 'warp') !== 'on') { failed = true; log('✗ not through WARP'); }
  } catch (e) { failed = true; log('✗ trace: ' + e.message.split('\n')[0]); }
  for (const [name, args] of [['through the VPN', proxy], ['straight', []]]) {
    try {
      const [speed, s] = curl([...args, '-o', NUL, '-w', '%{speed_download} %{time_total}', 'https://speed.cloudflare.com/__down?bytes=25000000']).trim().split(' ').map(Number);
      log(`25 MB ${name}: ${(speed * 8 / 1e6).toFixed(0)} Mbit/s (${s.toFixed(1)} s)`);
    } catch (e) { log(`download ${name}: ${e.message.split('\n')[0]}`); }
  }
  const up = path.join(os.tmpdir(), 'bifrost-vpn-check-up.bin');
  fs.writeFileSync(up, Buffer.alloc(25e6, 7));
  for (const [name, args] of [['through the VPN', proxy], ['straight', []]]) {
    try {
      const speed = Number(curl([...args, '-o', NUL, '-w', '%{speed_upload}', '--data-binary', '@' + up, 'https://speed.cloudflare.com/__up']).trim());
      log(`25 MB up ${name}: ${(speed * 8 / 1e6).toFixed(0)} Mbit/s`);
    } catch (e) { log(`upload ${name}: ${e.message.split('\n')[0]}`); }
  }
  t.stop();
}
await sleep(1000);
const u = await once(['unregister'], { id: r.id, token: r.token }).catch((e) => ({ error: e.message }));
log(u.ok ? 'sign-up taken off Cloudflare\'s list' : 'unregister: ' + u.error);
log(failed ? '✗ the VPN helper didn\'t work' : '✓ WARP through the VPN helper');
process.exit(failed ? 1 : 0);
