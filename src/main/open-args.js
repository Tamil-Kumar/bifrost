'use strict';
// What Bifrost is asked to open: the addresses and files on the command line it starts with (a link from
// another app, a file opened with Bifrost from Explorer or a file manager), what a later start hands the
// running one, and files dropped on its window. Files open as file:// addresses; only files that are there do.
//
// Windows starts Bifrost for a file or a link with  "Bifrost.exe" --single-argument <it>  (what
// default-browser.js and the installer register, as Chrome does): everything after --single-argument is the
// one thing to open, spaces and all (Windows doesn't put a file's name in quotes). Chromium reads a command
// line so, and a later start's arguments reach the running Bifrost that way ([Bifrost.exe, the file]); but
// process.argv is the command line cut at every space (['--single-argument', 'C:\Users\Sam', 'Lee\notes.pdf']),
// so the pieces are put back together. A later start also works out what it was asked to open itself and
// sends that along (requestSingleInstanceLock's data: index.js), so either way gets there.
const fs = require('node:fs');
const nodePath = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEMES = /^(https?|ftp|file|bifrost):/i;
const MAX = 50;            // things to open at once
const LONGEST = 32768;     // characters in an address or a path

const isFileAt = (fsx, p) => { try { return fsx.statSync(p).isFile(); } catch { return false; } };
const unquote = (s) => {
  const t = String(s).trim();
  return t.length > 1 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1).trim() : t;
};
const options = (o = {}) => {
  const win = o.win != null ? !!o.win : process.platform === 'win32';
  return { win, path: win ? nodePath.win32 : nodePath.posix, cwd: o.cwd || process.cwd(), fsx: o.fs || fs };
};

// One thing to open → its address ('' when it's neither an address Bifrost opens nor a file that's there).
function toUrl(arg, o) {
  const { win, path, cwd, fsx } = o;
  const a = unquote(arg);
  if (!a || a.length > LONGEST) return '';
  if (SCHEMES.test(a)) return a;
  let p;
  try { p = path.resolve(cwd, a); } catch { return ''; }
  return isFileAt(fsx, p) ? pathToFileURL(p, { windows: win }).href : '';
}

// (the same file twice, in another case on Windows: once)
function unique(urls, win) {
  const seen = new Set();
  return urls.filter((u) => {
    const k = win && /^file:/i.test(u) ? u.toLowerCase() : u;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX);
}

// A command line's arguments (argv[0] is the program) → the addresses to open. Switches aren't; nor is a
// folder (a development copy's argv has Bifrost's own: electron <folder>).
// opts: { cwd (where relative paths are from: a later start's own folder), win, fs }
function fromArgv(argv, opts) {
  const o = options(opts);
  const args = (Array.isArray(argv) ? argv : []).slice(1).map(String);
  const single = args.findIndex((a) => a.toLowerCase() === '--single-argument');
  const items = single >= 0 ? [args.slice(single + 1).join(' ')] : args.filter((a) => !a.startsWith('-'));
  const urls = items.map((a) => toUrl(a, o)).filter(Boolean);
  // (a file's path without quotes in a command of another program's making, cut at its spaces: whole again)
  if (!urls.length && items.length > 1) { const whole = toUrl(items.join(' '), o); if (whole) urls.push(whole); }
  return unique(urls, o.win);
}

// What a later start sent along ({ open: [addresses] }): addresses Bifrost opens, nothing else.
function fromData(data, opts) {
  const o = options(opts);
  const list = data && Array.isArray(data.open) ? data.open : [];
  return unique(list.filter((u) => typeof u === 'string' && u.length <= LONGEST && SCHEMES.test(u)), o.win);
}

// Files dropped on the window (their full paths) → their addresses.
function fromPaths(paths, opts) {
  const o = options(opts);
  const list = Array.isArray(paths) ? paths.slice(0, MAX) : [];
  return unique(list.filter((p) => typeof p === 'string' && p.length <= LONGEST && o.path.isAbsolute(p)).map((p) => toUrl(p, o)).filter(Boolean), o.win);
}

// Both of a later start's (its arguments as the running Bifrost got them, and what it sent along), once each.
function merge(a, b, opts) { return unique([...(a || []), ...(b || [])], options(opts).win); }

// What a start was asked to open and made of it, a line each, to the file BIFROST_OPEN_LOG names when it's set
// (tools/open-check.mjs: Windows' own way of handing over a file, looked at on Windows).
function note(what) {
  const file = process.env.BIFROST_OPEN_LOG;
  if (file) { try { fs.appendFileSync(file, JSON.stringify(what) + '\n'); } catch { /* not there: never mind */ } }
}

module.exports = { fromArgv, fromData, fromPaths, merge, note, toUrl: (arg, opts) => toUrl(arg, options(opts)) };
