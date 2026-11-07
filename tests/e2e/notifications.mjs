// Notifications as they reach you: a page's own (new Notification), and the ones a site shows through its
// service worker (registration.showNotification, from the page or from the worker), which Electron by
// itself drops. Bifrost runs here with a stand-in for libnotify (tests/fixtures/fake-libnotify.c) that
// writes down every notification the system would show, and clicks or closes one when told to.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, startSite, reporter, assert, sleep, ROOT, PROFILES } from './lib.mjs';

const R = reporter('notifications');
const LIB = path.join(PROFILES, 'fake-libnotify');
fs.mkdirSync(LIB, { recursive: true });
try {
  const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'gobject-2.0'], { encoding: 'utf8' }).trim().split(/\s+/);
  execFileSync('gcc', ['-shared', '-fPIC', '-o', path.join(LIB, 'libnotify.so.4'), path.join(ROOT, 'tests', 'fixtures', 'fake-libnotify.c'), ...flags]);
} catch (e) {
  console.log('  (skipped: the stand-in for libnotify couldn’t be built: ' + e.message.split('\n')[0] + ')');
  process.exit(0);
}
const LOG = path.join(LIB, 'shown.jsonl');
const CTL = path.join(LIB, 'ctl');
fs.rmSync(LOG, { force: true });
fs.rmSync(CTL, { force: true });

const html = (body, title = 'Test') => (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif;margin:30px">${body}</body>`); };
// The worker: shows, lists and closes notifications when its page asks, and tells its pages about clicks.
const WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
const tell = async (msg) => { for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg); };
const plain = (n) => ({ title: n.title, tag: n.tag, body: n.body, data: n.data, icon: n.icon, isN: n instanceof Notification });
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.cmd === 'show') e.waitUntil(self.registration.showNotification(d.title, d.options).then(() => tell({ shown: d.title }), (err) => tell({ error: String(err && err.message || err), title: d.title })));
  if (d.cmd === 'list') e.waitUntil(self.registration.getNotifications(d.filter).then((l) => tell({ list: l.map(plain) })));
  if (d.cmd === 'close') e.waitUntil(self.registration.getNotifications({ tag: d.tag }).then((l) => { l.forEach((n) => n.close()); return tell({ closed: l.length }); }));
  if (d.cmd === 'open') e.waitUntil(self.clients.openWindow(d.url).then((c) => tell({ openRes: c && c.url }), (err) => tell({ openErr: String(err && err.name) })));
});
self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const info = { click: n.title, tag: n.tag, data: n.data, isNE: e instanceof NotificationEvent, isN: n instanceof Notification };
  n.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (n.data && n.data.open) {
      try { const c = await self.clients.openWindow(n.data.open); info.opened = c && c.url; } catch (err) { info.openErr = String(err); }
    } else {
      const c = all.find((x) => x.url.includes('notes.html'));
      try { await c.focus(); info.focused = c.url; } catch (err) { info.focusErr = String(err); }
    }
    await tell(info);
  })());
});
self.addEventListener('notificationclose', (e) => { e.waitUntil(tell({ closeEvent: e.notification.title })); });
`;
const site = await startSite(undefined, { routes: {
  '/notes-sw.js': (req, res) => { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(WORKER); },
  '/notes.html': html(`<p>Notifications</p><script>
window.msgs = [];
window.vis = [];
document.addEventListener('visibilitychange', () => window.vis.push(document.visibilityState));
addEventListener('blur', () => window.vis.push('blur'));
addEventListener('focus', () => window.vis.push('focus'));
navigator.serviceWorker.addEventListener('message', (e) => window.msgs.push(e.data));
window.ready = navigator.serviceWorker.register('/notes-sw.js').then(() => navigator.serviceWorker.ready).then((r) => { window.reg = r; return true; });
window.viaWorker = (title, options) => { window.reg.active.postMessage({ cmd: 'show', title, options }); return 1; };
window.ask = (cmd, more) => { window.reg.active.postMessage({ cmd, ...more }); return 1; };
window.viaPage = (title, options) => window.reg.showNotification(title, options).then(() => 'ok', (e) => 'err ' + e.message);
window.plain = () => { const n = new Notification('Page one', { body: 'Its own' }); n.onclick = () => window.msgs.push({ pageClick: true }); return 1; };
</script>`, 'Notes'),
} });

const t = await launch({
  profile: 'notifications', args: [site.url + '/a.html'], env: { LD_LIBRARY_PATH: LIB, FAKE_NOTIFY_LOG: LOG, FAKE_NOTIFY_CTL: CTL },
  settings: { onboarding: { done: true }, panels: { web: [{ id: 'w1', url: site.url.replace('127.0.0.1', 'localhost') + '/article.html?inpanel', title: 'In the panel' }] } },
});
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 300) + ')' : ''));
};
const open = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
const allow = (v) => t.main((_, v) => global.__require('./permissions').setDecision('127.0.0.1', 'notifications', v), v);
const shown = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const shownAs = (title) => shown().filter((e) => e.event === 'show' && e.summary === title).pop();
const tell = (line) => { fs.writeFileSync(CTL + '.tmp', line + '\n'); fs.renameSync(CTL + '.tmp', CTL); };
const msgs = () => t.guest('/notes.html', 'window.msgs');
const msg = (test, label) => until(async () => (await msgs()).find(test), 6000, label);
const activeUrl = () => t.ui(() => { const S = window.__wbTest.state; const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); return S.tabs.find((x) => x.id === w.activeTabId).url; });

try {
  await sleep(1000);
  await open(site.url + '/notes.html');
  await until(() => t.guest('/notes.html', 'window.ready'), 8000, 'the page’s service worker');
  await allow('allow');
  await sleep(300);

  await R.step('a tab behind another is hidden to its page and hasn’t the focus, as in Chrome (sites notify you only then)', async () => {
    const page = () => t.guest('/notes.html', '({ state: document.visibilityState, hidden: document.hidden, focus: document.hasFocus(), events: window.vis.slice() })');
    const front = await page();
    assert(front.state === 'visible' && !front.hidden, 'in front: ' + JSON.stringify(front));
    await open(site.url + '/b.html?front'); await sleep(800);
    const behind = await page();
    assert(behind.state === 'hidden' && behind.hidden && !behind.focus && behind.events.includes('hidden'), 'behind: ' + JSON.stringify(behind));
    assert(!front.focus || behind.events.includes('blur'), 'no blur: ' + JSON.stringify({ front, behind }));
    assert(await t.guest('/b.html?front', 'document.visibilityState') === 'visible', 'the tab in front is hidden');
    const id = await t.ui(() => window.__wbTest.state.tabs.find((x) => /notes\.html/.test(x.url)).id);
    await t.main((_, id) => global.__bifrost.registry.lastFocused().send('select-tab', id), id);
    await until(async () => (await page()).state === 'visible', 3000, 'it to be visible again');
    const again = await page();
    assert(again.events.slice(-3).includes('visible') && (!again.focus || again.events.includes('focus')), 'back in front: ' + JSON.stringify(again));
    assert(await t.guest('/b.html?front', 'document.hidden') === true, 'the other tab isn’t hidden now');
  });

  await R.step('…and so is one opened behind, the page it goes to next, the tab in front while the window is hidden, the side panel’s website while it’s closed', async () => {
    const vis = (m) => t.guest(m, 'document.visibilityState');
    await t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: true }), site.url + '/b.html?behind');
    await until(() => t.guest('/b.html?behind', 'document.readyState === "complete"'), 5000, 'it to load');
    assert(await vis('/b.html?behind') === 'hidden', 'opened behind: visible');
    await t.guest('/b.html?behind', 'location.href = "/a.html?behind2"; 1');
    await until(() => t.guest('/a.html?behind2', 'document.readyState === "complete"'), 5000, 'the next page');
    assert(await vis('/a.html?behind2') === 'hidden', 'its next page: visible');
    const win = (how) => t.main(({ BrowserWindow }, how) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui')); w[how](); }, how);
    await win('hide');
    await until(async () => (await vis('/notes.html')) === 'hidden', 3000, 'the tab in front to be hidden with the window');
    await win('show');
    await until(async () => (await vis('/notes.html')) === 'visible', 3000, 'it to be visible again');
    await sleep(300);
    assert(await vis('/a.html?behind2') === 'hidden', 'the tab behind came back visible with the window');
    await t.ui(() => document.querySelector('.ps-btn[data-key="web:w1"]').click());
    await until(async () => (await vis('?inpanel').catch(() => '')) === 'visible', 5000, 'the side panel’s website, visible');
    await t.ui(() => document.querySelector('.ps-btn[data-key="web:w1"]').click());
    await until(async () => (await vis('?inpanel')) === 'hidden', 3000, 'it to be hidden with the panel closed');
    assert(await vis('/notes.html') === 'visible', 'the tab in front');
  });

  await R.step('a page’s own notification shows, and a click on it brings its tab to the front', async () => {
    await t.guest('/notes.html', 'window.plain()');
    const n = await until(() => shownAs('Page one'), 5000, 'it to show');
    assert(n.body === 'Its own', JSON.stringify(n));
    await open(site.url + '/b.html?elsewhere'); await sleep(700);
    assert(/elsewhere/.test(await activeUrl()), 'another tab in front first');
    tell('click ' + n.n);
    await until(async () => /notes\.html/.test(await activeUrl()), 4000, 'its tab in front');
    await msg((m) => m.pageClick, 'the page’s click event');
  });

  await R.step('one the page shows through its service worker shows (Electron would drop it)', async () => {
    const r = await t.guest('/notes.html', 'window.viaPage("From the page", { body: "Shown by the page", tag: "p", data: { k: 1 } })');
    assert(r === 'ok', 'showNotification: ' + r);
    const n = await until(() => shownAs('From the page'), 5000, 'it to show');
    assert(n.body === 'Shown by the page', JSON.stringify(n));
  });

  await R.step('one the worker shows shows, with its picture', async () => {
    await t.guest('/notes.html', `window.viaWorker("From the worker", { body: "Shown by the worker", tag: "w", icon: "/icons/red.png" })`);
    await msg((m) => m.shown === 'From the worker' || m.error, 'the worker’s answer');
    const n = await until(() => shownAs('From the worker'), 5000, 'it to show');
    assert(n.body === 'Shown by the worker' && n.image[0] === 32 && n.image[1] === 32, 'its picture: ' + JSON.stringify(n));
  });

  await R.step('getNotifications() lists them, as Notifications with their data, in the worker and the page', async () => {
    await t.guest('/notes.html', 'window.ask("list")');
    const m = await msg((x) => x.list, 'the list');
    const titles = m.list.map((n) => n.title).sort();
    assert(JSON.stringify(titles) === '["From the page","From the worker"]', 'worker: ' + JSON.stringify(m.list));
    const p = m.list.find((n) => n.tag === 'p');
    assert(p.isN && p.data && p.data.k === 1 && m.list.find((n) => n.tag === 'w').icon === site.url + '/icons/red.png', 'its fields: ' + JSON.stringify(m.list));
    const fromPage = await t.guest('/notes.html', 'window.reg.getNotifications({ tag: "w" }).then((l) => l.map((n) => [n.title, n instanceof Notification]))');
    assert(JSON.stringify(fromPage) === '[["From the worker",true]]', 'page: ' + JSON.stringify(fromPage));
  });

  await R.step('one with the same tag takes the old one’s place', async () => {
    const old = shownAs('From the worker');
    await t.guest('/notes.html', 'window.viaWorker("Replaced", { body: "Newer", tag: "w" })');
    await until(() => shownAs('Replaced'), 5000, 'the new one');
    assert(shown().some((e) => e.n === old.n && e.event === 'close'), 'the old one stayed: ' + JSON.stringify(shown().slice(-4)));
    await t.guest('/notes.html', 'window.ask("list", { filter: { tag: "w" } })');
    const m = await msg((x) => x.list && x.list.length === 1 && x.list[0].tag === 'w', 'the list');
    assert(m.list[0].title === 'Replaced', JSON.stringify(m.list));
  });

  await R.step('a click brings the site’s tab to the front, and its worker hears of it (notificationclick)', async () => {
    await open(site.url + '/b.html?again'); await sleep(700);
    assert(/again/.test(await activeUrl()), 'another tab in front first');
    tell('click ' + shownAs('Replaced').n);
    await until(async () => /notes\.html/.test(await activeUrl()), 4000, 'its tab in front');
    const m = await msg((x) => x.click === 'Replaced', 'the worker’s notificationclick');
    assert(m.isNE && m.isN && m.tag === 'w' && m.focused && !m.focusErr, 'the event: ' + JSON.stringify(m));
    await t.guest('/notes.html', 'window.ask("list", { filter: { tag: "w" } })');
    await msg((x) => x.list && x.list.length === 0, 'it to be closed (the worker closed it)');
  });

  await R.step('a click reaches the worker after it has stopped, too (a click minutes later)', async () => {
    await t.guest('/notes.html', 'window.viaWorker("Later", { tag: "l" })');
    await until(() => shownAs('Later'), 5000, 'it to show');
    const running = () => t.main(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/notes.html'));
      return Object.values(wc.session.serviceWorkers.getAllRunning()).filter((w) => w.scope.startsWith('http://127.0.0.1')).length;
    });
    assert(await running() === 1, 'its worker isn’t running');
    // (stopped the way Chromium stops an idle one, through DevTools)
    const page = t.app.context().pages().find((p) => p.url().includes('/notes.html'));
    const cdp = await t.app.context().newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    await until(async () => (await running()) === 0, 5000, 'the worker to stop');
    await open(site.url + '/b.html?later'); await sleep(700);
    tell('click ' + shownAs('Later').n);
    await until(async () => /notes\.html/.test(await activeUrl()), 4000, 'its tab in front');
    const m = await msg((x) => x.click === 'Later', 'the worker’s notificationclick');
    assert(m.focused && !m.focusErr, JSON.stringify(m));
  });

  await R.step('in answer to a click, the worker can open a page (clients.openWindow), and only then', async () => {
    await t.guest('/notes.html', `window.ask("open", { url: ${JSON.stringify(site.url + '/b.html?unasked')} })`);
    const no = await msg((x) => x.openErr || x.openRes, 'the worker’s answer');
    assert(no.openErr === 'InvalidAccessError', 'opened without a click: ' + JSON.stringify(no));
    await t.guest('/notes.html', `window.viaWorker("Open me", { tag: "o", data: { open: ${JSON.stringify(site.url + '/b.html?fromnote')} } })`);
    await until(() => shownAs('Open me'), 5000, 'it to show');
    tell('click ' + shownAs('Open me').n);
    await until(async () => /fromnote/.test(await activeUrl()), 5000, 'the page it opens, in front');
    const m = await msg((x) => x.click === 'Open me', 'the worker’s notificationclick');
    assert(m.opened === site.url + '/b.html?fromnote' && !m.openErr, 'openWindow: ' + JSON.stringify(m));
    assert(!(await t.ui(() => window.__wbTest.state.tabs.map((x) => x.url))).some((u) => /unasked/.test(u)), 'the unasked one opened');
  });

  await R.step('closing one tells its worker (notificationclose); the worker can close its own', async () => {
    await t.guest('/notes.html', 'window.viaWorker("Dismiss me", { tag: "d" })');
    await until(() => shownAs('Dismiss me'), 5000, 'it to show');
    tell('dismiss ' + shownAs('Dismiss me').n);
    await msg((x) => x.closeEvent === 'Dismiss me', 'notificationclose');
    await t.guest('/notes.html', 'window.viaWorker("Close me", { tag: "c" })');
    await until(() => shownAs('Close me'), 5000, 'it to show');
    await t.guest('/notes.html', 'window.ask("close", { tag: "c" })');
    await msg((x) => x.closed === 1, 'the worker closing it');
    const n = shownAs('Close me').n;
    await until(() => shown().some((e) => e.n === n && e.event === 'close'), 3000, 'it to go');
    await sleep(500);
    assert(!(await msgs()).some((x) => x.closeEvent === 'Close me'), 'notificationclose for one the worker closed itself');
  });

  await R.step('a click wakes the site’s tab when it has gone to sleep', async () => {
    await t.guest('/notes.html', 'window.viaWorker("While asleep", { tag: "s" })');
    await until(() => shownAs('While asleep'), 5000, 'it to show');
    // (the site's only tab: one that's loaded would come first; the other is another site)
    await t.main(({ webContents }) => { const ctl = global.__bifrost.registry.lastFocused(); for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && wc.getType() === 'webview' && !wc.getURL().includes('/notes.html')) ctl.send('extension-tab-action', { wcId: wc.id, action: 'close' }); });
    await open(site.url.replace('127.0.0.1', 'localhost') + '/b.html?othersite'); await sleep(800);
    const id = await t.ui(() => window.__wbTest.state.tabs.find((x) => /notes\.html/.test(x.url)).id);
    await t.main((_, id) => global.__bifrost.registry.lastFocused().send('select-tab', id), id);
    await sleep(500);
    await t.ui(() => window.__wbTest.command('sleepTab'));
    const loaded = () => t.main(({ webContents }) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().includes('/notes.html')));
    await until(async () => !(await loaded()), 5000, 'the tab to sleep');
    assert(!/notes\.html/.test(await activeUrl()), 'another tab in front');
    tell('click ' + shownAs('While asleep').n);
    await until(async () => /notes\.html/.test(await activeUrl()) && (await loaded()), 6000, 'its tab awake, in front');
    await until(() => t.guest('/notes.html', 'window.ready'), 8000, 'the page’s service worker again');
  });

  await R.step('a blocked site’s don’t show, and the site is told so', async () => {
    await allow('block');
    await sleep(300);
    const before = shown().length;
    const r = await t.guest('/notes.html', 'window.viaPage("Not this", { tag: "x" })');
    assert(/No notification permission/.test(r), 'from the page: ' + r);
    await t.guest('/notes.html', 'window.viaWorker("Nor this", { tag: "y" })');
    const m = await msg((x) => x.title === 'Nor this', 'the worker’s answer');
    assert(/No notification permission/.test(m.error), 'from the worker: ' + JSON.stringify(m));
    await sleep(500);
    assert(shown().length === before, 'shown anyway: ' + JSON.stringify(shown().slice(before)));
    await allow('allow');
  });

  await R.step('private windows’ sites get them too', async () => {
    const ids = await t.main(async () => {
      const ctx = global.__bifrost;
      const ctl = ctx.windows.create({ isPrivate: true, urls: ['about:blank'] });
      await new Promise((r) => setTimeout(r, 1500));
      const out = ctl.ses.getPreloadScripts().map((p) => p.id + ':' + p.type);
      ctl.win.close();
      return out;
    });
    assert(ids.includes('bifrost-sw-notifications:service-worker'), JSON.stringify(ids));
  });

  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/.test(l) && /notes/.test(l));
  await R.step('no errors from the pages or the worker', async () => { assert(!errs.length, errs.join('\n')); });
} catch (e) {
  console.log('  ✗ (suite error) ' + (e && e.stack));
} finally {
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
