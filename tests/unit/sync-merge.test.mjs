// Sync's merging (src/main/sync/merge.js, payloads.js) against real databases: bookmarks changed on several
// computers at once end up the same everywhere, with nothing lost or duplicated; history visits and
// deletions travel; settings follow the latest change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { Database } = require(path.join(ROOT, 'src/main/db.js'));
const merge = require(path.join(ROOT, 'src/main/sync/merge.js'));
const P = require(path.join(ROOT, 'src/main/sync/payloads.js'));
const { DEFAULTS, clone } = require(path.join(ROOT, 'src/shared/defaults.js'));

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}\n        got:  ${JSON.stringify(a)}\n        want: ${JSON.stringify(b)}`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-sync-unit-'));
let n = 0;
// A computer: its database and its clock. The clocks here agree (each change is later than the one before,
// whichever computer makes it), so "made after" in a test means after.
let last = 0;
const tick = () => (last = Math.max(Date.now(), last + 1));
function device(name) {
  const db = new Database(path.join(TMP, `${name}-${++n}.sqlite`));
  db.stamp = tick;
  return { name, db, now: tick, observe: (t) => { if (t > last) last = t; }, published: null, deletions: [] };
}
const publish = (d) => { d.published = JSON.parse(JSON.stringify(P.bookmarksPayload(d.db))); };
function maxStamp(snap) { let m = 0; for (const x of snap.nodes) m = Math.max(m, x.changed || 0, x.placed || 0); for (const t of Object.values(snap.dead)) m = Math.max(m, t); return m; }
// Reads the others' published copies into d.
function pull(d, all) {
  const remotes = all.filter((o) => o !== d && o.published).map((o) => o.published);
  for (const r of remotes) d.observe(maxStamp(r));
  return P.applyBookmarks(d.db, remotes, d.now());
}
// Everyone publishes and pulls until nothing changes.
function settle(all) {
  for (let round = 0; round < 12; round++) {
    for (const d of all) publish(d);
    let changed = false;
    for (const d of all) if (pull(d, all)) changed = true;
    if (!changed) { for (const d of all) publish(d); return round; }
  }
  throw new Error('bookmarks never settled');
}
// The bookmark tree as titles (and addresses), for comparing.
function tree(db) {
  const walk = (node) => node.children ? { t: node.title, c: node.children.map(walk) } : node.type === 'separator' ? '---' : node.title + ' ' + node.url;
  const root = db.bookmarkTree();
  return root.children.map(walk);
}
const guids = (db) => db.bookmarkSnapshot().nodes.map((x) => [x.guid, x.parent, x.title, x.url || '']).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const BAR = 2, OTHER = 3;
const titles = (db, id) => db.children(id).map((x) => x.title);
const find = (db, title) => db.flatBookmarks().find((b) => b.title === title) || db.bookmarkSnapshot().nodes.find((x) => x.title === title && x.type === 'folder');
const idOf = (db, title) => { const all = db.db.prepare('SELECT id FROM bookmarks WHERE title = ?').all(title); assert(all.length === 1, `one "${title}" on ${db.file} (found ${all.length})`); return all[0].id; };

// ------------------------------------------------------------------ bookmarks
await check('bookmarks made on one computer show up on the other, in the same order', () => {
  const a = device('a'), b = device('b');
  a.db.createBookmark({ parentId: BAR, title: 'One', url: 'https://one.example/' });
  a.db.createBookmark({ parentId: BAR, title: 'Two', url: 'https://two.example/' });
  const f = a.db.createBookmark({ parentId: BAR, title: 'Folder' });
  a.db.createBookmark({ parentId: f.id, title: 'Inside', url: 'https://in.example/' });
  b.db.createBookmark({ parentId: OTHER, title: 'Bs own', url: 'https://b.example/' });
  settle([a, b]);
  eq(tree(b.db), tree(a.db), 'the trees match');
  eq(titles(b.db, BAR), ['One', 'Two', 'Folder'], 'bar on b');
  eq(titles(a.db, OTHER), ['Bs own'], 'other bookmarks on a');
});

await check('a rename on one computer and a move on the other both stick', () => {
  const a = device('a'), b = device('b');
  a.db.createBookmark({ parentId: BAR, title: 'X', url: 'https://x.example/' });
  a.db.createBookmark({ parentId: BAR, title: 'F' });
  settle([a, b]);
  a.db.updateBookmark(idOf(a.db, 'X'), { title: 'X renamed' });
  b.db.moveBookmark(idOf(b.db, 'X'), { parentId: idOf(b.db, 'F') });
  settle([a, b]);
  for (const d of [a, b]) { eq(titles(d.db, idOf(d.db, 'F')), ['X renamed'], 'X in F, renamed, on ' + d.name); eq(titles(d.db, BAR), ['F'], 'bar on ' + d.name); }
});

await check('deleting wins over older changes, and a change made after a delete brings it back', () => {
  const a = device('a'), b = device('b');
  a.db.createBookmark({ parentId: BAR, title: 'Gone', url: 'https://gone.example/' });
  a.db.createBookmark({ parentId: BAR, title: 'Back', url: 'https://back.example/' });
  settle([a, b]);
  b.db.updateBookmark(idOf(b.db, 'Gone'), { title: 'Gone (edited first)' });
  a.db.removeBookmark(idOf(a.db, 'Gone'));
  a.db.removeBookmark(idOf(a.db, 'Back'));
  b.db.updateBookmark(idOf(b.db, 'Back'), { title: 'Back (edited after)' });
  settle([a, b]);
  for (const d of [a, b]) eq(titles(d.db, BAR), ['Back (edited after)'], 'bar on ' + d.name);
});

await check('a bookmark put in a folder deleted elsewhere moves up to the folder’s folder', () => {
  const a = device('a'), b = device('b');
  const outer = a.db.createBookmark({ parentId: BAR, title: 'Outer' });
  a.db.createBookmark({ parentId: outer.id, title: 'Inner' });
  a.db.createBookmark({ parentId: BAR, title: 'Loose', url: 'https://loose.example/' });
  settle([a, b]);
  a.db.removeBookmark(idOf(a.db, 'Inner'));
  b.db.moveBookmark(idOf(b.db, 'Loose'), { parentId: idOf(b.db, 'Inner') });
  b.db.createBookmark({ parentId: idOf(b.db, 'Inner'), title: 'New in inner', url: 'https://new.example/' });
  settle([a, b]);
  for (const d of [a, b]) {
    eq(titles(d.db, idOf(d.db, 'Outer')).sort(), ['Loose', 'New in inner'], 'what ended up in Outer on ' + d.name);
    assert(!d.db.db.prepare("SELECT 1 FROM bookmarks WHERE title = 'Inner'").get(), 'Inner is gone on ' + d.name);
  }
});

await check('folders moved into each other on two computers don’t make a loop', () => {
  const a = device('a'), b = device('b');
  a.db.createBookmark({ parentId: BAR, title: 'F1' });
  a.db.createBookmark({ parentId: BAR, title: 'F2' });
  settle([a, b]);
  a.db.moveBookmark(idOf(a.db, 'F1'), { parentId: idOf(a.db, 'F2') });
  b.db.moveBookmark(idOf(b.db, 'F2'), { parentId: idOf(b.db, 'F1') });
  settle([a, b]);
  eq(tree(a.db), tree(b.db), 'same on both');
  for (const d of [a, b]) {
    const all = d.db.flatBookmarks();
    const snap = d.db.bookmarkSnapshot();
    assert(snap.nodes.filter((x) => x.title === 'F1' || x.title === 'F2').length === 2, 'both folders kept on ' + d.name);
    assert(all.length === 0, 'no bookmarks lost or made');
  }
});

await check('the same bookmarks on both computers before the first sync aren’t doubled', () => {
  const a = device('a'), b = device('b');
  for (const d of [a, b]) {
    const sd = d.db.createBookmark({ parentId: BAR, title: 'Speed Dial' });
    d.db.createBookmark({ parentId: sd.id, title: 'Mail', url: 'https://mail.example/' });
    d.db.createBookmark({ parentId: sd.id, title: 'News', url: 'https://news.example/' });
    d.db.createBookmark({ parentId: BAR, title: 'Docs', url: 'https://docs.example/' });
  }
  a.db.createBookmark({ parentId: idOf(a.db, 'Speed Dial'), title: 'Only on a', url: 'https://a.example/' });
  b.db.createBookmark({ parentId: BAR, title: 'Only on b', url: 'https://b.example/' });
  settle([a, b]);
  eq(tree(a.db), tree(b.db), 'same on both');
  eq(titles(a.db, BAR), ['Speed Dial', 'Docs', 'Only on b'], 'bar');
  eq(titles(a.db, idOf(a.db, 'Speed Dial')), ['Mail', 'News', 'Only on a'], 'speed dial');
  // A third computer that saw a's old ids before they were merged lets them go too.
  const c = device('c');
  settle([a, b, c]);
  eq(tree(c.db), tree(a.db), 'a third computer matches');
});

await check('a new computer joining keeps its own bookmarks next to everyone’s', () => {
  const a = device('a'), b = device('b'), c = device('c');
  a.db.createBookmark({ parentId: BAR, title: 'A1', url: 'https://a1.example/' });
  settle([a, b]);
  c.db.createBookmark({ parentId: BAR, title: 'C1', url: 'https://c1.example/' });
  settle([a, b, c]);
  for (const d of [a, b, c]) eq(titles(d.db, BAR).sort(), ['A1', 'C1'], 'bar on ' + d.name);
});

await check('reordering on one computer while adding on another keeps both', () => {
  const a = device('a'), b = device('b');
  for (const t of ['p', 'q', 'r']) a.db.createBookmark({ parentId: BAR, title: t, url: `https://${t}.example/` });
  settle([a, b]);
  a.db.moveBookmark(idOf(a.db, 'r'), { parentId: BAR, index: 0 });
  b.db.createBookmark({ parentId: BAR, title: 's', url: 'https://s.example/' });
  settle([a, b]);
  for (const d of [a, b]) {
    const t = titles(d.db, BAR);
    assert(t.length === 4 && t.includes('s'), 'all four on ' + d.name + ': ' + t);
    assert(t.indexOf('r') < t.indexOf('p') && t.indexOf('p') < t.indexOf('q'), 'a’s order on ' + d.name + ': ' + t);
  }
  eq(titles(a.db, BAR), titles(b.db, BAR), 'same order');
});

await check('300 random changes on three computers, synced at random, end up the same everywhere', () => {
  let seed = 7;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const all = [device('r1'), device('r2'), device('r3')];
  const live = (d) => d.db.db.prepare('SELECT id, type, role FROM bookmarks').all();
  for (let i = 0; i < 300; i++) {
    const d = all[rnd(3)];
    const rows = live(d);
    const folders = rows.filter((r) => r.type === 'folder' && r.role !== 'root');
    const items = rows.filter((r) => !r.role);
    const pick = (l) => l[rnd(l.length)];
    try {
      switch (rnd(7)) {
        case 0: case 1: d.db.createBookmark({ parentId: pick(folders).id, title: 't' + rnd(6), url: 'https://e.example/' + rnd(6) }); break;
        case 2: d.db.createBookmark({ parentId: pick(folders).id, title: 'f' + rnd(4) }); break;
        case 3: if (items.length) d.db.updateBookmark(pick(items).id, { title: 'n' + rnd(9) }); break;
        case 4: if (items.length) d.db.moveBookmark(pick(items).id, { parentId: pick(folders).id, index: rnd(4) }); break;
        case 5: if (items.length && rnd(2)) d.db.removeBookmark(pick(items).id); break;
        case 6: { const o = all[rnd(3)]; publish(o); pull(all[rnd(3)], all); break; }
      }
    } catch (e) { if (!/cannot move a folder into itself/.test(e.message)) throw e; }
  }
  settle(all);
  eq(tree(all[1].db), tree(all[0].db), 'r2 matches r1');
  eq(tree(all[2].db), tree(all[0].db), 'r3 matches r1');
  eq(guids(all[2].db), guids(all[0].db), 'the same ids everywhere');
  for (const d of all) {
    const roles = d.db.db.prepare('SELECT role FROM bookmarks WHERE role IS NOT NULL ORDER BY id').all().map((r) => r.role);
    eq(roles, ['root', 'bar', 'other', 'mobile'], 'the fixed folders on ' + d.name);
    const bad = d.db.db.prepare('SELECT parent_id, COUNT(*) n, COUNT(DISTINCT position) p, MAX(position) m FROM bookmarks WHERE parent_id IS NOT NULL GROUP BY parent_id').all().filter((r) => r.n !== r.p || r.m !== r.n - 1);
    assert(!bad.length, 'positions are 0..n-1 in every folder on ' + d.name + ': ' + JSON.stringify(bad));
  }
});

// ------------------------------------------------------------------ history
function historyDevice(name) { const d = device(name); d.db.on('history-deleted', (r) => d.deletions.push(Object.assign({ at: Date.now() }, r))); return d; }
const visitsOf = (d) => d.db.visits({ limit: 1000 }).map((v) => v.url.replace('https://', '') + (v.source ? '@' + v.source : '')).sort();
// d reads every other computer's history (as main/sync does).
function pullHistory(d, all) {
  const known = all.flatMap((o) => o.deletions);
  for (const o of all) if (o !== d) P.applyHistory(d.db, o.name, JSON.parse(JSON.stringify(P.historyPayload(o.db, o.deletions))), known);
}

await check('visits travel to the other computer, marked as from there', () => {
  const a = historyDevice('ha'), b = historyDevice('hb');
  const t = Date.now() - 5000;
  a.db.addVisit({ url: 'https://one.example/', title: 'One', time: t });
  a.db.addVisit({ url: 'https://two.example/', title: 'Two', time: t + 1, transition: 'typed', typed: true });
  b.db.addVisit({ url: 'https://three.example/', title: 'Three', time: t + 2 });
  pullHistory(b, [a, b]); pullHistory(a, [a, b]);
  eq(visitsOf(b), ['one.example/@ha', 'three.example/', 'two.example/@ha'], 'b’s history');
  eq(visitsOf(a), ['one.example/', 'three.example/@hb', 'two.example/'], 'a’s history');
  const two = b.db.historySearch({ text: 'two' })[0];
  assert(two && two.title === 'Two' && two.typedCount === 1, 'title and typed count came along: ' + JSON.stringify(two));
  // Pulling again changes nothing (no doubles).
  pullHistory(b, [a, b]);
  eq(visitsOf(b), ['one.example/@ha', 'three.example/', 'two.example/@ha'], 'b’s history after another pull');
});

await check('a visit deleted on either computer goes on both, and doesn’t come back', () => {
  const a = historyDevice('ha'), b = historyDevice('hb');
  const t = Date.now() - 5000;
  a.db.addVisit({ url: 'https://keep.example/', title: 'Keep', time: t });
  a.db.addVisit({ url: 'https://drop.example/', title: 'Drop', time: t + 1 });
  pullHistory(b, [a, b]);
  const v = b.db.visits({ limit: 10 }).find((x) => x.url === 'https://drop.example/');
  b.db.deleteVisit(v.id);
  pullHistory(b, [a, b]);            // a still has it: it must not come back to b
  eq(visitsOf(b), ['keep.example/@ha'], 'b after pulling a’s old copy');
  pullHistory(a, [a, b]);            // a hears of the deletion
  eq(visitsOf(a), ['keep.example/'], 'a after pulling b’s deletion');
  pullHistory(b, [a, b]);
  eq(visitsOf(b), ['keep.example/@ha'], 'b at the end');
});

await check('clearing history on one computer clears what came before on the other; later visits stay', async () => {
  const a = historyDevice('ha'), b = historyDevice('hb');
  const t = Date.now() - 5000;
  a.db.addVisit({ url: 'https://old-a.example/', time: t });
  b.db.addVisit({ url: 'https://old-b.example/', time: t + 1 });
  pullHistory(a, [a, b]); pullHistory(b, [a, b]);
  a.db.clearHistory();
  await new Promise((r) => setTimeout(r, 5));
  b.db.addVisit({ url: 'https://new-b.example/', time: Date.now() });
  pullHistory(b, [a, b]);
  eq(visitsOf(b), ['new-b.example/'], 'b');
  pullHistory(a, [a, b]);
  eq(visitsOf(a), ['new-b.example/@hb'], 'a');
});

await check('clearing history as the browser closes stays on that computer', () => {
  const a = historyDevice('ha'), b = historyDevice('hb');
  b.db.addVisit({ url: 'https://b.example/', time: Date.now() - 1000 });
  pullHistory(a, [a, b]);
  a.db.clearHistory({ local: true });
  assert(!a.deletions.length, 'no deletion passed on');
  pullHistory(b, [a, b]);
  eq(visitsOf(b), ['b.example/'], 'b keeps its history');
});

await check('a computer deleting a whole page’s history spares visits made after', async () => {
  const a = historyDevice('ha'), b = historyDevice('hb');
  b.db.addVisit({ url: 'https://p.example/', time: Date.now() - 3000 });
  pullHistory(a, [a, b]);
  a.db.deleteUrl('https://p.example/');
  await new Promise((r) => setTimeout(r, 5));
  b.db.addVisit({ url: 'https://p.example/', time: Date.now() });
  pullHistory(b, [a, b]);
  eq(visitsOf(b), ['p.example/'], 'b keeps the later visit only');
  assert(b.db.visits({ limit: 10 }).length === 1, 'one visit left');
});

// ------------------------------------------------------------------ settings
await check('which settings follow you', () => {
  const p = merge.syncedPaths(DEFAULTS);
  for (const x of ['appearance.theme', 'appearance.accent', 'search.engines', 'search.defaultEngine', 'keyboard.shortcuts', 'privacy.adblock.enabled', 'tabs.restoreOnStartup', 'translate.target', 'appearance.newTab.clock.hours'])
    assert(p.includes(x), 'syncs ' + x);
  for (const x of ['appearance.uiScale', 'appearance.sidebarWidth', 'downloads.folder', 'performance.profile', 'sync.enabled', 'sync.folder', 'advanced.hardwareAcceleration',
    'appearance.newTab.image', 'appearance.newTab.speedDialFolder', 'extensions.pinned', 'privacy.clearOnExit.history', 'onboarding.done', 'launcher.bookmarkFolders.ids'])
    assert(!p.includes(x), 'doesn’t sync ' + x);
});

await check('a computer joining takes the others’ settings; after that the latest change wins', () => {
  const paths = merge.syncedPaths(DEFAULTS);
  let t = 1000;
  const stamp = () => ++t;
  const A = clone(DEFAULTS); A.appearance.theme = 'nord'; A.search.defaultEngine = 'ddg';
  const B = clone(DEFAULTS); B.appearance.theme = 'latte'; B.appearance.uiScale = 1.25;
  const sa = {}, sb = {};
  merge.noteSettings(sa, A, paths, stamp, 0);         // the first computer
  merge.noteSettings(sb, B, paths, stamp, -1);        // joins later
  const toB = merge.mergeSettings(sb, [merge.settingsPayload(sa)], paths);
  eq(toB, { 'appearance.theme': 'nord', 'search.defaultEngine': 'ddg' }, 'what b takes from a');
  assert(!merge.mergeSettings(sa, [merge.settingsPayload(sb)], paths)['appearance.theme'], 'a keeps its theme');
  // b changes the theme: a gets it.
  B.appearance.theme = 'nord'; B.search.defaultEngine = 'ddg';
  merge.noteSettings(sb, B, paths, stamp, -1);        // (after applying: nothing new)
  B.appearance.theme = 'dracula';
  assert(merge.noteSettings(sb, B, paths, stamp, -1), 'b noticed its change');
  eq(merge.mergeSettings(sa, [merge.settingsPayload(sb)], paths), { 'appearance.theme': 'dracula' }, 'what a takes from b');
  eq(merge.mergeSettings(sb, [merge.settingsPayload(sa)], paths), {}, 'nothing goes back to b');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nsync-merge: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
