# Read-only / no DB connection; PowerShell 7+ or Windows PowerShell 5.1.
# Run from repository root: powershell -ExecutionPolicy Bypass -File AUTH-CONTEXT/03-FAST-CHECK.ps1
# Optional: -WithTests runs backend unit/HTTP suite (not DB integration if correctly guarded by existing repo).
param([switch]$WithTests)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
  Write-Host '=== Git snapshot (read only) ==='
  git rev-parse --short HEAD
  git status --short
  Write-Host '=== Backend typecheck ==='
  Push-Location (Join-Path $root 'backend')
  try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Backend typecheck failed' }
    if ($WithTests) {
      npm test
      if ($LASTEXITCODE -ne 0) { throw 'Backend unit tests failed' }
    }
  } finally { Pop-Location }
  Write-Host '=== Frontend typecheck ==='
  Push-Location (Join-Path $root 'frontend')
  try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Frontend typecheck failed' }
  } finally { Pop-Location }
  Write-Host '=== DONE (no DB or browser tests executed) ==='
} finally { Pop-Location }
