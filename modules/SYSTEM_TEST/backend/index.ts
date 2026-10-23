import express from 'express';
import type { Router } from 'express';
import { DATA_INSPECTOR_BINDING } from './data-inspector.permissions.js';
import { dataInspectorRouter } from './data-inspector.routes.js';
import { DataInspectorService } from './data-inspector.service.js';
import { systemAuditRouter } from './system-audit.routes.js';
import { SystemAuditService } from './system-audit.service.js';
import type { ModuleHost } from './host.js';
import { SYSTEM_TEST_BINDING } from './system-test.permissions.js';
import type { SystemTestBinding } from './system-test.permissions.js';
import { SqlSystemTestRepository } from './system-test.repository.js';
import type { SystemTestRepository } from './system-test.repository.js';
import { systemTestRouter } from './system-test.routes.js';
import { SystemTestService } from './system-test.service.js';

// SYSTEM_TEST (System Test & Diagnostics) module — backend entry of the package (module.json "backendEntry").
// Diagnostics and regression results, mounted under /api/system-test. MOD-TEST-02: everything the
// module needs from Foundation / Auth arrives as Host capabilities (host.ts); it reads through the Host's API role only.

export { HOST_PROTOCOL, REQUIRED_CAPABILITIES } from './host.js';

export interface SystemTestModuleOptions {
  // Test seams (in-process only).
  readonly binding?: SystemTestBinding;
  readonly repository?: SystemTestRepository;
}

export interface SystemTestModule {
  readonly router: Router;
  readonly service: SystemTestService;
}

export function createModule(host: ModuleHost, options: SystemTestModuleOptions = {}): SystemTestModule {
  const service = new SystemTestService({
    host,
    repository: options.repository ?? new SqlSystemTestRepository(host),
    binding: options.binding ?? SYSTEM_TEST_BINDING,
  });
  const router = express.Router();
  router.use(systemTestRouter({ host, service }));
  // Unified lifecycle SYSTEM_TEST, with the original exact admin account gate retained.
  router.use(dataInspectorRouter({ host, service: new DataInspectorService({ host, binding: DATA_INSPECTOR_BINDING }) }));
  router.use(systemAuditRouter({ host, service: new SystemAuditService(host) }));
  return { router, service };
}
