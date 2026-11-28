// Bifrost's VPN (src/main/vpn.js, src/ui/js/vpn.js), with a stand-in for its helper (tools/fake-vpn.mjs: the
// helper's commands and lines, a real SOCKS5 proxy, no tunnel; it writes down what it was asked to connect to).
// The real helper, with Cloudflare WARP, is tried on Windows by the release workflow (tools/vpn/check.mjs).
//  · the toolbar's button and its popover: off; where you appear (WARP, near you); Cloudflare's terms until you've
//    agreed
//  · on (turning it on is agreeing): signed up once, connected, where sites see you, pages through it, WebRTC only
//    through the proxy
//  · nothing around it: its helper gone, pages don't load and sites aren't asked; it's back by itself
//  · off: pages straight to sites again
//  · your WireGuard file: checked, kept, its country from its server's name, tried on its own, used; one that
//    isn't one turned away
//  · locations: several files at once, each tried (one that doesn't answer said so), picked in the popover: there,
//    and sites see you there; none tried while one of yours is in use
//  · a site that skips it: straight to that site, the rest through it; WebRTC as usual there
//  · private windows only: the others straight, private ones through it
//  · a WireGuard file downloaded in Bifrost: offered as a location, added and gone to
//  · WARP's port not answered: the next one tried
//  · Bifrost started with it on: the first page goes through it, no sign-up again
//  · Settings → Privacy → VPN, the command palette's toggle, forgetting a location and WARP's sign-up
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

const HOSTS = ['site.test', 'other.test', 'bank.test', 'files.test'];
const seen = [];
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  seen.push(host + req.url);
  // (Proton VPN's downloads page, as far as Bifrost can tell: a WireGuard file to save)
  if (req.url.startsWith('/JP-FREE-7.conf')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="JP-FREE-7.conf"' });
    res.end(fileFor('JP-FREE#7', '138.199.21.7:51820', 'b'));
    return;
  }
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

// A Proton-like file for a server (its name in the [Peer]'s comment) at an endpoint; k: which key (a different one
// for each, as Proton gives).
const KEYS = { a: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', b: 'aBnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', c: 'cCnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', d: 'dDnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=' };
function fileFor(server, endpoint, k) {
  return `[Interface]\n# Bouncing = 3\n# VPN Accelerator = on\nPrivateKey = ${KEYS[k]}\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\n# ${server}\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nAllowedIPs = 0.0.0.0/0\nEndpoint = ${endpoint}\n`;
}
const WHERE = { '138.199.21.7:51820': { ip: '138.199.21.70', loc: 'JP', colo: 'NRT' }, '149.88.20.1:51820': { ip: '149.88.20.10', loc: 'US', colo: 'SEA' }, '185.107.56.1:51820': { ip: '185.107.56.9', loc: 'NL', colo: 'AMS' } };

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
const open = async (url, { privateWindow = false } = {}) => {
  const full = url + (url.includes('?') ? '&' : '?') + 'n=' + ++n;
  await t.main((_, [url, priv]) => global.__bifrost.registry.list().find((c) => !!c.isPrivate === priv).send('open-url', { url }), [full, privateWindow]);
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
  await R.step('the toolbar’s VPN button, off; its popover: where you appear (WARP, near you, chosen; no locations of yours yet, and how to get free ones from Proton VPN), and Cloudflare’s terms until you’ve agreed', async () => {
    const b = await until(() => t.ui(() => { const b = document.querySelector('#toolbar [data-tb="vpn"]'); return b && b.dataset.vpn ? { k: b.dataset.vpn, title: b.title } : null; }), 5000, 'the button');
    assert(b.k === 'off' && /Off/.test(b.title), JSON.stringify(b));
    await popoverOpen();
    const p = await t.ui(() => {
      const el = document.querySelector('.vpn-pop .vpn');
      return { line: el.querySelector('.vpn-line').textContent, sel: [...el.querySelectorAll('.vpn-loc')].map((c) => c.dataset.loc + (c.classList.contains('sel') ? '*' : '')).join(' '),
        terms: [...el.querySelectorAll('.vpn-terms')].map((e) => e.textContent).join(' | '), on: el.querySelector('.vpn-head input[role="switch"]').checked,
        guide: (el.querySelector('.vpn-guide') || {}).textContent || '', foot: el.querySelector('.vpn-foot').textContent, where: !!el.querySelector('.vpn-where') };
    });
    assert(p.sel === 'warp*' && !p.on && /Off/.test(p.line) && !p.where, JSON.stringify(p));
    assert(/Cloudflare’s terms/.test(p.terms) && /Only Bifrost goes through it/.test(p.foot), p.terms + ' | ' + p.foot);
    assert(/10 countries/.test(p.guide) && /WireGuard configuration/.test(p.guide), 'the Proton VPN steps: ' + p.guide);
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
    // (the popover, as it is now: where sites see you, as the helper found out through it; then the button)
    const line = await until(() => t.ui(() => { const e = document.querySelector('.vpn-pop .vpn-line'); return e && /On · Cloudflare WARP/.test(e.textContent) ? e.textContent : null; }), 3000, 'the popover to say so');
    assert(line, line);
    const w = await until(() => t.ui(() => { const e = document.querySelector('.vpn-pop .vpn-where'); return e && /Sites see you in United States/.test(e.textContent) ? e.textContent : null; }), 4000, 'where sites see you');
    assert(/104\.28\.0\.7/.test(w), w);
    const st = await status();
    assert(st.seen && st.seen.loc === 'US' && st.warpSeen && st.warpSeen.loc === 'US', JSON.stringify(st.seen));
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

  let nl;
  await R.step('a WireGuard file of yours (Proton VPN’s): checked, kept, its country from its server’s name (NL-FREE#1), tried on its own while the VPN’s off, used: sites see you in the Netherlands; a file that isn’t one turned away, saying why', async () => {
    ctrl({ seen: WHERE });
    const r = await t.main((_, text) => global.__bifrost.vpn.importFiles([{ text: '{"not": "wireguard"}', name: 'nope.conf' }, { text, name: 'proton-nl-free.conf' }], { use: true }), PROTON);
    assert(r.errors.length === 1 && r.errors[0].name === 'nope' && /name = value/.test(r.errors[0].error), JSON.stringify(r.errors));
    assert(r.added.length === 1 && r.added[0].server === 'NL-FREE#1' && r.added[0].country === 'NL' && r.added[0].guessed, JSON.stringify(r.added));
    nl = r.added[0].id;
    assert((await get('vpn.source')) === 'file' && (await get('vpn.file')) === nl, 'the settings');
    // (tried on its own: it answers, and puts you in the Netherlands)
    const tried = await until(async () => { const s = await status(); const f = s.files.find((x) => x.id === nl); return f && f.ms && !f.probing ? f : null; }, 6000, 'it to be tried');
    assert(tried.ms === 41 && tried.seen && tried.seen.loc === 'NL' && !tried.guessed && fake().some((o) => o.probe === '185.107.56.1:51820'), JSON.stringify(tried));
    await set('vpn.on', true);
    const s = await connected('connected through the file');
    assert(s.source === 'file' && s.location === nl && s.endpoint === '185.107.56.1:51820' && s.file && s.file.name === 'proton-nl-free', JSON.stringify(s));
    assert(fake().some((o) => o.run === '185.107.56.1:51820'), 'run with the file');
    const p = await open('http://site.test/file');
    assert(p.text.startsWith('hello from site.test/file'), p.text);
    await popoverOpen();
    const pop = await until(() => t.ui(() => { const el = document.querySelector('.vpn-pop .vpn'); const w = el.querySelector('.vpn-where'); return w && /Netherlands/.test(w.textContent) ? { line: el.querySelector('.vpn-line').textContent, where: w.textContent, sel: [...el.querySelectorAll('.vpn-loc.sel')].map((c) => c.textContent).join('') } : null; }), 4000, 'the popover');
    assert(/On · Netherlands/.test(pop.line) && /Sites see you in Netherlands/.test(pop.where) && /185\.107\.56\.9/.test(pop.where) && /NL-FREE#1/.test(pop.sel) && /41 ms/.test(pop.sel), JSON.stringify(pop));
    await closePopover();
    await closeTabs();
  });

  let jp;
  await R.step('locations: three files at once, from Proton VPN’s free servers (Japan, the United States, one whose server doesn’t answer): none tried while one of yours is in use; picked in the popover, Japan: the VPN goes there and sites see you in Japan; then, on WARP, the others are tried', async () => {
    ctrl({ seen: WHERE, dead: ['198.51.100.4:51820'] });
    const probes = fake().filter((o) => o.probe).length;
    const r = await t.main((_, items) => global.__bifrost.vpn.importFiles(items), [
      { text: fileFor('JP-FREE#3', '138.199.21.7:51820', 'c'), name: 'wg-JP-FREE-3.conf' },
      { text: fileFor('US-FREE#12', '149.88.20.1:51820', 'd'), name: 'US-FREE-12.conf' },
      { text: fileFor('PL-FREE#2', '198.51.100.4:51820', 'b'), name: 'PL-FREE-2.conf' },
      // (the same file again: one location, not two)
      { text: PROTON, name: 'proton-nl-free.conf' },
    ]);
    assert(r.added.map((f) => f.country).join(' ') === 'JP US PL NL' && !r.errors.length, JSON.stringify(r));
    jp = r.added[0].id;
    const st = await status();
    assert(st.files.length === 4 && st.location === nl, 'four locations, still the Netherlands: ' + JSON.stringify(st.files.map((f) => f.name)));
    await sleep(600);
    assert(fake().filter((o) => o.probe).length === probes, 'tried while one of yours is in use: ' + JSON.stringify(fake().slice(-3)));
    // (picked in the popover)
    await popoverOpen();
    const rows = await t.ui(() => [...document.querySelectorAll('.vpn-pop .vpn-loc')].map((b) => b.querySelector('.vpn-cc').textContent + ':' + b.querySelector('b').textContent));
    assert(rows.join(' | ') === ':Near you | NL:Netherlands | JP:Japan | US:United States | PL:Poland', rows.join(' | '));
    const runs = fake().filter((o) => o.run).length;
    await t.ui((id) => document.querySelector(`.vpn-pop .vpn-loc[data-loc="${id}"]`).click(), jp);
    await until(async () => { const s = await status(); return s.location === jp && s.state === 'connected' && s.seen && s.seen.loc === 'JP' ? s : null; }, 8000, 'Japan');
    assert(fake().slice(0).filter((o) => o.run).length > runs && fake().filter((o) => o.run).pop().run === '138.199.21.7:51820', 'not run with Japan’s file');
    const w = await until(() => t.ui(() => { const e = document.querySelector('.vpn-pop .vpn-where'); return e && /Japan/.test(e.textContent) ? e.textContent : null; }), 4000, 'the popover to say Japan');
    assert(/Sites see you in Japan/.test(w) && /138\.199\.21\.70/.test(w), w);
    const btn = await t.ui(() => document.querySelector('#toolbar [data-tb="vpn"]').title);
    assert(/sites see you in Japan/.test(btn), btn);
    await closePopover();
    const p = await open('http://other.test/japan');
    assert(p.text.startsWith('hello from other.test/japan'), p.text);
    // (on WARP: the ones not tried yet are, and one that doesn't answer says so)
    await set('vpn.source', 'warp');
    await connected('on WARP');
    for (const f of (await status()).files.filter((x) => !x.ms && !x.problem)) await t.main((_, id) => global.__bifrost.vpn.probe(id), f.id);
    const after = (await status()).files;
    const pl = after.find((f) => f.country === 'PL'), us = after.find((f) => f.country === 'US');
    assert(/no answer from 198\.51\.100\.4:51820/.test(pl.problem) && us.ms === 41 && !us.problem, JSON.stringify(after));
    await popoverOpen();
    const plRow = await t.ui((id) => document.querySelector(`.vpn-pop .vpn-loc[data-loc="${id}"]`).textContent, pl.id);
    assert(/Didn’t answer/.test(plRow), plRow);
    await closePopover();
    await closeTabs();
  });

  await R.step('a site that skips the VPN (its switch in the popover): it goes straight to the site, other sites still through the VPN, WebRTC as usual on it; then through it again', async () => {
    const a = await open('http://bank.test/before');
    assert(a.text.startsWith('hello from bank.test/before') && fake().some((o) => o.connect === 'bank.test:80'), 'through it first');
    await popoverOpen();
    const row = await until(() => t.ui(() => { const e = document.querySelector('.vpn-pop .vpn-site'); return e ? e.textContent : null; }), 3000, 'the site’s row');
    assert(/bank\.test/.test(row) && /Goes through the VPN/.test(row), row);
    await t.ui(() => document.querySelector('.vpn-pop .vpn-site input[role="switch"]').click());
    await until(async () => (await status()).bypass.includes('bank.test'), 3000, 'bank.test skipped');
    await until(() => t.ui(() => /Skips the VPN/.test(document.querySelector('.vpn-pop .vpn-site').textContent)), 3000, 'the popover to say so');
    await closePopover();
    await sleep(400);
    const mark = fake().filter((o) => o.connect).length;
    const b = await open('http://bank.test/skipped');
    assert(b.text.startsWith('hello from bank.test/skipped'), b.text);
    assert(!fake().slice(0).filter((o) => o.connect).slice(mark).some((o) => o.connect === 'bank.test:80'), 'bank.test through the VPN: ' + JSON.stringify(fake().slice(-3)));
    assert((await webrtc(b.id)) === 'default', 'WebRTC on it: ' + (await webrtc(b.id)));
    const c = await open('http://site.test/still');
    assert(c.text.startsWith('hello from site.test/still') && fake().filter((o) => o.connect).slice(mark).some((o) => o.connect === 'site.test:80'), 'site.test straight');
    assert((await webrtc(c.id)) === 'disable_non_proxied_udp', 'WebRTC on site.test: ' + (await webrtc(c.id)));
    await t.main(() => global.__bifrost.vpn.setSkipped('bank.test', false));
    await sleep(400);
    const m2 = fake().filter((o) => o.connect).length;
    const d = await open('http://bank.test/again');
    assert(d.text.startsWith('hello from bank.test/again') && fake().filter((o) => o.connect).slice(m2).some((o) => o.connect === 'bank.test:80'), 'not through it again');
    await closeTabs();
  });

  await R.step('only private windows: a window of yours goes straight to sites (its button says it’s on in private windows only), a private window through the VPN', async () => {
    await set('vpn.scope', 'private');
    await sleep(400);
    const mark = fake().filter((o) => o.connect).length;
    const a = await open('http://site.test/normal');
    assert(a.text.startsWith('hello from site.test/normal'), a.text);
    assert(!fake().filter((o) => o.connect).slice(mark).length, 'a window of yours through the VPN');
    assert((await webrtc(a.id)) === 'default', 'WebRTC: ' + (await webrtc(a.id)));
    const b = await until(() => t.ui(() => { const b = document.querySelector('#toolbar [data-tb="vpn"]'); return b.dataset.vpn === 'off' && /private windows only/.test(b.title) ? b.title : null; }), 3000, 'the button to say so');
    assert(b, b);
    await t.ui(() => window.__wbTest.command('newPrivateWindow'));
    await until(() => t.main(() => global.__bifrost.registry.list().some((c) => c.isPrivate)), 8000, 'a private window');
    await sleep(1200);
    const p = await open('http://other.test/private', { privateWindow: true });
    assert(p.text.startsWith('hello from other.test/private'), p.text);
    assert(fake().filter((o) => o.connect).slice(mark).some((o) => o.connect === 'other.test:80'), 'the private window straight');
    assert((await webrtc(p.id)) === 'disable_non_proxied_udp', 'WebRTC in the private window: ' + (await webrtc(p.id)));
    const pb = await t.main(() => global.__bifrost.registry.list().find((c) => c.isPrivate).win.webContents.executeJavaScript('document.querySelector("#toolbar [data-tb=vpn]").dataset.vpn'));
    assert(pb === 'on', 'the private window’s button: ' + pb);
    await t.main(() => { const ctl = global.__bifrost.registry.list().find((c) => c.isPrivate); ctl.closeConfirmed = true; ctl.win.close(); });
    await until(() => t.main(() => !global.__bifrost.registry.list().some((c) => c.isPrivate)), 8000, 'the private window closed');
    await set('vpn.scope', 'all');
    await closeTabs();
  });

  await R.step('a WireGuard file downloaded in Bifrost (as from Proton VPN’s downloads page): offered as a location, then added and gone to', async () => {
    const before = (await status()).files.length;
    await t.main((_, url) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url }), 'http://files.test/JP-FREE-7.conf');
    const offer = await until(() => t.ui(() => { const e = [...document.querySelectorAll('.toast')].find((x) => /WireGuard file/.test(x.textContent)); return e ? e.textContent : null; }), 10000, 'the offer');
    assert(/JP-FREE#7/.test(offer) && /Add Japan to the VPN’s locations/.test(offer), offer);
    await t.ui(() => [...[...document.querySelectorAll('.toast')].find((x) => /WireGuard file/.test(x.textContent)).querySelectorAll('.toast-btn')].find((b) => /go there/.test(b.textContent)).click());
    const s = await until(async () => { const s = await status(); return s.files.length === before + 1 && s.file && s.file.server === 'JP-FREE#7' && s.state === 'connected' ? s : null; }, 8000, 'added and gone to');
    assert(s.source === 'file' && fake().filter((o) => o.run).pop().run === '138.199.21.7:51820', JSON.stringify(s.file));
    // (only a file it offered: not any file on the computer)
    const no = await t.main(() => { try { global.__bifrost.vpn.addDownloaded('/etc/hostname', false); return 'added'; } catch (e) { return e.message; } });
    assert(/wasn’t offered/.test(no), no);
    await closeTabs();
  });

  await R.step('WARP on a network that doesn’t let its port through: the next one tried, by itself, and started on next time', async () => {
    ctrl({ silentPorts: [2408] });
    const runs = fake().filter((o) => o.run).length;
    // (WARP's port answered before: this network doesn't let it through)
    await t.main(() => { const v = global.__bifrost.vpn; const s = v.readSecrets(); if (s.warp) { delete s.warp.port; v.writeSecrets(s); } });
    await set('vpn.on', false);
    await until(async () => (await status()).state === 'off', 5000, 'off');
    await set('vpn.source', 'warp');
    await set('vpn.on', true);
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
    assert(/Where you appear/.test(txt) && /Near you: Cloudflare WARP/.test(txt) && /Japan/.test(txt) && /Netherlands/.test(txt) && /Forget WARP’s sign-up/.test(txt) && /Sites that skip the VPN/.test(txt) && /Only private windows/.test(txt), txt.slice(0, 400));
    // (a location forgotten there: its row gone)
    const pl = (await status()).files.find((f) => f.country === 'PL');
    await t.main((_, id) => global.__bifrost.vpn.forget('file', id), pl.id);
    await until(() => inSettings(`!document.querySelector('.vpn-set .vpn-loc[data-loc="${pl.id}"]')`), 3000, 'Poland gone from Settings');
    assert(!(await status()).files.some((f) => f.id === pl.id), 'Poland still kept');
    // (a site added there)
    await inSettings('(() => { const i = document.querySelector(".vpn-sites input"); i.value = "https://www.Example.org/x"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 1; })()');
    await until(async () => (await status()).bypass.includes('example.org'), 3000, 'example.org skipped');
    await until(() => inSettings('/example\\.org/.test(document.querySelector(".vpn-site-list").textContent)'), 3000, 'listed');
    await t.main(() => global.__bifrost.vpn.setSkipped('example.org', false));
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
