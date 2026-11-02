// Bifrost — Settings. Every option is a row bound to a settings path; rows update in place when
// settings change anywhere (another window, the menu, a keyboard shortcut).
import {
  boot, wb, h, icon, page, get, set, segmented, switchEl, confirmDialog, promptDialog, dialog, toast, command, debounce, showMenu, openUrl,
} from '/_/common/page.js';
import { animate, anim, timeAgo } from '/_/common/util.js';
import { layoutEditor } from './layout-editor.js';
import { importExtensionsDialog, importExtensionsMenu } from '/_/common/import-extensions.js';
import { LANGUAGES, languageName, translateCode } from '/_/common/translate.js';

const D = window.WBDefaults;
// Translate into: the language Windows uses, or any other (by name).
function translateTargets() {
  const sys = translateCode(navigator.language) || 'en';
  const named = LANGUAGES.map((c) => [c, languageName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  return [['', `Your computer’s language (${languageName(sys)})`], ...named];
}
const THEMES = window.WBThemes.THEMES;
const $ = (id) => document.getElementById(id);
const items = [];        // { el, update(settings), text, sectionId }
const restartPaths = new Set();
let redrawShortcuts = null;

// ---------------------------------------------------------------- rows
function row(label, desc, ctl, opts = {}) {
  const el = h('div.srow' + (opts.stack ? '.stack' : ''), { dataset: opts.path ? { path: opts.path } : null },
    h('div.srow-label', null, h('b', null, label), desc ? h('small', null, desc) : null),
    ctl ? h('div.srow-ctl', { style: opts.stack ? { display: 'block' } : null }, ctl) : null);
  return el;
}

function register(el, update, text, when) {
  const it = { el, update: (s) => { if (when) el.classList.toggle('disabled', !when(s)); update && update(s); }, text: (text || '').toLowerCase() };
  items.push(it);
  return el;
}

function markRestart(path) {
  restartPaths.add(path);
  showRestart();
}

// A list editor redraws when its setting changes, except while you're typing in one of its fields (that
// would throw away what you're typing). A button or checkbox that has focus after a click doesn't count.
function typingIn(box) {
  const a = document.activeElement;
  return !!a && box.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|range|color)$/i.test(a.type)));
}
const save = (path, value, restart) => {
  set(path, value).catch((e) => toast({ text: e.message, iconName: 'warn' }));
  if (restart) markRestart(path);
};

// What each setting row edits (path, kind, the values it offers), for Bifrost's own automated checks
// that every setting does something.
const META = [];
window.__settingsMeta = META;

// Item builders. Each returns a row element and registers how to refresh it.
const I = {
  toggle(path, label, desc, o = {}) {
    META.push({ path, kind: 'toggle', label });
    let input;
    const sw = switchEl(get(path), (v) => save(path, v, o.restart), { label });
    input = sw.querySelector('input');
    return register(row(label, desc, sw, { path }), () => { input.checked = !!get(path); }, label + ' ' + (desc || '') + ' ' + (o.keywords || ''), o.when);
  },
  select(path, label, desc, options, o = {}) {
    META.push({ path, kind: 'select', label, options: options.map((x) => x[0]) });
    const sel = h('select.field', null, options.map(([v, l]) => h('option', { value: String(v) }, l)));
    sel.value = String(get(path));
    sel.addEventListener('change', () => save(path, o.number ? Number(sel.value) : sel.value, o.restart));
    return register(row(label, desc, sel, { path }), () => { sel.value = String(get(path)); }, label + ' ' + (desc || '') + ' ' + (o.keywords || ''), o.when);
  },
  seg(path, label, desc, options, o = {}) {
    META.push({ path, kind: 'seg', label, options: options.map((x) => x[0]) });
    const box = h('div');
    const draw = () => box.replaceChildren(segmented(options, get(path), (v) => save(path, v, o.restart)));
    draw();
    return register(row(label, desc, box, { path }), draw, label + ' ' + (desc || '') + ' ' + options.map((x) => x[1]).join(' ') + ' ' + (o.keywords || ''), o.when);
  },
  range(path, label, desc, { min, max, step, fmt = (v) => String(v), live = true, when, keywords = '' } = {}) {
    META.push({ path, kind: 'range', label, min, max, step });
    const input = h('input', { type: 'range', min, max, step });
    const out = h('output');
    const show = () => { out.textContent = fmt(Number(input.value)); };
    input.value = String(get(path));
    show();
    const send = debounce(() => save(path, Number(input.value)), 120);
    input.addEventListener('input', () => { show(); if (live) send(); });
    input.addEventListener('change', () => { send.flush(); });
    return register(row(label, desc, h('div.range', null, input, out), { path }), () => { if (document.activeElement !== input) { input.value = String(get(path)); show(); } }, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  // A slider whose leftmost notch means "automatic" (stored as -1).
  autoRange(path, label, desc, { min, max, step = 1, unit = 'px', when, keywords = '', autoLabel = 'Auto' } = {}) {
    META.push({ path, kind: 'autoRange', label, min, max, step });
    const input = h('input', { type: 'range', min: min - step, max, step });
    const out = h('output');
    const read = () => { const v = get(path); return typeof v === 'number' && v >= 0 ? v : min - step; };
    const show = () => { const v = Number(input.value); out.textContent = v < min ? autoLabel : v + (unit ? ' ' + unit : ''); out.classList.toggle('auto', v < min); };
    input.value = String(read());
    show();
    const send = debounce(() => { const v = Number(input.value); save(path, v < min ? -1 : v); }, 120);
    input.addEventListener('input', () => { show(); send(); });
    input.addEventListener('change', () => send.flush());
    input.addEventListener('dblclick', () => { input.value = String(min - step); show(); save(path, -1); });
    const el = row(label, desc, h('div.range', { title: 'Double-click to go back to automatic' }, input, out), { path });
    return register(el, () => { if (document.activeElement !== input) { input.value = String(read()); show(); } }, label + ' ' + (desc || '') + ' size spacing padding ' + keywords, when);
  },
  number(path, label, desc, { min, max, step = 1, when, keywords = '' } = {}) {
    META.push({ path, kind: 'number', label, min, max, step });
    const input = h('input.field.num', { type: 'number', min, max, step });
    input.value = String(get(path));
    input.addEventListener('change', () => {
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = get(path);
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      input.value = String(v);
      save(path, v);
    });
    return register(row(label, desc, input, { path }), () => { if (document.activeElement !== input) input.value = String(get(path)); }, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  text(path, label, desc, { placeholder = '', wide = false, when, restart, keywords = '', mono = false } = {}) {
    const input = h('input.field' + (wide ? '' : '.short') + (mono ? '.mono' : ''), { type: 'text', placeholder, spellcheck: 'false' });
    input.value = get(path) || '';
    const commit = () => { if (input.value !== (get(path) || '')) save(path, input.value, restart); };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return register(row(label, desc, input, { path, stack: wide }), () => { if (document.activeElement !== input) input.value = get(path) || ''; }, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  textarea(path, label, desc, { placeholder = '', rows = 6, when, keywords = '' } = {}) {
    const ta = h('textarea.field.mono', { rows, placeholder, spellcheck: 'false' });
    ta.value = get(path) || '';
    const send = debounce(() => save(path, ta.value), 500);
    ta.addEventListener('input', send);
    ta.addEventListener('blur', () => send.flush());
    return register(row(label, desc, ta, { path, stack: true }), () => { if (document.activeElement !== ta) ta.value = get(path) || ''; }, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  color(path, label, desc, { when } = {}) {
    const input = h('input.color', { type: 'color' });
    input.value = get(path) || '#cba6f7';
    input.addEventListener('input', debounce(() => save(path, input.value), 80));
    return register(row(label, desc, input, { path }), () => { input.value = get(path) || '#cba6f7'; }, label + ' ' + (desc || ''), when);
  },
  // A list of strings, one per line in a small editor.
  list(path, label, desc, { placeholder = '', when, keywords = '' } = {}) {
    const box = h('div.elist');
    const draw = () => {
      const list = (get(path) || []).slice();
      box.replaceChildren(
        ...list.map((v, i) => {
          const input = h('input.field.grow', { type: 'text', spellcheck: 'false', placeholder });
          input.value = v;
          input.addEventListener('change', () => { const next = (get(path) || []).slice(); next[i] = input.value.trim(); save(path, next.filter(Boolean)); });
          return h('div.erow', null, input, h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => { const next = (get(path) || []).slice(); next.splice(i, 1); save(path, next); } }, icon('close')));
        }),
        h('div', null, h('button.btn.small', { type: 'button', onclick: () => { const next = (get(path) || []).slice(); next.push(''); save(path, next.concat()); setTimeout(() => { const ins = box.querySelectorAll('input'); if (ins.length) ins[ins.length - 1].focus(); }, 80); } }, icon('plus'), 'Add')));
    };
    draw();
    return register(row(label, desc, box, { path, stack: true }), () => { if (!typingIn(box)) draw(); }, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  custom(label, desc, build, { stack = true, keywords = '', when } = {}) {
    const { el: ctl, update } = build();
    return register(row(label, desc, ctl, { stack }), update, label + ' ' + (desc || '') + ' ' + keywords, when);
  },
  button(label, desc, btnLabel, action, { iconName, keywords = '', danger = false } = {}) {
    const b = h('button.btn' + (danger ? '.danger' : ''), { type: 'button', onclick: action }, iconName ? icon(iconName) : null, btnLabel);
    return register(row(label, desc, b), null, label + ' ' + (desc || '') + ' ' + keywords);
  },
  note(text) { return register(h('p.status-line', null, text), null, ''); },
};

// ------------------------------------------------------------ appearance
function themePicker() {
  const grid = h('div.themes');
  const R = window.WBThemes.rgba;
  // The window lit by the theme's glows, as in the real thing, with its two accents on the current tab.
  const glowBg = (t) => {
    const g = t.glow || [t.accent, t.blue || t.accent, t.pink || t.accent];
    const k = (t.dark ? 1 : 0.85) * (t.glowAlpha || 1);
    return `radial-gradient(90% 80% at -10% 110%, ${R(g[0], 0.55 * k)}, transparent 70%), radial-gradient(80% 70% at 110% 110%, ${R(g[1], 0.45 * k)}, transparent 70%), radial-gradient(60% 50% at 25% 55%, ${R(g[2], 0.3 * k)}, transparent 70%), ${t.mantle}`;
  };
  const card = (key, name, t, dot) => {
    const prev = t ? h('div.theme-prev', { style: { background: glowBg(t) } },
      h('div.tp-sb', null, h('i', { style: { background: `linear-gradient(90deg, ${t.accent}, ${t.accent2 || t.accent})` } }), h('i', { style: { background: t.s1 } }), h('i', { style: { background: t.s1 } })),
      h('div.tp-pg', { style: { background: t.base } }, h('i', { style: { background: t.text, width: '70%' } }), h('i', { style: { background: t.overlay, width: '90%' } }), h('i', { style: { background: t.overlay, width: '55%' } })))
      : h('div.theme-prev', { style: { background: 'linear-gradient(135deg, ' + THEMES.latte.base + ' 50%, ' + THEMES.mocha.base + ' 50%)' } });
    const b = h('button.theme-card', { type: 'button', dataset: { key }, onclick: () => save('appearance.theme', key) },
      prev, h('span.theme-name', null, dot ? h('span.dot', { style: { background: t && t.accent2 ? `linear-gradient(135deg, ${dot}, ${t.accent2})` : dot } }) : null, name), h('span.check', null, icon('check')));
    return b;
  };
  const cards = [card('auto', 'Match the system', null, null), ...Object.entries(THEMES).map(([k, t]) => card(k, t.name, t, t.accent)),
    card('custom', 'Custom', Object.assign({}, THEMES.mocha, get('appearance.customTheme') || {}), (get('appearance.customTheme') || {}).accent || THEMES.mocha.accent)];
  grid.append(...cards);
  const update = () => { for (const c of grid.children) c.classList.toggle('on', c.dataset.key === get('appearance.theme')); };
  update();
  return { el: grid, update };
}

const PALETTE_KEYS = [['base', 'Background'], ['mantle', 'Window'], ['crust', 'Darkest'], ['s0', 'Surface'], ['s1', 'Surface 2'], ['s2', 'Surface 3'], ['overlay', 'Faint text'], ['subtext', 'Secondary text'], ['text', 'Text'], ['accent', 'Accent'], ['red', 'Red'], ['peach', 'Orange'], ['yellow', 'Yellow'], ['green', 'Green'], ['teal', 'Teal'], ['blue', 'Blue'], ['pink', 'Pink'], ['lavender', 'Lavender']];
function customPalette() {
  const grid = h('div.palette-grid');
  const draw = () => {
    const base = Object.assign({}, THEMES[get('appearance.darkTheme')] || THEMES.mocha, get('appearance.customTheme') || {});
    grid.replaceChildren(...PALETTE_KEYS.map(([k, label]) => {
      const input = h('input.color', { type: 'color' });
      input.value = base[k];
      input.addEventListener('change', () => {
        const cur = Object.assign({}, THEMES.mocha, get('appearance.customTheme') || {});
        delete cur.name; delete cur.key;
        cur[k] = input.value;
        cur.dark = window.WBThemes.hexToRgb(cur.base).reduce((a, b) => a + b, 0) < 384;
        save('appearance.customTheme', cur);
        if (get('appearance.theme') !== 'custom') save('appearance.theme', 'custom');
      });
      return h('label', null, input, label);
    }), h('div.span-all', null, h('button.btn.small', { type: 'button', onclick: () => {
      const src = THEMES[get('appearance.theme')] || THEMES.mocha;
      const copy = Object.assign({}, src); delete copy.name; delete copy.key;
      save('appearance.customTheme', copy); save('appearance.theme', 'custom');
      toast({ text: `Started a custom theme from ${src.name}`, iconName: 'palette' });
    } }, icon('copy'), 'Start from the current theme')));
  };
  draw();
  return { el: grid, update: () => { if (!typingIn(grid)) draw(); } };
}

// Quick looks for corner rounding: overall radius, and every element back to following it.
const SHAPE_KEYS = ['buttons', 'tabs', 'address', 'menus', 'page', 'tiles'];
const SIZE_KEYS = ['toolbarHeight', 'button', 'icon', 'buttonGap', 'address', 'tab', 'tabGap', 'sidebarPadding', 'pageGap', 'bookmarksBar', 'bookmarkPadding'];
function shapePresets() {
  const presets = [['Square', 0], ['Subtle', 5], ['Rounded', 10], ['Round', 16], ['Pill', 22]];
  const box = h('div.btn-row');
  const draw = () => box.replaceChildren(...presets.map(([name, r]) => {
    const on = get('appearance.radius') === r && SHAPE_KEYS.every((k) => get('appearance.shape.' + k) < 0);
    return h('button.btn.small.shape-preset' + (on ? '.on' : ''), { type: 'button', style: { '--pr': r + 'px' }, onclick: async () => {
      await set('appearance.radius', r);
      for (const k of SHAPE_KEYS) if (get('appearance.shape.' + k) >= 0) await set('appearance.shape.' + k, -1);
    } }, h('span.shape-swatch'), name);
  }));
  draw();
  return { el: box, update: draw };
}

function resetGroup(keys, base, what) {
  return async () => {
    if (!(await confirmDialog(`Put every ${what} back to automatic?`, { ok: 'Reset' }))) return;
    for (const k of keys) if (get(base + k) !== -1) await set(base + k, -1);
  };
}

async function removeOtherBookmarks() {
  const kids = await wb.invoke('bookmarks:children', 3).catch(() => []);
  let mode = 'move';
  if (kids.length) {
    mode = await dialog({
      title: 'Remove “Other bookmarks”?', iconName: 'folder', width: 470,
      body: h('p', null, `It has ${kids.length} item${kids.length === 1 ? '' : 's'} in it. Move ${kids.length === 1 ? 'it' : 'them'} to the end of the bookmarks bar, or delete ${kids.length === 1 ? 'it' : 'them'}?`),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Delete them', value: 'delete', danger: true }, { label: 'Move to the bar', value: 'move', primary: true }],
    });
    if (!mode) return;
    if (mode === 'delete' && !(await confirmDialog(`Delete ${kids.length} bookmark${kids.length === 1 ? '' : 's'} for good?`, { ok: 'Delete', danger: true }))) return;
  }
  const n = await wb.invoke('bookmarks:retire-other', mode);
  toast({ text: n ? (mode === 'move' ? `Moved ${n} item${n === 1 ? '' : 's'} to the bookmarks bar` : `Deleted ${n} item${n === 1 ? '' : 's'}`) : '“Other bookmarks” is gone from the bar', iconName: 'check' });
}

// --------------------------------------------------------- start page modules
function ntpModulesEditor() {
  const box = h('div.modlist');
  const list = () => (get('appearance.newTab.modules') || []).filter((m) => m && D.NTP_MODULES.some((x) => x.id === m.id));
  const draw = () => {
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    const on = list();
    box.replaceChildren(...D.NTP_MODULES.map((info) => {
      const cur = on.find((x) => x.id === info.id);
      const cb = h('input', { type: 'checkbox', checked: !!cur });
      const sel = h('select.field.select-sm', { disabled: !cur }, D.NTP_PLACES.map(([p, l]) => h('option', { value: p }, l)));
      sel.value = cur ? cur.place : 'below';
      cb.addEventListener('change', () => save(cb.checked ? list().concat([{ id: info.id, place: sel.value }]) : list().filter((m) => m.id !== info.id)));
      sel.addEventListener('change', () => save(list().map((m) => (m.id === info.id ? { id: m.id, place: sel.value } : m))));
      return h('div.modrow', { dataset: { mod: info.id } }, h('label.modrow-main', null, cb, h('span.mod-ico', null, icon(info.icon)), h('span', null, h('b', null, info.label), h('small', null, info.desc))), sel);
    }));
  };
  const save = (v) => set('appearance.newTab.modules', v).catch((e) => toast({ text: e.message, iconName: 'warn' }));
  draw();
  return { el: box, update: draw };
}

function folderPicker(path, none) {
  const sel = h('select.field');
  const fill = async () => {
    const tree = await wb.invoke('bookmarks:tree');
    const opts = [h('option', { value: '' }, none)];
    const walk = (n, depth) => {
      if (n.type !== 'folder') return;
      if (n.parentId != null) opts.push(h('option', { value: String(n.id) }, ' '.repeat(Math.max(0, depth - 1) * 3) + (n.title || 'Untitled folder')));
      for (const c of n.children || []) walk(c, depth + 1);
    };
    walk(tree, 0);
    sel.replaceChildren(...opts);
    sel.value = String(get(path) || '');
  };
  fill();
  sel.addEventListener('change', () => set(path, sel.value));
  wb.on('bookmarks-changed', fill);
  return { el: sel, update: () => { sel.value = String(get(path) || ''); } };
}

// ------------------------------------------------------------ performance
const PROFILES = [
  ['max', 'Maximum performance', 'bolt', 'Ignores memory use: tabs never sleep, background tabs run at full speed, every effect stays on.'],
  ['balanced', 'Balanced', 'layers', 'The default. Tabs sleep after 30 minutes unused; background tabs are slowed down a little.'],
  ['saver', 'Memory saver', 'moon', 'As little memory as possible: tabs sleep after 5 minutes (pinned ones too), no animations or blur, fewer processes.'],
  ['custom', 'Custom', 'sliders', 'Your own mix of everything below.'],
];
const PERF_KNOBS = [
  ['sleepEnabled', 'toggle', 'Put unused tabs to sleep', 'A sleeping tab frees its memory and reloads when you open it, with its back/forward history.'],
  ['sleepMinutes', 'range', 'After', '', { min: 1, max: 240, step: 1, fmt: (v) => v + ' min' }],
  ['sleepPinned', 'toggle', 'Pinned tabs can sleep too', ''],
  ['sleepAudible', 'toggle', 'Tabs playing sound can sleep too', ''],
  ['sleepOtherSpaces', 'toggle', 'Tabs in other spaces can sleep', ''],
  ['backgroundThrottling', 'toggle', 'Slow down tabs you aren’t looking at', 'Off runs background tabs at full speed (fully after a restart).', { restart: true }],
  ['animations', 'toggle', 'Animations', 'Off overrides Settings → Animations.'],
  ['lowVisuals', 'toggle', 'Fewer visual effects', 'No blur or soft shadows, no glow behind the start page.'],
  ['tabPreviews', 'toggle', 'Tab previews and thumbnails', ''],
  ['historyIndexSize', 'select', 'History kept in memory for the launcher', 'Older history is still searched, a moment later.', { options: [[2000, '2,000 pages'], [5000, '5,000 pages'], [10000, '10,000 pages'], [25000, '25,000 pages'], [50000, '50,000 pages'], [100000, '100,000 pages']] }],
  ['rendererLimit', 'select', 'Processes for pages', 'Fewer processes use less memory; sites then share them. Takes effect after a restart.', { restart: true, options: [[0, 'As many as needed'], [2, 'At most 2'], [4, 'At most 4'], [6, 'At most 6'], [8, 'At most 8'], [12, 'At most 12']] }],
];
const perfNow = () => D.perf(page.settings);
const isCustom = () => get('performance.profile') === 'custom';

function perfProfiles() {
  const box = h('div.perf-cards');
  const draw = () => {
    const cur = get('performance.profile') || 'balanced';
    box.replaceChildren(...PROFILES.map(([id, name, ic, desc]) => h('button.perf-card' + (id === cur ? '.on' : ''), {
      type: 'button', dataset: { profile: id },
      onclick: async () => {
        if (id === cur) return;
        const before = perfNow();
        await set('performance.profile', id);
        const after = perfNow();
        if (before.rendererLimit !== after.rendererLimit || before.backgroundThrottling !== after.backgroundThrottling) markRestart('performance.profile');
      },
    }, h('span.perf-ico', null, icon(ic)), h('b', null, name), h('small', null, desc), id === 'balanced' ? h('span.chip', null, 'Default') : null)));
  };
  draw();
  return { el: box, update: draw };
}

function perfUsage() {
  const out = h('span.status-line.perf-usage', null, '…');
  const sleepBtn = h('button.btn.small', { type: 'button', onclick: () => { command('sleepBackgroundTabs'); setTimeout(read, 1500); } }, icon('moon'), 'Put background tabs to sleep');
  const mb = (x) => (x >= 1024 ? (x / 1024).toFixed(1) + ' GB' : x + ' MB');
  async function read() {
    if (document.hidden) return;
    const u = await wb.invoke('perf:usage').catch(() => null);
    if (!u) return;
    out.replaceChildren(h('b', null, mb(u.total)), ` in ${u.processes} processes · pages ${mb(u.tabs)} · browser ${mb(u.browser)} · graphics ${mb(u.gpu)}` + (u.other ? ` · other ${mb(u.other)}` : ''));
  }
  read();
  setInterval(read, 3000);
  return { el: h('div.perf-usage-row', null, out, sleepBtn), update: null };
}

function perfKnobs() {
  const box = h('div.perf-knobs');
  const draw = () => {
    if (box.contains(document.activeElement) && isCustom()) return;
    const p = perfNow();
    const custom = isCustom();
    const save = (k, v, o) => { set('performance.custom.' + k, v); if (o && o.restart) markRestart('performance.custom.' + k); };
    const rows = PERF_KNOBS.map(([k, kind, label, desc, o = {}]) => {
      let ctl;
      const off = !custom || (k !== 'sleepEnabled' && k.startsWith('sleep') && !p.sleepEnabled);
      if (kind === 'toggle') ctl = switchEl(!!p[k], (v) => save(k, v, o), { label, disabled: off });
      else if (kind === 'range') {
        const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, disabled: off });
        const outp = h('output', null, o.fmt(p[k]));
        input.value = String(p[k]);
        const send = debounce(() => save(k, Number(input.value), o), 150);
        input.addEventListener('input', () => { outp.textContent = o.fmt(Number(input.value)); send(); });
        ctl = h('div.range', null, input, outp);
      } else {
        ctl = h('select.field', { disabled: off }, o.options.map(([v, l]) => h('option', { value: String(v) }, l)));
        ctl.value = String(p[k]);
        ctl.addEventListener('change', () => save(k, Number(ctl.value), o));
      }
      return h('div.srow' + (off ? '.disabled' : ''), { dataset: { knob: k } }, h('div.srow-label', null, h('b', null, label), desc ? h('small', null, desc) : null), h('div.srow-ctl', null, ctl));
    });
    const name = (PROFILES.find((x) => x[0] === (get('performance.profile') || 'balanced')) || PROFILES[1])[1];
    box.replaceChildren(
      custom ? h('p.status-line', null, 'Custom: change anything below.')
        : h('div.perf-note', null, h('span', null, `Set by “${name}”. `),
          h('button.link-btn', { type: 'button', onclick: async () => {
            // Start a custom profile from this one.
            const cur = perfNow();
            for (const [k] of PERF_KNOBS) await set('performance.custom.' + k, cur[k]);
            await set('performance.profile', 'custom');
          } }, 'Customize these…')),
      ...rows);
  };
  draw();
  return { el: box, update: draw };
}

// ------------------------------------------------------------- start page
function speedDialFolder() {
  const sel = h('select.field');
  const fill = async () => {
    const tree = await wb.invoke('bookmarks:tree');
    const opts = [h('option', { value: '' }, 'A folder named “Speed Dial”, else the bookmarks bar')];
    const walk = (n, depth) => {
      if (n.type !== 'folder') return;
      if (n.parentId != null) opts.push(h('option', { value: String(n.id) }, ' '.repeat(Math.max(0, depth - 1)) + (n.title || 'Untitled')));
      for (const c of n.children || []) walk(c, depth + 1);
    };
    walk(tree, 0);
    sel.replaceChildren(...opts);
    sel.value = String(get('appearance.newTab.speedDialFolder') || '');
  };
  fill();
  sel.addEventListener('change', () => save('appearance.newTab.speedDialFolder', sel.value));
  wb.on('bookmarks-changed', fill);
  return { el: sel, update: () => { sel.value = String(get('appearance.newTab.speedDialFolder') || ''); } };
}

function wallpaperPicker() {
  const label = h('span.status-line');
  const el = h('div.btn-row', null,
    h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('settings:pick-image'); if (p) { save('appearance.newTab.image', p); save('appearance.newTab.background', 'image'); } } }, icon('camera'), 'Choose an image…'),
    h('button.btn.small', { type: 'button', onclick: () => save('appearance.newTab.image', '') }, 'Remove'),
    label);
  const update = () => { const p = get('appearance.newTab.image'); label.textContent = p ? p.split(/[\\/]/).pop() : 'No image chosen'; };
  update();
  return { el, update };
}

// ------------------------------------------------------------ search
function enginesEditor() {
  const box = h('div.elist');
  const SUG = [['', 'No suggestions'], ['google', 'Google suggestions'], ['duckduckgo', 'DuckDuckGo suggestions']];
  const draw = () => {
    const list = get('search.engines') || [];
    const def = get('search.defaultEngine');
    const change = (i, patch) => { const next = JSON.parse(JSON.stringify(get('search.engines'))); Object.assign(next[i], patch); save('search.engines', next); };
    box.replaceChildren(
      h('div.erow.head', null, h('span', { style: { width: '24px' } }, ''), h('span.w-sm', null, 'Name'), h('span.w-key', null, 'Keyword'), h('span.grow', null, 'Address (%s is the search)'), h('span.w-sm', null, 'Suggestions'), h('span', { style: { width: '28px' } })),
      ...list.map((e, i) => {
        const radio = h('input', { type: 'radio', name: 'def-engine', checked: e.id === def, title: 'Default search engine' });
        radio.addEventListener('change', () => save('search.defaultEngine', e.id));
        const name = h('input.field.w-sm', { type: 'text', value: e.name });
        name.addEventListener('change', () => change(i, { name: name.value.trim() || e.name }));
        const kw = h('input.field.w-key', { type: 'text', value: e.keyword || '', spellcheck: 'false' });
        kw.addEventListener('change', () => change(i, { keyword: kw.value.trim().replace(/\s+/g, '') }));
        const url = h('input.field.grow.mono', { type: 'text', value: e.url, spellcheck: 'false' });
        url.addEventListener('change', () => {
          let v = url.value.trim();
          if (v && !v.includes('%s')) v += '%s';
          change(i, { url: v || e.url });
        });
        const sug = h('select.field.w-sm', null, SUG.map(([v, l]) => h('option', { value: v }, l)));
        sug.value = e.suggest || '';
        sug.addEventListener('change', () => change(i, { suggest: sug.value }));
        const del = h('button.icon-btn', { type: 'button', title: 'Remove', disabled: list.length < 2, onclick: () => {
          const next = list.filter((_, j) => j !== i);
          save('search.engines', next);
          if (e.id === def) save('search.defaultEngine', next[0].id);
        } }, icon('trash'));
        return h('div.erow', null, radio, name, kw, url, sug, del);
      }),
      h('div.btn-row', null,
        h('button.btn.small', { type: 'button', onclick: () => {
          const next = JSON.parse(JSON.stringify(get('search.engines')));
          next.push({ id: 'e' + Date.now().toString(36), name: 'New engine', keyword: '', url: 'https://example.com/search?q=%s', suggest: '' });
          save('search.engines', next);
        } }, icon('plus'), 'Add a search engine'),
        h('button.btn.small', { type: 'button', onclick: async () => { if (await confirmDialog('Reset search engines to the defaults?', { ok: 'Reset' })) { save('search.engines', D.DEFAULT_ENGINES); save('search.defaultEngine', 'google'); } } }, 'Reset to defaults')));
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

const SOURCES = [['bookmarks', 'Bookmarks', 'star'], ['tabs', 'Open tabs', 'window'], ['history', 'History', 'clock'], ['commands', 'Commands', 'bolt'], ['suggestions', 'Web suggestions', 'search']];
function sourcesEditor() {
  const box = h('div.elist');
  const draw = () => {
    box.replaceChildren(h('div.erow.head', null, h('span.grow', null, 'Source'), h('span.w-num', null, 'Weight'), h('span.w-num', null, 'Max results'), h('span', { style: { width: '40px' } }, 'On')),
      ...SOURCES.map(([k, label, ic]) => {
        const src = get('launcher.sources.' + k);
        const w = h('input.field.w-num', { type: 'number', step: '0.05', min: '0', max: '5', value: String(src.weight) });
        w.addEventListener('change', () => save(`launcher.sources.${k}.weight`, Math.max(0, Math.min(5, Number(w.value) || 0))));
        const m = h('input.field.w-num', { type: 'number', step: '1', min: '0', max: '50', value: String(src.max) });
        m.addEventListener('change', () => save(`launcher.sources.${k}.max`, Math.max(0, Math.min(50, Math.round(Number(m.value) || 0)))));
        return h('div.erow', null, h('span.grow', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, icon(ic), label), w, m, switchEl(src.enabled, (v) => save(`launcher.sources.${k}.enabled`, v)));
      }));
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

function prefixesEditor() {
  const box = h('div.elist');
  const draw = () => box.replaceChildren(...SOURCES.map(([k, label]) => {
    const input = h('input.field.w-key.mono', { type: 'text', maxlength: '3', value: get('launcher.prefixes.' + k) || '' });
    input.addEventListener('change', () => save('launcher.prefixes.' + k, input.value.trim()));
    return h('div.erow', null, input, h('span.grow', null, `Only ${label.toLowerCase()}`));
  }));
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

function boostsEditor(kind) {
  // kind: 'domains' ({domain, factor}) | 'folders' ({folder, factor})
  const key = kind === 'domains' ? 'domain' : 'folder';
  const box = h('div.elist');
  const draw = () => {
    const list = get('launcher.boosts.' + kind) || [];
    const change = (next) => save('launcher.boosts.' + kind, next);
    box.replaceChildren(...list.map((b, i) => {
      const name = h('input.field.grow', { type: 'text', value: b[key] || '', placeholder: kind === 'domains' ? 'github.com' : 'Folder name', spellcheck: 'false' });
      const f = h('input.field.w-num', { type: 'number', step: '0.1', min: '0', max: '10', value: String(b.factor) });
      const commit = () => { const next = JSON.parse(JSON.stringify(get('launcher.boosts.' + kind) || [])); next[i] = { [key]: name.value.trim(), factor: Math.max(0, Number(f.value) || 0) }; change(next); };
      name.addEventListener('change', commit);
      f.addEventListener('change', commit);
      return h('div.erow', null, name, h('span.muted', null, '×'), f, h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => change(list.filter((_, j) => j !== i)) }, icon('close')));
    }), h('div', null, h('button.btn.small', { type: 'button', onclick: () => change(list.concat([{ [key]: '', factor: kind === 'domains' ? 1.5 : 1.3 }])) }, icon('plus'), 'Add')),
    h('p.status-line', null, 'A factor above 1 lifts matches, below 1 lowers them, and 0 hides them.'));
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

function bookmarkFoldersEditor() {
  const box = h('div');
  const draw = async () => {
    const mode = get('launcher.bookmarkFolders.mode');
    const ids = (get('launcher.bookmarkFolders.ids') || []).map(Number);
    const seg = segmented([['all', 'All folders'], ['selected', 'Only the folders I pick']], mode, (v) => save('launcher.bookmarkFolders.mode', v));
    const list = h('div.elist', { style: { marginTop: '10px' } });
    if (mode === 'selected') {
      const tree = await wb.invoke('bookmarks:tree');
      const walk = (n, depth) => {
        if (n.type !== 'folder') return;
        if (n.parentId != null) {
          const cb = h('input', { type: 'checkbox', checked: ids.includes(n.id) });
          cb.addEventListener('change', () => {
            const cur = new Set((get('launcher.bookmarkFolders.ids') || []).map(Number));
            if (cb.checked) cur.add(n.id); else cur.delete(n.id);
            save('launcher.bookmarkFolders.ids', [...cur]);
          });
          list.append(h('label.check', { style: { marginLeft: depth * 18 + 'px', marginTop: '2px' } }, cb, icon('folder'), h('span', null, n.title || 'Untitled')));
        }
        for (const c of n.children || []) walk(c, depth + 1);
      };
      walk(tree, 0);
      list.append(h('p.status-line', null, 'Subfolders of a picked folder are searched too.'));
    }
    box.replaceChildren(seg, list);
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

// ------------------------------------------------------------ privacy
function adblockStatus() {
  const line = h('span.status-line');
  const btn = h('button.btn.small', { type: 'button' }, icon('reload'), 'Update filter lists now');
  const refresh = async () => {
    const s = await wb.invoke('adblock:status').catch(() => null);
    if (!s) { line.textContent = ''; return; }
    const lists = s.listsUpdated ? 'lists updated ' + new Date(s.listsUpdated).toLocaleString() : 'using the lists that came with Bifrost' + (s.bundled ? ' (' + new Date(s.bundled).toLocaleDateString() + ')' : '');
    line.textContent = `${s.enabled ? (s.ready ? 'Active' : s.loading ? 'Loading…' : 'Starting…') : 'Off'} · ${Number(s.total || 0).toLocaleString()} blocked so far · ${lists}`;
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    line.textContent = 'Downloading the latest lists…';
    try { await wb.invoke('adblock:update'); toast({ text: 'Filter lists updated', iconName: 'shieldCheck' }); }
    catch (e) { toast({ text: 'Couldn’t update the lists: ' + e.message, iconName: 'warn' }); }
    btn.disabled = false;
    refresh();
  });
  refresh();
  return { el: h('div.btn-row', { style: { alignItems: 'center' } }, btn, line), update: refresh };
}

function clearDataWidget() {
  const opts = [['history', 'Browsing history'], ['cookies', 'Cookies and site data'], ['cache', 'Cached images and files'], ['downloads', 'Download history'], ['closedTabs', 'Recently closed tabs']];
  const boxes = Object.fromEntries(opts.map(([k]) => [k, h('input', { type: 'checkbox', checked: k !== 'downloads' && k !== 'closedTabs' })]));
  const range = h('select.field', null, [['3600000', 'The last hour'], ['86400000', 'The last day'], ['604800000', 'The last week'], ['2419200000', 'The last 4 weeks'], ['0', 'All time']].map(([v, l]) => h('option', { value: v }, l)));
  range.value = '0';
  const btn = h('button.btn.danger', { type: 'button' }, icon('trash'), 'Clear data');
  btn.addEventListener('click', async () => {
    const what = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.checked]));
    if (!Object.values(what).some(Boolean)) return;
    const ms = Number(range.value);
    btn.disabled = true;
    try {
      await wb.invoke('app:clear-data', what, ms ? Date.now() - ms : 0);
      toast({ text: 'Browsing data cleared', iconName: 'check' });
    } catch (e) { toast({ text: 'Couldn’t clear everything: ' + e.message, iconName: 'warn' }); }
    btn.disabled = false;
  });
  const el = h('div', null,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '4px 16px' } }, opts.map(([k, l]) => h('label.check', null, boxes[k], h('span', null, l)))),
    h('div.btn-row', { style: { marginTop: '14px', alignItems: 'center' } }, h('span', null, 'From'), range, btn));
  return { el, update: null };
}

function sitesWidget() {
  const box = h('div');
  const draw = async () => {
    const all = await wb.invoke('site:all').catch(() => ({}));
    const hosts = Object.keys(all).sort();
    if (!hosts.length) { box.replaceChildren(h('p.status-line', null, 'Sites you give permissions, zoom levels or styles show up here.')); return; }
    box.replaceChildren(...hosts.map((host) => {
      const s = all[host];
      const tags = [];
      for (const [k, v] of Object.entries(s)) {
        if (k.startsWith('perm:')) tags.push(h('span.chip' + (v === 'allow' ? '.ok' : '.bad'), null, k.slice(5) + ': ' + v));
        else if (k === 'zoom') tags.push(h('span.chip', null, 'zoom ' + Math.round(Math.pow(1.2, v) * 100) + '%'));
        else if (k === 'css') tags.push(h('span.chip.accent', null, 'custom style'));
        else if (k === 'httpAllowed') tags.push(h('span.chip', null, 'plain HTTP allowed'));
      }
      const el = h('div.site', { id: 'site-' + host },
        h('div.site-head', null, h('span.site-host', null, host),
          s.css != null ? h('button.btn.small', { type: 'button', onclick: async () => {
            const v = await promptDialog({ title: `Style for ${host}`, label: 'CSS applied to every page on this site', value: s.css || '', multiline: true, mono: true, ok: 'Save' });
            if (v != null) { await wb.invoke('site:set', host, 'css', v.trim() ? v : null); draw(); }
          } }, icon('palette'), 'Style') : null,
          h('button.btn.small', { type: 'button', onclick: async () => { await wb.invoke('site:clear', host); draw(); toast({ text: `Reset ${host}`, iconName: 'check' }); } }, 'Reset')),
        h('div.site-tags', null, tags));
      return el;
    }));
  };
  draw();
  return { el: box, update: null, redraw: draw };
}

// ------------------------------------------------------------ downloads
function downloadFolder() {
  const label = h('code');
  const el = h('div.btn-row', { style: { alignItems: 'center' } }, label,
    h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('settings:pick-folder', 'Save downloads to'); if (p) save('downloads.folder', p); } }, icon('folderOpen'), 'Change…'),
    h('button.btn.small', { type: 'button', onclick: () => save('downloads.folder', '') }, 'Use the system folder'));
  const update = async () => { label.textContent = get('downloads.folder') || await wb.invoke('downloads:folder').catch(() => 'Downloads'); };
  update();
  return { el, update };
}

// ------------------------------------------------------------ keyboard
function shortcutsEditor() {
  const box = h('div');
  let recording = null;
  const accs = () => D.shortcutMap(page.settings);
  const conflicts = () => {
    const seen = new Map();
    const out = new Set();
    for (const [id, list] of Object.entries(accs())) for (const a of list || []) {
      const c = D.parseAccelerator(a);
      if (!c) continue;
      const k = D.chordToString(c);
      if (seen.has(k) && seen.get(k) !== id) { out.add(k); }
      seen.set(k, id);
    }
    return out;
  };
  const draw = () => {
    const map = accs();
    const over = get('keyboard.shortcuts') || {};
    const bad = conflicts();
    const byCat = new Map();
    for (const c of D.COMMANDS) { if (!byCat.has(c.category)) byCat.set(c.category, []); byCat.get(c.category).push(c); }
    const q = ($('settings-q').value || '').toLowerCase();
    box.replaceChildren(...[...byCat].map(([cat, cmds]) => {
      const rows = cmds.filter((c) => !q || c.title.toLowerCase().includes(q) || cat.toLowerCase().includes(q) || (map[c.id] || []).join(' ').toLowerCase().includes(q)).map((c) => {
        const list = map[c.id] || [];
        const chips = list.map((a, i) => {
          const parsed = D.parseAccelerator(a);
          const label = parsed ? D.chordToString(parsed) : a;
          return h('span.kb-chip' + (bad.has(label) ? '.conflict' : ''), { title: bad.has(label) ? 'Also used by another command' : '' }, label,
            h('button', { type: 'button', title: 'Remove', onclick: () => { const next = list.slice(); next.splice(i, 1); save('keyboard.shortcuts.' + c.id, next); } }, icon('close')));
        });
        const add = h('button.kb-add', { type: 'button' }, '+ Add');
        add.addEventListener('click', () => record(c.id, add));
        const reset = Object.prototype.hasOwnProperty.call(over, c.id) ? h('button.icon-btn.kb-reset', { type: 'button', title: 'Reset to default', onclick: () => {
          const next = Object.assign({}, get('keyboard.shortcuts'));
          delete next[c.id];
          save('keyboard.shortcuts', next);
        } }, icon('rotate')) : null;
        return h('div.kb-row', null, h('span.kb-title' + (reset ? '.changed' : ''), null, c.title), h('div.kb-keys', null, chips, add, reset));
      });
      if (!rows.length) return null;
      return h('div.kb-group', null, h('div.card-title', null, cat), h('div.card', null, rows));
    }), h('div.btn-row', null, h('button.btn.small', { type: 'button', onclick: async () => { if (await confirmDialog('Reset every keyboard shortcut to its default?', { ok: 'Reset all' })) save('keyboard.shortcuts', {}); } }, icon('rotate'), 'Reset all shortcuts')));
  };
  // Recording: the next key combination becomes a shortcut. Browser shortcuts are paused meanwhile.
  function record(id, btn) {
    if (recording) recording.stop();
    btn.classList.add('recording');
    btn.textContent = 'Press keys…';
    wb.send('kbd:capture', true);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(); return; }
      const chord = D.eventToChord(e);
      if (!chord.code) return;
      if (!chord.ctrl && !chord.alt && !chord.meta && !/^F\d+$/.test(chord.code) && !['Escape', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'BrowserBack', 'BrowserForward', 'MediaPlayPause'].includes(chord.code)) {
        toast({ text: 'Use a modifier (Ctrl, Alt, Shift+…) or a function key', iconName: 'keyboard', timeout: 2200 });
        return;
      }
      const acc = [chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', chord.meta && 'Meta', chord.code.replace(/^Key/, '').replace(/^Digit/, '')].filter(Boolean).join('+');
      const list = (D.shortcutMap(page.settings)[id] || []).slice();
      if (!list.includes(acc)) list.push(acc);
      stop();
      save('keyboard.shortcuts.' + id, list);
      const label = D.chordToString(chord);
      const other = D.COMMANDS.find((c) => c.id !== id && (D.shortcutMap(page.settings)[c.id] || []).some((a) => { const p = D.parseAccelerator(a); return p && D.chordToString(p) === label; }));
      if (other) toast({ text: `${label} is also bound to “${other.title}”. Remove one of them to avoid a clash.`, iconName: 'warn', timeout: 6000 });
    };
    function stop() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
      wb.send('kbd:capture', false);
      recording = null;
      draw();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    recording = { stop };
  }
  draw();
  redrawShortcuts = () => { if (!recording) draw(); };
  return { el: box, update: () => { if (!recording) draw(); } };
}

// Extensions' own shortcuts (their manifest "commands"). A shortcut you set here wins over Bifrost's.
function extShortcutsEditor() {
  const box = h('div');
  let recording = null;
  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const change = async (ext, c, acc) => {
    try { await wb.invoke('extensions:set-shortcut', ext.extensionId, c.name, acc); }
    catch (e) { toast({ text: clean(e), iconName: 'warn', timeout: 5000 }); }
    draw();
  };
  const commandRow = (ext, c) => {
    const tip = c.conflict === 'browser' ? 'Also a Bifrost shortcut; the extension gets it' : c.conflict === 'extension' ? 'Another extension uses it too' : '';
    const keys = c.shortcut
      ? h('span.kb-chip' + (c.conflict ? '.conflict' : ''), { title: tip }, c.shortcut, h('button', { type: 'button', title: 'Remove', onclick: () => change(ext, c, '') }, icon('close')))
      : h('span.kb-none', null, 'No shortcut');
    const btn = h('button.kb-add', { type: 'button' }, c.shortcut ? 'Change' : '+ Add');
    btn.addEventListener('click', () => record(ext, c, btn));
    const reset = c.changed ? h('button.icon-btn.kb-reset', { type: 'button', title: c.suggested ? 'Back to ' + c.suggested : 'Back to no shortcut', onclick: () => change(ext, c, null) }, icon('rotate')) : null;
    return h('div.kb-row', null, h('span.kb-title' + (c.changed ? '.changed' : ''), null, c.description), h('div.kb-keys', null, keys, btn, reset));
  };
  async function draw() {
    const list = await wb.invoke('extensions:shortcuts').catch(() => []);
    if (recording) return;
    if (!list.length) { box.replaceChildren(h('p.muted.small', { style: { margin: 0 } }, 'None of your extensions have keyboard shortcuts.')); return; }
    box.replaceChildren(...list.map((ext) => h('div.kb-group', null,
      h('div.card-title.kbx-head', null, ext.icon ? h('img.kbx-ico', { src: ext.icon, alt: '' }) : icon('puzzle'), ext.name),
      h('div.card', null, ext.commands.map((c) => commandRow(ext, c))))));
  }
  function record(ext, c, btn) {
    if (recording) recording.stop();
    btn.classList.add('recording');
    btn.textContent = 'Press keys…';
    wb.send('kbd:capture', true);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(); return; }
      const chord = D.eventToChord(e);
      if (!chord.code) return;
      if (!chord.ctrl && !chord.alt && !chord.meta && !/^F\d+$/.test(chord.code)) {
        toast({ text: 'Use Ctrl or Alt (with Shift if you like), or a function key', iconName: 'keyboard', timeout: 2400 });
        return;
      }
      const acc = [chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', chord.meta && 'Meta', chord.code.replace(/^Key/, '').replace(/^Digit/, '')].filter(Boolean).join('+');
      stop();
      change(ext, c, acc);
    };
    function stop() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
      wb.send('kbd:capture', false);
      recording = null;
      draw();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    recording = { stop };
  }
  draw();
  // Conflicts depend on Bifrost's own shortcuts, so settings changes redraw too.
  const redraw = debounce(() => { if (!recording) draw(); }, 200);
  wb.on('extensions-changed', redraw);
  return { el: box, update: redraw };
}

const VIM_NAMES = {
  scrollDown: 'Scroll down', scrollUp: 'Scroll up', scrollLeft: 'Scroll left', scrollRight: 'Scroll right', halfPageDown: 'Half page down', halfPageUp: 'Half page up', pageDown: 'Page down', pageUp: 'Page up',
  top: 'Top', bottom: 'Bottom', hints: 'Click a link', hintsNewTab: 'Link in new tab', hintsCopy: 'Copy a link', hintsSplit: 'Link in split view', back: 'Back', forward: 'Forward', reload: 'Reload',
  closeTab: 'Close tab', reopenTab: 'Reopen tab', nextTab: 'Next tab', prevTab: 'Previous tab', firstTab: 'First tab', lastTab: 'Last tab', launcher: 'Launcher', launcherNewTab: 'Launcher (new tab)', tabSearch: 'Search tabs',
  find: 'Find', findNext: 'Next match', findPrev: 'Previous match', copyUrl: 'Copy address', openClipboard: 'Open clipboard', openClipboardNewTab: 'Open clipboard (new tab)', focusInput: 'Focus text field',
  upUrl: 'Up a level', rootUrl: 'Site root', insertMode: 'Insert mode', passNext: 'Pass next key', help: 'Help',
};
function vimKeysEditor() {
  const box = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '6px 18px' } });
  const draw = () => {
    const keys = Object.assign({}, D.VIM_KEYS, get('keyboard.vim.keys') || {});
    box.replaceChildren(...Object.keys(D.VIM_KEYS).map((k) => {
      const input = h('input.field.w-key.mono', { type: 'text', value: keys[k] || '', placeholder: 'none', spellcheck: 'false' });
      input.addEventListener('change', () => { const next = Object.assign({}, get('keyboard.vim.keys')); next[k] = input.value.trim(); save('keyboard.vim.keys', next); });
      return h('div.erow', null, input, h('span.grow', null, VIM_NAMES[k] || k));
    }));
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

// ------------------------------------------------------------ advanced
function siteUAEditor() {
  const box = h('div.elist');
  const draw = () => {
    const list = get('advanced.siteUserAgents') || [];
    const change = (next) => save('advanced.siteUserAgents', next);
    box.replaceChildren(...list.map((r, i) => {
      const host = h('input.field.w-sm', { type: 'text', value: r.host || '', placeholder: 'accounts.google.com', spellcheck: 'false' });
      const ua = h('select.field.w-md', null, [['embedded', 'Bifrost (embedded Chromium)'], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['safari', 'Safari'], ['custom', 'Custom…']].map(([v, l]) => h('option', { value: v }, l)));
      const known = ['embedded', 'firefox', 'chrome', 'safari'].includes(r.ua);
      ua.value = known ? r.ua : 'custom';
      const custom = h('input.field.grow.mono', { type: 'text', value: known ? '' : r.ua || '', placeholder: 'Mozilla/5.0 …', hidden: known, spellcheck: 'false' });
      const commit = () => { const next = JSON.parse(JSON.stringify(get('advanced.siteUserAgents'))); next[i] = { host: host.value.trim(), ua: ua.value === 'custom' ? custom.value.trim() : ua.value }; change(next); };
      host.addEventListener('change', commit);
      ua.addEventListener('change', () => { custom.hidden = ua.value !== 'custom'; commit(); });
      custom.addEventListener('change', commit);
      return h('div.erow', null, host, ua, custom, h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => change(list.filter((_, j) => j !== i)) }, icon('close')));
    }), h('div', null, h('button.btn.small', { type: 'button', onclick: () => change(list.concat([{ host: '', ua: 'firefox' }])) }, icon('plus'), 'Add a site')));
  };
  draw();
  return { el: box, update: () => { if (!typingIn(box)) draw(); } };
}

// ------------------------------------------------------------ import & backup
function importWidget() {
  const box = h('div');
  const draw = async () => {
    box.replaceChildren(h('p.status-line', null, 'Looking for other browsers…'));
    let sources = [];
    try { sources = await wb.invoke('import:detect'); } catch (e) { box.replaceChildren(h('p.status-line', null, 'Couldn’t look for browsers: ' + e.message)); return; }
    if (!sources.length) { box.replaceChildren(h('p.status-line', null, 'No other browsers were found on this computer. You can still import a bookmarks file below.')); return; }
    box.replaceChildren(...sources.map((src) => {
      const bm = h('input', { type: 'checkbox', checked: true });
      const hist = h('input', { type: 'checkbox', checked: true });
      const exts = h('input', { type: 'checkbox', checked: false });
      const btn = h('button.btn.small.primary', { type: 'button' }, icon('import'), 'Import');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Importing…';
        try {
          if (bm.checked || hist.checked) {
            const r = await wb.invoke('import:run', src.id, { bookmarks: bm.checked, history: hist.checked });
            toast({ text: `Imported ${r.bookmarks || 0} bookmarks and ${r.history || 0} history entries from ${src.name}`, iconName: 'check', timeout: 6000 });
          }
          if (exts.checked) await importExtensionsDialog(src.id);
        } catch (e) { toast({ text: 'Import failed: ' + e.message, iconName: 'warn', timeout: 6000 }); }
        btn.disabled = false;
        btn.replaceChildren(icon('import'), 'Import');
      });
      return h('div.import-src', { dataset: { src: src.id } }, h('span.src-ico', null, icon(src.kind === 'firefox' ? 'globe' : 'compass')),
        h('div.src-main', null, h('b', null, src.name), h('small', null, src.detail || src.path || '')),
        h('div.src-what', null,
          h('label.check', { style: { margin: 0 } }, bm, h('span', null, 'Bookmarks')),
          h('label.check', { style: { margin: 0 } }, hist, h('span', null, 'History')),
          h('label.check', { style: { margin: 0 } }, exts, h('span', null, 'Extensions'))),
        btn);
    }));
  };
  draw();
  return { el: box, update: null };
}

function backupWidget() {
  const el = h('div.btn-row', null,
    h('button.btn.small', { type: 'button', onclick: async () => {
      try {
        const r = await wb.invoke('import:folder', { bookmarks: true, history: true });
        if (r) toast({ text: `Imported ${r.bookmarks || 0} bookmarks and ${r.history || 0} history entries`, iconName: 'check', timeout: 6000 });
      } catch (e) { toast({ text: 'Import failed: ' + e.message, iconName: 'warn', timeout: 6000 }); }
    } }, icon('folderOpen'), 'Import from a profile folder…'),
    h('button.btn.small', { type: 'button', onclick: async () => {
      try { const r = await wb.invoke('import:html'); if (r) toast({ text: `Imported ${r.bookmarks || 0} bookmarks`, iconName: 'check' }); } catch (e) { toast({ text: 'Import failed: ' + e.message, iconName: 'warn' }); }
    } }, icon('import'), 'Import a bookmarks file…'),
    h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('bookmarks:export-html').catch((e) => toast({ text: e.message, iconName: 'warn' })); if (p) toast({ text: 'Bookmarks exported', iconName: 'check' }); } }, icon('save'), 'Export bookmarks…'),
    h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('settings:export'); if (p) toast({ text: 'Settings exported', iconName: 'check' }); } }, icon('save'), 'Export settings…'),
    h('button.btn.small', { type: 'button', onclick: async () => {
      try { if (await wb.invoke('settings:import')) toast({ text: 'Settings imported', iconName: 'check' }); } catch (e) { toast({ text: e.message, iconName: 'warn' }); }
    } }, icon('import'), 'Import settings…'),
    h('button.btn.small.danger', { type: 'button', onclick: async () => { if (await confirmDialog('Reset every setting to its default?', { detail: 'Bookmarks, history and passwords are not affected.', ok: 'Reset settings', danger: true })) wb.invoke('settings:reset'); } }, icon('rotate'), 'Reset all settings'));
  return { el, update: null };
}

function aboutWidget() {
  const box = h('div');
  const draw = async () => {
    const info = await wb.invoke('app:info').catch(() => null);
    if (!info) return;
    box.replaceChildren(
      h('div.srow', null, h('div.srow-label', null, h('b', null, 'Default browser'), h('small', null, info.isDefault ? 'Bifrost opens your links.' : 'Another browser opens links from other apps.')),
        h('div.srow-ctl', null, info.isDefault ? h('span.chip.ok', null, icon('check'), 'Default') : h('button.btn.primary', { type: 'button', onclick: async () => { const r = await wb.invoke('app:make-default').catch((e) => ({ error: e.message })); if (r && r.error) toast({ text: r.error, iconName: 'warn' }); else if (r && r.manual) toast({ text: 'Choose Bifrost in the Default apps settings that just opened', iconName: 'info', timeout: 7000 }); setTimeout(draw, 1500); } }, 'Make default'))),
      h('div.srow', null, h('div.srow-label', null, h('b', null, 'Shortcuts'), h('small', null, 'Add Bifrost to the Start menu and desktop.')),
        h('div.srow-ctl', null, h('button.btn', { type: 'button', onclick: async () => { const r = await wb.invoke('app:install-shortcuts', { startMenu: true, desktop: true }).catch((e) => ({ error: e.message })); toast({ text: r && r.error ? r.error : 'Shortcuts added', iconName: r && r.error ? 'warn' : 'check' }); } }, 'Add shortcuts'))),
      h('div.srow', null, h('div.srow-label', null, h('b', null, 'Profile folder'), h('small', null, h('code', null, info.profile.dir), info.profile.portable ? ' (portable)' : '')),
        h('div.srow-ctl', null, h('button.btn', { type: 'button', onclick: () => wb.invoke('app:open-path', 'profile') }, icon('folderOpen'), 'Open'))),
      h('div.srow', null, h('div.srow-label', null, h('b', null, `Bifrost ${info.version}`), h('small', null, `Chromium ${info.chrome} · Electron ${info.electron} · ${info.platform} ${info.arch}` + (info.drm && info.drm.status === 'ready' && info.drm.version ? ` · Widevine ${info.drm.version}` : ''))),
        h('div.srow-ctl', null, h('button.btn', { type: 'button', onclick: () => command('openAbout') }, 'About'))));
  };
  draw();
  return { el: box, update: null };
}

// ------------------------------------------------------------ sync
let syncInfo = null;
const loadSyncInfo = () => wb.invoke('sync:info').then((s) => (syncInfo = s)).catch(() => null);
const syncListeners = new Set();
const pickSyncFolder = () => wb.invoke('settings:pick-folder', 'Choose a folder that OneDrive, Google Drive, Dropbox or iCloud keeps the same on your computers');
const samePath = (a, b) => String(a || '').replace(/[\\/]+$/, '').toLowerCase() === String(b || '').replace(/[\\/]+$/, '').toLowerCase();

// Turning sync on asks for a folder first if there isn't one.
function syncSwitch() {
  let input;
  const sw = switchEl(get('sync.enabled'), async (on) => {
    if (on && !get('sync.folder')) {
      const p = await pickSyncFolder();
      if (!p) { input.checked = false; return; }
      await set('sync.folder', p);
    }
    await set('sync.enabled', on);
    if (on) toast({ text: 'Sync is on. On your other computer, turn it on with the same folder.', iconName: 'sync', timeout: 7000 });
  }, { label: 'Sync this computer' });
  input = sw.querySelector('input');
  return { el: sw, update: () => { input.checked = !!get('sync.enabled'); } };
}

function syncFolderWidget() {
  const where = h('code');
  const sugg = h('div.btn-row', { style: { marginTop: '8px' } });
  let found = null;
  const choose = h('button.btn.small', { type: 'button', onclick: async () => { const p = await pickSyncFolder(); if (p) save('sync.folder', p); } }, icon('folderOpen'), 'Choose…');
  const draw = async () => {
    where.textContent = get('sync.folder') || 'None chosen yet';
    if (!found) found = await wb.invoke('sync:suggest').catch(() => []);
    sugg.replaceChildren(...found.filter((x) => !samePath(x.path, get('sync.folder'))).map((x) => h('button.btn.small', { type: 'button', title: x.path, onclick: async () => {
      await set('sync.folder', x.path);
      if (!get('sync.enabled')) await set('sync.enabled', true);
    } }, icon('cloud'), 'Use ' + x.name)));
    sugg.hidden = !sugg.children.length;
  };
  draw();
  return { el: h('div', null, h('div.btn-row', { style: { alignItems: 'center' } }, where, choose), sugg), update: draw };
}

function syncStatusWidget() {
  const line = h('span.status-line', { style: { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' } });
  const btn = h('button.btn.small', { type: 'button' }, icon('sync'), 'Sync now');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await wb.invoke('sync:now'); toast({ text: 'Synced', iconName: 'check' }); } catch (e) { toast({ text: 'Couldn’t sync: ' + e.message, iconName: 'warn' }); }
    btn.disabled = false;
    refresh();
  });
  const show = (s) => {
    if (!s || !s.enabled) { line.textContent = 'Off'; btn.hidden = true; return; }
    btn.hidden = false;
    const newer = s.newer ? h('span', null, ' · Another computer has a newer Bifrost: update this one to sync everything with it.') : null;
    const parts = s.state === 'error' ? [h('span.chip.bad', null, icon('warn'), s.error)]
      : s.state === 'syncing' || !s.lastSync ? ['Syncing…']
      : [h('span.chip.ok', null, icon('check'), 'Up to date'), `Checked ${timeAgo(s.lastSync)}`];
    line.replaceChildren(...parts, ...(newer ? [newer] : []));
  };
  const refresh = debounce(async () => show(await loadSyncInfo()), 150);
  syncListeners.add((s) => show(s));
  refresh();
  return { el: h('div.btn-row', { style: { alignItems: 'center' } }, btn, line), update: refresh };
}

function syncDevicesWidget() {
  const box = h('div');
  const show = (s) => {
    const list = s && s.devices ? s.devices : [];
    if (!list.length) { box.replaceChildren(h('p.status-line', null, 'None yet. On your other computer, turn on sync with the same folder.')); return; }
    box.replaceChildren(...list.map((d) => h('div.import-src.sync-device', { dataset: { device: d.id } },
      h('span.src-ico', null, icon(d.platform === 'darwin' || /laptop|book|xps|surface/i.test(d.name) ? 'laptop' : 'monitor')),
      h('div.src-main', null, h('b', null, d.name), h('small', null, [`Last synced ${timeAgo(d.updated)}`, d.tabs ? `${d.tabs} open tab${d.tabs === 1 ? '' : 's'}` : '', d.version ? 'Bifrost ' + d.version : ''].filter(Boolean).join(' · '))),
      h('button.btn.small', { type: 'button', title: 'Take this computer’s files out of the sync folder', onclick: async () => {
        if (!(await confirmDialog(`Remove “${d.name}” from sync?`, { detail: 'Its files leave the sync folder. Its bookmarks and history stay on this computer. If Bifrost on that computer still syncs, it comes back the next time it does.', ok: 'Remove', danger: true }))) return;
        try { show(await wb.invoke('sync:remove-device', d.id)); } catch (e) { toast({ text: e.message, iconName: 'warn' }); }
      } }, icon('trash'), 'Remove'))));
  };
  syncListeners.add(show);
  loadSyncInfo().then(show);
  return { el: box, update: null };
}

function syncNameWidget() {
  const input = h('input.field.short', { type: 'text', spellcheck: 'false', placeholder: 'This computer' });
  input.value = get('sync.deviceName') || '';
  input.addEventListener('change', () => { if (input.value.trim() !== (get('sync.deviceName') || '')) save('sync.deviceName', input.value.trim()); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  syncListeners.add((s) => { if (s && s.device) input.placeholder = s.device.host || 'This computer'; });
  return { el: input, update: () => { if (document.activeElement !== input) input.value = get('sync.deviceName') || ''; } };
}

wb.on('sync-changed', debounce(async () => { const s = await loadSyncInfo(); for (const f of syncListeners) f(s); }, 200));

// ------------------------------------------------------------ updates
function updatesWidget() {
  const line = h('span.status-line', { style: { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' } });
  const btn = h('button.btn.small', { type: 'button' });
  const notes = h('button.btn.small', { type: 'button', hidden: true }, icon('external'), 'What’s new');
  let info = null;
  const draw = (i) => {
    if (!i) return;
    info = i;
    notes.hidden = !(i.latest && i.latest !== i.current && i.url);
    if (!i.enabled) { line.replaceChildren(i.why || 'This Bifrost doesn’t update itself.'); btn.hidden = true; return; }
    btn.hidden = false; btn.disabled = false; btn.className = 'btn small';
    const set = (label, ic, primary) => { btn.replaceChildren(icon(ic), label); if (primary) btn.classList.add('primary'); };
    switch (i.state) {
      case 'ready': line.replaceChildren(h('span.chip.accent', null, icon('download'), `Bifrost ${i.latest} is ready`), 'It goes in the next time Bifrost starts.'); set('Restart to update', 'reload', true); break;
      case 'downloading': line.replaceChildren(`Downloading Bifrost ${i.latest}… ${Math.round((i.progress || 0) * 100)}%`); set('Downloading…', 'download'); btn.disabled = true; break;
      case 'checking': line.replaceChildren('Checking for updates…'); set('Checking…', 'reload'); btn.disabled = true; break;
      case 'available': line.replaceChildren(`Bifrost ${i.latest} is available.`); set('Download it', 'download', true); break;
      case 'error': line.replaceChildren(h('span.chip.bad', null, icon('warn'), i.error)); set('Try again', 'reload'); break;
      case 'current': line.replaceChildren(h('span.chip.ok', null, icon('check'), `Bifrost ${i.current} is up to date`), i.checkedAt ? `Checked ${timeAgo(i.checkedAt)}` : ''); set('Check now', 'reload'); break;
      default: line.replaceChildren(`Bifrost ${i.current}`); set('Check for updates', 'reload');
    }
  };
  btn.addEventListener('click', async () => {
    if (info && info.state === 'ready') { await wb.invoke('updates:restart').catch((e) => toast({ text: e.message, iconName: 'warn' })); return; }
    btn.disabled = true;
    draw(await wb.invoke('updates:check').catch((e) => Object.assign({}, info, { state: 'error', error: e.message })));
  });
  notes.addEventListener('click', () => { if (info && info.url) openUrl(info.url, { background: false }); });
  wb.on('updates-changed', draw);
  wb.invoke('updates:info').then(draw).catch(() => {});
  return { el: h('div.btn-row', { style: { alignItems: 'center' } }, btn, notes, line), update: null };
}

// ------------------------------------------------------------ sections
const pct = (v) => Math.round(v * 100) + '%';
const ANIMS = [
  ['tabOpenClose', 'Tabs opening and closing'], ['tabSwitch', 'Switching tabs'], ['tabDrag', 'Dragging tabs'], ['tabHover', 'Hover effects'],
  ['loadingIndicator', 'Loading spinners and bars, and icons popping in when a page loads'], ['workspaceSwitch', 'Switching spaces'], ['splitView', 'Split view'], ['launcher', 'The launcher'],
  ['menus', 'Menus, popovers and dialogs'], ['panels', 'Side panel'], ['sidebar', 'Sidebar collapsing and sliding'], ['pageTransitions', 'Pages fading in when you switch tabs'],
  ['toasts', 'Notifications'], ['newTabPage', 'Start page tiles'], ['buttons', 'Buttons pressing in'], ['internalPages', 'Settings cards rising into view'],
  ['bookmarksBar', 'Bookmarks bar items arriving'], ['ripple', 'Ripples on click'], ['swipe', 'The back and forward swipe arrow going away'],
];

// The animation styles, as cards (like the performance profiles).
function animStyles() {
  const box = h('div.perf-cards.anim-cards');
  const ICONS_ = { subtle: 'minus', smooth: 'sparkle', playful: 'star', snappy: 'bolt' };
  const draw = () => {
    const cur = get('animations.style') || 'smooth';
    box.replaceChildren(...Object.entries(D.ANIM_STYLES).map(([id, st]) => {
      const b = h('button.perf-card' + (id === cur ? '.on' : ''), { type: 'button', dataset: { style: id }, onclick: async () => { await set('animations.style', id); setTimeout(() => demo(b), 60); } },
        h('span.perf-ico', null, icon(ICONS_[id] || 'sparkle')), h('b', null, st.label), h('small', null, st.desc), id === 'smooth' ? h('span.chip', null, 'Default') : null);
      return b;
    }));
  };
  draw();
  return { el: box, update: draw };
}

// A short show of what the animations look like now: a toast, then a menu.
function demo(anchor) {
  toast({ text: 'This is how notifications arrive', iconName: 'sparkle', timeout: 2500 });
  if (anchor) setTimeout(() => showMenu([{ type: 'header', label: 'And this is a menu' }, { label: 'Menus open like this', icon: 'sparkle', action: () => {} }, { label: 'Press Esc or click away', icon: 'close', action: () => {} }], { anchor, side: 'bottom', align: 'start' }), 350);
}

// Windows (or the system) asks apps to reduce motion, and Bifrost follows it: say so, with a way out.
function reducedMotionNote() {
  const el = h('p.status-line.perf-note');
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => {
    const st = page.settings;
    const osOff = mq.matches && st.animations.respectReducedMotion && st.animations.enabled;
    const perfOff = !D.perf(st).animations;
    el.hidden = !osOff && !perfOff;
    el.replaceChildren(...(osOff ? [
      icon('warn'), ' Your computer is set to reduce motion (on Windows: Settings → Accessibility → Visual effects → Animation effects), so Bifrost’s animations are off. ',
      h('button.link-btn', { type: 'button', onclick: () => set('animations.respectReducedMotion', false) }, 'Show them anyway'),
    ] : perfOff ? ['Your performance profile turns animations off. ', h('button.link-btn', { type: 'button', onclick: () => go('performance') }, 'Performance…')] : []));
  };
  mq.addEventListener('change', update);
  update();
  return { el, update };
}

const dialOn = (st) => st.appearance.newTab.showSpeedDial !== false;
const clockOn = (st) => st.appearance.newTab.showClock !== false;
const modOn = (st, id) => (st.appearance.newTab.modules || []).some((m) => m && m.id === id);

function sections() {
  const s = page.settings;
  const vertical = (st) => st.appearance.tabLayout !== 'horizontal';
  const win = s && window.wb.platform === 'win32';
  return [
    { id: 'appearance', title: 'Appearance', icon: 'palette', desc: 'Theme, colors and layout.', groups: [
      { title: 'Theme', items: [
        I.custom('Theme', '', themePicker, { keywords: 'dark light catppuccin mocha latte nord dracula gruvbox tokyo rose pine oled colors' }),
        I.select('appearance.darkTheme', 'Dark theme', 'Used when your system is in dark mode.', Object.entries(THEMES).filter(([, t]) => t.dark).map(([k, t]) => [k, t.name]), { when: (st) => st.appearance.theme === 'auto' }),
        I.select('appearance.lightTheme', 'Light theme', 'Used when your system is in light mode.', Object.entries(THEMES).map(([k, t]) => [k, t.name]), { when: (st) => st.appearance.theme === 'auto' }),
        I.custom('Custom colors', 'Pick every color of the Custom theme.', customPalette, { keywords: 'palette custom theme colours' }),
        I.toggle('appearance.useCustomAccent', 'Use my own accent color', 'Replaces the theme’s accent.'),
        I.color('appearance.accent', 'Accent color', '', { when: (st) => st.appearance.useCustomAccent }),
        I.toggle('appearance.workspaceAccents', 'Spaces tint the browser', 'A space with a color uses it as the accent while you’re in it.'),
        I.select('appearance.webTheme', 'Websites', 'Whether sites that have a dark look use it.', [['browser', 'Like Bifrost’s theme'], ['system', 'Like your computer is set'], ['dark', 'Dark'], ['light', 'Light']], { keywords: 'dark mode websites pages prefers-color-scheme web content' }),
      ] },
      { title: 'Layout', items: [
        I.seg('appearance.tabLayout', 'Tabs', 'Down the side or across the top. Right-click a tab to switch, too.', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']]),
        I.seg('appearance.sidebarSide', 'Sidebar side', '', [['left', 'Left'], ['right', 'Right']], { when: vertical }),
        I.toggle('appearance.sidebarCollapsed', 'Collapsed sidebar', 'Shows tabs as icons only. F4 toggles it.', { when: vertical }),
        I.toggle('appearance.sidebarAutoHide', 'Hide the sidebar until you point at it', 'It slides in from the window edge.', { when: vertical }),
        I.toggle('appearance.topbarAutoHide', 'Hide the top bar until you point at it', 'The toolbar, bookmarks bar and horizontal tabs slide down when you point at the top of the window, or press Ctrl+L. The window’s minimize, maximize and close buttons hide with it (on Windows the window reopens to switch them over).', { keywords: 'toolbar autohide auto-hide hidden fullscreen immersive address bar' }),
        I.range('appearance.sidebarWidth', 'Sidebar width', '', { min: 180, max: 520, step: 4, fmt: (v) => v + ' px', when: vertical }),
        I.range('appearance.horizontalTabMinWidth', 'Smallest tab width', 'Horizontal tabs shrink to this before scrolling.', { min: 40, max: 200, step: 4, fmt: (v) => v + ' px', when: (st) => !vertical(st) }),
        I.range('appearance.horizontalTabMaxWidth', 'Largest tab width', '', { min: 120, max: 400, step: 4, fmt: (v) => v + ' px', when: (st) => !vertical(st) }),
        I.seg('appearance.density', 'Density', 'How much room tabs and rows get.', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]),
        I.range('appearance.uiScale', 'Interface size', 'Scales the browser’s own controls, not web pages.', { min: 0.8, max: 1.3, step: 0.05, fmt: pct, live: false }),
        I.seg('appearance.showTabCloseButtons', 'Close buttons on tabs', '', [['always', 'Always'], ['hover', 'On hover'], ['never', 'Never']]),
        I.toggle('appearance.compactToolbar', 'Compact toolbar', 'Hides the address bar behind a title pill (Ctrl+L still edits the address). Ctrl+Shift+F toggles it.'),
        I.toggle('appearance.showWorkspaceStrip', 'Spaces at the bottom of the sidebar', ''),
        I.toggle('appearance.showTabPreviews', 'Tab previews on hover', 'Shows the page title and a thumbnail.'),
        I.toggle('appearance.showStatusBubble', 'Link addresses on hover', 'The little bubble in the corner of the page.'),
        I.button('Toolbar and sidebar buttons', 'Choose what’s on them and in what order.', 'Customize…', () => go('customize'), { iconName: 'layout', keywords: 'customize toolbar sidebar buttons' }),
        I.button('Look & feel', 'Window background, shadows, glass menus, the current tab’s look, the address bar, sizes and corner rounding.', 'Adjust…', () => go('look'), { iconName: 'ruler', keywords: 'radius padding size shadows glass' }),
      ] },
      { title: 'Auto-hiding bars', id: 'flyout', items: [
        I.range('appearance.flyout.showDelay', 'Wait before sliding in', 'After you point at the window edge.', { min: 0, max: 1000, step: 25, fmt: (v) => v ? v + ' ms' : 'Right away', when: (st) => st.appearance.sidebarAutoHide || st.appearance.topbarAutoHide, keywords: 'flyout delay hover time autohide' }),
        I.range('appearance.flyout.hideDelay', 'Wait before sliding away', 'After the pointer leaves the bar.', { min: 0, max: 3000, step: 50, fmt: (v) => v ? v + ' ms' : 'Right away', when: (st) => st.appearance.sidebarAutoHide || st.appearance.topbarAutoHide, keywords: 'flyout delay hover time autohide' }),
        I.range('appearance.flyout.duration', 'Slide speed', 'How long the slide takes.', { min: 0, max: 800, step: 20, fmt: (v) => v ? v + ' ms' : 'Instant', when: (st) => st.appearance.sidebarAutoHide || st.appearance.topbarAutoHide, keywords: 'flyout animation speed autohide' }),
        I.range('appearance.flyout.edge', 'Edge strip', 'How close to the window edge you have to point.', { min: 2, max: 30, step: 1, fmt: (v) => v + ' px', when: (st) => st.appearance.sidebarAutoHide || st.appearance.topbarAutoHide, keywords: 'flyout hot corner edge autohide' }),
      ] },
      { title: 'Text', items: [
        I.text('appearance.font', 'Interface font', 'Any CSS font list.', { wide: true, keywords: 'typeface' }),
        I.text('appearance.monoFont', 'Monospace font', '', { wide: true }),
      ] },
      { title: 'Window', items: [
        I.toggle('appearance.useSystemTitleBar', 'Use the system title bar', 'Takes effect after a restart.', { restart: true }),
        ...(win ? [I.seg('appearance.windowMaterial', 'Window material', 'Windows 11 only; takes effect after a restart.', [['none', 'Solid'], ['mica', 'Mica'], ['acrylic', 'Acrylic']], { restart: true })] : []),
        I.textarea('appearance.customCss', 'Custom CSS for the browser window', 'For tweaks beyond these settings. Applies instantly.', { placeholder: '.tab { font-weight: 600; }', keywords: 'userchrome style' }),
      ] },
    ] },
    { id: 'toolbar-sidebar', title: 'Toolbar & sidebar', icon: 'layout', desc: 'What’s on the toolbar and in the sidebar, and the bookmarks bar. You can also right-click any button on them.', groups: [
      { title: 'Toolbar & sidebar', id: 'customize', items: [
        I.custom('Toolbar and sidebar', 'Drag items between the rows, or from “More items”. Drag one back to “More items” (or click it) to remove it. Right-click the toolbar or sidebar to get here.', layoutEditor, { keywords: 'customize buttons toolbar sidebar home reader screenshot split settings spaces spacer divider order rearrange' }),
      ] },
      { title: 'Bookmarks bar', id: 'bookmarks-bar', items: [
        I.toggle('appearance.showBookmarksBar', 'Bookmarks bar', 'Ctrl+Shift+B toggles it.'),
        I.seg('appearance.bookmarksBar.labels', 'Names', 'Right-click the bar to change this too.', [['all', 'Everything'], ['folders', 'Folders only'], ['none', 'Icons only']], { when: (st) => st.appearance.showBookmarksBar, keywords: 'labels titles icons' }),
        I.toggle('appearance.bookmarksBar.showOtherBookmarks', 'Show “Other bookmarks”', 'The folder at the right end of the bar.', { when: (st) => st.appearance.showBookmarksBar, keywords: 'other bookmarks hide' }),
        I.button('Remove “Other bookmarks”', 'Moves what’s in it to the bar (or deletes it) and hides the folder.', 'Remove…', removeOtherBookmarks, { iconName: 'trash', keywords: 'other bookmarks delete hide' }),
      ] },
    ] },
    { id: 'look', title: 'Look & feel', icon: 'ruler', desc: 'The window background, shadows, menus, how the current tab and loading look, the address bar, corner rounding, sizes and spacing.', groups: [
      { title: 'Style', id: 'style', items: [
        I.seg('appearance.chrome', 'Window background', 'Aurora lights the window around the page with the theme’s colors.', [['aurora', 'Aurora'], ['gradient', 'Gradient'], ['flat', 'Flat']], { keywords: 'background glow aurora gradient color depth window chrome sidebar' }),
        I.seg('appearance.blend', 'Sidebar and toolbar', 'Match the page: they take the color of the page you’re on, with no edge between them and it, so the page and the window blend into one. Bifrost’s own pages keep the theme.', [['window', 'Window background'], ['page', 'Match the page']], { keywords: 'blend match page color tint seamless sidebar toolbar website theme-color arc zen safari' }),
        I.toggle('appearance.texture', 'Fine texture', 'A faint grain on the window around the page.', { keywords: 'grain noise texture film' }),
        I.seg('appearance.shadows', 'Shadows', 'Under the page, tabs, menus and dialogs.', [['none', 'None'], ['subtle', 'Subtle'], ['normal', 'Normal'], ['strong', 'Strong']], { keywords: 'shadow depth elevation flat' }),
        I.seg('appearance.menuStyle', 'Menus and dialogs', 'Glass is see-through and blurred.', [['solid', 'Solid'], ['glass', 'Glass']], { keywords: 'glass blur transparent acrylic frosted menus popups' }),
        I.select('appearance.activeTab', 'The current tab', 'How it stands out from the others.', [['card', 'Raised card with an accent rail'], ['rail', 'Accent rail only'], ['fill', 'Filled with the accent color'], ['outline', 'Outlined in the accent color']], { keywords: 'active selected tab highlight indicator' }),
        I.select('appearance.loadingStyle', 'While a page loads', '', [['both', 'Spinner on the tab and a bar over the page'], ['spinner', 'Spinner on the tab'], ['bar', 'Bar over the page'], ['none', 'Nothing']], { keywords: 'loading spinner progress bar indicator' }),
        I.seg('appearance.toastPosition', 'Notifications', 'Where the little messages appear.', [['bottom', 'Bottom'], ['bottom-right', 'Bottom right'], ['top', 'Top']], { keywords: 'toast notification popup position' }),
        I.seg('appearance.scrollbars', 'Scrollbars', 'In Bifrost’s own pages and panels.', [['thin', 'Thin'], ['normal', 'Wide'], ['hidden', 'Hidden']], { keywords: 'scrollbar scroll bar' }),
        I.range('appearance.tabPreviewDelay', 'Tab previews appear after', 'How long you point at a tab first.', { min: 0, max: 2000, step: 20, fmt: (v) => v ? v + ' ms' : 'Right away', when: (st) => st.appearance.showTabPreviews, keywords: 'hover preview delay tooltip thumbnail' }),
      ] },
      { title: 'Frame around pages', id: 'page-frame', items: [
        I.toggle('appearance.pageFrame', 'Frame around web pages', 'The rounded, outlined frame with a little space around it. Off: pages run edge to edge.', { keywords: 'frame border padding margin edge page stage rounded outline' }),
        I.autoRange('appearance.sizes.pageGap', 'Frame padding', 'The space between web pages and the window edges.', { min: 0, max: 28, when: (st) => st.appearance.pageFrame !== false, keywords: 'margin gap border frame padding page' }),
        I.autoRange('appearance.shape.page', 'Frame corners', 'How round the page’s corners are.', { min: 0, max: 24, when: (st) => st.appearance.pageFrame !== false, keywords: 'radius corners page frame' }),
      ] },
      { title: 'Address bar', id: 'address-bar', items: [
        I.seg('appearance.address.show', 'Show', 'While you’re not typing in it.', [['host', 'Just the site'], ['path', 'Site and page'], ['full', 'The whole address']], { keywords: 'url full address https www domain' }),
        I.select('appearance.address.position', 'Place it', 'The address bar, or the title pill in the compact toolbar. In the middle it stays exactly centered whatever buttons are around it, and gets narrower before it would cover one.', [['center', 'In the middle of the toolbar'], ['window', 'In the middle of the window'], ['fill', 'In the space between the buttons']], { keywords: 'center middle position pill address toolbar compact align' }),
        I.toggle('appearance.address.centered', 'Center the text', 'While you’re not typing in it.', { keywords: 'url center middle address text' }),
      ] },
      { title: 'Corner rounding', id: 'corners', items: [
        I.range('appearance.radius', 'Corner rounding', 'For everything below that’s set to Auto.', { min: 0, max: 24, step: 1, fmt: (v) => v + ' px', keywords: 'radius roundness corners' }),
        I.custom('Quick looks', '', shapePresets, { stack: false, keywords: 'square round pill radius' }),
        I.autoRange('appearance.shape.buttons', 'Buttons', 'Toolbar, sidebar and bookmarks bar buttons, fields.', { min: 0, max: 24, keywords: 'radius corners' }),
        I.autoRange('appearance.shape.tabs', 'Tabs', '', { min: 0, max: 24, keywords: 'radius corners' }),
        I.autoRange('appearance.shape.address', 'Address bar', '', { min: 0, max: 24, keywords: 'radius corners url' }),
        I.autoRange('appearance.shape.menus', 'Menus, popups and dialogs', '', { min: 0, max: 24, keywords: 'radius corners' }),
        I.autoRange('appearance.shape.page', 'The page and side panel', '', { min: 0, max: 32, keywords: 'radius corners web view' }),
        I.autoRange('appearance.shape.tiles', 'Speed Dial tiles', '', { min: 0, max: 48, keywords: 'radius corners start page new tab' }),
        I.button('', '', 'Reset corner rounding', resetGroup(SHAPE_KEYS, 'appearance.shape.', 'corner setting'), { iconName: 'rotate', keywords: 'reset radius' }),
      ] },
      { title: 'Sizes & spacing', id: 'sizes', items: [
        I.autoRange('appearance.sizes.toolbarHeight', 'Toolbar height', 'Also the height of the tab bar and the sidebar’s top row.', { min: 30, max: 60, keywords: 'title bar caption' }),
        I.autoRange('appearance.sizes.button', 'Button size', '', { min: 22, max: 48, keywords: 'toolbar buttons' }),
        I.autoRange('appearance.sizes.icon', 'Icon size', 'In toolbar and sidebar buttons.', { min: 12, max: 26, keywords: 'icons' }),
        I.autoRange('appearance.sizes.buttonGap', 'Space between buttons', '', { min: 0, max: 14, keywords: 'gap padding' }),
        I.autoRange('appearance.sizes.address', 'Address bar height', '', { min: 24, max: 48, keywords: 'url omnibox' }),
        I.autoRange('appearance.sizes.tab', 'Tab height', 'Vertical tabs; horizontal tabs fit the toolbar.', { min: 24, max: 60, keywords: 'tabs' }),
        I.autoRange('appearance.sizes.tabGap', 'Space between tabs', '', { min: 0, max: 14, keywords: 'tabs gap' }),
        I.autoRange('appearance.sizes.sidebarPadding', 'Sidebar padding', 'Space at the sides of the tab list.', { min: 0, max: 20, keywords: 'margin' }),
        I.autoRange('appearance.sizes.bookmarksBar', 'Bookmarks bar height', '', { min: 22, max: 44, keywords: 'bookmarks' }),
        I.autoRange('appearance.sizes.bookmarkPadding', 'Padding inside bookmarks', 'Space either side of a bookmark’s name.', { min: 2, max: 18, keywords: 'bookmarks hover' }),
        I.button('', '', 'Reset sizes and spacing', resetGroup(SIZE_KEYS, 'appearance.sizes.', 'size'), { iconName: 'rotate', keywords: 'reset' }),
      ] },
    ] },
    { id: 'newtab', title: 'Start page', icon: 'compass', desc: 'What new tabs show, and Speed Dial.', groups: [
      { title: 'New tabs', items: [
        I.toggle('tabs.newTabOpensLauncher', 'Ctrl+T opens the launcher', 'Search first, then the result opens in a new tab. Press Enter with nothing typed (or Ctrl+T twice) for a plain new tab.'),
        I.seg('tabs.newTabPage', 'New tabs show', '', [['speeddial', 'Speed Dial'], ['blank', 'A blank page'], ['url', 'A page I choose']]),
        I.text('tabs.newTabUrl', 'Page address', '', { placeholder: 'https://…', when: (st) => st.tabs.newTabPage === 'url' }),
        I.text('tabs.homeUrl', 'Home page', 'Where the Home button goes. Empty means the start page.', { placeholder: 'https://…' }),
      ] },
      { title: 'Speed Dial', items: [
        I.toggle('appearance.newTab.showSpeedDial', 'Show Speed Dial', 'The tiles of favorite sites under the search box. Turn it off for a cleaner page.', { keywords: 'tiles remove hide speeddial' }),
        I.custom('Speed Dial folder', 'The bookmark folder shown as tiles.', speedDialFolder, { stack: false, when: dialOn }),
        I.range('appearance.newTab.columns', 'Tiles per row', '', { min: 3, max: 10, step: 1, when: dialOn }),
        I.seg('appearance.newTab.tileSize', 'Tile size', '', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], { when: dialOn }),
      ] },
      { title: 'On the page', items: [
        I.toggle('appearance.newTab.showClock', 'Clock', ''),
        I.toggle('appearance.newTab.showGreeting', 'Greeting', ''),
        I.text('appearance.newTab.greetingName', 'Your name in the greeting', '“Good evening, …”', { placeholder: 'Name', when: (st) => st.appearance.newTab.showGreeting }),
        I.toggle('appearance.newTab.showSearch', 'Search box', 'Clicking it opens the launcher.'),
        I.toggle('appearance.newTab.customizeButton', 'Customize button', 'The button in the bottom corner. Without it, right-click the page for the same menu.', { keywords: 'sliders corner settings gear hide remove' }),
        I.toggle('appearance.newTab.moduleMenuButton', 'Module ⋮ buttons', 'The three dots a module shows when you point at it. Without them, right-click a module for its menu.', { keywords: 'dots menu more options hide remove three widget' }),
      ] },
      { title: 'Clock', id: 'clock', items: [
        I.seg('appearance.newTab.clock.hours', 'Hours', '', [['auto', 'Like the system'], ['12', '12-hour'], ['24', '24-hour']], { when: clockOn, keywords: 'time format' }),
        I.toggle('appearance.newTab.clock.seconds', 'Seconds', '', { when: clockOn }),
        I.toggle('appearance.newTab.clock.ampm', 'AM/PM', 'On a 12-hour clock.', { when: clockOn }),
        I.seg('appearance.newTab.clock.ampmSize', 'AM/PM size', '', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Big']], { when: (st) => clockOn(st) && st.appearance.newTab.clock.ampm !== false, keywords: 'am pm meridiem' }),
        I.toggle('appearance.newTab.clock.blink', 'Blinking colons', '', { when: clockOn }),
        I.select('appearance.newTab.clock.date', 'Date under the time', '', [['none', 'No date'], ['long', 'Saturday, October 17'], ['short', 'Sat, Oct 17'], ['numeric', '10/17/2026']], { when: clockOn }),
        I.select('appearance.newTab.clock.font', 'Font', '', [['ui', 'Same as the browser'], ['thin', 'Light (Segoe UI Variable)'], ['display', 'Digital (Bahnschrift)'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Monospace'], ['custom', 'Another font…']], { when: clockOn, keywords: 'typeface' }),
        I.text('appearance.newTab.clock.customFont', 'Font name', 'Any font installed on this computer, or a CSS font list.', { placeholder: 'Consolas', when: (st) => clockOn(st) && st.appearance.newTab.clock.font === 'custom' }),
        I.range('appearance.newTab.clock.size', 'Size', '', { min: 50, max: 200, step: 5, fmt: (v) => v + '%', when: clockOn }),
        I.range('appearance.newTab.clock.weight', 'Weight', 'Thin to bold.', { min: 100, max: 900, step: 100, fmt: (v) => String(v), when: clockOn }),
        I.range('appearance.newTab.clock.spacing', 'Letter spacing', '', { min: -15, max: 40, step: 1, fmt: (v) => (v / 100).toFixed(2) + ' em', when: clockOn }),
        I.seg('appearance.newTab.clock.color', 'Color', '', [['text', 'Text'], ['accent', 'Accent'], ['gradient', 'Gradient'], ['custom', 'Custom']], { when: clockOn }),
        I.color('appearance.newTab.clock.customColor', 'Custom color', '', { when: (st) => clockOn(st) && st.appearance.newTab.clock.color === 'custom' }),
        I.select('appearance.newTab.clock.position', 'Position', 'Where on the page the clock (with the date and greeting) goes.', [['center', 'In the middle, above the search box'], ['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left side'], ['right', 'Right side'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right']], { when: (st) => st.appearance.newTab.showClock || st.appearance.newTab.showGreeting, keywords: 'place move corner' }),
        I.button('', '', 'Reset the clock', async () => { for (const [k, v] of Object.entries(D.DEFAULTS.appearance.newTab.clock)) await set('appearance.newTab.clock.' + k, v); }, { iconName: 'rotate', keywords: 'reset clock' }),
      ] },
      { title: 'Modules', id: 'ntp-modules', items: [
        I.custom('Modules', 'Extras for the start page: tick one to add it, then pick where it goes. You can also right-click a module on the page to move it.', ntpModulesEditor, { keywords: 'widgets weather todo to-do notes calendar countdown most visited recently closed folder stats tips' }),
        I.text('appearance.newTab.moduleCfg.weather.city', 'Weather: city', '', { placeholder: 'West Lafayette', when: (st) => modOn(st, 'weather'), keywords: 'weather location' }),
        I.seg('appearance.newTab.moduleCfg.weather.units', 'Weather: units', '', [['auto', 'For my region'], ['c', '°C'], ['f', '°F']], { when: (st) => modOn(st, 'weather') }),
        I.text('appearance.newTab.moduleCfg.countdown.title', 'Countdown: what to', '', { placeholder: 'Finals', when: (st) => modOn(st, 'countdown') }),
        I.text('appearance.newTab.moduleCfg.countdown.date', 'Countdown: date', 'YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time too.', { placeholder: '2026-12-14', when: (st) => modOn(st, 'countdown') }),
        I.select('appearance.newTab.moduleCfg.topsites.count', 'Most visited: how many', '', [[3, '3'], [6, '6'], [9, '9'], [12, '12']], { number: true, when: (st) => modOn(st, 'topsites') }),
        I.select('appearance.newTab.moduleCfg.recent.count', 'Recently closed: how many', '', [[3, '3'], [5, '5'], [10, '10'], [15, '15']], { number: true, when: (st) => modOn(st, 'recent') }),
        I.custom('Bookmark folder: which', '', () => folderPicker('appearance.newTab.moduleCfg.folder.id', 'Choose a folder'), { stack: false, when: (st) => modOn(st, 'folder') }),
        I.seg('appearance.newTab.moduleCfg.calendar.weekStart', 'Calendar: weeks start on', '', [['auto', 'Like my region'], ['sunday', 'Sunday'], ['monday', 'Monday']], { when: (st) => modOn(st, 'calendar') }),
      ] },
      { title: 'Background', items: [
        I.seg('appearance.newTab.background', 'Background', '', [['none', 'Plain'], ['gradient', 'Glow'], ['image', 'Image']]),
        I.custom('Image', '', wallpaperPicker, { stack: false, keywords: 'wallpaper picture' }),
        I.range('appearance.newTab.imageDim', 'Darken the image', '', { min: 0, max: 0.8, step: 0.05, fmt: pct, when: (st) => st.appearance.newTab.background === 'image' }),
        I.range('appearance.newTab.imageBlur', 'Blur the image', '', { min: 0, max: 30, step: 1, fmt: (v) => v + ' px', when: (st) => st.appearance.newTab.background === 'image' }),
      ] },
    ] },
    { id: 'animations', title: 'Animations', icon: 'sparkle', desc: 'Every animation can be turned off on its own.', groups: [
      { title: 'Everywhere', items: [
        I.custom('', '', reducedMotionNote, { stack: true }),
        I.toggle('animations.enabled', 'Animations', 'Turns all of them on or off.', { keywords: 'motion' }),
        I.custom('Style', 'How much things move. Picking one plays a little demo.', animStyles, { stack: true, when: (st) => st.animations.enabled, keywords: 'animation style subtle smooth playful bouncy snappy spring' }),
        I.button('See them', 'Shows a notification and a menu with the current settings.', 'Play a demo', (e) => demo(e && e.currentTarget), { iconName: 'sparkle', keywords: 'animation preview test' }),
        I.range('animations.speed', 'Speed', 'Higher is faster.', { min: 0.5, max: 2.5, step: 0.1, fmt: (v) => v.toFixed(1) + '×', when: (st) => st.animations.enabled }),
        I.toggle('animations.respectReducedMotion', 'Follow the system’s “reduce motion” setting', '', { when: (st) => st.animations.enabled }),
      ] },
      { title: 'Each animation', items: ANIMS.map(([k, label]) => I.toggle('animations.' + k, label, '', { when: (st) => st.animations.enabled, keywords: 'motion animation' })) },
    ] },
    { id: 'tabs', title: 'Tabs', icon: 'window', desc: 'Opening, closing, startup and sleeping tabs.', groups: [
      { title: 'Opening and closing', items: [
        I.seg('tabs.newTabPosition', 'New tabs open', 'Links always open next to the page they came from.', [['afterActive', 'Next to the current tab'], ['end', 'At the end']]),
        I.select('tabs.activateOnClose', 'After closing a tab, show', '', [['previous', 'The tab you used before'], ['right', 'The tab after it'], ['left', 'The tab before it']]),
        I.toggle('tabs.middleClickCloses', 'Middle-click closes a tab', ''),
        I.toggle('tabs.doubleClickToClose', 'Double-click closes a tab', ''),
        I.toggle('tabs.closeWindowWithLastTab', 'Closing the last tab closes the window', 'Otherwise a fresh tab takes its place.'),
        I.toggle('tabs.confirmCloseWindow', 'Ask before closing a window with several tabs', ''),
        I.toggle('tabs.showAudioIndicator', 'Show which tabs are playing sound', ''),
      ] },
      { title: 'Switching tabs', id: 'ctrl-tab', items: [
        I.select('tabs.ctrlTab', 'Ctrl+Tab', 'Ctrl+Shift+Tab goes the other way. Windows keeps Alt+Tab for switching apps, so this is on Ctrl+Tab.', [
          ['recent', 'Quick press: last tab · Hold Ctrl first: in order'],
          ['order', 'Tabs in order (like Chrome)'],
          ['mru', 'Tabs in the order you used them'],
        ], { keywords: 'alt tab ctrl tab switch cycle recent previous last mru order' }),
        I.range('tabs.ctrlTabHoldMs', 'How long counts as holding Ctrl', 'Press Tab sooner than this after Ctrl to jump to your last tab; later to go through tabs in order.', { min: 150, max: 1000, step: 25, fmt: (v) => v + ' ms', when: (st) => st.tabs.ctrlTab === 'recent' }),
      ] },
      { title: 'Startup', items: [
        I.seg('tabs.restoreOnStartup', 'When Bifrost starts', '', [['last', 'Continue where I left off'], ['newtab', 'Open a new tab'], ['urls', 'Open specific pages']]),
        I.list('tabs.startupUrls', 'Pages to open', '', { placeholder: 'https://…', when: (st) => st.tabs.restoreOnStartup === 'urls' }),
      ] },
      { title: 'Sleeping tabs', items: [
        I.button('Sleeping tabs', 'When unused tabs go to sleep (to free memory) is part of the performance profile.', 'Performance…', () => go('performance'), { iconName: 'cpu', keywords: 'sleep memory discard suspend ram' }),
      ] },
    ] },
    { id: 'spaces', title: 'Spaces & split view', icon: 'layers', desc: 'Separate sets of tabs, and pages side by side.', groups: [
      { title: 'Spaces', items: [
        I.toggle('workspaces.showSwitcher', 'Show the space switcher', ''),
        I.toggle('workspaces.switchOnDrop', 'Follow a tab you drop on another space', ''),
      ] },
      { title: 'Split view', items: [
        I.seg('split.orientation', 'New splits are', '', [['row', 'Side by side'], ['column', 'Stacked']]),
        I.range('split.gap', 'Gap between pages', '', { min: 0, max: 16, step: 1, fmt: (v) => v + ' px' }),
      ] },
    ] },
    { id: 'search', title: 'Search', icon: 'search', desc: 'Search engines and suggestions.', groups: [
      { title: 'Search engines', items: [
        I.custom('Search engines', 'Type a keyword then a space in the launcher or address bar to use an engine (for example “yt cats”).', enginesEditor, { keywords: 'google duckduckgo bing keyword' }),
      ] },
      { title: 'Suggestions', items: [
        I.toggle('search.suggestions', 'Search suggestions', 'Ask the search engine for suggestions as you type.'),
        I.select('search.suggestionProvider', 'Suggestions from', '', [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['none', 'Nowhere']], { when: (st) => st.search.suggestions }),
        I.toggle('search.openInNewTab', 'Address bar searches open in a new tab', ''),
      ] },
    ] },
    { id: 'languages', title: 'Languages', icon: 'translate', desc: 'Translating pages, and spell check.', groups: [
      { title: 'Translation', items: [
        I.toggle('translate.offer', 'Offer to translate pages in other languages', 'A Translate button shows in the address bar. Pages are translated by Google Translate’s website translator, which fetches the page itself: a page you’re signed in to comes out as it looks signed out, and only public websites can be translated.', { keywords: 'translate translation google language' }),
        I.select('translate.target', 'Translate into', '', translateTargets(), { keywords: 'translate translation language' }),
        I.list('translate.neverFor', 'Never offer for', 'Language codes, such as fr or zh-CN.', { when: (st) => st.translate.offer, keywords: 'translate translation language' }),
      ] },
      { title: 'Spell check', items: [
        I.toggle('advanced.spellcheck', 'Spell check', ''),
        I.list('advanced.spellcheckLanguages', 'Spell check languages', 'Language codes such as en-US or fr.', { when: (st) => st.advanced.spellcheck }),
      ] },
    ] },
    { id: 'launcher', title: 'Launcher', icon: 'bolt', desc: 'Bifrost’s ranking: how bookmarks, tabs, history and suggestions are weighed.', groups: [
      { title: 'Sources', items: [
        I.custom('What the launcher searches', 'Weight multiplies a source’s scores; max limits how many of its results show.', sourcesEditor, { keywords: 'bookmarks tabs history commands suggestions weight' }),
        I.custom('Prefixes', 'Start a search with one of these to search only that source (for example “* recipes” for bookmarks).', prefixesEditor, { keywords: 'prefix filter' }),
        I.custom('Bookmark folders', 'Which bookmark folders the launcher looks in.', bookmarkFoldersEditor, { keywords: 'folders mobile' }),
        I.select('launcher.emptyState', 'Before you type, show', '', [['bookmarks', 'Most-used bookmarks'], ['tabs', 'Recent tabs'], ['history', 'Recent history'], ['none', 'Nothing']]),
      ] },
      { title: 'Ranking', items: [
        I.range('launcher.wMatch', 'Text match', 'How much matching your words counts.', { min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) }),
        I.range('launcher.wVisits', 'Visits', 'How much often-visited pages count.', { min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) }),
        I.range('launcher.wRecency', 'Recency', 'How much recently visited pages count.', { min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) }),
        I.number('launcher.recencyHalfLifeDays', 'Recency half-life (days)', 'After this long, a visit counts half as much.', { min: 0.1, max: 365, step: 0.5 }),
        I.number('launcher.visitsSaturation', 'Visits saturation', 'Visit counts above this stop adding score.', { min: 1, max: 1000 }),
        I.toggle('launcher.fuzzy', 'Fuzzy matching', 'Lets “gthb” find GitHub.'),
        I.range('launcher.minScore', 'Minimum score', 'Results scoring below this are hidden.', { min: 0, max: 0.5, step: 0.01, fmt: (v) => v.toFixed(2) }),
        I.number('launcher.maxResults', 'Results', 'How many rows to show.', { min: 3, max: 30 }),
        I.seg('launcher.searchRowPosition', 'The “Search the web” row', '', [['auto', 'Automatic'], ['top', 'Always first'], ['bottom', 'Always last']]),
        I.range('launcher.autoThreshold', 'Automatic: strong matches go above it', '', { min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2), when: (st) => st.launcher.searchRowPosition === 'auto' }),
        I.range('launcher.suggestionDecay', 'Suggestion decay', 'How quickly lower suggestions lose score.', { min: 0, max: 0.3, step: 0.01, fmt: (v) => v.toFixed(2) }),
      ] },
      { title: 'Boosts', items: [
        I.custom('Domains', 'Make some sites rank higher or lower.', () => boostsEditor('domains'), { keywords: 'boost domain' }),
        I.custom('Bookmark folders', 'Make bookmarks in some folders rank higher or lower.', () => boostsEditor('folders'), { keywords: 'boost folder' }),
      ] },
      { title: 'Look and speed', items: [
        I.range('launcher.width', 'Width', '', { min: 480, max: 1000, step: 10, fmt: (v) => v + ' px' }),
        I.range('launcher.top', 'Distance from the top', '', { min: 4, max: 40, step: 1, fmt: (v) => v + '%' }),
        I.range('launcher.dim', 'Dim the page behind it', '', { min: 0, max: 0.8, step: 0.05, fmt: pct }),
        I.toggle('launcher.blur', 'Blur the page behind it', ''),
        I.toggle('launcher.showHints', 'Key hints at the bottom', ''),
        I.toggle('launcher.showScores', 'Show scores', 'Useful while tuning the ranking.'),
        I.number('launcher.suggestDelayMs', 'Suggestion delay (ms)', 'Wait this long after typing before asking for suggestions.', { min: 0, max: 1000, step: 10 }),
      ] },
    ] },
    { id: 'privacy', title: 'Privacy & security', icon: 'shield', desc: 'Ad blocking, tracking protection and your data.', groups: [
      { title: 'Dangerous sites', items: [
        I.toggle('privacy.dangerousSites', 'Warn me about dangerous sites', 'Pages known for phishing, malware or scams are stopped before they load, with a warning (and a way through if you’re sure); downloads from them are blocked. Uses the Phishing URL and Malicious URL blocklists and uBlock Origin’s “Badware risks”, updated twice a day. Works even with ad blocking off.', { keywords: 'safe browsing phishing malware scam security deceptive' }),
      ] },
      { title: 'Ad and tracker blocking', items: [
        I.toggle('privacy.adblock.enabled', 'Block ads and trackers', 'Uses EasyList, EasyPrivacy and uBlock Origin’s lists.', { keywords: 'adblock ublock' }),
        I.toggle('privacy.adblock.cosmetic', 'Hide leftover ad spaces', 'Removes empty boxes and runs uBlock’s anti-adblock fixes.', { when: (st) => st.privacy.adblock.enabled }),
        I.toggle('privacy.adblock.youtubeSkip', 'Skip YouTube video ads', 'Mutes them, runs them to their end and presses “Skip”.', { when: (st) => st.privacy.adblock.enabled, keywords: 'youtube ads skip video' }),
        I.toggle('privacy.adblock.youtubeFilters', 'Remove YouTube ads before they play (experimental)', 'Runs the lists’ page scripts on YouTube and blocks its own ad requests. YouTube can get stuck loading with this on; reload YouTube after changing it.', { when: (st) => st.privacy.adblock.enabled, keywords: 'youtube ads scriptlets filters' }),
        I.toggle('privacy.adblock.lists.ads', 'Ads', '', { when: (st) => st.privacy.adblock.enabled }),
        I.toggle('privacy.adblock.lists.tracking', 'Trackers', '', { when: (st) => st.privacy.adblock.enabled }),
        I.toggle('privacy.adblock.lists.annoyances', 'Annoyances', 'Newsletter popups, “open in app” banners and similar.', { when: (st) => st.privacy.adblock.enabled }),
        I.toggle('privacy.adblock.lists.cookieNotices', 'Cookie notices', 'Hides cookie banners.', { when: (st) => st.privacy.adblock.enabled }),
        I.select('privacy.adblock.updateHours', 'Update the lists', '', [[6, 'Every 6 hours'], [24, 'Every day'], [72, 'Every 3 days'], [168, 'Every week']], { number: true, when: (st) => st.privacy.adblock.enabled }),
        I.custom('Status', '', adblockStatus, { stack: true }),
        I.textarea('privacy.adblock.customFilters', 'My filters', 'Adblock Plus / uBlock syntax, one per line.', { placeholder: '||ads.example.com^\nexample.com##.banner', keywords: 'custom rules' }),
        I.list('privacy.adblock.allowlist', 'Sites where ads are allowed', '', { placeholder: 'example.com', keywords: 'whitelist allowlist' }),
      ] },
      { title: 'Connections and tracking', items: [
        I.toggle('privacy.httpsOnly', 'HTTPS-only mode', 'Upgrades plain HTTP pages to HTTPS (local addresses excepted).'),
        I.toggle('privacy.globalPrivacyControl', 'Ask sites not to sell or share my data', 'Sends the Global Privacy Control signal.'),
        I.toggle('privacy.doNotTrack', 'Send “Do Not Track”', 'Most sites ignore it.'),
        I.toggle('privacy.sendReferrer', 'Tell sites which page I came from', 'The Referer header.'),
      ] },
      { title: 'Clear browsing data', id: 'clear', items: [
        I.custom('Clear browsing data', '', clearDataWidget, { keywords: 'delete history cookies cache' }),
        I.toggle('privacy.clearOnExit.history', 'Clear history when Bifrost closes', ''),
        I.toggle('privacy.clearOnExit.cookies', 'Clear cookies and site data when Bifrost closes', 'You’ll be signed out of sites.'),
        I.toggle('privacy.clearOnExit.cache', 'Clear the cache when Bifrost closes', ''),
        I.toggle('privacy.clearOnExit.downloads', 'Clear download history when Bifrost closes', ''),
      ] },
      { title: 'Site settings', id: 'sites', items: [
        I.custom('Sites', 'Permissions, zoom levels and custom styles you’ve set for sites.', sitesWidget, { keywords: 'permissions camera microphone location notifications zoom css' }),
      ] },
    ] },
    { id: 'downloads', title: 'Downloads', icon: 'download', desc: '', groups: [
      { title: 'Downloads', items: [
        I.custom('Save files to', '', downloadFolder, { stack: false }),
        I.toggle('downloads.askWhereToSave', 'Ask where to save each file', ''),
        I.toggle('downloads.showOnStart', 'Show downloads when they start', ''),
      ] },
    ] },
    { id: 'keyboard', title: 'Keyboard & touchpad', icon: 'keyboard', desc: 'Shortcuts, Vim keys and touchpad swipes.', groups: [
      { title: 'Touchpad', id: 'touchpad', items: [
        I.toggle('gestures.swipe', 'Swipe with two fingers to go back and forward', 'Left to right goes back, right to left goes forward (like Chrome). An arrow comes in from the side; let go once it lights up. It only happens when the page can’t scroll any further that way itself.', { keywords: 'gesture gestures trackpad touchpad swipe back forward history navigate two fingers' }),
        I.range('gestures.swipeDistance', 'How far to swipe', 'Before letting go goes back or forward.', { min: 40, max: 400, step: 10, fmt: (v) => v + ' px', when: (st) => st.gestures.swipe !== false, keywords: 'swipe sensitivity distance threshold' }),
        I.toggle('gestures.swipeReverse', 'The other way round', 'Right to left goes back. For touchpads set to scroll the opposite way.', { when: (st) => st.gestures.swipe !== false, keywords: 'swipe reverse invert direction natural scrolling' }),
      ] },
      { title: 'Vim keys', items: [
        I.toggle('keyboard.vim.enabled', 'Vim keys in pages', 'Browse with j/k to scroll, f to click links, o to open the launcher. Press ? on any page for the full list. Single letters then go to Bifrost instead of the page, except on the sites below.', { keywords: 'vimium keyboard navigation' }),
        I.text('keyboard.vim.hintChars', 'Link hint letters', 'Letters used to label links.', { when: (st) => st.keyboard.vim.enabled }),
        I.range('keyboard.vim.scrollStep', 'Scroll step', '', { min: 20, max: 300, step: 10, fmt: (v) => v + ' px', when: (st) => st.keyboard.vim.enabled }),
        I.toggle('keyboard.vim.smoothScroll', 'Smooth scrolling', '', { when: (st) => st.keyboard.vim.enabled }),
        I.list('keyboard.vim.excludedSites', 'Sites without Vim keys', 'Add a site to turn Vim keys off there, or follow it with keys to pass only those to the site (for example “youtube.com f k j l”).', { placeholder: 'mail.google.com', when: (st) => st.keyboard.vim.enabled }),
        I.custom('Vim key bindings', '', vimKeysEditor, { keywords: 'remap keys', when: (st) => st.keyboard.vim.enabled }),
      ] },
      { title: 'Shortcuts', items: [
        I.custom('Shortcuts', 'Shortcuts work everywhere, but most can be used by a page first (like in Chrome). Tab, window and space shortcuts always go to the browser.', shortcutsEditor, { keywords: 'hotkeys keybindings ctrl' }),
      ] },
      { title: 'Extension shortcuts', id: 'extension-shortcuts', items: [
        I.custom('Extension shortcuts', 'Keys for things your extensions can do, like opening their popup.', extShortcutsEditor, { keywords: 'extensions commands hotkeys bitwarden dark reader' }),
      ] },
    ] },
    { id: 'extensions', title: 'Extensions', icon: 'puzzle', desc: '', groups: [
      { title: 'Extensions', items: [
        I.button('Manage extensions', 'Add, remove, pin and configure extensions.', 'Open extensions', () => command('openExtensions'), { iconName: 'puzzle' }),
        I.toggle('extensions.allowWebStore', 'Install from the Chrome Web Store', 'Visit the Web Store and click “Add to Chrome”.'),
        I.toggle('extensions.popupsInWindow', 'Open extension popups under their button', 'Inside the browser window, like Chrome. Turn off to open them as small separate windows.', { keywords: 'popup window extension bubble' }),
      ] },
    ] },
    { id: 'performance', title: 'Performance', icon: 'cpu', desc: 'How much memory Bifrost uses, and how hard it works.', groups: [
      { title: 'Profile', id: 'perf-profile', items: [
        I.custom('', '', perfProfiles, { keywords: 'performance memory ram profile maximum balanced saver custom speed' }),
        I.custom('Memory use right now', '', perfUsage, { stack: true, keywords: 'ram memory usage processes' }),
      ] },
      { title: 'What the profile does', id: 'perf-knobs', items: [
        I.custom('', '', perfKnobs, { keywords: 'sleep tabs sleeping animations effects blur previews throttling processes history memory' }),
      ] },
    ] },
    { id: 'advanced', title: 'Advanced', icon: 'wrench', desc: 'Things most people never need to change.', groups: [
      { title: 'Browsing', items: [
        I.seg('advanced.userAgentMode', 'Identify as', 'What sites are told this browser is.', [['chrome', 'Chrome'], ['electron', 'Bifrost'], ['custom', 'Custom']], { keywords: 'user agent ua' }),
        I.text('advanced.customUserAgent', 'Custom user agent', '', { wide: true, mono: true, when: (st) => st.advanced.userAgentMode === 'custom' }),
        I.custom('Per-site identity', 'Some sites only work with another browser’s user agent. Google sign-in needs Firefox’s.', siteUAEditor, { keywords: 'user agent google sign in' }),
      ] },
      { title: 'Network', items: [
        I.select('advanced.proxy.mode', 'Proxy', '', [['system', 'Use system settings'], ['direct', 'No proxy'], ['fixed', 'Manual'], ['pac', 'Automatic (PAC script URL)']]),
        I.text('advanced.proxy.rules', 'Proxy rules', 'For example “socks5://127.0.0.1:1080” or a PAC script address.', { wide: true, mono: true, when: (st) => st.advanced.proxy.mode === 'fixed' || st.advanced.proxy.mode === 'pac' }),
        I.text('advanced.proxy.bypass', 'Bypass for', 'Comma-separated hosts.', { wide: true, mono: true, when: (st) => st.advanced.proxy.mode === 'fixed' }),
      ] },
      { title: 'Performance', items: [
        I.toggle('advanced.hardwareAcceleration', 'Use hardware acceleration', 'Takes effect after a restart.', { restart: true }),
        I.toggle('advanced.smoothScrolling', 'Smooth scrolling', 'Takes effect after a restart.', { restart: true }),
        ...(win ? [I.toggle('advanced.middleClickAutoscroll', 'Scroll with the mouse wheel button', 'Click the wheel on a page, then move the mouse to scroll. For tabs opened after the change.', { keywords: 'autoscroll middle click wheel scroll' })] : []),
        ...(window.wb.platform === 'linux' ? [I.toggle('advanced.waylandNative', 'Run natively on Wayland', 'Takes effect after a restart.', { restart: true })] : []),
      ] },
    ] },
    { id: 'sync', title: 'Sync', icon: 'sync', desc: 'Your bookmarks, history, open tabs and settings on all your computers.', groups: [
      { title: 'Sync', items: [
        I.custom('Sync this computer', 'Through a folder that OneDrive, Google Drive, Dropbox, iCloud or Syncthing keeps the same on each computer: choose the same one on each. Bifrost keeps its files in a “Bifrost Sync” folder in it.', syncSwitch, { stack: false, keywords: 'sync onedrive google drive dropbox icloud syncthing other computers devices laptop desktop' }),
        I.custom('Sync folder', '', syncFolderWidget, { keywords: 'sync folder onedrive dropbox google drive icloud cloud' }),
        I.custom('Status', '', syncStatusWidget, { stack: false, when: (st) => st.sync.enabled, keywords: 'sync now' }),
      ] },
      { title: 'What to sync', id: 'sync-what', items: [
        I.toggle('sync.bookmarks', 'Bookmarks', '', { when: (st) => st.sync.enabled, keywords: 'sync' }),
        I.toggle('sync.history', 'History', 'What you visited in the last 60 days, and what you delete from history.', { when: (st) => st.sync.enabled, keywords: 'sync' }),
        I.toggle('sync.tabs', 'Open tabs', 'The tabs open on your other computers show in History, and under History in the menu.', { when: (st) => st.sync.enabled, keywords: 'sync devices' }),
        I.toggle('sync.settings', 'Settings', 'Theme, layout, search engines, shortcuts, privacy and the rest; not what belongs to one computer, like its zoom, download folder and performance profile.', { when: (st) => st.sync.enabled, keywords: 'sync preferences' }),
      ] },
      { title: 'Computers', id: 'sync-devices', items: [
        I.custom('This computer’s name', 'How your other computers list it.', syncNameWidget, { stack: false, when: (st) => st.sync.enabled, keywords: 'sync device name' }),
        I.custom('Your other computers', '', syncDevicesWidget, { when: (st) => st.sync.enabled, keywords: 'sync devices remove' }),
      ] },
    ] },
    { id: 'import', title: 'Import & backup', icon: 'import', desc: 'Bring bookmarks and history from other browsers; back up your settings.', groups: [
      { title: 'From another browser', items: [
        I.custom('Browsers on this computer', 'Firefox, Chrome, Vivaldi, Edge and Brave are supported.', importWidget, { keywords: 'firefox chrome vivaldi edge brave bookmarks history extensions' }),
        I.custom('Extensions', 'Bring extensions over from another browser, or from a browser profile folder (portable browsers keep theirs next to the app).', () => {
          const b = h('button.btn', { type: 'button' }, icon('puzzle'), 'Import extensions…');
          b.addEventListener('click', () => importExtensionsMenu(b));
          return { el: b, update: null };
        }, { stack: false, keywords: 'extensions add-ons addons import firefox chrome vivaldi' }),
      ] },
      { title: 'Files', items: [I.custom('Files', '', backupWidget, { keywords: 'export html json backup reset' })] },
    ] },
    { id: 'about', title: 'Default browser & about', icon: 'info', desc: '', groups: [
      { title: 'Bifrost', items: [I.custom('', '', aboutWidget, { keywords: 'default version profile portable' })] },
      { title: 'Updates', id: 'updates', items: [
        I.custom('Updates', 'New versions come from Bifrost’s releases on GitHub.', updatesWidget, { keywords: 'update upgrade version new release download restart' }),
        I.toggle('updates.auto', 'Download updates by themselves', 'In the background; a new version goes in the next time Bifrost starts (or when you choose Restart to update).', { keywords: 'automatic updates' }),
      ] },
    ] },
  ];
}

// ----------------------------------------------------------------- page
let SECTIONS = [];
let navItems = [];

function build() {
  items.length = 0;
  SECTIONS = sections();
  const holder = $('sections');
  holder.replaceChildren(...SECTIONS.map((sec) => {
    const el = h('section.section', { id: sec.id, dataset: { sec: sec.id } },
      h('h2.sec-title', null, sec.title),
      sec.desc ? h('p.sec-desc', null, sec.desc) : null,
      ...sec.groups.map((g) => h('div.group', { id: g.id || null }, h('div.card-title', null, g.title), h('div.card', null, g.items))));
    return el;
  }), h('div.no-results', { id: 'no-results', hidden: true }, 'No settings match your search.'));
  for (const it of items) it.update(page.settings);
  navItems = SECTIONS.map((sec) => h('a.nav-item', { href: '#' + sec.id, dataset: { sec: sec.id } }, icon(sec.icon), sec.title));
  $('nav').replaceChildren(...navItems);
}

function filter(q) {
  q = q.trim().toLowerCase();
  let any = false;
  for (const sec of document.querySelectorAll('.section')) {
    let secAny = false;
    for (const g of sec.querySelectorAll('.group')) {
      let gAny = false;
      for (const r of g.querySelectorAll('.card > .srow')) {
        const it = items.find((x) => x.el === r);
        const text = (it ? it.text : '') + ' ' + r.textContent.toLowerCase() + ' ' + g.querySelector('.card-title').textContent.toLowerCase() + ' ' + sec.querySelector('.sec-title').textContent.toLowerCase();
        const ok = !q || q.split(/\s+/).every((w) => text.includes(w));
        r.hidden = !ok;
        if (ok) gAny = true;
      }
      g.hidden = !gAny;
      if (gAny) secAny = true;
    }
    sec.hidden = !secAny;
    if (secAny) any = true;
  }
  $('no-results').hidden = any;
}

function showRestart() {
  if (document.getElementById('restart-bar')) return;
  const bar = h('div.restart-bar#restart-bar', null, icon('info'), h('span', null, 'Some changes take effect after Bifrost restarts.'),
    h('button.btn.primary', { type: 'button', onclick: () => wb.invoke('app:relaunch') }, 'Restart now'));
  $('sections').append(bar);
}

// Jumps to a section or group (again, if the address already points there).
function go(id) { if (location.hash === '#' + id) goToHash({ type: 'hashchange' }); else location.hash = id; }
let stopFollowing = null;

// Opening Settings at a section jumps straight there; choosing one while it's open glides there.
function goToHash(ev) {
  const raw = decodeURIComponent((location.hash || '').slice(1));
  if (!raw) return;
  const [id, arg] = raw.split('/');
  const target = document.getElementById(id === 'clear' ? 'clear' : id) || document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: ev && ev.type === 'hashchange' ? 'smooth' : 'instant' });
  // Lists above it (shortcuts, extensions, sites, sync's computers) fill in a moment later and push it down;
  // follow it for a few seconds, until you scroll or click yourself.
  if (stopFollowing) stopFollowing();
  let first = true;
  const ro = new ResizeObserver(() => { if (first) { first = false; return; } target.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  ro.observe($('sections'));
  const EVENTS = ['wheel', 'keydown', 'mousedown', 'touchstart'];
  const stop = () => { ro.disconnect(); clearTimeout(timer); for (const ev of EVENTS) window.removeEventListener(ev, stop, true); stopFollowing = null; };
  for (const ev of EVENTS) window.addEventListener(ev, stop, true);
  const timer = setTimeout(stop, 4000);
  stopFollowing = stop;
  if (id === 'sites' && arg) {
    setTimeout(() => { const s = document.getElementById('site-' + arg); if (s) { s.scrollIntoView({ block: 'center' }); s.classList.add('srow', 'hit'); } }, 300);
  }
  const card = target.matches('.group') ? target.querySelector('.card') : null;
  if (card) { card.classList.add('hit'); setTimeout(() => card.classList.remove('hit'), 1500); }
}

// Cards rise into view as you scroll to them (Animations → Bifrost pages).
function reveal() {
  if (!anim('internalPages') || !('IntersectionObserver' in window)) return;
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || seen.has(e.target)) continue;
      seen.add(e.target);
      io.unobserve(e.target);
      animate(e.target, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' }, 'internalPages');
    }
  }, { rootMargin: '0px 0px -20px 0px' });
  // Cards already on screen when the page opens don't animate (it would just look slow); the rest do.
  requestAnimationFrame(() => {
    for (const c of document.querySelectorAll('.group .card')) {
      const r = c.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) seen.add(c); else io.observe(c);
    }
  });
}

// Highlights the section you're looking at in the side navigation.
function spy() {
  const update = () => {
    const secs = [...document.querySelectorAll('.section:not([hidden])')];
    let cur = secs[0];
    for (const sec of secs) if (sec.getBoundingClientRect().top < 140) cur = sec;
    // Scrolled to the very bottom: the last sections may be too short to reach the top, so the last one
    // that's on screen is the one you're looking at.
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atEnd && secs.length) {
      const visible = secs.filter((sec) => sec.getBoundingClientRect().top < window.innerHeight - 80);
      if (visible.length) cur = visible[visible.length - 1];
    }
    if (cur) for (const n of navItems) n.classList.toggle('on', n.dataset.sec === cur.dataset.sec);
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------- start
await boot({
  title: 'Settings',
  onSettings: () => { for (const it of items) { try { it.update(page.settings); } catch (e) { console.error(e); } } },
});
$('title-ico').append(icon('sliders'));
$('search-ico').append(icon('search'));
build();
spy();
reveal();
const search = $('settings-q');
search.addEventListener('input', debounce(() => {
  if (redrawShortcuts) redrawShortcuts();
  filter(search.value);
}, 80));
search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; filter(''); } });
window.addEventListener('hashchange', goToHash);
setTimeout(goToHash, 50);
