'use strict';
// Bifrost — Catppuccin for sites without a style of their own (Settings → Website styles → Catppuccin for
// every site; main/web-styles.js decides where, and with which colors).
//
// A site that none of your styles is for gets Catppuccin's colors all the same: every color in its stylesheets
// is swapped for one of Catppuccin's as the page loads, the way Dark Reader's "dynamic" mode does it, but with
// Catppuccin's palette instead of a generic dark one. Nothing of the page's own is changed: each of its
// stylesheets gets a stylesheet of Bifrost's after it (adopted, after the page's own, so it wins where both say
// something, and Content-Security-Policy can't block it) with the same selectors, in the same @media, @layer,
// @supports, @container and @scope, saying only their colors again, in Catppuccin's.
//
// Which color: by what it colors (a background, text, a border or line, a shadow), how light it is and how
// colorful. A background goes to Catppuccin's backgrounds (white to base, light grays to its surfaces; a dark
// one stays dark), text to its text colors (black to text, grays to its subtexts and overlays), so a light page
// turns dark and a dark one stays dark, in Catppuccin's colors either way (Latte: the other way around); a color
// that's a color (a link's blue, an error's red) to the Catppuccin color of the nearest hue (blue, red, peach,
// yellow, green, teal, sky, sapphire, lavender, mauve, pink), as it is for text and deepened for backgrounds;
// a faint tint (a hover's 5% black) to a tint of text's color, so it still shows. Text keeps 4.5:1 on base.
//
// Sites written with CSS variables (most are now) have them turned too: a variable used for a background gets a
// twin with its value as a background (--bfb-name), one used for text another (--bft-name), and so on, set in
// the same rules as it is, and a color that uses the variable uses the twin for what it colors. Variables that
// hold a color's numbers (Bootstrap's "255, 255, 255" for rgba(var(--x), .5), shadcn's "0 0% 100%" for
// hsl(var(--x))) get twins in numbers too.
//
// Also turned: colors in style="" attributes and the old bgcolor and <font color> ones, SVG fill and stroke
// attributes, stylesheets from other sites (read through the main process, which sends only CSS, without your
// cookies), styles a page's scripts add as it runs (CSS-in-JS: insertRule and the like are watched from the
// page's own world), the open shadow roots of web components, and frames.
//
// Pictures stay as they are (photos, logos), except icons, which Google draws as black glyphs on nothing (in a
// sprite, an <img>, an SVG) and which wouldn't show on a dark base: the main process reads such a picture and
// gives it back in text's colors (recolorIcon, svgText; web-styles.js iconFetch). An icon drawn as a mask over
// its background-color takes text's color; an SVG in three colors or more (a logo) keeps them; white on a
// one-color icon (Drive's files) is base. Text right over a picture keeps the page's own color (it was chosen
// for that picture), and text or an icon that still doesn't read on what's behind it gets base's or text's.
// A page drawn on a canvas (Google Docs) and an icon drawn as a mask that doesn't show: makeInk, which does
// the same for Chromium's dark mode.
//
// Self-contained (a sandboxed preload can't require local files); the color work at the top is exported for the
// tests when this file is loaded outside a page.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module === 'object' && module) module.exports = makeCore();
    return;
  }
  try { startEngine(); } catch (e) { try { console.warn('[bifrost recolor]', e && e.message); } catch { /* no console */ } }
})();

// ===========================================================================================================
// The colors: parsing, OKLab, Catppuccin's palette, what each color becomes, and CSS values rewritten.
function makeCore() {
  // ---------------------------------------------------------------- names
  const NAMED = {};
  ('aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 ' +
    'blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 ' +
    'chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b ' +
    'darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b ' +
    'darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f ' +
    'darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 ' +
    'deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 ' +
    'fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f ' +
    'grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa ' +
    'lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff ' +
    'lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a ' +
    'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 ' +
    'lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd ' +
    'mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a ' +
    'mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 ' +
    'navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 ' +
    'palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 ' +
    'peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f ' +
    'royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d ' +
    'silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f ' +
    'steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 ' +
    'white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32 ' +
    // The system's colors, as a light page has them (with a dark color-scheme, which Bifrost sets, they'd be dark).
    'canvas ffffff canvastext 000000 field ffffff fieldtext 000000 buttonface efefef buttontext 000000 buttonborder 767676 ' +
    'linktext 0000ee visitedtext 551a8b activetext ff0000 graytext 6d6d6d mark ffff00 marktext 000000 ' +
    'highlight b4d5fe highlighttext 000000 selecteditem 0078d7 selecteditemtext ffffff windowtext 000000 ' +
    '-webkit-link 0000ee -webkit-activelink ff0000 activeborder 767676 appworkspace ffffff ' +
    'buttonhighlight dddddd buttonshadow 888888 captiontext 000000 inactiveborder ffffff inactivecaption ffffff ' +
    'inactivecaptiontext 7f7f7f infobackground fbfcc5 infotext 000000 menutext 000000 ' +
    'threeddarkshadow 666666 threedface c0c0c0 threedhighlight dddddd threedlightshadow c0c0c0 threedshadow 888888')
    .split(' ').forEach((w, i, a) => { if (i % 2 === 0) { const n = parseInt(a[i + 1], 16); NAMED[w] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } });
  // (left as they are: they're not one color, or they're the page's own to say)
  const KEEP = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', 'auto', '-webkit-focus-ring-color', 'accentcolor', 'accentcolortext', 'invert']);

  // ---------------------------------------------------------------- color math (sRGB, OKLab)
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const gam = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, v * 255)); };
  function linToLab(R, G, B) {
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  const toLab = (r, g, b) => linToLab(lin(r), lin(g), lin(b));
  function labToLin(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const inGamut = (c) => c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001;
  // OKLab -> sRGB [0-255], keeping lightness and hue: chroma is cut until the color exists.
  function fromLab(L, a, b) {
    L = Math.max(0, Math.min(1, L));
    let c = labToLin(L, a, b);
    if (!inGamut(c)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inGamut(labToLin(L, a * mid, b * mid))) lo = mid; else hi = mid; }
      c = labToLin(L, a * lo, b * lo);
    }
    return [Math.round(gam(c[0])), Math.round(gam(c[1])), Math.round(gam(c[2]))];
  }
  // The most chroma a color of this lightness and hue can have.
  function maxChroma(L, h) {
    const ca = Math.cos(h), sa = Math.sin(h);
    let lo = 0, hi = 0.5;
    for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (inGamut(labToLin(L, ca * mid, sa * mid))) lo = mid; else hi = mid; }
    return lo;
  }
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (y1, y2) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const mixLab = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const hexRgb = (hex) => { const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  // ---------------------------------------------------------------- parsing
  const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
  // A number with its unit: { n, u } ('%', 'deg', …, or ''), or { none: true }, or null.
  function num(t) {
    if (!t) return null;
    if (/^none$/i.test(t)) return { n: 0, u: '', none: true };
    const m = NUM.exec(t);
    if (!m) return null;
    const u = t.slice(m[0].length).toLowerCase();
    if (u && !/^(%|deg|rad|grad|turn)$/.test(u)) return null;
    return { n: parseFloat(m[0]), u };
  }
  const hueDeg = (x) => (x.u === 'rad' ? x.n * 180 / Math.PI : x.u === 'grad' ? x.n * 0.9 : x.n * (x.u === 'turn' ? 360 : 1));
  // The parts inside a color function, and its alpha: [parts], alpha text (or null), how they were written.
  function split(inner) {
    let body = inner.trim(), alpha = null, commas = false;
    const slash = body.lastIndexOf('/');
    if (slash >= 0) { alpha = body.slice(slash + 1).trim(); body = body.slice(0, slash).trim(); }
    let parts;
    if (body.includes(',')) { commas = true; parts = body.split(',').map((x) => x.trim()); if (alpha == null && parts.length === 4) alpha = parts.pop(); } else parts = body.split(/\s+/).filter(Boolean);
    return { parts, alpha, commas };
  }
  function alphaOf(t) {
    if (t == null || t === '') return 1;
    const x = num(t);
    if (!x || x.u && x.u !== '%') return NaN;
    return Math.max(0, Math.min(1, x.u === '%' ? x.n / 100 : x.n));
  }
  // rgb() etc. with numbers in them -> [r, g, b, a] (0-255, 0-1), or null (variables, calc(), relative colors).
  function fn(name, inner, wantAlpha = true) {
    if (/var\(|calc\(|env\(|attr\(|\bfrom\b/i.test(inner)) return null;
    const { parts, alpha } = split(inner);
    if (parts.length !== 3 && !(name === 'color' && parts.length === 4)) return null;
    const a = wantAlpha ? alphaOf(alpha) : 1;
    if (Number.isNaN(a)) return null;
    let rgb = null;
    if (name === 'rgb' || name === 'rgba') {
      const v = parts.map(num);
      if (v.some((x) => !x || (x.u && x.u !== '%'))) return null;
      rgb = v.map((x) => (x.u === '%' ? x.n * 2.55 : x.n));
    } else if (name === 'hsl' || name === 'hsla' || name === 'hwb') {
      const v = parts.map(num);
      if (v.some((x) => !x) || (v[1].u && v[1].u !== '%') || (v[2].u && v[2].u !== '%')) return null;
      const h = ((hueDeg(v[0]) % 360) + 360) % 360;
      const p = v[1].n / 100, q = v[2].n / 100;
      if (name === 'hwb') {
        let w = p, bl = q;
        if (w + bl >= 1) { const g = w / (w + bl) * 255; rgb = [g, g, g]; } else {
          const base = hslRgb(h, 1, 0.5);
          rgb = base.map((c) => (c / 255 * (1 - w - bl) + w) * 255);
        }
      } else rgb = hslRgb(h, Math.max(0, Math.min(1, p)), Math.max(0, Math.min(1, q)));
    } else if (name === 'oklab' || name === 'oklch' || name === 'lab' || name === 'lch') {
      const v = parts.map(num);
      if (v.some((x) => !x)) return null;
      const ok = name.startsWith('ok');
      let L = v[0].u === '%' ? v[0].n / 100 * (ok ? 1 : 100) : v[0].n;
      let A, B;
      if (name.endsWith('ch')) {
        const C = v[1].u === '%' ? v[1].n / 100 * (ok ? 0.4 : 150) : v[1].n;
        const h = hueDeg(v[2]) * Math.PI / 180;
        A = C * Math.cos(h); B = C * Math.sin(h);
      } else {
        A = v[1].u === '%' ? v[1].n / 100 * (ok ? 0.4 : 125) : v[1].n;
        B = v[2].u === '%' ? v[2].n / 100 * (ok ? 0.4 : 125) : v[2].n;
      }
      if (ok) rgb = labToLin(L, A, B).map((c) => gam(c));
      else rgb = cieLabRgb(L, A, B);
    } else if (name === 'color') {
      const space = parts[0].toLowerCase();
      const v = parts.slice(1).map(num);
      if (v.length !== 3 || v.some((x) => !x || (x.u && x.u !== '%'))) return null;
      const c = v.map((x) => (x.u === '%' ? x.n / 100 : x.n));
      if (space === 'srgb') rgb = c.map((x) => x * 255);
      else if (space === 'srgb-linear') rgb = c.map((x) => gam(x));
      else if (space === 'display-p3') {
        const l = c.map((x) => lin(x * 255));
        rgb = [1.2249401 * l[0] - 0.2249404 * l[1], -0.0420569 * l[0] + 1.0420571 * l[1], -0.0196376 * l[0] - 0.0786361 * l[1] + 1.0982735 * l[2]].map((x) => gam(x));
      } else if (space === 'xyz' || space === 'xyz-d65') rgb = xyzRgb(c[0], c[1], c[2]);
      else return null;
    } else return null;
    if (!rgb || rgb.some((x) => !Number.isFinite(x))) return null;
    return [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2]), a];
  }
  const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x)));
  function hslRgb(h, s, l) {
    const f = (n) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255; };
    return [f(0), f(8), f(4)];
  }
  function xyzRgb(x, y, z) {
    return [3.2409699 * x - 1.5373832 * y - 0.4986108 * z, -0.9692436 * x + 1.8759675 * y + 0.0415551 * z, 0.0556301 * x - 0.2039770 * y + 1.0569715 * z].map((c) => gam(c));
  }
  function cieLabRgb(L, a, b) {
    // CIE Lab (D50) -> XYZ D50 -> D65 (Bradford) -> sRGB
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const e = 216 / 24389, k = 24389 / 27;
    const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
    const yr = L > k * e ? fy ** 3 : L / k;
    const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
    const X = xr * 0.3457 / 0.3585, Y = yr, Z = zr * (1 - 0.3457 - 0.3585) / 0.3585;
    const x = 0.9554734 * X - 0.0230985 * Y + 0.0632593 * Z, y = -0.0283697 * X + 1.0099956 * Y + 0.0210414 * Z, z = 0.0123140 * X - 0.0205077 * Y + 1.3303659 * Z;
    return xyzRgb(x, y, z);
  }
  // One color, written any way CSS allows -> [r, g, b, a], or null (not a color, or not one we can know here).
  function parse(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t[0] === '#') return hex(t.slice(1));
    const lt = t.toLowerCase();
    if (NAMED[lt]) return [...NAMED[lt], 1];
    const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(t);
    return m ? fn(m[1].toLowerCase(), m[2]) : null;
  }
  function hex(h) {
    if (!/^[0-9a-f]+$/i.test(h)) return null;
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const fmtA = (a) => String(Math.round(a * 1000) / 1000);
  function format(c) {
    if (c[3] >= 0.9995) return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${fmtA(c[3])})`;
  }

  // ---------------------------------------------------------------- the palette
  const NAMES = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender',
    'text', 'subtext1', 'subtext0', 'overlay2', 'overlay1', 'overlay0', 'surface2', 'surface1', 'surface0', 'base', 'mantle', 'crust'];
  const NEUTRALS = ['text', 'subtext1', 'subtext0', 'overlay2', 'overlay1', 'overlay0', 'surface2', 'surface1', 'surface0', 'base', 'mantle', 'crust'];
  // The colors a color can become by its hue, and the hue (OKLab, degrees) each stands for on the web: a color goes
  // to the one whose hue it's nearest. (By where the web's colors are rather than where the palette's are:
  // Catppuccin's red leans pink, so a pure red, between it and peach, would otherwise go orange. Rosewater,
  // flamingo and maroon, paler reds and pinks, aren't among them.)
  const HUED = [['red', 25], ['peach', 55], ['yellow', 90], ['green', 145], ['teal', 180], ['sky', 210], ['sapphire', 232], ['blue', 262], ['lavender', 282], ['mauve', 305], ['pink', 335]];
  // A background this see-through or more is a tint of what's under it (a hover's shade; not a dark veil over a
  // picture, which is more opaque); a line, more so (a line is never a veil).
  const TINT_ALPHA = { b: 0.2, d: 0.6 };

  // palette: Catppuccin's 26 colors ('#rrggbb'), a flavor's or Bifrost's theme in them (shared/catppuccin.js).
  function prepare(palette) {
    const rgb = {}, lab = {};
    for (const k of NAMES) { rgb[k] = hexRgb(palette[k] || '#808080'); lab[k] = toLab(...rgb[k]); }
    const L = (k) => lab[k][0];
    const dark = L('base') < L('text');
    const ramp = NEUTRALS.map((k) => ({ k, lab: lab[k], L: L(k) })).sort((a, b) => a.L - b.L);
    const at = (a, b, t) => L(a) + (L(b) - L(a)) * t;
    // What lightness each kind of color goes to, by its own lightness (OKLab L), as points between which it's
    // drawn straight. Light backgrounds turn around (white to base, grays to the surfaces), dark ones stay dark,
    // darker than base (a light page's dark sidebar to mantle, black to crust); text the other way; lines to the
    // surfaces either way, a white one to base (as it was white on white). Latte the other way around.
    const curves = dark ? {
      b: [[0, L('crust')], [0.32, L('mantle')], [0.42, L('base')], [0.5, L('surface1')], [0.6, L('surface2')], [0.75, L('surface1')], [0.9, L('surface0')], [0.97, at('base', 'surface0', 0.35)], [1, L('base')]],
      t: [[0, L('text')], [0.36, L('text')], [0.5, L('subtext1')], [0.6, L('subtext0')], [0.7, L('overlay2')], [0.78, L('overlay1')], [0.84, L('subtext0')], [0.92, L('subtext1')], [1, L('text')]],
      d: [[0, L('surface0')], [0.3, L('surface0')], [0.45, L('surface1')], [0.55, L('surface2')], [0.7, L('surface1')], [0.86, at('surface0', 'surface1', 0.4)], [0.94, L('surface0')], [0.99, at('base', 'surface0', 0.6)], [1, L('base')]],
    } : {
      b: [[0, L('mantle')], [0.15, L('crust')], [0.3, L('surface0')], [0.45, L('surface1')], [0.55, L('surface2')], [0.65, L('surface2')], [0.8, L('surface1')], [0.88, L('surface0')], [0.94, L('crust')], [0.975, L('mantle')], [1, L('base')]],
      t: [[0, L('text')], [0.36, L('text')], [0.5, L('subtext1')], [0.6, L('subtext0')], [0.7, L('overlay2')], [0.78, L('overlay1')], [0.84, L('subtext0')], [0.92, L('subtext1')], [1, L('text')]],
      d: [[0, L('surface0')], [0.3, L('surface0')], [0.45, L('surface1')], [0.55, L('surface2')], [0.7, L('surface1')], [0.86, L('surface0')], [0.94, L('crust')], [0.99, L('mantle')], [1, L('base')]],
    };
    const hued = HUED.map(([k, deg]) => ({ k, lab: lab[k], rgb: rgb[k], C: Math.hypot(lab[k][1], lab[k][2]), h: deg * Math.PI / 180 }));
    const Y = (k) => lum(rgb[k]);
    return {
      palette, dark, rgb, lab, ramp, curves, hued,
      yBase: Y('base'), yText: Y('text'),
      // Backgrounds keep text 4.5:1 on them (dark) or 3.5:1 (light, whose surfaces are that close to its text).
      yBgMax: dark ? (Y('text') + 0.05) / 4.5 - 0.05 : 1,
      yBgMin: dark ? 0 : 3.5 * (Y('text') + 0.05) - 0.05,
      cache: new Map(),
      values: new Map(),
    };
  }

  function curve(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (x <= x1) { const [x0, y0] = points[i - 1]; return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    }
    return points[points.length - 1][1];
  }
  // The palette's grays at a lightness (between the two it's between; Catppuccin's grays are tinted).
  function rampAt(P, L) {
    const r = P.ramp;
    if (L <= r[0].L) return [L, r[0].lab[1], r[0].lab[2]];
    for (let i = 1; i < r.length; i++) {
      if (L <= r[i].L) {
        const a = r[i - 1], b = r[i];
        const t = b.L === a.L ? 1 : (L - a.L) / (b.L - a.L);
        return mixLab(a.lab, b.lab, t);
      }
    }
    const z = r[r.length - 1];
    return [L, z.lab[1], z.lab[2]];
  }
  function nearestHued(P, h) {
    let best = P.hued[0], bd = Infinity;
    const T = 2 * Math.PI;
    for (const x of P.hued) {
      let d = (((x.h - h) % T) + T) % T;
      if (d > Math.PI) d = T - d;
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  // Lightness moved (hue and chroma kept, as far as they go) until the color passes test.
  function lightnessUntil(lab, up, test) {
    let lo = lab[0], hi = up ? 1 : 0;
    if (test(fromLab(hi, lab[1], lab[2]))) {
      for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (test(fromLab(mid, lab[1], lab[2]))) hi = mid; else lo = mid; }
      return fromLab(hi, lab[1], lab[2]);
    }
    return fromLab(hi, lab[1], lab[2]);
  }

  // What a color becomes: role 'b' background, 't' text (and icons), 'd' a border or line, 's' a shadow.
  // [r, g, b, a] -> [r, g, b, a]
  function mapColor(P, c, role) {
    const a = c[3] == null ? 1 : c[3];
    if (role === 't' && a > 0 && a < 1) {
      const key = 'A' + a + ',' + c[0] + ',' + c[1] + ',' + c[2];
      let out = P.cache.get(key);
      if (!out) { out = seeThroughText(P, c, a); if (P.cache.size > 20000) P.cache.clear(); P.cache.set(key, out); }
      return out.slice();
    }
    const tint = (role === 'b' || role === 'd') && a <= TINT_ALPHA[role] && a > 0;
    const key = (tint ? role.toUpperCase() : role) + c[0] + ',' + c[1] + ',' + c[2];
    let out = P.cache.get(key);
    if (!out) { out = mapRgb(P, c, tint ? 'tint' : role); if (P.cache.size > 20000) P.cache.clear(); P.cache.set(key, out); }
    return [out[0], out[1], out[2], a];
  }
  // See-through dark gray text (Material's rgba(0,0,0,.54) and .87): what it looked like on the page's white is
  // what's turned, as an opaque gray of that lightness would be (so it's as readable on base as that), and it stays
  // see-through: text's color, at whatever alpha gives that on base. A colored one, a light one (a dark page's) and
  // a nearly invisible one keep their alpha.
  function seeThroughText(P, c, a) {
    const full = mapRgb(P, c, 't');
    const lab = toLab(c[0], c[1], c[2]);
    if (lab[0] >= 0.6 || Math.hypot(lab[1], lab[2]) >= 0.03) return [full[0], full[1], full[2], a];
    const seen = [c[0] * a + 255 * (1 - a), c[1] * a + 255 * (1 - a), c[2] * a + 255 * (1 - a)];
    if (toLab(...seen)[0] > 0.78) return [full[0], full[1], full[2], a];
    const want = mapRgb(P, seen, 't');
    const base = P.rgb.base;
    let num = 0, den = 0;
    for (let i = 0; i < 3; i++) { const w = i === 0 ? 0.2126 : i === 1 ? 0.7152 : 0.0722; num += w * (want[i] - base[i]); den += w * (full[i] - base[i]); }
    const a2 = Math.abs(den) < 1 ? a : Math.min(1, Math.max(a, num / den));
    return [full[0], full[1], full[2], Math.round(a2 * 1000) / 1000];
  }

  function mapRgb(P, c, role) {
    const lab = toLab(c[0], c[1], c[2]);
    const [L] = lab;
    const C = Math.hypot(lab[1], lab[2]);
    const h = Math.atan2(lab[2], lab[1]);
    // How much of a color it is: its chroma, against the most it could have at its lightness (a pale blue is as
    // blue as a pale color gets), and enough of it to see (near white, a trace counts for a lot of that).
    const colorful = C < 0.012 ? 0 : smooth(0.15, 0.4, C / Math.max(0.01, maxChroma(L, h))) * smooth(0.012, 0.03, C);
    const hue = colorful > 0 ? nearestHued(P, h) : null;
    if (role === 'tint') {
      // A see-through one is a shade over what's under it: more contrast either way. Text's color does that on
      // Catppuccin's backgrounds (lighter on a dark one, darker on a light one); a colored one, its color.
      return colorful > 0.5 ? hue.rgb : P.rgb.text;
    }
    if (role === 's') {
      if (colorful > 0.5) return hue.rgb;
      // (an opaque light one is a line drawn as a shadow: inset 0 -1px 0 #ddd)
      if (L > 0.6 && C < 0.05) return mapRgb(P, c, 'd');
      return P.dark ? P.rgb.crust : P.rgb.text;
    }
    const Lt = curve(P.curves[role], L);
    const gray = rampAt(P, Lt);
    let out;
    if (role === 't') {
      const toward = colorful > 0 ? mixLab(gray, hue.lab, colorful) : gray;
      out = fromLab(...toward);
      // Text reads on base: 4.5:1 for a colored one (a link, an error), 3:1 for faint gray.
      const need = colorful > 0.5 ? 4.5 : 3;
      if (ratio(lum(out), P.yBase) < need) out = lightnessUntil(toLabArr(out), P.dark, (x) => ratio(lum(x), P.yBase) >= need);
      return out;
    }
    if (colorful > 0) {
      // A pale one (an alert's background): a wash of its Catppuccin color over the gray it would have been, as
      // Catppuccin's own styles tint a surface (lines a little more). A strong one (a button's, a badge's: colorful,
      // and not near white): its Catppuccin color's hue, as deep as that gray, nearly as colorful as it was.
      let toward = mixLab(gray, hue.lab, (role === 'd' ? 0.25 : 0.12) * colorful);
      const strong = Math.min(1, C / 0.12) * smooth(0.92, 0.75, L) * colorful;
      if (strong > 0) {
        const want = Math.min(hue.C, C) * 0.9;
        const ch = Math.hypot(hue.lab[1], hue.lab[2]) || 1;
        toward = mixLab(toward, [Lt + 0.03, hue.lab[1] / ch * want, hue.lab[2] / ch * want], strong);
      }
      out = fromLab(...toward);
    } else out = fromLab(...gray);
    if (role === 'b') {
      const y = lum(out);
      if (y > P.yBgMax) out = lightnessUntil(toLabArr(out), false, (x) => lum(x) <= P.yBgMax);
      else if (y < P.yBgMin) out = lightnessUntil(toLabArr(out), true, (x) => lum(x) >= P.yBgMin);
    }
    return out;
  }
  const toLabArr = (rgb) => toLab(rgb[0], rgb[1], rgb[2]);

  // ---------------------------------------------------------------- CSS values
  // What each property colors (properties not here are left alone).
  const ROLE = new Map(Object.entries({
    color: 't', 'background-color': 'b', 'background-image': 'b', background: 'b',
    'border-top-color': 'd', 'border-right-color': 'd', 'border-bottom-color': 'd', 'border-left-color': 'd',
    'border-block-start-color': 'd', 'border-block-end-color': 'd', 'border-inline-start-color': 'd', 'border-inline-end-color': 'd',
    'outline-color': 'd', 'column-rule-color': 'd', 'text-decoration-color': 't', 'text-emphasis-color': 't', 'caret-color': 't',
    '-webkit-text-fill-color': 't', '-webkit-text-stroke-color': 't', fill: 't', stroke: 't', 'stop-color': 't', 'flood-color': 't',
    'lighting-color': 't', 'accent-color': 't', 'box-shadow': 's', 'text-shadow': 's',
    // shorthands (when a variable is in them, the browser keeps them whole)
    border: 'd', 'border-top': 'd', 'border-right': 'd', 'border-bottom': 'd', 'border-left': 'd', 'border-color': 'd',
    'border-block': 'd', 'border-block-start': 'd', 'border-block-end': 'd', 'border-block-color': 'd',
    'border-inline': 'd', 'border-inline-start': 'd', 'border-inline-end': 'd', 'border-inline-color': 'd',
    outline: 'd', 'column-rule': 'd', 'text-decoration': 't', 'text-emphasis': 't', '-webkit-text-stroke': 't',
  }));
  // The shorthands a property can come from (one with a variable in it: the property itself reads as '').
  const SHORT = new Map(Object.entries({
    'background-color': ['background'], 'background-image': ['background'],
    'border-top-color': ['border-top', 'border-color', 'border'], 'border-right-color': ['border-right', 'border-color', 'border'],
    'border-bottom-color': ['border-bottom', 'border-color', 'border'], 'border-left-color': ['border-left', 'border-color', 'border'],
    'border-block-start-color': ['border-block-start', 'border-block-color', 'border-block'], 'border-block-end-color': ['border-block-end', 'border-block-color', 'border-block'],
    'border-inline-start-color': ['border-inline-start', 'border-inline-color', 'border-inline'], 'border-inline-end-color': ['border-inline-end', 'border-inline-color', 'border-inline'],
    'outline-color': ['outline'], 'column-rule-color': ['column-rule'], 'text-decoration-color': ['text-decoration'],
    'text-emphasis-color': ['text-emphasis'], '-webkit-text-stroke-color': ['-webkit-text-stroke'],
  }));
  const COLOR_FN = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);
  const CLIP = new Set(['background-clip', '-webkit-background-clip']);
  // A variable used as a color function's numbers: the kind of numbers (rgb(var(--x)) wants "255 255 255").
  const FORM = { rgb: 'r', rgba: 'r', hsl: 'h', hsla: 'h', hwb: 'w', oklch: 'o', oklab: 'k', lch: 'c', lab: 'l' };
  const FORM_FN = { r: 'rgb', h: 'hsl', w: 'hwb', o: 'oklch', k: 'oklab', c: 'lch', l: 'lab' };
  // A variable's twin for a role (and form): --x -> --bfb-x (background), --bfbr-x (background, as rgb numbers).
  const twin = (name, code) => '--bf' + code + name.slice(1);

  function isIdentChar(c) { return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c > 127 || c === 92; }
  // The end of the bracket that opens at i (s[i] === '('), quotes and nested brackets skipped.
  function closeOf(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (c === 34 || c === 39) { j = quoteEnd(s, j) - 1; continue; }
      if (c === 92) { j++; continue; }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (depth === 0) return j + 1; }
    }
    return s.length;
  }
  function quoteEnd(s, i) {
    const q = s.charCodeAt(i);
    for (let j = i + 1; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (c === 92) { j++; continue; }
      if (c === q) return j + 1;
    }
    return s.length;
  }
  // The first top-level comma in s (not inside brackets or quotes), or -1.
  function topComma(s) {
    let depth = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (c === 34 || c === 39) { j = quoteEnd(s, j) - 1; continue; }
      if (c === 40) depth++;
      else if (c === 41) depth--;
      else if (c === 44 && depth === 0) return j;
    }
    return -1;
  }
  // url()'s address, whole ('' when it can't be).
  function urlOf(inner, base) {
    let u = inner.trim();
    const q = u[0] === '"' || u[0] === "'" ? u[0] : '';
    if (q) u = u.slice(1, u.endsWith(q) ? -1 : undefined).replace(/\\(["'\\])/g, '$1');
    if (/^data:/i.test(u)) return u;
    try { return new URL(u, base || undefined).href; } catch { return ''; }
  }
  function absUrl(inner, base) {
    let u = inner.trim();
    const q = u[0] === '"' || u[0] === "'" ? u[0] : '';
    if (q) u = u.slice(1, u.endsWith(q) ? -1 : undefined);
    if (!base || !u || /^(data:|[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u)) return null;
    try { return 'url("' + new URL(u, base).href.replace(/["\\\n]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') + '")'; } catch { return null; }
  }

  // A CSS value with its colors turned for role (and its variables pointed at their twins for it).
  // o: { base (the stylesheet's address, for its url()s), uses (an array: [name, code] of the variables it uses
  // gets pushed; null to not look), map (false: only look) }.
  function rewrite(P, s, role, o = {}) {
    let out = '';
    const n = s.length;
    let i = 0;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 39) { const j = quoteEnd(s, i); out += s.slice(i, j); i = j; continue; }
      if (c === 47 && s.charCodeAt(i + 1) === 42) { const j = s.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; out += s.slice(i, e); i = e; continue; }
      if (c === 35) {   // #
        let j = i + 1;
        while (j < n && isIdentChar(s.charCodeAt(j))) j++;
        const h = hex(s.slice(i + 1, j));
        out += h && o.map !== false ? format(mapColor(P, h, role)) : s.slice(i, j);
        i = j;
        continue;
      }
      // (a number's unit, like the "e" in 1e3 or the "px" in 10px, isn't a word on its own)
      if (isIdentChar(c) && !(c >= 48 && c <= 57) && !(i > 0 && /[\d.]/.test(s[i - 1]))) {
        let j = i;
        while (j < n && isIdentChar(s.charCodeAt(j))) { if (s.charCodeAt(j) === 92) j++; j++; }
        const word = s.slice(i, j);
        if (s.charCodeAt(j) === 40) {   // a function
          const k = closeOf(s, j);
          out += call(P, word, s.slice(j + 1, k - 1), role, o, s.slice(i, k));
          i = k;
          continue;
        }
        const lw = word.toLowerCase();
        out += o.map !== false && NAMED[lw] && !KEEP.has(lw) ? format(mapColor(P, [...NAMED[lw], 1], role)) : word;
        i = j;
        continue;
      }
      if (c >= 48 && c <= 57 || c === 46) {
        // a number with its unit, copied whole
        let j = i + 1;
        while (j < n && isIdentChar(s.charCodeAt(j)) || s[j] === '.') j++;
        out += s.slice(i, j);
        i = j;
        continue;
      }
      out += s[i];
      i++;
    }
    return out;
  }

  function call(P, word, inner, role, o, whole) {
    const name = word.toLowerCase();
    if (name === 'url') {
      if (o.map === false) return whole;
      const svg = svgUrl(P, inner);
      if (svg) return svg;
      // (a picture that's an icon: in text's colors, once the main process has made it so: o.icon)
      if (o.icon) { const got = o.icon(urlOf(inner, o.base)); if (got) return 'url("' + got + '")'; }
      return absUrl(inner, o.base) || whole;
    }
    if (name === 'var') return varRef(P, inner, role, '', o);
    if (COLOR_FN.has(name)) {
      const c = fn(name, inner);
      if (c) return o.map !== false ? format(mapColor(P, c, role)) : whole;
      if (!/var\(/i.test(inner)) return word + '(' + rewrite(P, inner, role, o) + ')';
      const form = FORM[name];
      const sp = split(inner);
      // (rgba(var(--x), .5): the numbers are in the variable, the alpha after the comma)
      if (sp.commas && sp.alpha == null && sp.parts.length === 2) { sp.alpha = sp.parts[1]; sp.parts = [sp.parts[0]]; }
      // rgb(var(--x)), rgb(var(--x) / .5), rgba(var(--x), .5): a variable holding the numbers.
      if (form && sp.parts.length === 1 && /^var\(/i.test(sp.parts[0]) && closeOf(sp.parts[0], 3) === sp.parts[0].length) {
        const v = varRef(P, sp.parts[0].slice(4, -1), role, form, o);
        return word + '(' + v + (sp.alpha != null ? (sp.commas ? ', ' : ' / ') + sp.alpha : '') + ')';
      }
      // rgb(255 255 255 / var(--tw-bg-opacity)): the numbers here, the alpha from a variable.
      if (sp.alpha != null && /var\(/i.test(sp.alpha) && !/var\(/i.test(sp.parts.join(' '))) {
        const c2 = fn(name, sp.parts.join(sp.commas ? ', ' : ' '), false);
        if (c2 && o.map !== false) {
          const m = mapColor(P, [c2[0], c2[1], c2[2], 1], role);
          return sp.commas ? `${name === 'rgba' || name === 'rgb' ? word : 'rgba'}(${m[0]}, ${m[1]}, ${m[2]}, ${sp.alpha})` : `rgb(${m[0]} ${m[1]} ${m[2]} / ${sp.alpha})`;
        }
      }
      return word + '(' + rewrite(P, inner, role, o) + ')';
    }
    // Anything else (gradients, color-mix(), light-dark(), image-set(), calc()): what's inside it.
    return word + '(' + rewrite(P, inner, role, o) + ')';
  }

  // An SVG picture written into the stylesheet (data:image/svg+xml: a select's arrow, a close button's ×, a
  // checkbox's tick, as Bootstrap draws them): its fills and strokes turned as an icon's (text's colors: a dark
  // arrow would vanish on a dark page). null when it isn't one, or has no colors to turn.
  function svgUrl(P, inner) {
    let u = inner.trim();
    const q = u[0] === '"' || u[0] === "'" ? u[0] : '';
    if (q) u = u.slice(1, u.endsWith(q) ? -1 : undefined).replace(/\\(["'\\])/g, '$1');
    const m = /^data:image\/svg\+xml(;[^,]*)?,/i.exec(u);
    if (!m) return null;
    let body = u.slice(m[0].length);
    try {
      if (/;base64/i.test(m[1] || '')) { const bin = atob(body.replace(/\s+/g, '')); body = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); } else body = decodeURIComponent(body);
    } catch { return null; }
    body = svgText(P, body);
    if (body == null) return null;
    return 'url("data:image/svg+xml,' + body.replace(/[%#<>"\n\r\t]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '")';
  }
  // An SVG picture's text (one drawn as a background, or an <img>'s) with its colors as an icon's, text's: its
  // fills, strokes and stops, and what it draws in without saying (black; currentColor, which is black in a
  // picture) in text's color too. null: nothing to change, or it's art (a logo: three colors or more), kept.
  const SVG_ATTR = /\b(fill|stroke|stop-color|flood-color|color)(\s*=\s*)(['"])([^'"]*)\3/gi;
  const SVG_PROP = /\b(fill|stroke|stop-color|flood-color)(\s*:\s*)([^;'"}<>]+)/gi;
  function svgText(P, body) {
    const colors = [];
    const grab = (v) => { const c = parse(String(v).trim()); if (c) colors.push(c); };
    body.replace(SVG_ATTR, (all, a, eq, qq, v) => { grab(v); return all; });
    body.replace(SVG_PROP, (all, a, colon, v) => { grab(v); return all; });
    if (isArt(colors)) return null;
    let changed = false;
    const turn = (v) => { const c = parse(v.trim()); if (!c) return v; changed = true; return format(mapColor(P, c, 't')); };
    body = body.replace(SVG_ATTR, (all, a, eq, qq, v) => a + eq + qq + turn(v) + qq);
    body = body.replace(SVG_PROP, (all, a, colon, v) => a + colon + turn(v));
    const root = /<svg\b[^>]*>/i.exec(body);
    if (root) {
      const text = format(mapColor(P, [0, 0, 0, 1], 't'));
      let tag = root[0];
      if (!/\sfill\s*=/i.test(tag) && !/fill\s*:/i.test(tag)) tag = tag.replace(/^<svg\b/i, `<svg fill="${text}"`);
      if (!/\scolor\s*=/i.test(tag)) tag = tag.replace(/^<svg\b/i, `<svg color="${text}"`);
      if (tag !== root[0]) { body = body.slice(0, root.index) + tag + body.slice(root.index + root[0].length); changed = true; }
    }
    return changed ? body : null;
  }

  // ---------------------------------------------------------------- pictures
  // How much of a color a color is (0-1, as mapRgb has it) and its hue.
  function hueOf(c) {
    const lab = toLab(c[0], c[1], c[2]);
    const C = Math.hypot(lab[1], lab[2]);
    const h = Math.atan2(lab[2], lab[1]);
    return { L: lab[0], C, h, colorful: C < 0.012 ? 0 : smooth(0.15, 0.4, C / Math.max(0.01, maxChroma(lab[0], h))) * smooth(0.012, 0.03, C) };
  }
  // Colors that are art, a logo or a brand's mark (Google's four, a microphone in them): three hues or more.
  function isArt(colors) {
    const hues = new Set();
    for (const c of colors) {
      if (c[3] === 0) continue;
      const x = hueOf(c);
      if (x.colorful > 0.5) hues.add(Math.round((((x.h * 180 / Math.PI) + 360) % 360) / 30) % 12);
      if (hues.size >= 3) return true;
    }
    return false;
  }
  const isColor = (c) => !!c && hueOf(c).colorful > 0.5;

  // A picture that's an icon, drawn in text's colors where it wouldn't show as it is (a black glyph on a
  // see-through background, on a dark page; a white one on a light page): px, its pixels (BGRA, alpha
  // premultiplied, as Chromium keeps a picture), are changed in place, and true. false for anything else: a
  // photo, a logo, a picture with a background of its own, an icon that shows as it is.
  function recolorIcon(P, px, w, h) {
    const n = w * h;
    if (!n || px.length < n * 4) return false;
    const step = n > 250000 ? Math.ceil(n / 250000) : 1;
    let clear = 0, looked = 0, seen = 0, neutral = 0, sumL = 0;
    for (let i = 0; i < n; i += step) {
      looked++;
      const a = px[i * 4 + 3];
      if (a < 26) { clear++; continue; }
      if (a < 128) continue;
      const k = 255 / a;
      const lab = toLab(Math.min(255, px[i * 4 + 2] * k), Math.min(255, px[i * 4 + 1] * k), Math.min(255, px[i * 4] * k));
      seen++;
      if (Math.hypot(lab[1], lab[2]) < 0.04) neutral++;
      sumL += lab[0];
    }
    if (seen < 6 || clear < looked * 0.2 || neutral < seen * 0.9) return false;
    const L = sumL / seen;
    if (P.dark ? L >= 0.62 : L <= 0.6) return false;
    const memo = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = px[o + 3];
      if (!a) continue;
      const k = 255 / a;
      const r = Math.min(255, Math.round(px[o + 2] * k)), g = Math.min(255, Math.round(px[o + 1] * k)), b = Math.min(255, Math.round(px[o] * k));
      const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2);
      let m = memo.get(key);
      if (!m) { m = mapColor(P, [r, g, b, 1], 't'); memo.set(key, m); }
      px[o] = Math.round(m[2] * a / 255); px[o + 1] = Math.round(m[1] * a / 255); px[o + 2] = Math.round(m[0] * a / 255);
    }
    return true;
  }

  // A picture that's a page of a document (a preview of one: Docs' and Drive's, Classroom's attachments), looked
  // at small (d: 40x40 pixels, RGBA, or BGRA as the main process reads the screen): opaque, flat (a document's few
  // colors, not a photo's many: 200 at most, in 5-bit steps), an eighth of it or more white (the paper; a page
  // that's mostly a table has little left), half of it light (pale cells count), under half strong color (a
  // table's header), no wider than twice its height nor taller (not a banner). Looked for only on Google's apps
  // for documents, where pictures this big are previews (pictures, not canvases: kind()).
  function paperOf(d, w, h, bgra) {
    if (!d || !w || !h || w / h > 2.1 || h / w > 2.1) return false;
    const n = d.length / 4;
    let opaque = 0, light = 0, strong = 0, white = 0;
    const bins = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 240) continue;
      opaque++;
      const r = bgra ? d[i + 2] : d[i], g = d[i + 1], b = bgra ? d[i] : d[i + 2];
      bins.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
      const lab = toLab(r, g, b);
      const C = Math.hypot(lab[1], lab[2]);
      if (lab[0] > 0.78 && C < 0.1) light++;
      if (lab[0] > 0.95 && C < 0.025) white++;
      if (C > 0.1) strong++;
    }
    return opaque >= n * 0.95 && bins.size <= 200 && white >= n * 0.12 && light >= n * 0.45 && strong < n * 0.5;
  }

  // A picture's lightness turned around, its colors kept (a page drawn on a canvas, as Google Docs does: white
  // to bg, black to fg, a blue link a lighter blue): an SVG filter as a CSS filter value. bg, fg: [r, g, b].
  function inkFilter(bg, fg) {
    const Y = [0.2126, 0.7152, 0.0722];
    const rows = [];
    for (let c = 0; c < 3; c++) {
      const b = bg[c] / 255, t = fg[c] / 255, k = b - t - 1;
      rows.push([(c === 0 ? 1 : 0) + k * Y[0], (c === 1 ? 1 : 0) + k * Y[1], (c === 2 ? 1 : 0) + k * Y[2], 0, t]);
    }
    rows.push([0, 0, 0, 1, 0]);
    const values = rows.flat().map((x) => String(Math.round(x * 10000) / 10000)).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="i" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter></svg>`;
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '#i")';
  }

  // var(--x[, fallback]) -> var(--bf<code>-x, var(--x[, fallback turned])): the twin where Bifrost set one (the
  // variable was set in a stylesheet it read), else the variable as it is.
  function varRef(P, inner, role, form, o) {
    const k = topComma(inner);
    const name = (k < 0 ? inner : inner.slice(0, k)).trim();
    if (!/^--[^\s,()]+$/.test(name)) return 'var(' + rewrite(P, inner, role, o) + ')';
    const code = role + form;
    if (o.uses) o.uses.push([name, code]);
    let fb = '';
    if (k >= 0) {
      const f = inner.slice(k + 1);
      fb = ',' + (form ? (/var\(/i.test(f) ? rewrite(P, f, role, o) : parts(P, f, code, o)) : rewrite(P, f, role, o));
    }
    if (o.map === false) return 'var(' + inner + ')';
    return `var(${twin(name, code)}, var(${name}${fb}))`;
  }

  // A variable's value as color numbers ("255, 255, 255", "0 0% 100%", "0.98 0.01 250") turned, written the
  // same way; one that's another variable, pointed at its twin.
  function parts(P, value, code, o = {}) {
    const v = String(value).trim();
    const form = code.slice(1), role = code[0];
    if (/^var\(/i.test(v) && closeOf(v, 3) === v.length) return varRef(P, v.slice(4, -1), role, form, o);
    if (o.map === false) return v;
    const name = FORM_FN[form];
    const c = name && fn(name, v);
    if (!c) return v;
    const m = mapColor(P, c, role);
    const commas = v.includes(',');
    const sep = commas ? ', ' : ' ';
    const alpha = /\//.test(v) ? ' / ' + v.slice(v.lastIndexOf('/') + 1).trim() : '';
    const r3 = (x) => String(Math.round(x * 1000) / 1000);
    if (form === 'r') return [m[0], m[1], m[2]].join(sep) + alpha;
    const lab = toLab(m[0], m[1], m[2]);
    if (form === 'h' || form === 'w') {
      const [hh, ss, ll] = rgbHsl(m);
      if (form === 'w') {
        const w = Math.min(m[0], m[1], m[2]) / 255, bl = 1 - Math.max(m[0], m[1], m[2]) / 255;
        return [r3(hh), r3(w * 100) + '%', r3(bl * 100) + '%'].join(sep) + alpha;
      }
      // (shadcn writes "0 0% 100%"; some write the percentages without the %)
      const pct = /%/.test(v) ? '%' : '';
      return [r3(hh), r3(ss * 100) + pct, r3(ll * 100) + pct].join(sep) + alpha;
    }
    if (form === 'o' || form === 'k') {
      const pct = /^\s*[\d.]+%/.test(v);
      const Lp = pct ? r3(lab[0] * 100) + '%' : r3(lab[0]);
      if (form === 'k') return [Lp, r3(lab[1]), r3(lab[2])].join(sep) + alpha;
      const C = Math.hypot(lab[1], lab[2]);
      const H = ((Math.atan2(lab[2], lab[1]) * 180 / Math.PI) + 360) % 360;
      return [Lp, r3(C), r3(H)].join(sep) + alpha;
    }
    // lab()/lch() numbers: written as the browser would take them back (CIE Lab, from sRGB).
    const cl = rgbCieLab(m);
    if (form === 'l') return [r3(cl[0]), r3(cl[1]), r3(cl[2])].join(sep) + alpha;
    return [r3(cl[0]), r3(Math.hypot(cl[1], cl[2])), r3(((Math.atan2(cl[2], cl[1]) * 180 / Math.PI) + 360) % 360)].join(sep) + alpha;
  }
  function rgbHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function rgbCieLab(c) {
    const R = lin(c[0]), G = lin(c[1]), B = lin(c[2]);
    let x = 0.4123908 * R + 0.3575843 * G + 0.1804808 * B, y = 0.2126390 * R + 0.7151687 * G + 0.0721923 * B, z = 0.0193308 * R + 0.1191948 * G + 0.9505322 * B;
    // D65 -> D50
    const X = 1.0479298 * x + 0.0229468 * y - 0.0501922 * z, Y = 0.0296278 * x + 0.9904344 * y - 0.0170738 * z, Z = -0.0092430 * x + 0.0150552 * y + 0.7518742 * z;
    const e = 216 / 24389, k = 24389 / 27;
    const f = (t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
    const fx = f(X / (0.3457 / 0.3585)), fy = f(Y), fz = f(Z / ((1 - 0.3457 - 0.3585) / 0.3585));
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // A variable's twin's value: the variable's own value, turned for code (role, and form when it holds numbers).
  function twinValue(P, value, code, o = {}) {
    return code.length > 1 ? parts(P, value, code, o) : rewrite(P, value, code, o);
  }

  // The same, remembered (a site says the same colors thousands of times): the value turned, and the variables
  // it uses ([name, code]), pushed onto o.uses when that's given. kind 'v': a property's value for role; 't': a
  // twin's value for code.
  function cached(P, kind, value, code, o = {}) {
    const hasUrl = value.indexOf('url(') >= 0 || value.indexOf('URL(') >= 0;
    const key = kind + code + '\u0001' + (hasUrl ? (o.base || '') + '\u0001' + (o.icon ? 'i' + (o.iv || 0) : '') + '\u0001' : '') + value;
    let hit = P.values.get(key);
    if (!hit) {
      const uses = value.indexOf('var(') >= 0 ? [] : null;
      const opts = { base: o.base, uses, icon: hasUrl ? o.icon : null };
      const out = kind === 't' ? twinValue(P, value, code, opts) : rewrite(P, value, code, opts);
      hit = { out, uses };
      if (P.values.size > 50000) P.values.clear();
      P.values.set(key, hit);
    }
    if (o.uses && hit.uses) for (const u of hit.uses) o.uses.push(u);
    return hit.out;
  }

  // A rule's declarations as the browser writes them back (style.cssText: one call, where asking for each property
  // is two calls a property; Bootstrap's rules set thousands of variables) -> [property, value, important] for the
  // ones that color something, and every variable (all: every one).
  // (an icon drawn as a mask over its background-color, as Google draws many: that color is the icon's)
  const MASK = new Set(['mask', 'mask-image', '-webkit-mask', '-webkit-mask-image', '-webkit-mask-box-image']);
  function declarations(text, all) {
    const out = [];
    let masked = false;
    // (nearly always nothing in it can hide a ';': split as it is)
    const plain = !/["'{[\\]/.test(text);
    const list = plain ? text.split(';') : splitDecls(text);
    for (const decl of list) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      let p = decl.slice(0, colon).trim();
      if (!p) continue;
      if (!(p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45)) {
        p = p.toLowerCase();
        if (MASK.has(p) && /url\(|image-set\(/i.test(decl)) masked = true;
        // (background-clip: text kept: that rule's background is its text's color, a gradient on letters)
        if (!all && !ROLE.has(p) && p !== 'color-scheme' && p !== 'scrollbar-color' && !(CLIP.has(p) && /\btext\b/i.test(decl))) continue;
      }
      let v = decl.slice(colon + 1);
      let imp = false;
      if (v.indexOf('!') >= 0) { const m = /!\s*important\s*$/i.exec(v); if (m) { imp = true; v = v.slice(0, m.index); } }
      out.push([p, v.trim(), imp]);
      // (and background-clip: text inside the shorthand, which is how CSSOM writes it: "background: linear-gradient(…) text")
      if (p === 'background' && /text/i.test(v) && clipsText(v)) out.push(['background-clip', 'text', false]);
    }
    if (masked && out.some((d) => d[0] === 'background' || d[0] === 'background-color')) out.push(['-bifrost-masked', '', false]);
    return out;
  }
  // A background shorthand's own "text" (not one inside a function or a string): its background-clip.
  function clipsText(v) {
    let s = v.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
    for (let k = 0; k < 8 && s.indexOf('(') >= 0; k++) s = s.replace(/\([^()]*\)/g, '');
    return /(^|[\s,/])text(?=$|[\s,/])/i.test(s);
  }
  function splitDecls(text) {
    const out = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      let j = i, depth = 0;
      for (; j < n; j++) {
        const c = text.charCodeAt(j);
        if (c === 34 || c === 39) { j = quoteEnd(text, j) - 1; continue; }
        if (c === 92) { j++; continue; }
        if (c === 40 || c === 91 || c === 123) depth++;
        else if (c === 41 || c === 93 || c === 125) depth--;
        else if (c === 59 && depth <= 0) break;
      }
      out.push(text.slice(i, j));
      i = j + 1;
    }
    return out;
  }

  // scrollbar-color: "thumb track": the thumb a line, the track a background.
  function scrollbar(P, value, o) {
    const v = value.trim();
    const m = /^(\S+(?:\([^)]*\))?)\s+(\S+(?:\([^)]*\))?)$/.exec(v);
    if (!m) return rewrite(P, v, 'b', o);
    return rewrite(P, m[1], 'd', o) + ' ' + rewrite(P, m[2], 'b', o);
  }

  return {
    parse, format, prepare, mapColor, rewrite, twinValue, cached, parts, scrollbar, declarations, twin, curve, rampAt, fromLab, toLab, lum, ratio,
    svgText, isArt, isColor, hueOf, recolorIcon, inkFilter, paperOf,
    ROLE, SHORT, NAMED, NAMES, KEEP, TINT_ALPHA, CLIP,
  };
}

// ===========================================================================================================
// The page side. Each of the page's stylesheets (its <style> and <link> ones, the ones it adopts, those in the
// open shadow roots of its web components) is read once into a short list of what it says about colors (its
// rules' selectors, the @-rules they're in, their color declarations and variables): enough to write Bifrost's
// stylesheet for it again without reading the page's (when a variable turns out to be used for a color, from a
// stylesheet read later, or the palette changes).
function startEngine() {
  const { ipcRenderer, contextBridge } = require('electron');
  const isTop = window.top === window;
  // (a frame of the page's own written by address, about:srcdoc, is part of its page: in its colors too)
  const blank = !isTop && /^about:(blank|srcdoc)$/.test(location.href);
  if (!/^(https?|file):$/.test(location.protocol) && !blank) return;
  const href = location.href;

  // What the page starts with: one question for the page (shared with tab.js and adblock.js, in this world);
  // a frame asks without waiting, once for all three.
  function topStart() {
    const have = globalThis.__bifrostStart;
    if (have && have.href === href) return have.data;
    let data = null;
    try { data = ipcRenderer.sendSync('tab:start', href); } catch { data = null; }
    try { globalThis.__bifrostStart = { href, data }; } catch { /* asked again */ }
    return data;
  }
  function frameStart() {
    const have = globalThis.__bifrostFrameStart;
    if (have && have.href === href) return have.p;
    const p = ipcRenderer.invoke('tab:start-frame', href).catch(() => null);
    try { globalThis.__bifrostFrameStart = { href, p }; } catch { /* asked again */ }
    return p;
  }

  // (made the first time this page is to be in Catppuccin's colors: most pages never are, and then nothing of
  // this is done in them, in every frame of every page)
  let engine = null;
  // (Bifrost's other stylesheets in the page, makeInk's: not the page's, so not turned)
  const own = new WeakSet();
  const get = () => engine || (engine = makeEngine(makeCore(), window, {
    main: true,
    own,
    // another site's stylesheet: what the main process has read already (at once), or read now
    cssNow: (url) => { try { return ipcRenderer.sendSync('recolor:css-now', url); } catch { return null; } },
    css: (url) => ipcRenderer.invoke('recolor:css', url).catch(() => null),
    // a picture that may be an icon: it in text's colors (a data: address), or null
    icon: (url) => ipcRenderer.invoke('recolor:icon', url).catch(() => null),
    pageWorld: (func) => contextBridge.executeInMainWorld({ func }),
  }));
  // Pages drawn on a canvas and icons drawn as masks, made to show on a dark page (makeInk): in Catppuccin's
  // colors while the page is in them, in Chromium's dark mode's while that's on.
  let ink = null;
  let recolorCfg = null, chromiumDark = false;
  const inkNow = () => {
    const m = recolorCfg && recolorCfg.palette ? { palette: recolorCfg.palette } : chromiumDark ? { chromium: true } : null;
    if (!ink && !m) return;
    if (!ink) ink = makeInk(makeCore(), window, own, isTop ? (rects) => ipcRenderer.invoke('recolor:look', rects).catch(() => null) : null);
    ink.set(m);
  };
  const set = (cfg) => {
    recolorCfg = cfg && cfg.palette ? cfg : null;
    if (engine || recolorCfg) get().setConfig(cfg);
    inkNow();
  };
  const setDark = (on) => { chromiumDark = !!on; inkNow(); };
  try { Object.defineProperty(globalThis, '__bifrostRecolor', { get: () => (engine ? engine.stats : null), configurable: true }); } catch { /* there */ }
  try { Object.defineProperty(globalThis, '__bifrostInk', { get: () => (ink ? ink.stats : null), configurable: true }); } catch { /* there */ }
  // (tab.js calls this after it puts your styles for the site in: they go last)
  globalThis.__bifrostArrange = () => { if (engine) engine.arrange(); };
  ipcRenderer.on('tab-recolor', (_e, cfg) => set(cfg));
  ipcRenderer.on('tab-dark-mode', (_e, on) => setDark(on));
  if (isTop) {
    const st = topStart();
    if (st && st.darkMode) chromiumDark = true;
    if (st && st.recolor) set(st.recolor); else inkNow();
  } else {
    frameStart().then((r) => {
      if (r && r.darkMode) chromiumDark = true;
      if (r && r.recolor && !(engine && engine.on())) set(r.recolor); else inkNow();
    });
  }
}

// What a dark page doesn't show by itself: a page drawn on a canvas (Google Docs draws its pages so: black
// letters, on white or on nothing, which no stylesheet reaches and Chromium's dark mode leaves as they are) and
// icons drawn as a mask over a dark background-color (Google's: Chromium's dark mode keeps a dark background dark,
// and one in a rule Bifrost couldn't tell was a mask's is turned as a background). A canvas that's mostly white
// paper, or black ink on nothing, has its lightness turned around (core.inkFilter: white to the page's
// background, black to its text, colors kept); such an icon is drawn in text's color. Each is marked
// data-bifrost-ink (paper, ink, mask) for one stylesheet of Bifrost's. m: { palette } (Catppuccin's colors) or
// { chromium: true } (Chromium's dark mode: white goes to #121212), or null: off.
//   On Google's apps, a picture that's a preview of a document (Docs' and Drive's, Classroom's attachments: white
// paper) is turned as a canvas of paper is. It's read here when it can be (from this site, or with CORS); one
// from another site (most are) is looked at on the screen by the main process once it's all in view (look:
// recolor:look, the top frame's only), which says only whether it's paper.
//   In Chromium's dark mode, an inline SVG drawn only in light grays (white) on a light part of the page — a
// piece of the page drawn in its white, Classroom's rounded corner — is darkened (data-bifrost-ink="svg"):
// Chromium's dark mode turns a dark icon in an SVG light (it looks at it as at a picture) but leaves a light one
// as it is.
function makeInk(core, win, own, look) {
  const document = win.document;
  const getComputedStyle = (el) => win.getComputedStyle(el);
  const ATTR = 'data-bifrost-ink';
  // (an icon's element: nothing in it but, as Google writes theirs, a space: &nbsp;)
  const MASKS = 'div,span,i,a,b,em,button,li,label';
  const blank = (el) => el.childElementCount === 0 && !el.textContent.trim();
  // (Google's apps for documents — Docs, Sheets, Slides, Drive, Classroom — where pictures this big are previews;
  // google.test: the tests' stand-in for them, a name no site on the web can have)
  const google = /^(docs|drive|classroom)\.google\.com$|\.google\.test$/i.test(win.location.hostname);
  const stats = { canvases: 0, papers: 0, masks: 0, svgs: 0, pictures: 0, looked: 0, ms: 0 };
  let mode = null, sheet = null, mo = null, io = null, timer = 0, pending = [];
  const looked = new WeakMap();   // canvas -> how many times looked at (it may draw later)
  const watched = new WeakMap();  // element -> what it's watched for ('mask': laid out; 'pic': all in view)
  const svgSeen = new WeakSet();
  const picSeen = new WeakMap();  // picture -> how many times looked at on the screen
  const shown = new WeakMap();    // picture -> the part of it that shows, from its corner
  const rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function css() {
    if (mode.chromium) {
      return `canvas[${ATTR}],[${ATTR}="paper"]{filter:${core.inkFilter([18, 18, 18], [227, 227, 227])}!important}` +
        // (an SVG in light grays: a CSS filter of its own, as an SVG element doesn't draw at all with a filter
        // from a data: URL; white to about Chromium's dark gray for a page's white)
        `svg[${ATTR}="svg"]{filter:invert(.89)!important}` +
        `[${ATTR}="mask"]{filter:invert(1) hue-rotate(180deg)!important}`;
    }
    const p = mode.palette;
    return `canvas[${ATTR}],[${ATTR}="paper"]{filter:${core.inkFilter(rgb(p.base), rgb(p.text))}!important}` +
      `[${ATTR}="mask"]{background-color:${p.subtext1}!important}`;
  }
  const dark = () => !!mode && (mode.chromium || core.lum(rgb(mode.palette.base)) < core.lum(rgb(mode.palette.text)));
  // A canvas, looked at small: 'paper' (mostly opaque white or pale fills, little strong color), 'ink' (mostly
  // nothing, what's drawn dark gray), '' (anything else: a photo, a chart in colors, a game), or null: nothing
  // drawn yet (or only part of it), or it can't be read (a picture from another site drawn on it).
  // (a new one each time: one used again kept what was drawn on it last when the next canvas drew nothing on it,
  // a canvas with nothing drawn on it yet read as the one before it)
  const probeOf = () => (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(40, 40).getContext('2d', { willReadFrequently: true }) : null);
  function kind(cv) {
    const probe = cv.width && cv.height ? probeOf() : null;
    if (!probe) return null;
    const r = cv.getBoundingClientRect();
    if (r.width < 200 || r.height < 100) return '';
    let d;
    try { probe.drawImage(cv, 0, 0, 40, 40); d = probe.getImageData(0, 0, 40, 40).data; } catch { return null; }
    let opaque = 0, light = 0, seen = 0, inky = 0, colored = 0, strong = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 20) continue;
      seen++;
      if (a === 255 && !d[i] && !d[i + 1] && !d[i + 2]) black++;
      const lab = core.toLab(d[i], d[i + 1], d[i + 2]);
      const C = Math.hypot(lab[1], lab[2]);
      if (C > 0.06) colored++;
      if (C > 0.1) strong++;
      // (light: white, and the pale fills a document or a spreadsheet's cells have: Sheets' light red, its blue
      // for the column you're in)
      if (a > 230) { opaque++; if (lab[0] > 0.78 && C < 0.1) light++; }
      if (lab[0] < 0.45 && C < 0.06) inky++;
    }
    const n = 1600;
    // (nothing drawn on it yet, or not all of it: nothing, or, on a canvas without see-through (alpha: false, as
    // Sheets' grid is), black where it isn't drawn yet: Sheets draws its grid a piece at a time)
    if (!seen || black > n * 0.1) return null;
    if (opaque > n * 0.85 && light > n * 0.6 && strong < seen * 0.15) return 'paper';
    if (seen < n * 0.5 && inky > seen * 0.7 && colored < seen * 0.2) return 'ink';
    return '';
  }
  function canvasOne(cv) {
    if (!mode || cv.hasAttribute(ATTR)) return;
    const k = kind(cv);
    const times = (looked.get(cv) || 0) + 1;
    looked.set(cv, times);
    // (white paper needs turning on a dark page only; black ink on nothing, too)
    if (k && dark()) { cv.setAttribute(ATTR, k); stats.papers++; return; }
    // (nothing on it yet: looked at again, a few times, as a page draws its canvases a little later; Sheets' grid
    // once the spreadsheet is in, which can be a while)
    if (k === null && times < 7) setTimeout(() => canvasOne(cv), [400, 1500, 4000, 10000, 20000, 40000][times - 1]);
  }
  // Watched till it's laid out (an icon in a toolbar that isn't shown yet: Docs') or all in view (a picture
  // looked at on the screen).
  function watch(el, what) {
    if (watched.get(el) === what) return;
    if (!io) {
      io = new win.IntersectionObserver((entries) => {
        for (const e of entries) {
          const what = watched.get(e.target);
          if (!what || !mode) continue;
          if (what === 'mask' && e.boundingClientRect.width > 0) { io.unobserve(e.target); watched.delete(e.target); maskOne(e.target, false); }
          else if (what === 'pic' && e.intersectionRatio >= 0.9) {
            io.unobserve(e.target); watched.delete(e.target);
            // (the part of it that shows: a preview in a card with rounded corners is cut a little)
            const b = e.boundingClientRect, v = e.intersectionRect;
            shown.set(e.target, { dx: v.left - b.left, dy: v.top - b.top, w: v.width, h: v.height });
            onScreen(e.target);
          }
        }
      }, { threshold: [0, 0.9, 1] });
    }
    watched.set(el, what);
    io.observe(el);
  }
  // An icon drawn as a mask (a small element with nothing in it, a mask-image, a background-color) that doesn't
  // show on the page as it is.
  function maskOne(el, again) {
    const had = el.getAttribute(ATTR) === 'mask';
    if (el.hasAttribute(ATTR) && !had) return;
    if (had) { if (!again) return; el.removeAttribute(ATTR); }
    const cs = getComputedStyle(el);
    const m = cs.webkitMaskImage || cs.maskImage;
    if (!m || m === 'none' || !/url\(|image-set\(/i.test(m)) return;
    const c = core.parse(cs.backgroundColor);
    if (!c || c[3] < 0.3) return;
    const r = el.getBoundingClientRect();
    // (not laid out yet: looked at once it is)
    if (!r.width && cs.display !== 'contents') { watch(el, 'mask'); return; }
    if (r.width > 96 || r.height > 96) return;
    let hide;
    if (mode.chromium) hide = core.toLab(c[0], c[1], c[2])[0] < 0.55 && core.hueOf(c).colorful < 0.5;
    else hide = core.ratio(core.lum(c), core.lum(rgb(mode.palette.base))) < 2.6;
    if (hide) { el.setAttribute(ATTR, 'mask'); if (!had) stats.masks++; }
  }
  // What's behind an element, as the page has it: light (true), dark or a picture (false).
  function lightBehind(el) {
    for (let e = el.parentElement, k = 0; e && k < 40; e = e.parentElement, k++) {
      const cs = getComputedStyle(e);
      if (/url\(/i.test(cs.backgroundImage)) return false;
      const c = core.parse(cs.backgroundColor);
      if (c && c[3] >= 0.5) return core.toLab(c[0], c[1], c[2])[0] > 0.75;
    }
    return true;
  }
  // An inline SVG in light grays on a light part of the page (Chromium's dark mode only: it leaves those).
  const SHAPES = 'path,rect,circle,ellipse,polygon,polyline,line,text,use';
  function svgOne(svg) {
    if (svgSeen.has(svg) || svg.hasAttribute(ATTR) || svg.ownerSVGElement) return;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    svgSeen.add(svg);
    let painted = 0;
    const shapes = svg.querySelectorAll(SHAPES);
    if (shapes.length > 60) return;
    for (const sh of shapes) {
      const cs = getComputedStyle(sh);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      for (const [paint, op] of [[cs.fill, cs.fillOpacity], [cs.stroke, cs.strokeOpacity]]) {
        if (!paint || paint === 'none') continue;
        if (/url\(/i.test(paint)) return;
        const c = core.parse(paint);
        if (!c) return;
        if (c[3] * (parseFloat(op) || 0) < 0.05) continue;
        // (a color, or a dark gray, which Chromium's dark mode turns: the SVG is left to it)
        const lab = core.toLab(c[0], c[1], c[2]);
        if (lab[0] < 0.8 || Math.hypot(lab[1], lab[2]) > 0.06) return;
        painted++;
      }
    }
    if (!painted || !lightBehind(svg)) return;
    svg.setAttribute(ATTR, 'svg');
    stats.svgs++;
  }
  // A picture that may be a preview of a document (Google's apps for documents only), 90x60 or bigger: an <img>,
  // or an element with nothing in it whose background picture covers it. Read here when it can be; looked at on the screen when it can't.
  function picOne(el, cs) {
    if (!google || !dark() || el.hasAttribute(ATTR) || picSeen.has(el)) return;
    const r = el.getBoundingClientRect();
    // (Classroom's attachments are about 120x80)
    if (r.width < 90 || r.height < 60 || r.width * r.height < 6000 || r.width / r.height > 2.1 || r.height / r.width > 2.1) return;
    if (el.localName === 'img') {
      if (!el.complete || !el.naturalWidth) { el.addEventListener('load', () => { if (mode) picOne(el); }, { once: true }); return; }
      const probe = probeOf();
      if (!probe) return;
      try {
        probe.drawImage(el, 0, 0, 40, 40);
        const d = probe.getImageData(0, 0, 40, 40).data;
        picSeen.set(el, 9);
        if (core.paperOf(d, r.width, r.height, false)) { el.setAttribute(ATTR, 'paper'); stats.pictures++; }
        return;
      } catch { /* from another site: on the screen */ }
    } else {
      cs = cs || getComputedStyle(el);
      const size = String(cs.backgroundSize);
      if (!/url\(/i.test(cs.backgroundImage) || !/^(cover|contain|100%( 100%)?)$/.test(size)) return;
    }
    if (!look) return;
    picSeen.set(el, 0);
    watch(el, 'pic');
  }
  // Pictures all in view, looked at on the screen together (a moment after: drawn by then), at most 12 at a time.
  let screenList = [], screenTimer = 0;
  function onScreen(el) {
    screenList.push(el);
    if (!screenTimer) screenTimer = setTimeout(screenNow, 250);
  }
  async function screenNow() {
    screenTimer = 0;
    const list = screenList.splice(0, 12);
    if (screenList.length) screenTimer = setTimeout(screenNow, 300);
    const els = [], rects = [];
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    for (const el of list) {
      if (!el.isConnected || el.hasAttribute(ATTR)) continue;
      const b = el.getBoundingClientRect();
      const p = shown.get(el) || { dx: 0, dy: 0, w: b.width, h: b.height };
      const r = { left: b.left + p.dx, top: b.top + p.dy, right: b.left + p.dx + p.w, bottom: b.top + p.dy + p.h };
      if (r.left < 0 || r.top < 0 || r.right > vw + 1 || r.bottom > vh + 1 || p.w < 40 || p.h < 30) { watch(el, 'pic'); continue; }
      els.push(el);
      rects.push({ x: r.left, y: r.top, w: p.w, h: p.h, bx: b.left, by: b.top });
    }
    if (!els.length || !mode) return;
    const out = await look({ rects: rects.map(({ x, y, w, h }) => ({ x, y, w, h })), vw: win.innerWidth });
    stats.looked += els.length;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const moved = Math.abs(r.left - rects[i].bx) > 2 || Math.abs(r.top - rects[i].by) > 2;
      const v = Array.isArray(out) ? out[i] : null;
      // (not seen: the window hidden, the page moved; looked at again, three times at most)
      if (v == null || moved) {
        const n = (picSeen.get(el) || 0) + 1;
        picSeen.set(el, n);
        if (n < 3) setTimeout(() => { if (mode && el.isConnected) watch(el, 'pic'); }, 2000);
        return;
      }
      picSeen.set(el, 9);
      if (v && mode && dark()) { el.setAttribute(ATTR, 'paper'); stats.pictures++; }
    });
  }
  function scan(root, masks = true, again = false) {
    if (!mode) return;
    const t0 = performance.now();
    try {
      const canvases = root.localName === 'canvas' ? [root] : root.querySelectorAll ? root.querySelectorAll('canvas') : [];
      for (const cv of canvases) { stats.canvases++; canvasOne(cv); }
      if (masks && dark() && root.querySelectorAll) {
        const els = root.matches && root.matches(MASKS) && blank(root) ? [root] : [];
        let k = 0;
        for (const el of root.querySelectorAll(MASKS)) { if (++k > 20000) break; if (blank(el)) els.push(el); }
        for (const el of els.slice(0, 4000)) {
          maskOne(el, again);
          if (google && el.localName === 'div' && !el.hasAttribute(ATTR)) picOne(el);
        }
      }
      if (dark() && root.querySelectorAll) {
        if (google) {
          const imgs = root.localName === 'img' ? [root] : root.querySelectorAll('img');
          for (let i = 0; i < imgs.length && i < 600; i++) picOne(imgs[i]);
        }
        if (mode.chromium) {
          const svgs = root.localName === 'svg' ? [root] : root.querySelectorAll('svg');
          for (let i = 0; i < svgs.length && i < 2000; i++) svgOne(svgs[i]);
        }
      }
    } catch { /* gone */ }
    stats.ms += performance.now() - t0;
  }
  function soon(node) {
    pending.push(node);
    if (!timer) timer = setTimeout(() => {
      timer = 0;
      const list = pending;
      pending = [];
      if (list.length > 200) scan(document); else for (const n of list) if (n.isConnected) scan(n);
    }, 250);
  }
  function unmark() {
    try { for (const el of document.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR); } catch { /* fine */ }
  }
  function arrange() {
    try {
      const cur = document.adoptedStyleSheets.filter((x) => x !== sheet);
      document.adoptedStyleSheets = mode ? [...cur, sheet] : cur;
    } catch { /* fine */ }
  }
  function set(m) {
    const was = mode;
    mode = m;
    if (!m) {
      if (mo) { mo.disconnect(); mo = null; }
      if (io) { io.disconnect(); io = null; }
      if (was) { unmark(); arrange(); }
      return;
    }
    if (!sheet) { sheet = new CSSStyleSheet({ media: 'screen' }); if (own) own.add(sheet); }
    try { sheet.replaceSync(css()); } catch { /* fine */ }
    // (other colors: what was marked is looked at again)
    if (was) unmark();
    const go = () => {
      if (!mode) return;
      arrange();
      // (in Catppuccin's colors, icons drawn as masks are looked at once the page's stylesheets are turned: a
      // mask's rule says its color is an icon's, and most need nothing more)
      scan(document, !!mode.chromium);
      if (!mo) {
        mo = new win.MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) soon(node);
        });
        try { mo.observe(document.documentElement || document, { childList: true, subtree: true }); } catch { /* fine */ }
      }
      // (a page laid out late, its icons' styles in late — Docs' toolbar — looked at again a few times; and in
      // Catppuccin's colors, the masks looked at again as they are without Bifrost's mark: the page's
      // stylesheets may have been turned since)
      for (const t of [1500, 4000, 10000]) setTimeout(() => { if (mode) scan(document); }, t);
      if (!mode.chromium) setTimeout(() => { if (mode && !mode.chromium) scan(document, true, true); }, 5000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
  }
  return { set, stats };
}

// One document's engine: the page's (win: its window), or, run from the page's, a frame's the page writes into
// itself (an <iframe> with no address: Chromium runs no page script of Bifrost's in those; rich text editors
// write their documents so). env.main: the page's own (it has your styles for the site last, and a page world).
function makeEngine(core, win, env) {
  const document = win.document;
  const location = win.location;
  const CSSStyleSheet = win.CSSStyleSheet;
  const MutationObserver = win.MutationObserver;
  const getComputedStyle = (el) => win.getComputedStyle(el);
  const requestAnimationFrame = (fn) => win.requestAnimationFrame(fn);
  const cancelAnimationFrame = (id) => win.cancelAnimationFrame(id);
  const siteSheet = () => (env.main ? globalThis.__bifrostSiteSheet : null);

  const S = {
    on: false, cfg: null, P: null, hooked: false, listening: false,
    roots: [],                    // WeakRefs to the roots Bifrost styles (the document, open shadow roots)
    scopes: new WeakMap(),        // root -> { root, doc, list (its stylesheets, in order), base, mo }
    sources: new WeakMap(),       // a page's stylesheet -> what Bifrost read of it, and its own for it
    live: new Set(),              // the sources in use now
    ours: new WeakSet(),          // Bifrost's own stylesheets (never read as the page's)
    codes: new Map(),             // '--name' -> Set of what it's used as ('b', 't', 'd', 's'; 'br': rgb numbers…)
    defSources: new Map(),        // '--name' -> Set of sources that set it
    dirty: new Set(),             // sources whose stylesheet is to be written again
    seen: new WeakMap(),          // element -> its style="" as last seen (after Bifrost's own changes)
    applied: new WeakMap(),       // element -> Map of the properties Bifrost set in its style=""
    attrRules: new Map(),         // 'bgcolor\u0001#f60' -> the rule for it ('' when it isn't a color)
    pendingLinks: new Set(),      // <link rel=stylesheet>s not loaded yet
    xo: new Map(),                // another site's stylesheet address -> { state, text, ir, waiters }
    xoPending: 0, raf: 0, cover: null, canvas: false, domReady: false, inlineAgain: false, reading: null,
    stats: { ms: 0, updates: 0, rules: 0, chars: 0 },   // (the time spent here, how many rules read, how much written: in this world only)
    icons: new Map(),             // a picture's address -> { data (it as an icon in text's colors, or null), users }
    iconGen: 0, iconOf: null, iconTimer: 0,
    imgRules: new Map(),          // an <img>'s src="" -> the rule giving it its picture in text's colors (null: asked)
    imgHref: new Map(),           // …and the picture it showed
    picSels: new Set(), picTimer: 0, picDone: new WeakSet(), picColors: new Map(),   // text over pictures (pictureText)
    fgTimer: 0, fgDone: new WeakSet(),   // what was looked at for reading on what's behind it (contrastPass)
    art: new WeakMap(),           // an <svg> -> whether it's art (a logo: its colors kept)
    kids: [],                     // WeakRefs to the <iframe>s whose documents this engine runs one for
    kidHeard: new WeakSet(),      // …and those it listens to (their load: another document)
  };
  const kidOf = new WeakMap();    // <iframe> -> { win, engine }

  // ---------------------------------------------------------------- reading a stylesheet
  const W = win;
  const isCustom = (p) => p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45;
  const OURS = /^--(bf[btds][rhwokcl]?-|bifrost-c-)/;
  const roleOf = (p) => core.ROLE.get(p) || (p === 'scrollbar-color' ? 'b' : null);

  // A rule's declarations that matter: its colors (and, with all, every declaration: keyframes are written whole),
  // and every variable it sets. [property, value, important]
  function declsOf(st, all) {
    let text = '';
    try { text = st.cssText; } catch { return []; }
    return text ? core.declarations(text, all) : [];
  }

  const RELEVANT = /color|background|border|outline|shadow|fill|stroke|decoration|emphasis|column-rule|--|scheme/i;
  const identOrString = (s) => (/^-?[_a-zA-Z][\w-]*$/.test(s) ? s : JSON.stringify(s));
  const group = (head, rules, base, depth) => {
    const kids = irOf(rules, base, 0, depth + 1);
    return kids.length ? { head, kids } : null;
  };

  // A stylesheet's rules (from the from'th) -> what Bifrost keeps of them: { sel, decls, kids } for a style rule,
  // { head, kids, base } for an @-rule around others (head '' for an @import's own), { decls } for declarations
  // nested after rules, { head, frames } for @keyframes.
  function irOf(rules, base, from = 0, depth = 0) {
    const out = [];
    if (depth > 30) return out;
    const n = rules.length;
    S.stats.rules += n - from;
    for (let i = from; i < n; i++) {
      let node = null;
      try { node = irRule(rules[i], base, depth); } catch { node = null; }
      if (node) out.push(node);
    }
    return out;
  }
  function irRule(r, base, depth) {
    switch (r.type) {
      case 1: {   // a style rule
        // (its text, in one call: "selector { declarations }", which is what nearly all are; one with rules
        // nested in it, or a quote in its selector, read the long way)
        let text = '';
        try { text = r.cssText; } catch { text = ''; }
        const open = text.indexOf('{');
        if (open > 0 && text.charCodeAt(text.length - 1) === 125) {
          const sel = text.slice(0, open);
          const body = text.slice(open + 1, -1);
          if (body.indexOf('{') < 0 && !/["'\\]/.test(sel)) {
            // (most of a framework's rules say nothing about colors: margins, flex, display…)
            if (!RELEVANT.test(body)) return null;
            const decls = core.declarations(body, false);
            return decls.length ? { sel: sel.trim(), decls, kids: null } : null;
          }
        }
        const decls = declsOf(r.style);
        const kids = r.cssRules && r.cssRules.length ? irOf(r.cssRules, base, 0, depth + 1) : null;
        return decls.length || (kids && kids.length) ? { sel: r.selectorText, decls, kids: kids && kids.length ? kids : null } : null;
      }
      case 3: return imported(r, base, depth);
      case 4: return group('@media ' + r.media.mediaText, r.cssRules, base, depth);
      case 7: return keyframes(r);
      case 12: return group('@supports ' + r.conditionText, r.cssRules, base, depth);
      case 0: break;
      default: return null;   // @font-face, @page, @namespace, @counter-style…
    }
    if (W.CSSLayerBlockRule && r instanceof W.CSSLayerBlockRule) return group('@layer' + (r.name ? ' ' + r.name : ''), r.cssRules, base, depth);
    if (W.CSSContainerRule && r instanceof W.CSSContainerRule) return group('@container ' + r.conditionText, r.cssRules, base, depth);
    if (W.CSSScopeRule && r instanceof W.CSSScopeRule) return group('@scope' + (r.start ? ' (' + r.start + ')' : '') + (r.end ? ' to (' + r.end + ')' : ''), r.cssRules, base, depth);
    if (W.CSSStartingStyleRule && r instanceof W.CSSStartingStyleRule) return group('@starting-style', r.cssRules, base, depth);
    if (r.style && r.selectorText === undefined) { const decls = declsOf(r.style); return decls.length ? { decls } : null; }
    return null;
  }
  function keyframes(r) {
    // (an animation that moves or fades something, which most are: nothing of it to say again)
    let text = '';
    try { text = r.cssText; } catch { return null; }
    if (!RELEVANT.test(text.slice(text.indexOf('{')))) return null;
    const frames = [];
    let colored = false;
    for (const k of r.cssRules) {
      const decls = declsOf(k.style, true);
      if (decls.some(([p]) => roleOf(p))) colored = true;
      frames.push({ key: k.keyText, decls });
    }
    return colored ? { head: '@keyframes ' + identOrString(r.name), frames } : null;
  }
  function imported(r, base, depth) {
    if (depth > 4) return null;
    const sh = r.styleSheet;
    if (!sh) return null;
    let rules = null;
    try { rules = sh.cssRules; } catch { rules = null; }
    const at = sh.href || base;
    let kids;
    if (rules) kids = irOf(rules, at, 0, depth + 1);
    else {
      const x = xoGet(at);
      if (x.state !== 'done') { if (S.reading) x.waiters.add(S.reading); return null; }
      kids = xoIr(x, at, depth);
    }
    if (!kids || !kids.length) return null;
    let node = { head: '', kids, base: at };
    if (r.layerName != null) node = { head: '@layer' + (r.layerName ? ' ' + r.layerName : ''), kids: [node] };
    if (r.supportsText) node = { head: '@supports (' + r.supportsText + ')', kids: [node] };
    const m = r.media && r.media.mediaText;
    if (m && m !== 'all') node = { head: '@media ' + m, kids: [node] };
    return node;
  }

  // ---------------------------------------------------------------- another site's stylesheets
  // A page can't read a stylesheet from another site (its rules are closed to scripts), so the main process
  // reads it for Bifrost (without your cookies, only CSS, and not from your own network for a site on the web:
  // main/web-styles.js). What it read before comes back at once; the rest, a moment later.
  function xoGet(url) {
    let x = S.xo.get(url);
    if (x) return x;
    x = { state: 'wait', text: '', ir: null, waiters: new Set() };
    S.xo.set(url, x);
    const text = env.cssNow(url);
    if (typeof text === 'string') { x.state = 'done'; x.text = text; return x; }
    S.xoPending++;
    env.css(url).then((t) => {
      S.xoPending--;
      x.state = typeof t === 'string' ? 'done' : 'fail';
      x.text = typeof t === 'string' ? t : '';
      for (const src of x.waiters) { src.ir = null; src.count = -1; }
      x.waiters.clear();
      if (S.on) update();
    }, () => { S.xoPending--; x.state = 'fail'; });
    return x;
  }
  // Its text read as a stylesheet of Bifrost's own (never adopted), its @imports first.
  function xoIr(x, url, depth = 0) {
    if (x.ir) return x.ir;
    const imports = [];
    const text = x.text.replace(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;{}]*);/gi, (m, q1, u1, q2, u2, cond) => { imports.push({ url: u1 || u2, cond: (cond || '').trim() }); return ''; });
    const nodes = [];
    let complete = true;
    for (const im of imports) {
      let abs;
      try { abs = new URL(im.url, url).href; } catch { continue; }
      if (depth > 3) continue;
      const y = xoGet(abs);
      if (y.state === 'wait') { complete = false; if (S.reading) y.waiters.add(S.reading); continue; }
      if (y.state !== 'done') continue;
      const kids = xoIr(y, abs, depth + 1);
      if (!kids.length) continue;
      let node = { head: '', kids, base: abs };
      const layer = /^layer(?:\(([^)]*)\))?\s*/i.exec(im.cond);
      let rest = im.cond;
      if (layer) { node = { head: '@layer' + (layer[1] ? ' ' + layer[1].trim() : ''), kids: [node] }; rest = rest.slice(layer[0].length); }
      const sup = /^supports\(((?:[^()]|\([^()]*\))*)\)\s*/i.exec(rest);
      if (sup) { node = { head: '@supports (' + sup[1] + ')', kids: [node] }; rest = rest.slice(sup[0].length); }
      if (rest.trim()) node = { head: '@media ' + rest.trim(), kids: [node] };
      nodes.push(node);
    }
    const sheet = new CSSStyleSheet();
    try { sheet.replaceSync(text); } catch { return nodes; }
    for (const n of irOf(sheet.cssRules, url)) nodes.push(n);
    if (complete) x.ir = nodes;
    return nodes;
  }

  // ---------------------------------------------------------------- the page's stylesheets
  function sourceOf(sheet) {
    let src = S.sources.get(sheet);
    if (!src) {
      let base = '';
      try { base = sheet.href || document.baseURI; } catch { base = location.href; }
      src = { sheet, base, ir: null, count: -1, first: null, last: null, chunk: null, text: '', defs: new Map(), added: null };
      S.sources.set(sheet, src);
    }
    return src;
  }

  // Reads it if it's new or changed since (rules added at its end, as CSS-in-JS adds them: only those). true
  // when there's something new.
  function read(src) {
    const sh = src.sheet;
    let rules = null;
    try { rules = sh.cssRules; } catch { rules = null; }
    S.reading = src;
    try {
      if (!rules) {
        if (src.ir) return false;
        const url = sh.href;
        if (!url) return false;
        const x = xoGet(url);
        if (x.state !== 'done') { if (x.state === 'wait') x.waiters.add(src); return false; }
        src.ir = xoIr(x, url).slice();
        src.added = null;
        return true;
      }
      const n = rules.length;
      if (src.ir && n === src.count && rules[0] === src.first && (n === 0 || rules[n - 1] === src.last)) return false;
      if (src.ir && src.count > 0 && n > src.count && rules[0] === src.first && rules[src.count - 1] === src.last) {
        src.added = irOf(rules, src.base, src.count);
        for (const node of src.added) src.ir.push(node);
      } else {
        src.ir = irOf(rules, src.base, 0);
        src.added = null;
      }
      src.count = n;
      src.first = n ? rules[0] : null;
      src.last = n ? rules[n - 1] : null;
      return true;
    } finally { S.reading = null; }
  }

  // ---------------------------------------------------------------- variables
  // A variable is used for something (a background: 'b'…; a background's rgb numbers: 'br'…): it gets a twin
  // for that, wherever it's set; and so do the variables its value uses, for what that makes them.
  function addCode(name, code) {
    let set = S.codes.get(name);
    if (!set) S.codes.set(name, (set = new Set()));
    if (set.has(code)) return;
    set.add(code);
    const ds = S.defSources.get(name);
    if (ds) for (const src of ds) { S.dirty.add(src); for (const v of src.defs.get(name) || []) follow(v, code); }
    S.inlineAgain = true;
  }
  function follow(value, code) {
    if (value.indexOf('var(') < 0) return;
    const uses = [];
    core.cached(S.P, 't', value, code, { uses });
    for (const [n, c] of uses) addCode(n, c);
  }
  // What a stylesheet's rules (all of them, or the ones just added) set and use.
  function analyze(src, nodes, all) {
    if (all) {
      for (const name of src.defs.keys()) { const ds = S.defSources.get(name); if (ds) ds.delete(src); }
      src.defs = new Map();
    }
    const visit = (list, base) => {
      for (const n of list) {
        const decls = n.decls;
        if (decls) {
          for (const d of decls) {
            const p = d[0], v = d[1];
            if (isCustom(p)) {
              let vs = src.defs.get(p);
              if (!vs) src.defs.set(p, (vs = []));
              vs.push(v);
              let ds = S.defSources.get(p);
              if (!ds) S.defSources.set(p, (ds = new Set()));
              ds.add(src);
              const codes = S.codes.get(p);
              if (codes) for (const c of codes) follow(v, c);
            } else if (v.indexOf('var(') >= 0) {
              const role = roleOf(p);
              if (!role) continue;
              const uses = [];
              core.cached(S.P, 'v', v, role, { uses, base });
              for (const [name, code] of uses) addCode(name, code);
            }
          }
        }
        // (a rule that puts a picture behind something: text over it may be the page's to color, pictureText)
        if (n.sel && decls && decls.some((d) => (d[0] === 'background' || d[0] === 'background-image') && /url\(/i.test(d[1]) && !/^\s*url\(\s*["']?data:image\/svg/i.test(d[1]))) S.picSels.add(n.sel);
        if (n.kids) visit(n.kids, n.base || base);
        if (n.frames) visit(n.frames, base);
      }
    };
    visit(nodes, src.base);
  }

  // ---------------------------------------------------------------- writing Bifrost's stylesheet for one
  function emitDecls(decls, base) {
    let s = '';
    const P = S.P;
    // (a gradient drawn on letters: background-clip: text — its colors are text's; and an icon drawn as a mask
    // over its background-color: that's its color, text's too)
    let letters = false, masked = false;
    for (const d of decls) { if (core.CLIP.has(d[0])) letters = true; else if (d[0] === '-bifrost-masked') masked = true; }
    for (const d of decls) {
      const p = d[0], v = d[1], bang = d[2] ? '!important' : '';
      if (core.CLIP.has(p) || p === '-bifrost-masked') continue;
      if ((letters || masked) && (p === 'background' || p === 'background-image' || p === 'background-color')) { s += p + ':' + core.cached(P, 'v', v, 't', { base }) + bang + ';'; continue; }
      if (p === 'background' || p === 'background-image') { s += p + ':' + core.cached(P, 'v', v, 'b', { base, icon: S.iconOf, iv: S.iconGen }) + bang + ';'; continue; }
      if (isCustom(p)) {
        const codes = S.codes.get(p);
        if (codes) for (const c of codes) s += core.twin(p, c) + ':' + core.cached(P, 't', v, c, { base }) + bang + ';';
        continue;
      }
      if (p === 'color-scheme') { s += 'color-scheme:' + (P.dark ? 'dark' : 'light') + bang + ';'; continue; }
      if (p === 'scrollbar-color') { s += p + ':' + core.scrollbar(P, v, { base }) + bang + ';'; continue; }
      s += p + ':' + core.cached(P, 'v', v, core.ROLE.get(p), { base }) + bang + ';';
    }
    return s;
  }
  function emitNodes(nodes, base) {
    let s = '';
    for (const n of nodes) {
      if (n.frames) {
        let body = '';
        for (const f of n.frames) {
          let b = '';
          for (const [p, v] of f.decls) { const role = roleOf(p); b += p + ':' + (role ? (p === 'scrollbar-color' ? core.scrollbar(S.P, v, { base }) : core.cached(S.P, 'v', v, role, { base })) : v) + ';'; }
          body += f.key + '{' + b + '}';
        }
        s += n.head + '{' + body + '}';
      } else if (n.sel !== undefined) {
        let body = emitDecls(n.decls, base);
        if (n.kids) body += emitNodes(n.kids, base);
        if (body) s += n.sel + '{' + body + '}';
      } else if (n.head !== undefined) {
        const inner = emitNodes(n.kids, n.base || base);
        if (inner) s += n.head ? n.head + '{' + inner + '}' : inner;
      } else if (n.decls) s += emitDecls(n.decls, base);
    }
    return s;
  }
  // Bifrost's stylesheets are for the screen only: a page prints in its own colors.
  function screenOnly(m) {
    m = String(m || '').trim();
    if (!m || /^all$/i.test(m)) return 'screen';
    const out = [];
    let depth = 0, start = 0;
    const qs = [];
    for (let i = 0; i <= m.length; i++) {
      const c = m[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if ((c === ',' && depth === 0) || i === m.length) { qs.push(m.slice(start, i).trim()); start = i + 1; }
    }
    for (const q of qs) {
      if (!q || /^(only\s+)?print\b/i.test(q) || /^not\s+screen\b/i.test(q)) continue;
      if (/^(only\s+)?all\b/i.test(q)) out.push(q.replace(/^(only\s+)?all\b/i, 'screen'));
      else if (/^(only\s+)?screen\b/i.test(q) || /^not\s/i.test(q)) out.push(q);
      else out.push('screen and ' + q);
    }
    return out.length ? out.join(', ') : 'not all';
  }
  function mediaOf(sheet) { try { return sheet.media ? sheet.media.mediaText : ''; } catch { return ''; } }
  function write(src) {
    const text = src.ir ? emitNodes(src.ir, src.base) : '';
    S.stats.chars += text.length;
    src.added = null;
    if (!text) { if (src.chunk) { try { src.chunk.replaceSync(''); } catch { /* gone */ } } src.text = ''; return; }
    if (text === src.text && src.chunk) return;
    if (!src.chunk) { src.chunk = new CSSStyleSheet({ media: screenOnly(mediaOf(src.sheet)) }); S.ours.add(src.chunk); }
    try { src.chunk.replaceSync(text); } catch { /* left as it was */ }
    src.text = text;
  }
  // Rules added at the end of one already written (CSS-in-JS): just those, added at the end of Bifrost's.
  function append(src) {
    const nodes = src.added;
    src.added = null;
    if (!src.chunk) { write(src); return; }
    for (const n of nodes) {
      const t = emitNodes([n], src.base);
      if (!t) continue;
      try { src.chunk.insertRule(t, src.chunk.cssRules.length); src.text += t; } catch { /* a rule this Chromium can't read back */ }
    }
  }

  // ---------------------------------------------------------------- roots: the document and shadow roots
  function scopeFor(root) {
    let sc = S.scopes.get(root);
    if (sc) return sc;
    const doc = root === document;
    sc = { root, doc, list: [], base: doc ? S.docBase : S.shadowBase, mo: null, styles: new WeakSet() };
    S.scopes.set(root, sc);
    S.roots.push(new WeakRef(root));
    const mo = new MutationObserver((records) => onMutations(sc, records));
    try { mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'bgcolor', 'color', 'fill', 'stroke', 'text', 'media', 'disabled', 'rel', 'href', 'src'] }); } catch { /* not a node */ }
    sc.mo = mo;
    watchIn(sc, root);
    return sc;
  }
  function eachScope(fn) {
    let dead = false;
    for (const ref of S.roots) {
      const root = ref.deref();
      if (!root) { dead = true; continue; }
      const sc = S.scopes.get(root);
      if (sc) fn(sc);
    }
    if (dead) S.roots = S.roots.filter((r) => r.deref());
  }
  function addShadow(root) {
    if (!root || S.scopes.has(root)) return;
    const sc = scopeFor(root);
    collect(sc);
    addedAll(root);
    flush();
  }

  // The stylesheets a root has now, in order: read the new and changed ones.
  function collect(sc) {
    const root = sc.root;
    const list = [];
    const site = sc.doc ? siteSheet() : null;
    try { for (const sh of root.styleSheets) list.push(sh); } catch { /* none */ }
    try { for (const sh of root.adoptedStyleSheets) if (!S.ours.has(sh) && sh !== site && !(env.own && env.own.has(sh))) list.push(sh); } catch { /* none */ }
    if (list.length !== sc.list.length || list.some((x, i) => x !== sc.list[i])) S.liveChanged = true;
    sc.list = list;
    for (const sh of list) {
      const src = sourceOf(sh);
      if (!S.live.has(src)) { S.live.add(src); S.liveChanged = true; }
      if (read(src)) {
        if (src.added) { analyze(src, src.added, false); if (!S.dirty.has(src)) append(src); }
        else { analyze(src, src.ir, true); S.dirty.add(src); }
      }
      if (src.chunk) {
        try { if (src.chunk.disabled !== sh.disabled) src.chunk.disabled = sh.disabled; } catch { /* fine */ }
        const m = screenOnly(mediaOf(sh));
        try { if (src.chunk.media.mediaText !== m) src.chunk.media.mediaText = m; } catch { /* fine */ }
      }
    }
  }
  // A root's (or a part of one just added) <style>s, watched for their text changing (which gives them a new
  // stylesheet), and its <link rel=stylesheet>s not loaded yet, waited for.
  function watchIn(sc, el) {
    try {
      const one = el.localName === 'style' || el.localName === 'link';
      const list = one ? [el] : el.querySelectorAll ? el.querySelectorAll('style, link') : [];
      for (const x of list) {
        if (x.localName === 'style') watchStyle(sc, x);
        else if (/(^|\s)stylesheet(\s|$)/i.test(x.rel || '') && !x.sheet && x.isConnected) trackLink(x);
      }
    } catch { /* gone */ }
  }
  function watchStyle(sc, st) {
    if (sc.styles.has(st)) return;
    sc.styles.add(st);
    try { sc.mo.observe(st, { childList: true, characterData: true, subtree: true }); } catch { /* fine */ }
  }
  function trackLink(l) {
    if (S.pendingLinks.has(l)) return;
    S.pendingLinks.add(l);
    const done = () => { S.pendingLinks.delete(l); if (S.on) update(); };
    l.addEventListener('load', done, { once: true });
    l.addEventListener('error', done, { once: true });
    kick();
  }

  // Everything written that's to be, and every root's stylesheets in order: the page's own, then Bifrost's
  // (the cover while the page loads, the base, one for each of the page's in its order), then your styles for
  // the site (tab.js's), last.
  function flush() {
    for (const src of S.dirty) write(src);
    S.dirty.clear();
    for (let k = 0; S.inlineAgain && k < 5; k++) { S.inlineAgain = false; reinline(false); for (const src of S.dirty) write(src); S.dirty.clear(); }
    eachScope(arrange);
  }
  function arrange(sc) {
    const root = sc.root;
    let cur;
    try { cur = root.adoptedStyleSheets; } catch { return; }
    const site = sc.doc ? siteSheet() : null;
    const want = [];
    for (const sh of cur) if (!S.ours.has(sh) && sh !== site) want.push(sh);
    if (sc.doc && S.cover) want.push(S.cover);
    want.push(sc.base);
    for (const sh of sc.list) { const src = S.sources.get(sh); if (src && src.chunk && src.text) want.push(src.chunk); }
    if (site && cur.includes(site)) want.push(site);
    if (want.length === cur.length && want.every((x, i) => x === cur[i])) return;
    try { root.adoptedStyleSheets = want; } catch { /* a document that's gone */ }
  }

  // The page's stylesheets read again where they changed: in one root (a <style> or <link> came or went there),
  // or in all (a script changed one: that could be anywhere).
  function update(only) {
    if (!S.on) return;
    const t0 = performance.now();
    if (only) collect(only); else eachScope(collect);
    if (S.liveChanged) prune();
    flush();
    S.stats.ms += performance.now() - t0;
    S.stats.updates++;
    if (env.main && S.picSels.size && !S.picTimer) S.picTimer = setTimeout(pictureText, 300);
    if (S.domReady) fgSoon(800);
  }
  // Stylesheets no longer in any root: forgotten (their variables too).
  function prune() {
    S.liveChanged = false;
    const now = new Set();
    eachScope((sc) => { for (const sh of sc.list) { const src = S.sources.get(sh); if (src) now.add(src); } });
    for (const src of S.live) {
      if (now.has(src)) continue;
      for (const name of src.defs.keys()) { const ds = S.defSources.get(name); if (ds) { ds.delete(src); if (!ds.size) S.defSources.delete(name); } }
    }
    S.live = now;
  }

  // ---------------------------------------------------------------- style="" and the old color attributes
  const INLINE = [
    ['background-color', 'bgc', 'b'], ['background-image', 'bgi', 'b'], ['color', 'c', 't'],
    ['border-top-color', 'btc', 'd'], ['border-right-color', 'brc', 'd'], ['border-bottom-color', 'bbc', 'd'], ['border-left-color', 'blc', 'd'],
    ['outline-color', 'oc', 'd'], ['box-shadow', 'bs', 's'], ['text-shadow', 'ts', 's'], ['fill', 'f', 't'], ['stroke', 's', 't'],
    ['text-decoration-color', 'tdc', 't'], ['-webkit-text-fill-color', 'wtf', 't'], ['caret-color', 'cc', 't'], ['column-rule-color', 'crc', 'd'],
    ['accent-color', 'ac', 't'], ['stop-color', 'sc', 't'],
    ['background', 'bg', 'b'], ['border', 'bd', 'd'], ['border-color', 'bdc', 'd'], ['border-top', 'bt', 'd'], ['border-right', 'br', 'd'],
    ['border-bottom', 'bb', 'd'], ['border-left', 'bl', 'd'], ['outline', 'ol', 'd'],
  ];
  const TOKEN = new Map(INLINE.map(([p, t, r]) => [p, { t, r }]));
  const COLORISH = /color|background|border|outline|shadow|fill|stroke|--/i;

  // An element's style="": its colors given again, as Bifrost's (each a variable on the element, used by a rule
  // in the base stylesheet for elements marked data-bifrost-c with it: that rule wins over style="", as a rule
  // of the page's own that's !important would; what's !important in style="" is left as it is). Variables it
  // sets get their twins there too.
  function inline(el) {
    if (!el || !el.getAttribute) return;
    const raw = el.getAttribute('style');
    if (S.seen.get(el) === raw) return;
    const st = el.style;
    const want = new Map();
    const tokens = [];
    if (raw && st && COLORISH.test(raw)) {
      const base = document.baseURI;
      let shorts = null;
      // (a gradient on letters: its background is its text's color)
      const letters = /clip/i.test(raw) && /text/i.test(st.getPropertyValue('background-clip') + ' ' + st.getPropertyValue('-webkit-background-clip'));
      const n = st.length;
      for (let i = 0; i < n; i++) {
        const p = st[i];
        if (isCustom(p)) {
          if (OURS.test(p)) continue;
          const codes = S.codes.get(p);
          if (codes) {
            const v = st.getPropertyValue(p);
            for (const c of codes) { const uses = []; want.set(core.twin(p, c), core.cached(S.P, 't', v, c, { uses, base })); for (const [nn, cc] of uses) addCode(nn, cc); }
          }
          continue;
        }
        let tok = TOKEN.get(p);
        if (!tok) continue;
        let prop = p;
        let v = st.getPropertyValue(p);
        if (!v) {
          const sh = core.SHORT.get(p);
          if (!sh) continue;
          let found = null;
          for (const s of sh) { const sv = st.getPropertyValue(s); if (sv) { found = s; v = sv; break; } }
          if (!found || !TOKEN.has(found) || (shorts && shorts.has(found))) continue;
          (shorts || (shorts = new Set())).add(found);
          prop = found;
          tok = TOKEN.get(found);
        }
        if (st.getPropertyPriority(prop) === 'important') continue;
        const uses = [];
        const role = letters && (prop === 'background-image' || prop === 'background-color') ? 't' : tok.r;
        const icon = role === 'b' && (prop === 'background' || prop === 'background-image') ? S.iconOf : null;
        want.set('--bifrost-c-' + tok.t, core.cached(S.P, 'v', v, role, { uses, base, icon, iv: S.iconGen }));
        for (const [nn, cc] of uses) addCode(nn, cc);
        tokens.push(tok.t);
      }
    }
    if (want.size && !tokens.length) tokens.push('v');
    const had = S.applied.get(el);
    if (had) for (const k of had.keys()) if (!want.has(k)) st.removeProperty(k);
    for (const [k, v] of want) if (st.getPropertyValue(k) !== v) st.setProperty(k, v);
    if (want.size) S.applied.set(el, want); else if (had) S.applied.delete(el);
    const t = tokens.join(' ');
    if (t) { if (el.getAttribute('data-bifrost-c') !== t) el.setAttribute('data-bifrost-c', t); } else if (el.hasAttribute('data-bifrost-c')) el.removeAttribute('data-bifrost-c');
    S.seen.set(el, el.getAttribute('style'));
  }

  // bgcolor="", <font color="">, <body text="">, SVG's fill="" and stroke="": a rule (of no weight: anything the
  // page says wins, as over the attribute) for each value that's on the page.
  const PRES = { bgcolor: ['background-color', 'b', ''], color: ['color', 't', 'font'], fill: ['fill', 't', ''], stroke: ['stroke', 't', ''], text: ['color', 't', 'body'] };
  const cssString = (v) => '"' + String(v).replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ') + '"';
  function presentational(el, attr) {
    const spec = PRES[attr];
    if (!spec || (spec[2] && el.localName !== spec[2])) return;
    const v = el.getAttribute(attr);
    if (!v || v.length > 60) return;
    const key = attr + '\u0001' + v.toLowerCase();
    if (S.attrRules.has(key)) return;
    let c = core.parse(v);
    if (!c && /^[0-9a-f]{6}$/i.test(v.trim())) c = core.parse('#' + v.trim());
    if (!c) { S.attrRules.set(key, ''); return; }
    // (a color, not a gray, in an SVG that's art — a logo — is kept: data-bifrost-art, artIn)
    const keep = (attr === 'fill' || attr === 'stroke') && core.isColor(c) ? ':not([data-bifrost-art] *)' : '';
    const rule = `:where(${spec[2]}[${attr}=${cssString(v)} i]${keep}){${spec[0]}:${core.format(core.mapColor(S.P, c, spec[1]))}}`;
    S.attrRules.set(key, rule);
    for (const b of [S.docBase, S.shadowBase]) { try { b.insertRule(rule, b.cssRules.length); } catch { /* fine */ } }
  }
  const PRES_SEL = '[style],[bgcolor],font[color],body[text],[fill],[stroke],iframe,img';
  const one = (e) => {
    if (e.hasAttribute('style')) inline(e);
    for (const a of ['bgcolor', 'color', 'fill', 'stroke', 'text']) if (e.hasAttribute(a)) presentational(e, a);
    if ((e.hasAttribute('fill') || e.hasAttribute('stroke')) && e.ownerSVGElement) artIn(e.ownerSVGElement);
    if (e.localName === 'iframe') frameIn(e);
    else if (e.localName === 'img') imgIcon(e);
  };

  // An inline SVG drawn in three colors or more (a logo, Google's microphone): art, its colors kept (its grays
  // turned all the same: a chart's labels).
  function artIn(svg) {
    if (S.art.has(svg)) return;
    const colors = [];
    try {
      for (const e of [svg, ...svg.querySelectorAll('[fill],[stroke],[stop-color]')]) {
        for (const a of ['fill', 'stroke', 'stop-color']) { const c = core.parse(e.getAttribute(a) || ''); if (c) colors.push(c); }
      }
    } catch { /* fine */ }
    const art = core.isArt(colors);
    S.art.set(svg, art);
    if (art && !svg.hasAttribute('data-bifrost-art')) svg.setAttribute('data-bifrost-art', '');
    // (an icon in one color with white drawn on it, as Drive's files are: the white is on the color, and goes to
    // base, which reads on Catppuccin's colors in every flavor; text's, light in Mocha, didn't on its pastels)
    if (!art && colors.some(core.isColor) && colors.some((c) => c[3] !== 0 && core.hueOf(c).L > 0.95 && core.hueOf(c).C < 0.02)) {
      if (!svg.hasAttribute('data-bifrost-duo')) svg.setAttribute('data-bifrost-duo', '');
    }
  }

  // ---------------------------------------------------------------- what's behind something: a picture?
  // An element's background picture is a backdrop (a banner's photo, a pattern: text over it is the page's to
  // color) when it covers half the element or more; an icon in a corner of it is not (SpeechDrop's file cards:
  // a page icon at the bottom right, the file's name over the card, not over the icon). A picture whose size is
  // its own is looked at once it's loaded (both passes again then); until then it may be (null).
  const natural = new Map();   // a picture's address -> [width, height] (null: loading)
  function backdrop(cs, r) {
    const img = cs.backgroundImage;
    const m = /url\(\s*(["']?)(.*?)\1\s*\)/i.exec(img);
    if (!m) return false;
    const size = String(cs.backgroundSize).split(',')[0].trim();
    if (/cover|contain/.test(size)) return true;
    if (!/no-repeat/.test(String(cs.backgroundRepeat).split(',')[0])) return true;
    const area = r.width * r.height;
    if (!area) return false;
    const dims = size.split(/\s+/);
    const len = (v, full) => (/%$/.test(v) ? full * parseFloat(v) / 100 : /px$/.test(v) ? parseFloat(v) : NaN);
    let w = len(dims[0], r.width), h = len(dims[1] || 'auto', r.height);
    if (isNaN(w) || isNaN(h)) {
      const nat = natural.get(m[2]);
      if (nat === undefined && natural.size < 500) {
        natural.set(m[2], null);
        const pic = new win.Image();
        pic.onload = () => {
          natural.set(m[2], [pic.naturalWidth, pic.naturalHeight]);
          if (!S.on) return;
          S.picDone = new WeakSet(); S.fgDone = new WeakSet();
          if (!S.picTimer) S.picTimer = setTimeout(pictureText, 100);
          fgSoon(150);
        };
        pic.onerror = () => natural.set(m[2], [-1, -1]);
        pic.src = m[2];
      }
      if (!nat) return null;
      if (nat[0] < 0) return false;
      // (a picture with no size of its own, an SVG without one: drawn over the whole element)
      if (!nat[0] || !nat[1]) return true;
      if (isNaN(w) && isNaN(h)) { w = nat[0]; h = nat[1]; } else if (isNaN(w)) w = h * nat[0] / nat[1]; else h = w * nat[1] / nat[0];
    }
    return w * h >= area * 0.5;
  }

  // ---------------------------------------------------------------- text over pictures
  // Text right over a picture (a course's banner, a photo behind a headline) keeps the page's own color: it
  // was chosen for that picture, which isn't turned (white letters on a dark banner went dark in Latte). Its
  // color is read with Bifrost's stylesheets out of the way for a moment (no frame is drawn in between), and
  // given back to it by a rule of Bifrost's (data-bifrost-pic). Only text with nothing of its own between it
  // and the picture: a list on a white card over a background photo (Gmail's themes) is the page's as turned.
  function pictureText() {
    S.picTimer = 0;
    if (!S.on) return;
    const want = [];
    for (const sel of S.picSels) {
      let els;
      try { els = document.querySelectorAll(sel); } catch { S.picSels.delete(sel); continue; }
      for (const el of els) {
        if (S.picDone.has(el)) continue;
        S.picDone.add(el);
        const cs = getComputedStyle(el);
        if (!/url\(/i.test(cs.backgroundImage)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 40 || backdrop(cs, r) !== true) continue;
        const walk = document.createTreeWalker(el, 4);
        const seen = new Set();
        for (let t = walk.nextNode(), k = 0; t && k < 300; t = walk.nextNode(), k++) {
          const p = t.parentElement;
          if (!p || seen.has(p) || !t.nodeValue.trim()) continue;
          seen.add(p);
          let open = true;
          for (let e = p; e && e !== el; e = e.parentElement) {
            const st = getComputedStyle(e);
            const c = core.parse(st.backgroundColor);
            if ((c && c[3] > 0.5) || st.backgroundImage !== 'none') { open = false; break; }
          }
          if (open) want.push(p);
        }
      }
    }
    if (!want.length) return;
    let cur;
    try { cur = document.adoptedStyleSheets; } catch { return; }
    const colors = [];
    try {
      document.adoptedStyleSheets = cur.filter((x) => !S.ours.has(x));
      for (const e of want) colors.push(getComputedStyle(e).color);
    } finally { try { document.adoptedStyleSheets = cur; } catch { /* fine */ } }
    let added = false;
    want.forEach((e, i) => {
      const c = core.parse(colors[i]);
      if (!c) return;
      const v = c.join(',');
      if (!S.picColors.has(v)) { S.picColors.set(v, `:where([data-bifrost-pic="${v}"]){color:${core.format(c)}!important}`); added = true; }
      if (e.getAttribute('data-bifrost-pic') !== v) e.setAttribute('data-bifrost-pic', v);
    });
    if (added) writeBases();
  }

  // ---------------------------------------------------------------- what still doesn't read
  // Text (and one-color SVG icons) that the turned colors left too close to what's behind them: white letters or
  // a glyph on a button whose color Catppuccin's makes lighter (Latte: white on its blue went dark on dark), a
  // color and a background from rules Bifrost couldn't connect, turned the same way. Each is given base's color
  // or text's, whichever reads on what's behind it (data-bifrost-fg). Looked at once the page is drawn, and for
  // what's added to it.
  const FG_MAX = 3000;
  function fgSoon(ms) { if (!S.fgTimer && S.on) S.fgTimer = setTimeout(contrastPass, ms); }
  function contrastPass() {
    S.fgTimer = 0;
    if (!S.on || !document.body) return;
    const t0 = performance.now();
    const P = S.P;
    const memo = new Map();
    // What's behind an element: the first background of its own or an ancestor's (a gradient's first color);
    // null for a picture that covers it (text over one is the page's: pictureText), not for an icon in a corner.
    const behind = (el) => {
      const path = [];
      let out = P.rgb.base;
      for (let e = el, k = 0; e && k < 60; e = e.parentElement || (e.parentNode && e.parentNode.host) || null, k++) {
        if (memo.has(e)) { out = memo.get(e); break; }
        path.push(e);
        const cs = getComputedStyle(e);
        const img = cs.backgroundImage;
        if (img && img !== 'none') {
          // (one not loaded yet, whose size is its own: as a picture, till it is)
          if (/url\(/i.test(img) && backdrop(cs, e.getBoundingClientRect()) !== false) { out = null; break; }
          const m = /(?:rgba?|hsla?)\([^)]*\)/i.exec(img);
          const g = m && core.parse(m[0]);
          if (g && g[3] >= 0.5) { out = g; break; }
        }
        const c = core.parse(cs.backgroundColor);
        if (c && c[3] >= 0.5) { out = c; break; }
      }
      for (const e of path) memo.set(e, out);
      return out;
    };
    // (the color that reads where this doesn't: 'base' or 'text'; null when it reads, or neither would better)
    const low = (fg, bg) => {
      const a = fg[3] == null ? 1 : fg[3];
      if (a < 0.5) return null;
      const seen = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
      const yb = core.lum(bg);
      const now = core.ratio(core.lum(seen), yb);
      if (now >= 2.4) return null;
      const rb = core.ratio(P.yBase, yb), rt = core.ratio(P.yText, yb);
      if (Math.max(rb, rt) < now + 1.5) return null;
      return rb > rt ? 'base' : 'text';
    };
    const fix = (el, fg, bg) => {
      const k = low(fg, bg);
      if (k && el.getAttribute('data-bifrost-fg') !== k) el.setAttribute('data-bifrost-fg', k);
    };
    let n = 0;
    const walk = document.createTreeWalker(document.body, 4);
    const done = S.fgDone;
    for (let t = walk.nextNode(); t && n < FG_MAX; t = walk.nextNode()) {
      const el = t.parentElement;
      if (!el || done.has(el) || !t.nodeValue.trim()) continue;
      done.add(el);
      n++;
      if (el.closest('[data-bifrost-pic],[data-bifrost-art]')) continue;
      const fg = core.parse(getComputedStyle(el).color);
      const bg = fg && behind(el);
      if (bg) fix(el, fg, bg);
    }
    const svgs = [];
    for (const svg of document.querySelectorAll('svg')) {
      if (n >= FG_MAX || svgs.length >= 400) break;
      if (done.has(svg) || svg.hasAttribute('data-bifrost-art')) continue;
      done.add(svg);
      n++;
      // (an icon drawn in one color: every shape the same fill)
      let fill = '';
      let one = true;
      for (const e of svg.querySelectorAll('path,circle,rect,polygon,ellipse')) {
        const f = getComputedStyle(e).fill;
        if (!f || f === 'none') continue;
        if (fill && f !== fill) { one = false; break; }
        fill = f;
      }
      if (!one || !fill) continue;
      const fg = core.parse(fill);
      const bg = fg && behind(svg.parentElement || svg);
      if (bg) svgs.push([svg, fg, bg]);
    }
    // How each looked on the page as it was (read with Bifrost's stylesheets out of the way for a moment, as
    // pictureText does): one that blended into what's behind it is a piece of the page drawn in SVG, not an icon
    // (Classroom's rounded corner, in its page's white over a white card; turned as an icon's, it went light on
    // Mocha's base): it's given what's behind it now, to blend in still (data-bifrost-blend). One that read and
    // doesn't now gets base's color or text's (data-bifrost-fg).
    if (svgs.length) {
      let cur = null;
      const was = [];
      try {
        cur = document.adoptedStyleSheets;
        document.adoptedStyleSheets = cur.filter((x) => !S.ours.has(x));
        for (const [svg] of svgs) {
          const shape = svg.querySelector('path,circle,rect,polygon,ellipse');
          const fg = shape && core.parse(getComputedStyle(shape).fill);
          let bg = [255, 255, 255, 1];
          for (let e = svg.parentElement, k = 0; e && k < 60; e = e.parentElement, k++) {
            const c = core.parse(getComputedStyle(e).backgroundColor);
            if (c && c[3] >= 0.5) { bg = c; break; }
          }
          was.push(fg && fg[3] >= 0.5 ? core.ratio(core.lum(fg), core.lum(bg)) : null);
        }
      } catch { /* fine */ } finally { if (cur) try { document.adoptedStyleSheets = cur; } catch { /* fine */ } }
      let added = false;
      svgs.forEach(([svg, fg, bg], i) => {
        const r = was[i];
        if (r == null) return;
        if (r < 1.25) {
          if (core.ratio(core.lum(fg), core.lum(bg)) < 1.25) return;
          const v = [bg[0], bg[1], bg[2]].map(Math.round).join(',');
          const key = 'blend\u0001' + v;
          if (!S.picColors.has(key)) { S.picColors.set(key, `:where(svg[data-bifrost-blend="${v}"] :is(path,circle,rect,polygon,ellipse,use)){fill:rgb(${v})!important}`); added = true; }
          if (svg.getAttribute('data-bifrost-blend') !== v) svg.setAttribute('data-bifrost-blend', v);
          return;
        }
        const k = r >= 1.6 && low(fg, bg);
        if (k && svg.getAttribute('data-bifrost-fg') !== k) svg.setAttribute('data-bifrost-fg', k);
      });
      if (added) writeBases();
    }
    S.stats.ms += performance.now() - t0;
  }

  // ---------------------------------------------------------------- icons that are pictures
  // A picture (a background's, an <img>'s) that's an icon drawn in one gray on nothing (a black glyph, as Google
  // draws most of theirs) doesn't show on Catppuccin's dark base: the main process reads it (without your
  // cookies) and, if it's that, gives it back in text's colors (web-styles.js iconFetch). Until then, and for
  // anything else (a photo, a logo), it's as it is.
  const ICONS_MAX = 600;
  function iconOf(href) {
    if (!href || href.length > 200000 || !/^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i.test(href)) return null;
    let e = S.icons.get(href);
    if (e) return e.data;
    if (S.icons.size >= ICONS_MAX || !env.icon) return null;
    e = { data: null };
    S.icons.set(href, e);
    env.icon(href, S.cfg && S.cfg.key).then((data) => {
      if (!data || !S.on) return;
      e.data = data;
      S.iconGen++;
      // (all the icons that come in together: the page's stylesheets written once again for them)
      if (!S.iconTimer) S.iconTimer = setTimeout(() => {
        S.iconTimer = 0;
        if (!S.on) return;
        eachScope((sc) => {
          for (const sh of sc.list) { const src = S.sources.get(sh); if (src && src.text && src.text.indexOf('url(') >= 0) S.dirty.add(src); }
          try { for (const el of sc.root.querySelectorAll('[style*="url("]')) { S.seen.delete(el); inline(el); } } catch { /* none */ }
        });
        for (const [src, rule] of [...S.imgRules]) if (rule === null) imgRule(src);
        flush();
      }, 120);
    }, () => {});
    return null;
  }
  S.iconOf = iconOf;
  const IMG_MAX = 600;   // (bigger than this either way: a picture, not an icon)
  function imgIcon(img) {
    const src = img.getAttribute('src');
    if (!src || S.imgRules.has(src)) return;
    const look = () => {
      if (S.imgRules.has(src) || img.getAttribute('src') !== src) return;
      if (!img.naturalWidth || img.naturalWidth > IMG_MAX || img.naturalHeight > IMG_MAX) return;
      S.imgRules.set(src, null);
      S.imgHref.set(src, img.currentSrc || img.src);
      imgRule(src);
    };
    if (img.complete) look(); else img.addEventListener('load', look, { once: true });
  }
  // (its rule, once the main process has the icon: given by the address in src="", whatever srcset picked)
  function imgRule(src) {
    const data = iconOf(S.imgHref.get(src));
    if (!data) return;
    const rule = `:where(img[src=${cssString(src)}]){content:url(${cssString(data)})}`;
    S.imgRules.set(src, rule);
    for (const b of [S.docBase, S.shadowBase]) { try { b.insertRule(rule, b.cssRules.length); } catch { /* fine */ } }
  }
  function added(el) {
    one(el);
    if (el.firstElementChild) { try { for (const e of el.querySelectorAll(PRES_SEL)) one(e); } catch { /* fine */ } }
    if (el.shadowRoot) addShadow(el.shadowRoot);
  }
  function addedAll(root) {
    try { for (const e of root.querySelectorAll(PRES_SEL)) added(e); } catch { /* none */ }
  }

  // A frame this page writes into itself (an <iframe> with no address, or about:blank: Bifrost's page script
  // doesn't run in those): an engine for its document from here, in the same colors (and another for the next
  // document it gets; none once it has an address of its own, whose page has Bifrost's script itself).
  function frameIn(f, again = false) {
    const src = (f.getAttribute('src') || '').trim();
    const ours = S.on && !f.hasAttribute('srcdoc') && (!src || /^about:blank$/i.test(src) || /^javascript:/i.test(src));
    let w = null;
    if (ours) { try { w = f.contentWindow; if (!w || !w.document) w = null; } catch { w = null; } }
    // (its load: what the page wrote into it is all there, in a document document.open() started over, which
    // drops what listened to it: an engine anew)
    if (!S.kidHeard.has(f)) { S.kidHeard.add(f); f.addEventListener('load', () => { if (S.on) frameIn(f, true); }); }
    const had = kidOf.get(f);
    if (had && had.win === w && !again) { had.engine.setConfig(S.cfg); return; }
    if (had) { try { had.engine.setConfig(null); } catch { /* its document went */ } kidOf.delete(f); }
    if (!w) return;
    let engine;
    try { engine = makeEngine(core, w, { main: false, cssNow: env.cssNow, css: env.css, icon: env.icon, pageWorld: null }); } catch { return; }
    kidOf.set(f, { win: w, engine });
    S.kids.push(new WeakRef(f));
    try { engine.setConfig(S.cfg); } catch { /* its document went */ }
  }
  function eachKid(fn) {
    S.kids = S.kids.filter((r) => { const f = r.deref(); const k = f && kidOf.get(f); if (k) { try { fn(k, f); } catch { /* gone */ } } return !!k; });
  }
  // Every style="" with a variable in it again (a variable turned out to be used for a color), or every one.
  function reinline(all) {
    eachScope((sc) => { try { for (const e of sc.root.querySelectorAll(all ? '[style]' : '[style*="--"]')) { S.seen.delete(e); inline(e); } } catch { /* none */ } });
  }

  function onMutations(sc, records) {
    if (!S.on) return;
    let sheets = false;
    for (const r of records) {
      const t = r.target;
      if (r.type === 'attributes') {
        const a = r.attributeName;
        if (a === 'style') inline(t);
        else if (a === 'src') { if (t.localName === 'img') imgIcon(t); }
        else if (a === 'media' || a === 'disabled' || a === 'rel' || a === 'href') { if (t.localName === 'link' || t.localName === 'style') sheets = true; }
        else presentational(t, a);
        continue;
      }
      if (r.type === 'characterData' || (t && t.localName === 'style')) { sheets = true; continue; }
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const ln = node.localName;
        if (ln === 'style' || ln === 'link' || (node.firstElementChild && node.querySelector('style,link'))) { sheets = true; watchIn(sc, node); }
        added(node);
      }
      if (!sheets) for (const node of r.removedNodes) if (node.localName === 'style' || node.localName === 'link') { sheets = true; break; }
    }
    if (sheets) update(sc); else flush();
    if (S.domReady) fgSoon(1200);
  }

  // ---------------------------------------------------------------- the base: what's under it all
  const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const fade = (hex, a) => core.format([...rgbOf(hex), a]);
  function baseText(doc) {
    const P = S.P, c = (k) => P.palette[k];
    let s = '';
    if (doc) {
      s += `:where(:root){color-scheme:${P.dark ? 'dark' : 'light'};accent-color:${c('mauve')}}`;
      s += `:where(html){color:${c('text')}${S.canvas ? ';background-color:' + c('base') : ''}}`;
      s += `:where(a:any-link){color:${c('blue')}}`;
      s += `:where(mark){background-color:${fade(c('yellow'), P.dark ? 0.3 : 0.35)};color:${c('text')}}`;
      // (a frame's own border is drawn in the text's color: light, now)
      s += `:where(iframe){border-color:${c('surface1')}}`;
    }
    s += `::selection{background-color:${fade(c('mauve'), P.dark ? 0.32 : 0.25)};color:${c('text')}}`;
    for (const [p, t] of INLINE) s += `:where([data-bifrost-c~="${t}"]){${p}:var(--bifrost-c-${t})!important}`;
    for (const r of S.attrRules.values()) if (r) s += r;
    for (const r of S.imgRules.values()) if (r) s += r;
    if (doc) for (const r of S.picColors.values()) s += r;
    // (white on an icon's one color: base; and what still didn't read, contrastPass)
    s += `:where([data-bifrost-duo]) :is([fill="#fff" i],[fill="#ffffff" i],[fill="white" i],[fill="#fafafa" i],[fill="#fefefe" i]){fill:${c('base')}}`;
    for (const k of ['base', 'text']) s += `:where([data-bifrost-fg="${k}"]){color:${c(k)}!important}:where(svg[data-bifrost-fg="${k}"] :is(path,circle,rect,polygon,ellipse,use,text):not([fill="none" i])){fill:${c(k)}!important}`;
    return s;
  }
  function writeBases() {
    try { S.docBase.replaceSync(baseText(true)); } catch { /* fine */ }
    try { S.shadowBase.replaceSync(baseText(false)); } catch { /* fine */ }
  }

  // ---------------------------------------------------------------- while the page loads
  // Until its stylesheets have been turned (those it has by the time its document is read), the page's
  // background is Catppuccin's: no white flash. Stylesheets that load are turned in the frame they arrive in
  // (before it's drawn), from the browser's own animation frame.
  function kick() { if (!S.raf && S.on && (S.pendingLinks.size || S.cover)) S.raf = requestAnimationFrame(tick); }
  function tick() {
    S.raf = 0;
    if (!S.on) return;
    let changed = false;
    for (const l of S.pendingLinks) if (l.sheet || !l.isConnected) { S.pendingLinks.delete(l); changed = true; }
    if (changed) update();
    if (S.cover && S.domReady && !S.pendingLinks.size && !S.xoPending) uncover();
    kick();
  }
  function uncover() {
    if (!S.cover) return;
    S.cover = null;
    const sc = S.scopes.get(document);
    if (sc) arrange(sc);
    // A page that has no background of its own (the browser's white): Catppuccin's base under it.
    try {
      const none = (el) => { if (!el) return true; const cs = getComputedStyle(el); return cs.backgroundImage === 'none' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor); };
      if (none(document.documentElement) && none(document.body)) { S.canvas = true; writeBases(); }
    } catch { /* not laid out */ }
  }

  // ---------------------------------------------------------------- the page's own world
  // Styles a page's scripts add as it runs (insertRule and the like: CSS-in-JS), stylesheets it adopts, and
  // shadow roots it opens are told to this world (an event on the document, once per turn of the page's
  // script; a shadow root's, on its host) so they're turned before they're drawn.
  function hooks() {
    if (S.hooked || !env.pageWorld) return;
    S.hooked = true;
    try {
      env.pageWorld(() => {
          let queued = false;
          const ping = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; try { document.dispatchEvent(new Event('bifrost-recolor-css')); } catch { /* gone */ } }); };
          const wrap = (proto, name) => {
            const d = proto && Object.getOwnPropertyDescriptor(proto, name);
            if (!d || typeof d.value !== 'function') return;
            const f = d.value;
            const w = { [name](...a) { const r = Reflect.apply(f, this, a); ping(); return r; } }[name];
            try { Object.defineProperty(proto, name, { ...d, value: w }); } catch { /* sealed */ }
          };
          for (const n of ['insertRule', 'deleteRule', 'addRule', 'removeRule', 'replaceSync']) wrap(CSSStyleSheet.prototype, n);
          if (window.CSSGroupingRule) { wrap(CSSGroupingRule.prototype, 'insertRule'); wrap(CSSGroupingRule.prototype, 'deleteRule'); }
          const rd = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'replace');
          if (rd && typeof rd.value === 'function') {
            const f = rd.value;
            try { Object.defineProperty(CSSStyleSheet.prototype, 'replace', { ...rd, value: { replace(...a) { const p = Reflect.apply(f, this, a); Promise.resolve(p).then(ping, () => {}); return p; } }.replace }); } catch { /* sealed */ }
          }
          for (const proto of [Document.prototype, window.ShadowRoot && ShadowRoot.prototype]) {
            const d = proto && Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
            if (d && d.set) { const set = d.set; try { Object.defineProperty(proto, 'adoptedStyleSheets', { ...d, set(v) { set.call(this, v); ping(); } }); } catch { /* sealed */ } }
          }
          const as = Element.prototype.attachShadow;
          if (typeof as === 'function') {
            const w = { attachShadow(...a) {
              const r = Reflect.apply(as, this, a);
              const host = this;
              if (r && a[0] && a[0].mode === 'open') queueMicrotask(() => { try { host.dispatchEvent(new Event('bifrost-recolor-shadow', { bubbles: true, composed: true })); } catch { /* gone */ } });
              return r;
            } }.attachShadow;
            try { Object.defineProperty(Element.prototype, 'attachShadow', { value: w, writable: true, configurable: true }); } catch { /* sealed */ }
          }
      });
    } catch { /* no page world */ }
  }
  function listen() {
    if (S.listening) return;
    S.listening = true;
    document.addEventListener('bifrost-recolor-css', () => { if (S.on) update(); }, true);
    document.addEventListener('bifrost-recolor-shadow', (e) => {
      if (!S.on) return;
      const host = e.composedPath()[0];
      if (host && host.shadowRoot) addShadow(host.shadowRoot);
    }, true);
    document.addEventListener('load', (e) => { const t = e.target; if (S.on && t && t.localName === 'link') { S.pendingLinks.delete(t); update(); } }, true);
    const ready = () => {
      S.domReady = true;
      if (!S.on) return;
      update();
      // (web components with shadow roots written into the page itself)
      findShadows();
      kick();
      setTimeout(() => { if (S.on && S.cover) uncover(); }, 2500);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
    win.addEventListener('load', () => { if (S.on) { update(); if (S.cover) uncover(); } }, { once: true });
    // (and now and then, for what nothing says changed: a stylesheet's address changed, an item pushed onto
    // adoptedStyleSheets)
    let n = 0;
    const poll = () => {
      if (!S.on && !env.main) return;   // (a frame's engine, done with: there's a new one, or none)
      if (S.on && document.visibilityState === 'visible') update();
      setTimeout(poll, ++n < 15 ? 2000 : 10000);
    };
    setTimeout(poll, 2000);
  }

  // ---------------------------------------------------------------- on, off, other colors
  function start(cfg) {
    S.on = true;
    S.cfg = cfg;
    S.P = core.prepare(cfg.palette);
    S.docBase = new CSSStyleSheet({ media: 'screen' });
    S.shadowBase = new CSSStyleSheet({ media: 'screen' });
    S.ours.add(S.docBase);
    S.ours.add(S.shadowBase);
    writeBases();
    if (document.readyState !== 'loading') S.domReady = true;
    if (!S.domReady) {
      S.cover = new CSSStyleSheet({ media: 'screen' });
      try { S.cover.replaceSync(`html{background-color:${cfg.palette.base}!important;color:${cfg.palette.text}}`); } catch { /* fine */ }
      S.ours.add(S.cover);
    }
    const sc = scopeFor(document);
    arrange(sc);
    hooks();
    if (document.documentElement) addedAll(document);
    update();
    // (turned on in a page that's there already: its web components' shadow roots)
    if (S.domReady) findShadows();
    listen();
    kick();
  }
  function findShadows() {
    try { for (const e of document.querySelectorAll('*')) if (e.shadowRoot) addShadow(e.shadowRoot); } catch { /* fine */ }
  }
  function stop() {
    S.on = false;
    eachKid((k, f) => { k.engine.setConfig(null); kidOf.delete(f); });
    S.kids = [];
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    eachScope((sc) => {
      try { sc.mo.disconnect(); } catch { /* fine */ }
      try { sc.root.adoptedStyleSheets = sc.root.adoptedStyleSheets.filter((x) => !S.ours.has(x)); } catch { /* fine */ }
      try {
        for (const e of sc.root.querySelectorAll('[data-bifrost-c]')) {
          const had = S.applied.get(e);
          if (had) for (const k of had.keys()) e.style.removeProperty(k);
          e.removeAttribute('data-bifrost-c');
        }
      } catch { /* fine */ }
    });
    Object.assign(S, {
      cfg: null, P: null, roots: [], scopes: new WeakMap(), sources: new WeakMap(), live: new Set(), codes: new Map(), defSources: new Map(),
      dirty: new Set(), seen: new WeakMap(), applied: new WeakMap(), attrRules: new Map(), pendingLinks: new Set(), cover: null, canvas: false,
      icons: new Map(), imgRules: new Map(), imgHref: new Map(), art: new WeakMap(),
      picSels: new Set(), picDone: new WeakSet(), picColors: new Map(), fgDone: new WeakSet(),
    });
    if (S.fgTimer) { clearTimeout(S.fgTimer); S.fgTimer = 0; }
    try { for (const e of document.querySelectorAll('[data-bifrost-fg],[data-bifrost-duo],[data-bifrost-art],[data-bifrost-blend]')) { e.removeAttribute('data-bifrost-fg'); e.removeAttribute('data-bifrost-duo'); e.removeAttribute('data-bifrost-art'); e.removeAttribute('data-bifrost-blend'); } } catch { /* fine */ }
    if (S.picTimer) { clearTimeout(S.picTimer); S.picTimer = 0; }
    try { for (const e of document.querySelectorAll('[data-bifrost-pic]')) e.removeAttribute('data-bifrost-pic'); } catch { /* fine */ }
  }
  function setConfig(cfg) {
    if (!cfg || !cfg.palette) { if (S.on) stop(); return; }
    if (!S.on) { start(cfg); return; }
    if (S.cfg && S.cfg.key === cfg.key) return;
    S.cfg = cfg;
    S.P = core.prepare(cfg.palette);
    S.attrRules.clear();
    // (icons are made for a palette: asked for again; and what reads on what is looked at again)
    S.icons = new Map();
    S.imgRules = new Map();
    S.fgDone = new WeakSet();
    try { for (const e of document.querySelectorAll('[data-bifrost-fg],[data-bifrost-blend]')) { e.removeAttribute('data-bifrost-fg'); e.removeAttribute('data-bifrost-blend'); } } catch { /* fine */ }
    for (const k of [...S.picColors.keys()]) if (k.startsWith('blend\u0001')) S.picColors.delete(k);
    fgSoon(800);
    S.seen = new WeakMap();
    eachScope((sc) => { for (const sh of sc.list) { const src = S.sources.get(sh); if (src) S.dirty.add(src); } });
    writeBases();
    eachScope((sc) => { try { for (const e of sc.root.querySelectorAll(PRES_SEL)) added(e); } catch { /* none */ } });
    flush();
    eachKid((k) => k.engine.setConfig(cfg));
  }

  return {
    setConfig, stats: S.stats, on: () => S.on,
    arrange: () => { if (S.on) { const sc = S.scopes.get(document); if (sc) arrange(sc); } },
  };
}
