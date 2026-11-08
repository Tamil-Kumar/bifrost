'use strict';
// Built-in ad and tracker blocking (Ghostery's engine with EasyList, EasyPrivacy and uBlock Origin lists, and
// HaGeZi's DNS blocklists as a domain list in an engine of its own: domain-list.js says how it's kept from
// breaking sites). Network blocking runs in the main process; element hiding and scriptlets are injected by a
// preload.
const { app, ipcMain, net, webContents: WC } = require('electron');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ctx = require('./context');
const DomainList = require('./domain-list');

// YouTube. Its pages get no page scripts from the lists unless you ask for them (privacy.adblock.youtubeFilters):
// with them YouTube can stop loading at its grey placeholders, so by default its own requests are left alone,
// only other sites' ads and trackers on it are blocked, and its ads are dealt with in the page instead
// (preload/adblock.js: video ads covered and skipped, the ads in its pages hidden, ads taken out of Shorts).
// The tests point www.youtube.com at a local stand-in (tests/e2e/youtube.mjs).
const YT_SITE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/i;
const YT_OWN_URL = /^(https?|wss?):\/\/([^/?#@]*\.)?(youtube\.com|youtube-nocookie\.com|youtubekids\.com|googlevideo\.com|ytimg\.com|ggpht\.com)(:\d+)?([/?#]|$)/i;
const isYouTube = (host) => !!host && YT_SITE.test(host);
// (the tests make "a player stuck saying it's showing an ad" seconds instead of minutes)
const YT_STUCK_MS = process.env.BIFROST_TEST === '1' ? Number(process.env.BIFROST_YT_STUCK_MS) || 0 : 0;
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
const TEST = process.env.BIFROST_TEST === '1';
// (the tests: lists from a local server, and a small domain list of their own)
const REMOTE = (TEST && process.env.BIFROST_LISTS_REMOTE) || 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/';
const DOMAINS_REMOTE = TEST ? process.env.BIFROST_DOMAINS_REMOTE || '' : '';
const DOMAINS_LIST = TEST ? process.env.BIFROST_DOMAINS_LIST || '' : '';
const FILTER_REV = 2;
const DOMAINS_REV = 1;  // bump when what the domain list's engine is built from changes
const CATEGORIES = { ads: 'Ads', tracking: 'Trackers', annoyances: 'Annoyances', cookieNotices: 'Cookie notices', domains: 'Ad and tracker domains (HaGeZi)' };
const LIST_CATS = ['ads', 'tracking', 'annoyances', 'cookieNotices'];   // the lists' engine (domains: its own)
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].replace(/^Error: /, '');

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
    this.domains = null;       // the domain list's engine (when it's on)
    this.domainsKey = '';
    this.loading = null;
    this.failedAt = 0;         // when a scheduled update last failed
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
        if (this.settings.enabled && (this.wantedKey() !== this.engineKey || this.wantedDomainsKey() !== this.domainsKey)) this.load().catch((e) => console.error('[adblock]', e));
        this.scheduleUpdate();
      }
    });
    if (this.settings.enabled) this.load().catch((e) => console.error('[adblock] load', e));
    this.scheduleUpdate();
  }

  // ----------------------------------------------------------------- engine
  wantedKey() {
    const s = this.settings;
    const cats = LIST_CATS.filter((c) => s.lists[c]);
    const custom = crypto.createHash('sha1').update(s.customFilters || '').digest('hex').slice(0, 10);
    const stamp = ctx.db.kvGet('adblock.listsUpdated', 0);
    // FILTER_REV: bump when the worker changes which filters it keeps (see adblock-worker.js).
    return `${cats.join('+')}|c${s.cosmetic ? 1 : 0}|${custom}|${stamp}|${blockerModule().ENGINE_VERSION || 0}|r${FILTER_REV}`;
  }

  // The domain list's engine ('' with the list off).
  wantedDomainsKey() {
    if (!this.settings.lists.domains) return '';
    const keep = crypto.createHash('sha1').update(this.keepText()).digest('hex').slice(0, 10);
    const stamp = ctx.db.kvGet('adblock.domainsUpdated', 0);
    return `domains|${stamp}|${keep}|${DOMAINS_LIST}|${blockerModule().ENGINE_VERSION || 0}|d${DOMAINS_REV}`;
  }

  // Bifrost's exceptions to the domain list (assets/adblock/domains-keep.txt).
  keepText() {
    if (this.keep === undefined) {
      try { this.keep = fs.readFileSync(path.join(BUNDLED, 'domains-keep.txt'), 'utf8'); } catch { this.keep = ''; }
    }
    return this.keep;
  }

  listText(cat) {
    const updated = path.join(this.dir, 'lists', cat + '.txt');
    if (fs.existsSync(updated)) return fs.readFileSync(updated, 'utf8');
    if (cat === 'domains' && DOMAINS_LIST) return fs.readFileSync(DOMAINS_LIST, 'utf8');
    return zlib.gunzipSync(fs.readFileSync(path.join(BUNDLED, cat + '.txt.gz'))).toString('utf8');
  }

  resourcesText() {
    const updated = path.join(this.dir, 'lists', 'resources.json');
    if (fs.existsSync(updated)) return fs.readFileSync(updated, 'utf8');
    return zlib.gunzipSync(fs.readFileSync(path.join(BUNDLED, 'resources.json.gz'))).toString('utf8');
  }

  // The lists' engine and the domain list's, each from its cache or built afresh (in a worker).
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const s = this.settings;
      const key = this.wantedKey();
      const dkey = this.wantedDomainsKey();
      const { ElectronBlocker, FiltersEngine } = blockerModule();
      const [engine, domains] = await Promise.all([
        this.engine && key === this.engineKey ? this.engine : this.cachedEngine('engine', key, () => ({
          job: 'lists',
          text: LIST_CATS.filter((c) => s.lists[c]).map((c) => this.listText(c)).join('\n') + '\n' + (s.customFilters || ''),
          resources: this.resourcesText(),
          cosmetic: s.cosmetic,
        }), (buf) => ElectronBlocker.deserialize(buf)),
        !dkey ? null : this.domains && dkey === this.domainsKey ? this.domains : this.cachedEngine('domains', dkey, () => ({
          job: 'domains',
          text: this.listText('domains') + '\n' + this.keepText(),
        }), (buf) => FiltersEngine.deserialize(buf)),
      ]);
      this.engine = engine;
      this.engineKey = key;
      this.domains = domains;
      this.domainsKey = dkey;
      this.emit('ready');
      return engine;
    })().finally(() => {
      this.loading = null;
      // Settings changed while the engines were being built (new filters, lists): build again.
      if (this.settings.enabled && (this.wantedKey() !== this.engineKey || this.wantedDomainsKey() !== this.domainsKey)) setImmediate(() => this.load().catch((e) => console.error('[adblock]', e)));
    });
    return this.loading;
  }

  async cachedEngine(prefix, key, work, deserialize) {
    const cacheFile = path.join(this.dir, prefix + '-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.bin');
    if (fs.existsSync(cacheFile)) {
      try { return deserialize(new Uint8Array(fs.readFileSync(cacheFile))); } catch { /* built again below */ }
    }
    const { buffer } = await this.runWorker(work());
    const engine = deserialize(new Uint8Array(buffer));
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (f.startsWith(prefix + '-') && f.endsWith('.bin')) fs.rmSync(path.join(this.dir, f), { force: true });
    fs.writeFileSync(cacheFile, Buffer.from(buffer));
    return engine;
  }

  runWorker(data) {
    return new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, 'adblock-worker.js'), { workerData: data });
      w.once('message', (m) => { w.terminate(); m.ok ? resolve(m) : reject(new Error(m.error)); });
      w.once('error', reject);
    });
  }

  // Fetches fresh lists (EasyList and uBlock Origin's from Ghostery's mirror, the domain list from HaGeZi's
  // repository), then rebuilds the engines. Each kind on its own: one that can't be fetched keeps what it had,
  // and the error says which. only: the kinds to fetch ('lists', 'domains'; all of them without it).
  async updateLists({ only = null } = {}) {
    const s = this.settings;
    const out = path.join(this.dir, 'lists');
    fs.mkdirSync(out, { recursive: true });
    const failed = [];
    let lists = false, domains = false;
    if (!only || only.has('lists')) {
      try { await this.updateFilterLists(out); lists = true; } catch (e) { failed.push('EasyList and uBlock Origin’s lists (' + firstLine(e) + ')'); }
    }
    if ((!only || only.has('domains')) && s.lists.domains) {
      try { await this.updateDomains(out); domains = true; } catch (e) { failed.push('HaGeZi’s domain list (' + firstLine(e) + ')'); }
    }
    if (lists) ctx.db.kvSet('adblock.listsUpdated', Date.now());
    if (domains) ctx.db.kvSet('adblock.domainsUpdated', Date.now());
    if (lists || domains) await this.load();
    if (failed.length) throw new Error(failed.join('; '));
    return { updated: Date.now() };
  }

  async updateFilterLists(out) {
    const s = this.settings;
    const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLED, 'lists.json'), 'utf8'));
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
  }

  // HaGeZi's lists and allowlists (domain-list.js SOURCES), from GitHub or its mirror, made into one list
  // (in a worker: a few hundred thousand lines). A list that came out much smaller than the one it would replace
  // is a download gone wrong: the old one stays.
  async updateDomains(out) {
    const { SOURCES, MIN_RULES, ruleCount } = DomainList;
    const bases = DOMAINS_REMOTE ? [DOMAINS_REMOTE] : SOURCES.bases;
    const get = async (rel) => {
      let err = null;
      for (const base of bases) {
        try {
          const r = await net.fetch(base + rel, { cache: 'no-store' });
          if (r.ok) return { name: rel, text: await r.text() };
          err = new Error(`${rel}: HTTP ${r.status}`);
        } catch (e) { err = new Error(`${rel}: ${firstLine(e)}`); }
      }
      throw err;
    };
    // (a few at a time)
    const all = async (rels) => {
      const got = new Array(rels.length);
      let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => { while (next < rels.length) { const i = next++; got[i] = await get(rels[i]); } }));
      return got;
    };
    const blocks = await all(SOURCES.block);
    const allows = await all(SOURCES.allow);
    const r = await this.runWorker({ job: 'compose', blocks, allows, min: DOMAINS_REMOTE ? 1 : MIN_RULES });
    let before = 0;
    try { before = ruleCount(this.listText('domains')); } catch { before = 0; }
    if (before && r.rules < before / 2) throw new Error(`it came with ${r.rules} rules, against ${before} before: kept the one there was`);
    const file = path.join(out, 'domains.txt');
    fs.writeFileSync(file + '.part', r.text);
    fs.renameSync(file + '.part', file);
  }

  // The lists are fetched again once they're older than Settings says (each kind by its own age); after a try
  // that failed, not for an hour.
  scheduleUpdate() {
    clearTimeout(this.updateTimer);
    const period = Math.max(1, ctx.settings.get('privacy.adblock.updateHours') || 24) * 3600e3;
    const stamps = () => {
      const st = { lists: ctx.db.kvGet('adblock.listsUpdated', 0) };
      if (this.settings.lists.domains) st.domains = ctx.db.kvGet('adblock.domainsUpdated', 0);
      return st;
    };
    const oldest = Math.min(...Object.values(stamps()));
    const due = Math.max(60e3, oldest + period - Date.now(), this.failedAt + 3600e3 - Date.now());
    this.updateTimer = setTimeout(() => {
      if (!this.settings.enabled) { this.scheduleUpdate(); return; }
      const now = Date.now();
      const only = new Set(Object.entries(stamps()).filter(([, t]) => now - t >= period - 60e3).map(([k]) => k));
      if (!only.size) { this.scheduleUpdate(); return; }
      this.updateLists({ only })
        .then(() => { this.failedAt = 0; }, (e) => { this.failedAt = Date.now(); console.warn('[adblock] list update failed:', e.message); })
        .finally(() => this.scheduleUpdate());
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
    const standIn = (res) => ({ redirectURL: `${RES_SCHEME}://r/${RES_TOKEN}/${encodeURIComponent(res.filename)}` });
    const { redirect, match, exception } = this.engine.match(req);
    if (redirect || match) {
      this.count(d.webContentsId);
      return redirect && redirect.filename ? standIn(redirect) : { cancel: true };
    }
    // Then the domain list (unless the lists themselves let this through).
    if (exception || !this.domainBlocked(req, host, () => { try { return d.frame ? hostOf(d.frame.url) : ''; } catch { return ''; } })) return;
    this.count(d.webContentsId);
    const res = this.standInFor(req);
    return res && res.filename ? standIn(res) : { cancel: true };
  }

  // Whether the domain list stops this request, made from a page on pageHost (frameHost(): the host of the
  // frame that made it). See domain-list.js for what it leaves alone.
  domainBlocked(req, pageHost, frameHost) {
    if (!this.domains || !this.settings.lists.domains || !pageHost) return false;
    const r = this.domains.match(req);
    if (!r.match) return false;
    const rule = r.filter && typeof r.filter.getHostname === 'function' ? r.filter.getHostname() : '';
    const frame = typeof frameHost === 'function' ? frameHost() : frameHost || '';
    // The site you're on (or the frame's own).
    if (DomainList.covers(rule, pageHost) || DomainList.covers(rule, frame)) return false;
    // A company's own services on its own sites.
    const { Request } = blockerModule();
    const site = (h) => (h ? Request.fromRawDetails({ url: 'https://' + h + '/', type: 'mainFrame' }).domain || h : '');
    if (DomainList.sameOwner(req.domain, site(pageHost)) || (frame && frame !== pageHost && DomainList.sameOwner(req.domain, site(frame)))) return false;
    // The lists' exceptions (their fixes for sites they'd break, your own @@ rules).
    const e = this.engine;
    if (e && e.exceptions.match(req, e.isFilterExcluded.bind(e))) return false;
    return true;
  }

  // What uBlock Origin's lists put in place of a script they'd rather a page got a harmless copy of, when
  // something blocks it (their redirect-rule filters): the domain list's blocks get it too.
  standInFor(req) {
    const e = this.engine;
    if (!e) return null;
    let best = null;
    for (const f of e.redirects.matchAll(req, e.isFilterExcluded.bind(e))) {
      if (f.isRedirectRule() && (!best || f.getRedirectPriority() > best.getRedirectPriority())) best = f;
    }
    if (!best || best.getRedirectResource() === 'none') return null;
    try { return e.resources.getResource(best.getRedirectResource()); } catch { return null; }
  }

  // A pop-up a page opens (window.open) to a site on the domain list: a pop-up ad, unless it's the page's own
  // site, the same company's, or you allowed pop-ups (or ads) on that page's site.
  isAdPopup(top, url) {
    const s = this.settings;
    if (!this.engine || !this.domains || !s.enabled || !s.lists.domains || !/^https?:/i.test(url || '')) return false;
    const host = hostOf(top);
    if (!/^https?:/i.test(top || '') || !host || this.allowlisted(host)) return false;
    try { if (ctx.db.siteSettings(host).popups) return false; } catch { /* no site settings */ }
    const { Request } = blockerModule();
    const req = Request.fromRawDetails({ url, type: 'other', sourceUrl: top });
    return this.domainBlocked(req, host, '');
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
    if (!s.enabled) return null;
    const sender = event.sender;
    if (!sender || !this.sessions.has(sender.session)) return null;
    if (!/^https?:/i.test(url || '')) return null;
    const top = this.topUrl(event) || url;
    if (/^(bifrost|chrome-extension|devtools):/i.test(top)) return null;
    let host = '';
    try { host = new URL(top).hostname; } catch { /* keep '' */ }
    if (this.allowlisted(host)) return null;
    // YouTube (the page, or a player embedded in another one): its ads are dealt with in the page, lists or no
    // lists (so also in the seconds after a start while they load). Its pages' ads are hidden with element
    // hiding on.
    const ytHere = isYouTube(hostOf(url));
    const youtube = first && ytHere && s.youtubeSkip !== false ? { hide: !!s.cosmetic, stuckMs: YT_STUCK_MS || undefined } : null;
    if (!this.engine) return youtube ? { styles: '', scripts: [], watch: false, youtube } : null;
    // Request works out the host and its registrable domain (sub.example.co.uk -> example.co.uk).
    const { Request } = blockerModule();
    const req = Request.fromRawDetails({ url, type: 'mainFrame' });
    const hostname = req.hostname || '', domain = req.domain || hostname;
    // On YouTube scriptlets only if you turned them on.
    const scriptlets = first && (!(ytHere || isYouTube(host)) || !!s.youtubeFilters);
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
    if (!r || r.active === false) return youtube ? { styles: '', scripts: [], watch: false, youtube } : null;
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
    const lists = ctx.db.kvGet('adblock.listsUpdated', 0), domains = ctx.db.kvGet('adblock.domainsUpdated', 0);
    return {
      enabled: this.settings.enabled, ready: !!this.engine, loading: !!this.loading, total: this.total,
      listsUpdated: Math.max(lists, this.settings.lists.domains ? domains : 0), filtersUpdated: lists, domainsUpdated: domains,
      domainList: !!this.domains,
      bundled: JSON.parse(fs.readFileSync(path.join(BUNDLED, 'lists.json'), 'utf8')).generated,
      categories: CATEGORIES,
    };
  }
}

module.exports = { AdBlock, CATEGORIES, isYouTube, RES_SCHEME };
