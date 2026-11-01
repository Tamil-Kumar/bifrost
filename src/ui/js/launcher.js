// Bifrost browser UI — the launcher: a command bar over the whole window that searches bookmarks,
// open tabs, history, commands and web suggestions with Bifrost's ranking.
import { on, emit, activeTab, setting } from './state.js';
import { h, animate, anim, isNewTab } from './util.js';
import { icon } from './icons.js';
import { ResultList, makeSearcher, openResult, howFromEvent } from './results.js';
import { closeMenus, closePopovers } from './menus.js';

const wb = window.wb;
const SOURCE_LABEL = { bookmarks: 'Bookmarks', history: 'History', tabs: 'Tabs', commands: 'Commands', suggestions: 'Suggestions' };
const SOURCE_COLOR = { bookmarks: '--c-bookmark', history: '--c-history', tabs: '--c-tab', commands: '--c-command', suggestions: '--c-suggestion' };

let L = null; // the open launcher

export function isOpen() { return !!L; }

// mode: 'current' (open in this tab) | 'newtab' | 'split' | 'background'
export function openLauncher({ mode = 'current', text = '', selectText = false } = {}) {
  closeMenus();
  closePopovers();
  if (L) { L.setMode(mode); L.setText(text, selectText); return; }
  const prevFocus = document.activeElement;
  const cfg = setting('launcher');
  const input = h('input.l-q', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Search bookmarks, tabs, history and the web', 'aria-label': 'Search' });
  const chip = h('span.l-mode', { hidden: true });
  const results = new ResultList({ onPick: (it, how) => pick(it, how), className: 'l-results' });
  const empty = h('p.l-empty', { hidden: true });
  const hints = h('div.l-hints');
  const gear = h('button.l-gear', { type: 'button', title: 'Launcher settings', onclick: () => { close(); emit('command', 'openSettings', { section: 'launcher' }); } }, icon('sliders'));
  const panel = h('div.launcher', { role: 'dialog', 'aria-label': 'Launcher' },
    h('header.l-bar', null, h('span.l-lens', null, icon('search')), input, chip),
    results.el, empty,
    cfg.showHints ? h('footer.l-foot', null, hints, gear) : null);
  const back = h('div.launcher-back');
  const layer = h('div.launcher-layer', null, back, panel);
  layer.style.setProperty('--l-width', Math.max(420, Math.min(1000, cfg.width || 680)) + 'px');
  layer.style.setProperty('--l-top', Math.max(2, Math.min(40, cfg.top ?? 14)) + 'vh');
  layer.style.setProperty('--l-dim', String(Math.max(0, Math.min(0.9, cfg.dim ?? 0.35))));
  layer.classList.toggle('blur', !!cfg.blur);
  document.getElementById('overlay-root').append(layer);
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

  function renderHints() {
    const k = (key, label) => h('span', null, h('kbd', null, key), label);
    hints.replaceChildren(
      k('↵', curMode === 'newtab' ? 'New tab' : curMode === 'split' ? 'Split view' : 'Open'),
      curMode !== 'newtab' ? k('Alt+↵', 'New tab') : k('Alt+↵', 'Here'),
      k('Shift+↵', 'Split'),
      k('Ctrl+↵', 'Background'),
      k(setting('launcher.prefixes.commands') || '>', 'Commands'));
  }

  function pick(it, how) {
    if (!it) return;
    let where = how || defaultHow();
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
    return curMode;
  }

  function onKey(e) {
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); return;
      case 'ArrowDown': e.preventDefault(); results.move(1); return;
      case 'ArrowUp': e.preventDefault(); results.move(-1); return;
      case 'Tab': e.preventDefault(); results.move(e.shiftKey ? -1 : 1); return;
      case 'PageDown': e.preventDefault(); results.page(1); return;
      case 'PageUp': e.preventDefault(); results.page(-1); return;
      case 'Enter': {
        e.preventDefault();
        if (!input.value.trim() && curMode === 'newtab' && !results.current()) { close({ restoreFocus: false }); emit('command', 'newTabPage'); return; }
        const it = results.current();
        if (it) pick(it, howFromEvent(e));
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
    const out = anim('launcher') ? Promise.all([
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
  if (anim('launcher')) {
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
