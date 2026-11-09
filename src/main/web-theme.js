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
const { nativeTheme, webContents } = require('electron');
const ctx = require('./context');
const themes = require('../shared/themes');

function wanted() {
  const a = ctx.settings.get('appearance') || {};
  const mode = a.webTheme || 'browser';
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'browser' && a.theme !== 'auto') return themes.resolve(a, { systemDark: false }).dark ? 'dark' : 'light';
  return null;   // the system's
}

const isOwnPage = (url) => /^(bifrost|chrome-extension|devtools|chrome):/i.test(String(url || ''));

// What a tab showing url is told: { scheme: 'dark' | 'light' | null (the system's), dark: Chromium's dark mode }.
// Always, when a scheme is wanted: Chromium's own setting (nativeTheme, see apply) doesn't reach web pages
// everywhere (on Linux it doesn't change prefers-color-scheme at all), and pages left on the system's scheme
// come out light in a dark browser.
function perTab(url) {
  if (isOwnPage(url)) return { scheme: null, dark: false };
  const dark = !!(ctx.webStyles && ctx.webStyles.darkFor(url));
  return { scheme: dark ? 'dark' : wanted(), dark };
}

const state = new WeakMap();   // webContents -> what it's told ({ scheme, dark })
const NONE = { scheme: null, dark: false };

async function emulate(wc, url) {
  if (!wc || wc.isDestroyed()) return;
  const want = perTab(url == null ? wc.getURL() : url);
  const was = state.get(wc) || NONE;
  if (was.scheme === want.scheme && was.dark === want.dark) return;
  state.set(wc, want);
  const dbg = wc.debugger;
  try {
    if (want.scheme || want.dark) {
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (want.scheme !== was.scheme) await dbg.sendCommand('Emulation.setEmulatedMedia', { features: want.scheme ? [{ name: 'prefers-color-scheme', value: want.scheme }] : [] });
      if (want.dark !== was.dark) await dbg.sendCommand('Emulation.setAutoDarkModeOverride', want.dark ? { enabled: true } : {});
    } else if (dbg.isAttached() && (was.scheme || was.dark)) {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      if (was.dark) await dbg.sendCommand('Emulation.setAutoDarkModeOverride', {});
      try { dbg.detach(); } catch { /* already gone */ }
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
function attach(guest) {
  emulate(guest);
  guest.on('did-start-navigation', (details) => {
    if (!details || !details.isMainFrame || details.isSameDocument) return;
    emulate(guest, details.url);
  });
  // (and once it's there: a navigation that became a download, or went elsewhere, leaves the tab on another page)
  guest.on('did-navigate', (_e, url) => emulate(guest, url));
  // Opening DevTools on the tab ends Bifrost's session with it (the page goes back to the system's scheme,
  // and out of dark mode, while they're open); closing them, it's told again.
  try { guest.debugger.on('detach', () => state.delete(guest)); } catch { /* fine */ }
  guest.on('devtools-closed', () => setTimeout(() => { if (!guest.isDestroyed()) emulate(guest); }, 100));
  guest.once('destroyed', () => state.delete(guest));
}

function init() {
  apply();
  ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('appearance')) apply(); });
}

module.exports = { init, apply, attach, wanted };
