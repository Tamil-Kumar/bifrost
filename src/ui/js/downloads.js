// Bifrost browser UI — the downloads button (with a progress ring) and its popover.
import { S, on, emit, setting } from './state.js';
import { h, fmtBytes, fmtDuration, timeAgo } from './util.js';
import { icon } from './icons.js';
import { popover } from './menus.js';
import * as TB from './toolbar.js';

const wb = window.wb;
const recs = new Map();
let pop = null, listEl = null, autoTimer = null;
let autoAgain = null;   // the box opened by itself: starts its time over
const NS = 'http://www.w3.org/2000/svg';

function fileIcon(name, mime) {
  const n = (name || '').toLowerCase();
  if (/\.(zip|7z|rar|tar|gz|xz|bz2)$/.test(n)) return 'layers';
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(n) || /^image\//.test(mime || '')) return 'camera';
  if (/\.(mp4|mkv|webm|mov|avi)$/.test(n) || /^video\//.test(mime || '')) return 'video';
  if (/\.(mp3|flac|wav|ogg|m4a)$/.test(n) || /^audio\//.test(mime || '')) return 'volume';
  if (/\.(exe|msi|appimage|deb|rpm|dmg|pkg)$/.test(n)) return 'cpu';
  if (/\.(pdf|docx?|odt|txt|md|rtf)$/.test(n)) return 'file';
  return 'file';
}

function statusText(r) {
  if (r.state === 'progressing') {
    if (r.paused) return `Paused · ${fmtBytes(r.received)}${r.total ? ' of ' + fmtBytes(r.total) : ''}`;
    const parts = [fmtBytes(r.received) + (r.total ? ' of ' + fmtBytes(r.total) : '')];
    if (r.speed > 0) parts.push(fmtBytes(r.speed) + '/s');
    if (r.speed > 0 && r.total > r.received) parts.push(fmtDuration((r.total - r.received) / r.speed) + ' left');
    return parts.join(' · ');
  }
  if (r.state === 'completed') return (r.exists === false ? 'Deleted · ' : '') + fmtBytes(r.total || r.received) + ' · ' + timeAgo(r.ended || r.started);
  if (r.state === 'cancelled') return 'Cancelled';
  return 'Failed' + (r.received ? ' · ' + fmtBytes(r.received) : '');
}

function act(id, action) { return wb.invoke('downloads:action', id, action).catch((e) => emit('toast', { text: e.message, iconName: 'warn' })); }

function item(r) {
  const active = r.state === 'progressing';
  const pct = r.total ? Math.min(100, (r.received / r.total) * 100) : 0;
  const el = h('div.dl-item' + (active ? '.active' : '') + (r.state === 'completed' ? '.done' : '') + (r.state === 'interrupted' || r.state === 'cancelled' ? '.failed' : ''),
    { title: r.path || r.url },
    h('span.dl-ico', null, icon(fileIcon(r.filename, r.mime))),
    h('div.dl-main', null,
      h('div.dl-name', null, r.filename || 'download'),
      h('div.dl-status', null, statusText(r)),
      active ? h('div.dl-bar' + (r.total ? '' : '.indeterminate'), null, h('span', { style: { width: pct + '%' } })) : null),
    h('div.dl-actions', null,
      active ? h('button.icon-btn', { type: 'button', title: r.paused ? 'Resume' : 'Pause', onclick: (e) => { e.stopPropagation(); act(r.id, r.paused ? 'resume' : 'pause'); } }, icon(r.paused ? 'play' : 'pause')) : null,
      active ? h('button.icon-btn', { type: 'button', title: 'Cancel', onclick: (e) => { e.stopPropagation(); act(r.id, 'cancel'); } }, icon('close')) : null,
      r.state === 'interrupted' ? h('button.icon-btn', { type: 'button', title: 'Retry', onclick: (e) => { e.stopPropagation(); act(r.id, 'retry'); } }, icon('reload')) : null,
      r.state === 'completed' ? h('button.icon-btn', { type: 'button', title: 'Show in folder', onclick: (e) => { e.stopPropagation(); act(r.id, 'show'); } }, icon('folderOpen')) : null));
  if (r.state === 'completed') el.addEventListener('click', () => { act(r.id, 'open'); if (pop) pop.close(); });
  return el;
}

function renderList() {
  if (!listEl) return;
  const list = [...recs.values()].sort((a, b) => b.started - a.started).slice(0, 8);
  listEl.replaceChildren(...(list.length ? list.map(item) : [h('p.dl-empty', null, 'No downloads yet')]));
}

function openPopover(anchor, { auto = false } = {}) {
  if (pop) {
    if (!auto) pop.close();
    // (another download starting while it's open by itself: it stays as long again)
    else if (autoAgain) autoAgain();
    return;
  }
  if (!anchor || !anchor.offsetParent) return;
  listEl = h('div.dl-list');
  renderList();
  const body = h('div.dl-pop', null,
    h('div.dl-head', null, h('b', null, 'Downloads'),
      h('button.icon-btn', { type: 'button', title: 'Open the downloads folder', onclick: () => act(0, 'show') }, icon('folderOpen'))),
    listEl,
    h('button.dl-all', { type: 'button', onclick: () => { pop.close(); emit('command', 'openDownloads'); } }, 'Show all downloads', icon('chevronRight')));
  pop = popover(body, { anchor, side: 'bottom', align: 'end' }, { className: 'dl-popover', modal: !auto, focus: !auto, exclusive: !auto, onClose: () => { pop = null; listEl = null; autoAgain = null; clearTimeout(autoTimer); } });
  if (auto) {
    // As long as Settings → Downloads says (the pointer over it holds it open), or until you close it.
    const start = () => {
      clearTimeout(autoTimer);
      const secs = Number(setting('downloads.showOnStartFor'));
      if (secs > 0 && secs <= 60) autoTimer = setTimeout(() => pop && pop.close(), secs * 1000);
    };
    const el = pop.el;
    el.addEventListener('mouseenter', () => clearTimeout(autoTimer));
    el.addEventListener('mouseleave', start);
    autoAgain = () => { if (!el.matches(':hover')) start(); };
    start();
  }
}

// The downloads button(s): on the toolbar it shows once there's something to show (in the sidebar
// it's always there), with a ring for overall progress.
function updateButton() {
  const all = [...recs.values()];
  const active = all.filter((r) => r.state === 'progressing');
  const recent = all.some((r) => r.state === 'progressing' || (Date.now() - (r.ended || r.started)) < 86400000);
  const total = active.reduce((s, r) => s + (r.total || 0), 0);
  const got = active.reduce((s, r) => s + (r.received || 0), 0);
  const frac = total ? got / total : 0.25;
  for (const b of document.querySelectorAll('[data-tb="downloads"]')) {
    b.hidden = !recent && !!b.closest('#toolbar');
    b.classList.toggle('busy', active.length > 0);
    let ring = b.querySelector('svg.tb-ring');
    if (active.length) {
      if (!ring) {
        ring = document.createElementNS(NS, 'svg');
        ring.setAttribute('class', 'tb-ring');
        ring.setAttribute('viewBox', '0 0 36 36');
        const track = document.createElementNS(NS, 'circle');
        track.setAttribute('class', 'track');
        const bar = document.createElementNS(NS, 'circle');
        bar.setAttribute('class', 'bar');
        for (const c of [track, bar]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15'); }
        ring.append(track, bar);
        b.append(ring);
      }
      const bar = ring.querySelector('.bar');
      const len = 2 * Math.PI * 15;
      bar.style.strokeDasharray = `${len}`;
      bar.style.strokeDashoffset = `${len * (1 - frac)}`;
      ring.classList.toggle('indeterminate', !total);
      b.title = `${active.length} download${active.length === 1 ? '' : 's'} in progress`;
    } else {
      if (ring) ring.remove();
      b.title = 'Downloads';
    }
  }
}

export function init() {
  wb.invoke('downloads:list').then((list) => {
    for (const r of list || []) if (!r.private || S.isPrivate) recs.set(r.id, r);
    updateButton();
  }).catch(() => {});
  wb.on('download-updated', (r) => {
    recs.set(r.id, Object.assign(recs.get(r.id) || {}, r));
    updateButton();
    renderList();
  });
  wb.on('download-started', (r) => {
    recs.set(r.id, Object.assign(recs.get(r.id) || {}, r));
    updateButton();
    TB.bump('downloads');
    requestAnimationFrame(() => openPopover(TB.button('downloads'), { auto: true }));
  });
  on('downloads-popover', (anchor) => openPopover(anchor));
  on('toolbar-built', () => updateButton());
  setInterval(() => { if (listEl) renderList(); }, 30000);
}
