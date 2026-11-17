# Bifrost

A keyboard-first browser built on Electron: vertical or horizontal tabs, spaces, split view, a side panel
for bookmarks, history, websites and extensions (with a side bar, as in Firefox), a launcher
that searches bookmarks, tabs, history and the web, a built-in ad blocker (EasyList, EasyPrivacy, uBlock
Origin's lists and HaGeZi's DNS blocklists), dark mode for websites and userstyles (as Dark Reader and Stylus
do, styles written in LESS too; Catppuccin's styles in Bifrost's theme, and Catppuccin's colors on every site
that has no style of its own), warnings for dangerous sites, your choice of which Google account Google's sites open with, page translation, Chrome extensions (Manifest V2 and V3), sync between
your computers through a cloud folder, and a lot of settings — every animation can be turned off.

## Layout

```
src/main        main process: windows, tabs (guests.js), settings, history/bookmarks (db.js), downloads,
                ad blocker (adblock.js; domain-list.js: HaGeZi's lists and what keeps them from breaking
                sites; youtube-ads.js: YouTube's ads taken out of what it sends, a YouTube tab's answers held
                through its DevTools protocol session, tab-debugger.js; youtube-edit.js: what becomes of
                them, by rules that are data; youtube-rules.js: those rules kept up to date from this
                repository), dangerous-site warnings (safety.js), extensions (extensions/), imports from
                other browsers (import/), sessions, sync (sync/: the folder engine, merging, position keys),
                the fingers on the touchpad (touchpad.js: when they lift, for swipes), which Google account
                Google's sites open with (google-accounts.js), how websites look (web-styles.js: dark mode for
                websites, your userstyles, Catppuccin's in your theme, which pages get Catppuccin's colors and
                the other sites' stylesheets read for them; less-builder.js: userstyles written in
                LESS, built in a worker, less-worker.js, and the files they import; web-theme.js: their color
                scheme, and Chromium's dark mode, per tab, and the sites whose own dark theme is partly white),
                timing.js (when each part of starting up happened, for tests/bench)
src/preload     tab.js (every web page: shortcuts, Vim keys, swipes, dialogs, pop-up blocker, site styles),
                sw.js (websites' service workers: their notifications), ui.js (the browser window),
                adblock.js (cosmetic filtering, scriptlets, YouTube's ads), recolor.js (Catppuccin for every
                site: a page's colors turned into Catppuccin's as it loads; see "Catppuccin for every site")
src/ui          the browser window (bifrost://ui): browser.html, browser.css, js/
src/pages       internal pages (bifrost://settings, history, downloads, bookmarks, extensions, tasks,
                newtab, reader, about, welcome) and their shared files (common/)
src/shared      defaults.js (every setting and command), themes.js (the themes, and the sidebar's and
                toolbar's colors with "Match the page"), youtube-rules.json (how YouTube's ads are taken
                out: see "YouTube's ads" below), engine.js (launcher ranking),
                launcher-settings.js (the launcher's settings files, Waypoint's included, and its keys),
                google-accounts.js (which pages get which Google account, and Google's list of your accounts),
                usercss.js (userstyles: their header and variables, which pages each part is for, Stylus backups),
                less.js (Bifrost's LESS compiler, for userstyles written in LESS), catppuccin.js (a theme as
                Catppuccin's colors, and the filters that turn icons those colors)
src/vendor      electron-chrome-extensions, electron-chrome-web-store, Ghostery's adblocker, Readability
assets          icons, bundled filter lists (adblock/: domains.txt.gz is HaGeZi's, domains-keep.txt Bifrost's
                exceptions to it), bin/ (the touchpad watcher for Windows, x64 and ARM64), userstyles/catppuccin
                (Catppuccin's userstyle libraries, for building their styles offline)
tools           packaging: package.mjs, assemble.cjs, setup/ (the Windows setup), win/ (launcher and
                installer stubs, and the touchpad watcher, touchpad.c; built with llvm-mingw)
tests           e2e/ (Playwright + Electron under Xvfb, real pointer and keys through XTest), setup/,
                unit/, site/ (local test pages), fixtures/, bench/ (how long starting up and loading a
                page take)
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

Suites: `core` (tab close buttons in every layout, Glass menus, palette, launcher, error pages, downloads, a
small window's toolbar keeping the window's buttons, the menu and the address bar in the window,
task manager), `behavior` (settings that change behavior, the Launcher section's included, how long the downloads box stays (with the real pointer: what holds it open, and its close button), one press of the mouse's Back button one page back however many ways it arrives (and with the window busy in between), links opened in a new tab in front or behind; the settings page opening with what
you see and building the rest after; its side navigation scrolling on its own when it's taller than the window; a box of text too big to show, and My filters' Clear button; "Match the page": a dark page's color taken as it is, the bars staying dark next to a bright one with the page in its frame, or going light, or taking it exactly, with text that reads on each; "Blur the page": the page's picture behind the bars, under dark glass next to a bright page), `everyday` (video, full screen and what shows
over it, PDFs, pop-ups, Leave site?, permissions and the permissions shield (in the address bar and in the compact toolbar's title pill), notifications, the keyboard following the tab on screen,
Ctrl+Tab's list of tabs and Ctrl+Tab after Ctrl+W, the side panel and its side bar (websites there: cookies, staying loaded, links, permission
questions, notifications, dialogs; arranging it: its + off with its menu, its row in Settings → Toolbar & sidebar; its buttons and
the sidebar's bottom row evenly spaced, collapsed and open), find, zoom,
context menu, tab dragging in every tab layout and pinning, the tab group line, private windows), `extensions` (MV3 service worker APIs,
onInstalled, storage and alarm events in the worker, context menus, popups and a popup in the side panel, Dark Reader, Stylus with a
usercss theme on a local YouTube stand-in, site styles), `daily` (the address bar, unsaved changes, downloads,
pages' dialogs, tabs back after a restart, and the window working while Bifrost is still starting: its own
pages at once, web pages once it has started), `gestures` (two-finger swipes: the arrow, on
either side, and turning back taking it out at once; going only once the fingers lift, said by the touchpad watcher, played here by
tests/fixtures/touchpad-standin.mjs, or else by the end of the scroll gesture; coasting; the swipes that
don't count; settings), `hidpi` (a 150% display:
menus open at the pointer, things are where they're drawn), `web` (translation, dangerous-site warnings, a
site's own user agent in what's sent and what its pages read),
`passwords` (Bitwarden against a local stand-in server; needs the extension in ~/cache/exts/bitwarden),
`youtube` (YouTube's ads against a local stand-in for youtube.com: only YouTube's tabs held (a tab sent on to
YouTube by another site too), taken out of what it sends (a watch page's
player data, the player's answers, a watch page asked for) with nothing else changed and its cookies set, the
player's check for a video without ads passing, nothing it asks for blocked (Google's ad status script) while
other sites still are, its "abnormality" callback and 17-second wait quiet and looking untouched, its service
worker gone past; video ads that get through covered and skipped, whatever kind; the ads in its pages hidden;
ads taken out of Shorts; Space playing and pausing a Short; embedded players; the settings that turn it off;
newer rules fetched and taken at once, in open tabs too, and rules that aren't right refused),
`blocking` (the ad blocker's domain list, HaGeZi's, here tests/fixtures/domains-test.txt, against local
stand-in sites: what pages load from listed domains blocked, never the site you're on nor a company's own
services on its own sites, its exceptions scoped to it, your own @@ rules and uBlock's stand-ins, the list off
or a site allowed, pop-up ads, updating from HaGeZi's files and keeping the old list when that goes wrong),
`accounts` (which Google account Google's sites open with, against local stand-ins for accounts.google.com's
list of your accounts (answering only Chrome's request, a POST from www.google.com, in Chrome's form) and for
Gmail, YouTube, Docs, Drive, Photos and Search: Settings → Accounts reading them
with your cookies and again when you sign in or out, the default account and particular sites, Gmail's
addresses with an account number in them (and gmail.com) opened yourself or from another site's link, what's
left alone (links inside Google in the tab or a new one, a reload, back and forward, pages that name an account
by email, sign-in, forms, private windows, accounts you're signed out of), Google taking authuser out again,
the email before the accounts are read, making an account Google's own default: signing out through Google,
its sign-in, the others signed in to again), `webstyles`
(dark mode for websites against local stand-in sites, read off the screen: turned on in Settings and in open
tabs at once, a site's own dark theme, per site with Alt+Shift+A and the info popover, Alt+Shift+D, a site
whose own dark theme is partly white darkened by Bifrost (remembered, listed in Settings, forgotten there), a
site you choose Bifrost's dark mode for, brightness and sepia on the top page only; your styles installed from a link, there from the first paint (one question to the main process a page, none for its frames), in a frame of another site's page, and through a
strict Content-Security-Policy, off and on, edited, deleted, in the info popover; a Stylus backup; a .user.css
link offering to install itself; a file for importing into Stylus, Catppuccin's: its LESS styles built, with
Bifrost's copy of Catppuccin's library and the CSS a style imports put in it, how far along, what couldn't be
built; Stylus 2's backup, its usercss styles saved without the CSS Stylus built (built here with the options
chosen in Stylus), one in Stylus's own language said plainly, one brought in empty by an older Bifrost built at
the start; a LESS style's options changed and it rebuilt; your theme on websites, Catppuccin's styles in Frost's
colors and in Catppuccin Macchiato, in open tabs at once, kept for the next start, off again; Catppuccin for every
site on a light page written as sites are now, at once and from its first paint, each color as recolor.js's color
work makes it (variables, Bootstrap's, shadcn's and Tailwind's numbers in them, style="", bgcolor, an SVG's fill,
another site's stylesheet through a redirect, a rule a script adds, a web component, a frame and a frame the page
writes itself), your style for the site over it, a page one of your styles is for left alone, off for a site in
its info popover, your theme's colors, Latte for light websites, nothing read from your own network, off again),
`sync` (two Bifrosts sharing a folder), `updates` (the updater against a local release feed: checks,
downloads, checksums, restarting into the update), `notifications` (tabs behind others hidden to their pages
and without the focus, as in Chrome: opened behind, after going to another page, with the window hidden, the
side panel's website; a page's own notifications, and the ones a site shows through its service worker, from
the page or the worker, really shown: Bifrost runs on a stand-in for libnotify, tests/fixtures/fake-libnotify.c,
built with gcc, that writes them down and clicks or closes them; clicks bringing the site's tab to the front
and reaching its worker, also after the worker has stopped or the tab has gone to sleep; tags,
getNotifications(), blocked sites, the permission as a page and a frame in it read it). The Windows setup, end to end with PowerShell and Wine:
`sh tests/setup/setup-test.sh`. Unit tests: `node tests/unit/<name>.test.mjs` (`sync-merge` and
`sync-engine` cover sync's merging and its handling of broken files and missing folders, `google-accounts`
reading Google's list of your accounts (both its forms) and which pages get which account, `usercss` userstyles'
headers, variables and @-moz-document parts and the pages they match, Stylus backups and files for importing into
Stylus, `less` the LESS compiler against what less.js makes of the same LESS (and Catppuccin's library),
`youtube-edit` YouTube's answers without their ads (its player data, a watch page's, Shorts' reels, the
player's check), which answers those are, and which rules for it are taken (newer ones that follow what
YouTube changed) and which refused, `catppuccin` a theme as Catppuccin's colors, the filters for them (as close as Catppuccin's own) and
Catppuccin's library with them in it, `recolor` Catppuccin for every site's colors (every way CSS writes a color
read; what a background, text, a line and a shadow become in Mocha, in Latte and in Bifrost's themes, by lightness
and hue; text readable on them; values rewritten: gradients, shadows, variables pointed at their twins, the numbers
Bootstrap, shadcn and Tailwind keep in variables, url()s), `domain-list` the ad
blocker's domain list made from HaGeZi's files, which sites are the same company's, and the bundled list with
Bifrost's exceptions (what it blocks and what it leaves alone), `file-guard`
what local pages may load, `blend` the colors of "Match the page" (on every page color with every theme: text
that reads on the bars, never a mid-tone the sites' icons can't be seen on, a dark page's color as it is, a deep
shade of one in the middle, the theme's own shade next
to a bright one, "Go light" and "Exactly the page's"), `settings-migrate` what settings saved by older versions
turn into, `ui-preload`
that browser.html preloads every script the window's UI imports, `ranking` the launcher's ranking (what you
use and open comes first), `launcher-settings` that every setting
of the Waypoint extension has a place in Settings → Launcher, that its settings files import whole, and
what Enter and the launcher's other keys do; `side-bar` the side bar's order, yours or the usual one;
`touchpad` the touchpad watcher, counting fingers in made-up touchpad reports and running the program
itself, both under Wine; it's skipped without llvm-mingw and Wine).

### YouTube's ads

How YouTube's ads are taken out is in `src/shared/youtube-rules.json`: which of its answers are held
(`hold`), which kind each is (`answers`), what's done to each kind (`edits`: `rename` JSON keys, `prune` items
from lists, `replace` a pattern in the player's script, `inside` the object a script names), and what's hidden
and pressed in its pages (`page`). Bifrost looks at this file on `main` a minute after it starts and every six
hours (and with Settings → Privacy & security → Update filter lists now), and takes a copy with a higher
`version` at once, in tabs already open too. So when YouTube changes something (a key's name, an address, the
wording of its player's check), change the file, raise `version` (the date and a count: 2026111601), run
`node tests/unit/youtube-edit.test.mjs` and push to `main`: no new version of Bifrost is needed, and none is
made (package.json hasn't changed). The rules are data, checked before they're used: a file with anything in
it that a version of Bifrost doesn't know is refused whole, and that version keeps the rules it has. They
only apply to YouTube's own sites.

How fast (medians over several runs; compare two versions one after the other on the same machine, the
numbers move with what else it's doing):

```
xvfb-run -a node tests/bench/startup.mjs [runs] [--fresh] [--history=<pages>] [--tabs=<n>] [--each] [--root=<another checkout>]
xvfb-run -a node tests/bench/pageload.mjs [runs] [--only=default,bare] [--no-ads] [--root=<another checkout>]
```

`startup` starts Bifrost with a profile that's been used (its ad blocker's lists built and kept) and prints
when the window was shown, when its UI had loaded and when the first page was in, then the marks Bifrost
keeps itself (src/main/timing.js; `BIFROST_TIMING=1` prints them on any start). `pageload` loads a local page
of about 200 requests over five origins in a tab, as Bifrost comes, with the ad blocker off, and with nothing
of Bifrost's on the requests (the floor). `--root` measures another checkout (an older version) the same way.

### Catppuccin for every site

Settings → Website styles → Catppuccin for every site. Catppuccin's own styles (their import.json) cover the sites
they were written for; every other site gets Catppuccin's colors from `src/preload/recolor.js`, which turns the
colors a page's stylesheets say into Catppuccin's as the page loads (as Dark Reader's dynamic mode does, with
Catppuccin's palette): each of the page's stylesheets gets one of Bifrost's after it, adopted (so CSP can't stop
it), with the same selectors in the same @-rules saying its colors again. A color goes by what it colors (a
background to base and the surfaces, text to text and the subtexts, a line to the surfaces, a shadow to crust;
Latte the other way around), how light it is (a light page's white to base, a dark sidebar darker than that) and
its hue (to the Catppuccin color of the nearest hue: blue, red, peach, yellow, green, teal, sky, sapphire,
lavender, mauve, pink); text is held to 4.5:1 on base. CSS variables used for colors get twins
(`--bfb-name` for a background, `--bft-name` for text, `--bfbr-name` for a background's rgb numbers…) set beside
them, and the colors that use them use the twins. Also turned: `style=""`, `bgcolor` and `<font color>`, SVG
fill and stroke, stylesheets from other sites (read by the main process: CSS only, no cookies, nothing from your
own network for a page on the web), rules scripts add (their insertRule is watched from the page's world), open
shadow roots, frames and the frames a page writes into itself. The palette is Mocha (Latte where websites are
light), or your theme's while websites match it; a page one of your styles is for is left to that style, and
sites can be turned off in their info popover.

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
