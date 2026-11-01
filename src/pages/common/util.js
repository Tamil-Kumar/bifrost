// Bifrost browser UI — small DOM and formatting helpers shared by every module.

// h('div#id.row.sel', { onclick, title, dataset: {id} }, child, 'text', [more])
export function h(tag, props, ...kids) {
  const parts = tag.split('.');
  const [name, id] = parts[0].split('#');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = el.className ? el.className + ' ' + v : v;
      else if (k === 'style' && typeof v === 'object') {
        // Custom properties need setProperty; plain assignment would silently do nothing.
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'tabIndex') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let seq = 0;
export function uid(prefix = '') {
  seq = (seq + 1) % 1e6;
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + seq.toString(36);
}

// Runs fn once calls have stopped for ms. With maxWait, calls that never stop (a page retitling itself
// every few milliseconds) still let it run at least that often.
export function debounce(fn, ms, maxWait = Infinity) {
  let t = null, since = 0;
  const run = (a) => { clearTimeout(t); t = null; since = 0; fn(...a); };
  const d = (...a) => {
    const now = Date.now();
    if (!since) since = now;
    clearTimeout(t);
    t = setTimeout(() => run(a), Math.max(0, Math.min(ms, since + maxWait - now)));
  };
  d.flush = (...a) => run(a);
  d.cancel = () => { clearTimeout(t); t = null; since = 0; };
  return d;
}

export function throttle(fn, ms) {
  let last = 0, t = null, args = null;
  return (...a) => {
    args = a;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...args); }, ms - (now - last));
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ urls
export const NEWTAB_URL = 'bifrost://newtab/';
export function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
export function isInternal(url) { return typeof url === 'string' && url.startsWith('bifrost://'); }
export function internalHost(url) { return isInternal(url) ? hostOf(url) : ''; }
export function isNewTab(url) { return !url || url === 'about:blank' || /^bifrost:\/\/(newtab|blank)\/?/.test(url); }

const PAGE_NAMES = {
  newtab: 'New tab', settings: 'Settings', history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads',
  extensions: 'Extensions', about: 'About Bifrost', reader: 'Reader view', tasks: 'Task manager', welcome: 'Welcome', blank: 'New tab',
};
const PAGE_ICONS = {
  newtab: 'compass', settings: 'sliders', history: 'clock', bookmarks: 'star', downloads: 'download', extensions: 'puzzle',
  about: 'info', reader: 'reader', tasks: 'cpu', welcome: 'sparkle', blank: 'compass',
};
export function pageName(url) { return PAGE_NAMES[internalHost(url)] || ''; }
export function pageIcon(url) { return PAGE_ICONS[internalHost(url)] || 'compass'; }

// Address shown in the toolbar: no scheme for https, no trailing slash.
export function displayUrl(url) {
  if (!url) return '';
  if (isNewTab(url)) return '';
  let s = url;
  if (/^https:\/\//i.test(s)) s = s.slice(8);
  s = s.replace(/^www\./, '');
  if (/^[^/]+\/$/.test(s)) s = s.slice(0, -1);
  try { s = decodeURI(s); } catch { /* keep */ }
  return s;
}

// Maps chrome:// and about: pages people type out of habit to ours.
export function fixupUrl(url) {
  const m = /^(?:chrome|vivaldi|edge|brave|about):\/?\/?([a-z-]+)\/?(.*)$/i.exec(url || '');
  if (!m) return url;
  const map = { settings: 'settings', history: 'history', bookmarks: 'bookmarks', downloads: 'downloads', extensions: 'extensions', newtab: 'newtab', 'new-tab-page': 'newtab', about: 'about', version: 'about', help: 'about', preferences: 'settings', addons: 'extensions' };
  const host = map[m[1].toLowerCase()];
  if (host) return `bifrost://${host}/${m[2] || ''}`;
  if (/^about:blank$/i.test(url)) return 'about:blank';
  return url;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return Math.ceil(sec) + ' s';
  if (sec < 3600) return Math.round(sec / 60) + ' min';
  return (sec / 3600).toFixed(1) + ' h';
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' h ago';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' d ago';
  return new Date(ts).toLocaleDateString();
}

// --------------------------------------------------------------- favicons
const LETTER_COLORS = ['accent', 'blue', 'green', 'peach', 'pink', 'teal', 'yellow', 'red', 'lavender'];
export function hashColor(s) {
  let x = 0;
  for (let i = 0; i < (s || '').length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return LETTER_COLORS[Math.abs(x) % LETTER_COLORS.length];
}

const failedIcons = new Set();
// A favicon element: the site's icon, else a colored letter (or an internal page icon).
// opts.hi: prefer the sharpest icon Bifrost has found for the site (see main/icons.js), falling back
// to src; opts.lookup also lets it go and find one if none is stored yet.
export function faviconEl(url, src, iconFn, cls = 'fav', opts = null) {
  const box = h('span.' + cls + '.fbox');
  const internal = isInternal(url);
  if (internal && iconFn) { box.classList.add('internal'); box.append(iconFn(pageIcon(url))); return box; }
  if (opts && opts.hi && /^https?:/i.test(url || '')) {
    const hiSrc = '/_/favicon?' + (opts.lookup ? '' : 'cached=1&') + 'url=' + encodeURIComponent(url);
    if (!failedIcons.has(hiSrc)) {
      const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
      img.addEventListener('error', () => { if (!opts.lookup) { failedIcons.add(hiSrc); setTimeout(() => failedIcons.delete(hiSrc), 30000); } img.replaceWith(faviconEl(url, src, iconFn, cls).firstChild || letterEl(url)); }, { once: true });
      img.src = hiSrc;
      box.append(img);
      return box;
    }
  }
  if (src && !failedIcons.has(src) && /^(https?|data|bifrost|crx|chrome-extension):/i.test(src)) {
    const img = h('img', { alt: '', decoding: 'async', draggable: 'false', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { failedIcons.add(src); img.replaceWith(letterEl(url)); }, { once: true });
    img.src = src;
    box.append(img);
  } else if (/^chrome-extension:/i.test(url || '') && iconFn) {
    box.append(iconFn('puzzle'));
  } else {
    box.append(letterEl(url));
  }
  return box;
}

const GLOBE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" class="i"><path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/></svg>';
function letterEl(url) {
  const host = hostOf(url).replace(/^www\./, '');
  // No name to take a letter from (an IP address, localhost, a file): a globe, as other browsers show.
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) {
    const g = h('span.letter.globe');
    g.innerHTML = GLOBE_SVG;
    return g;
  }
  const ch = (host || '?').charAt(0).toUpperCase();
  return h('span.letter', { style: { '--lc': `var(--${hashColor(host)})` } }, ch);
}

// ------------------------------------------------------------- animations
// Each area can be turned off on its own; 'speed' scales every duration, and the style (subtle, smooth,
// playful, snappy: WBDefaults.ANIM_STYLES) stretches durations and scales how far things move.
let A = { enabled: true, speed: 1, reduced: false, off: false, time: 1, amp: 1, spring: false };
export function setAnimConfig(cfg, reduced, extra = {}) {
  const st = (window.WBDefaults && window.WBDefaults.ANIM_STYLES && window.WBDefaults.ANIM_STYLES[cfg && cfg.style]) || { time: 1, amp: 1, spring: false };
  A = Object.assign({}, cfg, { reduced, off: !!extra.off, time: st.time, amp: st.amp, spring: st.spring });
}
export function anim(area) { return A.enabled && !A.reduced && !A.off && (area ? A[area] !== false : true); }
export function dur(ms) { return Math.round((ms * (A.time || 1)) / Math.max(0.1, A.speed || 1)); }
export function animAmp() { return A.amp || 1; }

// Scales the movement in a keyframe by the style's amplitude: translate distances, scale and rotate offsets
// from 1 / 0, and how far opacity dips from 1 (an opacity of 0 stays 0).
function amplify(frames) {
  const k = A.amp || 1;
  if (k === 1) return frames;
  const tf = (t) => String(t)
    .replace(/(translate[XY]?\()([^)]*)\)/g, (m, fn, args) => fn + args.replace(/(-?\d*\.?\d+)px/g, (x, n) => (Number(n) * k).toFixed(2) + 'px') + ')')
    .replace(/scale\((\d*\.?\d+)\)/g, (m, n) => 'scale(' + Math.max(0.2, 1 - (1 - Number(n)) * k).toFixed(4) + ')')
    .replace(/rotate\((-?\d*\.?\d+)deg\)/g, (m, n) => 'rotate(' + (Number(n) * k).toFixed(2) + 'deg)');
  return frames.map((f) => {
    const o = Object.assign({}, f);
    if (o.transform && o.transform !== 'none') o.transform = tf(o.transform);
    if (typeof o.opacity === 'number' && o.opacity > 0 && o.opacity < 1) o.opacity = Math.max(0, 1 - (1 - o.opacity) * Math.min(k, 1.6));
    return o;
  });
}

// Web Animations wrapper: resolves when done, or immediately when the area's animations are off.
// Entrances (ending at no transform) get a little overshoot in the playful style.
export function animate(el, frames, opts, area) {
  if (!el || !anim(area)) return Promise.resolve();
  const o = Object.assign({ duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }, opts || {});
  o.duration = dur(o.duration);
  const last = frames[frames.length - 1] || {};
  if (A.spring && last.transform === 'none' && !/ease-in\b/.test(o.easing)) o.easing = 'cubic-bezier(.34, 1.45, .64, 1)';
  try {
    const a = el.animate(amplify(frames), o);
    return a.finished.catch(() => {});
  } catch { return Promise.resolve(); }
}

// Ripples from where you click a button (Animations → Ripples on click, off by default).
let rippleOn = false;
export function setupRipples() {
  if (rippleOn) return;
  rippleOn = true;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !anim('ripple')) return;
    const host = e.target.closest && e.target.closest('button, .btn, .tb-btn, .menu-item, .tab, .tile, .bm-item');
    if (!host || host.disabled) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    Object.assign(dot.style, { width: size + 'px', height: size + 'px', left: (e.clientX - r.left - size / 2) + 'px', top: (e.clientY - r.top - size / 2) + 'px' });
    if (getComputedStyle(host).position === 'static') host.classList.add('ripple-host');
    host.classList.add('ripple-clip');
    host.append(dot);
    dot.addEventListener('animationend', () => { dot.remove(); if (!host.querySelector('.ripple')) host.classList.remove('ripple-host', 'ripple-clip'); }, { once: true });
  }, true);
}

// FLIP: measures elements, runs a DOM change, then animates them from where they were.
export function flip(els, mutate, area, opts = {}) {
  const on = anim(area);
  const before = on ? new Map(els().map((e) => [e, e.getBoundingClientRect()])) : null;
  mutate();
  if (!on) return;
  for (const e of els()) {
    const b = before.get(e);
    if (!b) continue;
    const a = e.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: dur(opts.duration || 200), easing: A.spring ? 'cubic-bezier(.34, 1.3, .64, 1)' : 'cubic-bezier(.2,.8,.2,1)' });
  }
}

// ------------------------------------------------------------------ input
export function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type || 'text');
  return false;
}

// Text editing chords that shortcuts must never steal from a text field.
const EDIT_CODES = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Insert']);
export function isEditingChord(e) {
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return false;
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return true; // typing
  return (e.ctrlKey || e.metaKey) && !e.altKey && EDIT_CODES.has(e.code);
}

export function stop(e) { e.preventDefault(); e.stopPropagation(); }

export async function copyText(text) {
  try { await navigator.clipboard.writeText(String(text)); return true; } catch { /* not focused */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0', pointerEvents: 'none' } });
  ta.value = String(text);
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Highlights query tokens in text (no HTML: page titles are untrusted).
export function highlight(text, tokens) {
  const frag = document.createDocumentFragment();
  text = text || '';
  if (!tokens || !tokens.length || !text) { frag.append(text); return frag; }
  const low = text.toLowerCase();
  const ranges = [];
  for (const t of tokens) {
    if (!t) continue;
    for (let i = low.indexOf(t); i !== -1; i = low.indexOf(t, i + t.length)) ranges.push([i, i + t.length]);
  }
  if (!ranges.length) { frag.append(text); return frag; }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0].slice()];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
  }
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) frag.append(text.slice(pos, a));
    frag.append(h('mark', null, text.slice(a, b)));
    pos = b;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}

// Keeps a container's children in the given order, moving only what's out of place.
// Elements animating out (data-leaving) stay where they are until they remove themselves.
export function syncChildren(container, els) {
  const leaving = (n) => n && n.dataset && n.dataset.leaving;
  let ref = container.firstChild;
  for (const el of els) {
    while (ref && ref !== el && leaving(ref)) ref = ref.nextSibling;
    if (el === ref) { ref = ref.nextSibling; continue; }
    container.insertBefore(el, ref);
  }
  while (ref) { const next = ref.nextSibling; if (!leaving(ref)) ref.remove(); ref = next; }
}
