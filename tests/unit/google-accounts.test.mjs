// Which Google account Google's sites open with (src/shared/google-accounts.js): reading Google's list of your
// accounts, which pages get one (Google's, opened from outside Google, not saying which already; not sign-in,
// consent or redirect pages), which account (the most specific of your sites, else the default; Google's choice
// where you said so), and the address it makes.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const G = require(ROOT + '/src/shared/google-accounts.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- Google's list: as accounts.google.com/ListAccounts?json=standard sends it.
const acct = (name, email, { valid = 1, signedOut = null } = {}) => ['gaia.l.a', 1, name, email, `https://lh3.googleusercontent.com/${email}`, 1, 1, 0, null, valid, String(email.length) + '1122334455', null, null, null, signedOut, 1];
const listText = JSON.stringify(['gaia.l.a.r', [acct('Tamil', 'Tamil.Kumar@gmail.com'), acct('Tamil (Purdue)', 'tkumar@purdue.edu', { valid: 0 }), acct('Old', 'old@gmail.com', { signedOut: 1 }), acct('Third', 'third@gmail.com')]]);
check('the accounts you’re signed in to, in Google’s order, each with its place (authuser)',
  G.parseListAccounts(listText).map((a) => [a.index, a.email, a.name]), [[0, 'Tamil.Kumar@gmail.com', 'Tamil'], [1, 'tkumar@purdue.edu', 'Tamil (Purdue)'], [2, 'third@gmail.com', 'Third']]);
check('one Google wants you to sign in to again is still in its place, marked',
  G.parseListAccounts(listText).map((a) => a.valid), [true, false, true]);
check('signed out of all: none', G.parseListAccounts('["gaia.l.a.r",[]]'), []);
check('Google’s anti-hijacking prefix is taken off', G.parseListAccounts(")]}'\n" + listText).length, 3);
check('an answer that isn’t the list (a sign-in page, nonsense) is an error', [throws(() => G.parseListAccounts('<html>')), throws(() => G.parseListAccounts('{"a":1}'))], [true, true]);

// ---- emails, as Google compares them
check('case and a Gmail address’s dots don’t count', [G.sameEmail('Tamil.Kumar@gmail.com', 'tamilkumar@GMAIL.com'), G.sameEmail('a.b@googlemail.com', 'ab@gmail.com')], [true, true]);
check('…a work address’s dots do', G.sameEmail('t.kumar@purdue.edu', 'tkumar@purdue.edu'), false);

// ---- which pages, which account
const cfg = {
  default: 'tkumar@purdue.edu',
  sites: [
    { site: 'youtube.com', email: 'Tamil.Kumar@gmail.com' },
    { site: 'google.com', email: 'third@gmail.com' },
    { site: 'docs.google.com', email: 'tkumar@purdue.edu' },
    { site: 'www.google.com/maps', email: 'Tamil.Kumar@gmail.com' },
    { site: 'photos.google.com', email: '' },
    { site: '', email: 'third@gmail.com' },
  ],
};
const at = (url, ref = '') => G.accountFor(url, cfg, ref);
check('YouTube (and its subdomains) with the account for youtube.com', [at('https://www.youtube.com/watch?v=x'), at('https://music.youtube.com/')], ['Tamil.Kumar@gmail.com', 'Tamil.Kumar@gmail.com']);
check('the most specific site counts: docs.google.com before google.com', [at('https://docs.google.com/document/d/1/edit'), at('https://mail.google.com/mail/')], ['tkumar@purdue.edu', 'third@gmail.com']);
check('a site with a path: www.google.com/maps, not the rest of www.google.com', [at('https://www.google.com/maps/place/x'), at('https://www.google.com/search?q=maps'), at('https://www.google.com/mapsx')], ['Tamil.Kumar@gmail.com', 'third@gmail.com', 'third@gmail.com']);
check('Google’s choice for a site: left alone there', at('https://photos.google.com/'), '');
check('no site for it: the default (Google in another country)', at('https://www.google.co.uk/search?q=a'), 'tkumar@purdue.edu');
const def = { default: 'tkumar@purdue.edu', sites: [] };
check('just a default: every Google site', ['https://mail.google.com/', 'https://www.youtube.com/', 'https://classroom.google.com/c/1'].map((u) => G.accountFor(u, def, '')), ['tkumar@purdue.edu', 'tkumar@purdue.edu', 'tkumar@purdue.edu']);
check('nothing chosen: nothing changes', [G.accountFor('https://mail.google.com/', { default: '', sites: [] }, ''), G.accountFor('https://mail.google.com/', null, '')], ['', '']);

check('opened from another site, or with no referrer: yes; from a Google page (or Gmail’s): no',
  [at('https://mail.google.com/mail/', 'https://news.example/'), at('https://mail.google.com/mail/', ''), at('https://mail.google.com/mail/', 'https://www.google.com/'), at('https://drive.google.com/', 'https://www.youtube.com/watch?v=1'), at('https://drive.google.com/', 'https://gmail.com/')],
  ['third@gmail.com', 'third@gmail.com', '', '', '']);
check('a page that says which account already: left alone',
  ['https://mail.google.com/mail/u/1/#inbox', 'https://drive.google.com/drive/u/0/my-drive', 'https://photos.google.com/u/2/', 'https://www.youtube.com/?authuser=0', 'https://docs.google.com/a/purdue.edu/document/d/1/', 'https://www.youtube.com/?pageid=123', 'https://mail.google.com/mail/b/123/'].map((u) => at(u)),
  ['', '', '', '', '', '', '']);
check('sign-in, consent, the Web Store and Google’s redirects: left alone',
  ['https://accounts.google.com/ServiceLogin', 'https://accounts.youtube.com/accounts/SetSID', 'https://consent.youtube.com/m', 'https://consent.google.com/', 'https://chromewebstore.google.com/detail/x', 'https://www.google.com/url?q=https://x.example/', 'https://www.google.com/sorry/index', 'https://www.youtube.com/signin?action_handle_signin=true', 'https://www.youtube.com/redirect?q=x', 'https://accounts.google.co.uk/accounts/SetSID'].map((u) => at(u)),
  ['', '', '', '', '', '', '', '', '', '']);
check('not Google’s, or not https: left alone', ['https://news.example/', 'https://notgoogle.com/', 'https://google.com.evil.example/', 'http://mail.google.com/', 'https://youtube.com.example/'].map((u) => at(u)), ['', '', '', '', '']);

// ---- the address
check('authuser added after what’s there, untouched (its encoding too)', G.withAccount('https://www.youtube.com/watch?v=x&t=1s&q=a%20b', 1), 'https://www.youtube.com/watch?v=x&t=1s&q=a%20b&authuser=1');
check('…or as the only one', G.withAccount('https://docs.google.com/document/d/1/edit', 0), 'https://docs.google.com/document/d/1/edit?authuser=0');
check('Gmail’s front page: /mail/, where it reads it', [G.withAccount('https://mail.google.com/', 2), G.withAccount('https://mail.google.com/mail', 2)], ['https://mail.google.com/mail/?authuser=2', 'https://mail.google.com/mail/?authuser=2']);
check('an email (before the accounts are read)', G.withAccount('https://drive.google.com/', 'tkumar@purdue.edu'), 'https://drive.google.com/?authuser=tkumar%40purdue.edu');
check('…and the page then says which account (no second time)', at(G.withAccount('https://drive.google.com/', 1)), '');

// ---- sites as typed in Settings
check('sites as typed', ['youtube.com', 'https://www.google.com/maps/', ' Docs.Google.com ', 'mail.google.com/mail?x=1', '', 'a b'].map((s) => G.parseSite(s)),
  [{ host: 'youtube.com', path: '' }, { host: 'www.google.com', path: '/maps' }, { host: 'docs.google.com', path: '' }, { host: 'mail.google.com', path: '/mail' }, null, null]);
check('the suggestions are all Google’s sites', G.SITES.every(([s]) => G.isGoogleHost(G.parseSite(s).host)), true);

console.log(`\ngoogle-accounts: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
