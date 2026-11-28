// Bifrost browser UI — the VPN: its toolbar button (how it is, at a glance) and its popover: on or off, where
// sites see you, where you appear (Cloudflare WARP, near you, or one of your locations: WireGuard files, Proton
// VPN's free servers in ten countries among them), and whether this site goes through it. The VPN itself is
// main/vpn.js; how it is comes as 'vpn-state'. On and off, which location, Cloudflare's terms, sites that skip
// it: settings (vpn.*). A WireGuard file downloaded in Bifrost is offered as a location ('vpn-offer').
import { on, emit, activeTab, S } from './state.js';
import { h, hostOf } from './util.js';
import { icon } from './icons.js';
import { popover } from './menus.js';
import { toast } from './prompts.js';
import * as T from './tabs.js';
import * as V from './views.js';

const wb = window.wb;
const TERMS = 'https://www.cloudflare.com/application/terms/';
const PROTON = 'https://account.protonvpn.com/downloads#wireguard-configuration';
let st = null;
let pop = null;
let guide = false; // (the popover's Proton VPN steps, open)

const plain = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const set = (path, value) => wb.invoke('settings:set', path, value).catch((e) => toast({ text: plain(e), iconName: 'warn' }));

let regions = null;
export function countryName(code) {
  if (!code) return '';
  try { regions = regions || new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }); return regions.of(code) || code; } catch { return code; }
}

// What a location's called: its country, or its file's name when that's not known.
const placeOf = (f) => (f ? countryName(f.country) || f.name : '');
function where(s) {
  if (s.location === 'warp') return 'Cloudflare WARP';
  return s.file ? placeOf(s.file) : 'your WireGuard file';
}
// Whether this window goes through it (a VPN for private windows only: not this one, if it's not private).
const forHere = (s) => s.scope !== 'private' || S.isPrivate;

// off | on (connected) | connecting | error
function kind(s) {
  if (!s || !s.on || !s.available || !forHere(s)) return 'off';
  if (s.state === 'connected') return 'on';
  if (s.state === 'error') return 'error';
  return 'connecting';
}

function line(s) {
  if (!s.available) return 'Not in this build of Bifrost';
  if (!s.on) return 'Off · Bifrost goes straight to sites';
  if (!forHere(s)) return 'On in private windows only';
  switch (s.state) {
    case 'connected': return `On · ${where(s)}`;
    case 'signing-up': return 'Signing up with Cloudflare…';
    case 'error': return 'Not connected';
    default: return s.note || `Connecting to ${where(s)}…`;
  }
}

const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB' : Math.round(n / 1e3) + ' KB');
function since(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, role: 'switch', 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch', null, input, h('span.switch-track', null, h('span.switch-thumb')));
}

// A country's code in a little tile (flags don't show on Windows); WARP's is a pin: wherever you are.
export function ccTile(code, cls = '') {
  return code ? h('span.vpn-cc' + cls, { 'aria-hidden': 'true' }, code) : h('span.vpn-cc.pin' + cls, { 'aria-hidden': 'true' }, icon('location'));
}

// Files added: said, with what didn't go (and why); one added can be gone to straight away.
export function reportAdded(r, { offerUse = true } = {}) {
  if (!r) return;
  const names = r.added.map(placeOf);
  if (r.added.length) {
    const text = r.added.length === 1 ? `${names[0]} is one of your VPN’s locations` : `${r.added.length} locations added: ${names.join(', ')}`;
    const f = r.added[0];
    toast({ text, iconName: 'vpn', timeout: 5000, actions: offerUse && r.added.length === 1 && r.status.location !== f.id ? [{ label: 'Go there', action: () => go(f.id) }] : [] });
  }
  for (const e of r.errors.slice(0, 3)) toast({ text: `${e.name} isn’t a WireGuard file you can use: ${e.error}`, iconName: 'warn', timeout: 7000 });
}

export async function addFiles(opts) {
  try { reportAdded(await wb.invoke('vpn:import', opts)); } catch (e) { toast({ text: plain(e), iconName: 'warn', timeout: 6000 }); }
}

// To a location ('warp' or one of your files' id), turning it on if it's off (picking one is asking for it).
async function go(id) {
  const s = st || (await wb.invoke('vpn:status').catch(() => null));
  if (!s) return;
  if (id === 'warp') {
    // (WARP: Cloudflare's terms are right there in the popover: going there is agreeing to them)
    if (!s.warpTerms) await set('vpn.warpTerms', true);
    if (s.source !== 'warp') await set('vpn.source', 'warp');
  } else {
    if (s.location !== id) await set('vpn.file', id);
    if (s.source !== 'file') await set('vpn.source', 'file');
  }
  if (!s.on) await set('vpn.on', true);
}

function turn(on) {
  const s = st;
  if (on && s.source === 'file' && !s.files.length) { addFiles({ use: true }); render(); return; }
  // (WARP: turning it on, with Cloudflare's terms shown right there, is agreeing to them)
  if (on && s.source === 'warp' && !s.warpTerms) set('vpn.warpTerms', true);
  set('vpn.on', on);
}

// One place you can appear: WARP (near you) or one of your files.
function locRow(s, id) {
  const f = id === 'warp' ? null : s.files.find((x) => x.id === id);
  const sel = s.location === id;
  const live = sel && s.on && s.state === 'connected';
  let title, sub, meta = null, cc;
  if (!f) {
    cc = ccTile('');
    title = 'Near you';
    const near = s.warpSeen && s.warpSeen.loc ? countryName(s.warpSeen.loc) + ' · ' : '';
    sub = `${near}Cloudflare WARP, free`;
  } else {
    cc = ccTile(f.country, f.guessed ? '.guess' : '');
    title = placeOf(f);
    sub = f.server && f.server !== title ? f.server : f.country ? f.name : f.endpoint;
    if (f.probing) meta = h('span.vpn-meta', null, 'Checking…');
    else if (f.problem) { meta = h('span.vpn-meta.bad', { title: f.problem }, icon('warn')); sub = 'Didn’t answer when it was tried'; }
    else if (f.ms) meta = h('span.vpn-meta', { title: 'How long its handshake took when it was tried' }, `${f.ms} ms`);
  }
  const b = h('button.vpn-loc' + (sel ? '.sel' : '') + (live ? '.live' : ''), { type: 'button', role: 'radio', 'aria-checked': String(sel), dataset: { loc: id } },
    cc, h('span.vpn-loc-text', null, h('b', null, title), h('small', null, sub)), meta,
    sel ? h('span.vpn-loc-check', { 'aria-hidden': 'true' }, icon('check')) : null);
  b.addEventListener('click', () => { if (!sel || !s.on) go(id); });
  return b;
}

function protonGuide() {
  return h('div.vpn-guide', null,
    h('p', null, 'Proton VPN’s free plan has servers in 10 countries, and its WireGuard files let you pick which one: Bifrost keeps each as a location.'),
    h('ol', null,
      h('li', null, 'Make a free Proton VPN account and sign in.'),
      h('li', null, 'Go to Downloads, then WireGuard configuration.'),
      h('li', null, 'Pick a free server for each country you want (JP-FREE, NL-FREE, US-FREE…): Create, then Download.'),
      h('li', null, 'Bifrost offers to add each file as it downloads. Files you already have: Add locations.')),
    h('button.btn.small.primary', { type: 'button', onclick: () => { pop && pop.close(); T.openUrl(PROTON, { where: 'newtab' }); } }, icon('external'), 'Open Proton VPN’s downloads'));
}

function body() {
  const s = st;
  const k = kind(s);
  const t = activeTab();
  const url = t ? t.url : '';
  const host = /^https?:/i.test(url) ? hostOf(url).replace(/^www\./, '') : '';
  const skipped = host && s.bypass.some((b) => host === b || host.endsWith('.' + b));
  const connected = s.on && s.state === 'connected' && forHere(s);
  const seen = connected ? s.seen : null;
  const live = s.file && s.location !== 'warp' ? s.file : null;
  return h('div.vpn', null,
    h('div.vpn-head', null,
      h('span.vpn-badge.' + k, null, icon(k === 'off' ? 'vpnOff' : 'vpn')),
      h('div', null, h('b', null, 'VPN'), h('small.vpn-line', null, line(s))),
      s.available ? toggle(s.on, turn, 'VPN') : null),
    s.on && s.state === 'error' && forHere(s) ? h('div.vpn-err', null, s.error, s.note ? h('small', null, s.note) : null) : null,
    // Where sites see you: the address they get, and its country, as Cloudflare saw it through the tunnel.
    connected
      ? h('div.vpn-where', null,
        ccTile(seen ? seen.loc : live ? live.country : '', '.big'),
        h('div', null,
          h('b', null, seen ? `Sites see you in ${countryName(seen.loc)}` : 'Finding out where sites see you…'),
          h('small', null, [seen && seen.ip, `connected ${since(s.since)}`, `${mb(s.rx)} in`].filter(Boolean).join(' · '))))
      : null,
    h('div.vpn-sec', null, h('span', null, 'Where you appear'),
      h('button.link-btn', { type: 'button', onclick: () => addFiles({ use: !s.files.length && s.source === 'file' }) }, icon('plus'), 'Add locations…')),
    h('div.vpn-locs', { role: 'radiogroup', 'aria-label': 'Where you appear' },
      locRow(s, 'warp'),
      ...s.files.map((f) => locRow(s, f.id))),
    s.files.length && !guide
      ? h('button.link-btn.vpn-more', { type: 'button', onclick: () => { guide = true; render(); } }, icon('globe'), 'More countries, free, from Proton VPN')
      : protonGuide(),
    !s.warpTerms
      ? h('p.vpn-terms', null, 'WARP is Cloudflare’s. Going there signs this computer up with Cloudflare, no account needed, and means you agree to ',
        h('a', { href: TERMS, onclick: (e) => { e.preventDefault(); pop && pop.close(); T.openUrl(TERMS, { where: 'newtab' }); } }, 'Cloudflare’s terms'), '. It hides what you browse from your network, not your country.')
      : null,
    // This site: through the VPN, or straight (a bank or a school's site that turns VPNs away).
    s.on && host && forHere(s)
      ? h('div.vpn-site', null,
        h('div', null, h('b', null, host), h('small', null, skipped ? 'Skips the VPN: goes straight to the site' : 'Goes through the VPN')),
        toggle(!skipped, async (v) => {
          try { st = await wb.invoke('vpn:skip-site', host, !v); render(); if (t) V.reload(t); } catch (e) { toast({ text: plain(e), iconName: 'warn' }); }
        }, `Use the VPN on ${host}`))
      : null,
    h('div.vpn-foot', null,
      h('small', null, s.scope === 'private' ? 'Only private windows go through it.' : 'Only Bifrost goes through it, not your other apps.'),
      h('button.link-btn', { type: 'button', onclick: () => { pop && pop.close(); emit('command', 'openSettings', { section: 'privacy', anchor: 'vpn' }); } }, icon('sliders'), 'Settings')));
}

function render() {
  if (pop && st) pop.el.replaceChildren(body());
}

async function open(anchor) {
  st = await wb.invoke('vpn:status').catch(() => st);
  if (!st) return;
  guide = false;
  pop = popover(body(), { anchor, side: 'bottom', align: 'end' }, { className: 'vpn-pop', onClose: () => { pop = null; } });
}

// The toolbar's (and the sidebar's) VPN buttons.
function paint() {
  const k = kind(st);
  for (const b of document.querySelectorAll('[data-tb="vpn"]')) {
    if (b.dataset.vpn !== k) {
      b.dataset.vpn = k;
      b.firstChild.replaceWith(icon(k === 'off' ? 'vpnOff' : 'vpn'));
    }
    const seen = st && k === 'on' && st.seen ? ` · sites see you in ${countryName(st.seen.loc)}` : '';
    b.title = st ? 'VPN: ' + line(st) + seen : 'VPN';
    b.setAttribute('aria-label', b.title);
  }
}

export function state() { return st; }

export function init() {
  wb.on('vpn-state', (s) => {
    const was = kind(st);
    st = s;
    paint();
    render();
    // (it dropped, or came back, while you weren't looking at it)
    const now = kind(st);
    if (was === 'on' && now === 'error') toast({ text: 'The VPN isn’t connected. Pages wait for it: nothing goes around it.', iconName: 'warn', timeout: 5000 });
  });
  // A WireGuard file just downloaded (from Proton VPN's downloads page, say): one of your locations?
  wb.on('vpn-offer', (o) => {
    const name = countryName(o.country) || o.server || o.name;
    const add = (use) => wb.invoke('vpn:add-downloaded', o.path, use).then((r) => reportAdded(r, { offerUse: false })).catch((e) => toast({ text: plain(e), iconName: 'warn' }));
    toast({ text: `${o.name}.conf is a WireGuard file${o.server ? ' for ' + o.server : ''}. Add ${name} to the VPN’s locations?`, iconName: 'vpn', timeout: 20000,
      actions: [{ label: 'Add', action: () => add(false) }, { label: 'Add and go there', action: () => add(true) }] });
  });
  on('vpn-popover', (anchor) => open(anchor));
  // (buttons made later: a toolbar laid out again)
  on('toolbar-built', paint);
  // (the active tab changed: its site's row)
  on('active', () => render());
  wb.invoke('vpn:status').then((s) => { st = s; paint(); }).catch(() => {});
  // (how long it's been connected, while the popover's open)
  setInterval(() => { if (pop && st && st.state === 'connected') render(); }, 30000);
}
