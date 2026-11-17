## Bifrost 0.37.0

- **Starts sooner:** the window's tabs and toolbar are there about 0.13 s sooner, and the first page about 0.15 s sooner (around 10% on the test machine). The lists behind the dangerous-site warnings were built again from scratch every time Bifrost started, competing with the window for the processor; they're kept ready between starts now. HaGeZi's ad and tracker domain list is now a compact table (2 MB instead of 11 MB) that Bifrost reads back as it is, with nothing to rebuild. Bifrost's own code is compiled once and kept, instead of on every start.
- **Protected video doesn't hold up the first page:** once Widevine is installed (after the first start), pages no longer wait for Bifrost to finish checking it at startup. That check carries on in the background.
- **Lighter page loads:** Bifrost does about 15% less work in its main process while a page loads: the ad and tracker domain list is a quick lookup now, settings are read once instead of for every request, and parts that weren't in use no longer run on every page. Pages only measure their edge colors when "Match the page" or "Blur the page" is on, and Catppuccin for every site does nothing on pages where it's off.
- **Smoother "Match the page":** it now reads only the page's edges instead of the whole page each time you scroll, which costs Bifrost much less on big screens.
- **Less memory:** the browser's main process uses about 20 MB less.

**Install:** `Bifrost-Setup-0.37.0-x64.exe` for most PCs, `Bifrost-Setup-0.37.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.37.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
