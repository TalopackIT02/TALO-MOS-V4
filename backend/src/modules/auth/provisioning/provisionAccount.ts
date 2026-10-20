import { randomUUID } from 'node:crypto';
import { USERNAME_MAX_LENGTH } from '../auth.settings.js';
import type { PasswordHasher } from '../passwordHasher.js';
import { hasControlCharacters } from '../passwordPolicy.js';
import { generateTemporaryPassword } from './temporaryPassword.js';

// P-4e — initial account provisioning by IT, executed as database role `talo_provisioner` (AUTH-DB-F2 grants only:
// SELECT/INSERT memberships and accounts, INSERT credentials and audit). One transaction creates (or reuses) the
// membership, inserts the account as PROVISIONED and the credential with must_change_password = true and the Argon2id hash
// of a CSPRNG temporary password, and audits ACCOUNT_PROVISIONED. The first login opens an Activation Session; the new
// password must differ from the temporary one (SAME_AS_CURRENT).
//
// Re-issue of a temporary password is a separate path: reissueTemporaryPassword.ts → SECURITY DEFINER function
// iam.reissue_temporary_credential (database/scripts/auth-p4e-recovery, installed on talo_mos_v4_test).
// IAM Phase B: the same service is called by the IAM Management API (AppShell) with a ProvisionContext, so the audit row
// names the administrator (actor_account_id, created_by_account_id); the CLI passes no context (actor NULL, as before).

export interface SqlExecutor {
  // Rows with text values (every selected column is cast to text in the SQL below).
  query(sql: string, params: readonly (string | null)[]): Promise<Record<string, string | null>[]>;
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface ProvisionInput {
  readonly employeeCode: string;
  readonly fullName: string;
  readonly username: string;
  readonly joinedAt: string; // YYYY-MM-DD
  readonly employeeId?: string; // HR employee UUID; generated when the HR module does not exist yet
}

export interface ProvisionResult {
  readonly membershipId: string;
  readonly userAccountId: string;
  readonly username: string;
  readonly membershipCreated: boolean;
  readonly temporaryPassword: string; // show once to the operator; never log or store
}

// Stable refusal classes for callers that must not parse messages (IAM Management API); the CLI prints the message.
export type ProvisioningCode =
  | 'INVALID_INPUT' | 'USERNAME_TAKEN' | 'MEMBERSHIP_NOT_ACTIVE' | 'MEMBERSHIP_HAS_ACCOUNT' | 'NO_ROW'
  | 'REISSUE_REFUSED' | 'REISSUE_NOT_FOUND' | 'REISSUE_NOT_ELIGIBLE' | 'REISSUE_UNAVAILABLE' | 'REISSUE_BUSY' | 'CONFIGURATION';

export class ProvisioningError extends Error {
  constructor(message: string, readonly code: ProvisioningCode = 'INVALID_INPUT') {
    super(message);
    this.name = 'ProvisioningError';
  }
}

// Who asked for the provisioning (IAM Management API). Absent for the IT CLI.
export interface ProvisionContext {
  readonly actorAccountId: string;
  readonly requestId: string;
  readonly ua: string;
}

export const PROVISIONING_SQL = {
  usernameTaken: `SELECT count(*)::text AS n FROM iam.iam_user_accounts WHERE lower(username) = lower($1)`,
  membershipByCode: `SELECT membership_id::text AS membership_id, membership_status FROM iam.iam_memberships WHERE employee_code = $1`,
  currentAccounts: `SELECT count(*)::text AS n FROM iam.iam_user_accounts WHERE membership_id = $1::uuid AND disabled_at IS NULL`,
  insertMembership: `
    INSERT INTO iam.iam_memberships (employee_id, employee_code, full_name, membership_status, joined_at)
    VALUES ($1::uuid, $2, $3, 'ACTIVE', $4::date) RETURNING membership_id::text AS membership_id`,
  insertAccount: `
    INSERT INTO iam.iam_user_accounts (membership_id, username, account_status, created_by_account_id)
    VALUES ($1::uuid, $2, 'PROVISIONED', $3::uuid) RETURNING user_account_id::text AS user_account_id`,
  insertCredential: `
    INSERT INTO iam.iam_credentials (user_account_id, password_hash, must_change_password) VALUES ($1::uuid, $2, true)`,
  audit: `
    INSERT INTO iam.iam_audit_logs (actor_account_id, membership_id, session_id, action_code, target_type, target_id, outcome, occurred_at, metadata)
    VALUES ($4::uuid, $1::uuid, NULL, 'ACCOUNT_PROVISIONED', 'USER_ACCOUNT', $2::uuid, 'SUCCESS', statement_timestamp(), $3::jsonb)`,
} as const;

function validate(input: ProvisionInput): ProvisionInput {
  const username = input.username.trim();
  const employeeCode = input.employeeCode.trim();
  const fullName = input.fullName.trim();
  if (username.length < 1 || username.length > USERNAME_MAX_LENGTH || hasControlCharacters(username) || /\s/.test(username)) {
    throw new ProvisioningError('username must be 1-80 characters without spaces or control characters');
  }
  if (employeeCode.length < 1 || employeeCode.length > 50 || hasControlCharacters(employeeCode)) throw new ProvisioningError('employee code must be 1-50 characters');
  if (fullName.length < 1 || fullName.length > 200 || hasControlCharacters(fullName)) throw new ProvisioningError('full name must be 1-200 characters');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.joinedAt)) throw new ProvisioningError('joined-at must be YYYY-MM-DD');
  if (input.employeeId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.employeeId)) {
    throw new ProvisioningError('employee id must be a UUID');
  }
  return { ...input, username, employeeCode, fullName };
}

export async function provisionAccount(db: SqlExecutor, hasher: PasswordHasher, raw: ProvisionInput, context?: ProvisionContext): Promise<ProvisionResult> {
  const input = validate(raw);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hasher.hashPassword(temporaryPassword); // Argon2id, outside the transaction
  return db.transaction(async (tx) => {
    const [taken] = await tx.query(PROVISIONING_SQL.usernameTaken, [input.username]);
    if (taken?.n !== '0') throw new ProvisioningError('username already exists', 'USERNAME_TAKEN');
    const [existing] = await tx.query(PROVISIONING_SQL.membershipByCode, [input.employeeCode]);
    let membershipId: string;
    let membershipCreated = false;
    if (existing?.membership_id) {
      if (existing.membership_status !== 'ACTIVE' && existing.membership_status !== 'ON_LEAVE') throw new ProvisioningError('membership is not active', 'MEMBERSHIP_NOT_ACTIVE');
      const [current] = await tx.query(PROVISIONING_SQL.currentAccounts, [existing.membership_id]);
      if (current?.n !== '0') throw new ProvisioningError('membership already has a current account', 'MEMBERSHIP_HAS_ACCOUNT');
      membershipId = existing.membership_id;
    } else {
      const [created] = await tx.query(PROVISIONING_SQL.insertMembership, [input.employeeId ?? randomUUID(), input.employeeCode, input.fullName, input.joinedAt]);
      if (!created?.membership_id) throw new ProvisioningError('membership insert returned no id', 'NO_ROW');
      membershipId = created.membership_id;
      membershipCreated = true;
    }
    const [account] = await tx.query(PROVISIONING_SQL.insertAccount, [membershipId, input.username, context?.actorAccountId ?? null]);
    if (!account?.user_account_id) throw new ProvisioningError('account insert returned no id', 'NO_ROW');
    await tx.query(PROVISIONING_SQL.insertCredential, [account.user_account_id, passwordHash]);
    const metadata = JSON.stringify({ v: 1, reason: 'OK', requestId: context?.requestId ?? randomUUID(), ip: null, ua: context?.ua ?? 'talo-provision-cli' });
    await tx.query(PROVISIONING_SQL.audit, [membershipId, account.user_account_id, metadata, context?.actorAccountId ?? null]);
    return { membershipId, userAccountId: account.user_account_id, username: input.username, membershipCreated, temporaryPassword };
  });
}
