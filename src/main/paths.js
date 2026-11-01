'use strict';
// Where the profile lives. Must run before app 'ready'.
//   --profile=<dir>                   explicit profile folder (tests, multiple profiles)
//   "portable.ini" (or "portable") next to the exe
//                                     -> <DataDir>/profile, where DataDir comes from portable.ini
//                                        ("DataDir=..\..\Data", relative to the exe) or defaults to
//                                        <exe folder>/Data. One Data folder can then be shared by the x64
//                                        and ARM64 builds of a portable install.
//   otherwise                         -> %APPDATA%/Bifrost (Windows) or ~/.config/Bifrost (Linux)
// Bifrost used to be called Waypoint: a Waypoint profile is picked up the first time Bifrost starts.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_NAME = 'Bifrost';
const OLD_NAME = 'Waypoint';

function exeDir() {
  return path.dirname(app.getPath('exe'));
}

// portable.ini: simple "key=value" lines; # and ; start comments.
function readPortableIni(dir) {
  const out = {};
  try {
    const text = fs.readFileSync(path.join(dir, 'portable.ini'), 'utf8').replace(/^﻿/, '');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z][\w.]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !/^[#;]/.test(line.trim())) out[m[1].toLowerCase()] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch { /* no ini, or unreadable: defaults */ }
  return out;
}

function resolveProfile(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith('--profile='));
  if (flag) return { dir: path.resolve(flag.slice('--profile='.length)), portable: false, mode: 'flag' };
  const dir = exeDir();
  const marked = ['portable', 'portable.txt', 'portable.ini'].some((f) => fs.existsSync(path.join(dir, f)));
  if (marked) {
    const ini = readPortableIni(dir);
    const dataDir = ini.datadir ? path.resolve(dir, ini.datadir.replace(/[\\/]+/g, path.sep)) : path.join(dir, 'Data');
    return { dir: path.join(dataDir, 'profile'), dataDir, portable: true, mode: 'portable' };
  }
  return { dir: path.join(app.getPath('appData'), APP_NAME), portable: false, mode: 'installed' };
}

// Moves a folder, falling back to copying it (Windows refuses to move folders with files in use).
function moveOrCopy(from, to) {
  try { fs.renameSync(from, to); return true; } catch { /* in use, or on another drive */ }
  try { fs.cpSync(from, to, { recursive: true, errorOnExist: false }); return true; } catch { return false; }
}

// Waypoint -> Bifrost: the per-user profile folder, and the database file inside any profile.
function migrate(cur) {
  if (cur.mode === 'installed' && !fs.existsSync(cur.dir)) {
    const old = path.join(app.getPath('appData'), OLD_NAME);
    if (fs.existsSync(path.join(old, 'waypoint.sqlite'))) moveOrCopy(old, cur.dir);
  }
  const oldDb = path.join(cur.dir, 'waypoint.sqlite');
  const newDb = path.join(cur.dir, 'bifrost.sqlite');
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(oldDb + ext)) { try { fs.renameSync(oldDb + ext, newDb + ext); } catch { /* left as it was */ } }
    }
  }
}

let current = null;

function setup() {
  app.setName(APP_NAME);
  current = resolveProfile();
  try { migrate(current); } catch (e) { console.warn('[paths] could not bring over the Waypoint profile: ' + e.message); }
  fs.mkdirSync(current.dir, { recursive: true });
  app.setPath('userData', current.dir);
  app.setPath('sessionData', current.dir);
  app.setPath('crashDumps', path.join(current.dir, 'Crashpad'));
  app.setPath('logs', path.join(current.dir, 'logs'));
  if (current.portable) {
    // Keep Chromium's temp files inside the portable folder too.
    const temp = path.join(current.dataDir, 'Temp');
    fs.mkdirSync(temp, { recursive: true });
    app.setPath('temp', temp);
  }
  return current;
}

function profile() {
  return current;
}

function file(...parts) {
  return path.join(current.dir, ...parts);
}

module.exports = { APP_NAME, setup, profile, file, exeDir, resolveProfile, readPortableIni };
