@echo off
set "PLUGINS=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins"
set "DST=%PLUGINS%\com.hermitelabs.cut"
set "LEGACY=%PLUGINS%\com.gaffystudios.editkit.resolve"
if exist "%LEGACY%" rmdir /S /Q "%LEGACY%"
if exist "%DST%" (
  rmdir /S /Q "%DST%"
  echo HermiteCut removed. Restart DaVinci Resolve.
) else (
  echo HermiteCut is not installed.
)
pause
