import type { Router } from 'express';
import type { ModuleHost } from './host.js';
import { DATA_INSPECTOR_BINDING } from './data-inspector.permissions.js';
import type { DataInspectorBinding } from './data-inspector.permissions.js';
import { dataInspectorRouter } from './data-inspector.routes.js';
import { DataInspectorService } from './data-inspector.service.js';

// DATA_INSPECTOR (Trình xem PostgreSQL chỉ đọc, admin) — backend entry of the package (module.json "backendEntry").
// Three GET under /api/data-inspector. Everything the module needs from Foundation / Auth arrives as Host capabilities
// (host.ts: session, authorize, lifecycle, readOnly, logger); it reads through the Host's API role only.

export { HOST_PROTOCOL, REQUIRED_CAPABILITIES } from './host.js';

export interface DataInspectorModuleOptions {
  // Test seam (in-process only): fixture module key / permission references.
  readonly binding?: DataInspectorBinding;
}

export interface DataInspectorModule {
  readonly router: Router;
  readonly service: DataInspectorService;
}

export function createModule(host: ModuleHost, options: DataInspectorModuleOptions = {}): DataInspectorModule {
  const service = new DataInspectorService({ host, binding: options.binding ?? DATA_INSPECTOR_BINDING });
  return { router: dataInspectorRouter({ host, service }), service };
}
