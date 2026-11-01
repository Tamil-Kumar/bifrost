// Bifrost browser UI — dialogs, toasts, and the prompts the main process asks the UI to show
// (site permissions, screen sharing, extension installs).
import { S, on, emit, tabByWc, visibleTabs, activeTab } from './state.js';
import { h, hostOf } from './util.js';
import { icon } from './icons.js';
import { popover } from './menus.js';
import * as V from './views.js';
import { dialog, confirmDialog, promptDialog, toast } from '/_/common/dialogs.js';

export { dialog, confirmDialog, promptDialog, toast };

// ------------------------------------------------------------- permissions
const PERM_ICON = { camera: 'video', microphone: 'mic', geolocation: 'location', notifications: 'bell', 'clipboard-read': 'copy', 'display-capture': 'monitor', midi: 'keyboard', midiSysex: 'keyboard', openExternal: 'external' };

export function permissionPrompt(args) {
  return new Promise((resolve) => {
    const tab = tabByWc(args.wcId);
    if (!tab) { resolve({ allow: false, remember: false }); return; }
    tab.prompts.push({ args, resolve, handle: null });
    showPrompts();
  });
}

function anchorFor(tab) {
  if (tab === activeTab()) {
    const site = document.getElementById('site-btn');
    if (site && site.offsetParent) return { anchor: site, side: 'bottom', align: 'start' };
  }
  if (tab.pane && !tab.pane.el.hidden) return { anchor: tab.pane.head.offsetParent ? tab.pane.head : tab.pane.el, side: 'bottom', align: 'start' };
  return null;
}

function showPrompts() {
  const vis = visibleTabs();
  for (const tab of S.tabs) {
    for (const p of tab.prompts) {
      if (!vis.includes(tab)) { if (p.handle) { p.handle.close('hidden'); p.handle = null; } continue; }
    }
    const p = tab.prompts[0];
    if (!p || p.handle || !vis.includes(tab)) continue;
    // A page in full screen asking: it leaves full screen so the question can be seen and answered.
    if (tab === S.htmlFullscreenTab) { V.leaveHtmlFullscreen().then(() => setTimeout(showPrompts, 60)); continue; }
    const pos = anchorFor(tab);
    if (!pos) continue;
    const a = p.args;
    const remember = h('input', { type: 'checkbox', checked: !S.isPrivate });
    const answer = (allow) => {
      tab.prompts.shift();
      p.resolve({ allow, remember: remember.checked });
      if (p.handle) { const hd = p.handle; p.handle = null; hd.close('answered'); }
      setTimeout(showPrompts, 50);
    };
    const keys = a.keys || [a.permission];
    const body = h('div.perm', null,
      h('div.perm-head', null, h('span.perm-icon', null, icon(PERM_ICON[keys[0]] || 'shield')),
        h('div', null, h('b', null, a.host || hostOf(a.origin) || a.origin), h('span', null, ' wants to'))),
      h('ul.perm-list', null, (a.labels || keys).map((l, i) => h('li', null, icon(PERM_ICON[keys[i]] || 'info'), l))),
      a.externalUrl ? h('p.perm-ext', null, a.externalUrl) : null,
      S.isPrivate ? null : h('label.check', null, remember, h('span', null, 'Remember for this site')),
      h('div.perm-actions', null,
        h('button.btn', { onclick: () => answer(false) }, 'Block'),
        h('button.btn.primary', { onclick: () => answer(true), autofocus: true }, 'Allow')));
    p.handle = popover(body, pos, { modal: false, sticky: true, exclusive: false, className: 'perm-pop', restoreFocus: false, focus: false });
  }
}

// ------------------------------------------------------------ screen share
export function screenPicker({ origin, sources = [], audio }) {
  let chosen = null;
  const grid = h('div.picker-grid');
  const audioBox = h('input', { type: 'checkbox', checked: false });
  const tabsBar = h('div.seg');
  let kind = sources.some((s) => s.type === 'screen') ? 'screen' : 'window';
  const shareBtn = { el: null };
  const render = () => {
    tabsBar.replaceChildren(...['screen', 'window'].map((k) => h('button.seg-btn' + (k === kind ? '.on' : ''), { onclick: () => { kind = k; chosen = null; render(); } }, k === 'screen' ? 'Entire screen' : 'Window')));
    grid.replaceChildren(...sources.filter((s) => s.type === kind).map((s) => {
      const card = h('button.picker-item' + (chosen === s.id ? '.on' : ''), { onclick: () => { chosen = s.id; render(); }, ondblclick: () => { chosen = s.id; finishBtn(); } },
        h('div.picker-thumb', null, s.thumb ? h('img', { src: s.thumb, alt: '' }) : icon(kind === 'screen' ? 'monitor' : 'window')),
        h('div.picker-name', null, s.icon ? h('img.picker-app', { src: s.icon, alt: '' }) : null, h('span', null, s.name)));
      return card;
    }));
    if (shareBtn.el) shareBtn.el.disabled = !chosen;
  };
  let finishBtn = () => {};
  render();
  const body = h('div.picker', null,
    h('p.muted', null, (hostOf(origin) || origin || 'This site') + ' wants to share your screen.'),
    tabsBar, grid,
    audio && S.platform === 'win32' ? h('label.check', null, audioBox, h('span', null, 'Also share system audio')) : null);
  const p = dialog({
    title: 'Choose what to share', iconName: 'monitor', body, width: 680,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Share', primary: true, value: () => (chosen ? { id: chosen, audio: audioBox.checked } : null) }],
  });
  finishBtn = () => { const b = [...document.querySelectorAll('.dialog .btn.primary')].pop(); if (b) b.click(); };
  return p;
}

// --------------------------------------------------------------- extensions
export function extensionInstallPrompt({ name, icon: iconUrl, warnings = [], replaces = '', fromFile = false }) {
  const body = h('div.ext-prompt', null,
    h('div.ext-prompt-head', null, iconUrl ? h('img', { src: iconUrl, alt: '' }) : h('span.ext-ph', null, icon('puzzle')), h('b', null, name || 'This extension')),
    replaces ? h('p.ext-replace', null, icon('warn'), h('span', null, `This replaces “${replaces}”, which you already have, and takes over its saved data. Only continue if both come from the same developer.`)) : null,
    warnings.length ? h('div', null, h('p.muted', null, 'It will be able to:'), h('ul.ext-warn', null, warnings.map((w) => h('li', null, w)))) : h('p.muted', null, 'It doesn’t need any special permissions.'),
    fromFile ? h('p.muted.small', null, 'From a file on this computer. Install extensions only from people you trust.') : null);
  return dialog({ title: replaces ? `Replace “${replaces}”?` : `Add “${name}”?`, iconName: 'puzzle', body, buttons: [{ label: 'Cancel', value: { allow: false } }, { label: replaces ? 'Replace' : 'Add extension', primary: true, value: { allow: true } }], dismissValue: { allow: false } });
}

export function extensionPermissionPrompt({ name, warnings = [] }) {
  const body = h('div.ext-prompt', null, h('p', null, `${name} is asking for more access:`), h('ul.ext-warn', null, warnings.map((w) => h('li', null, w))));
  return dialog({ title: 'Allow more access?', iconName: 'shield', body, buttons: [{ label: 'Deny', value: { allow: false } }, { label: 'Allow', primary: true, value: { allow: true } }], dismissValue: { allow: false } });
}

// ------------------------------------------------- alert, confirm, prompt
// A page's alert(), confirm() and prompt() (main/guests.js): Bifrost's dialog, shown when that tab is in
// front (a tab in the background waits, as in Chrome, and gets a dot). A page that keeps opening them
// can be stopped until it's reloaded or left.
const jsQueue = [];   // { tab, args, resolve }
let jsShowing = null;
export function jsDialog(args) {
  return new Promise((resolve) => {
    const tab = tabByWc(args.wcId);
    const none = args.type === 'confirm' ? false : args.type === 'prompt' ? null : true;
    if (!tab || tab.dialogsBlocked) { resolve(none); return; }
    jsQueue.push({ tab, args, resolve, none, wasFullscreen: S.htmlFullscreenTab === tab });
    if (tab !== activeTab()) { tab.attention = true; emit('tab', tab, { attention: true }); }
    showJsDialog();
  });
}

function showJsDialog() {
  if (jsShowing) return;
  const i = jsQueue.findIndex((q) => q.tab === activeTab());
  if (i < 0) return;
  // A page in full screen asking: it leaves full screen first (from the window's side, as the page itself is
  // waiting for the answer), so the dialog can be seen and answered, as in Chrome.
  if (S.htmlFullscreenTab) { V.leaveHtmlFullscreen().then(showJsDialog); return; }
  const q = jsQueue.splice(i, 1)[0];
  jsShowing = q;
  const { tab, args } = q;
  if (tab.attention) { tab.attention = false; emit('tab', tab, { attention: false }); }
  // "example.com says", like other browsers; an embedded page says where it's from.
  let who = 'This page';
  try { const u = new URL(args.url); if (/^https?:$/.test(u.protocol)) who = u.host; else if (u.protocol === 'file:') who = 'This file'; } catch { /* keep */ }
  const now = Date.now();
  tab.jsDialogTimes = (tab.jsDialogTimes || []).filter((x) => now - x < 30000).concat(now);
  const offerBlock = tab.jsDialogTimes.length >= 3;
  const block = h('input', { type: 'checkbox' });
  const input = args.type === 'prompt' ? h('input.field', { type: 'text', spellcheck: 'false', autofocus: true }) : null;
  if (input) input.value = args.value || '';
  const body = h('div.js-dialog', null,
    args.message ? h('p.js-dialog-text', null, args.message) : null,
    input,
    offerBlock ? h('label.check.js-dialog-block', null, block, h('span', null, 'Don’t let this page show more dialogs')) : null);
  const buttons = args.type === 'alert' ? [{ label: 'OK', value: true, primary: true }]
    : [{ label: 'Cancel', value: q.none }, { label: 'OK', value: args.type === 'prompt' ? () => input.value : true, primary: true }];
  // While it waits for the answer the page can't draw: if its size changes meanwhile (it was full screen a
  // moment ago, or the window is resized), its last picture of itself would still catch the clicks meant for
  // the dialog. So it's hidden until the answer.
  if (tab.wv) {
    const wv = tab.wv;
    wv.classList.add('js-dialog-open');
    if (q.wasFullscreen) wv.classList.add('js-dialog-hide');
    let size = null;
    q.watch = new ResizeObserver(([e]) => {
      const now = Math.round(e.contentRect.width) + 'x' + Math.round(e.contentRect.height);
      if (size && now !== size) wv.classList.add('js-dialog-hide');
      size = size || now;
    });
    q.watch.observe(wv);
  }
  const p = dialog({ title: args.top === false ? `An embedded page at ${who} says` : `${who} says`, body, buttons, iconName: args.type === 'alert' ? 'info' : 'help', dismissValue: q.none, width: 460, className: 'js-dialog-box' });
  if (input) setTimeout(() => { try { input.focus(); input.select(); } catch { /* gone */ } }, 30);
  q.handle = p;
  p.then((v) => {
    if (offerBlock && block.checked) tab.dialogsBlocked = true;
    finishJs(q, v);
  }, () => finishJs(q, q.none));
}

function finishJs(q, v) {
  if (jsShowing === q) jsShowing = null;
  if (q.watch) { q.watch.disconnect(); q.watch = null; }
  if (q.tab.wv) q.tab.wv.classList.remove('js-dialog-open', 'js-dialog-hide');
  q.resolve(v);
  showJsDialog();
}

export function init() {
  on('active', () => showJsDialog());
  on('tab-closing', (tab) => {
    for (let i = jsQueue.length - 1; i >= 0; i--) if (jsQueue[i].tab === tab) { const q = jsQueue.splice(i, 1)[0]; q.resolve(q.none); }
    if (jsShowing && jsShowing.tab === tab && jsShowing.handle && jsShowing.handle.close) jsShowing.handle.close(jsShowing.none);
  });
  on('navigated', (tab) => { tab.dialogsBlocked = false; tab.jsDialogTimes = []; });
  on('active', () => showPrompts());
  on('layout', () => showPrompts());
  on('html-fullscreen', () => setTimeout(showPrompts, 60));
  on('tab-closing', (tab) => {
    for (const p of tab.prompts) { if (p.handle) p.handle.close('closed'); p.resolve({ allow: false, remember: false }); }
    tab.prompts = [];
  });
  on('navigated', (tab) => {
    // A new page doesn't inherit the old page's pending prompts.
    for (const p of tab.prompts) { if (p.handle) p.handle.close('nav'); p.resolve({ allow: false, remember: false }); }
    tab.prompts = [];
  });
  on('toast', (opts) => toast(opts));
}
