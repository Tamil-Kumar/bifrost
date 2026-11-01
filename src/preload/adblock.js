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

function apply(first, href, isTop) {
  if (first.styles) { try { webFrame.insertCSS(first.styles, { cssOrigin: 'user' }); } catch { /* frame gone */ } }
  for (const script of first.scripts || []) {
    // Runs in the page's own world, now, before its scripts (and regardless of its Content Security Policy).
    try { webFrame.executeJavaScript(script).catch(() => {}); } catch { /* ignore */ }
  }
  // YouTube, or a YouTube player embedded in another page.
  if (first.youtube) youtubeAds();
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

// YouTube: a video ad is skipped as it starts. It's muted and sped up, "Skip" is pressed as soon as it's
// there, and it's run to its end: an ad stitched into the video stream itself ("SSAP", where the <video>
// plays ad and video as one) with the player's own seek, the way uBlock Origin's YouTube fix does it; an ad
// that's a stream of its own by running that stream to its end. When it can't tell which kind it is, it
// leaves the position alone (running the whole stream to its end would skip the video too). Your sound and
// speed come back when the video does.
function youtubeAds() {
  let mutedByUs = false, rateBefore = null;
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton, button[id^="skip-button"], .ytp-ad-skip-button-container button, .ytp-skip-ad button';
  const PLAYER = '#movie_player, .html5-video-player';
  const isAd = (p) => p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
  // In the page's own world, where the player's methods are (they can't be seen from this one): what kind
  // of ad this is, and for one in the stream, the seek past it. Nothing of the page is changed.
  const pageSide = () => {
    try {
      return contextBridge.executeInMainWorld({
        func: (sel) => {
          const p = document.querySelector(sel);
          if (!p || !(p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return 'none';
          let info = null;
          try { const st = typeof p.getStatsForNerds === 'function' ? p.getStatsForNerds() : null; info = st && typeof st.debug_info === 'string' ? st.debug_info : null; } catch { /* no stats */ }
          if (info === null) return 'unknown';
          if (!/^SSAP,\s*AD/i.test(info)) return 'own-stream';
          try {
            const s = p.getProgressState();
            if (s && s.duration > 0 && s.current < s.duration - 0.25) p.seekTo(s.duration);
            return 'seeked';
          } catch { return 'unknown'; }
        },
        args: [PLAYER],
      });
    } catch { return 'unknown'; }
  };
  const tick = () => {
    const player = document.querySelector(PLAYER);
    if (!player) return;
    const v = player.querySelector('video');
    if (isAd(player) && v) {
      if (!v.muted) { v.muted = true; mutedByUs = true; }
      if (rateBefore == null) rateBefore = v.playbackRate || 1;
      try { if (v.playbackRate !== 16) v.playbackRate = 16; } catch { /* not allowed */ }
      const kind = pageSide();
      if (kind === 'own-stream' && isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) {
        try { v.currentTime = v.duration - 0.05; } catch { /* not seekable yet */ }
      }
      const skip = player.querySelector(SKIP) || document.querySelector(SKIP);
      if (skip) skip.click();
    } else if (v) {
      if (mutedByUs) { v.muted = false; mutedByUs = false; }
      if (rateBefore != null) { try { v.playbackRate = rateBefore; } catch { /* ignore */ } rateBefore = null; }
    }
    for (const b of document.querySelectorAll('.ytp-ad-overlay-close-button')) b.click();
  };
  const start = () => {
    setInterval(tick, 250);
    // Faster than the interval when the player switches to an ad (or back).
    const watch = () => {
      const player = document.querySelector(PLAYER);
      if (!player) { setTimeout(watch, 500); return; }
      new MutationObserver(tick).observe(player, { attributes: true, attributeFilter: ['class'] });
      tick();
    };
    watch();
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
