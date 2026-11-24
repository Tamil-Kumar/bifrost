// Catppuccin for every site (src/preload/recolor.js, its color work): colors read the ways CSS writes them;
// what each becomes in Catppuccin's palette by what it colors (a background, text, a line, a shadow), how light
// and how colorful it is; text kept readable; CSS values rewritten (gradients, shadows, variables pointed at their
// twins, variables holding a color's numbers as Bootstrap, shadcn and Tailwind write them, url()s made whole).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = require(ROOT + '/src/preload/recolor.js');
const C = require(ROOT + '/src/shared/catppuccin.js');
const T = require(ROOT + '/src/shared/themes.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
const hexOf = (c) => R.format([c[0], c[1], c[2], 1]);
const contrast = (a, b) => T.contrast(a, b);

// ---- reading colors
check('hex, 3 to 8 digits', ['#fff', '#ffff', '#0969da', '#0969da80'].map((x) => R.parse(x).map((v) => Math.round(v * 100) / 100)), [[255, 255, 255, 1], [255, 255, 255, 1], [9, 105, 218, 1], [9, 105, 218, 0.5]]);
check('rgb(), old and new ways, percentages, alpha', ['rgb(9, 105, 218)', 'rgba(9,105,218,.5)', 'rgb(9 105 218 / 50%)', 'rgb(100% 0% 0%)'].map((x) => R.parse(x)), [[9, 105, 218, 1], [9, 105, 218, 0.5], [9, 105, 218, 0.5], [255, 0, 0, 1]]);
check('hsl() and hwb()', ['hsl(120 50% 50%)', 'hsla(0, 100%, 50%, .25)', 'hsl(0.5turn 100% 50%)', 'hwb(0 0% 0%)'].map((x) => R.parse(x)), [[64, 191, 64, 1], [255, 0, 0, 0.25], [0, 255, 255, 1], [255, 0, 0, 1]]);
// (oklch(0.7 0.1 250) as themes.js's own OKLCH works it out; lab() and lch() are CIE's D50, as CSS has them)
check('oklch() and oklab() (Tailwind 4 writes its colors so), lab(), lch(), color()', ['oklch(0.7 0.1 250)', 'oklch(62.8% 0.2577 29.23)', 'oklab(1 0 0)', 'lab(54.29 80.8 69.89)', 'lch(54.29 106.84 40.85)', 'color(srgb 1 0 0)', 'color(display-p3 1 0 0)'].map((x) => hexOf(R.parse(x))),
  [T.fromOklch(0.7, 0.1, 250 * Math.PI / 180), '#ff0000', '#ffffff', '#ff0000', '#ff0000', '#ff0000', '#ff0000']);
check('names, the system’s colors (as a light page has them), and what isn’t a color', ['white', 'RebeccaPurple', 'Canvas', 'CanvasText', 'transparent', 'currentcolor', 'var(--x)', 'rgb(var(--x))', 'nonsense'].map((x) => (R.parse(x) ? hexOf(R.parse(x)) : null)),
  ['#ffffff', '#663399', '#ffffff', '#000000', null, null, null, null, null]);

// ---- the palettes
check('Catppuccin’s four flavors, 26 colors each', C.FLAVORS.map((f) => Object.keys(C.PALETTES[f]).length), [26, 26, 26, 26]);
check('…as Catppuccin has them', [C.PALETTES.mocha.base, C.PALETTES.mocha.text, C.PALETTES.latte.base, C.PALETTES.macchiato.blue, C.PALETTES.frappe.crust], ['#1e1e2e', '#cdd6f4', '#eff1f5', '#8aadf4', '#232634']);
check('a build in full: its flavor’s, the theme’s colors over them', [C.fullPalette({ flavor: 'mocha', palette: null }).mauve, C.fullPalette({ flavor: 'mocha', palette: { mauve: '#ff0000' } }).mauve, C.fullPalette({ flavor: 'latte', palette: null }).base], ['#cba6f7', '#ff0000', '#eff1f5']);

const mocha = R.prepare(C.PALETTES.mocha);
const latte = R.prepare(C.PALETTES.latte);
const m = (P, c, role) => hexOf(R.mapColor(P, R.parse(c), role));
const name = (P, hex) => { const e = Object.entries(P.palette).find(([, v]) => v === hex); return e ? e[0] : hex; };

// ---- Mocha: a light page turns dark, in Catppuccin's colors
check('white background -> base, black text -> text, black background -> crust, white text -> text',
  [name(mocha, m(mocha, '#ffffff', 'b')), name(mocha, m(mocha, '#000000', 't')), name(mocha, m(mocha, '#000000', 'b')), name(mocha, m(mocha, '#ffffff', 't'))], ['base', 'text', 'crust', 'text']);
const L = (hex) => T.toOklch(hex).L;
const grays = ['#ffffff', '#f6f8fa', '#eeeeee', '#dddddd', '#cccccc', '#aaaaaa'].map((c) => L(m(mocha, c, 'b')));
check('a light page’s grays: lighter ones nearer base, in order (its cards and sections still apart)', grays.every((x, i) => i === 0 || x > grays[i - 1]), true);
check('…a light page’s dark sidebar darker than base (as it was darker than the page), black darkest', [L(m(mocha, '#343131', 'b')) < L(C.PALETTES.mocha.base), L(m(mocha, '#000000', 'b')) < L(m(mocha, '#343131', 'b'))], [true, true]);
check('text grays: black and near-black text, base’s text; grays dimmer, and readable (3:1 or more)', (() => {
  const out = ['#000000', '#24292f', '#57606a', '#777777', '#999999', '#bbbbbb'].map((c) => m(mocha, c, 't'));
  return [name(mocha, out[0]), name(mocha, out[1]), out.every((c) => contrast(c, C.PALETTES.mocha.base) >= 3), L(out[2]) > L(out[4])];
})(), ['text', 'text', true, true]);
check('a color that’s a color goes to Catppuccin’s of its hue (links blue, errors red, success green…)',
  ['#0969da', '#0645ad', '#cf222e', '#ff0000', '#2da44e', '#ff6600', '#9a6700', '#6f42c1', '#e85aad', '#17a2b8', '#5865f2', '#20c997'].map((c) => name(mocha, m(mocha, c, 't'))),
  ['blue', 'blue', 'red', 'red', 'green', 'peach', 'yellow', 'mauve', 'pink', 'sky', 'lavender', 'teal']);
check('…gray-blue text isn’t a color (it stays a gray)', [m(mocha, '#57606a', 't'), m(mocha, '#24292f', 't')].every((c) => !['blue', 'sapphire', 'lavender'].includes(name(mocha, c))), true);
check('a strong background (a button’s): its hue, deep, with base’s text 4.5:1 on it', (() => {
  const out = ['#0969da', '#2da44e', '#cf222e', '#1f883d', '#6f42c1', '#ffc107'].map((c) => m(mocha, c, 'b'));
  return out.map((c) => contrast(c, C.PALETTES.mocha.text) >= 4.5);
})(), [true, true, true, true, true, true]);
check('…its hue kept (a blue button blue, a green one green)', [T.toOklch(m(mocha, '#0969da', 'b')), T.toOklch(m(mocha, '#2da44e', 'b'))].map((c) => Math.round(((c.h * 180 / Math.PI) + 360) % 360 / 30)), [9, 5]);
check('a pale one (an alert’s): a wash of its color, near base', (() => {
  const c = m(mocha, '#ddf4ff', 'b');
  return [L(c) - L(C.PALETTES.mocha.base) < 0.1, T.toOklch(c).C > 0.02, contrast(c, C.PALETTES.mocha.text) >= 7];
})(), [true, true, true]);
check('a see-through shade (a hover’s 5% black, a 10% white): text’s color at that, so it still shows',
  [R.format(R.mapColor(mocha, R.parse('rgba(0,0,0,.05)'), 'b')), R.format(R.mapColor(mocha, R.parse('rgba(255,255,255,.1)'), 'b')), R.format(R.mapColor(mocha, R.parse('rgba(0,0,0,.12)'), 'd'))],
  ['rgba(205, 214, 244, 0.05)', 'rgba(205, 214, 244, 0.1)', 'rgba(205, 214, 244, 0.12)']);
check('…a dark veil over a picture stays dark; a frosted white header, base', [R.format(R.mapColor(mocha, R.parse('rgba(0,0,0,.5)'), 'b')), R.format(R.mapColor(mocha, R.parse('rgba(255,255,255,.85)'), 'b'))], ['rgba(17, 17, 27, 0.5)', 'rgba(30, 30, 46, 0.85)']);
check('lines: a white one base (it was white on white), a light gray one shows (a surface)', [name(mocha, m(mocha, '#ffffff', 'd')), contrast(m(mocha, '#d0d7de', 'd'), C.PALETTES.mocha.base) > 1.2], ['base', true]);
check('shadows stay dark (crust); a colored glow its color', [R.format(R.mapColor(mocha, R.parse('rgba(0,0,0,.15)'), 's')), R.format(R.mapColor(mocha, R.parse('rgba(9,105,218,.3)'), 's'))], ['rgba(17, 17, 27, 0.15)', 'rgba(137, 180, 250, 0.3)']);

// ---- Latte: a light page stays light, in Latte's colors
check('Latte: white -> base, black text -> text, a dark sidebar light (but not base)', [name(latte, m(latte, '#ffffff', 'b')), name(latte, m(latte, '#000000', 't')), m(latte, '#343131', 'b') !== C.PALETTES.latte.base && L(m(latte, '#343131', 'b')) > 0.8], ['base', 'text', true]);
check('…its colored text darkened where Latte’s own is too pale to read (4.5:1 on base)', ['#ff6600', '#ffc107', '#2da44e', '#0969da', '#17a2b8'].map((c) => contrast(m(latte, c, 't'), C.PALETTES.latte.base) >= 4.5), [true, true, true, true, true]);
check('…backgrounds keep its text readable on them (3.5:1)', ['#0969da', '#000000', '#555555', '#cf222e'].map((c) => contrast(m(latte, c, 'b'), C.PALETTES.latte.text) >= 3.5), [true, true, true, true]);
{
  // (what a see-through color looks like on base)
  const onBase = (P, flavor, css) => { const o = R.mapColor(P, R.parse(css), 't'); const b = R.parse(C.PALETTES[flavor].base); return hexOf([0, 1, 2].map((i) => Math.round(o[i] * o[3] + b[i] * (1 - o[3])))); };
  const was = (a) => contrast(hexOf([0, 1, 2].map(() => Math.round(255 * (1 - a)))), '#ffffff');
  check('see-through gray text (Material’s rgba(0,0,0,.87), .54 and .38): its text, secondary and faint ones as readable on base as they were on white (or more), in that order, still see-through; a colored one and a light one keep their alpha',
    [
      ...['latte', 'mocha'].map((f) => { const P = f === 'latte' ? latte : mocha; const r = [0.87, 0.54, 0.38].map((a) => contrast(onBase(P, f, `rgba(0,0,0,${a})`), C.PALETTES[f].base)); return r.every((x, i) => x >= Math.min(was([0.87, 0.54, 0.38][i]), 7) - 0.15 && (i === 0 || x < r[i - 1])); }),
      R.mapColor(latte, R.parse('rgba(0,0,0,.54)'), 't')[3] < 1,
      R.mapColor(mocha, R.parse('rgba(25,118,210,.8)'), 't')[3], R.mapColor(mocha, R.parse('rgba(255,255,255,.7)'), 't')[3],
    ], [true, true, true, 0.8, 0.7]);
}

// ---- Bifrost's themes (with "Match websites to your theme"): their colors, the same way
for (const key of ['frost', 'nord', 'dracula', 'oled', 'frostlight']) {
  if (!T.THEMES[key]) continue;
  const t = T.resolve({ theme: key }, {});
  const pal = C.fullPalette(C.themeBuild(t));
  const P = R.prepare(pal);
  check(`${key}: white -> its base, black text -> its text, a link readable`, [m(P, '#ffffff', 'b'), m(P, '#000000', 't'), contrast(m(P, '#0969da', 't'), pal.base) >= 4.5], [pal.base, pal.text, true]);
}

// ---- CSS values
const rw = (v, role, o = {}) => { const uses = []; const out = R.rewrite(mocha, v, role, { base: 'https://site.test/css/main.css', uses, ...o }); return [out, uses]; };
check('a gradient’s colors, its url() made whole (Bifrost’s stylesheet isn’t where the page’s is)', rw('url("img/a.png"), linear-gradient(rgb(255, 255, 255), rgb(238, 238, 238))', 'b')[0], 'url("https://site.test/css/img/a.png"), linear-gradient(#1e1e2e, #28293a)');
check('…a picture’s data: URL and a string left alone', rw('url("data:image/png;base64,iVBORw0KGgo=") , "#fff"', 'b')[0], 'url("data:image/png;base64,iVBORw0KGgo=") , "#fff"');
check('…an SVG drawn into the stylesheet (Bootstrap’s select arrow): its stroke an icon’s, light now; written plainly or in base64',
  [rw("url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23343a40' d='m2 5 6 6 6-6'/%3e%3c/svg%3e\")", 'b')[0],
    rw('url(data:image/svg+xml;base64,' + Buffer.from('<svg><path fill="#000" style="stroke:red"/></svg>').toString('base64') + ')', 'b')[0]],
  ["url(\"data:image/svg+xml,%3csvg color=%22%23cdd6f4%22 fill=%22%23cdd6f4%22 xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23cdd6f4' d='m2 5 6 6 6-6'/%3e%3c/svg%3e\")",
    'url("data:image/svg+xml,%3csvg color=%22%23cdd6f4%22 fill=%22%23cdd6f4%22%3e%3cpath fill=%22%23cdd6f4%22 style=%22stroke:%23f38ba8%22/%3e%3c/svg%3e")']);
// Pictures that are icons, as Google draws them: in text's colors on a dark page; logos kept.
check('an SVG icon that draws in the default black (or currentColor, black in a picture): in text\'s color',
  R.svgText(mocha, '<svg viewBox="0 0 24 24"><path d="M0 0h24v24z"/><path stroke="currentColor"/></svg>'), '<svg color="#cdd6f4" fill="#cdd6f4" viewBox="0 0 24 24"><path d="M0 0h24v24z"/><path stroke="currentColor"/></svg>');
check('…a logo (three colors or more, Google\'s four) kept as it is, in the stylesheet too; a two-colored mark turned',
  [R.svgText(mocha, '<svg><path fill="#4285F4"/><path fill="#EA4335"/><path fill="#FBBC05"/><path fill="#34A853"/></svg>'),
    rw("url(\"data:image/svg+xml,%3csvg%3e%3cpath fill='%234285F4'/%3e%3cpath fill='%23EA4335'/%3e%3cpath fill='%23FBBC05'/%3e%3c/svg%3e\")", 'b')[0].includes('4285F4'),
    R.isArt([[30, 142, 62, 1], [251, 188, 5, 1]])], [null, true, false]);
check('a picture from elsewhere that\'s an icon: the one in text\'s colors once there is one (o.icon), else its address made whole',
  [rw('url(img/menu.png) no-repeat', 'b', { icon: (u) => (u === 'https://site.test/css/img/menu.png' ? 'data:image/png;base64,AAAA' : null) })[0], rw('url(img/menu.png)', 'b', { icon: () => null })[0]],
  ['url("data:image/png;base64,AAAA") no-repeat', 'url("https://site.test/css/img/menu.png")']);
check('an icon drawn as a mask over its background-color (Google\'s): the rule says so, for that color to be text\'s',
  [R.declarations('-webkit-mask: url(i.svg) center / 20px no-repeat; background-color: #444746', false), R.declarations('-webkit-mask-image: linear-gradient(#000, transparent); background: #fff', false).length],
  [[['background-color', '#444746', false], ['-bifrost-masked', '', false]], 1]);
// (a picture, as Chromium keeps one: BGRA, alpha premultiplied)
const picture = (w, h, fn) => { const px = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = fn(x, y); const o = (y * w + x) * 4; px[o] = b * a / 255; px[o + 1] = g * a / 255; px[o + 2] = r * a / 255; px[o + 3] = a; } return px; };
const glyph = () => picture(24, 24, (x, y) => (y > 5 && y < 9 || y > 11 && y < 14 ? [68, 71, 70, 255] : [0, 0, 0, 0]));
const at = (px, w, x, y) => { const o = (y * w + x) * 4; return [px[o + 2], px[o + 1], px[o], px[o + 3]]; };
const g1 = glyph();
check('a black icon on nothing, on a dark page: drawn in text\'s colors, its edges as see-through as they were',
  [R.recolorIcon(mocha, g1, 24, 24), at(g1, 24, 3, 7).slice(3)[0], R.ratio(R.lum(at(g1, 24, 3, 7)), R.lum([30, 30, 46])) >= 4.5, at(g1, 24, 3, 2)[3]], [true, 255, true, 0]);
check('…left as it is on a light page (it shows), and anything that isn\'t one: a logo in colors, a photo, a picture with a white background',
  [R.recolorIcon(latte, glyph(), 24, 24),
    R.recolorIcon(mocha, picture(30, 10, (x) => (x < 10 ? [66, 133, 244, 255] : x < 20 ? [234, 67, 53, 255] : [0, 0, 0, 0])), 30, 10),
    R.recolorIcon(mocha, picture(20, 20, (x, y) => [x * 12, y * 12, 200, 255]), 20, 20),
    R.recolorIcon(mocha, picture(20, 20, (x, y) => (y === 9 ? [0, 0, 0, 255] : [255, 255, 255, 255])), 20, 20)], [false, false, false, false]);
// The filter for a page drawn on a canvas: white to base, black to text, a blue a lighter blue.
const matrix = decodeURIComponent(R.inkFilter([30, 30, 46], [205, 214, 244])).match(/values="([^"]+)"/)[1].split(' ').map(Number);
const apply = (c) => [0, 1, 2].map((i) => Math.round(255 * Math.max(0, Math.min(1, matrix[i * 5] * c[0] / 255 + matrix[i * 5 + 1] * c[1] / 255 + matrix[i * 5 + 2] * c[2] / 255 + matrix[i * 5 + 4]))));
check('a canvas page\'s colors turned around: white to base, black to text, a link\'s blue still blue and readable on base',
  [apply([255, 255, 255]), apply([0, 0, 0]), (() => { const b = apply([17, 85, 204]); return b[2] > b[0] && R.ratio(R.lum(b), R.lum([30, 30, 46])) >= 4.5; })()], [[30, 30, 46], [205, 214, 244], true]);
check('a gradient on letters (background-clip: text) kept with the rule’s colors, so its background can be text’s', R.declarations('background: linear-gradient(90deg, #ff0080, #7928ca); -webkit-background-clip: text; padding: 0', false).map((d) => d[0]), ['background', '-webkit-background-clip']);
check('…and as CSSOM writes it, inside the background shorthand ("… text"), not a "text" in a function or a string', [
  'background: linear-gradient(90deg, rgb(255, 0, 128), rgb(121, 40, 202)) text; color: transparent',
  'background: linear-gradient(red, blue) padding-box text, rgb(0, 0, 0)',
  'background: url("text.png") no-repeat',
  'background: var(--text) center / cover',
  'background: rgb(1, 2, 3)',
].map((s) => R.declarations(s, false).some((d) => R.CLIP.has(d[0]))), [true, true, false, false, false]);
check('shadows, each of a list', rw('rgba(0, 0, 0, 0.1) 0px 1px 2px, rgb(221, 221, 221) 0px -1px 0px inset', 's')[0], 'rgba(17, 17, 27, 0.1) 0px 1px 2px, #353649 0px -1px 0px inset');
check('a variable: its twin for what it colors, else itself', rw('var(--bg) url(x.png)', 'b'), ['var(--bfb-bg, var(--bg)) url("https://site.test/css/x.png")', [['--bg', 'b']]]);
check('…with a fallback (turned too), inside another', rw('var(--a, var(--b, #000))', 't'), ['var(--bft-a, var(--a, var(--bft-b, var(--b, #cdd6f4))))', [['--a', 't'], ['--b', 't']]]);
check('…in a border shorthand', rw('1px solid var(--line)', 'd'), ['1px solid var(--bfd-line, var(--line))', [['--line', 'd']]]);
check('Bootstrap’s rgba(var(--rgb), var(--opacity)): the numbers’ twin', rw('rgba(var(--bs-body-bg-rgb), var(--bs-bg-opacity))', 'b'), ['rgba(var(--bfbr-bs-body-bg-rgb, var(--bs-body-bg-rgb)), var(--bs-bg-opacity))', [['--bs-body-bg-rgb', 'br']]]);
check('shadcn’s hsl(var(--x)) and hsl(var(--x) / .9)', [rw('hsl(var(--background))', 'b'), rw('hsl(var(--primary) / 0.9)', 't')], [['hsl(var(--bfbh-background, var(--background)))', [['--background', 'bh']]], ['hsl(var(--bfth-primary, var(--primary)) / 0.9)', [['--primary', 'th']]]]);
check('Tailwind 3’s rgb(255 255 255 / var(--tw-bg-opacity)): the numbers turned, the opacity kept', rw('rgb(255 255 255 / var(--tw-bg-opacity))', 'b')[0], 'rgb(30 30 46 / var(--tw-bg-opacity))');
check('color-mix() and light-dark()', [rw('color-mix(in srgb, var(--x) 50%, white)', 'b')[0], rw('light-dark(rgb(0, 0, 0), rgb(255, 255, 255))', 't')[0]], ['color-mix(in srgb, var(--bfb-x, var(--x)) 50%, #1e1e2e)', 'light-dark(#cdd6f4, #cdd6f4)']);
check('words that aren’t colors, and the page’s own keywords, left alone', ['1px solid currentcolor', 'transparent', 'none', 'inherit', 'url(#grad)'].map((v) => rw(v, 'd')[0]), ['1px solid currentcolor', 'transparent', 'none', 'inherit', 'url(#grad)']);
check('twins of numbers: rgb, hsl as shadcn writes them; another variable', [R.twinValue(mocha, '255, 255, 255', 'br'), R.twinValue(mocha, '255 255 255', 'br'), R.twinValue(mocha, '0 0% 100%', 'bh'), R.twinValue(mocha, 'var(--other)', 'bh')],
  ['30, 30, 46', '30 30 46', '240 21.053% 14.902%', 'var(--bfbh-other, var(--other))']);
check('…and the numbers twins give back (rgb, hsl, oklch, oklab, hwb), read as those colors again, are base', [['rgb', '255, 255, 255', 'br'], ['hsl', '0 0% 100%', 'bh'], ['oklch', '1 0 0', 'bo'], ['oklab', '100% 0 0', 'bk'], ['hwb', '0 100% 0%', 'bw']].map(([f, v, code]) => hexOf(R.parse(f + '(' + R.twinValue(mocha, v, code) + ')'))), ['#1e1e2e', '#1e1e2e', '#1e1e2e', '#1e1e2e', '#1e1e2e']);
check('a twin of a whole value (a shadow)', R.twinValue(mocha, '0 1px 2px rgba(0,0,0,.1)', 's'), '0 1px 2px rgba(17, 17, 27, 0.1)');
const uses = [];
const a = R.cached(mocha, 'v', 'var(--q) linear-gradient(#fff, #000)', 'b', { uses });
const uses2 = [];
const b = R.cached(mocha, 'v', 'var(--q) linear-gradient(#fff, #000)', 'b', { uses: uses2 });
check('remembered: the same value turns out the same, the variables it uses told again', [a === b, uses, uses2], [true, [['--q', 'b']], [['--q', 'b']]]);
check('scrollbar-color: the thumb a line, the track a background', R.scrollbar(mocha, '#cccccc #ffffff', {}), '#3a3b4e #1e1e2e');

// ---- a picture that's a preview of a document (40x40, as makeInk and the main process look at them)
{
  const pic = (fn, bgra = false) => { const d = new Uint8ClampedArray(1600 * 4); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const [r, g, b, a = 255] = fn(x, y); const i = (y * 40 + x) * 4; d[i] = bgra ? b : r; d[i + 1] = g; d[i + 2] = bgra ? r : b; d[i + 3] = a; } return d; };
  // a page: white, lines of gray text
  const page = (x, y) => (y > 4 && y % 3 === 0 && x > 4 && x < 34 ? [150, 150, 150] : [255, 255, 255]);
  // Classroom's attachment: a page with a table, its header strong blue, its cells pale blue
  const table = (x, y) => (y < 9 ? [255, 255, 255] : x < 3 || x > 36 ? [255, 255, 255] : y < 15 ? [130, 158, 229] : y % 6 === 0 ? [80, 80, 80] : [201, 218, 248]);
  // a photo: colors everywhere; a product on white: a red shoe filling most of it
  const photo = (x, y) => [(x * 37 + y * 11) % 256, (x * 13 + y * 29) % 256, (x * 7 + y * 41) % 256];
  const shoe = (x, y) => ((x - 20) ** 2 / 360 + (y - 20) ** 2 / 200 < 1 ? [200 + (x % 5) * 8, 30 + y, 40] : [255, 255, 255]);
  const slide = (x, y) => (y > 15 && y < 20 && x > 8 && x < 30 ? [240, 240, 240] : [32, 33, 36]);
  const icon = (x, y) => (Math.abs(x - 20) < 8 && Math.abs(y - 20) < 8 ? [68, 71, 70, 255] : [0, 0, 0, 0]);
  check('paper: a page of text, Classroom’s table (strong blue header, pale cells), read as BGRA too',
    [R.paperOf(pic(page), 200, 260), R.paperOf(pic(table), 158, 105), R.paperOf(pic(table, true), 158, 105, true)], [true, true, true]);
  check('…not: a photo, a red shoe on white, a dark slide, an icon on nothing, a banner (4:1)',
    [R.paperOf(pic(photo), 200, 200), R.paperOf(pic(shoe), 200, 200), R.paperOf(pic(slide), 267, 167), R.paperOf(pic(icon), 100, 100), R.paperOf(pic(page), 800, 200)], [false, false, false, false, false]);
}

console.log(`\nrecolor: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
