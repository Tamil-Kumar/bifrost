'use strict';
// Chrome extension match patterns ("<all_urls>", "*://*.example.com/*", "https://a.com/path*"), used for
// webRequest filters, host permissions and chrome.tabs.query({ url }).

const cache = new Map();

function escape(s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

// Returns a RegExp for a pattern, or null if the pattern is malformed.
function compile(pattern) {
  pattern = String(pattern || '');
  if (cache.has(pattern)) return cache.get(pattern);
  let re = null;
  if (pattern === '<all_urls>') re = /^(https?|wss?|ftp|file|data|urn):/i;
  else {
    const m = /^(\*|https?|wss?|ftp|file|urn|chrome-extension):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
    if (m) {
      const [, scheme, host, rawPath] = m;
      const schemeRe = scheme === '*' ? '(https?|wss?)' : escape(scheme.toLowerCase());
      let hostRe;
      if (host === '*' || (host === '' && /^file$/i.test(scheme))) hostRe = '[^/]*';
      else if (host.startsWith('*.')) hostRe = '([^/]*\\.)?' + escape(host.slice(2).toLowerCase()) + '(:\\d+)?';
      else if (host.includes('*')) hostRe = null;
      else hostRe = escape(host.toLowerCase()) + (/:\d+$/.test(host) ? '' : '(:\\d+)?');
      if (hostRe !== null) {
        const pathRe = (rawPath || '/*').split('*').map(escape).join('.*');
        // The path part matches the path plus query (not the fragment), like Chrome.
        re = new RegExp('^' + schemeRe + ':\\/\\/' + hostRe + pathRe + '$', 'i');
      }
    }
  }
  cache.set(pattern, re);
  return re;
}

// URL without the fragment, which match patterns never see.
function stripHash(url) { const i = String(url).indexOf('#'); return i < 0 ? String(url) : String(url).slice(0, i); }

function matches(pattern, url) {
  const re = compile(pattern);
  return !!(re && re.test(stripHash(url)));
}

function matchesAny(patterns, url) {
  const u = stripHash(url);
  for (const p of patterns || []) { const re = compile(p); if (re && re.test(u)) return true; }
  return false;
}

// Host access an extension asked for in its manifest (MV3 host_permissions, MV2 permissions with URLs).
function hostPatterns(manifest) {
  const m = manifest || {};
  const list = [].concat(m.host_permissions || [], (m.permissions || []).filter((p) => typeof p === 'string' && (p === '<all_urls>' || p.includes('://'))));
  return [...new Set(list)];
}

// chrome.tabs.query({ title }) uses simple glob patterns.
function globMatches(glob, text) {
  const re = new RegExp('^' + String(glob).split('*').map(escape).join('.*') + '$', 'i');
  return re.test(String(text || ''));
}

module.exports = { compile, matches, matchesAny, hostPatterns, globMatches, stripHash };
