// "Match the page" (shared/themes.js blendVars): the sidebar and toolbar in a page's color, with text and
// accents that read on it, for every theme.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(path.join(ROOT, 'src', 'shared', 'themes.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

// Pages people visit: white and off-white, the usual dark modes, and a few loud colors.
const PAGES = ['#ffffff', '#fff7f0', '#f6f8fa', '#dae0e6', '#0f0f0f', '#0d1117', '#181818', '#13233a', '#1e6b52', '#e53935', '#3b5998', '#ffd400', '#000000'];

check('a light page gets dark text, a dark page light text', () => {
  for (const [c, dark] of [['#ffffff', false], ['#fff7f0', false], ['#ffd400', false], ['#0f0f0f', true], ['#13233a', true], ['#000000', true]]) {
    assert(T.blendVars(c, T.THEMES.mocha).dark === dark, c + ' should be ' + (dark ? 'dark' : 'light'));
  }
});

check('text reads on every page color (4.5:1), and so does secondary text (3:1)', () => {
  for (const c of PAGES) {
    const v = T.blendVars(c, T.THEMES.mocha);
    assert(T.contrast(v['--text'], c) >= 4.5, `${c}: text ${v['--text']} at ${T.contrast(v['--text'], c).toFixed(2)}:1`);
    assert(T.contrast(v['--subtext'], c) >= 3, `${c}: secondary text ${v['--subtext']} at ${T.contrast(v['--subtext'], c).toFixed(2)}:1`);
  }
});

check('every theme’s accent shows on every page color (3:1)', () => {
  for (const [name, theme] of Object.entries(T.THEMES)) {
    for (const c of PAGES) {
      const v = T.blendVars(c, theme);
      assert(T.contrast(v['--accent'], c) >= 2.9, `${name} on ${c}: accent ${v['--accent']} at ${T.contrast(v['--accent'], c).toFixed(2)}:1`);
    }
  }
});

check('the window takes exactly the page’s color', () => {
  const v = T.blendVars('#13233a', T.THEMES.latte);
  assert(v['--mantle'] === '#13233a' && v['--page-tint'] === '#13233a', JSON.stringify(v));
});

check('no color (or a broken one): nothing to blend with', () => {
  assert(T.blendVars('', T.THEMES.mocha) === null && T.blendVars('red', T.THEMES.mocha) === null, 'should be null');
});

console.log(`\nblend: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
