import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { UnavailableBlocklist } from '../../../src/modules/auth/pwnedPasswords.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { sqlstateOf } from '../../../src/modules/auth/sqlstate.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { MANIFEST_SQL, SqlManifestRepository } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { REGISTRY_SQL } from '../../../src/modules/foundation/foundation.registry.repository.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { SqlModuleVersionRepository, VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { validMic } from '../../unit/foundation/mic.fixture.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FBE-03-VERIFY — Function / Action registry (B03–B06) materialised by SUBMIT, on PostgreSQL 18.6 (talo_mos_v4_test).
// Runs only with TALO_FOUNDATION_DB=1. Real Express app + auth + Foundation modules as talo_app (DATABASE_URL), Prisma
// pg adapter, real transactions and locks. Fixtures (talo_test_harness): AUTHT- accounts and FBET- IAM rows, removed by
// proven UUID. Foundation rows (B01–B08, B03–B06) are append-only (C2): never updated or deleted; keys FBET_<RUN>_<n>.
// Faults: a test-only FoundationDb wrapper changes ONE bind value so that PostgreSQL itself rejects the statement inside
// the real SUBMIT transaction. No source, data, grant or constraint is modified. No APPROVED / ACTIVE state is created.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create',
  update: 'foundation.module_version.update', submit: 'foundation.module_version.submit', read: 'foundation.module_version.read',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'read'];
const ALL: readonly PermKey[] = PERM_KEYS;
const REGISTRY_TABLES = ['fnd_functions', 'fnd_actions', 'fnd_version_functions', 'fnd_version_actions'];

type Fault = 'NONE' | 'B03_CHECK' | 'B04_CHECK' | 'B05_FK' | 'B06_CHECK' | 'B03_LOOKUP_MISS' | 'B07' | 'B08';

// One bind value changed → a real PostgreSQL error (or a real empty lookup) inside the SUBMIT transaction.
//   B03_CHECK        insertFunction function_key        → 'bad key'       23514 ck_fnd_functions_function_key_format
//   B04_CHECK        insertAction action_key            → 'bad key'       23514 ck_fnd_actions_action_key_format
//   B05_FK           insertVersionFunction function_id  → random UUID     23503 fk_fnd_version_functions_function_id
//   B06_CHECK        insertVersionAction definition_hash→ 'NOT-A-HASH'    23514 ck_fnd_version_actions_definition_hash_format
//   B03_LOOKUP_MISS  selectFunction function_key        → 'NO_SUCH_KEY'   0 rows → count guard → rollback
//   B07              insertSubmitEvent module_id        → random UUID     23503
//   B08              insertVersionAudit outcome SUCCESS → 'BOGUS'         23514
function faultyDb(db: FoundationDb, fault: () => Fault): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    const set = (i: number, value: unknown) => params.map((p, j) => (j === i ? value : p));
    if (f === 'B03_CHECK' && sql === REGISTRY_SQL.insertFunction) return set(1, 'bad key');
    if (f === 'B04_CHECK' && sql === REGISTRY_SQL.insertAction) return set(1, 'bad key');
    if (f === 'B05_FK' && sql === REGISTRY_SQL.insertVersionFunction) return set(1, randomUUID());
    if (f === 'B06_CHECK' && sql === REGISTRY_SQL.insertVersionAction) return set(4, 'NOT-A-HASH');
    if (f === 'B03_LOOKUP_MISS' && sql === REGISTRY_SQL.selectFunction) return set(1, 'NO_SUCH_KEY');
    if (f === 'B07' && sql === MANIFEST_SQL.insertSubmitEvent) return set(0, randomUUID());
    if (f === 'B08' && sql === VERSION_SQL.insertVersionAudit && params[7] === 'SUCCESS') return set(7, 'BOGUS');
    return params;
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    query: (sql, params) => x.query(sql, rewrite(sql, params)),
    execute: (sql, params) => x.execute(sql, rewrite(sql, params)),
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))) };
}

// FBET- IAM authorisation fixtures (same ownership-proof cleanup as the FBE-01B / FBE-02C suites).
class AuthzFixtures {
  readonly roles: string[] = [];
  readonly userRoles: string[] = [];
  private seq = 0;

  constructor(private readonly h: PsqlSession, readonly runTag: string, private readonly accounts: () => readonly string[]) {}

  async assertNoLeftovers(): Promise<void> {
    const [row] = await this.h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE 'FBET-%'`);
    if (row?.[0] !== '0') throw new Error(`fixture guard: ${row?.[0]} leftover FBET- roles — inspect before running`);
  }

  async role(accountId: string, permissionIds: readonly string[]): Promise<void> {
    this.seq += 1;
    const roleId = randomUUID();
    const userRoleId = randomUUID();
    this.roles.push(roleId);
    this.userRoles.push(userRoleId);
    await this.h.ok('BEGIN');
    try {
      await this.h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system)
        VALUES (${lit(roleId)}, ${lit(`${this.runTag}-R${this.seq}`)}, ${lit(`FBET role ${this.seq}`)}, true, false)`);
      for (const p of permissionIds) {
        await this.h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(p)})`);
      }
      await this.h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(userRoleId)}, ${lit(accountId)}, ${lit(roleId)})`);
      await this.h.ok('COMMIT');
    } catch (error) {
      await this.h.query('ROLLBACK');
      throw error;
    }
  }

  async cleanup(): Promise<Record<string, number>> {
    const accounts = uuidArray(this.accounts().length ? this.accounts() : [NIL]);
    const roles = uuidArray(this.roles.length ? this.roles : [NIL]);
    const userRoles = uuidArray(this.userRoles.length ? this.userRoles : [NIL]);
    const [foreign] = await this.h.ok(`
      SELECT (SELECT count(*) FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code NOT LIKE ${lit(`${this.runTag}-R%`)})
           + (SELECT count(*) FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND NOT (user_account_id = ANY(${accounts}) AND role_id = ANY(${roles})))
           + (SELECT count(*) FROM iam.iam_user_roles WHERE role_id = ANY(${roles}) AND NOT (user_role_id = ANY(${userRoles})))`);
    if (foreign?.[0] !== '0') throw new Error('authz cleanup refused: ownership could not be proven');
    const steps: [string, string][] = [
      ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND user_account_id = ANY(${accounts})`],
      ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
      ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code LIKE ${lit(`${this.runTag}-R%`)}`],
    ];
    const deleted: Record<string, number> = {};
    await this.h.ok('BEGIN');
    for (const [name, sql] of steps) {
      const result = await this.h.query(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`);
      if (result.error) {
        await this.h.query('ROLLBACK');
        throw new Error(`authz cleanup failed at ${name} [${result.sqlstate}] ${result.message}`);
      }
      deleted[name] = Number(result.rows[0]?.[0] ?? 0);
    }
    await this.h.ok('COMMIT');
    const [after] = await this.h.ok(`
      SELECT (SELECT count(*) FROM iam.iam_roles WHERE role_id = ANY(${roles}) OR role_code LIKE ${lit(`${this.runTag}-%`)})
           + (SELECT count(*) FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) OR user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_role_permissions WHERE role_id = ANY(${roles}))`);
    if (after?.[0] !== '0') throw new Error(`authz cleanup post-check failed: ${after?.[0]} rows remain`);
    this.roles.length = 0;
    this.userRoles.length = 0;
    return deleted;
  }
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// A valid MIC (P-16 / P-17) of the given module with one more Function / Action (consistent mapping, no new API).
function micWithExtra(moduleKey: string, moduleVersion: string) {
  const mic = validMic(moduleKey, moduleVersion);
  return {
    ...mic,
    mic02Functions: [...mic.mic02Functions, { functionKey: 'APPROVAL', name: 'Phê duyệt' }],
    mic03Actions: [...mic.mic03Actions, { functionKey: 'APPROVAL', actionKey: 'APPROVE', name: 'Duyệt đơn', nature: 'WRITE' }],
    mic07IamMapping: [...mic.mic07IamMapping, { functionKey: 'APPROVAL', actionKey: 'APPROVE', moduleCode: moduleKey, resourceCode: 'APPROVAL', operation: 'APPROVE', minimumAssuranceLevel: 1 }],
  };
}

describe.skipIf(!enabled)('FBE-03 Function / Action registry — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let fault: Fault = 'NONE';
  let cookie = '';
  let actorId = '';
  const perm: Record<PermKey, string> = { registryCreate: '', create: '', update: '', submit: '', read: '' };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const keyPrefix = `FBET_${run}_`;
  let keySeq = 0;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};
  const runVersions: string[] = [];
  let registryBefore: Record<string, number> = {};

  const rid = (res: Response): string => {
    const value = res.headers['x-request-id'];
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('response without X-Request-Id');
    return value;
  };
  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    const value = (Array.isArray(header) ? header[0] : undefined)?.split(';')[0];
    if (!value || !value.startsWith('talo_sid=') || value === 'talo_sid=') throw new Error('no session cookie');
    return value;
  };
  const send = (method: 'post' | 'put', url: string, body: unknown) =>
    request(app)[method](url).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  async function login(): Promise<void> {
    const acc = await fx.create();
    await az.role(acc.accountId, ALL.map((k) => perm[k]));
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    cookie = cookieOf(res);
    actorId = acc.accountId;
  }
  async function newModule(): Promise<{ moduleId: string; moduleKey: string }> {
    const moduleKey = `${keyPrefix}${++keySeq}`;
    const res = await send('post', '/api/foundation/modules', { moduleKey, moduleName: `FBE-03 ${keySeq}`, moduleType: 'INTERNAL' });
    expect(res.status).toBe(201);
    return { moduleId: String(res.body.module.moduleId), moduleKey };
  }
  async function draft(moduleId: string, moduleVersion: string, manifest: unknown): Promise<string> {
    const created = await send('post', `/api/foundation/modules/${moduleId}/versions`, { moduleVersion, contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    const versionId = String(created.body.version.versionId);
    runVersions.push(versionId);
    expect((await send('put', `/api/foundation/modules/${moduleId}/versions/${versionId}/manifest`, { manifest })).status).toBe(200);
    return versionId;
  }
  const submit = (moduleId: string, versionId: string, body: unknown = {}) => send('post', `/api/foundation/modules/${moduleId}/versions/${versionId}/submit`, body);

  // Harness reads (SELECT on B01–B08 and B03–B06).
  async function functionsOf(moduleId: string) {
    const rows = await h.ok(`SELECT function_id::text, function_key, coalesce(retired_at::text, '<null>'), coalesce(replaces_function_id::text, '<null>')
      FROM foundation.fnd_functions WHERE module_id = ${lit(moduleId)} ORDER BY function_key COLLATE "C"`);
    return rows.map((r) => ({ id: r[0] ?? '', key: r[1] ?? '', retired: r[2], replaces: r[3] }));
  }
  async function actionsOf(moduleId: string) {
    const rows = await h.ok(`SELECT a.action_id::text, f.function_key, a.action_key, coalesce(a.retired_at::text, '<null>')
      FROM foundation.fnd_actions a JOIN foundation.fnd_functions f ON f.function_id = a.function_id
      WHERE f.module_id = ${lit(moduleId)} ORDER BY f.function_key COLLATE "C", a.action_key COLLATE "C"`);
    return rows.map((r) => ({ id: r[0] ?? '', functionKey: r[1] ?? '', actionKey: r[2] ?? '', retired: r[3] }));
  }
  async function versionFunctionsOf(versionId: string) {
    const rows = await h.ok(`SELECT vf.version_function_id::text, vf.function_id::text, f.function_key, vf.display_name, coalesce(vf.route_key, '<null>'),
        coalesce(vf.definition_hash, '<null>'), vf.is_deprecated, (f.module_id = v.module_id)
      FROM foundation.fnd_version_functions vf JOIN foundation.fnd_functions f ON f.function_id = vf.function_id
      JOIN foundation.fnd_module_versions v ON v.version_id = vf.version_id
      WHERE vf.version_id = ${lit(versionId)} ORDER BY f.function_key COLLATE "C"`);
    return rows.map((r) => ({ vfId: r[0] ?? '', functionId: r[1] ?? '', key: r[2] ?? '', displayName: r[3] ?? '', routeKey: r[4], hash: r[5], deprecated: r[6], sameModule: r[7] }));
  }
  async function versionActionsOf(versionId: string) {
    const rows = await h.ok(`SELECT f.function_key, a.action_key, coalesce(va.description, '<null>'), va.action_spec::text, jsonb_typeof(va.action_spec),
        coalesce(va.definition_hash, '<null>'), va.is_deprecated, (a.function_id = vf.function_id)
      FROM foundation.fnd_version_actions va JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id
      JOIN foundation.fnd_actions a ON a.action_id = va.action_id JOIN foundation.fnd_functions f ON f.function_id = vf.function_id
      WHERE vf.version_id = ${lit(versionId)} ORDER BY f.function_key COLLATE "C", a.action_key COLLATE "C"`);
    return rows.map((r) => ({
      functionKey: r[0] ?? '', actionKey: r[1] ?? '', description: r[2], spec: JSON.parse(r[3] ?? 'null'), specType: r[4], hash: r[5], deprecated: r[6], rightFunction: r[7],
    }));
  }
  async function registryCounts(): Promise<Record<string, number>> {
    const [r] = await h.ok(`SELECT ${REGISTRY_TABLES.map((t) => `(SELECT count(*) FROM foundation.${t})`).join(', ')}`);
    return Object.fromEntries(REGISTRY_TABLES.map((t, i) => [t, Number(r?.[i])]));
  }
  async function b02(versionId: string) {
    const [r] = await h.ok(`SELECT status, coalesce(manifest_hash, '<null>') FROM foundation.fnd_module_versions WHERE version_id = ${lit(versionId)}`);
    return { status: r?.[0], hash: r?.[1] };
  }
  const countBy = async (table: string, requestId: string) => Number((await h.ok(`SELECT count(*) FROM foundation.${table} WHERE correlation_id = ${lit(requestId)}`))[0]?.[0]);
  const ungrantedLocks = async () => Number((await h.ok('SELECT count(*) FROM pg_locks WHERE NOT granted'))[0]?.[0]);
  async function waitUntil(label: string, check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await check()) return;
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${label}`);
  }

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [identity] = await prisma.$queryRawUnsafe<{ db: string; usr: string; version: string }[]>(
      `SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS version`);
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app') throw new Error('guard: API must run as talo_app on talo_mos_v4_test');
    evidence['runtime'] = identity;
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({
      prisma, logger, production: false, hasher, breachedPasswords: new UnavailableBlocklist('not used by FBE-03-VERIFY'),
      loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }),
    });
    const db = faultyDb(prismaFoundationDb(prisma), () => fault);
    const foundation = createFoundationModule({
      prisma, authService: auth.service, logger, secureCookie: false,
      repository: new SqlFoundationRepository(db), versionRepository: new SqlModuleVersionRepository(db), manifestRepository: new SqlManifestRepository(db),
    });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    az = new AuthzFixtures(h, `FBET-${run}`, () => fx.accounts);
    await fx.assertNoLeftovers();
    await az.assertNoLeftovers();
    for (const key of PERM_KEYS) {
      const [row] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(PERMS[key])} AND module_code = 'FOUNDATION'`);
      if (!row?.[0] || !UUID.test(row[0])) throw new Error(`permission ${PERMS[key]} not registered`);
      perm[key] = row[0];
    }
    registryBefore = await registryCounts();
    evidence['registryBefore'] = registryBefore;
  });

  afterEach(async () => {
    fault = 'NONE';
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    if (h) {
      evidence['registryAfter'] = await registryCounts();
      // No backfill and no foreign registry rows: every B05 row written during this run belongs to a version of this run.
      const ids = uuidArray(runVersions.length ? runVersions : [NIL]);
      const [foreign] = await h.ok(`SELECT count(*) FROM foundation.fnd_version_functions WHERE NOT (version_id = ANY(${ids}))`);
      evidence['b05NotFromThisRun'] = Number(foreign?.[0]);
      const [oldInReview] = await h.ok(`SELECT count(*) FROM foundation.fnd_module_versions v WHERE v.status = 'IN_REVIEW' AND NOT (v.version_id = ANY(${ids}))
        AND NOT EXISTS (SELECT 1 FROM foundation.fnd_version_functions vf WHERE vf.version_id = v.version_id)`);
      evidence['oldInReviewWithoutRegistry'] = Number(oldInReview?.[0]);
    }
    console.log(`[fbe03] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe03] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ FP-3

  async function plan(sql: string, params: readonly unknown[]): Promise<string> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$queryRawUnsafe(`EXPLAIN ${sql}`, ...params);
        throw new Error('ROLLBACK_SENTINEL');
      });
      return 'committed?';
    } catch (error) {
      if (error instanceof Error && error.message === 'ROLLBACK_SENTINEL') return 'OK';
      return sqlstateOf(error) ?? 'error';
    }
  }

  it('FP3-1 / FP3-2: the 6 REGISTRY_SQL plan as talo_app; the B03–B06 privilege matrix is exact; forbidden writes → 42501 (EXPLAIN only)', async () => {
    const statements: [string, string, unknown[]][] = [
      ['insertFunction', REGISTRY_SQL.insertFunction, [NIL, 'PLAN']],
      ['selectFunction', REGISTRY_SQL.selectFunction, [NIL, 'PLAN']],
      ['insertAction', REGISTRY_SQL.insertAction, [NIL, 'PLAN']],
      ['selectAction', REGISTRY_SQL.selectAction, [NIL, 'PLAN']],
      ['insertVersionFunction', REGISTRY_SQL.insertVersionFunction, [NIL, NIL, 'plan', 'a'.repeat(64)]],
      ['insertVersionAction', REGISTRY_SQL.insertVersionAction, [NIL, NIL, 'plan', '{}', 'a'.repeat(64)]],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual(Object.keys(REGISTRY_SQL).sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(statements.map((s) => [s[0], 'OK'])));
    const forbidden: Record<string, string> = {
      'UPDATE B03': `UPDATE foundation.fnd_functions SET retired_at = now()`,
      'DELETE B03': `DELETE FROM foundation.fnd_functions`,
      'INSERT B03.retired_at': `INSERT INTO foundation.fnd_functions (module_id, function_key, retired_at) VALUES ('${NIL}', 'X', now())`,
      'INSERT B03.replaces_function_id': `INSERT INTO foundation.fnd_functions (module_id, function_key, replaces_function_id) VALUES ('${NIL}', 'X', '${NIL}')`,
      'INSERT B03.function_id': `INSERT INTO foundation.fnd_functions (function_id, module_id, function_key) VALUES ('${NIL}', '${NIL}', 'X')`,
      'UPDATE B04': `UPDATE foundation.fnd_actions SET function_id = function_id`,
      'DELETE B04': `DELETE FROM foundation.fnd_actions`,
      'INSERT B05.route_key': `INSERT INTO foundation.fnd_version_functions (version_id, function_id, display_name, route_key) VALUES ('${NIL}', '${NIL}', 'x', '/x')`,
      'INSERT B05.is_deprecated': `INSERT INTO foundation.fnd_version_functions (version_id, function_id, display_name, is_deprecated) VALUES ('${NIL}', '${NIL}', 'x', true)`,
      'UPDATE B05': `UPDATE foundation.fnd_version_functions SET display_name = display_name`,
      'DELETE B06': `DELETE FROM foundation.fnd_version_actions`,
      'UPDATE B06': `UPDATE foundation.fnd_version_actions SET action_spec = action_spec`,
      'SELECT B09': `SELECT 1 FROM foundation.fnd_navigation_items`,
    };
    const refused: Record<string, string> = {};
    for (const [name, sql] of Object.entries(forbidden)) refused[name] = await plan(sql, []);
    expect(refused).toEqual(Object.fromEntries(Object.keys(forbidden).map((k) => [k, '42501'])));
    const matrix = await prisma.$queryRawUnsafe<{ t: string; sel: boolean; del: boolean; trunc: boolean; upd: boolean; ins: string }[]>(`
      SELECT t, has_table_privilege('foundation.' || t, 'SELECT') AS sel, has_table_privilege('foundation.' || t, 'DELETE') AS del,
             has_table_privilege('foundation.' || t, 'TRUNCATE') AS trunc, has_any_column_privilege('foundation.' || t, 'UPDATE') AS upd,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = ('foundation.' || t)::regclass AND attnum > 0
                AND has_column_privilege(('foundation.' || t)::regclass, attname, 'INSERT')) AS ins
        FROM unnest(ARRAY[${REGISTRY_TABLES.map((t) => `'${t}'`).join(', ')}]) AS t ORDER BY t`);
    expect(matrix).toEqual([
      { t: 'fnd_actions', sel: true, del: false, trunc: false, upd: false, ins: 'function_id,action_key' },
      { t: 'fnd_functions', sel: true, del: false, trunc: false, upd: false, ins: 'module_id,function_key' },
      { t: 'fnd_version_actions', sel: true, del: false, trunc: false, upd: false, ins: 'version_function_id,action_id,description,action_spec,definition_hash' },
      { t: 'fnd_version_functions', sel: true, del: false, trunc: false, upd: false, ins: 'version_id,function_id,display_name,definition_hash' },
    ]);
    evidence['fp3Matrix'] = matrix;
  });

  it('FP3-3: talo_test_harness reads B03–B06 and cannot write them', async () => {
    for (const t of REGISTRY_TABLES) {
      const [row] = await h.ok(`SELECT has_table_privilege('foundation.${t}', 'SELECT'), has_any_column_privilege('foundation.${t}', 'INSERT'),
        has_any_column_privilege('foundation.${t}', 'UPDATE'), has_table_privilege('foundation.${t}', 'DELETE'), has_table_privilege('foundation.${t}', 'TRUNCATE')`);
      expect(row, t).toEqual(['t', 'f', 'f', 'f', 'f']);
    }
  });

  it('FP3-4: Prisma adapter — real ON CONFLICT DO NOTHING (0 rows), lookup of the existing id, RETURNING, SQLSTATE 23514 / 23503 / 23505; all rolled back', async () => {
    await login();
    const { moduleId } = await newModule();
    const versionId = await draft(moduleId, '1.0.0', { draft: true });
    const outcome: Record<string, unknown> = {};
    try {
      await prisma.$transaction(async (tx) => {
        outcome['insert1'] = await tx.$executeRawUnsafe(REGISTRY_SQL.insertFunction, moduleId, 'FP3_FUNCTION');
        outcome['insert2'] = await tx.$executeRawUnsafe(REGISTRY_SQL.insertFunction, moduleId, 'FP3_FUNCTION');
        const found = await tx.$queryRawUnsafe<{ function_id: string }[]>(REGISTRY_SQL.selectFunction, moduleId, 'FP3_FUNCTION');
        outcome['found'] = found.length;
        const fid = found[0]?.function_id ?? NIL;
        outcome['action1'] = await tx.$executeRawUnsafe(REGISTRY_SQL.insertAction, fid, 'FP3_ACTION');
        outcome['action2'] = await tx.$executeRawUnsafe(REGISTRY_SQL.insertAction, fid, 'FP3_ACTION');
        const returned = await tx.$queryRawUnsafe<{ version_function_id: string }[]>(REGISTRY_SQL.insertVersionFunction, versionId, fid, 'FP3', 'b'.repeat(64));
        outcome['returningUuid'] = UUID.test(returned[0]?.version_function_id ?? '');
        throw new Error('ROLLBACK_SENTINEL');
      });
    } catch (error) {
      if (!(error instanceof Error && error.message === 'ROLLBACK_SENTINEL')) throw error;
    }
    expect(outcome).toEqual({ insert1: 1, insert2: 0, found: 1, action1: 1, action2: 0, returningUuid: true });
    const sqlstate = async (fn: (tx: SqlExecutor) => Promise<unknown>) => {
      try {
        await prismaFoundationDb(prisma).transaction(async (tx) => fn(tx));
        return 'none';
      } catch (error) {
        return sqlstateOf(error) ?? 'unknown';
      }
    };
    const states = {
      checkFunctionKey: await sqlstate((tx) => tx.execute(REGISTRY_SQL.insertFunction, [moduleId, 'bad key'])),
      fkModule: await sqlstate((tx) => tx.execute(REGISTRY_SQL.insertFunction, [randomUUID(), 'FP3_X'])),
      checkHash: await sqlstate(async (tx) => {
        await tx.execute(REGISTRY_SQL.insertFunction, [moduleId, 'FP3_Y']);
        const [f] = await tx.query(REGISTRY_SQL.selectFunction, [moduleId, 'FP3_Y']);
        const fid = typeof f === 'object' && f !== null && 'function_id' in f ? String(f.function_id) : NIL;
        return tx.query(REGISTRY_SQL.insertVersionFunction, [versionId, fid, 'x', 'NOT-A-HASH']);
      }),
      uniqueVersionFunction: await sqlstate(async (tx) => {
        await tx.execute(REGISTRY_SQL.insertFunction, [moduleId, 'FP3_Z']);
        const [f] = await tx.query(REGISTRY_SQL.selectFunction, [moduleId, 'FP3_Z']);
        const fid = typeof f === 'object' && f !== null && 'function_id' in f ? String(f.function_id) : NIL;
        await tx.query(REGISTRY_SQL.insertVersionFunction, [versionId, fid, 'x', 'c'.repeat(64)]);
        return tx.query(REGISTRY_SQL.insertVersionFunction, [versionId, fid, 'x', 'c'.repeat(64)]);
      }),
    };
    expect(states).toEqual({ checkFunctionKey: '23514', fkModule: '23503', checkHash: '23514', uniqueVersionFunction: '23505' });
    expect(await functionsOf(moduleId)).toEqual([]); // everything rolled back
    expect(await versionFunctionsOf(versionId)).toEqual([]);
    evidence['fp3Adapter'] = { outcome, states };
  });

  // ------------------------------------------------------------------ SUBMIT materialisation

  it('V1: SUBMIT writes B03 / B04 / B05 / B06 with the approved mapping, hashes and JSONB action_spec; same Module, right Function; B07 / B08 unchanged', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const mic = validMic(moduleKey, '1.0.0');
    const versionId = await draft(moduleId, '1.0.0', mic);
    const res = await submit(moduleId, versionId);
    expect(res.status).toBe(200);
    const fns = await functionsOf(moduleId);
    expect(fns.map((f) => [f.key, f.retired, f.replaces])).toEqual([['ORDER', '<null>', '<null>'], ['REPORT', '<null>', '<null>']]);
    expect((await actionsOf(moduleId)).map((a) => [a.functionKey, a.actionKey, a.retired])).toEqual([['ORDER', 'CREATE', '<null>'], ['ORDER', 'READ', '<null>'], ['REPORT', 'READ', '<null>']]);
    const vfs = await versionFunctionsOf(versionId);
    expect(vfs.map((x) => [x.key, x.displayName, x.routeKey, x.hash, x.deprecated, x.sameModule])).toEqual([
      ['ORDER', 'Đơn hàng', '<null>', canonicalDigest(mic.mic02Functions[0]).sha256, 'f', 't'],
      ['REPORT', 'Báo cáo', '<null>', canonicalDigest(mic.mic02Functions[1]).sha256, 'f', 't'],
    ]);
    const vas = await versionActionsOf(versionId);
    const spec = (fk: string, ak: string) => mic.mic03Actions.find((a) => a.functionKey === fk && a.actionKey === ak);
    expect(vas.map((x) => [x.functionKey, x.actionKey, x.description, x.specType, x.deprecated, x.rightFunction])).toEqual([
      ['ORDER', 'CREATE', 'Tạo đơn hàng', 'object', 'f', 't'], ['ORDER', 'READ', 'Xem đơn hàng', 'object', 'f', 't'], ['REPORT', 'READ', 'Xem báo cáo', 'object', 'f', 't'],
    ]);
    for (const x of vas) {
      expect(x.spec).toEqual(spec(x.functionKey, x.actionKey)); // JSONB round trip
      expect(x.hash).toBe(canonicalDigest(x.spec).sha256); // hash recomputed from the stored JSONB
    }
    const hash = canonicalDigest(mic).sha256;
    expect(await b02(versionId)).toEqual({ status: 'IN_REVIEW', hash });
    const [event] = await h.ok(`SELECT event_type, after_state::text, actor_account_id::text FROM foundation.fnd_module_events WHERE correlation_id = ${lit(rid(res))}`);
    expect(event?.[0]).toBe('SUBMIT');
    expect(event?.[2]).toBe(actorId);
    expect(JSON.parse(event?.[1] ?? 'null')).toEqual({ status: 'IN_REVIEW', manifest_hash: hash });
    const [audit] = await h.ok(`SELECT action_code, outcome, metadata::text FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(rid(res))}`);
    expect([audit?.[0], audit?.[1], JSON.parse(audit?.[2] ?? 'null')]).toEqual(['MODULE_VERSION.SUBMIT', 'SUCCESS', { v: 1, reason: 'SUBMITTED', requestId: rid(res), manifestHash: hash }]);
    evidence['v1'] = { moduleId, versionId, functions: fns.length, actions: vas.length };
  });

  it('V2: identities are reused by the next version of the module (only new keys inserted); another module with the same keys gets its own', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const v1 = await draft(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
    expect((await submit(moduleId, v1)).status).toBe(200);
    const before = await functionsOf(moduleId);
    const beforeActions = await actionsOf(moduleId);
    const v2 = await draft(moduleId, '2.0.0', micWithExtra(moduleKey, '2.0.0'));
    expect((await submit(moduleId, v2)).status).toBe(200);
    const after = await functionsOf(moduleId);
    expect(after.map((f) => f.key)).toEqual(['APPROVAL', 'ORDER', 'REPORT']);
    for (const f of before) expect(after.find((x) => x.key === f.key)?.id).toBe(f.id);
    const afterActions = await actionsOf(moduleId);
    expect(afterActions).toHaveLength(4);
    for (const a of beforeActions) expect(afterActions.find((x) => x.functionKey === a.functionKey && x.actionKey === a.actionKey)?.id).toBe(a.id);
    const v2Functions = await versionFunctionsOf(v2);
    expect(v2Functions).toHaveLength(3);
    expect(v2Functions.find((x) => x.key === 'ORDER')?.functionId).toBe(before.find((f) => f.key === 'ORDER')?.id);
    expect((await versionFunctionsOf(v1)).map((x) => x.key)).toEqual(['ORDER', 'REPORT']); // v1 declarations untouched
    const other = await newModule();
    const ov = await draft(other.moduleId, '1.0.0', validMic(other.moduleKey, '1.0.0'));
    expect((await submit(other.moduleId, ov)).status).toBe(200);
    const otherOrder = (await functionsOf(other.moduleId)).find((f) => f.key === 'ORDER');
    expect(otherOrder?.id).toBeDefined();
    expect(otherOrder?.id).not.toBe(before.find((f) => f.key === 'ORDER')?.id);
    expect((await versionFunctionsOf(ov)).every((x) => x.sameModule === 't')).toBe(true);
  });

  it('V3: concurrent SUBMITs of two versions of one module, both blocked on a not-yet-committed B03 row, finish without duplicate or deadlock', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const va = await draft(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
    const vb = await draft(moduleId, '2.0.0', validMic(moduleKey, '2.0.0'));
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    let inserted = false;
    // Holder: inserts ORDER for the module in an open talo_app transaction and rolls back when released (no data kept).
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(REGISTRY_SQL.insertFunction, moduleId, 'ORDER');
      inserted = true;
      await gate;
      throw new Error('HOLDER_ROLLBACK');
    }, { timeout: 30_000, maxWait: 5_000 }).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === 'HOLDER_ROLLBACK')) throw error;
    });
    try {
      await waitUntil('holder insert', async () => inserted);
      const a = submit(moduleId, va).then((r) => r);
      const b = submit(moduleId, vb).then((r) => r);
      await waitUntil('both SUBMITs waiting on the uncommitted ORDER row', async () => (await ungrantedLocks()) >= 2);
      const waiting = await ungrantedLocks();
      expect((await b02(va)).status).toBe('DRAFT');
      expect((await b02(vb)).status).toBe('DRAFT');
      release();
      await holder;
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const fns = await functionsOf(moduleId);
      expect(fns.map((f) => f.key)).toEqual(['ORDER', 'REPORT']); // one row per key
      expect(await actionsOf(moduleId)).toHaveLength(3);
      expect((await versionFunctionsOf(va)).map((x) => x.functionId).sort()).toEqual(fns.map((f) => f.id).sort());
      expect((await versionFunctionsOf(vb)).map((x) => x.functionId).sort()).toEqual(fns.map((f) => f.id).sort());
      expect(await ungrantedLocks()).toBe(0);
      expect(logs.some((l) => l.includes('40P01'))).toBe(false); // no deadlock
      evidence['v3'] = { waitersWhileHeld: waiting, statuses: [ra.status, rb.status] };
    } finally {
      release();
      await holder;
    }
  });

  it('V4: a failure in B03 / B04 / B05 / B06, a lookup miss, B07 or B08 → 503 and nothing of the SUBMIT is kept (B02 DRAFT, no registry rows)', async () => {
    await login();
    const cases: [Fault, string][] = [
      ['B03_CHECK', '23514'], ['B04_CHECK', '23514'], ['B05_FK', '23503'], ['B06_CHECK', '23514'], ['B03_LOOKUP_MISS', ''], ['B07', '23503'], ['B08', '23514'],
    ];
    const seen: Record<string, number> = {};
    for (const [f, code] of cases) {
      const { moduleId, moduleKey } = await newModule();
      const versionId = await draft(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
      fault = f;
      const res = await submit(moduleId, versionId);
      fault = 'NONE';
      seen[f] = res.status;
      expect(res.status, f).toBe(503);
      expect(await b02(versionId), f).toEqual({ status: 'DRAFT', hash: '<null>' });
      expect(await functionsOf(moduleId), f).toEqual([]);
      expect(await versionFunctionsOf(versionId), f).toEqual([]);
      expect(await countBy('fnd_module_events', rid(res)), f).toBe(0);
      expect(await countBy('fnd_audit_logs', rid(res)), f).toBe(0);
      if (code) expect(logs.some((l) => l.includes('submit version failed (rolled back)') && l.includes(`"sqlstate":"${code}"`)), f).toBe(true);
      // The same SUBMIT without the fault commits everything: nothing of the failed attempt remained.
      expect((await submit(moduleId, versionId)).status, f).toBe(200);
      expect((await versionFunctionsOf(versionId)).length, f).toBe(2);
    }
    evidence['v4'] = seen;
  });

  it('V5: mic02 name of 150 characters is stored in display_name; 151 → 422 MIC_SCHEMA_INVALID without registry rows', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const mic = validMic(moduleKey, '1.0.0');
    const named = (n: number) => ({ ...mic, mic02Functions: [{ ...mic.mic02Functions[0], name: 'Đ'.repeat(n) }, ...mic.mic02Functions.slice(1)] });
    const bad = await draft(moduleId, '1.0.0', named(151));
    const r151 = await submit(moduleId, bad);
    expect(r151.status).toBe(422);
    expect(r151.body.error.details.errors).toEqual(['MIC_SCHEMA_INVALID']);
    expect(await functionsOf(moduleId)).toEqual([]);
    expect((await b02(bad)).status).toBe('DRAFT');
    const good = await draft(moduleId, '2.0.0', { ...named(150), mic01Identity: { ...mic.mic01Identity, moduleVersion: '2.0.0' } });
    expect((await submit(moduleId, good)).status).toBe(200);
    const [vf] = (await versionFunctionsOf(good)).filter((x) => x.key === 'ORDER');
    expect(vf?.displayName).toBe('Đ'.repeat(150));
  });

  it('V6: MIC_INVALID and hash mismatch never write registry rows', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const invalid = await draft(moduleId, '1.0.0', { ...validMic(moduleKey, '1.0.0'), mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }] });
    expect((await submit(moduleId, invalid)).status).toBe(422);
    const mismatch = await draft(moduleId, '2.0.0', validMic(moduleKey, '2.0.0'));
    expect((await submit(moduleId, mismatch, { expectedManifestHash: 'f'.repeat(64) })).status).toBe(409);
    expect(await functionsOf(moduleId)).toEqual([]);
    expect(await versionFunctionsOf(invalid)).toEqual([]);
    expect(await versionFunctionsOf(mismatch)).toEqual([]);
  });

  it('V7: no backfill — registry rows exist only for versions submitted in this run; old IN_REVIEW versions keep none; no partial registry', async () => {
    const ids = uuidArray(runVersions.length ? runVersions : [NIL]);
    const [foreign] = await h.ok(`SELECT count(*) FROM foundation.fnd_version_functions WHERE NOT (version_id = ANY(${ids}))`);
    expect(Number(foreign?.[0])).toBe(registryBefore['fnd_version_functions']); // 0 before FBE-03: nothing backfilled
    const [partial] = await h.ok(`SELECT
        (SELECT count(*) FROM foundation.fnd_version_functions vf JOIN foundation.fnd_module_versions v ON v.version_id = vf.version_id WHERE v.status <> 'IN_REVIEW')
      + (SELECT count(*) FROM foundation.fnd_version_functions vf JOIN foundation.fnd_functions f ON f.function_id = vf.function_id
           JOIN foundation.fnd_module_versions v ON v.version_id = vf.version_id WHERE f.module_id <> v.module_id)
      + (SELECT count(*) FROM foundation.fnd_version_actions va JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id
           JOIN foundation.fnd_actions a ON a.action_id = va.action_id WHERE a.function_id <> vf.function_id)
      + (SELECT count(*) FROM foundation.fnd_module_versions v WHERE v.version_id = ANY(${ids}) AND v.status = 'IN_REVIEW'
           AND NOT EXISTS (SELECT 1 FROM foundation.fnd_version_functions vf WHERE vf.version_id = v.version_id)
           AND (v.manifest_json -> 'mic02Functions') <> '[]'::jsonb)`);
    expect(Number(partial?.[0])).toBe(0);
  });
});
