'use strict';
// Preload for every tab (<webview> guests). Sandboxed and self-contained: no other local files.
//  - Internal pages (bifrost://) get the `wb` bridge to the browser.
//  - Web pages get: browser shortcuts the page didn't handle, and Vim-style keyboard control.
// Nothing here is reachable from the page's own scripts (context isolation).
const { contextBridge, ipcRenderer, webFrame } = require('electron');
// Errors from the main process arrive as "Error invoking remote method 'x': Error: message"; keep the message.
const rethrow = (e) => { throw new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); };
// The extension system's own channels (crx-*) are only for extension pages.
const ours = (channel) => typeof channel === 'string' && !channel.startsWith('crx-');

const isTop = window.top === window;
const isInternal = location.protocol === 'bifrost:';

if (isInternal && isTop) {
  contextBridge.exposeInMainWorld('wb', {
    invoke: (channel, ...args) => (ours(channel) ? ipcRenderer.invoke(channel, ...args).catch(rethrow) : Promise.reject(new Error('Not allowed: ' + channel))),
    send: (channel, ...args) => { if (ours(channel)) ipcRenderer.send(channel, ...args); },
    on: (channel, fn) => {
      const h = (_e, ...args) => fn(...args);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
    toHost: (channel, ...args) => ipcRenderer.sendToHost(channel, ...args),
    platform: process.platform,
  });
}

// The tab's user agent changes with the site, but only takes effect from the next page; this page gets
// the right one here, before any of its scripts run (so it matches what its request sent).
if (isTop && /^https?:$/.test(location.protocol)) {
  try {
    const u = ipcRenderer.sendSync('tab:ua', location.href);
    if (u && u.ua && u.ua !== navigator.userAgent) {
      contextBridge.executeInMainWorld({
        func: (u) => {
          const N = Navigator.prototype;
          const def = (name, value) => { try { Object.defineProperty(N, name, { get: function () { return value; }, configurable: true, enumerable: true }); } catch { /* sealed */ } };
          def('userAgent', u.ua);
          def('appVersion', u.ua.replace(/^Mozilla\//, ''));
          if (u.firefox) { def('vendor', ''); def('productSub', '20100101'); def('oscpu', /Windows/.test(u.ua) ? 'Windows NT 10.0; Win64; x64' : /Mac OS X/.test(u.ua) ? 'Intel Mac OS X 10.15' : 'Linux x86_64'); }
          if (u.safari) { def('vendor', 'Apple Computer, Inc.'); def('platform', 'MacIntel'); }
          if (!u.hints) def('userAgentData', undefined);
        },
        args: [u],
      });
    }
  } catch { /* keep the default */ }
}

// Pop-ups: a page opens another window only in answer to something you did (a click, a key), like in
// Chrome. One it tries to open by itself is blocked, and the window says so, with a way to open it anyway
// (or to allow them on that site).
if (/^(https?|file):$/.test(location.protocol)) {
  try {
    contextBridge.executeInMainWorld({
      func: (blocked, ad) => {
        const native = window.open;
        if (typeof native !== 'function') return;
        const wrapped = new Proxy(native, {
          apply(target, self, args) {
            let url = '';
            try { url = args[0] ? new URL(String(args[0]), location.href).href : ''; } catch { url = String(args[0] || ''); }
            const ua = navigator.userActivation;
            if (ua && !ua.isActive) {
              if (!blocked(url)) return null;
            } else if (url && ad(url)) return null;
            return Reflect.apply(target, self, args);
          },
        });
        try { Object.defineProperty(window, 'open', { value: wrapped, writable: true, configurable: true, enumerable: true }); } catch { /* sealed */ }
      },
      // Returns true when the site is allowed pop-ups after all.
      args: [(url) => {
        let allowed = false;
        try { allowed = !!ipcRenderer.sendSync('tab:popup-allowed', url); } catch { allowed = false; }
        if (!allowed) { try { ipcRenderer.sendToHost('wb-popup-blocked', url, location.href); } catch { /* host gone */ } }
        return allowed;
      // Returns true when it's a pop-up ad (a site on the ad blocker's domain list): it's blocked.
      }, (url) => {
        if (!/^https?:/i.test(url)) return false;
        let isAd = false;
        try { isAd = !!ipcRenderer.sendSync('tab:popup-ad', url); } catch { isAd = false; }
        if (isAd) { try { ipcRenderer.sendToHost('wb-popup-blocked', url, location.href, 'ad'); } catch { /* host gone */ } }
        return isAd;
      }],
    });
  } catch { /* old Electron */ }
}

// Notifications, as in any browser. A site you haven't answered yet is told "not decided" (the page's
// Notification.permission says 'default', the Permissions API 'prompt'), so it asks you: Electron itself
// would say "denied", and sites then tell you to unblock them in your browser's settings instead of asking
// (what claude.ai did). What you answer, in the prompt or with the address bar's permissions button, reaches
// the page straight away. A click on one of its notifications brings its tab to the front.
if (/^https?:$/.test(location.protocol) && typeof Notification === 'function') {
  const read = () => { let v = null; try { v = ipcRenderer.sendSync('tab:perm-state'); } catch { v = null; } return v === 'allow' ? 'granted' : v === 'block' ? 'denied' : 'default'; };
  let push = null;
  ipcRenderer.on('tab-perm', (_e, d) => { if (d && push) { const v = d.notifications; try { push(v === 'allow' ? 'granted' : v === 'block' ? 'denied' : 'default'); } catch { /* page gone */ } } });
  try {
    contextBridge.executeInMainWorld({
      func: (initial, hooks) => {
        const N = window.Notification;
        if (typeof N !== 'function') return;
        let state = initial;
        const statuses = [];
        const permState = () => (state === 'default' ? 'prompt' : state);
        const set = (s) => {
          if (s === state) return;
          state = s;
          for (const st of statuses) { try { st.dispatchEvent(new Event('change')); } catch { /* gone */ } }
        };
        hooks.listen(set);
        try { Object.defineProperty(N, 'permission', { get: () => state, configurable: true, enumerable: true }); } catch { /* sealed */ }
        const nativeRequest = N.requestPermission;
        if (typeof nativeRequest === 'function') {
          const requestPermission = function requestPermission(cb) {
            const p = Promise.resolve(Reflect.apply(nativeRequest, N, [])).then(() => { set(hooks.read()); return state; }, () => state);
            if (typeof cb === 'function') p.then((r) => { try { cb(r); } catch { /* the page's */ } });
            return p;
          };
          try { Object.defineProperty(N, 'requestPermission', { value: requestPermission, writable: true, configurable: true }); } catch { /* sealed */ }
        }
        const P = navigator.permissions;
        if (P && typeof P.query === 'function') {
          const nativeQuery = P.query;
          const query = function query(desc) {
            return Reflect.apply(nativeQuery, P, [desc]).then((st) => {
              const name = desc && desc.name;
              if (name === 'notifications' || name === 'push') {
                try { Object.defineProperty(st, 'state', { get: permState, configurable: true, enumerable: true }); statuses.push(st); } catch { /* sealed */ }
              }
              return st;
            });
          };
          try { Object.defineProperty(P, 'query', { value: query, writable: true, configurable: true }); } catch { /* sealed */ }
        }
        // (push messages need the same permission: Electron can't receive them, but a site that checks first
        // is told the same as for notifications)
        const PM = window.PushManager;
        if (PM && PM.prototype && typeof PM.prototype.permissionState === 'function') {
          const nativeState = PM.prototype.permissionState;
          try { Object.defineProperty(PM.prototype, 'permissionState', { value: function permissionState(opts) { return Promise.resolve(Reflect.apply(nativeState, this, [opts])).then(permState, permState); }, writable: true, configurable: true }); } catch { /* sealed */ }
        }
        // (the page's notifications: a click also brings its tab to the front)
        const Wrapped = new Proxy(N, {
          construct(target, args, newTarget) {
            const n = Reflect.construct(target, args, newTarget === Wrapped ? target : newTarget);
            try { n.addEventListener('click', () => { try { hooks.clicked(); } catch { /* gone */ } }); } catch { /* not one */ }
            return n;
          },
        });
        try { Object.defineProperty(window, 'Notification', { value: Wrapped, writable: true, configurable: true, enumerable: false }); } catch { /* sealed */ }

        // The ones the page shows through its service worker (registration.showNotification): Electron drops
        // those without a word, so Bifrost shows them (main/notifications.js), and a click on one reaches the
        // worker. (The ones the worker shows itself go the same way: preload/sw.js.)
        const SWR = window.ServiceWorkerRegistration;
        if (!SWR || !SWR.prototype || typeof SWR.prototype.showNotification !== 'function') return;
        const define = (obj, key, value) => { try { Object.defineProperty(obj, key, { value, writable: true, configurable: true }); } catch { /* sealed */ } };
        const fail = (method, message) => new TypeError(`Failed to execute '${method}' on 'ServiceWorkerRegistration': ${message}`);
        const prep = (options) => {
          const o = options === undefined || options === null ? {} : options;
          if (typeof o !== 'object' && typeof o !== 'function') throw fail('showNotification', "The provided value is not of type 'NotificationOptions'.");
          const url = (v) => { if (v === undefined || v === null || v === '') return ''; try { return new URL(String(v), document.baseURI).href; } catch { return ''; } };
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
        const make = (d, scope) => {
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
          define(n, 'close', function close() { hooks.swClose({ scope, id: d.id }); });
          return n;
        };
        define(SWR.prototype, 'showNotification', function showNotification(title, options) {
          if (!arguments.length) return Promise.reject(fail('showNotification', '1 argument required, but only 0 present.'));
          if (!this.active) return Promise.reject(fail('showNotification', 'No active registration available on the ServiceWorkerRegistration.'));
          if (state !== 'granted') return Promise.reject(fail('showNotification', 'No notification permission has been granted for this origin.'));
          let o;
          try { o = prep(options); } catch (e) { return Promise.reject(e); }
          return Promise.resolve(hooks.swShow({ scope: this.scope, title: String(title), options: o })).then((r) => {
            if (r && r.error === 'permission') throw fail('showNotification', 'No notification permission has been granted for this origin.');
            return undefined;
          });
        });
        define(SWR.prototype, 'getNotifications', function getNotifications(filter) {
          const scope = this.scope;
          const tag = filter && filter.tag !== undefined ? String(filter.tag) : '';
          return Promise.resolve(hooks.swList({ scope, tag })).then((items) => Array.from(items || [], (d) => make(d, scope)));
        });
      },
      args: [read(), {
        read,
        clicked: () => { try { ipcRenderer.send('tab:notification-click'); } catch { /* gone */ } },
        listen: (fn) => { push = fn; },
        swShow: (d) => ipcRenderer.invoke('tab:sw-notify-show', d).catch(() => ({})),
        swList: (d) => ipcRenderer.invoke('tab:sw-notify-list', d).catch(() => []),
        swClose: (d) => { try { ipcRenderer.send('tab:sw-notify-close', d); } catch { /* gone */ } },
      }],
    });
  } catch { /* the page sees Electron's own answer */ }
}

// Whether the page has the focus, as in Chrome: a tab behind another doesn't (document.hasFocus(), a blur on
// its window), and gets it back when it comes to the front. Chromium tells every page in a focused window
// it has the focus, the tab in front or not, so a page couldn't tell you'd gone to another tab, and sites
// that notify you only then (chat sites such as claude.ai) never did. (Whether it's hidden, Electron tells
// it itself: main/guests.js.) The window says which pages are showing (ui/js/views.js → main/guests.js).
if (/^(https?|file):$/.test(location.protocol)) {
  let shown = true;
  try { shown = ipcRenderer.sendSync('tab:shown') !== false; } catch { shown = true; }
  let tell = null;
  ipcRenderer.on('tab-shown', (_e, v) => { if (tell) { try { tell(v !== false); } catch { /* page gone */ } } });
  try {
    contextBridge.executeInMainWorld({
      func: (initial, hooks) => {
        const D = Document.prototype;
        const nativeFocus = D.hasFocus;
        if (typeof nativeFocus !== 'function') return;
        let shown = initial;
        const focused = () => shown && Reflect.apply(nativeFocus, document, []);
        try { Object.defineProperty(D, 'hasFocus', { value: function hasFocus() { return shown && Reflect.apply(nativeFocus, this, []); }, writable: true, configurable: true }); } catch { return; }
        // (while it's behind another tab, the window's own focus changes change nothing for it)
        const mute = (e) => { if (!shown && e.isTrusted && e.target === window) e.stopImmediatePropagation(); };
        window.addEventListener('focus', mute, true);
        window.addEventListener('blur', mute, true);
        hooks.listen((v) => {
          if (v === shown) return;
          const was = focused();
          shown = v;
          const now = focused();
          if (was && !now) window.dispatchEvent(new FocusEvent('blur'));
          if (!was && now) window.dispatchEvent(new FocusEvent('focus'));
        });
      },
      args: [shown, { listen: (fn) => { tell = fn; } }],
    });
  } catch { /* the page sees Chromium's answer */ }
}

// Your own style for this site (its info popover → Add a style). Applied the way a userstyle is: after the
// page's own styles, so it wins over them where both say something, and as a constructed stylesheet, which
// a site's Content-Security-Policy can't block (a <style> element would be). Frames from that site get it too.
if (/^(https?|file):$/.test(location.protocol)) setupSiteCss();

function setupSiteCss() {
  let sheet = null;
  const adopt = () => {
    if (!sheet) return;
    try {
      const list = document.adoptedStyleSheets;
      if (!list.includes(sheet)) document.adoptedStyleSheets = [...list, sheet];
    } catch { /* no document yet */ }
  };
  const apply = (css) => {
    css = typeof css === 'string' ? css : '';
    if (!css.trim()) {
      if (sheet) { try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); } catch { /* gone */ } }
      sheet = null;
      return;
    }
    if (!sheet) sheet = new CSSStyleSheet();
    try { sheet.replaceSync(css); } catch { /* (an @import line can't be in a constructed sheet; the rest still applies) */ }
    adopt();
  };
  ipcRenderer.invoke('tab:site-css', location.href).then(apply).catch(() => {});
  ipcRenderer.on('tab-site-css', (_e, css) => apply(css));
  // A page that sets its own constructed stylesheets can replace the whole list; put ours back.
  for (const ev of ['DOMContentLoaded', 'load']) window.addEventListener(ev, adopt);
  let n = 0;
  const timer = setInterval(() => { adopt(); if (++n >= 15) clearInterval(timer); }, 1000);
}

// alert(), confirm() and prompt() show Bifrost's own dialog (in the window, over this tab) instead of a
// bare system box, and prompt() works at all (Electron has none). The page waits for the answer, as it
// does in any browser. The page's functions stay what they were underneath; only calling them is routed.
// As in Chrome, a page that's on its way out, or a frame from another site inside a page (an ad, say),
// gets no dialogs: they answer straight away (OK for alert, Cancel for confirm and prompt).
if (/^(https?|file|data|blob):$/.test(location.protocol)) {
  let leaving = false;
  window.addEventListener('pagehide', () => { leaving = true; }, true);
  window.addEventListener('pageshow', () => { leaving = false; }, true);
  let foreign = false;
  if (!isTop) { try { foreign = window.top.location.origin !== location.origin; } catch { foreign = true; } }
  try {
    contextBridge.executeInMainWorld({
      func: (ask) => {
        const wrap = (name, run) => {
          const native = window[name];
          if (typeof native !== 'function') return;
          try { Object.defineProperty(window, name, { value: new Proxy(native, { apply: (target, self, args) => run(args) }), writable: true, configurable: true, enumerable: true }); } catch { /* sealed */ }
        };
        const text = (args, i) => (args.length > i && args[i] !== undefined ? String(args[i]) : '');
        wrap('alert', (a) => { ask('alert', text(a, 0), ''); });
        wrap('confirm', (a) => ask('confirm', text(a, 0), '') === true);
        wrap('prompt', (a) => { const r = ask('prompt', text(a, 0), text(a, 1)); return typeof r === 'string' ? r : null; });
      },
      args: [(type, message, value) => ((leaving || foreign) ? (type === 'confirm' ? false : type === 'prompt' ? null : undefined) : ipcRenderer.sendSync('tab:js-dialog', { type, message, value }))],
    });
  } catch { /* the system's dialogs, then */ }
}

// Pressing a link (or resting on one) connects ahead to its site, so it opens sooner (main/predictor.js).
if (isTop && /^https?:$/.test(location.protocol)) {
  const sent = new Map();   // origin -> when
  let hoverT = null;
  const warm = (a) => {
    let o;
    try { const u = new URL(a.href, location.href); if (!/^https?:$/.test(u.protocol)) return; o = u.origin; } catch { return; }
    const now = Date.now();
    if (now - (sent.get(o) || 0) < 10000) return;
    sent.set(o, now);
    try { ipcRenderer.send('tab:preconnect', o); } catch { /* gone */ }
  };
  const linkOf = (e) => e.target && e.target.closest && e.target.closest('a[href]');
  document.addEventListener('mousedown', (e) => { const a = linkOf(e); if (a) warm(a); }, { capture: true, passive: true });
  document.addEventListener('mouseover', (e) => { const a = linkOf(e); clearTimeout(hoverT); if (a) hoverT = setTimeout(() => warm(a), 120); }, { capture: true, passive: true });
}

// Two-finger swipes on a touchpad go back and forward (ui/js/swipe.js shows the arrow and goes). Like Chrome,
// only a sideways swipe the page itself has no use for counts: one where nothing under the pointer can
// scroll any further that way, and that the page didn't take for itself. A mouse wheel's steps (whole
// notches), Shift+wheel and pinch-zooming (Ctrl+wheel) never count. Every frame watches its own part.
// Once a swipe has started, every sideways step is reported (either way: going back cancels) until the
// browser says the gesture is over ('tab-swipe-done'), the touchpad's coasting included; the page itself can't
// tell when the fingers lift. A swipe the browser has no use for (swiping off, or what's left of the coasting
// after one: main/guests.js) is over at once, and the rest of its gesture isn't one either.
{
  const IDLE = 150;    // ms without movement between gestures (to tell what a new one is)
  const HOLD = 4000;   // a swipe the browser never ended: give up on it
  const DECIDE = 12;   // px of movement before telling which way a gesture goes
  let mode = 'idle', sumX = 0, sumY = 0, path = [], prevented = false, deciding = false, endT = null, pending = [], flushT = null;
  const notch = (v) => v !== 0 && Math.abs(v) % 120 === 0;
  const send = (msg) => { try { ipcRenderer.send('tab:swipe', msg); } catch { /* gone */ } };
  let zoom = 1;
  const dip = (v) => v * zoom;  // CSS px at the page's zoom -> screen (DIP) px, so the distance feels the same at any zoom
  // Sent at most every 16 ms, each step on its own.
  const flush = () => { flushT = null; if (pending.length && mode === 'swipe') send({ phase: 'move', steps: pending.map((v) => Math.round(dip(v) * 100) / 100) }); pending = []; };
  const reset = () => { clearTimeout(endT); clearTimeout(flushT); endT = flushT = null; mode = 'idle'; sumX = sumY = 0; path = []; prevented = false; deciding = false; pending = []; };
  const finish = () => {
    if (mode === 'swipe') { clearTimeout(flushT); flush(); send({ phase: 'end' }); }
    reset();
  };
  ipcRenderer.on('tab-swipe-done', (_e, d) => {
    // (the coasting it was told to ignore is over: what comes next is new, even without a pause before it)
    if (d && d.over) { if (mode === 'other') reset(); return; }
    if (mode !== 'swipe') return;
    reset();
    if (d && d.ignore) { mode = 'other'; endT = setTimeout(finish, IDLE); }
  });
  // Can anything on the way from the pointer to the page scroll further sideways in direction d (-1 left,
  // 1 right)? A scroller that stops scrolls from going on to the page (overscroll-behavior) counts as yes.
  const atEdge = (n, d, cs) => {
    const max = n.scrollWidth - n.clientWidth;
    const rtl = cs.direction === 'rtl';
    const lo = rtl ? -max : 0, hi = rtl ? 0 : max;
    return d < 0 ? n.scrollLeft <= lo + 0.5 : n.scrollLeft >= hi - 0.5;
  };
  const scrollsX = (els, d) => {
    const doc = document.documentElement, body = document.body;
    for (const n of els) {
      if (!(n instanceof Element) || n === doc || n === body) continue;
      if (n.scrollWidth <= n.clientWidth + 1) continue;
      const cs = getComputedStyle(n);
      if (!/^(auto|scroll|overlay)$/.test(cs.overflowX)) continue;
      if (!atEdge(n, d, cs)) return true;
      if (cs.overscrollBehaviorX === 'contain' || cs.overscrollBehaviorX === 'none') return true;
    }
    const rcs = getComputedStyle(doc);
    if (rcs.overscrollBehaviorX === 'contain' || rcs.overscrollBehaviorX === 'none') return true;   // the page opted out
    const se = document.scrollingElement || doc;
    const ox = rcs.overflowX !== 'visible' ? rcs.overflowX : body ? getComputedStyle(body).overflowX : 'visible';
    return se.scrollWidth > se.clientWidth + 1 && ox !== 'hidden' && ox !== 'clip' && !atEdge(se, d, rcs);
  };
  window.addEventListener('wheel', (e) => {
    if (mode === 'swipe') {
      clearTimeout(endT);
      endT = setTimeout(finish, HOLD);
      if (e.ctrlKey) return;
      pending.push(e.deltaX);
      if (!flushT) flushT = setTimeout(flush, 16);
      return;
    }
    clearTimeout(endT);
    endT = setTimeout(finish, IDLE);
    if (mode === 'other') return;
    if (mode === 'idle') {
      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.deltaMode !== 0 || notch(e.wheelDeltaX) || notch(e.wheelDeltaY)) { mode = 'other'; return; }
      mode = 'undecided';
      try { zoom = webFrame.getZoomFactor() || 1; } catch { zoom = 1; }
    }
    sumX += e.deltaX; sumY += e.deltaY;
    if (!path.length) path = e.composedPath();
    setTimeout(() => { if (e.defaultPrevented) prevented = true; }, 0);
    if (deciding || Math.abs(sumX) + Math.abs(sumY) < DECIDE) return;
    deciding = true;
    // Once the page has had the event: did it take it for itself?
    setTimeout(() => {
      deciding = false;
      if (mode !== 'undecided') return;
      const d = Math.sign(sumX);
      if (prevented || !d || Math.abs(sumX) < 1.5 * Math.abs(sumY) || scrollsX(path, d)) { mode = 'other'; return; }
      mode = 'swipe';
      clearTimeout(endT);
      endT = setTimeout(finish, HOLD);
      send({ phase: 'start', dir: d });
      pending = [sumX];
      flush();
    }, 0);
  }, { capture: true, passive: true });
  // Leaving the page (going back, say) ends any swipe on it.
  window.addEventListener('pagehide', finish);
}

if (isTop) setupKeys();

function setupKeys() {
  let cfg = null;           // { shortcuts: [{id, chord}], vim: {...}, keys: {action: seq}, pass: null|true|[keys] }
  const toHost = (ch, ...a) => { try { ipcRenderer.sendToHost(ch, ...a); } catch { /* host gone */ } };

  ipcRenderer.invoke('tab:config', location.href).then((c) => { cfg = c; buildKeymap(); }).catch(() => {});
  ipcRenderer.on('tab-config', (_e, c) => { cfg = c; buildKeymap(); if (vimOff()) exitHints(); });
  // You clicking into the page (so the address bar knows the page didn't just grab focus by itself), and
  // whether Shift was held (a link opened in a new tab by it goes in front or behind: openFromMain).
  window.addEventListener('pointerdown', (e) => { if (e.isTrusted) toHost('wb-pointer', { shift: e.shiftKey, button: e.button }); }, { capture: true, passive: true });

  // ------------------------------------------------------------ shortcuts
  function chordOf(e) { return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code }; }
  function sameChord(a, b) { return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta; }

  // Browser shortcuts run only if the page didn't handle the key itself (like Chrome).
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !cfg || e.isComposing) return;
    const hit = (cfg.shortcuts || []).find((s) => sameChord(s.chord, chordOf(e)));
    if (!hit) return;
    setTimeout(() => { if (!e.defaultPrevented) toHost('wb-command', hit.id); }, 0);
  }, false);

  // ------------------------------------------------------------------ vim
  let keymap = new Map();    // "j" | "g g" | "Ctrl+v" -> action
  let prefixes = new Set();
  let buffer = [];
  let bufferTimer = null;
  let insertLocked = false;  // explicit insert mode ('i'), until Escape
  let passNext = false;
  let hints = null;

  function buildKeymap() {
    keymap = new Map();
    prefixes = new Set();
    if (!cfg || !cfg.keys) return;
    for (const [action, seq] of Object.entries(cfg.keys)) {
      const parts = parseSeq(seq);
      if (!parts.length) continue;
      keymap.set(parts.join(' '), action);
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join(' '));
    }
  }

  // "gg" -> ["g","g"], "Ctrl+v" -> ["Ctrl+v"], "g$" -> ["g","$"]
  function parseSeq(seq) {
    if (!seq) return [];
    if (/^(Ctrl|Alt|Meta)\+/.test(seq)) return [seq];
    return [...seq];
  }

  function keyName(e) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return null;
    let k = e.key;
    if (k === ' ') k = 'Space';
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean);
    return mods.length ? mods.join('+') + '+' + (k.length === 1 ? k.toLowerCase() : k) : k;
  }

  function vimOff() {
    return !cfg || !cfg.vim || !cfg.vim.enabled || cfg.pass === true;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type || 'text');
    return false;
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  window.addEventListener('keydown', onVimKey, true);
  // Swallow keypress/keyup for keys Vim handled so pages don't react to half of a key.
  const swallowed = new Set();
  window.addEventListener('keypress', (e) => { if (swallowed.has(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('keyup', (e) => { if (swallowed.delete(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowed.add(e.code);
  }

  function onVimKey(e) {
    if (!e.isTrusted || e.isComposing || vimOff()) return;
    if (hints) { onHintKey(e); return; }
    const k = keyName(e);
    if (!k) return;
    if (passNext) { passNext = false; hud(''); return; }
    if (insertLocked) {
      if (k === 'Escape') { insertLocked = false; hud(''); consume(e); }
      return;
    }
    if (isEditable(deepActive())) {
      if (k === 'Escape') { const a = deepActive(); if (a && a.blur) a.blur(); consume(e); }
      return;
    }
    // Per-site pass-through keys ("youtube.com f k j l").
    if (Array.isArray(cfg.pass) && cfg.pass.includes(k) && !buffer.length) return;
    // Modifier chords other than our own mappings belong to the page/browser.
    if ((e.ctrlKey || e.altKey || e.metaKey) && !keymap.has(k)) { buffer = []; return; }

    buffer.push(k);
    const seq = buffer.join(' ');
    clearTimeout(bufferTimer);
    if (keymap.has(seq) && !(prefixes.has(seq))) {
      const action = keymap.get(seq);
      buffer = [];
      consume(e);
      run(action, e);
      return;
    }
    if (prefixes.has(seq)) {
      consume(e);
      bufferTimer = setTimeout(() => {
        // A complete mapping that's also a prefix runs when no longer key follows.
        if (keymap.has(seq)) run(keymap.get(seq));
        buffer = [];
      }, 900);
      return;
    }
    buffer = [];
    // Unmapped key: if it started a sequence, retry it alone.
    if (seq.includes(' ')) { const single = k; if (keymap.has(single)) { consume(e); run(keymap.get(single), e); } }
  }

  // ---------------------------------------------------------------- actions
  function step() { return (cfg && cfg.vim && cfg.vim.scrollStep) || 70; }
  function smooth() { return cfg && cfg.vim && cfg.vim.smoothScroll ? 'smooth' : 'instant'; }

  function isScrollable(el, axis) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const s = getComputedStyle(el);
    const ov = axis === 'x' ? s.overflowX : s.overflowY;
    if (!/(auto|scroll|overlay)/.test(ov)) return false;
    return axis === 'x' ? el.scrollWidth > el.clientWidth + 2 : el.scrollHeight > el.clientHeight + 2;
  }

  // The element to scroll: the focused element's scroll container, else the biggest scroll area on
  // screen (web apps often scroll an inner panel), else the page.
  function scroller(axis = 'y') {
    for (let el = deepActive(); el; el = el.parentElement) if (isScrollable(el, axis)) return el;
    const root = document.scrollingElement || document.documentElement;
    const pageScrolls = axis === 'x' ? root.scrollWidth > innerWidth + 2 : root.scrollHeight > innerHeight + 2;
    if (pageScrolls) return root;
    let best = null, bestArea = 0;
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    for (let el = center; el; el = el.parentElement) if (isScrollable(el, axis)) return el;
    for (const el of document.querySelectorAll('div, main, section, article, ul')) {
      if (!isScrollable(el, axis)) continue;
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best || root;
  }

  function scrollBy(dx, dy) { const el = scroller(dx ? 'x' : 'y'); el.scrollBy({ left: dx, top: dy, behavior: smooth() }); }
  function viewH(el) { return el === document.scrollingElement || el === document.documentElement ? innerHeight : el.clientHeight; }

  function run(action) {
    switch (action) {
      case 'scrollDown': return scrollBy(0, step());
      case 'scrollUp': return scrollBy(0, -step());
      case 'scrollLeft': return scrollBy(-step(), 0);
      case 'scrollRight': return scrollBy(step(), 0);
      case 'halfPageDown': { const el = scroller(); return el.scrollBy({ top: viewH(el) / 2, behavior: smooth() }); }
      case 'halfPageUp': { const el = scroller(); return el.scrollBy({ top: -viewH(el) / 2, behavior: smooth() }); }
      case 'pageDown': { const el = scroller(); return el.scrollBy({ top: viewH(el) * 0.9, behavior: smooth() }); }
      case 'pageUp': { const el = scroller(); return el.scrollBy({ top: -viewH(el) * 0.9, behavior: smooth() }); }
      case 'top': { const el = scroller(); return el.scrollTo({ top: 0, behavior: smooth() }); }
      case 'bottom': { const el = scroller(); return el.scrollTo({ top: el.scrollHeight, behavior: smooth() }); }
      case 'hints': return startHints('click');
      case 'hintsNewTab': return startHints('newtab');
      case 'hintsCopy': return startHints('copy');
      case 'hintsSplit': return startHints('split');
      case 'insertMode': insertLocked = true; return hud('Insert mode  ·  Esc to leave', true);
      case 'passNext': passNext = true; return hud('Next key goes to the page', true);
      case 'copyUrl': toHost('wb-copy', location.href); return hud('Copied the page address');
      case 'focusInput': return focusFirstInput();
      case 'upUrl': return goUp(false);
      case 'rootUrl': return goUp(true);
      case 'help': return toHost('wb-command', 'vimHelp');
      default: return toHost('wb-command', 'vim:' + action);
    }
  }

  function goUp(root) {
    const u = new URL(location.href);
    if (root) { u.pathname = '/'; u.search = ''; u.hash = ''; }
    else {
      u.hash = ''; u.search = '';
      const parts = u.pathname.replace(/\/+$/, '').split('/');
      parts.pop();
      u.pathname = parts.join('/') + '/';
    }
    if (u.href !== location.href) location.href = u.href;
  }

  function focusFirstInput() {
    const inputs = [...document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]')].filter((el) => isEditable(el) && visibleRect(el));
    if (!inputs.length) return hud('No text field on this page');
    inputs[0].focus();
    if (inputs[0].select) try { inputs[0].select(); } catch { /* not selectable */ }
  }

  // ------------------------------------------------------------------ HUD
  let hudHost = null, hudEl = null, hudTimer = null;
  function ensureOverlayRoot() {
    if (hudHost && hudHost.isConnected) return hudHost.__root;
    hudHost = document.createElement('bifrost-ui');
    hudHost.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    const root = hudHost.attachShadow({ mode: 'closed' });
    hudHost.__root = root;
    const style = document.createElement('style');
    style.textContent = `
      .hud { position: fixed; right: 14px; bottom: 14px; font: 600 12px/1.3 system-ui, "Segoe UI", sans-serif; color: #cdd6f4;
        background: rgba(17,17,27,.92); border: 1px solid #45475a; padding: 6px 10px; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.35);
        opacity: 0; transform: translateY(4px); transition: opacity .12s, transform .12s; }
      .hud.on { opacity: 1; transform: none; }
      .hint { position: fixed; font: 700 11px/1 ui-monospace, "Cascadia Code", Consolas, monospace; color: #11111b; background: #f9e2af;
        border: 1px solid #df8e1d; border-radius: 4px; padding: 2px 4px; box-shadow: 0 2px 6px rgba(0,0,0,.35); text-transform: uppercase; letter-spacing: .5px; }
      .hint b { color: #a5adcb; font-weight: 700; }
      .hint.dim { opacity: .25; }`;
    root.appendChild(style);
    (document.documentElement || document).appendChild(hudHost);
    return root;
  }

  function hud(text, sticky) {
    if (!text) { if (hudEl) hudEl.classList.remove('on'); return; }
    const root = ensureOverlayRoot();
    if (!hudEl || !hudEl.isConnected) { hudEl = document.createElement('div'); hudEl.className = 'hud'; root.appendChild(hudEl); }
    hudEl.textContent = text;
    requestAnimationFrame(() => hudEl.classList.add('on'));
    clearTimeout(hudTimer);
    if (!sticky) hudTimer = setTimeout(() => hudEl && hudEl.classList.remove('on'), 1600);
  }

  // ---------------------------------------------------------------- hints
  const CLICKABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, label[for], [onclick], [contenteditable=""], [contenteditable="true"], ' +
    '[role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=option], [role=switch], [role=treeitem], [tabindex]:not([tabindex="-1"]), video, audio, details';

  function visibleRect(el) {
    const rects = el.getClientRects();
    for (const r of rects) {
      if (r.width < 3 || r.height < 3) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.opacity === '0' || s.pointerEvents === 'none') return null;
      return r;
    }
    return null;
  }

  function collectTargets(mode) {
    const out = [];
    const seen = new Set();
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
      for (const el of root.querySelectorAll(CLICKABLE)) {
        if (seen.has(el)) continue;
        if ((mode === 'newtab' || mode === 'copy' || mode === 'split') && !(el.tagName === 'A' && el.href)) continue;
        if (el.disabled) continue;
        const r = visibleRect(el);
        if (!r) continue;
        // Skip elements covered by something else (menus, modals).
        const cx = Math.min(innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 12))), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        const top = root.elementFromPoint ? root.elementFromPoint(cx, cy) : document.elementFromPoint(cx, cy);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) {
          const alt = document.elementFromPoint(Math.min(innerWidth - 1, r.left + 2), Math.min(innerHeight - 1, r.top + 2));
          if (alt && alt !== el && !el.contains(alt)) continue;
        }
        seen.add(el);
        out.push({ el, r });
      }
    }
    // Drop elements nested inside another target at the same spot (an <a> wrapping a <button>).
    return out.filter((t) => !out.some((o) => o !== t && o.el.contains(t.el) && Math.abs(o.r.left - t.r.left) < 2 && Math.abs(o.r.top - t.r.top) < 2));
  }

  // Shortest unique labels over the hint alphabet (like Vimium).
  function labels(n, chars) {
    chars = (chars || 'asdfghjkl').split('');
    if (n <= 0) return [];
    let out = [''];
    let offset = 0;
    while (out.length - offset < n || out.length === 1) {
      const s = out[offset++];
      for (const c of chars) out.push(s + c);
    }
    return out.slice(offset, offset + n).map((s) => s.split('').reverse().join('')).sort();
  }

  function startHints(mode) {
    const targets = collectTargets(mode);
    if (!targets.length) return hud('No links on screen');
    const root = ensureOverlayRoot();
    const layer = document.createElement('div');
    root.appendChild(layer);
    const names = labels(targets.length, cfg.vim.hintChars);
    hints = { mode, typed: '', items: targets.map((t, i) => {
      const tag = document.createElement('div');
      tag.className = 'hint';
      tag.textContent = names[i];
      tag.style.left = Math.max(0, t.r.left - 4) + 'px';
      tag.style.top = Math.max(0, t.r.top - 4) + 'px';
      layer.appendChild(tag);
      return { el: t.el, label: names[i], tag };
    }), layer };
    hud(mode === 'newtab' ? 'Open link in a new tab' : mode === 'copy' ? 'Copy link address' : mode === 'split' ? 'Open link in split view' : 'Follow link', true);
  }

  function exitHints() {
    if (!hints) return;
    hints.layer.remove();
    hints = null;
    hud('');
  }

  function onHintKey(e) {
    consume(e);
    if (e.key === 'Escape') return exitHints();
    if (e.key === 'Backspace') hints.typed = hints.typed.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) hints.typed += e.key.toLowerCase();
    else return;
    const matches = hints.items.filter((h) => h.label.startsWith(hints.typed));
    for (const h of hints.items) {
      const on = h.label.startsWith(hints.typed);
      h.tag.classList.toggle('dim', !on);
      h.tag.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = on ? h.label.slice(0, hints.typed.length) : '';
      h.tag.append(b, on ? h.label.slice(hints.typed.length) : h.label);
    }
    if (!matches.length) return exitHints();
    if (matches.length === 1 && matches[0].label === hints.typed) {
      const { el } = matches[0];
      const mode = hints.mode;
      exitHints();
      activate(el, mode);
    }
  }

  function activate(el, mode) {
    const href = el.tagName === 'A' ? el.href : '';
    if (mode === 'newtab' && href) return toHost('wb-open', { url: href, background: true });
    if (mode === 'split' && href) return toHost('wb-open', { url: href, split: true });
    if (mode === 'copy' && href) { toHost('wb-copy', href); return hud('Copied the link address'); }
    if (isEditable(el)) { el.focus(); return; }
    if (el.tagName === 'SELECT') { el.focus(); try { el.showPicker(); } catch { /* not supported */ } return; }
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') { el.paused ? el.play() : el.pause(); return; }
    el.focus({ preventScroll: true });
    for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, composed: true, view: window }));
    }
    el.click();
  }

  window.addEventListener('scroll', () => { if (hints) exitHints(); }, true);
  window.addEventListener('resize', () => { if (hints) exitHints(); });
  window.addEventListener('blur', () => { buffer = []; });
}

// The page's colors at its edges (left, right, top), for "Match the page" (Look & feel → Sidebar and
// toolbar): the window around the page takes the color next to it, so the two blend. What's drawn there:
// the first element under that point with an opaque background, else the page's own background, else the
// page's default (white, or dark for a page that asks for dark). Measured as the page loads and whenever
// it might change (its theme switching, resizing, scrolling to something else); the window hears of the
// colors when they change ("wb-page-color", a quick first guess) and of every such moment
// ("wb-page-moved": it then looks at the page's real pixels, ui/js/ambient.js). Bifrost's own pages too.
if (isTop && /^(https?|file|bifrost):$/.test(location.protocol)) {
  const parse = (c) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/i.exec(c || '');
    if (!m) return null;
    const a = m[4] == null ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
  };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  const canvas = () => {
    for (const el of [document.documentElement, document.body]) {
      const c = el && parse(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.5) return c;
    }
    const scheme = document.documentElement ? getComputedStyle(document.documentElement).colorScheme || '' : '';
    const dark = /dark/.test(scheme) && (!/light/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  };
  const at = (x, y) => {
    let el = document.elementFromPoint(x, y);
    for (; el && el.nodeType === 1 && el !== document.documentElement && el !== document.body; el = el.parentElement) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.85) return c;
    }
    return canvas();
  };
  // The color most of a few points along an edge share.
  const edge = (points) => {
    const n = new Map();
    for (const [x, y] of points) { const c = hex(at(x, y)); n.set(c, (n.get(c) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1])[0][0];
  };
  let last = '', timer = 0;
  const measure = () => {
    timer = 0;
    if (!document.documentElement) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    const sb = Math.max(0, w - document.documentElement.clientWidth);   // the page's scrollbar, on the right
    const colors = {
      left: edge([[1, h * 0.3], [1, h * 0.5], [1, h * 0.75]]),
      right: edge([[w - sb - 2, h * 0.3], [w - sb - 2, h * 0.5], [w - sb - 2, h * 0.75]]),
      top: edge([[w * 0.25, 1], [w * 0.5, 1], [w * 0.75, 1]]),
    };
    try { ipcRenderer.sendToHost('wb-page-moved'); } catch { /* host gone */ }
    const key = JSON.stringify(colors);
    if (key === last) return;
    last = key;
    try { ipcRenderer.sendToHost('wb-page-color', colors); } catch { /* host gone */ }
  };
  const soon = (ms = 150) => { clearTimeout(timer); timer = setTimeout(measure, ms); };
  document.addEventListener('DOMContentLoaded', () => {
    soon(0);
    // A theme switch (a class or attribute on <html> or <body>) changes it at once.
    const mo = new MutationObserver(() => soon(120));
    mo.observe(document.documentElement, { attributes: true });
    if (document.body) mo.observe(document.body, { attributes: true });
  });
  window.addEventListener('load', () => { soon(0); setTimeout(() => soon(0), 800); setTimeout(() => soon(0), 2500); });
  window.addEventListener('resize', () => soon(250));
  window.addEventListener('scroll', () => soon(400), { passive: true, capture: true });
  window.addEventListener('pageshow', () => soon(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(50); });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => soon(150)); } catch { /* old */ }
}
