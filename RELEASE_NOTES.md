## Bifrost 0.32.4

- **The mouse's Back button goes back one page, for sure this time:** 0.32.3 counted everything from one press once, but it timed each signal by when Bifrost's window got to it. Right after going back, the window can be busy with the page that's coming for more than that 0.4 seconds, so a second signal from the same press could still count as a press of its own. Now each signal is timed by when it happened. A key that repeats while a mouse's software holds it down for the button (Alt+Left, say) is part of the same press too.

**Install:** `Bifrost-Setup-0.32.4-x64.exe` for most PCs, `Bifrost-Setup-0.32.4-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.32.4.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
