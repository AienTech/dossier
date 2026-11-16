#!/bin/bash
# Build a local companion. No daemon, storage service or OpenBot token is installed here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:-$HOME/Applications/HireMe Bot Helper.app}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/HireMe Bot Helper.app"
mkdir -p "$APP/Contents/MacOS" "$(dirname "$DEST")"
xcrun swiftc -O -target "$(uname -m)-apple-macosx13.0" -framework Cocoa -framework ApplicationServices \
  "$ROOT/scripts/macos/bot-helper/HireMeBotHelper.swift" -o "$APP/Contents/MacOS/HireMeBotHelper"
"$APP/Contents/MacOS/HireMeBotHelper" --self-test
cp "$ROOT/scripts/macos/bot-helper/Info.plist" "$APP/Contents/Info.plist"
# Sign with a stable identity when one exists: an ad-hoc signature changes its
# designated requirement on every build, which makes macOS drop the user's
# Accessibility grant each time the helper is reinstalled.
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:.*\)"$/\1/p' | head -1)"
if [[ -n "$IDENTITY" ]]; then
  codesign --force --sign "$IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
# Stop the previous background helper so the next link uses this version.
# It holds no drafts or application data; both bots remain running.
pkill -x HireMeBotHelper 2>/dev/null || true
# ditto updates only this app bundle; it never touches either bot or its data.
ditto "$APP" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
printf 'Installed %s\n' "$DEST"
