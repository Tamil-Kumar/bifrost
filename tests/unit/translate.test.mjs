// Page translation's addresses and languages (src/pages/common/translate.js).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Tr = await import(pathToFileURL(path.join(ROOT, 'src/pages/common/translate.js')).href);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

check('language tags become Google Translate codes', () => {
  for (const [tag, code] of [['en-US', 'en'], ['EN', 'en'], ['fr_CA', 'fr'], ['zh', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['zh-Hant', 'zh-TW'], ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'],
    ['iw', 'he'], ['he-IL', 'he'], ['in', 'id'], ['nb-NO', 'no'], ['fil-PH', 'tl'], ['ta-IN', 'ta'], ['', ''], ['x-klingon', ''], ['und', '']]) eq(Tr.translateCode(tag), code, tag);
});

check('the same language in another region isn’t offered; Chinese scripts are different languages', () => {
  eq(Tr.sameLanguage('en-GB', 'en'), true, 'en-GB/en');
  eq(Tr.sameLanguage('fr', 'en'), false, 'fr/en');
  eq(Tr.sameLanguage('zh-TW', 'zh-CN'), false, 'zh-TW/zh-CN');
  eq(Tr.sameLanguage('zh-Hans', 'zh-CN'), true, 'zh-Hans/zh-CN');
  eq(Tr.sameLanguage('', 'en'), false, 'unknown/en');
});

check('only public websites can be translated', () => {
  for (const [url, ok] of [
    ['https://www.lemonde.fr/article', true], ['http://news.example.com/a?b=1#c', true], ['https://sub.domain.co.uk/', true],
    ['http://localhost:8080/', false], ['http://127.0.0.1/x', false], ['http://192.168.1.10/', false], ['http://intranet/', false],
    ['https://printer.local/', false], ['https://site.test/', false], ['https://example.com:8443/', false], ['file:///C:/a.html', false],
    ['bifrost://settings/', false], ['https://[::1]/', false], ['https://user:pw@example.com/', false],
    ['https://www-lemonde-fr.translate.goog/?_x_tr_tl=en', false]]) eq(Tr.canTranslate(url), ok, url);
});

check('a page goes to Google Translate with the target language and its address', () => {
  eq(Tr.translateUrl('https://www.lemonde.fr/a?b=1&c=2#d', 'en-US'),
    'https://translate.google.com/translate?sl=auto&tl=en&hl=en&u=https%3A%2F%2Fwww.lemonde.fr%2Fa%3Fb%3D1%26c%3D2%23d', 'url');
  eq(Tr.translateUrl('https://example.com/', 'zh-Hant'), 'https://translate.google.com/translate?sl=auto&tl=zh-TW&hl=zh-TW&u=https%3A%2F%2Fexample.com%2F', 'zh-Hant');
});

check('a translated page leads back to its original (dashes, the scheme, its own query and fragment)', () => {
  eq(Tr.isTranslated('https://www-lemonde-fr.translate.goog/a'), true, 'isTranslated');
  eq(Tr.isTranslated('https://www.lemonde.fr/'), false, 'not translated');
  eq(Tr.originalUrl('https://www-lemonde-fr.translate.goog/a/b?x=1&_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp#top'), 'https://www.lemonde.fr/a/b?x=1#top', 'plain');
  eq(Tr.originalUrl('https://my--site-co-uk.translate.goog/?_x_tr_sl=auto&_x_tr_tl=en'), 'https://my-site.co.uk/', 'dash in the host');
  eq(Tr.originalUrl('https://news-example-com.translate.goog/p?q=a%20b&_x_tr_sch=http&_x_tr_sl=auto&_x_tr_tl=ta'), 'http://news.example.com/p?q=a%20b', 'http, query kept as it was');
  eq(Tr.translatedInto('https://news-example-com.translate.goog/p?_x_tr_sl=auto&_x_tr_tl=ta'), 'ta', 'translatedInto');
  eq(Tr.originalUrl('https://www.lemonde.fr/'), '', 'not a translated page');
});

check('language names', () => {
  eq(Tr.languageName('ta'), 'Tamil', 'ta');
  eq(Tr.languageName('fr'), 'French', 'fr');
  if (!/Chinese/.test(Tr.languageName('zh-TW'))) throw new Error('zh-TW: ' + Tr.languageName('zh-TW'));
});

console.log(`\ntranslate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
