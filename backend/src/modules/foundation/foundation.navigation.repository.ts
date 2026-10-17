import { z } from 'zod';
import type { ActiveFunctionRow, ActiveVersionSource, NavigationItem } from './foundation.navigation.js';
import type { AccessFacts, GrantFacts } from './foundation.permissions.js';
import { FOUNDATION_SQL } from './foundation.repository.js';
import type { AuditRecord, FoundationDb, SqlExecutor } from './foundation.repository.js';
import { VERSION_SQL } from './foundation.versions.repository.js';

// FBE-06 — Navigation (B09 foundation.fnd_navigation_items), owner decisions N1–N9. Bind parameters only.
//   CREATE: module exists → Function of that module (B03) → parent exists and is a global group or of the same module →
//           INSERT B09 → INSERT B08 SUCCESS; one transaction. parent_id / module_id / function_id are set only here.
//   PATCH : UPDATE of menu_title / sort_order / is_visible only (NULL bind = unchanged) → B08 SUCCESS; one transaction.
//   No DELETE; no B07 (no approved Navigation event type). The composite FK (function_id, module_id) and D-08 / N-02
//   remain the database guards.
//   Menu sources: B09, the ACTIVE version of every ENABLED module (B01 + B02) and its B05 / B06 declarations.
//   IAM facts by K05 triple (module_code, resource_code, operation): every definition with that triple is returned, so
//   that evaluateAccess() refuses a missing (0) or ambiguous (> 1) definition; grants are read only for exactly one.

const ITEM_COLUMNS = `
           n.navigation_id::text AS navigation_id, n.parent_id::text AS parent_id, n.module_id::text AS module_id,
           n.function_id::text AS function_id, n.menu_title, n.sort_order, n.is_visible,
           to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`;

export const NAVIGATION_SQL = {
  functionOfModule: `
    SELECT f.function_id::text AS function_id FROM foundation.fnd_functions AS f WHERE f.function_id = $1::uuid AND f.module_id = $2::uuid`,
  getItem: `
    SELECT ${ITEM_COLUMNS} FROM foundation.fnd_navigation_items AS n WHERE n.navigation_id = $1::uuid`,
  // sort_order / is_visible fall back to the DDL defaults (0 / true) when not given.
  insertItem: `
    INSERT INTO foundation.fnd_navigation_items AS n (parent_id, module_id, function_id, menu_title, sort_order, is_visible)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, coalesce($5::int, 0), coalesce($6::boolean, true))
    RETURNING ${ITEM_COLUMNS}`,
  updateItem: `
    UPDATE foundation.fnd_navigation_items AS n
       SET menu_title = coalesce($2::varchar, n.menu_title), sort_order = coalesce($3::int, n.sort_order), is_visible = coalesce($4::boolean, n.is_visible)
     WHERE n.navigation_id = $1::uuid
    RETURNING ${ITEM_COLUMNS}`,
  listItems: `
    SELECT ${ITEM_COLUMNS} FROM foundation.fnd_navigation_items AS n`,
  activeVersions: `
    SELECT m.module_id::text AS module_id, m.module_key, v.version_id::text AS version_id, v.manifest_json, v.manifest_hash
      FROM foundation.fnd_modules AS m
      JOIN foundation.fnd_module_versions AS v ON v.module_id = m.module_id AND v.status = 'ACTIVE'
     WHERE m.is_enabled`,
  activeFunctions: `
    SELECT v.version_id::text AS version_id, f.function_id::text AS function_id, f.function_key, a.action_key
      FROM foundation.fnd_modules AS m
      JOIN foundation.fnd_module_versions AS v ON v.module_id = m.module_id AND v.status = 'ACTIVE'
      JOIN foundation.fnd_version_functions AS vf ON vf.version_id = v.version_id
      JOIN foundation.fnd_functions AS f ON f.function_id = vf.function_id AND f.module_id = m.module_id
      LEFT JOIN foundation.fnd_version_actions AS va ON va.version_function_id = vf.version_function_id
      LEFT JOIN foundation.fnd_actions AS a ON a.action_id = va.action_id AND a.function_id = f.function_id
     WHERE m.is_enabled`,
  permissionsByTriple: `
    SELECT p.permission_id::text AS permission_id, p.minimum_assurance_level::int AS minimum_assurance_level
      FROM iam.iam_permissions AS p
     WHERE p.module_code = $1 AND p.resource_code = $2 AND p.operation = $3`,
} as const;

export interface CreateItemInput {
  readonly parentId: string | null;
  readonly moduleId: string | null;
  readonly functionId: string | null;
  readonly menuTitle: string;
  readonly sortOrder: number | null;
  readonly isVisible: boolean | null;
}

export interface UpdateItemInput {
  readonly navigationId: string;
  readonly menuTitle: string | null;
  readonly sortOrder: number | null;
  readonly isVisible: boolean | null;
}

export interface MenuSources {
  readonly items: readonly NavigationItem[];
  readonly versions: readonly ActiveVersionSource[];
  readonly functions: readonly ActiveFunctionRow[];
}

export class NavigationNotFoundError extends Error {
  constructor() {
    super('navigation item not found');
    this.name = 'NavigationNotFoundError';
  }
}

// Reference that does not exist or does not belong together (module / function / parent).
export class NavigationReferenceError extends Error {
  readonly field: 'moduleId' | 'functionId' | 'parentId';

  constructor(field: 'moduleId' | 'functionId' | 'parentId') {
    super(`navigation reference invalid: ${field}`);
    this.name = 'NavigationReferenceError';
    this.field = field;
  }
}

export interface NavigationRepository {
  createItem(input: CreateItemInput, audit: (item: NavigationItem) => AuditRecord): Promise<NavigationItem>;
  updateItem(input: UpdateItemInput, audit: (item: NavigationItem) => AuditRecord): Promise<NavigationItem>;
  menuSources(): Promise<MenuSources>;
  accessFactsByTriple(userAccountId: string, moduleCode: string, resourceCode: string, operation: string): Promise<AccessFacts>;
}

const itemRow = z.object({
  navigation_id: z.string(), parent_id: z.string().nullable(), module_id: z.string().nullable(), function_id: z.string().nullable(),
  menu_title: z.string(), sort_order: z.number().int(), is_visible: z.boolean(), created_at: z.string(),
});
const versionRow = z.object({ module_id: z.string(), module_key: z.string(), version_id: z.string(), manifest_json: z.unknown(), manifest_hash: z.string().nullable() });
const functionRow = z.object({ version_id: z.string(), function_id: z.string(), function_key: z.string(), action_key: z.string().nullable() });
const idRow = z.object({ module_id: z.string() });
const functionIdRow = z.object({ function_id: z.string() });
const permissionRow = z.object({ permission_id: z.string(), minimum_assurance_level: z.number().int() });
const accountRow = z.object({ account_status: z.string(), not_disabled: z.boolean() });
const grantRow = z.object({
  source: z.enum(['ROLE', 'DIRECT']), effect: z.string(), role_active: z.boolean(), not_revoked: z.boolean(), started: z.boolean(), not_expired: z.boolean(),
});

export function toItem(row: unknown): NavigationItem {
  const r = itemRow.parse(row);
  return {
    navigationId: r.navigation_id, parentId: r.parent_id, moduleId: r.module_id, functionId: r.function_id, menuTitle: r.menu_title,
    sortOrder: r.sort_order, isVisible: r.is_visible, createdAt: r.created_at,
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

function single(rows: unknown[], what: string): NavigationItem {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) throw new Error(`navigation: expected exactly one ${what}, got ${rows.length}`);
  return toItem(row);
}

async function checkReferences(tx: SqlExecutor, input: CreateItemInput): Promise<void> {
  if (input.functionId !== null && input.moduleId === null) throw new NavigationReferenceError('moduleId'); // N-02
  if (input.moduleId !== null && (await tx.query(VERSION_SQL.moduleExists, [input.moduleId])).map((r) => idRow.parse(r)).length !== 1) {
    throw new NavigationReferenceError('moduleId');
  }
  if (input.functionId !== null && (await tx.query(NAVIGATION_SQL.functionOfModule, [input.functionId, input.moduleId])).map((r) => functionIdRow.parse(r)).length !== 1) {
    throw new NavigationReferenceError('functionId'); // missing, or a Function of another module
  }
  if (input.parentId !== null) {
    const [raw] = await tx.query(NAVIGATION_SQL.getItem, [input.parentId]);
    if (raw === undefined) throw new NavigationReferenceError('parentId');
    const parent = toItem(raw);
    // N2: the parent is a Foundation-wide group (no module) or belongs to the same module.
    if (parent.moduleId !== null && parent.moduleId !== input.moduleId) throw new NavigationReferenceError('parentId');
  }
}

export class SqlNavigationRepository implements NavigationRepository {
  private readonly db: FoundationDb;

  constructor(db: FoundationDb) {
    this.db = db;
  }

  async createItem(input: CreateItemInput, audit: (item: NavigationItem) => AuditRecord): Promise<NavigationItem> {
    return this.db.transaction(async (tx) => {
      await checkReferences(tx, input);
      const item = single(await tx.query(NAVIGATION_SQL.insertItem, [
        input.parentId, input.moduleId, input.functionId, input.menuTitle, input.sortOrder, input.isVisible,
      ]), 'inserted navigation item');
      await tx.execute(FOUNDATION_SQL.insertAudit, auditParams(audit(item)));
      return item;
    });
  }

  async updateItem(input: UpdateItemInput, audit: (item: NavigationItem) => AuditRecord): Promise<NavigationItem> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query(NAVIGATION_SQL.updateItem, [input.navigationId, input.menuTitle, input.sortOrder, input.isVisible]);
      if (rows.length === 0) throw new NavigationNotFoundError();
      const item = single(rows, 'updated navigation item');
      await tx.execute(FOUNDATION_SQL.insertAudit, auditParams(audit(item)));
      return item;
    });
  }

  async menuSources(): Promise<MenuSources> {
    return this.db.transaction(async (tx) => {
      const items = (await tx.query(NAVIGATION_SQL.listItems, [])).map(toItem);
      const versions = (await tx.query(NAVIGATION_SQL.activeVersions, [])).map((r) => {
        const v = versionRow.parse(r);
        return { moduleId: v.module_id, moduleKey: v.module_key, versionId: v.version_id, manifestJson: v.manifest_json ?? null, manifestHash: v.manifest_hash };
      });
      const functions = (await tx.query(NAVIGATION_SQL.activeFunctions, [])).map((r) => {
        const f = functionRow.parse(r);
        return { versionId: f.version_id, functionId: f.function_id, functionKey: f.function_key, actionKey: f.action_key };
      });
      return { items, versions, functions };
    });
  }

  async accessFactsByTriple(userAccountId: string, moduleCode: string, resourceCode: string, operation: string): Promise<AccessFacts> {
    const permissions = (await this.db.query(NAVIGATION_SQL.permissionsByTriple, [moduleCode, resourceCode, operation])).map((r) => {
      const p = permissionRow.parse(r);
      return { permissionId: p.permission_id, minimumAssuranceLevel: p.minimum_assurance_level };
    });
    const [accountRaw] = await this.db.query(FOUNDATION_SQL.accountFacts, [userAccountId]);
    const account = accountRaw === undefined ? null : accountRow.parse(accountRaw);
    const [only] = permissions;
    const grants = permissions.length === 1 && only ? (await this.db.query(FOUNDATION_SQL.grantFacts, [userAccountId, only.permissionId])).map(toGrant) : [];
    return { permissions, account: account ? { accountStatus: account.account_status, notDisabled: account.not_disabled } : null, grants };
  }
}
