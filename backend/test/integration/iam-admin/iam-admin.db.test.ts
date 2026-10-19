import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { IamAdminRepository, IamError } from '../../../src/modules/iam-admin/iam.admin.repository.js';
import { iamAdminRouter } from '../../../src/modules/iam-admin/iam.admin.routes.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit } from '../sc5/harness.js';

// TALO-IAM-NEXT — IAM Management SQL on PostgreSQL 18.6 (talo_mos_v4_test) as the REAL API role talo_app. Runs only with
// TALO_FOUNDATION_DB=1. Writes NOTHING that can persist: reads are executed for real; every mutation is attempted only
// with random, non-existent UUIDs and only while talo_app provably lacks the IAM write privileges (owner approval
// pending), so it must fail closed (503 IAM_DB_PRIVILEGE_MISSING) inside a rolled-back transaction. The authorisation
// step (which writes an IAM DENIED audit row) is not called here; it is covered by the HTTP unit tests.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const actor = { userAccountId: randomUUID(), assuranceLevel: 1, requestId: randomUUID() };

describe.skipIf(!enabled)('IAM admin repository — PostgreSQL as talo_app (no persistent write)', { timeout: 120_000 }, () => {
  let prisma: PrismaClient;
  let repo: IamAdminRepository;
  let counts: () => Promise<string>;
  let before = '';

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [who] = await prisma.$queryRawUnsafe<{ db: string; usr: string }[]>('SELECT current_database() AS db, current_user AS usr');
    if (who?.db !== 'talo_mos_v4_test' || who.usr !== 'talo_app') throw new Error('guard: must run as talo_app on talo_mos_v4_test');
    repo = new IamAdminRepository(prismaFoundationDb(prisma));
    counts = async () => {
      const [row] = await prisma.$queryRawUnsafe<{ c: string }[]>(`SELECT concat_ws(',', (SELECT count(*) FROM iam.iam_roles), (SELECT count(*) FROM iam.iam_permissions),
        (SELECT count(*) FROM iam.iam_role_permissions), (SELECT count(*) FROM iam.iam_user_roles), (SELECT count(*) FROM iam.iam_user_permissions)) AS c`);
      return row?.c ?? '';
    };
    before = await counts();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('every read of the IAM screens and of the Navigation adapter is valid SQL with the current grants', async () => {
    const accounts = await repo.accounts('', 1, 25);
    expect(accounts.total).toBeGreaterThanOrEqual(1);
    expect(accounts.accounts.every((a) => !('password' in a) && !('credential' in a))).toBe(true);
    expect((await repo.accounts('%_no_such_user_%', 1, 25)).total).toBe(0);
    const [first] = accounts.accounts;
    const accountId = String(first?.accountId);
    expect((await repo.account(accountId)).accountId).toBe(accountId);
    const roles = await repo.roles();
    expect(roles.length).toBeGreaterThanOrEqual(1);
    await repo.rolePermissions(String(roles[0]?.roleId));
    await repo.accountRoles(accountId);
    await repo.accountPermissions(accountId);
    const effective = await repo.effective(accountId);
    expect(effective.length).toBe((await repo.permissions()).length);
    expect((await repo.navigationItems()).length).toBeGreaterThanOrEqual(0);
    await expect(repo.account(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('SYSTEM_TEST: the adapter offers its ACTIVE version Functions by name (DIAGNOSTICS / DATA_VIEWER / TEST_RUNNER)', async () => {
    const st = (await repo.activeModules()).find((m) => m.moduleKey === 'SYSTEM_TEST');
    expect(st).toMatchObject({ moduleKey: 'SYSTEM_TEST', activeVersion: '1.0.3', isEnabled: true });
    const fns = await repo.functions(String(st?.moduleId));
    expect([...new Set(fns.map((f) => f.functionKey))]).toEqual(['DATA_VIEWER', 'DIAGNOSTICS', 'TEST_RUNNER']);
    expect(fns.map((f) => `${String(f.functionKey)}.${String(f.actionKey)}`)).toEqual(['DATA_VIEWER.READ', 'DIAGNOSTICS.READ', 'TEST_RUNNER.EXECUTE']);
  });

  it('permission creation is bound to the ACTIVE MIC 1.0.3: existing K05 triple → 409; not in MIC-07 → 422; IAM namespace → 422', async () => {
    const base = { permissionCode: 'system_test.diagnostics.read', moduleCode: 'SYSTEM_TEST', resourceCode: 'DIAGNOSTICS', operation: 'READ', minimumAssuranceLevel: 1 };
    await expect(repo.createPermission(actor, base)).rejects.toMatchObject({ status: 409, code: 'PERMISSION_TRIPLE_EXISTS' });
    await expect(repo.createPermission(actor, { ...base, operation: 'EXPORT' })).rejects.toMatchObject({ status: 422, code: 'BINDING_INVALID' });
    await expect(repo.createPermission(actor, { ...base, moduleCode: 'IAM' })).rejects.toMatchObject({ status: 422, code: 'BINDING_INVALID' });
  });

  it('IAM-13: without the (pending) GRANTs every mutation fails closed — 503 IAM_DB_PRIVILEGE_MISSING, nothing stored', async () => {
    const [priv] = await prisma.$queryRawUnsafe<{ w: boolean }[]>(`SELECT (has_any_column_privilege('iam.iam_roles','INSERT') OR has_any_column_privilege('iam.iam_user_roles','INSERT')
      OR has_any_column_privilege('iam.iam_user_permissions','INSERT') OR has_any_column_privilege('iam.iam_role_permissions','INSERT')
      OR has_any_column_privilege('iam.iam_user_roles','UPDATE') OR has_table_privilege('iam.iam_role_permissions','DELETE')) AS w`);
    expect(priv?.w).toBe(false); // otherwise these attempts are not safe here: stop
    const business = (await repo.permissions()).find((p) => p.permissionCode === 'system_test.diagnostics.read');
    const businessId = String(business?.permissionId);
    const attempts: (() => Promise<unknown>)[] = [
      () => repo.createRole(actor, { roleCode: `ZZ_NEVER_${Date.now()}`, roleName: 'never stored' }),
      () => repo.updateRole(actor, randomUUID(), { isActive: false }),
      () => repo.assignRolePermission(actor, randomUUID(), randomUUID()),
      () => repo.revokeRolePermission(actor, randomUUID(), randomUUID()),
      () => repo.assignUserRole(actor, randomUUID(), randomUUID()),
      () => repo.revokeUserRole(actor, randomUUID(), randomUUID()),
      // A real business permission so the attempt reaches the INSERT (a random id is refused earlier: 404).
      () => repo.assignDirect(actor, randomUUID(), { permissionId: businessId, effect: 'DENY', reason: 'never stored' }),
      () => repo.revokeDirect(actor, randomUUID(), randomUUID()),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(IamError);
      expect(error).toMatchObject({ status: 503, code: 'IAM_DB_PRIVILEGE_MISSING' });
    }
    expect(await counts()).toBe(before);
  });
});

// HTTP on PostgreSQL: the real session (login of a fixture account) and the real IAM gate. The fixture account has no
// IAM admin permission (none is defined yet: bootstrap pending), so every admin route answers 403 and writes ONE IAM audit
// DENIED row; AuthFixtures removes the account, its sessions and that audit row by UUID with ownership proof.
describe.skipIf(!enabled)('IAM admin HTTP — PostgreSQL, real session (IAM-02 / IAM-03)', { timeout: 120_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let app: Express;

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
    const logger = createLogger({ level: 'error' });
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({ prisma, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger,
      apiRouters: [auth.router, iamAdminRouter({ db: prismaFoundationDb(prisma), authService: auth.service, secureCookie: false })] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
  });

  afterAll(async () => {
    const deleted = fx ? await fx.cleanup() : {};
    const remaining = fx ? await fx.remaining() : -1;
    console.log(`[iam-next] fixture cleanup ${JSON.stringify(deleted)} remaining ${remaining}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  it('401 anonymous; 403 FORBIDDEN + one IAM DENIED audit for an account without IAM admin permission; no data leaked', async () => {
    expect((await request(app).get('/api/iam/admin/accounts').set('User-Agent', fx.userAgent)).status).toBe(401);
    const acc = await fx.create();
    const login = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
      .set('User-Agent', fx.userAgent).send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(login.status).toBe(200);
    const header = login.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header[0] : '')?.split(';')[0] ?? '';
    for (const url of ['/api/iam/admin/accounts', '/api/iam/admin/roles', '/api/iam/admin/permissions', '/api/iam/admin/foundation/navigation/items']) {
      const res = await request(app).get(url).set('User-Agent', fx.userAgent).set('Cookie', cookie);
      expect([url, res.status, res.body.error?.code]).toEqual([url, 403, 'FORBIDDEN']);
      expect(JSON.stringify(res.body)).not.toMatch(/admin|username|password/i);
    }
    const write = await request(app).post('/api/iam/admin/roles').set('User-Agent', fx.userAgent).set('Cookie', cookie)
      .set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send(JSON.stringify({ roleCode: 'NEVER', roleName: 'never' }));
    expect(write.status).toBe(403);
    const [audit] = await h.ok(`SELECT count(*), string_agg(DISTINCT outcome, ',') FROM iam.iam_audit_logs WHERE actor_account_id = ${lit(acc.accountId)} AND action_code = 'IAM.ACCESS'`);
    expect(audit).toEqual(['5', 'DENIED']);
  });
});
