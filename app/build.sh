#!/bin/sh
# Builds app/build/Margin.app. The app starts the Node server from this repo, so it records where the repo and node are.
# macOS ties the Accessibility permission to the code signature: signed with a "Margin Local Signing" certificate (see
# README), the permission survives rebuilds; signed ad-hoc, it has to be granted again after each build.
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found: install Node.js 20 or later first (https://nodejs.org)"; exit 1; }
APP=build/Margin.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :MarginRoot string $ROOT" -c "Add :MarginNode string $NODE" "$APP/Contents/Info.plist"
command -v swiftc >/dev/null || { echo "swiftc not found: install the Xcode Command Line Tools first (xcode-select --install)"; exit 1; }
LOG="$(mktemp -t margin-build)"
if ! swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" Sources/*.swift -o "$APP/Contents/MacOS/Margin" >"$LOG" 2>&1; then
  # A half-updated Command Line Tools install (compiler and macOS SDK from different updates) breaks every Swift build
  # with hundreds of lines of module errors. Say what's wrong instead.
  if grep -q -e "this SDK is not supported by the compiler" -e "redefinition of module 'SwiftBridging'" "$LOG"; then
    cat <<'EOF'
Couldn't build Margin: this Mac's Xcode Command Line Tools are out of sync (the Swift compiler and the
macOS SDK come from different updates), so Swift can't build any app here. Reinstall them:

  sudo rm -rf /Library/Developer/CommandLineTools
  xcode-select --install

then run sh app/build.sh again. If you have Xcode installed, you can use its toolchain instead:

  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
EOF
    printf "\nFull compiler output: %s\n" "$LOG"
  else
    cat "$LOG"
  fi
  exit 1
fi
cat "$LOG"; rm -f "$LOG"
IDENTITY="Margin Local Signing"
if security find-certificate -c "$IDENTITY" >/dev/null 2>&1; then
  codesign --force --sign "$IDENTITY" --identifier dev.margin.app "$APP"
else
  echo "Signing ad-hoc (no \"$IDENTITY\" certificate): grant Accessibility again after each rebuild."
  codesign --force --sign - --identifier dev.margin.app "$APP"
fi
echo "Built app/$APP"
