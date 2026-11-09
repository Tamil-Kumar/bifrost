## Bifrost 0.26.0

- **Choose which Google account Google's sites open with.** Google opens Gmail, YouTube, Drive, Docs and the rest with the first account you signed in to, and the only way to change that was to sign out of every account and back in, in another order. The new **Settings → Accounts** lists the Google accounts you're signed in to, and lets you choose:
  - **Default account:** the one every Google site opens with.
  - **For particular sites:** another account for one site (YouTube with your personal account, Classroom and Docs with your school one…), or Google's own choice there. The most specific site counts: docs.google.com before google.com, www.google.com/maps before www.google.com.
- It works when you open a Google site from outside Google: the address bar (searches with Google too), a bookmark, Speed Dial, a link on another site or from another app. Inside Google nothing changes: its own links already say which account they're for, and switching accounts there works as usual.
- Google numbers your accounts in the order you signed in, so Bifrost reads them from Google (with your own sign-in, as Chrome does) when you open Settings → Accounts and again whenever you sign in or out. Your choices keep pointing at the right account when that order changes. An account you're no longer signed in to is left to Google, and Settings marks it "not signed in". Private windows are left alone.
- Bifrost asks Google for your accounts only once you've chosen one, or opened Settings → Accounts.

**Install:** `Bifrost-Setup-0.26.0-x64.exe` for most PCs, `Bifrost-Setup-0.26.0-arm64.exe` for ARM laptops (Snapdragon). It installs for you only, no administrator rights needed, and keeps your profile. **Portable:** `BifrostPortable-0.26.0.zip`: unzip it over your BifrostPortable folder (its Data folder stays). Bifrost 0.24.0 and later update themselves.
