chrome.runtime.sendMessage({ from: 'cs', url: location.href }, (r) => {
  document.documentElement.dataset.apicheck = JSON.stringify(r || { err: chrome.runtime.lastError && chrome.runtime.lastError.message });
});
