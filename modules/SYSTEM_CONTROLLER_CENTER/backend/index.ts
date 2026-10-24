import express from 'express';
import {administratorOnlyHost} from './administrator-gate.js';
import {controllerOverviewRouter} from './controller-overview.routes.js';
import {ControllerOverviewService} from './controller-overview.service.js';
import type { Router } from 'express';
import { DATA_INSPECTOR_BINDING } from './data-inspector.permissions.js';
import { dataInspectorRouter } from './data-inspector.routes.js';
import { DataInspectorService } from './data-inspector.service.js';
import { systemAuditRouter } from './system-audit.routes.js';
import { SystemAuditService } from './system-audit.service.js';
import type { ModuleHost } from './host.js';
import { SYSTEM_CONTROLLER_CENTER_BINDING } from './system-controller-center.permissions.js';
import type { SystemTestBinding } from './system-controller-center.permissions.js';
import { SqlSystemTestRepository } from './system-controller-center.repository.js';
import type { SystemTestRepository } from './system-controller-center.repository.js';
import { systemTestRouter } from './system-controller-center.routes.js';
import { SystemTestService } from './system-controller-center.service.js';

// SYSTEM_CONTROLLER_CENTER (System Controller Center) module — backend entry of the package (module.json "backendEntry").
// Diagnostics and regression results, mounted under /api/system-controller-center. MOD-TEST-02: everything the
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
  const secureHost = administratorOnlyHost(host);
  const service = new SystemTestService({
    host: secureHost,
    repository: options.repository ?? new SqlSystemTestRepository(secureHost),
    binding: options.binding ?? SYSTEM_CONTROLLER_CENTER_BINDING,
  });
  const router = express.Router();
  router.use(systemTestRouter({ host: secureHost, service }));
  // All routes use the new role-code based administrator gate, plus per-action IAM and lifecycle gates.
  router.use(dataInspectorRouter({ host: secureHost, service: new DataInspectorService({ host: secureHost, binding: DATA_INSPECTOR_BINDING }) }));
  router.use(systemAuditRouter({ host: secureHost, service: new SystemAuditService(secureHost) }));
  router.use(controllerOverviewRouter({ host: secureHost, service: new ControllerOverviewService(secureHost) }));
  return { router, service };
}
