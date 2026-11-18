# Build the Windows installer and the release zip on Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
#
# Needs Go 1.22+ on PATH (https://go.dev/dl/).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$version  = (Get-Content plugin/package.json -Raw | ConvertFrom-Json).version
$name     = 'HermiteCut'
$pluginId = 'com.hermitelabs.cut'
$stage    = "dist/$name"

Remove-Item -Recurse -Force installer/payload, dist -ErrorAction SilentlyContinue
Copy-Item plugin installer/payload -Recurse
Remove-Item installer/payload/devtools.flag, installer/payload/WorkflowIntegration.node -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force "$stage/plugin" | Out-Null
Push-Location installer
$env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
go build -trimpath -ldflags "-s -w" -o "../$stage/Install $name.exe" .
if ($LASTEXITCODE -ne 0) { throw 'go build failed' }
Pop-Location

Copy-Item installer/payload "$stage/plugin/$pluginId" -Recurse
Copy-Item installer/package/* $stage
Copy-Item LICENSE "$stage/LICENSE.txt"
Copy-Item THIRD_PARTY_NOTICES.md "$stage/THIRD_PARTY_NOTICES.txt"

Compress-Archive -Path $stage -DestinationPath "dist/$name-v$version-windows.zip" -Force
Write-Host "Built dist/$name-v$version-windows.zip"
