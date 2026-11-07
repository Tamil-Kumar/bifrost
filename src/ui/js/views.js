// Bifrost browser UI — the pages themselves: one <webview> per loaded tab, laid out in the stage
// (a single page, or several panes in split view). Webviews are created once and never moved in the
// DOM (moving one reloads its page); hidden tabs are kept at full size with visibility: hidden.
import { S, on, emit, setTab, activeTab, visibleTabs, splitOf, setting } from './state.js';
import { h, hostOf, fixupUrl, displayUrl, isInternal, faviconEl, NEWTAB_URL } from './util.js';
import { icon } from './icons.js';

const wb = window.wb;
const viewsEl = document.getElementById('views');
const panesEl = document.getElementById('panes');
const stageEl = document.getElementById('stage');

// ------------------------------------------------------------ guest calls
export function guest(tab, action, args) {
  if (!tab || tab.wcId == null) return Promise.reject(new Error('This tab isn’t loaded'));
  return wb.invoke('guest:action', tab.wcId, action, args || {});
}

// Calls a <webview> method, ignoring "not attached yet" errors.
export function call(tab, method, ...args) {
  const el = tab && tab.wv;
  if (!el || typeof el[method] !== 'function') return undefined;
  try {
    const r = el[method](...args);
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  } catch { return undefined; }
}

const wcWaiters = new Map(); // tab id -> [resolve]
export function waitForWc(tab, timeout = 10000) {
  if (tab.wcId != null) return Promise.resolve(tab.wcId);
  return new Promise((resolve, reject) => {
    const list = wcWaiters.get(tab.id) || [];
    list.push(resolve);
    wcWaiters.set(tab.id, list);
    setTimeout(() => reject(new Error('tab did not load')), timeout);
  });
}

// ---------------------------------------------------------------- create
export function ensureView(tab) {
  if (tab.wv) return tab.wv;
  const restore = tab.history && Array.isArray(tab.history.entries) && tab.history.entries.length ? tab.history : null;
  const el = document.createElement('webview');
  el.className = 'view hidden';
  el.classList.toggle('internal', isInternal(tab.url || NEWTAB_URL));
  el.dataset.tab = tab.id;
  el.setAttribute('partition', S.partition);
  el.setAttribute('allowpopups', '');
  tab.restoring = restore;
  tab.wv = el;
  tab.sleeping = false;
  tab.lazy = false;
  wire(tab, el);
  // Restoring tabs start empty (main sees this marker), then get their history restored.
  el.setAttribute('src', restore ? 'about:blank#wb-restore' : fixupUrl(tab.url || NEWTAB_URL));
  viewsEl.appendChild(el);
  ensurePane(tab);
  emit('tab', tab, { sleeping: false });
  return el;
}

export function destroyView(tab) {
  const el = tab.wv;
  if (!el) return;
  tab.wv = null;
  clearTimeout(tab.audioTimer);
  el.remove();
  if (tab.pane) { tab.pane.el.remove(); tab.pane = null; }
  setTab(tab, { wcId: null, loading: false, audible: false });
}

// The page's webContents id. 'did-attach' can arrive before the <webview> knows it, so this retries.
function resolveWc(tab, el, tries = 0) {
  if (tab.wv !== el || tab.wcId != null) return;
  let id = null;
  try { id = el.getWebContentsId(); } catch { id = null; }
  if (id == null) {
    if (tries < 200) setTimeout(() => resolveWc(tab, el, tries + 1), tries < 20 ? 10 : 50);
    return;
  }
  setTab(tab, { wcId: id });
  reportShown();
  for (const r of wcWaiters.get(tab.id) || []) r(id);
  wcWaiters.delete(tab.id);
  if (tab.restoring) {
    const hist = tab.restoring;
    guest(tab, 'restoreHistory', hist)
      .catch(() => { V_fallbackLoad(tab, hist); })
      .finally(() => { tab.restoring = null; refreshNav(tab, 300); });
  }
  if (tab === activeTab()) wb.send('tab:selected', id);
  if (tab.focusOnAttach) {
    tab.focusOnAttach = false;
    tab.focusOnReady = true;
    if (visibleTabs().includes(tab) && !typingInWindow()) focusView(tab, { force: true });
  }
  emit('view-attached', tab);
}

// If restoring history fails, at least load the page the tab was on.
function V_fallbackLoad(tab, hist) {
  const e = hist.entries[Math.min(hist.entries.length - 1, Math.max(0, hist.index | 0))];
  if (e && e.url) call(tab, 'loadURL', e.url);
}

// The language the page says it's in (its <html lang>, or a Content-Language meta tag), to offer translating it.
function readLanguage(tab) {
  if (!/^https?:/i.test(tab.url || '')) return;
  const p = call(tab, 'executeJavaScript', `(() => { const m = document.querySelector('meta[http-equiv="content-language" i]'); return String(document.documentElement.lang || (m && m.content) || '').trim().slice(0, 35); })()`, false);
  if (p && p.then) p.then((lang) => setTab(tab, { lang: String(lang || '') }), () => {});
}

function wire(tab, el) {
  el.addEventListener('did-attach', () => resolveWc(tab, el));
  el.addEventListener('did-start-loading', () => resolveWc(tab, el));
  el.addEventListener('dom-ready', () => {
    if (tab.muted) call(tab, 'setAudioMuted', true);
    // A new tab that was given the keyboard before its page existed: once more, now that it does.
    if (tab.focusOnReady) {
      tab.focusOnReady = false;
      if (tab === activeTab() && document.activeElement === el && !typingInWindow()) focusView(tab, { force: true });
    }
    readLanguage(tab);
    emit('dom-ready', tab);
  });
  el.addEventListener('did-start-loading', () => setTab(tab, { loading: true }));
  el.addEventListener('did-stop-loading', () => {
    setTab(tab, { loading: false, pendingUrl: null });
    refreshNav(tab);
  });
  el.addEventListener('did-start-navigation', (e) => {
    if (!e.isMainFrame || e.isSameDocument) return;
    // Web pages without a background of their own get white, like in any browser; Bifrost's own
    // pages draw on the theme's color.
    el.classList.toggle('internal', isInternal(e.url));
    tab.navStarted = { url: e.url, at: Date.now() };    // (for a dangerous-site warning: see main.js)
    if (tab.error || tab.crashed || tab.danger) setTab(tab, { error: null, crashed: null, danger: null });
  });
  el.addEventListener('did-navigate', (e) => {
    if (tab.restoring && e.url === 'about:blank') return;
    const patch = { url: e.url, pendingUrl: null, blocked: 0, error: null, lang: '' };
    if (hostOf(e.url) !== hostOf(tab.url)) { patch.favicon = ''; patch.themeColor = null; }
    setTab(tab, patch);
    refreshNav(tab);
    emit('navigated', tab, e.url);
  });
  el.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    setTab(tab, { url: e.url });
    refreshNav(tab);
  });
  el.addEventListener('did-fail-load', (e) => {
    // -3 is "aborted" (a new navigation started, or a download): not an error page.
    if (!e.isMainFrame || e.errorCode === -3) return;
    setTab(tab, { error: { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL || tab.url }, loading: false, pendingUrl: null, url: e.validatedURL || tab.url });
  });
  el.addEventListener('page-title-updated', (e) => setTab(tab, { title: e.title }));
  el.addEventListener('page-favicon-updated', (e) => {
    const f = (e.favicons || []).find((u) => /^(https?|data):/i.test(u));
    if (f) setTab(tab, { favicon: f });
  });
  el.addEventListener('did-change-theme-color', (e) => setTab(tab, { themeColor: e.themeColor || null }));
  el.addEventListener('update-target-url', (e) => showStatus(tab, e.url));
  el.addEventListener('found-in-page', (e) => emit('found-in-page', tab, e.result));
  el.addEventListener('ipc-message', (e) => emit('guest-message', tab, e.channel, e.args || []));
  el.addEventListener('render-process-gone', (e) => setTab(tab, { crashed: (e.details && e.details.reason) || 'crashed', loading: false }));
  el.addEventListener('close', () => emit('guest-close', tab));
  el.addEventListener('media-started-playing', () => checkAudio(tab, 300));
  el.addEventListener('media-paused', () => { checkAudio(tab, 600); setTimeout(() => checkAudio(tab, 0), 2600); });
  el.addEventListener('enter-html-full-screen', () => setHtmlFullscreen(tab, true));
  el.addEventListener('leave-html-full-screen', () => setHtmlFullscreen(tab, false));
  el.addEventListener('focus', () => emit('view-focus', tab));
  el.addEventListener('devtools-opened', () => setTab(tab, { devtools: true }));
  el.addEventListener('devtools-closed', () => setTab(tab, { devtools: false }));
}

// Back/forward state and the history snapshot used for session restore and sleeping tabs.
const navTimers = new Map();
export function refreshNav(tab, delay = 120) {
  clearTimeout(navTimers.get(tab.id));
  return new Promise((resolve) => {
    navTimers.set(tab.id, setTimeout(async () => {
      navTimers.delete(tab.id);
      if (tab.wcId == null) return resolve();
      try {
        const r = await guest(tab, 'navigationEntries');
        if (r && Array.isArray(r.entries)) {
          setTab(tab, { history: { entries: r.entries, index: r.index }, canGoBack: r.index > 0, canGoForward: r.index < r.entries.length - 1, zoom: typeof r.zoom === 'number' ? r.zoom : tab.zoom });
        }
      } catch { /* tab went away */ }
      resolve();
    }, delay));
  });
}

function checkAudio(tab, delay) {
  clearTimeout(tab.audioTimer);
  tab.audioTimer = setTimeout(function poll() {
    if (!tab.wv) return;
    let audible = false;
    try { audible = !!tab.wv.isCurrentlyAudible(); } catch { /* not attached */ }
    setTab(tab, { audible });
    if (audible) tab.audioTimer = setTimeout(poll, 1500);
  }, delay);
}

// ------------------------------------------------------------- navigation
export function loadUrl(tab, url, { typed = false } = {}) {
  url = fixupUrl(String(url || '').trim());
  if (!url) return;
  if (!tab.wv) {
    tab.history = null;
    setTab(tab, { url, pendingUrl: null, error: null, crashed: null });
    ensureView(tab);
    layout();
    return;
  }
  setTab(tab, { pendingUrl: url, error: null, crashed: null });
  if (typed) guest(tab, 'typed', { url }).catch(() => {});
  const p = call(tab, 'loadURL', url);
  if (p && p.catch) p.catch(() => {});
}

export function goBack(tab) { if (tab.wv) call(tab, 'goBack'); }
export function goForward(tab) { if (tab.wv) call(tab, 'goForward'); }
export function reload(tab, hard = false) {
  if (!tab.wv) { ensureView(tab); layout(); return; }
  if (tab.crashed || tab.error) setTab(tab, { crashed: null, error: null });
  call(tab, hard ? 'reloadIgnoringCache' : 'reload');
}
export function stopLoading(tab) { call(tab, 'stop'); }
export function setMuted(tab, muted) { setTab(tab, { muted }); call(tab, 'setAudioMuted', muted); }
// Gives the keyboard to a tab's page. Focus only moves from one page to another through the window: asked
// to focus the second page while the first has the keyboard, Chromium does nothing (and the keys you type
// would keep going to the page you left), so the window takes it for a moment first. A page that isn't
// attached yet gets it as soon as it is.
let focusSink = null;
export function focusView(tab, { force = false } = {}) {
  if (!tab || !tab.wv) return;
  if (tab.wcId == null) tab.focusOnAttach = true;
  if (!focusSink) {
    focusSink = h('div#focus-sink', { tabIndex: -1, 'aria-hidden': 'true' });
    document.body.append(focusSink);
  }
  try { if (force || document.activeElement !== tab.wv) focusSink.focus({ preventScroll: true }); } catch { /* fine */ }
  try { tab.wv.focus(); } catch { /* gone */ }
}

// Whether you're typing somewhere in the window (the address bar, a dialog…), so a page loading doesn't take
// the keyboard from you.
function typingInWindow() {
  const a = document.activeElement;
  return !!a && a !== document.body && a.id !== 'focus-sink' && a.tagName !== 'WEBVIEW' && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

// --------------------------------------------------------------- sleeping
export async function sleepTab(tab, { force = false } = {}) {
  if (!tab.wv) return false;
  if (!force && visibleTabs().includes(tab)) return false;
  await refreshNav(tab, 0);
  if (!tab.wv || (!force && visibleTabs().includes(tab))) return false;
  destroyView(tab);
  setTab(tab, { sleeping: true });
  return true;
}

// Puts tabs to sleep after the performance profile's idle time (or now, with force: every tab that
// isn't showing, still following the profile's rules about pinned, playing and other spaces' tabs).
function sleepCheck(force = false) {
  const p = window.WBDefaults.perf(S.settings);
  if (!p.sleepEnabled && !force) return 0;
  const limit = Math.max(1, p.sleepMinutes || 30) * 60000;
  const now = Date.now();
  const vis = visibleTabs();
  let n = 0;
  for (const t of S.tabs) {
    if (!t.wv || vis.includes(t) || t.loading) continue;
    if (!p.sleepPinned && t.pinned) continue;
    if (!p.sleepAudible && t.audible) continue;
    if (!p.sleepOtherSpaces && t.workspaceId !== S.activeWorkspaceId) continue;
    if (t.devtools || isInternal(t.url) && /^bifrost:\/\/(downloads|tasks)/.test(t.url)) continue;
    if (force || now - (t.lastActive || t.created) > limit) { sleepTab(t); n++; }
  }
  return n;
}
export function sleepBackgroundTabs() { return sleepCheck(true); }

// ---------------------------------------------------------------- on screen
// Which pages are on screen, for main to tell them (main/guests.js, preload/tab.js): Electron tells every
// page in a <webview> it's visible (and focused) as long as the window is, the tab in front or not, so a
// page behind another couldn't know you'd gone, and sites that notify you only then (chat sites such as
// claude.ai) didn't. The tabs showing, and the side panel's website when it's open; a tab under one of
// Bifrost's dialogs still counts. Coalesced: sent once, after whatever changed it.
let shownKey = '', shownQueued = false;
export function reportShown() {
  if (shownQueued) return;
  shownQueued = true;
  setTimeout(() => {
    shownQueued = false;
    const known = [], shown = [];
    for (const el of document.querySelectorAll('webview')) {
      let id = null;
      try { id = el.getWebContentsId(); } catch { id = null; }
      if (id == null) { const t = el.dataset.tab && S.tabs.find((x) => String(x.id) === el.dataset.tab); id = t && t.wv === el ? t.wcId : null; }
      if (id == null) continue;
      known.push(id);
      if (el.classList.contains('js-dialog-hide') || typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })) shown.push(id);
    }
    const key = known.sort((a, b) => a - b).join(',') + '|' + shown.sort((a, b) => a - b).join(',');
    if (key === shownKey) return;
    shownKey = key;
    wb.send('tabs:shown', { known, shown });
  }, 0);
}

// ---------------------------------------------------------------- layout
// Positions the visible tab (or split panes) and hides everything else.
export function layout() {
  const fsTab = S.htmlFullscreenTab;
  const vis = fsTab ? [fsTab] : visibleTabs();
  const sp = !fsTab && vis.length > 1 ? splitOf(vis[0]) : null;
  const act = activeTab();
  document.documentElement.classList.toggle('split-active', !!sp);
  stageEl.dataset.orientation = sp ? sp.orientation : '';

  const rects = new Map();
  if (sp) {
    const n = sp.tabIds.length;
    let acc = 0;
    sp.tabIds.forEach((id, i) => {
      const f = sp.sizes[i] || 1 / n;
      const start = `calc((100% - ${n - 1} * var(--split-gap)) * ${acc.toFixed(5)} + ${i} * var(--split-gap))`;
      const size = `calc((100% - ${n - 1} * var(--split-gap)) * ${f.toFixed(5)})`;
      acc += f;
      rects.set(id, sp.orientation === 'column' ? { left: '0px', width: '100%', top: start, height: size } : { top: '0px', height: '100%', left: start, width: size });
    });
  } else {
    for (const t of vis) rects.set(t.id, { left: '0px', top: '0px', width: '100%', height: '100%' });
  }

  for (const t of S.tabs) {
    const r = rects.get(t.id);
    if (t.wv) {
      if (r) {
        const st = t.wv.style;
        st.left = r.left; st.width = r.width;
        st.top = sp ? `calc(${r.top} + var(--pane-head))` : r.top;
        st.height = sp ? `calc(${r.height} - var(--pane-head))` : r.height;
        t.wv.classList.remove('hidden');
      } else {
        t.wv.classList.add('hidden');
      }
    }
    if (t.pane) {
      const el = t.pane.el;
      if (r) {
        Object.assign(el.style, r);
        el.hidden = false;
        el.classList.toggle('in-split', !!sp);
        el.classList.toggle('focused', !!sp && t === act);
        renderPane(t);
      } else el.hidden = true;
    }
  }
  renderResizers(sp);
  emit('layout');
  reportShown();
}

// ------------------------------------------------------------------ panes
// Each loaded tab has a pane: a header in split view, the loading bar, and error/crash overlays.
function ensurePane(tab) {
  if (tab.pane) return tab.pane;
  const title = h('span.pane-title');
  const fav = h('span.pane-fav');
  const head = h('div.pane-head', {
    onmousedown: (e) => { if (e.button === 0 && !e.target.closest('button')) emit('pane-click', tab); },
    ondblclick: (e) => { if (!e.target.closest('button')) emit('pane-command', tab, 'maximize'); },
  },
    fav, title,
    h('button.pane-btn', { title: 'Swap with the next pane', onclick: () => emit('pane-command', tab, 'swap') }, icon('rotate')),
    h('button.pane-btn', { title: 'Show only this tab', onclick: () => emit('pane-command', tab, 'maximize') }, icon('maximize')),
    h('button.pane-btn', { title: 'Close this pane', onclick: () => emit('pane-command', tab, 'close') }, icon('close')));
  const progress = h('div.pane-progress');
  const body = h('div.pane-body', null, progress);
  const el = h('div.pane', { dataset: { tab: tab.id }, hidden: true }, head, body);
  panesEl.appendChild(el);
  tab.pane = { el, head, body, title, fav, progress, overlay: null, sig: '' };
  return tab.pane;
}

export function renderPane(tab) {
  const p = tab.pane;
  if (!p) return;
  p.el.classList.toggle('loading', !!tab.loading);
  p.title.textContent = tab.title || displayUrl(tab.url) || 'New tab';
  const favSig = tab.url + '|' + tab.favicon;
  if (p.favSig !== favSig) { p.favSig = favSig; p.fav.replaceChildren(faviconEl(tab.url, tab.favicon, icon, 'fav')); }
  const sig = tab.crashed ? 'crash:' + tab.crashed : tab.danger ? 'danger:' + tab.danger.url : tab.error ? 'err:' + tab.error.code + tab.error.url : '';
  if (sig === p.sig) return;
  p.sig = sig;
  if (p.overlay) { p.overlay.remove(); p.overlay = null; }
  if (tab.crashed) p.overlay = crashOverlay(tab);
  else if (tab.danger) p.overlay = dangerOverlay(tab);
  else if (tab.error) p.overlay = errorOverlay(tab);
  if (p.overlay) p.body.appendChild(p.overlay);
  p.body.classList.toggle('has-overlay', !!p.overlay);
}

// What went wrong, in words: [title, explanation, what to offer besides Try again].
const NET_ERRORS = {
  '-105': ['Can’t find this site', 'Check the address for typos, or search for it instead.', 'search'],
  '-137': ['Can’t find this site', 'The address couldn’t be looked up. Check your connection or your DNS settings.', 'search'],
  '-106': ['You’re offline', 'Check your Wi-Fi or network cable. This page reloads by itself once you’re back online.', 'online'],
  '-21': ['Your network changed', 'The connection was interrupted while your network changed. Try again.', 'online'],
  '-100': ['The connection was closed', 'The site closed the connection before the page arrived. Try again in a moment.', 'online'],
  '-101': ['The connection was reset', 'Something interrupted the connection. Try again in a moment.', 'online'],
  '-102': ['The site refused to connect', 'Nothing is answering at this address. The site may be down, or the address may be wrong.'],
  '-104': ['Couldn’t connect to the site', 'The connection couldn’t be made. Try again in a moment.', 'online'],
  '-109': ['The site can’t be reached', 'The address is unreachable from your network.', 'online'],
  '-118': ['The site took too long to respond', 'It may be busy or down. Try again in a moment.', 'online'],
  '-7': ['The site took too long to respond', 'It may be busy or down. Try again in a moment.', 'online'],
  '-15': ['The connection was lost', 'Try again in a moment.', 'online'],
  '-111': ['Can’t connect through the proxy', 'Bifrost is set to use a proxy server that isn’t answering. Check the proxy in Settings → Advanced, or your system’s proxy settings.', 'proxy'],
  '-130': ['Can’t connect through the proxy', 'The proxy server isn’t answering. Check the proxy in Settings → Advanced, or your system’s proxy settings.', 'proxy'],
  '-131': ['Can’t connect through the proxy', 'The proxy configuration couldn’t be used. Check the proxy in Settings → Advanced.', 'proxy'],
  '-138': ['Bifrost can’t reach the network', 'A firewall or antivirus program may be blocking Bifrost. Allow it there, then try again.'],
  '-310': ['This page isn’t redirecting properly', 'It keeps sending you round in a loop. Clearing this site’s cookies usually fixes it.', 'cookies'],
  '-320': ['The site sent a broken response', 'Try again in a moment.'],
  '-321': ['The site sent a broken response', 'Try again in a moment.'],
  '-324': ['The page sent no data', 'The site closed the connection without sending anything. Try again in a moment.', 'online'],
  '-107': ['This site can’t provide a secure connection', 'It sent a response Bifrost can’t use securely.'],
  '-113': ['This site can’t provide a secure connection', 'It uses old security settings that aren’t safe any more.'],
  '-300': ['That address isn’t valid', 'Check it for typos.', 'search'],
  '-312': ['This port is blocked', 'Browsers don’t connect to this port: it belongs to other kinds of programs, and opening it from a web page could be misused.'],
  '-301': ['Bifrost can’t open this kind of link', 'It’s meant for another app.'],
  '-302': ['Bifrost can’t open this kind of link', 'It’s meant for another app.'],
  '-6': ['File not found', 'The file may have been moved, renamed or deleted.'],
  '-10': ['Access denied', 'You don’t have permission to open this.'],
  '-20': ['Bifrost blocked this page', 'Its address is on the ad and tracker blocking lists.', 'adblock'],
  '-27': ['This page can’t be shown here', 'The site doesn’t allow being shown this way.'],
  '-30': ['Blocked by your settings', 'A content setting blocked this page.'],
};
// Errors worth retrying by themselves when the connection comes back.
const RETRY = new Set(Object.keys(NET_ERRORS).filter((k) => NET_ERRORS[k][2] === 'online' || k === '-105' || k === '-137'));
// Errors that loading again can't fix (a blocked port, an address that isn't valid, a link for another app,
// a page on the blocking lists): no Try again; what can help comes first instead.
const NO_RETRY = new Set(['-312', '-300', '-301', '-302', '-20']);
const isCertError = (code) => (code <= -200 && code > -300) || code === -501;

function errorOverlay(tab) {
  const e = tab.error;
  const code = String(e.code);
  const cert = isCertError(e.code);
  const [title, text, extra] = cert
    ? ['Your connection isn’t private', 'This site’s security certificate isn’t valid, so someone could be reading or changing what you send and see. Bifrost stopped loading it.', 'cert']
    : NET_ERRORS[code] || ['This page couldn’t load', 'Something went wrong while loading it. Try again in a moment.', 'online'];
  const host = hostOf(e.url);
  const retry = () => { setTab(tab, { error: null }); reload(tab); };
  const btn = (cls, iconName, label, onclick) => h('button.btn' + cls, { type: 'button', onclick }, icon(iconName), label);
  const certInfo = h('div.err-more', { hidden: true },
    h('p', null, 'If you know this site (your own server or a device on your network, say) and trust it, you can open it anyway. Bifrost remembers that until you quit.'),
    btn('.danger-text', 'warn', `Continue to ${host || 'the site'} (unsafe)`, async () => {
      const ok = await wb.invoke('cert:allow', e.url).catch(() => false);
      if (ok) retry();
    }));
  const canRetry = !NO_RETRY.has(code);
  const actions = h('div.err-actions', null,
    canRetry ? btn('.primary', 'reload', 'Try again', retry) : null,
    extra === 'adblock' && host ? btn('', 'shieldOff', 'Allow this site', async () => { await wb.invoke('adblock:set-site', host, true).catch(() => {}); retry(); }) : null,
    extra === 'search' ? btn('', 'search', 'Search for it', () => emit('search-for', tab, host || e.url)) : null,
    tab.canGoBack ? btn('', 'back', 'Go back', () => { setTab(tab, { error: null }); goBack(tab); }) : null,
    extra === 'proxy' ? btn('', 'sliders', 'Proxy settings', () => emit('command', 'openSettings', { section: 'advanced' })) : null,
    extra === 'cookies' && host ? btn('', 'cookie', 'Clear this site’s cookies', async () => { await wb.invoke('site:clear-data', e.url).catch(() => {}); retry(); }) : null,
    cert ? btn('.ghost', 'info', 'Details', (ev) => { certInfo.hidden = !certInfo.hidden; ev.currentTarget.classList.toggle('on', !certInfo.hidden); }) : null);
  // Without Try again, the first thing that can help is the main button.
  if (!canRetry && actions.firstElementChild) actions.firstElementChild.classList.add('primary');
  return h('div.pane-overlay.err', null,
    h('div.err-card', null,
      h('div.err-icon' + (cert ? '.warn' : ''), null, icon(cert ? 'lock' : e.code === -106 ? 'globe' : extra === 'adblock' ? 'shield' : 'compass')),
      h('h2', null, title),
      h('p', null, text),
      h('p.err-url', null, displayUrl(e.url) || e.url),
      actions,
      cert ? certInfo : null,
      h('p.err-code', null, (e.desc || 'ERROR') + ' (' + e.code + ')')));
}

// Back online: tabs showing a connection error try again by themselves (the visible ones straight away).
window.addEventListener('online', () => {
  for (const t of S.tabs) {
    if (!t.error || !RETRY.has(String(t.error.code))) continue;
    setTab(t, { error: null });
    reload(t);
  }
});

// A page on the dangerous-sites lists (main/safety.js stopped it): what it's known for, back to safety,
// and, under Details, a way through.
const DANGER = {
  phishing: ['Deceptive site ahead', 'This site may trick you into doing something dangerous, like giving away your passwords or card details, or installing software.'],
  malware: ['This site spreads malware', 'It’s known for programs that can steal or delete your information, or take over your computer.'],
  scam: ['This site is known for scams', 'It’s listed for scams, fake downloads or unwanted software.'],
};
// The tab was opening it: its page stays as it was underneath, with the warning over it and the dangerous
// address in the address bar. (Chromium shows no error page for a navigation stopped this way.)
export function showDanger(tab, d) {
  setTab(tab, { danger: d, url: d.url, pendingUrl: null, loading: false, error: null, title: 'Dangerous site' });
}
function dangerOverlay(tab) {
  const d = tab.danger;
  const [title, text] = DANGER[d.kind] || DANGER.scam;
  const host = hostOf(d.url);
  const visit = async () => {
    if (!(await wb.invoke('safety:allow', d.url).catch(() => false))) return;
    setTab(tab, { danger: null });
    loadUrl(tab, d.url);
  };
  const more = h('div.err-more', { hidden: true },
    h('p', null, `Bifrost stopped this page because ${host || 'its address'} is on the ${d.list}. Lists can be wrong: if you’re sure the site is safe, you can open it. Bifrost won’t warn you about it again until you quit.`),
    h('button.btn.danger-text', { type: 'button', onclick: visit }, icon('warn'), `Visit ${host || 'the site'} anyway (unsafe)`));
  // Back to the page it was showing (still there underneath), or the start page if there wasn't one.
  const back = () => {
    let shown = '';
    try { shown = tab.wv ? tab.wv.getURL() : ''; } catch { shown = ''; }
    let title = '';
    try { title = tab.wv ? tab.wv.getTitle() : ''; } catch { title = ''; }
    setTab(tab, { danger: null, url: shown && shown !== 'about:blank' ? shown : tab.url, title: title || tab.title });
    if (!shown || shown === 'about:blank') loadUrl(tab, NEWTAB_URL);
  };
  return h('div.pane-overlay.err.danger', null,
    h('div.err-card', null,
      h('div.err-icon', null, icon('warn')),
      h('h2', null, title),
      h('p', null, text),
      h('p.err-url', null, displayUrl(d.url) || d.url),
      h('div.err-actions', null,
        h('button.btn.primary.safety', { type: 'button', onclick: back }, icon('back'), 'Back to safety'),
        h('button.btn.ghost', { type: 'button', onclick: (ev) => { more.hidden = !more.hidden; ev.currentTarget.classList.toggle('on', !more.hidden); } }, icon('info'), 'Details')),
      more));
}

function crashOverlay(tab) {
  const r = tab.crashed;
  const msg = r === 'oom' ? 'The page ran out of memory.' : r === 'killed' ? 'The page’s process was stopped.' : 'Something went wrong while showing this page.';
  return h('div.pane-overlay.err', null,
    h('div.err-card', null,
      h('div.err-icon.warn', null, icon('warn')),
      h('h2', null, 'This page crashed'),
      h('p', null, msg),
      h('div.err-actions', null, h('button.btn.primary', { onclick: () => reload(tab) }, icon('reload'), 'Reload'))));
}

// --------------------------------------------------------------- resizers
let resizerEls = [];
function renderResizers(sp) {
  for (const r of resizerEls) r.remove();
  resizerEls = [];
  if (!sp) return;
  const n = sp.tabIds.length;
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    acc += sp.sizes[i];
    const pos = `calc((100% - ${n - 1} * var(--split-gap)) * ${acc.toFixed(5)} + ${i} * var(--split-gap))`;
    const el = h('div.split-resizer' + (sp.orientation === 'column' ? '.horiz' : ''));
    if (sp.orientation === 'column') el.style.top = pos; else el.style.left = pos;
    el.addEventListener('pointerdown', (e) => startResize(e, sp, i));
    el.addEventListener('dblclick', () => { sp.sizes = sp.sizes.map(() => 1 / n); layout(); emit('structure'); });
    panesEl.appendChild(el);
    resizerEls.push(el);
  }
}

function startResize(e, sp, i) {
  if (e.button !== 0) return;
  e.preventDefault();
  const rect = stageEl.getBoundingClientRect();
  const col = sp.orientation === 'column';
  const total = (col ? rect.height : rect.width);
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--split-gap')) || 6;
  const usable = total - (sp.tabIds.length - 1) * gap;
  const before = sp.sizes.slice(0, i).reduce((a, b) => a + b, 0);
  const pair = sp.sizes[i] + sp.sizes[i + 1];
  const min = Math.min(0.12, pair / 2.2);
  const shield = dragShield(col ? 'row-resize' : 'col-resize');
  const move = (ev) => {
    const p = ((col ? ev.clientY - rect.top : ev.clientX - rect.left) - i * gap) / usable;
    let a = Math.max(min, Math.min(pair - min, p - before));
    sp.sizes[i] = a;
    sp.sizes[i + 1] = pair - a;
    layout();
  };
  const up = () => {
    shield.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('structure');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// A full-window layer that keeps pointer events away from pages during drags.
export function dragShield(cursor = 'default') {
  const el = h('div.drag-shield', { style: { cursor } });
  document.body.appendChild(el);
  return el;
}

// ----------------------------------------------------------- html fullscreen
// A page in full screen: its <webview> goes full screen in the window's top layer, above everything else in
// the window. So while it is, the overlay layer (menus, dialogs, prompts, notifications) is put in the top
// layer too, after it, and whatever opens from the page (its right-click menu, an alert, a permission prompt)
// shows over it.
function overlayAboveFullscreen(on) {
  const root = document.getElementById('overlay-root');
  try {
    if (on) {
      if (!root.hasAttribute('popover')) root.setAttribute('popover', 'manual');
      if (root.matches(':popover-open')) root.hidePopover();
      root.showPopover();
    } else if (root.hasAttribute('popover')) {
      if (root.matches(':popover-open')) root.hidePopover();
      root.removeAttribute('popover');
    }
  } catch { /* fine: it just stays under the page */ }
}
document.addEventListener('fullscreenchange', () => overlayAboveFullscreen(!!document.fullscreenElement));

// Brings the page in full screen back (Esc, switching tabs). From the window's side as well as the page's:
// a page that's waiting (in an alert(), say) can't run anything.
export function exitHtmlFullscreen() {
  const t = S.htmlFullscreenTab;
  let did = false;
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); did = true; }
  if (t && t.wv) {
    try { t.wv.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false', true).catch(() => {}); } catch { /* gone */ }
    did = true;
  }
  return did;
}

// The same, resolving once the page is out of full screen and the window can be used again (for showing
// something of Bifrost's: while a page is full screen, the rest of the window can't be clicked or typed in).
export function leaveHtmlFullscreen() {
  const fs = S.htmlFullscreenTab;
  if (!fs) return Promise.resolve();
  exitHtmlFullscreen();
  return new Promise((resolve) => {
    let done = false, timer = 0;
    const onChange = () => { if (!document.fullscreenElement) finish(); };
    function finish() {
      if (done) return;
      done = true;
      document.removeEventListener('fullscreenchange', onChange);
      clearTimeout(timer);
      if (S.htmlFullscreenTab === fs) setHtmlFullscreen(fs, false);
      requestAnimationFrame(() => resolve());
    }
    document.addEventListener('fullscreenchange', onChange);
    timer = setTimeout(finish, 1200);
    if (!document.fullscreenElement) finish();
  });
}

// "Press Esc to exit full screen", for a moment, as in Chrome.
let fsHint = null, fsHintTimer = null;
function hideFsHint() {
  clearTimeout(fsHintTimer);
  const el = fsHint;
  fsHint = null;
  if (!el) return;
  el.classList.remove('on');
  setTimeout(() => el.remove(), 400);
}
function setHtmlFullscreen(tab, on) {
  const was = S.htmlFullscreenTab;
  S.htmlFullscreenTab = on ? tab : (S.htmlFullscreenTab === tab ? null : S.htmlFullscreenTab);
  document.documentElement.classList.toggle('html-fs', !!S.htmlFullscreenTab);
  layout();
  if (on) {
    if (!fsHint) {
      fsHint = h('div.fs-hint', { role: 'status' }, 'Press ', h('kbd', null, 'Esc'), ' to exit full screen');
      document.getElementById('overlay-root').appendChild(fsHint);
    }
    const el = fsHint;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    clearTimeout(fsHintTimer);
    fsHintTimer = setTimeout(hideFsHint, 2800);
  } else if (!S.htmlFullscreenTab) hideFsHint();
  if (was !== S.htmlFullscreenTab) emit('html-fullscreen', S.htmlFullscreenTab);
}

// ----------------------------------------------------------------- status
let statusEl = null, statusTimer = null;
function showStatus(tab, url) {
  if (!setting('appearance.showStatusBubble')) return;
  if (!statusEl) { statusEl = h('div.status-bubble'); document.getElementById('stage-ui').appendChild(statusEl); }
  clearTimeout(statusTimer);
  if (!url) { statusTimer = setTimeout(() => statusEl.classList.remove('on'), 120); return; }
  statusEl.textContent = displayUrl(url) || url;
  // Bottom-left of the pane the link is in.
  const pane = tab.pane && !tab.pane.el.hidden ? tab.pane.el : null;
  if (pane) {
    const sr = stageEl.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    statusEl.style.left = (pr.left - sr.left + 8) + 'px';
    statusEl.style.maxWidth = Math.max(160, pr.width * 0.6) + 'px';
  }
  statusEl.classList.add('on');
}

// ------------------------------------------------------------------- init
export function init() {
  on('tab', (tab, patch) => {
    if (!tab.pane) return;
    if ('loading' in patch || 'title' in patch || 'url' in patch || 'favicon' in patch || 'error' in patch || 'crashed' in patch || 'danger' in patch) renderPane(tab);
  });
  on('active', (tab) => {
    // Switching to another tab brings a page in full screen back, as in Chrome.
    const fs = S.htmlFullscreenTab;
    if (fs && fs !== tab) { exitHtmlFullscreen(); setHtmlFullscreen(fs, false); }
    layout();
  });
  on('workspace', () => {
    const fs = S.htmlFullscreenTab;
    if (fs && fs !== activeTab()) { exitHtmlFullscreen(); setHtmlFullscreen(fs, false); }
    layout();
  });
  setInterval(sleepCheck, 60000);
  // Leaving the window hides the status bubble.
  window.addEventListener('blur', () => statusEl && statusEl.classList.remove('on'));
}
