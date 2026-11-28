'use strict';
// Bifrost's VPN: its browsing (tabs, private windows, the side panel's websites, the icons it fetches) through
// a WireGuard tunnel: Cloudflare WARP's (free, no account: Bifrost signs up for you; near where you are) or one
// of your locations, WireGuard files from a VPN of yours (Proton VPN's free plan has servers in ten countries,
// Mullvad, ...). The tunnel is the helper's (tools/vpn: wireguard-go in user space, no driver or administrator
// rights), which gives Bifrost a SOCKS5 proxy on 127.0.0.1; the browsing sessions are pointed at it
// (sessions.js applyProxy). Only Bifrost goes through it, not the rest of the computer.
//
// Nothing leaks out around it while it's on: the sessions point at the proxy's port from the moment it's turned
// on (Bifrost picks the port, and the helper listens on it before its tunnel is up: connections wait for it);
// if the helper stops, connections to the port are refused until it's back, never sent straight; names are
// looked up inside the tunnel (SOCKS5: Chromium sends the name), and WebRTC only uses the proxy
// (disable_non_proxied_udp). Connections already open when it's turned on or off are closed. Except what you
// choose: sites of yours that skip it (vpn.bypass), and with vpn.scope 'private', every window but the private
// ones.
//
// Where sites see you: once it's connected the helper fetches Cloudflare's trace page through it (its "seen":
// the address, its country), kept for each location so the list says where each puts you. A file just added
// is tried on its own first (the helper's probe), unless one of your files is in use (a free plan allows one
// connection at a time).
//
// The sign-up (its key) and your files (their keys) are kept in vpn.json in the profile, encrypted with the
// system's own protection (safeStorage: Windows' DPAPI) where there is one. Settings: vpn.on, vpn.source
// (warp | file), vpn.file (which of your files: its id; '' the first), vpn.warpTerms (you agreed to Cloudflare's
// terms), vpn.bypass, vpn.scope; they stay on this computer (sync leaves them out).
const { app, safeStorage, webContents } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const ctx = require('./context');

const conf = require('./vpn-conf');
const { parseConf, withPort, guessCountry, siteOf, bypassRules } = conf;
// (tests: WARP's ports to try, in order: a dead one first, to see the next one tried on a real network)
const WARP_PORTS = process.env.BIFROST_TEST === '1' && process.env.BIFROST_VPN_WARP_PORTS ? process.env.BIFROST_VPN_WARP_PORTS.split(',').map(Number) : conf.WARP_PORTS;
const FRESH_S = 185;          // a handshake this recent: the tunnel's up (WireGuard makes a new one every 2 minutes)
const NO_ANSWER_MS = 7000;    // no handshake this long after starting: no answer (one takes about 2 s)
const MAX_FILES = 60;
const FILE_MAX_BYTES = 64 * 1024;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

class Vpn extends EventEmitter {
  constructor() {
    super();
    this.running = '';       // what it's on with: 'warp', 'file:<id>' ('' off)
    this.port = 0;           // the proxy's port (kept while it's on, across the helper's restarts)
    this.child = null;
    this.gen = 0;            // which start this is (an older one's callbacks do nothing)
    this.state = 'off';      // off | starting | signing-up | connecting | connected | error
    this.error = '';
    this.note = '';          // what it's doing about it (another port, trying again)
    this.endpoint = '';
    this.handshake = 0;
    this.rx = 0; this.tx = 0;
    this.since = 0;          // connected since (ms)
    this.seen = null;        // where sites see you through it now: { ip, loc, colo, warp, at }
    this.portIndex = 0;
    this.backoff = 0;
    this.timers = new Set();
    this.secrets = null;
    this.probing = new Set(); // your files being tried
    this.offered = new Set(); // WireGuard files downloaded that Bifrost offered to add (their paths)
  }

  cfg() { return ctx.settings.get('vpn') || {}; }

  // ---------------------------------------------------------------- the helper
  helper() {
    if (process.env.BIFROST_TEST === '1' && process.env.BIFROST_VPN_HELPER) return process.env.BIFROST_VPN_HELPER;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const file = process.platform === 'win32'
      ? path.join(app.getAppPath(), 'assets', 'bin', `bifrost-vpn-${arch}.exe`)
      : path.join(app.getAppPath(), 'tools', 'vpn', 'bin', 'bifrost-vpn');
    return fs.existsSync(file) ? file : null;
  }
  available() { return !!this.helper(); }

  spawnHelper(args) {
    const file = this.helper();
    if (!file) throw new Error('The VPN isn’t in this build of Bifrost');
    return /\.m?js$/.test(file)
      ? spawn(process.execPath, [file, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
      : spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  }

  // One JSON object a line from it (and what it wrote to stderr, for errors).
  lines(child, fn) {
    let rest = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      rest += d;
      for (let i; (i = rest.indexOf('\n')) >= 0;) {
        const l = rest.slice(0, i).trim(); rest = rest.slice(i + 1);
        if (!l) continue;
        let o; try { o = JSON.parse(l); } catch { continue; }
        fn(o);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) console.warn('[vpn]', l.trim().slice(0, 300)); });
  }

  // A one-off: register / unregister / probe. The first line it writes.
  once(args, input, ms = 45000) {
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.spawnHelper(args); } catch (e) { reject(e); return; }
      const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error('no answer in time')); }, ms);
      let got = false;
      this.lines(child, (o) => { if (got) return; got = true; clearTimeout(t); if (o.error) reject(new Error(o.error)); else resolve(o); });
      child.once('error', (e) => { clearTimeout(t); reject(e); });
      child.once('exit', (code) => { clearTimeout(t); if (!got) reject(new Error('the VPN helper stopped (' + code + ')')); });
      child.stdin.on('error', () => { /* gone: the exit handler says so */ });
      if (input) child.stdin.write(JSON.stringify(input) + '\n');
      child.stdin.end();
    });
  }

  // ---------------------------------------------------------------- what's kept
  file() { return path.join(ctx.profile.dir, 'vpn.json'); }
  readSecrets() {
    if (this.secrets) return this.secrets;
    let s = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      s = raw.enc ? JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64'))) : (raw.data || {});
    } catch { /* none yet, or not this computer's (a portable Bifrost moved): signed up again */ }
    // (0.41's one file: the first of your locations)
    if (s.file && !Array.isArray(s.files)) {
      const f = s.file;
      let info = {};
      try { info = parseConf(f.conf); } catch { /* kept as it was */ }
      s = { ...s, files: [{ id: 'f1', name: f.name || 'WireGuard file', conf: f.conf, endpoint: f.endpoint || info.endpoint || '', server: info.server || '', added: Date.now() }] };
      delete s.file;
      this.secrets = s;
      try { this.writeSecrets(s); } catch (e) { console.warn('[vpn] keeping your file', e.message); }
    }
    if (!Array.isArray(s.files)) s.files = [];
    this.secrets = s;
    return s;
  }
  writeSecrets(s) {
    this.secrets = s;
    let out;
    try { out = safeStorage.isEncryptionAvailable() ? { v: 1, enc: true, data: safeStorage.encryptString(JSON.stringify(s)).toString('base64') } : null; } catch { out = null; }
    if (!out) out = { v: 1, enc: false, data: s };
    const tmp = this.file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, this.file());
  }
  files() { return this.readSecrets().files; }
  // One of your files changed (where it puts you, whether it answered), kept.
  updateFile(id, patch) {
    const s = this.readSecrets();
    const files = s.files.map((f) => (f.id === id ? { ...f, ...patch } : f));
    if (files.some((f) => f.id === id)) this.writeSecrets({ ...s, files });
  }

  // ---------------------------------------------------------------- on and off
  init() {
    ctx.settings.on('changed', ({ path: p }) => {
      if (p && p !== 'vpn' && !p.startsWith('vpn.')) return;
      // (sites of yours that skip it, or which windows it's for: the same tunnel, the sessions told again)
      if (!p || p === 'vpn' || p === 'vpn.bypass' || p === 'vpn.scope') { this.applyProxy(true); this.applyWebrtcAll(); }
      this.sync();
    });
    app.on('web-contents-created', (_e, wc) => {
      this.webrtc(wc);
      // (a site that skips the VPN: WebRTC as usual on it)
      wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) this.webrtc(wc, d.url); });
    });
    app.on('will-quit', () => this.stopHelper());
    try { require('./downloads').events.on('done', (rec) => this.offerDownload(rec)); } catch (e) { console.warn('[vpn] downloads', e.message); }
    this.sync();
  }

  // Which of your files is chosen (the first, if the one chosen's gone).
  chosenFile() {
    const files = this.files();
    return files.find((f) => f.id === this.cfg().file) || files[0] || null;
  }

  wanted() {
    const c = this.cfg();
    if (!c.on || !this.available()) return '';
    if (c.source !== 'file') return 'warp';
    const f = this.chosenFile();
    return 'file:' + (f ? f.id : '');
  }

  // On, off, or on another location, as the settings say.
  sync() {
    const want = this.wanted();
    if (want === this.running) {
      // (it stopped for something you've now done: agreed to the terms, say)
      if (want && this.state === 'error') { this.stopHelper(); this.backoff = 0; this.start(); return; }
      this.emit('changed', this.status());
      return;
    }
    this.stopHelper();
    this.running = want;
    this.seen = null;
    this.portIndex = this.knownPort(); this.backoff = 0;
    if (want) this.start();
    else { this.port = 0; this.handshake = 0; this.endpoint = ''; this.set('off', ''); this.applyProxy(true); }
    this.applyWebrtcAll();
  }

  // Whether a browsing session goes through it (with vpn.scope 'private', only private windows' do).
  appliesTo(isPrivate) { return !!this.running && (this.cfg().scope !== 'private' || !!isPrivate); }

  // What a browsing session's proxy is (null: not the VPN's, the usual one). Port 9 (nothing there) until the
  // proxy's port is picked: nothing goes out meanwhile.
  proxyConfig({ isPrivate = false } = {}) {
    if (!this.appliesTo(isPrivate)) return null;
    return { mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${this.port || 9}`, proxyBypassRules: bypassRules(this.cfg().bypass) };
  }

  applyProxy(close) {
    try { require('./sessions').refreshProxies({ close }); } catch (e) { console.warn('[vpn] proxy', e.message); }
  }

  set(state, error, note = '') {
    const was = this.state;
    this.state = state; this.error = error || ''; this.note = note;
    if (state === 'connected' && was !== 'connected') this.since = Date.now();
    if (state !== 'connected') this.since = 0;
    this.emit('changed', this.status());
  }

  later(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); return t; }

  async start(note = '') {
    const gen = ++this.gen;
    const source = this.running;
    this.set('starting', '', note);
    try {
      if (!this.port) this.port = await freePort();
      if (gen !== this.gen) return;
      this.applyProxy(true);
      const conf = await this.confFor(source, gen);
      if (gen !== this.gen) return;
      this.run(conf, gen);
    } catch (e) {
      if (gen === this.gen) this.failed(e.message || String(e), gen);
    }
  }

  async confFor(source, gen) {
    if (source.startsWith('file:')) {
      const f = this.files().find((x) => x.id === source.slice(5));
      if (!f || !f.conf) throw new Error('Add a WireGuard file for it first');
      return f.conf;
    }
    const s = this.readSecrets();
    if (!s.warp || !s.warp.conf) {
      if (!this.cfg().warpTerms) throw new Error('Agree to Cloudflare’s terms to use WARP');
      this.set('signing-up', '');
      const r = await this.once(['register'], null);
      if (gen !== this.gen) return '';
      if (!r.conf) throw new Error('Cloudflare’s sign-up didn’t give a configuration');
      this.writeSecrets({ ...this.readSecrets(), warp: { conf: r.conf, id: r.id, token: r.token, at: Date.now() } });
    }
    return withPort(this.readSecrets().warp.conf, WARP_PORTS[this.portIndex % WARP_PORTS.length]);
  }

  run(conf, gen) {
    let child;
    try { child = this.spawnHelper(['run', '--listen', `127.0.0.1:${this.port}`]); } catch (e) { this.failed(e.message, gen); return; }
    this.child = child;
    let lastError = '';
    const source = this.running;
    this.lines(child, (o) => {
      if (gen !== this.gen) return;
      if (o.error) { lastError = o.error; return; }
      if (o.listening) { this.listening = true; this.emit('listening'); return; }
      if (o.socks) {
        this.endpoint = o.endpoint || '';
        // (what it's doing about it, if anything, still said: another port)
        this.set('connecting', '', this.note);
        this.later(() => { if (gen === this.gen && !this.fresh()) this.noAnswer(gen); }, NO_ANSWER_MS);
        return;
      }
      if (o.seen && o.seen.loc) { this.sawWhere(source, o.seen); return; }
      if (o.handshake !== undefined) {
        this.handshake = Number(o.handshake) || 0;
        this.rx = Number(o.rx) || 0; this.tx = Number(o.tx) || 0;
        this.check();
      }
    });
    child.once('error', (e) => { lastError = e.message; });
    child.once('exit', (code) => {
      if (this.child === child) this.child = null;
      if (gen !== this.gen || !this.running) return;
      this.failed(lastError || `the VPN stopped (${code})`, gen);
    });
    child.stdin.on('error', () => { /* it's gone: the exit handler says so */ });
    child.stdin.write(JSON.stringify({ conf }) + '\n');
    // (whether the tunnel's still up: handshakes stop coming when it isn't)
    const tick = () => { if (gen !== this.gen) return; this.check(); this.later(tick, 5000); };
    this.later(tick, 5000);
  }

  // Where sites see you through it (the helper's "seen"): now, and kept for that location.
  sawWhere(source, s) {
    const seen = { ip: String(s.ip || ''), loc: String(s.loc || '').toUpperCase(), colo: String(s.colo || ''), warp: s.warp === 'on', at: Date.now() };
    this.seen = seen;
    if (source === 'warp') {
      const w = this.readSecrets().warp;
      if (w) this.writeSecrets({ ...this.readSecrets(), warp: { ...w, seen } });
    } else if (source.startsWith('file:')) this.updateFile(source.slice(5), { seen, problem: '' });
    this.emit('changed', this.status());
  }

  fresh() { return this.handshake > 0 && Date.now() / 1000 - this.handshake < FRESH_S; }

  // WARP's port that answered last time (a network that blocks 2408: no waiting for it each time).
  knownPort() {
    const w = this.readSecrets().warp;
    const i = w && w.port ? WARP_PORTS.indexOf(w.port) : -1;
    return i > 0 ? i : 0;
  }

  check() {
    if (!this.running || !this.child) return;
    if (this.fresh()) {
      this.backoff = 0;
      if (this.state !== 'connected') {
        this.set('connected', '');
        // (the port that answered, kept for next time)
        const w = this.running === 'warp' && this.readSecrets().warp;
        const port = WARP_PORTS[this.portIndex % WARP_PORTS.length];
        if (w && w.port !== port && (w.port || port !== WARP_PORTS[0])) this.writeSecrets({ ...this.readSecrets(), warp: { ...w, port } });
      } else this.emit('changed', this.status());
    }
    else if (this.state === 'connected') this.set('connecting', '', 'The connection dropped: getting it back');
  }

  // No handshake: WARP tries its next port; a server of yours is waited for.
  noAnswer(gen) {
    if (this.running === 'warp') {
      this.portIndex++;
      const port = WARP_PORTS[this.portIndex % WARP_PORTS.length];
      this.restart(gen, `No answer from WARP: trying port ${port}`);
    } else {
      this.set('connecting', '', `No answer from ${this.endpoint || 'the server'} yet`);
    }
  }

  restart(gen, note) {
    if (gen !== this.gen) return;
    this.stopHelper();
    this.start(note);
  }

  failed(msg, gen) {
    if (gen !== this.gen) return;
    this.stopChild();
    this.backoff = Math.min(30000, this.backoff ? this.backoff * 2 : 2000);
    this.set('error', msg, `Trying again in ${Math.round(this.backoff / 1000)} s`);
    // (agreeing to the terms or adding a file is up to you: not tried again on its own)
    if (/Agree to Cloudflare|Add a WireGuard file|isn’t in this build/.test(msg)) return;
    this.later(() => { if (gen === this.gen && this.running) this.start(); }, this.backoff);
  }

  // Started with the VPN on: the pages wait for its proxy to be there (ms at most), so the first ones don't fail.
  whenListening(ms) {
    if (!this.running || this.listening) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); resolve(); }
      this.once('listening', done);
    });
  }

  stopChild() {
    this.listening = false;
    const c = this.child;
    this.child = null;
    if (!c) return;
    try { c.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 1500).unref();
  }

  stopHelper() {
    this.gen++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.stopChild();
  }

  // ---------------------------------------------------------------- WebRTC
  // Only through the proxy, in a page the VPN's on for (not a private-only VPN's other windows, nor a site that
  // skips it).
  webrtc(wc, url) {
    try {
      if (wc.isDestroyed()) return;
      const type = wc.getType();
      if (type !== 'webview' && type !== 'window' && type !== 'browserView') return;
      let on = this.running && this.appliesTo(require('./sessions').isPrivate(wc.session));
      if (on) {
        const host = siteOf(url || wc.getURL());
        const skip = (this.cfg().bypass || []).map(siteOf).filter(Boolean);
        if (host && skip.some((s) => host === s || host.endsWith('.' + s))) on = false;
      }
      wc.setWebRTCIPHandlingPolicy(on ? 'disable_non_proxied_udp' : 'default');
    } catch { /* not a page */ }
  }
  applyWebrtcAll() { for (const wc of webContents.getAllWebContents()) this.webrtc(wc); }

  // ---------------------------------------------------------------- sites that skip it
  // (once the sessions have been told: a page reloaded then goes the new way)
  async setSkipped(site, skip) {
    const host = siteOf(site);
    if (!host) throw new Error('That isn’t a site’s address');
    const now = (this.cfg().bypass || []).map(siteOf).filter(Boolean);
    const next = skip ? [...new Set([...now, host])] : now.filter((h) => h !== host);
    ctx.settings.set('vpn.bypass', next);
    try { await require('./sessions').refreshProxies({ close: true }); } catch { /* told by the settings' change too */ }
    return this.status();
  }

  // ---------------------------------------------------------------- your locations, WARP's sign-up
  // WireGuard files ([{ text, name }]) added to your locations: each checked; one already there (the same key
  // to the same server) has its copy replaced. use: the (first) one added is the VPN's now. Then each new one's
  // tried on its own, to see where it puts you.
  importFiles(items, { use = false } = {}) {
    const s = this.readSecrets();
    const files = s.files.slice();
    const added = [], errors = [];
    for (const it of items) {
      const name = String(it.name || 'WireGuard file').replace(/\.conf$/i, '').slice(0, 80);
      let info;
      try {
        if (it.error) throw new Error(it.error);
        if (String(it.text || '').length > FILE_MAX_BYTES) throw new Error('it’s too big to be a WireGuard file');
        info = parseConf(it.text);
      } catch (e) { errors.push({ name, error: e.message }); continue; }
      const same = files.findIndex((f) => { try { return parseConf(f.conf).same === info.same; } catch { return false; } });
      const entry = { name, conf: String(it.text), endpoint: info.endpoint, server: info.server, guess: guessCountry(info.server, name) };
      if (same >= 0) { files[same] = { ...files[same], ...entry }; added.push(files[same].id); continue; }
      if (files.length >= MAX_FILES) { errors.push({ name, error: `there are ${MAX_FILES} locations already` }); continue; }
      const id = crypto.randomBytes(4).toString('hex');
      files.push({ id, ...entry, added: Date.now() });
      added.push(id);
    }
    if (added.length) this.writeSecrets({ ...s, files });
    if (added.length && use) {
      // (already on that file: started again with its new copy)
      if (this.running === 'file:' + added[0]) { this.stopHelper(); this.running = ''; }
      ctx.settings.set('vpn.file', added[0]);
      ctx.settings.set('vpn.source', 'file');
    }
    this.sync();
    this.emit('changed', this.status());
    this.probeAll(added);
    return { added: added.map((id) => this.publicFile(this.files().find((f) => f.id === id))), errors, status: this.status() };
  }

  // Each of these files tried on its own, one after another: does it answer, where does it put you. Not while
  // one of your files is in use (a free plan has one connection: trying another could drop it), nor the one
  // in use itself.
  async probeAll(ids) {
    for (const id of ids) await this.probe(id);
  }
  async probe(id) {
    const f = this.files().find((x) => x.id === id);
    if (!f || this.probing.has(id) || (this.running && this.running.startsWith('file:'))) return null;
    this.probing.add(id);
    this.emit('changed', this.status());
    try {
      const r = await this.once(['probe'], { conf: f.conf }, 30000);
      const patch = { ms: Number(r.ms) || 0, problem: '', tried: Date.now() };
      if (r.seen && r.seen.loc) patch.seen = { ip: String(r.seen.ip || ''), loc: String(r.seen.loc).toUpperCase(), colo: String(r.seen.colo || ''), warp: r.seen.warp === 'on', at: Date.now() };
      this.updateFile(id, patch);
    } catch (e) {
      this.updateFile(id, { problem: String(e.message || e).slice(0, 200), tried: Date.now() });
    } finally {
      this.probing.delete(id);
      this.emit('changed', this.status());
    }
    return this.publicFile(this.files().find((x) => x.id === id));
  }

  // A WireGuard file downloaded in Bifrost (Proton's downloads page, say): the windows offer to add it.
  offerDownload(rec) {
    try {
      if (!rec || rec.state !== 'completed' || !/\.conf$/i.test(rec.path || '')) return;
      if (!this.available() || fs.statSync(rec.path).size > FILE_MAX_BYTES) return;
      const text = fs.readFileSync(rec.path, 'utf8');
      const info = parseConf(text);
      const known = this.files().some((f) => { try { return parseConf(f.conf).same === info.same; } catch { return false; } });
      if (known) return;
      this.offered.add(rec.path);
      const name = path.basename(rec.path).replace(/\.conf$/i, '');
      const ctl = ctx.registry.lastFocused({ private: false }) || ctx.registry.lastFocused();
      if (ctl) ctl.send('vpn-offer', { path: rec.path, name, server: info.server, country: guessCountry(info.server, name) });
    } catch { /* not a WireGuard file: nothing offered */ }
  }
  addDownloaded(file, use) {
    if (!this.offered.has(file)) throw new Error('That file wasn’t offered');
    this.offered.delete(file);
    return this.importFiles([{ text: fs.readFileSync(file, 'utf8'), name: path.basename(file) }], { use });
  }

  async forget(what, id) {
    const s = { ...this.readSecrets() };
    if (what === 'warp' && s.warp) {
      const { id: dev, token } = s.warp;
      delete s.warp;
      this.writeSecrets(s);
      // (taken off Cloudflare's list too, if it can be)
      if (dev && token) this.once(['unregister'], { id: dev, token }, 20000).catch((e) => console.warn('[vpn] unregister', e.message));
      if (this.running === 'warp') { this.stopHelper(); this.running = ''; ctx.settings.set('vpn.on', false); }
    }
    if (what === 'file') {
      const gone = id ? s.files.filter((f) => f.id === id) : s.files;
      this.writeSecrets({ ...s, files: s.files.filter((f) => !gone.includes(f)) });
      // (the one in use: the VPN turns off, rather than going somewhere else you didn't choose)
      if (gone.some((f) => this.running === 'file:' + f.id)) { this.stopHelper(); this.running = ''; ctx.settings.set('vpn.on', false); }
      if (gone.some((f) => f.id === this.cfg().file)) ctx.settings.set('vpn.file', '');
    }
    this.sync();
    return this.status();
  }

  publicFile(f) {
    if (!f) return null;
    const seen = f.seen || null;
    return {
      id: f.id, name: f.name, server: f.server || '', endpoint: f.endpoint || '',
      // (where it puts you: seen through it, or guessed from its server's name until then)
      country: (seen && seen.loc) || f.guess || '', seen, guessed: !(seen && seen.loc) && !!f.guess,
      ms: f.ms || 0, problem: f.problem || '', probing: this.probing.has(f.id),
    };
  }

  status() {
    const c = this.cfg();
    const s = this.readSecrets();
    const chosen = this.chosenFile();
    const running = this.running;
    return {
      available: this.available(),
      on: !!c.on, source: c.source === 'file' ? 'file' : 'warp', running,
      // (where it goes: 'warp', or one of your files' id; '' a file chosen but none added)
      location: c.source === 'file' ? (chosen ? chosen.id : '') : 'warp',
      state: this.state, error: this.error, note: this.note,
      endpoint: this.endpoint, since: this.since, rx: this.rx, tx: this.tx,
      seen: this.state === 'connected' || this.state === 'connecting' ? this.seen : null,
      warpTerms: !!c.warpTerms, warp: !!(s.warp && s.warp.conf), warpSeen: (s.warp && s.warp.seen) || null,
      files: s.files.map((f) => this.publicFile(f)),
      file: this.publicFile(chosen),
      scope: c.scope === 'private' ? 'private' : 'all',
      bypass: (c.bypass || []).map(siteOf).filter(Boolean),
    };
  }
}

module.exports = { Vpn };
