// Translating pages, with Google Translate's website translator: the page comes back translated at
// <its host, dots as dashes>.translate.goog, links included. The translator fetches the page itself, so
// a page you're signed in to comes out as it looks signed out, and only public sites can be translated.
// No DOM here: the window UI and the unit tests both use it.

// The languages pages can be translated into, by their Google Translate codes.
export const LANGUAGES = ['af', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca', 'ceb', 'zh-CN', 'zh-TW', 'co', 'hr',
  'cs', 'da', 'nl', 'en', 'eo', 'et', 'tl', 'fi', 'fr', 'fy', 'gl', 'ka', 'de', 'el', 'gu', 'ht', 'ha', 'haw', 'he', 'hi', 'hmn', 'hu',
  'is', 'ig', 'id', 'ga', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'ku', 'ky', 'lo', 'lv', 'lt', 'lb', 'mk', 'mg', 'ms', 'ml',
  'mt', 'mi', 'mr', 'mn', 'my', 'ne', 'no', 'ny', 'or', 'ps', 'fa', 'pl', 'pt', 'pa', 'ro', 'ru', 'sm', 'gd', 'sr', 'st', 'sn', 'sd',
  'si', 'sk', 'sl', 'so', 'es', 'su', 'sw', 'sv', 'tg', 'ta', 'tt', 'te', 'th', 'tr', 'tk', 'uk', 'ur', 'ug', 'uz', 'vi', 'cy', 'xh',
  'yi', 'yo', 'zu'];

const ALIASES = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', nb: 'no', nn: 'no', fil: 'tl' };   // (tl: Filipino)
const TRADITIONAL = /^zh[-_](hant|tw|hk|mo)\b/i;

// A language tag ('en-US', 'zh-Hant-TW', 'iw') as a Google Translate code ('en', 'zh-TW', 'he'), or ''.
export function translateCode(tag) {
  const t = String(tag || '').trim();
  if (!t) return '';
  if (/^zh\b/i.test(t)) return TRADITIONAL.test(t) ? 'zh-TW' : 'zh-CN';
  const p = t.split(/[-_]/)[0].toLowerCase();
  const code = ALIASES[p] || p;
  return LANGUAGES.includes(code) ? code : '';
}

// Whether a page in `pageLang` reads as `target` already (same language; Chinese also by script).
export function sameLanguage(pageLang, target) {
  const a = translateCode(pageLang), b = translateCode(target);
  return !!a && a === b;
}

// The language's name, in English ('ta' → 'Tamil').
export function languageName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; }
}

const TRANSLATED_HOST = /\.translate\.goog$/i;
export function isTranslated(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && TRANSLATED_HOST.test(u.hostname); } catch { return false; }
}

// Public web pages only: the translator can't reach this computer, your network or addresses with a port.
export function canTranslate(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.port || isTranslated(url) || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[')) return false;                     // "intranet", IPv6
  if (/\.(local|localhost|internal|lan|home|corp|test|example|invalid|onion)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;                                 // an address, not a site
  return true;
}

// Where to send the page to have it translated into `target`.
export function translateUrl(url, target) {
  const tl = translateCode(target) || 'en';
  return `https://translate.google.com/translate?sl=auto&tl=${tl}&hl=${tl}&u=${encodeURIComponent(url)}`;
}

// The page a translated one came from: www-example-com.translate.goog/a?_x_tr_tl=en → www.example.com/a
// (a dash in the real host is doubled there, a dot becomes a dash).
export function originalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!TRANSLATED_HOST.test(u.hostname)) return '';
  const coded = u.hostname.replace(TRANSLATED_HOST, '');
  const host = coded.replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-');
  const params = u.search.replace(/^\?/, '').split('&').filter(Boolean);
  const scheme = (params.map((p) => p.split('=')).find(([k]) => k === '_x_tr_sch') || [])[1] === 'http' ? 'http' : 'https';
  const kept = params.filter((p) => !/^_x_tr_/.test(p));
  return `${scheme}://${host}${u.pathname}${kept.length ? '?' + kept.join('&') : ''}${u.hash}`;
}

// The target language of a translated page ('' when it isn't one).
export function translatedInto(url) {
  try { const u = new URL(url); return TRANSLATED_HOST.test(u.hostname) ? translateCode(u.searchParams.get('_x_tr_tl') || '') : ''; } catch { return ''; }
}
