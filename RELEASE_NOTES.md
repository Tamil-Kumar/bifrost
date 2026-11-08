## Bifrost 0.25.9

- **HaGeZi's DNS blocklists in the ad blocker, on by default.** On top of EasyList, EasyPrivacy and uBlock Origin's lists, Bifrost now blocks over 280,000 whole domains of ads, trackers, telemetry, pop-up ads, scams and malware from HaGeZi's lists (Ultimate, with Pro++, Pro, Multi, Light, Pop-Up Ads, the device trackers and Ad-Shield). Whatever a page loads from those domains (scripts, frames, requests) is blocked and counted, and a pop-up ad a page opens when you click it is stopped, with a note and a way to open it anyway. **Update filter lists now** (and the daily update) fetches them fresh from HaGeZi's GitHub repository.
- **Made not to break sites.** Ultimate is HaGeZi's most aggressive list, so Bifrost holds it back where it would break things:
  - It never blocks the site you're on: you can visit a site that's on the list, and what that site loads from its own domains works.
  - It never blocks a company's own services on that company's other sites (Google's consoles calling googleapis.com, Office calling live.com, TikTok calling its own servers…). On anyone else's site they're blocked as usual.
  - It leaves alone what sites can't do without: bot checks and captchas, fraud checks at sign-in and checkout, where-am-I lookups for your country and currency, embedded posts, video players' licence checks, help chats and sign-up forms.
  - HaGeZi's own exceptions only unblock what this list would have blocked, so they never let through anything EasyList blocks.
  - uBlock Origin's fixes apply here too: its stand-in scripts replace scripts that pages call into.
  - If a site still misbehaves, turn the list off (Settings → Privacy & security → Ad, tracker and scam domains), or allow ads on that site.

**Install:** `Bifrost-Setup-0.25.9-x64.exe` for most PCs, `Bifrost-Setup-0.25.9-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.25.9.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
