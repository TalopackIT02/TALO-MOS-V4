import { z } from 'zod';
import type { ModuleHost, ReadOnlyQuery } from './host.js';

/** SystemTest 1.1: read-only diagnostics; no arbitrary SQL or table-browser endpoints. */
export const SYSTEM_CONTROLLER_CENTER_SQL = {
  identity: `SELECT current_database() AS database_name, current_user AS role_name, current_setting('server_version') AS server_version`,
  moduleState: `SELECT m.module_id::text AS module_id, m.is_enabled,
    (SELECT count(*)::int FROM foundation.fnd_module_versions v WHERE v.module_id=m.module_id AND v.status='ACTIVE') AS active_versions
    FROM foundation.fnd_modules m WHERE m.module_key=$1`,
  activeVersions: `SELECT version_id::text AS version_id, module_version, manifest_json, manifest_hash
    FROM foundation.fnd_module_versions WHERE module_id=$1::uuid AND status='ACTIVE' ORDER BY version_id`,
  versionFunctions: `SELECT f.function_key FROM foundation.fnd_version_functions vf
    JOIN foundation.fnd_functions f ON f.function_id=vf.function_id WHERE vf.version_id=$1::uuid ORDER BY f.function_key`,
  versionActions: `SELECT f.function_key,a.action_key FROM foundation.fnd_version_actions va
    JOIN foundation.fnd_version_functions vf ON vf.version_function_id=va.version_function_id
    JOIN foundation.fnd_actions a ON a.action_id=va.action_id
    JOIN foundation.fnd_functions f ON f.function_id=a.function_id
    WHERE vf.version_id=$1::uuid ORDER BY f.function_key,a.action_key`,
  dataContracts: `SELECT c.resource_key,c.interface_kind,
    (SELECT count(*)::int FROM foundation.fnd_data_fields d WHERE d.data_contract_id=c.data_contract_id) AS fields
    FROM foundation.fnd_data_contracts c WHERE c.version_id=$1::uuid ORDER BY c.resource_key`,
  latestCompatibility: `SELECT k.check_result,
    (SELECT count(*)::int FROM foundation.fnd_compatibility_changes x WHERE x.check_id=k.check_id AND x.severity='BLOCKING') AS blocking
    FROM foundation.fnd_compatibility_checks k WHERE k.to_version_id=$1::uuid
    ORDER BY k.started_at DESC,k.check_id DESC LIMIT 1`,
  fleet: `SELECT m.module_key,m.is_enabled,
    count(v.version_id)::int AS version_count,
    count(v.version_id) FILTER (WHERE v.status='ACTIVE')::int AS active_versions
    FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
    GROUP BY m.module_id,m.module_key,m.is_enabled ORDER BY m.module_key LIMIT 201`,
  activity: `SELECT s.numbackends::int AS connections,
    current_setting('max_connections')::int AS max_connections,
    s.deadlocks::text AS deadlocks, s.xact_commit::text AS commits, s.xact_rollback::text AS rollbacks,
    s.stats_reset::text AS stats_reset
    FROM pg_catalog.pg_stat_database s WHERE s.datname=current_database()`,
  audit: `SELECT denied, failures FROM audit_api.read_foundation_audit_summary(
    statement_timestamp() - interval '1 hour', statement_timestamp())`,
} as const;

export interface ModuleState { readonly moduleId: string; readonly isEnabled: boolean; readonly activeVersions: number }
export interface ActiveVersion { readonly versionId: string; readonly moduleVersion: string; readonly manifestJson: unknown; readonly manifestHash: string | null }
export interface DiagnosticsSnapshot {
  readonly identity: { readonly databaseName: string; readonly roleName: string; readonly serverVersion: string };
  readonly module: ModuleState | null;
  readonly activeVersions: readonly ActiveVersion[];
  readonly functions: readonly string[];
  readonly actions: readonly string[];
  readonly contracts: readonly { readonly resourceKey: string; readonly interfaceKind: string; readonly fields: number }[];
  readonly compatibility: { readonly checkResult: string; readonly blocking: number } | null;
}
export interface FleetModule { readonly moduleKey: string; readonly enabled: boolean; readonly versionCount: number; readonly activeVersions: number }
export interface ActivityMetrics { readonly connections: number; readonly maxConnections: number; readonly deadlocks: number; readonly commits: number; readonly rollbacks: number; readonly statsReset: string | null }
export interface AuditMetrics { readonly denied: number; readonly failures: number }
export type Readable<T> = { readonly state: 'AVAILABLE'; readonly value: T } | { readonly state: 'UNAVAILABLE'; readonly sqlstate?: string };
export interface OperationsSnapshot {
  readonly fleet: Readable<readonly FleetModule[]>;
  readonly activity: Readable<ActivityMetrics>;
  readonly audit: Readable<AuditMetrics>;
}
export interface SystemTestRepository {
  diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot>;
  operations(): Promise<OperationsSnapshot>;
}

const identitySchema = z.object({ database_name: z.string(), role_name: z.string(), server_version: z.string() });
const moduleSchema = z.object({ module_id: z.string(), is_enabled: z.boolean(), active_versions: z.number().int() });
const versionSchema = z.object({ version_id: z.string(), module_version: z.string(), manifest_json: z.unknown(), manifest_hash: z.string().nullable() });
const functionSchema = z.object({ function_key: z.string() });
const actionSchema = z.object({ function_key: z.string(), action_key: z.string() });
const contractSchema = z.object({ resource_key: z.string(), interface_kind: z.string(), fields: z.number().int() });
const compatibilitySchema = z.object({ check_result: z.string(), blocking: z.number().int() });
const fleetSchema = z.object({ module_key: z.string(), is_enabled: z.boolean(), version_count: z.number().int(), active_versions: z.number().int() });
const activitySchema = z.object({ connections: z.number().int(), max_connections: z.number().int(), deadlocks: z.string(), commits: z.string(), rollbacks: z.string(), stats_reset: z.string().nullable() });
const auditSchema = z.object({ denied: z.number().int(), failures: z.number().int() });

export class SqlSystemTestRepository implements SystemTestRepository {
  constructor(private readonly host: Pick<ModuleHost, 'readOnly' | 'sqlstate'>) {}
  async diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot> {
    return this.host.readOnly(async (tx: ReadOnlyQuery) => {
      const id = identitySchema.parse((await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.identity, []))[0]);
      const m = (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.moduleState, [moduleKey]))[0];
      const a = m === undefined ? null : moduleSchema.parse(m);
      const module = a ? { moduleId: a.module_id, isEnabled: a.is_enabled, activeVersions: a.active_versions } : null;
      const activeVersions = module ? (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.activeVersions, [module.moduleId])).map((v) => {
        const x = versionSchema.parse(v);
        return { versionId: x.version_id, moduleVersion: x.module_version, manifestJson: x.manifest_json, manifestHash: x.manifest_hash };
      }) : [];
      const versionId = activeVersions.length === 1 ? activeVersions[0]?.versionId : undefined;
      const functions = versionId ? (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.versionFunctions, [versionId])).map((r) => functionSchema.parse(r).function_key) : [];
      const actions = versionId ? (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.versionActions, [versionId])).map((r) => { const x = actionSchema.parse(r); return `${x.function_key}.${x.action_key}`; }) : [];
      const contracts = versionId ? (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.dataContracts, [versionId])).map((r) => {
        const x = contractSchema.parse(r); return { resourceKey: x.resource_key, interfaceKind: x.interface_kind, fields: x.fields };
      }) : [];
      const c = versionId ? (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.latestCompatibility, [versionId]))[0] : undefined;
      const compat = c === undefined ? null : compatibilitySchema.parse(c);
      return { identity: { databaseName: id.database_name, roleName: id.role_name, serverVersion: id.server_version }, module,
        activeVersions, functions, actions, contracts,
        compatibility: compat ? { checkResult: compat.check_result, blocking: compat.blocking } : null };
    });
  }

  async operations(): Promise<OperationsSnapshot> {
    // Independent capabilities: unavailable audit metadata must not hide a healthy database and module fleet.
    const safe = async <T>(fn: (tx: ReadOnlyQuery) => Promise<T>): Promise<Readable<T>> => {
      try { return { state: 'AVAILABLE', value: await this.host.readOnly(fn) }; }
      catch (error) { const state = this.host.sqlstate(error); return { state: 'UNAVAILABLE', ...(state ? { sqlstate: state } : {}) }; }
    };
    const [fleet, activity, audit] = await Promise.all([
      safe(async tx => (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.fleet, [])).map((r) => {
        const x = fleetSchema.parse(r); return { moduleKey: x.module_key, enabled: x.is_enabled, versionCount: x.version_count, activeVersions: x.active_versions };
      })),
      safe(async tx => {
        const x = activitySchema.parse((await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.activity, []))[0]);
        return { connections: x.connections, maxConnections: x.max_connections, deadlocks: Number(x.deadlocks), commits: Number(x.commits), rollbacks: Number(x.rollbacks), statsReset: x.stats_reset };
      }),
      safe(async tx => {
        const x = auditSchema.parse((await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.audit, []))[0]); return { denied: x.denied, failures: x.failures };
      }),
    ]);
    return { fleet, activity, audit };
  }
}
