import { z } from 'zod';
import { FOUNDATION_SQL } from './foundation.repository.js';
import type { AuditRecord, FoundationDb, ModuleRecord, SqlExecutor } from './foundation.repository.js';
import { ModuleNotFoundError, VERSION_COLUMNS, VERSION_LOCK_NAMESPACE, VERSION_SQL, toVersion, versionAuditParams } from './foundation.versions.repository.js';
import type { VersionAuditRecord, VersionRecord } from './foundation.versions.repository.js';

// FBE-05 — Module & Version lifecycle (owner decisions L1–L8). Bind parameters only; B02 / B01 are changed by
// conditional UPDATEs (status / is_enabled of the expected input state) whose RETURNING row count is checked exactly;
// B07 / B08 are INSERT only. Every operation is ONE transaction:
//   module advisory lock (VERSION_SQL.lockModuleVersions, the FBE-02A module lock) → read → business gate (callback,
//   throws to refuse) → UPDATE(s) → B07 → B08 → COMMIT. Any error rolls everything back (no partial commit).
//   ACTIVATE: retire the current ACTIVE version of the module FIRST, then activate the target (Q01 index is not
//   deferrable); both, their two B07 rows and the B08 row commit together. activated_at is written only when NULL.
//   The module lock serialises every lifecycle operation, version creation and ENABLE / DISABLE of one module, in the
//   same order (lock → B02 / B01 rows), so concurrent operations neither deadlock nor create two ACTIVE versions.
// No DELETE, no change of manifest_json / manifest_hash, no write to B03–B06 / B10–B14.
// REV01-D3: ENABLE also takes the route-claim lock (one key for every module, after the module lock: no deadlock) and
//   refuses when an ACTIVE MIC-04 route of the module is claimed by ANOTHER module that is ACTIVE + ENABLED.
// REV01-D1: recoverUpgrade — the controlled inverse of ONE activation (installer recovery, no public route): the
//   failed version must still be ACTIVE with exactly the activated_at recorded by the installer journal, the restored
//   one RETIRED with an intact manifest; failed → RETIRED, restored → ACTIVE, B07 RETIRE + ROLLBACK, B08 — one transaction.

const MODULE_COLUMNS = `
           m.module_id::text AS module_id, m.module_key, m.module_name, m.description, m.module_type, m.is_enabled,
           to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           to_char(m.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
           m.created_by_account_id::text AS created_by_account_id`;

export const LIFECYCLE_SQL = {
  getModule: `
    SELECT ${MODULE_COLUMNS} FROM foundation.fnd_modules AS m WHERE m.module_id = $1::uuid`,
  // L2: reviewer = authenticated actor, review time = PostgreSQL time; manifest / hash / activated_at untouched.
  approveVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'APPROVED', reviewed_by_account_id = $3::uuid, reviewed_at = now()
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'IN_REVIEW'
    RETURNING ${VERSION_COLUMNS}`,
  rejectVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'REJECTED', reviewed_by_account_id = $3::uuid, reviewed_at = now()
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'IN_REVIEW'
    RETURNING ${VERSION_COLUMNS}`,
  // L3: the ACTIVE version of the module other than the target (0 or 1 row under the Q01 index) → RETIRED.
  retireCurrentActive: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'RETIRED'
     WHERE v.module_id = $1::uuid AND v.status = 'ACTIVE' AND v.version_id <> $2::uuid
    RETURNING ${VERSION_COLUMNS}`,
  // L3: APPROVED → ACTIVE; activated_at holds the first activation (D-06), never overwritten.
  activateVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'ACTIVE', activated_at = coalesce(v.activated_at, now())
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'APPROVED'
    RETURNING ${VERSION_COLUMNS}`,
  // L4: ACTIVE → RETIRED; activated_at kept.
  retireVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'RETIRED'
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'ACTIVE'
    RETURNING ${VERSION_COLUMNS}`,
  // REV01-D1: RETIRED → ACTIVE for the controlled recovery only (activated_at of the first activation kept).
  reactivateVersion: `
    UPDATE foundation.fnd_module_versions AS v
       SET status = 'ACTIVE'
     WHERE v.version_id = $1::uuid AND v.module_id = $2::uuid AND v.status = 'RETIRED' AND v.activated_at IS NOT NULL
    RETURNING ${VERSION_COLUMNS}`,
  // REV01-D3: serialises the route check of every ENABLE (single key in the Foundation lock namespace).
  lockRouteClaims: `
    SELECT pg_advisory_xact_lock(${VERSION_LOCK_NAMESPACE}, hashtext('foundation.route-claims'))`,
  // REV01-D3: MIC-04 routes of OTHER modules that are ACTIVE + ENABLED, among the given routes.
  routeHolders: `
    SELECT DISTINCT n.route_path, m.module_key
      FROM foundation.fnd_modules AS m
      JOIN foundation.fnd_module_versions AS v ON v.module_id = m.module_id AND v.status = 'ACTIVE'
      CROSS JOIN LATERAL (
        SELECT e->>'routePath' AS route_path
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.manifest_json->'mic04Navigation') = 'array' THEN v.manifest_json->'mic04Navigation' ELSE '[]'::jsonb END) AS e) AS n
     WHERE m.is_enabled AND m.module_id <> $1::uuid AND n.route_path = ANY($2::text[])
     ORDER BY n.route_path, m.module_key`,
  activeVersions: `
    SELECT ${VERSION_COLUMNS} FROM foundation.fnd_module_versions AS v WHERE v.module_id = $1::uuid AND v.status = 'ACTIVE'`,
  // L3: the most recent B13 check(s) of exactly this version of this module (more than one row = ambiguous → refused).
  latestChecks: `
    SELECT k.check_id::text AS check_id, k.check_result
      FROM foundation.fnd_compatibility_checks AS k
     WHERE k.to_version_id = $1::uuid AND k.module_id = $2::uuid
       AND k.started_at = (SELECT max(x.started_at) FROM foundation.fnd_compatibility_checks AS x WHERE x.to_version_id = $1::uuid AND x.module_id = $2::uuid)`,
  // L3 / K11: a BLOCKING change of the check counts whatever its resolution_status (only a new check clears it).
  blockingChanges: `
    SELECT count(*)::int AS n FROM foundation.fnd_compatibility_changes AS c WHERE c.check_id = $1::uuid AND c.severity = 'BLOCKING'`,
  // L3 / baseline principle 17: DIRECT_DB needs a separate approval, which has no recorded evidence yet.
  directDbContracts: `
    SELECT count(*)::int AS n FROM foundation.fnd_data_contracts AS d WHERE d.version_id = $1::uuid AND d.interface_kind = 'DIRECT_DB'`,
  // L5 / K03: is_enabled with updated_at; only from the opposite state.
  enableModule: `
    UPDATE foundation.fnd_modules AS m SET is_enabled = true, updated_at = now()
     WHERE m.module_id = $1::uuid AND m.is_enabled = false
    RETURNING ${MODULE_COLUMNS}`,
  disableModule: `
    UPDATE foundation.fnd_modules AS m SET is_enabled = false, updated_at = now()
     WHERE m.module_id = $1::uuid AND m.is_enabled = true
    RETURNING ${MODULE_COLUMNS}`,
  // L8: B07 with an approved event type (N-08). version_id NULL for ENABLE / DISABLE. No RETURNING.
  insertLifecycleEvent: `
    INSERT INTO foundation.fnd_module_events (module_id, version_id, event_type, actor_account_id, before_state, after_state, correlation_id)
    VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb, $6::jsonb, $7)`,
} as const;

export type LifecycleEventType = 'APPROVE' | 'REJECT' | 'ACTIVATE' | 'RETIRE' | 'ENABLE' | 'DISABLE' | 'ROLLBACK';

export interface CompatibilityCheckFact {
  readonly checkId: string;
  readonly checkResult: string;
}

export interface ActivationFacts {
  readonly version: VersionRecord;
  readonly checks: readonly CompatibilityCheckFact[];
  readonly blockingChanges: number;
  readonly directDbContracts: number;
}

interface Actorish {
  readonly moduleId: string;
  readonly actorAccountId: string;
  readonly correlationId: string;
}

export interface ReviewCommand extends Actorish {
  readonly versionId: string;
  readonly decision: 'APPROVE' | 'REJECT';
  readonly audit: (version: VersionRecord) => VersionAuditRecord;
}

export interface ActivateCommand extends Actorish {
  readonly versionId: string;
  // Throws to refuse the activation (nothing is written).
  readonly gate: (facts: ActivationFacts) => void;
  readonly audit: (version: VersionRecord, retired: VersionRecord | null) => VersionAuditRecord;
}

export interface RetireCommand extends Actorish {
  readonly versionId: string;
  readonly audit: (version: VersionRecord) => VersionAuditRecord;
}

export interface ModuleToggleCommand extends Actorish {
  readonly enable: boolean;
  // ENABLE only: receives the ACTIVE versions of the module and the facts of the single one (null otherwise); throws to refuse.
  readonly gate: (activeVersions: number, facts: ActivationFacts | null) => void;
  readonly audit: (module: ModuleRecord) => AuditRecord;
}

export interface RecoverCommand extends Actorish {
  readonly failedVersionId: string;
  readonly restoreVersionId: string;
  // activated_at of the failed version as returned by its activation (installer journal): proves no later activation.
  readonly failedActivatedAt: string;
  // Throws to refuse (e.g. restored manifest not intact).
  readonly gate: (restore: VersionRecord) => void;
  readonly audit: (restored: VersionRecord, retired: VersionRecord) => VersionAuditRecord;
}

export class RecoveryProofError extends Error {
  constructor() {
    super('recovery proof does not match the stored state');
    this.name = 'RecoveryProofError';
  }
}

export class RouteConflictError extends Error {
  constructor(readonly conflicts: readonly { readonly routePath: string; readonly moduleKey: string }[]) {
    super('route already used by an enabled module');
    this.name = 'RouteConflictError';
  }
}

export interface ActivationResult {
  readonly version: VersionRecord;
  readonly retired: VersionRecord | null;
}

export class LifecycleVersionNotFoundError extends Error {
  constructor() {
    super('version not found in module');
    this.name = 'LifecycleVersionNotFoundError';
  }
}

export class VersionStateConflictError extends Error {
  constructor() {
    super('version is not in the state required by the transition');
    this.name = 'VersionStateConflictError';
  }
}

export class ModuleStateConflictError extends Error {
  constructor() {
    super('module is already in the requested enabled state');
    this.name = 'ModuleStateConflictError';
  }
}

export interface LifecycleRepository {
  reviewVersion(command: ReviewCommand): Promise<VersionRecord>;
  activateVersion(command: ActivateCommand): Promise<ActivationResult>;
  retireVersion(command: RetireCommand): Promise<VersionRecord>;
  setModuleEnabled(command: ModuleToggleCommand): Promise<ModuleRecord>;
  recoverUpgrade(command: RecoverCommand): Promise<ActivationResult>;
}

const moduleRow = z.object({
  module_id: z.string(), module_key: z.string(), module_name: z.string(), description: z.string().nullable(), module_type: z.string(),
  is_enabled: z.boolean(), created_at: z.string(), updated_at: z.string(), created_by_account_id: z.string().nullable(),
});
const checkRow = z.object({ check_id: z.string(), check_result: z.string() });
const countRow = z.object({ n: z.number().int() });
const holderRow = z.object({ route_path: z.string(), module_key: z.string() });

// MIC-04 route paths of a stored manifest (non-blank strings only).
export function mic04Routes(manifest: unknown): string[] {
  const nav = typeof manifest === 'object' && manifest !== null && 'mic04Navigation' in manifest ? (manifest as { mic04Navigation: unknown }).mic04Navigation : null;
  if (!Array.isArray(nav)) return [];
  return [...new Set(nav.flatMap((n: unknown) => (typeof n === 'object' && n !== null && 'routePath' in n && typeof n.routePath === 'string' && n.routePath.trim() !== '' ? [n.routePath] : [])))];
}

function toModule(row: unknown): ModuleRecord {
  const m = moduleRow.parse(row);
  return {
    moduleId: m.module_id, moduleKey: m.module_key, moduleName: m.module_name, description: m.description, moduleType: m.module_type,
    isEnabled: m.is_enabled, createdAt: m.created_at, updatedAt: m.updated_at, createdByAccountId: m.created_by_account_id,
  };
}

function moduleAuditParams(record: AuditRecord): unknown[] {
  return [
    record.eventId, record.moduleId, record.actorAccountId, record.actionCode, record.targetType, record.targetId, record.outcome,
    record.correlationId, record.sourceService, JSON.stringify(record.metadata),
  ];
}

async function count(tx: SqlExecutor, sql: string, params: readonly unknown[]): Promise<number> {
  const rows = (await tx.query(sql, params)).map((r) => countRow.parse(r));
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) throw new Error('lifecycle: count query returned no single row');
  return row.n;
}

// Exactly one row from a conditional UPDATE; no row = the state changed under us (refused, never a success).
function updatedVersion(rows: unknown[]): VersionRecord {
  const [row] = rows;
  if (rows.length > 1) throw new Error('lifecycle: conditional UPDATE matched more than one version');
  if (row === undefined) throw new VersionStateConflictError();
  return toVersion(row);
}

async function lockedVersion(tx: SqlExecutor, moduleId: string, versionId: string, required: string): Promise<VersionRecord> {
  await tx.execute(VERSION_SQL.lockModuleVersions, [moduleId]);
  const [row] = await tx.query(VERSION_SQL.getVersion, [versionId, moduleId]);
  if (row === undefined) throw new LifecycleVersionNotFoundError();
  const version = toVersion(row);
  if (version.status !== required) throw new VersionStateConflictError();
  return version;
}

async function activationFacts(tx: SqlExecutor, version: VersionRecord): Promise<ActivationFacts> {
  const checks = (await tx.query(LIFECYCLE_SQL.latestChecks, [version.versionId, version.moduleId])).map((r) => {
    const c = checkRow.parse(r);
    return { checkId: c.check_id, checkResult: c.check_result };
  });
  const [only] = checks;
  const blockingChanges = checks.length === 1 && only ? await count(tx, LIFECYCLE_SQL.blockingChanges, [only.checkId]) : 0;
  const directDbContracts = await count(tx, LIFECYCLE_SQL.directDbContracts, [version.versionId]);
  return { version, checks, blockingChanges, directDbContracts };
}

export class SqlLifecycleRepository implements LifecycleRepository {
  private readonly db: FoundationDb;

  constructor(db: FoundationDb) {
    this.db = db;
  }

  async reviewVersion(command: ReviewCommand): Promise<VersionRecord> {
    const { moduleId, versionId, decision } = command;
    return this.db.transaction(async (tx) => {
      await lockedVersion(tx, moduleId, versionId, 'IN_REVIEW');
      const sql = decision === 'APPROVE' ? LIFECYCLE_SQL.approveVersion : LIFECYCLE_SQL.rejectVersion;
      const version = updatedVersion(await tx.query(sql, [versionId, moduleId, command.actorAccountId]));
      await this.event(tx, command, versionId, decision, 'IN_REVIEW', version.status);
      await tx.execute(VERSION_SQL.insertVersionAudit, versionAuditParams(command.audit(version)));
      return version;
    });
  }

  async activateVersion(command: ActivateCommand): Promise<ActivationResult> {
    const { moduleId, versionId } = command;
    return this.db.transaction(async (tx) => {
      const target = await lockedVersion(tx, moduleId, versionId, 'APPROVED');
      command.gate(await activationFacts(tx, target));
      // Retire-before-activate (Q01): 0 or 1 ACTIVE version of the module.
      const retiredRows = await tx.query(LIFECYCLE_SQL.retireCurrentActive, [moduleId, versionId]);
      if (retiredRows.length > 1) throw new Error('lifecycle: more than one ACTIVE version in the module');
      const [retiredRow] = retiredRows;
      const retired = retiredRow === undefined ? null : toVersion(retiredRow);
      if (retired) await this.event(tx, command, retired.versionId, 'RETIRE', 'ACTIVE', 'RETIRED');
      const version = updatedVersion(await tx.query(LIFECYCLE_SQL.activateVersion, [versionId, moduleId]));
      await this.event(tx, command, versionId, 'ACTIVATE', 'APPROVED', 'ACTIVE');
      await tx.execute(VERSION_SQL.insertVersionAudit, versionAuditParams(command.audit(version, retired)));
      return { version, retired };
    });
  }

  async retireVersion(command: RetireCommand): Promise<VersionRecord> {
    const { moduleId, versionId } = command;
    return this.db.transaction(async (tx) => {
      await lockedVersion(tx, moduleId, versionId, 'ACTIVE');
      const version = updatedVersion(await tx.query(LIFECYCLE_SQL.retireVersion, [versionId, moduleId]));
      await this.event(tx, command, versionId, 'RETIRE', 'ACTIVE', 'RETIRED');
      await tx.execute(VERSION_SQL.insertVersionAudit, versionAuditParams(command.audit(version)));
      return version;
    });
  }

  async setModuleEnabled(command: ModuleToggleCommand): Promise<ModuleRecord> {
    const { moduleId, enable } = command;
    return this.db.transaction(async (tx) => {
      await tx.execute(VERSION_SQL.lockModuleVersions, [moduleId]);
      const [raw] = await tx.query(LIFECYCLE_SQL.getModule, [moduleId]);
      if (raw === undefined) throw new ModuleNotFoundError();
      if (toModule(raw).isEnabled === enable) throw new ModuleStateConflictError();
      if (enable) {
        const active = (await tx.query(LIFECYCLE_SQL.activeVersions, [moduleId])).map(toVersion);
        const [only] = active;
        command.gate(active.length, active.length === 1 && only ? await activationFacts(tx, only) : null);
        const routes = only ? mic04Routes(only.manifestJson) : [];
        await tx.execute(LIFECYCLE_SQL.lockRouteClaims, []);
        if (routes.length > 0) {
          const holders = (await tx.query(LIFECYCLE_SQL.routeHolders, [moduleId, routes])).map((r) => holderRow.parse(r));
          if (holders.length > 0) throw new RouteConflictError(holders.map((h) => ({ routePath: h.route_path, moduleKey: h.module_key })));
        }
      }
      const rows = await tx.query(enable ? LIFECYCLE_SQL.enableModule : LIFECYCLE_SQL.disableModule, [moduleId]);
      const [row] = rows;
      if (rows.length !== 1 || row === undefined) throw new ModuleStateConflictError();
      const module = toModule(row);
      await this.event(tx, command, null, enable ? 'ENABLE' : 'DISABLE', { is_enabled: !enable }, { is_enabled: enable });
      await tx.execute(FOUNDATION_SQL.insertAudit, moduleAuditParams(command.audit(module)));
      return module;
    });
  }

  async recoverUpgrade(command: RecoverCommand): Promise<ActivationResult> {
    const { moduleId, failedVersionId, restoreVersionId } = command;
    return this.db.transaction(async (tx) => {
      const failed = await lockedVersion(tx, moduleId, failedVersionId, 'ACTIVE');
      if (failed.activatedAt !== command.failedActivatedAt || failedVersionId === restoreVersionId) throw new RecoveryProofError();
      const [raw] = await tx.query(VERSION_SQL.getVersion, [restoreVersionId, moduleId]);
      if (raw === undefined) throw new LifecycleVersionNotFoundError();
      const restore = toVersion(raw);
      if (restore.status !== 'RETIRED' || restore.activatedAt === null) throw new VersionStateConflictError();
      command.gate(restore);
      // Retire-before-reactivate (one-ACTIVE index): both changes, their B07 rows and the B08 row commit together.
      const retired = updatedVersion(await tx.query(LIFECYCLE_SQL.retireVersion, [failedVersionId, moduleId]));
      await this.event(tx, command, failedVersionId, 'RETIRE', 'ACTIVE', 'RETIRED');
      const restored = updatedVersion(await tx.query(LIFECYCLE_SQL.reactivateVersion, [restoreVersionId, moduleId]));
      await this.event(tx, command, restoreVersionId, 'ROLLBACK', 'RETIRED', 'ACTIVE');
      await tx.execute(VERSION_SQL.insertVersionAudit, versionAuditParams(command.audit(restored, retired)));
      return { version: restored, retired };
    });
  }

  private async event(
    tx: SqlExecutor, command: Actorish, versionId: string | null, type: LifecycleEventType,
    before: string | Readonly<Record<string, boolean>>, after: string | Readonly<Record<string, boolean>>,
  ): Promise<void> {
    const state = (value: string | Readonly<Record<string, boolean>>) => JSON.stringify(typeof value === 'string' ? { status: value } : value);
    await tx.execute(LIFECYCLE_SQL.insertLifecycleEvent, [
      command.moduleId, versionId, type, command.actorAccountId, state(before), state(after), command.correlationId,
    ]);
  }
}
