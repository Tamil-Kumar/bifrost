// Bifrost's VPN (src/main/vpn.js, src/ui/js/vpn.js), with a stand-in for its helper (tools/fake-vpn.mjs: the
// helper's commands and lines, a real SOCKS5 proxy, no tunnel; it writes down what it was asked to connect to).
// The real helper, with Cloudflare WARP, is tried on Windows by the release workflow (tools/vpn/check.mjs).
//  · the toolbar's button and its popover: off; WARP or your file; Cloudflare's terms until you've agreed
//  · on (turning it on is agreeing): signed up once, connected, pages through it, WebRTC only through the proxy
//  · nothing around it: its helper gone, pages don't load and sites aren't asked; it's back by itself
//  · off: pages straight to sites again
//  · your WireGuard file: checked, kept, used, named; one that isn't one turned away
//  · WARP's port not answered: the next one tried
//  · Bifrost started with it on: the first page goes through it, no sign-up again
//  · Settings → Privacy → VPN, the command palette's toggle, forgetting WARP's sign-up
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, reporter, assert, sleep } from './lib.mjs';

const R = reporter('vpn');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'fake-vpn.log');
const CTRL = path.join(OUT, 'fake-vpn.json');
fs.rmSync(LOG, { force: true });
fs.writeFileSync(CTRL, '{}');
const ctrl = (o) => fs.writeFileSync(CTRL, JSON.stringify(o));
const fake = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const HOSTS = ['site.test', 'other.test'];
const seen = [];
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  seen.push(host + req.url);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><title>${host}</title><body><p id=p>hello from ${host}${req.url}</p></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const PROTON = `[Interface]
# Key for Bifrost
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# NL-FREE#1
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
AllowedIPs = 0.0.0.0/0
Endpoint = 185.107.56.1:51820
`;

const OPTS = {
  profile: 'vpn',
  // (straight to sites: the stand-in names mapped here; through the VPN, the stand-in maps them itself)
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`],
  env: {
    HTTP_PROXY: '', http_proxy: '', HTTPS_PROXY: '', https_proxy: '', NO_PROXY: '*', no_proxy: '*',
    BIFROST_VPN_HELPER: path.join(HERE, 'tools', 'fake-vpn.mjs'), FAKE_VPN_LOG: LOG, FAKE_VPN_CTRL: CTRL,
    FAKE_VPN_MAP: HOSTS.map((h) => `${h}=127.0.0.1:${port}`).join(','),
  },
  settings: { onboarding: { done: true } },
};
let t = await launch(OPTS);
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 300) + ')' : ''));
};
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const get = (p) => t.main((_, p) => global.__bifrost.settings.get(p), p);
const status = () => t.main(() => global.__bifrost.vpn.status());
const connected = (label) => until(async () => { const s = await status(); return s.state === 'connected' ? s : null; }, 15000, label || 'connected');
let n = 0;
// Opens url in a new tab in front; { id, text } once loaded (text: the page's, or '' when it didn't load).
const open = async (url) => {
  const full = url + (url.includes('?') ? '&' : '?') + 'n=' + ++n;
  await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), full);
  const id = await until(() => t.main(({ webContents }, full) => { const w = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && (w.getURL() === full || w.getURL().startsWith('chrome-error'))); return w && !w.isLoading() ? w.id : null; }, full), 10000, 'the page ' + full);
  await sleep(200);
  const text = await t.main(({ webContents }, id) => webContents.fromId(id).executeJavaScript('(document.getElementById("p") || {}).textContent || ""'), id).catch(() => '');
  return { id, text, full };
};
const closeTabs = () => t.main(({ webContents }) => { for (const w of webContents.getAllWebContents()) if (w.getType() === 'webview' && /\.test\//.test(w.getURL()) || w.getType() === 'webview' && w.getURL().startsWith('chrome-error')) w.close(); });
const webrtc = (id) => t.main(({ webContents }, id) => webContents.fromId(id).getWebRTCIPHandlingPolicy(), id);
const popoverOpen = async () => {
  await t.ui(() => document.querySelector('[data-tb="vpn"]').click());
  return until(() => t.ui(() => !!document.querySelector('.vpn-pop .vpn')), 3000, 'the popover');
};
const closePopover = () => t.ui(() => { const p = document.querySelector('.vpn-pop'); if (p) p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });

try {
  await R.step('the toolbar’s VPN button, off; its popover: Cloudflare WARP (chosen) or your WireGuard file, and Cloudflare’s terms until you’ve agreed', async () => {
    const b = await until(() => t.ui(() => { const b = document.querySelector('#toolbar [data-tb="vpn"]'); return b && b.dataset.vpn ? { k: b.dataset.vpn, title: b.title } : null; }), 5000, 'the button');
    assert(b.k === 'off' && /Off/.test(b.title), JSON.stringify(b));
    await popoverOpen();
    const p = await t.ui(() => {
      const el = document.querySelector('.vpn-pop .vpn');
      return { line: el.querySelector('.vpn-line').textContent, sel: [...el.querySelectorAll('.vpn-choice')].map((c) => c.dataset.source + (c.classList.contains('sel') ? '*' : '')).join(' '),
        terms: [...el.querySelectorAll('.vpn-terms')].map((e) => e.textContent).join(' | '), on: el.querySelector('.vpn-head input[role="switch"]').checked };
    });
    assert(p.sel === 'warp* file' && !p.on && /Off/.test(p.line), JSON.stringify(p));
    assert(/Cloudflare’s terms/.test(p.terms) && /Only Bifrost goes through it/.test(p.terms), p.terms);
    assert(!fake().length, 'nothing should have started: ' + JSON.stringify(fake()));
  });

  let first;
  await R.step('turned on in the popover (WARP; turning it on is agreeing to the terms): signed up once, connected, and a page goes through it, WebRTC only through the proxy', async () => {
    await t.ui(() => document.querySelector('.vpn-pop .vpn-head input[role="switch"]').click());
    const s = await connected();
    assert((await get('vpn.warpTerms')) === true && (await get('vpn.on')) === true, 'the settings');
    assert(s.source === 'warp' && s.warp && s.endpoint === '162.159.192.1:2408', JSON.stringify(s));
    const f = fake();
    assert(f.filter((o) => o.register).length === 1 && f.some((o) => o.run === 'engage.cloudflareclient.com:2408'), JSON.stringify(f));
    // (the popover, as it is now; then the button)
    const line = await until(() => t.ui(() => { const e = document.querySelector('.vpn-pop .vpn-line'); return e && /On, through Cloudflare WARP/.test(e.textContent) ? e.textContent : null; }), 3000, 'the popover to say so');
    assert(line, line);
    await closePopover();
    await until(() => t.ui(() => document.querySelector('#toolbar [data-tb="vpn"]').dataset.vpn === 'on'), 3000, 'the button, on');
    const before = fake().filter((o) => o.connect).length;
    first = await open('http://site.test/through');
    assert(first.text.startsWith('hello from site.test/through'), 'the page: ' + first.text);
    assert(fake().filter((o) => o.connect === 'site.test:80').length > 0 && fake().filter((o) => o.connect).length > before, 'not through the VPN: ' + JSON.stringify(fake().slice(-3)));
    assert((await webrtc(first.id)) === 'disable_non_proxied_udp', 'WebRTC: ' + (await webrtc(first.id)));
    // (the secrets: encrypted where the system can, never in settings.json)
    const settingsFile = fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8');
    assert(!/PrivateKey|yAnz5TF/.test(settingsFile), 'a key in settings.json');
    assert(fs.existsSync(path.join(t.dir, 'vpn.json')), 'vpn.json');
  });

  await R.step('nothing goes around it: its helper stopped, a page doesn’t load and the site isn’t asked; then it’s back by itself and pages go through it again', async () => {
    const pid = await t.main(() => global.__bifrost.vpn.child && global.__bifrost.vpn.child.pid);
    assert(pid, 'no helper');
    process.kill(pid, 'SIGKILL');
    await until(async () => { const s = await status(); return s.state === 'error' ? s : null; }, 5000, 'it to say it isn’t connected');
    const asked = seen.length;
    const p = await open('http://site.test/around');
    assert(!p.text, 'it loaded: ' + p.text);
    await sleep(300);
    assert(!seen.slice(asked).some((u) => u.startsWith('site.test/around')), 'the site was asked: ' + seen.slice(asked).join(' '));
    await connected('it to be back');
    const q = await open('http://site.test/back');
    assert(q.text.startsWith('hello from site.test/back'), 'after: ' + q.text);
    assert(fake().some((o) => o.connect === 'site.test:80' && o.pid !== pid), 'not through the new helper');
  });

  await R.step('turned off: pages go straight to sites again, WebRTC as usual', async () => {
    await popoverOpen();
    await t.ui(() => document.querySelector('.vpn-pop .vpn-head input[role="switch"]').click());
    await until(async () => (await status()).state === 'off', 5000, 'off');
    await closePopover();
    const through = fake().filter((o) => o.connect).length;
    const p = await open('http://other.test/straight');
    assert(p.text.startsWith('hello from other.test/straight'), p.text);
    assert(fake().filter((o) => o.connect).length === through, 'still through the VPN');
    assert((await webrtc(p.id)) === 'default', 'WebRTC: ' + (await webrtc(p.id)));
    await until(() => t.ui(() => document.querySelector('#toolbar [data-tb="vpn"]').dataset.vpn === 'off'), 3000, 'the button, off');
    await closeTabs();
  });

  await R.step('a WireGuard file of yours (Proton VPN’s): checked, kept, used, named in the popover; a file that isn’t one turned away, saying why', async () => {
    const bad = await t.main(() => { try { global.__bifrost.vpn.importFile('{"not": "wireguard"}', 'nope'); return 'taken'; } catch (e) { return e.message; } });
    assert(/name = value/.test(bad), bad);
    await t.main((_, text) => global.__bifrost.vpn.importFile(text, 'proton-nl-free'), PROTON);
    assert((await get('vpn.source')) === 'file' && (await get('vpn.fileName')) === 'proton-nl-free', 'the settings');
    await set('vpn.on', true);
    const s = await connected('connected through the file');
    assert(s.source === 'file' && s.endpoint === '185.107.56.1:51820' && s.file && s.file.name === 'proton-nl-free', JSON.stringify(s));
    assert(fake().some((o) => o.run === '185.107.56.1:51820'), 'run with the file');
    const p = await open('http://site.test/file');
    assert(p.text.startsWith('hello from site.test/file'), p.text);
    await popoverOpen();
    const pop = await t.ui(() => { const el = document.querySelector('.vpn-pop .vpn'); return { line: el.querySelector('.vpn-line').textContent, sel: [...el.querySelectorAll('.vpn-choice.sel')].map((c) => c.textContent).join('') }; });
    assert(/On, through proton-nl-free/.test(pop.line) && /proton-nl-free/.test(pop.sel) && /185\.107\.56\.1:51820/.test(pop.sel), JSON.stringify(pop));
    await closePopover();
    await closeTabs();
  });

  await R.step('WARP on a network that doesn’t let its port through: the next one tried, by itself, and started on next time', async () => {
    ctrl({ silentPorts: [2408] });
    const runs = fake().filter((o) => o.run).length;
    await set('vpn.source', 'warp');
    await until(async () => { const s = await status(); return s.state === 'connecting' && /trying port 500/.test(s.note) ? s : fake().slice(runs).some((o) => o.run === 'engage.cloudflareclient.com:500'); }, 12000, 'port 500');
    const s = await connected('connected on port 500');
    assert(fake().slice(runs).some((o) => o.run === 'engage.cloudflareclient.com:500'), JSON.stringify(fake().slice(runs)));
    assert(s.endpoint === '162.159.192.1:500', s.endpoint);
    // (and next time it starts there: no waiting for 2408 again)
    await set('vpn.on', false);
    await until(async () => (await status()).state === 'off', 5000, 'off');
    const mark = fake().length;
    await set('vpn.on', true);
    await connected('connected again');
    const again = fake().slice(mark).filter((o) => o.run);
    assert(again.length && again[0].run === 'engage.cloudflareclient.com:500', 'started on: ' + JSON.stringify(again));
    ctrl({});
  });

  await R.step('Bifrost started with the VPN on: its first page goes through it, without signing up again', async () => {
    await t.close();
    const registers = fake().filter((o) => o.register).length;
    const mark = fake().length;
    t = await launch({ ...OPTS, fresh: false });
    const p = await open('http://site.test/first');
    assert(p.text.startsWith('hello from site.test/first'), 'the first page: ' + p.text);
    const after = fake().slice(mark);
    assert(after.some((o) => o.connect === 'site.test:80'), 'not through the VPN: ' + JSON.stringify(after));
    assert(fake().filter((o) => o.register).length === registers, 'signed up again');
    await connected();
    await closeTabs();
  });

  await R.step('Settings → Privacy → VPN: how it is and its switch; the command palette turns it off and on; forgetting WARP’s sign-up takes it off Cloudflare’s list', async () => {
    await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), 'bifrost://settings#privacy');
    const inSettings = (code) => t.guest('bifrost://settings', code);
    const txt = await until(() => inSettings('(() => { const e = document.querySelector(".vpn-set"); return e && /On, through Cloudflare WARP/.test(e.textContent) ? e.textContent : null; })()'), 8000, 'the VPN in Settings');
    assert(/Through/.test(txt) && /Cloudflare WARP/.test(txt) && /Forget WARP’s sign-up/.test(txt), txt.slice(0, 300));
    await inSettings('document.querySelector(".vpn-set input[role=switch]").click(), 1');
    await until(async () => (await status()).state === 'off', 5000, 'off from Settings');
    await until(() => inSettings('/Off: Bifrost goes straight/.test(document.querySelector(".vpn-set").textContent)'), 3000, 'Settings to say so');
    await t.ui(async () => { const st = await import('./js/state.js'); st.emit('command', 'toggleVpn'); });
    await connected('on from the command palette');
    await t.ui(async () => { const st = await import('./js/state.js'); st.emit('command', 'toggleVpn'); });
    await until(async () => (await status()).state === 'off', 5000, 'off from the command palette');
    const s = await t.main(() => global.__bifrost.vpn.forget('warp'));
    assert(!s.warp, JSON.stringify(s));
    await until(() => fake().some((o) => o.unregister === 'fake-device'), 5000, 'taken off Cloudflare’s list');
    await t.main(({ webContents }) => { for (const w of webContents.getAllWebContents()) if (w.getType() === 'webview' && w.getURL().startsWith('bifrost://settings')) w.close(); });
  });

  await R.step('nothing on the pages broke', async () => {
    const errs = (await t.pageLogs()).filter((l) => /pageerror/.test(l));
    assert(!errs.length, errs.join('\n'));
  });
} finally {
  const errs = t.logs.filter((l) => /Uncaught|TypeError|\[vpn\]/.test(l)).slice(0, 8);
  if (errs.length) console.log('main log:\n  ' + errs.join('\n  '));
  await t.close();
  server.close();
}
process.exit(R.summary() ? 1 : 0);
