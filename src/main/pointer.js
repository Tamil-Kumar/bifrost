'use strict';
// After a page goes full screen (a video's full screen button), Chromium is made to look at what's under the
// pointer again, as moving the mouse would.
//
// Chromium shows the pointer of the page it last routed the mouse to, and works out where the mouse is from the
// last time it moved. Going full screen moves everything under a still mouse: the window grows, Bifrost's bars
// go, the page shifts, then the video fills it. On Windows, Chromium could be left thinking the mouse was over
// something it no longer was, so when YouTube's controls went and it asked for no pointer, the arrow stayed
// until the mouse moved; after that it hid as it should.
//
// A small view put under the pointer for a moment and taken away does it: Chromium moves the mouse where it is
// whenever a window appears or goes under it (Aura's synthesized mouse move), which finds the page under it
// afresh and tells that page where the mouse is. The page sees a mouse move, as when you nudge the mouse
// (YouTube shows its controls, then hides them and the pointer a few seconds later). Nothing shows: the view is
// see-through, a few pixels under the pointer, for 60 ms.
const { screen, WebContentsView } = require('electron');

const SETTLE_MS = 600;   // after the page goes full screen: the window's grown, the page laid out again
const pending = new WeakMap();   // BrowserWindow -> timer

function repoint(win) {
  // (tests: off, to see what happens without it)
  if (process.env.BIFROST_TEST === '1' && process.env.BIFROST_REPOINT === '0') return false;
  if (!win || win.isDestroyed() || !win.isVisible()) return false;
  let p, cb;
  try { p = screen.getCursorScreenPoint(); cb = win.getContentBounds(); } catch { return false; }
  const x = Math.round(p.x - cb.x), y = Math.round(p.y - cb.y);
  // (the mouse elsewhere: nothing to look at)
  if (x < 0 || y < 0 || x >= cb.width || y >= cb.height) return false;
  let v;
  try {
    v = new WebContentsView();
    v.setBackgroundColor('#00000000');
    v.setBounds({ x: Math.max(0, x - 4), y: Math.max(0, y - 4), width: 8, height: 8 });
    win.contentView.addChildView(v);
  } catch { return false; }
  setTimeout(() => {
    try { if (!win.isDestroyed()) win.contentView.removeChildView(v); } catch { /* window gone */ }
    try { v.webContents.close(); } catch { /* gone */ }
  }, 60);
  return true;
}

// A page in the window went full screen.
function afterFullscreen(win) {
  clearTimeout(pending.get(win));
  pending.set(win, setTimeout(() => {
    pending.delete(win);
    // (only while it's still full screen)
    if (!win.isDestroyed() && win.isFullScreen()) repoint(win);
  }, SETTLE_MS));
}

module.exports = { afterFullscreen, repoint };
