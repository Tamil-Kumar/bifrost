'use strict';
// User agents: present as plain Chrome (sites degrade or block "Electron"), with per-site overrides.
const ctx = require('./context');

function platformToken() {
  if (process.platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (process.platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  return 'X11; Linux x86_64';
}

function chromeMajor() { return String(process.versions.chrome || '152').split('.')[0]; }

function chrome() {
  return `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor()}.0.0.0 Safari/537.36`;
}

function firefox() {
  // Firefox ships every four weeks; estimate the current release from the date so the UA stays plausible.
  const months = (new Date().getFullYear() - 2025) * 12 + new Date().getMonth() - 5;
  const v = Math.max(140, 140 + Math.floor(months * 30 / 28));
  const plat = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}

function safari() {
  return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
}

// What Bifrost really is: Chromium inside Electron, without the app's own name. Google's sign-in treats a
// browser that says it's Chrome as Chrome and runs checks only Google Chrome passes, and it turns Firefox
// look-alikes away too; an embedded Chromium that says so gets a sign-in it accepts.
function embedded() {
  return `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Electron/${process.versions.electron} Safari/537.36`;
}

function defaultUA() {
  const a = ctx.settings.get('advanced');
  if (a.userAgentMode === 'custom' && a.customUserAgent.trim()) return a.customUserAgent.trim();
  if (a.userAgentMode === 'electron') return require('electron').app.userAgentFallback;
  return chrome();
}

function resolveName(name) {
  if (name === 'firefox') return firefox();
  if (name === 'chrome') return chrome();
  if (name === 'safari') return safari();
  if (name === 'embedded') return embedded();
  return String(name || '').trim() || null;
}

function forHost(host) {
  const rules = ctx.settings.get('advanced.siteUserAgents') || [];
  for (const r of rules) {
    const h = String(r.host || '').toLowerCase().replace(/^\*\./, '');
    if (h && (host === h || host.endsWith('.' + h))) return resolveName(r.ua);
  }
  return null;
}

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

// Called when a tab starts a top-level navigation: navigator.userAgent follows the site's rule.
function applyForUrl(wc, url) {
  if (!/^https?:/i.test(url)) return;
  const want = forHost(hostOf(url)) || defaultUA();
  if (wc.getUserAgent() !== want) wc.setUserAgent(want);
}

// The user agent a page on this address should have: its site's rule, or the default.
function forUrl(url) {
  if (!/^https?:/i.test(url)) return null;
  return forHost(hostOf(url)) || defaultUA();
}

const noHints = (ua) => /Firefox\/|Version\/[\d.]+ (Mobile\/\S+ )?Safari/.test(ua);

// Request headers. A tab's user agent changes when it navigates to a site with its own rule, but only from
// the next page on, so requests get their page's user agent here, and the tab preload sets the page's
// navigator.userAgent to match (see 'tab:ua' in guests.js). Firefox and Safari don't send client hints; Electron's brand never goes out.
function headerHook(details, headers) {
  // The page request uses its own address; everything a page loads (its images, scripts, frames) follows
  // the page at the top of the tab, which is what navigator.userAgent reports there.
  let pageUrl = details.resourceType === 'mainFrame' ? details.url : '';
  if (!pageUrl) { try { const top = details.frame && details.frame.top; pageUrl = (top && top.url) || ''; } catch { /* frame gone */ } }
  const want = pageUrl ? forUrl(pageUrl) : null;
  if (want) headers['User-Agent'] = want;
  const sent = headers['User-Agent'] || '';
  if (noHints(sent)) { for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k)) delete headers[k]; return; }
  for (const k of Object.keys(headers)) {
    if (/^sec-ch-ua$/i.test(k) && /Electron/i.test(headers[k]) && !/Electron\//.test(sent)) {
      const v = chromeMajor();
      headers[k] = `"Chromium";v="${v}", "Not_A Brand";v="24"`;
    }
  }
}

module.exports = { chrome, firefox, safari, embedded, defaultUA, applyForUrl, headerHook, forHost, forUrl, noHints };
