import type { ModulePermission as PermissionRef } from './host.js';

// DATA_INSPECTOR — IAM binding (K05: moduleCode = module key, resourceCode = Function key, operation = Action key,
// minimum assurance 1; spec v0.2 §03). Evaluated by the Host's AccessGuard; no wildcard, and the username gate
// (data-inspector.admin.ts) is an extra condition, never an IAM bypass. The binding is a parameter only so that tests can
// run the same code under a fixture module key; production always uses DATA_INSPECTOR_BINDING.

export const DATA_INSPECTOR_MODULE_KEY = 'SYSTEM_TEST';

export interface DataInspectorBinding {
  readonly moduleKey: string;
  readonly catalogRead: PermissionRef;
  readonly rowsRead: PermissionRef;
}

export const DATA_INSPECTOR_BINDING: DataInspectorBinding = {
  moduleKey: DATA_INSPECTOR_MODULE_KEY,
  catalogRead: { permissionCode: 'system_test.catalog.read', moduleCode: DATA_INSPECTOR_MODULE_KEY, resourceCode: 'CATALOG', operation: 'READ' },
  rowsRead: { permissionCode: 'system_test.rows.read', moduleCode: DATA_INSPECTOR_MODULE_KEY, resourceCode: 'ROWS', operation: 'READ' },
};

// MIC-08 audit action codes. IAM DENIED → Host B08 audit (target_type DATA_INSPECTOR_API); NOT_ADMIN → logger only.
export const DATA_INSPECTOR_ACTION = {
  CATALOG_READ: 'SYSTEM_TEST.CATALOG.READ',
  ROWS_READ: 'SYSTEM_TEST.ROWS.READ',
  ACCESS_DENIED: 'SYSTEM_TEST.ACCESS_DENIED',
} as const;

export const DATA_INSPECTOR_DENIED_TARGET = 'DATA_INSPECTOR_API';

// The only account allowed to use the module (owner decision DEC-01, 22/10/2026): exact, case-sensitive.
export const ADMIN_USERNAME = 'admin';
