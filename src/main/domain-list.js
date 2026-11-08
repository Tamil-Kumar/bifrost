'use strict';
// The domain list: HaGeZi's DNS blocklists (https://github.com/hagezi/dns-blocklists, GPL-3.0), whole domains
// of ads, trackers, telemetry, pop-up ads, scams and malware. adblock.js runs it in an engine of its own, after
// the other lists, with what's here to keep it from breaking sites:
//
// - It never stops the site you're on: a rule naming the page's own site (or the frame's) lets that site's
//   requests through (visit a site that's on the list and it works; it's only blocked on other sites).
// - Nor a company's own services on that company's other sites (OWNERS: Google's consoles calling
//   googleapis.com, Office calling live.com, TikTok calling tiktokv.com…). On anybody else's site they're
//   blocked as usual.
// - Its allowlists (HaGeZi's, and Bifrost's assets/adblock/domains-keep.txt: bot checks, captchas, embedded
//   posts…) only let through what this list would have stopped: what EasyList and the rest block stays blocked.
// - Pages themselves are never blocked (adblock.js), only what they load, and pop-up ads (window.open).
//
// compose() builds the list from HaGeZi's files when the lists are updated (adblock.js updateDomains, in the
// worker); the one that comes with Bifrost is assets/adblock/domains.txt.gz.

// HaGeZi's files: the lists the domain list is made of, and the allowlists it applies (paths in the
// repository, fetched from GitHub or its jsDelivr mirror). Ultimate and the tiers under it each have a few
// entries the others leave out, so all of them; then Pop-Up Ads, the native trackers (devices' and apps'
// telemetry) and Ad-Shield (ads that come back after an ad blocker took them out).
const SOURCES = {
  bases: [
    'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/',
    'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/',
  ],
  block: [
    'adblock/ultimate.txt', 'adblock/pro.plus.txt', 'adblock/pro.txt', 'adblock/multi.txt', 'adblock/light.txt',
    'adblock/popupads.txt',
    'adblock/native.amazon.txt', 'adblock/native.apple.txt', 'adblock/native.huawei.txt', 'adblock/native.lgwebos.txt',
    'adblock/native.oppo-realme.txt', 'adblock/native.roku.txt', 'adblock/native.samsung.txt', 'adblock/native.tiktok.extended.txt',
    'adblock/native.tiktok.txt', 'adblock/native.vivo.txt', 'adblock/native.winoffice.txt', 'adblock/native.xiaomi.txt',
    'share/ad-shield-adblock.txt',
  ],
  // Ultimate's known issues, META's and Microsoft's own services, and links in mails and search results.
  allow: ['share/ultimate-known-issues.txt', 'share/facebook.txt', 'share/microsoft.txt', 'adblock/whitelist-referral.txt'],
};

// A list made of fewer rules than this is a download gone wrong, not the list (Ultimate alone is 250,000).
const MIN_RULES = 50000;

const BLOCK = /^\|\|([a-z0-9*_][a-z0-9*_.-]*)\^$/i;
const ALLOW_ADB = /^@@\|\|([a-z0-9*_][a-z0-9*_.-]*)\^/i;
const ALLOW_PLAIN = /^([a-z0-9*_][a-z0-9*_-]*(?:\.[a-z0-9*_-]+)+)$/i;

// A domain whose parent is listed too: the parent's rule covers it already.
function underListed(d, set) {
  if (d.includes('*')) return false;
  for (let i = d.indexOf('.'); i !== -1; i = d.indexOf('.', i + 1)) if (set.has(d.slice(i + 1))) return true;
  return false;
}

// blocks, allows: [{ name, text }] (HaGeZi's files as fetched). Returns the list as adblock syntax, with how
// many rules of each kind. Throws when a list has no rules in it, or the whole is too small to be right.
function compose({ blocks, allows = [], built = new Date().toISOString(), min = MIN_RULES }) {
  const block = new Set();
  for (const { name, text } of blocks) {
    let n = 0;
    for (const raw of String(text).split('\n')) {
      const m = BLOCK.exec(raw.trim());
      if (m) { block.add(m[1].toLowerCase()); n++; }
    }
    if (!n) throw new Error(`${name}: no rules in it`);
  }
  const allow = new Set();
  for (const { text } of allows) {
    for (const raw of String(text).split('\n')) {
      const line = raw.trim();
      if (!line || /^[#![]/.test(line)) continue;
      const m = ALLOW_ADB.exec(line) || ALLOW_PLAIN.exec(line);
      if (m) allow.add(m[1].toLowerCase());
    }
  }
  const rules = [];
  for (const d of block) if (!underListed(d, block)) rules.push('||' + d + '^');
  if (rules.length < min) throw new Error(`only ${rules.length} rules: not the whole list`);
  const exceptions = [...allow].map((d) => '@@||' + d + '^');
  const head = [
    '[Adblock Plus]',
    `! Title: HaGeZi's DNS blocklists (${blocks.map((b) => b.name.replace(/^.*\//, '').replace(/\.txt$/, '')).join(', ')})`,
    `! Built: ${built} by Bifrost from https://github.com/hagezi/dns-blocklists (GPL-3.0)`,
    `! Allowlists, as exceptions to these rules only: ${allows.map((a) => a.name.replace(/^.*\//, '')).join(', ') || 'none'}`,
    `! Block rules: ${rules.length} | Exception rules: ${exceptions.length}`,
    '!',
  ];
  return { text: head.concat(rules, exceptions).join('\n') + '\n', rules: rules.length, exceptions: exceptions.length };
}

// How many block rules a list says it has (its header), or counts them.
function ruleCount(text) {
  const m = /^! Block rules: (\d+)/m.exec(String(text).slice(0, 2000));
  if (m) return Number(m[1]);
  let n = 0;
  for (const line of String(text).split('\n')) if (line.startsWith('||')) n++;
  return n;
}

// A rule naming this host, or a site it's part of (ruleHost example.com: example.com, www.example.com).
function covers(ruleHost, host) {
  return !!ruleHost && !!host && (host === ruleHost || host.endsWith('.' + ruleHost));
}

// Companies and their domains (registrable ones). Never a domain that serves other people's content
// (blogspot.com, appspot.com, googleusercontent.com, web.app, firebaseapp.com, amazonaws.com, cloudfront.net,
// azurewebsites.net, windows.net, azureedge.net…): a site there isn't the company's.
const OWNERS = {
  Google: ['google.com', 'googleapis.com', 'gstatic.com', 'googlevideo.com', 'youtube.com', 'youtube-nocookie.com', 'youtubekids.com', 'ytimg.com', 'ggpht.com', 'youtu.be', 'gmail.com', 'withgoogle.com', 'web.dev', 'chrome.com', 'chromium.org', 'android.com', 'gvt1.com', 'gvt2.com', 'gvt3.com', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com', 'googletagservices.com', 'doubleclick.net', 'googlesyndication.com', 'app-measurement.com', 'firebase.com', 'recaptcha.net', 'blogger.com', 'goo.gl', 'g.co', 'googleblog.com', 'googlesource.com', 'gstatic.cn', 'googleapis.cn', 'google.cn'],
  Microsoft: ['microsoft.com', 'microsoftonline.com', 'microsoftonline-p.com', 'msauth.net', 'msftauth.net', 'msauthimages.net', 'live.com', 'live.net', 'office.com', 'office.net', 'office365.com', 'onenote.com', 'sharepoint.com', 'sharepointonline.com', 'onedrive.com', 'outlook.com', 'hotmail.com', 'skype.com', 'skypeassets.com', 'bing.com', 'bing.net', 'msn.com', 'xbox.com', 'xboxlive.com', 'azure.com', 'windows.com', 'windowsupdate.com', 'aspnetcdn.com', 's-microsoft.com', 'msocdn.com', 'cloud.microsoft', 'static.microsoft', 'microsoftstream.com', 'visualstudio.com', 'vsassets.io', 'clarity.ms', 'msedge.net', 'linkedin.com', 'licdn.com', 'lnkd.in'],
  Meta: ['facebook.com', 'facebook.net', 'fbcdn.net', 'fbsbx.com', 'fb.com', 'fb.me', 'instagram.com', 'cdninstagram.com', 'whatsapp.com', 'whatsapp.net', 'wa.me', 'messenger.com', 'm.me', 'meta.com', 'threads.net', 'threads.com', 'oculus.com', 'oculuscdn.com', 'workplace.com'],
  Amazon: ['amazon.com', 'media-amazon.com', 'ssl-images-amazon.com', 'images-amazon.com', 'amazon-adsystem.com', 'amazon.dev', 'a2z.com', 'primevideo.com', 'aiv-cdn.net', 'aiv-delivery.net', 'amazonvideo.com', 'pv-cdn.net', 'audible.com', 'imdb.com', 'media-imdb.com', 'awsstatic.com'],
  Apple: ['apple.com', 'icloud.com', 'icloud-content.com', 'mzstatic.com', 'apple-cloudkit.com', 'cdn-apple.com', 'apple.news', 'me.com', 'itunes.com', 'aaplimg.com', 'apple-mapkit.com'],
  ByteDance: ['tiktok.com', 'tiktokv.com', 'tiktokv.us', 'tiktokv.eu', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokw.us', 'tiktokw.eu', 'ttwstatic.com', 'ibytedtos.com', 'ibyteimg.com', 'byteoversea.com', 'byteoversea.net', 'bytedance.com', 'byteimg.com', 'capcut.com', 'capcutapi.com', 'snssdk.com', 'isnssdk.com', 'zijieapi.com', 'pstatp.com', 'muscdn.com'],
  X: ['twitter.com', 'x.com', 'twimg.com', 't.co', 'twttr.com', 'periscope.tv', 'pscp.tv'],
  Adobe: ['adobe.com', 'adobe.io', 'adobelogin.com', 'adobecc.com', 'adobeccstatic.com', 'typekit.net', 'typekit.com', 'behance.net', 'adobestock.com', 'acrobat.com', 'adobe.net', 'adobesign.com', 'echosign.com', 'frame.io'],
  Yahoo: ['yahoo.com', 'yimg.com', 'yahoo.net', 'yahooapis.com', 'aol.com', 'aolcdn.com'],
  Netflix: ['netflix.com', 'netflix.net', 'nflxext.com', 'nflximg.net', 'nflximg.com', 'nflxvideo.net', 'nflxso.net'],
  Spotify: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotify.net'],
  Twitch: ['twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net', 'twitchsvc.net', 'ext-twitch.tv'],
  Zoom: ['zoom.us', 'zoom.com', 'zoomgov.com'],
  Samsung: ['samsung.com', 'samsungcloud.com', 'samsungapps.com', 'samsungosp.com'],
  Xiaomi: ['xiaomi.com', 'mi.com', 'miui.com', 'xiaomi.net'],
};
// …and the country sites (google.co.uk, amazon.de, bing.com.au…): a country's suffix only, so never a
// subdomain of someone's hosting (amazon.github.io is somebody's).
const FAMILIES = [[/^google\.(com?\.)?[a-z]{2}$/, 'Google'], [/^amazon\.(com?\.)?[a-z]{2}$/, 'Amazon'], [/^audible\.(com?\.)?[a-z]{2}$/, 'Amazon']];
const OWNER_OF = new Map();
for (const [owner, list] of Object.entries(OWNERS)) for (const d of list) OWNER_OF.set(d, owner);

function ownerOf(domain) {
  if (!domain) return null;
  const d = String(domain).toLowerCase();
  const o = OWNER_OF.get(d);
  if (o) return o;
  for (const [re, owner] of FAMILIES) if (re.test(d)) return owner;
  return null;
}

// Two different sites of the same company (registrable domains: google.com and googleapis.com).
function sameOwner(a, b) {
  if (!a || !b || a === b) return false;
  const o = ownerOf(a);
  return !!o && o === ownerOf(b);
}

module.exports = { SOURCES, MIN_RULES, compose, ruleCount, covers, ownerOf, sameOwner, OWNERS };
