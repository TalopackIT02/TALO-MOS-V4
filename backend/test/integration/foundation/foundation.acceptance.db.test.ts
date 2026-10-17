import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import type { Express, Router } from 'express';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import type { AuthService } from '../../../src/modules/auth/auth.service.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import { AccessGuard } from '../../../src/modules/foundation/foundation.access.js';
import { sessionHandler } from '../../../src/modules/foundation/foundation.http.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import type { PermissionRef } from '../../../src/modules/foundation/foundation.permissions.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { Logger } from '../../../src/core/logging/logger.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FBE-07 — Foundation end-to-end acceptance on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1.
// ONE fixture module FBET_SMOKE_<RUN> (not a business module) goes LOGIN → IAM → REGISTER → VERSION → MIC SUBMIT →
// Function / Action → Data Contract → Compatibility → APPROVE → ACTIVATE → ENABLE → NAVIGATION → MODULE API → AUDIT,
// through the real HTTP API as talo_app. The module API GET /api/fbet-smoke/ping exists ONLY in this test's Express app:
// it uses the real session wrapper and the real AccessGuard / evaluateAccess on the module's own K05 permission, so its
// authorisation is independent of the menu. IAM fixtures (talo_test_harness, FBE-06B grant) are created with explicit
// UUIDs and removed only after ownership proof. Foundation rows are append-only (C2) and are never written by SQL here.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create', update: 'foundation.module_version.update',
  submit: 'foundation.module_version.submit', read: 'foundation.module_version.read', approve: 'foundation.module_version.approve',
  activate: 'foundation.module_version.activate', retire: 'foundation.module_version.retire', enable: 'foundation.module_registry.enable',
  disable: 'foundation.module_registry.disable', navigation: 'foundation.navigation.manage',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'read', 'approve', 'activate', 'retire', 'enable', 'disable', 'navigation'];

// The smoke MIC-1.0: one Function DEMO, one Action READ, route /fbet-smoke, API GET /api/fbet-smoke/ping, data resource
// DEMO_FEED (API) with field message:text and access DEMO.READ → SELECT (NOT_REQUIRED), INITIAL_REGISTRATION, evidence PASS.
function smokeMic(moduleKey: string) {
  return {
    mic01Identity: { moduleKey, moduleName: 'FBET Smoke', moduleVersion: '1.0.0', micStandard: 'MIC-1.0' },
    mic02Functions: [{ functionKey: 'DEMO', name: 'Demo' }],
    mic03Actions: [{ functionKey: 'DEMO', actionKey: 'READ', name: 'Xem demo', nature: 'READ' }],
    mic04Navigation: [{ menuLabel: 'FBET Smoke' }, { menuLabel: 'Demo', routePath: '/fbet-smoke', screenKey: 'fbet.smoke', functionKey: 'DEMO' }],
    mic05Api: [{ method: 'GET', path: '/api/fbet-smoke/ping', functionKey: 'DEMO', actionKey: 'READ', errors: ['FORBIDDEN'] }],
    mic06DataResources: [{
      resourceKey: 'DEMO_FEED', interfaceKind: 'API', columns: [{ name: 'message', type: 'text' }], relations: [],
      access: [{ functionKey: 'DEMO', actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
    }],
    mic07IamMapping: [{ functionKey: 'DEMO', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'DEMO', operation: 'READ', minimumAssuranceLevel: 1 }],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: [] },
    mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: [] },
    mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'FBE-07 acceptance', result: 'PASS', reference: 'foundation.acceptance.db.test.ts' }] },
  };
}

// Test-only module API: real session + real AccessGuard on the module's K05 permission (DENIED → B08 per contract).
function smokeApi(authService: Pick<AuthService, 'describeSession'>, repository: SqlFoundationRepository, logger: Logger, permission: () => PermissionRef): Router {
  const router = express.Router();
  const guard = new AccessGuard({ repository, logger });
  const handle = sessionHandler({ authService, secureCookie: false });
  router.get('/fbet-smoke/ping', handle(async (_req, res, actor) => {
    await guard.authorize(actor, permission(), 'FBET_SMOKE.DEMO.READ', 'FBET_SMOKE_API');
    res.status(200).json({ message: 'pong', requestId: actor.requestId });
  }));
  return router;
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
  async definePermission(moduleKey: string, resourceCode: string, operation: string): Promise<string> {
    if (!moduleKey.startsWith(this.moduleKeyPrefix)) throw new Error('permission fixture must target a module of this run');
    const id = randomUUID();
    this.permissions.push(id);
    await this.h.ok(`INSERT INTO iam.iam_permissions (permission_id, permission_code, module_code, resource_code, operation, minimum_assurance_level)
      VALUES (${lit(id)}, ${lit(`${this.permissionPrefix}.${moduleKey.toLowerCase()}.${resourceCode.toLowerCase()}.${operation.toLowerCase()}`)}, ${lit(moduleKey)}, ${lit(resourceCode)}, ${lit(operation)}, 1)`);
    return id;
  }

  private get permissionPrefix(): string {
    return this.runTag.toLowerCase();
  }

  private get moduleKeyPrefix(): string {
    return this.runTag.replace('FBET-', 'FBET_SMOKE_'); // FBE-07: the single smoke module of the run
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

describe.skipIf(!enabled)('FBE-07 Foundation end-to-end acceptance — PostgreSQL (talo_mos_v4_test)', { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  const perm: Record<PermKey, string> = {
    registryCreate: '', create: '', update: '', submit: '', read: '', approve: '', activate: '', retire: '', enable: '', disable: '', navigation: '',
  };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const moduleKey = `FBET_SMOKE_${run}`;
  let smokePermission: PermissionRef = { permissionCode: 'undefined', moduleCode: moduleKey, resourceCode: 'DEMO', operation: 'READ' };
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};
  let iamBaseline: string[] = [];

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
  const send = (method: 'post' | 'put' | 'patch', url: string, as: string, body: unknown = {}) =>
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
  type MenuJson = { navigationId: string; functionId: string | null; routePath: string | null; screenKey: string | null; children: MenuJson[] };
  const flatten = (nodes: MenuJson[]): MenuJson[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
  async function menu(as: string): Promise<MenuJson[]> {
    const res = await get('/foundation/navigation', as);
    expect(res.status).toBe(200);
    return flatten(res.body.navigation);
  }
  async function auditsOf(requestId: string) {
    return (await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(module_id::text, '<null>'), coalesce(version_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)} ORDER BY occurred_at, action_code`)).map((r) => ({
      action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], moduleId: r[4], versionId: r[5], metadata: JSON.parse(r[6] ?? 'null'),
    }));
  }
  async function eventsOf(requestId: string) {
    return (await h.ok(`SELECT event_type, coalesce(version_id::text, '<null>'), coalesce(before_state::text, 'null'), after_state::text
      FROM foundation.fnd_module_events WHERE correlation_id = ${lit(requestId)} ORDER BY event_type`)).map((r) => [r[0], r[1], JSON.parse(r[2] ?? 'null'), JSON.parse(r[3] ?? 'null')]);
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
      prisma, logger, production: false, hasher,
      loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }),
    });
    const foundation = createFoundationModule({ prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST' });
    const api = smokeApi(auth.service, new SqlFoundationRepository(prismaFoundationDb(prisma)), logger, () => smokePermission);
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router, api] });
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
    const [base] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions), (SELECT count(*) FROM iam.iam_permissions WHERE module_code = 'FOUNDATION'),
      (SELECT count(*) FROM iam.iam_role_permissions) + (SELECT count(*) FROM iam.iam_user_roles) + (SELECT count(*) FROM iam.iam_user_permissions),
      (SELECT count(*) FROM iam.iam_audit_logs), (SELECT relacl::text FROM pg_class WHERE oid = 'iam.iam_permissions'::regclass)`);
    iamBaseline = (base ?? []).map((x) => x ?? '');
    // FE-01: the TEST administrator (role TALO_SYSTEM_ADMIN) is a legitimate assignment; fixture leftovers are checked above
    // and AC-10 compares the whole baseline (incl. assignments) after cleanup.
    expect(iamBaseline.slice(0, 2)).toEqual(['13', '13']);
    evidence['iamBaseline'] = iamBaseline;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    console.log(`[fbe07] run ${run} module ${moduleKey} deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe07] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  it('AC-01 … AC-09: one fixture module from login to navigation, module API and audit, through the real API on PostgreSQL', async () => {
    // AC-01 — login; anonymous requests are refused.
    expect((await get('/foundation/navigation')).status).toBe(401);
    expect((await get('/fbet-smoke/ping')).status).toBe(401);
    expect((await send('post', '/foundation/modules', '', { moduleKey, moduleName: 'x', moduleType: 'INTERNAL' })).status).toBe(401);
    const admin = await login(PERM_KEYS.map((k) => perm[k]));

    // AC-02 — module registration: B01 (disabled) + B07 REGISTER + B08 SUCCESS.
    const reg = await send('post', '/foundation/modules', admin.cookie, { moduleKey, moduleName: 'FBET Smoke', moduleType: 'INTERNAL' });
    expect(reg.status).toBe(201);
    const moduleId = String(reg.body.module.moduleId);
    expect(reg.body.module).toMatchObject({ moduleKey, isEnabled: false, createdByAccountId: admin.accountId });
    expect((await eventsOf(rid(reg))).map((e) => e[0])).toEqual(['REGISTER']);
    expect((await auditsOf(rid(reg))).map((a) => [a.action, a.outcome, a.moduleId])).toEqual([['MODULE_REGISTRY.CREATE', 'SUCCESS', moduleId]]);

    // AC-03 — version 1.0.0, MIC PUT, SUBMIT → IN_REVIEW with the RFC 8785 hash of the stored MIC.
    const created = await send('post', `/foundation/modules/${moduleId}/versions`, admin.cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    const versionId = String(created.body.version.versionId);
    const mic = smokeMic(moduleKey);
    const base = `/foundation/modules/${moduleId}/versions/${versionId}`;
    expect((await send('put', `${base}/manifest`, admin.cookie, { manifest: mic })).status).toBe(200);
    const hash = canonicalDigest(mic).sha256;
    const sub = await send('post', `${base}/submit`, admin.cookie, { expectedManifestHash: hash });
    expect(sub.status).toBe(200);
    expect(sub.body.version).toMatchObject({ status: 'IN_REVIEW', manifestHash: hash, submittedByAccountId: admin.accountId, manifestJson: mic });
    const [stored] = await h.ok(`SELECT status, manifest_hash, manifest_json::text FROM foundation.fnd_module_versions WHERE version_id = ${lit(versionId)}`);
    expect([stored?.[0], stored?.[1], canonicalDigest(JSON.parse(stored?.[2] ?? 'null')).sha256]).toEqual(['IN_REVIEW', hash, hash]);

    // AC-04 — registry, data contract and compatibility rows, all of this module / version.
    const [reg03] = await h.ok(`SELECT f.function_id::text, f.function_key, a.action_id::text, a.action_key, vf.version_function_id::text, vf.display_name, vf.definition_hash,
        va.version_action_id::text, va.definition_hash, va.action_spec::text
      FROM foundation.fnd_functions f JOIN foundation.fnd_actions a ON a.function_id = f.function_id
      JOIN foundation.fnd_version_functions vf ON vf.function_id = f.function_id AND vf.version_id = ${lit(versionId)}
      JOIN foundation.fnd_version_actions va ON va.version_function_id = vf.version_function_id AND va.action_id = a.action_id
      WHERE f.module_id = ${lit(moduleId)}`);
    expect([reg03?.[1], reg03?.[3], reg03?.[5], reg03?.[6], reg03?.[8]]).toEqual(['DEMO', 'READ', 'Demo', canonicalDigest(mic.mic02Functions[0]).sha256, canonicalDigest(mic.mic03Actions[0]).sha256]);
    expect(JSON.parse(reg03?.[9] ?? 'null')).toEqual(mic.mic03Actions[0]);
    const functionId = reg03?.[0] ?? NIL;
    const versionActionId = reg03?.[7] ?? NIL;
    const counts = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_functions WHERE module_id = ${lit(moduleId)}),
      (SELECT count(*) FROM foundation.fnd_actions a JOIN foundation.fnd_functions f ON f.function_id = a.function_id WHERE f.module_id = ${lit(moduleId)}),
      (SELECT count(*) FROM foundation.fnd_version_functions WHERE version_id = ${lit(versionId)})`);
    expect(counts).toEqual([['1', '1', '1']]);
    const [contract] = await h.ok(`SELECT data_contract_id::text, resource_key, data_owner_key, interface_kind, coalesce(schema_name, '<null>'), schema_version, contract_hash, contract_spec::text
      FROM foundation.fnd_data_contracts WHERE version_id = ${lit(versionId)}`);
    expect(contract?.slice(1, 7)).toEqual(['DEMO_FEED', moduleKey, 'API', '<null>', '1.0.0', canonicalDigest(mic.mic06DataResources[0]).sha256]);
    expect(JSON.parse(contract?.[7] ?? 'null')).toEqual(mic.mic06DataResources[0]);
    expect(await h.ok(`SELECT field_name, field_type, is_required::text, is_primary_key::text FROM foundation.fnd_data_fields WHERE data_contract_id = ${lit(contract?.[0] ?? NIL)}`))
      .toEqual([['message', 'text', 'false', 'false']]);
    expect(await h.ok(`SELECT r.version_action_id::text, r.data_operation, r.approval_mode, r.is_enabled::text, (vf.version_id = c.version_id)::text
      FROM foundation.fnd_data_access_rules r JOIN foundation.fnd_data_contracts c ON c.data_contract_id = r.data_contract_id
      JOIN foundation.fnd_version_actions va ON va.version_action_id = r.version_action_id JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id
      WHERE c.version_id = ${lit(versionId)}`)).toEqual([[versionActionId, 'SELECT', 'NOT_REQUIRED', 'false', 'true']]);
    const [check] = await h.ok(`SELECT check_id::text, coalesce(from_version_id::text, '<null>'), environment, check_result, coalesce(database_fingerprint, '<null>')
      FROM foundation.fnd_compatibility_checks WHERE to_version_id = ${lit(versionId)} AND module_id = ${lit(moduleId)}`);
    expect(check?.slice(1)).toEqual(['<null>', 'TEST', 'PASS', '<null>']);
    expect(await h.ok(`SELECT change_area, object_key, change_type, severity, resolution_status FROM foundation.fnd_compatibility_changes
      WHERE check_id = ${lit(check?.[0] ?? NIL)} ORDER BY change_area, object_key`)).toEqual([
      ['ACTION', 'ACTION:DEMO.READ', 'ADDED', 'INFO', 'OPEN'], ['DATA', 'DATA:DEMO_FEED', 'ADDED', 'INFO', 'OPEN'], ['FUNCTION', 'FUNCTION:DEMO', 'ADDED', 'INFO', 'OPEN'],
    ]);
    evidence['ac04'] = { functionId, versionActionId, dataContract: contract?.[0], check: check?.[0] };

    // AC-05 — lifecycle through the API: APPROVE → ACTIVATE → ENABLE.
    const appr = await send('post', `${base}/approve`, admin.cookie);
    expect(appr.status).toBe(200);
    const act = await send('post', `${base}/activate`, admin.cookie);
    expect(act.status).toBe(200);
    const en = await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie);
    expect(en.status).toBe(200);
    const [life] = await h.ok(`SELECT v.status, v.reviewed_by_account_id::text, (v.reviewed_at IS NOT NULL)::text, (v.activated_at >= v.reviewed_at)::text, m.is_enabled::text, (m.updated_at > m.created_at)::text
      FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE v.version_id = ${lit(versionId)}`);
    expect(life).toEqual(['ACTIVE', admin.accountId, 'true', 'true', 'true', 'true']);
    expect(await eventsOf(rid(appr))).toEqual([['APPROVE', versionId, { status: 'IN_REVIEW' }, { status: 'APPROVED' }]]);
    expect(await eventsOf(rid(act))).toEqual([['ACTIVATE', versionId, { status: 'APPROVED' }, { status: 'ACTIVE' }]]);
    expect(await eventsOf(rid(en))).toEqual([['ENABLE', '<null>', { is_enabled: false }, { is_enabled: true }]]);
    for (const [res, action] of [[appr, 'MODULE_VERSION.APPROVE'], [act, 'MODULE_VERSION.ACTIVATE'], [en, 'MODULE_REGISTRY.ENABLE']] as const) {
      expect((await auditsOf(rid(res))).map((a) => [a.action, a.outcome, a.moduleId]), action).toEqual([[action, 'SUCCESS', moduleId]]);
    }

    // AC-06 — navigation: group + Function item via the management API; K05 permission fixture; ALLOW / DENY / RESTORE.
    const grp = await send('post', '/foundation/navigation/items', admin.cookie, { moduleId, menuTitle: `FBET Smoke ${run}`, sortOrder: 1 });
    expect(grp.status).toBe(201);
    const groupId = String(grp.body.item.navigationId);
    const itm = await send('post', '/foundation/navigation/items', admin.cookie, { parentId: groupId, moduleId, functionId, menuTitle: 'Demo' });
    expect(itm.status).toBe(201);
    const itemId = String(itm.body.item.navigationId);
    expect((await auditsOf(rid(itm))).map((a) => [a.action, a.outcome, a.targetId])).toEqual([['NAVIGATION.CREATE', 'SUCCESS', itemId]]);
    const smokePermId = await az.definePermission(moduleKey, 'DEMO', 'READ');
    const [code] = await h.ok(`SELECT permission_code FROM iam.iam_permissions WHERE permission_id = ${lit(smokePermId)}`);
    smokePermission = { permissionCode: code?.[0] ?? '', moduleCode: moduleKey, resourceCode: 'DEMO', operation: 'READ' };
    const outsider = await login([]);
    const user = await login([smokePermId]);
    const visible = async (as: string) => (await menu(as)).find((n) => n.navigationId === itemId);
    expect(await visible(outsider.cookie)).toBeUndefined();
    expect(await visible(user.cookie)).toMatchObject({ functionId, routePath: '/fbet-smoke', screenKey: 'fbet.smoke', children: [] });
    expect((await menu(user.cookie)).find((n) => n.navigationId === groupId)?.children.map((c) => c.navigationId)).toEqual([itemId]);

    // AC-07 — module API: real session + real evaluator, independent of the menu.
    const ok = await get('/fbet-smoke/ping', user.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ message: 'pong', requestId: rid(ok) });
    expect(await auditsOf(rid(ok))).toEqual([]); // a read: no audit row
    const refused = await get('/fbet-smoke/ping', outsider.cookie);
    expect(refused.status).toBe(403);
    expect(await auditsOf(rid(refused))).toEqual([{
      action: 'FBET_SMOKE.DEMO.READ', outcome: 'DENIED', targetType: 'FBET_SMOKE_API', targetId: '<null>', moduleId: '<null>', versionId: '<null>',
      metadata: { v: 1, reason: 'NO_VALID_ALLOW', requestId: rid(refused) },
    }]);
    // The admin sees no menu item (no module permission) — and the API refuses it too: the menu grants nothing.
    expect(await visible(admin.cookie)).toBeUndefined();
    expect((await get('/fbet-smoke/ping', admin.cookie)).status).toBe(403);

    // AC-06 / AC-07 — Direct DENY beats role ALLOW for the menu AND the API; revoking it restores both.
    const deny = await az.direct(user.accountId, smokePermId, 'DENY');
    expect(await visible(user.cookie)).toBeUndefined();
    const denied = await get('/fbet-smoke/ping', user.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied)))[0]).toMatchObject({ outcome: 'DENIED', metadata: { reason: 'DIRECT_DENY' } });
    await az.revokeDirect(deny);
    expect((await visible(user.cookie))?.routePath).toBe('/fbet-smoke');
    expect((await get('/fbet-smoke/ping', user.cookie)).status).toBe(200);

    // AC-08 — DISABLE hides, ENABLE shows, RETIRE (no ACTIVE left) hides; RETIRED → ACTIVE is not attempted (out of scope).
    const dis = await send('post', `/foundation/modules/${moduleId}/disable`, admin.cookie);
    expect(dis.status).toBe(200);
    expect(await visible(user.cookie)).toBeUndefined();
    expect((await send('post', `/foundation/modules/${moduleId}/enable`, admin.cookie)).status).toBe(200);
    expect((await visible(user.cookie))?.routePath).toBe('/fbet-smoke');
    const ret = await send('post', `${base}/retire`, admin.cookie);
    expect(ret.status).toBe(200);
    expect(await visible(user.cookie)).toBeUndefined();
    expect(await eventsOf(rid(ret))).toEqual([['RETIRE', versionId, { status: 'ACTIVE' }, { status: 'RETIRED' }]]);
    // The module API is authorised by IAM only: the menu entry is gone but the permission still answers.
    expect((await get('/fbet-smoke/ping', user.cookie)).status).toBe(200);

    // AC-09 — audit & integrity for the module: every SUCCESS has its request, no SUCCESS without its change, no secrets.
    const audits = await h.ok(`SELECT action_code, outcome, metadata::text FROM foundation.fnd_audit_logs WHERE module_id = ${lit(moduleId)} ORDER BY occurred_at`);
    expect(audits.map((a) => a[0])).toEqual([
      'MODULE_REGISTRY.CREATE', 'MODULE_VERSION.CREATE', 'MODULE_VERSION.UPDATE_MANIFEST', 'MODULE_VERSION.SUBMIT', 'MODULE_VERSION.APPROVE', 'MODULE_VERSION.ACTIVATE',
      'MODULE_REGISTRY.ENABLE', 'NAVIGATION.CREATE', 'NAVIGATION.CREATE', 'MODULE_REGISTRY.DISABLE', 'MODULE_REGISTRY.ENABLE', 'MODULE_VERSION.RETIRE',
    ]);
    expect(audits.every((a) => a[1] === 'SUCCESS')).toBe(true);
    const allMeta = audits.map((a) => a[2] ?? '').join('|');
    for (const secret of ['password', 'talo_sid', 'manifestJson', '"mic0', 'cookie']) expect(allMeta.toLowerCase()).not.toContain(secret.toLowerCase());
    const events = await h.ok(`SELECT event_type FROM foundation.fnd_module_events WHERE module_id = ${lit(moduleId)} ORDER BY occurred_at, event_type`);
    expect(events.map((e) => e[0])).toEqual(['REGISTER', 'SUBMIT', 'APPROVE', 'ACTIVATE', 'ENABLE', 'DISABLE', 'ENABLE', 'RETIRE']);
    const [integrity] = await h.ok(`SELECT
        (SELECT count(*) FROM (SELECT module_id FROM foundation.fnd_module_versions WHERE status = 'ACTIVE' GROUP BY module_id HAVING count(*) > 1) x),
        (SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_functions f ON f.function_id = n.function_id WHERE f.module_id <> n.module_id),
        (SELECT count(*) FROM foundation.fnd_data_access_rules r JOIN foundation.fnd_data_contracts c ON c.data_contract_id = r.data_contract_id
           JOIN foundation.fnd_version_actions va ON va.version_action_id = r.version_action_id JOIN foundation.fnd_version_functions vf ON vf.version_function_id = va.version_function_id
          WHERE vf.version_id <> c.version_id),
        (SELECT count(*) FROM foundation.fnd_version_functions vf JOIN foundation.fnd_functions f ON f.function_id = vf.function_id
           JOIN foundation.fnd_module_versions v ON v.version_id = vf.version_id WHERE f.module_id <> v.module_id)`);
    expect(integrity).toEqual(['0', '0', '0', '0']);
    // talo_app still has no IAM write privilege; no Foundation / IAM ACL drift.
    const [acl] = await prisma.$queryRawUnsafe<{ ins: boolean; upd: boolean; del: boolean }[]>(`SELECT has_any_column_privilege('iam.iam_permissions', 'INSERT') AS ins,
      has_any_column_privilege('iam.iam_permissions', 'UPDATE') AS upd, has_table_privilege('iam.iam_permissions', 'DELETE') AS del`);
    expect(acl).toEqual({ ins: false, upd: false, del: false });
    evidence['ac'] = { moduleId, versionId, itemId, audits: audits.length, events: events.length, permissionCode: code?.[0] };
  });

  it('AC-10: IAM fixtures removed by ownership proof — permissions back to 13, no assignment / AUTHT account left, IAM audit untouched; Foundation rows of the run kept (C2)', async () => {
    const [after] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions), (SELECT count(*) FROM iam.iam_permissions WHERE module_code = 'FOUNDATION'),
      (SELECT count(*) FROM iam.iam_role_permissions) + (SELECT count(*) FROM iam.iam_user_roles) + (SELECT count(*) FROM iam.iam_user_permissions),
      (SELECT count(*) FROM iam.iam_audit_logs), (SELECT relacl::text FROM pg_class WHERE oid = 'iam.iam_permissions'::regclass)`);
    expect(after).toEqual(iamBaseline);
    const [left] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE 'FBET-%'), (SELECT count(*) FROM iam.iam_user_accounts WHERE username ILIKE 'AUTHT-%'),
      (SELECT count(*) FROM iam.iam_permissions WHERE permission_code LIKE ${lit(`fbet-${run.toLowerCase()}.%`)} OR module_code = ${lit(moduleKey)})`);
    expect(left).toEqual(['0', '0', '0']);
    const [kept] = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_modules WHERE module_key = ${lit(moduleKey)}),
      (SELECT count(*) FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE m.module_key = ${lit(moduleKey)} AND v.status = 'RETIRED'),
      (SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_modules m ON m.module_id = n.module_id WHERE m.module_key = ${lit(moduleKey)})`);
    expect(kept).toEqual(['1', '1', '2']);
    evidence['ac10'] = { iam: after, kept };
  });
});
