// Bifrost — first run: pick a look, bring bookmarks and history over, set a few preferences.
import { boot, wb, h, icon, get, set, switchEl, toast, animate } from '/_/common/page.js';
import { importExtensionsDialog } from '/_/common/import-extensions.js';

const THEMES = window.WBThemes.THEMES;
const PICKS = ['mocha', 'macchiato', 'tokyonight', 'rosepine', 'nord', 'latte', 'oled', 'auto'];
let step = 0;
let stage;

function themeCard(key) {
  const t = key === 'auto' ? null : THEMES[key];
  const prev = t
    ? h('div.w-prev', { style: { background: t.mantle } }, h('i', { style: { background: t.accent } }), h('div', { style: { background: t.base } }, h('b', { style: { background: t.text } }), h('b', { style: { background: t.overlay } })))
    : h('div.w-prev.auto');
  const b = h('button.w-theme' + (get('appearance.theme') === key ? '.on' : ''), { type: 'button', onclick: () => { set('appearance.theme', key); for (const x of b.parentElement.children) x.classList.toggle('on', x === b); } },
    prev, h('span', null, t ? t.name : 'Match the system'));
  return b;
}

function layoutCard(value, title, sub) {
  const pic = value === 'vertical'
    ? h('div.w-lay.v', null, h('div.side', null, h('i'), h('i'), h('i')), h('div.main'))
    : h('div.w-lay.h', null, h('div.top', null, h('i'), h('i'), h('i')), h('div.main'));
  const b = h('button.w-layout' + (get('appearance.tabLayout') === value ? '.on' : ''), { type: 'button', onclick: () => { set('appearance.tabLayout', value); for (const x of b.parentElement.children) x.classList.toggle('on', x === b); } },
    pic, h('b', null, title), h('small', null, sub));
  return b;
}

// Bifrost on another computer already: sync through the same cloud folder brings everything over.
function syncStep() {
  const box = h('div.w-imports');
  const status = h('p.muted.w-sync-status');
  const on = async (folder) => {
    await set('sync.folder', folder);
    await set('sync.enabled', true);
    draw();
  };
  const draw = async () => {
    const [info, found] = await Promise.all([wb.invoke('sync:info').catch(() => null), wb.invoke('sync:suggest').catch(() => [])]);
    if (info && info.enabled) {
      const names = (info.devices || []).map((d) => d.name);
      box.replaceChildren(h('div.w-import', null, h('span.w-src', null, icon('sync')), h('div', null, h('b', null, 'Sync is on'), h('small', null, info.folder)),
        h('button.btn.small', { type: 'button', onclick: async () => { await set('sync.enabled', false); draw(); } }, 'Turn off')));
      status.textContent = info.state === 'error' ? info.error : names.length ? `Bookmarks, history, open tabs and settings came over from ${names.join(', ')}.` : 'Nothing from another computer in that folder yet: turn on sync there with the same folder.';
      return;
    }
    status.textContent = '';
    box.replaceChildren(...found.map((x) => h('div.w-import', null, h('span.w-src', null, icon('cloud')), h('div', null, h('b', null, x.name), h('small', null, x.path)),
      h('button.btn.small.primary', { type: 'button', onclick: () => on(x.path) }, icon('sync'), 'Sync with this'))),
      h('div.btn-row', null, h('button.btn.small', { type: 'button', onclick: async () => { const p = await wb.invoke('settings:pick-folder', 'Choose the folder Bifrost syncs through on your other computer'); if (p) on(p); } }, icon('folderOpen'), found.length ? 'Another folder…' : 'Choose a folder…')));
  };
  draw();
  const off = wb.on('sync-changed', () => { if (document.body.contains(box)) draw(); else if (off) off(); });
  return h('div.w-step', null, h('h2', null, 'Using Bifrost on another computer?'),
    h('p.muted', null, 'Sync keeps your bookmarks, history, open tabs and settings the same on your computers, through a folder that OneDrive, Google Drive, Dropbox or iCloud keeps the same on each. Choose the one you chose there. If not, just go on.'),
    box, status);
}

const STEPS = [
  () => h('div.w-step.center', null,
    h('img.w-logo', { src: '/_/assets/icons/icon-256.png', alt: '' }),
    h('h1', null, 'Welcome to Bifrost'),
    h('p.lead', null, 'A browser built around a launcher. Press ', h('kbd', null, 'Ctrl+T'), ' or ', h('kbd', null, 'Ctrl+Space'), ' and type: your bookmarks, open tabs, history and the web, ranked the way you like.'),
    h('button.btn.primary.big', { type: 'button', onclick: () => go(1) }, 'Get started', icon('chevronRight'))),
  syncStep,
  () => h('div.w-step', null,
    h('h2', null, 'Pick a look'),
    h('p.muted', null, 'You can change everything later in Settings → Appearance, including your own colors.'),
    h('div.w-themes', null, PICKS.map(themeCard)),
    h('h3', null, 'Where should tabs go?'),
    h('div.w-layouts', null, layoutCard('vertical', 'In a sidebar', 'Room for long titles, groups and spaces'), layoutCard('horizontal', 'Across the top', 'Classic tabs, more room for pages'))),
  async () => {
    const box = h('div.w-imports', null, h('p.muted', null, 'Looking for other browsers…'));
    const el = h('div.w-step', null, h('h2', null, 'Bring your bookmarks, history and extensions'), h('p.muted', null, 'Nothing is changed in the other browser.'), box,
      h('div.btn-row', null,
        h('button.btn.small', { type: 'button', onclick: async () => { try { const r = await wb.invoke('import:folder', {}); if (r) toast({ text: `Imported ${r.bookmarks} bookmarks and ${r.history} history entries`, iconName: 'check' }); } catch (e) { toast({ text: e.message, iconName: 'warn' }); } } }, icon('folderOpen'), 'A portable browser’s profile folder…'),
        h('button.btn.small', { type: 'button', onclick: async () => { try { const r = await wb.invoke('import:html'); if (r) toast({ text: `Imported ${r.bookmarks} bookmarks`, iconName: 'check' }); } catch (e) { toast({ text: e.message, iconName: 'warn' }); } } }, icon('file'), 'A bookmarks file…')));
    wb.invoke('import:detect').then((list) => {
      if (!list.length) { box.replaceChildren(h('p.muted', null, 'No other browsers found here.')); return; }
      box.replaceChildren(...list.map((src) => {
        const btn = h('button.btn.small.primary', { type: 'button' }, icon('import'), 'Import');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Importing…';
          try {
            const r = await wb.invoke('import:run', src.id, { bookmarks: true, history: true });
            btn.replaceChildren(icon('check'), `${r.bookmarks} bookmarks · ${r.history} pages`);
            btn.classList.remove('primary');
          } catch (e) { btn.disabled = false; btn.replaceChildren(icon('import'), 'Import'); toast({ text: e.message, iconName: 'warn' }); }
        });
        const ext = h('button.btn.small', { type: 'button', title: 'Pick extensions to bring over', onclick: () => importExtensionsDialog(src.id) }, icon('puzzle'), 'Extensions…');
        return h('div.w-import', null, h('span.w-src', null, icon(src.kind === 'firefox' ? 'globe' : 'compass')), h('div', null, h('b', null, src.name), h('small', null, src.path)), ext, btn);
      }));
    }).catch(() => box.replaceChildren(h('p.muted', null, 'Couldn’t look for other browsers.')));
    return el;
  },
  () => {
    const row = (label, sub, path) => h('div.srow', null, h('div.srow-label', null, h('b', null, label), h('small', null, sub)), switchEl(get(path), (v) => set(path, v)));
    const def = h('button.btn', { type: 'button', onclick: async () => {
      const r = await wb.invoke('app:make-default').catch((e) => ({ error: e.message }));
      if (r && r.error) toast({ text: r.error, iconName: 'warn' });
      else { def.replaceChildren(icon('check'), r && r.manual ? 'Pick Bifrost in the window that opened' : 'Done'); def.disabled = true; }
    } }, 'Make Bifrost my default browser');
    return h('div.w-step', null, h('h2', null, 'A few choices'),
      h('div.card', null,
        row('Block ads and trackers', 'Built in, with uBlock Origin’s filter lists.', 'privacy.adblock.enabled'),
        row('Ctrl+T opens the launcher', 'Search first; what you pick opens in a new tab.', 'tabs.newTabOpensLauncher'),
        row('Vim keys', 'For keyboard people: j/k scroll, f clicks links, ? lists the rest. Sites with their own shortcuts (YouTube, Gmail…) keep theirs.', 'keyboard.vim.enabled'),
        row('Animations', 'Each one can also be turned off on its own in Settings.', 'animations.enabled')),
      def);
  },
  () => h('div.w-step.center', null,
    h('h2', null, 'You’re set'),
    h('div.w-tips', null, [
      ['Ctrl+T', 'Search and open'], ['Ctrl+Shift+P', 'Every command'], ['Ctrl+Shift+\\', 'Split view'], ['Alt+1–9', 'Switch spaces'],
      ['Ctrl+Shift+T', 'Bring back a closed tab'], ['F4', 'Collapse the sidebar'],
    ].map(([k, l]) => h('div.w-tip', null, h('kbd', null, k), h('span', null, l)))),
    h('button.btn.primary.big', { type: 'button', onclick: finish }, 'Start browsing', icon('chevronRight'))),
];

async function go(n) {
  step = Math.max(0, Math.min(STEPS.length - 1, n));
  const el = await STEPS[step]();
  const dots = h('div.w-dots', null, STEPS.map((_, i) => h('span' + (i === step ? '.on' : ''))));
  const nav = step > 0 && step < STEPS.length - 1 ? h('div.w-nav', null,
    h('button.btn', { type: 'button', onclick: () => go(step - 1) }, icon('chevronLeft'), 'Back'),
    dots,
    h('button.btn.primary', { type: 'button', onclick: () => go(step + 1) }, 'Next', icon('chevronRight'))) : h('div.w-nav.solo', null, dots);
  stage.replaceChildren(el, nav);
  animate(el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' }, 'newTabPage');
}

async function finish() {
  await set('onboarding.done', true);
  location.href = 'bifrost://newtab/';
}

await boot({ title: 'Welcome to Bifrost' });
stage = h('main.w');
document.body.append(h('div#w-bg'), stage);
go(0);
