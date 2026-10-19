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

type Fault = 'NONE' | 'B08_CREATE' | 'B08_UPDATE' | 'B09_WIDTH';

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
