// The touchpad watcher (tools/win/touchpad.c): its frames, with made-up reports (tests/fixtures/touchpad-frames.c),
// and that it starts, says how many touchpads it can read, and goes away when Bifrost does. Built with llvm-mingw
// and run under Wine; skipped without them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LLVM = process.env.LLVM_MINGW || '/opt/llvm-mingw';
const WINE = process.env.WINE || '/opt/wine/bin/wine';
const CC = path.join(LLVM, 'bin', 'x86_64-w64-mingw32-clang');
if (!fs.existsSync(CC) || !fs.existsSync(WINE)) { console.log('touchpad: skipped (needs llvm-mingw and Wine)'); process.exit(0); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-touchpad-'));
const env = { ...process.env, WINEPREFIX: process.env.WINEPREFIX || path.join(os.tmpdir(), 'bifrost-touchpad-wine'), WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=' };
let fail = 0;
try {
  execFileSync(CC, ['-O1', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-unused-function', path.join(ROOT, 'tests', 'fixtures', 'touchpad-frames.c'), '-static', '-o', path.join(work, 'frames.exe')]);
  try {
    process.stdout.write(execFileSync(WINE, [path.join(work, 'frames.exe')], { env, encoding: 'utf8', timeout: 120000 }));
  } catch (e) { process.stdout.write(String(e.stdout || '')); fail++; }

  // The real thing, as built for the app: it starts, says it can read no touchpads (Wine has none), and exits
  // when its stdin closes.
  const exe = path.join(ROOT, 'assets', 'bin', 'touchpad-x64.exe');
  const out = await new Promise((resolve) => {
    const p = spawn(WINE, [exe], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let text = '';
    const t0 = Date.now();
    let closedAt = 0;
    p.stdout.on('data', (d) => {
      text += d;
      if (!closedAt && /touchpads -?\d+\n/.test(text)) { closedAt = Date.now(); setTimeout(() => p.stdin.end(), 300); }
    });
    p.on('exit', (code) => resolve({ text, code, after: closedAt ? Date.now() - closedAt : -1 }));
    setTimeout(() => { try { p.kill(); } catch { /* gone */ } resolve({ text, code: 'killed', after: Date.now() - t0 }); }, 60000).unref();
  });
  const ok = /^touchpads 0\n$/.test(out.text) && out.code === 0 && out.after < 5000;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} the watcher starts, says how many touchpads it can read, and exits when its stdin closes` + (ok ? '' : `\n      ${JSON.stringify(out)}`));
} finally { fs.rmSync(work, { recursive: true, force: true }); }
console.log(`\ntouchpad: ${fail ? 'FAILED' : 'passed'}`);
process.exit(fail ? 1 : 0);
