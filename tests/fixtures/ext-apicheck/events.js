// An extension page that changes storage and sets an alarm: the service worker should hear all of it.
(async () => {
  const n = Date.now();
  await chrome.storage.local.set({ fromPage: n });
  await chrome.storage.session.set({ fromPageSession: n });
  await chrome.alarms.create('fromPage', { when: Date.now() + 300 });
  document.title = 'API check events done';
})();
