// Bifrost's VPN in Bifrost itself, with its real helper and Cloudflare WARP (Windows; needs playwright-core):
// turned on as you would (WARP, the terms agreed to), connected; a tab's page through it (Cloudflare's trace page
// says warp=on, with another address than straight), WebRTC only through it; a page's load time through it and
// straight; then off (warp=off), and WARP's sign-up forgotten (taken off Cloudflare's list).
//   node tools/vpn/bifrost-check.mjs [--runtime=<folder with electron.exe>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const log = (m) => console.log('[vpn-in-bifrost] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { _electron } = require('playwright-core');

function runtime() {
  if (arg('runtime')) return path.join(path.resolve(arg('runtime')), 'electron.exe');
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.electron;
  const base = `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(v)}/`;
  const cache = path.join(os.homedir(), 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const name = `electron-v${v}-win32-x64.zip`;
  const get = (url, file) => { if (!fs.existsSync(file)) execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file, url], { stdio: 'inherit' }); };
  const sums = path.join(cache, `SHASUMS256-${v}.txt`);
  get(base + 'SHASUMS256.txt', sums);
  const zip = path.join(cache, name);
  get(base + encodeURIComponent(name), zip);
  const want = new RegExp(`^([0-9a-f]{64}) \\*?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(fs.readFileSync(sums, 'utf8'));
  if (!want || want[1] !== crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')) throw new Error(name + " doesn't match its checksum");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-vpn-electron-'));
  require(path.join(ROOT, 'src', 'main', 'unzip.js')).unzip(zip, dir);
  return path.join(dir, 'electron.exe');
}

const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(250); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + JSON.stringify(last).slice(0, 300) + ')' : ''));
};

let failed = false;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-vpn-profile-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ onboarding: { done: true }, tabs: { restoreOnStartup: 'newtab' } }));
// (BIFROST_VPN_WARP_PORTS from the environment: a dead port first, to see Bifrost go on to the next by itself)
const app = await _electron.launch({ executablePath: runtime(), args: [ROOT, `--profile=${profile}`], env: { ...process.env, BIFROST_TEST: '1' }, timeout: 90000 });
const main = (fn, a) => app.evaluate(fn, a);
try {
  await until(() => main(() => !!(global.__bifrost && global.__bifrost.vpn && global.__bifrost.isStarted)), 60000, 'Bifrost to start');
  const avail = await main(() => global.__bifrost.vpn.status());
  if (!avail.available) throw new Error('the helper isn’t there (assets/bin/bifrost-vpn-x64.exe)');
  // A page in a tab: its text once loaded.
  let n = 0;
  const page = async (url) => {
    const full = url + (url.includes('?') ? '&' : '?') + 'n=' + ++n;
    const t0 = Date.now();
    await main((_e, u) => global.__bifrost.registry.list().find((c) => !c.isPrivate).send('open-url', { url: u }), full);
    // (the tab, wherever it's gone since: a redirect, a check of Cloudflare's, an error page)
    const id = await until(() => main(({ webContents }, k) => { const w = webContents.getAllWebContents().find((x) => x.getType() === 'webview' && !x.getURL().startsWith('bifrost:') && (x.getURL().includes('n=' + k) || x.getURL().startsWith('chrome-error'))); return w && !w.isLoading() ? w.id : null; }, n), 60000, full);
    const ms = Date.now() - t0;
    const text = await main(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.body ? document.body.innerText : ""'), id).catch(() => '');
    const rtc = await main(({ webContents }, id) => webContents.fromId(id).getWebRTCIPHandlingPolicy(), id).catch(() => '?');
    await main(({ webContents }, id) => webContents.fromId(id).close(), id).catch(() => {});
    return { text, ms, rtc };
  };
  const trace = async () => { const p = await page('https://www.cloudflare.com/cdn-cgi/trace'); const g = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(p.text) || [])[1]; return { warp: g('warp'), ip: g('ip'), loc: g('loc'), colo: g('colo'), rtc: p.rtc, ms: p.ms }; };

  const before = await trace().catch((e) => ({ warp: '?', ip: '?', rtc: '?', err: e.message }));
  log(`straight: warp=${before.warp}, ip ${before.ip}, WebRTC ${before.rtc}${before.err ? ' (' + before.err + ')' : ''}`);
  const straightLoad = (await page('https://example.com/').catch(() => ({ ms: NaN }))).ms;

  const t0 = Date.now();
  await main(() => { const s = global.__bifrost.settings; s.set('vpn.source', 'warp'); s.set('vpn.warpTerms', true); s.set('vpn.on', true); });
  const st = await until(async () => { const s = await main(() => global.__bifrost.vpn.status()); if (s.state === 'error') throw new Error(s.error); return s.state === 'connected' ? s : null; }, 60000, 'connected');
  log(`connected in ${((Date.now() - t0) / 1000).toFixed(1)} s (sign-up included), endpoint ${st.endpoint}`);
  if (process.env.BIFROST_VPN_WARP_PORTS && !st.endpoint.endsWith(':' + process.env.BIFROST_VPN_WARP_PORTS.split(',')[1])) { failed = true; log('✗ not on the next port: ' + st.endpoint); }
  const on = await trace();
  log(`through the VPN: warp=${on.warp}, ip ${on.ip}, ${on.colo}, WebRTC ${on.rtc}`);
  if (on.warp !== 'on' || on.ip === before.ip) { failed = true; log('✗ the tab didn’t go through WARP'); }
  if (on.rtc !== 'disable_non_proxied_udp') { failed = true; log('✗ WebRTC: ' + on.rtc); }
  // (where sites see you, as the popover says: the helper's own look at the trace page)
  const said = await until(async () => (await main(() => global.__bifrost.vpn.status())).seen, 20000, 'where sites see you').catch(() => null);
  log(said ? `Bifrost says sites see you in ${said.loc} (${said.ip}); the tab’s trace page: ${on.loc} (${on.ip})` : 'Bifrost didn’t say where sites see you');
  if (!said || said.loc !== on.loc) { failed = true; log('✗ where sites see you'); }
  const vpnLoad = (await page('https://example.com/')).ms;
  log(`example.com: ${vpnLoad} ms through the VPN, ${straightLoad} ms straight`);

  await main(() => global.__bifrost.settings.set('vpn.on', false));
  await until(async () => (await main(() => global.__bifrost.vpn.status())).state === 'off', 10000, 'off');
  const off = await trace();
  log(`off again: warp=${off.warp}, ip ${off.ip}, WebRTC ${off.rtc}`);
  if (off.warp === 'on') { failed = true; log('✗ still through WARP when off'); }
  await main(() => global.__bifrost.vpn.forget('warp'));
  await sleep(4000);
} catch (e) {
  failed = true;
  log('✗ ' + (e && e.message || e));
} finally {
  await Promise.race([app.close().catch(() => {}), sleep(8000)]);
  try { execFileSync('taskkill', ['/F', '/T', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { /* none left */ }
}
log(failed ? '✗ the VPN in Bifrost didn’t work' : '✓ the VPN in Bifrost, through Cloudflare WARP');
process.exit(failed ? 1 : 0);
