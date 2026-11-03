// Everyday browsing: video, full screen, PDFs, pop-ups, "Leave site?", permission prompts, find, zoom,
// private windows, the link context menu, reordering tabs by dragging, copying the address.
import { launch, startSite, reporter, assert, sleep, xinput } from './lib.mjs';

const R = reporter('everyday');
const html = (body, title = 'Test') => (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif;margin:30px">${body}</body>`); };
const site = await startSite(undefined, { routes: {
  '/video.html': html('<video id=v src="/media/clip.webm" autoplay muted loop width=320></video><video id=m src="/media/clip.mp4" autoplay muted loop width=320></video>', 'Video'),
  '/fs.html': html('<button id=b style="font-size:30px;padding:30px" onclick="document.documentElement.requestFullscreen()">Full screen</button>', 'Fullscreen'),
  '/popup.html': html('<button id=b style="font-size:30px;padding:30px" onclick="window.open(\'/b.html?clicked\')">Open</button><script>setTimeout(() => window.open(\'/a.html?spam\'), 300)</script>', 'Popups'),
  '/unload.html': html('<input id=i value="unsaved"><script>window.onbeforeunload = (e) => { e.preventDefault(); e.returnValue = ""; };</script>', 'Unsaved'),
  '/geo.html': html('<button id=b style="font-size:30px;padding:30px" onclick="navigator.geolocation.getCurrentPosition(() => document.title = \'geo ok\', (e) => document.title = \'geo \' + e.code)">Where am I</button>', 'Geo'),
  '/find.html': html('<p>The quick brown fox jumps over the lazy dog. A fox again. And one more fox.</p>', 'Find'),
  '/links2.html': html('<p><a id=l href="/b.html?ctx" style="font-size:28px">A link to open in a new tab</a></p>', 'Links'),
  // "Sign in with…": the site opens the provider's page in a sized pop-up, which signs in (a cookie), tells
  // the site through window.opener and closes itself.
  '/signin.html': html('<button id=b style="font-size:30px;padding:30px" onclick="window.open(\'/auth.html\', \'auth\', \'width=480,height=600\')">Sign in</button><script>document.cookie = "site=1; path=/"; addEventListener("message", (e) => { if (e.data && e.data.signedIn) { window.__auth = { ...e.data, siteSees: document.cookie }; document.title = "signed in"; } });</script>', 'Sign in'),
  '/notify.html': html('<button id=ask style="font-size:30px;padding:30px">Turn on notifications</button><script>window.__log = []; const log = (x) => window.__log.push(x); log("initial " + Notification.permission); navigator.permissions.query({ name: "notifications" }).then((r) => { window.__st = r; log("query " + r.state); r.onchange = () => log("changed " + r.state); }); document.getElementById("ask").onclick = async () => { const r = await Notification.requestPermission(); log("requested " + r); }; window.notify = () => { const n = new Notification("Hello", { body: "From the page" }); window.__n = n; n.onclick = () => log("clicked"); return n instanceof Notification; };</script>', 'Notify'),
  '/auth.html': html('<p>Signing you in…</p><script>document.cookie = "sid=popup123; path=/"; setTimeout(() => { window.opener.postMessage({ signedIn: true, popupSees: document.cookie, ua: navigator.userAgent }, "*"); setTimeout(() => window.close(), 400); }, 300);</script>', 'Provider'),
} });
const t = await launch({ profile: 'everyday', args: [site.url + '/a.html'] });
const x = xinput();
const set = (p, v) => t.main((_, [p, v]) => global.__bifrost.settings.set(p, v), [p, v]);
const open = (url, background = false) => t.main((_, [url, background]) => global.__bifrost.registry.lastFocused().send('open-url', { url, background }), [url, background]);
const tabCount = () => t.ui(() => window.__wbTest.state.tabs.length);
const tabUrls = () => t.ui(() => window.__wbTest.state.tabs.map((tb) => tb.url));
const view = () => t.ui(() => { const w = [...document.querySelectorAll('#views webview')].find((e) => e.getBoundingClientRect().width > 50 && getComputedStyle(e).visibility !== 'hidden'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// Clicks an element of the page in the current tab with the real pointer.
async function clickIn(match, sel, button = 1) {
  // (CSS pixels to screen pixels: a zoomed page has bigger ones.)
  const r = await t.guest(match, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const z = window.devicePixelRatio || 1; return { x: (r.x + Math.min(r.width / 2, 40)) * z, y: (r.y + r.height / 2) * z }; })()`);
  const v = await view();
  await x.click(v.x + r.x, v.y + r.y, button);
}
const esc = async () => { await x.key('Escape'); await sleep(250); };
const until = async (fn, ms, label) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(120); }
  throw new Error('timed out waiting for ' + label + (last ? ' (last: ' + String(JSON.stringify(last)).slice(0, 200) + ')' : ''));
};

try {
  await sleep(1000);
  await R.step('videos play (VP9/Opus and H.264)', async () => {
    await open(site.url + '/video.html');
    await sleep(3000);
    const r = await t.guest('/video.html', `(() => { const v = document.getElementById('v'), m = document.getElementById('m'); return { v: [v.currentTime, v.videoWidth, v.error && v.error.code], m: [m.currentTime, m.videoWidth, m.error && m.error.code] }; })()`);
    assert(r.v[0] > 0.5 && r.v[1] === 320, 'webm: ' + JSON.stringify(r.v));
    assert(r.m[0] > 0.5 && r.m[1] === 320, 'mp4: ' + JSON.stringify(r.m));
  });

  await R.step('a page can go full screen, and Esc brings it back', async () => {
    await open(site.url + '/fs.html'); await sleep(900);
    await clickIn('/fs.html', '#b');
    await sleep(1200);
    const inFs = await t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui')); return w.isFullScreen(); });
    const v = await view();
    const b = await t.bounds();
    assert(inFs, 'the window didn’t go full screen');
    assert(v.w >= b.width - 2 && v.y <= 1, `the page doesn't fill the screen: ${JSON.stringify(v)} in ${JSON.stringify(b)}`);
    await x.key('Escape');
    await until(() => t.main(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui')); return !w.isFullScreen(); }), 5000, 'the window to leave full screen after Esc');
    assert(!(await t.guest('/fs.html', '!!document.fullscreenElement')), 'the page still thinks it’s full screen');
    await until(async () => { const v = await view(); return v.x > 100 && v.y > 30; }, 4000, 'the window’s layout to come back');
    await sleep(500);
  });

  await R.step('over a page in full screen: the Esc hint shows; its right-click menu is the system’s; an alert, Ctrl+F and Ctrl+1 bring the page back and work', async () => {
    const isFs = () => t.main(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui')).isFullScreen());
    const pixel = (px, py) => t.main(async ({ BrowserWindow }, [px, py]) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
      const b = (await w.webContents.capturePage({ x: Math.round(px), y: Math.round(py), width: 1, height: 1 })).toBitmap();
      return (0.2126 * b[2] + 0.7152 * b[1] + 0.0722 * b[0]) / 255;
    }, [px, py]);
    const enterFs = async () => {
      if (await isFs()) return;
      await clickIn('/fs.html?over', '#b');
      await until(isFs, 4000, 'full screen');
      await until(() => t.ui(() => !!document.fullscreenElement), 3000, 'the page to be full screen');
      await sleep(500);
    };
    await open(site.url + '/fs.html?over'); await sleep(900);
    await enterFs();
    // The hint: a dark pill, over the (white) page.
    const hint = await t.ui(() => { const e = document.querySelector('.fs-hint.on'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    assert(hint, 'no “Press Esc” hint');
    const hl = await pixel(hint.x, hint.y);
    assert(hl < 0.35, `the hint isn't on screen (brightness there: ${hl.toFixed(2)})`);
    // Right-click: the system's menu (the window's own can't go over the page), and full screen stays.
    await t.main(() => { global.__bifrostLastNativeMenu = null; });
    await x.click(700, 500, 3);
    const spec = await until(() => t.main(() => global.__bifrostLastNativeMenu && global.__bifrostLastNativeMenu.spec.map((o) => o.label || '-')), 3000, 'the system menu');
    assert(spec.includes('Reload'), 'menu items: ' + spec.join(', '));
    assert(!(await t.ui(() => !!document.querySelector('.menu'))), 'the window’s own menu opened too');
    await t.main(() => { try { global.__bifrostLastNativeMenu.menu.closePopup(); } catch { /* closed */ } });
    await sleep(400);
    assert(await isFs(), 'the menu took the page out of full screen');
    // An alert: shown, and its OK can be clicked.
    await t.guest('/fs.html?over', 'setTimeout(() => { alert("Hello from full screen"); document.title = "alert answered"; }, 50); 1');
    const ok = await until(() => t.ui(() => { const b = [...document.querySelectorAll('.dialog .btn.primary')].pop(); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 4000, 'the alert');
    await sleep(500);
    await x.click(ok.x, ok.y);
    await until(() => t.ui(() => !document.querySelector('.dialog')), 3000, 'the click to answer the alert');
    await until(() => t.guest('/fs.html?over', 'document.title === "alert answered"'), 3000, 'the page to get the answer');
    // Ctrl+F: the page comes back, and the find bar opens with the keyboard in it.
    await enterFs();
    await x.keyDown('Control_L'); await x.key('f'); await x.keyUp('Control_L');
    await until(async () => !(await isFs()), 4000, 'Ctrl+F to bring the page back');
    await until(() => t.ui(() => { const i = document.querySelector('.find-input'); return i && document.activeElement === i; }), 3000, 'the find bar, focused');
    await x.key('Escape'); await sleep(400);
    // Ctrl+1 (another tab): the page comes back.
    await enterFs();
    await x.keyDown('Control_L'); await x.key('1'); await x.keyUp('Control_L');
    await until(async () => !(await isFs()), 4000, 'switching tabs to leave full screen');
    await until(async () => { const v = await view(); return v.x > 100 && v.y > 30; }, 4000, 'the layout to come back');
    const first = await t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); const list = S.tabs.filter((tb) => tb.workspaceId === ws.id); return list[0].id === ws.activeTabId; });
    assert(first, 'Ctrl+1 didn’t switch to the first tab');
    assert(!(await t.guest('/fs.html?over', '!!document.fullscreenElement')), 'the page is still full screen');
    await sleep(300);
  });

  await R.step('PDFs open in the tab (not as a download)', async () => {
    const before = await t.main(() => global.__bifrost.downloads.list().length);
    await open(site.url + '/media/doc.pdf'); await sleep(3000);
    const urls = await tabUrls();
    assert(urls.some((u) => /doc\.pdf$/.test(u)), 'no tab with the PDF: ' + urls.join(', '));
    const after = await t.main(() => global.__bifrost.downloads.list().length);
    assert(after === before, 'it was downloaded instead');
    const err = await t.ui(() => !!document.querySelector('.err-card'));
    assert(!err, 'an error page');
    await t.shot('everyday-pdf');
  });

  await R.step('pop-ups: a click opens one; a page opening one by itself is blocked (and says so)', async () => {
    const before = await tabCount();
    await open(site.url + '/popup.html'); await sleep(1500);
    const afterLoad = await tabCount();
    assert(afterLoad === before + 1, `a pop-up opened by itself (${before} → ${afterLoad} tabs): ${(await tabUrls()).slice(-3).join(', ')}`);
    const toast = await t.ui(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
    assert(/pop-?up/i.test(toast), 'nothing said it was blocked: ' + toast);
    await clickIn('/popup.html', '#b'); await sleep(1200);
    assert((await tabUrls()).some((u) => /b\.html\?clicked/.test(u)), 'the clicked pop-up didn’t open');
  });

  await R.step('a sign-in pop-up is a window of its own, shares the tab’s cookies, reaches the site through window.opener and closes itself', async () => {
    await open(site.url + '/signin.html'); await sleep(900);
    const tabs = await tabCount();
    const popups = () => t.main(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('/auth.html')).map((w) => ({ visible: w.isVisible(), b: w.getBounds() })));
    await clickIn('/signin.html', '#b');
    const opened = await until(async () => { const p = await popups(); return p.length ? p : null; }, 5000, 'the pop-up window');
    assert(opened.length === 1 && opened[0].visible, 'pop-up: ' + JSON.stringify(opened));
    const auth = await until(() => t.guest('/signin.html', 'window.__auth || null'), 6000, 'the pop-up’s message to the site');
    assert(/site=1/.test(auth.popupSees), 'the pop-up doesn’t share the tab’s cookies: ' + auth.popupSees);
    assert(/sid=popup123/.test(auth.siteSees), 'the site doesn’t see the cookie the pop-up set: ' + auth.siteSees);
    const tabUa = await t.guest('/signin.html', 'navigator.userAgent');
    assert(auth.ua === tabUa && !/Electron|Bifrost/i.test(auth.ua), `the pop-up's user agent: ${auth.ua} (the tab's: ${tabUa})`);
    await until(async () => (await popups()).length === 0, 5000, 'the pop-up to close itself');
    assert(await tabCount() === tabs, 'the pop-up became a tab');
  });

  await R.step('closing a page with unsaved changes asks first (Stay keeps it, Leave closes it)', async () => {
    await open(site.url + '/unload.html'); await sleep(900);
    await clickIn('/unload.html', '#i'); await x.key('a'); await sleep(200);   // (pages only ask after you've interacted)
    const n = await tabCount();
    await t.ui(() => window.__wbTest.command('closeTab'));
    await until(() => t.ui(() => [...document.querySelectorAll('.dialog')].some((d) => /leave/i.test(d.textContent))), 4000, 'the question');
    await sleep(300);
    await x.key('Escape');
    await until(() => t.ui(() => !document.querySelector('.dialog')), 3000, 'the dialog to close');
    await sleep(400);
    assert(await tabCount() === n, 'Stay closed the tab');
    await t.ui(() => window.__wbTest.command('closeTab'));
    const btn = await until(() => t.ui(() => { const b = [...document.querySelectorAll('.dialog button')].find((e) => /leave/i.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }), 4000, 'the Leave button');
    await sleep(350);
    await x.click(btn.x, btn.y);
    await until(async () => (await tabCount()) === n - 1, 4000, 'the tab to close after Leave');
  });

  await R.step('a site asking for your location gets a prompt; Block answers it', async () => {
    await open(site.url + '/geo.html'); await sleep(900);
    await clickIn('/geo.html', '#b');
    const prompt = await until(() => t.ui(() => { const p = document.querySelector('.perm'); return p ? p.textContent : ''; }), 5000, 'the prompt');
    assert(/location/i.test(prompt), 'the prompt doesn’t say what it’s for: ' + prompt);
    await sleep(300);
    // While it waits for an answer, the page and the rest of the window still work: a click on the page
    // reaches it.
    await t.guest('/geo.html', 'window.__clicked = 0; addEventListener("click", () => { window.__clicked++; }); 1');
    const v = await view();
    await x.click(v.x + 200, v.y + v.h - 120); await sleep(300);
    assert(await t.guest('/geo.html', 'window.__clicked') === 1, 'a click on the page didn’t reach it while the prompt was showing');
    assert(await t.ui(() => !!document.querySelector('.perm')), 'the prompt went away');
    const b = await t.ui(() => { const e = [...document.querySelectorAll('.perm button')].find((x) => /block|don/i.test(x.textContent)); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await x.click(b.x, b.y);
    const title = await until(() => t.guest('/geo.html', 'document.title').then((v) => (v !== 'Geo' ? v : null)), 4000, 'the page’s answer');
    assert(title === 'geo 1', 'the page got: ' + title);
  });

  await R.step('notifications: a site you haven’t answered can ask (it isn’t told “blocked”); the address bar’s permissions button shows what was blocked and allows it at once; a notification’s click brings its tab to the front', async () => {
    const logOf = () => t.guest('/notify.html', 'window.__log');
    await open(site.url + '/notify.html'); await sleep(1500);
    const first = await logOf();
    assert(first.includes('initial default') && first.includes('query prompt'), 'the page is told: ' + JSON.stringify(first));
    const btnState = () => t.ui(() => { const b = document.querySelector('.addr-btn.permsb'); return b && { hidden: b.hidden, icon: b.dataset.icon, blocked: b.classList.contains('blocked'), title: b.title }; });
    let bs = await btnState();
    assert(bs && !bs.hidden && !bs.blocked, 'the permissions button: ' + JSON.stringify(bs));
    // The site asks (from a click), and is told no.
    await clickIn('/notify.html', '#ask');
    const block = await until(() => t.ui(() => { const b = [...document.querySelectorAll('.perm-pop .btn')].find((e) => /Block/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 4000, 'the prompt');
    await x.click(block.x, block.y);
    await until(async () => (await logOf()).includes('requested denied'), 3000, 'the page to hear no');
    bs = await until(async () => { const v = await btnState(); return v && v.blocked ? v : null; }, 3000, 'the button to show it was blocked');
    assert(bs.icon === 'bellOff' && /Notifications blocked/.test(bs.title), 'the button: ' + JSON.stringify(bs));
    // The button: what it asked for, and Allow, which the page hears straight away (no reload).
    const pb = await t.ui(() => { const r = document.querySelector('.addr-btn.permsb').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await x.click(pb.x, pb.y);
    const allow = await until(() => t.ui(() => { const b = document.querySelector('.perms-pop [data-act="allow-notifications"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 3000, 'the permissions popover');
    await t.shot('everyday-permissions');
    await x.click(allow.x, allow.y);
    await until(async () => (await t.guest('/notify.html', 'Notification.permission')) === 'granted', 3000, 'the page to be allowed');
    assert(await t.guest('/notify.html', 'window.__st.state') === 'granted' && (await logOf()).includes('changed granted'), 'the Permissions API didn’t follow: ' + JSON.stringify(await logOf()));
    const stored = await t.main(() => global.__bifrost.db.siteSettings('127.0.0.1')['perm:notifications']);
    assert(stored === 'allow', 'stored: ' + stored);
    bs = await btnState();
    assert(!bs.blocked, 'still marked blocked: ' + JSON.stringify(bs));
    // A notification, clicked while another tab is in front.
    assert(await t.guest('/notify.html', 'window.notify()') === true, 'no notification');
    await open(site.url + '/a.html?front'); await sleep(900);
    await t.guest('/notify.html', 'window.__n.dispatchEvent(new Event("click")), 1');
    await until(() => t.ui(() => { const S = window.__wbTest.state; const w = S.workspaces.find((x) => x.id === S.activeWorkspaceId); return /notify\.html/.test(S.tabs.find((x) => x.id === w.activeTabId).url); }), 3000, 'its tab in front');
    // Back to Ask (as from the popover): the page is told it isn't decided.
    await t.ui(() => window.wb.invoke('site:set', '127.0.0.1', 'perm:notifications', null));
    await until(async () => (await t.guest('/notify.html', 'Notification.permission')) === 'default', 3000, 'the page to be told “ask”');
    await esc();
  });

  await R.step('the keyboard follows the tab on screen (Ctrl+Tab, a new tab, a link opening a tab, reopening a closed tab)', async () => {
    await t.main(({ app, webContents }) => {
      global.__keysTo = [];
      if (global.__keysHooked) return;
      global.__keysHooked = true;
      const hook = (wc) => wc.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F7') global.__keysTo.push(wc.getType() === 'webview' ? wc.getURL() : 'the window'); });
      for (const wc of webContents.getAllWebContents()) hook(wc);
      app.on('web-contents-created', (e, wc) => hook(wc));
    });
    const keysGoTo = async () => { await t.main(() => { global.__keysTo = []; }); await x.key('F7'); await sleep(300); return (await t.main(() => global.__keysTo)).join(' ') || 'nowhere'; };
    const onScreen = () => t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); return S.tabs.find((x) => x.id === ws.activeTabId).url; });
    const check = async (what) => { const k = await keysGoTo(), v = await onScreen(); assert(k === v, `${what}: keys go to ${k}, the tab on screen is ${v}`); };
    await open(site.url + '/a.html?focus1'); await sleep(1200);
    await clickIn('?focus1', 'p'); await sleep(200);
    await open(site.url + '/b.html?focus2'); await sleep(1500);
    await check('a new tab');
    await x.keyDown('Control_L'); await x.key('Tab'); await x.keyUp('Control_L'); await sleep(900);
    await check('Ctrl+Tab');
    await x.keyDown('Control_L'); await x.keyDown('Shift_L'); await x.key('Tab'); await x.keyUp('Shift_L'); await x.keyUp('Control_L'); await sleep(900);
    await check('Ctrl+Shift+Tab');
    await x.keyDown('Control_L'); await x.key('w'); await x.keyUp('Control_L'); await sleep(900);
    await check('Ctrl+W');
    await t.ui(() => window.__wbTest.command('reopenTab')); await sleep(1500);
    await check('reopening the closed tab');
  });

  await R.step('the mouse’s back and forward buttons go back and forward', async () => {
    const onScreen = () => t.ui(() => { const S = window.__wbTest.state; const ws = S.workspaces.find((w) => w.id === S.activeWorkspaceId); return S.tabs.find((x) => x.id === ws.activeTabId).url; });
    await open(site.url + '/a.html?mouse'); await sleep(1200);
    await clickIn('?mouse', '#to-b');
    await until(async () => /\/b\.html$/.test(await onScreen()), 5000, 'the link to Page B');
    const v = await view();
    await x.click(v.x + 500, v.y + 300, 8);
    await until(async () => /a\.html\?mouse$/.test(await onScreen()), 5000, 'the back button (button 8) to go back');
    await x.click(v.x + 500, v.y + 300, 9);
    await until(async () => /\/b\.html$/.test(await onScreen()), 5000, 'the forward button (button 9) to go forward');
  });

  await R.step('find in page counts the matches and moves through them', async () => {
    await open(site.url + '/find.html'); await sleep(900);
    await t.ui(() => window.__wbTest.command('find')); await sleep(300);
    for (const k of ['f', 'o', 'x']) await x.key(k);
    await until(() => t.ui(() => /1\s*\/\s*3/.test((document.querySelector('.find-count') || {}).textContent || '')), 4000, '“1/3”');
    await x.key('Return');
    await until(() => t.ui(() => /2\s*\/\s*3/.test((document.querySelector('.find-count') || {}).textContent || '')), 3000, '“2/3” after Enter');
    await esc();
  });

  await R.step('zooming a site sticks to that site', async () => {
    await t.ui(() => window.__wbTest.command('zoomIn')); await sleep(500);
    const z = await t.main(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes('/find.html')).getZoomLevel());
    assert(z > 0, 'zoom ' + z);
    await open(site.url + '/a.html?other'); await sleep(900);
    const z2 = await t.main(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes('a.html?other')).getZoomLevel());
    assert(Math.abs(z2 - z) < 0.01, `same site, different zoom: ${z2} vs ${z}`);
    await t.ui(() => window.__wbTest.command('zoomReset')); await sleep(300);
  });

  await R.step('a right-click on a page opens its menu right at the pointer', async () => {
    await open(site.url + '/a.html?ctxpos'); await sleep(1000);
    const v = await view();
    const at = { x: Math.round(v.x + 300), y: Math.round(v.y + 150) };
    await x.click(at.x, at.y, 3);
    const m = await until(() => t.ui(() => { const e = document.querySelector('.menu'); return e ? { x: parseFloat(e.style.left), y: parseFloat(e.style.top) } : null; }), 3000, 'the menu');
    await esc();
    assert(Math.abs(m.x - at.x) <= 3 && Math.abs(m.y - at.y) <= 3, `pointer at ${at.x},${at.y}, menu at ${m.x},${m.y}`);
  });

  await R.step('the link menu: Open link in new tab', async () => {
    await open(site.url + '/links2.html'); await sleep(900);
    const n = await tabCount();
    await clickIn('/links2.html', '#l', 3);
    await until(() => t.ui(() => !!document.querySelector('.menu')), 3000, 'the menu');
    await sleep(250);
    const item = await t.ui(() => { const e = [...document.querySelectorAll('.menu .mi, .menu button, .menu [role=menuitem]')].find((x) => /open link in new tab/i.test(x.textContent)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
    assert(item, 'no “Open link in new tab”: ' + await t.ui(() => (document.querySelector('.menu') || {}).textContent));
    await x.click(item.x, item.y); await sleep(1000);
    assert(await tabCount() === n + 1 && (await tabUrls()).some((u) => /b\.html\?ctx/.test(u)), 'no new tab with the link');
  });

  await R.step('dragging a tab moves it', async () => {
    const before = await t.ui(() => [...document.querySelectorAll('#tablist .tab[data-id]')].map((e) => e.dataset.id));
    const [a, c] = await t.ui(() => { const els = [...document.querySelectorAll('#tablist .tab[data-id]')]; const r0 = els[0].getBoundingClientRect(), r3 = els[3].getBoundingClientRect(); return [{ x: r0.x + 60, y: r0.y + r0.height / 2 }, { x: r3.x + 60, y: r3.y + r3.height * 0.8 }]; });
    await x.move(a.x, a.y); await x.down(); await sleep(80);
    for (let i = 1; i <= 12; i++) { await x.move(a.x, a.y + (c.y - a.y) * i / 12); await sleep(30); }
    await sleep(150); await x.up(); await sleep(600);
    const after = await t.ui(() => [...document.querySelectorAll('#tablist .tab[data-id]')].map((e) => e.dataset.id));
    assert(after[0] !== before[0] && after.indexOf(before[0]) >= 2, `order: ${before.slice(0, 5).join(',')} → ${after.slice(0, 5).join(',')}`);
    await x.move(900, 600);
  });

  await R.step('dragging a tab up to the top pins it', async () => {
    const info = await t.ui(() => {
      const els = [...document.querySelectorAll('#tablist .tab[data-id]')];
      const r1 = els[1].getBoundingClientRect(), top = document.getElementById('tablist-wrap').getBoundingClientRect().top;
      return { id: els[1].dataset.id, x: r1.x + 60, y: r1.y + r1.height / 2, top, pinned: document.querySelectorAll('#pinned .tab[data-id]').length };
    });
    assert(info.pinned === 0, 'there were pinned tabs already');
    await x.move(info.x, info.y); await x.down(); await sleep(80);
    // Down a little first: the zone mustn't open (and shift the list) until the tab goes up to it.
    await x.move(info.x, info.y + 10); await sleep(120);
    const early = await t.ui(() => document.documentElement.classList.contains('pin-drop-open'));
    for (let i = 1; i <= 10; i++) { await x.move(info.x, info.y + 10 - (info.y + 10 - (info.top - 14)) * i / 10); await sleep(30); }
    await sleep(250);
    const zone = await t.ui(() => { const r = document.getElementById('pinned').getBoundingClientRect(); return { open: document.documentElement.classList.contains('pin-drop-open'), h: r.height, top: r.top }; });
    // Into the middle of the open zone.
    await x.move(info.x, zone.top + zone.h / 2); await sleep(200);
    await x.up(); await sleep(600);
    const pinned = await t.ui((id) => !!document.querySelector(`#pinned .tab[data-id="${id}"]`), info.id);
    const left = await t.ui(() => document.documentElement.classList.contains('pin-drop-open') || document.documentElement.classList.contains('tab-dragging'));
    // Unpin it again for the steps after this one (select it, then Pin or unpin tab).
    if (pinned) {
      const pr = await t.ui((id) => { const r = document.querySelector(`#pinned .tab[data-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, info.id);
      await x.move(pr.x, pr.y); await x.click(); await sleep(300);
      await t.ui(() => window.__wbTest.command('pinTab')); await sleep(400);
    }
    assert(!early, 'the pin zone opened as soon as the drag started');
    assert(zone.open && zone.h >= 30, `the pin zone didn't open (${JSON.stringify(zone)})`);
    assert(pinned, 'the tab was not pinned');
    assert(!left, 'drag classes left on the window');
    await x.move(900, 600);
  });

  // (the sidebar, the sidebar collapsed to icons, horizontal tabs)
  const LAYOUTS = [['sidebar', { 'appearance.tabLayout': 'vertical', 'appearance.sidebarCollapsed': false }],
    ['collapsed sidebar', { 'appearance.tabLayout': 'vertical', 'appearance.sidebarCollapsed': true }],
    ['horizontal tabs', { 'appearance.tabLayout': 'horizontal', 'appearance.sidebarCollapsed': false }]];
  const useLayout = async (cfg) => { for (const [p, v] of Object.entries(cfg)) await set(p, v); await sleep(700); };
  const stripSel = (name) => (name === 'horizontal tabs' ? '#htabs .tab[data-id]:not(.pinned)' : '#tablist .tab[data-id]');

  await R.step('dragging a tab: it stays under the pointer to the end and lands right where its place was (sidebar, collapsed sidebar, horizontal tabs)', async () => {
    try {
      for (const [name, cfg] of LAYOUTS) {
        await useLayout(cfg);
        const sel = stripSel(name);
        const els = await t.ui((sel) => [...document.querySelectorAll(sel)].slice(0, 3).map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height }; }), sel);
        assert(els.length >= 2, name + ': tabs ' + JSON.stringify(els));
        const [a, b] = els;
        const horiz = name === 'horizontal tabs';
        // Every frame: where the pointer is, and the dragged tab and its place.
        await t.ui(() => {
          window.__dl = []; window.__pt = null; window.__upAt = 0;
          window.__dlMove = (e) => { window.__pt = [e.clientX, e.clientY]; };
          window.__dlUp = () => { window.__upAt = performance.now(); };
          addEventListener('pointermove', window.__dlMove, true);
          addEventListener('pointerup', window.__dlUp, true);
          const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
          const tick = () => {
            const g = document.querySelector('.tab-ghost');
            const shown = (s) => { const e = g && g.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
            window.__dl.push({ t: performance.now(), pt: window.__pt, g: box(g), ph: box(document.querySelector('.tab-placeholder')), title: shown('.tab-title'), close: shown('.tab-close') });
            if (window.__dl.length < 600) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const sx = a.x + (horiz ? a.w / 2 : Math.min(a.w / 2, 30)), sy = a.y + a.h / 2;
        const ex = horiz ? b.x + b.w * 0.8 : sx, ey = horiz ? sy : b.y + b.h * 0.8;
        await x.move(sx, sy); await x.down(); await sleep(80);
        for (let i = 1; i <= 14; i++) { await x.move(sx + (ex - sx) * i / 14, sy + (ey - sy) * i / 14); await sleep(30); }
        await sleep(120);
        await x.up(); await sleep(700); await x.move(900, 600);
        const log = await t.ui(() => { removeEventListener('pointermove', window.__dlMove, true); removeEventListener('pointerup', window.__dlUp, true); return { frames: window.__dl.splice(0), up: window.__upAt }; });
        const held = log.frames.filter((f) => f.g && f.pt && f.t < log.up);
        const settling = log.frames.filter((f) => f.g && f.t > log.up + 20);
        assert(held.length > 5, name + ': no dragged tab seen while held');
        // Held: always the same distance from the pointer (where it was taken).
        const off = [held[0].pt[0] - held[0].g[0], held[0].pt[1] - held[0].g[1]];
        const drift = Math.max(...held.slice(1).map((f) => Math.max(Math.abs(f.pt[0] - f.g[0] - off[0]), Math.abs(f.pt[1] - f.g[1] - off[1]))));
        assert(drift <= 3, `${name}: the dragged tab drifted ${drift.toFixed(1)}px from the pointer`);
        // Let go: it glides from the pointer to its place, and nowhere else.
        const start = held[held.length - 1].g, ph = held[held.length - 1].ph;
        assert(ph, name + ': no place for it');
        const lo = [Math.min(start[0], ph[0]) - 4, Math.min(start[1], ph[1]) - 4], hi = [Math.max(start[0], ph[0]) + 4, Math.max(start[1], ph[1]) + 4];
        const astray = settling.find((f) => f.g[0] < lo[0] || f.g[0] > hi[0] || f.g[1] < lo[1] || f.g[1] > hi[1]);
        assert(!astray, `${name}: on the drop it went to ${JSON.stringify(astray && astray.g.map(Math.round))}, between ${JSON.stringify(start.map(Math.round))} and its place ${JSON.stringify(ph.map(Math.round))}`);
        if (settling.length) { const end = settling[settling.length - 1].g; assert(Math.abs(end[0] - ph[0]) <= 4 && Math.abs(end[1] - ph[1]) <= 4, `${name}: it ended at ${JSON.stringify(end.map(Math.round))}, its place is ${JSON.stringify(ph.map(Math.round))}`); }
        // Looks like the tab it is: an icon tile in the collapsed sidebar (no title or close button sticking out).
        if (name === 'collapsed sidebar') assert(!held.some((f) => f.title || f.close), 'the dragged icon tile shows a title or a close button');
        const after = await t.ui((sel) => ({ ids: [...document.querySelectorAll(sel)].map((e) => e.dataset.id), left: document.querySelectorAll('.tab-ghost, .tab-placeholder').length }), sel);
        assert(after.ids.indexOf(a.id) === 1 && after.ids[0] === b.id && !after.left, `${name}: order ${JSON.stringify(els.map((e) => e.id))} → ${JSON.stringify(after)}`);
      }
    } finally { await useLayout(LAYOUTS[0][1]); }
  });

  await R.step('tab groups: a line in the group’s color from its label along every tab in it, as in Chrome (sidebar, collapsed sidebar, horizontal tabs); none while the group is put away', async () => {
    const pixels = (r) => t.main(async ({ BrowserWindow }, r) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bifrost://ui'));
      const img = await w.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) });
      const s = img.getSize(), b = img.toBitmap();
      return { w: s.width, h: s.height, px: [...b] };
    }, r);
    const at = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.px[i + 2], img.px[i + 1], img.px[i]]; };
    const near = (c, d, tol = 40) => Math.abs(c[0] - d[0]) <= tol && Math.abs(c[1] - d[1]) <= tol && Math.abs(c[2] - d[2]) <= tol;
    let gid = null;
    try {
      await useLayout(LAYOUTS[0][1]);
      // Three tabs in a green group (with the tab in front in it): click one, Ctrl+click two more, Group tabs.
      for (const p of ['wide.html', 'colors.html']) { await open(site.url + '/' + p + '?grp', true); await sleep(300); }
      await sleep(800);
      const pick = (u) => t.ui((u) => { const e = [...document.querySelectorAll('#tablist .tab[data-id]')].find((el) => window.__wbTest.state.tabs.find((x) => x.id === el.dataset.id).url.includes(u)); const r = e.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; }, u);
      let p = await pick('/b.html'); await x.click(p.x, p.y); await sleep(300);
      for (const u of ['wide.html?grp', 'colors.html?grp']) { p = await pick(u); await x.keyDown('Control_L'); await x.click(p.x, p.y); await x.keyUp('Control_L'); await sleep(250); }
      await t.ui(() => window.__wbTest.command('groupTab'));
      await sleep(700); await esc();
      gid = await t.ui(() => { const S = window.__wbTest.state; const g = S.groups[S.groups.length - 1]; g.title = 'Research'; g.color = 'green'; window.__wbTest.render(); return g.id; });
      const n = await t.ui((gid) => window.__wbTest.state.tabs.filter((x) => x.groupId === gid).length, gid);
      assert(n === 3, 'grouped: ' + n);
      await x.move(900, 600); await sleep(500);
      for (const [name, cfg] of LAYOUTS) {
        await useLayout(cfg);
        await x.move(900, 600); await sleep(300);
        if (name !== 'horizontal tabs') {
          const geo = await t.ui((gid) => {
            const g = document.querySelector(`.group[data-group="${gid}"]`);
            const gr = g.getBoundingClientRect(), cs = getComputedStyle(g, '::after'), arm = getComputedStyle(g, '::before');
            const dot = g.querySelector('.group-dot').getBoundingClientRect();
            const tabs = [...g.querySelectorAll('.tab[data-id]')].map((e) => e.getBoundingClientRect());
            const wrap = document.getElementById('tablist-wrap').getBoundingClientRect();
            return { x: gr.left + parseFloat(cs.left) + parseFloat(cs.width) / 2, top: gr.top + parseFloat(cs.top), bottom: gr.bottom - parseFloat(cs.bottom), armY: gr.top + parseFloat(arm.top) + 1, armX: dot.left - 3, dot: [dot.left + dot.width / 2, dot.top + dot.height / 2], firstTop: tabs[0].top, lastBottom: tabs[tabs.length - 1].bottom, wrapLeft: wrap.left };
          }, gid);
          assert(geo.x - 1 >= geo.wrapLeft, `${name}: the line is outside the strip (${geo.x} < ${geo.wrapLeft})`);
          assert(geo.top < geo.firstTop && geo.bottom > geo.lastBottom - 8, `${name}: the line doesn't run along all the tabs: ${JSON.stringify(geo)}`);
          const img = await pixels({ x: 0, y: 0, w: 320, h: geo.bottom + 10 });
          const green = at(img, Math.round(geo.dot[0]), Math.round(geo.dot[1]));
          const xs = Math.floor(geo.x);
          const miss = [];
          for (let y = Math.ceil(geo.top) + 1; y < geo.bottom - 1; y += 3) if (!near(at(img, xs, y), green)) miss.push(y);
          assert(!miss.length, `${name}: no line at x ${xs}, y ${miss.slice(0, 5).join(', ')}… (the group's color is ${green}, there: ${at(img, xs, miss[0])})`);
          assert(near(at(img, Math.round(geo.armX), Math.round(geo.armY)), green), `${name}: the line doesn't reach the group's dot (${at(img, Math.round(geo.armX), Math.round(geo.armY))})`);
          await t.shot('everyday-group-' + name.replace(/ /g, '-'));
        } else {
          const geo = await t.ui((gid) => {
            const chip = document.querySelector(`.hgroup[data-group="${gid}"]`).getBoundingClientRect();
            const tabs = [...document.querySelectorAll('#htabs .tab.grouped')].map((e) => e.getBoundingClientRect());
            const bar = document.getElementById('hbar').getBoundingClientRect();
            return { left: chip.left, right: tabs[tabs.length - 1].right, y: bar.bottom - 2, chipC: [chip.left + chip.width / 2, chip.top + chip.height / 2], n: tabs.length };
          }, gid);
          assert(geo.n === 3, 'grouped tabs shown: ' + geo.n);
          const img = await pixels({ x: 0, y: 0, w: geo.right + 40, h: geo.y + 4 });
          const green = await t.ui(() => { const e = document.createElement('span'); e.style.color = 'var(--green)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); });
          const miss = [];
          for (let xx = Math.ceil(geo.left) + 8; xx < geo.right - 8; xx += 4) if (!near(at(img, xx, Math.floor(geo.y)), green, 50)) miss.push(xx);
          assert(!miss.length, `horizontal tabs: no line under the group at x ${miss.slice(0, 6).join(', ')} (y ${Math.floor(geo.y)}; green is ${green}, there: ${at(img, miss[0], Math.floor(geo.y))})`);
          assert(!near(at(img, Math.round(geo.right + 12), Math.floor(geo.y)), green, 50), 'horizontal tabs: the line goes on past the group');
          await t.shot('everyday-group-horizontal');
        }
      }
      // Put away (collapsed): the label alone, no line along the tabs.
      await useLayout(LAYOUTS[0][1]);
      const head = await t.ui((gid) => { const r = document.querySelector(`.group[data-group="${gid}"] .group-head`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, gid);
      await x.click(head.x, head.y); await sleep(700); await x.move(900, 600); await sleep(300);
      const shut = await t.ui((gid) => { const g = document.querySelector(`.group[data-group="${gid}"]`); return { collapsed: g.classList.contains('collapsed'), line: getComputedStyle(g, '::after').opacity, arm: getComputedStyle(g, '::before').opacity }; }, gid);
      assert(shut.collapsed && shut.line === '0' && shut.arm === '0', 'put away: ' + JSON.stringify(shut));
      await x.click(head.x, head.y); await sleep(700); await x.move(900, 600);
    } finally {
      await useLayout(LAYOUTS[0][1]);
      if (gid) await t.ui((gid) => { const S = window.__wbTest.state; for (const tb of S.tabs) if (tb.groupId === gid) tb.groupId = null; const i = S.groups.findIndex((g) => g.id === gid); if (i >= 0) S.groups.splice(i, 1); window.__wbTest.render(); }, gid);
    }
  });

  await R.step('copying the address from the address bar', async () => {
    await open(site.url + '/b.html?copy'); await sleep(900);
    await t.ui(() => window.__wbTest.command('focusAddress')); await sleep(250);
    await x.keyDown('Control_L'); await x.key('c'); await x.keyUp('Control_L'); await sleep(250);
    const clip = await t.main(({ clipboard }) => clipboard.readText());
    assert(/b\.html\?copy/.test(clip), 'clipboard: ' + clip);
    await esc();
  });

  await R.step('a private window keeps nothing: no history', async () => {
    await t.ui(() => window.__wbTest.command('newPrivateWindow')); await sleep(2500);
    const priv = await t.main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert(priv >= 2, 'no private window');
    await t.main((_, url) => { const ctl = global.__bifrost.registry.list().find((c) => c.isPrivate); ctl.send('open-url', { url }); }, site.url + '/b.html?private-visit');
    await sleep(2000);
    const inHistory = await t.main(() => global.__bifrost.db.recentHistory(50).some((h) => /private-visit/.test(h.url)));
    assert(!inHistory, 'the private visit is in the history');
    await t.main(() => { const ctl = global.__bifrost.registry.list().find((c) => c.isPrivate); ctl.win.close(); });
    await sleep(800);
  });
} finally {
  x.close();
  const errs = (await t.pageLogs()).filter((l) => /pageerror|Uncaught/i.test(l));
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 10).join('\n  '));
  await t.close();
  site.stop();
}
process.exit(R.summary() ? 1 : 0);
