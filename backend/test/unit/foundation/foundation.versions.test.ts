import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { compareSemVer, parseSemVer } from '../../../src/modules/foundation/foundation.versions.validation.js';
import {
  ACCOUNT_A, PERM_CREATE_ID, PERM_READ_ID, PERM_VCREATE_ID, PERM_VREAD_ID, TEST_ORIGIN, VALID_DIRECT_ALLOW, VALID_DIRECT_DENY, VALID_ROLE,
  buildHarness, defaultIam, pgError, seedModule, seedVersion, token,
} from './fakes.js';
import type { GrantRow, Harness } from './fakes.js';

// FBE-02A — Module Version DRAFT, V01–V15 + fail-closed cases. Mock/unit only: FakeDb + FakeAuth, no PostgreSQL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = token('versionSessionToken');
const ALL_SQL = new Set<string>([...Object.values(FOUNDATION_SQL), ...Object.values(VERSION_SQL)]);
const BODY = { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' };

// Parameter positions of VERSION_SQL.insertVersionAudit (B08 SUCCESS) and FOUNDATION_SQL.insertAudit (B08 DENIED).
const VA = { eventId: 0, moduleId: 1, versionId: 2, actor: 3, action: 4, targetType: 5, targetId: 6, outcome: 7, correlation: 8, source: 9, metadata: 10 } as const;
const A = { eventId: 0, moduleId: 1, actor: 2, action: 3, targetType: 4, targetId: 5, outcome: 6, correlation: 7, source: 8, metadata: 9 } as const;

const both = [{ permissionId: PERM_VREAD_ID, row: VALID_ROLE }, { permissionId: PERM_VCREATE_ID, row: VALID_ROLE }];

function harness(grants: { permissionId: string; row: GrantRow }[] = both): Harness {
  const iam = defaultIam();
  iam.grants = grants.map((g) => ({ accountId: ACCOUNT_A, ...g }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return h;
}

const base = (moduleId: string) => `/api/foundation/modules/${moduleId}/versions`;
const list = (h: Harness, moduleId: string, t: string | null = TOKEN) => {
  const r = request(h.app).get(base(moduleId));
  return t === null ? r : r.set('Cookie', `talo_sid=${t}`);
};
const detail = (h: Harness, moduleId: string, versionId: string, t: string | null = TOKEN) => {
  const r = request(h.app).get(`${base(moduleId)}/${versionId}`);
  return t === null ? r : r.set('Cookie', `talo_sid=${t}`);
};
const create = (h: Harness, moduleId: string, body: unknown, t: string | null = TOKEN) => {
  const r = request(h.app).post(base(moduleId)).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');
  return (t === null ? r : r.set('Cookie', `talo_sid=${t}`)).send(JSON.stringify(body));
};
const writes = (h: Harness) => h.db.statements.filter((s) => s.sql === VERSION_SQL.insertVersion || s.sql === VERSION_SQL.insertVersionAudit
  || s.sql === FOUNDATION_SQL.insertAudit || s.sql === FOUNDATION_SQL.insertModuleEvent || s.sql === FOUNDATION_SQL.insertModule);

describe('FBE-02A read (GET list / GET detail)', () => {
  it('V01 list returns only the versions of the module; detail returns the version of that module', async () => {
    const h = harness();
    const m1 = seedModule(h.db, 'SALES');
    const m2 = seedModule(h.db, 'STOCK');
    const v1 = seedVersion(h.db, m1.module_id, '1.0.0', 'REJECTED');
    const v2 = seedVersion(h.db, m1.module_id, '1.1.0');
    const other = seedVersion(h.db, m2.module_id, '2.0.0');
    const res = await list(h, m1.module_id);
    expect(res.status).toBe(200);
    expect(res.body.versions.map((v: { versionId: string }) => v.versionId)).toEqual([v1.version_id, v2.version_id]);
    expect(Object.keys(res.body.versions[0]).sort()).toEqual([
      'activatedAt', 'contractVersion', 'createdAt', 'manifestHash', 'manifestJson', 'moduleId', 'moduleVersion', 'reviewedAt', 'reviewedByAccountId',
      'status', 'submittedByAccountId', 'versionId',
    ]);
    const one = await detail(h, m1.module_id, v2.version_id);
    expect(one.status).toBe(200);
    expect(one.body.version).toMatchObject({ versionId: v2.version_id, moduleId: m1.module_id, moduleVersion: '1.1.0', status: 'DRAFT', manifestJson: null });
    // Version of another module through this module's path → 404 (not disclosed).
    const cross = await detail(h, m1.module_id, other.version_id);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('VERSION_NOT_FOUND');
    expect((await list(h, m2.module_id)).body.versions).toHaveLength(1);
    // Reads write nothing (no audit for a successful READ).
    expect(writes(h)).toHaveLength(0);
  });

  it('V02 detail of a missing version / missing module / malformed ids → 404 VERSION_NOT_FOUND; list of a missing module → 404', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    for (const res of [
      await detail(h, m.module_id, randomUUID()), await detail(h, randomUUID(), randomUUID()), await detail(h, m.module_id, 'not-a-uuid'),
      await detail(h, "1'; DROP TABLE x; --", randomUUID()),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('VERSION_NOT_FOUND');
    }
    for (const res of [await list(h, randomUUID()), await list(h, 'abc')]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MODULE_NOT_FOUND');
    }
    // Malformed ids never reach SQL.
    expect(h.db.statements.some((s) => s.params.some((p) => p === 'not-a-uuid' || p === 'abc'))).toBe(false);
  });
});

describe('FBE-02A create (POST)', () => {
  it('V03 / V12 / V14 valid create → 201 DRAFT; B02 + B08 SUCCESS in one transaction after the module lock; no B07', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    const res = await create(h, m.module_id, BODY);
    expect(res.status).toBe(201);
    const v = res.body.version;
    expect(v.versionId).toMatch(UUID);
    expect(v).toMatchObject({
      moduleId: m.module_id, moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', status: 'DRAFT', manifestJson: null, manifestHash: null,
      submittedByAccountId: null, reviewedByAccountId: null, reviewedAt: null, activatedAt: null,
    });
    expect(v.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT']);
    // Statement order inside the transaction: lock → module exists → existing versions → INSERT B02 → INSERT B08.
    const tx = h.db.statements.filter((s) => s.inTransaction).map((s) => s.sql);
    expect(tx).toEqual([VERSION_SQL.lockModuleVersions, VERSION_SQL.moduleExists, VERSION_SQL.moduleVersionNumbers, VERSION_SQL.insertVersion, VERSION_SQL.insertVersionAudit]);
    expect(h.db.statements.find((s) => s.sql === VERSION_SQL.lockModuleVersions)?.params).toEqual([m.module_id]);
    // INSERT B02 binds only module_id, module_version, contract_version (status / manifest / hash / actor = DB defaults).
    expect(h.db.statements.find((s) => s.sql === VERSION_SQL.insertVersion)?.params).toEqual([m.module_id, '1.0.0', 'MIC-1.0']);
    expect(VERSION_SQL.insertVersion).toMatch(/\(module_id, module_version, contract_version\)\s+VALUES \(\$1::uuid, \$2, \$3\)/);
    expect(h.db.state.versions).toHaveLength(1);
    const [audit] = h.db.state.versionAudits;
    expect(audit?.[VA.eventId]).toMatch(UUID);
    expect(audit?.[VA.moduleId]).toBe(m.module_id);
    expect(audit?.[VA.versionId]).toBe(v.versionId);
    expect(audit?.[VA.actor]).toBe(ACCOUNT_A);
    expect(audit?.[VA.action]).toBe('MODULE_VERSION.CREATE');
    expect(audit?.[VA.targetType]).toBe('MODULE_VERSION');
    expect(audit?.[VA.targetId]).toBe(v.versionId);
    expect(audit?.[VA.outcome]).toBe('SUCCESS');
    expect(audit?.[VA.correlation]).toBe(res.headers['x-request-id']);
    expect(audit?.[VA.source]).toBe('talo-mos-backend');
    expect(JSON.parse(String(audit?.[VA.metadata]))).toEqual({ v: 1, reason: 'CREATED', requestId: res.headers['x-request-id'] });
    // V14: no B07 and no Module Registry write.
    expect(h.db.state.events).toHaveLength(0);
    expect(h.db.statements.some((s) => s.sql === FOUNDATION_SQL.insertModuleEvent || s.sql === FOUNDATION_SQL.insertModule)).toBe(false);
    expect(h.db.state.audits).toHaveLength(0);
    // GET returns the created version.
    expect((await detail(h, m.module_id, v.versionId)).body.version).toEqual(v);
  });

  it('V03b several increasing DRAFT versions in the same module (numeric, not lexical, order)', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    for (const version of ['1.0.0', '1.9.0', '1.10.0', '2.0.0', '9007199254740993.0.0']) {
      const res = await create(h, m.module_id, { ...BODY, moduleVersion: version });
      expect(res.status, version).toBe(201);
    }
    expect(h.db.state.versions.map((v) => v.module_version)).toEqual(['1.0.0', '1.9.0', '1.10.0', '2.0.0', '9007199254740993.0.0']);
    expect(h.db.state.versionAudits).toHaveLength(5);
  });

  it('V04 duplicate module_version in the same module → 409 VERSION_EXISTS, rolled back; another module may reuse it', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    const n = seedModule(h.db, 'STOCK');
    expect((await create(h, m.module_id, BODY)).status).toBe(201);
    const dup = await create(h, m.module_id, BODY);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VERSION_EXISTS');
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
    expect(h.db.state.versions).toHaveLength(1);
    expect(h.db.state.versionAudits).toHaveLength(1);
    expect((await create(h, n.module_id, BODY)).status).toBe(201);
  });

  it('V04b the UNIQUE (module_id, module_version) violation (23505, race fallback) also maps to 409 VERSION_EXISTS', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    h.db.failOn.set(VERSION_SQL.insertVersion, pgError('23505'));
    const res = await create(h, m.module_id, BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_EXISTS');
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('V05 not greater than every existing version (REJECTED included) → 409 VERSION_NOT_INCREASING', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    seedVersion(h.db, m.module_id, '1.2.0', 'ACTIVE');
    seedVersion(h.db, m.module_id, '2.0.0', 'REJECTED');
    for (const version of ['0.9.9', '1.1.9', '1.2.0', '1.2.1', '1.99.99', '2.0.0']) {
      const res = await create(h, m.module_id, { ...BODY, moduleVersion: version });
      expect(res.status, version).toBe(409);
    }
    expect((await create(h, m.module_id, { ...BODY, moduleVersion: '1.5.0' })).body.error.code).toBe('VERSION_NOT_INCREASING');
    expect((await create(h, m.module_id, { ...BODY, moduleVersion: '2.0.0' })).body.error.code).toBe('VERSION_EXISTS');
    expect(h.db.state.versionAudits).toHaveLength(0);
    expect((await create(h, m.module_id, { ...BODY, moduleVersion: '2.0.1' })).status).toBe(201);
  });

  it('V06 / V07 / V15 invalid SemVer, contract version or client-controlled fields → 400 VALIDATION_ERROR, nothing written', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    const bad: unknown[] = [
      { ...BODY, moduleVersion: '1.0' }, { ...BODY, moduleVersion: '01.0.0' }, { ...BODY, moduleVersion: '1.00.0' }, { ...BODY, moduleVersion: '1.0.0-beta' },
      { ...BODY, moduleVersion: 'v1.0.0' }, { ...BODY, moduleVersion: '1.0.0.0' }, { ...BODY, moduleVersion: '' }, { ...BODY, moduleVersion: ' 1.0.0' },
      { ...BODY, moduleVersion: `1.0.${'9'.repeat(40)}` }, { ...BODY, moduleVersion: 1 }, { contractVersion: 'MIC-1.0' },
      { ...BODY, contractVersion: 'MIC-1.1' }, { ...BODY, contractVersion: 'mic-1.0' }, { moduleVersion: '1.0.0' },
      { ...BODY, status: 'APPROVED' }, { ...BODY, manifestJson: {} }, { ...BODY, manifestHash: 'a'.repeat(64) }, { ...BODY, createdAt: '2020-01-01T00:00:00Z' },
      { ...BODY, submittedByAccountId: ACCOUNT_A }, { ...BODY, versionId: randomUUID() }, { ...BODY, moduleId: randomUUID() }, [BODY],
    ];
    for (const body of bad) {
      const res = await create(h, m.module_id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(writes(h)).toHaveLength(0);
    expect(h.db.txLog).toEqual([]);
    expect((await create(h, m.module_id, { ...BODY, contractVersion: 'MIC-2.0' })).body.error.details.fields).toEqual(['contractVersion']);
  });

  it('V08 module does not exist → 404 MODULE_NOT_FOUND (malformed id never reaches SQL; missing id rolls back)', async () => {
    const h = harness();
    const missing = randomUUID();
    const res = await create(h, missing, BODY);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MODULE_NOT_FOUND');
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    const malformed = await create(h, 'SALES', BODY);
    expect(malformed.status).toBe(404);
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(writes(h)).toHaveLength(0);
  });

  it('V13 B08 SUCCESS insert fails → 503 and B02 rolled back; B02 insert failure → 503', async () => {
    for (const [failing, code] of [[VERSION_SQL.insertVersionAudit, '23514'], [VERSION_SQL.insertVersion, '42501']] as const) {
      const h = harness();
      const m = seedModule(h.db, 'SALES');
      h.db.failOn.set(failing, pgError(code));
      const res = await create(h, m.module_id, BODY);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_BUSY');
      expect(res.body.version).toBeUndefined();
      expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
      expect(h.db.state.versions).toHaveLength(0);
      expect(h.db.state.versionAudits).toHaveLength(0);
      expect(h.logs.some((l) => l.includes('create version failed (rolled back)') && l.includes(`"sqlstate":"${code}"`))).toBe(true);
    }
  });

  it('a stored module_version that is not SemVer cannot be ordered → 503 (fail closed), nothing written', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    seedVersion(h.db, m.module_id, 'legacy');
    const res = await create(h, m.module_id, BODY);
    expect(res.status).toBe(503);
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(h.db.state.versions).toHaveLength(1);
  });
});

describe('FBE-02A authentication and IAM (shared FBE-01 evaluator)', () => {
  it('V09 no session → 401 on every endpoint; activation session → 403 PASSWORD_CHANGE_REQUIRED; nothing read or written', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    for (const res of [await list(h, m.module_id, null), await detail(h, m.module_id, randomUUID(), null), await create(h, m.module_id, BODY, null)]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
    }
    const activation = token('activationVersion');
    h.auth.activation(activation);
    for (const res of [await list(h, m.module_id, activation), await create(h, m.module_id, BODY, activation)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect(h.db.statements).toHaveLength(0);
  });

  it('V10 no READ → 403 + B08 DENIED MODULE_VERSION.READ; no CREATE → 403 + DENIED MODULE_VERSION.CREATE (input not validated)', async () => {
    // Module Registry permissions do not grant Module Version access.
    const h = harness([{ permissionId: PERM_READ_ID, row: VALID_ROLE }, { permissionId: PERM_CREATE_ID, row: VALID_ROLE }]);
    const m = seedModule(h.db, 'SALES');
    const r = await list(h, m.module_id);
    const d = await detail(h, m.module_id, randomUUID());
    const c = await create(h, m.module_id, { moduleVersion: 'bad' });
    for (const res of [r, d, c]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(h.db.state.audits.map((a) => [a[A.action], a[A.outcome], a[A.targetType], a[A.targetId], a[A.moduleId], a[A.actor]])).toEqual([
      ['MODULE_VERSION.READ', 'DENIED', 'MODULE_VERSION', null, null, ACCOUNT_A],
      ['MODULE_VERSION.READ', 'DENIED', 'MODULE_VERSION', null, null, ACCOUNT_A],
      ['MODULE_VERSION.CREATE', 'DENIED', 'MODULE_VERSION', null, null, ACCOUNT_A],
    ]);
    expect(h.db.state.audits[0]?.[A.correlation]).toBe(r.headers['x-request-id']);
    expect(h.db.statements.some((s) => s.sql === VERSION_SQL.moduleExists || s.sql === VERSION_SQL.getVersion)).toBe(false);
    expect(h.db.state.versions).toHaveLength(0);
    expect(h.db.txLog).toEqual([]);
  });

  it('V11 Role ALLOW / Direct ALLOW allow; Direct DENY overrides Role ALLOW; READ alone does not allow CREATE', async () => {
    const cases: { name: string; grants: { permissionId: string; row: GrantRow }[]; read: number; create: number }[] = [
      { name: 'role allow both', grants: both, read: 200, create: 201 },
      { name: 'direct allow both', grants: [{ permissionId: PERM_VREAD_ID, row: VALID_DIRECT_ALLOW }, { permissionId: PERM_VCREATE_ID, row: VALID_DIRECT_ALLOW }], read: 200, create: 201 },
      { name: 'direct deny overrides role', grants: [...both, { permissionId: PERM_VREAD_ID, row: VALID_DIRECT_DENY }, { permissionId: PERM_VCREATE_ID, row: VALID_DIRECT_DENY }], read: 403, create: 403 },
      { name: 'read only', grants: [{ permissionId: PERM_VREAD_ID, row: VALID_ROLE }], read: 200, create: 403 },
      { name: 'revoked role', grants: [{ permissionId: PERM_VREAD_ID, row: { ...VALID_ROLE, not_revoked: false } }], read: 403, create: 403 },
    ];
    for (const c of cases) {
      const h = harness(c.grants);
      const m = seedModule(h.db, 'SALES');
      expect((await list(h, m.module_id)).status, c.name).toBe(c.read);
      expect((await create(h, m.module_id, BODY)).status, c.name).toBe(c.create);
    }
  });

  it('DENIED-audit write fails → still denied, 503 SERVICE_BUSY; permission lookup fails → 503; never allowed', async () => {
    const h = harness([]);
    const m = seedModule(h.db, 'SALES');
    h.db.failOn.set(FOUNDATION_SQL.insertAudit, pgError('42501'));
    for (const res of [await list(h, m.module_id), await create(h, m.module_id, BODY)]) {
      expect(res.status).toBe(503);
      expect(res.body.versions).toBeUndefined();
      expect(res.body.version).toBeUndefined();
    }
    const g = harness();
    const n = seedModule(g.db, 'SALES');
    g.db.failOn.set(FOUNDATION_SQL.grantFacts, pgError('42501'));
    expect((await create(g, n.module_id, BODY)).status).toBe(503);
    expect(g.db.state.versions).toHaveLength(0);
  });
});

describe('FBE-02A scope', () => {
  it('V15 every statement is a fixed SQL constant; VERSION_SQL never updates/deletes or touches IAM; FBE-01 endpoints unchanged', async () => {
    const h = harness([...both, { permissionId: PERM_READ_ID, row: VALID_ROLE }]);
    const m = seedModule(h.db, 'SALES');
    await create(h, m.module_id, { ...BODY, moduleVersion: '3.0.0' });
    await list(h, m.module_id);
    await detail(h, m.module_id, randomUUID());
    const modules = await request(h.app).get('/api/foundation/modules').set('Cookie', `talo_sid=${TOKEN}`);
    expect(modules.status).toBe(200);
    expect(modules.body.modules.map((x: { moduleKey: string }) => x.moduleKey)).toEqual(['SALES']);
    for (const s of h.db.statements) expect(ALL_SQL.has(s.sql)).toBe(true);
    for (const sql of Object.values(VERSION_SQL)) {
      expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|GRANT|ALTER|DROP|CREATE)\b/i);
      expect(sql).not.toMatch(/\biam\./i);
      expect(sql).not.toMatch(/fnd_module_events/);
    }
    // Only B02 / B08 are written by the version flow (no B01 update, no other Foundation table).
    const versionWrites = Object.values(VERSION_SQL).filter((sql) => /\bINSERT\b/i.test(sql));
    expect(versionWrites.map((sql) => /INSERT INTO (\S+)/.exec(sql)?.[1])).toEqual(['foundation.fnd_module_versions', 'foundation.fnd_audit_logs']);
    // Unknown verbs on the version paths are 404, not handled.
    const del = await request(h.app).delete(base(m.module_id)).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`);
    expect(del.status).toBe(404);
  });

  it('SemVer parsing and ordering', () => {
    expect(parseSemVer('0.0.0')).toEqual([0n, 0n, 0n]);
    expect(parseSemVer('01.0.0')).toBeNull();
    const cmp = (a: string, b: string) => {
      const x = parseSemVer(a);
      const y = parseSemVer(b);
      if (!x || !y) throw new Error('invalid');
      return compareSemVer(x, y);
    };
    expect(cmp('1.10.0', '1.9.0')).toBe(1);
    expect(cmp('2.0.0', '10.0.0')).toBe(-1);
    expect(cmp('1.0.1', '1.0.1')).toBe(0);
    expect(cmp('9007199254740993.0.0', '9007199254740992.0.0')).toBe(1);
  });
});
