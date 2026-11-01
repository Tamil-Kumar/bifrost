// Everyday browsing: what you type in the address bar, pages with unsaved changes ("Leave site?"),
// downloads, dialogs pages open, websites in dark mode, and getting your tabs back after a restart.
import fs from 'node:fs';
import { launch, startSite, reporter, assert, sleep } from './lib.mjs';

// A small site of our own for this suite.
const DIR = '/home/claude/bf-test/daily-site';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}</body>`;
fs.writeFileSync(DIR + '/index.html', page('Daily home', '<h1>Daily</h1><a id="go" href="next.html">next</a> <a id="dl" href="files/report.bin">report</a>'));
fs.writeFileSync(DIR + '/next.html', page('Next page', '<p>next</p>'));
fs.writeFileSync(DIR + '/dirty.html', page('Unsaved draft', `<textarea id="t"></textarea> <a id="go" href="next.html">next</a>
<script>let dirty = false; document.getElementById('t').addEventListener('input', () => { dirty = true; });
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });</script>`));
fs.writeFileSync(DIR + '/dialogs.html', page('Dialogs', '<p>dialogs</p>'));
fs.writeFileSync(DIR + '/scheme.html', page('Scheme', '<p id="s"></p><script>const m = matchMedia("(prefers-color-scheme: dark)"); const show = () => { document.getElementById("s").textContent = m.matches ? "dark" : "light"; }; show(); m.addEventListener("change", show);</script>'));
fs.mkdirSync(DIR + '/files');
fs.writeFileSync(DIR + '/files/report.bin', Buffer.alloc(300 * 1024, 7));

const site = await startSite(DIR);
const PROFILE = '/home/claude/bf-test/profiles/daily';
const DOWNLOADS = '/home/claude/bf-test/daily-downloads';
fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
const R = reporter('daily');
let t = await launch({ profile: PROFILE, args: [site.url + '/index.html'], env: { BIFROST_TEST: '1' } });
// (Playwright would try to answer pages' dialogs itself; Bifrost does that here.)
const quietDialogs = () => { const q = (p) => p.on('dialog', () => {}); for (const p of t.app.context().pages()) q(p); t.app.context().on('page', q); };
quietDialogs();
const cmd = (id, args) => t.ui(([id, args]) => window.__wbTest.command(id, args), [id, args]);
const setSetting = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const activeUrl = () => t.ui(() => { const S = window.__wbTest.state; const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); const a = w && S.tabs.find((x) => x.id === w.activeTabId); return a ? a.url || '' : ''; });
const tabCount = () => t.ui(() => document.querySelectorAll('.tab[data-id]').length);
// (A page waiting on a dialog can't answer: give up on it after a while instead of waiting forever.)
const inTab = (match, code) => Promise.race([t.guest(match, code), sleep(3000).then(() => { throw new Error('the page did not answer'); })]);
const openTab = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: false }), url);
// Clicks a button in the dialog that says `text` (not in one that's on its way out).
const clickIn = (text, label) => t.ui(([text, label]) => { const d = [...document.querySelectorAll('.dialog-layer')].reverse().find((l) => new RegExp(text).test(l.textContent)); const b = d && [...d.querySelectorAll('.dialog-actions .btn')].find((x) => x.textContent.trim() === label); if (!b) throw new Error('no ' + label + ' in ' + text); b.click(); return true; }, [text, label]);
async function waitFor(fn, ms = 8000, label = '') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); }
  throw new Error('timed out' + (label ? ' waiting for ' + label : '') + ': ' + JSON.stringify(last));
}
// Clicks inside the active page, as a person would (so the page counts as interacted with).
async function clickPage(x = 300, y = 200) {
  await t.main(({ webContents }, [x, y]) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && !w.isDestroyed() && w.__wbVisible !== false && w.getURL().includes('dirty.html'));
    if (!wc) throw new Error('no dirty page');
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }, [x, y]);
}
async function typeInPage(text) {
  await t.main(({ webContents }, text) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('dirty.html'));
    wc.focus();
    for (const ch of text) { wc.sendInputEvent({ type: 'keyDown', keyCode: ch }); wc.sendInputEvent({ type: 'char', keyCode: ch }); wc.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
  }, text);
}
async function typeInAddress(text) {
  await cmd('focusAddress');
  await t.until(() => document.activeElement && document.activeElement.id === 'address-input', null, 3000, 'address focused');
  await t.win.keyboard.type(text);   // (straight away: the first key must not be lost)
  await sleep(450);
  // Enter goes in the way a key from the keyboard does: once the page loads it takes the keyboard, and a
  // key-up sent through the test driver would then wait forever for the window to answer for it.
  await t.main(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('bifrost://ui')).webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  });
}

try {
  await waitFor(() => t.ui(() => [...document.querySelectorAll('.tab .tab-title')].some((e) => e.textContent === 'Daily home')), 10000, 'start page');
  if (process.env.TRACE2) await t.ui(() => {
    window.__dlog = [];
    new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) if (n.classList && n.classList.contains('dialog-layer')) window.__dlog.push(Math.round(performance.now()) + ' + ' + n.textContent.slice(0, 80)); for (const n of m.removedNodes) if (n.classList && n.classList.contains('dialog-layer')) window.__dlog.push(Math.round(performance.now()) + ' - ' + n.textContent.slice(0, 40)); } }).observe(document.getElementById('overlay-root'), { childList: true });
  });

  await R.step('the address bar: addresses go there, words search, internal pages open', async () => {
    const port = new URL(site.url).port;
    const cases = [
      [`127.0.0.1:${port}/next.html`, `http://127.0.0.1:${port}/next.html`],
      [`localhost:${port}/next.html`, `http://localhost:${port}/next.html`],
      [`  ${site.url}/index.html  `, `${site.url}/index.html`],
      ['bifrost://history', 'bifrost://history/'],
      ['about:blank', 'about:blank'],
    ];
    for (const [typed, want] of cases) {
      await typeInAddress(typed);
      let got = '';
      await waitFor(async () => (got = await activeUrl()) === want, 8000, typed + ' -> ' + want).catch((e) => { throw new Error(e.message + ' (got ' + got + ')'); });
    }
    // Words (and a question) search with the default engine instead of being taken for an address.
    for (const typed of ['weather tomorrow', 'what is 2+2?', 'bifrost']) {
      await typeInAddress(typed);
      let got = '';
      await waitFor(async () => {
        got = await activeUrl();
        let q = '';
        try { q = new URL(got).searchParams.get('q') || ''; } catch { /* not yet */ }
        return q === typed;
      }, 8000, 'search for ' + typed).catch((e) => { throw new Error(e.message + ' (got ' + got + ')'); });
    }
    await typeInAddress(site.url + '/index.html');
    await waitFor(async () => (await activeUrl()) === site.url + '/index.html', 8000, 'back home');
  });

  await R.step('a page with unsaved changes asks before a link takes you away (and you can stay)', async () => {
    await typeInAddress(site.url + '/dirty.html');
    await waitFor(async () => /dirty\.html$/.test(await activeUrl()), 8000, 'dirty page');
    await sleep(300);
    await clickPage(40, 20);
    await typeInPage('draft');
    await waitFor(() => inTab('dirty.html', 'document.getElementById("t").value === "draft"'), 4000, 'typed');
    const asked = [];
    await t.main(() => { global.__unloadAsked = 0; global.__unloadAnswer = () => { global.__unloadAsked++; return global.__unloadNext || 'stay'; }; });
    await inTab('dirty.html', 'document.getElementById("go").click(); true');
    await waitFor(() => t.main(() => global.__unloadAsked), 4000, 'asked');
    await sleep(500);
    assert(/dirty\.html$/.test(await activeUrl()), 'stayed on the page');
    asked.push(await inTab('dirty.html', 'document.getElementById("t").value'));
    assert(asked[0] === 'draft', 'the draft is still there');
    await t.main(() => { global.__unloadNext = 'leave'; });
    await inTab('dirty.html', 'document.getElementById("go").click(); true');
    await waitFor(async () => /next\.html$/.test(await activeUrl()), 6000, 'left for the next page');
    await t.main(() => { global.__unloadAnswer = null; global.__unloadNext = null; });
  });

  await R.step('closing a tab with unsaved changes asks first; other tabs just close', async () => {
    await openTab(site.url + '/dirty.html');
    await waitFor(async () => /dirty\.html$/.test(await activeUrl()), 8000, 'dirty page');
    await sleep(500);
    await clickPage(40, 20);
    await typeInPage('more');
    await waitFor(() => inTab('dirty.html', 'document.getElementById("t").value === "more"'), 4000, 'typed');
    // Closing the window would ask too: it counts the pages with changes.
    const dirty = await t.main(() => global.__bifrost.registry.lastFocused().request('unload-dirty', {}, 4000));
    assert(dirty === 1, 'pages with unsaved changes in the window: ' + dirty);
    const before = await tabCount();
    await cmd('closeTab');
    await t.until(() => [...document.querySelectorAll('.dialog')].some((d) => /Leave site\?/.test(d.textContent)), null, 4000, 'Leave site? dialog');
    await t.shot('daily-01-leave-site');
    // Stay: the tab and what you typed are still there.
    await clickIn('Leave site\\?', 'Stay');
    await sleep(400);
    assert(await tabCount() === before, 'the tab stayed');
    assert(await inTab('dirty.html', 'document.getElementById("t").value') === 'more', 'with its draft');
    // Leave: it closes.
    await cmd('closeTab');
    await t.until(() => [...document.querySelectorAll('.dialog')].some((d) => /Leave site\?/.test(d.textContent)), null, 4000, 'asked again');
    await clickIn('Leave site\\?', 'Leave');
    await waitFor(async () => (await tabCount()) === before - 1, 4000, 'closed');
    // A page without changes closes straight away.
    await openTab(site.url + '/next.html');
    await waitFor(async () => /next\.html$/.test(await activeUrl()), 8000, 'next');
    await sleep(300);
    const n = await tabCount();
    await cmd('closeTab');
    await waitFor(async () => (await tabCount()) === n - 1, 3000, 'closed without asking');
    assert(!(await t.ui(() => !!document.querySelector('.dialog'))), 'no dialog');
  });

  await R.step('a download saves the file and shows in Downloads', async () => {
    await setSetting('downloads.askWhereToSave', false);
    await setSetting('downloads.folder', DOWNLOADS);
    await typeInAddress(site.url + '/index.html');
    await waitFor(async () => /index\.html$/.test(await activeUrl()), 8000, 'home');
    await inTab('index.html', 'document.getElementById("dl").click(); true');
    const file = await waitFor(() => { const f = DOWNLOADS + '/report.bin'; try { return fs.statSync(f).size === 300 * 1024 ? f : ''; } catch { return ''; } }, 15000, 'downloaded file');
    assert(file, 'saved');
    const item = await waitFor(() => t.main(() => global.__bifrost.downloads.list()).then((l) => l.find((d) => /report\.bin$/.test(d.filename || '') && d.state === 'completed') || null), 5000, 'finished in the downloads list');
    assert(item.received === 300 * 1024, 'all of it: ' + JSON.stringify(item));
    assert(/index\.html$/.test(await activeUrl()), 'the page stayed where it was');
  });

  await R.step('prompt(), confirm() and alert() from a page get answers', async () => {
    await typeInAddress(site.url + '/dialogs.html');
    await waitFor(async () => /dialogs\.html$/.test(await activeUrl()), 8000, 'dialogs page');
    // The page asks; Bifrost shows its own dialog; typing an answer gives it back to the page.
    await inTab('dialogs.html', 'setTimeout(() => { window.__answer = prompt("Your name?", "Ada"); }, 0); true');
    await t.until(() => [...document.querySelectorAll('.dialog')].some((d) => /Your name\?/.test(d.textContent)), null, 4000, 'prompt dialog');
    await t.shot('daily-02-prompt');
    await t.ui(() => { const l = [...document.querySelectorAll('.dialog-layer')].find((x) => /Your name\?/.test(x.textContent)); const i = l.querySelector('input.field'); if (i.value !== 'Ada') throw new Error('default value: ' + i.value); i.value = 'Grace'; });
    await clickIn('Your name\\?', 'OK');
    await waitFor(() => inTab('dialogs.html', 'window.__answer'), 4000, 'answer');
    assert(await inTab('dialogs.html', 'window.__answer') === 'Grace', 'prompt answered');
    await inTab('dialogs.html', 'setTimeout(() => { window.__ok = confirm("Delete it?"); }, 0); true');
    await t.until(() => [...document.querySelectorAll('.dialog')].some((d) => /Delete it\?/.test(d.textContent)), null, 4000, 'confirm dialog');
    await clickIn('Delete it\\?', 'Cancel');
    await waitFor(() => inTab('dialogs.html', 'window.__ok === false'), 4000, 'confirm answered');
    await inTab('dialogs.html', 'setTimeout(() => { alert("Saved!"); window.__alerted = true; }, 0); true');
    await t.until(() => [...document.querySelectorAll('.dialog')].some((d) => /Saved!/.test(d.textContent)), null, 4000, 'alert dialog');
    await clickIn('Saved!', 'OK');
    await waitFor(() => inTab('dialogs.html', 'window.__alerted === true'), 4000, 'alert closed');
  });

  await R.step('websites can be dark like Bifrost’s theme, or forced light or dark', async () => {
    await typeInAddress(site.url + '/scheme.html');
    let got = '';
    await waitFor(async () => /scheme\.html$/.test(got = await activeUrl()), 8000, 'scheme page').catch(async (e) => { throw new Error(e.message + ' (got ' + got + '; focus ' + (await t.ui(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName))) + '; address ' + (await t.ui(() => document.getElementById('address-input').value)) + ')' + (process.env.TRACE2 ? '\n' + (await t.ui(() => (window.__dlog || []).join('\n'))) : '')); });
    const shown = () => inTab('scheme.html', 'document.getElementById("s").textContent');
    await setSetting('appearance.webTheme', 'dark');
    await waitFor(async () => (await shown()) === 'dark', 4000, 'dark');
    await setSetting('appearance.webTheme', 'light');
    await waitFor(async () => (await shown()) === 'light', 4000, 'light');
    await setSetting('appearance.theme', 'mocha');
    await setSetting('appearance.webTheme', 'browser');
    await waitFor(async () => (await shown()) === 'dark', 4000, 'like the dark theme');
    await setSetting('appearance.theme', 'latte');
    await waitFor(async () => (await shown()) === 'light', 4000, 'like the light theme');
    await setSetting('appearance.webTheme', 'system');
  });

  await R.step('after a restart, the tabs come back where they were', async () => {
    await typeInAddress(site.url + '/next.html');
    await waitFor(async () => /next\.html$/.test(await activeUrl()), 8000, 'next');
    await openTab(site.url + '/index.html');
    await waitFor(async () => /index\.html$/.test(await activeUrl()), 8000, 'home');
    await sleep(1500);   // (the session is saved shortly after changes)
    const before = await t.ui(() => [...document.querySelectorAll('.tab[data-id] .tab-title')].map((e) => e.textContent));
    await t.app.close();
    t = await launch({ profile: PROFILE, fresh: false, env: { BIFROST_TEST: '1' } });
    quietDialogs();
    const after = await waitFor(async () => {
      const titles = await t.ui(() => [...document.querySelectorAll('.tab[data-id] .tab-title')].map((e) => e.textContent));
      return titles.length >= before.length ? titles : null;
    }, 15000, 'tabs back');
    assert(JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before), 'same tabs: ' + JSON.stringify({ before, after }));
    assert(/index\.html$/.test(await activeUrl()), 'the same tab active: ' + await activeUrl());
  });
} finally {
  const failed = R.summary();
  if (process.env.TRACE2) console.log((await t.ui(() => window.__dlog || []).catch(() => [])).join('\n'));
  const errors = t.logs.filter((l) => /\[ui (error|pageerror)\]/.test(l));
  if (errors.length) console.log('\nUI errors:\n' + errors.join('\n').slice(0, 3000));
  await t.app.close().catch(() => {});
  site.stop();
  process.exitCode = failed ? 1 : 0;
}
