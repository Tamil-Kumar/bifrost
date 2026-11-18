## Bifrost 0.38.2

- **Opening files with Bifrost:** a PDF (or a page, a picture, any file) you open with Bifrost from Explorer opens in a tab, whether Bifrost is running or not. Windows hands Bifrost the file's path without quotes, and Bifrost read it in pieces at each space, so a file with a space anywhere in its path (its name, a folder, your user name) opened nothing and Bifrost only came to the front. Each release is now checked on Windows for this before it's published: a PDF, a page and a link, opened the way Explorer opens them.
- **Drag files into Bifrost:** drop files on a tab to open them in it, on the tab list to open them in new tabs, on the address bar to open them in the tab you're on, or on a page to open them in a new tab next to it (a page with its own place to drop files, like an upload box, still gets them).

**Install:** `Bifrost-Setup-0.38.2-x64.exe` for most PCs, `Bifrost-Setup-0.38.2-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.38.2.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
