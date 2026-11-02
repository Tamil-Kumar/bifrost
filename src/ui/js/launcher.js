// Bifrost browser UI — the launcher: a command bar over the window that searches bookmarks, open tabs,
// history, commands and web suggestions with Bifrost's ranking. How it opens, behaves and looks is
// Settings → Launcher, which has every setting of the Waypoint extension it grew out of.
import { S, on, emit, activeTab, setting, curWs } from './state.js';
import { h, animate, anim, isNewTab } from './util.js';
import { icon } from './icons.js';
import { ResultList, makeSearcher, openResult, howFromEvent } from './results.js';
import { closeMenus, closePopovers } from './menus.js';

const wb = window.wb;
const SOURCE_LABEL = { bookmarks: 'Bookmarks', history: 'History', tabs: 'Tabs', commands: 'Commands', suggestions: 'Suggestions' };
const SOURCE_COLOR = { bookmarks: '--c-bookmark', history: '--c-history', tabs: '--c-tab', commands: '--c-command', suggestions: '--c-suggestion' };
const ACTIONS = ['current', 'newtab', 'background', 'split'];
const ACTION_LABEL = { current: 'Open', newtab: 'New tab', background: 'Background tab', split: 'Split view' };

let L = null; // the open launcher

export function isOpen() { return !!L; }

// Settings → Launcher → Appearance, on the launcher's own layer: a theme of its own (or the browser's with
// another accent), its font, text size, corners and density, and custom CSS (scoped to it).
function applyLook(layer, panel, cfg) {
  const a = S.settings.appearance;
  let key = cfg.theme || 'browser';
  if (key === 'auto') key = S.systemDark === false ? 'latte' : 'mocha';
  const own = key !== 'browser' && !!window.WBThemes.THEMES[key];
  if (own || cfg.useCustomAccent) {
    const ws = curWs();
    const base = own ? { theme: key } : Object.assign({}, a);
    const t = window.WBThemes.resolve(Object.assign(base, { useCustomAccent: !!cfg.useCustomAccent, accent: cfg.accent }), { systemDark: S.systemDark, workspaceColor: ws && ws.color });
    for (const [k, v] of Object.entries(window.WBThemes.cssVars(t, {}))) if (v && !/^--(r-|caption|btn|icon|addr|tab|sb|gap|bm|ui-)/.test(k)) layer.style.setProperty(k, v);
    layer.classList.add('themed');
    layer.dataset.scheme = t.dark ? 'dark' : 'light';
  } else {
    layer.dataset.scheme = document.documentElement.dataset.scheme || 'dark';
  }
  if (cfg.font && String(cfg.font).trim()) panel.style.fontFamily = cfg.font;
  if (cfg.fontSize > 0) panel.style.fontSize = Math.max(9, Math.min(28, cfg.fontSize)) + 'px';
  if (cfg.radius >= 0) {
    const r = Math.max(0, Math.min(32, cfg.radius));
    panel.style.borderRadius = r + 'px';
    layer.style.setProperty('--r-item', Math.round(r * 0.7) + 'px');
  }
  layer.dataset.density = cfg.density === 'compact' ? 'compact' : 'comfortable';
  let style = document.getElementById('launcher-css');
  const css = String(cfg.customCss || '').trim();
  if (!style) { style = document.createElement('style'); style.id = 'launcher-css'; document.head.appendChild(style); }
  // (nested in the launcher, so ".row" means the launcher's rows and nothing else in the window)
  const text = css ? `.launcher-layer {\n${css}\n}` : '';
  if (style.textContent !== text) style.textContent = text;
}

// Where it goes: over the page near the top (the default), as a centered window, or (from the toolbar
// button, with "Toolbar button opens: a popup under it") under or beside the button.
function place(layer, panel, cfg, anchor) {
  const W = innerWidth, H = innerHeight;
  const width = Math.max(320, Math.min(1000, cfg.width || 680));
  layer.style.setProperty('--l-width', width + 'px');
  layer.style.setProperty('--l-top', Math.max(2, Math.min(40, cfg.top ?? 14)) + 'vh');
  if (anchor && anchor.isConnected) {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(width, W - 24);
    layer.classList.add('anchored');
    const sidebar = anchor.closest('#sidebar');
    if (sidebar) {
      // Beside the sidebar, level with the button: hanging down from it, or (a button low in the sidebar)
      // rising from it.
      const sb = sidebar.getBoundingClientRect();
      const left = Math.max(12, Math.min(W - w - 12, document.documentElement.dataset.side === 'right' ? sb.left - w - 8 : sb.right + 8));
      if (r.top > H / 2) {
        const bottom = Math.max(8, H - r.bottom);
        Object.assign(panel.style, { left: left + 'px', top: 'auto', bottom: bottom + 'px', marginLeft: '0', width: w + 'px', maxHeight: (H - bottom - 12) + 'px' });
      } else {
        const top = Math.max(8, r.top);
        Object.assign(panel.style, { left: left + 'px', top: top + 'px', marginLeft: '0', width: w + 'px', maxHeight: (H - top - 12) + 'px' });
      }
      return 'anchored';
    }
    // Under the button: from its left edge, or ending at its right edge on the right half of the window.
    const left = Math.max(12, Math.min(W - w - 12, r.left + r.width / 2 > W / 2 ? r.right - w : r.left));
    const top = Math.max(8, Math.min(H - 160, r.bottom + 6));
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', marginLeft: '0', width: w + 'px', maxHeight: (H - top - 12) + 'px' });
    return 'anchored';
  }
  if (cfg.openMode === 'window') {
    layer.classList.add('as-window');
    layer.style.setProperty('--l-height', Math.max(240, Math.min(H - 48, cfg.windowHeight || 540)) + 'px');
    return 'window';
  }
  return 'overlay';
}

// mode: 'current' (open in this tab) | 'newtab' | 'split' | 'background'
// anchor: the toolbar or sidebar button it was opened from, to open under (see place()).
export function openLauncher({ mode = 'current', text = '', selectText = false, anchor = null } = {}) {
  closeMenus();
  closePopovers();
  if (L) { L.setMode(mode); L.setText(text, selectText); return; }
  const prevFocus = document.activeElement;
  const cfg = setting('launcher');
  const input = h('input#q.l-q.q', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Search bookmarks, tabs, history and the web', 'aria-label': 'Search' });
  const chip = h('span.l-mode', { hidden: true });
  const results = new ResultList({ onPick: (it, how, e) => pick(it, how, e), className: 'l-results', look: () => setting('launcher') });
  const empty = h('p.l-empty.empty', { hidden: true });
  const hints = h('div.l-hints.hints');
  const gear = h('button.l-gear', { type: 'button', title: 'Launcher settings', onclick: () => { close(); emit('command', 'openSettings', { section: 'launcher' }); } }, icon('sliders'));
  const panel = h('div.launcher.wp', { role: 'dialog', 'aria-label': 'Launcher' },
    h('header.l-bar.bar', null, h('span.l-lens', null, icon('search')), input, chip),
    results.el, empty,
    cfg.showHints ? h('footer.l-foot.foot', null, hints, gear) : null);
  const back = h('div.launcher-back');
  const layer = h('div.launcher-layer', null, back, panel);
  layer.style.setProperty('--l-dim', String(Math.max(0, Math.min(0.9, cfg.dim ?? 0.35))));
  layer.classList.toggle('blur', !!cfg.blur);
  const motion = cfg.animations !== false && anim('launcher');
  layer.classList.toggle('no-motion', !motion);
  applyLook(layer, panel, cfg);
  document.getElementById('overlay-root').append(layer);
  const where = place(layer, panel, cfg, anchor);
  document.documentElement.classList.add('launcher-open');

  let curMode = mode;
  let lastQuery = null;
  const searcher = makeSearcher((r, final, raw) => {
    if (!L || raw !== input.value) return;
    lastQuery = r.query;
    results.set(r.items, r.query);
    updateChip(r.query);
    empty.hidden = !!r.items.length || !raw.trim() && !final;
    if (!r.items.length) empty.textContent = raw.trim() ? 'No matches' : 'Start typing to search';
  });

  function updateChip(q) {
    let label = '', color = '--accent';
    if (q && q.engine) { label = q.engine.name; }
    else if (q && q.only) { label = SOURCE_LABEL[q.only] || q.only; color = SOURCE_COLOR[q.only] || color; }
    else if (curMode === 'newtab') label = 'New tab';
    else if (curMode === 'split') label = 'Split view';
    else if (curMode === 'background') label = 'Background tab';
    chip.hidden = !label;
    chip.textContent = label;
    chip.style.setProperty('--chip', `var(${color})`);
  }

  const enterAction = () => (ACTIONS.includes(cfg.enterAction) ? cfg.enterAction : 'current');
  const shiftAction = () => (ACTIONS.includes(cfg.shiftEnterAction) ? cfg.shiftEnterAction : 'split');

  function renderHints() {
    const k = (key, label) => h('span', null, h('kbd', null, key), label);
    const enter = curMode === 'current' ? ACTION_LABEL[enterAction()] : curMode === 'newtab' ? 'New tab' : ACTION_LABEL[curMode] || 'Open';
    hints.replaceChildren(
      k('↵', enter),
      curMode !== 'newtab' ? k('Alt+↵', 'New tab') : k('Alt+↵', 'Here'),
      k('Shift+↵', ACTION_LABEL[shiftAction()]),
      k('Ctrl+↵', 'Background'),
      k(setting('launcher.prefixes.commands') || '>', 'Commands'));
  }

  // how: from the modifier keys (results.js howFromEvent), or null for a plain Enter or click. Shift alone
  // is Settings → Launcher → Shift+Enter; a plain Enter in the launcher of the current tab is → Enter.
  function pick(it, how, e) {
    if (!it) return;
    let where = how || defaultHow();
    if (e && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) where = shiftAction();
    if (how === 'newtab' && curMode === 'newtab') where = 'current';
    close({ restoreFocus: false });
    openResult(it, where);
  }

  function defaultHow() {
    if (curMode === 'newtab') {
      // Ctrl+T over a blank new tab just uses it.
      const act = activeTab();
      if (act && isNewTab(act.url) && !act.canGoBack && !act.loading) return 'current';
      return 'newtab';
    }
    if (curMode === 'current') return enterAction();
    return curMode;
  }

  function onKey(e) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        // Settings → Launcher → "Esc clears the query first".
        if (cfg.escClears && input.value) { input.value = ''; results.reset(); searcher.run(''); return; }
        close();
        return;
      case 'ArrowDown': e.preventDefault(); results.move(1); return;
      case 'ArrowUp': e.preventDefault(); results.move(-1); return;
      case 'Tab': e.preventDefault(); results.move(e.shiftKey ? -1 : 1); return;
      case 'PageDown': e.preventDefault(); results.page(1); return;
      case 'PageUp': e.preventDefault(); results.page(-1); return;
      case 'Enter': {
        e.preventDefault();
        if (!input.value.trim() && curMode === 'newtab' && !results.current()) { close({ restoreFocus: false }); emit('command', 'newTabPage'); return; }
        const it = results.current();
        if (it) pick(it, howFromEvent(e), e);
        else if (input.value.trim()) emit('command', 'noop');
        return;
      }
      case 'Delete': {
        // Shift+Delete removes a history entry (like Chrome).
        const it = results.current();
        if (e.shiftKey && it && it.type === 'history') {
          e.preventDefault();
          wb.invoke('history:delete-url', it.url).then(() => searcher.run(input.value)).catch(() => {});
        }
        return;
      }
      default:
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (!L) return;
    L = null;
    searcher.cancel();
    input.removeEventListener('keydown', onKey);
    document.documentElement.classList.remove('launcher-open');
    const out = motion ? Promise.all([
      animate(panel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.985)' }], { duration: 110, easing: 'ease-in', fill: 'forwards' }, 'launcher'),
      animate(back, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }, 'launcher'),
    ]) : Promise.resolve();
    out.then(() => layer.remove());
    if (restoreFocus) {
      if (prevFocus && document.contains(prevFocus) && prevFocus !== document.body) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
      else { const t = activeTab(); if (t) emit('focus-tab', t); }
    }
  }

  input.addEventListener('keydown', onKey);
  input.addEventListener('input', () => { results.reset(); searcher.run(input.value); });
  input.addEventListener('blur', () => {
    // Clicking a page or another app closes the launcher.
    setTimeout(() => { if (L && !layer.contains(document.activeElement)) close({ restoreFocus: false }); }, 0);
  });
  back.addEventListener('mousedown', (e) => { e.preventDefault(); close(); });
  panel.addEventListener('mousedown', (e) => { if (e.target !== input && !e.target.closest('button')) e.preventDefault(); });

  L = {
    close,
    where,
    setMode(m) { curMode = m; renderHints(); updateChip(lastQuery); },
    setText(t, sel) {
      input.value = t || '';
      input.focus();
      if (sel) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
      results.reset();
      searcher.run(input.value);
    },
  };
  renderHints();
  updateChip(null);
  if (motion) {
    animate(back, [{ opacity: 0 }, { opacity: 1 }], { duration: 140 }, 'launcher');
    animate(panel, [{ opacity: 0, transform: 'translateY(-8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.16,1,.3,1)' }, 'launcher');
  }
  L.setText(text, selectText);
  return L;
}

export function closeLauncher() { if (L) L.close(); }

// Ctrl+L in compact mode, or "Edit address": the launcher prefilled with the page address.
export function editAddress() {
  const t = activeTab();
  const url = t && !isNewTab(t.url) ? t.url : '';
  openLauncher({ mode: 'current', text: url, selectText: true });
}

export function init() {
  on('launcher-search', (text) => openLauncher({ mode: 'current', text }));
}
