## Bifrost 0.24.9

- **Settings opens fast.** It took about half a second to show on a fast PC, and longer on a laptop or with lots of bookmarks and site settings; now it's two to three times quicker. Three things held it up:
  - To show whether Bifrost is your default browser, it asked Windows by running `reg.exe` and waited for it, and all of Bifrost stood still while it did. Now Bifrost asks without waiting (and doesn't ask twice within a few seconds), so nothing stops.
  - It built and laid out all 300-odd settings before showing any. Now it shows the section you're looking at first and builds the rest right after, and sections off screen aren't laid out until you scroll near them. Searching, or going to a section, finds everything as before.
  - Its scripts loaded one after another. Now they're fetched all at once.
- **"Make default" and "Add shortcuts" don't freeze Bifrost.** On Windows they write 25 registry entries, each by starting `reg.exe`, and the browser stopped responding until all of them were done. Now that happens in the background.

**Install:** `Bifrost-Setup-0.24.9-x64.exe` for most PCs, `Bifrost-Setup-0.24.9-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.24.9.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
