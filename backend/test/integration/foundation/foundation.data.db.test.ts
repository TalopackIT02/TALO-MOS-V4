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
import { COMPAT_SQL } from '../../../src/modules/foundation/foundation.compatibility.repository.js';
import { DATA_SQL } from '../../../src/modules/foundation/foundation.data.repository.js';
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

// FBE-04-VERIFY — Data Contracts (B10–B12) and the compatibility check (B13 / B14) materialised by SUBMIT, on
// PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1. Real Express app + auth + Foundation modules as
// talo_app (DATABASE_URL), Prisma pg adapter, real transactions and locks. Fixtures (talo_test_harness): AUTHT- accounts
// and FBET- IAM rows, removed by proven UUID. Foundation rows (B01–B14) are append-only (C2): never updated or deleted;
// keys FBET_<RUN>_<n>. Faults: a test-only FoundationDb wrapper changes ONE bind value so that PostgreSQL itself rejects
// the statement inside the real SUBMIT transaction. No source, data, grant or constraint is modified. No APPROVED /
// ACTIVE state is created, so the MIC-09 CHANGE comparison is NOT_TESTED here (unit coverage only, owner decision H1).

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create',
  update: 'foundation.module_version.update', submit: 'foundation.module_version.submit', read: 'foundation.module_version.read',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'read'];
const DATA_TABLES = ['fnd_data_contracts', 'fnd_data_fields', 'fnd_data_access_rules', 'fnd_compatibility_checks', 'fnd_compatibility_changes'];

type Fault = 'NONE' | 'B10_CHECK' | 'B11_WIDTH' | 'B12_FK' | 'B12_D09' | 'B06_LOOKUP_MISS' | 'B13_CHECK' | 'B14_CHECK' | 'B07' | 'B08';

// One bind value changed → a real PostgreSQL error (or a real empty lookup) inside the SUBMIT transaction.
//   B10_CHECK        insertContract contract_hash          → 'NOT-A-HASH'    23514 ck_fnd_data_contracts_contract_hash_format (N-06)
//   B11_WIDTH        insertField field_type                → 101 characters  22001 VARCHAR(100)
//   B12_FK           insertAccessRule version_action_id    → random UUID     23503 fk_fnd_data_access_rules_version_action_id
//   B12_D09          insertAccessRule REQUIRED workflow_key → NULL           23514 ck_fnd_data_access_rules_workflow_when_required
//   B06_LOOKUP_MISS  versionActions version_id             → random UUID     0 rows → guard → rollback
//   B13_CHECK        insertCheck environment               → 'QA'            23514 ck_fnd_compatibility_checks_environment (A-07)
//   B14_CHECK        insertChange change_area              → 'BOGUS'         23514 ck_fnd_compatibility_changes_area (N-10)
//   B07              insertSubmitEvent module_id           → random UUID     23503
//   B08              insertVersionAudit outcome SUCCESS    → 'BOGUS'         23514
function faultyDb(db: FoundationDb, fault: () => Fault): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    const set = (i: number, value: unknown) => params.map((p, j) => (j === i ? value : p));
    if (f === 'B10_CHECK' && sql === DATA_SQL.insertContract) return set(8, 'NOT-A-HASH');
    if (f === 'B11_WIDTH' && sql === DATA_SQL.insertField) return set(2, 't'.repeat(101));
    if (f === 'B12_FK' && sql === DATA_SQL.insertAccessRule) return set(1, randomUUID());
    if (f === 'B12_D09' && sql === DATA_SQL.insertAccessRule && params[3] === 'REQUIRED') return set(4, null);
    if (f === 'B06_LOOKUP_MISS' && sql === DATA_SQL.versionActions) return set(0, randomUUID());
    if (f === 'B13_CHECK' && sql === COMPAT_SQL.insertCheck) return set(3, 'QA');
    if (f === 'B14_CHECK' && sql === COMPAT_SQL.insertChange) return set(1, 'BOGUS');
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

// FBET- IAM authorisation fixtures (same ownership-proof cleanup as the FBE-01B / FBE-02C / FBE-03 suites).
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

describe.skipIf(!enabled)('FBE-04 Data Contracts and compatibility — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let fault: Fault = 'NONE';
  let cookie = '';
  const perm: Record<PermKey, string> = { registryCreate: '', create: '', update: '', submit: '', read: '' };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const keyPrefix = `FBET_${run}_`;
  let keySeq = 0;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};
  const runVersions: string[] = [];
  let dataBefore: Record<string, number> = {};

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
    await az.role(acc.accountId, PERM_KEYS.map((k) => perm[k]));
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    cookie = cookieOf(res);
  }
  async function newModule(): Promise<{ moduleId: string; moduleKey: string }> {
    const moduleKey = `${keyPrefix}${++keySeq}`;
    const res = await send('post', '/api/foundation/modules', { moduleKey, moduleName: `FBE-04 ${keySeq}`, moduleType: 'INTERNAL' });
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

  // Harness reads (SELECT on B01–B14).
  async function contractsOf(versionId: string) {
    const rows = await h.ok(`SELECT data_contract_id::text, resource_key, data_owner_key, interface_kind, coalesce(schema_name, '<null>'), coalesce(table_name, '<null>'),
        schema_version, contract_spec::text, contract_hash
      FROM foundation.fnd_data_contracts WHERE version_id = ${lit(versionId)} ORDER BY resource_key COLLATE "C"`);
    return rows.map((r) => ({
      id: r[0] ?? '', resourceKey: r[1], owner: r[2], kind: r[3], schema: r[4], table: r[5], schemaVersion: r[6], spec: JSON.parse(r[7] ?? 'null'), hash: r[8],
    }));
  }
  async function fieldsOf(versionId: string) {
    const rows = await h.ok(`SELECT c.resource_key, f.field_name, f.field_type, f.is_required, f.is_primary_key, coalesce(f.references_target, '<null>'),
        coalesce(f.description, '<null>'), coalesce(f.default_expression, '<null>')
      FROM foundation.fnd_data_fields f JOIN foundation.fnd_data_contracts c ON c.data_contract_id = f.data_contract_id
      WHERE c.version_id = ${lit(versionId)} ORDER BY c.resource_key COLLATE "C", f.field_name COLLATE "C"`);
    return rows.map((r) => r.map((x) => x ?? ''));
  }
  // Each rule with the Version of its Data Contract and the Version of its Version Action (B06 → B05).
  async function rulesOf(versionId: string) {
    const rows = await h.ok(`SELECT c.resource_key, fn.function_key, a.action_key, r.data_operation, r.approval_mode, coalesce(r.workflow_key, '<null>'), r.is_enabled,
        (vf.version_id = c.version_id)
      FROM foundation.fnd_data_access_rules r JOIN foundation.fnd_data_contracts c ON c.data_contract_id = r.data_contract_id
      JOIN foundation.fnd_version_actions va ON va.version_action_id = r.version_action_id
      JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id
      JOIN foundation.fnd_actions a ON a.action_id = va.action_id JOIN foundation.fnd_functions fn ON fn.function_id = a.function_id
      WHERE c.version_id = ${lit(versionId)} ORDER BY c.resource_key COLLATE "C", fn.function_key COLLATE "C", a.action_key COLLATE "C", r.data_operation`);
    return rows.map((r) => r.map((x) => x ?? ''));
  }
  async function checksOf(versionId: string) {
    const rows = await h.ok(`SELECT check_id::text, module_id::text, coalesce(from_version_id::text, '<null>'), environment, check_result,
        coalesce(database_fingerprint, '<null>'), (completed_at IS NOT NULL AND completed_at >= started_at)
      FROM foundation.fnd_compatibility_checks WHERE to_version_id = ${lit(versionId)}`);
    return rows.map((r) => ({ id: r[0] ?? '', moduleId: r[1], from: r[2], environment: r[3], result: r[4], fingerprint: r[5], completed: r[6] }));
  }
  async function changesOf(checkId: string) {
    const rows = await h.ok(`SELECT change_area, object_key, change_type, severity, coalesce(previous_value::text, '<null>'), proposed_value::text, resolution_status,
        coalesce(details, '<null>')
      FROM foundation.fnd_compatibility_changes WHERE check_id = ${lit(checkId)} ORDER BY change_area, object_key COLLATE "C"`);
    return rows.map((r) => ({
      area: r[0], key: r[1], type: r[2], severity: r[3], previous: r[4], proposed: JSON.parse(r[5] ?? 'null'), status: r[6], details: r[7],
    }));
  }
  async function dataCounts(): Promise<Record<string, number>> {
    const [r] = await h.ok(`SELECT ${DATA_TABLES.map((t) => `(SELECT count(*) FROM foundation.${t})`).join(', ')}`);
    return Object.fromEntries(DATA_TABLES.map((t, i) => [t, Number(r?.[i])]));
  }
  // Rows of B03–B14 that belong to one module / version (for the rollback checks).
  async function footprint(moduleId: string, versionId: string): Promise<number> {
    const [r] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_functions WHERE module_id = ${lit(moduleId)})
         + (SELECT count(*) FROM foundation.fnd_version_functions WHERE version_id = ${lit(versionId)})
         + (SELECT count(*) FROM foundation.fnd_data_contracts WHERE version_id = ${lit(versionId)})
         + (SELECT count(*) FROM foundation.fnd_compatibility_checks WHERE module_id = ${lit(moduleId)})`);
    return Number(r?.[0]);
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
      prisma, logger, production: false, hasher, breachedPasswords: new UnavailableBlocklist('not used by FBE-04-VERIFY'),
      loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }),
    });
    const db = faultyDb(prismaFoundationDb(prisma), () => fault);
    const foundation = createFoundationModule({
      prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST',
      repository: new SqlFoundationRepository(db), versionRepository: new SqlModuleVersionRepository(db), manifestRepository: new SqlManifestRepository(db, 'TEST'),
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
    dataBefore = await dataCounts();
    evidence['dataBefore'] = dataBefore;
  });

  afterEach(async () => {
    fault = 'NONE';
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    if (h) {
      evidence['dataAfter'] = await dataCounts();
      const ids = uuidArray(runVersions.length ? runVersions : [NIL]);
      const [foreign] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_data_contracts WHERE NOT (version_id = ANY(${ids})))
        + (SELECT count(*) FROM foundation.fnd_compatibility_checks WHERE NOT (to_version_id = ANY(${ids})))`);
      evidence['b10b13NotFromThisRun'] = Number(foreign?.[0]);
    }
    console.log(`[fbe04] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe04] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ FP-4

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

  it('FP4-1 / FP4-2: the 4 DATA_SQL + 3 COMPAT_SQL plan as talo_app; the B10–B14 privilege matrix is exact (Q12); forbidden statements → 42501 (EXPLAIN only)', async () => {
    const statements: [string, string, unknown[]][] = [
      ['insertContract', DATA_SQL.insertContract, [NIL, 'PLAN', 'PLAN', 'API', null, null, '1.0.0', '{}', 'a'.repeat(64)]],
      ['insertField', DATA_SQL.insertField, [NIL, 'plan', 'uuid', true, false, null, null]],
      ['versionActions', DATA_SQL.versionActions, [NIL]],
      ['insertAccessRule', DATA_SQL.insertAccessRule, [NIL, NIL, 'SELECT', 'UNSPECIFIED', null]],
      ['fromVersion', COMPAT_SQL.fromVersion, [NIL, '1.0.0']],
      ['insertCheck', COMPAT_SQL.insertCheck, [NIL, null, NIL, 'TEST', 'PASS']],
      ['insertChange', COMPAT_SQL.insertChange, [NIL, 'DATA', 'DATA:PLAN', 'ADDED', 'INFO', null, '{}']],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual([...Object.keys(DATA_SQL), ...Object.keys(COMPAT_SQL)].sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(statements.map((s) => [s[0], 'OK'])));
    const forbidden: Record<string, string> = {
      'UPDATE B10': `UPDATE foundation.fnd_data_contracts SET contract_hash = contract_hash`,
      'DELETE B10': `DELETE FROM foundation.fnd_data_contracts`,
      'INSERT B10.data_contract_id': `INSERT INTO foundation.fnd_data_contracts (data_contract_id, version_id, resource_key, data_owner_key, interface_kind, schema_version, contract_spec, contract_hash) VALUES ('${NIL}', '${NIL}', 'X', 'X', 'API', '1', '{}', '${'a'.repeat(64)}')`,
      'INSERT B10.created_at': `INSERT INTO foundation.fnd_data_contracts (version_id, resource_key, data_owner_key, interface_kind, schema_version, contract_spec, contract_hash, created_at) VALUES ('${NIL}', 'X', 'X', 'API', '1', '{}', '${'a'.repeat(64)}', now())`,
      'UPDATE B11': `UPDATE foundation.fnd_data_fields SET field_type = field_type`,
      'DELETE B11': `DELETE FROM foundation.fnd_data_fields`,
      'INSERT B11.default_expression': `INSERT INTO foundation.fnd_data_fields (data_contract_id, field_name, field_type, default_expression) VALUES ('${NIL}', 'x', 'x', 'now()')`,
      'SELECT B12': `SELECT 1 FROM foundation.fnd_data_access_rules`,
      'UPDATE B12.is_enabled': `UPDATE foundation.fnd_data_access_rules SET is_enabled = true`,
      'DELETE B12': `DELETE FROM foundation.fnd_data_access_rules`,
      'INSERT B12.is_enabled': `INSERT INTO foundation.fnd_data_access_rules (data_contract_id, version_action_id, data_operation, approval_mode, is_enabled) VALUES ('${NIL}', '${NIL}', 'SELECT', 'NOT_REQUIRED', true)`,
      'UPDATE B13': `UPDATE foundation.fnd_compatibility_checks SET check_result = 'PASS'`,
      'DELETE B13': `DELETE FROM foundation.fnd_compatibility_checks`,
      'INSERT B13.database_fingerprint': `INSERT INTO foundation.fnd_compatibility_checks (module_id, to_version_id, environment, database_fingerprint) VALUES ('${NIL}', '${NIL}', 'TEST', '${'a'.repeat(64)}')`,
      'INSERT B13.started_at': `INSERT INTO foundation.fnd_compatibility_checks (module_id, to_version_id, environment, started_at) VALUES ('${NIL}', '${NIL}', 'TEST', now())`,
      // FBE-05: SELECT on B14 is granted (BLOCKING check); the identity column stays not insertable.
      'INSERT B14.change_id': `INSERT INTO foundation.fnd_compatibility_changes (change_id, check_id, change_area, object_key, change_type, severity) VALUES ('${NIL}', '${NIL}', 'DATA', 'x', 'ADDED', 'INFO')`,
      'UPDATE B14.resolution_status': `UPDATE foundation.fnd_compatibility_changes SET resolution_status = 'RESOLVED'`,
      'DELETE B14': `DELETE FROM foundation.fnd_compatibility_changes`,
      'INSERT B14.resolution_status': `INSERT INTO foundation.fnd_compatibility_changes (check_id, change_area, object_key, change_type, severity, resolution_status) VALUES ('${NIL}', 'DATA', 'x', 'ADDED', 'INFO', 'RESOLVED')`,
      'INSERT B14.details': `INSERT INTO foundation.fnd_compatibility_changes (check_id, change_area, object_key, change_type, severity, details) VALUES ('${NIL}', 'DATA', 'x', 'ADDED', 'INFO', 'x')`,
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
        FROM unnest(ARRAY[${DATA_TABLES.map((t) => `'${t}'`).join(', ')}]) AS t ORDER BY t`);
    expect(matrix).toEqual([
      { t: 'fnd_compatibility_changes', sel: true, del: false, trunc: false, upd: false, ins: 'check_id,change_area,object_key,change_type,severity,previous_value,proposed_value' },
      { t: 'fnd_compatibility_checks', sel: true, del: false, trunc: false, upd: false, ins: 'module_id,from_version_id,to_version_id,environment,check_result,completed_at' },
      { t: 'fnd_data_access_rules', sel: false, del: false, trunc: false, upd: false, ins: 'data_contract_id,version_action_id,data_operation,approval_mode,workflow_key' },
      { t: 'fnd_data_contracts', sel: true, del: false, trunc: false, upd: false, ins: 'version_id,resource_key,data_owner_key,interface_kind,schema_name,table_name,schema_version,contract_spec,contract_hash' },
      { t: 'fnd_data_fields', sel: true, del: false, trunc: false, upd: false, ins: 'data_contract_id,field_name,field_type,is_required,is_primary_key,references_target,description' },
    ]);
    evidence['fp4Matrix'] = matrix;
  });

  it('FP4-3: talo_test_harness reads B10–B14 and cannot write them', async () => {
    for (const t of DATA_TABLES) {
      const [row] = await h.ok(`SELECT has_table_privilege('foundation.${t}', 'SELECT'), has_any_column_privilege('foundation.${t}', 'INSERT'),
        has_any_column_privilege('foundation.${t}', 'UPDATE'), has_table_privilege('foundation.${t}', 'DELETE'), has_table_privilege('foundation.${t}', 'TRUNCATE')`);
      expect(row, t).toEqual(['t', 'f', 'f', 'f', 'f']);
    }
  });

  it('FP4-4: Prisma adapter — RETURNING ids, boolean / JSONB binding, defaults, and the real SQLSTATEs of N-11 / D-09 / A-09 / N-10 / UNIQUE / FK / width; all rolled back', async () => {
    await login();
    const { moduleId } = await newModule();
    const versionId = await draft(moduleId, '1.0.0', { draft: true });
    const other = await newModule();
    const otherVersion = await draft(other.moduleId, '1.0.0', { draft: true });
    const outcome: Record<string, unknown> = {};
    const contract = (tx: SqlExecutor, over: Partial<Record<'key' | 'kind' | 'schema' | 'table', string | null>> = {}) =>
      tx.query(DATA_SQL.insertContract, [versionId, over.key ?? 'FP4', 'FP4_OWNER', over.kind ?? 'API', over.schema ?? null, over.table ?? null, '1.0.0', '{"a":1}', 'b'.repeat(64)]);
    const idOf = (rows: unknown[], column: string): string => {
      const [row] = rows;
      return typeof row === 'object' && row !== null && column in row ? String(Object.entries(row).find(([k]) => k === column)?.[1]) : NIL;
    };
    try {
      await prismaFoundationDb(prisma).transaction(async (tx) => {
        const cid = idOf(await contract(tx), 'data_contract_id');
        outcome['contractUuid'] = UUID.test(cid);
        outcome['field'] = await tx.execute(DATA_SQL.insertField, [cid, 'id', 'uuid', true, false, 'crm.customers.customer_id', null]);
        const check = idOf(await tx.query(COMPAT_SQL.insertCheck, [moduleId, null, versionId, 'TEST', 'PASS']), 'check_id');
        outcome['checkUuid'] = UUID.test(check);
        outcome['change'] = await tx.execute(COMPAT_SQL.insertChange, [check, 'DATA', 'DATA:FP4', 'ADDED', 'INFO', null, '{"a":1}']);
        throw new Error('ROLLBACK_SENTINEL');
      });
    } catch (error) {
      if (!(error instanceof Error && error.message === 'ROLLBACK_SENTINEL')) throw error;
    }
    expect(outcome).toEqual({ contractUuid: true, field: 1, checkUuid: true, change: 1 });
    const sqlstate = async (fn: (tx: SqlExecutor) => Promise<unknown>) => {
      try {
        await prismaFoundationDb(prisma).transaction(async (tx) => fn(tx));
        return 'none';
      } catch (error) {
        return sqlstateOf(error) ?? 'unknown';
      }
    };
    const states = {
      n11DirectDbBlankSchema: await sqlstate((tx) => contract(tx, { kind: 'DIRECT_DB', schema: '  ', table: 'orders' })),
      n06Hash: await sqlstate((tx) => tx.query(DATA_SQL.insertContract, [versionId, 'FP4', 'O', 'API', null, null, '1', '{}', 'NOT-A-HASH'])),
      uniqueContract: await sqlstate(async (tx) => { await contract(tx); return contract(tx); }),
      fkContractVersion: await sqlstate((tx) => tx.query(DATA_SQL.insertContract, [randomUUID(), 'FP4', 'O', 'API', null, null, '1', '{}', 'b'.repeat(64)])),
      widthFieldType: await sqlstate(async (tx) => tx.execute(DATA_SQL.insertField, [idOf(await contract(tx), 'data_contract_id'), 'id', 't'.repeat(101), false, false, null, null])),
      uniqueField: await sqlstate(async (tx) => {
        const cid = idOf(await contract(tx), 'data_contract_id');
        await tx.execute(DATA_SQL.insertField, [cid, 'id', 'uuid', false, false, null, null]);
        return tx.execute(DATA_SQL.insertField, [cid, 'id', 'text', false, false, null, null]);
      }),
      d09RequiredWithoutWorkflow: await sqlstate(async (tx) => tx.execute(DATA_SQL.insertAccessRule, [idOf(await contract(tx), 'data_contract_id'), NIL, 'SELECT', 'REQUIRED', ' '])),
      fkRuleVersionAction: await sqlstate(async (tx) => tx.execute(DATA_SQL.insertAccessRule, [idOf(await contract(tx), 'data_contract_id'), randomUUID(), 'SELECT', 'NOT_REQUIRED', null])),
      a09SameVersions: await sqlstate((tx) => tx.query(COMPAT_SQL.insertCheck, [moduleId, versionId, versionId, 'TEST', 'PASS'])),
      fkToVersionOfOtherModule: await sqlstate((tx) => tx.query(COMPAT_SQL.insertCheck, [moduleId, null, otherVersion, 'TEST', 'PASS'])),
      a07Environment: await sqlstate((tx) => tx.query(COMPAT_SQL.insertCheck, [moduleId, null, versionId, 'QA', 'PASS'])),
      n10ChangeArea: await sqlstate(async (tx) => tx.execute(COMPAT_SQL.insertChange, [
        idOf(await tx.query(COMPAT_SQL.insertCheck, [moduleId, null, versionId, 'TEST', 'PASS']), 'check_id'), 'BOGUS', 'x', 'ADDED', 'INFO', null, null,
      ])),
    };
    expect(states).toEqual({
      n11DirectDbBlankSchema: '23514', n06Hash: '23514', uniqueContract: '23505', fkContractVersion: '23503', widthFieldType: '22001', uniqueField: '23505',
      d09RequiredWithoutWorkflow: '23514', fkRuleVersionAction: '23503', a09SameVersions: '23514', fkToVersionOfOtherModule: '23503', a07Environment: '23514',
      n10ChangeArea: '23514',
    });
    expect(await contractsOf(versionId)).toEqual([]); // everything rolled back
    expect(await checksOf(versionId)).toEqual([]);
    evidence['fp4Adapter'] = { outcome, states };
  });

  // ------------------------------------------------------------------ SUBMIT materialisation

  it('V1: SUBMIT writes B10 / B11 / B12 / B13 / B14 with the approved mapping (Q3, Q4, Q7–Q10); hashes recomputed from the stored JSONB; B07 / B08 unchanged', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const mic = validMic(moduleKey, '1.0.0');
    const versionId = await draft(moduleId, '1.0.0', mic);
    const res = await submit(moduleId, versionId);
    expect(res.status).toBe(200);
    const contracts = await contractsOf(versionId);
    expect(contracts.map((c) => [c.resourceKey, c.owner, c.kind, c.schema, c.table, c.schemaVersion])).toEqual([
      ['ORDERS', 'SALES_DATA', 'DIRECT_DB', 'sales', 'orders', '1.0.0'],
      ['ORDER_FEED', moduleKey, 'API', '<null>', '<null>', '1.0.0'],
    ]);
    for (const c of contracts) {
      expect(c.spec).toEqual(mic.mic06DataResources.find((r) => r.resourceKey === c.resourceKey)); // JSONB round trip
      expect(c.hash).toBe(canonicalDigest(c.spec).sha256); // hash recomputed from the stored JSONB
    }
    expect(await fieldsOf(versionId)).toEqual([
      ['ORDERS', 'customer_id', 'uuid', 'f', 'f', 'crm.customers.customer_id', 'Khách hàng', '<null>'],
      ['ORDERS', 'order_id', 'uuid', 't', 't', '<null>', '<null>', '<null>'],
    ]);
    expect(await rulesOf(versionId)).toEqual([
      ['ORDERS', 'ORDER', 'CREATE', 'INSERT', 'REQUIRED', 'SALES_ORDER_APPROVAL', 'f', 't'],
      ['ORDERS', 'ORDER', 'READ', 'SELECT', 'NOT_REQUIRED', '<null>', 'f', 't'],
      ['ORDER_FEED', 'REPORT', 'READ', 'SELECT', 'UNSPECIFIED', '<null>', 'f', 't'],
    ]);
    const checks = await checksOf(versionId);
    expect(checks.map((c) => [c.moduleId, c.from, c.environment, c.result, c.fingerprint, c.completed])).toEqual([[moduleId, '<null>', 'TEST', 'PASS', '<null>', 't']]);
    const changes = await changesOf(checks[0]?.id ?? NIL);
    expect(changes.map((c) => [c.area, c.key, c.type, c.severity, c.previous, c.status, c.details])).toEqual([
      ['ACTION', 'ACTION:ORDER.CREATE', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'], ['ACTION', 'ACTION:ORDER.READ', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'],
      ['ACTION', 'ACTION:REPORT.READ', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'],
      ['DATA', 'DATA:ORDERS', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'], ['DATA', 'DATA:ORDER_FEED', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'],
      ['FUNCTION', 'FUNCTION:ORDER', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'], ['FUNCTION', 'FUNCTION:REPORT', 'ADDED', 'INFO', '<null>', 'OPEN', '<null>'],
    ]);
    expect(changes.find((c) => c.key === 'DATA:ORDERS')?.proposed).toEqual(mic.mic06DataResources[1]);
    expect(changes.find((c) => c.key === 'FUNCTION:ORDER')?.proposed).toEqual(mic.mic02Functions[0]);
    const hash = canonicalDigest(mic).sha256;
    expect(await b02(versionId)).toEqual({ status: 'IN_REVIEW', hash });
    const [event] = await h.ok(`SELECT event_type, after_state::text FROM foundation.fnd_module_events WHERE correlation_id = ${lit(rid(res))}`);
    expect([event?.[0], JSON.parse(event?.[1] ?? 'null')]).toEqual(['SUBMIT', { status: 'IN_REVIEW', manifest_hash: hash }]);
    const [audit] = await h.ok(`SELECT action_code, outcome, metadata::text FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(rid(res))}`);
    expect([audit?.[0], audit?.[1], JSON.parse(audit?.[2] ?? 'null')]).toEqual(['MODULE_VERSION.SUBMIT', 'SUCCESS', { v: 1, reason: 'SUBMITTED', requestId: rid(res), manifestHash: hash }]);
    evidence['v1'] = { moduleId, versionId, contracts: contracts.length, checks: checks.length, changes: changes.length };
  });

  it('V2: same Version — two versions of one module with the same keys: each B12 row points to a B06 row of its own version', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const v1 = await draft(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
    expect((await submit(moduleId, v1)).status).toBe(200);
    const v2 = await draft(moduleId, '1.1.0', validMic(moduleKey, '1.1.0'));
    expect((await submit(moduleId, v2)).status).toBe(200);
    for (const v of [v1, v2]) {
      const rules = await rulesOf(v);
      expect(rules, v).toHaveLength(3);
      expect(rules.every((r) => r[7] === 't'), v).toBe(true);
    }
    expect((await contractsOf(v2)).map((c) => c.schemaVersion)).toEqual(['1.1.0', '1.1.0']);
    expect((await checksOf(v2)).map((c) => [c.from, c.result])).toEqual([['<null>', 'PASS']]); // v1 is IN_REVIEW: INITIAL again
  });

  it('V3: MIC-06 rules at the backend — DATA_* codes → 422 MIC_INVALID with no B03–B14 row (N-11 DIRECT_DB target, D-09 workflow, unknown action, duplicates, K10)', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const mic = validMic(moduleKey, '1.0.0');
    const [feed, orders] = mic.mic06DataResources;
    const cases: [string, unknown[], string][] = [
      ['1.0.0', [{ ...orders, schema: '   ' }], 'DATA_DIRECT_DB_TARGET_MISSING'],
      ['1.0.1', [{ ...orders, access: [{ functionKey: 'ORDER', actionKey: 'CREATE', operation: 'INSERT', approvalMode: 'REQUIRED' }] }], 'DATA_WORKFLOW_REQUIRED'],
      ['1.0.2', [{ ...feed, access: [{ functionKey: 'ORDER', actionKey: 'DELETE', operation: 'DELETE' }] }], 'DATA_ACCESS_ACTION_UNKNOWN'],
      ['1.0.3', [feed, feed], 'DATA_RESOURCE_KEY_DUPLICATE'],
      ['1.0.4', [{ ...orders, columns: [{ name: 'id', type: 'uuid', references: 'Crm.Customers.Id' }] }], 'DATA_REFERENCE_INVALID'],
    ];
    for (const [version, resources, code] of cases) {
      const versionId = await draft(moduleId, version, { ...mic, mic01Identity: { ...mic.mic01Identity, moduleVersion: version }, mic06DataResources: resources });
      const res = await submit(moduleId, versionId);
      expect(res.status, code).toBe(422);
      expect(res.body.error.details.errors, code).toEqual([code]);
      expect(await footprint(moduleId, versionId), code).toBe(0);
      expect((await b02(versionId)).status, code).toBe('DRAFT');
    }
  });

  it('V4: a failure in B10 / B11 / B12 / B13 / B14, a B06 lookup miss, B07 or B08 → 503 and nothing of the SUBMIT is kept (B02 DRAFT, no B03–B14 rows)', async () => {
    await login();
    const cases: [Fault, string][] = [
      ['B10_CHECK', '23514'], ['B11_WIDTH', '22001'], ['B12_FK', '23503'], ['B12_D09', '23514'], ['B06_LOOKUP_MISS', ''], ['B13_CHECK', '23514'], ['B14_CHECK', '23514'],
      ['B07', '23503'], ['B08', '23514'],
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
      expect(await footprint(moduleId, versionId), f).toBe(0);
      expect(await countBy('fnd_module_events', rid(res)), f).toBe(0);
      expect(await countBy('fnd_audit_logs', rid(res)), f).toBe(0);
      if (code) expect(logs.some((l) => l.includes('submit version failed (rolled back)') && l.includes(`"sqlstate":"${code}"`)), f).toBe(true);
      // The same SUBMIT without the fault commits everything: nothing of the failed attempt remained.
      expect((await submit(moduleId, versionId)).status, f).toBe(200);
      expect((await contractsOf(versionId)).length, f).toBe(2);
      expect((await checksOf(versionId)).length, f).toBe(1);
    }
    evidence['v4'] = seen;
  });

  it('V5: concurrency — two SUBMITs of one module held on an uncommitted B03 row run B10–B14 together without deadlock; a double SUBMIT of one version writes once', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const va = await draft(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
    const vb = await draft(moduleId, '2.0.0', validMic(moduleKey, '2.0.0'));
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    let inserted = false;
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
      release();
      await holder;
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      for (const v of [va, vb]) {
        expect((await contractsOf(v)).length, v).toBe(2);
        expect((await rulesOf(v)).every((r) => r[7] === 't'), v).toBe(true);
        expect((await checksOf(v)).length, v).toBe(1);
      }
      expect(await ungrantedLocks()).toBe(0);
      expect(logs.some((l) => l.includes('40P01'))).toBe(false); // no deadlock
    } finally {
      release();
      await holder;
    }
    const vc = await draft(moduleId, '3.0.0', validMic(moduleKey, '3.0.0'));
    const [r1, r2] = await Promise.all([submit(moduleId, vc), submit(moduleId, vc)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await contractsOf(vc)).length).toBe(2);
    expect((await checksOf(vc)).length).toBe(1);
  });

  it('V6: MIC_INVALID, hash mismatch and a non-DRAFT version never write B10–B14; CHANGE without an eligible version → 422 without B13', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const invalid = await draft(moduleId, '1.0.0', { ...validMic(moduleKey, '1.0.0'), mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }] });
    expect((await submit(moduleId, invalid)).status).toBe(422);
    const mismatch = await draft(moduleId, '2.0.0', validMic(moduleKey, '2.0.0'));
    expect((await submit(moduleId, mismatch, { expectedManifestHash: 'f'.repeat(64) })).status).toBe(409);
    const change = await draft(moduleId, '3.0.0', { ...validMic(moduleKey, '3.0.0'), mic09Compatibility: { kind: 'CHANGE', fromVersion: '2.0.0', changes: ['x'] } });
    const rc = await submit(moduleId, change);
    expect(rc.status).toBe(422);
    expect(rc.body.error.details.errors).toEqual(['COMPATIBILITY_KIND_INVALID']);
    for (const v of [invalid, mismatch, change]) expect(await footprint(moduleId, v), v).toBe(0);
    expect((await submit(moduleId, mismatch)).status).toBe(200);
    const before = await dataCounts();
    expect((await submit(moduleId, mismatch)).status).toBe(409); // already IN_REVIEW
    expect(await dataCounts()).toEqual(before);
  });

  it('V7: no backfill — B10 / B13 rows of other versions did not grow during this run; no partial Data Contract; every check of this run is PASS', async () => {
    const ids = uuidArray(runVersions.length ? runVersions : [NIL]);
    const [foreign] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_data_contracts WHERE NOT (version_id = ANY(${ids}))),
        (SELECT count(*) FROM foundation.fnd_compatibility_checks WHERE NOT (to_version_id = ANY(${ids})))`);
    expect([Number(foreign?.[0]), Number(foreign?.[1])]).toEqual([dataBefore['fnd_data_contracts'], dataBefore['fnd_compatibility_checks']]); // 0 before FBE-04
    const [partial] = await h.ok(`SELECT
        (SELECT count(*) FROM foundation.fnd_data_contracts c JOIN foundation.fnd_module_versions v ON v.version_id = c.version_id WHERE v.status = 'DRAFT') -- FBE-05: submitted versions move on to APPROVED / ACTIVE / …; only a DRAFT may never have rows
      + (SELECT count(*) FROM foundation.fnd_module_versions v WHERE v.version_id = ANY(${ids}) AND v.status = 'IN_REVIEW'
           AND NOT EXISTS (SELECT 1 FROM foundation.fnd_compatibility_checks k WHERE k.to_version_id = v.version_id))
      + (SELECT count(*) FROM foundation.fnd_module_versions v WHERE v.version_id = ANY(${ids}) AND v.status = 'IN_REVIEW'
           AND jsonb_array_length(v.manifest_json -> 'mic06DataResources') <> (SELECT count(*) FROM foundation.fnd_data_contracts c WHERE c.version_id = v.version_id))
      + (SELECT count(*) FROM foundation.fnd_compatibility_checks k WHERE k.to_version_id = ANY(${ids}) AND k.check_result <> 'PASS')`);
    expect(Number(partial?.[0])).toBe(0);
  });
});
