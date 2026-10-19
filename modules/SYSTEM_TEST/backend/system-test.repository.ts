import { z } from 'zod';
import type { ModuleHost, ReadOnlyQuery as SqlExecutor } from './host.js';
import { countSql, rowsSql } from './system-test.tables.js';
import type { ViewerTable } from './system-test.tables.js';

// MOD-TEST-01 — every statement of the SYSTEM_TEST module. SELECT only: the module never writes Foundation, IAM or any
// other table (its only write path is the shared AccessGuard DENIED audit). Values travel as bind parameters; SQL
// identifiers come from the server allowlist (system-test.tables.ts). Diagnostics and Data Viewer reads run in a
// READ ONLY transaction with a statement timeout, provided by the Host (MOD-TEST-02 capability `readOnly`).

export const SYSTEM_TEST_SQL = {
  // Diagnostics (Registry / Lifecycle components): module row + number of ACTIVE versions.
  moduleState: `
    SELECT m.module_id::text AS module_id, m.is_enabled,
           (SELECT count(*)::int FROM foundation.fnd_module_versions AS v WHERE v.module_id = m.module_id AND v.status = 'ACTIVE') AS active_versions
      FROM foundation.fnd_modules AS m
     WHERE m.module_key = $1`,
  // One row per (table key, column); true when the API role may SELECT that column (table or column grant).
  columnPrivileges: `
    SELECT t.k AS table_key, bool_and(has_column_privilege(current_user, t.rel, t.col, 'SELECT')) AS readable
      FROM unnest($1::text[], $2::text[], $3::text[]) AS t(k, rel, col)
     GROUP BY t.k`,
  identity: `SELECT current_database() AS database_name, current_user AS role_name, current_setting('server_version') AS server_version`,
  activeVersions: `
    SELECT v.version_id::text AS version_id, v.module_version, v.manifest_json, v.manifest_hash
      FROM foundation.fnd_module_versions AS v
     WHERE v.module_id = $1::uuid AND v.status = 'ACTIVE'
     ORDER BY v.version_id`,
  versionFunctions: `
    SELECT f.function_key FROM foundation.fnd_version_functions AS vf
      JOIN foundation.fnd_functions AS f ON f.function_id = vf.function_id
     WHERE vf.version_id = $1::uuid ORDER BY f.function_key`,
  versionActions: `
    SELECT f.function_key, a.action_key FROM foundation.fnd_version_actions AS va
      JOIN foundation.fnd_version_functions AS vf ON vf.version_function_id = va.version_function_id
      JOIN foundation.fnd_actions AS a ON a.action_id = va.action_id
      JOIN foundation.fnd_functions AS f ON f.function_id = a.function_id
     WHERE vf.version_id = $1::uuid ORDER BY f.function_key, a.action_key`,
  dataContracts: `
    SELECT c.resource_key, c.interface_kind,
           (SELECT count(*)::int FROM foundation.fnd_data_fields AS d WHERE d.data_contract_id = c.data_contract_id) AS fields
      FROM foundation.fnd_data_contracts AS c
     WHERE c.version_id = $1::uuid ORDER BY c.resource_key`,
  latestCompatibility: `
    SELECT k.check_result,
           (SELECT count(*)::int FROM foundation.fnd_compatibility_changes AS x WHERE x.check_id = k.check_id AND x.severity = 'BLOCKING') AS blocking
      FROM foundation.fnd_compatibility_checks AS k
     WHERE k.to_version_id = $1::uuid
     ORDER BY k.started_at DESC, k.check_id DESC
     LIMIT 1`,
} as const;

export interface ModuleState {
  readonly moduleId: string;
  readonly isEnabled: boolean;
  readonly activeVersions: number;
}

export interface ActiveVersion {
  readonly versionId: string;
  readonly moduleVersion: string;
  readonly manifestJson: unknown;
  readonly manifestHash: string | null;
}

export interface DiagnosticsSnapshot {
  readonly identity: { readonly databaseName: string; readonly roleName: string; readonly serverVersion: string };
  readonly module: ModuleState | null;
  readonly activeVersions: readonly ActiveVersion[];
  // Of the single ACTIVE version (empty when there is not exactly one).
  readonly functions: readonly string[];
  readonly actions: readonly string[]; // FUNCTION.ACTION
  readonly contracts: readonly { readonly resourceKey: string; readonly interfaceKind: string; readonly fields: number }[];
  readonly compatibility: { readonly checkResult: string; readonly blocking: number } | null;
}

export interface TablePage {
  readonly totalRows: number;
  readonly rows: readonly (readonly (string | null)[])[];
}

export class TableNotReadableError extends Error {
  constructor() {
    super('table not readable by the API role');
    this.name = 'TableNotReadableError';
  }
}

export interface SystemTestRepository {
  readableTables(tables: readonly ViewerTable[]): Promise<ReadonlyMap<string, boolean>>;
  // Throws TableNotReadableError when a listed column is not readable (checked before the data query).
  tablePage(table: ViewerTable, limit: number, offset: number): Promise<TablePage>;
  diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot>;
}

const moduleRow = z.object({ module_id: z.string(), is_enabled: z.boolean(), active_versions: z.number().int() });
const privilegeRow = z.object({ table_key: z.string(), readable: z.boolean() });
const countRow = z.object({ n: z.number().int() });
const identityRow = z.object({ database_name: z.string(), role_name: z.string(), server_version: z.string() });
const versionRow = z.object({ version_id: z.string(), module_version: z.string(), manifest_json: z.unknown(), manifest_hash: z.string().nullable() });
const functionRow = z.object({ function_key: z.string() });
const actionRow = z.object({ function_key: z.string(), action_key: z.string() });
const contractRow = z.object({ resource_key: z.string(), interface_kind: z.string(), fields: z.number().int() });
const compatibilityRow = z.object({ check_result: z.string(), blocking: z.number().int() });
const cell = z.string().nullable();

function toModuleState(row: unknown): ModuleState {
  const m = moduleRow.parse(row);
  return { moduleId: m.module_id, isEnabled: m.is_enabled, activeVersions: m.active_versions };
}

export class SqlSystemTestRepository implements SystemTestRepository {
  private readonly host: Pick<ModuleHost, 'readOnly'>;

  constructor(host: Pick<ModuleHost, 'readOnly'>) {
    this.host = host;
  }

  private readOnly<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
    return this.host.readOnly(fn);
  }

  async readableTables(tables: readonly ViewerTable[]): Promise<ReadonlyMap<string, boolean>> {
    return this.readOnly((tx) => privileges(tx, tables));
  }

  async tablePage(table: ViewerTable, limit: number, offset: number): Promise<TablePage> {
    return this.readOnly(async (tx) => {
      if ((await privileges(tx, [table])).get(table.tableKey) !== true) throw new TableNotReadableError();
      const [count] = await tx.query(countSql(table), []);
      const rows = (await tx.query(rowsSql(table), [limit, offset])).map((row) => {
        const record = z.record(z.string(), cell).parse(row);
        return table.columns.map((c) => record[c] ?? null);
      });
      return { totalRows: countRow.parse(count).n, rows };
    });
  }

  async diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot> {
    return this.readOnly(async (tx) => {
      const [identity] = await tx.query(SYSTEM_TEST_SQL.identity, []);
      const id = identityRow.parse(identity);
      const [moduleRaw] = await tx.query(SYSTEM_TEST_SQL.moduleState, [moduleKey]);
      const module = moduleRaw === undefined ? null : toModuleState(moduleRaw);
      const activeVersions = module === null ? [] : (await tx.query(SYSTEM_TEST_SQL.activeVersions, [module.moduleId])).map((row) => {
        const v = versionRow.parse(row);
        return { versionId: v.version_id, moduleVersion: v.module_version, manifestJson: v.manifest_json, manifestHash: v.manifest_hash };
      });
      const [only] = activeVersions;
      const versionId = activeVersions.length === 1 && only ? only.versionId : null;
      const functions = versionId === null ? [] : (await tx.query(SYSTEM_TEST_SQL.versionFunctions, [versionId])).map((r) => functionRow.parse(r).function_key);
      const actions = versionId === null ? [] : (await tx.query(SYSTEM_TEST_SQL.versionActions, [versionId])).map((r) => {
        const a = actionRow.parse(r);
        return `${a.function_key}.${a.action_key}`;
      });
      const contracts = versionId === null ? [] : (await tx.query(SYSTEM_TEST_SQL.dataContracts, [versionId])).map((r) => {
        const c = contractRow.parse(r);
        return { resourceKey: c.resource_key, interfaceKind: c.interface_kind, fields: c.fields };
      });
      const [compat] = versionId === null ? [] : await tx.query(SYSTEM_TEST_SQL.latestCompatibility, [versionId]);
      const compatibility = compat === undefined ? null : (() => {
        const c = compatibilityRow.parse(compat);
        return { checkResult: c.check_result, blocking: c.blocking };
      })();
      return {
        identity: { databaseName: id.database_name, roleName: id.role_name, serverVersion: id.server_version },
        module, activeVersions, functions, actions, contracts, compatibility,
      };
    });
  }
}

async function privileges(tx: SqlExecutor, tables: readonly ViewerTable[]): Promise<Map<string, boolean>> {
  const keys: string[] = [];
  const relations: string[] = [];
  const columns: string[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      keys.push(t.tableKey);
      relations.push(`${t.schema}.${t.table}`);
      columns.push(c);
    }
  }
  const out = new Map<string, boolean>();
  for (const row of await tx.query(SYSTEM_TEST_SQL.columnPrivileges, [keys, relations, columns])) {
    const p = privilegeRow.parse(row);
    out.set(p.table_key, p.readable);
  }
  return out;
}
