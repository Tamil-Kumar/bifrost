'use strict';
// Task manager data: memory and CPU per tab, extension, and browser process.
const { app, webContents: WC, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const ctx = require('./context');

// An extension's icon as a small data URL (for the task manager), read once.
const extIcons = new Map();
function extIcon(ext) {
  if (!ext) return '';
  if (extIcons.has(ext.id)) return extIcons.get(ext.id);
  let url = '';
  try {
    const icons = (ext.manifest && ext.manifest.icons) || {};
    const size = Object.keys(icons).map(Number).filter((n) => n >= 16).sort((a, b) => a - b)[0] || Object.keys(icons).map(Number).sort((a, b) => b - a)[0];
    if (size) {
      const img = nativeImage.createFromPath(path.join(ext.path, String(icons[size]).replace(/^\//, '')));
      if (!img.isEmpty()) url = img.resize({ width: 32, height: 32, quality: 'best' }).toDataURL();
    }
  } catch { /* no icon */ }
  extIcons.set(ext.id, url);
  return url;
}

const extOf = (url) => {
  const m = /^chrome-extension:\/\/([a-p]{32})/.exec(url || '');
  return m && ctx.mainSession ? ctx.mainSession.extensions.getExtension(m[1]) : null;
};

function metrics() {
  const procs = app.getAppMetrics();
  const byPid = new Map(procs.map((p) => [p.pid, { pid: p.pid, type: p.type, cpu: p.cpu ? p.cpu.percentCPUUsage : 0, memoryKB: p.memory ? p.memory.workingSetSize : 0, name: p.name || p.serviceName || '', items: [] }]));
  for (const wc of WC.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    const pid = wc.getOSProcessId();
    const entry = byPid.get(pid);
    if (!entry) continue;
    const type = wc.getType();
    const url = wc.getURL();
    const ext = extOf(url);
    let label;
    if (type === 'webview' && !ext) {
      const known = ctx.registry.find(wc.id);
      const tab = known && known.tab;
      label = { kind: 'tab', title: wc.getTitle() || (tab && tab.title) || url || 'New tab', url, wcId: wc.id, audible: wc.isCurrentlyAudible(), favicon: (tab && /^(https?|data|bifrost):/.test(tab.favicon || '') ? tab.favicon : '') };
    } else if (ext) {
      const what = type === 'backgroundPage' ? 'background page' : /popup/i.test(url) ? 'popup' : 'page';
      label = { kind: 'extension', title: `${ext.name} (${what})`, url, wcId: wc.id, favicon: extIcon(ext) };
    } else if (type === 'window' && url.startsWith('bifrost://ui')) label = { kind: 'ui', title: 'Browser window', url, wcId: wc.id };
    else label = { kind: 'window', title: wc.getTitle() || url || 'Window', url, wcId: wc.id };
    entry.items.push(label);
  }
  // Extension service workers (their process ID comes from the worker itself: see extensions/apis.js).
  if (ctx.mainSession && ctx.extensions) {
    const running = ctx.mainSession.serviceWorkers.getAllRunning();
    for (const [versionId, sw] of Object.entries(running)) {
      const ext = extOf(sw.scope);
      if (!ext) continue;
      const pid = ctx.extensions.swPids && ctx.extensions.swPids.get(Number(versionId));
      const entry = pid != null ? byPid.get(pid) : null;
      if (entry) entry.items.push({ kind: 'extension', title: ext.name, url: sw.scope, favicon: extIcon(ext) });
    }
  }
  // What's left: say what each process is for.
  const NAMES = { Browser: 'Bifrost', GPU: 'Graphics (GPU)', Zygote: 'Process launcher', Sandbox_helper: 'Sandbox helper', 'Pepper Plugin': 'Plugin' };
  for (const p of byPid.values()) {
    if (p.items.length) continue;
    if (p.type === 'Tab') p.name = 'Spare process (ready for the next page)';
    else if (p.type === 'Utility') p.name = p.name || 'Utility';
    else p.name = NAMES[p.type] || p.name || p.type;
  }
  return [...byPid.values()].sort((a, b) => b.memoryKB - a.memoryKB);
}

function kill(pid) {
  for (const wc of WC.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.getOSProcessId() === pid && wc.getType() === 'webview') { wc.forcefullyCrashRenderer(); return true; }
  }
  return false;
}

module.exports = { metrics, kill };
