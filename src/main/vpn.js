'use strict';
// Bifrost's VPN: its browsing (tabs, private windows, the side panel's websites, the icons it fetches) through
// a WireGuard tunnel, Cloudflare WARP's (free, no account: Bifrost signs up for you) or one from a WireGuard
// file of your own (Proton VPN's free plan, Mullvad, ...). The tunnel is the helper's (tools/vpn: wireguard-go
// in user space, no driver or administrator rights), which gives Bifrost a SOCKS5 proxy on 127.0.0.1; every
// browsing session is pointed at it (sessions.js applyProxy). Only Bifrost goes through it, not the rest of
// the computer.
//
// Nothing leaks out around it while it's on: the sessions point at the proxy's port from the moment it's turned
// on (Bifrost picks the port, and the helper listens on it before its tunnel is up: connections wait for it);
// if the helper stops, connections to the port are refused until it's back, never sent straight; names are
// looked up inside the tunnel (SOCKS5: Chromium sends the name), and WebRTC only uses the proxy
// (disable_non_proxied_udp). Connections already open when it's turned on or off are closed.
//
// The sign-up (its key) and your file (its key) are kept in vpn.json in the profile, encrypted with the
// system's own protection (safeStorage: Windows' DPAPI) where there is one. Settings: vpn.on, vpn.source
// (warp | file), vpn.warpTerms (you agreed to Cloudflare's terms), vpn.fileName; they stay on this computer
// (sync leaves them out).
const { app, safeStorage, webContents } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const ctx = require('./context');

const conf = require('./vpn-conf');
const { parseConf, withPort, BYPASS } = conf;
// (tests: WARP's ports to try, in order: a dead one first, to see the next one tried on a real network)
const WARP_PORTS = process.env.BIFROST_TEST === '1' && process.env.BIFROST_VPN_WARP_PORTS ? process.env.BIFROST_VPN_WARP_PORTS.split(',').map(Number) : conf.WARP_PORTS;
const FRESH_S = 185;          // a handshake this recent: the tunnel's up (WireGuard makes a new one every 2 minutes)
const NO_ANSWER_MS = 7000;    // no handshake this long after starting: no answer (one takes about 2 s)

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
    this.running = '';       // the source it's on with ('' off)
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
    this.portIndex = 0;
    this.backoff = 0;
    this.timers = new Set();
    this.secrets = null;
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

  // A one-off: register / unregister. The first line it writes.
  once(args, input, ms = 45000) {
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.spawnHelper(args); } catch (e) { reject(e); return; }
      const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error('no answer in time')); }, ms);
      let got = false;
      this.lines(child, (o) => { if (got) return; got = true; clearTimeout(t); if (o.error) reject(new Error(o.error)); else resolve(o); });
      child.once('error', (e) => { clearTimeout(t); reject(e); });
      child.once('exit', (code) => { clearTimeout(t); if (!got) reject(new Error('the VPN helper stopped (' + code + ')')); });
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

  // ---------------------------------------------------------------- on and off
  init() {
    ctx.settings.on('changed', ({ path: p }) => { if (!p || p === 'vpn' || p.startsWith('vpn.')) this.sync(); });
    app.on('web-contents-created', (_e, wc) => this.webrtc(wc));
    app.on('will-quit', () => this.stopHelper());
    this.sync();
  }

  wanted() { const c = this.cfg(); return c.on && this.available() ? (c.source === 'file' ? 'file' : 'warp') : ''; }

  // On, off, or on another source, as the settings say.
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
    this.portIndex = this.knownPort(); this.backoff = 0;
    if (want) this.start();
    else { this.port = 0; this.handshake = 0; this.endpoint = ''; this.set('off', ''); this.applyProxy(true); }
    this.applyWebrtcAll();
  }

  // What the browsing sessions' proxy is (null: the VPN's off, the usual one). Port 9 (nothing there) until the
  // proxy's port is picked: nothing goes out meanwhile.
  proxyConfig() {
    if (!this.running) return null;
    return { mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${this.port || 9}`, proxyBypassRules: BYPASS };
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
    const s = this.readSecrets();
    if (source === 'file') {
      if (!s.file || !s.file.conf) throw new Error('Choose a WireGuard file for it first');
      return s.file.conf;
    }
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

  // No handshake: WARP tries its next port; a server of your own is waited for.
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
    // (agreeing to the terms or choosing a file is up to you: not tried again on its own)
    if (/Agree to Cloudflare|Choose a WireGuard file|isn’t in this build/.test(msg)) return;
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
  webrtc(wc) {
    try {
      if (wc.isDestroyed()) return;
      const type = wc.getType();
      if (type !== 'webview' && type !== 'window' && type !== 'browserView') return;
      wc.setWebRTCIPHandlingPolicy(this.running ? 'disable_non_proxied_udp' : 'default');
    } catch { /* not a page */ }
  }
  applyWebrtcAll() { for (const wc of webContents.getAllWebContents()) this.webrtc(wc); }

  // ---------------------------------------------------------------- your file, WARP's sign-up
  importFile(text, name) {
    const info = parseConf(text);
    this.writeSecrets({ ...this.readSecrets(), file: { conf: String(text), name: String(name || 'WireGuard file'), endpoint: info.endpoint } });
    ctx.settings.set('vpn.fileName', String(name || 'WireGuard file'));
    // (already on with a file: the new one)
    if (this.running === 'file') { this.stopHelper(); this.running = ''; }
    ctx.settings.set('vpn.source', 'file');
    this.sync();
    return info;
  }

  async forget(what) {
    const s = { ...this.readSecrets() };
    if (what === 'warp' && s.warp) {
      const { id, token } = s.warp;
      delete s.warp;
      this.writeSecrets(s);
      // (taken off Cloudflare's list too, if it can be)
      if (id && token) this.once(['unregister'], { id, token }, 20000).catch((e) => console.warn('[vpn] unregister', e.message));
      if (this.running === 'warp') { this.stopHelper(); this.running = ''; ctx.settings.set('vpn.on', false); }
    }
    if (what === 'file' && s.file) {
      delete s.file;
      this.writeSecrets(s);
      ctx.settings.set('vpn.fileName', '');
      if (this.running === 'file') { this.stopHelper(); this.running = ''; ctx.settings.set('vpn.on', false); }
    }
    this.sync();
    return this.status();
  }

  status() {
    const c = this.cfg();
    const s = this.readSecrets();
    return {
      available: this.available(),
      on: !!c.on, source: c.source === 'file' ? 'file' : 'warp', running: this.running,
      state: this.state, error: this.error, note: this.note,
      endpoint: this.endpoint, since: this.since, rx: this.rx, tx: this.tx,
      warpTerms: !!c.warpTerms, warp: !!(s.warp && s.warp.conf),
      file: s.file ? { name: s.file.name, endpoint: s.file.endpoint } : null,
    };
  }
}

module.exports = { Vpn };
