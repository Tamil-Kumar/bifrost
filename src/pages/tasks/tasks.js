// Bifrost — Task manager: memory and CPU for every process, with the tabs and extensions in each.
import { boot, wb, h, icon, fmtBytes, toast, isInternal, pageIcon } from '/_/common/page.js';

const KIND = { Browser: 'Browser', Tab: 'Tab', GPU: 'GPU', Utility: 'Utility', Zygote: 'Helper', 'Pepper Plugin': 'Plugin', Unknown: 'Process' };
// Renderer processes ("Tab" to Chromium) are named after what they show: tabs, the window, extensions.
function typeOf(p) {
  if (p.type !== 'Tab' || !p.items.length) return KIND[p.type] || p.type;
  const kinds = new Set(p.items.map((i) => i.kind));
  if (kinds.has('tab')) return 'Tab';
  if (kinds.size === 1 && kinds.has('ui')) return 'Window';
  if (kinds.size === 1 && kinds.has('extension')) return 'Extension';
  return 'Page';
}
let body, sumEl, sortKey = 'memory';

async function refresh() {
  const procs = await wb.invoke('app:metrics').catch(() => []);
  const total = procs.reduce((s, p) => s + (p.memoryKB || 0), 0);
  const cpu = procs.reduce((s, p) => s + (p.cpu || 0), 0);
  sumEl.textContent = `${procs.length} processes · ${fmtBytes(total * 1024)} memory · ${cpu.toFixed(1)}% CPU`;
  const sorted = procs.slice().sort((a, b) => (sortKey === 'cpu' ? b.cpu - a.cpu : b.memoryKB - a.memoryKB));
  body.replaceChildren(...sorted.map((p) => {
    const labels = p.items.length ? p.items : [{ kind: p.type === 'Browser' ? 'browser' : 'process', title: p.type === 'Browser' ? 'Bifrost (main process)' : (p.name || KIND[p.type] || p.type) }];
    const killable = p.items.some((i) => i.kind === 'tab');
    const glyph = (l) => {
      if (l.favicon) {
        const img = h('img.t-fav', { src: l.favicon, alt: '', draggable: 'false' });
        img.addEventListener('error', () => img.replaceWith(icon(l.kind === 'extension' ? 'puzzle' : 'globe')), { once: true });
        return img;
      }
      if (l.kind === 'tab' && isInternal(l.url)) return icon(pageIcon(l.url));
      return icon(l.kind === 'tab' ? 'globe' : l.kind === 'extension' ? 'puzzle' : l.kind === 'ui' ? 'window' : l.kind === 'browser' ? 'compass' : 'cpu');
    };
    return h('tr', null,
      h('td.t-name', null, labels.map((l) => h('div.t-item', null, glyph(l), h('span', { title: l.url || '' }, l.title), l.audible ? icon('volume') : null))),
      h('td', null, typeOf(p)),
      h('td.num', null, fmtBytes((p.memoryKB || 0) * 1024)),
      h('td.num', null, (p.cpu || 0).toFixed(1) + '%'),
      h('td.num', null, String(p.pid)),
      h('td', null, killable ? h('button.btn.small', { type: 'button', onclick: async () => { if (await wb.invoke('app:kill-process', p.pid)) { toast({ text: 'Ended the process; its tabs show a reload button', iconName: 'cpu' }); refresh(); } } }, 'End') : null));
  }));
}

await boot({ title: 'Task manager' });
sumEl = h('span.muted');
body = h('tbody');
const th = (label, key) => h('th' + (key ? '.sortable' : ''), { onclick: key ? () => { sortKey = key; refresh(); } : null }, label);
document.body.append(h('div.pg', null,
  h('header.pg-head', null, h('h1.pg-title', null, h('span.pg-ico', null, icon('cpu')), 'Task manager'), h('div.pg-spacer'), sumEl),
  h('table.tasks', null, h('thead', null, h('tr', null, th('What’s running'), th('Type'), th('Memory', 'memory'), th('CPU', 'cpu'), th('PID'), th(''))), body)));
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 2000);
