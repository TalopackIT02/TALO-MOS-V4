import type {
  Account, Activity, Appointment, Assignment, Contact, CrmDocument, Customer, CustomerStatus, CustomerType, Group, Handover, LegalChange, Permission,
  Province, Task, WorkReport,
} from '../types/domain';

// MOCK SEED — synthetic data only (no real company / person / tax id). Reference provinces / wards are a sample of the
// public cm_ref_* seed of talo_mos_v4_test (read-only extract, 2026-10-30). Dates are relative to "now" so that the
// calendar, tasks and reports always show current data during acceptance.

export const PROVINCES: Province[] = [
  { code: '01', name: 'Hà Nội', region: 'RRD', macro: 'NORTH', wards: [{ code: '00004', name: 'Phường Ba Đình' }, { code: '00008', name: 'Phường Ngọc Hà' }, { code: '00025', name: 'Phường Giảng Võ' }, { code: '00070', name: 'Phường Hoàn Kiếm' }, { code: '00082', name: 'Phường Cửa Nam' }] },
  { code: '31', name: 'Hải Phòng', region: 'RRD', macro: 'NORTH', wards: [{ code: '10507', name: 'Phường Thành Đông' }, { code: '10525', name: 'Phường Hải Dương' }, { code: '10532', name: 'Phường Lê Thanh Nghị' }, { code: '10537', name: 'Phường Tân Hưng' }, { code: '10543', name: 'Phường Việt Hòa' }] },
  { code: '48', name: 'Đà Nẵng', region: 'S_CENTRAL_HIGHLANDS', macro: 'CENTRAL', wards: [{ code: '20194', name: 'Phường Hải Vân' }, { code: '20197', name: 'Phường Liên Chiểu' }, { code: '20200', name: 'Phường Hòa Khánh' }, { code: '20209', name: 'Phường Thanh Khê' }, { code: '20242', name: 'Phường Hải Châu' }] },
  { code: '75', name: 'Đồng Nai', region: 'SOUTHEAST', macro: 'SOUTH', wards: [{ code: '25195', name: 'Phường Bình Phước' }, { code: '25210', name: 'Phường Đồng Xoài' }, { code: '25217', name: 'Phường Phước Long' }, { code: '25220', name: 'Phường Phước Bình' }, { code: '25222', name: 'Xã Bù Gia Mập' }] },
  { code: '79', name: 'Hồ Chí Minh', region: 'SOUTHEAST', macro: 'SOUTH', wards: [{ code: '25747', name: 'Phường Thủ Dầu Một' }, { code: '25750', name: 'Phường Phú Lợi' }, { code: '25760', name: 'Phường Bình Dương' }, { code: '25768', name: 'Phường Phú An' }, { code: '25771', name: 'Phường Chánh Hiệp' }] },
  { code: '92', name: 'Cần Thơ', region: 'MEKONG', macro: 'SOUTH', wards: [{ code: '31120', name: 'Phường Cái Khế' }, { code: '31135', name: 'Phường Ninh Kiều' }, { code: '31147', name: 'Phường Tân An' }, { code: '31150', name: 'Phường An Bình' }, { code: '31153', name: 'Phường Ô Môn' }] },
];

export const ACCOUNTS: Account[] = [
  { accountId: 'acc-sale-a', fullName: 'Nguyễn Văn An', title: 'Sale', active: true },
  { accountId: 'acc-sale-b', fullName: 'Trần Thị Bình', title: 'Sale', active: true },
  { accountId: 'acc-sale-c', fullName: 'Lê Minh Cường', title: 'Sale', active: true },
  { accountId: 'acc-mgr', fullName: 'Phạm Quốc Dũng', title: 'Quản lý kinh doanh', active: true },
  { accountId: 'acc-acc', fullName: 'Hoàng Thu Hà', title: 'Kế toán', active: true },
  { accountId: 'acc-sale-x', fullName: 'Đỗ Văn Khôi', title: 'Sale (đã nghỉ việc)', active: false },
];

const SALE: Permission[] = ['crm.customer.read', 'crm.customer.create', 'crm.customer.update', 'crm.legal_change.read', 'crm.legal_change.request',
  'crm.contact.read', 'crm.contact.manage', 'crm.group.read', 'crm.group.assign', 'crm.assignment.read', 'crm.handover.request', 'crm.handover.acknowledge',
  'crm.handover.reject', 'crm.activity.read', 'crm.activity.create', 'crm.activity.update', 'crm.activity.complete', 'crm.document.read',
  'crm.document.manage', 'crm.reference.read'];
const MANAGER: Permission[] = [...SALE, 'crm.customer.read_all', 'crm.customer.verify', 'crm.customer.hide', 'crm.customer.export',
  'crm.legal_change.approve_management', 'crm.group.manage', 'crm.assignment.manage', 'crm.handover.approve', 'crm.handover.override'];
const ACCOUNTANT: Permission[] = ['crm.customer.read', 'crm.customer.read_all', 'crm.legal_change.read', 'crm.legal_change.approve_accounting',
  'crm.contact.read', 'crm.group.read', 'crm.assignment.read', 'crm.activity.read', 'crm.document.read', 'crm.reference.read', 'crm.customer.export'];

// Mock IAM: effective permissions per synthetic account (the real values come from IAM after the registration gate).
export const MOCK_PERMISSIONS: Record<string, Permission[]> = {
  'acc-sale-a': SALE, 'acc-sale-b': SALE, 'acc-sale-c': SALE, 'acc-mgr': MANAGER, 'acc-acc': ACCOUNTANT, 'acc-sale-x': [],
};

export interface MockState {
  version: number;
  seq: number;
  customers: Customer[];
  contacts: Contact[];
  groups: Group[];
  assignments: Assignment[];
  handovers: Handover[];
  legalChanges: LegalChange[];
  activities: Activity[];
  documents: CrmDocument[];
  appointments: Appointment[];
  tasks: Task[];
  reports: WorkReport[];
  dismissedReminders: string[];
}

export const MOCK_VERSION = 3;

const day = 24 * 3600 * 1000;
const at = (base: Date, days: number, hour = 9, minute = 0): string => {
  const d = new Date(base.getTime() + days * day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (base: Date, days: number): string => {
  const d = new Date(base.getTime() + days * day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const NAMES: [string, CustomerType, CustomerStatus, string][] = [
  ['Công ty TNHH Mẫu An Phát', 'COMPANY', 'ACTIVE', '01'], ['Công ty CP Thử Nghiệm Bình Minh', 'COMPANY', 'ACTIVE', '79'],
  ['Công ty TNHH Bao Bì Mẫu Cát Tường', 'COMPANY', 'NEW', '75'], ['Chi nhánh Mẫu Đông Á – Đà Nẵng', 'BRANCH', 'ACTIVE', '48'],
  ['Hộ kinh doanh Mẫu Gia Huy', 'HOUSEHOLD', 'PROSPECT', '92'], ['Công ty TNHH Mẫu Hải Long', 'COMPANY', 'PROSPECT', '31'],
  ['Công ty CP Mẫu Khang Thịnh', 'COMPANY', 'ACTIVE', '01'], ['Công ty TNHH Mẫu Lộc Phát', 'COMPANY', 'PAUSED', '79'],
  ['Cá nhân Mẫu Trần Minh', 'PERSON', 'PROSPECT', '79'], ['Công ty TNHH Mẫu Nam Việt', 'COMPANY', 'ACTIVE', '75'],
  ['Công ty CP Mẫu Phú Quý', 'COMPANY', 'NEW', '48'], ['Công ty TNHH Mẫu Quang Minh', 'COMPANY', 'ACTIVE', '01'],
  ['Sample Trading Pte (mẫu)', 'FOREIGN_NO_VN_REG', 'PROSPECT', ''], ['Công ty TNHH Mẫu Sao Việt', 'COMPANY', 'ACTIVE', '31'],
  ['Công ty CP Mẫu Tân Tiến', 'COMPANY', 'CLOSED', '92'], ['Công ty TNHH Mẫu Thành Công', 'COMPANY', 'ACTIVE', '79'],
  ['Hộ kinh doanh Mẫu Uyên Linh', 'HOUSEHOLD', 'NEW', '01'], ['Công ty TNHH Mẫu Vạn Xuân', 'COMPANY', 'PROSPECT', '75'],
  ['Công ty CP Mẫu Xuân Mai', 'COMPANY', 'ACTIVE', '48'], ['Công ty TNHH Mẫu Yên Bình', 'COMPANY', 'ACTIVE', '92'],
  ['Công ty TNHH Mẫu Á Châu', 'COMPANY', 'NEW', '01'], ['Công ty CP Mẫu Bắc Sơn', 'COMPANY', 'PROSPECT', '31'],
  ['Công ty TNHH Mẫu Cửu Long', 'COMPANY', 'ACTIVE', '92'], ['Công ty TNHH Mẫu Đại Dương', 'COMPANY', 'ACTIVE', '79'],
];

export function seedState(now = new Date()): MockState {
  const customers: Customer[] = [];
  const contacts: Contact[] = [];
  const assignments: Assignment[] = [];
  const activities: Activity[] = [];
  const documents: CrmDocument[] = [];
  const owners = ['acc-sale-a', 'acc-sale-b', 'acc-sale-c'];
  NAMES.forEach(([name, type, status, province], i) => {
    const id = `cus-${String(i + 1).padStart(3, '0')}`;
    const p = PROVINCES.find((x) => x.code === province);
    const ward = p?.wards[i % p.wards.length];
    const verified = i % 3 !== 2 && type !== 'HOUSEHOLD' && status !== 'PROSPECT';
    const foreign = type === 'FOREIGN_NO_VN_REG';
    const addressLine = `Số ${10 + i} đường Mẫu ${i + 1}`;
    customers.push({
      customerId: id, customerCode: String(i + 1).padStart(6, '0'), displayName: name.replace(/^Công ty (TNHH|CP) /, ''),
      legalName: verified || i % 2 === 0 ? name : null, customerType: type, customerStatus: status, recordStatus: verified ? 'VERIFIED' : 'DRAFT',
      legalIdentifierType: foreign ? 'FOREIGN_REG' : verified ? 'VN_TAX_ID' : null,
      legalIdentifier: foreign ? 'SGMAU0001' : verified ? `01000${String(i + 1).padStart(5, '0')}` : null,
      representativeName: `Người đại diện mẫu ${i + 1}`, representativePhone: `09000000${String(i).padStart(2, '0')}`,
      addressLine: verified || foreign ? addressLine : i % 2 === 0 ? addressLine : null, provinceCode: foreign ? null : province || null,
      wardCode: foreign ? null : verified ? ward?.code ?? null : null, countryCode: foreign ? 'SG' : 'VN', foreignLocality: foreign ? 'Singapore' : null,
      foreignStateProvince: null, registeredAddress: null, internalNote: null, isHidden: false, groupIds: [],
      createdAt: at(now, -120 + i * 3), createdAccountId: owners[i % 3] ?? 'acc-sale-a', updatedAt: null,
    });
    assignments.push({ assignmentId: `asg-${id}-p`, customerId: id, saleAccountId: owners[i % 3] ?? 'acc-sale-a', role: 'PRIMARY', assignedAt: at(now, -110 + i * 3),
      assignedByAccountId: 'acc-mgr', endedAt: null, endedByAccountId: null, handoverToAccountId: null });
    if (i % 4 === 0) assignments.push({ assignmentId: `asg-${id}-s`, customerId: id, saleAccountId: owners[(i + 1) % 3] ?? 'acc-sale-b', role: 'SUPPORT',
      assignedAt: at(now, -100 + i * 3), assignedByAccountId: 'acc-mgr', endedAt: null, endedByAccountId: null, handoverToAccountId: null });
    contacts.push({ contactId: `con-${id}-1`, customerId: id, fullName: `Liên hệ mẫu ${i + 1}`, positionTitle: 'Trưởng phòng mua hàng',
      phone: `09110000${String(i).padStart(2, '0')}`, zaloPhone: null, email: `lienhe${i + 1}@example.test`, isPrimary: true, isActive: true });
    activities.push({ activityId: `act-${id}-1`, customerId: id, activityType: i % 2 ? 'CALL' : 'MEETING', activityStatus: 'DONE',
      title: i % 2 ? 'Gọi giới thiệu sản phẩm' : 'Gặp khảo sát nhu cầu', description: 'Khách quan tâm bao bì carton 3 lớp (dữ liệu mẫu).',
      occurredAt: at(now, -(i % 9) - 1, 10), dueAt: null, assignedToAccountId: owners[i % 3] ?? null, createdByAccountId: owners[i % 3] ?? 'acc-sale-a', completedAt: at(now, -(i % 9) - 1, 11) });
    if (i % 3 === 0) activities.push({ activityId: `act-${id}-2`, customerId: id, activityType: 'FOLLOW_UP', activityStatus: 'OPEN',
      title: 'Theo dõi phản hồi báo giá', description: null, occurredAt: at(now, -1, 15), dueAt: at(now, 2 + (i % 4), 17), assignedToAccountId: owners[i % 3] ?? null,
      createdByAccountId: owners[i % 3] ?? 'acc-sale-a', completedAt: null });
    if (verified) documents.push({ documentId: `doc-${id}-1`, customerId: id, documentName: 'Giấy chứng nhận đăng ký doanh nghiệp', documentType: 'LEGAL',
      fileName: `gcn-dkdn-${i + 1}.pdf`, fileType: 'application/pdf', fileSize: 180_000 + i * 1000, uploadedByAccountId: owners[i % 3] ?? 'acc-sale-a',
      uploadedAt: at(now, -90 + i), note: null, signedDate: dateOnly(now, -400), effectiveDate: dateOnly(now, -400), expiryDate: null, supersedesDocumentId: null, mockOnly: true });
    if (i % 5 === 1) documents.push({ documentId: `doc-${id}-2`, customerId: id, documentName: 'Hợp đồng nguyên tắc', documentType: 'CONTRACT',
      fileName: `hop-dong-${i + 1}.pdf`, fileType: 'application/pdf', fileSize: 320_000, uploadedByAccountId: owners[i % 3] ?? 'acc-sale-a',
      uploadedAt: at(now, -200), note: null, signedDate: dateOnly(now, -340), effectiveDate: dateOnly(now, -335), expiryDate: dateOnly(now, (i % 3) * 20 - 5),
      supersedesDocumentId: null, mockOnly: true });
  });
  const groups: Group[] = [
    { groupId: 'grp-fnb', groupCode: 'FNB', groupName: 'Thực phẩm & đồ uống', parentGroupId: null, description: null, isActive: true },
    { groupId: 'grp-pharma', groupCode: 'PHARMA', groupName: 'Dược phẩm', parentGroupId: null, description: null, isActive: true },
    { groupId: 'grp-ecom', groupCode: 'ECOM', groupName: 'Thương mại điện tử', parentGroupId: null, description: null, isActive: true },
    { groupId: 'grp-elec', groupCode: 'ELEC', groupName: 'Điện tử', parentGroupId: null, description: null, isActive: true },
    { groupId: 'grp-fnb-bev', groupCode: 'FNB-BEV', groupName: 'Đồ uống', parentGroupId: 'grp-fnb', description: 'Nhóm con của F&B', isActive: true },
  ];
  customers.forEach((c, i) => { c.groupIds = [groups[i % 4]?.groupId ?? 'grp-fnb']; });
  const legalChanges: LegalChange[] = [{
    changeRequestId: 'lgc-001', customerId: 'cus-002', requestedByAccountId: 'acc-sale-b', requestedAt: at(now, -2, 14), status: 'PENDING_MANAGEMENT',
    reason: 'Đổi tên theo giấy chứng nhận đăng ký thay đổi lần 3 (mẫu).', evidenceDocumentId: 'doc-cus-002-1', oldLegalName: 'Công ty CP Thử Nghiệm Bình Minh',
    newLegalName: 'Công ty CP Thử Nghiệm Bình Minh Mới', oldCustomerType: 'COMPANY', newCustomerType: 'COMPANY', oldIdentifierType: 'VN_TAX_ID',
    newIdentifierType: 'VN_TAX_ID', oldIdentifier: '0100000002', newIdentifier: '0100000002', oldCountryCode: 'VN', newCountryCode: 'VN', decisions: [], appliedAt: null,
  }];
  const handovers: Handover[] = [{
    handoverId: 'hdv-001', customerId: 'cus-007', fromAssignmentId: 'asg-cus-007-p', currentSaleAccountId: 'acc-sale-a', toSaleAccountId: 'acc-sale-c',
    initiatedByAccountId: 'acc-sale-a', mode: 'SALE_INITIATED', status: 'PENDING_APPROVAL', requestedAt: at(now, -1, 9), note: 'Chuyển địa bàn (mẫu).',
    managerApprovedByAccountId: null, currentAckByAccountId: null, currentAckOverrideByAccountId: null, currentAckOverrideReason: null,
    receiverAckByAccountId: null, rejectedByAccountId: null, rejectionReason: null, completedAt: null, transferredActivityIds: [],
  }];
  // Former sale (account no longer ACTIVE) still PRIMARY of one customer → manager override scenario (D05).
  const exPrimary = assignments.find((a) => a.assignmentId === 'asg-cus-012-p');
  if (exPrimary) exPrimary.saleAccountId = 'acc-sale-x';

  const appointments: Appointment[] = [
    { appointmentId: 'apt-001', title: 'Gặp trao đổi báo giá Q4', customerId: 'cus-001', contactId: 'con-cus-001-1', ownerAccountId: 'acc-sale-a', startAt: at(now, 0, 10), endAt: at(now, 0, 11), location: 'Văn phòng khách hàng', description: null, remindMinutes: 30, status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: at(now, -3) },
    { appointmentId: 'apt-002', title: 'Demo mẫu bao bì', customerId: 'cus-004', contactId: null, ownerAccountId: 'acc-sale-a', startAt: at(now, 1, 14), endAt: at(now, 1, 15, 30), location: 'Showroom', description: 'Mang mẫu thùng 5 lớp.', remindMinutes: 60, status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: at(now, -2) },
    { appointmentId: 'apt-003', title: 'Khảo sát kho', customerId: 'cus-002', contactId: null, ownerAccountId: 'acc-sale-b', startAt: at(now, 2, 9), endAt: at(now, 2, 11), location: null, description: null, remindMinutes: 15, status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: at(now, -1) },
    { appointmentId: 'apt-004', title: 'Ký phụ lục hợp đồng', customerId: 'cus-010', contactId: null, ownerAccountId: 'acc-sale-a', startAt: at(now, -2, 15), endAt: at(now, -2, 16), location: null, description: null, remindMinutes: null, status: 'DONE', cancelReason: null, outcome: 'Đã ký phụ lục giá (mẫu).', createdAt: at(now, -6) },
    { appointmentId: 'apt-005', title: 'Họp nội bộ chuẩn bị chào giá', customerId: null, contactId: null, ownerAccountId: 'acc-sale-a', startAt: at(now, 4, 8, 30), endAt: at(now, 4, 9, 30), location: 'Phòng họp 2', description: null, remindMinutes: 10, status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: at(now, -1) },
    { appointmentId: 'apt-006', title: 'Gặp kế toán khách hàng', customerId: 'cus-007', contactId: null, ownerAccountId: 'acc-sale-a', startAt: at(now, 7, 10), endAt: at(now, 7, 11), location: null, description: null, remindMinutes: 30, status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: at(now, -1) },
  ];
  const tasks: Task[] = [
    { taskId: 'tsk-001', title: 'Gửi báo giá thùng carton 3 lớp', description: null, customerId: 'cus-001', assigneeAccountId: 'acc-sale-a', createdByAccountId: 'acc-sale-a', dueAt: at(now, 1, 17), priority: 'HIGH', status: 'IN_PROGRESS', progress: 60, completedAt: null, createdAt: at(now, -3) },
    { taskId: 'tsk-002', title: 'Cập nhật hồ sơ pháp lý còn thiếu', description: 'Xin bản scan GCN ĐKDN.', customerId: 'cus-003', assigneeAccountId: 'acc-sale-a', createdByAccountId: 'acc-mgr', dueAt: at(now, -1, 17), priority: 'MEDIUM', status: 'TODO', progress: 0, completedAt: null, createdAt: at(now, -5) },
    { taskId: 'tsk-003', title: 'Chuẩn bị tài liệu demo', description: null, customerId: 'cus-004', assigneeAccountId: 'acc-sale-a', createdByAccountId: 'acc-sale-a', dueAt: at(now, 1, 12), priority: 'MEDIUM', status: 'TODO', progress: 0, completedAt: null, createdAt: at(now, -1) },
    { taskId: 'tsk-004', title: 'Tổng hợp nhu cầu quý 1', description: null, customerId: null, assigneeAccountId: 'acc-sale-a', createdByAccountId: 'acc-sale-a', dueAt: at(now, 6, 17), priority: 'LOW', status: 'TODO', progress: 0, completedAt: null, createdAt: at(now, -1) },
    { taskId: 'tsk-005', title: 'Gọi xác nhận lịch giao mẫu', description: null, customerId: 'cus-010', assigneeAccountId: 'acc-sale-a', createdByAccountId: 'acc-sale-a', dueAt: at(now, -3, 17), priority: 'HIGH', status: 'DONE', progress: 100, completedAt: at(now, -3, 16), createdAt: at(now, -6) },
    { taskId: 'tsk-006', title: 'Khảo sát giá đối thủ', description: null, customerId: 'cus-002', assigneeAccountId: 'acc-sale-b', createdByAccountId: 'acc-sale-b', dueAt: at(now, -2, 17), priority: 'MEDIUM', status: 'IN_PROGRESS', progress: 30, completedAt: null, createdAt: at(now, -4) },
  ];
  const reports: WorkReport[] = [
    { reportId: 'rpt-001', authorAccountId: 'acc-sale-a', workDate: dateOnly(now, -2), workDone: 'Gặp ký phụ lục với khách hàng 000010; gọi 3 khách tiềm năng.', results: 'Ký phụ lục giá; 1 khách hẹn demo.', issues: 'Khách 000003 thiếu hồ sơ pháp lý.', nextSteps: 'Gửi báo giá cho 000001.', customerIds: ['cus-010', 'cus-003'], appointmentIds: ['apt-004'], taskIds: ['tsk-005'], status: 'SUBMITTED', submittedAt: at(now, -2, 18), updatedAt: at(now, -2, 18) },
    { reportId: 'rpt-002', authorAccountId: 'acc-sale-b', workDate: dateOnly(now, -1), workDone: 'Khảo sát giá đối thủ khu vực phía Nam.', results: 'Đã thu thập 4 bảng giá.', issues: null, nextSteps: 'Tổng hợp gửi quản lý.', customerIds: ['cus-002'], appointmentIds: [], taskIds: ['tsk-006'], status: 'SUBMITTED', submittedAt: at(now, -1, 18), updatedAt: at(now, -1, 18) },
  ];
  return { version: MOCK_VERSION, seq: 1000, customers, contacts, groups, assignments, handovers, legalChanges, activities, documents, appointments, tasks, reports, dismissedReminders: [] };
}
