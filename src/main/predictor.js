'use strict';
// Faster page loads, the way Chrome's loading predictor does it: Bifrost learns which other servers each
// site pulls its files from (CDNs, fonts, APIs) and, the moment you start going to that site, opens
// connections to them (DNS, TCP and TLS) in parallel with the page itself, instead of one by one as the
// page asks for them. It also connects ahead when you press a link or pick a launcher result.
// What's learned stays in memory and in the profile (kv 'predictor'), host names only, never full URLs.
const ctx = require('./context');

const MAX_SITES = 400;       // sites remembered
const MAX_ORIGINS = 8;       // servers remembered per site
const MIN_HITS = 2;          // a server must have been used on two visits to be preconnected
const learned = new Map();   // site host -> Map(origin -> { hits, at })
const pageOf = new Map();    // webContents id -> { host, origins: Set } for the page being loaded
let saveTimer = null;
let loaded = false;

function load() {
  if (loaded || !ctx.db) return;
  loaded = true;
  const saved = ctx.db.kvGet('predictor', null);
  if (!saved || typeof saved !== 'object') return;
  for (const [host, origins] of Object.entries(saved)) {
    const m = new Map();
    for (const [o, v] of Object.entries(origins || {})) if (v && typeof v.hits === 'number') m.set(o, v);
    if (m.size) learned.set(host, m);
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const [host, m] of learned) out[host] = Object.fromEntries(m);
    try { ctx.db.kvSet('predictor', out); } catch { /* best effort */ }
  }, 5000);
}

const originOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

function preconnect(ses, url, sockets = 1) {
  const o = originOf(url);
  if (!o || !ses || typeof ses.preconnect !== 'function') return;
  try { ses.preconnect({ url: o, numSockets: sockets }); } catch { /* ignore */ }
}

// A page's main request: connect to the servers that site is known to use.
function onNavigate(ses, wcId, url) {
  load();
  const host = hostOf(url);
  if (!host) return;
  // Remember what this load of the page uses (to learn from), keyed by tab.
  // Loads of tabs that went away or went quiet count as finished.
  for (const [id, p] of pageOf) if (Date.now() - p.at > 20000) finish(id);
  if (wcId != null) {
    finish(wcId);
    pageOf.set(wcId, { host, origins: new Set(), at: Date.now() });
  }
  const m = learned.get(host);
  if (!m) return;
  const best = [...m.entries()].filter(([o, v]) => v.hits >= MIN_HITS && o !== originOf(url)).sort((a, b) => b[1].hits - a[1].hits).slice(0, MAX_ORIGINS);
  for (const [o] of best) preconnect(ses, o, 1);
}

// Every other request: note which servers the page being loaded uses (during its first 15 seconds).
function onRequest(d) {
  if (d.webContentsId == null || d.resourceType === 'mainFrame') return;
  const p = pageOf.get(d.webContentsId);
  if (!p || Date.now() - p.at > 15000) return;
  const o = originOf(d.url);
  if (!o || hostOf(o) === p.host || p.origins.has(o) || p.origins.size >= 40) return;
  p.origins.add(o);
  learn(p.host, o);
}

// One page load of a site used this server.
function learn(host, origin) {
  let m = learned.get(host);
  if (!m) {
    if (learned.size >= MAX_SITES) learned.delete(learned.keys().next().value);
    m = new Map();
  } else learned.delete(host);
  learned.set(host, m);   // most recently used last
  const v = m.get(origin) || { hits: 0, at: 0 };
  v.hits = Math.min(v.hits + 1, 50);
  v.at = Date.now();
  m.set(origin, v);
  // Keep the most used (and recent) ones.
  if (m.size > MAX_ORIGINS * 3) {
    const keep = [...m.entries()].sort((a, b) => b[1].hits - a[1].hits || b[1].at - a[1].at).slice(0, MAX_ORIGINS * 2);
    m.clear();
    for (const [k, x] of keep) m.set(k, x);
  }
  saveSoon();
}

// A page load is over (the tab navigated again or went quiet): stop noting what it uses.
function finish(wcId) { pageOf.delete(wcId); }

function attach(ses, hub) {
  hub.before.push((d) => {
    if (d.resourceType === 'mainFrame') onNavigate(ses, d.webContentsId, d.url);
    else onRequest(d);
  });
}

function forget() { learned.clear(); pageOf.clear(); try { ctx.db.kvSet('predictor', {}); } catch { /* ignore */ } }

module.exports = { attach, preconnect, finish, forget, _learned: learned };
