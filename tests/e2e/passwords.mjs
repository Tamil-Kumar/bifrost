// Passwords with Bitwarden, end to end: its toolbar popup signs in to a server (a stand-in one on this
// computer, tests/fixtures/bitwarden-server.mjs) and shows the vault, then it fills sign-in forms from
// the popup, its shortcut, its menu in the field and the page's right-click menu, offers to save a new
// login (which arrives at the server encrypted, the way Bitwarden stores it), copies a password, and
// after a restart is locked until the master password is entered. Real pointer and keyboard throughout.
//
// Needs the Bitwarden extension unpacked in /home/claude/cache/exts/bitwarden (its Chrome build from
// github.com/bitwarden/clients releases, dist-chrome-<version>.zip).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, startSite, reporter, assert, sleep, xinput } from './lib.mjs';
import { startBitwarden } from '../fixtures/bitwarden-server.mjs';

const BW_DIR = process.env.BITWARDEN || '/home/claude/cache/exts/bitwarden';
const R = reporter('passwords');
if (!fs.existsSync(path.join(BW_DIR, 'manifest.json'))) { console.log('passwords: Bitwarden isn’t in ' + BW_DIR + ' (skipped)'); process.exit(0); }

const tlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-bw-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tlsDir, 'key.pem'), '-out', path.join(tlsDir, 'cert.pem'), '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
const bw = await startBitwarden({ logins: [{ name: 'Example login', username: 'tamil', password: 'hunter2!', uri: 'http://login.example.com/' }], tls: { key: fs.readFileSync(path.join(tlsDir, 'key.pem')), cert: fs.readFileSync(path.join(tlsDir, 'cert.pem')) } });
const form = (title, action) => `<!doctype html><html lang=en><meta charset=utf-8><title>${title}</title><body style="font:16px sans-serif;margin:40px"><h1>${title}</h1><form id=f action="${action}" method=post><p><label>Username <input id=user name=username autocomplete=username></label></p><p><label>Password <input id=pass name=password type=password autocomplete=current-password></label></p><p><button id=go type=submit>Sign in</button></p></form><p style="margin-top:300px">(the page)</p></body></html>`;
const page = (body, title) => (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body.replace ? body : String(body)); };
const site = await startSite(undefined, { routes: {
  '/login.html': page(form('Example sign-in', '/welcome.html')),
  '/signup.html': page(form('Shop sign-in', '/welcome.html')),
  '/welcome.html': page('<!doctype html><html lang=en><title>Welcome</title><h1 style="font:28px sans-serif;margin:40px">Welcome</h1></html>'),
} });
const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const ARGS = [site.url + '/a.html', `--host-resolver-rules=MAP login.example.com 127.0.0.1:${site.port},MAP shop.example.org 127.0.0.1:${site.port}`, '--ignore-certificate-errors'];
let t = await launch({ profile: 'passwords', args: ARGS, env: NO_PROXY });
const x = xinput();
let id = null;

// ------------------------------------------------------------------------------------------------- helpers
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 300) + ')' : ''));
};
const open = (url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url }), url);
const view = () => t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y }; });
// Runs code in Bitwarden's popup (when it's open).
const popup = (code) => t.main(async ({ webContents }, [id, code]) => {
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(`chrome-extension://${id}/popup/`));
  return wc ? wc.executeJavaScript(code, true) : null;
}, [id, code]);
const popupOpen = () => t.main(({ webContents }, id) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getURL().startsWith(`chrome-extension://${id}/popup/`)), id);
const popupText = () => popup('document.body ? document.body.innerText.replace(/\\s+/g, " ") : ""');
const popupClick = (label) => popup(`(() => { const want = ${JSON.stringify(label.toLowerCase())}; const b = [...document.querySelectorAll('button, a, [role=button], [role=option]')].filter((e) => e.getClientRects().length).find((e) => { const s = (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().toLowerCase(); return s === want || s.startsWith(want); }); if (!b) return false; b.click(); return true; })()`);
// A press on something in the popup with the real pointer (its view's place in the window, plus the
// element's place in it).
const popupPress = async (label) => {
  // (Where it is once it has stopped moving: Bitwarden's dialogs slide in from below.)
  const where = () => popup(`(() => { const want = ${JSON.stringify(label.toLowerCase())}; const b = [...document.querySelectorAll('button, a, [role=button], [role=option]')].filter((e) => e.getClientRects().length).find((e) => { const s = (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().toLowerCase(); return s === want || s.startsWith(want); }); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const q = b.getBoundingClientRect(); if (q.bottom > innerHeight || q.right > innerWidth || q.top < 0 || q.left < 0) return null; return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  const a = await where();
  if (!a) return false;
  await sleep(200);
  const r = await where();
  if (!r || Math.abs(r.x - a.x) > 1 || Math.abs(r.y - a.y) > 1) return false;
  const v = await t.main(() => { const p = [...(global.__bifrostPopups || [])].find((y) => y.visible); return p ? p.view.getBounds() : null; });
  if (!v) return false;
  await x.click(Math.round(v.x + r.x), Math.round(v.y + r.y));
  return true;
};
const popupType = (sel, v) => popup(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const step = async (what, fn) => {
  try { return await until(fn, 8000, what); } catch (e) {
    const txt = await popupText().catch(() => '');
    const btns = await popup(`[...document.querySelectorAll('button, a, [role=button], [role=option]')].filter((e) => e.getClientRects().length).map((e) => (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().replace(/\\s+/g, ' ').slice(0, 30)).join(' | ')`).catch(() => '');
    throw new Error(e.message + ' — popup: ' + String(txt).slice(0, 300) + ' — buttons: ' + btns);
  }
};
const toolbarButton = () => t.until((id) => { const el = document.querySelector(`#ext-actions [data-ext="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, id, 8000, 'Bitwarden’s toolbar button');
const openPopup = async () => {
  const b = await toolbarButton();
  await x.click(Math.round(b.x), Math.round(b.y));
  await until(popupOpen, 8000, 'the popup');
  await until(async () => (await popupText()).length > 20, 8000, 'the popup to draw');
};
const closePopup = async () => { if (await popupOpen()) { await x.key('Escape'); await until(async () => !(await popupOpen()), 4000, 'the popup to close'); } };
// Where the frames of Bitwarden's inside a page are (they sit in closed shadow roots, so through the
// DevTools protocol): [{ x, y, w, h }] in the page.
const extFrameRect = (pageMatch, frameRe) => t.main(async ({ webContents }, [pageMatch, src]) => {
  const re = new RegExp(src);
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().includes(pageMatch));
  if (!wc) return null;
  const dbg = wc.debugger;
  const mine = !dbg.isAttached();
  if (mine) dbg.attach('1.3');
  try {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const found = [];
    const walk = (n) => {
      if (!n) return;
      if (n.nodeName === 'IFRAME') { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === 'src' && re.test(a[i + 1])) found.push(n); }
      for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c);
    };
    walk(root);
    const boxes = [];
    for (const n of found) {
      try { const { model } = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId: n.backendNodeId }); boxes.push({ x: model.content[0], y: model.content[1], w: model.width, h: model.height }); } catch { /* not laid out */ }
    }
    return boxes;
  } catch { return null; } finally { if (mine) dbg.detach(); }
}, [pageMatch, frameRe.source]);
const inFrame = (pageMatch, frameRe, code) => t.main(async ({ webContents }, [pageMatch, src, code]) => {
  const re = new RegExp(src);
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'webview' && w.getURL().includes(pageMatch));
  const f = wc && wc.mainFrame.framesInSubtree.find((y) => re.test(y.url));
  return f ? f.executeJavaScript(code) : null;
}, [pageMatch, frameRe.source, code]);
const fields = (match) => t.guest(match, '({ user: document.getElementById("user").value, pass: document.getElementById("pass").value })');
const clearFields = (match) => t.guest(match, 'document.getElementById("user").value = ""; document.getElementById("pass").value = ""; document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1');
const posIn = (match, sel) => t.guest(match, `(() => { const e = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: e.x + 12, y: e.y + e.height / 2, h: e.height }; })()`);
const swErrors = async () => (await t.main(() => global.__swlogs.slice())).filter((l) => /TypeError|is not a function|is not defined|Cannot read prop/.test(l) && !/Failed to fetch|NetworkError|ERR_/.test(l));
const loginPage = async () => {
  await open('http://login.example.com/login.html');
  await until(async () => (await t.guest('login.example.com/login.html', 'document.readyState')) === 'complete', 6000, 'the sign-in page');
  await sleep(1500);   // (Bitwarden looks at the page's fields as it settles)
};

try {
  await sleep(1500);

  await R.step('Bitwarden installs, and its background starts without missing anything', async () => {
    id = await t.main(async (_, dir) => {
      const B = global.__bifrost;
      await B.extensions.ready;
      global.__swlogs = [];
      B.extensions.ses.serviceWorkers.on('console-message', (e, d) => global.__swlogs.push(`[${d.level}] ${String(d.message).slice(0, 300)}`));
      return (await B.extensions.loadUnpacked(dir)).id;
    }, BW_DIR);
    await sleep(5000);
    const errs = await swErrors();
    assert(!errs.length, 'its background: ' + errs.slice(0, 4).join(' | '));
    await t.main((_, id) => global.__bifrost.settings.set('extensions.pinned', [id]), id);
  });

  await R.step('its toolbar popup signs in to your own server and shows the vault', async () => {
    await open(site.url + '/b.html');
    await sleep(800);
    await openPopup();
    // All of it: Bitwarden lays itself out for the height it finds as it opens (it once found 25 pixels
    // and drew itself 240 high, cut off).
    const size = await until(() => popup('({ w: innerWidth, h: innerHeight, cls: document.documentElement.className })').then((z) => (z && z.h >= 590 && z.w >= 380 && z.w <= 600 ? z : null)), 6000, 'the popup at its full size');
    assert(!/body-(sm|xs|xxs|3xs)/.test(size.cls), 'Bitwarden chose a small layout: ' + size.cls);
    if (/Log in/.test(await popupText()) && !(await popup('!!document.querySelector("#email")'))) {
      await sleep(3000);   // (a person reads the welcome first; Bitwarden is still setting itself up)
      await step('Log in', () => popupPress('Log in'));
    }
    await step('the server menu', () => popupPress('bitwarden.com'));
    await step('Self-hosted', () => popupPress('self-hosted'));
    await step('the server address', () => popupType('#self_hosted_env_settings_form_input_base_url', bw.url));
    await step('Save', () => popupPress('Save'));
    await step('the server to be set', async () => /Accessing: self-hosted/i.test(await popupText()));
    await step('the email', () => popupType('#email', bw.email));
    await step('Continue', () => popupPress('Continue'));
    await step('the master password', () => popupType('#masterPassword', bw.password));
    await step('Log in', () => popupPress('Log in'));
    await until(async () => /All items\s*1\b/.test(await popupText()) && /Example login/.test(await popupText()), 20000, 'the vault');
    assert(bw.requests.includes('POST /identity/connect/token') && bw.requests.includes('GET /api/sync'), 'requests: ' + bw.requests.join(', '));
    await closePopup();
  });

  await R.step('on a sign-in page, its menu on the username field fills the form', async () => {
    await loginPage();
    const v = await view();
    const u = await posIn('login.example.com/login.html', '#user');
    await x.click(Math.round(v.x + u.x), Math.round(v.y + u.y));
    // Its list under the field: a frame of Bitwarden's in the page (Bitwarden ignores clicks on it for a
    // moment after it appears, against click-jacking).
    const fieldBox = await t.guest('login.example.com/login.html', '(() => { const r = document.getElementById("user").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
    // (The one just under the field: Bitwarden keeps others, unplaced, around.)
    const list = await until(() => extFrameRect('login.example.com/login.html', /overlay\/menu\.html/).then((boxes) => (boxes || []).find((r) => r.h > 30 && r.h < 400 && r.y >= fieldBox.y + fieldBox.h - 6 && r.y <= fieldBox.y + fieldBox.h + 60 && Math.abs(r.x - fieldBox.x) < 80)), 8000, 'Bitwarden’s list under the field');
    await sleep(1200);
    await t.shot('passwords-inline-menu');
    const at = { x: Math.round(v.x + list.x + Math.min(120, list.w / 3)), y: Math.round(v.y + list.y + Math.min(32, list.h / 2)) };
    await x.click(at.x, at.y);
    await until(async () => { const f = await fields('login.example.com/login.html'); return f.user === 'tamil' && f.pass === 'hunter2!' ? f : null; }, 6000, 'the form to be filled');
  });

  await R.step('the page’s right-click menu: Bitwarden → Autofill login fills it; Copy password copies it', async () => {
    await clearFields('login.example.com/login.html');
    const v = await view();
    // (Where it is once the menu has finished opening: it grows from the pointer.)
    const menuItem = async (re) => {
      const at = () => t.ui((src) => { const it = [...document.querySelectorAll('.menu .menu-item')].reverse().find((e) => e.getClientRects().length && new RegExp(src, 'i').test(e.textContent.trim())); if (!it) return null; const q = it.getBoundingClientRect(); return { x: q.x + 40, y: q.y + q.height / 2 }; }, re.source);
      const r = await until(async () => { const a = await at(); if (!a) return null; await sleep(150); const b = await at(); return b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 ? b : null; }, 4000, 'menu item ' + re);
      await x.move(Math.round(r.x), Math.round(r.y)); await sleep(350);
      return r;
    };
    const rightClick = async () => { await x.click(Math.round(v.x + 500), Math.round(v.y + 330), 3); await until(() => t.ui(() => !!document.querySelector('.menu')), 4000, 'the page menu'); };
    await rightClick();
    await menuItem(/^Bitwarden/);
    await menuItem(/^Autofill login/);
    const item = await menuItem(/^Example login/);
    await x.click(Math.round(item.x), Math.round(item.y));
    await until(async () => { const f = await fields('login.example.com/login.html'); return f.user === 'tamil' && f.pass === 'hunter2!' ? f : null; }, 6000, 'the form to be filled');
    await t.main(({ clipboard }) => clipboard.writeText('nothing yet'));
    await rightClick();
    await menuItem(/^Bitwarden/);
    await menuItem(/^Copy password/);
    const item2 = await menuItem(/^Example login/);
    await x.click(Math.round(item2.x), Math.round(item2.y));
    await until(async () => (await t.main(({ clipboard }) => clipboard.readText())) === 'hunter2!', 5000, 'the password on the clipboard');
  });

  await R.step('Ctrl+Shift+L fills it', async () => {
    await clearFields('login.example.com/login.html');
    const v = await view();
    await x.click(Math.round(v.x + 500), Math.round(v.y + 330));   // the page, not a field
    await sleep(400);
    await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('l'); await x.keyUp('Shift_L'); await x.keyUp('Control_L');
    await until(async () => { const f = await fields('login.example.com/login.html'); return f.user === 'tamil' && f.pass === 'hunter2!' ? f : null; }, 6000, 'the form to be filled');
  });

  await R.step('on a sign-in page, the popup suggests the login, and Fill fills the form', async () => {
    await loginPage();
    await openPopup();
    await until(async () => /Autofill suggestions\s*1\b/i.test(await popupText()), 8000, 'the suggestion');
    await step('Fill', () => popupPress('Fill'));
    await until(async () => { const f = await fields('login.example.com/login.html'); return f.user === 'tamil' && f.pass === 'hunter2!' ? f : null; }, 6000, 'the form to be filled');
    await closePopup().catch(() => {});
  });

  await R.step('a new login: after signing in, Bitwarden offers to save it, and Save stores it in the vault, encrypted', async () => {
    await open('http://shop.example.org/signup.html');
    await until(async () => (await t.guest('shop.example.org/signup.html', 'document.readyState')) === 'complete', 6000, 'the page');
    await sleep(1500);
    const v = await view();
    const typeIn = async (sel, text) => {
      const q = await posIn('shop.example.org/signup.html', sel);
      await x.click(Math.round(v.x + q.x), Math.round(v.y + q.y)); await sleep(300);
      await x.key('Escape'); await sleep(150);   // (Bitwarden's own menu on the field)
      for (const ch of text) await x.key(ch);
      await sleep(200);
    };
    await typeIn('#user', 'shopper');
    await typeIn('#pass', 'secret99');
    const go = await posIn('shop.example.org/signup.html', '#go');
    await x.click(Math.round(v.x + go.x), Math.round(v.y + go.y));
    await until(async () => (await t.guest('welcome.html', 'location.href').catch(() => '')).includes('welcome.html'), 6000, 'the next page');
    // The bar, a frame of Bitwarden's inside the page: where its Save button is on screen.
    const saveAt = () => t.main(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('shop.example.org/welcome.html'));
      const f = wc && wc.mainFrame.framesInSubtree.find((y) => /notification\/bar\.html/.test(y.url));
      if (!f) return null;
      const inner = await f.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /^\\s*Save\\s*$/.test(e.innerText)); if (!b || !b.getClientRects().length) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!inner) return null;
      const dbg = wc.debugger;
      const mine = !dbg.isAttached();
      if (mine) dbg.attach('1.3');
      try {
        const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
        let found = null;
        const walk = (n) => {
          if (found || !n) return;
          if (n.nodeName === 'IFRAME') { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === 'src' && /notification\/bar\.html/.test(a[i + 1])) found = n; }
          for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c);
        };
        walk(root);
        if (!found) return null;
        const { model } = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId: found.backendNodeId });
        return { x: model.content[0] + inner.x, y: model.content[1] + inner.y };
      } finally { if (mine) dbg.detach(); }
    });
    // (Once it has slid in.)
    const save = await until(async () => { const a = await saveAt(); if (!a) return null; await sleep(250); const b = await saveAt(); return b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 ? b : null; }, 8000, 'the Save bar');
    await t.shot('passwords-save-bar');
    await x.click(Math.round(v.x + save.x), Math.round(v.y + save.y));
    const item = await until(() => bw.ciphers.map((c) => { try { return bw.read(c); } catch { return null; } }).find((c) => c && c.username === 'shopper'), 8000, 'the new login at the server');
    assert(item.password === 'secret99' && item.uris.some((u) => u.includes('shop.example.org')), 'stored: ' + JSON.stringify(item));
    const raw = bw.ciphers.find((c) => { try { return bw.read(c).username === 'shopper'; } catch { return false; } });
    assert(/^2\./.test(raw.login.password) && !JSON.stringify(raw).includes('secret99'), 'the server got the password unencrypted');
  });

  await R.step('after a restart, the vault is locked until the master password is entered', async () => {
    await t.close();
    t = await launch({ profile: 'passwords', fresh: false, args: ARGS, env: NO_PROXY });
    await sleep(3000);
    await t.main(() => { global.__swlogs = []; global.__bifrost.extensions.ses.serviceWorkers.on('console-message', (e, d) => global.__swlogs.push(`[${d.level}] ${String(d.message).slice(0, 300)}`)); });
    await openPopup();
    await until(async () => /locked/i.test(await popupText()) && (await popup('!!document.querySelector("input[type=password]")')), 10000, 'the lock screen');
    await step('the master password', () => popupType('input[type=password]', bw.password));
    await step('Unlock', () => popupPress('Unlock'));
    await until(async () => /All items\s*2\b/.test(await popupText()), 15000, 'the vault, with both logins');
    await closePopup();
  });
} finally {
  x.close();
  await t.close();
  site.stop();
  bw.stop();
  fs.rmSync(tlsDir, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
