// Bifrost browser UI — the toolbar (navigation buttons, address bar, ad blocker, extensions,
// downloads, menu) and the window caption buttons.
import { S, on, emit, activeTab, setting, accelFor, splitOf } from './state.js';
import { h, hostOf, isInternal, isNewTab, displayUrl, faviconEl, animate } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './menus.js';
import * as V from './views.js';
import * as T from './tabs.js';
import * as Omni from './omnibox.js';
import * as Tr from '/_/common/translate.js';

const wb = window.wb;
const D = window.WBDefaults;
const toolbarEl = document.getElementById('toolbar');
const hbarEl = document.getElementById('hbar');
let caption = null;
const btn = {};          // toolbar buttons by id
let titlePill = null;

function tbButton(id, iconName, title, onClick, extra = {}) {
  const b = h('button.tb-btn.no-drag', { type: 'button', title, 'aria-label': title, dataset: extra.panel ? { tb: id, panel: extra.panel } : { tb: id } }, icon(iconName));
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => onClick(e, b));
  // Right-click: the button's own menu if it has one, otherwise move it, remove it, or customize.
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (extra.onContext) extra.onContext(e, b); else showMenu(placementItems(b), { x: e.clientX, y: e.clientY });
  });
  if (extra.onAux) b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); extra.onAux(e, b); } });
  return b;
}
// Every copy of a button (one item can be on the toolbar and in the sidebar).
const all = (id) => document.querySelectorAll(`[data-tb="${id}"]`);

const tip = (label, cmd) => (accelFor(cmd) ? `${label} (${accelFor(cmd)})` : label);

const ITEMS = {
  back: () => tbButton('back', 'back', tip('Back', 'back'), (e) => navClick(e, 'back'), { onContext: (e, b) => historyMenu(b, -1), onAux: (e) => navClick(e, 'back') }),
  forward: () => tbButton('forward', 'forward', tip('Forward', 'forward'), (e) => navClick(e, 'forward'), { onContext: (e, b) => historyMenu(b, 1), onAux: (e) => navClick(e, 'forward') }),
  reload: () => tbButton('reload', 'reload', tip('Reload', 'reload'), (e) => {
    const t = activeTab();
    if (!t) return;
    if (t.loading) V.stopLoading(t); else V.reload(t, e.shiftKey || e.ctrlKey);
  }, { onContext: (e, b) => showMenu([
    { label: 'Reload', icon: 'reload', accel: accelFor('reload'), action: () => emit('command', 'reload') },
    { label: 'Reload, ignoring cache', icon: 'reload', accel: accelFor('hardReload'), action: () => emit('command', 'hardReload') },
    { label: 'Clear site data and reload', icon: 'trash', action: async () => { const t = activeTab(); if (t && !isInternal(t.url)) { await wb.invoke('site:clear-data', t.url); V.reload(t, true); } } },
    '-', ...placementItems(b, false),
  ], { anchor: b, side: 'bottom', align: 'start' }) }),
  home: () => tbButton('home', 'home', tip('Home', 'home'), () => emit('command', 'home')),
  newtab: () => tbButton('newtab', 'plus', tip('New tab', 'newTab'), () => emit('command', 'newTab', { source: 'button' })),
  split: () => tbButton('split', 'split', tip('Split view', 'splitWithNext'), (e, b) => splitMenu(b)),
  adblock: () => {
    const b = tbButton('adblock', 'shieldCheck', 'Ad and tracker blocking', (e, el) => emit('adblock-popover', el));
    b.append(h('span.tb-badge'));
    return b;
  },
  extensions: () => h('div#ext-actions.no-drag'),
  downloads: () => tbButton('downloads', 'download', tip('Downloads', 'panelDownloads'), (e, el) => emit('downloads-popover', el)),
  menu: () => tbButton('menu', 'menu', 'Menu', (e, el) => emit('app-menu', el)),
  spacer: () => h('div.tb-spacer'),
  divider: () => h('div.tb-divider'),
  address: () => {
    const { root, actions } = Omni.build();
    const zoom = h('button.addr-chip.zoom', { type: 'button', title: 'Zoom: click to reset', hidden: true, onclick: () => emit('command', 'zoomReset') });
    const star = h('button.addr-btn.star', { type: 'button', title: tip('Bookmark this page', 'bookmarkPage'), onclick: (e) => emit('bookmark-star', e.currentTarget) }, icon('star'));
    const splitB = h('button.addr-btn.splitb', { type: 'button', title: 'Split view', onclick: (e) => splitMenu(e.currentTarget) }, icon('split'));
    const readerB = h('button.addr-btn.readerb', { type: 'button', title: tip('Reader view', 'readerMode'), hidden: true, onclick: () => emit('command', 'readerMode') }, icon('reader'));
    // Shown on pages in another language than yours (and on translated ones, to go back); right-click
    // for another language or to stop offering for this one.
    const translateB = h('button.addr-btn.translateb', { type: 'button', hidden: true, onclick: () => emit('command', 'translatePage'), oncontextmenu: (e) => { e.preventDefault(); translateMenu(e.currentTarget); } }, icon('translate'));
    for (const b of [zoom, star, splitB, readerB, translateB]) b.addEventListener('mousedown', (e) => e.preventDefault());
    actions.append(translateB, readerB, zoom, splitB, star);
    btn.zoom = zoom; btn.star = star; btn.readerB = readerB; btn.translateB = translateB;
    titlePill = h('button.title-pill.no-drag', { type: 'button', title: tip('Edit the address', 'focusAddress'), onclick: () => emit('command', 'focusAddress') });
    titlePill.addEventListener('mousedown', (e) => e.preventDefault());
    return h('div.tb-address', null, root, titlePill);
  },
};

function navClick(e, dir) {
  const t = activeTab();
  if (!t) return;
  // Middle/Ctrl-click opens the previous page in a new tab.
  if (e.button === 1 || e.ctrlKey || e.metaKey) {
    const hist = t.history;
    if (!hist) return;
    const entry = hist.entries[hist.index + (dir === 'back' ? -1 : 1)];
    if (entry) T.openTab({ url: entry.url, active: !!e.shiftKey, opener: t });
    return;
  }
  if (dir === 'back') V.goBack(t); else V.goForward(t);
}

async function historyMenu(anchor, dir) {
  const t = activeTab();
  if (!t || t.wcId == null) return;
  let r;
  try { r = await V.guest(t, 'navigationEntries'); } catch { return; }
  const items = [];
  const list = dir < 0 ? r.entries.slice(0, r.index).reverse() : r.entries.slice(r.index + 1);
  list.slice(0, 16).forEach((en) => {
    const index = r.entries.indexOf(en);
    items.push({ label: en.title || displayUrl(en.url) || en.url, iconEl: faviconEl(en.url, '', icon, 'mi-fav'), action: () => V.guest(t, 'goToIndex', { index }).catch(() => {}) });
  });
  items.push('-', { label: 'Show full history', icon: 'clock', action: () => emit('command', 'openHistory') }, '-', ...placementItems(anchor, false));
  showMenu(items, { anchor, side: 'bottom', align: 'start' });
}

function splitMenu(anchor) {
  const t = activeTab();
  const sp = splitOf(t);
  showMenu(sp ? [
    { label: 'Rotate split view', icon: 'rotate', action: () => emit('command', 'splitRotate') },
    sp.tabIds.length < 4 ? { label: 'Add a new tab to the split', icon: 'plus', action: () => emit('command', 'splitNewTab') } : null,
    { label: 'Close split view', icon: 'close', action: () => emit('command', 'unsplit') },
  ] : [
    { label: 'Split with the next tab', icon: 'split', accel: accelFor('splitWithNext'), action: () => emit('command', 'splitWithNext') },
    { label: 'Split with a tab you choose…', icon: 'search', accel: accelFor('splitPick'), action: () => emit('command', 'splitPick') },
    { label: 'Split with a new tab', icon: 'plus', action: () => emit('command', 'splitNewTab') },
  ], { anchor, side: 'bottom', align: 'end' });
}

// Any item from WBDefaults.LAYOUT_ITEMS: the ones above, or a plain button that runs a command.
export function makeItem(id, zone = 'toolbar') {
  const meta = D.layoutItem(id);
  if (!meta || (meta.only && meta.only !== zone)) return null;
  if (ITEMS[id]) return ITEMS[id]();
  if (meta.cmd) {
    const label = id === 'sidebar' ? (zone === 'sidebar' ? 'Collapse the sidebar' : 'Show or hide the sidebar') : meta.label;
    const b = tbButton(id, meta.icon, tip(label, meta.cmd), () => emit('command', meta.cmd), { panel: meta.panel ? meta.cmd : null });
    if (id === 'sidebar' && zone === 'sidebar') b.classList.add('sb-toggle');
    return b;
  }
  return null;
}

// --------------------------------------------------------------- building
export function build() {
  for (const k of Object.keys(btn)) delete btn[k];
  const list = (setting('appearance.toolbar') || []).filter((id) => { const m = D.layoutItem(id); return m && m.only !== 'sidebar'; });
  if (!list.includes('address')) list.splice(Math.min(3, list.length), 0, 'address');
  // The menu has to be somewhere: if it isn't in the sidebar either, it goes at the end.
  const inSidebar = [...(setting('appearance.sidebarTop') || []), ...(setting('appearance.sidebarBottom') || [])].includes('menu');
  const horizontal = setting('appearance.tabLayout') === 'horizontal';
  if (!list.includes('menu') && (!inSidebar || horizontal)) list.push('menu');
  const left = h('div.tb-group.left');
  const right = h('div.tb-group.right');
  let past = false;
  const nodes = [];
  const seen = new Set();
  for (const id of list) {
    if (seen.has(id) && !D.layoutItem(id).multi) continue;
    seen.add(id);
    if (id === 'address') { past = true; nodes.push(ITEMS.address()); continue; }
    const el = makeItem(id, 'toolbar');
    if (el) (past ? right : left).append(el);
  }
  toolbarEl.replaceChildren(left, ...nodes, right);
  watchCenter();
  toolbarEl.oncontextmenu = (e) => {
    if (e.target.closest('.address, .tb-address, #ext-actions')) return;
    e.preventDefault();
    customizeMenu({ x: e.clientX, y: e.clientY });
  };
  placeCaption();
  update();
  centerAddress();
  emit('toolbar-built');
}

// ---------------------------------------------------------------- centring
// The address bar, or the title pill in its place, sits exactly in the middle of the toolbar (or of the whole
// window: appearance.address.position "center" / "window"), whatever is on either side of it: it's moved
// over and, if it has to be, made narrower, so it never covers a button. Only when the middle is too crowded
// for it to fit there does it settle as close to the middle as it fits. It follows every change: buttons
// added or removed, extension icons coming and going, the window's size, the window buttons.
let centerRO = null, centerRaf = 0;
const MIN_CENTERED = { pill: 160, bar: 320 };   // narrower than this, it moves off the middle instead
const MAX_WIDTH = { pill: 640, bar: 900 };      // as in browser.css

function watchCenter() {
  if (!centerRO) centerRO = new ResizeObserver(() => centerAddress());
  centerRO.disconnect();
  centerRO.observe(toolbarEl);
  const box = toolbarEl.querySelector('.tb-address');
  if (box) centerRO.observe(box);
}

export function scheduleCenter() {
  if (centerRaf) return;
  centerRaf = requestAnimationFrame(() => { centerRaf = 0; centerAddress(); });
}

export function centerAddress() {
  if (centerRaf) { cancelAnimationFrame(centerRaf); centerRaf = 0; }
  const box = toolbarEl.querySelector('.tb-address');
  if (!box) return;
  const bar = box.querySelector('.address');
  for (const el of [bar, titlePill]) if (el) { el.style.removeProperty('left'); el.style.removeProperty('max-width'); }
  const kind = document.documentElement.classList.contains('compact') ? 'pill' : 'bar';
  const el = kind === 'pill' ? titlePill : bar;
  box.dataset.centered = '';
  const pos = (setting('appearance.address') || {}).position || 'center';
  if (!el || (pos !== 'center' && pos !== 'window')) return;
  const tb = toolbarEl.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (!tb.width || !b.width) return;
  const cs = getComputedStyle(box);
  const L = b.left + (parseFloat(cs.paddingLeft) || 0), R = b.right - (parseFloat(cs.paddingRight) || 0);
  const free = Math.max(0, R - L);
  const mid = pos === 'window' ? document.documentElement.clientWidth / 2 : tb.left + tb.width / 2;
  // The widest it can be with its middle on the toolbar's, and how wide it would like to be.
  const room = Math.max(0, 2 * Math.min(mid - L, R - mid));
  const want = kind === 'pill' ? Math.min(MAX_WIDTH.pill, el.getBoundingClientRect().width) : MAX_WIDTH.bar;
  let w, at;
  if (room >= Math.min(want, MIN_CENTERED[kind])) { w = Math.min(MAX_WIDTH[kind], room); at = mid; box.dataset.centered = '1'; }
  else { w = Math.min(MAX_WIDTH[kind], free, Math.max(MIN_CENTERED[kind], room)); at = Math.min(R - w / 2, Math.max(L + w / 2, mid)); }
  el.style.maxWidth = Math.floor(w) + 'px';
  el.style.left = (at - (L + R) / 2).toFixed(2) + 'px';
}

// Menu items for one toolbar or sidebar button: remove it, move it to the other place, or customize.
const ZONE_PATHS = { toolbar: 'appearance.toolbar', top: 'appearance.sidebarTop', bottom: 'appearance.sidebarBottom' };
export function placementItems(el, header = true) {
  const id = el && el.dataset ? el.dataset.tb || (el.id === 'ws-button' ? 'workspace' : '') : '';
  const meta = id && D.layoutItem(id);
  const zone = !el ? '' : el.closest('#toolbar') ? 'toolbar' : el.closest('#sidebar-top') ? 'top' : el.closest('#sidebar-bottom') ? 'bottom' : '';
  const out = [];
  if (meta && zone) {
    const list = (z) => (setting(ZONE_PATHS[z]) || []).slice();
    const save = (z, v) => wb.invoke('settings:set', ZONE_PATHS[z], v);
    const removeFrom = (z) => { const cur = list(z); const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); return cur; };
    if (header) out.push({ type: 'header', label: meta.label });
    if (!meta.required) out.push({ label: zone === 'toolbar' ? 'Remove from the toolbar' : 'Remove from the sidebar', icon: 'eyeOff', action: () => save(zone, removeFrom(zone)) });
    const vertical = setting('appearance.tabLayout') !== 'horizontal';
    if (zone === 'toolbar' && meta.only !== 'toolbar' && vertical) {
      out.push({ label: 'Move to the sidebar', icon: 'sidebar', action: async () => { await save('toolbar', removeFrom('toolbar')); const b = list('bottom'); if (!b.includes(id) || meta.multi) b.push(id); save('bottom', b); } });
    } else if (zone !== 'toolbar' && meta.only !== 'sidebar') {
      out.push({ label: 'Move to the toolbar', icon: 'layout', action: async () => { await save(zone, removeFrom(zone)); const t = list('toolbar'); const at = t.indexOf('menu'); if (!t.includes(id) || meta.multi) t.splice(at < 0 ? t.length : at, 0, id); save('toolbar', t); } });
    }
    out.push('-');
  }
  out.push(
    { label: 'Customize toolbar and sidebar…', icon: 'layout', action: () => emit('command', 'customizeLayout') },
    { label: 'Sizes and corner rounding…', icon: 'ruler', action: () => emit('command', 'openSettings', { section: 'look' }) });
  return out;
}

export function customizeMenu(pos, extra = []) {
  showMenu([
    ...extra,
    { label: 'Customize toolbar and sidebar…', icon: 'layout', action: () => emit('command', 'customizeLayout') },
    { label: 'Sizes and corner rounding…', icon: 'ruler', action: () => emit('command', 'openSettings', { section: 'look' }) },
  ], pos);
}

// The caption area (window buttons) lives at the end of the top row.
function buildCaption() {
  const el = h('div#caption.no-drag');
  // Linux, and Windows windows made with an auto-hiding top bar (main/windows.js), draw their own buttons.
  if (((S.platform !== 'win32' && S.platform !== 'darwin') || S.ownCaption) && !setting('appearance.useSystemTitleBar')) {
    const send = (a) => () => wb.send('window:control', a);
    el.append(
      h('button.cap-btn', { type: 'button', title: 'Minimize', onclick: send('minimize') }, icon('minimize')),
      h('button.cap-btn.max', { type: 'button', title: 'Maximize', onclick: send('maximize') }, icon(S.maximized ? 'restore' : 'maximize')),
      h('button.cap-btn.close', { type: 'button', title: 'Close', onclick: send('close') }, icon('close')));
  }
  return el;
}

export function placeCaption() {
  if (!caption) caption = buildCaption();
  const horizontal = setting('appearance.tabLayout') === 'horizontal';
  const sideRight = setting('appearance.sidebarSide') === 'right';
  const top = horizontal ? hbarEl : sideRight && !setting('appearance.sidebarCollapsed') && !setting('appearance.sidebarAutoHide') ? document.getElementById('sidebar-top') : toolbarEl;
  if (caption.parentElement !== top) top.append(caption);
}

export function refreshCaption() {
  if (!caption) return;
  const max = caption.querySelector('.cap-btn.max');
  if (max) { max.replaceChildren(icon(S.maximized ? 'restore' : 'maximize')); max.title = S.maximized ? 'Restore' : 'Maximize'; }
}

// ----------------------------------------------------------------- update
export function update() {
  const t = activeTab();
  const url = t ? t.url : '';
  for (const b of all('back')) b.disabled = !(t && t.canGoBack);
  for (const b of all('forward')) b.disabled = !(t && t.canGoForward);
  const loading = !!(t && t.loading);
  for (const b of all('reload')) {
    if (b.dataset.state !== String(loading)) {
      b.dataset.state = String(loading);
      b.replaceChildren(icon(loading ? 'stop' : 'reload'));
      b.title = loading ? 'Stop loading' : tip('Reload', 'reload');
    }
  }
  const abs = all('adblock');
  if (abs.length) {
    const on = setting('privacy.adblock.enabled');
    const host = hostOf(url);
    const allowed = host && (setting('privacy.adblock.allowlist') || []).some((x) => host === x || host.endsWith('.' + x));
    const off = !on || allowed;
    const name = off ? 'shieldOff' : 'shieldCheck';
    const n = t && !off ? t.blocked || 0 : 0;
    for (const b of abs) {
      b.classList.toggle('off', !!off);
      if (b.dataset.icon !== name) { b.dataset.icon = name; b.firstChild.replaceWith(icon(name)); }
      b.querySelector('.tb-badge').textContent = n > 999 ? '999+' : n ? String(n) : '';
      b.title = off ? (on ? `Ad blocking is off for ${host}` : 'Ad blocking is off') : n ? `${n} ads and trackers blocked on this page` : 'Ad and tracker blocking';
    }
  }
  for (const b of all('vim')) b.classList.toggle('on', !!setting('keyboard.vim.enabled'));
  if (btn.zoom) {
    const z = t ? t.zoom || 0 : 0;
    btn.zoom.hidden = Math.abs(z) < 0.01;
    btn.zoom.textContent = Math.round(Math.pow(1.2, z) * 100) + '%';
  }
  if (btn.readerB) btn.readerB.hidden = !t || !/^https?:/i.test(url);
  if (btn.translateB) {
    const translated = !!t && Tr.isTranslated(url);
    btn.translateB.hidden = !translated && !offerTranslation(t);
    btn.translateB.classList.toggle('on', translated);
    btn.translateB.title = translated ? 'Show the original page' : tip(`Translate this page into ${Tr.languageName(targetLanguage())}`, 'translatePage');
  }
  if (titlePill) {
    if (document.documentElement.classList.contains('compact')) scheduleCenter();
    titlePill.replaceChildren(
      t ? faviconEl(url, t.favicon, icon, 'pill-fav') : '',
      h('span.pill-host', null, !t ? 'Search or enter an address' : isNewTab(url) ? 'New tab' : isInternal(url) ? (t.title || 'Bifrost') : hostOf(url).replace(/^www\./, '')),
      t && !isNewTab(url) && !isInternal(url) && t.title ? h('span.pill-title', null, t.title) : '');
  }
  Omni.refresh();
}

// ------------------------------------------------------------- translation
const targetLanguage = () => Tr.translateCode(setting('translate.target')) || Tr.translateCode(navigator.language) || 'en';
// A page that says it's in another language than the one you read (and that the translator can reach).
function offerTranslation(t) {
  if (!t || !setting('translate.offer') || !t.lang || !Tr.canTranslate(t.url)) return false;
  const lang = Tr.translateCode(t.lang);
  return !!lang && !Tr.sameLanguage(lang, targetLanguage()) && !(setting('translate.neverFor') || []).includes(lang);
}
const POPULAR = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh-CN', 'ar', 'hi', 'ta', 'tr'];
function translateMenu(anchor) {
  const t = activeTab();
  if (!t) return;
  if (Tr.isTranslated(t.url)) { showMenu([{ label: 'Show the original page', icon: 'translate', action: () => emit('command', 'translatePage') }, '-', { label: 'Translation settings…', icon: 'sliders', action: () => emit('command', 'openSettings', { section: 'languages' }) }], { anchor, side: 'bottom', align: 'end' }); return; }
  const target = targetLanguage();
  const lang = Tr.translateCode(t.lang);
  const others = [...new Set([target, ...POPULAR])].filter((c) => c !== lang);
  showMenu([
    { label: `Translate into ${Tr.languageName(target)}`, icon: 'translate', action: () => emit('command', 'translatePage') },
    { label: 'Translate into', submenu: others.map((c) => ({ label: Tr.languageName(c), action: () => emit('command', 'translatePage', { to: c }) })) },
    '-',
    lang ? { label: `Never offer to translate ${Tr.languageName(lang)}`, action: () => wb.invoke('settings:set', 'translate.neverFor', [...new Set([...(setting('translate.neverFor') || []), lang])]) } : null,
    { label: 'Translation settings…', icon: 'sliders', action: () => emit('command', 'openSettings', { section: 'languages' }) },
  ].filter(Boolean), { anchor, side: 'bottom', align: 'end' });
}

export function setStarred(on) {
  if (!btn.star) return;
  btn.star.classList.toggle('on', !!on);
  btn.star.title = on ? 'Edit bookmark' : tip('Bookmark this page', 'bookmarkPage');
}

// The visible copy of a toolbar/sidebar button (or the address bar's star/zoom/reader buttons).
export function button(id) {
  if (btn[id]) return btn[id];
  const els = [...all(id)];
  return els.find((e) => e.offsetParent) || els[0] || null;
}

export function bump(id) {
  const b = button(id);
  if (b) animate(b, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' }, 'toasts');
}

export function init() {
  build();
  on('active', () => update());
  on('workspace', () => update());
  on('tab', (t, patch) => {
    if (t !== activeTab()) return;
    if ('canGoBack' in patch || 'canGoForward' in patch || 'loading' in patch || 'blocked' in patch || 'zoom' in patch || 'url' in patch || 'title' in patch || 'favicon' in patch || 'lang' in patch) update();
  });
  on('settings', (path) => {
    if (!path || path.startsWith('appearance.toolbar') || path.startsWith('appearance.sidebarTop') || path.startsWith('appearance.sidebarBottom') || path === 'appearance' || path.startsWith('appearance.tabLayout') || path.startsWith('keyboard')) build();
    else if (path.startsWith('appearance')) { placeCaption(); update(); scheduleCenter(); }
    if (!path || path.startsWith('privacy') || path.startsWith('translate')) update();
  });
}
