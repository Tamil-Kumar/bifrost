// Bifrost browser UI — applies the theme, layout options and animation switches to the document.
import { S, on, curWs, activeTab } from './state.js';
import { setAnimConfig, isInternal } from './util.js';

const root = document.documentElement;
const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
export const ANIM_AREAS = ['tabOpenClose', 'tabSwitch', 'tabDrag', 'tabHover', 'loadingIndicator', 'workspaceSwitch', 'splitView', 'launcher', 'menus', 'panels', 'sidebar', 'pageTransitions', 'toasts', 'newTabPage', 'buttons', 'internalPages', 'bookmarksBar', 'ripple'];

let lastCaption = '';
let theme = null;          // the palette in use (resolved from the settings)
let blendVars = null;      // with "Match the page": the colors from the current page (shared/themes.js blendVars)
let blendKey = '';

export function applyTheme() {
  const a = S.settings.appearance;
  const ws = curWs();
  const t = window.WBThemes.resolve(a, { systemDark: S.systemDark, workspaceColor: ws && ws.color });
  theme = t;
  const vars = window.WBThemes.cssVars(t, a);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.scheme = t.dark ? 'dark' : 'light';
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  root.style.setProperty('--theme-name', JSON.stringify(t.name || ''));

  // Private windows get a violet tint regardless of theme.
  if (S.isPrivate) {
    const mix = window.WBThemes.mix;
    root.style.setProperty('--mantle', t.dark ? mix(t.mantle, '#7c3aed', 0.16) : mix(t.mantle, '#7c3aed', 0.12));
    root.style.setProperty('--crust', t.dark ? mix(t.crust, '#7c3aed', 0.14) : mix(t.crust, '#7c3aed', 0.1));
    root.style.setProperty('--accent', t.dark ? '#c4a7ff' : '#7c3aed');
  }

  blendKey = '';
  applyBlend();
}

// Windows draws its caption buttons over the corner; keep their colors in step with ours (the page's,
// with "Match the page").
function syncCaption() {
  if (!theme || S.platform !== 'win32' || S.ownCaption) return;
  const bg = blendVars ? blendVars['--mantle'] : getComputedStyle(root).getPropertyValue('--mantle').trim() || theme.mantle;
  const symbol = blendVars ? blendVars['--text'] : theme.text;
  const caption = bg + '|' + symbol + '|' + JSON.stringify(S.settings.appearance.sizes || {});
  if (caption === lastCaption) return;
  lastCaption = caption;
  window.wb.send('window:caption-colors', { background: bg, symbol });
}

// "Match the page" (Look & feel → Sidebar and toolbar): the color the window around the page takes from
// the current tab: its page's color along the edge next to the sidebar (or along the top, with tabs on
// top). Bifrost's own pages, error pages and pages not measured yet keep the theme's colors.
export function pageTint() {
  const a = S.settings.appearance;
  if (a.blend !== 'page') return '';
  const t = activeTab();
  if (!t || !t.pageColor || isInternal(t.url) || t.error || t.crashed) return '';
  const edge = a.tabLayout === 'horizontal' ? 'top' : a.sidebarSide === 'right' ? 'right' : 'left';
  return t.pageColor[edge] || t.pageColor.left || '';
}

export function applyBlend() {
  if (!theme) return;
  const tint = pageTint();
  const key = tint + '|' + theme.name + '|' + theme.accent + '|' + theme.accent2;
  if (key === blendKey) return;
  blendKey = key;
  blendVars = tint ? window.WBThemes.blendVars(tint, theme) : null;
  let style = document.getElementById('blend-vars');
  if (!style) { style = document.createElement('style'); style.id = 'blend-vars'; document.head.appendChild(style); }
  const decl = blendVars ? Object.entries(blendVars).filter(([k]) => k.startsWith('--')).map(([k, v]) => `${k}: ${v};`).join(' ') : '';
  // (on the bars only: menus, dialogs and side panels keep the theme)
  style.textContent = blendVars ? `:root.blend { --page-tint: ${tint}; }\n:root.blend #sidebar, :root.blend #topbar { ${decl} }` : '';
  root.classList.toggle('blend', !!blendVars);
  root.dataset.blendScheme = blendVars ? (blendVars.dark ? 'dark' : 'light') : '';
  syncCaption();
}

export function applyLayout() {
  const a = S.settings.appearance;
  root.dataset.layout = a.tabLayout === 'horizontal' ? 'horizontal' : 'vertical';
  root.dataset.side = a.sidebarSide === 'right' ? 'right' : 'left';
  root.dataset.density = a.density || 'comfortable';
  root.dataset.closeButtons = a.showTabCloseButtons || 'hover';
  root.dataset.platform = S.platform;
  root.classList.toggle('sidebar-collapsed', !!a.sidebarCollapsed);
  root.classList.toggle('sidebar-autohide', !!a.sidebarAutoHide);
  root.classList.toggle('topbar-autohide', !!a.topbarAutoHide);
  root.classList.toggle('own-caption', !!S.ownCaption);
  root.classList.toggle('no-page-frame', a.pageFrame === false);
  root.dataset.shadows = a.shadows || 'normal';
  root.dataset.menus = a.menuStyle || 'solid';
  root.dataset.activeTab = a.activeTab || 'card';
  root.dataset.loading = a.loadingStyle || 'both';
  root.dataset.toasts = a.toastPosition || 'bottom';
  root.dataset.scrollbars = a.scrollbars || 'thin';
  root.dataset.chrome = ['aurora', 'gradient', 'flat'].includes(a.chrome) ? a.chrome : 'aurora';
  root.dataset.texture = a.texture === false ? 'off' : 'on';
  root.classList.toggle('addr-centered', !!(a.address && a.address.centered));
  const fly = Object.assign({ showDelay: 0, hideDelay: 300, duration: 220, edge: 6 }, a.flyout || {});
  root.style.setProperty('--flyout-dur', Math.max(0, Math.min(1500, Number(fly.duration) || 0)) + 'ms');
  root.style.setProperty('--flyout-edge', Math.max(2, Math.min(40, Number(fly.edge) || 6)) + 'px');
  root.classList.toggle('compact', !!a.compactToolbar);
  root.classList.toggle('no-bookmarks-bar', !a.showBookmarksBar);
  root.classList.toggle('no-ws-strip', !a.showWorkspaceStrip || !S.settings.workspaces.showSwitcher);
  root.classList.toggle('private', !!S.isPrivate);
  root.classList.toggle('system-frame', !!a.useSystemTitleBar);
  root.style.setProperty('--sidebar-w', Math.max(180, Math.min(520, a.sidebarWidth || 264)) + 'px');
  root.style.setProperty('--tab-min', (a.horizontalTabMinWidth || 96) + 'px');
  root.style.setProperty('--tab-max', (a.horizontalTabMaxWidth || 232) + 'px');
  root.style.setProperty('--split-gap', (S.settings.split.gap ?? 6) + 'px');
  root.style.fontSize = (13 * Math.max(0.75, Math.min(1.5, a.uiScale || 1))).toFixed(2) + 'px';
  root.style.setProperty('--font', a.font || 'system-ui, sans-serif');
  root.style.setProperty('--mono', a.monoFont || 'monospace');
  let style = document.getElementById('user-css');
  if (!style) { style = document.createElement('style'); style.id = 'user-css'; document.head.appendChild(style); }
  if (style.textContent !== (a.customCss || '')) style.textContent = a.customCss || '';
}

export function applyAnimations() {
  const an = S.settings.animations;
  const reduced = !!(an.respectReducedMotion && reducedMQ.matches);
  const p = window.WBDefaults.perf(S.settings);
  const enabled = !!an.enabled && !reduced && p.animations;
  root.classList.toggle('low-visuals', !!p.lowVisuals);
  root.classList.toggle('anim-off', !enabled);
  for (const k of ANIM_AREAS) root.classList.toggle('no-' + k, enabled && an[k] === false);
  const st = window.WBDefaults.animStyle(S.settings);
  root.style.setProperty('--anim-mult', String(st.time / Math.max(0.1, Number(an.speed) || 1)));
  root.style.setProperty('--anim-amp', String(st.amp));
  root.style.setProperty('--ease-enter', st.spring ? 'cubic-bezier(.34, 1.45, .64, 1)' : 'cubic-bezier(.16, 1, .3, 1)');
  root.dataset.animStyle = an.style || 'smooth';
  root.classList.toggle('reduced-motion-os', reduced);
  setAnimConfig(an, reduced, { off: !p.animations });
}

export function applyWindowState() {
  root.classList.toggle('maximized', !!S.maximized);
  root.classList.toggle('fullscreen', !!S.fullscreen);
  root.classList.toggle('blurred', !S.focused);
}

export function applyAll() {
  applyLayout();
  applyAnimations();
  applyTheme();
  applyWindowState();
}

export function init() {
  applyAll();
  on('settings', (path) => {
    if (!path || path.startsWith('appearance') || path.startsWith('workspaces') || path.startsWith('split')) { applyLayout(); applyTheme(); }
    if (!path || path.startsWith('animations') || path.startsWith('performance')) applyAnimations();
  });
  on('workspace', () => applyTheme());
  on('active', () => applyBlend());
  on('tab', (t, patch) => { if (t === activeTab() && ('pageColor' in patch || 'url' in patch || 'error' in patch || 'crashed' in patch)) applyBlend(); });
  reducedMQ.addEventListener('change', applyAnimations);
}
