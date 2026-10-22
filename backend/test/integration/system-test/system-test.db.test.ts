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
import { createModule } from '../../../src/installed-modules/SYSTEM_TEST/backend/index.js';
import { createHostCapabilities } from '../../../src/module-host/capabilities.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { systemTestMic } from '../../../src/installed-modules/SYSTEM_TEST/mic/system-test.mic.js';
import type { SystemTestBinding } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.permissions.js';
import { REGRESSION_FORMAT } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.results.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// MOD-TEST-01 — SYSTEM_TEST module on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1.
// The REAL module code (MOD-TEST-02: installed package + REAL Host capabilities: AccessGuard → lifecycle gate → read-only
// SQL as talo_app) is exercised against ONE fixture module FBET_ST_<RUN>, so that DISABLE / RETIRE / DENY can be proven
// without touching the registered SYSTEM_TEST module. The fixture permissions follow K05 for the fixture key
// (talo_test_harness, FBE-06B grant) and are removed with UUID ownership proof. Foundation rows are append-only (C2) and
// are never written by SQL here.
// SYSTEM_TEST 1.1.1 (HOST-TEST-MIGRATION.md): the fixture reproduces the real upgrade — 1.0.0 in the 1.0.x shape (with the
// Data Viewer) ACTIVE, then the 1.1.1 MIC as a CHANGE of it, through SUBMIT (B13 / B14) → APPROVE → ACTIVATE (the real
// Activation Gate, MIC-10 evidence PASS) — then IAM, navigation, the three APIs, the retired Data Viewer routes (404),
// the 22 quick checks and the lifecycle refusal.

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
const ROUTES = ['/system-test', '/system-test/runner'];
const MODULE_ROUTES = ['/system-test', '/system-test/data', '/system-test/runner'];
const FOUNDATION_TABLES = ['fnd_actions', 'fnd_audit_logs', 'fnd_compatibility_changes', 'fnd_compatibility_checks', 'fnd_data_access_rules', 'fnd_data_contracts',
  'fnd_data_fields', 'fnd_functions', 'fnd_module_events', 'fnd_module_versions', 'fnd_modules', 'fnd_navigation_items', 'fnd_version_actions', 'fnd_version_functions'];
const CHECK_STATUSES = ['PASS', 'FAIL', 'WARN', 'NOT_TESTED', 'UNAVAILABLE'];
const EVIDENCE = [{ name: 'MOD-TEST-01 fixture', result: 'PASS' as const, reference: 'test/integration/system-test/system-test.db.test.ts' }];

// The 1.0.x shape of the MIC (Data Viewer included), as the fixture's first version: INITIAL_REGISTRATION 1.0.0.
function legacyMic(moduleKey: string) {
  const mic = systemTestMic(moduleKey, EVIDENCE);
  return {
    ...mic,
    mic01Identity: { ...mic.mic01Identity, moduleVersion: '1.0.0' },
    mic02Functions: [...mic.mic02Functions, { functionKey: 'DATA_VIEWER', name: 'Data Viewer', description: 'Xem bảng Foundation (chỉ đọc)' }],
    mic03Actions: [...mic.mic03Actions, { functionKey: 'DATA_VIEWER', actionKey: 'READ', name: 'Xem bảng', nature: 'READ' }],
    mic04Navigation: [...mic.mic04Navigation, { menuLabel: 'Data Viewer', routePath: '/system-test/data', screenKey: 'system.test', functionKey: 'DATA_VIEWER' }],
    mic05Api: [...mic.mic05Api, { method: 'GET', path: '/api/system-test/tables', functionKey: 'DATA_VIEWER', actionKey: 'READ', errors: ['FORBIDDEN'] }],
    mic07IamMapping: [...mic.mic07IamMapping, { functionKey: 'DATA_VIEWER', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'DATA_VIEWER', operation: 'READ', minimumAssuranceLevel: 1 }],
    mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: ['Đăng ký ban đầu (fixture dạng 1.0.x)'] },
  };
}
// The package MIC 1.1.1, CHANGE of the fixture's 1.0.0 (the real one is a CHANGE of SYSTEM_TEST 1.0.3).
function packageMic(moduleKey: string) {
  const mic = systemTestMic(moduleKey, EVIDENCE);
  return { ...mic, mic09Compatibility: { ...mic.mic09Compatibility, fromVersion: '1.0.0' } };
}

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


describe.skipIf(!enabled)('MOD-TEST-01 SYSTEM_TEST 1.1.1 module — PostgreSQL (talo_mos_v4_test)', { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let resultsDir = '';
  const perm: Record<PermKey, string> = { registryCreate: '', create: '', update: '', submit: '', approve: '', activate: '', retire: '', enable: '', disable: '', navigation: '' };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const moduleKey = `FBET_ST_${run}`;
  const refs: { diagnostics: PermissionRef; testRunner: PermissionRef } = {
    diagnostics: { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'DIAGNOSTICS', operation: 'READ' },
    testRunner: { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'TEST_RUNNER', operation: 'EXECUTE' },
  };
  // Late-bound: the fixture permission codes exist only once the test has created them.
  const binding: SystemTestBinding = {
    moduleKey,
    get diagnosticsRead() { return refs.diagnostics; },
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
  type MenuJson = { navigationId: string; moduleId: string | null; routePath: string | null; children: MenuJson[] };
  const flatten = (nodes: MenuJson[]): MenuJson[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
  let fixtureModuleId = '';
  // Routes of the FIXTURE module in the account's menu (the registered SYSTEM_TEST module has the same paths).
  async function routes(as: string): Promise<string[]> {
    const res = await get('/foundation/navigation', as);
    expect(res.status).toBe(200);
    return flatten(res.body.navigation).filter((n) => n.moduleId === fixtureModuleId).map((n) => n.routePath)
      .filter((r): r is string => r !== null && MODULE_ROUTES.includes(r)).sort();
  }
  async function auditsOf(requestId: string) {
    return (await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(module_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)} ORDER BY occurred_at, action_code`)).map((r) => ({
      action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], moduleId: r[4], metadata: JSON.parse(r[5] ?? 'null'),
    }));
  }
  const foundationCounts = async () => (await h.ok(`SELECT ${FOUNDATION_TABLES.map((t) => `(SELECT count(*) FROM foundation.${t})`).join(', ')}`))[0] ?? [];
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
    const db = prismaFoundationDb(prisma);
    const host = createHostCapabilities(moduleKey, {
      db, access: new SqlFoundationRepository(db), authService: auth.service, navigation: foundation.navigationService, logger, secureCookie: false,
      resultsFile: join(resultsDir, 'regression-latest.json'),
    });
    const systemTest = createModule(host, { binding });
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

  it('ST-01 … ST-11: 1.0.x → 1.1.1 CHANGE through Foundation (real Activation Gate), navigation, IAM, retired viewer, checks, results, lifecycle', async () => {
    // ST-01 — registration; 1.0.0 (1.0.x shape) SUBMIT → APPROVE → ACTIVATE → ENABLE through the Foundation API.
    const admin = await login(PERM_KEYS.map((k) => perm[k]));
    const reg = await send('post', '/foundation/modules', admin.cookie, { moduleKey, moduleName: 'System Test & Diagnostics', moduleType: 'INTERNAL' });
    expect(reg.status).toBe(201);
    const moduleId = String(reg.body.module.moduleId);
    fixtureModuleId = moduleId;
    const version = async (moduleVersion: string, manifest: object) => {
      const created = await send('post', `/foundation/modules/${moduleId}/versions`, admin.cookie, { moduleVersion, contractVersion: 'MIC-1.0' });
      expect(created.status).toBe(201);
      const versionId = String(created.body.version.versionId);
      const base = `/foundation/modules/${moduleId}/versions/${versionId}`;
      expect((await send('put', `${base}/manifest`, admin.cookie, { manifest })).status).toBe(200);
      const hash = canonicalDigest(manifest).sha256;
      const sub = await send('post', `${base}/submit`, admin.cookie, { expectedManifestHash: hash });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      expect(sub.body.version).toMatchObject({ status: 'IN_REVIEW', manifestHash: hash });
      expect((await send('post', `${base}/approve`, admin.cookie)).status).toBe(200);
      return { versionId, base };
    };
    const v1 = await version('1.0.0', legacyMic(moduleKey));
    expect((await send('post', `${v1.base}/activate`, admin.cookie)).status).toBe(200);
    expect((await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie)).status).toBe(200);

    // ST-01b — 1.1.1: CHANGE of 1.0.0. B13 = WARN (DATA_VIEWER REMOVED → WARNING, no BLOCKING); NOT_TESTED evidence is
    // refused by the Activation Gate; the same content with PASS evidence (a new version) is activated and retires 1.0.0.
    const blocked = await version('1.1.0', { ...packageMic(moduleKey), mic01Identity: { ...packageMic(moduleKey).mic01Identity, moduleVersion: '1.1.0' },
      mic10Manifest: systemTestMic(moduleKey).mic10Manifest });
    const refusal = await send('post', `${blocked.base}/activate`, admin.cookie);
    expect([refusal.status, refusal.body.error?.code, refusal.body.error?.details?.errors]).toEqual([422, 'ACTIVATION_BLOCKED', ['TEST_EVIDENCE_NOT_PASSED']]);
    const v2 = await version('1.1.1', packageMic(moduleKey));
    const [compat] = await h.ok(`SELECT k.check_result, (SELECT string_agg(x.change_area || ':' || x.object_key || ':' || x.change_type || ':' || x.severity, ',' ORDER BY x.change_area, x.object_key)
      FROM foundation.fnd_compatibility_changes x WHERE x.check_id = k.check_id AND x.change_type <> 'ADDED'), (SELECT module_version FROM foundation.fnd_module_versions WHERE version_id = k.from_version_id)
      FROM foundation.fnd_compatibility_checks k WHERE k.to_version_id = ${lit(v2.versionId)}`);
    expect(compat?.[0]).toBe('WARN');
    expect(compat?.[1]).toContain('DATA_VIEWER');
    expect(compat?.[1]).not.toContain('BLOCKING');
    expect(compat?.[2]).toBe('1.0.0');
    const activated = await send('post', `${v2.base}/activate`, admin.cookie);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(await h.ok(`SELECT module_version, status FROM foundation.fnd_module_versions WHERE module_id = ${lit(moduleId)} ORDER BY module_version`))
      .toEqual([['1.0.0', 'RETIRED'], ['1.1.0', 'APPROVED'], ['1.1.1', 'ACTIVE']]);
    const fns = await h.ok(`SELECT f.function_key, f.function_id::text FROM foundation.fnd_version_functions vf JOIN foundation.fnd_functions f ON f.function_id = vf.function_id
      WHERE vf.version_id = ${lit(v2.versionId)} ORDER BY f.function_key`);
    expect(fns.map((r) => r[0])).toEqual(['DIAGNOSTICS', 'TEST_RUNNER']);
    const fnId = (key: string) => fns.find((r) => r[0] === key)?.[1] ?? NIL;
    const [counts] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_version_actions va JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id WHERE vf.version_id = ${lit(v2.versionId)}),
      (SELECT string_agg(resource_key || ':' || interface_kind, ',' ORDER BY resource_key) FROM foundation.fnd_data_contracts WHERE version_id = ${lit(v2.versionId)}),
      (SELECT count(*) FROM foundation.fnd_data_fields d JOIN foundation.fnd_data_contracts c ON c.data_contract_id = d.data_contract_id WHERE c.version_id = ${lit(v2.versionId)})`);
    expect(counts).toEqual(['2', 'SYSTEM_STATUS:API,TEST_RESULTS:API', '11']);
    evidence['gate'] = { refused: refusal.body.error?.details?.errors, compatibility: compat, activated: activated.status };

    // Navigation items (B09) through the management API: one group and the two Function items of 1.1.1.
    const grp = await send('post', '/foundation/navigation/items', admin.cookie, { moduleId, menuTitle: `FBET ST ${run}`, sortOrder: 90 });
    expect(grp.status).toBe(201);
    const groupId = String(grp.body.item.navigationId);
    for (const [i, key] of ['DIAGNOSTICS', 'TEST_RUNNER'].entries()) {
      expect((await send('post', '/foundation/navigation/items', admin.cookie, { parentId: groupId, moduleId, functionId: fnId(key), menuTitle: key, sortOrder: i })).status).toBe(201);
    }

    // Fixture permissions with the K05 triple of the fixture key; three accounts: full, diagnostics only, none.
    const d = await az.definePermission(moduleKey, 'DIAGNOSTICS', 'READ');
    const r = await az.definePermission(moduleKey, 'TEST_RUNNER', 'EXECUTE');
    refs.diagnostics = d.ref;
    refs.testRunner = r.ref;
    const full = await login([d.id, r.id]);
    const partial = await login([d.id]);
    const outsider = await login([]);

    // ST-03 — navigation follows IAM ALLOW per Function; the retired /system-test/data is never offered.
    expect(await routes(full.cookie)).toEqual(ROUTES);
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
    expect((await get('/system-test/results', partial.cookie)).status).toBe(403);
    expect((await get('/system-test/health', partial.cookie)).status).toBe(200);
    const deny = await az.direct(full.accountId, r.id, 'DENY');
    expect(await routes(full.cookie)).toEqual(['/system-test']);
    const denied = await get('/system-test/results', full.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied)))[0]).toMatchObject({ action: 'SYSTEM_TEST.TEST_RUNNER.EXECUTE', outcome: 'DENIED', metadata: { reason: 'DIRECT_DENY' } });
    await az.revokeDirect(deny);
    expect(await routes(full.cookie)).toEqual(ROUTES);

    // ST-05 — the retired Data Viewer: no API for anyone (404), nothing read.
    for (const retired of ['/system-test/tables', '/system-test/tables/B01/rows', '/system-test/tables/B01/rows?page=1&pageSize=3']) {
      expect([retired, (await get(retired, full.cookie)).status]).toEqual([retired, 404]);
    }

    // ST-09 — quick check: 22 real statuses as talo_app; nothing written to Foundation; body must be {}.
    const before = await foundationCounts();
    const check = await send('post', '/system-test/checks/run', full.cookie);
    expect(check.status).toBe(200);
    const results: { key: string; status: string; detail: string }[] = check.body.run.results;
    const statuses = Object.fromEntries(results.map((x) => [x.key, x.status]));
    expect(results).toHaveLength(22);
    expect(results.every((x) => CHECK_STATUSES.includes(x.status))).toBe(true);
    expect(statuses).toMatchObject({
      AUTHENTICATION: 'PASS', SESSION: 'PASS', IAM: 'PASS', POSTGRESQL: 'PASS', REGISTRY: 'PASS', VERSION_MIC: 'PASS', FUNCTION_ACTION: 'PASS',
      DATA_CONTRACTS: 'PASS', COMPATIBILITY: 'PASS', LIFECYCLE: 'PASS', NAVIGATION: 'PASS', MODULE_API: 'PASS',
      DB_CONNECTIONS: 'PASS', DEPLOYMENT_SYNC: 'NOT_TESTED',
      // talo_app has no SELECT on B08: reported UNAVAILABLE with its SQLSTATE, never invented as 0.
      AUDIT_DENIED: 'UNAVAILABLE', AUDIT_FAILURE: 'UNAVAILABLE',
    });
    expect(results.find((x) => x.key === 'POSTGRESQL')?.detail).toContain('talo_mos_v4_test');
    expect(results.find((x) => x.key === 'VERSION_MIC')?.detail).toContain('1.1.1');
    expect(results.find((x) => x.key === 'AUDIT_DENIED')?.detail).toContain('42501');
    // The TEST registry holds more than 200 modules (append-only FBET fixtures): the fleet list is capped → WARN, not PASS.
    const fleetComplete: boolean = check.body.run.fleetComplete;
    expect(statuses['FLEET_DISCOVERY']).toBe(fleetComplete ? 'PASS' : 'WARN');
    if (fleetComplete) expect(check.body.run.fleet.some((m: { moduleKey: string }) => m.moduleKey === moduleKey)).toBe(true);
    else expect(check.body.run.fleet).toHaveLength(200);
    const partialCheck = await send('post', '/system-test/checks/run', partial.cookie);
    expect(partialCheck.body.run.results.find((x: { key: string }) => x.key === 'IAM').detail).toContain('TEST_RUNNER: DENY (NO_VALID_ALLOW)');
    expect(partialCheck.body.run.results.find((x: { key: string }) => x.key === 'NAVIGATION').status).toBe('PASS');
    expect(await auditsOf(rid(check))).toEqual([]); // the quick check writes nothing
    expect((await send('post', '/system-test/checks/run', full.cookie, { sql: 'DELETE FROM x' })).status).toBe(400);
    expect(await foundationCounts()).toEqual(before);
    evidence['quickCheck'] = statuses;

    // ST-10 — results: the account's own last quick check; NOT_RUN without a runner file; a runner file is returned
    // after validation (the API runs nothing).
    const none = await get('/system-test/results', full.cookie);
    expect(none.body.results).toMatchObject({ regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } });
    expect(none.body.results.quickCheck.runId).toBe(rid(check));
    const file = {
      format: REGRESSION_FORMAT, runId: 'ST10', startedAt: '2026-10-19T00:00:00.000Z', finishedAt: '2026-10-19T00:00:01.000Z',
      target: { database: 'talo_mos_v4_test', host: '127.0.0.1', nodeEnv: 'test' }, status: 'FAIL',
      suites: [{ key: 'NON_DB', label: 'Non-DB', command: 'npx vitest run', status: 'FAIL', exitCode: 1, durationMs: 1000, tests: { passed: 1, failed: 1, skipped: 0 }, summary: ['Tests  1 failed | 1 passed (2)'] }],
    };
    await writeFile(join(resultsDir, 'regression-latest.json'), JSON.stringify(file));
    expect((await get('/system-test/results', full.cookie)).body.results.regression).toEqual({ state: 'AVAILABLE', run: file });

    // ST-11 — DISABLE / RETIRE: menu hidden AND every module API refused (503 MODULE_UNAVAILABLE); ENABLE restores.
    const all = async () => [
      (await get('/system-test/health', full.cookie)).status, (await get('/system-test/results', full.cookie)).status,
      (await send('post', '/system-test/checks/run', full.cookie)).status,
    ];
    expect((await send('post', `/foundation/modules/${moduleId}/disable`, admin.cookie)).status).toBe(200);
    expect(await routes(full.cookie)).toEqual([]);
    expect(await all()).toEqual([503, 503, 503]);
    expect((await get('/system-test/health', full.cookie)).body.error.code).toBe('MODULE_UNAVAILABLE');
    expect((await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie)).status).toBe(200);
    expect(await all()).toEqual([200, 200, 200]);
    expect((await send('post', `${v2.base}/retire`, admin.cookie)).status).toBe(200);
    expect(await routes(full.cookie)).toEqual([]);
    expect(await all()).toEqual([503, 503, 503]);
    evidence['st'] = { moduleId, versions: [v1.versionId, blocked.versionId, v2.versionId], groupId, permissionCodes: [d.ref.permissionCode, r.ref.permissionCode] };
  });

  it('ST-12 / ST-13: IAM back to the baseline, no ACL change, Foundation rows only added (C2), the run module kept RETIRED', async () => {
    expect(await iamState()).toEqual(iamBaseline);
    expect(await aclFingerprint()).toBe(aclBaseline);
    const after = (await foundationCounts()).map((x) => Number(x ?? 0));
    after.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(Number(foundationBefore[i] ?? 0)));
    const [kept] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_modules WHERE module_key = ${lit(moduleKey)}),
      (SELECT string_agg(v.module_version || ':' || v.status, ',' ORDER BY v.module_version) FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE m.module_key = ${lit(moduleKey)}),
      (SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_modules m ON m.module_id = n.module_id WHERE m.module_key = ${lit(moduleKey)}),
      (SELECT count(*) FROM iam.iam_permissions WHERE module_code = ${lit(moduleKey)})`);
    expect(kept).toEqual(['1', '1.0.0:RETIRED,1.1.0:APPROVED,1.1.1:RETIRED', '3', '0']);
    evidence['st12'] = { iam: iamBaseline, acl: aclBaseline };
  });
});
