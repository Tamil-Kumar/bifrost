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
// Which answers, and what's done to each, is data: shared/youtube-rules.json, which main/youtube-rules.js keeps
// up to date, so what YouTube changes (a key's name, an address, that check's wording) can be followed without
// a new version of Bifrost. The data only says which of the few things below to do, to which answers; it is
// checked before it's used (compile() throws on anything it doesn't know), and it can't reach past YouTube:
// whose answers these are is decided here.

const HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/i;
const FORMAT = 1;
const KEY = /^[A-Za-z_$][\w$]{0,60}$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const need = (ok, what) => { if (!ok) throw new Error('YouTube rules: ' + what); };
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const list = (v, max) => Array.isArray(v) && v.length > 0 && v.length <= max;

// The things that can be done to an answer. Each is made from its description once, and is then text → text.
const OPS = {
  // JSON keys renamed (wherever they are in it): { do: 'rename', keys: [...], to }
  rename(o) {
    need(list(o.keys, 20) && o.keys.every((k) => KEY.test(k)), 'rename: its keys');
    need(KEY.test(o.to), 'rename: what to');
    const re = new RegExp('"(' + o.keys.map(esc).join('|') + ')"(?=\\s*:)', 'g');
    const to = '"' + o.to + '"';
    return (t) => t.replace(re, () => to);
  },
  // Others, done inside the object a script gives a name (name = {…}), and nowhere else in the text:
  // { do: 'inside', after: name, edits: [...] }
  inside(o, nested) {
    need(!nested, 'inside: inside another');
    need(text(o.after, 80) && /^[\w$.]+$/.test(o.after), 'inside: after what');
    const inner = steps(o.edits, true);
    const start = new RegExp(esc(o.after) + '\\s*=\\s*\\{', 'g');
    return (t) => {
      const re = new RegExp(start.source, 'g');
      let out = t;
      let m;
      while ((m = re.exec(out))) {
        const from = m.index + m[0].length - 1;
        const end = objectEnd(out, from);
        if (end < 0) break;
        const was = out.slice(from, end + 1);
        const now = inner(was);
        if (now !== was) out = out.slice(0, from) + now + out.slice(end + 1);
        re.lastIndex = from + now.length;
      }
      return out;
    };
  },
  // Items taken out of every list of that name in a JSON answer, the ones where a path of keys leads to
  // something: { do: 'prune', list, where: [...], has } (has: text the answer has when there's any to take out)
  prune(o) {
    need(KEY.test(o.list), 'prune: which list');
    need(list(o.where, 8) && o.where.every((k) => KEY.test(k)), 'prune: which items');
    need(o.has == null || text(o.has, 100), 'prune: has');
    const hit = (e) => { let v = e; for (const k of o.where) { if (!v || typeof v !== 'object') return false; v = v[k]; } return !!v; };
    const walk = (x, depth) => {
      if (!x || typeof x !== 'object' || depth > 12) return 0;
      let n = 0;
      if (Array.isArray(x)) { for (const y of x) n += walk(y, depth + 1); return n; }
      for (const k of Object.keys(x)) {
        const v = x[k];
        if (!v || typeof v !== 'object') continue;
        if (k === o.list && Array.isArray(v) && v.some(hit)) { x[k] = v.filter((e) => !hit(e)); n += v.length - x[k].length; }
        n += walk(x[k], depth + 1);
      }
      return n;
    };
    return (t) => {
      if (o.has && !t.includes(o.has)) return t;
      // (an answer can start with )]}' to keep other sites from reading it as a script)
      let pre = '';
      if (t.startsWith(")]}'")) { const nl = t.indexOf('\n'); pre = nl >= 0 ? t.slice(0, nl + 1) : ")]}'"; }
      let obj;
      try { obj = JSON.parse(t.slice(pre.length)); } catch { return t; }
      return walk(obj, 0) ? pre + JSON.stringify(obj) : t;
    };
  },
  // A pattern in a script, replaced: { do: 'replace', has, find, with } (has: text the script has when the
  // pattern can be there; it isn't looked for otherwise)
  replace(o) {
    need(text(o.has, 100), 'replace: has');
    need(text(o.find, 400), 'replace: find');
    need(typeof o.with === 'string' && o.with.length <= 200, 'replace: with');
    let re;
    try { re = new RegExp(o.find, 'g'); } catch { need(false, 'replace: its pattern'); }
    return (t) => (t.includes(o.has) ? t.replace(re, o.with) : t);
  },
};

// A list of them, one after another. One that fails leaves the text as it had it.
function steps(edits, nested) {
  need(list(edits, 12), 'what to do to an answer');
  const fns = edits.map((o) => {
    need(o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(OPS, o.do), 'something to do that isn’t known' + (o && o.do ? ' (' + String(o.do).slice(0, 30) + ')' : ''));
    return OPS[o.do](o, nested);
  });
  return (t) => { let out = t; for (const fn of fns) { try { out = fn(out); } catch { /* as it was */ } } return out; };
}

// A selector that only selects: nothing that could end the rule it's put in, or start another.
const selector = (s) => text(s, 300) && !/[{};@<\\\n\r]|\/\*/.test(s);

// The rules, checked and made ready: { format, version, hold, kindOf(url, resourceType), edit(kind, text),
// page: { skip, hide }, raw }. Throws when anything in them isn't as it should be.
function compile(raw) {
  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'not an object');
  need(raw.format === FORMAT, 'made for another version of Bifrost (format ' + JSON.stringify(raw.format) + ')');
  need(Number.isSafeInteger(raw.version) && raw.version > 0, 'no version');
  need(list(raw.hold, 30) && raw.hold.every((p) => text(p, 120) && /^\/[\w\-./*?=&%]*$/.test(p)), 'which answers to hold');
  need(raw.edits && typeof raw.edits === 'object' && !Array.isArray(raw.edits), 'no edits');
  const kinds = Object.keys(raw.edits);
  need(kinds.length > 0 && kinds.length <= 12 && kinds.every((k) => /^[a-z]{1,20}$/.test(k)), 'the kinds of answers');
  const edits = {};
  for (const k of kinds) edits[k] = steps(raw.edits[k], false);
  need(list(raw.answers, 30), 'which answers are which');
  const answers = raw.answers.map((a) => {
    need(a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(edits, a.kind), 'an answer of a kind with no edits');
    need(text(a.path, 200), 'an answer’s address');
    need(a.from == null || a.from === 'page' || a.from === 'data', 'who asked for an answer');
    let re;
    try { re = new RegExp(a.path); } catch { need(false, 'an answer’s address'); }
    return { kind: a.kind, re, from: a.from || '' };
  });
  const page = raw.page && typeof raw.page === 'object' ? raw.page : {};
  for (const k of ['skip', 'hide']) need(page[k] == null || (Array.isArray(page[k]) && page[k].length <= 150 && page[k].every(selector)), 'what’s ' + (k === 'skip' ? 'pressed' : 'hidden') + ' in its pages');

  // Which of these an answer is (from its address and what asked for it), or '' for one left as it is.
  function kindOf(url, resourceType) {
    let u;
    try { u = new URL(url); } catch { return ''; }
    if (!HOSTS.test(u.hostname)) return '';
    const from = resourceType === 'Document' ? 'page' : 'data';
    for (const a of answers) if ((!a.from || a.from === from) && a.re.test(u.pathname)) return a.kind;
    return '';
  }
  const edit = (kind, t) => (Object.prototype.hasOwnProperty.call(edits, kind) ? edits[kind](t) : t);
  return { format: raw.format, version: raw.version, hold: raw.hold.slice(), kindOf, edit, page: { skip: (page.skip || []).slice(), hide: (page.hide || []).slice() }, raw };
}

module.exports = { compile, objectEnd, HOSTS, FORMAT };
