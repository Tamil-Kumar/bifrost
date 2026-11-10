/* Bifrost — Catppuccin's userstyles in Bifrost's theme (Settings → Website styles → Match your theme).
   Catppuccin's styles (https://github.com/catppuccin/userstyles) all build from one library: @catppuccin, a map of
   four flavors (latte, frappé, macchiato, mocha) of 26 colors, and @catppuccin-filters, the CSS filter that turns
   black into each of those colors (for icons and images). A style in Bifrost's theme is built with its flavor
   options set to one flavor and, when the theme isn't one of Catppuccin's (or has its own accent), that flavor's
   colors in the library swapped for the theme's, with filters worked out for them here.

   Shared by the LESS worker (main/less-worker.js) and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBCatppuccin = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLORS = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender',
    'text', 'subtext1', 'subtext0', 'overlay2', 'overlay1', 'overlay0', 'surface2', 'surface1', 'surface0', 'base', 'mantle', 'crust'];
  const FLAVORS = ['latte', 'frappe', 'macchiato', 'mocha'];

  const rgbOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hexOf = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return x && y ? hexOf(x.map((v, i) => v + (y[i] - v) * t)) : a; };

  // Bifrost's theme (src/shared/themes.js: base…crust, s0–s2, overlay, subtext, text, accent and its colors)
  // as Catppuccin's 26: the accent is mauve (Catppuccin's styles' default accent), the in-betweens Catppuccin has
  // and Bifrost's themes don't are mixed from their neighbours.
  function paletteFromTheme(t) {
    return {
      rosewater: mix(t.pink, t.text, 0.55), flamingo: mix(t.pink, t.red, 0.35), pink: t.pink, mauve: t.accent,
      red: t.red, maroon: mix(t.red, t.peach, 0.35), peach: t.peach, yellow: t.yellow, green: t.green, teal: t.teal,
      sky: mix(t.teal, t.blue, 0.45), sapphire: mix(t.blue, t.teal, 0.3), blue: t.blue, lavender: t.lavender,
      text: t.text, subtext1: mix(t.subtext, t.text, 0.5), subtext0: t.subtext,
      overlay2: mix(t.overlay, t.subtext, 0.66), overlay1: mix(t.overlay, t.subtext, 0.33), overlay0: t.overlay,
      surface2: t.s2, surface1: t.s1, surface0: t.s0, base: t.base, mantle: t.mantle, crust: t.crust,
    };
  }

  // What a style is built with in a theme: { flavor, palette } — palette null when Catppuccin's own flavor is it.
  function themeBuild(t) {
    const flavor = FLAVORS.includes(t.key) ? t.key : (t.dark ? 'mocha' : 'latte');
    if (FLAVORS.includes(t.key) && !t.customAccent) return { flavor, palette: null };
    const palette = paletteFromTheme(t);
    if (FLAVORS.includes(t.key)) {
      // Catppuccin's flavor with an accent of your own: only mauve changes.
      return { flavor, palette: { mauve: palette.mauve } };
    }
    return { flavor, palette };
  }

  // ---- CSS filters that turn black into a color (brightness(0) saturate(100%), then these six), found by
  // stochastic gradient descent on how far the result is from the color, as the "hex to CSS filter" solvers do.
  // Seeded by the color, so a color always gets the same filter.
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, v));

  function applyFilters(f) {
    let r = 0, g = 0, b = 0;
    const multiply = (m) => {
      const nr = clamp255(r * m[0] + g * m[1] + b * m[2]);
      const ng = clamp255(r * m[3] + g * m[4] + b * m[5]);
      const nb = clamp255(r * m[6] + g * m[7] + b * m[8]);
      r = nr; g = ng; b = nb;
    };
    const linear = (slope, intercept) => { r = clamp255(r * slope + intercept * 255); g = clamp255(g * slope + intercept * 255); b = clamp255(b * slope + intercept * 255); };
    // invert
    const iv = f[0] / 100;
    r = clamp255((iv + (r / 255) * (1 - 2 * iv)) * 255); g = clamp255((iv + (g / 255) * (1 - 2 * iv)) * 255); b = clamp255((iv + (b / 255) * (1 - 2 * iv)) * 255);
    // sepia
    const sp = f[1] / 100;
    multiply([0.393 + 0.607 * (1 - sp), 0.769 - 0.769 * (1 - sp), 0.189 - 0.189 * (1 - sp),
      0.349 - 0.349 * (1 - sp), 0.686 + 0.314 * (1 - sp), 0.168 - 0.168 * (1 - sp),
      0.272 - 0.272 * (1 - sp), 0.534 - 0.534 * (1 - sp), 0.131 + 0.869 * (1 - sp)]);
    // saturate
    const st = f[2] / 100;
    multiply([0.213 + 0.787 * st, 0.715 - 0.715 * st, 0.072 - 0.072 * st,
      0.213 - 0.213 * st, 0.715 + 0.285 * st, 0.072 - 0.072 * st,
      0.213 - 0.213 * st, 0.715 - 0.715 * st, 0.072 + 0.928 * st]);
    // hue-rotate
    const a = (f[3] * 3.6) / 180 * Math.PI;
    const sin = Math.sin(a), cos = Math.cos(a);
    multiply([0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072]);
    // brightness, contrast
    linear(f[4] / 100, 0);
    linear(f[5] / 100, -(0.5 * f[5] / 100) + 0.5);
    return [r, g, b];
  }

  function hsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 100, s * 100, l * 100];
  }

  function loss(f, target, targetHsl) {
    const c = applyFilters(f);
    const h = hsl(c);
    return Math.abs(c[0] - target[0]) + Math.abs(c[1] - target[1]) + Math.abs(c[2] - target[2])
      + Math.abs(h[0] - targetHsl[0]) + Math.abs(h[1] - targetHsl[1]) + Math.abs(h[2] - targetHsl[2]);
  }

  function spsa(target, targetHsl, rand, A, a, c, values, iters) {
    const fix = (v, i) => {
      const max = i === 2 ? 7500 : (i === 4 || i === 5) ? 200 : 100;
      if (i === 3) { if (v > max) v %= max; else if (v < 0) v = max + (v % max); }
      else v = Math.max(0, Math.min(max, v));
      return v;
    };
    let best = values.slice();
    let bestLoss = loss(values, target, targetHsl);
    const hi = new Array(6), lo = new Array(6), d = new Array(6);
    for (let k = 0; k < iters; k++) {
      const ck = c / Math.pow(k + 1, 1 / 6);
      for (let i = 0; i < 6; i++) { d[i] = rand() > 0.5 ? 1 : -1; hi[i] = values[i] + ck * d[i]; lo[i] = values[i] - ck * d[i]; }
      const diff = loss(hi, target, targetHsl) - loss(lo, target, targetHsl);
      for (let i = 0; i < 6; i++) values[i] = fix(values[i] - (a[i] / (A + k + 1)) * (diff / (2 * ck)) * d[i], i);
      const l = loss(values, target, targetHsl);
      if (l < bestLoss) { best = values.slice(); bestLoss = l; }
    }
    return { values: best, loss: bestLoss };
  }

  const filterCache = new Map();
  // '#rrggbb' -> 'brightness(0) saturate(100%) invert(…%) sepia(…%) saturate(…%) hue-rotate(…deg) brightness(…%) contrast(…%)'
  function filterFor(hex) {
    const key = String(hex).toLowerCase();
    if (filterCache.has(key)) return filterCache.get(key);
    const target = rgbOf(key);
    if (!target) return '';
    const targetHsl = hsl(target);
    const rand = seeded(parseInt(key.slice(1), 16) * 2654435761);
    // Several tries (a wide search, then a narrow one from where it got), the best kept; enough once it's
    // within a shade of the color.
    const off = (vals) => { const c = applyFilters(vals.map((v, i) => Math.round(i === 3 ? v * 3.6 : v) / (i === 3 ? 3.6 : 1))); return Math.abs(c[0] - target[0]) + Math.abs(c[1] - target[1]) + Math.abs(c[2] - target[2]); };
    let best = null;
    for (let attempt = 0; attempt < 12 && !(best && off(best.values) <= 3); attempt++) {
      let wide = { loss: Infinity };
      for (let k = 0; wide.loss > 25 && k < 3; k++) {
        const w = spsa(target, targetHsl, rand, 5, [60, 180, 18000, 600, 1.2, 1.2], 15, [50, 20, 3750, 50, 100, 100], 1000);
        if (w.loss < wide.loss) wide = w;
      }
      const A1 = wide.loss + 1;
      const narrow = spsa(target, targetHsl, rand, wide.loss, [0.25 * A1, 0.25 * A1, A1, 0.25 * A1, 0.2 * A1, 0.2 * A1], 2, wide.values.slice(), 500);
      const got = narrow.loss < wide.loss ? narrow : wide;
      if (!best || off(got.values) < off(best.values)) best = got;
    }
    const f = best.values.map((v, i) => Math.round(i === 3 ? v * 3.6 : v));
    const out = `brightness(0) saturate(100%) invert(${f[0]}%) sepia(${f[1]}%) saturate(${f[2]}%) hue-rotate(${f[3]}deg) brightness(${f[4]}%) contrast(${f[5]}%)`;
    filterCache.set(key, out);
    return out;
  }

  // Catppuccin's library (lib/std/v1.less) with one flavor's colors (and their filters) swapped: palette has
  // some or all of the 26. null when the text isn't that library (its maps not found as one line per flavor).
  function patchLibrary(text, flavor, palette) {
    if (!palette || !Object.keys(palette).length) return text;
    const split = text.indexOf('@catppuccin-filters');
    const start = text.indexOf('@catppuccin:');
    if (split < 0 || start < 0 || start > split) return null;
    const line = new RegExp(`^(\\s*@${flavor}:\\s*\\{)([^\\n]*?)(\\};?\\s*)$`, 'm');
    const swap = (part, value) => {
      const m = line.exec(part);
      if (!m) return null;
      let body = m[2];
      for (const [name, v] of Object.entries(palette)) {
        if (!COLORS.includes(name)) continue;
        const re = new RegExp(`(@${name}:\\s*)[^;]*;`);
        if (!re.test(body)) return null;
        body = body.replace(re, (all, head) => head + value(v) + ';');
      }
      return part.slice(0, m.index) + m[1] + body + m[3] + part.slice(m.index + m[0].length);
    };
    const colors = swap(text.slice(0, split), (v) => v);
    const filters = swap(text.slice(split), (v) => filterFor(v));
    if (colors == null || filters == null) return null;
    return colors + filters;
  }

  // Whether a style is one of Catppuccin's (built from their library, with flavor options).
  function isCatppuccin(code, vars) {
    return /userstyles\.catppuccin\.com\/lib\//.test(String(code || '')) && (vars || []).some((v) => v.name === 'darkFlavor' || v.name === 'lightFlavor');
  }

  return { COLORS, FLAVORS, paletteFromTheme, themeBuild, filterFor, applyFilters, patchLibrary, isCatppuccin };
});
