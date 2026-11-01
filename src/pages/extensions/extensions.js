// Bifrost — Extensions: Chrome extensions from the Web Store, .crx/.zip files, or unpacked folders.
import { boot, wb, h, icon, dialog, toast, openUrl, switchEl, debounce } from '/_/common/page.js';
import { importExtensionsMenu } from '/_/common/import-extensions.js';

let grid, search;

async function run(p, ok) {
  try { const r = await p; if (r && ok) toast({ text: ok(r), iconName: 'check' }); return r; }
  catch (e) { toast({ text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), iconName: 'warn', timeout: 7000 }); return null; }
}

function details(e) {
  dialog({
    title: e.name, iconName: 'puzzle', width: 520,
    body: h('div', null,
      e.description ? h('p', null, e.description) : null,
      h('p', null, h('b', null, 'Version '), e.version || '?', ' · ', h('b', null, 'Manifest '), String(e.manifestVersion || '?'), ' · ', h('b', null, 'ID '), h('code', null, e.id)),
      e.permissions.length ? h('div', null, h('p', null, h('b', null, 'It can:')), h('ul', null, e.permissions.map((p) => h('li', null, p)))) : h('p', null, 'It doesn’t need any special permissions.'),
      e.path ? h('p.muted.small', null, 'Installed at ', h('code', null, e.path)) : null),
    buttons: [{ label: 'Close', value: null, primary: true }],
  });
}

function card(e) {
  const img = e.icon ? h('img', { src: e.icon, alt: '' }) : icon('puzzle');
  return h('div.ext' + (e.enabled ? '' : '.off'), null,
    h('div.ext-top', null,
      h('span.ext-ico', null, img),
      h('div.ext-main', null,
        h('div.ext-name', null, e.name, h('span.chip', null, e.version || '')),
        h('div.ext-desc', null, e.description || ''),
        h('div.ext-tags', null,
          h('span.chip' + (e.source === 'unpacked' ? '.accent' : ''), null, e.source === 'unpacked' ? 'Unpacked' : 'Installed'),
          e.manifestVersion === 2 ? h('span.chip', { title: 'Manifest V2 extensions still work in Bifrost' }, 'MV2') : null,
          e.sidePanel ? h('span.chip', { title: 'Opens in the side panel (the buttons at the top of the panel)' }, 'Side panel') : null)),
      switchEl(e.enabled, (v) => run(wb.invoke('extensions:set-enabled', e.id, v)), { label: 'Enabled' })),
    e.error ? h('div.ext-err', null, icon('warn'), e.error) : null,
    e.networkRules && e.enabled ? h('div.ext-note', null, icon('info'), h('span', null, 'Its request-blocking rules aren’t applied in Bifrost; the built-in blocker in Settings → Privacy covers ads and trackers.')) : null,
    h('div.ext-actions', null,
      h('button.btn.small', { type: 'button', onclick: () => details(e) }, 'Details'),
      e.hasOptions && e.enabled ? h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:options', e.id)) }, icon('sliders'), 'Options') : null,
      e.enabled && e.hasAction ? h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:pin', e.id, !e.pinned)) }, icon('pin'), e.pinned ? 'Unpin' : 'Pin to toolbar') : null,
      e.enabled && e.commands ? h('button.btn.small', { type: 'button', onclick: () => openUrl('bifrost://settings/#extension-shortcuts', {}) }, icon('keyboard'), 'Shortcuts') : null,
      e.source === 'unpacked' && e.enabled ? h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:reload', e.id), () => `Reloaded ${e.name}`) }, icon('reload'), 'Reload') : null,
      h('div.pg-spacer'),
      h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:remove', e.id)) }, icon('trash'), 'Remove')));
}

async function render() {
  const all = await wb.invoke('extensions:list').catch(() => []);
  const q = search.value.trim().toLowerCase();
  const list = all.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
  if (!all.length) {
    grid.replaceChildren(h('div.empty-state', null, icon('puzzle'), h('div', null, 'No extensions yet. Get some from the Chrome Web Store, or load one you’re building.')));
    return;
  }
  if (!list.length) {
    grid.replaceChildren(h('div.empty-state', null, icon('search'), h('div', null, `No extensions match “${search.value.trim()}”.`)));
    return;
  }
  grid.replaceChildren(...list.map(card));
}

await boot({ title: 'Extensions' });
search = h('input.field', { type: 'search', placeholder: 'Search extensions', spellcheck: 'false' });
const storeInput = h('input.field', { type: 'text', placeholder: 'Paste a Chrome Web Store link or extension ID', spellcheck: 'false' });
const storeBtn = h('button.btn.primary', { type: 'button' }, icon('plus'), 'Install');
storeBtn.addEventListener('click', async () => {
  const v = storeInput.value.trim();
  if (!v) return;
  storeBtn.disabled = true;
  const r = await run(wb.invoke('extensions:install-store', v), (x) => `Installed ${x.name}`);
  storeBtn.disabled = false;
  if (r) storeInput.value = '';
});
storeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') storeBtn.click(); });
grid = h('div.exts');
document.body.append(h('div.pg', null,
  h('header.pg-head', null,
    h('h1.pg-title', null, h('span.pg-ico', null, icon('puzzle')), 'Extensions'),
    h('div.pg-spacer'),
    h('label.pg-search', null, icon('search'), search)),
  h('div.card.ext-add', null,
    h('div.ext-add-row', null, storeInput, storeBtn),
    h('div.btn-row', null,
      h('button.btn.small', { type: 'button', onclick: () => openUrl('https://chromewebstore.google.com/', {}) }, icon('external'), 'Chrome Web Store'),
      h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:install-file'), (x) => (x.replaced ? `Updated ${x.name}` : `Installed ${x.name}`)) }, icon('file'), 'Install from a .crx or .zip…'),
      h('button.btn.small', { type: 'button', onclick: () => run(wb.invoke('extensions:load-unpacked'), (x) => `Loaded ${x.name}`) }, icon('folderOpen'), 'Load unpacked…'),
      h('button.btn.small', { type: 'button', onclick: (e) => importExtensionsMenu(e.currentTarget) }, icon('import'), 'Import from another browser…')),
    h('p.muted.small', null, 'Extensions run in normal windows only, not private ones. Store extensions update automatically.')),
  grid));
search.addEventListener('input', debounce(render, 100));
await render();
wb.on('extensions-changed', debounce(render, 100));
