// Writes mic/module.mic.json (what the Package Scanner / Installer read, as data) from mic/crm.mic.ts.
// Usage (from backend/): npx tsx ../modules/CRM/scripts/export-mic.mts [--check]  — --check fails when the JSON is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRM_MIC } from '../mic/crm.mic.ts';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'mic', 'module.mic.json');
const json = `${JSON.stringify(CRM_MIC, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* missing = stale */ }
  if (current !== json) { console.error('mic/module.mic.json is stale: run export-mic.mts'); process.exit(1); }
  console.log('mic/module.mic.json up to date');
} else {
  writeFileSync(target, json, 'utf8');
  console.log(`wrote ${target}`);
}
