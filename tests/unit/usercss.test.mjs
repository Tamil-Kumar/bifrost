// Userstyles (src/shared/usercss.js): a style's header and variables, its parts and the pages each is for
// (@-moz-document, with comments, strings and nested blocks in the way), matching pages as Firefox and Stylus
// do, variables filled in (default: CSS custom properties; uso: placeholders), what can't be built here, and a
// Stylus backup read in.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = require(ROOT + '/src/shared/usercss.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.code || e.message; } };

// ---- the header
const header = `/* ==UserStyle==
@name GitHub Catppuccin
@namespace github.com/catppuccin/userstyles/styles/github
@version 2026.08.16
@updateURL https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less
@description Soothing pastel theme for GitHub, with an @ in it
@preprocessor less
@var select lightFlavor "Light Flavor" ["latte:Latte*", "frappe:Frappé", "macchiato:Macchiato", "mocha:Mocha"]
@var select accentColor "Accent" [
  "rosewater:Rosewater", "mauve:Mauve*",
  "subtext0:Gray"
]
@var checkbox rounded 'Rounded corners' 1
@var color bg "Background" #1e1e2e
@var text font "Font" "Inter, sans-serif"
@var range size "Size" [14, 10, 24, 1, "px"]
@var number gap "Gap" [4, "px"]
@var select obj "Object form" {"Small": "8px", "Big*": "16px"}
==/UserStyle== */
body {}`;
const h = U.parseHeader(header);
check('its name, version, update address, description (an @ inside it too), preprocessor',
  [h.meta.name, h.meta.version, h.meta.updateURL, h.meta.description, h.meta.preprocessor],
  ['GitHub Catppuccin', '2026.08.16', 'https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less', 'Soothing pastel theme for GitHub, with an @ in it', 'less']);
check('its variables: names, types, labels and defaults (* marks a select’s; one written over several lines)',
  h.vars.map((v) => [v.type, v.name, v.label, v.default]),
  [['select', 'lightFlavor', 'Light Flavor', 'latte'], ['select', 'accentColor', 'Accent', 'mauve'], ['checkbox', 'rounded', 'Rounded corners', '1'], ['color', 'bg', 'Background', '#1e1e2e'], ['text', 'font', 'Font', 'Inter, sans-serif'], ['range', 'size', 'Size', '14'], ['number', 'gap', 'Gap', '4'], ['select', 'obj', 'Object form', 'Big']]);
check('a select’s options (array and object forms)', [h.vars[1].options.map((o) => o.name + '=' + o.value), h.vars[7].options.map((o) => o.name + '=' + o.value)], [['rosewater=rosewater', 'mauve=mauve', 'subtext0=subtext0'], ['Small=8px', 'Big=16px']]);
check('a range’s bounds and unit', [h.vars[5].min, h.vars[5].max, h.vars[5].step, h.vars[5].unit, h.vars[6].unit], [10, 24, 1, 'px', 'px']);
check('values as the code gets them: a select’s value, a number with its unit, your choice over the default',
  [U.varValue(h.vars[7], {}), U.varValue(h.vars[7], { obj: 'Small' }), U.varValue(h.vars[5], {}), U.varValue(h.vars[5], { size: '18' }), U.varValue(h.vars[3], { bg: '#000' })],
  ['16px', '8px', '14px', '18px', '#000']);
check('no header: not a userstyle', U.parseHeader('body { color: red }'), null);

// ---- parts and their pages
const css = `/* a comment with @-moz-document domain("nope.com") { in it } */
:root { --x: 1; }
@-moz-document /* which pages */ regexp(
    "https:\\/\\/github\\.com(?!(\\/home$|\\/features($|\\/.*))).*$"
  ),
  domain("gist.github.com"), url-prefix('https://docs.example.org/guide/'), url(https://example.net/exact) {
  a[title="}"] { content: "{ not a block"; }
  @media (prefers-color-scheme: dark) { body { color: red } }
}
@-moz-document domain("empty.example") {   }
@-moz-document url-prefix("") { .everywhere { } }`;
const secs = U.sections(css);
check('three parts: the global one, one for GitHub and co., one for every page (an empty part dropped)', secs.length, 3);
check('the global part: code outside @-moz-document (the comment’s fake block isn’t one)', /--x: 1/.test(secs[0].code) && U.isGlobal(secs[0]), true);
check('what the GitHub part is for: a regexp (CSS escapes undone, as Firefox does), a domain, an address start, an address',
  [secs[1].regexps, secs[1].domains, secs[1].urlPrefixes, secs[1].urls],
  [['https://github.com(?!(/home$|/features($|/.*))).*$'], ['gist.github.com'], ['https://docs.example.org/guide/'], ['https://example.net/exact']]);
check('its code: braces in strings and a nested @media kept whole', /content: "\{ not a block"/.test(secs[1].code) && /@media \(prefers-color-scheme: dark\) \{ body \{ color: red \} \}/.test(secs[1].code), true);
const on = (url) => U.sectionMatches(secs[1], url);
check('a regexp matches the whole address; a domain its subdomains too; an address start; an exact address (with or without #)',
  [on('https://github.com/catppuccin'), on('https://github.com/home'), on('https://x.github.com/'), on('https://gist.github.com/a'), on('https://sub.gist.github.com/'), on('https://docs.example.org/guide/intro'), on('https://docs.example.org/other'), on('https://example.net/exact'), on('https://example.net/exact#top'), on('https://example.net/exact/more'), on('https://notgist.github.com.evil/')],
  [true, false, false, true, true, true, false, true, true, false, false]);
check('url-prefix("") is every page', U.sectionMatches(secs[2], 'https://anything.example/'), true);
check('the sites a style is for, to show', U.sitesOf(secs).sort(), ['docs.example.org', 'every site', 'example.net', 'gist.github.com', 'github.com']);
check('a broken regexp matches nothing (and doesn’t throw)', U.sectionMatches({ code: 'a{}', urls: [], urlPrefixes: [], domains: [], regexps: ['(unclosed'] }, 'https://x/'), false);

// ---- a whole style
const plain = `/* ==UserStyle==
@name Plain
@namespace test
@version 1.2.0
@var color bg "Background" #112233
@var select size "Size" ["s:Small", "l:Large*"]
==/UserStyle== */
@-moz-document domain("styled.test") { body { background: var(--bg); } }`;
const built = U.build(plain, { bg: '#abcdef' });
check('default preprocessor: the variables as CSS custom properties in each part, your choice in them',
  [built.sections.length, built.sections[0].domains, /:root \{\n  --bg: #abcdef;\n  --size: l;\n\}/.test(built.sections[0].code), /background: var\(--bg\)/.test(built.sections[0].code)], [1, ['styled.test'], true, true]);
const uso = U.build(`/* ==UserStyle==
@name Uso
@preprocessor uso
@var color fg "Text" #ff0000
==/UserStyle== */
@-moz-document domain("a.test") { body { color: /*[[fg]]*/; } }`, {});
check('uso preprocessor: /*[[name]]*/ placeholders filled in', /color: #ff0000;/.test(uso.sections[0].code), true);
check('LESS (or Stylus’s own language): not built here, said plainly', [throws(() => U.build(header, {})), throws(() => U.build(header.replace('@preprocessor less', '@preprocessor stylus'), {}))], ['preprocessor', 'preprocessor']);
check('no header, or no name: not a style', [/no ==UserStyle==/.test(throws(() => U.build('body{}'))), /no @name/.test(throws(() => U.build('/* ==UserStyle==\n@version 1\n==/UserStyle== */')))], [true, true]);

// ---- a Stylus backup
const backup = [
  { settings: { updateInterval: 24 } },
  { enabled: true, name: 'GitHub Catppuccin', updateUrl: 'https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less', sourceCode: header,
    usercssData: { name: 'GitHub Catppuccin', namespace: 'github.com/catppuccin', version: '2026.08.16', preprocessor: 'less', vars: { darkFlavor: { type: 'select', name: 'darkFlavor', label: 'Dark Flavor', default: 'mocha', value: 'macchiato', options: [{ name: 'mocha', label: 'Mocha', value: 'mocha' }, { name: 'macchiato', label: 'Macchiato', value: 'macchiato' }] } } },
    sections: [{ code: ':root { --bg: #24273a; }', domains: ['github.com'], urls: [], urlPrefixes: [], regexps: [] }, { code: '   ' }], exclusions: { 'https://github.com/settings/*': true } },
  { enabled: false, name: 'Old style', sections: [{ code: 'body { color: red }', urls: ['https://old.example/'] }] },
  { name: 'Not a style' },
];
const imported = U.fromStylusBackup(backup);
check('a Stylus backup: its styles (not its settings), with the CSS Stylus built (empty parts dropped), on or off',
  imported.map((s) => [s.name, s.enabled, s.sections.length, s.sections[0].domains.concat(s.sections[0].urls)]), [['GitHub Catppuccin', true, 1, ['github.com']], ['Old style', false, 1, ['https://old.example/']]]);
check('…its variables and what you chose for them, its source and update address, its exclusions',
  [imported[0].values, imported[0].vars[0].default, !!imported[0].code, imported[0].meta.updateURL, imported[0].meta.preprocessor, imported[0].exclusions],
  [{ darkFlavor: 'macchiato' }, 'mocha', true, 'https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less', 'less', ['https://github.com/settings/*']]);
check('exclusions: * for anything', [U.excluded(['https://github.com/settings/*'], 'https://github.com/settings/profile'), U.excluded(['https://github.com/settings/*'], 'https://github.com/catppuccin')], [true, false]);
check('not a backup: nothing', [U.fromStylusBackup({ a: 1 }), U.fromStylusBackup(null)], [[], []]);

// ---- CSS escapes
check('CSS string escapes', [U.unescapeCss('a\\.b'), U.unescapeCss('\\41 B'), U.unescapeCss('x\\\ny'), U.unescapeCss('\\\\d')], ['a.b', 'AB', 'xy', '\\d']);
check('a new style starts for the site you’re on', /@-moz-document domain\("news\.example"\)/.test(U.template('news.example')) && !!U.parseHeader(U.template('news.example')).meta.name, true);

console.log(`\nusercss: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
