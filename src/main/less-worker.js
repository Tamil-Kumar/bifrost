'use strict';
// Builds userstyles written in LESS off the main thread (see less-builder.js): one at a time, as asked. A file a
// style @imports is asked of the main process, which downloads it (or has it bundled).
const { parentPort } = require('node:worker_threads');
const U = require('../shared/usercss');
const L = require('../shared/less');

const waiting = new Map();   // "<job> <url>" -> { resolve, reject }

function load(job, url) {
  return new Promise((resolve, reject) => {
    waiting.set(job + ' ' + url, { resolve, reject });
    parentPort.postMessage({ type: 'load', id: job, url });
  });
}

parentPort.on('message', async (m) => {
  if (!m) return;
  if (m.type === 'loaded') {
    const w = waiting.get(m.id + ' ' + m.url);
    if (!w) return;
    waiting.delete(m.id + ' ' + m.url);
    if (m.error) w.reject(new Error(m.error)); else w.resolve(m.text);
    return;
  }
  if (m.type !== 'build') return;
  try {
    const result = await U.buildAsync(m.code, m.values || {}, { less: L, load: (url) => load(m.id, url) });
    parentPort.postMessage({ type: 'done', id: m.id, result });
  } catch (e) {
    parentPort.postMessage({ type: 'done', id: m.id, error: String((e && e.message) || e) });
  }
});
