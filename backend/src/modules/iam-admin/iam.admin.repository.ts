import { z } from 'zod';
import { sqlstateOf } from '../auth/sqlstate.js';
import type { FoundationDb, SqlExecutor } from '../foundation/foundation.repository.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { PermissionRef } from '../foundation/foundation.permissions.js';
import { evaluateAccess } from '../foundation/foundation.permissions.js';
import { canonicalDigest } from '../foundation/foundation.json.js';
import { SqlFoundationRepository } from '../foundation/foundation.repository.js';

// IAM Management (PR #1, TALO-IAM-NEXT-2026-10-19). Additive module: reads / writes the IAM v0.3 tables through the API
// role, decides access only with the shared evaluateAccess() over the shared permission facts (no bypass, no second
// evaluator), writes IAM audit in the same transaction as each mutation, and fails closed (403 / 503) when a permission,
// a lookup, an audit write or a database privilege is missing. Foundation tables are only READ here (B01–B06, B09).

export const IAM_ADMIN_PERMISSIONS = {
  accounts: { permissionCode: 'iam.accounts.read', moduleCode: 'IAM', resourceCode: 'ACCOUNTS', operation: 'READ' },
  roles: { permissionCode: 'iam.roles.manage', moduleCode: 'IAM', resourceCode: 'ROLES', operation: 'MANAGE' },
  permissions: { permissionCode: 'iam.permissions.manage', moduleCode: 'IAM', resourceCode: 'PERMISSIONS', operation: 'MANAGE' },
  assignments: { permissionCode: 'iam.assignments.manage', moduleCode: 'IAM', resourceCode: 'ASSIGNMENTS', operation: 'MANAGE' },
  navigation: { permissionCode: 'foundation.navigation.manage', moduleCode: 'FOUNDATION', resourceCode: 'NAVIGATION', operation: 'MANAGE' },
} as const satisfies Record<string, PermissionRef>;

// Fixed texts: never SQL, driver messages, usernames or request values.
export const IAM_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ.',
  NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
  DUPLICATE: 'Dữ liệu đã tồn tại hoặc đang có hiệu lực (trùng lặp).',
  ALREADY_REVOKED: 'Bản ghi đã được thu hồi trước đó.',
  SYSTEM_ROLE_LOCKED: 'Vai trò hệ thống không được sửa hoặc gán quyền qua giao diện.',
  ROLE_INACTIVE: 'Vai trò đang không hoạt động.',
  EXPIRY_INVALID: 'Thời điểm hết hạn phải ở tương lai.',
  BINDING_INVALID: 'Permission phải khớp đúng một ánh xạ MIC-07 (K05) của phiên bản ACTIVE, toàn vẹn mã băm.',
  PERMISSION_TRIPLE_EXISTS: 'Bộ ba Module / Resource / Operation (K05) đã có permission.',
  IAM_DB_PRIVILEGE_MISSING: 'Vai trò cơ sở dữ liệu của hệ thống chưa được cấp quyền cho thao tác IAM này (chờ phê duyệt). Không có thay đổi nào được lưu.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
};

export class IamError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail = '') { super(code); }
}

// Expected database outcomes become controlled errors; anything else stays an unexpected error (500 by the app).
export function iamDbError(error: unknown): IamError | null {
  switch (sqlstateOf(error)) {
    case '23505': return new IamError(409, 'DUPLICATE');
    case '23503': return new IamError(404, 'NOT_FOUND');
    case '23514': case '22007': case '22008': return new IamError(422, 'VALIDATION_ERROR');
    case '42501': return new IamError(503, 'IAM_DB_PRIVILEGE_MISSING');
    case '40P01': case '40001': case '57014': return new IamError(503, 'SERVICE_BUSY');
    default: return null;
  }
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
const one = (data: unknown[], missing = 'NOT_FOUND', status = 404): Record<string, unknown> => {
  const [first, ...rest] = rows(data);
  if (first === undefined || rest.length > 0) throw new IamError(status, missing);
  return first;
};
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const ACCOUNT_COLUMNS = `a.user_account_id::text AS "accountId", a.username, a.account_status AS "accountStatus", (a.disabled_at IS NOT NULL) AS "disabled",
  m.employee_code AS "employeeCode", m.full_name AS "fullName", m.membership_status AS "membershipStatus"`;
const ACCOUNT_FILTER = `($1 = '' OR a.username ILIKE $2 ESCAPE '\\' OR m.employee_code ILIKE $2 ESCAPE '\\' OR m.full_name ILIKE $2 ESCAPE '\\')`;

export class IamAdminRepository {
  private readonly access: SqlFoundationRepository;
  constructor(private readonly db: FoundationDb) { this.access = new SqlFoundationRepository(db); }

  // Allowed when ANY of the permissions is effective (catalog reads shared by several admin screens); otherwise one IAM
  // audit DENIED row and 403. A lookup or audit failure is a 503 (never an allow).
  async authorize(actor: Actor, ...permissions: PermissionRef[]): Promise<void> {
    const reasons: string[] = [];
    try {
      for (const permission of permissions) {
        const result = evaluateAccess(await this.access.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel);
        if (result.allowed) return;
        reasons.push(result.reason);
      }
    } catch {
      throw new IamError(503, 'SERVICE_BUSY');
    }
    try {
      // IAM audit, not Foundation B08.
      await this.db.execute(
        'INSERT INTO iam.iam_audit_logs (actor_account_id,action_code,target_type,outcome,metadata) VALUES ($1::uuid,$2,$3,$4,$5::jsonb)',
        [actor.userAccountId, 'IAM.ACCESS', 'USER_ACCOUNT', 'DENIED', JSON.stringify({
          v: 1, requestId: actor.requestId, permissionCode: permissions.map((p) => p.permissionCode).join(','), reason: reasons.join(','),
        })],
      );
    } catch {
      throw new IamError(503, 'SERVICE_BUSY');
    }
    throw new IamError(403, 'FORBIDDEN');
  }

  private async read<R>(work: () => Promise<R>): Promise<R> {
    try {
      return await work();
    } catch (error) {
      throw error instanceof IamError ? error : iamDbError(error) ?? error;
    }
  }

  async accounts(search: string, page: number, pageSize: number) {
    return this.read(async () => {
      const total = one(await this.db.query(
        `SELECT count(*)::int AS total FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id WHERE ${ACCOUNT_FILTER}`,
        [search, likePattern(search)]));
      const accounts = rows(await this.db.query(
        `SELECT ${ACCOUNT_COLUMNS} FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id
          WHERE ${ACCOUNT_FILTER} ORDER BY a.username COLLATE "C", a.user_account_id LIMIT $3 OFFSET $4`,
        [search, likePattern(search), pageSize, (page - 1) * pageSize]));
      return { accounts, total: total.total, page, pageSize };
    });
  }

  async account(accountId: string) {
    return this.read(async () => one(await this.db.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM iam.iam_user_accounts a JOIN iam.iam_memberships m ON m.membership_id=a.membership_id WHERE a.user_account_id=$1::uuid`, [accountId])));
  }

  async roles() {
    return this.read(async () => rows(await this.db.query(
      `SELECT r.role_id::text AS "roleId",r.role_code AS "roleCode",r.role_name AS "roleName",r.role_description AS "description",r.is_active AS "isActive",r.is_system AS "isSystem",
              (SELECT count(*)::int FROM iam.iam_role_permissions rp WHERE rp.role_id=r.role_id) AS "permissionCount",
              (SELECT count(*)::int FROM iam.iam_user_roles ur WHERE ur.role_id=r.role_id AND ur.revoked_at IS NULL) AS "activeAssignments"
         FROM iam.iam_roles r ORDER BY r.role_code COLLATE "C"`, [])));
  }
  async permissions() {
    return this.read(async () => rows(await this.db.query('SELECT permission_id::text AS "permissionId",permission_code AS "permissionCode",module_code AS "moduleCode",resource_code AS "resourceCode",operation,minimum_assurance_level::int AS "minimumAssuranceLevel",permission_description AS "description" FROM iam.iam_permissions ORDER BY module_code,resource_code,operation,permission_code', [])));
  }
  async rolePermissions(roleId: string) {
    return this.read(async () => rows(await this.db.query('SELECT p.permission_id::text AS "permissionId",p.permission_code AS "permissionCode",p.module_code AS "moduleCode",p.resource_code AS "resourceCode",p.operation,rp.created_at AS "assignedAt" FROM iam.iam_role_permissions rp JOIN iam.iam_permissions p ON p.permission_id=rp.permission_id WHERE rp.role_id=$1::uuid ORDER BY p.permission_code', [roleId])));
  }
  async accountRoles(accountId: string) {
    return this.read(async () => rows(await this.db.query('SELECT ur.user_role_id::text AS "userRoleId",ur.role_id::text AS "roleId",r.role_code AS "roleCode",r.role_name AS "roleName",r.is_active AS "roleActive",ur.revoked_at AS "revokedAt",ur.assigned_at AS "assignedAt" FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON ur.role_id=r.role_id WHERE ur.user_account_id=$1::uuid ORDER BY ur.assigned_at DESC, ur.user_role_id', [accountId])));
  }
  async accountPermissions(accountId: string) {
    return this.read(async () => rows(await this.db.query('SELECT up.user_permission_id::text AS "userPermissionId",up.permission_id::text AS "permissionId",p.permission_code AS "permissionCode",up.effect,up.reason,up.assigned_at AS "assignedAt",up.expires_at AS "expiresAt",up.revoked_at AS "revokedAt",(up.expires_at IS NOT NULL AND up.expires_at <= statement_timestamp()) AS "expired" FROM iam.iam_user_permissions up JOIN iam.iam_permissions p ON p.permission_id=up.permission_id WHERE up.user_account_id=$1::uuid ORDER BY up.assigned_at DESC, up.user_permission_id', [accountId])));
  }

  // Effective permissions of ANOTHER account. Its session assurance is unknown here (never the viewer's): every grant is
  // evaluated by evaluateAccess() under the stated assumption that the target's session reaches the permission's
  // minimum assurance; the minimum is returned so the UI shows the assumption.
  async effective(accountId: string) {
    const permissions = await this.permissions();
    return this.read(async () => {
      const result: { permissionId: unknown; permissionCode: unknown; allowed: boolean; reason: string; assumedAssuranceLevel: unknown }[] = [];
      for (const p of permissions) {
        const ref: PermissionRef = { permissionCode: String(p.permissionCode), moduleCode: String(p.moduleCode), resourceCode: String(p.resourceCode), operation: String(p.operation) };
        const minimum = typeof p.minimumAssuranceLevel === 'number' ? p.minimumAssuranceLevel : 1;
        const decision = evaluateAccess(await this.access.loadAccessFacts(accountId, ref), minimum);
        result.push({ permissionId: p.permissionId, permissionCode: p.permissionCode, allowed: decision.allowed, reason: decision.allowed ? 'ALLOW' : decision.reason, assumedAssuranceLevel: minimum });
      }
      return result;
    });
  }

  // Navigation adapter (read only): every B09 item with the names of its module / function / parent.
  async navigationItems() {
    return this.read(async () => rows(await this.db.query(
      `SELECT n.navigation_id::text AS "navigationId",n.parent_id::text AS "parentId",p.menu_title AS "parentTitle",n.module_id::text AS "moduleId",m.module_key AS "moduleKey",
              n.function_id::text AS "functionId",f.function_key AS "functionKey",n.menu_title AS "menuTitle",n.sort_order AS "sortOrder",n.is_visible AS "isVisible"
         FROM foundation.fnd_navigation_items n
         LEFT JOIN foundation.fnd_navigation_items p ON p.navigation_id=n.parent_id
         LEFT JOIN foundation.fnd_modules m ON m.module_id=n.module_id
         LEFT JOIN foundation.fnd_functions f ON f.function_id=n.function_id
        ORDER BY n.sort_order,n.menu_title,n.navigation_id`, [])));
  }
  // Modules with exactly one ACTIVE version (the only ones whose Functions can be offered by the menu).
  async activeModules() {
    return this.read(async () => rows(await this.db.query(
      `SELECT m.module_id::text AS "moduleId",m.module_key AS "moduleKey",m.module_name AS "moduleName",m.is_enabled AS "isEnabled",v.module_version AS "activeVersion"
         FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status='ACTIVE'
        ORDER BY m.module_key COLLATE "C"`, [])));
  }
  async functions(moduleId: string) {
    return this.read(async () => rows(await this.db.query(
      'SELECT DISTINCT f.function_id::text AS "functionId",f.function_key AS "functionKey",vf.display_name AS "displayName",m.module_key AS "moduleCode",v.module_version AS "moduleVersion",m.is_enabled AS "isEnabled", a.action_key AS "actionKey" FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status=\'ACTIVE\' JOIN foundation.fnd_version_functions vf ON vf.version_id=v.version_id JOIN foundation.fnd_functions f ON f.function_id=vf.function_id AND f.module_id=m.module_id LEFT JOIN foundation.fnd_version_actions va ON va.version_function_id=vf.version_function_id LEFT JOIN foundation.fnd_actions a ON a.action_id=va.action_id WHERE m.module_id=$1::uuid ORDER BY f.function_key,a.action_key',
      [moduleId])));
  }

  private async audit(tx: SqlExecutor, actor: Actor, action: string, targetType: string, targetId: string | null, details: Record<string, string>) {
    await tx.execute('INSERT INTO iam.iam_audit_logs(actor_account_id,action_code,target_type,target_id,outcome,metadata) VALUES ($1::uuid,$2,$3,$4::uuid,\'SUCCESS\',$5::jsonb)',
      [actor.userAccountId, action, targetType, targetId, JSON.stringify({ v: 1, requestId: actor.requestId, ...details })]);
  }
  // Mutation + SUCCESS audit in ONE transaction: any failure (business check, constraint, privilege, audit) rolls back both.
  private async mutation(actor: Actor, action: string, targetType: string, details: Record<string, string>, task: (tx: SqlExecutor) => Promise<Record<string, unknown>>) {
    try {
      return await this.db.transaction(async tx => {
        const row = await task(tx);
        await this.audit(tx, actor, action, targetType, typeof row.id === 'string' ? row.id : null, details);
        return row;
      });
    } catch (error) {
      throw error instanceof IamError ? error : iamDbError(error) ?? error;
    }
  }

  // Role row inside the transaction (locked), with the business checks shared by the role mutations.
  private async lockedRole(tx: SqlExecutor, roleId: string, editable: boolean) {
    const role = one(await tx.query('SELECT role_id::text AS id,is_system AS "isSystem",is_active AS "isActive" FROM iam.iam_roles WHERE role_id=$1::uuid FOR UPDATE', [roleId]));
    if (editable && role.isSystem === true) throw new IamError(422, 'SYSTEM_ROLE_LOCKED');
    return role;
  }

  // is_active / is_system come from the column defaults (true / false): the API role never needs to write is_system.
  async createRole(actor: Actor, data: { roleCode: string; roleName: string; description?: string }) {
    return this.mutation(actor, 'IAM.ROLE.CREATE', 'ROLE', { roleCode: data.roleCode }, async tx =>
      one(await tx.query('INSERT INTO iam.iam_roles(role_code,role_name,role_description) VALUES ($1,$2,$3) RETURNING role_id::text AS id,role_code AS "roleCode",role_name AS "roleName",role_description AS description,is_active AS "isActive",is_system AS "isSystem"', [data.roleCode, data.roleName, data.description ?? null])));
  }
  async updateRole(actor: Actor, roleId: string, data: { roleName?: string | undefined; description?: string | null | undefined; isActive?: boolean | undefined }) {
    return this.mutation(actor, 'IAM.ROLE.UPDATE', 'ROLE', { fields: Object.keys(data).join(',') }, async tx => {
      await this.lockedRole(tx, roleId, true);
      return one(await tx.query(
        'UPDATE iam.iam_roles SET role_name=coalesce($2,role_name),role_description=CASE WHEN $3::boolean THEN $4 ELSE role_description END,is_active=coalesce($5,is_active) WHERE role_id=$1::uuid AND NOT is_system RETURNING role_id::text AS id,role_code AS "roleCode",role_name AS "roleName",role_description AS description,is_active AS "isActive",is_system AS "isSystem"',
        [roleId, data.roleName ?? null, data.description !== undefined, data.description ?? null, data.isActive ?? null]));
    });
  }
  async assignRolePermission(actor: Actor, roleId: string, permissionId: string) {
    return this.mutation(actor, 'IAM.ROLE.PERMISSION.ASSIGN', 'ROLE', { permissionId }, async tx => {
      await this.lockedRole(tx, roleId, true);
      one(await tx.query('SELECT 1 AS ok FROM iam.iam_permissions WHERE permission_id=$1::uuid', [permissionId]));
      // A duplicate (role, permission) is the primary key → 23505 → 409 (never a silent no-op).
      return one(await tx.query('INSERT INTO iam.iam_role_permissions(role_id,permission_id) VALUES ($1::uuid,$2::uuid) RETURNING role_id::text AS id,permission_id::text AS "permissionId"', [roleId, permissionId]));
    });
  }
  async revokeRolePermission(actor: Actor, roleId: string, permissionId: string) {
    return this.mutation(actor, 'IAM.ROLE.PERMISSION.REMOVE', 'ROLE', { permissionId }, async tx => {
      await this.lockedRole(tx, roleId, true);
      return one(await tx.query('DELETE FROM iam.iam_role_permissions rp WHERE rp.role_id=$1::uuid AND rp.permission_id=$2::uuid RETURNING role_id::text AS id,permission_id::text AS "permissionId"', [roleId, permissionId]));
    });
  }
  async assignUserRole(actor: Actor, accountId: string, roleId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.ROLE.ASSIGN', 'USER_ACCOUNT', { accountId, roleId }, async tx => {
      const role = await this.lockedRole(tx, roleId, false);
      if (role.isActive !== true) throw new IamError(422, 'ROLE_INACTIVE');
      // An active duplicate hits uq_iam_user_active_role → 23505 → 409, also between concurrent requests.
      return one(await tx.query('INSERT INTO iam.iam_user_roles(user_account_id,role_id,assigned_by_id) VALUES($1::uuid,$2::uuid,$3::uuid) RETURNING user_role_id::text AS id,role_id::text AS "roleId"', [accountId, roleId, actor.userAccountId]));
    });
  }
  async revokeUserRole(actor: Actor, accountId: string, assignmentId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.ROLE.REVOKE', 'USER_ACCOUNT', { accountId, userRoleId: assignmentId }, async tx => {
      const current = one(await tx.query('SELECT (revoked_at IS NOT NULL) AS revoked FROM iam.iam_user_roles WHERE user_role_id=$1::uuid AND user_account_id=$2::uuid FOR UPDATE', [assignmentId, accountId]));
      if (current.revoked === true) throw new IamError(409, 'ALREADY_REVOKED');
      return one(await tx.query('UPDATE iam.iam_user_roles SET revoked_at=statement_timestamp() WHERE user_role_id=$1::uuid AND user_account_id=$2::uuid AND revoked_at IS NULL RETURNING user_role_id::text AS id,role_id::text AS "roleId"', [assignmentId, accountId]));
    });
  }
  async assignDirect(actor: Actor, accountId: string, data: { permissionId: string; effect: 'ALLOW' | 'DENY'; reason: string; expiresAt?: string | null | undefined }) {
    if (data.expiresAt && !(Date.parse(data.expiresAt) > Date.now())) throw new IamError(422, 'EXPIRY_INVALID');
    return this.mutation(actor, 'IAM.ACCOUNT.PERMISSION.ASSIGN', 'USER_ACCOUNT', { accountId, permissionId: data.permissionId, effect: data.effect }, async tx =>
      // An active duplicate hits uq_iam_user_active_direct_permission → 23505 → 409.
      one(await tx.query('INSERT INTO iam.iam_user_permissions(user_account_id,permission_id,effect,reason,assigned_by_id,expires_at) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::timestamptz) RETURNING user_permission_id::text AS id,permission_id::text AS "permissionId",effect', [accountId, data.permissionId, data.effect, data.reason, actor.userAccountId, data.expiresAt ?? null])));
  }
  async revokeDirect(actor: Actor, accountId: string, assignmentId: string) {
    return this.mutation(actor, 'IAM.ACCOUNT.PERMISSION.REVOKE', 'USER_ACCOUNT', { accountId, userPermissionId: assignmentId }, async tx => {
      const current = one(await tx.query('SELECT (revoked_at IS NOT NULL) AS revoked FROM iam.iam_user_permissions WHERE user_permission_id=$1::uuid AND user_account_id=$2::uuid FOR UPDATE', [assignmentId, accountId]));
      if (current.revoked === true) throw new IamError(409, 'ALREADY_REVOKED');
      return one(await tx.query('UPDATE iam.iam_user_permissions SET revoked_at=statement_timestamp() WHERE user_permission_id=$1::uuid AND user_account_id=$2::uuid AND revoked_at IS NULL RETURNING user_permission_id::text AS id,permission_id::text AS "permissionId"', [assignmentId, accountId]));
    });
  }

  async createPermission(actor: Actor, data: { permissionCode: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number; description?: string | undefined }) {
    // Catalog writes must match exactly one K05/MIC-07 mapping of an ACTIVE, hash-intact MIC.
    // Core platform admin definitions are deliberately provisioned by an approved one-time bootstrap, never this route.
    if (data.moduleCode === 'IAM' || data.moduleCode === 'FOUNDATION') throw new IamError(422, 'BINDING_INVALID');
    return this.mutation(actor, 'IAM.PERMISSION.CREATE', 'PERMISSION', { permissionCode: data.permissionCode, triple: `${data.moduleCode}/${data.resourceCode}/${data.operation}` }, async tx => {
      // Serialises concurrent creations of the same K05 triple (no DB unique on the triple; schema unchanged).
      // execute (not query): the function returns void, which a row reader cannot decode.
      await tx.execute('SELECT pg_advisory_xact_lock(hashtext($1))', [`iam.permission.triple:${data.moduleCode}/${data.resourceCode}/${data.operation}`]);
      const versions = rows(await tx.query(
        'SELECT v.manifest_json AS manifest, v.manifest_hash AS hash FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id AND v.status=\'ACTIVE\' WHERE m.module_key=$1',
        [data.moduleCode]));
      const [version, ...more] = versions;
      if (version === undefined || more.length > 0) throw new IamError(422, 'BINDING_INVALID');
      let intact = false;
      try {
        intact = version.manifest !== null && typeof version.hash === 'string' && canonicalDigest(version.manifest).sha256 === version.hash;
      } catch {
        intact = false;
      }
      if (!intact) throw new IamError(422, 'BINDING_INVALID');
      const manifest = z.object({mic07IamMapping: z.array(z.object({moduleCode:z.string(), resourceCode:z.string(),operation:z.string(),minimumAssuranceLevel:z.number().int(),functionKey:z.string(),actionKey:z.string()}))}).safeParse(version.manifest);
      if (!manifest.success) throw new IamError(422, 'BINDING_INVALID');
      const matches = manifest.data.mic07IamMapping.filter(m => m.moduleCode === data.moduleCode && m.resourceCode === data.resourceCode && m.operation === data.operation && m.minimumAssuranceLevel === data.minimumAssuranceLevel && m.functionKey === data.resourceCode && m.actionKey === data.operation);
      if (matches.length !== 1) throw new IamError(422, 'BINDING_INVALID');
      // A duplicate K05 triple would make Foundation navigation fail closed (PERMISSION_AMBIGUOUS).
      const existing = rows(await tx.query('SELECT permission_id FROM iam.iam_permissions WHERE module_code=$1 AND resource_code=$2 AND operation=$3', [data.moduleCode, data.resourceCode, data.operation]));
      if (existing.length > 0) throw new IamError(409, 'PERMISSION_TRIPLE_EXISTS');
      return one(await tx.query('INSERT INTO iam.iam_permissions(permission_code,module_code,resource_code,operation,minimum_assurance_level,permission_description) VALUES($1,$2,$3,$4,$5,$6) RETURNING permission_id::text AS id,permission_code AS "permissionCode"', [data.permissionCode, data.moduleCode, data.resourceCode, data.operation, data.minimumAssuranceLevel, data.description ?? null]));
    });
  }
}
