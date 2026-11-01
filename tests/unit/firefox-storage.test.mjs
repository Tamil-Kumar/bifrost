// Reading Firefox add-on data (src/main/import/firefox-storage.js) from a profile written the way Firefox
// writes it (tests/fixtures/firefox_storage.py, via make-fakehome.py): IndexedDB with snappy-compressed
// structured clones and encoded keys, a value kept in a file of its own, localStorage, storage.sync.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = '/home/claude/bifrost-browser';
const FF = require(ROOT + '/src/main/import/firefox-storage.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-ffstore-'));
execFileSync('python3', [ROOT + '/tests/fixtures/make-fakehome.py', home, '/home/claude/bf-test/exts/darkreader'], { stdio: 'ignore' });
const PROF = path.join(home, '.mozilla', 'firefox', 'abcd1234.default-release');
const DR = 'addon@darkreader.org', ST = '{7a7a4a92-a2a0-41d1-9fd7-1e92480d612d}', UB = 'uBlock0@raymondhill.net';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), (m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));

check('snappy: literals, copies of every kind and overlapping runs', () => {
  const py = (code) => execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT + '/tests/fixtures')}); import firefox_storage as F; ${code}`]);
  const text = Buffer.from('The quick brown fox. '.repeat(400) + 'a'.repeat(5000) + [...Array(3000).keys()].join(','));
  const comp = py(`sys.stdout.buffer.write(F.snappy_compress(open(${JSON.stringify(path.join(home, 't.txt'))}, 'rb').read()))`.replace('open', (fs.writeFileSync(path.join(home, 't.txt'), text), 'open')));
  assert(comp.length < text.length * 0.6, 'it really compressed: ' + comp.length + ' of ' + text.length);
  assert(FF.snappyRaw(comp).equals(text), 'round trip');
  const framed = py(`sys.stdout.buffer.write(F.snappy_framed(open(${JSON.stringify(path.join(home, 't.txt'))}, 'rb').read() * 3))`);
  assert(FF.snappyFramed(framed).equals(Buffer.concat([text, text, text])), 'framed, over several chunks');
  let threw = false;
  try { FF.snappyRaw(Buffer.from([10, 0x08, 0x61])); } catch { threw = true; }
  assert(threw, 'a truncated stream is an error, not garbage');
});

check('keys: strings (one-, two- and three-byte characters), numbers, dates, arrays, trimmed endings', () => {
  const py = (v) => Buffer.from(execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT + '/tests/fixtures')}); import firefox_storage as F; sys.stdout.write(F.encode_key(${v}).hex())`]).toString(), 'hex');
  eq(FF.decodeKey(py("'theme'")), 'theme');
  eq(FF.decodeKey(py("'ünï ✓ 日本 🐉'")), 'ünï ✓ 日本 🐉');
  eq(FF.decodeKey(py('12.5')), 12.5);
  eq(FF.decodeKey(py('-3')), -3);
  eq(FF.decodeKey(py('0')), 0);
  eq(FF.decodeKey(py("['nested', 2, ['deep', 'er']]")), ['nested', 2, ['deep', 'er']]);
  eq(FF.decodeKey(py('[]')), []);
  eq(FF.decodeKey(py('[[[[1]]]]')), [[[[1]]]]);
  eq(FF.decodeKey(py('F.JSDate(1700000000000)')).getTime(), 1700000000000);
});

check('which add-ons have data: Dark Reader, Stylus and uBlock Origin', () => {
  const s = FF.addonsWithData(PROF);
  assert(s.has(DR) && s.has(ST) && s.has(UB) && s.size === 3, JSON.stringify([...s]));
  eq(FF.extensionUuids(PROF)[ST], '9d8c7b6a-5f4e-4d3c-8b2a-1a0f9e8d7c6b');
});

check('Dark Reader: storage.local with every kind of value, one of them in its own file; storage.sync', () => {
  const d = FF.readAddonData(PROF, DR);
  const l = d.local;
  eq(l.enabled, true);
  eq(l.theme, { mode: 1, brightness: 110, contrast: 95, sepia: 10, fontFamily: 'Open Sans', textStroke: 0.3 });
  eq(l.siteList, ['example.com', 'news.ycombinator.com']);
  eq(l.note, 'Ünïcode ✓ 日本語 🐉');
  assert(l.installDate instanceof Date && l.installDate.getTime() === 1700000000000, 'date');
  eq(l.counts, { 0: 5, 1: 7, x: 9 });
  eq(l.numbers, [-42, 3.25, 12345678901234, 0, -0.5]);
  assert(l.nothing === null && 'undef' in l && l.undef === undefined, 'null and undefined');
  assert(l.twice.a === l.twice.b && l.twice.a.list[1] === 2, 'the same object twice (a back reference)');
  assert(l.tags instanceof Set && l.tags.has('b') && l.map instanceof Map && l.map.get('k') === 1, 'Set and Map');
  assert(l.bytes instanceof Uint8Array && [...l.bytes].join() === '1,2,3', 'typed array: ' + l.bytes);
  assert(l.big.length === 300003 && l.big.endsWith('END'), 'the big value from its own file');
  assert(!('blobby' in l) && d.skipped === 1, 'a Blob can’t come over (skipped, counted): ' + d.skipped);
  eq(d.sync, { syncSettings: true, theme: { mode: 1, darkSchemeTextColor: '#e8e6e3' } });
  eq(d.indexedDb, []);
});

check('Stylus: its IndexedDB databases (styles with in-line keys, drafts with out-of-line keys), localStorage', () => {
  const d = FF.readAddonData(PROF, ST);
  eq(d.local, { settings: { popupWidth: 320, 'editor.theme': 'darcula' } });
  const st = d.indexedDb.find((x) => x.name === 'stylish');
  assert(st && st.version === 2, 'stylish v2: ' + JSON.stringify(d.indexedDb.map((x) => [x.name, x.version])));
  const styles = st.stores[0];
  assert(styles.name === 'styles' && styles.keyPath === 'id' && styles.autoIncrement, JSON.stringify(styles).slice(0, 200));
  eq(styles.records.map((r) => [r.value.id, r.value.name, 'key' in r]), [[1, 'Dark GitHub', false], [7, 'Wikipédia sépia', false]]);
  eq(styles.records[0].value.sections, [{ code: 'body { background: #111 !important }', domains: ['github.com'] }]);
  const drafts = d.indexedDb.find((x) => x.name === 'drafts').stores[0];
  eq(drafts.indexes, [{ name: 'by-date', keyPath: 'date', unique: false, multiEntry: false }]);
  eq(drafts.records.map((r) => r.key), [12.5, 'draft-1', ['nested', 2]]);   // (in Firefox's key order)
  eq(d.localStorage, { editorWidth: '420', popupWidth: '320 ✓ ' + 'w'.repeat(200), lang: 'fr ✓' });
});

check('values travel to the extension page and back intact (toWire / FROM_WIRE_JS), with moz-extension addresses rewritten', () => {
  const d = FF.readAddonData(PROF, ST);
  const from = 'moz-extension://' + d.uuid, to = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const w = FF.toWire(d.indexedDb.find((x) => x.name === 'stylish').stores[0].records[0].value, (s) => s.split(from).join(to));
  const back = eval(FF.FROM_WIRE_JS)(JSON.parse(JSON.stringify(w)));
  eq(back.url, to + '/edit.html?id=1');
  const dr = FF.readAddonData(PROF, DR).local;
  const all = eval(FF.FROM_WIRE_JS)(JSON.parse(JSON.stringify(FF.toWire(dr))));
  assert(all.installDate instanceof Date && all.installDate.getTime() === 1700000000000, 'date');
  assert(all.tags instanceof Set && all.map instanceof Map && 'undef' in all && all.undef === undefined, 'set, map, undefined');
  assert(all.bytes instanceof ArrayBuffer && new Uint8Array(all.bytes)[2] === 3, 'bytes');
  assert(all.twice.a.list[1] === 2 && all.big.endsWith('END'), 'objects and the big string');
});

check('a damaged database is reported, not fatal', () => {
  const bad = path.join(home, 'bad.sqlite');
  fs.writeFileSync(bad, 'not a database');
  let threw = false;
  try { FF.readIdb(bad); } catch { threw = true; }
  assert(threw, 'readIdb throws on a broken file');
  fs.mkdirSync(path.join(PROF, 'storage', 'default', 'moz-extension+++2c5d1b1e-7a45-4f6e-9a0e-1f2a3b4c5d6e', 'idb'), { recursive: true });
  fs.copyFileSync(bad, path.join(PROF, 'storage', 'default', 'moz-extension+++2c5d1b1e-7a45-4f6e-9a0e-1f2a3b4c5d6e', 'idb', 'broken.sqlite'));
  const d = FF.readAddonData(PROF, DR);
  assert(d.local.enabled === true && d.indexedDb.length === 0, 'the rest still comes over');
});

fs.rmSync(home, { recursive: true, force: true });
console.log(`\nfirefox-storage: ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
