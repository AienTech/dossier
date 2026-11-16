#!/bin/bash
# Builds one HireMe.app (a window around the local site) and a DMG.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(/opt/homebrew/opt/node@24/bin/node -p "require('$ROOT/package.json').version")"
STAGE="$(mktemp -d)"
APP="$STAGE/HireMe.app"
DMG="${1:-$HOME/Desktop/HireMe.dmg}"
ICON_SRC="$ROOT/src/app/apple-icon.png"

ICONSET="$STAGE/AppIcon.iconset"
mkdir -p "$ICONSET" "$APP/Contents/MacOS" "$APP/Contents/Resources"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

sed "s/VERSION_PLACEHOLDER/$VERSION/g" "$ROOT/scripts/macos/Info.plist" >"$APP/Contents/Info.plist"
cp "$ROOT/scripts/macos/launcher.sh" "$APP/Contents/MacOS/launcher"
chmod +x "$APP/Contents/MacOS/launcher"
printf 'APPL????' >"$APP/Contents/PkgInfo"

xcrun swiftc -parse-as-library -O -target arm64-apple-macosx13.0 \
  -framework Cocoa -framework WebKit \
  -o "$APP/Contents/MacOS/HireMe" \
  "$ROOT/scripts/macos/HireMeApp.swift"

codesign --force --deep --sign - "$APP"

ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "HireMe" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "$DMG"

ditto "$APP" "$STAGE/../installed-HireMe.app" 2>/dev/null || true
cp -R "$APP" /tmp/HireMe.app
rm -rf "$STAGE"
