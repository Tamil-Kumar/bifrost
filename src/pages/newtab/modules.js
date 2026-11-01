// Bifrost — start page modules: weather, to-do, notes, calendar, countdown, most visited, recently
// closed, a bookmark folder, stats and tips. Which ones show, and where, comes from
// appearance.newTab.modules ([{ id, place }]); each module's options from appearance.newTab.moduleCfg.
import { wb, h, icon, get, set, command, openUrl, showMenu, faviconEl, displayUrl, hostOf, debounce, toast, dialog, promptDialog, page } from '/_/common/page.js';

const D = window.WBDefaults;
const meta = (id) => D.NTP_MODULES.find((m) => m.id === id);
const cfg = (id) => Object.assign({}, D.DEFAULTS.appearance.newTab.moduleCfg[id] || {}, (get('appearance.newTab.moduleCfg') || {})[id] || {});
const setCfg = (id, key, value) => set(`appearance.newTab.moduleCfg.${id}.${key}`, value);
const list = () => (get('appearance.newTab.modules') || []).filter((m) => m && meta(m.id));

// ------------------------------------------------------------- module list
export async function moveModule(id, place) {
  const cur = list().map((m) => (m.id === id ? { id, place } : m));
  await set('appearance.newTab.modules', cur);
}
export async function removeModule(id) { await set('appearance.newTab.modules', list().filter((m) => m.id !== id)); }
export async function addModule(id, place) {
  if (list().some((m) => m.id === id)) return;
  await set('appearance.newTab.modules', list().concat([{ id, place: place || defaultPlace(id) }]));
}
function defaultPlace(id) { return ({ weather: 'right', todo: 'left', notes: 'left', calendar: 'right', countdown: 'right', topsites: 'below', recent: 'below', folder: 'left', stats: 'bottom-left', tips: 'bottom' })[id] || 'below'; }
async function shiftModule(id, dir) {
  const cur = list();
  const i = cur.findIndex((m) => m.id === id);
  const same = cur.map((m, j) => [m, j]).filter(([m]) => m.place === cur[i].place).map(([, j]) => j);
  const k = same.indexOf(i) + dir;
  if (k < 0 || k >= same.length) return;
  const j = same[k];
  [cur[i], cur[j]] = [cur[j], cur[i]];
  await set('appearance.newTab.modules', cur);
}

// ------------------------------------------------------------- the card
function card(m, body, { actions = [] } = {}) {
  const info = meta(m.id);
  const more = h('button.mod-more', { type: 'button', title: 'Module options', 'aria-label': 'Module options' }, icon('dots'));
  more.addEventListener('click', (e) => { e.stopPropagation(); moduleMenu(m, more, actions); });
  const el = h('section.mod', { dataset: { mod: m.id } },
    h('header.mod-head', null, h('span.mod-ico', null, icon(info.icon)), h('span.mod-title', null, info.label), h('span.mod-sp'), ...actions.filter((a) => a.button).map((a) => a.button), more),
    body);
  el.addEventListener('contextmenu', (e) => { if (e.target.closest('input, textarea')) return; e.preventDefault(); moduleMenu(m, { x: e.clientX, y: e.clientY }, actions); });
  return el;
}

function moduleMenu(m, anchor, actions) {
  const pos = anchor instanceof Element ? { anchor, side: 'bottom', align: 'end' } : anchor;
  showMenu([
    { type: 'header', label: meta(m.id).label },
    ...actions.filter((a) => a.label).map((a) => ({ label: a.label, icon: a.icon, action: a.action })),
    actions.some((a) => a.label) ? '-' : null,
    { label: 'Move to', icon: 'move', submenu: () => D.NTP_PLACES.map(([p, label]) => ({ label, checked: p === m.place, action: () => moveModule(m.id, p) })) },
    { label: 'Move up', icon: 'chevronUp', action: () => shiftModule(m.id, -1) },
    { label: 'Move down', icon: 'chevronDown', action: () => shiftModule(m.id, 1) },
    '-',
    { label: 'Remove this module', icon: 'close', action: () => removeModule(m.id) },
    { label: 'Start page settings…', icon: 'sliders', action: () => command('openSettings', { section: 'ntp-modules' }) },
  ], pos);
}

const empty = (text, btn) => h('div.mod-empty', null, h('p', null, text), btn || null);

// --------------------------------------------------------------- modules
const WMO = [
  [[0], 'Clear', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'cloudSun'], [[3], 'Cloudy', 'cloud'],
  [[45, 48], 'Fog', 'fog'], [[51, 53, 55, 56, 57], 'Drizzle', 'rain'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'], [[95, 96, 99], 'Thunderstorms', 'storm'],
];
const wmo = (code, day = true) => { const w = WMO.find((x) => x[0].includes(code)) || [[], 'Weather', 'cloud']; return { text: w[1], icon: !day && w[2] === 'sun' ? 'moon' : w[2] }; };

async function askCity() {
  const city = await promptDialog({ title: 'Weather for which city?', label: 'City', value: cfg('weather').city, placeholder: 'West Lafayette', ok: 'Show the weather' });
  if (city != null && city.trim()) await setCfg('weather', 'city', city.trim());
}

const RENDER = {
  weather(m) {
    const c = cfg('weather');
    const body = h('div.mod-body.weather', null, h('p.mod-muted', null, 'Loading…'));
    const el = card(m, body, { actions: [
      { label: 'Change city…', icon: 'location', action: askCity },
      { label: c.units === 'c' ? '✓ Celsius' : 'Celsius', icon: 'sliders', action: () => setCfg('weather', 'units', 'c') },
      { label: c.units === 'f' ? '✓ Fahrenheit' : 'Fahrenheit', icon: 'sliders', action: () => setCfg('weather', 'units', 'f') },
      { label: c.units === 'auto' ? '✓ Units for my region' : 'Units for my region', icon: 'sliders', action: () => setCfg('weather', 'units', 'auto') },
    ] });
    if (!c.city) { body.replaceChildren(empty('Choose a city to see its weather.', h('button.btn.small', { type: 'button', onclick: askCity }, icon('location'), 'Choose a city'))); return el; }
    wb.invoke('ntp:weather', c.city, c.units).then((w) => {
      const deg = '°';
      const now = wmo(w.now.code, w.now.day);
      const round = (x) => (x == null ? '–' : Math.round(x));
      const day = (iso) => new Date(iso + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
      body.replaceChildren(
        h('div.w-now', null,
          h('span.w-ico', null, icon(now.icon)),
          h('div', null, h('div.w-temp', null, round(w.now.temp) + deg), h('div.w-cond', null, now.text)),
          h('div.w-side', null,
            h('div', null, 'Feels ' + round(w.now.feels) + deg),
            h('div', null, round(w.now.humidity) + '% · ' + round(w.now.wind) + (w.units === 'f' ? ' mph' : ' km/h')))),
        h('div.w-place', null, [w.place.name, w.place.region].filter(Boolean).join(', ')),
        h('div.w-days', null, w.days.slice(0, 4).map((d, i) => {
          const x = wmo(d.code);
          return h('div.w-day', { title: x.text + (d.rain != null ? ` · ${d.rain}% chance of rain` : '') },
            h('span', null, i === 0 ? 'Today' : day(d.date)), icon(x.icon), h('b', null, round(d.hi) + deg), h('small', null, round(d.lo) + deg));
        })));
    }).catch((e) => body.replaceChildren(empty(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), h('button.btn.small', { type: 'button', onclick: askCity }, 'Change city'))));
    return el;
  },

  todo(m) {
    const box = h('ul.todo-list');
    const input = h('input.field.todo-add', { type: 'text', placeholder: 'Add a task and press Enter', spellcheck: 'true' });
    let items = [];
    const save = () => wb.invoke('ntp:data-set', 'todo', items).catch((e) => toast({ text: e.message, iconName: 'warn' }));
    const draw = () => {
      box.replaceChildren(...items.map((it) => {
        const cb = h('input', { type: 'checkbox', checked: !!it.done });
        cb.addEventListener('change', () => { it.done = cb.checked; save(); draw(); });
        const del = h('button.mod-x', { type: 'button', title: 'Delete' }, icon('close'));
        del.addEventListener('click', () => { items = items.filter((x) => x !== it); save(); draw(); });
        return h('li' + (it.done ? '.done' : ''), null, h('label', null, cb, h('span', null, it.text)), del);
      }));
      clear.hidden = !items.some((x) => x.done);
    };
    const clear = h('button.link-btn', { type: 'button', hidden: true, onclick: () => { items = items.filter((x) => !x.done); save(); draw(); } }, 'Clear finished');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      items.push({ id: Date.now().toString(36), text: input.value.trim().slice(0, 300), done: false });
      input.value = '';
      save(); draw();
    });
    const load = () => wb.invoke('ntp:data-get', 'todo').then((v) => { items = Array.isArray(v) ? v : []; draw(); }).catch(() => {});
    load();
    const el = card(m, h('div.mod-body', null, box, input, h('div.todo-foot', null, clear)));
    el._reload = (key) => { if (key === 'todo' && !el.contains(document.activeElement)) load(); };
    return el;
  },

  notes(m) {
    const ta = h('textarea.notes', { placeholder: 'Write anything. It’s saved as you type.', spellcheck: 'true' });
    const save = debounce(() => wb.invoke('ntp:data-set', 'notes', ta.value).catch((e) => toast({ text: e.message, iconName: 'warn' })), 400);
    ta.addEventListener('input', save);
    ta.addEventListener('blur', () => save.flush());
    const load = () => wb.invoke('ntp:data-get', 'notes').then((v) => { if (document.activeElement !== ta) ta.value = typeof v === 'string' ? v : ''; }).catch(() => {});
    load();
    const el = card(m, h('div.mod-body', null, ta));
    el._reload = (key) => { if (key === 'notes') load(); };
    return el;
  },

  calendar(m) {
    const body = h('div.mod-body.cal');
    let shown = new Date();
    shown.setDate(1);
    const weekStart = () => { const w = cfg('calendar').weekStart; if (w === 'monday') return 1; if (w === 'sunday') return 0; try { const l = new Intl.Locale(navigator.language); const info = l.getWeekInfo ? l.getWeekInfo() : l.weekInfo; return info && info.firstDay === 1 ? 1 : 0; } catch { return 0; } };
    const draw = () => {
      const ws = weekStart();
      const today = new Date();
      const y = shown.getFullYear(), mo = shown.getMonth();
      const first = new Date(y, mo, 1);
      const offset = (first.getDay() - ws + 7) % 7;
      const days = new Date(y, mo + 1, 0).getDate();
      const names = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + ((i + ws) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));
      const cells = [];
      for (let i = 0; i < offset; i++) cells.push(h('span.cal-d.out'));
      for (let d = 1; d <= days; d++) {
        const isToday = d === today.getDate() && mo === today.getMonth() && y === today.getFullYear();
        cells.push(h('span.cal-d' + (isToday ? '.today' : ''), null, String(d)));
      }
      body.replaceChildren(
        h('div.cal-head', null,
          h('button.mod-x', { type: 'button', title: 'Previous month', onclick: () => { shown = new Date(y, mo - 1, 1); draw(); } }, icon('chevronLeft')),
          h('b', { title: 'Back to this month', onclick: () => { shown = new Date(); shown.setDate(1); draw(); } }, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
          h('button.mod-x', { type: 'button', title: 'Next month', onclick: () => { shown = new Date(y, mo + 1, 1); draw(); } }, icon('chevronRight'))),
        h('div.cal-grid', null, names.map((n) => h('span.cal-n', null, n)), cells));
    };
    draw();
    return card(m, body, { actions: [
      { label: 'Week starts on Sunday', icon: 'calendar', action: () => setCfg('calendar', 'weekStart', 'sunday') },
      { label: 'Week starts on Monday', icon: 'calendar', action: () => setCfg('calendar', 'weekStart', 'monday') },
    ] });
  },

  countdown(m) {
    const c = cfg('countdown');
    const body = h('div.mod-body.cd');
    const edit = async () => {
      const title = await promptDialog({ title: 'Count down to…', label: 'What’s happening', value: c.title, placeholder: 'Finals', ok: 'Next' });
      if (title == null) return;
      const date = await promptDialog({ title: 'When?', label: 'Date (and time, if you like)', value: c.date || new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), placeholder: 'YYYY-MM-DD or YYYY-MM-DD HH:MM', ok: 'Save' });
      if (date == null) return;
      await setCfg('countdown', 'title', title.trim());
      await setCfg('countdown', 'date', date.trim().replace(' ', 'T'));
    };
    const when = c.date ? new Date(/T/.test(c.date) ? c.date : c.date + 'T00:00') : null;
    if (!when || isNaN(when)) {
      body.replaceChildren(empty('Count down the days to anything.', h('button.btn.small', { type: 'button', onclick: edit }, icon('hourglass'), 'Set a date')));
    } else {
      const tick = () => {
        if (!body.isConnected && body._started) return;
        body._started = true;
        const ms = when - Date.now();
        const past = ms < 0;
        const a = Math.abs(ms);
        const hr = Math.floor((a % 864e5) / 36e5), mi = Math.floor((a % 36e5) / 6e4);
        // A date without a time counts calendar days (Finals on the 27th is "10 days" all day on the 17th).
        const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const d = /T/.test(c.date) ? Math.floor(a / 864e5) : Math.abs(Math.round((midnight(when) - midnight(new Date())) / 864e5));
        body.replaceChildren(
          h('div.cd-num', null, h('b', null, String(d)), h('span', null, d === 1 ? ' day' : ' days'), d < 3 && /T/.test(c.date) ? h('span.cd-sub', null, ` ${hr} h ${mi} min`) : null),
          h('div.cd-what', null, past ? `since ${c.title || 'then'}` : `until ${c.title || when.toLocaleDateString()}`),
          h('div.mod-muted', null, when.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (/T/.test(c.date) ? ', ' + when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')));
        setTimeout(tick, 30000);
      };
      tick();
    }
    return card(m, body, { actions: [{ label: 'Change…', icon: 'edit', action: edit }] });
  },

  topsites(m) {
    const n = Math.max(3, Math.min(12, cfg('topsites').count || 6));
    const box = h('div.mod-body.links');
    wb.invoke('history:top', n).then((rows) => {
      const sites = (rows || []).filter((x) => /^https?:/.test(x.url)).slice(0, n);
      box.replaceChildren(...(sites.length ? sites.map((x) => link(x.url, x.title)) : [empty('Sites you visit often show up here.')]));
    }).catch(() => {});
    return card(m, box, { actions: [6, 9, 12].map((k) => ({ label: `Show ${k}`, icon: 'grid', action: () => setCfg('topsites', 'count', k) })) });
  },

  recent(m) {
    const n = Math.max(3, Math.min(15, cfg('recent').count || 5));
    const box = h('div.mod-body.links');
    wb.invoke('closed:list').then((rows) => {
      const tabs = (rows || []).filter((x) => x.url).slice(0, n);
      box.replaceChildren(...(tabs.length ? tabs.map((x) => link(x.url, x.title)) : [empty('Tabs you close show up here.')]));
    }).catch(() => {});
    return card(m, box);
  },

  folder(m) {
    const id = Number(cfg('folder').id) || 0;
    const box = h('div.mod-body.links');
    const pick = async () => {
      const tree = await wb.invoke('bookmarks:tree');
      const items = [];
      const walk = (n, depth) => { if (n.type !== 'folder') return; if (n.parentId != null) items.push({ label: ' '.repeat(Math.max(0, depth - 1) * 2) + (n.title || 'Untitled folder'), icon: 'folder', action: () => setCfg('folder', 'id', String(n.id)) }); for (const c of n.children || []) walk(c, depth + 1); };
      walk(tree, 0);
      showMenu(items.slice(0, 60), { x: innerWidth / 2 - 120, y: innerHeight / 3 });
    };
    const el = card(m, box, { actions: [{ label: 'Choose a folder…', icon: 'folder', action: pick }] });
    if (!id) { box.replaceChildren(empty('Show the bookmarks in one of your folders.', h('button.btn.small', { type: 'button', onclick: pick }, icon('folder'), 'Choose a folder'))); return el; }
    Promise.all([wb.invoke('bookmarks:get', id), wb.invoke('bookmarks:children', id)]).then(([f, kids]) => {
      if (f) el.querySelector('.mod-title').textContent = f.title || 'Bookmarks';
      const rows = (kids || []).filter((k) => k.type !== 'separator').slice(0, 30);
      box.replaceChildren(...(rows.length ? rows.map((k) => (k.type === 'folder'
        ? h('button.mod-link', { type: 'button', title: k.title, onclick: () => setCfg('folder', 'id', String(k.id)) }, h('span.mod-fav.fbox', null, icon('folder')), h('span', null, k.title || 'Untitled folder'))
        : link(k.url, k.title))) : [empty('This folder is empty.')]));
      if (f && f.parentId != null && f.parentId > 3) box.prepend(h('button.mod-link.up', { type: 'button', onclick: () => setCfg('folder', 'id', String(f.parentId)) }, h('span.mod-fav.fbox', null, icon('chevronLeft')), h('span', null, 'Up a folder')));
    }).catch(() => box.replaceChildren(empty('That folder is gone.', h('button.btn.small', { type: 'button', onclick: pick }, 'Choose another'))));
    return el;
  },

  stats(m) {
    const box = h('div.mod-body.stats');
    const mb = (x) => (x >= 1024 ? (x / 1024).toFixed(1) + ' GB' : x + ' MB');
    const draw = async () => {
      const s = await wb.invoke('ntp:stats').catch(() => null);
      if (!s) return;
      box.replaceChildren(
        stat(mb(s.memory), 'memory in use', 'cpu'),
        stat(String(s.pagesLoaded), s.pagesLoaded === 1 ? 'page loaded' : 'pages loaded', 'window'),
        stat(s.adsBlocked.toLocaleString(), s.adblock ? 'ads and trackers blocked' : 'blocked (blocking is off)', 'shieldCheck'));
    };
    draw();
    const t = setInterval(() => { if (!box.isConnected) clearInterval(t); else if (!document.hidden) draw(); }, 5000);
    return card(m, box, { actions: [{ label: 'Performance settings…', icon: 'cpu', action: () => command('openSettings', { section: 'performance' }) }] });
  },

  tips(m) {
    const body = h('div.mod-body.tip');
    const map = D.shortcutMap(page.settings);
    const tips = D.COMMANDS.filter((c) => (map[c.id] || []).length && !/^(tab|workspace)\d$/.test(c.id)).map((c) => ({ text: c.label, key: map[c.id][0] }));
    tips.push(
      { text: 'Right-click any toolbar or sidebar button to move or remove it' },
      { text: 'Type a search engine’s keyword and a space in the launcher, like “yt cats”' },
      { text: 'Drag a tab onto a space at the bottom of the sidebar to move it there' },
      { text: 'Settings → Performance has a Memory saver profile for long days on battery' },
      { text: 'Right-click a module on this page to move it' });
    let i = Math.floor(Math.random() * tips.length);
    const draw = () => {
      const t = tips[i % tips.length];
      body.replaceChildren(h('div.tip-text', null, t.text), t.key ? h('kbd', null, t.key) : null);
    };
    draw();
    body.addEventListener('click', () => { i++; draw(); });
    body.title = 'Click for another tip';
    return card(m, body);
  },
};

function stat(value, label, ic) {
  return h('div.stat', null, h('span.stat-ico', null, icon(ic)), h('div', null, h('b', null, value), h('small', null, label)));
}

function link(url, title) {
  const a = h('a.mod-link', { href: url, title: url, draggable: 'true' }, faviconEl(url, '', icon, 'mod-fav', { hi: true }), h('span', null, title || displayUrl(url) || hostOf(url)));
  // A plain click opens it here, like a Speed Dial tile; Ctrl/middle-click in a new tab, Shift in a new window.
  a.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); openUrl(url, { background: true }); } else if (e.shiftKey) { e.preventDefault(); openUrl(url, { newWindow: true }); }
  });
  a.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openUrl(url, { background: true }); } });
  return a;
}

// Draws every module into its page area. zones: place -> element.
export function renderModules(zones) {
  for (const z of Object.values(zones)) for (const el of z.querySelectorAll(':scope > .mod')) el.remove();
  for (const m of list()) {
    const zone = zones[m.place] || zones.below;
    try { zone.append(RENDER[m.id](m)); } catch (e) { console.error('module ' + m.id, e); }
  }
}

// Other start pages changed notes or the to-do list.
export function dataChanged(key) {
  for (const el of document.querySelectorAll('.mod')) if (el._reload) el._reload(key);
}

// The "Modules" dialog from the customize button: turn modules on and off and pick where they go.
export async function modulesDialog() {
  const rows = h('div.modlist');
  const draw = () => {
    const on = list();
    rows.replaceChildren(...D.NTP_MODULES.map((info) => {
      const cur = on.find((x) => x.id === info.id);
      const sw = h('input', { type: 'checkbox', checked: !!cur });
      sw.addEventListener('change', async () => { if (sw.checked) await addModule(info.id); else await removeModule(info.id); draw(); });
      const sel = h('select.field.select-sm', { disabled: !cur }, D.NTP_PLACES.map(([p, l]) => h('option', { value: p }, l)));
      sel.value = cur ? cur.place : defaultPlace(info.id);
      sel.addEventListener('change', () => moveModule(info.id, sel.value));
      return h('div.modrow', { dataset: { mod: info.id } }, h('label.modrow-main', null, sw, h('span.mod-ico', null, icon(info.icon)), h('span', null, h('b', null, info.label), h('small', null, info.desc))), sel);
    }));
  };
  draw();
  await dialog({ title: 'Modules', iconName: 'grid', width: 600, className: 'mod-dialog', body: h('div', null, h('p', { style: { margin: '0 0 10px' } }, 'Pick what shows on new tabs, and where. Right-click a module on the page to move it later.'), rows), buttons: [{ label: 'Done', value: true, primary: true }] });
}
