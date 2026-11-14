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

// ---- …and as Chrome asks for it now (laf=b64bin): base64 of a ListAccountsResponse protobuf (account = 1; each
// 2: name, 3: email, 4: photo, 9: valid, 10: id, 14: signed out, 15: verified; Google's own fields besides).
const varint = (n) => { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; b.push(x); } while (n); return b; };
const pb = {
  str: (n, s) => { const u = [...Buffer.from(s, 'utf8')]; return [...varint(n * 8 + 2), ...varint(u.length), ...u]; },
  int: (n, v) => [...varint(n * 8), ...varint(v)],
  fixed64: (n) => [...varint(n * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8],
  fixed32: (n) => [...varint(n * 8 + 5), 1, 2, 3, 4],
  msg: (n, bytes) => [...varint(n * 8 + 2), ...varint(bytes.length), ...bytes],
};
const bin = (name, email, { valid = 1, signedOut = 0, extra = [] } = {}) => [
  ...pb.int(1, 1), ...pb.str(2, name), ...pb.str(3, email), ...pb.str(4, `https://lh3.googleusercontent.com/${email}`),
  ...pb.int(5, 1), ...pb.fixed64(6), ...pb.int(9, valid), ...pb.str(10, String(email.length) + '1122334455'),
  ...(signedOut ? pb.int(14, 1) : []), ...pb.int(15, 1), ...extra];
const binText = (accounts, wrap = 0) => {
  const b64 = Buffer.from(accounts.flatMap((a) => pb.msg(1, a))).toString('base64');
  return wrap ? b64.replace(new RegExp(`(.{${wrap}})`, 'g'), '$1\n') : b64;
};
const binList = binText([bin('Tamil குமார்', 'Tamil.Kumar@gmail.com'), bin('Tamil (Purdue)', 'tkumar@purdue.edu', { valid: 0, extra: [...pb.fixed32(21), ...pb.msg(30, pb.str(1, 'x'))] }), bin('Old', 'old@gmail.com', { signedOut: 1 }), bin('Third', 'third@gmail.com')]);
check('Chrome’s form: the accounts you’re signed in to, in Google’s order, with their places, names and emails (Google’s other fields skipped)',
  G.parseListAccounts(binList).map((a) => [a.index, a.email, a.name, a.valid]), [[0, 'Tamil.Kumar@gmail.com', 'Tamil குமார்', true], [1, 'tkumar@purdue.edu', 'Tamil (Purdue)', false], [2, 'third@gmail.com', 'Third', true]]);
check('…in lines, as base64 often comes', G.parseListAccounts(binText([bin('A', 'a@gmail.com'), bin('B', 'b@gmail.com')], 20) + '\n').map((a) => a.email), ['a@gmail.com', 'b@gmail.com']);
check('…an account without a name: just its email', G.parseListAccounts(binText([[...pb.str(3, 'n@gmail.com'), ...pb.int(9, 1)]])), [{ email: 'n@gmail.com', name: '', index: 0, valid: true }]);
check('…signed out of all: an empty list', [G.parseListAccounts(''), G.parseListAccounts(binText([]))], [[], []]);
check('…cut short, or not base64 (Google’s error page): an error', [throws(() => G.parseListAccounts(binList.slice(0, 40))), throws(() => G.parseListAccounts('<!DOCTYPE html><title>Error 400 (Bad Request)!!1</title>'))], [true, true]);

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

// ---- pages you open yourself: an account named by number is Google's place for it, not yours
const mine = (url, ref = '') => G.accountFor(url, cfg, ref, true);
check('opened yourself: Gmail’s address with Google’s first account in it gets yours, and so does one with another number',
  [mine('https://mail.google.com/mail/u/0/#inbox'), mine('https://mail.google.com/mail/u/2/'), mine('https://drive.google.com/drive/u/0/my-drive'), mine('https://www.youtube.com/?authuser=0'), mine('https://classroom.google.com/u/1/h')],
  ['third@gmail.com', 'third@gmail.com', 'third@gmail.com', 'Tamil.Kumar@gmail.com', 'third@gmail.com']);
check('…but not one named by email, a brand or delegated account, a Workspace domain, or Google’s choice for the site',
  [mine('https://mail.google.com/mail/u/tkumar@purdue.edu/'), mine('https://www.youtube.com/?authuser=a%40b.c'), mine('https://mail.google.com/mail/b/123/'), mine('https://docs.google.com/a/purdue.edu/document/d/1/'), mine('https://www.youtube.com/?pageid=1'), mine('https://photos.google.com/u/0/')],
  ['', '', '', '', '', '']);
check('…nor a link inside Google (it says which account it’s for)', [mine('https://mail.google.com/mail/u/0/', 'https://www.google.com/'), mine('https://drive.google.com/drive/u/0/', 'https://mail.google.com/mail/u/0/')], ['', '']);
check('not opened yourself (a reload, back, a tab put back): a number stays', [at('https://mail.google.com/mail/u/0/'), at('https://www.youtube.com/?authuser=0')], ['', '']);
check('gmail.com: Gmail’s front page (its other pages are left to it)', [mine('https://gmail.com/'), mine('https://www.gmail.com/'), at('https://gmail.com/'), mine('https://gmail.com/mail/help')], ['third@gmail.com', 'third@gmail.com', 'third@gmail.com', '']);

// ---- the address
check('authuser added after what’s there, untouched (its encoding too)', G.withAccount('https://www.youtube.com/watch?v=x&t=1s&q=a%20b', 1), 'https://www.youtube.com/watch?v=x&t=1s&q=a%20b&authuser=1');
check('…or as the only one', G.withAccount('https://docs.google.com/document/d/1/edit', 0), 'https://docs.google.com/document/d/1/edit?authuser=0');
check('Gmail’s front page: /mail/, where it reads it', [G.withAccount('https://mail.google.com/', 2), G.withAccount('https://mail.google.com/mail', 2)], ['https://mail.google.com/mail/?authuser=2', 'https://mail.google.com/mail/?authuser=2']);
check('an email (before the accounts are read)', G.withAccount('https://drive.google.com/', 'tkumar@purdue.edu'), 'https://drive.google.com/?authuser=tkumar%40purdue.edu');
check('a number in the address: yours in its place (the rest as it was)',
  [G.withAccount('https://mail.google.com/mail/u/0/#inbox', 1), G.withAccount('https://mail.google.com/mail/u/0/?ui=2&ik=x', 2), G.withAccount('https://drive.google.com/drive/u/3/my-drive', 0), G.withAccount('https://www.youtube.com/watch?v=x&authuser=0&t=1', 2)],
  ['https://mail.google.com/mail/u/1/#inbox', 'https://mail.google.com/mail/u/2/?ui=2&ik=x', 'https://drive.google.com/drive/u/0/my-drive', 'https://www.youtube.com/watch?v=x&t=1&authuser=2']);
check('…an email: as authuser, the number taken out (the same page for Google’s first account)', [G.withAccount('https://mail.google.com/mail/u/0/#inbox', 'a@b.c'), G.withAccount('https://keep.google.com/u/1', 'e@x.org')], ['https://mail.google.com/mail/?authuser=a%40b.c#inbox', 'https://keep.google.com/?authuser=e%40x.org']);
check('gmail.com: Gmail’s front page with the account', [G.withAccount('https://gmail.com/', 1), G.withAccount('https://www.gmail.com/?n=1', 'a@b.c')], ['https://mail.google.com/mail/?authuser=1', 'https://mail.google.com/mail/?n=1&authuser=a%40b.c']);
check('…and the page then names it: as it is after a reload or a link (main gives a page its account once, its redirects keeping it)', [at(G.withAccount('https://mail.google.com/mail/u/0/', 1)), at(G.withAccount('https://gmail.com/', 1))], ['', '']);
check('what a page you open is known by: its address without the scheme or #… (Google’s only)', [G.openKey('https://mail.google.com/mail/u/0/?a=1#inbox'), G.openKey('https://gmail.com/'), G.openKey('https://news.example/'), G.openKey('bifrost://newtab')], ['mail.google.com/mail/u/0/?a=1', 'gmail.com/', '', '']);
check('…and the page then says which account (no second time)', at(G.withAccount('https://drive.google.com/', 1)), '');

// ---- sites as typed in Settings
check('sites as typed', ['youtube.com', 'https://www.google.com/maps/', ' Docs.Google.com ', 'mail.google.com/mail?x=1', '', 'a b'].map((s) => G.parseSite(s)),
  [{ host: 'youtube.com', path: '' }, { host: 'www.google.com', path: '/maps' }, { host: 'docs.google.com', path: '' }, { host: 'mail.google.com', path: '/mail' }, null, null]);
check('the suggestions are all Google’s sites', G.SITES.every(([s]) => G.isGoogleHost(G.parseSite(s).host)), true);

console.log(`\ngoogle-accounts: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
