'use strict';
// Which of your Google accounts Google's sites open with (Settings → Accounts; the rules: shared/google-accounts.js).
// A page of Google's opened from outside Google gets ?authuser= for the account you chose, as a redirect before
// it's requested. Normal windows only: a private window's sign-ins are its own.
//
// Which pages you opened yourself is told by how each tab's navigation started (as it starts, before the
// page is asked for; watched from a tab's first page, which starts before guests.js sets the tab up): one
// that a page started is a link (the page it's on is its referrer: Google's, or another site's, or one of
// Bifrost's own, like the start page); one Bifrost started is yours (the address bar, a bookmark, the
// launcher, another app) unless it's a reload, back or forward, a tab put back, or a new tab for a link a page
// opened (noteOpen: the page's own link, opened in a new tab by it, by Ctrl+click or by its context menu). A
// page you opened gets your account even when its address names one by number (Gmail's always do:
// /mail/u/0/), see shared/google-accounts.js.
//
// authuser is the account's place among the ones you're signed in to (0, 1, …), and it moves as you sign in and
// out, so the accounts are read from Google (accounts.google.com/ListAccounts, with your cookies: where Chrome
// reads them from) when Settings shows them, and again whenever Google's sign-in cookies change — only once
// you use this (or Settings has asked). Until they've been read the email is sent instead, which most of
// Google's sites take as well; an account you're not signed in to is left to Google.
const { app, net, webContents } = require('electron');
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
const REORDER_FOR_MS = 60 * 60 * 1000;   // how long Settings helps you sign in again, in another order
// Google's own sign-out (of every account, in this browser), and its sign-in for an account, and for another.
const signInUrl = (email) => 'https://accounts.google.com/AccountChooser?Email=' + encodeURIComponent(email) + '&continue=' + encodeURIComponent('https://myaccount.google.com/');
const addUrl = (email) => 'https://accounts.google.com/AddSession?Email=' + encodeURIComponent(email) + '&continue=' + encodeURIComponent('https://myaccount.google.com/');
const signOutUrl = (then) => 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(then);
const SIGN_OUT_PAGE = /^https:\/\/accounts\.google\.com\/Logout(\?|$)/i;
const SIGN_IN_PAGE = /^https:\/\/accounts\.google\.com\/(AccountChooser|ServiceLogin|AddSession|signin|v3\/signin)/i;

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
    this.starts = new Map();     // webContents id -> { key, opened, referrer, at }: how its last page was asked for
    this.opens = new Map();      // openKey(url) -> { from, at }: links pages opened in new tabs (and their pages)
    this.history = new Map();    // webContents id -> when Bifrost moved it through its history (or put it back)
    this.opened = new Map();     // request id -> whether you opened it (for its redirects)
    this.reorder = null;         // { first, others, at }: making first Google's default (see makeDefault)
  }

  // ---------------------------------------------------------------- Google's own default
  // Google makes the first account you sign in to its default, and the only way to change that is to sign out
  // of them all and in again, that one first. Settings asks, then opens what this gives: Google's sign-out
  // (every account, in Bifrost only), on to Google's sign-in for that one (or, if Google goes elsewhere once
  // you're signed out, Bifrost sends that tab there: followReorder); and lists the others to sign in to again
  // until they're back (an hour at most).
  makeDefault(email) {
    const list = this.list || [];
    const a = list.find((x) => G.sameEmail(x.email, email));
    if (!a) throw new Error('You’re not signed in to ' + email);
    this.reorder = { first: a.email, others: list.filter((x) => x !== a).map((x) => x.email), at: Date.now() };
    this.emit('changed', this.status());
    return { url: signOutUrl(signInUrl(a.email)) };
  }

  endReorder() { this.reorder = null; const s = this.status(); this.emit('changed', s); return s; }

  // Signed out of them all (the list read empty): the tab that signed you out goes on to the sign-in for the
  // account that's to be first, unless Google sent it to a sign-in page itself. Once.
  followReorder() {
    const r = this.reorder;
    if (!r || r.sent || !this.list || this.list.length || r.tab == null) return;
    const wc = webContents.fromId(r.tab);
    if (!wc || wc.isDestroyed()) return;
    r.sent = true;
    if (SIGN_IN_PAGE.test(wc.getURL())) return;
    try { wc.loadURL(signInUrl(r.first)); } catch { /* gone */ }
  }

  // Where it's got to: { first, firstIn (it's Google's default now), signIn (its sign-in, or signing out of
  // the others first, when they're still signed in), others: [{ email, url }] still to sign in to again }.
  reorderState() {
    const r = this.reorder;
    if (!r || Date.now() - r.at > REORDER_FOR_MS) { this.reorder = null; return null; }
    const list = this.list || [];
    const firstIn = !!(list.length && G.sameEmail(list[0].email, r.first));
    const others = r.others.filter((e) => !list.some((x) => G.sameEmail(x.email, e)));
    if (firstIn && !others.length) { this.reorder = null; return null; }
    return {
      first: r.first, firstIn,
      signIn: firstIn ? '' : list.length ? signOutUrl(signInUrl(r.first)) : signInUrl(r.first),
      others: firstIn ? others.map((e) => ({ email: e, url: addUrl(e) })) : [],
    };
  }

  // ---------------------------------------------------------------- how a page came to be asked for
  // A link a page opens in a new tab (or that its context menu may): the page is where it came from.
  noteOpen(url, from) {
    const key = G.openKey(url);
    if (!key) return;
    this.opens.delete(key);
    this.opens.set(key, { from: String(from || ''), at: Date.now() });
    if (this.opens.size > 100) this.opens.delete(this.opens.keys().next().value);
  }

  // A tab moved through its history, or put back, by Bifrost (its next page isn't one you opened).
  noteHistory(wc) { if (wc) this.history.set(wc.id, Date.now()); }

  // A tab's page starting (did-start-navigation, the main frame's, before it's asked for).
  noteStart(wc, d) {
    const key = G.openKey(d && d.url);
    // (the tab that signs you out, making an account Google's default)
    if (this.reorder && this.reorder.tab == null && SIGN_OUT_PAGE.test(String(d && d.url))) this.reorder.tab = wc.id;
    const moved = this.history.get(wc.id);
    this.history.delete(wc.id);
    if (!key) { this.starts.delete(wc.id); return; }
    let referrer = '';
    let opened;
    let from = '';
    try { from = d.initiator && !d.initiator.isDestroyed() ? String(d.initiator.url || '') : ''; } catch { from = ''; }
    const open = this.opens.get(key);
    if (from) {
      // A link (or a script) on the page: another site's (or Bifrost's own page's) is yours to open.
      referrer = from;
      opened = !G.fromGoogle(from);
    } else if (open && Date.now() - open.at < 10 * 60 * 1000) {
      this.opens.delete(key);
      referrer = open.from;
      opened = !G.fromGoogle(open.from);
    } else {
      opened = !(moved && Date.now() - moved < 15000) && !this.isHistory(wc, d.url);
    }
    this.starts.set(wc.id, { key, opened, referrer, at: Date.now() });
  }

  // A reload, or back or forward (the page next to this one in the tab's history).
  isHistory(wc, url) {
    const bare = (u) => String(u || '').split('#')[0];
    try {
      if (bare(wc.getURL()) === bare(url)) return true;
      const h = wc.navigationHistory;
      const i = h.getActiveIndex();
      for (const k of [i - 1, i + 1]) {
        const e = k >= 0 && k < h.length() ? h.getEntryAtIndex(k) : null;
        if (e && bare(e.url) === bare(url)) return true;
      }
    } catch { /* gone */ }
    return false;
  }

  // For a page's request (and its redirects): { opened, referrer }.
  howAsked(d) {
    if (this.opened.has(d.id)) return { opened: this.opened.get(d.id), referrer: d.referrer || '' };
    let opened = false;
    let referrer = d.referrer || '';
    const st = d.webContentsId != null ? this.starts.get(d.webContentsId) : null;
    if (st && st.key === G.openKey(d.url) && Date.now() - st.at < 30000) {
      opened = st.opened;
      if (st.referrer) referrer = st.referrer;
      this.starts.delete(d.webContentsId);
    }
    this.opened.set(d.id, opened);
    if (this.opened.size > 200) this.opened.delete(this.opened.keys().next().value);
    return { opened, referrer };
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
    // Every tab's pages (this session's) as they start.
    app.on('web-contents-created', (_e, wc) => {
      if (wc.getType() !== 'webview') return;
      wc.on('did-start-navigation', (d) => {
        if (!d || !d.isMainFrame || d.isSameDocument || wc.session !== this.ses) return;
        this.noteStart(wc, d);
      });
      wc.once('destroyed', () => { this.starts.delete(wc.id); this.history.delete(wc.id); });
    });
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
      this.followReorder();
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
    return { accounts: this.list || [], known: !!this.list, error: this.error, at: this.at, reorder: this.reorderState() };
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
    if (!this.inUse()) return;
    const { opened, referrer } = this.howAsked(d);
    const email = G.accountFor(d.url, this.config(), referrer, opened);
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
