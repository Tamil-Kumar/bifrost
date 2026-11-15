// "Match the page" (shared/themes.js barColor, blendVars): the sidebar and toolbar in a page's color, a loud
// one calmed ("Bright and vivid pages"), with text, accents and named colors that read on it, for every theme.
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

check('a light page gets dark text, a dark page light text', () => {
  for (const [c, dark] of [['#ffffff', false], ['#fff7f0', false], ['#ffd400', false], ['#0f0f0f', true], ['#13233a', true], ['#000000', true]]) {
    assert(T.blendVars(c, T.THEMES.mocha).dark === dark, c + ' should be ' + (dark ? 'dark' : 'light'));
  }
});

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

check('on any page color, with any theme: text reads on the bars (7:1), quieter text (4.5:1), the faintest (3:1)', () => {
  for (const [name, theme] of Object.entries(T.THEMES)) {
    for (const c of [...PAGES, ...SWEEP]) {
      const v = T.blendVars(c, theme);
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
  for (const [name, theme] of Object.entries(T.THEMES)) {
    for (const c of [...PAGES, ...SWEEP]) {
      const v = T.blendVars(c, theme);
      const bar = v['--mantle'];
      assert(T.contrast(v['--accent'], bar) >= 2.9, `${name} on ${c}: accent ${v['--accent']} at ${T.contrast(v['--accent'], bar).toFixed(2)}:1`);
      for (const k of NAMED) {
        assert(v['--' + k], `${name}: no --${k}`);
        assert(T.contrast(v['--' + k], bar) >= 3, `${name} on ${c}: ${k} ${v['--' + k]} at ${T.contrast(v['--' + k], bar).toFixed(2)}:1`);
      }
    }
  }
});

check('a calm page’s color is taken as it is', () => {
  for (const [theme, pages] of [['mocha', ['#0f0f0f', '#0d1117', '#181818', '#13233a', '#000000', '#4a154b', '#c3c9d0']], ['latte', ['#ffffff', '#fff7f0', '#f6f8fa', '#dae0e6', '#0d1117', '#13233a']]]) {
    for (const c of pages) {
      const v = T.blendVars(c, T.THEMES[theme]);
      assert(v['--mantle'] === c && v['--bar-tint'] === c && v['--page-tint'] === c, `${theme} on ${c}: ${v['--mantle']}`);
    }
  }
});

check('bright white next to a dark theme: a soft light gray, not white', () => {
  for (const [name, theme] of Object.entries(T.THEMES).filter(([, t]) => t.dark)) {
    for (const c of ['#ffffff', '#fafafa', '#f6f8fa', '#fff7f0']) {
      const v = T.blendVars(c, theme);
      const bar = v['--mantle'];
      assert(L(bar) <= 0.89 && L(bar) >= 0.8, `${name} on ${c}: bars ${bar} (lightness ${L(bar).toFixed(3)})`);
      assert(v.dark === false, `${name} on ${c}: still a light bar with dark text`);
      assert(v['--page-tint'] === c, 'behind the page: the page’s own color');
    }
    assert(C(T.blendVars('#ffffff', theme)['--mantle']) < 0.004, name + ': white stays without a color of its own');
  }
  // (next to a light theme, white is white)
  assert(T.blendVars('#ffffff', T.THEMES.latte)['--mantle'] === '#ffffff', 'latte on white');
});

check('a vivid color is calmed to a pastel of the same hue', () => {
  for (const c of ['#ffeb3b', '#00e5ff', '#ff80ab', '#00ff00', '#ffd400', '#ff00ff']) {
    for (const theme of [T.THEMES.mocha, T.THEMES.latte]) {
      const bar = T.blendVars(c, theme)['--mantle'];
      assert(C(bar) <= 0.11 && C(bar) > 0.05, `${c}: bars ${bar} (vividness ${C(bar).toFixed(3)}, was ${C(c).toFixed(3)})`);
      const turn = Math.abs(T.toOklch(bar).h - T.toOklch(c).h);
      assert(Math.min(turn, 2 * Math.PI - turn) < 0.12, `${c}: bars ${bar} changed hue`);
    }
  }
});

check('a color neither black nor white reads on (a full red, a mid blue): darker with a dark theme, lighter with a light one', () => {
  for (const c of ['#ff1744', '#e53935', '#1877f2', '#7c4dff', '#808080']) {
    const d = T.blendVars(c, T.THEMES.mocha), l = T.blendVars(c, T.THEMES.latte);
    assert(L(d['--mantle']) < L(c) && d.dark === true, `mocha on ${c}: ${d['--mantle']}`);
    assert(L(l['--mantle']) > L(c) && l.dark === false, `latte on ${c}: ${l['--mantle']}`);
  }
  // (a shade away from reading on the other side: that shade. A navy stays a navy next to a light theme.)
  const navy = T.blendVars('#3b5998', T.THEMES.latte);
  assert(navy.dark === true && Math.abs(L(navy['--mantle']) - L('#3b5998')) <= 0.035, 'latte on navy: ' + navy['--mantle']);
});

check('“Tint my theme”: the bars as dark (or light) as the theme, in the page’s hue', () => {
  for (const [name, theme] of Object.entries(T.THEMES)) {
    for (const c of [...PAGES, '#ff1744', '#ffeb3b', '#00e5ff']) {
      const v = T.blendVars(c, theme, 'theme');
      assert(Math.abs(L(v['--mantle']) - L(theme.mantle)) < 0.03, `${name} on ${c}: bars ${v['--mantle']} (lightness ${L(v['--mantle']).toFixed(3)}, the theme’s ${L(theme.mantle).toFixed(3)})`);
      assert(v['--page-tint'] === c, 'behind the page: the page’s own color');
      assert(T.contrast(v['--text'], v['--mantle']) >= 7, `${name} on ${c}: text at ${T.contrast(v['--text'], v['--mantle']).toFixed(2)}:1`);
    }
    // (a page with no color of its own leaves the theme's)
    for (const c of ['#ffffff', '#000000', '#808080']) assert(T.blendVars(c, theme, 'theme')['--mantle'] === theme.mantle, `${name} on ${c}: ${T.blendVars(c, theme, 'theme')['--mantle']}, the theme’s is ${theme.mantle}`);
  }
  const red = T.toOklch(T.blendVars('#ff1744', T.THEMES.mocha, 'theme')['--mantle']);
  const turn = Math.abs(red.h - T.toOklch('#ff1744').h);
  assert(red.C > 0.04 && Math.min(turn, 2 * Math.PI - turn) < 0.25, 'mocha on red: tinted red');
});

check('“Exactly the page’s”: its color, whatever it is, with text as readable as it can be on it', () => {
  for (const c of [...PAGES, '#ff1744', '#ffeb3b', '#00e5ff']) {
    for (const theme of [T.THEMES.mocha, T.THEMES.latte]) {
      const v = T.blendVars(c, theme, 'exact');
      assert(v['--mantle'] === c && v['--bar-tint'] === c && v['--page-tint'] === c, `${c}: ${v['--mantle']}`);
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
