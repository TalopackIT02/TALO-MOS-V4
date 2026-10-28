import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/infrastructure/prisma/client.js';
import { sqlstateOf } from '../src/modules/auth/sqlstate.js';

// SCC — PostgreSQL privilege probe (READ ONLY, EXPLAIN only, no data rows read or printed).
// Every SQL statement the SCC backend issues is planned through the runtime role (talo_app) in a READ ONLY transaction
// that is always rolled back. PostgreSQL checks table / column / function privileges while building the plan, so a
// missing grant shows up as SQLSTATE 42501 on exactly the statement that needs it (column grants included — a
// has_table_privilege() inventory reports false for column-only grants). Output: statement name → OK | SQLSTATE.
// Guard: refuses any target other than a talo_app session on talo_mos_v4_test.
//   SCC_PROBE_PACKAGE=<dir>  probe another copy of the package (default: modules/SYSTEM_CONTROLLER_CENTER).

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL missing');
const pkg = resolve(process.env['SCC_PROBE_PACKAGE'] ?? resolve(import.meta.dirname, '../../modules/SYSTEM_CONTROLLER_CENTER'));
const scc = resolve(pkg, 'backend');

// The SCC package has no node_modules of its own, so its SQL is read from the source text: every template literal bound
// to a name (NAME = `...` or key: `...`) that starts with SELECT and has no ${} interpolation. The only interpolated
// SQL is the Data Inspection page SELECT, built per table from pg_catalog identifiers (probed separately by its catalog).
const FILES: [string, string][] = [
  ['ADMIN_GATE', 'administrator-gate.ts'], ['DIAGNOSTICS', 'system-controller-center.repository.ts'],
  ['DATA_INSPECTION', 'data-inspector.sql.ts'], ['ARCHITECTURE_ACCESS_MATRIX', 'controller-overview.service.ts'],
  ['AUDIT_LOG', 'system-audit.service.ts'],
];
const TEMPLATE = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*`([^`]*)`/g;
const statements: [string, string, string][] = FILES.flatMap(([feature, file]) => {
  const text = readFileSync(resolve(scc, file), 'utf8');
  return [...text.matchAll(TEMPLATE)]
    .filter((m) => /^\s*SELECT\b/i.test(m[2] ?? '') && !(m[2] ?? '').includes('${'))
    .map((m) => [feature, m[1] ?? '', m[2] ?? ''] as [string, string, string]);
});

const maxParam = (sql: string) => Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
const db = createPrismaClient(url);
const results: { feature: string; name: string; result: string; detail?: string }[] = [];
try {
  const [identity] = await db.$queryRawUnsafe<{ db: string; usr: string; sess: string }[]>('SELECT current_database() db, current_user usr, session_user sess');
  if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app' || identity.sess !== 'talo_app') throw new Error('guard: probe requires talo_app on talo_mos_v4_test');
  for (const [feature, name, sql] of statements) {
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$queryRawUnsafe(`EXPLAIN ${sql}`, ...Array.from({ length: maxParam(sql) }, () => null));
        throw new Error('ROLLBACK_SENTINEL');
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'ROLLBACK_SENTINEL') { results.push({ feature, name, result: 'OK' }); continue; }
      const code = sqlstateOf(error) ?? 'ERROR';
      const text = error instanceof Error ? error.message : '';
      const detail = /(permission denied for [a-z ]+ [A-Za-z0-9_."]+|(?:schema|function|relation) "?[^" ]+"? does not exist)/.exec(text)?.[1];
      results.push({ feature, name, result: code, ...(detail ? { detail } : {}) });
    }
  }
  process.stdout.write(`${JSON.stringify({ identity, package: pkg.replace(/\\/g, '/').split('/').slice(-2).join('/'), statements: results.length, results }, null, 2)}\n`);
} finally {
  await db.$disconnect();
}
