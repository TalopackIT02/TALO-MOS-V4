import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { checkSmokeUrl, isPermissionDenied } from '../../smoke/dbSmoke.js';
import { PsqlSession, Sc5Fixtures, credentialState, credentialWriter, lit, liveSessions, sqlTrue, writer } from './harness.js';
import type { FixtureAccount } from './harness.js';
import { createAppClient, postIncrementAttempt, recordFailure, reserve, success, validateSession, verify } from './protocol.js';
import type { Reservation, SuccessOptions } from './protocol.js';

// AUTH-SC5-V1 PostgreSQL integration verification of H-b (+ writer protocol, AS-1, DB time, privileges).
// Runs ONLY with TALO_SC5_DB=1 against talo_mos_v4_test: protocol as talo_app (DATABASE_URL), fixtures/writers/cleanup
// as talo_test_harness. Every test creates its own SC5T- fixtures and deletes exactly those rows afterwards.

const enabled = process.env['TALO_SC5_DB'] === '1';
const stats = { scenarios: 0, concurrentScenarios: 0, sqlRuns: 0, cleanups: 0, deletedRows: 0 };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, resolve: () => release() };
}
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function isPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => false, () => false), sleep(ms).then(() => true)]);
}

describe.skipIf(!enabled)('AUTH-SC5-V1 — PostgreSQL integration (talo_mos_v4_test)', { timeout: 120_000 }, () => {
  let app: PrismaClient;
  let h: PsqlSession; // fixtures + inspection
  let w1: PsqlSession; // writer connection 1
  let w2: PsqlSession; // writer connection 2
  let fx: Sc5Fixtures;

  const token = () => `${fx.runId}-tok-${randomUUID()}`;
  const opts = (extra: Partial<SuccessOptions> = {}): SuccessOptions => ({ runId: fx.runId, tokenHash: token(), ...extra });
  async function wrong(acc: FixtureAccount): Promise<Reservation | null> {
    const r = await reserve(app, acc.accountId);
    if (r) {
      expect(verify(r, acc.passwordHash, false)).toBe(false);
      await recordFailure(app, acc.accountId, fx.runId, r.slot);
    }
    return r;
  }
  type LoginResult = { outcome: string; reset?: boolean; sessionId?: string; reservation?: Reservation };
  async function login(acc: FixtureAccount, extra: Partial<SuccessOptions> = {}): Promise<LoginResult> {
    const r = await reserve(app, acc.accountId);
    if (!r) return { outcome: 'REFUSED' };
    expect(verify(r, acc.passwordHash, true)).toBe(true);
    return { reservation: r, ...(await success(app, acc.accountId, r, opts(extra))) };
  }

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    app = createAppClient(url ?? '');
    h = new PsqlSession();
    w1 = new PsqlSession();
    w2 = new PsqlSession();
    fx = new Sc5Fixtures(h);
    // Refuse to start if SC5T data of another run exists (never delete what this run did not create).
    const [leftover] = await h.ok(`SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE 'SC5T-%'`);
    if (leftover?.[0] !== '0') throw new Error(`existing SC5T data found (${leftover?.[0]} memberships) — not touching it`);
  }, 60_000);

  afterEach(async () => {
    for (const s of [w1, w2]) await s.query('ROLLBACK').catch(() => undefined);
    const { deleted } = await fx.cleanup();
    stats.cleanups += 1;
    stats.deletedRows += Object.values(deleted).reduce((a, b) => a + b, 0);
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    const [rest] = await h.ok(`SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${fx.runId}-%`)}`);
    const [totals] = await h.ok(`SELECT (SELECT count(*) FROM iam.iam_memberships) + (SELECT count(*) FROM iam.iam_user_accounts)
      + (SELECT count(*) FROM iam.iam_credentials) + (SELECT count(*) FROM iam.iam_sessions) + (SELECT count(*) FROM iam.iam_audit_logs)`);
    console.log(`[SC5] run=${fx.runId} scenarios=${stats.scenarios} concurrent=${stats.concurrentScenarios} cleanups=${stats.cleanups} deletedRows=${stats.deletedRows} remainingRunRows=${rest?.[0]} totalIamRows=${totals?.[0]}`);
    await app.$disconnect();
    await Promise.all([h.close(), w1.close(), w2.close()]);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ D. privileges
  describe('D. privileges and identities', () => {
    it('D1 protocol runs as talo_app, harness as talo_test_harness, both on the test database', async () => {
      stats.scenarios++;
      const [app_] = await app.$queryRawUnsafe<{ u: string; d: string; s: boolean }[]>(
        `SELECT current_user AS u, current_database() AS d, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s`);
      expect(app_).toEqual({ u: 'talo_app', d: 'talo_mos_v4_test', s: false });
      expect(await h.ok(`SELECT current_user, current_database()`)).toEqual([['talo_test_harness', 'talo_mos_v4_test']]);
    });

    it('D2 talo_app cannot lock membership rows, cannot DELETE, cannot use RETURNING on audit', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const attempts = [
        () => app.$transaction((tx) => tx.$queryRawUnsafe(`SELECT 1 FROM iam.iam_memberships WHERE membership_id = $1::uuid FOR UPDATE`, acc.membershipId)),
        () => app.$transaction((tx) => tx.$queryRawUnsafe(`SELECT 1 FROM iam.iam_memberships WHERE membership_id = $1::uuid FOR KEY SHARE`, acc.membershipId)),
        () => app.$executeRawUnsafe(`DELETE FROM iam.iam_sessions WHERE false`),
        () => app.$queryRawUnsafe(`INSERT INTO iam.iam_audit_logs (action_code, target_type, outcome, metadata) VALUES ('LOGIN','USER_ACCOUNT','FAILURE', $1::jsonb) RETURNING audit_id`, JSON.stringify({ run: fx.runId })),
        () => app.$executeRawUnsafe(`UPDATE iam.iam_memberships SET membership_status = 'EXITED' WHERE false`),
      ];
      for (const attempt of attempts) {
        const error = await attempt().then(() => undefined, (e: unknown) => e);
        expect(isPermissionDenied(error)).toBe(true);
      }
      await recordFailure(app, acc.accountId, fx.runId, 0); // audit INSERT without RETURNING works
    });
  });

  // ------------------------------------------------------------------------------------------------ A. lockout
  describe('A. lockout (AD-5, H-b)', () => {
    it('A1–A3 1–4 wrong counted; 5th wrong locks for exactly 15 min (DB time); 6th refused without the hash', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const slots: number[] = [];
      for (let i = 0; i < 4; i++) slots.push((await wrong(acc))?.slot ?? -1);
      expect(slots).toEqual([1, 2, 3, 4]);
      expect(await credentialState(h, acc.accountId)).toMatchObject({ c: 4, lockedUntil: null, locked: false });
      const fifth = await wrong(acc);
      expect(fifth?.slot).toBe(5);
      expect(await sqlTrue(h, `${lit(fifth?.lockedUntil ?? '')}::timestamptz - ${lit(fifth?.reservedAt ?? '')}::timestamptz = interval '15 minutes'`)).toBe(true);
      const locked = await credentialState(h, acc.accountId);
      expect(locked).toMatchObject({ c: 5, locked: true });
      const sixth = await reserve(app, acc.accountId);
      expect(sixth).toBeNull(); // no row → no password_hash ever reaches the application (INV-5)
      expect((await credentialState(h, acc.accountId)).version).toBe(locked.version); // refused attempts write nothing
    });

    it('A4 4 wrong then a correct 5th attempt logs in and resets (not locked by mistake)', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      for (let i = 0; i < 4; i++) await wrong(acc);
      const result = await login(acc);
      expect(result.reservation?.slot).toBe(5);
      expect(result.reservation?.lockedUntil).not.toBeNull(); // slot 5 set the lock at RESERVE…
      expect(result).toMatchObject({ outcome: 'AUTHENTICATED', reset: true }); // …and its own SUCCESS cleared it (CAS)
      expect(await credentialState(h, acc.accountId)).toMatchObject({ c: 0, lockedUntil: null, locked: false });
      expect((await liveSessions(h, acc.accountId)).live).toBe(1);
    });

    it('A5 lock expiry starts a new cycle (slot 1) and a correct login succeeds', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      for (let i = 0; i < 5; i++) await wrong(acc);
      expect(await reserve(app, acc.accountId)).toBeNull();
      await credentialWriter.expireLock(h, acc.accountId); // simulates 15 minutes passing (bumps the version)
      const restart = await wrong(acc);
      expect(restart).toMatchObject({ slot: 1, lockedUntil: null });
      expect(await login(acc)).toMatchObject({ outcome: 'AUTHENTICATED' });
    });

    it('A6 stale SUCCESS of an older cycle neither resets nor unlocks the new locked cycle', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const r0 = await reserve(app, acc.accountId);
      const r1 = await reserve(app, acc.accountId);
      if (!r0 || !r1) throw new Error('reservation refused');
      expect(await success(app, acc.accountId, r1, opts())).toMatchObject({ outcome: 'AUTHENTICATED', reset: true });
      for (let i = 0; i < 5; i++) await wrong(acc); // new cycle locked by an attacker
      const before = await credentialState(h, acc.accountId);
      const stale = await success(app, acc.accountId, r0, opts());
      expect(stale).toMatchObject({ outcome: 'LOCKED', reset: false });
      const after = await credentialState(h, acc.accountId);
      expect(after).toEqual(before); // counter, lock and version untouched
      expect((await liveSessions(h, acc.accountId)).live).toBe(1); // only r1's session
    });

    it('A7 SUCCESS beyond the deadline D is refused and does not reset (real wait with D=2s; contract D=30s)', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      await sleep(2_500);
      expect(await success(app, acc.accountId, r, opts({ deadline: '2 seconds' }))).toMatchObject({ outcome: 'ATTEMPT_EXPIRED', reset: false });
      const r2 = await reserve(app, acc.accountId);
      if (!r2) throw new Error('refused');
      const olderRows = await h.ok(`SELECT (${lit(r2.reservedAt)}::timestamptz - interval '31 seconds')::text`);
      expect(await success(app, acc.accountId, { ...r2, reservedAt: olderRows[0]?.[0] ?? '' }, opts())).toMatchObject({ outcome: 'ATTEMPT_EXPIRED', reset: false });
      expect(await credentialState(h, acc.accountId)).toMatchObject({ c: 2 });
    });

    it('A8 10 concurrent RESERVEs on separate connections grant exactly slots 1..5 and lock once (INV-1)', async () => {
      for (let round = 0; round < 3; round++) {
        stats.scenarios++;
        stats.concurrentScenarios++;
        const acc = await fx.create();
        const results = await Promise.all(Array.from({ length: 10 }, () => reserve(app, acc.accountId)));
        const granted = results.filter((r): r is Reservation => r !== null).map((r) => r.slot).sort((a, b) => a - b);
        expect(granted).toEqual([1, 2, 3, 4, 5]);
        expect(results.filter((r) => r === null)).toHaveLength(5);
        expect(results.filter((r) => r?.lockedUntil)).toHaveLength(1);
        expect(await credentialState(h, acc.accountId)).toMatchObject({ c: 5, locked: true });
        await fx.cleanup();
      }
    });

    it('A9 SUCCESS/FAILURE interleavings follow the CAS rule', async () => {
      stats.scenarios += 2;
      // wrong reserves, correct reserves, wrong fails, correct succeeds → no write after the correct RESERVE → reset
      const a = await fx.create();
      const wa = await reserve(app, a.accountId);
      const ca = await reserve(app, a.accountId);
      if (!wa || !ca) throw new Error('refused');
      await recordFailure(app, a.accountId, fx.runId, wa.slot);
      expect(await success(app, a.accountId, ca, opts())).toMatchObject({ outcome: 'AUTHENTICATED', reset: true });
      expect(await credentialState(h, a.accountId)).toMatchObject({ c: 0 });
      // correct reserves, wrong reserves (later write), wrong fails, correct succeeds → logs in, no reset
      const b = await fx.create();
      const cb = await reserve(app, b.accountId);
      const wb = await reserve(app, b.accountId);
      if (!cb || !wb) throw new Error('refused');
      await recordFailure(app, b.accountId, fx.runId, wb.slot);
      expect(await success(app, b.accountId, cb, opts())).toMatchObject({ outcome: 'AUTHENTICATED', reset: false });
      expect(await credentialState(h, b.accountId)).toMatchObject({ c: 2, locked: false });
    });

    it('A10 4 wrong + 1 correct fully concurrent (20 rounds): invariants hold in every observed interleaving', async () => {
      const seen = new Set<string>();
      for (let round = 0; round < 20; round++) {
        stats.scenarios++;
        stats.concurrentScenarios++;
        const acc = await fx.create();
        const attempts = [0, 1, 2, 3].map(() => wrong(acc).then(() => 'W'));
        const correct = login(acc).then((r) => `C:${r.outcome}:${'reset' in r ? String(r.reset) : '-'}`);
        const outcomes = await Promise.all([...attempts, correct]);
        const state = await credentialState(h, acc.accountId);
        expect(state.c).toBeLessThanOrEqual(5);
        if (state.c === 5) expect(state.lockedUntil).not.toBeNull();
        const c = outcomes[4] ?? '';
        expect(['C:AUTHENTICATED:true', 'C:AUTHENTICATED:false', 'C:LOCKED:false']).toContain(c);
        if (c === 'C:AUTHENTICATED:true') expect(state.c).toBeLessThanOrEqual(4);
        const [audits] = await h.ok(`SELECT count(*) FROM iam.iam_audit_logs WHERE metadata->>'run' = ${lit(fx.runId)} AND target_id = ${lit(acc.accountId)} AND metadata->>'reason' = 'BAD_PASSWORD'`);
        expect(Number(audits?.[0])).toBe(4);
        seen.add(`${c}|c=${state.c}`);
        await fx.cleanup();
      }
      console.log(`[SC5] A10 distinct outcomes observed: ${[...seen].join(', ')}`);
    });

    it('A11 password changed between RESERVE and SUCCESS → CREDENTIAL_CHANGED, no session', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      await credentialWriter.changePassword(h, acc.accountId, `${fx.runId}:hash:new`);
      expect(await success(app, acc.accountId, r, opts())).toMatchObject({ outcome: 'CREDENTIAL_CHANGED' });
      expect((await liveSessions(h, acc.accountId)).total).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------ B. eligibility
  describe('B. membership / account eligibility (AD-3, writer protocol)', () => {
    it('B1 ACTIVE and ON_LEAVE memberships may log in', async () => {
      stats.scenarios += 2;
      expect(await login(await fx.create({ membershipStatus: 'ACTIVE' }))).toMatchObject({ outcome: 'AUTHENTICATED' });
      expect(await login(await fx.create({ membershipStatus: 'ON_LEAVE' }))).toMatchObject({ outcome: 'AUTHENTICATED' });
    });

    it('B2 EXITED, left_at reached (Asia/Ho_Chi_Minh date) are refused; left_at tomorrow is allowed', async () => {
      stats.scenarios += 3;
      expect(await login(await fx.create({ membershipStatus: 'EXITED' }))).toMatchObject({ outcome: 'NOT_ALLOWED' });
      const today = await fx.create();
      await writer.setLeftAt(h, today.membershipId, `(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`);
      expect(await login(today)).toMatchObject({ outcome: 'NOT_ALLOWED' });
      const tomorrow = await fx.create();
      await writer.setLeftAt(h, tomorrow.membershipId, `(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1`);
      expect(await login(tomorrow)).toMatchObject({ outcome: 'AUTHENTICATED' });
    });

    it('B3 account LOCKED or DISABLED is refused regardless of membership', async () => {
      stats.scenarios += 2;
      expect(await login(await fx.create({ accountStatus: 'LOCKED' }))).toMatchObject({ outcome: 'NOT_ALLOWED' });
      expect(await login(await fx.create({ accountStatus: 'DISABLED' }))).toMatchObject({ outcome: 'NOT_ALLOWED' });
    });

    it('B4 membership EXITED by a writer while the password is being verified → refused', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      await writer.begin(w1);
      await writer.lockAccountsOfMembership(w1, acc.membershipId);
      await writer.exitMembership(w1, acc.membershipId);
      await writer.revokeMembershipSessions(w1, acc.membershipId);
      await writer.commit(w1);
      expect(await success(app, acc.accountId, r, opts())).toMatchObject({ outcome: 'NOT_ALLOWED' });
      expect((await liveSessions(h, acc.accountId)).live).toBe(0);
    });

    it('B5 writer first: SUCCESS waits on the account lock, then sees DISABLED and refuses', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      await writer.begin(w1);
      expect((await writer.lockAccountsOfMembership(w1, acc.membershipId)).error).toBe(false);
      await writer.setAccountStatus(w1, acc.accountId, 'DISABLED');
      const pending = success(app, acc.accountId, r, opts());
      expect(await isPending(pending, 800)).toBe(true); // blocked on SUCCESS_LOCK_ACCOUNT
      await writer.revokeAccountSessions(w1, acc.accountId);
      await writer.commit(w1);
      expect(await pending).toMatchObject({ outcome: 'NOT_ALLOWED' });
      expect((await liveSessions(h, acc.accountId)).live).toBe(0);
    });

    it('B6 SUCCESS first: the writer waits on the account lock, then revokes the new session', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      const holding = deferred();
      const gate = deferred();
      const pending = success(app, acc.accountId, r, opts({ hooks: { afterAccountLock: async () => { holding.resolve(); await gate.promise; } } }));
      await holding.promise;
      await writer.begin(w1);
      const lock = writer.lockAccountsOfMembership(w1, acc.membershipId);
      expect(await isPending(lock, 800)).toBe(true); // writer blocked by SUCCESS
      gate.resolve();
      const result = await pending;
      expect(result).toMatchObject({ outcome: 'AUTHENTICATED' });
      expect((await lock).error).toBe(false);
      await writer.exitMembership(w1, acc.membershipId);
      await writer.revokeMembershipSessions(w1, acc.membershipId);
      await writer.commit(w1);
      expect((await liveSessions(h, acc.accountId)).live).toBe(0);
      expect((await validateSession(app, result.sessionId ?? '')).usable).toBe(false);
    });

    it('B7 writer sets left_at to today while SUCCESS waits → refused', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create({ membershipStatus: 'ON_LEAVE' });
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      await writer.begin(w1);
      await writer.lockAccountsOfMembership(w1, acc.membershipId);
      await writer.setLeftAt(w1, acc.membershipId, `(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`);
      const pending = success(app, acc.accountId, r, opts());
      expect(await isPending(pending, 800)).toBe(true);
      await writer.revokeMembershipSessions(w1, acc.membershipId);
      await writer.commit(w1);
      expect(await pending).toMatchObject({ outcome: 'NOT_ALLOWED' });
    });

    it('B8 two writers on one membership with two accounts, UUID-ordered locks: serialised, no deadlock', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create({ extraDisabledAccount: true });
      await writer.begin(w1);
      await writer.begin(w2);
      expect((await writer.lockAccountsOfMembership(w1, acc.membershipId)).error).toBe(false);
      const second = writer.lockAccountsOfMembership(w2, acc.membershipId);
      expect(await isPending(second, 800)).toBe(true);
      await writer.exitMembership(w1, acc.membershipId);
      await writer.revokeMembershipSessions(w1, acc.membershipId);
      await writer.commit(w1);
      const secondResult = await second;
      expect(secondResult.error).toBe(false);
      expect(secondResult.rows).toHaveLength(2);
      await writer.setMembershipStatus(w2, acc.membershipId, 'EXITED');
      await writer.commit(w2);
    });

    it('B9 opposite lock order between two writers deadlocks (40P01) — why UUID order is mandatory', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create({ extraDisabledAccount: true });
      const other = acc.extraAccountId ?? '';
      await writer.begin(w1);
      await writer.begin(w2);
      await writer.lockAccount(w1, acc.accountId);
      await writer.lockAccount(w2, other);
      const p1 = writer.lockAccount(w1, other);
      const p2 = writer.lockAccount(w2, acc.accountId);
      const [r1, r2] = await Promise.all([p1, p2]);
      const states = [r1.sqlstate, r2.sqlstate].sort();
      expect(states).toEqual(['00000', '40P01']);
      await writer.rollback(w1);
      await writer.rollback(w2);
    });
  });

  // ------------------------------------------------------------------------------------------------ C. sessions
  describe('C. sessions (AS-1, revocation, DB time)', () => {
    it('C1 concurrent activation logins leave exactly one live activation session (10 rounds)', async () => {
      for (let round = 0; round < 10; round++) {
        stats.scenarios++;
        stats.concurrentScenarios++;
        const acc = await fx.create({ accountStatus: 'PROVISIONED', mustChangePassword: true });
        const results = await Promise.all([login(acc), login(acc), login(acc)]);
        expect(results.filter((r) => r.outcome === 'ACTIVATION_SESSION').length).toBeGreaterThanOrEqual(1);
        expect((await liveSessions(h, acc.accountId)).liveActivation).toBe(1);
        await fx.cleanup();
      }
    });

    it('C2 session times come from PostgreSQL: 10h full, 15 min activation, last_seen = created_at', async () => {
      stats.scenarios += 2;
      const full = await fx.create();
      const f = await login(full);
      expect(await sqlTrue(h, `(SELECT expires_at - created_at = interval '10 hours' AND last_seen_at = created_at AND assurance_level_snapshot = 1
        AND created_at >= ${lit(f.reservation?.reservedAt ?? '')}::timestamptz FROM iam.iam_sessions WHERE session_id = ${lit(f.sessionId ?? '')})`)).toBe(true);
      const act = await fx.create({ accountStatus: 'PROVISIONED', mustChangePassword: true });
      const a = await login(act);
      expect(await sqlTrue(h, `(SELECT expires_at - created_at = interval '15 minutes' AND assurance_level_snapshot = 0
        FROM iam.iam_sessions WHERE session_id = ${lit(a.sessionId ?? '')})`)).toBe(true);
    });

    it('C3 versions are strictly increasing with microseconds; JS Date would lose them', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const versions: string[] = [];
      for (let i = 0; i < 4; i++) versions.push((await reserve(app, acc.accountId))?.version ?? '');
      for (let i = 1; i < versions.length; i++) {
        expect(await sqlTrue(h, `${lit(versions[i] ?? '')}::timestamptz > ${lit(versions[i - 1] ?? '')}::timestamptz`)).toBe(true);
      }
      // PostgreSQL prints up to 6 fractional digits; a JavaScript Date keeps 3. At least one version carries
      // sub-millisecond digits and does NOT survive a Date round trip — versions must travel as text.
      const precise = versions.find((v) => /\.\d{4,6}[+-]/.test(v));
      expect(precise).toBeDefined();
      const viaDate = new Date(precise ?? '').toISOString();
      expect(await sqlTrue(h, `${lit(viaDate)}::timestamptz <> ${lit(precise ?? '')}::timestamptz`)).toBe(true);
    });

    it('C4 touching a revoked session changes nothing', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const s = await login(acc);
      await writer.begin(w1);
      await writer.lockAccount(w1, acc.accountId);
      await writer.revokeAccountSessions(w1, acc.accountId);
      await writer.commit(w1);
      const touched = await app.$executeRawUnsafe(`UPDATE iam.iam_sessions SET last_seen_at = statement_timestamp()
        WHERE session_id = $1::uuid AND revoked_at IS NULL AND last_seen_at <= statement_timestamp() - interval '1 minute'`, s.sessionId);
      expect(touched).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------ E. negative controls
  describe('E. negative controls (must exhibit the bug on real PostgreSQL)', () => {
    it('E1 naive SUCCESS (always reset) unlocks a newer locked cycle', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      const r0 = await reserve(app, acc.accountId);
      const r1 = await reserve(app, acc.accountId);
      if (!r0 || !r1) throw new Error('refused');
      await success(app, acc.accountId, r1, opts());
      for (let i = 0; i < 5; i++) await wrong(acc);
      const stale = await success(app, acc.accountId, r0, opts({ variant: 'naive' }));
      expect(stale).toMatchObject({ outcome: 'AUTHENTICATED', reset: true }); // ✗ violation reproduced
      expect(await credentialState(h, acc.accountId)).toMatchObject({ c: 0, locked: false });
    });

    it('E2 post-increment lets more than 5 real verifications through in one cycle', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create();
      const results = await Promise.all(Array.from({ length: 10 }, () => postIncrementAttempt(app, acc.accountId, () => sleep(300))));
      expect(results.filter((r) => r === 'VERIFIED').length).toBeGreaterThan(5); // ✗ INV-1 violated
    });

    it('E3 SUCCESS without account lock coupling issues a session for an EXITED membership', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create();
      const r = await reserve(app, acc.accountId);
      if (!r) throw new Error('refused');
      const read = deferred();
      const gate = deferred();
      const pending = success(app, acc.accountId, r, opts({ variant: 'no-lock-coupling', hooks: { afterEligibilityRead: async () => { read.resolve(); await gate.promise; } } }));
      await read.promise;
      await writer.begin(w1);
      expect((await writer.lockAccountsOfMembership(w1, acc.membershipId)).error).toBe(false); // not blocked
      await writer.exitMembership(w1, acc.membershipId);
      await writer.revokeMembershipSessions(w1, acc.membershipId);
      await writer.commit(w1);
      gate.resolve();
      expect(await pending).toMatchObject({ outcome: 'AUTHENTICATED' });
      expect((await liveSessions(h, acc.accountId)).live).toBe(1); // ✗ live session for EXITED
    });

    it('E4 a writer that does not revoke leaves a live session for an EXITED membership', async () => {
      stats.scenarios++;
      const acc = await fx.create();
      await login(acc);
      await writer.begin(w1);
      await writer.lockAccountsOfMembership(w1, acc.membershipId);
      await writer.exitMembership(w1, acc.membershipId);
      await writer.commit(w1);
      expect((await liveSessions(h, acc.accountId)).live).toBe(1); // ✗ (requests are still refused by VALIDATE)
    });

    it('E5 activation logins that do not revoke each other break AS-1', async () => {
      stats.scenarios++;
      stats.concurrentScenarios++;
      const acc = await fx.create({ accountStatus: 'PROVISIONED', mustChangePassword: true });
      await Promise.all([0, 1, 2].map(() => login(acc, { variant: 'activation-no-revoke' })));
      expect((await liveSessions(h, acc.accountId)).liveActivation).toBeGreaterThan(1); // ✗
    });
  });
});
