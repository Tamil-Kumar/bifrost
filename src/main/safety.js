'use strict';
// Warnings for dangerous sites, like Chrome's Safe Browsing pages: a page known for phishing, malware or
// scams is stopped before it loads, and its tab shows a warning instead, with a way through if you're
// sure. Frames from those addresses inside other pages are just blocked, and so are downloads from them.
// The lists are the ones uBlock Origin offers: malware-filter's Phishing URL Blocklist and Malicious URL
// Blocklist (URLhaus), and uBlock's own "Badware risks". They're kept up to date twice a day; uBlock's is
// also bundled, for the very first start. This works whether ad blocking is on or not.
const { app, net, webContents: WC, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');
const ctx = require('./context');

const TEST = process.env.BIFROST_TEST === '1';
const BUNDLED = path.join(__dirname, '..', '..', 'assets', 'safety');
const GHOSTERY = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/';
const MF = (file) => [`https://malware-filter.gitlab.io/malware-filter/${file}`, `https://curbengh.github.io/malware-filter/${file}`, `https://malware-filter.pages.dev/${file}`];
// What each list warns about, and where it's kept up to date (mirrors, in order).
const LISTS = {
  phishing: { kind: 'phishing', name: 'Phishing URL Blocklist', urls: MF('phishing-filter.txt') },
  malware: { kind: 'malware', name: 'Malicious URL Blocklist (URLhaus)', urls: MF('urlhaus-filter-online.txt') },
  badware: { kind: 'scam', name: 'uBlock filters – Badware risks', urls: [GHOSTERY + 'ublock-origin/badware.txt', 'https://ublockorigin.github.io/uAssets/filters/badware.txt', 'https://ublockorigin.pages.dev/filters/badware.min.txt'] },
};
const UPDATE_HOURS = 12;

class Safety {
  constructor() {
    this.engines = new Map();   // list -> FiltersEngine
    this.allowed = new Set();   // hosts you chose to visit anyway (until Bifrost quits)
    this.loading = null;
    this.timer = null;
    this.blocked = 0;
  }

  get enabled() { return ctx.settings.get('privacy.dangerousSites') !== false; }
  get dir() { return path.join(app.getPath('userData'), 'safety'); }

  init() {
    // The tests use their own lists (BIFROST_SAFETY_LISTS: a folder with <list>.txt files) and fetch nothing.
    this.testDir = TEST ? process.env.BIFROST_SAFETY_LISTS || '' : '';
    this.load().catch((e) => console.warn('[safety] load', e.message));
    if (!this.testDir) this.schedule();
  }

  // ------------------------------------------------------------------- lists
  listText(name) {
    if (this.testDir) { try { return fs.readFileSync(path.join(this.testDir, name + '.txt'), 'utf8'); } catch { return ''; } }
    const updated = path.join(this.dir, name + '.txt');
    if (fs.existsSync(updated)) return fs.readFileSync(updated, 'utf8');
    const bundled = path.join(BUNDLED, name + '.txt.gz');
    return fs.existsSync(bundled) ? zlib.gunzipSync(fs.readFileSync(bundled)).toString('utf8') : '';
  }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { FiltersEngine } = require('../vendor/adblocker/engine-core.js');
      for (const name of Object.keys(LISTS)) {
        const text = this.listText(name);
        if (!text.trim()) { this.engines.delete(name); continue; }
        try { this.engines.set(name, FiltersEngine.deserialize(new Uint8Array(await build(text)))); } catch (e) { console.warn('[safety]', name, e.message); }
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  async update() {
    fs.mkdirSync(this.dir, { recursive: true });
    let changed = false;
    for (const [name, list] of Object.entries(LISTS)) {
      for (const url of list.urls) {
        try {
          const r = await net.fetch(url, { cache: 'no-store' });
          if (!r.ok) continue;
          const text = await r.text();
          // (A mirror answering with a web page rather than the list doesn't replace the last good copy.)
          if (!/^\s*[!#[]|^\|\|/m.test(text.slice(0, 4000)) || text.length < 100) continue;
          fs.writeFileSync(path.join(this.dir, name + '.txt.tmp'), text);
          fs.renameSync(path.join(this.dir, name + '.txt.tmp'), path.join(this.dir, name + '.txt'));
          changed = true;
          break;
        } catch { /* next mirror */ }
      }
    }
    ctx.db.kvSet('safety.updated', Date.now());
    if (changed) await this.load();
  }

  schedule() {
    clearTimeout(this.timer);
    const last = ctx.db.kvGet('safety.updated', 0);
    // Soon after the first start (there's only uBlock's bundled list until then), then twice a day.
    const due = Math.max(last ? 60e3 : 20e3, last + UPDATE_HOURS * 3600e3 - Date.now());
    this.timer = setTimeout(() => {
      (this.enabled ? this.update() : Promise.resolve()).catch((e) => console.warn('[safety] update', e.message)).finally(() => this.schedule());
    }, Math.min(due, 2 ** 31 - 1));
  }

  // ------------------------------------------------------------------ checks
  // Which list an address is on ({ list, kind } or null).
  check(url, type = 'mainFrame', sourceUrl = '') {
    if (!this.enabled || !this.engines.size || !/^https?:/i.test(url)) return null;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
    if (this.isAllowed(host)) return null;
    const { Request } = require('../vendor/adblocker/engine-core.js');
    const req = Request.fromRawDetails({ url, type, sourceUrl });
    for (const name of ['phishing', 'malware', 'badware']) {
      const engine = this.engines.get(name);
      if (!engine) continue;
      let r;
      try { r = engine.match(req); } catch { continue; }
      if (r && r.match && !r.exception) return { list: name, kind: LISTS[name].kind, listName: LISTS[name].name };
    }
    return null;
  }

  isAllowed(host) {
    for (const h of this.allowed) if (host === h || host.endsWith('.' + h)) return true;
    return false;
  }

  allow(url) {
    try { const host = new URL(url).hostname.toLowerCase(); if (host) this.allowed.add(host); return true; } catch { return false; }
  }

  // A session's requests: pages (with a warning) and frames.
  attach(ses, hub) {
    hub.before.unshift((d) => {
      if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') return;
      const hit = this.check(d.url, d.resourceType, d.resourceType === 'subFrame' ? (d.referrer || '') : '');
      if (!hit) return;
      this.blocked++;
      if (d.resourceType === 'mainFrame') this.warn(d.webContentsId, d.url, hit);
      return { cancel: true };
    });
  }

  // Tells the tab's window why its page didn't load (it shows the warning); a page in a pop-up window gets
  // the warning as its page.
  warn(wcId, url, hit) {
    const wc = wcId != null ? WC.fromId(wcId) : null;
    if (!wc || wc.isDestroyed()) return;
    // A tab (its window may not have reported it yet: then by the window it's in).
    let ctl = (ctx.registry.find(wcId) || {}).ctl || null;
    if (!ctl && wc.getType() === 'webview' && wc.hostWebContents) {
      const win = BrowserWindow.fromWebContents(wc.hostWebContents);
      ctl = win ? ctx.registry.get(win.id) : null;
    }
    if (ctl) { ctl.send('dangerous-site', { wcId, url, kind: hit.kind, list: hit.listName }); return; }
    setTimeout(() => { if (!wc.isDestroyed()) wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(popupPage(url, hit))).catch(() => {}); }, 0);
  }

  status() {
    return { enabled: this.enabled, lists: Object.entries(LISTS).map(([k, l]) => ({ id: k, name: l.name, loaded: this.engines.has(k) })), updated: ctx.db.kvGet('safety.updated', 0), blocked: this.blocked };
  }
}

function build(text) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'safety-worker.js'), { workerData: { text } });
    w.once('message', (m) => { w.terminate(); m.ok ? resolve(m.buffer) : reject(new Error(m.error)); });
    w.once('error', reject);
  });
}

const TEXT = {
  phishing: ['Deceptive site ahead', 'This site may trick you into doing something dangerous, like giving away your passwords or card details, or installing software.'],
  malware: ['This site spreads malware', 'It’s known for programs that can steal or delete your information, or take over your computer.'],
  scam: ['This site is known for scams', 'It’s listed for scams, fake downloads or unwanted software.'],
};
function popupPage(url, hit) {
  const [title, text] = TEXT[hit.kind] || TEXT.scam;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#b3261e;color:#fff;font:15px system-ui,sans-serif}main{max-width:440px;padding:32px}h1{font-size:24px;margin:0 0 12px}p{line-height:1.5;opacity:.92}code{word-break:break-all;opacity:.8}button{margin-top:14px;font:inherit;padding:9px 18px;border-radius:8px;border:0;background:#fff;color:#b3261e;font-weight:600;cursor:pointer}</style><main><h1>${esc(title)}</h1><p>${esc(text)}</p><p><code>${esc(url)}</code></p><p>Bifrost stopped it loading: it’s on the ${esc(hit.listName)}.</p><button onclick="window.close()">Close this window</button></main>`;
}

module.exports = { Safety, TEXT };
