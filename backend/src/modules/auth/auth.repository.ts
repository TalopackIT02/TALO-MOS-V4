import type { Prisma, PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import type { AuditEntry } from './audit.js';
import type { AuthSettings } from './auth.settings.js';
import { ASSURANCE_ACTIVATION, ASSURANCE_AUTHENTICATED } from './auth.settings.js';

// Every statement of the authentication module, executed by `talo_app` (no grant beyond AUTH-DB-F2).
// SQL follows the H-b protocol verified on PostgreSQL in AUTH-SC5-V1 (backend/test/model/sc5/sc5-protocol.sql):
// RESERVE is one autocommit UPDATE; SUCCESS and first-change lock account → credential (FOR NO KEY UPDATE), re-read on a
// fresh snapshot, write, revoke, audit, commit. All security time is statement_timestamp(); versions travel as text.
// Writers of iam_credentials always bump updated_at = GREATEST(statement_timestamp(), updated_at + 1 µs).

type Db = PrismaClient | Prisma.TransactionClient;

// Used by the shadow RESERVE for unknown usernames / accounts without credential (IB-1): same statement, zero rows.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const AUTH_SQL = {
  lookup: `
    SELECT a.user_account_id::text AS user_account_id, (c.user_account_id IS NOT NULL) AS has_credential
      FROM iam.iam_user_accounts AS a
      LEFT JOIN iam.iam_credentials AS c ON c.user_account_id = a.user_account_id
     WHERE lower(a.username) = lower($1)`,
  // IB-2: the H-b UPDATE is unchanged. It is wrapped so that EVERY RESERVE — slot granted, locked/exhausted, or the
  // shadow call for an unknown username — writes WAL (one small transactional logical message, no table touched) and so
  // pays the same synchronous WAL flush at commit. Before, only a granted slot wrote WAL and its commit was ~3 ms slower
  // (measured, AUC 1.0 on the RESERVE phase). Durability is unchanged (no synchronous_commit change).
  // Always returns exactly one row; slot IS NULL means "no reservation".
  reserve: `
    WITH reserved AS (
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
    RETURNING c.failed_attempt_count AS slot, c.updated_at::text AS version, c.password_hash,
              statement_timestamp()::text AS reserved_at)
    SELECT r.slot, r.version, r.password_hash, r.reserved_at, x.lsn::text AS lsn
      FROM (SELECT pg_logical_emit_message(true, 'talo.auth.reserve', '') AS lsn) AS x LEFT JOIN reserved AS r ON true`,
  withinDeadline: `SELECT (statement_timestamp() - $1::timestamptz) <= $2::interval AS within`,
  lockAccount: `
    SELECT a.user_account_id FROM iam.iam_user_accounts AS a WHERE a.user_account_id = $1::uuid FOR NO KEY UPDATE`,
  lockCredential: `
    SELECT c.password_hash, c.updated_at::text AS version, c.must_change_password
      FROM iam.iam_credentials AS c WHERE c.user_account_id = $1::uuid FOR NO KEY UPDATE`,
  readEligibility: `
    SELECT a.username, a.account_status, (a.disabled_at IS NOT NULL) AS disabled, a.membership_id::text AS membership_id,
           m.full_name, m.employee_code, m.membership_status,
           (m.left_at IS NOT NULL AND m.left_at <= (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS left_date_passed,
           (c.locked_until IS NOT NULL AND c.locked_until > statement_timestamp()) AS locked_now,
           (statement_timestamp() - $2::timestamptz) <= $3::interval AS within_deadline
      FROM iam.iam_user_accounts AS a
      JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
      JOIN iam.iam_credentials AS c ON c.user_account_id = a.user_account_id
     WHERE a.user_account_id = $1::uuid`,
  casReset: `
    UPDATE iam.iam_credentials
       SET failed_attempt_count = 0, locked_until = NULL,
           updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
     WHERE user_account_id = $1::uuid AND updated_at = $2::timestamptz`,
  revokeAccountSessions: `
    UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE user_account_id = $1::uuid AND revoked_at IS NULL`,
  insertSession: `
    INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, assurance_level_snapshot, created_at, expires_at, last_seen_at)
    VALUES ($1::uuid, $2, $3::smallint, statement_timestamp(), statement_timestamp() + $4::interval, statement_timestamp())
    RETURNING session_id::text AS session_id, expires_at, statement_timestamp() AS server_time`,
  audit: `
    INSERT INTO iam.iam_audit_logs (actor_account_id, membership_id, session_id, action_code, target_type, target_id, outcome, occurred_at, metadata)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7, statement_timestamp(), $8::jsonb)`,
  findSession: `
    SELECT s.session_id::text AS session_id, s.user_account_id::text AS user_account_id,
           s.assurance_level_snapshot AS assurance_level, s.expires_at, s.last_seen_at,
           (s.revoked_at IS NOT NULL) AS revoked,
           (s.expires_at <= statement_timestamp()) AS expired,
           (s.last_seen_at IS NULL OR s.last_seen_at <= statement_timestamp() - $2::interval) AS idle,
           (s.created_at <= statement_timestamp() - $3::interval) AS older_than_activation,
           a.username, a.account_status, (a.disabled_at IS NOT NULL) AS disabled, a.membership_id::text AS membership_id,
           m.full_name, m.membership_status,
           (m.left_at IS NOT NULL AND m.left_at <= (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS left_date_passed,
           c.must_change_password,
           (SELECT count(*)::int FROM iam.iam_sessions AS l
             WHERE l.user_account_id = s.user_account_id AND l.revoked_at IS NULL AND l.expires_at > statement_timestamp()) AS live_sessions,
           statement_timestamp() AS server_time
      FROM iam.iam_sessions AS s
      JOIN iam.iam_user_accounts AS a ON a.user_account_id = s.user_account_id
      JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
      JOIN iam.iam_credentials AS c ON c.user_account_id = a.user_account_id
     WHERE s.session_token_hash = $1`,
  touchSession: `
    UPDATE iam.iam_sessions SET last_seen_at = statement_timestamp()
     WHERE session_id = $1::uuid AND revoked_at IS NULL AND last_seen_at <= statement_timestamp() - $2::interval
    RETURNING last_seen_at`,
  revokeSession: `
    UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE session_id = $1::uuid AND revoked_at IS NULL`,
  revokeLiveSessionByToken: `
    UPDATE iam.iam_sessions AS s SET revoked_at = statement_timestamp()
      FROM iam.iam_user_accounts AS a
     WHERE s.session_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp()
       AND a.user_account_id = s.user_account_id
    RETURNING s.session_id::text AS session_id, s.user_account_id::text AS user_account_id, a.membership_id::text AS membership_id`,
  readPasswordContext: `
    SELECT c.password_hash, a.username, m.employee_code, m.full_name
      FROM iam.iam_credentials AS c
      JOIN iam.iam_user_accounts AS a ON a.user_account_id = c.user_account_id
      JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
     WHERE c.user_account_id = $1::uuid`,
  sessionStillActivation: `
    SELECT (revoked_at IS NULL AND expires_at > statement_timestamp() AND created_at > statement_timestamp() - $2::interval) AS live
      FROM iam.iam_sessions WHERE session_id = $1::uuid`,
  changePassword: `
    UPDATE iam.iam_credentials
       SET password_hash = $2, password_changed_at = statement_timestamp(), must_change_password = false,
           failed_attempt_count = 0, locked_until = NULL,
           updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
     WHERE user_account_id = $1::uuid AND must_change_password = true AND password_hash = $3`,
  activateAccount: `
    UPDATE iam.iam_user_accounts SET account_status = 'ACTIVE', activated_at = statement_timestamp()
     WHERE user_account_id = $1::uuid AND account_status = 'PROVISIONED'`,
};

// ---------- result types ----------

export interface LookupResult {
  readonly userAccountId: string;
  readonly hasCredential: boolean;
}

export interface Reservation {
  readonly slot: number;
  readonly version: string;
  readonly passwordHash: string;
  readonly reservedAt: string;
}

export interface Eligibility {
  readonly username: string;
  readonly fullName: string;
  readonly employeeCode: string;
  readonly membershipId: string;
  readonly accountStatus: string;
  readonly disabled: boolean;
  readonly membershipStatus: string;
  readonly leftDatePassed: boolean;
}

export type DeniedReason = 'ACCOUNT_DISABLED' | 'ACCOUNT_LOCKED' | 'MEMBERSHIP_EXITED' | 'MEMBERSHIP_LEFT_DATE_PASSED';

// AD-3: ACTIVE / ON_LEAVE memberships with left_at null or after today may log in; LOCKED / DISABLED never.
// An activation (must_change_password) requires PROVISIONED or ACTIVE; a normal login requires ACTIVE.
export function deniedReason(e: Eligibility, activation: boolean): DeniedReason | null {
  if (e.membershipStatus !== 'ACTIVE' && e.membershipStatus !== 'ON_LEAVE') return 'MEMBERSHIP_EXITED';
  if (e.leftDatePassed) return 'MEMBERSHIP_LEFT_DATE_PASSED';
  if (e.accountStatus === 'LOCKED') return 'ACCOUNT_LOCKED';
  if (e.disabled || e.accountStatus === 'DISABLED') return 'ACCOUNT_DISABLED';
  const allowed = activation ? e.accountStatus === 'PROVISIONED' || e.accountStatus === 'ACTIVE' : e.accountStatus === 'ACTIVE';
  return allowed ? null : 'ACCOUNT_DISABLED';
}

export type LoginTxResult =
  | { readonly kind: 'CREDENTIAL_CHANGED' }
  | { readonly kind: 'ATTEMPT_EXPIRED' }
  | { readonly kind: 'TEMP_LOCKED' }
  | { readonly kind: 'DENIED'; readonly reason: DeniedReason }
  | {
      readonly kind: 'SESSION';
      readonly activation: boolean;
      readonly reset: boolean;
      readonly sessionId: string;
      readonly expiresAt: Date;
      readonly serverTime: Date;
      readonly eligibility: Eligibility;
    };

export interface SessionRow {
  readonly sessionId: string;
  readonly userAccountId: string;
  readonly assuranceLevel: number | null;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revoked: boolean;
  readonly expired: boolean;
  readonly idle: boolean;
  readonly olderThanActivation: boolean;
  readonly username: string;
  readonly fullName: string;
  readonly membershipId: string;
  readonly mustChangePassword: boolean;
  readonly liveSessions: number;
  readonly serverTime: Date;
  readonly eligibility: Eligibility;
}

export interface PasswordContextRow {
  readonly passwordHash: string;
  readonly username: string;
  readonly employeeCode: string;
  readonly fullName: string;
}

export type FirstChangeTxResult =
  | { readonly kind: 'SESSION_GONE' }
  | { readonly kind: 'DENIED'; readonly reason: DeniedReason; readonly membershipId: string }
  | { readonly kind: 'CONCURRENT_CHANGE'; readonly membershipId: string }
  | { readonly kind: 'CHANGED'; readonly activated: boolean; readonly membershipId: string };

// Test-only seams to inject faults (CT-R*, IB-1). Production never passes hooks.
export interface TxHooks {
  readonly beforeCommit?: () => Promise<void>;
}

// ---------- repository ----------

export interface AuthRepository {
  lookup(username: string): Promise<LookupResult | null>;
  reserve(userAccountId: string | null, settings: AuthSettings): Promise<Reservation | null>;
  withinDeadline(reservedAt: string, settings: AuthSettings): Promise<boolean>;
  insertAudit(entry: AuditEntry): Promise<void>;
  loginSuccess(input: LoginTxInput, settings: AuthSettings, hooks?: TxHooks): Promise<LoginTxResult>;
  findSession(tokenHash: string, settings: AuthSettings): Promise<SessionRow | null>;
  touchSession(sessionId: string, settings: AuthSettings): Promise<Date | null>;
  revokeSession(sessionId: string): Promise<boolean>;
  revokeLiveSessionByToken(tokenHash: string): Promise<{ sessionId: string; userAccountId: string; membershipId: string } | null>;
  readPasswordContext(userAccountId: string): Promise<PasswordContextRow | null>;
  firstChange(input: FirstChangeTxInput, settings: AuthSettings, hooks?: TxHooks): Promise<FirstChangeTxResult>;
}

export interface LoginTxInput {
  readonly userAccountId: string;
  readonly reservation: Reservation;
  readonly tokenHash: string;
  readonly audit: (kind: LoginAuditKind, extra: { sessionId?: string; membershipId?: string }) => AuditEntry;
}

export type LoginAuditKind =
  | 'CREDENTIAL_CHANGED'
  | 'ATTEMPT_EXPIRED'
  | 'TEMP_LOCKED'
  | DeniedReason
  | 'OK'
  | 'PASSWORD_CHANGE_REQUIRED';

export interface FirstChangeTxInput {
  readonly userAccountId: string;
  readonly sessionId: string;
  readonly expectedHash: string;
  readonly newHash: string;
  readonly audit: (kind: FirstChangeAuditKind, membershipId: string) => AuditEntry;
}

export type FirstChangeAuditKind = 'OK' | 'ACTIVATED' | 'CONCURRENT_CHANGE' | 'ACCOUNT_NOT_ALLOWED';

interface ReserveRow { slot: number | null; version: string; password_hash: string; reserved_at: string }
interface CredentialLockRow { password_hash: string; version: string; must_change_password: boolean }
interface EligibilityRow {
  username: string; account_status: string; disabled: boolean; membership_id: string; full_name: string; employee_code: string;
  membership_status: string; left_date_passed: boolean; locked_now: boolean; within_deadline: boolean;
}
interface FindSessionRow {
  session_id: string; user_account_id: string; assurance_level: number | null; expires_at: Date; last_seen_at: Date | null;
  revoked: boolean; expired: boolean; idle: boolean; older_than_activation: boolean; username: string; account_status: string;
  disabled: boolean; membership_id: string; full_name: string; membership_status: string; left_date_passed: boolean;
  must_change_password: boolean; live_sessions: number; server_time: Date;
}

function eligibilityOf(row: EligibilityRow): Eligibility {
  return {
    username: row.username,
    fullName: row.full_name,
    employeeCode: row.employee_code,
    membershipId: row.membership_id,
    accountStatus: row.account_status,
    disabled: row.disabled,
    membershipStatus: row.membership_status,
    leftDatePassed: row.left_date_passed,
  };
}

async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  // INSERT without RETURNING (F2-07): talo_app has INSERT only on the audit table.
  await db.$executeRawUnsafe(AUTH_SQL.audit, entry.actorAccountId, entry.membershipId, entry.sessionId, entry.action,
    entry.targetType, entry.targetId, entry.outcome, JSON.stringify(entry.metadata));
}

const TX_OPTIONS = { isolationLevel: 'ReadCommitted', timeout: 45_000, maxWait: 15_000 } as const;

export class PrismaAuthRepository implements AuthRepository {
  private readonly db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
  }

  async lookup(username: string): Promise<LookupResult | null> {
    const [row] = await this.db.$queryRawUnsafe<{ user_account_id: string; has_credential: boolean }[]>(AUTH_SQL.lookup, username);
    return row ? { userAccountId: row.user_account_id, hasCredential: row.has_credential } : null;
  }

  async reserve(userAccountId: string | null, settings: AuthSettings): Promise<Reservation | null> {
    const rows = await this.db.$queryRawUnsafe<ReserveRow[]>(AUTH_SQL.reserve, userAccountId ?? NIL_UUID, settings.maxAttempts, settings.lockInterval);
    const row = rows[0];
    if (!row || row.slot === null || userAccountId === null) return null;
    return { slot: Number(row.slot), version: row.version, passwordHash: row.password_hash, reservedAt: row.reserved_at };
  }

  async withinDeadline(reservedAt: string, settings: AuthSettings): Promise<boolean> {
    const [row] = await this.db.$queryRawUnsafe<{ within: boolean }[]>(AUTH_SQL.withinDeadline, reservedAt, settings.attemptDeadline);
    return row?.within === true;
  }

  async insertAudit(entry: AuditEntry): Promise<void> {
    await writeAudit(this.db, entry);
  }

  async loginSuccess(input: LoginTxInput, settings: AuthSettings, hooks?: TxHooks): Promise<LoginTxResult> {
    const { userAccountId, reservation } = input;
    return this.db.$transaction(async (tx): Promise<LoginTxResult> => {
      await tx.$queryRawUnsafe(AUTH_SQL.lockAccount, userAccountId);
      const [cred] = await tx.$queryRawUnsafe<CredentialLockRow[]>(AUTH_SQL.lockCredential, userAccountId);
      // New statement after the locks: a fresh READ COMMITTED snapshot.
      const [row] = await tx.$queryRawUnsafe<EligibilityRow[]>(AUTH_SQL.readEligibility, userAccountId, reservation.reservedAt, settings.attemptDeadline);
      if (!cred || !row) throw new Error('account vanished during login');
      const eligibility = eligibilityOf(row);
      const membershipId = eligibility.membershipId;
      const audit = async (kind: LoginAuditKind, sessionId?: string) => {
        await writeAudit(tx, input.audit(kind, { membershipId, ...(sessionId ? { sessionId } : {}) }));
      };

      let result: LoginTxResult;
      if (cred.password_hash !== reservation.passwordHash) {
        await audit('CREDENTIAL_CHANGED');
        result = { kind: 'CREDENTIAL_CHANGED' };
      } else if (!row.within_deadline) {
        await audit('ATTEMPT_EXPIRED');
        result = { kind: 'ATTEMPT_EXPIRED' };
      } else {
        // CAS reset: only when nothing wrote the credential since this attempt's RESERVE.
        const reset = (await tx.$executeRawUnsafe(AUTH_SQL.casReset, userAccountId, reservation.version)) === 1;
        const activation = cred.must_change_password;
        const denied = deniedReason(eligibility, activation);
        if (row.locked_now && !reset) {
          await audit('TEMP_LOCKED');
          result = { kind: 'TEMP_LOCKED' };
        } else if (denied) {
          await audit(denied);
          result = { kind: 'DENIED', reason: denied };
        } else {
          if (activation) await tx.$executeRawUnsafe(AUTH_SQL.revokeAccountSessions, userAccountId); // AS-1
          const [session] = await tx.$queryRawUnsafe<{ session_id: string; expires_at: Date; server_time: Date }[]>(
            AUTH_SQL.insertSession, userAccountId, input.tokenHash,
            activation ? ASSURANCE_ACTIVATION : ASSURANCE_AUTHENTICATED,
            activation ? settings.activationTtl : settings.sessionTtl);
          if (!session) throw new Error('session insert returned no row');
          await audit(activation ? 'PASSWORD_CHANGE_REQUIRED' : 'OK', session.session_id);
          result = {
            kind: 'SESSION', activation, reset, sessionId: session.session_id,
            expiresAt: session.expires_at, serverTime: session.server_time, eligibility,
          };
        }
      }
      await hooks?.beforeCommit?.();
      return result;
    }, TX_OPTIONS);
  }

  async findSession(tokenHash: string, settings: AuthSettings): Promise<SessionRow | null> {
    const [row] = await this.db.$queryRawUnsafe<FindSessionRow[]>(AUTH_SQL.findSession, tokenHash, settings.idleTimeout, settings.activationTtl);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userAccountId: row.user_account_id,
      assuranceLevel: row.assurance_level === null ? null : Number(row.assurance_level),
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      revoked: row.revoked,
      expired: row.expired,
      idle: row.idle,
      olderThanActivation: row.older_than_activation,
      username: row.username,
      fullName: row.full_name,
      membershipId: row.membership_id,
      mustChangePassword: row.must_change_password,
      liveSessions: Number(row.live_sessions),
      serverTime: row.server_time,
      eligibility: {
        username: row.username, fullName: row.full_name, employeeCode: '', membershipId: row.membership_id,
        accountStatus: row.account_status, disabled: row.disabled, membershipStatus: row.membership_status,
        leftDatePassed: row.left_date_passed,
      },
    };
  }

  async touchSession(sessionId: string, settings: AuthSettings): Promise<Date | null> {
    const [row] = await this.db.$queryRawUnsafe<{ last_seen_at: Date }[]>(AUTH_SQL.touchSession, sessionId, settings.touchInterval);
    return row?.last_seen_at ?? null;
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    return (await this.db.$executeRawUnsafe(AUTH_SQL.revokeSession, sessionId)) === 1;
  }

  async revokeLiveSessionByToken(tokenHash: string): Promise<{ sessionId: string; userAccountId: string; membershipId: string } | null> {
    const [row] = await this.db.$queryRawUnsafe<{ session_id: string; user_account_id: string; membership_id: string }[]>(
      AUTH_SQL.revokeLiveSessionByToken, tokenHash);
    return row ? { sessionId: row.session_id, userAccountId: row.user_account_id, membershipId: row.membership_id } : null;
  }

  async readPasswordContext(userAccountId: string): Promise<PasswordContextRow | null> {
    const [row] = await this.db.$queryRawUnsafe<{ password_hash: string; username: string; employee_code: string; full_name: string }[]>(
      AUTH_SQL.readPasswordContext, userAccountId);
    return row ? { passwordHash: row.password_hash, username: row.username, employeeCode: row.employee_code, fullName: row.full_name } : null;
  }

  async firstChange(input: FirstChangeTxInput, settings: AuthSettings, hooks?: TxHooks): Promise<FirstChangeTxResult> {
    const { userAccountId } = input;
    return this.db.$transaction(async (tx): Promise<FirstChangeTxResult> => {
      await tx.$queryRawUnsafe(AUTH_SQL.lockAccount, userAccountId);
      const [cred] = await tx.$queryRawUnsafe<CredentialLockRow[]>(AUTH_SQL.lockCredential, userAccountId);
      const [live] = await tx.$queryRawUnsafe<{ live: boolean }[]>(AUTH_SQL.sessionStillActivation, input.sessionId, settings.activationTtl);
      const [row] = await tx.$queryRawUnsafe<EligibilityRow[]>(AUTH_SQL.readEligibility, userAccountId, new Date(0).toISOString(), settings.attemptDeadline);
      if (!cred || !row) throw new Error('account vanished during first change');
      const eligibility = eligibilityOf(row);
      const membershipId = eligibility.membershipId;

      let result: FirstChangeTxResult;
      if (!live?.live || !cred.must_change_password) {
        result = cred.must_change_password ? { kind: 'SESSION_GONE' } : { kind: 'CONCURRENT_CHANGE', membershipId };
        if (result.kind === 'CONCURRENT_CHANGE') await writeAudit(tx, input.audit('CONCURRENT_CHANGE', membershipId));
      } else {
        const denied = deniedReason(eligibility, true);
        if (denied) {
          await writeAudit(tx, input.audit('ACCOUNT_NOT_ALLOWED', membershipId));
          result = { kind: 'DENIED', reason: denied, membershipId };
        } else {
          // CAS on the hash used for the SAME_AS_CURRENT check (re-read after the locks).
          const changed = cred.password_hash === input.expectedHash
            && (await tx.$executeRawUnsafe(AUTH_SQL.changePassword, userAccountId, input.newHash, input.expectedHash)) === 1;
          if (!changed) {
            await writeAudit(tx, input.audit('CONCURRENT_CHANGE', membershipId));
            result = { kind: 'CONCURRENT_CHANGE', membershipId };
          } else {
            const activated = (await tx.$executeRawUnsafe(AUTH_SQL.activateAccount, userAccountId)) === 1; // AD-2 L1
            await tx.$executeRawUnsafe(AUTH_SQL.revokeAccountSessions, userAccountId); // V1: all sessions, this one included
            await writeAudit(tx, input.audit('OK', membershipId));
            if (activated) await writeAudit(tx, input.audit('ACTIVATED', membershipId));
            result = { kind: 'CHANGED', activated, membershipId };
          }
        }
      }
      await hooks?.beforeCommit?.();
      return result;
    }, TX_OPTIONS);
  }
}
