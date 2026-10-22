import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { PROVISIONING_SQL } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import type { SqlExecutor as ProvisionExecutor } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import { REISSUE_CALL } from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { safeMetadata } from '../../../src/modules/iam-admin/iam.admin.lifecycle.js';
import type { ProvisionerConnection } from '../../../src/modules/iam-admin/iam.admin.provisioner.js';
import { provisionerProblems } from '../../../src/modules/iam-admin/iam.admin.provisioner.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../foundation/fakes.js';

// IAM Phase B — account lifecycle / sessions / audit / temporary credentials over a scripted database (no PostgreSQL):
// permission gate per route (READ ≠ MANAGE), root / self protection with audit FAILURE and no writer call, writer calls
// through the SECURITY DEFINER functions only, fail closed while the DB package is missing (42883 / 42501), temporary
// password only in the one answer (no-store) and never in an audit row, P-4e feature flag.

const ADMIN = '30000000-0000-4000-8000-000000000001';
const TARGET = '30000000-0000-4000-8000-000000000002';
const ROOT = '30000000-0000-4000-8000-0000000000ff';
const SESSION = '70000000-0000-4000-8000-000000000001';
const cookie = `talo_sid=${token('iamb')}`;
const ALL = ['iam.accounts.read', 'iam.accounts.create', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read'];

type Handler = (sql: string, params: readonly unknown[]) => unknown[] | undefined;
interface Options {
  readonly rootAccountId?: string | null;
  readonly provisioner?: ProvisionerConnection;
  readonly platformAdminTarget?: boolean;
}

const hasher = new PasswordHasher();

function harness(granted: readonly string[], script: Handler = () => undefined, options: Options = {}) {
  const writes: { sql: string; params: readonly unknown[] }[] = [];
  const queries: string[] = [];
  const answer = (sql: string, params: readonly unknown[]): unknown[] => {
    queries.push(sql);
    if (sql === FOUNDATION_SQL.permissionDefinitions) return [{ permission_id: `p:${String(params[0])}`, minimum_assurance_level: 1 }];
    if (sql === FOUNDATION_SQL.accountFacts) return [{ account_status: 'ACTIVE', not_disabled: true }];
    if (sql === FOUNDATION_SQL.grantFacts) {
      return granted.includes(String(params[1]).slice(2)) ? [{ source: 'ROLE', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true }] : [];
    }
    const scripted = script(sql, params);
    if (scripted !== undefined) return scripted;
    if (sql.includes('AS admin')) return [{ admin: options.platformAdminTarget === true }];
    return [];
  };
  const db: FoundationDb = {
    query: async (sql, params) => answer(sql, params),
    execute: async (sql, params) => { answer(sql, params); writes.push({ sql, params }); return 1; },
    transaction: async (fn) => fn({ query: async (sql, params) => answer(sql, params), execute: async (sql, params) => { writes.push({ sql, params }); return 1; } }),
  };
  const auth = new FakeAuth();
  auth.authenticated(token('iamb'), ADMIN);
  const app = createApp({
    config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: createLogger({ level: 'error' }),
    apiRouters: [iamAdminRouter({
      db, authService: auth, secureCookie: false, rootAccountId: options.rootAccountId === undefined ? ROOT : options.rootAccountId,
      ...(options.provisioner ? { provisioner: options.provisioner, hasher } : {}),
    })],
  });
  const send = (url: string, body: unknown = {}) =>
    request(app).post(`/api${url}`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const get = (url: string) => request(app).get(`/api${url}`).set('Cookie', cookie);
  const audits = () => writes.filter((w) => w.sql.includes('iam_audit_logs'));
  const failures = () => audits().filter((w) => w.params.includes('FAILURE')).map((w) => JSON.parse(String(w.params[5])).reason);
  const writerCalls = () => queries.filter((q) => /iam\.admin_(set_account_status|revoke_sessions|clear_login_lock)/.test(q));
  return { send, get, writes, queries, audits, failures, writerCalls };
}

// Fake talo_provisioner executor answering the P-4e SQL (provisionAccount) and the re-issue function call.
function provisioner(script: { reissue?: () => Record<string, string | null>[] } = {}) {
  const seen: { sql: string; params: readonly (string | null)[] }[] = [];
  const executor: ProvisionExecutor = {
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (sql === PROVISIONING_SQL.usernameTaken) return [{ n: params[0] === 'taken' ? '1' : '0' }];
      if (sql === PROVISIONING_SQL.membershipByCode) return [];
      if (sql === PROVISIONING_SQL.insertMembership) return [{ membership_id: '80000000-0000-4000-8000-000000000001' }];
      if (sql === PROVISIONING_SQL.insertAccount) return [{ user_account_id: TARGET }];
      if (sql === REISSUE_CALL) {
        if (script.reissue) return script.reissue();
        return [{ user_account_id: TARGET, revoked_sessions: '2' }];
      }
      return [];
    },
    transaction: async (work) => work(executor),
  };
  const connection: ProvisionerConnection = { state: 'READY', executor, close: async () => undefined };
  return { connection, seen };
}

describe('IAM Phase B — permission gate per route (READ ≠ MANAGE)', () => {
  it('each route needs its own permission; iam.accounts.read alone opens only the reads of the account', async () => {
    const h = harness(['iam.accounts.read'], (sql) => (sql.includes('a.created_at AS "createdAt"') ? [{ createdAt: '2026-10-17T00:00:00Z' }] : undefined));
    expect((await h.get(`/iam/admin/accounts/${TARGET}/details`)).status).toBe(200);
    for (const r of [
      await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'x' }),
      await h.send(`/iam/admin/accounts/${TARGET}/login-lock/clear`, { reason: 'x' }),
      await h.get(`/iam/admin/accounts/${TARGET}/sessions`),
      await h.send(`/iam/admin/accounts/${TARGET}/sessions/revoke`, { reason: 'x' }),
      await h.get('/iam/admin/audit'),
      await h.send('/iam/admin/accounts', { employeeCode: 'E1', fullName: 'A', username: 'a1', joinedAt: '2026-10-01' }),
      await h.send(`/iam/admin/accounts/${TARGET}/credential/reissue`, { reason: 'x' }),
    ]) expect([r.status, r.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect(h.writerCalls()).toEqual([]);
    expect(h.audits().every((w) => w.params.includes('DENIED'))).toBe(true);
  });

  it('400 on bad bodies before any writer call (action, missing / control-character reason, unknown field, bad session id)', async () => {
    const h = harness(ALL);
    for (const r of [
      await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'DELETE', reason: 'x' }),
      await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK' }),
      await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'a\u0000b' }),
      await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'x', extra: 1 }),
      await h.send(`/iam/admin/accounts/${TARGET}/sessions/revoke`, { sessionId: 'nope', reason: 'x' }),
      await h.get('/iam/admin/audit?action=IAM%25'),
      await h.get('/iam/admin/audit?outcome=MAYBE'),
    ]) expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(h.writerCalls()).toEqual([]);
  });
});

describe('IAM Phase B — account status (writer protocol in the database function)', () => {
  it('LOCK goes through iam.admin_set_account_status with actor, target, action, reason; the answer reports revoked sessions', async () => {
    const h = harness(ALL, (sql, p) => (sql.includes('iam.admin_set_account_status') ? [{ previousStatus: 'ACTIVE', status: 'LOCKED', revokedSessions: 3, _p: p }] : undefined));
    const res = await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'Nghỉ phép dài ngày' });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ previousStatus: 'ACTIVE', status: 'LOCKED', revokedSessions: 3 });
    expect(h.writerCalls()).toHaveLength(1);
    expect(h.writes.filter((w) => !w.sql.includes('iam_audit_logs'))).toEqual([]); // no direct UPDATE by talo_iam_admin
  });

  it('root: LOCK / DISABLE → 422 ROOT_ADMIN_PROTECTED + audit FAILURE, no function call; UNLOCK / REACTIVATE allowed', async () => {
    const h = harness(ALL, (sql) => (sql.includes('iam.admin_set_account_status') ? [{ previousStatus: 'LOCKED', status: 'ACTIVE', revokedSessions: 0 }] : undefined));
    for (const action of ['LOCK', 'DISABLE']) {
      const r = await h.send(`/iam/admin/accounts/${ROOT}/status`, { action, reason: 'x' });
      expect([r.status, r.body.error.code]).toEqual([422, 'ROOT_ADMIN_PROTECTED']);
    }
    expect(h.writerCalls()).toEqual([]);
    expect(h.failures()).toEqual(['ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED']);
    expect((await h.send(`/iam/admin/accounts/${ROOT}/status`, { action: 'UNLOCK', reason: 'x' })).status).toBe(200);
  });

  it('self → 422 SELF_ACTION_FORBIDDEN (audited); root not configured → platform administrators cannot be locked (ROOT_NOT_CONFIGURED)', async () => {
    const self = harness(ALL);
    const r = await self.send(`/iam/admin/accounts/${ADMIN}/status`, { action: 'DISABLE', reason: 'x' });
    expect([r.status, r.body.error.code, self.failures()]).toEqual([422, 'SELF_ACTION_FORBIDDEN', ['SELF_ACTION_FORBIDDEN']]);
    const noRoot = harness(ALL, undefined, { rootAccountId: null, platformAdminTarget: true });
    const n = await noRoot.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'x' });
    expect([n.status, n.body.error.code, noRoot.writerCalls()]).toEqual([422, 'ROOT_NOT_CONFIGURED', []]);
  });

  it('another platform administrator CAN be locked when root is configured (only root is irrevocable)', async () => {
    const h = harness(ALL, (sql) => (sql.includes('iam.admin_set_account_status') ? [{ previousStatus: 'ACTIVE', status: 'LOCKED', revokedSessions: 1 }] : undefined), { platformAdminTarget: true });
    expect((await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'LOCK', reason: 'x' })).status).toBe(200);
  });

  it('database package missing / refusals of the function map to controlled answers, never a 500', async () => {
    const cases: [string, number, string][] = [['42883', 503, 'IAM_DB_FEATURE_MISSING'], ['42501', 503, 'IAM_DB_PRIVILEGE_MISSING'],
      ['TA409', 409, 'STATUS_TRANSITION_INVALID'], ['TA410', 409, 'ACCOUNT_RETIRED'], ['TA404', 404, 'NOT_FOUND'], ['55P03', 503, 'SERVICE_BUSY']];
    for (const [state, status, code] of cases) {
      const h = harness(ALL, (sql) => { if (sql.includes('iam.admin_')) throw pgError(state); return undefined; });
      const r = await h.send(`/iam/admin/accounts/${TARGET}/status`, { action: 'UNLOCK', reason: 'x' });
      expect([state, r.status, r.body.error.code]).toEqual([state, status, code]);
    }
  });
});

describe('IAM Phase B — sessions, login lock, account details', () => {
  it('sessions: listed without token / hash; revoke one or all through the function', async () => {
    const h = harness(ALL, (sql) => {
      if (sql.includes('FROM iam.iam_sessions s')) return [{ sessionId: SESSION, assuranceLevel: 1, createdAt: 'x', expiresAt: 'y', lastSeenAt: 'z', revokedAt: null, status: 'ACTIVE' }];
      if (sql.includes('iam.admin_revoke_sessions')) return [{ revokedSessions: 1 }];
      return undefined;
    });
    const list = await h.get(`/iam/admin/accounts/${TARGET}/sessions`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/token|hash/i);
    expect(h.queries.find((q) => q.includes('FROM iam.iam_sessions s'))).not.toMatch(/session_token_hash/);
    const one = await h.send(`/iam/admin/accounts/${TARGET}/sessions/revoke`, { sessionId: SESSION, reason: 'Thiết bị bị mất' });
    const all = await h.send(`/iam/admin/accounts/${ROOT}/sessions/revoke`, { reason: 'Buộc đăng nhập lại' }); // root: forced re-login is allowed
    expect([one.status, one.body.result.revokedSessions, all.status]).toEqual([200, 1, 200]);
  });

  it('sessions without the column grant → 503 IAM_DB_PRIVILEGE_MISSING; details fall back to null (base account still readable)', async () => {
    const h = harness(ALL, (sql) => { if (sql.includes('FROM iam.iam_sessions') || sql.includes('a.created_at AS "createdAt"')) throw pgError('42501'); return undefined; });
    const s = await h.get(`/iam/admin/accounts/${TARGET}/sessions`);
    expect([s.status, s.body.error.code]).toEqual([503, 'IAM_DB_PRIVILEGE_MISSING']);
    const d = await h.get(`/iam/admin/accounts/${TARGET}/details`);
    expect([d.status, d.body.details]).toEqual([200, null]);
  });

  it('login lock clear goes through iam.admin_clear_login_lock', async () => {
    const h = harness(ALL, (sql) => (sql.includes('iam.admin_clear_login_lock') ? [{ cleared: true }] : undefined));
    const r = await h.send(`/iam/admin/accounts/${TARGET}/login-lock/clear`, { reason: 'Người dùng xác minh qua điện thoại' });
    expect([r.status, r.body.result]).toEqual([200, { cleared: true }]);
  });
});

describe('IAM Phase B — IAM audit viewer', () => {
  it('filters are bound values (action prefix escaped); metadata reduced to safe keys (no ip / ua / password)', async () => {
    let params: readonly unknown[] = [];
    const h = harness(['iam.audit.read'], (sql, p) => {
      if (sql.includes('count(*)::int AS total FROM iam.iam_audit_logs')) return [{ total: 1 }];
      if (sql.includes('FROM iam.iam_audit_logs l') && sql.includes('LIMIT $7')) {
        params = p;
        return [{ auditId: '1', action: 'LOGIN', outcome: 'SUCCESS', metadata: { v: 1, reason: 'OK', ip: '10.0.0.1', ua: 'Mozilla', requestId: 'r', temporaryPassword: 'nope' } }];
      }
      return undefined;
    });
    const r = await h.get(`/iam/admin/audit?accountId=${TARGET}&action=IAM.ACCOUNT_&outcome=FAILURE&from=2026-10-01T00:00:00Z&page=2&pageSize=10`);
    expect(r.status).toBe(200);
    expect(params).toEqual([TARGET, 'IAM.ACCOUNT_', 'IAM.ACCOUNT\\_%', 'FAILURE', '2026-10-01T00:00:00Z', null, 10, 10]);
    expect(r.body.events[0].metadata).toEqual({ reason: 'OK', requestId: 'r' });
    expect(safeMetadata(['x'])).toEqual({});
  });
});

describe('IAM Phase B — temporary credentials (P-4e services, feature flag)', () => {
  it('flag off (default): reissue → 503 CREDENTIAL_UI_DISABLED, legacy create → 410 (blocked, PC-01 G2), nothing attempted; capabilities report DISABLED', async () => {
    const h = harness(ALL);
    const c = await h.send('/iam/admin/accounts', { employeeCode: 'E1', fullName: 'A', username: 'a1', joinedAt: '2026-10-01' });
    const r = await h.send(`/iam/admin/accounts/${TARGET}/credential/reissue`, { reason: 'x' });
    expect([c.status, c.body.error.code, r.status, r.body.error.code]).toEqual([410, 'LEGACY_ACCOUNT_CREATE_BLOCKED', 503, 'CREDENTIAL_UI_DISABLED']);
    expect((await h.get('/iam/admin/me/capabilities')).body.features).toEqual({ temporaryCredentials: 'DISABLED' });
  });

  // Owner decision PC-01 G2: the legacy combined create (account + membership + temporary credential) is blocked until the
  // D-1 boundary of PC-02 is approved — even with every permission and P-4e READY nothing reaches the P-4e service or the DB.
  it('legacy combined create is blocked: 410 LEGACY_ACCOUNT_CREATE_BLOCKED even with P-4e READY; no P-4e call, no write, no password', async () => {
    await hasher.init();
    const p = provisioner();
    const h = harness(ALL, undefined, { provisioner: p.connection });
    for (const body of [{ employeeCode: 'NV0101', fullName: 'Nguyễn Văn B', username: 'nv0101', joinedAt: '2026-10-01' }, {}, { anything: true }]) {
      const res = await h.send('/iam/admin/accounts', body);
      expect([res.status, res.body.error.code]).toEqual([410, 'LEGACY_ACCOUNT_CREATE_BLOCKED']);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain('temporaryPassword');
    }
    expect(p.seen).toEqual([]); // no P-4e statement (membership / account / credential / audit)
    expect(h.writes).toEqual([]); // nothing written through the IAM connection either
    expect(p.seen.some((s) => s.sql === PROVISIONING_SQL.insertAccount)).toBe(false);
    // Not a way around the permission gate: without iam.accounts.create the answer stays 403.
    const reader = harness(['iam.accounts.read'], undefined, { provisioner: p.connection });
    expect((await reader.send('/iam/admin/accounts', {})).status).toBe(403);
    // The pending-account route and the re-issue route are separate and unaffected (covered by their own tests).
  });

  it('reissue: root / self refused (audited) before the function; refusal TA403 → 422 PRIVILEGED_ACCOUNT_PROTECTED (audited); success audited without the password', async () => {
    await hasher.init();
    const p = provisioner();
    const h = harness(ALL, (sql) => (sql.startsWith('SELECT username, (membership_id IS NULL) AS pending FROM iam.iam_user_accounts') ? [{ username: 'nv0101', pending: false }] : undefined), { provisioner: p.connection });
    for (const [who, code] of [[ROOT, 'ROOT_ADMIN_PROTECTED'], [ADMIN, 'SELF_ACTION_FORBIDDEN']] as const) {
      const r = await h.send(`/iam/admin/accounts/${who}/credential/reissue`, { reason: 'x' });
      expect([r.status, r.body.error.code]).toEqual([422, code]);
    }
    expect(p.seen.filter((s) => s.sql === REISSUE_CALL)).toEqual([]);
    const ok = await h.send(`/iam/admin/accounts/${TARGET}/credential/reissue`, { reason: 'Quên mật khẩu, đã xác minh' });
    expect([ok.status, ok.headers['cache-control'], ok.body.credential.revokedSessions]).toEqual([200, 'no-store', 2]);
    const password = String(ok.body.credential.temporaryPassword);
    const success = h.audits().find((w) => w.params.includes('SUCCESS'));
    expect(String(success?.params[1])).toBe('IAM.CREDENTIAL.REISSUE');
    expect(JSON.stringify(h.writes)).not.toContain(password);
    const refused = provisioner({ reissue: () => { throw pgError('TA403'); } });
    const h2 = harness(ALL, (sql) => (sql.startsWith('SELECT username, (membership_id IS NULL) AS pending FROM iam.iam_user_accounts') ? [{ username: 'nv0101', pending: false }] : undefined), { provisioner: refused.connection });
    const r2 = await h2.send(`/iam/admin/accounts/${TARGET}/credential/reissue`, { reason: 'x' });
    expect([r2.status, r2.body.error.code, h2.failures()]).toEqual([422, 'PRIVILEGED_ACCOUNT_PROTECTED', ['PRIVILEGED_ACCOUNT_PROTECTED']]);
  });

  it('provisioner identity check: only talo_provisioner, same database, no elevated attribute', () => {
    const ok = { usr: 'talo_provisioner', db: 'talo_mos_v4_test', super: false, createrole: false, createdb: false, bypassrls: false };
    expect(provisionerProblems([ok], 'talo_mos_v4_test')).toEqual([]);
    expect(provisionerProblems([{ ...ok, usr: 'talo_app' }], 'talo_mos_v4_test')).toEqual(['role is not talo_provisioner']);
    expect(provisionerProblems([{ ...ok, super: true }], 'other')).toEqual(['another database', 'role has elevated attributes']);
    expect(provisionerProblems([], 'x')).toEqual(['identity unreadable']);
  });
});

describe('IAM Phase B — configuration', () => {
  it('flag accepts enabled / disabled only; provisioner URL must be talo_provisioner on the same database; values never echoed', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://talo_app:s3cret@127.0.0.1:5433/talo_mos_v4_test' };
    expect(loadConfig(base).iamUiTemporaryCredentials).toBe(false);
    expect(loadConfig({ ...base, IAM_UI_TEMPORARY_CREDENTIALS: 'enabled' }).iamUiTemporaryCredentials).toBe(true);
    expect(() => loadConfig({ ...base, IAM_UI_TEMPORARY_CREDENTIALS: 'yes' })).toThrow(/IAM_UI_TEMPORARY_CREDENTIALS/);
    expect(loadConfig({ ...base, PROVISIONER_DATABASE_URL: 'postgresql://talo_provisioner:pw@127.0.0.1:5433/talo_mos_v4_test' }).provisionerDatabaseUrl).toBeDefined();
    for (const bad of ['postgresql://talo_app:pw@127.0.0.1:5433/talo_mos_v4_test', 'postgresql://talo_provisioner:pw@127.0.0.1:5433/other']) {
      let message = '';
      try { loadConfig({ ...base, PROVISIONER_DATABASE_URL: bad }); } catch (e) { message = e instanceof Error ? e.message : ''; }
      expect(message).toMatch(/PROVISIONER_DATABASE_URL/);
      expect(message).not.toMatch(/pw|s3cret/);
    }
  });
});
