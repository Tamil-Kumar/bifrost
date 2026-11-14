'use strict';
// What YouTube's answers become before its page sees them (main/youtube-ads.js holds them as they arrive): plain
// text in, text out, the same text when there's nothing to change. As AdGuard's app does it:
//  · the player's data (youtubei/v1/player and get_watch, a watch page or playlist asked for by the page): its
//    ads, adPlacements, adSlots and playerAds, renamed no_ads, so the player has none to play (YouTube Premium's
//    answers have none either);
//  · a watch page itself: the same, in the player's data it starts with (ytInitialPlayerResponse = {…}), and
//    nowhere else in it;
//  · Shorts (youtubei/v1/reel/…): the reels that are ads taken out of the lists of them;
//  · the player's script (s/player/…/base.js): its check that a video came with no ads (which tells YouTube
//    you block them) made to pass.

const AD_KEYS = /"(adPlacements|adSlots|playerAds)"(?=\s*:)/g;

// The player's data, as JSON (or JSON with )]}' before it).
function playerData(text) {
  return text.replace(AD_KEYS, '"no_ads"');
}

// Where the object starting at text[i] ('{') ends: the index of its '}', or -1. Strings (with their escapes) are
// stepped over.
function objectEnd(text, i) {
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c === 34) {   // "
      for (k++; k < text.length; k++) {
        const d = text.charCodeAt(k);
        if (d === 92) k++;          // \x
        else if (d === 34) break;
      }
    } else if (c === 123) depth++;   // {
    else if (c === 125 && --depth === 0) return k;   // }
  }
  return -1;
}

// A watch page: the player's data it starts with.
function watchPage(html) {
  const re = /ytInitialPlayerResponse\s*=\s*\{/g;
  let out = html;
  let m;
  while ((m = re.exec(out))) {
    const start = m.index + m[0].length - 1;
    const end = objectEnd(out, start);
    if (end < 0) break;
    const was = out.slice(start, end + 1);
    const now = playerData(was);
    if (now !== was) out = out.slice(0, start) + now + out.slice(end + 1);
    re.lastIndex = start + now.length;
  }
  return out;
}

// A reel that's an ad.
const isAdReel = (e) => {
  try { const ep = e && e.command && e.command.reelWatchEndpoint; return !!(ep && ep.adClientParams && ep.adClientParams.isAd); } catch { return false; }
};

// Takes the ad reels out of every list of "entries" in o; how many it took out.
function pruneReels(o, depth) {
  if (!o || typeof o !== 'object' || depth > 12) return 0;
  let n = 0;
  if (Array.isArray(o)) { for (const x of o) n += pruneReels(x, depth + 1); return n; }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (!v || typeof v !== 'object') continue;
    if (k === 'entries' && Array.isArray(v) && v.some(isAdReel)) { o[k] = v.filter((e) => !isAdReel(e)); n += v.length - o[k].length; }
    n += pruneReels(o[k], depth + 1);
  }
  return n;
}

// Shorts' reels (an answer can start with )]}' to keep other sites from reading it as a script).
function reels(text) {
  if (!text.includes('adClientParams')) return text;
  let pre = '';
  if (text.startsWith(")]}'")) { const nl = text.indexOf('\n'); pre = nl >= 0 ? text.slice(0, nl + 1) : ")]}'"; }
  let obj;
  try { obj = JSON.parse(text.slice(pre.length)); } catch { return text; }
  return pruneReels(obj, 0) ? pre + JSON.stringify(obj) : text;
}

// The player's script: `if(!x||!x.adPlacements&&!x.adSlots)`, its check for a video that came without ads, made
// `if(!x||0)` (whatever the variable's called this week).
const NO_ADS_CHECK = /if\(!([\w$]+)\|\|!\1\.adPlacements&&!\1\.adSlots\)/g;
function playerScript(text) {
  return text.includes('.adPlacements&&') ? text.replace(NO_ADS_CHECK, 'if(!$1||0)') : text;
}

// Which of these an answer is (from its address and what asked for it), or '' for one left as it is.
function kindOf(url, resourceType) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/i.test(u.hostname)) return '';
  const p = u.pathname;
  const page = resourceType === 'Document';
  if (/^\/youtubei\/v1\/(player|get_watch)(\/|$)/.test(p)) return 'player';
  if (/^\/youtubei\/v1\/reel\//.test(p)) return 'reels';
  if (p === '/watch' || p === '/playlist') return page ? 'page' : 'player';
  if (/^\/s\/player\/.*\/base\.js$/.test(p)) return 'script';
  return '';
}

function edit(kind, text) {
  switch (kind) {
    case 'player': return playerData(text);
    case 'page': return watchPage(text);
    case 'reels': return reels(text);
    case 'script': return playerScript(text);
    default: return text;
  }
}

module.exports = { kindOf, edit, playerData, watchPage, reels, playerScript, objectEnd };
