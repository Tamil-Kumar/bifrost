'use strict';
// Whether websites see a light or a dark preference (prefers-color-scheme), and what color Chromium draws
// their form controls and scrollbars in: appearance.webTheme.
//   system   as the computer is set (the default)
//   browser  like Bifrost's theme: a dark theme gets dark websites (with "Match the system", that's the system)
//   light / dark
// And Bifrost's dark mode for websites (settings webStyles, main/web-styles.js): Chromium's own dark mode for
// web pages (the DevTools protocol's auto dark mode), with the page told it's dark too, so a site with a dark
// theme of its own uses that (and Chromium leaves it alone).
// Pages are told through Chromium's own media emulation (it takes effect at once, in open tabs too, and
// stays with the tab as it moves from site to site); Bifrost's own pages follow Bifrost's theme instead.
// Chromium's widgets follow nativeTheme.themeSource, which is only changed when Bifrost's theme isn't
// "Match the system" (the window needs to know what the system really is then).
//
// A site that says it has a dark theme (color-scheme: dark, in a meta tag or on the page) but hasn't, or has
// only part of one (Google Classroom: its bar and menus dark, its pages white), Chromium leaves alone too, so
// it stays white. So a page that says so is looked at once it's drawn (its backgrounds, at 30 points across
// it), and one that's a quarter light or more is told it's light instead, which Chromium then darkens like any
// other. Its site is remembered (web-dark-learned.json in the profile, for 30 days: it may get a dark theme; a
// private window's, until Bifrost closes), so its pages are dark from the start next time. You can choose
// Bifrost's dark mode for a site yourself too (darkSites: 'bifrost').
//
// A page Bifrost gives Catppuccin's colors (Catppuccin for every site: main/web-styles.js recolorFor) is told
// dark or light by them, and Chromium's dark mode stays off on it: it's in those colors already.
//
// Frames from other sites (in processes of their own) are attached to and told the same while dark mode is
// on (Google's account card stayed white in a dark Gmail). And each frame hears whether it's on ('tab-dark-mode',
// and 'tab:start'): what Chromium's dark mode doesn't reach, a page drawn on a canvas (Google Docs) and icons
// drawn as masks over a dark color, preload/recolor.js turns itself (makeInk).
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { nativeTheme, webContents } = require('electron');
const ctx = require('./context');
const themes = require('../shared/themes');
const TD = require('./tab-debugger');

const LEARNED_FILE = 'web-dark-learned.json';
const LEARN_FOR = 30 * 24 * 3600 * 1000;
const CHECK_AT = [1500, 4000, 9000];   // after the page is ready (pages that draw themselves later, later)
const CHECK_WORLD = 1014;

function wanted() {
  const a = ctx.settings.get('appearance') || {};
  const mode = a.webTheme || 'browser';
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'browser' && a.theme !== 'auto') return themes.resolve(a, { systemDark: false }).dark ? 'dark' : 'light';
  return null;   // the system's
}

const isOwnPage = (url) => /^(bifrost|chrome-extension|devtools|chrome):/i.test(String(url || ''));
const hostOf = (url) => { try { return /^https?:$/.test(new URL(url).protocol) ? new URL(url).hostname.toLowerCase() : ''; } catch { return ''; } };

// ---------------------------------------------------------------- sites whose own dark theme isn't one
const events = new EventEmitter();   // 'learned': the list changed (for Settings)
const learned = new Map();    // host -> when it was seen (normal windows: kept in the profile)
const learnedHere = new Set();   // …in a private window
let learnedFile = '';
let saveTimer = null;

function loadLearned(dir) {
  learnedFile = path.join(dir, LEARNED_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(learnedFile, 'utf8'));
    for (const [h, at] of Object.entries((data && data.hosts) || {})) if (typeof at === 'number' && Date.now() - at < LEARN_FOR) learned.set(h, at);
  } catch { /* none yet */ }
}

function saveLearned() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!learnedFile) return;
    const tmp = learnedFile + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify({ version: 1, hosts: Object.fromEntries(learned) }))
      .then(() => fs.promises.rename(tmp, learnedFile))
      .catch((e) => console.error('[web-theme] save failed', e));
  }, 500);
}

const persistent = (wc) => { try { return !wc || wc.session.isPersistent(); } catch { return true; } };
const isLearned = (host, wc) => !!host && (learned.has(host) || (!persistent(wc) && learnedHere.has(host)));

function learn(host, wc) {
  if (!persistent(wc)) { learnedHere.add(host); return; }
  learned.set(host, Date.now());
  saveLearned();
  events.emit('learned', learnedList());
}

// For Settings: the sites, and forgetting one (looked at again the next time it's opened).
function learnedList() { return [...learned.keys()].sort(); }
function forget(host) {
  host = String(host || '').toLowerCase();
  if (!learned.delete(host) && !learnedHere.delete(host)) return learnedList();
  saveLearned();
  for (const wc of tabs()) if (hostOf(wc.getURL()) === host) { emulate(wc); checkSoon(wc); }
  events.emit('learned', learnedList());
  return learnedList();
}

// In the page (a world of Bifrost's own): whether it says it has a dark theme, and if so, how many of 30 points
// across it are on a light background (the first one under the point that's mostly opaque; a picture's don't
// count; none at all: the browser's own, dark when the page is told dark).
const CHECK = `(() => {
  const de = document.documentElement;
  if (!de || !document.body) return null;
  const says = [...document.querySelectorAll('meta[name="color-scheme" i]')].map((m) => m.content || '').join(' ') + ' ' + (getComputedStyle(de).colorScheme || '');
  if (!/(^|\\s)dark(\\s|$)/i.test(says)) return { says: false };
  const W = innerWidth, H = innerHeight;
  if (W < 200 || H < 150) return { says: true, light: 0, n: 0 };
  const cv = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); return cv.getImageData(0, 0, 1, 1).data; };
  const deepest = (x, y) => { let el = document.elementFromPoint(x, y); for (let k = 0; el && el.shadowRoot && k < 20; k++) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; } return el; };
  const up = (e) => e.parentElement || (e.parentNode instanceof ShadowRoot ? e.parentNode.host : null);
  let light = 0, n = 0;
  for (let i = 1; i <= 6; i++) for (let j = 1; j <= 5; j++) {
    const x = Math.round(W * i / 7), y = Math.round(H * j / 6);
    const el = deepest(x, y);
    if (!el || /^(img|video|canvas|iframe|embed|object|picture)$/i.test(el.localName)) continue;
    let c = null;
    for (let e = el, k = 0; e && k < 80; e = up(e), k++) {
      const st = getComputedStyle(e);
      if (st.backgroundImage && st.backgroundImage !== 'none' && !/gradient\\(/.test(st.backgroundImage)) { c = 'picture'; break; }
      const p = rgba(st.backgroundColor);
      if (p[3] >= 150) { c = p; break; }
    }
    if (c === 'picture') continue;
    n++;
    if (c && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 170) light++;
  }
  return { says: true, light, n };
})()`;

const checks = new WeakMap();   // webContents -> the page being looked at (a newer page stops the looks at the last)

function checkSoon(wc, times = CHECK_AT) {
  if (!wc || wc.isDestroyed()) return;
  const gen = (checks.get(wc) || 0) + 1;
  checks.set(wc, gen);
  for (const ms of times) setTimeout(() => check(wc, gen), ms);
}

async function check(wc, gen, tries = 0) {
  if (wc.isDestroyed() || checks.get(wc) !== gen) return;
  const st = state.get(wc);
  if (!st || !st.dark || st.scheme !== 'dark') return;   // dark mode isn't on here, or the page is darkened already
  const url = wc.getURL();
  const host = hostOf(url);
  if (!host || isLearned(host, wc)) return;
  let r = null;
  try { r = await wc.executeJavaScriptInIsolatedWorld(CHECK_WORLD, [{ code: CHECK }]); } catch { return; }
  if (wc.isDestroyed() || checks.get(wc) !== gen || wc.getURL() !== url || !r || !r.says) return;
  // (not laid out yet, or too small to tell: once more, a little later)
  if (r.n < 10) { if (tries < 3) setTimeout(() => check(wc, gen, tries + 1), 5000); return; }
  // (a quarter: a page whose cards or main part are white is no dark page, though its background may be)
  if (r.light < Math.max(3, r.n * 0.25)) return;
  learn(host, wc);
  emulate(wc, url);
}

// What a tab showing url is told: { scheme: 'dark' | 'light' | null (the system's), dark: Chromium's dark mode }.
// Always, when a scheme is wanted: Chromium's own setting (nativeTheme, see apply) doesn't reach web pages
// everywhere (on Linux it doesn't change prefers-color-scheme at all), and pages left on the system's scheme
// come out light in a dark browser. With dark mode on, a page is told it's dark (a site with a dark theme of its
// own uses it), except on a site whose own dark theme isn't one, or one you chose Bifrost's dark mode for: told
// light, and darkened by Chromium.
function perTab(url, wc) {
  if (isOwnPage(url)) return { scheme: null, dark: false };
  // A page in Catppuccin's colors (Catppuccin for every site, preload/recolor.js): told dark or light as they
  // are, so a site with a dark theme of its own starts from that; Chromium's dark mode stays off (they're its).
  const turned = ctx.webStyles ? ctx.webStyles.recolorFor(url) : null;
  if (turned) return { scheme: turned.dark ? 'dark' : 'light', dark: false };
  const how = ctx.webStyles ? ctx.webStyles.darkHow(url) : null;
  const dark = !!how;
  if (how === 'bifrost' || (dark && isLearned(hostOf(url), wc))) return { scheme: 'light', dark: true };
  return { scheme: dark ? 'dark' : wanted(), dark };
}

const state = new WeakMap();   // webContents -> what it's told ({ scheme, dark })
const NONE = { scheme: null, dark: false };

// What one session is told (the page's, or a frame's from another site), as it changes from was to want.
async function tell(dbg, want, was, sessionId) {
  if (want.scheme !== was.scheme) await dbg.sendCommand('Emulation.setEmulatedMedia', { features: want.scheme ? [{ name: 'prefers-color-scheme', value: want.scheme }] : [] }, sessionId);
  if (want.dark !== was.dark) await dbg.sendCommand('Emulation.setAutoDarkModeOverride', want.dark ? { enabled: true } : {}, sessionId);
}

// A frame from another site runs in a process of its own (Chromium's site isolation), which what the page's
// session says doesn't reach: Google's account card stayed white in a dark Gmail, an embedded form in a dark
// page. Each is attached as it starts (held until it's been told), and told the same; and the frames in it.
const kids = new WeakMap();      // webContents -> Set of its frames' sessions
const attaching = new WeakSet(); // webContents whose session attaches to its frames
const AUTO = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe' }] };
function watchKids(wc) {
  if (kids.has(wc)) return;
  kids.set(wc, new Set());
  wc.debugger.on('message', (_e, method, params) => {
    if (method === 'Target.attachedToTarget') {
      const id = params && params.sessionId;
      if (!id) return;
      const dbg = wc.debugger;
      const frame = params.targetInfo && params.targetInfo.type === 'iframe';
      if (frame) kids.get(wc).add(id);
      (async () => {
        try {
          if (frame) {
            await dbg.sendCommand('Target.setAutoAttach', AUTO, id);
            await tell(dbg, state.get(wc) || NONE, NONE, id);
          }
        } catch { /* gone already */ } finally {
          // (always let it go on: a frame held is a frame that never shows)
          dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, id).catch(() => {});
        }
      })();
    } else if (method === 'Target.detachedFromTarget' && params && params.sessionId) {
      const set = kids.get(wc);
      if (set) set.delete(params.sessionId);
    }
  });
}
// …and let go: told as they were, no longer attached to.
async function letKidsGo(wc, was) {
  if (!attaching.has(wc)) return;
  attaching.delete(wc);
  await tellKids(wc, NONE, was);
  await wc.debugger.sendCommand('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
  const set = kids.get(wc);
  if (!set) return;
  for (const id of set) wc.debugger.sendCommand('Target.detachFromTarget', { sessionId: id }).catch(() => {});
  set.clear();
}
async function tellKids(wc, want, was) {
  const set = kids.get(wc);
  if (!set) return;
  await Promise.all([...set].map((id) => tell(wc.debugger, want, was, id).catch(() => set.delete(id))));
}

// Each frame of the tab hears whether Chromium's dark mode is on (preload/recolor.js: pages drawn on a canvas,
// icons drawn as masks, made to show).
function tellFrames(wc, dark) {
  let frames = [];
  try { frames = wc.mainFrame.framesInSubtree; } catch { return; }
  for (const f of frames) { try { f.send('tab-dark-mode', !!dark); } catch { /* gone */ } }
}
// …and a page asks as it starts (guests.js 'tab:start').
function darkModeOn(wc) { const st = wc && state.get(wc); return !!(st && st.dark); }

// What's behind a page in its window (views.js): what shows before the page has drawn anything, and wherever it
// draws nothing of its own. The browser's white, but for a page Chromium's dark mode is on for (its dark gray,
// #121212, what it turns white into) or one in Catppuccin's colors (their base): a page with no background of its
// own had light text in dark mode over that white, unreadable, and every new tab flashed white before its page.
const backdrops = new WeakMap();   // webContents -> the color its window was last told ('' for the white)
function backdropFor(wc, url, want) {
  let color = '';
  if (!isOwnPage(url) && /^(https?|file):/i.test(String(url || ''))) {
    const turned = ctx.webStyles ? ctx.webStyles.recolorFor(url) : null;
    if (turned && turned.palette) color = turned.palette.base;
    else if (want.dark) color = '#121212';
  }
  if (backdrops.get(wc) === color) return;
  backdrops.set(wc, color);
  try {
    const ctl = require('./guests').ownerOf(wc);
    if (ctl) ctl.send('tab-backdrop', { wcId: wc.id, color });
  } catch { /* no window */ }
}

async function emulate(wc, url) {
  if (!wc || wc.isDestroyed()) return;
  const u = url == null ? wc.getURL() : url;
  const want = perTab(u, wc);
  backdropFor(wc, u, want);
  const was = state.get(wc) || NONE;
  if (was.scheme === want.scheme && was.dark === want.dark) return;
  state.set(wc, want);
  if (want.dark !== was.dark) tellFrames(wc, want.dark);
  const dbg = wc.debugger;
  try {
    if (want.scheme || want.dark) {
      TD.use(wc, 'theme');
      await tell(dbg, want, was);
      // (frames from other sites: while Chromium's dark mode is on; a scheme alone they get from Chromium's own
      // setting, as the page did before Bifrost told it)
      if (want.dark) {
        watchKids(wc);
        if (!attaching.has(wc)) { attaching.add(wc); await dbg.sendCommand('Target.setAutoAttach', AUTO); }
        await tellKids(wc, want, was);
      } else await letKidsGo(wc, was);
    } else if (dbg.isAttached() && (was.scheme || was.dark)) {
      await tell(dbg, NONE, was);
      await letKidsGo(wc, was);
      TD.release(wc, 'theme');
    }
  } catch (e) {
    // (Someone else's debugging session, or the page went away: leave it be.)
    state.delete(wc);
  }
}

const tabs = () => webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getType() === 'webview');

function apply() {
  const scheme = wanted();
  const a = ctx.settings.get('appearance') || {};
  const src = scheme && a.theme !== 'auto' ? scheme : 'system';
  if (nativeTheme.themeSource !== src) nativeTheme.themeSource = src;
  for (const wc of tabs()) emulate(wc);
}

// Every tab: told from its first page on, and again whenever it moves to another site (dark mode can be on
// for one and off for the next) or between Bifrost's pages and the web.
// src: the address it's about to load, when it's a new tab (its own address is nothing yet): told for that.
function attach(guest, src) {
  emulate(guest, src && !guest.getURL() ? src : undefined);
  guest.on('did-start-navigation', (details) => {
    if (!details || !details.isMainFrame || details.isSameDocument) return;
    checks.set(guest, (checks.get(guest) || 0) + 1);
    emulate(guest, details.url);
  });
  // A page that says it has a dark theme: looked at once it's drawn (and again as a page that draws itself
  // moves to another of its pages).
  guest.on('dom-ready', () => checkSoon(guest));
  guest.on('did-navigate-in-page', (_e, _url, isMainFrame) => { if (isMainFrame) checkSoon(guest, CHECK_AT.slice(0, 2)); });
  // (and once it's there: a navigation that became a download, or went elsewhere, leaves the tab on another page)
  guest.on('did-navigate', (_e, url) => emulate(guest, url));
  // Opening DevTools on the tab ends Bifrost's session with it (the page goes back to the system's scheme,
  // and out of dark mode, while they're open); closing them, it's told again.
  try { guest.debugger.on('detach', () => { state.delete(guest); attaching.delete(guest); const set = kids.get(guest); if (set) set.clear(); }); } catch { /* fine */ }
  guest.on('devtools-closed', () => setTimeout(() => { if (!guest.isDestroyed()) emulate(guest); }, 100));
  guest.once('destroyed', () => state.delete(guest));
}

function init() {
  if (ctx.profile && ctx.profile.dir) loadLearned(ctx.profile.dir);
  apply();
  ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('appearance')) apply(); });
}

module.exports = { init, apply, attach, wanted, learnedList, forget, events, CHECK, darkModeOn };
