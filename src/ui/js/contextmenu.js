// Bifrost browser UI — the right-click menu for pages (links, images, media, text, editing).
import { S, emit, tabByWc, accelFor, setting } from './state.js';
import { copyText } from './util.js';
import { showMenu } from './menus.js';
import { toast } from './prompts.js';
import * as T from './tabs.js';
import * as V from './views.js';
import { panelWebview } from './panels.js';
import * as Tr from '/_/common/translate.js';

const wb = window.wb;

function copy(tab, text, note) {
  V.guest(tab, 'copyText', { text }).catch(() => copyText(text));
  if (note) toast({ text: note, iconName: 'check', timeout: 1500 });
}

function cmd(id, args) { return () => emit('command', id, args || {}); }
const targetLanguage = () => Tr.translateCode((S.settings.translate || {}).target) || Tr.translateCode(navigator.language) || 'en';

// Where the menu opens: at the pointer. Chromium gives the click's x and y relative to the whole window (in
// older versions, relative to the page); the pointer's own position, sent along by the main process, tells
// which, and is where a right-click's menu goes. (A menu from the keyboard opens at the focused element.)
let clickRelativeTo = 'window';
function menuPosition(wv, p) {
  const r = wv.getBoundingClientRect();
  const inWindow = { x: p.x, y: p.y }, inPage = { x: r.left + p.x, y: r.top + p.y };
  if (p.cx != null && p.cy != null && p.source !== 'keyboard') {
    const near = (a) => Math.abs(a.x - p.cx) <= 6 && Math.abs(a.y - p.cy) <= 6;
    if (near(inWindow)) clickRelativeTo = 'window';
    else if (near(inPage)) clickRelativeTo = 'page';
    if (p.cx >= r.left - 2 && p.cx <= r.right + 2 && p.cy >= r.top - 2 && p.cy <= r.bottom + 2) return { x: p.cx, y: p.cy };
  }
  return clickRelativeTo === 'page' ? inPage : inWindow;
}

// Over a page in full screen the window's own menus can't show (the page covers the window), so the menu is
// the system's: the same items, without icons.
async function nativeMenu(items, pos) {
  const actions = [];
  const conv = async (list) => {
    const out = [];
    for (const it of list || []) {
      if (!it || it.type === 'custom') continue;
      if (it === '-' || it.type === 'separator') { if (out.length && out[out.length - 1].type !== 'separator') out.push({ type: 'separator' }); continue; }
      if (it.type === 'header') { out.push({ label: it.label, enabled: false }); continue; }
      let sub = it.submenu;
      if (typeof sub === 'function') { try { sub = await sub(); } catch { sub = []; } }
      const o = { label: it.label + (it.sub ? '  (' + it.sub + ')' : ''), enabled: !it.disabled };
      if (it.accel) o.accel = it.accel;
      if (it.toggle || it.checked) { o.type = 'checkbox'; o.checked = !!it.checked; }
      if (sub) o.submenu = await conv(sub.length ? sub : [{ label: 'Empty', disabled: true }]);
      else { o.id = actions.length; actions.push(it); }
      out.push(o);
    }
    while (out.length && out[out.length - 1].type === 'separator') out.pop();
    return out;
  };
  const spec = await conv(items);
  const id = await wb.invoke('menu:native', spec, pos).catch(() => null);
  const it = id != null ? actions[id] : null;
  if (it && !it.disabled && typeof it.action === 'function') {
    try { const r = it.action({}); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); }
  }
}

function popupMenu(items, pos) {
  if (S.htmlFullscreenTab) nativeMenu(items, pos);
  else showMenu(items, pos, { restoreFocus: true });
}

function extensionItems(menuId, list) {
  return list.map((it) => {
    if (it.type === 'separator') return '-';
    return {
      label: it.label, disabled: !it.enabled, checked: it.checked,
      submenu: it.submenu && it.submenu.length ? extensionItems(menuId, it.submenu) : null,
      action: () => wb.send('menu:ext-click', menuId, it.id),
    };
  });
}

// An extension's side panel: links, editing, its own menu items, Reload and Inspect.
// The side panel's page: a website there, or an extension's panel.
function panelMenu(wv, p) {
  const items = [];
  const web = wv.dataset.sidePanel === 'web';
  const link = p.linkURL && !/^javascript:/i.test(p.linkURL) ? p.linkURL : '';
  const sel = (p.selectionText || '').trim();
  const src = p.srcURL || '';
  if (p.misspelledWord) {
    const sug = (p.dictionarySuggestions || []).slice(0, 5);
    if (sug.length) items.push(...sug.map((w) => ({ label: w, action: () => wv.replaceMisspelling(w) })));
    else items.push({ label: 'No spelling suggestions', disabled: true });
    items.push('-');
  }
  if (link) {
    items.push(
      /^(https?|ftp):/i.test(link) ? { label: 'Open link in new tab', icon: 'plus', action: () => T.openTab({ url: link, active: !!setting('tabs.switchToNewTabs') }) } : null,
      web && /^https?:/i.test(link) ? { label: 'Open link here', icon: 'sidebar', action: () => wv.loadURL(link) } : null,
      { label: 'Copy link address', icon: 'link', action: () => copyText(link) }, '-');
  }
  if (web && (p.mediaType === 'image' || p.hasImageContents) && /^(https?|data):/i.test(src)) {
    items.push({ label: 'Open image in new tab', icon: 'external', action: () => T.openTab({ url: src, active: false }) }, { label: 'Copy image address', icon: 'link', action: () => copyText(src) }, '-');
  }
  if (p.isEditable) {
    const f = p.editFlags || {};
    items.push(
      { label: 'Undo', accel: 'Ctrl+Z', disabled: !f.canUndo, action: () => wv.undo() },
      { label: 'Redo', accel: 'Ctrl+Y', disabled: !f.canRedo, action: () => wv.redo() },
      '-',
      { label: 'Cut', accel: 'Ctrl+X', disabled: !f.canCut, action: () => wv.cut() },
      { label: 'Copy', accel: 'Ctrl+C', disabled: !f.canCopy, action: () => wv.copy() },
      { label: 'Paste', accel: 'Ctrl+V', disabled: !f.canPaste, action: () => wv.paste() },
      { label: 'Select all', accel: 'Ctrl+A', disabled: !f.canSelectAll, action: () => wv.selectAll() },
      '-');
  } else if (sel) {
    items.push({ label: 'Copy', icon: 'copy', accel: 'Ctrl+C', action: () => wv.copy() }, '-');
  }
  if (web && !link && !p.isEditable && !sel) {
    let back = false, fwd = false, url = '';
    try { back = wv.canGoBack(); fwd = wv.canGoForward(); url = wv.getURL(); } catch { /* not attached */ }
    items.push(
      { label: 'Back', icon: 'back', disabled: !back, action: () => wv.goBack() },
      { label: 'Forward', icon: 'forward', disabled: !fwd, action: () => wv.goForward() },
      { label: 'Reload', icon: 'reload', action: () => wv.reload() },
      '-',
      { label: 'Open page in new tab', icon: 'external', disabled: !/^https?:/i.test(url), action: () => T.openTab({ url, active: true }) },
      { label: 'Copy page address', icon: 'link', disabled: !url, action: () => copyText(url) });
  } else {
    items.push({ label: 'Reload', icon: 'reload', action: () => wv.reload() });
  }
  if (p.extensions && p.extensions.length) items.push('-', ...extensionItems(p.menuId, p.extensions));
  items.push('-', { label: 'Inspect', icon: 'wrench', action: () => wb.invoke('guest:action', p.wcId, 'inspect', { x: p.x, y: p.y }).catch(() => {}) });
  popupMenu(items, menuPosition(wv, p));
}

export function showPageMenu(p) {
  const tab = tabByWc(p.wcId);
  if (!tab || !tab.wv) {
    const wv = panelWebview(p.wcId);
    if (wv) panelMenu(wv, p);
    return;
  }
  const pos = menuPosition(tab.wv, p);
  const E = window.WBEngine;
  const items = [];
  const link = p.linkURL && !/^javascript:/i.test(p.linkURL) ? p.linkURL : '';
  const src = p.srcURL || '';
  const sel = (p.selectionText || '').trim();
  const image = p.mediaType === 'image' || (p.hasImageContents && src);
  const video = p.mediaType === 'video', audio = p.mediaType === 'audio';
  const fetchable = /^(https?|data|file):/i.test(src);

  if (p.misspelledWord) {
    const sug = (p.dictionarySuggestions || []).slice(0, 5);
    if (sug.length) items.push(...sug.map((w) => ({ label: w, action: () => V.call(tab, 'replaceMisspelling', w) })));
    else items.push({ label: 'No spelling suggestions', disabled: true });
    items.push({ label: 'Add to dictionary', icon: 'book', action: () => V.guest(tab, 'addToDictionary', { word: p.misspelledWord }) }, '-');
  }

  if (link) {
    items.push(
      { label: 'Open link in new tab', icon: 'plus', action: () => T.openTab({ url: link, active: !!setting('tabs.switchToNewTabs'), opener: tab }) },
      { label: 'Open link in split view', icon: 'split', action: () => { T.selectTab(tab, { focus: false }); T.openUrl(link, { where: 'split' }); } },
      { label: 'Open link in new window', icon: 'window', action: () => T.openUrl(link, { where: 'window' }) },
      S.isPrivate ? null : { label: 'Open link in private window', icon: 'mask', action: () => T.openUrl(link, { where: 'private' }) },
      '-',
      { label: 'Copy link address', icon: 'link', action: () => copy(tab, link) },
      p.linkText && p.linkText.trim() ? { label: 'Copy link text', action: () => copy(tab, p.linkText.trim()) } : null,
      /^(https?|ftp|data):/i.test(link) ? { label: 'Save link as…', icon: 'download', action: () => V.guest(tab, 'download', { url: link }) } : null,
      '-');
  }

  if (image && src) {
    items.push(
      fetchable ? { label: 'Open image in new tab', icon: 'external', action: () => T.openTab({ url: src, active: false, opener: tab }) } : null,
      fetchable ? { label: 'Save image as…', icon: 'download', action: () => V.guest(tab, 'download', { url: src }) } : null,
      { label: 'Copy image', icon: 'copy', action: () => V.guest(tab, 'copyImageAt', { x: p.x, y: p.y }) },
      fetchable && !/^data:/i.test(src) ? { label: 'Copy image address', icon: 'link', action: () => copy(tab, src) } : null,
      /^https?:/i.test(src) ? { label: 'Search the web for this image', icon: 'search', action: () => T.openTab({ url: 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(src), opener: tab }) } : null,
      '-');
  }

  if ((video || audio) && src) {
    items.push(
      video ? { label: 'Picture-in-picture', icon: 'pip', action: () => V.guest(tab, 'pip') } : null,
      /^https?:/i.test(src) ? { label: `Save ${video ? 'video' : 'audio'} as…`, icon: 'download', action: () => V.guest(tab, 'download', { url: src }) } : null,
      /^https?:/i.test(src) ? { label: `Copy ${video ? 'video' : 'audio'} address`, icon: 'link', action: () => copy(tab, src) } : null,
      /^https?:/i.test(src) ? { label: `Open ${video ? 'video' : 'audio'} in new tab`, icon: 'external', action: () => T.openTab({ url: src, active: false, opener: tab }) } : null,
      '-');
  }

  if (p.isEditable) {
    const f = p.editFlags || {};
    items.push(
      { label: 'Undo', accel: 'Ctrl+Z', disabled: !f.canUndo, action: () => V.call(tab, 'undo') },
      { label: 'Redo', accel: 'Ctrl+Y', disabled: !f.canRedo, action: () => V.call(tab, 'redo') },
      '-',
      { label: 'Cut', accel: 'Ctrl+X', disabled: !f.canCut, action: () => V.call(tab, 'cut') },
      { label: 'Copy', accel: 'Ctrl+C', disabled: !f.canCopy, action: () => V.call(tab, 'copy') },
      { label: 'Paste', accel: 'Ctrl+V', disabled: !f.canPaste, action: () => V.call(tab, 'paste') },
      { label: 'Paste as plain text', accel: 'Ctrl+Shift+V', disabled: !f.canPaste, action: () => V.call(tab, 'pasteAndMatchStyle') },
      { label: 'Select all', accel: 'Ctrl+A', disabled: !f.canSelectAll, action: () => V.call(tab, 'selectAll') },
      '-');
  } else if (sel) {
    items.push({ label: 'Copy', icon: 'copy', accel: 'Ctrl+C', action: () => V.call(tab, 'copy') });
  }

  if (sel) {
    const engines = S.settings.search.engines;
    const eng = engines.find((x) => x.id === S.settings.search.defaultEngine) || engines[0];
    const short = sel.length > 30 ? sel.slice(0, 28) + '…' : sel;
    if (E.looksLikeUrl(sel)) items.push({ label: `Go to ${short}`, icon: 'globe', action: () => T.openTab({ url: E.toUrl(sel), opener: tab }) });
    items.push({ label: `Search ${eng.name} for “${short}”`, icon: 'search', action: () => T.openTab({ url: E.fillTemplate(eng.url, sel), opener: tab }) });
    const others = engines.filter((x) => x !== eng).slice(0, 8);
    if (others.length) items.push({ label: 'Search with', icon: 'search', submenu: others.map((x) => ({ label: x.name, action: () => T.openTab({ url: E.fillTemplate(x.url, sel), opener: tab }) })) });
    items.push('-');
  }

  if (!link && !image && !p.isEditable && !sel && !video && !audio) {
    items.push(
      { label: 'Back', icon: 'back', accel: accelFor('back'), disabled: !p.canGoBack, action: () => V.goBack(tab) },
      { label: 'Forward', icon: 'forward', accel: accelFor('forward'), disabled: !p.canGoForward, action: () => V.goForward(tab) },
      { label: 'Reload', icon: 'reload', accel: accelFor('reload'), action: () => V.reload(tab) },
      '-',
      { label: 'Bookmark this page', icon: 'star', accel: accelFor('bookmarkPage'), action: cmd('bookmarkPage') },
      { label: 'Copy page address', icon: 'link', action: () => copy(tab, tab.url, 'Address copied') },
      { label: 'Save page as…', icon: 'save', accel: accelFor('savePage'), action: cmd('savePage') },
      { label: 'Print…', icon: 'print', accel: accelFor('print'), action: cmd('print') },
      { label: 'Take a screenshot', icon: 'camera', accel: accelFor('screenshot'), action: cmd('screenshot') },
      /^https?:/i.test(tab.url) ? { label: 'Reader view', icon: 'reader', accel: accelFor('readerMode'), action: cmd('readerMode') } : null,
      Tr.isTranslated(tab.url) ? { label: 'Show the original page', icon: 'translate', action: cmd('translatePage', { wcId: tab.wcId }) }
        : Tr.canTranslate(tab.url) ? { label: `Translate into ${Tr.languageName(targetLanguage())}`, icon: 'translate', accel: accelFor('translatePage'), action: cmd('translatePage', { wcId: tab.wcId }) } : null,
      '-',
      { label: 'View page source', icon: 'code', accel: accelFor('viewSource'), action: cmd('viewSource') });
  }

  if (p.extensions && p.extensions.length) items.push('-', ...extensionItems(p.menuId, p.extensions));
  items.push('-', { label: 'Inspect', icon: 'wrench', accel: accelFor('devtools'), action: () => V.guest(tab, 'inspect', { x: p.x, y: p.y }) });
  popupMenu(items, pos);
}
