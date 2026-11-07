'use strict';
// Site permissions: camera/microphone, location, notifications, clipboard, screen sharing, MIDI…
// Decisions are asked in the browser UI (a prompt under the address bar) and remembered per site.
const { BrowserWindow, dialog, desktopCapturer, ipcMain, webContents: WC } = require('electron');
const ctx = require('./context');

const ALWAYS = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'speaker-selection', 'mediaKeySystem', 'top-level-storage-access']);
const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'idle-detection', 'window-management', 'storage-access', 'openExternal', 'display-capture', 'hid', 'serial', 'usb', 'fileSystem']);
const LABEL = {
  media: 'use your camera or microphone', camera: 'use your camera', microphone: 'use your microphone', geolocation: 'know your location',
  notifications: 'show notifications', midi: 'use your MIDI devices', midiSysex: 'control your MIDI devices', 'clipboard-read': 'see text and images you copy',
  'idle-detection': 'know when you’re away', 'window-management': 'manage windows on your screens', 'storage-access': 'use its cookies on other sites',
  openExternal: 'open an app on your computer', 'display-capture': 'share your screen', hid: 'use HID devices', serial: 'use serial ports', usb: 'use USB devices', fileSystem: 'edit files on your computer',
};

function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome-extension:' || u.protocol === 'bifrost:') return u.protocol + '//' + u.hostname;
    return u.origin;
  } catch { return ''; }
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

// Answers given just for now ("Remember for this site" unticked, and every answer in a private window):
// they hold until Bifrost closes. private|host|perm → 'allow' | 'block'.
const sessionDecisions = new Map();
const skey = (isPrivate, host, perm) => (isPrivate ? 'p|' : 'n|') + host + '|' + perm;

// The decision for a site: 'allow' | 'block' | undefined (ask). A remembered one, or one for now.
function decision(host, perm, isPrivate = false) {
  if (!host) return undefined;
  const now = sessionDecisions.get(skey(isPrivate, host, perm));
  if (now) return now;
  return ctx.db.siteSettings(host)['perm:' + perm];
}

// Set from the address bar's permissions button or the site's info (value null: ask again). Pages from
// that site hear of it straight away (preload/tab.js: Notification.permission follows without a reload).
function setDecision(host, perm, value) {
  for (const k of [skey(false, host, perm), skey(true, host, perm)]) sessionDecisions.delete(k);
  ctx.db.setSiteSetting(host, 'perm:' + perm, value || null);
  pushState(host);
}
function pushState(host) {
  for (const wc of WC.getAllWebContents()) {
    if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
    let frames = [];
    try { frames = wc.mainFrame.framesInSubtree; } catch { continue; }
    const isPrivate = !!(wc.session && wc.session.__bifrostPrivate);
    for (const f of frames) {
      if (hostOf(f.url) !== host) continue;
      try { f.send('tab-perm', { notifications: decision(host, 'notifications', isPrivate) || null }); } catch { /* frame gone */ }
    }
  }
}

// What the page asked for and what it got: the window shows it on the address bar's permissions button.
function tellWindow(wc, host, keys, allowed, asked) {
  try {
    const ctl = ownerController(wc);
    if (ctl && wc.getType() === 'webview') ctl.send('perm-asked', { wcId: wc.id, host, keys, allowed: !!allowed, asked: !!asked });
  } catch { /* window gone */ }
}

// For the tab preload: the page's own view of its notifications permission (Notification.permission), asked
// before the page's scripts run.
function initIpc() {
  ipcMain.on('tab:perm-state', (event) => {
    let v = null;
    try {
      const wc = event.sender;
      const isPrivate = !!(wc.session && wc.session.__bifrostPrivate);
      // (the asking frame's own site: never another's)
      v = decision(hostOf((event.senderFrame && event.senderFrame.url) || wc.getURL()), 'notifications', isPrivate) || null;
    } catch { v = null; }
    event.returnValue = v;
  });
  // A site's notification was clicked: its tab comes to the front, in its window.
  ipcMain.on('tab:notification-click', (event) => { require('./notifications').bringToFront(event.sender); });
}

function permKeys(permission, details) {
  if (permission === 'media') {
    const types = (details && details.mediaTypes) || [];
    const keys = [];
    if (types.includes('video')) keys.push('camera');
    if (types.includes('audio')) keys.push('microphone');
    return keys.length ? keys : ['camera', 'microphone'];
  }
  return [permission];
}

function ownerController(wc) {
  if (!wc || wc.isDestroyed()) return null;
  const host = wc.hostWebContents || wc;
  const win = BrowserWindow.fromWebContents(host);
  return win ? ctx.registry.get(win.id) : null;
}

const pending = new Map(); // dedupe identical concurrent prompts

async function prompt(wc, permission, details, origin, keys) {
  const ctl = ownerController(wc);
  const host = hostOf(origin);
  const dedupe = wc.id + '|' + origin + '|' + keys.join(',');
  if (pending.has(dedupe)) return pending.get(dedupe);
  const p = (async () => {
    if (ctl && wc.getType() === 'webview') {
      try {
        const r = await ctl.request('permission-prompt', { wcId: wc.id, origin, host, permission, keys, labels: keys.map((k) => LABEL[k] || k), externalUrl: details && details.externalURL }, 120000);
        return r || { allow: false, remember: false };
      } catch { return { allow: false, remember: false }; }
    }
    const win = BrowserWindow.fromWebContents(wc) || undefined;
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1,
      message: `${host || origin} wants to ${keys.map((k) => LABEL[k] || k).join(' and ')}`,
      checkboxLabel: 'Remember for this site', checkboxChecked: true,
    });
    return { allow: r.response === 0, remember: r.checkboxChecked };
  })();
  pending.set(dedupe, p);
  try { return await p; } finally { pending.delete(dedupe); }
}

function attach(ses, { isPrivate }) {
  ses.__bifrostPrivate = !!isPrivate;
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    try {
      const url = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()) || '';
      const origin = originOf(url);
      if (ALWAYS.has(permission)) return callback(true);
      if (origin.startsWith('bifrost://')) return callback(true);
      if (origin.startsWith('chrome-extension://')) return callback(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen', 'openExternal'].includes(permission));
      if (!ASK.has(permission)) return callback(false);
      const host = hostOf(origin);
      if (permission === 'openExternal') {
        const ext = details && details.externalURL;
        if (ext && /^(https?|mailto|tel):/i.test(ext)) return callback(true);
      }
      const keys = permKeys(permission, details);
      const stored = keys.map((k) => decision(host, k, isPrivate));
      if (stored.every((d) => d === 'allow')) { tellWindow(wc, host, keys, true, false); return callback(true); }
      if (stored.some((d) => d === 'block')) { tellWindow(wc, host, keys, false, false); return callback(false); }
      const r = await prompt(wc, permission, details, origin, keys);
      if (host) {
        if (r.remember && !isPrivate) for (const k of keys) ctx.db.setSiteSetting(host, 'perm:' + k, r.allow ? 'allow' : 'block');
        // (just for now: until Bifrost closes, so what the page is told and what it's let do agree)
        else for (const k of keys) sessionDecisions.set(skey(isPrivate, host, k), r.allow ? 'allow' : 'block');
        if (keys.includes('notifications')) pushState(host);
      }
      tellWindow(wc, host, keys, !!r.allow, true);
      callback(!!r.allow);
    } catch (e) {
      console.error('[permissions]', e);
      callback(false);
    }
  });

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (ALWAYS.has(permission)) return true;
    const origin = originOf(requestingOrigin || (details && details.requestingUrl) || '');
    if (origin.startsWith('bifrost://')) return true;
    if (origin.startsWith('chrome-extension://')) return true;
    const host = hostOf(origin);
    const keys = permKeys(permission, details);
    const stored = keys.map((k) => decision(host, k, isPrivate));
    if (stored.some((d) => d === 'block')) return false;
    if (stored.every((d) => d === 'allow')) return true;
    // Unset: let sites ask for camera/mic/location (the request then prompts). Notifications: not yet (a
    // notification can't show), but the page is told "not decided" rather than "blocked" (preload/tab.js),
    // so it asks, as it would in any browser.
    return permission === 'media' || permission === 'geolocation' || permission === 'clipboard-read';
  });

  // Screen sharing picker.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const wc = request.frame && WC.fromFrame ? WC.fromFrame(request.frame) : null;
      const ctl = ownerController(wc) || ctx.registry.lastFocused();
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
      const list = sources.map((s) => ({ id: s.id, name: s.name, type: s.id.startsWith('screen') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '' }));
      const origin = originOf(request.securityOrigin || (request.frame && request.frame.url) || '');
      const choice = ctl ? await ctl.request('screen-picker', { origin, sources: list, audio: !!request.audioRequested }, 300000) : null;
      if (!choice || !choice.id) return callback({});
      const src = sources.find((s) => s.id === choice.id);
      if (!src) return callback({});
      const out = { video: src };
      if (choice.audio && process.platform === 'win32') out.audio = 'loopback';
      callback(out);
    } catch (e) {
      console.error('[screen share]', e);
      callback({});
    }
  });

  if (ses.setDevicePermissionHandler) {
    ses.setDevicePermissionHandler((d) => decision(hostOf(d.origin), d.deviceType, isPrivate) === 'allow');
  }
}

// A site's decisions (remembered, and for now in this window: forNow marks those).
function listForHost(host, isPrivate = false) {
  const s = ctx.db.siteSettings(host);
  const out = {};
  for (const [k, v] of Object.entries(s)) if (k.startsWith('perm:')) out[k.slice(5)] = v;
  const forNow = [];
  for (const [k, v] of sessionDecisions) {
    const [p, h, perm] = k.split('|');
    if (h === host && (p === 'p') === !!isPrivate) { out[perm] = v; forNow.push(perm); }
  }
  if (forNow.length) out.__forNow = forNow;
  return out;
}

module.exports = { attach, initIpc, listForHost, setDecision, decision, LABEL, originOf };
