'use strict';
// Electron allows one listener per webRequest event per session, so every feature that needs requests
// (ad blocking, HTTPS-only, privacy headers, per-site user agents, the extension webRequest bridge)
// registers here instead. Handlers run in order; the first one that blocks or redirects wins.
// Requests for local files (file://) go only to the file guard (file-guard.js), never to those handlers
// or to extensions.
const fileGuard = require('./file-guard');
const hubs = new WeakMap();
const isFile = (url) => /^file:/i.test(url);

class WebRequestHub {
  constructor(ses) {
    this.ses = ses;
    this.before = [];          // (details) => undefined | { cancel } | { redirectURL }
    this.sendHeaders = [];     // (details, headers) => void   (mutate headers)
    this.headersReceived = []; // (details, headers) => boolean (true if headers were changed)
    this.observers = { beforeRequest: [], sendHeaders: [], headersReceived: [], responseStarted: [], beforeRedirect: [], completed: [], errorOccurred: [] };
    // Web requests only: Bifrost's own pages (bifrost://) and extensions' files never go through here,
    // which keeps them fast (each event is a round trip to this process for every request).
    const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
    const withFiles = { urls: filter.urls.concat('file://*/*') };
    const wr = ses.webRequest;
    this.wr = wr;
    this.filter = filter;
    this.attachedObservers = new Set();

    wr.onBeforeRequest(withFiles, (d, cb) => {
      if (isFile(d.url)) { let r = null; try { r = fileGuard.check(d); } catch (e) { console.error('[webrequest] file', e); } cb(r || {}); return; }
      let res = {};
      for (const fn of this.before) {
        let r;
        try { r = fn(d); } catch (e) { console.error('[webrequest] before', e); }
        if (r && (r.cancel || r.redirectURL)) { res = r; break; }
      }
      cb(res);
      this.notify('beforeRequest', d, res);
    });

    // Request headers: only while something changes them (wantHeaders(): privacy headers, a site's own user
    // agent…) or an extension watches them, since it's a second round trip here for every request.
    this.wantHeaders = () => true;
    this.headersOn = false;
    this.onSend = (d, cb) => {
      const headers = Object.assign({}, d.requestHeaders);
      for (const fn of this.sendHeaders) { try { fn(d, headers); } catch (e) { console.error('[webrequest] headers', e); } }
      cb({ requestHeaders: headers });
      if (this.observers.sendHeaders.length) this.notify('sendHeaders', Object.assign({}, d, { requestHeaders: headers }));
    };

    // Answers. What's changed in them is a page's or a frame's Content-Security-Policy (the ad blocker's, and
    // a local file's), so only theirs come here, not every picture's and script's: until an extension watches
    // answers (observe), which wants them all.
    const onReceived = (d, cb) => {
      if (isFile(d.url)) { let h = null; try { h = fileGuard.headers(d); } catch (e) { console.error('[webrequest] file', e); } cb(h ? { responseHeaders: h } : {}); return; }
      const headers = Object.assign({}, d.responseHeaders || {});
      let changed = false;
      for (const fn of this.headersReceived) { try { if (fn(d, headers)) changed = true; } catch (e) { console.error('[webrequest] received', e); } }
      cb(changed ? { responseHeaders: headers } : {});
      this.notify('headersReceived', d);
    };
    const documents = { urls: withFiles.urls, types: ['mainFrame', 'subFrame', 'object'] };
    this.receivedAll = false;
    this.attachReceived = () => {
      try { wr.onHeadersReceived(this.receivedAll ? withFiles : documents, onReceived); }
      catch { this.receivedAll = true; wr.onHeadersReceived(withFiles, onReceived); }
    };
    this.attachReceived();

    // The events only extensions watch (chrome.webRequest) are attached when one starts watching.
  }

  // Attaches or lets go of the request headers' event, as it's needed now.
  syncHeaders() {
    let want = this.observers.sendHeaders.length > 0;
    if (!want && this.sendHeaders.length) { try { want = !!this.wantHeaders(); } catch { want = true; } }
    if (want === this.headersOn) return;
    this.headersOn = want;
    if (want) this.wr.onBeforeSendHeaders(this.filter, this.onSend);
    else this.wr.onBeforeSendHeaders(null);
  }

  // Adds a watcher; the matching webRequest event is attached the first time it's needed.
  observe(kind, fn) {
    this.observers[kind].push(fn);
    if (kind === 'sendHeaders') this.syncHeaders();
    if (kind === 'headersReceived' && !this.receivedAll) { this.receivedAll = true; this.attachReceived(); }
    const ev = { responseStarted: 'onResponseStarted', beforeRedirect: 'onBeforeRedirect', completed: 'onCompleted', errorOccurred: 'onErrorOccurred' }[kind];
    if (ev && !this.attachedObservers.has(kind)) {
      this.attachedObservers.add(kind);
      this.wr[ev](this.filter, (d) => this.notify(kind, d));
    }
  }

  notify(kind, details, extra) {
    const list = this.observers[kind];
    if (!list.length) return;
    for (const fn of list) { try { fn(details, extra); } catch (e) { console.error('[webrequest] observer', kind, e); } }
  }
}

function hubFor(ses) {
  let hub = hubs.get(ses);
  if (!hub) { hub = new WebRequestHub(ses); hubs.set(ses, hub); }
  return hub;
}

module.exports = { hubFor };
