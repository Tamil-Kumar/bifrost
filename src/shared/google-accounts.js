/* Bifrost — which of your Google accounts Google's sites open with (settings accounts.google), as pure
   functions shared by the main process (main/google-accounts.js), Settings and the tests.

   Google opens its sites with the first account you signed in to, and the only way to change that is to sign
   out of them all and back in, in another order. Bifrost lets you choose one instead, for all of Google's sites
   (accounts.google.default) and for each (accounts.google.sites: [{ site, email }], email '' for Google's own
   choice there): a page of Google's opened from outside Google — the address bar, a bookmark, another site's
   link, another app — gets ?authuser= for that account, as the links in Google's own app menu carry. Inside
   Google nothing changes: its links already say which account they're for, and its account switcher works as
   usual. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBGoogle = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Google's sites: google.com and its subdomains, Google's search in other countries (google.co.uk…), YouTube.
  const GOOGLE_HOST = /(^|\.)google\.com$|^(www\.)?google\.(com?\.)?[a-z]{2}$|(^|\.)youtube\.com$/;
  // Left alone: signing in and out (and the pages that set your sign-in on Google's other domains), the cookie
  // consent pages, the Chrome Web Store (its Add to Chrome goes through Bifrost's extensions).
  const NEVER_HOST = /^(accounts|consent|ogs|chrome|chromewebstore|apis|clients\d*)\.google\.com$|^(accounts|consent)\.youtube\.com$/;
  // …and Google's redirects (search results, ads, its link checker), "are you a robot" and sign-in paths.
  const NEVER_PATH = /^\/(url|sorry|recaptcha|accounts|signin|logout|ServiceLogin|AddSession|imgres|aclk|pagead|gen_204|setprefs|redirect|attribution_link)(\/|$)/i;
  // A page that already says which account: /mail/u/1/, /u/0/, /b/…/ (a delegated or brand account), /a/<domain>/.
  const PICKED_PATH = /\/(u|b)\/[^/]+(\/|$)|^\/a\/[^/]+\//;

  // Suggestions for Settings: the sites you'd choose an account for, and what's on them.
  const SITES = [
    ['youtube.com', 'YouTube'],
    ['mail.google.com', 'Gmail'],
    ['drive.google.com', 'Drive'],
    ['docs.google.com', 'Docs, Sheets, Slides and Forms'],
    ['calendar.google.com', 'Calendar'],
    ['classroom.google.com', 'Classroom'],
    ['meet.google.com', 'Meet'],
    ['chat.google.com', 'Chat'],
    ['gemini.google.com', 'Gemini'],
    ['notebooklm.google.com', 'NotebookLM'],
    ['photos.google.com', 'Photos'],
    ['keep.google.com', 'Keep'],
    ['contacts.google.com', 'Contacts'],
    ['www.google.com', 'Search, and the rest of www.google.com'],
    ['www.google.com/maps', 'Maps'],
    ['music.youtube.com', 'YouTube Music'],
    ['studio.youtube.com', 'YouTube Studio'],
    ['myaccount.google.com', 'Your Google Account'],
    ['colab.research.google.com', 'Colab'],
    ['console.cloud.google.com', 'Google Cloud console'],
    ['aistudio.google.com', 'AI Studio'],
    ['play.google.com', 'Play'],
    ['news.google.com', 'News'],
    ['sites.google.com', 'Sites'],
    ['google.com', 'Every site on google.com'],
  ];

  const isGoogleHost = (host) => GOOGLE_HOST.test(String(host || '').toLowerCase());

  // An email as Google compares them: case doesn't count, nor do the dots in a Gmail address.
  function canonical(email) {
    let e = String(email || '').trim().toLowerCase();
    const at = e.lastIndexOf('@');
    if (at > 0) {
      let local = e.slice(0, at);
      let domain = e.slice(at + 1);
      if (domain === 'googlemail.com') domain = 'gmail.com';
      if (domain === 'gmail.com') local = local.replace(/\./g, '');
      e = local + '@' + domain;
    }
    return e;
  }
  const sameEmail = (a, b) => !!a && !!b && canonical(a) === canonical(b);

  // A site as you typed it ("youtube.com", "https://www.google.com/maps/"): { host, path }, or null.
  function parseSite(s) {
    s = String(s || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[?#].*$/, '');
    if (!s) return null;
    const i = s.indexOf('/');
    const host = (i < 0 ? s : s.slice(0, i)).replace(/:\d+$/, '').replace(/\.$/, '');
    const path = i < 0 ? '' : s.slice(i).replace(/\/+$/, '');
    if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
    return { host, path };
  }

  // The account a site of Google's opens with: the most specific of your sites that it's on (docs.google.com
  // before google.com, www.google.com/maps before www.google.com), else the default. '' for Google's choice.
  function siteAccount(u, cfg) {
    let best = null;
    let score = -1;
    for (const r of (cfg && cfg.sites) || []) {
      const s = parseSite(r && r.site);
      if (!s) continue;
      if (u.hostname !== s.host && !u.hostname.endsWith('.' + s.host)) continue;
      if (s.path && u.pathname !== s.path && !u.pathname.startsWith(s.path + '/')) continue;
      const n = s.host.length * 1000 + s.path.length;
      if (n > score) { score = n; best = r; }
    }
    if (best) return String(best.email || '');
    return String((cfg && cfg.default) || '');
  }

  // A page that says which account it's for already.
  function picksAccount(u) {
    return u.searchParams.has('authuser') || u.searchParams.has('pageid') || PICKED_PATH.test(u.pathname);
  }

  function fromGoogle(referrer) {
    if (!referrer) return false;
    try {
      const host = new URL(referrer).hostname.toLowerCase();
      return isGoogleHost(host) || /(^|\.)gmail\.com$/.test(host);
    } catch { return false; }
  }

  // The account a top-level page (url, opened from referrer) should open with: an email, or '' to leave it.
  function accountFor(url, cfg, referrer) {
    if (!cfg || (!cfg.default && !((cfg.sites || []).length))) return '';
    let u;
    try { u = url instanceof URL ? url : new URL(url); } catch { return ''; }
    if (u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase();
    if (!isGoogleHost(host) || NEVER_HOST.test(host) || NEVER_PATH.test(u.pathname)) return '';
    if (picksAccount(u) || fromGoogle(referrer)) return '';
    return siteAccount(u, cfg);
  }

  // The page's address with the account in it (which: its place among your accounts, or its email). Gmail's
  // front page becomes /mail/, where it reads it.
  function withAccount(url, which) {
    const u = new URL(String(url));
    if (u.hostname === 'mail.google.com' && /^\/(mail\/?)?$/.test(u.pathname)) u.pathname = '/mail/';
    const add = 'authuser=' + encodeURIComponent(String(which));
    u.search = u.search && u.search !== '?' ? u.search + '&' + add : '?' + add;
    return u.href;
  }

  // accounts.google.com/ListAccounts?json=standard, where Chrome reads your accounts from (its reading:
  // google_apis/gaia/gaia_auth_util.cc, ParseListAccountsData): ["gaia.l.a.r", [account…]], each account
  // ["gaia.l.a", 1, name, email, photo, …, 9: still valid (0: sign in again), 10: id, …, 14: signed out]. The
  // ones you're signed in to, in Google's order: an account's place in it is its authuser.
  function parseListAccounts(text) {
    let data;
    try { data = JSON.parse(String(text).replace(/^\)\]\}'\s*/, '')); } catch { data = null; }
    if (!Array.isArray(data) || !Array.isArray(data[1])) throw new Error('Google’s answer couldn’t be read');
    const out = [];
    for (const a of data[1]) {
      if (!Array.isArray(a) || typeof a[3] !== 'string' || !a[3]) continue;
      if (a.length > 14 && Number(a[14]) === 1) continue;
      out.push({
        email: a[3],
        name: typeof a[2] === 'string' ? a[2] : '',
        index: out.length,
        valid: !(a.length > 9 && typeof a[9] === 'number' && a[9] === 0),
      });
    }
    return out;
  }

  return { SITES, isGoogleHost, canonical, sameEmail, parseSite, siteAccount, picksAccount, fromGoogle, accountFor, withAccount, parseListAccounts };
});
