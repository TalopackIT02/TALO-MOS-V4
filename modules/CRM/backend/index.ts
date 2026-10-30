import { Router } from 'express';

// CRM — backend entry of the package (module.json "backendEntry", Host protocol TALO-MODULE-HOST-1).
// STATUS 0.1.0: BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY. The Host gives a module `readOnly` only (no write transaction,
// no audit write), so the CRM business API (customers, legal change, assignments, handovers, activities, contacts,
// groups, document metadata) cannot run through the Module Host yet. No route is mounted — nothing is faked.
// The business services will live under backend/src/ (api / services / repositories / authorization / adapters / types)
// and are ported once a Module Host write capability contract is approved (owner order III, Gate 3).

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';
export const REQUIRED_CAPABILITIES = ['session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'logger'] as const;
export const CRM_BACKEND_STATUS = 'BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY' as const;

export function createModule(_host: unknown): { readonly router: Router } {
  return { router: Router() };
}
