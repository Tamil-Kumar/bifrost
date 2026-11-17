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
  // A mid steel blue page, and one whose left edge is a dark picture fading into it (as tabroom.com's is), with
  // an orange icon: the bars on these were mid-tone, and the icons in them couldn't be told from them.
  '/steel.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Steel</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%23d97757%22/%3E%3C/svg%3E"><style>html,body{margin:0;min-height:100%}body{background:#365d7e;color:#fff;font:20px sans-serif}</style><p style="margin:60px">Steel blue</p>'); },
  '/fading.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Fading</title><style>html,body{margin:0;min-height:100%}body{background:linear-gradient(180deg,#22384b 0,#2c4457 25%,#3a5a77 55%,#4a7ca4 78%,#5d9ace 100%) fixed;color:#fff;font:20px sans-serif}</style><p style="margin:60px">Fading</p>'); },
  // Links, for opening in a new tab.
  '/links.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Links</title><body style="font:22px sans-serif;margin:40px"><p><a id=l href="/b.html?ln">A link</a></p><p><a id=blank href="/b.html?lb" target="_blank">A link that opens a tab</a></p>'); },
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

  await R.step('a link opened in a new tab (Ctrl+click, middle-click) opens behind; with “Switch to links you open in a new tab”, in front, and Ctrl+Shift+click behind; a link that opens a tab by itself comes to the front either way', async () => {
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(120); } throw new Error('timed out waiting for ' + label); };
    const view = () => t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => e.getBoundingClientRect().width > 50 && getComputedStyle(e).visibility !== 'hidden'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    // Points the link at a new address (so each case's tab can be told apart), and says where it is on screen.
    const aim = async (id, q) => {
      const r = await t.guest('/links.html', `(() => { const a = document.getElementById(${JSON.stringify(id)}); a.href = '/b.html?${q}'; const r = a.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; })()`);
      const v = await view();
      return { x: v.x + r.x, y: v.y + r.y };
    };
    const opened = (q) => until(async () => (await tabs()).some((tb) => tb.url.endsWith('?' + q)), 4000, 'a tab for ?' + q);
    const back = async (q) => {
      await t.main(({ webContents }, q) => { const ctl = global.__bifrost.registry.lastFocused(); for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && wc.getType() === 'webview' && wc.getURL().endsWith('?' + q)) ctl.send('extension-tab-action', { wcId: wc.id, action: 'close' }); }, q);
      await sleep(400);
      if (!/\/links\.html$/.test(await activeUrl())) await clickTab('/links.html');
      await sleep(200);
    };
    const ctrlClick = async (p, shift = false) => { await x.keyDown('Control_L'); if (shift) await x.keyDown('Shift_L'); await sleep(60); await x.click(p.x, p.y); await sleep(60); if (shift) await x.keyUp('Shift_L'); await x.keyUp('Control_L'); };
    const check = async (q, wantFront, how) => {
      await opened(q);
      await sleep(500);
      const on = await activeUrl();
      assert(wantFront ? on.endsWith('?' + q) : /\/links\.html$/.test(on), `${how}: on ${on}, not ${wantFront ? 'the new tab' : 'the page with the link'}`);
      await back(q);
    };
    try {
      await open(site.url + '/links.html', false); await sleep(1300);
      // Off (as in Chrome).
      await set('tabs.switchToNewTabs', false);
      await ctrlClick(await aim('l', 'off-ctrl'));
      await check('off-ctrl', false, 'off, Ctrl+click');
      await ctrlClick(await aim('l', 'off-ctrlshift'), true);
      await check('off-ctrlshift', true, 'off, Ctrl+Shift+click');
      // On (as in Firefox).
      await set('tabs.switchToNewTabs', true);
      await ctrlClick(await aim('l', 'on-ctrl'));
      await check('on-ctrl', true, 'on, Ctrl+click');
      let p = await aim('l', 'on-middle');
      await x.click(p.x, p.y, 2);
      await check('on-middle', true, 'on, middle-click');
      await ctrlClick(await aim('l', 'on-ctrlshift'), true);
      await check('on-ctrlshift', false, 'on, Ctrl+Shift+click');
      p = await aim('blank', 'on-blank');
      await x.click(p.x, p.y);
      await check('on-blank', true, 'on, a link that opens a tab by itself');
      // …and its menu's Open link in new tab.
      p = await aim('l', 'on-menu');
      await x.click(p.x, p.y, 3);
      const item = await until(() => t.ui(() => { const e = [...document.querySelectorAll('.menu [role="menuitem"]')].find((m) => /^Open link in new tab/.test(m.textContent.trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 3000, 'the link’s menu');
      await sleep(300);
      const item2 = await t.ui(() => { const e = [...document.querySelectorAll('.menu [role="menuitem"]')].find((m) => /^Open link in new tab/.test(m.textContent.trim())); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await x.click((item2 || item).x, (item2 || item).y);
      await check('on-menu', true, 'on, Open link in new tab');
    } finally {
      await set('tabs.switchToNewTabs', false);
      try { await x.keyUp('Shift_L'); await x.keyUp('Control_L'); } catch { /* up */ }
    }
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

  await R.step('…and stay shown as long as Settings → Downloads says (1 s, or until closed), each download that starts while it’s open starting that over', async () => {
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
        const why = still === stays ? '' : JSON.stringify(await t.ui(() => { const p = document.querySelector('.dl-popover'); const r = p && p.getBoundingClientRect(); return { box: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], hover: !!(p && p.matches(':hover')), focus: document.activeElement && document.activeElement.className, layout: document.documentElement.dataset.layout, popovers: document.querySelectorAll('.popover, .menu').length }; }));
        if (why) await t.shot('behavior-dlbox-' + secs);
        assert(still === stays, `set to ${secs > 60 ? 'until closed' : secs + ' s'}, the box ${still ? 'was still open' : 'had closed'} after 2.6 s ${why}`);
        if (!stays) await esc();
      }
      // Open until closed (above), and another download starts with it set to 1 s: it goes 1 s after that one.
      await set('downloads.showOnStartFor', 1);
      await t.guest('/b.html', `(() => { const a = document.createElement('a'); a.href = '/dl/file.zip?again'; a.download = ''; document.body.append(a); a.click(); return 1; })()`);
      await sleep(2600);
      assert(!(await t.ui(() => !!document.querySelector('.dl-popover'))), 'a download that started while it was open didn’t start its time over');
    } finally { await set('downloads.showOnStartFor', 5); await esc(); }
  });

  await R.step('the downloads box: its close button closes it (opened by itself, kept until closed, or from its button); one that opens under a resting pointer goes on time, even when the pointer then goes back to the page; the pointer moved onto it holds it, and its time starts over when it leaves', async () => {
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    const box = () => t.ui(() => { const p = document.querySelector('.dl-popover'); if (!p) return null; const r = p.getBoundingClientRect(), c = p.querySelector('.dl-close').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, close: { x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) } }; });
    // (the window's content is at the screen's top left)
    const screenOf = () => t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui')); const b = w.getContentBounds(); return { x: b.x, y: b.y }; });
    const shownFor = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (!(await box())) return false; await sleep(100); } return true; };
    const gone = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (!(await box())) return true; await sleep(100); } return false; };
    // (the tab on screen: other tabs have the same page)
    let shown = null;
    const inPage = (code) => t.main(({ webContents }, [id, code]) => webContents.fromId(id).executeJavaScript(code, true), [shown, code]);
    const download = (tag) => inPage(`(() => { const a = document.createElement('a'); a.href = '/dl/file.zip?${tag}'; a.download = ''; document.body.append(a); a.click(); a.remove(); return 1; })()`);
    try {
      await set('downloads.askWhereToSave', false);
      await set('downloads.showOnStart', true);
      await clickTab('/b.html');
      shown = await t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); return S.tabs.find((y) => y.id === ws.activeTabId).wcId; });
      const win = await screenOf();
      // Kept until closed: its close button.
      await set('downloads.showOnStartFor', 61);
      await x.move(30, 700);
      await download('close');
      let b = await until(box, 4000, 'the downloads box');
      assert(await shownFor(1500), 'set to stay until closed, it closed by itself');
      await x.click(win.x + b.close.x, win.y + b.close.y);
      assert(await gone(800), 'its close button didn’t close it');
      // Opened from its button: the same.
      await x.move(30, 700);
      const btn = await t.ui(() => { const el = [...document.querySelectorAll('[data-tb="downloads"]')].find((e) => e.offsetParent); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
      await x.click(win.x + btn.x, win.y + btn.y);
      b = await until(box, 3000, 'the downloads box, from its button');
      await x.click(win.x + b.close.x, win.y + b.close.y);
      assert(await gone(800), 'its close button didn’t close it (opened from its button)');
      // A link in the page under where the box opens (its middle, a little below its top).
      await set('downloads.showOnStartFor', 2);
      const view = await t.ui((id) => { const v = [...document.querySelectorAll('webview')].find((w) => { try { return w.getWebContentsId() === id; } catch { return false; } }); const r = v.getBoundingClientRect(); return { x: r.x, y: r.y }; }, shown);
      const spot = { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + 40) };
      await inPage(`(() => { const a = document.createElement('a'); a.id = 'under-box'; a.href = '/dl/file.zip?under'; a.download = ''; a.textContent = 'Download'; Object.assign(a.style, { position: 'fixed', left: '${spot.x - view.x - 40}px', top: '${spot.y - view.y - 15}px', width: '80px', height: '30px', zIndex: 9, background: '#ccc' }); document.body.append(a); return 1; })()`);
      // The pointer comes in from outside the window, clicks it, and rests: the box opens under it and goes
      // on time; and going back to the page after doesn't hold it either.
      await x.move(1700, 1000);
      await sleep(300);
      await x.click(win.x + spot.x, win.y + spot.y);
      const opened = Date.now();
      await until(box, 4000, 'the downloads box, under the pointer');
      await sleep(1000);
      await x.move(win.x + 500, win.y + 650);
      assert(await gone(2600 - (Date.now() - opened)), 'opened under the pointer, it was held open (' + (Date.now() - opened) + ' ms)');
      // The pointer moved onto it: held past its time; to the page: it goes its time after that.
      await x.move(win.x + 500, win.y + 650);
      await download('held');
      b = await until(box, 4000, 'the downloads box');
      await sleep(300);
      await x.move(win.x + b.x + b.w / 2, win.y + b.y + b.h / 2);
      await sleep(150);
      await x.move(win.x + b.x + b.w / 2 + 10, win.y + b.y + b.h / 2 + 10);
      assert(await shownFor(3000), 'with the pointer on it, it closed');
      await x.move(win.x + 500, win.y + 650);
      const left = Date.now();
      assert(await shownFor(1200), 'it closed as soon as the pointer left');
      assert(await gone(2200), 'it stayed after the pointer left (' + (Date.now() - left) + ' ms)');
    } finally {
      if (shown) await inPage("(() => { const a = document.getElementById('under-box'); if (a) a.remove(); return 1; })()").catch(() => {});
      await set('downloads.showOnStartFor', 5);
      await esc();
    }
  });

  await R.step('one press of the mouse’s Back button goes back one page, however many ways it reaches Bifrost (the system’s command twice, with the Back key, with Alt+Left from a mouse’s software, with the window busy in between); presses apart, and the toolbar’s button clicked twice, go a page each', async () => {
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    // (what Windows hands the window for the mouse's Back and Forward buttons)
    const system = (c) => t.main(({ BrowserWindow }, c) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui')); w.emit('app-command', { preventDefault() {} }, c); return 1; }, c);
    await open(site.url + '/b.html?h=0', false);
    const wcId = await until(() => t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const tb = S.tabs.find((y) => y.id === ws.activeTabId); return tb && tb.url.includes('h=0') && tb.wcId; }), 6000, 'the tab');
    for (let i = 1; i <= 8; i++) {
      await sleep(150);
      await until(() => t.main(({ webContents }, [id, u]) => webContents.fromId(id).loadURL(u).then(() => true, () => false), [wcId, site.url + '/b.html?h=' + i]), 6000, 'page ' + i);
    }
    const at = () => t.main(({ webContents }, id) => webContents.fromId(id).navigationHistory.getActiveIndex(), wcId);
    const settled = async (want, what) => { await sleep(700); const i = await at(); assert(i === want, what + ': page ' + i + ', not ' + want); };
    assert(await at() === 8, 'the tab’s history isn’t as set up: ' + await at());
    await x.click(900, 600);   // (the keyboard on the page)
    await sleep(200);
    await system('browser-backward'); await system('browser-backward');
    await settled(7, 'the system’s command twice at once');
    await system('browser-backward'); await x.key('XF86Back'); await system('browser-backward');
    await settled(6, 'the command, the Back key, the command again');
    await x.keyDown('Alt_L'); await x.key('Left'); await x.keyUp('Alt_L'); await system('browser-backward');
    await settled(5, 'Alt+Left (a mouse’s software), and the command');
    // The window busy (with the page that's coming, say) between the two: it gets to the second much later.
    await t.main(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui'));
      w.emit('app-command', { preventDefault() {} }, 'browser-backward');
      w.webContents.executeJavaScript('(() => { const end = performance.now() + 800; while (performance.now() < end); return 1; })()').catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
      w.emit('app-command', { preventDefault() {} }, 'browser-backward');
      return 1;
    });
    await sleep(900);
    await settled(4, 'the command twice, the window busy in between');
    await system('browser-backward'); await sleep(700); await system('browser-backward');
    await settled(2, 'two presses apart');
    const back = await t.ui(() => { const el = [...document.querySelectorAll('[data-tb="back"]')].find((e) => e.offsetParent); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    await x.click(back.x, back.y); await sleep(150); await x.click(back.x, back.y);
    await settled(0, 'the toolbar’s back button clicked twice');
    await system('browser-forward'); await system('browser-forward');
    await settled(1, 'the system’s forward command twice at once');
    await t.ui(() => window.__wbTest.command('closeTab'));
    await sleep(300);
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

  await R.step('“Match the page”: the sidebar and toolbar take a dark page’s color (which pages measure only once it’s on); next to a bright one they stay dark (or go light, or take it exactly), with text that reads on them; Bifrost’s own pages turn see-through to the window', async () => {
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
    // (pages measure their colors only for a window that uses them: preload/tab.js, 'tab-look')
    const measured = () => t.ui(() => window.__wbTest.state.tabs.filter((x) => x.pageColor).length);
    assert((await measured()) === 0, 'pages measured their colors for a window that doesn’t use them');
    await set('appearance.blend', 'page');
    await until(measured, 4000, 'the open page measuring its colors');
    l = await until(async () => { const v = await look(); return v.blend && v.body === 'rgb(19, 35, 58)' ? v : null; }, 4000, 'the dark page’s color');
    assert(light(l.tab) > 170 && (!l.ws || light(l.ws) > 150) && light(l.addr) > 150, 'light text on the dark page: ' + JSON.stringify(l));
    assert(l.shadow === 'none', 'no shadow between the page and the window: ' + l.shadow);
    await t.shot('behavior-blend-dark');
    await clickTab('/a.html');
    // A bright page next to the dark theme: the bars stay dark (the theme's own shade, tinted with the page's
    // color), so the window doesn't glare and their text reads; the page sits in them with its frame, and
    // behind the page itself is the page's own color.
    l = await until(async () => { const v = await look(); return v.blend && v.body !== 'rgb(19, 35, 58)' ? v : null; }, 4000, 'the bars next to the light page');
    assert(light(l.body) < 60, 'the bars stay dark next to a bright page: ' + l.body);
    assert(light(l.tab) > 170 && (!l.ws || light(l.ws) > 150) && light(l.addr) > 150, 'light text on them: ' + JSON.stringify(l));
    const apart = await t.ui(() => ({ apart: document.documentElement.classList.contains('blend-apart'), behind: getComputedStyle(document.getElementById('stage')).backgroundColor, shadow: getComputedStyle(document.getElementById('stage')).boxShadow }));
    assert(apart.behind === 'rgb(255, 247, 240)', 'behind the page, the page’s own color: ' + apart.behind);
    assert(apart.apart && apart.shadow !== 'none', 'the page has its frame in bars of another color: ' + JSON.stringify(apart));
    await t.shot('behavior-blend-light');
    // "Bright pages" → "Go light": the page's color, with dark text (the light theme's).
    await set('appearance.blendTone', 'light');
    l = await until(async () => { const v = await look(); return v.blend && v.body === 'rgb(255, 247, 240)' ? v : null; }, 4000, 'the light page’s color');
    assert(light(l.tab) < 110 && (!l.ws || light(l.ws) < 130) && light(l.addr) < 110, 'dark text on the light page: ' + JSON.stringify(l));
    assert(l.shadow === 'none', 'one surface with the page again: ' + l.shadow);
    await t.shot('behavior-blend-go-light');
    // → "Exactly the page's": its color too (a calm one).
    await set('appearance.blendTone', 'exact');
    await sleep(400);
    l = await look();
    assert(l.body === 'rgb(255, 247, 240)' && light(l.tab) < 110, 'exactly the page’s color: ' + JSON.stringify(l));
    await set('appearance.blendTone', 'soft');
    await until(async () => { const v = await look(); return v.blend && light(v.body) < 60; }, 4000, 'dark bars again');
    // A page in the middle (a mid steel blue): the bars a deep shade of its blue, not the blue itself, with the
    // page in its frame; an icon in them as clear as on the theme's own (an orange one was at 2 to 1).
    const bars = () => t.ui(() => { const cs = getComputedStyle(document.getElementById('sidebar')); return { bar: cs.getPropertyValue('--mantle').trim(), tint: getComputedStyle(document.documentElement).getPropertyValue('--page-tint').trim(), apart: document.documentElement.classList.contains('blend-apart') }; });
    const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    await open(site.url + '/steel.html', false);
    let b = await until(async () => { const v = await bars(); return v.tint === '#365d7e' ? v : null; }, 6000, 'the steel blue page measured');
    assert(b.apart && ratio(b.bar, '#ffffff') >= 10 && ratio(b.bar, '#d97757') >= 4, 'bars on a steel blue page: ' + JSON.stringify(b) + ', an orange icon at ' + ratio(b.bar, '#d97757').toFixed(2) + ':1');
    l = await look();
    assert(light(l.tab) > 170 && light(l.addr) > 150, 'light text on them: ' + JSON.stringify(l));
    await t.shot('behavior-blend-steel');
    // A left edge that's a dark picture fading into a mid blue: no one color the bars could take to be one
    // surface with it, so they take the color where they meet the page (its top), and the page has its frame.
    await open(site.url + '/fading.html', false);
    // (its pixels: until they're looked at, the page's styles give a first guess, white for a body that's a
    // gradient)
    b = await until(async () => { const v = await bars(); return v.tint && v.tint !== '#365d7e' && v.tint !== '#ffffff' ? v : null; }, 6000, 'the fading page measured');
    assert(lum(b.tint) < lum('#365d7e') && b.apart, 'the color at the top of the edge, the page apart: ' + JSON.stringify(b));
    assert(ratio(b.bar, '#d97757') >= 4, 'an orange icon on them at ' + ratio(b.bar, '#d97757').toFixed(2) + ':1');
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

  await R.step('“Blur the page”: a blurred picture of the page behind the sidebar and toolbar (dark glass over a bright page’s, next to the dark theme); over Bifrost’s own pages they’re frosted glass', async () => {
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
    // The veil over the picture, in the bars' color: thin over a dark page's (the picture shows); over a bright
    // page's, next to the dark theme, thick and dark (dark glass the page glows through: no glare, and the
    // bars' text reads), with the page in its frame.
    const lightOf = (c) => { const m = String(c).match(/[\d.]+/g) || []; return (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3; };
    const veil = () => t.ui(() => { const cs = getComputedStyle(document.getElementById('backdrop'), '::after'); const title = document.querySelector('#tablist .tab.active .tab-title'); return { apart: document.documentElement.classList.contains('blend-apart'), opacity: cs.opacity, color: cs.backgroundColor, text: title ? getComputedStyle(title).color : '', frame: getComputedStyle(document.getElementById('stage')).boxShadow }; });
    let v = await until(async () => { const x = await veil(); return x.opacity === '0.42' ? x : null; }, 4000, 'a thin veil over the dark page’s picture');
    assert(!v.apart && lightOf(v.text) > 170, 'over a dark page: ' + JSON.stringify(v));
    await t.ui(() => { const S = window.__wbTest.state; const mine = S.tabs.filter((x) => x.workspaceId === S.activeWorkspaceId); window.__wbTest.command('tab' + (mine.findIndex((x) => x.url.endsWith('/a.html')) + 1)); });
    v = await until(async () => { const x = await veil(); return x.apart && x.opacity === '0.86' ? x : null; }, 6000, 'a thick veil over the bright page’s picture');
    assert(lightOf(v.color) < 60 && lightOf(v.text) > 170 && v.frame !== 'none', 'over a bright page: ' + JSON.stringify(v));
    await t.shot('behavior-blur-bright');
    // "Bright pages" → "Go light": the picture again, with dark text.
    await set('appearance.blendTone', 'light');
    v = await until(async () => { const x = await veil(); return !x.apart && x.opacity === '0.42' && lightOf(x.text) < 110 ? x : null; }, 4000, 'the bright page’s picture with dark text on it, with “Go light”');
    await set('appearance.blendTone', 'soft');
    await set('appearance.blend', 'window');
    await until(async () => { const v = await blur(); return !v.blur && !v.frosted ? v : null; }, 3000, 'the plain window again');
  });

  // ---------------------------------------------------------------- Settings' side navigation
  await R.step('Settings: its side navigation, taller than the window, scrolls on its own (the wheel over it moves it, not the page, to its end and past it), its items as they were, and the section you’re at stays in sight in it', async () => {
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    const size = (to) => t.main(({ BrowserWindow }, to) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('bifrost://ui')); const was = w.getSize(); if (to) w.setSize(to[0], to[1]); return was; }, to);
    // (the Settings opened here: an earlier step's can still be open, in a tab behind it)
    const guest = (js) => t.main(({ webContents }, js) => {
      const wc = webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')).sort((a, b) => b.id - a.id)[0];
      if (!wc) throw new Error('no Settings');
      return wc.executeJavaScript(js, true);
    }, js);
    const NAV = `(() => { const n = document.getElementById('nav'), items = [...n.querySelectorAll('.nav-item')], box = n.getBoundingClientRect(), last = items[items.length - 1].getBoundingClientRect(), on = n.querySelector('.nav-item.on'), lit = on ? on.getBoundingClientRect() : null;
      return { n: items.length, top: n.scrollTop, max: n.scrollHeight - n.clientHeight, box: [box.top, box.bottom], vh: innerHeight, page: scrollY, first: items[0].getBoundingClientRect().top, h: items[0].getBoundingClientRect().height, last: [last.top, last.bottom], lit: on ? items.indexOf(on) : -1, litAt: lit ? [lit.top, lit.bottom] : null }; })()`;
    const seen = (v) => v.litAt && v.litAt[0] >= v.box[0] && v.litAt[1] <= v.box[1];
    // (a notch of a mouse's wheel at a time, over the navigation)
    const wheel = (at, notches) => t.main(async ({ webContents }, o) => {
      const wc = webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')).sort((a, b) => b.id - a.id)[0];
      for (let i = 0; i < o.notches; i++) {
        wc.sendInputEvent({ type: 'mouseWheel', x: o.x, y: o.y, deltaX: 0, deltaY: -120, wheelTicksX: 0, wheelTicksY: -1, hasPreciseScrollingDeltas: false, canScroll: true });
        await new Promise((r) => setTimeout(r, 40));
      }
      await new Promise((r) => setTimeout(r, 800));
    }, { ...at, notches });
    const was = await size([1200, 620]);
    try {
      await open('bifrost://settings/', false);
      let nav = await until(async () => { const v = await guest(NAV); return v.n > 12 && v.vh < 600 && v.max > 0 ? v : null; }, 8000, 'Settings in a short window, its navigation taller than the window');
      assert(nav.box[1] <= nav.vh && nav.h >= 35 && Math.abs(nav.first - 86) <= 1, 'the navigation goes past the window, or its items moved or were squashed: ' + JSON.stringify(nav));
      const at = await guest(`(() => { const r = document.getElementById('nav').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round((r.top + r.bottom) / 2) }; })()`);
      // (once the page is the one on screen and drawing: a wheel sent to it before that goes nowhere)
      await until(() => guest("new Promise((res) => { if (document.visibilityState !== 'visible') return res(false); requestAnimationFrame(() => requestAnimationFrame(() => res(true))); setTimeout(() => res(false), 1500); })"), 6000, 'Settings on screen');
      await sleep(300);
      await wheel(at, 20);
      nav = await guest(NAV);
      assert(nav.top >= nav.max - 1 && nav.page === 0, 'the wheel over it: ' + JSON.stringify(nav));
      assert(nav.last[1] <= nav.box[1] && nav.last[1] <= nav.vh, 'its last item out of sight: ' + JSON.stringify(nav));
      // At its end, more of the wheel leaves the page where it is.
      await wheel(at, 4);
      nav = await guest(NAV);
      assert(nav.page === 0 && nav.top >= nav.max - 1, 'past its end: ' + JSON.stringify(nav));
      // The page scrolled to its end (the navigation at its top): the last section is lit, and in sight.
      await guest("document.getElementById('nav').scrollTop = 0, window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }), 1");
      nav = await until(async () => { const v = await guest(NAV); return v.lit >= v.n - 3 && seen(v) ? v : null; }, 4000, 'the last section lit and in sight');
      // …and back at its top: the first.
      await guest("window.scrollTo({ top: 0, behavior: 'instant' }), 1");
      nav = await until(async () => { const v = await guest(NAV); return v.lit === 0 && seen(v) ? v : null; }, 4000, 'the first section lit and in sight');
      await t.shot('behavior-settings-nav');
    } finally {
      await size(was);
    }
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

  await R.step('Settings → My filters: a list too big to show (a whole DNS blocklist) says how big it is instead, and shows if you ask; Clear asks, then empties it; typing brings the Clear button back', async () => {
    const guest = (js) => t.guest('bifrost://settings', js);
    const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };
    const ROW = '[data-path="privacy.adblock.customFilters"]';
    const state = () => guest(`(() => { const r = document.querySelector('${ROW}'); const ta = r.querySelector('textarea'), big = r.querySelector('.ta-big'); return { box: !ta.hidden, len: ta.value.length, big: big.hidden ? '' : big.textContent, show: !r.querySelector('[data-act=show]').hidden, clear: !r.querySelector('[data-act=clear]').hidden }; })()`);
    const filters = () => t.main(() => global.__bifrost.settings.get().privacy.adblock.customFilters);
    const view = () => t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => e.getBoundingClientRect().width > 50 && getComputedStyle(e).visibility !== 'hidden'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    // Where to click: the element scrolled to the middle of the page (at once: the page scrolls smoothly) and
    // staying there, on screen.
    const at = async (sel) => {
      const v = await view();
      const p = await until(() => guest(`(async () => {
        const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null;
        e.scrollIntoView({ block: 'center', behavior: 'instant' });
        const a = e.getBoundingClientRect();
        await new Promise((r) => setTimeout(r, 200));
        const b = e.getBoundingClientRect();
        return b.width && b.top === a.top && b.top >= 0 && b.bottom <= innerHeight ? { x: b.x + Math.min(b.width / 2, 40), y: b.y + b.height / 2 } : null;
      })()`), 5000, sel);
      return { x: v.x + p.x, y: v.y + p.y };
    };
    const click = async (sel) => { const p = await at(sel); await x.click(p.x, p.y); };
    const dialogButton = (label) => until(async () => { const v = await view(); const p = await guest(`(() => { const b = [...document.querySelectorAll('.dialog .btn')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); return p && { x: v.x + p.x, y: v.y + p.y }; }, 3000, 'the dialog’s ' + label);
    // A list like a whole DNS blocklist pasted in (HaGeZi's is 280,000 lines, 6 MB; this one, 20,000).
    const big = Array.from({ length: 20000 }, (_, i) => `||ad${i}.tracker-example.com^`).join('\n') + '\n';
    try {
      await closeSettingsTabs();
      await set('privacy.adblock.customFilters', big);
      await open('bifrost://settings/#adblock', false);
      const s1 = await until(async () => { const s = await state(); return s.big ? s : null; }, 8000, 'My filters');
      assert(!s1.box && s1.len === 0 && s1.show && s1.clear && /^20,000 lines \([\d.]+ KB\): too much to show here\.$/.test(s1.big), 'too big to show: ' + JSON.stringify(s1));
      // (scrolling down to it, as you would: the page stops keeping the group it opened at at the top)
      const v0 = await view();
      await x.move(v0.x + 500, v0.y + 400); await x.wheel('down', 1); await sleep(300);
      // Show it anyway: all of it, in the box.
      await click(ROW + ' [data-act=show]');
      const s2 = await until(async () => { const s = await state(); return s.box ? s : null; }, 5000, 'the list in the box');
      assert(s2.len === big.length && !s2.big && !s2.show && s2.clear, 'shown anyway: ' + JSON.stringify({ ...s2, want: big.length }));
      // Clear asks first: Cancel (Esc) keeps the list; Clear empties it.
      await click(ROW + ' [data-act=clear]');
      const d = await until(() => guest("(() => { const d = document.querySelector('.dialog'); return d ? d.textContent : null; })()"), 3000, 'the question');
      assert(/^Clear all your filters\?20,000 lines/.test(d), 'it asks: ' + d);
      await sleep(250);
      await x.key('Escape');
      await until(async () => !(await guest("!!document.querySelector('.dialog')")), 3000, 'the question answered');
      await sleep(300);
      assert((await filters()) === big, 'Cancel changed the filters');
      await click(ROW + ' [data-act=clear]');
      const ok = await dialogButton('Clear');
      await sleep(250);
      await x.click(ok.x, ok.y);
      await until(async () => (await filters()) === '', 5000, 'the filters cleared');
      const s3 = await until(async () => { const s = await state(); return s.box && !s.clear ? s : null; }, 3000, 'an empty box');
      assert(s3.len === 0 && !s3.big && !s3.show, 'cleared: ' + JSON.stringify(s3));
      const toasts = await guest("[...document.querySelectorAll('.toast-text')].map((e) => e.textContent).join(' | ')");
      assert(/Your filters are cleared/.test(toasts), 'no word that they’re cleared: ' + toasts);
      // Typing in the empty box: the Clear button is back as you type, and what you type is saved.
      await click(ROW + ' textarea');
      await sleep(150);
      for (const k of ['a', 'd', 's']) await x.key(k);
      await until(async () => (await state()).clear, 1500, 'the Clear button, while typing');
      await until(async () => (await filters()) === 'ads', 3000, 'what was typed, saved');
      await t.shot('behavior-my-filters');
    } finally {
      await set('privacy.adblock.customFilters', '');
      await closeSettingsTabs();
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
