## Bifrost 0.38.3

- **Opening files with Bifrost running, the rest of the story:** 0.38.2 fixed it, and its check on Windows showed what had been wrong there. A running Bifrost gets the file's path from Windows with an invisible extra character at the end (Electron reads one character too many from Windows' message), so no file ever matched and Bifrost only came to the front, whatever the path. 0.38.2 opens the file from what the new start reads itself; this release takes the extra character off as well, so both ways find the file.

**Install:** `Bifrost-Setup-0.38.3-x64.exe` for most PCs, `Bifrost-Setup-0.38.3-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.38.3.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
