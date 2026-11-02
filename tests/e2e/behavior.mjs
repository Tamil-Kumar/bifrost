// Settings that change what happens rather than how things look: each one tried both ways, with the real
// pointer and keyboard where that's how you'd use it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startSite, reporter, assert, sleep, xinput, ROOT } from './lib.mjs';

const R = reporter('behavior');
// A second of a quiet tone, for "playing sound".
function wav() {
  const rate = 8000, n = rate * 2, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return buf;
}
const site = await startSite(undefined, { routes: {
  '/tone.wav': (req, res) => { const b = wav(); res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': b.length }); res.end(b); },
  '/sound.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Sound</title><audio id=a src="/tone.wav" loop autoplay></audio><p>sound</p>'); },
  '/dl/file.zip': (req, res) => { res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="file.zip"' }); res.end(Buffer.alloc(1024)); },
  // A dark page whose color comes from a wrapper, not from <body> (as in many web apps).
  '/dark.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Dark</title><style>html,body{margin:0;height:100%}#app{position:fixed;inset:0;background:#13233a;color:#e8eef7;font:20px sans-serif;padding:40px}</style><div id="app">A dark app</div>'); },
} });
const t = await launch({ profile: 'behavior', args: [site.url + '/a.html'] });
const x = xinput();
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const open = (url, background = true) => t.main((_, [url, background]) => global.__bifrost.registry.lastFocused().send('open-url', { url, background }), [url, background]);
const tabs = () => t.ui(() => window.__wbTest.state.tabs.filter((tb) => tb.workspaceId === window.__wbTest.state.activeWorkspaceId).map((tb) => ({ id: tb.id, url: tb.url, title: tb.title })));
const activeUrl = () => t.ui(() => { const s = window.__wbTest.state; const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId); const tb = w && s.tabs.find((x) => x.id === w.activeTabId); return tb ? tb.url : null; });
const tabEl = (urlPart) => t.ui((u) => { const el = [...document.querySelectorAll('#tablist .tab[data-id]')].find((e) => { const tb = window.__wbTest.state.tabs.find((x) => x.id === e.dataset.id); return tb && tb.url.includes(u); }); if (!el) return null; const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: r.x + 50, y: r.y + r.height / 2 }; }, urlPart);
const clickTab = async (urlPart) => { const c = await tabEl(urlPart); await x.click(c.x, c.y); await x.move(900, 600); await sleep(250); };
const esc = async () => { await x.key('Escape'); await sleep(200); };

try {
  for (const p of ['b.html', 'article.html', 'colors.html']) { await open(site.url + '/' + p); await sleep(150); }
  await sleep(1200);

  await R.step('new tabs open next to the current tab, or at the end', async () => {
    for (const [pos, want] of [['afterActive', 1], ['end', -1]]) {
      await set('tabs.newTabPosition', pos);
      await clickTab('/a.html');
      const before = (await tabs()).length;
      await t.ui(() => window.__wbTest.command('newTabPage'));
      await sleep(500);
      const list = await tabs();
      assert(list.length === before + 1, 'no new tab');
      const idx = list.findIndex((tb) => /newtab/.test(tb.url) || !tb.url);
      const expect = want === -1 ? list.length - 1 : want;
      assert(idx === expect, `${pos}: the new tab is at ${idx}, not ${expect} (${list.map((tb) => tb.url.split('/').pop()).join(', ')})`);
      await t.ui(() => window.__wbTest.command('closeTab'));
      await sleep(400);
    }
  });

  await R.step('after closing a tab: the one used before, the one after it, or the one before it', async () => {
    const order = async () => (await tabs()).map((tb) => tb.url);
    // previous: use b, then colors; closing colors goes back to b.
    await set('tabs.activateOnClose', 'previous');
    await clickTab('/b.html'); await clickTab('/colors.html');
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400);
    assert(/\/b\.html/.test(await activeUrl()), 'previous: ' + await activeUrl());
    await open(site.url + '/colors.html'); await sleep(500);
    for (const mode of ['right', 'left']) {
      await set('tabs.activateOnClose', mode);
      await clickTab('/b.html');
      const list = await order();
      const i = list.findIndex((u) => /\/b\.html/.test(u));
      const want = mode === 'right' ? (list[i + 1] || list[i - 1]) : (list[i - 1] || list[i + 1]);
      await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400);
      assert(await activeUrl() === want, `${mode}: ${await activeUrl()} instead of ${want}`);
      await open(site.url + '/b.html'); await sleep(500);
    }
    await set('tabs.activateOnClose', 'previous');
  });

  await R.step('middle-click closes a tab — or doesn’t, when turned off', async () => {
    for (const on of [false, true]) {
      await set('tabs.middleClickCloses', on);
      await sleep(200);
      const before = (await tabs()).length;
      const c = await tabEl('/colors.html');
      await x.click(c.x, c.y, 2); await x.move(900, 600); await sleep(500);
      const after = (await tabs()).length;
      assert(on ? after === before - 1 : after === before, `middle-click with the setting ${on ? 'on' : 'off'}: ${before} → ${after} tabs`);
    }
    await open(site.url + '/colors.html'); await sleep(500);
  });

  await R.step('double-click closes a tab only when turned on', async () => {
    for (const on of [false, true]) {
      await set('tabs.doubleClickToClose', on);
      await sleep(200);
      const before = (await tabs()).length;
      const c = await tabEl('/colors.html');
      await x.click(c.x, c.y); await sleep(60); await x.click(c.x, c.y); await x.move(900, 600); await sleep(600);
      const after = (await tabs()).length;
      assert(on ? after === before - 1 : after === before, `double-click with the setting ${on ? 'on' : 'off'}: ${before} → ${after} tabs`);
    }
    await set('tabs.doubleClickToClose', false);
  });

  const ws0 = await t.ui(() => window.__wbTest.state.activeWorkspaceId);
  await R.step('closing the last tab (with the window kept) leaves a fresh tab', async () => {
    await set('tabs.closeWindowWithLastTab', false);
    await t.ui(() => window.__wbTest.command('newWorkspace'));
    await sleep(500);
    await x.key('Return');   // the New space dialog: Create
    await sleep(700);
    // (a space of its own, with one tab)
    const ws = await t.ui(() => window.__wbTest.state.activeWorkspaceId);
    assert(ws !== ws0, 'no new space');
    let n = await t.ui((ws) => window.__wbTest.state.tabs.filter((tb) => tb.workspaceId === ws).length, ws);
    if (n === 0) { await t.ui(() => window.__wbTest.command('newTabPage')); await sleep(400); }
    for (let i = 0; i < 6 && (await t.ui((ws) => window.__wbTest.state.tabs.filter((tb) => tb.workspaceId === ws).length, ws)) > 1; i++) { await t.ui(() => window.__wbTest.command('closeTab')); await sleep(300); }
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(600);
    n = await t.ui((ws) => window.__wbTest.state.tabs.filter((tb) => tb.workspaceId === ws).length, ws);
    const windows = await t.main(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);
    assert(windows >= 1, 'the window closed');
    assert(n >= 1 || (await t.ui(() => window.__wbTest.state.tabs.length)) >= 1, 'no tab left');
    await t.ui(() => window.__wbTest.command('workspace1')); await sleep(600);
    assert(await t.ui(() => window.__wbTest.state.activeWorkspaceId) === ws0, 'couldn’t get back to the first space');
  });

  await R.step('“Show which tabs are playing sound”: a speaker on the tab, or none when turned off', async () => {
    await open(site.url + '/sound.html'); await sleep(2500);
    const audible = await t.ui(() => window.__wbTest.state.tabs.some((tb) => tb.audible));
    if (!audible) { console.log('    (no sound device here: the tab never becomes audible; checked the setting’s wiring only)'); }
    const speaker = () => t.ui(() => { const tb = window.__wbTest.state.tabs.find((x) => /sound\.html/.test(x.url)); const el = document.querySelector(`.tab[data-id="${tb.id}"] .tab-audio`); return el ? el.childElementCount : -1; });
    if (audible) assert(await speaker() === 1, 'no speaker on a tab playing sound');
    await set('tabs.showAudioIndicator', false); await sleep(400);
    assert(await speaker() === 0, 'the speaker is still there with the setting off');
    await set('tabs.showAudioIndicator', true); await sleep(400);
    if (audible) assert(await speaker() === 1, 'the speaker didn’t come back');
  });

  await R.step('address bar searches open in a new tab only when asked to', async () => {
    for (const on of [false, true]) {
      await set('search.openInNewTab', on);
      await clickTab('/b.html');
      const before = (await tabs()).length;
      await t.ui(() => window.__wbTest.command('focusAddress')); await sleep(250);
      for (const k of ['b', 'i', 'f', 'r', 'o', 's', 't', 'space', 'w', 'i', 'k', 'i']) await x.key(k);
      await sleep(300);
      await x.key('Return'); await sleep(900);
      const after = (await tabs()).length;
      assert(on ? after === before + 1 : after === before, `with the setting ${on ? 'on' : 'off'}: ${before} → ${after} tabs`);
      if (on) { await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400); }
      else { await t.ui(() => window.__wbTest.command('back')); await sleep(800); }
    }
    await set('search.openInNewTab', false);
  });

  await R.step('the launcher: how many results, and what it shows before you type', async () => {
    await set('launcher.emptyState', 'none'); await sleep(200);
    await t.ui(() => window.__wbTest.command('launcher')); await sleep(600);
    const none = await t.ui(() => document.querySelectorAll('.launcher .rrow').length);
    await esc();
    assert(none === 0, `“Nothing” shows ${none} rows`);
    await set('launcher.emptyState', 'tabs'); await sleep(200);
    await t.ui(() => window.__wbTest.command('launcher')); await sleep(600);
    const some = await t.ui(() => document.querySelectorAll('.launcher .rrow').length);
    await esc();
    assert(some >= 3, `“Recent tabs” shows ${some} rows`);
    await set('launcher.maxResults', 3); await sleep(200);
    await t.ui(() => window.__wbTest.command('launcher')); await sleep(300);
    for (const k of ['period', 'h', 't', 'm', 'l']) await x.key(k);
    await sleep(700);
    const capped = await t.ui(() => document.querySelectorAll('.launcher .rrow:not(.search)').length);
    await esc();
    assert(capped <= 4, `3 results asked for, ${capped} shown`);
    await set('launcher.maxResults', 8);
    await set('launcher.emptyState', 'bookmarks');
  });

  await R.step('HTTPS-only mode upgrades plain HTTP addresses (not local ones)', async () => {
    await set('privacy.httpsOnly', true); await sleep(200);
    await open('http://bifrost-test.invalid/page', false); await sleep(2000);
    const u = await activeUrl();
    assert(/^https:\/\/bifrost-test\.invalid/.test(u || ''), 'not upgraded: ' + u);
    await open(site.url + '/b.html?local', false); await sleep(1200);
    assert(/^http:\/\/127\.0\.0\.1/.test(await activeUrl() || ''), 'a local address was upgraded: ' + await activeUrl());
    await set('privacy.httpsOnly', false);
  });

  await R.step('downloads show when they start — or stay quiet when turned off', async () => {
    for (const on of [false, true]) {
      await set('downloads.askWhereToSave', false);
      await set('downloads.showOnStart', on);
      await clickTab('/b.html');
      await t.guest('/b.html', `(() => { const a = document.createElement('a'); a.href = '/dl/file.zip'; a.download = ''; document.body.append(a); a.click(); return 1; })()`);
      await sleep(1500);
      const shown = await t.ui(() => !!document.querySelector('.dl-popover'));
      assert(shown === on, `with the setting ${on ? 'on' : 'off'} the downloads popover ${shown ? 'showed' : 'didn’t show'}`);
      await esc();
    }
  });

  await R.step('Vim keys: off by default; on, j scrolls; on an excluded site (YouTube), keys go to the page', async () => {
    const trace = [];
    const scrollAfterJ = async () => {
      trace.length = 0;
      trace.push('tabEl ' + JSON.stringify(await tabEl('/article.html')) + ' tabs ' + JSON.stringify((await tabs()).map((x) => x.url.replace(/^https?:\/\/[^/]+/, ''))));
      await clickTab('/article.html');
      trace.push('after clickTab active ' + (await activeUrl()));
      await t.guest('/article.html', 'window.scrollTo(0, 0), document.activeElement && document.activeElement.blur && document.activeElement.blur(), 1');
      const v = await t.ui(() => { const w = document.querySelector('#views webview:not(.hidden)') || document.querySelector('webview'); const r = w.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await x.click(v.x, v.y); await sleep(200);
      await x.key('j'); await x.key('j'); await x.key('j'); await sleep(600);
      return t.guest('/article.html', 'window.scrollY');
    };
    assert(await t.main(() => global.__bifrost.settings.get('keyboard.vim.enabled')) === false, 'Vim keys are on in a new profile');
    assert(await scrollAfterJ() === 0, 'j scrolled with Vim keys off');
    await set('keyboard.vim.enabled', true); await sleep(400);
    await t.main(({ app, webContents }) => {
      global.__jTo = [];
      const hook = (wc) => wc.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'j') global.__jTo.push(wc.getType() + ' ' + wc.getURL().replace(/^https?:\/\/[^/]+/, '')); });
      for (const wc of webContents.getAllWebContents()) hook(wc);
    });
    const sy = await scrollAfterJ();
    if (!(sy > 50)) {
      const where = await t.main(() => global.__jTo);
      const ui = await t.ui(() => ({ active: document.activeElement && (document.activeElement.tagName + '#' + document.activeElement.id + '.' + document.activeElement.className), url: (() => { const s = window.__wbTest.state; const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId); return s.tabs.find((x) => x.id === w.activeTabId).url; })() }));
      const cfg = await t.guest('/article.html', 'JSON.stringify({ focus: document.hasFocus(), active: document.activeElement && document.activeElement.tagName })');
      throw new Error(`j didn’t scroll with Vim keys on (scrollY ${sy}; j went to ${JSON.stringify(where)}; window ${JSON.stringify(ui)}; page ${cfg}; ${trace.join(' | ')})`);
    }
    const excluded = await t.main(() => global.__bifrost.settings.get('keyboard.vim.excludedSites'));
    assert(excluded.includes('youtube.com'), 'YouTube isn’t excluded: ' + excluded.join(', '));
    await set('keyboard.vim.enabled', false);
  });

  await R.step('“Match the page”: the sidebar and toolbar take the page’s color, with text that reads on it; Bifrost’s own pages turn see-through to the window', async () => {
    const rgb = (c) => (String(c).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const light = (c) => { const [r, g, b] = rgb(c); return (r + g + b) / 3; };
    const look = () => t.ui(() => {
      const tab = document.querySelector('#tablist .tab.active .tab-title');
      const ws = document.querySelector('#sidebar .wsb-name');
      return { blend: document.documentElement.classList.contains('blend'), body: getComputedStyle(document.body).backgroundColor, tab: tab ? getComputedStyle(tab).color : '', ws: ws ? getComputedStyle(ws).color : '', addr: getComputedStyle(document.querySelector('.addr-display') || document.body).color, shadow: getComputedStyle(document.getElementById('stage')).boxShadow };
    });
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    await open(site.url + '/dark.html', false);
    await sleep(900);
    let l = await look();
    assert(!l.blend, 'it’s off by default');
    await set('appearance.blend', 'page');
    l = await until(async () => { const v = await look(); return v.blend && v.body === 'rgb(19, 35, 58)' ? v : null; }, 4000, 'the dark page’s color');
    assert(light(l.tab) > 170 && (!l.ws || light(l.ws) > 150) && light(l.addr) > 150, 'light text on the dark page: ' + JSON.stringify(l));
    assert(l.shadow === 'none', 'no shadow between the page and the window: ' + l.shadow);
    await t.shot('behavior-blend-dark');
    await clickTab('/a.html');
    l = await until(async () => { const v = await look(); return v.blend && v.body === 'rgb(255, 247, 240)' ? v : null; }, 4000, 'the light page’s color');
    assert(light(l.tab) < 110 && (!l.ws || light(l.ws) < 110) && light(l.addr) < 110, 'dark text on the light page: ' + JSON.stringify(l));
    await t.shot('behavior-blend-light');
    // Bifrost's own pages: see-through, sharing the window's background (the new tab page's glow too).
    const own = () => t.ui(() => ({ see: document.documentElement.classList.contains('see-through'), ntp: document.documentElement.dataset.ntpBg || '', stage: getComputedStyle(document.getElementById('stage')).backgroundColor }));
    await open('bifrost://settings/', false);
    let o = await until(async () => { const v = await own(); return v.see ? v : null; }, 4000, 'Settings to be see-through');
    assert(o.stage === 'rgba(0, 0, 0, 0)', 'the frame behind Settings: ' + o.stage);
    const pageClear = await until(() => t.guest('bifrost://settings', 'document.documentElement.classList.contains("see-through") && getComputedStyle(document.body).backgroundColor'), 4000, 'Settings itself to be clear');
    assert(pageClear === 'rgba(0, 0, 0, 0)', 'Settings draws its own background: ' + pageClear);
    await t.ui(() => window.__wbTest.command('newTabPage'));
    o = await until(async () => { const v = await own(); return v.see && v.ntp === 'gradient' ? v : null; }, 4000, 'the new tab page’s glow behind the whole window');
    await t.shot('behavior-blend-newtab');
    // From a see-through page to a website: the window takes the site's color at once, as the page shows. (It
    // used to fade in from nothing, so the window's own background, Mica on Windows, flashed through.)
    const frames = await t.ui(async () => {
      const S = window.__wbTest.state;
      const mine = S.tabs.filter((x) => x.workspaceId === S.activeWorkspaceId);
      const i = mine.findIndex((x) => x.url.includes('/dark.html'));
      if (i < 0 || i > 7) return ['dark.html is tab ' + (i + 1)];
      window.__wbTest.command('tab' + (i + 1));
      const out = [];
      for (let f = 0; f < 12; f++) { out.push(getComputedStyle(document.body).backgroundColor); await new Promise((r) => requestAnimationFrame(r)); }
      return out;
    });
    assert(frames.every((c) => c === 'rgb(19, 35, 58)'), 'the window faded to the page’s color: ' + frames.join(' → '));
    await t.ui(() => window.__wbTest.command('newTabPage'));
    await until(async () => (await own()).see, 3000, 'the new tab page again');
    await t.ui(() => window.__wbTest.command('closeTab'));
    await clickTab('/dark.html');
    await until(async () => (await look()).blend, 3000, 'the page color again');
    // On the same page, a change of color still fades.
    const fades = await t.ui(() => document.documentElement.classList.contains('blend') && getComputedStyle(document.body).transitionProperty);
    await t.guest('/dark.html', "document.getElementById('app').style.background = '#3a1323'; window.dispatchEvent(new Event('resize')); 1");
    await until(async () => (await look()).body !== 'rgb(19, 35, 58)', 4000, 'the page’s new color');
    const fading = await t.ui(() => document.documentElement.classList.contains('blend-fade') && getComputedStyle(document.body).transitionProperty);
    assert(fading === 'background-color', 'a color change on the same page doesn’t fade: ' + JSON.stringify({ fades, fading }));
    await t.guest('/dark.html', "document.getElementById('app').style.background = '#13233a'; window.dispatchEvent(new Event('resize')); 1");
    await until(async () => (await look()).body === 'rgb(19, 35, 58)', 4000, 'the page’s color back');
    await set('appearance.blend', 'window');
    await until(async () => !(await look()).blend, 3000, 'the theme again');
    o = await own();
    assert(!o.see && !o.ntp, 'still see-through: ' + JSON.stringify(o));
  });

  await R.step('“Blur the page”: a blurred picture of the page behind the sidebar and toolbar; over Bifrost’s own pages they’re frosted glass', async () => {
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    const blur = () => t.ui(() => {
      const r = document.documentElement; const on = document.querySelector('#backdrop > div.on');
      return { blur: r.classList.contains('blend-blur'), frosted: r.classList.contains('frosted'), img: on ? on.style.backgroundImage.slice(0, 30) : '', filter: on ? getComputedStyle(on).filter : '', bar: getComputedStyle(document.getElementById('sidebar')).backdropFilter };
    });
    await set('appearance.blend', 'blur');
    await set('appearance.blendBlur', 30);
    let b = await until(async () => { const v = await blur(); return v.blur && /data:image\/jpeg/.test(v.img) ? v : null; }, 6000, 'the blurred picture of the page');
    assert(/blur\(30px\)/.test(b.filter), 'not blurred 30 px: ' + b.filter);
    // A picture small enough that rows of text along the page's edge come out as their color, not as smudges.
    const size = await t.ui(() => new Promise((res) => { const on = document.querySelector('#backdrop > div.on'); const img = new Image(); img.onload = () => res([img.naturalWidth, img.naturalHeight]); img.onerror = () => res(null); img.src = on.style.backgroundImage.slice(5, -2); }));
    assert(size && size[0] <= 48, 'the picture behind the bars is ' + JSON.stringify(size) + ' px');
    await t.shot('behavior-blur-page');
    await open('bifrost://settings/', false);
    b = await until(async () => { const v = await blur(); return v.frosted ? v : null; }, 4000, 'frosted bars over Settings');
    assert(/blur\(30px\)/.test(b.bar), 'the sidebar isn’t frosted: ' + b.bar);
    await t.shot('behavior-blur-settings');
    // Back to the page: its picture is there at once (no half-second fade from the frosted look).
    const first = await t.ui(async () => {
      const S = window.__wbTest.state;
      const mine = S.tabs.filter((x) => x.workspaceId === S.activeWorkspaceId);
      const i = mine.findIndex((x) => x.url.includes('/dark.html'));
      window.__wbTest.command('tab' + (i + 1));
      await new Promise((r) => requestAnimationFrame(r));
      const on = document.querySelector('#backdrop > div.on');
      return { blur: document.documentElement.classList.contains('blend-blur'), opacity: on ? getComputedStyle(on).opacity : null, body: getComputedStyle(document.body).backgroundColor };
    });
    assert(first.blur && first.opacity === '1' && !/rgba\(.*, 0(\.\d+)?\)$/.test(first.body), 'switching back faded in: ' + JSON.stringify(first));
    await set('appearance.blend', 'window');
    await until(async () => { const v = await blur(); return !v.blur && !v.frosted ? v : null; }, 3000, 'the plain window again');
  });

  // ---------------------------------------------------------------- Settings → Launcher (from Waypoint)
  const L = (p, v) => set('launcher.' + p, v);
  const tabCount = async () => (await tabs()).length;
  const openL = async (text) => {
    await t.ui((text) => window.__wbTest.command('launcher', { text }), text);
    await t.until(() => document.querySelectorAll('.launcher .rrow').length || 0, null, 4000, 'the launcher’s results');
    await sleep(250);
  };
  const lOpen = () => t.ui(() => !!document.querySelector('.launcher-layer'));
  const firstTitle = () => t.ui(() => { const el = document.querySelector('.launcher .rrow.sel .r-title'); return el ? el.textContent : ''; });
  const shutL = async () => { if (await lOpen()) { await t.ui(() => { const q = document.querySelector('.launcher .l-q'); if (q) q.value = ''; }); await x.key('Escape'); await sleep(350); if (await lOpen()) { await x.key('Escape'); await sleep(350); } } };

  await R.step('launcher, Keys & behavior: Enter and Shift+Enter open where they’re set to, an open tab is jumped to (or not), Esc clears first, the typing delay', async () => {
    // "Wide things": in the history, not open.
    await open(site.url + '/wide.html', false); await sleep(1500);
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(600);
    await clickTab('/a.html');
    await L('enterAction', 'newtab');
    let n = await tabCount();
    await openL('Wide things');
    assert(/Wide things/.test(await firstTitle()), 'first result: ' + await firstTitle());
    await x.key('Return'); await sleep(1000);
    assert(await tabCount() === n + 1 && /wide\.html/.test(await activeUrl()), 'Enter → a new tab didn’t: ' + await activeUrl());
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
    await clickTab('/a.html');
    await L('shiftEnterAction', 'background');
    n = await tabCount();
    await openL('Wide things');
    await x.keyDown('Shift_L'); await x.key('Return'); await x.keyUp('Shift_L'); await sleep(1000);
    assert(await tabCount() === n + 1 && /\/a\.html/.test(await activeUrl()), 'Shift+Enter → a background tab didn’t: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
    // Wide things is open (in the background) now. Only its history result, which knows that tab:
    await L('enterAction', 'current');
    await L('sources.tabs.enabled', false);
    await openL('Wide things');
    const flagged = await t.ui(() => !!document.querySelector('.launcher .rrow.sel .r-flag'));
    n = await tabCount();
    await x.key('Return'); await sleep(900);
    assert(flagged && await tabCount() === n && /wide\.html/.test(await activeUrl()), 'didn’t jump to the open tab: ' + JSON.stringify({ flagged, url: await activeUrl() }));
    await clickTab('/a.html');
    await L('switchToOpenTab', false);
    await openL('Wide things');
    const flagged2 = await t.ui(() => !!document.querySelector('.launcher .rrow.sel .r-flag'));
    await x.key('Return'); await sleep(1200);
    const wides = (await tabs()).filter((tb) => /wide\.html/.test(tb.url)).length;
    assert(!flagged2 && wides === 2, 'with it off, it still jumped (or still says it would): ' + JSON.stringify({ flagged2, wides }));
    await t.ui(() => window.__wbTest.command('back'));
    await t.until(() => { const s = window.__wbTest.state; const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId); const tb = s.tabs.find((x) => x.id === w.activeTabId); return /\/a\.html/.test(tb.url); }, null, 5000, 'Page A again');
    await L('switchToOpenTab', true); await L('sources.tabs.enabled', true);
    await clickTab('/wide.html'); await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
    await clickTab('/a.html');
    // Esc clears the box first.
    await L('escClears', true);
    await openL('Wide');
    await t.ui(() => { window.__escLog = []; window.__escFn = (e) => { if (e.key === 'Escape') window.__escLog.push((e.target.id || e.target.tagName) + ' ' + JSON.stringify((document.querySelector('.launcher .l-q') || {}).value)); }; window.addEventListener('keydown', window.__escFn, true); });
    await x.key('Escape'); await sleep(300);
    const st = await t.ui(() => ({ open: !!document.querySelector('.launcher-layer'), q: (document.querySelector('.launcher .l-q') || {}).value }));
    assert(st.open && st.q === '', 'the first Esc: ' + JSON.stringify(st));
    await x.key('Escape');
    try { await t.until(() => !document.querySelector('.launcher-layer'), null, 2000, 'the second Esc to close it'); }
    catch (e) { throw new Error(e.message + ' ' + JSON.stringify(await t.ui(() => ({ log: window.__escLog, layers: document.querySelectorAll('.launcher-layer').length, focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName), q: (document.querySelector('.launcher .l-q') || {}).value })))); }
    finally { await t.ui(() => window.removeEventListener('keydown', window.__escFn, true)); }
    await L('escClears', false);
    await openL('Wide'); await x.key('Escape'); await sleep(350);
    assert(!(await lOpen()), 'with it off, Esc didn’t close it at once');
    // Typing delay: nothing until you pause.
    await L('typingDelayMs', 450);
    await openL('Page B');
    await t.ui(() => { const q = document.querySelector('.launcher .l-q'); q.value = 'Wide things'; q.dispatchEvent(new Event('input')); });
    await sleep(150);
    const early = await firstTitle();
    await sleep(800);
    const late = await firstTitle();
    assert(!/Wide/.test(early) && /Wide things/.test(late), 'typing delay: ' + JSON.stringify({ early, late }));
    await shutL();
    await L('typingDelayMs', 0);
    await L('shiftEnterAction', 'split');
  });

  await R.step('launcher, Sources: only this window’s tabs; how much history is searched instantly', async () => {
    const q = (raw) => t.ui((raw) => window.wb.invoke('search:query', { raw, activeWcId: null }).then((r) => r.items.filter((it) => it.type === 'tab').map((it) => it.url)), raw);
    const w2 = await t.main((_, u) => global.__bifrost.windows.create({ urls: [u] }).id, site.url + '/index.html');
    await sleep(3000);
    try {
      let urls = await q('Test home');
      assert(urls.some((u) => /index\.html/.test(u)), 'the other window’s tab isn’t found: ' + JSON.stringify(urls));
      await L('sources.tabs.currentWindowOnly', true);
      urls = await q('Test home');
      assert(!urls.some((u) => /index\.html/.test(u)), 'the other window’s tab is found with “only this window”: ' + JSON.stringify(urls));
      urls = await q('Page');
      assert(urls.some((u) => /\/a\.html/.test(u)), 'this window’s own tabs are gone: ' + JSON.stringify(urls));
    } finally {
      await L('sources.tabs.currentWindowOnly', false);
      await t.main((_, id) => { const c = global.__bifrost.registry.get(id); if (c && c.win && !c.win.isDestroyed()) c.win.destroy(); }, w2);
      await sleep(800);
      await t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui')); if (w) w.focus(); });
      await sleep(400);
    }
    const size = () => t.main(() => global.__bifrost.search.historySize);
    const profile = await t.main(() => global.__require('./perf').current().historyIndexSize);
    assert(await size() === profile, 'not the performance profile’s amount: ' + await size() + ' vs ' + profile);
    await L('historyIndex', 2000); await sleep(300);
    assert(await size() === 2000, 'History pages indexed 2,000: ' + await size());
    await L('historyIndex', 0); await sleep(300);
    assert(await size() === profile, 'back to the profile’s: ' + await size());
  });

  await R.step('launcher, Appearance: its own theme and accent, text size, density, corners, site icons and what rows show, and custom CSS for it alone', async () => {
    for (const [p, v] of [['theme', 'latte'], ['useCustomAccent', true], ['accent', '#ff8800'], ['fontSize', 17], ['density', 'compact'], ['radius', 3], ['showUrls', false], ['showBadges', false], ['favicons', 'none'], ['animations', false], ['customCss', '.title { color: rgb(1, 2, 3) }']]) await L(p, v);
    await openL('Page');
    const look = await t.ui(() => {
      const l = document.querySelector('.launcher-layer'); const p = l.querySelector('.launcher');
      const row = l.querySelector('.rrow[data-type="tab"], .rrow[data-type="history"]');
      return {
        scheme: l.dataset.scheme, accent: getComputedStyle(l).getPropertyValue('--accent').trim(), base: getComputedStyle(p).getPropertyValue('--base').trim(),
        bg: getComputedStyle(p).backgroundImage.slice(0, 80), fs: getComputedStyle(p).fontSize, radius: getComputedStyle(p).borderRadius, density: l.dataset.density, still: l.classList.contains('no-motion'),
        sub: row ? getComputedStyle(row.querySelector('.r-sub')).display : '', urls: row ? row.querySelectorAll('.r-url').length : -1, badges: l.querySelectorAll('.r-badge').length,
        imgs: l.querySelectorAll('.rrow[data-type="tab"] .r-ico img, .rrow[data-type="history"] .r-ico img').length, glyph: row ? !!row.querySelector('.r-ico > svg') : false,
        title: getComputedStyle(l.querySelector('.r-title')).color,
      };
    });
    assert(look.scheme === 'light' && look.base === '#eff1f5' && look.accent === '#ff8800' && /239, 241, 245|255, 255, 255/.test(look.bg), 'theme and accent: ' + JSON.stringify(look));
    assert(look.fs === '17px' && look.radius === '3px' && look.density === 'compact' && look.sub === 'none' && look.still, 'size, corners, density, motion: ' + JSON.stringify(look));
    assert(look.urls === 0 && look.badges === 0 && look.imgs === 0 && look.glyph, 'addresses, labels, icons: ' + JSON.stringify(look));
    assert(look.title === 'rgb(1, 2, 3)', 'custom CSS: ' + look.title);
    await t.shot('behavior-launcher-look');
    await shutL();
    // ...and the address bar's list (the same rows) keeps its own look.
    await t.ui(() => { const i = document.getElementById('address-input'); i.focus(); i.value = 'Page'; i.dispatchEvent(new Event('input')); });
    const drop = await t.until(() => { const d = document.querySelector('.omni-drop'); if (!d || !d.querySelector('.r-title')) return null; return { color: getComputedStyle(d.querySelector('.r-title')).color, urls: d.querySelectorAll('.r-url').length }; }, null, 4000, 'the address bar’s list');
    assert(drop.color !== 'rgb(1, 2, 3)' && drop.urls > 0, 'the launcher’s look leaked into the address bar: ' + JSON.stringify(drop));
    await x.key('Escape'); await x.key('Escape'); await sleep(300);
    // Site icons from a service.
    await L('favicons', 'google');
    await t.ui(() => { window.__imgs = []; window.__imgObs = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) for (const img of (n.tagName === 'IMG' ? [n] : n.querySelectorAll('img'))) window.__imgs.push(img.getAttribute('src')); }); window.__imgObs.observe(document.getElementById('overlay-root'), { childList: true, subtree: true }); });
    await openL('Wide things');
    const srcs = await t.ui(() => { window.__imgObs.disconnect(); return window.__imgs.slice(); });
    assert(srcs.some((u) => /^https:\/\/www\.google\.com\/s2\/favicons\?.*domain=127\.0\.0\.1/.test(u)), 'no icon from Google: ' + JSON.stringify(srcs));
    await shutL();
    for (const k of ['theme', 'useCustomAccent', 'accent', 'fontSize', 'density', 'radius', 'showUrls', 'showBadges', 'favicons', 'animations', 'customCss']) await L(k, (await t.main((_, k) => global.__require('../shared/defaults').DEFAULTS.launcher[k], k)));
  });

  await R.step('launcher, opening: as a centered window, and under its toolbar button', async () => {
    await L('openMode', 'window'); await L('windowHeight', 500);
    await openL('');
    let p = await t.ui(() => { const r = document.querySelector('.launcher').getBoundingClientRect(); return { cy: r.top + r.height / 2, h: r.height, H: innerHeight, back: getComputedStyle(document.querySelector('.launcher-back')).backgroundColor }; });
    assert(Math.abs(p.cy - p.H / 2) < 3 && Math.abs(p.h - 500) < 2 && p.back === 'rgba(0, 0, 0, 0)', 'not a centered window 500 px high: ' + JSON.stringify(p));
    await shutL();
    await L('openMode', 'overlay');
    const tb = await t.main(() => global.__bifrost.settings.get('appearance.toolbar'));
    await set('appearance.toolbar', tb.concat('launcher'));
    try {
      await L('toolbarButton', 'popup');
      const b = await t.until(() => { const el = document.querySelector('#toolbar [data-tb="launcher"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom, left: r.left, right: r.right }; }, null, 4000, 'the Launcher button');
      await x.click(b.x, b.y); await x.move(700, 600); await sleep(700);
      p = await t.ui(() => { const l = document.querySelector('.launcher-layer'); if (!l) return null; const r = l.querySelector('.launcher').getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, anchored: l.classList.contains('anchored') }; });
      assert(p && p.anchored && p.top >= b.bottom && p.top - b.bottom < 16 && (Math.abs(p.right - b.right) < 2 || Math.abs(p.left - b.left) < 2), 'not under the button: ' + JSON.stringify({ p, b }));
      await t.shot('behavior-launcher-popup');
      await shutL();
      await L('toolbarButton', 'same');
      await x.click(b.x, b.y); await x.move(700, 600); await sleep(700);
      p = await t.ui(() => { const l = document.querySelector('.launcher-layer'); return l ? { anchored: l.classList.contains('anchored') } : null; });
      assert(p && !p.anchored, 'with “like the shortcut” it opened under the button: ' + JSON.stringify(p));
      await shutL();
    } finally { await set('appearance.toolbar', tb); }
  });

  await R.step('launcher: the address bar without its results (“Results under the address bar” off)', async () => {
    const typeAddr = (v) => t.ui((v) => { const i = document.getElementById('address-input'); i.focus(); i.value = v; i.dispatchEvent(new Event('input')); }, v);
    await L('omnibox', false);
    await typeAddr('Page'); await sleep(1000);
    assert(!(await t.ui(() => !!document.querySelector('.omni-drop'))), 'the list showed with it off');
    await x.key('Escape'); await sleep(200);
    await L('omnibox', true);
    await typeAddr('Page');
    await t.until(() => !!document.querySelector('.omni-drop'), null, 4000, 'the list with it on');
    await x.key('Escape'); await x.key('Escape'); await sleep(300);
  });

  await R.step('Settings → Launcher → Backup: a Waypoint settings file comes in whole; the launcher’s settings export, and reset', async () => {
    const fixture = path.join(ROOT, 'tests', 'fixtures', 'waypoint-settings.json');
    const out = path.join(os.tmpdir(), 'bf-launcher-' + process.pid + '.json');
    fs.rmSync(out, { force: true });
    await t.main(({ dialog }, [fixture, out]) => {
      global.__dlg = { open: dialog.showOpenDialog, save: dialog.showSaveDialog };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
    }, [fixture, out]);
    const S = () => t.main(() => { const s = global.__bifrost.settings.get(); return { launcher: s.launcher, search: s.search, tabs: s.tabs }; });
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(200); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last).slice(0, 300) + ')'); };
    try {
      await open('bifrost://settings/#launcher-backup', false);
      await until(() => t.guest('bifrost://settings', "!!document.querySelector('[data-act=import]')"), 6000, 'Settings → Launcher → Backup');
      await t.guest('bifrost://settings', "document.querySelector('[data-act=import]').click(), 1");
      // (the settings arrive one after another: the launcher's, then the search engines)
      const s = await until(async () => { const v = await S(); const e = v.search.engines.find((x) => x.id === v.search.defaultEngine); return v.launcher.theme === 'tokyonight' && e && /kagi\.com/.test(e.url) ? v : null; }, 6000, 'Waypoint’s settings');
      const L2 = s.launcher;
      const engine = s.search.engines.find((e) => e.id === s.search.defaultEngine);
      const wrong = [];
      if (L2.enterAction !== 'newtab' || L2.shiftEnterAction !== 'background' || L2.openMode !== 'window' || L2.windowHeight !== 620) wrong.push('keys & behavior');
      if (L2.density !== 'compact' || L2.fontSize !== 16 || L2.accent !== '#ff8800' || L2.top !== 22 || L2.dim !== 0.5 || L2.blur !== false) wrong.push('appearance');
      if (L2.wMatch !== 1.25 || L2.historyIndex !== 6000 || L2.searchRowPosition !== 'bottom') wrong.push('ranking');
      if (!L2.sources.tabs.currentWindowOnly || L2.sources.bookmarks.weight !== 2.2 || L2.prefixes.bookmarks !== '!' || !L2.boosts.domains.some((d) => d.domain === 'github.com' && d.factor === 2)) wrong.push('sources');
      if (!engine || !/kagi\.com/.test(engine.url) || s.search.suggestionProvider !== 'duckduckgo' || !s.search.engines.some((e) => e.keyword === 'aw')) wrong.push('search engines');
      assert(!wrong.length, 'not imported: ' + wrong.join(', ') + ' ' + JSON.stringify(L2).slice(0, 400));
      const toasts = await t.guest('bifrost://settings', "[...document.querySelectorAll('.toast-text')].map((e) => e.textContent).join(' | ')");
      assert(/folders/i.test(toasts), 'no word about the bookmark folders: ' + toasts);
      await t.guest('bifrost://settings', "document.querySelector('[data-act=export]').click(), 1");
      const file = await until(() => { try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch { return null; } }, 5000, 'the exported file');
      assert(file.format === 'bifrost-launcher' && file.launcher.theme === 'tokyonight' && Array.isArray(file.search.engines), 'export: ' + JSON.stringify(file).slice(0, 200));
      await t.guest('bifrost://settings', "document.querySelector('[data-act=reset]').click(), 1");
      await until(() => t.guest('bifrost://settings', "(() => { const b = [...document.querySelectorAll('.dialog .btn')].find((x) => x.textContent.trim() === 'Reset'); if (b) b.click(); return !!b; })()"), 4000, 'the reset confirmation');
      const r = await until(async () => { const v = await S(); return v.launcher.theme === 'browser' ? v : null; }, 5000, 'the defaults');
      assert(r.launcher.openMode === 'overlay' && r.launcher.enterAction === 'current' && r.launcher.customCss === '' && r.search.engines.some((e) => /kagi\.com/.test(e.url)), 'reset: ' + JSON.stringify({ openMode: r.launcher.openMode, engines: r.search.engines.length }));
      await t.shot('behavior-launcher-settings');
    } finally {
      await t.main(({ dialog }) => { if (global.__dlg) { dialog.showOpenDialog = global.__dlg.open; dialog.showSaveDialog = global.__dlg.save; } });
      await t.main(() => { const s = global.__bifrost.settings; s.set('search.engines', global.__require('../shared/defaults').DEFAULTS.search.engines); s.set('search.defaultEngine', 'google'); s.set('search.suggestionProvider', 'google'); });
      fs.rmSync(out, { force: true });
      try { await clickTab('bifrost://settings'); await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400); } catch { /* not open */ }
    }
  });
} finally {
  x.close();
  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
