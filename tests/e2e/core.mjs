// Everyday basics, with the real pointer and keyboard: tab close buttons in every layout and mode, Glass
// menus that really are see-through, the command palette and launcher, error pages that help, downloads
// from links, and the task manager.
import http from 'node:http';
import { launch, startSite, reporter, assert, sleep, xinput, freePort } from './lib.mjs';

const R = reporter('core');
const site = await startSite(undefined, { routes: {
  '/dl/report.pdf': (req, res) => { res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="report.pdf"' }); res.end('%PDF-1.4\n% test\n'); },
  '/links.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Links</title><body style="font:16px sans-serif;padding:40px"><a id="dl" href="/dl/report.pdf" target="_blank">Download the report</a></body>'); },
} });
const t = await launch({ profile: 'core', args: [site.url + '/colors.html'] });
const x = xinput();
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const open = (url, background = true) => t.main((_, [url, background]) => global.__bifrost.registry.lastFocused().send('open-url', { url, background }), [url, background]);
const esc = async () => { await x.key('Escape'); await sleep(250); };
const tabCount = () => t.ui(() => window.__wbTest.state.tabs.length);

// Every tab's close button, after pointing at the tab: what shows, and whether it's really on top.
async function probeTabs(sel) {
  // (An auto-hiding sidebar comes out when the pointer reaches the window's edge.)
  if (await t.ui(() => document.documentElement.classList.contains('sidebar-autohide') || document.documentElement.dataset.sidebarAutohide === 'true')) {
    await x.move(700, 400); await sleep(200); await x.move(2, 400); await sleep(700);
  }
  const tabs = await t.ui((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: r.x + Math.min(r.width * 0.4, 60), y: r.y + r.height / 2, w: r.width }; }), sel);
  const out = [];
  for (const tb of tabs) {
    await x.move(tb.x, tb.y);
    await sleep(320);
    out.push(await t.ui((id) => {
      const el = document.querySelector(`.tab[data-id="${id}"]`);
      const c = el && el.querySelector('.tab-close');
      if (!c) return { id, none: true };
      const cs = getComputedStyle(c), r = c.getBoundingClientRect();
      const at = r.width ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
      const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.9 && r.width >= 12 && cs.pointerEvents !== 'none';
      return { id, active: el.classList.contains('active'), hover: el.matches(':hover'), shown, onTop: !!at && c.contains(at), w: Math.round(r.width), inside: r.right <= el.getBoundingClientRect().right + 1 && r.left >= el.getBoundingClientRect().left - 1 };
    }, tb.id));
  }
  // (Pointing at the page, not at a tab: an auto-hidden sidebar stays out while the pointer is over it.)
  const sideOpen = await t.ui(() => { const s = document.getElementById('sidebar').getBoundingClientRect(); return s.width > 100 ? { x: s.x + s.width / 2, y: s.bottom - 60 } : null; });
  if (sideOpen) await x.move(sideOpen.x, sideOpen.y); else await x.move(900, 600);
  await sleep(250);
  const idle = await t.ui((sel) => [...document.querySelectorAll(sel)].map((el) => { const c = el.querySelector('.tab-close'); const cs = c ? getComputedStyle(c) : null; return { active: el.classList.contains('active'), shown: !!cs && cs.display !== 'none' && Number(cs.opacity) > 0.9 }; }), sel);
  return { hovered: out, idle };
}

try {
  for (const p of ['a.html', 'b.html', 'article.html', 'wide.html']) { await open(site.url + '/' + p); await sleep(150); }
  await sleep(1200);

  const layouts = [
    ['vertical tabs', { 'appearance.tabLayout': 'vertical' }, '#tablist .tab[data-id]'],
    ['vertical tabs on the right', { 'appearance.sidebarSide': 'right' }, '#tablist .tab[data-id]'],
    ['compact density', { 'appearance.sidebarSide': 'left', 'appearance.density': 'compact' }, '#tablist .tab[data-id]'],
    ['auto-hiding top bar', { 'appearance.density': 'comfortable', 'appearance.topbarAutoHide': true }, '#tablist .tab[data-id]'],
    ['auto-hiding sidebar', { 'appearance.topbarAutoHide': false, 'appearance.sidebarAutoHide': true }, '#tablist .tab[data-id]'],
    ['icons-only sidebar', { 'appearance.sidebarAutoHide': false, 'appearance.sidebarCollapsed': true }, '#tablist .tab[data-id]'],
    ['horizontal tabs', { 'appearance.sidebarCollapsed': false, 'appearance.tabLayout': 'horizontal' }, '#htabs .tab[data-id]:not(.pinned)'],
  ];
  for (const [label, cfg, sel] of layouts) {
    await R.step(`close buttons on tabs — ${label}: On hover, Always and Never`, async () => {
      for (const [k, v] of Object.entries(cfg)) await set(k, v);
      for (const mode of ['hover', 'always', 'never']) {
        await set('appearance.showTabCloseButtons', mode);
        await sleep(450);
        const { hovered, idle } = await probeTabs(sel);
        assert(hovered.length >= 4, `${mode}: only ${hovered.length} tabs found`);
        for (const r of hovered) {
          if (mode === 'never') { assert(!r.shown, `${mode}: a close button shows on tab ${r.id}`); continue; }
          assert(r.hover, `${mode}: pointing at tab ${r.id} doesn't hover it ${JSON.stringify(r)}`);
          assert(r.shown && r.onTop && r.inside, `${mode}: no usable close button on hovered tab ${r.id}: ${JSON.stringify(r)}`);
        }
        if (mode === 'hover' && !label.startsWith('icons-only')) {
          assert(idle.filter((r) => !r.active).every((r) => !r.shown), `hover: close buttons show on tabs nobody points at ${JSON.stringify(idle)}`);
          assert(idle.filter((r) => r.active).every((r) => r.shown), 'hover: the current tab has no close button');
        }
        if (mode === 'always' && !label.startsWith('icons-only')) assert(idle.every((r) => r.shown), `always: some tabs have none ${JSON.stringify(idle)}`);
      }
      await set('appearance.showTabCloseButtons', 'hover');
    });
  }
  await set('appearance.tabLayout', 'vertical');
  await sleep(500);

  await R.step('clicking a tab’s close button closes that tab (and only that one)', async () => {
    const before = await tabCount();
    const target = await t.ui(() => { const el = [...document.querySelectorAll('#tablist .tab[data-id]')].find((e) => !e.classList.contains('active')); const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: r.x + 40, y: r.y + r.height / 2 }; });
    await x.move(target.x, target.y); await sleep(300);
    const c = await t.ui((id) => { const r = document.querySelector(`.tab[data-id="${id}"] .tab-close`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, target.id);
    await x.click(c.x, c.y);
    await t.until((n) => window.__wbTest.state.tabs.length === n - 1, before, 3000, 'the tab to close');
    assert(!(await t.ui((id) => !!window.__wbTest.state.tabs.find((tb) => tb.id === id), target.id)), 'the wrong tab closed');
    await x.move(900, 600);
  });

  // ------------------------------------------------------------------ menus
  const firstTab = async () => { const c = await t.ui(() => { const e = document.querySelector('#tablist .tab[data-id]'); const r = e.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; }); await x.click(c.x, c.y); await x.move(900, 600); await sleep(500); };
  const menuLook = async () => {
    const m = await t.ui(() => { const el = document.querySelector('.menu'); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: r.x, y: r.y, w: r.width, h: r.height, blur: cs.backdropFilter, bg: cs.backgroundImage + ' ' + cs.backgroundColor }; });
    return m;
  };
  await R.step('Glass menus really are see-through and blurred; Solid ones aren’t', async () => {
    await firstTab();
    const looks = {};
    for (const style of ['solid', 'glass']) {
      await set('appearance.menuStyle', style);
      await sleep(300);
      const c = await t.ui(() => { const e = document.querySelector('#toolbar [data-tb="menu"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await x.click(c.x, c.y); await sleep(500);
      looks[style] = await menuLook();
      // The menu's own pixels: Glass shows the colorful page through it (the colors vary), Solid doesn't.
      looks[style].spread = await t.main(async ({ BrowserWindow }, m) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
        const img = await w.webContents.capturePage({ x: Math.round(m.x + 8), y: Math.round(m.y + m.h * 0.35), width: 6, height: Math.round(m.h * 0.5) });
        const bmp = img.toBitmap(); const { width, height } = img.getSize();
        const hues = [];
        for (let yy = 0; yy < height; yy += 4) { const i = (yy * width + 2) * 4; hues.push([bmp[i + 2], bmp[i + 1], bmp[i]]); }
        const avg = (k) => hues.reduce((s, p) => s + p[k], 0) / hues.length;
        const sd = (k) => Math.sqrt(hues.reduce((s, p) => s + (p[k] - avg(k)) ** 2, 0) / hues.length);
        return Math.round(sd(0) + sd(1) + sd(2));
      }, looks[style]);
      await t.shot('core-menu-' + style);
      await esc();
    }
    assert(/blur/.test(looks.glass.blur), 'Glass has no blur: ' + looks.glass.blur);
    assert(!/blur/.test(looks.solid.blur || ''), 'Solid is blurred: ' + looks.solid.blur);
    assert(looks.glass.spread > looks.solid.spread + 12, `the page doesn't show through Glass (color spread ${looks.glass.spread} vs Solid ${looks.solid.spread})`);
    await set('appearance.menuStyle', 'solid');
  });

  await R.step('the command palette lists commands as soon as it opens (and finds them by typing)', async () => {
    await t.ui(() => window.__wbTest.command('commandPalette'));
    const n = await t.until(() => document.querySelectorAll('.launcher .rrow').length || 0, null, 3000, 'commands');
    assert(n >= 8, 'only ' + n + ' rows');
    for (const k of ['s', 'e', 't', 't']) await x.key(k);
    await sleep(500);
    const first = await t.ui(() => { const r = document.querySelector('.launcher .rrow'); return r ? r.textContent : ''; });
    assert(/setting/i.test(first), 'typing “sett” doesn’t find Settings: ' + first);
    await esc();
  });

  await R.step('the launcher opens with something useful (open tabs, history) even with no bookmarks', async () => {
    await t.ui(() => window.__wbTest.command('launcher'));
    const n = await t.until(() => document.querySelectorAll('.launcher .rrow').length || 0, null, 3000, 'rows');
    assert(n >= 3, 'only ' + n + ' rows');
    await esc();
  });

  // ------------------------------------------------------------- errors
  const port = await freePort();
  await R.step('a site that refuses to connect: says so, with a working Try again', async () => {
    await open(`http://127.0.0.1:${port}/hello`, false);
    await t.until(() => !!document.querySelector('.err-card'), null, 8000, 'the error page');
    const card = await t.ui(() => { const c = document.querySelector('.err-card'); return { title: c.querySelector('h2').textContent, buttons: [...c.querySelectorAll('.err-actions button')].map((b) => b.textContent.trim()) }; });
    assert(/refused/i.test(card.title), 'title: ' + card.title);
    assert(card.buttons.includes('Try again'), 'buttons: ' + card.buttons.join(', '));
    await t.shot('core-error-refused');
    // The site comes up; Try again loads it.
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Back up</title><h1>Hello</h1>'); });
    await new Promise((r) => srv.listen(port, '127.0.0.1', r));
    const b = await t.ui(() => { const btn = [...document.querySelectorAll('.err-actions button')].find((e) => /Try again/.test(e.textContent)); const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await x.click(b.x, b.y);
    await t.until(() => !document.querySelector('.err-card') && window.__wbTest.state.tabs.some((tb) => tb.title === 'Back up'), null, 8000, 'the page after Try again');
    srv.close();
  });

  await R.step('a link that downloads in a new tab leaves no empty tab behind', async () => {
    await open(site.url + '/links.html', false);
    await sleep(900);
    const before = await tabCount();
    const link = await t.guest('/links.html', `(() => { const r = document.getElementById('dl').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()`);
    const view = await t.ui(() => { const v = document.querySelector('webview.active, #views webview:not([hidden])'); const r = (v || document.getElementById('stage')).getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await x.click(view.x + link.x, view.y + link.y);
    await sleep(2500);
    const after = await tabCount();
    assert(after === before, `tabs: ${before} before, ${after} after`);
    const dl = await t.main(() => global.__bifrost.downloads.list().map((d) => d.filename));
    assert(dl.some((f) => /report/.test(f)), 'the download isn’t listed: ' + dl.join(', '));
  });

  await R.step('the task manager names every process and shows tab icons', async () => {
    await t.ui(() => window.__wbTest.command('taskManager'));
    await sleep(2500);
    const rows = await t.guest('bifrost://tasks', `[...document.querySelectorAll('tbody tr')].map((tr) => ({ name: tr.querySelector('.t-name').textContent.trim(), favs: tr.querySelectorAll('img.t-fav').length }))`);
    assert(rows.length >= 4, 'only ' + rows.length + ' rows');
    const unnamed = rows.filter((r) => !r.name);
    assert(!unnamed.length, unnamed.length + ' rows without a name');
    assert(rows.some((r) => r.favs > 0), 'no tab icons');
    await t.shot('core-tasks');
  });
} finally {
  x.close();
  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
