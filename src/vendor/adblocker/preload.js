"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../wb-cache/vendor-src/adblocker/packages/adblocker-electron-preload/src/index.ts
var index_exports = {};
module.exports = __toCommonJS(index_exports);
var import_electron = require("electron");

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

// ../wb-cache/vendor-src/adblocker/packages/adblocker-electron-preload/src/index.ts
/*!
 * Copyright (c) 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
function injectCosmeticFilters(data) {
  return import_electron.ipcRenderer.invoke(
    "@ghostery/adblocker/inject-cosmetic-filters",
    window.location.href,
    data
  );
}
if (window === window.top && window.location.href.startsWith("devtools://") === false) {
  (() => {
    let DOM_MONITOR = null;
    const unload = () => {
      if (DOM_MONITOR !== null) {
        DOM_MONITOR.stop();
        DOM_MONITOR = null;
      }
    };
    injectCosmeticFilters();
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        DOM_MONITOR = new DOMMonitor((update) => {
          if (update.type === "features") {
            injectCosmeticFilters({
              ...update
            });
          }
        });
        DOM_MONITOR.queryAll(window);
        import_electron.ipcRenderer.invoke("@ghostery/adblocker/is-mutation-observer-enabled").then((enableMutationObserver) => enableMutationObserver && DOM_MONITOR?.start(window));
      },
      { once: true, passive: true }
    );
    window.addEventListener("unload", unload, { once: true, passive: true });
  })();
}
