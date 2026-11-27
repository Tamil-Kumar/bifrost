// A stand-in for the VPN helper (tools/vpn) in the e2e tests: the same commands and lines, a real SOCKS5
// proxy, but no tunnel: what it's asked to connect to it connects to straight (names in FAKE_VPN_MAP,
// "host=ip:port,..." , where they point), and writes down (FAKE_VPN_LOG, one JSON object a line).
//   FAKE_VPN_CTRL  a JSON file read as it starts: { silentPorts: endpoint ports it gives no handshake for (WARP's
//                  next port, tried), failRegister: the sign-up fails }
import net from 'node:net';
import fs from 'node:fs';
import readline from 'node:readline';

const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const note = (o) => { if (process.env.FAKE_VPN_LOG) fs.appendFileSync(process.env.FAKE_VPN_LOG, JSON.stringify({ t: Date.now(), pid: process.pid, ...o }) + '\n'); };
const MAP = Object.fromEntries(String(process.env.FAKE_VPN_MAP || '').split(',').filter(Boolean).map((p) => p.split('=')));
const KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const cmd = process.argv[2];
let ctrl = {};
try { ctrl = JSON.parse(fs.readFileSync(process.env.FAKE_VPN_CTRL, 'utf8')); } catch { /* none */ }

if (cmd === 'register') {
  note({ register: true });
  if (ctrl.failRegister) { say({ error: 'Cloudflare turned the sign-up away (429 Too Many Requests): try again later' }); process.exit(1); }
  say({ conf: `[Interface]\nPrivateKey = ${KEY}\nAddress = 172.16.0.2/32\nDNS = 1.1.1.1\nMTU = 1280\n\n[Peer]\nPublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = engage.cloudflareclient.com:2408\n`, id: 'fake-device', token: 'fake-token' });
  process.exit(0);
}
if (cmd === 'unregister') {
  const rl = readline.createInterface({ input: process.stdin });
  rl.once('line', (l) => { note({ unregister: JSON.parse(l).id }); say({ ok: true }); process.exit(0); });
} else if (cmd === 'run') {
  const at = process.argv[3] === '--listen' ? process.argv[4] : '127.0.0.1:0';
  const [host, port] = at.split(':');
  const server = net.createServer((c) => socks(c));
  server.listen(Number(port), host, () => {
    say({ listening: `${host}:${server.address().port}` });
    const rl = readline.createInterface({ input: process.stdin });
    let got = false;
    rl.on('line', (l) => {
      if (got) return;
      got = true;
      const conf = JSON.parse(l).conf;
      const ep = (/^\s*Endpoint\s*=\s*(\S+)/mi.exec(conf) || [])[1] || '';
      note({ run: ep, listen: `${host}:${server.address().port}` });
      say({ socks: `${host}:${server.address().port}`, endpoint: ep.replace(/^engage\.cloudflareclient\.com/, '162.159.192.1') });
      const quiet = (ctrl.silentPorts || []).map(String).includes(ep.split(':').pop());
      let rx = 0, tx = 0;
      setInterval(() => say({ handshake: quiet ? 0 : Math.floor(Date.now() / 1000), rx: (rx += 1200), tx: (tx += 400) }), 700);
    });
    rl.on('close', () => process.exit(0));
  });
  server.on('error', (e) => { say({ error: 'the proxy: ' + e.message }); process.exit(1); });
}

function socks(c) {
  let buf = Buffer.alloc(0);
  let stage = 0;
  c.on('error', () => {});
  c.on('data', function onData(d) {
    buf = Buffer.concat([buf, d]);
    if (stage === 0) {
      if (buf.length < 2 || buf.length < 2 + buf[1]) return;
      buf = buf.subarray(2 + buf[1]);
      c.write(Buffer.from([5, 0]));
      stage = 1;
    }
    if (stage === 1) {
      if (buf.length < 5) return;
      let host, off;
      if (buf[3] === 1) { if (buf.length < 10) return; host = [...buf.subarray(4, 8)].join('.'); off = 8; }
      else if (buf[3] === 3) { const n = buf[4]; if (buf.length < 5 + n + 2) return; host = buf.subarray(5, 5 + n).toString(); off = 5 + n; }
      else { c.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      const port = buf.readUInt16BE(off);
      const rest = buf.subarray(off + 2);
      stage = 2;
      c.removeListener('data', onData);
      note({ connect: `${host}:${port}` });
      const to = MAP[host] || `${host}:${port}`;
      const [th, tp] = to.split(':');
      const r = net.connect(Number(tp), th, () => {
        c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (rest.length) r.write(rest);
        c.pipe(r); r.pipe(c);
      });
      r.on('error', () => { try { c.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); } catch { /* gone */ } });
    }
  });
}
