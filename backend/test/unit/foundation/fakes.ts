import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import type { ClientInfo } from '../../../src/modules/auth/audit.js';
import { AuthError } from '../../../src/modules/auth/auth.service.js';
import type { SessionBody } from '../../../src/modules/auth/auth.service.js';
import { COMPAT_SQL } from '../../../src/modules/foundation/foundation.compatibility.repository.js';
import { DATA_SQL } from '../../../src/modules/foundation/foundation.data.repository.js';
import { MANIFEST_SQL, SqlManifestRepository } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { moduleManifestRouter } from '../../../src/modules/foundation/foundation.manifest.routes.js';
import { ModuleManifestService } from '../../../src/modules/foundation/foundation.manifest.service.js';
import { LIFECYCLE_SQL, SqlLifecycleRepository } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import { moduleLifecycleRouter } from '../../../src/modules/foundation/foundation.lifecycle.routes.js';
import { NAVIGATION_SQL, SqlNavigationRepository } from '../../../src/modules/foundation/foundation.navigation.repository.js';
import { navigationRouter } from '../../../src/modules/foundation/foundation.navigation.routes.js';
import { NavigationService } from '../../../src/modules/foundation/foundation.navigation.service.js';
import { ModuleLifecycleService } from '../../../src/modules/foundation/foundation.lifecycle.service.js';
import { REGISTRY_SQL } from '../../../src/modules/foundation/foundation.registry.repository.js';
import { FOUNDATION_SQL, SqlFoundationRepository } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { foundationRouter } from '../../../src/modules/foundation/foundation.routes.js';
import { FoundationService } from '../../../src/modules/foundation/foundation.service.js';
import { SqlModuleVersionRepository, VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { moduleVersionRouter } from '../../../src/modules/foundation/foundation.versions.routes.js';
import { ModuleVersionService } from '../../../src/modules/foundation/foundation.versions.service.js';
import { healthRouter } from '../../../src/modules/health/health.routes.js';

// In-memory doubles for FBE-01A / FBE-02A (no PostgreSQL). FakeDb answers the exact FOUNDATION_SQL and VERSION_SQL
// statements and implements a transaction mock: writes inside transaction() go to a staged copy that becomes visible
// only on commit. B02 keeps the UNIQUE (module_id, module_version) and the FKs to B01 / (version_id, module_id) of B08.
// FBE-04: B10–B14 with the DDL Revision 02 FKs, UNIQUEs, CHECKs (A-04…A-11, N-06, N-09…N-13, D-09) and VARCHAR widths.

export const TEST_ORIGIN = 'http://127.0.0.1:5173';

export const PERM_READ_ID = '10000000-0000-4000-8000-000000000001';
export const PERM_CREATE_ID = '10000000-0000-4000-8000-000000000002';
export const PERM_VREAD_ID = '10000000-0000-4000-8000-000000000003';
export const PERM_VCREATE_ID = '10000000-0000-4000-8000-000000000004';
export const PERM_VUPDATE_ID = '10000000-0000-4000-8000-000000000005';
export const PERM_VSUBMIT_ID = '10000000-0000-4000-8000-000000000006';
// FBE-05 lifecycle permissions (L6).
export const PERM_APPROVE_ID = '10000000-0000-4000-8000-000000000007';
export const PERM_REJECT_ID = '10000000-0000-4000-8000-000000000008';
export const PERM_ACTIVATE_ID = '10000000-0000-4000-8000-000000000009';
export const PERM_RETIRE_ID = '10000000-0000-4000-8000-00000000000a';
export const PERM_ENABLE_ID = '10000000-0000-4000-8000-00000000000b';
export const PERM_DISABLE_ID = '10000000-0000-4000-8000-00000000000c';
// FBE-06 navigation management permission (N4).
export const PERM_NAV_ID = '10000000-0000-4000-8000-00000000000d';
export const ACCOUNT_A = '20000000-0000-4000-8000-00000000000a';

export function token(seed: string): string {
  return seed.padEnd(43, '0').slice(0, 43);
}

export interface PermissionFixture {
  permission_id: string; permission_code: string; module_code: string; resource_code: string; operation: string; minimum_assurance_level: number;
}

export interface GrantRow {
  source: 'ROLE' | 'DIRECT'; effect: string; role_active: boolean; not_revoked: boolean; started: boolean; not_expired: boolean;
}

export interface IamFixture {
  permissions: PermissionFixture[];
  accounts: Map<string, { account_status: string; not_disabled: boolean }>;
  grants: { accountId: string; permissionId: string; row: GrantRow }[];
}

export const VALID_ROLE: GrantRow = { source: 'ROLE', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true };
export const VALID_DIRECT_ALLOW: GrantRow = { source: 'DIRECT', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true };
export const VALID_DIRECT_DENY: GrantRow = { source: 'DIRECT', effect: 'DENY', role_active: true, not_revoked: true, started: true, not_expired: true };

export function defaultIam(): IamFixture {
  return {
    permissions: [
      { permission_id: PERM_READ_ID, permission_code: 'foundation.module_registry.read', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'READ', minimum_assurance_level: 1 },
      { permission_id: PERM_CREATE_ID, permission_code: 'foundation.module_registry.create', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'CREATE', minimum_assurance_level: 1 },
      { permission_id: PERM_VREAD_ID, permission_code: 'foundation.module_version.read', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'READ', minimum_assurance_level: 1 },
      { permission_id: PERM_VCREATE_ID, permission_code: 'foundation.module_version.create', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'CREATE', minimum_assurance_level: 1 },
      { permission_id: PERM_VUPDATE_ID, permission_code: 'foundation.module_version.update', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'UPDATE', minimum_assurance_level: 1 },
      { permission_id: PERM_VSUBMIT_ID, permission_code: 'foundation.module_version.submit', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'SUBMIT', minimum_assurance_level: 1 },
      { permission_id: PERM_APPROVE_ID, permission_code: 'foundation.module_version.approve', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'APPROVE', minimum_assurance_level: 1 },
      { permission_id: PERM_REJECT_ID, permission_code: 'foundation.module_version.reject', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'REJECT', minimum_assurance_level: 1 },
      { permission_id: PERM_ACTIVATE_ID, permission_code: 'foundation.module_version.activate', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'ACTIVATE', minimum_assurance_level: 1 },
      { permission_id: PERM_RETIRE_ID, permission_code: 'foundation.module_version.retire', module_code: 'FOUNDATION', resource_code: 'MODULE_VERSION', operation: 'RETIRE', minimum_assurance_level: 1 },
      { permission_id: PERM_ENABLE_ID, permission_code: 'foundation.module_registry.enable', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'ENABLE', minimum_assurance_level: 1 },
      { permission_id: PERM_DISABLE_ID, permission_code: 'foundation.module_registry.disable', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'DISABLE', minimum_assurance_level: 1 },
      { permission_id: PERM_NAV_ID, permission_code: 'foundation.navigation.manage', module_code: 'FOUNDATION', resource_code: 'NAVIGATION', operation: 'MANAGE', minimum_assurance_level: 1 },
    ],
    accounts: new Map([[ACCOUNT_A, { account_status: 'ACTIVE', not_disabled: true }]]),
    grants: [],
  };
}

export interface ModuleRow {
  module_id: string; module_key: string; module_name: string; description: string | null; module_type: string; is_enabled: boolean;
  created_at: string; updated_at: string; created_by_account_id: string | null;
}

export interface VersionRow {
  version_id: string; module_id: string; module_version: string; contract_version: string; status: string; manifest_json: unknown;
  manifest_hash: string | null; submitted_by_account_id: string | null; created_at: string; reviewed_by_account_id: string | null;
  reviewed_at: string | null; activated_at: string | null;
}

export interface FunctionRow {
  function_id: string; module_id: string; function_key: string; created_at: string; retired_at: string | null; replaces_function_id: string | null;
}
export interface ActionRow {
  action_id: string; function_id: string; action_key: string; created_at: string; retired_at: string | null;
}
export interface VersionFunctionRow {
  version_function_id: string; version_id: string; function_id: string; display_name: string; route_key: string | null;
  definition_hash: string | null; is_deprecated: boolean;
}
export interface VersionActionRow {
  version_action_id: string; version_function_id: string; action_id: string; description: string | null; action_spec: unknown;
  definition_hash: string | null; is_deprecated: boolean;
}

export interface DataContractRow {
  data_contract_id: string; version_id: string; resource_key: string; data_owner_key: string; interface_kind: string; schema_name: string | null;
  table_name: string | null; schema_version: string; contract_spec: unknown; contract_hash: string;
}
export interface DataFieldRow {
  field_id: string; data_contract_id: string; field_name: string; field_type: string; is_required: boolean; default_expression: string | null;
  is_primary_key: boolean; references_target: string | null; description: string | null;
}
export interface AccessRuleRow {
  access_rule_id: string; data_contract_id: string; version_action_id: string; data_operation: string; approval_mode: string; workflow_key: string | null;
  is_enabled: boolean;
}
export interface CompatCheckRow {
  check_id: string; module_id: string; from_version_id: string | null; to_version_id: string; environment: string; check_result: string;
  database_fingerprint: string | null; started_at: string; completed_at: string | null;
}
export interface CompatChangeRow {
  change_id: string; check_id: string; change_area: string; object_key: string; change_type: string; severity: string; previous_value: unknown;
  proposed_value: unknown; resolution_status: string; details: string | null;
}

export interface NavigationRow {
  navigation_id: string; parent_id: string | null; module_id: string | null; function_id: string | null; menu_title: string; sort_order: number;
  is_visible: boolean; created_at: string;
}

export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly inTransaction: boolean;
}

export interface State {
  modules: ModuleRow[];
  events: (readonly unknown[])[];
  audits: (readonly unknown[])[];
  versions: VersionRow[];
  versionAudits: (readonly unknown[])[];
  functions: FunctionRow[];
  actions: ActionRow[];
  versionFunctions: VersionFunctionRow[];
  versionActions: VersionActionRow[];
  dataContracts: DataContractRow[];
  dataFields: DataFieldRow[];
  accessRules: AccessRuleRow[];
  compatChecks: CompatCheckRow[];
  compatChanges: CompatChangeRow[];
  navigation: NavigationRow[];
}

const emptyState = (): State => ({
  modules: [], events: [], audits: [], versions: [], versionAudits: [], functions: [], actions: [], versionFunctions: [], versionActions: [],
  dataContracts: [], dataFields: [], accessRules: [], compatChecks: [], compatChanges: [], navigation: [],
});

export function pgError(code: string): Error {
  return Object.assign(new Error(`simulated SQLSTATE ${code}`), { code });
}

const text = (value: unknown): string => String(value);
const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const jsonb = (value: unknown): unknown => (value === null || value === undefined ? null : JSON.parse(text(value)));
const tooLong = (value: unknown, max: number) => value !== null && value !== undefined && text(value).length > max;
const blank = (value: unknown) => value === null || value === undefined || text(value).trim() === '';
// FBE-05: B02 CHECKs D-04 (MIC + hash after DRAFT), D-05 (review fields), D-06 (activation time).
function checkB02(v: VersionRow): void {
  const early = v.status === 'DRAFT' || v.status === 'IN_REVIEW';
  if (v.status !== 'DRAFT' && (v.manifest_json === null || v.manifest_hash === null)) throw pgError('23514');
  if (early !== (v.reviewed_at === null) || early !== (v.reviewed_by_account_id === null)) throw pgError('23514');
  if ((v.status === 'ACTIVE' || v.status === 'RETIRED') !== (v.activated_at !== null)) throw pgError('23514');
}
const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw pgError('22P02');
  return value;
};

export class FakeDb implements FoundationDb {
  readonly iam: IamFixture;
  state: State = emptyState();
  readonly statements: Statement[] = [];
  readonly txLog: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
  readonly failOn = new Map<string, Error>();
  // Runs just before a statement, on the state it will see (the staged copy inside a transaction): race simulation.
  readonly before = new Map<string, (state: State) => void>();
  private clock = 0;

  constructor(iam: IamFixture = defaultIam()) {
    this.iam = iam;
  }

  query(sql: string, params: readonly unknown[]): Promise<unknown[]> {
    return this.run(sql, params, this.state, false);
  }

  async execute(sql: string, params: readonly unknown[]): Promise<number> {
    return (await this.run(sql, params, this.state, false)).length;
  }

  async transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
    this.txLog.push('BEGIN');
    const staged: State = {
      modules: [...this.state.modules], events: [...this.state.events], audits: [...this.state.audits],
      versions: [...this.state.versions], versionAudits: [...this.state.versionAudits],
      functions: [...this.state.functions], actions: [...this.state.actions],
      versionFunctions: [...this.state.versionFunctions], versionActions: [...this.state.versionActions],
      dataContracts: [...this.state.dataContracts], dataFields: [...this.state.dataFields], accessRules: [...this.state.accessRules],
      compatChecks: [...this.state.compatChecks], compatChanges: [...this.state.compatChanges], navigation: [...this.state.navigation],
    };
    const tx: SqlExecutor = {
      query: (sql, params) => this.run(sql, params, staged, true),
      execute: async (sql, params) => (await this.run(sql, params, staged, true)).length,
    };
    try {
      const result = await fn(tx);
      this.state = staged;
      this.txLog.push('COMMIT');
      return result;
    } catch (error) {
      this.txLog.push('ROLLBACK');
      throw error;
    }
  }

  now(): string {
    return new Date(Date.UTC(2026, 9, 17, 12, 0, 0, this.clock++)).toISOString().replace('Z', '000Z');
  }

  // Conditional UPDATE of B02 rows (rows replaced, never mutated); D-04 / D-05 / D-06 and the Q01 partial UNIQUE index.
  private transition(state: State, match: (v: VersionRow) => boolean, change: (v: VersionRow) => VersionRow): unknown[] {
    const out: VersionRow[] = [];
    state.versions = state.versions.map((v) => {
      if (!match(v)) return v;
      const next = change(v);
      checkB02(next);
      out.push(next);
      return next;
    });
    const active = new Set<string>();
    for (const v of state.versions.filter((x) => x.status === 'ACTIVE')) {
      if (active.has(v.module_id)) throw pgError('23505');
      active.add(v.module_id);
    }
    return out.map((v) => ({ ...v }));
  }

  private async run(sql: string, params: readonly unknown[], state: State, inTransaction: boolean): Promise<unknown[]> {
    this.statements.push({ sql, params: [...params], inTransaction });
    const failure = this.failOn.get(sql);
    if (failure) throw failure;
    this.before.get(sql)?.(state);
    switch (sql) {
      case FOUNDATION_SQL.permissionDefinitions:
        return this.iam.permissions
          .filter((p) => p.permission_code === params[0] && p.module_code === params[1] && p.resource_code === params[2] && p.operation === params[3])
          .map((p) => ({ permission_id: p.permission_id, minimum_assurance_level: p.minimum_assurance_level }));
      case FOUNDATION_SQL.accountFacts: {
        const account = this.iam.accounts.get(text(params[0]));
        return account ? [{ ...account }] : [];
      }
      case FOUNDATION_SQL.grantFacts:
        return this.iam.grants.filter((g) => g.accountId === params[0] && g.permissionId === params[1]).map((g) => ({ ...g.row }));
      case FOUNDATION_SQL.listModules:
        return [...state.modules].sort((a, b) => (a.module_key < b.module_key ? -1 : a.module_key > b.module_key ? 1 : 0)).map((m) => ({ ...m }));
      case FOUNDATION_SQL.insertModule: {
        if (state.modules.some((m) => m.module_key === params[0])) throw pgError('23505');
        const at = new Date(Date.UTC(2026, 9, 16, 12, 0, 0, this.clock++)).toISOString().replace('Z', '000Z');
        const row: ModuleRow = {
          module_id: randomUUID(), module_key: text(params[0]), module_name: text(params[1]), description: nullableText(params[2]),
          module_type: text(params[3]), is_enabled: false, created_at: at, updated_at: at, created_by_account_id: nullableText(params[4]),
        };
        state.modules.push(row);
        return [{ ...row }];
      }
      case FOUNDATION_SQL.insertModuleEvent:
        state.events.push([...params]);
        return [];
      case FOUNDATION_SQL.insertAudit:
        state.audits.push([...params]);
        return [];
      case VERSION_SQL.moduleExists:
        return state.modules.filter((m) => m.module_id === params[0]).map((m) => ({ module_id: m.module_id }));
      case VERSION_SQL.listVersions:
        return state.versions.filter((v) => v.module_id === params[0]).map((v) => ({ ...v }));
      case VERSION_SQL.getVersion:
        return state.versions.filter((v) => v.version_id === params[0] && v.module_id === params[1]).map((v) => ({ ...v }));
      case VERSION_SQL.lockModuleVersions:
        return [{ pg_advisory_xact_lock: '' }];
      case VERSION_SQL.moduleVersionNumbers:
        return state.versions.filter((v) => v.module_id === params[0]).map((v) => ({ module_version: v.module_version }));
      case VERSION_SQL.insertVersion: {
        if (!state.modules.some((m) => m.module_id === params[0])) throw pgError('23503');
        if (state.versions.some((v) => v.module_id === params[0] && v.module_version === params[1])) throw pgError('23505');
        const row: VersionRow = {
          version_id: randomUUID(), module_id: text(params[0]), module_version: text(params[1]), contract_version: text(params[2]), status: 'DRAFT',
          manifest_json: null, manifest_hash: null, submitted_by_account_id: null,
          created_at: new Date(Date.UTC(2026, 9, 17, 8, 0, 0, this.clock++)).toISOString().replace('Z', '000Z'),
          reviewed_by_account_id: null, reviewed_at: null, activated_at: null,
        };
        state.versions.push(row);
        return [{ ...row }];
      }
      case VERSION_SQL.insertVersionAudit:
        // Composite FK (version_id, module_id) → B02 row of the same module.
        if (!state.versions.some((v) => v.version_id === params[2] && v.module_id === params[1])) throw pgError('23503');
        state.versionAudits.push([...params]);
        return [];
      case MANIFEST_SQL.lockVersion: {
        const v = state.versions.find((x) => x.version_id === params[0] && x.module_id === params[1]);
        const m = v ? state.modules.find((x) => x.module_id === v.module_id) : undefined;
        if (!v || !m) return [];
        return [{ status: v.status, manifest_json: v.manifest_json, module_version: v.module_version, contract_version: v.contract_version, module_key: m.module_key }];
      }
      case MANIFEST_SQL.otherVersions:
        return state.versions.filter((v) => v.module_id === params[0] && v.version_id !== params[1]).map((v) => ({ module_version: v.module_version, status: v.status }));
      case MANIFEST_SQL.updateManifest: {
        const i = state.versions.findIndex((v) => v.version_id === params[0] && v.module_id === params[1] && v.status === 'DRAFT');
        const current = state.versions[i];
        if (!current) return [];
        // JSONB round trip; SQL NULL stays NULL. Rows are replaced, never mutated (rollback safety).
        const next: VersionRow = { ...current, manifest_json: params[2] === null ? null : JSON.parse(text(params[2])), manifest_hash: null };
        state.versions[i] = next;
        return [{ ...next }];
      }
      case MANIFEST_SQL.submitVersion: {
        const i = state.versions.findIndex((v) => v.version_id === params[0] && v.module_id === params[1] && v.status === 'DRAFT');
        const current = state.versions[i];
        if (!current) return [];
        const hash = nullableText(params[2]);
        // D-04 (manifest + hash required outside DRAFT) and N-03 (hash format).
        if (current.manifest_json === null || hash === null || !/^[0-9a-f]{64}$/.test(hash)) throw pgError('23514');
        const next: VersionRow = { ...current, status: 'IN_REVIEW', manifest_hash: hash, submitted_by_account_id: nullableText(params[3]) };
        state.versions[i] = next;
        return [{ ...next }];
      }
      case MANIFEST_SQL.insertSubmitEvent:
        // FK module_id → B01 and composite FK (version_id, module_id) → B02.
        if (!state.versions.some((v) => v.version_id === params[1] && v.module_id === params[0])) throw pgError('23503');
        state.events.push(['SUBMIT', ...params]);
        return [];
      case REGISTRY_SQL.insertFunction: {
        // FK module_id → B01, D-02 key format; ON CONFLICT (module_id, function_key) DO NOTHING → 0 rows.
        if (!state.modules.some((m) => m.module_id === params[0])) throw pgError('23503');
        if (!/^[A-Z][A-Z0-9_]*$/.test(text(params[1])) || text(params[1]).length > 100) throw pgError('23514');
        // As PostgreSQL: a conflict is skipped only by ON CONFLICT … DO NOTHING; otherwise unique_violation.
        if (state.functions.some((x) => x.module_id === params[0] && x.function_key === params[1])) {
          if (sql.includes('ON CONFLICT (module_id, function_key) DO NOTHING')) return [];
          throw pgError('23505');
        }
        state.functions.push({
          function_id: randomUUID(), module_id: text(params[0]), function_key: text(params[1]), created_at: '2026-10-17T09:00:00.000000Z', retired_at: null, replaces_function_id: null,
        });
        return [{}];
      }
      case REGISTRY_SQL.selectFunction:
        return state.functions.filter((x) => x.module_id === params[0] && x.function_key === params[1]).map((x) => ({ function_id: x.function_id }));
      case REGISTRY_SQL.insertAction: {
        if (!state.functions.some((x) => x.function_id === params[0])) throw pgError('23503');
        if (!/^[A-Z][A-Z0-9_]*$/.test(text(params[1])) || text(params[1]).length > 30) throw pgError('23514');
        if (state.actions.some((x) => x.function_id === params[0] && x.action_key === params[1])) {
          if (sql.includes('ON CONFLICT (function_id, action_key) DO NOTHING')) return [];
          throw pgError('23505');
        }
        state.actions.push({ action_id: randomUUID(), function_id: text(params[0]), action_key: text(params[1]), created_at: '2026-10-17T09:00:00.000000Z', retired_at: null });
        return [{}];
      }
      case REGISTRY_SQL.selectAction:
        return state.actions.filter((x) => x.function_id === params[0] && x.action_key === params[1]).map((x) => ({ action_id: x.action_id }));
      case REGISTRY_SQL.insertVersionFunction: {
        // FKs → B02 / B03, UNIQUE (version_id, function_id), N-04, display_name VARCHAR(150).
        if (!state.versions.some((v) => v.version_id === params[0]) || !state.functions.some((x) => x.function_id === params[1])) throw pgError('23503');
        if (state.versionFunctions.some((x) => x.version_id === params[0] && x.function_id === params[1])) throw pgError('23505');
        if (!/^[0-9a-f]{64}$/.test(text(params[3]))) throw pgError('23514');
        if (text(params[2]).length > 150) throw pgError('22001');
        const row: VersionFunctionRow = {
          version_function_id: randomUUID(), version_id: text(params[0]), function_id: text(params[1]), display_name: text(params[2]), route_key: null,
          definition_hash: text(params[3]), is_deprecated: false,
        };
        state.versionFunctions.push(row);
        return [{ version_function_id: row.version_function_id }];
      }
      case REGISTRY_SQL.insertVersionAction: {
        // FKs → B05 / B04, UNIQUE (version_function_id, action_id), N-05; action_spec stored as JSONB (round trip).
        if (!state.versionFunctions.some((x) => x.version_function_id === params[0]) || !state.actions.some((x) => x.action_id === params[1])) throw pgError('23503');
        if (state.versionActions.some((x) => x.version_function_id === params[0] && x.action_id === params[1])) throw pgError('23505');
        if (!/^[0-9a-f]{64}$/.test(text(params[4]))) throw pgError('23514');
        state.versionActions.push({
          version_action_id: randomUUID(), version_function_id: text(params[0]), action_id: text(params[1]), description: nullableText(params[2]),
          action_spec: params[3] === null ? null : JSON.parse(text(params[3])), definition_hash: text(params[4]), is_deprecated: false,
        });
        return [];
      }
      case DATA_SQL.insertContract: {
        // FK version_id → B02, UNIQUE (version_id, resource_key), A-04, N-06, N-11, VARCHAR widths; contract_spec JSONB.
        if (!state.versions.some((v) => v.version_id === params[0])) throw pgError('23503');
        if (state.dataContracts.some((x) => x.version_id === params[0] && x.resource_key === params[1])) throw pgError('23505');
        if (!['API', 'VIEW', 'EVENT', 'DIRECT_DB'].includes(text(params[3])) || !/^[0-9a-f]{64}$/.test(text(params[8]))) throw pgError('23514');
        if (params[3] === 'DIRECT_DB' && (blank(params[4]) || blank(params[5]))) throw pgError('23514');
        if (tooLong(params[1], 120) || tooLong(params[2], 80) || tooLong(params[4], 100) || tooLong(params[5], 100) || tooLong(params[6], 40)) throw pgError('22001');
        const row: DataContractRow = {
          data_contract_id: randomUUID(), version_id: text(params[0]), resource_key: text(params[1]), data_owner_key: text(params[2]), interface_kind: text(params[3]),
          schema_name: nullableText(params[4]), table_name: nullableText(params[5]), schema_version: text(params[6]), contract_spec: jsonb(params[7]), contract_hash: text(params[8]),
        };
        state.dataContracts.push(row);
        return [{ data_contract_id: row.data_contract_id }];
      }
      case DATA_SQL.insertField: {
        // FK → B10, UNIQUE (data_contract_id, field_name), VARCHAR widths; N-14 is PENDING (not modelled).
        if (!state.dataContracts.some((x) => x.data_contract_id === params[0])) throw pgError('23503');
        if (state.dataFields.some((x) => x.data_contract_id === params[0] && x.field_name === params[1])) throw pgError('23505');
        if (tooLong(params[1], 100) || tooLong(params[2], 100) || tooLong(params[5], 250)) throw pgError('22001');
        state.dataFields.push({
          field_id: randomUUID(), data_contract_id: text(params[0]), field_name: text(params[1]), field_type: text(params[2]), is_required: bool(params[3]),
          default_expression: null, is_primary_key: bool(params[4]), references_target: nullableText(params[5]), description: nullableText(params[6]),
        });
        return [];
      }
      case DATA_SQL.versionActions:
        return state.versionActions.flatMap((va) => {
          const vf = state.versionFunctions.find((x) => x.version_function_id === va.version_function_id);
          const a = state.actions.find((x) => x.action_id === va.action_id);
          const f = a ? state.functions.find((x) => x.function_id === a.function_id) : undefined;
          return vf && a && f && vf.version_id === params[0] ? [{ function_key: f.function_key, action_key: a.action_key, version_action_id: va.version_action_id }] : [];
        });
      case DATA_SQL.insertAccessRule: {
        // FKs → B10 / B06, UNIQUE (contract, version_action, operation), A-05, A-06, D-09 (N-12 holds: is_enabled stays FALSE).
        if (!state.dataContracts.some((x) => x.data_contract_id === params[0]) || !state.versionActions.some((x) => x.version_action_id === params[1])) throw pgError('23503');
        if (state.accessRules.some((x) => x.data_contract_id === params[0] && x.version_action_id === params[1] && x.data_operation === params[2])) throw pgError('23505');
        if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(text(params[2])) || !['REQUIRED', 'NOT_REQUIRED', 'UNSPECIFIED'].includes(text(params[3]))) throw pgError('23514');
        if (params[3] === 'REQUIRED' && blank(params[4])) throw pgError('23514');
        if (tooLong(params[4], 120)) throw pgError('22001');
        state.accessRules.push({
          access_rule_id: randomUUID(), data_contract_id: text(params[0]), version_action_id: text(params[1]), data_operation: text(params[2]),
          approval_mode: text(params[3]), workflow_key: nullableText(params[4]), is_enabled: false,
        });
        return [];
      }
      case COMPAT_SQL.fromVersion:
        return state.versions.filter((v) => v.module_id === params[0] && v.module_version === params[1]).map((v) => ({ version_id: v.version_id, manifest_json: v.manifest_json }));
      case COMPAT_SQL.insertCheck: {
        // FKs → B01 and composite (version, module) → B02 for both versions, A-07, A-08, A-09; started_at = completed_at = now().
        if (!state.modules.some((m) => m.module_id === params[0])) throw pgError('23503');
        if (!state.versions.some((v) => v.version_id === params[2] && v.module_id === params[0])) throw pgError('23503');
        if (params[1] !== null && !state.versions.some((v) => v.version_id === params[1] && v.module_id === params[0])) throw pgError('23503');
        if (!['DEV', 'TEST', 'PROD'].includes(text(params[3])) || !['PASS', 'WARN', 'BLOCK', 'FAILED', 'PENDING'].includes(text(params[4]))) throw pgError('23514');
        if (params[1] !== null && params[1] === params[2]) throw pgError('23514');
        const at = '2026-10-17T10:00:00.000000Z';
        const row: CompatCheckRow = {
          check_id: randomUUID(), module_id: text(params[0]), from_version_id: nullableText(params[1]), to_version_id: text(params[2]), environment: text(params[3]),
          check_result: text(params[4]), database_fingerprint: null, started_at: at, completed_at: at,
        };
        state.compatChecks.push(row);
        return [{ check_id: row.check_id }];
      }
      case COMPAT_SQL.insertChange: {
        // FK → B13, N-10, A-10, A-11, object_key VARCHAR(250); resolution_status default OPEN.
        if (!state.compatChecks.some((x) => x.check_id === params[0])) throw pgError('23503');
        if (!['FUNCTION', 'ACTION', 'DATA', 'API', 'MODULE', 'UI', 'IAM', 'AUDIT', 'COMPATIBILITY', 'INTEGRITY'].includes(text(params[1]))) throw pgError('23514');
        if (!['ADDED', 'REMOVED', 'MODIFIED', 'MISSING'].includes(text(params[3])) || !['INFO', 'WARNING', 'BLOCKING'].includes(text(params[4]))) throw pgError('23514');
        if (tooLong(params[2], 250)) throw pgError('22001');
        state.compatChanges.push({
          change_id: randomUUID(), check_id: text(params[0]), change_area: text(params[1]), object_key: text(params[2]), change_type: text(params[3]),
          severity: text(params[4]), previous_value: jsonb(params[5]), proposed_value: jsonb(params[6]), resolution_status: 'OPEN', details: null,
        });
        return [];
      }
      case LIFECYCLE_SQL.getModule:
        return state.modules.filter((m) => m.module_id === params[0]).map((m) => ({ ...m }));
      case LIFECYCLE_SQL.approveVersion:
      case LIFECYCLE_SQL.rejectVersion:
        return this.transition(state, (v) => v.version_id === params[0] && v.module_id === params[1] && v.status === 'IN_REVIEW', (v) => ({
          ...v, status: sql === LIFECYCLE_SQL.approveVersion ? 'APPROVED' : 'REJECTED', reviewed_by_account_id: nullableText(params[2]), reviewed_at: this.now(),
        }));
      case LIFECYCLE_SQL.retireCurrentActive:
        return this.transition(state, (v) => v.module_id === params[0] && v.status === 'ACTIVE' && v.version_id !== params[1], (v) => ({ ...v, status: 'RETIRED' }));
      case LIFECYCLE_SQL.activateVersion:
        return this.transition(state, (v) => v.version_id === params[0] && v.module_id === params[1] && v.status === 'APPROVED', (v) => ({
          ...v, status: 'ACTIVE', activated_at: v.activated_at ?? this.now(),
        }));
      case LIFECYCLE_SQL.retireVersion:
        return this.transition(state, (v) => v.version_id === params[0] && v.module_id === params[1] && v.status === 'ACTIVE', (v) => ({ ...v, status: 'RETIRED' }));
      case LIFECYCLE_SQL.activeVersions:
        return state.versions.filter((v) => v.module_id === params[0] && v.status === 'ACTIVE').map((v) => ({ ...v }));
      case LIFECYCLE_SQL.latestChecks: {
        const mine = state.compatChecks.filter((k) => k.to_version_id === params[0] && k.module_id === params[1]);
        const latest = mine.reduce<string | null>((max, k) => (max === null || k.started_at > max ? k.started_at : max), null);
        return mine.filter((k) => k.started_at === latest).map((k) => ({ check_id: k.check_id, check_result: k.check_result }));
      }
      case LIFECYCLE_SQL.blockingChanges:
        return [{ n: state.compatChanges.filter((c) => c.check_id === params[0] && c.severity === 'BLOCKING').length }];
      case LIFECYCLE_SQL.directDbContracts:
        return [{ n: state.dataContracts.filter((d) => d.version_id === params[0] && d.interface_kind === 'DIRECT_DB').length }];
      case LIFECYCLE_SQL.enableModule:
      case LIFECYCLE_SQL.disableModule: {
        const enable = sql === LIFECYCLE_SQL.enableModule;
        const i = state.modules.findIndex((m) => m.module_id === params[0] && m.is_enabled !== enable);
        const current = state.modules[i];
        if (!current) return [];
        const next: ModuleRow = { ...current, is_enabled: enable, updated_at: this.now() };
        state.modules[i] = next;
        return [{ ...next }];
      }
      case LIFECYCLE_SQL.insertLifecycleEvent: {
        // FK module_id → B01, composite FK (version_id, module_id) → B02 when version_id is set; N-08 event types.
        if (!state.modules.some((m) => m.module_id === params[0])) throw pgError('23503');
        if (params[1] !== null && !state.versions.some((v) => v.version_id === params[1] && v.module_id === params[0])) throw pgError('23503');
        if (!['REGISTER', 'SUBMIT', 'APPROVE', 'REJECT', 'ENABLE', 'DISABLE', 'ACTIVATE', 'RETIRE', 'ROLLBACK'].includes(text(params[2]))) throw pgError('23514');
        state.events.push(['EVENT', ...params]);
        return [];
      }
      case NAVIGATION_SQL.functionOfModule:
        return state.functions.filter((f) => f.function_id === params[0] && f.module_id === params[1]).map((f) => ({ function_id: f.function_id }));
      case NAVIGATION_SQL.getItem:
        return state.navigation.filter((n) => n.navigation_id === params[0]).map((n) => ({ ...n }));
      case NAVIGATION_SQL.listItems:
        return state.navigation.map((n) => ({ ...n }));
      case NAVIGATION_SQL.insertItem: {
        // FKs parent / module / function, composite (function_id, module_id) → B03, N-02, VARCHAR(150).
        const [parentId, moduleId, functionId] = [nullableText(params[0]), nullableText(params[1]), nullableText(params[2])];
        if (parentId !== null && !state.navigation.some((n) => n.navigation_id === parentId)) throw pgError('23503');
        if (moduleId !== null && !state.modules.some((m) => m.module_id === moduleId)) throw pgError('23503');
        if (functionId !== null && moduleId === null) throw pgError('23514');
        if (functionId !== null && !state.functions.some((f) => f.function_id === functionId && f.module_id === moduleId)) throw pgError('23503');
        if (text(params[3]).length > 150) throw pgError('22001');
        const row: NavigationRow = {
          navigation_id: randomUUID(), parent_id: parentId, module_id: moduleId, function_id: functionId, menu_title: text(params[3]),
          sort_order: params[4] === null ? 0 : Number(params[4]), is_visible: params[5] === null ? true : bool(params[5]), created_at: this.now(),
        };
        state.navigation.push(row);
        return [{ ...row }];
      }
      case NAVIGATION_SQL.updateItem: {
        const i = state.navigation.findIndex((n) => n.navigation_id === params[0]);
        const current = state.navigation[i];
        if (!current) return [];
        if (params[1] !== null && text(params[1]).length > 150) throw pgError('22001');
        const next: NavigationRow = {
          ...current, menu_title: params[1] === null ? current.menu_title : text(params[1]), sort_order: params[2] === null ? current.sort_order : Number(params[2]),
          is_visible: params[3] === null ? current.is_visible : bool(params[3]),
        };
        state.navigation[i] = next;
        return [{ ...next }];
      }
      case NAVIGATION_SQL.activeVersions:
        return state.versions.filter((v) => v.status === 'ACTIVE' && state.modules.some((m) => m.module_id === v.module_id && m.is_enabled)).map((v) => ({
          module_id: v.module_id, module_key: state.modules.find((m) => m.module_id === v.module_id)?.module_key ?? '', version_id: v.version_id,
          manifest_json: v.manifest_json, manifest_hash: v.manifest_hash,
        }));
      case NAVIGATION_SQL.activeFunctions:
        return state.versions.filter((v) => v.status === 'ACTIVE' && state.modules.some((m) => m.module_id === v.module_id && m.is_enabled)).flatMap((v) =>
          state.versionFunctions.filter((vf) => vf.version_id === v.version_id).flatMap((vf) => {
            const f = state.functions.find((x) => x.function_id === vf.function_id && x.module_id === v.module_id);
            if (!f) return [];
            const actions = state.versionActions.filter((va) => va.version_function_id === vf.version_function_id)
              .map((va) => state.actions.find((a) => a.action_id === va.action_id && a.function_id === f.function_id)?.action_key ?? null);
            const keys = actions.length === 0 ? [null] : actions;
            return keys.map((k) => ({ version_id: v.version_id, function_id: f.function_id, function_key: f.function_key, action_key: k }));
          }));
      case NAVIGATION_SQL.permissionsByTriple:
        return this.iam.permissions.filter((p) => p.module_code === params[0] && p.resource_code === params[1] && p.operation === params[2])
          .map((p) => ({ permission_id: p.permission_id, minimum_assurance_level: p.minimum_assurance_level }));
      default:
        throw new Error('FakeDb: unexpected SQL');
    }
  }
}

export class FakeAuth {
  readonly sessions = new Map<string, SessionBody>();
  calls = 0;

  async describeSession(token: string | undefined, _client: ClientInfo): Promise<SessionBody> {
    this.calls += 1;
    const session = token === undefined ? undefined : this.sessions.get(token);
    if (!session) throw new AuthError(401, 'SESSION_INVALID', { clearCookie: true });
    return session;
  }

  authenticated(tokenValue: string, userAccountId: string): void {
    this.sessions.set(tokenValue, {
      status: 'AUTHENTICATED', account: { userAccountId, username: 'nv0001', fullName: 'Nguyễn Văn An' }, assuranceLevel: 1,
      expiresAt: '2026-10-16T20:00:00.000Z', idleExpiresAt: '2026-10-16T13:00:00.000Z', serverTime: '2026-10-16T12:00:00.000Z',
    });
  }

  activation(tokenValue: string): void {
    this.sessions.set(tokenValue, { status: 'PASSWORD_CHANGE_REQUIRED', account: { username: 'nv0002' }, expiresAt: '2026-10-16T12:15:00.000Z', serverTime: '2026-10-16T12:00:00.000Z' });
  }
}

export interface Harness {
  app: Express;
  db: FakeDb;
  auth: FakeAuth;
  logs: string[];
}

export function buildHarness(options: { iam?: IamFixture; extraRouters?: express.Router[] } = {}): Harness {
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN });
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const db = new FakeDb(options.iam);
  const auth = new FakeAuth();
  // The real SQL repository and service over the fake executor (no Prisma client involved).
  const service = new FoundationService({ repository: new SqlFoundationRepository(db), logger });
  const router = foundationRouter({ authService: auth, service, secureCookie: false });
  const versionService = new ModuleVersionService({ access: new SqlFoundationRepository(db), versions: new SqlModuleVersionRepository(db), logger });
  const versions = moduleVersionRouter({ authService: auth, service: versionService, secureCookie: false });
  const manifestService = new ModuleManifestService({ access: new SqlFoundationRepository(db), manifests: new SqlManifestRepository(db, 'TEST'), logger });
  const manifests = moduleManifestRouter({ authService: auth, service: manifestService, secureCookie: false });
  const lifecycleService = new ModuleLifecycleService({ access: new SqlFoundationRepository(db), lifecycle: new SqlLifecycleRepository(db), logger });
  const lifecycle = moduleLifecycleRouter({ authService: auth, service: lifecycleService, secureCookie: false });
  const navigationService = new NavigationService({ access: new SqlFoundationRepository(db), navigation: new SqlNavigationRepository(db), logger });
  const navigation = navigationRouter({ authService: auth, service: navigationService, secureCookie: false });
  const app = createApp({ config, logger, apiRouters: [healthRouter(), router, versions, manifests, lifecycle, navigation, ...(options.extraRouters ?? [])] });
  return { app, db, auth, logs };
}

export function seedModule(db: FakeDb, moduleKey: string): ModuleRow {
  const row: ModuleRow = {
    module_id: randomUUID(), module_key: moduleKey, module_name: moduleKey, description: null, module_type: 'INTERNAL', is_enabled: false,
    created_at: '2026-10-17T07:00:00.000000Z', updated_at: '2026-10-17T07:00:00.000000Z', created_by_account_id: ACCOUNT_A,
  };
  db.state.modules.push(row);
  return row;
}

export function seedVersion(db: FakeDb, moduleId: string, moduleVersion: string, status = 'DRAFT'): VersionRow {
  const reviewed = !['DRAFT', 'IN_REVIEW'].includes(status);
  const row: VersionRow = {
    version_id: randomUUID(), module_id: moduleId, module_version: moduleVersion, contract_version: 'MIC-1.0', status,
    manifest_json: status === 'DRAFT' ? null : { seeded: true }, manifest_hash: status === 'DRAFT' ? null : 'a'.repeat(64),
    submitted_by_account_id: null, created_at: '2026-10-17T07:30:00.000000Z', reviewed_by_account_id: reviewed ? ACCOUNT_A : null,
    reviewed_at: reviewed ? '2026-10-17T07:40:00.000000Z' : null, activated_at: ['ACTIVE', 'RETIRED'].includes(status) ? '2026-10-17T07:50:00.000000Z' : null,
  };
  db.state.versions.push(row);
  return row;
}
