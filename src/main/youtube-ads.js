'use strict';
// YouTube's ads, taken out of what YouTube sends before its page sees it, as AdGuard's app does (which answers,
// and what becomes of them: youtube-edit.js). Each tab's DevTools protocol session (tab-debugger.js) holds the
// YouTube answers that can carry ads as they arrive, and they go on to the page changed, as if YouTube had sent
// them so. Nothing in the page is touched for this, and YouTube's requests (and those to Google's ad servers) go
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
const Y = require('./youtube-edit');

// The answers held: YouTube's player data, Shorts' reels, its watch pages and playlists, the player's script.
const PATTERNS = ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'].flatMap((d) => [
  `*${d}/youtubei/v1/player*`, `*${d}/youtubei/v1/get_watch*`, `*${d}/youtubei/v1/reel/*`,
  `*${d}/watch?*`, `*${d}/playlist?*`, `*${d}/s/player/*base.js*`,
]).map((urlPattern) => ({ urlPattern, requestStage: 'Response' }));
const MAX_BODY = 16 * 1024 * 1024;
// A page on YouTube (its short links included: a tab going to one is going to YouTube).
const YT_PAGE = /^https?:\/\/([^/?#@]*\.)?(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be)(:\d+)?([/?#]|$)/i;

const tabs = new Map();   // webContents id -> { wc, on, past }

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
    const kind = !p.responseErrorReason && status >= 200 && status < 300 && status !== 204 ? Y.kindOf(url, page ? 'Document' : p.resourceType) : '';
    // (the site you're on: for a page, the one it is)
    if (!kind || !wanted() || allowed(page ? url : wc.getURL())) return onAsItCame();
    if (Number(header(p.responseHeaders, 'content-length')) > MAX_BODY) return onAsItCame();
    const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId: p.requestId });
    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    if (text.length > MAX_BODY) return onAsItCame();
    const out = Y.edit(kind, text);
    if (out === text) return onAsItCame();
    // (the body as the page will read it: not compressed, its length its own)
    const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
    await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(out, 'utf8').toString('base64') });
  } catch {
    onAsItCame();
  }
}

// Past YouTube's service worker, or not, for the page a tab has or is going to. Set as a page starts loading,
// before it's asked for (the commands take effect as they're sent).
function goPast(t, url) {
  const want = !!(t.on && url && YT_PAGE.test(url)) && !allowed(url);
  if (want === t.past) return;
  t.past = want;
  const send = (method, args) => t.wc.debugger.sendCommand(method, args).catch(() => {});
  if (want) {
    // (what it'd hear of requests isn't kept: nothing here reads it)
    send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
    send('Network.setBypassServiceWorker', { bypass: true });
  } else {
    send('Network.disable');
  }
}

// A tab's holding on or off, as the settings say.
async function sync(t) {
  const wc = t.wc;
  if (wc.isDestroyed()) return;
  const want = wanted();
  if (want && !t.on) {
    try {
      TD.use(wc, 'youtube');
      t.on = true;
      goPast(t, wc.getURL());
      await wc.debugger.sendCommand('Fetch.enable', { patterns: PATTERNS });
    } catch {
      t.on = false;
      t.past = false;
    }
  } else if (!want && t.on) {
    goPast(t, '');
    t.on = false;
    try { await wc.debugger.sendCommand('Fetch.disable'); } catch { /* gone */ }
    TD.release(wc, 'youtube');
  } else if (t.on) {
    goPast(t, wc.getURL());   // (YouTube allowed in the ad blocker now, or not)
  }
}

// Every tab, from its first page (it's created before it starts loading one).
function setUp(wc) {
  if (tabs.has(wc.id)) return;
  const t = { wc, on: false, past: false };
  tabs.set(wc.id, t);
  wc.debugger.on('message', (_e, method, params) => { if (method === 'Fetch.requestPaused' && t.on) paused(t, params); });
  wc.on('did-start-navigation', (d) => { if (d && d.isMainFrame && !d.isSameDocument) goPast(t, d.url); });
  wc.on('did-redirect-navigation', (d) => { if (d && d.isMainFrame) goPast(t, d.url); });
  wc.on('did-navigate', (_e, url) => goPast(t, url));
  // (DevTools opened on it: its session is theirs until they close)
  wc.debugger.on('detach', () => { t.on = false; t.past = false; });
  wc.on('devtools-closed', () => setTimeout(() => sync(t), 150));
  wc.once('destroyed', () => tabs.delete(wc.id));
  sync(t);
}

function init() {
  app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'webview') setUp(wc); });
  ctx.settings.on('changed', ({ path: p }) => {
    if (p && !p.startsWith('privacy')) return;
    for (const t of tabs.values()) sync(t);
  });
}

module.exports = { init, PATTERNS };
