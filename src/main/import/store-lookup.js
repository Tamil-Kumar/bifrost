'use strict';
// Finding a Firefox add-on's Chrome version on the Chrome Web Store by its name, for the add-ons Bifrost
// doesn't already know (import/extensions.js has a list of the popular ones). The store's search page is
// read for its results (links to /detail/<name>/<id>), in the store's order, and the first few whose names
// are the add-on's are checked against their own pages. A result is "exact" when the names are the same,
// and only a suggestion otherwise. Nothing here installs anything.
const ctx = require('../context');

const testing = process.env.BIFROST_TEST === '1';
const base = () => (testing && process.env.BIFROST_STORE_BASE) || 'https://chromewebstore.google.com';
const cache = new Map();   // normalized name -> { at, result }
const TTL = 30 * 60e3;

async function get(url, ms = 9000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const ses = ctx.mainSession;
    const opts = { signal: ac.signal, headers: { 'Accept-Language': 'en-US,en;q=0.8' }, cache: 'no-store' };
    const res = ses && typeof ses.fetch === 'function' ? await ses.fetch(url, opts) : await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.text()).slice(0, 4_000_000);
  } finally { clearTimeout(timer); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
// For comparing names: case, accents, ™ and punctuation don't count.
const norm = (s) => decode(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The results on a search page, in order: { slug, id }.
function results(html) {
  const out = [];
  const seen = new Set();
  const re = /detail\\?\/([^/"'\\\s?#<>]{1,160})\\?\/([a-p]{32})\b/g;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { /* as is */ }
    out.push({ slug, id: m[2] });
  }
  return out;
}

// An extension's name from its store page.
function titleOf(html) {
  const m = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)
    || /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m ? decode(m[1]).replace(/\s*[-–]\s*Chrome Web Store\s*$/i, '').trim() : '';
}

const same = (a, b) => a === b;
const close = (a, b) => a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');

// The Chrome version of an add-on called `name`: { id, name, exact } or null. Never throws.
async function find(name) {
  const want = norm(name);
  if (!want || (testing && !process.env.BIFROST_STORE_BASE)) return null;
  const hit = cache.get(want);
  if (hit && Date.now() - hit.at < TTL) return hit.result;
  let result = null;
  try {
    const list = results(await get(`${base()}/search/${encodeURIComponent(name)}?hl=en`));
    for (const c of list.slice(0, 4)) {
      const fromSlug = norm(c.slug.replace(/-/g, ' '));
      if (!close(fromSlug, want)) continue;
      let title = '';
      try { title = titleOf(await get(`${base()}/detail/${encodeURIComponent(c.slug)}/${c.id}?hl=en`)); } catch { /* go by the link */ }
      const t = norm(title) || fromSlug;
      if (!close(t, want)) continue;
      result = { id: c.id, name: title || name, exact: same(t, want) };
      break;
    }
  } catch (e) {
    console.warn('[import] Chrome Web Store lookup for ' + JSON.stringify(name) + ': ' + e.message);
    return null;   // (not cached: it may work next time)
  }
  cache.set(want, { at: Date.now(), result });
  return result;
}

// Several at once, a few at a time.
async function findAll(names, { concurrency = 3 } = {}) {
  const out = new Map();
  const queue = [...new Set(names)];
  const worker = async () => { while (queue.length) { const n = queue.shift(); out.set(n, await find(n)); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

module.exports = { find, findAll, results, titleOf, norm };
