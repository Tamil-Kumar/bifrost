// The sync engine (src/main/sync/index.js) without Electron: two engines, each with its own profile
// (database, settings, session), share a folder. What goes wrong with real cloud folders: a half-written or
// broken file, a computer on a newer Bifrost, the folder's drive missing or not writable, quitting with
// changes still waiting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const SRC = path.join(ROOT, 'src/main');
const { Database } = require(path.join(SRC, 'db.js'));
const { Settings } = require(path.join(SRC, 'settings.js'));
const { SessionStore } = require(path.join(SRC, 'session-store.js'));

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, label) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(50); } throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')'); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-sync-engine-'));
const cloud = path.join(TMP, 'cloud');
fs.mkdirSync(cloud);

// One computer: its own copy of the context and engine modules (they're singletons per process).
function computer(name, sync) {
  for (const m of ['context.js', 'sync/index.js']) delete require.cache[path.join(SRC, m)];
  const ctx = require(path.join(SRC, 'context.js'));
  const { Sync } = require(path.join(SRC, 'sync/index.js'));
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  if (sync) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ sync }));
  ctx.settings = new Settings(dir);
  ctx.db = new Database(path.join(dir, 'bifrost.sqlite'));
  ctx.sessionStore = new SessionStore(dir);
  const engine = new Sync();
  ctx.sync = engine;
  engine.init();
  return { name, ctx, engine, db: ctx.db, settings: ctx.settings };
}
const bar = (c) => c.db.children(2).map((b) => b.title);
const myDir = (c) => path.join(cloud, 'Bifrost Sync', c.engine.device.id);

const A = computer('a', { enabled: true, folder: cloud, deviceName: 'A' });
await A.engine.pull();
let B;

await check('a computer writes its files; another one joining reads them', async () => {
  A.db.createBookmark({ parentId: 2, title: 'From A', url: 'https://a.example/' });
  A.settings.set('appearance.theme', 'nord');
  await A.engine.writeAll(true);
  for (const f of ['device.json', 'bookmarks.json.gz', 'settings.json', 'history.json.gz']) assert(fs.existsSync(path.join(myDir(A), f)), 'A wrote ' + f);
  B = computer('b', { enabled: true, folder: cloud, deviceName: 'B' });
  await B.engine.pull();
  await until(() => bar(B).includes('From A'), 3000, 'A’s bookmark on B');
  assert(B.settings.get('appearance.theme') === 'nord', 'B took A’s theme: ' + B.settings.get('appearance.theme'));
  const info = B.engine.info();
  assert(info.state === 'ok' && info.devices.length === 1 && info.devices[0].name === 'A', 'B lists A: ' + JSON.stringify(info));
});

await check('a broken or half-written file is skipped, and what was read before stays', async () => {
  const file = path.join(myDir(A), 'bookmarks.json.gz');
  const good = fs.readFileSync(file);
  fs.writeFileSync(file, good.subarray(0, Math.floor(good.length / 2)));
  await B.engine.pull();
  assert(B.engine.info().state === 'ok', 'still fine: ' + JSON.stringify(B.engine.info()));
  assert(bar(B).includes('From A'), 'A’s bookmark is still there');
  fs.writeFileSync(path.join(myDir(A), 'settings.json'), '{ "format": 1, "values": ');
  await B.engine.pull();
  assert(B.engine.info().state === 'ok' && B.settings.get('appearance.theme') === 'nord', 'settings unharmed');
  fs.writeFileSync(file, good);
  A.engine.written = {};
  await A.engine.writeAll(true);
});

await check('a computer on a newer Bifrost is noticed, and its files left alone', async () => {
  const file = path.join(myDir(A), 'settings.json');
  const saved = fs.readFileSync(file);
  fs.writeFileSync(file, JSON.stringify({ format: 99, values: { 'appearance.theme': { v: 'latte', t: Date.now() + 1000 } } }));
  await B.engine.pull();
  assert(B.engine.info().newer === true, 'B says a computer has a newer Bifrost');
  assert(B.settings.get('appearance.theme') === 'nord', 'nothing taken from it');
  fs.writeFileSync(file, saved);
  await B.engine.pull();
  assert(B.engine.info().newer === false, 'and stops saying so');
});

await check('a sync folder that isn’t there says so, and sync picks up again when it is', async () => {
  const gone = path.join(TMP, 'unplugged-drive');
  fs.writeFileSync(gone, 'a file where the folder should be');   // like a drive letter that's missing
  B.settings.set('sync.folder', path.join(gone, 'OneDrive'));
  await sleep(50);
  await B.engine.pull();
  const info = B.engine.info();
  assert(info.state === 'error' && /Can’t find the sync folder/.test(info.error), 'error shown: ' + JSON.stringify(info));
  B.settings.set('sync.folder', cloud);
  await sleep(50);
  await B.engine.pull();
  await until(() => B.engine.info().state === 'ok', 3000, 'sync working again');
  assert(B.engine.info().devices.length === 1, 'A listed again');
});

await check('a sync folder Bifrost may not write to says so', async () => {
  if (process.getuid && process.getuid() === 0) { console.log('      (skipped: running as root, nothing is off limits)'); return; }
  const locked = path.join(TMP, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o500);
  B.settings.set('sync.folder', locked);
  await sleep(50);
  await B.engine.pull();
  const info = B.engine.info();
  fs.chmodSync(locked, 0o700);
  assert(info.state === 'error' && /isn’t allowed/.test(info.error), 'error shown: ' + JSON.stringify(info));
  B.settings.set('sync.folder', cloud);
  await sleep(50);
  await B.engine.pull();
});

await check('changes still waiting when Bifrost closes are written as it closes', async () => {
  B.db.createBookmark({ parentId: 2, title: 'Just before closing', url: 'https://late.example/' });
  B.ctx.sessionStore.save('w1', { workspaces: [{ id: 's1', name: 'Space' }], tabs: [{ id: 't1', workspaceId: 's1', url: 'https://open.example/', title: 'Open tab' }] });
  B.ctx.sessionStore.writeNow();
  assert(B.engine.timers.bookmarks && B.engine.timers.device, 'writes are waiting');
  B.engine.flushSync();
  const dev = JSON.parse(fs.readFileSync(path.join(myDir(B), 'device.json'), 'utf8'));
  assert(dev.windows.length === 1 && dev.windows[0].tabs[0].title === 'Open tab', 'the open tab was saved: ' + JSON.stringify(dev.windows));
  await A.engine.pull();
  assert(bar(A).includes('Just before closing'), 'A got the last bookmark: ' + bar(A));
  assert(A.engine.remoteTabs()[0].windows[0].tabs[0].url === 'https://open.example/', 'A sees B’s open tab');
});

await check('turning sync off stops writing; turning it on again carries on as the same computer', async () => {
  const id = B.engine.device.id;
  B.settings.set('sync.enabled', false);
  await sleep(50);
  assert(B.engine.info().state === 'off', 'off');
  const before = fs.statSync(path.join(myDir(A), '..', id, 'bookmarks.json.gz')).mtimeMs;
  B.db.createBookmark({ parentId: 2, title: 'While off', url: 'https://off.example/' });
  await sleep(1800);
  assert(fs.statSync(path.join(myDir(A), '..', id, 'bookmarks.json.gz')).mtimeMs === before, 'nothing written while off');
  B.settings.set('sync.enabled', true);
  await sleep(50);
  await B.engine.pull();
  assert(B.engine.device.id === id, 'the same id');
  await B.engine.writeAll(true);
  await A.engine.pull();
  assert(bar(A).includes('While off'), 'what changed meanwhile went out when it came back on');
});

await check('turning on history sync later brings the history synced meanwhile', async () => {
  B.settings.set('sync.history', false);
  await sleep(50);
  A.db.addVisit({ url: 'https://while-history-off.example/', title: 'Meanwhile', time: Date.now() - 1000 });
  await A.engine.writeAll(true);
  await B.engine.pull();
  assert(!B.db.visits({ limit: 100 }).some((v) => v.url.includes('while-history-off')), 'not taken while off');
  B.settings.set('sync.history', true);
  await sleep(50);
  await B.engine.pull();
  await until(() => B.db.visits({ limit: 100 }).some((v) => v.url.includes('while-history-off')), 3000, 'A’s visit on B');
});

await check('moving to another folder while a read is under way still sets up the new one', async () => {
  const other = path.join(TMP, 'cloud2');
  fs.mkdirSync(other);
  const reading = B.engine.pull();
  B.settings.set('sync.folder', other);
  await reading;
  await until(() => fs.existsSync(path.join(other, 'Bifrost Sync', B.engine.device.id, 'bookmarks.json.gz')), 3000, 'B’s files in the new folder');
  B.settings.set('sync.folder', cloud);
  await sleep(50);
  await B.engine.pull();
});

await check('a computer’s copy of the profile on another computer gets an id of its own', async () => {
  const before = A.engine.device.id;
  A.db.kvSet('sync.device', { id: before, host: 'some-other-computer' });
  A.settings.set('sync.deviceName', 'A renamed');   // (any change of sync settings re-reads who this is)
  await sleep(50);
  assert(A.engine.device.id !== before, 'a new id');
  assert(A.db.kvGet('sync.device').host === os.hostname(), 'tied to this computer');
});

for (const c of [A, B]) { c.engine.stop(); c.db.close(); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nsync-engine: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
