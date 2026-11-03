// The launcher's ranking (shared/engine.js): what you use more comes first. Visits, recency, and what you
// opened from the launcher (picks), most of all for what you'd typed to find it.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = require(path.join(ROOT, 'src', 'shared', 'engine.js'));
const D = require(path.join(ROOT, 'src', 'shared', 'defaults.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const DAY = 864e5, now = Date.now();
const ENGINE = { name: 'Google', url: 'https://www.google.com/search?q=%s' };

// Three bookmarks that match "docs" exactly as well, added a year ago.
function world({ visits = {}, picks = null } = {}) {
  const bookmarks = [
    { id: 1, title: 'Docs alpha', url: 'https://alpha.example/', path: ['Bar'], dateAdded: now - 365 * DAY },
    { id: 2, title: 'Docs beta', url: 'https://beta.example/', path: ['Bar'], dateAdded: now - 365 * DAY },
    { id: 3, title: 'Docs gamma', url: 'https://gamma.example/', path: ['Bar'], dateAdded: now - 365 * DAY },
  ].map((b) => E.prep(b));
  const visitIndex = new Map();
  for (const [url, [n, daysAgo]] of Object.entries(visits)) {
    const h = E.prep({ url, title: url, visitCount: n, lastVisitTime: now - daysAgo * DAY });
    visitIndex.set(h.key, h);
  }
  return { bookmarks, visitIndex, redirects: new Map(), picks: picks || { byKey: new Map(), byInput: new Map() }, tabs: [], tabByKey: new Map(), commands: [], activeTab: null, cache: {} };
}
function picks(list) {
  // list: [[typed, url, times, daysAgo]]
  const byKey = new Map(), byInput = new Map();
  for (const [typed, url, n, daysAgo = 0] of list) {
    const p = E.prep({ url });
    const last = now - daysAgo * DAY;
    const e = byKey.get(p.key) || { n: 0, last: 0, pk: p.pk };
    byKey.set(p.key, { n: e.n + n, last: Math.max(e.last, last), pk: p.pk });
    if (typed) {
      const m = byInput.get(typed) || new Map();
      m.set(p.key, { n, last });
      byInput.set(typed, m);
    }
  }
  return { byKey, byInput };
}
const L0 = () => Object.assign(clone(D.DEFAULTS.launcher), { sources: Object.assign(clone(D.DEFAULTS.launcher.sources), { suggestions: { enabled: false, weight: 0.55, max: 5 } }) });
const order = (raw, ctx, L = L0()) => {
  const q = E.parseQuery(raw, L, []);
  return E.rank(q, L, E.searchLocal(q, L, ctx), [], ctx, ENGINE).filter((it) => it.type !== 'search').map((it) => it.title.replace('Docs ', ''));
};

check('with nothing to go on, equal matches tie (in the order they come)', () => {
  const o = order('docs', world());
  assert(o.length === 3, JSON.stringify(o));
});

check('the bookmark you visit more comes first, typing', () => {
  const ctx = world({ visits: { 'https://gamma.example/page': [12, 1], 'https://beta.example/': [3, 1] } });
  const o = order('docs', ctx);
  assert(o.join() === 'gamma,beta,alpha', o.join());
});

check('…and before you type ("Most-used bookmarks")', () => {
  const ctx = world({ visits: { 'https://gamma.example/x': [12, 1], 'https://beta.example/': [3, 1] } });
  const L = Object.assign(L0(), { emptyState: 'bookmarks' });
  const o = E.startState(L, ctx).filter((it) => it.type === 'bookmark').map((it) => it.title.replace('Docs ', ''));
  assert(o.join() === 'gamma,beta,alpha', o.join());
});

check('visits to a page under the bookmark count for it (github.com/me → the repo)', () => {
  const ctx = world({ visits: { 'https://alpha.example/deep/page?x=1': [20, 2] } });
  const o = order('docs', ctx);
  assert(o[0] === 'alpha', o.join());
});

check('a recent visit beats an old one with the same count', () => {
  const ctx = world({ visits: { 'https://beta.example/': [5, 1], 'https://gamma.example/': [5, 90] } });
  const o = order('docs', ctx);
  assert(o.indexOf('beta') < o.indexOf('gamma'), o.join());
});

check('Visit count at 0 and Recency at 0: only the match counts', () => {
  const ctx = world({ visits: { 'https://gamma.example/': [50, 0] } });
  const L = Object.assign(L0(), { wVisits: 0, wRecency: 0 });
  const q = E.parseQuery('docs', L, []);
  const items = E.searchLocal(q, L, ctx);
  const scores = new Set(items.map((it) => it.score.toFixed(6)));
  assert(scores.size === 1, 'scores differ: ' + [...scores].join(', '));
});

check('opening a bookmark from the launcher counts as using it (no visits needed)', () => {
  const ctx = world({ picks: picks([['', 'https://beta.example/', 4]]) });
  const o = order('docs', ctx);
  assert(o[0] === 'beta', o.join());
});

check('what you opened for what you typed comes first for it, over a more visited one', () => {
  const ctx = world({ visits: { 'https://gamma.example/': [30, 0] }, picks: picks([['docs', 'https://alpha.example/', 3]]) });
  const o = order('docs', ctx);
  assert(o[0] === 'alpha', o.join());
});

check('…and for the start of it, and a little more of it', () => {
  const ctx = world({ visits: { 'https://gamma.example/': [30, 0] }, picks: picks([['doc', 'https://alpha.example/', 3]]) });
  assert(order('do', ctx)[0] === 'alpha', 'typing "do": ' + order('do', ctx).join());
  assert(order('docs', ctx)[0] === 'alpha', 'typing "docs": ' + order('docs', ctx).join());
});

check('…but not for something else you type', () => {
  const ctx = world({ visits: { 'https://gamma.example/': [30, 0] }, picks: picks([['alpha', 'https://alpha.example/', 3]]) });
  // (typing "docs": alpha was opened for "alpha", not for this; its picks still count as use, so it's second)
  const o = order('docs', ctx);
  assert(o[0] === 'gamma', o.join());
});

check('Learn from what you open off: picks change nothing', () => {
  const ctx = world({ visits: { 'https://gamma.example/': [30, 0] }, picks: picks([['docs', 'https://alpha.example/', 9]]) });
  const L = Object.assign(L0(), { learnPicks: false });
  assert(order('docs', ctx, L)[0] === 'gamma', order('docs', ctx, L).join());
});

check('a command you run from the launcher comes first for what you typed to find it', () => {
  const ctx = world();
  ctx.commands = D.COMMANDS.filter((c) => /split/i.test(c.title)).map((c) => E.prep({ id: c.id, title: c.title, category: c.category, url: '', keys: c.keys }));
  const L = L0();
  const q = E.parseQuery('split', L, []);
  const first = (c) => E.rank(q, L, E.searchLocal(q, L, c), [], c, ENGINE).filter((it) => it.type === 'command')[0];
  const before = first(ctx);
  const other = ctx.commands.find((c) => c.id !== before.command);
  ctx.picks = { byKey: new Map(), byInput: new Map([['split', new Map([['cmd:' + other.id, { n: 3, last: now }]])]]) };
  ctx.cache = {};
  const after = first(ctx);
  assert(after.command === other.id, `${before.command} stayed first, not ${other.id}`);
});

console.log(`\nranking: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
