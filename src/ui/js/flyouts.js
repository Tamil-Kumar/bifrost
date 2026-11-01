// Bifrost browser UI — the auto-hiding top bar and sidebar.
//
// They follow the real mouse pointer, which the main process reports ('pointer', see main/edges.js) in
// this window's coordinates, because pointer events can't be trusted at the window edge (Windows resizes
// and drags there, and over a page the UI hears nothing). A bar slides in when the pointer reaches its
// edge (and stays there for appearance.flyout.showDelay), stays while the pointer is over it or a little
// past it, while a menu from it is open or while you type in it, and slides away hideDelay after that.
import { S, on, setting } from './state.js';

const wb = window.wb;
const root = document.documentElement;
const SLACK = 18;     // px past a shown bar's edge that still count as "on it"

const cfg = () => Object.assign({ showDelay: 0, hideDelay: 300, edge: 6 }, setting('appearance.flyout') || {});
const menuOpen = () => !!document.querySelector('.menu-layer, .popover-layer:not(.passive), .launcher-layer, .dialog-layer');

function makeBar(name, el, zone) {
  const cls = name + '-peek';
  const enabled = () => root.classList.contains(name + '-autohide');
  const shown = () => root.classList.contains(cls);
  let showT = null, hideT = null, pinned = false;   // pinned: shown by the keyboard (focus), not the pointer
  const show = (now) => {
    clearTimeout(hideT); hideT = null;
    if (shown() || showT) return;
    const d = now ? 0 : Math.max(0, Number(cfg().showDelay) || 0);
    const go = () => { showT = null; root.classList.add(cls); if (name === 'topbar') wb.send('window:caption-hidden', false); };
    if (d) showT = setTimeout(go, d); else go();
  };
  const hideNow = () => { root.classList.remove(cls); if (name === 'topbar' && enabled()) wb.send('window:caption-hidden', true); };
  const hide = () => {
    clearTimeout(showT); showT = null;
    if (!shown() || hideT) return;
    hideT = setTimeout(function check() {
      hideT = null;
      if (pinned || el.contains(document.activeElement) || menuOpen()) { hideT = setTimeout(check, 200); return; }
      hideNow();
    }, Math.max(0, Number(cfg().hideDelay) || 0));
  };
  return {
    name, el, enabled, shown, show, hide,
    // The pointer moved: is it where this bar should be showing?
    pointer(p) {
      if (!enabled()) return;
      const want = p.inside && zone(p, shown());
      if (want) show(); else if (!pinned) hide();
    },
    focusIn() { if (!enabled()) return; pinned = true; show(true); },
    focusOut() { pinned = false; if (enabled()) hide(); },
    reset() { clearTimeout(showT); clearTimeout(hideT); showT = hideT = null; pinned = false; root.classList.remove(cls); },
  };
}

export function init() {
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  const content = document.getElementById('content');
  const edge = () => Math.max(2, Math.min(40, Number(cfg().edge) || 6));

  const top = makeBar('topbar', topbar, (p, isShown) => {
    const c = content.getBoundingClientRect();
    if (p.x < c.left - 2 || p.x > c.right + 2) return false;
    if (!isShown) return p.y <= edge();
    return p.y <= topbar.getBoundingClientRect().bottom + SLACK;
  });
  const side = makeBar('sidebar', sidebar, (p, isShown) => {
    const right = root.dataset.side === 'right';
    if (!isShown) return right ? p.x >= p.w - edge() : p.x <= edge();
    const r = sidebar.getBoundingClientRect();
    return right ? p.x >= r.left - SLACK : p.x <= r.right + SLACK;
  });
  const bars = [top, side];

  wb.on('pointer', (p) => { for (const b of bars) b.pointer(p); });
  for (const b of bars) {
    b.el.addEventListener('focusin', () => b.focusIn());
    b.el.addEventListener('focusout', () => setTimeout(() => { if (!b.el.contains(document.activeElement)) b.focusOut(); }, 0));
  }
  // Switching tabs from the sidebar: let it slide away once the pointer leaves.
  on('active', () => { for (const b of bars) if (b.shown()) b.hide(); });

  // Tell the main process whether to follow the pointer, and keep Windows' caption buttons in step.
  let last = null;
  const sync = () => {
    const any = bars.some((b) => b.enabled());
    if (any !== last) { last = any; wb.send('window:edges', any); }
    for (const b of bars) if (!b.enabled()) b.reset();
    if (S.platform === 'win32') wb.send('window:caption-hidden', top.enabled() && !top.shown());
  };
  on('settings', sync);
  sync();
}

// For tests: what the bars think.
export const _state = () => ({ top: root.classList.contains('topbar-peek'), side: root.classList.contains('sidebar-peek') });
