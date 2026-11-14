## Bifrost 0.31.0

- **Import from Stylus works with Stylus's own backups:** current Stylus (version 2) leaves the CSS out of its backups (Stylus → Manage → Export) for styles like Catppuccin's, saving only their code. Bifrost brought those styles in empty, so websites didn't change. Now each one is built from its code, with the options you chose in Stylus (flavor, accent and so on).
  - Styles you already brought in empty are built the next time Bifrost starts, so you don't need to import again.
  - A style written in Stylus's own language (not LESS) can't be built in Bifrost. Settings says so and tells you how to export it with its CSS: Shift+click Export in Stylus.

**Install:** `Bifrost-Setup-0.31.0-x64.exe` for most PCs, `Bifrost-Setup-0.31.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.31.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
