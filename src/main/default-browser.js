'use strict';
// Registering as a browser: Windows "Default apps" capabilities (per user, no admin), Start menu and
// desktop shortcuts, and a .desktop entry on Linux.
const { app, shell } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const NAME = 'Bifrost';
const PROGID = 'BifrostHTML';
const AUMID = 'Bifrost.Browser';

function reg(args) {
  return execFileSync('reg.exe', args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function regAdd(key, name, value) {
  const args = ['add', key, '/f', '/t', 'REG_SZ', '/d', value];
  if (name === null) args.splice(2, 0, '/ve'); else args.splice(2, 0, '/v', name);
  reg(args);
}

function exe() { return app.getPath('exe'); }

function isDefault() {
  try {
    if (process.platform === 'win32') {
      const out = reg(['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
      return out.includes(PROGID);
    }
    if (process.platform === 'linux') {
      const out = execFileSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8' });
      return /bifrost/i.test(out);
    }
    return app.isDefaultProtocolClient('https');
  } catch { return false; }
}

function registerWindows() {
  const e = exe();
  const quoted = `"${e}"`;
  const base = `HKCU\\Software\\Clients\\StartMenuInternet\\${NAME}`;
  regAdd(base, null, NAME);
  regAdd(`${base}\\Capabilities`, 'ApplicationName', NAME);
  regAdd(`${base}\\Capabilities`, 'ApplicationDescription', 'A fast, customizable browser');
  regAdd(`${base}\\Capabilities`, 'ApplicationIcon', `${quoted},0`);
  for (const proto of ['http', 'https', 'ftp']) regAdd(`${base}\\Capabilities\\URLAssociations`, proto, PROGID);
  for (const ext of ['.htm', '.html', '.shtml', '.xhtml', '.svg', '.webp', '.pdf']) regAdd(`${base}\\Capabilities\\FileAssociations`, ext, PROGID);
  regAdd(`${base}\\Capabilities\\StartMenu`, 'StartMenuInternet', NAME);
  regAdd(`${base}\\DefaultIcon`, null, `${quoted},0`);
  regAdd(`${base}\\shell\\open\\command`, null, quoted);
  const cls = `HKCU\\Software\\Classes\\${PROGID}`;
  regAdd(cls, null, `${NAME} HTML Document`);
  regAdd(cls, 'AppUserModelId', AUMID);
  regAdd(`${cls}\\Application`, 'ApplicationName', NAME);
  regAdd(`${cls}\\Application`, 'ApplicationIcon', `${quoted},0`);
  regAdd(`${cls}\\Application`, 'AppUserModelId', AUMID);
  regAdd(`${cls}\\DefaultIcon`, null, `${quoted},0`);
  regAdd(`${cls}\\shell\\open\\command`, null, `${quoted} --single-argument %1`);
  regAdd('HKCU\\Software\\RegisteredApplications', NAME, `Software\\Clients\\StartMenuInternet\\${NAME}\\Capabilities`);
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
  if (process.platform === 'win32') {
    registerWindows();
    // Windows lets only the user pick the default; open the Default apps page for this browser.
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${NAME}`).catch(() => shell.openExternal('ms-settings:defaultapps'));
    return { opened: 'settings' };
  }
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bifrost.desktop'), desktopEntry());
    try { execFileSync('xdg-settings', ['set', 'default-web-browser', 'bifrost.desktop']); } catch { /* not available */ }
    try { execFileSync('xdg-mime', ['default', 'bifrost.desktop', 'x-scheme-handler/http', 'x-scheme-handler/https', 'text/html']); } catch { /* not available */ }
    return { done: isDefault() };
  }
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  return { done: isDefault() };
}

function installShortcuts({ desktop = true, startMenu = true } = {}) {
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
    registerWindows();
  } else if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'bifrost.desktop');
    fs.writeFileSync(p, desktopEntry());
    made.push(p);
  }
  return made;
}

module.exports = { isDefault, makeDefault, installShortcuts };
