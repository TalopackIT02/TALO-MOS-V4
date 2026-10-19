import type { RegressionSuite } from '../../src/installed-modules/SYSTEM_TEST/backend/system-test.results.js';

// MOD-TEST-01 — fixed suite list and output redaction of the local Full Regression runner (regression.cli.ts).

export interface SuiteDef {
  readonly key: string;
  readonly label: string;
  readonly cwd: 'backend' | 'frontend';
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

const FOUNDATION_DB = { TALO_FOUNDATION_DB: '1' };
const fdb = (key: string, label: string, file: string): SuiteDef => ({
  key, label, cwd: 'backend', command: 'npx', args: ['vitest', 'run', `test/integration/foundation/${file}`], env: FOUNDATION_DB,
});

export const SUITES: readonly SuiteDef[] = [
  { key: 'BACKEND_TYPECHECK', label: 'Backend typecheck', cwd: 'backend', command: 'npm', args: ['run', 'typecheck'] },
  { key: 'BACKEND_BUILD', label: 'Backend build', cwd: 'backend', command: 'npm', args: ['run', 'build'] },
  { key: 'NON_DB', label: 'Non-DB regression', cwd: 'backend', command: 'npx', args: ['vitest', 'run'] },
  { key: 'FOUNDATION_UNIT', label: 'Foundation unit', cwd: 'backend', command: 'npx', args: ['vitest', 'run', 'test/unit/foundation'] },
  fdb('FBE01_DB', 'FBE-01 Foundation registry DB', 'foundation.db.test.ts'),
  fdb('FBE02_DB', 'FBE-02 Module version DB', 'foundation.versions.db.test.ts'),
  fdb('FBE03_DB', 'FBE-03 Function / Action registry DB', 'foundation.registry.db.test.ts'),
  fdb('FBE04_DB', 'FBE-04 Data contracts / compatibility DB', 'foundation.data.db.test.ts'),
  fdb('FBE05_DB', 'FBE-05 Lifecycle DB', 'foundation.lifecycle.db.test.ts'),
  fdb('FBE06_DB', 'FBE-06 Navigation DB', 'foundation.navigation.db.test.ts'),
  fdb('FBE07_DB', 'FBE-07 End-to-end acceptance DB', 'foundation.acceptance.db.test.ts'),
  {
    key: 'SYSTEM_TEST_DB', label: 'SYSTEM_TEST module DB', cwd: 'backend', command: 'npx',
    args: ['vitest', 'run', 'test/integration/system-test/system-test.db.test.ts'], env: FOUNDATION_DB,
  },
  {
    key: 'IAM_ADMIN_DB', label: 'IAM Management DB (talo_app, no persistent write)', cwd: 'backend', command: 'npx',
    args: ['vitest', 'run', 'test/integration/iam-admin/iam-admin.db.test.ts'], env: FOUNDATION_DB,
  },
  {
    key: 'AUTH_DB', label: 'Auth DB', cwd: 'backend', command: 'npx',
    args: ['vitest', 'run', 'test/integration/auth/auth.db.test.ts', 'test/integration/auth/provisioning.db.test.ts', '--no-file-parallelism'], env: { TALO_AUTH_DB: '1' },
  },
  { key: 'AUTH_PRIVILEGES', label: 'Auth privileges', cwd: 'backend', command: 'npx', args: ['vitest', 'run', 'test/integration/auth/auth.privileges.test.ts'], env: { TALO_AUTH_PRIV: '1' } },
  { key: 'DB_SMOKE', label: 'DB smoke', cwd: 'backend', command: 'npm', args: ['run', 'smoke:db'] },
  { key: 'FRONTEND_BUILD', label: 'Frontend typecheck + build', cwd: 'frontend', command: 'npm', args: ['run', 'build'] },
];

// Keeps only vitest / smoke summary lines and failing-test names; masks anything that looks like a credential.
export function redact(output: string): string[] {
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const keep = /^\s*(Test Files|Tests|Duration|Start at|FAIL|×|✗|PASS|Smoke|Result|error TS\d+|\[[a-z0-9-]+\] (run|evidence|cleanup))/;
  return clean.split(/\r?\n/).filter((line) => keep.test(line)).map((line) => line
    .replace(/postgres(ql)?:\/\/\S+/gi, '[url]')
    .replace(/(password|passwd|pwd|secret|token|cookie|talo_sid)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/talo_sid=[^;\s]+/gi, 'talo_sid=[redacted]')
    .trim().slice(0, 400)).slice(-40);
}

export function testCounts(lines: readonly string[]): RegressionSuite['tests'] {
  const line = lines.find((l) => /^Tests\s/.test(l));
  if (!line) return null;
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  return { passed: n('passed'), failed: n('failed'), skipped: n('skipped') };
}
