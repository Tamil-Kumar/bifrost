'use strict';
// Clear browsing data (now, or automatically when the browser closes).
const ctx = require('./context');

const SITE_STORAGES = ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'];

// local: clearing as the browser closes, which stays on this computer (sync doesn't clear your other computers' history).
async function clear(what, since = 0, { local = false } = {}) {
  const ses = ctx.mainSession;
  const done = [];
  if (what.history) {
    if (since) ctx.db.deleteHistoryRange(since, Date.now() + 1, { local }); else ctx.db.clearHistory({ local });
    require('./predictor').forget();   // which sites use which servers is history too
    done.push('history');
  }
  if (what.cookies) {
    await ses.clearStorageData({ storages: SITE_STORAGES });
    done.push('cookies');
  }
  if (what.cache) {
    await ses.clearCache();
    await ses.clearCodeCaches({}).catch(() => {});
    await ses.clearHostResolverCache().catch(() => {});
    if (!since) ctx.db.clearSiteIcons();
    done.push('cache');
  }
  if (what.downloads) { ctx.db.clearDownloads(); done.push('downloads'); }
  if (what.closedTabs) { ctx.db.db.exec('DELETE FROM closed_tabs'); done.push('closedTabs'); }
  if (what.siteSettings) { ctx.db.db.exec('DELETE FROM site_settings'); ctx.db.emit('site-settings-changed', {}); done.push('siteSettings'); }
  return done;
}

function pendingOnExit() {
  const c = ctx.settings && ctx.settings.get('privacy.clearOnExit');
  return c && (c.history || c.cookies || c.cache || c.downloads) ? c : null;
}

function onExit() { /* handled in before-quit (async) */ }

module.exports = { clear, pendingOnExit, onExit };
