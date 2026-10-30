import { describe, expect, it } from 'vitest';
import { CrmClientError } from '../frontend/src/services/adapter';
import { MockCrmAdapter, csvCell, normalizeIdentifier } from '../frontend/src/services/mockAdapter';

// CRM 0.1.0 — business rules of the Mock Adapter (the same rules the backend contract enforces). Pure in-memory: no
// browser storage, no network. Each test builds its own adapter from the seed.

const as = (accountId: string) => new MockCrmAdapter({ persist: false, accountId });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof CrmClientError ? e.code : 'UNEXPECTED'; }
}

describe('identifiers and CSV', () => {
  it('normalises VN tax id (10 / 13 digits), personal id (12) and foreign registration', () => {
    expect(normalizeIdentifier('VN_TAX_ID', '0100-000-001')).toBe('0100000001');
    expect(normalizeIdentifier('VN_TAX_ID', '0100000001-001')).toBe('0100000001001');
    expect(normalizeIdentifier('VN_TAX_ID', '12345')).toBeNull();
    expect(normalizeIdentifier('VN_PERSONAL_ID', '0012 0300 0001')).toBe('001203000001');
    expect(normalizeIdentifier('FOREIGN_REG', 'sg-123.45')).toBe('SG12345');
  });
  it('guards CSV cells against formula injection (TC-49)', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+84 90')).toBe("'+84 90");
    expect(csvCell('An Phát')).toBe('An Phát');
  });
});

describe('customers — D01-a DRAFT / VERIFIED, duplicates, scope', () => {
  it('creates a DRAFT without tax id and keeps it visible to its creator', async () => {
    const a = as('acc-sale-a');
    const { customer } = await a.createCustomer({ customerType: 'COMPANY', displayName: 'KH thử 1' });
    expect(customer.recordStatus).toBe('DRAFT');
    expect(customer.customerCode).toMatch(/^\d{6}$/);
    expect((await a.customerBundle(customer.customerId)).customer.displayName).toBe('KH thử 1');
  });
  it('rejects a malformed or duplicate identifier (TC-06 / TC-08)', async () => {
    const a = as('acc-sale-a');
    expect(await code(a.createCustomer({ customerType: 'COMPANY', displayName: 'x', legalIdentifierType: 'VN_TAX_ID', legalIdentifier: '123' }))).toBe('CM_VALIDATION_FAILED');
    expect(await code(a.createCustomer({ customerType: 'COMPANY', displayName: 'x', legalIdentifierType: 'VN_TAX_ID', legalIdentifier: '0100000001' }))).toBe('CM_IDENTITY_DUPLICATE');
  });
  it('rejects a ward outside the province (TC-09)', async () => {
    expect(await code(as('acc-sale-a').createCustomer({ customerType: 'COMPANY', displayName: 'x', provinceCode: '01', wardCode: '25747' }))).toBe('CM_INVALID_PROVINCE_WARD');
  });
  it('verify needs the full legal data, then turns DRAFT into VERIFIED (TC-03 / TC-04)', async () => {
    const m = as('acc-mgr');
    const { customer } = await m.createCustomer({ customerType: 'COMPANY', displayName: 'KH xác minh' });
    expect(await code(m.verifyCustomer(customer.customerId, {}))).toBe('CM_VALIDATION_FAILED');
    const v = await m.verifyCustomer(customer.customerId, { legalName: 'CÔNG TY MẪU XÁC MINH', legalIdentifierType: 'VN_TAX_ID', legalIdentifier: '0109999999',
      addressLine: 'Số 1', provinceCode: '01', wardCode: '00004' });
    expect(v.recordStatus).toBe('VERIFIED');
    expect(v.customerStatus).toBe('PROSPECT'); // independent relationship status
    expect(await code(m.verifyCustomer(customer.customerId, {}))).toBe('CM_ALREADY_VERIFIED');
  });
  it('a sale without READ_ALL only sees assigned customers; unknown ids are not disclosed (TC-13)', async () => {
    const c = as('acc-sale-c');
    const visible = await c.visibleCustomers();
    expect(visible.every((x) => x.customerId !== 'cus-001')).toBe(true);
    expect(await code(c.customerBundle('cus-001'))).toBe('CM_CUSTOMER_NOT_FOUND');
    expect((await as('acc-mgr').customerBundle('cus-001')).customer.customerId).toBe('cus-001');
  });
  it('export needs crm.customer.export (TC-17)', async () => {
    expect(await code(as('acc-sale-a').exportCustomersCsv({}))).toBe('FORBIDDEN');
    expect((await as('acc-mgr').exportCustomersCsv({})).split('\r\n')[0]).toContain('customer_code');
  });
});

describe('assignments and handovers (BR-01 / 09 / 10 / 11)', () => {
  it('one PRIMARY, many SUPPORT, never the same sale twice (TC-25 / TC-26)', async () => {
    const m = as('acc-mgr');
    expect(await code(m.addAssignment('cus-002', 'acc-sale-c', 'PRIMARY'))).toBe('CM_ASSIGNMENT_CONFLICT');
    await m.addAssignment('cus-002', 'acc-sale-c', 'SUPPORT');
    expect(await code(m.addAssignment('cus-002', 'acc-sale-c', 'SUPPORT'))).toBe('CM_ASSIGNMENT_CONFLICT');
  });
  it('flow B: sale proposes, manager approves, receiver completes; only OPEN activities of the old sale move (TC-28 / 30 / 31)', async () => {
    // cus-001 (seed): PRIMARY sale A, SUPPORT sale B. One adapter, accounts switched, so all steps share the same state.
    const a = as('acc-sale-a');
    a.switchAccount('acc-mgr');
    await a.addAssignment('cus-001', 'acc-sale-c', 'SUPPORT');
    await a.createActivity('cus-001', { activityType: 'FOLLOW_UP', title: 'Việc của Sale hỗ trợ', assignedToAccountId: 'acc-sale-c' });
    a.switchAccount('acc-sale-a');
    const h = await a.requestHandover('cus-001', 'SALE_INITIATED', 'acc-sale-c');
    expect(h.status).toBe('PENDING_APPROVAL');
    expect(await code(a.approveHandover(h.handoverId))).toBe('FORBIDDEN');
    a.switchAccount('acc-mgr');
    expect((await a.approveHandover(h.handoverId)).status).toBe('PENDING_RECEIVER_ACK');
    a.switchAccount('acc-sale-b');
    expect(await code(a.acknowledgeHandover(h.handoverId))).toBe('CM_PERMISSION_DENIED');
    a.switchAccount('acc-sale-c');
    const done = await a.acknowledgeHandover(h.handoverId);
    expect(done.status).toBe('COMPLETED');
    const b = await a.customerBundle('cus-001');
    const active = b.assignments.filter((x) => x.endedAt === null);
    expect(active.filter((x) => x.role === 'PRIMARY').map((x) => x.saleAccountId)).toEqual(['acc-sale-c']);
    expect(active.some((x) => x.saleAccountId === 'acc-sale-c' && x.role === 'SUPPORT')).toBe(false); // receiver's SUPPORT closed
    expect(b.activities.find((x) => x.title === 'Việc của Sale hỗ trợ')?.assignedToAccountId).toBe('acc-sale-c');
    expect(done.transferredActivityIds.length).toBeGreaterThan(0);
  });
  it('flow A with override only when the current sale is no longer active (D05)', async () => {
    const a = as('acc-mgr');
    const h = await a.requestHandover('cus-012', 'MANAGER_INITIATED', 'acc-sale-b'); // cus-012 PRIMARY = inactive acc-sale-x
    expect(h.status).toBe('PENDING_CURRENT_ACK');
    expect((await a.acknowledgeHandover(h.handoverId, 'Sale đã nghỉ việc')).status).toBe('PENDING_RECEIVER_ACK');
    const h2 = await a.requestHandover('cus-003', 'MANAGER_INITIATED', 'acc-sale-b'); // cus-003 PRIMARY = active sale C
    expect(await code(a.acknowledgeHandover(h2.handoverId, 'thử override'))).toBe('CM_HANDOVER_INVALID_STATE');
  });
  it('a second open handover for the same customer is refused (TC-32 at rule level)', async () => {
    const m = as('acc-mgr');
    expect(await code(m.requestHandover('cus-007', 'MANAGER_INITIATED', 'acc-sale-b'))).toBe('CM_HANDOVER_INVALID_STATE'); // seed has one open
  });
});

describe('legal change — two decisions, no self approval (BR-03)', () => {
  it('management then accounting applies the snapshot; customer unchanged before accounting (TC-21 / TC-22 / TC-23)', async () => {
    const a = as('acc-sale-b');
    expect(await code(a.decideLegalChange('lgc-001', 'MANAGEMENT', 'APPROVED'))).toBe('FORBIDDEN');
    a.switchAccount('acc-mgr');
    expect((await a.decideLegalChange('lgc-001', 'MANAGEMENT', 'APPROVED')).status).toBe('PENDING_ACCOUNTING');
    expect((await a.customerBundle('cus-002')).customer.legalName).toBe('Công ty CP Thử Nghiệm Bình Minh');
    a.switchAccount('acc-acc');
    const l = await a.decideLegalChange('lgc-001', 'ACCOUNTING', 'APPROVED');
    expect(l.status).toBe('APPLIED');
    expect((await a.customerBundle('cus-002')).customer.legalName).toBe('Công ty CP Thử Nghiệm Bình Minh Mới');
  });
  it('requester cannot approve own request; DRAFT is not eligible; one pending request per customer (TC-24)', async () => {
    const m = as('acc-mgr');
    const l = await m.requestLegalChange('cus-001', { reason: 'Đổi tên', evidenceDocumentId: 'doc-cus-001-1', newLegalName: 'Tên mới', newCustomerType: 'COMPANY',
      newIdentifierType: 'VN_TAX_ID', newIdentifier: '0100000001', newCountryCode: 'VN' });
    expect(await code(m.decideLegalChange(l.changeRequestId, 'MANAGEMENT', 'APPROVED'))).toBe('CM_SELF_APPROVAL_FORBIDDEN');
    expect(await code(m.requestLegalChange('cus-001', { reason: 'lần 2', evidenceDocumentId: 'doc-cus-001-1', newLegalName: 'Tên khác', newCustomerType: 'COMPANY',
      newIdentifierType: 'VN_TAX_ID', newIdentifier: '0100000001', newCountryCode: 'VN' }))).toBe('CM_LEGAL_CHANGE_PENDING');
    const { customer } = await m.createCustomer({ customerType: 'COMPANY', displayName: 'DRAFT' });
    expect(await code(m.requestLegalChange(customer.customerId, { reason: 'x', evidenceDocumentId: 'none', newLegalName: 'x', newCustomerType: 'COMPANY',
      newIdentifierType: 'VN_TAX_ID', newIdentifier: '0100009999', newCountryCode: 'VN' }))).toBe('CM_DRAFT_NOT_ELIGIBLE');
  });
});

describe('appointments, tasks and reports are distinct objects', () => {
  it('appointments need end > start, appear for the customer, can be cancelled with a reason and remind in-app', async () => {
    const a = as('acc-sale-a');
    const start = new Date(Date.now() + 20 * 60_000);
    expect(await code(a.createAppointment({ title: 'x', customerId: null, startAt: start.toISOString(), endAt: start.toISOString() }))).toBe('CM_VALIDATION_FAILED');
    const apt = await a.createAppointment({ title: 'Gặp KH', customerId: 'cus-001', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), remindMinutes: 30 });
    expect((await a.customerBundle('cus-001')).appointments.some((x) => x.appointmentId === apt.appointmentId)).toBe(true);
    expect((await a.dueReminders(new Date())).some((r) => r.appointment.appointmentId === apt.appointmentId)).toBe(true);
    await a.dismissReminder(apt.appointmentId);
    expect((await a.dueReminders(new Date())).some((r) => r.appointment.appointmentId === apt.appointmentId)).toBe(false);
    expect(await code(a.cancelAppointment(apt.appointmentId, ' '))).toBe('CM_VALIDATION_FAILED');
    expect((await a.cancelAppointment(apt.appointmentId, 'Khách bận')).status).toBe('CANCELLED');
  });
  it('tasks: overdue filter, progress moves TODO → IN_PROGRESS, done is final', async () => {
    const a = as('acc-sale-a');
    expect((await a.listTasks({ mineOnly: true, overdueOnly: true })).map((t) => t.taskId)).toContain('tsk-002');
    const t = await a.createTask({ title: 'Việc mới', customerId: 'cus-001' });
    expect((await a.updateTask(t.taskId, { progress: 40 })).status).toBe('IN_PROGRESS');
    expect((await a.completeTask(t.taskId)).progress).toBe(100);
    expect(await code(a.updateTask(t.taskId, { title: 'sửa' }))).toBe('CM_VALIDATION_FAILED');
  });
  it('reports: draft → submit; a submitted report is read-only; managers see submitted reports of others', async () => {
    const a = as('acc-sale-a');
    expect(await code(a.createReport({ workDate: '2026-10-30', workDone: '', results: 'x' }))).toBe('CM_VALIDATION_FAILED');
    const r = await a.createReport({ workDate: '2026-10-30', workDone: 'Gặp 2 khách', results: 'Hẹn demo', taskIds: ['tsk-001'] });
    expect((await a.submitReport(r.reportId)).status).toBe('SUBMITTED');
    expect(await code(a.updateReport(r.reportId, { results: 'x' }))).toBe('CM_VALIDATION_FAILED');
    a.switchAccount('acc-mgr');
    expect((await a.listReports({})).some((x) => x.reportId === r.reportId)).toBe(true);
    a.switchAccount('acc-sale-c');
    expect((await a.listReports({})).some((x) => x.reportId === r.reportId)).toBe(false);
  });
});
