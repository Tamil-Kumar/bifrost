'use strict';
// Bifrost — ad blocker element hiding and page scripts ("scriptlets"), in every frame of every page.
//
// Ghostery's own Electron preload asks for these over an async IPC round-trip, which lands after the page's
// scripts have started: too late for the scriptlets that defuse ads (YouTube's, for one), and only in the
// top frame. Here each frame asks synchronously as it starts, applies the styles and runs the scriptlets in
// the page before any of the page's own scripts, then watches the DOM for new classes and ids as Ghostery's
// preload does.
//
// The DOM watcher below (between the two lines of dashes) is Ghostery's adblocker-content package, copied
// from src/vendor/adblocker/preload.js — Copyright (c) 2017-present Ghostery GmbH, MPL-2.0.
const { ipcRenderer, webFrame, contextBridge } = require('electron');

// ---------------------------------------------------------------------------------------------------------
// ../wb-cache/vendor-src/adblocker/packages/adblocker-content/src/index.ts
/*!
 * Copyright (c) 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
var SCRIPT_ID = "ghostery-adblocker-script";
var IGNORED_TAGS = /* @__PURE__ */ new Set(["br", "head", "link", "meta", "script", "style", "s"]);
function debounce(fn, {
  waitFor,
  maxWait
}) {
  let delayedTimer;
  let maxWaitTimer;
  const clear = () => {
    clearTimeout(delayedTimer);
    clearTimeout(maxWaitTimer);
    delayedTimer = void 0;
    maxWaitTimer = void 0;
  };
  const run = () => {
    clear();
    fn();
  };
  return [
    () => {
      if (maxWait > 0 && maxWaitTimer === void 0) {
        maxWaitTimer = setTimeout(run, maxWait);
      }
      clearTimeout(delayedTimer);
      delayedTimer = setTimeout(run, waitFor);
    },
    clear
  ];
}
function isElement(node) {
  return node.nodeType === 1;
}
function getElementsFromMutations(mutations) {
  const elements = [];
  for (const mutation of mutations) {
    if (mutation.type === "attributes") {
      if (isElement(mutation.target)) {
        elements.push(mutation.target);
      }
    } else if (mutation.type === "childList") {
      for (const addedNode of mutation.addedNodes) {
        if (isElement(addedNode) && addedNode.id !== SCRIPT_ID) {
          elements.push(addedNode);
        }
      }
    }
  }
  return elements;
}
function extractFeaturesFromDOM(roots = [document.documentElement]) {
  const ignoredTags = /* @__PURE__ */ new Set(["br", "head", "link", "meta", "script", "style", "s"]);
  const classes = /* @__PURE__ */ new Set();
  const hrefs = /* @__PURE__ */ new Set();
  const ids = /* @__PURE__ */ new Set();
  const seenElements = /* @__PURE__ */ new Set();
  for (const root of roots) {
    for (const element of [
      root,
      ...root.querySelectorAll(
        "[id]:not(html):not(body),[class]:not(html):not(body),[href]:not(html):not(body)"
      )
    ]) {
      if (seenElements.has(element)) {
        continue;
      }
      seenElements.add(element);
      if (ignoredTags.has(element.nodeName.toLowerCase())) {
        continue;
      }
      const id = element.getAttribute("id");
      if (typeof id === "string") {
        ids.add(id);
      }
      const classList = element.classList;
      for (const classEntry of classList) {
        classes.add(classEntry);
      }
      const href = element.getAttribute("href");
      if (typeof href === "string") {
        hrefs.add(href);
      }
    }
  }
  return {
    classes: Array.from(classes),
    hrefs: Array.from(hrefs),
    ids: Array.from(ids)
  };
}
var DOMMonitor = class {
  constructor(cb) {
    this.cb = cb;
    this.knownIds = /* @__PURE__ */ new Set();
    this.knownHrefs = /* @__PURE__ */ new Set();
    this.knownClasses = /* @__PURE__ */ new Set();
    this.observer = null;
  }
  queryAll(window2) {
    this.cb({ type: "elements", elements: [window2.document.documentElement] });
    this.handleUpdatedNodes([window2.document.documentElement]);
  }
  start(window2) {
    if (this.observer === null && window2.MutationObserver !== void 0) {
      const nodes = /* @__PURE__ */ new Set();
      const handleUpdatedNodesCallback = () => {
        this.handleUpdatedNodes(Array.from(nodes));
        nodes.clear();
      };
      const [debouncedHandleUpdatedNodes, cancelHandleUpdatedNodes] = debounce(
        handleUpdatedNodesCallback,
        {
          waitFor: 25,
          maxWait: 1e3
        }
      );
      this.observer = new window2.MutationObserver((mutations) => {
        getElementsFromMutations(mutations).forEach(nodes.add, nodes);
        if (nodes.size > 512) {
          cancelHandleUpdatedNodes();
          handleUpdatedNodesCallback();
        } else {
          debouncedHandleUpdatedNodes();
        }
      });
      this.observer.observe(window2.document.documentElement, {
        // Monitor some attributes
        attributes: true,
        attributeFilter: ["class", "id", "href"],
        childList: true,
        subtree: true
      });
    }
  }
  stop() {
    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
  handleNewFeatures({
    hrefs,
    ids,
    classes
  }) {
    const newIds = [];
    const newClasses = [];
    const newHrefs = [];
    for (const id of ids) {
      if (this.knownIds.has(id) === false) {
        newIds.push(id);
        this.knownIds.add(id);
      }
    }
    for (const cls of classes) {
      if (this.knownClasses.has(cls) === false) {
        newClasses.push(cls);
        this.knownClasses.add(cls);
      }
    }
    for (const href of hrefs) {
      if (this.knownHrefs.has(href) === false) {
        newHrefs.push(href);
        this.knownHrefs.add(href);
      }
    }
    if (newIds.length !== 0 || newClasses.length !== 0 || newHrefs.length !== 0) {
      this.cb({
        type: "features",
        classes: newClasses,
        hrefs: newHrefs,
        ids: newIds
      });
      return true;
    }
    return false;
  }
  handleUpdatedNodes(elements) {
    if (elements.length !== 0) {
      this.cb({
        type: "elements",
        elements: elements.filter((e) => IGNORED_TAGS.has(e.nodeName.toLowerCase()) === false)
      });
      return this.handleNewFeatures(extractFeaturesFromDOM(elements));
    }
    return false;
  }
};

// ---------------------------------------------------------------------------------------------------------

function apply(first, href, isTop) {
  if (first.styles) { try { webFrame.insertCSS(first.styles, { cssOrigin: 'user' }); } catch { /* frame gone */ } }
  for (const script of first.scripts || []) {
    // Runs in the page's own world, now, before its scripts (and regardless of its Content Security Policy).
    try { webFrame.executeJavaScript(script).catch(() => {}); } catch { /* ignore */ }
  }
  // YouTube, or a YouTube player embedded in another page.
  if (first.youtube) youtubeAds(first.youtube);
  if (!first.watch) return;
  let monitor = null;
  const startWatching = () => {
    monitor = new DOMMonitor((update) => {
      if (update.type !== 'features') return;
      ipcRenderer.invoke('bifrost-adblock:features', href, { classes: update.classes, ids: update.ids, hrefs: update.hrefs })
        .then((styles) => { if (styles) webFrame.insertCSS(styles, { cssOrigin: 'user' }); })
        .catch(() => {});
    });
    monitor.queryAll(window);
    monitor.start(window);
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', startWatching, { once: true, passive: true });
  else startWatching();
  window.addEventListener('pagehide', () => { if (monitor) { monitor.stop(); monitor = null; } }, { once: true, passive: true });
}

// ---------------------------------------------------------------------------------------------------------
// YouTube. Nothing of YouTube's own is changed for its video ads (taken out of its data, YouTube can stop
// loading at its grey placeholders or tell you off for blocking ads; that's privacy.adblock.youtubeFilters),
// so they're dealt with as they come, and you don't see or hear them:
//  · A video ad is covered, picture and buttons, from the moment the player switches to it (a style, so
//    before any script here runs), muted and sped up, and skipped: "Skip" is pressed as soon as it's there,
//    an ad that's a stream of its own is run to its end, and one stitched into the video's own stream
//    ("SSAP") is passed with the player's own seek, the way uBlock Origin's YouTube fix does it. When it
//    can't tell which kind it is, the position is left alone (running the video's own stream to its end would
//    skip the video). Your sound and speed come back with the video.
//  · The ads in YouTube's pages are hidden: the home feed, search, next to the video, the masthead.
//  · Shorts: the reels marked as ads are taken out of the reels YouTube fetches, before it shows them (what
//    uBlock Origin's Shorts filters do); an ad reel that gets through anyway is hidden and passed, and an
//    ad's own video is muted and paused.

// The player while it shows an ad: a black cover over all of it. (Not when the player has said "ad" for so long
// that it's surely stuck saying it: data-bifrost-ad-stuck, below.)
const YT_COVER = `
:is(.html5-video-player.ad-showing, .html5-video-player.ad-interrupting):not([data-bifrost-ad-stuck])::after {
  content: "Skipping an ad\\2026" !important; position: absolute !important; inset: 0 !important;
  z-index: 2147483647 !important; display: flex !important; align-items: center !important;
  justify-content: center !important; background: #000 !important; color: rgba(255, 255, 255, 0.6) !important;
  font: 500 14px/1.4 Roboto, Arial, sans-serif !important; pointer-events: auto !important; cursor: default !important;
}
:is(.html5-video-player.ad-showing, .html5-video-player.ad-interrupting):not([data-bifrost-ad-stuck]) video { opacity: 0 !important; }
.ytp-ad-overlay-slot, .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
.ytp-ad-message-container, .ytp-ad-progress-list { visibility: hidden !important; }
`;

// The ads in YouTube's pages (with element hiding on). #player-ads, the box next to the video its companion
// ads go in, is shrunk out of sight rather than taken out: uBlock Origin's lists leave it alone on YouTube, as
// they do the player's own ad box (the cover above is over that one).
const YT_PAGE_ADS = `
ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
ytd-promoted-sparkles-text-search-renderer, ytd-promoted-video-renderer, ytd-compact-promoted-video-renderer,
ytd-search-pyv-renderer, ytd-video-masthead-ad-v3-renderer, ytd-primetime-promo-renderer, ytd-banner-promo-renderer,
#masthead-ad, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"], ytd-merch-shelf-renderer,
yt-overlay-product-sticker, ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
#shorts-inner-container > :has(> ytd-ad-slot-renderer),
#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer),
ad-slot-renderer, ytm-promoted-sparkles-web-renderer, ytm-promoted-video-renderer, ytm-companion-ad-renderer,
ytm-rich-item-renderer:has(> ad-slot-renderer) { display: none !important; }
#player-ads { visibility: hidden !important; width: 1px !important; height: 1px !important; min-height: 0 !important;
  margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
`;

// A reel in the Shorts player that is an ad (its content is an ad slot).
const AD_REEL = ':scope > :is(:has(> ytd-ad-slot-renderer), .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer))';

function youtubeAds(opts) {
  try { webFrame.insertCSS(YT_COVER + (opts && opts.hide === false ? '' : YT_PAGE_ADS), { cssOrigin: 'user' }); } catch { /* frame gone */ }
  shortsData();
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton, button[id^="skip-button"], .ytp-ad-skip-button-container button, .ytp-skip-ad button';
  const PLAYERS = '#movie_player, .html5-video-player';
  const isAd = (p) => p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
  const watched = new WeakSet(), heard = new WeakSet(), mutedByUs = new WeakSet(), rateBefore = new WeakMap(), adSince = new WeakMap();
  // Ads, however many in a row, are past in seconds; a player that says "ad" for longer than this is stuck saying
  // it, and is left alone (you see and hear what it plays) rather than covering your video.
  const STUCK_MS = (opts && opts.stuckMs) || 120e3;
  const stuck = (p) => {
    if (!isAd(p)) { adSince.delete(p); if (p.hasAttribute('data-bifrost-ad-stuck')) p.removeAttribute('data-bifrost-ad-stuck'); return false; }
    if (!adSince.has(p)) adSince.set(p, Date.now());
    if (Date.now() - adSince.get(p) < STUCK_MS) return false;
    if (!p.hasAttribute('data-bifrost-ad-stuck')) p.setAttribute('data-bifrost-ad-stuck', '');
    return true;
  };
  // In the page's own world, where the players' methods are (they can't be seen from this one): for each
  // player (in the order of the same query here), what kind of ad it's showing, and the length of the video
  // it's in front of; one stitched into the stream is seeked past here. Nothing of the page is changed.
  const pageSide = () => {
    try {
      return contextBridge.executeInMainWorld({
        func: (sel) => [...document.querySelectorAll(sel)].map((p) => {
          if (!(p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) || p.hasAttribute('data-bifrost-ad-stuck')) return { kind: 'none', len: 0 };
          let len = 0;
          try { const r = typeof p.getPlayerResponse === 'function' ? p.getPlayerResponse() : null; const n = Number(r && r.videoDetails && r.videoDetails.lengthSeconds); if (n > 0) len = n; } catch { /* no response */ }
          let info = null;
          try { const st = typeof p.getStatsForNerds === 'function' ? p.getStatsForNerds() : null; info = st && typeof st.debug_info === 'string' ? st.debug_info : null; } catch { /* no stats */ }
          if (info === null) return { kind: 'unknown', len };
          if (!/^SSAP,\s*AD/i.test(info)) return { kind: 'own-stream', len };
          try {
            const s = p.getProgressState();
            if (s && s.duration > 0 && s.current < s.duration - 0.25) { p.seekTo(s.duration); return { kind: 'seeked', len }; }
          } catch { /* no seek */ }
          return { kind: 'ssap', len };
        }),
        args: [PLAYERS],
      });
    } catch { return null; }
  };
  const quiet = (v) => {
    if (!v.muted) { v.muted = true; mutedByUs.add(v); }
    if (!rateBefore.has(v)) rateBefore.set(v, v.playbackRate || 1);
    try { if (v.playbackRate !== 16) v.playbackRate = 16; } catch { /* not allowed */ }
  };
  const pass = (p, v, k) => {
    // An ad in a stream of its own, to its end. Only a stream shorter than the video: one with the ad
    // stitched in is the video's own and longer (when the video's length isn't known, a few minutes at most).
    const d = v.duration;
    if ((k.kind === 'own-stream' || k.kind === 'unknown') && isFinite(d) && d > 0 && v.currentTime < d - 0.1
      && (k.len > 0 ? d < k.len - 1 : k.kind === 'own-stream' && d <= 180)) {
      try { v.currentTime = d - 0.05; } catch { /* not seekable yet */ }
    }
    const skip = p.querySelector(SKIP) || document.querySelector(SKIP);
    if (skip) skip.click();
  };
  const restore = (v) => {
    if (mutedByUs.has(v)) { mutedByUs.delete(v); if (v.muted) v.muted = false; }
    if (rateBefore.has(v)) {
      const r = rateBefore.get(v);
      rateBefore.delete(v);
      // (unless YouTube has already set the video's own speed)
      try { if (v.playbackRate === 16) v.playbackRate = r; } catch { /* ignore */ }
    }
  };
  let nextAt = 0;
  const shorts = () => {
    for (const v of document.querySelectorAll('ytd-ad-slot-renderer video, ad-slot-renderer video')) {
      if (!v.muted) v.muted = true;
      if (!v.paused) { try { v.pause(); } catch { /* ignore */ } }
    }
    // The reel YouTube has on is an ad (it's hidden, so you'd see nothing play): on to the next one.
    const inner = document.getElementById('shorts-inner-container');
    if (!inner || Date.now() < nextAt) return;
    const on = [...inner.querySelectorAll(AD_REEL)].find((r) => r.hasAttribute('is-active') || r.querySelector('[is-active]'));
    if (!on) return;
    nextAt = Date.now() + 1000;
    const next = document.querySelector('#navigation-button-down button, #navigation-button-down [role="button"]');
    if (next) next.click();
    else if (on.nextElementSibling) on.nextElementSibling.scrollIntoView({ block: 'start' });
  };
  const tick = () => {
    const list = document.querySelectorAll(PLAYERS);
    let ads = false;
    const off = new Set();
    for (const p of list) {
      if (!watched.has(p)) { watched.add(p); new MutationObserver(tick).observe(p, { attributes: true, attributeFilter: ['class'] }); }
      if (stuck(p)) off.add(p);
      else if (isAd(p)) ads = true;
    }
    const videos = [...list].map((p) => {
      const v = p.querySelector('video');
      if (v && !heard.has(v)) {
        // As soon as an ad's stream has a length (to run it to its end), and as it plays.
        heard.add(v);
        const on = () => { const q = v.closest(PLAYERS); if (q && isAd(q)) tick(); };
        for (const e of ['loadedmetadata', 'durationchange', 'playing', 'timeupdate']) v.addEventListener(e, on, { passive: true });
      }
      if (v && isAd(p) && !off.has(p)) quiet(v);
      return v;
    });
    // (muted first: one stitched into the stream is seeked past in there)
    const kinds = ads ? pageSide() : null;
    list.forEach((p, i) => {
      const v = videos[i];
      if (!v) return;
      if (isAd(p) && !off.has(p)) pass(p, v, (kinds && kinds[i]) || { kind: 'unknown', len: 0 });
      else restore(v);
    });
    for (const b of document.querySelectorAll('.ytp-ad-overlay-close-button')) b.click();
    if (location.pathname.startsWith('/shorts')) shorts();
  };
  setInterval(tick, 250);
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
}

// Shorts: the reels marked as ads are taken out of the reels YouTube fetches (reel_watch_sequence), whether it
// reads them as JSON or as text it parses, and out of any list of reels it parses from elsewhere, before it
// shows them. In the page's own world, where its fetch and JSON.parse are.
function shortsData() {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const parse = JSON.parse, stringify = JSON.stringify;
        const MARK = 'adClientParams';
        const isAdReel = (e) => {
          try { const ep = e && e.command && e.command.reelWatchEndpoint; return !!(ep && ep.adClientParams && ep.adClientParams.isAd); } catch { return false; }
        };
        // Takes the ad reels out of every list of "entries" in o; how many it took out.
        const prune = (o, depth) => {
          if (!o || typeof o !== 'object' || depth > 10) return 0;
          let n = 0;
          if (Array.isArray(o)) { for (const x of o) n += prune(x, depth + 1); return n; }
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (!v || typeof v !== 'object') continue;
            if (k === 'entries' && Array.isArray(v) && v.some(isAdReel)) { o[k] = v.filter((e) => !isAdReel(e)); n += v.length - o[k].length; }
            n += prune(o[k], depth + 1);
          }
          return n;
        };
        JSON.parse = new Proxy(parse, {
          apply(target, self, args) {
            const out = Reflect.apply(target, self, args);
            try { if (out && typeof out === 'object' && typeof args[0] === 'string' && args[0].includes(MARK)) prune(out, 0); } catch { /* left as it was */ }
            return out;
          },
        });
        const fetch0 = window.fetch;
        if (typeof fetch0 !== 'function') return;
        window.fetch = new Proxy(fetch0, {
          apply(target, self, args) {
            const pending = Reflect.apply(target, self, args);
            let url = '';
            try { const a = args[0]; url = typeof a === 'string' ? a : (a && typeof a.url === 'string' ? a.url : String(a)); } catch { return pending; }
            if (!/\/youtubei\/v1\/reel\/|\/reel_watch_sequence/.test(url)) return pending;
            return pending.then((res) => {
              if (!res || !res.ok || res.type === 'opaque' || res.bodyUsed) return res;
              return res.clone().text().then((text) => {
                if (!text.includes(MARK)) return res;
                // (an answer can start with )]}' to keep other sites from reading it as a script)
                let pre = '';
                if (text.startsWith(")]}'")) { const nl = text.indexOf('\n'); pre = nl >= 0 ? text.slice(0, nl + 1) : ")]}'"; }
                const obj = parse(text.slice(pre.length));
                if (!prune(obj, 0)) return res;
                const out = new Response(pre + stringify(obj), { status: res.status, statusText: res.statusText, headers: res.headers });
                Object.defineProperties(out, { url: { value: res.url }, redirected: { value: res.redirected }, type: { value: res.type } });
                return out;
              }).catch(() => res);
            });
          },
        });
      },
      args: [],
    });
  } catch { /* no page world */ }
}

// ---------------------------------------------------------------------------------------------------------
// Start (last: what it runs is all declared above).
(() => {
  const href = location.href;
  if (!/^https?:/i.test(href)) return;
  const isTop = window === window.top;
  // The page itself waits for its rules (its scriptlets must run before its own scripts); frames inside it
  // don't hold anything up and apply theirs when they arrive.
  if (isTop) {
    let first = null;
    try { first = ipcRenderer.sendSync('bifrost-adblock:start', href, true); } catch { /* no blocker */ }
    if (first) apply(first, href, true);
  } else {
    ipcRenderer.invoke('bifrost-adblock:start-frame', href).then((first) => { if (first) apply(first, href, false); }).catch(() => {});
  }
})();
