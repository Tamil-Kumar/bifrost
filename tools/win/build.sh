#!/bin/sh
# Builds Bifrost's small Windows programs with llvm-mingw (https://github.com/mstorsjo/llvm-mingw):
#   BifrostPortable.exe        (x86, runs on x64 and ARM64) picks the right build in a dual portable folder
#   installer-x64.exe, installer-arm64.exe
#                              the installer/uninstaller stub; tools/assemble.cjs appends the payload
#   assets/bin/touchpad-x64.exe, touchpad-arm64.exe
#                              how many fingers are on the touchpad, for swipes (src/main/touchpad.js)
# Output goes to tools/win/bin, which is checked in so packaging doesn't need a C compiler.
#   sh tools/win/build.sh [path to llvm-mingw] [path to miniz 3.x folder]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
LLVM=${1:-/opt/llvm-mingw}
MINIZ=${2:-$HERE/miniz}
VERSION=$(node -p "require('$ROOT/package.json').version")
V1=$(echo "$VERSION" | cut -d. -f1); V2=$(echo "$VERSION" | cut -d. -f2); V3=$(echo "$VERSION" | cut -d. -f3)
OUT="$HERE/bin"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
cp "$ROOT/assets/icons/icon.ico" "$HERE/app.manifest" "$WORK/"
rc() { # name description
  sed -e "s/@ICON@/icon.ico/" -e "s/@VERSION@/$VERSION/g" -e "s/@V1@/$V1/g" -e "s/@V2@/$V2/g" -e "s/@V3@/$V3/g" -e "s/@NAME@/$1/g" -e "s/@DESC@/$2/g" "$HERE/res.rc.in" > "$WORK/$1.rc"
}
CFLAGS="-Os -municode -mwindows -Wall -Wno-unused-function -Wno-missing-braces -ffunction-sections -fdata-sections"
LDFLAGS="-s -Wl,--gc-sections -Wl,--stack,4194304 -static"

rc BifrostPortable "Bifrost (portable)"
"$LLVM/bin/i686-w64-mingw32-windres" -I"$WORK" "$WORK/BifrostPortable.rc" -O coff -o "$WORK/launcher-res.o"
"$LLVM/bin/i686-w64-mingw32-clang" $CFLAGS "$HERE/launcher.c" "$WORK/launcher-res.o" $LDFLAGS -o "$OUT/BifrostPortable.exe"

MZ="-DMINIZ_NO_STDIO -DMINIZ_NO_TIME -DMINIZ_NO_ARCHIVE_WRITING_APIS -DMINIZ_NO_ZLIB_COMPATIBLE_NAMES -I$MINIZ"
for arch in x64 arm64; do
  case $arch in x64) T=x86_64;; arm64) T=aarch64;; esac
  rc "Bifrost-Setup" "Bifrost Setup"
  "$LLVM/bin/$T-w64-mingw32-windres" -I"$WORK" "$WORK/Bifrost-Setup.rc" -O coff -o "$WORK/setup-$arch.o"
  "$LLVM/bin/$T-w64-mingw32-clang" $CFLAGS $MZ "$HERE/installer.c" "$MINIZ/miniz.c" "$WORK/setup-$arch.o" $LDFLAGS \
    -lole32 -lshell32 -luuid -lcomctl32 -ladvapi32 -lshlwapi -o "$OUT/installer-$arch.exe"
done

# The touchpad watcher (src/main/touchpad.js runs it): with the app's files, so updates bring it too. It says
# what it is in its properties (Task Manager shows that), without the icon, which would be most of its size.
mkdir -p "$ROOT/assets/bin"
rc Bifrost-Touchpad "Bifrost touchpad helper"
sed -i '/ ICON /d' "$WORK/Bifrost-Touchpad.rc"
for arch in x64 arm64; do
  case $arch in x64) T=x86_64;; arm64) T=aarch64;; esac
  "$LLVM/bin/$T-w64-mingw32-windres" -I"$WORK" "$WORK/Bifrost-Touchpad.rc" -O coff -o "$WORK/touchpad-$arch.o"
  "$LLVM/bin/$T-w64-mingw32-clang" $CFLAGS "$HERE/touchpad.c" "$WORK/touchpad-$arch.o" $LDFLAGS -lhid -o "$ROOT/assets/bin/touchpad-$arch.exe"
done
ls -l "$OUT" "$ROOT/assets/bin"
