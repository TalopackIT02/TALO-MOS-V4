import { z } from 'zod';
import { sqlstateOf } from '../auth/sqlstate.js';
import type { AuditRecord, FoundationDb } from './foundation.repository.js';
import { compareSemVer, parseSemVer } from './foundation.versions.validation.js';
import type { CreateVersionInput } from './foundation.versions.validation.js';

// FBE-02A — Module Version (B02 foundation.fnd_module_versions). Every client value travels as a bind parameter ($n).
// Writes: INSERT B02 (DRAFT; manifest_json / manifest_hash / submitted_by left to their NULL defaults) + INSERT B08
// SUCCESS, one transaction. No B07 row for a DRAFT (owner decision). No UPDATE / DELETE of B02.
// NOT_TESTED on PostgreSQL (mock/unit only in FBE-02A); talo_app has no privilege on B02 yet (FBE-02C).
//
// Concurrency: "greater than every existing version of the module" is checked inside the INSERT transaction after a
// transaction-scoped advisory lock keyed by module_id (released at COMMIT/ROLLBACK), so two concurrent creates for
// the same module are serialised. talo_app cannot row-lock B01 (FOR UPDATE needs an UPDATE privilege it does not
// have); pg_advisory_xact_lock needs no table privilege. uq_fnd_module_versions_module_version (23505) remains the
// last guard for an exact duplicate. Lock behaviour and EXECUTE on the function: DB VERIFICATION REQUIRED (FBE-02C).

export const VERSION_COLUMNS = `
           v.version_id::text AS version_id, v.module_id::text AS module_id, v.module_version, v.contract_version, v.status,
           v.manifest_json, v.manifest_hash, v.submitted_by_account_id::text AS submitted_by_account_id,
           to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           v.reviewed_by_account_id::text AS reviewed_by_account_id,
           to_char(v.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed_at,
           to_char(v.activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activated_at`;

// Advisory lock namespace for "create a version of module X" (first key); second key = hashtext(module_id).
export const VERSION_LOCK_NAMESPACE = 7201;

export const VERSION_SQL = {
  moduleExists: `
    SELECT m.module_id::text AS module_id FROM foundation.fnd_modules AS m WHERE m.module_id = $1::uuid`,
  listVersions: `
    SELECT ${VERSION_COLUMNS}
      FROM foundation.fnd_module_versions AS v
     WHERE v.module_id = $1::uuid
     ORDER BY v.created_at, v.version_id`,
  getVersion: `
    SELECT ${VERSION_COLUMNS}
      FROM foundation.fnd_module_versions AS v
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid`,
  lockModuleVersions: `
    SELECT pg_advisory_xact_lock(${VERSION_LOCK_NAMESPACE}, hashtext($1::text))`,
  moduleVersionNumbers: `
    SELECT v.module_version FROM foundation.fnd_module_versions AS v WHERE v.module_id = $1::uuid`,
  insertVersion: `
    INSERT INTO foundation.fnd_module_versions AS v (module_id, module_version, contract_version)
    VALUES ($1::uuid, $2, $3)
    RETURNING ${VERSION_COLUMNS}`,
  // B08 with version_id (composite FK (version_id, module_id) → same module). No RETURNING.
  insertVersionAudit: `
    INSERT INTO foundation.fnd_audit_logs
           (event_id, module_id, version_id, actor_account_id, session_id, action_code, target_type, target_id, outcome,
            occurred_at, correlation_id, source_service, metadata)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL, $5, $6, $7, $8, statement_timestamp(), $9, $10, $11::jsonb)`,
} as const;

export interface VersionRecord {
  readonly versionId: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly contractVersion: string;
  readonly status: string;
  readonly manifestJson: unknown;
  readonly manifestHash: string | null;
  readonly submittedByAccountId: string | null;
  readonly createdAt: string;
  readonly reviewedByAccountId: string | null;
  readonly reviewedAt: string | null;
  readonly activatedAt: string | null;
}

export type VersionAuditRecord = AuditRecord & { readonly versionId: string };

export interface CreateVersionCommand {
  readonly moduleId: string;
  readonly input: CreateVersionInput;
  // Builds the B08 SUCCESS row once the version id is known (inside the transaction).
  readonly audit: (version: VersionRecord) => VersionAuditRecord;
}

export class ModuleNotFoundError extends Error {
  constructor() {
    super('module not found');
    this.name = 'ModuleNotFoundError';
  }
}

export class VersionExistsError extends Error {
  constructor() {
    super('module_version already exists for the module');
    this.name = 'VersionExistsError';
  }
}

export class VersionNotIncreasingError extends Error {
  constructor() {
    super('module_version is not greater than every existing version');
    this.name = 'VersionNotIncreasingError';
  }
}

export interface ModuleVersionRepository {
  moduleExists(moduleId: string): Promise<boolean>;
  listVersions(moduleId: string): Promise<VersionRecord[]>;
  getVersion(moduleId: string, versionId: string): Promise<VersionRecord | null>;
  // lock → module exists → SemVer greater than every existing version → INSERT B02 → INSERT B08 SUCCESS; one transaction.
  createVersion(command: CreateVersionCommand): Promise<VersionRecord>;
}

const versionRow = z.object({
  version_id: z.string(), module_id: z.string(), module_version: z.string(), contract_version: z.string(), status: z.string(),
  manifest_json: z.unknown(), manifest_hash: z.string().nullable(), submitted_by_account_id: z.string().nullable(), created_at: z.string(),
  reviewed_by_account_id: z.string().nullable(), reviewed_at: z.string().nullable(), activated_at: z.string().nullable(),
});
const moduleIdRow = z.object({ module_id: z.string() });
const versionNumberRow = z.object({ module_version: z.string() });

export function toVersion(row: unknown): VersionRecord {
  const v = versionRow.parse(row);
  return {
    versionId: v.version_id, moduleId: v.module_id, moduleVersion: v.module_version, contractVersion: v.contract_version, status: v.status,
    manifestJson: v.manifest_json ?? null, manifestHash: v.manifest_hash, submittedByAccountId: v.submitted_by_account_id, createdAt: v.created_at,
    reviewedByAccountId: v.reviewed_by_account_id, reviewedAt: v.reviewed_at, activatedAt: v.activated_at,
  };
}

export function versionAuditParams(record: VersionAuditRecord): unknown[] {
  return [
    record.eventId, record.moduleId, record.versionId, record.actorAccountId, record.actionCode, record.targetType, record.targetId, record.outcome,
    record.correlationId, record.sourceService, JSON.stringify(record.metadata),
  ];
}

export class SqlModuleVersionRepository implements ModuleVersionRepository {
  private readonly db: FoundationDb;

  constructor(db: FoundationDb) {
    this.db = db;
  }

  async moduleExists(moduleId: string): Promise<boolean> {
    const rows = await this.db.query(VERSION_SQL.moduleExists, [moduleId]);
    return rows.map((r) => moduleIdRow.parse(r)).length === 1;
  }

  async listVersions(moduleId: string): Promise<VersionRecord[]> {
    return (await this.db.query(VERSION_SQL.listVersions, [moduleId])).map(toVersion);
  }

  async getVersion(moduleId: string, versionId: string): Promise<VersionRecord | null> {
    const [row] = await this.db.query(VERSION_SQL.getVersion, [versionId, moduleId]);
    return row === undefined ? null : toVersion(row);
  }

  async createVersion(command: CreateVersionCommand): Promise<VersionRecord> {
    const { moduleId, input } = command;
    const requested = parseSemVer(input.moduleVersion);
    if (!requested) throw new Error('module_version is not SemVer (validation bypassed)');
    return this.db.transaction(async (tx) => {
      await tx.execute(VERSION_SQL.lockModuleVersions, [moduleId]);
      const modules = (await tx.query(VERSION_SQL.moduleExists, [moduleId])).map((r) => moduleIdRow.parse(r));
      if (modules.length !== 1) throw new ModuleNotFoundError();

      const existing = (await tx.query(VERSION_SQL.moduleVersionNumbers, [moduleId])).map((r) => versionNumberRow.parse(r).module_version);
      let equal = false;
      let notGreater = false;
      for (const value of existing) {
        const stored = parseSemVer(value);
        // A stored value that is not SemVer cannot be ordered: fail closed (503), never guess.
        if (!stored) throw new Error('stored module_version is not SemVer');
        const cmp = compareSemVer(requested, stored);
        if (cmp === 0) equal = true;
        else if (cmp < 0) notGreater = true;
      }
      if (equal) throw new VersionExistsError();
      if (notGreater) throw new VersionNotIncreasingError();

      let inserted: unknown[];
      try {
        inserted = await tx.query(VERSION_SQL.insertVersion, [moduleId, input.moduleVersion, input.contractVersion]);
      } catch (error) {
        if (sqlstateOf(error) === '23505') throw new VersionExistsError();
        throw error;
      }
      const [row] = inserted;
      if (row === undefined) throw new Error('INSERT fnd_module_versions returned no row');
      const version = toVersion(row);
      await tx.execute(VERSION_SQL.insertVersionAudit, versionAuditParams(command.audit(version)));
      return version;
    });
  }
}
