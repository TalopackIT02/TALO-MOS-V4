@echo off
setlocal
cd /d "%~dp0"
echo [TALO-MOS-V4] Development launcher
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js LTS first.
  pause
  exit /b 1
)
call :check frontend
if errorlevel 1 goto :not_ready
call :check backend
if errorlevel 1 goto :not_ready
echo Starting frontend and backend in separate windows...
start "TALO-MOS-V4 Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"
start "TALO-MOS-V4 Backend" cmd /k "cd /d ""%~dp0backend"" && npm run dev"
exit /b 0
:check
if not exist "%~dp0%~1\package.json" (
  echo ERROR: %~1/package.json missing.
  exit /b 1
)
node -e "const p=require('./%~1/package.json');process.exit(p.scripts&&p.scripts.dev?0:1)"
if errorlevel 1 (
  echo NOT READY: %~1/package.json has no scripts.dev.
  exit /b 1
)
if not exist "%~dp0%~1\node_modules" (
  echo NOT READY: %~1/node_modules missing. Install dependencies after app scaffold.
  exit /b 1
)
exit /b 0
:not_ready
echo WebApp is not scaffolded yet. No services were started.
pause
exit /b 1
