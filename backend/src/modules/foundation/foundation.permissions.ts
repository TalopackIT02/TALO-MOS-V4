// Effective permission (owner decision B-4, FBE-01A):
//   effective = valid Role ALLOW ∪ valid Direct ALLOW − valid Direct DENY; a valid Direct DENY always wins.
// No admin bypass, no wildcard. A permission that is not defined in iam_permissions grants nothing.
// The repository reads raw facts (read-only, parameterised); every rule is decided here, in one pure function.

export interface PermissionRef {
  readonly permissionCode: string;
  readonly moduleCode: string;
  readonly resourceCode: string;
  readonly operation: string;
}

export const MODULE_REGISTRY_READ: PermissionRef = {
  permissionCode: 'foundation.module_registry.read', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_REGISTRY', operation: 'READ',
};

export const MODULE_REGISTRY_CREATE: PermissionRef = {
  permissionCode: 'foundation.module_registry.create', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_REGISTRY', operation: 'CREATE',
};

// FBE-02A — Module Version (owner approved): FOUNDATION / MODULE_VERSION / READ|CREATE, minimum assurance 1.
export const MODULE_VERSION_READ: PermissionRef = {
  permissionCode: 'foundation.module_version.read', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'READ',
};

export const MODULE_VERSION_CREATE: PermissionRef = {
  permissionCode: 'foundation.module_version.create', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'CREATE',
};

// FBE-02B — MIC manifest / SUBMIT (owner approved P-6): FOUNDATION / MODULE_VERSION / UPDATE|SUBMIT, assurance 1.
export const MODULE_VERSION_UPDATE: PermissionRef = {
  permissionCode: 'foundation.module_version.update', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'UPDATE',
};

export const MODULE_VERSION_SUBMIT: PermissionRef = {
  permissionCode: 'foundation.module_version.submit', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'SUBMIT',
};

// FBE-05 — Lifecycle (owner decision L6): FOUNDATION / MODULE_VERSION / APPROVE|REJECT|ACTIVATE|RETIRE and
// FOUNDATION / MODULE_REGISTRY / ENABLE|DISABLE, minimum assurance 1.
export const MODULE_VERSION_APPROVE: PermissionRef = {
  permissionCode: 'foundation.module_version.approve', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'APPROVE',
};

export const MODULE_VERSION_REJECT: PermissionRef = {
  permissionCode: 'foundation.module_version.reject', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'REJECT',
};

export const MODULE_VERSION_ACTIVATE: PermissionRef = {
  permissionCode: 'foundation.module_version.activate', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'ACTIVATE',
};

export const MODULE_VERSION_RETIRE: PermissionRef = {
  permissionCode: 'foundation.module_version.retire', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_VERSION', operation: 'RETIRE',
};

export const MODULE_REGISTRY_ENABLE: PermissionRef = {
  permissionCode: 'foundation.module_registry.enable', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_REGISTRY', operation: 'ENABLE',
};

export const MODULE_REGISTRY_DISABLE: PermissionRef = {
  permissionCode: 'foundation.module_registry.disable', moduleCode: 'FOUNDATION', resourceCode: 'MODULE_REGISTRY', operation: 'DISABLE',
};

// FBE-06 — Navigation management (owner decision N4): FOUNDATION / NAVIGATION / MANAGE, minimum assurance 1.
export const NAVIGATION_MANAGE: PermissionRef = {
  permissionCode: 'foundation.navigation.manage', moduleCode: 'FOUNDATION', resourceCode: 'NAVIGATION', operation: 'MANAGE',
};

export interface PermissionDefinition {
  readonly permissionId: string;
  readonly minimumAssuranceLevel: number;
}

export interface AccountFacts {
  readonly accountStatus: string;
  readonly notDisabled: boolean;
}

// One row per role grant or direct grant of the permission to the account. Time flags are computed by PostgreSQL
// against statement_timestamp(); `roleActive` is true for direct grants.
export interface GrantFacts {
  readonly source: 'ROLE' | 'DIRECT';
  readonly effect: string;
  readonly roleActive: boolean;
  readonly notRevoked: boolean;
  readonly started: boolean;
  readonly notExpired: boolean;
}

export interface AccessFacts {
  readonly permissions: readonly PermissionDefinition[];
  readonly account: AccountFacts | null;
  readonly grants: readonly GrantFacts[];
}

export type DenyReason =
  | 'PERMISSION_NOT_DEFINED' | 'PERMISSION_AMBIGUOUS' | 'ACCOUNT_NOT_ELIGIBLE' | 'DIRECT_DENY' | 'NO_VALID_ALLOW' | 'ASSURANCE_INSUFFICIENT';

export type AccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: DenyReason };

function isValid(grant: GrantFacts): boolean {
  return grant.roleActive && grant.notRevoked && grant.started && grant.notExpired;
}

export function evaluateAccess(facts: AccessFacts, sessionAssuranceLevel: number): AccessDecision {
  if (facts.permissions.length === 0) return { allowed: false, reason: 'PERMISSION_NOT_DEFINED' };
  const [permission] = facts.permissions;
  if (facts.permissions.length > 1 || !permission) return { allowed: false, reason: 'PERMISSION_AMBIGUOUS' };
  const account = facts.account;
  if (!account || account.accountStatus !== 'ACTIVE' || !account.notDisabled) return { allowed: false, reason: 'ACCOUNT_NOT_ELIGIBLE' };

  const valid = facts.grants.filter(isValid);
  if (valid.some((g) => g.source === 'DIRECT' && g.effect === 'DENY')) return { allowed: false, reason: 'DIRECT_DENY' };
  // Role grants are ALLOW by construction (iam_role_permissions has no effect column).
  const allow = valid.some((g) => g.source === 'ROLE' || (g.source === 'DIRECT' && g.effect === 'ALLOW'));
  if (!allow) return { allowed: false, reason: 'NO_VALID_ALLOW' };
  if (!(sessionAssuranceLevel >= permission.minimumAssuranceLevel)) return { allowed: false, reason: 'ASSURANCE_INSUFFICIENT' };
  return { allowed: true };
}
