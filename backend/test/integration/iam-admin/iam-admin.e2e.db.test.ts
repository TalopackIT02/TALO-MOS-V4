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
import { INSTALLED_MODULES } from '../../../src/installed-modules/registry.js';
import { mountModules } from '../../../src/module-host/loader.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { probeIamAdmin } from '../../../src/modules/iam-admin/iam.admin.connection.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// IAM-NEXT acceptance (Gate 1 / Gate 2) on PostgreSQL talo_mos_v4_test, AFTER the owner-approved steps A + B1:
//   TALO_IAM_ADMIN_DB=1 and IAM_ADMIN_DATABASE_URL (role talo_iam_admin) in ../.env.
// Real Auth / Foundation / Module Host on talo_app, IAM Management on talo_iam_admin. An IAM administrator (fixture
// account with a fixture role holding the 4 iam.* + foundation.navigation.manage, created by the test harness) uses the
// IAM API to give account A the SYSTEM_TEST business permissions through a role; A reaches the SYSTEM_TEST API, B does
// not; Direct DENY blocks, revoking the DENY restores, revoking the role removes access. The menu is checked only when
// SYSTEM_TEST B09 Function items exist (created by the owner in the UI). Everything this run creates is removed by UUID
// with ownership proof; Foundation rows are not written.

const enabled = process.env['TALO_IAM_ADMIN_DB'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';
const ST_PERMS = ['system_test.diagnostics.read', 'system_test.data_viewer.read', 'system_test.test_runner.execute'];
const ADMIN_PERMS = ['iam.accounts.read', 'iam.roles.manage', 'iam.permissions.manage', 'iam.assignments.manage', 'foundation.navigation.manage'];

describe.skipIf(!enabled)('IAM-NEXT acceptance — IAM Management (talo_iam_admin) → SYSTEM_TEST access', { timeout: 300_000 }, () => {
  let api: PrismaClient;
  let iam: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let app: Express;
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const tag = `FBET-${run}`;
  const perm: Record<string, string> = {};
  const created = { roles: [] as string[], harnessRoles: [] as string[], harnessUserRoles: [] as string[] };
  const evidence: Record<string, unknown> = {};

  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    return (Array.isArray(header) ? header[0] : '')?.split(';')[0] ?? '';
  };
  async function login(accountId: string, username: string, password: string): Promise<{ accountId: string; cookie: string }> {
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username, password }));
    expect(res.status).toBe(200);
    return { accountId, cookie: cookieOf(res) };
  }
  const get = (url: string, as: string) => request(app).get(`/api${url}`).set('User-Agent', fx.userAgent).set('Cookie', as);
  const send = (method: 'post' | 'patch' | 'delete', url: string, as: string, body: unknown = {}) =>
    request(app)[method](`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', as).send(JSON.stringify(body));
  type Node = { routePath: string | null; children: Node[] };
  const routes = async (as: string): Promise<string[]> => {
    const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
    const res = await get('/foundation/navigation', as);
    expect(res.status).toBe(200);
    return flat(res.body.navigation).map((n: Node) => n.routePath).filter((r): r is string => r !== null && r.startsWith('/system-test')).sort();
  };

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const iamUrl = process.env['IAM_ADMIN_DATABASE_URL'];
    if (!checkSmokeUrl(url).ok || !iamUrl) throw new Error('needs DATABASE_URL (talo_app@talo_mos_v4_test) and IAM_ADMIN_DATABASE_URL');
    api = createPrismaClient(url ?? '');
    iam = createPrismaClient(iamUrl);
    const problems = await probeIamAdmin((sql) => api.$queryRawUnsafe<unknown[]>(sql), (sql) => iam.$queryRawUnsafe<unknown[]>(sql));
    if (problems.length > 0) throw new Error(`dedicated IAM role refused: ${problems.join(', ')}`);
    const logger = createLogger({ level: 'error' });
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({ prisma: api, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
    const foundation = createFoundationModule({ prisma: api, authService: auth.service, logger, secureCookie: false, environment: 'TEST' });
    const db = prismaFoundationDb(api);
    app = createApp({
      config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger,
      apiRouters: [auth.router, foundation.router, iamAdminRouter({ db: prismaFoundationDb(iam), authService: auth.service, secureCookie: false }),
        ...mountModules(INSTALLED_MODULES, { db, access: new SqlFoundationRepository(db), authService: auth.service, navigation: foundation.navigationService, logger, secureCookie: false }, logger)],
    });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    const [left] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE 'FBET-%'`);
    if (left?.[0] !== '0') throw new Error('fixture guard: leftover FBET- roles');
    for (const code of [...ST_PERMS, ...ADMIN_PERMS]) {
      const [row] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ${lit(code)}`);
      if (!row?.[0]) throw new Error(`permission ${code} not registered (step A approved and executed?)`);
      perm[code] = row[0];
    }
    const [st] = await h.ok(`SELECT m.is_enabled::text, v.module_version FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id = m.module_id AND v.status = 'ACTIVE' WHERE m.module_key = 'SYSTEM_TEST'`);
    expect(st).toEqual(['true', '1.0.3']);
  });

  afterAll(async () => {
    if (h) {
      const accounts = uuidArray(fx.accounts.length ? fx.accounts : [NIL]);
      const roles = uuidArray([...created.roles, ...created.harnessRoles].length ? [...created.roles, ...created.harnessRoles] : [NIL]);
      // Ownership: only assignments of this run's accounts, only roles created by this run (UUID + run tag).
      await h.ok('BEGIN');
      const counts: Record<string, string | undefined> = {};
      for (const [name, sql] of [
        ['user_permissions', `DELETE FROM iam.iam_user_permissions WHERE user_account_id = ANY(${accounts})`],
        ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_account_id = ANY(${accounts}) OR (role_id = ANY(${roles}) AND user_account_id = ANY(${accounts}))`],
        ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${roles})`],
        ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${roles}) AND role_code LIKE ${lit(`${tag}-%`)}`],
      ] as const) counts[name] = (await h.ok(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`))[0]?.[0];
      await h.ok('COMMIT');
      const auth = await fx.cleanup();
      const remaining = await fx.remaining();
      const [roleLeft] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${tag}-%`)}`);
      console.log(`[iam-next-e2e] run ${run} cleanup ${JSON.stringify({ ...counts, ...auth })} remaining ${remaining} roles ${roleLeft?.[0]} evidence ${JSON.stringify(evidence)}`);
      await h.close();
      expect([remaining, roleLeft?.[0]]).toEqual([0, '0']);
    }
    await api?.$disconnect();
    await iam?.$disconnect();
  });

  it('administrator grants / denies / revokes SYSTEM_TEST through the IAM UI API; access follows; escalation refused', async () => {
    // IAM administrator (fixture): role with the 4 iam.* + foundation.navigation.manage, inserted by the harness.
    const adminAcc = await fx.create();
    const harnessRole = randomUUID();
    const harnessUserRole = randomUUID();
    created.harnessRoles.push(harnessRole);
    created.harnessUserRoles.push(harnessUserRole);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(harnessRole)}, ${lit(`${tag}-ADMIN`)}, 'FBET IAM admin', true, false)`);
    for (const code of ADMIN_PERMS) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(harnessRole)}, ${lit(perm[code] ?? NIL)})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(harnessUserRole)}, ${lit(adminAcc.accountId)}, ${lit(harnessRole)})`);
    await h.ok('COMMIT');
    const admin = await login(adminAcc.accountId, adminAcc.username, adminAcc.password);
    const accA = await fx.create();
    const accB = await fx.create();
    const A = await login(accA.accountId, accA.username, accA.password);
    const B = await login(accB.accountId, accB.username, accB.password);
    const [b09] = await h.ok(`SELECT count(*) FROM foundation.fnd_navigation_items n JOIN foundation.fnd_modules m ON m.module_id = n.module_id WHERE m.module_key = 'SYSTEM_TEST' AND n.function_id IS NOT NULL AND n.is_visible`);
    const menuChecked = Number(b09?.[0]) >= 3;
    evidence['menuChecked'] = menuChecked;

    // Before: neither A nor B.
    for (const who of [A, B]) expect((await get('/system-test/health', who.cookie)).status).toBe(403);

    // IAM-05 / IAM-06 / IAM-07: role created, SYSTEM_TEST permissions added, role assigned to A — all through the API.
    const role = await send('post', '/iam/admin/roles', admin.cookie, { roleCode: `${tag}-ST`, roleName: 'SYSTEM_TEST users (fixture)' });
    expect(role.status).toBe(201);
    created.roles.push(String(role.body.role.id));
    for (const code of ST_PERMS) expect((await send('post', `/iam/admin/roles/${created.roles[0]}/permissions`, admin.cookie, { permissionId: perm[code] })).status).toBe(201);
    const assign = await send('post', `/iam/admin/accounts/${A.accountId}/roles`, admin.cookie, { roleId: created.roles[0] });
    expect(assign.status).toBe(201);
    expect((await send('post', `/iam/admin/accounts/${A.accountId}/roles`, admin.cookie, { roleId: created.roles[0] })).status).toBe(409); // duplicate active

    // NAV-05 / NAV-06: A reaches the three Functions' APIs; B still does not.
    expect([(await get('/system-test/health', A.cookie)).status, (await get('/system-test/tables', A.cookie)).status, (await get('/system-test/results', A.cookie)).status]).toEqual([200, 200, 200]);
    expect((await get('/system-test/health', B.cookie)).status).toBe(403);
    if (menuChecked) {
      expect(await routes(A.cookie)).toEqual(['/system-test', '/system-test/data', '/system-test/runner']);
      expect(await routes(B.cookie)).toEqual([]);
    }
    const eff = await get(`/iam/admin/accounts/${A.accountId}/permissions`, admin.cookie);
    expect(eff.body.effective.filter((e: { allowed: boolean; permissionCode: string }) => e.allowed).map((e: { permissionCode: string }) => e.permissionCode).sort()).toEqual([...ST_PERMS].sort());

    // NAV-04 / IAM-08: Direct DENY beats the role ALLOW (menu + API); revoking the DENY restores.
    const deny = await send('post', `/iam/admin/accounts/${A.accountId}/permissions`, admin.cookie, { permissionId: perm['system_test.data_viewer.read'], effect: 'DENY', reason: 'IAM-NEXT acceptance' });
    expect(deny.status).toBe(201);
    expect([(await get('/system-test/tables', A.cookie)).status, (await get('/system-test/health', A.cookie)).status]).toEqual([403, 200]);
    if (menuChecked) expect(await routes(A.cookie)).toEqual(['/system-test', '/system-test/runner']);
    expect((await send('post', `/iam/admin/accounts/${A.accountId}/permissions/${String(deny.body.assignment.id)}/revoke`, admin.cookie)).status).toBe(200);
    expect((await get('/system-test/tables', A.cookie)).status).toBe(200);

    // NAV-07 / IAM-07: revoking the role removes access.
    expect((await send('post', `/iam/admin/accounts/${A.accountId}/roles/${String(assign.body.assignment.id)}/revoke`, admin.cookie)).status).toBe(200);
    expect((await get('/system-test/health', A.cookie)).status).toBe(403);
    if (menuChecked) expect(await routes(A.cookie)).toEqual([]);

    // Issue 1 on the real database: platform / system / self are refused, nothing written.
    const [sys] = await h.ok(`SELECT role_id FROM iam.iam_roles WHERE role_code = 'TALO_SYSTEM_ADMIN'`);
    const refused = [
      await send('post', `/iam/admin/accounts/${B.accountId}/roles`, admin.cookie, { roleId: sys?.[0] }),
      await send('post', `/iam/admin/accounts/${B.accountId}/permissions`, admin.cookie, { permissionId: perm['iam.accounts.read'], effect: 'ALLOW', reason: 'x' }),
      await send('post', `/iam/admin/roles/${created.roles[0]}/permissions`, admin.cookie, { permissionId: perm['iam.assignments.manage'] }),
      await send('post', `/iam/admin/accounts/${admin.accountId}/permissions`, admin.cookie, { permissionId: perm['system_test.diagnostics.read'], effect: 'ALLOW', reason: 'x' }),
    ].map((r) => [r.status, r.body.error?.code]);
    expect(refused).toEqual([[422, 'SYSTEM_ROLE_LOCKED'], [422, 'PLATFORM_PERMISSION_LOCKED'], [422, 'PLATFORM_PERMISSION_LOCKED'], [422, 'SELF_ASSIGNMENT_FORBIDDEN']]);

    // IAM-11: every mutation has its SUCCESS audit by the administrator.
    const [audits] = await h.ok(`SELECT count(*) FILTER (WHERE outcome = 'SUCCESS') FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(admin.accountId)}`);
    expect(Number(audits?.[0])).toBe(1 + ST_PERMS.length + 1 + 1 + 1 + 1); // role, 3 role-permissions, assign, deny, revoke deny, revoke role
    evidence['audits'] = audits?.[0];
  });
});
