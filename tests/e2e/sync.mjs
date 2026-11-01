// Sync between two computers: two Bifrosts (separate profiles, running at once) share a folder the way two
// computers share a OneDrive folder. One has sync on already; the other turns it on in Settings with the
// OneDrive folder Bifrost finds, and they keep bookmarks, history, settings and open tabs alike both ways.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, startSite, reporter, assert, sleep } from './lib.mjs';

const R = reporter('sync');
const site = await startSite();
const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-sync-'));
const cloud = path.join(shared, 'OneDrive');
fs.mkdirSync(cloud);
const syncDir = path.join(cloud, 'Bifrost Sync');

const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error('timed out waiting for ' + label + (last !== undefined ? ' (last: ' + String(JSON.stringify(last)).slice(0, 300) + ')' : ''));
};
const bar = (t) => t.main(() => global.__bifrost.db.children(2).map((b) => b.title));
const inFolder = (t, title) => t.main((_, title) => { const db = global.__bifrost.db; const f = db.db.prepare("SELECT id FROM bookmarks WHERE title = ? AND type = 'folder'").get(title); return f ? db.children(f.id).map((b) => b.title) : null; }, title);
const setting = (t, p) => t.main((_, p) => global.__bifrost.settings.get(p), p);
const setSetting = (t, p, v) => t.main((_, [p, v]) => { global.__bifrost.settings.set(p, v); }, [p, v]);
const open = (t, url) => t.main((_, url) => global.__bifrost.registry.lastFocused().send('open-url', { url, background: false }), url);
const inPage = (t, match, code) => t.guest(match, code);
const visits = (t) => t.main(() => global.__bifrost.db.visits({ limit: 500 }).map((v) => ({ id: v.id, url: v.url, time: v.time, source: v.source })));
const deviceId = (t) => t.main(() => global.__bifrost.sync.info().device.id);
const go = (t, url) => t.ui((url) => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const tb = S.tabs.find((y) => y.id === ws.activeTabId); tb.wv.loadURL(url).catch(() => {}); }, url);

// A: set up earlier, sync on. B: a computer where Bifrost finds OneDrive and sync is still off.
const A = await launch({ profile: 'sync-a', settings: { sync: { enabled: true, folder: cloud, deviceName: 'Desk' } }, args: [site.url + '/a.html'] });
let B = await launch({ profile: 'sync-b', env: { OneDrive: cloud }, args: [site.url + '/b.html'] });
let idA, idB;

try {
  await sleep(1500);

  await R.step('a computer with sync on writes its bookmarks, history, settings and open tabs to the folder', async () => {
    await A.main(() => {
      const db = global.__bifrost.db;
      db.createBookmark({ parentId: 2, title: 'Alpha', url: 'https://alpha.example/' });
      db.createBookmark({ parentId: 2, title: 'Beta', url: 'https://beta.example/' });
      const f = db.createBookmark({ parentId: 2, title: 'Work' });
      db.createBookmark({ parentId: f.id, title: 'Docs', url: 'https://docs.example/' });
      db.createBookmark({ parentId: 2, title: 'Gamma', url: 'https://gamma.example/' });
    });
    await setSetting(A, 'appearance.theme', 'nord');
    await go(A, site.url + '/b.html?from-a');
    idA = await deviceId(A);
    const mine = path.join(syncDir, idA);
    await until(() => ['device.json', 'bookmarks.json.gz', 'settings.json', 'history.json.gz'].every((f) => fs.existsSync(path.join(mine, f))), 15000, 'A’s files');
    // The tabs and the history visit go out a little later; nudge them (as quitting or the timers would).
    await until(async () => {
      await A.main(() => global.__bifrost.sync.writeAll(true));
      const dev = JSON.parse(fs.readFileSync(path.join(mine, 'device.json'), 'utf8'));
      const bm = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(mine, 'bookmarks.json.gz'))).toString());
      return dev.name === 'Desk' && dev.windows.some((w) => w.tabs.some((t) => t.url.includes('from-a'))) && bm.nodes.some((n) => n.title === 'Docs') ? dev : null;
    }, 15000, 'A’s tabs and bookmarks in its files');
    assert(!fs.readdirSync(mine).some((f) => f.endsWith('.tmp')), 'no half-written files left: ' + fs.readdirSync(mine));
  });

  await R.step('turning sync on (with the OneDrive folder Bifrost found) brings everything from the other computer', async () => {
    await B.main(() => global.__bifrost.db.createBookmark({ parentId: 2, title: 'B own', url: 'https://b-own.example/' }));
    await setSetting(B, 'appearance.theme', 'latte');
    await open(B, 'bifrost://settings/#sync');
    const btn = await until(() => inPage(B, 'bifrost://settings', `(() => { const b = [...document.querySelectorAll('#sync button')].find((x) => /Use OneDrive/.test(x.textContent)); return b ? b.title : ''; })()`), 8000, 'the Use OneDrive button');
    assert(btn === cloud, 'it offers the OneDrive folder: ' + btn);
    await sleep(600);
    await B.shot('sync-00-off');
    await inPage(B, 'bifrost://settings', `[...document.querySelectorAll('#sync button')].find((x) => /Use OneDrive/.test(x.textContent)).click(); true`);
    await until(async () => (await setting(B, 'sync.enabled')) && (await setting(B, 'sync.folder')) === cloud, 4000, 'sync on with that folder');
    const got = await until(async () => { const t = await bar(B); return ['Alpha', 'Beta', 'Work', 'Gamma'].every((x) => t.includes(x)) && t.includes('B own') ? t : null; }, 15000, 'A’s bookmarks on B');
    eq(got, ['Alpha', 'Beta', 'Work', 'Gamma', 'B own'], 'B’s own bookmark after the ones already synced, nothing doubled');
    eq(await inFolder(B, 'Work'), ['Docs'], 'what’s in Work');
    // Settings: B joined, so A's win.
    await until(async () => (await setting(B, 'appearance.theme')) === 'nord', 8000, 'A’s theme on B');
    // History: A's visits, marked as from A.
    idB = await deviceId(B);
    await until(async () => (await visits(B)).some((v) => v.url.includes('from-a') && v.source === idA), 15000, 'A’s visits on B');
    // The bookmarks bar shows them.
    await until(() => B.ui(() => [...document.querySelectorAll('#bookmarks-bar .bm-item')].map((e) => e.textContent.trim()).join('|')).then((s) => /Alpha/.test(s) && /Gamma/.test(s) ? s : null), 6000, 'the bookmarks bar on B');
    // And A gets B's bookmark.
    await until(async () => (await bar(A)).includes('B own'), 15000, 'B’s bookmark on A');
    eq(await bar(A), await bar(B), 'the same bar on both');
    eq(await setting(A, 'appearance.theme'), 'nord', 'A keeps its theme');
  });

  await R.step('Settings lists the other computer, and says sync is up to date', async () => {
    const text = await until(() => inPage(B, 'bifrost://settings', `(() => { const d = document.querySelector('.sync-device'); return d ? document.querySelector('#sync').textContent : ''; })()`), 10000, 'the computers list');
    assert(/Desk/.test(text), 'Desk is listed: ' + text.slice(0, 400));
    assert(/Up to date/.test(text), 'status: ' + text.slice(0, 400));
    await B.shot('sync-01-settings');
  });

  await R.step('the other computer’s open tabs show in History and in the menu', async () => {
    await open(B, 'bifrost://history');
    const t = await until(() => inPage(B, 'bifrost://history', `(() => { const r = document.querySelector('.hist.remote'); return r && !r.hidden ? r.textContent : ''; })()`), 10000, 'tabs on other computers in History');
    assert(/Desk/.test(t) && /Page B/.test(t), 'History shows Desk’s tab: ' + t.slice(0, 300));
    const chip = await inPage(B, 'bifrost://history', `[...document.querySelectorAll('.chip.from')].map((c) => c.textContent).join('|')`);
    assert(/Desk/.test(chip), 'visits from Desk say so: ' + chip);
    await B.shot('sync-02-history');
    // The menu: History → Desk → the tab.
    await B.ui(() => document.querySelector('[data-tb="menu"]').click());
    await sleep(400);
    const opened = await B.ui(async () => {
      const find = (re) => [...document.querySelectorAll('.menu .menu-item')].find((e) => re.test(e.textContent));
      const hist = find(/^History/);
      if (!hist) return 'no History item';
      hist.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); hist.click();
      for (let i = 0; i < 30 && !find(/Desk/); i++) await new Promise((r) => setTimeout(r, 100));
      const desk = find(/Desk/);
      if (!desk) return 'no Desk item: ' + [...document.querySelectorAll('.menu .menu-item')].map((e) => e.textContent).join('|');
      desk.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); desk.click();
      for (let i = 0; i < 30 && !find(/Page B/); i++) await new Promise((r) => setTimeout(r, 100));
      const tab = find(/Page B/);
      if (!tab) return 'no tab item';
      tab.click();
      return 'ok';
    });
    assert(opened === 'ok', opened);
    await until(() => B.ui(() => window.__wbTest.state.tabs.some((x) => /from-a/.test(x.url))), 5000, 'the tab opened from the menu');
  });

  await R.step('changes on either computer reach the other within seconds', async () => {
    await B.main(() => {
      const db = global.__bifrost.db;
      const id = (t) => db.db.prepare('SELECT id FROM bookmarks WHERE title = ?').get(t).id;
      db.updateBookmark(id('Alpha'), { title: 'Alpha (renamed on B)' });
      db.removeBookmark(id('Beta'));
      db.createBookmark({ parentId: id('Work'), title: 'Made on B', url: 'https://made-on-b.example/' });
    });
    await setSetting(B, 'search.defaultEngine', 'ddg');
    await until(async () => { const t = await bar(A); return t.includes('Alpha (renamed on B)') && !t.includes('Beta') ? t : null; }, 12000, 'B’s changes on A');
    eq(await inFolder(A, 'Work'), ['Docs', 'Made on B'], 'what’s in Work on A');
    await until(async () => (await setting(A, 'search.defaultEngine')) === 'ddg', 8000, 'B’s search engine on A');
    // And back: A reorders, B follows.
    await A.main(() => { const db = global.__bifrost.db; const g = db.db.prepare("SELECT id FROM bookmarks WHERE title = 'Gamma'").get().id; db.moveBookmark(g, { parentId: 2, index: 0 }); });
    await until(async () => (await bar(B))[0] === 'Gamma', 12000, 'A’s reorder on B');
    eq(await bar(B), await bar(A), 'the same bar on both');
  });

  await R.step('one bookmark changed on both at once keeps both changes', async () => {
    await Promise.all([
      A.main(() => { const db = global.__bifrost.db; db.updateBookmark(db.db.prepare("SELECT id FROM bookmarks WHERE title = 'Gamma'").get().id, { title: 'Gamma (renamed on A)' }); }),
      B.main(() => { const db = global.__bifrost.db; const q = (t) => db.db.prepare('SELECT id FROM bookmarks WHERE title = ?').get(t).id; db.moveBookmark(q('Gamma'), { parentId: q('Work') }); }),
    ]);
    for (const t of [A, B]) await until(async () => { const w = await inFolder(t, 'Work'); return w && w.includes('Gamma (renamed on A)') ? w : null; }, 15000, 'the renamed bookmark in Work');
    eq(await bar(A), await bar(B), 'the same bar on both');
    eq(await inFolder(A, 'Work'), await inFolder(B, 'Work'), 'the same Work folder on both');
  });

  await R.step('deleting a visit on one computer deletes it on the other', async () => {
    // (B opened that page from the menu too: that visit of B's stays.)
    const v = (await visits(B)).find((x) => x.url.includes('from-a') && x.source === idA);
    const same = (x) => x.url === v.url && x.time === v.time;
    assert((await visits(A)).some((x) => same(x) && !x.source), 'A has the visit itself');
    await inPage(B, 'bifrost://history', `wb.invoke('history:delete-visit', ${v.id}).then(() => true)`);
    await until(async () => !(await visits(A)).some(same), 15000, 'the visit gone on A');
    assert((await visits(A)).some((x) => x.url === v.url && x.source === idB), 'B’s own visit to that page is still on A');
    await sleep(2500);
    assert(!(await visits(B)).some(same), 'and it didn’t come back on B');
  });

  await R.step('quitting saves the latest; what changed while a computer was off arrives when it starts', async () => {
    await B.close();
    const devB = JSON.parse(fs.readFileSync(path.join(syncDir, idB, 'device.json'), 'utf8'));
    assert(devB.windows.some((w) => w.tabs.some((t) => /from-a/.test(t.url))), 'B’s last tabs were saved as it quit: ' + JSON.stringify(devB.windows).slice(0, 300));
    await A.main(() => global.__bifrost.db.createBookmark({ parentId: 2, title: 'While B was off', url: 'https://later.example/' }));
    await A.main(() => global.__bifrost.sync.writeAll(true));
    await sleep(500);
    B = await launch({ profile: 'sync-b', fresh: false, env: { OneDrive: cloud } });
    await until(async () => (await bar(B)).includes('While B was off'), 15000, 'the new bookmark on B after it started');
    eq(await deviceId(B), idB, 'B is still the same computer');
  });

  await R.step('a new computer can turn sync on from the welcome page', async () => {
    const C = await launch({ profile: 'sync-c', env: { OneDrive: cloud } });
    try {
      // (A first start opens the welcome page by itself.)
      await until(() => inPage(C, 'bifrost://welcome', `!!document.querySelector('.w-step .btn.primary')`), 8000, 'the welcome page');
      eq(await C.ui(() => window.__wbTest.state.tabs.map((x) => x.url)), ['bifrost://welcome/'], 'just the welcome page open');
      await inPage(C, 'bifrost://welcome', `document.querySelector('.w-step .btn.primary').click(); true`);
      const btn = await until(() => inPage(C, 'bifrost://welcome', `(() => { const b = [...document.querySelectorAll('.w-step button')].find((x) => /Sync with this/.test(x.textContent)); return b ? b.closest('.w-import').textContent : ''; })()`), 8000, 'the sync step');
      assert(/OneDrive/.test(btn), 'it offers OneDrive: ' + btn);
      await sleep(400);
      await C.shot('sync-04-welcome');
      await inPage(C, 'bifrost://welcome', `[...document.querySelectorAll('.w-step button')].find((x) => /Sync with this/.test(x.textContent)).click(); true`);
      await until(async () => (await bar(C)).includes('While B was off'), 15000, 'the bookmarks on the new computer');
      const said = await until(() => inPage(C, 'bifrost://welcome', `(() => { const s = document.querySelector('.w-sync-status'); return s && /came over from/.test(s.textContent) ? s.textContent : ''; })()`), 10000, 'the welcome page saying where it came from');
      assert(/Desk/.test(said), said);
      await C.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); w.moveTop(); });   // (over A's and B's windows, to be painted)
      await sleep(800);
      await C.shot('sync-05-welcome-on');
      await C.main(() => global.__bifrost.settings.set('sync.enabled', false));
      const idC = await deviceId(C);
      await sleep(300);
      fs.rmSync(path.join(syncDir, idC), { recursive: true, force: true });
    } finally { await C.close(); }
  });

  await R.step('a computer can be taken out of sync; turning sync off stops it', async () => {
    await open(B, 'bifrost://settings/#sync');
    await until(() => inPage(B, 'bifrost://settings', `!!document.querySelector('#sync input[role=switch]')`), 8000, 'the settings page');
    await inPage(B, 'bifrost://settings', `document.querySelector('#sync input[role=switch]').click(); true`);
    await until(async () => (await setting(B, 'sync.enabled')) === false, 4000, 'sync off on B');
    await until(async () => (await B.main(() => global.__bifrost.sync.info().state)) === 'off', 4000, 'B’s sync stopped');
    await open(A, 'bifrost://settings/#sync-devices');
    await until(() => inPage(A, 'bifrost://settings', `!!document.querySelector('.sync-device[data-device="${idB}"] button')`), 10000, 'B in A’s list');
    await inPage(A, 'bifrost://settings', `document.querySelector('.sync-device[data-device="${idB}"] button').click(); true`);
    await until(() => inPage(A, 'bifrost://settings', `(() => { const b = [...document.querySelectorAll('.dialog .btn.danger')].find((x) => /Remove/.test(x.textContent)); if (b) b.click(); return !!b; })()`), 4000, 'the confirm dialog');
    await until(() => !fs.existsSync(path.join(syncDir, idB)), 6000, 'B’s files gone');
    await until(() => inPage(A, 'bifrost://settings', `!document.querySelector('.sync-device[data-device="${idB}"]')`), 4000, 'B gone from the list');
    await B.main(() => global.__bifrost.db.createBookmark({ parentId: 2, title: 'After sync off', url: 'https://off.example/' }));
    await sleep(3000);
    assert(!fs.existsSync(path.join(syncDir, idB)), 'B wrote nothing with sync off');
    assert(!(await bar(A)).includes('After sync off'), 'nothing new reached A');
    await A.shot('sync-03-devices');
  });
} finally {
  const errs = [...A.logs, ...B.logs].filter((l) => /pageerror|Uncaught|\[ui error\]|\[sync\]/.test(l));
  if (errs.length) console.log('errors:\n  ' + errs.slice(0, 12).join('\n  '));
  await A.close(); await B.close().catch(() => {}); site.stop();
  fs.rmSync(shared, { recursive: true, force: true });
  process.exit(R.summary() ? 1 : 0);
}

function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
