## Bifrost 0.28.0

- **Your Google accounts are read again** (Settings → Accounts). Google had stopped answering the way Bifrost asked for the accounts you're signed in to ("Google answered 400"); Bifrost now asks the way Chrome does.
- **Styles written in LESS work in Bifrost** (Catppuccin's are). Bifrost builds them itself, as Stylus does:
  - **Import from Stylus** takes the files made for importing into Stylus, like Catppuccin's `import.json`, as well as Stylus backups. Each style is built from its code, Settings shows how far along it is, and names any that couldn't be built.
  - LESS styles can be installed from a link, edited (with their options, like flavor and accent), and updated like any other.
  - Catppuccin's library comes with Bifrost, so their styles build offline. A style that pulls in another site's CSS (code colors, Codeberg's theme) has it built in.

**Install:** `Bifrost-Setup-0.28.0-x64.exe` for most PCs, `Bifrost-Setup-0.28.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.28.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
