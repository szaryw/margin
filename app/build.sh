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
  # A broken Command Line Tools install breaks every Swift build with hundreds of lines of module errors. Say what's
  # wrong instead. Two files defining SwiftBridging is the usual root cause; the SDK/compiler mismatch message then
  # follows from it, so that case is checked first.
  if grep -q "redefinition of module 'SwiftBridging'" "$LOG"; then
    cat <<'MSG'
Couldn't build Margin: this Mac's Xcode Command Line Tools have two files that both define the
SwiftBridging module (a known glitch in some versions), so Swift can't build any app here.
Move the extra one aside (it's kept in your home folder) and build again:

  sudo mv /Library/Developer/CommandLineTools/usr/include/swift/module.modulemap ~/module.modulemap.bak
  sh app/build.sh

If it still fails, install the latest Command Line Tools: run softwareupdate --list, then
softwareupdate --install with the "Command Line Tools" label it shows.
MSG
    printf "\nFull compiler output: %s\n" "$LOG"
  elif grep -q "this SDK is not supported by the compiler" "$LOG"; then
    cat <<'MSG'
Couldn't build Margin: this Mac's Swift compiler and macOS SDK come from different Command Line Tools
updates. Install the latest Command Line Tools (run softwareupdate --list, then softwareupdate --install
with the "Command Line Tools" label it shows), or if you have Xcode:

  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
MSG
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
