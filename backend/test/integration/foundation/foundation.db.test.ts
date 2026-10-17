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
import { FOUNDATION_SQL, SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import type { AuthFixtureAccount, AuthFixtureOptions } from '../../support/authFixtures.js';
import { lit, uuidArray } from '../sc5/harness.js';
import type { PsqlSession } from '../sc5/harness.js';

// FBE-01B-VERIFY — Foundation Module Registry on PostgreSQL (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1.
// API under test: the real Express app with the real auth module and Foundation module, as talo_app (DATABASE_URL),
// Prisma pg adapter, real interactive transactions. Fixtures: talo_test_harness — AUTHT- accounts (AuthFixtures) and
// FBET- IAM authorisation rows (roles / role_permissions / user_roles / user_permissions) removed by proven UUID.
// Foundation rows (B01/B07/B08) are append-only (owner decision C2): never updated or deleted; keys FBET_<RUN>_<n>.
// Faults are injected by a test-only FoundationDb wrapper (existing `repository` seam) that changes ONE bind value so
// that PostgreSQL itself rejects the statement (real FK / CHECK) inside the real transaction. No source, data or
// constraint is modified.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const READ = 'foundation.module_registry.read';
const CREATE = 'foundation.module_registry.create';

type Fault = 'NONE' | 'B07' | 'B08' | 'DENIED_AUDIT';

// Test seam: rewrites one bind value so that PostgreSQL raises a real constraint error.
//   B07          insertModuleEvent.module_id  → random UUID   → 23503 fk_fnd_module_events_module_id
//   B08          insertAudit.outcome SUCCESS  → 'BOGUS'       → 23514 ck_fnd_audit_logs_outcome
//   DENIED_AUDIT insertAudit.outcome DENIED   → 'BOGUS'       → 23514 ck_fnd_audit_logs_outcome
function faultyDb(db: FoundationDb, fault: () => Fault): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    if (f === 'B07' && sql === FOUNDATION_SQL.insertModuleEvent) return [randomUUID(), ...params.slice(1)];
    if (sql === FOUNDATION_SQL.insertAudit && ((f === 'B08' && params[6] === 'SUCCESS') || (f === 'DENIED_AUDIT' && params[6] === 'DENIED'))) {
      return [...params.slice(0, 6), 'BOGUS', ...params.slice(7)];
    }
    return params;
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    query: (sql, params) => x.query(sql, rewrite(sql, params)),
    execute: (sql, params) => x.execute(sql, rewrite(sql, params)),
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))) };
}

interface GrantOptions {
  readonly roleActive?: boolean;
  readonly revoked?: boolean;
  readonly notStarted?: boolean;
  readonly expired?: boolean;
}

// FBET- IAM authorisation fixtures (talo_test_harness). Every row id is generated here and recorded; cleanup deletes
// only those ids, only for this run's role codes / AuthFixtures accounts, in FK order, then proves nothing remains.
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

  async permissionId(code: string): Promise<string> {
    const [row] = await this.h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(code)}
      AND module_code = 'FOUNDATION' AND resource_code = 'MODULE_REGISTRY' AND minimum_assurance_level = 1`);
    if (!row?.[0] || !UUID.test(row[0])) throw new Error(`permission ${code} not registered (FBE-01B-DB 06)`);
    return row[0];
  }

  private assigned(o: GrantOptions): string {
    if (o.notStarted) return `statement_timestamp() + interval '1 hour'`;
    if (o.expired) return `statement_timestamp() - interval '2 hours'`;
    return 'statement_timestamp()';
  }

  async role(accountId: string, permissionIds: readonly string[], o: GrantOptions = {}): Promise<void> {
    this.seq += 1;
    const roleId = randomUUID();
    const userRoleId = randomUUID();
    this.roles.push(roleId);
    this.userRoles.push(userRoleId);
    await this.h.ok('BEGIN');
    try {
      await this.h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system)
        VALUES (${lit(roleId)}, ${lit(`${this.runTag}-R${this.seq}`)}, ${lit(`FBET role ${this.seq}`)}, ${o.roleActive === false ? 'false' : 'true'}, false)`);
      for (const p of permissionIds) {
        await this.h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(p)})`);
      }
      await this.h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id, assigned_at, revoked_at)
        VALUES (${lit(userRoleId)}, ${lit(accountId)}, ${lit(roleId)}, ${this.assigned(o)}, ${o.revoked ? 'statement_timestamp()' : 'NULL'})`);
      await this.h.ok('COMMIT');
    } catch (error) {
      await this.h.query('ROLLBACK');
      throw error;
    }
  }

  async direct(accountId: string, permissionId: string, effect: 'ALLOW' | 'DENY', o: GrantOptions = {}): Promise<void> {
    const id = randomUUID();
    this.userPermissions.push(id);
    await this.h.ok(`INSERT INTO iam.iam_user_permissions (user_permission_id, user_account_id, permission_id, effect, reason, assigned_at, expires_at, revoked_at)
      VALUES (${lit(id)}, ${lit(accountId)}, ${lit(permissionId)}, ${lit(effect)}, ${lit(`${this.runTag} fixture`)}, ${this.assigned(o)},
              ${o.expired ? `statement_timestamp() - interval '1 hour'` : 'NULL'}, ${o.revoked ? 'statement_timestamp()' : 'NULL'})`);
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

describe.skipIf(!enabled)('Foundation Module Registry — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let permRead = '';
  let permCreate = '';
  let fault: Fault = 'NONE';
  let keySeq = 0;
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const keyPrefix = `FBET_${run}_`;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const deletedTotals: Record<string, number> = {};

  const nextKey = () => `${keyPrefix}${++keySeq}`;
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
  const login = async (acc: AuthFixtureAccount): Promise<{ cookie: string; status: string }> => {
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    return { cookie: cookieOf(res), status: String(res.body.status) };
  };
  const account = async (options?: AuthFixtureOptions) => {
    const acc = await fx.create(options);
    return { acc, ...(await login(acc)) };
  };
  const get = (cookie?: string) => {
    const r = request(app).get('/api/foundation/modules').set('User-Agent', fx.userAgent);
    return cookie ? r.set('Cookie', cookie) : r;
  };
  const post = (body: unknown, cookie?: string) => {
    const r = request(app).post('/api/foundation/modules').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', fx.userAgent);
    return (cookie ? r.set('Cookie', cookie) : r).send(JSON.stringify(body));
  };

  // Rows of one request, by correlation id (= X-Request-Id) — never by whole-table counts.
  async function auditsOf(requestId: string) {
    const rows = await h.ok(`SELECT event_id::text, coalesce(module_id::text, '<null>'), coalesce(version_id::text, '<null>'), coalesce(actor_account_id::text, '<null>'),
        coalesce(session_id::text, '<null>'), action_code, target_type, coalesce(target_id, '<null>'), outcome, (occurred_at IS NOT NULL),
        source_service, metadata->>'reason', metadata->>'requestId'
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)} ORDER BY recorded_at`);
    return rows.map((r) => ({
      eventId: r[0] ?? '', moduleId: r[1] ?? '', versionId: r[2] ?? '', actor: r[3] ?? '', sessionId: r[4] ?? '', action: r[5] ?? '',
      targetType: r[6] ?? '', targetId: r[7] ?? '', outcome: r[8] ?? '', occurred: r[9] === 't', source: r[10] ?? '', reason: r[11] ?? '', metaRequestId: r[12] ?? '',
    }));
  }
  async function eventsOf(requestId: string) {
    const rows = await h.ok(`SELECT module_id::text, coalesce(version_id::text, '<null>'), event_type, coalesce(actor_account_id::text, '<null>'),
        (before_state IS NULL), after_state->>'module_key', after_state->>'is_enabled'
      FROM foundation.fnd_module_events WHERE correlation_id = ${lit(requestId)}`);
    return rows.map((r) => ({ moduleId: r[0] ?? '', versionId: r[1] ?? '', type: r[2] ?? '', actor: r[3] ?? '', beforeNull: r[4] === 't', key: r[5] ?? '', enabled: r[6] ?? '' }));
  }
  async function modulesByKey(key: string) {
    const rows = await h.ok(`SELECT module_id::text, module_name, coalesce(description, '<null>'), module_type, is_enabled, coalesce(created_by_account_id::text, '<null>'),
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM foundation.fnd_modules WHERE module_key = ${lit(key)}`);
    return rows.map((r) => ({ moduleId: r[0] ?? '', name: r[1] ?? '', description: r[2] ?? '', type: r[3] ?? '', enabled: r[4] === 't', createdBy: r[5] ?? '', createdAt: r[6] ?? '' }));
  }
  const logHas = (text: string, sqlstate: string) => logs.some((l) => l.includes(text) && l.includes(`"sqlstate":"${sqlstate}"`));

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [identity] = await prisma.$queryRawUnsafe<{ db: string; usr: string }[]>('SELECT current_database() AS db, current_user AS usr');
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app') throw new Error('guard: API must run as talo_app on talo_mos_v4_test');
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({
      prisma, logger, production: false, hasher, breachedPasswords: new UnavailableBlocklist('not used by FBE-01B-VERIFY'),
      loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }),
    });
    const repository = new SqlFoundationRepository(faultyDb(prismaFoundationDb(prisma), () => fault));
    const foundation = createFoundationModule({ prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST', repository });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    az = new AuthzFixtures(h, `FBET-${run}`, () => fx.accounts);
    await fx.assertNoLeftovers();
    await az.assertNoLeftovers();
    permRead = await az.permissionId(READ);
    permCreate = await az.permissionId(CREATE);
  });

  afterEach(async () => {
    fault = 'NONE';
    for (const [k, v] of Object.entries(await az.cleanup())) deletedTotals[`authz.${k}`] = (deletedTotals[`authz.${k}`] ?? 0) + v;
    for (const [k, v] of Object.entries(await fx.cleanup())) deletedTotals[`auth.${k}`] = (deletedTotals[`auth.${k}`] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    const kept = h ? await h.ok(`SELECT m.module_key, m.module_id::text,
        (SELECT count(*) FROM foundation.fnd_module_events e WHERE e.module_id = m.module_id),
        (SELECT count(*) FROM foundation.fnd_audit_logs a WHERE a.module_id = m.module_id)
      FROM foundation.fnd_modules m WHERE left(m.module_key, ${keyPrefix.length}) = ${lit(keyPrefix)} ORDER BY m.module_key`) : [];
    console.log(`[foundation-db] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[foundation-db] kept B01 (C2): ${JSON.stringify(kept)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ privileges (FP-1, EXPLAIN only, READ ONLY)

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

  it('FP-1: the 7 FOUNDATION_SQL statements plan as talo_app; forbidden statements are refused (42501); no TRUNCATE', async () => {
    // Placeholder parameters (planned, never executed).
    const statements: [string, string, unknown[]][] = [
      ['permissionDefinitions', FOUNDATION_SQL.permissionDefinitions, [READ, 'FOUNDATION', 'MODULE_REGISTRY', 'READ']],
      ['accountFacts', FOUNDATION_SQL.accountFacts, [NIL]],
      ['grantFacts', FOUNDATION_SQL.grantFacts, [NIL, NIL]],
      ['listModules', FOUNDATION_SQL.listModules, []],
      ['insertModule', FOUNDATION_SQL.insertModule, ['FBET_PLAN', 'plan', null, 'INTERNAL', NIL]],
      ['insertModuleEvent', FOUNDATION_SQL.insertModuleEvent, [NIL, NIL, '{}', 'plan']],
      ['insertAudit', FOUNDATION_SQL.insertAudit, [NIL, null, NIL, 'MODULE_REGISTRY.READ', 'MODULE_REGISTRY', null, 'DENIED', 'plan', 'talo-mos-backend', '{}']],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual(Object.keys(FOUNDATION_SQL).sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(Object.keys(FOUNDATION_SQL).map((k) => [k, 'OK'])));
    const forbidden: Record<string, string> = {
      // FBE-05: talo_app may UPDATE (is_enabled, updated_at) only; every other B01 column stays forbidden.
      'UPDATE B01.module_name': `UPDATE foundation.fnd_modules SET module_name = module_name`,
      'DELETE B01': `DELETE FROM foundation.fnd_modules`,
      'INSERT B01.module_id': `INSERT INTO foundation.fnd_modules (module_id, module_key, module_name, module_type) VALUES ('${NIL}', 'X', 'x', 'INTERNAL')`,
      'SELECT B07': `SELECT 1 FROM foundation.fnd_module_events`,
      'UPDATE B07': `UPDATE foundation.fnd_module_events SET event_type = event_type`,
      'DELETE B07': `DELETE FROM foundation.fnd_module_events`,
      'SELECT B08': `SELECT 1 FROM foundation.fnd_audit_logs`,
      'UPDATE B08': `UPDATE foundation.fnd_audit_logs SET outcome = outcome`,
      'DELETE B08': `DELETE FROM foundation.fnd_audit_logs`,
      'DELETE B03': `DELETE FROM foundation.fnd_functions`,
      'SELECT B09': `SELECT 1 FROM foundation.fnd_navigation_items`,
      'INSERT iam_permissions': `INSERT INTO iam.iam_permissions (permission_code, module_code, resource_code, operation) VALUES ('x', 'X', 'X', 'READ')`,
      'UPDATE iam_roles': `UPDATE iam.iam_roles SET is_active = false`,
      'DELETE iam_user_roles': `DELETE FROM iam.iam_user_roles`,
      'INSERT iam_user_permissions': `INSERT INTO iam.iam_user_permissions (user_account_id, permission_id, effect) VALUES ('${NIL}', '${NIL}', 'ALLOW')`,
      'INSERT iam_role_permissions': `INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES ('${NIL}', '${NIL}')`,
    };
    const refused: Record<string, string> = {};
    for (const [name, sql] of Object.entries(forbidden)) refused[name] = await plan(sql, []);
    expect(refused).toEqual(Object.fromEntries(Object.keys(forbidden).map((k) => [k, '42501'])));
    const [trunc] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_class c
      WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace) AND c.relkind = 'r' AND has_table_privilege(c.oid, 'TRUNCATE')`);
    expect(trunc?.n).toBe(0);
  });

  // ------------------------------------------------------------------ G2 authentication & IAM

  it('G2-1 no session → 401 (GET/POST), no Foundation audit', async () => {
    const g = await get();
    expect(g.status).toBe(401);
    expect(g.body.error.code).toBe('SESSION_INVALID');
    const p = await post({ moduleKey: nextKey(), moduleName: 'x', moduleType: 'INTERNAL' });
    expect(p.status).toBe(401);
    expect(await auditsOf(rid(g))).toEqual([]);
    expect(await auditsOf(rid(p))).toEqual([]);
  });

  it('G2-2 activation session → 403 PASSWORD_CHANGE_REQUIRED, no Foundation audit', async () => {
    const { acc, cookie, status } = await account({ accountStatus: 'PROVISIONED' });
    expect(status).toBe('PASSWORD_CHANGE_REQUIRED');
    await az.role(acc.accountId, [permRead, permCreate]);
    const g = await get(cookie);
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const p = await post({ moduleKey: nextKey(), moduleName: 'x', moduleType: 'INTERNAL' }, cookie);
    expect(p.status).toBe(403);
    expect(p.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await auditsOf(rid(g))).toEqual([]);
    expect(await auditsOf(rid(p))).toEqual([]);
  });

  it('G2-3 no permission → 403 + exactly one B08 DENIED (READ), all columns as approved (B-5)', async () => {
    const { acc, cookie } = await account();
    const res = await get(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.modules).toBeUndefined();
    const audits = await auditsOf(rid(res));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      moduleId: '<null>', versionId: '<null>', actor: acc.accountId, sessionId: '<null>', action: 'MODULE_REGISTRY.READ',
      targetType: 'MODULE_REGISTRY', targetId: '<null>', outcome: 'DENIED', occurred: true, source: 'talo-mos-backend',
      reason: 'NO_VALID_ALLOW', metaRequestId: rid(res),
    });
    expect(audits[0]?.eventId).toMatch(UUID);
  });

  it('G2-4 POST with READ only → 403 + B08 DENIED (CREATE); body not validated; no B01', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead]);
    const key = nextKey();
    const res = await post({ moduleKey: key, moduleName: 'x', moduleType: 'INTERNAL' }, cookie);
    expect(res.status).toBe(403);
    const audits = await auditsOf(rid(res));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'MODULE_REGISTRY.CREATE', outcome: 'DENIED', targetType: 'MODULE_REGISTRY', targetId: '<null>', actor: acc.accountId });
    expect(await modulesByKey(key)).toEqual([]);
    const invalid = await post({ moduleKey: 'not valid' }, cookie);
    expect(invalid.status).toBe(403);
  });

  it('G2-5 Role ALLOW → 200; no audit row for a successful read', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead]);
    const res = await get(cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.modules)).toBe(true);
    expect(await auditsOf(rid(res))).toEqual([]);
  });

  it('G2-6 Direct ALLOW (no role) → 200', async () => {
    const { acc, cookie } = await account();
    await az.direct(acc.accountId, permRead, 'ALLOW');
    expect((await get(cookie)).status).toBe(200);
  });

  it('G2-7 Direct DENY overrides Role ALLOW (and Direct ALLOW of another account is irrelevant)', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead]);
    await az.direct(acc.accountId, permRead, 'DENY');
    const res = await get(cookie);
    expect(res.status).toBe(403);
    expect((await auditsOf(rid(res)))[0]).toMatchObject({ outcome: 'DENIED', reason: 'DIRECT_DENY' });
  });

  it('G2-8 revoked / not-started / inactive role, revoked / expired direct ALLOW → denied; expired DENY does not block', async () => {
    const cases: { name: string; grant: (accountId: string) => Promise<void> }[] = [
      { name: 'role assignment revoked', grant: (a) => az.role(a, [permRead], { revoked: true }) },
      { name: 'role assignment not started', grant: (a) => az.role(a, [permRead], { notStarted: true }) },
      { name: 'role inactive', grant: (a) => az.role(a, [permRead], { roleActive: false }) },
      { name: 'direct ALLOW revoked', grant: (a) => az.direct(a, permRead, 'ALLOW', { revoked: true }) },
      { name: 'direct ALLOW expired', grant: (a) => az.direct(a, permRead, 'ALLOW', { expired: true }) },
    ];
    for (const c of cases) {
      const { acc, cookie } = await account();
      await c.grant(acc.accountId);
      const res = await get(cookie);
      expect(res.status, c.name).toBe(403);
      expect((await auditsOf(rid(res)))[0], c.name).toMatchObject({ outcome: 'DENIED', reason: 'NO_VALID_ALLOW', actor: acc.accountId });
    }
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead]);
    await az.direct(acc.accountId, permRead, 'DENY', { expired: true });
    expect((await get(cookie)).status).toBe(200);
  });

  // ------------------------------------------------------------------ G3 / G4 registry, transaction, audit

  it('G3-1 / G4-1 valid POST → 201, disabled, actor from session; B01 + B07 REGISTER + B08 SUCCESS committed together; GET returns it', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead, permCreate]);
    const key = nextKey();
    const res = await post({ moduleKey: key, moduleName: 'Kiểm thử FBET', moduleType: 'EXTERNAL', description: "x'); DELETE FROM iam.iam_roles; --" }, cookie);
    expect(res.status).toBe(201);
    const m = res.body.module;
    expect(m).toMatchObject({ moduleKey: key, moduleName: 'Kiểm thử FBET', moduleType: 'EXTERNAL', isEnabled: false, createdByAccountId: acc.accountId });
    expect(m.moduleId).toMatch(UUID);
    const requestId = rid(res);

    const [row] = await modulesByKey(key);
    expect(row).toEqual({ moduleId: m.moduleId, name: 'Kiểm thử FBET', description: "x'); DELETE FROM iam.iam_roles; --", type: 'EXTERNAL', enabled: false, createdBy: acc.accountId, createdAt: m.createdAt });
    const events = await eventsOf(requestId);
    expect(events).toEqual([{ moduleId: m.moduleId, versionId: '<null>', type: 'REGISTER', actor: acc.accountId, beforeNull: true, key, enabled: 'false' }]);
    const audits = await auditsOf(requestId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      moduleId: m.moduleId, versionId: '<null>', actor: acc.accountId, sessionId: '<null>', action: 'MODULE_REGISTRY.CREATE',
      targetType: 'MODULE', targetId: m.moduleId, outcome: 'SUCCESS', occurred: true, source: 'talo-mos-backend', reason: 'REGISTERED',
    });
    const [roles] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`FBET-${run}-%`)}`);
    expect(Number(roles?.[0])).toBeGreaterThan(0); // the description travelled as a bind value, not SQL

    const list = await get(cookie);
    expect(list.status).toBe(200);
    const found = list.body.modules.filter((x: { moduleId: string }) => x.moduleId === m.moduleId);
    expect(found).toEqual([m]);
  });

  it('G3-2 duplicate module_key → 409 MODULE_KEY_EXISTS through Prisma (23505); nothing else written', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead, permCreate]);
    const key = nextKey();
    expect((await post({ moduleKey: key, moduleName: 'first', moduleType: 'INTERNAL' }, cookie)).status).toBe(201);
    const dup = await post({ moduleKey: key, moduleName: 'second', moduleType: 'INTERNAL' }, cookie);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('MODULE_KEY_EXISTS');
    const rows = await modulesByKey(key);
    expect(rows.map((r) => r.name)).toEqual(['first']);
    expect(await eventsOf(rid(dup))).toEqual([]);
    expect(await auditsOf(rid(dup))).toEqual([]);
  });

  it('G3-3 invalid input → 400 VALIDATION_ERROR; nothing written', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead, permCreate]);
    const key = nextKey();
    for (const body of [
      { moduleKey: key, moduleName: 'x', moduleType: 'PLUGIN' },
      { moduleKey: key.toLowerCase(), moduleName: 'x', moduleType: 'INTERNAL' },
      { moduleKey: key, moduleName: 'x', moduleType: 'INTERNAL', isEnabled: true },
      { moduleKey: key, moduleName: 'x', moduleType: 'INTERNAL', moduleId: randomUUID() },
    ]) {
      const res = await post(body, cookie);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await auditsOf(rid(res))).toEqual([]);
    }
    expect(await modulesByKey(key)).toEqual([]);
    expect(await modulesByKey(key.toLowerCase())).toEqual([]);
  });

  it('G4-2 B07 fails (real 23503) → 503 and B01 rolled back; no partial commit', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead, permCreate]);
    const key = nextKey();
    fault = 'B07';
    const res = await post({ moduleKey: key, moduleName: 'rollback B07', moduleType: 'INTERNAL' }, cookie);
    fault = 'NONE';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_BUSY');
    expect(await modulesByKey(key)).toEqual([]);
    expect(await eventsOf(rid(res))).toEqual([]);
    expect(await auditsOf(rid(res))).toEqual([]);
    expect(logHas('register module failed (rolled back)', '23503')).toBe(true);
    // The same request without the fault commits: the rollback did not leave the key reserved.
    expect((await post({ moduleKey: key, moduleName: 'after rollback', moduleType: 'INTERNAL' }, cookie)).status).toBe(201);
  });

  it('G4-3 B08 fails (real 23514) → 503 and B01 + B07 rolled back; no partial commit', async () => {
    const { acc, cookie } = await account();
    await az.role(acc.accountId, [permRead, permCreate]);
    const key = nextKey();
    fault = 'B08';
    const res = await post({ moduleKey: key, moduleName: 'rollback B08', moduleType: 'INTERNAL' }, cookie);
    fault = 'NONE';
    expect(res.status).toBe(503);
    expect(await modulesByKey(key)).toEqual([]);
    expect(await eventsOf(rid(res))).toEqual([]);
    expect(await auditsOf(rid(res))).toEqual([]);
    expect(logHas('register module failed (rolled back)', '23514')).toBe(true);
  });

  it('G4-4 DENIED-audit write fails (real 23514) → still denied, 503 SERVICE_BUSY, no data, no B08 row', async () => {
    const { cookie } = await account();
    fault = 'DENIED_AUDIT';
    const g = await get(cookie);
    const p = await post({ moduleKey: nextKey(), moduleName: 'x', moduleType: 'INTERNAL' }, cookie);
    fault = 'NONE';
    for (const res of [g, p]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_BUSY');
      expect(res.body.modules).toBeUndefined();
      expect(res.body.module).toBeUndefined();
      expect(await auditsOf(rid(res))).toEqual([]);
    }
    expect(logHas('DENIED audit write failed: request denied', '23514')).toBe(true);
  });
});
