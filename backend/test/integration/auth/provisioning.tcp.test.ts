import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { prismaExecutor } from '../../../src/modules/auth/provisioning/prismaExecutor.js';
import { provisionAccount } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import { REISSUE_FUNCTION_SIGNATURE, reissueTemporaryPassword } from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { lit } from '../sc5/harness.js';
import type { PsqlSession } from '../sc5/harness.js';

// Smoke test of the provisioning path over TCP with the real talo_provisioner credential.
// Runs only with TALO_PROVISIONER_TCP=1 AND PROVISIONER_DATABASE_URL supplied by the environment (secret store / session
// variable — never .env in Git, never printed). Guards: role talo_provisioner, host 127.0.0.1/localhost, database
// talo_mos_v4_test. Fixtures are AUTHT-tagged and deleted by UUID (talo_test_harness). Assertions about secrets use
// booleans so a failure can never print the secret.

const url = process.env['PROVISIONER_DATABASE_URL'];
const enabled = process.env['TALO_PROVISIONER_TCP'] === '1' && url !== undefined;

function target(value: string) {
  const u = new URL(value);
  return { role: decodeURIComponent(u.username), host: u.hostname, database: decodeURIComponent(u.pathname.slice(1)), secret: decodeURIComponent(u.password) };
}

describe.skipIf(!enabled)('provisioning over TCP as talo_provisioner (talo_mos_v4_test)', { timeout: 120_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  const hasher = new PasswordHasher();
  const t = target(url ?? 'postgresql://x@invalid/x');

  beforeAll(async () => {
    if (t.role !== 'talo_provisioner' || !['127.0.0.1', 'localhost'].includes(t.host) || t.database !== 'talo_mos_v4_test') {
      throw new Error('guard: PROVISIONER_DATABASE_URL must be talo_provisioner@127.0.0.1/talo_mos_v4_test');
    }
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    prisma = createPrismaClient(url ?? '');
    const [who] = await prisma.$queryRawUnsafe<{ usr: string; db: string; tcp: boolean }[]>(
      'SELECT current_user AS usr, current_database() AS db, inet_server_addr() IS NOT NULL AS tcp');
    if (who?.usr !== 'talo_provisioner' || who.db !== 'talo_mos_v4_test' || !who.tcp) throw new Error('guard: not a TCP session of talo_provisioner on the test database');
    await hasher.init();
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
  });
  afterEach(async () => {
    await fx.cleanup();
  });
  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  it('provision and re-issue over TCP; nothing secret in the stored rows', async () => {
    const created = await provisionAccount(prismaExecutor(prisma), hasher, {
      employeeCode: `${fx.runId}-T1`, fullName: 'Nhân viên TCP', username: `${fx.runId}-t1`.toLowerCase(), joinedAt: '2026-10-01',
    });
    fx.adopt(created.membershipId, created.userAccountId, created.username);
    const [row] = await h.ok(`SELECT a.account_status, c.must_change_password FROM iam.iam_user_accounts a
      JOIN iam.iam_credentials c ON c.user_account_id = a.user_account_id WHERE a.user_account_id = ${lit(created.userAccountId)}`);
    expect(row).toEqual(['PROVISIONED', 't']);
    const [installed] = await h.ok(`SELECT to_regprocedure('${REISSUE_FUNCTION_SIGNATURE}') IS NOT NULL`);
    if (installed?.[0] === 't') {
      const reissued = await reissueTemporaryPassword(prismaExecutor(prisma), hasher, created.username);
      expect(reissued.temporaryPassword === created.temporaryPassword).toBe(false);
    }
    const audit = (await h.ok(`SELECT metadata::text FROM iam.iam_audit_logs WHERE target_id = ${lit(created.userAccountId)}`)).map((r) => r[0] ?? '');
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit.some((m) => m.includes(created.temporaryPassword) || (t.secret !== '' && m.includes(t.secret)))).toBe(false);
  });

  it('CLI guards: refuses a non-interactive output and a URL for another role, without echoing the secret', () => {
    const cli = resolve(import.meta.dirname, '../../../src/modules/auth/provisioning/cli.ts');
    const run = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['--import', 'tsx', cli, '--reissue', '--username', `${fx.runId}-nobody`],
      { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const nonTty = run({ PROVISIONER_DATABASE_URL: url });
    expect(nonTty.status).toBe(1);
    expect(nonTty.stderr.includes('refusing to print a temporary password to a non-interactive output')).toBe(true);
    const wrongRole = run({ PROVISIONER_DATABASE_URL: (url ?? '').replace(/\/\/[^:@/]+/, '//talo_app') });
    expect(wrongRole.status).toBe(1);
    expect(wrongRole.stderr.includes('must use role talo_provisioner')).toBe(true);
    const output = `${nonTty.stdout}${nonTty.stderr}${wrongRole.stdout}${wrongRole.stderr}`;
    expect(t.secret !== '' && output.includes(t.secret)).toBe(false);
  });
});
