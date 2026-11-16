'use strict';
// YouTube's ads, taken out of what YouTube sends before its page sees it, as AdGuard's app does (which answers,
// and what becomes of them: youtube-edit.js). The DevTools protocol session of a tab on YouTube (tab-debugger.js;
// other tabs have none for this) holds the YouTube answers that can carry ads as they arrive, and they go on to
// the page changed, as if YouTube had sent them so. Nothing in the page is touched for this, and YouTube's requests (and those to Google's ad servers) go
// out as YouTube makes them (adblock.js), so it hears nothing fail.
// YouTube's service worker could answer its pages' requests with what it fetched itself (the worker's requests,
// which a tab's session doesn't hold): a tab on YouTube goes past it, as DevTools' "Bypass for network" does. It
// stays registered, so its notifications still come.
// Off with the ad blocker or "Block YouTube ads" off, or YouTube allowed in the ad blocker. A tab with DevTools
// open has no session for this while they're open: an ad there is skipped in the page instead
// (preload/adblock.js), as it is in a YouTube player embedded in another site.
const { app } = require('electron');
const ctx = require('./context');
const TD = require('./tab-debugger');
const { compile } = require('./youtube-edit');

// Which answers are held and what becomes of them: the rules in use (youtube-rules.js keeps them up to date;
// the built-in ones, without it).
let builtin = null;
const rules = () => (ctx.youtubeRules ? ctx.youtubeRules.current() : builtin || (builtin = compile(require('../shared/youtube-rules.json'))));
// The answers held: YouTube's player data, Shorts' reels, its watch pages and playlists, the player's script
// (as the rules say), from YouTube's own sites.
const patterns = () => ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com']
  .flatMap((d) => rules().hold.map((p) => `*${d}${p}`))
  .map((urlPattern) => ({ urlPattern, requestStage: 'Response' }));
const MAX_BODY = 16 * 1024 * 1024;
// A page on YouTube (its short links included: a tab going to one is going to YouTube).
const YT_PAGE = /^https?:\/\/([^/?#@]*\.)?(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be)(:\d+)?([/?#]|$)/i;

const tabs = new Map();   // webContents id -> { wc, on }

function wanted() {
  const a = (ctx.settings && ctx.settings.get('privacy.adblock')) || {};
  return a.enabled !== false && a.youtubeSkip !== false;
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
// A page's site allowed in the ad blocker.
function allowed(url) {
  const ab = ctx.adblock;
  if (!ab || typeof ab.allowlisted !== 'function') return false;
  try { return ab.allowlisted(hostOf(url)); } catch { return false; }
}

const header = (headers, name) => {
  const h = (headers || []).find((x) => x && String(x.name).toLowerCase() === name);
  return h ? h.value : '';
};

// A YouTube answer, held as it arrives: on to the page, changed or as it came. Anything going wrong sends it on
// as it came (a page waiting on an answer that never comes would be worse than an ad).
async function paused(t, p) {
  const wc = t.wc;
  const send = (method, args) => wc.debugger.sendCommand(method, args);
  const onAsItCame = () => send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
  try {
    const status = Number(p.responseStatusCode) || 0;
    const url = (p.request && p.request.url) || '';
    // (a page is a page whoever asks for it)
    const page = p.resourceType === 'Document' || /^\s*text\/html/i.test(header(p.responseHeaders, 'content-type'));
    const R = rules();
    const kind = !p.responseErrorReason && status >= 200 && status < 300 && status !== 204 ? R.kindOf(url, page ? 'Document' : p.resourceType) : '';
    // (the site you're on: for a page, the one it is)
    if (!kind || !wanted() || allowed(page ? url : wc.getURL())) return onAsItCame();
    if (Number(header(p.responseHeaders, 'content-length')) > MAX_BODY) return onAsItCame();
    const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId: p.requestId });
    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    if (text.length > MAX_BODY) return onAsItCame();
    const out = R.edit(kind, text);
    if (out === text) return onAsItCame();
    // (the body as the page will read it: not compressed, its length its own)
    const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
    await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(out, 'utf8').toString('base64') });
  } catch {
    onAsItCame();
  }
}

// A tab's holding, on while it's on YouTube (or going there) and off otherwise: a tab's session costs every
// request of its pages a little, so only YouTube's tabs have one. Going past YouTube's service worker goes with
// it. Turned on as a page starts loading, before it's asked for (the commands take effect as they're sent).
const want = (url) => !!url && YT_PAGE.test(url) && wanted() && !allowed(url);
function turnOn(t) {
  const wc = t.wc;
  if (t.on || wc.isDestroyed()) return;
  try { TD.use(wc, 'youtube'); } catch { return; }   // (DevTools has its session: when they close)
  t.on = true;
  const send = (method, args) => wc.debugger.sendCommand(method, args).catch(() => {});
  send('Fetch.enable', { patterns: patterns() });
  // (what it'd hear of requests isn't kept: nothing here reads it)
  send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
  send('Network.setBypassServiceWorker', { bypass: true });
}
function turnOff(t) {
  const wc = t.wc;
  if (!t.on) return;
  t.on = false;
  if (wc.isDestroyed()) return;
  // (the session may stay, for the tab's color scheme: web-theme.js)
  try { if (wc.debugger.isAttached()) { wc.debugger.sendCommand('Network.disable').catch(() => {}); wc.debugger.sendCommand('Fetch.disable').catch(() => {}); } } catch { /* gone */ }
  TD.release(wc, 'youtube');
}
// As the page a tab has says (the settings changed, or DevTools closed).
function sync(t) {
  if (t.wc.isDestroyed()) return;
  let url = '';
  try { url = t.wc.getURL(); } catch { url = ''; }
  if (want(url)) turnOn(t); else turnOff(t);
}

// Every tab, from its first page (it's created before it starts loading one).
function setUp(wc) {
  if (tabs.has(wc.id)) return;
  const t = { wc, on: false };
  tabs.set(wc.id, t);
  wc.debugger.on('message', (_e, method, params) => { if (method === 'Fetch.requestPaused' && t.on) paused(t, params); });
  // Going to YouTube: on, before the page is asked for. (Going elsewhere: off once it's there. Until then
  // the tab still has YouTube's page.)
  wc.on('did-start-navigation', (d) => { if (d && d.isMainFrame && !d.isSameDocument && want(d.url)) turnOn(t); });
  // Sent on to YouTube by another site (a link shortener, a search result's link): a page already on its way
  // isn't held by a session opened now, so it's asked for again, from YouTube's address, with one.
  wc.on('will-redirect', (d) => {
    if (!d || !d.isMainFrame || t.on || !want(d.url)) return;
    turnOn(t);
    if (!t.on) return;
    const url = d.url;
    try { d.preventDefault(); } catch { return; }
    setImmediate(() => { if (!wc.isDestroyed()) wc.loadURL(url).catch(() => {}); });
  });
  wc.on('did-navigate', (_e, url) => { if (want(url)) turnOn(t); else turnOff(t); });
  // (DevTools opened on it: its session is theirs until they close)
  wc.debugger.on('detach', () => { t.on = false; });
  wc.on('devtools-closed', () => setTimeout(() => sync(t), 150));
  wc.once('destroyed', () => tabs.delete(wc.id));
}

function init() {
  app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'webview') setUp(wc); });
  ctx.settings.on('changed', ({ path: p }) => {
    if (p && !p.startsWith('privacy')) return;
    for (const t of tabs.values()) sync(t);
  });
  // Newer rules: the tabs on YouTube hold what those say, from their next request on.
  if (ctx.youtubeRules) {
    ctx.youtubeRules.on('changed', () => {
      for (const t of tabs.values()) {
        if (!t.on || t.wc.isDestroyed()) continue;
        try { if (t.wc.debugger.isAttached()) t.wc.debugger.sendCommand('Fetch.enable', { patterns: patterns() }).catch(() => {}); } catch { /* gone */ }
      }
    });
  }
}

// (for the tests: whether a tab's answers are being held)
const isOn = (wc) => { const t = wc && tabs.get(wc.id); return !!(t && t.on); };

module.exports = { init, patterns, isOn };
