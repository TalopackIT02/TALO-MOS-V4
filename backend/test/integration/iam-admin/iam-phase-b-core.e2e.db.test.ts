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
import { prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { probeIamAdmin } from '../../../src/modules/iam-admin/iam.admin.connection.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// IAM Phase B CORE acceptance on PostgreSQL (talo_mos_v4_test) — the part that does NOT depend on P-4e (temporary
// credentials stay DISABLED, no talo_provisioner connection): account lifecycle through the SECURITY DEFINER functions,
// sessions, failed-login lock, IAM audit, details, root / self / READ refusals, ROOT_NOT_CONFIGURED rule, credential routes
// refused while P-4e is off, database boundaries. TALO_IAM_PHASE_B_DB=1 + DATABASE_URL + IAM_ADMIN_DATABASE_URL.
// Fixtures only (AUTHT-* accounts, FBET-* roles), removed by UUID with ownership proof.

const enabled = process.env['TALO_IAM_PHASE_B_DB'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';
const ADMIN_PERMS = ['iam.accounts.read', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read', 'iam.accounts.create'];

describe.skipIf(!enabled)('IAM Phase B CORE acceptance (P-4e disabled) — lifecycle / sessions / audit on PostgreSQL', { timeout: 300_000 }, () => {
  let api: PrismaClient;
  let iam: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let auth: Awaited<ReturnType<typeof createAuthModule>>;
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const tag = `FBET-${run}`;
  const perm: Record<string, string> = {};
  const created: { roles: string[] } = { roles: [] };
  const evidence: Record<string, unknown> = {};

  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    return (Array.isArray(header) ? header[0] : '')?.split(';')[0] ?? '';
  };
  const appWith = (rootAccountId: string | null): Express => createApp({
    config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: createLogger({ level: 'error' }),
    apiRouters: [auth.router, iamAdminRouter({ db: prismaFoundationDb(iam), authService: auth.service, secureCookie: false, rootAccountId })],
  });
  const client = (app: Express) => ({
    login: (username: string, password: string) => request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username, password })),
    get: (url: string, as: string) => request(app).get(`/api${url}`).set('User-Agent', fx.userAgent).set('Cookie', as),
    post: (url: string, as: string, body: unknown = {}) =>
      request(app).post(`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body)),
  });
  async function withRole(accountId: string, name: string, codes: readonly string[]) {
    const roleId = randomUUID();
    created.roles.push(roleId);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`${tag}-${name}`)}, ${lit(`FBET ${name}`)}, true, false)`);
    for (const code of codes) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(perm[code] ?? NIL)})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(randomUUID())}, ${lit(accountId)}, ${lit(roleId)})`);
    await h.ok('COMMIT');
  }
  const statusOf = async (accountId: string) => (await h.ok(`SELECT account_status FROM iam.iam_user_accounts WHERE user_account_id = ${lit(accountId)}`))[0]?.[0];

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const iamUrl = process.env['IAM_ADMIN_DATABASE_URL'];
    if (!checkSmokeUrl(url).ok || !iamUrl) throw new Error('needs DATABASE_URL (talo_app) and IAM_ADMIN_DATABASE_URL');
    api = createPrismaClient(url ?? '');
    iam = createPrismaClient(iamUrl);
    const problems = await probeIamAdmin((sql) => api.$queryRawUnsafe<unknown[]>(sql), (sql) => iam.$queryRawUnsafe<unknown[]>(sql));
    if (problems.length > 0) throw new Error(`dedicated IAM role refused: ${problems.join(', ')}`);
    const [who] = await iam.$queryRawUnsafe<{ usr: string }[]>('SELECT current_user::text AS usr');
    evidence['iamRole'] = who?.usr;
    h = await AuthFixtures.connect();
    const [pkg] = await h.ok(`SELECT (to_regprocedure('iam.admin_set_account_status(uuid,uuid,text,text,uuid)') IS NOT NULL)::text`);
    if (pkg?.[0] !== 'true') throw new Error('IAM-PHASE-B-DB CORE is not installed on this database');
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
      const accounts = uuidArray(fx.accounts.length ? fx.accounts : [NIL]);
      const roles = uuidArray(created.roles.length ? created.roles : [NIL]);
      await h.ok('BEGIN');
      const counts: Record<string, string | undefined> = {};
      for (const [name, sql] of [
        ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_account_id = ANY(${accounts}) OR role_id = ANY(${roles})`],
        ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
        ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code LIKE ${lit(`${tag}-%`)}`],
      ] as const) counts[name] = (await h.ok(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`))[0]?.[0];
      await h.ok('COMMIT');
      const cleaned = await fx.cleanup();
      const remaining = await fx.remaining();
      const [roleLeft] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${tag}-%`)}`);
      console.log(`[iam-phase-b-core-e2e] run ${run} cleanup ${JSON.stringify({ ...counts, ...cleaned })} remaining ${remaining} roles ${roleLeft?.[0]} evidence ${JSON.stringify(evidence)}`);
      await h.close();
      expect([remaining, roleLeft?.[0]]).toEqual([0, '0']);
    }
    await api?.$disconnect();
    await iam?.$disconnect();
  });

  it('lifecycle, sessions, login lock, audit, root / self / READ refusals; P-4e routes refused; DB boundaries', async () => {
    const rootFx = await fx.create();
    const c = client(appWith(rootFx.accountId));
    const signIn = async (u: string, p: string) => { const r = await c.login(u, p); expect(r.status).toBe(200); return cookieOf(r); };
    const adminFx = await fx.create();
    await withRole(adminFx.accountId, 'ADMIN', ADMIN_PERMS);
    const readerFx = await fx.create();
    await withRole(readerFx.accountId, 'READER', ['iam.accounts.read']);
    const userFx = await fx.create();
    const admin = await signIn(adminFx.username, adminFx.password);
    const reader = await signIn(readerFx.username, readerFx.password);
    let user = await signIn(userFx.username, userFx.password);
    const u = userFx.accountId;

    expect((await c.get('/iam/admin/me/capabilities', admin)).body.features).toEqual({ temporaryCredentials: 'DISABLED' });
    // P-4e disabled: credential routes refuse before anything is attempted.
    const cr = await c.post('/iam/admin/accounts', admin, { employeeCode: `${fx.runId}-X`, fullName: 'X', username: `${fx.runId}-x`.toLowerCase(), joinedAt: '2026-10-01' });
    const rr = await c.post(`/iam/admin/accounts/${u}/credential/reissue`, admin, { reason: 'x' });
    // Legacy combined create blocked by the owner decision PC-01 G2 (410 before any P-4e step); re-issue still P-4e gated.
    expect([cr.status, cr.body.error.code, rr.status, rr.body.error.code]).toEqual([410, 'LEGACY_ACCOUNT_CREATE_BLOCKED', 503, 'CREDENTIAL_UI_DISABLED']);

    // details (06 column grants)
    const d = await c.get(`/iam/admin/accounts/${u}/details`, reader);
    expect([d.status, typeof d.body.details?.createdAt, d.body.details?.mustChangePassword]).toEqual([200, 'string', false]);

    // lifecycle (04 function, writer protocol): lock → session 401 + login 403; unlock; disable → reactivate; invalid 409.
    const lock = await c.post(`/iam/admin/accounts/${u}/status`, admin, { action: 'LOCK', reason: 'Nghiệm thu khóa' });
    expect([lock.status, lock.body.result.status, lock.body.result.revokedSessions]).toEqual([200, 'LOCKED', 1]);
    expect((await c.get('/auth/session', user)).status).toBe(401);
    expect((await c.login(userFx.username, userFx.password)).status).toBe(403);
    expect((await c.post(`/iam/admin/accounts/${u}/status`, admin, { action: 'UNLOCK', reason: 'x' })).body.result.status).toBe('ACTIVE');
    user = await signIn(userFx.username, userFx.password);
    expect((await c.post(`/iam/admin/accounts/${u}/status`, admin, { action: 'DISABLE', reason: 'x' })).body.result).toMatchObject({ status: 'DISABLED', revokedSessions: 1 });
    expect((await c.login(userFx.username, userFx.password)).status).toBe(403);
    const bad = await c.post(`/iam/admin/accounts/${u}/status`, admin, { action: 'UNLOCK', reason: 'x' });
    expect([bad.status, bad.body.error.code]).toEqual([409, 'STATUS_TRANSITION_INVALID']);
    expect((await c.post(`/iam/admin/accounts/${u}/status`, admin, { action: 'REACTIVATE', reason: 'x' })).body.result.status).toBe('ACTIVE');
    user = await signIn(userFx.username, userFx.password);

    // sessions: list without token / hash, revoke one, revoke all.
    const second = await signIn(userFx.username, userFx.password);
    const list = await c.get(`/iam/admin/accounts/${u}/sessions`, admin);
    expect(JSON.stringify(list.body)).not.toMatch(/token|hash/i);
    const live = list.body.sessions.filter((s: { status: string }) => s.status === 'ACTIVE');
    expect(live.length).toBe(2);
    expect((await c.post(`/iam/admin/accounts/${u}/sessions/revoke`, admin, { sessionId: live[0].sessionId, reason: 'x' })).body.result.revokedSessions).toBe(1);
    expect([(await c.get('/auth/session', user)).status, (await c.get('/auth/session', second)).status].sort()).toEqual([200, 401]);
    expect((await c.post(`/iam/admin/accounts/${u}/sessions/revoke`, admin, { reason: 'x' })).body.result.revokedSessions).toBe(1);

    // failed-login lock (Auth automatic) cleared by the administrator.
    for (let i = 0; i < 5; i++) await c.login(userFx.username, 'wrong-password-1');
    expect((await c.login(userFx.username, userFx.password)).status).toBe(401);
    expect((await c.post(`/iam/admin/accounts/${u}/login-lock/clear`, admin, { reason: 'Đã xác minh' })).body.result.cleared).toBe(true);
    user = await signIn(userFx.username, userFx.password);

    // refusals with no change: root (configured fixture), self, READ only.
    for (const action of ['LOCK', 'DISABLE']) {
      const r = await c.post(`/iam/admin/accounts/${rootFx.accountId}/status`, admin, { action, reason: 'x' });
      expect([r.status, r.body.error.code]).toEqual([422, 'ROOT_ADMIN_PROTECTED']);
    }
    expect(await statusOf(rootFx.accountId)).toBe('ACTIVE');
    expect((await c.post(`/iam/admin/accounts/${adminFx.accountId}/status`, admin, { action: 'LOCK', reason: 'x' })).body.error.code).toBe('SELF_ACTION_FORBIDDEN');
    for (const r of [
      await c.post(`/iam/admin/accounts/${u}/status`, reader, { action: 'LOCK', reason: 'x' }),
      await c.get(`/iam/admin/accounts/${u}/sessions`, reader),
      await c.get('/iam/admin/audit', reader),
      await c.post(`/iam/admin/accounts/${u}/login-lock/clear`, reader, { reason: 'x' }),
    ]) expect(r.status).toBe(403);

    // runtime configuration today (IAM_ROOT_ADMIN_ACCOUNT_ID absent): a platform administrator cannot be locked at all.
    const noRoot = client(appWith(null));
    const nr = await noRoot.post(`/iam/admin/accounts/${readerFx.accountId}/status`, admin, { action: 'LOCK', reason: 'x' });
    expect([nr.status, nr.body.error.code]).toEqual([422, 'ROOT_NOT_CONFIGURED']);
    expect(await statusOf(readerFx.accountId)).toBe('ACTIVE');

    // database boundaries.
    await expect(api.$queryRawUnsafe('SELECT * FROM iam.admin_set_account_status($1::uuid,$2::uuid,$3,$4,$5::uuid)', adminFx.accountId, u, 'LOCK', 'x', randomUUID())).rejects.toBeDefined();
    const direct = await iam.$executeRawUnsafe(`UPDATE iam.iam_user_accounts SET account_status = 'LOCKED' WHERE user_account_id = '${u}'`).then(() => 'written', (e: unknown) => String(e));
    expect(direct).toMatch(/permission denied|42501/);
    expect(await statusOf(u)).toBe('ACTIVE');

    // audit viewer: every action by the administrator; refusals recorded; no ip / ua key.
    const page = await c.get(`/iam/admin/audit?accountId=${u}&pageSize=100`, admin);
    const actions = page.body.events.map((e: { action: string }) => e.action);
    for (const a of ['IAM.ACCOUNT.LOCK', 'IAM.ACCOUNT.UNLOCK', 'IAM.ACCOUNT.DISABLE', 'IAM.ACCOUNT.REACTIVATE', 'IAM.SESSION.REVOKE', 'IAM.CREDENTIAL.LOGIN_LOCK_CLEAR']) expect(actions).toContain(a);
    expect(JSON.stringify(page.body)).not.toMatch(/"ip"|"ua"/);
    const failures = await h.ok(`SELECT metadata->>'reason' FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(adminFx.accountId)} AND outcome = 'FAILURE' ORDER BY occurred_at`);
    expect(failures.map((r) => r[0])).toEqual(['ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'SELF_ACTION_FORBIDDEN', 'ROOT_NOT_CONFIGURED']);
    evidence['actions'] = [...new Set(actions)].sort();
    evidence['failures'] = failures.map((r) => r[0]);
  });
});
