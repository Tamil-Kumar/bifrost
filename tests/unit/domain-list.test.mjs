// The ad blocker's domain list (src/main/domain-list.js): HaGeZi's files made into one list, which sites are
// the same company's, and the list that comes with Bifrost in the engine with Bifrost's exceptions.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = require(ROOT + '/src/main/domain-list.js');
const { FiltersEngine, Config, Request } = require(ROOT + '/src/vendor/adblocker/engine-core.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// ------------------------------------------------------------------ compose
const blocks = [
  { name: 'adblock/ultimate.txt', text: '[Adblock Plus]\n! Title: x\n||tracker.example^\n||ads.example^\n||sub.ads.example^\n||Mixed.Case.example^\n' },
  { name: 'adblock/pro.txt', text: '||tracker.example^\n||deep.sub.tracker.example^\n||other.example^\n' },
];
const allows = [
  { name: 'share/ultimate-known-issues.txt', text: '# a comment\nok.tracker.example\n\napi*.push.example\n' },
  { name: 'adblock/whitelist-referral.txt', text: '[Adblock Plus]\n! Title: y\n@@||go.ads.example^\n' },
];
const c = L.compose({ blocks, allows, built: '2026-11-08T00:00:00Z', min: 1 });
const lines = c.text.split('\n');
check('every list\'s domains, once each, lower case, none under another that\'s listed',
  lines.filter((l) => l.startsWith('||')), ['||tracker.example^', '||ads.example^', '||mixed.case.example^', '||other.example^']);
check('the allowlists as exceptions, from plain lists and adblock ones (wildcards kept)',
  lines.filter((l) => l.startsWith('@@')), ['@@||ok.tracker.example^', '@@||api*.push.example^', '@@||go.ads.example^']);
check('counts, in the header too', [c.rules, c.exceptions, L.ruleCount(c.text)], [4, 3, 4]);
check('the header says where it\'s from', lines.slice(0, 2), ['[Adblock Plus]', '! Title: HaGeZi\'s DNS blocklists (ultimate, pro)']);
check('a list with no rules in it is a failed download', throws(() => L.compose({ blocks: [blocks[0], { name: 'adblock/pro.txt', text: '<html>Not found</html>' }], min: 1 })), 'adblock/pro.txt: no rules in it');
check('a whole that\'s too small to be right', throws(() => L.compose({ blocks })), 'only 4 rules: not the whole list');
check('a list without a header is counted', L.ruleCount('||a.example^\n||b.example^\n! x\n'), 2);

// ------------------------------------------------------------------ the site you're on
check('a rule covers its own domain and those under it', [L.covers('tracker.example', 'tracker.example'), L.covers('tracker.example', 'www.tracker.example')], [true, true]);
check('…not others', [L.covers('tracker.example', 'nottracker.example'), L.covers('metrics.shop.example', 'www.shop.example'), L.covers('', 'x.example')], [false, false, false]);

// ------------------------------------------------------------------ the same company
check('Google\'s sites and services', [L.sameOwner('google.com', 'googleapis.com'), L.sameOwner('youtube.com', 'googlevideo.com'), L.sameOwner('google.co.uk', 'gstatic.com')], [true, true, true]);
check('Microsoft\'s, Meta\'s, Amazon\'s (its country sites too), TikTok\'s', [L.sameOwner('office.com', 'live.com'), L.sameOwner('instagram.com', 'fbcdn.net'), L.sameOwner('amazon.de', 'media-amazon.com'), L.sameOwner('tiktok.com', 'tiktokv.com')], [true, true, true, true]);
check('not two companies', [L.sameOwner('google.com', 'facebook.com'), L.sameOwner('news.example', 'googleapis.com')], [false, false]);
check('one site is the same site, not "the same company" (its own subdomains are the site\'s business)', L.sameOwner('google.com', 'google.com'), false);
check('somebody\'s site on a company\'s hosting isn\'t the company\'s', [L.ownerOf('amazon.github.io'), L.ownerOf('blogspot.com'), L.ownerOf('appspot.com'), L.ownerOf('cloudfront.net'), L.ownerOf('google.blogspot.com')], [null, null, null, null, null]);

// ------------------------------------------------------------------ the list that comes with Bifrost
const bundled = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets', 'adblock', 'domains.txt.gz'))).toString('utf8');
const keep = fs.readFileSync(path.join(ROOT, 'assets', 'adblock', 'domains-keep.txt'), 'utf8');
check('the bundled list is HaGeZi\'s, whole', [/HaGeZi/.test(bundled.slice(0, 300)), L.ruleCount(bundled) > 250000], [true, true]);
const engine = FiltersEngine.parse(bundled + '\n' + keep, new Config({ loadCosmeticFilters: false, loadGenericCosmeticsFilters: false, loadCSPFilters: false }));
const blocked = (url) => engine.match(Request.fromRawDetails({ url, type: 'script', sourceUrl: 'https://news.example/' })).match;
check('it blocks ad and tracker domains', [blocked('https://pagead2.googlesyndication.com/a.js'), blocked('https://static.hotjar.com/c.js'), blocked('https://ads.yahoo.com/x.js')], [true, true, true]);
check('…not what sites are made of', ['https://fonts.googleapis.com/css', 'https://www.gstatic.com/x.js', 'https://cdnjs.cloudflare.com/x.js', 'https://cdn.jsdelivr.net/x.js', 'https://i.ytimg.com/vi/x/hq.jpg', 'https://js.stripe.com/v3/', 'https://www.paypalobjects.com/x.js', 'https://challenges.cloudflare.com/turnstile/v0/api.js', 'https://js.hcaptcha.com/1/api.js', 'https://www.recaptcha.net/recaptcha/api.js', 'https://upload.wikimedia.org/x.png', 'https://abs.twimg.com/x.js', 'https://static.xx.fbcdn.net/x.js', 'https://login.microsoftonline.com/x', 'https://accounts.google.com/gsi/client'].filter(blocked), []);
check('Bifrost\'s exceptions: bot checks, IP lookups, embedded posts, players\' licences', ['https://client.px-cloud.net/x.js', 'https://captcha.px-cdn.net/x.js', 'https://ipinfo.io/json', 'https://api.ipify.org/', 'https://syndication.twitter.com/srv/x', 'https://platform.linkedin.com/in.js', 'https://entitlements.jwplayer.com/x.json'].filter(blocked), []);
check('HaGeZi\'s own exceptions (known issues)', [blocked('https://tags.tiqcdn.com/utag/x.js'), blocked('https://www.googletagmanager.com/gtm.js')], [false, false]);

console.log(`domain-list: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
