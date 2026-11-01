'use strict';
// Builds one dangerous-sites list's engine off the main thread (see safety.js): network rules only.
const { parentPort, workerData } = require('node:worker_threads');
const { FiltersEngine, Config } = require('../vendor/adblocker/engine-core.js');

try {
  const config = new Config({
    loadNetworkFilters: true, loadCosmeticFilters: false, loadGenericCosmeticsFilters: false, loadExtendedSelectors: false,
    enableHtmlFiltering: false, enableOptimizations: true, enableCompression: false, loadCSPFilters: false, guessRequestTypeFromUrl: false,
  });
  const engine = FiltersEngine.parse(workerData.text, config);
  const buf = engine.serialize();
  parentPort.postMessage({ ok: true, buffer: buf }, [buf.buffer]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.stack || e) });
}
