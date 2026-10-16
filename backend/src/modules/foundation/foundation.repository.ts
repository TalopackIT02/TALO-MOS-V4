import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { DuplicateModuleKeyError } from './foundation.errors.js';
import type { AccessFacts, GrantFacts, PermissionRef } from './foundation.permissions.js';
import type { RegisterModuleInput } from './foundation.validation.js';

// Every statement of the Foundation Module Registry (FBE-01A). All client values travel as bind parameters ($n);
// no SQL text is ever built from request data. IAM is only read (SELECT); Foundation writes are B01 / B07 / B08.
// NOT_TESTED on PostgreSQL: these statements are covered by mock/unit tests only (no real database in FBE-01A).

export const FOUNDATION_SQL = {
  permissionDefinitions: `
    SELECT p.permission_id::text AS permission_id, p.minimum_assurance_level::int AS minimum_assurance_level
      FROM iam.iam_permissions AS p
     WHERE p.permission_code = $1 AND p.module_code = $2 AND p.resource_code = $3 AND p.operation = $4`,
  accountFacts: `
    SELECT a.account_status, (a.disabled_at IS NULL) AS not_disabled
      FROM iam.iam_user_accounts AS a
     WHERE a.user_account_id = $1::uuid`,
  // Role grants (role active, assignment not revoked and started) and direct grants (ALLOW/DENY, not revoked, started,
  // not expired) of ONE permission to ONE account. Flags are evaluated by evaluateAccess(); no row is filtered here
  // so that an invalid grant is visible as invalid rather than silently missing.
  grantFacts: `
    SELECT 'ROLE' AS source, 'ALLOW' AS effect, r.is_active AS role_active,
           (ur.revoked_at IS NULL) AS not_revoked, (ur.assigned_at <= statement_timestamp()) AS started, true AS not_expired
      FROM iam.iam_user_roles AS ur
      JOIN iam.iam_roles AS r ON r.role_id = ur.role_id
      JOIN iam.iam_role_permissions AS rp ON rp.role_id = ur.role_id
     WHERE ur.user_account_id = $1::uuid AND rp.permission_id = $2::uuid
    UNION ALL
    SELECT 'DIRECT', up.effect::text, true,
           (up.revoked_at IS NULL), (up.assigned_at <= statement_timestamp()),
           (up.expires_at IS NULL OR up.expires_at > statement_timestamp())
      FROM iam.iam_user_permissions AS up
     WHERE up.user_account_id = $1::uuid AND up.permission_id = $2::uuid`,
  listModules: `
    SELECT m.module_id::text AS module_id, m.module_key, m.module_name, m.description, m.module_type, m.is_enabled,
           to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           to_char(m.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
           m.created_by_account_id::text AS created_by_account_id
      FROM foundation.fnd_modules AS m
     ORDER BY m.module_key COLLATE "C"`,
  // B01. module_id / timestamps come from the column defaults; is_enabled is always false on registration.
  insertModule: `
    INSERT INTO foundation.fnd_modules (module_key, module_name, description, module_type, is_enabled, created_by_account_id)
    VALUES ($1, $2, $3, $4, false, $5::uuid)
    RETURNING module_id::text AS module_id, module_key, module_name, description, module_type, is_enabled,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
              created_by_account_id::text AS created_by_account_id`,
  // B07 REGISTER. event_id / occurred_at from defaults; no RETURNING.
  insertModuleEvent: `
    INSERT INTO foundation.fnd_module_events (module_id, version_id, event_type, actor_account_id, before_state, after_state, correlation_id)
    VALUES ($1::uuid, NULL, 'REGISTER', $2::uuid, NULL, $3::jsonb, $4)`,
  // B08. event_id is a fresh unique UUID (not a reference to B07); session_id stays NULL (SessionBody has no id);
  // version_id NULL keeps N-01 satisfied. No RETURNING.
  insertAudit: `
    INSERT INTO foundation.fnd_audit_logs
           (event_id, module_id, version_id, actor_account_id, session_id, action_code, target_type, target_id, outcome,
            occurred_at, correlation_id, source_service, metadata)
    VALUES ($1::uuid, $2::uuid, NULL, $3::uuid, NULL, $4, $5, $6, $7, statement_timestamp(), $8, $9, $10::jsonb)`,
} as const;

// Narrow executor so that the repository can be exercised with an in-memory transaction mock. Rows are `unknown`
// and parsed at runtime below — no type assertion on database output.
export interface SqlExecutor {
  query(sql: string, params: readonly unknown[]): Promise<unknown[]>;
  execute(sql: string, params: readonly unknown[]): Promise<number>;
}

export interface FoundationDb extends SqlExecutor {
  // Commits when `fn` resolves, rolls back when it rejects.
  transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R>;
}

const TX_OPTIONS = { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 5_000 } as const;

function prismaExecutor(db: PrismaClient | Prisma.TransactionClient): SqlExecutor {
  return {
    query: (sql, params) => db.$queryRawUnsafe<unknown[]>(sql, ...params),
    execute: (sql, params) => db.$executeRawUnsafe(sql, ...params),
  };
}

export function prismaFoundationDb(prisma: PrismaClient): FoundationDb {
  return {
    ...prismaExecutor(prisma),
    transaction: (fn) => prisma.$transaction((tx) => fn(prismaExecutor(tx)), TX_OPTIONS),
  };
}

export interface ModuleRecord {
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly moduleName: string;
  readonly description: string | null;
  readonly moduleType: string;
  readonly isEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByAccountId: string | null;
}

export interface AuditRecord {
  readonly eventId: string;
  readonly moduleId: string | null;
  readonly actorAccountId: string;
  readonly actionCode: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  readonly correlationId: string;
  readonly sourceService: string;
  readonly metadata: Readonly<Record<string, string | number>>;
}

export interface RegisterModuleCommand {
  readonly input: RegisterModuleInput;
  readonly actorAccountId: string;
  readonly correlationId: string;
  // Builds the B08 SUCCESS row once the module id is known (inside the transaction).
  readonly audit: (module: ModuleRecord) => AuditRecord;
}

export interface FoundationRepository {
  loadAccessFacts(userAccountId: string, permission: PermissionRef): Promise<AccessFacts>;
  listModules(): Promise<ModuleRecord[]>;
  // INSERT B01 → INSERT B07 REGISTER → INSERT B08 SUCCESS, one transaction; any failure rolls back all three.
  registerModule(command: RegisterModuleCommand): Promise<ModuleRecord>;
  // Outside any transaction (DENIED audit).
  insertAudit(record: AuditRecord): Promise<void>;
}

const permissionRow = z.object({ permission_id: z.string(), minimum_assurance_level: z.number().int() });
const accountRow = z.object({ account_status: z.string(), not_disabled: z.boolean() });
const grantRow = z.object({
  source: z.enum(['ROLE', 'DIRECT']), effect: z.string(), role_active: z.boolean(), not_revoked: z.boolean(), started: z.boolean(), not_expired: z.boolean(),
});
const moduleRow = z.object({
  module_id: z.string(), module_key: z.string(), module_name: z.string(), description: z.string().nullable(), module_type: z.string(),
  is_enabled: z.boolean(), created_at: z.string(), updated_at: z.string(), created_by_account_id: z.string().nullable(),
});

function toModule(row: unknown): ModuleRecord {
  const m = moduleRow.parse(row);
  return {
    moduleId: m.module_id, moduleKey: m.module_key, moduleName: m.module_name, description: m.description, moduleType: m.module_type,
    isEnabled: m.is_enabled, createdAt: m.created_at, updatedAt: m.updated_at, createdByAccountId: m.created_by_account_id,
  };
}

function toGrant(row: unknown): GrantFacts {
  const g = grantRow.parse(row);
  return { source: g.source, effect: g.effect, roleActive: g.role_active, notRevoked: g.not_revoked, started: g.started, notExpired: g.not_expired };
}

function auditParams(record: AuditRecord): unknown[] {
  return [
    record.eventId, record.moduleId, record.actorAccountId, record.actionCode, record.targetType, record.targetId, record.outcome,
    record.correlationId, record.sourceService, JSON.stringify(record.metadata),
  ];
}

export class SqlFoundationRepository implements FoundationRepository {
  private readonly db: FoundationDb;

  constructor(db: FoundationDb) {
    this.db = db;
  }

  async loadAccessFacts(userAccountId: string, permission: PermissionRef): Promise<AccessFacts> {
    const definitions = (await this.db.query(FOUNDATION_SQL.permissionDefinitions, [
      permission.permissionCode, permission.moduleCode, permission.resourceCode, permission.operation,
    ])).map((row) => permissionRow.parse(row));
    const [accountRaw] = await this.db.query(FOUNDATION_SQL.accountFacts, [userAccountId]);
    const account = accountRaw === undefined ? null : accountRow.parse(accountRaw);
    const permissions = definitions.map((d) => ({ permissionId: d.permission_id, minimumAssuranceLevel: d.minimum_assurance_level }));
    // Grants are only read for a single, unambiguous definition; otherwise access is denied without them.
    const [only] = permissions;
    const grants = permissions.length === 1 && only
      ? (await this.db.query(FOUNDATION_SQL.grantFacts, [userAccountId, only.permissionId])).map(toGrant)
      : [];
    return {
      permissions,
      account: account ? { accountStatus: account.account_status, notDisabled: account.not_disabled } : null,
      grants,
    };
  }

  async listModules(): Promise<ModuleRecord[]> {
    return (await this.db.query(FOUNDATION_SQL.listModules, [])).map(toModule);
  }

  async registerModule(command: RegisterModuleCommand): Promise<ModuleRecord> {
    const { input, actorAccountId, correlationId } = command;
    return this.db.transaction(async (tx) => {
      let inserted: unknown[];
      try {
        inserted = await tx.query(FOUNDATION_SQL.insertModule, [input.moduleKey, input.moduleName, input.description, input.moduleType, actorAccountId]);
      } catch (error) {
        if (sqlstateOf(error) === '23505') throw new DuplicateModuleKeyError();
        throw error;
      }
      const [row] = inserted;
      if (row === undefined) throw new Error('INSERT fnd_modules returned no row');
      const module = toModule(row);
      const afterState = {
        module_id: module.moduleId, module_key: module.moduleKey, module_name: module.moduleName, description: module.description,
        module_type: module.moduleType, is_enabled: module.isEnabled,
      };
      await tx.execute(FOUNDATION_SQL.insertModuleEvent, [module.moduleId, actorAccountId, JSON.stringify(afterState), correlationId]);
      await tx.execute(FOUNDATION_SQL.insertAudit, auditParams(command.audit(module)));
      return module;
    });
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await this.db.execute(FOUNDATION_SQL.insertAudit, auditParams(record));
  }
}
