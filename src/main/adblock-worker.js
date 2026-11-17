'use strict';
// Off the main thread: builds the lists' filter engine and returns it serialized, the domain list's table
// (domain-set.js), or puts the domain list together from HaGeZi's files (domain-list.js).
const { parentPort, workerData } = require('node:worker_threads');
const { compose } = require('./domain-list');

// Page scripts that break some sites when run by this engine. uBlock Origin's "trusted" scriptlets and
// the ones that rewrite or remove a page's own inline scripts track uBO's latest scriptlet code closely;
// on YouTube they leave the page stuck on its grey placeholders, so they're never kept for it. (No scriptlets
// run on YouTube at all now; see adblock.js and youtube-ads.js.)
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
  } else if (workerData.job === 'domains') {
    // The domain list: whole domains and its exceptions, as a table of hashes.
    const t0 = Date.now();
    const buf = require('./domain-set').build(workerData.text);
    parentPort.postMessage({ ok: true, buffer: buf, ms: Date.now() - t0 }, [buf]);
  } else {
    const { FiltersEngine, Config } = require('../vendor/adblocker/engine-core.js');
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
    parentPort.postMessage({ ok: true, buffer: buf, ms: Date.now() - t0 }, [buf.buffer]);
  }
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.stack) || e) });
}
