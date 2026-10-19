TALO DEV CONTROL CENTER - Windows local development utility
===========================================================

INSTALL (NO INSTALLER / NO ELECTRON)

1. Copy TALO-Control.cmd and the entire tools\dev-control\ folder into:
   D:\Documents\ClaudeProject\TALO-MOS-V4\
   The copy must be at the repository root containing docker-compose.yml,
   backend\ and frontend\.
2. Keep your existing run-dev.cmd, Compose, .env, Node and database untouched.
3. Ensure Windows PowerShell 5.1, Node.js (npm), Docker Desktop and project
   backend/frontend node_modules are installed.
4. Open Docker Desktop manually if Docker Engine is not available.
5. Double-click TALO-Control.cmd.

CONTROLS

START ALL       Starts project postgres, awaits healthy, starts backend then frontend.
STOP ALL        Stops verified TALO development process trees; stops only postgres.
RESTART WEB     Restarts backend/frontend only; postgres must be healthy.
RESET ALL       Confirmation; clean process restart plus postgres stop/up.
                NO Docker down -v; NO volumes deleted; NO migrations/provisioning.
OPEN WEB        Opens http://127.0.0.1:5173.

Dashboard verifies backend GET /api/health with HTTP 200, Vite / with HTTP 200,
and confirms Windows listener PID ownership before displaying RUNNING.
Postgres RUNNING means container healthcheck returned healthy.
CPU/RAM/Uptime are obtained from host process or docker stats and can display
— if not available. Module status is UNAVAILABLE until a suitable existing
runtime API is confirmed; this tool does not add/alter API endpoints.

Logs/state: %LOCALAPPDATA%\TALO-MOS-V4\dev-control\
Service processes continue running after closing the Control Center window.
Monitoring is asynchronous; an outdated snapshot is marked STALE.

IMPORTANT LIMITATIONS

- This package is a Windows Forms PowerShell application (no EXE build needed).
- The backend/front process ownership heuristic recognizes runners started by
  this Control Center and legacy run-dev.cmd trees with verified project paths.
  It intentionally refuses to kill unknown processes even if on port 3000/5173.
- Output logs are sanitized for known .env secrets, common credential fields,
  and PostgreSQL URLs; do not output novel/unstructured secrets from custom
  scripts if you want them hidden from local development logs.
- Runtime tests require Windows + Docker Desktop + installed project deps.
  The development environment used to package this tool is Linux, so those
  integration tests were NOT performed.

SOURCE FILES

TALO-Control.cmd
  CMD launcher

tools\dev-control\ControlCenter.ps1
  Windows Forms dashboard; helper-process entrypoint

tools\dev-control\Runtime.ps1
  status probes, process ownership, orchestration, resource sampling, logs
