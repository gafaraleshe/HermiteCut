@echo off
setlocal
title HermiteCut - installer
set "SRC=%~dp0plugin\com.hermitelabs.cut"
set "ROOT=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support"
set "PLUGINS=%ROOT%\Workflow Integration Plugins"
set "DST=%PLUGINS%\com.hermitelabs.cut"
set "LEGACY=%PLUGINS%\com.gaffystudios.editkit.resolve"
set "NODE=%ROOT%\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node"
echo.
echo   HermiteCut - installer
echo   ----------------------
if not exist "%SRC%\manifest.xml" (
  echo   Could not find the plugin folder next to this file. Extract the whole folder first.
  pause & exit /b 1
)
if not exist "%NODE%" (
  echo   Could not find WorkflowIntegration.node from DaVinci Resolve Studio:
  echo   %NODE%
  echo   Workflow Integration plugins need DaVinci Resolve STUDIO 19 or newer.
  pause & exit /b 1
)
if exist "%LEGACY%" rmdir /S /Q "%LEGACY%"
robocopy "%SRC%" "%DST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo   Copy failed. Right-click this file and choose "Run as administrator".
  pause & exit /b 1
)
copy /Y "%NODE%" "%DST%\WorkflowIntegration.node" >nul
echo   Installed to:
echo   %DST%
echo.
echo   Restart DaVinci Resolve, then open:
echo   Workspace ^> Workflow Integrations ^> HermiteCut
echo.
pause
