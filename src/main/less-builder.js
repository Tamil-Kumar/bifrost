'use strict';
// Userstyles written in LESS, built in a worker thread (less-worker.js, with Bifrost's LESS compiler in
// src/shared/less.js), so a big style, or a whole Stylus import of them, doesn't hold up the browser. One build at
// a time, each with a time limit; the worker goes away when it has been idle a while.
//
// The files styles @import (LESS libraries, and the CSS some styles pull in) are downloaded here: kept for an
// hour, and in the profile (userstyle-imports/) for when they can't be downloaded again. Catppuccin's libraries
// are also bundled (assets/userstyles/catppuccin), for a first build offline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { net } = require('electron');
const ctx = require('./context');

const BUNDLED = [
  { prefix: 'https://userstyles.catppuccin.com/lib/', dir: path.join(__dirname, '..', '..', 'assets', 'userstyles', 'catppuccin', 'lib') },
];
const TIME_LIMIT = 30 * 1000;      // one style
const IDLE = 60 * 1000;            // the worker, unused
const FRESH = 60 * 60 * 1000;      // a download
const DOWNLOAD_WAIT = 10 * 1000;
const MAX_FILE = 2 * 1024 * 1024;

class LessBuilder {
  constructor() {
    this.worker = null;
    this.queue = [];
    this.running = null;
    this.seq = 0;
    this.idleTimer = null;
    this.files = new Map();        // url -> { text, at }
  }

  // usercss code (with @preprocessor less) -> { meta, vars, sections }; rejects with why it can't be built.
  build(code, values) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.seq, code: String(code), values: values || {}, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.running || !this.queue.length) return;
    clearTimeout(this.idleTimer);
    const job = this.queue.shift();
    this.running = job;
    let w;
    try { w = this.ensure(); } catch (e) { this.finish(job, e); return; }
    job.timer = setTimeout(() => this.kill(new Error('Building it took too long (more than 30 seconds).')), TIME_LIMIT);
    w.postMessage({ type: 'build', id: job.id, code: job.code, values: job.values });
  }

  ensure() {
    if (this.worker) return this.worker;
    const w = new Worker(path.join(__dirname, 'less-worker.js'));
    w.on('message', (m) => this.onMessage(w, m));
    w.on('error', (e) => { if (this.worker === w) this.kill(e); });
    w.on('exit', () => {
      if (this.worker !== w) return;
      this.worker = null;
      if (this.running) this.finish(this.running, new Error('The LESS builder stopped.'));
    });
    this.worker = w;
    return w;
  }

  onMessage(w, m) {
    const job = this.running;
    if (!m || !job || m.id !== job.id || w !== this.worker) return;
    if (m.type === 'load') {
      this.load(m.url).then(
        (text) => { if (this.worker === w) w.postMessage({ type: 'loaded', id: m.id, url: m.url, text }); },
        (e) => { if (this.worker === w) w.postMessage({ type: 'loaded', id: m.id, url: m.url, error: String((e && e.message) || e) }); });
      return;
    }
    if (m.type === 'done') this.finish(job, m.error ? new Error(m.error) : null, m.result);
  }

  finish(job, err, result) {
    clearTimeout(job.timer);
    if (this.running === job) this.running = null;
    if (err) job.reject(err); else job.resolve(result);
    if (this.queue.length) this.next();
    else {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.stop(), IDLE);
    }
  }

  kill(err) {
    const w = this.worker;
    this.worker = null;
    if (w) w.terminate().catch(() => {});
    if (this.running) this.finish(this.running, err);
  }

  stop() {
    if (!this.worker || this.running) return;
    const w = this.worker;
    this.worker = null;
    w.terminate().catch(() => {});
  }

  // A file a style needs: downloaded (or this session's download, under an hour old), else the last download
  // kept in the profile, else Bifrost's own copy.
  async load(url) {
    url = String(url || '');
    const hit = this.files.get(url);
    if (hit && Date.now() - hit.at < FRESH) return hit.text;
    let text = null;
    if (/^https?:\/\//i.test(url)) {
      try { text = await download(url); } catch { text = null; }
    }
    const kept = this.keptFile(url);
    if (text != null) {
      if (kept) { try { fs.mkdirSync(path.dirname(kept), { recursive: true }); fs.writeFileSync(kept, text); } catch { /* not kept */ } }
    } else if (kept) {
      try { text = fs.readFileSync(kept, 'utf8'); } catch { text = null; }
    }
    if (text == null) text = bundled(url);
    if (text == null) throw new Error(`it couldn’t be downloaded (${url})`);
    this.files.set(url, { text, at: Date.now() });
    return text;
  }

  keptFile(url) {
    const dir = ctx.profile && ctx.profile.dir;
    if (!dir) return null;
    return path.join(dir, 'userstyle-imports', crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + '.txt');
  }
}

async function download(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_WAIT);
  try {
    const r = await net.fetch(url, { signal: ac.signal, cache: 'no-cache' });
    if (!r.ok) throw new Error('the site answered ' + r.status);
    const text = await r.text();
    if (text.length > MAX_FILE) throw new Error('too big');
    return text;
  } finally { clearTimeout(timer); }
}

function bundled(url) {
  const clean = url.replace(/[?#].*$/, '');
  for (const b of BUNDLED) {
    if (!clean.startsWith(b.prefix)) continue;
    const file = path.resolve(b.dir, decodeURIComponent(clean.slice(b.prefix.length)));
    if (!file.startsWith(b.dir + path.sep)) return null;
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
  return null;
}

module.exports = { LessBuilder, bundled };
