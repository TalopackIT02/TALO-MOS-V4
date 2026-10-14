import { runDbSmoke } from './dbSmoke.js';

// CLI: npm run smoke:db
// Exit codes: 0 = PASS, 2 = NOT_READY (database/role not created yet), 1 = FAIL.
// Reads DATABASE_URL from the environment only; the password is never printed.

const report = await runDbSmoke(process.env['DATABASE_URL']);
process.stdout.write(`AUTH-DB-F2 runtime smoke test — target ${report.target}\n`);
for (const check of report.checks) {
  process.stdout.write(`  ${check.status.padEnd(4)} ${check.name}${check.detail ? ` (${check.detail})` : ''}\n`);
}
process.stdout.write(`RESULT: ${report.status}${report.reason ? ` — ${report.reason}` : ''}\n`);
process.exitCode = report.status === 'PASS' ? 0 : report.status === 'NOT_READY' ? 2 : 1;
