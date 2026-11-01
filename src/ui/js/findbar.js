// Bifrost browser UI — find in page.
import { on, activeTab } from './state.js';
import { h, animate } from './util.js';
import { icon } from './icons.js';
import * as V from './views.js';

let bar = null, input, countEl, caseBtn;
let current = null; // tab the bar is showing for

function build() {
  input = h('input.find-input', { type: 'text', spellcheck: 'false', placeholder: 'Find in page', 'aria-label': 'Find in page' });
  countEl = h('span.find-count');
  caseBtn = h('button.icon-btn.find-case', { type: 'button', title: 'Match case' }, 'Aa');
  const prev = h('button.icon-btn', { type: 'button', title: 'Previous (Shift+Enter)' }, icon('chevronUp'));
  const next = h('button.icon-btn', { type: 'button', title: 'Next (Enter)' }, icon('chevronDown'));
  const close = h('button.icon-btn', { type: 'button', title: 'Close (Esc)' }, icon('close'));
  bar = h('div.findbar', { hidden: true, role: 'search' }, h('span.find-lens', null, icon('search')), input, countEl, caseBtn, prev, next, close);
  document.getElementById('stage-ui').append(bar);
  input.addEventListener('input', () => search(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(!e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  caseBtn.addEventListener('click', () => {
    const t = current;
    if (!t) return;
    t.find.matchCase = !t.find.matchCase;
    caseBtn.classList.toggle('on', t.find.matchCase);
    search(true);
    input.focus();
  });
  for (const b of [prev, next, close, caseBtn]) b.addEventListener('mousedown', (e) => e.preventDefault());
  prev.addEventListener('click', () => step(false));
  next.addEventListener('click', () => step(true));
  close.addEventListener('click', () => closeFind());
}

function search(fresh) {
  const t = current;
  if (!t || !t.wv) return;
  const text = input.value;
  t.find.text = text;
  if (!text) { V.call(t, 'stopFindInPage', 'clearSelection'); countEl.textContent = ''; bar.classList.remove('none'); return; }
  V.call(t, 'findInPage', text, { forward: true, findNext: !!fresh, matchCase: !!t.find.matchCase });
}

function step(forward) {
  const t = current;
  if (!t || !t.wv || !input.value) return;
  V.call(t, 'findInPage', input.value, { forward, findNext: false, matchCase: !!t.find.matchCase });
}

function position() {
  const t = current;
  if (!bar || !t || !t.pane || t.pane.el.hidden) return;
  const stage = document.getElementById('stage').getBoundingClientRect();
  const pr = t.pane.el.getBoundingClientRect();
  bar.style.right = Math.max(8, stage.right - pr.right + 12) + 'px';
  bar.style.top = (pr.top - stage.top + (t.pane.el.classList.contains('in-split') ? 34 : 10)) + 'px';
}

export function openFind(t = activeTab(), { text = null } = {}) {
  if (!t) return;
  if (!bar) build();
  if (!t.wv) return;
  if (!t.find) t.find = { text: '', matchCase: false, open: false };
  const was = !bar.hidden && current === t;
  current = t;
  t.find.open = true;
  bar.hidden = false;
  caseBtn.classList.toggle('on', !!t.find.matchCase);
  if (text != null) t.find.text = text;
  if (!was) {
    input.value = t.find.text || '';
    countEl.textContent = '';
    position();
    animate(bar, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 140 }, 'menus');
    if (input.value) search(true);
  }
  input.focus();
  input.select();
}

export function closeFind({ focusPage = true } = {}) {
  const t = current;
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  if (t) {
    t.find.open = false;
    V.call(t, 'stopFindInPage', 'keepSelection');
    if (focusPage) V.focusView(t);
  }
  current = null;
}

export function findNext(forward = true) {
  const t = activeTab();
  if (!t) return;
  if (!bar || bar.hidden || current !== t) { openFind(t); if (!input.value) return; }
  step(forward);
}

export function init() {
  on('found-in-page', (t, result) => {
    if (t !== current || !result) return;
    const n = result.matches || 0;
    countEl.textContent = input.value ? (n ? `${result.activeMatchOrdinal || 0}/${n}` : 'No matches') : '';
    bar.classList.toggle('none', !!input.value && !n && result.finalUpdate !== false);
  });
  on('active', (t) => {
    if (!bar) return;
    if (current && current !== t) { bar.hidden = true; current = null; }
    if (t && t.find && t.find.open && t.wv) openFind(t);
  });
  on('layout', () => position());
  on('navigated', (t) => { if (t === current) { countEl.textContent = ''; } });
  window.addEventListener('resize', position);
}
