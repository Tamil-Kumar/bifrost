// How fast the VPN helper is, against the real Cloudflare WARP: for each variant (a helper, and settings for it in
// its environment), how long sites take to answer through it (fresh connections, names looked up again and not),
// downloads near and far (one connection and several), an upload, and the helper's processor time; and the same
// straight, without the VPN. Variants take turns, round by round, so a network that gets slower or faster for a
// while doesn't favour one. Needs curl.
// Compares builds of the helper (an old one and a new one, say).
//   node tools/vpn/bench.mjs <rounds> name=<exe>[:ENV=value,ENV=value] ...
import { spawn, execFileSync, execFile } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const log = (m) => console.log('[vpn-bench] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NUL = process.platform === 'win32' ? 'NUL' : '/dev/null';
const rounds = Number(process.argv[2]) || 1;
const variants = process.argv.slice(3).map((a) => {
  const [name, rest] = a.split(/=(.*)/s);
  const [exe, envs] = rest.split(/:(?=[A-Z_]+=)/);
  const env = {};
  for (const kv of (envs || '').split(',').filter(Boolean)) { const [k, v] = kv.split(/=(.*)/s); env[k] = v; }
  return { name, exe, env };
});
// (a,b,c in one variant's environment: NAME=a+b+c)
for (const v of variants) for (const k of Object.keys(v.env)) v.env[k] = v.env[k].replaceAll('+', ',');

const HOSTS = ['www.google.com', 'en.wikipedia.org', 'github.com', 'www.amazon.com', 'www.microsoft.com', 'www.apple.com',
  'www.bbc.co.uk', 'www.reddit.com', 'www.nytimes.com', 'www.yahoo.com', 'stackoverflow.com', 'www.ebay.com',
  'www.cnn.com', 'www.twitch.tv', 'www.spotify.com', 'www.adobe.com'];
const DOWN = [
  ['Cloudflare, 50 MB', 'https://speed.cloudflare.com/__down?bytes=50000000', 40],
  ['near (Ashburn), 100 MB', 'https://ash-speed.hetzner.com/100MB.bin', 40],
  ['far (Germany), 100 MB', 'https://fsn1-speed.hetzner.com/100MB.bin', 30],
  ['farther (Singapore), 100 MB', 'https://sin-speed.hetzner.com/100MB.bin', 30],
];
const UP = path.join(os.tmpdir(), 'bifrost-bench-up.bin');
fs.writeFileSync(UP, Buffer.alloc(25e6, 7));

const curlArgs = (proxy) => (proxy ? ['--socks5-hostname', proxy] : []);
function curl(args, timeout = 40) {
  return new Promise((resolve) => {
    execFile('curl', ['-sS', '--max-time', String(timeout), '-o', NUL, ...args], { encoding: 'utf8' }, (err, out, errOut) => {
      resolve({ ok: !err, out: (out || '').trim(), err: err ? (errOut || err.message).split('\n')[0] : '' });
    });
  });
}
const median = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function once(exe, args, input, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    const rl = readline.createInterface({ input: p.stdout });
    rl.once('line', (l) => { rl.close(); try { resolve(JSON.parse(l)); } catch { reject(new Error('not JSON: ' + l)); } });
    p.once('exit', (code) => reject(new Error('exited ' + code)));
    if (input) p.stdin.write(JSON.stringify(input) + '\n');
    p.stdin.end();
  });
}

async function tunnel(v, conf, waitMs) {
  const proc = spawn(v.exe, ['run'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...v.env } });
  proc.stdin.write(JSON.stringify({ conf }) + '\n');
  const rl = readline.createInterface({ input: proc.stdout });
  const lines = [];
  rl.on('line', (l) => { try { lines.push(JSON.parse(l)); } catch { /* not ours */ } });
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs && !lines.some((o) => o.handshake > 0 || o.error)) await sleep(100);
  const up = lines.find((o) => o.socks);
  const hs = lines.some((o) => o.handshake > 0) ? (Date.now() - t0) / 1000 : 0;
  return { proc, socks: up && up.socks, hs, lines, stop: () => { try { proc.stdin.end(); } catch { /* gone */ } } };
}

// UDP datagrams the system couldn't take in (IPv4; Windows: netstat's "Receive Errors"), so far.
function udpErrors() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-s', '-p', 'udp'], { encoding: 'utf8' });
      return Number((/Receive Errors\s*=\s*(\d+)/.exec(out) || [])[1]);
    }
    const f = fs.readFileSync('/proc/net/snmp', 'utf8').split('\n').filter((l) => l.startsWith('Udp:'));
    const keys = f[0].split(/\s+/), vals = f[1].split(/\s+/);
    return Number(vals[keys.indexOf('RcvbufErrors')]);
  } catch { return NaN; }
}

function cpuSeconds(pid) {
  try {
    if (process.platform === 'win32') {
      return Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds`], { encoding: 'utf8' }).trim());
    }
    const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return (Number(f[11]) + Number(f[12])) / 100;
  } catch { return NaN; }
}

// One set of measurements, through this proxy (or straight): { name: number }.
async function measure(proxy) {
  const r = {};
  let bytes = 0; // (moved, for the processor time per GB)
  for (const pass of ['first', 'again']) {
    const ttfb = [], conn = [];
    for (const h of HOSTS) {
      const x = await curl([...curlArgs(proxy), '-w', '%{time_connect} %{time_appconnect} %{time_starttransfer}', `https://${h}/`], 15);
      if (!x.ok && !x.out) continue;
      const [c, a, s] = x.out.split(' ').map(Number);
      if (s > 0) { ttfb.push(s * 1000); conn.push(a * 1000); }
    }
    r[`sites answer (median ms, names looked up ${pass === 'first' ? 'first time' : 'again'})`] = median(ttfb);
    r[`connected + TLS (median ms, ${pass})`] = median(conn);
  }
  for (const [name, url, t] of DOWN) {
    const x = await curl([...curlArgs(proxy), '-w', '%{speed_download} %{size_download}', url], t);
    const [bps, size] = x.out.split(' ').map(Number);
    bytes += size || 0;
    r[`down ${name} (Mbit/s)`] = bps > 0 ? (bps * 8) / 1e6 : NaN;
    if (!x.ok) log(`  (${name}: ${x.err})`);
  }
  {
    const t0 = Date.now();
    const xs = await Promise.all([0, 1, 2, 3].map(() => curl([...curlArgs(proxy), '-w', '%{size_download}', 'https://speed.cloudflare.com/__down?bytes=50000000'], 40)));
    const got = xs.reduce((s, x) => s + (Number(x.out) || 0), 0);
    bytes += got;
    r['down Cloudflare, 4 at once × 50 MB (Mbit/s)'] = (got * 8) / 1e6 / ((Date.now() - t0) / 1000);
  }
  {
    const x = await curl([...curlArgs(proxy), '-w', '%{speed_upload} %{size_upload}', '--data-binary', '@' + UP, 'https://speed.cloudflare.com/__up'], 40);
    const [bps, size] = x.out.split(' ').map(Number);
    bytes += size || 0;
    r['up Cloudflare, 25 MB (Mbit/s)'] = bps > 0 ? (bps * 8) / 1e6 : NaN;
    if (!x.ok) log(`  (upload: ${x.err})`);
  }
  Object.defineProperty(r, 'bytes', { value: bytes });
  return r;
}

const first = variants[0];
const reg = await once(first.exe, ['register']);
if (reg.error) { log('✗ sign-up: ' + reg.error); process.exit(1); }
log(`signed up; ${reg.conf.split('\n').find((l) => l.startsWith('Endpoint'))}`);
let conf = null;
for (const port of [2408, 500, 1701, 4500]) {
  const c = reg.conf.replace(/^(Endpoint = [^:]+):\d+/m, `$1:${port}`);
  const t = await tunnel(first, c, 8000);
  t.stop();
  log(`port ${port}: ${t.hs ? 'handshake in ' + t.hs.toFixed(1) + ' s' : 'no answer'}`);
  if (t.hs) { conf = c; break; }
}
if (!conf) { log('✗ no port answered'); process.exit(1); }
await sleep(1500);

const results = {}; // variant name → [result per round]
const add = (name, r) => (results[name] ||= []).push(r);
for (let round = 0; round < rounds; round++) {
  const order = [{ name: 'straight' }, ...variants];
  const shift = round % order.length;
  for (const v of [...order.slice(shift), ...order.slice(0, shift)]) {
    if (v.name === 'straight') {
      log(`round ${round + 1}: straight`);
      const u0 = udpErrors();
      const r = await measure(null);
      r['UDP datagrams dropped'] = udpErrors() - u0;
      add('straight', r);
      continue;
    }
    const t = await tunnel(v, conf, 15000);
    if (!t.hs) { log(`round ${round + 1}: ${v.name}: ✗ no handshake ${JSON.stringify(t.lines.slice(-2))}`); t.stop(); continue; }
    log(`round ${round + 1}: ${v.name} (${JSON.stringify(v.env)}), handshake in ${t.hs.toFixed(1)} s`);
    const cpu0 = cpuSeconds(t.proc.pid);
    const u0 = udpErrors();
    const r = await measure(t.socks);
    r['UDP datagrams dropped'] = udpErrors() - u0;
    const cpu1 = cpuSeconds(t.proc.pid);
    const gb = r.bytes / 1e9;
    r['helper processor seconds per GB'] = gb > 0 ? (cpu1 - cpu0) / gb : NaN;
    t.stop();
    add(v.name, r);
    await sleep(1000);
  }
}
await once(first.exe, ['unregister'], { id: reg.id, token: reg.token }).catch(() => {});

// Medians over the rounds: one row a measurement, one column a variant.
const names = Object.keys(results);
const rows = [...new Set(names.flatMap((n) => results[n].flatMap((r) => Object.keys(r))))];
const cell = (n, k) => { const m = median(results[n].map((r) => r[k])); return Number.isFinite(m) ? (m >= 100 ? m.toFixed(0) : m.toFixed(1)) : '–'; };
const w = Math.max(...rows.map((k) => k.length));
log('medians over ' + rounds + ' round(s):');
console.log('| ' + 'measurement'.padEnd(w) + ' | ' + names.map((n) => n.padStart(9)).join(' | ') + ' |');
for (const k of rows) console.log('| ' + k.padEnd(w) + ' | ' + names.map((n) => cell(n, k).padStart(Math.max(9, n.length))).join(' | ') + ' |');
fs.writeFileSync(path.join(os.tmpdir(), 'bifrost-bench.json'), JSON.stringify(results, null, 1));
