'use strict';
// Importing extensions from another browser.
//   Chromium-based (Chrome, Vivaldi, Edge, Brave…): Web Store extensions are copied from the profile's
//   Extensions/<id>/<version> folder (same ID, so they keep updating from the Web Store), optionally
//   with their saved settings; unpacked ones are loaded from the folder they live in.
//   Firefox: add-ons can't run here as they are, so each one is matched to the same extension on the
//   Chrome Web Store (by its Firefox ID or its name) and installed from there.
const path = require('node:path');
const fs = require('node:fs');
const ctx = require('../context');

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

// Chromium's install locations (extensions.settings[id].location).
const LOC = { INTERNAL: 1, EXTERNAL_PREF: 2, EXTERNAL_REGISTRY: 3, UNPACKED: 4, COMPONENT: 5, EXTERNAL_PREF_DOWNLOAD: 6, EXTERNAL_POLICY_DOWNLOAD: 7, COMMAND_LINE: 8, EXTERNAL_POLICY: 9, EXTERNAL_COMPONENT: 10 };
// Extensions browsers install for themselves.
const BUILT_IN = new Set([
  'ghbmnnjooekpmoecnnnilnnbdlolhkhi', // Google Docs Offline
  'nmmhkkegccagdldgiimedpiccmgmieda', // Chrome Web Store Payments
  'mhjfbmdgcfjbbpaeojofohoefgiehjai', // Chrome PDF Viewer
  'pkedcjkdefgpdelpbcmbmeomcjbeemfm', // Chromecast
  'jmjflgjpcpepeafmmgdpfkogkghcpiha', // Edge's own
  'mpognobbkildjkofajifpdfhcoklimli', // Vivaldi's own
]);

// Firefox add-ons and their Chrome Web Store twins. "ff" is the Firefox ID; names are matched too.
const TWINS = [
  { ff: ['addon@darkreader.org'], names: ['dark reader'], cws: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader' },
  { ff: ['{446900e4-71c2-419f-a6a7-df9c091e268b}'], names: ['bitwarden', 'bitwarden password manager', 'bitwarden - free password manager'], cws: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden' },
  { ff: ['{d7742d87-e61d-4b78-b8a1-b469842139fa}'], names: ['vimium', 'vimium-ff'], cws: 'dbepggeogbaibhgnhhndojpepiihcmeb', name: 'Vimium' },
  { ff: ['jid1-MnnxcxisBPnSXQ@jetpack'], names: ['privacy badger'], cws: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', name: 'Privacy Badger' },
  { ff: ['sponsorBlocker@ajay.app'], names: ['sponsorblock', 'sponsorblock for youtube - skip sponsorships'], cws: 'mnjggcdmjocbbbhaepdhchncahnbgone', name: 'SponsorBlock' },
  { ff: ['deArrow@ajay.app'], names: ['dearrow'], cws: 'enamippconapkdmgfgjchkhakpfinmaj', name: 'DeArrow' },
  { ff: ['enhancerforyoutube@maximerf.addons.mozilla.org'], names: ['enhancer for youtube', 'enhancer for youtube™'], cws: 'ponfpcnoihfmfllpaingbgckeeldkhle', name: 'Enhancer for YouTube' },
  { ff: ['{762f9885-5a13-4abd-9c77-433dcd38b8fd}'], names: ['return youtube dislike'], cws: 'gebbhagfogifgggkldgodflihgfeippi', name: 'Return YouTube Dislike' },
  { ff: ['{aecec67f-0d10-4fa7-b7c7-609a2db280cf}'], names: ['violentmonkey'], cws: 'jinjaccalgkegednnccohejagnlnfdag', name: 'Violentmonkey' },
  { ff: ['firefox@tampermonkey.net'], names: ['tampermonkey'], cws: 'dhdgffkkebhmkfjojejmpbldmpobfkfo', name: 'Tampermonkey' },
  { ff: ['{d634138d-c276-4fc8-924b-40a0ea21d284}'], names: ['1password', '1password – password manager', '1password - password manager'], cws: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password' },
  { ff: ['{73a6fe31-595d-460b-a920-fcc0f8843232}'], names: ['noscript', 'noscript security suite'], cws: 'doojmbjmlfjjnbmnoijecmcbfeoakpjm', name: 'NoScript' },
  { ff: ['keepassxc-browser@keepassxc.org'], names: ['keepassxc-browser'], cws: 'oboonakemofpalcgghocfoadofidjkkk', name: 'KeePassXC-Browser' },
  { ff: ['{a4c4eda4-fb84-4a84-b4a1-f7c1cbf2a1ad}'], names: ['refined github'], cws: 'hlepfoohegkhhmjieoechaddaejaokhf', name: 'Refined GitHub' },
  { ff: ['@react-devtools'], names: ['react developer tools'], cws: 'fmkadmapgofadopljbjfkapdkoienihi', name: 'React Developer Tools' },
  { ff: ['jid1-BoFifL9Vbdl2zQ@jetpack'], names: ['decentraleyes'], cws: 'ldpochfccmkkmhdbclfhpagapcfdljkj', name: 'Decentraleyes' },
  { ff: ['jid1-KKzOGWgsW3Ao4Q@jetpack'], names: ["i don't care about cookies", 'i dont care about cookies'], cws: 'fihnjjcciajhdojfnbdddfaoknhalnja', name: 'I don’t care about cookies' },
  { ff: ['{74145f27-f039-47ce-a470-a662b129930a}'], names: ['clearurls'], cws: 'lckanjgmijmafbedllaakclkaicjfmnk', name: 'ClearURLs' },
  { ff: ['languagetool-webextension@languagetool.org'], names: ['languagetool', 'languagetool - grammar and spell checker'], cws: 'oldceeleldhonbafppcapldpdifcinji', name: 'LanguageTool' },
  { ff: ['{c2c003ee-bd69-42a2-b0e9-6f34222cb046}'], names: ['auto tab discard'], cws: 'jhnleheckmknfcgijgkadoemagpecfol', name: 'Auto Tab Discard' },
  { ff: ['{6AC85730-7D0F-4de0-B3FA-21142DD85326}'], names: ['colorzilla'], cws: 'bhlhnicpbhignbdhedgjhgdocnmhomnp', name: 'ColorZilla' },
  { ff: ['87677a2c52b84ad3a151a4a72f5bd3c4@jetpack'], names: ['grammarly', 'grammarly: ai writing and grammar checker app'], cws: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', name: 'Grammarly' },
  { ff: ['{7a7a4a92-a2a0-41d1-9fd7-1e92480d612d}'], names: ['stylus'], cws: 'clngdbkpkpeebahjckkjfobafhncgmne', name: 'Stylus' },
  { ff: ['support@lastpass.com'], names: ['lastpass', 'lastpass: free password manager'], cws: 'hdokiejnpimakedhajhdlcegeplioahd', name: 'LastPass' },
  { ff: ['78272b6fa58f4a1abaac99321d503a20@proton.me'], names: ['proton pass', 'proton pass: free password manager'], cws: 'ghmbeldphafepmbegfdlkpapadhbakde', name: 'Proton Pass' },
  { ff: ['wappalyzer@crunchlabz.com'], names: ['wappalyzer', 'wappalyzer - technology profiler'], cws: 'gppongmhjkpfnbhagpmjfkannfbllamg', name: 'Wappalyzer' },
  { ff: ['myallychou@gmail.com'], names: ['unhook', 'unhook - remove youtube recommended videos'], cws: 'khncfooichmfjbepaaaebmommgaepoid', name: 'Unhook' },
  { ff: ['gdpr@cavi.au.dk'], names: ['consent-o-matic'], cws: 'mdjildafknihdffpkfmmpnpoiajfjnjd', name: 'Consent-O-Matic' },
  { ff: ['jid1-ZAdIEUB7XOzOJw@jetpack'], names: ['duckduckgo privacy essentials', 'duckduckgo search & tracker protection'], cws: 'bkdgflcldnnnapblkhphbgpggdiikppg', name: 'DuckDuckGo Search & Tracker Protection' },
  { ff: ['{5caff8cc-3d2e-4110-a88a-003cc85b3858}'], names: ['vue.js devtools'], cws: 'nhdogjmejiglipccpnnnanhbledajbpd', name: 'Vue.js devtools' },
  { ff: ['extension@redux.devtools'], names: ['redux devtools'], cws: 'lmhkpmbekcpmknklioeibfkpmmfibljd', name: 'Redux DevTools' },
  { ff: ['{a8332c60-5b6d-41ee-bfc8-e9bb331d34ad}'], names: ['surfingkeys'], cws: 'gfbliohnnapiefjpjlpjnehglfpaknnc', name: 'Surfingkeys' },
  { ff: ['{b9db16a4-6edc-47ec-a1f4-b86292ed211d}'], names: ['video downloadhelper'], cws: 'lmjnegcaeklhafolokijcfjliaokphfk', name: 'Video DownloadHelper' },
  { ff: ['CookieAutoDelete@kennydo.com'], names: ['cookie autodelete'], cws: 'fhcgjolkccmbidfldomjliifgaodjagh', name: 'Cookie AutoDelete' },
  { ff: ['Tab-Session-Manager@sienori'], names: ['tab session manager'], cws: 'iaiomicjabeggjcfkbimgmglanimpnae', name: 'Tab Session Manager' },
  { ff: ['simple-translate@sienori'], names: ['simple translate'], cws: 'ibplnjkanclpjokhdolnendpplpjiace', name: 'Simple Translate' },
  { ff: ['extension@one-tab.com'], names: ['onetab'], cws: 'chphlpgkkbolifaimnlloiipkdnihall', name: 'OneTab' },
  { ff: ['jid0-adyhmvsP91nUO8pRv0Mn2VKeB84@jetpack'], names: ['raindrop.io'], cws: 'ldgfbffkinooeloadekpmfoklnobpien', name: 'Raindrop.io' },
  { ff: ['jetpack-extension@dashlane.com'], names: ['dashlane', 'dashlane — password manager', 'dashlane - password manager'], cws: 'fdjamakpfbbddfjaooikfcpapjohcfmg', name: 'Dashlane' },
  { ff: ['zotero@chnm.gmu.edu'], names: ['zotero connector'], cws: 'ekhagklcjbdpajgpjgmbionohlpdbjgc', name: 'Zotero Connector' },
  { ff: ['{1be309c5-3e4f-4b99-927d-bb500eb4fa88}'], names: ['augmented steam'], cws: 'dnhpnfgdlenaccegplpojghhmaamnnfp', name: 'Augmented Steam' },
  { ff: ['firefox@betterttv.net'], names: ['betterttv'], cws: 'ajopnjidmegmdimjlfnijceegpefgped', name: 'BetterTTV' },
  { ff: ['frankerfacez@frankerfacez.com'], names: ['frankerfacez'], cws: 'fadndhdgpmmaapbmfcknlfgcflmmmieb', name: 'FrankerFaceZ' },
  { ff: ['moz-addon-prod@7tv.app'], names: ['7tv'], cws: 'ammjkodgmmoknidbanneddgankgfejfh', name: '7TV' },
  { ff: ['{00000f2a-7cde-4f20-83ed-434fcb420d71}'], names: ['imagus'], cws: 'immpkjjlgappgfkkfieppnmlhakdmaab', name: 'Imagus' },
  { ff: ['{2e5ff8c8-32fe-46d0-9fc8-6b8986621f3c}'], names: ['search by image'], cws: 'cnojnbdhbhnkbcieeekonklommdnndci', name: 'Search by Image' },
  { ff: ['{9063c2e9-e07c-4c2c-9646-cfe7ca8d0498}'], names: ['old reddit redirect'], cws: 'dneaehbmnbhcippjikoajpoabadpodje', name: 'Old Reddit Redirect' },
  { ff: ['jid1-xUfzOsOFlzSOXg@jetpack'], names: ['reddit enhancement suite'], cws: 'kbmfpngjjgdllneeigpgjifpgocmfgmb', name: 'Reddit Enhancement Suite' },
  { ff: ['{799c0914-748b-41df-a25c-22d008f9e83f}'], names: ['web scrobbler'], cws: 'hhinaapppaileiechjoiifaancjggfjm', name: 'Web Scrobbler' },
  { ff: ['{242af0bb-db11-4734-b7a0-61cb8a9b20fb}'], names: ['malwarebytes browser guard'], cws: 'ihcjicgdanjaechkgeegckofjjedodee', name: 'Malwarebytes Browser Guard' },
  { ff: ['2.0@disconnect.me'], names: ['disconnect'], cws: 'jeoacafpbcihiomhlakheieifhpjdfeo', name: 'Disconnect' },
  { ff: ['{e58d3966-3d76-4cd9-8552-1582fbc800c1}'], names: ['buster: captcha solver for humans'], cws: 'mpbjkejclgfgadiemmefgebjfooflfhl', name: 'Buster: Captcha Solver for Humans' },
  { ff: ['{ddc62400-f22d-4dd3-8b4a-05837de53c2e}'], names: ['read aloud', 'read aloud: a text to speech voice reader'], cws: 'hdhinadidafjejdhmfkjgnolgimiaplp', name: 'Read Aloud' },
  { ff: ['ruffle@ruffle.rs'], names: ['ruffle', 'ruffle - flash emulator'], cws: 'donbcfbmhbcapadipfkeojnmajbakjdc', name: 'Ruffle' },
  { ff: ['{7be2ba16-0f1e-4d93-9ebc-5164397477a9}'], names: ['video speed controller'], cws: 'nffaoalbilbmmfgbnbgppjihopabppdk', name: 'Video Speed Controller' },
  { ff: ['{3c6bf0cc-3ae2-42fb-9993-0d33104fdcaf}'], names: ['improve youtube!'], cws: 'bnomihfieiccainjcjblhegjgglakjdd', name: 'Improve YouTube!' },
  { ff: ['{0d7cafdd-501c-49ca-8ebb-e3341caaa55e}'], names: ['youtube nonstop'], cws: 'nlkaejimjacpillmajjnopmpbkbnocid', name: 'YouTube NonStop' },
  { ff: ['@ublacklist'], names: ['ublacklist'], cws: 'pncfbmialoiaghdehhbnbhkkgmjanfhe', name: 'uBlacklist' },
  { ff: ['extension@tabliss.io'], names: ['tabliss'], cws: 'hipekcciheckooncpjeljhnekcoolahp', name: 'Tabliss' },
  { ff: ['{a6c4a591-f1b2-4f03-b3ff-767e5bedf4e7}'], names: ['user-agent switcher and manager'], cws: 'bhchdcejhohfmigjafbampogmaanbfkg', name: 'User-Agent Switcher and Manager' },
  { ff: ['{c3c10168-4186-445c-9c5b-63f12b8e2c87}'], names: ['cookie-editor'], cws: 'hlkenndednhfkekhgcdicdfddnkalmdm', name: 'Cookie-Editor' },
  { ff: ['jid1-93CWPmRbVPjRQA@jetpack'], names: ['honey', 'honey: automatic coupons & rewards'], cws: 'bmnlcjabgnpnenekpadlanbbkooimhnj', name: 'Honey' },
  { ff: ['momentum@momentumdash.com'], names: ['momentum'], cws: 'laookkfknpbbblfpciffpaejjkokdgca', name: 'Momentum' },
];
// Ad blockers: Bifrost blocks ads itself (with uBlock Origin's lists), so these are offered but not ticked.
const AD_BLOCKERS = [
  { ff: ['uBlock0@raymondhill.net'], names: ['ublock origin'], cws: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite' },
  { ff: ['{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}'], names: ['adblock plus', 'adblock plus - free ad blocker'], cws: 'cfhdojbkjhnklbpkdaibdccddilifddb', name: 'Adblock Plus' },
  { ff: ['jid1-NIfFY2CA8fy1tg@jetpack'], names: ['adblock', 'adblock — block ads across the web'], cws: 'gighmmpiobklfepjocnamgkkbiglidom', name: 'AdBlock' },
  { ff: ['firefox@ghostery.com'], names: ['ghostery', 'ghostery – privacy ad blocker', 'ghostery - privacy ad blocker', 'ghostery tracker & ad blocker - privacy adblock'], cws: 'mlomiejdfkolichcflejclcbmpeaniij', name: 'Ghostery' },
  { ff: ['adguardadblocker@adguard.com'], names: ['adguard adblocker'], cws: 'bgnkhhnnamicmpeenaelnjfhikgbkllg', name: 'AdGuard AdBlocker' },
];
const AD_BLOCKER_CWS = new Set(['cjpalhdlnbpafiamejdnhcphjbkeiagm', 'ddkjiahejlhfcafbddmgiahcphecmpfh', 'cfhdojbkjhnklbpkdaibdccddilifddb', 'gighmmpiobklfepjocnamgkkbiglidom', 'mlomiejdfkolichcflejclcbmpeaniij', 'bgnkhhnnamicmpeenaelnjfhikgbkllg']);
// Firefox-only add-ons, mostly things Bifrost does itself.
const FIREFOX_ONLY = [
  { names: ['tree style tab'], ff: ['treestyletab@piro.sakura.ne.jp'], note: 'Firefox only. Bifrost has vertical tabs and tab groups.' },
  { names: ['sidebery'], ff: ['{3c078156-979c-498b-8990-85f7987dd929}'], note: 'Firefox only. Bifrost has vertical tabs, groups and spaces.' },
  { names: ['simple tab groups'], ff: ['simple-tab-groups@drive4ik'], note: 'Firefox only. Bifrost has tab groups and spaces.' },
  { names: ['firefox multi-account containers'], ff: ['@testpilot-containers'], note: 'Firefox only.' },
  { names: ['facebook container'], ff: ['@contain-facebook'], note: 'Firefox only.' },
  { names: ['firefox color'], ff: ['FirefoxColor@mozilla.com'], note: 'Firefox only. Bifrost has themes and custom colors.' },
  { names: ['tridactyl'], ff: ['tridactyl.vim@cmcaine.co.uk'], note: 'Firefox only. Bifrost has Vim keys built in (Settings → Keyboard), or try Vimium or Surfingkeys.' },
  { names: ['temporary containers'], ff: ['{c607c8df-14a7-4f28-894f-29e8722976af}'], note: 'Firefox only.' },
  { names: ['canvasblocker'], ff: ['CanvasBlocker@kkapsner.de'], note: 'Firefox only.' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
function twinFor(id, name, list) {
  const n = norm(name);
  return list.find((t) => (t.ff || []).includes(id)) || list.find((t) => t.names.some((x) => x === n || n.startsWith(x + ' -') || n.startsWith(x + ' –') || n.startsWith(x + ':')));
}

// What's already in Bifrost, by ID and by (lowercased) name.
function installed() {
  const list = ctx.extensions ? ctx.extensions.list() : [];
  return { ids: new Set(list.map((e) => e.id)), names: new Set(list.map((e) => norm(e.name))) };
}

// ------------------------------------------------------------------ Chromium
function localized(dir, manifest, str) {
  const m = /^__MSG_(.+)__$/.exec(str || '');
  if (!m) return str || '';
  const key = m[1].toLowerCase();
  const locales = [manifest.default_locale, 'en', 'en_US'].filter(Boolean);
  for (const loc of locales) {
    const msgs = readJson(path.join(dir, '_locales', loc, 'messages.json'));
    if (!msgs) continue;
    const hit = Object.keys(msgs).find((k) => k.toLowerCase() === key);
    if (hit && msgs[hit].message) return msgs[hit].message;
  }
  return str;
}

function iconOf(dir, manifest) {
  const icons = manifest.icons || (manifest.action || manifest.browser_action || {}).default_icon || {};
  if (typeof icons === 'string') return dataUrl(path.join(dir, icons));
  const sizes = Object.keys(icons).map(Number).filter((n) => n > 0).sort((a, b) => Math.abs(a - 48) - Math.abs(b - 48));
  return sizes.length ? dataUrl(path.join(dir, icons[sizes[0]])) : '';
}
function dataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 256 * 1024) return '';
    const ext = path.extname(file).toLowerCase();
    return `data:${ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

function latestVersion(dir) {
  try {
    const vers = fs.readdirSync(dir).filter((v) => exists(path.join(dir, v, 'manifest.json')));
    vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return vers.length ? path.join(dir, vers[vers.length - 1]) : null;
  } catch { return null; }
}

function chromiumSettings(profileDir) {
  const out = {};
  // Newer Chrome keeps extension state in Secure Preferences, older (and some forks) in Preferences.
  for (const f of ['Preferences', 'Secure Preferences']) {
    const j = readJson(path.join(profileDir, f));
    const s = j && j.extensions && j.extensions.settings;
    if (s && typeof s === 'object') for (const [id, v] of Object.entries(s)) out[id] = Object.assign(out[id] || {}, v);
  }
  return out;
}

// Where a Chromium browser keeps an extension's saved data.
const DATA_DIRS = [
  (id) => path.join('Local Extension Settings', id),   // chrome.storage.local
  (id) => path.join('Sync Extension Settings', id),    // chrome.storage.sync
  (id) => path.join('IndexedDB', `chrome-extension_${id}_0.indexeddb.leveldb`),
];

// Origins with localStorage in a profile (read once per scan).
const lsCache = new Map();
function lsOrigins(profileDir) {
  if (lsCache.has(profileDir)) return lsCache.get(profileDir);
  const set = new Set();
  try {
    for (const k of require('./leveldb').readAll(path.join(profileDir, 'Local Storage', 'leveldb')).keys()) {
      const m = /^_(chrome-extension:\/\/[a-p]{32})\u0000/.exec(k);
      if (m) set.add(m[1]);
    }
  } catch { /* none */ }
  lsCache.set(profileDir, set);
  setTimeout(() => lsCache.delete(profileDir), 60e3);
  return set;
}

function scanChromium(profileDir) {
  const have = installed();
  const settings = chromiumSettings(profileDir);
  const extRoot = path.join(profileDir, 'Extensions');
  const ids = new Set(Object.keys(settings));
  try { for (const d of fs.readdirSync(extRoot)) if (/^[a-p]{32}$/.test(d)) ids.add(d); } catch { /* no Extensions folder */ }
  const out = [];
  for (const sid of ids) {
    let id = sid;
    const st = settings[id] || {};
    const loc = Number(st.location) || LOC.INTERNAL;
    if (BUILT_IN.has(id) || loc === LOC.COMPONENT || loc === LOC.EXTERNAL_COMPONENT) continue;
    let dir = null;
    if (loc === LOC.UNPACKED || loc === LOC.COMMAND_LINE) dir = st.path && path.isAbsolute(st.path) ? st.path : null;
    else dir = latestVersion(path.join(extRoot, id)) || (st.path ? path.join(extRoot, st.path) : null);
    if (!dir || !exists(path.join(dir, 'manifest.json'))) continue;
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (!manifest) continue;
    if (manifest.theme || manifest.app) continue;   // themes and Chrome apps don't apply here
    const name = localized(dir, manifest, manifest.name) || id;
    const unpacked = loc === LOC.UNPACKED || loc === LOC.COMMAND_LINE || !manifest.key;
    const disabled = st.state === 0 || (Array.isArray(st.disable_reasons) ? st.disable_reasons.length > 0 : !!st.disable_reasons);
    const adblock = AD_BLOCKER_CWS.has(id);
    // An unpacked extension's ID comes from its folder, the way Chromium (and Bifrost) work it out.
    if (unpacked && !manifest.key) { try { id = require('../extensions/crx').idForPath(dir); } catch { /* keep */ } }
    const item = {
      key: 'cr:' + sid, id, name, version: manifest.version || '', icon: iconOf(dir, manifest),
      action: unpacked ? 'unpacked' : 'copy', source: dir,
      mv: manifest.manifest_version || 2,
      sourceId: sid,
      hasData: DATA_DIRS.some((rel) => exists(path.join(profileDir, rel(sid)))) || lsOrigins(profileDir).has('chrome-extension://' + sid),
      already: have.ids.has(id),
      recommended: !disabled && !adblock && !have.ids.has(id),
      note: adblock ? 'Bifrost blocks ads itself, using uBlock Origin’s lists.' : unpacked ? 'Loaded from its folder: ' + dir : disabled ? 'Turned off in the other browser.' : '',
    };
    out.push(item);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------- Firefox
// An add-on's icon, from its .xpi (a zip) or its folder.
function firefoxIcon(profileDir, a) {
  try {
    const icons = a.icons && typeof a.icons === 'object' ? a.icons : {};
    const sizes = Object.keys(icons).map(Number).filter((n) => n > 0).sort((x, y) => Math.abs(x - 48) - Math.abs(y - 48) || y - x);
    if (!sizes.length) return '';
    const rel = String(icons[sizes[0]]).replace(/^\//, '');
    const where = a.path && exists(a.path) ? a.path : path.join(profileDir, 'extensions', a.id + '.xpi');
    let buf = null;
    if (exists(where) && fs.statSync(where).isDirectory()) buf = fs.readFileSync(path.join(where, rel));
    else if (exists(where) && fs.statSync(where).size < 200 * 1024 * 1024) buf = require('../extensions/crx').readZipEntry(fs.readFileSync(where), rel, 512 * 1024);
    if (!buf || buf.length > 256 * 1024) return '';
    const ext = path.extname(rel).toLowerCase();
    return `data:${ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

// Add-ons matched on the Chrome Web Store by name (see lookup), remembered for a while so the import
// that follows the dialog sees the same matches: profile + add-on id -> { id, name, exact }.
const found = new Map();
const foundKey = (profileDir, ffId) => profileDir + '\u0000' + ffId;

function storeItem(item, t, { ad = false, disabled = false, have, hasData = false, online = null } = {}) {
  const already = have.ids.has(t.cws) || (!online && have.names.has(norm(t.name)));
  return Object.assign(item, {
    id: t.cws, action: 'store', storeName: t.name, already,
    hasData: hasData && !ad,   // (an ad blocker's Chrome version isn't the same program, so its settings don't fit)
    recommended: !ad && !disabled && !already && (!online || online.exact),
    found: online ? (online.exact ? 'exact' : 'close') : null,
    storeUrl: 'https://chromewebstore.google.com/detail/' + t.cws,
    note: already ? (hasData && !ad ? 'Already in Bifrost: tick it to bring its Firefox settings over.' : 'Already in Bifrost.')
      : ad ? `Bifrost blocks ads itself, using uBlock Origin’s lists. This installs ${t.name} from the Chrome Web Store.`
      : online ? (online.exact ? `Found on the Chrome Web Store as “${t.name}”.` : `The closest on the Chrome Web Store is “${t.name}”: check it’s the same one.`)
      : `Installs ${t.name} from the Chrome Web Store.`,
  });
}

function scanFirefox(profileDir) {
  const have = installed();
  const j = readJson(path.join(profileDir, 'extensions.json'));
  let withData = new Set();
  try { withData = require('./firefox-storage').addonsWithData(profileDir); } catch (e) { console.warn('[import] Firefox add-on data: ' + e.message); }
  const out = [];
  for (const a of (j && j.addons) || []) {
    // Only add-ons you installed (not Firefox's built-in ones, themes, dictionaries or temporary ones).
    if (a.type !== 'extension' || !['app-profile', 'app-system-user', 'app-system-share', 'app-system-local'].includes(a.location || 'app-profile')) continue;
    if (a.hidden) continue;
    const name = (a.defaultLocale && a.defaultLocale.name) || a.id;
    const disabled = !!(a.userDisabled || a.active === false || a.softDisabled);
    const item = { key: 'ff:' + a.id, ffId: a.id, name, version: a.version || '', icon: firefoxIcon(profileDir, a), disabled, hasData: false };
    const ffOnly = twinFor(a.id, name, FIREFOX_ONLY);
    const twin = twinFor(a.id, name, TWINS);
    const ad = twinFor(a.id, name, AD_BLOCKERS);
    const online = found.get(foundKey(profileDir, a.id));
    if (twin || ad) storeItem(item, twin || ad, { ad: !!ad, disabled, have, hasData: withData.has(a.id) });
    else if (ffOnly) Object.assign(item, { action: 'none', note: ffOnly.note, recommended: false });
    else if (online) storeItem(item, { cws: online.id, name: online.name }, { disabled, have, hasData: withData.has(a.id), online });
    else {
      Object.assign(item, { action: 'search', note: 'Not found on the Chrome Web Store under this name.', searchUrl: 'https://chromewebstore.google.com/search/' + encodeURIComponent(name), recommended: false, lookup: true });
    }
    if (disabled && item.action === 'store' && !ad) item.note += ' (Turned off in Firefox.)';
    out.push(item);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------- API
function sourceById(id) {
  const imp = require('./index');
  let src = imp.detect().find((s) => s.id === id);
  if (!src && /^(ff|cr):/.test(id)) src = imp.sourceFromFolder(id.slice(3));
  if (!src) throw new Error('That browser profile wasn’t found');
  return src;
}

function scan(sourceId) {
  const src = sourceById(sourceId);
  const items = src.kind === 'firefox' ? scanFirefox(src.path) : scanChromium(src.path);
  return { source: { id: src.id, name: src.name, kind: src.kind }, items };
}

// An extension's saved data in the other browser: chrome.storage.local and .sync and localStorage are read
// here (see leveldb.js) and written into Bifrost after the extension is in (Extensions.writeImportedData);
// IndexedDB is copied as a folder before the extension first runs, when Bifrost has none for it yet.
// Lock files are left behind, and nothing is written to the other browser, so it can stay open.
function readData(profileDir, sourceId) {
  const L = require('./leveldb');
  const out = { local: {}, sync: {}, localStorage: {} };
  try { out.local = L.readExtensionStorage(path.join(profileDir, 'Local Extension Settings', sourceId)); } catch (e) { console.warn('[import] storage.local of ' + sourceId + ': ' + e.message); }
  try { out.sync = L.readExtensionStorage(path.join(profileDir, 'Sync Extension Settings', sourceId)); } catch (e) { console.warn('[import] storage.sync of ' + sourceId + ': ' + e.message); }
  try { out.localStorage = L.readLocalStorage(path.join(profileDir, 'Local Storage', 'leveldb'), 'chrome-extension://' + sourceId); } catch (e) { console.warn('[import] localStorage of ' + sourceId + ': ' + e.message); }
  return out;
}

function copyIndexedDb(profileDir, sourceId, id) {
  const ses = ctx.mainSession;
  const base = ses && ses.storagePath ? ses.storagePath : (ses && ses.getStoragePath ? ses.getStoragePath() : null);
  if (!base) return false;
  let copied = false;
  for (const kind of ['leveldb', 'blob']) {
    const from = path.join(profileDir, 'IndexedDB', `chrome-extension_${sourceId}_0.indexeddb.${kind}`);
    const to = path.join(base, 'IndexedDB', `chrome-extension_${id}_0.indexeddb.${kind}`);
    if (!exists(from) || exists(to)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, filter: (p) => path.basename(p) !== 'LOCK' });
      copied = true;
    } catch (e) { console.warn('[import] couldn’t copy the IndexedDB of ' + id + ': ' + e.message); }
  }
  return copied;
}

// keys: which items to bring over (from scan). opts.data: copy their saved settings too.
async function run(sourceId, keys, opts = {}) {
  if (!ctx.extensions) throw new Error('Extensions aren’t available');
  const src = sourceById(sourceId);
  const { items } = scan(sourceId);
  const want = new Set(keys || []);
  const results = [];
  for (const it of items.filter((x) => want.has(x.key))) {
    try {
      if (it.action === 'copy' || it.action === 'unpacked') {
        const sid = it.sourceId || it.id;
        const withData = opts.data !== false;
        const data = withData ? readData(src.path, sid) : null;
        const idb = withData && copyIndexedDb(src.path, sid, it.id);
        const r = it.action === 'copy' ? await ctx.extensions.importFolder(it.source, it.id) : await ctx.extensions.loadUnpacked(it.source);
        let wrote = { local: 0, sync: 0, localStorage: 0 };
        if (data) {
          try { wrote = await ctx.extensions.writeImportedData(r.id || it.id, data); } catch (e) { console.warn('[import] settings of ' + it.name + ': ' + e.message); }
        }
        const count = wrote.local + wrote.sync + wrote.localStorage;
        results.push({ key: it.key, ok: true, name: r.name, data: !!(count || idb), settings: count, indexedDb: !!idb, already: !!r.already });
      } else if (it.action === 'store') {
        // Already in Bifrost (ticked to bring its settings over again): no need to install it.
        const have = ctx.extensions.list().find((e) => e.id === it.id);
        const r = have ? { id: have.id, name: have.name, already: true } : await ctx.extensions.installFromStore(it.id);
        let count = 0, skipped = 0;
        if (opts.data !== false && it.hasData && src.kind === 'firefox') {
          try {
            ({ count, skipped } = await firefoxSettings(src.path, it, r.id || it.id, !!r.already));
          } catch (e) { console.warn('[import] settings of ' + it.name + ': ' + e.message); }
        }
        results.push({ key: it.key, ok: true, name: r.name, data: count > 0, settings: count, skipped, already: !!r.already });
      } else {
        results.push({ key: it.key, ok: false, name: it.name, error: it.action === 'search' ? 'It isn’t on the Chrome Web Store under this name' : it.note || 'Can’t be imported' });
      }
    } catch (e) {
      results.push({ key: it.key, ok: false, name: it.name, error: e.message });
    }
  }
  return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// Compares dotted version numbers: <0, 0 or >0.
function compareVersions(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

// A Firefox add-on's settings, written into its Chrome version: storage.local and .sync, localStorage and
// IndexedDB (firefox-storage.js reads them). The extension gets a moment to start and set itself up first,
// so what it creates on its first run is there to write into.
async function firefoxSettings(profileDir, it, id, wasInstalled) {
  const ffs = require('./firefox-storage');
  const data = ffs.readAddonData(profileDir, it.ffId);
  const hasAny = Object.keys(data.local).length || Object.keys(data.sync).length || Object.keys(data.localStorage).length || data.indexedDb.length;
  if (!hasAny) return { count: 0, skipped: data.skipped };
  if (!wasInstalled) await new Promise((r) => setTimeout(r, Number(process.env.BIFROST_IMPORT_SETTLE_MS) || 1500));
  // Addresses inside the add-on (moz-extension://<its uuid>/…) become the extension's own.
  const from = data.uuid ? 'moz-extension://' + data.uuid : null;
  const to = 'chrome-extension://' + id;
  const rewrite = from ? (s) => (s.includes(from) ? s.split(from).join(to) : s) : null;
  const ext = ctx.extensions.list().find((e) => e.id === id);
  const w = await ctx.extensions.writeImportedData(id, {
    local: ffs.toWire(data.local, rewrite), sync: ffs.toWire(data.sync, rewrite), localStorage: ffs.toWire(data.localStorage, rewrite),
    indexedDb: data.indexedDb.map((d) => ({ name: d.name, version: d.version, stores: d.stores.map((s) => ({ ...s, records: s.records.map((r) => ({ key: 'key' in r ? ffs.toWire(r.key) : undefined, value: ffs.toWire(r.value, rewrite) })) })) })),
  }, {
    wire: true,
    // A database Bifrost's copy doesn't have yet is only made when that copy is at least as new as Firefox's
    // (so its own version of the database isn't older than the one written).
    createDatabases: !!(ext && compareVersions(ext.version, it.version) >= 0),
  });
  return { count: (w.local || 0) + (w.sync || 0) + (w.localStorage || 0) + (w.indexedDb || 0), skipped: data.skipped + (w.skipped || 0) };
}

// Looks the unmatched Firefox add-ons up on the Chrome Web Store by name (see store-lookup.js). Returns the
// items again, with what was found.
async function lookup(sourceId, keys) {
  const src = sourceById(sourceId);
  if (src.kind !== 'firefox') return { items: [] };
  const { items } = scan(sourceId);
  const want = new Set(keys || []);
  const todo = items.filter((it) => it.lookup && want.has(it.key));
  const L = require('./store-lookup');
  const res = await L.findAll(todo.map((it) => it.name));
  for (const it of todo) {
    const hit = res.get(it.name);
    if (hit && !AD_BLOCKER_CWS.has(hit.id)) found.set(foundKey(src.path, it.ffId), hit);
  }
  setTimeout(() => { for (const it of todo) found.delete(foundKey(src.path, it.ffId)); }, 60 * 60e3).unref?.();
  const again = scan(sourceId).items;
  return { items: again.filter((it) => want.has(it.key)) };
}

module.exports = { scan, run, lookup, scanChromium, scanFirefox, TWINS, twinFor, compareVersions };
