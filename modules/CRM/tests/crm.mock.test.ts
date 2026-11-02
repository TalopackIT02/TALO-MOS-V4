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
    expect(await code(as('acc-sale-a').exportCustomersCsv({}))).toBe('CM_PERMISSION_DENIED');
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
    expect(await code(a.approveHandover(h.handoverId))).toBe('CM_PERMISSION_DENIED');
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
    expect(await code(a.decideLegalChange('lgc-001', 'MANAGEMENT', 'APPROVED'))).toBe('CM_PERMISSION_DENIED');
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
    expect(await code(m.decideLegalChange(l.changeRequestId, 'MANAGEMENT', 'APPROVED'))).toBe('CM_PERMISSION_DENIED'); // has the permission: denied by the no-self-approval rule (REV01 403)
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
    const end = new Date(start.getTime() + 3_600_000).toISOString();
    expect(await code(a.createAppointment({ title: 'x', customerId: 'cus-004', contactId: 'con-cus-001-1', startAt: start.toISOString(), endAt: end }))).toBe('CM_VALIDATION_FAILED');
    expect((await a.createAppointment({ title: 'Gặp liên hệ', customerId: 'cus-001', contactId: 'con-cus-001-1', startAt: start.toISOString(), endAt: end })).contactId).toBe('con-cus-001-1');
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

describe('Gate 1 alignment — create form, list view, scope, handover To-do, reports', () => {
  it('composite create (4 groups) is all-or-nothing: an invalid contact rolls back the customer (GAP-API-01 mock transaction)', async () => {
    const m = as('acc-mgr');
    const before = (await m.listCustomers({ includeHidden: true, pageSize: 100 })).total;
    expect(await code(m.createCustomerFull({ customer: { customerType: 'COMPANY', displayName: 'KH lỗi liên hệ' }, contacts: [{ fullName: 'Anh Tư' }],
      primarySaleAccountId: 'acc-sale-b', supportSaleAccountIds: [], groupIds: [], verify: false }))).toBe('CM_VALIDATION_FAILED');
    expect((await m.listCustomers({ includeHidden: true, pageSize: 100 })).total).toBe(before);
    const { customer } = await m.createCustomerFull({ customer: { customerType: 'COMPANY', displayName: 'KH đủ 4 nhóm' },
      contacts: [{ fullName: 'Chị Năm', phone: '0900000005', isPrimary: true }], primarySaleAccountId: 'acc-sale-b', supportSaleAccountIds: ['acc-sale-c'],
      groupIds: ['grp-fnb'], verify: false });
    const b = await m.customerBundle(customer.customerId);
    expect(b.customer.primarySaleAccountId).toBe('acc-sale-b');
    expect(b.customer.supportSaleAccountIds).toEqual(['acc-sale-c']);
    expect(b.contacts.map((c) => c.fullName)).toEqual(['Chị Năm']);
    expect(b.customer.recordStatus).toBe('DRAFT');
  });
  it('composite create checks each permission: a sale cannot choose the primary sale (BR-01)', async () => {
    expect(await code(as('acc-sale-a').createCustomerFull({ customer: { customerType: 'COMPANY', displayName: 'x' }, contacts: [],
      primarySaleAccountId: 'acc-sale-b', supportSaleAccountIds: [], groupIds: [], verify: false }))).toBe('CM_PERMISSION_DENIED');
  });
  it('list view derives region / macro region and sale roles, and filters by them', async () => {
    const m = as('acc-mgr');
    const south = await m.listCustomers({ macroRegionCode: 'SOUTH', pageSize: 100 });
    expect(south.total).toBeGreaterThan(0);
    expect(south.items.every((c) => c.macroRegionCode === 'SOUTH')).toBe(true);
    const rrd = await m.listCustomers({ regionCode: 'RRD', pageSize: 100 });
    expect(rrd.items.every((c) => c.regionCode === 'RRD')).toBe(true);
    const supportB = await m.listCustomers({ saleAccountId: 'acc-sale-b', saleRole: 'SUPPORT', pageSize: 100 });
    expect(supportB.total).toBeGreaterThan(0);
    expect(supportB.items.every((c) => c.supportSaleAccountIds.includes('acc-sale-b'))).toBe(true);
    const desc = await m.listCustomers({ sort: 'code', sortDir: 'desc', pageSize: 5 });
    expect(desc.items.map((c) => c.customerCode)).toEqual([...desc.items.map((c) => c.customerCode)].sort().reverse());
  });
  it('identifier is masked for a viewer without crm.legal_change.read in list and profile; viewer stays in its scope and read-only (proposal OD-05)', async () => {
    const v = as('acc-viewer');
    const own = (await v.listCustomers({ pageSize: 100 })).items;
    expect(own.map((c) => c.customerId).sort()).toEqual(['cus-001', 'cus-004']); // scope: only supported customers
    const c1 = (await v.customerBundle('cus-001')).customer;
    expect(c1.identifierMasked).toBe(true);
    expect(c1.legalIdentifier).not.toBe('0100000001');
    expect(c1.legalIdentifier?.endsWith('001')).toBe(true);
    expect((await v.visibleCustomers()).every((c) => (c as { identifierMasked?: boolean }).identifierMasked !== false || c.legalIdentifier === null)).toBe(true);
    expect(await code(v.customerBundle('cus-002'))).toBe('CM_CUSTOMER_NOT_FOUND');
    expect(await code(v.updateCustomer('cus-001', { displayName: 'x' }))).toBe('CM_PERMISSION_DENIED');
    expect(await code(v.createCustomer({ customerType: 'COMPANY', displayName: 'x' }))).toBe('CM_PERMISSION_DENIED'); // TC-16
    expect((await as('acc-mgr').customerBundle('cus-001')).customer.legalIdentifier).toBe('0100000001');
  });
  it('FE-FIX-02: handover moves OPEN activities (REV01) and open To-dos of the old sale (Target Design) with history', async () => {
    // hdv-001 (seed): cus-007, current sale A → receiver C, PENDING_APPROVAL; tsk-007 is A's open To-do for cus-007.
    const a = as('acc-sale-a');
    await a.createActivity('cus-007', { activityType: 'FOLLOW_UP', title: 'Việc OPEN của Sale A', assignedToAccountId: 'acc-sale-a' });
    const doneTask = await a.createTask({ title: 'Việc đã xong', customerId: 'cus-007' });
    await a.completeTask(doneTask.taskId);
    const otherCustomer = await a.createTask({ title: 'Việc của khách khác', customerId: 'cus-001' });
    a.switchAccount('acc-mgr');
    await a.approveHandover('hdv-001');
    a.switchAccount('acc-sale-c');
    const h = await a.acknowledgeHandover('hdv-001');
    expect(h.status).toBe('COMPLETED');
    expect(h.transferredTaskIds).toContain('tsk-007');
    expect(h.transferredTaskIds).not.toContain(doneTask.taskId);
    expect(h.transferredTaskIds).not.toContain(otherCustomer.taskId);
    const t = (await a.listTasks({ customerId: 'cus-007' })).find((x) => x.taskId === 'tsk-007');
    expect(t?.assigneeAccountId).toBe('acc-sale-c');
    expect(t?.history.at(-1)).toMatchObject({ fromAccountId: 'acc-sale-a', toAccountId: 'acc-sale-c', reason: 'HANDOVER', handoverId: 'hdv-001' });
    const b = await a.customerBundle('cus-007');
    expect(b.activities.find((x) => x.title === 'Việc OPEN của Sale A')?.assignedToAccountId).toBe('acc-sale-c');
    expect(b.customer.primarySaleAccountId).toBe('acc-sale-c');
    a.switchAccount('acc-sale-a');
    expect(await code(a.customerBundle('cus-007'))).toBe('CM_CUSTOMER_NOT_FOUND'); // old sale loses scope after handover
  });
  it('reassigning a task records history; reports appear in the customer bundle and can be filtered by customer', async () => {
    const m = as('acc-mgr');
    const t = await m.createTask({ title: 'Giao lại', customerId: 'cus-001', assigneeAccountId: 'acc-sale-a' });
    const u = await m.updateTask(t.taskId, { assigneeAccountId: 'acc-sale-b' });
    expect(u.history.at(-1)).toMatchObject({ fromAccountId: 'acc-sale-a', toAccountId: 'acc-sale-b', reason: 'REASSIGN' });
    expect((await m.customerBundle('cus-010')).reports.map((r) => r.reportId)).toContain('rpt-001');
    expect((await m.listReports({ customerId: 'cus-002' })).map((r) => r.reportId)).toEqual(['rpt-002']);
    const a = as('acc-sale-a');
    const draft = await a.createReport({ workDate: '2026-10-30', workDone: 'Nháp', results: 'x', customerIds: ['cus-001'] });
    expect((await a.customerBundle('cus-001')).reports.some((r) => r.reportId === draft.reportId)).toBe(true);
    expect((await m.customerBundle('cus-001')).reports.some((r) => r.reportId === draft.reportId)).toBe(false); // drafts stay private
  });
});

describe('UI-18 — restore sample data', () => {
  it('reset() drops every mock change and restores the seed, keeping the selected persona', async () => {
    const m = as('acc-mgr');
    const seedTotal = (await m.listCustomers({ includeHidden: true, pageSize: 100 })).total;
    await m.createCustomer({ customerType: 'COMPANY', displayName: 'KH sẽ bị xóa' });
    const t = await m.createTask({ title: 'Việc sẽ bị xóa', customerId: null });
    await m.decideLegalChange('lgc-001', 'MANAGEMENT', 'APPROVED');
    m.reset();
    expect((await m.listCustomers({ includeHidden: true, pageSize: 100 })).total).toBe(seedTotal);
    expect((await m.listTasks({})).some((x) => x.taskId === t.taskId)).toBe(false);
    expect((await m.listLegalChanges()).find((l) => l.changeRequestId === 'lgc-001')?.status).toBe('PENDING_MANAGEMENT');
    expect((await m.session()).account.accountId).toBe('acc-mgr');
  });
});

describe('Gate 1 closeout — identifier search control (proposal OD-05 right = crm.legal_change.read)', () => {
  it('without the right to view the full identifier, the identifier is not a search field (no exact or partial match)', async () => {
    const v = as('acc-viewer'); // in scope: cus-001 (0100000001), cus-004
    expect((await v.listCustomers({ q: '0100000001', pageSize: 100 })).total).toBe(0);
    expect((await v.listCustomers({ q: '00000001', pageSize: 100 })).total).toBe(0);
    expect((await v.listCustomers({ q: '000001', pageSize: 100 })).items.map((c) => c.customerId)).toEqual(['cus-001']); // code still searchable
    expect((await v.listCustomers({ q: '000001', pageSize: 100 })).items[0]?.legalIdentifier).not.toBe('0100000001');
  });
  it('with the right, searching by identifier works but only inside the object scope', async () => {
    expect((await as('acc-mgr').listCustomers({ q: '0100000001', pageSize: 100 })).items.map((c) => c.customerId)).toEqual(['cus-001']);
    const c = as('acc-sale-c'); // has crm.legal_change.read, cus-001 is NOT in its scope
    expect((await c.listCustomers({ q: '0100000001', pageSize: 100 })).total).toBe(0);
  });
  it('similar-name warnings never count customers outside the scope; a duplicate identifier only returns a yes/no (BR-06)', async () => {
    const c = as('acc-sale-c');
    const r = await c.checkIdentity('VN_TAX_ID', '0100000001', 'VN', 'Mẫu An Phát');
    expect(r.duplicate).toBe(true); // uniqueness must be enforced globally — no code, name or id is returned
    expect(Object.keys(r).sort()).toEqual(['duplicate', 'normalized', 'similarNameCount']);
    expect(r.similarNameCount).toBe(0); // cus-001 'Mẫu An Phát' is outside sale C's scope
    expect((await as('acc-mgr').checkIdentity('VN_TAX_ID', '0109999998', 'VN', 'Mẫu An Phát')).similarNameCount).toBe(1);
    expect((await c.createCustomer({ customerType: 'COMPANY', displayName: 'Mẫu An Phát' })).warnings).toEqual([]);
  });
});

describe('Gate 1 closeout — Audit Demo and finished handovers (mock only)', () => {
  it('records successful writes with actor and action code, without PII; a rolled-back transaction leaves no entry; reset clears it', async () => {
    const m = as('acc-mgr');
    const { customer } = await m.createCustomer({ customerType: 'COMPANY', displayName: 'KH audit demo' });
    await m.verifyCustomer(customer.customerId, { legalName: 'CÔNG TY AUDIT', legalIdentifierType: 'VN_TAX_ID', legalIdentifier: '0109999997', addressLine: 'Số 1', provinceCode: '01', wardCode: '00004' });
    const log = m.auditLog();
    expect(log[0]).toMatchObject({ action: 'CRM.CUSTOMER.VERIFY', actorAccountId: 'acc-mgr', objectType: 'customer', objectId: customer.customerId });
    expect(log[1]).toMatchObject({ action: 'CRM.CUSTOMER.CREATE', objectId: customer.customerId });
    expect(JSON.stringify(log)).not.toContain('AUDIT'); // no names / identifiers in the log
    expect(JSON.stringify(log)).not.toContain('0109999997');
    const before = m.auditLog().length;
    expect(await code(m.createCustomerFull({ customer: { customerType: 'COMPANY', displayName: 'x' }, contacts: [{ fullName: 'Thiếu số' }],
      primarySaleAccountId: null, supportSaleAccountIds: [], groupIds: [], verify: false }))).toBe('CM_VALIDATION_FAILED');
    expect(m.auditLog().length).toBe(before);
    expect(await code(m.exportCustomersCsv({}))).toBe('OK');
    expect(m.auditLog()[0]?.action).toBe('CRM.CUSTOMER.EXPORT');
    const start = new Date(Date.now() + 3_600_000);
    const apt = await m.createAppointment({ title: 'Audit lịch', customerId: 'cus-001', contactId: 'con-cus-001-1', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString() });
    expect(m.auditLog()[0]).toMatchObject({ action: 'CRM.APPOINTMENT.CREATE (mock)', objectType: 'appointment', objectId: apt.appointmentId });
    await m.setCustomerGroups('cus-001', ['grp-fnb']);
    expect(m.auditLog()[0]).toMatchObject({ action: 'CRM.GROUP.ASSIGN', objectType: 'customer', objectId: 'cus-001' });
    m.reset();
    expect(m.auditLog()).toEqual([]);
  });
  it('audits an override with its own action code, and lists the finished handover for participants and in-scope users', async () => {
    const m = as('acc-mgr');
    const h = await m.requestHandover('cus-012', 'MANAGER_INITIATED', 'acc-sale-b'); // current PRIMARY inactive
    await m.acknowledgeHandover(h.handoverId, 'Sale đã nghỉ việc');
    expect(m.auditLog()[0]).toMatchObject({ action: 'CRM.HANDOVER.OVERRIDE', objectType: 'handover', objectId: h.handoverId, detail: 'override' });
    m.switchAccount('acc-sale-b');
    await m.acknowledgeHandover(h.handoverId);
    expect((await m.listHandovers()).find((x) => x.handoverId === h.handoverId)?.status).toBe('COMPLETED');
    m.switchAccount('acc-mgr');
    expect((await m.listHandovers()).some((x) => x.handoverId === h.handoverId && x.status === 'COMPLETED')).toBe(true);
    m.switchAccount('acc-sale-a'); // not a participant, customer not in scope
    expect((await m.listHandovers()).some((x) => x.handoverId === h.handoverId)).toBe(false);
  });
});
