'use strict';
// Where the mouse pointer is, for the auto-hiding top bar and sidebar.
//
// Pointer events in the page can't do this: at the window's top edge Windows does its own hit-testing
// (resizing, the title bar), drag regions swallow mouse events, and over a web page the browser UI hears
// nothing at all. So while a window has an auto-hiding bar, this polls the real pointer position and
// sends it to that window's UI (in its own coordinates), which decides when to slide bars in and out.
const { screen } = require('electron');

const POLL_MS = 33;
const watching = new Map();   // ctl -> { timer, last }

function tick(ctl) {
  const w = watching.get(ctl);
  const win = ctl.win;
  if (!w || !win || win.isDestroyed()) { stop(ctl); return; }
  if (!win.isVisible() || win.isMinimized()) return;
  let p, cb;
  try { p = screen.getCursorScreenPoint(); cb = win.getContentBounds(); } catch { return; }
  const x = p.x - cb.x, y = p.y - cb.y;
  // A few pixels outside count as inside: the resize border around the window, and a maximized window's
  // top edge, which can sit just above the screen.
  const inside = x >= -8 && y >= -8 && x <= cb.width + 8 && y <= cb.height + 8;
  const key = inside ? Math.round(x) + ',' + Math.round(y) : 'out';
  if (key === w.last) return;
  w.last = key;
  ctl.send('pointer', { x, y, inside, w: cb.width, h: cb.height, focused: win.isFocused() });
}

function start(ctl) {
  if (watching.has(ctl)) return;
  const w = { last: '', timer: null };
  watching.set(ctl, w);
  w.timer = setInterval(() => tick(ctl), POLL_MS);
}

function stop(ctl) {
  const w = watching.get(ctl);
  if (!w) return;
  clearInterval(w.timer);
  watching.delete(ctl);
}

// The UI says whether it has an auto-hiding bar.
function set(ctl, on) { if (on) start(ctl); else stop(ctl); }

module.exports = { set, stop };
