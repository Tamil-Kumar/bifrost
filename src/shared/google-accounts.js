/* Bifrost — which of your Google accounts Google's sites open with (settings accounts.google), as pure
   functions shared by the main process (main/google-accounts.js), Settings and the tests.

   Google opens its sites with the first account you signed in to, and the only way to change that is to sign
   out of them all and back in, in another order. Bifrost lets you choose one instead, for all of Google's sites
   (accounts.google.default) and for each (accounts.google.sites: [{ site, email }], email '' for Google's own
   choice there): a page of Google's opened from outside Google — the address bar, a bookmark, another site's
   link, another app — gets ?authuser= for that account, as the links in Google's own app menu carry. Inside
   Google nothing changes: its links already say which account they're for, and its account switcher works as
   usual.
   A page you open yourself, or another site's link to one, gets your account even when its address names one
   by number (/mail/u/0/, ?authuser=0): Gmail's addresses always do, so every one you've saved, been sent or
   have in your history names Google's first account, not one you chose. One named by email, a brand or
   delegated account (/b/), a Workspace domain (/a/) are kept, as is the account of a page that's reloaded, gone
   back to or reopened. Gmail's own address (gmail.com) is Gmail's front page. */
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
  // …by number: its place among your accounts (Gmail, Drive, Calendar, Classroom, Photos…: /u/0/).
  const U_NUMBER = /\/u\/\d+(?=\/|$)/;
  // Gmail's own address: its front page is Gmail's.
  const GMAIL_HOST = /^(www\.)?(gmail|googlemail)\.com$/;

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

  // Whether the only account a page names is a number (/u/0/, authuser=0), which a page you open yourself gets
  // yours in place of.
  function byNumberOnly(u) {
    if (u.searchParams.has('pageid') || /\/b\/[^/]+(\/|$)|^\/a\/[^/]+\//.test(u.pathname)) return false;
    const au = u.searchParams.getAll('authuser');
    if (au.some((v) => !/^\d+$/.test(v))) return false;
    if (/\/u\/(?!\d+(\/|$))[^/]+/.test(u.pathname)) return false;
    return au.length > 0 || U_NUMBER.test(u.pathname);
  }

  // The account a top-level page (url, opened from referrer) should open with: an email, or '' to leave it.
  // opened: you opened it yourself (the address bar, a bookmark, the launcher, another app), or a link on a site
  // that isn't Google's did — not a reload, a page gone back to or put back, nor one a page of Google's opened.
  function accountFor(url, cfg, referrer, opened) {
    if (!cfg || (!cfg.default && !((cfg.sites || []).length))) return '';
    let u;
    try { u = url instanceof URL ? url : new URL(url); } catch { return ''; }
    if (u.protocol !== 'https:') return '';
    if (GMAIL_HOST.test(u.hostname.toLowerCase())) {
      // (gmail.com's other pages are left to it)
      if (u.pathname !== '/') return '';
      u = new URL('https://mail.google.com/mail/');
    }
    const host = u.hostname.toLowerCase();
    if (!isGoogleHost(host) || NEVER_HOST.test(host) || NEVER_PATH.test(u.pathname)) return '';
    if (fromGoogle(referrer)) return '';
    if (picksAccount(u) && !(opened && byNumberOnly(u))) return '';
    return siteAccount(u, cfg);
  }

  // A query without authuser, as it was written (its encoding untouched).
  function withoutAuthuser(search) {
    const parts = String(search || '').replace(/^\?/, '').split('&').filter((x) => x && !/^authuser(=|$)/.test(x));
    return parts.length ? '?' + parts.join('&') : '';
  }

  // The page's address with the account in it (which: its place among your accounts, or its email), in place of
  // any it named by number. Gmail's front page (and gmail.com) becomes /mail/, where it reads it; a page with
  // /u/<number>/ gets yours there (an email: as authuser, the /u/ taken out, which is the same page for
  // Google's first account).
  function withAccount(url, which) {
    let u = new URL(String(url));
    if (GMAIL_HOST.test(u.hostname.toLowerCase())) {
      const g = new URL('https://mail.google.com/mail/');
      g.search = u.search;
      g.hash = u.hash;
      u = g;
    }
    if (u.hostname === 'mail.google.com' && /^\/(mail\/?)?$/.test(u.pathname)) u.pathname = '/mail/';
    const search = withoutAuthuser(u.search);
    if (U_NUMBER.test(u.pathname)) {
      if (typeof which === 'number') {
        u.pathname = u.pathname.replace(U_NUMBER, '/u/' + which);
        u.search = search;
        return u.href;
      }
      u.pathname = u.pathname.replace(U_NUMBER, '') || '/';
    }
    const add = 'authuser=' + encodeURIComponent(String(which));
    u.search = search ? search + '&' + add : '?' + add;
    return u.href;
  }

  // What a page of Google's you open is known by until its request comes (main/google-accounts.js): its address
  // without http(s):// or #…, the way the request has it; '' for any other page.
  function openKey(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const host = u.hostname.toLowerCase();
    if (!isGoogleHost(host) && !GMAIL_HOST.test(host)) return '';
    return host + u.pathname + u.search;
  }

  // accounts.google.com/ListAccounts, where Chrome reads your accounts from. The ones you're signed in to, in
  // Google's order: an account's place in it is its authuser. Two forms of the same list, with the same places:
  //  · laf=b64bin, what Chrome asks for now (google_apis/gaia/gaia_auth_util.cc, ParseBinaryListAccountsData):
  //    base64 of a ListAccountsResponse protobuf (list_accounts_response.proto): account = 1, each with
  //    2: name, 3: email, 9: still valid (0: sign in again), 10: id, 14: signed out;
  //  · json=standard, what it read before: ["gaia.l.a.r", [account…]], each ["gaia.l.a", 1, name, email,
  //    photo, …] with the same numbers as places.
  function parseListAccounts(text) {
    const s = String(text).replace(/^\)\]\}'\s*/, '').trim();
    const rows = s.startsWith('[') ? jsonAccounts(s) : binaryAccounts(s);
    const out = [];
    for (const a of rows) {
      if (typeof a[3] !== 'string' || !a[3] || Number(a[14]) === 1) continue;
      out.push({ email: a[3], name: typeof a[2] === 'string' ? a[2] : '', index: out.length, valid: !(a[9] === 0 || a[9] === false) });
    }
    return out;
  }

  const UNREADABLE = 'Google’s answer couldn’t be read';

  function jsonAccounts(s) {
    let data;
    try { data = JSON.parse(s); } catch { data = null; }
    if (!Array.isArray(data) || !Array.isArray(data[1])) throw new Error(UNREADABLE);
    return data[1].filter(Array.isArray);
  }

  // Each account as a sparse array by field number, like the JSON's.
  function binaryAccounts(s) {
    const b64 = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error(UNREADABLE);
    const bytes = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(b64, 'base64')) : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = (u8) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return null; } };
    try {
      return protoFields(bytes).filter((f) => f.n === 1 && f.wire === 2).map((f) => {
        const a = [];
        for (const g of protoFields(f.value)) {
          if (g.wire === 0) a[g.n] = g.value;
          else if (g.wire === 2) { const t = text(g.value); if (t != null) a[g.n] = t; }
        }
        return a;
      });
    } catch { throw new Error(UNREADABLE); }
  }

  // A protobuf message's fields: { n, wire, value } (varints as numbers, bytes as Uint8Arrays; fixed-size ones
  // skipped).
  function protoFields(u8) {
    const out = [];
    let i = 0;
    const varint = () => {
      let v = 0, mul = 1;
      for (let k = 0; k < 10; k++) {
        if (i >= u8.length) throw new Error('cut short');
        const b = u8[i++];
        v += (b & 0x7f) * mul;
        if (!(b & 0x80)) return v;
        mul *= 128;
      }
      throw new Error('bad varint');
    };
    while (i < u8.length) {
      const key = varint();
      const n = Math.floor(key / 8), wire = key % 8;
      if (wire === 0) out.push({ n, wire, value: varint() });
      else if (wire === 2) {
        const len = varint();
        if (i + len > u8.length) throw new Error('cut short');
        out.push({ n, wire, value: u8.subarray(i, i + len) });
        i += len;
      } else if (wire === 1) i += 8;
      else if (wire === 5) i += 4;
      else throw new Error('bad field');
      if (i > u8.length) throw new Error('cut short');
    }
    return out;
  }

  return { SITES, isGoogleHost, canonical, sameEmail, parseSite, siteAccount, picksAccount, byNumberOnly, fromGoogle, accountFor, withAccount, openKey, parseListAccounts };
});
