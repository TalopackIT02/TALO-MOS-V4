import type { ModulePermission as PermissionRef } from './host.js';

// MOD-TEST-01 — IAM binding of the SYSTEM_TEST module (K05: moduleCode = module key, resourceCode = Function key,
// operation = Action key, minimum assurance 1). Evaluated by the shared AccessGuard / evaluateAccess(); no admin bypass,
// no wildcard. The binding is a parameter of the module only so that integration tests can run the same code against a
// fixture module (FBET_ST_<run>) with fixture permission definitions; production always uses SYSTEM_TEST_BINDING.

export const SYSTEM_TEST_MODULE_KEY = 'SYSTEM_TEST';

export interface SystemTestBinding {
  readonly moduleKey: string;
  readonly diagnosticsRead: PermissionRef;
  readonly dataViewerRead: PermissionRef;
  readonly testRunnerExecute: PermissionRef;
}

export const SYSTEM_TEST_BINDING: SystemTestBinding = {
  moduleKey: SYSTEM_TEST_MODULE_KEY,
  diagnosticsRead: { permissionCode: 'system_test.diagnostics.read', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'DIAGNOSTICS', operation: 'READ' },
  dataViewerRead: { permissionCode: 'system_test.data_viewer.read', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'DATA_VIEWER', operation: 'READ' },
  testRunnerExecute: { permissionCode: 'system_test.test_runner.execute', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'TEST_RUNNER', operation: 'EXECUTE' },
};

// B08 action codes of a DENIED module request (target_type SYSTEM_TEST_API, target_id / module_id NULL).
export const SYSTEM_TEST_ACTION = {
  DIAGNOSTICS_READ: 'SYSTEM_TEST.DIAGNOSTICS.READ',
  DATA_VIEWER_READ: 'SYSTEM_TEST.DATA_VIEWER.READ',
  TEST_RUNNER_EXECUTE: 'SYSTEM_TEST.TEST_RUNNER.EXECUTE',
} as const;

export const SYSTEM_TEST_DENIED_TARGET = 'SYSTEM_TEST_API';
