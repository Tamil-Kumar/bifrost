## Bifrost 0.40.1

- **The pointer in full screen, again:** after a YouTube video went full screen, the pointer could still stay on it when the controls went away, until you moved the mouse. Going full screen moves everything under a still mouse, and Chromium could be left thinking the mouse was over something it no longer was, so when YouTube asked for no pointer, the request went nowhere. Now, a moment after a page goes full screen, Bifrost has Chromium look again at what's under the pointer, as moving the mouse would. YouTube shows its controls for a few seconds, then hides them and the pointer together. Each release now checks this on a real Windows machine, with real mouse input.

If the pointer still stays for you, check you're on 0.40.1 (the menu's About Bifrost): Bifrost puts an update in when it restarts, and the menu says Restart to update Bifrost when one's ready.

**Install:** `Bifrost-Setup-0.40.1-x64.exe` for most PCs, `Bifrost-Setup-0.40.1-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.40.1.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
