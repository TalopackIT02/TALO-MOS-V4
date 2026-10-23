import type { ModulePermission as PermissionRef } from './host.js';

export const SYSTEM_TEST_MODULE_KEY = 'SYSTEM_TEST';

export interface SystemTestBinding {
  readonly moduleKey: string;
  readonly diagnosticsRead: PermissionRef;
  readonly auditRead: PermissionRef;
  readonly testRunnerExecute: PermissionRef;
}

export const SYSTEM_TEST_BINDING: SystemTestBinding = {
  moduleKey: SYSTEM_TEST_MODULE_KEY,
  diagnosticsRead: { permissionCode: 'system_test.diagnostics.read', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'DIAGNOSTICS', operation: 'READ' },
  auditRead: { permissionCode: 'system_test.audit.read', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'AUDIT_LOG', operation: 'READ' },
  testRunnerExecute: { permissionCode: 'system_test.test_runner.execute', moduleCode: SYSTEM_TEST_MODULE_KEY, resourceCode: 'TEST_RUNNER', operation: 'EXECUTE' },
};
export const SYSTEM_TEST_ACTION = {
  DIAGNOSTICS_READ: 'SYSTEM_TEST.DIAGNOSTICS.READ',
  TEST_RUNNER_EXECUTE: 'SYSTEM_TEST.TEST_RUNNER.EXECUTE',
} as const;
export const SYSTEM_TEST_DENIED_TARGET = 'SYSTEM_TEST_API';
