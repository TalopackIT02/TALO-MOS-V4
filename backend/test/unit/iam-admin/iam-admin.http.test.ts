import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../foundation/fakes.js';

// TALO-IAM-NEXT — IAM Management HTTP contract over a scripted database (no PostgreSQL): session / IAM gate, any-of
// catalog reads, validation, error mapping (409 / 404 / 422 / 503), one transaction for mutation + audit (rollback leaves
// nothing), effective permissions independent of the viewer's assurance, MIC-07 binding of permission creation.

const ADMIN = '30000000-0000-4000-8000-000000000001';
const TARGET = '30000000-0000-4000-8000-000000000002';
const ROLE = '40000000-0000-4000-8000-000000000001';
const PERM = '50000000-0000-4000-8000-000000000001';
const ASSIGN = '60000000-0000-4000-8000-000000000001';
const cookie = `talo_sid=${token('iam')}`;

type Handler = (sql: string, params: readonly unknown[]) => unknown[] | undefined;

function harness(granted: readonly string[], script: Handler = () => undefined, options: { failAudit?: boolean; failLookup?: boolean } = {}) {
  const committed: { sql: string; params: readonly unknown[] }[] = [];
  const queries: string[] = [];
  const answer = (sql: string, params: readonly unknown[]): unknown[] => {
    queries.push(sql);
    if (sql === FOUNDATION_SQL.permissionDefinitions) {
      if (options.failLookup) throw pgError('08006');
      return [{ permission_id: `p:${String(params[0])}`, minimum_assurance_level: 1 }];
    }
    if (sql === FOUNDATION_SQL.accountFacts) return [{ account_status: 'ACTIVE', not_disabled: true }];
    if (sql === FOUNDATION_SQL.grantFacts) {
      const code = String(params[1]).slice(2);
      return granted.includes(code) || (params[0] === TARGET && code.startsWith('system_test.'))
        ? [{ source: 'ROLE', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true }] : [];
    }
    return script(sql, params) ?? [];
  };
  const db: FoundationDb = {
    query: async (sql, params) => answer(sql, params),
    execute: async (sql, params) => {
      if (options.failAudit && sql.includes('iam_audit_logs')) throw pgError('42501');
      answer(sql, params);
      committed.push({ sql, params });
      return 1;
    },
    // Writes inside the transaction are kept only when `fn` resolves (rollback otherwise).
    transaction: async (fn) => {
      const pending: { sql: string; params: readonly unknown[] }[] = [];
      const tx: SqlExecutor = {
        query: async (sql, params) => {
          const r = answer(sql, params);
          if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) pending.push({ sql, params });
          return r;
        },
        execute: async (sql, params) => {
          answer(sql, params);
          pending.push({ sql, params });
          return 1;
        },
      };
      const result = await fn(tx);
      committed.push(...pending);
      return result;
    },
  };
  const auth = new FakeAuth();
  auth.authenticated(token('iam'), ADMIN);
  auth.activation(token('act'));
  const app = createApp({
    config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: createLogger({ level: 'error' }),
    apiRouters: [iamAdminRouter({ db, authService: auth, secureCookie: false })],
  });
  const send = (method: 'post' | 'patch' | 'delete', url: string, body: unknown = {}) =>
    request(app)[method](`/api${url}`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const get = (url: string, as = cookie) => request(app).get(`/api${url}`).set('Cookie', as);
  const audits = () => committed.filter((w) => w.sql.includes('iam_audit_logs'));
  return { app, send, get, committed, queries, audits };
}

const ALL = ['iam.accounts.read', 'iam.roles.manage', 'iam.permissions.manage', 'iam.assignments.manage', 'foundation.navigation.manage'];

describe('IAM admin — session and IAM gate (IAM-02 / IAM-03 / IAM-04)', () => {
  it('401 without session, 403 PASSWORD_CHANGE_REQUIRED for an activation session; no IAM lookup', async () => {
    const h = harness(ALL);
    expect((await h.get('/iam/admin/accounts', '')).status).toBe(401);
    const act = await h.get('/iam/admin/accounts', `talo_sid=${token('act')}`);
    expect([act.status, act.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
    expect(h.queries).toEqual([]);
  });

  it('no grant → 403 FORBIDDEN with ONE IAM audit DENIED row, no management data read', async () => {
    const h = harness([]);
    const res = await h.get('/iam/admin/accounts');
    expect([res.status, res.body.error.code, typeof res.body.error.requestId]).toEqual([403, 'FORBIDDEN', 'string']);
    expect(h.audits()).toHaveLength(1);
    expect(String(h.audits()[0]?.params[3])).toBe('DENIED');
    expect(h.queries.some((q) => q.includes('iam_user_accounts a JOIN'))).toBe(false);
  });

  it('fail closed: permission lookup error → 503; DENIED audit write error → 503 (never an allow)', async () => {
    expect((await harness(ALL, undefined, { failLookup: true }).get('/iam/admin/accounts')).status).toBe(503);
    const r = await harness([], undefined, { failAudit: true }).get('/iam/admin/accounts');
    expect([r.status, r.body.error.code]).toEqual([503, 'SERVICE_BUSY']);
  });

  it('catalog reads accept ANY admin permission (gap 5); writes need their own permission', async () => {
    const h = harness(['iam.assignments.manage'], (sql) => (sql.includes('FROM iam.iam_roles r ORDER') ? [] : undefined));
    expect((await h.get('/iam/admin/roles')).status).toBe(200);
    expect((await h.get('/iam/admin/permissions')).status).toBe(200);
    expect((await h.send('post', '/iam/admin/roles', { roleCode: 'X', roleName: 'x' })).status).toBe(403);
    expect((await h.get('/iam/admin/accounts')).status).toBe(403);
  });
});

describe('IAM admin — validation and error mapping (IAM-10)', () => {
  it('400 for a bad UUID, unknown body field, bad page, bad expiry format; no SQL / secret in errors', async () => {
    const h = harness(ALL);
    for (const r of [
      await h.get('/iam/admin/accounts/not-a-uuid'),
      await h.get('/iam/admin/accounts?page=0'),
      await h.get('/iam/admin/accounts?pageSize=101'),
      await h.send('post', '/iam/admin/roles', { roleCode: 'R1', roleName: 'r', extra: 1 }),
      await h.send('post', `/iam/admin/accounts/${TARGET}/permissions`, { permissionId: PERM, effect: 'ALLOW', reason: 'x', expiresAt: 'tomorrow' }),
      await h.send('post', `/iam/admin/accounts/${TARGET}/permissions`, { permissionId: PERM, effect: 'MAYBE', reason: 'x' }),
    ]) {
      expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
      expect(JSON.stringify(r.body)).not.toMatch(/SELECT|INSERT|iam_|postgres/i);
    }
  });

  it('search is a bound, escaped LIKE pattern; paging bound', async () => {
    const seen: (readonly unknown[])[] = [];
    const h = harness(ALL, (sql, params) => {
      if (sql.includes('count(*)::int AS total')) { seen.push(params); return [{ total: 0 }]; }
      if (sql.includes('LIMIT $3 OFFSET $4')) { seen.push(params); return []; }
      return undefined;
    });
    const r = await h.get('/iam/admin/accounts?search=50%25_x&page=3&pageSize=10');
    expect(r.status).toBe(200);
    expect(seen[1]).toEqual(['50%_x', '%50\\%\\_x%', 10, 20]);
  });

  it('duplicate (23505) → 409 DUPLICATE; FK (23503) → 404; missing DB privilege (42501) → 503 IAM_DB_PRIVILEGE_MISSING — and NOTHING committed', async () => {
    for (const [state, status, code] of [['23505', 409, 'DUPLICATE'], ['23503', 404, 'NOT_FOUND'], ['42501', 503, 'IAM_DB_PRIVILEGE_MISSING']] as const) {
      const h = harness(ALL, (sql) => {
        if (sql.includes('FROM iam.iam_roles WHERE role_id=$1::uuid FOR UPDATE')) return [{ id: ROLE, isSystem: false, isActive: true }];
        if (sql.startsWith('INSERT INTO iam.iam_user_roles')) throw pgError(state);
        return undefined;
      });
      const r = await h.send('post', `/iam/admin/accounts/${TARGET}/roles`, { roleId: ROLE });
      expect([state, r.status, r.body.error.code]).toEqual([state, status, code]);
      expect(h.committed).toEqual([]); // no partial mutation, no SUCCESS audit
    }
  });
});

describe('IAM admin — roles, assignments, revoke (IAM-05 … IAM-08, IAM-11)', () => {
  it('create role commits the INSERT and its SUCCESS audit together', async () => {
    const h = harness(ALL, (sql) => (sql.startsWith('INSERT INTO iam.iam_roles') ? [{ id: ROLE, roleCode: 'OPS', roleName: 'Ops', description: null, isActive: true, isSystem: false }] : undefined));
    const r = await h.send('post', '/iam/admin/roles', { roleCode: 'OPS', roleName: 'Ops' });
    expect([r.status, r.body.role.roleCode]).toEqual([201, 'OPS']);
    expect(h.committed.map((w) => /^INSERT INTO (iam[.][a-z_]+)/.exec(w.sql)?.[1])).toEqual(['iam.iam_roles', 'iam.iam_audit_logs']);
    expect(JSON.parse(String(h.audits()[0]?.params[4]))).toMatchObject({ v: 1, roleCode: 'OPS' });
  });

  it('system role is locked: update / grant / remove → 422 SYSTEM_ROLE_LOCKED, nothing committed', async () => {
    const h = harness(ALL, (sql) => (sql.includes('FOR UPDATE') && sql.includes('iam_roles') ? [{ id: ROLE, isSystem: true, isActive: true }] : undefined));
    for (const r of [
      await h.send('patch', `/iam/admin/roles/${ROLE}`, { isActive: false }),
      await h.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM }),
      await h.send('delete', `/iam/admin/roles/${ROLE}/permissions/${PERM}`),
    ]) expect([r.status, r.body.error.code]).toEqual([422, 'SYSTEM_ROLE_LOCKED']);
    expect(h.committed).toEqual([]);
  });

  it('duplicate role → permission is 409 (not a silent 404); unknown role / permission 404; inactive role cannot be assigned', async () => {
    const dup = harness(ALL, (sql) => {
      if (sql.includes('FOR UPDATE') && sql.includes('iam_roles')) return [{ id: ROLE, isSystem: false, isActive: true }];
      if (sql.includes('SELECT 1 AS ok FROM iam.iam_permissions')) return [{ ok: 1 }];
      if (sql.startsWith('INSERT INTO iam.iam_role_permissions')) throw pgError('23505');
      return undefined;
    });
    expect((await dup.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM })).status).toBe(409);
    const missing = harness(ALL);
    expect((await missing.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM })).status).toBe(404);
    const inactive = harness(ALL, (sql) => (sql.includes('FOR UPDATE') && sql.includes('iam_roles') ? [{ id: ROLE, isSystem: false, isActive: false }] : undefined));
    const r = await inactive.send('post', `/iam/admin/accounts/${TARGET}/roles`, { roleId: ROLE });
    expect([r.status, r.body.error.code]).toEqual([422, 'ROLE_INACTIVE']);
  });

  it('revoke sets revoked_at once: second revoke → 409 ALREADY_REVOKED; unknown assignment 404', async () => {
    let revoked = false;
    const h = harness(ALL, (sql) => {
      if (sql.includes('SELECT (revoked_at IS NOT NULL) AS revoked FROM iam.iam_user_permissions')) return [{ revoked }];
      if (sql.startsWith('UPDATE iam.iam_user_permissions SET revoked_at')) { revoked = true; return [{ id: ASSIGN, permissionId: PERM }]; }
      return undefined;
    });
    expect((await h.send('post', `/iam/admin/accounts/${TARGET}/permissions/${ASSIGN}/revoke`)).status).toBe(200);
    const again = await h.send('post', `/iam/admin/accounts/${TARGET}/permissions/${ASSIGN}/revoke`);
    expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_REVOKED']);
    expect((await harness(ALL).send('post', `/iam/admin/accounts/${TARGET}/roles/${ASSIGN}/revoke`)).status).toBe(404);
  });

  it('direct grant: expiry in the past → 422; DENY / ALLOW stored with the actor as assigned_by', async () => {
    const h = harness(ALL, (sql) => (sql.startsWith('INSERT INTO iam.iam_user_permissions') ? [{ id: ASSIGN, permissionId: PERM, effect: 'DENY' }] : undefined));
    const past = await h.send('post', `/iam/admin/accounts/${TARGET}/permissions`, { permissionId: PERM, effect: 'ALLOW', reason: 'x', expiresAt: '2020-01-01T00:00:00Z' });
    expect([past.status, past.body.error.code]).toEqual([422, 'EXPIRY_INVALID']);
    const deny = await h.send('post', `/iam/admin/accounts/${TARGET}/permissions`, { permissionId: PERM, effect: 'DENY', reason: 'chặn' });
    expect(deny.status).toBe(201);
    const insert = h.committed.find((w) => w.sql.startsWith('INSERT INTO iam.iam_user_permissions'));
    expect(insert?.params.slice(0, 5)).toEqual([TARGET, PERM, 'DENY', 'chặn', ADMIN]);
  });
});

describe('IAM admin — effective permissions of another account (IAM-12)', () => {
  it('evaluated with each permission\'s minimum assurance as stated assumption — never the viewer\'s session assurance', async () => {
    const ok = harness(ALL, (sql) => (sql.includes('FROM iam.iam_permissions ORDER BY')
      ? [{ permissionId: PERM, permissionCode: 'system_test.diagnostics.read', moduleCode: 'SYSTEM_TEST', resourceCode: 'DIAGNOSTICS', operation: 'READ', minimumAssuranceLevel: 1 }]
      : undefined));
    const e = await ok.get(`/iam/admin/accounts/${TARGET}/permissions`);
    expect(e.body).toMatchObject({ assumption: 'TARGET_SESSION_MEETS_MINIMUM_ASSURANCE', effective: [{ permissionCode: 'system_test.diagnostics.read', allowed: true, assumedAssuranceLevel: 1 }] });
  });
});

describe('IAM admin — permission catalog creation bound to MIC-07 (IAM-09)', () => {
  const mic = { mic07IamMapping: [{ functionKey: 'REPORT', actionKey: 'READ', moduleCode: 'SALES', resourceCode: 'REPORT', operation: 'READ', minimumAssuranceLevel: 1 }] };
  const active = (hash = canonicalDigest(mic).sha256, existing: unknown[] = []): Handler => (sql) => {
    if (sql.includes('v.manifest_json AS manifest')) return [{ manifest: mic, hash }];
    if (sql.startsWith('SELECT permission_id FROM iam.iam_permissions WHERE module_code')) return existing;
    if (sql.startsWith('INSERT INTO iam.iam_permissions')) return [{ id: PERM, permissionCode: 'sales.report.read' }];
    return undefined;
  };
  const body = { permissionCode: 'sales.report.read', moduleCode: 'SALES', resourceCode: 'REPORT', operation: 'READ', minimumAssuranceLevel: 1 };

  it('creates exactly the MIC-07 triple of an ACTIVE, hash-intact MIC (+ audit, one transaction, triple lock)', async () => {
    const h = harness(ALL, active());
    const r = await h.send('post', '/iam/admin/permissions', body);
    expect([r.status, r.body.permission.permissionCode]).toEqual([201, 'sales.report.read']);
    expect(h.queries.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(h.audits()).toHaveLength(1);
  });

  it('refuses IAM / FOUNDATION codes, a tampered hash, a mapping not in MIC-07, an existing triple', async () => {
    for (const [handler, payload, status, code] of [
      [active(), { ...body, moduleCode: 'IAM' }, 422, 'BINDING_INVALID'],
      [active('0'.repeat(64)), body, 422, 'BINDING_INVALID'],
      [active(), { ...body, operation: 'EXPORT' }, 422, 'BINDING_INVALID'],
      [active(), { ...body, minimumAssuranceLevel: 2 }, 422, 'BINDING_INVALID'],
      [active(undefined, [{ permission_id: PERM }]), body, 409, 'PERMISSION_TRIPLE_EXISTS'],
    ] as const) {
      const h = harness(ALL, handler);
      const r = await h.send('post', '/iam/admin/permissions', payload);
      expect([r.status, r.body.error.code]).toEqual([status, code]);
      expect(h.committed).toEqual([]);
    }
  });
});

describe('IAM admin — Navigation adapter (NAV-01 / NAV-02, read only)', () => {
  it('B09 list and ACTIVE modules / functions need foundation.navigation.manage; the adapter never writes', async () => {
    const h = harness(['foundation.navigation.manage'], (sql) => {
      if (sql.includes('FROM foundation.fnd_navigation_items n')) return [{ navigationId: ASSIGN, menuTitle: 'Test System' }];
      if (sql.includes('v.status=\'ACTIVE\'') && sql.includes('"activeVersion"')) return [{ moduleId: ROLE, moduleKey: 'SYSTEM_TEST', activeVersion: '1.0.3' }];
      return undefined;
    });
    expect((await h.get('/iam/admin/foundation/navigation/items')).body.items).toEqual([{ navigationId: ASSIGN, menuTitle: 'Test System' }]);
    expect((await h.get('/iam/admin/foundation/modules')).body.modules[0]).toMatchObject({ moduleKey: 'SYSTEM_TEST', activeVersion: '1.0.3' });
    expect((await h.get(`/iam/admin/foundation/modules/${ROLE}/functions`)).status).toBe(200);
    expect(h.committed).toEqual([]);
    expect((await harness(['iam.accounts.read']).get('/iam/admin/foundation/navigation/items')).status).toBe(403);
  });
});
