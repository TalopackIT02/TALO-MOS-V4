import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { identityProblems, probeIamAdmin } from '../../../src/modules/iam-admin/iam.admin.connection.js';

// IAM-NEXT B1 — dedicated IAM Management connection: static configuration checks (env.ts) and the start-up identity
// check (iam.admin.connection.ts). No database, no secret: the URLs below are synthetic.

const API = 'postgresql://talo_app:x@127.0.0.1:5432/talo_mos_v4_test';
const env = (iam?: string) => loadConfig({ NODE_ENV: 'test', DATABASE_URL: API, ...(iam === undefined ? {} : { IAM_ADMIN_DATABASE_URL: iam }) });
const issues = (iam: string) => {
  try {
    env(iam);
    return [];
  } catch (error) {
    return error instanceof Error && 'issues' in error && Array.isArray(error.issues) ? error.issues.map(String) : ['?'];
  }
};

describe('IAM_ADMIN_DATABASE_URL (static, env.ts)', () => {
  it('optional; accepted for another role on the same server and database', () => {
    expect(env().iamAdminDatabaseUrl).toBeUndefined();
    expect(env('postgresql://talo_iam_admin:y@127.0.0.1:5432/talo_mos_v4_test').iamAdminDatabaseUrl).toContain('talo_iam_admin');
  });

  it('refuses the API role, another database / server, a non-PostgreSQL URL — messages never contain values', () => {
    expect(issues('postgresql://talo_app:y@127.0.0.1:5432/talo_mos_v4_test')).toEqual(['IAM_ADMIN_DATABASE_URL must use a role other than the DATABASE_URL role']);
    expect(issues('postgresql://talo_iam_admin:y@127.0.0.1:5432/talo_mos_v4_dev')).toEqual(['IAM_ADMIN_DATABASE_URL must target the same server and database as DATABASE_URL']);
    expect(issues('postgresql://talo_iam_admin:y@10.0.0.9:5432/talo_mos_v4_test')).toEqual(['IAM_ADMIN_DATABASE_URL must target the same server and database as DATABASE_URL']);
    expect(issues('mysql://talo_iam_admin:y@127.0.0.1/talo_mos_v4_test')).toEqual(['IAM_ADMIN_DATABASE_URL must be a postgresql:// connection string']);
    expect(JSON.stringify(issues('postgresql://talo_app:secretpw@127.0.0.1:5432/talo_mos_v4_test'))).not.toContain('secretpw');
  });
});

describe('dedicated connection identity (start-up)', () => {
  const ok = { usr: 'talo_iam_admin', db: 'talo_mos_v4_test', super: false, createrole: false, createdb: false, bypassrls: false };
  const expected = { database: 'talo_mos_v4_test', apiRole: 'talo_app' };

  it('accepts a plain role on the API database; refuses the API role, another database, elevated attributes, unreadable rows', () => {
    expect(identityProblems([ok], expected)).toEqual([]);
    expect(identityProblems([{ ...ok, usr: 'talo_app' }], expected)).toEqual(['same role as the API connection']);
    expect(identityProblems([{ ...ok, db: 'postgres' }], expected)).toEqual(['another database']);
    for (const attr of ['super', 'createrole', 'createdb', 'bypassrls']) expect(identityProblems([{ ...ok, [attr]: true }], expected)).toEqual(['role has elevated attributes']);
    expect(identityProblems([], expected)).toEqual(['identity unreadable']);
    expect(identityProblems([ok, ok], expected)).toEqual(['identity unreadable']);
  });

  it('probe compares with the live API connection; a connection error propagates (the server then keeps the API role)', async () => {
    const api = async () => [{ usr: 'talo_app', db: 'talo_mos_v4_test' }];
    expect(await probeIamAdmin(api, async () => [ok])).toEqual([]);
    expect(await probeIamAdmin(api, async () => [{ ...ok, super: true }])).toEqual(['role has elevated attributes']);
    await expect(probeIamAdmin(api, async () => { throw new Error('password authentication failed'); })).rejects.toThrow();
  });
});
