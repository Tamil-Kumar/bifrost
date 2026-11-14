'use strict';
// A tab's DevTools protocol session (webContents.debugger), shared by the parts of Bifrost that use one
// (web-theme.js: the color scheme and dark mode pages are told; youtube-ads.js: YouTube's answers without
// their ads): attached while any of them needs it, detached when none does. Opening DevTools on a tab ends its
// session (each part hears that from the debugger's 'detach', and starts again once they close).
const users = new WeakMap();   // webContents -> the names of the parts using its session

function use(wc, who) {
  let set = users.get(wc);
  if (!set) users.set(wc, (set = new Set()));
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  set.add(who);
}

function release(wc, who) {
  const set = users.get(wc);
  if (set) set.delete(who);
  if (set && set.size) return;
  try { if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* already gone */ }
}

module.exports = { use, release };
