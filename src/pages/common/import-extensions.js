// Bifrost — "Import extensions" (used by Settings → Import & backup, the welcome page and the Extensions
// page): lists what another browser has, lets you pick, and brings the picks over, with their settings.
// Firefox add-ons come over as their Chrome versions from the Chrome Web Store: the well-known ones are
// matched straight away, the rest are looked up on the store by name while the list is open.
import { h } from './util.js';
import { icon } from './icons.js';
import { dialog, toast } from './dialogs.js';
import { showMenu } from './menus.js';

const wb = window.wb;
const open = (url) => wb.send('app:open-url', url, {});
const installable = (it) => it.action === 'copy' || it.action === 'unpacked' || it.action === 'store';

function row(it, onChange, { looking = false } = {}) {
  // Already in Bifrost: still pickable when the other browser has settings for it (they're brought over again).
  const resync = it.already && it.hasData && installable(it);
  const can = (installable(it) && !it.already) || resync;
  const cb = h('input', { type: 'checkbox', checked: can && it.recommended && !it.already, disabled: !can });
  cb.addEventListener('change', onChange);
  const ico = it.icon ? h('img.ix-ico', { src: it.icon, alt: '' }) : h('span.ix-ico.ph', null, icon('puzzle'));
  const link = (label, url, ic = 'external') => h('button.btn.small', { type: 'button', onclick: (e) => { e.preventDefault(); open(url); } }, icon(ic), label);
  const chip = looking ? h('span.chip.ix-looking', null, h('span.ix-spin'), 'Looking it up…')
    : resync ? h('span.chip.ok', { title: 'Tick it to bring its settings over again' }, icon('check'), 'In Bifrost · settings only')
    : it.already ? h('span.chip.ok', null, icon('check'), 'Already in Bifrost')
    : it.action === 'none' ? h('span.chip', null, 'Firefox only')
    : it.action === 'search' ? link('Find it', it.searchUrl, 'search')
    : it.found === 'close' ? link('Check', it.storeUrl)
    : it.action === 'unpacked' ? h('span.chip', null, 'Unpacked') : null;
  const tags = [];
  if (it.hasData && installable(it)) tags.push(h('span.ix-tag', { title: 'Its settings can come with it' }, icon('sliders'), 'Settings'));
  if (it.found === 'exact') tags.push(h('span.ix-tag.found', { title: 'Found on the Chrome Web Store by its name' }, icon('search'), 'Found'));
  const el = h('label.ix-row' + (can ? '' : '.off') + (looking ? '.looking' : ''), { dataset: { key: it.key } }, cb, ico,
    h('span.ix-main', null,
      h('b', null, it.name, it.version ? h('span.ix-ver', null, ' ' + it.version) : null, ...tags),
      it.note ? h('small', null, it.note) : null),
    chip);
  el._item = it;
  el._cb = cb;
  return el;
}

// Shows the picker for one browser profile and imports what's chosen. Resolves with the result (or null).
export async function importExtensionsDialog(sourceId) {
  let scan;
  try { scan = await wb.invoke('import:extensions-scan', sourceId); } catch (e) { toast({ text: 'Couldn’t read its extensions: ' + e.message, iconName: 'warn' }); return null; }
  const { source, items } = scan;
  const firefox = source.kind === 'firefox';
  if (!items.length) {
    await dialog({ title: 'No extensions found', iconName: 'puzzle', body: h('p', null, `${source.name} has no extensions that can be brought over.`), buttons: [{ label: 'OK', value: true, primary: true }] });
    return null;
  }
  const okBtnLabel = h('span');
  const toLookUp = items.filter((it) => it.lookup).map((it) => it.key);
  const list = h('div.ix-list');
  const rows = new Map();
  const count = () => {
    const n = [...rows.values()].filter((r) => r._cb.checked).length;
    okBtnLabel.textContent = n ? `Import ${n}` : 'Import';
  };
  for (const it of items) { const r = row(it, count, { looking: toLookUp.includes(it.key) }); rows.set(it.key, r); list.append(r); }
  count();
  const dataCb = h('input', { type: 'checkbox', checked: true });
  const dataBox = h('label.check', { style: { margin: 0 } }, dataCb, h('span', null, firefox ? 'Bring their settings too' : 'Bring their settings too (best with the other browser closed)'));
  const showData = () => { dataBox.hidden = ![...rows.values()].some((r) => r._item.hasData && installable(r._item)); };
  showData();
  const status = h('p.ix-status', { hidden: !toLookUp.length }, h('span.ix-spin'), `Looking for ${toLookUp.length === 1 ? 'one add-on' : toLookUp.length + ' add-ons'} on the Chrome Web Store…`);
  const all = h('button.link-btn', { type: 'button', onclick: (e) => { e.preventDefault(); const on = ![...rows.values()].some((r) => r._cb.checked && !r._cb.disabled); for (const r of rows.values()) if (!r._cb.disabled) r._cb.checked = on; count(); } }, 'Select all / none');
  const body = h('div.ix', null,
    h('p', { style: { margin: '0 0 10px' } }, firefox
      ? 'Firefox add-ons can’t run in Bifrost as they are, so each one comes over as its Chrome version, from the Chrome Web Store, and brings its settings with it where it can. Your Firefox profile isn’t changed.'
      : 'Web Store extensions are copied over and keep updating from the Web Store. Unpacked ones load from their folder.'),
    status,
    list,
    h('div.ix-foot', null, all, dataBox));

  // The add-ons that weren't recognized: look for them on the Chrome Web Store while the list is open.
  if (toLookUp.length) {
    wb.invoke('import:extensions-lookup', source.id, toLookUp).then((res) => {
      for (const it of (res && res.items) || []) {
        const old = rows.get(it.key);
        if (!old || !old.isConnected) continue;
        const r = row(it, count);
        old.replaceWith(r);
        rows.set(it.key, r);
      }
    }).catch(() => { /* leave them as they are */ }).finally(() => {
      for (const [key, old] of rows) if (old.classList.contains('looking')) { const r = row(old._item, count); old.replaceWith(r); rows.set(key, r); }
      status.hidden = true;
      count();
      showData();
    });
  }

  const go = await dialog({
    title: 'Import extensions from ' + source.name, iconName: 'puzzle', width: 640, className: 'ix-dialog', body,
    buttons: [{ label: 'Cancel', value: false }, { label: okBtnLabel, value: true, primary: true }],
  });
  if (!go) return null;
  const picked = [...rows.values()].filter((r) => r._cb.checked);
  const keys = picked.map((r) => r._item.key);
  if (!keys.length) return null;
  const withData = !dataBox.hidden && dataCb.checked;
  const t = toast({ text: `Importing ${keys.length} extension${keys.length === 1 ? '' : 's'}…`, iconName: 'puzzle', timeout: 120000 });
  let res;
  try { res = await wb.invoke('import:extensions-run', source.id, keys, { data: withData }); } catch (e) { if (t) t.dismiss(); toast({ text: 'Import failed: ' + e.message, iconName: 'warn' }); return null; }
  if (t) t.dismiss();
  const failed = res.results.filter((r) => !r.ok);
  const withSettings = res.results.filter((r) => r.ok && r.data).length;
  if (!failed.length) toast({ text: `Imported ${res.ok} extension${res.ok === 1 ? '' : 's'}` + (withSettings ? ` (${withSettings} with ${withSettings === 1 ? 'its' : 'their'} settings)` : ''), iconName: 'check', timeout: 5000 });
  else {
    const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
    await dialog({
      title: res.ok ? `Imported ${res.ok}, ${failed.length} didn’t work` : 'The extensions couldn’t be imported', iconName: 'warn',
      body: h('ul.ix-fail', null, failed.map((f) => {
        const it = byKey[f.key] || {};
        return h('li', null, h('b', null, it.name || f.name || f.key), ': ', f.error || 'failed',
          it.searchUrl ? h('button.link-btn', { type: 'button', onclick: () => open(it.searchUrl) }, ' Search the Web Store') : null);
      })),
      buttons: [{ label: 'OK', value: true, primary: true }],
    });
  }
  return res;
}

// "Import from another browser…": a menu of the browsers found on this computer, then the picker.
export async function importExtensionsMenu(anchor) {
  let sources = [];
  try { sources = await wb.invoke('import:detect'); } catch { /* none */ }
  const pickFolder = async () => {
    try { const src = await wb.invoke('import:pick-folder'); if (src) importExtensionsDialog(src.id); } catch (e) { toast({ text: e.message, iconName: 'warn' }); }
  };
  showMenu([
    { type: 'header', label: 'Import extensions from' },
    ...(sources.length ? sources.map((s) => ({ label: s.name, icon: s.kind === 'firefox' ? 'globe' : 'compass', action: () => importExtensionsDialog(s.id) })) : [{ label: 'No other browsers found', disabled: true }]),
    '-',
    { label: 'A profile folder…', icon: 'folderOpen', action: pickFolder },
  ], { anchor, side: 'bottom', align: 'start' });
}
