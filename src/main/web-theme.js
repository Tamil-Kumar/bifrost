'use strict';
// Whether websites see a light or a dark preference (prefers-color-scheme), and what color Chromium draws
// their form controls and scrollbars in: appearance.webTheme.
//   system   as the computer is set (the default)
//   browser  like Bifrost's theme: a dark theme gets dark websites (with "Match the system", that's the system)
//   light / dark
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

// What each tab is told itself. Always, when a scheme is wanted: Chromium's own setting (nativeTheme, see
// apply) doesn't reach web pages everywhere (on Linux it doesn't change prefers-color-scheme at all), and
// pages left on the system's scheme come out light in a dark browser.
function perTab() {
  return wanted();
}

const isOwnPage = (url) => /^(bifrost|chrome-extension|devtools|chrome):/i.test(String(url || ''));
const state = new WeakMap();   // webContents -> the scheme it's emulating ('dark' | 'light' | null)

async function emulate(wc, scheme, url) {
  if (!wc || wc.isDestroyed()) return;
  if (isOwnPage(url == null ? wc.getURL() : url)) scheme = null;
  const was = state.get(wc) || null;
  if (was === scheme) return;
  state.set(wc, scheme);
  const dbg = wc.debugger;
  try {
    if (scheme) {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    } else if (dbg.isAttached() && was) {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
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
  const each = perTab();
  for (const wc of tabs()) emulate(wc, each);
}

// Every tab: told from its first page on, and again whenever it moves between Bifrost's pages and the web.
function attach(guest) {
  const scheme = perTab();
  if (scheme) emulate(guest, scheme);
  guest.on('did-start-navigation', (details) => {
    if (!details || !details.isMainFrame || details.isSameDocument) return;
    const want = perTab();
    if (want || state.get(guest)) emulate(guest, want, details.url);
  });
  // Opening DevTools on the tab ends Bifrost's session with it (the page goes back to the system's scheme
  // while they're open); closing them, it's told again.
  try { guest.debugger.on('detach', () => state.delete(guest)); } catch { /* fine */ }
  guest.on('devtools-closed', () => setTimeout(() => { if (!guest.isDestroyed()) emulate(guest, perTab()); }, 100));
  guest.once('destroyed', () => state.delete(guest));
}

function init() {
  apply();
  ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('appearance')) apply(); });
}

module.exports = { init, apply, attach, wanted };
