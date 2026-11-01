'use strict';
// Builds the filter engine off the main thread: parse lists + resources, return the serialized engine.
const { parentPort, workerData } = require('node:worker_threads');
const { FiltersEngine, Config } = require('../vendor/adblocker/engine-core.js');

// Page scripts that break some sites when run by this engine. uBlock Origin's "trusted" scriptlets and
// the ones that rewrite or remove a page's own inline scripts track uBO's latest scriptlet code closely;
// on YouTube they leave the page stuck on its grey placeholders, so they're never kept for it. (YouTube's
// other scriptlets only run if you turn them on, privacy.adblock.youtubeFilters; see adblock.js.)
const FRAGILE = /^([^#!]*)#@?#\+js\((trusted-|rpnt\b|rmnt\b|replace-node-text|remove-node-text|rmnt-|json-edit)/;
const FRAGILE_SITES = /(^|,|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)(,|$)/;
function siteSafe(text) {
  return text.split('\n').filter((line) => {
    const m = FRAGILE.exec(line);
    return !(m && FRAGILE_SITES.test(m[1]));
  }).join('\n');
}

try {
  const config = new Config({
    loadNetworkFilters: true,
    loadCosmeticFilters: workerData.cosmetic,
    loadGenericCosmeticsFilters: workerData.cosmetic,
    loadExtendedSelectors: false,
    enableHtmlFiltering: false,
    enableMutationObserver: true,
    enableOptimizations: true,
    enableCompression: false,
    loadCSPFilters: true,
    guessRequestTypeFromUrl: false,
  });
  const t0 = Date.now();
  const engine = FiltersEngine.parse(siteSafe(workerData.text), config);
  if (workerData.resources) engine.updateResources(workerData.resources, 'r' + workerData.resources.length);
  const buf = engine.serialize();
  parentPort.postMessage({ ok: true, buffer: buf, ms: Date.now() - t0, networkFilters: engine.getFilters ? undefined : undefined }, [buf.buffer]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.stack || e) });
}
