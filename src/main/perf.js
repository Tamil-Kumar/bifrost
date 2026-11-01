'use strict';
// Performance profiles on the main side: switches that need a restart, background throttling for tabs,
// and the memory readout in Settings. (The UI handles tab sleeping, animations and visual effects.)
const { app, webContents } = require('electron');
const { perf } = require('../shared/defaults');
const ctx = require('./context');

function current() { return perf({ performance: ctx.settings.get('performance') }); }

// Before app 'ready': Chromium switches that only apply at startup.
function applyStartupSwitches(settings) {
  const p = perf({ performance: settings.get('performance') });
  if (p.rendererLimit > 0) app.commandLine.appendSwitch('renderer-process-limit', String(Math.max(2, Math.min(64, p.rendererLimit))));
  if (!p.backgroundThrottling) {
    // Full speed for background tabs: timers and rendering aren't slowed down.
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }
  return p;
}

// Applies background throttling to every open tab (new tabs get it from their web preferences).
function applyToTabs() {
  const p = current();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || wc.getType() !== 'webview') continue;
    try { wc.setBackgroundThrottling(!!p.backgroundThrottling); } catch { /* gone */ }
  }
}

// What Bifrost is using right now, by kind of process (working set, in MB).
function usage() {
  const kinds = { browser: 0, tabs: 0, gpu: 0, other: 0 };
  let total = 0, procs = 0;
  for (const m of app.getAppMetrics()) {
    const mb = ((m.memory && m.memory.workingSetSize) || 0) / 1024;
    total += mb;
    procs++;
    if (m.type === 'Browser') kinds.browser += mb;
    else if (m.type === 'Tab') kinds.tabs += mb;
    else if (m.type === 'GPU') kinds.gpu += mb;
    else kinds.other += mb;
  }
  const round = (x) => Math.round(x);
  return { total: round(total), processes: procs, browser: round(kinds.browser), tabs: round(kinds.tabs), gpu: round(kinds.gpu), other: round(kinds.other), profile: ctx.settings.get('performance.profile') };
}

module.exports = { current, applyStartupSwitches, applyToTabs, usage };
