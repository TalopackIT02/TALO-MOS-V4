import type { CrmAdapter } from './adapter';
import { ApiCrmAdapter } from './apiAdapter';
import { MockCrmAdapter } from './mockAdapter';

// Mock / API selection (one place). Default = MOCK: the accepted Gate 1 behaviour, unchanged.
//   build time : VITE_CRM_ADAPTER=api   (Host frontend build of an environment where CRM is installed and ACTIVE)
//   dev harness: globalThis.__TALO_CRM_ADAPTER__ = 'api' before the first CRM screen renders
// The API adapter never falls back to the mock: if the backend is not reachable, the screens show the real error.
export type CrmAdapterMode = 'MOCK' | 'API';

export function crmAdapterMode(): CrmAdapterMode {
  const hook = (globalThis as { __TALO_CRM_ADAPTER__?: unknown }).__TALO_CRM_ADAPTER__;
  const raw = typeof hook === 'string' ? hook : import.meta.env['VITE_CRM_ADAPTER'];
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'api' ? 'API' : 'MOCK';
}

export function createCrmAdapter(mode: CrmAdapterMode = crmAdapterMode()): CrmAdapter {
  return mode === 'API' ? new ApiCrmAdapter() : new MockCrmAdapter();
}
