// "Match the page" (shared/themes.js barColor, blendVars): the sidebar and toolbar in a page's color where
// that looks right (a dark page's as it is), a deeper shade or the theme's own tinted where it doesn't (a
// bright page next to a dark theme; "Bright pages"), with text, accents and named colors that read on it.
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
// Every sixth of each of red, green and blue: 216 page colors, the loudest there are among them.
const SWEEP = [];
for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) SWEEP.push('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
const NAMED = ['red', 'peach', 'yellow', 'green', 'teal', 'blue', 'pink', 'lavender'];
const L = (hex) => T.toOklch(hex).L, C = (hex) => T.toOklch(hex).C;

const hueApart = (a, b) => { const d = Math.abs(T.toOklch(a).h - T.toOklch(b).h); return Math.min(d, 2 * Math.PI - d); };
const DARK = Object.entries(T.THEMES).filter(([, t]) => t.dark);
const LIGHT = Object.entries(T.THEMES).filter(([, t]) => !t.dark);

check('colors go to lightness, vividness and hue and back unchanged', () => {
  for (const c of [...PAGES, '#ff1744', '#00e5ff', '#7c4dff', '#808080']) {
    const o = T.toOklch(c);
    assert(T.fromOklch(o.L, o.C, o.h) === c, c + ' came back ' + T.fromOklch(o.L, o.C, o.h));
  }
  assert(Math.abs(L('#ffffff') - 1) < 0.001 && C('#ffffff') < 0.001 && L('#000000') < 0.001, 'white and black');
  // (more vivid than the screen can show: as vivid as it can, the same lightness)
  const out = T.fromOklch(0.7, 0.4, T.toOklch('#ff0000').h);
  assert(/^#[0-9a-f]{6}$/.test(out) && Math.abs(L(out) - 0.7) < 0.02, out);
});

check('with a dark theme the bars are never bright, whatever the page: light text on all of them', () => {
  for (const [name, theme] of DARK) {
    for (const c of [...PAGES, ...SWEEP]) {
      const v = T.blendVars(c, theme);
      assert(v.dark === true && L(v['--mantle']) < 0.56, `${name} on ${c}: bars ${v['--mantle']} (lightness ${L(v['--mantle']).toFixed(3)})`);
    }
  }
});

check('with a light theme, a light page gets dark text and a dark page light text', () => {
  for (const [c, dark] of [['#ffffff', false], ['#fff7f0', false], ['#ffd400', false], ['#0f0f0f', true], ['#13233a', true], ['#000000', true]]) {
    assert(T.blendVars(c, T.THEMES.latte).dark === dark, c + ' should be ' + (dark ? 'dark' : 'light'));
  }
});

// Every theme, each way of taking a bright page, with and without a theme for the other side.
const WAYS = [];
for (const [name, theme] of Object.entries(T.THEMES)) {
  const other = theme.dark ? T.THEMES.latte : T.THEMES.mocha;
  WAYS.push([name, theme, 'soft', null], [name + ' (with ' + other.name + ')', theme, 'soft', other], [name + ', going light', theme, 'light', other]);
}

check('on any page color, with any theme: text reads on the bars (7:1), quieter text (4.5:1), the faintest (3:1)', () => {
  for (const [name, theme, how, other] of WAYS) {
    for (const c of [...PAGES, ...SWEEP]) {
      const v = T.blendVars(c, theme, how, other);
      const bar = v['--mantle'];
      const at = (k) => T.contrast(v[k], bar);
      assert(at('--text') >= 7, `${name} on ${c} (bars ${bar}): text ${v['--text']} at ${at('--text').toFixed(2)}:1`);
      assert(at('--subtext') >= 4.5, `${name} on ${c} (bars ${bar}): secondary text ${v['--subtext']} at ${at('--subtext').toFixed(2)}:1`);
      assert(at('--overlay') >= 3, `${name} on ${c} (bars ${bar}): faint text ${v['--overlay']} at ${at('--overlay').toFixed(2)}:1`);
      // (and on a field or a hovered tab in them)
      assert(T.contrast(v['--text'], v['--s1']) >= 4, `${name} on ${c}: text on a field at ${T.contrast(v['--text'], v['--s1']).toFixed(2)}:1`);
    }
  }
});

check('every theme’s accent and named colors (a warning’s orange, a folder’s yellow) show on them (3:1)', () => {
  for (const [name, theme, how, other] of WAYS) {
    for (const c of [...PAGES, ...SWEEP]) {
      const v = T.blendVars(c, theme, how, other);
      const bar = v['--mantle'];
      assert(T.contrast(v['--accent'], bar) >= 2.9, `${name} on ${c}: accent ${v['--accent']} at ${T.contrast(v['--accent'], bar).toFixed(2)}:1`);
      for (const k of NAMED) {
        assert(v['--' + k], `${name}: no --${k}`);
        assert(T.contrast(v['--' + k], bar) >= 3, `${name} on ${c}: ${k} ${v['--' + k]} at ${T.contrast(v['--' + k], bar).toFixed(2)}:1`);
      }
    }
  }
});

check('a dark page’s color is taken as it is, however vivid; so is a calm light one by a light theme', () => {
  for (const [theme, pages] of [['mocha', ['#0f0f0f', '#0d1117', '#181818', '#13233a', '#000000', '#4a154b', '#6c2bd9', '#0000c8']], ['latte', ['#ffffff', '#fff7f0', '#f6f8fa', '#dae0e6', '#0d1117', '#13233a', '#6c2bd9']]]) {
    for (const c of pages) {
      const v = T.blendVars(c, T.THEMES[theme]);
      assert(v['--mantle'] === c && v['--bar-tint'] === c && v['--page-tint'] === c, `${theme} on ${c}: ${v['--mantle']}`);
      assert(v.apart === false, `${theme} on ${c}: one surface with the page`);
    }
  }
});

check('a bright page next to a dark theme: the theme’s own shade, tinted with the page’s color, the page apart in it', () => {
  for (const [name, theme] of DARK) {
    // (a page with no color of its own leaves the theme's)
    for (const c of ['#ffffff', '#fafafa', '#e6e6e6']) {
      const v = T.blendVars(c, theme);
      assert(v['--mantle'] === theme.mantle, `${name} on ${c}: bars ${v['--mantle']}, the theme’s are ${theme.mantle}`);
      assert(v['--page-tint'] === c && v.apart === true, `${name} on ${c}: behind the page its own color, and the page apart`);
    }
    for (const c of ['#fff7f0', '#fbf1c7', '#ffe4ec', '#ffeb3b', '#00e5ff', '#e3f2fd']) {
      const bar = T.blendVars(c, theme)['--mantle'];
      assert(Math.abs(L(bar) - L(theme.mantle)) < 0.03, `${name} on ${c}: bars ${bar} (lightness ${L(bar).toFixed(3)}, the theme’s ${L(theme.mantle).toFixed(3)})`);
      // (a tint, never a mud: a dark yellow turns olive long before a dark blue turns blue)
      assert(C(bar) <= 0.045, `${name} on ${c}: bars ${bar} (vividness ${C(bar).toFixed(3)})`);
    }
  }
  const pink = T.blendVars('#ffe4ec', T.THEMES.mocha)['--mantle'];
  assert(pink !== T.THEMES.mocha.mantle && hueApart(pink, '#ffe4ec') < 0.35, 'mocha on pink: ' + pink + ' isn’t tinted pink');
  // (the theme's own text there, as in its menus)
  assert(T.contrast(T.blendVars('#ffffff', T.THEMES.mocha)['--text'], T.THEMES.mocha.text) < 1.12, 'mocha on white: text ' + T.blendVars('#ffffff', T.THEMES.mocha)['--text']);
});

check('a vivid color neither black nor white reads on (a full red, a mid blue), next to a dark theme: a deeper shade of itself, still vivid', () => {
  for (const c of ['#ff1744', '#e53935', '#1877f2', '#ff00ff']) {
    const v = T.blendVars(c, T.THEMES.mocha);
    const bar = v['--mantle'];
    assert(L(bar) < L(c) && v.dark === true, `mocha on ${c}: ${bar}`);
    assert(C(bar) >= 0.12 && hueApart(bar, c) < 0.12, `mocha on ${c}: ${bar} isn’t a deeper shade of it (vividness ${C(bar).toFixed(3)})`);
    assert(T.contrast(bar, '#ffffff') >= 7, `mocha on ${c}: white on ${bar} at ${T.contrast(bar, '#ffffff').toFixed(2)}:1`);
  }
  // (between a deeper shade and the theme's: nearer the theme's the brighter the page)
  const orange = L(T.blendVars('#ff9900', T.THEMES.mocha)['--mantle']), red = L(T.blendVars('#ff1744', T.THEMES.mocha)['--mantle']);
  assert(orange < red && orange > L(T.THEMES.mocha.mantle) - 0.02, 'orange ' + orange.toFixed(3) + ', red ' + red.toFixed(3));
});

check('next to a light theme: a vivid bright color a pastel of itself, one in the middle a lighter shade, a navy still a navy', () => {
  for (const c of ['#ffeb3b', '#00e5ff', '#ff80ab', '#00ff00', '#ffd400']) {
    const bar = T.blendVars(c, T.THEMES.latte)['--mantle'];
    assert(C(bar) <= 0.11 && C(bar) > 0.05, `${c}: bars ${bar} (vividness ${C(bar).toFixed(3)}, was ${C(c).toFixed(3)})`);
    assert(hueApart(bar, c) < 0.12, `${c}: bars ${bar} changed hue`);
  }
  for (const c of ['#ff1744', '#e53935', '#1877f2', '#808080']) {
    const l = T.blendVars(c, T.THEMES.latte);
    assert(L(l['--mantle']) > L(c) && l.dark === false, `latte on ${c}: ${l['--mantle']}`);
  }
  const navy = T.blendVars('#3b5998', T.THEMES.latte);
  assert(navy.dark === true && Math.abs(L(navy['--mantle']) - L('#3b5998')) <= 0.035, 'latte on navy: ' + navy['--mantle']);
});

check('“Go light”: next to a dark theme a bright page gives the bars its color, with the light theme’s text and colors', () => {
  const M = T.THEMES.mocha, La = T.THEMES.latte;
  for (const c of ['#ffffff', '#f6f8fa', '#fff7f0', '#ffe4ec']) {
    const v = T.blendVars(c, M, 'light', La);
    assert(v['--mantle'] === c && v.dark === false && v.apart === false, `${c}: bars ${v['--mantle']}`);
  }
  const white = T.blendVars('#ffffff', M, 'light', La);
  assert(T.contrast(white['--text'], La.text) < 1.25, 'text ' + white['--text'] + ', Latte’s is ' + La.text);
  assert(hueApart(white['--accent'], La.accent) < 0.1 && C(white['--accent']) > 0.15, 'accent ' + white['--accent'] + ', Latte’s is ' + La.accent);
  // (deeper, not grayer: a warning's orange is still an orange)
  assert(C(white['--peach']) > 0.12 && hueApart(white['--peach'], La.peach) < 0.25, 'peach ' + white['--peach']);
  const yellow = T.blendVars('#ffeb3b', M, 'light', La)['--mantle'];
  assert(C(yellow) <= 0.11 && L(yellow) > 0.85, 'a neon yellow: ' + yellow);
  // (dark pages and the ones in the middle: as with "Stay dark")
  for (const c of ['#0f0f0f', '#13233a', '#ff1744', '#1877f2']) assert(T.blendVars(c, M, 'light', La)['--mantle'] === T.blendVars(c, M, 'soft', La)['--mantle'], c);
  // (no light theme to take them from: the dark theme's, made deeper)
  const lone = T.blendVars('#ffffff', M, 'light');
  assert(T.contrast(lone['--text'], '#ffffff') >= 7 && T.contrast(lone['--peach'], '#ffffff') >= 3, 'without a light theme: ' + lone['--text'] + ', ' + lone['--peach']);
});

check('“Exactly the page’s”: its color, whatever it is, with text as readable as it can be on it', () => {
  for (const c of [...PAGES, '#ff1744', '#ffeb3b', '#00e5ff']) {
    for (const theme of [T.THEMES.mocha, T.THEMES.latte]) {
      const v = T.blendVars(c, theme, 'exact', theme.dark ? T.THEMES.latte : T.THEMES.mocha);
      assert(v['--mantle'] === c && v['--bar-tint'] === c && v['--page-tint'] === c && v.apart === false, `${c}: ${v['--mantle']}`);
      assert(T.contrast(v['--text'], c) >= 4.5, `${c}: text ${v['--text']} at ${T.contrast(v['--text'], c).toFixed(2)}:1`);
      assert(T.contrast(v['--subtext'], c) >= 4.5 || /^#(000000|ffffff)$/.test(v['--subtext']), `${c}: secondary text ${v['--subtext']}`);
    }
  }
});

check('no color (or a broken one): nothing to blend with', () => {
  assert(T.blendVars('', T.THEMES.mocha) === null && T.blendVars('red', T.THEMES.mocha) === null, 'should be null');
});

console.log(`\nblend: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
