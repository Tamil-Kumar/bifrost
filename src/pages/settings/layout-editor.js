// Bifrost — Settings: the toolbar & sidebar editor. Three rows (the toolbar, the sidebar's top row
// and its bottom row) hold the items from WBDefaults.LAYOUT_ITEMS; drag items between rows, from
// the "More items" tray, or back to the tray to remove them. Clicking an item opens a menu that does
// the same without dragging.
import { h, icon, get, set, showMenu, toast, confirmDialog } from '/_/common/page.js';

const D = window.WBDefaults;
export const ZONES = [
  { key: 'toolbar', path: 'appearance.toolbar', label: 'Toolbar', area: 'toolbar' },
  { key: 'top', path: 'appearance.sidebarTop', label: 'Sidebar, top', area: 'sidebar' },
  { key: 'bottom', path: 'appearance.sidebarBottom', label: 'Sidebar, bottom', area: 'sidebar' },
];
const zoneOf = (key) => ZONES.find((z) => z.key === key);
const allowed = (meta, zone) => !meta.only || meta.only === zone.area;
const list = (zone) => (get(zone.path) || []).filter((id) => D.layoutItem(id));
const placed = () => new Set(ZONES.flatMap((z) => list(z)));

function save(path, value) {
  return set(path, value).catch((e) => toast({ text: e.message, iconName: 'warn' }));
}

// Moves an item (from a zone position, or new from the tray) to a zone position.
export async function move(from, to) {
  const meta = D.layoutItem(from.id);
  const target = zoneOf(to.zone);
  if (!meta || !target) return;
  if (!allowed(meta, target)) {
    toast({ text: `${meta.label} can only go on the ${meta.only === 'toolbar' ? 'toolbar' : 'sidebar'}`, iconName: 'info' });
    return;
  }
  const lists = Object.fromEntries(ZONES.map((z) => [z.key, list(z)]));
  let index = to.index == null ? lists[to.zone].length : to.index;
  if (from.zone) {
    const src = lists[from.zone];
    if (src[from.index] !== from.id) return;
    src.splice(from.index, 1);
    if (from.zone === to.zone && from.index < index) index--;
  } else if (!meta.multi && placed().has(from.id)) {
    return;
  }
  lists[to.zone].splice(Math.max(0, Math.min(index, lists[to.zone].length)), 0, from.id);
  for (const z of ZONES) {
    const before = JSON.stringify(list(z));
    if (JSON.stringify(lists[z.key]) !== before) await save(z.path, lists[z.key]);
  }
}

export async function remove(from) {
  const meta = D.layoutItem(from.id);
  if (!meta) return;
  if (meta.required) {
    toast({ text: meta.id === 'address' ? 'The address bar always stays on the toolbar' : 'The menu has to stay somewhere: move it instead', iconName: 'info' });
    return;
  }
  const z = zoneOf(from.zone);
  const cur = list(z);
  if (cur[from.index] !== from.id) return;
  cur.splice(from.index, 1);
  await save(z.path, cur);
}

export async function reset() {
  for (const z of ZONES) await save(z.path, D.getPath(D.DEFAULTS, z.path));
}

export function layoutEditor() {
  const box = h('div.lz-editor');
  let drag = null;            // { id, zone, index } while dragging
  let marker = null;

  const clearMarker = () => { if (marker) marker.remove(); marker = null; for (const z of box.querySelectorAll('.lz-zone.hot, .lz-tray.hot')) z.classList.remove('hot'); };

  const chip = (id, where) => {
    const meta = D.layoutItem(id);
    const el = h('div.lz-item' + (meta.required ? '.required' : '') + (id === 'address' ? '.wide' : '') + (id === 'spacer' ? '.spacer' : '') + (where.zone ? '' : '.tray'), {
      draggable: 'true', tabindex: '0', role: 'button',
      title: where.zone ? 'Drag to move · click for options' : 'Drag onto a row · click to add',
      dataset: { id, zone: where.zone || '', index: where.index == null ? '' : String(where.index) },
    }, icon(meta.icon), h('span', null, meta.label));
    if (where.zone && !meta.required) {
      el.append(h('button.lz-x', { type: 'button', title: 'Remove', onclick: (e) => { e.stopPropagation(); remove({ id, ...where }); } }, icon('close')));
    }
    el.addEventListener('click', () => (where.zone ? itemMenu(el, id, where) : trayMenu(el, id)));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } if ((e.key === 'Delete' || e.key === 'Backspace') && where.zone) remove({ id, ...where }); });
    el.addEventListener('dragstart', (e) => {
      drag = { id, ...where };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); drag = null; clearMarker(); });
    return el;
  };

  const itemMenu = (el, id, where) => {
    const meta = D.layoutItem(id);
    const cur = list(zoneOf(where.zone));
    showMenu([
      { type: 'header', label: meta.label },
      where.index > 0 ? { label: 'Move left', icon: 'chevronLeft', action: () => move({ id, ...where }, { zone: where.zone, index: where.index - 1 }) } : null,
      where.index < cur.length - 1 ? { label: 'Move right', icon: 'chevronRight', action: () => move({ id, ...where }, { zone: where.zone, index: where.index + 2 }) } : null,
      ...ZONES.filter((z) => z.key !== where.zone && allowed(meta, z)).map((z) => ({ label: 'Move to ' + z.label.toLowerCase(), icon: z.area === 'toolbar' ? 'layout' : 'sidebar', action: () => move({ id, ...where }, { zone: z.key }) })),
      meta.required ? null : '-',
      meta.required ? null : { label: 'Remove', icon: 'trash', danger: true, action: () => remove({ id, ...where }) },
    ], { anchor: el, side: 'bottom', align: 'start' });
  };

  const trayMenu = (el, id) => {
    const meta = D.layoutItem(id);
    showMenu([
      { type: 'header', label: meta.label },
      ...ZONES.filter((z) => allowed(meta, z)).map((z) => ({ label: 'Add to ' + z.label.toLowerCase(), icon: 'plus', action: () => move({ id }, { zone: z.key, index: z.key === 'toolbar' ? toolbarSpot(id) : null }) })),
    ], { anchor: el, side: 'bottom', align: 'start' });
  };

  // New toolbar buttons go just before the menu (or at the end).
  const toolbarSpot = () => { const cur = list(ZONES[0]); const i = cur.indexOf('menu'); return i < 0 ? cur.length : i; };

  // Where a drop at x,y lands in a zone: before the first chip whose middle is past the pointer.
  const dropIndex = (zoneEl, x, y) => {
    const chips = [...zoneEl.querySelectorAll('.lz-item')];
    for (const c of chips) {
      const r = c.getBoundingClientRect();
      if (y < r.top - 4) return Number(c.dataset.index);
      if (y <= r.bottom + 4 && x < r.left + r.width / 2) return Number(c.dataset.index);
    }
    return chips.length;
  };

  const zoneEl = (z) => {
    const ids = list(z);
    const el = h('div.lz-zone', { dataset: { zone: z.key } }, ...ids.map((id, index) => chip(id, { zone: z.key, index })));
    if (!ids.length) el.append(h('span.lz-empty', null, 'Empty: drop items here'));
    el.addEventListener('dragover', (e) => {
      if (!drag) return;
      const meta = D.layoutItem(drag.id);
      if (!allowed(meta, z)) { e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault();
      clearMarker();
      el.classList.add('hot');
      const at = dropIndex(el, e.clientX, e.clientY);
      marker = h('span.lz-marker');
      const chips = el.querySelectorAll('.lz-item');
      if (at < chips.length) chips[at].before(marker); else el.append(marker);
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clearMarker(); });
    el.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
      const at = dropIndex(el, e.clientX, e.clientY);
      const from = drag;
      clearMarker();
      move(from.zone ? from : { id: from.id }, { zone: z.key, index: at });
    });
    return el;
  };

  const draw = () => {
    const used = placed();
    const trayIds = D.LAYOUT_ITEMS.filter((m) => m.multi || !used.has(m.id)).map((m) => m.id);
    const tray = h('div.lz-tray', null, ...trayIds.map((id) => chip(id, {})));
    tray.addEventListener('dragover', (e) => { if (drag && drag.zone && !D.layoutItem(drag.id).required) { e.preventDefault(); tray.classList.add('hot'); } });
    tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('hot'); });
    tray.addEventListener('drop', (e) => { if (!drag || !drag.zone) return; e.preventDefault(); const from = drag; clearMarker(); remove(from); });
    const horizontal = get('appearance.tabLayout') === 'horizontal';
    box.replaceChildren(...[
      ...ZONES.map((z) => h('div.lz-row' + (z.area === 'sidebar' && horizontal ? '.dim' : ''), null,
        h('div.lz-label', null, icon(z.area === 'toolbar' ? 'layout' : 'sidebar'), h('span', null, z.label)),
        zoneEl(z))),
      horizontal ? h('p.status-line', null, 'The sidebar rows show when tabs are vertical.') : null,
      h('div.lz-label.tray-label', null, icon('plus'), h('span', null, 'More items')),
      tray,
      h('div.btn-row', null, h('button.btn.small', { type: 'button', onclick: async () => { if (await confirmDialog('Put the toolbar and sidebar back the way they were?', { ok: 'Reset' })) reset(); } }, icon('rotate'), 'Reset to default'))].filter(Boolean));
  };
  draw();
  return { el: box, update: () => { if (!drag) draw(); } };
}
