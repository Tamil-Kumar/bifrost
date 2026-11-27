'use strict';
// The VPN's WireGuard files and proxy rules (main/vpn.js), apart from Electron: checked by tests/unit/vpn.test.mjs.

// The ports WARP answers on: the next one tried when one gets no answer (networks that block 2408).
const WARP_PORTS = [2408, 500, 1701, 4500];
// Not through the tunnel: this computer (always), names with no dot, and this network's own addresses and
// names (a router's page, a printer, a NAS; 100.64/10 is Tailscale's).
const BYPASS = ['<local>', '*.local', '*.lan', '*.home.arpa', '*.internal', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', '100.64.0.0/10', 'fc00::/7', 'fe80::/10'].join(';');

// A WireGuard file (wg-quick's format) checked before it's kept: what's wrong with it, or what it says.
function parseConf(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n');
  let section = '';
  const out = { privateKey: false, addresses: [], peers: [] };
  t.split('\n').forEach((raw, i) => {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) return;
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      if (section === 'peer') out.peers.push({ publicKey: false, endpoint: '' });
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`line ${i + 1} isn’t “name = value”`);
    const name = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    const key = (v) => { const b = Buffer.from(v, 'base64'); return b.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(v); };
    if (section === 'interface') {
      if (name === 'privatekey') { if (!key(value)) throw new Error('its PrivateKey isn’t a WireGuard key'); out.privateKey = true; }
      if (name === 'address') out.addresses.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (section === 'peer') {
      const p = out.peers[out.peers.length - 1];
      if (name === 'publickey') { if (!key(value)) throw new Error('a PublicKey isn’t a WireGuard key'); p.publicKey = true; }
      if (name === 'endpoint') p.endpoint = value;
    }
  });
  if (!out.privateKey) throw new Error('it has no PrivateKey (not a WireGuard file?)');
  if (!out.addresses.length) throw new Error('it has no Address');
  if (!out.peers.length) throw new Error('it has no [Peer]');
  for (const p of out.peers) {
    if (!p.publicKey) throw new Error('a [Peer] has no PublicKey');
    if (!/^(\[[0-9a-f:.]+\]|[^\s:]+):\d{1,5}$/i.test(p.endpoint)) throw new Error('a [Peer] has no Endpoint (host:port)');
  }
  return { endpoint: out.peers[0].endpoint, addresses: out.addresses };
}

// WARP's configuration with its endpoint on another of WARP's ports.
function withPort(conf, port) {
  return conf.replace(/^(\s*Endpoint\s*=\s*)(\[[^\]]+\]|[^\s:]+):\d+/mi, (_m, pre, host) => `${pre}${host}:${port}`);
}

module.exports = { parseConf, withPort, BYPASS, WARP_PORTS };
