import { z } from 'zod';
import type { FoundationDb, SqlExecutor } from '../foundation/foundation.repository.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { PermissionRef } from '../foundation/foundation.permissions.js';
import { evaluateAccess } from '../foundation/foundation.permissions.js';
import { canonicalDigest } from '../foundation/foundation.json.js';
import { SqlFoundationRepository } from '../foundation/foundation.repository.js';

export const IAM_ADMIN_PERMISSIONS = {
  accounts: { permissionCode: 'iam.accounts.read', moduleCode: 'IAM', resourceCode: 'ACCOUNTS', operation: 'READ' },
  roles: { permissionCode: 'iam.roles.manage', moduleCode: 'IAM', resourceCode: 'ROLES', operation: 'MANAGE' },
  permissions: { permissionCode: 'iam.permissions.manage', moduleCode: 'IAM', resourceCode: 'PERMISSIONS', operation: 'MANAGE' },
  assignments: { permissionCode: 'iam.assignments.manage', moduleCode: 'IAM', resourceCode: 'ASSIGNMENTS', operation: 'MANAGE' },
  navigation: { permissionCode: 'foundation.navigation.manage', moduleCode: 'FOUNDATION', resourceCode: 'NAVIGATION', operation: 'MANAGE' },
} as const satisfies Record<string, PermissionRef>;

export class IamError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail = '') { super(code); }
}

const UUID = z.uuid();
const ID = (value: unknown): string => {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) throw new IamError(400, 'VALIDATION_ERROR', 'UUID');
  return parsed.data;
};
export const iamId = ID;
export const iamBody = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IamError(400, 'VALIDATION_ERROR', 'BODY');
  return parsed.data;
};
const rows = (data: unknown[]): Record<string, unknown>[] => data.map((r) => z.record(z.string(), z.unknown()).parse(r));
const one = (data: unknown[]): Record<string, unknown> => {
  const result = rows(data);
  if (result.length !== 1 || !result[0]) throw new IamError(404, 'NOT_FOUND');
  return result[0];
};

export class IamAdminRepository {
  private readonly access: SqlFoundationRepository;
  constructor(private readonly db: FoundationDb) { this.access = new SqlFoundationRepository(db); }

  async authorize(actor: Actor, permission: PermissionRef): Promise<void> {
    const facts = await this.access.loadAccessFacts(actor.userAccountId, permission);
    const result = evaluateAccess(facts, actor.assuranceLevel);
    if (result.allowed) return;
    // IAM audit, not Foundation B08. Fail closed if the audit cannot be written.
    await this.db.execute(
      'INSERT INTO iam.iam_audit_logs (actor_account_id,action_code,target_type,outcome,metadata) VALUES ($1::uuid,$2,$3,$4,$5::jsonb)',
      [actor.userAccountId, 'IAM.ACCESS', 'USER_ACCOUNT', 'DENIED', JSON.stringify({ v: 1, requestId: actor.requestId, permissionCode: permission.permissionCode, reason: result.reason })],
    );
    throw new IamError(403, 'FORBIDDEN');
  }

  async accounts(search: string, page: number, pageSize: number) {
    const total = one(await this.db.query(
      'SELECT count(*)::int AS total FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id WHERE ($1 = \'\' OR a.username ILIKE $2 OR m.employee_code ILIKE $2 OR m.full_name ILIKE $2)',
      [search, '%' + search + '%']));
    const accounts = rows(await this.db.query(
      'SELECT a.user_account_id::text AS "accountId", a.username, a.account_status AS "accountStatus", (a.disabled_at IS NOT NULL) AS "disabled", m.employee_code AS "employeeCode", m.full_name AS "fullName", m.membership_status AS "membershipStatus" FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id WHERE ($1 = \'\' OR a.username ILIKE $2 OR m.employee_code ILIKE $2 OR m.full_name ILIKE $2) ORDER BY a.username COLLATE "C" LIMIT $3 OFFSET $4',
      [search, '%' + search + '%', pageSize, (page - 1) * pageSize]));
    return { accounts, total: total.total, page, pageSize };
  }

  async account(accountId: string) {
    return one(await this.db.query(
      'SELECT a.user_account_id::text AS "accountId", a.username, a.account_status AS "accountStatus", (a.disabled_at IS NOT NULL) AS "disabled", m.employee_code AS "employeeCode", m.full_name AS "fullName", m.membership_status AS "membershipStatus" FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id WHERE a.user_account_id=$1::uuid', [accountId]));
  }

  async roles() {
    return rows(await this.db.query('SELECT role_id::text AS "roleId",role_code AS "roleCode",role_name AS "roleName",role_description AS "description",is_active AS "isActive",is_system AS "isSystem" FROM iam.iam_roles ORDER BY role_code COLLATE "C"', []));
  }
  async permissions() {
    return rows(await this.db.query('SELECT permission_id::text AS "permissionId",permission_code AS "permissionCode",module_code AS "moduleCode",resource_code AS "resourceCode",operation,minimum_assurance_level::int AS "minimumAssuranceLevel",permission_description AS "description" FROM iam.iam_permissions ORDER BY module_code,resource_code,operation,permission_code', []));
  }
  async rolePermissions(roleId: string) {
    return rows(await this.db.query('SELECT p.permission_id::text AS "permissionId",p.permission_code AS "permissionCode",p.module_code AS "moduleCode",p.resource_code AS "resourceCode",p.operation FROM iam.iam_role_permissions rp JOIN iam.iam_permissions p ON p.permission_id=rp.permission_id WHERE rp.role_id=$1::uuid ORDER BY p.permission_code', [roleId]));
  }
  async accountRoles(accountId: string) {
    return rows(await this.db.query('SELECT ur.user_role_id::text AS "userRoleId",ur.role_id::text AS "roleId",r.role_code AS "roleCode",r.role_name AS "roleName",r.is_active AS "roleActive",ur.revoked_at AS "revokedAt",ur.assigned_at AS "assignedAt" FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON ur.role_id=r.role_id WHERE ur.user_account_id=$1::uuid ORDER BY ur.assigned_at DESC', [accountId]));
  }
  async accountPermissions(accountId: string) {
    return rows(await this.db.query('SELECT up.user_permission_id::text AS "userPermissionId",up.permission_id::text AS "permissionId",p.permission_code AS "permissionCode",up.effect,up.reason,up.assigned_at AS "assignedAt",up.expires_at AS "expiresAt",up.revoked_at AS "revokedAt" FROM iam.iam_user_permissions up JOIN iam.iam_permissions p ON p.permission_id=up.permission_id WHERE up.user_account_id=$1::uuid ORDER BY up.assigned_at DESC', [accountId]));
  }
  async effective(accountId: string, assurance: number) {
    const permissions = await this.permissions();
    const result: { permissionId: unknown; permissionCode: unknown; allowed: boolean; reason: string }[] = [];
    for (const p of permissions) {
      const ref: PermissionRef = { permissionCode: String(p.permissionCode), moduleCode: String(p.moduleCode), resourceCode: String(p.resourceCode), operation: String(p.operation) };
      const decision = evaluateAccess(await this.access.loadAccessFacts(accountId, ref), assurance);
      result.push({ permissionId: p.permissionId, permissionCode: p.permissionCode, allowed: decision.allowed, reason: decision.allowed ? 'ALLOW' : decision.reason });
    }
    return result;
  }

  async navigationItems() {
    return rows(await this.db.query('SELECT n.navigation_id::text AS "navigationId",n.parent_id::text AS "parentId",n.module_id::text AS "moduleId",n.function_id::text AS "functionId",n.menu_title AS "menuTitle",n.sort_order AS "sortOrder",n.is_visible AS "isVisible" FROM foundation.fnd_navigation_items n ORDER BY n.sort_order,n.menu_title', []));
  }
  async functions(moduleId: string) {
    return rows(await this.db.query(
      'SELECT DISTINCT f.function_id::text AS "functionId",f.function_key AS "functionKey",vf.display_name AS "displayName",m.module_key AS "moduleCode",v.module_version AS "moduleVersion",m.is_enabled AS "isEnabled", a.action_key AS "actionKey" FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status=\'ACTIVE\' JOIN foundation.fnd_version_functions vf ON vf.version_id=v.version_id JOIN foundation.fnd_functions f ON f.function_id=vf.function_id AND f.module_id=m.module_id LEFT JOIN foundation.fnd_version_actions va ON va.version_function_id=vf.version_function_id LEFT JOIN foundation.fnd_actions a ON a.action_id=va.action_id WHERE m.module_id=$1::uuid ORDER BY f.function_key,a.action_key',
      [moduleId]));
  }

  private async audit(tx: SqlExecutor, actor: Actor, action: string, targetType: string, targetId: string | null) {
    await tx.execute('INSERT INTO iam.iam_audit_logs(actor_account_id,action_code,target_type,target_id,outcome,metadata) VALUES ($1::uuid,$2,$3,$4::uuid,\'SUCCESS\',$5::jsonb)',
      [actor.userAccountId, action, targetType, targetId, JSON.stringify({ v: 1, requestId: actor.requestId })]);
  }
  private async mutation(actor: Actor, action: string, targetType: string, task: (tx: SqlExecutor) => Promise<Record<string, unknown>>) {
    return this.db.transaction(async tx => {
      const row = await task(tx);
      await this.audit(tx, actor, action, targetType, typeof row.id === 'string' ? row.id : null);
      return row;
    });
  }

  async createRole(actor: Actor, data: { roleCode: string; roleName: string; description?: string }) {
    return this.mutation(actor, 'IAM.ROLE.CREATE', 'ROLE', async tx => {
      const r = one(await tx.query('INSERT INTO iam.iam_roles(role_code,role_name,role_description,is_active,is_system) VALUES ($1,$2,$3,true,false) RETURNING role_id::text AS id,role_code AS "roleCode",role_name AS "roleName",is_active AS "isActive",is_system AS "isSystem"', [data.roleCode, data.roleName, data.description ?? null]));
      return r;
    });
  }
  async updateRole(actor: Actor, roleId: string, data: { roleName?: string; description?: string | null; isActive?: boolean }) {
    return this.mutation(actor, 'IAM.ROLE.UPDATE', 'ROLE', async tx => {
      const r = one(await tx.query(
        'UPDATE iam.iam_roles SET role_name=coalesce($2,role_name),role_description=CASE WHEN $3::boolean THEN $4 ELSE role_description END,is_active=coalesce($5,is_active) WHERE role_id=$1::uuid AND NOT is_system RETURNING role_id::text AS id,role_code AS "roleCode",role_name AS "roleName",role_description AS description,is_active AS "isActive",is_system AS "isSystem"',
        [roleId, data.roleName ?? null, data.description !== undefined, data.description ?? null, data.isActive ?? null]));
      return r;
    });
  }
  async assignRolePermission(actor: Actor, roleId: string, permissionId: string) {
    return this.mutation(actor, 'IAM.ROLE.PERMISSION.ASSIGN', 'ROLE', async tx => {
      const r = one(await tx.query(
        'INSERT INTO iam.iam_role_permissions(role_id,permission_id) SELECT r.role_id,p.permission_id FROM iam.iam_roles r CROSS JOIN iam.iam_permissions p WHERE r.role_id=$1::uuid AND p.permission_id=$2::uuid AND NOT r.is_system ON CONFLICT DO NOTHING RETURNING role_id::text AS id,permission_id::text AS "permissionId"',
        [roleId, permissionId]));
      return r;
    });
  }
  async revokeRolePermission(actor: Actor, roleId: string, permissionId: string) {
    return this.mutation(actor, 'IAM.ROLE.PERMISSION.REMOVE', 'ROLE', async tx => {
      const r = one(await tx.query('DELETE FROM iam.iam_role_permissions rp WHERE rp.role_id=$1::uuid AND rp.permission_id=$2::uuid AND EXISTS(SELECT 1 FROM iam.iam_roles r WHERE r.role_id=rp.role_id AND NOT r.is_system) RETURNING role_id::text AS id,permission_id::text AS "permissionId"', [roleId, permissionId]));
      return r;
    });
  }
  async assignUserRole(actor: Actor, accountId: string, roleId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.ROLE.ASSIGN', 'USER_ACCOUNT', async tx =>
      one(await tx.query('INSERT INTO iam.iam_user_roles(user_account_id,role_id,assigned_by_id) VALUES($1::uuid,$2::uuid,$3::uuid) RETURNING user_role_id::text AS id,role_id::text AS "roleId"', [accountId,roleId,actor.userAccountId])));
  }
  async revokeUserRole(actor: Actor, accountId: string, assignmentId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.ROLE.REVOKE', 'USER_ACCOUNT', async tx =>
      one(await tx.query('UPDATE iam.iam_user_roles SET revoked_at=statement_timestamp() WHERE user_role_id=$1::uuid AND user_account_id=$2::uuid AND revoked_at IS NULL RETURNING user_role_id::text AS id,role_id::text AS "roleId"', [assignmentId,accountId])));
  }
  async assignDirect(actor: Actor, accountId: string, data: { permissionId: string; effect: 'ALLOW' | 'DENY'; reason: string; expiresAt?: string | null }) {
    return this.mutation(actor, 'IAM.ACCOUNT.PERMISSION.ASSIGN', 'USER_ACCOUNT', async tx =>
      one(await tx.query('INSERT INTO iam.iam_user_permissions(user_account_id,permission_id,effect,reason,assigned_by_id,expires_at) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::timestamptz) RETURNING user_permission_id::text AS id,permission_id::text AS "permissionId",effect', [accountId,data.permissionId,data.effect,data.reason,actor.userAccountId,data.expiresAt ?? null])));
  }
  async revokeDirect(actor: Actor, accountId: string, assignmentId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.PERMISSION.REVOKE', 'USER_ACCOUNT', async tx =>
      one(await tx.query('UPDATE iam.iam_user_permissions SET revoked_at=statement_timestamp() WHERE user_permission_id=$1::uuid AND user_account_id=$2::uuid AND revoked_at IS NULL RETURNING user_permission_id::text AS id,permission_id::text AS "permissionId"', [assignmentId,accountId])));
  }

  async createPermission(actor: Actor, data: { permissionCode: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number; description?: string }) {
    // Catalog writes must match exactly one K05/MIC-07 mapping of an ACTIVE, hash-intact MIC.
    // Core platform admin definitions are deliberately provisioned by an approved one-time bootstrap, never this route.
    if (data.moduleCode === 'IAM' || data.moduleCode === 'FOUNDATION') throw new IamError(422, 'BINDING_INVALID');
    const versions = rows(await this.db.query(
      'SELECT v.manifest_json AS manifest, v.manifest_hash AS hash FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status=\'ACTIVE\' WHERE m.module_key=$1',
      [data.moduleCode]));
    if (versions.length !== 1) throw new IamError(422, 'BINDING_INVALID');
    const version = versions[0]!;
    if (!version.manifest || typeof version.hash !== 'string' || canonicalDigest(version.manifest).sha256 !== version.hash) throw new IamError(422, 'BINDING_INVALID');
    const manifest = z.object({mic07IamMapping: z.array(z.object({moduleCode:z.string(), resourceCode:z.string(),operation:z.string(),minimumAssuranceLevel:z.number().int(),functionKey:z.string(),actionKey:z.string()}))}).safeParse(version.manifest);
    if (!manifest.success) throw new IamError(422, 'BINDING_INVALID');
    const matches = manifest.data.mic07IamMapping.filter(m => m.moduleCode === data.moduleCode && m.resourceCode === data.resourceCode && m.operation === data.operation && m.minimumAssuranceLevel === data.minimumAssuranceLevel && m.functionKey === data.resourceCode && m.actionKey === data.operation);
    if (matches.length !== 1) throw new IamError(422, 'BINDING_INVALID');
    return this.mutation(actor, 'IAM.PERMISSION.CREATE', 'PERMISSION', async tx =>
      one(await tx.query('INSERT INTO iam.iam_permissions(permission_code,module_code,resource_code,operation,minimum_assurance_level,permission_description) VALUES($1,$2,$3,$4,$5,$6) RETURNING permission_id::text AS id,permission_code AS "permissionCode"', [data.permissionCode,data.moduleCode,data.resourceCode,data.operation,data.minimumAssuranceLevel,data.description ?? null])));
  }
}
