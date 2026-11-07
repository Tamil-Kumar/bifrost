// Bifrost — Settings: the toolbar & sidebar editor. Three rows (the toolbar, the sidebar's top row and its
// bottom row) hold the items from WBDefaults.LAYOUT_ITEMS; a fourth, the side bar, holds the side panel's
// buttons (its panels, its + button, its settings button: panels.order and panels.hidden, laid out by
// WBDefaults.sideBarKeys, as the window does). Drag items between rows (the side bar's stay on it), from the
// trays, or back to a tray to take them off. Clicking an item opens a menu that does the same without
// dragging.
import { h, icon, get, set, showMenu, toast, confirmDialog, faviconEl, hostOf, wb } from '/_/common/page.js';

const D = window.WBDefaults;
export const ZONES = [
  { key: 'toolbar', path: 'appearance.toolbar', label: 'Toolbar', area: 'toolbar' },
  { key: 'top', path: 'appearance.sidebarTop', label: 'Sidebar, top', area: 'sidebar' },
  { key: 'bottom', path: 'appearance.sidebarBottom', label: 'Sidebar, bottom', area: 'sidebar' },
  { key: 'bar', label: 'Side bar', area: 'bar' },
];
const zoneOf = (key) => ZONES.find((z) => z.key === key);
const BAR = zoneOf('bar');

// ------------------------------------------------------------- the side bar
const BUILTIN = { bookmarks: ['Bookmarks', 'book'], history: ['History', 'clock'], downloads: ['Downloads', 'download'] };
let extCands = null;   // extensions that can be in the side panel (main/extensions/sidepanel.js), once known
const webs = () => (get('panels.web') || []).filter((w) => w && typeof w.id === 'string' && /^https?:/i.test(w.url || ''));
const horizontal = () => get('appearance.tabLayout') === 'horizontal';
// Its panels, in their usual order (as the window has them: ui/js/panels.js).
const barPanels = () => [...Object.keys(BUILTIN), ...webs().map((w) => 'web:' + w.id), ...(extCands || []).filter((c) => c.added).map((c) => 'ext:' + c.id)];
const barKeys = () => D.sideBarKeys({ order: get('panels.order'), hidden: get('panels.hidden'), panels: barPanels(), horizontal: horizontal() });
// Its items here are "bar:<key>" (a key as in panels.order), but for its flexible spaces ("spacer").
const barId = (key) => (key === 'spacer' ? 'spacer' : 'bar:' + key);
const barKey = (id) => (id === 'spacer' ? 'spacer' : id.slice(4));

function barMeta(key) {
  const own = D.SIDE_BAR_ITEMS[key];
  if (own && key !== 'spacer') return { id: barId(key), label: own.label, icon: own.icon, bar: true };
  if (BUILTIN[key]) return { id: barId(key), label: BUILTIN[key][0], icon: BUILTIN[key][1], bar: true, builtin: true };
  if (key.startsWith('web:')) {
    const w = webs().find((x) => 'web:' + x.id === key);
    return w ? { id: barId(key), label: w.title || hostOf(w.url).replace(/^www\./, '') || w.url, web: w, bar: true } : null;
  }
  if (key.startsWith('ext:')) {
    const c = (extCands || []).find((x) => 'ext:' + x.id === key);
    return c ? { id: barId(key), label: c.name, ext: c, bar: true } : null;
  }
  return null;
}
const metaOf = (id) => (typeof id === 'string' && id.startsWith('bar:') ? barMeta(id.slice(4)) : D.layoutItem(id));
// The side bar's items take only side bar places, and its places only take those (and flexible spaces).
const allowed = (meta, zone) => (zone.area === 'bar' ? !!meta.bar || meta.id === 'spacer' : !meta.bar && (!meta.only || meta.only === zone.area));
const list = (zone) => (zone.key === 'bar' ? barKeys().map(barId) : (get(zone.path) || [])).filter((id) => metaOf(id));
const placed = () => new Set(ZONES.flatMap((z) => list(z)));

function save(path, value) {
  return set(path, value).catch((e) => toast({ text: e.message, iconName: 'warn' }));
}

// Saves the rows that changed. `shown`: a side bar item that comes back on it; `hidden`: one that comes off.
async function saveLists(lists, { shown = null, hidden = null } = {}) {
  for (const z of ZONES) {
    if (z.path && JSON.stringify(lists[z.key]) !== JSON.stringify(list(z))) await save(z.path, lists[z.key]);
  }
  const was = get('panels.hidden') || [];
  let hid = was.slice();
  if (shown && shown.startsWith('bar:')) hid = hid.filter((k) => k !== barKey(shown));
  if (hidden && hidden.startsWith('bar:') && !hid.includes(barKey(hidden))) hid.push(barKey(hidden));
  if (JSON.stringify(lists.bar) !== JSON.stringify(list(BAR)) || JSON.stringify(hid) !== JSON.stringify(was)) {
    await save('panels', { ...get('panels'), order: lists.bar.map(barKey), hidden: hid });
  }
}

// Where a new item goes when clicked in a tray: on the toolbar just before the menu; on the side bar, a panel
// just before + (or its settings button, or a space), + before the space and settings button, the rest last.
function spot(zone, id) {
  const cur = list(zoneOf(zone));
  const firstOf = (ids) => { const i = cur.findIndex((x) => ids.includes(x)); return i < 0 ? cur.length : i; };
  if (zone === 'toolbar') return firstOf(['menu']);
  if (zone !== 'bar') return cur.length;
  if (id === 'bar:add') return firstOf(['spacer', 'bar:settings']);
  if (id === 'bar:settings' || id === 'spacer') return cur.length;
  return firstOf(['bar:add', 'spacer', 'bar:settings']);
}

// Moves an item (from a zone position, or new from a tray) to a zone position.
export async function move(from, to) {
  const meta = metaOf(from.id);
  const target = zoneOf(to.zone);
  if (!meta || !target) return;
  if (!allowed(meta, target)) {
    toast({ text: meta.bar ? `${meta.label} stays on the side bar` : target.area === 'bar' ? 'Only the side panel’s buttons go on the side bar' : `${meta.label} can only go on the ${meta.only === 'toolbar' ? 'toolbar' : 'sidebar'}`, iconName: 'info' });
    return;
  }
  const lists = Object.fromEntries(ZONES.map((z) => [z.key, list(z)]));
  let index = to.index == null ? spot(to.zone, from.id) : to.index;
  if (from.zone) {
    const src = lists[from.zone];
    if (src[from.index] !== from.id) return;
    src.splice(from.index, 1);
    if (from.zone === to.zone && from.index < index) index--;
  } else if (!meta.multi && placed().has(from.id)) {
    return;
  }
  lists[to.zone].splice(Math.max(0, Math.min(index, lists[to.zone].length)), 0, from.id);
  await saveLists(lists, { shown: from.zone ? null : from.id });
}

export async function remove(from) {
  const meta = metaOf(from.id);
  if (!meta) return;
  if (meta.required) {
    toast({ text: meta.id === 'address' ? 'The address bar always stays on the toolbar' : 'The menu has to stay somewhere: move it instead', iconName: 'info' });
    return;
  }
  const lists = Object.fromEntries(ZONES.map((z) => [z.key, list(z)]));
  const cur = lists[from.zone];
  if (!cur || cur[from.index] !== from.id) return;
  cur.splice(from.index, 1);
  await saveLists(lists, { hidden: from.zone === 'bar' && from.id !== 'spacer' ? from.id : null });
}

export async function reset() {
  for (const z of ZONES) if (z.path) await save(z.path, D.getPath(D.DEFAULTS, z.path));
  await save('panels', { ...get('panels'), order: null, hidden: [] });
}

export function layoutEditor() {
  const box = h('div.lz-editor');
  let drag = null;            // { id, zone, index } while dragging
  let marker = null;

  const clearMarker = () => { if (marker) marker.remove(); marker = null; for (const z of box.querySelectorAll('.lz-zone.hot, .lz-tray.hot')) z.classList.remove('hot'); };

  const iconFor = (meta) => {
    if (meta.web) return faviconEl(meta.web.url, '', icon, 'lz-fav', { hi: true, lookup: true });
    if (meta.ext) {
      if (!meta.ext.icon) return icon('puzzle');
      const img = h('img.lz-fav', { src: meta.ext.icon, alt: '', draggable: 'false' });
      img.addEventListener('error', () => img.replaceWith(icon('puzzle')), { once: true });
      return img;
    }
    return icon(meta.icon);
  };

  const chip = (id, where, { note = '' } = {}) => {
    const meta = metaOf(id);
    const el = h('div.lz-item' + (meta.required ? '.required' : '') + (id === 'address' ? '.wide' : '') + (id === 'spacer' ? '.spacer' : '') + (where.zone ? '' : '.tray') + (note ? '.dim' : ''), {
      draggable: 'true', tabindex: '0', role: 'button',
      title: note || (where.zone ? 'Drag to move · click for options' : 'Drag onto a row · click to add'),
      dataset: { id, zone: where.zone || '', index: where.index == null ? '' : String(where.index) },
    }, iconFor(meta), h('span', null, meta.label));
    if (where.zone && !meta.required) {
      el.append(h('button.lz-x', { type: 'button', title: where.zone === 'bar' ? 'Take off the side bar' : 'Remove', onclick: (e) => { e.stopPropagation(); remove({ id, ...where }); } }, icon('close')));
    }
    el.addEventListener('click', () => (where.zone ? itemMenu(el, id, where) : trayMenu(el, id, where.tray)));
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
    const meta = metaOf(id);
    const cur = list(zoneOf(where.zone));
    // (with tabs on top the side bar is a column)
    const column = where.zone === 'bar' && horizontal();
    showMenu([
      { type: 'header', label: meta.label },
      where.index > 0 ? { label: column ? 'Move up' : 'Move left', icon: column ? 'arrowUp' : 'chevronLeft', action: () => move({ id, ...where }, { zone: where.zone, index: where.index - 1 }) } : null,
      where.index < cur.length - 1 ? { label: column ? 'Move down' : 'Move right', icon: column ? 'arrowDown' : 'chevronRight', action: () => move({ id, ...where }, { zone: where.zone, index: where.index + 2 }) } : null,
      ...ZONES.filter((z) => z.key !== where.zone && allowed(meta, z)).map((z) => ({ label: 'Move to ' + z.label.toLowerCase(), icon: z.area === 'toolbar' ? 'layout' : 'sidebar', action: () => move({ id, ...where }, { zone: z.key }) })),
      meta.required ? null : '-',
      meta.required ? null : { label: where.zone === 'bar' ? 'Take off the side bar' : 'Remove', icon: where.zone === 'bar' ? 'eyeOff' : 'trash', danger: where.zone !== 'bar', action: () => remove({ id, ...where }) },
    ], { anchor: el, side: 'bottom', align: 'start' });
  };

  const trayMenu = (el, id, tray) => {
    const meta = metaOf(id);
    // (a flexible space in the side bar's tray is for the side bar)
    const zones = ZONES.filter((z) => allowed(meta, z) && (id !== 'spacer' || (tray === 'bar') === (z.key === 'bar')));
    showMenu([
      { type: 'header', label: meta.label },
      ...zones.map((z) => ({ label: 'Add to ' + (z.key === 'bar' ? 'the side bar' : z.label.toLowerCase()), icon: 'plus', action: () => move({ id }, { zone: z.key }) })),
    ], { anchor: el, side: 'bottom', align: 'start' });
  };

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
    // (with tabs on the side, a panel the sidebar has a button for already isn't on the side bar as well)
    const inSidebar = z.key === 'bar' && !horizontal() ? new Set([...(get('appearance.sidebarTop') || []), ...(get('appearance.sidebarBottom') || [])]) : new Set();
    const note = (id) => (id.startsWith('bar:') && BUILTIN[barKey(id)] && inSidebar.has(barKey(id)) ? 'Not shown on the side bar while it’s in a sidebar row as well' : '');
    const el = h('div.lz-zone' + (z.key === 'bar' ? '.bar' : ''), { dataset: { zone: z.key } }, ...ids.map((id, index) => chip(id, { zone: z.key, index }, { note: note(id) })));
    if (!ids.length) el.append(h('span.lz-empty', null, 'Empty: drop items here'));
    el.addEventListener('dragover', (e) => {
      if (!drag) return;
      const meta = metaOf(drag.id);
      if (!meta || !allowed(meta, z)) { e.dataTransfer.dropEffect = 'none'; return; }
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

  // A tray: what can still go on the rows above it. Dropping an item from a row there takes it off.
  const trayEl = (ids, key) => {
    const tray = h('div.lz-tray', { dataset: { tray: key } }, ...ids.map((id) => chip(id, { tray: key })));
    if (!ids.length) tray.append(h('span.lz-empty', null, key === 'bar' ? 'Everything is on the side bar' : 'Everything is placed'));
    tray.addEventListener('dragover', (e) => { if (drag && drag.zone && !metaOf(drag.id).required) { e.preventDefault(); tray.classList.add('hot'); } });
    tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('hot'); });
    tray.addEventListener('drop', (e) => { if (!drag || !drag.zone) return; e.preventDefault(); const from = drag; clearMarker(); remove(from); });
    return tray;
  };

  const row = (z, cls = '') => h('div.lz-row' + cls, null,
    h('div.lz-label', null, icon(z.area === 'toolbar' ? 'layout' : 'sidebar'), h('span', null, z.label)),
    zoneEl(z));

  const draw = () => {
    const used = placed();
    const hor = horizontal();
    const onBar = new Set(barKeys());
    const barTray = [...barPanels(), 'add', 'settings'].filter((k) => !onBar.has(k) && barMeta(k)).map(barId).concat('spacer');
    const stripOff = get('panels.strip') === false;
    box.replaceChildren(...[
      ...ZONES.filter((z) => z.path).map((z) => row(z, z.area === 'sidebar' && hor ? '.dim' : '')),
      hor ? h('p.status-line', null, 'The sidebar rows show when tabs are vertical.') : null,
      h('div.lz-label.tray-label', null, icon('plus'), h('span', null, 'More items')),
      trayEl(D.LAYOUT_ITEMS.filter((m) => m.multi || !used.has(m.id)).map((m) => m.id), 'items'),
      h('div.lz-sep'),
      row(BAR, stripOff ? '.dim' : ''),
      h('p.status-line', null, stripOff ? 'The side bar is off (Settings → Side panel turns it on).'
        : hor ? 'The side panel’s buttons: the column at the window’s edge, from the top.' : 'The side panel’s buttons: the row above the sidebar’s bottom row.'),
      h('div.lz-label.tray-label', null, icon('plus'), h('span', null, 'Not on the side bar')),
      trayEl(barTray, 'bar'),
      h('div.btn-row', null, h('button.btn.small', { type: 'button', onclick: async () => { if (await confirmDialog('Put the toolbar, the sidebar and the side bar back the way they were?', { ok: 'Reset' })) reset(); } }, icon('rotate'), 'Reset to default'))].filter(Boolean));
  };
  const load = () => wb.invoke('panels:extension-candidates').then((c) => { extCands = Array.isArray(c) ? c : []; if (!drag) draw(); }, () => { extCands = extCands || []; });
  draw();
  load();
  return { el: box, update: () => { if (!drag) draw(); load(); } };
}
