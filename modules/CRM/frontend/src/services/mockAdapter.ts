import { ACCOUNTS, MOCK_PERMISSIONS, MOCK_VERSION, PROVINCES, seedState } from '../mock/seed';
import type { MockState } from '../mock/seed';
import type {
  Account, Activity, Appointment, Assignment, Contact, CrmDocument, Customer, Group, Handover, IdentifierType, LegalChange, Permission, Session, Task,
  WorkReport,
} from '../types/domain';
import { CrmClientError } from './adapter';
import type {
  ActivityInput, AppointmentInput, AppointmentQuery, CapabilityStatus, ContactInput, CrmAdapter, CustomerBundle, CustomerInput, CustomerPatch,
  CustomerQuery, DocumentInput, DocumentMetadata, LegalChangeInput, Page, Reminder, ReportInput, ReportQuery, TaskInput, TaskQuery,
} from './adapter';

// MOCK ADAPTER — in-browser data implementing the CM-BE-SPEC-REV01 rules the backend enforces (D01-a DRAFT/VERIFIED,
// 1 PRIMARY + n SUPPORT, two handover flows with override, two-step legal change without self-approval, assignment
// scope, CSV injection guard). Persisted in localStorage when the browser allows it. NOTHING here reaches the server.

const STORAGE_KEY = 'talo-crm-mock-state';
const ACCOUNT_KEY = 'talo-crm-mock-account';
const nowIso = () => new Date().toISOString();
const err = (code: string, message: string) => new CrmClientError(code, message);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// BR-06 normalisation (same rules as the backend validation layer).
export function normalizeIdentifier(type: IdentifierType, raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (type === 'VN_TAX_ID') {
    const d = v.replace(/[\s.-]/g, '');
    return /^[0-9]{10}([0-9]{3})?$/.test(d) ? d : null;
  }
  if (type === 'VN_PERSONAL_ID') {
    const d = v.replace(/\s/g, '');
    return /^[0-9]{12}$/.test(d) ? d : null;
  }
  const d = v.replace(/[\s./-]/g, '');
  return /^[A-Z0-9]{1,128}$/.test(d) ? d : null;
}

// TC-49: a CSV cell never starts with a spreadsheet formula character.
export function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function loadState(): MockState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === MOCK_VERSION) return parsed;
    }
  } catch {
    // storage unavailable (private window, blocked site data): fall back to the seed
  }
  return seedState();
}

export class MockCrmAdapter implements CrmAdapter {
  readonly kind = 'MOCK' as const;
  private state: MockState;
  private accountId: string;
  private readonly listeners = new Set<() => void>();

  constructor(options: { persist?: boolean; state?: MockState; accountId?: string } = {}) {
    this.persist = options.persist ?? true;
    this.state = options.state ?? (this.persist ? loadState() : seedState());
    let stored: string | null = null;
    try { stored = this.persist ? globalThis.localStorage?.getItem(ACCOUNT_KEY) ?? null : null; } catch { stored = null; }
    this.accountId = options.accountId ?? (stored && MOCK_PERMISSIONS[stored] ? stored : 'acc-sale-a');
  }
  private readonly persist: boolean;

  // ------------------------------------------------------------------ mock-only controls (persona switch, reset)
  currentAccountId(): string { return this.accountId; }
  switchAccount(accountId: string): void {
    if (!MOCK_PERMISSIONS[accountId]) throw err('CM_VALIDATION_FAILED', 'Tài khoản mô phỏng không tồn tại.');
    this.accountId = accountId;
    try { if (this.persist) globalThis.localStorage?.setItem(ACCOUNT_KEY, accountId); } catch { /* ignore */ }
    this.emit();
  }
  reset(): void {
    this.state = seedState();
    this.save();
  }

  capabilities(): CapabilityStatus[] {
    const writes = 'Module Host chỉ cấp readOnly — BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY';
    return [
      { feature: 'Khách hàng, pháp lý, liên hệ, nhóm, phân công, bàn giao, hoạt động', state: 'MOCK', reason: `Có bảng DB (15 bảng); API ghi chưa chạy được: ${writes}` },
      { feature: 'Metadata tài liệu & cảnh báo hết hạn', state: 'MOCK', reason: writes },
      { feature: 'Upload / phiên bản / tải file', state: 'BLOCKED', reason: 'Chưa có storage được phê duyệt; mock chỉ lưu metadata, không lưu file' },
      { feature: 'Lịch hẹn, nhắc lịch', state: 'MOCK', reason: 'Chưa có bảng DB — Gate 2 (CRM_V1_DB_EXTENSION_APPROVAL); nhắc lịch chỉ trong ứng dụng' },
      { feature: 'Công việc (To-do)', state: 'MOCK', reason: 'Chưa có bảng DB riêng (ưu tiên, tiến độ) — Gate 2' },
      { feature: 'Báo cáo công việc', state: 'MOCK', reason: 'Chưa có bảng DB — Gate 2' },
      { feature: 'Phân quyền IAM', state: 'MOCK', reason: 'Quyền crm.* chưa đăng ký; mock dùng bộ quyền giả lập theo vai trò' },
    ];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(): void { for (const l of [...this.listeners]) l(); }
  private save(): void {
    try { if (this.persist) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
    this.emit();
  }
  private id(prefix: string): string { this.state.seq += 1; return `${prefix}-${this.state.seq}`; }

  // ------------------------------------------------------------------------------------------- authorisation
  private perms(): Set<Permission> { return new Set(MOCK_PERMISSIONS[this.accountId] ?? []); }
  private can(p: Permission): boolean { return this.perms().has(p); }
  private need(p: Permission): void { if (!this.can(p)) throw err('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'); }
  private activeAssignments(customerId: string): Assignment[] { return this.state.assignments.filter((a) => a.customerId === customerId && a.endedAt === null); }
  private visible(c: Customer): boolean {
    return this.can('crm.customer.read_all') || this.activeAssignments(c.customerId).some((a) => a.saleAccountId === this.accountId);
  }
  private customer(customerId: string): Customer {
    const c = this.state.customers.find((x) => x.customerId === customerId);
    if (!c || !this.visible(c)) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy hồ sơ hoặc bạn không có quyền xem hồ sơ này.');
    return c;
  }
  private account(accountId: string): Account | undefined { return ACCOUNTS.find((a) => a.accountId === accountId); }
  private ensureActiveAccount(accountId: string): void {
    if (this.account(accountId)?.active !== true) throw err('CM_VALIDATION_FAILED', 'Tài khoản Sale không tồn tại hoặc không còn hoạt động.');
  }

  async session(): Promise<Session> {
    const account = this.account(this.accountId);
    if (!account) throw err('UNAUTHENTICATED', 'Phiên đăng nhập mô phỏng không hợp lệ.');
    return { account, permissions: this.perms() };
  }
  async accounts(): Promise<Account[]> { return clone(ACCOUNTS); }
  async provinces() { return clone(PROVINCES); }
  async groups(): Promise<Group[]> { this.need('crm.group.read'); return clone(this.state.groups); }

  // --------------------------------------------------------------------------------------------- customers
  private address(input: Partial<CustomerInput>, base: Customer | null, type: string) {
    const pick = <K extends 'addressLine' | 'provinceCode' | 'wardCode' | 'foreignLocality' | 'foreignStateProvince'>(k: K): string | null =>
      (input[k] !== undefined ? input[k] ?? null : base ? base[k] : null);
    const countryCode = input.countryCode ?? base?.countryCode ?? 'VN';
    const a = { addressLine: pick('addressLine'), provinceCode: pick('provinceCode'), wardCode: pick('wardCode'), foreignLocality: pick('foreignLocality'),
      foreignStateProvince: pick('foreignStateProvince'), countryCode };
    if (type === 'FOREIGN_NO_VN_REG' && countryCode === 'VN') throw err('CM_VALIDATION_FAILED', 'Khách nước ngoài không đăng ký tại VN phải có quốc gia khác VN.');
    if (countryCode !== 'VN') {
      if (a.provinceCode || a.wardCode) throw err('CM_VALIDATION_FAILED', 'Địa chỉ nước ngoài không dùng danh mục tỉnh/xã Việt Nam.');
      return { ...a, registeredAddress: a.addressLine ? [a.addressLine, a.foreignLocality, a.foreignStateProvince, countryCode].filter(Boolean).join(', ') : null };
    }
    let wardName: string | null = null;
    let provinceName: string | null = null;
    if (a.wardCode && !a.provinceCode) throw err('CM_INVALID_PROVINCE_WARD', 'Phường/xã không thuộc tỉnh/thành đã chọn.');
    if (a.provinceCode) {
      const p = PROVINCES.find((x) => x.code === a.provinceCode);
      if (!p) throw err('CM_INVALID_PROVINCE_WARD', 'Tỉnh/thành không có trong danh mục.');
      provinceName = p.name;
      if (a.wardCode) {
        const w = p.wards.find((x) => x.code === a.wardCode);
        if (!w) throw err('CM_INVALID_PROVINCE_WARD', 'Phường/xã không thuộc tỉnh/thành đã chọn.');
        wardName = w.name;
      }
    }
    return { ...a, foreignLocality: null, foreignStateProvince: null,
      registeredAddress: a.addressLine ? [a.addressLine, wardName, provinceName].filter(Boolean).join(', ') : null };
  }
  private identifierTaken(country: string, type: string, value: string, exceptId: string | null): boolean {
    return this.state.customers.some((c) => c.customerId !== exceptId && c.countryCode === country && c.legalIdentifierType === type && c.legalIdentifier === value);
  }
  private similar(name: string | null | undefined, exceptId: string | null): number {
    if (!name) return 0;
    const n = name.trim().toLowerCase();
    return this.state.customers.filter((c) => c.customerId !== exceptId && (c.displayName.trim().toLowerCase() === n || (c.legalName ?? '').trim().toLowerCase() === n)).length;
  }
  private filtered(q: CustomerQuery): Customer[] {
    const term = q.q?.trim().toLowerCase();
    const showHidden = q.includeHidden === true && this.can('crm.customer.read_all');
    const list = this.state.customers.filter((c) => this.visible(c) && (showHidden || !c.isHidden)
      && (!term || [c.customerCode, c.displayName, c.legalName ?? '', c.legalIdentifier ?? ''].some((v) => v.toLowerCase().includes(term)))
      && (!q.customerType || c.customerType === q.customerType) && (!q.customerStatus || c.customerStatus === q.customerStatus)
      && (!q.recordStatus || c.recordStatus === q.recordStatus) && (!q.provinceCode || c.provinceCode === q.provinceCode)
      && (!q.groupId || c.groupIds.includes(q.groupId))
      && (!q.saleAccountId || this.activeAssignments(c.customerId).some((a) => a.saleAccountId === q.saleAccountId)));
    const sort = q.sort ?? 'code';
    return list.sort((a, b) => (sort === 'name' ? a.displayName.localeCompare(b.displayName, 'vi') : sort === 'createdAt' ? b.createdAt.localeCompare(a.createdAt)
      : a.customerCode.localeCompare(b.customerCode)) || a.customerId.localeCompare(b.customerId));
  }

  async listCustomers(q: CustomerQuery): Promise<Page<Customer>> {
    this.need('crm.customer.read');
    const all = this.filtered(q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    return { items: clone(all.slice((page - 1) * pageSize, page * pageSize)), total: all.length, page, pageSize };
  }
  async visibleCustomers(): Promise<Customer[]> {
    if (!this.can('crm.customer.read')) return [];
    return clone(this.state.customers.filter((c) => this.visible(c) && !c.isHidden));
  }

  async customerBundle(customerId: string): Promise<CustomerBundle> {
    this.need('crm.customer.read');
    const c = this.customer(customerId);
    const s = this.state;
    return clone({
      customer: c,
      contacts: this.can('crm.contact.read') ? s.contacts.filter((x) => x.customerId === customerId) : [],
      assignments: this.can('crm.assignment.read') ? s.assignments.filter((x) => x.customerId === customerId) : this.activeAssignments(customerId),
      handovers: this.can('crm.assignment.read') ? s.handovers.filter((x) => x.customerId === customerId) : [],
      legalChanges: this.can('crm.legal_change.read') ? s.legalChanges.filter((x) => x.customerId === customerId) : [],
      activities: this.can('crm.activity.read') ? s.activities.filter((x) => x.customerId === customerId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) : [],
      documents: this.can('crm.document.read') ? s.documents.filter((x) => x.customerId === customerId) : [],
      appointments: s.appointments.filter((x) => x.customerId === customerId).sort((a, b) => a.startAt.localeCompare(b.startAt)),
      tasks: s.tasks.filter((x) => x.customerId === customerId),
    });
  }

  async checkIdentity(type: IdentifierType, value: string, countryCode: string, name?: string) {
    if (!this.can('crm.customer.create') && !this.can('crm.customer.update')) throw err('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
    const normalized = normalizeIdentifier(type, value);
    return { normalized, duplicate: normalized !== null && this.identifierTaken(countryCode, type, normalized, null), similarNameCount: this.similar(name, null) };
  }

  async createCustomer(input: CustomerInput) {
    this.need('crm.customer.create');
    if (!input.displayName.trim()) throw err('CM_VALIDATION_FAILED', 'Tên khách hàng là bắt buộc.');
    let idType: IdentifierType | null = null;
    let idValue: string | null = null;
    if (input.legalIdentifierType || input.legalIdentifier) {
      if (!input.legalIdentifierType || !input.legalIdentifier) throw err('CM_VALIDATION_FAILED', 'Cần cả loại và số định danh.');
      idValue = normalizeIdentifier(input.legalIdentifierType, input.legalIdentifier);
      if (!idValue) throw err('CM_VALIDATION_FAILED', 'Số định danh sai cấu trúc (MST 10 hoặc 13 chữ số; CCCD 12 chữ số).');
      idType = input.legalIdentifierType;
    }
    const addr = this.address(input, null, input.customerType);
    if (idType && idValue && this.identifierTaken(addr.countryCode, idType, idValue, null)) throw err('CM_IDENTITY_DUPLICATE', 'Định danh pháp lý đã tồn tại.');
    const code = String(Math.max(0, ...this.state.customers.map((c) => Number(c.customerCode))) + 1).padStart(6, '0');
    const customer: Customer = {
      customerId: this.id('cus'), customerCode: code, displayName: input.displayName.trim(), legalName: input.legalName?.trim() || null,
      customerType: input.customerType, customerStatus: input.customerStatus ?? 'PROSPECT', recordStatus: 'DRAFT', legalIdentifierType: idType, legalIdentifier: idValue,
      representativeName: input.representativeName ?? null, representativePhone: input.representativePhone ?? null, ...addr, internalNote: input.internalNote ?? null,
      isHidden: false, groupIds: [], createdAt: nowIso(), createdAccountId: this.accountId, updatedAt: null,
    };
    this.state.customers.push(customer);
    // GAP-BE-01 (pending decision): the creator is not auto-assigned by the backend contract. In the mock the creator
    // receives the PRIMARY assignment so that the profile stays visible; flagged in the Frontend report.
    if (!this.can('crm.customer.read_all')) this.state.assignments.push({ assignmentId: this.id('asg'), customerId: customer.customerId, saleAccountId: this.accountId,
      role: 'PRIMARY', assignedAt: nowIso(), assignedByAccountId: this.accountId, endedAt: null, endedByAccountId: null, handoverToAccountId: null });
    const similar = this.similar(customer.legalName ?? customer.displayName, customer.customerId);
    this.save();
    return { customer: clone(customer), warnings: similar > 0 ? [`Có ${similar} khách hàng trùng hoặc gần trùng tên (chỉ cảnh báo).`] : [] };
  }

  async updateCustomer(customerId: string, patch: CustomerPatch): Promise<Customer> {
    this.need('crm.customer.update');
    const c = this.customer(customerId);
    const touchesAddress = (['addressLine', 'provinceCode', 'wardCode', 'foreignLocality', 'foreignStateProvince'] as const).some((k) => k in patch);
    const next = { ...c };
    if (patch.displayName !== undefined) next.displayName = patch.displayName.trim();
    if (patch.customerStatus !== undefined) next.customerStatus = patch.customerStatus;
    if (patch.representativeName !== undefined) next.representativeName = patch.representativeName;
    if (patch.representativePhone !== undefined) next.representativePhone = patch.representativePhone;
    if (patch.internalNote !== undefined) next.internalNote = patch.internalNote;
    if (touchesAddress) Object.assign(next, this.address(patch, c, c.customerType));
    if (!next.displayName) throw err('CM_VALIDATION_FAILED', 'Tên khách hàng là bắt buộc.');
    if (next.recordStatus === 'VERIFIED' && this.missing(next).length > 0) throw err('CM_VALIDATION_FAILED', 'Hồ sơ đã xác minh phải giữ đủ địa chỉ đăng ký.');
    Object.assign(c, next, { updatedAt: nowIso() });
    this.save();
    return clone(c);
  }

  missing(c: Pick<Customer, 'legalName' | 'legalIdentifierType' | 'legalIdentifier' | 'addressLine' | 'countryCode' | 'provinceCode' | 'wardCode'>): string[] {
    const m: string[] = [];
    if (!c.legalName?.trim()) m.push('Tên pháp lý');
    if (!c.legalIdentifierType || !c.legalIdentifier) m.push('Định danh pháp lý');
    if (!c.addressLine?.trim()) m.push('Số nhà, tên đường');
    if (c.countryCode === 'VN' && (!c.provinceCode || !c.wardCode)) m.push('Tỉnh/thành và phường/xã');
    return m;
  }

  async verifyCustomer(customerId: string, input: Partial<CustomerInput>): Promise<Customer> {
    this.need('crm.customer.verify');
    const c = this.customer(customerId);
    if (c.recordStatus === 'VERIFIED') throw err('CM_ALREADY_VERIFIED', 'Hồ sơ đã được xác minh.');
    const type = input.customerType ?? c.customerType;
    let idType = c.legalIdentifierType;
    let idValue = c.legalIdentifier;
    if (input.legalIdentifierType !== undefined || input.legalIdentifier !== undefined) {
      idType = input.legalIdentifierType ?? idType;
      const raw = input.legalIdentifier ?? idValue;
      idValue = idType && raw ? normalizeIdentifier(idType, raw) : null;
      if (!idValue) throw err('CM_VALIDATION_FAILED', 'Số định danh sai cấu trúc.');
    }
    const addr = this.address(input, c, type);
    const target = { legalName: input.legalName !== undefined ? input.legalName : c.legalName, legalIdentifierType: idType, legalIdentifier: idValue, ...addr };
    const missing = this.missing(target);
    if (missing.length > 0) throw err('CM_VALIDATION_FAILED', `Chưa đủ thông tin pháp lý: ${missing.join(', ')}.`);
    if (idType && idValue && this.identifierTaken(addr.countryCode, idType, idValue, customerId)) throw err('CM_IDENTITY_DUPLICATE', 'Định danh pháp lý đã tồn tại.');
    Object.assign(c, target, { customerType: type, recordStatus: 'VERIFIED', updatedAt: nowIso() });
    this.save();
    return clone(c);
  }

  async hideCustomer(customerId: string): Promise<Customer> {
    this.need('crm.customer.hide');
    const c = this.customer(customerId);
    c.isHidden = true;
    c.updatedAt = nowIso();
    this.save();
    return clone(c);
  }

  async exportCustomersCsv(q: CustomerQuery): Promise<string> {
    this.need('crm.customer.export');
    const rows = this.filtered(q);
    const header = ['customer_code', 'display_name', 'legal_name', 'customer_type', 'customer_status', 'record_status', 'identifier_type', 'identifier', 'address', 'province_code', 'ward_code', 'country_code'];
    const lines = rows.map((c) => [c.customerCode, c.displayName, c.legalName, c.customerType, c.customerStatus, c.recordStatus, c.legalIdentifierType, c.legalIdentifier,
      c.registeredAddress ?? c.addressLine, c.provinceCode, c.wardCode, c.countryCode].map(csvCell).join(','));
    return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }

  async setCustomerGroups(customerId: string, groupIds: string[]): Promise<void> {
    this.need('crm.group.assign');
    const c = this.customer(customerId);
    const ids = [...new Set(groupIds)];
    if (ids.some((g) => !this.state.groups.find((x) => x.groupId === g && x.isActive))) throw err('CM_VALIDATION_FAILED', 'Nhóm ngành không hợp lệ hoặc đã ngừng dùng.');
    c.groupIds = ids;
    this.save();
  }

  async createGroup(input: { groupCode: string; groupName: string; parentGroupId?: string | null; description?: string | null }): Promise<Group> {
    this.need('crm.group.manage');
    const code = input.groupCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,30}$/.test(code) || !input.groupName.trim()) throw err('CM_VALIDATION_FAILED', 'Mã nhóm (chữ hoa, số, _ -) và tên nhóm là bắt buộc.');
    if (this.state.groups.some((g) => g.groupCode === code)) throw err('CM_GROUP_CODE_EXISTS', 'Mã nhóm đã tồn tại.');
    const g: Group = { groupId: this.id('grp'), groupCode: code, groupName: input.groupName.trim(), parentGroupId: input.parentGroupId ?? null, description: input.description ?? null, isActive: true };
    this.state.groups.push(g);
    this.save();
    return clone(g);
  }

  async updateGroup(groupId: string, patch: { groupName?: string; parentGroupId?: string | null; description?: string | null; isActive?: boolean }): Promise<Group> {
    this.need('crm.group.manage');
    const g = this.state.groups.find((x) => x.groupId === groupId);
    if (!g) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy nhóm.');
    if (patch.parentGroupId) {
      let cur: string | null = patch.parentGroupId;
      for (let i = 0; cur && i < 64; i += 1) {
        if (cur === groupId) throw err('CM_VALIDATION_FAILED', 'Nhóm cha không được là chính nhóm hoặc nhóm con của nó.');
        cur = this.state.groups.find((x) => x.groupId === cur)?.parentGroupId ?? null;
      }
    }
    Object.assign(g, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.save();
    return clone(g);
  }

  // ---------------------------------------------------------------------------------------------- contacts
  private contactCustomer(contactId: string): Contact {
    const ct = this.state.contacts.find((x) => x.contactId === contactId);
    if (!ct) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy liên hệ.');
    this.customer(ct.customerId);
    return ct;
  }
  private checkPrimary(customerId: string, contactId: string | null, isPrimary: boolean, isActive: boolean): void {
    if (isPrimary && isActive && this.state.contacts.some((x) => x.customerId === customerId && x.contactId !== contactId && x.isPrimary && x.isActive)) {
      throw err('CM_VALIDATION_FAILED', 'Khách hàng đã có người liên hệ chính đang hoạt động. Bỏ đánh dấu người cũ trước.');
    }
  }
  async createContact(customerId: string, input: ContactInput): Promise<Contact> {
    this.need('crm.contact.manage');
    this.customer(customerId);
    if (!input.fullName.trim()) throw err('CM_VALIDATION_FAILED', 'Họ tên liên hệ là bắt buộc.');
    if (!input.phone?.trim() && !input.zaloPhone?.trim()) throw err('CM_VALIDATION_FAILED', 'Cần ít nhất số điện thoại hoặc Zalo.');
    this.checkPrimary(customerId, null, input.isPrimary ?? false, true);
    const ct: Contact = { contactId: this.id('con'), customerId, fullName: input.fullName.trim(), positionTitle: input.positionTitle ?? null, phone: input.phone ?? null,
      zaloPhone: input.zaloPhone ?? null, email: input.email ?? null, isPrimary: input.isPrimary ?? false, isActive: true };
    this.state.contacts.push(ct);
    this.save();
    return clone(ct);
  }
  async updateContact(contactId: string, patch: Partial<ContactInput>): Promise<Contact> {
    this.need('crm.contact.manage');
    const ct = this.contactCustomer(contactId);
    const next = { ...ct, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Contact;
    if (!next.phone?.trim() && !next.zaloPhone?.trim()) throw err('CM_VALIDATION_FAILED', 'Cần ít nhất số điện thoại hoặc Zalo.');
    this.checkPrimary(ct.customerId, contactId, next.isPrimary, next.isActive);
    Object.assign(ct, next);
    this.save();
    return clone(ct);
  }
  async deactivateContact(contactId: string): Promise<Contact> {
    this.need('crm.contact.manage');
    const ct = this.contactCustomer(contactId);
    ct.isActive = false;
    this.save();
    return clone(ct);
  }

  // ----------------------------------------------------------------------------------- assignments / handovers
  async addAssignment(customerId: string, saleAccountId: string, role: 'PRIMARY' | 'SUPPORT'): Promise<Assignment> {
    this.need('crm.assignment.manage');
    this.customer(customerId);
    this.ensureActiveAccount(saleAccountId);
    const active = this.activeAssignments(customerId);
    if (role === 'PRIMARY' && active.some((a) => a.role === 'PRIMARY')) throw err('CM_ASSIGNMENT_CONFLICT', 'Đã có Sale chính. Thay Sale chính phải qua bàn giao.');
    if (active.some((a) => a.saleAccountId === saleAccountId)) throw err('CM_ASSIGNMENT_CONFLICT', 'Sale này đang được phân công cho khách hàng.');
    const a: Assignment = { assignmentId: this.id('asg'), customerId, saleAccountId, role, assignedAt: nowIso(), assignedByAccountId: this.accountId, endedAt: null,
      endedByAccountId: null, handoverToAccountId: null };
    this.state.assignments.push(a);
    this.save();
    return clone(a);
  }
  async endAssignment(assignmentId: string): Promise<Assignment> {
    this.need('crm.assignment.manage');
    const a = this.state.assignments.find((x) => x.assignmentId === assignmentId);
    if (!a) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy phân công.');
    this.customer(a.customerId);
    if (a.role !== 'SUPPORT' || a.endedAt) throw err('CM_ASSIGNMENT_CONFLICT', 'Chỉ kết thúc được Sale hỗ trợ đang hiệu lực (Sale chính thay qua bàn giao).');
    a.endedAt = nowIso();
    a.endedByAccountId = this.accountId;
    this.save();
    return clone(a);
  }

  private handoverVisible(h: Handover): boolean {
    const c = this.state.customers.find((x) => x.customerId === h.customerId);
    return [h.initiatedByAccountId, h.toSaleAccountId, h.currentSaleAccountId].includes(this.accountId) || (c !== undefined && this.visible(c));
  }
  async listHandovers(): Promise<Handover[]> {
    if (!this.can('crm.assignment.read')) return [];
    return clone(this.state.handovers.filter((h) => this.handoverVisible(h)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
  }
  private handover(handoverId: string): Handover {
    const h = this.state.handovers.find((x) => x.handoverId === handoverId);
    if (!h || !this.handoverVisible(h)) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy yêu cầu bàn giao.');
    return h;
  }
  async requestHandover(customerId: string, mode: 'MANAGER_INITIATED' | 'SALE_INITIATED', toSaleAccountId: string, note?: string | null): Promise<Handover> {
    this.need('crm.handover.request');
    this.customer(customerId);
    const primary = this.activeAssignments(customerId).find((a) => a.role === 'PRIMARY');
    if (!primary) throw err('CM_HANDOVER_INVALID_STATE', 'Khách hàng chưa có Sale chính.');
    if (mode === 'SALE_INITIATED' && primary.saleAccountId !== this.accountId) throw err('CM_PERMISSION_DENIED', 'Chỉ Sale chính hiện tại được đề nghị bàn giao (luồng B).');
    if (mode === 'MANAGER_INITIATED' && !this.can('crm.handover.approve')) throw err('CM_PERMISSION_DENIED', 'Luồng A cần quyền duyệt bàn giao.');
    if (toSaleAccountId === primary.saleAccountId) throw err('CM_VALIDATION_FAILED', 'Sale nhận phải khác Sale chính hiện tại.');
    this.ensureActiveAccount(toSaleAccountId);
    if (this.state.handovers.some((h) => h.customerId === customerId && ['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK'].includes(h.status))) {
      throw err('CM_HANDOVER_INVALID_STATE', 'Khách hàng đang có một yêu cầu bàn giao chưa xử lý xong.');
    }
    const h: Handover = { handoverId: this.id('hdv'), customerId, fromAssignmentId: primary.assignmentId, currentSaleAccountId: primary.saleAccountId, toSaleAccountId,
      initiatedByAccountId: this.accountId, mode, status: mode === 'MANAGER_INITIATED' ? 'PENDING_CURRENT_ACK' : 'PENDING_APPROVAL', requestedAt: nowIso(), note: note ?? null,
      managerApprovedByAccountId: null, currentAckByAccountId: null, currentAckOverrideByAccountId: null, currentAckOverrideReason: null, receiverAckByAccountId: null,
      rejectedByAccountId: null, rejectionReason: null, completedAt: null, transferredActivityIds: [] };
    this.state.handovers.push(h);
    this.save();
    return clone(h);
  }
  async approveHandover(handoverId: string): Promise<Handover> {
    this.need('crm.handover.approve');
    const h = this.handover(handoverId);
    this.customer(h.customerId);
    if (h.status !== 'PENDING_APPROVAL') throw err('CM_HANDOVER_INVALID_STATE', 'Trạng thái bàn giao không cho phép thao tác này.');
    if (h.initiatedByAccountId === this.accountId) throw err('CM_SELF_APPROVAL_FORBIDDEN', 'Người đề nghị không được tự duyệt.');
    h.managerApprovedByAccountId = this.accountId;
    h.status = 'PENDING_RECEIVER_ACK';
    this.save();
    return clone(h);
  }
  async acknowledgeHandover(handoverId: string, overrideReason?: string | null): Promise<Handover> {
    this.need('crm.handover.acknowledge');
    const h = this.handover(handoverId);
    if (h.status === 'PENDING_CURRENT_ACK') {
      if (overrideReason?.trim()) {
        if (!this.can('crm.handover.override')) throw err('CM_PERMISSION_DENIED', 'Cần quyền xác nhận thay (override).');
        if (this.account(h.currentSaleAccountId)?.active) throw err('CM_HANDOVER_INVALID_STATE', 'Sale hiện tại vẫn hoạt động — phải tự xác nhận.');
        h.currentAckOverrideByAccountId = this.accountId;
        h.currentAckOverrideReason = overrideReason.trim();
      } else {
        if (h.currentSaleAccountId !== this.accountId) throw err('CM_PERMISSION_DENIED', 'Chỉ Sale hiện tại được xác nhận bước này.');
        h.currentAckByAccountId = this.accountId;
      }
      h.status = 'PENDING_RECEIVER_ACK';
      this.save();
      return clone(h);
    }
    if (h.status !== 'PENDING_RECEIVER_ACK' || overrideReason) throw err('CM_HANDOVER_INVALID_STATE', 'Trạng thái bàn giao không cho phép thao tác này.');
    if (h.toSaleAccountId !== this.accountId) throw err('CM_PERMISSION_DENIED', 'Chỉ Sale nhận được xác nhận bước này.');
    // Completion: close PRIMARY, close receiver's SUPPORT, open new PRIMARY, move OPEN activities of the previous sale.
    const from = this.state.assignments.find((a) => a.assignmentId === h.fromAssignmentId);
    if (!from || from.endedAt) throw err('CM_CONCURRENT_UPDATE', 'Dữ liệu đã thay đổi bởi giao dịch khác. Vui lòng tải lại.');
    const t = nowIso();
    Object.assign(from, { endedAt: t, endedByAccountId: this.accountId, handoverToAccountId: this.accountId });
    for (const a of this.activeAssignments(h.customerId)) if (a.saleAccountId === this.accountId && a.role === 'SUPPORT') Object.assign(a, { endedAt: t, endedByAccountId: this.accountId });
    this.state.assignments.push({ assignmentId: this.id('asg'), customerId: h.customerId, saleAccountId: this.accountId, role: 'PRIMARY', assignedAt: t,
      assignedByAccountId: h.managerApprovedByAccountId ?? h.initiatedByAccountId, endedAt: null, endedByAccountId: null, handoverToAccountId: null });
    const moved = this.state.activities.filter((x) => x.customerId === h.customerId && x.activityStatus === 'OPEN' && x.assignedToAccountId === from.saleAccountId);
    for (const x of moved) x.assignedToAccountId = this.accountId;
    Object.assign(h, { receiverAckByAccountId: this.accountId, status: 'COMPLETED', completedAt: t, transferredActivityIds: moved.map((x) => x.activityId) });
    this.state.activities.push({ activityId: this.id('act'), customerId: h.customerId, activityType: 'HANDOVER', activityStatus: 'DONE', title: 'Hoàn tất bàn giao khách hàng',
      description: `Chuyển ${moved.length} công việc đang mở.`, occurredAt: t, dueAt: null, assignedToAccountId: this.accountId, createdByAccountId: this.accountId, completedAt: t });
    this.save();
    return clone(h);
  }
  async rejectHandover(handoverId: string, reason: string): Promise<Handover> {
    this.need('crm.handover.reject');
    const h = this.handover(handoverId);
    if (!reason.trim()) throw err('CM_VALIDATION_FAILED', 'Cần nêu lý do từ chối.');
    const ok = h.status === 'PENDING_APPROVAL' ? this.can('crm.handover.approve')
      : h.status === 'PENDING_CURRENT_ACK' ? h.currentSaleAccountId === this.accountId
        : h.status === 'PENDING_RECEIVER_ACK' ? h.toSaleAccountId === this.accountId : null;
    if (ok === null) throw err('CM_HANDOVER_INVALID_STATE', 'Trạng thái bàn giao không cho phép thao tác này.');
    if (!ok) throw err('CM_PERMISSION_DENIED', 'Bạn không phải người xử lý bước hiện tại.');
    Object.assign(h, { status: 'REJECTED', rejectedByAccountId: this.accountId, rejectionReason: reason.trim() });
    this.save();
    return clone(h);
  }

  // ------------------------------------------------------------------------------------------- legal change
  async listLegalChanges(): Promise<LegalChange[]> {
    if (!this.can('crm.legal_change.read')) return [];
    return clone(this.state.legalChanges.filter((l) => {
      const c = this.state.customers.find((x) => x.customerId === l.customerId);
      return c !== undefined && this.visible(c);
    }).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
  }
  async requestLegalChange(customerId: string, input: LegalChangeInput): Promise<LegalChange> {
    this.need('crm.legal_change.request');
    const c = this.customer(customerId);
    if (c.recordStatus !== 'VERIFIED') throw err('CM_DRAFT_NOT_ELIGIBLE', 'Hồ sơ DRAFT được hoàn thiện qua "Xác minh hồ sơ", không qua yêu cầu thay đổi pháp lý.');
    if (!input.reason.trim()) throw err('CM_VALIDATION_FAILED', 'Cần nêu lý do.');
    if (!this.state.documents.some((d) => d.documentId === input.evidenceDocumentId && d.customerId === customerId)) throw err('CM_VALIDATION_FAILED', 'Cần chọn chứng từ của chính khách hàng này.');
    const value = normalizeIdentifier(input.newIdentifierType, input.newIdentifier);
    if (!value) throw err('CM_VALIDATION_FAILED', 'Số định danh mới sai cấu trúc.');
    if (input.newCustomerType === 'FOREIGN_NO_VN_REG' && input.newCountryCode === 'VN') throw err('CM_VALIDATION_FAILED', 'Khách nước ngoài phải có quốc gia khác VN.');
    if (c.legalName === input.newLegalName && c.customerType === input.newCustomerType && c.legalIdentifierType === input.newIdentifierType && c.legalIdentifier === value
      && c.countryCode === input.newCountryCode) throw err('CM_VALIDATION_FAILED', 'Thông tin mới không khác thông tin hiện hành.');
    if (this.state.legalChanges.some((l) => l.customerId === customerId && (l.status === 'PENDING_MANAGEMENT' || l.status === 'PENDING_ACCOUNTING'))) {
      throw err('CM_LEGAL_CHANGE_PENDING', 'Khách hàng đang có một yêu cầu thay đổi pháp lý chưa xử lý xong.');
    }
    if (this.identifierTaken(input.newCountryCode, input.newIdentifierType, value, customerId)) throw err('CM_IDENTITY_DUPLICATE', 'Định danh pháp lý đã tồn tại.');
    const l: LegalChange = { changeRequestId: this.id('lgc'), customerId, requestedByAccountId: this.accountId, requestedAt: nowIso(), status: 'PENDING_MANAGEMENT',
      reason: input.reason.trim(), evidenceDocumentId: input.evidenceDocumentId, oldLegalName: c.legalName, newLegalName: input.newLegalName.trim(),
      oldCustomerType: c.customerType, newCustomerType: input.newCustomerType, oldIdentifierType: c.legalIdentifierType, newIdentifierType: input.newIdentifierType,
      oldIdentifier: c.legalIdentifier, newIdentifier: value, oldCountryCode: c.countryCode, newCountryCode: input.newCountryCode, decisions: [], appliedAt: null };
    this.state.legalChanges.push(l);
    this.save();
    return clone(l);
  }
  async decideLegalChange(changeRequestId: string, stage: 'MANAGEMENT' | 'ACCOUNTING', decision: 'APPROVED' | 'REJECTED', note?: string | null): Promise<LegalChange> {
    this.need(stage === 'MANAGEMENT' ? 'crm.legal_change.approve_management' : 'crm.legal_change.approve_accounting');
    const l = this.state.legalChanges.find((x) => x.changeRequestId === changeRequestId);
    if (!l) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy yêu cầu.');
    const c = this.customer(l.customerId);
    if (l.status !== (stage === 'MANAGEMENT' ? 'PENDING_MANAGEMENT' : 'PENDING_ACCOUNTING')) throw err('CM_LEGAL_CHANGE_INVALID_STATE', 'Trạng thái yêu cầu không cho phép thao tác này.');
    if (l.requestedByAccountId === this.accountId) throw err('CM_SELF_APPROVAL_FORBIDDEN', 'Người đề nghị không được tự duyệt yêu cầu của mình.');
    if (decision === 'REJECTED' && !note?.trim()) throw err('CM_VALIDATION_FAILED', 'Từ chối phải nêu lý do.');
    if (decision === 'APPROVED' && stage === 'ACCOUNTING') {
      const same = c.legalName === l.oldLegalName && c.customerType === l.oldCustomerType && c.legalIdentifierType === l.oldIdentifierType
        && c.legalIdentifier === l.oldIdentifier && c.countryCode === l.oldCountryCode;
      if (!same) throw err('CM_CONCURRENT_UPDATE', 'Thông tin pháp lý đã thay đổi kể từ khi lập yêu cầu.');
      if (this.identifierTaken(l.newCountryCode, l.newIdentifierType, l.newIdentifier, c.customerId)) throw err('CM_IDENTITY_DUPLICATE', 'Định danh pháp lý đã tồn tại.');
      Object.assign(c, { legalName: l.newLegalName, customerType: l.newCustomerType, legalIdentifierType: l.newIdentifierType, legalIdentifier: l.newIdentifier,
        countryCode: l.newCountryCode, updatedAt: nowIso() });
      l.appliedAt = nowIso();
    }
    l.decisions.push({ stage, decision, decidedByAccountId: this.accountId, decidedAt: nowIso(), note: note?.trim() || null });
    l.status = decision === 'REJECTED' ? 'REJECTED' : stage === 'MANAGEMENT' ? 'PENDING_ACCOUNTING' : 'APPLIED';
    this.save();
    return clone(l);
  }

  // ------------------------------------------------------------------------------------------ activities
  async recentActivities(limit: number): Promise<Activity[]> {
    if (!this.can('crm.activity.read')) return [];
    return clone(this.state.activities.filter((a) => {
      const c = this.state.customers.find((x) => x.customerId === a.customerId);
      return c !== undefined && this.visible(c);
    }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit));
  }
  async createActivity(customerId: string, input: ActivityInput): Promise<Activity> {
    this.need('crm.activity.create');
    this.customer(customerId);
    if (!input.title.trim()) throw err('CM_VALIDATION_FAILED', 'Tiêu đề là bắt buộc.');
    const assignee = input.assignedToAccountId === undefined ? this.accountId : input.assignedToAccountId;
    if (assignee) this.ensureActiveAccount(assignee);
    const a: Activity = { activityId: this.id('act'), customerId, activityType: input.activityType, activityStatus: 'OPEN', title: input.title.trim(),
      description: input.description ?? null, occurredAt: input.occurredAt ?? nowIso(), dueAt: input.dueAt ?? null, assignedToAccountId: assignee,
      createdByAccountId: this.accountId, completedAt: null };
    if (a.activityType === 'NOTE') { a.activityStatus = 'DONE'; a.completedAt = a.occurredAt; }
    this.state.activities.push(a);
    this.save();
    return clone(a);
  }
  private openActivity(activityId: string): Activity {
    const a = this.state.activities.find((x) => x.activityId === activityId);
    if (!a) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy hoạt động.');
    this.customer(a.customerId);
    if (a.activityStatus !== 'OPEN') throw err('CM_VALIDATION_FAILED', 'Hoạt động đã kết thúc, không sửa lịch sử.');
    return a;
  }
  async updateActivity(activityId: string, patch: Partial<ActivityInput> & { activityStatus?: 'OPEN' | 'CANCELLED' }): Promise<Activity> {
    this.need('crm.activity.update');
    const a = this.openActivity(activityId);
    if (patch.assignedToAccountId) this.ensureActiveAccount(patch.assignedToAccountId);
    Object.assign(a, Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== 'activityType')));
    this.save();
    return clone(a);
  }
  async completeActivity(activityId: string): Promise<Activity> {
    this.need('crm.activity.complete');
    const a = this.openActivity(activityId);
    a.activityStatus = 'DONE';
    a.completedAt = nowIso();
    this.save();
    return clone(a);
  }

  // ------------------------------------------------------------------------------------------- documents
  async createDocument(customerId: string, input: DocumentInput, supersedesDocumentId?: string | null): Promise<CrmDocument> {
    this.need('crm.document.manage');
    this.customer(customerId);
    if (!/\.(pdf|jpe?g|png)$/i.test(input.fileName) || !['application/pdf', 'image/jpeg', 'image/png'].includes(input.fileType)) {
      throw err('CM_FILE_INVALID', 'Chỉ chấp nhận PDF, JPG/JPEG, PNG.');
    }
    if (input.fileSize <= 0 || input.fileSize > 10 * 1024 * 1024) throw err('CM_FILE_INVALID', 'Dung lượng file không hợp lệ (đề xuất tối đa 10 MB — D07 chưa chốt).');
    if (input.effectiveDate && input.expiryDate && input.effectiveDate > input.expiryDate) throw err('CM_VALIDATION_FAILED', 'Ngày hiệu lực phải trước ngày hết hạn.');
    if (supersedesDocumentId) {
      const old = this.state.documents.find((d) => d.documentId === supersedesDocumentId);
      if (!old || old.customerId !== customerId) throw err('CM_VALIDATION_FAILED', 'Bản thay thế phải cùng khách hàng.');
      if (this.state.documents.some((d) => d.supersedesDocumentId === supersedesDocumentId)) throw err('CM_CONCURRENT_UPDATE', 'Tài liệu này đã có bản thay thế.');
    }
    const d: CrmDocument = { documentId: this.id('doc'), customerId, documentName: input.documentName.trim(), documentType: input.documentType, fileName: input.fileName,
      fileType: input.fileType, fileSize: input.fileSize, uploadedByAccountId: this.accountId, uploadedAt: nowIso(), note: input.note ?? null, signedDate: input.signedDate ?? null,
      effectiveDate: input.effectiveDate ?? null, expiryDate: input.expiryDate ?? null, supersedesDocumentId: supersedesDocumentId ?? null, mockOnly: true };
    this.state.documents.push(d);
    this.save();
    return clone(d);
  }
  async updateDocumentMetadata(documentId: string, patch: DocumentMetadata): Promise<CrmDocument> {
    this.need('crm.document.manage');
    const d = this.state.documents.find((x) => x.documentId === documentId);
    if (!d) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy tài liệu.');
    this.customer(d.customerId);
    const next = { ...d, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as CrmDocument;
    if (!next.documentName.trim()) throw err('CM_VALIDATION_FAILED', 'Tên tài liệu là bắt buộc.');
    if (next.effectiveDate && next.expiryDate && next.effectiveDate > next.expiryDate) throw err('CM_VALIDATION_FAILED', 'Ngày hiệu lực phải trước ngày hết hạn.');
    Object.assign(d, next);
    this.save();
    return clone(d);
  }
  async expiringDocuments(withinDays: number): Promise<CrmDocument[]> {
    if (!this.can('crm.document.read')) return [];
    const limit = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
    return clone(this.state.documents.filter((d) => {
      const c = this.state.customers.find((x) => x.customerId === d.customerId);
      return c !== undefined && this.visible(c) && !c.isHidden && d.expiryDate !== null && d.expiryDate <= limit
        && !this.state.documents.some((n) => n.supersedesDocumentId === d.documentId);
    }).sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? '')));
  }

  // -------------------------------------------------------------------- appointments (mock-only, Gate 2)
  private canSeeOwned(ownerId: string, customerId: string | null): boolean {
    if (ownerId === this.accountId || this.can('crm.customer.read_all')) return true;
    const c = customerId ? this.state.customers.find((x) => x.customerId === customerId) : undefined;
    return c !== undefined && this.visible(c);
  }
  private appointment(id: string, write = false): Appointment {
    const a = this.state.appointments.find((x) => x.appointmentId === id);
    if (!a || !this.canSeeOwned(a.ownerAccountId, a.customerId)) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy lịch hẹn.');
    if (write && a.ownerAccountId !== this.accountId) throw err('CM_PERMISSION_DENIED', 'Chỉ người tạo lịch được sửa / hủy lịch hẹn.');
    return a;
  }
  private checkAppointment(input: Partial<AppointmentInput>, base: Appointment | null): void {
    const start = input.startAt ?? base?.startAt;
    const end = input.endAt ?? base?.endAt;
    const title = input.title ?? base?.title ?? '';
    if (!title.trim()) throw err('CM_VALIDATION_FAILED', 'Tiêu đề lịch hẹn là bắt buộc.');
    if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || end <= start) throw err('CM_VALIDATION_FAILED', 'Giờ kết thúc phải sau giờ bắt đầu.');
    const cid = input.customerId !== undefined ? input.customerId : base?.customerId ?? null;
    if (cid) this.customer(cid);
  }
  async listAppointments(q: AppointmentQuery): Promise<Appointment[]> {
    return clone(this.state.appointments.filter((a) => this.canSeeOwned(a.ownerAccountId, a.customerId) && a.endAt >= q.from && a.startAt < q.to
      && (!q.customerId || a.customerId === q.customerId) && (!q.mineOnly || a.ownerAccountId === this.accountId)
      && (q.includeCancelled !== false || a.status !== 'CANCELLED')).sort((a, b) => a.startAt.localeCompare(b.startAt)));
  }
  async createAppointment(input: AppointmentInput): Promise<Appointment> {
    this.checkAppointment(input, null);
    const a: Appointment = { appointmentId: this.id('apt'), title: input.title.trim(), customerId: input.customerId, contactId: input.contactId ?? null, ownerAccountId: this.accountId,
      startAt: input.startAt, endAt: input.endAt, location: input.location ?? null, description: input.description ?? null, remindMinutes: input.remindMinutes ?? null,
      status: 'SCHEDULED', cancelReason: null, outcome: null, createdAt: nowIso() };
    this.state.appointments.push(a);
    this.save();
    return clone(a);
  }
  async updateAppointment(appointmentId: string, patch: Partial<AppointmentInput>): Promise<Appointment> {
    const a = this.appointment(appointmentId, true);
    if (a.status !== 'SCHEDULED') throw err('CM_VALIDATION_FAILED', 'Chỉ sửa được lịch hẹn đang lên lịch.');
    this.checkAppointment(patch, a);
    Object.assign(a, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.state.dismissedReminders = this.state.dismissedReminders.filter((x) => x !== appointmentId);
    this.save();
    return clone(a);
  }
  async cancelAppointment(appointmentId: string, reason: string): Promise<Appointment> {
    const a = this.appointment(appointmentId, true);
    if (a.status !== 'SCHEDULED') throw err('CM_VALIDATION_FAILED', 'Lịch hẹn đã kết thúc hoặc đã hủy.');
    if (!reason.trim()) throw err('CM_VALIDATION_FAILED', 'Cần nêu lý do hủy.');
    Object.assign(a, { status: 'CANCELLED', cancelReason: reason.trim() });
    this.save();
    return clone(a);
  }
  async completeAppointment(appointmentId: string, outcome: string): Promise<Appointment> {
    const a = this.appointment(appointmentId, true);
    if (a.status !== 'SCHEDULED') throw err('CM_VALIDATION_FAILED', 'Lịch hẹn đã kết thúc hoặc đã hủy.');
    if (!outcome.trim()) throw err('CM_VALIDATION_FAILED', 'Cần ghi kết quả buổi hẹn.');
    Object.assign(a, { status: 'DONE', outcome: outcome.trim() });
    this.save();
    return clone(a);
  }
  // In-app reminders only (no background job / push: owner order VII — no notification channel yet).
  async dueReminders(now: Date): Promise<Reminder[]> {
    const t = now.getTime();
    return clone(this.state.appointments.filter((a) => a.ownerAccountId === this.accountId && a.status === 'SCHEDULED' && a.remindMinutes !== null
      && !this.state.dismissedReminders.includes(a.appointmentId)
      && Date.parse(a.startAt) - (a.remindMinutes ?? 0) * 60_000 <= t && Date.parse(a.startAt) > t)
      .map((appointment) => ({ appointment, minutesLeft: Math.max(0, Math.round((Date.parse(appointment.startAt) - t) / 60_000)) })));
  }
  async dismissReminder(appointmentId: string): Promise<void> {
    this.appointment(appointmentId);
    if (!this.state.dismissedReminders.includes(appointmentId)) this.state.dismissedReminders.push(appointmentId);
    this.save();
  }

  // -------------------------------------------------------------------------- tasks (mock-only, Gate 2)
  private task(taskId: string): Task {
    const t = this.state.tasks.find((x) => x.taskId === taskId);
    if (!t || !(t.assigneeAccountId === this.accountId || t.createdByAccountId === this.accountId || this.canSeeOwned(t.assigneeAccountId, t.customerId))) {
      throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy công việc.');
    }
    return t;
  }
  async listTasks(q: TaskQuery): Promise<Task[]> {
    const term = q.q?.trim().toLowerCase();
    const now = nowIso();
    return clone(this.state.tasks.filter((t) => (t.assigneeAccountId === this.accountId || t.createdByAccountId === this.accountId || this.canSeeOwned(t.assigneeAccountId, t.customerId))
      && (!q.mineOnly || t.assigneeAccountId === this.accountId) && (!q.customerId || t.customerId === q.customerId)
      && (!q.status || (q.status === 'OPEN' ? t.status === 'TODO' || t.status === 'IN_PROGRESS' : t.status === q.status))
      && (!q.overdueOnly || (t.dueAt !== null && t.dueAt < now && (t.status === 'TODO' || t.status === 'IN_PROGRESS')))
      && (!term || t.title.toLowerCase().includes(term))).sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')));
  }
  async createTask(input: TaskInput): Promise<Task> {
    if (!input.title.trim()) throw err('CM_VALIDATION_FAILED', 'Tên công việc là bắt buộc.');
    if (input.customerId) this.customer(input.customerId);
    const assignee = input.assigneeAccountId ?? this.accountId;
    this.ensureActiveAccount(assignee);
    const t: Task = { taskId: this.id('tsk'), title: input.title.trim(), description: input.description ?? null, customerId: input.customerId, assigneeAccountId: assignee,
      createdByAccountId: this.accountId, dueAt: input.dueAt ?? null, priority: input.priority ?? 'MEDIUM', status: 'TODO', progress: Math.min(100, Math.max(0, input.progress ?? 0)),
      completedAt: null, createdAt: nowIso() };
    this.state.tasks.push(t);
    this.save();
    return clone(t);
  }
  async updateTask(taskId: string, patch: Partial<TaskInput> & { status?: Task['status'] }): Promise<Task> {
    const t = this.task(taskId);
    if (t.status === 'DONE' || t.status === 'CANCELLED') throw err('CM_VALIDATION_FAILED', 'Công việc đã kết thúc.');
    if (patch.customerId) this.customer(patch.customerId);
    if (patch.assigneeAccountId) this.ensureActiveAccount(patch.assigneeAccountId);
    if (patch.title !== undefined && !patch.title.trim()) throw err('CM_VALIDATION_FAILED', 'Tên công việc là bắt buộc.');
    const next = { ...t, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Task;
    next.progress = Math.min(100, Math.max(0, next.progress));
    if (next.status === 'TODO' && next.progress > 0) next.status = 'IN_PROGRESS';
    if (next.status === 'DONE') { next.progress = 100; next.completedAt = nowIso(); }
    Object.assign(t, next);
    this.save();
    return clone(t);
  }
  async completeTask(taskId: string): Promise<Task> { return this.updateTask(taskId, { status: 'DONE' }); }

  // ------------------------------------------------------------------------ work reports (mock-only, Gate 2)
  async listReports(q: ReportQuery): Promise<WorkReport[]> {
    return clone(this.state.reports.filter((r) => (r.authorAccountId === this.accountId || (this.can('crm.customer.read_all') && r.status === 'SUBMITTED'))
      && (!q.authorAccountId || r.authorAccountId === q.authorAccountId) && (!q.status || r.status === q.status)
      && (!q.from || r.workDate >= q.from) && (!q.to || r.workDate <= q.to)).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.updatedAt.localeCompare(a.updatedAt)));
  }
  private checkReport(input: Partial<ReportInput>, base: WorkReport | null): void {
    const workDone = input.workDone ?? base?.workDone ?? '';
    const results = input.results ?? base?.results ?? '';
    const date = input.workDate ?? base?.workDate ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err('CM_VALIDATION_FAILED', 'Ngày làm việc không hợp lệ.');
    if (!workDone.trim() || !results.trim()) throw err('CM_VALIDATION_FAILED', 'Nội dung thực hiện và kết quả là bắt buộc.');
    for (const id of input.customerIds ?? []) this.customer(id);
  }
  async createReport(input: ReportInput): Promise<WorkReport> {
    this.checkReport(input, null);
    const r: WorkReport = { reportId: this.id('rpt'), authorAccountId: this.accountId, workDate: input.workDate, workDone: input.workDone.trim(), results: input.results.trim(),
      issues: input.issues ?? null, nextSteps: input.nextSteps ?? null, customerIds: input.customerIds ?? [], appointmentIds: input.appointmentIds ?? [], taskIds: input.taskIds ?? [],
      status: 'DRAFT', submittedAt: null, updatedAt: nowIso() };
    this.state.reports.push(r);
    this.save();
    return clone(r);
  }
  private ownReport(reportId: string): WorkReport {
    const r = this.state.reports.find((x) => x.reportId === reportId);
    if (!r || r.authorAccountId !== this.accountId) throw err('CM_CUSTOMER_NOT_FOUND', 'Không tìm thấy báo cáo của bạn.');
    if (r.status !== 'DRAFT') throw err('CM_VALIDATION_FAILED', 'Báo cáo đã nộp, không sửa được.');
    return r;
  }
  async updateReport(reportId: string, patch: Partial<ReportInput>): Promise<WorkReport> {
    const r = this.ownReport(reportId);
    this.checkReport(patch, r);
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: nowIso() });
    this.save();
    return clone(r);
  }
  async submitReport(reportId: string): Promise<WorkReport> {
    const r = this.ownReport(reportId);
    Object.assign(r, { status: 'SUBMITTED', submittedAt: nowIso(), updatedAt: nowIso() });
    this.save();
    return clone(r);
  }
}
