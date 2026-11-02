// Bifrost browser UI — the address bar: shows the page address, and searches like the launcher as
// you type (results drop down under it).
import { S, on, emit, activeTab, setting } from './state.js';
import { h, displayUrl, isInternal, isNewTab, pageName, hostOf, animate, anim } from './util.js';
import { icon } from './icons.js';
import { ResultList, makeSearcher, openResult, howFromEvent } from './results.js';
import { place } from './menus.js';

let root, input, display, siteBtn, dropEl = null, results, searcher;
let editing = false;   // the user has typed since focusing
let lastKeyAt = -1e9, lastUiPointer = -1e9, lastFocusAt = -1e9;   // (see the blur handler)
let selfBlur = false, reclaims = 0, lastPagePointer = -1e9;
let lastUrlShown = '';

export function build() {
  lastUrlShown = '';   // a new, empty address bar (the toolbar was rebuilt): it has to be filled in again
  siteBtn = h('button#site-btn.addr-site', { type: 'button', title: 'View site information' });
  display = h('div.addr-display');
  input = h('input#address-input.addr-input', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address and search bar', placeholder: 'Search or enter an address' });
  const actions = h('div.addr-actions');
  root = h('div#address.address.no-drag', null, siteBtn, h('div.addr-field', null, display, input), actions);
  results = new ResultList({ onPick: (it, how) => pick(it, how), className: 'o-results' });
  searcher = makeSearcher((r, final, raw) => {
    if (!editing || raw !== input.value) return;
    results.set(r.items, r.query);
    if (r.items.length) showDrop(); else hideDrop();
  });

  input.addEventListener('focus', () => {
    root.classList.add('focused');
    if (!editing) {
      const t = activeTab();
      const v = t && !isNewTab(t.url) ? (t.pendingUrl || t.url) : '';
      input.value = v;
      input.select();
      // (Again once focus has settled, unless you've already started typing: the first key you press
      // right after Ctrl+L must not end up selected and typed over.)
      requestAnimationFrame(() => { if (document.activeElement === input && !editing && input.value === v) input.select(); });
    }
  });
  input.addEventListener('blur', (e) => {
    // A page that takes focus by itself (an autofocus field as it loads, focus coming back to it after a
    // dialog) doesn't take the address bar away while you're typing in it. You clicking somewhere in the
    // window, or switching windows, still does.
    const to = e.relatedTarget;
    const now = performance.now();
    const mine = selfBlur;
    selfBlur = false;
    if (!mine && reclaims < 3 && ((editing && now - lastKeyAt < 700) || now - lastFocusAt < 700) && now - lastUiPointer > 400 && (!to || to.tagName === 'WEBVIEW')) {
      reclaims++;
      const v = input.value, s = input.selectionStart, en = input.selectionEnd;
      // (A moment later, by when a click of yours in the page has been heard of.)
      setTimeout(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.tagName !== 'WEBVIEW') return;
        if (performance.now() - lastPagePointer < 600) return;
        input.focus({ preventScroll: true });
        if (input.value !== v) input.value = v;
        try { input.setSelectionRange(s, en); } catch { /* fine */ }
      }, 40);
    }
    root.classList.remove('focused');
    setTimeout(() => {
      if (document.activeElement === input) return;
      editing = false;
      hideDrop();
      searcher.cancel();
      refresh();
    }, 0);
  });
  // The first click selects everything (like Chrome); later clicks place the caret.
  let downFocused = false;
  input.addEventListener('mousedown', () => { downFocused = document.activeElement === input; });
  input.addEventListener('mouseup', () => { if (!downFocused && input.selectionStart === input.selectionEnd) input.select(); });
  input.addEventListener('input', () => {
    editing = true;
    results.reset();
    if (!input.value.trim()) { hideDrop(); searcher.cancel(); return; }
    searcher.run(input.value);
  });
  input.addEventListener('keydown', (e) => { lastKeyAt = performance.now(); onKey(e); });
  document.addEventListener('pointerdown', () => { lastUiPointer = performance.now(); }, true);
  display.addEventListener('mousedown', (e) => { e.preventDefault(); focus(true); });
  siteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  siteBtn.addEventListener('click', () => emit('site-info', siteBtn));
  return { root, actions };
}

function onKey(e) {
  const open = !!dropEl;
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      if (open) { hideDrop(); editing = false; const t = activeTab(); input.value = t && !isNewTab(t.url) ? t.url : ''; input.select(); }
      else { editing = false; selfBlur = true; input.blur(); emit('focus-tab', activeTab()); }
      return;
    case 'ArrowDown': if (open) { e.preventDefault(); results.move(1); } else if (input.value.trim()) { editing = true; searcher.run(input.value); } return;
    case 'ArrowUp': if (open) { e.preventDefault(); results.move(-1); } return;
    case 'PageDown': if (open) { e.preventDefault(); results.page(1); } return;
    case 'PageUp': if (open) { e.preventDefault(); results.page(-1); } return;
    case 'Tab': if (open) { e.preventDefault(); results.move(e.shiftKey ? -1 : 1); } return;
    case 'Delete': {
      const it = open && results.current();
      if (e.shiftKey && it && it.type === 'history') { e.preventDefault(); window.wb.invoke('history:delete-url', it.url).then(() => searcher.run(input.value)); }
      return;
    }
    case 'Enter': {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const how = howFromEvent(e) || (setting('search.openInNewTab') && !isNewTab((activeTab() || {}).url) ? 'newtab' : 'current');
      // Enter before results arrive still does the right thing.
      if (open && results.current() && editing) { pick(results.current(), how); return; }
      const E = window.WBEngine;
      if (!editing && activeTab() && text === activeTab().url) { pick({ type: 'url', url: text }, how); return; }
      const q = E.parseQuery(text, S.settings.launcher, S.settings.search.engines);
      if (q.isUrl) pick({ type: 'url', url: E.toUrl(q.text) }, how);
      else {
        const engines = S.settings.search.engines;
        const eng = q.engine || engines.find((x) => x.id === S.settings.search.defaultEngine) || engines[0];
        pick({ type: 'search', url: E.fillTemplate(eng.url, q.text || text) }, how);
      }
      return;
    }
    default:
  }
}

function pick(it, how) {
  editing = false;
  hideDrop();
  searcher.cancel();
  selfBlur = true;
  input.blur();
  openResult(it, how || 'current');
  refresh();
}

function showDrop() {
  if (dropEl) { place(dropEl, { anchor: root, side: 'bottom', align: 'start' }, { gap: 4 }); return; }
  dropEl = h('div.omni-drop', null, results.el);
  dropEl.style.width = Math.max(360, root.getBoundingClientRect().width) + 'px';
  document.getElementById('overlay-root').append(dropEl);
  place(dropEl, { anchor: root, side: 'bottom', align: 'start' }, { gap: 4 });
  root.classList.add('dropped');
  animate(dropEl, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 120 }, 'menus');
}

function hideDrop() {
  if (!dropEl) return;
  const el = dropEl;
  dropEl = null;
  root.classList.remove('dropped');
  if (anim('menus')) animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 80 }, 'menus').then(() => el.remove());
  else el.remove();
}

export function focus(selectAll = true) {
  if (!root || !root.offsetParent) return false;
  lastFocusAt = performance.now();
  reclaims = 0;
  input.focus();
  if (selectAll) input.select();
  return true;
}

export function isFocused() { return document.activeElement === input; }

// Address display: host emphasized, scheme hidden for https; internal pages by name.
export function refresh() {
  if (!root) return;
  const t = activeTab();
  const url = t ? (t.pendingUrl || t.url) : '';
  const focused = document.activeElement === input;
  if (focused && editing) return;
  if (focused) {
    // Focused but nothing typed yet: keep it in step with the page, still all selected (so typing replaces it).
    const v = t && !isNewTab(url) ? url : '';
    if (input.value !== v) { input.value = v; input.select(); }
  }
  // The address shown when you're not typing: always the current tab's (also while it's hidden behind the
  // focused field, so it's right the moment you leave it).
  const mode = (setting('appearance.address') || {}).show || 'path';
  const key = url + '|' + (t && t.error ? 'e' : '') + (t && t.loading ? 'l' : '') + '|' + mode;
  updateSiteIcon(t);
  if (key === lastUrlShown) return;
  lastUrlShown = key;
  if (!focused) input.value = t && !isNewTab(url) ? url : '';
  display.replaceChildren();
  root.classList.toggle('is-empty', !t || isNewTab(url));
  if (!t || isNewTab(url)) { display.append(h('span.addr-ph', null, 'Search or enter an address')); return; }
  if (isInternal(url)) {
    display.append(h('span.addr-host', null, pageName(url) || hostOf(url)), h('span.addr-rest.addr-gap', null, 'bifrost://' + url.slice('bifrost://'.length).replace(/\/$/, '')));
    return;
  }
  let u;
  try { u = new URL(url); } catch { display.append(h('span.addr-rest', null, url)); return; }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    // Settings → Appearance → Address bar: just the site, the site and page (default), or the whole address.
    if (mode === 'full') {
      display.append(h('span.addr-scheme', null, u.protocol + '//'), h('span.addr-host', null, u.host), h('span.addr-rest', null, url.slice((u.protocol + '//' + u.host).length)));
      return;
    }
    const host = u.hostname.replace(/^www\./, '');
    const rest = mode === 'host' ? '' : displayUrl(url).slice(displayUrl(url).indexOf(host) + host.length);
    if (u.protocol === 'http:') display.append(h('span.addr-scheme', null, 'http://'));
    display.append(h('span.addr-host', null, host), h('span.addr-rest', null, rest));
  } else {
    display.append(h('span.addr-rest', null, url));
  }
}

function updateSiteIcon(t) {
  const url = t ? t.url : '';
  let name = 'search', cls = '';
  if (!t || isNewTab(url)) { name = 'search'; cls = 'neutral'; }
  else if (isInternal(url)) { name = 'compass'; cls = 'internal'; }
  else if (/^https:/i.test(url)) { name = 'lock'; cls = 'secure'; }
  else if (/^http:/i.test(url)) { name = 'warn'; cls = 'insecure'; }
  else if (/^chrome-extension:/i.test(url)) { name = 'puzzle'; cls = 'internal'; }
  else if (/^file:/i.test(url)) { name = 'file'; cls = 'neutral'; }
  else name = 'info';
  const key = name + cls;
  if (siteBtn.dataset.key !== key) {
    siteBtn.dataset.key = key;
    siteBtn.className = 'addr-site ' + cls;
    siteBtn.replaceChildren(icon(name));
    siteBtn.title = cls === 'insecure' ? 'Not secure: view site information' : 'View site information';
  }
}

export function init() {
  on('page-pointer', () => { lastPagePointer = performance.now(); });
  on('active', () => { editing = false; hideDrop(); lastUrlShown = ''; refresh(); });
  on('tab', (t, patch) => { if (t === activeTab() && ('url' in patch || 'pendingUrl' in patch || 'error' in patch || 'loading' in patch)) refresh(); });
  on('workspace', () => { lastUrlShown = ''; refresh(); });
  on('settings', (path) => { if (!path || path.startsWith('appearance')) refresh(); });
  // With no address bar on screen (compact mode), the page gets focus instead.
  on('focus-address', (tab) => { if (!focus(true) && tab) emit('focus-view', tab); });
  window.addEventListener('resize', () => { if (dropEl) showDrop(); });
  refresh();
}
