@echo off
setlocal EnableExtensions
set "TALO_ROOT=%~dp0"
if not exist "%TALO_ROOT%tools\dev-control\ControlCenter.ps1" (
  echo ERROR: tools\dev-control\ControlCenter.ps1 not found.
  echo Copy the entire package into the TALO-MOS-V4 repository root.
  pause
  exit /b 1
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows PowerShell 5.1 is required.
  pause
  exit /b 1
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%TALO_ROOT%tools\dev-control\ControlCenter.ps1"
if errorlevel 1 (
  echo TALO Control Center could not start. See the error above.
  pause
  exit /b 1
)
endlocal
