import type { ApiResult } from '../foundation/foundationApi';

// Client of the IAM Management API (/api/iam/admin/*). Same rules as the Foundation client: same-origin cookie session,
// no token storage, no retry of a write, every answer parsed (no unchecked cast); the server decides every permission.

// membershipId / employeeCode / fullName / membershipStatus are null for an account PENDING_MEMBERSHIP (IAM Phase C PC-01).
export type Account = {
  accountId: string; username: string; accountStatus: string; disabled: boolean; membershipId: string | null;
  employeeCode: string | null; fullName: string | null; membershipStatus: string | null; isRoot: boolean;
};
export type Role = { roleId: string; roleCode: string; roleName: string; description: string | null; isActive: boolean; isSystem: boolean; permissionCount: number; activeAssignments: number };
export type Permission = { permissionId: string; permissionCode: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number; description: string | null };
export type RolePermission = { permissionId: string; permissionCode: string; moduleCode: string; resourceCode: string; operation: string };
export type RoleAssignment = { userRoleId: string; roleId: string; roleCode: string; roleName: string; roleActive: boolean; assignedAt: string; revokedAt: string | null };
export type DirectGrant = { userPermissionId: string; permissionId: string; permissionCode: string; effect: string; reason: string | null; assignedAt: string; expiresAt: string | null; revokedAt: string | null; expired: boolean };
export type GrantSource = 'ROLE' | 'DIRECT_ALLOW' | 'DIRECT_DENY';
export type Effective = {
  permissionId: string; permissionCode: string; moduleCode: string; resourceCode: string; operation: string; description: string | null;
  allowed: boolean; reason: string; assumedAssuranceLevel: number; sources: GrantSource[];
};
export type TreeAction = { actionKey: string; actionName: string | null; actionDescription: string | null; permission: Permission | null };
export type TreeFunction = { functionKey: string; functionName: string | null; actions: TreeAction[] };
export type TreeModule = { moduleKey: string; moduleName: string | null; description: string | null; isEnabled: boolean; moduleVersion: string; functions: TreeFunction[] };
export type PermissionTree = { modules: TreeModule[]; platform: Permission[]; unbound: Permission[] };
export type AccountField = 'username' | 'employeeCode' | 'fullName' | 'accountStatus';
export type AccountQuery = { search: string; field: AccountField | null; status: string | null; sort: AccountField; dir: 'asc' | 'desc'; page: number; pageSize: number };
export type ActiveModule = { moduleId: string; moduleKey: string; moduleName: string; isEnabled: boolean; activeVersion: string };
export type ModuleFunction = { functionId: string; functionKey: string; displayName: string; actionKey: string | null };
export type MenuItem = {
  navigationId: string; parentId: string | null; parentTitle: string | null; moduleId: string | null; moduleKey: string | null;
  moduleName: string | null; functionId: string | null; functionKey: string | null; functionName: string | null; menuTitle: string; sortOrder: number; isVisible: boolean;
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
  membershipId: optStr(o, 'membershipId'), employeeCode: optStr(o, 'employeeCode'), fullName: optStr(o, 'fullName'), membershipStatus: optStr(o, 'membershipStatus'),
  isRoot: o['isRoot'] === true,
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
  assumedAssuranceLevel: num(o, 'assumedAssuranceLevel'), moduleCode: str(o, 'moduleCode'), resourceCode: str(o, 'resourceCode'), operation: str(o, 'operation'),
  description: optStr(o, 'description'), sources: sourcesOf(o['sources']),
});
const SOURCES: readonly GrantSource[] = ['ROLE', 'DIRECT_ALLOW', 'DIRECT_DENY'];
const sourcesOf = (v: unknown): GrantSource[] => (Array.isArray(v) ? SOURCES.filter((s) => v.includes(s)) : []);
const toTreeAction = (o: Json): TreeAction => ({
  actionKey: str(o, 'actionKey'), actionName: optStr(o, 'actionName'), actionDescription: optStr(o, 'actionDescription'),
  permission: isObject(o['permission']) ? toPermission(o['permission']) : null,
});
const toTreeFunction = (o: Json): TreeFunction => ({ functionKey: str(o, 'functionKey'), functionName: optStr(o, 'functionName'), actions: list('actions', toTreeAction)(o) });
const toTreeModule = (o: Json): TreeModule => ({
  moduleKey: str(o, 'moduleKey'), moduleName: optStr(o, 'moduleName'), description: optStr(o, 'description'), isEnabled: bool(o, 'isEnabled'),
  moduleVersion: str(o, 'moduleVersion'), functions: list('functions', toTreeFunction)(o),
});
const toTree = (payload: unknown): PermissionTree => {
  const t = obj(obj(payload)['tree']);
  return { modules: list('modules', toTreeModule)(t), platform: list('platform', toPermission)(t), unbound: list('unbound', toPermission)(t) };
};
// The session's own admin capabilities: permission code → evaluateAccess() decision (only booleans are kept).
export type Capabilities = Readonly<Record<string, boolean>>;
const toCapabilities = (payload: unknown): Capabilities => {
  const p = obj(obj(payload)['permissions']);
  return Object.fromEntries(Object.entries(p).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
};
const toModule = (o: Json): ActiveModule => ({
  moduleId: str(o, 'moduleId'), moduleKey: str(o, 'moduleKey'), moduleName: str(o, 'moduleName'), isEnabled: bool(o, 'isEnabled'), activeVersion: str(o, 'activeVersion'),
});
const toFunction = (o: Json): ModuleFunction => ({ functionId: str(o, 'functionId'), functionKey: str(o, 'functionKey'), displayName: str(o, 'displayName'), actionKey: optStr(o, 'actionKey') });
const toItem = (o: Json): MenuItem => ({
  navigationId: str(o, 'navigationId'), parentId: optStr(o, 'parentId'), parentTitle: optStr(o, 'parentTitle'), moduleId: optStr(o, 'moduleId'), moduleKey: optStr(o, 'moduleKey'),
  moduleName: optStr(o, 'moduleName'), functionId: optStr(o, 'functionId'), functionKey: optStr(o, 'functionKey'), functionName: optStr(o, 'functionName'),
  menuTitle: str(o, 'menuTitle'), sortOrder: num(o, 'sortOrder'), isVisible: bool(o, 'isVisible'),
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
  capabilities: () => request('GET', '/me/capabilities', toCapabilities),
  permissionTree: () => request('GET', '/permission-tree', toTree),
  accounts: (q: AccountQuery) => request('GET', `/accounts?${new URLSearchParams({
    search: q.search, page: String(q.page), pageSize: String(q.pageSize), sort: q.sort, dir: q.dir,
    ...(q.field ? { field: q.field } : {}), ...(q.status ? { status: q.status } : {}),
  }).toString()}`, (p) => {
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

// ------------------------------------------------------------------------------------------------------- IAM Phase B
export type StatusAction = 'LOCK' | 'UNLOCK' | 'DISABLE' | 'REACTIVATE';
export type CredentialFeature = 'DISABLED' | 'UNAVAILABLE' | 'READY';
export type AccountDetails = {
  createdAt: string | null; activatedAt: string | null; disabledAt: string | null; createdByUsername: string | null;
  joinedAt: string | null; leftAt: string | null; hasCredential: boolean | null; mustChangePassword: boolean | null; failedAttempts: number | null;
  loginLockedUntil: string | null;
};
export type SessionRow = {
  sessionId: string; assuranceLevel: number; createdAt: string; expiresAt: string; lastSeenAt: string | null; revokedAt: string | null;
  status: 'ACTIVE' | 'IDLE' | 'ACTIVATION' | 'EXPIRED' | 'REVOKED';
};
export type AuditEvent = {
  auditId: string; occurredAt: string; action: string; outcome: string; actorId: string | null; actorUsername: string | null;
  targetType: string | null; targetId: string | null; targetUsername: string | null; metadata: Record<string, string>;
};
export type AuditQuery = { accountId: string | null; action: string; outcome: string | null; from: string | null; to: string | null; page: number; pageSize: number };
// A temporary password lives only in the value returned to the caller (shown once, then dropped). Never stored.
export type IssuedCredential = { accountId: string; username: string; temporaryPassword: string; revokedSessions: number | null; membershipCreated: boolean | null };

const SESSION_STATUSES: readonly SessionRow['status'][] = ['ACTIVE', 'IDLE', 'ACTIVATION', 'EXPIRED', 'REVOKED'];
const optNum = (o: Json, k: string): number | null => { const v = o[k]; return typeof v === 'number' ? v : null; };
const optBool = (o: Json, k: string): boolean | null => { const v = o[k]; return typeof v === 'boolean' ? v : null; };
const toDetails = (payload: unknown): AccountDetails | null => {
  const d = obj(payload)['details'];
  if (d === null) return null;
  const o = obj(d);
  return {
    createdAt: optStr(o, 'createdAt'), activatedAt: optStr(o, 'activatedAt'), disabledAt: optStr(o, 'disabledAt'), createdByUsername: optStr(o, 'createdByUsername'),
    joinedAt: optStr(o, 'joinedAt'), leftAt: optStr(o, 'leftAt'), hasCredential: optBool(o, 'hasCredential'), mustChangePassword: optBool(o, 'mustChangePassword'),
    failedAttempts: optNum(o, 'failedAttempts'), loginLockedUntil: optStr(o, 'loginLockedUntil'),
  };
};
const toSession = (o: Json): SessionRow => {
  const status = SESSION_STATUSES.find((s) => s === o['status']) ?? fail('status');
  return {
    sessionId: str(o, 'sessionId'), assuranceLevel: num(o, 'assuranceLevel'), createdAt: str(o, 'createdAt'), expiresAt: str(o, 'expiresAt'),
    lastSeenAt: optStr(o, 'lastSeenAt'), revokedAt: optStr(o, 'revokedAt'), status,
  };
};
const toAuditEvent = (o: Json): AuditEvent => {
  const m = isObject(o['metadata']) ? o['metadata'] : {};
  return {
    auditId: str(o, 'auditId'), occurredAt: str(o, 'occurredAt'), action: str(o, 'action'), outcome: str(o, 'outcome'),
    actorId: optStr(o, 'actorId'), actorUsername: optStr(o, 'actorUsername'), targetType: optStr(o, 'targetType'), targetId: optStr(o, 'targetId'),
    targetUsername: optStr(o, 'targetUsername'),
    metadata: Object.fromEntries(Object.entries(m).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
};
const toIssued = (key: 'account' | 'credential') => (payload: unknown): IssuedCredential => {
  const o = obj(obj(payload)[key]);
  return {
    accountId: str(o, 'accountId'), username: str(o, 'username'), temporaryPassword: str(o, 'temporaryPassword'),
    revokedSessions: optNum(o, 'revokedSessions'), membershipCreated: optBool(o, 'membershipCreated'),
  };
};
const toFeature = (payload: unknown): CredentialFeature => {
  const f = obj(payload)['features'];
  const v = isObject(f) ? f['temporaryCredentials'] : undefined;
  return v === 'READY' || v === 'UNAVAILABLE' ? v : 'DISABLED';
};

export const iamLifecycleApi = {
  features: () => request('GET', '/me/capabilities', toFeature),
  details: (id: string) => request('GET', `/accounts/${e(id)}/details`, toDetails),
  setStatus: (id: string, action: StatusAction, reason: string) => request('POST', `/accounts/${e(id)}/status`, ok(), { action, reason }),
  clearLoginLock: (id: string, reason: string) => request('POST', `/accounts/${e(id)}/login-lock/clear`, (p) => obj(obj(p)['result'])['cleared'] === true, { reason }),
  sessions: (id: string) => request('GET', `/accounts/${e(id)}/sessions`, list('sessions', toSession)),
  revokeSessions: (id: string, sessionId: string | null, reason: string) =>
    request('POST', `/accounts/${e(id)}/sessions/revoke`, (p) => num(obj(obj(p)['result']), 'revokedSessions'), { sessionId, reason }),
  audit: (q: AuditQuery) => request('GET', `/audit?${new URLSearchParams({
    page: String(q.page), pageSize: String(q.pageSize), ...(q.accountId ? { accountId: q.accountId } : {}), ...(q.action ? { action: q.action } : {}),
    ...(q.outcome ? { outcome: q.outcome } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}),
  }).toString()}`, (p) => {
    const o = obj(p);
    return { events: list('events', toAuditEvent)(o), total: num(o, 'total') };
  }),
  // IAM Phase C PC-01: a User Account PENDING_MEMBERSHIP — username only, no membership, no password.
  createPending: (username: string) => request('POST', '/accounts/pending', (p) => {
    const o = obj(obj(p)['account']);
    return { accountId: str(o, 'accountId'), username: str(o, 'username'), accountStatus: str(o, 'accountStatus') };
  }, { username }),
  reissue: (id: string, reason: string) => request('POST', `/accounts/${e(id)}/credential/reissue`, toIssued('credential'), { reason }),
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
  PLATFORM_PERMISSION_LOCKED: 'Permission quản trị nền tảng (IAM / FOUNDATION) chỉ được cấp qua quy trình khởi tạo đã phê duyệt, không qua giao diện.',
  ROOT_ADMIN_PROTECTED: 'Tài khoản quản trị gốc được bảo vệ: không thu hồi vai trò hệ thống hoặc quyền quản trị nền tảng của tài khoản này qua giao diện. Thao tác đã bị chặn và ghi audit.',
  SELF_ASSIGNMENT_FORBIDDEN:'Không được tự cấp, thu hồi hoặc mở rộng quyền cho chính tài khoản của mình.',
  IAM_DB_PRIVILEGE_MISSING: 'Cơ sở dữ liệu chưa cấp quyền cho thao tác IAM này (chờ chủ dự án phê duyệt GRANT). Không có thay đổi nào được lưu.',
  SELF_ACTION_FORBIDDEN: 'Không được khóa, vô hiệu hóa hoặc cấp lại mật khẩu cho chính tài khoản của mình.',
  ROOT_NOT_CONFIGURED: 'Chưa cấu hình tài khoản Admin gốc: không khóa / vô hiệu hóa tài khoản quản trị nền tảng qua giao diện.',
  STATUS_TRANSITION_INVALID: 'Trạng thái hiện tại của tài khoản không cho phép thao tác này.',
  ACCOUNT_RETIRED: 'Tài khoản đã kết thúc vòng đời; trạng thái không thay đổi qua giao diện.',
  IAM_DB_FEATURE_MISSING: 'Chức năng cơ sở dữ liệu cho thao tác này chưa được cài đặt (gói IAM Phase B chờ phê duyệt). Không có thay đổi nào được lưu.',
  CREDENTIAL_UI_DISABLED: 'Cấp mật khẩu tạm trên giao diện chưa được bật (quyết định P-4e hiện hành: chỉ qua công cụ CLI của IT).',
  CREDENTIAL_UI_UNAVAILABLE: 'Kết nối cấp tài khoản (talo_provisioner) chưa sẵn sàng. Không có thay đổi nào được lưu.',
  USERNAME_TAKEN: 'Tên đăng nhập đã tồn tại.',
  CREDENTIAL_NOT_ISSUED: 'Tài khoản đang chờ Membership: chưa có mật khẩu để cấp lại. Mật khẩu tạm được cấp khi gán Membership.',
  PENDING_ACCOUNT_DB_MISSING: 'Chức năng tạo tài khoản chờ Membership chưa được cài đặt trong cơ sở dữ liệu (gói IAM Phase C PC-01 chờ phê duyệt). Không có thay đổi nào được lưu.',
  MEMBERSHIP_HAS_ACCOUNT: 'Nhân viên này đã có một tài khoản đang hiện hành.',
  MEMBERSHIP_NOT_ACTIVE: 'Hồ sơ nhân viên không ở trạng thái được cấp tài khoản.',
  PRIVILEGED_ACCOUNT_PROTECTED: 'Tài khoản thuộc diện được bảo vệ theo luật của hàm phục hồi: không cấp lại mật khẩu qua giao diện.',
  ACCOUNT_NOT_ELIGIBLE: 'Tài khoản hoặc hồ sơ nhân viên không đủ điều kiện cấp lại mật khẩu.',
};

// Permissions of platform administration (bootstrap-only on the server): not offered for grants in the UI.
export const isPlatformPermission = (p: { moduleCode: string }) => p.moduleCode === 'IAM' || p.moduleCode === 'FOUNDATION';
