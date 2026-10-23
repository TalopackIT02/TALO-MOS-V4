import type { Router } from 'express';
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
  return { router: systemTestRouter({ host, service }), service };
}
