import { randomUUID } from 'node:crypto';
import { sqlstateOf } from '../sqlstate.js';
import type { PasswordHasher } from '../passwordHasher.js';
import { ProvisioningError } from './provisionAccount.js';
import type { ProvisioningCode } from './provisionAccount.js';
import type { SqlExecutor } from './provisionAccount.js';
import { generateTemporaryPassword } from './temporaryPassword.js';

// P-4e recovery — re-issue a temporary password after loss or suspected exposure.
// talo_provisioner has NO direct UPDATE on IAM (decision). The work is done by the SECURITY DEFINER function
// iam.reissue_temporary_credential (database/scripts/auth-p4e-recovery/; installed and accepted on talo_mos_v4_test only):
// target row locked FOR UPDATE, credential replaced with must_change_password, every session revoked, audit
// CREDENTIAL_REISSUED — atomically. This client generates the CSPRNG temporary password, hashes it with Argon2id (the
// database never sees plaintext), checks the PHC string against the same rule as the function, and calls it.
// Identity model (current stage): the accountable principal is the controlled service credential talo_provisioner;
// no human operator is claimed in the audit.

export const REISSUE_FUNCTION_SIGNATURE = 'iam.reissue_temporary_credential(text,text,uuid)';
export const REISSUE_CALL = `
  SELECT reissued_account_id::text AS user_account_id, revoked_sessions::text AS revoked_sessions
    FROM iam.reissue_temporary_credential($1, $2, $3::uuid)`;

// Must stay identical to the pattern in 03-create-function.sql (checked by test/unit/auth/reissue-proposal.test.ts).
export const REISSUE_PHC_PATTERN = String.raw`^\$argon2id\$v=19\$m=([0-9]{5,7}),t=([0-9]{1,2}),p=([0-9]{1,2})\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$`;
export const REISSUE_PHC_BOUNDS = Object.freeze({ m: [19456, 1048576], t: [2, 10], p: [1, 16], maxLength: 128 });

export function isAcceptableReissueHash(phc: string): boolean {
  if (phc.length > REISSUE_PHC_BOUNDS.maxLength) return false;
  const match = new RegExp(REISSUE_PHC_PATTERN).exec(phc);
  if (!match) return false;
  const [m, t, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const within = (value: number, [low, high]: readonly number[]) => value >= (low ?? 0) && value <= (high ?? 0);
  return within(m, REISSUE_PHC_BOUNDS.m) && within(t, REISSUE_PHC_BOUNDS.t) && within(p, REISSUE_PHC_BOUNDS.p);
}

// Custom SQLSTATEs raised by the function → operator messages (no detail beyond the refusal class).
const CODES: Record<string, ProvisioningCode> = {
  TA403: 'REISSUE_REFUSED', TA404: 'REISSUE_NOT_FOUND', TA409: 'REISSUE_NOT_ELIGIBLE', TA422: 'INVALID_INPUT',
  '42883': 'REISSUE_UNAVAILABLE', '42501': 'REISSUE_UNAVAILABLE', '55P03': 'REISSUE_BUSY',
};
const REFUSALS: Record<string, string> = {
  TA403: 'refused (caller not allowed or privileged account)',
  TA404: 'account not found',
  TA409: 'account, membership or credential not eligible for re-issue',
  TA422: 'invalid input',
  '42883': 'recovery function is not installed',
  '42501': 'not allowed to execute the recovery function',
  '55P03': 'account is busy (lock timeout); retry later',
};

export interface ReissueResult {
  readonly userAccountId: string;
  readonly username: string;
  readonly revokedSessions: number;
  readonly requestId: string;
  readonly temporaryPassword: string; // show once to the operator; never log or store
}

export async function reissueTemporaryPassword(db: SqlExecutor, hasher: PasswordHasher, rawUsername: string, requestIdOverride?: string): Promise<ReissueResult> {
  const username = rawUsername.trim();
  if (username.length < 1 || username.length > 80 || /[\u0000-\u001F\u007F]/.test(username)) {
    throw new ProvisioningError('username must be 1-80 characters without control characters');
  }
  const requestId = requestIdOverride ?? randomUUID();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hasher.hashPassword(temporaryPassword); // Argon2id, outside the transaction
  if (!isAcceptableReissueHash(passwordHash)) throw new ProvisioningError('hash does not match the accepted Argon2id PHC rule');
  let rows: Record<string, string | null>[];
  try {
    rows = await db.query(REISSUE_CALL, [username, passwordHash, requestId]);
  } catch (error) {
    const code = sqlstateOf(error);
    const refusal = code ? REFUSALS[code] : undefined;
    throw new ProvisioningError(`re-issue failed: ${refusal ?? 'database error'} (requestId ${requestId}${code ? `, ${code}` : ''})`, (code ? CODES[code] : undefined) ?? 'REISSUE_UNAVAILABLE');
  }
  const [row] = rows;
  if (!row?.user_account_id) throw new ProvisioningError(`re-issue returned no row (requestId ${requestId})`, 'NO_ROW');
  return { userAccountId: row.user_account_id, username, revokedSessions: Number(row.revoked_sessions ?? 0), requestId, temporaryPassword };
}
