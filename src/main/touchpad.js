'use strict';
// How many fingers are on the touchpad. Windows' precision touchpads tell programs that read them directly
// (assets/bin/touchpad-<arch>.exe, from tools/win/touchpad.c), and that's what lets a two-finger swipe go back
// or forward the moment the fingers lift (guests.js): nothing Chromium passes on can tell, since after a quick
// swipe the touchpad's scroll goes straight on into coasting, and its wheel steps look the same either way.
// Elsewhere (or with another kind of touchpad, or before it has said anything) nobody knows: fingers is null.
const path = require('node:path');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

const DEBOUNCE = 40;   // ms fewer than two fingers must last to count as lifting (one odd report doesn't)
const pad = new EventEmitter();
pad.fingers = null;    // on the touchpad now (null: nobody knows)
pad.lifting = false;   // fewer than two since a moment ago: lifting, if it lasts
pad.liftedAt = 0;      // when two or more last became fewer
pad.touchpads = null;  // precision touchpads it can read
let child = null, liftT = null, restarts = 0, wanted = false;

function set(n) {
  const was = pad.fingers;
  pad.fingers = n;
  if (n === null) {
    clearTimeout(liftT); liftT = null; pad.lifting = false;
    // (it stopped: whoever was waiting for it to say the fingers lifted can't any more)
    if (was !== null) pad.emit('unknown');
    return;
  }
  if (n >= 2) {
    clearTimeout(liftT); liftT = null; pad.lifting = false;
    if (!(was >= 2)) pad.emit('down');
    return;
  }
  if (was >= 2 && !liftT) {
    pad.lifting = true;
    liftT = setTimeout(() => {
      liftT = null;
      pad.lifting = false;
      if (pad.fingers !== null && pad.fingers < 2) { pad.liftedAt = Date.now(); pad.emit('lift'); }
    }, DEBOUNCE);
  }
}

function exe() {
  // (tests: a stand-in that says what they tell it to)
  if (process.env.BIFROST_TEST === '1' && process.env.BIFROST_TOUCHPAD) return process.env.BIFROST_TOUCHPAD;
  if (process.platform !== 'win32') return null;
  const { app } = require('electron');
  return path.join(app.getAppPath(), 'assets', 'bin', `touchpad-${process.arch === 'arm64' ? 'arm64' : 'x64'}.exe`);
}

function start() {
  wanted = true;
  const file = exe();
  if (!file || child) return;
  let proc;
  try {
    proc = /\.m?js$/.test(file)
      ? spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      : spawn(file, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  } catch { return; }
  child = proc;
  let rest = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    rest += d;
    for (let i; (i = rest.indexOf('\n')) >= 0;) {
      const [what, n] = rest.slice(0, i).trim().split(' ');
      rest = rest.slice(i + 1);
      if (what === 'fingers' && /^\d+$/.test(n)) set(Number(n));
      else if (what === 'touchpads') pad.touchpads = Number(n);
    }
  });
  proc.on('error', () => {});
  proc.stdin.on('error', () => {});
  proc.on('exit', () => {
    if (child !== proc) return;
    child = null;
    set(null);
    // (it went away by itself: again, a few times)
    if (wanted && restarts++ < 3) setTimeout(() => { if (wanted) start(); }, 2000 * restarts);
  });
}

function stop() {
  wanted = false;
  const proc = child;
  child = null;
  set(null);
  if (proc) { try { proc.stdin.end(); } catch { /* gone */ } try { proc.kill(); } catch { /* gone */ } }
}

// Swiping on or off (Settings → Keyboard & touchpad): it runs only while swipes go somewhere.
function init(ctx) {
  const apply = () => { if (ctx.settings.get('gestures.swipe') === false) stop(); else start(); };
  apply();
  ctx.settings.on('changed', ({ path: p }) => { if (!p || p.startsWith('gestures')) apply(); });
  require('electron').app.on('will-quit', stop);
  if (process.env.BIFROST_TEST === '1') {
    global.__touchpad = (n) => set(n === null ? null : Number(n));
    global.__touchpadState = () => ({ fingers: pad.fingers, touchpads: pad.touchpads, running: !!child });
  }
}

pad.init = init;
pad.set = set;
module.exports = pad;
