#!/usr/bin/env bash
# Build the panel-only Windows installer and its release zip from Linux or macOS.
#
#   scripts/build-windows.sh   -> dist/HermiteCut-v<version>-windows-panel.zip
#
# Cross-compiles crates/hc-installer for Windows. Needs Rust with the
# x86_64-pc-windows-gnu target and the MinGW linker:
#   rustup target add x86_64-pc-windows-gnu
#   sudo apt-get install gcc-mingw-w64-x86-64     (or: brew install mingw-w64)
# plus zip and python3. The release workflow builds it on Windows instead
# (scripts/build-windows.ps1).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json;print(json.load(open('app/package.json'))['version'])")"
NAME="HermiteCut"
PLUGIN_ID="com.hermitelabs.cut"
STAGE="dist/$NAME"
PANEL="build/plugin/$PLUGIN_ID"
TARGET="x86_64-pc-windows-gnu"

test -f "$PANEL/main.js" || python3 scripts/assemble.py
rm -rf "$STAGE" "dist/$NAME-v$VERSION-windows-panel.zip"
mkdir -p "$STAGE/plugin"

HC_PAYLOAD_DIR="$(cd "$PANEL" && pwd)" cargo build --release --locked -p hc-installer --target "$TARGET"

cp "target/$TARGET/release/hermitecut-installer.exe" "$STAGE/Install $NAME.exe"
cp -R "$PANEL" "$STAGE/plugin/$PLUGIN_ID"
rm -f "$STAGE/plugin/$PLUGIN_ID/devtools.flag" "$STAGE/plugin/$PLUGIN_ID/WorkflowIntegration.node"
cp packaging/windows-panel/* "$STAGE/"
cp LICENSE "$STAGE/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$STAGE/THIRD_PARTY_NOTICES.txt"

( cd dist && zip -qr "$NAME-v$VERSION-windows-panel.zip" "$NAME" )
echo "Built dist/$NAME-v$VERSION-windows-panel.zip"
