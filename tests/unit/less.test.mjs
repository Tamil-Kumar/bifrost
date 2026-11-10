// Bifrost's LESS compiler (src/shared/less.js), against what less.js makes of the same LESS (its documented
// behaviour and its own test fixtures): variables and their scope, maps, mixins (namespaces, arguments, guards,
// what they hand back), nesting and &, @media and the like bubbling out and joining, operations and units,
// less.js's functions, interpolation, @import, errors; and Catppuccin's library, as its userstyles use it.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = require(ROOT + '/src/shared/less.js');
const U = require(ROOT + '/src/shared/usercss.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  if (typeof got === 'string' && typeof want === 'string' && !got.startsWith('ERROR') && !want.startsWith('ERROR') && want !== got) { got = flat(got); want = flat(want); }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
// CSS on one line, its whitespace made the same (around {};, and after a declaration's colon), to compare.
const flat = (css) => css.replace(/\s+/g, ' ').replace(/\s*([{};,])\s*/g, '$1').replace(/;}/g, '}').replace(/([{;])([\w-]+):\s+/g, '$1$2:').trim();
const less = async (src, opts) => { try { return flat(await L.render(src, opts)); } catch (e) { return 'ERROR ' + e.message + (e.line ? ` @${e.line}:${e.column}` : ''); } };

// ---- variables
check('a variable, used before it’s declared (lazy), the last one in the nearest block winning',
  await less('.a { w: @w; } @w: 1px; @w: 2px; .b { @w: 3px; w: @w; .c { w: @w; @w: 4px; } }'),
  '.a{w:2px}.b{w:3px}.b .c{w:4px}');
check('…evaluated where it’s used (less.js’s lazy scope)', await less('@a: 1; @b: @a; .x { @a: 2; v: @b; }'), '.x{v:2}');
check('@@: the variable a variable names', await less('@fruit: banana; @banana: yellow; .x { c: @@fruit; }'), '.x{c:yellow}');
check('maps, looked up with a variable’s name in them', await less('@pal: { @latte: { @red: #d20f39; } @mocha: { @red: #f38ba8; } } @flavor: mocha; .x { c: @pal[@@flavor][@red]; }'), '.x{c:#f38ba8}');
check('…and properties of a map', await less('@cfg: { primary: blue; } .x { c: @cfg[primary]; }'), '.x{c:blue}');
check('a recursive variable is an error', (await less('@a: @a; .x { v: @a; }')).startsWith('ERROR Recursive variable definition for @a'), true);
check('an undefined one too, with its line', await less('.x {\n  v: @nope;\n}'), 'ERROR variable @nope is undefined @2:3');
check('plain text read again as a value when it’s used (fade() gets a color)', await less('@c: red; .x { c: fade(@c, 50%); }'), '.x{c:rgba(255, 0, 0, 0.5)}');

// ---- mixins
check('a namespace’s mixin; the variables it sets handed back to its caller',
  await less('#lib { .palette() { @text: #cdd6f4; } } .x { #lib.palette(); color: @text; }'), '.x{color:#cdd6f4}');
check('…but not over the caller’s own', await less('.m() { @v: 1; } .x { @v: 2; .m(); v: @v; }'), '.x{v:2}');
check('parameters: defaults, named, rest', await less('.m(@a; @b: 2; @rest...) { a: @a; b: @b; r: @rest; } .x { .m(1; @b: 3; 4; 5); }'), '.x{a:1;b:3;r:4 5}');
check('patterns pick the mixin', await less('.m(dark; @c) { bg: black; c: @c; } .m(light; @c) { bg: white; c: @c; } .x { .m(light; red); }'), '.x{bg:white;c:red}');
check('guards: the one that holds', await less('.m(@a) when (@a > 10) { big: @a; } .m(@a) when (@a =< 10) { small: @a; } .x { .m(5); .m(20); }'), '.x{small:5;big:20}');
check('…a guard that doesn’t hold gives nothing (not an error)', await less('.m(@a) when (@a = 1) { one: @a; } .x { .m(2); y: 1; }'), '.x{y:1}');
check('…default()', await less('.m(@a) when (@a = 1) { one: 1; } .m(@a) when (default()) { other: @a; } .x { .m(1); } .y { .m(2); }'), '.x{one:1}.y{other:2}');
check('…units compared as lengths', await less('.m(@a) when (@a = 1m) { same: yes; } .x { .m(100cm); }'), '.x{same:yes}');
check('!important on a call', await less('.m() { a: 1; .n { b: 2; } } .x { .m() !important; }'), '.x{a:1 !important}.x .n{b:2 !important}');
check('a mixin’s result as a value: #ns.mixin()[]', await less('#lib { .rgbify(@c) { @rgb: red(@c), green(@c), blue(@c); } } .x { --c: #lib.rgbify(#f38ba8)[]; }'), '.x{--c:243, 139, 168}');
check('a ruleset called as a mixin, and a call before its definition', await less('.x { .b(); } .b { c: d; }'), '.x{c:d}.b{c:d}');
check('mixins nested in rulesets bubble their @media', await less('.m() { @media (x) { a: 1; } } .y { .m(); }'), '@media (x){.y{a:1}}');
check('an undefined mixin is an error', await less('.x { .nope(); }'), 'ERROR .nope is undefined @1:6');

// ---- CSS guards, nesting
check('& when (…): in when it holds, out when it doesn’t', await less('@f: latte; .x { & when (@f = latte) { a: 1; } & when not (@f = latte) { b: 2; } }'), '.x{a:1}');
check('…a keyword isn’t a string ("latte" ≠ latte, as in less.js)', await less('@f: latte; .x { & when (@f = "latte") { a: 1; } c: d; }'), '.x{c:d}');
check('a guard on a selector', await less('@a: 1; .x when (@a = 1) { y: 1; } .z when (@a = 2) { y: 2; }'), '.x{y:1}');
check('& joins; without it, a descendant', await less('.a, .b { &:hover { c: 1; } .c & { d: 2; } & + & { e: 3; } .x { f: 4; } &-suffix { g: 5; } }'),
  '.a:hover,.b:hover{c:1}.c .a,.c .b{d:2}.a + .a,.a + .b,.b + .a,.b + .b{e:3}.a .x,.b .x{f:4}.a-suffix,.b-suffix{g:5}');
check('an escaped \\& isn’t the parent', await less('.a { .\\[\\&\\:hover\\]\\:x { c: 1; } }'), '.a .\\[\\&\\:hover\\]\\:x{c:1}');
check('the parent’s declarations first, then what’s nested, in order', await less('.a { x: 1; .b { y: 2; } z: 3; @media (m) { w: 4; } }'), '.a{x:1;z:3}.a .b{y:2}@media (m){.a{w:4}}');

// ---- at-rules
check('@media inside @media: joined with and, as less.js orders them', await less('@media a, (b) and (c) { @media (x), (y) { .s { w: 1; } } }'),
  '@media a and (x), (b) and (c) and (x), a and (y), (b) and (c) and (y){.s{w:1}}');
check('…a media type first', await less('@media (max-width: 500px) { @media screen { .a { c: red; } } }'), '@media screen and (max-width: 500px){.a{c:red}}');
check('…variables and LESS in a feature', await less('@bp: 768px; @media (min-width: (@bp + 1)) and (orientation:portrait) { .a { c: 1; } }'), '@media (min-width: 769px) and (orientation: portrait){.a{c:1}}');
check('@supports and @layer keep their place, the selectors inside', await less('.a { @supports (display: grid) { b: 1; } @layer base { c: 2; } }'), '@supports (display: grid){.a{b:1}}@layer base{.a{c:2}}');
check('@keyframes are left as they are (not nested in the rule)', await less('.a { b: 1; @keyframes spin { from { r: 0; } to { r: 1; } } }'), '.a{b:1}@keyframes spin{from{r:0}to{r:1}}');
check('@-moz-document: its list made of LESS (regexp built with replace())',
  await less('@urls: "a\\.com,b\\.com"; @-moz-document regexp(replace(%("https?://(%s)/.*", @urls), ",", "|", "g")), domain("x.org") { .a { b: c; } }'),
  '@-moz-document regexp("https?://(a\\.com|b\\.com)/.*"), domain("x.org"){.a{b:c}}');

// ---- operations and units
check('units: kept, converted, multiplied out; / only in parentheses', await less('.x { a: 2px + 3; b: 1cm + 10mm; c: ((10px * 2px) / 4px); d: 10px / 2; e: (10px / 2); f: 1 + 1px; g: (10px * 2px) / 4px; }'), '.x{a:5px;b:2cm;c:5px;d:10px / 2;e:5px;f:2px;g:20px / 4px}');
check('calc(): variables put in, no math', await less('@w: 10px; .x { a: calc(100% - @w); b: calc((100% - @w) / 2); }'), '.x{a:calc(100% - 10px);b:calc((100% - 10px) / 2)}');
check('colors: arithmetic', await less('.x { a: #111 + #222; b: #888 * 2; }'), '.x{a:#333333;b:#ffffff}');
check('a word, a dash and a number are just text (as less.js reads them)', await less('.x { a: foo - 1px; }'), '.x{a:foo - 1px}');
check('…but arithmetic on a word is an error', (await less('@a: foo; .x { b: @a - 1px; }')).startsWith('ERROR Operation on an invalid type'), true);
check('negatives', await less('@a: 5px; .x { m: -@a; n: 0 -@a; }'), '.x{m:-5px;n:0 -5px}');

// ---- functions
check('fade, darken, lighten, mix, spin, saturate, desaturate (as Python’s colorsys has them too)',
  await less('@c: #cba6f7; .x { a: fade(@c, 30%); b: darken(@c, 10%); c: lighten(@c, 5%); d: mix(@c, #000, 50%); e: spin(#f00, 120); f: saturate(#808080, 10%); g: desaturate(@c, 100%); }'),
  '.x{a:rgba(203, 166, 247, 0.3);b:#b077f3;c:#d9bdf9;d:#66537c;e:#00ff00;f:#8d7373;g:#cfcfcf}');
check('filter functions with the same names are left alone (saturate, contrast)', await less('.x { filter: brightness(0) saturate(100%) invert(84%) contrast(91%); }'), '.x{filter:brightness(0) saturate(100%) invert(84%) contrast(91%)}');
check('rgb() and hsl() as less.js writes them', await less('.x { a: rgb(27, 31, 35); b: rgba(27, 31, 35, 0.04); c: hsl(120, 50%, 50%); d: hsla(0, 100%, 50%, 0.5); e: rgb(var(--x)); f: rgb(0 128 255 / 50%); }'),
  '.x{a:#1b1f23;b:rgba(27, 31, 35, 0.04);c:hsl(120, 50%, 50%);d:hsla(0, 100%, 50%, 0.5);e:rgb(var(--x));f:rgba(0, 128, 255, 0.5)}');
check('hue, saturation, lightness, red…; e() and %()', await less('@c: #cba6f7; .x { --h: e(%("%s %s% %s%", hue(@c), saturation(@c), lightness(@c))); r: red(@c); }'), '.x{--h:267.40740741 83.50515464% 80.98039216%;r:203}');
check('escape() for SVG data URLs, interpolated', await less('@red: #f38ba8; .x { @svg: escape(\'<svg fill="@{red}"/>\'); background: url("data:image/svg+xml,@{svg}"); }'),
  '.x{background:url("data:image/svg+xml,%3Csvg%20fill%3D%22%23f38ba8%22/%3E")}');
check('if() and boolean()', await less('@f: latte; .x { a: if(@f = latte, light, dark); b: if((@f = mocha), 1, 2); c: boolean(1 > 2); }'), '.x{a:light;b:2;c:false}');
check('each() over a map and a list', await less('@m: { a: 1; b: 2; } .x { each(@m, { .k-@{key} { v: @value; } }); each(range(2), { i-@{value}: @index; }) }'), '.x{i-1:1;i-2:2}.x .k-a{v:1}.x .k-b{v:2}');
check('…with an anonymous mixin', await less('.x { each(a b, .(@v, @k, @i) { p-@{v}: @i; }); }'), '.x{p-a:1;p-b:2}');
check('math: round, percentage, unit, min, max (CSS ones left alone)', await less('.x { a: round(1.67, 1); b: percentage(0.5); c: unit(5, px); d: max(1px, 3px); e: max(1px, calc(2px + 1em)); f: min(2, 1); }'),
  '.x{a:1.7;b:50%;c:5px;d:3px;e:max(1px, calc(2px + 1em));f:1}');
check('types: iscolor, isnumber, isunit (any case)', await less('.x { a: iscolor(#fff); b: isnumber(red); c: isunit(32PX, px); }'), '.x{a:true;b:false;c:true}');
check('unknown functions stay as CSS', await less('.x { a: var(--a, 1px); b: color-mix(in srgb, red 50%, blue); }'), '.x{a:var(--a, 1px);b:color-mix(in srgb, red 50%, blue)}');

// ---- interpolation, custom properties
check('@{} in selectors, property names, strings and urls', await less('@n: foo; @p: color; .@{n}-x { @{p}: red; s: "a-@{n}"; u: url("/@{n}.png"); }'), '.foo-x{color:red;s:"a-foo";u:url("/foo.png")}');
check('custom properties: values as written, variables and functions put in', await less('@a: #fff; .x { --a: @a; --b: fade(@a, 50%) !important; --c: { not less }; --d: 1px + 2px; }'),
  '.x{--a:#fff;--b:rgba(255, 255, 255, 0.5) !important;--c:{ not less };--d:1px + 2px}');
check('IE alpha(opacity=…)', await less('@v: 42; .x { filter: alpha(opacity=@v); }'), '.x{filter:alpha(opacity=42)}');

// ---- @import
const files = { 'https://ex.org/lib/a.less': '@c: blue; @import "b.less";', 'https://ex.org/lib/b.less': '.m() { m: 1; }' };
const load = async (url) => { if (files[url] == null) throw new Error('404'); return files[url]; };
check('@import: loaded, what it imports too (relative to it), once', await less('@import "https://ex.org/lib/a.less"; @import "https://ex.org/lib/b.less"; .x { c: @c; .m(); }', { load }), '.x{c:blue;m:1}');
check('CSS imports are left for the page (at the top of their block)', await less('@-moz-document domain("a.b") { .x { c: d; } @import url("https://e.org/t.css") screen; }'), '@-moz-document domain("a.b"){@import url("https://e.org/t.css") screen;.x{c:d}}');
check('an @import that can’t be loaded is an error', (await less('@import "https://ex.org/nope.less";', { load })).startsWith('ERROR Couldn’t load https://ex.org/nope.less'), true);

// ---- what can't be done, and limits
check('JavaScript isn’t run', (await less('.x { a: `1 + 1`; }')).startsWith('ERROR JavaScript'), true);
check('a mixin that never stops is stopped', (await less('.m(@a) { .m(@a + 1); } .x { .m(1); }')).startsWith('ERROR Mixins call each other too deeply'), true);
check('a } too many is an error', (await less('.x { a: b; } }')).startsWith('ERROR'), true);

// ---- Catppuccin's library, as its userstyles use it (the bundled copy)
const LIB = ROOT + '/assets/userstyles/catppuccin/lib/';
const ctpLoad = async (url) => fs.readFileSync(LIB + url.replace('https://userstyles.catppuccin.com/lib/', ''), 'utf8');
const style = `/* ==UserStyle==
@name Example Catppuccin
@namespace example
@version 1.0.0
@preprocessor less
@var select lightFlavor "Light Flavor" ["latte:Latte*", "frappe:Frappé", "macchiato:Macchiato", "mocha:Mocha"]
@var select darkFlavor "Dark Flavor" ["latte:Latte", "frappe:Frappé", "macchiato:Macchiato", "mocha:Mocha*"]
@var select accentColor "Accent" ["rosewater:Rosewater", "mauve:Mauve*", "red:Red"]
==/UserStyle== */
@import "https://userstyles.catppuccin.com/lib/lib.less";
@-moz-document domain("example.com") {
  :root { @media (prefers-color-scheme: light) { #catppuccin(@lightFlavor); } @media (prefers-color-scheme: dark) { #catppuccin(@darkFlavor); } }
  #catppuccin(@flavor) {
    #lib.palette();
    #lib.defaults();
    background: @base;
    --rgb: #lib.rgbify(@accent)[];
    a { color: @accent; &:hover { color: fade(@accent, 80%); } }
  }
}`;
const built = await U.buildAsync(style, { accentColor: 'red' }, { less: L, load: ctpLoad });
check('a Catppuccin style: its parts and their pages', built.sections.map((s) => s.domains), [['example.com']]);
check('…each flavor in its @media, the palette, the accent you chose, #lib.defaults()', flat(built.sections[0].code),
  flat(`@media (prefers-color-scheme: light) { :root { color-scheme: light; background: #eff1f5; --rgb: 210, 15, 57; } :root ::selection { background-color: rgba(210, 15, 57, 0.3); }
    :root input::placeholder, :root textarea::placeholder { color: #6c6f85 !important; } :root a { color: #d20f39; } :root a:hover { color: rgba(210, 15, 57, 0.8); } }
  @media (prefers-color-scheme: dark) { :root { color-scheme: dark; background: #1e1e2e; --rgb: 243, 139, 168; } :root ::selection { background-color: rgba(243, 139, 168, 0.3); }
    :root input::placeholder, :root textarea::placeholder { color: #a6adc8 !important; } :root a { color: #f38ba8; } :root a:hover { color: rgba(243, 139, 168, 0.8); } }`));
check('…a LESS error says its line in the style', await U.buildAsync(style.replace('background: @base;', 'background: @nope;'), {}, { less: L, load: ctpLoad }).then(() => 'built', (e) => e.message),
  'LESS: variable @nope is undefined (line 16).');
check('…the variables as Stylus gives them to LESS', U.lessVariables(built.vars, { accentColor: 'red' }), '@lightFlavor:latte;\n@darkFlavor:mocha;\n@accentColor:red;\n');

console.log(`\nless: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
