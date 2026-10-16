import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import { evaluateAccess } from '../../../src/modules/foundation/foundation.permissions.js';
import type { AccessFacts } from '../../../src/modules/foundation/foundation.permissions.js';
import {
  ACCOUNT_A, PERM_CREATE_ID, PERM_READ_ID, TEST_ORIGIN, VALID_DIRECT_ALLOW, VALID_DIRECT_DENY, VALID_ROLE, buildHarness, defaultIam, pgError, token,
} from './fakes.js';
import type { GrantRow, Harness } from './fakes.js';

// FBE-01A — Foundation Module Registry, T01–T18. Mock/unit only: FakeDb + FakeAuth, no PostgreSQL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = token('validSessionToken');
const ALL_SQL = new Set<string>(Object.values(FOUNDATION_SQL));
const VALID_BODY = { moduleKey: 'SALES_ORDER', moduleName: 'Đơn hàng bán', moduleType: 'INTERNAL', description: 'Quản lý đơn hàng' };

// B08 parameter positions of FOUNDATION_SQL.insertAudit.
const A = { eventId: 0, moduleId: 1, actor: 2, action: 3, targetType: 4, targetId: 5, outcome: 6, correlation: 7, source: 8, metadata: 9 } as const;

function harness(grants: { permissionId: string; row: GrantRow }[] = []): Harness {
  const iam = defaultIam();
  iam.grants = grants.map((g) => ({ accountId: ACCOUNT_A, ...g }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return h;
}

const get = (h: Harness, tokenValue: string | null = TOKEN) => {
  const r = request(h.app).get('/api/foundation/modules');
  return tokenValue === null ? r : r.set('Cookie', `talo_sid=${tokenValue}`);
};

const post = (h: Harness, body: unknown, tokenValue: string | null = TOKEN) => {
  const r = request(h.app).post('/api/foundation/modules').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');
  return (tokenValue === null ? r : r.set('Cookie', `talo_sid=${tokenValue}`)).send(JSON.stringify(body));
};

const writes = (h: Harness) => h.db.statements.filter((s) => s.sql === FOUNDATION_SQL.insertModule || s.sql === FOUNDATION_SQL.insertModuleEvent || s.sql === FOUNDATION_SQL.insertAudit);

const readAndCreate = [{ permissionId: PERM_READ_ID, row: VALID_ROLE }, { permissionId: PERM_CREATE_ID, row: VALID_ROLE }];

describe('FBE-01A authentication (session via AuthService.describeSession only)', () => {
  it('T01 GET without session → 401 SESSION_INVALID, no IAM read, no Foundation audit', async () => {
    const h = harness(readAndCreate);
    const res = await get(h, null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_INVALID');
    expect(res.body.error.requestId).toMatch(UUID);
    expect(h.auth.calls).toBe(1);
    expect(h.db.statements).toHaveLength(0);
    const p = await post(h, VALID_BODY, null);
    expect(p.status).toBe(401);
    expect(h.db.statements).toHaveLength(0);
  });

  it('T02 activation session → 403 PASSWORD_CHANGE_REQUIRED, no IAM read, no audit', async () => {
    const h = harness(readAndCreate);
    const activation = token('activationToken');
    h.auth.activation(activation);
    for (const res of [await get(h, activation), await post(h, VALID_BODY, activation)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect(res.body.error.message).toBe('Bạn cần đổi mật khẩu trước khi tiếp tục.');
    }
    expect(h.db.statements).toHaveLength(0);
  });

  it('T17 invalid / malformed session → 401 and the session cookie is cleared', async () => {
    const h = harness(readAndCreate);
    for (const bad of [token('unknownButWellFormed'), 'short', 'x'.repeat(44)]) {
      const res = await get(h, bad);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
      const cookies = String(res.headers['set-cookie']);
      expect(cookies).toContain('talo_sid=;');
      expect(cookies).toContain('Max-Age=0');
      expect(cookies).toContain('HttpOnly');
    }
    expect(h.db.statements).toHaveLength(0);
  });
});

describe('FBE-01A authorisation (effective permission) and DENIED audit', () => {
  it('T03 GET without READ → 403 FORBIDDEN + one B08 DENIED row (MODULE_REGISTRY.READ)', async () => {
    const h = harness([{ permissionId: PERM_CREATE_ID, row: VALID_ROLE }]);
    const res = await get(h);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.modules).toBeUndefined();
    expect(h.db.state.audits).toHaveLength(1);
    const a = h.db.state.audits[0] ?? [];
    expect(a[A.eventId]).toMatch(UUID);
    expect(a[A.moduleId]).toBeNull();
    expect(a[A.actor]).toBe(ACCOUNT_A);
    expect(a[A.action]).toBe('MODULE_REGISTRY.READ');
    expect(a[A.targetType]).toBe('MODULE_REGISTRY');
    expect(a[A.targetId]).toBeNull();
    expect(a[A.outcome]).toBe('DENIED');
    expect(a[A.correlation]).toBe(res.body.error.requestId);
    expect(a[A.source]).toBe('talo-mos-backend');
    expect(JSON.parse(String(a[A.metadata]))).toEqual({ v: 1, reason: 'NO_VALID_ALLOW', requestId: res.body.error.requestId });
    // DENIED audit is written outside any transaction; nothing else is written.
    expect(writes(h).map((s) => [s.sql === FOUNDATION_SQL.insertAudit, s.inTransaction])).toEqual([[true, false]]);
    expect(h.db.txLog).toEqual([]);
    expect(h.db.statements.some((s) => s.sql === FOUNDATION_SQL.listModules)).toBe(false);
  });

  it('T04 POST without CREATE → 403 + B08 DENIED (MODULE_REGISTRY.CREATE); body is not validated, nothing inserted', async () => {
    const h = harness([{ permissionId: PERM_READ_ID, row: VALID_ROLE }]);
    for (const body of [VALID_BODY, { moduleKey: 'bad key' }]) {
      const res = await post(h, body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(h.db.state.audits).toHaveLength(2);
    for (const a of h.db.state.audits) {
      expect(a[A.action]).toBe('MODULE_REGISTRY.CREATE');
      expect(a[A.outcome]).toBe('DENIED');
      expect(a[A.targetType]).toBe('MODULE_REGISTRY');
      expect(a[A.targetId]).toBeNull();
    }
    expect(h.db.state.modules).toHaveLength(0);
    expect(h.db.state.events).toHaveLength(0);
    expect(h.db.txLog).toEqual([]);
  });

  it('T05 Role ALLOW → allowed (200, no audit for a successful read)', async () => {
    const h = harness([{ permissionId: PERM_READ_ID, row: VALID_ROLE }]);
    const res = await get(h);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modules: [] });
    expect(h.db.state.audits).toHaveLength(0);
  });

  it('T06 Direct DENY overrides Role ALLOW (and Direct ALLOW)', async () => {
    const h = harness([
      { permissionId: PERM_READ_ID, row: VALID_ROLE }, { permissionId: PERM_READ_ID, row: VALID_DIRECT_ALLOW }, { permissionId: PERM_READ_ID, row: VALID_DIRECT_DENY },
    ]);
    const res = await get(h);
    expect(res.status).toBe(403);
    expect(JSON.parse(String(h.db.state.audits[0]?.[A.metadata])).reason).toBe('DIRECT_DENY');
  });

  it('T07 Direct ALLOW without any role → allowed', async () => {
    const h = harness([{ permissionId: PERM_READ_ID, row: VALID_DIRECT_ALLOW }]);
    expect((await get(h)).status).toBe(200);
  });

  it('T08 revoked / not started / expired grants, inactive role, ineligible account, undefined permission → denied', async () => {
    const cases: { name: string; grants: { permissionId: string; row: GrantRow }[]; mutate?: (h: Harness) => void; reason: string }[] = [
      { name: 'role assignment revoked', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_ROLE, not_revoked: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'role inactive', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_ROLE, role_active: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'role assignment in the future', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_ROLE, started: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'direct ALLOW revoked', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_DIRECT_ALLOW, not_revoked: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'direct ALLOW expired', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_DIRECT_ALLOW, not_expired: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'direct ALLOW not started', grants: [{ permissionId: PERM_READ_ID, row: { ...VALID_DIRECT_ALLOW, started: false } }], reason: 'NO_VALID_ALLOW' },
      { name: 'account LOCKED', grants: [{ permissionId: PERM_READ_ID, row: VALID_ROLE }], mutate: (h) => h.db.iam.accounts.set(ACCOUNT_A, { account_status: 'LOCKED', not_disabled: true }), reason: 'ACCOUNT_NOT_ELIGIBLE' },
      { name: 'account disabled_at set', grants: [{ permissionId: PERM_READ_ID, row: VALID_ROLE }], mutate: (h) => h.db.iam.accounts.set(ACCOUNT_A, { account_status: 'ACTIVE', not_disabled: false }), reason: 'ACCOUNT_NOT_ELIGIBLE' },
      { name: 'account row missing', grants: [{ permissionId: PERM_READ_ID, row: VALID_ROLE }], mutate: (h) => h.db.iam.accounts.clear(), reason: 'ACCOUNT_NOT_ELIGIBLE' },
      { name: 'permission not defined (no admin bypass)', grants: [{ permissionId: PERM_READ_ID, row: VALID_ROLE }], mutate: (h) => { h.db.iam.permissions = h.db.iam.permissions.filter((p) => p.permission_id !== PERM_READ_ID); }, reason: 'PERMISSION_NOT_DEFINED' },
      { name: 'no grant at all', grants: [], reason: 'NO_VALID_ALLOW' },
    ];
    for (const c of cases) {
      const h = harness(c.grants);
      c.mutate?.(h);
      const res = await get(h);
      expect(res.status, c.name).toBe(403);
      expect(JSON.parse(String(h.db.state.audits[0]?.[A.metadata])).reason, c.name).toBe(c.reason);
    }
    // An invalid (expired / revoked) DENY does not block a valid ALLOW.
    for (const deny of [{ ...VALID_DIRECT_DENY, not_expired: false }, { ...VALID_DIRECT_DENY, not_revoked: false }]) {
      const h = harness([{ permissionId: PERM_READ_ID, row: VALID_ROLE }, { permissionId: PERM_READ_ID, row: deny }]);
      expect((await get(h)).status).toBe(200);
    }
  });

  it('T09 insufficient assurance (permission minimum 2, session 1) → denied', async () => {
    const h = harness([{ permissionId: PERM_READ_ID, row: VALID_ROLE }]);
    h.db.iam.permissions = h.db.iam.permissions.map((p) => (p.permission_id === PERM_READ_ID ? { ...p, minimum_assurance_level: 2 } : p));
    const res = await get(h);
    expect(res.status).toBe(403);
    expect(JSON.parse(String(h.db.state.audits[0]?.[A.metadata])).reason).toBe('ASSURANCE_INSUFFICIENT');
  });

  it('evaluateAccess: deny on ambiguous definitions, DENY > ALLOW, assurance compared to minimum', () => {
    const base: AccessFacts = {
      permissions: [{ permissionId: PERM_READ_ID, minimumAssuranceLevel: 1 }], account: { accountStatus: 'ACTIVE', notDisabled: true },
      grants: [{ source: 'ROLE', effect: 'ALLOW', roleActive: true, notRevoked: true, started: true, notExpired: true }],
    };
    expect(evaluateAccess(base, 1)).toEqual({ allowed: true });
    expect(evaluateAccess(base, 0)).toEqual({ allowed: false, reason: 'ASSURANCE_INSUFFICIENT' });
    expect(evaluateAccess({ ...base, permissions: [...base.permissions, { permissionId: PERM_CREATE_ID, minimumAssuranceLevel: 1 }] }, 1))
      .toEqual({ allowed: false, reason: 'PERMISSION_AMBIGUOUS' });
    expect(evaluateAccess({ ...base, grants: [{ source: 'DIRECT', effect: 'UNKNOWN', roleActive: true, notRevoked: true, started: true, notExpired: true }] }, 1))
      .toEqual({ allowed: false, reason: 'NO_VALID_ALLOW' });
  });

  it('T15 DENIED-audit write fails → still denied, answered 503 SERVICE_BUSY (never silently skipped, never allowed)', async () => {
    const h = harness([]);
    h.db.failOn.set(FOUNDATION_SQL.insertAudit, pgError('42501'));
    for (const res of [await get(h), await post(h, VALID_BODY)]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_BUSY');
      expect(res.body.modules).toBeUndefined();
      expect(res.body.module).toBeUndefined();
    }
    expect(h.db.statements.filter((s) => s.sql === FOUNDATION_SQL.insertAudit)).toHaveLength(2);
    expect(h.db.state.modules).toHaveLength(0);
    expect(h.logs.some((l) => l.includes('DENIED audit write failed') && l.includes('42501'))).toBe(true);
  });

  it('permission lookup failure fails closed → 503, never allowed, no data', async () => {
    const h = harness(readAndCreate);
    h.db.failOn.set(FOUNDATION_SQL.grantFacts, pgError('42501'));
    const res = await get(h);
    expect(res.status).toBe(503);
    expect(h.db.statements.some((s) => s.sql === FOUNDATION_SQL.listModules)).toBe(false);
  });
});

describe('FBE-01A POST /api/foundation/modules (B01 + B07 + B08 in one transaction)', () => {
  it('T10 valid POST → 201, module disabled, actor from session, B01/B07/B08 committed together', async () => {
    const h = harness(readAndCreate);
    const res = await post(h, VALID_BODY);
    expect(res.status).toBe(201);
    const m = res.body.module;
    expect(m.moduleId).toMatch(UUID);
    expect(m).toMatchObject({ moduleKey: 'SALES_ORDER', moduleName: 'Đơn hàng bán', moduleType: 'INTERNAL', description: 'Quản lý đơn hàng', isEnabled: false, createdByAccountId: ACCOUNT_A });
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT']);
    // Order and transaction membership: INSERT B01 → INSERT B07 → INSERT B08, all inside the transaction.
    expect(writes(h).map((s) => [s.sql, s.inTransaction])).toEqual([
      [FOUNDATION_SQL.insertModule, true], [FOUNDATION_SQL.insertModuleEvent, true], [FOUNDATION_SQL.insertAudit, true],
    ]);
    expect(h.db.statements.find((s) => s.sql === FOUNDATION_SQL.insertModule)?.params).toEqual(['SALES_ORDER', 'Đơn hàng bán', 'Quản lý đơn hàng', 'INTERNAL', ACCOUNT_A]);
    const [event] = h.db.state.events;
    expect(event?.[0]).toBe(m.moduleId);
    expect(event?.[1]).toBe(ACCOUNT_A);
    expect(JSON.parse(String(event?.[2]))).toMatchObject({ module_id: m.moduleId, module_key: 'SALES_ORDER', is_enabled: false });
    expect(FOUNDATION_SQL.insertModuleEvent).toContain("'REGISTER'");
    const [audit] = h.db.state.audits;
    expect(audit?.[A.action]).toBe('MODULE_REGISTRY.CREATE');
    expect(audit?.[A.outcome]).toBe('SUCCESS');
    expect(audit?.[A.targetType]).toBe('MODULE');
    expect(audit?.[A.targetId]).toBe(m.moduleId);
    expect(audit?.[A.moduleId]).toBe(m.moduleId);
    expect(audit?.[A.eventId]).toMatch(UUID);
    expect(audit?.[A.source]).toBe('talo-mos-backend');
    // Audit/event INSERTs carry no RETURNING; B08 session_id and version_id are NULL literals.
    expect(FOUNDATION_SQL.insertModuleEvent).not.toMatch(/RETURNING/i);
    expect(FOUNDATION_SQL.insertAudit).not.toMatch(/RETURNING/i);
    expect(FOUNDATION_SQL.insertModule).toMatch(/VALUES \(\$1, \$2, \$3, \$4, false, \$5::uuid\)/);
  });

  it('T11 duplicate moduleKey → 409 MODULE_KEY_EXISTS, rolled back, no extra event/audit', async () => {
    const h = harness(readAndCreate);
    expect((await post(h, VALID_BODY)).status).toBe(201);
    const res = await post(h, { ...VALID_BODY, moduleName: 'Khác' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MODULE_KEY_EXISTS');
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
    expect(h.db.state.modules).toHaveLength(1);
    expect(h.db.state.events).toHaveLength(1);
    expect(h.db.state.audits).toHaveLength(1);
  });

  it('T12 invalid identifier / type / fields → 400 VALIDATION_ERROR, nothing written', async () => {
    const h = harness(readAndCreate);
    const bad: unknown[] = [
      { ...VALID_BODY, moduleKey: 'sales_order' }, { ...VALID_BODY, moduleKey: '1SALES' }, { ...VALID_BODY, moduleKey: 'SALES-ORDER' },
      { ...VALID_BODY, moduleKey: '' }, { ...VALID_BODY, moduleKey: `A${'B'.repeat(80)}` }, { ...VALID_BODY, moduleKey: "X'; DROP TABLE x; --" },
      { ...VALID_BODY, moduleType: 'PLUGIN' }, { ...VALID_BODY, moduleType: 'internal' }, { ...VALID_BODY, moduleName: '   ' }, { ...VALID_BODY, moduleName: 'n'.repeat(151) },
      { moduleKey: 'SALES_ORDER', moduleType: 'INTERNAL' }, { ...VALID_BODY, moduleKey: 7 },
      { ...VALID_BODY, moduleId: '30000000-0000-4000-8000-000000000003' }, { ...VALID_BODY, isEnabled: true }, { ...VALID_BODY, createdAt: '2020-01-01T00:00:00Z' },
      { ...VALID_BODY, createdByAccountId: ACCOUNT_A }, [VALID_BODY],
    ];
    for (const body of bad) {
      const res = await post(h, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details.fields)).toBe(true);
    }
    expect(writes(h)).toHaveLength(0);
    expect(h.db.txLog).toEqual([]);
    const typeError = await post(h, { ...VALID_BODY, moduleType: 'PLUGIN', isEnabled: true });
    expect(typeError.body.error.details.fields).toEqual(['UNKNOWN_FIELD', 'moduleType']);
  });

  it('T13 B07 insert fails → B01 rolled back (503, nothing committed)', async () => {
    const h = harness(readAndCreate);
    h.db.failOn.set(FOUNDATION_SQL.insertModuleEvent, pgError('23514'));
    const res = await post(h, VALID_BODY);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_BUSY');
    expect(writes(h).map((s) => [s.sql, s.inTransaction])).toEqual([[FOUNDATION_SQL.insertModule, true], [FOUNDATION_SQL.insertModuleEvent, true]]);
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(h.db.state.modules).toHaveLength(0);
    expect(h.db.state.events).toHaveLength(0);
    expect(h.db.state.audits).toHaveLength(0);
  });

  it('T14 B08 insert fails → B01 and B07 rolled back', async () => {
    const h = harness(readAndCreate);
    h.db.failOn.set(FOUNDATION_SQL.insertAudit, pgError('23505'));
    const res = await post(h, VALID_BODY);
    // A 23505 on B08 is not a duplicate module key: it is a rolled-back failure (503), not a 409.
    expect(res.status).toBe(503);
    expect(writes(h).map((s) => s.sql)).toEqual([FOUNDATION_SQL.insertModule, FOUNDATION_SQL.insertModuleEvent, FOUNDATION_SQL.insertAudit]);
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(h.db.state.modules).toHaveLength(0);
    expect(h.db.state.events).toHaveLength(0);
    expect(h.db.state.audits).toHaveLength(0);
    expect(h.logs.some((l) => l.includes('register module failed (rolled back)'))).toBe(true);
  });

  it('T16 GET after POST returns the committed modules (mock state), ordered by moduleKey', async () => {
    const h = harness(readAndCreate);
    expect((await post(h, { moduleKey: 'WAREHOUSE', moduleName: 'Kho', moduleType: 'EXTERNAL' })).status).toBe(201);
    expect((await post(h, VALID_BODY)).status).toBe(201);
    const res = await get(h);
    expect(res.status).toBe(200);
    expect(res.body.modules.map((m: { moduleKey: string }) => m.moduleKey)).toEqual(['SALES_ORDER', 'WAREHOUSE']);
    expect(res.body.modules[1]).toMatchObject({ moduleType: 'EXTERNAL', description: null, isEnabled: false });
    expect(Object.keys(res.body.modules[0]).sort()).toEqual(
      ['createdAt', 'createdByAccountId', 'description', 'isEnabled', 'moduleId', 'moduleKey', 'moduleName', 'moduleType', 'updatedAt'],
    );
  });

  it('every statement is a fixed FOUNDATION_SQL constant; client values only travel as parameters; IAM is only read', async () => {
    const h = harness(readAndCreate);
    await post(h, { ...VALID_BODY, moduleKey: 'INJECT_TEST', moduleName: "x'); DELETE FROM iam.iam_roles; --", description: '$1 ${x}' });
    await get(h);
    expect(h.db.statements.length).toBeGreaterThan(0);
    for (const s of h.db.statements) expect(ALL_SQL.has(s.sql)).toBe(true);
    for (const sql of Object.values(FOUNDATION_SQL)) {
      expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+iam\./i);
      expect(sql).not.toMatch(/\b(GRANT|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    }
  });
});

describe('FBE-01A T18 existing contracts unchanged', () => {
  it('health contract is identical with the Foundation router mounted; other /api routes pass through', async () => {
    const passthrough = express.Router();
    passthrough.get('/auth/session', (_req, res) => { res.status(200).json({ marker: 'auth-router-reached' }); });
    const h = buildHarness({ extraRouters: [passthrough] });
    const health = await request(h.app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', service: 'talo-mos-backend' });
    const auth = await request(h.app).get('/api/auth/session');
    expect(auth.body).toEqual({ marker: 'auth-router-reached' });
    expect(h.auth.calls).toBe(0);
    const unknown = await request(h.app).get('/api/foundation/unknown');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    const method = await request(h.app).delete('/api/foundation/modules').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');
    expect(method.status).toBe(404);
  });
});
