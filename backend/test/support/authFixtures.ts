import { randomBytes, randomUUID } from 'node:crypto';
import { HARNESS_ROLE, PsqlSession, TEST_DB, lit, uuidArray } from '../integration/sc5/harness.js';
import type { PasswordHasher } from '../../src/modules/auth/passwordHasher.js';

// AUTH-IMPLEMENTATION-E2E fixtures (test database only, role talo_test_harness — no grant change).
// Synthetic, tagged data: employee_code "AUTHT-<run>-M<n>", username "autht-<run>-u<n>". Credentials hold real Argon2id
// hashes of random per-run passwords that exist only in memory. Cleanup deletes by explicit UUID lists in FK order after
// an ownership proof. Audit rows of unknown-username attempts (no account UUID) are owned only when ALL factors match:
// action LOGIN / reason UNKNOWN_USERNAME, no target and no actor, the run's User-Agent tag, a requestId the run recorded
// from its own responses, and occurred_at inside the run window.

export interface AuthFixtureAccount {
  readonly membershipId: string;
  readonly accountId: string;
  readonly username: string;
  readonly employeeCode: string;
  readonly fullName: string;
  readonly password: string;
}

export interface AuthFixtureOptions {
  readonly membershipStatus?: 'ACTIVE' | 'ON_LEAVE' | 'EXITED';
  readonly leftAt?: 'today' | 'tomorrow';
  readonly accountStatus?: 'PROVISIONED' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly mustChangePassword?: boolean;
  readonly withCredential?: boolean;
}

export const FIXTURE_PREFIX = 'AUTHT-';

export function randomPassword(): string {
  return `tp ${randomBytes(12).toString('base64url')} kiem thu`;
}

export class AuthFixtures {
  readonly runId: string;
  readonly userAgent: string;
  private seq = 0;
  readonly memberships: string[] = [];
  readonly accounts: string[] = [];
  readonly unknownRequestIds: string[] = [];
  private readonly usernames = new Set<string>();
  startedAt = '';

  constructor(private readonly harness: PsqlSession, private readonly hasher: PasswordHasher, runId?: string) {
    this.runId = runId ?? `${FIXTURE_PREFIX}${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    this.userAgent = `${this.runId} auth-tests`;
  }

  static async connect(): Promise<PsqlSession> {
    const session = new PsqlSession(HARNESS_ROLE);
    const [row] = await session.ok('SELECT current_database(), current_user');
    if (row?.[0] !== TEST_DB || row?.[1] !== HARNESS_ROLE) {
      await session.close();
      throw new Error('fixture guard: not connected to talo_mos_v4_test as talo_test_harness');
    }
    return session;
  }

  // Refuses to start when rows of an earlier run are still present (never deletes what this run did not create).
  // Also fixes the start of the run window (DB time) used by the audit ownership proof.
  async assertNoLeftovers(): Promise<void> {
    const [row] = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${FIXTURE_PREFIX}%`)})
           + (SELECT count(*) FROM iam.iam_user_accounts WHERE username ILIKE ${lit(`${FIXTURE_PREFIX}%`)})
           + (SELECT count(*) FROM iam.iam_audit_logs WHERE metadata->>'ua' LIKE ${lit(`${FIXTURE_PREFIX}%`)})`);
    if (row?.[0] !== '0') throw new Error(`fixture guard: ${row?.[0]} leftover ${FIXTURE_PREFIX}* rows — inspect before running`);
    await this.markStart();
  }

  async markStart(): Promise<void> {
    const [row] = await this.harness.ok('SELECT statement_timestamp()::text');
    this.startedAt = row?.[0] ?? '';
  }

  isFixtureUsername(username: string): boolean {
    return this.usernames.has(username.trim().toLowerCase());
  }

  // Records the X-Request-Id of a login attempt with a username that is not a fixture (ownership factor).
  registerUnknownAttempt(requestId: string | undefined): void {
    if (requestId && /^[0-9a-f-]{36}$/.test(requestId)) this.unknownRequestIds.push(requestId);
  }

  async create(options: AuthFixtureOptions = {}): Promise<AuthFixtureAccount> {
    this.seq += 1;
    const membershipId = randomUUID();
    const accountId = randomUUID();
    const employeeCode = `${this.runId}-M${this.seq}`;
    const username = `${this.runId}-u${this.seq}`.toLowerCase();
    const fullName = `Nhân viên kiểm thử ${this.seq}`;
    const password = randomPassword();
    const status = options.accountStatus ?? 'ACTIVE';
    const mustChange = options.mustChangePassword ?? status === 'PROVISIONED';
    const hash = await this.hasher.hashPassword(password);

    const [collision] = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_memberships WHERE membership_id = ${lit(membershipId)} OR employee_code = ${lit(employeeCode)})
           + (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ${lit(accountId)} OR lower(username) = lower(${lit(username)}))`);
    if (collision?.[0] !== '0') throw new Error('fixture collision with existing data');

    this.memberships.push(membershipId);
    this.accounts.push(accountId);
    this.usernames.add(username);
    const leftAt = options.leftAt === 'today' ? "(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date"
      : options.leftAt === 'tomorrow' ? "(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1" : 'NULL';
    await this.harness.ok('BEGIN');
    try {
      await this.harness.ok(`
        INSERT INTO iam.iam_memberships (membership_id, employee_id, employee_code, full_name, membership_status, joined_at, left_at)
        VALUES (${lit(membershipId)}, ${lit(randomUUID())}, ${lit(employeeCode)}, ${lit(fullName)},
                ${lit(options.membershipStatus ?? 'ACTIVE')}, current_date - 30, ${leftAt})`);
      await this.harness.ok(`
        INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, activated_at, disabled_at)
        VALUES (${lit(accountId)}, ${lit(membershipId)}, ${lit(username)}, ${lit(status)},
                ${status === 'ACTIVE' ? 'statement_timestamp()' : 'NULL'}, ${status === 'DISABLED' ? 'statement_timestamp()' : 'NULL'})`);
      if (options.withCredential ?? true) {
        await this.harness.ok(`
          INSERT INTO iam.iam_credentials (user_account_id, password_hash, password_changed_at, must_change_password)
          VALUES (${lit(accountId)}, ${lit(hash)}, ${mustChange ? 'NULL' : 'statement_timestamp()'}, ${mustChange})`);
      }
      await this.harness.ok('COMMIT');
    } catch (error) {
      await this.harness.query('ROLLBACK');
      throw error;
    }
    return { membershipId, accountId, username, employeeCode, fullName, password };
  }

  // Scoped cleanup: rows provably owned by this run, FK order, one transaction. Returns the deleted counts.
  async cleanup(): Promise<Record<string, number>> {
    const accounts = uuidArray(this.accounts.length ? this.accounts : ['00000000-0000-0000-0000-000000000000']);
    const memberships = uuidArray(this.memberships.length ? this.memberships : ['00000000-0000-0000-0000-000000000000']);
    const tag = `${this.runId}-%`;
    const [foreign] = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}) AND NOT (membership_id = ANY(${memberships})))
           + (SELECT count(*) FROM iam.iam_memberships WHERE membership_id = ANY(${memberships}) AND employee_code NOT LIKE ${lit(tag)})`);
    if (foreign?.[0] !== '0') throw new Error('cleanup refused: ownership could not be proven');
    if (!this.startedAt) throw new Error('cleanup refused: run window unknown (assertNoLeftovers/markStart not called)');
    const sessions = `(SELECT session_id FROM iam.iam_sessions WHERE user_account_id = ANY(${accounts}))`;
    const requestIds = this.unknownRequestIds.length ? `ARRAY[${this.unknownRequestIds.map(lit).join(',')}]::text[]` : 'ARRAY[]::text[]';
    const unknownOwned = `(target_id IS NULL AND actor_account_id IS NULL AND membership_id IS NULL AND session_id IS NULL
                   AND action_code = 'LOGIN' AND metadata->>'reason' = 'UNKNOWN_USERNAME' AND metadata->>'ua' = ${lit(this.userAgent)}
                   AND metadata->>'requestId' = ANY(${requestIds}) AND occurred_at >= ${lit(this.startedAt)}::timestamptz)`;
    // Rows carrying this run's tag that the factors above cannot prove: refuse instead of guessing.
    const [unproven] = await this.harness.ok(`SELECT count(*) FROM iam.iam_audit_logs WHERE target_id IS NULL AND actor_account_id IS NULL
      AND metadata->>'ua' = ${lit(this.userAgent)} AND NOT ${unknownOwned}`);
    if (unproven?.[0] !== '0') throw new Error(`cleanup refused: ${unproven?.[0]} audit rows carry the run tag without full ownership proof`);
    const steps: [string, string][] = [
      ['audit', `DELETE FROM iam.iam_audit_logs WHERE target_id = ANY(${accounts}) OR actor_account_id = ANY(${accounts})
                   OR membership_id = ANY(${memberships}) OR session_id IN ${sessions} OR target_id IN ${sessions}
                   OR ${unknownOwned}`],
      ['sessions', `DELETE FROM iam.iam_sessions WHERE user_account_id = ANY(${accounts})`],
      ['credentials', `DELETE FROM iam.iam_credentials WHERE user_account_id = ANY(${accounts})`],
      ['accounts', `DELETE FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}) AND membership_id = ANY(${memberships})`],
      ['memberships', `DELETE FROM iam.iam_memberships WHERE membership_id = ANY(${memberships}) AND employee_code LIKE ${lit(tag)}`],
    ];
    const deleted: Record<string, number> = {};
    await this.harness.ok('BEGIN');
    for (const [name, sql] of steps) {
      const result = await this.harness.query(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`);
      if (result.error) {
        await this.harness.query('ROLLBACK');
        throw new Error(`cleanup failed at ${name} [${result.sqlstate}] ${result.message}`);
      }
      deleted[name] = Number(result.rows[0]?.[0] ?? 0);
    }
    await this.harness.ok('COMMIT');
    // Post-check: nothing of the run is referenced any more (sessions, audit by UUID, audit by tag).
    const [after] = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_sessions WHERE user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_audit_logs WHERE target_id = ANY(${accounts}) OR actor_account_id = ANY(${accounts}) OR membership_id = ANY(${memberships}))
           + (SELECT count(*) FROM iam.iam_credentials WHERE user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}))
           + (SELECT count(*) FROM iam.iam_memberships WHERE membership_id = ANY(${memberships}))`);
    if (after?.[0] !== '0') throw new Error(`cleanup post-check failed: ${after?.[0]} rows still reference the run`);
    this.memberships.length = 0;
    this.accounts.length = 0;
    this.unknownRequestIds.length = 0;
    return deleted;
  }

  // Remaining rows that belong to this run (must be 0 after cleanup). Read-only.
  async remaining(): Promise<number> {
    const [row] = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${this.runId}-%`)})
           + (SELECT count(*) FROM iam.iam_user_accounts WHERE lower(username) LIKE lower(${lit(`${this.runId}-%`)}))
           + (SELECT count(*) FROM iam.iam_audit_logs WHERE metadata->>'ua' = ${lit(this.userAgent)})`);
    return Number(row?.[0] ?? -1);
  }
}
