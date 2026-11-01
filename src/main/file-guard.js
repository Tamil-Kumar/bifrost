'use strict';
// Pages opened from files on this computer (file://) get what Chrome gives them, and no more.
//
// Electron grants local pages more than a browser does (its GrantFileProtocolExtraPrivileges fuse): fetch()
// and XMLHttpRequest of other local files, workers and service workers from files, and one origin for
// every local file, so a page can read any file it frames, draws or styles itself with. Opening a
// downloaded .html file could then read Bifrost's profile (cookies), keys and documents. Bifrost turns
// the fuse off where it can, but the Windows builds signed for Widevine keep Electron's fuses as they are
// (castlabs' signing service refuses a changed binary), so Bifrost holds local pages back itself:
//   - every local HTML/SVG/XML document gets a Content-Security-Policy: no fetch/XHR/beacons to local
//     files (connect-src has no file:), and no workers or service workers from files (worker-src blob:);
//   - frames, images, styles, scripts, fonts and media from local files load only from the page's own
//     site folder: its folder, and the folders above it up to (not including) a "broad" one: a drive,
//     the home folder, a folder directly in it (Documents, Downloads, Desktop…), AppData, the temp
//     folder. A page in AppData (temp files, mail attachments) gets just its own folder. Bifrost's
//     profile, AppData and hidden (dot) folders are never reachable;
//   - window.open from a local page opens a tab, never a pop-up it could reach into (guests.js).
// Pages from the web can't load local files at all (Chromium), and Bifrost's own pages and extensions
// aren't affected.
const nodePath = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');

const CSP = 'connect-src http: https: ws: wss: data: blob:; worker-src blob:';
const SCRIPTABLE = /^\s*(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i;
// Requests a local page may never make to local files (fetch/XHR, beacons, reports, sockets).
const NEVER = new Set(['xhr', 'ping', 'cspReport', 'webSocket']);

// The path logic, for one platform (tests use path.win32 on any OS).
function makeRules({ path = nodePath, home = os.homedir(), temp = os.tmpdir(), profile = '', windows = path === nodePath.win32 || (path === nodePath && process.platform === 'win32') } = {}) {
  const norm = (p) => {
    let x = path.resolve(String(p));
    if (x.length > path.parse(x).root.length) x = x.replace(/[\\/]+$/, '');
    return windows ? x.toLowerCase() : x;
  };
  const parent = (p) => { const d = path.dirname(p); return d === p ? null : d; };
  const base = (p) => path.basename(p).toLowerCase();
  const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
  const H = home ? norm(home) : null;
  const T = temp ? norm(temp) : null;
  const P = profile ? norm(profile) : null;
  const inAppData = (p) => p.split(path.sep).some((s) => s.toLowerCase() === 'appdata');

  function broad(p) {
    const up = parent(p);
    if (!up) return true;                                   // a drive or the filesystem's root
    if (H && (p === H || up === H || p === parent(H))) return true;
    if (H && parent(up) === H && /^onedrive/.test(base(up))) return true;   // OneDrive\Documents and the like
    if (T && p === T) return true;
    if (base(p) === 'appdata' || base(up) === 'appdata') return true;
    if (!windows) {
      // Removable drives and mounts: /media/<user>/<drive>, /run/media/<user>/<drive>, /mnt/<drive>.
      const segs = p.split('/').filter(Boolean);
      if ((segs[0] === 'media' && segs.length <= 3) || (segs[0] === 'run' && segs[1] === 'media' && segs.length <= 4) || (segs[0] === 'mnt' && segs.length <= 2)) return true;
    }
    return false;
  }

  // The site folder of a page in folder `dir`.
  function siteRoot(dir) {
    let d = norm(dir);
    if (broad(d) || inAppData(d)) return d;
    for (;;) {
      const up = parent(d);
      if (!up || broad(up)) return d;
      d = up;
    }
  }

  // May a page from file `pageFile` load file `target` (as a frame, image, style, script, font, media)?
  function allowed(pageFile, target) {
    const t = norm(target);
    if (P && within(t, P)) return false;
    const root = siteRoot(path.dirname(norm(pageFile)));
    if (!within(t, root)) return false;
    const rel = t === root ? [] : t.slice(root.length).split(/[\\/]+/).filter(Boolean);
    return !rel.some((s) => s.startsWith('.') || s.toLowerCase() === 'appdata');
  }

  return { siteRoot, allowed, broad };
}

let rules = null;
const getRules = () => {
  if (!rules) {
    let profile = '';
    try { profile = require('electron').app.getPath('userData'); } catch { /* not in Electron */ }
    rules = makeRules({ profile });
  }
  return rules;
};

const toPath = (url) => fileURLToPath(url);

// The address of the page (the tab's top document) a request comes from.
function pageOf(d) {
  try { const top = d.frame && d.frame.top; if (top && top.url) return top.url; } catch { /* frame gone */ }
  try {
    const { webContents } = require('electron');
    const wc = d.webContentsId != null ? webContents.fromId(d.webContentsId) : null;
    if (wc && !wc.isDestroyed()) return wc.getURL();
  } catch { /* none */ }
  return '';
}

// webRequest onBeforeRequest for a file:// URL: null to let it load, { cancel: true } to stop it.
function check(d) {
  if (d.resourceType === 'mainFrame') return null;          // opening a file in a tab
  const page = pageOf(d);
  if (!/^file:/i.test(page)) return null;                   // not asked for by a local page
  if (NEVER.has(d.resourceType)) return { cancel: true };
  try { return getRules().allowed(toPath(page), toPath(d.url)) ? null : { cancel: true }; } catch { return { cancel: true }; }
}

// webRequest onHeadersReceived for a file:// URL: the response headers to use instead, or null.
function headers(d) {
  if (!['mainFrame', 'subFrame', 'object'].includes(d.resourceType)) return null;
  const h = Object.assign({}, d.responseHeaders || {});
  const typeKey = Object.keys(h).find((k) => k.toLowerCase() === 'content-type');
  const type = typeKey ? [].concat(h[typeKey]).join(',') : '';
  if (!SCRIPTABLE.test(type)) return null;
  // (alongside any policy of its own: both apply)
  const cspKey = Object.keys(h).find((k) => k.toLowerCase() === 'content-security-policy');
  const own = cspKey ? [].concat(h[cspKey]) : [];
  if (cspKey) delete h[cspKey];
  h['Content-Security-Policy'] = own.concat(CSP);
  return h;
}

module.exports = { makeRules, check, headers, CSP };
