// The browser window's page (src/ui/browser.html) names every module its code is made of, so they're all asked
// for at once as the window opens rather than each after the file that imports it: the list has to match what
// js/main.js really imports, however deep.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
// (bifrost://ui: /_/shared/… is src/shared, /_/common/… src/pages/common, the rest src/ui)
const fileOf = (u) => (u.startsWith('/_/shared/') ? path.join(SRC, 'shared', u.slice(10)) : u.startsWith('/_/common/') ? path.join(SRC, 'pages', 'common', u.slice(10)) : path.join(SRC, 'ui', u));

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

// Every module main.js imports as it loads (import … from, export … from; not the import() calls made later).
const seen = new Set();
const walk = (u) => {
  if (seen.has(u)) return;
  seen.add(u);
  const src = fs.readFileSync(fileOf(u), 'utf8');
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) walk(m[1].startsWith('/') ? m[1] : path.posix.join(path.posix.dirname(u), m[1]));
};
walk('/js/main.js');
seen.delete('/js/main.js');

const html = fs.readFileSync(path.join(SRC, 'ui', 'browser.html'), 'utf8');
const named = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
check('browser.html names every module main.js imports, and no other', [...named].sort(), [...seen].sort());
check('each once', named.length, new Set(named).size);
check('they’re named before the script that needs them', html.indexOf('rel="modulepreload"') < html.indexOf('src="js/main.js"'), true);
const styles = [...fs.readFileSync(path.join(SRC, 'ui', 'browser.css'), 'utf8').matchAll(/@import url\('([^']+)'\)/g)].map((m) => m[1]);
check('…and the style sheets browser.css imports', styles.every((s) => html.includes(`<link rel="preload" as="style" href="${s}">`)), true);

console.log(`\nui-preload: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
