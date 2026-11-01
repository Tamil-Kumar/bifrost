// Bifrost — Downloads: live progress, and everything downloaded before.
import { boot, wb, h, icon, fmtBytes, fmtDuration, timeAgo, debounce, showMenu, confirmDialog, toast, hostOf } from '/_/common/page.js';

const recs = new Map();
let list, search;

function act(id, action) { return wb.invoke('downloads:action', id, action).catch((e) => toast({ text: e.message, iconName: 'warn' })); }

function fileIcon(name) {
  const n = (name || '').toLowerCase();
  if (/\.(zip|7z|rar|tar|gz|xz|bz2)$/.test(n)) return 'layers';
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(n)) return 'camera';
  if (/\.(mp4|mkv|webm|mov|avi)$/.test(n)) return 'video';
  if (/\.(mp3|flac|wav|ogg|m4a)$/.test(n)) return 'volume';
  if (/\.(exe|msi|appimage|deb|rpm|dmg|pkg)$/.test(n)) return 'cpu';
  return 'file';
}

function status(r) {
  if (r.state === 'progressing') {
    const parts = [fmtBytes(r.received) + (r.total ? ' of ' + fmtBytes(r.total) : '')];
    if (r.paused) parts.unshift('Paused');
    else {
      if (r.speed > 0) parts.push(fmtBytes(r.speed) + '/s');
      if (r.speed > 0 && r.total > r.received) parts.push(fmtDuration((r.total - r.received) / r.speed) + ' left');
    }
    return parts.join(' · ');
  }
  if (r.state === 'completed') return [fmtBytes(r.total || r.received), r.exists === false ? 'File deleted' : null, timeAgo(r.ended || r.started)].filter(Boolean).join(' · ');
  if (r.state === 'cancelled') return 'Cancelled · ' + timeAgo(r.started);
  return 'Failed · ' + timeAgo(r.started);
}

function card(r) {
  const active = r.state === 'progressing';
  const pct = r.total ? Math.min(100, (r.received / r.total) * 100) : 0;
  const gone = r.state === 'completed' && r.exists === false;
  const el = h('div.dl' + (active ? '.active' : '') + (r.state === 'completed' ? '.done' : '') + (r.state === 'interrupted' || r.state === 'cancelled' ? '.failed' : '') + (gone ? '.gone' : ''), { dataset: { id: String(r.id) } },
    h('span.dl-ico', null, icon(fileIcon(r.filename))),
    h('div.dl-main', null,
      h('div.dl-name', { title: r.path || r.filename }, r.filename || 'download'),
      h('div.dl-url', { title: r.url }, hostOf(r.url) || r.url),
      active ? h('div.dl-bar' + (r.total ? '' : '.indeterminate'), null, h('span', { style: { width: pct + '%' } })) : null,
      h('div.dl-status', null, status(r))),
    h('div.dl-actions', null,
      active ? h('button.btn.small', { type: 'button', onclick: () => act(r.id, r.paused ? 'resume' : 'pause') }, icon(r.paused ? 'play' : 'pause'), r.paused ? 'Resume' : 'Pause') : null,
      active ? h('button.btn.small', { type: 'button', onclick: () => act(r.id, 'cancel') }, 'Cancel') : null,
      r.state === 'completed' && !gone ? h('button.btn.small', { type: 'button', onclick: () => act(r.id, 'open') }, 'Open') : null,
      r.state === 'completed' && !gone ? h('button.btn.small', { type: 'button', onclick: () => act(r.id, 'show') }, icon('folderOpen'), 'Show in folder') : null,
      r.state === 'interrupted' || r.state === 'cancelled' || gone ? h('button.btn.small', { type: 'button', onclick: () => act(r.id, 'retry') }, icon('reload'), 'Retry') : null,
      !active ? h('button.icon-btn', { type: 'button', title: 'Remove from list', onclick: async () => { await act(r.id, 'remove'); recs.delete(r.id); render(); } }, icon('close')) : null));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu([
      { label: 'Copy download link', icon: 'link', action: () => navigator.clipboard.writeText(r.url) },
      r.state === 'completed' && !gone ? { label: 'Show in folder', icon: 'folderOpen', action: () => act(r.id, 'show') } : null,
      '-',
      !active ? { label: 'Remove from list', icon: 'close', action: async () => { await act(r.id, 'remove'); recs.delete(r.id); render(); } } : null,
      r.state === 'completed' && !gone ? { label: 'Delete the file', icon: 'trash', danger: true, action: async () => {
        if (!(await confirmDialog(`Delete “${r.filename}” from your computer?`, { ok: 'Delete', danger: true }))) return;
        await act(r.id, 'delete'); recs.delete(r.id); render();
      } } : null,
    ], { x: e.clientX, y: e.clientY });
  });
  return el;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const all = [...recs.values()].filter((r) => !q || (r.filename || '').toLowerCase().includes(q) || (r.url || '').toLowerCase().includes(q)).sort((a, b) => b.started - a.started);
  if (!all.length) { list.replaceChildren(h('div.empty-state', null, icon('download'), h('div', null, q ? 'No downloads match.' : 'Files you download show up here.'))); return; }
  list.replaceChildren(...all.map(card));
}

// Live updates patch just the changed card.
const patch = (r) => {
  recs.set(r.id, Object.assign(recs.get(r.id) || {}, r));
  const el = list.querySelector(`.dl[data-id="${r.id}"]`);
  if (el) el.replaceWith(card(recs.get(r.id))); else render();
};

async function load() {
  const all = await wb.invoke('downloads:list').catch(() => []);
  recs.clear();
  for (const r of all) recs.set(r.id, r);
  render();
}

await boot({ title: 'Downloads' });
search = h('input.field', { type: 'search', placeholder: 'Search downloads', spellcheck: 'false' });
list = h('div.dls');
document.body.append(h('div.pg', null,
  h('header.pg-head', null,
    h('h1.pg-title', null, h('span.pg-ico', null, icon('download')), 'Downloads'),
    h('div.pg-spacer'),
    h('label.pg-search', null, icon('search'), search),
    h('button.btn', { type: 'button', onclick: () => act(0, 'show') }, icon('folderOpen'), 'Open folder'),
    h('button.btn', { type: 'button', onclick: async () => { await wb.invoke('downloads:clear'); load(); } }, 'Clear list')),
  list));
search.addEventListener('input', debounce(render, 100));
await load();
wb.on('download-updated', patch);
setInterval(() => { if (![...recs.values()].some((r) => r.state === 'progressing')) render(); }, 60000);
