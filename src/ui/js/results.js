// Bifrost browser UI — the result list shared by the launcher and the address bar, the search
// requests behind it, and what happens when a result is chosen.
import { S, emit, activeTab, setting, tabById, accelFor } from './state.js';
import { h, highlight, displayUrl, faviconEl } from './util.js';
import { icon, ICONS } from './icons.js';
import * as T from './tabs.js';

const wb = window.wb;

const GLYPH = { bookmark: 'star', history: 'clock', tab: 'window', suggestion: 'search', search: 'search', engine: 'search', url: 'globe', command: 'bolt' };
const BADGE = { bookmark: 'Bookmark', history: 'History', tab: 'Switch to tab', suggestion: 'Suggestion', search: 'Search', engine: 'Search', url: 'Open', command: 'Command' };
const CMD_ICON = { Tabs: 'window', Groups: 'tag', Workspaces: 'layers', 'Split view': 'split', Navigation: 'compass', Page: 'file', Window: 'window', Panels: 'sidebar', Pages: 'book', Tools: 'wrench' };

// Two-pass search: the instant in-memory answer, then web suggestions and older history.
export function makeSearcher(onResults) {
  let seq = 0, timer = null;
  return {
    run(raw) {
      const my = ++seq;
      const act = activeTab();
      const args = { raw, activeWcId: act ? act.wcId : null };
      wb.invoke('search:query', args).then((r) => { if (my === seq) onResults(r, false, raw); }).catch(() => {});
      clearTimeout(timer);
      if (raw.trim()) {
        timer = setTimeout(() => {
          wb.invoke('search:more', args).then((r) => { if (my === seq) onResults(r, true, raw); }).catch(() => {});
        }, Math.max(0, setting('launcher.suggestDelayMs') ?? 90));
      }
    },
    cancel() { seq++; clearTimeout(timer); },
  };
}

export class ResultList {
  constructor({ onPick, onDelete, className = '' } = {}) {
    this.el = h('ul.results' + (className ? '.' + className : ''), { role: 'listbox' });
    this.items = [];
    this.sel = 0;
    this.query = null;
    this.onPick = onPick;
    this.onDelete = onDelete;
    this.el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  }

  set(items, query) {
    const prevKey = this.items[this.sel] && keyOf(this.items[this.sel]);
    const userMoved = this.userMoved;
    this.items = items || [];
    this.query = query || null;
    let sel = 0;
    // Keep the selection on the same result when results refresh (e.g. suggestions arrive).
    if (userMoved && prevKey) { const i = this.items.findIndex((it) => keyOf(it) === prevKey); if (i >= 0) sel = i; else this.userMoved = false; }
    this.sel = Math.min(sel, Math.max(0, this.items.length - 1));
    this.render();
    this.warm();
  }

  // Connect ahead to the highlighted result's site, so opening it starts sooner (main/predictor.js).
  warm() {
    clearTimeout(this.warmT);
    this.warmT = setTimeout(() => {
      const it = this.current();
      if (it && typeof it.url === 'string' && /^https?:/i.test(it.url)) window.wb.send('net:preconnect', it.url);
    }, 120);
  }

  render() {
    const tokens = this.query && this.query.text ? this.query.text.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const showScores = setting('launcher.showScores');
    this.el.replaceChildren(...this.items.map((it, i) => this.row(it, i, tokens, showScores)));
    this.highlightSel(false);
  }

  row(it, i, tokens, showScores) {
    const li = h('li.rrow', { role: 'option', dataset: { type: it.type, index: String(i) } });
    li.append(iconFor(it));
    const title = h('span.r-title');
    if (it.type === 'engine' && !it.title) { title.classList.add('ghost'); title.textContent = 'Type to search ' + it.engineName; }
    else title.append(highlight(it.title || displayUrl(it.url) || '', tokens));
    const sub = h('span.r-sub');
    if (it.type === 'search' || it.type === 'engine') sub.append(h('span.r-url', null, 'Search ' + (it.engineName || 'the web')));
    else if (it.type === 'url') sub.append(h('span.r-url', null, 'Open this address'));
    else if (it.type === 'command') sub.append(h('span.r-url', null, it.category || 'Command'));
    else if (it.type !== 'suggestion') {
      if (it.folder && it.folder.length) sub.append(h('span.r-folder', null, icon('folder'), h('span.r-ftext', null, it.folder.slice(-2).join(' › '))));
      sub.append(h('span.r-url', null, displayUrl(it.url)));
    }
    li.append(h('span.r-main', null, title, sub));
    const meta = h('span.r-meta');
    if (it.tab && it.type !== 'tab' && it.type !== 'command') meta.append(h('span.r-flag', { title: 'Already open: switches to that tab' }, icon('external')));
    if (it.type === 'command') {
      const acc = accelFor(it.command);
      if (acc) meta.append(h('kbd', null, acc));
    } else if (it.type !== 'suggestion') meta.append(h('span.r-badge', null, BADGE[it.type] || ''));
    if (showScores && Number.isFinite(it.score) && it.breakdown) {
      const b = it.breakdown, f = (n) => (Number.isFinite(n) ? n.toFixed(2) : '');
      meta.append(h('span.r-score', { title: `match ${f(b.m)} · visits ${f(b.v)} · recency ${f(b.r)}\nsource ×${f(b.sw)} · domain ×${f(b.df)} · folder ×${f(b.ff)}` }, f(it.score)));
    }
    li.append(meta);
    li.addEventListener('mousemove', () => { if (this.sel !== i) { this.sel = i; this.userMoved = true; this.highlightSel(false); } });
    li.addEventListener('click', (e) => this.onPick && this.onPick(it, howFromEvent(e)));
    li.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); this.onPick && this.onPick(it, 'background'); } });
    return li;
  }

  highlightSel(scroll = true) {
    const rows = this.el.children;
    for (let i = 0; i < rows.length; i++) {
      const on = i === this.sel;
      rows[i].classList.toggle('sel', on);
      rows[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (scroll && rows[this.sel]) rows[this.sel].scrollIntoView({ block: 'nearest' });
  }

  move(d) {
    if (!this.items.length) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this.userMoved = true;
    this.highlightSel(true);
    this.warm();
  }
  page(d) {
    if (!this.items.length) return;
    this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + d * 6));
    this.userMoved = true;
    this.highlightSel(true);
  }
  current() { return this.items[this.sel] || null; }
  reset() { this.userMoved = false; this.sel = 0; }
}

function keyOf(it) { return it.type + '|' + (it.key || it.url || it.command || it.title); }

function iconFor(it) {
  const box = h('span.r-ico');
  const local = it.type === 'bookmark' || it.type === 'history' || it.type === 'tab';
  if (local && it.url) {
    box.classList.add('fav');
    box.append(faviconEl(it.url, it.favicon, icon, 'fav', { hi: true }));
  } else if (it.type === 'command') {
    box.append(icon(commandIcon(it)));
  } else {
    box.append(icon(GLYPH[it.type] || 'globe'));
  }
  return box;
}

function commandIcon(it) {
  const byId = { newTab: 'plus', closeTab: 'close', reopenTab: 'rotate', openSettings: 'sliders', screenshot: 'camera', readerMode: 'reader', translatePage: 'translate', print: 'print', savePage: 'save', devtools: 'code', find: 'search', bookmarkPage: 'star', toggleVim: 'vim', cycleTheme: 'palette', taskManager: 'cpu', newPrivateWindow: 'mask', pictureInPicture: 'pip', toggleAnimations: 'sparkle', zoomIn: 'zoomIn', zoomOut: 'zoomOut', panelHistory: 'clock', panelBookmarks: 'book', panelDownloads: 'download', openExtensions: 'puzzle', importData: 'import', clearData: 'trash', muteTab: 'volumeOff', pinTab: 'pin', sleepTab: 'moon', copyUrl: 'link' };
  const name = byId[it.command] || CMD_ICON[it.category] || 'bolt';
  return ICONS[name] ? name : 'bolt';
}

// Modifier keys pick where a result opens.
export function howFromEvent(e, fallback = null) {
  if (e.shiftKey && (e.ctrlKey || e.metaKey)) return 'window';
  if (e.shiftKey) return 'split';
  if (e.ctrlKey || e.metaKey) return 'background';
  if (e.altKey) return 'newtab';
  return fallback;
}

// Opens a chosen result. how: 'current' | 'newtab' | 'background' | 'window' | 'split'.
export function openResult(it, how = 'current') {
  if (!it) return;
  if (it.type === 'command') { emit('command', it.command, { source: 'launcher' }); return; }
  if (it.tab && (it.type === 'tab' || how === 'current' || how === 'newtab')) {
    if (it.tab.windowId === S.windowId) {
      const t = tabById(it.tab.tabId);
      if (t) {
        if (how === 'split' && t !== activeTab()) { T.splitTabs([activeTab(), t], { focusTab: t }); return; }
        T.selectTab(t);
        return;
      }
    } else {
      wb.invoke('search:focus-tab', it.tab).catch(() => {});
      return;
    }
  }
  if (!it.url) return;
  const act = activeTab();
  // A blank new tab is reused instead of leaving it behind.
  if (how === 'newtab' && act && /^bifrost:\/\/(newtab|blank)/.test(act.url) && !act.canGoBack && !act.loading) how = 'current';
  T.openUrl(it.url, { where: how, typed: it.type === 'url', allowScript: it.type === 'bookmark', opener: how === 'background' || how === 'split' ? act : null });
}
