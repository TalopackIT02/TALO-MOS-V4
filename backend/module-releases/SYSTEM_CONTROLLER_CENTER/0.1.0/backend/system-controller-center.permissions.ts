import type { ModulePermission as PermissionRef } from './host.js';

export const SYSTEM_CONTROLLER_CENTER_MODULE_KEY = 'SYSTEM_CONTROLLER_CENTER';

export interface SystemTestBinding {
  readonly moduleKey: string;
  readonly diagnosticsRead: PermissionRef;
  readonly auditRead: PermissionRef;
  readonly testRunnerExecute: PermissionRef;
}

export const SYSTEM_CONTROLLER_CENTER_BINDING: SystemTestBinding = {
  moduleKey: SYSTEM_CONTROLLER_CENTER_MODULE_KEY,
  diagnosticsRead: { permissionCode: 'system_controller_center.diagnostics.read', moduleCode: SYSTEM_CONTROLLER_CENTER_MODULE_KEY, resourceCode: 'DIAGNOSTICS', operation: 'READ' },
  auditRead: { permissionCode: 'system_controller_center.audit.read', moduleCode: SYSTEM_CONTROLLER_CENTER_MODULE_KEY, resourceCode: 'AUDIT_LOG', operation: 'READ' },
  testRunnerExecute: { permissionCode: 'system_controller_center.test_runner.execute', moduleCode: SYSTEM_CONTROLLER_CENTER_MODULE_KEY, resourceCode: 'TEST_RUNNER', operation: 'EXECUTE' },
};
export const SYSTEM_CONTROLLER_CENTER_ACTION = {
  DIAGNOSTICS_READ: 'SYSTEM_CONTROLLER_CENTER.DIAGNOSTICS.READ',
  TEST_RUNNER_EXECUTE: 'SYSTEM_CONTROLLER_CENTER.TEST_RUNNER.EXECUTE',
} as const;
export const SYSTEM_CONTROLLER_CENTER_DENIED_TARGET = 'SYSTEM_CONTROLLER_CENTER_API';
