'use strict';
// Loaded into Bifrost's main process by tests/bench/pageload.mjs (electron -r): once the first tab is there,
// loads the bench page in it over and over and prints how long each load took, as the page saw it.
const { app, webContents } = require('electron');
const URL_ = process.env.BENCH_URL, RUNS = Number(process.env.BENCH_RUNS || 15), MODE = process.env.BENCH_MODE || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `new Promise((resolve) => {
  const done = () => setTimeout(() => { const n = performance.getEntriesByType('navigation')[0]; resolve({ load: n.loadEventEnd, dcl: n.domContentLoadedEventEnd, first: n.responseStart, resources: performance.getEntriesByType('resource').length, frames: window.__frames || 0 }); }, 0);
  if (document.readyState === 'complete') done(); else addEventListener('load', done);
})`;
app.whenReady().then(async () => {
  let wc = null;
  for (let i = 0; i < 300 && !wc; i++) { await sleep(100); wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && !w.isLoading() && /^http/.test(w.getURL())) || null; }
  if (!wc) { console.log('[bench] no tab'); app.quit(); return; }
  await sleep(1500);
  if (MODE === 'before-only') { const wr = wc.session.webRequest; wr.onBeforeSendHeaders(null); wr.onHeadersReceived(null); }
  if (MODE === 'no-received') { wc.session.webRequest.onHeadersReceived(null); }
  if (MODE === 'no-send') { wc.session.webRequest.onBeforeSendHeaders(null); }
  if (MODE === 'trivial') { const wr = wc.session.webRequest; wr.onBeforeSendHeaders(null); wr.onHeadersReceived(null); wr.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({})); }
  if (MODE === 'bare') {
    // (nothing of Bifrost's on the requests at all: the floor)
    const wr = wc.session.webRequest;
    wr.onBeforeRequest(null); wr.onBeforeSendHeaders(null); wr.onHeadersReceived(null);
    try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* none */ }
  }
  const out = [];
  for (let i = 0; i < RUNS + 3; i++) {
    try { await wc.loadURL(URL_ + 'run=' + i); } catch (e) { console.log('[bench] load failed', e.message); }
    const r = await wc.executeJavaScript(PAGE, true);
    if (i >= 3) out.push(r);   // (the first few warm things up)
    await sleep(150);
  }
  console.log('[bench] ' + JSON.stringify(out));
  setTimeout(() => app.quit(), 200);
});
