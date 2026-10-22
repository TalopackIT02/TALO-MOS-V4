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
const PLATFORM_PERM = '50000000-0000-4000-8000-0000000000aa'; // an IAM / FOUNDATION permission
const cookie = `talo_sid=${token('iam')}`;

type Handler = (sql: string, params: readonly unknown[]) => unknown[] | undefined;

function harness(granted: readonly string[], script: Handler = () => undefined, options: { failAudit?: boolean; failLookup?: boolean; rootAccountId?: string } = {}) {
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
    const scripted = script(sql, params);
    if (scripted !== undefined) return scripted;
    // Default: every permission is a business permission except PLATFORM_PERM.
    if (sql.startsWith('SELECT module_code AS "moduleCode" FROM iam.iam_permissions')) return [{ moduleCode: params[0] === PLATFORM_PERM ? 'IAM' : 'SYSTEM_TEST' }];
    return [];
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
    apiRouters: [iamAdminRouter({ db, authService: auth, secureCookie: false, rootAccountId: options.rootAccountId ?? null })],
  });
  const send = (method: 'post' | 'patch' | 'delete', url: string, body: unknown = {}) =>
    request(app)[method](`/api${url}`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const get = (url: string, as = cookie) => request(app).get(`/api${url}`).set('Cookie', as);
  const audits = () => committed.filter((w) => w.sql.includes('iam_audit_logs'));
  // Data writes only (a refusal by a protection rule leaves one audit FAILURE row and no data change).
  const dataWrites = () => committed.filter((w) => !w.sql.includes('iam_audit_logs'));
  const failures = () => audits().filter((w) => w.params.includes('FAILURE')).map((w) => JSON.parse(String(w.params[4])).reason);
  return { app, send, get, committed, queries, audits, dataWrites, failures };
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
      if (sql.includes('LIMIT $4 OFFSET $5')) { seen.push(params); return []; }
      return undefined;
    });
    const r = await h.get('/iam/admin/accounts?search=50%25_x&page=3&pageSize=10');
    expect(r.status).toBe(200);
    expect(seen[1]).toEqual(['50%_x', '%50\\%\\_x%', null, 10, 20]);
  });

  it('duplicate (23505) → 409 DUPLICATE; FK (23503) → 404; missing DB privilege (42501) → 503 IAM_DB_PRIVILEGE_MISSING — and NOTHING committed', async () => {
    for (const [state, status, code] of [['23505', 409, 'DUPLICATE'], ['23503', 404, 'NOT_FOUND'], ['42501', 503, 'IAM_DB_PRIVILEGE_MISSING']] as const) {
      const h = harness(ALL, (sql) => {
        if (sql.includes('FOR UPDATE OF r')) return [{ id: ROLE, isSystem: false, isActive: true, platform: false, heldByActor: false }];
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
    const h = harness(ALL, (sql) => (sql.includes('FOR UPDATE') && sql.includes('iam_roles') ? [{ id: ROLE, isSystem: true, isActive: true, platform: false, heldByActor: false }] : undefined));
    for (const r of [
      await h.send('patch', `/iam/admin/roles/${ROLE}`, { isActive: false }),
      await h.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM }),
      await h.send('delete', `/iam/admin/roles/${ROLE}/permissions/${PERM}`),
    ]) expect([r.status, r.body.error.code]).toEqual([422, 'SYSTEM_ROLE_LOCKED']);
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures()).toEqual(["SYSTEM_ROLE_LOCKED", "SYSTEM_ROLE_LOCKED", "SYSTEM_ROLE_LOCKED"]);
  });

  it('duplicate role → permission is 409 (not a silent 404); unknown role / permission 404; inactive role cannot be assigned', async () => {
    const dup = harness(ALL, (sql) => {
      if (sql.includes('FOR UPDATE') && sql.includes('iam_roles')) return [{ id: ROLE, isSystem: false, isActive: true, platform: false, heldByActor: false }];
      if (sql.startsWith('INSERT INTO iam.iam_role_permissions')) throw pgError('23505');
      return undefined;
    });
    expect((await dup.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM })).status).toBe(409);
    const missing = harness(ALL, (sql) => (sql.startsWith('SELECT module_code AS "moduleCode"') ? [] : undefined));
    expect((await missing.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM })).status).toBe(404);
    const inactive = harness(ALL, (sql) => (sql.includes('FOR UPDATE') && sql.includes('iam_roles') ? [{ id: ROLE, isSystem: false, isActive: false, platform: false, heldByActor: false }] : undefined));
    const r = await inactive.send('post', `/iam/admin/accounts/${TARGET}/roles`, { roleId: ROLE });
    expect([r.status, r.body.error.code]).toEqual([422, 'ROLE_INACTIVE']);
  });

  it('revoke sets revoked_at once: second revoke → 409 ALREADY_REVOKED; unknown assignment 404', async () => {
    let revoked = false;
    const h = harness(ALL, (sql) => {
      if (sql.includes('SELECT (revoked_at IS NOT NULL) AS revoked, permission_id::text AS "permissionId" FROM iam.iam_user_permissions')) return [{ revoked, permissionId: PERM }];
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

describe('IAM admin — anti-escalation: platform administration is bootstrap-only (issue 1)', () => {
  const role = (over: Record<string, boolean>) => (sql: string): unknown[] | undefined =>
    (sql.includes('FOR UPDATE OF r') ? [{ id: ROLE, isSystem: false, isActive: true, platform: false, heldByActor: false, ...over }] : undefined);
  const expectLocked = async (res: { status: number; body: { error: { code: string } } }, code: string) => expect([res.status, res.body.error.code]).toEqual([422, code]);

  it('TALO_SYSTEM_ADMIN (system role) can be neither granted nor revoked through the API', async () => {
    const h = harness(ALL, (sql) => {
      if (sql.includes('FROM iam.iam_user_roles WHERE user_role_id')) return [{ revoked: false, roleId: ROLE }];
      return role({ isSystem: true })(sql);
    });
    await expectLocked(await h.send('post', `/iam/admin/accounts/${TARGET}/roles`, { roleId: ROLE }), 'SYSTEM_ROLE_LOCKED');
    await expectLocked(await h.send('post', `/iam/admin/accounts/${TARGET}/roles/${ASSIGN}/revoke`), 'SYSTEM_ROLE_LOCKED');
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures().length).toBeGreaterThan(0);
  });

  it('a custom role holding an IAM / FOUNDATION permission is locked like a system role', async () => {
    const h = harness(ALL, role({ platform: true }));
    await expectLocked(await h.send('post', `/iam/admin/accounts/${TARGET}/roles`, { roleId: ROLE }), 'PLATFORM_PERMISSION_LOCKED');
    await expectLocked(await h.send('patch', `/iam/admin/roles/${ROLE}`, { isActive: true }), 'PLATFORM_PERMISSION_LOCKED');
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures().length).toBeGreaterThan(0);
  });

  it('platform permissions: no role → permission, no Direct ALLOW, no Direct DENY (lock-out), no revoke via API', async () => {
    const h = harness(ALL, (sql) => {
      if (sql.includes('FROM iam.iam_user_permissions WHERE user_permission_id')) return [{ revoked: false, permissionId: PLATFORM_PERM }];
      return role({})(sql);
    });
    await expectLocked(await h.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PLATFORM_PERM }), 'PLATFORM_PERMISSION_LOCKED');
    for (const effect of ['ALLOW', 'DENY']) {
      await expectLocked(await h.send('post', `/iam/admin/accounts/${TARGET}/permissions`, { permissionId: PLATFORM_PERM, effect, reason: 'x' }), 'PLATFORM_PERMISSION_LOCKED');
    }
    await expectLocked(await h.send('post', `/iam/admin/accounts/${TARGET}/permissions/${ASSIGN}/revoke`), 'PLATFORM_PERMISSION_LOCKED');
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures().length).toBeGreaterThan(0);
  });

  it('no self-service: own roles / direct grants / revokes, widening a role the actor holds, re-activating it', async () => {
    const h = harness(ALL, role({ heldByActor: true, isActive: false }));
    for (const res of [
      await h.send('post', `/iam/admin/accounts/${ADMIN}/roles`, { roleId: ROLE }),
      await h.send('post', `/iam/admin/accounts/${ADMIN}/roles/${ASSIGN}/revoke`),
      await h.send('post', `/iam/admin/accounts/${ADMIN}/permissions`, { permissionId: PERM, effect: 'ALLOW', reason: 'x' }),
      await h.send('post', `/iam/admin/accounts/${ADMIN}/permissions/${ASSIGN}/revoke`),
      await h.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM }),
      await h.send('patch', `/iam/admin/roles/${ROLE}`, { isActive: true }),
    ]) await expectLocked(res, 'SELF_ASSIGNMENT_FORBIDDEN');
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures().length).toBeGreaterThan(0);
  });

  it('ordinary role management stays possible: business permission to a role the actor does not hold', async () => {
    const h = harness(ALL, (sql) => (sql.startsWith('INSERT INTO iam.iam_role_permissions') ? [{ id: ROLE, permissionId: PERM }] : role({})(sql)));
    expect((await h.send('post', `/iam/admin/roles/${ROLE}/permissions`, { permissionId: PERM })).status).toBe(201);
    expect(h.audits()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------- MASTER CONTRACT 2026-10-20
describe('IAM admin — capabilities of the session (admin menu / screen visibility)', () => {
  it('needs a session; answers each admin permission by evaluateAccess() for the actor itself; no audit, no data read', async () => {
    const h = harness(['foundation.module_registry.read', 'iam.accounts.read']);
    expect((await h.get('/iam/admin/me/capabilities', '')).status).toBe(401);
    const res = await h.get('/iam/admin/me/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.permissions).toMatchObject({
      'foundation.module_registry.read': true, 'iam.accounts.read': true, 'foundation.navigation.manage': false,
      'foundation.module_version.approve': false, 'iam.roles.manage': false, 'iam.assignments.manage': false,
    });
    expect(Object.keys(res.body.permissions)).toHaveLength(22); // 13 FOUNDATION + 4 IAM + 5 IAM Phase B
    expect(res.body.features).toEqual({ temporaryCredentials: 'DISABLED' });
    expect(h.audits()).toEqual([]);
    const none = harness([]);
    expect(Object.values((await none.get('/iam/admin/me/capabilities')).body.permissions).every((v) => v === false)).toBe(true);
    expect(none.audits()).toEqual([]);
  });
});

describe('IAM admin — account Field Search / filter / sort on the server (allowlist)', () => {
  it('field + status + sort map to fixed columns; values are bound; unknown field / sort → 400', async () => {
    const seen: string[] = [];
    const params: (readonly unknown[])[] = [];
    const h = harness(ALL, (sql, p) => {
      if (sql.includes('count(*)::int AS total')) return [{ total: 1 }];
      if (sql.includes('LIMIT $4 OFFSET $5')) { seen.push(sql); params.push(p); return []; }
      return undefined;
    });
    expect((await h.get('/iam/admin/accounts?search=an&field=fullName&status=ACTIVE&sort=employeeCode&dir=desc&page=2&pageSize=10')).status).toBe(200);
    expect(seen[0]).toContain('m.full_name ILIKE $2');
    expect(seen[0]).not.toContain('a.username ILIKE');
    expect(seen[0]).toContain('ORDER BY m.employee_code COLLATE "C" DESC');
    expect(params[0]).toEqual(['an', '%an%', 'ACTIVE', 10, 10]);
    for (const q of ['field=password_hash', 'sort=password', 'dir=up', 'status=active;drop']) {
      expect((await h.get(`/iam/admin/accounts?${q}`)).status).toBe(400);
    }
  });
});

describe('IAM admin — permission tree Module → Function → Action and effective sources', () => {
  it('groups declared actions under their function / module with the K05 permission; platform and unbound apart', async () => {
    const h = harness(ALL, (sql) => {
      if (sql.includes('FROM iam.iam_permissions ORDER BY')) return [
        { permissionId: PERM, permissionCode: 'system_test.diagnostics.read', moduleCode: 'SYSTEM_TEST', resourceCode: 'DIAGNOSTICS', operation: 'READ', minimumAssuranceLevel: 1, description: null },
        { permissionId: PLATFORM_PERM, permissionCode: 'iam.roles.manage', moduleCode: 'IAM', resourceCode: 'ROLES', operation: 'MANAGE', minimumAssuranceLevel: 1, description: null },
        { permissionId: ROLE, permissionCode: 'old.thing.read', moduleCode: 'OLD', resourceCode: 'THING', operation: 'READ', minimumAssuranceLevel: 1, description: null },
      ];
      if (sql.includes('action_spec->>\'name\'')) return [
        { moduleKey: 'SYSTEM_TEST', moduleName: 'System Test & Diagnostics', moduleDescription: null, isEnabled: true, moduleVersion: '1.0.3', functionKey: 'DIAGNOSTICS', functionName: 'Kiểm tra hệ thống', actionKey: 'READ', actionName: 'Xem chẩn đoán', actionDescription: null },
        { moduleKey: 'SYSTEM_TEST', moduleName: 'System Test & Diagnostics', moduleDescription: null, isEnabled: true, moduleVersion: '1.0.3', functionKey: 'TEST_RUNNER', functionName: 'Chạy test', actionKey: 'EXECUTE', actionName: 'Chạy', actionDescription: null },
      ];
      return undefined;
    });
    const res = await h.get('/iam/admin/permission-tree');
    expect(res.status).toBe(200);
    const t = res.body.tree;
    expect(t.modules.map((m: { moduleKey: string }) => m.moduleKey)).toEqual(['SYSTEM_TEST']);
    expect(t.modules[0].functions.map((f: { functionName: string; actions: { actionKey: string; permission: { permissionCode: string } | null }[] }) =>
      [f.functionName, f.actions.map((a) => [a.actionKey, a.permission?.permissionCode ?? null])])).toEqual([
      ['Kiểm tra hệ thống', [['READ', 'system_test.diagnostics.read']]], ['Chạy test', [['EXECUTE', null]]],
    ]);
    expect(t.platform.map((p: { permissionCode: string }) => p.permissionCode)).toEqual(['iam.roles.manage']);
    expect(t.unbound.map((p: { permissionCode: string }) => p.permissionCode)).toEqual(['old.thing.read']);
  });

  it('effective rows carry the valid grant sources (labels only — the decision is the evaluator\'s)', async () => {
    const h = harness(ALL, (sql) => (sql.includes('FROM iam.iam_permissions ORDER BY')
      ? [{ permissionId: PERM, permissionCode: 'system_test.diagnostics.read', moduleCode: 'SYSTEM_TEST', resourceCode: 'DIAGNOSTICS', operation: 'READ', minimumAssuranceLevel: 1, description: null }]
      : undefined));
    const e = await h.get(`/iam/admin/accounts/${TARGET}/permissions`);
    expect(e.body.effective[0]).toMatchObject({ permissionCode: 'system_test.diagnostics.read', allowed: true, sources: ['ROLE'], moduleCode: 'SYSTEM_TEST' });
  });
});

describe('IAM admin — root administrator protection (mutation layer, evaluator unchanged)', () => {
  const ROOT = TARGET;
  const OTHER = '30000000-0000-4000-8000-000000000003';
  const script = (sql: string, params: readonly unknown[]): unknown[] | undefined => {
    if (sql.includes('FROM iam.iam_user_roles WHERE user_role_id')) return [{ revoked: false, roleId: ROLE }];
    if (sql.includes('FOR UPDATE OF r')) return [{ id: ROLE, isSystem: true, isActive: true, platform: true, heldByActor: false }];
    if (sql.includes('FROM iam.iam_user_permissions WHERE user_permission_id')) return [{ revoked: false, permissionId: PLATFORM_PERM }];
    if (sql.startsWith('UPDATE iam.iam_user_roles SET revoked_at')) return [{ id: ASSIGN, roleId: ROLE }];
    if (sql.startsWith('UPDATE iam.iam_user_permissions SET revoked_at')) return [{ id: ASSIGN, permissionId: PLATFORM_PERM }];
    if (sql.includes('SELECT a.user_account_id::text AS "accountId"')) return [{ accountId: params[0], username: 'u', accountStatus: 'ACTIVE', disabled: false, employeeCode: 'E', fullName: 'F', membershipStatus: 'ACTIVE' }];
    return undefined;
  };

  it('root: TALO_SYSTEM_ADMIN revoke, platform Direct DENY / ALLOW and platform grant revoke → 422 ROOT_ADMIN_PROTECTED + audit FAILURE; nothing changed', async () => {
    const h = harness(ALL, script, { rootAccountId: ROOT });
    for (const r of [
      await h.send('post', `/iam/admin/accounts/${ROOT}/roles/${ASSIGN}/revoke`),
      await h.send('post', `/iam/admin/accounts/${ROOT}/permissions`, { permissionId: PLATFORM_PERM, effect: 'DENY', reason: 'x' }),
      await h.send('post', `/iam/admin/accounts/${ROOT}/permissions`, { permissionId: PLATFORM_PERM, effect: 'ALLOW', reason: 'x' }),
      await h.send('post', `/iam/admin/accounts/${ROOT}/permissions/${ASSIGN}/revoke`),
    ]) expect([r.status, r.body.error.code]).toEqual([422, 'ROOT_ADMIN_PROTECTED']);
    expect(h.dataWrites()).toEqual([]);
    expect(h.failures()).toEqual(['ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED']);
    expect((await h.get(`/iam/admin/accounts/${ROOT}`)).body.account.isRoot).toBe(true);
  });

  it('another account holding TALO_SYSTEM_ADMIN CAN be revoked (root configured); granting it stays locked; nobody becomes root via the API', async () => {
    const h = harness(ALL, script, { rootAccountId: ROOT });
    const revoke = await h.send('post', `/iam/admin/accounts/${OTHER}/roles/${ASSIGN}/revoke`);
    expect(revoke.status).toBe(200);
    expect((await h.send('post', `/iam/admin/accounts/${OTHER}/permissions/${ASSIGN}/revoke`)).status).toBe(200);
    expect(h.dataWrites().map((w) => w.sql.split(' SET ')[0])).toEqual(['UPDATE iam.iam_user_roles', 'UPDATE iam.iam_user_permissions']);
    const grant = await h.send('post', `/iam/admin/accounts/${OTHER}/roles`, { roleId: ROLE });
    expect([grant.status, grant.body.error.code]).toEqual([422, 'SYSTEM_ROLE_LOCKED']);
    expect((await h.get(`/iam/admin/accounts/${OTHER}`)).body.account.isRoot).toBe(false);
  });

  it('root not configured: the stricter rule — no system / platform revocation for anybody', async () => {
    const h = harness(ALL, script);
    const r = await h.send('post', `/iam/admin/accounts/${OTHER}/roles/${ASSIGN}/revoke`);
    expect([r.status, r.body.error.code]).toEqual([422, 'SYSTEM_ROLE_LOCKED']);
    expect(h.dataWrites()).toEqual([]);
  });
});
