'use strict';
// How websites look: Bifrost's dark mode for websites, and your styles (userstyles, as in Stylus).
//
// Dark mode (settings webStyles): Chromium's own dark mode for web pages, turned on tab by tab through the
// DevTools protocol (main/web-theme.js does that): pages are darkened as they're drawn, with no script in
// them, and a site with a dark theme of its own is told to use it instead (prefers-color-scheme: dark), which
// Chromium then leaves alone. On for every site or for none, with sites of your own either way (darkSites:
// { 'example.com': true | false | 'bifrost' }, the most specific one counts; 'bifrost': dark, by Chromium even
// where the site has a dark theme of its own), and brightness, contrast and sepia over it.
//
// Your styles (Settings → Website styles): usercss styles (src/shared/usercss.js) installed from a link,
// written here, or brought over from Stylus (a backup, with the CSS Stylus built, or a file made for importing
// into Stylus, like Catppuccin's, built here); kept in styles.json in the profile (not in the settings, which
// every page is sent on each change). Styles written in LESS are built in a worker (less-builder.js). The CSS a
// style @imports is put in it when it's built (a stylesheet Bifrost gives a page can't import). Each page and
// frame gets the parts that are for it, with the site's own style (its info popover → Add a style) after them, as
// one stylesheet the tab preload adopts before the page draws (preload/tab.js), and again whenever they change.
//
// Your theme on websites (webStyles.matchTheme): Catppuccin's styles built again in Bifrost's theme (its flavor
// when it's one of Catppuccin's, else its colors in Catppuccin's library: src/shared/catppuccin.js), kept as each
// style's themed: { key, of, sections } (in styles-themed.json: built again if it goes), and given to pages
// instead while it's on; built again when the theme changes (a theme that follows the system's, when that does).
//
// Catppuccin for every site (webStyles.recolor, and recolorSites: { 'example.com': true | false }): a page that
// none of your styles is for gets Catppuccin's colors anyway, turned in the page (preload/recolor.js, a preload
// of every frame of the browsing sessions: sessions.js). What a frame is given (recolorFor): Catppuccin's 26
// colors, in your theme's while websites match it, else Mocha where pages are told they're dark and Latte where
// they're light; or null. Pages it turns are told dark or light by those colors, and Chromium's own dark mode
// stays off on them (main/web-theme.js). Stylesheets from other sites, which a page can't read, are read here for
// it (cssFetch): only CSS, without your cookies, and none from your own network for a page on the web; and the
// pictures it shows that may be icons, given back in text's colors if they are (iconFetch).
//
// Your styles that say where they come from are looked at for newer versions once a day (webStyles.autoUpdate:
// autoUpdate), as Stylus does: sites change, and Catppuccin's styles for them follow.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { net, webContents, nativeTheme, nativeImage } = require('electron');
const { EventEmitter } = require('node:events');
const ctx = require('./context');
const U = require('../shared/usercss');
const C = require('../shared/catppuccin');
const Themes = require('../shared/themes');
const { LessBuilder } = require('./less-builder');

const isWeb = (url) => /^(https?|file):/i.test(String(url || ''));
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const siteKey = (host) => String(host || '').toLowerCase().replace(/^www\./, '');
const RECOLOR_PRELOAD = path.join(__dirname, '..', 'preload', 'recolor.js');
const CSS_KEEP = 30 * 60e3;         // another site's stylesheet, read for a page: kept this long
const CSS_RETRY = 60e3;             // one that couldn't be read: not asked for again for this long
const CSS_MAX = 5 * 1024 * 1024;    // the biggest one read
const CSS_ALL = 40 * 1024 * 1024;   // all of them together, at most
const UPDATE_FIRST = 3 * 60e3;      // your styles looked at for newer versions this long after the start…
const UPDATE_EVERY = 24 * 3600e3;   // …and then once a day
const PIC_MAX = 2 * 1024 * 1024;    // the biggest picture read to be an icon
const ICON_COUNT = 2000;            // icons kept in text's colors (and pictures known not to be ones), at most
const ICON_ALL = 30 * 1024 * 1024;  // …and their size together
// (the color work of Catppuccin for every site, which the pages run: loaded the first time a picture is looked at)
let coreCache = null;
const recolorCore = () => coreCache || (coreCache = require(RECOLOR_PRELOAD));

// An address on your own network (or this computer).
function privateAddress(ip) {
  const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return x === 10 || x === 127 || x === 0 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  return a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
}

class WebStyles extends EventEmitter {
  constructor() {
    super();
    this.file = null;
    this.styles = [];
    this.pushTimer = null;
    this.builder = new LessBuilder();
    this.themeKey = '';            // the theme Catppuccin's styles are given in ('' while that's off)
    this.themeTimer = null;
    this.theming = null;           // the theme being built for
    this.themeProgress = null;
    this.css = new Map();          // another site's stylesheet's address -> { text, at, wait }
    this.cssBytes = 0;
    this.palettes = new Map();     // what a page gets for Catppuccin for every site, by what it's made from
    this.icons = new Map();        // palette key + a picture's address -> { data (it as an icon in text's colors, or null), wait }
    this.iconBytes = 0;
    this.irs = new Map();          // a site's origin + what a stylesheet is -> { nodes, size }: irGet/irPut
    this.irBytes = 0;
    this.looks = new Map();        // a tab's id -> { url, count }: pictures looked at on the screen for its page (lookAt)
    this.iconPalettes = new Map(); // palette key -> recolor.js's prepared palette
  }

  // A browsing session (sessions.js): Catppuccin for every site's page script in each of its frames, and other
  // sites' stylesheets read ahead as a page with it asks for them (so they're ready when it gets to them).
  attach(ses, hub) {
    try { ses.registerPreloadScript({ type: 'frame', id: 'bifrost-recolor', filePath: RECOLOR_PRELOAD }); } catch (e) { console.warn('[styles] recolor', e.message); }
    hub.before.push((d) => {
      if (d.resourceType !== 'stylesheet' || !d.webContentsId || !this.recolorAny()) return;
      try { this.readAhead(ses, d); } catch { /* the frame went */ }
    });
  }

  init() {
    this.file = path.join(ctx.profile.dir, 'styles.json');
    this.themedFile = path.join(ctx.profile.dir, 'styles-themed.json');
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data && Array.isArray(data.styles)) this.styles = data.styles.filter((s) => s && s.id && Array.isArray(s.sections));
    } catch { this.styles = []; }
    if (this.config().matchTheme) {
      try {
        const data = JSON.parse(fs.readFileSync(this.themedFile, 'utf8'));
        const byId = (data && data.styles) || {};
        for (const s of this.styles) if (byId[s.id] && typeof byId[s.id] === 'object') s.themed = byId[s.id];
      } catch { /* not built yet */ }
    }
    ctx.settings.on('changed', ({ path: p }) => {
      // (the theme: Catppuccin's styles built in it again; pages with Catppuccin for every site, in its colors)
      if (p && (p === 'appearance' || p.startsWith('appearance.'))) { this.themeSoon(); if (this.recolorAny()) this.pushSoon(); return; }
      if (p && !p.startsWith('webStyles')) return;
      try { require('./web-theme').apply(); } catch { /* not ready */ }
      if (!p || p === 'webStyles' || p === 'webStyles.matchTheme') this.themeSoon();
      this.pushSoon();
    });
    nativeTheme.on('updated', () => {
      if ((ctx.settings.get('appearance') || {}).theme === 'auto') this.themeSoon();
      if (this.recolorAny()) this.pushSoon();
    });
    if (this.config().matchTheme) {
      this.themeKey = this.themeNow().key;
      setTimeout(() => this.retheme(), 3000);
    }
    if (this.styles.some((s) => this.cameEmpty(s))) setTimeout(() => this.buildEmpty().catch(() => {}), 2500);
    this.updateTimer = setTimeout(() => this.autoUpdate(), UPDATE_FIRST);
  }

  // Your styles kept up to date (webStyles.autoUpdate): sites change their pages (Google's names for things,
  // often), and the styles for them follow, so those that say where they come from (Catppuccin's do) are looked
  // at once a day: a few minutes after the start, and then each hour whether a day has gone by since the last
  // look (styles-checked.json: a browser started every morning looks once a day, not each time).
  autoUpdate() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.autoUpdate(), 60 * 60e3);
    if (this.config().autoUpdate === false || !this.styles.some((s) => (s.meta && s.meta.updateURL) || s.installedFrom)) return;
    const file = path.join(ctx.profile.dir, 'styles-checked.json');
    let last = 0;
    try { last = Number(JSON.parse(fs.readFileSync(file, 'utf8')).at) || 0; } catch { /* never */ }
    if (Date.now() - last < UPDATE_EVERY && last <= Date.now()) return;
    try { fs.writeFileSync(file, JSON.stringify({ at: Date.now() })); } catch { /* looked at again next hour */ }
    this.checkUpdates().then((r) => {
      if (r.updated.length) console.log('[styles] updated:', r.updated.join(', '));
      this.lastAuto = { at: Date.now(), ...r };
    }, (e) => console.warn('[styles] update check', e && e.message));
  }

  config() { return ctx.settings.get('webStyles') || {}; }

  // A style brought in from Stylus 2's backup before Bifrost built the ones it saves without their CSS: it came
  // in empty (its code, but no CSS). Built now, from its code, with the options it came with.
  cameEmpty(s) {
    return s.origin === 'stylus' && (!s.sections || !s.sections.length) && /==UserStyle==/.test(String(s.code || ''));
  }

  async buildEmpty() {
    let built = 0;
    for (const s of this.styles.filter((x) => this.cameEmpty(x))) {
      try {
        const b = await this.build(s.code, s.values || {});
        if (!this.styles.includes(s) || !this.cameEmpty(s)) continue;
        s.sections = b.sections;
        s.vars = b.vars;
        s.error = '';
        s.updatedAt = Date.now();
        built++;
      } catch (e) {
        s.error = String((e && e.message) || e);
      }
    }
    if (built) this.save();
  }

  // ---------------------------------------------------------------- dark mode
  // The site's own entry (most specific first): true | false | 'bifrost', or undefined.
  siteEntry(host, sites = this.config().darkSites || {}) {
    let h = siteKey(host);
    while (h) {
      if (Object.prototype.hasOwnProperty.call(sites, h)) return sites[h];
      const dot = h.indexOf('.');
      if (dot < 0) break;
      h = h.slice(dot + 1);
    }
    return undefined;
  }

  // The site's own choice, else everywhere's (null).
  siteDark(host, sites = this.config().darkSites || {}) {
    const v = this.siteEntry(host, sites);
    return v === undefined ? null : !!v;
  }

  // How a page is darkened: null (it isn't), 'own' (its own dark theme where it has one, else Chromium's), or
  // 'bifrost' (Chromium's, as you chose for the site).
  darkHow(url) {
    if (!this.darkFor(url)) return null;
    return this.siteEntry(hostOf(url)) === 'bifrost' ? 'bifrost' : 'own';
  }

  darkFor(url) {
    if (!/^(https?|file):/i.test(String(url || ''))) return false;
    const own = this.siteDark(hostOf(url));
    return own != null ? own : !!this.config().dark;
  }

  // Dark mode on or off for a site (its info popover, Alt+Shift+A): kept only where it differs from everywhere's.
  setSiteDark(host, on) {
    const key = siteKey(host);
    if (!key) return;
    const c = this.config();
    const sites = { ...(c.darkSites || {}) };
    delete sites[key];
    // (what it would get without an entry of its own: a parent site's, or everywhere's)
    const parent = this.siteDark(key, sites);
    const inherited = parent != null ? parent : !!c.dark;
    if (!!on !== inherited) sites[key] = !!on;
    ctx.settings.set('webStyles.darkSites', sites);
  }

  // Brightness, contrast and sepia over dark mode (the top page only: a frame's would come twice).
  adjustments(url, top) {
    if (!top || !this.darkFor(url)) return '';
    const c = this.config();
    const b = clamp(c.brightness, 50, 150, 100);
    const k = clamp(c.contrast, 50, 150, 100);
    const s = clamp(c.sepia, 0, 100, 0);
    if (b === 100 && k === 100 && s === 0) return '';
    const f = [b !== 100 ? `brightness(${b / 100})` : '', k !== 100 ? `contrast(${k / 100})` : '', s ? `sepia(${s / 100})` : ''].filter(Boolean).join(' ');
    return `/* Bifrost: dark mode's brightness, contrast and sepia */\nhtml { filter: ${f} !important; }\n`;
  }

  // ---------------------------------------------------------------- what a page gets
  cssFor(url, top = true) {
    if (!isWeb(url)) return '';
    const parts = [];
    for (const s of this.styles) {
      if (!s.enabled || U.excluded(s.exclusions, url)) continue;
      const code = (this.themedSections(s) || s.sections).filter((x) => U.sectionMatches(x, url)).map((x) => x.code).join('\n');
      if (code.trim()) parts.push(`/* ${String(s.name).replace(/\*\//g, '')} */\n${code}`);
    }
    const host = hostOf(url);
    const own = host && ctx.db ? ctx.db.siteSettings(host).css : '';
    if (own && own.trim()) parts.push(`/* your style for ${host} */\n${own}`);
    const adj = this.adjustments(url, top);
    if (adj) parts.push(adj);
    return parts.join('\n');
  }

  // Styles that are for a page (its info popover lists them, on or off).
  forPage(url) {
    return this.styles.filter((s) => !U.excluded(s.exclusions, url) && s.sections.some((x) => !U.isGlobal(x) && U.sectionMatches(x, url))).map((s) => ({ id: s.id, name: s.name, enabled: !!s.enabled }));
  }

  // Every frame of every tab gets what's for it now (a moment after the last change: sliders send many).
  pushSoon() {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushAll(), 60);
  }

  pushAll() {
    clearTimeout(this.pushTimer);
    // (whether a tab's page is turned decides what it's told: dark or light, Chromium's dark mode or not)
    try { require('./web-theme').apply(); } catch { /* not ready */ }
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
      let frames = [];
      try { frames = wc.mainFrame.framesInSubtree; } catch { continue; }
      const top = wc.mainFrame.url;
      for (const f of frames) {
        try {
          if (isWeb(f.url)) f.send('tab-site-css', this.cssFor(f.url, f === wc.mainFrame || !f.parent));
          const page = this.framePage(f);
          if (isWeb(page)) f.send('tab-recolor', this.recolorFor(page, top));
        } catch { /* frame gone */ }
      }
    }
  }

  // ---------------------------------------------------------------- Catppuccin for every site
  recolorAny() { const c = this.config(); return !!c.recolor || Object.values(c.recolorSites || {}).some(Boolean); }

  // On for a site: its own entry (the most specific), else everywhere's.
  recolorOn(host) {
    const v = this.siteEntry(host, this.config().recolorSites || {});
    return v === undefined ? !!this.config().recolor : !!v;
  }

  // On or off for a site (its info popover): kept only where it differs from everywhere's.
  setSiteRecolor(host, on) {
    const key = siteKey(host);
    if (!key) return;
    const c = this.config();
    const sites = { ...(c.recolorSites || {}) };
    delete sites[key];
    const parent = this.siteEntry(key, sites);
    const inherited = parent !== undefined ? !!parent : !!c.recolor;
    if (!!on !== inherited) sites[key] = !!on;
    ctx.settings.set('webStyles.recolorSites', sites);
  }

  // Whether one of your styles (on) is for a page: then it's that style's, and Bifrost doesn't turn it.
  styledFor(url) {
    return this.styles.some((s) => s.enabled && !U.excluded(s.exclusions, url) && s.sections.some((x) => !U.isGlobal(x) && U.sectionMatches(x, url)));
  }

  // What a frame's page is given: { key, dark, palette } (Catppuccin's 26 colors), or null. topUrl: its tab's page
  // (a site you turned it off for keeps its frames as they are too).
  recolorFor(url, topUrl = url) {
    if (!isWeb(url)) return null;
    if (!this.recolorOn(hostOf(topUrl || url))) return null;
    if (this.styledFor(url)) return null;
    return this.recolorPalette(topUrl || url);
  }

  // In your theme while websites match it; else Catppuccin's Mocha where pages are told they're dark (dark mode
  // for websites, or a dark preference), Latte where they're light.
  recolorPalette(url) {
    let build;
    if (this.config().matchTheme) { const t = this.themeNow(); build = { flavor: t.flavor, palette: t.palette }; } else {
      const wt = require('./web-theme');
      const w = wt.wanted();
      const dark = this.darkFor(url) || (w ? w === 'dark' : nativeTheme.shouldUseDarkColors);
      build = { flavor: dark ? 'mocha' : 'latte', palette: null };
    }
    const id = JSON.stringify(build);
    let out = this.palettes.get(id);
    if (!out) {
      const palette = C.fullPalette(build);
      out = { key: crypto.createHash('sha1').update(JSON.stringify(palette)).digest('hex').slice(0, 12), dark: Themes.luminance(palette.base) < Themes.luminance(palette.text), palette };
      if (this.palettes.size > 20) this.palettes.clear();
      this.palettes.set(id, out);
    }
    return out;
  }

  // The page a frame is part of: its own, or for one its page writes into itself (about:blank, about:srcdoc: a
  // rich text editor's), its page's.
  framePage(f, url = '') {
    let u = '';
    try { u = (f && f.url) || url; } catch { u = url; }
    for (let k = 0; k < 5 && /^about:(blank|srcdoc)/i.test(u) && f && f.parent; k++) {
      f = f.parent;
      try { u = f.url; } catch { break; }
    }
    return u;
  }

  // ---- other sites' stylesheets, read for a page that's turned (preload/recolor.js asks)
  // The frame asking has to be one that's turned.
  cssAsker(event) {
    if (!event || !event.sender || event.sender.getType() !== 'webview') return null;
    const page = this.framePage(event.senderFrame, event.sender.getURL());
    return this.recolorFor(page, event.sender.getURL()) ? page : null;
  }

  // What a page's engine read of a big stylesheet (preload/recolor.js irCached: its nodes, the same in any
  // colors), kept for the site's next pages. Kept under the asking frame's site, which the frame can't choose: a
  // page can only find what its own site's pages kept. 400 at most, 40 MB (by their text's length), the oldest
  // going first; in memory only.
  irKey(event, key) {
    if (typeof key !== 'string' || key.length > 4000 || !event || !event.senderFrame) return '';
    let origin = '';
    try { origin = new URL(event.senderFrame.url).origin; } catch { return ''; }
    if (!/^https?:/.test(origin)) return '';
    return origin + '\n' + key;
  }

  irGet(event, key) {
    const k = this.irKey(event, key);
    const e = k && this.irs.get(k);
    if (!e) return null;
    // (used: the newest again)
    this.irs.delete(k); this.irs.set(k, e);
    return e.nodes;
  }

  irPut(event, key, nodes) {
    const k = this.irKey(event, key);
    if (!k || !Array.isArray(nodes)) return;
    let size = 0;
    try { size = JSON.stringify(nodes).length; } catch { return; }
    if (size > 8e6) return;
    // (read again: what was kept before is replaced)
    const was = this.irs.get(k);
    if (was) { this.irs.delete(k); this.irBytes -= was.size; }
    this.irs.set(k, { nodes, size });
    this.irBytes += size;
    for (const [key2, v] of this.irs) {
      if (this.irs.size <= 400 && this.irBytes <= 40e6) break;
      this.irs.delete(key2); this.irBytes -= v.size;
    }
  }

  // What's been read already (at once: the page waits for it), or null.
  cssNow(event, url) {
    if (!this.cssAsker(event)) return null;
    const e = this.css.get(url);
    return e && typeof e.text === 'string' && Date.now() - e.at < CSS_KEEP ? e.text : null;
  }

  async cssFetch(event, url) {
    const page = this.cssAsker(event);
    if (!page) return null;
    return this.cssGet(event.sender.session, url, page);
  }

  // A stylesheet a turned page has asked for from another site: read now too, alongside the page's own
  // request, so it's here by the time the page has it.
  readAhead(ses, d) {
    const page = (d.frame && d.frame.url) || d.referrer || '';
    if (!/^https?:/i.test(page) || !/^https?:/i.test(d.url) || this.css.has(d.url)) return;
    let same = false;
    try { same = new URL(d.url).origin === new URL(page).origin; } catch { return; }
    if (same) return;   // (the page reads its own site's itself)
    const wc = webContents.fromId(d.webContentsId);
    if (!wc || wc.getType() !== 'webview' || !this.recolorFor(page, wc.getURL())) return;
    this.cssGet(ses, d.url, page).catch(() => {});
  }

  cssGet(ses, url, page) {
    const e = this.css.get(url);
    const now = Date.now();
    if (e) {
      if (e.wait) return e.wait;
      if (typeof e.text === 'string' && now - e.at < CSS_KEEP) return Promise.resolve(e.text);
      if (e.text === null && now - e.at < CSS_RETRY) return Promise.resolve(null);
      this.forgetCss(url);
    }
    const wait = this.cssDownload(ses, url, page).then((text) => {
      this.forgetCss(url);
      this.css.set(url, { text, at: Date.now() });
      this.cssBytes += text.length;
      // (the oldest go first)
      for (const [k, v] of this.css) { if (this.cssBytes <= CSS_ALL) break; if (!v.wait) this.forgetCss(k); }
      return text;
    }, () => { this.forgetCss(url); this.css.set(url, { text: null, at: Date.now() }); return null; });
    this.css.set(url, { wait, at: now });
    return wait;
  }

  forgetCss(url) {
    const e = this.css.get(url);
    if (e && typeof e.text === 'string') this.cssBytes -= e.text.length;
    this.css.delete(url);
  }

  // (six at a time: a page with a thousand of them waits its turn, as a browser's own requests would)
  async cssDownload(ses, url, page) {
    while ((this.cssActive || 0) >= 6) await new Promise((r) => (this.cssQueue || (this.cssQueue = [])).push(r));
    this.cssActive = (this.cssActive || 0) + 1;
    try { return await this.cssDownloadNow(ses, url, page); } finally {
      this.cssActive--;
      const next = this.cssQueue && this.cssQueue.shift();
      if (next) next();
    }
  }

  async cssDownloadNow(ses, url, page) {
    let u = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!/^https?:\/\//i.test(u)) throw new Error('not a web address');
      if (!(await this.cssReachable(ses, u, page))) throw new Error('on your own network');
      const r = await this.cssOnce(ses, u);
      if (r.redirect) { u = new URL(r.redirect, u).href; continue; }
      return r.text;
    }
    throw new Error('too many redirects');
  }

  // One request, without your cookies: { text } for CSS, { redirect } for a redirect (followed by cssDownloadNow,
  // which looks at where it goes first; Chromium's own following wouldn't wait for that).
  cssOnce(ses, url) {
    return new Promise((resolve, reject) => {
      let done = false;
      const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
      const req = net.request({ url, session: ses, redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
      const timer = setTimeout(() => { try { req.abort(); } catch { /* gone */ } end(reject, new Error('too slow')); }, 15000);
      req.on('redirect', (status, method, to) => { try { req.abort(); } catch { /* gone */ } end(resolve, { redirect: to }); });
      req.on('response', (res) => {
        const head = (k) => { const v = res.headers[k]; return Array.isArray(v) ? v[0] : v || ''; };
        if (res.statusCode < 200 || res.statusCode >= 300) { try { req.abort(); } catch { /* gone */ } return end(reject, new Error('answered ' + res.statusCode)); }
        // (only CSS: a page couldn't use anything else as a stylesheet either)
        const type = head('content-type');
        if (!/^text\/css\b/i.test(type)) { try { req.abort(); } catch { /* gone */ } return end(reject, new Error('not CSS')); }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > CSS_MAX) { try { req.abort(); } catch { /* gone */ } end(reject, new Error('too big')); } else chunks.push(c);
        });
        res.on('end', () => {
          const cs = /charset=["']?([\w-]+)/i.exec(type);
          let text;
          try { text = new TextDecoder(cs ? cs[1] : 'utf-8').decode(Buffer.concat(chunks)); } catch { text = Buffer.concat(chunks).toString('utf8'); }
          end(resolve, { text: text.replace(/^\uFEFF/, '') });
        });
        res.on('error', (e) => end(reject, e));
      });
      req.on('error', (e) => end(reject, e));
      req.end();
    });
  }

  // Not one from your own network (your router, a printer, a work site) for a page from the web: a page could
  // otherwise have Bifrost read those for it. (A page on your own network may.)
  async cssReachable(ses, url, page) {
    const local = async (u) => {
      let host;
      try { host = new URL(u).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return true; }
      if (/^[\d.]+$/.test(host) || host.includes(':')) return privateAddress(host);
      if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(host)) return true;
      try { const r = await ses.resolveHost(host); return (r.endpoints || []).some((e) => privateAddress(e.address)); } catch { return false; }
    };
    if (!(await local(url))) return true;
    return local(page);
  }

  // ---- pictures a turned page shows that may be icons (preload/recolor.js asks): Google draws most of its icons
  // as black glyphs on nothing, in pictures (a sprite as a background, an <img>), which don't show on Catppuccin's
  // dark base. Read here (without your cookies, none from your own network for a page on the web, as stylesheets
  // are), and given back in text's colors if it's an icon that wouldn't show in the page's colors (recolor.js's
  // recolorIcon: see-through, drawn in one gray; an SVG's colors, unless it's art); null for anything else.
  // Pictures in a tab's top page that may be previews of documents (makeInk, on Google's apps: from another site,
  // which the page can't read): each looked at where it is on the screen, small, and said to be paper or not
  // (null: not seen, the window hidden). Nothing of the picture goes back to the page. 12 at a time, 300 a page.
  async lookAt(event, arg) {
    const wc = event && event.sender;
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return null;
    if (event.senderFrame && event.senderFrame !== wc.mainFrame) return null;
    const rects = arg && Array.isArray(arg.rects) ? arg.rects.slice(0, 12) : [];
    const url = wc.getURL();
    let n = this.looks.get(wc.id);
    if (!n || n.url !== url) { n = { url, count: 0 }; this.looks.set(wc.id, n); if (this.looks.size > 200) this.looks.delete(this.looks.keys().next().value); }
    const core = recolorCore();
    const zoom = wc.getZoomFactor() || 1;
    const out = [];
    for (const r of rects) {
      const x = Number(r && r.x), y = Number(r && r.y), w = Number(r && r.w), h = Number(r && r.h);
      if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 40 || h < 30 || w > 4000 || h > 4000) { out.push(null); continue; }
      if (n.count >= 300) { out.push(false); continue; }
      n.count++;
      try {
        const img = await wc.capturePage({ x: Math.round(x * zoom), y: Math.round(y * zoom), width: Math.round(w * zoom), height: Math.round(h * zoom) });
        if (!img || img.isEmpty()) { out.push(null); continue; }
        const bmp = img.resize({ width: 40, height: 40, quality: 'good' }).toBitmap();
        out.push(bmp.length >= 1600 ? core.paperOf(bmp, w, h, true) : null);
      } catch { out.push(null); }
    }
    return out;
  }

  async iconFetch(event, url) {
    const page = this.cssAsker(event);
    if (!page || !url) return null;
    const pal = this.recolorFor(page, event.sender.getURL());
    if (!pal) return null;
    const key = pal.key + '\u0001' + url;
    const e = this.icons.get(key);
    if (e) return e.wait || e.data;
    const wait = this.iconMake(event.sender.session, url, page, pal).catch(() => null).then((data) => {
      this.icons.set(key, { data, at: Date.now() });
      this.iconBytes += data ? data.length : 0;
      // (the oldest go first: at most this many, and this much)
      for (const [k, v] of this.icons) {
        if (this.icons.size <= ICON_COUNT && this.iconBytes <= ICON_ALL) break;
        if (v.wait) continue;
        this.iconBytes -= v.data ? v.data.length : 0;
        this.icons.delete(k);
      }
      return data;
    });
    this.icons.set(key, { wait });
    return wait;
  }

  async iconMake(ses, url, page, pal) {
    let body, type;
    const d = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(url);
    if (d) {
      type = d[1].toLowerCase();
      const raw = url.slice(d[0].length);
      body = /;base64/i.test(d[2]) ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw), 'utf8');
    } else {
      const r = await this.picDownload(ses, url, page);
      body = r.body;
      type = r.type;
    }
    if (!body || !body.length || body.length > PIC_MAX) return null;
    const core = recolorCore();
    let P = this.iconPalettes.get(pal.key);
    if (!P) { P = core.prepare(pal.palette); this.iconPalettes.set(pal.key, P); }
    if (/svg/i.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(body.slice(0, 400).toString('utf8'))) {
      const out = core.svgText(P, body.toString('utf8'));
      return out ? 'data:image/svg+xml;base64,' + Buffer.from(out, 'utf8').toString('base64') : null;
    }
    const img = nativeImage.createFromBuffer(body);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!width || !height || width * height > 1200000) return null;
    const px = img.toBitmap();
    if (!core.recolorIcon(P, px, width, height)) return null;
    return 'data:image/png;base64,' + nativeImage.createFromBitmap(px, { width, height }).toPNG().toString('base64');
  }

  // A picture: { body, type }, through the same six at a time as stylesheets, redirects looked at first.
  async picDownload(ses, url, page) {
    while ((this.cssActive || 0) >= 6) await new Promise((r) => (this.cssQueue || (this.cssQueue = [])).push(r));
    this.cssActive = (this.cssActive || 0) + 1;
    try {
      let u = url;
      for (let hop = 0; hop < 4; hop++) {
        if (!/^https?:\/\//i.test(u)) throw new Error('not a web address');
        if (!(await this.cssReachable(ses, u, page))) throw new Error('on your own network');
        const r = await this.picOnce(ses, u);
        if (r.redirect) { u = new URL(r.redirect, u).href; continue; }
        return r;
      }
      throw new Error('too many redirects');
    } finally {
      this.cssActive--;
      const next = this.cssQueue && this.cssQueue.shift();
      if (next) next();
    }
  }

  picOnce(ses, url) {
    return new Promise((resolve, reject) => {
      let done = false;
      const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
      const req = net.request({ url, session: ses, redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
      const timer = setTimeout(() => { try { req.abort(); } catch { /* gone */ } end(reject, new Error('too slow')); }, 15000);
      req.on('redirect', (status, method, to) => { try { req.abort(); } catch { /* gone */ } end(resolve, { redirect: to }); });
      req.on('response', (res) => {
        const v = res.headers['content-type'];
        const type = String(Array.isArray(v) ? v[0] : v || '');
        if (res.statusCode < 200 || res.statusCode >= 300) { try { req.abort(); } catch { /* gone */ } return end(reject, new Error('answered ' + res.statusCode)); }
        // (only pictures: a page couldn't show anything else as one either)
        if (!/^image\//i.test(type)) { try { req.abort(); } catch { /* gone */ } return end(reject, new Error('not a picture')); }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size > PIC_MAX) { try { req.abort(); } catch { /* gone */ } end(reject, new Error('too big')); } else chunks.push(c); });
        res.on('end', () => end(resolve, { body: Buffer.concat(chunks), type }));
        res.on('error', (e) => end(reject, e));
      });
      req.on('error', (e) => end(reject, e));
      req.end();
    });
  }

  // ---------------------------------------------------------------- your theme on websites
  // The theme Catppuccin's styles are built in now: { flavor, palette, key }.
  themeNow() {
    const a = ctx.settings.get('appearance') || {};
    const t = Themes.resolve(a, { systemDark: nativeTheme.shouldUseDarkColors });
    const own = Themes.THEMES[t.key];
    t.customAccent = !!(own && a.useCustomAccent && String(t.accent).toLowerCase() !== String(own.accent).toLowerCase());
    const b = C.themeBuild(t);
    return { ...b, key: crypto.createHash('sha1').update(JSON.stringify(b)).digest('hex').slice(0, 16) };
  }

  // What a page gets of a style in your theme: its build for this theme, or (while that's being built, after the
  // theme changed) the last theme's; null when there's none for its code as it is now.
  themedSections(s) {
    return this.themeKey && s.themed && s.themed.of === s.updatedAt && s.themed.sections ? s.themed.sections : null;
  }

  // Whether a style is built for the theme as it is now (or couldn't be: error).
  themedNow(s) {
    return !!(s.themed && s.themed.key === this.themeKey && s.themed.of === s.updatedAt);
  }

  // A style built in a theme: s.themed's { key, of, sections } (or { …, error }).
  async buildThemed(s, th) {
    try {
      const b = await this.build(s.code, { ...(s.values || {}), lightFlavor: th.flavor, darkFlavor: th.flavor }, { theme: th });
      return { key: th.key, of: s.updatedAt, sections: b.sections };
    } catch (e) {
      return { key: th.key, of: s.updatedAt, sections: null, error: String((e && e.message) || e) };
    }
  }

  themeSoon() {
    clearTimeout(this.themeTimer);
    this.themeTimer = setTimeout(() => this.retheme(), 300);
  }

  // Catppuccin's styles built for the theme now, those not built for it yet, one at a time: the ones for the
  // pages you have open first. A newer theme (or turning it off) stops a run; another starts for what's left.
  // Off: the builds go.
  async retheme() {
    if (!this.config().matchTheme) {
      const had = this.styles.some((s) => s.themed);
      for (const s of this.styles) delete s.themed;
      if (this.themeKey || had) { this.themeKey = ''; if (had) this.save({ rethemed: true }); else this.pushSoon(); this.emit('theme', this.themeStatus()); }
      return;
    }
    const th = this.themeNow();
    if (th.key !== this.themeKey) { this.themeKey = th.key; this.pushSoon(); }
    if (this.theming) { this.themeAgain = true; return; }
    this.theming = th;
    let built = 0;
    try {
      const todo = this.styles.filter((s) => C.isCatppuccin(s.code, s.vars) && !this.themedNow(s));
      if (!todo.length) return;
      const open = webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getType() === 'webview').map((w) => w.getURL()).filter(isWeb);
      const forOpen = new Set(todo.filter((s) => open.some((u) => s.sections.some((x) => !U.isGlobal(x) && U.sectionMatches(x, u)))));
      todo.sort((a, b) => forOpen.has(b) - forOpen.has(a));
      this.themeProgress = { done: 0, total: todo.length };
      this.emit('theme', this.themeStatus());
      for (const s of todo) {
        if (this.themeKey !== th.key || !this.config().matchTheme) break;
        if (this.styles.includes(s) && !this.themedNow(s)) {
          const themed = await this.buildThemed(s, th);
          // (changed meanwhile: built again next time)
          if (themed.of === s.updatedAt) s.themed = themed;
          built++;
          // An open page gets its style as soon as it's ready (the rest, at the end).
          if (forOpen.has(s)) this.pushAll();
        }
        this.themeProgress.done++;
        this.emit('theme', this.themeStatus());
      }
    } finally {
      this.themeProgress = null;
      if (built) this.save({ rethemed: true });
      this.theming = null;
      this.emit('theme', this.themeStatus());
      if (this.themeAgain) { this.themeAgain = false; this.themeSoon(); }
    }
  }

  // For Settings: how many of your styles are Catppuccin's, how many are in your theme, how far a build is.
  themeStatus() {
    const ctp = this.styles.filter((s) => C.isCatppuccin(s.code, s.vars));
    return {
      on: !!this.config().matchTheme, styles: ctp.length, ready: ctp.filter((s) => this.themedNow(s) && s.themed.sections).length,
      failed: ctp.filter((s) => s.themed && s.themed.key === this.themeKey && s.themed.error).map((s) => ({ name: s.name, error: s.themed.error })),
      building: this.themeProgress ? { ...this.themeProgress } : null,
    };
  }

  // ---------------------------------------------------------------- your styles
  // Changed: pages get it at once; the file (several MB with many styles) a moment later, off the main thread's
  // way, or right away when Bifrost quits (saveNow).
  // Your styles changed (themed: their builds in your theme did too; rethemed: only those did, as saving builds in
  // your theme, so none to start).
  save({ themed = false, rethemed = false } = {}) {
    if (!rethemed && this.config().matchTheme) { if (this.theming) this.themeAgain = true; else this.themeSoon(); }
    if (!rethemed) this.dirty = true;
    if (themed || rethemed) this.themedDirty = true;
    this.gen = (this.gen || 0) + 1;
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.write(), 400);
    if (!rethemed) this.emit('changed');
    this.pushSoon();
  }

  // The files to write, as [file, () => text]: styles.json, and the builds in your theme on their own (they'd
  // double it, and a change to a style doesn't change them).
  toWrite() {
    const out = [];
    if (this.dirty) out.push([this.file, () => JSON.stringify({ version: 1, styles: this.styles.map(({ themed, ...s }) => s) })]);
    if (this.themedDirty) out.push([this.themedFile, () => JSON.stringify({ version: 1, styles: Object.fromEntries(this.styles.filter((s) => s.themed).map((s) => [s.id, s.themed])) })]);
    this.dirty = this.themedDirty = false;
    return out;
  }

  async write() {
    if (!this.dirty && !this.themedDirty) return;
    if (this.writing) { this.writeTimer = setTimeout(() => this.write(), 400); return; }
    const gen = this.gen;
    this.writing = true;
    for (const [file, text] of this.toWrite()) {
      const again = () => { if (file === this.file) this.dirty = true; else this.themedDirty = true; };
      const tmp = file + '.tmp';
      try {
        await fs.promises.writeFile(tmp, text());
        // (written again meanwhile, by saveNow: that one's newer; changed meanwhile: written again, with that)
        if (this.wroteNow !== undefined && this.wroteNow >= gen) continue;
        if (gen !== this.gen) { again(); continue; }
        await fs.promises.rename(tmp, file);
      } catch (e) { console.error('[styles] save failed', e); again(); }
    }
    this.writing = false;
  }

  saveNow() {
    clearTimeout(this.writeTimer);
    if (!this.dirty && !this.themedDirty && !this.writing) return;
    // (one being written may not be done before Bifrost quits: both, then)
    if (this.writing) { this.dirty = true; this.themedDirty = true; }
    this.wroteNow = this.gen;
    for (const [file, text] of this.toWrite()) {
      try {
        const tmp = file + '.now.tmp';
        fs.writeFileSync(tmp, text());
        fs.renameSync(tmp, file);
      } catch (e) { console.error('[styles] save failed', e); }
    }
  }

  summary(s) {
    return {
      id: s.id, name: s.name, enabled: !!s.enabled, version: (s.meta && s.meta.version) || '', description: (s.meta && s.meta.description) || '',
      author: (s.meta && s.meta.author) || '', homepage: (s.meta && s.meta.homepageURL) || '', updateURL: (s.meta && s.meta.updateURL) || s.installedFrom || '',
      preprocessor: (s.meta && s.meta.preprocessor) || 'default', sites: U.sitesOf(s.sections), from: s.origin || 'usercss',
      editable: !!s.code && !/^stylus$/i.test(String((s.meta && s.meta.preprocessor) || '')), vars: s.vars || [], values: s.values || {}, updatedAt: s.updatedAt || 0, error: s.error || '',
    };
  }

  list() { return this.styles.map((s) => this.summary(s)); }
  get(id) { const s = this.styles.find((x) => x.id === id); return s ? { ...this.summary(s), code: s.code || '' } : null; }

  // A style's code -> { meta, vars, sections }: LESS built in the worker, CSS it imports put in.
  async build(code, values, { theme = null } = {}) {
    const head = U.parseHeader(code);
    const pre = head ? String(head.meta.preprocessor || 'default').toLowerCase() : 'default';
    const built = pre === 'less' ? await this.builder.build(code, values || {}, theme) : U.build(code, values || {});
    built.sections = await this.inlineImports(built.sections);
    return built;
  }

  // @import url(…) [media]; in a style's parts -> the CSS it names, in its place (in @media when it says one),
  // with its own relative url()s made whole. One that can't be downloaded is left as it is.
  async inlineImports(sections, depth = 0) {
    const out = [];
    for (const sec of sections || []) {
      if (!/@import\b/i.test(sec.code)) { out.push(sec); continue; }
      out.push({ ...sec, code: await this.inlineCss(sec.code, '', depth) });
    }
    return out;
  }

  async inlineCss(code, base, depth) {
    const re = /@import\s+(?:url\(\s*(["']?)([^"')]*)\1\s*\)|(["'])([^"']*)\3)\s*([^;{}]*);/gi;
    let result = '';
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      result += code.slice(last, m.index);
      last = re.lastIndex;
      let url = m[2] != null ? m[2] : m[4];
      try { url = new URL(url, base || undefined).href; } catch { result += m[0]; continue; }
      if (!/^https?:/i.test(url) || depth > 3) { result += m[0]; continue; }
      let css;
      try { css = await this.builder.load(url); } catch { result += m[0]; continue; }
      css = await this.inlineCss(absoluteUrls(css.replace(/@charset\s+[^;]*;/gi, ''), url), url, depth + 1);
      const cond = String(m[5] || '').trim();
      const layer = /^layer(?:\(([^)]*)\))?\s*/i.exec(cond);
      let wrapped = css;
      let rest = cond;
      if (layer) { wrapped = `@layer${layer[1] ? ' ' + layer[1].trim() : ''} {\n${wrapped}\n}`; rest = cond.slice(layer[0].length); }
      const supports = /^supports\(((?:[^()]|\([^()]*\))*)\)\s*/i.exec(rest);
      if (supports) { wrapped = `@supports (${supports[1]}) {\n${wrapped}\n}`; rest = rest.slice(supports[0].length); }
      if (rest.trim()) wrapped = `@media ${rest.trim()} {\n${wrapped}\n}`;
      result += `/* ${url} */\n${wrapped}\n`;
    }
    return result + code.slice(last);
  }

  // Code written or installed -> the style (new, or the one with this id, or the one with the same name and
  // namespace: installing a style again updates it). Throws when it can't be built.
  async put(code, { id = null, values = null, from = 'usercss', url = '' } = {}) {
    const old = id ? this.styles.find((s) => s.id === id) : null;
    if (id && !old) throw new Error('That style is gone.');
    const keep = values || (old && old.values) || {};
    const built = await this.build(code, keep);
    const same = old || this.styles.find((s) => s.meta && s.meta.name === built.meta.name && (s.meta.namespace || '') === (built.meta.namespace || ''));
    const style = {
      id: same ? same.id : 'st-' + crypto.randomBytes(6).toString('hex'),
      name: built.meta.name,
      enabled: same ? same.enabled : true,
      code: String(code),
      meta: built.meta,
      vars: built.vars,
      values: keep,
      sections: built.sections,
      exclusions: same ? same.exclusions || [] : [],
      origin: same ? same.origin || from : from,
      installedFrom: url || (same && same.installedFrom) || '',
      installedAt: same ? same.installedAt : Date.now(),
      updatedAt: Date.now(),
      error: '',
    };
    // In your theme too, while websites match it: open pages go straight to the new one.
    if (this.themeKey && C.isCatppuccin(style.code, style.vars)) style.themed = await this.buildThemed(style, this.themeNow());
    const at = this.styles.findIndex((s) => s.id === style.id);
    if (at >= 0) this.styles[at] = style;
    else this.styles.push(style);
    this.save({ themed: !!style.themed });
    return this.summary(style);
  }

  setEnabled(id, on) {
    const s = this.styles.find((x) => x.id === id);
    if (!s) return false;
    s.enabled = !!on;
    this.save();
    return true;
  }

  remove(id) {
    const n = this.styles.length;
    this.styles = this.styles.filter((s) => s.id !== id);
    if (this.styles.length !== n) this.save();
    return this.styles.length !== n;
  }

  // A Stylus backup's text (or a file for importing into Stylus) -> its styles added (one with the same name and
  // namespace replaced). Those that come without CSS are built here; ones that can't be are left out, and said.
  async importStylus(text) {
    let data;
    try { data = JSON.parse(String(text || '')); } catch { throw new Error('That file isn’t a Stylus backup (it isn’t JSON).'); }
    const found = U.fromStylusBackup(data);
    if (!found.length) throw new Error('There are no styles in that file.');
    const failed = [];
    let done = 0;
    const total = found.filter((f) => f.needsBuild).length;
    if (total) this.emit('progress', { done, total });
    await Promise.all(found.map(async (f) => {
      try {
        if (f.needsBuild) {
          const built = await this.build(f.code, f.values);
          f.sections = built.sections;
          f.vars = built.vars;
          f.meta = { ...built.meta, ...Object.fromEntries(Object.entries(f.meta || {}).filter(([, v]) => v)) };
        } else f.sections = await this.inlineImports(f.sections);
      } catch (e) {
        f.failed = String((e && e.message) || e);
        // (one Stylus built from its own language: its backup has the CSS when it's saved with Shift+click)
        if (e && e.code === 'preprocessor' && e.preprocessor === 'stylus') f.failed += ' In Stylus, Shift+click Export to save a backup with the CSS Stylus built, and bring that in.';
        failed.push({ name: f.name, error: f.failed });
      }
      if (f.needsBuild) { done++; this.emit('progress', { done, total }); }
    }));
    let added = 0;
    let replaced = 0;
    for (const f of found) {
      if (f.failed) continue;
      const same = this.styles.find((s) => s.name === f.name && ((s.meta && s.meta.namespace) || '') === ((f.meta && f.meta.namespace) || ''));
      const style = {
        id: same ? same.id : 'st-' + crypto.randomBytes(6).toString('hex'),
        name: f.name, enabled: f.enabled, code: f.code, meta: f.meta, vars: f.vars, values: f.values, sections: f.sections,
        exclusions: f.exclusions, origin: 'stylus', installedFrom: (f.meta && f.meta.updateURL) || '', installedAt: same ? same.installedAt : Date.now(), updatedAt: Date.now(), error: '',
      };
      if (same) { this.styles[this.styles.indexOf(same)] = style; replaced++; } else { this.styles.push(style); added++; }
    }
    if (added || replaced) this.save();
    return { added, replaced, total: found.length, failed };
  }

  // A style's code from a link (to install, or to update one).
  async fetchCode(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('That isn’t a web address.');
    let r;
    try { r = await net.fetch(url, { cache: 'no-store' }); } catch (e) { throw new Error('It couldn’t be downloaded: ' + (e.message || e)); }
    if (!r.ok) throw new Error(`It couldn’t be downloaded (the site answered ${r.status}).`);
    const code = await r.text();
    if (code.length > 2 * 1024 * 1024) throw new Error('That’s too big to be a style.');
    return code;
  }

  // What installing a link would install (shown before you say yes).
  async preview(url) {
    const code = await this.fetchCode(url);
    const head = U.parseHeader(code);
    if (!head || !head.meta.name) throw new Error('That isn’t a userstyle (it has no ==UserStyle== header with a @name).');
    let sites = [];
    let error = '';
    try { sites = U.sitesOf((await this.build(code, {})).sections); } catch (e) { error = e.message; }
    const same = this.styles.find((s) => s.meta && s.meta.name === head.meta.name && (s.meta.namespace || '') === (head.meta.namespace || ''));
    return { code, name: head.meta.name, version: head.meta.version || '', description: head.meta.description || '', author: head.meta.author || '', sites, error, installed: same ? (same.meta.version || '?') : null };
  }

  // Newer versions of styles that say where to find them (not ones in Stylus's own language: they can't be built).
  async checkUpdates() {
    const out = { updated: [], current: 0, skipped: [], failed: [] };
    for (const s of this.styles.slice()) {
      const url = (s.meta && s.meta.updateURL) || s.installedFrom;
      if (!url) continue;
      const pre = String((s.meta && s.meta.preprocessor) || 'default').toLowerCase();
      if (pre === 'stylus') { out.skipped.push(s.name); continue; }
      try {
        const code = await this.fetchCode(url);
        const head = U.parseHeader(code);
        if (!head || !head.meta.name) throw new Error('not a userstyle any more');
        if (compareVersions(head.meta.version, s.meta && s.meta.version) <= 0) { out.current++; continue; }
        await this.put(code, { id: s.id, url });
        out.updated.push(`${s.name} ${head.meta.version}`);
      } catch (e) { out.failed.push(`${s.name}: ${e.message}`); }
    }
    return out;
  }
}

// url(…)s in CSS from `base`, made whole (it's going into another page's stylesheet).
function absoluteUrls(css, base) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, u) => {
    if (/^(data:|https?:|#|\/\/)/i.test(u.trim())) return m;
    try { return `url(${q || '"'}${new URL(u.trim(), base).href}${q || '"'})`; } catch { return m; }
  });
}

function clamp(v, lo, hi, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : def;
}

// "2026.08.16" vs "2026.8.2", "1.10.0" vs "1.9": 1 when a is newer, -1 when older, 0 the same.
function compareVersions(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = { WebStyles, compareVersions };
