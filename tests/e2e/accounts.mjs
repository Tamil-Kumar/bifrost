// Which Google account Google's sites open with (src/main/google-accounts.js; the rules in
// src/shared/google-accounts.js), against local stand-ins for Google (pointed at a local HTTPS server with
// --host-resolver-rules): accounts.google.com's list of your accounts (ListAccounts, read with your cookies;
// as Google, it answers only Chrome's request, a POST from www.google.com, and a GET with 400; in Chrome's form,
// a base64 protobuf) and pages of Gmail, YouTube, Docs, Drive, Photos and Search that say where they were opened.
//  · Settings → Accounts: not signed in, it says so; signing in (Google's sign-in cookies changing) and the
//    accounts are read again, with your cookies, and shown in Google's order, its default first;
//  · the default account: Google's sites opened from outside Google (typed, another site's link) open with it
//    (authuser: its place among your accounts);
//  · particular sites, set in Settings: another account for one, Google's choice for another, the most
//    specific first; a site that isn't Google's is pointed out;
//  · left alone: links inside Google, a page that says which account, sign-in, a form sent to Google, a
//    private window, an account you aren't signed in to;
//  · signing out of one: the accounts are read again, and the others' places move up;
//  · Google taking authuser out again doesn't send the page round again; before the accounts are read the
//    email goes instead.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { launch, reporter, assert, sleep } from './lib.mjs';

const R = reporter('accounts');
const HOSTS = ['accounts.google.com', 'mail.google.com', 'www.youtube.com', 'docs.google.com', 'drive.google.com', 'www.google.com', 'photos.google.com', 'news.example'];
const tls = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-accounts-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'key.pem'), '-out', path.join(tls, 'cert.pem'), '-days', '2', '-subj', '/CN=accounts.google.com', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });

// Who Google says is signed in (for a request with its sign-in cookie), in its order.
let signedIn = [['Tamil', 'tamil.kumar@gmail.com'], ['Tamil (Purdue)', 'tkumar@purdue.edu']];
const reads = [];            // the cookies each ListAccounts request came with
let hold = null;             // set: ListAccounts answers only when it's called
let served = [];             // 'METHOD https://host/path?query' of every request that reached the server
// Google's list, in the form Chrome asks for (laf=b64bin): base64 of a ListAccountsResponse protobuf, each
// account a message of 2: name, 3: email, 4: photo, 9: valid, 10: id, 15: verified.
const varint = (n) => { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; b.push(x); } while (n); return b; };
const field = (n, v) => typeof v === 'number' ? [...varint(n * 8), ...varint(v)] : (() => { const s = [...Buffer.from(v)]; return [...varint(n * 8 + 2), ...varint(s.length), ...s]; })();
const account = ([name, email]) => [...field(2, name), ...field(3, email), ...field(4, 'https://lh3.googleusercontent.com/a/x'), ...field(9, 1), ...field(10, '1' + email.length + '0000'), ...field(15, 1)];
const listBody = (accounts) => Buffer.from(accounts.flatMap((a) => { const m = account(a); return [...varint(1 * 8 + 2), ...varint(m.length), ...m]; })).toString('base64');
const server = https.createServer({ key: fs.readFileSync(path.join(tls, 'key.pem')), cert: fs.readFileSync(path.join(tls, 'cert.pem')) }, (req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const u = new URL(req.url, 'https://' + host);
  served.push(req.method + ' https://' + host + req.url);
  const send = (status, type, body, headers = {}) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };
  if (host === 'accounts.google.com' && u.pathname === '/ListAccounts') {
    // As Google: only Chrome's request (a POST from www.google.com) gets the list; a GET gets 400.
    if (req.method !== 'POST' || req.headers.origin !== 'https://www.google.com' || u.searchParams.get('laf') !== 'b64bin') {
      reads.push('refused: ' + req.method + ' origin=' + req.headers.origin + ' ' + req.url);
      return send(400, 'text/html; charset=utf-8', '<!DOCTYPE html><title>Error 400 (Bad Request)!!1</title><p><b>400.</b> <ins>That’s an error.</ins>');
    }
    const cookie = String(req.headers.cookie || '');
    reads.push(cookie);
    const answer = () => send(200, 'text/plain; charset=utf-8', listBody(/(^|;\s*)SID=/.test(cookie) ? signedIn : []));
    if (hold) { hold.push(answer); return; }
    return answer();
  }
  // Google taking authuser out again once it has what it needs.
  if (host === 'drive.google.com' && u.searchParams.has('authuser')) {
    u.searchParams.delete('authuser');
    return send(302, 'text/plain', '', { location: u.pathname + u.search });
  }
  const n = u.searchParams.get('n') || '';
  const links = u.pathname === '/links.html'
    ? `<a id=gmail href="https://mail.google.com/?n=${n}-link">Gmail</a><form id=post method=post action="https://www.google.com/search?n=${n}-post"><input name=q value=x></form>`
    : '';
  send(200, 'text/html; charset=utf-8', `<!doctype html><meta charset=utf-8><title>${host}</title><p id=url>${host}${req.url}</p>${links}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const NO_PROXY = { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
const t = await launch({
  profile: 'accounts',
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`, '--ignore-certificate-errors'],
  env: NO_PROXY,
  settings: { onboarding: { done: true } },
});
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 400) + ')' : ''));
};
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const get = (p) => t.main((_, p) => global.__bifrost.settings.get(p), p);
const signIn = (value) => t.main((_, value) => global.__bifrost.mainSession.cookies.set({ url: 'https://accounts.google.com/', domain: '.google.com', path: '/', name: 'SID', value, secure: true }), value);
const known = () => t.main(() => { const g = global.__bifrost.googleAccounts; return g.list ? g.list.map((a) => a.index + ' ' + a.email).join(', ') : null; });

let n = 0;
// Opens url (with n=<k> on it, to find its tab) in a new tab, as from the address bar; its id once it's loaded.
const open = async (url, { privateWindow = false } = {}) => {
  const k = ++n;
  const full = url + (url.includes('?') ? '&' : '?') + 'n=' + k;
  await t.main((_, [url, priv]) => { const ctl = global.__bifrost.registry.list().find((c) => !!c.isPrivate === !!priv); ctl.send('open-url', { url }); }, [full, privateWindow]);
  return until(() => t.main(({ webContents }, k) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && /[?&]n=(\d+)/.exec(w.getURL()) && /[?&]n=(\d+)/.exec(w.getURL())[1] === String(k));
    return wc && !wc.isLoading() ? wc.id : null;
  }, k), 10000, 'the page ' + full);
};
const urlOf = (id) => t.main(({ webContents }, id) => { const w = webContents.fromId(id); return w && !w.isLoading() ? w.getURL() : null; }, id);
// Where a page opened from the address bar ended up.
const landed = async (url, opts) => urlOf(await open(url, opts));
const inTab = (id, js) => t.main(({ webContents }, [id, js]) => webContents.fromId(id).executeJavaScript(js, true), [id, js]);
const settingsPage = (js) => t.guest('bifrost://settings', js);
// Brings Settings' tab to the front (where you'd be typing in it).
const toSettings = async () => {
  await t.main(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings'));
    global.__bifrost.registry.list().find((c) => !c.isPrivate).send('focus-wc', wc.id);
  });
  await sleep(400);
};

try {
  await R.step('Settings → Accounts: not signed in, it says so; signing in, and your accounts are read again (with your cookies), in Google’s order, its default first', async () => {
    await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), 'bifrost://settings/#accounts');
    const text = await until(() => settingsPage("(() => { const b = document.querySelector('.gacc'); return b && /not signed in/.test(b.textContent) ? b.textContent : null; })()"), 10000, 'the accounts, none');
    assert(/You’re not signed in to Google in Bifrost\./.test(text) && /Sign in to Google/.test(text), 'not signed in: ' + text);
    assert(reads.length >= 1 && !/SID=/.test(reads[0]) && !reads.some((r) => r.startsWith('refused')), 'read: ' + JSON.stringify(reads));
    await signIn('one');
    const rows = await until(() => settingsPage("(() => { const r = [...document.querySelectorAll('.gacc-row')]; return r.length === 2 ? r.map((e) => e.textContent) : null; })()"), 8000, 'the accounts, signed in');
    assert(rows[0] === 'TTamiltamil.kumar@gmail.comGoogle’s default' && rows[1] === 'TTamil (Purdue)tkumar@purdue.edu', 'the accounts: ' + JSON.stringify(rows));
    assert(/(^|;\s*)SID=one/.test(reads[reads.length - 1]), 'read without your cookies: ' + reads[reads.length - 1]);
    const box = await settingsPage("[...document.querySelector('.gacc').childNodes].map((n) => n.nodeType === 1 ? n.className : JSON.stringify(n.textContent)).join(' ')");
    assert(box === 'gacc-row gacc-row btn-row', 'the box: ' + box);
    const opts = await settingsPage("[...document.querySelector('[data-act=default-account]').options].map((o) => o.value + '=' + o.textContent)");
    assert(JSON.stringify(opts) === JSON.stringify(['=Google’s choice', 'tamil.kumar@gmail.com=Tamil (tamil.kumar@gmail.com)', 'tkumar@purdue.edu=Tamil (Purdue) (tkumar@purdue.edu)']), 'the choices: ' + JSON.stringify(opts));
    await sleep(500);
    await t.shot('accounts-settings');
  });

  await R.step('the default account (chosen in Settings): Google’s sites opened from outside Google open with it, typed or from another site’s link', async () => {
    await toSettings();
    await settingsPage("(() => { const s = document.querySelector('[data-act=default-account]'); s.value = 'tkumar@purdue.edu'; s.dispatchEvent(new Event('change')); })()");
    await until(async () => (await get('accounts.google.default')) === 'tkumar@purdue.edu', 3000, 'the default saved');
    const got = [await landed('https://mail.google.com/'), await landed('https://www.youtube.com/watch?v=abc'), await landed('https://docs.google.com/document/d/1/edit?usp=sharing')];
    assert(/^https:\/\/mail\.google\.com\/mail\/\?n=\d+&authuser=1$/.test(got[0]), 'Gmail: ' + got[0]);
    assert(/^https:\/\/www\.youtube\.com\/watch\?v=abc&n=\d+&authuser=1$/.test(got[1]), 'YouTube: ' + got[1]);
    assert(/^https:\/\/docs\.google\.com\/document\/d\/1\/edit\?usp=sharing&n=\d+&authuser=1$/.test(got[2]), 'Docs: ' + got[2]);
    // Another site's link.
    const tab = await open('https://news.example/links.html');
    await inTab(tab, "document.getElementById('gmail').click()");
    const viaLink = await until(async () => { const u = await urlOf(tab); return u && /mail\.google\.com/.test(u) ? u : null; }, 8000, 'Gmail from the link');
    assert(/^https:\/\/mail\.google\.com\/mail\/\?n=\d+-link&authuser=1$/.test(viaLink), 'from another site’s link: ' + viaLink);
  });

  await R.step('particular sites (set in Settings): YouTube with another account, Photos left to Google, the default for the rest; a site that isn’t Google’s is pointed out', async () => {
    await toSettings();
    const add = async (site, email) => {
      const before = (await get('accounts.google.sites')).length;
      await settingsPage("(() => { const b = document.querySelector('[data-act=add-site]'); b.focus(); b.click(); })()");
      await until(async () => (await get('accounts.google.sites')).length === before + 1, 3000, 'a site added');
      const row = await until(() => settingsPage(`(() => { const r = document.querySelectorAll('.gsites .erow')[${before}]; return r && document.activeElement === r.querySelector('input') ? r.querySelector('select').value || '(Google’s choice)' : null; })()`), 3000, 'the new site, its box ready to type in');
      await settingsPage(`(() => { const r = document.querySelectorAll('.gsites .erow')[${before}]; const i = r.querySelector('input'); i.value = ${JSON.stringify(site)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); i.blur(); })()`);
      await until(async () => (await get('accounts.google.sites'))[before].site === site, 3000, 'the site saved');
      if (email != null) {
        await settingsPage(`(() => { const s = document.querySelectorAll('.gsites .erow')[${before}].querySelector('select'); s.value = ${JSON.stringify(email)}; s.dispatchEvent(new Event('change')); })()`);
        await until(async () => (await get('accounts.google.sites'))[before].email === email, 3000, 'the account saved');
      }
      return row;
    };
    const first = await add('youtube.com', null);
    assert(first === 'tamil.kumar@gmail.com', 'a new site starts with the account that isn’t the default: ' + first);
    await add('photos.google.com', '');
    await add('news.example', null);
    const warn = await until(() => settingsPage("(() => { const r = document.querySelectorAll('.gsites .erow')[2]; const w = r && r.querySelector('.gacc-warn'); return w && !w.hidden ? w.textContent : null; })()"), 3000, 'the note');
    assert(warn === 'Not one of Google’s sites', 'the note: ' + warn);
    const noteOnGoogle = await settingsPage("[...document.querySelectorAll('.gsites .erow')].slice(0, 2).map((r) => r.querySelector('.gacc-warn').hidden)");
    assert(JSON.stringify(noteOnGoogle) === '[true,true]', 'a note on Google’s sites: ' + JSON.stringify(noteOnGoogle));
    await settingsPage("document.querySelectorAll('.gsites .erow')[2].querySelector('.icon-btn').click()");
    await until(async () => (await get('accounts.google.sites')).length === 2, 3000, 'the site removed');
    const sites = await get('accounts.google.sites');
    assert(JSON.stringify(sites) === JSON.stringify([{ site: 'youtube.com', email: 'tamil.kumar@gmail.com' }, { site: 'photos.google.com', email: '' }]), 'saved: ' + JSON.stringify(sites));
    const got = [await landed('https://www.youtube.com/'), await landed('https://photos.google.com/'), await landed('https://mail.google.com/')];
    assert(/^https:\/\/www\.youtube\.com\/\?n=\d+&authuser=0$/.test(got[0]), 'YouTube: ' + got[0]);
    assert(/^https:\/\/photos\.google\.com\/\?n=\d+$/.test(got[1]), 'Photos: ' + got[1]);
    assert(/authuser=1$/.test(got[2]), 'Gmail: ' + got[2]);
    await toSettings();
    await settingsPage("document.getElementById('google-accounts').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await sleep(500);
    await t.shot('accounts-sites');
  });

  await R.step('left alone: links inside Google, a page that says which account, sign-in, a form sent to Google, a private window', async () => {
    served = [];
    const g = await open('https://www.google.com/links.html');
    assert(/authuser=1$/.test(await urlOf(g)), 'the Google page itself: ' + (await urlOf(g)));
    await inTab(g, "document.getElementById('gmail').click()");
    const inside = await until(async () => { const u = await urlOf(g); return u && /mail\.google\.com/.test(u) ? u : null; }, 8000, 'Gmail from Google’s link');
    assert(/^https:\/\/mail\.google\.com\/\?n=\d+-link$/.test(inside), 'a link inside Google: ' + inside);
    const said = [await landed('https://mail.google.com/mail/u/0/'), await landed('https://www.youtube.com/?authuser=1'), await landed('https://accounts.google.com/ServiceLogin')];
    assert(/\/mail\/u\/0\/\?n=\d+$/.test(said[0]) && /\?authuser=1&n=\d+$/.test(said[1]) && /ServiceLogin\?n=\d+$/.test(said[2]), 'changed: ' + JSON.stringify(said));
    const f = await open('https://news.example/links.html');
    await inTab(f, "document.getElementById('post').submit()");
    await until(() => served.find((s) => s.startsWith('POST https://www.google.com/search')), 8000, 'the form');
    assert(served.some((s) => /^POST https:\/\/www\.google\.com\/search\?n=\d+-post$/.test(s)), 'the form: ' + served.filter((s) => /search/.test(s)).join(' '));
    await t.ui(() => window.__wbTest.command('newPrivateWindow'));
    await until(() => t.main(() => global.__bifrost.registry.list().some((c) => c.isPrivate)), 8000, 'a private window');
    await sleep(1000);
    const priv = await landed('https://mail.google.com/', { privateWindow: true });
    assert(/^https:\/\/mail\.google\.com\/\?n=\d+$/.test(priv), 'in a private window: ' + priv);
    await t.main(() => { const ctl = global.__bifrost.registry.list().find((c) => c.isPrivate); ctl.closeConfirmed = true; ctl.win.close(); });
    await until(() => t.main(() => !global.__bifrost.registry.list().some((c) => c.isPrivate)), 8000, 'the private window closed');
  });

  await R.step('an account you aren’t signed in to is left to Google (and Settings says so); signing out of one, the others move up', async () => {
    await set('accounts.google.default', 'gone@gmail.com');
    const gone = await landed('https://mail.google.com/');
    assert(/^https:\/\/mail\.google\.com\/\?n=\d+$/.test(gone), 'not signed in to it: ' + gone);
    await toSettings();
    const shown = await until(() => settingsPage("(() => { const s = document.querySelector('[data-act=default-account]'); const o = s.options[s.selectedIndex]; return o && o.value === 'gone@gmail.com' ? o.textContent : null; })()"), 3000, 'Settings showing it');
    assert(shown === 'gone@gmail.com (not signed in)', 'Settings: ' + shown);
    await set('accounts.google.default', 'tkumar@purdue.edu');
    // Signed out of the first account: Purdue's is the first now.
    signedIn = [['Tamil (Purdue)', 'tkumar@purdue.edu']];
    await signIn('two');
    await until(async () => (await known()) === '0 tkumar@purdue.edu', 8000, 'the accounts read again');
    const got = [await landed('https://mail.google.com/'), await landed('https://www.youtube.com/')];
    assert(/authuser=0$/.test(got[0]), 'Gmail, with Purdue’s first: ' + got[0]);
    assert(/^https:\/\/www\.youtube\.com\/\?n=\d+$/.test(got[1]), 'YouTube, its account signed out: ' + got[1]);
    const rows = await until(() => settingsPage("(() => { const r = document.querySelectorAll('.gacc-row'); const s = document.querySelector('.gsites .erow select'); return r.length === 1 && s ? s.options[s.selectedIndex].textContent : null; })()"), 5000, 'Settings with one account');
    assert(rows === 'tamil.kumar@gmail.com (not signed in)', 'YouTube’s account in Settings: ' + rows);
  });

  await R.step('Google taking authuser out again doesn’t send the page round again; before the accounts are read, the email goes', async () => {
    served = [];
    const drive = await landed('https://drive.google.com/');
    assert(/^https:\/\/drive\.google\.com\/\?n=\d+$/.test(drive), 'Drive: ' + drive);
    const toDrive = served.filter((s) => s.includes('drive.google.com') && !s.includes('favicon'));
    assert(toDrive.length === 2 && /authuser=0$/.test(toDrive[0]) && !/authuser/.test(toDrive[1]), 'Drive’s requests: ' + JSON.stringify(toDrive));
    // Accounts not read yet (Google slow to answer): the email.
    hold = [];
    await t.main(() => { global.__bifrost.googleAccounts.list = null; });
    const early = await landed('https://mail.google.com/');
    assert(/^https:\/\/mail\.google\.com\/mail\/\?n=\d+&authuser=tkumar%40purdue\.edu$/.test(early), 'before they’re read: ' + early);
    const waiting = hold; hold = null;
    for (const answer of waiting) answer();
    await until(async () => (await known()) === '0 tkumar@purdue.edu', 5000, 'the accounts read');
    // Settings → Refresh reads them again.
    const before = reads.length;
    await settingsPage("document.querySelector('[data-act=refresh]').click()");
    await until(() => reads.length > before, 5000, 'Refresh');
  });

  await R.step('nothing on the pages broke', async () => {
    const errs = (await t.pageLogs()).filter((l) => /pageerror/.test(l));
    assert(!errs.length, errs.join('\n'));
  });
} finally {
  const errs = t.logs.filter((l) => /Uncaught|TypeError|\[webrequest\]/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log:\n  ' + errs.join('\n  '));
  await t.close();
  server.close();
  fs.rmSync(tls, { recursive: true, force: true });
}
process.exit(R.summary() ? 1 : 0);
