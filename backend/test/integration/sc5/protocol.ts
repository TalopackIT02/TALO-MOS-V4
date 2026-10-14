import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import type { Prisma } from '../../../src/infrastructure/prisma/generated/client.js';

// AUTH-SC5-V1 — H-b protocol prototype executed by talo_app (TEST ONLY, not the production authentication module).
// SQL mirrors backend/test/model/sc5/sc5-protocol.sql. All security time is PostgreSQL time; versions travel as text.

export const N = 5;
export const LOCK_INTERVAL = '15 minutes';
export const DEADLINE = '30 seconds';

export function createAppClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 15 }) });
}

type Db = PrismaClient | Prisma.TransactionClient;

const SQL = {
  reserve: `
    UPDATE iam.iam_credentials AS c
       SET failed_attempt_count = CASE WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                                       THEN 1 ELSE c.failed_attempt_count + 1 END,
           locked_until = CASE
                            WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                              THEN CASE WHEN 1 >= $2::int THEN statement_timestamp() + $3::interval END
                            WHEN c.failed_attempt_count + 1 >= $2::int THEN statement_timestamp() + $3::interval
                            ELSE c.locked_until
                          END,
           updated_at = GREATEST(statement_timestamp(), c.updated_at + interval '1 microsecond')
     WHERE c.user_account_id = $1::uuid
       AND (c.locked_until IS NULL OR c.locked_until <= statement_timestamp())
       AND (c.failed_attempt_count < $2::int OR c.locked_until <= statement_timestamp())
    RETURNING c.failed_attempt_count AS slot, c.locked_until::text AS locked_until, c.updated_at::text AS version,
              c.password_hash, statement_timestamp()::text AS reserved_at`,
  lockAccount: `
    SELECT a.user_account_id, a.membership_id, a.account_status, (a.disabled_at IS NULL) AS not_disabled
      FROM iam.iam_user_accounts AS a WHERE a.user_account_id = $1::uuid FOR NO KEY UPDATE`,
  lockCredential: `
    SELECT c.password_hash, c.updated_at::text AS version, c.must_change_password
      FROM iam.iam_credentials AS c WHERE c.user_account_id = $1::uuid FOR NO KEY UPDATE`,
  readEligibility: `
    SELECT m.membership_status,
           (m.left_at IS NULL OR m.left_at > (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS before_left_at,
           (c.locked_until IS NOT NULL AND c.locked_until > statement_timestamp()) AS locked_now,
           (statement_timestamp() - $2::timestamptz) <= $3::interval AS within_deadline,
           a.account_status, (a.disabled_at IS NULL) AS not_disabled
      FROM iam.iam_user_accounts AS a
      JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
      JOIN iam.iam_credentials AS c ON c.user_account_id = a.user_account_id
     WHERE a.user_account_id = $1::uuid`,
  casReset: `
    UPDATE iam.iam_credentials
       SET failed_attempt_count = 0, locked_until = NULL,
           updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
     WHERE user_account_id = $1::uuid AND updated_at = $2::timestamptz`,
  naiveReset: `
    UPDATE iam.iam_credentials
       SET failed_attempt_count = 0, locked_until = NULL,
           updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
     WHERE user_account_id = $1::uuid`,
  revokeAccountSessions: `
    UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE user_account_id = $1::uuid AND revoked_at IS NULL`,
  insertSession: `
    INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, assurance_level_snapshot, created_at, expires_at, last_seen_at)
    VALUES ($1::uuid, $2, $3::smallint, statement_timestamp(), statement_timestamp() + $4::interval, statement_timestamp())
    RETURNING session_id::text AS session_id`,
  audit: `
    INSERT INTO iam.iam_audit_logs (actor_account_id, membership_id, session_id, action_code, target_type, target_id, outcome, occurred_at, metadata)
    VALUES (NULL, NULL, NULL, 'LOGIN', 'USER_ACCOUNT', $1::uuid, $2, statement_timestamp(), $3::jsonb)`,
  validateSession: `
    SELECT (s.revoked_at IS NULL) AS not_revoked, (s.expires_at > statement_timestamp()) AS not_expired,
           a.account_status, (a.disabled_at IS NULL) AS not_disabled, m.membership_status,
           (m.left_at IS NULL OR m.left_at > (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS before_left_at
      FROM iam.iam_sessions AS s
      JOIN iam.iam_user_accounts AS a ON a.user_account_id = s.user_account_id
      JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
     WHERE s.session_id = $1::uuid`,
};

export interface Reservation {
  readonly slot: number;
  readonly lockedUntil: string | null;
  readonly version: string;
  readonly passwordHash: string;
  readonly reservedAt: string;
}

interface ReserveRow {
  slot: number;
  locked_until: string | null;
  version: string;
  password_hash: string;
  reserved_at: string;
}

export async function reserve(db: Db, accountId: string): Promise<Reservation | null> {
  const rows = await db.$queryRawUnsafe<ReserveRow[]>(SQL.reserve, accountId, N, LOCK_INTERVAL);
  const row = rows[0];
  if (!row) return null; // locked / budget exhausted → caller does a dummy verify and answers the uniform 401
  return { slot: Number(row.slot), lockedUntil: row.locked_until, version: row.version, passwordHash: row.password_hash, reservedAt: row.reserved_at };
}

// Stand-in for Argon2id verify (outside any transaction): correct iff the caller holds the right secret for the hash
// captured at RESERVE.
export function verify(reservation: Reservation, expectedHash: string, correct: boolean): boolean {
  return correct && reservation.passwordHash === expectedHash;
}

export async function recordFailure(db: Db, accountId: string, runId: string, slot: number): Promise<void> {
  await db.$executeRawUnsafe(SQL.audit, accountId, 'FAILURE', JSON.stringify({ v: 1, reason: 'BAD_PASSWORD', slot, run: runId }));
}

export type Outcome =
  | 'AUTHENTICATED'
  | 'ACTIVATION_SESSION'
  | 'LOCKED'
  | 'CREDENTIAL_CHANGED'
  | 'ATTEMPT_EXPIRED'
  | 'NOT_ALLOWED';

export interface SuccessResult {
  readonly outcome: Outcome;
  readonly reset: boolean;
  readonly sessionId?: string;
  readonly retries: number;
}

export interface SuccessOptions {
  readonly runId: string;
  readonly tokenHash: string;
  readonly deadline?: string;
  readonly variant?: 'H-b' | 'naive' | 'no-lock-coupling' | 'activation-no-revoke';
  readonly hooks?: {
    readonly afterAccountLock?: () => Promise<void>;
    readonly afterEligibilityRead?: () => Promise<void>;
    readonly beforeCommit?: () => Promise<void>;
  };
}

interface LockCredentialRow {
  password_hash: string;
  version: string;
  must_change_password: boolean;
}
interface EligibilityRow {
  membership_status: string;
  before_left_at: boolean;
  locked_now: boolean;
  within_deadline: boolean;
  account_status: string;
  not_disabled: boolean;
}

const RETRYABLE = ['40P01', '40001'];

function sqlstateOf(error: unknown): string | undefined {
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
  return RETRYABLE.find((code) => text.includes(code));
}

// SUCCESS transaction (READ COMMITTED): lock account → credential, re-read eligibility on DB time, CAS reset,
// issue session, audit — all or nothing. Retries once on deadlock/serialization failure (within the deadline).
export async function success(client: PrismaClient, accountId: string, reservation: Reservation, options: SuccessOptions): Promise<SuccessResult> {
  const variant = options.variant ?? 'H-b';
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.$transaction(
        async (tx): Promise<Omit<SuccessResult, 'retries'>> => {
          if (variant !== 'no-lock-coupling') {
            await tx.$queryRawUnsafe(SQL.lockAccount, accountId);
          }
          await options.hooks?.afterAccountLock?.();
          const [cred] = await tx.$queryRawUnsafe<LockCredentialRow[]>(SQL.lockCredential, accountId);
          const [elig] = await tx.$queryRawUnsafe<EligibilityRow[]>(SQL.readEligibility, accountId, reservation.reservedAt, options.deadline ?? DEADLINE);
          await options.hooks?.afterEligibilityRead?.();
          if (!cred || !elig) throw new Error('account not found');
          const audit = (outcome: string, reason: string, sessionId?: string) =>
            tx.$executeRawUnsafe(SQL.audit, accountId, outcome, JSON.stringify({ v: 1, reason, run: options.runId, slot: reservation.slot, ...(sessionId ? { session: sessionId } : {}) }));

          if (cred.password_hash !== reservation.passwordHash) {
            await audit('FAILURE', 'CREDENTIAL_CHANGED');
            return { outcome: 'CREDENTIAL_CHANGED', reset: false };
          }
          if (variant !== 'naive' && !elig.within_deadline) {
            await audit('FAILURE', 'ATTEMPT_EXPIRED');
            return { outcome: 'ATTEMPT_EXPIRED', reset: false };
          }
          const resetCount = variant === 'naive'
            ? await tx.$executeRawUnsafe(SQL.naiveReset, accountId)
            : await tx.$executeRawUnsafe(SQL.casReset, accountId, reservation.version);
          const reset = resetCount === 1;
          if (elig.locked_now && !reset) {
            await audit('DENIED', 'TEMP_LOCKED');
            return { outcome: 'LOCKED', reset };
          }
          const membershipOk = (elig.membership_status === 'ACTIVE' || elig.membership_status === 'ON_LEAVE') && elig.before_left_at;
          const activation = cred.must_change_password;
          const accountOk = elig.not_disabled && (activation ? ['PROVISIONED', 'ACTIVE'].includes(elig.account_status) : elig.account_status === 'ACTIVE');
          if (!membershipOk || !accountOk) {
            await audit('DENIED', membershipOk ? 'ACCOUNT_NOT_ALLOWED' : 'MEMBERSHIP_NOT_ALLOWED');
            return { outcome: 'NOT_ALLOWED', reset };
          }
          if (activation && variant !== 'activation-no-revoke') {
            await tx.$executeRawUnsafe(SQL.revokeAccountSessions, accountId);
          }
          const [session] = await tx.$queryRawUnsafe<{ session_id: string }[]>(
            SQL.insertSession, accountId, options.tokenHash, activation ? 0 : 1, activation ? '15 minutes' : '10 hours');
          await audit('SUCCESS', activation ? 'PASSWORD_CHANGE_REQUIRED' : 'OK', session?.session_id);
          await options.hooks?.beforeCommit?.();
          return { outcome: activation ? 'ACTIVATION_SESSION' : 'AUTHENTICATED', reset, ...(session ? { sessionId: session.session_id } : {}) };
        },
        { isolationLevel: 'ReadCommitted', timeout: 45_000, maxWait: 15_000 },
      );
      return { ...result, retries: attempt };
    } catch (error) {
      if (attempt === 0 && sqlstateOf(error)) continue; // one retry; the deadline is re-checked inside
      throw error;
    }
  }
}

export interface ValidateRow {
  not_revoked: boolean;
  not_expired: boolean;
  account_status: string;
  not_disabled: boolean;
  membership_status: string;
  before_left_at: boolean;
}

export async function validateSession(db: Db, sessionId: string): Promise<{ usable: boolean; row: ValidateRow | undefined }> {
  const [row] = await db.$queryRawUnsafe<ValidateRow[]>(SQL.validateSession, sessionId);
  const usable = Boolean(row && row.not_revoked && row.not_expired && row.not_disabled && row.account_status === 'ACTIVE'
    && (row.membership_status === 'ACTIVE' || row.membership_status === 'ON_LEAVE') && row.before_left_at);
  return { usable, row };
}

// ---- Negative control: post-increment (read, verify, then count) — no reservation before verify ----
export async function postIncrementAttempt(client: PrismaClient, accountId: string, onVerify: () => Promise<void>): Promise<'VERIFIED' | 'REFUSED'> {
  const [row] = await client.$queryRawUnsafe<{ locked: boolean; c: number }[]>(
    `SELECT (locked_until IS NOT NULL AND locked_until > statement_timestamp()) AS locked, failed_attempt_count AS c
       FROM iam.iam_credentials WHERE user_account_id = $1::uuid`, accountId);
  if (!row || row.locked || Number(row.c) >= N) return 'REFUSED';
  await onVerify(); // real verification would happen here (wrong password)
  await client.$executeRawUnsafe(
    `UPDATE iam.iam_credentials SET failed_attempt_count = failed_attempt_count + 1,
            locked_until = CASE WHEN failed_attempt_count + 1 >= $2::int THEN statement_timestamp() + $3::interval ELSE locked_until END,
            updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
      WHERE user_account_id = $1::uuid`, accountId, N, LOCK_INTERVAL);
  return 'VERIFIED';
}
