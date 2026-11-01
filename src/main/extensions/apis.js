'use strict';
// chrome.* APIs Bifrost adds on top of Electron and electron-chrome-extensions. The extension side lives
// in preload.js; each module here registers its handlers on the library's IPC router, so permission
// checks, service-worker wake-ups and event delivery work the same way as for the library's own APIs.
const path = require('node:path');

const PRELOAD = path.join(__dirname, 'preload.js');

function install(extensions) {
  const router = extensions.ece.ctx.router;
  const handle = router.apiHandler();
  extensions.router = router;
  const env = { handle, router, extensions };

  // After the library's preload, so it can add to (and then freeze) chrome.*.
  extensions.ses.registerPreloadScript({ id: 'bifrost-extension-apis', type: 'frame', filePath: PRELOAD });
  extensions.ses.registerPreloadScript({ id: 'bifrost-extension-apis-sw', type: 'service-worker', filePath: PRELOAD });

  require('./api-tabs').install(env);
  require('./api-data').install(env);
  require('./api-misc').install(env);
  require('./api-webrequest').install(env);
  require('./sidepanel').install(env);

  // Each extension service worker says which process it runs in (for the task manager).
  extensions.swPids = new Map();
  extensions.ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus === 'stopped') { extensions.swPids.delete(versionId); return; }
    if (runningStatus !== 'starting' && runningStatus !== 'running') return;
    let sw = null;
    try { sw = extensions.ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { /* gone */ }
    if (!sw || !sw.ipc || sw.__bifrostPid) return;
    sw.__bifrostPid = true;
    sw.ipc.on('bifrost-sw-pid', (e, pid) => { if (Number.isInteger(pid)) extensions.swPids.set(versionId, pid); });
  });

  // runtime.onInstalled / onStartup: what the extension's background missed (lifecycle.js, preload.js).
  handle('runtime.pendingLifecycle', (ev, kind) => (extensions.lifecycle ? extensions.lifecycle.take(ev.extension.id, kind === 'startup' ? 'startup' : 'installed') : null));

  // chrome.commands: real shortcuts, and changing them.
  const { Commands } = require('./commands');
  const commands = new Commands(extensions);
  extensions.commands = commands;
  handle('commands.getAll', (ev) => commands.getAll(ev.extension.id));
  handle('commands.update', (ev, d = {}) => { if (d.shortcut !== undefined && d.shortcut !== null) commands.set(ev.extension.id, String(d.name || ''), String(d.shortcut)); });
  handle('commands.reset', (ev, name) => { commands.set(ev.extension.id, String(name || ''), null); });
  for (const e of extensions.ses.extensions.getAllExtensions()) commands.load(e);
  extensions.ses.extensions.on('extension-loaded', (e, ext) => commands.load(ext));
  extensions.ses.extensions.on('extension-unloaded', (e, ext) => commands.unload(ext.id));
}

module.exports = { install, PRELOAD };
