// Extensions as people use them: a Manifest V3 extension's service worker has the whole chrome.* API and
// its calls work; context menu items and toolbar popups; and two real, popular extensions doing their job:
// Dark Reader darkening a page and Stylus applying a usercss theme (Catppuccin for YouTube) to all of a
// (local stand-in for) YouTube. Also: your own site style wins over the site's styles, even under a strict CSP.
//
// Dark Reader and Stylus come from their GitHub releases (cached in ~/cache/exts); without them, and no
// network, those steps are skipped and say so.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { launch, startSite, reporter, assert, sleep, xinput, ROOT } from './lib.mjs';

const R = reporter('extensions');
const CACHE = process.env.EXT_CACHE || '/home/claude/cache/exts';
const FIX = path.join(ROOT, 'tests', 'fixtures');

function ensureExtension(name, url) {
  const dir = path.join(CACHE, name);
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const zip = path.join(os.tmpdir(), name + '.zip');
    execFileSync('curl', ['-sSfL', '-o', zip, url], { stdio: 'ignore', timeout: 120000 });
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-oq', zip, '-d', dir]);
    return fs.existsSync(path.join(dir, 'manifest.json')) ? dir : null;
  } catch { return null; }
}
const DARKREADER = ensureExtension('darkreader', 'https://github.com/darkreader/darkreader/releases/download/v4.9.133/darkreader-chrome-mv3.zip');
const STYLUS = ensureExtension('stylus', 'https://github.com/openstyles/stylus/releases/download/v2.4.17/stylus-chrome-mv3-v2.4.17-id.zip');
const CTP_YOUTUBE = path.join(CACHE, 'ctp-youtube.json');
if (!fs.existsSync(CTP_YOUTUBE)) {
  try {
    const all = path.join(os.tmpdir(), 'ctp-import.json');
    execFileSync('curl', ['-sSfL', '-o', all, 'https://github.com/catppuccin/userstyles/releases/download/all-userstyles-export/import.json'], { stdio: 'ignore', timeout: 120000 });
    const yt = JSON.parse(fs.readFileSync(all, 'utf8')).filter((s) => s && s.name === 'YouTube Catppuccin');
    if (yt.length) fs.writeFileSync(CTP_YOUTUBE, JSON.stringify(yt));
  } catch { /* offline */ }
}

// A stand-in for YouTube (and for userstyles.catppuccin.com, where the theme's library comes from), over
// HTTPS with a certificate made for this run; Bifrost is pointed at it with --host-resolver-rules.
const tls = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'key.pem'), '-out', path.join(tls, 'cert.pem'), '-days', '2', '-subj', '/CN=www.youtube.com', '-addext', 'subjectAltName=DNS:www.youtube.com,DNS:youtube.com,DNS:userstyles.catppuccin.com'], { stdio: 'ignore' });
const yt = https.createServer({ key: fs.readFileSync(path.join(tls, 'key.pem')), cert: fs.readFileSync(path.join(tls, 'cert.pem')) }, (req, res) => {
  const u = new URL(req.url, 'https://x');
  if (u.pathname.startsWith('/lib/')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(fs.readFileSync(path.join(FIX, 'yt', u.pathname))); }
  if (u.pathname === '/favicon.ico') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(FIX, 'yt', 'results.html')));
});
await new Promise((r) => yt.listen(0, '127.0.0.1', r));
const ytPort = yt.address().port;

const site = await startSite(path.join(ROOT, 'tests', 'site'), { routes: {
  '/cascade.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Cascade</title><style>.x{color:rgb(255,0,0)}</style><p class=x id=x>Styled by the page</p>'); },
  '/strict.html': (req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; style-src 'self'" }); res.end('<!doctype html><title>Strict</title><link rel=stylesheet href="/strict.css"><p class=x id=x>Strict CSP</p>'); },
  '/strict.css': (req, res) => { res.writeHead(200, { 'content-type': 'text/css' }); res.end('.x{color:rgb(255,0,0)}'); },
} });

const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({
  profile: 'extensions',
  args: [`--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${ytPort},MAP youtube.com 127.0.0.1:${ytPort},MAP userstyles.catppuccin.com 127.0.0.1:${ytPort}`, '--ignore-certificate-errors'],
  env: NO_PROXY,
});
const x = xinput();
const open = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
const swLogs = () => t.main(() => global.__swlogs.slice());
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 300) + ')' : ''));
};
const css = (match, sel, prop) => t.guest(match, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? getComputedStyle(el)[${JSON.stringify(prop)}] : null; })()`);

try {
  await t.main(async () => {
    const ses = global.__bifrost.extensions.ses;
    global.__swlogs = [];
    ses.serviceWorkers.on('console-message', (e, d) => global.__swlogs.push(String((d && d.message) || '')));
    await global.__bifrost.extensions.ready;
  });
  // (Errors that only mean this test machine is offline don't count.)
  const swErrors = async () => (await swLogs()).filter((l) => /TypeError|Cannot read|is not a function|is not defined/.test(l) && !/Failed to fetch|NetworkError|ERR_/.test(l));

  let apiId = null;
  await R.step('a Manifest V3 extension’s service worker has the whole chrome.* API', async () => {
    apiId = await t.main(async (_, dir) => (await global.__bifrost.extensions.loadUnpacked(dir)).id, path.join(FIX, 'ext-apicheck'));
    const line = await until(async () => (await swLogs()).find((l) => l.startsWith('APICHECK ')), 15000, 'the service worker’s report');
    const r = JSON.parse(line.slice('APICHECK '.length));
    const missing = ['permissions', 'contextMenus', 'windows', 'tabs', 'webNavigation', 'notifications', 'storage', 'alarms', 'scripting', 'bookmarks', 'history', 'commands', 'action', 'runtime', 'cookies', 'downloads', 'idle'].filter((k) => !r.chrome.includes(k));
    assert(!missing.length, 'missing in the service worker: chrome.' + missing.join(', chrome.'));
    const tabsMissing = ['create', 'remove', 'query', 'update', 'get', 'sendMessage', 'executeScript', 'captureVisibleTab'].filter((k) => !r.tabs.includes(k));
    assert(!tabsMissing.length, 'missing: chrome.tabs.' + tabsMissing.join(', chrome.tabs.'));
    assert(r.windows.includes('getLastFocused') && r.windows.includes('create'), 'chrome.windows is incomplete: ' + r.windows.join(','));
  });

  await R.step('it gets runtime.onInstalled (reason “install”), once', async () => {
    const lines = await until(async () => { const l = (await swLogs()).filter((x) => x.startsWith('APICHECK-INSTALLED ')); return l.length ? l : null; }, 10000, 'onInstalled');
    await sleep(1500);
    const all = (await swLogs()).filter((x) => x.startsWith('APICHECK-INSTALLED '));
    assert(all.length === 1, 'fired ' + all.length + ' times');
    assert(JSON.parse(lines[0].slice('APICHECK-INSTALLED '.length)).reason === 'install', lines[0]);
  });

  await R.step('…and its calls work (permissions, windows, tabs, storage, alarms, scripting)', async () => {
    await open(site.url + '/a.html');
    const raw = await until(() => t.guest('/a.html', 'document.documentElement.dataset.apicheck || ""'), 15000, 'the content script’s answer');
    const r = JSON.parse(raw);
    assert(r.permsTabs === true, 'permissions.contains: ' + r.permsTabs);
    assert(typeof r.permsAll === 'number' && r.permsAll > 0, 'permissions.getAll: ' + r.permsAll);
    assert(r.window === true, 'windows.getLastFocused: ' + r.window);
    assert(String(r.activeTab).includes('/a.html'), 'tabs.query(active): ' + r.activeTab);
    assert(String(r.tabById).includes('/a.html'), 'tabs.get(sender.tab.id): ' + r.tabById);
    assert(r.storage === 1, 'storage.local: ' + r.storage);
    assert(r.alarm === true, 'alarms: ' + r.alarm);
    assert(String(r.script).length > 0 && !String(r.script).startsWith('ERR'), 'scripting.executeScript: ' + r.script);
  });

  await R.step('its service worker hears storage changes (its pages’ and its own), once each, and its alarms go off', async () => {
    const events = async () => (await swLogs()).filter((l) => l.startsWith('APICHECK-EVENT ')).map((l) => JSON.parse(l.slice('APICHECK-EVENT '.length)));
    const heard = async (via, key, area) => (await events()).filter((e) => e.via === via && (!area || e.area === area) && (e.keys || [e.name]).includes(key)).length;
    await until(() => heard('storage.local.onChanged', 'a'), 5000, 'storage.local.onChanged for its own write');
    await open(`chrome-extension://${apiId}/events.html`);
    await until(() => t.main(({ webContents }) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getTitle() === 'API check events done')), 8000, 'the extension page');
    const want = [['storage.onChanged', 'fromPage', 'local'], ['storage.local.onChanged', 'fromPage'], ['storage.onChanged', 'fromPageSession', 'session'], ['storage.session.onChanged', 'fromPageSession'], ['alarms.onAlarm', 'fromPage']];
    for (const [via, key, area] of want) await until(() => heard(via, key, area), 8000, via + ' (' + key + ')');
    await sleep(1000);
    for (const [via, key, area] of want) { const n = await heard(via, key, area); assert(n === 1, `${via} (${key}) fired ${n} times`); }
    await t.ui(() => window.__wbTest.command('closeTab')); await sleep(300);
  });

  await R.step('when the tab in front changes, its tabs.onActivated listener finds that tab active (new tabs, switching, back again)', async () => {
    const seen = async () => (await swLogs()).filter((l) => l.startsWith('APICHECK-ACTIVATED ')).map((l) => JSON.parse(l.slice('APICHECK-ACTIVATED '.length)));
    const wcOf = (match) => t.main((_, match) => { const w = global.__bifrost.registry.lastFocused().tabs.find((x) => String(x.url).includes(match)); return w ? w.wcId : null; }, match);
    const expectFront = async (match, from, label) => {
      const want = await until(() => wcOf(match), 5000, 'the tab ' + match);
      const ev = await until(async () => (await seen()).slice(from).find((e) => e.tabId === want), 5000, 'onActivated for ' + label);
      assert(ev.front === want, `${label}: onActivated for tab ${want}, but tabs.query says tab ${ev.front} (${ev.url}) is in front`);
    };
    for (let round = 0; round < 3; round++) {
      let n = (await seen()).length;
      await open(site.url + `/b.html?front${round}`);
      await expectFront(`/b.html?front${round}`, n, 'a new tab');
      n = (await seen()).length;
      await t.ui(() => window.__wbTest.command('prevTab'));
      const prevUrl = await t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); return S.tabs.find((x) => x.id === ws.activeTabId).url; });
      await expectFront(prevUrl, n, 'Ctrl+Shift+Tab');
      n = (await seen()).length;
      await t.ui(() => window.__wbTest.command('nextTab'));
      await expectFront(`/b.html?front${round}`, n, 'Ctrl+Tab');
    }
    // A tab opened in the background (Ctrl+click) isn't in front: no onActivated for it, and the toolbar
    // (its badges, its popups) still means the tab you're looking at.
    const front = await wcOf('/b.html?front2');
    const n = (await seen()).length;
    await t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: true }), site.url + '/b.html?behind');
    const behind = await until(() => wcOf('/b.html?behind'), 5000, 'the background tab');
    await sleep(1500);
    const extra = (await seen()).slice(n);
    assert(!extra.length, 'onActivated for a tab opened in the background: ' + JSON.stringify(extra));
    const toolbarTab = await t.main(() => { const s = global.__bifrost.extensions.ece.ctx.store; const tab = s.getActiveTabOfCurrentWindow(); return tab ? tab.id : null; });
    assert(toolbarTab === front, `the toolbar means tab ${toolbarTab}, the tab in front is ${front} (${behind} is behind it)`);
    // An extension bringing a tab to the front (chrome.tabs.update(id, { active: true })).
    const m = (await seen()).length;
    const res = await t.main(async (_, [tabId, extId]) => {
      const B = global.__bifrost.extensions;
      const h = B.ece.ctx.router.handlers.get('tabs.update');
      const r = await h.callback({ extension: B.ses.extensions.getExtension(extId), type: 'service-worker' }, tabId, { active: true });
      return r ? { active: r.active, id: r.id } : null;
    }, [behind, apiId]);
    assert(res && res.active === true && res.id === behind, 'tabs.update returned ' + JSON.stringify(res));
    const shown = await t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); return S.tabs.find((x) => x.id === ws.activeTabId).wcId; });
    assert(shown === behind, `tabs.update(active) didn't bring the tab to the front (${shown} is)`);
    const ev = await until(async () => (await seen()).slice(m).find((e) => e.tabId === behind), 5000, 'onActivated after tabs.update');
    assert(ev.front === behind, 'after tabs.update, tabs.query says tab ' + ev.front + ' is in front');
  });

  await R.step('its context menu item is in the page’s right-click menu', async () => {
    const items = await until(() => t.main(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/a.html'));
      const list = global.__bifrost.extensions.getContextMenuItems(wc, { pageURL: wc.getURL(), frameURL: '', linkURL: '', mediaType: 'none', selectionText: '', editFlags: {}, isEditable: false, x: 10, y: 10 }) || [];
      // (Several items of one extension sit under its name.)
      const flat = (items, out = []) => { for (const m of items) { if (m.label) out.push(m.label); if (m.submenu) flat(m.submenu.items, out); } return out; };
      return flat(list);
    }).then((l) => (l.some((s) => /API check item/.test(s)) ? l : null)), 10000, 'the item');
    assert(items.length, 'no extension items');
  });

  await R.step('its menu items: a click says which item it’s under and in which frame; update() changes them; hidden ones show when shown; checkboxes tick', async () => {
    // The page's right-click menu as Bifrost builds it, and a click on one of its items (as the window does).
    const menu = () => t.main(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/a.html'));
      const list = global.__bifrost.extensions.getContextMenuItems(wc, { pageURL: wc.getURL(), frameURL: wc.getURL(), frame: wc.mainFrame, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', editFlags: {}, isEditable: false, x: 10, y: 10 }) || [];
      const ser = (items) => items.map((m) => ({ label: m.label, checked: !!m.checked, sub: m.submenu ? ser(m.submenu.items) : undefined }));
      return ser(list);
    });
    const click = (label) => t.main(({ webContents }, label) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/a.html'));
      const list = global.__bifrost.extensions.getContextMenuItems(wc, { pageURL: wc.getURL(), frameURL: wc.getURL(), frame: wc.mainFrame, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', editFlags: {}, isEditable: false, x: 10, y: 10 }) || [];
      const find = (items) => { for (const m of items) { if (m.label === label) return m; const f = m.submenu && find(m.submenu.items); if (f) return f; } return null; };
      const it = find(list);
      if (!it) return false;
      it.click(it, null, {});
      return true;
    }, label);
    const flat = (items, out = []) => { for (const m of items) { out.push(m); if (m.sub) flat(m.sub, out); } return out; };
    const labels = async () => flat(await menu()).map((m) => m.label);
    await until(async () => (await labels()).includes('API check child'), 8000, 'the child item');
    assert(!(await labels()).includes('API check hidden'), 'a hidden item shows: ' + (await labels()).join(', '));
    const clicks = async () => (await swLogs()).filter((l) => l.startsWith('APICHECK-CLICK ')).map((l) => JSON.parse(l.slice('APICHECK-CLICK '.length)));
    const n = (await clicks()).length;
    assert(await click('API check child'), 'no child item to click');
    const c = await until(async () => (await clicks()).slice(n).find((e) => e.menuItemId === 'apicheck-child'), 5000, 'onClicked for the child');
    assert(c.parentMenuItemId === 'apicheck-parent' && c.frameId === 0 && /\/a\.html/.test(c.tab), 'onClicked said ' + JSON.stringify(c));
    await until(async () => { const l = await labels(); return l.includes('API check child (clicked)') && l.includes('API check hidden'); }, 5000, 'update() to rename the child and show the hidden item');
    const m = (await clicks()).length;
    assert(await click('API check box'), 'no checkbox item');
    const k = await until(async () => (await clicks()).slice(m).find((e) => e.menuItemId === 'apicheck-check'), 5000, 'onClicked for the checkbox');
    assert(k.checked === true && k.wasChecked === false, 'the checkbox click said ' + JSON.stringify(k));
    const box = flat(await menu()).find((x) => x.label === 'API check box');
    assert(box && box.checked, 'the checkbox isn’t ticked in the menu');
  });

  await R.step('its toolbar button opens its popup; Esc, a click elsewhere, switching tabs or its button close it (and its shadow)', async () => {
    await t.main((_, id) => global.__bifrost.settings.set('extensions.pinned', [id]), apiId);
    const btn = await t.until((id) => { const el = document.querySelector(`#ext-actions [data-ext="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, apiId, 8000, 'the pinned button');
    const isOpen = () => t.main(({ webContents }) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getURL().includes('/popup.html')));
    const shadowShown = () => t.ui(() => { const e = document.getElementById('ext-popup-shadow'); return !!e && !e.hidden && e.classList.contains('on'); });
    const openIt = async (when) => {
      await x.click(btn.x, btn.y);
      await until(() => t.main(({ webContents }) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getURL().includes('/popup.html') && w.getTitle() === 'API check popup')), 8000, 'the popup ' + when);
      await sleep(300);
    };
    const closedBy = async (what) => {
      await until(async () => !(await isOpen()), 3000, what + ' to close the popup');
      await until(async () => !(await shadowShown()), 2000, 'its shadow to go with it (after ' + what + ')');
      await sleep(400);   // (a person's pause before the next click)
    };
    await openIt('the first time'); await x.key('Escape'); await closedBy('Esc');
    await openIt('after Esc'); await x.click(700, 600); await closedBy('a click on the page');
    await openIt('after a click on the page'); await open(site.url + '/b.html?popup'); await closedBy('switching to another tab');
    await openIt('after switching tabs'); await x.click(btn.x, btn.y); await closedBy('its button');
    await sleep(500);
    assert(!(await isOpen()), 'clicking its button to close it opened it again');
  });

  await R.step('an extension with only a popup can go in the side panel (from the side bar’s + button): its popup page shows there, as a panel; and it comes off again', async () => {
    const ps = () => t.ui(() => window.__wbTest.panels());
    try {
      const add = await t.until(() => { const e = document.querySelector('.ps-add'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, null, 4000, 'the + button');
      await x.click(add.x, add.y);
      const rowOf = () => { const r = [...document.querySelectorAll('.pa-row')].find((e) => /API check/.test(e.textContent)); if (!r) return null; const b = r.querySelector('button'); const br = b.getBoundingClientRect(); return { x: br.x + br.width / 2, y: br.y + br.height / 2, label: b.textContent }; };
      await t.until(rowOf, null, 5000, 'the extension in the + box');
      await sleep(300);   // (once the box is in place: it slides in)
      const row = await t.ui(rowOf);
      assert(row.label === 'Add', 'its button says ' + row.label);
      await x.click(row.x, row.y);
      await until(async () => { const s = await ps(); return s.extShown && s.extShown.kind === 'popup' && s.extShown.id === apiId && s.view === 'ext:' + apiId; }, 6000, 'its popup page in the side panel');
      await until(() => t.main(({ webContents }, id) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.__wbPanel === id && w.getURL().includes('/popup.html') && w.getTitle() === 'API check popup'), apiId), 8000, 'the popup page to load there');
      assert(await t.ui((id) => !!document.querySelector(`.ps-btn.on[data-key="ext:${id}"]`), apiId), 'its side bar button isn’t lit');
      await t.shot('extensions-popup-in-side-panel');
      await t.main(() => global.__bifrost.settings.set('panels.extensions', []));
      await until(async () => { const s = await ps(); return !s.extShown && s.view === null && !s.ext.some((p) => p.id === apiId); }, 4000, 'it to come off');
      await until(() => t.main(({ webContents }) => !webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.__wbPanel)), 4000, 'its page to close');
    } finally {
      await t.main(() => global.__bifrost.settings.set('panels.extensions', []));
    }
  });

  if (DARKREADER) {
    await R.step('Dark Reader darkens a light page', async () => {
      const drId = await t.main(async (_, dir) => (await global.__bifrost.extensions.loadUnpacked(dir)).id, DARKREADER);
      await sleep(2500);
      await open(site.url + '/article.html');
      await until(() => t.guest('/article.html', '!!document.querySelector("style.darkreader")'), 15000, 'Dark Reader’s styles');
      const bg = await until(async () => { const c = await css('/article.html', 'body', 'backgroundColor'); const m = /(\d+), (\d+), (\d+)/.exec(c || ''); return m && (+m[1] + +m[2] + +m[3]) / 3 < 80 ? c : null; }, 10000, 'a dark background');
      assert(bg, 'page not darkened');
      const errs = await swErrors();
      assert(!errs.length, 'errors in its service worker: ' + errs.join(' | '));
      await t.main((_, id) => global.__bifrost.extensions.setEnabled(id, false), drId);
    });
  } else console.log('  - Dark Reader not available (offline): skipped');

  if (STYLUS && fs.existsSync(CTP_YOUTUBE)) {
    let stylusId = null;
    await R.step('Stylus starts and imports a usercss theme (Catppuccin for YouTube)', async () => {
      stylusId = await t.main(async (_, dir) => (await global.__bifrost.extensions.loadUnpacked(dir)).id, STYLUS);
      await sleep(2500);
      await open(`chrome-extension://${stylusId}/manage.html`);
      await until(() => t.guest('manage.html', 'typeof API === "object" && document.readyState === "complete"'), 15000, 'the style manager');
      const json = fs.readFileSync(CTP_YOUTUBE, 'utf8');
      const res = JSON.parse(await t.guest('manage.html', `API.styles.importMany(${json}).then((r) => JSON.stringify(r.map((x) => ({ ok: !!x.style, err: x.err ? String(x.err.message || x.err) : null, sections: x.style && x.style.sections ? x.style.sections.length : 0 }))))`));
      assert(res.length === 1 && res[0].ok && res[0].sections > 0, 'import: ' + JSON.stringify(res));
      const errs = await swErrors();
      assert(!errs.length, 'errors in its service worker: ' + errs.join(' | '));
    });
    await R.step('…and all of the theme applies on YouTube, not just bits of it (in its dark flavor: YouTube is told Bifrost is dark)', async () => {
      await open('https://www.youtube.com/results?search_query=sambucha');
      await until(async () => (await t.guest('youtube.com', 'document.readyState')) === 'complete', 10000, 'YouTube');
      assert(await t.guest('youtube.com', 'document.documentElement.hasAttribute("dark")'), 'YouTube came up light: the page wasn’t told Bifrost is dark (so the userstyle uses its light flavor, and Dark Reader inverts it)');
      const app = await until(async () => { const c = await css('youtube.com', 'ytd-app', 'backgroundColor'); return c === 'rgb(30, 30, 46)' ? c : null; }, 15000, 'the Mocha background');
      assert(app);
      assert(await css('youtube.com', '#video-title', 'color') === 'rgb(205, 214, 244)', 'title isn’t Mocha text: ' + await css('youtube.com', '#video-title', 'color'));
      assert(await css('youtube.com', '#b-new', 'backgroundColor') === 'rgb(203, 166, 247)', '“New” badge: ' + await css('youtube.com', '#b-new', 'backgroundColor'));
      await t.shot('ext-stylus-youtube');
    });
    await R.step('…and keeps applying when YouTube changes page without reloading', async () => {
      await t.guest('youtube.com', 'history.pushState({}, "", "/watch?v=abc123"), 1');
      await sleep(1500);
      assert(await css('youtube.com', 'ytd-app', 'backgroundColor') === 'rgb(30, 30, 46)', 'lost after pushState');
      await t.main((_, id) => global.__bifrost.extensions.setEnabled(id, false), stylusId);
    });
  } else console.log('  - Stylus or the Catppuccin export not available (offline): skipped');

  await R.step('your own style for a site wins over the site’s styles, with no reload', async () => {
    await open(site.url + '/cascade.html');
    await until(() => css('/cascade.html', '#x', 'color').then((c) => (c === 'rgb(255, 0, 0)' ? c : Promise.reject(new Error('color ' + c)))), 8000, 'the page');
    // (what the site popover's Save does)
    await t.ui(() => window.wb.invoke('site:set', '127.0.0.1', 'css', '.x { color: rgb(0, 0, 255) }'));
    await until(() => css('/cascade.html', '#x', 'color').then((c) => c === 'rgb(0, 0, 255)'), 5000, 'the style');
  });
  await R.step('…even on a page whose Content-Security-Policy blocks inline styles', async () => {
    await open(site.url + '/strict.html');
    await until(() => css('/strict.html', '#x', 'color').then((c) => c === 'rgb(0, 0, 255)'), 8000, 'the style under CSP');
  });
  await R.step('…and removing it takes it off straight away', async () => {
    await t.ui(() => window.wb.invoke('site:set', '127.0.0.1', 'css', null));
    await until(() => css('/strict.html', '#x', 'color').then((c) => c === 'rgb(255, 0, 0)'), 5000, 'the page’s own color');
  });
} finally {
  x.close();
  const errs = t.logs.filter((l) => /Uncaught|TypeError/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log errors:\n  ' + errs.join('\n  '));
  await t.close();
  site.stop();
  yt.close();
  fs.rmSync(tls, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
