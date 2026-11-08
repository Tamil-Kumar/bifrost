// Two-finger touchpad swipes: back and forward with the arrow — only once the fingers lift — and the swipes
// that don't count (things that scroll sideways, pages that take the wheel, a mouse, Shift), plus settings.
//
// Electron can't send a real touchpad gesture, so the tests play the fingers: wheel steps for moving them, and
// global.__swipeRelease (main/guests.js) for the end of the whole gesture, which on a real touchpad comes from
// Chromium once the fingers have lifted and any coasting after them is over. Windows' precision touchpads also
// say how many fingers are on them (main/touchpad.js): global.__touchpad plays that. The last steps check the
// wiring with the browser's own events, and with a stand-in for the touchpad watcher.
import fs from 'node:fs';
import path from 'node:path';
import { launch, startSite, reporter, assert, sleep, ROOT } from './lib.mjs';

const site = await startSite();
const CTL = '/home/claude/bf-test/profiles/gestures-touchpad.ctl';
const t = await launch({ profile: '/home/claude/bf-test/profiles/gestures', args: [site.url + '/index.html?G'], env: { BIFROST_TEST: '1', BIFROST_TOUCHPAD: path.join(ROOT, 'tests', 'fixtures', 'touchpad-standin.mjs'), BIFROST_TOUCHPAD_CTL: CTL } });
const R = reporter('gestures');
const setSetting = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const tab = () => t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const x = S.tabs.find((y) => y.id === ws.activeTabId); return { url: x.url, wcId: x.wcId, back: !!x.canGoBack, fwd: !!x.canGoForward }; });
const page = async (code) => { const { wcId } = await tab(); return t.main(({ webContents }, [id, code]) => webContents.fromId(id).executeJavaScript(code, true), [wcId, code]); };
async function waitFor(fn, ms = 6000, label = '') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); }
  throw new Error('timed out' + (label ? ' waiting for ' + label : '') + ': ' + JSON.stringify(last));
}
// Where an element of the page is (its middle), for aiming swipes.
const at = (sel) => page(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const ui = () => t.ui(() => { const a = document.querySelector('.swipe-arrow:not(.leaving)'); return { s: window.__wbTest.swipe(), arrow: a ? { side: a.classList.contains('left') ? 'left' : 'right', armed: a.classList.contains('armed'), go: a.dataset.go } : null }; });

// Fingers moving on the touchpad over the current tab's page at x, y: one wheel step per entry of `steps`
// (px; negative is fingers going left to right, which asks the page to scroll left), 16 ms apart. A mouse's
// steps are whole notches. Returns what the window shows right after the last step; the fingers stay down.
async function fingers({ x, y, steps, mouse = false, shift = false }) {
  const { wcId } = await tab();
  return t.main(async ({ webContents }, o) => {
    const wc = webContents.fromId(o.wcId);
    for (const d of o.steps) {
      // (Electron's deltaX is the page's, reversed.)
      wc.sendInputEvent({ type: 'mouseWheel', x: o.x, y: o.y, deltaX: -d, deltaY: 0, wheelTicksX: o.mouse ? -Math.sign(d) : -d / 120, wheelTicksY: 0, hasPreciseScrollingDeltas: !o.mouse, canScroll: true, modifiers: o.shift ? ['shift'] : [] });
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 60));
    return wc.hostWebContents.executeJavaScript(`(() => { const a = document.querySelector('.swipe-arrow:not(.leaving)'); return { s: window.__wbTest.swipe(), arrow: a ? { side: a.classList.contains('left') ? 'left' : 'right', armed: a.classList.contains('armed'), go: a.dataset.go } : null }; })()`);
  }, { wcId, x, y, steps, mouse, shift });
}
const even = (total, n = 14, dir = -1) => Array.from({ length: n }, () => (dir * total) / n);
// The fingers leave the touchpad.
const lift = async () => { const { wcId } = await tab(); return t.main((_, id) => global.__swipeRelease(id), wcId); };
const settle = () => sleep(700);
const urlIs = async (re) => re.test((await tab()).url);

try {
  // The tests lift the fingers themselves (see the top).
  await t.main(() => { global.__swipeManualRelease = true; });
  // A page to go back to: index.html?G, then wide.html in the same tab.
  await waitFor(() => urlIs(/index\.html\?G/), 8000, 'first page');
  await page(`location.href = '/wide.html'; true`);
  await waitFor(async () => { const x = await tab(); return /wide\.html/.test(x.url) && x.back; }, 8000, 'second page');
  await sleep(600);

  await R.step('left to right: the arrow comes in from the left and lights up, and nothing happens until the fingers lift', async () => {
    const p = await at('#plain');
    const r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.side === 'left' && r.arrow.go === 'back' && r.arrow.armed, 'arrow: ' + JSON.stringify(r));
    // Fingers resting on the touchpad, well past the end of the swipe: still here, arrow still lit.
    await sleep(1200);
    assert(await urlIs(/wide\.html/), 'went back with the fingers still down');
    const still = await ui();
    assert(still.arrow && still.arrow.armed, 'arrow kept: ' + JSON.stringify(still));
    await lift();
    await waitFor(() => urlIs(/index\.html\?G/), 4000, 'went back on lifting');
    await waitFor(() => t.ui(() => !document.querySelector('.swipe-arrow')), 3000, 'the arrow goes');
  });

  await R.step('right to left goes forward, on lifting', async () => {
    await sleep(700);
    const r = await fingers({ x: 400, y: 300, steps: even(260, 14, 1) });
    assert(r.arrow && r.arrow.side === 'right' && r.arrow.go === 'forward' && r.arrow.armed, 'arrow: ' + JSON.stringify(r));
    await sleep(500);
    assert(await urlIs(/index\.html\?G/), 'not before lifting');
    await lift();
    await waitFor(() => urlIs(/wide\.html/), 4000, 'went forward');
    await sleep(700);
  });

  await R.step('slowing down past the end doesn’t go (fingers still down); going back the other way cancels', async () => {
    const p = await at('#plain');
    // Past the end, then slowing to a stop: each step smaller than the last.
    let r = await fingers({ ...p, steps: [-20, -20, -20, -20, -20, -20, -20, -18, -15.5, -13, -11, -9, -7.5, -6, -5, -4, -3, -2] });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    await sleep(1000);
    assert(await urlIs(/wide\.html/), 'went while slowing down with the fingers still down');
    // Back the other way, then lifting: nothing.
    r = await fingers({ ...p, steps: even(200, 10, 1) });
    assert(r.arrow && !r.arrow.armed, 'unlit: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert(await urlIs(/wide\.html/), 'cancelled');
    assert(!(await ui()).arrow, 'arrow gone');
  });

  await R.step('a short swipe shows the arrow but lifting there goes nowhere', async () => {
    const p = await at('#plain');
    const r = await fingers({ ...p, steps: even(60, 5) });
    assert(r.arrow && !r.arrow.armed && r.s && r.s.amount > 0 && r.s.amount < 120, 'short: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert(await urlIs(/wide\.html/), 'stayed');
  });

  await R.step('no swipe over things that scroll sideways, a page that takes the wheel, a mouse, or with Shift', async () => {
    const before = await page(`document.getElementById('strip').scrollLeft`);
    let r = await fingers({ ...(await at('#strip')), steps: even(260) });
    assert(!r.arrow && !r.s, 'strip: ' + JSON.stringify(r));
    await settle();
    const after = await page(`document.getElementById('strip').scrollLeft`);
    assert(after < before, `the strip scrolled (${before} → ${after})`);
    r = await fingers({ ...(await at('#contained')), steps: even(260) });
    assert(!r.arrow && !r.s, 'contained: ' + JSON.stringify(r));
    await settle();
    r = await fingers({ ...(await at('#map')), steps: even(260) });
    assert(!r.arrow && !r.s, 'map: ' + JSON.stringify(r));
    await settle();
    const p = await at('#plain');
    r = await fingers({ ...p, steps: even(260), mouse: true });
    assert(!r.arrow && !r.s, 'mouse: ' + JSON.stringify(r));
    await settle();
    r = await fingers({ ...p, steps: even(260), shift: true });
    assert(!r.arrow && !r.s, 'shift: ' + JSON.stringify(r));
    await settle();
    assert(await urlIs(/wide\.html/), 'still on the page');
  });

  await R.step('nothing shows when there’s nowhere to go that way', async () => {
    const r = await fingers({ ...(await at('#plain')), steps: even(260, 14, 1) });   // no forward history here
    assert(!r.arrow && r.s && r.s.ignore, 'forward with nowhere to go: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert(await urlIs(/wide\.html/), 'stayed');
  });

  await R.step('what’s left of the coasting after going back doesn’t go again', async () => {
    for (const u of ['/wide.html?d1', '/wide.html?d2']) {
      await page(`location.href = '${u}'; true`);
      await waitFor(async () => (await tab()).url.endsWith(u), 8000, u);
      await sleep(400);
    }
    const p = await at('#plain');
    await fingers({ ...p, steps: even(200, 10) });
    await lift();
    await waitFor(async () => (await tab()).url.endsWith('/wide.html?d1'), 4000, 'went back');
    // The touchpad keeps coasting onto the page it went back to: enough for a swipe of its own, then it stops.
    const r = await fingers({ ...p, steps: even(200, 10) });
    assert(!r.arrow, 'no arrow for the coasting: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert((await tab()).url.endsWith('/wide.html?d1'), 'went back once: ' + (await tab()).url);
  });

  await R.step('settings: turned off, a longer distance, and the other way round', async () => {
    const p = await at('#plain');
    await setSetting('gestures.swipe', false);
    let r = await fingers({ ...p, steps: even(260) });
    assert(!r.arrow, 'off: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert(await urlIs(/d1/), 'off: stayed');
    await setSetting('gestures.swipe', true);
    // 260 px isn't enough when it takes 300.
    await setSetting('gestures.swipeDistance', 300);
    r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && !r.arrow.armed, 'longer distance: ' + JSON.stringify(r));
    await lift();
    await settle();
    assert(await urlIs(/d1/), 'not far enough');
    await setSetting('gestures.swipeDistance', 120);
    // The other way round: right to left goes back.
    await setSetting('gestures.swipeReverse', true);
    r = await fingers({ ...p, steps: even(260, 14, 1) });
    assert(r.arrow && r.arrow.side === 'right' && r.arrow.go === 'back' && r.arrow.armed, 'reversed: ' + JSON.stringify(r));
    await lift();
    await waitFor(() => urlIs(/wide\.html$/), 4000, 'reversed: went back');
    await setSetting('gestures.swipeReverse', false);
    await sleep(700);
  });

  await R.step('the browser’s own end of the scroll gesture is what lifts the fingers', async () => {
    await page(`location.href = '/wide.html?e2'; true`);
    await waitFor(async () => (await tab()).url.endsWith('/wide.html?e2'), 8000, 'page');
    await sleep(500);
    const p = await at('#plain');
    const r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    // From here the browser's own gesture ends count: one more step (a synthetic wheel step ends its own little
    // scroll gesture, as lifting the fingers ends a real one) and it goes.
    await t.main(() => { global.__swipeManualRelease = false; });
    await fingers({ ...p, steps: [-10] });
    await waitFor(async () => !(await tab()).url.endsWith('?e2'), 4000, 'went back');
    const last = await t.ui(() => window.__wbTest.swipeLast());
    assert(last && last.go === 'back', JSON.stringify(last));
    await t.main(() => { global.__swipeManualRelease = true; });
    await sleep(700);
  });

  const pages = async (...urls) => {
    for (const u of urls) {
      await page(`location.href = '${u}'; true`);
      await waitFor(async () => (await tab()).url.endsWith(u), 8000, u);
      await sleep(400);
    }
  };
  // What the touchpad says: how many fingers are on it (null: it doesn't say, as without a precision touchpad).
  const pad = async (n, wait = 0) => { await t.main((_, n) => global.__touchpad(n), n); if (wait) await sleep(wait); };
  const DEBOUNCE = 60;   // (main/touchpad.js waits 40 ms before fewer than two fingers count as lifting)

  await R.step('with a touchpad that says when the fingers lift: a quick swipe goes then, not once its coasting is over; what’s left of the coasting doesn’t swipe on the page it went to', async () => {
    await pages('/wide.html?f1', '/wide.html?f2');
    const p = await at('#plain');
    await pad(2);
    let r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    // The fingers lift, and the touchpad coasts on (the same way) for over a second, past the moment after going
    // when the window ignores new swipes anyway, onto the page it went back to: no swipe of its own there.
    const { wcId } = await tab();
    const seen = await t.main(async ({ webContents }, o) => {
      const wc = webContents.fromId(o.wcId);
      const t0 = Date.now();
      global.__touchpad(0);
      let went = null, coasting = true;
      const arrows = [];
      for (let i = 0; i < 90; i++) {
        wc.sendInputEvent({ type: 'mouseWheel', x: o.x, y: o.y, deltaX: 14, deltaY: 0, wheelTicksX: 0.1, wheelTicksY: 0, hasPreciseScrollingDeltas: true, canScroll: true });
        await new Promise((res) => setTimeout(res, 16));
        if (went === null && wc.getURL().endsWith('?f1')) went = Date.now() - t0;
        if (went !== null && i % 8 === 7) {
          arrows.push(await wc.hostWebContents.executeJavaScript(`!!document.querySelector('.swipe-arrow:not(.leaving)') || !!window.__wbTest.swipe()`));
          coasting = coasting && global.__swipeCoasting(o.wcId);
        }
      }
      return { went, arrows, coasting };
    }, { wcId, ...p });
    assert(seen.went !== null && seen.went < 800, 'went back as the fingers lifted: ' + JSON.stringify(seen));
    assert(seen.arrows.length >= 5 && !seen.arrows.some(Boolean) && seen.coasting, 'the coasting: ' + JSON.stringify(seen));
    await sleep(400);
    assert(!(await t.main((_, id) => global.__swipeCoasting(id), wcId)), 'still coasting once it stopped');
    assert((await tab()).url.endsWith('?f1'), 'went back once: ' + (await tab()).url);
    await lift();
    // Fingers on the touchpad again end the coasting at once; a swipe of its own then goes, forward this time.
    await pad(2);
    r = await fingers({ ...p, steps: even(260, 14, 1) });
    assert(r.arrow && r.arrow.armed && r.arrow.go === 'forward', 'a new swipe: ' + JSON.stringify(r));
    await pad(0);
    await waitFor(async () => (await tab()).url.endsWith('?f2'), 3000, 'went forward');
    await lift();
    await sleep(700);
  });

  await R.step('…a quick flick: coasting just after the fingers lift can still light the arrow; otherwise lifting goes nowhere', async () => {
    const p = await at('#plain');
    // Too short, and nothing after it: the arrow goes, the page stays.
    await pad(2);
    let r = await fingers({ ...p, steps: even(60, 5) });
    assert(r.arrow && !r.arrow.armed, 'short: ' + JSON.stringify(r));
    await pad(0, DEBOUNCE + 450);
    assert((await tab()).url.endsWith('?f2') && !(await ui()).arrow, 'stayed, arrow gone: ' + JSON.stringify(await ui()));
    await lift();
    await sleep(300);
    // Short, then coasting the other way after the fingers lift: it takes the arrow out, but doesn't bring the
    // other side's in (that's for fingers on the touchpad), and nothing goes.
    await pad(2);
    r = await fingers({ ...p, steps: even(80, 4) });
    assert(r.arrow && r.arrow.side === 'left' && !r.arrow.armed, 'short: ' + JSON.stringify(r));
    await pad(0, DEBOUNCE);
    r = await fingers({ ...p, steps: even(300, 6, 1) });
    assert(!r.arrow || r.arrow.side === 'left', 'the other side’s arrow came in: ' + JSON.stringify(r));
    await sleep(400);
    const after = await ui();
    assert((await tab()).url.endsWith('?f2') && !after.arrow && !after.s, 'stayed, arrow gone: ' + JSON.stringify(after));
    await lift();
    await sleep(300);
    // Short, then coasting on right after the fingers lift: it lights, and goes.
    await pad(2);
    r = await fingers({ ...p, steps: even(80, 4) });
    assert(r.arrow && !r.arrow.armed, 'not lit before lifting: ' + JSON.stringify(r));
    await pad(0, DEBOUNCE);
    await fingers({ ...p, steps: even(90, 4) });
    await waitFor(async () => (await tab()).url.endsWith('?f1'), 3000, 'went back with the coasting');
    await lift();
    await sleep(700);
  });

  await R.step('…two swipes in a row: fingers touching again while the first is still coasting make a swipe of their own at once', async () => {
    await pages('/wide.html?m1', '/wide.html?m2', '/wide.html?m3');
    const p = await at('#plain');
    await pad(2);
    const r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    // They lift (it goes back), the touchpad coasts on onto the page it went to, then fingers come down again
    // and swipe once more, the wheel steps never pausing; they lift again: it goes back again.
    const { wcId } = await tab();
    const seen = await t.main(async ({ webContents }, o) => {
      const wc = webContents.fromId(o.wcId);
      const step = async (d) => {
        wc.sendInputEvent({ type: 'mouseWheel', x: o.x, y: o.y, deltaX: d, deltaY: 0, wheelTicksX: d / 120, wheelTicksY: 0, hasPreciseScrollingDeltas: true, canScroll: true });
        await new Promise((res) => setTimeout(res, 16));
      };
      global.__touchpad(0);
      for (let i = 0; i < 25; i++) await step(10);
      const first = { url: wc.getURL(), coasting: global.__swipeCoasting(o.wcId) };
      global.__touchpad(2);
      for (let i = 0; i < 14; i++) await step(260 / 14);
      await new Promise((res) => setTimeout(res, 60));
      const arrow = await wc.hostWebContents.executeJavaScript(`(() => { const a = document.querySelector('.swipe-arrow:not(.leaving)'); return a ? { armed: a.classList.contains('armed'), go: a.dataset.go } : null; })()`);
      global.__touchpad(0);
      return { first, arrow };
    }, { wcId, ...p });
    assert(seen.first.url.endsWith('?m2') && seen.first.coasting, 'went back once, then coasting: ' + JSON.stringify(seen));
    assert(seen.arrow && seen.arrow.armed && seen.arrow.go === 'back', 'the second swipe: ' + JSON.stringify(seen));
    await waitFor(async () => (await tab()).url.endsWith('?m1'), 3000, 'went back again');
    await lift();
    await sleep(700);
  });

  await R.step('…fingers that stay down never go: not swiping back and forth, not resting, not with the browser’s own gesture ends and still steps in between (Windows sends those while they’re down)', async () => {
    await pages('/wide.html?g1', '/wide.html?g2');
    const p = await at('#plain');
    // From here the browser's own events count (each of Electron's wheel steps is a little scroll gesture of its
    // own: a still step, then the gesture's end), all while the touchpad says two fingers are down.
    await t.main(() => { global.__swipeManualRelease = false; });
    try {
      await pad(2);
      let r = await fingers({ ...p, steps: even(260) });
      assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
      await sleep(600);
      r = await fingers({ ...p, steps: even(200, 10, 1) });   // back the other way
      r = await fingers({ ...p, steps: even(260) });           // and again
      await sleep(800);                                        // resting
      assert((await tab()).url.endsWith('?g2'), 'went with the fingers down: ' + (await tab()).url);
      const st = await t.main((_, id) => global.__swipeState(id), (await tab()).wcId);
      assert(st && st.tracked && !st.lifted && st.ended, 'the swipe: ' + JSON.stringify(st));
      // They lift (lit): it goes.
      await pad(0);
      await waitFor(async () => (await tab()).url.endsWith('?g1'), 3000, 'went back as they lifted');
    } finally {
      await t.main(() => { global.__swipeManualRelease = true; });
    }
    await sleep(700);
  });

  await R.step('…the gesture’s end while the touchpad says two fingers are down waits for them; should the watcher stop instead, it goes then', async () => {
    await pages('/wide.html?k1', '/wide.html?k2');
    const p = await at('#plain');
    await pad(2);
    const r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    await lift();   // the gesture's end, with the touchpad still saying two fingers
    await sleep(1000);
    assert((await tab()).url.endsWith('?k2'), 'went with the fingers down: ' + (await tab()).url);
    const st = await t.main((_, id) => global.__swipeState(id), (await tab()).wcId);
    assert(st && st.ended && !st.lifted, 'the swipe: ' + JSON.stringify(st));
    await pad(null);
    await waitFor(async () => (await tab()).url.endsWith('?k1'), 1000, 'went back as the watcher stopped');
    await sleep(700);
  });

  await R.step('…the page only saying it’s a swipe after the fingers lifted (a busy page) still goes', async () => {
    await pages('/wide.html?h1', '/wide.html?h2');
    const p = await at('#plain');
    await pad(2);
    await pad(0, DEBOUNCE + 20);
    await fingers({ ...p, steps: even(260) });
    await waitFor(async () => (await tab()).url.endsWith('?h1'), 3000, 'went back');
    await lift();
    await pad(null);
    await sleep(700);
  });

  await R.step('swiping back the other way, on past where it started: the other side’s arrow comes in, and that’s where it goes', async () => {
    // (here: back and forward both, ?h1 between the page before and ?h2)
    const p = await at('#plain');
    let r = await fingers({ ...p, steps: even(200) });
    assert(r.arrow && r.arrow.side === 'left' && r.arrow.go === 'back' && r.arrow.armed, 'back first: ' + JSON.stringify(r));
    r = await fingers({ ...p, steps: even(380, 16, 1) });
    assert(r.arrow && r.arrow.side === 'right' && r.arrow.go === 'forward' && r.arrow.armed, 'then forward: ' + JSON.stringify(r));
    const n = await t.ui(() => document.querySelectorAll('.swipe-arrow:not(.leaving)').length);
    assert(n === 1, 'arrows showing: ' + n);
    await lift();
    await waitFor(async () => (await tab()).url.endsWith('?h2'), 3000, 'went forward');
    await sleep(700);
  });

  await R.step('…and the touchpad watcher’s own word reaches the swipes (a stand-in for it here)', async () => {
    await waitFor(() => t.main(() => global.__touchpadState().running && global.__touchpadState().touchpads === 1), 5000, 'the stand-in running');
    await pages('/wide.html?i1', '/wide.html?i2');
    const p = await at('#plain');
    fs.writeFileSync(CTL, 'fingers 2\n');
    await waitFor(() => t.main(() => global.__touchpadState().fingers === 2), 3000, 'fingers 2 from the stand-in');
    const r = await fingers({ ...p, steps: even(260) });
    assert(r.arrow && r.arrow.armed, 'lit: ' + JSON.stringify(r));
    fs.writeFileSync(CTL, 'fingers 0\n');
    await waitFor(async () => (await tab()).url.endsWith('?i1'), 3000, 'went back when it said they lifted');
    await lift();
    await pad(null);
    await sleep(700);
  });

  await R.step('the settings page has the touchpad settings; a screenshot of the lit arrow', async () => {
    await page(`location.href = '/wide.html?shot'; true`);
    await waitFor(async () => { const x = await tab(); return x.url.endsWith('?shot') && x.back; }, 8000, 'page');
    await sleep(500);
    await fingers({ ...(await at('#plain')), steps: even(240, 12) });
    await t.shot('gest-01-arrow');
    await lift();
    await settle();
    await t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: false }), 'bifrost://settings/#keyboard');
    const labels = await waitFor(() => t.main(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings'));
      return wc ? wc.executeJavaScript(`document.body.textContent.includes('Swipe with two fingers to go back and forward') && document.body.textContent.includes('How far to swipe') ? 'ok' : ''`) : '';
    }), 8000, 'touchpad settings');
    assert(labels === 'ok', labels);
  });
} finally {
  const errs = t.logs.filter((l) => /pageerror|Uncaught|\[ui error\]/.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.app.close(); site.stop();
  process.exit(R.summary() ? 1 : 0);
}
