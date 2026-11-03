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

// Two-pass search: the instant in-memory answer, then web suggestions and older history. Settings →
// Launcher → Typing delay holds the first pass until you pause (0: every key); Suggestion delay, the second.
export function makeSearcher(onResults) {
  let seq = 0, timer = null, typing = null;
  return {
    run(raw) {
      const my = ++seq;
      const act = activeTab();
      const args = { raw, activeWcId: act ? act.wcId : null };
      clearTimeout(timer);
      clearTimeout(typing);
      const wait = raw.trim() ? Math.max(0, Math.min(1000, Number(setting('launcher.typingDelayMs')) || 0)) : 0;
      const first = () => wb.invoke('search:query', args).then((r) => { if (my === seq) onResults(r, false, raw); }).catch(() => {});
      if (wait) typing = setTimeout(first, wait); else first();
      if (raw.trim()) {
        timer = setTimeout(() => {
          wb.invoke('search:more', args).then((r) => { if (my === seq) onResults(r, true, raw); }).catch(() => {});
        }, wait + Math.max(0, setting('launcher.suggestDelayMs') ?? 90));
      }
    },
    cancel() { seq++; clearTimeout(timer); clearTimeout(typing); },
    // The first pass for raw, now (no typing delay): for Enter pressed before the results for what's in
    // the box arrived. Resolves to the results, or null if something newer was asked for meanwhile.
    now(raw) {
      const my = ++seq;
      const act = activeTab();
      clearTimeout(timer);
      clearTimeout(typing);
      return wb.invoke('search:query', { raw, activeWcId: act ? act.wcId : null }).then((r) => (my === seq ? r : null), () => null);
    },
  };
}

// look: () => what to show (the launcher's settings: showUrls, showFolders, showBadges, favicons); without
// it, everything (the address bar's list).
export class ResultList {
  constructor({ onPick, onDelete, className = '', look = null } = {}) {
    this.el = h('ul.results' + (className ? '.' + className : ''), { role: 'listbox' });
    this.items = [];
    this.sel = 0;
    this.query = null;
    this.onPick = onPick;
    this.onDelete = onDelete;
    this.look = look;
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
    const look = (this.look && this.look()) || {};
    this.el.replaceChildren(...this.items.map((it, i) => this.row(it, i, tokens, showScores, look)));
    this.highlightSel(false);
  }

  // (Each part also has the class Waypoint gave it, for custom CSS written for Waypoint: .row, .title…)
  row(it, i, tokens, showScores, look = {}) {
    const li = h('li.rrow.row', { role: 'option', dataset: it.type === 'tab' && it.tab ? { type: it.type, index: String(i), tab: String(it.tab.tabId) } : { type: it.type, index: String(i) } });
    li.append(iconFor(it, look.favicons));
    const title = h('span.r-title.title');
    if (it.type === 'engine' && !it.title) { title.classList.add('ghost'); title.textContent = 'Type to search ' + it.engineName; }
    else title.append(highlight(it.title || displayUrl(it.url) || '', tokens));
    const sub = h('span.r-sub.sub');
    if (it.type === 'search' || it.type === 'engine') sub.append(h('span.r-url.url', null, 'Search ' + (it.engineName || 'the web')));
    else if (it.type === 'url') sub.append(h('span.r-url.url', null, 'Open this address'));
    else if (it.type === 'command') sub.append(h('span.r-url.url', null, it.category || 'Command'));
    else if (it.type !== 'suggestion') {
      if (look.showFolders !== false && it.folder && it.folder.length) sub.append(h('span.r-folder.folder', null, icon('folder'), h('span.r-ftext.ftext', null, it.folder.slice(-2).join(' › '))));
      if (look.showUrls !== false) sub.append(h('span.r-url.url', null, displayUrl(it.url)));
    }
    li.append(h('span.r-main.main', null, title, sub));
    const meta = h('span.r-meta.meta');
    if (it.tab && it.type !== 'tab' && it.type !== 'command' && setting('launcher.switchToOpenTab') !== false) meta.append(h('span.r-flag.flag', { title: 'Already open: switches to that tab' }, icon('external')));
    if (it.type === 'command') {
      const acc = accelFor(it.command);
      if (acc) meta.append(h('kbd', null, acc));
    } else if (it.type !== 'suggestion' && look.showBadges !== false) meta.append(h('span.r-badge.badge', null, (it.type === 'tab' && look.tabBadge) || BADGE[it.type] || ''));
    if (showScores && Number.isFinite(it.score) && it.breakdown) {
      const b = it.breakdown, f = (n) => (Number.isFinite(n) ? n.toFixed(2) : '');
      meta.append(h('span.r-score.score', { title: `match ${f(b.m)} · visits ${f(b.v)} · recency ${f(b.r)}\nsource ×${f(b.sw)} · domain ×${f(b.df)} · folder ×${f(b.ff)}` + (b.p ? `\nopened before for this ×${f(1 + (setting('launcher.wPicks') ?? 1) * b.p)}` : '') }, f(it.score)));
    }
    // (the launcher: Alt+1…9 or Ctrl+1…9 opens the first nine; the numbers show while that key is held)
    if (i < 9 && (look.quickPick === 'alt' || look.quickPick === 'ctrl')) meta.append(h('kbd.r-num', { 'aria-hidden': 'true' }, String(i + 1)));
    li.append(meta);
    // (Settings → Launcher → "Pointing at a result selects it")
    if (look.hoverSelects !== false) li.addEventListener('mousemove', () => { if (this.sel !== i) { this.sel = i; this.userMoved = true; this.highlightSel(false); } });
    li.addEventListener('click', (e) => this.onPick && this.onPick(it, howFromEvent(e), e));
    li.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); this.onPick && this.onPick(it, 'background', e); } });
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

  // (past the last result, the first: or, with Settings → Launcher → "Wrap around" off, stay on the last)
  move(d) {
    if (!this.items.length) return;
    const n = this.items.length;
    const wrap = !this.look || (this.look() || {}).wrap !== false;
    this.sel = wrap ? (this.sel + d + n) % n : Math.max(0, Math.min(n - 1, this.sel + d));
    this.userMoved = true;
    this.highlightSel(true);
    this.warm();
  }
  page(d) {
    if (!this.items.length) return;
    this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + d * 6));
    this.userMoved = true;
    this.highlightSel(true);
    this.warm();
  }
  to(i) {
    if (!this.items.length) return;
    this.sel = Math.max(0, Math.min(this.items.length - 1, i));
    this.userMoved = true;
    this.highlightSel(true);
    this.warm();
  }
  current() { return this.items[this.sel] || null; }
  reset() { this.userMoved = false; this.sel = 0; }
}

function keyOf(it) { return it.type + '|' + (it.key || it.url || it.command || it.title); }

// favicons (Settings → Launcher → Site icons): 'browser' (Bifrost's own icons of sites you've been to),
// 'google' or 'duckduckgo' (any site's, from that service), 'none' (the source's icon: star, clock…).
const ICON_SERVICE = {
  google: (host) => 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(host),
  duckduckgo: (host) => 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(host) + '.ico',
};
function iconFor(it, favicons = 'browser') {
  const box = h('span.r-ico.ico');
  const local = it.type === 'bookmark' || it.type === 'history' || it.type === 'tab';
  let host = '';
  try { host = /^https?:/i.test(it.url || '') ? new URL(it.url).hostname : ''; } catch { /* not an address */ }
  if (local && it.url && favicons !== 'none') {
    box.classList.add('fav');
    if (ICON_SERVICE[favicons] && host) {
      // (an open tab's own icon first, as Waypoint did)
      const own = it.type === 'tab' && /^(https?|data):/i.test(it.favicon || '') ? it.favicon : '';
      box.append(faviconEl(it.url, own || ICON_SERVICE[favicons](host), icon, 'fav'));
    } else box.append(faviconEl(it.url, it.favicon, icon, 'fav', { hi: true }));
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

// Opens a chosen result. how: 'current' | 'newtab' | 'background' | 'window' | 'private' | 'split'.
// typed: what was typed to find it (the launcher learns what you pick for it; search.js picks).
export function openResult(it, how = 'current', typed = '') {
  if (!it) return;
  if (!S.isPrivate && (it.type === 'command' || it.type === 'bookmark' || it.type === 'history' || it.type === 'tab')) {
    wb.send('search:picked', { raw: String(typed || ''), url: it.url || '', command: it.type === 'command' ? it.command : undefined });
  }
  if (it.type === 'command') { emit('command', it.command, { source: 'launcher' }); return; }
  // A tab result switches to that tab (for split view: puts it beside this one; for a new window: opens its
  // address there). A bookmark or history result that's open in a tab switches to it (Settings → Launcher →
  // "Jump to tabs that are already open").
  const away = how === 'window' || how === 'private';
  if (it.tab && !away && (it.type === 'tab' || ((how === 'current' || how === 'newtab') && setting('launcher.switchToOpenTab') !== false))) {
    if (it.tab.windowId === S.windowId) {
      const t = tabById(it.tab.tabId);
      if (t) {
        if (how !== 'split') { T.selectTab(t); return; }
        // (the tab in front itself, beside itself: a copy of it)
        if (t !== activeTab()) { T.splitWith(t); return; }
      }
    } else if (how !== 'split') {
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
