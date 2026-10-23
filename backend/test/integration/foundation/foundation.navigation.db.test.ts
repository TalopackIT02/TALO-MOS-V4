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
import { SqlLifecycleRepository } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import { SqlManifestRepository } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { NAVIGATION_SQL, SqlNavigationRepository } from '../../../src/modules/foundation/foundation.navigation.repository.js';
import { FOUNDATION_SQL, SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { SqlModuleVersionRepository } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { validMic } from '../../unit/foundation/mic.fixture.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FBE-06-VERIFY — Navigation (B09) on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1. Real
// Express app + auth + Foundation modules as talo_app, Prisma pg adapter, real transactions. Fixtures (talo_test_harness):
// AUTHT- accounts and FBET- IAM roles / direct grants, removed by proven UUID. Foundation rows (B01–B14) are append-only
// (C2). Lifecycle states are reached through the FBE-05 API only.
// Positive menu visibility (owner UNBLOCK, option 1): each run registers its OWN permission definitions with the K05 triple
// of its own fixture module (module_code = FBET_<RUN>_<n>, permission_code fbet_<run>.…), with explicit UUIDs, and deletes
// exactly those after proving ownership (UUID + run prefix + no reference outside the run). PostgreSQL itself does not
// restrict talo_test_harness DELETE on iam_permissions to fixture rows; the proof is done here before every DELETE.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const B09 = 'foundation.fnd_navigation_items';
const PERMS = {
  registryCreate: 'foundation.module_registry.create', create: 'foundation.module_version.create', update: 'foundation.module_version.update',
  submit: 'foundation.module_version.submit', read: 'foundation.module_version.read', approve: 'foundation.module_version.approve',
  activate: 'foundation.module_version.activate', enable: 'foundation.module_registry.enable', disable: 'foundation.module_registry.disable',
  navigation: 'foundation.navigation.manage',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryCreate', 'create', 'update', 'submit', 'read', 'approve', 'activate', 'enable', 'disable', 'navigation'];

type Fault = 'NONE' | 'B08_CREATE' | 'B08_UPDATE' | 'B09_WIDTH' | 'B08_LAYOUT';
// Navigation Builder: B08_LAYOUT breaks the B08 row of NAVIGATION.LAYOUT.APPLY — written AFTER every B09 INSERT / UPDATE of
// the draft — so the whole apply runs on PostgreSQL and is then rolled back (no B09 row of the user is changed).
let layoutAuditReached = 0;

// One bind value changed → a real PostgreSQL error inside the navigation transaction.
//   B08_CREATE / B08_UPDATE  insertAudit outcome SUCCESS (NAVIGATION.*) → 'BOGUS'   23514
//   B09_WIDTH                insertItem menu_title → 151 characters                  22001
function faultyDb(db: FoundationDb, fault: () => Fault): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    const set = (i: number, value: unknown) => params.map((p, j) => (j === i ? value : p));
    if ((f === 'B08_CREATE' || f === 'B08_UPDATE') && sql === FOUNDATION_SQL.insertAudit && params[6] === 'SUCCESS'
      && params[3] === (f === 'B08_CREATE' ? 'NAVIGATION.CREATE' : 'NAVIGATION.UPDATE')) return set(6, 'BOGUS');
    if (f === 'B09_WIDTH' && sql === NAVIGATION_SQL.insertItem) return set(3, 'x'.repeat(151));
    if (f === 'B08_LAYOUT' && sql === FOUNDATION_SQL.insertAudit && params[6] === 'SUCCESS' && params[3] === 'NAVIGATION.LAYOUT.APPLY') {
      layoutAuditReached += 1;
      return set(6, 'BOGUS');
    }
    return params;
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    query: (sql, params) => x.query(sql, rewrite(sql, params)),
    execute: (sql, params) => x.execute(sql, rewrite(sql, params)),
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))) };
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
    return this.runTag.replace('FBET-', 'FBET_') + '_';
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

describe.skipIf(!enabled)('FBE-06 Navigation — PostgreSQL (talo_mos_v4_test)', { timeout: 240_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let fault: Fault = 'NONE';
  let cookie = '';
  const perm: Record<PermKey, string> = {
    registryCreate: '', create: '', update: '', submit: '', read: '', approve: '', activate: '', enable: '', disable: '', navigation: '',
  };
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const keyPrefix = `FBET_${run}_`;
  let keySeq = 0;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};
  const evidence: Record<string, unknown> = {};
  const runItems: string[] = [];
  const runRoots: string[] = []; // FMI-CLEAN-01: root groups of this run, hidden in afterAll

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
  const send = (method: 'post' | 'put' | 'patch', url: string, body: unknown = {}, as = cookie) =>
    request(app)[method](url).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body));
  const getMenu = (as = cookie) => request(app).get('/api/foundation/navigation').set('User-Agent', fx.userAgent).set('Cookie', as);
  async function login(keys: readonly PermKey[] = PERM_KEYS, extra: readonly string[] = []): Promise<{ accountId: string; cookie: string }> {
    const acc = await fx.create();
    if (keys.length + extra.length > 0) await az.role(acc.accountId, [...keys.map((k) => perm[k]), ...extra]);
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    cookie = cookieOf(res);
    return { accountId: acc.accountId, cookie };
  }
  // A module whose version 1.0.0 (MIC without DIRECT_DB) is ACTIVE through the API; enabled on request.
  async function liveModule(enable = true): Promise<{ moduleId: string; moduleKey: string; versionId: string; orderId: string; reportId: string }> {
    const moduleKey = `${keyPrefix}${++keySeq}`;
    const m = await send('post', '/api/foundation/modules', { moduleKey, moduleName: `FBE-06 ${keySeq}`, moduleType: 'INTERNAL' });
    expect(m.status).toBe(201);
    const moduleId = String(m.body.module.moduleId);
    const v = await send('post', `/api/foundation/modules/${moduleId}/versions`, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    const versionId = String(v.body.version.versionId);
    const mic = validMic(moduleKey, '1.0.0');
    const manifest = { ...mic, mic06DataResources: mic.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB') };
    expect((await send('put', `/api/foundation/modules/${moduleId}/versions/${versionId}/manifest`, { manifest })).status).toBe(200);
    for (const action of ['submit', 'approve', 'activate']) expect((await send('post', `/api/foundation/modules/${moduleId}/versions/${versionId}/${action}`)).status, action).toBe(200);
    if (enable) expect((await send('post', `/api/foundation/modules/${moduleId}/enable`)).status).toBe(200);
    const fns = await h.ok(`SELECT function_key, function_id::text FROM foundation.fnd_functions WHERE module_id = ${lit(moduleId)}`);
    const id = (k: string) => fns.find((r) => r[0] === k)?.[1] ?? NIL;
    return { moduleId, moduleKey, versionId, orderId: id('ORDER'), reportId: id('REPORT') };
  }
  async function create(body: Record<string, unknown>, status = 201): Promise<Response> {
    const res = await send('post', '/api/foundation/navigation/items', body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    if (status === 201) runItems.push(String(res.body.item.navigationId));
    if (status === 201 && (body['parentId'] === undefined || body['parentId'] === null)) runRoots.push(String(res.body.item.navigationId));
    return res;
  }
  async function item(id: string) {
    const [r] = await h.ok(`SELECT coalesce(parent_id::text, '<null>'), coalesce(module_id::text, '<null>'), coalesce(function_id::text, '<null>'), menu_title, sort_order::text, is_visible::text, created_at::text
      FROM ${B09} WHERE navigation_id = ${lit(id)}`);
    return r;
  }
  async function auditsOf(requestId: string) {
    return (await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(module_id::text, '<null>'), coalesce(version_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)}`)).map((r) => ({
      action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], moduleId: r[4], versionId: r[5], metadata: JSON.parse(r[6] ?? 'null'),
    }));
  }
  const eventsOf = async (requestId: string) => Number((await h.ok(`SELECT count(*) FROM foundation.fnd_module_events WHERE correlation_id = ${lit(requestId)}`))[0]?.[0]);
  const b09Count = async () => Number((await h.ok(`SELECT count(*) FROM ${B09}`))[0]?.[0]);

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
    const db = faultyDb(prismaFoundationDb(prisma), () => fault);
    const foundation = createFoundationModule({
      prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST',
      repository: new SqlFoundationRepository(db), versionRepository: new SqlModuleVersionRepository(db), manifestRepository: new SqlManifestRepository(db, 'TEST'),
      lifecycleRepository: new SqlLifecycleRepository(db), navigationRepository: new SqlNavigationRepository(db),
    });
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
    // FMI-CLEAN-01: B09 has no DELETE (append-only, C2) — the root groups created by this run are HIDDEN at the end through
    // the API, so that the TEST Navigation Builder / sidebar is not filled with fixtures. The rows themselves stay (V6).
    if (h && fx && az && runRoots.length > 0) { // h / fx / az exist only when beforeAll (app included) completed
      try {
        const keeper = await login(['navigation']);
        let hidden = 0;
        for (const id of runRoots) if ((await send('patch', `/api/foundation/navigation/items/${id}`, { isVisible: false }, keeper.cookie)).status === 200) hidden += 1;
        evidence['runRootsHidden'] = { roots: runRoots.length, hidden };
      } finally {
        for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
        for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
      }
    }
    const remaining = fx ? await fx.remaining() : -1;
    if (h) {
      const ids = uuidArray(runItems.length ? runItems : [NIL]);
      const [still] = await h.ok(`SELECT count(*) FROM ${B09} WHERE navigation_id = ANY(${ids})`);
      evidence['b09RowsOfRunKept'] = { created: runItems.length, present: Number(still?.[0]) };
      const [iam] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions WHERE module_code = 'FOUNDATION'),
        (SELECT count(*) FROM iam.iam_role_permissions) + (SELECT count(*) FROM iam.iam_user_roles) + (SELECT count(*) FROM iam.iam_user_permissions)`);
      evidence['iamAfter'] = { foundationPermissions: Number(iam?.[0]), assignments: Number(iam?.[1]) };
    }
    console.log(`[fbe06] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe06] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

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

  it('FP6-1 / FP6-2: every NAVIGATION_SQL statement plans as talo_app; the B09 matrix is exact (section V); forbidden statements → 42501', async () => {
    const statements: [string, string, unknown[]][] = [
      ['functionOfModule', NAVIGATION_SQL.functionOfModule, [NIL, NIL]], ['getItem', NAVIGATION_SQL.getItem, [NIL]],
      ['insertItem', NAVIGATION_SQL.insertItem, [null, null, null, 'plan', null, null]], ['updateItem', NAVIGATION_SQL.updateItem, [NIL, 'plan', null, null]],
      ['listItems', NAVIGATION_SQL.listItems, []], ['activeVersions', NAVIGATION_SQL.activeVersions, []], ['activeFunctions', NAVIGATION_SQL.activeFunctions, []],
      ['permissionsByTriple', NAVIGATION_SQL.permissionsByTriple, ['X', 'Y', 'Z']],
      ['lockLayout', NAVIGATION_SQL.lockLayout, []], ['inventory', NAVIGATION_SQL.inventory, []],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual(Object.keys(NAVIGATION_SQL).sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(statements.map((s) => [s[0], 'OK'])));
    const forbidden: Record<string, string> = {
      'DELETE B09': `DELETE FROM ${B09}`,
      'UPDATE B09.parent_id': `UPDATE ${B09} SET parent_id = NULL`,
      'UPDATE B09.module_id': `UPDATE ${B09} SET module_id = module_id`,
      'UPDATE B09.function_id': `UPDATE ${B09} SET function_id = function_id`,
      'UPDATE B09.navigation_id': `UPDATE ${B09} SET navigation_id = navigation_id`,
      'UPDATE B09.created_at': `UPDATE ${B09} SET created_at = now()`,
      'INSERT B09.navigation_id': `INSERT INTO ${B09} (navigation_id, menu_title) VALUES ('${NIL}', 'x')`,
      'INSERT B09.created_at': `INSERT INTO ${B09} (menu_title, created_at) VALUES ('x', now())`,
      'INSERT iam_permissions': `INSERT INTO iam.iam_permissions (permission_code, module_code, resource_code, operation) VALUES ('x', 'X', 'X', 'READ')`,
      'INSERT iam_user_permissions': `INSERT INTO iam.iam_user_permissions (user_account_id, permission_id, effect) VALUES ('${NIL}', '${NIL}', 'ALLOW')`,
      'SELECT B07': `SELECT 1 FROM foundation.fnd_module_events`,
      'SELECT B08': `SELECT 1 FROM foundation.fnd_audit_logs`,
    };
    const refused: Record<string, string> = {};
    for (const [name, sql] of Object.entries(forbidden)) refused[name] = await plan(sql, []);
    expect(refused).toEqual(Object.fromEntries(Object.keys(forbidden).map((k) => [k, '42501'])));
    const [matrix] = await prisma.$queryRawUnsafe<{ sel: boolean; del: boolean; trunc: boolean; ref: boolean; trig: boolean; ins: string; upd: string }[]>(`
      SELECT has_table_privilege('${B09}', 'SELECT') AS sel, has_table_privilege('${B09}', 'DELETE') AS del, has_table_privilege('${B09}', 'TRUNCATE') AS trunc,
             has_table_privilege('${B09}', 'REFERENCES') AS ref, has_table_privilege('${B09}', 'TRIGGER') AS trig,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = '${B09}'::regclass AND attnum > 0 AND has_column_privilege('${B09}', attname, 'INSERT')) AS ins,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = '${B09}'::regclass AND attnum > 0 AND has_column_privilege('${B09}', attname, 'UPDATE')) AS upd`);
    expect(matrix).toEqual({
      sel: true, del: false, trunc: false, ref: false, trig: false, ins: 'parent_id,module_id,function_id,menu_title,sort_order,is_visible', upd: 'menu_title,sort_order,is_visible',
    });
    const [harness] = await h.ok(`SELECT has_table_privilege('${B09}', 'SELECT'), has_any_column_privilege('${B09}', 'INSERT'), has_any_column_privilege('${B09}', 'UPDATE'), has_table_privilege('${B09}', 'DELETE')`);
    expect(harness).toEqual(['t', 'f', 'f', 'f']);
    const [iam] = await h.ok(`SELECT string_agg(permission_code || ':' || module_code || ':' || resource_code || ':' || operation || ':' || minimum_assurance_level, ',') FROM iam.iam_permissions WHERE resource_code = 'NAVIGATION'`);
    expect(iam?.[0]).toBe('foundation.navigation.manage:FOUNDATION:NAVIGATION:MANAGE:1');
    evidence['fp6Matrix'] = matrix;
  });

  it('FP6-3: Prisma adapter — real composite FK (Function of another module), parent FK, N-02, width SQLSTATEs; all rolled back', async () => {
    await login();
    const a = await liveModule(false);
    const b = await liveModule(false);
    const sqlstate = async (fn: (tx: SqlExecutor) => Promise<unknown>) => {
      try {
        await prismaFoundationDb(prisma).transaction(async (tx) => fn(tx));
        return 'none';
      } catch (error) {
        return sqlstateOf(error) ?? 'unknown';
      }
    };
    const before = await b09Count();
    const states = {
      functionOtherModule: await sqlstate((tx) => tx.query(NAVIGATION_SQL.insertItem, [null, b.moduleId, a.orderId, 'x', null, null])),
      parentMissing: await sqlstate((tx) => tx.query(NAVIGATION_SQL.insertItem, [randomUUID(), null, null, 'x', null, null])),
      functionWithoutModule: await sqlstate((tx) => tx.query(NAVIGATION_SQL.insertItem, [null, null, a.orderId, 'x', null, null])),
      titleTooLong: await sqlstate((tx) => tx.query(NAVIGATION_SQL.insertItem, [null, null, null, 'x'.repeat(151), null, null])),
      selfParentByUpdate: await sqlstate((tx) => tx.execute(`UPDATE ${B09} SET parent_id = navigation_id`, [])),
    };
    expect(states).toEqual({ functionOtherModule: '23503', parentMissing: '23503', functionWithoutModule: '23514', titleTooLong: '22001', selfParentByUpdate: '42501' });
    expect(await b09Count()).toBe(before);
    evidence['fp6Adapter'] = states;
  });

  it('V1: POST group / module group / Function item → 201 + B08 SUCCESS (no B07); PATCH three fields → 200; invalid references → 422; parent / module / function immutable', async () => {
    const actor = await login();
    const m = await liveModule();
    const other = await liveModule(false);
    const root = await create({ menuTitle: `Gốc ${run}`, sortOrder: 5 });
    const rootId = String(root.body.item.navigationId);
    expect(root.body.item).toMatchObject({ parentId: null, moduleId: null, functionId: null, sortOrder: 5, isVisible: true });
    expect(await auditsOf(rid(root))).toEqual([{
      action: 'NAVIGATION.CREATE', outcome: 'SUCCESS', targetType: 'NAVIGATION_ITEM', targetId: rootId, moduleId: '<null>', versionId: '<null>',
      metadata: { v: 1, reason: 'CREATED', requestId: rid(root), fields: 'parentId,moduleId,functionId,menuTitle,sortOrder,isVisible' },
    }]);
    expect(await eventsOf(rid(root))).toBe(0);
    const group = String((await create({ parentId: rootId, moduleId: m.moduleId, menuTitle: 'Bán hàng' })).body.item.navigationId);
    const order = await create({ parentId: group, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'Đơn hàng' });
    const orderId = String(order.body.item.navigationId);
    expect(await item(orderId)).toEqual([group, m.moduleId, m.orderId, 'Đơn hàng', '0', 'true', expect.any(String)]);
    expect((await auditsOf(rid(order)))[0]).toMatchObject({ moduleId: m.moduleId, targetId: orderId });
    for (const [body, field] of [
      [{ parentId: group, moduleId: other.moduleId, menuTitle: 'x' }, 'parentId'], [{ moduleId: m.moduleId, functionId: other.orderId, menuTitle: 'x' }, 'functionId'],
      [{ functionId: m.orderId, menuTitle: 'x' }, 'moduleId'], [{ parentId: NIL, menuTitle: 'x' }, 'parentId'],
    ] as const) {
      const res = await create(body, 422);
      expect(res.body.error.details.fields, field).toEqual([field]);
    }
    const before = await item(orderId);
    const p = await send('patch', `/api/foundation/navigation/items/${orderId}`, { menuTitle: 'Đơn bán', sortOrder: 3 });
    expect(p.status).toBe(200);
    expect(await item(orderId)).toEqual([group, m.moduleId, m.orderId, 'Đơn bán', '3', 'true', before?.[6]]);
    expect((await auditsOf(rid(p)))[0]).toMatchObject({ action: 'NAVIGATION.UPDATE', outcome: 'SUCCESS', metadata: { fields: 'menuTitle,sortOrder' } });
    for (const body of [{ parentId: rootId }, { moduleId: other.moduleId }, { functionId: m.reportId }, { createdAt: 'x' }]) {
      expect((await send('patch', `/api/foundation/navigation/items/${orderId}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await item(orderId)).toEqual([group, m.moduleId, m.orderId, 'Đơn bán', '3', 'true', before?.[6]]);
    evidence['v1'] = { actor: actor.accountId, rootId, group, orderId };
  });

  it('V2: without foundation.navigation.manage → 403 + B08 DENIED (before validation / lookup); Direct DENY beats role ALLOW', async () => {
    const full = await login();
    const target = String((await create({ menuTitle: `Khóa ${run}` })).body.item.navigationId);
    const weak = await login(['read']);
    for (const [method, url, body] of [
      ['post', '/api/foundation/navigation/items', { menuTitle: 'x' }], ['post', '/api/foundation/navigation/items', { junk: 1 }],
      ['patch', `/api/foundation/navigation/items/${target}`, { menuTitle: 'x' }], ['patch', '/api/foundation/navigation/items/not-a-uuid', {}],
    ] as const) {
      const res = await send(method, url, body, weak.cookie);
      expect(res.status, url).toBe(403);
      expect(await auditsOf(rid(res)), url).toEqual([{
        action: method === 'post' ? 'NAVIGATION.CREATE' : 'NAVIGATION.UPDATE', outcome: 'DENIED', targetType: 'NAVIGATION', targetId: '<null>', moduleId: '<null>', versionId: '<null>',
        metadata: { v: 1, reason: 'NO_VALID_ALLOW', requestId: rid(res) },
      }]);
    }
    await az.direct(full.accountId, perm.navigation, 'DENY');
    const denied = await send('patch', `/api/foundation/navigation/items/${target}`, { menuTitle: 'x' }, full.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied)))[0]?.metadata).toMatchObject({ reason: 'DIRECT_DENY' });
    expect((await item(target))?.[3]).toBe(`Khóa ${run}`);
  });

  it('V3: rollback — B08 failure on CREATE / PATCH and a B09 width error → 503, no row / no change, no SUCCESS audit; the same request then succeeds', async () => {
    await login();
    const id = String((await create({ menuTitle: `Rb ${run}` })).body.item.navigationId);
    for (const f of ['B08_CREATE', 'B09_WIDTH'] as const) {
      const before = await b09Count();
      fault = f;
      const res = await send('post', '/api/foundation/navigation/items', { menuTitle: `Rb2 ${run}` });
      fault = 'NONE';
      expect(res.status, f).toBe(503);
      expect(await b09Count(), f).toBe(before);
      expect(await auditsOf(rid(res)), f).toEqual([]);
      expect(logs.some((l) => l.includes('create navigation item failed (rolled back)')), f).toBe(true);
    }
    const before = await item(id);
    fault = 'B08_UPDATE';
    const res = await send('patch', `/api/foundation/navigation/items/${id}`, { menuTitle: 'changed', isVisible: false });
    fault = 'NONE';
    expect(res.status).toBe(503);
    expect(await item(id)).toEqual(before);
    expect(await auditsOf(rid(res))).toEqual([]);
    expect((await send('patch', `/api/foundation/navigation/items/${id}`, { menuTitle: 'changed' })).status).toBe(200);
  });

  it('V4: concurrency — 10 concurrent CREATEs under one parent and 10 concurrent PATCHes of one item keep a consistent tree (no lost parent, last write wins per column)', async () => {
    await login();
    const parent = String((await create({ menuTitle: `Song song ${run}` })).body.item.navigationId);
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) => send('post', '/api/foundation/navigation/items', { parentId: parent, menuTitle: `C${i}`, sortOrder: i })));
    expect(created.map((r) => r.status)).toEqual(Array(10).fill(201));
    for (const r of created) runItems.push(String(r.body.item.navigationId));
    const [kids] = await h.ok(`SELECT count(*), count(DISTINCT navigation_id), bool_and(parent_id = ${lit(parent)}) FROM ${B09} WHERE parent_id = ${lit(parent)}`);
    expect(kids).toEqual(['10', '10', 't']);
    const patches = await Promise.all(Array.from({ length: 10 }, (_, i) => send('patch', `/api/foundation/navigation/items/${parent}`, { sortOrder: i })));
    expect(patches.map((r) => r.status)).toEqual(Array(10).fill(200));
    const [after] = await h.ok(`SELECT parent_id IS NULL, sort_order FROM ${B09} WHERE navigation_id = ${lit(parent)}`);
    expect(after?.[0]).toBe('t');
    expect(Number(after?.[1])).toBeGreaterThanOrEqual(0);
    const [audit] = await h.ok(`SELECT count(*) FROM foundation.fnd_audit_logs WHERE target_id = ${lit(parent)} AND action_code = 'NAVIGATION.UPDATE' AND outcome = 'SUCCESS'`);
    expect(audit?.[0]).toBe('10');
  });

  it('V5: GET menu on PostgreSQL — authenticated only, no permission needed, reads only; Functions without a K05 permission definition are hidden (fail closed); disabled / non-ACTIVE modules hidden', async () => {
    await login();
    const m = await liveModule();
    const disabled = await liveModule(false);
    const root = String((await create({ menuTitle: `Menu ${run}` })).body.item.navigationId);
    await create({ parentId: root, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'Đơn hàng' });
    await create({ parentId: root, moduleId: disabled.moduleId, functionId: disabled.orderId, menuTitle: 'Đơn hàng (tắt)' });
    const viewer = await login([]); // no permission at all
    const auditBefore = Number((await h.ok('SELECT count(*) FROM foundation.fnd_audit_logs'))[0]?.[0]);
    const res = await getMenu(viewer.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.navigation)).toBe(true);
    const json = JSON.stringify(res.body);
    for (const leak of [root, m.orderId, disabled.orderId, '/sales/orders', 'Đơn hàng']) expect(json).not.toContain(leak);
    expect(Number((await h.ok('SELECT count(*) FROM foundation.fnd_audit_logs'))[0]?.[0])).toBe(auditBefore);
    const [defs] = await h.ok(`SELECT count(*) FROM iam.iam_permissions WHERE module_code = ${lit(m.moduleKey)}`);
    expect(defs?.[0]).toBe('0'); // no K05 definition → the evaluator refuses (PERMISSION_NOT_DEFINED)
    expect((await request(app).get('/api/foundation/navigation').set('User-Agent', fx.userAgent)).status).toBe(401);
    evidence['v5'] = { status: res.status, rootsReturned: res.body.navigation.length };
  });

  // Every node of the tree, depth first.
  type MenuJson = { navigationId: string; functionId: string | null; routePath: string | null; screenKey: string | null; children: MenuJson[] };
  const flatten = (nodes: MenuJson[]): MenuJson[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

  it('V7: NAV-NO-PERMISSION / NAV-ALLOW / NAV-DENY / NAV-RESTORE on PostgreSQL — the real evaluator over a K05 permission of a fixture module', async () => {
    const iamBefore = await h.ok(`SELECT count(*) FROM iam.iam_permissions`);
    await login();
    const m = await liveModule();
    const root = String((await create({ menuTitle: `Nghiệp vụ ${run}` })).body.item.navigationId);
    const group = String((await create({ parentId: root, moduleId: m.moduleId, menuTitle: `Module ${m.moduleKey}` })).body.item.navigationId);
    const orderItem = String((await create({ parentId: group, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'Đơn hàng' })).body.item.navigationId);
    const reportItem = String((await create({ parentId: group, moduleId: m.moduleId, functionId: m.reportId, menuTitle: 'Báo cáo' })).body.item.navigationId);
    const orderRead = await az.definePermission(m.moduleKey, 'ORDER', 'READ');
    const reportRead = await az.definePermission(m.moduleKey, 'REPORT', 'READ');
    const [def] = await h.ok(`SELECT permission_code, module_code, resource_code, operation, minimum_assurance_level FROM iam.iam_permissions WHERE permission_id = ${lit(orderRead)}`);
    expect(def?.slice(1)).toEqual([m.moduleKey, 'ORDER', 'READ', '1']);
    const shown = async (as: string) => {
      const res = await getMenu(as);
      expect(res.status).toBe(200);
      return flatten(res.body.navigation);
    };

    // NAV-NO-PERMISSION: a definition exists but the viewer holds no grant → nothing of the module, no route leaks.
    const none = await login([]);
    const n0 = await shown(none.cookie);
    expect(n0.some((n) => n.navigationId === orderItem || n.navigationId === group || n.navigationId === root)).toBe(false);
    expect(JSON.stringify(n0)).not.toContain(m.orderId);

    // NAV-ALLOW: role ALLOW on (moduleKey, ORDER, READ) → ORDER with the MIC-04 route of the ACTIVE version; REPORT
    // (granted too) stays hidden because MIC-04 gives it no route.
    const viewer = await login([], [orderRead, reportRead]);
    const n1 = await shown(viewer.cookie);
    const order = n1.find((n) => n.navigationId === orderItem);
    expect(order).toMatchObject({ functionId: m.orderId, routePath: '/sales/orders', screenKey: 'sales.orders', children: [] });
    expect(n1.find((n) => n.navigationId === group)?.children.map((c) => c.navigationId)).toEqual([orderItem]);
    expect(n1.some((n) => n.navigationId === reportItem)).toBe(false);

    // NAV-DENY: same account, + DIRECT DENY on the same permission → the Function (and its now empty groups) disappear.
    const deny = await az.direct(viewer.accountId, orderRead, 'DENY');
    const n2 = await shown(viewer.cookie);
    expect(n2.some((n) => n.navigationId === orderItem || n.navigationId === group || n.navigationId === root)).toBe(false);

    // NAV-RESTORE: the DENY fixture removed by UUID (ownership proven), role ALLOW still valid → visible again.
    await az.revokeDirect(deny);
    const n3 = await shown(viewer.cookie);
    expect(n3.find((n) => n.navigationId === orderItem)?.routePath).toBe('/sales/orders');

    // Lifecycle is read live: DISABLE hides it for the allowed viewer, ENABLE shows it again.
    await login();
    expect((await send('post', `/api/foundation/modules/${m.moduleId}/disable`)).status).toBe(200);
    expect((await shown(viewer.cookie)).some((n) => n.navigationId === orderItem)).toBe(false);
    expect((await send('post', `/api/foundation/modules/${m.moduleId}/enable`)).status).toBe(200);
    expect((await shown(viewer.cookie)).some((n) => n.navigationId === orderItem)).toBe(true);
    evidence['v7'] = { permissionCode: def?.[0], iamBefore: Number(iamBefore[0]?.[0]), noPermission: false, allow: true, deny: false, restore: true };
  });

  // ------------------------------------------------------------------------------------------- Navigation Builder (22/10/2026)
  // No Builder save is committed here: the stored layout of talo_mos_v4_test (including whether a DEVELOP area exists) is the
  // owner's configuration. Reads, preview, 403 / 409 / 422 write nothing; the apply path runs fully and is rolled back.
  type LayoutJson = {
    revision: string; developAreaId: string | null;
    areas: { id: string; title: string; visible: boolean; develop: boolean; menus: { id: string; title: string; visible: boolean; items: { id: string; functionId: string; title: string; visible: boolean }[] }[] }[];
    legacy: { id: string; visible: boolean; reason: string; inDevelop: boolean }[];
  };
  type DraftJson = {
    revision: string;
    areas: { id: string | null; title: string; visible: boolean; develop: boolean; menus: { id: string | null; title: string; visible: boolean; items: { id: string | null; functionId: string; title: string; visible: boolean }[] }[] }[];
    legacy: { id: string; visible: boolean }[];
  };
  const getAs = (url: string, as = cookie) => request(app).get(url).set('User-Agent', fx.userAgent).set('Cookie', as);
  async function storedLayout(): Promise<LayoutJson> {
    const res = await getAs('/api/foundation/navigation/builder');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    return res.body.layout;
  }
  // The stored layout as an unchanged draft (+ a DEVELOP area when none is stored, as the Builder UI proposes).
  function draftOf(l: LayoutJson): DraftJson {
    const areas: DraftJson['areas'] = l.areas.map((a) => ({
      id: a.id, title: a.title, visible: a.visible, develop: a.develop,
      menus: a.menus.map((m) => ({ id: m.id, title: m.title, visible: m.visible, items: m.items.map((i) => ({ id: i.id, functionId: i.functionId, title: i.title, visible: i.visible })) })),
    }));
    if (l.developAreaId === null) areas.push({ id: null, title: 'Develop', visible: true, develop: true, menus: [] });
    return { revision: l.revision, areas, legacy: l.legacy.map((x) => ({ id: x.id, visible: x.visible })) };
  }
  const anchors = async () => Number((await h.ok(`SELECT count(*) FROM ${B09} WHERE sort_order = -2147483648`))[0]?.[0]);
  const b09Digest = async () => (await h.ok(`SELECT md5(coalesce(string_agg(navigation_id::text || coalesce(parent_id::text, '') || menu_title || sort_order::text || is_visible::text, '|' ORDER BY navigation_id), ''))
    FROM ${B09}`))[0]?.[0];

  it('NB-1: Builder read on PostgreSQL — every B09 row is classified exactly once; inventory = every non-retired Function; read only; 403 + B08 DENIED without the permission', async () => {
    await login();
    const before = await b09Digest();
    const l = await storedLayout();
    const counted = l.areas.length + l.areas.reduce((s, a) => s + a.menus.length + a.menus.reduce((t, m) => t + m.items.length, 0), 0) + l.legacy.length;
    expect(counted + (l.developAreaId === null ? 0 : await anchors())).toBe(await b09Count());
    expect((await storedLayout()).revision).toBe(l.revision);
    const inv = await getAs('/api/foundation/navigation/builder/functions');
    expect(inv.status).toBe(200);
    const functions: { moduleKey: string; functionKey: string; developer: boolean; assignable: boolean; reason: string | null }[] = inv.body.functions;
    const [notRetired] = await h.ok(`SELECT count(*) FROM foundation.fnd_functions WHERE retired_at IS NULL`);
    expect(functions.length).toBe(Number(notRetired?.[0]));
    const developer = functions.filter((f) => f.developer).map((f) => `${f.moduleKey}.${f.functionKey}`).sort();
    expect(developer.every((k) => ['SYSTEM_TEST.TEST_RUNNER', 'SYSTEM_TEST.DIAGNOSTICS', 'SYSTEM_TEST.DATA_VIEWER', 'DATA_INSPECTOR.CATALOG', 'DATA_INSPECTOR.ROWS'].includes(k))).toBe(true);
    expect(await b09Digest()).toBe(before);

    const none = await login([]);
    const denied = await getAs('/api/foundation/navigation/builder', none.cookie);
    expect(denied.status).toBe(403);
    expect((await auditsOf(rid(denied))).map((a) => [a.action, a.outcome])).toEqual([['NAVIGATION.BUILDER.READ', 'DENIED']]);
    const put = await send('put', '/api/foundation/navigation/builder', draftOf(l), none.cookie);
    expect(put.status).toBe(403);
    expect((await auditsOf(rid(put))).map((a) => [a.action, a.outcome])).toEqual([['NAVIGATION.LAYOUT.APPLY', 'DENIED']]);
    expect(await b09Digest()).toBe(before);
    evidence['nb1'] = {
      rows: await b09Count(), areas: l.areas.length, legacy: l.legacy.length, developStored: l.developAreaId !== null, functions: functions.length, developer,
      legacyReasons: Object.fromEntries(['FUNCTION_AT_ROOT', 'FUNCTION_UNDER_AREA', 'TOO_DEEP', 'UNREACHABLE'].map((r) => [r, l.legacy.filter((x) => x.reason === r).length])),
    };
  });

  it('NB-2: preview on PostgreSQL — the draft (new area / menu / two links of one Function) as THIS account would see it (real IAM + lifecycle); nothing written', async () => {
    await login();
    const m = await liveModule();
    const orderRead = await az.definePermission(m.moduleKey, 'ORDER', 'READ');
    await login(PERM_KEYS, [orderRead]);
    const before = await b09Digest();
    const d = draftOf(await storedLayout());
    d.areas.unshift({ id: null, title: `NB ${run}`, visible: true, develop: false, menus: [
      { id: null, title: 'Menu A', visible: true, items: [{ id: null, functionId: m.orderId, title: 'Đơn hàng A', visible: true }] },
      { id: null, title: 'Menu B', visible: true, items: [{ id: null, functionId: m.orderId, title: 'Đơn hàng B', visible: true }] },
    ] });
    const res = await send('post', '/api/foundation/navigation/builder/preview', d);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const nodes = flatten(res.body.navigation);
    const orders = nodes.filter((n) => n.functionId === m.orderId);
    expect(orders.map((n) => n.routePath)).toEqual(['/sales/orders', '/sales/orders']);
    expect(new Set(orders.map((n) => n.navigationId)).size).toBe(2); // two links, two identities
    expect(nodes.some((n) => n.functionId === m.reportId)).toBe(false); // no MIC-04 route
    expect(await b09Digest()).toBe(before);
    expect((await auditsOf(rid(res))).filter((a) => a.outcome === 'SUCCESS')).toEqual([]);
    evidence['nb2'] = { previewRoots: res.body.navigation.length, orderLinks: orders.length };
  });

  it('NB-3: apply on PostgreSQL — INSERT (area, Develop anchor, menu, links) + UPDATE (title, visibility) as talo_app all succeed, then a B08 failure rolls back everything (503)', async () => {
    await login();
    const m = await liveModule();
    const root = String((await create({ menuTitle: `NB vùng ${run}` })).body.item.navigationId);
    const menu = String((await create({ parentId: root, moduleId: m.moduleId, menuTitle: 'NB menu' })).body.item.navigationId);
    const link = String((await create({ parentId: menu, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'NB đơn hàng' })).body.item.navigationId);
    const l = await storedLayout();
    const d = draftOf(l);
    const area = d.areas.find((a) => a.id === root);
    const stored = area?.menus.find((x) => x.id === menu);
    if (!area || !stored) throw new Error('fixture area not in layout');
    area.title = `NB vùng ${run} (đổi)`;
    stored.items.push({ id: null, functionId: m.orderId, title: 'NB đơn hàng ẩn', visible: false }); // hidden duplicate: allowed
    const moved = stored.items.shift(); // MOVE the stored link to a new menu → re-link (INSERT + old row hidden)
    if (moved) area.menus.push({ id: null, title: 'NB menu mới', visible: true, items: [moved] });
    const rowsBefore = await b09Count();
    const before = await b09Digest();
    const anchorsBefore = await anchors();
    fault = 'B08_LAYOUT';
    const reached = layoutAuditReached;
    const res = await send('put', '/api/foundation/navigation/builder', d);
    fault = 'NONE';
    expect(res.status).toBe(503);
    expect(layoutAuditReached).toBe(reached + 1); // every INSERT / UPDATE ran on PostgreSQL before the failing B08 row
    expect(await b09Count()).toBe(rowsBefore);
    expect(await b09Digest()).toBe(before);
    expect(await anchors()).toBe(anchorsBefore);
    expect((await item(link))?.[5]).toBe('true');
    expect((await auditsOf(rid(res))).filter((a) => a.outcome === 'SUCCESS')).toEqual([]);
    expect((await storedLayout()).revision).toBe(l.revision);
    evidence['nb3'] = { status: res.status, rolledBack: true, developCreatedInDraft: l.developAreaId === null };
  });

  it('NB-4: 409 on a stale revision, 422 on a visible duplicate in one menu, 400 on the anchor sort order — nothing written', async () => {
    await login();
    const m = await liveModule();
    const root = String((await create({ menuTitle: `NB4 ${run}` })).body.item.navigationId);
    const menu = String((await create({ parentId: root, moduleId: m.moduleId, menuTitle: 'NB4 menu' })).body.item.navigationId);
    await create({ parentId: menu, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'NB4 đơn hàng' });
    const d = draftOf(await storedLayout());
    d.areas.find((a) => a.id === root)?.menus.find((x) => x.id === menu)?.items.push({ id: null, functionId: m.orderId, title: 'trùng', visible: true });
    const before = await b09Digest();
    const dup = await send('put', '/api/foundation/navigation/builder', d);
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('NAVIGATION_LAYOUT_INVALID');
    expect(dup.body.error.details.fields.some((x: string) => x.startsWith('FUNCTION_DUPLICATE_IN_MENU:'))).toBe(true);
    expect(await b09Digest()).toBe(before);
    await create({ parentId: root, menuTitle: 'NB4 thay đổi song song' });
    const after = await b09Digest();
    const stale = await send('put', '/api/foundation/navigation/builder', draftOf({ ...(await storedLayout()), revision: d.revision }));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NAVIGATION_CONFLICT');
    expect(await b09Digest()).toBe(after);
    expect((await send('post', '/api/foundation/navigation/items', { menuTitle: 'x', sortOrder: -2147483648 })).status).toBe(400);
    expect(await b09Digest()).toBe(after);
    evidence['nb4'] = { duplicate: dup.status, stale: stale.status };
  });

  it('NB-5: positive COMMIT on PostgreSQL — INSERT + UPDATE + B08 SUCCESS persisted (read back on a new connection); multi-link served by the menu; fixture area then hidden (no DELETE)', async () => {
    await login();
    const m = await liveModule();
    const orderRead = await az.definePermission(m.moduleKey, 'ORDER', 'READ');
    const admin = await login(PERM_KEYS, [orderRead]);
    const root = String((await create({ menuTitle: `NB5 vùng ${run}` })).body.item.navigationId);
    const menuA = String((await create({ parentId: root, moduleId: m.moduleId, menuTitle: 'NB5 menu A' })).body.item.navigationId);
    const linkA = String((await create({ parentId: menuA, moduleId: m.moduleId, functionId: m.orderId, menuTitle: 'NB5 đơn hàng A' })).body.item.navigationId);
    const l = await storedLayout();
    // The stored layout unchanged (no DEVELOP added: the fixture save must not create the DEVELOP area of the database).
    const d: DraftJson = {
      revision: l.revision,
      areas: l.areas.map((a) => ({ id: a.id, title: a.title, visible: a.visible, develop: a.develop, menus: a.menus.map((x) => ({ id: x.id, title: x.title, visible: x.visible, items: x.items.map((i) => ({ id: i.id, functionId: i.functionId, title: i.title, visible: i.visible })) })) })),
      legacy: l.legacy.map((x) => ({ id: x.id, visible: x.visible })),
    };
    const area = d.areas.find((a) => a.id === root);
    if (!area) throw new Error('fixture area not in layout');
    area.title = `NB5 vùng ${run} (đã lưu)`; // UPDATE
    area.menus[0]?.items.push({ id: null, functionId: m.orderId, title: 'NB5 ẩn', visible: false }); // INSERT hidden duplicate
    area.menus.push({ id: null, title: 'NB5 menu B', visible: true, items: [{ id: null, functionId: m.orderId, title: 'NB5 đơn hàng B', visible: true }] }); // INSERT menu + 2nd link
    const rowsBefore = await b09Count();
    const res = await send('put', '/api/foundation/navigation/builder', d);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.layout.revision).not.toBe(l.revision);
    expect(res.body.layout.developAreaId).toBe(l.developAreaId);

    // Read back on a NEW connection (committed, not only visible inside the API transaction).
    const fresh = await AuthFixtures.connect();
    try {
      const rows = await fresh.ok(`SELECT n.navigation_id::text, coalesce(n.parent_id::text, ''), coalesce(n.module_id::text, ''), coalesce(n.function_id::text, ''), n.menu_title, n.sort_order::text, n.is_visible::text
        FROM ${B09} n WHERE n.navigation_id = ${lit(root)} OR n.parent_id = ${lit(root)} OR n.parent_id IN (SELECT navigation_id FROM ${B09} WHERE parent_id = ${lit(root)}) ORDER BY n.created_at, n.navigation_id`);
      expect(rows.length).toBe(6);
      expect(rows.find((r) => r[0] === root)?.[4]).toBe(`NB5 vùng ${run} (đã lưu)`);
      const menuB = rows.find((r) => r[4] === 'NB5 menu B');
      expect(menuB?.slice(1, 4)).toEqual([root, '', '']); // new menu of a Foundation-wide area: module NULL
      expect(rows.filter((r) => r[3] === m.orderId && r[6] === 'true').map((r) => r[1]).sort()).toEqual([menuA, menuB?.[0]].sort());
      expect(rows.find((r) => r[4] === 'NB5 ẩn')?.slice(1, 7)).toEqual([menuA, m.moduleId, m.orderId, 'NB5 ẩn', '1', 'false']);
      evidence['nb5Fresh'] = { rows: rows.length, b09Before: rowsBefore, b09After: Number((await fresh.ok(`SELECT count(*) FROM ${B09}`))[0]?.[0]) };
    } finally {
      await fresh.close();
    }
    expect(await b09Count()).toBe(rowsBefore + 3);
    const audit = await auditsOf(rid(res));
    expect(audit.map((a) => [a.action, a.outcome, a.targetType])).toEqual([['NAVIGATION.LAYOUT.APPLY', 'SUCCESS', 'NAVIGATION_LAYOUT']]);
    expect(audit[0]?.metadata).toMatchObject({ revisionBefore: l.revision, inserted: 3, updated: 1, relinked: 0 });
    expect(await eventsOf(rid(res))).toBe(0);

    // Multi-link on the real evaluator: the same Function from two menus, one route, two identities.
    const menu = await getMenu(admin.cookie);
    const orders = flatten(menu.body.navigation).filter((n) => n.functionId === m.orderId);
    expect(orders.map((n) => n.routePath)).toEqual(['/sales/orders', '/sales/orders']);
    expect(orders.map((n) => n.navigationId)).toContain(linkA);

    // Fixture cleanup: the fixture area is hidden through the Builder (UPDATE only; B09 has no DELETE, B08 stays).
    const after = await storedLayout();
    const hide: DraftJson = {
      revision: after.revision,
      areas: after.areas.map((a) => ({ id: a.id, title: a.title, visible: a.id === root ? false : a.visible, develop: a.develop, menus: a.menus.map((x) => ({ id: x.id, title: x.title, visible: x.visible, items: x.items.map((i) => ({ id: i.id, functionId: i.functionId, title: i.title, visible: i.visible })) })) })),
      legacy: after.legacy.map((x) => ({ id: x.id, visible: x.visible })),
    };
    const cleaned = await send('put', '/api/foundation/navigation/builder', hide);
    expect(cleaned.status).toBe(200);
    expect((await item(root))?.[5]).toBe('false');
    expect(flatten((await getMenu(admin.cookie)).body.navigation).some((n) => n.functionId === m.orderId)).toBe(false);
    expect((await auditsOf(rid(cleaned))).map((a) => [a.action, a.outcome])).toEqual([['NAVIGATION.LAYOUT.APPLY', 'SUCCESS']]);
    for (const r of await h.ok(`SELECT navigation_id::text FROM ${B09} WHERE parent_id = ${lit(root)} OR parent_id IN (SELECT navigation_id FROM ${B09} WHERE parent_id = ${lit(root)})`)) if (!runItems.includes(r[0] ?? NIL)) runItems.push(r[0] ?? NIL);
    evidence['nb5'] = { apply: res.status, audit: audit[0]?.metadata, cleanup: cleaned.status, developUnchanged: true };
  });

  // FE-01: the TEST administrator (role TALO_SYSTEM_ADMIN) is a legitimate assignment; only fixture assignments must be gone.
  it('V8: IAM fixtures are gone after cleanup — Foundation permission definitions back to the baseline 13, no fixture assignment, no fixture of the run', async () => {
    // MOD-TEST-01 / TALO-IAM-NEXT: the approved SYSTEM_TEST (and, once bootstrapped, IAM admin) permissions are legitimate definitions, not fixtures.
    const [iam] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_permissions WHERE module_code = 'FOUNDATION'), (SELECT count(*) FROM iam.iam_permissions WHERE module_code NOT IN ('FOUNDATION', 'SYSTEM_TEST', 'IAM')),
      (SELECT count(*) FROM iam.iam_role_permissions rp JOIN iam.iam_roles r ON r.role_id = rp.role_id WHERE r.role_code LIKE 'FBET-%')
      + (SELECT count(*) FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON r.role_id = ur.role_id WHERE r.role_code LIKE 'FBET-%')
      + (SELECT count(*) FROM iam.iam_user_permissions up JOIN iam.iam_user_accounts a ON a.user_account_id = up.user_account_id WHERE a.username ILIKE 'AUTHT-%'),
      (SELECT count(*) FROM iam.iam_permissions WHERE permission_code LIKE ${lit(`fbet-${run.toLowerCase()}.%`)})`);
    expect(iam).toEqual(['13', '0', '0', '0']);
    evidence['v8'] = iam;
  });

  it('V6: C2 — no B09 row of this run disappeared; no B09 row with a Function of another module; no parent cycle', async () => {
    const ids = uuidArray(runItems.length ? runItems : [NIL]);
    const [present] = await h.ok(`SELECT count(*) FROM ${B09} WHERE navigation_id = ANY(${ids})`);
    expect(Number(present?.[0])).toBe(runItems.length);
    const [bad] = await h.ok(`SELECT
        (SELECT count(*) FROM ${B09} n JOIN foundation.fnd_functions f ON f.function_id = n.function_id WHERE f.module_id <> n.module_id)
      + (SELECT count(*) FROM ${B09} n WHERE n.parent_id = n.navigation_id)
      + (WITH RECURSIVE up(start, cur, depth) AS (SELECT navigation_id, parent_id, 1 FROM ${B09} WHERE parent_id IS NOT NULL
           UNION ALL SELECT up.start, n.parent_id, up.depth + 1 FROM up JOIN ${B09} n ON n.navigation_id = up.cur WHERE n.parent_id IS NOT NULL AND up.depth < 1000)
         SELECT count(*) FROM up WHERE cur = start)`);
    expect(Number(bad?.[0])).toBe(0);
  });
});
