// The VPN's WireGuard files (src/main/vpn-conf.js): what's taken and what isn't, WARP's other ports, and what
// isn't sent through the tunnel.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { parseConf, withPort, BYPASS, WARP_PORTS } = require(path.join(ROOT, 'src', 'main', 'vpn-conf.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const throws = (fn, re) => { try { fn(); } catch (e) { assert(re.test(e.message), 'said: ' + e.message); return; } throw new Error('took it'); };

const KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const PEER = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const PROTON = `[Interface]
# Key for Bifrost
PrivateKey = ${KEY}
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# NL-FREE#1
PublicKey = ${PEER}
AllowedIPs = 0.0.0.0/0
Endpoint = 185.107.56.1:51820
`;
const WARP = `[Interface]\r\nPrivateKey = ${KEY}\r\nAddress = 172.16.0.2/32, 2606:4700:110:8a36::1/128\r\nDNS = 1.1.1.1\r\nMTU = 1280\r\n\r\n[Peer]\r\nPublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=\r\nAllowedIPs = 0.0.0.0/0, ::/0\r\nEndpoint = engage.cloudflareclient.com:2408\r\n`;

check('a file from Proton VPN: taken, with its server', () => {
  const r = parseConf(PROTON);
  assert(r.endpoint === '185.107.56.1:51820' && r.addresses.join() === '10.2.0.2/32', JSON.stringify(r));
});
check('a WARP configuration (Windows line ends, IPv6 too): taken', () => {
  const r = parseConf(WARP);
  assert(r.endpoint === 'engage.cloudflareclient.com:2408' && r.addresses.length === 2, JSON.stringify(r));
});
check('an endpoint in IPv6 brackets: taken', () => {
  assert(parseConf(PROTON.replace('185.107.56.1:51820', '[2a07:b944::2:2]:51820')).endpoint === '[2a07:b944::2:2]:51820', 'not taken');
});
check('not WireGuard files: turned away, saying why', () => {
  throws(() => parseConf(''), /PrivateKey/);
  throws(() => parseConf('{"some": "json"}'), /name = value/);
  throws(() => parseConf(PROTON.replace(KEY, 'not-a-key')), /PrivateKey isn’t a WireGuard key/);
  throws(() => parseConf(PROTON.replace(/^Address.*$/m, '')), /no Address/);
  throws(() => parseConf(PROTON.replace(/\[Peer\][\s\S]*$/, '')), /no \[Peer\]/);
  throws(() => parseConf(PROTON.replace(/^Endpoint.*$/m, '')), /Endpoint/);
  throws(() => parseConf(PROTON.replace(/^PublicKey.*$/m, 'PublicKey = abc')), /PublicKey isn’t/);
});
check('WARP on its other ports: only the endpoint’s port changes', () => {
  const c = withPort(WARP, 500);
  assert(/Endpoint = engage\.cloudflareclient\.com:500\r?$/m.test(c), c);
  assert(c.replace(':500', ':2408') === WARP, 'something else changed');
  assert(WARP_PORTS[0] === 2408 && WARP_PORTS.includes(500) && WARP_PORTS.includes(4500), WARP_PORTS.join());
  assert(/Endpoint = \[2606:4700::1\]:1701$/m.test(withPort('[Peer]\nEndpoint = [2606:4700::1]:2408', 1701)), 'IPv6');
});
check('this computer’s network isn’t sent through the tunnel; the rest of the world is', () => {
  for (const r of ['<local>', '192.168.0.0/16', '10.0.0.0/8', '*.local', 'fe80::/10']) assert(BYPASS.split(';').includes(r), r);
  assert(!/\*\.com|0\.0\.0\.0\/0|\*$/.test(BYPASS), BYPASS);
});

console.log(`\nvpn: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
