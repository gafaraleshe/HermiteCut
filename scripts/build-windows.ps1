# Build the panel-only Windows installer and its release zip, on Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
#   -> dist/HermiteCut-v<version>-windows-panel.zip
#
# Needs Rust (https://rustup.rs) and Python 3 (to assemble the panel if it
# isn't already). The installer (crates/hc-installer) embeds the assembled
# panel; Resolve's own WorkflowIntegration.node is never included.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$version  = (Get-Content app/package.json -Raw | ConvertFrom-Json).version
$name     = 'HermiteCut'
$pluginId = 'com.hermitelabs.cut'
$stage    = "dist/$name"
$panel    = "build/plugin/$pluginId"

if (-not (Test-Path "$panel/main.js")) { python scripts/assemble.py }
Remove-Item -Recurse -Force $stage, "dist/$name-v$version-windows-panel.zip" -ErrorAction SilentlyContinue

$env:HC_PAYLOAD_DIR = (Resolve-Path $panel).Path
cargo build --release --locked -p hc-installer
if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }

New-Item -ItemType Directory -Force "$stage/plugin" | Out-Null
Copy-Item target/release/hermitecut-installer.exe "$stage/Install $name.exe"
Copy-Item $panel "$stage/plugin/$pluginId" -Recurse
Remove-Item "$stage/plugin/$pluginId/devtools.flag", "$stage/plugin/$pluginId/WorkflowIntegration.node" -ErrorAction SilentlyContinue
Copy-Item packaging/windows-panel/* $stage
Copy-Item LICENSE "$stage/LICENSE.txt"
Copy-Item THIRD_PARTY_NOTICES.md "$stage/THIRD_PARTY_NOTICES.txt"

Compress-Archive -Path $stage -DestinationPath "dist/$name-v$version-windows-panel.zip" -Force
Write-Host "Built dist/$name-v$version-windows-panel.zip"
