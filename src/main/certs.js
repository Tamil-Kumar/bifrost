'use strict';
// Certificate errors. Pages with a certificate that isn't valid are refused, and their error page says
// why. You can still open one you trust (your own server, a router or NAS on your network): its error page
// → Details → Continue. That host and that exact certificate are then accepted until Bifrost quits, like
// in Chrome. (Sites that require HTTPS strictly, HSTS, never get here: Chromium refuses those outright.)
const { app } = require('electron');

const allowed = new Set();   // "host|fingerprint"
const lastSeen = new Map();  // host -> fingerprint of the certificate it last failed with

function hostOf(url) { try { return new URL(url).host; } catch { return ''; } }

function init() {
  app.on('certificate-error', (event, wc, url, error, certificate, callback) => {
    const host = hostOf(url);
    const fp = certificate && certificate.fingerprint;
    if (host && fp) lastSeen.set(host, fp);
    if (host && fp && allowed.has(host + '|' + fp)) { event.preventDefault(); callback(true); return; }
    callback(false);
  });
}

// From the error page: accept the certificate this host just failed with.
function allow(url) {
  const host = hostOf(url);
  const fp = lastSeen.get(host);
  if (!host || !fp) return false;
  allowed.add(host + '|' + fp);
  return true;
}

module.exports = { init, allow };
