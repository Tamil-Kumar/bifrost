'use strict';
// Built-in ad and tracker blocking (Ghostery's engine with EasyList, EasyPrivacy and uBlock Origin lists).
// Network blocking runs in the main process; element hiding and scriptlets are injected by a preload.
const { app, ipcMain, net, webContents: WC } = require('electron');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ctx = require('./context');

// YouTube. Its pages get no page scripts from the lists unless you ask for them (privacy.adblock.youtubeFilters):
// with them YouTube can stop loading at its grey placeholders, so by default its video ads are skipped
// instead (preload/adblock.js), its own requests are left alone, and only other sites' ads and trackers on
// it are blocked. youtube.test is the stand-in the tests use (youtube.com is HTTPS-only in Chromium).
const TEST = process.env.BIFROST_TEST === '1';
const YT_SITE = TEST ? /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtube\.test)$/i : /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/i;
const YT_OWN_URL = TEST
  ? /^(https?|wss?):\/\/([^/?#@]*\.)?(youtube\.com|youtube-nocookie\.com|youtubekids\.com|googlevideo\.com|ytimg\.com|ggpht\.com|youtube\.test)(:\d+)?([/?#]|$)/i
  : /^(https?|wss?):\/\/([^/?#@]*\.)?(youtube\.com|youtube-nocookie\.com|youtubekids\.com|googlevideo\.com|ytimg\.com|ggpht\.com)(:\d+)?([/?#]|$)/i;
const isYouTube = (host) => !!host && YT_SITE.test(host);
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

// Stand-ins for what a filter redirects (an ad script that pages call into, a tracking pixel…), served
// from here: a redirect to a data: URL, the engine's way, fails in Electron for anything but a page.
// The random part of the address keeps pages from probing for them.
const RES_SCHEME = 'bifrost-res';
const RES_TOKEN = crypto.randomBytes(9).toString('hex');

// The start every scriptlet the engine assembles has (see assembleScript in the engine); in a bundle the
// shared state is declared once, around them all.
const SCRIPTLET_PREFIX = "if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }";

const BUNDLED = path.join(__dirname, '..', '..', 'assets', 'adblock');
const PRELOAD = path.join(__dirname, '..', 'preload', 'adblock.js');
const REMOTE = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/';
const FILTER_REV = 2;
const CATEGORIES = { ads: 'Ads', tracking: 'Trackers', annoyances: 'Annoyances', cookieNotices: 'Cookie notices' };

let Blocker = null; // ElectronBlocker class, loaded lazily (half a megabyte of code)
function blockerModule() {
  if (!Blocker) Blocker = require('../vendor/adblocker/index.js');
  return Blocker;
}

class AdBlock extends EventEmitter {
  constructor() {
    super();
    this.engine = null;
    this.engineKey = '';
    this.loading = null;
    this.counts = new Map();   // webContents id -> blocked count for the current page
    this.pages = new Map();    // webContents id -> top-level page URL
    this.total = 0;
    this.sessions = new Set();
    this.emitTimers = new Map();
    this.updateTimer = null;
    this.compiles = new Map();  // scriptlet text -> whether it parses
  }

  get settings() { return ctx.settings.get('privacy.adblock'); }
  get dir() { return path.join(app.getPath('userData'), 'adblock'); }

  init() {
    this.total = ctx.db.kvGet('adblock.total', 0);
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => this.onCosmetics(event, url, msg));
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => true);
    // Element hiding and scriptlets for a frame that's starting (synchronous: they must run before the
    // page's own scripts), then extra hiding rules as the page's DOM grows. See preload/adblock.js.
    ipcMain.on('bifrost-adblock:start', (event, url, isTop) => {
      let out = null;
      try { out = this.cosmeticsFor(event, url, { first: true, isTop: !!isTop }); } catch (e) { console.warn('[adblock] cosmetics', e.message); }
      event.returnValue = out;
    });
    ipcMain.handle('bifrost-adblock:start-frame', (event, url) => {
      try { return this.cosmeticsFor(event, url, { first: true, isTop: false }); } catch { return null; }
    });
    ipcMain.handle('bifrost-adblock:features', (event, url, features) => {
      const r = this.cosmeticsFor(event, url, { first: false, features: features || {} });
      return r ? r.styles : null;
    });
    ctx.settings.on('changed', ({ path: p }) => {
      if (!p || p.startsWith('privacy.adblock')) {
        const key = this.wantedKey();
        if (key !== this.engineKey && this.settings.enabled) this.load().catch((e) => console.error('[adblock]', e));
      }
    });
    if (this.settings.enabled) this.load().catch((e) => console.error('[adblock] load', e));
    this.scheduleUpdate();
  }

  // ----------------------------------------------------------------- engine
  wantedKey() {
    const s = this.settings;
    const cats = Object.keys(CATEGORIES).filter((c) => s.lists[c]);
    const custom = crypto.createHash('sha1').update(s.customFilters || '').digest('hex').slice(0, 10);
    const stamp = ctx.db.kvGet('adblock.listsUpdated', 0);
    // FILTER_REV: bump when the worker changes which filters it keeps (see adblock-worker.js).
    return `${cats.join('+')}|c${s.cosmetic ? 1 : 0}|${custom}|${stamp}|${blockerModule().ENGINE_VERSION || 0}|r${FILTER_REV}`;
  }

  listText(cat) {
    const updated = path.join(this.dir, 'lists', cat + '.txt');
    if (fs.existsSync(updated)) return fs.readFileSync(updated, 'utf8');
    return zlib.gunzipSync(fs.readFileSync(path.join(BUNDLED, cat + '.txt.gz'))).toString('utf8');
  }

  resourcesText() {
    const updated = path.join(this.dir, 'lists', 'resources.json');
    if (fs.existsSync(updated)) return fs.readFileSync(updated, 'utf8');
    return zlib.gunzipSync(fs.readFileSync(path.join(BUNDLED, 'resources.json.gz'))).toString('utf8');
  }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const key = this.wantedKey();
      const cacheFile = path.join(this.dir, 'engine-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.bin');
      const { ElectronBlocker } = blockerModule();
      let engine = null;
      if (fs.existsSync(cacheFile)) {
        try { engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cacheFile))); } catch { engine = null; }
      }
      if (!engine) {
        const s = this.settings;
        const text = Object.keys(CATEGORIES).filter((c) => s.lists[c]).map((c) => this.listText(c)).join('\n') + '\n' + (s.customFilters || '');
        const buf = await this.buildInWorker(text, this.resourcesText(), s.cosmetic);
        engine = ElectronBlocker.deserialize(new Uint8Array(buf));
        fs.mkdirSync(this.dir, { recursive: true });
        for (const f of fs.readdirSync(this.dir)) if (/^engine-.*\.bin$/.test(f)) fs.rmSync(path.join(this.dir, f), { force: true });
        fs.writeFileSync(cacheFile, Buffer.from(buf));
      }
      this.engine = engine;
      this.engineKey = key;
      this.emit('ready');
      return engine;
    })().finally(() => {
      this.loading = null;
      // Settings changed while this engine was being built (new filters, lists): build again.
      if (this.settings.enabled && this.wantedKey() !== this.engineKey) setImmediate(() => this.load().catch((e) => console.error('[adblock]', e)));
    });
    return this.loading;
  }

  buildInWorker(text, resources, cosmetic) {
    return new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, 'adblock-worker.js'), { workerData: { text, resources, cosmetic } });
      w.once('message', (m) => { w.terminate(); m.ok ? resolve(m.buffer) : reject(new Error(m.error)); });
      w.once('error', reject);
    });
  }

  // Fetches fresh lists from the filter mirror, then rebuilds the engine.
  async updateLists() {
    const s = ctx.settings.get('privacy.adblock');
    const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLED, 'lists.json'), 'utf8'));
    const out = path.join(this.dir, 'lists');
    fs.mkdirSync(out, { recursive: true });
    const fetchText = async (rel) => {
      const r = await net.fetch(REMOTE + rel, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
      return r.text();
    };
    for (const [cat, files] of Object.entries(manifest.categories)) {
      if (!s.lists[cat] && fs.existsSync(path.join(out, cat + '.txt'))) continue;
      const texts = [];
      for (const f of files) texts.push(await fetchText(f));
      fs.writeFileSync(path.join(out, cat + '.txt'), texts.join('\n'));
    }
    fs.writeFileSync(path.join(out, 'resources.json'), await fetchText('ublock-origin/resources.json'));
    ctx.db.kvSet('adblock.listsUpdated', Date.now());
    await this.load();
    return { updated: Date.now() };
  }

  scheduleUpdate() {
    clearTimeout(this.updateTimer);
    const hours = Math.max(1, ctx.settings.get('privacy.adblock.updateHours') || 24);
    const last = ctx.db.kvGet('adblock.listsUpdated', 0);
    const due = Math.max(60e3, last + hours * 3600e3 - Date.now());
    this.updateTimer = setTimeout(() => {
      if (this.settings.enabled) this.updateLists().catch((e) => console.warn('[adblock] list update failed:', e.message)).finally(() => this.scheduleUpdate());
      else this.scheduleUpdate();
    }, Math.min(due, 2 ** 31 - 1));
  }

  // --------------------------------------------------------------- sessions
  attach(ses, hub) {
    this.sessions.add(ses);
    try { if (!ses.protocol.isProtocolHandled(RES_SCHEME)) ses.protocol.handle(RES_SCHEME, (req) => this.serveResource(req)); } catch (e) { console.warn('[adblock] resources', e.message); }
    ses.registerPreloadScript({ type: 'frame', id: 'bifrost-adblock-cosmetics', filePath: PRELOAD });
    hub.before.push((d) => this.onBeforeRequest(d));
    hub.headersReceived.push((d, headers) => this.onHeadersReceived(d, headers));
  }

  allowlisted(host) {
    if (!host) return false;
    const list = this.settings.allowlist || [];
    return list.some((h) => host === h || host.endsWith('.' + h));
  }

  setPage(wcId, url) { this.pages.set(wcId, url); }
  resetCount(wcId) { this.counts.set(wcId, 0); this.emitCount(wcId); }
  forget(wcId) { this.counts.delete(wcId); this.pages.delete(wcId); }
  countFor(wcId) { return this.counts.get(wcId) || 0; }

  pageHost(d) {
    const url = (d.webContentsId != null && this.pages.get(d.webContentsId)) || d.referrer || '';
    try { return new URL(url).hostname; } catch { return ''; }
  }

  onBeforeRequest(d) {
    if (!this.engine || !this.settings.enabled) return;
    if (d.resourceType === 'mainFrame') {
      if (d.webContentsId != null) this.pages.set(d.webContentsId, d.url);
      return;
    }
    if (!/^(https?|wss?):/i.test(d.url)) return;
    const pageUrl = (d.webContentsId != null && this.pages.get(d.webContentsId)) || d.referrer || '';
    if (pageUrl.startsWith('bifrost:') || pageUrl.startsWith('chrome-extension:')) return;
    let host = '';
    try { host = new URL(pageUrl).hostname; } catch { /* no page */ }
    if (this.allowlisted(host)) return;
    // YouTube's own requests, on YouTube or from a YouTube player embedded in another page, unless you
    // turned its filters on: its player expects its ads to load (they're skipped as they play).
    if (YT_OWN_URL.test(d.url) && !this.settings.youtubeFilters) {
      if (isYouTube(host)) return;
      let frameHost = '';
      try { frameHost = d.frame ? hostOf(d.frame.url) : ''; } catch { /* frame gone */ }
      if (isYouTube(frameHost)) return;
    }
    const { Request } = blockerModule();
    const req = Request.fromRawDetails({ requestId: String(d.id), url: d.url, type: d.resourceType || 'other', sourceUrl: pageUrl || d.referrer || '', tabId: d.webContentsId });
    if (req.type === 'other') req.guessTypeOfRequest();
    const { redirect, match } = this.engine.match(req);
    if (!redirect && !match) return;
    this.count(d.webContentsId);
    return redirect && redirect.filename ? { redirectURL: `${RES_SCHEME}://r/${RES_TOKEN}/${encodeURIComponent(redirect.filename)}` } : { cancel: true };
  }

  // bifrost-res://r/<token>/<name>: one of the lists' stand-in resources.
  serveResource(req) {
    let name = '';
    try {
      const u = new URL(req.url);
      const parts = u.pathname.split('/');
      if (parts[1] === RES_TOKEN) name = decodeURIComponent(parts.slice(2).join('/'));
    } catch { /* bad address */ }
    let res = null;
    try { res = name && this.engine ? this.engine.resources.getResource(name) : null; } catch { res = null; }
    if (!res) return new Response('', { status: 404 });
    // Binary ones are stored as base64 ("image/gif;base64"), the rest as text.
    const binary = /;base64/i.test(res.contentType);
    const type = binary ? res.contentType.split(';')[0] : res.contentType;
    const body = binary ? Buffer.from(res.body, 'base64') : Buffer.from(res.body, 'utf8');
    const origin = req.headers.get('origin');
    const headers = { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': origin && origin !== 'null' ? origin : '*' };
    if (origin && origin !== 'null') { headers['access-control-allow-credentials'] = 'true'; headers.vary = 'Origin'; }
    return new Response(body, { status: 200, headers });
  }

  onHeadersReceived(d, headers) {
    if (!this.engine || !this.settings.enabled) return false;
    if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') return false;
    if (this.allowlisted(this.pageHost(d))) return false;
    const { fromElectronDetails } = blockerModule();
    const csp = this.engine.getCSPDirectives(fromElectronDetails(d));
    if (!csp) return false;
    const policies = csp.split(';').map((x) => x.trim());
    for (const [name, values] of Object.entries(headers)) {
      if (name.toLowerCase() === 'content-security-policy') { policies.push(...values); delete headers[name]; }
    }
    headers['content-security-policy'] = [policies.join(';')];
    return true;
  }

  // The page at the top of the frame's tab (for the allowlist).
  topUrl(event) {
    try { const top = event.senderFrame && event.senderFrame.top; if (top && top.url) return top.url; } catch { /* frame gone */ }
    try { return event.sender.getURL(); } catch { return ''; }
  }

  cosmeticsFor(event, url, { first, isTop = false, features = {} }) {
    const s = this.settings;
    if (!this.engine || !s.enabled) return null;
    const sender = event.sender;
    if (!sender || !this.sessions.has(sender.session)) return null;
    if (!/^https?:/i.test(url || '')) return null;
    const top = this.topUrl(event) || url;
    if (/^(bifrost|chrome-extension|devtools):/i.test(top)) return null;
    let host = '';
    try { host = new URL(top).hostname; } catch { /* keep '' */ }
    if (this.allowlisted(host)) return null;
    // Request works out the host and its registrable domain (sub.example.co.uk -> example.co.uk).
    const { Request } = blockerModule();
    const req = Request.fromRawDetails({ url, type: 'mainFrame' });
    const hostname = req.hostname || '', domain = req.domain || hostname;
    // On YouTube (the page, or a player embedded in another one) scriptlets only if you turned them on.
    const ytHere = isYouTube(hostname);
    const scriptlets = first && (!(ytHere || isYouTube(host)) || !!s.youtubeFilters);
    const youtube = first && ytHere && s.youtubeSkip !== false;
    // The first answer for a site (its own rules and scriptlets) is the same every time: keep it a minute.
    const cacheKey = first ? [isTop ? 'T' : 'F', hostname, s.cosmetic ? 1 : 0, scriptlets ? 1 : 0, youtube ? 1 : 0].join('|') : null;
    if (cacheKey) {
      if (this.cosmeticCache && this.cosmeticCache.engine === this.engine) {
        const hit = this.cosmeticCache.map.get(cacheKey);
        if (hit && Date.now() - hit.at < 60000) return hit.value;
      } else this.cosmeticCache = { engine: this.engine, map: new Map() };
    }
    const r = this.engine.getCosmeticsFilters({
      domain, hostname, url,
      classes: features.classes, hrefs: features.hrefs, ids: features.ids,
      // Generic hiding rules only in the top frame (ad frames are blocked or hidden from outside).
      getBaseRules: first && isTop && !!s.cosmetic,
      getInjectionRules: scriptlets,
      getExtendedRules: false,
      getRulesFromHostname: first,
      getRulesFromDOM: !first,
      callerContext: { frameId: event.frameId, processId: event.processId },
    });
    if (!r || r.active === false) return null;
    const value = { styles: s.cosmetic ? r.styles || '' : '', scripts: scriptlets ? this.bundle(r.scripts || []) : [], watch: !!s.cosmetic, youtube };
    if (cacheKey) {
      const m = this.cosmeticCache.map;
      if (m.size > 300) m.clear();
      m.set(cacheKey, { at: Date.now(), value });
    }
    return value;
  }

  // A frame's scriptlets as one script that keeps to itself. The engine assembles each one as top-level code,
  // so run one by one their helpers would become globals of the page (and each would declare them again);
  // here each runs in a function of its own, all of them sharing one set of helpers (as uBlock Origin runs
  // them), and nothing is left on the page's window. One that doesn't parse is left out on its own.
  bundle(scripts) {
    const parts = [];
    for (const s of scripts) {
      if (typeof s !== 'string' || !s) continue;
      let ok = this.compiles.get(s);
      if (ok === undefined) {
        try { new vm.Script(s); ok = true; } catch { ok = false; }
        if (this.compiles.size > 3000) this.compiles.clear();
        this.compiles.set(s, ok);
      }
      if (!ok) continue;
      const body = s.startsWith(SCRIPTLET_PREFIX) ? s.slice(SCRIPTLET_PREFIX.length) : s;
      parts.push('try { (function () {' + body + '\n})(); } catch (e) {}');
    }
    return parts.length ? ['(function () { var scriptletGlobals = {};\n' + parts.join('\n') + '\n})();'] : [];
  }

  async onCosmetics(event, url, msg) {
    const s = this.settings;
    if (!this.engine || !s.enabled || !s.cosmetic) return;
    const sender = event.sender;
    if (!sender || !this.sessions.has(sender.session)) return;
    const top = sender.getURL();
    if (!/^https?:/i.test(top) || !/^https?:/i.test(url || '')) return;
    let host = '';
    try { host = new URL(top).hostname; } catch { return; }
    if (this.allowlisted(host)) return;
    return this.engine.onInjectCosmeticFilters(event, url, msg);
  }

  count(wcId) {
    this.total++;
    if (wcId == null) return;
    this.counts.set(wcId, (this.counts.get(wcId) || 0) + 1);
    this.emitCount(wcId);
  }

  emitCount(wcId) {
    if (this.emitTimers.has(wcId)) return;
    this.emitTimers.set(wcId, setTimeout(() => {
      this.emitTimers.delete(wcId);
      const wc = WC.fromId(wcId);
      const host = wc && !wc.isDestroyed() ? wc.hostWebContents : null;
      if (host && !host.isDestroyed()) host.send('adblock-count', { wcId, count: this.counts.get(wcId) || 0 });
      ctx.db.kvSet('adblock.total', this.total);
    }, 250));
  }

  setAllowed(host, allowed) {
    const list = new Set(this.settings.allowlist || []);
    if (allowed) list.add(host); else list.delete(host);
    ctx.settings.set('privacy.adblock.allowlist', [...list].sort());
  }

  status() {
    return {
      enabled: this.settings.enabled, ready: !!this.engine, loading: !!this.loading, total: this.total,
      listsUpdated: ctx.db.kvGet('adblock.listsUpdated', 0), bundled: JSON.parse(fs.readFileSync(path.join(BUNDLED, 'lists.json'), 'utf8')).generated,
      categories: CATEGORIES,
    };
  }
}

module.exports = { AdBlock, CATEGORIES, isYouTube, RES_SCHEME };
