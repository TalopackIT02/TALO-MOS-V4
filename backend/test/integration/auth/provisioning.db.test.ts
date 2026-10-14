import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { silentLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { ProvisioningError, provisionAccount } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import type { SqlExecutor } from '../../../src/modules/auth/provisioning/provisionAccount.js';
import { REISSUE_FUNCTION_SIGNATURE, reissueTemporaryPassword } from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';
import { TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH, generateTemporaryPassword } from '../../../src/modules/auth/provisioning/temporaryPassword.js';
import { PwnedPasswordsStore } from '../../../src/modules/auth/pwnedPasswords.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { createPwnedFixture, removePwnedFixture } from '../../support/pwnedFixture.js';
import { PsqlSession, lit } from '../sc5/harness.js';

// P-4e provisioning, executed AS talo_provisioner (container-local psql, same role and grants as the production CLI,
// same SQL from PROVISIONING_SQL). Parameters are inlined as quoted literals by this test executor only.
// TALO_AUTH_DB=1, test database only; every created row is adopted by the fixture cleanup.

const enabled = process.env['TALO_AUTH_DB'] === '1';

function psqlExecutor(session: PsqlSession): SqlExecutor {
  const bind = (sql: string, params: readonly (string | null)[]) =>
    sql.replace(/\$(\d+)/g, (_, n: string) => { const v = params[Number(n) - 1]; return v === null || v === undefined ? 'NULL' : lit(v); });
  const executor: SqlExecutor = {
    async query(sql, params) {
      const text = bind(sql, params).trim();
      const returnsRows = /^select/i.test(text) || /returning/i.test(text);
      const run = async (statement: string) => {
        const r = await session.query(statement);
        if (r.error) throw Object.assign(new Error(`SQL failed [${r.sqlstate}]`), { code: r.sqlstate });
        return r.rows;
      };
      if (!returnsRows) {
        await run(text);
        return [];
      }
      const rows = await run(/^select/i.test(text) && /\bfrom\s+iam\.\w+\(/i.test(text)
        ? `SELECT row_to_json(q)::text FROM (${text}) q` : `WITH q AS (${text}) SELECT row_to_json(q)::text FROM q`);
      return rows.map(([json]): Record<string, string | null> => JSON.parse(json ?? "{}"));
    },
    async transaction(work) {
      await session.ok('BEGIN');
      try {
        const result = await work(executor);
        await session.ok('COMMIT');
        return result;
      } catch (error) {
        await session.query('ROLLBACK');
        throw error;
      }
    },
  };
  return executor;
}

describe.skipIf(!enabled)('P-4e provisioning as talo_provisioner (talo_mos_v4_test)', { timeout: 120_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let p: PsqlSession;
  let fx: AuthFixtures;
  let hasher: PasswordHasher;
  let pwnedDir: string;

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    if (!checkSmokeUrl(url).ok) throw new Error('DATABASE_URL must target talo_app@talo_mos_v4_test');
    prisma = createPrismaClient(url ?? '');
    hasher = new PasswordHasher();
    await hasher.init();
    h = await AuthFixtures.connect();
    p = new PsqlSession('talo_provisioner');
    const [who] = await p.ok('SELECT current_user, current_database()');
    if (who?.[0] !== 'talo_provisioner' || who[1] !== 'talo_mos_v4_test') throw new Error('guard: provisioner session');
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    pwnedDir = await createPwnedFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });
  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    await p?.close();
    await h?.close();
    await prisma?.$disconnect();
    if (pwnedDir) await removePwnedFixture(pwnedDir);
    expect(remaining).toBe(0);
  });

  it('temporary passwords: 24 characters, CSPRNG over the decided alphabet, all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const value = generateTemporaryPassword();
      expect(value).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      for (const ch of value) expect(TEMPORARY_PASSWORD_ALPHABET).toContain(ch);
      seen.add(value);
    }
    expect(seen.size).toBe(2000);
  });

  it('provision → login with the temporary password → SAME_AS_CURRENT refused → new password → ACTIVE → relogin', async () => {
    const executor = psqlExecutor(p);
    const result = await provisionAccount(executor, hasher, {
      employeeCode: `${fx.runId}-P1`, fullName: 'Nhân viên cấp mới', username: `${fx.runId}-p1`.toLowerCase(), joinedAt: '2026-10-01',
    });
    fx.adopt(result.membershipId, result.userAccountId, result.username);
    expect(result.membershipCreated).toBe(true);

    const [row] = await h.ok(`SELECT a.account_status, c.must_change_password, c.password_hash LIKE '$argon2id$v=19$m=19456,t=2,p=1$%',
        position(${lit(result.temporaryPassword)} in c.password_hash) = 0, a.created_by_account_id IS NULL
      FROM iam.iam_user_accounts a JOIN iam.iam_credentials c ON c.user_account_id = a.user_account_id WHERE a.user_account_id = ${lit(result.userAccountId)}`);
    expect(row).toEqual(['PROVISIONED', 't', 't', 't', 't']);
    const audit = await h.ok(`SELECT action_code, outcome, metadata::text FROM iam.iam_audit_logs WHERE target_id = ${lit(result.userAccountId)}`);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.[0]).toBe('ACCOUNT_PROVISIONED');
    expect(audit[0]?.[2]).not.toContain(result.temporaryPassword);

    const auth = await createAuthModule({ prisma, logger: silentLogger, production: false, hasher,
      breachedPasswords: await PwnedPasswordsStore.open(pwnedDir, { production: false }) });
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: silentLogger, apiRouters: [auth.router] });
    const post = (path: string, body: unknown, cookie?: string) => {
      const req = request(app).post(path).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', fx.userAgent);
      return (cookie ? req.set('Cookie', cookie) : req).send(JSON.stringify(body));
    };
    const first = await post('/api/auth/login', { username: result.username, password: result.temporaryPassword });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PASSWORD_CHANGE_REQUIRED');
    const cookie = String(first.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const same = await post('/api/auth/password/first-change', { newPassword: result.temporaryPassword }, cookie);
    expect(same.status).toBe(400);
    expect(same.body.error.details).toEqual({ reason: 'SAME_AS_CURRENT' });
    expect((await post('/api/auth/password/first-change', { newPassword: 'mua thu ha noi co nang vang' }, cookie)).status).toBe(200);
    const relogin = await post('/api/auth/login', { username: result.username, password: 'mua thu ha noi co nang vang' });
    expect(relogin.body.status).toBe('AUTHENTICATED');
    expect((await post('/api/auth/login', { username: result.username, password: result.temporaryPassword })).status).toBe(401);
  });

  it('refuses a duplicate username or a membership that already has a current account, writing nothing', async () => {
    const executor = psqlExecutor(p);
    const ok = await provisionAccount(executor, hasher, { employeeCode: `${fx.runId}-P2`, fullName: 'Nhân viên 2', username: `${fx.runId}-p2`.toLowerCase(), joinedAt: '2026-10-01' });
    fx.adopt(ok.membershipId, ok.userAccountId, ok.username);
    const count = async () => (await h.ok(`SELECT (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${fx.runId}-%`)}) + (SELECT count(*) FROM iam.iam_user_accounts WHERE username ILIKE ${lit(`${fx.runId}-%`)})`))[0]?.[0];
    const before = await count();
    await expect(provisionAccount(executor, hasher, { employeeCode: `${fx.runId}-P3`, fullName: 'X', username: ok.username.toUpperCase(), joinedAt: '2026-10-01' }))
      .rejects.toThrow(/username already exists/);
    await expect(provisionAccount(executor, hasher, { employeeCode: `${fx.runId}-P2`, fullName: 'X', username: `${fx.runId}-p4`.toLowerCase(), joinedAt: '2026-10-01' }))
      .rejects.toThrow(/already has a current account/);
    await expect(provisionAccount(executor, hasher, { employeeCode: 'x', fullName: 'X', username: 'has space', joinedAt: '2026-10-01' })).rejects.toBeInstanceOf(ProvisioningError);
    expect(await count()).toBe(before);
  });

  it('decision holds: talo_provisioner has NO direct UPDATE / lock on IAM (EXPLAIN only, READ ONLY)', async () => {
    const nil = '00000000-0000-0000-0000-000000000000';
    const probes: [string, string][] = [
      ['account row lock', `SELECT 1 FROM iam.iam_user_accounts WHERE user_account_id = '${nil}' FOR NO KEY UPDATE`],
      ['credential update', `UPDATE iam.iam_credentials SET must_change_password = true WHERE user_account_id = '${nil}'`],
      ['session revoke', `UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE user_account_id = '${nil}'`],
      ['audit insert', `INSERT INTO iam.iam_audit_logs (action_code, target_type, outcome) VALUES ('X', 'X', 'SUCCESS')`],
    ];
    const outcome: Record<string, string> = {};
    for (const [name, sql] of probes) {
      await p.ok('BEGIN READ ONLY');
      const r = await p.query(`EXPLAIN ${sql}`);
      await p.query('ROLLBACK');
      outcome[name] = r.error ? `DENIED ${r.sqlstate}` : 'ALLOWED';
    }
    console.log(`[P-4e reissue] talo_provisioner direct: ${JSON.stringify(outcome)}`);
    expect(outcome).toEqual({ 'account row lock': 'DENIED 42501', 'credential update': 'DENIED 42501', 'session revoke': 'DENIED 42501', 'audit insert': 'ALLOWED' });
  });

  it('client against the database as talo_provisioner: clear refusal while the SECURITY DEFINER function is not installed', async () => {
    const [installed] = await p.ok(`SELECT to_regprocedure('${REISSUE_FUNCTION_SIGNATURE}') IS NOT NULL`);
    if (installed?.[0] === 't') return; // covered by the next test once installed
    const operator = await fx.create();
    await expect(reissueTemporaryPassword(psqlExecutor(p), hasher, { username: 'anyone', operatorAccountId: operator.accountId }))
      .rejects.toThrow(/recovery function is not installed .*42883/);
    await expect(reissueTemporaryPassword(psqlExecutor(p), hasher, { username: 'anyone', operatorAccountId: 'not-a-uuid' }))
      .rejects.toThrow(/operator account id must be a UUID/);
  });

  it('re-issue through iam.reissue_temporary_credential as talo_provisioner (runs only once the approved function is installed)', async (ctx) => {
    const [installed] = await p.ok(`SELECT to_regprocedure('${REISSUE_FUNCTION_SIGNATURE}') IS NOT NULL`);
    if (installed?.[0] !== 't') ctx.skip();
    const operator = await fx.create(); // ACTIVE account of the IT operator
    const created = await provisionAccount(psqlExecutor(p), hasher, {
      employeeCode: `${fx.runId}-R1`, fullName: 'Nhân viên cấp lại', username: `${fx.runId}-r1`.toLowerCase(), joinedAt: '2026-10-01',
    });
    fx.adopt(created.membershipId, created.userAccountId, created.username);
    const auth = await createAuthModule({ prisma, logger: silentLogger, production: false, hasher,
      breachedPasswords: await PwnedPasswordsStore.open(pwnedDir, { production: false }) });
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: silentLogger, apiRouters: [auth.router] });
    const post = (path: string, body: unknown, cookie?: string) => {
      const req = request(app).post(path).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', fx.userAgent);
      return (cookie ? req.set('Cookie', cookie) : req).send(JSON.stringify(body));
    };
    const cookieOf = (res: { headers: Record<string, unknown> }) => { const c = res.headers['set-cookie']; return (Array.isArray(c) ? String(c[0] ?? '') : '').split(';')[0] ?? ''; };
    const personal = 'mua thu ha noi co nang vang';
    const activation = cookieOf(await post('/api/auth/login', { username: created.username, password: created.temporaryPassword }));
    expect((await post('/api/auth/password/first-change', { newPassword: personal }, activation)).status).toBe(200);
    const live = cookieOf(await post('/api/auth/login', { username: created.username, password: personal }));

    const reissued = await reissueTemporaryPassword(psqlExecutor(p), hasher, { username: created.username.toUpperCase(), operatorAccountId: operator.accountId });
    expect(reissued.revokedSessions).toBe(1);
    expect((await request(app).get('/api/auth/session').set('Cookie', live)).status).toBe(401);
    expect((await post('/api/auth/login', { username: created.username, password: personal })).status).toBe(401);
    const again = await post('/api/auth/login', { username: created.username, password: reissued.temporaryPassword });
    expect(again.body.status).toBe('PASSWORD_CHANGE_REQUIRED');
    const [audit] = await h.ok(`SELECT actor_account_id::text, metadata::text FROM iam.iam_audit_logs WHERE target_id = ${lit(created.userAccountId)} AND action_code = 'CREDENTIAL_REISSUED'`);
    expect(audit?.[0]).toBe(operator.accountId);
    expect(audit?.[1]).not.toContain('argon2');
    expect(audit?.[1]).not.toContain(reissued.temporaryPassword);
    const refuse = (username: string, operatorAccountId: string) => reissueTemporaryPassword(psqlExecutor(p), hasher, { username, operatorAccountId });
    await expect(refuse(`${fx.runId}-missing`, operator.accountId)).rejects.toThrow(/account not found/);
    await expect(refuse(operator.username, operator.accountId)).rejects.toThrow(/TA403/); // self-recovery
    const disabled = await fx.create({ accountStatus: 'DISABLED' });
    await expect(refuse(disabled.username, operator.accountId)).rejects.toThrow(/TA409/);
    await expect(refuse(created.username, disabled.accountId)).rejects.toThrow(/TA401/); // operator not eligible
  });
});
