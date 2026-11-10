'use strict';
// How websites look: Bifrost's dark mode for websites, and your styles (userstyles, as in Stylus).
//
// Dark mode (settings webStyles): Chromium's own dark mode for web pages, turned on tab by tab through the
// DevTools protocol (main/web-theme.js does that): pages are darkened as they're drawn, with no script in
// them, and a site with a dark theme of its own is told to use it instead (prefers-color-scheme: dark), which
// Chromium then leaves alone. On for every site or for none, with sites of your own either way (darkSites:
// { 'example.com': true | false }, the most specific one counts), and brightness, contrast and sepia over it.
//
// Your styles (Settings → Website styles): usercss styles (src/shared/usercss.js) installed from a link,
// written here, or brought over from Stylus (a backup, with the CSS Stylus built, or a file made for importing
// into Stylus, like Catppuccin's, built here); kept in styles.json in the profile (not in the settings, which
// every page is sent on each change). Styles written in LESS are built in a worker (less-builder.js). The CSS a
// style @imports is put in it when it's built (a stylesheet Bifrost gives a page can't import). Each page and
// frame gets the parts that are for it, with the site's own style (its info popover → Add a style) after them, as
// one stylesheet the tab preload adopts before the page draws (preload/tab.js), and again whenever they change.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { net, webContents } = require('electron');
const { EventEmitter } = require('node:events');
const ctx = require('./context');
const U = require('../shared/usercss');
const { LessBuilder } = require('./less-builder');

const isWeb = (url) => /^(https?|file):/i.test(String(url || ''));
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const siteKey = (host) => String(host || '').toLowerCase().replace(/^www\./, '');

class WebStyles extends EventEmitter {
  constructor() {
    super();
    this.file = null;
    this.styles = [];
    this.pushTimer = null;
    this.builder = new LessBuilder();
  }

  init() {
    this.file = path.join(ctx.profile.dir, 'styles.json');
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data && Array.isArray(data.styles)) this.styles = data.styles.filter((s) => s && s.id && Array.isArray(s.sections));
    } catch { this.styles = []; }
    ctx.settings.on('changed', ({ path: p }) => {
      if (p && !p.startsWith('webStyles')) return;
      try { require('./web-theme').apply(); } catch { /* not ready */ }
      this.pushSoon();
    });
  }

  config() { return ctx.settings.get('webStyles') || {}; }

  // ---------------------------------------------------------------- dark mode
  // The site's own choice (most specific first), else everywhere's.
  siteDark(host, sites = this.config().darkSites || {}) {
    let h = siteKey(host);
    while (h) {
      if (Object.prototype.hasOwnProperty.call(sites, h)) return !!sites[h];
      const dot = h.indexOf('.');
      if (dot < 0) break;
      h = h.slice(dot + 1);
    }
    return null;
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
      const code = s.sections.filter((x) => U.sectionMatches(x, url)).map((x) => x.code).join('\n');
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
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
      let frames = [];
      try { frames = wc.mainFrame.framesInSubtree; } catch { continue; }
      for (const f of frames) {
        try { if (isWeb(f.url)) f.send('tab-site-css', this.cssFor(f.url, f === wc.mainFrame || !f.parent)); } catch { /* frame gone */ }
      }
    }
  }

  // ---------------------------------------------------------------- your styles
  // Changed: pages get it at once; the file (several MB with many styles) a moment later, off the main thread's
  // way, or right away when Bifrost quits (saveNow).
  save() {
    this.dirty = true;
    this.gen = (this.gen || 0) + 1;
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.write(), 400);
    this.emit('changed');
    this.pushSoon();
  }

  async write() {
    if (!this.dirty) return;
    if (this.writing) { this.writeTimer = setTimeout(() => this.write(), 400); return; }
    const gen = this.gen;
    this.dirty = false;
    this.writing = true;
    const tmp = this.file + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, styles: this.styles }));
      // (written again meanwhile, by saveNow: that one's newer)
      if (gen === this.gen && this.wroteNow !== gen) await fs.promises.rename(tmp, this.file);
    } catch (e) { console.error('[styles] save failed', e); this.dirty = true; }
    this.writing = false;
  }

  saveNow() {
    clearTimeout(this.writeTimer);
    if (!this.dirty && !this.writing) return;
    this.dirty = false;
    this.wroteNow = this.gen;
    try {
      const tmp = this.file + '.now.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, styles: this.styles }));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[styles] save failed', e); }
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
  async build(code, values) {
    const head = U.parseHeader(code);
    const pre = head ? String(head.meta.preprocessor || 'default').toLowerCase() : 'default';
    const built = pre === 'less' ? await this.builder.build(code, values || {}) : U.build(code, values || {});
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
    if (same) this.styles[this.styles.indexOf(same)] = style;
    else this.styles.push(style);
    this.save();
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
