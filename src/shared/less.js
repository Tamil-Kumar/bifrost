/* Bifrost — LESS, as userstyles are written in it. Stylus builds a style with "@preprocessor less" through
   less.js (4.x: its default options, so division only inside parentheses); this is Bifrost's own compiler for
   the same language, written to give what less.js gives for what userstyles use:
     variables (lazy, scoped: the last one in the nearest block wins), @@indirection, maps and their lookups
     (@map[@key][prop]), detached rulesets and their calls, mixins (namespaces, parameters with defaults, named
     and variadic, patterns, guards, !important, the variables a mixin call hands back to its caller, mixin
     results as values: #ns.mixin()[]), CSS guards (& when …), nesting with &, @media and the like bubbling out
     of rules (nested @media joined with "and"), each(), operations, string and selector interpolation, and
     less.js's functions (colors, color blending, strings, lists, math, types, if/boolean).
   @import of .less files is resolved by the caller (options.load: url -> text); CSS imports are left as they are.
   Not here: @plugin, inline JavaScript, :extend.

   render(source, { load, file }) -> Promise<css>. Shared by the main process's compile worker and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBLess = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class LessError extends Error {
    constructor(message, src, index, file) {
      super(message);
      this.name = 'LessError';
      this.file = file || '';
      if (typeof src === 'string' && typeof index === 'number') {
        const before = src.slice(0, index);
        this.line = before.split('\n').length;
        this.column = index - before.lastIndexOf('\n');
      }
    }
  }

  // Limits, so a style can't hang its compile: mixins within mixins, and work done.
  const MAX_DEPTH = 250;
  const MAX_WORK = 5e6;

  // ------------------------------------------------------------------ values
  // Units as less.js keeps them: what's multiplied and divided (px*px/s), printed as one of them.
  function mkUnit(num, den, backup) {
    const u = { num: num ? num.slice().sort() : [], den: den ? den.slice().sort() : [], backup };
    if (!u.backup && num && num.length) u.backup = num[0];
    return u;
  }
  function unitStr(u) { return u.num.join('*') + u.den.map((x) => '/' + x).join(''); }
  function unitOut(u) { return u.num.length === 1 ? u.num[0] : u.backup ? u.backup : u.den.length ? u.den[0] : ''; }
  function DimU(v, u) { return { t: 'dim', v: Number(v), u, unit: unitStr(u) }; }
  function Dim(v, unit) { return DimU(v, unit && typeof unit === 'object' ? mkUnit(unit.num, unit.den, unit.backup) : mkUnit(unit ? [unit] : [])); }
  const isUnit = (d, s) => !!d && d.t === 'dim' && d.unit.toUpperCase() === String(s).toUpperCase();
  const Color = (rgb, a, orig) => ({ t: 'color', rgb, a: typeof a === 'number' ? a : 1, orig });
  const Kw = (s) => ({ t: 'kw', s });
  const Anon = (s) => ({ t: 'anon', s: s == null ? '' : String(s) });
  const Quoted = (q, s, esc) => ({ t: 'quoted', q, s, esc: !!esc });
  const TRUE = Kw('true');
  const FALSE = Kw('false');

  const NAMED = (() => {
    const out = Object.create(null);
    ('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
      'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 ' +
      'chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff ' +
      'darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgrey:a9a9a9 darkgreen:006400 ' +
      'darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 ' +
      'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f ' +
      'darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 ' +
      'dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ' +
      'ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 grey:808080 green:008000 greenyellow:adff2f ' +
      'honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
      'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
      'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgrey:d3d3d3 lightgreen:90ee90 lightpink:ffb6c1 lightsalmon:ffa07a ' +
      'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de ' +
      'lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa ' +
      // (less.js's mediumpurple, d8 where CSS has db: kept, so colors made from it come out as there)
      'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370d8 mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
      'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
      'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
      'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
      'palevioletred:d87093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 ' +
      'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
      'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
      'slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 ' +
      'thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 ' +
      'yellowgreen:9acd32').split(' ').forEach((p) => { const [k, v] = p.split(':'); out[k] = v; });
    return out;
  })();

  function hexColor(hex, orig) {
    const rgb = [];
    let a;
    if (hex.length >= 6) {
      for (let k = 0; k < hex.length; k += 2) {
        const c = parseInt(hex.slice(k, k + 2), 16);
        if (k < 6) rgb.push(c); else a = c / 255;
      }
    } else {
      for (let k = 0; k < hex.length; k++) {
        const c = parseInt(hex[k] + hex[k], 16);
        if (k < 3) rgb.push(c); else a = c / 255;
      }
    }
    return Color(rgb, a == null ? 1 : a, orig);
  }

  function keywordColor(word) {
    const key = String(word).toLowerCase();
    if (NAMED[key]) return hexColor(NAMED[key], word);
    if (key === 'transparent') return Color([0, 0, 0], 0, word);
    return null;
  }

  // ------------------------------------------------------------------ the parser
  const RX = {
    varDecl: /@([\w-]+)\s*:/y,
    varCall: /(@[\w-]+)(\(\s*\))?/y,
    propSimple: /([_a-zA-Z0-9-]+)\s*:/y,
    propComplex: /(\*?)((?:[_a-zA-Z0-9-]|[@$]\{[\w-]+\})+)\s*(\+_?)?\s*:/y,
    propName: /(\*?)((?:[_a-zA-Z0-9-]|[@$]\{[\w-]+\})+)/y,
    anonValue: /([^.#@$+/'"*`(;{}-]*);/y,
    dimension: /([+-]?\d*\.?\d+)(%|[a-z_]+)?/iy,
    color: /#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})([\w.#[])?/y,
    keyword: /\[?(?:[\w-]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+\]?/y,
    colorKeyword: /[_A-Za-z-][_A-Za-z0-9-]+/y,
    colorOperand: /([lchrgbs])(?=\s|[,/*)]|$)/y,
    callName: /([\w-]+|%|~|progid:[\w.]+)\(/y,
    variable: /@@?[\w-]+/y,
    variableCurly: /@\{([\w-]+)\}/y,
    property: /\$[\w-]+/y,
    unicode: /U\+[0-9a-fA-F?]+(?:-[0-9a-fA-F?]+)?/y,
    assignment: /(\w+)(?=\s?=)/y,
    important: /! *important/y,
    mixinElement: /[#.](?:[\w-]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+/y,
    mixinDef: /([#.](?:[\w-]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+)\s*\(/y,
    lookup: /\[((?:[@$]{0,2})[_a-zA-Z0-9-]*)\]/y,
    atName: /@[a-z-]+/iy,
    addOp: /[-+]\s+/y,
    orDelim: /,\s*(not\s*)?\(/y,
    urlRaw: /(?:\\[()'"]|[^()'"])+/y,
  };

  function parse(src, file, mode) {
    src = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const n = src.length;
    let i = 0;
    const where = { text: src, file };
    const fail = (msg, at) => new LessError(msg, src, at == null ? i : at, file);

    const isWs = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
    function ws() {
      while (i < n) {
        const c = src[i];
        if (isWs(c)) { i++; continue; }
        if (c === '/') {
          const d = src[i + 1];
          if (d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
          if (d === '/') { const e = src.indexOf('\n', i + 2); i = e < 0 ? n : e + 1; continue; }
        }
        return;
      }
    }
    const wsBefore = () => i > 0 && isWs(src[i - 1]);
    function sticky(rx) { rx.lastIndex = i; const m = rx.exec(src); if (m) i = rx.lastIndex; return m; }
    function tok(rx) { const m = sticky(rx); if (m) ws(); return m; }
    function test(rx) { rx.lastIndex = i; return rx.test(src); }
    function chr(c) { if (src[i] === c) { i++; ws(); return c; } return null; }
    function str(s) { if (src.startsWith(s, i)) { i += s.length; ws(); return s; } return null; }

    // A quoted string from i: [quote, its text with escapes as written].
    function quotedRaw() {
      const q = src[i];
      if (q !== '"' && q !== "'") return null;
      for (let j = i + 1; j < n; j++) {
        const c = src[j];
        if (c === '\\') { j++; continue; }
        if (c === q) { const s = src.slice(i + 1, j); i = j + 1; return [q, s]; }
      }
      return null;
    }

    // Raw text up to (not including) one of `stops` outside brackets, strings and comments.
    function rawUntil(stops) {
      const from = i;
      let depth = 0;
      let out = '';
      let seg = i;
      while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'") { if (!quotedRaw()) i++; continue; }
        if (c === '/' && src[i + 1] === '*') { out += src.slice(seg, i); const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; seg = i; continue; }
        if (c === '@' && src[i + 1] === '{') { const e = src.indexOf('}', i); i = e < 0 ? n : e + 1; continue; }
        if (depth === 0 && stops.includes(c)) break;
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
        i++;
      }
      out += src.slice(seg, i);
      return i > from ? out : '';
    }

    function block() {
      if (src[i] !== '{') return null;
      const at = i;
      i++;
      const rules = primary();
      ws();
      if (src[i] !== '}') throw fail('Expected } (the block starting here isn’t closed)', at);
      i++;
      ws();
      return rules;
    }

    function primary() {
      const rules = [];
      for (;;) {
        ws();
        if (i >= n || src[i] === '}') break;
        const node = statement();
        if (node) { rules.push(node); continue; }
        let semi = false;
        while (src[i] === ';') { i++; ws(); semi = true; }
        if (semi) continue;
        const raw = rawDeclaration();
        if (raw) { rules.push(raw); continue; }
        break;
      }
      return rules;
    }

    function statement() {
      const at = i;
      const node = statementAt();
      if (node) { node.pos = at; node.src = where; }
      return node;
    }
    function statementAt() {
      const c = src[i];
      if (c === '@') {
        if (src[i + 1] === '{') return declaration() || ruleset();
        return declaration() || variableCall() || atRule();
      }
      if (c === '.' || c === '#') return mixinDefinition() || mixinCall(false, false) || ruleset();
      // (no selector starts with name(, so that's a function call: each(…))
      return declaration() || (test(/(?:[\w-]+|%|~)\(/y) && !/^url\(/i.test(src.slice(i, i + 4)) ? callStatement() : null) || ruleset();
    }

    // A declaration less.js couldn't read either, kept as it's written: name: text;
    function rawDeclaration() {
      const start = i;
      const m = sticky(/(\*?-?[_a-zA-Z0-9-]+)\s*:/y);
      if (!m) return null;
      ws();
      const text = rawUntil(';}');
      if (src[i] !== ';' && src[i] !== '}') { i = start; return null; }
      if (src[i] === ';') i++;
      return { t: 'decl', name: m[1], variable: false, value: { t: 'raw', s: text.trim() }, important: '', merge: '' };
    }

    function end() {
      if (src[i] === ';') { i++; ws(); return true; }
      return src[i] === '}' || i >= n;
    }

    function declaration() {
      const c = src[i];
      if (c === '.' || c === '#' || c === '&' || c === ':') return null;
      const start = i;
      let name;
      let isVar = false;
      let merge = '';
      let interp = false;
      let m;
      if (c === '@' && (m = tok(RX.varDecl))) { name = '@' + m[1]; isVar = true; }
      else if ((m = tok(RX.propSimple))) name = m[1];
      else if ((m = sticky(RX.propComplex))) { ws(); name = m[1] + m[2]; merge = m[3] || ''; interp = /[@$]\{/.test(m[2]); }
      else if ((m = sticky(RX.propName))) {
        // (comments between the name and its colon)
        ws();
        if (src[i] === '+') { merge = src[i + 1] === '_' ? '+_' : '+'; i += merge.length; ws(); }
        if (src[i] !== ':') { i = start; return null; }
        i++; ws();
        name = m[1] + m[2];
        interp = /[@$]\{/.test(m[2]);
      } else return null;

      let value = null;
      let important = '';
      let hasDR = false;
      if (isVar && (src[i] === '{' || ((src[i] === '.' || src[i] === '#') && src[i + 1] === '('))) {
        value = detachedRuleset();
        if (value) hasDR = true;
      }
      if (!value) {
        if (!isVar && name.startsWith('--')) {
          if (src[i] === ';') { i++; return { t: 'decl', name, variable: false, value: Anon(''), important: '', merge: '', interp }; }
          value = permissiveValue(/[;}]/);
        } else {
          // Plain text up to ; (less.js's quick path: read as a value when a variable or $property looks it up)
          const a = sticky(RX.anonValue);
          if (a) { ws(); value = Anon(a[1].trim()); value.reparse = true; }
        }
        if (value) return { t: 'decl', name, variable: isVar, value, important: '', merge, interp };
        value = valueP();
        if (value) important = parseImportant();
        else if (isVar) value = permissiveValue(/[;}]/) || (src[i] === ';' ? Anon('') : null);
      }
      if (value && (end() || hasDR)) return { t: 'decl', name, variable: isVar, value, important, merge, interp };
      i = start;
      return null;
    }

    function parseImportant() {
      if (src[i] !== '!') return '';
      const m = tok(RX.important);
      return m ? '!important' : '';
    }

    function detachedRuleset() {
      const start = i;
      let params = null;
      let variadic = false;
      if ((src[i] === '.' || src[i] === '#') && src[i + 1] === '(') {
        i += 2; ws();
        const a = mixinArgs(false);
        params = a.args;
        variadic = a.variadic;
        if (!chr(')')) { i = start; return null; }
      }
      if (src[i] !== '{') { i = start; return null; }
      const rules = block();
      if (params) return { t: 'mixdef', name: null, params, variadic, guard: null, rules };
      return { t: 'detached', rules };
    }

    // ---- values
    function valueP() {
      const items = [];
      for (;;) {
        const e = expression();
        if (!e) break;
        items.push(e);
        if (!chr(',')) break;
      }
      return items.length ? { t: 'value', items } : null;
    }

    function expression() {
      const items = [];
      for (;;) {
        ws();
        const e = addition() || entity();
        if (!e) break;
        items.push(e);
        if (src[i] === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') { i++; ws(); items.push(Anon('/')); }
      }
      return items.length ? { t: 'expr', items } : null;
    }

    function addition() {
      const m = multiplication();
      if (!m) return null;
      let isSpaced = wsBefore();
      let out = null;
      for (;;) {
        const save = i;
        let op = null;
        const a = sticky(RX.addOp);
        if (a) { op = a[0][0]; ws(); }
        else if (!isSpaced && (src[i] === '+' || src[i] === '-')) { op = src[i]; i++; ws(); }
        if (!op) break;
        const b = multiplication();
        if (!b) { i = save; break; }
        m.parensInOp = true;
        b.parensInOp = true;
        out = { t: 'op', op, a: out || m, b, spaced: isSpaced };
        isSpaced = wsBefore();
      }
      return out || m;
    }

    function multiplication() {
      const m = operand();
      if (!m) return null;
      let isSpaced = wsBefore();
      let out = null;
      for (;;) {
        if (src[i] === '/' && (src[i + 1] === '*' || src[i + 1] === '/')) break;
        const save = i;
        let op = null;
        if (src[i] === '/' || src[i] === '*') { op = src[i]; i++; ws(); }
        else if (src.startsWith('./', i)) { op = './'; i += 2; ws(); }
        if (!op) break;
        const b = operand();
        if (!b) { i = save; break; }
        m.parensInOp = true;
        b.parensInOp = true;
        out = { t: 'op', op, a: out || m, b, spaced: isSpaced };
        isSpaced = wsBefore();
      }
      return out || m;
    }

    function operand() {
      let negate = false;
      if (src[i] === '-' && /[@$(]/.test(src[i + 1] || '')) { i++; ws(); negate = true; }
      let o = sub() || dimension() || color() || variable() || property() || call() || quoted(true) || colorKeyword() || colorOperand() || mixinCall(true, true);
      if (negate) {
        if (!o) throw fail('Expected a value after -');
        o.parensInOp = true;
        o = { t: 'neg', v: o };
      }
      return o;
    }

    function sub() {
      if (src[i] !== '(') return null;
      const start = i;
      i++; ws();
      const a = addition();
      if (a && chr(')')) return { t: 'expr', items: [a], parens: true };
      i = start;
      return null;
    }

    function entity() {
      return literal() || variable() || url() || property() || call() || keyword() || mixinCall(true) || javascript();
    }

    function literal() { return dimension() || color() || quoted() || unicode(); }

    function dimension() {
      const c = src[i];
      if (!(c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9'))) return null;
      const m = tok(RX.dimension);
      return m ? Dim(parseFloat(m[1]), m[2] || '') : null;
    }

    function color() {
      if (src[i] !== '#') return null;
      const start = i;
      const m = sticky(RX.color);
      if (m && !m[2]) { ws(); return hexColor(m[1], m[0]); }
      i = start;
      return null;
    }

    function quoted(forceEscaped) {
      const start = i;
      let esc = false;
      if (src[i] === '~') { i++; esc = true; }
      else if (forceEscaped) return null;
      const q = quotedRaw();
      if (!q) { i = start; return null; }
      ws();
      return Quoted(q[0], q[1], esc);
    }

    function unicode() {
      if (src[i] !== 'U' && src[i] !== 'u') return null;
      const m = tok(RX.unicode);
      return m ? Anon(m[0]) : null;
    }

    function keyword() {
      if (src[i] === '%') { i++; ws(); return Kw('%'); }
      const m = tok(RX.keyword);
      if (!m) return null;
      return keywordColor(m[0]) || Kw(m[0]);
    }

    function colorKeyword() {
      const start = i;
      const m = sticky(RX.colorKeyword);
      if (!m) return null;
      const c = keywordColor(m[0]);
      if (c) { ws(); return c; }
      i = start;
      return null;
    }

    function colorOperand() {
      const m = tok(RX.colorOperand);
      return m ? Kw(m[1]) : null;
    }

    function variable() {
      if (src[i] !== '@') return null;
      const start = i;
      const m = sticky(RX.variable);
      if (!m) return null;
      const name = m[0];
      const c = src[i];
      if ((c === '(' || c === '[') && !wsBefore()) {
        const vc = variableCallIn(name);
        if (vc) return vc;
        i = start + name.length;
      }
      ws();
      return { t: 'var', name };
    }

    function variableCallIn(name) {
      const start = i;
      let parens = false;
      if (src.startsWith('()', i)) { i += 2; parens = true; }
      const keys = ruleLookups();
      if (!keys && !parens) { i = start; return null; }
      ws();
      const base = { t: 'varcall', name };
      return keys ? { t: 'lookup', base, keys } : base;
    }

    function variableCurly() {
      if (src[i] !== '@' || src[i + 1] !== '{') return null;
      const m = tok(RX.variableCurly);
      return m ? { t: 'var', name: '@' + m[1] } : null;
    }

    function property() {
      if (src[i] !== '$') return null;
      const m = tok(RX.property);
      return m ? { t: 'prop', name: m[0] } : null;
    }

    function url() {
      if (!(src[i] === 'u' || src[i] === 'U') || !/^url\(/i.test(src.slice(i, i + 4))) return null;
      const start = i;
      i += 4;
      while (isWs(src[i])) i++;
      let v = quoted() || variable() || property();
      if (!v) {
        const m = sticky(RX.urlRaw);
        const raw = m ? m[0].trim() : '';
        v = /@\{[\w-]+\}|\$\{[\w-]+\}/.test(raw) ? Quoted('', raw, true) : Anon(raw);
      }
      while (isWs(src[i])) i++;
      if (src[i] !== ')') { i = start; return null; }
      i++;
      ws();
      return { t: 'url', v };
    }

    function call() {
      if (/^url\(/i.test(src.slice(i, i + 4))) return null;
      const start = i;
      const m = sticky(RX.callName);
      if (!m) return null;
      ws();
      const name = m[1];
      const lower = name.toLowerCase();
      let args;
      if (lower === 'alpha' && /^opacity\s*=/i.test(src.slice(i, i + 12))) {
        const m = sticky(/opacity\s*=\s*/iy);
        const v = dimension() || variable();
        if (m && v && chr(')')) return { t: 'call', name: 'alpha', args: [{ t: 'assign', key: 'opacity', v }], ie: true };
        i = start;
        return null;
      }
      if (lower === 'if' || lower === 'boolean') {
        const cond = condition(false, true);
        if (!cond) throw fail('Expected a condition in ' + name + '()');
        args = functionArgs([cond]);
      } else args = functionArgs(null);
      if (!chr(')')) { i = start; return null; }
      return { t: 'call', name, args };
    }

    function functionArgs(prev) {
      let comma = prev || [];
      const semis = [];
      let semi = false;
      let skip = !!prev;
      for (;;) {
        if (skip) skip = false;
        else {
          ws();
          let v = detachedRuleset() || assignment() || expression();
          if (!v) break;
          if (v.t === 'expr' && v.items.length === 1 && !v.parens) v = v.items[0];
          comma.push(v);
        }
        if (chr(',')) continue;
        if (chr(';') || semi) {
          semi = true;
          semis.push(comma.length < 1 ? comma[0] : { t: 'value', items: comma });
          comma = [];
        }
      }
      return semi ? semis : comma;
    }

    function assignment() {
      const start = i;
      const m = sticky(RX.assignment);
      if (!m) return null;
      ws();
      if (!chr('=')) { i = start; return null; }
      const v = entity();
      if (!v) { i = start; return null; }
      return { t: 'assign', key: m[1], v };
    }

    function javascript() {
      if (src[i] === '`' || (src[i] === '~' && src[i + 1] === '`')) throw fail('JavaScript in LESS (`…`) isn’t supported');
      return null;
    }

    function callStatement() {
      const c = call();
      if (!c) return null;
      if (src[i] === ';') { i++; ws(); }
      return { t: 'callstmt', call: c };
    }

    // Raw text from i to a stop, with whatever LESS can't read kept as text (custom properties, at-rule preludes).
    function permissiveValue(until, atRule) {
      const stop = () => i >= n || until.test(src[i]);
      ws();
      if (stop()) return null;
      const items = [];
      const start = i;
      for (;;) {
        ws();
        if (stop()) break;
        const save = i;
        let e = null;
        try { e = (atRule && variableCurly()) || entity(); } catch (err) { i = save; e = null; }
        if (!e) break;
        items.push(e);
        ws();
        if (src[i] === ',') { items.push(Anon(',')); i++; ws(); }
      }
      if (stop()) return items.length ? { t: 'expr', items } : null;
      const restAt = i;
      const raw = rawUntil(until.source.includes('{') ? '{;' : ';}');
      const out = [];
      if (items.length) {
        out.push({ t: 'expr', items });
        if (isWs(src[restAt - 1])) out.push(Anon(' '));
      }
      out.push({ t: 'quoted', q: '', s: raw.trim(), esc: true, bare: true });
      if (i === start) return null;
      return { t: 'expr', items: out, noSpacing: true };
    }

    // ---- mixins
    function mixinElements() {
      const els = [];
      for (;;) {
        const m = sticky(RX.mixinElement);
        if (!m) break;
        els.push(m[0]);
        ws();
        if (src[i] === '>') { i++; ws(); }
      }
      return els.length ? els : null;
    }

    function ruleLookups() {
      if (src[i] !== '[') return null;
      const keys = [];
      for (;;) {
        const m = sticky(RX.lookup);
        if (!m) break;
        keys.push(m[1]);
      }
      return keys.length ? keys : null;
    }

    function mixinCall(inValue, getLookup) {
      const c = src[i];
      if (c !== '.' && c !== '#') return null;
      const start = i;
      const path = mixinElements();
      if (!path) { i = start; return null; }
      let args = [];
      let parens = false;
      if (src[i] === '(') {
        i++; ws();
        args = mixinArgs(true).args;
        if (!chr(')')) { i = start; return null; }
        parens = true;
      }
      let keys = null;
      if (getLookup !== false) keys = ruleLookups();
      if (keys) ws();
      if (getLookup === true && !keys) { i = start; return null; }
      if (inValue && !keys && !parens) { i = start; return null; }
      let important = false;
      if (!inValue && parseImportant()) important = true;
      if (inValue || end()) {
        const node = { t: 'mixcall', path, args, important: !keys && important };
        return keys ? { t: 'lookup', base: node, keys } : node;
      }
      i = start;
      return null;
    }

    function mixinArgs(isCall) {
      const ret = { args: null, variadic: false };
      let exprs = [];
      const semis = [];
      const commas = [];
      let semi = false;
      let named = false;
      let name = null;
      let hasSep = true;
      for (;;) {
        ws();
        let arg;
        if (isCall) arg = detachedRuleset() || expression();
        else {
          if (src.startsWith('...', i)) {
            i += 3; ws();
            ret.variadic = true;
            if (chr(';') && !semi) semi = true;
            (semi ? semis : commas).push({ variadic: true });
            break;
          }
          arg = variable() || property() || literal() || keyword() || mixinCall(true);
        }
        if (!arg || !hasSep) break;
        let loopName = null;
        let value = arg;
        let val = null;
        let expand = false;
        if (isCall) { if (arg.t === 'expr' && arg.items.length === 1) val = arg.items[0]; }
        else val = arg;
        if (val && (val.t === 'var' || val.t === 'prop')) {
          if (src[i] === ':') {
            i++; ws();
            if (exprs.length > 0) { if (semi) throw fail('Cannot mix ; and , as delimiter types'); named = true; }
            value = detachedRuleset() || expression();
            if (!value) {
              if (isCall) throw fail('Could not understand the value for a named argument');
              ret.args = [];
              return ret;
            }
            loopName = name = val.name;
          } else if (src.startsWith('...', i)) {
            i += 3; ws();
            if (!isCall) {
              ret.variadic = true;
              if (chr(';') && !semi) semi = true;
              (semi ? semis : commas).push({ name: val.name, variadic: true });
              break;
            }
            expand = true;
          } else if (!isCall) {
            name = loopName = val.name;
            value = null;
          }
        }
        if (value) exprs.push(value);
        commas.push({ name: loopName, value, expand });
        if (chr(',')) { hasSep = true; continue; }
        hasSep = !!chr(';');
        if (hasSep || semi) {
          if (named) throw fail('Cannot mix ; and , as delimiter types');
          semi = true;
          if (exprs.length > 1) value = { t: 'value', items: exprs };
          semis.push({ name, value, expand });
          name = null;
          exprs = [];
          named = false;
        }
      }
      ret.args = semi ? semis : commas;
      return ret;
    }

    function mixinDefinition() {
      const start = i;
      // (a call like .m(); has a } before any {)
      const nextOpen = src.indexOf('{', i);
      const nextClose = src.indexOf('}', i);
      if (nextOpen < 0 || (nextClose >= 0 && nextClose < nextOpen)) return null;
      const m = sticky(RX.mixinDef);
      if (!m) return null;
      ws();
      const a = mixinArgs(false);
      if (!chr(')')) { i = start; return null; }
      let guard = null;
      if (src.startsWith('when', i) && /[\s(]/.test(src[i + 4] || '')) {
        i += 4; ws();
        guard = conditions();
        if (!guard) throw fail('Expected a condition after when');
      }
      if (src[i] !== '{') { i = start; return null; }
      const rules = block();
      return { t: 'mixdef', name: m[1], params: a.args, variadic: a.variadic, guard, rules };
    }

    function variableCall() {
      const start = i;
      const m = sticky(RX.varCall);
      if (!m) return null;
      const keys = ruleLookups();
      if (!keys && m[2] !== '()') { i = start; return null; }
      ws();
      if (keys) { i = start; return null; }
      if (!end()) { i = start; return null; }
      return { t: 'varcall', name: m[1] };
    }

    // ---- rulesets
    function ruleset() {
      const start = i;
      if (src[i] === '@' && src[i + 1] !== '{') return null;
      let dp = 0;
      let db = 0;
      let text = '';
      let seg = i;
      let guardAt = -1;
      while (i < n) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '"' || c === "'") { if (!quotedRaw()) i++; continue; }
        if (c === '/' && src[i + 1] === '*') { text += src.slice(seg, i) + ' '; const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; seg = i; continue; }
        if (c === '/' && src[i + 1] === '/' && dp === 0 && db === 0) { text += src.slice(seg, i) + ' '; const e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; seg = i; continue; }
        if (c === '@' && src[i + 1] === '{') { const e = src.indexOf('}', i); if (e < 0) break; i = e + 1; continue; }
        if (c === '(') dp++;
        else if (c === ')') dp--;
        else if (c === '[') db++;
        else if (c === ']') db--;
        else if (dp <= 0 && db <= 0) {
          if (c === '{') break;
          if (c === ';' || c === '}') { i = start; return null; }
          if (c === 'w' && isWs(src[i - 1]) && src.startsWith('when', i) && /[\s(]/.test(src[i + 4] || '')) { guardAt = i; break; }
        }
        i++;
      }
      if (i >= n) { i = start; return null; }
      text += src.slice(seg, i);
      let guard = null;
      if (guardAt >= 0) {
        i = guardAt + 4;
        ws();
        guard = conditions();
        if (!guard) throw fail('Expected a condition after when');
        ws();
        if (src[i] !== '{') { i = start; return null; }
      }
      const sel = normalizeSelector(text);
      if (!sel) { i = start; return null; }
      const rules = block();
      return { t: 'rule', sel, guard, rules };
    }

    // ---- at-rules
    function atRule() {
      if (src[i] !== '@') return null;
      if (/^@import\b/i.test(src.slice(i, i + 8))) return importRule();
      if (/^@plugin\b/i.test(src.slice(i, i + 8))) throw fail('@plugin isn’t supported');
      const start = i;
      const m = sticky(RX.atName);
      if (!m) return null;
      const name = m[0];
      let base = name.toLowerCase();
      if (base[1] === '-' && base.indexOf('-', 2) > 0) base = '@' + base.slice(base.indexOf('-', 2) + 1);
      ws();
      if (base === '@media' || base === '@container') {   // (each nests into its own kind)
        const prelude = rawUntil('{;');
        if (src[i] !== '{') throw fail(`Expected { after ${name}`, start);
        return { t: 'at', name, kind: 'media', prelude: prelude.trim(), rules: block() };
      }
      if (base === '@charset' || base === '@namespace') {
        const prelude = rawUntil(';}');
        chr(';');
        return { t: 'at', name, kind: 'stmt', prelude: prelude.trim(), rules: null };
      }
      if (base === '@keyframes' || base === '@counter-style') {
        const prelude = rawUntil('{;');
        if (src[i] !== '{') throw fail(`Expected { after ${name}`, start);
        return { t: 'at', name, kind: 'rooted', prelude: prelude.trim(), rules: block() };
      }
      const nested = base === '@document' || base === '@supports' || base === '@layer' || base === '@starting-style';
      const node = permissiveValue(/[{;]/, true);
      ws();
      if (src[i] === '{') return { t: 'at', name, kind: nested ? 'nested' : 'rooted', preludeNode: node, rules: block() };
      if (src[i] === ';') { i++; ws(); return { t: 'at', name, kind: 'stmt', preludeNode: node, rules: null }; }
      throw fail(`${name} is missing its block or ending ;`, start);
    }

    function importRule() {
      const start = i;
      i += 7;
      ws();
      const opts = {};
      if (src[i] === '(') {
        const m = sticky(/\(\s*([a-z,\s]*)\)/iy);
        if (m) for (const o of m[1].split(/[\s,]+/)) if (o) opts[o.toLowerCase()] = true;
        ws();
      }
      const path = quoted() || url() || variable();
      if (!path) throw fail('This @import isn’t understood', start);
      const media = rawUntil(';}');
      chr(';');
      return { t: 'import', path, opts, media: media.trim() };
    }

    // ---- guards
    function conditions() {
      const a = condition(true);
      if (!a) return null;
      let c = null;
      for (;;) {
        if (!test(RX.orDelim)) break;
        i++; ws();
        const b = condition(true);
        if (!b) break;
        c = { t: 'cond', op: 'or', a: c || a, b };
      }
      return c || a;
    }

    function condition(needsParens, allowOps) {
      let r = conditionAnd(needsParens, allowOps);
      if (!r) return null;
      if (str('or')) {
        const next = condition(needsParens, allowOps);
        if (!next) return null;
        r = { t: 'cond', op: 'or', a: r, b: next };
      }
      return r;
    }

    function conditionAnd(needsParens, allowOps) {
      let r = negatedCondition(needsParens, allowOps) || parenthesisCondition(needsParens, allowOps);
      if (!r && !needsParens) r = atomicCondition(needsParens);
      if (!r) return null;
      if (allowOps) r = atomicCondition(needsParens, r, allowOps) || r;
      if (str('and')) {
        const next = conditionAnd(needsParens, allowOps);
        if (!next) return null;
        r = { t: 'cond', op: 'and', a: r, b: next };
      }
      return r;
    }

    function negatedCondition(needsParens, allowOps) {
      if (!(src.startsWith('not', i) && !/[\w-]/.test(src[i + 3] || ''))) return null;
      i += 3; ws();
      const r = parenthesisCondition(needsParens, allowOps);
      if (r) { r.negate = !r.negate; return r; }
      const a = keyword() || variable() || quoted() || mixinCall(true, true);
      if (a) return { t: 'cond', op: '=', a, b: TRUE, negate: true };
      return null;
    }

    function parenthesisCondition(needsParens, allowOps) {
      if (src[i] !== '(') return null;
      const start = i;
      i++; ws();
      const inner = i;
      const body = condition(needsParens, allowOps);
      if (body && chr(')')) return body;
      i = inner;
      const atom = atomicCondition(needsParens);
      if (!atom) { i = start; return null; }
      if (!chr(')')) { i = start; return null; }
      return atom;
    }

    function atomicCondition(needsParens, pre, allowOps) {
      const operandC = () => (allowOps && parenthesisCondition(needsParens)) || addition() || keyword() || quoted() || mixinCall(true, true);
      const a = pre || operandC();
      if (!a) return null;
      let op = null;
      if (src[i] === '>') { i++; op = src[i] === '=' ? (i++, '>=') : '>'; }
      else if (src[i] === '<') { i++; op = src[i] === '=' ? (i++, '<=') : '<'; }
      else if (src[i] === '=') { i++; if (src[i] === '>') { i++; op = '=>'; } else if (src[i] === '<') { i++; op = '=<'; } else op = '='; }
      if (op) {
        ws();
        const b = operandC();
        if (!b) throw fail('Expected an expression after ' + op);
        return { t: 'cond', op, a, b, negate: false };
      }
      if (!pre) return { t: 'cond', op: '=', a, b: TRUE, negate: false };
      return null;
    }

    ws();
    if (mode === 'value') {
      const v = valueP();
      ws();
      if (i < n) throw fail('This value isn’t understood');
      return v;
    }
    const rules = primary();
    ws();
    if (i < n) throw fail(src[i] === '}' ? 'There’s a } with no block to close' : 'This part isn’t understood');
    return { t: 'root', rules, file };
  }
  const parseValueText = (text) => parse(text, '', 'value');

  // Whitespace in a selector made single (strings left alone), and comments out.
  function normalizeSelector(text) {
    let out = '';
    let space = false;
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (c === '"' || c === "'") {
        let j = k + 1;
        for (; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
        if (space && out) out += ' ';
        space = false;
        out += text.slice(k, j + 1);
        k = j;
        continue;
      }
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f') { space = true; continue; }
      if (space && out) out += ' ';
      space = false;
      out += c;
    }
    return out;
  }

  // Top-level commas of a selector list.
  function splitTop(text, sep) {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (c === '"' || c === "'") { let j = k + 1; for (; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++; k = j; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === sep && depth === 0) { out.push(text.slice(from, k)); from = k + 1; }
    }
    out.push(text.slice(from));
    return out.map((s) => s.trim()).filter((s) => s !== '');
  }

  // ------------------------------------------------------------------ evaluation
  function freshCtx(shared) {
    return { frames: [], parens: 0, mathOn: true, inCalc: 0, importantScope: [], depth: 0, shared: shared || { work: 0, defaultFn: null } };
  }
  function withFrames(ctx, frames) {
    return { frames, parens: 0, mathOn: true, inCalc: 0, importantScope: ctx.importantScope, depth: ctx.depth, shared: ctx.shared };
  }
  function work(ctx) {
    if (++ctx.shared.work > MAX_WORK) throw new LessError('This style is too big or loops forever (it took too long to build)');
  }
  const isMathOn = (ctx, op) => !!ctx.mathOn && !(op === '/' && !ctx.parens);

  function frameVars(f) {
    if (!f.vars) {
      const m = new Map();
      for (const r of f.rules) if (r && r.t === 'decl' && r.variable) m.set(r.name, r);
      f.vars = m;
    }
    return f.vars;
  }
  function resetFrame(f) { f.vars = null; f.mixins = null; }

  // A node's "value" as less.js's .value: for @@, e(), escape(), replace(), %().
  function valueOf(v) {
    switch (v && v.t) {
      case 'quoted': case 'kw': case 'anon': return v.s;
      case 'dim': return v.v;
      case 'color': return v.orig;
      case 'value': case 'expr': return v.items;
      default: return undefined;
    }
  }
  // What @{name} turns into.
  const interpText = (v) => (v.t === 'quoted' ? v.s : css(v));

  // A declaration's value as less.js reads it when it's looked up: quick-path text read again as a value.
  function reparsed(d) {
    if (!d.value || d.value.t !== 'anon' || !d.value.reparse) return d;
    if (!d.parsed) {
      d.parsed = d;
      try {
        const m = /^([\s\S]*?)\s*(!\s*important)?\s*$/.exec(d.value.s);
        const v = m[1] ? parseValueText(m[1]) : null;
        if (v) d.parsed = { ...d, value: v, important: d.important || (m[2] ? '!important' : '') };
      } catch (e) { d.parsed = d; }
    }
    return d.parsed;
  }

  function lookupVar(name, ctx) {
    if (name.startsWith('@@')) {
      const v = lookupVar(name.slice(1), ctx);
      name = '@' + valueOf(v);
    }
    for (const f of ctx.frames) {
      let d = frameVars(f).get(name);
      if (!d) continue;
      d = reparsed(d);
      if (d.evaluating) throw new LessError(`Recursive variable definition for ${name}`);
      if (d.important) { const s = ctx.importantScope[ctx.importantScope.length - 1]; if (s) s.important = d.important; }
      d.evaluating = true;
      try {
        if (ctx.inCalc) return evalNode({ t: 'call', name: '_SELF', args: [d.value] }, ctx);
        return evalNode(d.value, ctx);
      } finally { d.evaluating = false; }
    }
    throw new LessError(`variable ${name} is undefined`);
  }

  function lookupProperty(name, ctx) {
    const prop = name.slice(1);
    for (const f of ctx.frames) {
      let found = null;
      for (const r of f.rules) if (r && r.t === 'decl' && !r.variable && r.name === prop) found = r;
      if (found) {
        found = reparsed(found);
        if (found.important) { const s = ctx.importantScope[ctx.importantScope.length - 1]; if (s) s.important = found.important; }
        if (found.evaluating) throw new LessError(`Recursive property reference for ${prop}`);
        found.evaluating = true;
        try { return evalNode(found.value, ctx); } finally { found.evaluating = false; }
      }
    }
    throw new LessError(`Property '${prop}' is undefined`);
  }

  function interpolate(text, ctx, opts) {
    const iterate = opts && opts.iterate;
    let guard = 0;
    let prev;
    do {
      prev = text;
      text = text.replace(/@\{([\w-]+)\}/g, (m, name) => interpText(lookupVar('@' + name, ctx)));
      text = text.replace(/\$\{([\w-]+)\}/g, (m, name) => interpText(lookupProperty('$' + name, ctx)));
    } while (iterate && text !== prev && ++guard < 20);
    if (opts && opts.bare) {
      text = text.replace(/(^|[^\w@-])@(@?[\w-]+)/g, (m, before, name) => {
        try { return before + interpText(lookupVar('@' + name, ctx)); } catch (e) { return m; }
      });
    }
    return text;
  }

  function evalNode(v, ctx) {
    work(ctx);
    switch (v.t) {
      case 'value':
        return v.items.length === 1 ? evalNode(v.items[0], ctx) : { t: 'value', items: v.items.map((x) => evalNode(x, ctx)) };
      case 'expr': return evalExpr(v, ctx);
      case 'dim': case 'color': case 'kw': case 'anon': case 'paren': case 'raw': return v;
      case 'quoted': {
        if (!v.s.includes('{') && !(v.bare && v.s.includes('@'))) return v;
        return Quoted(v.q, interpolate(v.s, ctx, { iterate: true, bare: v.bare }), v.esc);
      }
      case 'var': return lookupVar(v.name, ctx);
      case 'prop': return lookupProperty(v.name, ctx);
      case 'lookup': return evalLookup(v, ctx);
      case 'varcall': return callDetached(lookupVar(v.name, ctx), ctx, v.name);
      case 'call': return evalCall(v, ctx);
      case 'op': return evalOp(v, ctx);
      case 'neg':
        if (isMathOn(ctx)) return evalOp({ t: 'op', op: '*', a: Dim(-1), b: v.v }, ctx);
        return { t: 'neg', v: evalNode(v.v, ctx) };
      case 'url': return { t: 'url', v: urlValue(evalNode(v.v, ctx)) };
      case 'assign': return { t: 'assign', key: v.key, v: evalNode(v.v, ctx) };
      case 'cond': return evalCond(v, ctx) ? TRUE : FALSE;
      case 'detached': return v.frames ? v : { t: 'detached', rules: v.rules, frames: ctx.frames.slice() };
      case 'mixdef': return v;
      case 'mixcall': return { t: 'ruleEv', rules: evalMixinCall(v, ctx), sels: null };
      case 'ruleEv': return v;
      case 'bool': return v;
      default: throw new LessError('Can’t evaluate ' + v.t);
    }
  }

  function evalExpr(v, ctx) {
    const mathOn = isMathOn(ctx);
    if (v.parens) ctx.parens++;
    let out;
    let doubleParen = false;
    try {
      if (v.items.length > 1) out = { t: 'expr', items: v.items.map((x) => evalNode(x, ctx)), noSpacing: v.noSpacing };
      else if (v.items.length === 1) {
        const first = v.items[0];
        if (first.t === 'expr' && first.parens && !first.parensInOp && !ctx.inCalc) doubleParen = true;
        out = evalNode(first, ctx);
      } else out = v;
    } finally { if (v.parens) ctx.parens--; }
    if (v.parens && v.parensInOp && !mathOn && !doubleParen && out.t !== 'dim') out = { t: 'paren', v: out };
    return out;
  }

  // less.js keeps url()s as written but for ./ and ../ steps.
  function urlValue(v) {
    if ((v.t === 'quoted' || v.t === 'anon') && typeof v.s === 'string') {
      const parts = v.s.split('/');
      const out = [];
      for (const seg of parts) {
        if (seg === '.') continue;
        if (seg === '..') { if (out.length === 0 || out[out.length - 1] === '..') out.push(seg); else out.pop(); continue; }
        out.push(seg);
      }
      const s = out.join('/');
      return v.t === 'quoted' ? Quoted(v.q, s, v.esc) : Anon(s);
    }
    return v;
  }

  // ---- numbers and units
  const fround = (x) => Number((x + 2e-16).toFixed(8));
  const UNITS = {
    length: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, px: 0.0254 / 96, pt: 0.0254 / 72, pc: 0.0254 / 72 * 12 },
    duration: { s: 1, ms: 0.001 },
    angle: { rad: 1 / (2 * Math.PI), deg: 1 / 360, grad: 1 / 400, turn: 1 },
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function cancel(u) {
    const count = {};
    for (const x of u.num) count[x] = (count[x] || 0) + 1;
    for (const x of u.den) count[x] = (count[x] || 0) - 1;
    u.num = [];
    u.den = [];
    for (const x of Object.keys(count)) {
      for (let k = 0; k < count[x]; k++) u.num.push(x);
      for (let k = 0; k < -count[x]; k++) u.den.push(x);
    }
    u.num.sort();
    u.den.sort();
    return u;
  }
  function usedUnits(u) {
    const out = {};
    for (const g of Object.keys(UNITS)) for (const x of u.num.concat(u.den)) if (has(UNITS[g], x) && !out[g]) out[g] = x;
    return out;
  }
  // conversions: a unit ('px'), or { length: 'px', … }.
  function convertTo(d, conversions) {
    if (typeof conversions === 'string') {
      const to = conversions;
      conversions = {};
      for (const g of Object.keys(UNITS)) if (has(UNITS[g], to)) conversions[g] = to;
    }
    let v = d.v;
    const u = mkUnit(d.u.num, d.u.den, d.u.backup);
    for (const g of Object.keys(conversions)) {
      const target = conversions[g];
      const group = UNITS[g];
      u.num = u.num.map((x) => { if (has(group, x)) { v = v * (group[x] / group[target]); return target; } return x; });
      u.den = u.den.map((x) => { if (has(group, x)) { v = v / (group[x] / group[target]); return target; } return x; });
    }
    cancel(u);
    return DimU(v, u);
  }
  const unify = (d) => convertTo(d, { length: 'px', duration: 's', angle: 'rad' });
  function operate(op, a, b) {
    switch (op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; default: return NaN; }
  }
  function dimOperate(a, op, b) {
    let value = operate(op, a.v, b.v);
    let u = mkUnit(a.u.num, a.u.den, a.u.backup);
    if (op === '+' || op === '-') {
      if (!u.num.length && !u.den.length) { u = mkUnit(b.u.num, b.u.den, b.u.backup); if (a.u.backup) u.backup = a.u.backup; }
      else if (!b.u.num.length && !u.den.length) { /* (as less.js) */ }
      else { const c = convertTo(b, usedUnits(a.u)); value = operate(op, a.v, c.v); }
    } else if (op === '*') {
      u.num = a.u.num.concat(b.u.num).sort();
      u.den = a.u.den.concat(b.u.den).sort();
      cancel(u);
    } else if (op === '/') {
      u.num = a.u.num.concat(b.u.den).sort();
      u.den = a.u.den.concat(b.u.num).sort();
      cancel(u);
    } else throw new LessError('Unknown operation ' + op);
    return DimU(value, u);
  }
  function colorOperate(a, op, b) {
    const rgb = [0, 1, 2].map((k) => operate(op, a.rgb[k], b.rgb[k]));
    return Color(rgb, a.a * (1 - b.a) + b.a);
  }
  const dimToColor = (d) => Color([d.v, d.v, d.v]);

  function evalOp(v, ctx) {
    let a = evalNode(v.a, ctx);
    let b = evalNode(v.b, ctx);
    if (!isMathOn(ctx, v.op)) return { t: 'op', op: v.op, a, b, spaced: v.spaced };
    const op = v.op === './' ? '/' : v.op;
    if (a.t === 'dim' && b.t === 'color') a = dimToColor(a);
    if (b.t === 'dim' && a.t === 'color') b = dimToColor(b);
    const okA = a.t === 'dim' || a.t === 'color';
    const okB = b.t === 'dim' || b.t === 'color';
    if (!okA || !okB) {
      if ((a.t === 'op' || b.t === 'op') && a.op === '/') return { t: 'op', op: v.op, a, b, spaced: v.spaced };
      throw new LessError(`Operation on an invalid type: ${css(a)} ${v.op} ${css(b)}`);
    }
    return a.t === 'dim' ? dimOperate(a, op, b) : colorOperate(a, op, b);
  }

  // ---- comparing (guards)
  function hasCompare(v) { return v.t === 'dim' || v.t === 'color' || v.t === 'quoted' || v.t === 'anon'; }
  function nodeCompare(a, b) {
    switch (a.t) {
      case 'dim': {
        if (b.t !== 'dim') return undefined;
        let x = a, y = b;
        if (a.unit && b.unit) { x = unify(a); y = unify(b); if (x.unit.toUpperCase() !== y.unit.toUpperCase()) return undefined; }
        return numericCompare(x.v, y.v);
      }
      case 'color':
        return b.t === 'color' && b.rgb[0] === a.rgb[0] && b.rgb[1] === a.rgb[1] && b.rgb[2] === a.rgb[2] && b.a === a.a ? 0 : undefined;
      case 'quoted':
        if (b.t === 'quoted' && !a.esc && !b.esc) return numericCompare(a.s, b.s);
        return css(a) === css(b) ? 0 : undefined;
      case 'anon':
        return css(a) === css(b) ? 0 : undefined;
      default: return undefined;
    }
  }
  const numericCompare = (a, b) => (a < b ? -1 : a === b ? 0 : a > b ? 1 : undefined);
  function compare(a, b) {
    if (hasCompare(a) && !(b.t === 'quoted' || b.t === 'anon')) return nodeCompare(a, b);
    if (hasCompare(b)) { const r = nodeCompare(b, a); return r === undefined ? undefined : -r; }
    if (a.t !== b.t) return undefined;
    const av = a.t === 'kw' || a.t === 'bool' ? a.s : a.items;
    const bv = b.t === 'kw' || b.t === 'bool' ? b.s : b.items;
    if (!Array.isArray(av)) return av === bv ? 0 : undefined;
    if (!Array.isArray(bv) || av.length !== bv.length) return undefined;
    for (let k = 0; k < av.length; k++) if (compare(av[k], bv[k]) !== 0) return undefined;
    return 0;
  }

  function evalCond(c, ctx) {
    if (c.t !== 'cond') { const v = evalNode(c, ctx); return !(v.t === 'kw' && v.s === 'false'); }
    let r;
    if (c.op === 'and' || c.op === 'or') {
      const a = evalCond(c.a, ctx);
      const b = evalCond(c.b, ctx);
      r = c.op === 'and' ? a && b : a || b;
    } else {
      const a = c.a.t === 'cond' ? (evalCond(c.a, ctx) ? TRUE : FALSE) : evalNode(c.a, ctx);
      const b = c.b.t === 'cond' ? (evalCond(c.b, ctx) ? TRUE : FALSE) : evalNode(c.b, ctx);
      switch (compare(a, b)) {
        case -1: r = c.op === '<' || c.op === '=<' || c.op === '<='; break;
        case 0: r = c.op === '=' || c.op === '>=' || c.op === '=<' || c.op === '<='; break;
        case 1: r = c.op === '>' || c.op === '>='; break;
        default: r = false;
      }
    }
    return c.negate ? !r : r;
  }

  // ---- functions
  function evalCall(v, ctx) {
    const saveMath = ctx.mathOn;
    const calc = v.name === 'calc';
    ctx.mathOn = !calc;
    const enter = calc || ctx.inCalc > 0;
    if (enter) ctx.inCalc++;
    const exit = () => { if (enter) ctx.inCalc--; ctx.mathOn = saveMath; };
    const fn = v.ie ? null : FUNCTIONS[v.name.toLowerCase()];
    let result;
    if (fn) {
      let args = v.args;
      try {
        if (fn.evalArgs !== false) args = args.map((a) => evalNode(a, ctx));
        args = args.map((a) => {
          if (a && a.t === 'expr') {
            if (a.items.length === 1) return a.parens && a.items[0].op === '/' ? a : a.items[0];
          }
          return a;
        });
        result = fn.evalArgs === false ? fn(ctx, ...args) : fn.apply({ ctx }, args);
      } catch (e) {
        exit();
        if (e instanceof LessError) throw e;
        throw new LessError(`Error evaluating function \`${v.name}\`${e && e.message ? ': ' + e.message : ''}`);
      }
    }
    if (result != null) {
      exit();
      if (typeof result !== 'object' || !result.t) result = Anon(result === true ? '' : String(result));
      return result;
    }
    const args = v.args.map((a) => evalNode(a, ctx));
    exit();
    return { t: 'call', name: v.name, args };
  }

  function number(n) {
    if (typeof n === 'number') return n;
    if (n && n.t === 'dim') return isUnit(n, '%') ? n.v / 100 : n.v;
    throw new LessError('color functions take numbers as parameters');
  }
  function scaled(n, size) { return isUnit(n, '%') ? n.v * size / 100 : number(n); }
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  function toHSL(c) {
    if (!c || c.t !== 'color') throw new LessError('Argument cannot be evaluated to a color');
    const r = c.rgb[0] / 255, g = c.rgb[1] / 255, b = c.rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    const d = max - min;
    if (max === min) h = s = 0;
    else {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return { h: h * 60, s, l, a: c.a };
  }
  function toHSV(c) {
    if (!c || c.t !== 'color') throw new LessError('Argument cannot be evaluated to a color');
    const r = c.rgb[0] / 255, g = c.rgb[1] / 255, b = c.rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h;
    const s = max === 0 ? 0 : d / max;
    if (max === min) h = 0;
    else if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, v: max, a: c.a };
  }
  function luma(c) {
    let [r, g, b] = c.rgb.map((x) => x / 255);
    r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function fnHsla(h, s, l, a) {
    try {
      if (h && h.t === 'color') return Color(h.rgb, s ? number(s) : h.a, 'hsla');
      h = (number(h) % 360) / 360;
      s = clamp01(number(s));
      l = clamp01(number(l));
      a = clamp01(number(a));
      const m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
      const m1 = l * 2 - m2;
      const hue = (x) => {
        x = x < 0 ? x + 1 : (x > 1 ? x - 1 : x);
        if (x * 6 < 1) return m1 + (m2 - m1) * x * 6;
        if (x * 2 < 1) return m2;
        if (x * 3 < 2) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
        return m1;
      };
      return Color([hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255], number(a), 'hsla');
    } catch (e) { return undefined; }
  }
  function fnRgba(r, g, b, a) {
    try {
      if (r && r.t === 'color') return Color(r.rgb, g ? number(g) : r.a, 'rgba');
      const rgb = [r, g, b].map((x) => scaled(x, 255));
      return Color(rgb, number(a), 'rgba');
    } catch (e) { return undefined; }
  }
  // A color made from another's HSL keeps its rgb()/hsl() form, if it had one.
  function fromHsl(orig, hsl) {
    const c = fnHsla(hsl.h, hsl.s, hsl.l, hsl.a);
    if (c) c.orig = orig.orig && /^(rgb|hsl)/.test(orig.orig) ? orig.orig : 'rgb';
    return c;
  }
  function adjust(key, sign) {
    return function (color, amount, method) {
      const hsl = toHSL(color);
      const amt = amount ? amount.v : 0;
      if (method && valueOf(method) === 'relative') hsl[key] += sign * hsl[key] * amt / 100;
      else hsl[key] += sign * amt / 100;
      hsl[key] = clamp01(hsl[key]);
      return fromHsl(color, hsl);
    };
  }
  function mix(c1, c2, weight) {
    if (!weight) weight = Dim(50);
    const p = weight.v / 100;
    const w = p * 2 - 1;
    const a = toHSL(c1).a - toHSL(c2).a;
    const w1 = (((w * a === -1) ? w : (w + a) / (1 + w * a)) + 1) / 2;
    const w2 = 1 - w1;
    return Color([0, 1, 2].map((k) => c1.rgb[k] * w1 + c2.rgb[k] * w2), c1.a * p + c2.a * (1 - p));
  }
  function blend(mode) {
    return function (c1, c2) {
      if (!c1 || c1.t !== 'color' || !c2 || c2.t !== 'color') throw new LessError('Argument cannot be evaluated to a color');
      const ab = c1.a, as = c2.a;
      const ar = as + ab * (1 - as);
      const rgb = [];
      for (let k = 0; k < 3; k++) {
        const cb = c1.rgb[k] / 255, cs = c2.rgb[k] / 255;
        let cr = mode(cb, cs);
        if (ar) cr = (as * cs + ab * (cb - as * (cb + cs - cr))) / ar;
        rgb.push(cr * 255);
      }
      return Color(rgb, ar);
    };
  }
  const BLEND = {
    multiply: (cb, cs) => cb * cs,
    screen: (cb, cs) => cb + cs - cb * cs,
    overlay: (cb, cs) => { cb *= 2; return cb <= 1 ? BLEND.multiply(cb, cs) : BLEND.screen(cb - 1, cs); },
    softlight: (cb, cs) => { let d = 1, e = cb; if (cs > 0.5) { e = 1; d = cb > 0.25 ? Math.sqrt(cb) : ((16 * cb - 12) * cb + 4) * cb; } return cb - (1 - 2 * cs) * e * (d - cb); },
    hardlight: (cb, cs) => BLEND.overlay(cs, cb),
    difference: (cb, cs) => Math.abs(cb - cs),
    exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
    average: (cb, cs) => (cb + cs) / 2,
    negation: (cb, cs) => 1 - Math.abs(cb + cs - 1),
  };
  function mathFn(fn, unit, cssOk) {
    return function (n) {
      if (!n || n.t !== 'dim') {
        if (cssOk && n && n.t === 'call') return undefined;
        throw new LessError('argument must be a number');
      }
      let d = n;
      let u = unit;
      if (u === null) u = n.u; else d = unify(n);
      return Dim(fn(d.v), u);
    };
  }
  function minMax(isMin, args) {
    args = args.slice();
    if (!args.length) throw new LessError('one or more arguments required');
    const order = [];
    const values = {};
    let unitStatic, unitClone;
    for (let k = 0; k < args.length; k++) {
      const cur = args[k];
      if (!cur || cur.t !== 'dim') {
        if (cur && (cur.t === 'value' || cur.t === 'expr')) { args.push(...cur.items); continue; }
        throw new LessError('incompatible types');
      }
      const curU = !cur.unit && unitClone !== undefined ? unify(Dim(cur.v, unitClone)) : unify(cur);   // (as less.js's min/max)
      const unit = !curU.unit && unitStatic !== undefined ? unitStatic : curU.unit;
      unitStatic = (unit !== '' && unitStatic === undefined) || (unit !== '' && order.length && unify(order[0]).unit === '') ? unit : unitStatic;
      unitClone = unit !== '' && unitClone === undefined ? cur.unit : unitClone;
      const j = values[''] !== undefined && unit !== '' && unit === unitStatic ? values[''] : values[unit];
      if (j === undefined) {
        if (unitStatic !== undefined && unit !== unitStatic) throw new LessError('incompatible types');
        values[unit] = order.length;
        order.push(cur);
        continue;
      }
      const ref = !order[j].unit && unitClone !== undefined ? unify(Dim(order[j].v, unitClone)) : unify(order[j]);
      if ((isMin && curU.v < ref.v) || (!isMin && curU.v > ref.v)) order[j] = cur;
    }
    if (order.length === 1) return order[0];
    return Anon(`${isMin ? 'min' : 'max'}(${order.map(css).join(', ')})`);
  }
  const listItems = (v) => (v && (v.t === 'value' || v.t === 'expr') ? v.items : [v]);

  const FUNCTIONS = Object.create(null);
  Object.assign(FUNCTIONS, {
    rgb(r, g, b) {
      let a = 1;
      if (r && r.t === 'expr') {
        const val = r.items;
        r = val[0]; g = val[1]; b = val[2];
        if (b && b.t === 'op') { a = b.b; b = b.a; }
      }
      const c = fnRgba(r, g, b, a);
      if (c) { c.orig = 'rgb'; return c; }
      return undefined;
    },
    rgba: fnRgba,
    hsl(h, s, l) {
      let a = 1;
      if (h && h.t === 'expr') {
        const val = h.items;
        h = val[0]; s = val[1]; l = val[2];
        if (l && l.t === 'op') { a = l.b; l = l.a; }
      }
      const c = fnHsla(h, s, l, a);
      if (c) { c.orig = 'hsl'; return c; }
      return undefined;
    },
    hsla: fnHsla,
    hsv(h, s, v) { return FUNCTIONS.hsva(h, s, v, 1); },
    hsva(h, s, v, a) {
      h = ((number(h) % 360) / 360) * 360;
      s = number(s); v = number(v); a = number(a);
      const k = Math.floor((h / 60) % 6);
      const f = (h / 60) - k;
      const vs = [v, v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
      const perm = [[0, 3, 1], [2, 0, 1], [1, 0, 3], [1, 2, 0], [3, 1, 0], [0, 1, 2]];
      return fnRgba(vs[perm[k][0]] * 255, vs[perm[k][1]] * 255, vs[perm[k][2]] * 255, a);
    },
    hue(c) { return Dim(toHSL(c).h); },
    saturation(c) { return Dim(toHSL(c).s * 100, '%'); },
    lightness(c) { return Dim(toHSL(c).l * 100, '%'); },
    hsvhue(c) { return Dim(toHSV(c).h); },
    hsvsaturation(c) { return Dim(toHSV(c).s * 100, '%'); },
    hsvvalue(c) { return Dim(toHSV(c).v * 100, '%'); },
    red(c) { toHSL(c); return Dim(c.rgb[0]); },
    green(c) { toHSL(c); return Dim(c.rgb[1]); },
    blue(c) { toHSL(c); return Dim(c.rgb[2]); },
    alpha(c) { return Dim(toHSL(c).a); },
    luma(c) { toHSL(c); return Dim(luma(c) * c.a * 100, '%'); },
    luminance(c) { toHSL(c); return Dim(((0.2126 * c.rgb[0] / 255) + (0.7152 * c.rgb[1] / 255) + (0.0722 * c.rgb[2] / 255)) * c.a * 100, '%'); },
    saturate(color, amount, method) { if (!color || color.t !== 'color') return null; return adjust('s', 1)(color, amount, method); },
    desaturate: adjust('s', -1),
    lighten: adjust('l', 1),
    darken: adjust('l', -1),
    fadein: adjust('a', 1),
    fadeout: adjust('a', -1),
    fade(color, amount) { const hsl = toHSL(color); hsl.a = clamp01(amount.v / 100); return fromHsl(color, hsl); },
    spin(color, amount) { const hsl = toHSL(color); const h = (hsl.h + amount.v) % 360; hsl.h = h < 0 ? 360 + h : h; return fromHsl(color, hsl); },
    mix,
    greyscale(c) { return FUNCTIONS.desaturate(c, Dim(100)); },
    contrast(color, dark, light, threshold) {
      if (!color || color.t !== 'color') return null;
      if (light === undefined) light = fnRgba(255, 255, 255, 1);
      if (dark === undefined) dark = fnRgba(0, 0, 0, 1);
      if (luma(dark) > luma(light)) { const t = light; light = dark; dark = t; }
      threshold = threshold === undefined ? 0.43 : number(threshold);
      return luma(color) < threshold ? light : dark;
    },
    argb(c) { toHSL(c); return Anon(toHex([c.a * 255].concat(c.rgb))); },
    color(c) {
      if (c && c.t === 'quoted' && /^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})$/i.test(c.s)) return hexColor(c.s.slice(1), c.s);
      if (c && c.t === 'color') return Color(c.rgb, c.a);
      const k = c && keywordColor(valueOf(c));
      if (k) { k.orig = undefined; return k; }
      throw new LessError('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
    },
    tint(color, amount) { return mix(FUNCTIONS.rgb(Dim(255), Dim(255), Dim(255)), color, amount); },
    shade(color, amount) { return mix(FUNCTIONS.rgb(Dim(0), Dim(0), Dim(0)), color, amount); },

    e(s) { return Quoted('"', s && s.t === 'quoted' ? s.s : String(valueOf(s)), true); },
    escape(s) {
      const v = encodeURI(String(valueOf(s))).replace(/=/g, '%3D').replace(/:/g, '%3A').replace(/#/g, '%23').replace(/;/g, '%3B').replace(/\(/g, '%28').replace(/\)/g, '%29');
      return Anon(v);
    },
    replace(string, pattern, replacement, flags) {
      const rep = replacement.t === 'quoted' ? replacement.s : css(replacement);
      const result = String(valueOf(string)).replace(new RegExp(String(valueOf(pattern)), flags ? String(valueOf(flags)) : ''), rep);
      return Quoted(string.q || '', result, string.esc);
    },
    '%'(string, ...args) {
      let result = String(valueOf(string));
      for (const a of args) {
        result = result.replace(/%[sda]/i, (token) => {
          const value = a.t === 'quoted' && /s/i.test(token) ? a.s : css(a);
          return /[A-Z]$/.test(token) ? encodeURIComponent(value) : value;
        });
      }
      result = result.replace(/%%/g, '%');
      return Quoted(string.q || '', result, string.esc);
    },

    _self(n) { return n; },
    '~'(...items) { return items.length === 1 ? items[0] : { t: 'value', items }; },
    extract(values, index) { return listItems(values)[index.v - 1]; },
    length(values) { return Dim(listItems(values).length); },
    range(start, end, step) {
      let from, to, by = 1;
      if (end) { to = end; from = start.v; if (step) by = step.v; } else { from = 1; to = start; }
      const items = [];
      for (let k = from; k <= to.v; k += by) items.push(Dim(k, to.u));
      return { t: 'expr', items };
    },
    each(list, rs) { return each(this.ctx, list, rs); },

    ceil: mathFn(Math.ceil, null, false),
    floor: mathFn(Math.floor, null, false),
    sqrt: mathFn(Math.sqrt, null, true),
    abs: mathFn(Math.abs, null, true),
    tan: mathFn(Math.tan, '', true),
    sin: mathFn(Math.sin, '', true),
    cos: mathFn(Math.cos, '', true),
    atan: mathFn(Math.atan, 'rad', true),
    asin: mathFn(Math.asin, 'rad', true),
    acos: mathFn(Math.acos, 'rad', true),
    round(n, f) { const frac = f ? f.v : 0; return mathFn((x) => parseFloat(x.toFixed(frac)), null, false)(n); },
    min(...args) { try { return minMax(true, args); } catch (e) { return undefined; } },
    max(...args) { try { return minMax(false, args); } catch (e) { return undefined; } },
    convert(val, unit) { return convertTo(val, String(valueOf(unit))); },
    pi() { return Dim(Math.PI); },
    mod(a, b) { return Dim(a.v % b.v, a.u); },
    pow(x, y) { if (!x || x.t !== 'dim' || !y || y.t !== 'dim') throw new LessError('arguments must be numbers'); return Dim(Math.pow(x.v, y.v), x.u); },
    percentage(n) { return mathFn((x) => x * 100, '%', false)(n); },
    unit(val, unit) {
      if (!val || val.t !== 'dim') throw new LessError('the first argument to unit must be a number' + (val && val.t === 'op' ? '. Have you forgotten parenthesis?' : ''));
      const u = unit ? (unit.t === 'kw' ? unit.s : css(unit)) : '';
      return Dim(val.v, u);
    },
    'get-unit'(n) { return Anon(unitOut(n.u)); },

    iscolor(v) { return v && v.t === 'color' ? TRUE : FALSE; },
    isnumber(v) { return v && v.t === 'dim' ? TRUE : FALSE; },
    isstring(v) { return v && v.t === 'quoted' ? TRUE : FALSE; },
    iskeyword(v) { return v && v.t === 'kw' ? TRUE : FALSE; },
    isurl(v) { return v && v.t === 'url' ? TRUE : FALSE; },
    ispixel(v) { return isUnit(v, 'px') ? TRUE : FALSE; },
    ispercentage(v) { return isUnit(v, '%') ? TRUE : FALSE; },
    isem(v) { return isUnit(v, 'em') ? TRUE : FALSE; },
    isunit(v, unit) { const u = unit && typeof valueOf(unit) === 'string' ? valueOf(unit) : css(unit); return isUnit(v, u) ? TRUE : FALSE; },
    isruleset(v) { return v && v.t === 'detached' ? TRUE : FALSE; },
    islist(v) { return v && (v.t === 'value' || v.t === 'expr') && v.items.length > 1 ? TRUE : FALSE; },
    boolean(cond) { return cond && !(cond.t === 'kw' && cond.s === 'false') ? TRUE : FALSE; },
    default() {
      const d = this.ctx && this.ctx.shared.defaultFn;
      if (d == null) return undefined;   // (outside a guard it's left as written)
      return d ? TRUE : FALSE;
    },
  });
  for (const k of Object.keys(BLEND)) FUNCTIONS[k] = blend(BLEND[k]);
  function fnIf(ctx, condition, a, b) {
    return evalCond(condition, ctx) ? evalNode(a, ctx) : (b ? evalNode(b, ctx) : Anon(''));
  }
  fnIf.evalArgs = false;
  FUNCTIONS.if = fnIf;
  function fnIsdefined(ctx, v) { try { evalNode(v, ctx); return TRUE; } catch (e) { return FALSE; } }
  fnIsdefined.evalArgs = false;
  FUNCTIONS.isdefined = fnIsdefined;

  function toHex(v) {
    return '#' + v.map((c) => { c = Math.min(Math.max(Math.round(c), 0), 255); return (c < 16 ? '0' : '') + c.toString(16); }).join('');
  }

  // each(list, { … }): the block once per item, with @value, @key and @index, as a & block of the caller's.
  function each(ctx, list, rs) {
    let items;
    if (list.t === 'detached') items = callDetached(list, ctx, 'each').rules;
    else if (list.t === 'ruleEv') items = list.rules;
    else if ((list.t === 'value' || list.t === 'expr')) items = list.items.map((x) => evalNode(x, ctx));
    else items = [list];
    let names = ['@value', '@key', '@index'];
    let body;
    if (rs.t === 'mixdef') {
      names = [0, 1, 2].map((k) => rs.params && rs.params[k] && rs.params[k].name);
      body = rs.rules;
    } else if (rs.t === 'detached') body = rs.rules;
    else throw new LessError('each() needs a ruleset to repeat');
    const out = [];
    items.forEach((item, k) => {
      if (!item || item.t === 'comment') return;
      let key, value;
      if (item.t === 'decl') { key = Anon(item.name); value = item.value; } else { key = Dim(k + 1); value = item; }
      const rules = body.slice();
      if (names[0]) rules.push(declNode(names[0], value));
      if (names[2]) rules.push(declNode(names[2], Dim(k + 1)));
      if (names[1]) rules.push(declNode(names[1], key));
      out.push({ t: 'rule', sel: '&', guard: null, rules });
    });
    return evalRuleset({ t: 'rule', sel: '&', guard: null, rules: out }, ctx);
  }

  const declNode = (name, value) => ({ t: 'decl', name, variable: name[0] === '@', value, important: '', merge: '' });

  // ---- detached rulesets, maps
  function callDetached(d, ctx, name) {
    if (!d || d.t !== 'detached') {
      if (d && d.t === 'ruleEv') return d;
      throw new LessError(`Could not evaluate variable call ${name || ''}`.trim());
    }
    const frames = d.frames ? d.frames.concat(ctx.frames) : ctx.frames;
    return evalRuleset({ t: 'rule', sel: null, guard: null, rules: d.rules }, withFrames(ctx, frames));
  }

  function evalLookup(v, ctx) {
    let rules;
    if (v.base.t === 'varcall') rules = callDetached(lookupVar(v.base.name, ctx), ctx, v.base.name);
    else if (v.base.t === 'mixcall') rules = { t: 'ruleEv', rules: evalMixinCall(v.base, ctx) };
    else rules = evalNode(v.base, ctx);
    for (let key of v.keys) {
      if (!rules || rules.t !== 'ruleEv') throw new LessError(`Can’t look up [${key}]: it isn’t a ruleset`);
      let decl = null;
      if (key === '') {
        for (let k = rules.rules.length - 1; k >= 0; k--) if (rules.rules[k] && rules.rules[k].t === 'decl') { decl = rules.rules[k]; break; }
        if (!decl) throw new LessError('No declaration found for []');
      } else if (key[0] === '@') {
        if (key[1] === '@') key = '@' + valueOf(lookupVar(key.slice(1), ctx));
        decl = frameVars(rules).get(key);
        if (!decl) throw new LessError(`variable ${key} not found`);
      } else {
        let name = key;
        if (name.startsWith('$@')) name = valueOf(lookupVar(name.slice(1), ctx));
        else if (name[0] === '$') name = name.slice(1);
        for (const r of rules.rules) if (r && r.t === 'decl' && !r.variable && r.name === name) decl = r;
        if (!decl) throw new LessError(`property "${name}" not found`);
      }
      let val = decl.value;
      if (decl.t === 'decl') val = evalNode(val, ctx);
      rules = val && val.t === 'detached' ? callDetached(val, ctx) : val;
    }
    return rules;
  }

  // ---- mixins
  function mixinElementsOf(r) {
    if (r._els !== undefined) return r._els;
    const sels = r.sels || (r.sel != null && !r.sel.includes('@{') ? splitTop(r.sel, ',') : []);
    const out = [];
    for (const s of sels) {
      const els = s.match(/[,&#*.\w-](?:[\w-]|\\.)*/g) || [];
      if (els[0] === '&') els.shift();
      if (els.length) out.push(els);
    }
    r._els = out;
    return out;
  }

  // The mixins (and rulesets) a call's path names in a scope: [{ def, via: the namespaces it's in }].
  function findMixins(frame, path) {
    const key = path.join(' ');
    if (!frame.mixins) frame.mixins = new Map();
    const cached = frame.mixins.get(key);
    if (cached) return cached;
    const out = [];
    for (const r of frame.rules) {
      if (!r) continue;
      if (r.t === 'mixdef') {
        if (r.name === path[0]) {
          if (path.length === 1) out.push({ def: r, via: [] });
          else for (const x of findMixins({ rules: r.rules }, path.slice(1))) out.push({ def: x.def, via: [r].concat(x.via) });
        }
      } else if (r.t === 'rule' || r.t === 'ruleEv') {
        for (const els of mixinElementsOf(r)) {
          if (els.length > path.length) continue;
          let ok = true;
          for (let k = 0; k < els.length; k++) if (els[k] !== path[k]) { ok = false; break; }
          if (!ok) continue;
          if (path.length > els.length) { for (const x of findMixins(r, path.slice(els.length))) out.push({ def: x.def, via: [r].concat(x.via) }); }
          else out.push({ def: r, via: [] });
          break;
        }
      }
    }
    frame.mixins.set(key, out);
    return out;
  }

  function evalMixinCall(call, ctx) {
    const args = [];
    for (const a of call.args) {
      const v = evalNode(a.value, ctx);
      if (a.expand && (v.t === 'value' || v.t === 'expr')) for (const x of v.items) args.push({ value: x });
      else args.push({ name: a.name, value: v });
    }
    let foundAny = false;
    for (const frame of ctx.frames) {
      const found = findMixins(frame, call.path);
      if (!found.length) continue;
      foundAny = true;
      const candidates = [];
      const withDefault = [];
      let argsMatched = false;
      for (const { def, via } of found) {
        if (via.some((ns) => ns.t === 'rule' && ns.guard && !evalCond(ns.guard, ctx))) continue;
        if (def.t !== 'mixdef' && ctx.frames.some((f) => f === def || f.orig === def || (def.orig && f.orig === def.orig))) continue;
        if (!matchArgs(def, args, ctx)) continue;
        argsMatched = true;
        const usesDefault = def.guard && guardUsesDefault(def.guard);
        if (usesDefault) withDefault.push(def);
        else if (matchCondition(def, args, ctx, null)) candidates.push(def);
      }
      const plain = candidates.length;
      for (const def of withDefault) if (matchCondition(def, args, ctx, plain === 0)) candidates.push(def);
      if (!argsMatched) continue;
      const out = [];
      for (const def of candidates) out.push(...evalMixinBody(def, args, ctx, call.important));
      return out;
    }
    const name = call.path.join('');
    if (foundAny) throw new LessError(`No matching definition was found for \`${name}(${args.map((a) => css(a.value)).join(', ')})\``);
    throw new LessError(`${name} is undefined`);
  }

  function guardUsesDefault(g) {
    if (!g || typeof g !== 'object') return false;
    if (g.t === 'call' && g.name.toLowerCase() === 'default') return true;
    return ['a', 'b', 'v'].some((k) => g[k] && guardUsesDefault(g[k])) || (Array.isArray(g.args) && g.args.some(guardUsesDefault)) || (Array.isArray(g.items) && g.items.some(guardUsesDefault));
  }

  function matchArgs(def, args, ctx) {
    if (def.t !== 'mixdef') return !args || args.length === 0;
    const params = def.params || [];
    const evald = new Array(params.length);
    const positional = [];
    for (const a of args) {
      if (!a.name) { positional.push(a); continue; }
      const k = params.findIndex((p, j) => p.name === a.name && !evald[j]);
      if (k < 0) return false;
      evald[k] = a;
    }
    let pi = 0;
    for (let k = 0; k < params.length; k++) {
      if (evald[k]) continue;
      if (params[k].variadic) { pi = positional.length; continue; }
      if (pi < positional.length) evald[k] = positional[pi++];
      else if (!params[k].name || !params[k].value) return false;
    }
    if (pi < positional.length) return false;
    for (let k = 0; k < params.length; k++) {
      const p = params[k];
      if (!p.name && !p.variadic) {
        if (css(evalNode(evald[k].value, ctx)) !== css(evalNode(p.value, ctx))) return false;
      }
    }
    return true;
  }

  function matchCondition(def, args, ctx, defaultValue) {
    if (def.t !== 'mixdef') {
      if (!def.guard) return true;
      return evalCond(def.guard, ctx);
    }
    if (!def.guard) return true;
    const defFrames = def.frames || [];
    const pframe = evalParams(def, ctx, withFrames(ctx, defFrames.concat(ctx.frames)), args, []);
    const sub = withFrames(ctx, [pframe].concat(defFrames, ctx.frames));
    const save = ctx.shared.defaultFn;
    ctx.shared.defaultFn = defaultValue;
    try { return evalCond(def.guard, sub); } finally { ctx.shared.defaultFn = save; }
  }

  function evalParams(def, ctx, mixinCtx, args, evald) {
    const frame = { rules: [], vars: null, mixins: null, params: true };
    const params = def.params || [];
    const sub = withFrames(mixinCtx, [frame].concat(mixinCtx.frames));
    args = args ? args.slice() : [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (!a || !a.name) continue;
      const j = params.findIndex((p, x) => !evald[x] && p.name === a.name);
      if (j < 0) throw new LessError(`Named argument for ${def.name} ${a.name} not found`);
      const v = evalNode(a.value, ctx);
      evald[j] = v;
      frame.rules.unshift(declNode(a.name, v));
      frame.vars = null;
      args.splice(k, 1);
      k--;
    }
    let ai = 0;
    for (let k = 0; k < params.length; k++) {
      if (evald[k]) continue;
      const a = args[ai];
      const p = params[k];
      if (p.name) {
        if (p.variadic) {
          const rest = args.slice(ai).map((x) => evalNode(x.value, ctx));
          frame.rules.unshift(declNode(p.name, rest.length === 1 ? rest[0] : { t: 'expr', items: rest }));
        } else {
          let v = a && a.value;
          if (v) v = evalNode(v, ctx);
          else if (p.value) { v = evalNode(p.value, sub); frame.vars = null; }
          else throw new LessError(`wrong number of arguments for ${def.name} (${args.length} for ${params.length})`);
          frame.rules.unshift(declNode(p.name, v));
          evald[k] = v;
        }
        frame.vars = null;
      }
      if (p.variadic && args.length) for (let j = ai; j < args.length; j++) evald[j] = evalNode(args[j].value, ctx);
      ai++;
    }
    return frame;
  }

  function evalMixinBody(def, args, ctx, important) {
    if (ctx.depth >= MAX_DEPTH) throw new LessError('Mixins call each other too deeply (a mixin that never stops?)');
    let frames = ctx.frames;
    if (def.t === 'mixdef' && def.frames) frames = def.frames.concat(ctx.frames);
    const evald = [];
    const pframe = evalParams(def.t === 'mixdef' ? def : { name: '', params: [] }, ctx, withFrames(ctx, frames), args, evald);
    pframe.rules.unshift(declNode('@arguments', evald.length === 1 ? evald[0] : { t: 'expr', items: evald.filter(Boolean) }));
    pframe.vars = null;
    const sub = withFrames(ctx, [pframe].concat(frames));
    sub.depth = ctx.depth + 1;
    let res = evalRuleset({ t: 'rule', sel: null, guard: null, rules: def.rules, orig: def }, sub);
    if (important) res = makeImportant(res);
    return res.rules;
  }

  function makeImportant(r) {
    if (r.t === 'decl') return r.variable ? r : { ...r, important: '!important' };
    if (r.t === 'ruleEv') return { ...r, rules: r.rules.map(makeImportant) };
    if (r.t === 'atEv') return { ...r, body: r.body ? makeImportant(r.body) : r.body };
    return r;
  }

  // ---- rulesets
  function evalRuleset(rs, ctx) {
    work(ctx);
    let sels = null;
    let passing = true;
    if (rs.sel != null) {
      if (rs.guard) passing = evalCond(rs.guard, ctx);
      const text = rs.sel.includes('@{') || rs.sel.includes('${') ? normalizeSelector(interpolate(rs.sel, ctx)) : rs.sel;
      sels = splitTop(text, ',');
    }
    const out = { t: 'ruleEv', sels, rules: passing ? rs.rules.slice() : [], orig: rs.orig || rs, vars: null, mixins: null, guard: null };
    ctx.frames.unshift(out);
    try {
      const R = out.rules;
      for (let k = 0; k < R.length; k++) {
        const r = R[k];
        if (r.t === 'import' && r.imported) {
          R.splice(k, 1, ...r.imported);   // (and what it imports in turn, looked at next)
          k--;
          resetFrame(out);
        }
      }
      for (let k = 0; k < R.length; k++) if (R[k].t === 'mixdef' && !R[k].frames) R[k] = { ...R[k], frames: ctx.frames.slice() };
      for (let k = 0; k < R.length; k++) {
        const r = R[k];
        if (r.t === 'mixcall') {
          let res;
          try { res = evalMixinCall(r, ctx); } catch (e) { throw located(e, r); }
          res = res.filter((x) => !(x.t === 'decl' && x.variable && frameVars(out).has(x.name)));
          R.splice(k, 1, ...res);
          k += res.length - 1;
          resetFrame(out);
        } else if (r.t === 'varcall') {
          const res = callDetached(lookupVar(r.name, ctx), ctx, r.name).rules.filter((x) => !(x.t === 'decl' && x.variable));
          R.splice(k, 1, ...res);
          k += res.length - 1;
          resetFrame(out);
        }
      }
      for (let k = 0; k < R.length; k++) {
        const r = R[k];
        if (r.t === 'mixdef') continue;
        R[k] = evalRule(r, ctx);
        if (r.t === 'rule') out.mixins = null;   // (what's found in it is now the evaluated one)
      }
      for (let k = 0; k < R.length; k++) {
        const r = R[k];
        if (r.t === 'ruleEv' && r.sels && r.sels.length === 1 && r.sels[0] === '&') {
          const inner = r.rules.filter((x) => !(x.t === 'decl' && x.variable));
          R.splice(k, 1, ...inner);
          k += inner.length - 1;
        }
      }
    } finally {
      ctx.frames.shift();
    }
    return out;
  }

  // Errors say where in the style they happened (the innermost statement that has a place).
  function located(e, r) {
    if (e instanceof LessError && e.line == null && r && r.src && typeof r.pos === 'number') {
      const before = r.src.text.slice(0, r.pos);
      e.line = before.split('\n').length;
      e.column = r.pos - before.lastIndexOf('\n');
      e.file = r.src.file || '';
    }
    return e;
  }

  function evalRule(r, ctx) {
    try { return evalRuleAt(r, ctx); } catch (e) { throw located(e, r); }
  }
  function evalRuleAt(r, ctx) {
    switch (r.t) {
      case 'decl': return evalDecl(r, ctx);
      case 'rule': return evalRuleset(r, ctx);
      case 'at': return evalAt(r, ctx);
      case 'callstmt': {
        const v = evalNode(r.call, ctx);
        return v && v.t === 'ruleEv' ? v : { t: 'nothing' };
      }
      case 'import': return { t: 'importEv', text: importText(r, ctx) };
      default: return r;
    }
  }

  function importText(r, ctx) {
    const path = css(evalNode(r.path, ctx));
    const media = r.media ? ' ' + interpolate(r.media, ctx, { bare: true }) : '';
    return `@import ${path}${media};`;
  }

  function evalDecl(d, ctx) {
    const name = d.interp ? interpolate(d.name, ctx) : d.name;
    if (d.variable && d.value.t === 'detached') return { ...d, name, value: { t: 'detached', rules: d.value.rules, frames: ctx.frames.slice() } };
    if (d.variable && d.value.t === 'mixdef') return { ...d, name };
    ctx.importantScope.push({});
    let v;
    let scope;
    try { v = evalNode(d.value, ctx); } finally { scope = ctx.importantScope.pop(); }
    const important = d.important || (scope && scope.important) || '';
    if (!d.variable && (v.t === 'detached' || v.t === 'ruleEv')) throw new LessError('Rulesets cannot be evaluated on a property.');
    return { t: 'decl', name, variable: d.variable && !d.interp, value: v, important, merge: d.merge || '' };
  }

  // @media's (and @container's) queries, with LESS in them evaluated: variables, ~"…", the values of features
  // (min-width: @bp - 1px), whitespace as less.js writes it.
  function evalQueries(text, ctx) {
    text = interpolate(text, ctx);
    let out = '';
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (c === '(') {
        let depth = 0, j = k;
        for (; j < text.length; j++) {
          const d = text[j];
          if (d === '"' || d === "'") { let e = j + 1; for (; e < text.length && text[e] !== d; e++) if (text[e] === '\\') e++; j = e; continue; }
          if (d === '(') depth++;
          else if (d === ')' && --depth === 0) break;
        }
        if (/(^|[\s(])(and|or|not|only)$/i.test(out)) out += ' ';
        out += '(' + evalFeature(text.slice(k + 1, j), ctx) + ')';
        k = j;
        continue;
      }
      if (c === '~' && (text[k + 1] === '"' || text[k + 1] === "'")) {
        const q = text[k + 1];
        let e = k + 2;
        for (; e < text.length && text[e] !== q; e++) if (text[e] === '\\') e++;
        out += text.slice(k + 2, e);
        k = e;
        continue;
      }
      if (c === '@' && /[\w-]/.test(text[k + 1] || '')) {
        const m = /^@@?[\w-]+/.exec(text.slice(k));
        out += css(lookupVar(m[0], ctx));
        k += m[0].length - 1;
        continue;
      }
      out += c;
    }
    return normalizeSelector(out);
  }
  function evalFeature(inner, ctx) {
    const m = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(inner);
    if (!m) return normalizeSelector(inner).replace(/^\(\s*|\s*\)$/g, (x) => x.trim());
    let value = m[2];
    try {
      const v = parseValueText(value);
      if (v) value = css(evalNode(v, ctx));
    } catch (e) {
      value = interpolate(value, ctx, { bare: true });
    }
    return m[1] + ': ' + value;
  }

  function evalAt(a, ctx) {
    let prelude = '';
    if (a.kind === 'media') prelude = a.prelude ? evalQueries(a.prelude, ctx) : '';
    else if (a.preludeNode === undefined) prelude = a.prelude ? normalizeSelector(interpolate(a.prelude, ctx, { bare: true })) : '';
    else if (a.preludeNode) prelude = normalizeSelector(css(evalNode(a.preludeNode, ctx)));
    const body = a.rules ? evalRuleset({ t: 'rule', sel: null, guard: null, rules: a.rules }, ctx) : null;
    return { t: 'atEv', name: a.name, kind: a.kind, prelude, body };
  }

  // ------------------------------------------------------------------ CSS out
  function numCSS(x) {
    const v = fround(x);
    let s = String(v);
    if (v !== 0 && v < 0.000001 && v > -0.000001) s = v.toFixed(20).replace(/0+$/, '');
    return s;
  }
  function colorCSS(c) {
    const alpha = fround(c.a);
    let fn = '';
    if (c.orig) {
      if (c.orig.startsWith('rgb')) { if (alpha < 1) fn = 'rgba'; }
      else if (c.orig.startsWith('hsl')) fn = alpha < 1 ? 'hsla' : 'hsl';
      else return c.orig;
    } else if (alpha < 1) fn = 'rgba';
    const cl = (x, m) => Math.min(Math.max(x, 0), m);
    if (fn === 'rgba') return `rgba(${c.rgb.map((x) => cl(Math.round(x), 255)).join(', ')}, ${cl(alpha, 1)})`;
    if (fn) {
      const h = toHSL(c);
      const args = [fround(h.h), fround(h.s * 100) + '%', fround(h.l * 100) + '%'];
      if (fn === 'hsla') args.push(cl(alpha, 1));
      return `${fn}(${args.join(', ')})`;
    }
    return toHex(c.rgb);
  }

  function css(v) {
    switch (v.t) {
      case 'value': return v.items.map(css).join(', ');
      case 'expr': {
        let s = '';
        for (let k = 0; k < v.items.length; k++) {
          s += css(v.items[k]);
          if (!v.noSpacing && k + 1 < v.items.length) {
            const nx = v.items[k + 1];
            if (!(nx.t === 'anon' && nx.s === ',')) s += ' ';
          }
        }
        return s;
      }
      case 'dim': return numCSS(v.v) + unitOut(v.u);
      case 'color': return colorCSS(v);
      case 'quoted': return v.esc ? v.s : v.q + v.s + v.q;
      case 'kw': case 'anon': case 'raw': return v.s;
      case 'call': return v.name + '(' + v.args.map(css).join(', ') + ')';
      case 'url': return 'url(' + css(v.v) + ')';
      case 'op': return css(v.a) + (v.spaced ? ' ' + v.op + ' ' : v.op) + css(v.b);
      case 'paren': return '(' + css(v.v) + ')';
      case 'neg': return '-' + css(v.v);
      case 'assign': return v.key + '=' + css(v.v);
      case 'detached': case 'ruleEv': throw new LessError('Rulesets cannot be evaluated on a property.');
      case 'mixdef': return '';
      default: return '';
    }
  }

  // &: the parent selectors in its place; none: the parent's, then a space.
  function hasAmp(s) {
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (c === '"' || c === "'") { let j = k + 1; for (; j < s.length && s[j] !== c; j++) if (s[j] === '\\') j++; k = j; continue; }
      if (c === '&') return true;
    }
    return false;
  }
  function splitAmp(s) {
    const parts = [];
    let from = 0;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (c === '"' || c === "'") { let j = k + 1; for (; j < s.length && s[j] !== c; j++) if (s[j] === '\\') j++; k = j; continue; }
      if (c === '&') { parts.push(s.slice(from, k)); from = k + 1; }
    }
    parts.push(s.slice(from));
    return parts;
  }
  function joinSelectors(parents, sels) {
    const out = [];
    for (const s of sels) {
      if (hasAmp(s)) {
        const parts = splitAmp(s);
        if (!parents || !parents.length) { out.push(normalizeSelector(parts.join(''))); continue; }
        let acc = [parts[0]];
        for (let k = 1; k < parts.length; k++) {
          const next = [];
          for (const a of acc) for (const p of parents) next.push(a + p + parts[k]);
          acc = next;
        }
        for (const x of acc) out.push(normalizeSelector(x));
      } else if (parents && parents.length) {
        for (const p of parents) out.push(p + ' ' + s);
      } else out.push(s);
    }
    return out;
  }

  function declCSS(d) {
    let value = css(d.value);
    if (d.important) value += (value ? ' ' : '') + d.important;
    return d.name + ': ' + value;
  }

  // The evaluated tree as blocks: rules (selectors + declarations), at-rules (with blocks inside), statements.
  function flatten(root) {
    const top = [];
    emitRuleset(root, null, top, null, true);
    return top;
  }
  function emitRuleset(rs, parents, container, media, isRoot) {
    const paths = rs.sels ? joinSelectors(parents, rs.sels) : parents;
    const block = { k: 'rule', sels: paths, decls: [] };
    if (!isRoot) container.push(block);
    for (const r of rs.rules) {
      if (!r) continue;
      switch (r.t) {
        case 'decl':
          if (r.variable) break;
          if (paths && paths.length && !isRoot) block.decls.push(r);
          else container.push({ k: 'decl', d: r });
          break;
        case 'ruleEv': emitRuleset(r, paths, container, media, false); break;
        case 'atEv': emitAt(r, paths, container, media); break;
        case 'importEv': {
          let k = 0;
          while (k < container.length && container[k].k === 'import') k++;
          container.splice(k, 0, { k: 'import', text: r.text });
          break;
        }
        default: break;
      }
    }
  }
  function emitAt(a, paths, container, media) {
    if (a.kind === 'stmt') { container.push({ k: 'stmt', text: `${a.name}${a.prelude ? ' ' + a.prelude : ''};` }); return; }
    if (a.kind === 'media') {
      const kind = a.name.toLowerCase();
      const queries = splitTop(a.prelude, ',');
      let combined = queries;
      let target = container;
      if (media && media.kind === kind) {
        // (a, b) with (c, d) inside: a and c, b and c, a and d, b and d; a media type first (screen and (…))
        combined = [];
        for (const q of queries.length ? queries : ['']) {
          for (const outer of media.queries) {
            const parts = [outer, q].filter(Boolean);
            const types = parts.filter(startsWithMediaType);
            const ordered = types.length && types.length < parts.length ? types.concat(parts.filter((x) => !startsWithMediaType(x))) : parts;
            combined.push(ordered.join(' and '));
          }
        }
        target = media.out;
      }
      const block = { k: 'at', head: `${a.name} ${combined.join(', ')}`.trim(), body: [] };
      target.push(block);
      if (a.body) emitRuleset({ ...a.body, sels: null }, paths, block.body, { kind, queries: combined, out: target }, !paths || !paths.length);
      return;
    }
    const block = { k: 'at', head: `${a.name}${a.prelude ? ' ' + a.prelude : ''}`, body: [] };
    container.push(block);
    if (!a.body) return;
    if (a.kind === 'rooted') emitRuleset({ ...a.body, sels: null }, null, block.body, null, true);
    else emitRuleset({ ...a.body, sels: null }, paths, block.body, null, !paths || !paths.length);
  }

  function startsWithMediaType(q) {
    const words = String(q).trim().split(/\s+/);
    let w = words[0] || '';
    if (/^(not|only)$/i.test(w)) w = words[1] || '';
    const first = w.split('(')[0];
    return first !== '' && !/^(and|or)$/i.test(first);
  }

  function serialize(items, indent) {
    const pad = indent || '';
    let out = '';
    for (const it of items) {
      if (it.k === 'rule') {
        if (!it.decls.length || !it.sels || !it.sels.length) continue;
        out += pad + it.sels.join(',\n' + pad) + ' {\n' + mergeDecls(it.decls).map((d) => pad + '  ' + declCSS(d) + ';\n').join('') + pad + '}\n';
      } else if (it.k === 'decl') {
        out += pad + declCSS(it.d) + ';\n';
      } else if (it.k === 'at') {
        const inner = serialize(it.body, pad + '  ');
        if (inner.trim()) out += pad + it.head + ' {\n' + inner + pad + '}\n';
      } else if (it.k === 'import' || it.k === 'stmt') {
        out += pad + it.text + '\n';
      }
    }
    return out;
  }

  // property+: a, b (or +_: a b) put together, where they were first.
  function mergeDecls(decls) {
    if (!decls.some((d) => d.merge)) return decls;
    const out = [];
    const groups = new Map();
    for (const d of decls) {
      if (!d.merge) { out.push(d); continue; }
      const g = groups.get(d.name);
      if (!g) { const first = { ...d, parts: [d] }; groups.set(d.name, first); out.push(first); }
      else g.parts.push(d);
    }
    return out.map((d) => {
      if (!d.parts) return d;
      const items = [];
      let cur = [];
      for (const p of d.parts) {
        if (p.merge === '+' && cur.length) { items.push(cur); cur = []; }
        cur.push(p.value);
      }
      if (cur.length) items.push(cur);
      const value = { t: 'value', items: items.map((g) => (g.length === 1 ? g[0] : { t: 'expr', items: g })) };
      return { t: 'decl', name: d.name, value, important: d.parts.some((p) => p.important) ? '!important' : '', merge: '' };
    });
  }

  // ------------------------------------------------------------------ imports, render
  function isCssImport(node, path) {
    if (node.opts.less) return false;
    if (node.opts.css || node.opts.inline) return true;
    return /[#.&?]css([?;].*)?$/.test(path);
  }

  function importPath(node) {
    const p = node.path;
    if (p.t === 'quoted') return p.s;
    if (p.t === 'url') return p.v.t === 'quoted' || p.v.t === 'anon' ? p.v.s : null;
    return null;
  }

  function resolveUrl(path, base) {
    try { return new URL(path, base || undefined).href; } catch (e) { return path; }
  }

  async function resolveImports(rules, opts, base, seen, depth) {
    for (const r of rules) {
      if (!r || typeof r !== 'object') continue;
      if (r.t === 'import') {
        const path = importPath(r);
        if (path != null && isCssImport(r, path)) continue;
        if (path == null || path.includes('@{')) throw new LessError('An @import made from variables isn’t supported');
        if (depth > 20) throw new LessError('@imports nest too deeply');
        let full = resolveUrl(path, base);
        if (!/\.[a-z0-9]+([?#].*)?$/i.test(full)) full += '.less';
        if (!r.opts.multiple && seen.has(full)) { r.imported = []; continue; }
        seen.add(full);
        if (typeof opts.load !== 'function') throw new LessError(`Can’t load ${full}`);
        let text;
        try { text = await opts.load(full); } catch (e) {
          if (r.opts.optional) { r.imported = []; continue; }
          throw new LessError(`Couldn’t load ${full}${e && e.message ? ': ' + e.message : ''}`);
        }
        const sub = parse(text, full);
        await resolveImports(sub.rules, opts, full, seen, depth + 1);
        r.imported = r.opts.reference ? sub.rules.filter((x) => x.t === 'decl' || x.t === 'mixdef' || x.t === 'rule' || x.t === 'import') : sub.rules;
        if (r.opts.reference) r.imported = r.imported.map((x) => (x.t === 'rule' ? { ...x, reference: true } : x));
        continue;
      }
      for (const k of ['rules']) if (Array.isArray(r[k])) await resolveImports(r[k], opts, base, seen, depth);
      if (r.value && r.value.t === 'detached') await resolveImports(r.value.rules, opts, base, seen, depth);
    }
  }

  function compileTree(tree) {
    const ctx = freshCtx();
    const ev = evalRuleset({ t: 'rule', sel: null, guard: null, rules: tree.rules }, ctx);
    return serialize(flatten(ev));
  }

  async function render(source, opts) {
    opts = opts || {};
    const tree = parse(source, opts.file || '');
    await resolveImports(tree.rules, opts, opts.file || '', new Set(), 0);
    return compileTree(tree);
  }

  return { render, parse, LessError, _internal: { compileTree, resolveImports, css, evalNode } };
});
