// Bifrost browser UI — what the page in front looks like, for the sidebar and toolbar (Look & feel →
// Sidebar and toolbar): "Match the page" takes the color next to them, "Blur the page" shows a blurred
// picture of it behind them (theme.js applies both).
// The tab's preload says when the page may have changed (it loaded, scrolled, resized, switched theme) and
// gives a quick first guess at its colors from the page's styles. Here, the tab in front is then looked at
// for real (its pixels: main/guests.js pageLook), at most every half second, which also catches pictures,
// gradients, canvases and video along its edges, and Bifrost's own pages.
import { S, on, emit, activeTab, setting } from './state.js';
import * as V from './views.js';
import { isInternal } from './util.js';

const mode = () => setting('appearance.blend');
const wanted = () => mode() === 'page' || mode() === 'blur';
const MIN_GAP = 500;
let timer = 0, busy = false, again = false, lastAt = 0;

export function soon(delay = 0) {
  if (!wanted()) return;
  clearTimeout(timer);
  timer = setTimeout(look, Math.max(delay, MIN_GAP - (Date.now() - lastAt)));
}

async function look() {
  timer = 0;
  const t = activeTab();
  // (Not while it loads: until it has drawn itself it's a blank page. The preload's guess stands in.)
  // (Bifrost's own pages are see-through instead: theme.js.)
  if (!wanted() || !t || !t.wv || t.wcId == null || t.loading || t.error || t.crashed || t.sleeping || document.hidden || isInternal(t.url)) return;
  if (busy) { again = true; return; }
  busy = true;
  lastAt = Date.now();
  const url = t.url;
  try {
    const r = await V.guest(t, 'pageLook', { thumb: mode() === 'blur' });
    // (not a 'tab' change: nothing but the bars' colors depends on it)
    if (r && r.edges && t.url === url && S.tabs.includes(t)) { Object.assign(t, { pixelColor: r.edges, pixelColorUrl: url, pageThumb: r.thumb || null }); emit('page-look', t); }
  } catch { /* not ready yet */ }
  busy = false;
  if (again) { again = false; soon(MIN_GAP); }
}

export function init() {
  on('active', () => soon(120));
  on('tab', (t, patch) => { if (t === activeTab() && 'loading' in patch && !t.loading) soon(200); });
  on('guest-message', (t, channel) => { if (channel === 'wb-page-moved' && t === activeTab()) soon(250); });
  on('settings', (path) => { if (!path || path.startsWith('appearance')) soon(0); });
  window.addEventListener('focus', () => soon(150));
  // A blurred picture of the page follows what's on it (a video playing, a slideshow) every few seconds.
  setInterval(() => { if (mode() === 'blur' && S.focused) soon(0); }, 4000);
}
