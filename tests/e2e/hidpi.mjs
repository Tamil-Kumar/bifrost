// Bifrost on a scaled display (150%, as on most Windows laptops), with the real pointer: menus open where
// you click, things are where they look. (Chromium is told the scale with --force-device-scale-factor; the
// X server's pixels are then 1.5× the window's.)
import { launch, startSite, reporter, assert, sleep, xinput } from './lib.mjs';

const SCALE = 1.5;
const R = reporter('hidpi');
const site = await startSite();
const t = await launch({ profile: 'hidpi', args: [site.url + '/article.html', `--force-device-scale-factor=${SCALE}`], width: 1100, height: 680 });
const x = xinput();
const P = (v) => Math.round(v * SCALE);               // window (CSS) pixels → screen pixels
const open = (url, background = false) => t.main((_, [url, background]) => global.__bifrost.registry.lastFocused().send('open-url', { url, background }), [url, background]);
const view = () => t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// (Its place and size as laid out: the opening animation scales it for a moment.)
const menuRect = () => t.ui(() => { const m = document.querySelector('.menu'); if (!m) return null; return { x: parseFloat(m.style.left), y: parseFloat(m.style.top), w: m.offsetWidth, h: m.offsetHeight, vh: innerHeight }; });
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 200) + ')' : ''));
};
const esc = async () => { await x.key('Escape'); await sleep(350); };

try {
  await sleep(1500);
  assert(await t.ui(() => devicePixelRatio) === SCALE, 'the window isn’t scaled');

  await R.step('a right-click on a page opens its menu at the pointer (and upward when there’s no room below)', async () => {
    const v = await view();
    const at = { x: Math.round(v.x + 240), y: Math.round(v.y + 120) };
    await x.move(P(at.x), P(at.y)); await sleep(100);
    await x.click(P(at.x), P(at.y), 3);
    const m = await until(menuRect, 3000, 'the menu');
    assert(Math.abs(m.x - at.x) <= 3 && Math.abs(m.y - at.y) <= 3, `pointer at ${at.x},${at.y}, menu at ${m.x},${m.y}`);
    await esc();
    const low = { x: Math.round(v.x + 300), y: Math.round(v.y + v.h - 40) };
    await x.click(P(low.x), P(low.y), 3);
    const m2 = await until(menuRect, 3000, 'the menu (low)');
    assert(Math.abs(m2.x - low.x) <= 3 && Math.abs(m2.y + m2.h - low.y) <= 3, `pointer at ${low.x},${low.y}, menu ${JSON.stringify(m2)} (its bottom should be at the pointer)`);
    await esc();
  });

  await R.step('the link menu’s items are where they’re drawn: Open link in new tab', async () => {
    await open(site.url + '/a.html'); await sleep(1200);
    const v = await view();
    const link = await t.guest('/a.html', '(() => { const r = document.getElementById("to-b").getBoundingClientRect(); return { x: r.x + 8, y: r.y + r.height / 2 }; })()');
    const before = await t.ui(() => window.__wbTest.state.tabs.length);
    await x.click(P(v.x + link.x), P(v.y + link.y), 3);
    await until(menuRect, 3000, 'the link menu');
    const item = await t.ui(() => { const it = [...document.querySelectorAll('.menu-item')].find((e) => /Open link in new tab/.test(e.textContent)); const r = it.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; });
    await x.click(P(item.x), P(item.y)); await sleep(1200);
    const after = await t.ui(() => window.__wbTest.state.tabs.length);
    assert(after === before + 1, `tabs ${before} → ${after}`);
  });

  await R.step('a tab’s close button shows on hover and closes that tab', async () => {
    const r = await t.ui(() => { const els = [...document.querySelectorAll('#tablist .tab[data-id]')]; const e = els[els.length - 1]; const q = e.getBoundingClientRect(); return { id: e.dataset.id, x: q.x + q.width / 2, y: q.y + q.height / 2, right: q.right }; });
    await x.move(P(r.x), P(r.y)); await sleep(300);
    const btn = await t.ui((id) => { const b = document.querySelector(`#tablist .tab[data-id="${id}"] .tab-close`); const q = b.getBoundingClientRect(); return { op: Number(getComputedStyle(b).opacity), x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, r.id);
    assert(btn.op > 0.9, 'the close button didn’t show: opacity ' + btn.op);
    await x.click(P(btn.x), P(btn.y)); await sleep(700);
    assert(!(await t.ui((id) => !!document.querySelector(`#tablist .tab[data-id="${id}"]`), r.id)), 'the tab is still there');
  });

  await R.step('the app menu opens under its button', async () => {
    const b = await t.ui(() => { const e = document.querySelector('#toolbar [data-tb="menu"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom, right: r.right }; });
    await x.click(P(b.x), P(b.y));
    const m = await until(menuRect, 3000, 'the app menu');
    // Under the button, lined up with its right edge; or, when the window is too short for all of it below
    // the button, as far up as it has to be.
    const fits = b.bottom + 6 + m.h <= m.vh - 8;
    assert((fits ? Math.abs(m.y - (b.bottom + 6)) <= 2 : m.y === Math.max(8, m.vh - 8 - m.h)) && Math.abs(m.x + m.w - b.right) <= 2, `button ${JSON.stringify(b)}, menu ${JSON.stringify(m)}`);
    await esc();
  });
} finally {
  x.close();
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
