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
  // SCC 0.1.3 — the fleet is judged on the WHOLE registry by aggregates (one row per fixture flag); only bounded lists
  // travel to the browser. `FBET_` is a fixture CANDIDATE label (OD-SCC-01): it never removes a module from any count.
  fleetSummary: `WITH f AS (SELECT m.module_key LIKE 'FBET!_%' ESCAPE '!' AS fixture_candidate, m.is_enabled,
      count(v.version_id)::int AS vc, count(v.version_id) FILTER (WHERE v.status='ACTIVE')::int AS ac
      FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
      GROUP BY m.module_id,m.module_key,m.is_enabled)
    SELECT fixture_candidate, count(*)::int AS registered, count(*) FILTER (WHERE is_enabled)::int AS enabled,
      count(*) FILTER (WHERE ac=1)::int AS with_active, count(*) FILTER (WHERE is_enabled AND ac=1)::int AS enabled_active,
      count(*) FILTER (WHERE is_enabled AND ac<>1)::int AS enabled_without_active, count(*) FILTER (WHERE ac>1)::int AS multi_active,
      count(*) FILTER (WHERE vc=0)::int AS no_version, count(*) FILTER (WHERE vc=0 AND is_enabled)::int AS enabled_no_version,
      coalesce(sum(vc),0)::int AS versions
    FROM f GROUP BY fixture_candidate ORDER BY fixture_candidate`,
  versionStatuses: `SELECT status, count(*)::int AS n FROM foundation.fnd_module_versions GROUP BY status ORDER BY status`,
  // Lifecycle anomalies of the whole registry (ENABLED without exactly one ACTIVE, or several ACTIVE): non-fixture first. $1 = cap + 1.
  fleetAnomalies: `SELECT m.module_key, m.is_enabled, m.module_key LIKE 'FBET!_%' ESCAPE '!' AS fixture_candidate,
      count(v.version_id)::int AS version_count, count(v.version_id) FILTER (WHERE v.status='ACTIVE')::int AS active_versions
    FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
    GROUP BY m.module_id,m.module_key,m.is_enabled
    HAVING count(v.version_id) FILTER (WHERE v.status='ACTIVE') > 1
        OR (m.is_enabled AND count(v.version_id) FILTER (WHERE v.status='ACTIVE') <> 1)
    ORDER BY 3, m.module_key LIMIT $1`,
  // Non-fixture modules (system / business): always listed, the SCC module included. $1 = cap + 1.
  fleetModules: `SELECT m.module_key, m.is_enabled, false AS fixture_candidate,
      count(v.version_id)::int AS version_count, count(v.version_id) FILTER (WHERE v.status='ACTIVE')::int AS active_versions
    FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
    WHERE m.module_key NOT LIKE 'FBET!_%' ESCAPE '!'
    GROUP BY m.module_id,m.module_key,m.is_enabled ORDER BY m.module_key LIMIT $1`,
  // Deployment Sync: registry state of the packages the Host runs ($1) and the ENABLED + ACTIVE modules without a package.
  deploymentRegistry: `SELECT m.module_key, m.is_enabled,
      count(v.version_id) FILTER (WHERE v.status='ACTIVE')::int AS active_versions,
      min(v.module_version) FILTER (WHERE v.status='ACTIVE') AS active_version
    FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
    WHERE m.module_key = ANY($1::text[]) GROUP BY m.module_id,m.module_key,m.is_enabled ORDER BY m.module_key`,
  registryOnly: `WITH f AS (SELECT m.module_key, m.module_key LIKE 'FBET!_%' ESCAPE '!' AS fixture_candidate
      FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status='ACTIVE'
      WHERE m.is_enabled AND NOT (m.module_key = ANY($1::text[])))
    SELECT count(*) FILTER (WHERE fixture_candidate)::int AS fixture,
      count(*) FILTER (WHERE NOT fixture_candidate)::int AS other,
      coalesce((array_agg(module_key ORDER BY module_key) FILTER (WHERE NOT fixture_candidate))[1:20], '{}') AS other_keys
    FROM f`,
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
export interface FleetModule { readonly moduleKey: string; readonly enabled: boolean; readonly versionCount: number; readonly activeVersions: number; readonly fixtureCandidate: boolean }
export interface FleetCounts {
  readonly registered: number; readonly enabled: number; readonly withActive: number; readonly enabledActive: number;
  readonly enabledWithoutActive: number; readonly multiActive: number; readonly noVersion: number; readonly enabledNoVersion: number; readonly versions: number;
}
// Whole-registry snapshot: `all` = every module (fixture candidates included), `fixtureCandidates` = the FBET_ part of it.
export interface FleetSnapshot {
  readonly all: FleetCounts;
  readonly fixtureCandidates: FleetCounts;
  readonly versionStatuses: Readonly<Record<string, number>>;
  readonly anomalies: readonly FleetModule[];
  readonly anomaliesTruncated: boolean;
  readonly modules: readonly FleetModule[];
  readonly modulesTruncated: boolean;
}
export interface DeploymentRegistryRow { readonly moduleKey: string; readonly isEnabled: boolean; readonly activeVersions: number; readonly activeVersion: string | null }
export interface DeploymentRegistry {
  readonly rows: readonly DeploymentRegistryRow[];
  readonly registryOnly: { readonly fixture: number; readonly other: number; readonly otherKeys: readonly string[] };
}
export const FLEET_LIST_CAP = 100;
export interface ActivityMetrics { readonly connections: number; readonly maxConnections: number; readonly deadlocks: number; readonly commits: number; readonly rollbacks: number; readonly statsReset: string | null }
export interface AuditMetrics { readonly denied: number; readonly failures: number }
export type Readable<T> = { readonly state: 'AVAILABLE'; readonly value: T } | { readonly state: 'UNAVAILABLE'; readonly sqlstate?: string };
export interface OperationsSnapshot {
  readonly fleet: Readable<FleetSnapshot>;
  readonly activity: Readable<ActivityMetrics>;
  readonly audit: Readable<AuditMetrics>;
}
export interface SystemTestRepository {
  diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot>;
  operations(): Promise<OperationsSnapshot>;
  deploymentRegistry(moduleKeys: readonly string[]): Promise<DeploymentRegistry>;
}

const identitySchema = z.object({ database_name: z.string(), role_name: z.string(), server_version: z.string() });
const moduleSchema = z.object({ module_id: z.string(), is_enabled: z.boolean(), active_versions: z.number().int() });
const versionSchema = z.object({ version_id: z.string(), module_version: z.string(), manifest_json: z.unknown(), manifest_hash: z.string().nullable() });
const functionSchema = z.object({ function_key: z.string() });
const actionSchema = z.object({ function_key: z.string(), action_key: z.string() });
const contractSchema = z.object({ resource_key: z.string(), interface_kind: z.string(), fields: z.number().int() });
const compatibilitySchema = z.object({ check_result: z.string(), blocking: z.number().int() });
const fleetSchema = z.object({ module_key: z.string(), is_enabled: z.boolean(), fixture_candidate: z.boolean(), version_count: z.number().int(), active_versions: z.number().int() });
const count = z.number().int().min(0);
const fleetSummarySchema = z.object({ fixture_candidate: z.boolean(), registered: count, enabled: count, with_active: count, enabled_active: count,
  enabled_without_active: count, multi_active: count, no_version: count, enabled_no_version: count, versions: count });
const versionStatusSchema = z.object({ status: z.string(), n: count });
const deploymentRowSchema = z.object({ module_key: z.string(), is_enabled: z.boolean(), active_versions: count, active_version: z.string().nullable() });
const registryOnlySchema = z.object({ fixture: count, other: count, other_keys: z.array(z.string()) });
const ZERO: FleetCounts = { registered: 0, enabled: 0, withActive: 0, enabledActive: 0, enabledWithoutActive: 0, multiActive: 0, noVersion: 0, enabledNoVersion: 0, versions: 0 };
const toCounts = (x: z.infer<typeof fleetSummarySchema>): FleetCounts => ({ registered: x.registered, enabled: x.enabled, withActive: x.with_active,
  enabledActive: x.enabled_active, enabledWithoutActive: x.enabled_without_active, multiActive: x.multi_active, noVersion: x.no_version,
  enabledNoVersion: x.enabled_no_version, versions: x.versions });
const addCounts = (a: FleetCounts, b: FleetCounts): FleetCounts =>
  Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k as keyof FleetCounts] + b[k as keyof FleetCounts]])) as unknown as FleetCounts;
const toFleetModule = (r: unknown): FleetModule => {
  const x = fleetSchema.parse(r);
  return { moduleKey: x.module_key, enabled: x.is_enabled, versionCount: x.version_count, activeVersions: x.active_versions, fixtureCandidate: x.fixture_candidate };
};
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
      safe(async (tx): Promise<FleetSnapshot> => {
        // One READ ONLY transaction: the aggregates and the bounded lists see the same snapshot.
        let all = ZERO; let fixtureCandidates = ZERO;
        for (const r of await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.fleetSummary, [])) {
          const x = fleetSummarySchema.parse(r); const c = toCounts(x);
          all = addCounts(all, c); if (x.fixture_candidate) fixtureCandidates = c;
        }
        const versionStatuses: Record<string, number> = {};
        for (const r of await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.versionStatuses, [])) { const x = versionStatusSchema.parse(r); versionStatuses[x.status] = x.n; }
        const anomalies = (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.fleetAnomalies, [FLEET_LIST_CAP + 1])).map(toFleetModule);
        const modules = (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.fleetModules, [FLEET_LIST_CAP + 1])).map(toFleetModule);
        return { all, fixtureCandidates, versionStatuses,
          anomalies: anomalies.slice(0, FLEET_LIST_CAP), anomaliesTruncated: anomalies.length > FLEET_LIST_CAP,
          modules: modules.slice(0, FLEET_LIST_CAP), modulesTruncated: modules.length > FLEET_LIST_CAP };
      }),
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

  async deploymentRegistry(moduleKeys: readonly string[]): Promise<DeploymentRegistry> {
    return this.host.readOnly(async (tx: ReadOnlyQuery) => {
      const keys = [...moduleKeys];
      const rows = (await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.deploymentRegistry, [keys])).map((r) => {
        const x = deploymentRowSchema.parse(r);
        return { moduleKey: x.module_key, isEnabled: x.is_enabled, activeVersions: x.active_versions, activeVersion: x.active_version };
      });
      const o = registryOnlySchema.parse((await tx.query(SYSTEM_CONTROLLER_CENTER_SQL.registryOnly, [keys]))[0]);
      return { rows, registryOnly: { fixture: o.fixture, other: o.other, otherKeys: o.other_keys } };
    });
  }
}
