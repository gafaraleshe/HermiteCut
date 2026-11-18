@echo off
rem Copy plugin\ straight into DaVinci Resolve's plugin folder for quick testing.
rem Run from an elevated (administrator) prompt, then restart Resolve.
setlocal
set "SRC=%~dp0..\plugin"
set "ROOT=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support"
set "PLUGINS=%ROOT%\Workflow Integration Plugins"
set "DST=%PLUGINS%\com.hermitelabs.cut"
set "NODE=%ROOT%\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node"
if exist "%PLUGINS%\com.gaffystudios.editkit.resolve" rmdir /S /Q "%PLUGINS%\com.gaffystudios.editkit.resolve"
robocopy "%SRC%" "%DST%" /MIR /XF WorkflowIntegration.node /NFL /NDL /NJH /NJS /NP
if errorlevel 8 exit /b 1
copy /Y "%NODE%" "%DST%\WorkflowIntegration.node" >nul
echo Installed to %DST%
echo Tip: create an empty file "%DST%\devtools.flag" to enable remote debugging on 127.0.0.1:9339.
