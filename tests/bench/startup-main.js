'use strict';
// Loaded into Bifrost's main process by tests/bench/startup.mjs (electron -r): when the window was shown, when
// its UI had loaded and when the first page was in, since the process began, as Electron's own events say. Any
// version of Bifrost can be measured this way (the marks of main/timing.js are only in the ones that have it).
const { app } = require('electron');
const began = process.getCreationTime() || Date.now();
const since = () => Math.round(Date.now() - began);
const out = {};
const set = (name) => { if (out[name] == null) out[name] = since(); };
app.on('browser-window-created', (_e, win) => {
  win.once('show', () => set('shown'));
  if (win.isVisible()) set('shown');
});
app.on('web-contents-created', (_e, wc) => {
  wc.once('did-finish-load', () => {
    const type = wc.getType();
    if (type === 'window') set('ui');
    if (type !== 'webview' || out.page != null) return;
    set('page');
    // (after main/timing.js has printed its own; BENCH_STAY_MS: longer, for the start that makes the profile)
    setTimeout(() => { console.log('[startup] ' + JSON.stringify(out)); app.quit(); }, Number(process.env.BENCH_STAY_MS) || 400);
  });
});
