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
import type { AuthRepository } from '../../../src/modules/auth/auth.repository.js';
import type { AuthTestHooks } from '../../../src/modules/auth/auth.service.js';
import type { AuthSettings } from '../../../src/modules/auth/auth.settings.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { LOCAL_ARGON2_OPTIONS, PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { PwnedPasswordsStore, UnavailableBlocklist } from '../../../src/modules/auth/pwnedPasswords.js';
import type { BreachedPasswordChecker } from '../../../src/modules/auth/pwnedPasswords.js';
import { createPwnedFixture, removePwnedFixture } from '../../support/pwnedFixture.js';
import { sqlstateOf } from '../../../src/modules/auth/sqlstate.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import type { AuthFixtureOptions } from '../../support/authFixtures.js';
import { PsqlSession, lit } from '../sc5/harness.js';

// AUTH-IMPLEMENTATION-E2E — API runtime verification on PostgreSQL (talo_mos_v4_test).
// Runs only with TALO_AUTH_DB=1. API under test: the real Express app + auth module as talo_app (DATABASE_URL).
// Fixtures / inspection / writer simulation: talo_test_harness. Every test deletes exactly its own rows afterwards.

const enabled = process.env['TALO_AUTH_DB'] === '1';
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class CountingHasher extends PasswordHasher {
  real = 0;
  dummy = 0;
  override async verifyPassword(stored: string | null, password: string): Promise<boolean> {
    if (stored === null) this.dummy++;
    else this.real++;
    return super.verifyPassword(stored, password);
  }
  get total(): number {
    return this.real + this.dummy;
  }
}

function sqlError(code: string): Error {
  return Object.assign(new Error(`injected ${code}`), { code });
}

interface Fingerprint {
  readonly status: number;
  readonly headers: Record<string, unknown>;
  readonly body: string;
}

// INV-10 normalisation: requestId / X-Request-Id replaced by a placeholder (accepted to differ), Date removed.
function fingerprint(res: Response): Fingerprint {
  const headers: Record<string, unknown> = { ...res.headers };
  const rid = headers['x-request-id'];
  expect(rid).toMatch(UUID_V4);
  delete headers['x-request-id'];
  delete headers.date;
  delete headers.connection;
  delete headers['keep-alive'];
  const body: { error: { requestId: string } } = JSON.parse(res.text);
  expect(body.error.requestId).toBe(rid);
  body.error.requestId = '<request-id>';
  return { status: res.status, headers, body: JSON.stringify(body) };
}

describe.skipIf(!enabled)('AUTH API runtime — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let w: PsqlSession;
  let fx: AuthFixtures;
  let hasher: CountingHasher;
  let pwnedDir: string;
  let pwned: BreachedPasswordChecker;
  const deletedTotals: Record<string, number> = {};
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });

  interface AppOptions {
    readonly settings?: Partial<AuthSettings>;
    readonly hooks?: AuthTestHooks;
    readonly wrap?: (repository: AuthRepository) => AuthRepository;
    readonly hasher?: PasswordHasher;
    readonly limit?: number;
    readonly breached?: BreachedPasswordChecker;
  }
  async function makeApp(options: AppOptions = {}): Promise<Express> {
    const auth = await createAuthModule({
      prisma, logger, production: false, hasher: options.hasher ?? hasher, breachedPasswords: options.breached ?? pwned,
      loginLimiter: new SlidingWindowRateLimiter({ limit: options.limit ?? 10_000, windowMs: 15 * 60_000 }),
      ...(options.settings ? { settings: options.settings } : {}),
      ...(options.hooks ? { hooks: options.hooks } : {}),
      ...(options.wrap ? { wrapRepository: options.wrap } : {}),
    });
    return createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router] });
  }

  const post = (app: Express, path: string, body: unknown, cookie?: string, ua?: string) => {
    const req = request(app).post(path).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', ua ?? fx.userAgent);
    return (cookie ? req.set('Cookie', cookie) : req).send(JSON.stringify(body));
  };
  // Records the X-Request-Id of attempts with a non-fixture username: one of the audit ownership factors for cleanup.
  const login = async (app: Express, username: string, password: string, ua?: string): Promise<Response> => {
    const res = await post(app, '/api/auth/login', { username, password }, undefined, ua);
    if (!fx.isFixtureUsername(username)) fx.registerUnknownAttempt(res.headers['x-request-id']);
    return res;
  };
  const getSession = (app: Express, cookie?: string) => {
    const req = request(app).get('/api/auth/session').set('User-Agent', fx.userAgent);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const firstChange = (app: Express, cookie: string, newPassword: string) => post(app, '/api/auth/password/first-change', { newPassword }, cookie);
  const logout = (app: Express, cookie?: string) => post(app, '/api/auth/logout', {}, cookie);
  const cookieOf = (res: Response): string => {
    const header = res.headers['set-cookie'];
    const first = Array.isArray(header) ? header[0] : undefined;
    const value = first?.split(';')[0];
    if (!value || !value.startsWith('talo_sid=') || value === 'talo_sid=') throw new Error('no session cookie');
    return value;
  };
  const create = (options?: AuthFixtureOptions) => fx.create(options);
  const wrongPw = 'definitely the wrong password';

  async function credential(accountId: string) {
    const [row] = await h.ok(`SELECT failed_attempt_count, (locked_until IS NOT NULL AND locked_until > statement_timestamp()),
      extract(epoch FROM (locked_until - statement_timestamp()))::int, password_hash, updated_at::text, must_change_password
      FROM iam.iam_credentials WHERE user_account_id = ${lit(accountId)}`);
    return { c: Number(row?.[0]), locked: row?.[1] === 't', lockSeconds: Number(row?.[2] ?? 0), hash: row?.[3] ?? '', version: row?.[4] ?? '', mustChange: row?.[5] === 't' };
  }
  async function sessions(accountId: string) {
    const rows = await h.ok(`SELECT session_id, (revoked_at IS NULL AND expires_at > statement_timestamp()), assurance_level_snapshot,
      extract(epoch FROM (expires_at - created_at))::int, (last_seen_at = created_at)
      FROM iam.iam_sessions WHERE user_account_id = ${lit(accountId)} ORDER BY created_at`);
    return rows.map((r) => ({ id: r[0] ?? '', live: r[1] === 't', level: Number(r[2]), ttl: Number(r[3]), seenAtCreate: r[4] === 't' }));
  }
  async function audits(accountId: string) {
    const rows = await h.ok(`SELECT action_code, outcome, metadata->>'reason', metadata::text FROM iam.iam_audit_logs
      WHERE target_id = ${lit(accountId)} OR actor_account_id = ${lit(accountId)} ORDER BY occurred_at, audit_id`);
    return rows.map((r) => ({ action: r[0] ?? '', outcome: r[1] ?? '', reason: r[2] ?? '', metadata: r[3] ?? '' }));
  }

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [identity] = await prisma.$queryRawUnsafe<{ db: string; usr: string }[]>('SELECT current_database() AS db, current_user AS usr');
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app') throw new Error('guard: API must run as talo_app on talo_mos_v4_test');
    hasher = new CountingHasher();
    await hasher.init();
    pwnedDir = await createPwnedFixture();
    pwned = await PwnedPasswordsStore.open(pwnedDir, { production: false });
    h = await AuthFixtures.connect();
    w = new PsqlSession();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
  });

  afterEach(async () => {
    const deleted = await fx.cleanup();
    for (const [k, v] of Object.entries(deleted)) deletedTotals[k] = (deletedTotals[k] ?? 0) + v;
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    console.log(`[auth-db] run ${fx?.runId} deleted ${JSON.stringify(deletedTotals)} remaining ${remaining}`);
    await w?.close();
    await h?.close();
    await prisma?.$disconnect();
    if (pwnedDir) await removePwnedFixture(pwnedDir);
    expect(remaining).toBe(0);
  });

  // ------------------------------------------------------------------ login

  it('CT-L1: active account, correct password → 200 AUTHENTICATED, exact cookie flags, 10 h session on DB time', async () => {
    const app = await makeApp();
    const acc = await create();
    const res = await login(app, acc.username.toUpperCase(), acc.password); // case-insensitive username
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'AUTHENTICATED', assuranceLevel: 1, account: { userAccountId: acc.accountId, username: acc.username, fullName: acc.fullName } });
    expect(Date.parse(res.body.expiresAt) - Date.parse(res.body.serverTime)).toBeGreaterThan(10 * 3600_000 - 2000);
    const header = res.headers['set-cookie'];
    expect(header).toHaveLength(1);
    expect(header?.[0]).toMatch(/^talo_sid=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/);
    const [session] = await sessions(acc.accountId);
    expect(session).toMatchObject({ live: true, level: 1, ttl: 36_000, seenAtCreate: true });
    expect(await audits(acc.accountId)).toEqual([expect.objectContaining({ action: 'LOGIN', outcome: 'SUCCESS', reason: 'OK' })]);
  });

  it('CT-L2: provisioned account → 200 PASSWORD_CHANGE_REQUIRED, activation session 15 min', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const res = await login(app, acc.username, acc.password);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PASSWORD_CHANGE_REQUIRED', account: { username: acc.username }, expiresAt: expect.any(String), serverTime: expect.any(String) });
    expect(Date.parse(res.body.expiresAt) - Date.parse(res.body.serverTime)).toBeGreaterThan(15 * 60_000 - 2000);
    expect(Date.parse(res.body.expiresAt) - Date.parse(res.body.serverTime)).toBeLessThanOrEqual(15 * 60_000);
    expect(await sessions(acc.accountId)).toEqual([expect.objectContaining({ live: true, level: 0, ttl: 900 })]);
  });

  it('CT-L3 / INV-10: every 401 branch is identical after normalising requestId; one Argon2 verification each', async () => {
    const results: Record<string, Fingerprint> = {};
    const verifies: Record<string, number> = {};
    const run = async (name: string, app: Express, username: string, password: string) => {
      const before = hasher.total;
      const res = await login(app, username, password);
      verifies[name] = hasher.total - before;
      expect(res.status, name).toBe(401);
      expect(res.body.error.code, name).toBe('INVALID_CREDENTIALS');
      expect(res.headers['set-cookie'], name).toBeUndefined();
      expect(res.headers['retry-after'], name).toBeUndefined();
      results[name] = fingerprint(res);
    };
    const app = await makeApp();
    await run('unknown username', app, `${fx.runId}-nobody`, 'some password');
    const noCred = await create({ withCredential: false });
    await run('no credential', app, noCred.username, 'some password');
    const a = await create();
    await run('wrong password', app, a.username, wrongPw);
    const b = await create();
    for (let i = 0; i < 4; i++) await login(app, b.username, wrongPw);
    await run('slot-5 failure (lock triggered)', app, b.username, wrongPw);
    await run('temporarily locked (no slot)', app, b.username, wrongPw);
    await run('locked, correct password', app, b.username, b.password);

    // Credential changed between RESERVE and SUCCESS (harness changes the hash right after RESERVE).
    const c = await create();
    const changedApp = await makeApp({
      wrap: (repo) => ({ ...bind(repo), reserve: async (id, s) => {
        const r = await repo.reserve(id, s);
        if (id === c.accountId) await h.ok(`UPDATE iam.iam_credentials SET password_hash = password_hash || 'x', updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond') WHERE user_account_id = ${lit(c.accountId)}`);
        return r;
      } }),
    });
    await run('credential changed', changedApp, c.username, c.password);

    // Attempt deadline exceeded (D shortened to 1 s in-process; SUCCESS starts 1.3 s after RESERVE).
    const d = await create();
    const slowApp = await makeApp({ settings: { attemptDeadline: '1 second' }, wrap: (repo) => ({ ...bind(repo), loginSuccess: async (...args) => { await sleep(1300); return repo.loginSuccess(...args); } }) });
    await run('attempt expired', slowApp, d.username, d.password);
    expect((await credential(d.accountId)).c).toBe(1); // no reset

    // Stale SUCCESS on a newer locked cycle (another writer locks + bumps the version after this RESERVE).
    const e = await create();
    const staleApp = await makeApp({
      wrap: (repo) => ({ ...bind(repo), reserve: async (id, s) => {
        const r = await repo.reserve(id, s);
        if (id === e.accountId) await h.ok(`UPDATE iam.iam_credentials SET locked_until = statement_timestamp() + interval '15 minutes', updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond') WHERE user_account_id = ${lit(e.accountId)}`);
        return r;
      } }),
    });
    await run('stale success on locked cycle', staleApp, e.username, e.password);
    expect((await credential(e.accountId)).locked).toBe(true); // not unlocked
    expect(await sessions(e.accountId)).toEqual([]);

    const reference = results['unknown username'];
    for (const [name, fp] of Object.entries(results)) expect(fp, name).toEqual(reference);
    for (const [name, n] of Object.entries(verifies)) expect(n, name).toBe(1);
    console.log(`[INV-10] ${Object.keys(results).length} branches identical after normalisation: ${Object.keys(results).join(', ')}`);
  });

  it('INV-10 / IB-2: timing distribution per branch (measured and reported, not asserted)', async () => {
    const app = await makeApp();
    const samples = 25;
    const known = await create();
    const noCred = await create({ withCredential: false });
    const locked = await create();
    for (let i = 0; i < 5; i++) await login(app, locked.username, wrongPw);
    // prepare() runs outside the timed region (keeps the wrong-password cycle open by expiring the lock).
    const reopen = () => h.ok(`UPDATE iam.iam_credentials SET locked_until = statement_timestamp() - interval '1 second', updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond') WHERE user_account_id = ${lit(known.accountId)} AND failed_attempt_count >= 4`);
    const branches: Record<string, { prepare?: () => Promise<unknown>; run: () => Promise<Response> }> = {
      'unknown username': { run: () => login(app, `${fx.runId}-nobody`, wrongPw) },
      'no credential': { run: () => login(app, noCred.username, wrongPw) },
      'locked (no slot)': { run: () => login(app, locked.username, wrongPw) },
      'wrong password (slot granted)': { prepare: reopen, run: () => login(app, known.username, wrongPw) },
    };
    const report: string[] = [];
    const stats: Record<string, { median: number; p90: number }> = {};
    for (let round = 0; round < 3; round++) await branches['unknown username']?.run(); // warm-up
    for (const [name, branch] of Object.entries(branches)) {
      const times: number[] = [];
      for (let i = 0; i < samples; i++) {
        await branch.prepare?.();
        const start = performance.now();
        const res = await branch.run();
        times.push(performance.now() - start);
        expect(res.status).toBe(401);
      }
      times.sort((x, y) => x - y);
      const median = times[Math.floor(samples / 2)] ?? 0;
      const p90 = times[Math.floor(samples * 0.9)] ?? 0;
      stats[name] = { median, p90 };
      report.push(`${name}: median ${median.toFixed(1)} ms, p90 ${p90.toFixed(1)} ms, min ${(times[0] ?? 0).toFixed(1)}, max ${(times[samples - 1] ?? 0).toFixed(1)}`);
    }
    console.log(`[IB-2 timing, ${samples} samples/branch]\n  ${report.join('\n  ')}`);
    expect(Object.keys(stats)).toHaveLength(4);
  });

  it('CT-L4 / AD-5: 5 wrong → lock 15 min (DB time); 6th refused without real verification; correct 5th logs in and resets', async () => {
    const app = await makeApp();
    const a = await create();
    for (let i = 1; i <= 5; i++) expect((await login(app, a.username, wrongPw)).status).toBe(401);
    const locked = await credential(a.accountId);
    expect(locked).toMatchObject({ c: 5, locked: true });
    expect(locked.lockSeconds).toBeGreaterThan(895);
    expect(locked.lockSeconds).toBeLessThanOrEqual(900);
    const realBefore = hasher.real;
    expect((await login(app, a.username, a.password)).status).toBe(401); // correct password while locked
    expect(hasher.real).toBe(realBefore); // dummy only (INV-5)
    expect((await audits(a.accountId)).map((x) => x.reason)).toEqual(['BAD_PASSWORD', 'BAD_PASSWORD', 'BAD_PASSWORD', 'BAD_PASSWORD', 'LOCK_TRIGGERED', 'TEMP_LOCKED']);
    // Lock expiry (simulated by moving locked_until into the past): a new cycle starts at slot 1.
    await h.ok(`UPDATE iam.iam_credentials SET locked_until = statement_timestamp() - interval '1 second', updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond') WHERE user_account_id = ${lit(a.accountId)}`);
    expect((await login(app, a.username, a.password)).status).toBe(200);
    expect(await credential(a.accountId)).toMatchObject({ c: 0, locked: false });

    const b = await create();
    for (let i = 0; i < 4; i++) await login(app, b.username, wrongPw);
    expect((await login(app, b.username, b.password)).status).toBe(200); // INV-3
    expect(await credential(b.accountId)).toMatchObject({ c: 0, locked: false });
  });

  it('CT-L5 / AD-3: ineligible with the correct password → 403; with a wrong password → the uniform 401', async () => {
    const app = await makeApp();
    const unknown = fingerprint(await login(app, `${fx.runId}-nobody`, wrongPw));
    for (const options of [{ membershipStatus: 'EXITED' }, { leftAt: 'today' }, { accountStatus: 'LOCKED' }, { accountStatus: 'DISABLED' }] as const) {
      const acc = await create(options);
      const ok = await login(app, acc.username, acc.password);
      expect(ok.status, JSON.stringify(options)).toBe(403);
      expect(ok.body.error.code).toBe('ACCOUNT_NOT_ALLOWED');
      expect(ok.headers['set-cookie']).toBeUndefined();
      expect(fingerprint(await login(app, acc.username, wrongPw))).toEqual(unknown);
    }
    for (const options of [{ membershipStatus: 'ON_LEAVE' }, { leftAt: 'tomorrow' }] as const) {
      const acc = await create(options);
      expect((await login(app, acc.username, acc.password)).status, JSON.stringify(options)).toBe(200);
    }
  });

  it('CT-L8: 10 parallel wrong logins → exactly 5 real verifications, one lock; 4 wrong + 1 correct in parallel never break H-b', async () => {
    const app = await makeApp();
    const a = await create();
    const realBefore = hasher.real;
    const results = await Promise.all(Array.from({ length: 10 }, () => login(app, a.username, wrongPw)));
    expect(results.every((r) => r.status === 401)).toBe(true);
    expect(hasher.real - realBefore).toBe(5);
    expect(await credential(a.accountId)).toMatchObject({ c: 5, locked: true });

    for (let round = 0; round < 8; round++) {
      const b = await create();
      const before = hasher.real;
      const all = await Promise.all([...Array.from({ length: 4 }, () => login(app, b.username, wrongPw)), login(app, b.username, b.password)]);
      const state = await credential(b.accountId);
      const correct = all[4];
      expect(hasher.real - before).toBeLessThanOrEqual(5);
      expect(state.c).toBeLessThanOrEqual(5);
      const live = (await sessions(b.accountId)).filter((s) => s.live);
      if (correct?.status === 200) expect(live).toHaveLength(1);
      else expect(live).toHaveLength(0);
    }
  });

  it('CT-L10 / IB-1: database errors before proof of the password answer the same for existing and unknown usernames', async () => {
    const acc = await create();
    for (const point of ['lookup', 'reserve', 'insertAudit'] as const) {
      const app = await makeApp({ wrap: (repo) => ({ ...bind(repo), [point]: async () => { throw sqlError('08006'); } }) });
      const existing = await login(app, acc.username, wrongPw);
      const unknown = await login(app, `${fx.runId}-nobody`, wrongPw);
      expect(existing.status, point).toBe(500);
      expect(existing.body.error.code).toBe('INTERNAL_ERROR');
      expect(fingerprint(existing), point).toEqual(fingerprint(unknown));
    }
  });

  it('IB-3: a full Argon2 queue answers 503 alike for every username; a reserved slot is not refunded', async () => {
    const slow = new CountingHasher({ ...LOCAL_ARGON2_OPTIONS, timeCost: 120 }, { maxConcurrent: 1, maxQueued: 0, queueTimeoutMs: 1 });
    await slow.init();
    const app = await makeApp({ hasher: slow });
    const acc = await create();
    const occupying = slow.hashPassword('occupy the only hashing slot');
    const existing = await login(app, acc.username, wrongPw);
    const unknown = await login(app, `${fx.runId}-nobody`, wrongPw);
    await occupying;
    expect(existing.status).toBe(503);
    expect(existing.body.error.code).toBe('SERVICE_BUSY');
    expect(fingerprint(existing)).toEqual(fingerprint(unknown));
    expect((await credential(acc.accountId)).c).toBe(1); // slot consumed, no refund
  });

  // ------------------------------------------------------------------ first change / sessions

  it('CT-F1 + flow: provisioned → activation → first change → relogin → authenticated → logout', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const activation = await login(app, acc.username, acc.password);
    const cookie = cookieOf(activation);
    const described = await getSession(app, cookie);
    expect(described.body).toMatchObject({ status: 'PASSWORD_CHANGE_REQUIRED', account: { username: acc.username } });
    const newPassword = 'mua thu ha noi co nang vang';
    const changed = await firstChange(app, cookie, newPassword);
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ status: 'PASSWORD_CHANGED_RELOGIN' });
    expect(changed.headers['set-cookie']).toEqual(['talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/']);
    expect((await getSession(app, cookie)).status).toBe(401); // activation session revoked (V1)
    const [account] = await h.ok(`SELECT account_status, activated_at IS NOT NULL FROM iam.iam_user_accounts WHERE user_account_id = ${lit(acc.accountId)}`);
    expect(account).toEqual(['ACTIVE', 't']);
    expect(await credential(acc.accountId)).toMatchObject({ mustChange: false, c: 0 });
    expect((await sessions(acc.accountId)).every((s) => !s.live)).toBe(true);
    expect((await login(app, acc.username, acc.password)).status).toBe(401); // old temporary password
    const relogin = await login(app, acc.username, newPassword);
    expect(relogin.status).toBe(200);
    expect(relogin.body.status).toBe('AUTHENTICATED');
    const authCookie = cookieOf(relogin);
    const session = await getSession(app, authCookie);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ status: 'AUTHENTICATED', assuranceLevel: 1, account: { username: acc.username, fullName: acc.fullName } });
    expect(Date.parse(session.body.idleExpiresAt) - Date.parse(session.body.serverTime)).toBeGreaterThan(59 * 60_000);
    expect((await logout(app, authCookie)).status).toBe(204);
    expect((await getSession(app, authCookie)).status).toBe(401);
    const trail = (await audits(acc.accountId)).map((x) => `${x.action}/${x.outcome}/${x.reason}`);
    expect(trail).toEqual(expect.arrayContaining(['LOGIN/SUCCESS/PASSWORD_CHANGE_REQUIRED', 'CHANGE_PASSWORD/SUCCESS/OK', 'ACCOUNT_ACTIVATED/SUCCESS/OK', 'LOGIN/FAILURE/BAD_PASSWORD', 'LOGIN/SUCCESS/OK', 'LOGOUT/SUCCESS/OK']));
  });

  it('CT-F2: policy violations → 400 PASSWORD_POLICY with details.reason; no entry disclosed; audited', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    const cases: [string, string, Record<string, unknown>][] = [
      ['short', 'TOO_SHORT', { reason: 'TOO_SHORT', minLength: 15 }],
      ['x'.repeat(129), 'TOO_LONG', { reason: 'TOO_LONG', maxLength: 128 }],
      ['a long phrase with\u007Fdel inside', 'CONTROL_CHARACTERS', { reason: 'CONTROL_CHARACTERS' }],
      ['MATKHAUMOI123456', 'BLOCKLISTED', { reason: 'BLOCKLISTED' }],
      [`${acc.username.toUpperCase()}123`, 'CONTEXT_MATCH', { reason: 'CONTEXT_MATCH' }],
      [acc.password, 'SAME_AS_CURRENT', { reason: 'SAME_AS_CURRENT' }],
    ];
    for (const [pw, reason, details] of cases) {
      const res = await firstChange(app, cookie, pw);
      expect(res.status, reason).toBe(400);
      expect(res.body.error.code).toBe('PASSWORD_POLICY');
      expect(res.body.error.details).toEqual(details);
      expect(res.text.toLowerCase()).not.toContain('matkhaumoi');
    }
    for (const body of [{ newPassword: 5 }, { newPassword: 'x'.repeat(20), other: 1 }, {}]) {
      const res = await post(app, '/api/auth/password/first-change', body, cookie);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const policies = (await audits(acc.accountId)).filter((x) => x.reason === 'POLICY_VIOLATION').map((x) => JSON.parse(x.metadata).policy);
    expect(policies).toEqual(['TOO_SHORT', 'TOO_LONG', 'CONTROL_CHARACTERS', 'BLOCKLISTED', 'CONTEXT_MATCH', 'SAME_AS_CURRENT']);
    expect(await credential(acc.accountId)).toMatchObject({ mustChange: true });
    expect((await getSession(app, cookie)).status).toBe(200); // session still valid after policy errors
  });

  it('blocklist (HIBP offline): breached spellings refused with BLOCKLISTED; missing dataset fails closed with 503 and changes nothing', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    for (const breached of ['matkhaumoi123456', 'MATKHAUMOI123456', 'passwordpassword1', 'Correct Horse Battery']) {
      const res = await firstChange(app, cookie, breached);
      expect(res.status, breached).toBe(400);
      expect(res.body.error.details).toEqual({ reason: 'BLOCKLISTED' });
    }
    const valid = await firstChange(app, cookie, 'mua thu ha noi co nang vang');
    expect(valid.status).toBe(200);

    const noBlocklist = await makeApp({ breached: new UnavailableBlocklist('not configured') });
    const other = await create({ accountStatus: 'PROVISIONED' });
    const otherCookie = cookieOf(await login(noBlocklist, other.username, other.password));
    const before = await credential(other.accountId);
    const refused = await firstChange(noBlocklist, otherCookie, 'mua thu ha noi co nang vang');
    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe('SERVICE_BUSY');
    expect(await credential(other.accountId)).toEqual(before);
    expect((await getSession(noBlocklist, otherCookie)).status).toBe(200);
    expect(logs.some((line) => line.includes('password blocklist unavailable'))).toBe(true);
  });

  it('CT-F3: two first-change requests in parallel → exactly one 200, the other 401; one new hash', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    const [p1, p2] = ['first parallel password ok', 'second parallel password ok'];
    const results = await Promise.all([firstChange(app, cookie, p1), firstChange(app, cookie, p2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const winner = results[0]?.status === 200 ? p1 : p2;
    const loser = winner === p1 ? p2 : p1;
    expect((await login(app, acc.username, winner)).status).toBe(200);
    expect((await login(app, acc.username, loser)).status).toBe(401);
  });

  it('CT-F5 / CT-F6: activation older than its TTL → 401 (ACTIVATION_EXPIRED); Authenticated Session → 403 NOT_REQUIRED', async () => {
    const shortApp = await makeApp({ settings: { activationTtl: '2 seconds' } });
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const cookie = cookieOf(await login(shortApp, acc.username, acc.password));
    await sleep(2500);
    expect((await firstChange(shortApp, cookie, 'mua thu ha noi co nang vang')).status).toBe(401);
    expect((await audits(acc.accountId)).map((x) => `${x.action}/${x.reason}`)).toContain('SESSION_INVALIDATED/ACTIVATION_EXPIRED');

    const app = await makeApp();
    const active = await create();
    const authCookie = cookieOf(await login(app, active.username, active.password));
    const res = await firstChange(app, authCookie, 'mua thu ha noi co nang vang');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_REQUIRED');
  });

  it('CT-S2: idle 61 min and absolute expiry → 401 with cleared cookie and SESSION_INVALIDATED audit; touch at most once per minute', async () => {
    const app = await makeApp();
    const acc = await create();
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    const [s] = await sessions(acc.accountId);
    const seen = async () => (await h.ok(`SELECT last_seen_at::text FROM iam.iam_sessions WHERE session_id = ${lit(s?.id ?? '')}`))[0]?.[0];
    const first = await seen();
    expect((await getSession(app, cookie)).status).toBe(200);
    expect(await seen()).toBe(first); // < 1 min: not touched
    await prisma.$executeRawUnsafe(`UPDATE iam.iam_sessions SET last_seen_at = statement_timestamp() - interval '2 minutes' WHERE session_id = $1::uuid`, s?.id);
    expect((await getSession(app, cookie)).status).toBe(200);
    expect(await seen()).not.toBe(first); // touched
    await prisma.$executeRawUnsafe(`UPDATE iam.iam_sessions SET last_seen_at = statement_timestamp() - interval '61 minutes' WHERE session_id = $1::uuid`, s?.id);
    const idle = await getSession(app, cookie);
    expect(idle.status).toBe(401);
    expect(idle.headers['set-cookie']).toEqual(['talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/']);

    const shortApp = await makeApp({ settings: { sessionTtl: '2 seconds' } });
    const b = await create();
    const shortCookie = cookieOf(await login(shortApp, b.username, b.password));
    await sleep(2500);
    expect((await getSession(shortApp, shortCookie)).status).toBe(401);
    const reasons = [...await audits(acc.accountId), ...await audits(b.accountId)].filter((x) => x.action === 'SESSION_INVALIDATED').map((x) => x.reason);
    expect(reasons.sort()).toEqual(['SESSION_EXPIRED', 'SESSION_IDLE']);
  });

  it('CT-S3: writer protocol exits the membership → the next request is 401; a non-compliant writer is caught lazily', async () => {
    const app = await makeApp();
    const a = await create();
    const cookieA = cookieOf(await login(app, a.username, a.password));
    await w.ok('BEGIN');
    await w.ok(`SELECT user_account_id FROM iam.iam_user_accounts WHERE membership_id = ${lit(a.membershipId)} ORDER BY user_account_id FOR NO KEY UPDATE`);
    await w.ok(`UPDATE iam.iam_memberships SET membership_status = 'EXITED', left_at = (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date WHERE membership_id = ${lit(a.membershipId)}`);
    await w.ok(`UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE user_account_id = ${lit(a.accountId)} AND revoked_at IS NULL`);
    await w.ok('COMMIT');
    expect((await getSession(app, cookieA)).status).toBe(401);

    const b = await create();
    const cookieB = cookieOf(await login(app, b.username, b.password));
    await h.ok(`UPDATE iam.iam_memberships SET membership_status = 'EXITED' WHERE membership_id = ${lit(b.membershipId)}`); // no revoke
    expect((await getSession(app, cookieB)).status).toBe(401);
    expect((await audits(b.accountId)).map((x) => x.reason)).toContain('ELIGIBILITY_LOST');
  });

  it('CT-S4 / AS-1: a new activation login revokes the previous one; two live sessions while a change is pending → both refused', async () => {
    const app = await makeApp();
    const acc = await create({ accountStatus: 'PROVISIONED' });
    const first = cookieOf(await login(app, acc.username, acc.password));
    const second = cookieOf(await login(app, acc.username, acc.password));
    expect((await getSession(app, first)).status).toBe(401);
    expect((await getSession(app, second)).status).toBe(200);
    // AS-1 defence: a second live session inserted behind the protocol's back (talo_app INSERT, test only).
    await prisma.$executeRawUnsafe(`INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, assurance_level_snapshot, created_at, expires_at, last_seen_at)
      VALUES ($1::uuid, $2, 0, statement_timestamp(), statement_timestamp() + interval '15 minutes', statement_timestamp())`, acc.accountId, `${fx.runId}-extra-${Date.now()}`);
    expect((await getSession(app, second)).status).toBe(401);
    expect((await audits(acc.accountId)).map((x) => x.reason)).toContain('ACTIVATION_INVARIANT_VIOLATION');
  });

  it('CT-O1: logout revokes once and always answers 204', async () => {
    const app = await makeApp();
    const acc = await create();
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    expect((await logout(app, cookie)).status).toBe(204);
    expect((await logout(app, cookie)).status).toBe(204);
    expect((await getSession(app, cookie)).status).toBe(401);
    expect((await audits(acc.accountId)).filter((x) => x.action === 'LOGOUT')).toHaveLength(1);
  });

  it('CT-A1: audit metadata keys, 256-character ip/ua, no secrets or attempted usernames anywhere', async () => {
    const app = await makeApp();
    const acc = await create();
    const longUa = `${fx.userAgent} ${'U'.repeat(300)}`;
    await login(app, acc.username, wrongPw, longUa);
    const cookie = cookieOf(await login(app, acc.username, acc.password));
    await logout(app, cookie);
    await login(app, `${fx.runId}-attempted-name`, 'attempted secret value');
    const rows = await h.ok(`SELECT metadata::text FROM iam.iam_audit_logs WHERE target_id = ${lit(acc.accountId)} OR actor_account_id = ${lit(acc.accountId)} OR metadata->>'ua' = ${lit(fx.userAgent)}`);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const allowed = new Set(['v', 'reason', 'requestId', 'ip', 'ua', 'slot', 'policy']);
    for (const [text] of rows) {
      const meta = JSON.parse(text ?? '{}') as Record<string, unknown>;
      for (const key of Object.keys(meta)) expect(allowed.has(key), key).toBe(true);
      expect(String(meta.ua ?? '').length).toBeLessThanOrEqual(256);
      for (const secret of [acc.password, wrongPw, 'attempted secret value', `${fx.runId}-attempted-name`, cookie.slice(9), '$argon2id']) {
        expect(text).not.toContain(secret);
      }
    }
    const joined = logs.join('\n');
    for (const secret of [acc.password, wrongPw, cookie.slice(9)]) expect(joined).not.toContain(secret);
  });

  // ------------------------------------------------------------------ retries (40P01 / 40001)

  it('CT-R1: a REAL deadlock (40P01) in the SUCCESS transaction is retried once and the login succeeds', async () => {
    const acc = await create();
    let deadlocked = false;
    const app = await makeApp({
      wrap: (repo) => ({ ...bind(repo), loginSuccess: async (input, s, hooks) => {
        if (deadlocked) return repo.loginSuccess(input, s, hooks);
        // Harness takes the credential lock first, then asks for the account lock the SUCCESS tx holds → deadlock.
        await w.ok('BEGIN');
        await w.ok(`SELECT 1 FROM iam.iam_credentials WHERE user_account_id = ${lit(input.userAccountId)} FOR NO KEY UPDATE`);
        const tx = repo.loginSuccess(input, s, hooks);
        await sleep(300);
        const harnessSide = w.query(`SELECT 1 FROM iam.iam_user_accounts WHERE user_account_id = ${lit(input.userAccountId)} FOR NO KEY UPDATE`, 30_000);
        try {
          return await tx;
        } catch (error) {
          deadlocked = true;
          expect(sqlstateOf(error)).toBe('40P01'); // real SQLSTATE through Prisma + adapter-pg
          throw error;
        } finally {
          await harnessSide;
          await w.query('ROLLBACK');
        }
      } }),
    });
    const res = await login(app, acc.username, acc.password);
    expect(deadlocked).toBe(true);
    expect(res.status).toBe(200);
    expect((await sessions(acc.accountId)).filter((s) => s.live)).toHaveLength(1);
  });

  it('CT-R2: 40P01 twice (and a retry beyond D) → 503 SERVICE_BUSY, never 401; no session, no reset, one RESERVE, one Argon2', async () => {
    for (const variant of ['twice', 'beyond-deadline'] as const) {
      let reserves = 0;
      const acc = await create();
      await login(await makeApp(), acc.username, wrongPw); // counter at 1
      const app = await makeApp({
        ...(variant === 'beyond-deadline' ? { settings: { attemptDeadline: '1 second' } } : {}),
        wrap: (repo) => ({ ...bind(repo), reserve: async (id, s) => { reserves++; return repo.reserve(id, s); } }),
        hooks: { loginTx: (attempt) => ({ beforeCommit: async () => {
          if (variant === 'beyond-deadline') { await sleep(1200); if (attempt === 0) throw sqlError('40P01'); return; }
          throw sqlError(attempt === 0 ? '40P01' : '40001');
        } }) },
      });
      const before = hasher.total;
      const res = await login(app, acc.username, acc.password);
      expect(res.status, variant).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_BUSY');
      expect(hasher.total - before).toBe(1);
      expect(reserves).toBe(1);
      expect(await sessions(acc.accountId)).toEqual([]);
      expect((await credential(acc.accountId)).c).toBe(2); // not reset
      expect((await audits(acc.accountId)).map((x) => x.reason)).toContain('TRANSIENT_DB_ERROR');
    }
  });

  it('CT-R3 / CT-R4: 40001 once in first-change → one retry, one change; twice → 503 and nothing changed', async () => {
    const once = await create({ accountStatus: 'PROVISIONED' });
    const appOnce = await makeApp({ hooks: { firstChangeTx: (attempt) => (attempt === 0 ? { beforeCommit: async () => { throw sqlError('40001'); } } : undefined) } });
    const cookie1 = cookieOf(await login(appOnce, once.username, once.password));
    expect((await firstChange(appOnce, cookie1, 'retry once then succeed')).status).toBe(200);
    expect((await audits(once.accountId)).filter((x) => x.action === 'CHANGE_PASSWORD' && x.outcome === 'SUCCESS')).toHaveLength(1);

    const twice = await create({ accountStatus: 'PROVISIONED' });
    const appTwice = await makeApp({ hooks: { firstChangeTx: () => ({ beforeCommit: async () => { throw sqlError('40001'); } }) } });
    const cookie2 = cookieOf(await login(appTwice, twice.username, twice.password));
    const before = await credential(twice.accountId);
    const res = await firstChange(appTwice, cookie2, 'retry twice then give up');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_BUSY');
    expect(await credential(twice.accountId)).toEqual(before);
    expect((await getSession(appTwice, cookie2)).status).toBe(200); // session kept
    expect((await audits(twice.accountId)).map((x) => `${x.action}/${x.reason}`)).toContain('CHANGE_PASSWORD/TRANSIENT_DB_ERROR');
  });

  it('SQLSTATE of a real PostgreSQL error is extracted through Prisma (22012)', async () => {
    const error = await prisma.$queryRawUnsafe('SELECT 1/0').then(() => null, (e: unknown) => e);
    expect(sqlstateOf(error)).toBe('22012');
  });
});

// Spreading a class instance loses its prototype methods; bind them so wrappers can override single methods.
function bind(repo: AuthRepository): AuthRepository {
  return {
    lookup: repo.lookup.bind(repo), reserve: repo.reserve.bind(repo), withinDeadline: repo.withinDeadline.bind(repo),
    insertAudit: repo.insertAudit.bind(repo), loginSuccess: repo.loginSuccess.bind(repo), findSession: repo.findSession.bind(repo),
    touchSession: repo.touchSession.bind(repo), revokeSession: repo.revokeSession.bind(repo),
    revokeLiveSessionByToken: repo.revokeLiveSessionByToken.bind(repo), readPasswordContext: repo.readPasswordContext.bind(repo),
    firstChange: repo.firstChange.bind(repo),
  };
}

