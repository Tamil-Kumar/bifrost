'use strict';
// The rules YouTube's ads are taken out by (shared/youtube-rules.json: which of YouTube's answers are held, what's
// done to each, and what's hidden and pressed in its pages; main/youtube-edit.js reads them), kept up to date
// without a new version of Bifrost. YouTube changes what it sends now and then (a key's name, an address, the
// wording of a check in its player), and its ads are back until the rules follow: the copy in Bifrost's
// repository is looked at a minute after Bifrost starts and every six hours, and a newer one (a higher
// "version") that passes the same checks as the built-in one takes its place at once, in tabs already open too,
// and is kept for the next start. Anything else (not reachable, not JSON, made for a later Bifrost, something
// in it this version doesn't know) changes nothing: the rules in use stay.
// They are data, never code: they can only choose among the few edits youtube-edit.js knows, and only for
// YouTube's own answers and pages.
const { app, net } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const ctx = require('./context');
const { compile } = require('./youtube-edit');

const TEST = process.env.BIFROST_TEST === '1';
const REMOTE = (TEST && process.env.BIFROST_YT_RULES_URL) || 'https://raw.githubusercontent.com/Tamil-Kumar/bifrost/main/src/shared/youtube-rules.json';
const FIRST_MS = (TEST && Number(process.env.BIFROST_YT_RULES_FIRST_MS)) || 60e3;
const EVERY_MS = 6 * 3600e3;
const RETRY_MS = 30 * 60e3;   // (after a look that failed: offline, say)
const MAX_BYTES = 256 * 1024;
const KV = 'youtubeRules.checked';
// (the automated tests fetch nothing by themselves: the one for this asks, with its own address)
const BY_ITSELF = !TEST || !!process.env.BIFROST_YT_RULES_AUTO;

class YouTubeRules extends EventEmitter {
  constructor() {
    super();
    // (the built-in ones are checked by the unit tests: they can't fail here)
    this.builtin = compile(require('../shared/youtube-rules.json'));
    this.cur = this.builtin;
    this.fromRemote = false;
    this.error = '';
    this.timer = null;
    this.busy = null;
  }

  get file() { return path.join(app.getPath('userData'), 'youtube-rules.json'); }
  current() { return this.cur; }

  // On, when YouTube's ads are being blocked at all.
  get wanted() {
    const a = (ctx.settings && ctx.settings.get('privacy.adblock')) || {};
    return a.enabled !== false && a.youtubeSkip !== false;
  }

  // The copy kept from last time, when it's newer than the built-in one (an update of Bifrost can bring newer
  // ones than it had fetched). Read after the window is up: the built-in ones do until then.
  init() {
    fs.promises.readFile(this.file, 'utf8').then((text) => {
      let rules;
      try { rules = compile(JSON.parse(text)); } catch { rules = null; }
      if (rules && rules.version > this.builtin.version) this.use(rules, true);
      else fs.promises.rm(this.file, { force: true }).catch(() => {});
    }, () => { /* none kept */ });
    this.schedule();
    if (ctx.settings) ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('privacy.adblock')) this.schedule(); });
  }

  use(rules, fromRemote) {
    if (rules.version === this.cur.version && fromRemote === this.fromRemote) return;
    this.cur = rules;
    this.fromRemote = fromRemote;
    this.emit('changed', rules);
  }

  schedule(atLeast = FIRST_MS) {
    clearTimeout(this.timer);
    if (!this.wanted || !BY_ITSELF) return;
    const last = ctx.db ? Number(ctx.db.kvGet(KV, 0)) || 0 : 0;
    const due = Math.max(atLeast, last + EVERY_MS - Date.now());
    this.timer = setTimeout(() => { this.refresh().then((found) => this.schedule(found === 'failed' ? RETRY_MS : FIRST_MS), () => this.schedule(RETRY_MS)); }, Math.min(due, 2 ** 31 - 1));
    if (this.timer.unref) this.timer.unref();
  }

  // Looks for newer rules now. Resolves to what it found: 'newer', 'same' or 'failed' (why: this.error).
  refresh() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      try {
        const res = await net.fetch(REMOTE + (REMOTE.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error('the server answered ' + res.status);
        if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('too big to be the rules');
        const text = await res.text();
        if (text.length > MAX_BYTES) throw new Error('too big to be the rules');
        let raw;
        try { raw = JSON.parse(text); } catch { throw new Error('not the rules (it isn’t JSON)'); }
        const rules = compile(raw);
        this.error = '';
        if (ctx.db) ctx.db.kvSet(KV, Date.now());
        // (older than the ones in use, or the same: nothing changes. The built-in ones, when they're as new.)
        if (rules.version <= this.cur.version) return 'same';
        const tmp = this.file + '.tmp';
        await fs.promises.writeFile(tmp, JSON.stringify(raw));
        await fs.promises.rename(tmp, this.file);
        this.use(rules, true);
        console.log('[youtube] newer rules: ' + rules.version);
        return 'newer';
      } catch (e) {
        this.error = String((e && e.message) || e);
        console.warn('[youtube] rules not updated: ' + this.error);
        return 'failed';
      }
    })().finally(() => { this.busy = null; });
    return this.busy;
  }

  info() {
    return { version: this.cur.version, builtin: this.builtin.version, downloaded: this.fromRemote, checkedAt: ctx.db ? Number(ctx.db.kvGet(KV, 0)) || 0 : 0, error: this.error };
  }
}

module.exports = { YouTubeRules };
