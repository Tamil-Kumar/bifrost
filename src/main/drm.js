'use strict';
// Protected content (DRM): Google's Widevine, which Netflix, Disney+, Spotify, Prime Video and the like need.
// Bifrost runs on castlabs' Electron for Content Security (ECS), which fetches Widevine through Chromium's
// component updater and keeps it up to date, as Chrome does: the first start downloads it (a few MB).
// Official Electron builds (and Bifrost run from source on them) have no Widevine; then this does nothing.
const electron = require('electron');

const components = electron.components || null;
const state = { available: !!components, status: components ? 'starting' : 'missing', version: '', error: '' };
let ready = null;

// ComponentsError: { message, errors: [ComponentError { message, detail: status }] }.
function describe(e) {
  const list = e && Array.isArray(e.errors) ? e.errors : [];
  const first = list[0];
  const why = (first && typeof first.message === 'string' && first.message) || (e && e.message) || String(e || 'unknown error');
  return /update check/i.test(why) ? 'it couldn’t be downloaded (is this computer online?)' : why;
}

function refresh() {
  if (!components) return;
  try {
    const all = components.status() || {};
    const s = all[components.WIDEVINE_CDM_ID];
    if (s) {
      state.version = String(s.version || state.version || '');
      if (state.status !== 'error' || state.version) state.status = state.version ? 'ready' : String(s.status || state.status);
    }
  } catch { /* before ready */ }
}

// Starts installing (or checking) Widevine. Call after the app is ready. Offline, it tries again every few
// minutes (protected content then plays in tabs opened, or reloaded, after it's in).
let retries = 0;
function init() {
  if (!components || ready) return;
  state.status = 'installing';
  ready = components.whenReady([components.WIDEVINE_CDM_ID])
    .then(() => { state.error = ''; state.status = 'ready'; refresh(); return true; })
    .catch((e) => {
      state.status = 'error'; state.error = describe(e); refresh();
      console.warn('[drm] Widevine isn’t available: ' + state.error);
      if (retries++ < 12 && process.env.BIFROST_TEST !== '1') setTimeout(() => { ready = null; init(); }, 5 * 60 * 1000).unref();
      return false;
    });
}

// Waits for Widevine at most `ms` (tabs started before it's there can't play protected content until they
// reload; but the window shouldn't wait long for a download on the first start, or offline).
function waitBriefly(ms) {
  if (!ready) return Promise.resolve(false);
  return Promise.race([ready, new Promise((r) => setTimeout(() => r(false), ms))]);
}

function info() { refresh(); return Object.assign({}, state); }

module.exports = { init, waitBriefly, info };
