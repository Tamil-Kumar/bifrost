// debounce (src/pages/common/util.js): waits for calls to stop, but with maxWait never longer than that,
// so a page retitling itself nonstop can't hold back the tab snapshot or the session save.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { debounce } = await import(pathToFileURL(path.join(ROOT, 'src/pages/common/util.js')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

// Calls fn every `every` ms for `ms` ms.
async function hammer(d, every, ms) {
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) { d(i++); await sleep(every); }
}

await check('calls that never stop still let it run, every maxWait', async () => {
  const runs = [];
  const d = debounce((i) => runs.push(i), 50, 200);
  await hammer(d, 15, 1000);
  assert(runs.length >= 4 && runs.length <= 6, `ran ${runs.length} times in a second (every 200 ms would be 5)`);
});

await check('without maxWait it waits for the calls to stop, then runs once with the last call', async () => {
  const runs = [];
  const d = debounce((i) => runs.push(i), 50);
  await hammer(d, 15, 400);
  assert(runs.length === 0, `ran ${runs.length} times while still being called`);
  await sleep(120);
  assert(runs.length === 1, `ran ${runs.length} times after the calls stopped`);
});

await check('the last call’s arguments are the ones it gets', async () => {
  const runs = [];
  const d = debounce((v) => runs.push(v), 30, 500);
  d('a'); d('b'); d('c');
  await sleep(90);
  assert(runs.length === 1 && runs[0] === 'c', JSON.stringify(runs));
});

await check('flush runs it at once, and what was pending doesn’t run again', async () => {
  let n = 0;
  const d = debounce(() => n++, 40, 100);
  d(); d.flush();
  assert(n === 1, 'flush ran it ' + n + ' times');
  await sleep(150);
  assert(n === 1, 'it ran again after flush: ' + n);
});

await check('maxWait counts from the first call after a run, not from the very first call', async () => {
  const runs = [];
  const d = debounce(() => runs.push(Date.now()), 50, 200);
  d(); await sleep(120);                 // settles and runs (50 ms after the call)
  const t0 = Date.now();
  await hammer(d, 15, 300);              // a new burst: the next run comes ~200 ms into it, not at once
  const inBurst = runs.filter((t) => t >= t0);
  assert(inBurst.length >= 1 && inBurst[0] - t0 >= 150, 'ran ' + (inBurst.length ? inBurst[0] - t0 + ' ms' : 'never') + ' into the new burst');
});

await check('cancel drops what was pending', async () => {
  let n = 0;
  const d = debounce(() => n++, 30, 60);
  d(); d.cancel();
  await sleep(100);
  assert(n === 0, 'ran ' + n + ' times');
});

console.log(`\ndebounce: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
