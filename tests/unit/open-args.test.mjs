// What Bifrost is asked to open (src/main/open-args.js): command lines as Windows and Linux start it, a later
// start's arguments as the running Bifrost gets them, what that start sends along, and dropped files.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = require(ROOT + '/src/main/open-args.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

// A Windows PC's files (Windows' paths in any case).
const winFiles = new Set(['C:\\Users\\Sam Lee\\Downloads\\Lecture notes.pdf', 'C:\\Users\\Sam Lee\\Downloads\\notes #1 100%.pdf',
  'C:\\Users\\Sam Lee\\Documents\\page.html', 'D:\\SCANS\\REPORT.PDF', 'C:\\x\\a  b.pdf'].map((p) => p.toLowerCase()));
const winDirs = new Set(['C:\\Users\\Sam Lee\\Downloads', 'C:\\Program Files\\Bifrost'].map((p) => p.toLowerCase()));
const winFs = { statSync(p) {
  const k = p.toLowerCase();
  if (winFiles.has(k)) return { isFile: () => true };
  if (winDirs.has(k)) return { isFile: () => false };
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
} };
const W = { win: true, fs: winFs, cwd: 'C:\\Program Files\\Bifrost' };
const EXE = 'C:\\Program Files\\Bifrost\\Bifrost.exe';
const LECTURE = 'file:///C:/Users/Sam%20Lee/Downloads/Lecture%20notes.pdf';

// ------------------------------------------------------------------ Windows
check('a PDF opened from Explorer, Bifrost not running: process.argv is the command line cut at every space; put back together',
  A.fromArgv([EXE, '--single-argument', 'C:\\Users\\Sam', 'Lee\\Downloads\\Lecture', 'notes.pdf'], W), [LECTURE]);
check('…Bifrost running: the later start\'s arguments as Chromium read them (the file whole, no --single-argument)',
  A.fromArgv([EXE, 'C:\\Users\\Sam Lee\\Downloads\\Lecture notes.pdf'], W), [LECTURE]);
check('…with the switches Chromium puts in front of it',
  A.fromArgv([EXE, '--allow-file-access-from-files', '--original-process-start-time=13379', 'C:\\Users\\Sam Lee\\Downloads\\Lecture notes.pdf'], W), [LECTURE]);
check('a file name with # and %, an upper-case one on another drive',
  [A.fromArgv([EXE, '--single-argument', 'C:\\Users\\Sam', 'Lee\\Downloads\\notes', '#1', '100%.pdf'], W), A.fromArgv([EXE, '--single-argument', 'D:\\SCANS\\REPORT.PDF'], W)],
  [['file:///C:/Users/Sam%20Lee/Downloads/notes%20%231%20100%25.pdf'], ['file:///D:/SCANS/REPORT.PDF']]);
check('a path without quotes and without --single-argument (a command another program made), cut at its spaces: whole again',
  [A.fromArgv([EXE, 'C:\\Users\\Sam', 'Lee\\Downloads\\Lecture', 'notes.pdf'], W), A.fromArgv([EXE, '--new-window', 'C:\\Users\\Sam', 'Lee\\gone.pdf'], W)], [[LECTURE], []]);
check('a link: as it is (spaces in a link come encoded)', A.fromArgv([EXE, '--single-argument', 'https://example.com/a?q=1&b=2'], W), ['https://example.com/a?q=1&b=2']);
check('in quotes ("%1" in an older registration, Open with)', A.fromArgv([EXE, '"C:\\Users\\Sam Lee\\Downloads\\Lecture notes.pdf"'], W), [LECTURE]);
check('a name relative to where the later start was (its own folder, not the running Bifrost\'s)',
  A.fromArgv([EXE, 'Lecture notes.pdf'], { ...W, cwd: 'C:\\Users\\Sam Lee\\Downloads' }), [LECTURE]);
check('nothing for a file that isn\'t there, a folder, a switch, a bare word',
  [A.fromArgv([EXE, '--single-argument', 'C:\\Users\\Sam', 'Lee\\gone.pdf'], W), A.fromArgv([EXE, 'C:\\Users\\Sam Lee\\Downloads'], W), A.fromArgv([EXE, '--new-window', 'hello'], W), A.fromArgv([EXE], W)],
  [[], [], [], []]);
check('any file, not only the kinds Bifrost registers for (Open with → Bifrost)', A.fromArgv([EXE, 'C:\\Users\\Sam Lee\\Documents\\page.html'], W), ['file:///C:/Users/Sam%20Lee/Documents/page.html']);
check('two spaces in a row can\'t be told from one in process.argv: the running Bifrost\'s reading of a later start has them',
  [A.fromArgv([EXE, '--single-argument', 'C:\\x\\a', 'b.pdf'], W), A.fromArgv([EXE, 'C:\\x\\a  b.pdf'], W)], [[], ['file:///C:/x/a%20%20b.pdf']]);

// ------------------------------------------------------------------ what a later start sends along
check('sent along: addresses Bifrost opens, nothing else', A.fromData({ open: [LECTURE, 'https://example.com/', 'javascript:alert(1)', 'data:text/html,x', 7, null, 'chrome://settings'] }, W), [LECTURE, 'https://example.com/']);
check('…nothing for anything that isn\'t a list of them', [A.fromData(null, W), A.fromData({ open: 'https://a.example/' }, W), A.fromData('x', W)], [[], [], []]);
check('both readings of the same start: once (the same file in another case too)', A.merge([LECTURE], [LECTURE.replace('C:/Users', 'c:/users'), 'https://example.com/'], W), [LECTURE, 'https://example.com/']);
check('at most 50 at once', A.fromData({ open: Array.from({ length: 80 }, (_, i) => 'https://example.com/' + i) }, W).length, 50);

// ------------------------------------------------------------------ dropped files
check('dropped files: their addresses, files only, full paths only',
  A.fromPaths(['C:\\Users\\Sam Lee\\Downloads\\Lecture notes.pdf', 'C:\\Users\\Sam Lee\\Downloads', 'Lecture notes.pdf', 'C:\\gone.pdf', 42, 'D:\\SCANS\\REPORT.PDF'], W),
  [LECTURE, 'file:///D:/SCANS/REPORT.PDF']);
check('…nothing for anything that isn\'t a list of paths', [A.fromPaths('C:\\x\\a  b.pdf', W), A.fromPaths(null, W)], [[], []]);

// ------------------------------------------------------------------ Linux (this computer's own files)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost open '));
const pdf = path.join(dir, 'Lecture notes.pdf');
fs.writeFileSync(pdf, '%PDF-1.4\n');
const L = { win: false };
const url = 'file://' + dir.split('/').map(encodeURIComponent).join('/') + '/Lecture%20notes.pdf';
check('Linux: a file manager\'s file:// address (%U), a path, a relative one', [
  A.fromArgv(['/opt/bifrost/bifrost', url], L), A.fromArgv(['/opt/bifrost/bifrost', pdf], L), A.fromArgv(['/opt/bifrost/bifrost', 'Lecture notes.pdf'], { ...L, cwd: dir }),
], [[url], [url], [url]]);
check('a development copy (electron <Bifrost\'s folder> --profile=…): its folder isn\'t opened, the file is',
  [A.fromArgv(['/opt/electron/electron', ROOT, '--profile=/tmp/p'], L), A.fromArgv(['/opt/electron/electron', ROOT, '--profile=/tmp/p', '--single-argument', pdf], L)], [[], [url]]);
check('dropped: the file\'s address', A.fromPaths([pdf, dir], L), [url]);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`open-args: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
