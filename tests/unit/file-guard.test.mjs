// The file guard (src/main/file-guard.js): which local files a page opened from a local file may load
// (frames, images, styles…): its own site folder, never Bifrost's profile, AppData or hidden folders.
// Windows paths (what Bifrost mostly runs on) and Linux ones, whatever this test runs on.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { makeRules, headers, CSP } = require(path.join(ROOT, 'src', 'main', 'file-guard.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const win = makeRules({ path: path.win32, home: 'C:\\Users\\Tamil', temp: 'C:\\Users\\Tamil\\AppData\\Local\\Temp', profile: 'C:\\Users\\Tamil\\AppData\\Roaming\\Bifrost' });
const lin = makeRules({ path: path.posix, home: '/home/tamil', temp: '/tmp', profile: '/home/tamil/.config/Bifrost' });
const yes = (r, page, t) => assert(r.allowed(page, t), `${page} should load ${t} (site folder ${r.siteRoot(path.win32.dirname(page))})`);
const no = (r, page, t) => assert(!r.allowed(page, t), `${page} shouldn't load ${t} (site folder ${r.siteRoot(path.win32.dirname(page))})`);

check('a site in Documents: its whole folder (styles up the tree, like ../_static) but nothing next to it', () => {
  const p = 'C:\\Users\\Tamil\\Documents\\projects\\site\\docs\\api\\x.html';
  assert(win.siteRoot(path.win32.dirname(p)) === 'c:\\users\\tamil\\documents\\projects', win.siteRoot(path.win32.dirname(p)));
  yes(win, p, 'C:\\Users\\Tamil\\Documents\\projects\\site\\_static\\style.css');
  yes(win, p, 'C:\\Users\\Tamil\\Documents\\projects\\site\\docs\\api\\frame.html');
  no(win, p, 'C:\\Users\\Tamil\\Documents\\taxes.txt');
  no(win, p, 'C:\\Users\\Tamil\\.ssh\\id_ed25519');
  no(win, p, 'C:\\Users\\Tamil\\AppData\\Roaming\\Bifrost\\Network\\Cookies');
  no(win, p, 'C:\\Users\\Tamil\\Documents\\projects\\site\\.git\\config');
});

check('a page saved to Downloads: its _files folder, not other folders', () => {
  const p = 'C:\\Users\\Tamil\\Downloads\\page.html';
  yes(win, p, 'C:\\Users\\Tamil\\Downloads\\page_files\\a.png');
  no(win, p, 'C:\\Users\\Tamil\\Documents\\x.txt');
  no(win, p, 'C:\\Users\\Tamil\\Desktop\\x.txt');
  no(win, p, 'C:\\Users\\Tamil\\Downloads\\.hidden\\x.txt');
});

check('a flash drive: the folder the tools are in', () => {
  const p = 'E:\\DebateToolbox\\tools\\timer.html';
  yes(win, p, 'E:\\DebateToolbox\\assets\\app.css');
  yes(win, p, 'E:\\DebateToolbox\\tools\\data\\events.json');
  no(win, p, 'E:\\Other\\notes.txt');
  no(win, p, 'C:\\Users\\Tamil\\Documents\\x.txt');
});

check('a page in AppData (temp files, mail attachments): only its own folder', () => {
  const p = 'C:\\Users\\Tamil\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.Outlook\\AB12\\invoice.html';
  yes(win, p, 'C:\\Users\\Tamil\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.Outlook\\AB12\\logo.png');
  no(win, p, 'C:\\Users\\Tamil\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.Outlook\\CD34\\other.html');
  no(win, p, 'C:\\Users\\Tamil\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cookies');
  const z = 'C:\\Users\\Tamil\\AppData\\Local\\Temp\\Temp1_site.zip\\index.html';
  yes(win, z, 'C:\\Users\\Tamil\\AppData\\Local\\Temp\\Temp1_site.zip\\css\\a.css');
  no(win, z, 'C:\\Users\\Tamil\\AppData\\Local\\Temp\\other\\x.txt');
});

check('a page right in the home folder or on C:\\ still can’t reach the profile, AppData or hidden folders', () => {
  for (const p of ['C:\\Users\\Tamil\\evil.html', 'C:\\evil.html']) {
    no(win, p, 'C:\\Users\\Tamil\\AppData\\Roaming\\Bifrost\\Network\\Cookies');
    no(win, p, 'C:\\Users\\Tamil\\AppData\\Local\\Google\\Chrome\\User Data\\Local State');
    no(win, p, 'C:\\Users\\Tamil\\.ssh\\id_ed25519');
  }
});

check('OneDrive’s Documents is a broad folder like Documents', () => {
  const p = 'C:\\Users\\Tamil\\OneDrive\\Documents\\notes\\a.html';
  yes(win, p, 'C:\\Users\\Tamil\\OneDrive\\Documents\\notes\\img\\b.png');
  no(win, p, 'C:\\Users\\Tamil\\OneDrive\\Documents\\private.txt');
  const q = 'C:\\Users\\Tamil\\OneDrive - Purdue University\\Desktop\\site\\a.html';
  no(win, q, 'C:\\Users\\Tamil\\OneDrive - Purdue University\\Desktop\\grades.txt');
});

check('network shares, and letter case doesn’t matter on Windows', () => {
  yes(win, '\\\\server\\share\\site\\a.html', '\\\\server\\share\\site\\img\\b.png');
  no(win, '\\\\server\\share\\site\\a.html', '\\\\server\\share\\other\\b.png');
  yes(win, 'C:\\USERS\\TAMIL\\DOWNLOADS\\x.html', 'c:\\users\\tamil\\downloads\\x_files\\y.png');
});

check('Linux: home, /tmp and removable drives', () => {
  yes(lin, '/home/tamil/projects/site/docs/p.html', '/home/tamil/projects/site/_static/s.css');
  no(lin, '/home/tamil/projects/site/docs/p.html', '/home/tamil/.config/Bifrost/Cookies');
  no(lin, '/home/tamil/projects/site/docs/p.html', '/home/tamil/Documents/x.txt');
  no(lin, '/home/tamil/p.html', '/home/tamil/.ssh/id_ed25519');
  yes(lin, '/tmp/abc/site/p.html', '/tmp/abc/x/y.png');
  no(lin, '/tmp/abc/site/p.html', '/tmp/other/secret.txt');
  yes(lin, '/media/tamil/USB/Toolbox/a.html', '/media/tamil/USB/Toolbox/b/c.css');
  no(lin, '/media/tamil/USB/Toolbox/a.html', '/media/tamil/USB/Other/c.css');
});

check('local HTML, SVG and XML documents get the policy (added to their own); other files don’t', () => {
  const h = headers({ resourceType: 'mainFrame', responseHeaders: { 'Content-Type': ['text/html'] } });
  assert(h && h['Content-Security-Policy'][0] === CSP, JSON.stringify(h));
  assert(headers({ resourceType: 'subFrame', responseHeaders: { 'content-type': ['image/svg+xml'] } }), 'svg frame');
  assert(!headers({ resourceType: 'mainFrame', responseHeaders: { 'Content-Type': ['application/pdf'] } }), 'pdf');
  assert(!headers({ resourceType: 'image', responseHeaders: { 'Content-Type': ['text/html'] } }), 'an image request');
  const both = headers({ resourceType: 'mainFrame', responseHeaders: { 'Content-Type': ['text/html'], 'content-security-policy': ["script-src 'self'"] } });
  assert(both['Content-Security-Policy'].length === 2 && !both['content-security-policy'], JSON.stringify(both));
});

console.log(`\nfile-guard: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
