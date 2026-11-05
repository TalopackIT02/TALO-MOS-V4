import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrmClientError } from '../frontend/src/services/adapter';
import { ApiCrmAdapter } from '../frontend/src/services/apiAdapter';
import { createCrmAdapter, crmAdapterMode } from '../frontend/src/services/config';
import { MockCrmAdapter } from '../frontend/src/services/mockAdapter';

// CRM 0.2.0 — ApiCrmAdapter with a stubbed fetch (no server). Proven here: same interface as the mock, /api/cm paths and
// methods, same-origin session only (no actor id sent), REV01 error + business reason → Gate 1 code / text, 401 → session
// lost, document upload refused with its real reason, default mode stays MOCK.

type Call = { url: string; method: string; body: unknown };
function stub(responses: ((c: Call) => { status: number; body: unknown; text?: string }) | { status: number; body: unknown; text?: string }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const c = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    expect(init.credentials).toBe('same-origin');
    const r = typeof responses === 'function' ? responses(c) : responses;
    return new Response(r.text ?? JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': r.text ? 'text/csv' : 'application/json' } });
  });
  return calls;
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof CrmClientError ? `${e.code}|${e.message}` : 'UNEXPECTED'; }
}
afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as { __TALO_CRM_ADAPTER__?: unknown }).__TALO_CRM_ADAPTER__; });

describe('mode selection', () => {
  it('default is MOCK (accepted Gate 1); API only when asked', () => {
    expect(crmAdapterMode()).toBe('MOCK');
    expect(createCrmAdapter()).toBeInstanceOf(MockCrmAdapter);
    (globalThis as { __TALO_CRM_ADAPTER__?: unknown }).__TALO_CRM_ADAPTER__ = 'api';
    expect(crmAdapterMode()).toBe('API');
    expect(createCrmAdapter().kind).toBe('API');
  });
  it('implements every method of the CrmAdapter interface (same as the mock)', () => {
    const src = readFileSync(new URL('../frontend/src/services/adapter.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export interface CrmAdapter {'));
    const methods = [...block.slice(0, block.indexOf('\n}')).matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1] ?? '');
    expect(methods.length).toBeGreaterThan(50);
    const api = new ApiCrmAdapter();
    const mock = new MockCrmAdapter({ persist: false, accountId: 'acc-sale-a' });
    expect(methods.filter((k) => typeof Reflect.get(api, k) !== 'function')).toEqual([]);
    expect(methods.filter((k) => typeof Reflect.get(mock, k) !== 'function')).toEqual([]);
  });
});

describe('requests', () => {
  it('session: permissions from IAM; no actor id in any write body', async () => {
    const calls = stub((c) => (c.url.endsWith('/session')
      ? { status: 200, body: { data: { account: { accountId: 'u1', fullName: 'A', title: '', active: true }, permissions: ['crm.customer.read'] } } }
      : { status: 201, body: { data: { customer: { customerId: 'c1' }, warnings: [] } } }));
    const api = new ApiCrmAdapter();
    const s = await api.session();
    expect([...s.permissions]).toEqual(['crm.customer.read']);
    await api.createCustomerFull({ customer: { customerType: 'COMPANY', displayName: 'A' }, contacts: [], primarySaleAccountId: null, supportSaleAccountIds: [], groupIds: [], verify: false });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/cm/session', 'POST /api/cm/customers/full']);
    expect(JSON.stringify(calls[1]?.body)).not.toMatch(/actor|createdAccountId|userAccountId/);
  });

  it('list query: empty filters dropped, booleans as text', async () => {
    const calls = stub({ status: 200, body: { data: { items: [], total: 0, page: 1, pageSize: 20 } } });
    await new ApiCrmAdapter().listCustomers({ q: 'An', customerType: '', includeHidden: true, page: 2 });
    expect(calls[0]?.url).toBe('/api/cm/customers?q=An&includeHidden=true&page=2');
  });

  it('handover endpoints unwrap { handover }; reject sends the reason', async () => {
    const calls = stub({ status: 200, body: { data: { handover: { handoverId: 'h1', status: 'REJECTED' } } } });
    const api = new ApiCrmAdapter();
    expect((await api.rejectHandover('h1', 'Lý do')).status).toBe('REJECTED');
    expect([calls[0]?.method, calls[0]?.url, calls[0]?.body]).toEqual(['POST', '/api/cm/handovers/h1/reject', { reason: 'Lý do' }]);
  });

  it('export returns the CSV text', async () => {
    stub({ status: 200, body: null, text: '﻿customer_code\r\n' });
    expect(await new ApiCrmAdapter().exportCustomersCsv({})).toBe('﻿customer_code\r\n');
  });

  it('check-identity / export are POST with the filter in the body (never the identifier in the URL)', async () => {
    const calls = stub((c) => (c.url.endsWith('/export') ? { status: 200, body: null, text: 'x' } : { status: 200, body: { data: { normalized: '0312345678', duplicate: false, similarNameCount: 0 } } }));
    const api = new ApiCrmAdapter();
    await api.checkIdentity('VN_TAX_ID', '0312345678', 'VN');
    await api.exportCustomersCsv({ q: 'An', includeHidden: true });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/cm/customers/check-identity', { identifierType: 'VN_TAX_ID', identifier: '0312345678', countryCode: 'VN' }],
      ['POST', '/api/cm/customers/export', { q: 'An', includeHidden: 'true' }],
    ]);
  });

  it("appointments: Gate 1's '0000' / '9999' (every appointment) becomes the widest ISO window; ISO bounds are kept", async () => {
    const calls = stub({ status: 200, body: { data: [] } });
    const api = new ApiCrmAdapter();
    await api.listAppointments({ from: '0000', to: '9999' });
    await api.listAppointments({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' });
    expect(calls[0]?.url).toContain('from=2000-01-01T00%3A00%3A00.000Z&to=2100-01-01T00%3A00%3A00.000Z');
    expect(calls[1]?.url).toContain('from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-08T00%3A00%3A00.000Z');
  });
});

describe('errors', () => {
  it('business reason → the Gate 1 code / text; plain REV01 code kept; 401 → UNAUTHENTICATED', async () => {
    const api = new ApiCrmAdapter();
    stub({ status: 409, body: { error: { code: 'CM_VALIDATION_FAILED', message: 'x', details: { reason: 'ASSIGNMENT_CONFLICT' } } } });
    expect(await code(api.addAssignment('c1', 'u2', 'PRIMARY'))).toMatch(/^CM_ASSIGNMENT_CONFLICT\|/);
    stub({ status: 409, body: { error: { code: 'CM_IDENTITY_DUPLICATE', message: 'Định danh pháp lý đã tồn tại.' } } });
    expect(await code(api.createCustomer({ customerType: 'COMPANY', displayName: 'A' }))).toBe('CM_IDENTITY_DUPLICATE|Định danh pháp lý đã tồn tại.');
    stub({ status: 422, body: { error: { code: 'CM_VALIDATION_FAILED', message: 'x', details: { reason: 'CONTACT_PHONE_REQUIRED' } } } });
    expect(await code(api.createContact('c1', { fullName: 'A' }))).toBe('CM_VALIDATION_FAILED|Cần ít nhất số điện thoại hoặc Zalo.');
    stub({ status: 401, body: { error: { code: 'SESSION_INVALID' } } });
    expect(await code(api.groups())).toMatch(/^UNAUTHENTICATED\|/);
  });

  it('document upload: refused with the real reason (no Storage service), never a fake success', async () => {
    stub({ status: 503, body: { error: { code: 'MODULE_UNAVAILABLE', message: 'x', details: { reason: 'STORAGE_UNAVAILABLE' } } } });
    expect(await code(new ApiCrmAdapter().createDocument('c1', { documentName: 'a', documentType: 'LEGAL', fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 1 })))
      .toMatch(/^CM_STORAGE_UNAVAILABLE\|.*BLOCKED/);
    expect(new ApiCrmAdapter().capabilities().find((c) => c.feature.startsWith('Upload'))?.state).toBe('BLOCKED');
  });

  it('optional parts: a missing right gives an empty list without calling the API', async () => {
    const calls = stub({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    expect(await new ApiCrmAdapter().listLegalChanges()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
