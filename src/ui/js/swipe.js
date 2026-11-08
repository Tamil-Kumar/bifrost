// Bifrost browser UI — two-finger swipes on a touchpad go back and forward (settings: gestures).
//
// A tab tells us (preload/tab.js, through the main process) when a sideways swipe starts that its page has
// no use for, and every step the fingers take. An arrow comes in from that side of the page as you swipe;
// once it's all the way in (gestures.swipeDistance) it lights up. Swiping back the other way takes it out again,
// and on past where you started brings the other one in from the other side, as in Chrome. Nothing happens
// until the fingers leave the touchpad: then, if the arrow is lit, the tab goes back or forward. Windows'
// precision touchpads say when they lift ('lift', main/touchpad.js and main/guests.js), and it goes at once (if
// the arrow isn't quite lit, the coasting after a quick flick has a moment to light it, though never to bring
// in the other one); otherwise it's the end of the whole scroll gesture that says ('release'). Resting the
// fingers keeps it waiting. No arrow shows on a side with nowhere to go.
import { on, setting, tabByWc, activeTab } from './state.js';
import { h, anim, dur } from './util.js';
import { icon } from './icons.js';
import * as V from './views.js';

const wb = window.wb;
const SIZE = 52;      // the arrow's disc, px
const INSET = 14;     // how far in from the page's edge it ends up
const OVER = 24;      // px past where the swipe started, the other way, before the other side's arrow comes in
const SETTLE = 600;   // ms after going back or forward when a new swipe in that tab is leftover coasting (unless
                      // the touchpad says there are fingers on it)
const COAST = 200;    // ms after the fingers lift in which the touchpad's coasting may still light the arrow
const STALE = 6000;   // a swipe that never hears back is dropped after this long without news
// The swipe in progress: { tab, side, go, amount (toward that side's way), armed, lifted, el, clip (null: nowhere
// to go that way), distance, reverse }, or { tab, ignore }.
let cur = null;
let staleT = null;
const quietUntil = new Map();   // tab id -> time
let last = null;      // the last swipe that went somewhere (for tests): { go }

function cfg() {
  const g = setting('gestures') || {};
  return { on: g.swipe !== false, distance: Math.max(30, Math.min(600, Number(g.swipeDistance) || 120)), reverse: !!g.swipeReverse };
}

function touch() {
  clearTimeout(staleT);
  staleT = setTimeout(() => { if (cur) { const c = cur; cur = null; clearTimeout(c.coastT); leave(c, false); } }, STALE);
}

// (down: the touchpad says this is fingers on it, not what's left of the coasting after going somewhere)
function start(tab, dir, down) {
  // The same swipe going on (in another of the page's frames, say), unless the fingers lifted and came down again.
  if (cur && cur.tab === tab && !(down && (cur.lifted || cur.ignore))) { touch(); return; }
  if (cur && cur.tab === tab) end(tab); else drop();
  const c = cfg();
  if (!c.on || !dir) return;
  touch();
  if (!tab.pane || (!down && Date.now() < (quietUntil.get(tab.id) || 0))) { cur = { tab, ignore: true }; return; }
  cur = { tab, amount: 0, armed: false, lifted: false, distance: c.distance, reverse: c.reverse, el: null, clip: null };
  aim(cur, dir < 0 ? 'left' : 'right');
}

// The swipe heading for one side: its arrow comes in there, if there's somewhere to go that way.
function aim(c, side) {
  c.side = side;
  c.go = (side === 'left') !== c.reverse ? 'back' : 'forward';
  c.armed = false;
  const can = c.go === 'back' ? c.tab.canGoBack : c.tab.canGoForward;
  if (!can) { c.el = c.clip = null; return; }
  c.el = h('div.swipe-arrow.' + side, { dataset: { go: c.go } }, h('div.swipe-disc', null, icon(c.go)));
  c.clip = h('div.swipe-clip', null, c.el);
  c.tab.pane.body.appendChild(c.clip);
  draw(c);
}

function move(tab, steps) {
  if (!cur || cur.tab !== tab || cur.ignore) return;
  touch();
  // Fingers going the swipe's way add to it; going back takes away, and on past where it started, it heads for
  // the other side.
  for (const dx of steps) {
    cur.amount += cur.side === 'left' ? -dx : dx;
    if (!cur.el) cur.amount = Math.min(cur.amount, 0);   // (nowhere to go this way: nothing to build up)
    // (the coasting after the fingers lifted only lights the arrow that's there)
    if (cur.lifted) cur.amount = Math.max(cur.amount, 0);
    else if (cur.amount < -OVER) {
      const over = -cur.amount - OVER;
      if (cur.el) leave({ el: cur.el, clip: cur.clip, side: cur.side }, false);
      aim(cur, cur.side === 'left' ? 'right' : 'left');
      cur.amount = over;
    }
  }
  if (cur.el) draw(cur);
  // (coasting after the fingers lifted lit it)
  if (cur.lifted && cur.armed) decide();
}

function draw(c) {
  const { el, distance, side } = c;
  const amount = Math.max(0, c.amount);
  const p = Math.min(1, amount / distance);
  // From just outside the page to INSET px inside it, with a little give past the end.
  const x = -SIZE + p * (SIZE + INSET) + Math.min(24, Math.max(0, amount - distance) * 0.1);
  el.style.transform = `translateX(${side === 'left' ? x : -x}px)`;
  el.style.opacity = String(Math.min(1, p * 1.5));
  c.armed = amount >= distance;
  el.classList.toggle('armed', c.armed);
}

// The fingers left the touchpad: go if the arrow is lit; if it isn't, the coasting has a moment to light it.
function lift(tab) {
  if (!cur || cur.tab !== tab || cur.ignore || cur.lifted) return;
  if (cur.armed || !cur.el) { decide(); return; }
  const c = cur;
  c.lifted = true;
  c.coastT = setTimeout(() => { if (cur === c) decide(); }, COAST);
}

// The whole gesture is over (its coasting too): go if the arrow is lit.
function release(tab) {
  if (!cur || cur.tab !== tab) return;
  decide();
}

function decide() {
  const c = cur;
  cur = null;
  clearTimeout(staleT);
  clearTimeout(c.coastT);
  if (c.ignore) return;
  if (c.armed) {
    last = { go: c.go, at: Date.now() };
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
  clearTimeout(c.coastT);
  leave(c, false);
}

// The arrow goes: on with a little pulse if it went, back out the way it came if not.
function leave(c, went) {
  const { el, clip, side } = c;
  if (!el || !clip) return;
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
  if (cur) clearTimeout(cur.coastT);
  cur = null;
  clearTimeout(staleT);
}

export function init() {
  wb.on('swipe', ({ wcId, phase, dir, steps, down } = {}) => {
    const tab = tabByWc(wcId);
    if (!tab) return;
    if (phase === 'start') start(tab, dir, !!down);
    else if (phase === 'move') move(tab, Array.isArray(steps) ? steps : []);
    else if (phase === 'lift') lift(tab);
    else if (phase === 'release') release(tab);
    else if (phase === 'end') end(tab);
  });
  // Another tab was picked, or this one closed, mid-swipe: no arrow left hanging.
  on('active', () => { if (cur && cur.tab !== activeTab()) drop(); });
  on('tab-closing', (t) => { if (cur && cur.tab === t) drop(); });
}

// For tests: the swipe in progress (ignore: no arrow, nowhere to go that way), and the last one that went somewhere.
export const _last = () => last;
export const _state = () => (cur ? { go: cur.go || null, side: cur.side || null, amount: Math.max(0, cur.amount || 0), armed: !!cur.armed, lifted: !!cur.lifted, ignore: !!cur.ignore || !cur.el } : null);
