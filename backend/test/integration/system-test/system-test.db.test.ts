import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import type { PermissionRef } from '../../../src/modules/foundation/foundation.permissions.js';
import { createSystemTestModule } from '../../../src/modules/system-test/index.js';
import { systemTestMic } from '../../../src/modules/system-test/system-test.mic.js';
import type { SystemTestBinding } from '../../../src/modules/system-test/system-test.permissions.js';
import { REGRESSION_FORMAT } from '../../../src/modules/system-test/system-test.results.js';
import { VIEWER_TABLES } from '../../../src/modules/system-test/system-test.tables.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// MOD-TEST-01 — SYSTEM_TEST module on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1.
// The REAL module code (createSystemTestModule: AccessGuard → lifecycle gate → read-only SQL as talo_app) is exercised
// against ONE fixture module FBET_ST_<RUN> that carries the SYSTEM_TEST MIC under a fixture key, so that DISABLE /
// RETIRE / DENY can be proven without touching the registered SYSTEM_TEST module. The fixture permissions follow K05 for
// the fixture key (talo_test_harness, FBE-06B grant) and are removed with UUID ownership proof. Foundation rows are
// append-only (C2) and are never written by SQL here; the Data Viewer is compared with direct reads of the harness.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create', update: 'foundation.module_version.update',
  submit: 'foundation.module_version.submit', approve: 'foundation.module_version.approve', activate: 'foundation.module_version.activate',
  retire: 'foundation.module_version.retire', enable: 'foundation.module_registry.enable', disable: 'foundation.module_registry.disable',
  navigation: 'foundation.navigation.manage',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'approve', 'activate', 'retire', 'enable', 'disable', 'navigation'];
const READABLE = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B09', 'B10', 'B11', 'B13', 'B14'];
const NOT_READABLE = ['B07', 'B08', 'B12'];
const ROUTES = ['/system-test', '/system-test/data', '/system-test/runner'];

class AuthzFixtures {
  readonly roles: string[] = [];
  readonly userRoles: string[] = [];
  readonly userPermissions: string[] = [];
  readonly permissions: string[] = [];
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

  async direct(accountId: string, permissionId: string, effect: 'ALLOW' | 'DENY'): Promise<string> {
    const id = randomUUID();
    this.userPermissions.push(id);
    await this.h.ok(`INSERT INTO iam.iam_user_permissions (user_permission_id, user_account_id, permission_id, effect, reason)
      VALUES (${lit(id)}, ${lit(accountId)}, ${lit(permissionId)}, ${lit(effect)}, ${lit(`${this.runTag} fixture`)})`);
    return id;
  }

  // Removes ONE direct grant of this run, after proving it (UUID created here, account of this run, fixture reason).
  async revokeDirect(id: string): Promise<void> {
    if (!this.userPermissions.includes(id)) throw new Error('direct grant not created by this run');
    const accounts = uuidArray(this.accounts().length ? this.accounts() : [NIL]);
    const [proof] = await this.h.ok(`SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ${lit(id)} AND user_account_id = ANY(${accounts}) AND reason = ${lit(`${this.runTag} fixture`)}`);
    if (proof?.[0] !== '1') throw new Error('direct grant ownership could not be proven');
    const [deleted] = await this.h.ok(`WITH d AS (DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ${lit(id)} AND user_account_id = ANY(${accounts}) RETURNING 1) SELECT count(*) FROM d`);
    if (deleted?.[0] !== '1') throw new Error('direct grant revoke failed');
    this.userPermissions.splice(this.userPermissions.indexOf(id), 1);
  }

  // A permission definition owned by this run: explicit UUID, code prefixed with the run tag, module_code = a fixture module key.
  async definePermission(moduleKey: string, resourceCode: string, operation: string): Promise<{ id: string; ref: PermissionRef }> {
    if (!moduleKey.startsWith(this.moduleKeyPrefix)) throw new Error('permission fixture must target a module of this run');
    const id = randomUUID();
    const permissionCode = `${this.permissionPrefix}.${moduleKey.toLowerCase()}.${resourceCode.toLowerCase()}.${operation.toLowerCase()}`;
    this.permissions.push(id);
    await this.h.ok(`INSERT INTO iam.iam_permissions (permission_id, permission_code, module_code, resource_code, operation, minimum_assurance_level)
      VALUES (${lit(id)}, ${lit(permissionCode)}, ${lit(moduleKey)}, ${lit(resourceCode)}, ${lit(operation)}, 1)`);
    return { id, ref: { permissionCode, moduleCode: moduleKey, resourceCode, operation } };
  }

  private get permissionPrefix(): string {
    return this.runTag.toLowerCase();
  }

  private get moduleKeyPrefix(): string {
    return this.runTag.replace('FBET-', 'FBET_ST_'); // MOD-TEST-01: the single fixture module of the run
  }

  async cleanup(): Promise<Record<string, number>> {
    const accounts = uuidArray(this.accounts().length ? this.accounts() : [NIL]);
    const roles = uuidArray(this.roles.length ? this.roles : [NIL]);
    const userRoles = uuidArray(this.userRoles.length ? this.userRoles : [NIL]);
    const userPerms = uuidArray(this.userPermissions.length ? this.userPermissions : [NIL]);
    const perms = uuidArray(this.permissions.length ? this.permissions : [NIL]);
    const [foreign] = await this.h.ok(`
      SELECT (SELECT count(*) FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code NOT LIKE ${lit(`${this.runTag}-R%`)})
           + (SELECT count(*) FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND NOT (user_account_id = ANY(${accounts}) AND role_id = ANY(${roles})))
           + (SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) AND NOT (user_account_id = ANY(${accounts})))
           + (SELECT count(*) FROM iam.iam_user_roles WHERE role_id = ANY(${roles}) AND NOT (user_role_id = ANY(${userRoles})))
           + (SELECT count(*) FROM iam.iam_permissions WHERE permission_id = ANY(${perms})
                AND NOT (permission_code LIKE ${lit(`${this.permissionPrefix}.%`)} AND module_code LIKE ${lit(`${this.moduleKeyPrefix}%`)}))
           + (SELECT count(*) FROM iam.iam_role_permissions WHERE permission_id = ANY(${perms}) AND NOT (role_id = ANY(${roles})))
           + (SELECT count(*) FROM iam.iam_user_permissions WHERE permission_id = ANY(${perms}) AND NOT (user_permission_id = ANY(${userPerms}) AND user_account_id = ANY(${accounts})))`);
    if (foreign?.[0] !== '0') throw new Error('authz cleanup refused: ownership could not be proven');
    const steps: [string, string][] = [
      ['user_permissions', `DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) AND user_account_id = ANY(${accounts})`],
      ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND user_account_id = ANY(${accounts})`],
      ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
      ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code LIKE ${lit(`${this.runTag}-R%`)}`],
      ['permissions', `DELETE FROM iam.iam_permissions WHERE permission_id = ANY(${perms}) AND permission_code LIKE ${lit(`${this.permissionPrefix}.%`)}
         AND module_code LIKE ${lit(`${this.moduleKeyPrefix}%`)}`],
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
           + (SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) OR user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_role_permissions WHERE role_id = ANY(${roles}))
           + (SELECT count(*) FROM iam.iam_permissions WHERE permission_id = ANY(${perms}) OR permission_code LIKE ${lit(`${this.permissionPrefix}.%`)})`);
    if (after?.[0] !== '0') throw new Error(`authz cleanup post-check failed: ${after?.[0]} rows remain`);
    this.roles.length = 0;
    this.userRoles.length = 0;
    this.userPermissions.length = 0;
    this.permissions.length = 0;
    return deleted;
  }
}

describe.skipIf(!enabled)('MOD-TEST-01 SYSTEM_TEST module — PostgreSQL (talo_mos_v4_test)', { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let resultsDir = '';
  const perm: Record<PermKey, string> = { registryCreate: '', create: '', update: '', submit: '', approve: '', activate: '', retire: '', enable: '', disable: '', navigation: '' };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const moduleKey = `FBET_ST_${run}`;
  const refs: { diagnostics: PermissionRef; dataViewer: PermissionRef; testRunner: PermissionRef } = {
    diagnostics: { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'DIAGNOSTICS', operation: 'READ' },
    dataViewer: { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'DATA_VIEWER', operation: 'READ' },
    testRunner: { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'TEST_RUNNER', operation: 'EXECUTE' },
  };
  // Late-bound: the fixture permission codes exist only once the test has created them.
  const binding: SystemTestBinding = {
    moduleKey,
    get diagnosticsRead() { return refs.diagnostics; },
    get dataViewerRead() { return refs.dataViewer; },
    get testRunnerExecute() { return refs.testRunner; },
  };
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};
  let iamBaseline: string[] = [];
  let aclBaseline = '';
  let foundationBefore: string[] = [];

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
  const send = (method: 'post' | 'put', url: string, as: string, body: unknown = {}) =>
    request(app)[method](`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body));
  const get = (url: string, as?: string) => {
    const r = request(app).get(`/api${url}`).set('User-Agent', fx.userAgent);
    return as === undefined ? r : r.set('Cookie', as);
  };
  async function login(permissionIds: readonly string[]): Promise<{ accountId: string; cookie: string }> {
    const acc = await fx.create();
    if (permissionIds.length > 0) await az.role(acc.accountId, permissionIds);
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    return { accountId: acc.accountId, cookie: cookieOf(res) };
  }
  type MenuJson = { navigationId: string; routePath: string | null; children: MenuJson[] };
  const flatten = (nodes: MenuJson[]): MenuJson[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
  async function routes(as: string): Promise<string[]> {
    const res = await get('/foundation/navigation', as);
    expect(res.status).toBe(200);
    return flatten(res.body.navigation).map((n) => n.routePath).filter((r): r is string => r !== null && ROUTES.includes(r)).sort();
  }
  async function auditsOf(requestId: string) {
    return (await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(module_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)} ORDER BY occurred_at, action_code`)).map((r) => ({
      action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], moduleId: r[4], metadata: JSON.parse(r[5] ?? 'null'),
    }));
  }
  const foundationCounts = async () => (await h.ok(`SELECT ${VIEWER_TABLES.map((t) => `(SELECT count(*) FROM foundation.${t.table})`).join(', ')}`))[0] ?? [];
  const aclFingerprint = async () => (await h.ok(`SELECT md5(string_agg(x, ';' ORDER BY x)) FROM (
      SELECT c.relname || '=' || coalesce(c.relacl::text, '') AS x FROM pg_class c WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace) AND c.relkind = 'r'
      UNION ALL SELECT c.relname || '.' || a.attname || '=' || a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace) AND c.relkind = 'r' AND a.attacl IS NOT NULL) s`))[0]?.[0] ?? '';
  const iamState = async () => ((await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions), (SELECT count(*) FROM iam.iam_roles),
      (SELECT count(*) FROM iam.iam_role_permissions) + (SELECT count(*) FROM iam.iam_user_roles) + (SELECT count(*) FROM iam.iam_user_permissions),
      (SELECT count(*) FROM iam.iam_audit_logs)`))[0] ?? []).map((x) => x ?? '');

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [identity] = await prisma.$queryRawUnsafe<{ db: string; usr: string }[]>(`SELECT current_database() AS db, current_user AS usr`);
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app') throw new Error('guard: API must run as talo_app on talo_mos_v4_test');
    evidence['runtime'] = identity;
    resultsDir = await mkdtemp(join(tmpdir(), 'st-db-results-'));
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({ prisma, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
    const foundation = createFoundationModule({ prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST' });
    const systemTest = createSystemTestModule({
      prisma, authService: auth.service, navigation: foundation.navigationService, logger, secureCookie: false, binding, resultsFile: join(resultsDir, 'regression-latest.json'),
    });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router, systemTest.router] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    az = new AuthzFixtures(h, `FBET-${run}`, () => fx.accounts);
    await fx.assertNoLeftovers();
    await az.assertNoLeftovers();
    for (const key of PERM_KEYS) {
      const [row] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(PERMS[key])} AND module_code = 'FOUNDATION' AND minimum_assurance_level = 1`);
      if (!row?.[0] || !UUID.test(row[0])) throw new Error(`permission ${PERMS[key]} not registered`);
      perm[key] = row[0];
    }
    iamBaseline = await iamState();
    aclBaseline = await aclFingerprint();
    foundationBefore = (await foundationCounts()).map((x) => x ?? '');
    evidence['iamBaseline'] = iamBaseline;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    console.log(`[mod-test-01] run ${run} module ${moduleKey} deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[mod-test-01] evidence ${JSON.stringify(evidence)}`);
    if (resultsDir) await rm(resultsDir, { recursive: true, force: true });
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  it('ST-01 … ST-11: fixture module with the SYSTEM_TEST MIC through Foundation, navigation, IAM, Data Viewer, checks, results and lifecycle', async () => {
    // ST-01 — registration + MIC SUBMIT through the Foundation API (B01, B02, B03–B06, B10–B13).
    const admin = await login(PERM_KEYS.map((k) => perm[k]));
    const reg = await send('post', '/foundation/modules', admin.cookie, { moduleKey, moduleName: 'System Test & Diagnostics', moduleType: 'INTERNAL' });
    expect(reg.status).toBe(201);
    const moduleId = String(reg.body.module.moduleId);
    const created = await send('post', `/foundation/modules/${moduleId}/versions`, admin.cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    const versionId = String(created.body.version.versionId);
    const base = `/foundation/modules/${moduleId}/versions/${versionId}`;
    const mic = systemTestMic(moduleKey, [{ name: 'MOD-TEST-01 unit', result: 'PASS', reference: 'test/unit/system-test/system-test.test.ts' }]);
    expect((await send('put', `${base}/manifest`, admin.cookie, { manifest: mic })).status).toBe(200);
    const hash = canonicalDigest(mic).sha256;
    const sub = await send('post', `${base}/submit`, admin.cookie, { expectedManifestHash: hash });
    expect(sub.status).toBe(200);
    expect(sub.body.version).toMatchObject({ status: 'IN_REVIEW', manifestHash: hash });
    const fns = await h.ok(`SELECT f.function_key, f.function_id::text FROM foundation.fnd_functions f WHERE f.module_id = ${lit(moduleId)} ORDER BY f.function_key`);
    expect(fns.map((r) => r[0])).toEqual(['DATA_VIEWER', 'DIAGNOSTICS', 'TEST_RUNNER']);
    const fnId = (key: string) => fns.find((r) => r[0] === key)?.[1] ?? NIL;
    const [counts] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_version_actions va JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id WHERE vf.version_id = ${lit(versionId)}),
      (SELECT string_agg(resource_key || ':' || interface_kind, ',' ORDER BY resource_key) FROM foundation.fnd_data_contracts WHERE version_id = ${lit(versionId)}),
      (SELECT count(*) FROM foundation.fnd_data_fields d JOIN foundation.fnd_data_contracts c ON c.data_contract_id = d.data_contract_id WHERE c.version_id = ${lit(versionId)}),
      (SELECT count(*) FROM foundation.fnd_data_access_rules r JOIN foundation.fnd_data_contracts c ON c.data_contract_id = r.data_contract_id WHERE c.version_id = ${lit(versionId)}),
      (SELECT check_result FROM foundation.fnd_compatibility_checks WHERE to_version_id = ${lit(versionId)})`);
    expect(counts).toEqual(['3', 'SYSTEM_STATUS:API,TABLE_PREVIEW:API,TEST_RESULTS:API', '15', '3', 'PASS']);

    // ST-02 — APPROVE → ACTIVATE → ENABLE through the Foundation API.
    expect((await send('post', `${base}/approve`, admin.cookie)).status).toBe(200);
    expect((await send('post', `${base}/activate`, admin.cookie)).status).toBe(200);
    expect((await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie)).status).toBe(200);
    expect(await h.ok(`SELECT v.status, m.is_enabled::text FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE v.version_id = ${lit(versionId)}`))
      .toEqual([['ACTIVE', 'true']]);

    // Navigation items (B09) through the management API: one group and the three Function items.
    const grp = await send('post', '/foundation/navigation/items', admin.cookie, { moduleId, menuTitle: `FBET ST ${run}`, sortOrder: 90 });
    expect(grp.status).toBe(201);
    const groupId = String(grp.body.item.navigationId);
    for (const [i, key] of ['DIAGNOSTICS', 'DATA_VIEWER', 'TEST_RUNNER'].entries()) {
      expect((await send('post', '/foundation/navigation/items', admin.cookie, { parentId: groupId, moduleId, functionId: fnId(key), menuTitle: key, sortOrder: i })).status).toBe(201);
    }

    // Fixture permissions with the K05 triple of the fixture key; three accounts: full, diagnostics only, none.
    const d = await az.definePermission(moduleKey, 'DIAGNOSTICS', 'READ');
    const v = await az.definePermission(moduleKey, 'DATA_VIEWER', 'READ');
    const r = await az.definePermission(moduleKey, 'TEST_RUNNER', 'EXECUTE');
    refs.diagnostics = d.ref;
    refs.dataViewer = v.ref;
    refs.testRunner = r.ref;
    const full = await login([d.id, v.id, r.id]);
    const partial = await login([d.id]);
    const outsider = await login([]);

    // ST-03 — navigation follows IAM ALLOW per Function.
    expect(await routes(full.cookie)).toEqual(['/system-test', '/system-test/data', '/system-test/runner']);
    expect(await routes(partial.cookie)).toEqual(['/system-test']);
    expect(await routes(outsider.cookie)).toEqual([]);
    expect(await routes(admin.cookie)).toEqual([]); // Foundation administration grants no module permission

    // ST-04 — no grant: hidden and 403 + B08 DENIED; Direct DENY hides the Function and blocks its API; revoke restores.
    const refused = await get('/system-test/health', outsider.cookie);
    expect(refused.status).toBe(403);
    expect(await auditsOf(rid(refused))).toEqual([{
      action: 'SYSTEM_TEST.DIAGNOSTICS.READ', outcome: 'DENIED', targetType: 'SYSTEM_TEST_API', targetId: '<null>', moduleId: '<null>',
      metadata: { v: 1, reason: 'NO_VALID_ALLOW', requestId: rid(refused) },
    }]);
    expect((await get('/system-test/tables', partial.cookie)).status).toBe(403);
    expect((await get('/system-test/results', partial.cookie)).status).toBe(403);
    expect((await get('/system-test/health', partial.cookie)).status).toBe(200);
    const deny = await az.direct(full.accountId, v.id, 'DENY');
    expect(await routes(full.cookie)).toEqual(['/system-test', '/system-test/runner']);
    const denied = await get('/system-test/tables/B01/rows', full.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied)))[0]).toMatchObject({ action: 'SYSTEM_TEST.DATA_VIEWER.READ', outcome: 'DENIED', metadata: { reason: 'DIRECT_DENY' } });
    await az.revokeDirect(deny);
    expect(await routes(full.cookie)).toEqual(ROUTES);

    // ST-05 / ST-06 / ST-07 / ST-08 — Data Viewer as talo_app; the database must be unchanged by the viewer.
    const before = await foundationCounts();
    const tables = await get('/system-test/tables', full.cookie);
    expect(tables.status).toBe(200);
    const listed: { tableKey: string; readable: boolean; columns: string[]; hiddenColumns: string[] }[] = tables.body.tables;
    expect(listed.filter((t) => t.readable).map((t) => t.tableKey)).toEqual(READABLE);
    expect(listed.filter((t) => !t.readable).map((t) => t.tableKey)).toEqual(NOT_READABLE);
    for (const key of NOT_READABLE) {
      const res = await get(`/system-test/tables/${key}/rows`, full.cookie);
      expect([key, res.status, res.body.error?.code]).toEqual([key, 403, 'TABLE_NOT_READABLE']);
    }
    for (const key of ['B15', 'fnd_modules', 'iam_credentials', 'B01%3B%20DROP%20TABLE%20x']) {
      expect((await get(`/system-test/tables/${key}/rows`, full.cookie)).status).toBe(404);
    }
    for (const q of ['pageSize=101', 'page=0', 'pageSize=abc', 'page=1&page=2']) expect((await get(`/system-test/tables/B01/rows?${q}`, full.cookie)).status).toBe(400);
    for (const key of READABLE) {
      const t = VIEWER_TABLES.find((x) => x.tableKey === key);
      if (!t) throw new Error(key);
      const res = await get(`/system-test/tables/${key}/rows?page=2&pageSize=3`, full.cookie);
      expect(res.status).toBe(200);
      const expected = await h.ok(`SELECT ${t.columns.map((c) => `coalesce(${c}::text, '<null>')`).join(', ')} FROM foundation.${t.table} ORDER BY ${t.orderBy.join(', ')} LIMIT 3 OFFSET 3`);
      const [total] = await h.ok(`SELECT count(*) FROM foundation.${t.table}`);
      expect(res.body.data.table.columns).toEqual(t.columns);
      for (const hidden of t.hiddenColumns) expect(res.body.data.table.columns).not.toContain(hidden);
      expect([res.body.data.page, res.body.data.pageSize, String(res.body.data.totalRows)]).toEqual([2, 3, total?.[0]]);
      expect(res.body.data.rows.map((row: (string | null)[]) => row.map((x) => x ?? '<null>'))).toEqual(expected);
    }
    const first = await get('/system-test/tables/B01/rows', full.cookie);
    expect([first.body.data.pageSize, first.body.data.rows.length <= 50]).toEqual([50, true]);
    const [b01Total] = await h.ok('SELECT count(*) FROM foundation.fnd_modules');
    const lastPage = Math.ceil(Number(b01Total?.[0]) / 100);
    const last = await get(`/system-test/tables/B01/rows?page=${lastPage}&pageSize=100`, full.cookie);
    expect(last.body.data.rows.length).toBe(Number(b01Total?.[0]) - (lastPage - 1) * 100);
    expect((await get(`/system-test/tables/B01/rows?page=${lastPage + 1}&pageSize=100`, full.cookie)).body.data.rows).toEqual([]);
    expect(await foundationCounts()).toEqual(before); // ST-07: the viewer wrote nothing
    evidence['viewer'] = { readable: READABLE, refused: NOT_READABLE, b01Rows: b01Total?.[0] };

    // ST-09 — quick check: real facts; the fixture account has all three permissions and the full menu.
    const check = await send('post', '/system-test/checks/run', full.cookie);
    expect(check.status).toBe(200);
    const statuses = Object.fromEntries(check.body.run.results.map((x: { key: string; status: string }) => [x.key, x.status]));
    expect(check.body.run.summary).toEqual({ PASS: 12, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0 });
    expect(check.body.run.results.find((x: { key: string }) => x.key === 'POSTGRESQL').detail).toContain('talo_mos_v4_test');
    const partialCheck = await send('post', '/system-test/checks/run', partial.cookie);
    expect(partialCheck.body.run.results.find((x: { key: string }) => x.key === 'IAM').detail).toContain('DATA_VIEWER: DENY (NO_VALID_ALLOW)');
    expect(partialCheck.body.run.summary.PASS).toBe(12);
    expect(await auditsOf(rid(check))).toEqual([]); // the quick check writes nothing
    expect((await send('post', '/system-test/checks/run', full.cookie, { sql: 'DELETE FROM x' })).status).toBe(400);
    evidence['quickCheck'] = statuses;

    // ST-10 — results: NOT_RUN without a runner file; a runner file is returned after validation (the API runs nothing).
    const none = await get('/system-test/results', full.cookie);
    expect(none.body.results).toMatchObject({ regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } });
    expect(none.body.results.quickCheck.runId).toBe(rid(partialCheck));
    const file = {
      format: REGRESSION_FORMAT, runId: 'ST10', startedAt: '2026-10-19T00:00:00.000Z', finishedAt: '2026-10-19T00:00:01.000Z',
      target: { database: 'talo_mos_v4_test', host: '127.0.0.1', nodeEnv: 'test' }, status: 'FAIL',
      suites: [{ key: 'NON_DB', label: 'Non-DB', command: 'npx vitest run', status: 'FAIL', exitCode: 1, durationMs: 1000, tests: { passed: 1, failed: 1, skipped: 0 }, summary: ['Tests  1 failed | 1 passed (2)'] }],
    };
    await writeFile(join(resultsDir, 'regression-latest.json'), JSON.stringify(file));
    expect((await get('/system-test/results', full.cookie)).body.results.regression).toEqual({ state: 'AVAILABLE', run: file });

    // ST-11 — DISABLE / RETIRE: menu hidden AND every module API refused (503 MODULE_UNAVAILABLE); ENABLE restores.
    const all = async () => [
      (await get('/system-test/health', full.cookie)).status, (await get('/system-test/tables', full.cookie)).status,
      (await get('/system-test/tables/B01/rows', full.cookie)).status, (await get('/system-test/results', full.cookie)).status,
      (await send('post', '/system-test/checks/run', full.cookie)).status,
    ];
    expect((await send('post', `/foundation/modules/${moduleId}/disable`, admin.cookie)).status).toBe(200);
    expect(await routes(full.cookie)).toEqual([]);
    expect(await all()).toEqual([503, 503, 503, 503, 503]);
    expect((await get('/system-test/health', full.cookie)).body.error.code).toBe('MODULE_UNAVAILABLE');
    expect((await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie)).status).toBe(200);
    expect(await all()).toEqual([200, 200, 200, 200, 200]);
    expect((await send('post', `${base}/retire`, admin.cookie)).status).toBe(200);
    expect(await routes(full.cookie)).toEqual([]);
    expect(await all()).toEqual([503, 503, 503, 503, 503]);
    evidence['st'] = { moduleId, versionId, groupId, permissionCodes: [d.ref.permissionCode, v.ref.permissionCode, r.ref.permissionCode] };
  });

  it('ST-12 / ST-13: IAM back to the baseline, no ACL change, Foundation rows only added (C2), the run module kept RETIRED', async () => {
    expect(await iamState()).toEqual(iamBaseline);
    expect(await aclFingerprint()).toBe(aclBaseline);
    const after = (await foundationCounts()).map((x) => Number(x ?? 0));
    after.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(Number(foundationBefore[i] ?? 0)));
    const [kept] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_modules WHERE module_key = ${lit(moduleKey)}),
      (SELECT string_agg(v.status, ',') FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE m.module_key = ${lit(moduleKey)}),
      (SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_modules m ON m.module_id = n.module_id WHERE m.module_key = ${lit(moduleKey)}),
      (SELECT count(*) FROM iam.iam_permissions WHERE module_code = ${lit(moduleKey)})`);
    expect(kept).toEqual(['1', 'RETIRED', '4', '0']);
    evidence['st12'] = { iam: iamBaseline, acl: aclBaseline };
  });
});
