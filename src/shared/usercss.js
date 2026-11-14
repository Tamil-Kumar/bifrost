/* Bifrost — userstyles, as Stylus has them (usercss): a style's header (its name, version, update address and
   variables), its parts and the pages each is for (@-moz-document), matching a page, and a Stylus backup
   read in. Shared by the main process (main/web-styles.js), Settings and the tests.

   A usercss style:
     /* ==UserStyle==
     @name        Example dark
     @namespace   example
     @version     1.0.0
     @preprocessor default        (or uso, or less: built by the LESS compiler, src/shared/less.js; stylus
                                   isn't here)
     @var color bg "Background" #1e1e2e
     ==/UserStyle== *\/
     @-moz-document domain("example.com"), url-prefix("https://example.org/docs/") { body { background: var(--bg); } }
   Code outside any @-moz-document is for every page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBUsercss = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HEADER = /\/\*\s*==UserStyle==([\s\S]*?)==\/UserStyle==\s*\*\//i;

  // A CSS string's escapes: \41 (hex, up to 6 digits, then one optional space), \<newline> (nothing), \x (x).
  function unescapeCss(s) {
    return String(s).replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/g, (m, hex, nl, ch) => {
      if (hex) { const n = parseInt(hex, 16); return n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '�' : String.fromCodePoint(n); }
      if (nl) return '';
      return ch;
    });
  }

  // ------------------------------------------------------------------ the header
  // Reads `text` from i: a quoted string ("…" or '…', with \ escapes) or a run of non-space characters.
  function readWord(text, i) {
    while (i < text.length && /[ \t]/.test(text[i])) i++;
    const q = text[i];
    if (q === '"' || q === "'") {
      let out = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== q; j++) {
        if (text[j] === '\\' && j + 1 < text.length) { j++; out += text[j]; } else out += text[j];
      }
      return { value: out, end: Math.min(j + 1, text.length) };
    }
    let j = i;
    while (j < text.length && !/\s/.test(text[j])) j++;
    return { value: text.slice(i, j), end: j };
  }

  // A JSON-like array or object from i, which can run over several lines: its text and where it ends.
  function readBlock(text, i) {
    const open = text[i];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let q = null;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) return { value: text.slice(i, j + 1), end: j + 1 };
    }
    return { value: text.slice(i), end: text.length };
  }

  const loose = (s) => { try { return JSON.parse(s); } catch { try { return JSON.parse(s.replace(/'/g, '"').replace(/,\s*([\]}])/g, '$1')); } catch { return null; } } };

  // @var select name "Label" ["a:Option A*", "b:Option B"]  (or { "Option A*": "a", … }); * marks the default.
  function selectOptions(raw) {
    const data = loose(raw);
    const options = [];
    let def = null;
    const add = (name, label, value) => {
      let star = false;
      if (/\*$/.test(label)) { star = true; label = label.slice(0, -1); }
      if (/\*$/.test(name)) { star = true; name = name.slice(0, -1); }
      options.push({ name, label, value });
      if (star && def == null) def = name;
    };
    if (Array.isArray(data)) {
      for (const item of data) {
        const s = String(item);
        const k = s.indexOf(':');
        const name = k >= 0 ? s.slice(0, k) : s;
        const label = k >= 0 ? s.slice(k + 1) : s;
        add(name, label, name.replace(/\*$/, ''));
      }
    } else if (data && typeof data === 'object') {
      for (const [label, value] of Object.entries(data)) {
        const name = label.replace(/\*$/, '');
        add(label, label, String(value));
        options[options.length - 1].name = name;
      }
    }
    for (const o of options) if (o.value === undefined || o.value === o.name + '*') o.value = o.name;
    return { options, default: def != null ? def : options.length ? options[0].name : '' };
  }

  // The header: { meta: { name, namespace, version, description, author, homepageURL, updateURL, supportURL,
  // license, preprocessor }, vars: [{ type, name, label, default, options?, min?, max?, step?, unit? }] }.
  function parseHeader(code) {
    const m = HEADER.exec(String(code || ''));
    if (!m) return null;
    const text = m[1];
    const meta = {};
    const vars = [];
    const re = /(^|\n)[ \t]*@([\w-]+)/g;
    let hit;
    let resumeAt = 0;
    while ((hit = re.exec(text))) {
      if (hit.index < resumeAt) continue;
      const key = hit[2];
      let i = hit.index + hit[0].length;
      if (key === 'var' || key === 'advanced') {
        const type = readWord(text, i); i = type.end;
        const name = readWord(text, i); i = name.end;
        const label = readWord(text, i); i = label.end;
        while (i < text.length && /[ \t]/.test(text[i])) i++;
        let raw;
        if (text[i] === '[' || text[i] === '{') { const b = readBlock(text, i); raw = b.value; i = b.end; }
        else { const e = text.indexOf('\n', i); raw = text.slice(i, e < 0 ? text.length : e).trim(); i = e < 0 ? text.length : e; }
        resumeAt = i;
        re.lastIndex = i;
        if (key === 'advanced') { vars.push({ type: 'unsupported', name: name.value, label: label.value, default: '' }); continue; }
        const v = { type: type.value, name: name.value, label: label.value || name.value, default: '' };
        if (v.type === 'select' || v.type === 'dropdown' || v.type === 'image') {
          const o = selectOptions(raw);
          v.type = 'select';
          v.options = o.options;
          v.default = o.default;
        } else if (v.type === 'checkbox') {
          v.default = /^(1|true)$/i.test(raw.trim()) ? '1' : '0';
        } else if (v.type === 'number' || v.type === 'range') {
          const a = loose(raw);
          if (Array.isArray(a)) {
            v.default = a[0] != null ? String(a[0]) : '0';
            if (a[1] != null) v.min = Number(a[1]);
            if (a[2] != null) v.max = Number(a[2]);
            if (a[3] != null) v.step = Number(a[3]);
            if (typeof a[4] === 'string') v.unit = a[4];
            else if (typeof a[1] === 'string' && a.length === 2) v.unit = a[1];
          } else v.default = String(raw).trim();
        } else {
          let s = raw;
          if (/^(['"]).*\1$/.test(s)) s = s.slice(1, -1);
          v.default = s;
        }
        vars.push(v);
      } else {
        const e = text.indexOf('\n', i);
        meta[key] = text.slice(i, e < 0 ? text.length : e).trim();
      }
    }
    return { meta, vars };
  }

  // A variable's value as the style's code gets it: a select's option value, a number with its unit.
  function varValue(v, values) {
    const chosen = values && Object.prototype.hasOwnProperty.call(values, v.name) && values[v.name] != null ? String(values[v.name]) : v.default;
    if (v.type === 'select') {
      const o = (v.options || []).find((x) => x.name === chosen) || (v.options || []).find((x) => x.name === v.default);
      return o ? o.value : chosen;
    }
    if ((v.type === 'number' || v.type === 'range') && v.unit && chosen !== '' && !/[a-z%]$/i.test(chosen)) return chosen + v.unit;
    return chosen;
  }

  // ------------------------------------------------------------------ sections
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

  // Skips a comment or string that starts at i; the index after it (or i, when there's none).
  function skip(css, i) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); return e < 0 ? css.length : e + 2; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (; j < css.length && css[j] !== c; j++) { if (css[j] === '\\') j++; else if (css[j] === '\n') break; }
      return j + 1;
    }
    return i;
  }

  // @-moz-document's list: url(…), url-prefix(…), domain(…), regexp(…), each quoted or (url only) not.
  function parseMatchers(prelude) {
    const out = { urls: [], urlPrefixes: [], domains: [], regexps: [] };
    const text = prelude.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const re = /(url-prefix|url|domain|regexp)\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)]*?))\s*\)/gi;
    let m;
    while ((m = re.exec(text))) {
      const fn = m[1].toLowerCase();
      const value = m[2] != null ? unescapeCss(m[2]) : m[3] != null ? unescapeCss(m[3]) : String(m[4] || '').trim();
      if (fn === 'url') out.urls.push(value);
      else if (fn === 'url-prefix') out.urlPrefixes.push(value);
      else if (fn === 'domain') out.domains.push(value.toLowerCase());
      else out.regexps.push(value);
    }
    return out;
  }

  // Splits CSS into its parts: [{ code, urls, urlPrefixes, domains, regexps }]. What's outside any
  // @-moz-document is one part with no matchers (every page); a part that names no page is left out.
  function sections(css) {
    css = String(css || '');
    const out = [];
    let global = '';
    let from = 0;
    let depth = 0;
    for (let i = 0; i < css.length;) {
      const j = skip(css, i);
      if (j !== i) { i = j; continue; }
      const c = css[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') { depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0 && c === '@') {
        const m = /^@(-moz-)?document\b/i.exec(css.slice(i, i + 16));
        if (m) {
          global += css.slice(from, i);
          // The list, up to the block's {.
          let k = i + m[0].length;
          while (k < css.length && css[k] !== '{') { const s = skip(css, k); k = s !== k ? s : k + 1; }
          const matchers = parseMatchers(css.slice(i + m[0].length, k));
          // The block, to its }.
          let d = 0;
          let e = k;
          for (; e < css.length; ) {
            const s = skip(css, e);
            if (s !== e) { e = s; continue; }
            if (css[e] === '{') d++;
            else if (css[e] === '}' && --d === 0) break;
            e++;
          }
          const code = css.slice(k + 1, e).trim();
          if (code && (matchers.urls.length || matchers.urlPrefixes.length || matchers.domains.length || matchers.regexps.length)) out.push({ code, ...matchers });
          i = from = Math.min(e + 1, css.length);
          continue;
        }
      }
      i++;
    }
    global += css.slice(from);
    const g = global.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (g) out.unshift({ code: global.trim(), urls: [], urlPrefixes: [], domains: [], regexps: [] });
    return out;
  }

  const isGlobal = (s) => !(s.urls && s.urls.length) && !(s.urlPrefixes && s.urlPrefixes.length) && !(s.domains && s.domains.length) && !(s.regexps && s.regexps.length);

  const regexCache = new Map();
  function anchored(src) {
    if (regexCache.has(src)) return regexCache.get(src);
    let re = null;
    try { re = new RegExp('^(?:' + src + ')$'); } catch { re = null; }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(src, re);
    return re;
  }

  // Whether a part is for a page (a regexp has to match the whole address, as in Firefox).
  function sectionMatches(s, url) {
    if (isGlobal(s)) return true;
    const href = String(url || '');
    const noHash = href.replace(/#.*$/, '');
    let host = '';
    try { host = new URL(href).hostname.toLowerCase(); } catch { host = ''; }
    for (const u of s.urls || []) if (u === href || u === noHash) return true;
    for (const p of s.urlPrefixes || []) if (href.startsWith(p)) return true;
    for (const d of s.domains || []) if (host && (host === d || host.endsWith('.' + d))) return true;
    for (const r of s.regexps || []) { const re = anchored(r); if (re && (re.test(href) || re.test(noHash))) return true; }
    return false;
  }

  // Pages a style is for, to show: its domains and the starts of its addresses.
  function sitesOf(secs) {
    const out = new Set();
    for (const s of secs || []) {
      if (isGlobal(s)) { out.add('every site'); continue; }
      for (const d of s.domains || []) out.add(d);
      for (const u of [...(s.urlPrefixes || []), ...(s.urls || [])]) { try { out.add(new URL(u).hostname || u); } catch { if (u) out.add(u); else out.add('every site'); } }
      for (const r of s.regexps || []) {
        const m = /(?:[a-z0-9-]+\.)+[a-z]{2,}/i.exec(r.replace(/\\([./])/g, '$1'));
        out.add(m ? m[0].toLowerCase() : 'pages matching a pattern');
      }
    }
    return [...out];
  }

  // ------------------------------------------------------------------ a whole style
  // usercss code -> { meta, vars, sections }, the variables given values (values: { name: chosen }).
  // Throws for what can't be done here: no header, or a preprocessor Bifrost doesn't have. LESS takes buildAsync.
  function build(code, values) {
    const head = parseHeader(code);
    if (!head) throw new Error('This isn’t a userstyle: it has no ==UserStyle== header.');
    if (!head.meta.name) throw new Error('The style has no @name.');
    const pre = String(head.meta.preprocessor || 'default').toLowerCase();
    let body = String(code).replace(HEADER, '');
    const vars = head.vars.filter((v) => v.type !== 'unsupported');
    if (pre === 'uso') {
      for (const v of vars) body = body.split(`/*[[${v.name}]]*/`).join(varValue(v, values));
    } else if (pre === 'less' || pre === 'stylus') {
      const e = new Error(pre === 'less' ? 'This style is written in LESS: it’s built off the main thread.' : 'This style is written in Stylus’s own language (not LESS), which Bifrost can’t turn into CSS.');
      e.code = 'preprocessor';
      e.preprocessor = pre;
      throw e;
    } else if (pre !== 'default') {
      throw new Error(`This style needs the "${pre}" preprocessor, which Bifrost doesn’t have.`);
    }
    let secs = sections(body);
    if (pre === 'default' && vars.length) {
      const root = ':root {\n' + vars.map((v) => `  --${v.name}: ${varValue(v, values)};`).join('\n') + '\n}\n';
      secs = secs.map((s) => ({ ...s, code: root + s.code }));
    }
    return { meta: head.meta, vars, sections: secs };
  }

  // What LESS gets for a style's variables, before its code, as Stylus gives it: @name:value; each.
  function lessVariables(vars, values) {
    return (vars || []).filter((v) => v.type !== 'unsupported').map((v) => `@${v.name}:${varValue(v, values)};\n`).join('');
  }

  // build(), for LESS too: options.less is the compiler (src/shared/less.js), options.load(url) -> the text of a
  // file its @import names. A LESS error says where it is in the style's own code.
  async function buildAsync(code, values, options) {
    const head = parseHeader(code);
    if (!head) throw new Error('This isn’t a userstyle: it has no ==UserStyle== header.');
    if (!head.meta.name) throw new Error('The style has no @name.');
    const pre = String(head.meta.preprocessor || 'default').toLowerCase();
    if (pre !== 'less') return build(code, values);
    const less = options && options.less;
    if (!less) { const e = new Error('There’s no LESS compiler here.'); e.code = 'preprocessor'; throw e; }
    const vars = head.vars.filter((v) => v.type !== 'unsupported');
    const defs = lessVariables(vars, values);
    let css;
    try {
      css = await less.render(defs + String(code), { load: options.load, file: '' });
    } catch (e) {
      const own = !e.file;
      const line = e.line != null && own ? e.line - (defs.match(/\n/g) || []).length : e.line;
      const where = line != null && line > 0 ? ` (line ${line}${e.file ? ' of ' + e.file : ''})` : '';
      const err = new Error(`LESS: ${String(e.message || e).replace(/\.$/, '')}${where}.`);
      err.code = 'less';
      throw err;
    }
    return { meta: head.meta, vars, sections: sections(css) };
  }

  // A Stylus backup (Stylus → Backup → Export: a JSON array of its styles, each with the CSS it built) -> styles.
  // Also the files made for importing into Stylus, like Catppuccin's import.json: styles with their code but no
  // CSS yet (sections: null, needsBuild: they're built from their code as Stylus does when it imports them).
  function fromStylusBackup(data) {
    // (one style, as Stylus's cloud sync keeps it: { _rev, doc })
    if (data && !Array.isArray(data) && typeof data === 'object' && data.doc && data._rev && data._rev === data.doc._rev) data = [data.doc];
    const list = Array.isArray(data) ? data : [];
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      // The CSS Stylus built, when the file has it. Stylus 2 leaves it out of its backups for a usercss style
      // (sections: [{ code: '' }], for older Stylus's sake; Shift+click on Export keeps it), as a file made for
      // importing into Stylus has none: such a style is built from its code here, with the options you chose.
      const built = Array.isArray(s.sections) && s.sections.some((x) => x && typeof x.code === 'string' && x.code.trim());
      if (!built && !(typeof s.sourceCode === 'string' && HEADER.test(s.sourceCode))) continue;
      const ud = s.usercssData && typeof s.usercssData === 'object' ? s.usercssData : null;
      const values = {};
      const vars = [];
      if (ud && ud.vars && typeof ud.vars === 'object') {
        for (const v of Object.values(ud.vars)) {
          if (!v || !v.name) continue;
          const def = v.default != null ? String(v.default) : '';
          vars.push({ type: v.type === 'dropdown' || v.type === 'image' ? 'select' : v.type, name: v.name, label: v.label || v.name, default: def, options: Array.isArray(v.options) ? v.options.map((o) => ({ name: String(o.name), label: String(o.label || o.name), value: String(o.value != null ? o.value : o.name) })) : undefined, min: v.min, max: v.max, step: v.step, unit: v.units || v.unit });
          if (v.value != null) values[v.name] = String(v.value);
        }
      }
      const secs = !built ? null : s.sections.map((x) => ({
        code: String((x && x.code) || ''),
        urls: Array.isArray(x && x.urls) ? x.urls.map(String) : [],
        urlPrefixes: Array.isArray(x && x.urlPrefixes) ? x.urlPrefixes.map(String) : [],
        domains: Array.isArray(x && x.domains) ? x.domains.map((d) => String(d).toLowerCase()) : [],
        regexps: Array.isArray(x && x.regexps) ? x.regexps.map(String) : [],
      })).filter((x) => x.code.trim());
      const name = String(s.customName || s.name || (ud && ud.name) || (!built && (parseHeader(s.sourceCode) || { meta: {} }).meta.name) || 'A style from Stylus');
      out.push({
        name,
        enabled: s.enabled !== false,
        code: typeof s.sourceCode === 'string' ? s.sourceCode : '',
        meta: ud ? { name: ud.name || name, namespace: ud.namespace || '', version: ud.version || '', description: ud.description || s.description || '', author: ud.author || s.author || '', homepageURL: ud.homepageURL || s.url || '', updateURL: ud.updateURL || s.updateUrl || '', preprocessor: ud.preprocessor || 'default' } : { name, description: s.description || '', updateURL: s.updateUrl || '' },
        vars,
        values,
        sections: secs,
        needsBuild: !built,
        exclusions: Array.isArray(s.exclusions) ? s.exclusions.map(String) : s.exclusions && typeof s.exclusions === 'object' ? Object.keys(s.exclusions) : [],
      });
    }
    return out;
  }

  // Stylus's exclusions: address patterns with * for anything ("*://example.com/*").
  function excluded(patterns, url) {
    for (const p of patterns || []) {
      const re = anchored(String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
      if (re && re.test(String(url || ''))) return true;
    }
    return false;
  }

  // A new style to start from.
  function template(host) {
    const site = host || 'example.com';
    return `/* ==UserStyle==\n@name        ${site} — my style\n@namespace   bifrost\n@version     1.0.0\n==/UserStyle== */\n\n@-moz-document domain("${site}") {\n  body {\n  }\n}\n`;
  }

  return { unescapeCss, parseHeader, varValue, sections, sectionMatches, isGlobal, sitesOf, build, buildAsync, lessVariables, fromStylusBackup, excluded, template };
});
