'use strict';
// Electron allows one listener per webRequest event per session, so every feature that needs requests
// (ad blocking, HTTPS-only, privacy headers, per-site user agents, the extension webRequest bridge)
// registers here instead. Handlers run in order; the first one that blocks or redirects wins.
const hubs = new WeakMap();

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
    const wr = ses.webRequest;
    this.wr = wr;
    this.filter = filter;
    this.attachedObservers = new Set();

    wr.onBeforeRequest(filter, (d, cb) => {
      let res = {};
      for (const fn of this.before) {
        let r;
        try { r = fn(d); } catch (e) { console.error('[webrequest] before', e); }
        if (r && (r.cancel || r.redirectURL)) { res = r; break; }
      }
      cb(res);
      this.notify('beforeRequest', d, res);
    });

    wr.onBeforeSendHeaders(filter, (d, cb) => {
      const headers = Object.assign({}, d.requestHeaders);
      for (const fn of this.sendHeaders) { try { fn(d, headers); } catch (e) { console.error('[webrequest] headers', e); } }
      cb({ requestHeaders: headers });
      this.notify('sendHeaders', Object.assign({}, d, { requestHeaders: headers }));
    });

    wr.onHeadersReceived(filter, (d, cb) => {
      const headers = Object.assign({}, d.responseHeaders || {});
      let changed = false;
      for (const fn of this.headersReceived) { try { if (fn(d, headers)) changed = true; } catch (e) { console.error('[webrequest] received', e); } }
      cb(changed ? { responseHeaders: headers } : {});
      this.notify('headersReceived', d);
    });

    // The events only extensions watch (chrome.webRequest) are attached when one starts watching.
  }

  // Adds a watcher; the matching webRequest event is attached the first time it's needed.
  observe(kind, fn) {
    this.observers[kind].push(fn);
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
