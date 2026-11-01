'use strict';
// Downloads: saved to the chosen folder (or asked), tracked live in every window, kept in history.
const { app, shell, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const ctx = require('./context');

const live = new Map();     // record id -> { item, rec }
const privateRecs = new Map();
let privSeq = 1e9;
// 'created' (rec), 'updated' (rec), 'done' (rec), 'erased' (id): for chrome.downloads.
const events = new EventEmitter();
// Downloads started on someone's behalf (chrome.downloads.download) wait here for their item.
const expected = [];

function expect(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const e = { url, opts, resolve, reject };
    e.timer = setTimeout(() => { const i = expected.indexOf(e); if (i >= 0) expected.splice(i, 1); reject(new Error('The download did not start')); }, 60000);
    expected.push(e);
  });
}

function takeExpected(item) {
  const chain = item.getURLChain();
  const i = expected.findIndex((e) => e.url === item.getURL() || chain.includes(e.url));
  if (i < 0) return null;
  const [e] = expected.splice(i, 1);
  clearTimeout(e.timer);
  return e;
}

// A relative path inside the downloads folder ("photos/cat.png"), like chrome.downloads allows.
function safeRelative(name) {
  const parts = String(name || '').split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..').map(safeFileName);
  return parts.length ? path.join(...parts) : '';
}

function folder() {
  const f = ctx.settings.get('downloads.folder');
  if (f && fs.existsSync(f)) return f;
  return app.getPath('downloads');
}

// A file name that's safe on every system: no path parts, no leading dots, no trailing dots or spaces
// (Windows drops them, which can change the extension), and none of Windows' device names (CON, NUL…).
function safeFileName(name) {
  let safe = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '_').slice(0, 200).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(safe)) safe = '_' + safe;
  return safe || 'download';
}

function uniquePath(dir, name) {
  const safe = safeFileName(name);
  const ext = path.extname(safe), base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe), i = 1;
  while (fs.existsSync(p) || [...live.values()].some((l) => l.rec.path === p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

function broadcast(rec) {
  for (const ctl of ctx.registry.list()) {
    if (rec.private && !ctl.isPrivate) continue;
    ctl.send('download-updated', rec);
  }
  // Internal downloads pages listen too.
  for (const wc of require('electron').webContents.getAllWebContents()) {
    if (wc.getType() === 'webview' && wc.getURL().startsWith('bifrost://downloads')) wc.send('download-updated', rec);
  }
}

function attach(ses, { isPrivate }) {
  ses.on('will-download', (event, item, wc) => {
    // A file from an address on the dangerous-sites lists (most of URLhaus's are files) isn't saved.
    const chain = (() => { try { return item.getURLChain(); } catch { return [item.getURL()]; } })();
    const hit = ctx.safety ? chain.map((u) => ctx.safety.check(u, 'mainFrame')).find(Boolean) : null;
    if (hit) {
      event.preventDefault();
      const found = wc && !wc.isDestroyed() ? ctx.registry.find(wc.id) : null;
      const ctl = found ? found.ctl : ctx.registry.lastFocused();
      if (ctl) ctl.send('dangerous-download', { url: item.getURL(), filename: item.getFilename(), kind: hit.kind, list: hit.listName });
      return;
    }
    const exp = takeExpected(item);
    let ask = ctx.settings.get('downloads.askWhereToSave');
    let savePath = uniquePath(folder(), item.getFilename());
    if (exp) {
      const rel = safeRelative(exp.opts.filename);
      if (rel) {
        const want = path.join(folder(), rel);
        try { fs.mkdirSync(path.dirname(want), { recursive: true }); } catch { /* falls back below */ }
        savePath = exp.opts.conflictAction === 'overwrite' ? want : uniquePath(path.dirname(want), path.basename(want));
      }
      if (typeof exp.opts.saveAs === 'boolean') ask = exp.opts.saveAs;
    }
    if (ask) {
      item.setSaveDialogOptions({ defaultPath: savePath, title: 'Save file' });
    } else {
      item.setSavePath(savePath);
    }
    const rec = {
      id: 0, url: item.getURL(), filename: ask ? item.getFilename() : path.basename(savePath), path: ask ? '' : savePath, mime: item.getMimeType(),
      total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, started: Date.now(), ended: 0,
      private: isPrivate, speed: 0, referrer: item.getURLChain()[0] || '', byExtensionId: exp ? exp.opts.extensionId || '' : '',
    };
    // A link that opened a new tab just to download something leaves that tab empty: close it, as Chrome
    // does. (A tab that was showing a page keeps it.)
    if (wc && !wc.isDestroyed() && wc.getType() === 'webview') {
      let entries = 0;
      try { entries = wc.navigationHistory.length(); } catch { entries = 0; }
      const shown = wc.getURL();
      if (entries <= 1 && (!shown || shown === 'about:blank' || shown === item.getURL())) {
        setTimeout(() => {
          if (wc.isDestroyed()) return;
          const now = wc.getURL();
          if (!now || now === 'about:blank' || now === item.getURL()) {
            const found = ctx.registry.find(wc.id);
            if (found) found.ctl.send('extension-tab-action', { wcId: wc.id, action: 'close' });
          }
        }, 150);
      }
    }
    if (isPrivate) { rec.id = privSeq++; privateRecs.set(rec.id, rec); }
    else rec.id = ctx.db.addDownload({ url: rec.url, filename: rec.filename, path: rec.path, mime: rec.mime, total: rec.total, started: rec.started, referrer: rec.referrer });
    live.set(rec.id, { item, rec });
    if (exp) exp.resolve(rec.id);
    if (!isPrivate) events.emit('created', rec, item);

    let lastBytes = 0, lastTime = Date.now(), lastEmit = 0;
    const persist = () => { if (!isPrivate) ctx.db.updateDownload(rec.id, rec); };
    item.on('updated', (e, state) => {
      rec.path = item.getSavePath() || rec.path;
      rec.filename = rec.path ? path.basename(rec.path) : rec.filename;
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes();
      rec.paused = item.isPaused();
      rec.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      const now = Date.now();
      if (now - lastTime >= 500) { rec.speed = Math.max(0, (rec.received - lastBytes) * 1000 / (now - lastTime)); lastBytes = rec.received; lastTime = now; }
      if (now - lastEmit > 200 || rec.state !== 'progressing') { lastEmit = now; broadcast(rec); if (!isPrivate) events.emit('updated', rec, item); }
    });
    item.once('done', (e, state) => {
      rec.path = item.getSavePath() || rec.path;
      rec.filename = rec.path ? path.basename(rec.path) : rec.filename;
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes() || rec.received;
      rec.state = state; // completed | cancelled | interrupted
      rec.ended = Date.now();
      rec.speed = 0;
      persist();
      live.delete(rec.id);
      broadcast(rec);
      if (!isPrivate) events.emit('done', rec, item);
      if (state === 'completed' && process.platform === 'win32') {
        const win = BrowserWindow.getFocusedWindow();
        if (win && win.isMinimized()) win.flashFrame(true);
      }
    });
    if (ctx.settings.get('downloads.showOnStart')) {
      const host = wc && (wc.hostWebContents || wc);
      const win = host && BrowserWindow.fromWebContents(host);
      const ctl = win && ctx.registry.get(win.id);
      if (ctl) ctl.send('download-started', rec);
    }
    broadcast(rec);
  });
}

function list() {
  const out = [];
  for (const { rec } of live.values()) out.push(rec);
  for (const r of ctx.db.downloads(300)) {
    if (live.has(r.id)) continue;
    out.push({ id: r.id, url: r.url, filename: r.filename, path: r.path, mime: r.mime, total: r.total, received: r.received, state: r.state === 'progressing' ? 'interrupted' : r.state, started: r.started, ended: r.ended, paused: false, exists: r.path ? fs.existsSync(r.path) : false });
  }
  return out.sort((a, b) => b.started - a.started);
}

// Files that run code when opened. Opening one from Bifrost asks first.
const RUNNABLE = new Set(['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'bat', 'cmd', 'com', 'cpl', 'scr', 'pif',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ws', 'hta', 'lnk', 'url', 'reg', 'jar', 'application', 'appref-ms', 'gadget',
  'msc', 'msp', 'mst', 'scf', 'inf', 'ins', 'isp', 'sct', 'shb', 'xbap', 'library-ms', 'settingcontent-ms', 'search-ms', 'iso', 'img', 'vhd', 'vhdx',
  'sh', 'run', 'bin', 'appimage', 'deb', 'rpm', 'desktop', 'app', 'command', 'pkg', 'dmg']);
const isRunnable = (p) => RUNNABLE.has(path.extname(p).slice(1).toLowerCase());

async function openFile(p) {
  if (isRunnable(p)) {
    const { dialog } = require('electron');
    const win = BrowserWindow.getFocusedWindow() || undefined;
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: `Open ${path.basename(p)}?`,
      detail: 'This kind of file can run programs and change your computer. Open it only if you trust where it came from.',
    });
    if (r.response !== 0) return false;
  }
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return true;
}

function action(id, what) {
  id = Number(id);
  const l = live.get(id);
  switch (what) {
    case 'pause': if (l && l.item.canResume()) l.item.pause(); return true;
    case 'resume': if (l && l.item.canResume()) l.item.resume(); return true;
    case 'cancel': if (l) l.item.cancel(); return true;
    case 'open': { const p = l ? '' : pathOf(id); if (!p || !fs.existsSync(p)) throw new Error('The file is missing or still downloading.'); return openFile(p); }
    case 'show': { const p = pathOf(id); if (p && fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(folder()); return true; }
    case 'remove': if (!l) { ctx.db.removeDownload(id); privateRecs.delete(id); events.emit('erased', id); } return true;
    case 'delete': { const p = pathOf(id); if (!l && p && fs.existsSync(p)) fs.rmSync(p, { force: true }); ctx.db.removeDownload(id); events.emit('erased', id); return true; }
    case 'deleteFile': { const p = pathOf(id); if (l) throw new Error('Download must be complete'); if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); return true; }
    case 'retry': {
      const r = ctx.db.downloads(1000).find((x) => x.id === id) || privateRecs.get(id);
      if (!r) return false;
      // A private download retries in a private window's session (never in the normal profile).
      const ses = r.private ? (ctx.registry.list().find((c) => c.isPrivate && c.ses) || {}).ses : ctx.mainSession;
      if (!ses) throw new Error('Open a private window to retry this download.');
      ses.downloadURL(r.url);
      return true;
    }
    default: throw new Error('unknown download action');
  }
}

function pathOf(id) {
  const l = live.get(id);
  if (l) return l.rec.path;
  const p = privateRecs.get(id);
  if (p) return p.path;
  const r = ctx.db.downloads(1000).find((x) => x.id === id);
  return r ? r.path : '';
}

function clear() { ctx.db.clearDownloads(); for (const [id, r] of privateRecs) if (r.state !== 'progressing') privateRecs.delete(id); }
function activeCount() { return live.size; }
function liveItem(id) { const l = live.get(Number(id)); return l ? l.item : null; }

module.exports = { attach, list, action, clear, folder, activeCount, events, expect, liveItem };
