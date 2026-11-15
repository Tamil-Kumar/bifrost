'use strict';
// Marks along Bifrost's start, for finding what's slow: each a name and the milliseconds since the process
// began. With BIFROST_TIMING=1 they're printed (one line of JSON) once the first page is in; tests/bench reads
// that. Costs a clock read and an array push each, so they stay in.
const marks = [];
let born = 0;
try { born = process.getCreationTime() || 0; } catch { born = 0; }
if (!born) born = Date.now() - Math.round(process.uptime() * 1000);

function mark(name) { marks.push([name, Date.now() - born]); }
// (the first time only: for things that happen for every window or tab)
const seen = new Set();
function once(name) { if (seen.has(name)) return false; seen.add(name); mark(name); return true; }

function report() {
  if (process.env.BIFROST_TIMING !== '1') return;
  console.log('[timing] ' + JSON.stringify(marks));
  if (process.env.BIFROST_TIMING_QUIT === '1') setTimeout(() => require('electron').app.quit(), 300);
}

module.exports = { mark, once, report, marks };
