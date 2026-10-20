import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sqlstateOf } from '../auth/sqlstate.js';
import { DEFAULT_AUTH_SETTINGS } from '../auth/auth.settings.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import { ProvisioningError, provisionAccount } from '../auth/provisioning/provisionAccount.js';
import { reissueTemporaryPassword } from '../auth/provisioning/reissueTemporaryPassword.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { FoundationDb } from '../foundation/foundation.repository.js';
import { IamError, PLATFORM_MODULE_CODES, iamDbError } from './iam.admin.repository.js';
import type { ProvisionerConnection } from './iam.admin.provisioner.js';

// IAM Phase B — account lifecycle, sessions, IAM audit reading and temporary credentials, administered from the AppShell.
//
// Writers. Account status and session revocation change eligibility, so they follow the AUTH-API-v1 §8 writer protocol
// (account row FOR NO KEY UPDATE → change → revoke sessions → audit, one transaction). talo_iam_admin has no UPDATE on
// iam_user_accounts / iam_sessions / iam_credentials (owner decision B1); the protocol is carried by SECURITY DEFINER
// functions of the IAM Phase B database package (iam.admin_set_account_status, iam.admin_revoke_sessions,
// iam.admin_clear_login_lock), executable by talo_iam_admin only. Until the package is approved and installed, every
// writer answers 503 IAM_DB_FEATURE_MISSING (42883) and nothing changes.
//
// Readers. Account dates, sessions (never the token hash) and the IAM audit need column SELECT grants of the same package;
// until then the reads answer 503 IAM_DB_PRIVILEGE_MISSING (42501) — the account detail falls back to the base fields.
//
// Temporary credentials. Account creation and re-issue call the existing P-4e services on talo_provisioner (see
// iam.admin.provisioner.ts); the password is returned once in the HTTP answer (Cache-Control: no-store) and never
// logged, audited or stored.
//
// Root administrator (IAM_ROOT_ADMIN_ACCOUNT_ID): never locked, disabled or re-issued here. Self-administration of the
// lifecycle is refused. Every refusal of a protection rule is audited (FAILURE). The IAM evaluator is not touched.

export type StatusAction = 'LOCK' | 'UNLOCK' | 'DISABLE' | 'REACTIVATE';
export const STATUS_ACTIONS: readonly StatusAction[] = ['LOCK', 'UNLOCK', 'DISABLE', 'REACTIVATE'];

// Custom SQLSTATEs of the Phase B functions (class TA, like the P-4e recovery function).
export function lifecycleDbError(error: unknown): IamError | null {
  switch (sqlstateOf(error)) {
    case 'TA401': return new IamError(503, 'IAM_DB_PRIVILEGE_MISSING');
    case 'TA403': return new IamError(422, 'SELF_ACTION_FORBIDDEN');
    case 'TA404': return new IamError(404, 'NOT_FOUND');
    case 'TA409': return new IamError(409, 'STATUS_TRANSITION_INVALID');
    case 'TA410': return new IamError(409, 'ACCOUNT_RETIRED');
    case 'TA422': return new IamError(400, 'VALIDATION_ERROR');
    case '42883': return new IamError(503, 'IAM_DB_FEATURE_MISSING');
    case '55P03': return new IamError(503, 'SERVICE_BUSY');
    default: return iamDbError(error);
  }
}

const PROVISIONING_STATUS: Record<string, [number, string]> = {
  INVALID_INPUT: [400, 'VALIDATION_ERROR'],
  USERNAME_TAKEN: [409, 'USERNAME_TAKEN'],
  MEMBERSHIP_NOT_ACTIVE: [422, 'MEMBERSHIP_NOT_ACTIVE'],
  MEMBERSHIP_HAS_ACCOUNT: [409, 'MEMBERSHIP_HAS_ACCOUNT'],
  REISSUE_REFUSED: [422, 'PRIVILEGED_ACCOUNT_PROTECTED'],
  REISSUE_NOT_FOUND: [404, 'NOT_FOUND'],
  REISSUE_NOT_ELIGIBLE: [409, 'ACCOUNT_NOT_ELIGIBLE'],
  REISSUE_UNAVAILABLE: [503, 'IAM_DB_FEATURE_MISSING'],
  REISSUE_BUSY: [503, 'SERVICE_BUSY'],
};
function provisioningError(error: unknown): IamError | null {
  if (!(error instanceof ProvisioningError)) return lifecycleDbError(error);
  const [status, code] = PROVISIONING_STATUS[error.code] ?? [503, 'SERVICE_BUSY'];
  return new IamError(status, code);
}

const rows = (data: unknown[]): Record<string, unknown>[] => data.map((r) => z.record(z.string(), z.unknown()).parse(r));

// IAM audit metadata shown to administrators: closed key list (never ip / user agent / free-form values of other keys).
export const AUDIT_METADATA_KEYS = [
  'reason', 'requestId', 'permissionCode', 'roleCode', 'effect', 'fields', 'triple', 'task', 'from', 'to', 'revokedSessions',
  'cleared', 'slot', 'accountId', 'roleId', 'permissionId', 'userRoleId', 'userPermissionId', 'sessionId', 'reissueRequestId',
] as const;
export function safeMetadata(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const key of AUDIT_METADATA_KEYS) {
    const v: unknown = Reflect.get(value, key);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = String(v).slice(0, 300);
  }
  return out;
}

export interface AuditQuery {
  readonly accountId: string | null; // actor OR target
  readonly action: string; // prefix, '' = all
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'DENIED' | null;
  readonly from: string | null; // ISO date-time
  readonly to: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export interface CreateAccountInput {
  readonly employeeCode: string;
  readonly fullName: string;
  readonly username: string;
  readonly joinedAt: string;
}

const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class IamAccountLifecycle {
  constructor(
    private readonly db: FoundationDb,
    private readonly rootAccountId: string | null,
    private readonly provisioner: ProvisionerConnection,
    private readonly hasher: PasswordHasher | null,
  ) {}

  credentialState(): 'DISABLED' | 'UNAVAILABLE' | 'READY' {
    return this.provisioner.state === 'READY' && this.hasher === null ? 'UNAVAILABLE' : this.provisioner.state;
  }

  private isRoot(accountId: string): boolean {
    return this.rootAccountId !== null && accountId === this.rootAccountId;
  }

  // Refusal by a protection rule: IAM audit FAILURE (best effort, the refusal stands either way), then the error.
  private async refuse(actor: Actor, action: string, accountId: string, code: string, status = 422): Promise<never> {
    await this.db.execute(
      'INSERT INTO iam.iam_audit_logs(actor_account_id,action_code,target_type,target_id,outcome,metadata) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb)',
      [actor.userAccountId, action, 'USER_ACCOUNT', accountId, 'FAILURE', JSON.stringify({ v: 1, requestId: actor.requestId, reason: code })],
    ).catch(() => undefined);
    throw new IamError(status, code);
  }

  private async guarded<R>(work: () => Promise<R>, map: (e: unknown) => IamError | null = lifecycleDbError): Promise<R> {
    try {
      return await work();
    } catch (error) {
      throw error instanceof IamError ? error : map(error) ?? error;
    }
  }

  // Holds a system role or a platform (IAM / FOUNDATION) permission through any active assignment (roles counted even
  // when inactive: a role can be re-activated). Reads only grants talo_iam_admin already has.
  private async holdsPlatformAdmin(accountId: string): Promise<boolean> {
    const [row] = rows(await this.db.query(
      `SELECT EXISTS (
                SELECT 1 FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON r.role_id = ur.role_id
                 WHERE ur.user_account_id = $1::uuid AND ur.revoked_at IS NULL
                   AND (r.is_system OR EXISTS (SELECT 1 FROM iam.iam_role_permissions rp JOIN iam.iam_permissions p ON p.permission_id = rp.permission_id
                                                WHERE rp.role_id = r.role_id AND p.module_code = ANY($2::text[]))))
           OR EXISTS (
                SELECT 1 FROM iam.iam_user_permissions up JOIN iam.iam_permissions p ON p.permission_id = up.permission_id
                 WHERE up.user_account_id = $1::uuid AND up.revoked_at IS NULL AND up.effect = 'ALLOW' AND p.module_code = ANY($2::text[])) AS admin`,
      [accountId, [...PLATFORM_MODULE_CODES]]));
    return row?.admin === true;
  }

  // ------------------------------------------------------------------------------------------------------------ reads
  // Dates and credential state of an account. null = the database package (column grants) is not installed yet.
  async details(accountId: string): Promise<Record<string, unknown> | null> {
    try {
      const [row] = rows(await this.db.query(
        `SELECT a.created_at AS "createdAt", a.activated_at AS "activatedAt", a.disabled_at AS "disabledAt",
                a.created_by_account_id::text AS "createdById", cb.username AS "createdByUsername",
                m.joined_at::text AS "joinedAt", m.left_at::text AS "leftAt",
                c.must_change_password AS "mustChangePassword", c.failed_attempt_count AS "failedAttempts",
                CASE WHEN c.locked_until > statement_timestamp() THEN c.locked_until END AS "loginLockedUntil"
           FROM iam.iam_user_accounts a
           JOIN iam.iam_memberships m ON m.membership_id = a.membership_id
           LEFT JOIN iam.iam_user_accounts cb ON cb.user_account_id = a.created_by_account_id
           LEFT JOIN iam.iam_credentials c ON c.user_account_id = a.user_account_id
          WHERE a.user_account_id = $1::uuid`, [accountId]));
      if (!row) throw new IamError(404, 'NOT_FOUND');
      return row;
    } catch (error) {
      if (sqlstateOf(error) === '42501') return null;
      throw error instanceof IamError ? error : lifecycleDbError(error) ?? error;
    }
  }

  // Sessions of an account (newest first, at most 100). Never the token or its hash.
  async sessions(accountId: string) {
    return this.guarded(async () => rows(await this.db.query(
      `SELECT s.session_id::text AS "sessionId", s.assurance_level_snapshot::int AS "assuranceLevel",
              s.created_at AS "createdAt", s.expires_at AS "expiresAt", s.last_seen_at AS "lastSeenAt", s.revoked_at AS "revokedAt",
              CASE WHEN s.revoked_at IS NOT NULL THEN 'REVOKED'
                   WHEN s.expires_at <= statement_timestamp() THEN 'EXPIRED'
                   WHEN s.assurance_level_snapshot = 0 THEN 'ACTIVATION'
                   WHEN s.last_seen_at IS NULL OR s.last_seen_at <= statement_timestamp() - $2::interval THEN 'IDLE'
                   ELSE 'ACTIVE' END AS status
         FROM iam.iam_sessions s WHERE s.user_account_id = $1::uuid
        ORDER BY s.created_at DESC, s.session_id LIMIT 100`, [accountId, DEFAULT_AUTH_SETTINGS.idleTimeout])));
  }

  // IAM audit page (newest first). Filters are bound values; the action is a prefix; metadata is reduced to safe keys.
  async audit(q: AuditQuery) {
    return this.guarded(async () => {
      const where = `($1::uuid IS NULL OR l.actor_account_id = $1::uuid OR l.target_id = $1::uuid)
        AND ($2 = '' OR l.action_code LIKE $3 ESCAPE '\\') AND ($4::text IS NULL OR l.outcome = $4)
        AND ($5::timestamptz IS NULL OR l.occurred_at >= $5::timestamptz) AND ($6::timestamptz IS NULL OR l.occurred_at < $6::timestamptz)`;
      const params = [q.accountId, q.action, likePrefix(q.action), q.outcome, q.from, q.to];
      const [total] = rows(await this.db.query(`SELECT count(*)::int AS total FROM iam.iam_audit_logs l WHERE ${where}`, params));
      const events = rows(await this.db.query(
        `SELECT l.audit_id::text AS "auditId", l.occurred_at AS "occurredAt", l.action_code AS "action", l.outcome,
                l.actor_account_id::text AS "actorId", act.username AS "actorUsername",
                l.target_type AS "targetType", l.target_id::text AS "targetId", tgt.username AS "targetUsername", l.metadata
           FROM iam.iam_audit_logs l
           LEFT JOIN iam.iam_user_accounts act ON act.user_account_id = l.actor_account_id
           LEFT JOIN iam.iam_user_accounts tgt ON l.target_type = 'USER_ACCOUNT' AND tgt.user_account_id = l.target_id
          WHERE ${where} ORDER BY l.occurred_at DESC, l.audit_id DESC LIMIT $7 OFFSET $8`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize])).map((e): Record<string, unknown> => ({ ...e, metadata: safeMetadata(e.metadata) }));
      return { events, total: total?.total ?? 0, page: q.page, pageSize: q.pageSize };
    });
  }

  // ---------------------------------------------------------------------------------------------------------- writers
  async setStatus(actor: Actor, accountId: string, action: StatusAction, reason: string) {
    const code = `IAM.ACCOUNT.${action}`;
    if (actor.userAccountId === accountId) await this.refuse(actor, code, accountId, 'SELF_ACTION_FORBIDDEN');
    if (action === 'LOCK' || action === 'DISABLE') {
      if (this.isRoot(accountId)) await this.refuse(actor, code, accountId, 'ROOT_ADMIN_PROTECTED');
      // Without a configured root administrator no platform administrator can be locked out through this API.
      if (this.rootAccountId === null && await this.guarded(() => this.holdsPlatformAdmin(accountId))) {
        await this.refuse(actor, code, accountId, 'ROOT_NOT_CONFIGURED');
      }
    }
    return this.guarded(async () => {
      const [row] = rows(await this.db.query(
        'SELECT previous_status AS "previousStatus", new_status AS "status", revoked_sessions::int AS "revokedSessions" FROM iam.admin_set_account_status($1::uuid,$2::uuid,$3,$4,$5::uuid)',
        [actor.userAccountId, accountId, action, reason, randomUUID()]));
      if (!row) throw new IamError(503, 'SERVICE_BUSY');
      return row;
    });
  }

  async revokeSessions(actor: Actor, accountId: string, sessionId: string | null, reason: string) {
    return this.guarded(async () => {
      const [row] = rows(await this.db.query(
        'SELECT iam.admin_revoke_sessions($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid)::int AS "revokedSessions"',
        [actor.userAccountId, accountId, sessionId, reason, randomUUID()]));
      return { revokedSessions: typeof row?.revokedSessions === 'number' ? row.revokedSessions : 0 };
    });
  }

  async clearLoginLock(actor: Actor, accountId: string, reason: string) {
    return this.guarded(async () => {
      const [row] = rows(await this.db.query(
        'SELECT iam.admin_clear_login_lock($1::uuid,$2::uuid,$3,$4::uuid) AS cleared', [actor.userAccountId, accountId, reason, randomUUID()]));
      return { cleared: row?.cleared === true };
    });
  }

  // ------------------------------------------------------------------------------------------- temporary credentials
  private ready(): { executor: NonNullable<ProvisionerConnection['executor']>; hasher: PasswordHasher } {
    const state = this.credentialState();
    if (state === 'DISABLED') throw new IamError(503, 'CREDENTIAL_UI_DISABLED');
    if (this.provisioner.executor === null || this.hasher === null) throw new IamError(503, 'CREDENTIAL_UI_UNAVAILABLE');
    return { executor: this.provisioner.executor, hasher: this.hasher };
  }

  // P-4e provisioning (unchanged service) with the administrator as actor / created_by. Password returned once.
  async createAccount(actor: Actor, input: CreateAccountInput) {
    const { executor, hasher } = this.ready();
    const result = await this.guarded(
      () => provisionAccount(executor, hasher, input, { actorAccountId: actor.userAccountId, requestId: actor.requestId, ua: 'iam-admin-ui' }),
      provisioningError);
    return { accountId: result.userAccountId, username: result.username, membershipCreated: result.membershipCreated, temporaryPassword: result.temporaryPassword };
  }

  // P-4e re-issue (unchanged function: lock, replace credential, revoke every session, CREDENTIAL_REISSUED). The function's
  // own audit names the service credential; the administrator is recorded by an IAM audit row linked by reissueRequestId.
  async reissue(actor: Actor, accountId: string, reason: string) {
    const { executor, hasher } = this.ready();
    const code = 'IAM.CREDENTIAL.REISSUE';
    if (actor.userAccountId === accountId) await this.refuse(actor, code, accountId, 'SELF_ACTION_FORBIDDEN');
    if (this.isRoot(accountId)) await this.refuse(actor, code, accountId, 'ROOT_ADMIN_PROTECTED');
    const [target] = await this.guarded(async () => rows(await this.db.query('SELECT username FROM iam.iam_user_accounts WHERE user_account_id = $1::uuid', [accountId])));
    if (typeof target?.username !== 'string') throw new IamError(404, 'NOT_FOUND');
    const reissueRequestId = randomUUID();
    let result;
    try {
      result = await reissueTemporaryPassword(executor, hasher, target.username, reissueRequestId);
    } catch (error) {
      const mapped = provisioningError(error) ?? new IamError(503, 'SERVICE_BUSY');
      if (mapped.code === 'PRIVILEGED_ACCOUNT_PROTECTED') await this.refuse(actor, code, accountId, mapped.code);
      throw mapped;
    }
    await this.db.execute(
      'INSERT INTO iam.iam_audit_logs(actor_account_id,action_code,target_type,target_id,outcome,metadata) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb)',
      [actor.userAccountId, code, 'USER_ACCOUNT', accountId, 'SUCCESS',
        JSON.stringify({ v: 1, requestId: actor.requestId, reissueRequestId, revokedSessions: result.revokedSessions, reason })],
    ).catch(() => undefined); // the credential is already replaced: the function's CREDENTIAL_REISSUED row is the record
    return { accountId, username: result.username, revokedSessions: result.revokedSessions, temporaryPassword: result.temporaryPassword };
  }
}
