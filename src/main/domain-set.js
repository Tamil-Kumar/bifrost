'use strict';
// The domain list (HaGeZi's: domain-list.js) as Bifrost keeps it: a sorted table of its domains' hashes, which
// it reads back as it starts by pointing at the file's bytes (a filter engine with the same rules was 11 MB to
// read and 40 ms of work before the first page could start, every start), and which answers for a request in
// well under a microsecond: its host, and each domain it's under, looked up in the table.
//
// The list is whole domains: ||domain^ blocks that domain and everything under it, @@||domain^ lets it through
// (HaGeZi's allowlists, Bifrost's domains-keep.txt). A rule with a * in it (a few of the allowlists' have one)
// is matched as adblock syntax matches it, against the address. adblock.js decides the rest (the site you're
// on, a company's own services). Built off the main thread (adblock-worker.js), kept in the profile.
//
// The file: 'BFDS', the format's version, the number of domains, the length of the rest; the domains' hashes
// (two 32-bit hashes each, sorted); then, as JSON, the exceptions and the rules with a * in them.
const MAGIC = 0x53444642;   // 'BFDS'
const VERSION = 1;
const HEAD = 16;

// Two independent 32-bit hashes of s from position i on (64 bits together: no two of the list's few hundred
// thousand domains, nor any host looked up, are likely to share both).
function h1(s, i) {
  let h = 0x811c9dc5;
  for (; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function h2(s, i) {
  let h = 0x9747b28c;
  for (; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995); h ^= h >>> 15; }
  return h >>> 0;
}

const RULE = /^(@@)?\|\|([a-z0-9*_][a-z0-9*_.-]*)\^$/;

// A rule with a * as adblock syntax reads it: || where the host (or a domain it's under) starts, * anything,
// ^ a separator (or the end).
function patternSource(rule) {
  const body = rule.split('*').map((p) => p.replace(/[.+?${}()|[\]\\/-]/g, '\\$&')).join('.*');
  return '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#@]*\\.)?' + body + '(?:[^a-z0-9_.%-]|$)';
}
// (the domain such a rule is about, for adblock.js's "the site you're on": what follows its last *)
const ruleHost = (rule) => rule.slice(rule.lastIndexOf('*') + 1).replace(/^[.-]+/, '');

// The list's text (adblock syntax) → the table, as an ArrayBuffer. Lines that aren't whole-domain rules are
// left out; how many there were is in the JSON part (skipped).
function build(text) {
  const block = new Set();
  const allow = new Set();
  const blockWild = [], allowWild = [];
  let skipped = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim().toLowerCase();
    if (!line || line[0] === '!' || line[0] === '[' || line[0] === '#') continue;
    const m = RULE.exec(line);
    if (!m) { skipped++; continue; }
    const d = m[2];
    if (d.includes('*')) (m[1] ? allowWild : blockWild).push(d);
    else (m[1] ? allow : block).add(d);
  }
  const doms = [...block];
  const n = doms.length;
  const a = new Uint32Array(n), b = new Uint32Array(n), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) { a[i] = h1(doms[i], 0); b[i] = h2(doms[i], 0); order[i] = i; }
  order.sort((x, y) => (a[x] - a[y]) || (b[x] - b[y]));
  const json = Buffer.from(JSON.stringify({ allow: [...allow], allowWild, blockWild, skipped }), 'utf8');
  const out = new ArrayBuffer(HEAD + n * 8 + json.length);
  const head = new Uint32Array(out, 0, 4);
  head[0] = MAGIC; head[1] = VERSION; head[2] = n; head[3] = json.length;
  const pairs = new Uint32Array(out, HEAD, n * 2);
  for (let i = 0; i < n; i++) { pairs[2 * i] = a[order[i]]; pairs[2 * i + 1] = b[order[i]]; }
  new Uint8Array(out, HEAD + n * 8).set(json);
  return out;
}

class DomainSet {
  // bytes: what build() made (an ArrayBuffer, or a view of one: a file read back).
  constructor(bytes) {
    let u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    if (!(u8 instanceof Uint8Array) || u8.byteLength < HEAD) throw new Error('not a domain list');
    // (the table is read in place: it has to start on a 4-byte boundary)
    if (u8.byteOffset % 4) u8 = u8.slice();
    const head = new Uint32Array(u8.buffer, u8.byteOffset, 4);
    if (head[0] !== MAGIC || head[1] !== VERSION) throw new Error('not a domain list of this version');
    const n = head[2];
    if (u8.byteLength !== HEAD + n * 8 + head[3]) throw new Error('a domain list cut short');
    this.size = n;
    this.pairs = new Uint32Array(u8.buffer, u8.byteOffset + HEAD, n * 2);
    const extra = JSON.parse(Buffer.from(u8.buffer, u8.byteOffset + HEAD + n * 8, head[3]).toString('utf8'));
    this.allow = new Set(extra.allow || []);
    this.allowWild = (extra.allowWild || []).map((r) => new RegExp(patternSource(r), 'i'));
    this.blockWild = (extra.blockWild || []).map((r) => ({ re: new RegExp(patternSource(r), 'i'), host: ruleHost(r) }));
  }

  has(x, y) {
    const p = this.pairs;
    let lo = 0, hi = (p.length >> 1) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const a = p[2 * mid], b = p[2 * mid + 1];
      if (a < x || (a === x && b < y)) lo = mid + 1;
      else if (a > x || b > y) hi = mid - 1;
      else return true;
    }
    return false;
  }

  // The rule that stops a request to this host (the listed domain it is or is under), '' when none does or
  // an exception lets it through. host: lower case; url: the request's address (for rules with a *).
  match(host, url = '') {
    if (!host) return '';
    let rule = '';
    for (let i = 0; ;) {
      if (this.has(h1(host, i), h2(host, i))) { rule = host.slice(i); break; }
      const j = host.indexOf('.', i);
      if (j < 0) break;
      i = j + 1;
    }
    if (!rule && this.blockWild.length) {
      const u = url || 'https://' + host + '/';
      const w = this.blockWild.find((r) => r.re.test(u));
      if (w) rule = w.host || host;
    }
    if (!rule) return '';
    return this.excepted(host, url) ? '' : rule;
  }

  excepted(host, url) {
    if (this.allow.size) {
      for (let i = 0; ;) {
        if (this.allow.has(i ? host.slice(i) : host)) return true;
        const j = host.indexOf('.', i);
        if (j < 0) break;
        i = j + 1;
      }
    }
    if (this.allowWild.length) {
      const u = url || 'https://' + host + '/';
      if (this.allowWild.some((re) => re.test(u))) return true;
    }
    return false;
  }
}

const load = (bytes) => new DomainSet(bytes);

module.exports = { build, load, DomainSet, VERSION };
