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
  // A page to visit and then remove from history from the launcher.
  '/forget.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Forget me soon</title><p>forget me</p>'); },
  // Three pages to bookmark, for the launcher's ranking.
  '/rank-alpha.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Alpha page</title><p>alpha</p>'); },
  '/rank-beta.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Beta page</title><p>beta</p>'); },
  '/rank-gamma.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Gamma page</title><p>gamma</p>'); },
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

  await R.step('…and stay shown as long as Settings → Downloads says (1 s, or until closed)', async () => {
    try {
      await set('downloads.askWhereToSave', false);
      await set('downloads.showOnStart', true);
      for (const [secs, stays] of [[1, false], [61, true]]) {
        await set('downloads.showOnStartFor', secs);
        await clickTab('/b.html');
        await x.move(30, 700);
        await t.guest('/b.html', `(() => { const a = document.createElement('a'); a.href = '/dl/file.zip?for=${secs}'; a.download = ''; document.body.append(a); a.click(); return 1; })()`);
        const end = Date.now() + 4000;
        let shown = false;
        while (Date.now() < end && !(shown = await t.ui(() => !!document.querySelector('.dl-popover')))) await sleep(100);
        assert(shown, `the downloads box didn't show (${secs} s)`);
        await sleep(2600);
        const still = await t.ui(() => !!document.querySelector('.dl-popover'));
        assert(still === stays, `set to ${secs > 60 ? 'until closed' : secs + ' s'}, the box ${still ? 'was still open' : 'had closed'} after 2.6 s`);
        await esc();
      }
    } finally { await set('downloads.showOnStartFor', 5); }
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
  // (a launcher fading out takes no input: closed)
  const lOpen = () => t.ui(() => !!document.querySelector('.launcher-layer:not(.closing)'));
  const DEF_L = await t.main(() => global.__require('../shared/defaults').DEFAULTS.launcher);
  // Back to the defaults, whatever a step changed (so one failing step can't spoil the next).
  const resetL = async (...keys) => { for (const k of keys) await L(k, DEF_L[k]); };
  const closeSettingsTabs = async () => {
    for (let i = 0; i < 4; i++) {
      const id = await t.ui(() => { const tb = window.__wbTest.state.tabs.find((x) => x.url.startsWith('bifrost://settings')); return tb ? tb.id : null; });
      if (!id) return;
      await t.ui((id) => { const S = window.__wbTest.state; const tb = S.tabs.find((x) => x.id === id); const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); if (w && tb) w.activeTabId = tb.id; window.__wbTest.command('closeTab'); }, id);
      await sleep(400);
    }
  };
  const firstTitle = () => t.ui(() => { const el = document.querySelector('.launcher .rrow.sel .r-title'); return el ? el.textContent : ''; });
  const shutL = async () => { if (await lOpen()) { await t.ui(() => { const q = document.querySelector('.launcher .l-q'); if (q) q.value = ''; }); await x.key('Escape'); await sleep(350); if (await lOpen()) { await x.key('Escape'); await sleep(350); } } };

  await R.step('launcher, Keys & behavior: Enter and Shift+Enter open where they’re set to, an open tab is jumped to (or not), Esc clears first, the typing delay', async () => {
   try {
    // "Wide things": in the history, not open.
    await open(site.url + '/wide.html', false); await sleep(1500);
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(600);
    await clickTab('/a.html');
    await L('open.enter', 'newtab');
    let n = await tabCount();
    await openL('Wide things');
    assert(/Wide things/.test(await firstTitle()), 'first result: ' + await firstTitle());
    await x.key('Return'); await sleep(1000);
    assert(await tabCount() === n + 1 && /wide\.html/.test(await activeUrl()), 'Enter → a new tab didn’t: ' + await activeUrl());
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
    await clickTab('/a.html');
    await L('open.shift', 'background');
    n = await tabCount();
    await openL('Wide things');
    await x.keyDown('Shift_L'); await x.key('Return'); await x.keyUp('Shift_L'); await sleep(1000);
    assert(await tabCount() === n + 1 && /\/a\.html/.test(await activeUrl()), 'Shift+Enter → a background tab didn’t: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
    // Wide things is open (in the background) now. Only its history result, which knows that tab:
    await L('open.enter', 'current');
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
   } finally {
    await shutL();
    await resetL('typingDelayMs', 'open', 'escClears', 'switchToOpenTab');
    await L('sources.tabs.enabled', true);
   }
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


  // ---------------------------------------------------------------- the launcher, polished (0.24.5)
  const splits = () => t.ui(() => { const S = window.__wbTest.state; return S.splits.filter((sp) => sp.tabIds.length).map((sp) => sp.tabIds.slice()); });
  const splitUrls = () => t.ui(() => { const S = window.__wbTest.state; return S.splits.filter((sp) => sp.tabIds.length).map((sp) => sp.tabIds.map((id) => S.tabs.find((x) => x.id === id).url.split('/').pop())); });
  const rowsNow = () => t.ui(() => [...document.querySelectorAll('.launcher .rrow')].map((r) => ({ type: r.dataset.type, tab: r.dataset.tab || null, title: r.querySelector('.r-title').textContent, sel: r.classList.contains('sel') })));
  const selIdx = () => t.ui(() => [...document.querySelectorAll('.launcher .rrow')].findIndex((r) => r.classList.contains('sel')));
  const active = () => t.ui(() => { const s = window.__wbTest.state; const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId); const tb = s.tabs.find((x) => x.id === w.activeTabId); return tb ? { id: tb.id, url: tb.url, title: tb.title } : null; });
  const backTo = async (part) => t.until((p) => { const s = window.__wbTest.state; const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId); const tb = s.tabs.find((x) => x.id === w.activeTabId); return tb && tb.url.includes(p); }, part, 5000, part + ' in front');
  // (the split view the tab in front is in)
  const unsplit = () => t.ui(() => window.__wbTest.command('unsplit'));
  const unsplitAll = async () => { for (let i = 0; i < 4 && (await splits()).length; i++) { const id = (await splits())[0][0]; await t.ui((id) => { const S = window.__wbTest.state; const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); w.activeTabId = id; window.__wbTest.command('unsplit'); }, id); await sleep(300); } };
  const closeAll = async (part) => { for (const tb of await tabs()) if (tb.url.includes(part)) { await t.ui((id) => { const S = window.__wbTest.state; const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); w.activeTabId = id; window.__wbTest.command('closeTab'); }, tb.id); await sleep(350); } };
  const pickTabs = (label) => t.until(() => { const rows = [...document.querySelectorAll('.launcher .rrow')]; return rows.length && rows.every((r) => r.dataset.type === 'tab') ? rows.map((r) => ({ tab: r.dataset.tab, title: r.querySelector('.r-title').textContent })) : null; }, null, 4000, label);

  await R.step('launcher: “Split view with a tab you pick” from the command palette: the pick splits, and nothing is left over the window', async () => {
    try {
      await clickTab('/a.html');
      const a = await active();
      const layers = () => t.ui(() => ({ n: document.querySelectorAll('.launcher-layer:not(.closing)').length, open: document.documentElement.classList.contains('launcher-open'), chip: (document.querySelector('.launcher .l-mode:not([hidden])') || {}).textContent || '' }));
      await openL('> split view with a tab you pick');
      assert(/Split view with a tab you pick/i.test(await firstTitle()), 'the command isn’t first: ' + await firstTitle());
      await x.key('Return');
      const pick = await pickTabs('the tabs to pick from');
      const st = await layers();
      assert(st.n === 1 && st.open && st.chip === 'Split view', 'the picker: ' + JSON.stringify(st));
      assert(!pick.some((r) => r.tab === a.id), 'the tab in front is offered: ' + JSON.stringify(pick));
      const i = pick.findIndex((r) => r.title === 'Page B');
      assert(i >= 0, 'Page B isn’t offered: ' + JSON.stringify(pick));
      for (let k = 0; k < i; k++) await x.key('Down');
      await x.key('Return');
      try { await t.until(() => !document.querySelector('.launcher-layer') && !document.documentElement.classList.contains('launcher-open'), null, 3000, 'the launcher gone after the pick'); }
      catch (e) { await t.shot('behavior-launcher-stuck'); throw e; }
      let sp = await splits();
      assert(sp.length === 1 && JSON.stringify(sp[0]) === JSON.stringify([a.id, pick[i].tab]), 'not split: ' + JSON.stringify({ sp, a: a.id, b: pick[i].tab }));
      // The window still answers: the launcher opens again, and closes.
      await openL('Page');
      await shutL();
      assert(!(await lOpen()), 'it didn’t close');
      // Picking with the mouse, from a tab in a split: the pick joins that split.
      await t.ui(() => window.__wbTest.command('splitPick'));
      const rows = await pickTabs('the tabs to pick from, again');
      assert(!rows.some((r) => sp[0].includes(r.tab)), 'tabs already in the split are offered: ' + JSON.stringify(rows));
      // (the last one offered: any tab will do)
      const c = await t.ui(() => { const el = [...document.querySelectorAll('.launcher .rrow')].pop(); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2, tab: el.dataset.tab }; });
      assert(c && c.tab, 'no tab offered: ' + JSON.stringify(rows));
      await x.click(c.x, c.y); await x.move(900, 700);
      await t.until(() => !document.querySelector('.launcher-layer'), null, 3000, 'the launcher gone after the click');
      sp = await splits();
      assert(sp.length === 1 && sp[0].length === 3 && sp[0].includes(c.tab), 'the click didn’t join the split: ' + JSON.stringify({ sp, colors: c.tab }));
      await t.shot('behavior-launcher-split3');
    } finally {
      await shutL();
      await unsplitAll();
    }
    assert((await splits()).length === 0, 'still split: ' + JSON.stringify(await splits()));
  });

  await R.step('launcher, Opening results (the defaults): Enter opens a new tab, Shift+Enter this tab, Ctrl+Enter beside this tab, in its split', async () => {
    try {
      assert(DEF_L.open.enter === 'newtab' && DEF_L.open.shift === 'current' && DEF_L.open.ctrl === 'split', 'the defaults: ' + JSON.stringify(DEF_L.open));
      assert(JSON.stringify(await t.main(() => global.__bifrost.settings.get('launcher.open'))) === JSON.stringify(DEF_L.open), 'not at the defaults');
      await closeAll('/wide.html');
      await clickTab('/a.html');
      let n = await tabCount();
      await openL('Wide things');
      const hints = await t.ui(() => [...document.querySelectorAll('.launcher .l-hints > span')].map((e) => e.textContent));
      assert(hints[0] === '↵New tab' && hints[1] === 'Shift+↵This tab' && hints[2] === 'Ctrl+↵Split view', 'the hints: ' + JSON.stringify(hints));
      await x.key('Return'); await sleep(1000);
      assert(await tabCount() === n + 1 && /wide\.html/.test(await activeUrl()), 'Enter: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
      await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
      await clickTab('/a.html');
      n = await tabCount();
      await openL('Wide things');
      await x.keyDown('Shift_L'); await x.key('Return'); await x.keyUp('Shift_L'); await sleep(1000);
      assert(await tabCount() === n && /wide\.html/.test(await activeUrl()), 'Shift+Enter: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
      await t.ui(() => window.__wbTest.command('back'));
      await backTo('/a.html');
      // Ctrl+Enter, from a tab that isn't split: the two side by side.
      n = await tabCount();
      await openL('Wide things');
      await x.keyDown('Control_L'); await x.key('Return'); await x.keyUp('Control_L'); await sleep(1200);
      let sp = await splitUrls();
      assert(await tabCount() === n + 1 && sp.length === 1 && JSON.stringify(sp[0]) === '["a.html","wide.html"]', 'Ctrl+Enter: ' + JSON.stringify(sp));
      assert(/wide\.html/.test(await activeUrl()), 'the new pane isn’t in front: ' + await activeUrl());
      // ...and from a tab in that split: into it, next to the tab (not a split of its own).
      await t.ui(() => window.__wbTest.command('focusPrevPane')); await sleep(400);
      await backTo('/a.html');
      await openL('Page B');
      await x.keyDown('Control_L'); await x.key('Return'); await x.keyUp('Control_L'); await sleep(1200);
      sp = await splitUrls();
      assert(sp.length === 1 && JSON.stringify(sp[0]) === '["a.html","b.html","wide.html"]', 'Ctrl+Enter in a split: ' + JSON.stringify(sp));
      await t.shot('behavior-launcher-ctrl-enter');
      await unsplitAll();
      await closeAll('/wide.html');
      // Ctrl+T (opening the launcher, as it does by default): Enter opens in the new tab, whatever Enter is set to.
      assert(await t.main(() => global.__bifrost.settings.get('tabs.newTabOpensLauncher')) === true, 'Ctrl+T doesn’t open the launcher');
      await clickTab('/a.html');
      n = await tabCount();
      await t.ui(() => window.__wbTest.command('newTab'));
      await t.until(() => !!document.querySelector('.launcher-layer:not(.closing) .l-q'), null, 3000, 'the launcher for a new tab');
      await t.ui(() => { const q = document.querySelector('.launcher .l-q'); q.value = 'Wide things'; q.dispatchEvent(new Event('input')); });
      await sleep(700);
      await x.key('Return'); await sleep(1000);
      assert(await tabCount() === n + 1 && /wide\.html/.test(await activeUrl()), 'Ctrl+T, Enter: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
      await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
      // Editing the page's address (Ctrl+L without an address bar): Enter goes there, in this tab.
      await clickTab('/a.html');
      n = await tabCount();
      await t.ui((u) => window.__wbTest.command('launcher', { mode: 'address', text: u }), site.url + '/wide.html');
      await t.until(() => document.querySelectorAll('.launcher .rrow').length || 0, null, 4000, 'results for the address');
      await sleep(300);
      await x.key('Return'); await sleep(1000);
      assert(await tabCount() === n && /wide\.html/.test(await activeUrl()), 'editing the address, Enter: ' + await activeUrl() + ', ' + (await tabCount()) + ' tabs');
      await t.ui(() => window.__wbTest.command('back'));
      await backTo('/a.html');
    } finally {
      await shutL();
      await unsplitAll();
      await closeAll('/wide.html');
    }
  });

  await R.step('launcher keys: Alt+1…9 (numbers shown while Alt is held), a key changed, Ctrl+Shift+C copies, Shift+Delete removes a history result', async () => {
    try {
      await clickTab('/a.html');
      const before = await active();
      await openL('Page'); await sleep(400);
      const rows = await rowsNow();
      assert(rows.length >= 2, 'rows: ' + JSON.stringify(rows));
      await x.keyDown('Alt_L'); await sleep(200);
      const nums = await t.ui(() => ({ on: document.querySelector('.launcher-layer').classList.contains('show-nums'), shown: [...document.querySelectorAll('.launcher .r-num')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent) }));
      await x.key('2'); await x.keyUp('Alt_L'); await sleep(1000);
      assert(nums.on && nums.shown[0] === '1' && nums.shown[1] === '2', 'the numbers: ' + JSON.stringify(nums));
      const now = await active();
      // (a tab result switches to that tab; anything else opens as Enter does: in a new tab)
      const want = rows[1].type === 'tab' ? now.id === rows[1].tab : now.id !== before.id && now.title === rows[1].title;
      assert(!(await lOpen()) && want, 'Alt+2 didn’t open the second result: ' + JSON.stringify({ now, want: rows[1] }));
      if (rows[1].type !== 'tab') { await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400); }
      await clickTab('/a.html');
      // Off: no numbers (and Alt+1…9 is left to the browser: switching spaces).
      await L('quickPick', 'none');
      await openL('Page'); await sleep(300);
      await x.keyDown('Alt_L'); await sleep(200);
      const off = await t.ui(() => ({ on: document.querySelector('.launcher-layer').classList.contains('show-nums'), nums: document.querySelectorAll('.launcher .r-num').length }));
      await x.keyUp('Alt_L');
      assert(!off.on && off.nums === 0, 'numbers with Quick open off: ' + JSON.stringify(off));
      await shutL();
      await resetL('quickPick');
      // "Next result": Ctrl+Shift+J only (Down doesn't move it any more).
      await L('keys.next', ['Ctrl+Shift+J']);
      await openL('Page'); await sleep(400);
      await x.key('Down'); await sleep(150);
      const afterDown = await selIdx();
      await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('j'); await x.keyUp('Shift_L'); await x.keyUp('Control_L'); await sleep(150);
      const afterJ = await selIdx();
      assert(afterDown === 0 && afterJ === 1, 'next: ' + JSON.stringify({ afterDown, afterJ }));
      await shutL();
      await L('keys.next', DEF_L.keys.next);
      // Copy the address.
      await t.main(({ clipboard }) => clipboard.writeText('nothing yet'));
      await openL('Page B'); await sleep(300);
      assert(/Page B/.test(await firstTitle()), 'first: ' + await firstTitle());
      await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('c'); await x.keyUp('Shift_L'); await x.keyUp('Control_L');
      await sleep(500);
      const copied = await t.main(({ clipboard }) => clipboard.readText());
      assert(/\/b\.html$/.test(copied) && !(await lOpen()), 'copy: ' + JSON.stringify({ copied, open: await lOpen() }));
      // Shift+Delete: out of history.
      await open(site.url + '/forget.html', false); await sleep(1500);
      await t.ui(() => window.__wbTest.command('closeTab')); await sleep(600);
      await clickTab('/a.html');
      const inHistory = () => t.ui(() => window.wb.invoke('search:more', { raw: 'Forget me soon', activeWcId: null }).then((r) => r.items.some((it) => it.type === 'history' && /forget\.html/.test(it.url))));
      assert(await inHistory(), 'the page isn’t in history to begin with');
      await openL('Forget me soon'); await sleep(400);
      const fr = await rowsNow();
      assert(fr[0] && fr[0].type === 'history' && /Forget me soon/.test(fr[0].title), 'first: ' + JSON.stringify(fr[0]));
      await x.keyDown('Shift_L'); await x.key('Delete'); await x.keyUp('Shift_L'); await sleep(900);
      const fr2 = await rowsNow();
      assert(await lOpen() && !fr2.some((r) => r.type === 'history' && /Forget me soon/.test(r.title)), 'still listed: ' + JSON.stringify(fr2));
      assert(!(await inHistory()), 'still in history');
    } finally {
      await shutL();
      await resetL('quickPick');
      await L('keys.next', DEF_L.keys.next);
    }
  });

  await R.step('launcher: Enter just after typing opens what’s typed (even with a typing delay); an Enter that ends an IME composition opens nothing', async () => {
    try {
      await clickTab('/a.html');
      await L('typingDelayMs', 400);
      await openL('Page B'); await sleep(300);
      const n = await tabCount();
      await t.ui(() => { const q = document.querySelector('.launcher .l-q'); q.value = 'Wide things'; q.dispatchEvent(new Event('input')); });
      await x.key('Return'); await sleep(1200);
      assert(await tabCount() === n + 1 && /wide\.html/.test(await activeUrl()), 'Enter opened what was there before: ' + await activeUrl());
      await t.ui(() => window.__wbTest.command('closeTab')); await sleep(500);
      await resetL('typingDelayMs');
      await clickTab('/a.html');
      await openL('Wide things'); await sleep(300);
      const n2 = await tabCount();
      await t.ui(() => document.querySelector('.launcher .l-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
      await sleep(700);
      assert(await lOpen() && await tabCount() === n2 && /\/a\.html/.test(await activeUrl()), 'the composition’s Enter opened something');
    } finally {
      await shutL();
      await resetL('typingDelayMs');
      await closeAll('/wide.html');
    }
  });

  await R.step('launcher, behavior and look: opens with what was typed last, wrap around, pointing selects, what matches, the clear button, switching to another app, staying open for background tabs', async () => {
    try {
      await clickTab('/a.html');
      // Opens with what you typed last (all selected), or empty.
      await L('rememberQuery', true);
      await openL('Wide'); await x.key('Escape'); await sleep(400);
      await t.ui(() => window.__wbTest.command('launcher')); await sleep(500);
      const rq = await t.ui(() => { const q = document.querySelector('.launcher .l-q'); return { v: q.value, s: q.selectionStart, e: q.selectionEnd }; });
      assert(rq.v === 'Wide' && rq.s === 0 && rq.e === 4, 'remembered: ' + JSON.stringify(rq));
      await x.key('Escape'); await sleep(400);
      await resetL('rememberQuery');
      await t.ui(() => window.__wbTest.command('launcher')); await sleep(500);
      assert(await t.ui(() => document.querySelector('.launcher-layer:not(.closing) .l-q').value) === '', 'with it off it isn’t empty');
      await shutL();
      // Wrap around.
      await openL('Page'); await sleep(500);
      await x.key('Up'); await sleep(150);
      let rows = await rowsNow();
      assert(rows.length > 2 && rows[rows.length - 1].sel, 'Up from the first, wrapping: ' + JSON.stringify(rows.map((r) => r.sel)));
      await shutL();
      await L('wrap', false);
      await openL('Page'); await sleep(500);
      await x.key('Up'); await sleep(150);
      assert(await selIdx() === 0, 'Up from the first without wrapping: ' + await selIdx());
      await x.keyDown('Control_L'); await x.key('End'); await x.keyUp('Control_L'); await sleep(150);
      rows = await rowsNow();
      const last = rows.length - 1;
      assert(rows[last].sel, 'Ctrl+End: ' + await selIdx());
      await x.key('Down'); await sleep(150);
      assert(await selIdx() === last, 'Down from the last without wrapping: ' + await selIdx());
      await shutL();
      await resetL('wrap');
      // Pointing at a result selects it (or doesn't).
      for (const on of [true, false]) {
        await L('hoverSelects', on);
        await openL('Page'); await sleep(500);
        const r = await t.ui(() => { const el = document.querySelectorAll('.launcher .rrow')[1]; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
        await x.move(r.x, r.y); await sleep(60); await x.move(r.x + 6, r.y + 1); await sleep(250);
        const i = await selIdx();
        assert(on ? i === 1 : i === 0, `pointing ${on ? 'on' : 'off'}: ${i}`);
        await x.move(900, 860); await sleep(100);
        await shutL();
      }
      await resetL('hoverSelects');
      // What matches: in the accent, bold, or not marked.
      const mark = () => t.ui(() => { const m = document.querySelector('.launcher .r-title mark'); if (!m) return null; const ti = m.closest('.r-title'); const a = getComputedStyle(m), b = getComputedStyle(ti); return { c: a.color, tc: b.color, w: a.fontWeight, tw: b.fontWeight, bg: a.backgroundImage }; });
      const looks = {};
      for (const hl of ['accent', 'bold', 'none']) { await L('highlight', hl); await openL('Page'); await sleep(300); looks[hl] = await mark(); await shutL(); }
      await resetL('highlight');
      const { accent: acc, bold, none } = looks;
      assert(acc && (acc.c !== acc.tc || acc.bg !== 'none'), 'in the accent: ' + JSON.stringify(acc));
      assert(bold && bold.c === bold.tc && bold.bg === 'none' && Number(bold.w) >= 700, 'bold: ' + JSON.stringify(bold));
      assert(none && none.c === none.tc && none.bg === 'none' && none.w === none.tw, 'not marked: ' + JSON.stringify(none));
      // The clear button.
      await openL('Wide');
      const cb = await t.ui(() => { const b = document.querySelector('.launcher .l-clear'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      assert(!cb.hidden, 'no clear button');
      await x.click(cb.x, cb.y); await sleep(400);
      const after = await t.ui(() => ({ v: document.querySelector('.launcher .l-q').value, focus: document.activeElement && document.activeElement.id, hidden: document.querySelector('.launcher .l-clear').hidden, open: !!document.querySelector('.launcher-layer:not(.closing)') }));
      assert(after.open && after.v === '' && after.focus === 'q' && after.hidden, 'clearing: ' + JSON.stringify(after));
      await shutL();
      await L('clearButton', false);
      await openL('Wide');
      assert(await t.ui(() => document.querySelector('.launcher .l-clear').hidden), 'the button shows with it off');
      await shutL();
      await resetL('clearButton');
      // Another app (here: another window) taking the focus: it stays, or with the setting on, closes.
      const away = async () => {
        const id = await t.main((_, u) => global.__bifrost.windows.create({ urls: [u] }).id, site.url + '/b.html');
        await sleep(2000);
        const still = await lOpen();
        await t.main((_, id) => { const c = global.__bifrost.registry.get(id); if (c && c.win && !c.win.isDestroyed()) c.win.destroy(); }, id);
        await sleep(600);
        await t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui')); if (w) w.focus(); });
        await sleep(500);
        return still;
      };
      await openL('Wide');
      assert(await away(), 'it closed when another window took the focus');
      await shutL();
      await L('closeOnBlur', true);
      await openL('Wide');
      assert(!(await away()), 'with “Close it when you switch to another app” on, it stayed');
      await resetL('closeOnBlur');
      await shutL();
      // A middle-click opens in a background tab; with "Stay open…", the launcher stays for the next one.
      await clickTab('/a.html');
      for (const stay of [false, true]) {
        await L('backgroundStaysOpen', stay);
        const n = await tabCount();
        await openL('Wide things'); await sleep(300);
        const r = await t.ui(() => { const el = document.querySelector('.launcher .rrow'); const b = el.getBoundingClientRect(); return { x: b.x + 80, y: b.y + b.height / 2 }; });
        await x.click(r.x, r.y, 2); await sleep(900);
        const st = { tabs: await tabCount(), open: await lOpen(), url: await activeUrl() };
        assert(st.tabs === n + 1 && /\/a\.html/.test(st.url) && st.open === stay, `middle-click (stay open ${stay}): ` + JSON.stringify(st));
        if (stay) assert(await t.ui(() => document.activeElement && document.activeElement.id === 'q'), 'the box lost the keyboard');
        await shutL();
        await closeAll('/wide.html');
        await clickTab('/a.html');
      }
    } finally {
      await shutL();
      await resetL('rememberQuery', 'wrap', 'hoverSelects', 'highlight', 'clearButton', 'closeOnBlur', 'backgroundStaysOpen');
      await closeAll('/wide.html');
    }
  });

  await R.step('Settings → Launcher: Opening results and the launcher’s keys, changed there', async () => {
    const guest = (js) => t.guest('bifrost://settings', js);
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(200); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    try {
      await closeSettingsTabs();
      await open('bifrost://settings/#launcher-open', false);
      await until(() => guest("!!document.querySelector('[data-path=\"launcher.open.ctrlAlt\"] select') && !!document.querySelector('.kb-row[data-act=clear] .kb-add')"), 8000, 'Opening results and the keys');
      const opts = await guest("[...document.querySelectorAll('[data-path=\"launcher.open.enter\"] option')].map((o) => o.value)");
      assert(['current', 'newtab', 'background', 'split', 'window', 'private', 'copy', 'web', 'none'].every((v) => opts.includes(v)), 'Enter offers: ' + JSON.stringify(opts));
      await guest("(() => { const s = document.querySelector('[data-path=\"launcher.open.alt\"] select'); s.value = 'copy'; s.dispatchEvent(new Event('change')); return 1; })()");
      await until(async () => (await t.main(() => global.__bifrost.settings.get('launcher.open.alt'))) === 'copy', 3000, 'Alt+Enter → copy');
      // Record a key for "Clear the box": a real click on + Add, then real keys.
      const view = await t.ui(() => { const v = document.querySelector('webview.active, #views webview:not([hidden])'); const r = v.getBoundingClientRect(); return { x: r.x, y: r.y }; });
      await guest("(() => { document.querySelector('.kb-row[data-act=clear] .kb-add').scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()");
      await sleep(500);
      const btn = await guest("(() => { const r = document.querySelector('.kb-row[data-act=clear] .kb-add').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, H: innerHeight }; })()");
      await x.click(view.x + btn.x, view.y + btn.y); await sleep(300);
      if (!(await guest("document.querySelector('.kb-row[data-act=clear] .kb-add').classList.contains('recording')"))) {
        await t.shot('behavior-launcher-keys-norec');
        throw new Error('not recording: ' + JSON.stringify({ view, btn, at: await guest(`(() => { const e = document.elementFromPoint(${btn.x}, ${btn.y}); return e ? e.outerHTML.slice(0, 120) : null; })()`) }));
      }
      // Enter can't be one (it's Opening results); a plain letter can't either; Ctrl+Shift+Y can.
      await x.key('Return'); await sleep(300);
      await x.key('y'); await sleep(300);
      await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('y'); await x.keyUp('Shift_L'); await x.keyUp('Control_L');
      const keys = await until(async () => { const k = await t.main(() => global.__bifrost.settings.get('launcher.keys.clear')); return k && k.length ? k : null; }, 3000, 'the new key');
      assert(JSON.stringify(keys) === '["Ctrl+Shift+Y"]', 'recorded: ' + JSON.stringify(keys));
      const chip = await until(() => guest("(() => { const c = document.querySelector('.kb-row[data-act=clear] .kb-chip'); return c ? c.textContent : null; })()"), 3000, 'the key shown');
      assert(/Ctrl\+Shift\+Y/.test(chip), 'shown: ' + chip);
      await t.shot('behavior-launcher-keys-settings');
      // And it works in the launcher: Ctrl+Shift+Y empties the box.
      await clickTab('/a.html');
      await openL('Wide'); await sleep(200);
      await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('y'); await x.keyUp('Shift_L'); await x.keyUp('Control_L'); await sleep(300);
      const v = await t.ui(() => ({ v: document.querySelector('.launcher .l-q').value, open: !!document.querySelector('.launcher-layer:not(.closing)') }));
      assert(v.open && v.v === '', 'Ctrl+Shift+Y: ' + JSON.stringify(v));
      // Alt+Enter copies now.
      await t.main(({ clipboard }) => clipboard.writeText('nothing yet'));
      await t.ui(() => { const q = document.querySelector('.launcher .l-q'); q.value = 'Page B'; q.dispatchEvent(new Event('input')); }); await sleep(700);
      await x.keyDown('Alt_L'); await x.key('Return'); await x.keyUp('Alt_L'); await sleep(500);
      assert(/\/b\.html$/.test(await t.main(({ clipboard }) => clipboard.readText())), 'Alt+Enter didn’t copy');
    } finally {
      await shutL();
      await L('open', DEF_L.open);
      await L('keys', DEF_L.keys);
      await closeSettingsTabs();
    }
  });

  await R.step('launcher, Ranking: the bookmark you use more comes first, and what you open for what you type comes first for it', async () => {
    const rows = async (text) => { await openL(text); await sleep(300); const r = await rowsNow(); await shutL(); return r.filter((x) => x.type === 'bookmark').map((x) => x.title); };
    const ids = await t.main((_, base) => {
      const db = global.__bifrost.db;
      return ['alpha', 'beta', 'gamma'].map((n) => db.createBookmark({ title: 'Docs ' + n, url: `${base}/rank-${n}.html` }).id);
    }, site.url);
    try {
      await clickTab('/a.html');
      // Nothing to go on yet: all three, in no particular order.
      const first = await rows('docs');
      assert(first.length === 3, 'bookmarks found: ' + JSON.stringify(first));
      // Use gamma: four visits (tabs opened and closed).
      for (let i = 0; i < 4; i++) { await open(site.url + '/rank-gamma.html?v=' + i, true); await sleep(500); }
      await sleep(600);
      await closeAll('/rank-gamma.html');
      await clickTab('/a.html');
      let o = await rows('docs');
      assert(o[0] === 'Docs gamma', 'the used one isn’t first: ' + JSON.stringify(o));
      // Open alpha from the launcher three times, typing "docs": it comes first for "docs" (and "doc")…
      for (let i = 0; i < 3; i++) {
        await openL('docs'); await sleep(300);
        const r = await rowsNow();
        const k = r.findIndex((x) => x.title === 'Docs alpha');
        assert(k >= 0, 'alpha isn’t listed: ' + JSON.stringify(r));
        for (let j = 0; j < k; j++) await x.key('Down');
        await x.key('Return'); await sleep(900);
        assert(/rank-alpha\.html/.test(await activeUrl()), 'alpha didn’t open: ' + await activeUrl());
        await closeAll('/rank-alpha.html');
        await clickTab('/a.html');
      }
      o = await rows('docs');
      assert(o[0] === 'Docs alpha', 'what was opened for “docs” isn’t first: ' + JSON.stringify(o));
      o = await rows('doc');
      assert(o[0] === 'Docs alpha', 'for “doc”: ' + JSON.stringify(o));
      // It's kept (with the profile)…
      await sleep(1800);
      const kept = await t.main(() => JSON.stringify(global.__bifrost.db.kvGet('launcherPicks', null) || {}));
      assert(/rank-alpha/.test(kept) && /"docs"/.test(kept), 'not kept: ' + kept.slice(0, 200));
      // …off with Learn from what you open (gamma's visits decide again)…
      await L('learnPicks', false);
      o = await rows('docs');
      assert(o[0] === 'Docs gamma', 'with learning off: ' + JSON.stringify(o));
      await resetL('learnPicks');
      // …and forgotten with "Forget what it learned".
      await t.main(() => global.__bifrost.search.forgetPicks());
      o = await rows('docs');
      assert(o[0] === 'Docs gamma', 'after forgetting: ' + JSON.stringify(o));
    } finally {
      await shutL();
      await resetL('learnPicks');
      await t.main((_, ids) => { for (const id of ids) { try { global.__bifrost.db.removeBookmark(id); } catch { /* gone */ } } }, ids);
      await closeAll('/rank-');
    }
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
      await closeSettingsTabs();
      await open('bifrost://settings/#launcher-backup', false);
      await until(() => t.guest('bifrost://settings', "!!document.querySelector('[data-act=import]')"), 6000, 'Settings → Launcher → Backup');
      await t.guest('bifrost://settings', "document.querySelector('[data-act=import]').click(), 1");
      // (the settings arrive one after another: the launcher's, then the search engines)
      const s = await until(async () => { const v = await S(); const e = v.search.engines.find((x) => x.id === v.search.defaultEngine); return v.launcher.theme === 'tokyonight' && e && /kagi\.com/.test(e.url) ? v : null; }, 6000, 'Waypoint’s settings');
      const L2 = s.launcher;
      const engine = s.search.engines.find((e) => e.id === s.search.defaultEngine);
      const wrong = [];
      if (L2.open.enter !== 'newtab' || L2.open.shift !== 'background' || L2.openMode !== 'window' || L2.windowHeight !== 620) wrong.push('keys & behavior');
      if (L2.density !== 'compact' || L2.fontSize !== 16 || L2.accent !== '#ff8800' || L2.top !== 22 || L2.dim !== 0.5 || L2.blur !== false) wrong.push('appearance');
      if (L2.wMatch !== 1.25 || L2.historyIndex !== 6000 || L2.searchRowPosition !== 'bottom') wrong.push('ranking');
      if (!L2.sources.tabs.currentWindowOnly || L2.sources.bookmarks.weight !== 2.2 || L2.prefixes.bookmarks !== '!' || !L2.boosts.domains.some((d) => d.domain === 'github.com' && d.factor === 2)) wrong.push('sources');
      if (!engine || !/kagi\.com/.test(engine.url) || s.search.suggestionProvider !== 'duckduckgo' || !s.search.engines.some((e) => e.keyword === 'aw')) wrong.push('search engines');
      assert(!wrong.length, 'not imported: ' + wrong.join(', ') + ' ' + JSON.stringify(L2).slice(0, 400));
      // (the notes come once everything is in)
      const toasts = await until(async () => { const v = await t.guest('bifrost://settings', "[...document.querySelectorAll('.toast-text')].map((e) => e.textContent).join(' | ')"); return /folders/i.test(v) ? v : null; }, 5000, 'a word about the bookmark folders');
      assert(/folders/i.test(toasts), 'no word about the bookmark folders: ' + toasts);
      await t.guest('bifrost://settings', "document.querySelector('[data-act=export]').click(), 1");
      const file = await until(() => { try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch { return null; } }, 5000, 'the exported file');
      assert(file.format === 'bifrost-launcher' && file.launcher.theme === 'tokyonight' && Array.isArray(file.search.engines), 'export: ' + JSON.stringify(file).slice(0, 200));
      await t.guest('bifrost://settings', "document.querySelector('[data-act=reset]').click(), 1");
      await until(() => t.guest('bifrost://settings', "(() => { const b = [...document.querySelectorAll('.dialog .btn')].find((x) => x.textContent.trim() === 'Reset'); if (b) b.click(); return !!b; })()"), 4000, 'the reset confirmation');
      const r = await until(async () => { const v = await S(); return v.launcher.theme === 'browser' ? v : null; }, 5000, 'the defaults');
      const DEF = await t.main(() => global.__require('../shared/defaults').DEFAULTS.launcher);
      assert(r.launcher.openMode === 'overlay' && JSON.stringify(r.launcher.open) === JSON.stringify(DEF.open) && JSON.stringify(r.launcher.keys) === JSON.stringify(DEF.keys) && r.launcher.customCss === '' && r.search.engines.some((e) => /kagi\.com/.test(e.url)), 'reset: ' + JSON.stringify({ openMode: r.launcher.openMode, open: r.launcher.open, engines: r.search.engines.length }));
      await t.shot('behavior-launcher-settings');
    } finally {
      await t.main(({ dialog }) => { if (global.__dlg) { dialog.showOpenDialog = global.__dlg.open; dialog.showSaveDialog = global.__dlg.save; } });
      await t.main(() => { const s = global.__bifrost.settings; s.set('search.engines', global.__require('../shared/defaults').DEFAULTS.search.engines); s.set('search.defaultEngine', 'google'); s.set('search.suggestionProvider', 'google'); });
      fs.rmSync(out, { force: true });
      try { await clickTab('bifrost://settings'); await t.ui(() => window.__wbTest.command('closeTab')); await sleep(400); } catch { /* not open */ }
    }
  });

  await R.step('Settings opens with the section you see and builds the rest right after; a search, or an address further down, finds it at once', async () => {
    const guest = (js) => t.guest('bifrost://settings', js);
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    try {
      await closeSettingsTabs();
      // Opened as it is: the first section, then every one of them, filled in.
      await open('bifrost://settings/', false);
      await until(() => guest("!!document.querySelector('#appearance .group')"), 8000, 'the first section');
      const n = await until(() => guest("(() => { const s = [...document.querySelectorAll('.section')]; return s.length > 10 && s.every((x) => x.querySelector('.group')) && s.length; })()"), 5000, 'every section filled in');
      const rows = await guest("document.querySelectorAll('.srow[data-path]').length");
      assert(rows > 150, `${n} sections, but only ${rows} settings`);
      await closeSettingsTabs();
      // A search finds what's at the bottom of the page.
      await open('bifrost://settings/', false);
      await until(() => guest("!!document.querySelector('#appearance .group')"), 8000, 'the page');
      await guest("(() => { const q = document.getElementById('settings-q'); q.value = 'download updates'; q.dispatchEvent(new Event('input')); return 1; })()");
      await until(() => guest("(() => { const r = document.querySelector('[data-path=\"updates.auto\"]'); return !!r && !r.closest('[hidden]') && !document.querySelector('[data-path=\"appearance.density\"]:not([hidden])'); })()"), 3000, 'only the Updates row');
      await closeSettingsTabs();
      // Opened at a group near the bottom: it's built and at the top of the window.
      await open('bifrost://settings/#sync-devices', false);
      await until(() => guest("(() => { const g = document.getElementById('sync-devices'); if (!g) return null; const y = g.querySelector('.card-title').getBoundingClientRect().top; return Math.abs(y - 90) < 4 ? y : null; })()"), 6000, 'Sync → its computers at the top');
    } finally { await closeSettingsTabs(); }
  });
} finally {
  x.close();
  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
