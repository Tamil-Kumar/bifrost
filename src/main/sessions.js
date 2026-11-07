'use strict';
// Configures a browsing session (persist:main, or an in-memory one per private window).
const { session } = require('electron');
const ctx = require('./context');
const protocol = require('./protocol');
const ua = require('./useragent');
const { hubFor } = require('./webrequest');
const permissions = require('./permissions');
const downloads = require('./downloads');

const configured = new WeakSet();
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+)$/i;

function setup(ses, { isPrivate = false } = {}) {
  if (configured.has(ses)) return ses;
  configured.add(ses);
  protocol.attach(ses);
  ses.setUserAgent(ua.defaultUA());
  const hub = hubFor(ses);

  // HTTPS-only: upgrade top-level http:// navigations (not local addresses or exempt sites).
  hub.before.push((d) => {
    if (d.resourceType !== 'mainFrame' || !ctx.settings.get('privacy.httpsOnly')) return;
    if (!/^http:\/\//i.test(d.url)) return;
    let u;
    try { u = new URL(d.url); } catch { return; }
    if (LOCAL.test(u.hostname)) return;
    if (ctx.db.siteSettings(u.hostname).httpAllowed) return;
    u.protocol = 'https:';
    return { redirectURL: u.toString() };
  });

  // Privacy headers and per-site user agents.
  hub.sendHeaders.push((d, headers) => {
    const p = ctx.settings.get('privacy');
    if (p.doNotTrack) headers['DNT'] = '1';
    if (p.globalPrivacyControl) headers['Sec-GPC'] = '1';
    if (!p.sendReferrer) delete headers['Referer'];
    ua.headerHook(d, headers);
  });

  if (ctx.adblock) ctx.adblock.attach(ses, hub);
  // (Ahead of everything else: a dangerous page is stopped before anything learns of it.)
  if (ctx.safety) ctx.safety.attach(ses, hub);
  // After the ad blocker, so blocked requests are never learned; private windows learn nothing.
  if (!isPrivate) require('./predictor').attach(ses, hub);
  permissions.attach(ses, { isPrivate });
  // (notifications from websites' service workers: Electron would drop them)
  require('./notifications').attach(ses);
  downloads.attach(ses, { isPrivate });
  applySpellcheck(ses);
  applyProxy(ses);
  if (ctx.extensions && !isPrivate) ctx.extensions.attachSession(ses, hub);
  return ses;
}

function applySpellcheck(ses) {
  if (process.platform === 'darwin') return;
  const langs = ctx.settings.get('advanced.spellcheckLanguages') || ['en-US'];
  try {
    const available = ses.availableSpellCheckerLanguages;
    const use = langs.filter((l) => !available.length || available.includes(l));
    ses.setSpellCheckerLanguages(use.length ? use : ['en-US']);
    ses.setSpellCheckerEnabled(ctx.settings.get('advanced.spellcheck'));
  } catch (e) { console.warn('[spellcheck]', e.message); }
}

function applyProxy(ses) {
  const p = ctx.settings.get('advanced.proxy');
  const cfg = p.mode === 'direct' ? { mode: 'direct' }
    : p.mode === 'fixed' && p.rules ? { mode: 'fixed_servers', proxyRules: p.rules, proxyBypassRules: p.bypass || '' }
      : p.mode === 'pac' && p.rules ? { mode: 'pac_script', pacScript: p.rules }
        : { mode: 'system' };
  ses.setProxy(cfg).catch((e) => console.warn('[proxy]', e.message));
}

// Re-applies settings that live on sessions after they change.
function refreshAll(changedPath) {
  const sessions = [ctx.mainSession, ...ctx.registry.list().filter((c) => c.isPrivate).map((c) => c.ses)].filter(Boolean);
  if (!changedPath || changedPath.startsWith('advanced')) { try { const { session } = require('electron'); applyProxy(session.fromPartition('bifrost-icons')); } catch { /* not ready */ } }
  for (const ses of sessions) {
    if (!changedPath || changedPath.startsWith('advanced')) {
      ses.setUserAgent(ua.defaultUA());
      applySpellcheck(ses);
      applyProxy(ses);
    }
  }
}

module.exports = { setup, refreshAll, applyProxy };
