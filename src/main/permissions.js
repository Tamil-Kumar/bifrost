'use strict';
// Site permissions: camera/microphone, location, notifications, clipboard, screen sharing, MIDI…
// Decisions are asked in the browser UI (a prompt under the address bar) and remembered per site.
const { BrowserWindow, dialog, desktopCapturer, webContents: WC } = require('electron');
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

// Stored decision for a site: 'allow' | 'block' | undefined
function decision(host, perm) {
  if (!host) return undefined;
  return ctx.db.siteSettings(host)['perm:' + perm];
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
      const stored = keys.map((k) => decision(host, k));
      if (stored.every((d) => d === 'allow')) return callback(true);
      if (stored.some((d) => d === 'block')) return callback(false);
      const r = await prompt(wc, permission, details, origin, keys);
      if (r.remember && host && !isPrivate) for (const k of keys) ctx.db.setSiteSetting(host, 'perm:' + k, r.allow ? 'allow' : 'block');
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
    const stored = keys.map((k) => decision(host, k));
    if (stored.some((d) => d === 'block')) return false;
    if (stored.every((d) => d === 'allow')) return true;
    // Unset: let sites ask for camera/mic/location (the request then prompts); report notifications as off.
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
    ses.setDevicePermissionHandler((d) => decision(hostOf(d.origin), d.deviceType) === 'allow');
  }
}

function listForHost(host) {
  const s = ctx.db.siteSettings(host);
  const out = {};
  for (const [k, v] of Object.entries(s)) if (k.startsWith('perm:')) out[k.slice(5)] = v;
  return out;
}

module.exports = { attach, listForHost, LABEL, originOf };
