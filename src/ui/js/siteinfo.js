// Bifrost browser UI — the site information popover (address bar icon) and the ad blocker popover.
import { on, emit, activeTab, setting, setTab } from './state.js';
import { h, hostOf, isInternal, isNewTab, pageName, faviconEl } from './util.js';
import { icon } from './icons.js';
import { popover } from './menus.js';
import { promptDialog, toast } from './prompts.js';
import * as V from './views.js';

const wb = window.wb;

const PERMS = [
  ['camera', 'Camera', 'video'], ['microphone', 'Microphone', 'mic'], ['geolocation', 'Location', 'location'],
  ['notifications', 'Notifications', 'bell'], ['clipboard-read', 'Clipboard', 'copy'], ['display-capture', 'Screen sharing', 'monitor'],
  ['midi', 'MIDI devices', 'keyboard'], ['openExternal', 'Open apps', 'external'], ['hid', 'HID devices', 'cpu'], ['serial', 'Serial ports', 'cpu'], ['usb', 'USB devices', 'cpu'],
];
const COMMON = new Set(['camera', 'microphone', 'geolocation', 'notifications']);

function toggle(checked, onChange, disabled = false) {
  const input = h('input', { type: 'checkbox', checked, disabled, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch' + (disabled ? '.disabled' : ''), null, input, h('span.switch-track', null, h('span.switch-thumb')));
}

function row(iconName, label, control, sub) {
  return h('div.si-row', null, h('span.si-ico', null, icon(iconName)), h('div.si-label', null, h('span', null, label), sub ? h('small', null, sub) : null), control);
}

async function siteInfo(anchor) {
  const t = activeTab();
  if (!t) return;
  const url = t.url;
  const host = hostOf(url);
  const internal = isInternal(url);
  const web = /^https?:/i.test(url);
  const info = web ? await wb.invoke('site:info', url).catch(() => null) : null;
  const head = h('div.si-head', null, faviconEl(url, t.favicon, icon, 'si-fav'),
    h('div', null,
      h('div.si-host', null, internal ? (pageName(url) || 'Bifrost') : isNewTab(url) ? 'New tab' : host || url),
      h('div.si-sec' + (/^https:/i.test(url) ? '.ok' : /^http:/i.test(url) ? '.bad' : ''), null,
        icon(/^https:/i.test(url) ? 'lock' : /^http:/i.test(url) ? 'warn' : 'info'),
        /^https:/i.test(url) ? 'Connection is secure' : /^http:/i.test(url) ? 'Not secure: information you send can be read in transit' : internal ? 'A built-in Bifrost page' : /^file:/i.test(url) ? 'A file on your computer' : 'Local page')));
  const body = h('div.si', null, head);
  if (!web || !info) {
    popover(body, { anchor, side: 'bottom', align: 'start' }, { className: 'si-pop' });
    return;
  }

  // Permissions: the common ones always, others once the site has asked.
  const perms = h('div.si-section', null, h('div.si-title', null, 'Permissions'));
  for (const [key, label, ic] of PERMS) {
    const val = info.permissions[key];
    if (!val && !COMMON.has(key)) continue;
    const sel = h('select.select-sm', null,
      h('option', { value: '' }, 'Ask'), h('option', { value: 'allow' }, 'Allow'), h('option', { value: 'block' }, 'Block'));
    sel.value = val || '';
    sel.addEventListener('change', () => wb.invoke('site:set', host, 'perm:' + key, sel.value || null).then(() => notice.hidden = false));
    perms.append(row(ic, label, sel));
  }
  const notice = h('p.si-note', { hidden: true }, 'Reload the page to apply changes. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); V.reload(t); pop.close(); } }, 'Reload'));
  perms.append(notice);
  body.append(perms);

  // Ad blocking, Vim keys, HTTPS-only exception.
  const tools = h('div.si-section');
  const adOn = setting('privacy.adblock.enabled');
  tools.append(row('shield', 'Block ads and trackers', toggle(adOn && !info.adblockAllowed, async (on) => {
    await wb.invoke('adblock:set-site', host, !on);
    V.reload(t);
  }, !adOn), adOn ? `${t.blocked || 0} blocked on this page` : 'Turned off in settings'));
  if (setting('keyboard.vim.enabled')) {
    tools.append(row('vim', 'Vim keys', toggle(!info.vimOff, (on) => emit('command', 'toggleVimSite', { host, on })), 'Keyboard browsing with h j k l, f for links'));
  }
  if ((setting('privacy.httpsOnly') && /^http:/i.test(url)) || info.httpAllowed) {
    tools.append(row('lock', 'Allow plain HTTP', toggle(!!info.httpAllowed, (on) => wb.invoke('site:set', host, 'httpAllowed', on || null)), 'Skip the HTTPS-only upgrade for this site'));
  }
  body.append(tools);

  // Zoom.
  const zoomLabel = h('span.si-zoom-val');
  const showZoom = (z) => { zoomLabel.textContent = Math.round(Math.pow(1.2, z || 0) * 100) + '%'; };
  showZoom(t.zoom);
  const zoomRow = h('div.si-zoom', null,
    h('span.si-ico', null, icon('zoomIn')), h('span.si-zoom-label', null, 'Zoom'),
    h('button.icon-btn', { type: 'button', title: 'Zoom out', onclick: async () => showZoom(await V.guest(t, 'zoomBy', { delta: -0.5 }).catch(() => t.zoom)) }, icon('zoomOut')),
    zoomLabel,
    h('button.icon-btn', { type: 'button', title: 'Zoom in', onclick: async () => showZoom(await V.guest(t, 'zoomBy', { delta: 0.5 }).catch(() => t.zoom)) }, icon('zoomIn')),
    h('button.btn.small', { type: 'button', onclick: async () => showZoom(await V.guest(t, 'setZoom', { level: 0 }).catch(() => 0)) }, 'Reset'));
  body.append(h('div.si-section', null, zoomRow));

  // Cookies and site data, custom CSS, settings.
  const cookieText = h('small', null, '…');
  wb.invoke('site:cookies', url).then((n) => { cookieText.textContent = n === 1 ? '1 cookie' : `${n} cookies`; }).catch(() => { cookieText.textContent = ''; });
  body.append(h('div.si-section', null,
    h('div.si-row', null, h('span.si-ico', null, icon('cookie')), h('div.si-label', null, h('span', null, 'Cookies and site data'), cookieText),
      h('button.btn.small', { type: 'button', onclick: async () => {
        await wb.invoke('site:clear-data', url);
        pop.close();
        toast({ text: `Cleared data for ${host}`, iconName: 'trash', actions: [{ label: 'Reload', action: () => V.reload(t, true) }] });
      } }, 'Clear')),
    h('div.si-links', null,
      h('button.link-btn', { type: 'button', onclick: () => { pop.close(); editSiteCss(host, info.siteCss, t); } }, icon('palette'), info.siteCss ? 'Edit site style' : 'Add a style for this site'),
      h('button.link-btn', { type: 'button', onclick: () => { pop.close(); emit('command', 'openSettings', { section: 'sites', host }); } }, icon('sliders'), 'Site settings'))));
  const pop = popover(body, { anchor, side: 'bottom', align: 'start' }, { className: 'si-pop' });
}

// The permissions shield (address bar, title pill): every permission for this site, Ask / Allow / Block,
// changed right here. What the page asked for comes first, saying what it got. Notifications apply at once (the page is
// told: preload/tab.js); the others from the next time the page loads, so it offers a reload.
const LIVE = new Set(['notifications']);
const ASKED_LABEL = { notifications: 'show notifications', camera: 'use your camera', microphone: 'use your microphone', geolocation: 'know your location', 'clipboard-read': 'see what you copy', 'display-capture': 'share your screen', midi: 'use MIDI devices', midiSysex: 'control MIDI devices', openExternal: 'open an app' };
async function sitePermissions(anchor) {
  const t = activeTab();
  if (!t || !/^https?:/i.test(t.url)) return;
  const url = t.url;
  const host = hostOf(url);
  const info = await wb.invoke('site:info', url).catch(() => null);
  if (!info) return;
  const name = host.replace(/^www\./, '');
  const asks = t.permAsks && t.permAsks.host === host ? t.permAsks.list : [];
  const body = h('div.si.perms', { dataset: { host } }, h('div.si-head', null, h('span.si-fav', null, icon('shield')),
    h('div', null, h('div.si-host', null, name), h('div.si-sec', null, 'What this site may do'))));
  const notice = h('p.si-note', { hidden: true }, 'Reload the page to apply this. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); V.reload(t); pop.close(); } }, 'Reload'));
  const set = async (key, value) => {
    await wb.invoke('site:set', host, 'perm:' + key, value || null);
    if (!LIVE.has(key)) notice.hidden = false;
    // (what the page asked for and was told: it has an answer now)
    if (t.permAsks && t.permAsks.host === host) setTab(t, { permAsks: { host, list: t.permAsks.list.map((a) => (a.key === key ? Object.assign({}, a, { allowed: value === 'allow' }) : a)) } });
  };
  // What it just asked for: one click to allow (or block) it.
  for (const a of asks) {
    const val = info.permissions[a.key];
    const allowNow = h('button.btn.small' + (a.allowed ? '' : '.primary'), { type: 'button', dataset: { act: 'allow-' + a.key }, onclick: async () => { await set(a.key, a.allowed ? 'block' : 'allow'); pop.close(); } }, a.allowed ? 'Block' : 'Allow');
    body.append(h('div.si-section.perm-asked' + (a.allowed ? '' : '.blocked'), null, row(PERMS.find((p) => p[0] === a.key) ? PERMS.find((p) => p[0] === a.key)[2] : 'shield',
      `It asked to ${ASKED_LABEL[a.key] || a.key}`, allowNow,
      a.allowed ? 'Allowed' : val === 'block' ? 'Blocked for this site' : a.asked ? 'You said no' : 'Blocked')));
  }
  const list = h('div.si-section', null, h('div.si-title', null, 'Permissions'));
  for (const [key, label, ic] of PERMS) {
    const val = info.permissions[key] || '';
    const sel = h('select.select-sm', { dataset: { perm: key } },
      h('option', { value: '' }, 'Ask'), h('option', { value: 'allow' }, 'Allow'), h('option', { value: 'block' }, 'Block'));
    sel.value = val;
    sel.addEventListener('change', () => set(key, sel.value));
    const forNow = (info.permissions.__forNow || []).includes(key);
    list.append(row(ic, label, sel, forNow ? 'For now (until Bifrost closes)' : null));
  }
  list.append(notice);
  body.append(list);
  body.append(h('div.si-links', null,
    h('button.link-btn', { type: 'button', onclick: async () => {
      for (const [key] of PERMS) if (info.permissions[key]) await wb.invoke('site:set', host, 'perm:' + key, null);
      pop.close();
      toast({ text: `${name} will ask again`, iconName: 'rotate', actions: [{ label: 'Reload', action: () => V.reload(t) }] });
    } }, icon('rotate'), 'Reset permissions'),
    h('button.link-btn', { type: 'button', onclick: () => { pop.close(); emit('command', 'openSettings', { section: 'sites', host }); } }, icon('sliders'), 'All site settings')));
  const pop = popover(body, { anchor, side: 'bottom', align: 'start' }, { className: 'si-pop perms-pop' });
}

async function editSiteCss(host, css, tab) {
  const v = await promptDialog({ title: `Custom style for ${host}`, label: 'CSS for every page on this site. It wins over the site’s own styles, like a userstyle, and applies as soon as you save.', value: css || '', ok: 'Save', multiline: true, mono: true, placeholder: 'body { font-size: 18px; }' });
  if (v == null) return;
  await wb.invoke('site:set', host, 'css', v.trim() ? v : null);
  toast({ text: v.trim() ? `Style saved for ${host}` : `Style removed for ${host}`, iconName: 'palette' });
}

async function adblockPopover(anchor) {
  const t = activeTab();
  const url = t ? t.url : '';
  const host = hostOf(url);
  const web = /^https?:/i.test(url);
  const status = await wb.invoke('adblock:status').catch(() => ({ enabled: false, total: 0 }));
  const info = web ? await wb.invoke('site:info', url).catch(() => null) : null;
  const n = t ? t.blocked || 0 : 0;
  const on = status.enabled && !(info && info.adblockAllowed);
  const body = h('div.ab', null,
    h('div.ab-head', null, h('span.ab-shield' + (on ? '' : '.off'), null, icon(on ? 'shieldCheck' : 'shieldOff')),
      h('div', null, h('b', null, 'Ad and tracker blocking'), h('small', null, status.enabled ? (status.ready ? 'Filter lists loaded' : 'Loading filter lists…') : 'Turned off'))),
    h('div.ab-stats', null,
      h('div', null, h('strong', null, String(on ? n : 0)), h('span', null, 'on this page')),
      h('div', null, h('strong', null, Number(status.total || 0).toLocaleString()), h('span', null, 'in total'))),
    web && status.enabled ? row('globe', host, toggle(on, async (v) => { await wb.invoke('adblock:set-site', host, !v); V.reload(t); pop.close(); }), on ? 'Blocking on this site' : 'Allowed on this site') : null,
    // On YouTube: how its video ads are handled (privacy.adblock.youtubeFilters).
    web && on && info && info.youtube
      ? row('video', 'Remove ads before they play', toggle(!!setting('privacy.adblock.youtubeFilters'), async (v) => { await wb.invoke('settings:set', 'privacy.adblock.youtubeFilters', v); V.reload(t); pop.close(); }),
        setting('privacy.adblock.youtubeFilters') ? 'Experimental: YouTube can get stuck loading' : 'Off: video ads are covered and skipped as they start')
      : null,
    h('div.si-links', null, h('button.link-btn', { type: 'button', onclick: () => { pop.close(); emit('command', 'openSettings', { section: 'privacy' }); } }, icon('sliders'), 'Filter lists and settings')));
  const pop = popover(body, { anchor, side: 'bottom', align: 'end' }, { className: 'ab-pop' });
}

export function init() {
  on('site-info', (anchor) => siteInfo(anchor));
  on('site-permissions', (anchor) => sitePermissions(anchor));
  on('adblock-popover', (anchor) => adblockPopover(anchor));
}
