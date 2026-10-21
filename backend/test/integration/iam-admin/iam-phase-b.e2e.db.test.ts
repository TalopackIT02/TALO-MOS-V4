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
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import { prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { probeIamAdmin } from '../../../src/modules/iam-admin/iam.admin.connection.js';
import { connectProvisioner } from '../../../src/modules/iam-admin/iam.admin.provisioner.js';
import type { ProvisionerConnection } from '../../../src/modules/iam-admin/iam.admin.provisioner.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// LEGACY FLOW — BLOCKED (owner decision IAM Phase C PC-01 G2, 21/10/2026): this acceptance creates its accounts through the
// combined POST /iam/admin/accounts (account + membership + temporary credential), which now answers 410
// LEGACY_ACCOUNT_CREATE_BLOCKED. It is NOT expected to pass and must NOT be adapted to pass; it is reworked with PC-02
// (assign membership + credential, D-1). It stays opt-in (TALO_IAM_PHASE_B_DB=1 + P-4e) and is not part of the regression list.
//
// IAM Phase B acceptance on PostgreSQL (talo_mos_v4_test, or its disposable clone), AFTER the IAM-PHASE-B-DB package:
//   TALO_IAM_PHASE_B_DB=1, DATABASE_URL (talo_app), IAM_ADMIN_DATABASE_URL (talo_iam_admin), PROVISIONER_DATABASE_URL
//   (talo_provisioner); TALO_PG_CONTAINER for a clone. Real Auth, real IAM router on talo_iam_admin, real P-4e services on
//   talo_provisioner, the SECURITY DEFINER functions of the package. An administrator fixture (role with the IAM Phase B
//   permissions, inserted by the harness) creates an account through the API, the new user activates it, then the account
//   is locked / unlocked / disabled / reactivated, its sessions revoked, its failed-login lock cleared, its temporary
//   password re-issued — each effect checked on Auth (login / session) and in the IAM audit. Root, self, privileged and
//   READ-only refusals are checked with no change. Everything this run creates is removed by UUID with ownership proof.

const enabled = process.env['TALO_IAM_PHASE_B_DB'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';
const ADMIN_PERMS = ['iam.accounts.read', 'iam.accounts.create', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read',
  'iam.assignments.manage', 'iam.roles.manage'];
const PLATFORM_ONE = ['iam.accounts.read'];

describe.skipIf(!enabled)('[LEGACY — combined create blocked (410) until PC-02] IAM Phase B acceptance — account lifecycle / credentials / sessions / audit on PostgreSQL', { timeout: 300_000 }, () => {
  let api: PrismaClient;
  let iam: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let app: Express;
  let provisioner: ProvisionerConnection;
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const tag = `FBET-${run}`;
  const perm: Record<string, string> = {};
  const created: { roles: string[] } = { roles: [] };
  const evidence: Record<string, unknown> = {};
  let rootId = NIL;

  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    return (Array.isArray(header) ? header[0] : '')?.split(';')[0] ?? '';
  };
  const login = (username: string, password: string) => request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
    .set('User-Agent', fx.userAgent).send(JSON.stringify({ username, password }));
  const get = (url: string, as: string) => request(app).get(`/api${url}`).set('User-Agent', fx.userAgent).set('Cookie', as);
  const post = (url: string, as: string, body: unknown = {}) =>
    request(app).post(`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body));
  async function signIn(username: string, password: string): Promise<string> {
    const res = await login(username, password);
    expect(res.status).toBe(200);
    return cookieOf(res);
  }
  async function withRole(accountId: string, name: string, codes: readonly string[], system = false) {
    const roleId = randomUUID();
    created.roles.push(roleId);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`${tag}-${name}`)}, ${lit(`FBET ${name}`)}, true, ${system ? 'true' : 'false'})`);
    for (const code of codes) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(perm[code] ?? NIL)})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(randomUUID())}, ${lit(accountId)}, ${lit(roleId)})`);
    await h.ok('COMMIT');
  }
  const statusOf = async (accountId: string) => (await h.ok(`SELECT account_status FROM iam.iam_user_accounts WHERE user_account_id = ${lit(accountId)}`))[0]?.[0];
  const audits = async (actor: string, action: string) => Number((await h.ok(
    `SELECT count(*) FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(actor)} AND action_code = ${lit(action)} AND outcome = 'SUCCESS'`))[0]?.[0]);

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env')); // existing variables (e.g. a clone) are kept
    const url = process.env['DATABASE_URL'];
    const iamUrl = process.env['IAM_ADMIN_DATABASE_URL'];
    const provUrl = process.env['PROVISIONER_DATABASE_URL'];
    if (!checkSmokeUrl(url).ok || !iamUrl || !provUrl) throw new Error('needs DATABASE_URL (talo_app), IAM_ADMIN_DATABASE_URL and PROVISIONER_DATABASE_URL');
    api = createPrismaClient(url ?? '');
    iam = createPrismaClient(iamUrl);
    const problems = await probeIamAdmin((sql) => api.$queryRawUnsafe<unknown[]>(sql), (sql) => iam.$queryRawUnsafe<unknown[]>(sql));
    if (problems.length > 0) throw new Error(`dedicated IAM role refused: ${problems.join(', ')}`);
    const logger = createLogger({ level: 'error' });
    provisioner = await connectProvisioner({ enabled: true, url: provUrl, apiClient: api, createClient: createPrismaClient, logger });
    if (provisioner.state !== 'READY') throw new Error('provisioner connection refused (talo_provisioner)');
    h = await AuthFixtures.connect();
    const [pkg] = await h.ok(`SELECT (to_regprocedure('iam.admin_set_account_status(uuid,uuid,text,text,uuid)') IS NOT NULL)::text,
                                     (SELECT count(*) FROM iam.iam_permissions WHERE permission_code IN ('iam.accounts.create','iam.accounts.manage','iam.credentials.reissue','iam.sessions.manage','iam.audit.read'))::text`);
    if (pkg?.[0] !== 'true' || pkg?.[1] !== '5') throw new Error('IAM-PHASE-B-DB package is not installed on this database (functions / permissions missing)');
    const hasher = new PasswordHasher();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    for (const code of [...ADMIN_PERMS, 'system_test.diagnostics.read', 'system_test.data_viewer.read']) {
      const [row] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(code)}`);
      if (!row?.[0]) throw new Error(`permission ${code} not registered`);
      perm[code] = row[0];
    }
    const rootFx = await fx.create();
    rootId = rootFx.accountId;
    const auth = await createAuthModule({ prisma: api, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
    app = createApp({
      config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger,
      apiRouters: [auth.router, createFoundationModule({ prisma: api, authService: auth.service, logger, secureCookie: false, environment: 'TEST' }).router, iamAdminRouter({ db: prismaFoundationDb(iam), authService: auth.service, secureCookie: false, rootAccountId: rootId, provisioner, hasher: auth.hasher })],
    });
  });

  afterAll(async () => {
    if (h) {
      const accounts = uuidArray(fx.accounts.length ? fx.accounts : [NIL]);
      const roles = uuidArray(created.roles.length ? created.roles : [NIL]);
      await h.ok('BEGIN');
      const counts: Record<string, string | undefined> = {};
      for (const [name, sql] of [
        ['user_permissions', `DELETE FROM iam.iam_user_permissions WHERE user_account_id = ANY(${accounts})`],
        ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_account_id = ANY(${accounts}) OR role_id = ANY(${roles})`],
        ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
        ['roles', `DELETE FROM iam.iam_roles WHERE (role_id = ANY(${roles}) OR role_code LIKE ${lit(`${tag}-%`)}) AND role_code LIKE ${lit(`${tag}-%`)}`],
      ] as const) counts[name] = (await h.ok(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`))[0]?.[0];
      await h.ok('COMMIT');
      const auth = await fx.cleanup();
      const remaining = await fx.remaining();
      const [roleLeft] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${tag}-%`)}`);
      console.log(`[iam-phase-b-e2e] run ${run} cleanup ${JSON.stringify({ ...counts, ...auth })} remaining ${remaining} roles ${roleLeft?.[0]} evidence ${JSON.stringify(evidence)}`);
      await h.close();
      expect([remaining, roleLeft?.[0]]).toEqual([0, '0']);
    }
    await provisioner?.close();
    await api?.$disconnect();
    await iam?.$disconnect();
  });

  it('create → activate → lock / unlock → disable / reactivate → sessions → login lock → reissue; root / self / privileged / READ refusals; audit', async () => {
    const adminFx = await fx.create();
    await withRole(adminFx.accountId, 'ADMIN', ADMIN_PERMS);
    const admin = await signIn(adminFx.username, adminFx.password);
    const readerFx = await fx.create();
    await withRole(readerFx.accountId, 'READER', PLATFORM_ONE);
    const reader = await signIn(readerFx.username, readerFx.password);
    const platformFx = await fx.create();
    await withRole(platformFx.accountId, 'PLATFORM', PLATFORM_ONE);
    // A SYSTEM role without any permission: the reissue rule must refuse it for being a system role alone.
    const systemFx = await fx.create();
    await withRole(systemFx.accountId, 'SYSTEMROLE', [], true);
    const exitedFx = await fx.create({ membershipStatus: 'EXITED' });
    type Node = { routePath: string | null; children: Node[] };
    const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
    const routes = async (as: string) => flat((await get('/foundation/navigation', as)).body.navigation)
      .map((n) => n.routePath).filter((r): r is string => r !== null && r.startsWith('/system-test')).sort();

    // capabilities: the administrator sees the Phase B permissions and the credential feature.
    const caps = await get('/iam/admin/me/capabilities', admin);
    expect([caps.body.permissions['iam.accounts.manage'], caps.body.features.temporaryCredentials]).toEqual([true, 'READY']);

    // 1. create through the P-4e service (actor / created_by = administrator), first login, activation.
    const username = `${fx.runId}-api1`.toLowerCase();
    const createdRes = await post('/iam/admin/accounts', admin, { employeeCode: `${fx.runId}-API1`, fullName: 'Tài khoản tạo qua AppShell', username, joinedAt: '2026-10-01' });
    expect([createdRes.status, createdRes.headers['cache-control']]).toEqual([201, 'no-store']);
    const userId = String(createdRes.body.account.accountId);
    const temporary = String(createdRes.body.account.temporaryPassword);
    const [membership] = await h.ok(`SELECT membership_id, created_by_account_id, account_status FROM iam.iam_user_accounts WHERE user_account_id = ${lit(userId)}`);
    fx.adopt(membership?.[0] ?? NIL, userId, username);
    expect([membership?.[1], membership?.[2]]).toEqual([adminFx.accountId, 'PROVISIONED']);
    const [prov] = await h.ok(`SELECT actor_account_id, metadata->>'ua', metadata::text LIKE ${lit(`%${temporary}%`)} FROM iam.iam_audit_logs WHERE action_code = 'ACCOUNT_PROVISIONED' AND target_id = ${lit(userId)}`);
    expect(prov).toEqual([adminFx.accountId, 'iam-admin-ui', 'f']);
    const first = await login(username, temporary);
    expect([first.status, first.body.status]).toEqual([200, 'PASSWORD_CHANGE_REQUIRED']);
    const newPassword = `Talo-${randomBytes(9).toString('base64url')}-9a`;
    const changed = await post('/auth/password/first-change', cookieOf(first), { newPassword });
    expect(changed.status).toBe(200);
    expect(await statusOf(userId)).toBe('ACTIVE');
    let user = await signIn(username, newPassword);
    // creation refusals (P-4e service rules, nothing created): duplicate username, membership not active, membership with a current account.
    const dup = await post('/iam/admin/accounts', admin, { employeeCode: `${fx.runId}-API2`, fullName: 'Trùng', username, joinedAt: '2026-10-01' });
    const exited = await post('/iam/admin/accounts', admin, { employeeCode: exitedFx.employeeCode, fullName: 'Đã nghỉ', username: `${fx.runId}-api3`.toLowerCase(), joinedAt: '2026-10-01' });
    const taken = await post('/iam/admin/accounts', admin, { employeeCode: readerFx.employeeCode, fullName: 'Có tài khoản', username: `${fx.runId}-api4`.toLowerCase(), joinedAt: '2026-10-01' });
    expect([dup.status, dup.body.error.code, exited.status, exited.body.error.code, taken.status, taken.body.error.code])
      .toEqual([409, 'USERNAME_TAKEN', 422, 'MEMBERSHIP_NOT_ACTIVE', 409, 'MEMBERSHIP_HAS_ACCOUNT']);
    expect((await h.ok(`SELECT count(*) FROM iam.iam_user_accounts WHERE lower(username) IN (${lit(`${fx.runId}-api3`.toLowerCase())}, ${lit(`${fx.runId}-api4`.toLowerCase())})`))[0]?.[0]).toBe('0');

    // 2. lock → session invalid now, login refused; unlock → login works. Invalid transition → 409.
    const lock = await post(`/iam/admin/accounts/${userId}/status`, admin, { action: 'LOCK', reason: 'Kiểm thử khóa' });
    expect([lock.status, lock.body.result.status, lock.body.result.revokedSessions >= 1]).toEqual([200, 'LOCKED', true]);
    expect((await get('/auth/session', user)).status).toBe(401);
    expect((await login(username, newPassword)).status).toBe(403);
    const unlock = await post(`/iam/admin/accounts/${userId}/status`, admin, { action: 'UNLOCK', reason: 'Mở khóa' });
    expect([unlock.status, unlock.body.result.status]).toEqual([200, 'ACTIVE']);
    user = await signIn(username, newPassword);
    const disable = await post(`/iam/admin/accounts/${userId}/status`, admin, { action: 'DISABLE', reason: 'x' });
    expect([disable.status, disable.body.result.status]).toEqual([200, 'DISABLED']);
    expect((await get('/auth/session', user)).status).toBe(401);
    expect((await login(username, newPassword)).status).toBe(403);
    const bad = await post(`/iam/admin/accounts/${userId}/status`, admin, { action: 'UNLOCK', reason: 'x' });
    expect([bad.status, bad.body.error.code]).toEqual([409, 'STATUS_TRANSITION_INVALID']);
    expect((await post(`/iam/admin/accounts/${userId}/status`, admin, { action: 'REACTIVATE', reason: 'Quay lại làm việc' })).body.result.status).toBe('ACTIVE');
    user = await signIn(username, newPassword);

    // 3. sessions: listed without token / hash; one revoked → that cookie is refused.
    const second = await signIn(username, newPassword);
    const list = await get(`/iam/admin/accounts/${userId}/sessions`, admin);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/token|hash/i);
    const live = list.body.sessions.filter((s: { status: string }) => s.status === 'ACTIVE');
    expect(live.length).toBeGreaterThanOrEqual(2);
    const one = await post(`/iam/admin/accounts/${userId}/sessions/revoke`, admin, { sessionId: live[0].sessionId, reason: 'Thiết bị mất' });
    expect(one.body.result.revokedSessions).toBe(1);
    const statuses = [(await get('/auth/session', user)).status, (await get('/auth/session', second)).status].sort();
    expect(statuses).toEqual([200, 401]);
    const all = await post(`/iam/admin/accounts/${userId}/sessions/revoke`, admin, { reason: 'Buộc đăng nhập lại' });
    expect(all.body.result.revokedSessions).toBe(1);

    // 4. failed-login lock (automatic) → cleared by the administrator.
    for (let i = 0; i < 5; i++) await login(username, 'wrong-password-1');
    expect((await login(username, newPassword)).status).toBe(401);
    const clear = await post(`/iam/admin/accounts/${userId}/login-lock/clear`, admin, { reason: 'Đã xác minh người dùng' });
    expect(clear.body.result.cleared).toBe(true);
    user = await signIn(username, newPassword);

    // 5. business role → effective permission + navigation follow IAM; Direct DENY wins; then reissue (narrower P-4e rule).
    expect(await routes(user)).toEqual([]);
    const roleRes = await post('/iam/admin/roles', admin, { roleCode: `${tag}-BIZ`, roleName: 'FBET business' });
    created.roles.push(String(roleRes.body.role.id));
    for (const code of ['system_test.diagnostics.read', 'system_test.data_viewer.read']) {
      expect((await post(`/iam/admin/roles/${String(roleRes.body.role.id)}/permissions`, admin, { permissionId: perm[code] })).status).toBe(201);
    }
    expect((await post(`/iam/admin/accounts/${userId}/roles`, admin, { roleId: roleRes.body.role.id })).status).toBe(201);
    const [b09] = await h.ok(`SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_modules m ON m.module_id = n.module_id WHERE m.module_key = 'SYSTEM_TEST' AND n.function_id IS NOT NULL AND n.is_visible`);
    const menuChecked = Number(b09?.[0]) >= 3;
    evidence['menuChecked'] = menuChecked;
    if (menuChecked) expect(await routes(user)).toEqual(['/system-test', '/system-test/data']);
    const deny = await post(`/iam/admin/accounts/${userId}/permissions`, admin, { permissionId: perm['system_test.data_viewer.read'], effect: 'DENY', reason: 'Nghiệm thu DENY' });
    expect(deny.status).toBe(201);
    if (menuChecked) expect(await routes(user)).toEqual(['/system-test']);
    const eff = (await get(`/iam/admin/accounts/${userId}/permissions`, admin)).body.effective
      .filter((e: { permissionCode: string }) => e.permissionCode.startsWith('system_test.'))
      .map((e: { permissionCode: string; allowed: boolean; sources: string[] }) => [e.permissionCode, e.allowed, e.sources.join('+')]).sort();
    expect(eff).toEqual([
      ['system_test.data_viewer.read', false, 'ROLE+DIRECT_DENY'], ['system_test.diagnostics.read', true, 'ROLE'], ['system_test.test_runner.execute', false, ''],
    ]);
    const reissue = await post(`/iam/admin/accounts/${userId}/credential/reissue`, admin, { reason: 'Quên mật khẩu' });
    expect([reissue.status, reissue.headers['cache-control'], reissue.body.credential.revokedSessions]).toEqual([200, 'no-store', 1]);
    expect((await get('/auth/session', user)).status).toBe(401);
    expect((await login(username, newPassword)).status).toBe(401);
    expect((await login(username, String(reissue.body.credential.temporaryPassword))).body.status).toBe('PASSWORD_CHANGE_REQUIRED');

    // 6. refusals, nothing changed: platform-privileged reissue, root lock / disable / reissue, self, READ only.
    const priv = await post(`/iam/admin/accounts/${platformFx.accountId}/credential/reissue`, admin, { reason: 'x' });
    expect([priv.status, priv.body.error.code]).toEqual([422, 'PRIVILEGED_ACCOUNT_PROTECTED']);
    const sys = await post(`/iam/admin/accounts/${systemFx.accountId}/credential/reissue`, admin, { reason: 'x' });
    expect([sys.status, sys.body.error.code]).toEqual([422, 'PRIVILEGED_ACCOUNT_PROTECTED']);
    for (const action of ['LOCK', 'DISABLE']) {
      const r = await post(`/iam/admin/accounts/${rootId}/status`, admin, { action, reason: 'x' });
      expect([r.status, r.body.error.code]).toEqual([422, 'ROOT_ADMIN_PROTECTED']);
    }
    expect((await post(`/iam/admin/accounts/${rootId}/credential/reissue`, admin, { reason: 'x' })).body.error.code).toBe('ROOT_ADMIN_PROTECTED');
    expect(await statusOf(rootId)).toBe('ACTIVE');
    expect((await post(`/iam/admin/accounts/${adminFx.accountId}/status`, admin, { action: 'LOCK', reason: 'x' })).body.error.code).toBe('SELF_ACTION_FORBIDDEN');
    for (const r of [
      await post(`/iam/admin/accounts/${userId}/status`, reader, { action: 'LOCK', reason: 'x' }),
      await get(`/iam/admin/accounts/${userId}/sessions`, reader),
      await get('/iam/admin/audit', reader),
      await post(`/iam/admin/accounts/${userId}/credential/reissue`, reader, { reason: 'x' }),
    ]) expect(r.status).toBe(403);
    const details = await get(`/iam/admin/accounts/${userId}/details`, reader);
    expect([details.status, typeof details.body.details.createdAt, details.body.details.createdByUsername]).toEqual([200, 'string', adminFx.username]);

    // 7. database boundaries: talo_app cannot execute the functions; talo_iam_admin cannot write accounts directly.
    await expect(api.$queryRawUnsafe('SELECT * FROM iam.admin_set_account_status($1::uuid,$2::uuid,$3,$4,$5::uuid)', adminFx.accountId, userId, 'LOCK', 'x', randomUUID()))
      .rejects.toMatchObject({});
    const direct = await iam.$executeRawUnsafe(`UPDATE iam.iam_user_accounts SET account_status = 'LOCKED' WHERE user_account_id = '${userId}'`).then(() => 'written', (e: unknown) => String(e));
    expect(direct).toMatch(/permission denied|42501/);
    expect(await statusOf(userId)).toBe('ACTIVE');

    // 8. IAM audit: every action by the administrator, failures recorded, metadata without ip / user agent / password.
    const page = await get(`/iam/admin/audit?accountId=${userId}&pageSize=100`, admin);
    const actions = page.body.events.map((e: { action: string }) => e.action);
    for (const a of ['ACCOUNT_PROVISIONED', 'IAM.ACCOUNT.LOCK', 'IAM.ACCOUNT.UNLOCK', 'IAM.ACCOUNT.DISABLE', 'IAM.ACCOUNT.REACTIVATE', 'IAM.SESSION.REVOKE',
      'IAM.CREDENTIAL.LOGIN_LOCK_CLEAR', 'IAM.CREDENTIAL.REISSUE', 'CREDENTIAL_REISSUED', 'IAM.ACCOUNT.ROLE.ASSIGN', 'IAM.ACCOUNT.PERMISSION.ASSIGN']) {
      expect(actions).toContain(a);
    }
    // No ip / user-agent key, and none of the real secret values (action names such as CHANGE_PASSWORD are legitimate).
    const pageText = JSON.stringify(page.body);
    expect(pageText).not.toMatch(/"ip"|"ua"/);
    for (const secret of [temporary, newPassword, String(reissue.body.credential.temporaryPassword)]) expect(pageText).not.toContain(secret);
    const failures = await h.ok(`SELECT metadata->>'reason' FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(adminFx.accountId)} AND outcome = 'FAILURE' ORDER BY occurred_at`);
    expect(failures.map((r) => r[0])).toEqual(['PRIVILEGED_ACCOUNT_PROTECTED', 'PRIVILEGED_ACCOUNT_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'ROOT_ADMIN_PROTECTED', 'SELF_ACTION_FORBIDDEN']);
    // PERMISSION DENIED is audited too (the READ-only administrator's refused calls).
    const [denied] = await h.ok(`SELECT count(*) FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(readerFx.accountId)} AND action_code = 'IAM.ACCESS' AND outcome = 'DENIED'`);
    expect(Number(denied?.[0])).toBe(4);
    expect([await audits(adminFx.accountId, 'IAM.ACCOUNT.LOCK'), await audits(adminFx.accountId, 'IAM.CREDENTIAL.REISSUE')]).toEqual([1, 1]);
    evidence['actions'] = [...new Set(actions)].sort();
    evidence['failures'] = failures.length;
  });
});
