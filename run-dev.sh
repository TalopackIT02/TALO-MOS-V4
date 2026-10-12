#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '[TALO-MOS-V4] Development launcher'
command -v npm >/dev/null || { echo 'ERROR: npm not found. Install Node.js LTS first.'; exit 1; }
for app in frontend backend; do
  if [ ! -f "$app/package.json" ]; then echo "NOT READY: $app/package.json missing"; exit 1; fi
  if ! node -e 'const p=require("./"+process.argv[1]+"/package.json");process.exit(p.scripts&&p.scripts.dev?0:1)' "$app"; then
    echo "NOT READY: $app/package.json has no scripts.dev"; exit 1
  fi
  if [ ! -d "$app/node_modules" ]; then echo "NOT READY: $app/node_modules missing"; exit 1; fi
done
(cd frontend && npm run dev) &
front_pid=$!
(cd backend && npm run dev) &
back_pid=$!
trap 'kill "$front_pid" "$back_pid" 2>/dev/null || true' EXIT INT TERM
wait
