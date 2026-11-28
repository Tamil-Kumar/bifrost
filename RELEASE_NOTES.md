## Bifrost 0.41.1

- **A faster VPN:** uploads through it are 3 to 14 times faster than in 0.41.0, and downloads 15–70% faster. On Windows test machines through Cloudflare WARP, uploads went from about 25–60 Mbit/s to 190–380, and a 50 MB download from about 260–320 Mbit/s to 430–550. It also uses less processor time for the same download.
- **Pages a little sooner through it:** a site's address is looked up once for all the connections a page opens to it, then remembered for up to 5 minutes, so going back to a site skips that step. Through WARP, sites answered up to a fifth sooner the second time.
- **Fewer stalls:** if the VPN's DNS server is slow to answer, the next one is asked after half a second instead of 5 seconds. If a site's IPv6 address doesn't connect, its IPv4 one is tried after 0.3 seconds instead of waiting for the first to give up.

**Install:** `Bifrost-Setup-0.41.1-x64.exe` for most PCs, `Bifrost-Setup-0.41.1-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.41.1.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
