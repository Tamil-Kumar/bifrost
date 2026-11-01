// Bifrost — the start page: clock, search, and Speed Dial tiles from a bookmark folder.
import {
  boot, wb, h, icon, get, set, command, openUrl, showMenu, popover, dialog, confirmDialog, toast,
  hostOf, hashColor, displayUrl, segmented, switchEl, page, closePopovers,
} from '/_/common/page.js';
import { renderModules, dataChanged, modulesDialog } from './modules.js';

const $ = (id) => document.getElementById(id);
let dial = { folder: null, items: [] };
let firstRender = true;

// ------------------------------------------------------------------ clock
// Its look comes from appearance.newTab.clock: 12/24 hours, seconds, blinking colons, a date line,
// font, size, weight, letter spacing and color.
const CLOCK_FONTS = {
  ui: 'var(--font)',
  thin: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  display: 'Bahnschrift, "DIN Alternate", "Segoe UI Variable Display", system-ui, sans-serif',
  rounded: '"Nunito", "SF Pro Rounded", "Segoe UI Variable Display", system-ui, sans-serif',
  serif: '"Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: 'var(--mono)',
};
let tickTimer = null, blinkTimer = null;
function clockCfg() { return Object.assign({}, window.WBDefaults.DEFAULTS.appearance.newTab.clock, get('appearance.newTab.clock') || {}); }

function tick() {
  clearTimeout(tickTimer);
  const c = clockCfg();
  const now = new Date();
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (c.seconds) opts.second = '2-digit';
  if (c.hours === '12') opts.hour12 = true;
  else if (c.hours === '24') { opts.hour12 = false; opts.hourCycle = 'h23'; }
  const parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(now);
  const time = $('time');
  // AM/PM gets a small margin instead of the full-width space the format puts before (or after) it.
  const dp = parts.findIndex((x) => x.type === 'dayPeriod');
  const ampmFirst = dp >= 0 && dp < parts.findIndex((x) => x.type === 'hour');
  time.replaceChildren(...parts.map((p, i) => {
    if (p.type === 'dayPeriod') return c.ampm ? h('span.ampm' + (ampmFirst ? '.first' : ''), null, p.value) : null;
    if (p.type === 'literal' && /[:.]/.test(p.value)) return h('span.sep', null, p.value);
    if (p.type === 'literal' && !p.value.trim()) return dp >= 0 && Math.abs(i - dp) === 1 ? null : ' ';
    return p.value;
  }).filter((x) => x !== null));
  // A trailing space left behind by a hidden AM/PM.
  if (time.lastChild && time.lastChild.nodeType === 3 && !time.lastChild.nodeValue.trim()) time.lastChild.remove();
  const date = $('clock-date');
  if (c.date && c.date !== 'none') {
    const fmt = c.date === 'short' ? { weekday: 'short', month: 'short', day: 'numeric' } : c.date === 'numeric' ? { year: 'numeric', month: 'numeric', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' };
    date.textContent = now.toLocaleDateString(undefined, fmt);
    date.hidden = false;
  } else date.hidden = true;
  const hr = now.getHours();
  const name = String(get('appearance.newTab.greetingName') || '').trim();
  $('greeting').textContent = (hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + name : '');
  const ms = now.getMilliseconds();
  // Blinking colons: on for the first half of each second, dimmed for the second. Done here rather than
  // with a CSS animation so it keeps working when animations are off (it's a clock setting, not an effect).
  clearTimeout(blinkTimer);
  time.classList.remove('dim');
  if (c.blink) blinkTimer = setTimeout(() => time.classList.add('dim'), Math.max(0, 500 - ms));
  tickTimer = setTimeout(tick, c.seconds || c.blink ? 1000 - ms + 10 : 60000 - (now.getSeconds() * 1000 + ms) + 20);
}

// Page areas, by the names used in settings (modules' "place" and the clock's "position").
const ZONES = () => ({
  above: $('z-above'), below: $('z-below'), left: $('z-left'), right: $('z-right'),
  'top-left': $('z-top-left'), top: $('z-top'), 'top-right': $('z-top-right'),
  'bottom-left': $('z-bottom-left'), bottom: $('z-bottom'), 'bottom-right': $('z-bottom-right'),
});
export const CLOCK_POSITIONS = [['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left'], ['center', 'Middle'], ['right', 'Right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right']];

function placeClock() {
  const pos = clockCfg().position || 'center';
  const el = $('clock');
  // A hidden clock waits in the main column, so it doesn't hold an area open.
  const zone = pos === 'center' || el.hidden ? $('clock-slot') : ZONES()[pos] || $('clock-slot');
  if (el.parentElement !== zone) zone.prepend(el);
  el.dataset.align = /left$/.test(pos) ? 'left' : /right$/.test(pos) ? 'right' : 'center';
  el.dataset.pos = pos;
}

// Lays the page out: modules into their areas, the main column's width, and one column when the window
// is too narrow for the side areas.
function layoutPage() {
  const n = get('appearance.newTab');
  const tile = { small: 84, medium: 108, large: 136 }[n.tileSize || 'medium'] || 108;
  const mainW = Math.max(640, Math.min(12, n.columns || 6) * (tile + 18));
  document.body.style.setProperty('--main-w', mainW + 'px');
  placeClock();
  renderModules(ZONES());
  fitWidth();
}
function fitWidth() {
  const sides = ['z-left', 'z-right', 'z-top-left', 'z-top-right', 'z-bottom-left', 'z-bottom-right'].some((id) => $(id).childElementCount);
  // Side columns need ~230px each next to a main column of at least ~480px.
  document.body.classList.toggle('has-sides', sides);
  document.body.classList.toggle('narrow', sides && innerWidth < 2 * 230 + 64 + 60 + 480);
  document.body.classList.toggle('has-top', ['z-top-left', 'z-top', 'z-top-right'].some((id) => $(id).childElementCount));
}
window.addEventListener('resize', debounceFit());
function debounceFit() { let t = null; return () => { clearTimeout(t); t = setTimeout(fitWidth, 80); }; }

function applyClock() {
  const c = clockCfg();
  const el = $('clock');
  const font = c.font === 'custom' ? (c.customFont || 'var(--font)') : CLOCK_FONTS[c.font] || CLOCK_FONTS.ui;
  el.style.setProperty('--clock-font', font);
  el.style.setProperty('--clock-scale', String(Math.max(0.4, Math.min(2.5, (Number(c.size) || 100) / 100))));
  el.style.setProperty('--clock-weight', String(Math.max(100, Math.min(900, Number(c.weight) || 300))));
  el.style.setProperty('--clock-spacing', (Math.max(-15, Math.min(40, Number(c.spacing) || 0)) / 100) + 'em');
  el.style.setProperty('--clock-color', c.color === 'accent' || c.color === 'gradient' ? 'var(--accent)' : c.color === 'custom' ? (c.customColor || 'var(--text)') : 'var(--text)');
  el.classList.toggle('grad', c.color === 'gradient');
  el.classList.toggle('blink', !!c.blink);
  el.dataset.ampm = ['small', 'medium', 'large'].includes(c.ampmSize) ? c.ampmSize : 'small';
  el.classList.toggle('tinted', c.color !== 'text');
  tick();
}

// --------------------------------------------------------------- options
function applyOptions() {
  const n = get('appearance.newTab');
  document.body.classList.remove('tiles-small', 'tiles-medium', 'tiles-large');
  document.body.classList.add('tiles-' + (n.tileSize || 'medium'));
  document.body.style.setProperty('--cols', String(Math.max(2, Math.min(12, n.columns || 6))));
  $('clock').hidden = !n.showClock && !n.showGreeting;
  $('time').hidden = !n.showClock;
  applyClock();
  layoutPage();
  $('greeting').hidden = !n.showGreeting;
  $('search').hidden = !n.showSearch;
  $('dial').hidden = n.showSpeedDial === false;
  document.body.classList.toggle('no-dial', n.showSpeedDial === false);
  // The customize button and the modules' ⋮ buttons can go; right-clicking does the same things.
  $('corner').hidden = n.customizeButton === false;
  document.body.classList.toggle('no-mod-more', n.moduleMenuButton === false);
  const bg = $('bg');
  bg.className = '';
  bg.style.backgroundImage = '';
  bg.style.filter = '';
  document.body.classList.toggle('on-image', false);
  if (n.background === 'gradient') bg.className = 'gradient';
  else if (n.background === 'image' && n.image) {
    bg.className = 'image';
    bg.style.backgroundImage = `url("bifrost://wallpaper/?v=${encodeURIComponent(n.image).slice(-40)}")`;
    bg.style.setProperty('--dim', String(n.imageDim ?? 0.35));
    if (n.imageBlur) bg.style.filter = `blur(${n.imageBlur}px)`;
    document.body.classList.add('on-image');
  }
  const map = window.WBDefaults.shortcutMap(page.settings);
  const acc = (map.launcher || [])[0];
  $('search-keys').replaceChildren(...(acc ? [h('kbd', null, acc)] : []));
}

// ----------------------------------------------------------------- tiles
// Tile icons come from the browser's icon finder (/_/favicon, see main/icons.js), which keeps each site's
// largest icon. Big icons fill the tile; a site that only has a small favicon gets it at close to its real
// size on a plate tinted with its color, instead of being stretched into a blurry block.
const iconRev = {};
const tileIcons = new Map();   // host -> [face elements], to refresh when a better icon arrives

function letterFor(b) {
  const host = hostOf(b.url).replace(/^www\./, '');
  const text = (b.title || '').trim() || (/^[\d.:[\]]+$/.test(host) ? '' : host) || '?';
  return text.charAt(0).toUpperCase();
}

// The average color of an icon's opaque pixels, for the plate behind small icons.
function tint(face, img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 12, 12);
    const d = g.getImageData(0, 0, 12, 12).data;
    let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 160) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
    if (n) face.style.setProperty('--plate', `rgb(${Math.round(r / n)} ${Math.round(gr / n)} ${Math.round(b / n)})`);
  } catch { /* a cross-origin fallback icon can't be sampled */ }
}

function faviconFor(b, face) {
  face.replaceChildren();
  face.classList.remove('icon-big', 'icon-small');
  const letter = () => { face.classList.remove('icon-big', 'icon-small'); return h('span.tile-letter', null, letterFor(b)); };
  const host = hostOf(b.url);
  if (!/^https?:/i.test(b.url || '') || !host) { face.append(letter()); return; }
  if (!tileIcons.has(host)) tileIcons.set(host, new Set());
  tileIcons.get(host).add(face);
  // The page's own favicon (as the tab showed it) is the fallback while the icon finder has nothing.
  const fallback = b.favicon && /^(https?|data):/i.test(b.favicon) ? b.favicon : '';
  const img = h('img.tile-icon', { alt: '', draggable: 'false', decoding: 'async' });
  let triedFallback = false;
  img.addEventListener('load', () => {
    const w = img.naturalWidth;
    const small = w > 0 && w < 48;
    face.classList.toggle('icon-small', small);
    face.classList.toggle('icon-big', !small);
    if (small) {
      const dpr = window.devicePixelRatio || 1;
      img.style.setProperty('--sz', Math.round(Math.max(16, Math.min(28, (w / dpr) * 1.25))) + 'px');
      tint(face, img);
    }
  });
  img.addEventListener('error', () => {
    if (!triedFallback && fallback) { triedFallback = true; img.src = fallback; return; }
    img.replaceWith(letter());
  });
  img.src = '/_/favicon?url=' + encodeURIComponent(b.url) + (iconRev[host.replace(/^www\./, '')] ? '&r=' + iconRev[host.replace(/^www\./, '')] : '');
  face.append(img);
}

function tile(b, i) {
  const color = `var(--${hashColor(hostOf(b.url) || b.title || '')})`;
  const face = h('span.tile-face');
  let el;
  if (b.type === 'folder') {
    face.append(icon('folder'));
    el = h('button.tile.enter', { type: 'button', title: b.title, style: { '--i': i, '--tc': 'var(--yellow)' } }, face, h('span.tile-label', null, b.title || 'Folder'));
    el.addEventListener('click', async () => {
      const kids = await wb.invoke('bookmarks:children', b.id);
      showMenu(kids.filter((k) => k.type !== 'separator').map((k) => ({
        label: k.title || displayUrl(k.url) || 'Untitled', icon: k.type === 'folder' ? 'folder' : 'globe',
        action: () => (k.type === 'folder' ? null : openUrl(k.url, { where: 'current' })),
      })), { anchor: face, side: 'bottom', align: 'center' });
    });
  } else {
    faviconFor(b, face);
    face._bm = b;
    el = h('a.tile.enter', { href: b.url, title: (b.title ? b.title + '\n' : '') + displayUrl(b.url), draggable: 'true', style: { '--i': i, '--tc': color } },
      face, h('span.tile-label', null, b.title || displayUrl(b.url)));
  }
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(b, { x: e.clientX, y: e.clientY }); });
  return el;
}

function tileMenu(b, pos) {
  const link = b.type === 'bookmark';
  showMenu([
    link ? { label: 'Open in new tab', icon: 'plus', action: () => openUrl(b.url, { background: true }) } : null,
    link ? { label: 'Open in new window', icon: 'window', action: () => openUrl(b.url, { newWindow: true }) } : null,
    link ? { label: 'Open in split view', icon: 'split', action: () => openUrl(b.url, { split: true }) } : null,
    link ? '-' : null,
    { label: 'Edit…', icon: 'edit', action: () => editTile(b) },
    { label: 'Remove', icon: 'trash', danger: true, action: async () => {
      if (b.type === 'folder' && !(await confirmDialog(`Remove the folder “${b.title}” and everything in it?`, { ok: 'Remove', danger: true }))) return;
      await wb.invoke('bookmarks:remove', b.id);
      toast({ text: `Removed “${b.title || displayUrl(b.url)}”`, iconName: 'trash' });
    } },
  ], pos);
}

async function editTile(b) {
  const isNew = !b;
  const name = h('input.field', { type: 'text', autofocus: true, placeholder: 'Name' });
  const url = h('input.field', { type: 'text', placeholder: 'https://…', spellcheck: 'false' });
  name.value = b ? b.title || '' : '';
  url.value = b ? b.url || '' : '';
  const body = h('div.form', null,
    h('label.dialog-field', null, h('span', null, 'Name'), name),
    !b || b.type === 'bookmark' ? h('label.dialog-field', null, h('span', null, 'Address'), url) : null);
  const ok = await dialog({ title: isNew ? 'Add a site' : 'Edit', iconName: isNew ? 'plus' : 'edit', body, buttons: [{ label: 'Cancel', value: false }, { label: isNew ? 'Add' : 'Save', value: true, primary: true }], dismissValue: false, width: 440 });
  if (!ok) return;
  let u = url.value.trim();
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    if (isNew) {
      if (!u) return;
      const parentId = dial.folder ? dial.folder.id : 2;
      await wb.invoke('bookmarks:create', { parentId, title: name.value.trim() || hostOf(u).replace(/^www\./, ''), url: u });
    } else {
      await wb.invoke('bookmarks:update', b.id, { title: name.value.trim(), url: b.type === 'bookmark' ? u : undefined });
    }
  } catch (e) { toast({ text: e.message, iconName: 'warn' }); }
}

async function render() {
  const box = $('dial');
  const items = (dial.items || []).filter((b) => b.type !== 'separator');
  const els = items.map((b, i) => tile(b, i));
  const add = h('button.tile.add.enter', { type: 'button', title: 'Add a site', style: { '--i': items.length } }, h('span.tile-face', null, icon('plus')), h('span.tile-label', null, 'Add'));
  add.addEventListener('click', () => editTile(null));
  if (!items.length) {
    const top = await wb.invoke('history:top', 8).catch(() => []);
    const empty = h('div#dial-empty.enter', null,
      h('p', null, dial.folder ? `Sites in “${dial.folder.title}” show up here.` : 'Your favorite sites show up here.'),
      top.length ? h('div.suggest', null, top.filter((x) => /^https?:/.test(x.url)).slice(0, 6).map((x) => h('button.chip.accent', {
        type: 'button', title: x.url,
        onclick: () => wb.invoke('bookmarks:create', { parentId: dial.folder ? dial.folder.id : 2, title: x.title || hostOf(x.url), url: x.url }),
      }, icon('plus'), x.title ? x.title.slice(0, 28) : hostOf(x.url)))) : null);
    box.replaceChildren(empty, add);
  } else {
    box.replaceChildren(...els, add);
  }
  if (!firstRender) for (const el of box.querySelectorAll('.enter')) el.classList.remove('enter');
  firstRender = false;
}

async function load() {
  dial = await wb.invoke('bookmarks:speed-dial').catch(() => ({ folder: null, items: [] }));
  render();
}

// ------------------------------------------------------------- customize
// A 3×3 grid of buttons: where the clock goes.
function clockPositionPicker() {
  const box = h('div.pos-grid', { role: 'radiogroup', 'aria-label': 'Clock position' });
  const draw = () => {
    const cur = clockCfg().position || 'center';
    box.replaceChildren(...CLOCK_POSITIONS.map(([p, label]) => h('button.pos' + (p === cur ? '.on' : ''), { type: 'button', title: label, 'aria-label': label, dataset: { pos: p }, onclick: async () => { await set('appearance.newTab.clock.position', p); draw(); } }, h('i'))));
  };
  draw();
  return box;
}

// At the customize button, or (with that button turned off) where the page was right-clicked.
function customize(at) {
  const n = () => get('appearance.newTab');
  const row = (label, ctl) => h('div.srow', null, h('div.srow-label', null, h('b', null, label)), h('div.srow-ctl', null, ctl));
  const body = h('div', { style: { width: '320px' } },
    h('div.card-title', null, 'Start page'),
    row('Clock', switchEl(n().showClock, (v) => set('appearance.newTab.showClock', v))),
    row('Seconds', switchEl(clockCfg().seconds, (v) => set('appearance.newTab.clock.seconds', v))),
    row('Hours', segmented([['auto', 'Auto'], ['12', '12'], ['24', '24']], clockCfg().hours, (v) => set('appearance.newTab.clock.hours', v))),
    row('AM/PM', segmented([['off', 'Off'], ['small', 'S'], ['medium', 'M'], ['large', 'L']], clockCfg().ampm === false ? 'off' : clockCfg().ampmSize || 'small',
      async (v) => { if (v === 'off') await set('appearance.newTab.clock.ampm', false); else { await set('appearance.newTab.clock.ampmSize', v); await set('appearance.newTab.clock.ampm', true); } })),
    row('Blinking colons', switchEl(clockCfg().blink, (v) => set('appearance.newTab.clock.blink', v))),
    row('Clock position', clockPositionPicker()),
    row('Clock size', (() => {
      const r = h('input', { type: 'range', min: '50', max: '200', step: '5', style: { width: '130px', accentColor: 'var(--accent)' } });
      r.value = String(clockCfg().size);
      let t = null;
      r.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set('appearance.newTab.clock.size', Number(r.value)), 80); });
      return r;
    })()),
    row('Greeting', switchEl(n().showGreeting, (v) => set('appearance.newTab.showGreeting', v))),
    row('Search box', switchEl(n().showSearch, (v) => set('appearance.newTab.showSearch', v))),
    row('Speed Dial', switchEl(n().showSpeedDial !== false, (v) => set('appearance.newTab.showSpeedDial', v))),
    row('Background', segmented([['none', 'None'], ['gradient', 'Glow'], ['image', 'Image']], n().background, async (v) => {
      if (v === 'image' && !n().image) {
        const p = await wb.invoke('settings:pick-image').catch(() => null);
        if (!p) return;
        await set('appearance.newTab.image', p);
      }
      set('appearance.newTab.background', v);
    })),
    row('Tile size', segmented([['small', 'S'], ['medium', 'M'], ['large', 'L']], n().tileSize, (v) => set('appearance.newTab.tileSize', v))),
    row('Module ⋮ buttons', switchEl(n().moduleMenuButton !== false, (v) => set('appearance.newTab.moduleMenuButton', v))),
    row('This button', switchEl(n().customizeButton !== false, (v) => set('appearance.newTab.customizeButton', v))),
    h('p.cust-note', null, 'Without them, right-click a module or the page for the same menus.'),
    h('div.btn-row', { style: { marginTop: '10px' } },
      h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('settings:pick-image').catch(() => null); if (p) { await set('appearance.newTab.image', p); set('appearance.newTab.background', 'image'); } } }, icon('camera'), 'Choose image…'),
      h('button.btn.small.primary', { type: 'button', onclick: () => { closePopovers(); modulesDialog(); } }, icon('grid'), 'Modules…'),
      h('button.btn.small', { type: 'button', onclick: () => command('openSettings', { section: 'clock' }) }, icon('clock'), 'Clock style…'),
      h('button.btn.small', { type: 'button', onclick: () => command('openSettings', { section: 'newtab' }) }, icon('sliders'), 'More')));
  popover(body, at instanceof Element && !$('corner').hidden ? { anchor: at, side: 'top', align: 'end' } : at instanceof Element ? { x: window.innerWidth - 16, y: window.innerHeight - 14, flipX: window.innerWidth - 16 } : at);
}

// ------------------------------------------------------------------ start
await boot({ title: 'New tab', onSettings: (p) => { if (!p || p.startsWith('appearance') || p.startsWith('keyboard')) applyOptions(); if (p.startsWith('appearance.newTab.speedDialFolder')) load(); } });
$('search-lens').append(icon('search'));
const sb = $('search-box');
sb.addEventListener('click', () => command('launcher', { text: '' }));
sb.addEventListener('keydown', (e) => {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); command('launcher', { text: e.key }); }
  else if (e.key === 'Enter') { e.preventDefault(); command('launcher', { text: '' }); }
});
$('corner').append(h('button.icon-btn', { type: 'button', title: 'Customize this page', onclick: (e) => customize(e.currentTarget) }, icon('sliders')));
applyOptions();
load();
wb.on('bookmarks-changed', () => { load(); if (document.querySelector('.mod[data-mod="folder"]')) renderModules(ZONES()); });
wb.on('ntp-data', ({ key }) => dataChanged(key));
// Right-click on the page itself: the clock's place and the modules.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.mod, .tile, #search, input, textarea, a, button')) return;
  e.preventDefault();
  showMenu([
    { label: 'Modules…', icon: 'grid', action: () => modulesDialog() },
    { label: 'Move the clock', icon: 'clock', submenu: () => CLOCK_POSITIONS.map(([p, label]) => ({ label, checked: (clockCfg().position || 'center') === p, action: () => set('appearance.newTab.clock.position', p) })) },
    '-',
    { label: 'Customize this page…', icon: 'sliders', action: () => customize($('corner').hidden ? { x: e.clientX, y: e.clientY } : $('corner').firstChild) },
  ], { x: e.clientX, y: e.clientY });
});
// A better icon was found for a site: redraw its tiles.
wb.on('site-icon', ({ host }) => {
  const key = String(host || '');
  iconRev[key] = (iconRev[key] || 0) + 1;
  for (const [h2, faces] of tileIcons) {
    if (h2.replace(/^www\./, '') !== key) continue;
    for (const face of faces) { if (face.isConnected && face._bm) faviconFor(face._bm, face); else faces.delete(face); }
  }
});
