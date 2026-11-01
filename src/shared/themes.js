/* Bifrost browser — themes. Shared by the main process (CommonJS) and every page (window.WBThemes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBThemes = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // base/mantle/crust: surfaces from lightest to darkest (dark themes) · s0-s2: raised surfaces and borders
  // overlay/subtext/text: text from faintest to strongest · accent + semantic colors
  // accent2: a second accent the first blends into (gradients: buttons, switches, the current tab, progress)
  // glow: three colors that light the window from behind (Appearance → Window background), and glowAlpha how
  // strongly (1 is the usual).
  const THEMES = {
    frost:     { name: 'Frost',                dark: true,  base: '#0e1c33', mantle: '#0a1528', crust: '#060e1d', s0: '#172a4a', s1: '#223c64', s2: '#2e4c7a', overlay: '#6f8cb8', subtext: '#a9c3e6', text: '#e8f3ff', accent: '#7cc8ff', accent2: '#a6f0ff', red: '#ff7a93', peach: '#ffb38a', yellow: '#ffe08a', green: '#8ff0c4', teal: '#6fe6e6', blue: '#6fa8ff', pink: '#f5a8e0', lavender: '#b4c6ff', glow: ['#3f9dff', '#62dcff', '#a9c8ff'] },
    frostlight:{ name: 'Frost Light',          dark: false, base: '#f6faff', mantle: '#e9f2fc', crust: '#dbe7f5', s0: '#cfdef0', s1: '#bdcfe6', s2: '#a9bdd9', overlay: '#7b8fae', subtext: '#475b7a', text: '#12223d', accent: '#1f6fe0', accent2: '#0b7cb4', red: '#d42f4f', peach: '#e3652b', yellow: '#c48a0c', green: '#1b9467', teal: '#0d97a6', blue: '#2a6fdb', pink: '#cf5aa6', lavender: '#5a6ce6', glow: ['#68b8ff', '#7fe6ff', '#b5c9ff'] },
    aurora:    { name: 'Aurora',               dark: true,  base: '#0f1420', mantle: '#0b0f19', crust: '#070a12', s0: '#1a2232', s1: '#263046', s2: '#323e58', overlay: '#64708e', subtext: '#a8b5cf', text: '#e3ebf7', accent: '#5ef0b4', accent2: '#8f7bff', red: '#ff6b8a', peach: '#ffaa70', yellow: '#ffe27a', green: '#5ef0b4', teal: '#4fd6e8', blue: '#6e9bff', pink: '#e58cff', lavender: '#a99bff', glow: ['#22d69a', '#7a63ff', '#2fb8ff'] },
    ember:     { name: 'Ember',                dark: true,  base: '#1c1615', mantle: '#161110', crust: '#0f0b0a', s0: '#2b2220', s1: '#3b2f2c', s2: '#4d3e3a', overlay: '#87726b', subtext: '#cbb5aa', text: '#f4e7df', accent: '#ff8a4c', accent2: '#ffc65c', red: '#ff5f56', peach: '#ff8a4c', yellow: '#ffc65c', green: '#a3d977', teal: '#6fcfb8', blue: '#7fa8ff', pink: '#ff7eb6', lavender: '#c9a3ff', glow: ['#ff5a2e', '#ffad33', '#b8380f'] },
    mocha:     { name: 'Catppuccin Mocha',     dark: true,  base: '#1e1e2e', mantle: '#181825', crust: '#11111b', s0: '#313244', s1: '#45475a', s2: '#585b70', overlay: '#6c7086', subtext: '#a6adc8', text: '#cdd6f4', accent: '#cba6f7', accent2: '#89b4fa', red: '#f38ba8', peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5', blue: '#89b4fa', pink: '#f5c2e7', lavender: '#b4befe', glow: ['#cba6f7', '#89b4fa', '#f5c2e7'] },
    macchiato: { name: 'Catppuccin Macchiato', dark: true,  base: '#24273a', mantle: '#1e2030', crust: '#181926', s0: '#363a4f', s1: '#494d64', s2: '#5b6078', overlay: '#6e738d', subtext: '#a5adcb', text: '#cad3f5', accent: '#c6a0f6', accent2: '#8aadf4', red: '#ed8796', peach: '#f5a97f', yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca', blue: '#8aadf4', pink: '#f5bde6', lavender: '#b7bdf8', glow: ['#c6a0f6', '#8aadf4', '#f5bde6'] },
    frappe:    { name: 'Catppuccin Frappé',    dark: true,  base: '#303446', mantle: '#292c3c', crust: '#232634', s0: '#414559', s1: '#51576d', s2: '#626880', overlay: '#737994', subtext: '#a5adce', text: '#c6d0f5', accent: '#ca9ee6', accent2: '#8caaee', red: '#e78284', peach: '#ef9f76', yellow: '#e5c890', green: '#a6d189', teal: '#81c8be', blue: '#8caaee', pink: '#f4b8e4', lavender: '#babbf1', glow: ['#ca9ee6', '#8caaee', '#f4b8e4'] },
    latte:     { name: 'Catppuccin Latte',     dark: false, base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8', s0: '#ccd0da', s1: '#bcc0cc', s2: '#acb0be', overlay: '#8c8fa1', subtext: '#5c5f77', text: '#4c4f69', accent: '#8839ef', accent2: '#1e66f5', red: '#d20f39', peach: '#fe640b', yellow: '#df8e1d', green: '#40a02b', teal: '#179299', blue: '#1e66f5', pink: '#ea76cb', lavender: '#7287fd', glow: ['#a77df5', '#6b9bff', '#f09bd8'] },
    tokyonight:{ name: 'Tokyo Night',          dark: true,  base: '#1a1b26', mantle: '#16161e', crust: '#101014', s0: '#292e42', s1: '#3b4261', s2: '#414868', overlay: '#565f89', subtext: '#a9b1d6', text: '#c0caf5', accent: '#bb9af7', accent2: '#7dcfff', red: '#f7768e', peach: '#ff9e64', yellow: '#e0af68', green: '#9ece6a', teal: '#73daca', blue: '#7aa2f7', pink: '#ff007c', lavender: '#b4f9f8', glow: ['#bb9af7', '#7aa2f7', '#7dcfff'] },
    nord:      { name: 'Nord',                 dark: true,  base: '#2e3440', mantle: '#292e39', crust: '#242933', s0: '#3b4252', s1: '#434c5e', s2: '#4c566a', overlay: '#616e88', subtext: '#d8dee9', text: '#eceff4', accent: '#88c0d0', accent2: '#81a1c1', red: '#bf616a', peach: '#d08770', yellow: '#ebcb8b', green: '#a3be8c', teal: '#8fbcbb', blue: '#81a1c1', pink: '#b48ead', lavender: '#5e81ac', glow: ['#88c0d0', '#5e81ac', '#b48ead'] },
    gruvbox:   { name: 'Gruvbox Dark',         dark: true,  base: '#282828', mantle: '#1d2021', crust: '#161819', s0: '#3c3836', s1: '#504945', s2: '#665c54', overlay: '#7c6f64', subtext: '#bdae93', text: '#ebdbb2', accent: '#d3869b', accent2: '#fe8019', red: '#fb4934', peach: '#fe8019', yellow: '#fabd2f', green: '#b8bb26', teal: '#8ec07c', blue: '#83a598', pink: '#d3869b', lavender: '#b16286', glow: ['#fe8019', '#d3869b', '#8ec07c'] },
    rosepine:  { name: 'Rosé Pine',            dark: true,  base: '#191724', mantle: '#1f1d2e', crust: '#13111c', s0: '#26233a', s1: '#403d52', s2: '#524f67', overlay: '#6e6a86', subtext: '#908caa', text: '#e0def4', accent: '#c4a7e7', accent2: '#ebbcba', red: '#eb6f92', peach: '#ebbcba', yellow: '#f6c177', green: '#31748f', teal: '#9ccfd8', blue: '#9ccfd8', pink: '#eb6f92', lavender: '#c4a7e7', glow: ['#c4a7e7', '#eb6f92', '#31748f'] },
    dracula:   { name: 'Dracula',              dark: true,  base: '#282a36', mantle: '#21222c', crust: '#191a21', s0: '#343746', s1: '#44475a', s2: '#565970', overlay: '#6272a4', subtext: '#bfbfd4', text: '#f8f8f2', accent: '#bd93f9', accent2: '#ff79c6', red: '#ff5555', peach: '#ffb86c', yellow: '#f1fa8c', green: '#50fa7b', teal: '#8be9fd', blue: '#8be9fd', pink: '#ff79c6', lavender: '#bd93f9', glow: ['#bd93f9', '#ff79c6', '#8be9fd'] },
    oled:      { name: 'OLED Black',           dark: true,  base: '#000000', mantle: '#000000', crust: '#000000', s0: '#141414', s1: '#222222', s2: '#333333', overlay: '#6b6b6b', subtext: '#a8a8a8', text: '#e6e6e6', accent: '#cba6f7', accent2: '#78a9ff', red: '#ff6b81', peach: '#ffa36c', yellow: '#ffd866', green: '#7bd88f', teal: '#5ad4e6', blue: '#78a9ff', pink: '#fc9fd2', lavender: '#b4befe', glow: ['#cba6f7', '#78a9ff', '#fc9fd2'], glowAlpha: 0.45 },
  };

  const ACCENT_KEYS = ['accent', 'red', 'peach', 'yellow', 'green', 'teal', 'blue', 'pink', 'lavender'];

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    if (!x || !y) return a;
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, a)).toFixed(3)})` : 'transparent';
  }
  // How strongly each glow color shows: light themes need less; a theme can turn its own down (glowAlpha).
  function glowA(t, i) {
    const base = t.dark ? [0.3, 0.22, 0.17] : [0.26, 0.19, 0.15];
    return base[i] * (typeof t.glowAlpha === 'number' ? t.glowAlpha : 1);
  }

  // Resolves the effective palette from appearance settings and an optional workspace color.
  function resolve(appearance, opts) {
    opts = opts || {};
    let key = appearance.theme;
    if (key === 'auto') key = opts.systemDark === false ? (appearance.lightTheme || 'latte') : (appearance.darkTheme || 'mocha');
    let t = Object.assign({}, THEMES[key] || THEMES.mocha, { key });
    if (key === 'custom' && appearance.customTheme) t = Object.assign({}, THEMES.mocha, appearance.customTheme, { key, name: 'Custom' });
    if (!t.accent2) t.accent2 = t.blue || t.accent;
    if (!Array.isArray(t.glow) || t.glow.length < 3) t.glow = [t.accent, t.accent2, t.pink || t.accent];
    // A chosen accent (yours, or a space's color) leads; the second accent and the glow follow it.
    const own = (appearance.useCustomAccent && hexToRgb(appearance.accent)) ? appearance.accent
      : (opts.workspaceColor && appearance.workspaceAccents && hexToRgb(opts.workspaceColor)) ? opts.workspaceColor : null;
    if (own && own.toLowerCase() !== String(t.accent).toLowerCase()) {
      t.accent = own;
      t.accent2 = mix(own, t.accent2, 0.5);
      t.glow = [own, t.glow[1], mix(own, t.glow[2], 0.5)];
    }
    return t;
  }

  // CSS custom properties for a palette plus appearance settings.
  function cssVars(t, appearance) {
    const a = appearance || {};
    const vars = {
      '--base': t.base, '--mantle': t.mantle, '--crust': t.crust,
      '--s0': t.s0, '--s1': t.s1, '--s2': t.s2, '--overlay': t.overlay,
      '--subtext': t.subtext, '--text': t.text, '--accent': t.accent,
      '--red': t.red, '--peach': t.peach, '--yellow': t.yellow, '--green': t.green,
      '--teal': t.teal, '--blue': t.blue, '--pink': t.pink, '--lavender': t.lavender,
      '--accent-soft': mix(t.base, t.accent, t.dark ? 0.18 : 0.14),
      '--accent-text': t.dark ? t.crust : '#ffffff',
      '--hover': mix(t.mantle, t.text, t.dark ? 0.07 : 0.06),
      '--active': mix(t.mantle, t.text, t.dark ? 0.12 : 0.1),
      // Depth: a second accent and gradients between them, light from behind, tinted edges and shadows.
      '--accent2': t.accent2,
      '--accent2-soft': mix(t.base, t.accent2, t.dark ? 0.16 : 0.12),
      '--accent-grad': `linear-gradient(135deg, ${t.accent} 0%, ${t.accent2} 100%)`,
      '--accent-glow': rgba(t.accent, t.dark ? 0.38 : 0.3),
      '--g1': t.glow[0], '--g2': t.glow[1], '--g3': t.glow[2],
      '--glow-1': rgba(t.glow[0], glowA(t, 0)),
      '--glow-2': rgba(t.glow[1], glowA(t, 1)),
      '--glow-3': rgba(t.glow[2], glowA(t, 2)),
      '--chrome-low': t.dark ? mix(t.mantle, t.crust, 0.65) : mix(t.mantle, t.accent, 0.05),
      '--surface-hi': mix(t.base, t.text, t.dark ? 0.035 : 0.02),
      '--border-tint': mix(t.s0, t.accent, t.dark ? 0.2 : 0.16),
      '--shadow-color': t.dark ? 'rgba(0, 0, 0, .55)' : rgba(mix(t.text, t.accent, 0.3), 0.2),
    };
    if (a.font) vars['--font'] = a.font;
    if (a.monoFont) vars['--mono'] = a.monoFont;
    if (a.uiScale) vars['--ui-scale'] = String(a.uiScale);
    if (a.radius != null) vars['--radius'] = a.radius + 'px';
    // Shapes and sizes: a value of -1 (or missing) clears the variable so the stylesheet's own
    // default (which follows --radius and the density) applies.
    const px = (v, lo, hi) => (typeof v === 'number' && v >= 0 ? Math.max(lo, Math.min(hi, v)) + 'px' : '');
    const sh = a.shape || {};
    vars['--r-btn'] = px(sh.buttons, 0, 30);
    vars['--tab-radius'] = px(sh.tabs, 0, 30);
    vars['--r-addr'] = px(sh.address, 0, 30);
    vars['--r-menu'] = px(sh.menus, 0, 30);
    vars['--r-page'] = px(sh.page, 0, 40);
    vars['--r-tile'] = px(sh.tiles, 0, 60);
    const sz = a.sizes || {};
    vars['--caption-h'] = px(sz.toolbarHeight, 28, 64);
    vars['--btn-size'] = px(sz.button, 20, 52);
    vars['--icon-size'] = px(sz.icon, 10, 28);
    vars['--btn-gap'] = px(sz.buttonGap, 0, 16);
    vars['--addr-h'] = px(sz.address, 22, 52);
    vars['--tab-h'] = px(sz.tab, 22, 64);
    vars['--tab-gap'] = px(sz.tabGap, 0, 16);
    vars['--sb-pad'] = px(sz.sidebarPadding, 0, 24);
    vars['--gap'] = px(sz.pageGap, 0, 32);
    vars['--bm-h'] = px(sz.bookmarksBar, 20, 48);
    vars['--bm-pad'] = px(sz.bookmarkPadding, 0, 20);
    return vars;
  }

  return { THEMES, ACCENT_KEYS, resolve, cssVars, mix, hexToRgb, rgba };
});
