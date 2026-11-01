'use strict';
// Large site icons for places that show icons big (Speed Dial tiles, the bookmark manager's tiles).
// A tab's favicon is usually 16 or 32 pixels, which looks blurry or blocky when blown up to a tile, so
// Bifrost looks for each site's largest icon: apple-touch-icon, web app manifest icons, sized <link>
// icons, SVG favicons, and every frame of a .ico file. The best one per site is kept in the database.
//   bifrost://<any page>/_/favicon?url=<page address>  ->  the stored image (same origin as the page, so
//                                                          pages can sample its colors), or 404 while a
//                                                          lookup runs in the background
// Lookups happen when a page finishes loading in a normal window (never a private one), and when a tile
// asks for a site that has no icon yet. A failed lookup is retried after a day; icons refresh monthly.
const { EventEmitter } = require('node:events');
const ctx = require('./context');

const MAX_HTML = 640 * 1024;
const MAX_IMAGE = 768 * 1024;
const MAX_MANIFEST = 256 * 1024;
const GOOD_ENOUGH = 144;          // stop looking once an icon this big (or an SVG) is found
const RETRY_MS = 24 * 3600e3;
const REFRESH_MS = 30 * 24 * 3600e3;
const PAGE_COOLDOWN_MS = 10 * 60e3;
const PARALLEL = 3;

const events = new EventEmitter();
const running = new Map();        // host -> Promise
const queue = [];
let active = 0;
const pageSeen = new Map();       // host -> time of the last visit-triggered check

function hostKey(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

// ------------------------------------------------------------------ images
// Returns { mime, width } for the formats sites use for icons, or null. SVG has width 0 ("any size").
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf.length >= 24) return { mime: 'image/png', width: Math.min(buf.readUInt32BE(16), buf.readUInt32BE(20)) };
  if (buf.toString('latin1', 0, 4) === 'GIF8' && buf.length >= 10) return { mime: 'image/gif', width: Math.min(buf.readUInt16LE(6), buf.readUInt16LE(8)) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', width: Math.min(buf.readUInt16BE(i + 5), buf.readUInt16BE(i + 7)) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' && buf.length >= 30) {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { mime: 'image/webp', width: Math.min(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { mime: 'image/webp', width: Math.min((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1) }; }
    if (kind === 'VP8X') return { mime: 'image/webp', width: Math.min(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)) };
    return null;
  }
  if (buf.readUInt16LE(0) === 0 && (buf.readUInt16LE(2) === 1 || buf.readUInt16LE(2) === 2)) {
    // .ico: the directory lists every frame; Chromium draws the frame that best fits, so its largest counts.
    const n = buf.readUInt16LE(4);
    if (!n || n > 64 || buf.length < 6 + n * 16) return null;
    let best = 0;
    for (let k = 0; k < n; k++) {
      const e = 6 + k * 16;
      const w = buf[e] || 256, h = buf[e + 1] || 256;
      const size = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
      if (off + size > buf.length || size === 0) continue;
      // PNG frames carry their real size (256+ px frames say 0 in the directory).
      if (buf[off] === 0x89 && buf.toString('latin1', off + 1, off + 4) === 'PNG') best = Math.max(best, Math.min(buf.readUInt32BE(off + 16), buf.readUInt32BE(off + 20)));
      else best = Math.max(best, Math.min(w, h));
    }
    return best ? { mime: 'image/x-icon', width: best } : null;
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', width: 0 };
  return null;
}

const quality = (info) => (!info ? -1 : info.width === 0 ? 400 : Math.min(info.width, 512));

// ----------------------------------------------------------------- network
async function readCapped(res, max) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max || !res.body) { try { await res.body?.cancel(); } catch { /* closed */ } return null; }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { reader.cancel().catch(() => {}); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Icons are fetched in a session of their own: in memory (no cookies sent or kept), without extensions
// (their webRequest hooks and service workers must not see, or wait on, these requests).
let iconSession = null;
function fetchSession() {
  if (iconSession) return iconSession;
  if (!ctx.mainSession) return null;
  const { session } = require('electron');
  iconSession = session.fromPartition('bifrost-icons');
  try { iconSession.setUserAgent(ctx.mainSession.getUserAgent()); } catch { /* default */ }
  try { require('./sessions').applyProxy(iconSession); } catch { /* system proxy */ }
  return iconSession;
}

async function fetchCapped(url, max, accept) {
  const ses = fetchSession();
  if (!ses || !/^https?:/i.test(url)) return null;
  try {
    const res = await ses.fetch(url, {
      redirect: 'follow', signal: AbortSignal.timeout(10000),
      headers: { accept: accept || '*/*' },
    });
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* closed */ } return null; }
    const body = await readCapped(res, max);
    return body ? { body, url: res.url || url, type: res.headers.get('content-type') || '' } : null;
  } catch { return null; }
}

// --------------------------------------------------------------- discovery
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decodeAttr = (v) => String(v || '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, k) => ENTITIES[k]);

function attrs(tag) {
  const out = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  re.exec(tag); // the tag name
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

// "16x16 32x32" -> 32; "any" -> 0 (scalable)
function declaredSize(sizes, type, href) {
  const s = String(sizes || '').toLowerCase();
  if (s.includes('any') || /svg/.test(type || '') || /\.svg(\?|#|$)/i.test(href || '')) return 0;
  let best = -1;
  for (const m of s.matchAll(/(\d+)\s*x\s*(\d+)/g)) best = Math.max(best, Math.min(Number(m[1]), Number(m[2])));
  return best;
}

// Candidates from <link> tags (from the page DOM, or parsed from fetched HTML) plus the manifest.
function linkCandidates(links, base) {
  const out = [];
  let manifest = '';
  for (const l of links || []) {
    const rel = String(l.rel || '').toLowerCase().split(/\s+/);
    let href;
    try { href = new URL(l.href, base).href; } catch { continue; }
    if (!/^https?:/i.test(href)) continue;
    if (rel.includes('manifest')) { manifest = manifest || href; continue; }
    if (rel.includes('mask-icon')) continue; // single-color Safari outlines
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon') && !rel.includes('fluid-icon')) continue;
    let size = declaredSize(l.sizes, l.type, href);
    if (size < 0) size = touch ? 180 : /\.ico(\?|#|$)/i.test(href) ? 32 : 16;
    out.push({ url: href, size, why: touch ? 'apple-touch-icon' : 'link' });
  }
  return { list: out, manifest };
}

async function manifestCandidates(url) {
  const got = await fetchCapped(url, MAX_MANIFEST, 'application/manifest+json, application/json');
  if (!got) return [];
  let data;
  try { data = JSON.parse(got.body.toString('utf8').replace(/^﻿/, '')); } catch { return []; }
  const out = [];
  for (const ic of Array.isArray(data && data.icons) ? data.icons.slice(0, 30) : []) {
    if (!ic || typeof ic.src !== 'string') continue;
    let href;
    try { href = new URL(ic.src, got.url).href; } catch { continue; }
    const purpose = String(ic.purpose || 'any').toLowerCase();
    if (!/\bany\b/.test(purpose) && /monochrome/.test(purpose)) continue;
    let size = declaredSize(ic.sizes, ic.type, href);
    if (size < 0) size = 96;
    // Maskable-only icons are full-bleed squares meant to be cropped: fine, but a plain icon is nicer.
    out.push({ url: href, size: /\bany\b/.test(purpose) ? size : Math.round(size * 0.7), why: 'manifest' });
  }
  return out;
}

async function htmlLinks(pageUrl) {
  const got = await fetchCapped(pageUrl, MAX_HTML, 'text/html,application/xhtml+xml');
  if (!got || !/html|xml|^$/i.test(got.type)) return { links: [], base: pageUrl };
  const text = got.body.toString('utf8');
  const end = text.search(/<\/head>/i);
  const head = end >= 0 ? text.slice(0, end) : text;
  let base = got.url;
  const b = /<base\b[^>]*>/i.exec(head);
  if (b) { const a = attrs(b[0]); if (a.href) { try { base = new URL(a.href, got.url).href; } catch { /* keep */ } } }
  const links = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.rel && a.href) links.push({ rel: a.rel, href: a.href, sizes: a.sizes, type: a.type });
    if (links.length > 60) break;
  }
  return { links, base };
}

// Tries the candidates biggest-first and keeps the best image that downloads and decodes.
async function pickBest(candidates) {
  const seen = new Set();
  const sorted = candidates.filter((c) => (seen.has(c.url) ? false : seen.add(c.url)))
    .sort((a, b) => (b.size === 0 ? 300 : b.size) - (a.size === 0 ? 300 : a.size));
  let best = null;
  let tries = 0;
  for (const c of sorted) {
    if (tries >= 6) break;
    if (best && quality(best) >= GOOD_ENOUGH) break;
    if (best && c.size > 0 && c.size <= best.width) continue;
    tries++;
    const got = await fetchCapped(c.url, MAX_IMAGE, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5');
    if (!got) continue;
    const info = sniff(got.body);
    if (!info) continue;
    if (!best || quality(info) > quality(best)) best = { data: got.body, mime: info.mime, width: info.width, source: got.url };
  }
  return best;
}

async function lookup(host, pageUrl, domLinks) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  let found = linkCandidates(domLinks || [], pageUrl);
  if (!domLinks) {
    const { links, base } = await htmlLinks(pageUrl);
    found = linkCandidates(links, base);
  }
  const list = found.list.slice();
  if (found.manifest) list.push(...(await manifestCandidates(found.manifest)));
  list.push({ url: origin + '/apple-touch-icon.png', size: 180, why: 'default' }, { url: origin + '/favicon.ico', size: 32, why: 'default' });
  const best = await pickBest(list);
  const db = ctx.db;
  if (!db) return null;
  const cur = db.siteIcon(host);
  if (best && (!cur || !cur.data || quality(best) >= quality({ width: cur.width, mime: cur.mime }) || Date.now() - cur.updated > REFRESH_MS)) {
    db.setSiteIcon(host, best);
    events.emit('changed', { host });
  } else if (!best && (!cur || !cur.data)) {
    db.setSiteIcon(host, null); // remember the miss, so tiles don't trigger a lookup on every load
  }
  return best;
}

function schedule(host, pageUrl, domLinks) {
  if (running.has(host)) return running.get(host);
  const p = new Promise((resolve) => queue.push({ host, pageUrl, domLinks, resolve }));
  running.set(host, p);
  pump();
  return p;
}

function pump() {
  while (active < PARALLEL && queue.length) {
    const job = queue.shift();
    active++;
    lookup(job.host, job.pageUrl, job.domLinks)
      .catch((e) => { console.warn('[icons] ' + job.host + ': ' + e.message); return null; })
      .then((r) => { active--; running.delete(job.host); job.resolve(r); pump(); });
  }
}

// ------------------------------------------------------------------- entry
const DOM_SCRIPT = `(() => {
  const out = [];
  for (const l of document.querySelectorAll('link[rel][href]')) {
    const rel = (l.getAttribute('rel') || '').toLowerCase();
    if (!/(^|\\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|fluid-icon|manifest)(\\s|$)/.test(rel)) continue;
    out.push({ rel, href: l.href, sizes: l.getAttribute('sizes') || '', type: l.getAttribute('type') || '' });
    if (out.length > 60) break;
  }
  return out;
})()`;

// A page finished loading in a normal window: refresh its site's icon when it's missing, small or old.
async function fromPage(guest) {
  if (!guest || guest.isDestroyed() || !ctx.db) return;
  const url = guest.getURL();
  const host = hostKey(url);
  if (!host) return;
  const now = Date.now();
  if (now - (pageSeen.get(host) || 0) < PAGE_COOLDOWN_MS) return;
  pageSeen.set(host, now);
  const cur = ctx.db.siteIcon(host);
  if (cur && cur.data && quality({ width: cur.width }) >= GOOD_ENOUGH && now - cur.updated < REFRESH_MS) return;
  let links = [];
  try { links = await guest.executeJavaScriptInIsolatedWorld(1207, [{ code: DOM_SCRIPT }]); } catch { links = []; }
  if (guest.isDestroyed()) return;
  schedule(host, url, Array.isArray(links) ? links : []);
}

// For bifrost://*/_/favicon?url=…   (&cached=1: answer from what's stored, never look anything up)
function serve(requestUrl) {
  let pageUrl = '';
  let cachedOnly = false;
  try { const q = new URL(requestUrl).searchParams; pageUrl = q.get('url') || ''; cachedOnly = q.get('cached') === '1'; } catch { /* bad request */ }
  const host = hostKey(pageUrl);
  // "No icon" is an empty image rather than a 404, so pages fall back quietly (no console errors).
  const none = () => new Response('', { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-bifrost-icon': 'none' } });
  if (!host || !ctx.db) return none();
  const row = ctx.db.siteIcon(host);
  const now = Date.now();
  const stale = !row || (row.data ? now - row.updated > REFRESH_MS : now - row.updated > RETRY_MS);
  if (stale && !cachedOnly) schedule(host, /^https?:/i.test(pageUrl) ? pageUrl : 'https://' + host + '/', null);
  if (!row || !row.data) return none();
  return new Response(Buffer.from(row.data), {
    status: 200,
    headers: {
      'content-type': row.mime || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
      // SVG icons are drawn as images (no scripts run), but keep them from doing anything if opened directly.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

function onChange(fn) { events.on('changed', fn); }

module.exports = { fromPage, serve, onChange, sniff, linkCandidates, declaredSize, hostKey, schedule };
