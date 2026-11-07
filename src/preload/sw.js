'use strict';
// Preload for websites' service workers (main/notifications.js registers it on each browsing session).
// Electron quietly drops the notifications a worker shows (registration.showNotification), and that's how
// most sites send theirs: here they go to Bifrost, which shows them. A click on one comes back as the
// worker's notificationclick event, during which the worker may bring one of its pages to the front or open
// one (WindowClient.focus(), clients.openWindow()), as in Chrome. Sandboxed and self-contained.
const { contextBridge, ipcRenderer } = require('electron');

const bridge = {
  show: (d) => ipcRenderer.invoke('bifrost:notify-show', d).catch(() => ({})),
  list: (tag) => ipcRenderer.invoke('bifrost:notify-list', tag).catch(() => []),
  close: (id) => { try { ipcRenderer.send('bifrost:notify-close', id); } catch { /* gone */ } },
  focus: (url) => ipcRenderer.invoke('bifrost:notify-focus', url).catch(() => false),
  open: (url) => ipcRenderer.invoke('bifrost:notify-open', url).catch(() => false),
};

function install(B) {
  // (this preload runs in every worker of the session: extensions' have their own notifications)
  if (!/^https?:$/.test(self.location.protocol)) return null;
  const SWR = self.ServiceWorkerRegistration;
  const N = self.Notification;
  if (!SWR || !SWR.prototype || typeof SWR.prototype.showNotification !== 'function' || typeof N !== 'function') return null;
  const define = (obj, key, value) => { try { Object.defineProperty(obj, key, { value, writable: true, configurable: true }); } catch { /* sealed */ } };
  const fail = (method, message) => new TypeError(`Failed to execute '${method}' on 'ServiceWorkerRegistration': ${message}`);

  // The options, as the notification will keep them (its addresses in full).
  const prep = (options) => {
    const o = options === undefined || options === null ? {} : options;
    if (typeof o !== 'object' && typeof o !== 'function') throw fail('showNotification', "The provided value is not of type 'NotificationOptions'.");
    const url = (v) => { if (v === undefined || v === null || v === '') return ''; try { return new URL(String(v), self.location.href).href; } catch { return ''; } };
    const out = {
      body: o.body === undefined ? '' : String(o.body), tag: o.tag === undefined ? '' : String(o.tag),
      icon: url(o.icon), badge: url(o.badge), image: url(o.image), dir: o.dir === 'ltr' || o.dir === 'rtl' ? o.dir : 'auto',
      lang: o.lang === undefined ? '' : String(o.lang), requireInteraction: !!o.requireInteraction, renotify: !!o.renotify,
      silent: o.silent === undefined || o.silent === null ? null : !!o.silent,
      timestamp: o.timestamp === undefined ? Date.now() : Number(o.timestamp),
      actions: Array.from(o.actions || [], (a) => ({ action: String(a && a.action), title: String(a && a.title), icon: url(a && a.icon) })),
      data: o.data === undefined ? null : structuredClone(o.data),
    };
    if (out.renotify && !out.tag) throw fail('showNotification', 'Notifications which set the renotify flag must specify a non-empty tag.');
    if (out.silent && o.vibrate !== undefined && [].concat(o.vibrate).length) throw fail('showNotification', 'Silent notifications must not specify vibration patterns.');
    return out;
  };

  // A Notification for one that's showing (what getNotifications() and the events give the worker).
  const make = (d) => {
    const n = new EventTarget();
    try { Object.setPrototypeOf(n, N.prototype); } catch { /* a plain one, then */ }
    const o = (d && d.options) || {};
    const props = {
      title: String(d.title || ''), body: o.body || '', tag: o.tag || '', icon: o.icon || '', badge: o.badge || '', image: o.image || '',
      dir: o.dir || 'auto', lang: o.lang || '', requireInteraction: !!o.requireInteraction, renotify: !!o.renotify,
      silent: o.silent === undefined ? null : o.silent, timestamp: Number(o.timestamp) || 0,
      actions: Object.freeze((o.actions || []).map((a) => Object.freeze({ ...a }))), vibrate: Object.freeze([]), data: o.data === undefined ? null : o.data,
    };
    for (const [k, v] of Object.entries(props)) { try { Object.defineProperty(n, k, { value: v, enumerable: true }); } catch { /* sealed */ } }
    for (const k of ['onclick', 'onshow', 'onerror', 'onclose']) define(n, k, null);
    define(n, 'close', function close() { B.close(d.id); });
    return n;
  };

  const proto = SWR.prototype;
  define(proto, 'showNotification', function showNotification(title, options) {
    if (!arguments.length) return Promise.reject(fail('showNotification', '1 argument required, but only 0 present.'));
    if (!this.active) return Promise.reject(fail('showNotification', 'No active registration available on the ServiceWorkerRegistration.'));
    let o;
    try { o = prep(options); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(B.show({ title: String(title), options: o })).then((r) => {
      if (r && r.error === 'permission') throw fail('showNotification', 'No notification permission has been granted for this origin.');
      return undefined;
    });
  });
  define(proto, 'getNotifications', function getNotifications(filter) {
    const tag = filter && filter.tag !== undefined ? String(filter.tag) : '';
    return Promise.resolve(B.list(tag)).then((items) => Array.from(items || [], make));
  });

  // Bringing a page to the front, or opening one, is for answering a click (once, within a few seconds).
  let allowUntil = 0;
  const WCp = self.WindowClient && self.WindowClient.prototype;
  if (WCp && typeof WCp.focus === 'function') {
    const nativeFocus = WCp.focus;
    define(WCp, 'focus', function focus() {
      if (Date.now() > allowUntil) return Reflect.apply(nativeFocus, this, []);
      const client = this;
      return Promise.resolve(B.focus(client.url)).then((ok) => {
        if (!ok) throw new DOMException('Not allowed to focus a window.', 'InvalidAccessError');
        allowUntil = 0;
        return client;
      });
    });
  }
  const Cp = self.Clients && self.Clients.prototype;
  if (Cp && typeof Cp.openWindow === 'function') {
    const nativeOpen = Cp.openWindow;
    define(Cp, 'openWindow', function openWindow(url) {
      if (Date.now() > allowUntil) return Reflect.apply(nativeOpen, this, [url]);
      let href;
      try { href = new URL(String(url), self.location.href).href; } catch { return Promise.reject(new TypeError(`Failed to execute 'openWindow' on 'Clients': The URL '${url}' is invalid.`)); }
      const clients = this;
      return Promise.resolve(B.open(href)).then(async (ok) => {
        if (!ok) throw new DOMException('Not allowed to open a window.', 'InvalidAccessError');
        allowUntil = 0;
        if (new URL(href).origin !== self.location.origin) return null;
        // (its WindowClient, once its page is there)
        for (let i = 0; i < 60; i++) {
          const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
          const c = all.find((x) => x.url === href) || all.find((x) => x.url.startsWith(href));
          if (c) return c;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      });
    });
  }

  const set = (obj, key, value) => { try { Object.defineProperty(obj, key, { value, enumerable: true, configurable: true }); } catch { /* sealed */ } };
  return {
    // A click on one of its notifications, or you closing one: the worker's notificationclick/notificationclose.
    dispatch: (d) => {
      const ev = new ExtendableEvent(d.type);
      if (self.NotificationEvent) { try { Object.setPrototypeOf(ev, self.NotificationEvent.prototype); } catch { /* an ExtendableEvent, then */ } }
      const waits = [];
      set(ev, 'notification', make(d.notification));
      set(ev, 'action', String(d.action || ''));
      set(ev, 'reply', null);
      set(ev, 'waitUntil', function waitUntil(p) { waits.push(Promise.resolve(p)); });
      if (d.type === 'notificationclick') allowUntil = Date.now() + 10000;
      try { self.dispatchEvent(ev); } catch (e) { console.error(e); }
      return Promise.allSettled(waits).then(() => true);
    },
  };
}

let api = null;
try { api = contextBridge.executeInMainWorld({ func: install, args: [bridge] }); } catch { api = null; }
if (api && typeof api.dispatch === 'function') {
  ipcRenderer.on('bifrost:notification-event', (_e, d) => {
    let p = null;
    try { p = api.dispatch(d); } catch { p = null; }
    Promise.resolve(p).catch(() => {}).finally(() => { try { ipcRenderer.send('bifrost:notification-done', d && d.token); } catch { /* gone */ } });
  });
}
