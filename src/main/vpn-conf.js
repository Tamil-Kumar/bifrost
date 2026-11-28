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
  const out = { privateKey: false, addresses: [], peers: [], key: '' };
  t.split('\n').forEach((raw, i) => {
    // (a [Peer]'s first comment: the server's name, in Proton VPN's files: "# JP-FREE#3")
    const comment = /^\s*#\s*(\S.*?)\s*$/.exec(raw);
    if (comment && section === 'peer') { const p = out.peers[out.peers.length - 1]; if (!p.name) p.name = comment[1]; }
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) return;
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      if (section === 'peer') out.peers.push({ publicKey: false, endpoint: '', name: '' });
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`line ${i + 1} isn’t “name = value”`);
    const name = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    const key = (v) => { const b = Buffer.from(v, 'base64'); return b.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(v); };
    if (section === 'interface') {
      if (name === 'privatekey') { if (!key(value)) throw new Error('its PrivateKey isn’t a WireGuard key'); out.privateKey = true; out.key = value; }
      if (name === 'address') out.addresses.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (section === 'peer') {
      const p = out.peers[out.peers.length - 1];
      if (name === 'publickey') { if (!key(value)) throw new Error('a PublicKey isn’t a WireGuard key'); p.publicKey = value; }
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
  const server = out.peers[0].name;
  return {
    endpoint: out.peers[0].endpoint, addresses: out.addresses, server: /^[\w.#-]{2,40}$/.test(server) ? server : '',
    // (the same file again, or the same key to the same server: one location, not two)
    same: out.key + ' ' + out.peers[0].publicKey + ' ' + out.peers[0].endpoint,
  };
}

// A country's code (ISO 3166-1), if it is one.
let regions = null;
function isCountry(code) {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ' || code === 'EU' || code === 'UN') return false;
  try { regions = regions || new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return true; }
  const name = regions.of(code);
  return !!name && name !== code;
}

// Where a WireGuard file probably puts you (ISO code, '' if it can't tell), from its server's name or its file's:
// Proton VPN's "JP-FREE#3", "US-NY#12", "CH-US#1" (Secure Core: through Switzerland to the US), Mullvad's
// "jp-tyo-wg-001". Until Bifrost has connected through it and seen for itself (the helper's "seen").
const SECURE_CORE = new Set(['CH', 'IS', 'SE']);
function guessCountry(server, fileName) {
  const proton = /^([A-Z]{2})(?:-([A-Z]{2,}))?#\d+$/.exec(String(server || '').toUpperCase().replace(/-FREE(?=#)/, ''));
  if (proton) {
    const [, a, b] = proton;
    if (b && SECURE_CORE.has(a) && b.length === 2 && isCountry(b)) return b;
    return isCountry(a) ? a : '';
  }
  const f = String(fileName || '').toUpperCase();
  const mullvad = /(?:^|[-_ ])([A-Z]{2})-[A-Z]{3}-WG-\d+/.exec(f);
  if (mullvad && isCountry(mullvad[1])) return mullvad[1];
  const named = /(?:^|PROTON(?:VPN)?[-_ ])([A-Z]{2})(?:-FREE)?[-_#]\d+(?:$|[-_ .])/.exec(f) || /^(?:PROTON(?:VPN)?|WG)[-_ ]([A-Z]{2})(?:$|[-_ #])/.exec(f);
  if (named && isCountry(named[1])) return named[1];
  return '';
}

// A site as the VPN's exceptions keep it: its host name, lower case, without "www.". '' if it isn't one.
function siteOf(input) {
  let host = String(input || '').trim().toLowerCase();
  if (!host) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) { try { host = new URL(host).hostname; } catch { return ''; } }
  host = host.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '').split('/')[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) return '';
  return host;
}

// The proxy's bypass rules: the local network's (BYPASS), and each site of yours with its subdomains.
function bypassRules(sites) {
  const extra = [...new Set((sites || []).map(siteOf).filter(Boolean))].flatMap((h) => [h, '*.' + h]);
  return [BYPASS, ...extra].join(';');
}

// WARP's configuration with its endpoint on another of WARP's ports.
function withPort(conf, port) {
  return conf.replace(/^(\s*Endpoint\s*=\s*)(\[[^\]]+\]|[^\s:]+):\d+/mi, (_m, pre, host) => `${pre}${host}:${port}`);
}

module.exports = { parseConf, withPort, BYPASS, WARP_PORTS, guessCountry, isCountry, siteOf, bypassRules };
