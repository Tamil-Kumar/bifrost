'use strict';
// IPC registration with sender checks. Every privileged channel states who may call it:
//   'ui'        the browser UI (bifrost://ui) only
//   'internal'  the UI or any internal page (bifrost://settings, bifrost://history, ...)
//   [hosts]     specific internal pages (plus the UI)
// Calls from web pages, iframes or extension pages are rejected.
const { ipcMain } = require('electron');

function frameInfo(event) {
  const frame = event.senderFrame;
  if (!frame) return null;
  let url;
  try { url = new URL(frame.url); } catch { return null; }
  const top = frame.parent == null;
  return { protocol: url.protocol, host: url.hostname, top, url: frame.url };
}

function allowed(event, access) {
  const f = frameInfo(event);
  if (!f || !f.top || f.protocol !== 'bifrost:') return false;
  if (access === 'internal') return true;
  if (access === 'ui') return f.host === 'ui';
  if (Array.isArray(access)) return f.host === 'ui' || access.includes(f.host);
  return false;
}

const registered = new Set();

function handle(channel, access, fn) {
  if (registered.has(channel)) throw new Error('duplicate ipc channel ' + channel);
  registered.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    if (!allowed(event, access)) {
      const f = frameInfo(event);
      throw new Error(`${channel} is not available to ${f ? f.url : 'this frame'}`);
    }
    return fn(event, ...args);
  });
}

function on(channel, access, fn) {
  if (registered.has(channel)) throw new Error('duplicate ipc channel ' + channel);
  registered.add(channel);
  ipcMain.on(channel, (event, ...args) => {
    if (!allowed(event, access)) return;
    try { fn(event, ...args); } catch (e) { console.error('[ipc]', channel, e); }
  });
}

module.exports = { handle, on, allowed, frameInfo };
