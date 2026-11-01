'use strict';
// chrome.webRequest for extensions. Electron stops delivering extension webRequest events once the
// browser itself listens to requests (Bifrost does, for ad blocking, HTTPS-only and privacy headers), so
// Bifrost forwards what its own listeners see to extensions whose filters and host permissions match.
// The events are read-only: extensions can watch requests but not block or change them.
const { webContents: WC } = require('electron');
const ctx = require('../context');
const patterns = require('./patterns');

// Electron resource types -> chrome.webRequest.ResourceType.
const TYPE = {
  mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font',
  object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other',
};
// Hub observer -> extension events it feeds.
const FEEDS = {
  beforeRequest: ['onBeforeRequest'],
  sendHeaders: ['onBeforeSendHeaders', 'onSendHeaders'],
  headersReceived: ['onHeadersReceived'],
  responseStarted: ['onResponseStarted'],
  beforeRedirect: ['onBeforeRedirect'],
  completed: ['onCompleted'],
  errorOccurred: ['onErrorOccurred'],
};
const FEEDS_EVENTS = new Set([].concat(...Object.values(FEEDS)));

function install({ handle, router, extensions }) {
  const listeners = new Map(); // listener id -> { extId, event, context, worker, senderId, urls, types, tabId, windowId, extra }
  const hostAccess = new Map(); // extension id -> host patterns
  let attached = false;

  const ses = () => extensions.ses;
  const extOf = (ev) => { if (!ev.extension) throw new Error('Unknown extension'); return ev.extension; };
  function hostsFor(ext) {
    let h = hostAccess.get(ext.id);
    if (!h) { h = patterns.hostPatterns(ext.manifest); hostAccess.set(ext.id, h); }
    return h;
  }

  handle('webRequest.contextStarted', (ev, { context, worker } = {}) => {
    const ext = extOf(ev);
    const senderId = ev.type === 'frame' && ev.sender ? ev.sender.id : null;
    for (const [id, l] of listeners) {
      if (l.extId !== ext.id || l.context === context) continue;
      // A worker restarted, or a page in the same frame host navigated: its old listeners are gone.
      if ((worker && l.worker) || (!worker && senderId != null && l.senderId === senderId)) listeners.delete(id);
    }
  }, { permission: 'webRequest' });

  handle('webRequest.addListener', (ev, spec = {}) => {
    const ext = extOf(ev);
    if (!FEEDS_EVENTS.has(spec.event)) throw new Error('Unknown event ' + spec.event);
    const f = spec.filter || {};
    const urls = Array.isArray(f.urls) && f.urls.length ? f.urls.map(String) : null;
    if (!urls) throw new Error("The 'urls' filter is required.");
    for (const u of urls) if (!patterns.compile(u)) throw new Error(`'${u}' is not a valid URL pattern.`);
    const senderId = ev.type === 'frame' && ev.sender ? ev.sender.id : null;
    listeners.set(String(spec.id), {
      extId: ext.id, event: spec.event, context: spec.context, worker: !!spec.worker, senderId,
      urls, types: Array.isArray(f.types) && f.types.length ? new Set(f.types) : null,
      tabId: Number.isInteger(f.tabId) ? f.tabId : null, windowId: Number.isInteger(f.windowId) ? f.windowId : null,
      extra: new Set(spec.extraInfoSpec || []),
    });
    if (senderId != null && ev.sender && !ev.sender.__wbWrWatched) {
      ev.sender.__wbWrWatched = true;
      ev.sender.once('destroyed', () => { for (const [id, l] of listeners) if (l.senderId === senderId) listeners.delete(id); });
    }
    attach();
  }, { permission: 'webRequest' });

  handle('webRequest.removeListener', (ev, id) => { const l = listeners.get(String(id)); if (l && l.extId === extOf(ev).id) listeners.delete(String(id)); }, { permission: 'webRequest' });


  ses().extensions.on('extension-unloaded', (e, ext) => {
    hostAccess.delete(ext.id);
    for (const [id, l] of listeners) if (l.extId === ext.id) listeners.delete(id);
  });
  ses().extensions.on('extension-loaded', (e, ext) => hostAccess.delete(ext.id));

  // ----------------------------------------------------------- forwarding
  function attach() {
    if (attached || !extensions.hub) return;
    attached = true;
    for (const [kind, events] of Object.entries(FEEDS)) {
      extensions.hub.observe(kind, (d) => { if (listeners.size) dispatch(events, d); });
    }
  }
  extensions.onHub = () => { if (listeners.size) attach(); };

  function tabInfo(d) {
    if (d.webContentsId == null) return { tabId: -1, windowId: -1 };
    const found = ctx.registry.find(d.webContentsId);
    if (found && !found.ctl.isPrivate) return { tabId: d.webContentsId, windowId: found.ctl.id };
    return { tabId: -1, windowId: -1 };
  }

  function headerList(obj) {
    const out = [];
    for (const [name, v] of Object.entries(obj || {})) for (const value of [].concat(v)) out.push({ name, value: String(value) });
    return out;
  }

  function convert(d, event, extra, where) {
    const frame = d.frame;
    let frameId = -1, parentFrameId = -1;
    try {
      if (frame) {
        frameId = frame.parent ? frame.frameTreeNodeId : 0;
        parentFrameId = frame.parent ? (frame.parent.parent ? frame.parent.frameTreeNodeId : 0) : -1;
      } else if (d.resourceType === 'mainFrame') frameId = 0;
    } catch { /* detached frame */ }
    let initiator;
    try { if (d.referrer) initiator = new URL(d.referrer).origin; } catch { /* none */ }
    const out = {
      requestId: String(d.id), url: d.url, method: d.method, frameId, parentFrameId, tabId: where.tabId,
      type: TYPE[d.resourceType] || 'other', timeStamp: d.timestamp, initiator,
      frameType: d.resourceType === 'mainFrame' ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active',
    };
    if (event === 'onBeforeRequest' && extra.has('requestBody') && Array.isArray(d.uploadData)) {
      const raw = d.uploadData.filter((u) => u.bytes).map((u) => ({ bytes: Uint8Array.from(u.bytes).buffer }));
      out.requestBody = raw.length ? { raw } : {};
    }
    if ((event === 'onBeforeSendHeaders' || event === 'onSendHeaders') && extra.has('requestHeaders')) out.requestHeaders = headerList(d.requestHeaders);
    if (['onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted'].includes(event)) {
      out.statusCode = d.statusCode;
      out.statusLine = d.statusLine;
      if (extra.has('responseHeaders')) out.responseHeaders = headerList(d.responseHeaders);
    }
    if (['onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'].includes(event)) out.fromCache = !!d.fromCache;
    if (event === 'onBeforeRedirect') out.redirectUrl = d.redirectURL;
    if (event === 'onErrorOccurred') out.error = d.error;
    if (d.ip) out.ip = d.ip;
    return out;
  }

  function dispatch(events, d) {
    if (/^(chrome-extension|devtools|bifrost|crx):/i.test(d.url)) return;
    // Private windows stay private, and an extension's own requests are only visible to it.
    let onlyExt = null;
    if (d.webContentsId != null) {
      const wc = WC.fromId(d.webContentsId);
      if (wc && wc.session !== extensions.ses) return;
      const m = wc && /^chrome-extension:\/\/([a-p]{32})\//.exec(wc.getURL());
      if (m) onlyExt = m[1];
    } else {
      const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(d.referrer || '');
      if (m) onlyExt = m[1];
    }
    const where = tabInfo(d);
    const type = TYPE[d.resourceType] || 'other';
    const per = new Map(); // extId -> event -> [listener ids]
    for (const [id, l] of listeners) {
      if (!events.includes(l.event)) continue;
      if (onlyExt && l.extId !== onlyExt) continue;
      if (l.types && !l.types.has(type)) continue;
      if (l.tabId != null && l.tabId !== where.tabId) continue;
      if (l.windowId != null && l.windowId !== where.windowId) continue;
      if (!patterns.matchesAny(l.urls, d.url)) continue;
      const ext = extensions.ses.extensions.getExtension(l.extId);
      if (!ext || !patterns.matchesAny(hostsFor(ext), d.url)) continue;
      let m = per.get(l.extId);
      if (!m) { m = new Map(); per.set(l.extId, m); }
      if (!m.has(l.event)) m.set(l.event, { ids: [], extra: new Set() });
      const slot = m.get(l.event);
      slot.ids.push(id);
      for (const x of l.extra) slot.extra.add(x);
    }
    for (const [extId, m] of per) {
      for (const [event, { ids, extra }] of m) {
        try { router.sendEvent(extId, 'webRequest.dispatch', ids, convert(d, event, extra, where)); } catch (e) { console.error('[extensions] webRequest', e.message); }
      }
    }
  }
}

module.exports = { install, TYPE };
