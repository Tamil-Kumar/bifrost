// The side bar's order (src/shared/defaults.js: sideBarOrder, sideBarKeys): the usual one per tab layout,
// yours, panels that came since, ones kept off it, and keys it has nothing for.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = require(ROOT + '/src/shared/defaults.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

const panels = ['bookmarks', 'history', 'downloads', 'web:a', 'ext:x'];
check('usual order, tabs on top: the panels, +, then its settings button at the far end',
  D.sideBarKeys({ panels, horizontal: true }), ['bookmarks', 'history', 'downloads', 'web:a', 'ext:x', 'add', 'spacer', 'settings']);
check('usual order, tabs on the side: the panels and +',
  D.sideBarKeys({ panels }), ['bookmarks', 'history', 'downloads', 'web:a', 'ext:x', 'add']);
check('kept off it: + and a panel',
  D.sideBarKeys({ panels, hidden: ['add', 'history'] }), ['bookmarks', 'downloads', 'web:a', 'ext:x']);
check('your order, whatever the layout',
  D.sideBarKeys({ panels, order: ['web:a', 'downloads', 'add', 'bookmarks', 'history', 'ext:x'], horizontal: true }), ['web:a', 'downloads', 'add', 'bookmarks', 'history', 'ext:x']);
check('a panel that came since goes just before +',
  D.sideBarKeys({ panels: [...panels, 'web:new'], order: ['web:a', 'add', 'downloads', 'bookmarks', 'history', 'ext:x'] }), ['web:a', 'web:new', 'add', 'downloads', 'bookmarks', 'history', 'ext:x']);
check('…or at the end, without +',
  D.sideBarKeys({ panels: [...panels, 'web:new'], order: ['web:a', 'downloads', 'bookmarks', 'history', 'ext:x'] }), ['web:a', 'downloads', 'bookmarks', 'history', 'ext:x', 'web:new']);
check('a key it has nothing for (an extension that\'s off) isn\'t shown, but keeps its place in the order',
  [D.sideBarKeys({ panels, order: ['ext:gone', 'web:a', 'add'] }), D.sideBarOrder({ panels, order: ['ext:gone', 'web:a', 'add'] }).slice(0, 2)],
  [['web:a', 'bookmarks', 'history', 'downloads', 'ext:x', 'add'], ['ext:gone', 'web:a']]);
check('flexible spaces may repeat; anything else only once',
  D.sideBarKeys({ panels: ['bookmarks'], order: ['spacer', 'bookmarks', 'spacer', 'bookmarks', 'settings', 'settings'] }), ['spacer', 'bookmarks', 'spacer', 'settings']);
check('a panel kept off it stays off, even in your order',
  D.sideBarKeys({ panels, order: ['downloads', 'web:a', 'add'], hidden: ['downloads'] }), ['web:a', 'bookmarks', 'history', 'ext:x', 'add']);
check('the settings say “the usual order” until you arrange it',
  D.DEFAULTS.panels.order, null);

console.log(`\nside-bar: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
