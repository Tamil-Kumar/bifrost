// Bifrost — Reader view: the article from a page, cleaned up by Mozilla's Readability and shown
// in comfortable type. The page's HTML is sanitized with an allowlist before it's shown here.
import { boot, wb, h, icon, hostOf } from '/_/common/page.js';

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const pageUrl = params.get('url') || '';
const PREFS_KEY = 'reader.prefs';
const prefs = Object.assign({ size: 19, font: 'serif', width: 'normal', theme: 'auto' }, load());
function load() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage off */ } }

// ------------------------------------------------------------- sanitizer
const TAGS = new Set(['P', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'PICTURE', 'SOURCE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE',
  'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SUP', 'SUB', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'SPAN', 'DIV', 'SECTION', 'ARTICLE',
  'HEADER', 'FOOTER', 'DL', 'DT', 'DD', 'MARK', 'SMALL', 'TIME', 'ABBR', 'CITE', 'Q', 'DEL', 'INS', 'KBD', 'VAR', 'SAMP', 'DETAILS', 'SUMMARY', 'VIDEO', 'AUDIO']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE', 'FRAME', 'FRAMESET', 'CANVAS']);
const ATTRS = new Set(['href', 'src', 'srcset', 'alt', 'title', 'colspan', 'rowspan', 'datetime', 'width', 'height', 'controls', 'poster', 'type', 'media', 'sizes']);
const safeUrl = (u, img) => /^(https?:|mailto:)/i.test(u) || (img && /^data:image\/(png|jpe?g|gif|webp|avif)/i.test(u));

function sanitize(html, base) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (DROP.has(tag)) { child.remove(); continue; }
      if (!TAGS.has(tag)) { clean(child); child.replaceWith(...child.childNodes); continue; }
      for (const a of [...child.attributes]) {
        const name = a.name.toLowerCase();
        if (!ATTRS.has(name)) { child.removeAttribute(a.name); continue; }
        if (name === 'href' || name === 'src' || name === 'poster') {
          let abs = '';
          try { abs = new URL(a.value, base).href; } catch { abs = ''; }
          if (!safeUrl(abs, name !== 'href')) child.removeAttribute(a.name); else child.setAttribute(a.name, abs);
        }
        if (name === 'srcset') {
          const parts = a.value.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
            const [u, d] = p.split(/\s+/);
            try { const abs = new URL(u, base).href; return /^https?:/i.test(abs) ? abs + (d ? ' ' + d : '') : null; } catch { return null; }
          }).filter(Boolean);
          if (parts.length) child.setAttribute('srcset', parts.join(', ')); else child.removeAttribute('srcset');
        }
      }
      if (tag === 'IMG') { child.setAttribute('loading', 'lazy'); child.setAttribute('referrerpolicy', 'no-referrer'); child.setAttribute('decoding', 'async'); }
      if (tag === 'VIDEO' || tag === 'AUDIO') child.setAttribute('controls', '');
      clean(child);
    }
  };
  clean(doc.body);
  return [...doc.body.childNodes];
}

// ------------------------------------------------------------------ view
function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--r-size', prefs.size + 'px');
  root.dataset.font = prefs.font;
  root.dataset.width = prefs.width;
  root.dataset.rtheme = prefs.theme;
}

function toolbar(original) {
  const b = (ic, title, fn, label) => h('button.r-btn', { type: 'button', title, onclick: fn }, ic ? icon(ic) : null, label || null);
  const bar = h('div.r-bar', null,
    b('back', 'Leave reader view', () => { if (history.length > 1) history.back(); else location.href = original; }, 'Original'),
    h('div.r-sp'),
    b(null, 'Smaller text', () => { prefs.size = Math.max(14, prefs.size - 1); save(); applyPrefs(); }, 'A−'),
    b(null, 'Larger text', () => { prefs.size = Math.min(30, prefs.size + 1); save(); applyPrefs(); }, 'A+'),
    b(null, 'Serif or sans-serif', () => { prefs.font = prefs.font === 'serif' ? 'sans' : 'serif'; save(); applyPrefs(); }, 'Aa'),
    b('split', 'Line width', () => { prefs.width = prefs.width === 'normal' ? 'wide' : prefs.width === 'wide' ? 'narrow' : 'normal'; save(); applyPrefs(); }),
    ...['auto', 'light', 'sepia', 'dark'].map((t) => h('button.r-swatch.' + t, { type: 'button', title: t === 'auto' ? 'Match the browser theme' : t[0].toUpperCase() + t.slice(1), onclick: () => { prefs.theme = t; save(); applyPrefs(); } })));
  return bar;
}

function absolutize(doc, base) {
  const fix = (v) => { try { return new URL(v, base).href; } catch { return v; } };
  for (const el of doc.querySelectorAll('[href]')) {
    const v = el.getAttribute('href');
    if (v && !v.startsWith('#')) el.setAttribute('href', fix(v));
  }
  for (const attr of ['src', 'poster']) for (const el of doc.querySelectorAll(`[${attr}]`)) el.setAttribute(attr, fix(el.getAttribute(attr)));
  for (const el of doc.querySelectorAll('[srcset]')) {
    el.setAttribute('srcset', el.getAttribute('srcset').split(',').map((part) => {
      const [u, d] = part.trim().split(/\s+/, 2);
      return u ? fix(u) + (d ? ' ' + d : '') : '';
    }).filter(Boolean).join(', '));
  }
}

function fail(msg, original) {
  document.body.append(h('div.pg', null, h('div.empty-state', null, icon('reader'), h('h2', null, 'Reader view isn’t available'), h('p', null, msg),
    original ? h('a.btn.primary', { href: original }, 'Open the original page') : null)));
}

await boot({ title: 'Reader view' });
applyPrefs();
let data = null;
try { data = await wb.invoke('reader:get', token, pageUrl); } catch (e) { fail(e.message.replace(/^.*Error: /, ''), pageUrl); }
if (data) {
  const doc = new DOMParser().parseFromString(data.html, 'text/html');
  // The page's relative links and images are resolved against its own address before Readability runs
  // (internal pages can't use a <base> element).
  absolutize(doc, data.url);
  let article = null;
  try { article = new window.Readability(doc, { charThreshold: 250, keepClasses: false }).parse(); } catch (e) { console.error(e); }
  if (!article || !article.content || (article.length || 0) < 200) {
    fail('This page doesn’t look like an article.', data.url);
  } else {
    document.title = article.title || data.title || 'Reader view';
    const words = (article.textContent || '').trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.round(words / 230));
    const content = h('div.r-content');
    content.append(...sanitize(article.content, data.url));
    document.body.append(toolbar(data.url), h('article.r', null,
      h('div.r-site', null, article.siteName || hostOf(data.url).replace(/^www\./, '')),
      h('h1.r-title', null, article.title || data.title || ''),
      h('div.r-meta', null, [article.byline, `${minutes} min read`].filter(Boolean).join(' · ')),
      content,
      h('div.r-end', null, h('a', { href: data.url }, 'Read the original on ' + hostOf(data.url).replace(/^www\./, '')))));
  }
}
