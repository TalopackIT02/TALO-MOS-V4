import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { AUTH_SQL } from '../../../src/modules/auth/auth.repository.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';

// Read-only privilege proof (CT-P1): every statement of the auth module is planned with EXPLAIN (no ANALYZE) as talo_app
// inside a READ ONLY transaction. PostgreSQL checks table/column privileges while initialising the plan but executes
// nothing, so no row is read or written. Runs only with TALO_AUTH_PRIV=1.

const enabled = process.env['TALO_AUTH_PRIV'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';

// Placeholder parameters per statement (never executed).
const PARAMS: Record<keyof typeof AUTH_SQL, unknown[]> = {
  lookup: ['nobody'],
  reserve: [NIL, 5, '15 minutes'],
  withinDeadline: ['2026-01-01T00:00:00Z', '30 seconds'],
  lockAccount: [NIL],
  lockCredential: [NIL],
  readEligibility: [NIL, '2026-01-01T00:00:00Z', '30 seconds'],
  casReset: [NIL, '2026-01-01T00:00:00Z'],
  revokeAccountSessions: [NIL],
  insertSession: [NIL, 'hash', 1, '10 hours'],
  audit: [null, null, null, 'LOGIN', 'USER_ACCOUNT', null, 'FAILURE', '{}'],
  findSession: ['hash', '60 minutes', '15 minutes'],
  touchSession: [NIL, '1 minute'],
  revokeSession: [NIL],
  revokeLiveSessionByToken: ['hash'],
  readPasswordContext: [NIL],
  sessionStillActivation: [NIL, '15 minutes'],
  changePassword: [NIL, 'new', 'old'],
  activateAccount: [NIL],
};

describe.skipIf(!enabled)('auth SQL privileges as talo_app (EXPLAIN only, READ ONLY transaction)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
  });
  afterAll(async () => prisma?.$disconnect());

  it('plans every statement without a privilege error and writes nothing', async () => {
    const results: Record<string, string> = {};
    for (const [name, sql] of Object.entries(AUTH_SQL)) {
      const params = PARAMS[name as keyof typeof AUTH_SQL];
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          const [who] = await tx.$queryRawUnsafe<{ db: string; usr: string; ro: string }[]>(
            `SELECT current_database() AS db, current_user AS usr, current_setting('transaction_read_only') AS ro`);
          if (who?.db !== 'talo_mos_v4_test' || who.usr !== 'talo_app' || who.ro !== 'on') throw new Error('guard failed');
          await tx.$queryRawUnsafe(`EXPLAIN ${sql}`, ...params);
          throw new Error('ROLLBACK_SENTINEL'); // never commit anything
        });
      } catch (error) {
        results[name] = error instanceof Error && error.message === 'ROLLBACK_SENTINEL' ? 'OK' : `FAIL ${error instanceof Error ? error.message.slice(0, 160) : 'error'}`;
      }
    }
    console.log(`[CT-P1] ${JSON.stringify(results, null, 1)}`);
    for (const [name, outcome] of Object.entries(results)) expect(outcome, name).toBe('OK');
  });

  it('negative control: planning a statement talo_app has no privilege for fails (42501)', async () => {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$queryRawUnsafe('EXPLAIN DELETE FROM iam.iam_audit_logs');
      return 'planned';
    }).catch((error: unknown) => (JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})).includes('42501') ? 'denied' : 'other error'));
    expect(outcome).toBe('denied');
  });
});
