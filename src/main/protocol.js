'use strict';
// bifrost:// serves the browser UI and internal pages from the app folder.
//   bifrost://ui/browser.html           -> src/ui/browser.html
//   bifrost://settings/                 -> src/pages/settings/index.html
//   bifrost://<any>/_/shared/x.js       -> src/shared/x.js  (shared files, same-origin for every page)
//   bifrost://<any>/_/common/x.css      -> src/pages/common/x.css
//   bifrost://<any>/_/assets/x.svg      -> assets/x.svg
//   bifrost://wallpaper/                -> the new tab background image chosen in settings
//   bifrost://<any>/_/favicon?url=…     -> a site's large icon (icons.js), same-origin for every page
const { protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const SCHEME = 'bifrost';
const ROOT = path.join(__dirname, '..');           // src/
const ASSETS = path.join(ROOT, '..', 'assets');
const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'extensions', 'about', 'reader', 'tasks', 'welcome', 'blank']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.avif': 'image/avif',
};

const CSP_PAGE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http: bifrost: crx: file:; media-src 'self' https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' bifrost://ui";
const CSP_UI = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http: bifrost: crx: file:; media-src 'self' https: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";

let getWallpaper = () => '';

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true, codeCache: true } },
    // The ad blocker's stand-ins for blocked scripts and files (adblock.js): what a filter's "redirect" loads
    // instead. Like uBlock Origin's own, they load on any page whatever its Content Security Policy.
    { scheme: require('./adblock').RES_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
  ]);
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function resolveFile(host, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname || '/'); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel.startsWith('/_/')) {
    const sub = rel.slice(3);
    if (sub.startsWith('shared/')) return safeJoin(path.join(ROOT, 'shared'), sub.slice(7));
    if (sub.startsWith('common/')) return safeJoin(path.join(ROOT, 'pages', 'common'), sub.slice(7));
    if (sub.startsWith('assets/')) return safeJoin(ASSETS, sub.slice(7));
    if (sub.startsWith('readability/')) return safeJoin(path.join(ROOT, 'vendor', 'readability'), sub.slice(12));
    return null;
  }
  if (host === 'ui') {
    if (rel === '/' || rel === '') rel = '/browser.html';
    return safeJoin(path.join(ROOT, 'ui'), rel);
  }
  if (PAGES.has(host)) {
    if (rel === '/' || rel === '') rel = '/index.html';
    return safeJoin(path.join(ROOT, 'pages', host), rel);
  }
  return null;
}

async function handle(request) {
  let url;
  try { url = new URL(request.url); } catch { return new Response('Bad request', { status: 400 }); }
  const host = url.hostname;

  if (host === 'wallpaper') {
    const p = getWallpaper();
    if (!p) return new Response('', { status: 404 });
    if (/^https?:/i.test(p)) return net.fetch(p);
    if (!fs.existsSync(p)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  }

  if (url.pathname === '/_/favicon') return require('./icons').serve(request.url);

  const file = resolveFile(host, url.pathname);
  if (!file) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  let body;
  try { body = await fs.promises.readFile(file); } catch { return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }); }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  };
  if (ext === '.html') headers['content-security-policy'] = host === 'ui' ? CSP_UI : CSP_PAGE;
  return new Response(body, { status: 200, headers });
}

// Registers the handler on a session (the UI's session and every browsing session).
const handled = new WeakSet();
function attach(ses) {
  if (handled.has(ses)) return;
  handled.add(ses);
  ses.protocol.handle(SCHEME, handle);
}

function setWallpaperGetter(fn) { getWallpaper = fn; }

function isInternal(url) { return typeof url === 'string' && /^\s*bifrost:/i.test(url); }
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

module.exports = { SCHEME, registerSchemes, attach, isInternal, hostOf, setWallpaperGetter, PAGES };
