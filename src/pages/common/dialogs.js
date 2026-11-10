// Bifrost — dialogs and toasts, shared by the window UI and the internal pages.
// Both need an #overlay-root element (pages get one from page.js).
import { h, animate, anim } from './util.js';
import { icon } from './icons.js';

const root = () => document.getElementById('overlay-root');

// ------------------------------------------------------------------ dialog
// buttons: [{ label, value, primary, danger }]. Resolves with the clicked button's value (or dismissValue).
// The promise also has close(value), to take the dialog away from outside (its page went away…).
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], iconName, className, dismissValue = null, width }) {
  let closeIt = null;
  const p = new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      layer.classList.add('closing');   // (on its way out: what's still in the page isn't this dialog any more)
      window.removeEventListener('keydown', onKey, true);
      const out = anim('menus') ? animate(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 110, easing: 'ease-in' }, 'menus') : Promise.resolve();
      animate(back, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }, 'menus');
      out.then(() => layer.remove());
      // Focus goes back where it was, unless you've moved it meanwhile (or where it was is another dialog
      // on its way out).
      const now = document.activeElement;
      const movedOn = now && now !== document.body && !card.contains(now);
      if (!movedOn && prevFocus && document.contains(prevFocus) && !(prevFocus.closest && prevFocus.closest('.dialog-layer'))) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
      resolve(typeof v === 'function' ? v() : v);
    };
    const btns = buttons.map((b) => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { type: 'button', onclick: () => finish(b.value) }, b.label));
    const card = h('div.dialog' + (className ? '.' + className : ''), { role: 'dialog', 'aria-modal': 'true', style: width ? { width: width + 'px' } : null },
      title || iconName ? h('div.dialog-head', null, iconName ? h('span.dialog-icon', null, icon(iconName)) : null, title ? h('h2', null, title) : null) : null,
      body ? h('div.dialog-body', null, body) : null,
      btns.length ? h('div.dialog-actions', null, btns) : null);
    const back = h('div.dialog-back');
    back.addEventListener('mousedown', (e) => { if (e.target === back) finish(dismissValue); });
    const layer = h('div.dialog-layer', null, back, card);
    root().append(layer);
    if (anim('menus')) {
      animate(back, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }, 'menus');
      animate(card, [{ opacity: 0, transform: 'translateY(8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' }, 'menus');
    }
    closeIt = (v) => finish(v === undefined ? dismissValue : v);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(dismissValue); }
      else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); finish(primary.value); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Focus its field or main button now (frames can be held up while a page waits on it), and once more
    // after the first frame, unless it's been answered or you've gone elsewhere since.
    const first = () => card.querySelector('[autofocus]') || btns.find((b, i) => buttons[i].primary) || btns[0];
    const focusIt = () => { const f = first(); if (f) { f.focus(); if (f.select) f.select(); } };
    focusIt();
    requestAnimationFrame(() => {
      if (done) return;
      const a = document.activeElement;
      if (a && a !== document.body && !card.contains(a)) return;
      if (!card.contains(a)) focusIt();
    });
  });
  p.close = (v) => { if (closeIt) closeIt(v); };
  return p;
}

export function confirmDialog(text, { title = '', ok = 'OK', cancel = 'Cancel', danger = false, detail = '' } = {}) {
  return dialog({
    title: title || text, body: title ? h('p', null, text, detail ? h('br') : null, detail) : detail ? h('p', null, detail) : null,
    buttons: [{ label: cancel, value: false }, { label: ok, value: true, primary: true, danger }], dismissValue: false,
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', ok = 'Save', multiline = false, mono = false }) {
  const input = multiline
    ? h('textarea.field' + (mono ? '.mono' : ''), { rows: 10, placeholder, autofocus: true, spellcheck: 'false' })
    : h('input.field', { type: 'text', placeholder, autofocus: true, spellcheck: 'false' });
  input.value = value;
  return dialog({
    title, body: h('label.dialog-field', null, label ? h('span', null, label) : null, input),
    buttons: [{ label: 'Cancel', value: null }, { label: ok, value: () => input.value, primary: true }],
    width: multiline ? 560 : 420,
  });
}

// ------------------------------------------------------------------ toasts
let toastBox = null;
export function toast({ text, iconName, actions = [], timeout = 4200 } = {}) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); root().append(toastBox); }
  const el = h('div.toast', null,
    iconName ? h('span.toast-icon', null, icon(iconName)) : null,
    h('span.toast-text', null, text),
    actions.map((a) => h('button.toast-btn', { onclick: () => { dismiss(); a.action(); } }, a.label)),
    h('button.toast-x', { title: 'Dismiss', onclick: () => dismiss() }, icon('close')));
  toastBox.append(el);
  if (toastBox.children.length > 4) toastBox.firstChild.remove();
  animate(el, [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' }, 'toasts');
  let t = timeout ? setTimeout(() => dismiss(), timeout) : null;
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => { if (timeout) t = setTimeout(() => dismiss(), 2000); });
  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(t);
    animate(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 140, easing: 'ease-in' }, 'toasts').then(() => el.remove());
  }
  return { dismiss };
}

