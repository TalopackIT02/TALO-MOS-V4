import type { ApiResult } from '../foundation/foundationApi';

// Client of the IAM Management API (/api/iam/admin/*). Same rules as the Foundation client: same-origin cookie session,
// no token storage, no retry of a write, every answer parsed (no unchecked cast); the server decides every permission.

export type Account = { accountId: string; username: string; accountStatus: string; disabled: boolean; employeeCode: string; fullName: string; membershipStatus: string };
export type Role = { roleId: string; roleCode: string; roleName: string; description: string | null; isActive: boolean; isSystem: boolean; permissionCount: number; activeAssignments: number };
export type Permission = { permissionId: string; permissionCode: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number; description: string | null };
export type RolePermission = { permissionId: string; permissionCode: string; moduleCode: string; resourceCode: string; operation: string };
export type RoleAssignment = { userRoleId: string; roleId: string; roleCode: string; roleName: string; roleActive: boolean; assignedAt: string; revokedAt: string | null };
export type DirectGrant = { userPermissionId: string; permissionId: string; permissionCode: string; effect: string; reason: string | null; assignedAt: string; expiresAt: string | null; revokedAt: string | null; expired: boolean };
export type Effective = { permissionId: string; permissionCode: string; allowed: boolean; reason: string; assumedAssuranceLevel: number };
export type ActiveModule = { moduleId: string; moduleKey: string; moduleName: string; isEnabled: boolean; activeVersion: string };
export type ModuleFunction = { functionId: string; functionKey: string; displayName: string; actionKey: string | null };
export type MenuItem = {
  navigationId: string; parentId: string | null; parentTitle: string | null; moduleId: string | null; moduleKey: string | null;
  functionId: string | null; functionKey: string | null; menuTitle: string; sortOrder: number; isVisible: boolean;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (what: string): never => { throw new Error(what); };
const obj = (v: unknown): Json => (isObject(v) ? v : fail('object'));
const str = (o: Json, k: string): string => { const v = o[k]; return typeof v === 'string' ? v : fail(k); };
const optStr = (o: Json, k: string): string | null => { const v = o[k]; return typeof v === 'string' ? v : null; };
const num = (o: Json, k: string): number => { const v = o[k]; return typeof v === 'number' ? v : fail(k); };
const bool = (o: Json, k: string): boolean => { const v = o[k]; return typeof v === 'boolean' ? v : fail(k); };
const list = <T>(key: string, map: (o: Json) => T) => (payload: unknown): T[] => {
  const v = obj(payload)[key];
  return Array.isArray(v) ? v.map((x) => map(obj(x))) : fail(key);
};
const ok = () => (payload: unknown): true => { obj(payload); return true; };

const toAccount = (o: Json): Account => ({
  accountId: str(o, 'accountId'), username: str(o, 'username'), accountStatus: str(o, 'accountStatus'), disabled: bool(o, 'disabled'),
  employeeCode: str(o, 'employeeCode'), fullName: str(o, 'fullName'), membershipStatus: str(o, 'membershipStatus'),
});
const toRole = (o: Json): Role => ({
  roleId: str(o, 'roleId'), roleCode: str(o, 'roleCode'), roleName: str(o, 'roleName'), description: optStr(o, 'description'), isActive: bool(o, 'isActive'),
  isSystem: bool(o, 'isSystem'), permissionCount: num(o, 'permissionCount'), activeAssignments: num(o, 'activeAssignments'),
});
const toPermission = (o: Json): Permission => ({
  permissionId: str(o, 'permissionId'), permissionCode: str(o, 'permissionCode'), moduleCode: str(o, 'moduleCode'), resourceCode: str(o, 'resourceCode'),
  operation: str(o, 'operation'), minimumAssuranceLevel: num(o, 'minimumAssuranceLevel'), description: optStr(o, 'description'),
});
const toRolePermission = (o: Json): RolePermission => ({
  permissionId: str(o, 'permissionId'), permissionCode: str(o, 'permissionCode'), moduleCode: str(o, 'moduleCode'), resourceCode: str(o, 'resourceCode'), operation: str(o, 'operation'),
});
const toAssignment = (o: Json): RoleAssignment => ({
  userRoleId: str(o, 'userRoleId'), roleId: str(o, 'roleId'), roleCode: str(o, 'roleCode'), roleName: str(o, 'roleName'), roleActive: bool(o, 'roleActive'),
  assignedAt: str(o, 'assignedAt'), revokedAt: optStr(o, 'revokedAt'),
});
const toDirect = (o: Json): DirectGrant => ({
  userPermissionId: str(o, 'userPermissionId'), permissionId: str(o, 'permissionId'), permissionCode: str(o, 'permissionCode'), effect: str(o, 'effect'),
  reason: optStr(o, 'reason'), assignedAt: str(o, 'assignedAt'), expiresAt: optStr(o, 'expiresAt'), revokedAt: optStr(o, 'revokedAt'), expired: bool(o, 'expired'),
});
const toEffective = (o: Json): Effective => ({
  permissionId: str(o, 'permissionId'), permissionCode: str(o, 'permissionCode'), allowed: bool(o, 'allowed'), reason: str(o, 'reason'),
  assumedAssuranceLevel: num(o, 'assumedAssuranceLevel'),
});
const toModule = (o: Json): ActiveModule => ({
  moduleId: str(o, 'moduleId'), moduleKey: str(o, 'moduleKey'), moduleName: str(o, 'moduleName'), isEnabled: bool(o, 'isEnabled'), activeVersion: str(o, 'activeVersion'),
});
const toFunction = (o: Json): ModuleFunction => ({ functionId: str(o, 'functionId'), functionKey: str(o, 'functionKey'), displayName: str(o, 'displayName'), actionKey: optStr(o, 'actionKey') });
const toItem = (o: Json): MenuItem => ({
  navigationId: str(o, 'navigationId'), parentId: optStr(o, 'parentId'), parentTitle: optStr(o, 'parentTitle'), moduleId: optStr(o, 'moduleId'), moduleKey: optStr(o, 'moduleKey'),
  functionId: optStr(o, 'functionId'), functionKey: optStr(o, 'functionKey'), menuTitle: str(o, 'menuTitle'), sortOrder: num(o, 'sortOrder'), isVisible: bool(o, 'isVisible'),
});

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, parse: (payload: unknown) => T, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/iam/admin${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }
  if (response.ok) {
    try {
      return { ok: true, data: parse(raw) };
    } catch {
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [], requestId: '' };
    }
  }
  const error = isObject(raw) && isObject(raw.error) ? raw.error : {};
  return {
    ok: false, status: response.status, code: typeof error.code === 'string' ? error.code : 'UNKNOWN', details: [],
    requestId: typeof error.requestId === 'string' ? error.requestId : '',
  };
}

const e = encodeURIComponent;
export const iamApi = {
  accounts: (search: string, page: number, pageSize: number) => request('GET', `/accounts?search=${e(search)}&page=${page}&pageSize=${pageSize}`, (p) => {
    const o = obj(p);
    return { accounts: list('accounts', toAccount)(o), total: num(o, 'total'), page: num(o, 'page'), pageSize: num(o, 'pageSize') };
  }),
  account: (id: string) => request('GET', `/accounts/${e(id)}`, (p) => toAccount(obj(obj(p)['account']))),
  roles: () => request('GET', '/roles', list('roles', toRole)),
  permissions: () => request('GET', '/permissions', list('permissions', toPermission)),
  accountRoles: (id: string) => request('GET', `/accounts/${e(id)}/roles`, list('roles', toAssignment)),
  accountPermissions: (id: string) => request('GET', `/accounts/${e(id)}/permissions`, (p) => ({ direct: list('direct', toDirect)(p), effective: list('effective', toEffective)(p) })),
  rolePermissions: (id: string) => request('GET', `/roles/${e(id)}/permissions`, list('permissions', toRolePermission)),
  addRole: (data: { roleCode: string; roleName: string; description?: string }) => request('POST', '/roles', ok(), data),
  updateRole: (id: string, data: { roleName?: string; description?: string | null; isActive?: boolean }) => request('PATCH', `/roles/${e(id)}`, ok(), data),
  addPermission: (data: { permissionCode: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number; description?: string }) =>
    request('POST', '/permissions', ok(), data),
  assignRole: (id: string, roleId: string) => request('POST', `/accounts/${e(id)}/roles`, ok(), { roleId }),
  revokeRole: (id: string, assignmentId: string) => request('POST', `/accounts/${e(id)}/roles/${e(assignmentId)}/revoke`, ok(), {}),
  assignDirect: (id: string, data: { permissionId: string; effect: 'ALLOW' | 'DENY'; reason: string; expiresAt?: string | null }) =>
    request('POST', `/accounts/${e(id)}/permissions`, ok(), data),
  revokeDirect: (id: string, assignmentId: string) => request('POST', `/accounts/${e(id)}/permissions/${e(assignmentId)}/revoke`, ok(), {}),
  assignRolePermission: (roleId: string, permissionId: string) => request('POST', `/roles/${e(roleId)}/permissions`, ok(), { permissionId }),
  revokeRolePermission: (roleId: string, permissionId: string) => request('DELETE', `/roles/${e(roleId)}/permissions/${e(permissionId)}`, ok(), {}),
  navigationItems: () => request('GET', '/foundation/navigation/items', list('items', toItem)),
  activeModules: () => request('GET', '/foundation/modules', list('modules', toModule)),
  functions: (moduleId: string) => request('GET', `/foundation/modules/${e(moduleId)}/functions`, list('functions', toFunction)),
};

// Vietnamese texts of the IAM error codes (the Foundation texts cover the shared ones).
export const IAM_TEXT: Record<string, string> = {
  DUPLICATE: 'Dữ liệu đã tồn tại hoặc đang có hiệu lực (trùng lặp).',
  NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
  ALREADY_REVOKED: 'Bản ghi đã được thu hồi trước đó.',
  SYSTEM_ROLE_LOCKED: 'Vai trò hệ thống không được sửa hoặc gán quyền qua giao diện.',
  ROLE_INACTIVE: 'Vai trò đang không hoạt động, không thể gán.',
  EXPIRY_INVALID: 'Thời điểm hết hạn phải ở tương lai.',
  BINDING_INVALID: 'Permission phải khớp đúng một ánh xạ MIC-07 (K05) của phiên bản ACTIVE.',
  PERMISSION_TRIPLE_EXISTS: 'Bộ ba Module / Resource / Operation đã có permission.',
  IAM_DB_PRIVILEGE_MISSING: 'Cơ sở dữ liệu chưa cấp quyền cho thao tác IAM này (chờ chủ dự án phê duyệt GRANT). Không có thay đổi nào được lưu.',
};
