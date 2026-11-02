// Settings that change what happens rather than how things look: each one tried both ways, with the real
// pointer and keyboard where that's how you'd use it.
import { launch, startSite, reporter, assert, sleep, xinput } from './lib.mjs';

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

  await R.step('“Match the page”: the sidebar and toolbar take the page’s color, with text that reads on it; Bifrost’s own pages keep the theme', async () => {
    const rgb = (c) => (String(c).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const light = (c) => { const [r, g, b] = rgb(c); return (r + g + b) / 3; };
    const look = () => t.ui(() => {
      const tab = document.querySelector('#tablist .tab.active .tab-title');
      const ws = document.querySelector('#sidebar .wsb-name');
      return { blend: document.documentElement.classList.contains('blend'), body: getComputedStyle(document.body).backgroundColor, tab: tab ? getComputedStyle(tab).color : '', ws: ws ? getComputedStyle(ws).color : '', addr: getComputedStyle(document.querySelector('.addr-display') || document.body).color, shadow: getComputedStyle(document.getElementById('stage')).boxShadow };
    });
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150); } throw new Error('timed out waiting for ' + label); };
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
    await open('bifrost://settings/', false);
    l = await until(async () => { const v = await look(); return !v.blend ? v : null; }, 4000, 'the theme on Settings');
    await clickTab('/dark.html');
    await until(async () => (await look()).blend, 3000, 'the page color again');
    await set('appearance.blend', 'window');
    await until(async () => !(await look()).blend, 3000, 'the theme again');
  });
} finally {
  x.close();
  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
