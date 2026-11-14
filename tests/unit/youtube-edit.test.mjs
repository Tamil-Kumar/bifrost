// YouTube's answers without their ads (src/main/youtube-edit.js): the player's data, a watch page's own, Shorts'
// reels, the player's script; what each answer is; and what's left alone.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Y = require(ROOT + '/src/main/youtube-edit.js');

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

console.log(`\nyoutube-edit: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
