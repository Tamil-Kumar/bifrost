// Bifrost browser UI — the launcher: a command bar over the window that searches bookmarks, open tabs,
// history, commands and web suggestions with Bifrost's ranking. How it opens, behaves and looks is
// Settings → Launcher, which has every setting of the Waypoint extension it grew out of.
import { S, on, emit, activeTab, setting, curWs, tabById } from './state.js';
import { h, animate, anim, isNewTab, copyText } from './util.js';
import { icon } from './icons.js';
import { ResultList, makeSearcher, openResult } from './results.js';
import { closeMenus, closePopovers } from './menus.js';
import { toast } from './prompts.js';
import * as T from './tabs.js';

const wb = window.wb;
const SOURCE_LABEL = { bookmarks: 'Bookmarks', history: 'History', tabs: 'Tabs', commands: 'Commands', suggestions: 'Suggestions' };
const SOURCE_COLOR = { bookmarks: '--c-bookmark', history: '--c-history', tabs: '--c-tab', commands: '--c-command', suggestions: '--c-suggestion' };
const ACTION_LABEL = { current: 'This tab', newtab: 'New tab', background: 'Background tab', window: 'New window', private: 'Private window', split: 'Split view', copy: 'Copy address', web: 'Search the web' };

let L = null; // the open launcher

export function isOpen() { return !!L && !L.closed; }

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

// Commands that open the launcher again, for something else (split view with a tab you pick, the
// command palette, searching tabs): picked in the launcher, they reuse it instead of closing it first.
const REOPENS = new Set(['splitPick', 'tabSearch', 'commandPalette', 'launcherNewTab']);
let lastText = '';   // what was typed when it last closed (Settings → Launcher → "Opens with what you last typed")

// mode: 'current' (Enter opens as Settings → Launcher → Opening results says) | 'newtab' (opened for a new
// tab: "this tab" is the new one) | 'split' (to pick a tab for split view) | 'background' | 'address' (to
// edit the page's address: Enter opens in this tab)
// anchor: the toolbar or sidebar button it was opened from, to open under (see place()).
export function openLauncher({ mode = 'current', text = '', selectText = false, anchor = null } = {}) {
  closeMenus();
  closePopovers();
  if (L && !L.closed) { L.setMode(mode); L.setText(text, selectText); return L; }
  const LS = window.WBLauncher;
  // (where the keyboard goes back to when it closes: never a launcher that's on its way out)
  const prevFocus = document.activeElement && !document.activeElement.closest('.launcher-layer') ? document.activeElement : null;
  const cfg = setting('launcher');
  const engines = setting('search.engines') || [];
  const engine = engines.find((x) => x.id === setting('search.defaultEngine')) || engines[0];
  const input = h('input#q.l-q.q', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: `Search bookmarks, tabs, history and ${engine ? engine.name : 'the web'}`, 'aria-label': 'Search' });
  const clear = h('button.l-clear', { type: 'button', title: 'Clear', 'aria-label': 'Clear', hidden: true }, icon('close'));
  const chip = h('span.l-mode', { hidden: true });
  // (picking a tab for split view, a tab result doesn't switch to that tab: it goes beside this one)
  const results = new ResultList({ onPick: (it, how, e) => pick(it, e), className: 'l-results', look: () => (curMode === 'split' ? Object.assign({}, setting('launcher'), { tabBadge: 'Split view' }) : setting('launcher')) });
  const empty = h('p.l-empty.empty', { hidden: true });
  const hints = h('div.l-hints.hints');
  const gear = h('button.l-gear', { type: 'button', title: 'Launcher settings', onclick: () => openSettings() }, icon('sliders'));
  const panel = h('div.launcher.wp', { role: 'dialog', 'aria-label': 'Launcher' },
    h('header.l-bar.bar', null, h('span.l-lens', null, icon('search')), input, clear, chip),
    results.el, empty,
    cfg.showHints ? h('footer.l-foot.foot', null, hints, gear) : null);
  const back = h('div.launcher-back');
  const layer = h('div.launcher-layer', null, back, panel);
  layer.style.setProperty('--l-dim', String(Math.max(0, Math.min(0.9, cfg.dim ?? 0.35))));
  layer.classList.toggle('blur', !!cfg.blur);
  const motion = cfg.animations !== false && anim('launcher');
  layer.classList.toggle('no-motion', !motion);
  layer.dataset.highlight = ['bold', 'none'].includes(cfg.highlight) ? cfg.highlight : 'accent';
  applyLook(layer, panel, cfg);
  // (a layer left behind by anything that went wrong would cover the whole window: never more than one)
  for (const old of document.querySelectorAll('.launcher-layer:not(.closing)')) old.remove();
  document.getElementById('overlay-root').append(layer);
  let where = place(layer, panel, cfg, anchor);
  document.documentElement.classList.add('launcher-open');

  const keyFor = LS.keyMatcher(cfg);
  let curMode = mode;
  let lastQuery = null;
  let shownFor = null;     // the text the results on screen are for
  let picking = false;
  const searcher = makeSearcher((r, final, raw) => {
    if (me.closed || raw !== input.value) return;
    show(r, raw);
    empty.hidden = !!results.items.length || !raw.trim() && !final;
    if (!results.items.length) {
      empty.textContent = curMode === 'split' && r.query && r.query.only === 'tabs' && !r.query.text ? 'No other tabs to put beside this one'
        : raw.trim() ? 'No matches' : 'Start typing to search';
    }
  });

  // Picking a tab for split view: not the tab in front, nor one already beside it.
  function forMode(items) {
    if (curMode !== 'split') return items;
    const act = activeTab();
    const sp = act && act.splitId && S.splits.find((x) => x.id === act.splitId);
    const skip = new Set(sp ? sp.tabIds : act ? [act.id] : []);
    return items.filter((it) => !(it.type === 'tab' && it.tab && it.tab.windowId === S.windowId && skip.has(it.tab.tabId)));
  }
  function show(r, raw) {
    lastQuery = r.query;
    shownFor = raw;
    results.set(forMode(r.items || []), r.query);
    updateChip(r.query);
  }

  // (picking a tab for split view, it says so whatever you search: Enter doesn't open things as usual)
  function updateChip(q) {
    let label = '', color = '--accent';
    if (q && q.engine) { label = q.engine.name; }
    else if (curMode === 'split') label = 'Split view';
    else if (q && q.only) { label = SOURCE_LABEL[q.only] || q.only; color = SOURCE_COLOR[q.only] || color; }
    else if (curMode === 'newtab') label = 'New tab';
    else if (curMode === 'background') label = 'Background tab';
    chip.hidden = !label;
    chip.textContent = label;
    chip.style.setProperty('--chip', `var(${color})`);
  }

  // Where an action opens in this launcher: opened for a new tab (Ctrl+T), "this tab" is the new one; opened
  // to pick a tab for split view, both this tab and a new one mean split view.
  function inMode(action) {
    if (curMode === 'newtab' && (action === 'current' || action === 'newtab')) {
      // (Ctrl+T over a blank new tab just uses it)
      const act = activeTab();
      return act && isNewTab(act.url) && !act.canGoBack && !act.loading ? 'current' : 'newtab';
    }
    if (curMode === 'split' && (action === 'current' || action === 'newtab')) return 'split';
    if (curMode === 'background' && action === 'current') return 'background';
    return action;
  }

  // What Enter (or a click) does with the keys held, here: Settings → Launcher → Opening results, except that
  // opened to edit the page's address (Ctrl+L without an address bar), Enter itself goes there, as in any
  // address bar.
  function actionFor(e, middle = false) {
    if (curMode === 'address' && !middle && LS.openSlot(e) === 'enter') return 'current';
    return LS.openAction(cfg, e, middle);
  }

  // Along the bottom: what Enter does with each key held (the first four that do something different).
  function renderHints() {
    const k = (key, label) => h('span', null, h('kbd', null, key), label);
    const keys = [['↵', {}], ['Shift+↵', { shiftKey: true }], ['Ctrl+↵', { ctrlKey: true }], ['Alt+↵', { altKey: true }],
      ['Ctrl+Shift+↵', { ctrlKey: true, shiftKey: true }], ['Alt+Shift+↵', { altKey: true, shiftKey: true }], ['Ctrl+Alt+↵', { ctrlKey: true, altKey: true }]];
    const out = [], seen = new Set();
    for (const [label, e] of keys) {
      const a = inMode(actionFor(e));
      if (a === 'none' || seen.has(a)) continue;
      seen.add(a);
      if (out.length >= 4) break;
      out.push(k(label, label === '↵' && a === 'current' ? 'Open' : ACTION_LABEL[a] || a));
    }
    out.push(k(setting('launcher.prefixes.commands') || '>', 'Commands'));
    hints.replaceChildren(...out);
  }

  // e: the Enter keydown or the click that picked it (its keys say what to do), or nothing (plain Enter).
  function pick(it, e, action) {
    if (!it || me.closed) return;
    const a = inMode(action || actionFor(e, !!(e && e.type === 'auxclick')));
    if (a === 'none') return;
    if (a === 'copy') {
      if (!it.url) return;
      copyText(it.url);
      toast({ text: 'Address copied', iconName: 'link', timeout: 1500 });
      close();
      return;
    }
    if (a === 'web') { searchWeb(); return; }
    if (it.type === 'command' && REOPENS.has(it.command)) { emit('command', it.command, { source: 'launcher' }); return; }
    // Settings → Launcher → "Stay open after opening a result in the background": to open several.
    if (a === 'background' && cfg.backgroundStaysOpen && it.type !== 'command' && !(it.type === 'tab' && it.tab && it.tab.windowId === S.windowId)) {
      openResult(it, a);
      toast({ text: 'Opened in the background', iconName: 'check', timeout: 1200 });
      input.focus();
      return;
    }
    // (a command, or a background tab: the keyboard goes back where it was; the rest put it somewhere new)
    close({ restoreFocus: it.type === 'command' || a === 'background' });
    openResult(it, a);
  }

  // The web search for what was typed (a keyword engine's, if one was typed), where Enter opens things.
  function searchWeb() {
    const q = lastQuery || {};
    const text = (q.text || input.value).trim();
    if (!text) return;
    const E = window.WBEngine;
    const eng = (q.engine && engines.find((x) => x.keyword === q.engine.keyword)) || engine;
    if (!eng) return;
    close({ restoreFocus: false });
    openResult({ type: 'search', url: E.fillTemplate(eng.url, text) }, inMode(LS.webPlace(cfg)));
  }

  function openSettings() { close(); emit('command', 'openSettings', { section: 'launcher' }); }

  // Settings → Launcher → Keys in the launcher → "Remove the result" (Shift+Delete): a history result leaves
  // history, a tab result closes.
  function remove() {
    const it = results.current();
    if (!it) return;
    const again = () => setTimeout(() => { if (!me.closed) searcher.run(input.value); }, 200);
    if (it.type === 'history') wb.invoke('history:delete-url', it.url).then(again).catch(() => {});
    else if (it.type === 'tab' && it.tab && it.tab.windowId === S.windowId) {
      const t = tabById(it.tab.tabId);
      if (t) { T.requestClose(t); again(); }
    } else toast({ text: 'Only history results and this window’s tabs can be removed from here', iconName: 'info', timeout: 2400 });
  }

  // Enter pressed before the results for what's in the box arrived (fast typing, or a typing delay): wait
  // for them, so it's never the result for what was typed a moment ago that opens.
  async function fresh() {
    const raw = input.value;
    if (raw === shownFor) return true;
    const r = await searcher.now(raw);
    if (me.closed || raw !== input.value) return false;
    if (r) show(r, raw);
    return true;
  }

  async function onKey(e) {
    // (keys an input method is composing with are its own: Enter there ends the composition)
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (picking) return;
      if (!input.value.trim() && curMode === 'newtab' && !results.current()) { close({ restoreFocus: false }); emit('command', 'newTabPage'); return; }
      const action = actionFor(e);
      const mods = { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, type: 'keydown' };
      if (action === 'none') return;
      if (action === 'web') { searchWeb(); return; }
      picking = true;
      const ok = await fresh();
      picking = false;
      if (!ok || me.closed) return;
      const it = results.current();
      if (it) pick(it, mods, action);
      else if (input.value.trim()) emit('command', 'noop');
      return;
    }
    const k = keyFor(e);
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    switch (k.act) {
      case 'next': results.move(1); return;
      case 'prev': results.move(-1); return;
      case 'pageDown': results.page(1); return;
      case 'pageUp': results.page(-1); return;
      case 'first': results.to(0); return;
      case 'last': results.to(results.items.length - 1); return;
      case 'close':
        // Settings → Launcher → "Esc clears the box first".
        if (cfg.escClears && input.value) { setValue(''); return; }
        close();
        return;
      case 'clear': setValue(''); return;
      case 'remove': remove(); return;
      case 'copy': { const it = results.current(); if (it) pick(it, null, 'copy'); return; }
      case 'settings': openSettings(); return;
      case 'pick': {
        if (picking) return;
        picking = true;
        const ok = await fresh();
        picking = false;
        const it = ok && !me.closed && results.items[k.index];
        if (it) pick(it, null, actionFor(null));
        return;
      }
      default:
    }
  }
  // (holding Alt, or Ctrl, shows the numbers that open the first nine results with it)
  function onMods(e) {
    const held = cfg.quickPick === 'alt' ? e.altKey : cfg.quickPick === 'ctrl' ? e.ctrlKey : false;
    layer.classList.toggle('show-nums', held && !e.shiftKey);
  }

  function setValue(v) {
    input.value = v;
    clear.hidden = !v || cfg.clearButton === false;
    results.reset();
    searcher.run(v);
    input.focus();
  }

  // (under its button, it follows the button when the window is resized)
  const onResize = () => { if (where !== 'anchored' || (anchor && anchor.isConnected)) where = place(layer, panel, cfg, anchor); };
  function close({ restoreFocus = true } = {}) {
    if (me.closed) return;
    me.closed = true;
    if (L === me) L = null;
    if (curMode === 'current') lastText = input.value;
    searcher.cancel();
    input.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    layer.classList.add('closing');
    // (another launcher may already be up: the window's "launcher open" flag is its)
    if (!L) document.documentElement.classList.remove('launcher-open');
    const out = motion ? Promise.all([
      animate(panel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.985)' }], { duration: 110, easing: 'ease-in', fill: 'forwards' }, 'launcher'),
      animate(back, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }, 'launcher'),
    ]) : Promise.resolve();
    // (and gone in any case: a layer left on screen would take every click in the window)
    const gone = () => layer.remove();
    out.then(gone, gone);
    setTimeout(gone, 600);
    if (restoreFocus) {
      if (prevFocus && document.contains(prevFocus) && prevFocus !== document.body) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
      else { const t = activeTab(); if (t) emit('focus-tab', t); }
    }
  }

  input.addEventListener('keydown', onKey);
  input.addEventListener('keydown', onMods);
  input.addEventListener('keyup', onMods);
  input.addEventListener('input', () => { clear.hidden = !input.value || cfg.clearButton === false; results.reset(); searcher.run(input.value); });
  input.addEventListener('blur', () => {
    layer.classList.remove('show-nums');
    // Something else in the window taking the keyboard closes it. Switching to another app leaves it as it is
    // (for when you come back), unless Settings → Launcher → "Close it when you switch to another app" is on
    // (and see init()).
    setTimeout(() => {
      if (me.closed || L !== me) return;
      if (!document.hasFocus()) { if (cfg.closeOnBlur === true) close({ restoreFocus: false }); return; }
      if (!layer.contains(document.activeElement)) close({ restoreFocus: false });
    }, 0);
  });
  clear.addEventListener('mousedown', (e) => e.preventDefault());
  clear.addEventListener('click', () => setValue(''));
  back.addEventListener('mousedown', (e) => { e.preventDefault(); close(); });
  panel.addEventListener('mousedown', (e) => { if (e.target !== input && !e.target.closest('button')) e.preventDefault(); });
  window.addEventListener('resize', onResize);

  const me = {
    closed: false,
    close,
    get where() { return where; },
    setMode(m) { curMode = m; renderHints(); updateChip(lastQuery); },
    setText(t, sel) {
      input.value = t || '';
      clear.hidden = !input.value || cfg.clearButton === false;
      input.focus();
      if (sel) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
      results.reset();
      shownFor = null;
      searcher.run(input.value);
    },
  };
  L = me;
  renderHints();
  updateChip(null);
  if (motion) {
    animate(back, [{ opacity: 0 }, { opacity: 1 }], { duration: 140 }, 'launcher');
    animate(panel, [{ opacity: 0, transform: 'translateY(-8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.16,1,.3,1)' }, 'launcher');
  }
  // Settings → Launcher → "Opens with what you last typed": that, all selected (typing replaces it).
  if (!text && cfg.rememberQuery && lastText && mode === 'current') me.setText(lastText, true);
  else me.setText(text, selectText);
  return me;
}

export function closeLauncher() { if (L && !L.closed) L.close(); }

// Ctrl+L in compact mode, or "Edit address": the launcher prefilled with the page address.
export function editAddress() {
  const t = activeTab();
  const url = t && !isNewTab(t.url) ? t.url : '';
  openLauncher({ mode: 'address', text: url, selectText: true });
}

export function init() {
  on('launcher-search', (text) => openLauncher({ mode: 'current', text }));
  // (the window losing the focus, as the main process sees it: where the page itself doesn't notice)
  wb.on('window-focus', (f) => { if (!f && L && !L.closed && setting('launcher.closeOnBlur') === true) L.close({ restoreFocus: false }); });
}
