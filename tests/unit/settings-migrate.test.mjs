// Settings saved by older versions (src/main/settings.js, migrate): what changes when 0.22 first reads them,
// and what doesn't.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Settings } = require(ROOT + '/src/main/settings.js');
const { DEFAULTS, clone } = require(ROOT + '/src/shared/defaults.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// A profile whose settings.json is `saved`; returns the settings as 0.22 sees them.
function load(saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-settings-'));
  if (saved) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(saved));
  const s = new Settings(dir);
  return s.get();
}
// Settings as 0.21 saved them: the whole object, with 0.21's defaults.
function old021(patch = {}) {
  const o = clone(DEFAULTS);
  delete o.settingsVersion;
  o.appearance.webTheme = 'system';
  o.keyboard.vim.enabled = true;
  o.keyboard.vim.excludedSites = ['mail.google.com', 'docs.google.com', 'www.figma.com'];
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.'); let cur = o;
    while (parts.length > 1) cur = cur[parts.shift()];
    cur[parts[0]] = v;
  }
  return o;
}

console.log('settings migrations');
check('a new profile gets the defaults (websites like Bifrost’s theme, Vim keys off)', () => {
  const s = load(null);
  assert(s.appearance.webTheme === 'browser', s.appearance.webTheme);
  assert(s.keyboard.vim.enabled === false);
});
check('0.21’s untouched “websites like the computer” becomes “like Bifrost’s theme”', () => {
  assert(load(old021()).appearance.webTheme === 'browser');
});
check('a light or dark choice for websites is kept', () => {
  assert(load(old021({ 'appearance.webTheme': 'dark' })).appearance.webTheme === 'dark');
  assert(load(old021({ 'appearance.webTheme': 'light' })).appearance.webTheme === 'light');
});
check('untouched Vim keys go off, and YouTube and other sites with their own keys are excluded', () => {
  const s = load(old021());
  assert(s.keyboard.vim.enabled === false);
  assert(s.keyboard.vim.excludedSites.includes('youtube.com'));
  assert(s.keyboard.vim.excludedSites.includes('mail.google.com'));
});
check('Vim keys set up by hand stay on', () => {
  const s = load(old021({ 'keyboard.vim.scrollStep': 120 }));
  assert(s.keyboard.vim.enabled === true);
});
check('it runs once: choosing “like the computer” again after 0.22 sticks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-settings-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(old021()));
  const a = new Settings(dir);
  a.set('appearance.webTheme', 'system');
  a.saveNow();
  const b = new Settings(dir);
  assert(b.get('appearance.webTheme') === 'system', b.get('appearance.webTheme'));
});
console.log(`\nsettings: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
