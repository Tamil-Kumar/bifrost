// Bifrost — About: versions, profile location, default browser, licenses.
import { boot, wb, h, icon, toast, openUrl } from '/_/common/page.js';

await boot({ title: 'About Bifrost' });
const info = await wb.invoke('app:info');
const logo = h('img.about-logo', { src: '/_/assets/icons/icon-256.png', alt: '' });
const defaultRow = h('div');

async function drawDefault() {
  const i = await wb.invoke('app:info');
  defaultRow.replaceChildren(i.isDefault
    ? h('span.chip.ok', null, icon('check'), 'Bifrost is your default browser')
    : h('button.btn.primary', { type: 'button', onclick: async () => {
      const r = await wb.invoke('app:make-default').catch((e) => ({ error: e.message }));
      if (r && r.error) toast({ text: r.error, iconName: 'warn' });
      else if (r && r.manual) toast({ text: 'Pick Bifrost in the Default apps window that opened', iconName: 'info', timeout: 7000 });
      setTimeout(drawDefault, 1500);
    } }, 'Make Bifrost the default browser'));
}

function drmText(d) {
  if (!d || !d.available) return 'None in this build (official Electron)';
  if (d.status === 'ready') return `Widevine ${d.version || ''}`.trim();
  if (d.status === 'error') return 'Widevine isn’t in yet: ' + d.error;
  return 'Widevine is downloading…';
}

const LICENSES = [
  ['Electron and Chromium', 'MIT and BSD-style licenses', 'https://github.com/electron/electron/blob/main/LICENSE'],
  ['castlabs Electron for Content Security', 'MIT (Electron with Widevine, which Google’s component updater fetches)', 'https://github.com/castlabs/electron-releases'],
  ['electron-chrome-extensions', 'GPL-3.0 — which is why Bifrost is GPL-3.0 too', 'https://github.com/samuelmaddock/electron-browser-shell'],
  ['electron-chrome-web-store', 'MIT', 'https://github.com/samuelmaddock/electron-browser-shell'],
  ['Ghostery adblocker', 'MPL-2.0 (filter lists: EasyList, EasyPrivacy, uBlock Origin — GPL-3.0 / CC BY-SA)', 'https://github.com/ghostery/adblocker'],
  ['Mozilla Readability', 'Apache-2.0', 'https://github.com/mozilla/readability'],
  ['Catppuccin palettes', 'MIT', 'https://github.com/catppuccin/catppuccin'],
];

document.body.append(h('div.pg.about', null,
  h('div.about-hero', null, logo,
    h('div', null, h('h1', null, 'Bifrost'), h('p.muted', null, `Version ${info.version}`), defaultRow)),
  h('div.card', null,
    ...[
      ['Chromium', info.chrome], ['Electron', info.electron], ['Node.js', info.node], ['V8', info.v8],
      ['Protected content (DRM)', drmText(info.drm)],
      ['System', `${info.platform} · ${info.arch}`], ['Profile', info.profile.dir + (info.profile.portable ? '  (portable)' : '')],
      ['Program', info.exe], ['User agent', info.userAgent],
    ].map(([k, v]) => h('div.srow', null, h('div.srow-label', null, h('b', null, k)), h('div.srow-ctl.about-val', null, h('code', null, v))))),
  h('div.btn-row', { style: { margin: '6px 0 26px' } },
    h('button.btn', { type: 'button', onclick: () => wb.invoke('app:open-path', 'profile') }, icon('folderOpen'), 'Open the profile folder'),
    h('button.btn', { type: 'button', onclick: () => navigator.clipboard.writeText(`Bifrost ${info.version} (Chromium ${info.chrome}, Electron ${info.electron}, ${info.platform} ${info.arch})`).then(() => toast({ text: 'Copied', iconName: 'check', timeout: 1500 })) }, icon('copy'), 'Copy version info')),
  h('div.card-title', null, 'Open-source software'),
  h('div.card', null, LICENSES.map(([name, lic, url]) => h('div.srow', null, h('div.srow-label', null, h('b', null, name), h('small', null, lic)),
    h('div.srow-ctl', null, h('button.icon-btn', { type: 'button', title: url, onclick: () => openUrl(url, { background: false }) }, icon('external')))))),
  h('p.muted.small', null, 'Bifrost is free software under the GNU General Public License, version 3 or later.')));
drawDefault();
