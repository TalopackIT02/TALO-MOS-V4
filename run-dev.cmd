
@echo off
setlocal EnableExtensions
set "TALO_ROOT=%~dp0"
cd /d "%TALO_ROOT%"

echo ==================================================
echo       TALO-MOS-V4 - CLEAN RESTART
echo ==================================================
echo.

REM ---- 1. Check requirements ----
where node >nul 2>&1
if errorlevel 1 goto :node_missing

where npm >nul 2>&1
if errorlevel 1 goto :npm_missing

where docker >nul 2>&1
if errorlevel 1 goto :docker_missing

if not exist "%TALO_ROOT%docker-compose.yml" (
    echo ERROR: docker-compose.yml not found.
    goto :failed
)

call :check backend
if errorlevel 1 goto :failed

call :check frontend
if errorlevel 1 goto :failed

docker info >nul 2>&1
if errorlevel 1 goto :docker_not_running

docker compose version >nul 2>&1
if errorlevel 1 goto :compose_missing

docker compose -f "%TALO_ROOT%docker-compose.yml" config --quiet
if errorlevel 1 goto :docker_failed

REM ---- 2. Stop old development windows ----
echo [1/5] Closing old TALO development windows...

taskkill /F /T /FI "WINDOWTITLE eq TALO-MOS-V4 Frontend" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq TALO-MOS-V4 Backend" >nul 2>&1

REM ---- 3. Stop leftover project Node processes ----
echo [2/5] Cleaning leftover dev and test processes...

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$r = $env:TALO_ROOT; Get-CimInstance Win32_Process | Where-Object { ($_.Name -in @('node.exe','nodew.exe')) -and $null -ne $_.CommandLine -and $_.CommandLine.IndexOf($r, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null }"

if errorlevel 1 (
    echo WARNING: Some Node processes could not be checked.
)

timeout /t 2 /nobreak >nul

REM ---- 4. Restart Docker PostgreSQL ----
echo [3/5] Stopping TALO Docker Compose services...

docker compose -f "%TALO_ROOT%docker-compose.yml" down --timeout 20
if errorlevel 1 goto :docker_failed

echo [4/5] Starting PostgreSQL and waiting for health...

docker compose -f "%TALO_ROOT%docker-compose.yml" up -d --wait postgres
if errorlevel 1 goto :docker_failed

echo Docker PostgreSQL is ready.

REM ---- 5. Restart backend and frontend ----
echo [5/5] Starting Backend and Frontend...

start "TALO-MOS-V4 Backend" cmd /k "cd /d ""%TALO_ROOT%backend"" && npm run dev"

timeout /t 3 /nobreak >nul

start "TALO-MOS-V4 Frontend" cmd /k "cd /d ""%TALO_ROOT%frontend"" && npm run dev"

echo.
echo ==================================================
echo TALO-MOS-V4 startup commands launched.
echo Backend : http://127.0.0.1:3000
echo Frontend: http://127.0.0.1:5173
echo ==================================================
echo.
echo Wait for both terminals to report readiness.
echo Refresh the browser after startup.
exit /b 0

REM ---- Validation ----
:check
if not exist "%TALO_ROOT%%~1\package.json" (
    echo ERROR: %~1/package.json missing.
    exit /b 1
)

node -e "const p=require('./%~1/package.json');process.exit(p.scripts&&p.scripts.dev?0:1)"
if errorlevel 1 (
    echo ERROR: %~1 has no dev script.
    exit /b 1
)

if not exist "%TALO_ROOT%%~1\node_modules" (
    echo ERROR: %~1/node_modules missing.
    exit /b 1
)
exit /b 0

:node_missing
echo ERROR: Node.js not found.
goto :failed

:npm_missing
echo ERROR: npm not found.
goto :failed

:docker_missing
echo ERROR: Docker CLI not found.
goto :failed

:docker_not_running
echo ERROR: Docker Desktop engine is not running.
echo Please start Docker Desktop and retry.
goto :failed

:compose_missing
echo ERROR: Docker Compose V2 not available.
goto :failed

:docker_failed
echo ERROR: Docker Compose operation failed.
echo Check Docker Desktop and project .env settings.
goto :failed

:failed
echo.
echo Startup stopped. See error above.
pause
exit /b 1
