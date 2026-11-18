#!/usr/bin/env bash
# Build the Windows installer and the release zip (cross-compiles from Linux or macOS).
#
#   scripts/build-windows.sh            -> dist/HermiteCut-v<version>-windows-panel.zip
#
# The panel-only installer (no app). Run scripts/assemble.py first.
#
# Needs: Go 1.22+, zip, python3 (to read the version from app/package.json).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json;print(json.load(open('app/package.json'))['version'])")"
NAME="HermiteCut"
PLUGIN_ID="com.hermitelabs.cut"
STAGE="dist/$NAME"

test -f build/plugin/$PLUGIN_ID/main.js || python3 scripts/assemble.py
rm -rf installer/payload dist/$NAME
mkdir -p installer/payload "$STAGE/plugin/$PLUGIN_ID"

# The installer embeds the assembled panel (never Resolve's own WorkflowIntegration.node).
cp -R build/plugin/$PLUGIN_ID/. installer/payload/
rm -f installer/payload/devtools.flag installer/payload/WorkflowIntegration.node

( cd installer && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w" -o "../$STAGE/Install $NAME.exe" . )

cp -R installer/payload/. "$STAGE/plugin/$PLUGIN_ID/"
cp installer/package/* "$STAGE/"
cp LICENSE "$STAGE/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$STAGE/THIRD_PARTY_NOTICES.txt"

( cd dist && zip -qr "$NAME-v$VERSION-windows-panel.zip" "$NAME" )
echo "Built dist/$NAME-v$VERSION-windows-panel.zip"
