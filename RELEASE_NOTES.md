## Bifrost 0.39.1

- **Sheets in the dark:** a spreadsheet's grid stayed white in dark mode. Sheets draws it on a canvas a piece at a time, and Bifrost looked at it once while it was half drawn and gave up; it looks again now until the grid is in, and pale cell colors (a column you filled light red, the blue of the column you're in) no longer keep it from being darkened. Cell colors stay, darker.
- **Docs' and Sheets' toolbar icons:** in dark mode they stayed dark gray next to light text. Google puts a space inside each icon, so Bifrost didn't see them as icons; they're light now, like the text.
- **Black titles on dark cards:** on SpeechDrop, file names stayed black on Catppuccin's dark cards. A small page icon in the corner of each card counted as a picture behind the name, and text over a picture keeps the page's color. Now only a picture that covers most of the element does, so the names are in text's color.

**Install:** `Bifrost-Setup-0.39.1-x64.exe` for most PCs, `Bifrost-Setup-0.39.1-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.39.1.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
