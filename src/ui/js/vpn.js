// Bifrost browser UI — the VPN: its toolbar button (how it is, at a glance) and its popover (on or off, Cloudflare
// WARP or a WireGuard file of yours). The VPN itself is main/vpn.js; how it is comes as 'vpn-state'. On and off,
// which one and Cloudflare's terms are settings (vpn.*).
import { on, emit } from './state.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { popover } from './menus.js';
import { toast } from './prompts.js';
import * as T from './tabs.js';

const wb = window.wb;
const TERMS = 'https://www.cloudflare.com/application/terms/';
let st = null;
let pop = null;

const set = (path, value) => wb.invoke('settings:set', path, value).catch((e) => toast({ text: e.message, iconName: 'warn' }));
const where = (s) => (s.source === 'file' ? (s.file ? s.file.name : 'your WireGuard file') : 'Cloudflare WARP');

// off | on (connected) | connecting | error
function kind(s) {
  if (!s || !s.on || !s.available) return 'off';
  if (s.state === 'connected') return 'on';
  if (s.state === 'error') return 'error';
  return 'connecting';
}

function line(s) {
  if (!s.available) return 'Not in this build of Bifrost';
  if (!s.on) return 'Off: Bifrost goes straight to sites';
  switch (s.state) {
    case 'connected': return `On, through ${where(s)}`;
    case 'signing-up': return 'Signing up with Cloudflare…';
    case 'error': return 'Not connected';
    default: return s.note || `Connecting to ${where(s)}…`;
  }
}

const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB' : Math.round(n / 1e3) + ' KB');
function since(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `for ${m} min` : `for ${Math.floor(m / 60)} h ${m % 60} min`;
}

function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, role: 'switch', 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch', null, input, h('span.switch-track', null, h('span.switch-thumb')));
}

async function chooseFile() {
  try {
    const s = await wb.invoke('vpn:import');
    if (s) { st = s; render(); toast({ text: `${s.file ? s.file.name : 'Your file'} is the VPN’s now`, iconName: 'vpn', timeout: 2200 }); }
  } catch (e) {
    toast({ text: 'That isn’t a WireGuard file you can use: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), iconName: 'warn', timeout: 6000 });
  }
}

function turn(on) {
  const s = st;
  if (on && s.source === 'file' && !s.file) { chooseFile(); render(); return; }
  // (WARP: turning it on, with Cloudflare's terms shown right there, is agreeing to them)
  if (on && s.source === 'warp' && !s.warpTerms) set('vpn.warpTerms', true);
  set('vpn.on', on);
}

function body() {
  const s = st;
  const k = kind(s);
  const choice = (id, iconName, title, sub, extra) => {
    const sel = s.source === id;
    const b = h('button.vpn-choice' + (sel ? '.sel' : ''), { type: 'button', role: 'radio', 'aria-checked': String(sel), dataset: { source: id } },
      h('span.si-ico', null, icon(iconName)), h('span.vpn-choice-text', null, h('b', null, title), h('small', null, sub), extra || null));
    b.addEventListener('click', (e) => {
      if (e.target.closest('.link-btn')) return;
      if (id === 'file' && !s.file) { chooseFile(); return; }
      if (!sel) set('vpn.source', id);
    });
    return b;
  };
  const fileLink = h('button.link-btn.vpn-file', { type: 'button', onclick: (e) => { e.stopPropagation(); chooseFile(); } }, icon('folder'), s.file ? 'Another file…' : 'Choose a file…');
  return h('div.vpn', null,
    h('div.vpn-head', null,
      h('span.vpn-badge.' + k, null, icon(k === 'off' ? 'vpnOff' : 'vpn')),
      h('div', null, h('b', null, 'VPN'), h('small.vpn-line', null, line(s))),
      s.available ? toggle(s.on, turn, 'VPN') : null),
    s.on && s.state === 'error' ? h('div.vpn-err', null, s.error, s.note ? h('small', null, s.note) : null) : null,
    s.on && s.state === 'connected'
      ? h('div.vpn-stats', null, `Connected ${since(s.since)} · ${mb(s.rx)} in, ${mb(s.tx)} out`)
      : null,
    h('div.vpn-choices', { role: 'radiogroup', 'aria-label': 'Through' },
      choice('warp', 'globe', 'Cloudflare WARP', 'Free and fast, no account. Hides your browsing from your network; sites see Cloudflare, near where you are.'),
      choice('file', 'file', s.file ? s.file.name : 'Your WireGuard file', s.file ? `Through ${s.file.endpoint}` : 'From Proton VPN (free), Mullvad or another VPN.', fileLink)),
    s.source === 'warp' && !s.warpTerms
      ? h('p.vpn-terms', null, 'WARP is Cloudflare’s. Turning it on signs this computer up with Cloudflare, no account needed, and means you agree to ',
        h('a', { href: TERMS, onclick: (e) => { e.preventDefault(); pop && pop.close(); T.openUrl(TERMS, { where: 'newtab' }); } }, 'Cloudflare’s terms'), '.')
      : null,
    h('p.vpn-terms', null, 'Only Bifrost goes through it, not the rest of your computer.'),
    h('div.si-links', null, h('button.link-btn', { type: 'button', onclick: () => { pop && pop.close(); emit('command', 'openSettings', { section: 'privacy', anchor: 'vpn' }); } }, icon('sliders'), 'VPN settings')));
}

function render() {
  if (pop && st) pop.el.replaceChildren(body());
}

async function open(anchor) {
  st = await wb.invoke('vpn:status').catch(() => st);
  if (!st) return;
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
    b.title = st ? 'VPN: ' + line(st) : 'VPN';
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
  on('vpn-popover', (anchor) => open(anchor));
  // (buttons made later: a toolbar laid out again)
  on('toolbar-built', paint);
  wb.invoke('vpn:status').then((s) => { st = s; paint(); }).catch(() => {});
  // (how long it's been connected, while the popover's open)
  setInterval(() => { if (pop && st && st.state === 'connected') render(); }, 30000);
}
