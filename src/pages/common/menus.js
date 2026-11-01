// Bifrost browser UI — context menus, dropdown menus and anchored popovers.
// Menus draw over pages too (a transparent scrim catches the click that closes them).
import { h, animate, anim } from './util.js';
import { icon } from './icons.js';

const root = () => document.getElementById('overlay-root');
let current = null; // { close }

// pos: { x, y } in window coordinates, or { anchor: element, side: 'bottom'|'top'|'right'|'left', align: 'start'|'end'|'center' }
export function place(el, pos, { gap = 6, margin = 8 } = {}) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let x, y;
  if (pos.anchor) {
    const r = pos.anchor.getBoundingClientRect();
    const side = pos.side || 'bottom', align = pos.align || 'start';
    if (side === 'bottom' || side === 'top') {
      x = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
      y = side === 'bottom' ? r.bottom + gap : r.top - hgt - gap;
      if (side === 'bottom' && y + hgt > vh - margin && r.top - hgt - gap > margin) y = r.top - hgt - gap;
      if (side === 'top' && y < margin) y = r.bottom + gap;
    } else {
      y = align === 'end' ? r.bottom - hgt : align === 'center' ? r.top + r.height / 2 - hgt / 2 : r.top;
      x = side === 'right' ? r.right + gap : r.left - w - gap;
      if (side === 'right' && x + w > vw - margin) x = r.left - w - gap;
      if (side === 'left' && x < margin) x = r.right + gap;
    }
  } else {
    x = pos.x; y = pos.y;
    if (x + w > vw - margin) x = Math.max(margin, (pos.flipX != null ? pos.flipX : x) - w);
    if (y + hgt > vh - margin) {
      // A menu at a point (a right-click) that doesn't fit below opens upward from it, like the system's
      // menus; failing that, and for submenus (lined up with their item), it moves up just enough.
      const up = (pos.flipY != null ? pos.flipY : y) - hgt;
      y = (pos.flipX == null || pos.flipY != null) && up >= margin ? up : Math.max(margin, vh - margin - hgt);
    }
  }
  x = Math.max(margin, Math.min(x, vw - w - margin));
  y = Math.max(margin, Math.min(y, vh - hgt - margin));
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  return { x, y };
}

function scrim(onClose, { modal = false } = {}) {
  const s = h('div.scrim' + (modal ? '.modal' : ''));
  const close = (e) => { e.preventDefault(); e.stopPropagation(); onClose(); };
  s.addEventListener('mousedown', close);
  s.addEventListener('contextmenu', close);
  s.addEventListener('wheel', () => onClose(), { passive: true });
  return s;
}

// ------------------------------------------------------------------- menus
// items: [{ label, icon, accel, sub, disabled, checked, toggle, danger, accent, action(), submenu: items | () => items }, '-' | { type: 'separator' }, { type: 'header', label }]
// (`toggle: true` shows `checked` as a small on/off switch at the end and keeps the item's icon.)
export function showMenu(items, pos, opts = {}) {
  closeMenus();
  const layer = h('div.menu-layer');
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const stack = []; // open menu elements (root first)
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    current = null;
    const els = stack.slice();
    const fade = anim('menus') ? animate(els[0], [{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-in' }, 'menus') : Promise.resolve();
    fade.then(() => layer.remove());
    if (opts.onClose) opts.onClose();
    if (opts.restoreFocus !== false && prevFocus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
    resolveDone();
  };
  const prevFocus = document.activeElement;

  layer.append(scrim(close));
  root().append(layer);

  function build(list, depth) {
    const menu = h('div.menu', { role: 'menu', tabIndex: -1 });
    menu.dataset.depth = depth;
    for (const it of list) {
      if (!it) continue;
      if (it === '-' || it.type === 'separator') { if (menu.lastChild && !menu.lastChild.classList.contains('menu-sep')) menu.append(h('div.menu-sep')); continue; }
      if (it.type === 'header') { menu.append(h('div.menu-header', null, it.label)); continue; }
      if (it.type === 'custom') { menu.append(it.el); continue; }
      const hasSub = !!it.submenu;
      const row = h('div.menu-item' + (it.danger ? '.danger' : '') + (it.accent ? '.accent' : '') + (it.disabled ? '.disabled' : '') + (hasSub ? '.has-sub' : ''), {
        role: it.toggle ? 'menuitemcheckbox' : 'menuitem', tabIndex: -1, 'aria-disabled': it.disabled ? 'true' : null, 'aria-checked': it.toggle ? String(!!it.checked) : null,
      },
        h('span.mi-icon', null, it.checked && !it.toggle ? icon('check') : it.iconEl ? it.iconEl : it.icon ? icon(it.icon) : null),
        h('span.mi-label', null, it.label),
        it.sub ? h('span.mi-sub', null, it.sub) : null,
        it.accel ? h('span.mi-accel', null, it.accel) : null,
        it.toggle ? h('span.mi-switch' + (it.checked ? '.on' : ''), { 'aria-hidden': 'true' }) : null,
        hasSub ? h('span.mi-arrow', null, icon('chevronRight')) : null);
      row._item = it;
      row.addEventListener('mouseenter', () => { focusRow(menu, row); if (hasSub) openSubSoon(row, depth); else closeSubs(depth); });
      row.addEventListener('click', (e) => { e.stopPropagation(); activate(row, depth, e); });
      row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); activate(row, depth, e); } });
      menu.append(row);
    }
    if (menu.lastChild && menu.lastChild.classList.contains('menu-sep')) menu.lastChild.remove();
    return menu;
  }

  function rows(menu) { return [...menu.querySelectorAll(':scope > .menu-item:not(.disabled)')]; }
  function focusRow(menu, row) {
    for (const r of menu.querySelectorAll(':scope > .menu-item.hot')) r.classList.remove('hot');
    if (row) { row.classList.add('hot'); row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  }
  let subTimer = null;
  function openSubSoon(row, depth) { clearTimeout(subTimer); subTimer = setTimeout(() => openSub(row, depth), 140); }
  function closeSubs(depth) { clearTimeout(subTimer); while (stack.length > depth + 1) stack.pop().remove(); }
  async function openSub(row, depth, focusFirst = false) {
    if (closed) return;
    closeSubs(depth);
    let list = row._item.submenu;
    if (typeof list === 'function') list = await list();
    if (closed || !row.isConnected) return;
    const sub = build(list && list.length ? list : [{ label: 'Empty', disabled: true }], depth + 1);
    layer.append(sub);
    stack.push(sub);
    const r = row.getBoundingClientRect();
    place(sub, { x: r.right - 4, y: r.top - 5, flipX: r.left + 4 });
    if (anim('menus')) animate(sub, [{ opacity: 0, transform: 'translateX(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 120 }, 'menus');
    if (focusFirst) focusRow(sub, rows(sub)[0]);
  }
  function activate(row, depth, e) {
    const it = row._item;
    if (!it || it.disabled) return;
    if (it.submenu) { openSub(row, depth, true); return; }
    if (!it.keepOpen) close();
    if (typeof it.action === 'function') {
      try { const r = it.action(e); if (r && r.catch) r.catch((err) => console.error(err)); } catch (err) { console.error(err); }
    }
  }

  let typed = '', typedTimer = null;
  function onKey(e) {
    const menu = stack[stack.length - 1];
    if (!menu) return;
    const list = rows(menu);
    const hot = menu.querySelector(':scope > .menu-item.hot');
    const i = list.indexOf(hot);
    const depth = stack.length - 1;
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); if (depth > 0) { closeSubs(depth - 1); focusRow(stack[depth - 1], stack[depth - 1].querySelector('.menu-item.hot')); } else close(); return;
      case 'ArrowDown': e.preventDefault(); e.stopPropagation(); focusRow(menu, list[(i + 1) % list.length]); return;
      case 'ArrowUp': e.preventDefault(); e.stopPropagation(); focusRow(menu, list[(i - 1 + list.length) % list.length]); return;
      case 'Home': e.preventDefault(); focusRow(menu, list[0]); return;
      case 'End': e.preventDefault(); focusRow(menu, list[list.length - 1]); return;
      case 'ArrowRight': e.preventDefault(); e.stopPropagation(); if (hot && hot._item.submenu) openSub(hot, depth, true); return;
      case 'ArrowLeft': e.preventDefault(); e.stopPropagation(); if (depth > 0) { closeSubs(depth - 1); } return;
      case 'Enter': case ' ': e.preventDefault(); e.stopPropagation(); if (hot) activate(hot, depth, e); return;
      case 'Tab': e.preventDefault(); return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          clearTimeout(typedTimer);
          typed += e.key.toLowerCase();
          typedTimer = setTimeout(() => { typed = ''; }, 700);
          const start = typed.length === 1 ? i + 1 : Math.max(0, i);
          const order = list.slice(start).concat(list.slice(0, start));
          const m = order.find((r) => r.querySelector('.mi-label').textContent.toLowerCase().startsWith(typed));
          if (m) { e.preventDefault(); focusRow(menu, m); }
        }
    }
  }

  const menu = build(items, 0);
  if (opts.className) menu.classList.add(...opts.className.split(' '));
  if (opts.minWidth) menu.style.minWidth = opts.minWidth + 'px';
  layer.append(menu);
  stack.push(menu);
  const at = place(menu, pos);
  if (anim('menus')) {
    // It grows from where it opens: a corner at the pointer (whichever way it fits), or the anchor's side.
    const origin = pos.anchor ? (pos.side === 'top' ? 'bottom' : 'top') + ' ' + (pos.align === 'end' ? 'right' : 'left')
      : (at.y < pos.y - 1 ? 'bottom' : 'top') + ' ' + (at.x < pos.x - 1 ? 'right' : 'left');
    menu.style.transformOrigin = origin;
    animate(menu, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 130, easing: 'cubic-bezier(.16,1,.3,1)' }, 'menus');
  }
  menu.focus({ preventScroll: true });
  if (opts.focusFirst) focusRow(menu, rows(menu)[0]);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  current = { close, el: menu };
  return { close, done };
}

export function closeMenus() { if (current) current.close(); }
export function menuOpen() { return !!current; }

// ---------------------------------------------------------------- popovers
// A floating panel anchored to an element. modal: a scrim closes it on outside clicks (including pages).
const openPopovers = new Set();
export function popover(content, pos, opts = {}) {
  if (opts.exclusive !== false) for (const p of [...openPopovers]) if (!p.sticky) p.close();
  const layer = h('div.popover-layer' + (opts.modal === false ? '.passive' : ''));
  const el = h('div.popover' + (opts.className ? '.' + opts.className.split(' ').join('.') : ''), { role: 'dialog', tabIndex: -1 }, content);
  let closed = false;
  const prevFocus = document.activeElement;
  const handle = {
    el, sticky: !!opts.sticky,
    close(reason) {
      if (closed) return;
      closed = true;
      openPopovers.delete(handle);
      window.removeEventListener('keydown', onKey, true);
      if (opts.modal !== false) window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', reposition);
      const fade = anim('menus') ? animate(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-3px)' }], { duration: 110, easing: 'ease-in' }, 'menus') : Promise.resolve();
      fade.then(() => layer.remove());
      if (opts.onClose) opts.onClose(reason);
      if (opts.restoreFocus !== false && prevFocus && document.contains(prevFocus) && el.contains(document.activeElement)) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
    },
    reposition() { reposition(); },
  };
  const reposition = () => { if (!closed) place(el, pos, { gap: opts.gap != null ? opts.gap : 8 }); };
  const onKey = (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); handle.close('escape'); }
  };
  const onBlur = () => handle.close('blur');
  if (opts.modal !== false) layer.append(scrim(() => handle.close('outside')));
  layer.append(el);
  root().append(layer);
  reposition();
  if (anim('menus')) animate(el, [{ opacity: 0, transform: 'translateY(-4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 150, easing: 'cubic-bezier(.16,1,.3,1)' }, 'menus');
  window.addEventListener('keydown', onKey, true);
  if (opts.modal !== false) window.addEventListener('blur', onBlur);
  window.addEventListener('resize', reposition);
  openPopovers.add(handle);
  if (opts.focus !== false) {
    const f = el.querySelector('[autofocus]') || el;
    requestAnimationFrame(() => { try { f.focus({ preventScroll: true }); if (f.select && f.hasAttribute('data-select')) f.select(); } catch { /* gone */ } });
  }
  return handle;
}

export function closePopovers() { for (const p of [...openPopovers]) p.close('closeAll'); }
