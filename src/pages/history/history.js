// Bifrost — History: every visit, grouped by day, searchable, with bulk delete.
import { boot, wb, h, icon, faviconEl, displayUrl, hostOf, debounce, showMenu, confirmDialog, toast, openUrl, command, timeAgo } from '/_/common/page.js';

const PAGE = 150;
let rows = [];          // loaded visits
let before = null;      // paging cursor
let loading = false;
let done = false;
const selected = new Set();
let list, search, bulk, countEl, remote;
let devices = new Map();   // sync: computer id → name (visits from your other computers say where they were)

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  return diff === 0 ? 'Today · ' + date : diff === 1 ? 'Yesterday · ' + date : date;
}

function build() {
  search = h('input.field', { type: 'search', placeholder: 'Search history', spellcheck: 'false', autofocus: true });
  countEl = h('span.chip.accent');
  bulk = h('div.bulk', { hidden: true }, countEl,
    h('button.btn.small', { type: 'button', onclick: () => { selected.clear(); render(); } }, 'Cancel'),
    h('button.btn.small.danger', { type: 'button', onclick: removeSelected }, icon('trash'), 'Remove'));
  list = h('div.hist');
  remote = h('div.hist.remote', { hidden: true });
  document.body.append(h('div.pg', null,
    h('header.pg-head', null,
      h('h1.pg-title', null, h('span.pg-ico', null, icon('clock')), 'History'),
      h('div.pg-spacer'),
      bulk,
      h('label.pg-search', null, icon('search'), search),
      h('button.btn', { type: 'button', onclick: () => command('openSettings', { section: 'clear' }) }, icon('trash'), 'Clear browsing data…')),
    remote,
    list));
  search.addEventListener('input', debounce(() => { reload(); drawRemote(); }, 150));
  window.addEventListener('scroll', () => { if (window.innerHeight + window.scrollY > document.body.scrollHeight - 600) more(); }, { passive: true });
}

async function reload() {
  rows = []; before = null; done = false; selected.clear();
  await more(true);
}

async function more(reset = false) {
  if (loading || (done && !reset)) return;
  loading = true;
  const got = await wb.invoke('history:visits', { text: search.value.trim(), before: before || Date.now() + 1, limit: PAGE }).catch(() => []);
  loading = false;
  rows = reset ? got : rows.concat(got);
  if (got.length) before = got[got.length - 1].time;
  done = got.length < PAGE;
  render();
}

function render() {
  bulk.hidden = !selected.size;
  countEl.textContent = selected.size + ' selected';
  if (!rows.length) {
    list.replaceChildren(h('div.empty-state', null, icon('clock'), h('div', null, search.value ? 'Nothing in your history matches.' : 'Pages you visit show up here.')));
    return;
  }
  const out = [];
  let day = '';
  for (const v of rows) {
    const d = dayLabel(v.time);
    if (d !== day) { day = d; out.push(h('div.card-title.day', null, d)); }
    out.push(item(v));
  }
  if (!done) out.push(h('div.more', null, h('button.btn.small', { type: 'button', onclick: () => more() }, 'Load more')));
  list.replaceChildren(...out);
}

function item(v) {
  const cb = h('input.hcheck', { type: 'checkbox', checked: selected.has(v.id), title: 'Select' });
  cb.addEventListener('change', () => { if (cb.checked) selected.add(v.id); else selected.delete(v.id); bulk.hidden = !selected.size; countEl.textContent = selected.size + ' selected'; row.classList.toggle('sel', cb.checked); });
  const time = new Date(v.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const link = h('a.li-main', { href: v.url, title: v.url }, h('span.li-title', null, v.title || displayUrl(v.url)), h('span.li-sub', null, hostOf(v.url).replace(/^www\./, '') || displayUrl(v.url)));
  const from = v.source ? h('span.chip.from', { title: 'Visited on ' + (devices.get(v.source) || 'another computer') }, icon('laptop'), devices.get(v.source) || 'Another computer') : null;
  const row = h('div.li' + (selected.has(v.id) ? '.sel' : ''), null, cb, h('span.li-meta.time', null, time), faviconEl(v.url, v.favicon, icon, 'fav', { hi: true }), link, from,
    h('div.li-actions', null,
      h('button.icon-btn', { type: 'button', title: 'More from this site', onclick: () => { search.value = hostOf(v.url).replace(/^www\./, ''); reload(); } }, icon('search')),
      h('button.icon-btn', { type: 'button', title: 'Remove from history', onclick: async () => { await wb.invoke('history:delete-visit', v.id); rows = rows.filter((r) => r !== v); row.remove(); } }, icon('close'))));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu([
      { label: 'Open in new tab', icon: 'plus', action: () => openUrl(v.url, { background: true }) },
      { label: 'Open in new window', icon: 'window', action: () => openUrl(v.url, { newWindow: true }) },
      { label: 'Copy link', icon: 'link', action: () => navigator.clipboard.writeText(v.url) },
      '-',
      { label: 'More from this site', icon: 'search', action: () => { search.value = hostOf(v.url).replace(/^www\./, ''); reload(); } },
      { label: 'Remove this visit', icon: 'close', action: async () => { await wb.invoke('history:delete-visit', v.id); reload(); } },
      { label: 'Remove every visit to this page', icon: 'trash', danger: true, action: async () => { await wb.invoke('history:delete-url', v.url); reload(); } },
    ], { x: e.clientX, y: e.clientY });
  });
  return row;
}

async function removeSelected() {
  const ids = [...selected];
  if (ids.length > 20 && !(await confirmDialog(`Remove ${ids.length} visits from history?`, { ok: 'Remove', danger: true }))) return;
  for (const id of ids) await wb.invoke('history:delete-visit', id).catch(() => {});
  toast({ text: `Removed ${ids.length} visit${ids.length === 1 ? '' : 's'}`, iconName: 'trash' });
  reload();
}

// Tabs open on your other computers (sync), above your history.
let remoteTabs = [];
const collapsed = new Set();
function drawRemote() {
  const show = remoteTabs.length && !search.value.trim();
  remote.hidden = !show;
  if (!show) return;
  remote.replaceChildren(h('div.card-title.day', null, 'Tabs on your other computers'), ...remoteTabs.map((d) => {
    const tabs = d.windows.flatMap((w) => w.tabs);
    const open = !collapsed.has(d.id);
    const head = h('div.rd-head', null,
      h('button.rd-toggle', { type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) collapsed.add(d.id); else collapsed.delete(d.id); drawRemote(); } },
        icon(open ? 'chevronDown' : 'chevronRight'), icon('laptop'), h('b', null, d.name), h('span.li-sub', null, `${tabs.length} tab${tabs.length === 1 ? '' : 's'} · ${timeAgo(d.updated)}`)),
      tabs.length > 1 ? h('button.rd-all', { type: 'button', title: 'Open all of them in new tabs', onclick: () => { for (const t of tabs) openUrl(t.url, { background: true }); } }, 'Open all') : null);
    const rows = open ? tabs.map((t) => {
      const link = h('a.li-main', { href: t.url, title: t.url }, h('span.li-title', null, t.title || displayUrl(t.url)), h('span.li-sub', null, (hostOf(t.url).replace(/^www\./, '') || displayUrl(t.url)) + (t.space ? ' · ' + t.space : '')));
      const row = h('div.li.rd-tab', null, faviconEl(t.url, t.icon, icon, 'fav', { hi: true }), link);
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          { label: 'Open in new tab', icon: 'plus', action: () => openUrl(t.url, { background: true }) },
          { label: 'Open in new window', icon: 'window', action: () => openUrl(t.url, { newWindow: true }) },
          { label: 'Copy link', icon: 'link', action: () => navigator.clipboard.writeText(t.url) },
        ], { x: e.clientX, y: e.clientY });
      });
      return row;
    }) : [];
    return h('div.rd', { dataset: { device: d.id } }, head, ...rows);
  }));
}
async function loadRemote() {
  const [info, tabs] = await Promise.all([wb.invoke('sync:info').catch(() => null), wb.invoke('sync:tabs').catch(() => [])]);
  devices = new Map(((info && info.devices) || []).map((d) => [d.id, d.name]));
  remoteTabs = tabs || [];
  drawRemote();
}

await boot({ title: 'History' });
build();
await loadRemote();
await reload();
wb.on('history-changed', debounce(() => { if (!selected.size) reload(); }, 400));
wb.on('sync-changed', debounce(async () => { await loadRemote(); if (!selected.size) render(); }, 300));
search.focus();
