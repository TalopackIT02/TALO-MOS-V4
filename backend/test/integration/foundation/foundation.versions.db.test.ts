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
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { SqlModuleVersionRepository, VERSION_LOCK_NAMESPACE, VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { validMic } from '../../unit/foundation/mic.fixture.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FBE-02C-VERIFY — Module Version (FBE-02A) and MIC manifest / SUBMIT (FBE-02B) on PostgreSQL 18.6 (talo_mos_v4_test).
// Runs only with TALO_FOUNDATION_DB=1. API under test: the real Express app, real auth module, real Foundation module,
// as talo_app (DATABASE_URL), Prisma pg adapter, real interactive transactions, real advisory and row locks.
// Fixtures (talo_test_harness): AUTHT- accounts (AuthFixtures) and FBET- IAM authorisation rows, removed by proven UUID.
// Foundation rows (B01/B02/B07/B08) are append-only (C2): never updated or deleted; module keys FBET_<RUN>_<n>.
// Faults: a test-only FoundationDb wrapper (existing repository seams) changes ONE bind value so that PostgreSQL itself
// rejects the statement inside the real transaction. No source, data, grant or constraint is modified.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const B02 = 'foundation.fnd_module_versions';
const PERMS = {
  registryRead: 'foundation.module_registry.read', registryCreate: 'foundation.module_registry.create',
  read: 'foundation.module_version.read', create: 'foundation.module_version.create',
  update: 'foundation.module_version.update', submit: 'foundation.module_version.submit',
} as const;
type PermKey = keyof typeof PERMS;
const PERM_KEYS: readonly PermKey[] = ['registryRead', 'registryCreate', 'read', 'create', 'update', 'submit'];

type Fault = 'NONE' | 'VERSION_AUDIT_SUCCESS' | 'VERSION_AUDIT_FAILURE' | 'SUBMIT_EVENT';

// insertVersionAudit: outcome is bind $8 (index 7). insertSubmitEvent: module_id is bind $1 (index 0).
//   VERSION_AUDIT_SUCCESS  B08 SUCCESS outcome → 'BOGUS'  → 23514 ck_fnd_audit_logs_outcome
//   VERSION_AUDIT_FAILURE  B08 FAILURE outcome → 'BOGUS'  → 23514 (MIC_INVALID audit fails → 503)
//   SUBMIT_EVENT           B07 module_id → random UUID    → 23503 fk_fnd_module_events_module_id
function faultyDb(db: FoundationDb, fault: () => Fault): FoundationDb {
  const rewrite = (sql: string, params: readonly unknown[]): readonly unknown[] => {
    const f = fault();
    if (sql === VERSION_SQL.insertVersionAudit && ((f === 'VERSION_AUDIT_SUCCESS' && params[7] === 'SUCCESS') || (f === 'VERSION_AUDIT_FAILURE' && params[7] === 'FAILURE'))) {
      return [...params.slice(0, 7), 'BOGUS', ...params.slice(8)];
    }
    if (f === 'SUBMIT_EVENT' && sql === MANIFEST_SQL.insertSubmitEvent) return [randomUUID(), ...params.slice(1)];
    return params;
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    query: (sql, params) => x.query(sql, rewrite(sql, params)),
    execute: (sql, params) => x.execute(sql, rewrite(sql, params)),
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))) };
}

// FBET- IAM authorisation fixtures (same ownership-proof cleanup as the FBE-01B suite).
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

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

describe.skipIf(!enabled)('FBE-02C Module Version + MIC — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let az: AuthzFixtures;
  let app: Express;
  let fault: Fault = 'NONE';
  const perm: Record<PermKey, string> = { registryRead: '', registryCreate: '', read: '', create: '', update: '', submit: '' };
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
  // A fixture account holding exactly the listed permissions through one FBET role, logged in for real.
  async function actor(keys: readonly PermKey[]): Promise<{ accountId: string; cookie: string }> {
    const acc = await fx.create();
    if (keys.length > 0) await az.role(acc.accountId, keys.map((k) => perm[k]));
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    return { accountId: acc.accountId, cookie: cookieOf(res) };
  }
  const send = (method: 'get' | 'post' | 'put', url: string, cookie: string | null, body?: unknown) => {
    let r = request(app)[method](url).set('User-Agent', fx.userAgent);
    if (method !== 'get') r = r.set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');
    if (cookie) r = r.set('Cookie', cookie);
    return method === 'get' ? r : r.send(JSON.stringify(body ?? {}));
  };
  const versionsUrl = (moduleId: string) => `/api/foundation/modules/${moduleId}/versions`;
  async function newModule(cookie: string): Promise<{ moduleId: string; moduleKey: string }> {
    const moduleKey = `${keyPrefix}${++keySeq}`;
    const res = await send('post', '/api/foundation/modules', cookie, { moduleKey, moduleName: `FBE-02C ${keySeq}`, moduleType: 'INTERNAL' });
    expect(res.status).toBe(201);
    return { moduleId: String(res.body.module.moduleId), moduleKey };
  }
  async function newVersion(cookie: string, moduleId: string, moduleVersion = '1.0.0'): Promise<string> {
    const res = await send('post', versionsUrl(moduleId), cookie, { moduleVersion, contractVersion: 'MIC-1.0' });
    expect(res.status).toBe(201);
    return String(res.body.version.versionId);
  }

  // Harness reads (talo_test_harness: SELECT on B01/B02/B07/B08).
  async function b02(versionId: string) {
    const [r] = await h.ok(`SELECT status, coalesce(manifest_json::text, '<sql-null>'), coalesce(jsonb_typeof(manifest_json), '<sql-null>'),
        coalesce(manifest_hash, '<null>'), coalesce(submitted_by_account_id::text, '<null>'), module_version, contract_version, module_id::text
      FROM ${B02} WHERE version_id = ${lit(versionId)}`);
    return r ? { status: r[0], manifest: r[1], jsonType: r[2], hash: r[3], submittedBy: r[4], moduleVersion: r[5], contract: r[6], moduleId: r[7] } : null;
  }
  async function countB02(moduleId: string, moduleVersion?: string): Promise<number> {
    const [r] = await h.ok(`SELECT count(*) FROM ${B02} WHERE module_id = ${lit(moduleId)}${moduleVersion ? ` AND module_version = ${lit(moduleVersion)}` : ''}`);
    return Number(r?.[0]);
  }
  async function b08(requestId: string) {
    const rows = await h.ok(`SELECT action_code, outcome, target_type, coalesce(target_id, '<null>'), coalesce(module_id::text, '<null>'),
        coalesce(version_id::text, '<null>'), coalesce(actor_account_id::text, '<null>'), metadata::text
      FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)} ORDER BY recorded_at`);
    return rows.map((r) => ({ action: r[0], outcome: r[1], targetType: r[2], targetId: r[3], moduleId: r[4], versionId: r[5], actor: r[6], metadata: JSON.parse(r[7] ?? 'null') }));
  }
  async function b07(requestId: string) {
    const rows = await h.ok(`SELECT event_type, module_id::text, coalesce(version_id::text, '<null>'), coalesce(actor_account_id::text, '<null>'),
        coalesce(before_state::text, '<null>'), coalesce(after_state::text, '<null>')
      FROM foundation.fnd_module_events WHERE correlation_id = ${lit(requestId)}`);
    return rows.map((r) => ({ type: r[0], moduleId: r[1], versionId: r[2], actor: r[3], before: JSON.parse(r[4] ?? 'null'), after: JSON.parse(r[5] ?? 'null') }));
  }
  async function waitUntil(label: string, check: () => Promise<boolean>, timeoutMs = 8000): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await check()) return Date.now() - started;
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${label}`);
  }
  const ungrantedLocks = async (where: string) => Number((await h.ok(`SELECT count(*) FROM pg_locks WHERE NOT granted AND ${where}`))[0]?.[0]);

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
      prisma, logger, production: false, hasher, breachedPasswords: new UnavailableBlocklist('not used by FBE-02C-VERIFY'),
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
    const kept = h ? await h.ok(`SELECT m.module_key, m.module_id::text,
        (SELECT count(*) FROM ${B02} v WHERE v.module_id = m.module_id),
        (SELECT string_agg(v.module_version || ':' || v.status, ',' ORDER BY v.created_at) FROM ${B02} v WHERE v.module_id = m.module_id),
        (SELECT count(*) FROM foundation.fnd_module_events e WHERE e.module_id = m.module_id),
        (SELECT count(*) FROM foundation.fnd_audit_logs a WHERE a.module_id = m.module_id)
      FROM foundation.fnd_modules m WHERE left(m.module_key, ${keyPrefix.length}) = ${lit(keyPrefix)} ORDER BY m.created_at`) : [];
    console.log(`[fbe02c] run ${run} (FBET-${run}, ${fx?.runId}) deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    console.log(`[fbe02c] kept modules (key, id, B02, versions, B07, B08): ${JSON.stringify(kept)}`);
    console.log(`[fbe02c] evidence ${JSON.stringify(evidence)}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ FP-2

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

  it('FP2-1 / FP2-2: the 12 VERSION_SQL + MANIFEST_SQL statements plan as talo_app; the privilege matrix of B02 is exact (EXPLAIN only, READ ONLY)', async () => {
    const statements: [string, string, unknown[]][] = [
      ['moduleExists', VERSION_SQL.moduleExists, [NIL]],
      ['listVersions', VERSION_SQL.listVersions, [NIL]],
      ['getVersion', VERSION_SQL.getVersion, [NIL, NIL]],
      ['lockModuleVersions', VERSION_SQL.lockModuleVersions, [NIL]],
      ['moduleVersionNumbers', VERSION_SQL.moduleVersionNumbers, [NIL]],
      ['insertVersion', VERSION_SQL.insertVersion, [NIL, '0.0.1', 'MIC-1.0']],
      ['insertVersionAudit', VERSION_SQL.insertVersionAudit, [NIL, NIL, NIL, NIL, 'MODULE_VERSION.CREATE', 'MODULE_VERSION', NIL, 'SUCCESS', 'plan', 'talo-mos-backend', '{}']],
      ['lockVersion', MANIFEST_SQL.lockVersion, [NIL, NIL]],
      ['otherVersions', MANIFEST_SQL.otherVersions, [NIL, NIL]],
      ['updateManifest', MANIFEST_SQL.updateManifest, [NIL, NIL, '{}']],
      ['submitVersion', MANIFEST_SQL.submitVersion, [NIL, NIL, 'a'.repeat(64), NIL]],
      ['insertSubmitEvent', MANIFEST_SQL.insertSubmitEvent, [NIL, NIL, NIL, '{}', '{}', 'plan']],
    ];
    expect(statements.map((s) => s[0]).sort()).toEqual([...Object.keys(VERSION_SQL), ...Object.keys(MANIFEST_SQL)].sort());
    const allowed: Record<string, string> = {};
    for (const [name, sql, values] of statements) allowed[name] = await plan(sql, values);
    expect(allowed).toEqual(Object.fromEntries(statements.map((s) => [s[0], 'OK'])));
    const forbidden: Record<string, string> = {
      'DELETE B02': `DELETE FROM ${B02}`,
      // FBE-05: reviewed_by_account_id / reviewed_at / activated_at are now granted (lifecycle); these columns stay forbidden.
      'UPDATE contract_version': `UPDATE ${B02} SET contract_version = contract_version`,
      'UPDATE created_at': `UPDATE ${B02} SET created_at = created_at`,
      'UPDATE version_id': `UPDATE ${B02} SET version_id = version_id`,
      'UPDATE module_version': `UPDATE ${B02} SET module_version = module_version`,
      'UPDATE module_id': `UPDATE ${B02} SET module_id = module_id`,
      'INSERT version_id': `INSERT INTO ${B02} (version_id, module_id, module_version, contract_version) VALUES ('${NIL}', '${NIL}', '0.0.1', 'MIC-1.0')`,
      'INSERT status': `INSERT INTO ${B02} (module_id, module_version, contract_version, status) VALUES ('${NIL}', '0.0.1', 'MIC-1.0', 'APPROVED')`,
      'INSERT manifest_hash': `INSERT INTO ${B02} (module_id, module_version, contract_version, manifest_hash) VALUES ('${NIL}', '0.0.1', 'MIC-1.0', NULL)`,
      'UPDATE B07': `UPDATE foundation.fnd_module_events SET event_type = event_type`,
      'DELETE B08': `DELETE FROM foundation.fnd_audit_logs`,
      'SELECT B09': `SELECT 1 FROM foundation.fnd_navigation_items`,
    };
    const refused: Record<string, string> = {};
    for (const [name, sql] of Object.entries(forbidden)) refused[name] = await plan(sql, []);
    expect(refused).toEqual(Object.fromEntries(Object.keys(forbidden).map((k) => [k, '42501'])));
    const [matrix] = await prisma.$queryRawUnsafe<{ sel: boolean; del: boolean; trunc: boolean; ref: boolean; trig: boolean; ins: string; upd: string }[]>(`
      SELECT has_table_privilege('${B02}', 'SELECT') AS sel, has_table_privilege('${B02}', 'DELETE') AS del,
             has_table_privilege('${B02}', 'TRUNCATE') AS trunc, has_table_privilege('${B02}', 'REFERENCES') AS ref, has_table_privilege('${B02}', 'TRIGGER') AS trig,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = '${B02}'::regclass AND attnum > 0 AND has_column_privilege('${B02}', attname, 'INSERT')) AS ins,
             (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = '${B02}'::regclass AND attnum > 0 AND has_column_privilege('${B02}', attname, 'UPDATE')) AS upd`);
    expect(matrix).toEqual({ sel: true, del: false, trunc: false, ref: false, trig: false, ins: 'module_id,module_version,contract_version', upd: 'status,manifest_json,manifest_hash,submitted_by_account_id,reviewed_by_account_id,reviewed_at,activated_at' });
    evidence['fp2_privileges'] = matrix;
  });

  it('FP2-3: talo_test_harness reads B02 and cannot write it', async () => {
    const [row] = await h.ok(`SELECT current_user, has_table_privilege('${B02}', 'SELECT'), has_any_column_privilege('${B02}', 'INSERT'),
      has_any_column_privilege('${B02}', 'UPDATE'), has_table_privilege('${B02}', 'DELETE'), has_table_privilege('${B02}', 'TRUNCATE')`);
    expect(row).toEqual(['talo_test_harness', 't', 'f', 'f', 'f', 'f']);
    await h.ok('BEGIN READ ONLY');
    const del = await h.query(`EXPLAIN DELETE FROM ${B02}`);
    await h.query('ROLLBACK');
    expect(del.sqlstate).toBe('42501');
  });

  it('FP2-4: Prisma adapter — advisory lock via $executeRaw, controlled 23505 on B02, interactive transaction rollback', async () => {
    const { cookie } = await actor(['registryCreate', 'create']);
    const { moduleId } = await newModule(cookie);
    await newVersion(cookie, moduleId, '1.0.0');
    // pg_advisory_xact_lock(integer, integer) executed through $executeRawUnsafe (void result) inside a transaction.
    const locked = await prisma.$transaction(async (tx) => tx.$executeRawUnsafe(VERSION_SQL.lockModuleVersions, moduleId));
    expect(typeof locked).toBe('number');
    // The real UNIQUE (module_id, module_version) through the adapter: SQLSTATE 23505; the transaction rolls back.
    let state = '';
    try {
      await prisma.$transaction(async (tx) => tx.$queryRawUnsafe(VERSION_SQL.insertVersion, moduleId, '1.0.0', 'MIC-1.0'));
    } catch (error) {
      state = sqlstateOf(error) ?? 'none';
    }
    expect(state).toBe('23505');
    expect(await countB02(moduleId)).toBe(1);
    evidence['fp2_23505'] = state;
  });

  // ------------------------------------------------------------------ FBE-02A

  it('A1 / A2: CREATE DRAFT → 201; B02 DRAFT with NULL manifest / hash / submitter; one B08 SUCCESS; no B07; LIST / GET return it, other modules hidden', async () => {
    const { accountId, cookie } = await actor(['registryCreate', 'read', 'create']);
    const { moduleId } = await newModule(cookie);
    const other = await newModule(cookie);
    const otherVersion = await newVersion(cookie, other.moduleId, '3.0.0');
    const res = await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    expect(res.status).toBe(201);
    const v = res.body.version;
    expect(v).toMatchObject({ moduleId, moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', status: 'DRAFT', manifestJson: null, manifestHash: null, submittedByAccountId: null });
    expect(v.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(await b02(v.versionId)).toMatchObject({ status: 'DRAFT', manifest: '<sql-null>', hash: '<null>', submittedBy: '<null>', moduleId });
    const audits = await b08(rid(res));
    expect(audits).toEqual([{
      action: 'MODULE_VERSION.CREATE', outcome: 'SUCCESS', targetType: 'MODULE_VERSION', targetId: v.versionId, moduleId, versionId: v.versionId, actor: accountId,
      metadata: { v: 1, reason: 'CREATED', requestId: rid(res) },
    }]);
    expect(await b07(rid(res))).toEqual([]);
    const list = await send('get', versionsUrl(moduleId), cookie);
    expect(list.status).toBe(200);
    expect(list.body.versions).toEqual([v]);
    const detail = await send('get', `${versionsUrl(moduleId)}/${v.versionId}`, cookie);
    expect(detail.body.version).toEqual(v);
    const hidden = await send('get', `${versionsUrl(moduleId)}/${otherVersion}`, cookie);
    expect(hidden.status).toBe(404);
    expect(await b08(rid(list))).toEqual([]); // successful READ is not audited
    evidence['a2'] = { moduleId, versionId: v.versionId };
  });

  it('A3 / A4: duplicate → 409 VERSION_EXISTS; ordering is numeric MAJOR.MINOR.PATCH (1.10.0 > 1.9.0); not increasing → 409', async () => {
    const { cookie } = await actor(['registryCreate', 'create']);
    const { moduleId } = await newModule(cookie);
    for (const version of ['1.9.0', '1.10.0']) await newVersion(cookie, moduleId, version);
    const dup = await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.10.0', contractVersion: 'MIC-1.0' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VERSION_EXISTS');
    const lower = await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.2.0', contractVersion: 'MIC-1.0' });
    expect(lower.status).toBe(409);
    expect(lower.body.error.code).toBe('VERSION_NOT_INCREASING');
    expect(await countB02(moduleId, '1.10.0')).toBe(1);
    expect(await countB02(moduleId)).toBe(2);
    expect(await b08(rid(dup))).toEqual([]);
    expect(await b08(rid(lower))).toEqual([]);
    expect((await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '2.0.0', contractVersion: 'MIC-1.0' })).status).toBe(201);
  });

  it('A5: module not found → 404 MODULE_NOT_FOUND; no orphan B02, no B08 SUCCESS', async () => {
    const { cookie } = await actor(['create']);
    const missing = randomUUID();
    const res = await send('post', versionsUrl(missing), cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MODULE_NOT_FOUND');
    expect(await countB02(missing)).toBe(0);
    expect(await b08(rid(res))).toEqual([]);
  });

  it('A6: IAM — missing READ / CREATE → 403 + B08 DENIED before any lookup; Direct ALLOW allows; Direct DENY overrides Role ALLOW', async () => {
    const owner = await actor(['registryCreate', 'read', 'create']);
    const { moduleId } = await newModule(owner.cookie);
    const none = await actor([]);
    const g = await send('get', versionsUrl(randomUUID()), none.cookie); // a missing module is not disclosed: 403, not 404
    const c = await send('post', versionsUrl(moduleId), none.cookie, { moduleVersion: 'bad' });
    for (const [res, action] of [[g, 'MODULE_VERSION.READ'], [c, 'MODULE_VERSION.CREATE']] as const) {
      expect(res.status).toBe(403);
      expect(await b08(rid(res))).toEqual([{
        action, outcome: 'DENIED', targetType: 'MODULE_VERSION', targetId: '<null>', moduleId: '<null>', versionId: '<null>', actor: none.accountId,
        metadata: { v: 1, reason: 'NO_VALID_ALLOW', requestId: rid(res) },
      }]);
    }
    const direct = await actor([]);
    await az.direct(direct.accountId, perm.read, 'ALLOW');
    expect((await send('get', versionsUrl(moduleId), direct.cookie)).status).toBe(200);
    const denied = await actor(['read']);
    await az.direct(denied.accountId, perm.read, 'DENY');
    const d = await send('get', versionsUrl(moduleId), denied.cookie);
    expect(d.status).toBe(403);
    expect((await b08(rid(d)))[0]?.metadata.reason).toBe('DIRECT_DENY');
  });

  it('A7: B08 SUCCESS fails (real 23514) → 503 and the B02 INSERT is rolled back', async () => {
    const { cookie } = await actor(['registryCreate', 'create']);
    const { moduleId } = await newModule(cookie);
    fault = 'VERSION_AUDIT_SUCCESS';
    const res = await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' });
    fault = 'NONE';
    expect(res.status).toBe(503);
    expect(await countB02(moduleId)).toBe(0);
    expect(await b08(rid(res))).toEqual([]);
    expect(logs.some((l) => l.includes('create version failed (rolled back)') && l.includes('"sqlstate":"23514"'))).toBe(true);
    expect((await send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' })).status).toBe(201);
  });

  it('A8: CREATE waits on the module advisory lock held by another session and proceeds after it is released', async () => {
    const { cookie } = await actor(['registryCreate', 'create']);
    const { moduleId } = await newModule(cookie);
    const holder = new PsqlSession();
    try {
      // pg_advisory_lock returns void (an empty psql line): select a marker so the call is observable.
      const [lockRow] = await holder.ok(`SELECT 'locked' FROM (SELECT pg_advisory_lock(${VERSION_LOCK_NAMESPACE}, hashtext(${lit(moduleId)}))) AS l`);
      expect(lockRow).toEqual(['locked']);
      const started = Date.now();
      const pending = send('post', versionsUrl(moduleId), cookie, { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' }).then((r) => r);
      const waitMs = await waitUntil('advisory lock waiter', async () => (await ungrantedLocks(`locktype = 'advisory' AND classid = ${VERSION_LOCK_NAMESPACE}`)) === 1);
      await sleep(1500);
      expect(await countB02(moduleId)).toBe(0); // still blocked
      expect(await ungrantedLocks(`locktype = 'advisory' AND classid = ${VERSION_LOCK_NAMESPACE}`)).toBe(1);
      const [unlocked] = await holder.ok(`SELECT pg_advisory_unlock(${VERSION_LOCK_NAMESPACE}, hashtext(${lit(moduleId)}))`);
      expect(unlocked?.[0]).toBe('t');
      const res = await pending;
      const elapsed = Date.now() - started;
      expect(res.status).toBe(201);
      expect(elapsed).toBeGreaterThanOrEqual(1500);
      expect(await countB02(moduleId)).toBe(1);
      expect(await ungrantedLocks(`locktype = 'advisory' AND classid = ${VERSION_LOCK_NAMESPACE}`)).toBe(0);
      evidence['a8'] = { waiterSeenAfterMs: waitMs, createElapsedMs: elapsed };
    } finally {
      await holder.query(`SELECT pg_advisory_unlock_all()`);
      await holder.close();
    }
  });

  it('A9: two concurrent CREATEs of the same version → exactly one 201 and one 409; one B02 row; one B08 SUCCESS', async () => {
    const { cookie } = await actor(['registryCreate', 'create']);
    const { moduleId } = await newModule(cookie);
    const body = { moduleVersion: '1.0.0', contractVersion: 'MIC-1.0' };
    const results = await Promise.all([send('post', versionsUrl(moduleId), cookie, body), send('post', versionsUrl(moduleId), cookie, body)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('VERSION_EXISTS');
    expect(await countB02(moduleId, '1.0.0')).toBe(1);
    // One harness connection: read sequentially.
    const [first, second] = results;
    const audits = [...(await b08(rid(first))), ...(await b08(rid(second)))];
    const successes = audits.filter((a) => a.outcome === 'SUCCESS');
    expect(successes).toHaveLength(1);
    expect(await ungrantedLocks('true')).toBe(0);
    evidence['a9'] = statuses;
  });

  // ------------------------------------------------------------------ FBE-02B

  it('B1 / B2: PUT manifest stores JSONB (hash NULL, DRAFT, B08 UPDATE_MANIFEST, no B07); {manifest: null} stores SQL NULL', async () => {
    const { accountId, cookie } = await actor(['registryCreate', 'create', 'update']);
    const { moduleId } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    const draft = { mic01Identity: { moduleKey: 'DRAFT' }, note: 'Bản nháp tiếng Việt', nested: { n: 42, list: [1, 'x', true, null] } };
    const res = await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: draft });
    expect(res.status).toBe(200);
    expect(res.body.version.manifestJson).toEqual(draft); // adapter returns jsonb as a parsed value
    const row = await b02(versionId);
    expect(row).toMatchObject({ status: 'DRAFT', jsonType: 'object', hash: '<null>' });
    expect(JSON.parse(row?.manifest ?? 'null')).toEqual(draft);
    expect(await b08(rid(res))).toEqual([{
      action: 'MODULE_VERSION.UPDATE_MANIFEST', outcome: 'SUCCESS', targetType: 'MODULE_VERSION', targetId: versionId, moduleId, versionId, actor: accountId,
      metadata: { v: 1, reason: 'MANIFEST_UPDATED', requestId: rid(res) },
    }]);
    expect(await b07(rid(res))).toEqual([]);
    const cleared = await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: null });
    expect(cleared.status).toBe(200);
    expect(await b02(versionId)).toMatchObject({ manifest: '<sql-null>', jsonType: '<sql-null>', hash: '<null>', status: 'DRAFT' });
    expect((await b08(rid(cleared)))[0]?.metadata.reason).toBe('MANIFEST_CLEARED');
    expect(await b07(rid(cleared))).toEqual([]);
  });

  it('B3 / B4: valid SUBMIT → IN_REVIEW; RFC 8785 SHA-256 equals the hash recomputed from the JSONB read back; key order irrelevant; B07 SUBMIT + B08 SUCCESS', async () => {
    const { accountId, cookie } = await actor(['registryCreate', 'create', 'update', 'submit', 'read']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    const mic = validMic(moduleKey, '1.0.0');
    expect((await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: mic })).status).toBe(200);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(mic).reverse())));
    const expected = canonicalDigest(reordered).sha256;
    const res = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, { expectedManifestHash: expected });
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ status: 'IN_REVIEW', manifestHash: expected, submittedByAccountId: accountId });
    const row = await b02(versionId);
    expect(row).toMatchObject({ status: 'IN_REVIEW', hash: expected, submittedBy: accountId });
    expect(row?.hash).toHaveLength(64); // CHAR(64), unpadded
    // Round trip 1: harness reads jsonb as text. Round trip 2: talo_app reads it through the Prisma adapter.
    const fromHarness = canonicalDigest(JSON.parse(row?.manifest ?? 'null')).sha256;
    const [viaPrisma] = await prisma.$queryRawUnsafe<{ manifest_json: unknown; manifest_hash: string }[]>(VERSION_SQL.getVersion, versionId, moduleId);
    const fromPrisma = canonicalDigest(viaPrisma?.manifest_json).sha256;
    expect(typeof viaPrisma?.manifest_json).toBe('object');
    expect(viaPrisma?.manifest_hash).toBe(expected);
    expect([fromHarness, fromPrisma]).toEqual([expected, expected]);
    expect(canonicalDigest(mic).sha256).toBe(expected);
    expect(JSON.stringify(mic)).not.toBe(JSON.stringify(reordered));
    const events = await b07(rid(res));
    expect(events).toEqual([{ type: 'SUBMIT', moduleId, versionId, actor: accountId, before: { status: 'DRAFT' }, after: { status: 'IN_REVIEW', manifest_hash: expected } }]);
    expect(await b08(rid(res))).toEqual([{
      action: 'MODULE_VERSION.SUBMIT', outcome: 'SUCCESS', targetType: 'MODULE_VERSION', targetId: versionId, moduleId, versionId, actor: accountId,
      metadata: { v: 1, reason: 'SUBMITTED', requestId: rid(res), manifestHash: expected },
    }]);
    evidence['b4'] = { versionId, hash: expected, fromHarness, fromPrisma };
  });

  it('B5: MIC_INVALID → 422 with approved codes; DRAFT kept; no B07; one B08 FAILURE outside the rolled-back transaction, without MIC content', async () => {
    const { accountId, cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    const mic = validMic(moduleKey, '1.0.0');
    const broken = { ...mic, mic04Navigation: [{ menuLabel: 'SECRET-MARKER-FBE02C', functionKey: 'GHOST' }], mic07IamMapping: mic.mic07IamMapping.slice(1) };
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: broken });
    const res = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'MIC_INVALID', details: { errors: ['NAVIGATION_FUNCTION_UNKNOWN', 'IAM_MAPPING_MISSING'] } });
    expect(await b02(versionId)).toMatchObject({ status: 'DRAFT', hash: '<null>', submittedBy: '<null>' });
    expect(await b07(rid(res))).toEqual([]);
    const audits = await b08(rid(res));
    expect(audits).toEqual([{
      action: 'MODULE_VERSION.SUBMIT', outcome: 'FAILURE', targetType: 'MODULE_VERSION', targetId: versionId, moduleId, versionId, actor: accountId,
      metadata: { v: 1, reason: 'MIC_INVALID', errors: ['NAVIGATION_FUNCTION_UNKNOWN', 'IAM_MAPPING_MISSING'], requestId: rid(res) },
    }]);
    expect(JSON.stringify(audits)).not.toContain('SECRET-MARKER-FBE02C');
    // Audit fail-closed: the FAILURE row itself cannot be written (real 23514) → 503, never a 422 without audit.
    fault = 'VERSION_AUDIT_FAILURE';
    const failClosed = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {});
    fault = 'NONE';
    expect(failClosed.status).toBe(503);
    expect(await b08(rid(failClosed))).toEqual([]);
    expect((await b02(versionId))?.status).toBe('DRAFT');
  });

  it('B6: expectedManifestHash mismatch → 409, no B07 / B08; MIC invalid + wrong hash → 422 (G-3)', async () => {
    const { cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: validMic(moduleKey, '1.0.0') });
    const res = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, { expectedManifestHash: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MANIFEST_HASH_MISMATCH');
    expect(await b02(versionId)).toMatchObject({ status: 'DRAFT', hash: '<null>' });
    expect(await b07(rid(res))).toEqual([]);
    expect(await b08(rid(res))).toEqual([]);
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: { incomplete: true } });
    const both = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, { expectedManifestHash: 'f'.repeat(64) });
    expect(both.status).toBe(422);
  });

  it('B7: after IN_REVIEW, PUT and SUBMIT → 409 VERSION_NOT_DRAFT; manifest / hash unchanged; no SUCCESS audit for the refused calls', async () => {
    const { cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    const mic = validMic(moduleKey, '1.0.0');
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: mic });
    expect((await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {})).status).toBe(200);
    const before = await b02(versionId);
    const put = await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: { changed: true } });
    const again = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {});
    for (const r of [put, again]) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('VERSION_NOT_DRAFT');
      expect(await b08(rid(r))).toEqual([]);
      expect(await b07(rid(r))).toEqual([]);
    }
    expect(await b02(versionId)).toEqual(before);
  });

  it('B8: SUBMIT with B07 failing (real 23503) or B08 failing (real 23514) → 503; B02 stays DRAFT, no partial B07 / B08', async () => {
    for (const f of ['SUBMIT_EVENT', 'VERSION_AUDIT_SUCCESS'] as const) {
      const { cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
      const { moduleId, moduleKey } = await newModule(cookie);
      const versionId = await newVersion(cookie, moduleId);
      await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: validMic(moduleKey, '1.0.0') });
      fault = f;
      const res = await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {});
      fault = 'NONE';
      expect(res.status, f).toBe(503);
      expect(await b02(versionId), f).toMatchObject({ status: 'DRAFT', hash: '<null>', submittedBy: '<null>' });
      expect(await b07(rid(res)), f).toEqual([]);
      expect(await b08(rid(res)), f).toEqual([]);
      const code = f === 'SUBMIT_EVENT' ? '23503' : '23514';
      expect(logs.some((l) => l.includes('submit version failed (rolled back)') && l.includes(`"sqlstate":"${code}"`)), f).toBe(true);
      // The same SUBMIT without the fault commits: nothing of the failed attempt was left behind.
      expect((await send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {})).status, f).toBe(200);
    }
  });

  it('B9: a B02 row lock held by another talo_app transaction serialises SUBMIT then PUT; SUBMIT commits IN_REVIEW, PUT gets 409', async () => {
    const { cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    const mic = validMic(moduleKey, '1.0.0');
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: mic });
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    let lockTaken = false;
    // Controlled holder: SELECT … FOR UPDATE on the version row as talo_app (no data change), released by the test.
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT version_id FROM ${B02} WHERE version_id = $1::uuid FOR UPDATE`, versionId);
      lockTaken = true;
      await gate;
    }, { timeout: 30_000, maxWait: 5_000 });
    try {
      await waitUntil('holder lock', async () => lockTaken);
      const submitP = send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {}).then((r) => ({ r, at: Date.now() }));
      await waitUntil('SUBMIT waiting on the row lock', async () => (await ungrantedLocks('true')) >= 1);
      const putP = send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: { overwrite: true } }).then((r) => ({ r, at: Date.now() }));
      await waitUntil('PUT waiting behind SUBMIT', async () => (await ungrantedLocks('true')) >= 2);
      await sleep(500);
      expect((await b02(versionId))?.status).toBe('DRAFT'); // nothing proceeded while the lock is held
      const waiting = await ungrantedLocks('true');
      release();
      await holder;
      const [s, p] = await Promise.all([submitP, putP]);
      expect(s.r.status).toBe(200);
      expect(p.r.status).toBe(409);
      expect(p.r.body.error.code).toBe('VERSION_NOT_DRAFT');
      expect(s.at).toBeLessThanOrEqual(p.at);
      const row = await b02(versionId);
      expect(row?.status).toBe('IN_REVIEW');
      expect(JSON.parse(row?.manifest ?? 'null')).toEqual(mic); // the PUT never overwrote the submitted manifest
      expect(row?.hash).toBe(canonicalDigest(JSON.parse(row?.manifest ?? 'null')).sha256);
      expect(await b08(rid(p.r))).toEqual([]);
      expect(await ungrantedLocks('true')).toBe(0);
      evidence['b9'] = { waitersWhileLocked: waiting, submitStatus: s.r.status, putStatus: p.r.status };
    } finally {
      release();
      await holder.catch(() => undefined);
    }
  });

  it('B9b: reverse order — PUT waits first, then SUBMIT; SUBMIT hashes the manifest written by the PUT', async () => {
    const { cookie } = await actor(['registryCreate', 'create', 'update', 'submit']);
    const { moduleId, moduleKey } = await newModule(cookie);
    const versionId = await newVersion(cookie, moduleId);
    await send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: { draft: true } });
    const finalMic = validMic(moduleKey, '1.0.0');
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    let lockTaken = false;
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT version_id FROM ${B02} WHERE version_id = $1::uuid FOR UPDATE`, versionId);
      lockTaken = true;
      await gate;
    }, { timeout: 30_000, maxWait: 5_000 });
    try {
      await waitUntil('holder lock', async () => lockTaken);
      // supertest only dispatches when awaited / then-ed: start both requests explicitly.
      const putP = send('put', `${versionsUrl(moduleId)}/${versionId}/manifest`, cookie, { manifest: finalMic }).then((r) => r);
      await waitUntil('PUT waiting', async () => (await ungrantedLocks('true')) >= 1);
      const submitP = send('post', `${versionsUrl(moduleId)}/${versionId}/submit`, cookie, {}).then((r) => r);
      await waitUntil('SUBMIT waiting behind PUT', async () => (await ungrantedLocks('true')) >= 2);
      release();
      await holder;
      const [p, s] = await Promise.all([putP, submitP]);
      expect([p.status, s.status]).toEqual([200, 200]);
      const row = await b02(versionId);
      expect(row?.status).toBe('IN_REVIEW');
      expect(row?.hash).toBe(canonicalDigest(finalMic).sha256);
    } finally {
      release();
      await holder.catch(() => undefined);
    }
  });
});
