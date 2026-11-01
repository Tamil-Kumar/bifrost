// Bifrost — shared runtime for the internal pages (bifrost://settings, history, bookmarks…):
// theme and animation settings, settings access, and the components shared with the window UI.
import { h, setAnimConfig, setupRipples } from './util.js';

export * from './util.js';
export { icon, iconHTML, ICONS } from './icons.js';
export { showMenu, popover, place, closeMenus, closePopovers } from './menus.js';
export { dialog, confirmDialog, promptDialog, toast } from './dialogs.js';

export const wb = window.wb;
export const page = { settings: null, defaults: null, systemDark: true };
const root = document.documentElement;
const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const s = page.settings;
  if (!s) return;
  const a = s.appearance;
  const t = window.WBThemes.resolve(a, { systemDark: page.systemDark });
  for (const [k, v] of Object.entries(window.WBThemes.cssVars(t, a))) root.style.setProperty(k, v);
  root.dataset.scheme = t.dark ? 'dark' : 'light';
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  root.style.fontSize = (14 * Math.max(0.75, Math.min(1.5, a.uiScale || 1))).toFixed(2) + 'px';
  root.dataset.shadows = a.shadows || 'normal';
  root.dataset.menus = a.menuStyle || 'solid';
  root.dataset.toasts = a.toastPosition || 'bottom';
  root.dataset.scrollbars = a.scrollbars || 'thin';
  root.dataset.chrome = ['aurora', 'gradient', 'flat'].includes(a.chrome) ? a.chrome : 'aurora';
  const an = s.animations;
  const reduced = !!(an.respectReducedMotion && reducedMQ.matches);
  const p = window.WBDefaults.perf(s);
  const enabled = !!an.enabled && !reduced && p.animations;
  root.classList.toggle('low-visuals', !!p.lowVisuals);
  root.classList.toggle('anim-off', !enabled);
  root.classList.toggle('no-newTabPage', enabled && an.newTabPage === false);
  const st = window.WBDefaults.animStyle(s);
  root.style.setProperty('--anim-mult', String(st.time / Math.max(0.1, Number(an.speed) || 1)));
  root.style.setProperty('--anim-amp', String(st.amp));
  root.style.setProperty('--ease-enter', st.spring ? 'cubic-bezier(.34, 1.45, .64, 1)' : 'cubic-bezier(.16, 1, .3, 1)');
  root.dataset.animStyle = an.style || 'smooth';
  for (const k of ['buttons', 'internalPages', 'ripple']) root.classList.toggle('no-' + k, enabled && an[k] === false);
  setAnimConfig(an, reduced, { off: !p.animations });
}

// Loads settings, applies the theme and keeps it in step. Returns the settings.
export async function boot({ title, onSettings } = {}) {
  if (!document.getElementById('overlay-root')) document.body.append(h('div#overlay-root'));
  page.systemDark = darkMQ.matches;
  page.settings = await wb.invoke('settings:get');
  applyTheme();
  wb.on('settings-changed', ({ path, settings }) => {
    page.settings = settings;
    applyTheme();
    if (onSettings) onSettings(path || '');
  });
  wb.on('system-theme', ({ dark }) => { page.systemDark = !!dark; applyTheme(); });
  darkMQ.addEventListener('change', () => { page.systemDark = darkMQ.matches; applyTheme(); });
  reducedMQ.addEventListener('change', applyTheme);
  if (title) document.title = title;
  setupRipples();
  requestAnimationFrame(() => root.classList.add('ready'));
  return page.settings;
}

export const get = (path) => window.WBDefaults.getPath(page.settings, path);
export const set = (path, value) => wb.invoke('settings:set', path, value);
export async function defaults() {
  if (!page.defaults) page.defaults = await wb.invoke('settings:defaults');
  return page.defaults;
}

// Opens something in the browser (a tab by default): where = current | newtab | background | window.
export function openUrl(url, opts = {}) { wb.send('app:open-url', String(url), opts); }
export function command(id, args) { wb.send('app:command', id, args || {}); }

// A row of tabs inside a page.
export function segmented(options, value, onChange) {
  const el = h('div.seg');
  const draw = (v) => el.replaceChildren(...options.map(([val, label, ic]) => {
    const b = h('button.seg-btn' + (val === v ? '.on' : ''), { type: 'button', onclick: () => { draw(val); onChange(val); } }, label);
    if (ic) b.prepend(ic);
    return b;
  }));
  draw(value);
  return el;
}

export function switchEl(checked, onChange, { disabled = false, label = '' } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled, role: 'switch', 'aria-label': label || null });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch' + (disabled ? '.disabled' : ''), null, input, h('span.switch-track', null, h('span.switch-thumb')));
}
