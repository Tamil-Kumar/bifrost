// Catppuccin's userstyles in Bifrost's theme (src/shared/catppuccin.js): a theme as Catppuccin's 26 colors, the
// flavor a style is built with, filters that turn black into a color (as close as Catppuccin's own), and
// Catppuccin's library with one flavor swapped; a real style built with it.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = require(ROOT + '/src/shared/catppuccin.js');
const T = require(ROOT + '/src/shared/themes.js');
const L = require(ROOT + '/src/shared/less.js');
const U = require(ROOT + '/src/shared/usercss.js');
const LIB = ROOT + '/assets/userstyles/catppuccin/lib/';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

// ---- a theme as Catppuccin's colors
const frost = T.resolve({ theme: 'frost' }, {});
const pal = C.paletteFromTheme(frost);
check('all 26 of Catppuccin’s colors', Object.keys(pal).sort(), C.COLORS.slice().sort());
check('…the theme’s own where it has them, its accent as mauve (Catppuccin’s styles’ accent)',
  [pal.base, pal.mantle, pal.crust, pal.surface0, pal.overlay0, pal.subtext0, pal.text, pal.mauve, pal.red, pal.blue], [frost.base, frost.mantle, frost.crust, frost.s0, frost.overlay, frost.subtext, frost.text, frost.accent, frost.red, frost.blue]);
check('…the in-betweens mixed from their neighbours', [pal.subtext1, pal.overlay1].every((c) => /^#[0-9a-f]{6}$/.test(c) && c !== frost.subtext && c !== frost.text), true);
check('the flavor: a Catppuccin theme’s own (nothing swapped); Mocha’s for a dark theme, Latte’s for a light one, with its colors',
  [C.themeBuild(T.resolve({ theme: 'macchiato' }, {})), C.themeBuild(frost).flavor, C.themeBuild(T.resolve({ theme: 'frostlight' }, {})).flavor, !!C.themeBuild(frost).palette],
  [{ flavor: 'macchiato', palette: null }, 'mocha', 'latte', true]);
check('…a Catppuccin theme with an accent of your own: just mauve', C.themeBuild({ ...T.resolve({ theme: 'mocha', useCustomAccent: true, accent: '#ff0000' }, {}), customAccent: true }), { flavor: 'mocha', palette: { mauve: '#ff0000' } });

// ---- filters
const lib = fs.readFileSync(LIB + 'std/v1.less', 'utf8');
const mochaLine = /@mocha:\s*\{([^\n]*)\};/.exec(lib.slice(0, lib.indexOf('@catppuccin-filters')))[1];
const mocha = Object.fromEntries([...mochaLine.matchAll(/@(\w+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
const parse = (f) => { const n = [...f.matchAll(/(invert|sepia|saturate|hue-rotate|brightness|contrast)\(([\d.]+)/g)].slice(2).map((m) => +m[2]); return [n[0], n[1], n[2], n[3] / 3.6, n[4], n[5]]; };
const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const off = (f, hex) => { const c = C.applyFilters(parse(f)); const t = rgb(hex); return Math.round(Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2])); };
const filterLine = /@mocha:\s*\{([^\n]*)\};/.exec(lib.slice(lib.indexOf('@catppuccin-filters')))[1];
const theirs = Object.fromEntries([...filterLine.matchAll(/@(\w+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
check('the filter math gives what Catppuccin’s own filters are for (within a shade)', Object.entries(theirs).every(([k, f]) => off(f, mocha[k]) <= 8), true);
const t0 = Date.now();
const worst = Math.max(...Object.values(mocha).map((hex) => off(C.filterFor(hex), hex)));
check('filters found for all of Mocha’s colors, each within a shade of it (as close as Catppuccin’s)', worst <= 4, true);
console.log(`    (${Date.now() - t0} ms)`);
check('…the same each time, and in Catppuccin’s form', [C.filterFor('#7cc8ff') === C.filterFor('#7CC8FF'), /^brightness\(0\) saturate\(100%\) invert\(\d+%\) sepia\(\d+%\) saturate\(\d+%\) hue-rotate\(\d+deg\) brightness\(\d+%\) contrast\(\d+%\)$/.test(C.filterFor('#7cc8ff'))], [true, true]);

// ---- the library, one flavor swapped
const tb = C.themeBuild(frost);
const patched = C.patchLibrary(lib, tb.flavor, tb.palette);
const lineOf = (text, flavor, filters) => new RegExp(`@${flavor}:\\s*\\{[^\\n]*\\}`).exec(filters ? text.slice(text.indexOf('@catppuccin-filters')) : text.slice(0, text.indexOf('@catppuccin-filters')))[0];
check('Mocha’s colors swapped for the theme’s, the other flavors as they were', [lineOf(patched, 'mocha').includes(`@base: ${frost.base};`) && lineOf(patched, 'mocha').includes(`@mauve: ${frost.accent};`), lineOf(patched, 'latte') === lineOf(lib, 'latte'), lineOf(patched, 'macchiato') === lineOf(lib, 'macchiato')], [true, true, true]);
check('…and its filters, for the new colors', [lineOf(patched, 'mocha', true).includes(`@base: ${C.filterFor(frost.base)};`), lineOf(patched, 'frappe', true) === lineOf(lib, 'frappe', true)], [true, true]);
check('…only what’s given (an accent of your own)', (() => { const p = C.patchLibrary(lib, 'mocha', { mauve: '#ff0000' }); return [lineOf(p, 'mocha').includes('@mauve: #ff0000;'), lineOf(p, 'mocha').includes('@base: #1e1e2e;')]; })(), [true, true]);
check('not Catppuccin’s library: null', C.patchLibrary('@a: 1;', 'mocha', { base: '#000000' }), null);
check('Catppuccin’s styles told from others', [C.isCatppuccin('@import "https://userstyles.catppuccin.com/lib/lib.less";', [{ name: 'darkFlavor' }]), C.isCatppuccin('body{}', [{ name: 'darkFlavor' }]), C.isCatppuccin('@import "https://userstyles.catppuccin.com/lib/lib.less";', [])], [true, false, false]);

// ---- a style built with it
const style = `/* ==UserStyle==
@name Example Catppuccin
@namespace example
@version 1.0.0
@preprocessor less
@var select lightFlavor "Light Flavor" ["latte:Latte*", "mocha:Mocha"]
@var select darkFlavor "Dark Flavor" ["latte:Latte", "mocha:Mocha*"]
@var select accentColor "Accent" ["mauve:Mauve*", "red:Red"]
==/UserStyle== */
@import "https://userstyles.catppuccin.com/lib/lib.less";
@-moz-document domain("example.com") {
  :root { @media (prefers-color-scheme: light) { #catppuccin(@lightFlavor); } @media (prefers-color-scheme: dark) { #catppuccin(@darkFlavor); } }
  #catppuccin(@flavor) { #lib.palette(); background: @base; color: @accent; img { filter: @accent-filter; } }
}`;
const load = async (url) => { const rel = url.replace('https://userstyles.catppuccin.com/lib/', ''); const text = fs.readFileSync(LIB + rel, 'utf8'); return rel === 'std/v1.less' ? C.patchLibrary(text, tb.flavor, tb.palette) : text; };
const built = await U.buildAsync(style, { lightFlavor: tb.flavor, darkFlavor: tb.flavor }, { less: L, load });
const css = built.sections[0].code.replace(/\s+/g, ' ');
check('a style built in Frost: light or dark, the page gets Frost’s colors and accent, and a filter for it', [css.split(`background: ${frost.base}`).length - 1, css.split(`color: ${frost.accent}`).length - 1, css.includes(`filter: ${C.filterFor(frost.accent)}`), css.includes('#1e1e2e')], [2, 2, true, false]);

console.log(`\ncatppuccin: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
