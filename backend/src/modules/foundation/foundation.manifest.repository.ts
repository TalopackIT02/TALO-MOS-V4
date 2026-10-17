import { z } from 'zod';
import type { PlannedFunction } from './foundation.registry.js';
import { materializeRegistry } from './foundation.registry.repository.js';
import type { AuditRecord, FoundationDb, SqlExecutor } from './foundation.repository.js';
import { VERSION_COLUMNS, VERSION_SQL, toVersion } from './foundation.versions.repository.js';
import type { VersionRecord } from './foundation.versions.repository.js';

// FBE-02B — MIC manifest (PUT, DRAFT only) and SUBMIT (DRAFT → IN_REVIEW) on B02. Owner decision P-10:
//   PUT    : lock B02 row → status DRAFT → UPDATE manifest_json (manifest_hash NULL) → B08 SUCCESS → COMMIT.
//   SUBMIT : lock B02 row → status DRAFT → validate MIC + canonicalize/hash (callback) → UPDATE status IN_REVIEW,
//            manifest_hash, submitted_by → B07 SUBMIT → B08 SUCCESS → COMMIT. Any error rolls everything back.
// The row lock (FOR UPDATE OF v) serialises concurrent PUT / SUBMIT on one version; each UPDATE re-checks
// status = 'DRAFT', so a statement that finds no DRAFT row changes nothing. Bind parameters only. No DELETE.
// NOT_TESTED on PostgreSQL (FBE-02C): FOR UPDATE needs an UPDATE privilege on B02 that talo_app does not have yet.

export const MANIFEST_SQL = {
  lockVersion: `
    SELECT v.status, v.manifest_json, v.module_version, v.contract_version, m.module_key
      FROM foundation.fnd_module_versions AS v
      JOIN foundation.fnd_modules AS m ON m.module_id = v.module_id
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid
       FOR UPDATE OF v`,
  otherVersions: `
    SELECT v.module_version, v.status FROM foundation.fnd_module_versions AS v
     WHERE v.module_id = $1::uuid AND v.version_id <> $2::uuid`,
  // $3 is JSON text, or SQL NULL (draft cleared) — never the JSON literal null.
  updateManifest: `
    UPDATE foundation.fnd_module_versions AS v
       SET manifest_json = $3::jsonb, manifest_hash = NULL
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'DRAFT'
    RETURNING ${VERSION_COLUMNS}`,
  submitVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'IN_REVIEW', manifest_hash = $3, submitted_by_account_id = $4::uuid
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'DRAFT'
    RETURNING ${VERSION_COLUMNS}`,
  // B07 SUBMIT (approved event code N-08). No RETURNING.
  insertSubmitEvent: `
    INSERT INTO foundation.fnd_module_events (module_id, version_id, event_type, actor_account_id, before_state, after_state, correlation_id)
    VALUES ($1::uuid, $2::uuid, 'SUBMIT', $3::uuid, $4::jsonb, $5::jsonb, $6)`,
} as const;

export type ManifestAuditRecord = Omit<AuditRecord, 'metadata'> & {
  readonly versionId: string;
  readonly metadata: Readonly<Record<string, string | number | readonly string[]>>;
};

export interface LockedVersion {
  readonly status: string;
  readonly manifestJson: unknown;
  readonly moduleVersion: string;
  readonly contractVersion: string;
  readonly moduleKey: string;
}

export interface OtherVersion {
  readonly moduleVersion: string;
  readonly status: string;
}

export interface UpdateManifestCommand {
  readonly moduleId: string;
  readonly versionId: string;
  readonly manifest: Readonly<Record<string, unknown>> | null;
  readonly audit: (version: VersionRecord) => ManifestAuditRecord;
}

export interface SubmitCommand {
  readonly moduleId: string;
  readonly versionId: string;
  readonly actorAccountId: string;
  readonly correlationId: string;
  // Validates the locked manifest against its context and returns its SHA-256; throws to reject (rolls back).
  // FBE-03: also returns the Function / Action registry plan materialised before the status change.
  readonly prepare: (locked: LockedVersion, others: readonly OtherVersion[]) => { readonly manifestHash: string; readonly registry: readonly PlannedFunction[] };
  readonly audit: (version: VersionRecord) => ManifestAuditRecord;
}

export class VersionNotFoundError extends Error {
  constructor() {
    super('version not found in module');
    this.name = 'VersionNotFoundError';
  }
}

export class VersionNotDraftError extends Error {
  constructor() {
    super('version is not DRAFT');
    this.name = 'VersionNotDraftError';
  }
}

export interface ManifestRepository {
  updateManifest(command: UpdateManifestCommand): Promise<VersionRecord>;
  submitVersion(command: SubmitCommand): Promise<VersionRecord>;
  // Outside any transaction (B08 FAILURE for MIC_INVALID).
  insertAudit(record: ManifestAuditRecord): Promise<void>;
}

const lockedRow = z.object({
  status: z.string(), manifest_json: z.unknown(), module_version: z.string(), contract_version: z.string(), module_key: z.string(),
});
const otherRow = z.object({ module_version: z.string(), status: z.string() });

export function manifestAuditParams(record: ManifestAuditRecord): unknown[] {
  return [
    record.eventId, record.moduleId, record.versionId, record.actorAccountId, record.actionCode, record.targetType, record.targetId, record.outcome,
    record.correlationId, record.sourceService, JSON.stringify(record.metadata),
  ];
}

async function lockDraft(tx: SqlExecutor, moduleId: string, versionId: string): Promise<LockedVersion> {
  const [raw] = await tx.query(MANIFEST_SQL.lockVersion, [versionId, moduleId]);
  if (raw === undefined) throw new VersionNotFoundError();
  const row = lockedRow.parse(raw);
  if (row.status !== 'DRAFT') throw new VersionNotDraftError();
  return {
    status: row.status, manifestJson: row.manifest_json ?? null, moduleVersion: row.module_version, contractVersion: row.contract_version, moduleKey: row.module_key,
  };
}

function updatedRow(rows: unknown[]): VersionRecord {
  const [row] = rows;
  // The row was locked as DRAFT; no row now means the status changed — never report a success.
  if (row === undefined) throw new VersionNotDraftError();
  return toVersion(row);
}

export class SqlManifestRepository implements ManifestRepository {
  private readonly db: FoundationDb;

  constructor(db: FoundationDb) {
    this.db = db;
  }

  async updateManifest(command: UpdateManifestCommand): Promise<VersionRecord> {
    const { moduleId, versionId, manifest } = command;
    return this.db.transaction(async (tx) => {
      await lockDraft(tx, moduleId, versionId);
      const version = updatedRow(await tx.query(MANIFEST_SQL.updateManifest, [versionId, moduleId, manifest === null ? null : JSON.stringify(manifest)]));
      await tx.execute(VERSION_SQL.insertVersionAudit, manifestAuditParams(command.audit(version)));
      return version;
    });
  }

  async submitVersion(command: SubmitCommand): Promise<VersionRecord> {
    const { moduleId, versionId } = command;
    return this.db.transaction(async (tx) => {
      const locked = await lockDraft(tx, moduleId, versionId);
      const others = (await tx.query(MANIFEST_SQL.otherVersions, [moduleId, versionId])).map((r) => {
        const o = otherRow.parse(r);
        return { moduleVersion: o.module_version, status: o.status };
      });
      const { manifestHash, registry } = command.prepare(locked, others);
      // FBE-03 (phase A): B03 / B04 identities and B05 / B06 declarations, same transaction, before IN_REVIEW.
      await materializeRegistry(tx, moduleId, versionId, registry);
      const version = updatedRow(await tx.query(MANIFEST_SQL.submitVersion, [versionId, moduleId, manifestHash, command.actorAccountId]));
      await tx.execute(MANIFEST_SQL.insertSubmitEvent, [
        moduleId, versionId, command.actorAccountId, JSON.stringify({ status: 'DRAFT' }),
        JSON.stringify({ status: 'IN_REVIEW', manifest_hash: manifestHash }), command.correlationId,
      ]);
      await tx.execute(VERSION_SQL.insertVersionAudit, manifestAuditParams(command.audit(version)));
      return version;
    });
  }

  async insertAudit(record: ManifestAuditRecord): Promise<void> {
    await this.db.execute(VERSION_SQL.insertVersionAudit, manifestAuditParams(record));
  }
}
