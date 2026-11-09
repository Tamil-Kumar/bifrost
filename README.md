# Bifrost

A keyboard-first browser built on Electron: vertical or horizontal tabs, spaces, split view, a side panel
for bookmarks, history, websites and extensions (with a side bar, as in Firefox), a launcher
that searches bookmarks, tabs, history and the web, a built-in ad blocker (EasyList, EasyPrivacy, uBlock
Origin's lists and HaGeZi's DNS blocklists), warnings for dangerous sites, your choice of which Google
account Google's sites open with, page translation, Chrome extensions (Manifest V2 and V3), sync between
your computers through a cloud folder, and a lot of settings — every animation can be turned off.

## Layout

```
src/main        main process: windows, tabs (guests.js), settings, history/bookmarks (db.js), downloads,
                ad blocker (adblock.js; domain-list.js: HaGeZi's lists and what keeps them from breaking
                sites), dangerous-site warnings (safety.js), extensions (extensions/), imports from
                other browsers (import/), sessions, sync (sync/: the folder engine, merging, position keys),
                the fingers on the touchpad (touchpad.js: when they lift, for swipes), which Google account
                Google's sites open with (google-accounts.js)
src/preload     tab.js (every web page: shortcuts, Vim keys, swipes, dialogs, pop-up blocker, site styles),
                sw.js (websites' service workers: their notifications), ui.js (the browser window),
                adblock.js (cosmetic filtering, scriptlets, YouTube's ads)
src/ui          the browser window (bifrost://ui): browser.html, browser.css, js/
src/pages       internal pages (bifrost://settings, history, downloads, bookmarks, extensions, tasks,
                newtab, reader, about, welcome) and their shared files (common/)
src/shared      defaults.js (every setting and command), themes.js, engine.js (launcher ranking),
                launcher-settings.js (the launcher's settings files, Waypoint's included, and its keys),
                google-accounts.js (which pages get which Google account, and Google's list of your accounts)
src/vendor      electron-chrome-extensions, electron-chrome-web-store, Ghostery's adblocker, Readability
assets          icons, bundled filter lists (adblock/: domains.txt.gz is HaGeZi's, domains-keep.txt Bifrost's
                exceptions to it), bin/ (the touchpad watcher for Windows, x64 and ARM64)
tools           packaging: package.mjs, assemble.cjs, setup/ (the Windows setup), win/ (launcher and
                installer stubs, and the touchpad watcher, touchpad.c; built with llvm-mingw)
tests           e2e/ (Playwright + Electron under Xvfb, real pointer and keys through XTest), setup/,
                unit/, site/ (local test pages), fixtures/
```

## Running

```
electron . [--profile=<folder>] [urls…]
```

`BIFROST_TEST=1` exposes the main process's state to the tests (`global.__bifrost`).

## Tests

End to end (as a normal user, under Xvfb):

```
xvfb-run -a -s '-screen 0 1920x1080x24' node tests/e2e/core.mjs
```

Suites: `core` (tab close buttons in every layout, Glass menus, palette, launcher, error pages, downloads,
task manager), `behavior` (settings that change behavior, the Launcher section's included, how long the downloads box stays, links opened in a new tab in front or behind; the settings page opening with what
you see and building the rest after; a box of text too big to show, and My filters' Clear button), `everyday` (video, full screen and what shows
over it, PDFs, pop-ups, Leave site?, permissions and the permissions shield (in the address bar and in the compact toolbar's title pill), notifications, the keyboard following the tab on screen,
Ctrl+Tab's list of tabs and Ctrl+Tab after Ctrl+W, the side panel and its side bar (websites there: cookies, staying loaded, links, permission
questions, notifications, dialogs; arranging it: its + off with its menu, its row in Settings → Toolbar & sidebar; its buttons and
the sidebar's bottom row evenly spaced, collapsed and open), find, zoom,
context menu, tab dragging in every tab layout and pinning, the tab group line, private windows), `extensions` (MV3 service worker APIs,
onInstalled, storage and alarm events in the worker, context menus, popups and a popup in the side panel, Dark Reader, Stylus with a
usercss theme on a local YouTube stand-in, site styles), `daily`, `gestures` (two-finger swipes: the arrow, on
either side, and turning back taking it out at once; going only once the fingers lift, said by the touchpad watcher, played here by
tests/fixtures/touchpad-standin.mjs, or else by the end of the scroll gesture; coasting; the swipes that
don't count; settings), `hidpi` (a 150% display:
menus open at the pointer, things are where they're drawn), `web` (translation, dangerous-site warnings),
`passwords` (Bitwarden against a local stand-in server; needs the extension in ~/cache/exts/bitwarden),
`youtube` (YouTube's ads against a local stand-in for youtube.com: video ads covered and skipped, whatever
kind; the ads in its pages hidden; ads taken out of Shorts; embedded players; the settings that turn it off),
`blocking` (the ad blocker's domain list, HaGeZi's, here tests/fixtures/domains-test.txt, against local
stand-in sites: what pages load from listed domains blocked, never the site you're on nor a company's own
services on its own sites, its exceptions scoped to it, your own @@ rules and uBlock's stand-ins, the list off
or a site allowed, pop-up ads, updating from HaGeZi's files and keeping the old list when that goes wrong),
`accounts` (which Google account Google's sites open with, against local stand-ins for accounts.google.com's
list of your accounts and for Gmail, YouTube, Docs, Drive, Photos and Search: Settings → Accounts reading them
with your cookies and again when you sign in or out, the default account and particular sites, what's left
alone (links inside Google, pages that say which account, sign-in, forms, private windows, accounts you're
signed out of), Google taking authuser out again, the email before the accounts are read),
`sync` (two Bifrosts sharing a folder), `updates` (the updater against a local release feed: checks,
downloads, checksums, restarting into the update), `notifications` (tabs behind others hidden to their pages
and without the focus, as in Chrome: opened behind, after going to another page, with the window hidden, the
side panel's website; a page's own notifications, and the ones a site shows through its service worker, from
the page or the worker, really shown: Bifrost runs on a stand-in for libnotify, tests/fixtures/fake-libnotify.c,
built with gcc, that writes them down and clicks or closes them; clicks bringing the site's tab to the front
and reaching its worker, also after the worker has stopped or the tab has gone to sleep; tags,
getNotifications(), blocked sites). The Windows setup, end to end with PowerShell and Wine:
`sh tests/setup/setup-test.sh`. Unit tests: `node tests/unit/<name>.test.mjs` (`sync-merge` and
`sync-engine` cover sync's merging and its handling of broken files and missing folders, `google-accounts`
reading Google's list of your accounts and which pages get which account, `domain-list` the ad
blocker's domain list made from HaGeZi's files, which sites are the same company's, and the bundled list with
Bifrost's exceptions (what it blocks and what it leaves alone), `file-guard`
what local pages may load, `blend` the colors of "Match the page", `ranking` the launcher's ranking (what you
use and open comes first), `launcher-settings` that every setting
of the Waypoint extension has a place in Settings → Launcher, that its settings files import whole, and
what Enter and the launcher's other keys do; `side-bar` the side bar's order, yours or the usual one;
`touchpad` the touchpad watcher, counting fingers in made-up touchpad reports and running the program
itself, both under Wine; it's skipped without llvm-mingw and Wine).

## Releases

A new version in package.json reaching main (or a version tag, `v1.2.3`, matching package.json) runs
`.github/workflows/release.yml` on a Windows runner: `tools/release.mjs` builds both installers, the
portable zip and the update files on castlabs' Electron (with Widevine), signs them for Widevine with the
castlabs EVS account in the repository's secrets (`EVS_ACCOUNT_NAME`, `EVS_PASSWD`), `tools/drm-check.mjs`
checks that protected video plays, `tools/notify-check.mjs` that the portable build's notifications reach
Windows (it says what it found in the log; it doesn't hold up a release), and the release is published with
RELEASE_NOTES.md. Bifrost's updater
(src/main/updater.js) reads the newest release's latest.json: when only Bifrost's own files changed it
downloads just those, otherwise the installer or the portable builds, and the helpers in tools/win swap
them in when Bifrost restarts.

Release builds keep Electron's own fuses: castlabs' signing service refuses a binary whose fuses were
changed (local and Linux builds still turn RunAsNode, NODE_OPTIONS, --inspect and the file:// privileges
off). So src/main/file-guard.js holds pages opened from local files to what Chrome allows; Electron's
GrantFileProtocolExtraPrivileges would otherwise let such a page read any file on the computer. The other
three need someone who can already start programs as you.

## Packaging

```
node tools/make-icons.mjs                 # assets/icons from the logo (assets/icons/source/bifrost-logo.png)
sh tools/win/build.sh                     # the Windows stubs and assets/bin/touchpad-*.exe, after changing
                                          # the version, the icon or their C sources
node tools/package.mjs win-setup          # dist/Bifrost-<version>-Windows.zip (builds Bifrost on the PC)
node tools/release.mjs [--sign]           # dist/release: what the release workflow publishes
```

The zip holds `Install Bifrost.cmd`: on the user's PC it downloads the Electron runtime (castlabs' build,
with Widevine) for x64 and ARM64, checks the published checksums, and builds portable Bifrost (one folder,
both builds) and both installers. Those aren't signed for Widevine (Netflix won't play); release builds are.

## License

GPL-3.0-or-later. Bundled components keep their own licenses (see src/vendor), and so do the filter lists in
assets/adblock: EasyList and EasyPrivacy, uBlock Origin's and Peter Lowe's lists, and HaGeZi's DNS
blocklists (https://github.com/hagezi/dns-blocklists, GPL-3.0).
