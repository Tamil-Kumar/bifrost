'use strict';
// Which of your Google accounts Google's sites open with (Settings → Accounts; the rules: shared/google-accounts.js).
// A page of Google's opened from outside Google gets ?authuser= for the account you chose, as a redirect before
// it's requested. Normal windows only: a private window's sign-ins are its own.
//
// authuser is the account's place among the ones you're signed in to (0, 1, …), and it moves as you sign in and
// out, so the accounts are read from Google (accounts.google.com/ListAccounts, with your cookies: where Chrome
// reads them from) when Settings shows them, and again whenever Google's sign-in cookies change — only once
// you use this (or Settings has asked). Until they've been read the email is sent instead, which most of
// Google's sites take as well; an account you're not signed in to is left to Google.
const { net } = require('electron');
const { EventEmitter } = require('node:events');
const ctx = require('./context');
const G = require('../shared/google-accounts');

// Asked for as Chrome asks (google_apis/gaia: GaiaUrls::ListAccountsURLWithSource, GaiaAuthFetcher::
// StartListAccounts): a POST from https://www.google.com. Google answers a GET with 400.
const LIST_URL = 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard&laf=b64bin';
// Google's sign-in cookies: signing in, out, or adding an account changes one of these (not the ones it renews
// every few minutes, like __Secure-1PSIDTS).
const SIGN_IN_COOKIES = /^(SID|__Secure-[13]PSID|LSID|__Host-[13]PLSID|__Host-GAPS|ACCOUNT_CHOOSER)$/;
const READ_AFTER_MS = 1500;      // after the cookies change (signing in sets several)
const FRESH_MS = 60 * 1000;      // Settings reads them again when they're older than this

class GoogleAccounts extends EventEmitter {
  constructor() {
    super();
    this.ses = null;
    this.list = null;            // [{ email, name, index, valid }] once read
    this.error = '';             // why the last read didn't work
    this.at = 0;                 // when they were last read
    this.reading = null;         // the read under way
    this.timer = null;
    this.rewritten = new Map();  // request id -> hosts its page was given an account on (its redirects keep the id)
  }

  attach(ses, hub) {
    if (this.ses) return;   // (the main session's, once)
    this.ses = ses;
    hub.before.push((d) => this.onBeforeRequest(d));
    ses.cookies.on('changed', (_e, cookie) => {
      if (!cookie || !SIGN_IN_COOKIES.test(cookie.name)) return;
      if (!/(^|\.)google\.com$/.test(String(cookie.domain || '').replace(/^\./, ''))) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.list || this.inUse()) this.read().catch(() => {}); }, READ_AFTER_MS);
    });
    if (this.inUse()) setTimeout(() => this.read().catch(() => {}), 2000);
  }

  config() { return ctx.settings.get('accounts.google') || {}; }

  inUse() {
    const c = this.config();
    return !!(c.default || (c.sites || []).some((r) => r && r.site));
  }

  // The accounts, read from Google; one read at a time.
  read() {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        this.list = G.parseListAccounts(await this.fetchList());
        this.error = '';
      } catch (e) {
        this.error = String((e && e.message) || e);
      }
      this.at = Date.now();
      this.reading = null;
      const s = this.status();
      this.emit('changed', s);
      return s;
    })();
    return this.reading;
  }

  fetchList() {
    return new Promise((resolve, reject) => {
      if (!this.ses) { reject(new Error('Bifrost isn’t ready')); return; }
      let req;
      try {
        req = net.request({ method: 'POST', url: LIST_URL, session: this.ses, credentials: 'include', useSessionCookies: true });
        req.setHeader('Origin', 'https://www.google.com');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
      } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { try { req.abort(); } catch { /* done */ } reject(new Error('Google didn’t answer')); }, 10000);
      const fail = (e) => { clearTimeout(timer); reject(new Error(/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK/.test(String(e && e.message)) ? 'you’re offline' : String((e && e.message) || e))); };
      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode !== 200) reject(new Error('Google answered ' + res.statusCode));
          else resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', fail);
      });
      req.on('error', fail);
      req.end(' ');   // (Chrome's body: one space)
    });
  }

  // For Settings: read again when asked to, or when the last read is old.
  async accounts(refresh) {
    if (refresh || !this.list || Date.now() - this.at > FRESH_MS) await this.read();
    return this.status();
  }

  status() {
    return { accounts: this.list || [], known: !!this.list, error: this.error, at: this.at };
  }

  // authuser for an account: its place among the accounts you're signed in to, or its email until they've been
  // read; null when it isn't one of them.
  which(email) {
    if (!this.list) {
      if (!this.reading) this.read().catch(() => {});
      return email;
    }
    const a = this.list.find((x) => G.sameEmail(x.email, email));
    return a ? a.index : null;
  }

  onBeforeRequest(d) {
    if (d.resourceType !== 'mainFrame' || (d.method && d.method !== 'GET')) return;
    const email = G.accountFor(d.url, this.config(), d.referrer);
    if (!email) return;
    let host = '';
    try { host = new URL(d.url).hostname; } catch { return; }
    // Once per host along a page's redirects: when Google takes authuser out again, it has what it needs.
    const done = this.rewritten.get(d.id);
    if (done && done.has(host)) return;
    const which = this.which(email);
    if (which == null) return;
    if (done) done.add(host);
    else {
      this.rewritten.set(d.id, new Set([host]));
      if (this.rewritten.size > 200) this.rewritten.delete(this.rewritten.keys().next().value);
    }
    return { redirectURL: G.withAccount(d.url, which) };
  }
}

module.exports = { GoogleAccounts };
