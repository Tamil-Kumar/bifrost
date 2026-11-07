// Bifrost browser UI — the side panel next to the page: bookmarks, history and downloads, websites (Claude,
// WhatsApp…) and extensions. The side bar has a button for each, as in Firefox: a column at the window's
// edge with horizontal tabs, a row at the bottom of the sidebar with vertical tabs.
import { S, on, emit, activeTab, setting, accelFor } from './state.js';
import { h, faviconEl, displayUrl, hostOf, debounce, animate, fmtBytes, timeAgo, copyText } from './util.js';
import { icon } from './icons.js';
import { showMenu, popover } from './menus.js';
import { dialog, toast, setPanelPrompts, refreshPrompts, forgetOwner } from './prompts.js';
import * as T from './tabs.js';
import * as V from './views.js';
import { howFromEvent } from './results.js';

const wb = window.wb;
const root = document.documentElement;
const panelEl = document.getElementById('panel');
const stripEl = document.getElementById('panel-strip');     // horizontal tabs: the column at the window's edge
const rowEl = document.getElementById('sidebar-panels');    // vertical tabs: the row in the sidebar
const BUILTIN = { bookmarks: ['Bookmarks', 'book', 'panelBookmarks'], history: ['History', 'clock', 'panelHistory'], downloads: ['Downloads', 'download', 'panelDownloads'] };
// For the + button: sites people often keep next to what they're doing.
const SUGGESTED = [
  ['Claude', 'https://claude.ai/'], ['ChatGPT', 'https://chatgpt.com/'], ['Gemini', 'https://gemini.google.com/'],
  ['WhatsApp', 'https://web.whatsapp.com/'], ['Telegram', 'https://web.telegram.org/'], ['Google Translate', 'https://translate.google.com/'],
];
const MIN_W = 240, MAX_W = 720;

let view = null;       // what the panel shows: 'bookmarks' | 'history' | 'downloads' | 'web:<id>' | 'ext:<id>' | null
let last = null;       // what it showed last (Show or hide the side panel brings it back)
let wantOpen = null;   // something just added, to show once it's in the settings
let headEl, bodyEl, searchEl, webHost;
let extPanels = [];    // extensions' panels: [{ id, name, icon, url, kind: 'side' | 'sidebar' | 'popup' }]
let extShown = null;   // { id, url, kind, el } of the extension page in the panel
const webs = new Map(); // website id -> { id, el, url, title, favicon, loading, back, badge, prompts, panelPrompts }

function loadLocal(key, fallback) { try { const v = JSON.parse(localStorage.getItem('wb.' + key)); return v == null ? fallback : v; } catch { return fallback; } }
function saveLocal(key, v) { try { localStorage.setItem('wb.' + key, JSON.stringify(v)); } catch { /* private storage */ } }
const saveSetting = (path, v) => wb.invoke('settings:set', path, v).catch((e) => toast({ text: e.message, iconName: 'warn' }));

// ----------------------------------------------------------------- entries
const validWeb = (w) => w && typeof w.id === 'string' && /^[\w-]{1,40}$/.test(w.id) && /^https?:\/\/\S+$/i.test(w.url || '');
const webList = () => (setting('panels.web') || []).filter(validWeb);
const hiddenSet = () => new Set(setting('panels.hidden') || []);
const siteName = (url) => hostOf(url).replace(/^www\./, '') || url;
const urlKey = (url) => { try { const u = new URL(url); return u.host.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search; } catch { return url; } };

// Everything the side panel can show, in the side bar's order (all: the hidden ones too).
function entries({ all = false } = {}) {
  const hidden = all ? new Set() : hiddenSet();
  const out = [];
  for (const [key, [label, ic, cmd]] of Object.entries(BUILTIN)) if (!hidden.has(key)) out.push({ key, kind: 'builtin', label, ic, cmd });
  for (const w of webList()) out.push({ key: 'web:' + w.id, kind: 'web', label: w.title || siteName(w.url), w });
  for (const p of extPanels) if (!hidden.has('ext:' + p.id)) out.push({ key: 'ext:' + p.id, kind: 'ext', label: p.name, p });
  return out;
}
const entryFor = (key) => entries({ all: true }).find((e) => e.key === key) || null;

function extIcon(p, cls) {
  const img = h('img.' + cls, { src: p.icon || '', alt: '', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(h('span.' + cls + '.letter', null, (p.name || '?').charAt(0).toUpperCase())), { once: true });
  if (!p.icon) queueMicrotask(() => img.dispatchEvent(new Event('error')));
  return img;
}
function entryIcon(e, cls) {
  if (e.kind === 'builtin') return h('span.' + cls + '.builtin', null, icon(e.ic));
  if (e.kind === 'web') { const rec = webs.get(e.w.id); return faviconEl(e.w.url, (rec && rec.favicon) || '', icon, cls, { hi: true, lookup: true }); }
  return extIcon(e.p, cls);
}

// ---------------------------------------------------------------- side bar
function stripOn() { return setting('panels.strip') !== false; }

function renderStrip() {
  const horizontal = root.dataset.layout === 'horizontal';
  const host = stripOn() ? (horizontal ? stripEl : rowEl) : null;
  root.classList.toggle('panel-strip', host === stripEl);
  for (const el of [stripEl, rowEl]) if (el !== host) el.replaceChildren();
  rowEl.classList.toggle('empty', host !== rowEl);
  if (!host) return;
  // In the sidebar, panels it has a button for already (Settings → Appearance → Toolbar and sidebar) aren't repeated.
  const inSidebar = horizontal ? new Set() : new Set([...(setting('appearance.sidebarTop') || []), ...(setting('appearance.sidebarBottom') || [])]);
  const btns = entries().filter((e) => !(e.kind === 'builtin' && inSidebar.has(e.key))).map(stripButton);
  const add = h('button.ps-btn.ps-add.no-drag', { type: 'button', title: 'Add to the side panel', 'aria-label': 'Add to the side panel', onclick: (ev) => addPopover(ev.currentTarget) }, icon('plus'));
  if (horizontal) {
    const gear = h('button.ps-btn.no-drag', { type: 'button', title: 'Side panel settings', 'aria-label': 'Side panel settings', onclick: () => emit('command', 'openSettings', { section: 'panels' }) }, icon('sliders'));
    host.replaceChildren(h('div.ps-list', null, ...btns, add), h('div.ps-foot', null, gear));
  } else {
    host.replaceChildren(...btns, add);
  }
  host.oncontextmenu = (ev) => {
    if (ev.target.closest('.ps-btn[data-key]')) return;
    ev.preventDefault();
    stripMenu({ x: ev.clientX, y: ev.clientY });
  };
}

function stripButton(e) {
  const rec = e.kind === 'web' ? webs.get(e.w.id) : null;
  const accel = e.cmd ? accelFor(e.cmd) : '';
  const b = h('button.ps-btn.no-drag' + (e.key === view ? '.on' : '') + (rec ? '.loaded' : ''), {
    type: 'button', title: e.label + (accel ? ` (${accel})` : ''), 'aria-label': e.label, 'aria-pressed': String(e.key === view), dataset: { key: e.key },
  }, entryIcon(e, 'ps-ico'), rec && rec.badge ? h('span.ps-badge', null, rec.badge) : null);
  b.addEventListener('mousedown', (ev) => { if (ev.button === 0) ev.preventDefault(); });
  b.addEventListener('click', () => toggle(e.key, { focus: true }));
  b.addEventListener('auxclick', (ev) => { if (ev.button === 1 && e.kind === 'web') { ev.preventDefault(); T.openUrl(pageUrl(e.w), { where: 'background' }); } });
  b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); entryMenu(e, { x: ev.clientX, y: ev.clientY }); });
  return b;
}

// The current one lit up, on the side bar and on toolbar buttons that open built-in panels.
function markActive() {
  for (const b of document.querySelectorAll('.ps-btn[data-key]')) { b.classList.toggle('on', b.dataset.key === view); b.setAttribute('aria-pressed', String(b.dataset.key === view)); }
  for (const b of document.querySelectorAll('button[data-panel]')) b.classList.toggle('on', !!(view && BUILTIN[view] && b.dataset.panel === BUILTIN[view][2]));
}

function stripMenu(pos) {
  showMenu([
    { label: 'Add to the side panel…', icon: 'plus', action: () => addPopover(document.querySelector('.ps-add')) },
    { label: 'Side panel settings', icon: 'sliders', action: () => emit('command', 'openSettings', { section: 'panels' }) },
    '-',
    { label: 'Hide the side bar', icon: 'eyeOff', action: () => {
      saveSetting('panels.strip', false);
      toast({ text: 'Side bar hidden. Settings → Side panel brings it back.', iconName: 'sidebar', timeout: 5000 });
    } },
  ], pos);
}

function entryMenu(e, pos) {
  const shown = view === e.key;
  const items = [{ label: shown ? 'Close' : 'Open', icon: 'sidebar', action: () => toggle(e.key, { focus: !shown }) }];
  if (e.kind === 'web') {
    const rec = webs.get(e.w.id);
    const list = webList();
    const i = list.findIndex((x) => x.id === e.w.id);
    items.push(
      { label: 'Open in a new tab', icon: 'external', action: () => T.openUrl(pageUrl(e.w), { where: 'newtab' }) },
      { label: 'Reload', icon: 'reload', disabled: !rec, action: () => rec.el.reload() },
      { label: 'Back to the start', icon: 'home', disabled: !rec || urlKey(rec.url) === urlKey(e.w.url), action: () => rec.el.loadURL(e.w.url) },
      { label: 'Copy address', icon: 'link', action: () => copyText(pageUrl(e.w)) },
      '-',
      { label: 'Edit…', icon: 'edit', action: () => editWeb(e.w) },
      { label: 'Move up', icon: 'arrowUp', disabled: i <= 0, action: () => moveWeb(e.w.id, -1) },
      { label: 'Move down', icon: 'arrowDown', disabled: i < 0 || i >= list.length - 1, action: () => moveWeb(e.w.id, 1) },
      { label: 'Put to sleep', icon: 'moon', disabled: !rec, action: () => unloadWeb(e.w.id) },
      '-',
      { label: 'Remove from the side panel', icon: 'trash', danger: true, action: () => removeWeb(e.w.id) });
  } else if (e.kind === 'ext') {
    items.push(
      { label: 'Reload', icon: 'reload', disabled: !(extShown && extShown.id === e.p.id), action: () => extShown.el.reload() },
      '-',
      e.p.kind === 'popup'
        ? { label: 'Remove from the side panel', icon: 'trash', danger: true, action: () => removeExtension(e.p.id) }
        : { label: 'Hide from the side bar', icon: 'eyeOff', action: () => hide(e.key) },
      { label: 'Manage extensions', icon: 'puzzle', action: () => emit('command', 'openExtensions') });
  } else {
    items.push({ label: 'Hide from the side bar', icon: 'eyeOff', action: () => hide(e.key) });
  }
  showMenu(items, pos);
}

function hide(key) {
  const hidden = setting('panels.hidden') || [];
  if (!hidden.includes(key)) saveSetting('panels.hidden', hidden.concat(key));
  toast({ text: 'Hidden from the side bar. Its + button brings it back.', iconName: 'eyeOff', timeout: 4000 });
}
function unhide(key) {
  wantOpen = key;
  saveSetting('panels.hidden', (setting('panels.hidden') || []).filter((k) => k !== key));
}

// ------------------------------------------------------------ adding things
// The side bar's + button: a website (the page you're on, or any address), a suggestion, an extension, or
// something hidden.
async function addPopover(anchor) {
  const cur = activeTab();
  const curUrl = cur && /^https?:\/\//i.test(cur.url || '') ? cur.url : '';
  const input = h('input.field', { type: 'text', spellcheck: 'false', placeholder: 'Website address', autofocus: true, 'data-select': '', 'aria-label': 'Website address' });
  input.value = curUrl;
  const submit = () => {
    const url = normalizeUrl(input.value);
    if (!url) { input.classList.add('invalid'); input.focus(); return; }
    pop.close('done');
    addWeb(url, curUrl && urlKey(url) === urlKey(curUrl) ? cur.title : '');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => input.classList.remove('invalid'));
  const have = new Set(webList().map((w) => urlKey(w.url)));
  const sugg = SUGGESTED.filter(([, url]) => !have.has(urlKey(url)));
  const extBox = h('div.pa-section');
  const hiddenBuiltins = Object.entries(BUILTIN).filter(([k]) => hiddenSet().has(k));
  const row = (iconEl, label, btnLabel, fn) => h('div.pa-row', null, iconEl, h('span.pa-name', null, label), h('button.btn.small', { type: 'button', onclick: () => { pop.close('done'); fn(); } }, btnLabel));
  const body = h('div.panel-add', null,
    h('div.pa-title', null, 'Add a website'),
    h('div.pa-field', null, input, h('button.btn.primary', { type: 'button', onclick: submit }, 'Add')),
    curUrl ? h('p.pa-note', null, 'This page is filled in. It stays signed in like your tabs.') : h('p.pa-note', null, 'It stays signed in like your tabs.'),
    sugg.length ? h('div.pa-chips', null, sugg.map(([name, url]) => h('button.pa-chip', { type: 'button', title: url, onclick: () => { pop.close('done'); addWeb(url, name); } }, faviconEl(url, '', icon, 'pa-fav', { hi: true, lookup: true }), h('span', null, name)))) : null,
    extBox,
    hiddenBuiltins.length ? h('div.pa-section', null, h('div.pa-title', null, 'Hidden'), hiddenBuiltins.map(([k, [label, ic]]) => row(h('span.pa-fav.builtin', null, icon(ic)), label, 'Show', () => unhide(k)))) : null);
  const horizontal = root.dataset.layout === 'horizontal';
  const side = horizontal || root.dataset.side !== 'right' ? 'right' : 'left';
  const pop = popover(body, anchor ? { anchor, side, align: horizontal ? 'start' : 'end' } : { x: 80, y: 80 }, { className: 'panel-add-pop' });
  if (S.isPrivate) return;
  // Extensions: ones without a panel of their own can show their popup page there; hidden ones can come back.
  const cands = await wb.invoke('panels:extension-candidates').catch(() => []);
  const hidden = hiddenSet();
  const rows = cands.filter((c) => !c.added || hidden.has('ext:' + c.id)).map((c) => (c.added
    ? row(extIcon(c, 'pa-fav'), c.name, 'Show', () => unhide('ext:' + c.id))
    : row(extIcon(c, 'pa-fav'), c.name, 'Add', () => addExtension(c.id))));
  if (rows.length) { extBox.replaceChildren(h('div.pa-title', null, 'Extensions'), ...rows); pop.reposition(); }
}

function normalizeUrl(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return '';
    s = (/^(localhost|127\.|\[|\d+\.\d+\.\d+\.\d+)/i.test(s) ? 'http://' : 'https://') + s.replace(/^\/+/, '');
  }
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname || !(u.hostname.includes('.') || u.hostname === 'localhost' || u.hostname.startsWith('['))) return '';
    return u.href;
  } catch { return ''; }
}

// A website in the side panel (the same address twice just opens the one that's there).
export function addWeb(url, title = '') {
  url = normalizeUrl(url);
  if (!url) return;
  const list = webList();
  const there = list.find((w) => urlKey(w.url) === urlKey(url));
  if (there) { open('web:' + there.id, { focus: true }); return; }
  const w = { id: Math.random().toString(36).slice(2, 10), url, title: String(title || '').trim().slice(0, 80) };
  wantOpen = 'web:' + w.id;
  saveSetting('panels.web', (setting('panels.web') || []).concat(w));
}

// The current tab's page, in the side panel ("Add this page to the side panel").
export function addPage(tab) {
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) { toast({ text: 'Only websites can go in the side panel', iconName: 'info' }); return; }
  addWeb(tab.url, tab.title);
}

function addExtension(id) {
  wantOpen = 'ext:' + id;
  const list = setting('panels.extensions') || [];
  if (!list.includes(id)) saveSetting('panels.extensions', list.concat(id));
  else refreshExtensionPanels();
}
function removeExtension(id) {
  if (view === 'ext:' + id) close();
  saveSetting('panels.extensions', (setting('panels.extensions') || []).filter((x) => x !== id));
}

async function editWeb(w) {
  const name = h('input.field', { type: 'text', spellcheck: 'false', placeholder: siteName(w.url), 'aria-label': 'Name' });
  name.value = w.title || '';
  const addr = h('input.field', { type: 'text', spellcheck: 'false', 'aria-label': 'Address' });
  addr.value = w.url;
  const body = h('div.panel-edit', null, h('label', null, h('span', null, 'Name'), name), h('label', null, h('span', null, 'Address'), addr));
  setTimeout(() => { try { name.focus(); name.select(); } catch { /* gone */ } }, 40);
  const ok = await dialog({ title: 'Edit side panel website', iconName: 'edit', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', primary: true, value: true }], width: 440 });
  if (!ok) return;
  const url = normalizeUrl(addr.value);
  if (!url) { toast({ text: 'That isn’t a web address', iconName: 'warn' }); return; }
  saveSetting('panels.web', webList().map((x) => (x.id === w.id ? { id: x.id, url, title: name.value.trim().slice(0, 80) } : x)));
}

function moveWeb(id, by) {
  const list = webList();
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveSetting('panels.web', list);
}

function removeWeb(id) {
  if (view === 'web:' + id) close();
  unloadWeb(id);
  saveSetting('panels.web', webList().filter((x) => x.id !== id));
}

// ------------------------------------------------------------- the panel
function build() {
  headEl = h('div.panel-head.drag');
  searchEl = h('input.field.panel-search', { type: 'search', placeholder: 'Search', spellcheck: 'false' });
  searchEl.addEventListener('input', debounce(() => renderView(), 120));
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (searchEl.value) { searchEl.value = ''; renderView(); } else close(); } });
  bodyEl = h('div.panel-body');
  webHost = h('div.panel-webhost');
  const resizer = h('div.panel-resizer');
  resizer.addEventListener('pointerdown', startResize);
  panelEl.replaceChildren(headEl, h('div.panel-main', null, h('div.panel-search-row', null, searchEl), bodyEl, webHost), resizer);
  panelEl.style.setProperty('--panel-w', Math.max(MIN_W, Math.min(MAX_W, Number(loadLocal('panelWidth', 320)) || 320)) + 'px');
}

function startResize(e) {
  e.preventDefault();
  const shield = V.dragShield('col-resize');
  const startX = e.clientX;
  const startW = panelEl.getBoundingClientRect().width;
  const right = root.dataset.side === 'right' && root.dataset.layout === 'vertical';
  const move = (ev) => {
    const w = Math.max(MIN_W, Math.min(MAX_W, startW + (right ? startX - ev.clientX : ev.clientX - startX)));
    panelEl.style.setProperty('--panel-w', w + 'px');
  };
  const up = () => {
    shield.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    saveLocal('panelWidth', Math.round(panelEl.getBoundingClientRect().width));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function toggle(which, opts) {
  if (view === which) { close(); return; }
  open(which, opts);
}

// Show or hide the side panel: the last thing it showed comes back.
export function toggleLast() {
  if (view) { close(); return; }
  const there = last && (BUILTIN[last] || entryFor(last));
  open(there ? last : (entries()[0] || { key: 'bookmarks' }).key, { focus: true });
}

export function open(which, { url, focus = false } = {}) {
  if (!which) return;
  if (!headEl) build();
  const kind = which.startsWith('ext:') ? 'ext' : which.startsWith('web:') ? 'web' : 'builtin';
  const ext = kind === 'ext' ? extPanels.find((p) => 'ext:' + p.id === which) : null;
  const web = kind === 'web' ? webList().find((w) => 'web:' + w.id === which) : null;
  if ((kind === 'builtin' && !BUILTIN[which]) || (kind === 'ext' && !ext && !url) || (kind === 'web' && !web)) return;
  const was = view;
  view = last = which;
  root.classList.add('panel-open');
  panelEl.dataset.kind = kind;
  if (kind === 'ext') showExtension(ext || { id: which.slice(4), name: which.slice(4), kind: 'side' }, url || ext.url);
  else hideExtension();
  if (kind === 'web') showWeb(web, { focus });
  else for (const r of webs.values()) { r.el.classList.remove('on'); if (r.failEl) r.failEl.classList.remove('on'); }
  if (kind === 'builtin') {
    searchEl.value = '';
    searchEl.placeholder = 'Search ' + BUILTIN[which][0].toLowerCase();
    renderView();
  }
  renderHead();
  if (!was) animate(panelEl, [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' }, 'panels');
  markActive();
  refreshPrompts();
  emit('layout-changed');
}

export function close() {
  if (!view) return;
  const hadFocus = panelEl.contains(document.activeElement);
  view = null;
  hideExtension();
  for (const r of webs.values()) { r.el.classList.remove('on'); if (r.failEl) r.failEl.classList.remove('on'); }
  delete panelEl.dataset.kind;
  root.classList.remove('panel-open');
  markActive();
  refreshPrompts();
  if (hadFocus && activeTab()) T.focusTab(activeTab());
  emit('layout-changed');
}

// The panel's title row: with the side bar, what's showing (and, for a website, back, reload, open in a tab);
// without it, a button for each panel.
function renderHead() {
  if (!headEl || !view) return;
  const btn = (ic, title, fn, disabled = false) => h('button.icon-btn.no-drag', { type: 'button', title, 'aria-label': title, disabled, onclick: fn }, icon(ic));
  const closeBtn = btn('close', 'Close panel', () => close());
  const actions = [];
  const e = entryFor(view) || (extShown && view === 'ext:' + extShown.id ? { key: view, kind: 'ext', label: extShown.name || extShown.id, p: extShown } : null);
  const rec = view.startsWith('web:') ? webs.get(view.slice(4)) : null;
  if (rec && e) {
    actions.push(
      btn('back', 'Back', () => rec.el.goBack(), !rec.back),
      rec.loading ? btn('stop', 'Stop', () => rec.el.stop()) : btn('reload', 'Reload', () => rec.el.reload()),
      btn('external', 'Open in a new tab', () => T.openUrl(pageUrl(e.w), { where: 'newtab' })),
      btn('dots', 'More', (ev) => entryMenu(e, { anchor: ev.currentTarget, side: 'bottom', align: 'end' })));
  } else if (view.startsWith('ext:') && extShown) {
    actions.push(btn('reload', 'Reload', () => extShown.el.reload()));
  }
  if (!stripOn()) {
    const tabs = h('div.seg.panel-seg', null, entries().map((x) => {
      const b = h('button.seg-btn' + (x.key === view ? '.on' : '') + (x.kind === 'builtin' ? '' : '.panel-ext'), { type: 'button', title: x.label, onclick: () => open(x.key, { focus: x.kind !== 'builtin' }) }, entryIcon(x, 'panel-ext-ico'), h('span.seg-label', null, x.label));
      b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); entryMenu(x, { x: ev.clientX, y: ev.clientY }); });
      return b;
    }));
    const add = btn('plus', 'Add to the side panel', (ev) => addPopover(ev.currentTarget));
    const reload = actions.find((a) => a.title === 'Reload' || a.title === 'Stop');
    headEl.replaceChildren(tabs, add, h('div.tb-spacer'), ...(reload ? [reload] : []), closeBtn);
    return;
  }
  const title = (rec && rec.title) || (e ? e.label : '');
  headEl.replaceChildren(e ? entryIcon(e, 'panel-ico') : h('span'), h('span.panel-title', { title }, title), ...actions, closeBtn);
}

function renderView() {
  if (!view || !BUILTIN[view]) return;
  if (view === 'bookmarks') renderBookmarks();
  else if (view === 'history') renderHistory();
  else renderDownloads();
}

// ---------------------------------------------------------------- websites
// Each runs in a <webview> of its own (not a tab), kept while the window is open so it stays where you left
// it; Put to sleep (its menu) lets it go. The main process is told first, so it's set up as a website in
// the side panel.
function pageUrl(w) { const rec = webs.get(w.id); return (rec && rec.url) || w.url; }

function loadWeb(w) {
  let rec = webs.get(w.id);
  if (rec) return rec;
  const el = document.createElement('webview');
  el.className = 'panel-webview';
  el.dataset.sidePanel = 'web';
  el.setAttribute('partition', S.partition || 'persist:main');
  el.setAttribute('allowpopups', '');
  rec = { id: w.id, el, home: w.url, url: w.url, title: '', favicon: '', loading: true, back: false, badge: '', prompts: [], panelPrompts: true, wantFocus: false };
  webs.set(w.id, rec);
  // (while there are websites, the closed panel is only out of sight, like a tab in the background: their
  // pages keep their size, and come back as they were)
  panelEl.classList.add('keep');
  wireWeb(rec);
  // (the address as the <webview> will have it, which is how the main process knows it: "https://claude.ai"
  // becomes "https://claude.ai/")
  let src = w.url;
  try { src = new URL(w.url).href; } catch { /* checked already */ }
  wb.invoke('panels:web-attach', w.id, src).then((ok) => {
    if (webs.get(w.id) !== rec) return;
    if (!ok) { webs.delete(w.id); panelEl.classList.toggle('keep', webs.size > 0); return; }
    el.setAttribute('src', src);
    webHost.append(el);
    renderStrip();
  }, () => { if (webs.get(w.id) === rec) { webs.delete(w.id); panelEl.classList.toggle('keep', webs.size > 0); } });
  return rec;
}

function wireWeb(rec) {
  const { el } = rec;
  const shown = () => view === 'web:' + rec.id;
  const nav = () => {
    try { rec.back = el.canGoBack(); rec.url = el.getURL() || rec.url; } catch { /* not attached yet */ }
    if (shown()) renderHead();
  };
  el.addEventListener('did-start-loading', () => { rec.loading = true; setFailed(rec, null); if (shown()) renderHead(); });
  // A page that didn't load (offline, say): says so, with Try again. (-3: stopped, or another load took over.)
  el.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) setFailed(rec, { url: e.validatedURL || rec.url, text: e.errorDescription || '' }); });
  el.addEventListener('did-stop-loading', () => {
    rec.loading = false;
    nav();
    if (rec.wantFocus && shown()) { rec.wantFocus = false; try { el.focus(); } catch { /* gone */ } }
  });
  el.addEventListener('did-navigate', () => {
    // A new page doesn't inherit the old page's questions.
    denyPrompts(rec);
    nav();
  });
  el.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) nav(); });
  el.addEventListener('page-title-updated', (e) => {
    rec.title = e.title || '';
    // "(3) WhatsApp": unread messages, on its button.
    const m = /^\((\d{1,4}\+?)\)\s/.exec(rec.title);
    const badge = m ? m[1] : '';
    if (badge !== rec.badge) { rec.badge = badge; renderStrip(); }
    if (shown()) renderHead();
  });
  el.addEventListener('page-favicon-updated', (e) => { rec.favicon = (e.favicons || [])[0] || rec.favicon; });
  el.addEventListener('ipc-message', (e) => onPageMessage(rec, e.channel, e.args || []));
  // Its page crashed or was ended (Task manager): it starts again the next time it's shown.
  el.addEventListener('render-process-gone', () => { rec.gone = true; if (shown()) setTimeout(() => { if (rec.gone) { rec.gone = false; el.reload(); } }, 400); });
}

function setFailed(rec, failed) {
  if (rec.failEl) { rec.failEl.remove(); rec.failEl = null; }
  if (!failed) return;
  rec.failEl = h('div.pw-fail' + (view === 'web:' + rec.id ? '.on' : ''), null,
    h('span.pw-fail-ico', null, icon('warn')),
    h('b', null, 'Couldn’t load ' + (hostOf(failed.url) || 'the page')),
    failed.text ? h('small', null, failed.text.replace(/^net::/, '')) : null,
    h('button.btn.small', { type: 'button', onclick: () => rec.el.reload() }, icon('reload'), 'Try again'));
  webHost.append(rec.failEl);
}

function showWeb(w, { focus } = {}) {
  const rec = loadWeb(w);
  for (const r of webs.values()) { r.el.classList.toggle('on', r === rec); if (r.failEl) r.failEl.classList.toggle('on', r === rec); }
  if (rec.gone) { rec.gone = false; try { rec.el.reload(); } catch { /* not attached */ } }
  if (focus) {
    if (rec.loading) rec.wantFocus = true;
    else setTimeout(() => { if (view === 'web:' + rec.id) { try { rec.el.focus(); } catch { /* gone */ } } }, 0);
  }
}

function denyPrompts(rec) {
  for (const p of rec.prompts) { if (p.handle) p.handle.close('nav'); p.resolve({ allow: false, remember: false }); }
  rec.prompts = [];
}

// What the tab preload tells the window (preload/tab.js): browser shortcuts the page let through and Vim
// keys, links it opens, pop-ups it was stopped from opening. Going back, reloading and the like are for this
// page; what's about the page in a tab (find, zoom, print…) isn't for it.
const OWN = { back: (el) => el.goBack(), forward: (el) => el.goForward(), reload: (el) => el.reload(), hardReload: (el) => el.reloadIgnoringCache(), stop: (el) => el.stop(), devtools: (el) => el.openDevTools() };
function onPageMessage(rec, channel, args) {
  if (channel === 'wb-command') {
    let id = String(args[0] || '');
    if (id.startsWith('vim:') && OWN[id.slice(4)]) id = id.slice(4);
    if (OWN[id]) { try { OWN[id](rec.el); } catch { /* not attached */ } return; }
    const meta = (window.WBDefaults.COMMANDS || []).find((c) => c.id === id);
    if ((meta && meta.category === 'Page') || /^vim:find/.test(id) || id === 'home') return;
    emit('command', id, { source: 'panel' });
  } else if (channel === 'wb-open') {
    const o = args[0] || {};
    const url = String(o.url || '');
    if (!/^(https?|ftp):/i.test(url)) return;
    if (o.split) T.openUrl(url, { where: 'split' });
    else T.openTab({ url, active: !o.background });
  } else if (channel === 'wb-copy') {
    copyText(String(args[0] || '')).catch(() => {});
  } else if (channel === 'wb-popup-blocked') {
    const url = String(args[0] || ''), from = String(args[1] || rec.url);
    if (!/^(https?|ftp):/i.test(url) && url !== '') return;
    const host = hostOf(from).replace(/^www\./, '');
    toast({ text: `Pop-up blocked${host ? ' on ' + host : ''}`, iconName: 'shield', timeout: 7000, actions: url ? [{ label: 'Open it', action: () => T.openTab({ url }) }] : [] });
  }
}

// One of its notifications was clicked: its page, in the side panel.
export function showByWc(wcId) {
  for (const r of webs.values()) {
    let id = null;
    try { id = r.el.getWebContentsId(); } catch { /* not attached */ }
    if (id === wcId) { if (view !== 'web:' + r.id) open('web:' + r.id, { focus: true }); return true; }
  }
  return false;
}

export function unloadWeb(id) {
  const rec = webs.get(id);
  if (!rec) return;
  if (view === 'web:' + id) close();
  webs.delete(id);
  forgetOwner(rec);
  setFailed(rec, null);
  rec.el.remove();
  panelEl.classList.toggle('keep', webs.size > 0);
  renderStrip();
}

// Websites that were removed (or moved to another address) in Settings or another window.
function syncWebs() {
  const list = webList();
  for (const [id, rec] of [...webs]) {
    const w = list.find((x) => x.id === id);
    if (!w) { if (view === 'web:' + id) close(); unloadWeb(id); }
    else if (urlKey(w.url) !== urlKey(rec.home)) {
      const showing = view === 'web:' + id;
      unloadWeb(id);
      if (showing) open('web:' + id);
    }
  }
}

// ------------------------------------------------------- extension panels
// The extension's page runs in a <webview> of its own (not a tab), made when it's shown and gone when it isn't
// (as in Chrome); the main process is told first, so it sets it up as an extension panel.
async function showExtension(p, url) {
  try { url = new URL(url).href; } catch { return; }
  if (extShown && extShown.id === p.id && extShown.url === url) return;
  hideExtension();
  bodyEl.replaceChildren();
  const ok = await wb.invoke('extensions:side-panel-attach', p.id, url).catch(() => false);
  if (!ok || view !== 'ext:' + p.id) return;
  const wv = document.createElement('webview');
  wv.className = 'panel-webview';
  wv.dataset.sidePanel = 'ext';
  wv.setAttribute('partition', 'persist:main');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', url);
  // A popup page closes itself when it's done (after filling in a password, say): here it starts over.
  wv.addEventListener('close', () => { if (extShown && extShown.el === wv) { if (p.kind === 'popup') wv.loadURL(url); else close(); } });
  extShown = { id: p.id, name: p.name, url, kind: p.kind || 'side', el: wv };
  bodyEl.append(wv);
  if (extShown.kind === 'side') wb.send('extensions:side-panel-state', { id: p.id, path: new URL(url).pathname.slice(1), shown: true });
  renderHead();
}

function hideExtension() {
  if (!extShown) return;
  const { id, url, el, kind } = extShown;
  extShown = null;
  el.remove();
  if (kind === 'side') wb.send('extensions:side-panel-state', { id, path: new URL(url).pathname.slice(1), shown: false });
}

// The side panel's page (a website's or an extension's), if that's the webContents asking (for its context menu).
export function panelWebview(wcId) {
  const els = [...webs.values()].map((r) => r.el).concat(extShown ? [extShown.el] : []);
  for (const el of els) { try { if (el.getWebContentsId() === wcId) return el; } catch { /* not attached */ } }
  return null;
}

// From the main process: an extension opened or closed its panel (chrome.sidePanel.open/close).
export function extensionPanel({ id, url, open: show }) {
  if (show) {
    if (!extPanels.some((p) => p.id === id)) extPanels.push({ id, name: id, icon: '', url, kind: 'side' });
    open('ext:' + id, { url });
    refreshExtensionPanels();
  } else if (view === 'ext:' + id) close();
}

export async function refreshExtensionPanels() {
  extPanels = S.isPrivate ? [] : await wb.invoke('extensions:side-panels').catch(() => []);
  if (view && view.startsWith('ext:')) {
    const p = extPanels.find((x) => 'ext:' + x.id === view);
    if (!p) close();
    else if (extShown && extShown.url !== p.url) showExtension(p, p.url);
  }
  renderStrip();
  if (view) renderHead();
  openWanted();
}

// Something just added (or shown again) opens once it's there.
function openWanted() {
  if (!wantOpen || !entryFor(wantOpen) || hiddenSet().has(wantOpen)) return;
  const key = wantOpen;
  wantOpen = null;
  if (view !== key) open(key, { focus: true });
}

// ---------------------------------------------------------------- built-ins
function openUrl(url, e) {
  T.openUrl(url, { where: (e && howFromEvent(e)) || 'current', allowScript: true, opener: activeTab() });
}

function linkRow(url, title, favicon, extra = {}) {
  const row = h('div.p-row', { title: url }, faviconEl(url, favicon, icon, 'p-fav', { hi: true }), h('span.p-title', null, title || displayUrl(url) || url), extra.meta ? h('span.p-meta', null, extra.meta) : null, extra.actions || null);
  row.addEventListener('click', (e) => { if (!e.target.closest('button')) openUrl(url, e); });
  row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); T.openUrl(url, { where: 'background', opener: activeTab() }); } });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu([
      { label: 'Open', action: () => openUrl(url) },
      { label: 'Open in new tab', icon: 'plus', action: () => T.openUrl(url, { where: 'background' }) },
      { label: 'Open in new window', icon: 'window', action: () => T.openUrl(url, { where: 'window' }) },
      { label: 'Open in split view', icon: 'split', action: () => T.openUrl(url, { where: 'split' }) },
      /^https?:/i.test(url) ? { label: 'Add to the side panel', icon: 'sidebar', action: () => addWeb(url, title) } : null,
      '-',
      { label: 'Copy link', icon: 'link', action: () => navigator.clipboard.writeText(url).catch(() => {}) },
      ...(extra.menu || []),
    ], { x: e.clientX, y: e.clientY });
  });
  return row;
}

// ---------------------------------------------------------------- bookmarks
const expanded = new Set(loadLocal('panelExpanded', [2]));

async function renderBookmarks() {
  const q = searchEl.value.trim();
  if (q) {
    const found = await wb.invoke('bookmarks:search', q).catch(() => []);
    if (view !== 'bookmarks') return;
    bodyEl.replaceChildren(...(found.length ? found.slice(0, 200).map((b) => linkRow(b.url, b.title, b.favicon, { meta: (b.path || []).slice(-1)[0] || '' })) : [h('p.p-empty', null, 'No bookmarks match')]));
    return;
  }
  const tree = await wb.invoke('bookmarks:tree').catch(() => null);
  if (view !== 'bookmarks' || !tree) return;
  const draw = (node, depth) => {
    const out = [];
    for (const c of node.children || []) {
      if (c.type === 'separator') { out.push(h('div.p-sep', { style: { marginLeft: depth * 14 + 'px' } })); continue; }
      if (c.type === 'folder') {
        const isOpen = expanded.has(c.id);
        const head = h('div.p-row.p-folder' + (isOpen ? '.open' : ''), { style: { paddingLeft: 8 + depth * 14 + 'px' } }, h('span.p-chev', null, icon('chevronRight')), icon(isOpen ? 'folderOpen' : 'folder'), h('span.p-title', null, c.title || 'Untitled folder'), h('span.p-meta', null, String((c.children || []).length)));
        head.addEventListener('click', () => { if (isOpen) expanded.delete(c.id); else expanded.add(c.id); saveLocal('panelExpanded', [...expanded]); renderBookmarks(); });
        head.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const links = (c.children || []).filter((x) => x.type === 'bookmark');
          showMenu([
            { label: `Open all (${links.length})`, icon: 'layers', disabled: !links.length, action: () => links.forEach((l) => T.openTab({ url: l.url, active: false, position: 'end' })) },
            { label: 'Bookmark manager', icon: 'book', action: () => emit('command', 'openBookmarks') },
          ], { x: e.clientX, y: e.clientY });
        });
        out.push(head);
        if (isOpen) out.push(...draw(c, depth + 1));
        continue;
      }
      const r = linkRow(c.url, c.title, c.favicon, { menu: ['-', { label: 'Delete bookmark', icon: 'trash', danger: true, action: () => wb.invoke('bookmarks:remove', c.id) }] });
      r.style.paddingLeft = 8 + depth * 14 + 18 + 'px';
      out.push(r);
    }
    return out;
  };
  const hideOther = setting('appearance.bookmarksBar.showOtherBookmarks') === false;
  const roots = (tree.children || []).filter((c) => (c.role !== 'mobile' && !(hideOther && c.role === 'other')) || (c.children || []).length);
  bodyEl.replaceChildren(...draw({ children: roots }, 0), h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openBookmarks') }, icon('book'), 'Bookmark manager'));
}

// ------------------------------------------------------------------ history
let histBefore = null, histLoading = false;

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (start(now) - start(d)) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

async function renderHistory(append = false) {
  if (histLoading) return;
  histLoading = true;
  const text = searchEl.value.trim();
  if (!append) histBefore = null;
  const rows = await wb.invoke('history:visits', { text, before: histBefore || Date.now() + 1, limit: 120 }).catch(() => []);
  histLoading = false;
  if (view !== 'history') return;
  if (!append) bodyEl.replaceChildren();
  bodyEl.querySelector('.p-more')?.remove();
  let lastDay = append ? bodyEl.dataset.lastDay : '';
  for (const v of rows) {
    const day = dayLabel(v.time);
    if (day !== lastDay) { bodyEl.append(h('div.p-day', null, day)); lastDay = day; }
    const del = h('button.icon-btn.p-del', { type: 'button', title: 'Remove from history', onclick: async (e) => { e.stopPropagation(); await wb.invoke('history:delete-visit', v.id); row.remove(); } }, icon('close'));
    const row = linkRow(v.url, v.title, v.favicon, { meta: new Date(v.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), actions: del, menu: ['-', { label: 'Remove from history', icon: 'trash', action: () => wb.invoke('history:delete-url', v.url).then(() => renderHistory()) }] });
    bodyEl.append(row);
  }
  bodyEl.dataset.lastDay = lastDay;
  if (!append && !rows.length) bodyEl.append(h('p.p-empty', null, text ? 'Nothing in your history matches' : 'Pages you visit show up here'));
  if (rows.length === 120) {
    histBefore = rows[rows.length - 1].time;
    bodyEl.append(h('button.link-btn.p-more', { type: 'button', onclick: () => renderHistory(true) }, 'Show more'));
  }
  if (!append) bodyEl.append(h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openHistory') }, icon('clock'), 'Full history'));
}

// ---------------------------------------------------------------- downloads
const warn = (e) => emit('toast', { text: e.message, iconName: 'warn' });
async function renderDownloads() {
  const text = searchEl.value.trim().toLowerCase();
  const list = (await wb.invoke('downloads:list').catch(() => [])).filter((d) => !text || (d.filename || '').toLowerCase().includes(text) || (d.url || '').toLowerCase().includes(text));
  if (view !== 'downloads') return;
  bodyEl.replaceChildren(...(list.length ? list.slice(0, 100).map((d) => {
    const row = h('div.p-row.p-dl', { title: d.path || d.url },
      h('span.p-dl-ico', null, icon('file')),
      h('div.p-dl-main', null, h('span.p-title', null, d.filename), h('small', null, d.state === 'completed' ? `${fmtBytes(d.total)} · ${timeAgo(d.ended || d.started)}` : d.state === 'progressing' ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : d.state)),
      d.state === 'completed' ? h('button.icon-btn', { type: 'button', title: 'Show in folder', onclick: (e) => { e.stopPropagation(); wb.invoke('downloads:action', d.id, 'show').catch(warn); } }, icon('folderOpen')) : null);
    if (d.state === 'completed') row.addEventListener('click', () => wb.invoke('downloads:action', d.id, 'open').catch(warn));
    return row;
  }) : [h('p.p-empty', null, 'No downloads')]),
  h('button.link-btn.p-foot', { type: 'button', onclick: () => emit('command', 'openDownloads') }, icon('download'), 'All downloads'));
}

// ------------------------------------------------------------------- tests
export function _state() {
  return { view, last, strip: stripOn(), webs: [...webs.values()].map((r) => ({ id: r.id, url: r.url, title: r.title, loading: r.loading, shown: r.el.classList.contains('on'), badge: r.badge })), ext: extPanels.map((p) => ({ id: p.id, kind: p.kind })), extShown: extShown ? { id: extShown.id, kind: extShown.kind, url: extShown.url } : null };
}

export function init() {
  if (!S.isPrivate) wb.on('extensions-changed', () => refreshExtensionPanels());
  refreshExtensionPanels();
  setPanelPrompts({
    owner: (wcId) => { for (const r of webs.values()) { try { if (r.el.getWebContentsId() === wcId) return r; } catch { /* not attached */ } } return null; },
    all: () => [...webs.values()],
    // (under the panel's title, while it shows that website)
    anchor: (r) => (view === 'web:' + r.id && headEl && headEl.offsetParent && !root.classList.contains('html-fs') ? { anchor: headEl, side: 'bottom', align: 'start' } : null),
  });
  on('settings', (path) => {
    if (path && !/^(panels|appearance|keyboard)\b/.test(path)) return;
    if (!path || path.startsWith('panels')) {
      syncWebs();
      if (view && view.startsWith('web:') && !entryFor(view)) close();
      if (!path || path === 'panels' || path.startsWith('panels.extensions')) { refreshExtensionPanels(); return; }
    }
    renderStrip();
    if (view) renderHead();
    openWanted();
  });
  on('bookmarks-changed', () => { if (view === 'bookmarks') renderBookmarks(); });
  wb.on('download-updated', debounce(() => { if (view === 'downloads') renderDownloads(); }, 400));
  on('panel', (which) => toggle(which));
  on('panel-add-web', ({ url, title } = {}) => addWeb(url, title));
  renderStrip();
}
