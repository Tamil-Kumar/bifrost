'use strict';
// Preload for the browser UI (bifrost://ui). The UI is our own code; the main process still checks
// every call's sender.
const { contextBridge, ipcRenderer } = require('electron');
// Errors from the main process arrive as "Error invoking remote method 'x': Error: message"; keep the message.
const rethrow = (e) => { throw new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); };
// The extension system's own channels (crx-*) are only for extension pages.
const ours = (channel) => typeof channel === 'string' && !channel.startsWith('crx-');

contextBridge.exposeInMainWorld('wb', {
  invoke: (channel, ...args) => (ours(channel) ? ipcRenderer.invoke(channel, ...args).catch(rethrow) : Promise.reject(new Error('Not allowed: ' + channel))),
  send: (channel, ...args) => { if (ours(channel)) ipcRenderer.send(channel, ...args); },
  on: (channel, fn) => {
    const h = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  // Extension toolbar buttons (electron-chrome-extensions' browserAction API).
  crx: (name, ...args) => ipcRenderer.invoke('crx-msg-remote', 'persist:main', name, ...args),
  platform: process.platform,
});
