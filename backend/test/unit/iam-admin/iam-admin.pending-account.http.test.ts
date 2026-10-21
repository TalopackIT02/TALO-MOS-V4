import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { REISSUE_CALL } from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';
import type { SqlExecutor as ProvisionExecutor } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { ProvisionerConnection } from '../../../src/modules/iam-admin/iam.admin.provisioner.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../foundation/fakes.js';

// IAM Phase C PC-01 — POST /api/iam/admin/accounts/pending over a scripted database (no PostgreSQL): permission
// iam.accounts.create, username rule, one call of iam.admin_create_pending_account (never the P-4e services), error mapping
// (duplicate, package missing / frozen), no dependency on P-4e; account reads with LEFT JOIN (pending account visible with
// null membership columns); re-issue refused for an account without membership.

const ADMIN = '30000000-0000-4000-8000-000000000001';
const PENDING = '30000000-0000-4000-8000-0000000000c1';
const cookie = `talo_sid=${token('iampc01')}`;
const CREATE_CALL = 'iam.admin_create_pending_account(';

type Handler = (sql: string, params: readonly unknown[]) => unknown[] | undefined;

function harness(granted: readonly string[], script: Handler = () => undefined, provisioner?: ProvisionerConnection) {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const answer = (sql: string, params: readonly unknown[]): unknown[] => {
    queries.push({ sql, params });
    if (sql === FOUNDATION_SQL.permissionDefinitions) return [{ permission_id: `p:${String(params[0])}`, minimum_assurance_level: 1 }];
    if (sql === FOUNDATION_SQL.accountFacts) return [{ account_status: 'ACTIVE', not_disabled: true }];
    if (sql === FOUNDATION_SQL.grantFacts) {
      return granted.includes(String(params[1]).slice(2)) ? [{ source: 'ROLE', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true }] : [];
    }
    return script(sql, params) ?? [];
  };
  const db: FoundationDb = {
    query: async (sql, params) => answer(sql, params),
    execute: async (sql, params) => { answer(sql, params); return 1; },
    transaction: async (fn) => fn({ query: async (sql, params) => answer(sql, params), execute: async (sql, params) => { answer(sql, params); return 1; } }),
  };
  const auth = new FakeAuth();
  auth.authenticated(token('iampc01'), ADMIN);
  const app = createApp({
    config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: createLogger({ level: 'error' }),
    apiRouters: [iamAdminRouter({ db, authService: auth, secureCookie: false, rootAccountId: null, ...(provisioner ? { provisioner, hasher: new PasswordHasher() } : {}) })],
  });
  const send = (url: string, body: unknown) =>
    request(app).post(`/api${url}`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const get = (url: string) => request(app).get(`/api${url}`).set('Cookie', cookie);
  const creates = () => queries.filter((q) => q.sql.includes(CREATE_CALL));
  return { send, get, queries, creates };
}

const created = (sql: string, params: readonly unknown[]) => (sql.includes(CREATE_CALL)
  ? [{ accountId: PENDING, username: String(params[1]), accountStatus: 'PENDING_MEMBERSHIP', createdAt: '2026-10-21T07:00:00.000Z' }] : undefined);

describe('IAM Phase C PC-01 — create a pending account', () => {
  it('201: username only → one call of iam.admin_create_pending_account (actor, trimmed username, request id); no P-4e needed', async () => {
    const h = harness(['iam.accounts.create'], created); // no provisioner: P-4e DISABLED
    const res = await h.send('/iam/admin/accounts/pending', { username: '  nv_test_001 ' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.account).toEqual({ accountId: PENDING, username: 'nv_test_001', accountStatus: 'PENDING_MEMBERSHIP', createdAt: '2026-10-21T07:00:00.000Z', membershipId: null });
    expect(h.creates()).toHaveLength(1);
    const [call] = h.creates();
    expect(call?.params[0]).toBe(ADMIN);
    expect(call?.params[1]).toBe('nv_test_001');
    expect(String(call?.params[2])).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.queries.some((q) => /iam_memberships|iam_credentials|iam_sessions/.test(q.sql) && /INSERT/i.test(q.sql))).toBe(false);
  });

  it('403 without iam.accounts.create (READ / MANAGE do not imply CREATE); the function is not called', async () => {
    const h = harness(['iam.accounts.read', 'iam.accounts.manage'], created);
    expect((await h.send('/iam/admin/accounts/pending', { username: 'nv_test_002' })).status).toBe(403);
    expect(h.creates()).toHaveLength(0);
  });

  it('400 for an invalid body (empty, blank, whitespace, control character, > 80 characters, extra field) — nothing called', async () => {
    const h = harness(['iam.accounts.create'], created);
    for (const body of [{}, { username: '' }, { username: '   ' }, { username: 'nv test' }, { username: 'nv\u0007x' }, { username: 'a'.repeat(81) },
      { username: 'nv_ok', employeeCode: 'E1' }, { username: 42 }]) {
      const res = await h.send('/iam/admin/accounts/pending', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(h.creates()).toHaveLength(0);
  });

  it('database outcomes: TA414 → 409 USERNAME_TAKEN, TA422 → 400, TA401 / 42501 (frozen) → 503 IAM_DB_PRIVILEGE_MISSING, 42883 → 503 PENDING_ACCOUNT_DB_MISSING', async () => {
    for (const [sqlstate, status, code] of [['TA414', 409, 'USERNAME_TAKEN'], ['TA422', 400, 'VALIDATION_ERROR'], ['TA401', 503, 'IAM_DB_PRIVILEGE_MISSING'],
      ['42501', 503, 'IAM_DB_PRIVILEGE_MISSING'], ['42883', 503, 'PENDING_ACCOUNT_DB_MISSING']] as const) {
      const h = harness(['iam.accounts.create'], (sql) => { if (sql.includes(CREATE_CALL)) throw pgError(sqlstate); return undefined; });
      const res = await h.send('/iam/admin/accounts/pending', { username: 'nv_dup' });
      expect([res.status, res.body.error.code], sqlstate).toEqual([status, code]);
    }
  });
});

describe('IAM Phase C PC-01 — pending accounts in the admin reads', () => {
  it('list and detail read with LEFT JOIN memberships (an account without membership is not dropped); null membership columns pass through', async () => {
    const pending = { accountId: PENDING, username: 'nv_test_001', accountStatus: 'PENDING_MEMBERSHIP', disabled: false, membershipId: null, employeeCode: null, fullName: null, membershipStatus: null };
    const h = harness(['iam.accounts.read'], (sql) => {
      if (sql.includes('count(*)::int AS total')) return [{ total: 1 }];
      if (sql.includes('AS "accountId"')) return [pending];
      return undefined;
    });
    const list = await h.get('/iam/admin/accounts?status=PENDING_MEMBERSHIP');
    expect(list.status).toBe(200);
    expect(list.body.accounts).toEqual([{ ...pending, isRoot: false }]);
    expect((await h.get(`/iam/admin/accounts/${PENDING}`)).body.account.membershipId).toBeNull();
    const reads = h.queries.filter((q) => q.sql.includes('iam.iam_memberships'));
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const q of reads) expect(q.sql).toMatch(/LEFT JOIN iam\.iam_memberships/);
    expect(h.queries.find((q) => q.sql.includes('ORDER BY'))?.sql).toContain('NULLS LAST');
  });

  it('details of a pending account: LEFT JOIN, hasCredential reported', async () => {
    const h = harness(['iam.accounts.read'], (sql) => (sql.includes('AS "hasCredential"')
      ? [{ createdAt: '2026-10-21T07:00:00Z', activatedAt: null, disabledAt: null, joinedAt: null, leftAt: null, hasCredential: false, mustChangePassword: null }] : undefined));
    const res = await h.get(`/iam/admin/accounts/${PENDING}/details`);
    expect(res.status).toBe(200);
    expect(res.body.details.hasCredential).toBe(false);
    expect(h.queries.find((q) => q.sql.includes('AS "hasCredential"'))?.sql).toMatch(/LEFT JOIN iam\.iam_memberships/);
  });

  it('re-issue for an account without membership → 409 CREDENTIAL_NOT_ISSUED; the P-4e re-issue function is not called', async () => {
    const seen: string[] = [];
    const executor: ProvisionExecutor = { query: async (sql) => { seen.push(sql); return []; }, transaction: async (work) => work(executor) };
    const h = harness(['iam.credentials.reissue'], (sql) => (sql.includes('(membership_id IS NULL) AS pending') ? [{ username: 'nv_test_001', pending: true }] : undefined),
      { state: 'READY', executor, close: async () => undefined });
    const res = await h.send(`/iam/admin/accounts/${PENDING}/credential/reissue`, { reason: 'test' });
    expect([res.status, res.body.error.code]).toEqual([409, 'CREDENTIAL_NOT_ISSUED']);
    expect(seen.filter((s) => s === REISSUE_CALL)).toHaveLength(0);
  });
});
