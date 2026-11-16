// YouTube's answers without their ads (src/main/youtube-edit.js, by the rules in src/shared/youtube-rules.json):
// the player's data, a watch page's own, Shorts' reels, the player's script; what each answer is; what's left
// alone; and what rules are taken (newer ones come from the repository: only ones that pass these checks).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = require(ROOT + '/src/main/youtube-edit.js');
const RULES = require(ROOT + '/src/shared/youtube-rules.json');
// The built-in rules, as Bifrost uses them.
const R = E.compile(RULES);
const Y = {
  playerData: (t) => R.edit('player', t), watchPage: (t) => R.edit('page', t), reels: (t) => R.edit('reels', t), playerScript: (t) => R.edit('script', t),
  kindOf: R.kindOf,
};

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

const response = { responseContext: {}, playabilityStatus: { status: 'OK' }, streamingData: { formats: [] },
  adPlacements: [{ adPlacementRenderer: { config: { kind: 'AD_PLACEMENT_KIND_START' } } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }],
  videoDetails: { videoId: 'abc', title: 'A "playerAds" talk', shortDescription: 'adSlots: none\nadPlacements' } };
const text = JSON.stringify(response);
const out = JSON.parse(Y.playerData(text));
check('the player’s data: its ads renamed no_ads (none left to play), the rest as it was',
  [out.adPlacements, out.playerAds, out.adSlots, !!out.no_ads, out.streamingData, out.playabilityStatus.status], [undefined, undefined, undefined, true, { formats: [] }, 'OK']);
check('…keys only: the same words in a title or a description stay', [out.videoDetails.title, out.videoDetails.shortDescription], ['A "playerAds" talk', 'adSlots: none\nadPlacements']);
check('…with )]}\' before it, and nested (a watch page asked for by the page: [{ playerResponse }])',
  [JSON.parse(Y.playerData(")]}'\n" + text).slice(5)).adSlots, JSON.parse(Y.playerData(JSON.stringify([{ playerResponse: response }])))[0].playerResponse.adPlacements], [undefined, undefined]);
check('…nothing to change: the same text', Y.playerData('{"a":1}') === '{"a":1}', true);

const page = `<html><script>var ytInitialData = {"contents":{"adSlots":[1]}};</script><script nonce="x">var ytInitialPlayerResponse = ${text};var meta = document.createElement('meta');</script><p>"adPlacements": text</p></html>`;
const edited = Y.watchPage(page);
const inline = JSON.parse(/ytInitialPlayerResponse = (\{.*\});var meta/.exec(edited)[1]);
check('a watch page: its player data without ads', [inline.adPlacements, inline.playerAds, inline.adSlots, inline.videoDetails.videoId], [undefined, undefined, undefined, 'abc']);
check('…and nothing else in it changed', [edited.includes('var ytInitialData = {"contents":{"adSlots":[1]}};'), edited.includes('<p>"adPlacements": text</p>'), edited.length - page.length], [true, true, ('"no_ads"'.length * 3) - ('"adPlacements"'.length + '"playerAds"'.length + '"adSlots"'.length)]);
check('…braces in its strings don’t end it early', JSON.parse(/= (\{.*\});/.exec(Y.watchPage('<script>var ytInitialPlayerResponse = {"t":"} {\\"","adSlots":[2]};</script>'))[1]), { t: '} {"', no_ads: [2] });
check('…a page without one: the same', Y.watchPage('<html>nothing</html>'), '<html>nothing</html>');

const reel = (id, ad) => ({ command: { reelWatchEndpoint: Object.assign({ videoId: id }, ad ? { adClientParams: { isAd: true } } : {}) } });
const seq = { entries: [reel('r1'), reel('r-ad', true), reel('r2')], continuationEndpoint: { token: 'next' } };
const ids = (j) => j.entries.map((e) => e.command.reelWatchEndpoint.videoId);
check('Shorts: the ad reels taken out', ids(JSON.parse(Y.reels(JSON.stringify(seq)))), ['r1', 'r2']);
check('…inside another answer, and after )]}\'', [ids(JSON.parse(Y.reels(JSON.stringify({ reelWatchSequenceResponse: seq }))).reelWatchSequenceResponse), Y.reels(")]}'\n" + JSON.stringify(seq)).startsWith(")]}'\n")], [['r1', 'r2'], true]);
check('…none there, or not JSON: the same', [Y.reels(JSON.stringify({ entries: [reel('a')] })) === JSON.stringify({ entries: [reel('a')] }), Y.reels('adClientParams {') === 'adClientParams {'], [true, true]);

const script = 'var a=function(U){if(!U||!U.adPlacements&&!U.adSlots)return Wx(U);go()};b=function(k$){if(!k$||!k$.adPlacements&&!k$.adSlots){f()}}';
check('the player’s script: its check for a video without ads passes (whatever its variable)', Y.playerScript(script), 'var a=function(U){if(!U||0)return Wx(U);go()};b=function(k$){if(!k$||0){f()}}');
check('…not there: the same', Y.playerScript('if(!U||!U.ads)x()'), 'if(!U||!U.ads)x()');

check('which answer is which', [
  Y.kindOf('https://www.youtube.com/youtubei/v1/player?key=1&prettyPrint=false', 'Fetch'),
  Y.kindOf('https://m.youtube.com/youtubei/v1/get_watch?prettyPrint=false', 'XHR'),
  Y.kindOf('https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?prettyPrint=false', 'Fetch'),
  Y.kindOf('https://www.youtube.com/watch?v=abc', 'Document'),
  Y.kindOf('https://www.youtube.com/watch?v=abc&pbj=1', 'XHR'),
  Y.kindOf('https://www.youtube.com/playlist?list=PL1', 'Document'),
  Y.kindOf('https://www.youtube.com/s/player/a1b2c3d4/player_ias.vflset/en_US/base.js', 'Script'),
  Y.kindOf('https://www.youtube-nocookie.com/youtubei/v1/player', 'Fetch'),
], ['player', 'player', 'reels', 'page', 'player', 'page', 'script', 'player']);
check('…and what’s left alone: YouTube’s other answers, and other sites', [
  Y.kindOf('https://www.youtube.com/youtubei/v1/next', 'Fetch'), Y.kindOf('https://www.youtube.com/youtubei/v1/browse', 'Fetch'),
  Y.kindOf('https://www.youtube.com/s/player/a1/www-player.css', 'Stylesheet'), Y.kindOf('https://www.youtube.com/', 'Document'),
  Y.kindOf('https://notyoutube.com/youtubei/v1/player', 'Fetch'), Y.kindOf('https://youtube.com.example/watch?v=1', 'Document'), Y.kindOf('nonsense', 'Fetch'),
], ['', '', '', '', '', '', '']);

// ------------------------------------------------------------------------------------------------ the rules
const copy = () => JSON.parse(JSON.stringify(RULES));
const taken = (change) => { const r = copy(); change(r); try { E.compile(r); return true; } catch { return false; } };
check('the built-in rules: a version that says when they’re from, and everything YouTube’s pages need', [
  /^20\d{8}$/.test(String(RULES.version)), RULES.format === E.FORMAT, R.hold.length >= 6, R.page.skip.length > 3, R.page.hide.length > 10,
  R.page.skip.includes('.ytp-skip-ad-button'), R.page.hide.includes('ytd-ad-slot-renderer'),
], [true, true, true, true, true, true, true]);
check('an answer of a kind the rules don’t have: as it was', R.edit('nothing', '{"adSlots":[1]}'), '{"adSlots":[1]}');

// What YouTube changes, followed by newer rules alone: a key's new name, a new address, another wording of the
// player's check, another mark on an ad reel.
const newer = copy();
newer.version = RULES.version + 1;
newer.hold.push('/youtubei/v2/player*');
newer.answers.unshift({ kind: 'player', path: '^/youtubei/v2/player(/|$)' });
newer.edits.player[0].keys.push('adBreaks');
newer.edits.script.push({ do: 'replace', has: '.adBreaks&&', find: 'if\\(!([\\w$]+)\\.adBreaks&&([\\w$]+)\\)', with: 'if(0&&$2)' });
newer.edits.reels.push({ do: 'prune', list: 'entries', where: ['command', 'reelWatchEndpoint', 'sponsored'] });
newer.page.skip.push('.ytp-new-skip');
const N = E.compile(newer);
check('newer rules: a new key, a new address, another check in the player and another mark on an ad reel are followed', [
  JSON.parse(N.edit('player', '{"adBreaks":[1],"adSlots":[2],"x":1}')),
  N.kindOf('https://www.youtube.com/youtubei/v2/player?x=1', 'Fetch'), R.kindOf('https://www.youtube.com/youtubei/v2/player?x=1', 'Fetch'),
  N.edit('script', 'if(!a.adBreaks&&b){x()}'),
  JSON.parse(N.edit('reels', JSON.stringify({ entries: [{ command: { reelWatchEndpoint: { videoId: 'a' } } }, { command: { reelWatchEndpoint: { videoId: 'b', sponsored: true } } }] }))).entries.length,
  N.hold.includes('/youtubei/v2/player*'), N.page.skip.includes('.ytp-new-skip'), N.version > R.version,
], [{ no_ads: [2], x: 1 }, 'player', '', 'if(0&&b){x()}', 1, true, true, true]);
check('…a replacement’s $ signs mean what they do in one; a renamed key’s don’t', [
  E.compile(Object.assign(copy(), { edits: { player: [{ do: 'rename', keys: ['a'], to: '$b' }] }, answers: [{ kind: 'player', path: '^/x$' }] })).edit('player', '{"a":1}'),
], ['{"$b":1}']);

check('rules that aren’t taken: for another version of Bifrost, without a version, or not rules at all', [
  taken((r) => { r.format = 2; }), taken((r) => { delete r.version; }), taken((r) => { r.version = '2026111601'; }), taken((r) => { r.version = -1; }),
  (() => { try { E.compile(null); return true; } catch { return false; } })(), (() => { try { E.compile([]); return true; } catch { return false; } })(), (() => { try { E.compile('x'); return true; } catch { return false; } })(),
], [false, false, false, false, false, false, false]);
check('…with something to do that this version doesn’t know, or done wrongly', [
  taken((r) => { r.edits.player.push({ do: 'run', code: 'alert(1)' }); }),
  taken((r) => { r.edits.player.push({ do: 'constructor' }); }),
  taken((r) => { r.edits.player[0].keys = ['a"b']; }),
  taken((r) => { r.edits.player[0].to = 'x y'; }),
  taken((r) => { r.edits.script[0].find = '('; }),
  taken((r) => { r.edits.script[0].find = 'a'.repeat(401); }),
  taken((r) => { delete r.edits.script[0].has; }),
  taken((r) => { r.edits.page[0].edits.push({ do: 'inside', after: 'x', edits: [{ do: 'rename', keys: ['a'], to: 'b' }] }); }),
  taken((r) => { r.edits.page[0].after = 'a(b'; }),
  taken((r) => { r.edits.reels[0].where = []; }),
  taken((r) => { r.edits.player = []; }),
  taken((r) => { r.edits.player = new Array(13).fill({ do: 'rename', keys: ['a'], to: 'b' }); }),
], new Array(12).fill(false));
check('…with answers of a kind they have no edits for, a broken address, or answers to hold from somewhere else', [
  taken((r) => { r.answers.push({ kind: 'other', path: '^/x$' }); }),
  taken((r) => { r.answers[0].path = '['; }),
  taken((r) => { r.answers[0].from = 'anyone'; }),
  taken((r) => { r.hold.push('https://example.com/*'); }),
  taken((r) => { r.hold.push('*'); }),
  taken((r) => { r.hold = []; }),
], new Array(6).fill(false));
check('…with something to hide or press that’s more than a selector', [
  taken((r) => { r.page.hide.push('a { } body { display: none'); }),
  taken((r) => { r.page.hide.push('a, b; color: red'); }),
  taken((r) => { r.page.skip.push('x /* y'); }),
  taken((r) => { r.page.skip.push('@import "x"'); }),
  taken((r) => { r.page.hide.push('a\nb'); }),
  taken((r) => { r.page.hide = 'ytd-ad-slot-renderer'; }),
  taken((r) => { r.page.skip.push(''); }),
], new Array(7).fill(false));
check('…and they can’t reach past YouTube, whatever they say', [
  N.kindOf('https://example.com/youtubei/v2/player', 'Fetch'),
  E.compile(Object.assign(copy(), { answers: [{ kind: 'player', path: '.*' }] })).kindOf('https://accounts.google.com/signin', 'Document'),
  E.compile(Object.assign(copy(), { answers: [{ kind: 'player', path: '.*' }] })).kindOf('https://www.youtube.com/anything', 'Fetch'),
], ['', '', 'player']);
check('edits are done one after another, and one that finds nothing changes nothing', (() => {
  const r = copy();
  r.edits.reels = [{ do: 'prune', list: 'entries', where: ['x'] }, { do: 'prune', has: 'adClientParams', list: 'entries', where: ['command', 'reelWatchEndpoint', 'adClientParams', 'isAd'] }];
  return ids(JSON.parse(E.compile(r).edit('reels', JSON.stringify(seq))));
})(), ['r1', 'r2']);

console.log(`\nyoutube-edit: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
