#!/usr/bin/env bash
# Build the Windows installer and the release zip (cross-compiles from Linux or macOS).
#
#   scripts/build-windows.sh            -> dist/HermiteCut-v<version>-windows.zip
#
# Needs: Go 1.22+, zip, python3 (only to read the version from plugin/package.json).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json;print(json.load(open('plugin/package.json'))['version'])")"
NAME="HermiteCut"
PLUGIN_ID="com.hermitelabs.cut"
STAGE="dist/$NAME"

rm -rf installer/payload dist
mkdir -p installer/payload "$STAGE/plugin/$PLUGIN_ID"

# The installer embeds a copy of plugin/ (never Resolve's own WorkflowIntegration.node).
cp -R plugin/. installer/payload/
rm -f installer/payload/devtools.flag installer/payload/WorkflowIntegration.node

( cd installer && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w" -o "../$STAGE/Install $NAME.exe" . )

cp -R installer/payload/. "$STAGE/plugin/$PLUGIN_ID/"
cp installer/package/* "$STAGE/"
cp LICENSE "$STAGE/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$STAGE/THIRD_PARTY_NOTICES.txt"

( cd dist && zip -qr "$NAME-v$VERSION-windows.zip" "$NAME" )
echo "Built dist/$NAME-v$VERSION-windows.zip"
