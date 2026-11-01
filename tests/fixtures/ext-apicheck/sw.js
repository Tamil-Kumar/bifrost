// Reports the service worker's chrome.* namespaces, then answers the content script with the results of
// a few real calls (permissions, windows, tabs, contextMenus, storage, alarms).
const keys = (o) => Object.keys(o || {}).sort();
console.log('APICHECK ' + JSON.stringify({ chrome: keys(chrome), tabs: keys(chrome.tabs), windows: keys(chrome.windows) }));

chrome.runtime.onInstalled.addListener((d) => {
  console.log('APICHECK-INSTALLED ' + JSON.stringify(d));
  chrome.contextMenus.create({ id: 'apicheck-item', title: 'API check item', contexts: ['page', 'link'] }, () => void chrome.runtime.lastError);
  // A parent with a child, a checkbox, and an item hidden until the child is clicked.
  chrome.contextMenus.create({ id: 'apicheck-parent', title: 'API check parent', contexts: ['page'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'apicheck-child', parentId: 'apicheck-parent', title: 'API check child', contexts: ['page'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'apicheck-check', type: 'checkbox', checked: false, title: 'API check box', contexts: ['page'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'apicheck-hidden', title: 'API check hidden', visible: false, contexts: ['page'] }, () => void chrome.runtime.lastError);
});
chrome.runtime.onStartup.addListener(() => console.log('APICHECK-STARTUP'));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  chrome.storage.local.set({ clicked: info.menuItemId });
  console.log('APICHECK-CLICK ' + JSON.stringify({ menuItemId: info.menuItemId, parentMenuItemId: info.parentMenuItemId, frameId: info.frameId, checked: info.checked, wasChecked: info.wasChecked, tab: tab && tab.url }));
  if (info.menuItemId === 'apicheck-child') {
    chrome.contextMenus.update('apicheck-child', { title: 'API check child (clicked)' });
    chrome.contextMenus.update('apicheck-hidden', { visible: true });
  }
});
// What many extensions do when you change tabs (update their badge or menu for the page now in front).
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const [front] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('APICHECK-ACTIVATED ' + JSON.stringify({ tabId, front: front ? front.id : null, url: front ? front.url : null }));
});

// Storage and alarm events (Electron before 44.10 never delivers these to workers; Bifrost does).
const heard = (o) => console.log('APICHECK-EVENT ' + JSON.stringify(o));
chrome.storage.onChanged.addListener((changes, area) => heard({ via: 'storage.onChanged', area, keys: Object.keys(changes) }));
chrome.storage.local.onChanged.addListener((changes) => heard({ via: 'storage.local.onChanged', keys: Object.keys(changes) }));
chrome.storage.session.onChanged.addListener((changes) => heard({ via: 'storage.session.onChanged', keys: Object.keys(changes) }));
chrome.alarms.onAlarm.addListener((a) => heard({ via: 'alarms.onAlarm', name: a.name }));

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.from !== 'cs') return;
  (async () => {
    const out = { sender: { tabId: sender.tab && sender.tab.id, url: sender.url, frameId: sender.frameId } };
    const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'ERR ' + (e && e.message); } };
    await step('permsTabs', () => chrome.permissions.contains({ permissions: ['tabs'] }));
    await step('permsAll', () => chrome.permissions.getAll().then((p) => (p.permissions || []).length));
    await step('window', () => chrome.windows.getLastFocused().then((w) => typeof w.id === 'number'));
    await step('activeTab', () => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => (t[0] && t[0].url) || null));
    await step('tabById', () => chrome.tabs.get(sender.tab.id).then((t) => t.url));
    await step('storage', async () => { await chrome.storage.local.set({ a: 1 }); return (await chrome.storage.local.get('a')).a; });
    await step('alarm', async () => { await chrome.alarms.create('apicheck', { delayInMinutes: 1 }); return !!(await chrome.alarms.get('apicheck')); });
    await step('script', () => chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, func: () => document.title }).then((r) => r[0] && r[0].result));
    respond(out);
  })();
  return true;
});
