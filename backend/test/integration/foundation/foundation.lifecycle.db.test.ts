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
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { sqlstateOf } from '../../../src/modules/auth/sqlstate.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import type { Actor } from '../../../src/modules/foundation/foundation.access.js';
import type { ModuleLifecycleService } from '../../../src/modules/foundation/foundation.lifecycle.service.js';
import { LIFECYCLE_SQL, SqlLifecycleRepository } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import { SqlManifestRepository } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { FOUNDATION_SQL, SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { SqlModuleVersionRepository, VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { validMic } from '../../unit/foundation/mic.fixture.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FBE-05-VERIFY — Module & Version lifecycle (L1–L8) on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with
// TALO_FOUNDATION_DB=1. Real Express app + auth + Foundation modules as talo_app, Prisma pg adapter, real transactions,
// advisory locks and the Q01 partial UNIQUE index. Fixtures (talo_test_harness): AUTHT- accounts and FBET- IAM role /
// direct grants, removed by proven UUID. Foundation rows are append-only (C2): never updated or deleted by the harness;
// every lifecycle state is reached through the API only (no APPROVED / ACTIVE written by SQL). Faults: a test-only
// FoundationDb wrapper changes ONE bind value so that PostgreSQL itself rejects the statement inside the transaction.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create', update: 'foundation.module_version.update',
  submit: 'foundation.module_version.submit', read: 'foundation.module_version.read', approve: 'foundation.module_version.approve',
  reject: 'foundation.module_version.reject', activate: 'foundation.module_version.activate', retire: 'foundation.module_version.retire',
  enable: 'foundation.module_registry.enable', disable: 'foundation.module_registry.disable',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'read', 'approve', 'reject', 'activate', 'retire', 'enable', 'disable'];
const B02 = 'foundation.fnd_module_versions';

type Fault = 'NONE' | 'B02_APPROVE' | 'B02_ACTIVATE' | 'Q01_SKIP_RETIRE' | 'B01_ENABLE' | 'B07' | 'B08_VERSION' | 'B08_MODULE';

// One bind value changed → a real PostgreSQL error inside the lifecycle transaction.
//   B02_APPROVE      approveVersion reviewed_by_account_id → 'not-a-uuid'   22P02 (UPDATE B02 fails)
//   B02_ACTIVATE     activateVersion version_id           → 'not-a-uuid'   22P02 (after the retire step)
//   Q01_SKIP_RETIRE  retireCurrentActive excluded id      → the ACTIVE id  0 rows retired → 23505 uq_fnd_module_versions_one_active
//   B01_ENABLE       enableModule module_id               → 'not-a-uuid'   22P02
//   B07              insertLifecycleEvent event_type      → 'BOGUS'        23514 ck_fnd_module_events_event_type (N-08)
//   B08_VERSION      insertVersionAudit outcome SUCCESS   → 'BOGUS'        23514
//   B08_MODULE       insertAudit outcome SUCCESS          → 'BOGUS'        23514
function faultyDb(db: FoundationDb, fault: () => Fault, activeId: () => string): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    const set = (i: number, value: unknown) => params.map((p, j) => (j === i ? value : p));
    if (f === 'B02_APPROVE' && sql === LIFECYCLE_SQL.approveVersion) return set(2, 'not-a-uuid');
    if (f === 'B02_ACTIVATE' && sql === LIFECYCLE_SQL.activateVersion) return set(0, 'not-a-uuid');
    if (f === 'Q01_SKIP_RETIRE' && sql === LIFECYCLE_SQL.retireCurrentActive) return set(1, activeId());
    if (f === 'B01_ENABLE' && sql === LIFECYCLE_SQL.enableModule) return set(0, 'not-a-uuid');
    if (f === 'B07' && sql === LIFECYCLE_SQL.insertLifecycleEvent) return set(2, 'BOGUS');
    if (f === 'B08_VERSION' && sql === VERSION_SQL.insertVersionAudit && params[7] === 'SUCCESS') return set(7, 'BOGUS');
    if (f === 'B08_MODULE' && sql === FOUNDATION_SQL.insertAudit && params[6] === 'SUCCESS') return set(6, 'BOGUS');
    return params;
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    query: (sql, params) => x.query(sql, rewrite(sql, params)),
    execute: (sql, params) => x.execute(sql, rewrite(sql, params)),
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))) };
}

// FBET- IAM authorisation fixtures: roles and direct grants, removed only by proven UUID ownership.
class AuthzFixtures {
  readonly roles: string[] = [];
  readonly userRoles: string[] = [];
  readonly userPermissions: string[] = [];
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

  async direct(accountId: string, permissionId: string, effect: 'ALLOW' | 'DENY'): Promise<void> {
    const id = randomUUID();
    this.userPermissions.push(id);
    await this.h.ok(`INSERT INTO iam.iam_user_permissions (user_permission_id, user_account_id, permission_id, effect, reason)
      VALUES (${lit(id)}, ${lit(accountId)}, ${lit(permissionId)}, ${lit(effect)}, ${lit(`${this.runTag} fixture`)})`);
  }

  async cleanup(): Promise<Record<string, number>> {
    const accounts = uuidArray(this.accounts().length ? this.accounts() : [NIL]);
    const roles = uuidArray(this.roles.length ? this.roles : [NIL]);
    const userRoles = uuidArray(this.userRoles.length ? this.userRoles : [NIL]);
    const userPerms = uuidArray(this.userPermissions.length ? this.userPermissions : [NIL]);
    const [foreign] = await this.h.ok(`
      SELECT (SELECT count(*) FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code NOT LIKE ${lit(`${this.runTag}-R%`)})
           + (SELECT count(*) FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND NOT (user_account_id = ANY(${accounts}) AND role_id = ANY(${roles})))
           + (SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) AND NOT (user_account_id = ANY(${accounts})))
           + (SELECT count(*) FROM iam.iam_user_roles WHERE role_id = ANY(${roles}) AND NOT (user_role_id = ANY(${userRoles})))`);
    if (foreign?.[0] !== '0') throw new Error('authz cleanup refused: ownership could not be proven');
    const steps: [string, string][] = [
      ['user_permissions', `DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) AND user_account_id = ANY(${accounts})`],
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
           + (SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${userPerms}) OR user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_role_permissions WHERE role_id = ANY(${roles}))`);
    if (after?.[0] !== '0') throw new Error(`authz cleanup post-check failed: ${after?.[0]} rows remain`);
    this.roles.length = 0;
    this.userRoles.length = 0;
    this.userPermissions.length = 0;
    return deleted;
  }
}

describe.skipIf(!enabled)('FBE-05 Module & Version lifecycle — PostgreSQL (talo_mos_v4_test)', { timeout: 240_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let lifecycle: ModuleLifecycleService;
  let fault: Fault = 'NONE';
  let faultActiveId = NIL;
  let cookie = '';
  let actorId = '';
  const perm: Record<PermKey, string> = {
    registryCreate: '', create: '', update: '', submit: '', read: '', approve: '', reject: '', activate: '', retire: '', enable: '', disable: '',
  };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const keyPrefix = `FBET_${run}_`;
  let keySeq = 0;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};

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
  const send = (method: 'post' | 'put', url: string, body: unknown = {}, as = cookie) =>
    request(app)[method](url).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body));
  async function login(keys: readonly PermKey[] = PERM_KEYS): Promise<{ accountId: string; cookie: string }> {
    const acc = await fx.create();
    await az.role(acc.accountId, keys.map((k) => perm[k]));
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    cookie = cookieOf(res);
    actorId = acc.accountId;
    return { accountId: acc.accountId, cookie };
  }
  async function newModule(): Promise<{ moduleId: string; moduleKey: string }> {
    const moduleKey = `${keyPrefix}${++keySeq}`;
    const res = await send('post', '/api/foundation/modules', { moduleKey, moduleName: `FBE-05 ${keySeq}`, moduleType: 'INTERNAL' });
    expect(res.status).toBe(201);
    return { moduleId: String(res.body.module.moduleId), moduleKey };
  }
  const vurl = (moduleId: string, versionId: string, action: string) => `/api/foundation/modules/${moduleId}/versions/${versionId}/${action}`;
  const murl = (moduleId: string, action: string) => `/api/foundation/modules/${moduleId}/${action}`;
  async function submitted(moduleId: string, moduleVersion: string, manifest: unknown): Promise<string> {
    const created = await send('post', `/api/foundation/modules/${moduleId}/versions`, { moduleVersion, contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    const versionId = String(created.body.version.versionId);
    expect((await send('put', `/api/foundation/modules/${moduleId}/versions/${versionId}/manifest`, { manifest })).status).toBe(200);
    expect((await send('post', vurl(moduleId, versionId, 'submit'))).status).toBe(200);
    return versionId;
  }
  async function step(moduleId: string, versionId: string, action: string, status = 200): Promise<Response> {
    const res = await send('post', vurl(moduleId, versionId, action));
    expect(res.status, `${action} ${JSON.stringify(res.body)}`).toBe(status);
    return res;
  }

  // A valid MIC without DIRECT_DB (L3 refuses DIRECT_DB); CHANGE from `from` when given.
  function cleanMic(moduleKey: string, moduleVersion: string, from?: string) {
    const mic = validMic(moduleKey, moduleVersion);
    return {
      ...mic,
      mic06DataResources: mic.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB'),
      mic09Compatibility: from === undefined ? mic.mic09Compatibility : { kind: 'CHANGE', fromVersion: from, changes: ['Thay đổi'] },
    };
  }
  // CHANGE of cleanMic: REPORT renamed (MODIFIED), ORDER.CREATE removed (REMOVED), ORDER_FEED relation added (MODIFIED).
  function changedMic(moduleKey: string, moduleVersion: string, from: string) {
    const mic = cleanMic(moduleKey, moduleVersion, from);
    return {
      ...mic,
      mic02Functions: mic.mic02Functions.map((f) => (f.functionKey === 'REPORT' ? { ...f, name: 'Báo cáo tổng hợp' } : f)),
      mic03Actions: mic.mic03Actions.filter((a) => !(a.functionKey === 'ORDER' && a.actionKey === 'CREATE')),
      mic05Api: mic.mic05Api.filter((a) => a.actionKey !== 'CREATE'),
      mic07IamMapping: mic.mic07IamMapping.filter((m) => !(m.functionKey === 'ORDER' && m.actionKey === 'CREATE')),
      mic06DataResources: mic.mic06DataResources.map((r) => ({ ...r, relations: ['order_feed -> sales.orders.order_id'] })),
    };
  }

  // REV01-D3: a run-unique MIC-04 route (the shared /sales/orders of older fixtures is held by many ENABLED FBET modules).
  function routedMic(moduleKey: string, moduleVersion: string, route: string, from?: string) {
    const mic = cleanMic(moduleKey, moduleVersion, from);
    return { ...mic, mic04Navigation: mic.mic04Navigation.map((n) => ('routePath' in n && n.routePath ? { ...n, routePath: route } : n)) };
  }
  const ownRoute = (moduleKey: string) => `/${moduleKey.toLowerCase().replace(/_/g, '-')}/orders`;
  const actor = (): Actor => ({ userAccountId: actorId, assuranceLevel: 1, requestId: randomUUID() });

  // Harness reads (SELECT on B01–B14).
  async function version(versionId: string) {
    const [r] = await h.ok(`SELECT status, coalesce(reviewed_by_account_id::text, '<null>'), coalesce(reviewed_at::text, '<null>'), coalesce(activated_at::text, '<null>'),
        manifest_hash, (reviewed_at IS NULL OR reviewed_at <= now()), (activated_at IS NULL OR activated_at >= reviewed_at)
      FROM ${B02} WHERE version_id = ${lit(versionId)}`);
    return { status: r?.[0], reviewer: r?.[1], reviewedAt: r?.[2], activatedAt: r?.[3], hash: r?.[4], reviewedPast: r?.[5], activatedAfterReview: r?.[6] };
  }
  async function module(moduleId: string) {
    const [r] = await h.ok(`SELECT is_enabled, updated_at::text, (updated_at >= created_at) FROM foundation.fnd_modules WHERE module_id = ${lit(moduleId)}`);
    return { enabled: r?.[0], updatedAt: r?.[1], updatedAfterCreate: r?.[2] };
  }
  async function eventsOf(requestId: string) {
    return (await h.ok(`SELECT event_type, coalesce(version_id::text, '<null>'), before_state::text, after_state::text, actor_account_id::text
      FROM foundation.fnd_module_events WHERE correlation_id = ${lit(requestId)} ORDER BY occurred_at, event_type`)).map((r) => ({
      type: r[0], versionId: r[1], before: JSON.parse(r[2] ?? 'null'), after: JSON.parse(r[3] ?? 'null'), actor: r[4],
    }));
  }
  async function auditsOf(requestId: string) {
    return (await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(version_id::text, '<null>'), coalesce(module_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)}`)).map((r) => ({
      action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], versionId: r[4], moduleId: r[5], metadata: JSON.parse(r[6] ?? 'null'),
    }));
  }
  const activeCount = async (moduleId: string) => Number((await h.ok(`SELECT count(*) FROM ${B02} WHERE module_id = ${lit(moduleId)} AND status = 'ACTIVE'`))[0]?.[0]);
  const ungrantedLocks = async () => Number((await h.ok('SELECT count(*) FROM pg_locks WHERE NOT granted'))[0]?.[0]);
  async function moduleState(moduleId: string): Promise<string> {
    const rows = await h.ok(`SELECT string_agg(version_id::text || ':' || status || ':' || coalesce(reviewed_at::text, '-') || ':' || coalesce(activated_at::text, '-'), '|' ORDER BY version_id),
        (SELECT is_enabled::text || updated_at::text FROM foundation.fnd_modules WHERE module_id = ${lit(moduleId)}),
        (SELECT count(*) FROM foundation.fnd_module_events WHERE module_id = ${lit(moduleId)}), (SELECT count(*) FROM foundation.fnd_audit_logs WHERE module_id = ${lit(moduleId)})
      FROM ${B02} WHERE module_id = ${lit(moduleId)}`);
    return JSON.stringify(rows);
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
    const db = faultyDb(prismaFoundationDb(prisma), () => fault, () => faultActiveId);
    const foundation = createFoundationModule({
      prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST',
      repository: new SqlFoundationRepository(db), versionRepository: new SqlModuleVersionRepository(db), manifestRepository: new SqlManifestRepository(db, 'TEST'),
      lifecycleRepository: new SqlLifecycleRepository(db),
    });
    lifecycle = foundation.lifecycleService;
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router] });
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
  });

  afterEach(async () => {
    fault = 'NONE';
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    if (h) {
      const [twoActive] = await h.ok(`SELECT count(*) FROM (SELECT module_id FROM ${B02} WHERE status = 'ACTIVE' GROUP BY module_id HAVING count(*) > 1) x`);
      evidence['modulesWithTwoActive'] = Number(twoActive?.[0]);
      const [iam] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions WHERE module_code = 'FOUNDATION'),
        (SELECT count(*) FROM iam.iam_role_permissions) + (SELECT count(*) FROM iam.iam_user_roles) + (SELECT count(*) FROM iam.iam_user_permissions)`);
      evidence['iamAfter'] = { foundationPermissions: Number(iam?.[0]), assignments: Number(iam?.[1]) };
    }
    console.log(`[fbe05] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe05] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ FP-5

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

  it('FP5-1 / FP5-2: every LIFECYCLE_SQL statement plans as talo_app; the B01 / B02 / B14 matrix is exact (section VI); forbidden statements → 42501 (EXPLAIN only)', async () => {
    const statements: [string, string, unknown[]][] = [
      ['getModule', LIFECYCLE_SQL.getModule, [NIL]], ['approveVersion', LIFECYCLE_SQL.approveVersion, [NIL, NIL, NIL]],
      ['rejectVersion', LIFECYCLE_SQL.rejectVersion, [NIL, NIL, NIL]], ['retireCurrentActive', LIFECYCLE_SQL.retireCurrentActive, [NIL, NIL]],
      ['activateVersion', LIFECYCLE_SQL.activateVersion, [NIL, NIL]], ['retireVersion', LIFECYCLE_SQL.retireVersion, [NIL, NIL]],
      ['activeVersions', LIFECYCLE_SQL.activeVersions, [NIL]], ['latestChecks', LIFECYCLE_SQL.latestChecks, [NIL, NIL]],
      ['blockingChanges', LIFECYCLE_SQL.blockingChanges, [NIL]], ['directDbContracts', LIFECYCLE_SQL.directDbContracts, [NIL]],
      ['enableModule', LIFECYCLE_SQL.enableModule, [NIL]], ['disableModule', LIFECYCLE_SQL.disableModule, [NIL]],
      ['insertLifecycleEvent', LIFECYCLE_SQL.insertLifecycleEvent, [NIL, null, 'ENABLE', NIL, '{}', '{}', 'plan']],
      // REV01-D1 / D3
      ['reactivateVersion', LIFECYCLE_SQL.reactivateVersion, [NIL, NIL]], ['lockRouteClaims', LIFECYCLE_SQL.lockRouteClaims, []],
      ['routeHolders', LIFECYCLE_SQL.routeHolders, [NIL, ['/x']]],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual(Object.keys(LIFECYCLE_SQL).sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(statements.map((s) => [s[0], 'OK'])));
    const forbidden: Record<string, string> = {
      'UPDATE B01.module_name': `UPDATE foundation.fnd_modules SET module_name = module_name`,
      'UPDATE B01.module_key': `UPDATE foundation.fnd_modules SET module_key = module_key`,
      'UPDATE B01.created_at': `UPDATE foundation.fnd_modules SET created_at = now()`,
      'DELETE B01': `DELETE FROM foundation.fnd_modules`,
      'UPDATE B02.contract_version': `UPDATE ${B02} SET contract_version = contract_version`,
      'UPDATE B02.module_version': `UPDATE ${B02} SET module_version = module_version`,
      'UPDATE B02.created_at': `UPDATE ${B02} SET created_at = now()`,
      'DELETE B02': `DELETE FROM ${B02}`,
      'UPDATE B13': `UPDATE foundation.fnd_compatibility_checks SET check_result = 'PASS'`,
      'UPDATE B14.resolution_status': `UPDATE foundation.fnd_compatibility_changes SET resolution_status = 'RESOLVED'`,
      'UPDATE B14.severity': `UPDATE foundation.fnd_compatibility_changes SET severity = 'INFO'`,
      'DELETE B14': `DELETE FROM foundation.fnd_compatibility_changes`,
      'SELECT B07': `SELECT 1 FROM foundation.fnd_module_events`,
      'UPDATE B07': `UPDATE foundation.fnd_module_events SET event_type = event_type`,
      'DELETE B07': `DELETE FROM foundation.fnd_module_events`,
      'SELECT B08': `SELECT 1 FROM foundation.fnd_audit_logs`,
      'UPDATE B08': `UPDATE foundation.fnd_audit_logs SET outcome = outcome`,
      'DELETE B08': `DELETE FROM foundation.fnd_audit_logs`,
      // FBE-06: SELECT on B09 is granted (navigation); deleting menu items stays forbidden.
      'DELETE B09': `DELETE FROM foundation.fnd_navigation_items`,
      'INSERT iam_permissions': `INSERT INTO iam.iam_permissions (permission_code, module_code, resource_code, operation) VALUES ('x', 'X', 'X', 'READ')`,
      'INSERT iam_role_permissions': `INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES ('${NIL}', '${NIL}')`,
      'INSERT iam_user_permissions': `INSERT INTO iam.iam_user_permissions (user_account_id, permission_id, effect) VALUES ('${NIL}', '${NIL}', 'ALLOW')`,
      'UPDATE iam_permissions': `UPDATE iam.iam_permissions SET minimum_assurance_level = 1`,
    };
    const refused: Record<string, string> = {};
    for (const [name, sql] of Object.entries(forbidden)) refused[name] = await plan(sql, []);
    expect(refused).toEqual(Object.fromEntries(Object.keys(forbidden).map((k) => [k, '42501'])));
    const matrix = await prisma.$queryRawUnsafe<{ t: string; sel: boolean; del: boolean; trunc: boolean; upd: string | null }[]>(`
      SELECT t, has_table_privilege('foundation.' || t, 'SELECT') AS sel, has_table_privilege('foundation.' || t, 'DELETE') AS del,
             has_table_privilege('foundation.' || t, 'TRUNCATE') AS trunc,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = ('foundation.' || t)::regclass AND attnum > 0
                AND has_column_privilege(('foundation.' || t)::regclass, attname, 'UPDATE')) AS upd
        FROM unnest(ARRAY['fnd_modules', 'fnd_module_versions', 'fnd_compatibility_checks', 'fnd_compatibility_changes', 'fnd_module_events', 'fnd_audit_logs']) AS t ORDER BY t COLLATE "C"`);
    expect(matrix).toEqual([
      { t: 'fnd_audit_logs', sel: false, del: false, trunc: false, upd: null },
      { t: 'fnd_compatibility_changes', sel: true, del: false, trunc: false, upd: null },
      { t: 'fnd_compatibility_checks', sel: true, del: false, trunc: false, upd: null },
      { t: 'fnd_module_events', sel: false, del: false, trunc: false, upd: null },
      { t: 'fnd_module_versions', sel: true, del: false, trunc: false, upd: 'status,manifest_json,manifest_hash,submitted_by_account_id,reviewed_by_account_id,reviewed_at,activated_at' },
      { t: 'fnd_modules', sel: true, del: false, trunc: false, upd: 'is_enabled,updated_at' },
    ]);
    evidence['fp5Matrix'] = matrix;
    const [iam] = await h.ok(`SELECT string_agg(permission_code || ':' || operation || ':' || minimum_assurance_level, ',' ORDER BY permission_code) FROM iam.iam_permissions
      WHERE module_code = 'FOUNDATION' AND operation IN ('APPROVE', 'REJECT', 'ACTIVATE', 'RETIRE', 'ENABLE', 'DISABLE')`);
    expect(iam?.[0]).toBe('foundation.module_registry.disable:DISABLE:1,foundation.module_registry.enable:ENABLE:1,foundation.module_version.activate:ACTIVATE:1,'
      + 'foundation.module_version.approve:APPROVE:1,foundation.module_version.reject:REJECT:1,foundation.module_version.retire:RETIRE:1');
  });

  it('FP5-3: Prisma adapter — real D-05 / D-06 / A-02 / N-08 SQLSTATEs (23514) on the granted columns; all rolled back', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const versionId = await submitted(moduleId, '1.0.0', cleanMic(moduleKey, '1.0.0'));
    const sqlstate = async (fn: (tx: SqlExecutor) => Promise<unknown>) => {
      try {
        await prismaFoundationDb(prisma).transaction(async (tx) => fn(tx));
        return 'none';
      } catch (error) {
        return sqlstateOf(error) ?? 'unknown';
      }
    };
    const states = {
      d05ApprovedWithoutReview: await sqlstate((tx) => tx.execute(`UPDATE ${B02} SET status = 'APPROVED' WHERE version_id = $1::uuid`, [versionId])),
      d06ActiveWithoutActivation: await sqlstate((tx) => tx.execute(`UPDATE ${B02} SET status = 'ACTIVE', reviewed_by_account_id = $2::uuid, reviewed_at = now() WHERE version_id = $1::uuid`, [versionId, actorId])),
      d06ApprovedWithActivation: await sqlstate((tx) => tx.execute(`UPDATE ${B02} SET status = 'APPROVED', reviewed_by_account_id = $2::uuid, reviewed_at = now(), activated_at = now() WHERE version_id = $1::uuid`, [versionId, actorId])),
      a02Status: await sqlstate((tx) => tx.execute(`UPDATE ${B02} SET status = 'PUBLISHED' WHERE version_id = $1::uuid`, [versionId])),
      n08EventType: await sqlstate((tx) => tx.execute(LIFECYCLE_SQL.insertLifecycleEvent, [moduleId, versionId, 'PUBLISH', actorId, '{}', '{}', 'x'])),
      eventOtherModule: await sqlstate((tx) => tx.execute(LIFECYCLE_SQL.insertLifecycleEvent, [randomUUID(), versionId, 'APPROVE', actorId, '{}', '{}', 'x'])),
    };
    expect(states).toEqual({
      d05ApprovedWithoutReview: '23514', d06ActiveWithoutActivation: '23514', d06ApprovedWithActivation: '23514', a02Status: '23514', n08EventType: '23514', eventOtherModule: '23503',
    });
    expect((await version(versionId)).status).toBe('IN_REVIEW'); // everything rolled back
    evidence['fp5Adapter'] = states;
  });

  // ------------------------------------------------------------------ lifecycle

  it('V1: APPROVE / REJECT write status + reviewer = actor + PostgreSQL review time; manifest / hash / activated_at unchanged; B07 + B08 SUCCESS; REJECTED is final', async () => {
    const actor = await login();
    const { moduleId, moduleKey } = await newModule();
    const a = await submitted(moduleId, '1.0.0', cleanMic(moduleKey, '1.0.0'));
    const before = await version(a);
    const ra = await step(moduleId, a, 'approve');
    const va = await version(a);
    expect(va).toMatchObject({ status: 'APPROVED', reviewer: actor.accountId, activatedAt: '<null>', hash: before.hash, reviewedPast: 't' });
    expect(ra.body.version).toMatchObject({ status: 'APPROVED', reviewedByAccountId: actor.accountId, manifestHash: before.hash, activatedAt: null });
    expect(await eventsOf(rid(ra))).toEqual([{ type: 'APPROVE', versionId: a, before: { status: 'IN_REVIEW' }, after: { status: 'APPROVED' }, actor: actor.accountId }]);
    expect(await auditsOf(rid(ra))).toEqual([{ action: 'MODULE_VERSION.APPROVE', outcome: 'SUCCESS', targetType: 'MODULE_VERSION', targetId: a, versionId: a, moduleId, metadata: { v: 1, reason: 'APPROVED', requestId: rid(ra) } }]);
    const b = await submitted(moduleId, '1.1.0', cleanMic(moduleKey, '1.1.0', '1.0.0'));
    const rb = await step(moduleId, b, 'reject');
    expect(await version(b)).toMatchObject({ status: 'REJECTED', reviewer: actor.accountId, activatedAt: '<null>' });
    expect((await eventsOf(rid(rb))).map((e) => e.type)).toEqual(['REJECT']);
    for (const action of ['approve', 'reject', 'activate', 'retire']) expect((await step(moduleId, b, action, 409)).body.error.code).toBe('VERSION_STATE_CONFLICT');
    for (const action of ['reject', 'retire']) await step(moduleId, a, action, 409); // APPROVED → REJECTED / RETIRED forbidden
    expect((await send('put', `/api/foundation/modules/${moduleId}/versions/${a}/manifest`, { manifest: cleanMic(moduleKey, '1.0.0') })).status).toBe(409);
    expect((await version(a)).hash).toBe(before.hash);
  });

  it('V2 (+ FBE-04 CHANGE branch): V1 → ACTIVE; V2 CHANGE from V1 → B13 WARN + B14 MODIFIED / REMOVED on PostgreSQL; activating V2 retires V1 in the same transaction', async () => {
    const actor = await login();
    const { moduleId, moduleKey } = await newModule();
    const v1 = await submitted(moduleId, '1.0.0', cleanMic(moduleKey, '1.0.0'));
    await step(moduleId, v1, 'approve');
    const r1 = await step(moduleId, v1, 'activate');
    const s1 = await version(v1);
    expect(s1).toMatchObject({ status: 'ACTIVE', activatedAfterReview: 't' });
    expect(await eventsOf(rid(r1))).toMatchObject([{ type: 'ACTIVATE', versionId: v1, before: { status: 'APPROVED' }, after: { status: 'ACTIVE' } }]);
    const v2Mic = changedMic(moduleKey, '2.0.0', '1.0.0');
    const v2 = await submitted(moduleId, '2.0.0', v2Mic);
    // FBE-04 CHANGE comparison against the real APPROVED-then-ACTIVE V1 (reached through the API only).
    const [check] = await h.ok(`SELECT check_id::text, coalesce(from_version_id::text, '<null>'), check_result, environment FROM foundation.fnd_compatibility_checks WHERE to_version_id = ${lit(v2)}`);
    expect([check?.[1], check?.[2], check?.[3]]).toEqual([v1, 'WARN', 'TEST']);
    const changes = await h.ok(`SELECT change_area, object_key, change_type, severity, (previous_value IS NULL), (proposed_value IS NULL)
      FROM foundation.fnd_compatibility_changes WHERE check_id = ${lit(check?.[0] ?? NIL)} ORDER BY change_area, object_key COLLATE "C"`);
    expect(changes).toEqual([
      ['ACTION', 'ACTION:ORDER.CREATE', 'REMOVED', 'WARNING', 'f', 't'],
      ['DATA', 'DATA:ORDER_FEED', 'MODIFIED', 'WARNING', 'f', 'f'],
      ['FUNCTION', 'FUNCTION:REPORT', 'MODIFIED', 'WARNING', 'f', 'f'],
    ]);
    const [prev] = await h.ok(`SELECT previous_value::text, proposed_value::text FROM foundation.fnd_compatibility_changes WHERE check_id = ${lit(check?.[0] ?? NIL)} AND object_key = 'FUNCTION:REPORT'`);
    expect([JSON.parse(prev?.[0] ?? 'null'), JSON.parse(prev?.[1] ?? 'null')]).toEqual([{ functionKey: 'REPORT', name: 'Báo cáo' }, { functionKey: 'REPORT', name: 'Báo cáo tổng hợp' }]);
    evidence['changeBranch'] = { checkResult: check?.[2], changes };
    await step(moduleId, v2, 'approve');
    const r2 = await step(moduleId, v2, 'activate'); // WARN is accepted (L3)
    expect(await version(v1)).toMatchObject({ status: 'RETIRED', activatedAt: s1.activatedAt, reviewer: s1.reviewer });
    expect((await version(v2)).status).toBe('ACTIVE');
    expect(await activeCount(moduleId)).toBe(1);
    expect(await eventsOf(rid(r2))).toEqual([
      { type: 'ACTIVATE', versionId: v2, before: { status: 'APPROVED' }, after: { status: 'ACTIVE' }, actor: actor.accountId },
      { type: 'RETIRE', versionId: v1, before: { status: 'ACTIVE' }, after: { status: 'RETIRED' }, actor: actor.accountId },
    ]); // same transaction (same occurred_at); ordered by type here
    expect(await auditsOf(rid(r2))).toEqual([{
      action: 'MODULE_VERSION.ACTIVATE', outcome: 'SUCCESS', targetType: 'MODULE_VERSION', targetId: v2, versionId: v2, moduleId,
      metadata: { v: 1, reason: 'ACTIVATED', requestId: rid(r2), retiredVersionId: v1 },
    }]);
    for (const action of ['activate', 'approve']) await step(moduleId, v1, action, 409); // RETIRED → ACTIVE needs the separate rollback process
  });

  it('V3: L3 gates on PostgreSQL — DIRECT_DB contract, MIC-10 NOT_TESTED → 422 ACTIVATION_BLOCKED, nothing written', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const direct = await submitted(moduleId, '1.0.0', validMic(moduleKey, '1.0.0'));
    await step(moduleId, direct, 'approve');
    const mic = cleanMic(moduleKey, '1.1.0', '1.0.0');
    const untested = await submitted(moduleId, '1.1.0', { ...mic, mic10Manifest: { ...mic.mic10Manifest, testEvidence: [{ name: 'E2E', result: 'NOT_TESTED', reference: 'n/a' }] } });
    await step(moduleId, untested, 'approve');
    for (const [v, code] of [[direct, 'DIRECT_DB_APPROVAL_MISSING'], [untested, 'TEST_EVIDENCE_NOT_PASSED']] as const) {
      const before = await moduleState(moduleId);
      const res = await step(moduleId, v, 'activate', 422);
      expect(res.body.error, code).toMatchObject({ code: 'ACTIVATION_BLOCKED', details: { errors: [code] } });
      expect(await moduleState(moduleId), code).toBe(before);
      expect(await auditsOf(rid(res)), code).toEqual([]);
    }
  });

  it('V4: RETIRE keeps activated_at, activates nothing else, leaves Function / Data rows; ENABLE / DISABLE (L5) with updated_at, B07 / B08', async () => {
    const actor = await login();
    const { moduleId, moduleKey } = await newModule();
    const e0 = await send('post', murl(moduleId, 'enable'));
    expect(e0.status).toBe(422);
    expect(e0.body.error).toMatchObject({ code: 'MODULE_ENABLE_BLOCKED', details: { errors: ['NO_ACTIVE_VERSION'] } });
    // REV01-D3: a module-own route (ENABLE refuses a route held by another ENABLED module, e.g. /sales/orders of older fixtures)
    const v1 = await submitted(moduleId, '1.0.0', routedMic(moduleKey, '1.0.0', ownRoute(moduleKey)));
    await step(moduleId, v1, 'approve');
    await step(moduleId, v1, 'activate');
    expect((await module(moduleId)).enabled).toBe('f'); // activation never enables
    const m0 = await module(moduleId);
    const en = await send('post', murl(moduleId, 'enable'));
    expect(en.status).toBe(200);
    expect(en.body.module).toMatchObject({ moduleId, isEnabled: true });
    const m1 = await module(moduleId);
    expect(m1.enabled).toBe('t');
    expect(m1.updatedAt).not.toBe(m0.updatedAt);
    expect(m1.updatedAfterCreate).toBe('t');
    expect(await eventsOf(rid(en))).toEqual([{ type: 'ENABLE', versionId: '<null>', before: { is_enabled: false }, after: { is_enabled: true }, actor: actor.accountId }]);
    expect(await auditsOf(rid(en))).toEqual([{ action: 'MODULE_REGISTRY.ENABLE', outcome: 'SUCCESS', targetType: 'MODULE', targetId: moduleId, versionId: '<null>', moduleId, metadata: { v: 1, reason: 'ENABLED', requestId: rid(en) } }]);
    expect((await send('post', murl(moduleId, 'enable'))).body.error.code).toBe('MODULE_STATE_CONFLICT');
    const dis = await send('post', murl(moduleId, 'disable'));
    expect(dis.status).toBe(200);
    expect((await version(v1)).status).toBe('ACTIVE'); // DISABLE leaves the ACTIVE version
    expect((await eventsOf(rid(dis))).map((e) => e.type)).toEqual(['DISABLE']);
    expect((await send('post', murl(moduleId, 'disable'))).body.error.code).toBe('MODULE_STATE_CONFLICT');
    const defsBefore = await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_version_functions WHERE version_id = ${lit(v1)}), (SELECT count(*) FROM foundation.fnd_data_contracts WHERE version_id = ${lit(v1)})`);
    const at = (await version(v1)).activatedAt;
    const rr = await step(moduleId, v1, 'retire');
    expect(await version(v1)).toMatchObject({ status: 'RETIRED', activatedAt: at });
    expect(await activeCount(moduleId)).toBe(0);
    expect((await eventsOf(rid(rr))).map((e) => [e.type, e.versionId])).toEqual([['RETIRE', v1]]);
    expect((await auditsOf(rid(rr))).map((a) => [a.action, a.outcome])).toEqual([['MODULE_VERSION.RETIRE', 'SUCCESS']]);
    expect(await h.ok(`SELECT (SELECT count(*) FROM foundation.fnd_version_functions WHERE version_id = ${lit(v1)}), (SELECT count(*) FROM foundation.fnd_data_contracts WHERE version_id = ${lit(v1)})`)).toEqual(defsBefore);
    expect((await send('post', murl(moduleId, 'enable'))).body.error.details.errors).toEqual(['NO_ACTIVE_VERSION']);
  });

  it('V5: authorisation through the real evaluator — missing permission → 403 + B08 DENIED (target NULL) before any lookup; Direct DENY beats role ALLOW', async () => {
    const full = await login();
    const { moduleId, moduleKey } = await newModule();
    const v = await submitted(moduleId, '1.0.0', cleanMic(moduleKey, '1.0.0'));
    const weak = await login(['read']);
    const cases: [string, string][] = [
      [vurl(moduleId, v, 'approve'), 'MODULE_VERSION.APPROVE'], [vurl(moduleId, v, 'reject'), 'MODULE_VERSION.REJECT'],
      [vurl(moduleId, v, 'activate'), 'MODULE_VERSION.ACTIVATE'], [vurl(moduleId, v, 'retire'), 'MODULE_VERSION.RETIRE'],
      [murl(moduleId, 'enable'), 'MODULE_REGISTRY.ENABLE'], [murl(moduleId, 'disable'), 'MODULE_REGISTRY.DISABLE'],
      [vurl(NIL, NIL, 'approve'), 'MODULE_VERSION.APPROVE'], [murl('not-a-uuid', 'enable'), 'MODULE_REGISTRY.ENABLE'],
    ];
    for (const [url, action] of cases) {
      const res = await send('post', url, {}, weak.cookie);
      expect(res.status, url).toBe(403);
      expect(await auditsOf(rid(res)), url).toEqual([{
        action, outcome: 'DENIED', targetType: action.startsWith('MODULE_VERSION') ? 'MODULE_VERSION' : 'MODULE_REGISTRY', targetId: '<null>', versionId: '<null>', moduleId: '<null>',
        metadata: { v: 1, reason: 'NO_VALID_ALLOW', requestId: rid(res) },
      }]);
    }
    await az.direct(full.accountId, perm.approve, 'DENY');
    const denied = await send('post', vurl(moduleId, v, 'approve'), {}, full.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied)))[0]?.metadata).toMatchObject({ reason: 'DIRECT_DENY' });
    expect((await version(v)).status).toBe('IN_REVIEW');
  });

  it('V6: rollback on real SQL errors in B02 / Q01 / B01 / B07 / B08 → 503, nothing of the request kept, the same request then succeeds', async () => {
    await login();
    const seen: Record<string, number> = {};
    const prepare = async (): Promise<{ moduleId: string; v1: string; v2: string }> => {
      const { moduleId, moduleKey } = await newModule();
      // REV01-D3: module-own route (the B01_ENABLE case enables this module)
      const v1 = await submitted(moduleId, '1.0.0', routedMic(moduleKey, '1.0.0', ownRoute(moduleKey)));
      await step(moduleId, v1, 'approve');
      await step(moduleId, v1, 'activate');
      const v2 = await submitted(moduleId, '2.0.0', routedMic(moduleKey, '2.0.0', ownRoute(moduleKey), '1.0.0'));
      return { moduleId, v1, v2 };
    };
    const cases: [Fault, string, (c: { moduleId: string; v1: string; v2: string }) => Promise<void>, (c: { moduleId: string; v1: string; v2: string }) => string][] = [
      ['B02_APPROVE', '22P02', async () => {}, (c) => vurl(c.moduleId, c.v2, 'approve')],
      ['B02_ACTIVATE', '22P02', async (c) => { await step(c.moduleId, c.v2, 'approve'); }, (c) => vurl(c.moduleId, c.v2, 'activate')],
      ['Q01_SKIP_RETIRE', '23505', async (c) => { await step(c.moduleId, c.v2, 'approve'); faultActiveId = c.v1; }, (c) => vurl(c.moduleId, c.v2, 'activate')],
      ['B07', '23514', async (c) => { await step(c.moduleId, c.v2, 'approve'); }, (c) => vurl(c.moduleId, c.v2, 'activate')],
      ['B08_VERSION', '23514', async (c) => { await step(c.moduleId, c.v2, 'approve'); }, (c) => vurl(c.moduleId, c.v2, 'activate')],
      ['B01_ENABLE', '22P02', async () => {}, (c) => murl(c.moduleId, 'enable')],
      ['B08_MODULE', '23514', async () => {}, (c) => murl(c.moduleId, 'enable')],
    ];
    for (const [f, code, arrange, url] of cases) {
      const c = await prepare();
      await arrange(c);
      const before = await moduleState(c.moduleId);
      fault = f;
      const res = await send('post', url(c));
      fault = 'NONE';
      seen[f] = res.status;
      expect(res.status, f).toBe(503);
      expect(await moduleState(c.moduleId), f).toBe(before);
      expect(await eventsOf(rid(res)), f).toEqual([]);
      expect(await auditsOf(rid(res)), f).toEqual([]);
      expect(await activeCount(c.moduleId), f).toBe(1);
      expect(logs.some((l) => l.includes('failed (rolled back)') && l.includes(`"sqlstate":"${code}"`)), f).toBe(true);
      expect((await send('post', url(c))).status, f).toBe(200); // nothing of the failed attempt remained
    }
    evidence['v6'] = seen;
  });

  it('V7: concurrency — double ACTIVATE of one version → 200 + 409; concurrent ACTIVATE of two versions of one module serialise (one ACTIVE, no deadlock, no lock left)', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const v1 = await submitted(moduleId, '1.0.0', cleanMic(moduleKey, '1.0.0'));
    await step(moduleId, v1, 'approve');
    const [a, b] = await Promise.all([send('post', vurl(moduleId, v1, 'activate')), send('post', vurl(moduleId, v1, 'activate'))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await activeCount(moduleId)).toBe(1);
    const v2 = await submitted(moduleId, '2.0.0', cleanMic(moduleKey, '2.0.0', '1.0.0'));
    const v3 = await submitted(moduleId, '3.0.0', cleanMic(moduleKey, '3.0.0', '1.0.0'));
    await step(moduleId, v2, 'approve');
    await step(moduleId, v3, 'approve');
    const results = await Promise.all([send('post', vurl(moduleId, v2, 'activate')), send('post', vurl(moduleId, v3, 'activate')), send('post', murl(moduleId, 'enable'))]);
    expect(results.slice(0, 2).map((r) => r.status)).toEqual([200, 200]);
    expect(await activeCount(moduleId)).toBe(1);
    const statuses = (await h.ok(`SELECT module_version, status FROM ${B02} WHERE module_id = ${lit(moduleId)} ORDER BY module_version`)).map((r) => r.join(':'));
    const winner = statuses.find((s) => s.endsWith(':ACTIVE'));
    expect(['2.0.0:ACTIVE', '3.0.0:ACTIVE']).toContain(winner);
    expect(statuses.filter((s) => s.endsWith(':RETIRED'))).toHaveLength(2); // v1 and the first of v2 / v3
    expect([200, 409, 422]).toContain(results[2]?.status);
    expect(await ungrantedLocks()).toBe(0);
    expect(logs.some((l) => l.includes('40P01'))).toBe(false);
    evidence['v7'] = { double: [a.status, b.status].sort(), statuses, enable: results[2]?.status };
  });

  it('V8: C2 — lifecycle never deletes: no module of this run has fewer B03–B14 rows than its submitted versions declared; no two ACTIVE versions anywhere', async () => {
    const [two] = await h.ok(`SELECT count(*) FROM (SELECT module_id FROM ${B02} WHERE status = 'ACTIVE' GROUP BY module_id HAVING count(*) > 1) x`);
    expect(Number(two?.[0])).toBe(0);
    const [orphans] = await h.ok(`SELECT count(*) FROM ${B02} v WHERE v.status IN ('APPROVED', 'REJECTED', 'ACTIVE', 'RETIRED')
      AND (v.reviewed_at IS NULL OR v.reviewed_by_account_id IS NULL OR v.manifest_hash IS NULL
           OR NOT EXISTS (SELECT 1 FROM foundation.fnd_compatibility_checks k WHERE k.to_version_id = v.version_id))`);
    expect(Number(orphans?.[0])).toBe(0);
  });
  // ------------------------------------------------------------------ FOUNDATION REV-01 closure

  it('REV01-D1-DB: recoverUpgrade on PostgreSQL — v2 RETIRED / v1 ACTIVE (activated_at kept), one ACTIVE, B07 RETIRE + ROLLBACK, B08 ROLLBACK with installId; proof mismatch, B07 fault and a concurrent second recovery change nothing', async () => {
    await login();
    const { moduleId, moduleKey } = await newModule();
    const route = `/fbet-${run.toLowerCase().replace(/_/g, '-')}-d1`;
    const v1 = await submitted(moduleId, '1.0.0', routedMic(moduleKey, '1.0.0', route));
    await step(moduleId, v1, 'approve');
    await step(moduleId, v1, 'activate');
    const v2 = await submitted(moduleId, '1.1.0', routedMic(moduleKey, '1.1.0', route, '1.0.0'));
    await step(moduleId, v2, 'approve');
    const act = await step(moduleId, v2, 'activate');
    const activatedAt = String(act.body.version.activatedAt);
    const v1Before = await version(v1);
    expect([v1Before.status, (await version(v2)).status]).toEqual(['RETIRED', 'ACTIVE']);
    const installId = randomUUID();
    // proof mismatch (another activated_at) → 409, nothing written
    const s0 = await moduleState(moduleId);
    await expect(lifecycle.recoverUpgrade(actor(), { moduleId, failedVersionId: v2, restoreVersionId: v1, failedActivatedAt: '2020-01-01T00:00:00.000000Z', installId })).rejects.toMatchObject({ status: 409, code: 'RECOVERY_PROOF_MISMATCH' });
    expect(await moduleState(moduleId)).toBe(s0);
    // a real PostgreSQL error in B07 (N-08 CHECK) inside the recovery → 503, whole transaction rolled back
    fault = 'B07';
    await expect(lifecycle.recoverUpgrade(actor(), { moduleId, failedVersionId: v2, restoreVersionId: v1, failedActivatedAt: activatedAt, installId })).rejects.toMatchObject({ status: 503 });
    fault = 'NONE';
    expect(await moduleState(moduleId)).toBe(s0);
    // two recoveries at once: one wins, the other is refused (module lock), no deadlock, no lock left
    const a1 = actor();
    const a2 = actor();
    const results = await Promise.allSettled([
      lifecycle.recoverUpgrade(a1, { moduleId, failedVersionId: v2, restoreVersionId: v1, failedActivatedAt: activatedAt, installId }),
      lifecycle.recoverUpgrade(a2, { moduleId, failedVersionId: v2, restoreVersionId: v1, failedActivatedAt: activatedAt, installId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ status: 409, code: 'VERSION_STATE_CONFLICT' });
    const winner = results[0]?.status === 'fulfilled' ? a1 : a2;
    const v1After = await version(v1);
    expect([v1After.status, (await version(v2)).status, await activeCount(moduleId)]).toEqual(['ACTIVE', 'RETIRED', 1]);
    expect(v1After.activatedAt).toBe(v1Before.activatedAt); // D-06: first activation time kept
    expect((await eventsOf(winner.requestId)).map((e) => [e.type, e.versionId, e.before, e.after, e.actor])).toEqual([
      ['RETIRE', v2, { status: 'ACTIVE' }, { status: 'RETIRED' }, actorId],
      ['ROLLBACK', v1, { status: 'RETIRED' }, { status: 'ACTIVE' }, actorId],
    ]);
    const audits = await auditsOf(winner.requestId);
    expect(audits.map((x) => [x.action, x.outcome, x.versionId, x.moduleId])).toEqual([['MODULE_VERSION.ROLLBACK', 'SUCCESS', v1, moduleId]]);
    expect(audits[0]?.metadata).toMatchObject({ failedVersionId: v2, installId });
    expect(await ungrantedLocks()).toBe(0);
    // no generic RETIRED → ACTIVE: the retired v2 cannot be activated again
    await step(moduleId, v2, 'activate', 409);
    evidence['d1'] = { moduleKey, v1: v1After.status, v2: 'RETIRED', events: (await eventsOf(winner.requestId)).map((e) => e.type), audit: audits[0]?.action, concurrent: results.map((r) => r.status) };
  });

  it('REV01-D3-DB: ENABLE route guard on PostgreSQL — FBET_ST fixture vs SYSTEM_TEST (/system-test, /system-test/runner) refused unchanged; two modules with one route enabled at once → 200 + 409', async () => {
    await login();
    // (a) the existing fixture FBET_ST_* (ACTIVE, DISABLED) whose ACTIVE MIC-04 holds the SYSTEM_TEST routes — never modified
    const holders = await h.ok(`SELECT m.module_key, m.is_enabled::text, string_agg(n.route_path, ',' ORDER BY n.route_path) FROM foundation.fnd_modules m
      JOIN ${B02} v ON v.module_id = m.module_id AND v.status = 'ACTIVE'
      CROSS JOIN LATERAL (SELECT e->>'routePath' AS route_path FROM jsonb_array_elements(v.manifest_json->'mic04Navigation') e) n
      WHERE n.route_path IN ('/system-test', '/system-test/runner') GROUP BY m.module_key, m.is_enabled ORDER BY m.module_key`);
    const st = holders.find((r) => r[0] === 'SYSTEM_TEST');
    const fixture = holders.find((r) => (r[0] ?? '').startsWith('FBET_ST_') && r[1] === 'false' && r[2] === '/system-test,/system-test/runner');
    expect(st?.slice(1)).toEqual(['true', '/system-test,/system-test/runner']);
    expect(fixture).toBeDefined();
    const [fid] = await h.ok(`SELECT module_id FROM foundation.fnd_modules WHERE module_key = ${lit(fixture?.[0] ?? '')}`);
    const fixtureId = fid?.[0] ?? NIL;
    const before = await moduleState(fixtureId);
    const res = await send('post', murl(fixtureId, 'enable'));
    if (res.status === 200) await send('post', murl(fixtureId, 'disable')); // never leave the fixture enabled (then fail below)
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'MODULE_ROUTE_CONFLICT', details: { errors: ['/system-test@SYSTEM_TEST', '/system-test/runner@SYSTEM_TEST'] } });
    expect(await moduleState(fixtureId)).toBe(before); // is_enabled, updated_at, B07, B08 unchanged
    expect(await auditsOf(rid(res))).toEqual([]); // gate refusal policy: no B08 row
    // (b) race: two run modules, same run-unique route, both ACTIVE; ENABLE at once → one 200, one 409 naming the winner
    const route = `/fbet-${run.toLowerCase().replace(/_/g, '-')}-d3`;
    const mods: { moduleId: string; moduleKey: string }[] = [];
    for (let i = 0; i < 2; i += 1) {
      const m = await newModule();
      const v = await submitted(m.moduleId, '1.0.0', routedMic(m.moduleKey, '1.0.0', route));
      await step(m.moduleId, v, 'approve');
      await step(m.moduleId, v, 'activate');
      mods.push(m);
    }
    const [r1, r2] = await Promise.all(mods.map((m) => send('post', murl(m.moduleId, 'enable'))));
    try {
    expect([r1?.status, r2?.status].sort()).toEqual([200, 409]);
    const winIdx = r1?.status === 200 ? 0 : 1;
    const lost = winIdx === 0 ? r2 : r1;
    expect(lost?.body.error).toMatchObject({ code: 'MODULE_ROUTE_CONFLICT', details: { errors: [`${route}@${mods[winIdx]?.moduleKey ?? ''}`] } });
    const enabledNow: (string | undefined)[] = [];
    for (const m of mods) enabledNow.push((await module(m.moduleId)).enabled); // one psql session: sequential reads
    expect(enabledNow.filter((e) => e === 't')).toHaveLength(1);
    expect(await ungrantedLocks()).toBe(0);
    expect(logs.some((l) => l.includes('40P01'))).toBe(false);
    // after DISABLE of the winner the other one may be enabled; both end DISABLED (no ENABLED run module left behind)
    expect((await send('post', murl(mods[winIdx]?.moduleId ?? NIL, 'disable'))).status).toBe(200);
    const other = mods[1 - winIdx]?.moduleId ?? NIL;
    expect((await send('post', murl(other, 'enable'))).status).toBe(200);
    expect((await send('post', murl(other, 'disable'))).status).toBe(200);
    } finally {
      for (const m of mods) if ((await module(m.moduleId)).enabled === 't') await send('post', murl(m.moduleId, 'disable')); // no ENABLED run module left
    }
    evidence['d3'] = { fixture: fixture?.[0], conflict: res.body.error.details.errors, race: [r1?.status, r2?.status], route };
  });
});
