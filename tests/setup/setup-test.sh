#!/bin/sh
# The Windows setup, end to end, on Linux:
#   1. packages the zip (tools/package.mjs) and unzips it
#   2. runs the real files/setup.ps1 with PowerShell (pwsh), on the cached Electron zips, with Node doing
#      the assembling that Electron's own Node does on Windows (BIFROST_SETUP_NODE)
#   3. checks what it made: BifrostPortable with both builds, branded Bifrost.exe, the app at this
#      version, both installers
#   4. under Wine: the x64 installer installs silently (files, version, uninstaller entry), the
#      uninstaller removes it, and BifrostPortable.exe starts the x64 build with the arguments it got
#   5. running the setup again keeps BifrostPortable's Data folder
#   6. updates: an installed Bifrost's "Uninstall Bifrost.exe /apply" and BifrostPortable.exe put in what the
#      updater downloaded (resources\app.next, App\Bifrost-<arch>.next)
#   7. the release (tools/release.mjs): its files, latest.json, and its installer under Wine
# Needs: pwsh (/opt/pwsh), Wine (/opt/wine), node, the Electron win32 zips in ~/cache (or $CACHE).
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CACHE=${CACHE:-/home/claude/cache}
PWSH=${PWSH:-/opt/pwsh/pwsh}
WINE=${WINE:-/opt/wine/bin/wine}
VERSION=$(node -p "require('$ROOT/package.json').version")
ELECTRON=$(node -p "require('$ROOT/package.json').engines.electron")
WORK=$(mktemp -d /tmp/bifrost-setup-test.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ✓ $1"; }
bad() { fail=$((fail+1)); echo "  ✗ $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "setup test: Bifrost $VERSION, Electron $ELECTRON"
node "$ROOT/tools/package.mjs" win-setup --out="$WORK/dist" > "$WORK/package.log"
check "the package builds" "[ -f '$WORK/dist/Bifrost-$VERSION-Windows.zip' ]"
(cd "$WORK" && unzip -q "dist/Bifrost-$VERSION-Windows.zip")
SETUP="$WORK/Bifrost-$VERSION-Windows"
check "the zip has Install Bifrost.cmd, README.txt and files/" "[ -f '$SETUP/Install Bifrost.cmd' ] && [ -f '$SETUP/README.txt' ] && [ -d '$SETUP/files/app/src' ]"
check "the README has proper Windows paths" "grep -q 'BifrostPortable\\\\BifrostPortable.exe' '$SETUP/README.txt' && grep -q 'PortableApps\\\\Bifrost-$VERSION-Windows' '$SETUP/README.txt' && ! grep -q '\\\${' '$SETUP/README.txt'"

# 2. The setup itself.
run_setup() {
  BIFROST_SETUP_NODE=$(command -v node) "$PWSH" -NoProfile -File "$SETUP/files/setup.ps1" -NoPrompt \
    -X64Zip "$CACHE/electron-v$ELECTRON-win32-x64.zip" -Arm64Zip "$CACHE/electron-v$ELECTRON-win32-arm64.zip" > "$WORK/setup.log" 2>&1
}
if run_setup; then ok "setup.ps1 finishes"; else bad "setup.ps1 finishes"; tail -20 "$WORK/setup.log"; fi
check "it checked both checksums" "grep -q 'Checksum OK (x64)' '$WORK/setup.log' && grep -q 'Checksum OK (arm64)' '$WORK/setup.log'"
P="$SETUP/BifrostPortable"
check "BifrostPortable has the launcher and both builds" "[ -f '$P/BifrostPortable.exe' ] && [ -f '$P/App/Bifrost-x64/Bifrost.exe' ] && [ -f '$P/App/Bifrost-arm64/Bifrost.exe' ]"
check "both builds carry this version of the app" "grep -q '\"version\": \"$VERSION\"' '$P/App/Bifrost-x64/resources/app/package.json' && grep -q '\"version\": \"$VERSION\"' '$P/App/Bifrost-arm64/resources/app/package.json'"
check "Bifrost.exe is branded (version $VERSION in its properties)" "node -e \"const b=require('fs').readFileSync('$P/App/Bifrost-x64/Bifrost.exe');process.exit(b.includes(Buffer.from('$VERSION'.split('').join('\\\\0')+'\\\\0','latin1'))?0:1)\""
check "both installers were made" "[ -f '$SETUP/Installers/Bifrost-Setup-$VERSION-x64.exe' ] && [ -f '$SETUP/Installers/Bifrost-Setup-$VERSION-arm64.exe' ]"

# 4. Under Wine.
export WINEPREFIX="$WORK/wine" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
"$WINE" wineboot -i > /dev/null 2>&1 || true
DRIVE_C="$WINEPREFIX/drive_c"
"$WINE" "$SETUP/Installers/Bifrost-Setup-$VERSION-x64.exe" /S '/D=C:\Bifrost Test' > "$WORK/install.log" 2>&1 && code=0 || code=$?
check "the x64 installer runs silently (exit code $code)" "[ $code -eq 0 ]"
check "it installed Bifrost.exe and the app at this version" "[ -f '$DRIVE_C/Bifrost Test/Bifrost.exe' ] && grep -q '\"version\": \"$VERSION\"' '$DRIVE_C/Bifrost Test/resources/app/package.json'"
check "it left an uninstaller" "ls '$DRIVE_C/Bifrost Test/' | grep -qi 'uninst'"
"$WINE" reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bifrost' > "$WORK/reg.log" 2>&1 || true
check "Settings > Apps knows about it (uninstall entry, version $VERSION)" "grep -q 'DisplayVersion' '$WORK/reg.log' && grep -q '$VERSION' '$WORK/reg.log'"
"$WINE" reg query 'HKCU\Software\Clients\StartMenuInternet\Bifrost\Capabilities' > "$WORK/reg2.log" 2>&1 || true
check "it registered as a browser (Default apps)" "grep -qi 'ApplicationName' '$WORK/reg2.log'"
UN=$(ls "$DRIVE_C/Bifrost Test/" | grep -i 'uninst' | head -1)

# 6a. An update the updater downloaded (Bifrost's own files) goes in with /apply.
I="$DRIVE_C/Bifrost Test"
"$WINE" "C:\\Bifrost Test\\$UN" /apply > /dev/null 2>&1 && code=0 || code=$?
check "/apply with no update waiting changes nothing (exit code $code)" "[ $code -eq 0 ] && grep -q '\"version\": \"$VERSION\"' '$I/resources/app/package.json'"
mkdir -p "$I/resources/app.next"
cp -r "$I/resources/app/." "$I/resources/app.next/"
sed -i "s/\"version\": \"$VERSION\"/\"version\": \"9.9.9\"/" "$I/resources/app.next/package.json"
echo '{"version":"9.9.9","kind":"app"}' > "$I/resources/app.next/bifrost-update.json"
"$WINE" "C:\\Bifrost Test\\$UN" /apply > /dev/null 2>&1 && code=0 || code=$?
check "/apply puts in the downloaded update (exit code $code)" "[ $code -eq 0 ] && grep -q '\"version\": \"9.9.9\"' '$I/resources/app/package.json'"
check "…and tidies up after itself" "[ ! -e '$I/resources/app.next' ] && [ ! -e '$I/resources/app.old' ] && [ ! -e '$I/resources/app/bifrost-update.json' ]"
"$WINE" reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bifrost' /v DisplayVersion > "$WORK/reg3.log" 2>&1 || true
check "…and Settings > Apps shows the new version" "grep -q '9.9.9' '$WORK/reg3.log'"
"$WINE" "$SETUP/Installers/Bifrost-Setup-$VERSION-x64.exe" /S /wait '/D=C:\Bifrost Test' > /dev/null 2>&1 && code=0 || code=$?
check "an installer with /wait (an update to a newer Electron) installs over it (exit code $code)" "[ $code -eq 0 ] && grep -q '\"version\": \"$VERSION\"' '$I/resources/app/package.json'"

"$WINE" "C:\\Bifrost Test\\$UN" /S > /dev/null 2>&1 || true
for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "$DRIVE_C/Bifrost Test/Bifrost.exe" ] || break; sleep 1; done
check "the uninstaller removes it" "[ ! -f '$DRIVE_C/Bifrost Test/Bifrost.exe' ]"

# The launcher starts the build for this PC (Wine reports x64) with the arguments it was given: swap in a
# tiny program that writes down how it was started.
cat > "$WORK/probe.c" <<'EOF'
#include <windows.h>
#include <stdio.h>
int wmain(int argc, wchar_t **argv) {
  wchar_t path[MAX_PATH]; GetModuleFileNameW(NULL, path, MAX_PATH);
  FILE *f = _wfopen(L"launched.txt", L"w, ccs=UTF-8");
  if (!f) return 1;
  fwprintf(f, L"%ls\n", path);
  for (int i = 1; i < argc; i++) fwprintf(f, L"%ls\n", argv[i]);
  fclose(f);
  return 0;
}
EOF
/opt/llvm-mingw/bin/x86_64-w64-mingw32-clang -municode -O1 -o "$WORK/probe.exe" "$WORK/probe.c" 2> "$WORK/probe.err"
cp "$P/App/Bifrost-x64/Bifrost.exe" "$WORK/Bifrost.exe.real"
cp "$WORK/probe.exe" "$P/App/Bifrost-x64/Bifrost.exe"
(cd "$P" && "$WINE" BifrostPortable.exe "https://example.com/a b" > /dev/null 2>&1) || true
for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "$P/App/Bifrost-x64/launched.txt" ] && break; sleep 1; done
check "BifrostPortable.exe starts the x64 build" "grep -qi 'Bifrost-x64' '$P/App/Bifrost-x64/launched.txt' 2>/dev/null"
check "…passing on the address it was opened with" "grep -q 'https://example.com/a b' '$P/App/Bifrost-x64/launched.txt' 2>/dev/null"
rm -f "$P/App/Bifrost-x64/launched.txt"

# 6b. BifrostPortable.exe puts in downloaded updates before it starts Bifrost: Bifrost's own files for the x64
# build, a whole new ARM64 build. (With --bifrost-apply-update, from "Restart to update", it waits for
# Bifrost to quit first, and doesn't pass the flag on.)
X="$P/App/Bifrost-x64"; ARM="$P/App/Bifrost-arm64"
mkdir -p "$X/resources/app.next" && cp -r "$X/resources/app/." "$X/resources/app.next/"
sed -i "s/\"version\": \"$VERSION\"/\"version\": \"9.9.9\"/" "$X/resources/app.next/package.json"
echo '{"version":"9.9.9","kind":"app"}' > "$X/resources/app.next/bifrost-update.json"
mkdir -p "$ARM.next" && cp -r "$ARM/." "$ARM.next/" && echo new > "$ARM.next/new-build.txt"
echo '{"version":"9.9.9","kind":"full"}' > "$ARM.next/bifrost-update.json"
(cd "$P" && "$WINE" BifrostPortable.exe --bifrost-apply-update "https://example.com/after" > /dev/null 2>&1) || true
for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "$X/launched.txt" ] && break; sleep 1; done
check "BifrostPortable.exe puts in an update of Bifrost's own files" "grep -q '\"version\": \"9.9.9\"' '$X/resources/app/package.json' && [ ! -e '$X/resources/app.next' ] && [ ! -e '$X/resources/app.old' ]"
check "…and a whole new build" "[ -f '$ARM/new-build.txt' ] && [ ! -e '$ARM.next' ] && [ ! -e '$ARM.old' ] && [ ! -e '$ARM/bifrost-update.json' ]"
check "…then starts Bifrost, without the update flag" "grep -q 'https://example.com/after' '$X/launched.txt' 2>/dev/null && ! grep -q 'bifrost-apply-update' '$X/launched.txt' 2>/dev/null"
rm -f "$ARM/new-build.txt" "$X/launched.txt"
sed -i "s/\"version\": \"9.9.9\"/\"version\": \"$VERSION\"/" "$X/resources/app/package.json"
cp "$WORK/Bifrost.exe.real" "$X/Bifrost.exe"

# 5. Running the setup again keeps the Data folder.
mkdir -p "$P/Data/profile" && echo keep > "$P/Data/profile/marker.txt"
run_setup || true
check "running the setup again keeps BifrostPortable's Data folder" "[ -f '$P/Data/profile/marker.txt' ]"

# 7. The release, as the release workflow makes it (not signed here).
node "$ROOT/tools/release.mjs" --out="$WORK/release" --cache="$CACHE" > "$WORK/release.log" 2>&1 && code=0 || code=$?
check "tools/release.mjs builds the release (exit code $code)" "[ $code -eq 0 ]"
R="$WORK/release"
check "…installers for both, the portable zip, the update of Bifrost's own files, latest.json and checksums" "[ -f '$R/Bifrost-Setup-$VERSION-x64.exe' ] && [ -f '$R/Bifrost-Setup-$VERSION-arm64.exe' ] && [ -f '$R/BifrostPortable-$VERSION.zip' ] && [ -f '$R/Bifrost-$VERSION-app.zip' ] && [ -f '$R/latest.json' ] && [ -f '$R/SHA256SUMS.txt' ]"
check "…latest.json names this version, its Electron, and every file with its checksum" "node -e \"const fs=require('fs'),c=require('crypto');const l=JSON.parse(fs.readFileSync('$R/latest.json','utf8'));const fl=[l.app,l.portable,l['win-x64'].setup,l['win-arm64'].setup];process.exit(l.version==='$VERSION'&&l.runtime==='$ELECTRON'&&fl.every(f=>c.createHash('sha256').update(fs.readFileSync('$R/'+f.file)).digest('hex')===f.sha256)?0:1)\""
check "…(cd $R && sha256sum -c SHA256SUMS.txt)" "(cd '$R' && sha256sum -c --quiet SHA256SUMS.txt)"
"$WINE" "$R/Bifrost-Setup-$VERSION-x64.exe" /S '/D=C:\Bifrost Release' > /dev/null 2>&1 && code=0 || code=$?
check "…its x64 installer installs Bifrost $VERSION (exit code $code)" "[ $code -eq 0 ] && [ -f '$DRIVE_C/Bifrost Release/Bifrost.exe' ] && grep -q '\"version\": \"$VERSION\"' '$DRIVE_C/Bifrost Release/resources/app/package.json' && [ ! -e '$DRIVE_C/Bifrost Release/electron.exe.sig' ]"
check "…with Electron's own fuses in Bifrost.exe (castlabs signs only an unchanged binary for Widevine)" "python3 -I '$ROOT/tests/setup/same-fuses.py' '$DRIVE_C/Bifrost Release/Bifrost.exe' '$CACHE/electron-v$ELECTRON-win32-x64.zip' > /dev/null"

echo
echo "setup: $pass/$((pass+fail)) passed"
[ $fail -eq 0 ]
