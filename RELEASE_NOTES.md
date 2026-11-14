## Bifrost 0.32.0

- **YouTube doesn't catch the ad blocker any more:** YouTube's ads are now blocked the way AdGuard blocks them. Before, YouTube could tell in three ways: its requests to Google's ad servers were blocked (by the general ad blocker), its ads were loaded and started playing before Bifrost skipped them, and the experimental YouTube filters left out the uBlock Origin scripts that hide ad blocking from YouTube (they break YouTube in Bifrost's engine).
  - The ads are taken out of what YouTube sends before its page sees it, so the player has none to play (as YouTube Premium's videos come). The player's own check for a video that came without ads passes.
  - Nothing YouTube asks for is blocked on YouTube, Google's ad servers included. With no ads to play, it asks them for little.
  - What YouTube does when it suspects an ad blocker (a callback, then a 17-second wait) does nothing, and the page can't tell those were changed.
  - YouTube's tabs go past its service worker, so it can't fetch the ads around Bifrost. It stays registered, so its notifications still come.
  - An ad that gets through anyway is still covered, muted and skipped, as it is in YouTube players embedded in other sites and in a tab with DevTools open.
  - Settings → Privacy & security has one switch for it, "Block YouTube ads" (also in the site info popover on YouTube). The experimental "YouTube filters" option is gone.
  - The ad blocker on every other site is the same as before.

**Install:** `Bifrost-Setup-0.32.0-x64.exe` for most PCs, `Bifrost-Setup-0.32.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.32.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
