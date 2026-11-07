'use strict';
// Notifications that websites show through their service worker (registration.showNotification), which is
// how most sites send theirs. Electron shows the ones a page makes itself (new Notification) but drops these
// without a word (its DisplayPersistentNotification does nothing: electron/electron#13041), and the site
// thinks they went out. Bifrost shows them itself, as the system's own notifications: from the worker
// (preload/sw.js) or from one of the site's pages (preload/tab.js). A click on one reaches the site's worker
// (notificationclick), which may bring one of its pages to the front or open one, as in Chrome; Bifrost
// brings the site's tab to the front either way.
const path = require('node:path');
const { BrowserWindow, Notification, nativeImage, ipcMain, webContents: WC } = require('electron');
const ctx = require('./context');
const permissions = require('./permissions');

const PRELOAD = path.join(__dirname, '..', 'preload', 'sw.js');
const PER_SITE = 50;         // the most a site has open at once (its oldest goes)
const WINDOW_MS = 10000;     // after a click, how long its worker may bring a page to the front or open one

const open = new Map();      // id → { id, ses, scope, origin, host, title, o, wcId, n, dropped }
let nextId = 1;
const tasks = new Map();     // event token → end (keeps its worker running until it's done)
let nextToken = 1;
const allowed = new WeakMap(); // session → Map(origin → until): a click lets its worker focus or open a window, once

function originOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } }
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max);

// What a site passed, checked again here (it comes from the page or its worker).
function clean(o) {
  o = o && typeof o === 'object' ? o : {};
  const url = (v) => (typeof v === 'string' && /^(https?|data):/i.test(v) ? v.slice(0, 1 << 20) : '');
  return {
    body: str(o.body, 4000), tag: str(o.tag, 500), icon: url(o.icon), badge: url(o.badge), image: url(o.image),
    dir: ['ltr', 'rtl'].includes(o.dir) ? o.dir : 'auto', lang: str(o.lang, 40),
    requireInteraction: !!o.requireInteraction, renotify: !!o.renotify, silent: typeof o.silent === 'boolean' ? o.silent : null,
    timestamp: Number.isFinite(o.timestamp) ? o.timestamp : Date.now(),
    actions: Array.isArray(o.actions) ? o.actions.slice(0, 2).map((a) => ({ action: str(a && a.action, 200), title: str(a && a.title, 200), icon: url(a && a.icon) })) : [],
    data: o.data === undefined ? null : o.data,
  };
}
// What the site gets back (getNotifications, and in its events).
const view = (r) => ({ id: r.id, title: r.title, options: r.o });

// The system's notification, with the site's image (or its own icon).
async function show(ses, scope, title, options, { wcId = null } = {}) {
  const origin = originOf(scope);
  if (!origin) return { error: 'type' };
  const host = hostOf(scope);
  if (permissions.decision(host, 'notifications', !!ses.__bifrostPrivate) !== 'allow') return { error: 'permission' };
  const o = clean(options);
  const mine = [...open.values()].filter((r) => r.ses === ses && r.origin === origin);
  // (one with the same tag takes the old one's place)
  for (const r of mine) if (o.tag && r.o.tag === o.tag) drop(r);
  for (const r of mine.filter((x) => !x.dropped).slice(0, -(PER_SITE - 1))) drop(r);
  const r = { id: nextId++, ses, scope, origin, host, title: str(title, 1000), o, wcId, n: null, dropped: false };
  open.set(r.id, r);
  if (!Notification.isSupported()) return { id: r.id };
  const icon = await iconFor(ses, o.icon, host);
  if (r.dropped) return { id: r.id };
  const n = new Notification({ title: r.title, body: o.body, icon, silent: o.silent === true, timeoutType: o.requireInteraction ? 'never' : 'default' });
  r.n = n;
  n.on('click', () => clicked(r));
  // (closed by you: the site hears of it; closed by the site, or another took its place: not)
  n.on('close', () => { if (r.dropped) return; open.delete(r.id); deliver(r, 'notificationclose'); });
  n.on('failed', (_e, err) => { open.delete(r.id); console.warn(`[notifications] one from ${host} didn’t show: ${err}`); });
  n.show();
  return { id: r.id };
}

function drop(r) {
  r.dropped = true;
  open.delete(r.id);
  try { if (r.n) r.n.close(); } catch { /* gone */ }
}

async function iconFor(ses, url, host) {
  let img = null;
  try {
    if (url.startsWith('data:')) img = nativeImage.createFromDataURL(url);
    else if (url) {
      const res = await Promise.race([ses.fetch(url), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 4000))]);
      const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      if (buf && buf.length < 8e6) img = nativeImage.createFromBuffer(buf);
    }
  } catch { img = null; }
  // (none, or one the system can't show, such as SVG: the site's own icon, when Bifrost has one it can)
  if (!img || img.isEmpty()) {
    try {
      const row = ctx.db.siteIcon(host);
      if (row && row.data && /^image\/(png|jpeg)$/.test(row.mime)) img = nativeImage.createFromBuffer(Buffer.from(row.data));
    } catch { img = null; }
  }
  return img && !img.isEmpty() ? img : undefined;
}

function clicked(r) {
  const tab = siteTab(r.ses, (u) => u.startsWith(r.scope), r.wcId) || siteTab(r.ses, (u) => originOf(u) === r.origin, r.wcId);
  if (tab) bringToFront(tab);
  let m = allowed.get(r.ses);
  if (!m) allowed.set(r.ses, (m = new Map()));
  m.set(r.origin, Date.now() + WINDOW_MS);
  deliver(r, 'notificationclick');
}

// The site's worker gets the event (started for it if it isn't running), and runs until it has dealt with it.
async function deliver(r, type) {
  let sw = null;
  try { sw = await r.ses.serviceWorkers.startWorkerForScope(r.scope); } catch { return; /* no worker there any more */ }
  if (!sw) return;
  hook(r.ses, sw);
  let task = null;
  try { task = sw.startTask(); } catch { task = null; }
  const token = nextToken++;
  const end = () => { tasks.delete(token); if (task) { try { task.end(); } catch { /* gone */ } task = null; } };
  tasks.set(token, end);
  setTimeout(end, 60000);
  try { sw.send('bifrost:notification-event', { token, type, action: '', notification: view(r) }); } catch { end(); }
}

function windowAllowed(ses, origin) {
  const m = allowed.get(ses);
  const until = m && m.get(origin);
  if (!until || until < Date.now()) return false;
  m.delete(origin);
  return true;
}

// The site's tab (or side panel) that fits best: the one it came from, else the one in front in the window
// you used last, else the one you used last, else its side panel, else one that's asleep (no page loaded,
// so its worker can't see it either). { wc } for one that's loaded, { ctl, tab } for one that's asleep.
function siteTab(ses, test, preferWcId = null) {
  let best = null, score = -1;
  const live = new Set();
  for (const wc of WC.getAllWebContents()) {
    if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
    live.add(wc.id);
    if (wc.session !== ses) continue;
    let u = '';
    try { u = wc.getURL(); } catch { continue; }
    if (!test(u)) continue;
    if (wc.id === preferWcId) return { wc };
    const found = ctx.registry && ctx.registry.find(wc.id);
    const s = found ? (found.tab.active ? 2e15 + ctx.registry.focusOrder.indexOf(found.ctl.id) : 1e15 + (Number(found.tab.lastActive) || 0)) : 5e14;
    if (s > score) { best = { wc }; score = s; }
  }
  for (const ctl of ctx.registry ? ctx.registry.list() : []) {
    if (ctl.ses !== ses || ctl.win.isDestroyed()) continue;
    for (const tab of ctl.tabs || []) {
      if ((tab.wcId != null && live.has(tab.wcId)) || !test(String(tab.url || ''))) continue;
      const s = Number(tab.lastActive) || 1;
      if (s > score) { best = { ctl, tab }; score = s; }
    }
  }
  return best;
}

// A tab (or side panel) to the front, in its window: a webContents, or what siteTab() found.
function bringToFront(target) {
  try {
    if (!target) return false;
    let ctl = target.ctl || null;
    const wc = target.tab ? null : (target.wc || target);
    if (wc) {
      if (wc.isDestroyed()) return false;
      const win = BrowserWindow.fromWebContents(wc.hostWebContents || wc);
      ctl = win && ctx.registry.get(win.id);
    }
    if (!ctl || ctl.win.isDestroyed()) return false;
    if (ctl.win.isMinimized()) ctl.win.restore();
    ctl.win.show(); ctl.win.focus();
    if (wc) ctl.send('focus-wc', wc.id); else ctl.send('select-tab', target.tab.id);
    return true;
  } catch { return false; }
}

function list(ses, scope, tag) {
  const out = [];
  for (const r of open.values()) if (r.ses === ses && r.scope === scope && (!tag || r.o.tag === tag)) out.push(view(r));
  return out;
}
function closeOne(ses, scope, id) {
  const r = open.get(Number(id));
  if (r && r.ses === ses && r.scope === scope) drop(r);
}

// After a click: the worker's WindowClient.focus() and clients.openWindow().
function focusClient(ses, scope, url) {
  const origin = originOf(scope);
  if (originOf(url) !== origin || !windowAllowed(ses, origin)) return false;
  const wc = siteTab(ses, (u) => u === url) || siteTab(ses, (u) => originOf(u) === origin);
  return bringToFront(wc);
}
function openWindow(ses, scope, url) {
  const origin = originOf(scope);
  if (!originOf(url) || !windowAllowed(ses, origin)) return false;
  // (that page in a tab that's asleep: that tab, rather than another of the same)
  const asleep = siteTab(ses, (u) => u === url);
  if (asleep && asleep.tab) return bringToFront(asleep);
  let ctl = null;
  for (const id of [...ctx.registry.focusOrder].reverse()) {
    const c = ctx.registry.get(id);
    if (c && !c.win.isDestroyed() && c.ses === ses) { ctl = c; break; }
  }
  if (!ctl) return false;
  if (ctl.win.isMinimized()) ctl.win.restore();
  ctl.win.show(); ctl.win.focus();
  ctl.send('open-url', { url });
  return true;
}

// A website's worker, as it starts: what its preload asks for.
const hooked = new WeakSet();
function hook(ses, sw) {
  if (!sw || hooked.has(sw) || !sw.ipc || !originOf(sw.scope)) return;
  hooked.add(sw);
  const scope = sw.scope;
  try {
    sw.ipc.handle('bifrost:notify-show', (_e, d) => show(ses, scope, d && d.title, d && d.options));
    sw.ipc.handle('bifrost:notify-list', (_e, tag) => list(ses, scope, tag ? String(tag) : ''));
    sw.ipc.handle('bifrost:notify-focus', (_e, url) => focusClient(ses, scope, String(url || '')));
    sw.ipc.handle('bifrost:notify-open', (_e, url) => openWindow(ses, scope, String(url || '')));
    sw.ipc.on('bifrost:notify-close', (_e, id) => closeOne(ses, scope, id));
    sw.ipc.on('bifrost:notification-done', (_e, token) => { const end = tasks.get(token); if (end) end(); });
  } catch (e) { console.warn('[notifications]', e.message); }
}

const attached = new WeakSet();
function attach(ses) {
  if (attached.has(ses)) return;
  attached.add(ses);
  try { ses.registerPreloadScript({ type: 'service-worker', id: 'bifrost-sw-notifications', filePath: PRELOAD }); } catch (e) { console.warn('[notifications]', e.message); return; }
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus !== 'starting' && runningStatus !== 'running') return;
    let sw = null;
    try { sw = ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { sw = null; }
    hook(ses, sw);
  });
}

// From a site's page (preload/tab.js): only for its own site.
function initIpc() {
  const own = (event, scope) => {
    const frame = (event.senderFrame && event.senderFrame.url) || '';
    return originOf(scope) && originOf(scope) === originOf(frame);
  };
  ipcMain.handle('tab:sw-notify-show', (event, d) => {
    const scope = String((d && d.scope) || '');
    if (!own(event, scope)) return { error: 'type' };
    return show(event.sender.session, scope, d.title, d.options, { wcId: event.sender.id });
  });
  ipcMain.handle('tab:sw-notify-list', (event, d) => {
    const scope = String((d && d.scope) || '');
    return own(event, scope) ? list(event.sender.session, scope, d.tag ? String(d.tag) : '') : [];
  });
  ipcMain.on('tab:sw-notify-close', (event, d) => {
    const scope = String((d && d.scope) || '');
    if (own(event, scope)) closeOne(event.sender.session, scope, d.id);
  });
}

module.exports = { attach, initIpc, bringToFront, _open: open };
