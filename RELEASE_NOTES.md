## Bifrost 0.27.0

- **Dark mode for websites, built in** (Settings → **Website styles**), so you don't need Dark Reader:
  - One switch darkens every website. A site with a dark theme of its own uses that; Chromium darkens the rest itself as it draws them, so nothing runs inside the pages (Dark Reader runs in every tab) and it costs next to no memory.
  - **Alt+Shift+D** turns it on or off everywhere. **Alt+Shift+A**, or the new Dark mode switch in a site's info popover (the icon left of the address), does it for the site you're on, its subdomains included. Settings lists the sites you've set.
  - Brightness, contrast and sepia sliders on top of it.
- **Your styles, built in** (Settings → Website styles → **Your styles**), so you don't need Stylus:
  - Userstyles, as Stylus has them: each one is for the pages it names, goes over the site's own styles from the first paint (no flash of the old look), and still works on sites whose security rules forbid styles.
  - **Install from a link**, or just open a `.user.css` link (userstyles.world's Install button): Bifrost offers to install it. **New style** to write your own. **Edit**, with the style's own options (colors, choices) as controls. On and off switches, here and in the site's info popover. **Check for updates**.
  - **Import from Stylus**: in Stylus, open Manage → Backup → Export, then pick that file here. Your styles come over with the CSS Stylus built, Catppuccin's included.
  - Not yet: styles written in LESS (Catppuccin's are) can't be installed from a link, edited or updated here. Bring them over from Stylus for now.

**Install:** `Bifrost-Setup-0.27.0-x64.exe` for most PCs, `Bifrost-Setup-0.27.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.27.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
