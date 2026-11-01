// Bifrost browser UI — two-finger swipes on a touchpad go back and forward (settings: gestures).
//
// A tab tells us (preload/tab.js, through the main process) when a sideways swipe starts that its page has
// no use for, and every step the fingers take. An arrow comes in from that side of the page as you swipe;
// once it's all the way in (gestures.swipeDistance) it lights up. Nothing happens until the fingers leave the
// touchpad: the main process hears that from Chromium itself ('release', see main/guests.js), and only then,
// if the arrow is still lit, does the tab go back or forward. Swiping back the other way before letting go
// cancels it; resting the fingers keeps it waiting. Nothing shows when there's nowhere to go that way.
import { on, setting, tabByWc, activeTab } from './state.js';
import { h, anim, dur } from './util.js';
import { icon } from './icons.js';
import * as V from './views.js';

const wb = window.wb;
const SIZE = 52;      // the arrow's disc, px
const INSET = 14;     // how far in from the page's edge it ends up
const SETTLE = 600;   // ms after going back or forward when a new swipe in that tab is leftover coasting
const STALE = 6000;   // a swipe that never hears back is dropped after this long without news
let cur = null;       // the swipe in progress: { tab, side, go, amount, armed, el, clip, distance }, or { tab, ignore }
let staleT = null;
const quietUntil = new Map();   // tab id -> time
let last = null;      // the last swipe that went somewhere (for tests): { go }

function cfg() {
  const g = setting('gestures') || {};
  return { on: g.swipe !== false, distance: Math.max(30, Math.min(600, Number(g.swipeDistance) || 120)), reverse: !!g.swipeReverse };
}

function touch() {
  clearTimeout(staleT);
  staleT = setTimeout(() => { if (cur) { const c = cur; cur = null; if (c.el) leave(c, false); } }, STALE);
}

function start(tab, dir) {
  if (cur && cur.tab === tab) { touch(); return; }   // the same swipe going on
  drop();
  const c = cfg();
  if (!c.on || !dir) return;
  const side = dir < 0 ? 'left' : 'right';
  const go = (dir < 0) !== c.reverse ? 'back' : 'forward';
  const can = go === 'back' ? tab.canGoBack : tab.canGoForward;
  touch();
  if (!can || !tab.pane || Date.now() < (quietUntil.get(tab.id) || 0)) { cur = { tab, ignore: true }; return; }
  const el = h('div.swipe-arrow.' + side, { dataset: { go } }, h('div.swipe-disc', null, icon(go)));
  const clip = h('div.swipe-clip', null, el);
  tab.pane.body.appendChild(clip);
  cur = { tab, side, go, amount: 0, armed: false, el, clip, distance: c.distance };
  draw(cur);
}

function move(tab, steps) {
  if (!cur || cur.tab !== tab || cur.ignore) return;
  touch();
  // Fingers going the swipe's way add to it; going back takes away.
  for (const dx of steps) cur.amount = Math.max(0, cur.amount + (cur.side === 'left' ? -dx : dx));
  draw(cur);
}

function draw(c) {
  const { el, amount, distance, side } = c;
  const p = Math.min(1, amount / distance);
  // From just outside the page to INSET px inside it, with a little give past the end.
  const x = -SIZE + p * (SIZE + INSET) + Math.min(24, Math.max(0, amount - distance) * 0.1);
  el.style.transform = `translateX(${side === 'left' ? x : -x}px)`;
  el.style.opacity = String(Math.min(1, p * 1.5));
  c.armed = amount >= distance;
  el.classList.toggle('armed', c.armed);
}

// The fingers left the touchpad: go if the arrow is lit.
function release(tab) {
  if (!cur || cur.tab !== tab) return;
  const c = cur;
  cur = null;
  clearTimeout(staleT);
  if (c.ignore) return;
  if (c.armed) {
    last = { go: c.go };
    if (c.go === 'back') V.goBack(c.tab); else V.goForward(c.tab);
    quietUntil.set(c.tab.id, Date.now() + SETTLE);
  }
  leave(c, c.armed);
}

// The page gave up on the swipe (it went away, or never heard the fingers lift): nothing happens.
function end(tab) {
  if (!cur || cur.tab !== tab) return;
  const c = cur;
  cur = null;
  clearTimeout(staleT);
  if (c.el) leave(c, false);
}

// The arrow goes: on with a little pulse if it went, back out the way it came if not.
function leave(c, went) {
  const { el, clip, side } = c;
  el.classList.add('leaving');
  if (!anim('swipe')) { clip.remove(); return; }
  const from = el.style.transform;
  const out = `translateX(${side === 'left' ? -SIZE : SIZE}px)`;
  const frames = went
    ? [{ transform: from + ' scale(1)', opacity: 1 }, { transform: from + ' scale(1.18)', opacity: 0 }]
    : [{ transform: from, opacity: el.style.opacity || 1 }, { transform: out, opacity: 0 }];
  el.style.opacity = '0';
  // (Straight from where the fingers left it, so not through animate(), which scales how far things move.)
  try { el.animate(frames, { duration: dur(went ? 260 : 200), easing: 'cubic-bezier(.2,.7,.3,1)' }).finished.then(() => clip.remove(), () => clip.remove()); } catch { clip.remove(); }
}

function drop() {
  if (cur && cur.clip) cur.clip.remove();
  cur = null;
  clearTimeout(staleT);
}

export function init() {
  wb.on('swipe', ({ wcId, phase, dir, steps } = {}) => {
    const tab = tabByWc(wcId);
    if (!tab) return;
    if (phase === 'start') start(tab, dir);
    else if (phase === 'move') move(tab, Array.isArray(steps) ? steps : []);
    else if (phase === 'release') release(tab);
    else if (phase === 'end') end(tab);
  });
  // Another tab was picked, or this one closed, mid-swipe: no arrow left hanging.
  on('active', () => { if (cur && cur.tab !== activeTab()) drop(); });
  on('tab-closing', (t) => { if (cur && cur.tab === t) drop(); });
}

// For tests: the swipe in progress, and the last one that went somewhere.
export const _last = () => last;
export const _state = () => (cur ? { go: cur.go || null, amount: cur.amount || 0, armed: !!cur.armed, ignore: !!cur.ignore } : null);
