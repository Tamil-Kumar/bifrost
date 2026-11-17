// The domain list's table (src/main/domain-set.js): what it blocks and lets through, the same as the filter
// engine it replaced (Ghostery's, with the same rules) for the list that comes with Bifrost; its file.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = require(ROOT + '/src/main/domain-set.js');
const { FiltersEngine, Config, Request } = require(ROOT + '/src/vendor/adblocker/engine-core.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// ------------------------------------------------------------------ a small list
const small = DS.load(DS.build([
  '[Adblock Plus]', '! Title: a test', '',
  '||tracker.example^', '||ads.adnet.example^', '||Mixed.Case.example^', '||doubleclick.net^',
  '@@||ok.tracker.example^', '@@||ad.doubleclick.net^', '@@||api*.push.example^', '||push.example^',
  '||banner*.wild.example^', '||x.example/path^', '||x.example^$third-party',
].join('\n')));
const m = (host, url) => small.match(host, url || 'https://' + host + '/x.js');
check('a listed domain, and what\'s under it; the rule that stops it is the listed domain', [m('tracker.example'), m('www.tracker.example'), m('a.b.ads.adnet.example')], ['tracker.example', 'tracker.example', 'ads.adnet.example']);
check('…not a host that only ends the same way, nor the domain above a listed one', [m('nottracker.example'), m('adnet.example'), m('example')], ['', '', '']);
check('in any case (hosts come in lower case; the list is made so)', m('mixed.case.example'), 'mixed.case.example');
check('exceptions let a domain and what\'s under it through', [m('ok.tracker.example'), m('x.ok.tracker.example'), m('ad.doubleclick.net'), m('stats.doubleclick.net')], ['', '', '', 'doubleclick.net']);
check('…with a * as adblock syntax has it', [m('api.push.example'), m('api7.push.example'), m('x.api-eu.push.example'), m('static.push.example')], ['', '', '', 'push.example']);
check('a block rule with a *: by the address; the domain it\'s about', [m('banner1.wild.example'), m('cdn.wild.example')], ['wild.example', '']);
check('lines that aren\'t whole domains are left out (counted)', [m('x.example'), JSON.parse(Buffer.from(DS.build('||x.example/path^\n||a.example^').slice(16 + 8)).toString()).skipped], ['', 1]);
check('no host: nothing', small.match('', ''), '');

// ------------------------------------------------------------------ the file
const bytes = DS.build('||a.example^\n||b.example^\n@@||ok.a.example^');
check('the file: its header, two hashes a domain, then the rest', [new Uint32Array(bytes, 0, 4)[0] === 0x53444642, new Uint32Array(bytes, 0, 4)[2], DS.load(bytes).size], [true, 2, 2]);
const odd = new Uint8Array(bytes.byteLength + 1);
odd.set(new Uint8Array(bytes), 1);
check('read back from a buffer that starts anywhere (a file\'s bytes)', DS.load(odd.subarray(1)).match('www.b.example'), 'b.example');
check('not a table, a cut-short one, another version: refused (and built again)', [
  throws(() => DS.load(new Uint8Array([1, 2, 3]))),
  throws(() => DS.load(new Uint8Array(bytes).subarray(0, bytes.byteLength - 3))),
  throws(() => DS.load(new Uint8Array(16))),
], ['not a domain list', 'a domain list cut short', 'not a domain list of this version']);

// ------------------------------------------------------------------ the same as the engine it replaced
const bundled = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets', 'adblock', 'domains.txt.gz'))).toString('utf8');
const keep = fs.readFileSync(path.join(ROOT, 'assets', 'adblock', 'domains-keep.txt'), 'utf8');
const text = bundled + '\n' + keep;
let t0 = performance.now();
const built = DS.build(text);
const buildMs = performance.now() - t0;
t0 = performance.now();
const table = DS.load(new Uint8Array(built));
const loadMs = performance.now() - t0;
const engine = FiltersEngine.parse(text, new Config({ loadCosmeticFilters: false, loadGenericCosmeticsFilters: false, loadCSPFilters: false }));
const listed = [...bundled.matchAll(/^\|\|([a-z0-9_.-]+)\^$/gm)].map((x) => x[1]);
const excepted = [...text.matchAll(/^@@\|\|([a-z0-9_.*-]+)\^$/gm)].map((x) => x[1]);
const urls = [];
for (let i = 0; i < listed.length; i += 37) urls.push('https://' + listed[i] + '/a.js', 'https://cdn.' + listed[i] + '/b.js', 'https://x' + listed[i] + '/c.js', 'https://' + listed[i].replace(/^[^.]+\./, '') + '/d.js');
for (const e of excepted) {
  const host = e.replace(/\*/g, '7');
  urls.push('https://' + host + '/e.js', 'https://www.' + host + '/f.js', 'https://' + host.replace(/^[^.]+\./, '') + '/g.js');
}
for (let i = 0; i < 3000; i++) urls.push(`https://site${i}.example${i % 7 ? '.com' : '.org'}/h.js`);
const theirs = (url) => engine.match(Request.fromRawDetails({ url, type: 'script', sourceUrl: 'https://news.example/' })).match;
const ours = (url) => { const r = Request.fromRawDetails({ url, type: 'script', sourceUrl: 'https://news.example/' }); return !!table.match(r.hostname, r.url); };
const differ = urls.filter((u) => theirs(u) !== ours(u));
check(`the bundled list (${listed.length} domains, ${excepted.length} exceptions with Bifrost's): blocked or not as the engine had it, for ${urls.length} addresses`, differ.slice(0, 8), []);
check('…blocked ones among them, and let-through ones', [urls.filter(ours).length > 10000, urls.filter((u) => !ours(u)).length > 3000], [true, true]);
const fileMb = built.byteLength / 1048576;
check(`its file is small and quick to read back (${fileMb.toFixed(1)} MB, read in ${loadMs.toFixed(1)} ms; built in ${buildMs.toFixed(0)} ms)`, [fileMb < 4, loadMs < 20], [true, true]);
t0 = performance.now();
for (let i = 0; i < 100000; i++) table.match('pagead2.googlesyndication.com', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
check('a hundred thousand requests in well under a second', performance.now() - t0 < 500, true);

console.log(`domain-set: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
