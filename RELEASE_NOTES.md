## Bifrost 0.42.0

- **Appear in another country:** the VPN now keeps a list of locations, each named by its country. They're WireGuard files from a VPN service. Proton VPN's free plan has servers in 10 countries: the Netherlands, Japan, the United States, Canada, Mexico, Norway, Poland, Romania, Switzerland and Singapore. Its own free app picks a server for you; with its files, Bifrost lets you pick.
- **Getting free locations:** the VPN's popover walks you through it. Sign in at Proton VPN, go to Downloads → WireGuard configuration, pick a free server for each country you want, and download its file. Bifrost offers to add each file as it downloads. Files you already have: Add locations, several at once.
- **See where sites see you:** once it's connected, the popover says "Sites see you in Japan", with the address sites get. Bifrost checks this through the VPN itself (Cloudflare's trace page), so it isn't a guess. Each location you add is tried on its own first, so you know whether it answers, and how quickly, before you pick it.
- **One click to switch:** pick a location in the popover and the VPN goes there, turning on if it was off. Cloudflare WARP is still there as "Near you": free, no account, the fastest, but it keeps you in your own country.
- **Sites that skip the VPN:** some banks, school sites and streaming sites turn VPNs away. The popover has a switch for the site you're on, and Settings keeps the list. Those sites are reached directly; everything else still goes through the VPN.
- **Private windows only, if you like:** Settings → Privacy & security → VPN → Which windows: every window, or only private ones.
- **Settings → VPN, redone:** each location with its country, server and how fast it answered, with buttons to try it again or forget it.

Proton's free plan allows one connection at a time, so while Bifrost uses one of its servers, Proton's own app signed in to the same account may be turned away.

**Install:** `Bifrost-Setup-0.42.0-x64.exe` for most PCs, `Bifrost-Setup-0.42.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.42.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
