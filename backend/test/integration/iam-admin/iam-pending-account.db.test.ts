import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { evaluateAccess } from '../../../src/modules/foundation/foundation.permissions.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { probeIamAdmin } from '../../../src/modules/iam-admin/iam.admin.connection.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// IAM Phase C PC-01 on PostgreSQL — pending account (username only) through POST /api/iam/admin/accounts/pending and
// iam.admin_create_pending_account: DB-01…DB-09 of the task (row, no membership / credential / session, audit, login refused,
// pre-assigned role unusable, concurrent duplicate, existing data unchanged) + database boundaries (EXECUTE only for
// talo_iam_admin, no direct INSERT, ck_account_membership_state).
// TALO_IAM_PC01_DB=1 + DATABASE_URL (talo_app) + IAM_ADMIN_DATABASE_URL (talo_iam_admin) [+ TALO_PG_CONTAINER for a clone].
// When DATABASE_URL is already set (clone run) the repository .env is NOT loaded. Fixtures removed by UUID with ownership proof.

const enabled = process.env['TALO_IAM_PC01_DB'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';
const ADMIN_PERMS = ['iam.accounts.read', 'iam.accounts.create', 'iam.assignments.manage', 'iam.audit.read'];

describe.skipIf(!enabled)('IAM Phase C PC-01 — pending account on PostgreSQL', { timeout: 300_000 }, () => {
  let api: PrismaClient;
  let iam: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let auth: Awaited<ReturnType<typeof createAuthModule>>;
  const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const tag = `FBET-PC01-${run.toUpperCase()}`;
  const userTag = `pc01t-${run}`; // usernames of the pending accounts created here
  const perm: Record<string, string> = {};
  const created: { roles: string[]; pending: string[]; admin: string } = { roles: [], pending: [], admin: NIL };
  let before = '';

  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    return (Array.isArray(header) ? header[0] : '')?.split(';')[0] ?? '';
  };
  const app = (): Express => createApp({
    config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: createLogger({ level: 'error' }),
    apiRouters: [auth.router, iamAdminRouter({ db: prismaFoundationDb(iam), authService: auth.service, secureCookie: false, rootAccountId: null })],
  });
  const send = (a: Express, url: string, cookie: string, body: unknown) => request(a).post(`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN)
    .set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const login = (a: Express, username: string, password: string) => request(a).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
    .set('User-Agent', fx.userAgent).send(JSON.stringify({ username, password }));
  // Every account row except this run's (pending + fixtures): must be identical before / after (DB-09).
  const othersDigest = async () => (await h.ok(`SELECT md5(coalesce(string_agg(concat_ws('|', user_account_id, membership_id, username, account_status, created_by_account_id, created_at, activated_at, disabled_at), E'\\n' ORDER BY user_account_id), ''))
      FROM iam.iam_user_accounts WHERE NOT (user_account_id = ANY(${uuidArray([...fx.accounts, ...created.pending, NIL])})) AND lower(username) NOT LIKE ${lit(`${userTag}%`)}`))[0]?.[0] ?? '';

  beforeAll(async () => {
    if (!process.env['DATABASE_URL']) process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const iamUrl = process.env['IAM_ADMIN_DATABASE_URL'];
    if (!checkSmokeUrl(url).ok || !iamUrl) throw new Error('needs DATABASE_URL (talo_app) and IAM_ADMIN_DATABASE_URL');
    api = createPrismaClient(url ?? '');
    iam = createPrismaClient(iamUrl);
    const problems = await probeIamAdmin((sql) => api.$queryRawUnsafe<unknown[]>(sql), (sql) => iam.$queryRawUnsafe<unknown[]>(sql));
    if (problems.length > 0) throw new Error(`dedicated IAM role refused: ${problems.join(', ')}`);
    h = await AuthFixtures.connect();
    const [pkg] = await h.ok(`SELECT (to_regprocedure('iam.admin_create_pending_account(uuid,text,uuid)') IS NOT NULL)::text`);
    if (pkg?.[0] !== 'true') throw new Error('IAM-PHASE-C-DB PC-01 is not installed on this database');
    const hasher = new PasswordHasher();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    for (const code of ADMIN_PERMS) {
      const [row] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(code)}`);
      if (!row?.[0]) throw new Error(`permission ${code} not registered`);
      perm[code] = row[0];
    }
    auth = await createAuthModule({ prisma: api, logger: createLogger({ level: 'error' }), production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
  });

  afterAll(async () => {
    if (h) {
      const pending = uuidArray(created.pending.length ? created.pending : [NIL]);
      const roles = uuidArray(created.roles.length ? created.roles : [NIL]);
      // Ownership of the pending rows: created by this run's admin fixture, username of this run, no membership.
      const [foreign] = await h.ok(`SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ANY(${pending})
        AND NOT (created_by_account_id = ${lit(created.admin)}::uuid AND lower(username) LIKE ${lit(`${userTag}%`)} AND membership_id IS NULL)`);
      if (foreign?.[0] !== '0') throw new Error('cleanup refused: pending account ownership could not be proven');
      await h.ok('BEGIN');
      const counts: Record<string, string | undefined> = {};
      for (const [name, sql] of [
        ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_account_id = ANY(${pending}) OR user_account_id = ANY(${uuidArray(fx.accounts.length ? fx.accounts : [NIL])}) OR role_id = ANY(${roles})`],
        ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
        ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code LIKE ${lit(`${tag}-%`)}`],
        ['pending_audit', `DELETE FROM iam.iam_audit_logs WHERE target_id = ANY(${pending}) OR actor_account_id = ANY(${pending})`],
        ['pending_accounts', `DELETE FROM iam.iam_user_accounts WHERE user_account_id = ANY(${pending}) AND membership_id IS NULL`],
      ] as const) counts[name] = (await h.ok(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`))[0]?.[0];
      await h.ok('COMMIT');
      const cleaned = await fx.cleanup();
      const remaining = await fx.remaining();
      const [left] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_user_accounts WHERE lower(username) LIKE ${lit(`${userTag}%`)})
        + (SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${tag}-%`)})`);
      console.log(`[iam-pc01-db] run ${run} cleanup ${JSON.stringify({ ...counts, ...cleaned })} remaining ${remaining} left ${left?.[0]}`);
      await h.close();
      expect([remaining, left?.[0]]).toEqual([0, '0']);
    }
    await api?.$disconnect();
    await iam?.$disconnect();
  });

  it('DB-01…DB-09: create pending, no membership / credential / session, audit, login refused, pre-assigned role unusable, concurrent duplicate, others unchanged', async () => {
    const a = app();
    const adminFx = await fx.create();
    created.admin = adminFx.accountId;
    const roleId = randomUUID();
    created.roles.push(roleId);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`${tag}-ADMIN`)}, 'FBET PC-01 admin', true, false)`);
    for (const code of ADMIN_PERMS) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(perm[code] ?? NIL)})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(randomUUID())}, ${lit(adminFx.accountId)}, ${lit(roleId)})`);
    await h.ok('COMMIT');
    const signed = await login(a, adminFx.username, adminFx.password);
    expect(signed.status).toBe(200);
    const admin = cookieOf(signed);
    before = await othersDigest();

    // DB-01: pending account created through the API (P-4e not configured in this app: no provisioner).
    const name = `${userTag}-a`;
    const res = await send(a, '/iam/admin/accounts/pending', admin, { username: name });
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ username: name, accountStatus: 'PENDING_MEMBERSHIP', membershipId: null });
    const id = String(res.body.account.accountId);
    created.pending.push(id);
    const [row] = await h.ok(`SELECT account_status, (membership_id IS NULL)::text, created_by_account_id::text, (activated_at IS NULL)::text, (disabled_at IS NULL)::text, username
      FROM iam.iam_user_accounts WHERE user_account_id = ${lit(id)}`);
    expect(row).toEqual(['PENDING_MEMBERSHIP', 'true', adminFx.accountId, 'true', 'true', name]); // DB-02 membership NULL
    // DB-03 / DB-04: no credential, no session.
    const [none] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_credentials WHERE user_account_id = ${lit(id)}), (SELECT count(*) FROM iam.iam_sessions WHERE user_account_id = ${lit(id)})`);
    expect(none).toEqual(['0', '0']);
    // DB-05: audit in the same transaction, closed metadata (no secret exists at this step).
    const audit = await h.ok(`SELECT action_code, outcome, actor_account_id::text, target_type, (membership_id IS NULL)::text, (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(metadata) k), metadata->>'username'
      FROM iam.iam_audit_logs WHERE target_id = ${lit(id)}`);
    expect(audit).toEqual([['IAM.ACCOUNT.CREATE_PENDING', 'SUCCESS', adminFx.accountId, 'USER_ACCOUNT', 'true', 'requestId,status,username,v', name]]);
    // Visible in the admin reads (LEFT JOIN) with null membership columns.
    const list = await request(a).get(`/api/iam/admin/accounts?search=${encodeURIComponent(name)}&status=PENDING_MEMBERSHIP`).set('User-Agent', fx.userAgent).set('Cookie', admin);
    expect([list.status, list.body.total, list.body.accounts[0]?.membershipId, list.body.accounts[0]?.employeeCode]).toEqual([200, 1, null, null]);
    const details = await request(a).get(`/api/iam/admin/accounts/${id}/details`).set('User-Agent', fx.userAgent).set('Cookie', admin);
    expect([details.status, details.body.details.hasCredential, details.body.details.mustChangePassword]).toEqual([200, false, null]);

    // DB-06: sign-in of the pending account refused (uniform answer), no session.
    const denied = await login(a, name, 'Any-Password-123456');
    expect(denied.status).toBe(401);
    expect((await h.ok(`SELECT count(*) FROM iam.iam_sessions WHERE user_account_id = ${lit(id)}`))[0]?.[0]).toBe('0');

    // DB-07: a business role prepared in advance is stored but not usable — the evaluator denies (account not ACTIVE).
    // (Platform IAM / FOUNDATION permissions are never assignable through the API: PLATFORM_PERMISSION_LOCKED.)
    const [biz] = await h.ok(`SELECT permission_id, permission_code, module_code, resource_code, operation FROM iam.iam_permissions WHERE permission_code = 'system_test.data_viewer.read'`);
    if (!biz?.[0]) throw new Error('business permission system_test.data_viewer.read not registered');
    const bizRole = randomUUID();
    created.roles.push(bizRole);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(bizRole)}, ${lit(`${tag}-BIZ`)}, 'FBET PC-01 business', true, false)`);
    await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(bizRole)}, ${lit(biz[0])})`);
    await h.ok('COMMIT');
    const assigned = await send(a, `/iam/admin/accounts/${id}/roles`, admin, { roleId: bizRole });
    expect(assigned.status).toBe(201);
    const facts = await new SqlFoundationRepository(prismaFoundationDb(api)).loadAccessFacts(id, { permissionCode: biz[1] ?? '', moduleCode: biz[2] ?? '', resourceCode: biz[3] ?? '', operation: biz[4] ?? '' });
    expect(facts.grants.length).toBeGreaterThan(0);
    expect(evaluateAccess(facts, 1)).toEqual({ allowed: false, reason: 'ACCOUNT_NOT_ELIGIBLE' });

    // DB-08: concurrent duplicates (letter case differs) → exactly one created, the other 409 USERNAME_TAKEN.
    const dup = `${userTag}-b`;
    const both = await Promise.all([send(a, '/iam/admin/accounts/pending', admin, { username: dup }), send(a, '/iam/admin/accounts/pending', admin, { username: dup.toUpperCase() })]);
    const statuses = both.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)?.body.error.code).toBe('USERNAME_TAKEN');
    created.pending.push(String(both.find((r) => r.status === 201)?.body.account.accountId));
    // Existing username (any case) refused too.
    expect((await send(a, '/iam/admin/accounts/pending', admin, { username: adminFx.username.toUpperCase() })).body.error.code).toBe('USERNAME_TAKEN');
    // Validation in the function as well as in the API.
    expect((await send(a, '/iam/admin/accounts/pending', admin, { username: 'has space' })).status).toBe(400);
    expect((await h.ok(`SELECT count(*) FROM iam.iam_user_accounts WHERE lower(username) LIKE ${lit(`${userTag}%`)}`))[0]?.[0]).toBe('2');

    // DB-09: every other account unchanged.
    expect(await othersDigest()).toBe(before);
  });

  it('database boundaries: EXECUTE only for talo_iam_admin; no direct INSERT; ck_account_membership_state rejects wrong combinations', async () => {
    const asApp = await api.$queryRawUnsafe(`SELECT * FROM iam.admin_create_pending_account('${NIL}'::uuid, 'x', '${NIL}'::uuid)`).then(() => 'ok', (e: unknown) => String(e));
    expect(asApp).toContain('42501');
    const direct = await iam.$executeRawUnsafe(`INSERT INTO iam.iam_user_accounts (username, account_status) VALUES ('${userTag}-direct', 'PENDING_MEMBERSHIP')`).then(() => 'ok', (e: unknown) => String(e));
    expect(direct).toContain('42501');
    const [m] = await h.ok(`SELECT membership_id FROM iam.iam_memberships LIMIT 1`);
    for (const [status, membership, activated] of [['PENDING_MEMBERSHIP', lit(m?.[0] ?? NIL), 'NULL'], ['PROVISIONED', 'NULL', 'NULL'], ['ACTIVE', 'NULL', 'statement_timestamp()'],
      ['PENDING_MEMBERSHIP', 'NULL', 'statement_timestamp()'], ['DISABLED', 'NULL', 'statement_timestamp()'], ['PROVISIONED', lit(m?.[0] ?? NIL), 'statement_timestamp()']] as const) {
      const r = await h.query(`INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, activated_at, disabled_at)
        VALUES (${lit(randomUUID())}, ${membership}, ${lit(`${userTag}-ck-${status}`)}, ${lit(status)}, ${activated}, statement_timestamp())`);
      expect(r.sqlstate, `${status} membership=${membership} activated=${activated}`).toBe('23514');
    }
  });
});
