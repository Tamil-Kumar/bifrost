'use strict';
// Registering as a browser: Windows "Default apps" capabilities (per user, no admin), Start menu and
// desktop shortcuts, and a .desktop entry on Linux.
//
// All of it runs other programs (reg.exe, xdg-settings), which takes a moment each: always without waiting
// on them here (a synchronous run holds up everything Bifrost does meanwhile; asking reg.exe whether Bifrost is
// the default made the settings page slow to open).
const { app, shell } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const NAME = 'Bifrost';
const PROGID = 'BifrostHTML';
const AUMID = 'Bifrost.Browser';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: 15000 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
const reg = (args) => run('reg.exe', args);
function regAdd(key, name, value) {
  const args = ['add', key, '/f', '/t', 'REG_SZ', '/d', value];
  if (name === null) args.splice(2, 0, '/ve'); else args.splice(2, 0, '/v', name);
  return reg(args);
}

function exe() { return app.getPath('exe'); }

// Whether Bifrost is the default browser (a promise). The answer is kept a few seconds: the settings, about
// and welcome pages all ask, and one question is enough for all of them.
let known = null, knownAt = 0, asking = null;
function isDefault() {
  if (known !== null && Date.now() - knownAt < 5000) return Promise.resolve(known);
  if (!asking) {
    asking = check()
      .then((v) => { known = v; knownAt = Date.now(); return v; })
      .finally(() => { asking = null; });
  }
  return asking;
}
async function check() {
  try {
    if (process.platform === 'win32') {
      const out = await reg(['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
      return out.includes(PROGID);
    }
    if (process.platform === 'linux') return /bifrost/i.test(await run('xdg-settings', ['get', 'default-web-browser']));
    return app.isDefaultProtocolClient('https');
  } catch { return false; }
}
// (asked again after you change it here)
function forget() { known = null; }

async function registerWindows() {
  const e = exe();
  const quoted = `"${e}"`;
  const base = `HKCU\\Software\\Clients\\StartMenuInternet\\${NAME}`;
  await regAdd(base, null, NAME);
  await regAdd(`${base}\\Capabilities`, 'ApplicationName', NAME);
  await regAdd(`${base}\\Capabilities`, 'ApplicationDescription', 'A fast, customizable browser');
  await regAdd(`${base}\\Capabilities`, 'ApplicationIcon', `${quoted},0`);
  for (const proto of ['http', 'https', 'ftp']) await regAdd(`${base}\\Capabilities\\URLAssociations`, proto, PROGID);
  for (const ext of ['.htm', '.html', '.shtml', '.xhtml', '.svg', '.webp', '.pdf']) await regAdd(`${base}\\Capabilities\\FileAssociations`, ext, PROGID);
  await regAdd(`${base}\\Capabilities\\StartMenu`, 'StartMenuInternet', NAME);
  await regAdd(`${base}\\DefaultIcon`, null, `${quoted},0`);
  await regAdd(`${base}\\shell\\open\\command`, null, quoted);
  const cls = `HKCU\\Software\\Classes\\${PROGID}`;
  await regAdd(cls, null, `${NAME} HTML Document`);
  await regAdd(cls, 'AppUserModelId', AUMID);
  await regAdd(`${cls}\\Application`, 'ApplicationName', NAME);
  await regAdd(`${cls}\\Application`, 'ApplicationIcon', `${quoted},0`);
  await regAdd(`${cls}\\Application`, 'AppUserModelId', AUMID);
  await regAdd(`${cls}\\DefaultIcon`, null, `${quoted},0`);
  await regAdd(`${cls}\\shell\\open\\command`, null, `${quoted} --single-argument %1`);
  await regAdd('HKCU\\Software\\RegisteredApplications', NAME, `Software\\Clients\\StartMenuInternet\\${NAME}\\Capabilities`);
}

function desktopEntry() {
  return `[Desktop Entry]
Version=1.0
Type=Application
Name=${NAME}
GenericName=Web Browser
Comment=A fast, customizable browser
Exec="${exe()}" %U
Icon=${path.join(path.dirname(exe()), 'resources', 'app', 'assets', 'icons', 'icon-256.png')}
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;application/pdf;
StartupWMClass=${NAME}
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=New Window
Exec="${exe()}" --new-window

[Desktop Action new-private-window]
Name=New Private Window
Exec="${exe()}" --private
`;
}

async function makeDefault() {
  forget();
  if (process.platform === 'win32') {
    await registerWindows();
    // Windows lets only the user pick the default; open the Default apps page for this browser.
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${NAME}`).catch(() => shell.openExternal('ms-settings:defaultapps'));
    return { opened: 'settings' };
  }
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bifrost.desktop'), desktopEntry());
    try { await run('xdg-settings', ['set', 'default-web-browser', 'bifrost.desktop']); } catch { /* not available */ }
    try { await run('xdg-mime', ['default', 'bifrost.desktop', 'x-scheme-handler/http', 'x-scheme-handler/https', 'text/html']); } catch { /* not available */ }
    forget();
    return { done: await isDefault() };
  }
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  forget();
  return { done: await isDefault() };
}

async function installShortcuts({ desktop = true, startMenu = true } = {}) {
  const made = [];
  if (process.platform === 'win32') {
    const opts = { target: exe(), appUserModelId: AUMID, icon: exe(), iconIndex: 0, description: 'Bifrost browser' };
    if (startMenu) {
      const p = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`);
      if (shell.writeShortcutLink(p, 'replace', opts)) made.push(p);
    }
    if (desktop) {
      const p = path.join(app.getPath('desktop'), `${NAME}.lnk`);
      if (shell.writeShortcutLink(p, 'replace', opts)) made.push(p);
    }
    await registerWindows();
  } else if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'bifrost.desktop');
    fs.writeFileSync(p, desktopEntry());
    made.push(p);
  }
  return made;
}

// Windows shows an app's notifications only when it knows the app's AppUserModelID: from a Start menu
// shortcut (the installer makes one) or from this registration. Without it they go nowhere, without an
// error (BifrostPortable has no shortcut). Per user, no admin; asked first, so nothing's written when it's
// there already. The uninstaller removes it (tools/win/installer.c).
async function registerAppId() {
  if (process.platform !== 'win32') return false;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
  // (the app's files are a real folder, not an archive, so Windows can read the picture from there)
  const want = { DisplayName: NAME, IconUri: path.join(app.getAppPath(), 'assets', 'icons', 'icon-256.png') };
  let have = '';
  try { have = await reg(['query', key]); } catch { have = ''; }
  let wrote = false;
  for (const [name, value] of Object.entries(want)) {
    const m = have.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*)$`, 'mi'));
    if (m && m[1].trim() === value) continue;
    await regAdd(key, name, value);
    wrote = true;
  }
  return wrote;
}

module.exports = { isDefault, makeDefault, installShortcuts, registerAppId };
