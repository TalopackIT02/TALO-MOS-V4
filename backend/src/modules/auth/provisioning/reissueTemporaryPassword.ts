import { randomUUID } from 'node:crypto';
import { sqlstateOf } from '../sqlstate.js';
import type { PasswordHasher } from '../passwordHasher.js';
import { ProvisioningError } from './provisionAccount.js';
import type { SqlExecutor } from './provisionAccount.js';
import { generateTemporaryPassword } from './temporaryPassword.js';

// P-4e recovery — re-issue a temporary password after loss or suspected exposure.
// talo_provisioner has NO direct UPDATE on IAM (decision). The work is done by the SECURITY DEFINER function
// iam.reissue_temporary_credential (database/scripts/auth-p4e-recovery/, PROPOSAL — not installed yet): writer protocol
// (target row locked FOR NO KEY UPDATE), credential replaced with must_change_password, every session revoked, audit
// CREDENTIAL_REISSUED — atomically. This client only generates the CSPRNG temporary password, hashes it with Argon2id
// (the database never sees plaintext) and calls the function.

export const REISSUE_FUNCTION_SIGNATURE = 'iam.reissue_temporary_credential(text,text,uuid,uuid)';
export const REISSUE_CALL = `
  SELECT reissued_account_id::text AS user_account_id, revoked_sessions::text AS revoked_sessions
    FROM iam.reissue_temporary_credential($1, $2, $3::uuid, $4::uuid)`;

// Custom SQLSTATEs raised by the function → operator messages (no detail beyond the refusal class).
const REFUSALS: Record<string, string> = {
  TA401: 'operator account not eligible',
  TA403: 'refused (caller, self-recovery or privileged account)',
  TA404: 'account not found',
  TA409: 'account, membership or credential not eligible for re-issue',
  TA422: 'invalid input',
  '42883': 'recovery function is not installed',
  '42501': 'not allowed to execute the recovery function',
};

export interface ReissueInput {
  readonly username: string;
  readonly operatorAccountId: string;
}

export interface ReissueResult {
  readonly userAccountId: string;
  readonly username: string;
  readonly revokedSessions: number;
  readonly requestId: string;
  readonly temporaryPassword: string; // show once to the operator; never log or store
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reissueTemporaryPassword(db: SqlExecutor, hasher: PasswordHasher, input: ReissueInput): Promise<ReissueResult> {
  const username = input.username.trim();
  if (username.length < 1 || username.length > 80) throw new ProvisioningError('username must be 1-80 characters');
  if (!UUID.test(input.operatorAccountId)) throw new ProvisioningError('operator account id must be a UUID');
  const requestId = randomUUID();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hasher.hashPassword(temporaryPassword); // Argon2id, outside the transaction
  let rows: Record<string, string | null>[];
  try {
    rows = await db.query(REISSUE_CALL, [username, passwordHash, input.operatorAccountId, requestId]);
  } catch (error) {
    const code = sqlstateOf(error);
    const refusal = code ? REFUSALS[code] : undefined;
    throw new ProvisioningError(`re-issue failed: ${refusal ?? 'database error'} (requestId ${requestId}${code ? `, ${code}` : ''})`);
  }
  const [row] = rows;
  if (!row?.user_account_id) throw new ProvisioningError(`re-issue returned no row (requestId ${requestId})`);
  return { userAccountId: row.user_account_id, username, revokedSessions: Number(row.revoked_sessions ?? 0), requestId, temporaryPassword };
}
