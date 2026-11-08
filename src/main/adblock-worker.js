'use strict';
// Off the main thread: builds a filter engine (the lists, or the domain list) and returns it serialized, or
// puts the domain list together from HaGeZi's files (domain-list.js).
const { parentPort, workerData } = require('node:worker_threads');
const { FiltersEngine, Config } = require('../vendor/adblocker/engine-core.js');
const { compose } = require('./domain-list');

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
  if (workerData.job === 'compose') {
    parentPort.postMessage({ ok: true, ...compose(workerData) });
  } else {
    // The domain list is network rules alone (whole domains, and its exceptions).
    const domains = workerData.job === 'domains';
    const config = new Config({
      loadNetworkFilters: true,
      loadCosmeticFilters: !domains && workerData.cosmetic,
      loadGenericCosmeticsFilters: !domains && workerData.cosmetic,
      loadExtendedSelectors: false,
      enableHtmlFiltering: false,
      enableMutationObserver: true,
      enableOptimizations: true,
      enableCompression: false,
      loadCSPFilters: !domains,
      guessRequestTypeFromUrl: false,
    });
    const t0 = Date.now();
    const engine = FiltersEngine.parse(domains ? workerData.text : siteSafe(workerData.text), config);
    if (workerData.resources) engine.updateResources(workerData.resources, 'r' + workerData.resources.length);
    const buf = engine.serialize();
    parentPort.postMessage({ ok: true, buffer: buf, ms: Date.now() - t0 }, [buf.buffer]);
  }
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.stack) || e) });
}
