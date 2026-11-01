'use strict';
// Extension toolbar popups drawn inside the browser window, under their button, like Chrome's bubbles.
//
// electron-chrome-extensions opens each popup as its own frameless BrowserWindow. On Windows that's
// plainly a separate window: it takes focus from Bifrost (whose frame goes inactive), has square
// corners and no shadow. PopupHost gives the library the part of the BrowserWindow interface it uses
// (see the createHost patch in tools/vendor-patches.mjs), backed by a WebContentsView inside the parent
// window. The browser UI draws the shadow behind it ('ext-popup' messages).
const { WebContentsView } = require('electron');
const { EventEmitter } = require('node:events');
const ctx = require('../context');

const MARGIN = 6;      // keep popups this far inside the window's edges
// Until it's measured and shown, a popup's page is laid out at the largest a popup can be (its view, not
// yet in the window, has that size): as in Chrome, whose popups size themselves down to their page from
// there, scripts that look at the window's size as the popup opens see a real popup, not a 25-pixel speck.
// (Bitwarden picks its layout from it: at 25 pixels high it drew itself 240 pixels high, cut off.)
const LAYOUT = { width: 800, height: 600 };
const ESC_SIGNAL = '__bifrost:close-popup__';

class PopupHost extends EventEmitter {
  constructor(opts) {
    super();
    this.parent = opts.parent;
    this.extensionId = opts.extensionId;
    this.destroyed = false;
    this.visible = false;
    this.bounds = { x: 0, y: 0, width: 25, height: 25 };   // in screen coordinates, as the library thinks
    this.view = new WebContentsView({
      webPreferences: {
        session: opts.session, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
        contextIsolation: true, enablePreferredSizeMode: true,
      },
    });
    this.webContents = this.view.webContents;
    this.view.setBounds({ x: 0, y: 0, ...LAYOUT });   // (not in the window yet: see LAYOUT)
    this.radius = Math.max(0, Math.min(24, Number(ctx.settings.get('appearance.radius')) || 10));
    try { this.view.setBorderRadius(this.radius); } catch { /* older Electron */ }
    this.view.setBackgroundColor('#ffffff');
    this.webContents.on('blur', () => this.emit('blur'));
    this.webContents.on('focus', () => this.emit('focus'));
    // window.close() in the popup, or the page going away.
    this.webContents.on('close', () => this.destroy());
    this.webContents.on('destroyed', () => this.destroy());
    this.webContents.on('render-process-gone', () => this.destroy());
    // Moving or resizing the window, or leaving it for another app, closes the popup (as in Chrome).
    this.onParentChange = () => this.destroy();
    for (const ev of ['resize', 'move', 'minimize', 'enter-full-screen', 'leave-full-screen']) this.parent.on(ev, this.onParentChange);
    // Esc closes it, as in Chrome — unless the popup's page uses the key itself (closing a dialog of its
    // own, say). Its own listener, last in line, tells Bifrost through the console.
    this.webContents.on('dom-ready', () => {
      this.webContents.executeJavaScript(`if (!window.__bifrostEsc) { window.__bifrostEsc = true; addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) console.debug('${ESC_SIGNAL}'); }); }`).catch(() => {});
    });
    this.webContents.on('console-message', (e, ...rest) => {
      const msg = e && typeof e.message === 'string' ? e.message : (typeof rest[1] === 'string' ? rest[1] : '');
      if (msg === ESC_SIGNAL) this.destroy('key');
    });
    // Browser shortcuts (new tab, switch tabs…) still work while it has the keyboard; it closes.
    this.webContents.on('before-input-event', (e, input) => {
      let hit = null;
      try { hit = require('../guests').browserShortcut(input); } catch { hit = null; }
      if (!hit) return;
      e.preventDefault();
      const ctl = ctx.registry && ctx.registry.list().find((c) => c.win === this.parent);
      this.destroy('key');
      if (ctl) ctl.send('command', hit.id, hit.args);
    });
    PopupHost.open.add(this);
  }

  // Every popup open in a window, closed (switching tabs, clicking elsewhere in the window).
  static closeAllIn(win, reason) {
    for (const p of [...PopupHost.open]) if (!win || p.parent === win) p.destroy(reason);
  }

  // rgb()/rgba() from the page -> the view's background, so its edges match the page.
  setPageBackground(css) {
    const m = String(css).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (!m || this.destroyed) return;
    const hex = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    try { this.view.setBackgroundColor('#' + hex(m[1]) + hex(m[2]) + hex(m[3])); } catch { /* gone */ }
  }

  get id() { return -1; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible && !this.destroyed; }
  isFocused() { return !this.destroyed && this.webContents.isFocused(); }
  focus() { if (!this.destroyed) this.webContents.focus(); }
  getBounds() { return { ...this.bounds }; }
  setBounds(b) {
    if (this.destroyed) return;
    this.bounds = { ...this.bounds, ...b };
    this.apply();
  }

  // Library coordinates are screen coordinates worked out from the window's bounds; the view wants
  // coordinates inside the window's content area. Kept inside the window.
  inWindow() {
    const wb = this.parent.getBounds(), cb = this.parent.getContentBounds();
    const titlebar = wb.height - cb.height;
    const width = Math.min(this.bounds.width, Math.max(60, cb.width - 2 * MARGIN));
    const height = Math.min(this.bounds.height, Math.max(60, cb.height - 2 * MARGIN));
    let x = this.bounds.x - wb.x, y = this.bounds.y - wb.y - titlebar;
    x = Math.max(MARGIN, Math.min(x, cb.width - width - MARGIN));
    y = Math.max(MARGIN, Math.min(y, cb.height - height - MARGIN));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  apply() {
    if (this.destroyed || this.parent.isDestroyed() || !this.visible) return;
    const r = this.inWindow();
    this.view.setBounds(r);
    if (this.visible) this.tellUi(r);
  }

  show() {
    if (this.destroyed || this.parent.isDestroyed()) return;
    if (!this.visible) {
      this.visible = true;
      this.parent.contentView.addChildView(this.view);
      this.apply();
    }
    this.webContents.focus();
  }

  hide() {
    if (!this.visible || this.destroyed) return;
    this.visible = false;
    try { this.parent.contentView.removeChildView(this.view); } catch { /* window gone */ }
    this.tellUi(null);
  }

  destroy(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    PopupHost.open.delete(this);
    for (const ev of ['resize', 'move', 'minimize', 'enter-full-screen', 'leave-full-screen']) { try { this.parent.off(ev, this.onParentChange); } catch { /* gone */ } }
    if (!this.parent.isDestroyed()) { try { this.parent.contentView.removeChildView(this.view); } catch { /* gone */ } }
    this.tellUi(null);
    if (!this.webContents.isDestroyed()) { try { this.webContents.close(); } catch { /* gone */ } }
    // Remembered, so that when what closed it was a press on this extension's own button, that button's
    // click doesn't open it again straight away (see extensions:action-click). Not when a key closed it.
    if (reason !== 'key' && reason !== 'switch') PopupHost.lastClosed = { id: this.extensionId, at: Date.now() };
    this.emit('closed');
  }

  // The browser UI draws a shadow behind the popup, and knows when it's gone.
  tellUi(rect) {
    const ctl = ctx.registry && ctx.registry.list().find((c) => c.win === this.parent);
    if (ctl) ctl.send('ext-popup', rect ? { ...rect, radius: this.radius, id: this.extensionId } : null);
  }
}
PopupHost.lastClosed = { id: '', at: 0 };
PopupHost.open = new Set();
// (The tests look at open popups through this.)
if (process.env.BIFROST_TEST === '1') global.__bifrostPopups = PopupHost.open;

module.exports = { PopupHost };
