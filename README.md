# Bifrost

A keyboard-first browser built on Electron: vertical or horizontal tabs, spaces, split view, a side panel
for bookmarks, history, websites and extensions (with a side bar, as in Firefox), a launcher
that searches bookmarks, tabs, history and the web, a built-in ad blocker, warnings for dangerous sites,
page translation, Chrome extensions (Manifest V2 and V3), sync between your computers through a cloud
folder, and a lot of settings — every animation can be turned off.

## Layout

```
src/main        main process: windows, tabs (guests.js), settings, history/bookmarks (db.js), downloads,
                ad blocker, dangerous-site warnings (safety.js), extensions (extensions/), imports from
                other browsers (import/), sessions, sync (sync/: the folder engine, merging, position keys)
src/preload     tab.js (every web page: shortcuts, Vim keys, swipes, dialogs, pop-up blocker, site styles),
                ui.js (the browser window), adblock.js (cosmetic filtering, scriptlets, YouTube's ads)
src/ui          the browser window (bifrost://ui): browser.html, browser.css, js/
src/pages       internal pages (bifrost://settings, history, downloads, bookmarks, extensions, tasks,
                newtab, reader, about, welcome) and their shared files (common/)
src/shared      defaults.js (every setting and command), themes.js, engine.js (launcher ranking),
                launcher-settings.js (the launcher's settings files, Waypoint's included, and its keys)
src/vendor      electron-chrome-extensions, electron-chrome-web-store, Ghostery's adblocker, Readability
assets          icons, bundled filter lists
tools           packaging: package.mjs, assemble.cjs, setup/ (the Windows setup), win/ (launcher and
                installer stubs, built with llvm-mingw)
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
task manager), `behavior` (settings that change behavior, the Launcher section's included, how long the downloads box stays; the settings page opening with what
you see and building the rest after), `everyday` (video, full screen and what shows
over it, PDFs, pop-ups, Leave site?, permissions and the permissions shield (in the address bar and in the compact toolbar's title pill), notifications, the keyboard following the tab on screen,
Ctrl+Tab's list of tabs and Ctrl+Tab after Ctrl+W, the side panel and its side bar (websites there: cookies, staying loaded, links, permission
questions, notifications, dialogs), find, zoom,
context menu, tab dragging in every tab layout and pinning, the tab group line, private windows), `extensions` (MV3 service worker APIs,
onInstalled, storage and alarm events in the worker, context menus, popups and a popup in the side panel, Dark Reader, Stylus with a
usercss theme on a local YouTube stand-in, site styles), `daily`, `gestures`, `hidpi` (a 150% display:
menus open at the pointer, things are where they're drawn), `web` (translation, dangerous-site warnings),
`passwords` (Bitwarden against a local stand-in server; needs the extension in ~/cache/exts/bitwarden),
`youtube` (YouTube's ads against a local stand-in for youtube.com: video ads covered and skipped, whatever
kind; the ads in its pages hidden; ads taken out of Shorts; embedded players; the settings that turn it off),
`sync` (two Bifrosts sharing a folder), `updates` (the updater against a local release feed: checks,
downloads, checksums, restarting into the update). The Windows setup, end to end with PowerShell and Wine:
`sh tests/setup/setup-test.sh`. Unit tests: `node tests/unit/<name>.test.mjs` (`sync-merge` and
`sync-engine` cover sync's merging and its handling of broken files and missing folders, `file-guard`
what local pages may load, `blend` the colors of "Match the page", `ranking` the launcher's ranking (what you
use and open comes first), `launcher-settings` that every setting
of the Waypoint extension has a place in Settings → Launcher, that its settings files import whole, and
what Enter and the launcher's other keys do).

## Releases

A new version in package.json reaching main (or a version tag, `v1.2.3`, matching package.json) runs
`.github/workflows/release.yml` on a Windows runner: `tools/release.mjs` builds both installers, the
portable zip and the update files on castlabs' Electron (with Widevine), signs them for Widevine with the
castlabs EVS account in the repository's secrets (`EVS_ACCOUNT_NAME`, `EVS_PASSWD`), `tools/drm-check.mjs`
checks that protected video plays, and the release is published with RELEASE_NOTES.md. Bifrost's updater
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
sh tools/win/build.sh                     # the Windows stubs, after changing the version or the icon
node tools/package.mjs win-setup          # dist/Bifrost-<version>-Windows.zip (builds Bifrost on the PC)
node tools/release.mjs [--sign]           # dist/release: what the release workflow publishes
```

The zip holds `Install Bifrost.cmd`: on the user's PC it downloads the Electron runtime (castlabs' build,
with Widevine) for x64 and ARM64, checks the published checksums, and builds portable Bifrost (one folder,
both builds) and both installers. Those aren't signed for Widevine (Netflix won't play); release builds are.

## License

GPL-3.0-or-later. Bundled components keep their own licenses (see src/vendor).
