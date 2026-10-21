import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/prisma/client.js';
import type { Prisma } from '../../src/infrastructure/prisma/generated/client.js';

// Read-only verification of the deployed IAM v0.3 catalog. Skipped unless explicitly enabled with
// TALO_IAM_SCHEMA_CHECK=1 and a DATABASE_URL. Every query runs inside a READ ONLY transaction; nothing is written.

const enabled = process.env['TALO_IAM_SCHEMA_CHECK'] === '1' && Boolean(process.env['DATABASE_URL']);

const EXPECTED_TABLES = [
  'iam_account_verifications', 'iam_audit_logs', 'iam_credentials', 'iam_memberships', 'iam_permissions',
  'iam_role_permissions', 'iam_roles', 'iam_sessions', 'iam_user_accounts', 'iam_user_permissions', 'iam_user_roles',
];

// Indexes PostgreSQL enforces but the Prisma schema does not represent (see database/prisma/README.md).
const EXPECTED_DB_ONLY_INDEXES: Record<string, string> = {
  uq_iam_account_username: 'lower((username)::text)',
  uq_iam_role_code: 'lower((role_code)::text)',
  uq_iam_permission_code: 'lower((permission_code)::text)',
  uq_iam_membership_current_account: 'WHERE (disabled_at IS NULL)',
  uq_iam_user_active_role: 'WHERE (revoked_at IS NULL)',
  uq_iam_user_active_direct_permission: 'WHERE (revoked_at IS NULL)',
  ix_iam_user_roles_account: 'WHERE (revoked_at IS NULL)',
  ix_iam_user_permission_account: 'WHERE (revoked_at IS NULL)',
};

describe.skipIf(!enabled)('IAM v0.3 catalog (read-only)', () => {
  const client = enabled ? createPrismaClient(process.env['DATABASE_URL'] ?? '') : undefined;

  afterAll(async () => {
    await client?.$disconnect();
  });

  async function readOnly<T>(query: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!client) throw new Error('client not configured');
    return client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return query(tx);
    });
  }

  // pg_catalog, not information_schema: information_schema only lists objects the CONNECTED role holds a privilege on, and
  // the least-privilege API role (talo_app) has none on iam_account_verifications — the catalog check must not depend on
  // runtime grants (verified 2026-10-20: pg_tables shows 11 tables, information_schema 10 under talo_app).
  it('has exactly the 11 IAM tables', async () => {
    const rows = await readOnly((db) => db.$queryRaw<{ table_name: string }[]>`
      select tablename as table_name from pg_catalog.pg_tables where schemaname = 'iam' order by tablename`);
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  // IAM Phase C PC-01 adds exactly one CHECK (ck_account_membership_state) together with membership_id nullable: the v0.3
  // count stays 12 without it, and the two changes are present together or not at all.
  it('has 16 foreign keys, 12 CHECK constraints of v0.3 (+ PC-01 ck_account_membership_state) and 18 non-primary-key indexes', async () => {
    const [counts] = await readOnly((db) => db.$queryRaw<{ fk: number; ck: number; ix: number; pc01: number; nullable: string }[]>`
      select
        (select count(*)::int from pg_constraint where connamespace = 'iam'::regnamespace and contype = 'f') as fk,
        (select count(*)::int from pg_constraint where connamespace = 'iam'::regnamespace and contype = 'c' and conname <> 'ck_account_membership_state') as ck,
        (select count(*)::int from pg_indexes where schemaname = 'iam' and indexname not like '%pkey') as ix,
        (select count(*)::int from pg_constraint where connamespace = 'iam'::regnamespace and contype = 'c' and conname = 'ck_account_membership_state') as pc01,
        (select is_nullable::text from information_schema.columns where table_schema = 'iam' and table_name = 'iam_user_accounts' and column_name = 'membership_id') as nullable`);
    expect({ fk: counts?.fk, ck: counts?.ck, ix: counts?.ix }).toEqual({ fk: 16, ck: 12, ix: 18 });
    expect([counts?.pc01, counts?.nullable]).toEqual(counts?.pc01 === 1 ? [1, 'YES'] : [0, 'NO']);
  });

  it('still enforces the partial and expression indexes that Prisma does not model', async () => {
    const rows = await readOnly((db) => db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes where schemaname = 'iam'`);
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    for (const [name, fragment] of Object.entries(EXPECTED_DB_ONLY_INDEXES)) {
      expect(byName.get(name), name).toContain(fragment);
    }
  });

  it('has no active_role_id column (v0.3)', async () => {
    const rows = await readOnly((db) => db.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'iam'::regnamespace and a.attname = 'active_role_id' and a.attnum > 0 and not a.attisdropped`);
    expect(rows[0]?.n).toBe(0);
  });
});
