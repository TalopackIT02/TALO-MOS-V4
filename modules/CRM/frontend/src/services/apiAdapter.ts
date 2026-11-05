import { CrmClientError } from './adapter';
import type {
  ActivityInput, AppointmentInput, AppointmentQuery, CapabilityStatus, ContactInput, CrmAdapter, CustomerBundle, CustomerCreateBundle, CustomerInput,
  CustomerPatch, CustomerQuery, DocumentInput, DocumentMetadata, LegalChangeInput, Page, Reminder, ReportInput, ReportQuery, TaskInput, TaskQuery,
} from './adapter';
import type {
  Account, Activity, Appointment, Assignment, AssignmentRole, Contact, CrmDocument, Customer, CustomerView, Group, Handover, HandoverMode, IdentifierType,
  LegalChange, Permission, Province, Session, Task, WorkReport,
} from '../types/domain';

// ApiCrmAdapter — the SAME CrmAdapter interface as the mock, backed by the CRM backend (/api/cm/*) through the Module Host.
//   * The actor is the Host session (same-origin cookie); no account id is ever sent as "who acts".
//   * No database access, no IAM decision here: the session permission list only shows / hides actions; every API re-checks.
//   * Errors: the backend's REV01 code; when the backend gives a business reason (details.reason, OD-08 PENDING) the screen
//     receives the same code / text as the accepted Gate 1 mock.
//   * What the backend does not serve is reported as BLOCKED (capabilities) and refused with its real reason.

type Json = Record<string, unknown>;
type Query = Record<string, string | number | boolean | null | undefined>;

// Business reason (details.reason) → the code / text of the accepted Gate 1 screens.
const REASONS: Record<string, { code: string; message: string }> = {
  ALREADY_VERIFIED: { code: 'CM_ALREADY_VERIFIED', message: 'Hồ sơ đã được xác minh.' },
  ASSIGNMENT_CONFLICT: { code: 'CM_ASSIGNMENT_CONFLICT', message: 'Phân công bị trùng: đã có Sale chính (thay qua bàn giao) hoặc Sale này đang được phân công.' },
  GROUP_CODE_EXISTS: { code: 'CM_GROUP_CODE_EXISTS', message: 'Mã nhóm đã tồn tại.' },
  LEGAL_CHANGE_PENDING: { code: 'CM_LEGAL_CHANGE_PENDING', message: 'Khách hàng đang có một đề nghị thay đổi pháp lý chưa xử lý xong.' },
  LEGAL_CHANGE_INVALID_STATE: { code: 'CM_LEGAL_CHANGE_INVALID_STATE', message: 'Trạng thái đề nghị không cho phép duyệt ở bước này.' },
  CONTACT_PHONE_REQUIRED: { code: 'CM_VALIDATION_FAILED', message: 'Cần ít nhất số điện thoại hoặc Zalo.' },
  PRIMARY_CONTACT_EXISTS: { code: 'CM_VALIDATION_FAILED', message: 'Khách hàng đã có người liên hệ chính đang hoạt động. Bỏ đánh dấu người cũ trước.' },
  NOT_DIFFERENT: { code: 'CM_VALIDATION_FAILED', message: 'Thông tin pháp lý mới không khác thông tin hiện tại.' },
  EVIDENCE_REQUIRED: { code: 'CM_VALIDATION_FAILED', message: 'Cần chọn tài liệu chứng minh của chính khách hàng này.' },
  SELF_APPROVAL: { code: 'CM_PERMISSION_DENIED', message: 'Người đề nghị không được tự duyệt.' },
  STORAGE_UNAVAILABLE: { code: 'CM_STORAGE_UNAVAILABLE', message: 'Chưa có dịch vụ lưu trữ file được phê duyệt — chưa tải lên được tài liệu (BLOCKED).' },
};
const SESSION_LOST = new Set(['SESSION_INVALID', 'UNAUTHENTICATED', 'AUTHENTICATION_REQUIRED']);

const qs = (q: Query): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
// The same filter as a JSON body (POST routes that take query-shaped fields): set values only, as strings.
const fields = (q: Query): Record<string, string> => Object.fromEntries(
  Object.entries(q).flatMap(([k, v]) => (v === undefined || v === null || v === '' ? [] : [[k, String(v)]])),
);
// Gate 1 screens ask "every appointment" as from '0000' / to '9999' (the mock compares strings); the API takes ISO
// date-times only, so a bound that is not one becomes the widest window.
const WIDE = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' } as const;
const bound = (v: string | undefined, fallback: string): string => (v !== undefined && v.includes('T') && !Number.isNaN(Date.parse(v)) ? v : fallback);
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export class ApiCrmAdapter implements CrmAdapter {
  readonly kind = 'API' as const;
  private readonly listeners = new Set<() => void>();
  private permissions: ReadonlySet<Permission> = new Set();

  constructor(private readonly base = '/api/cm') {}

  capabilities(): CapabilityStatus[] {
    const host = 'Backend CRM qua Module Host (controlledWrite: IAM + rule B12 + audit Foundation cùng giao dịch)';
    return [
      { feature: 'Khách hàng, pháp lý (2 cấp duyệt), liên hệ, nhóm, phân công, bàn giao, hoạt động', state: 'INTEGRATED', reason: host },
      { feature: 'Metadata tài liệu & cảnh báo hết hạn', state: 'INTEGRATED', reason: host },
      { feature: 'Upload / phiên bản / tải file', state: 'BLOCKED', reason: 'Chưa có dịch vụ lưu trữ file được phê duyệt (STORAGE_UNAVAILABLE)' },
      { feature: 'Lịch hẹn, nhắc lịch (trong ứng dụng)', state: 'INTEGRATED', reason: host },
      { feature: 'Công việc (To-do), chuyển To-do khi bàn giao (OD-07)', state: 'INTEGRATED', reason: host },
      { feature: 'Báo cáo công việc', state: 'INTEGRATED', reason: host },
      { feature: 'Tạo khách tổng hợp (một giao dịch)', state: 'INTEGRATED', reason: 'POST /api/cm/customers/full — lỗi ở bất kỳ phần nào thì hủy toàn bộ' },
      { feature: 'Xác nhận bàn giao thay (override)', state: 'BLOCKED', reason: 'D05 / OD-15 chưa quyết định — backend từ chối' },
      { feature: 'Che định danh pháp lý theo quyền', state: 'INTEGRATED', reason: 'Backend che theo đề xuất OD-05 (chưa duyệt) — một chỗ cấu hình' },
      { feature: 'Audit Foundation (BR-12)', state: 'INTEGRATED', reason: 'Host ghi SUCCESS / FAILURE / DENIED vào fnd_audit_logs' },
      { feature: 'Phân quyền IAM', state: 'INTEGRATED', reason: 'Danh sách quyền lấy từ IAM (GET /api/cm/session); mọi API tự kiểm lại' },
    ];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(): void { for (const l of [...this.listeners]) l(); }

  private async call<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown, text = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new CrmClientError('NETWORK', 'Không kết nối được máy chủ. Vui lòng thử lại.');
    }
    // Keep the UTF-8 BOM of the CSV (Excel needs it for Vietnamese text); Response.text() would strip it.
    if (res.ok && text) return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()) as T;
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* not JSON */ }
    if (res.ok) {
      if (!isJson(payload) || !('data' in payload)) throw new CrmClientError('UNEXPECTED_RESPONSE', 'Phản hồi máy chủ không đúng định dạng.');
      if (method !== 'GET') this.emit();
      return payload['data'] as T;
    }
    const error = isJson(payload) && isJson(payload['error']) ? payload['error'] : {};
    const code = typeof error['code'] === 'string' ? error['code'] : `HTTP_${res.status}`;
    const reason = isJson(error['details']) && typeof error['details']['reason'] === 'string' ? error['details']['reason'] : null;
    const mapped = reason ? REASONS[reason] : undefined;
    if (res.status === 401 || SESSION_LOST.has(code)) throw new CrmClientError('UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn.');
    if (mapped) throw new CrmClientError(mapped.code, mapped.message);
    const message = typeof error['message'] === 'string' ? error['message'] : code === 'FORBIDDEN' ? 'Tài khoản chưa được cấp quyền cho chức năng này.' : 'Không thực hiện được thao tác.';
    throw new CrmClientError(code, message);
  }
  private get<T>(path: string, q: Query = {}): Promise<T> { return this.call<T>('GET', `${path}${qs(q)}`); }
  // Optional parts of a screen (a right the account may not hold): 403 → empty, every other error is shown.
  private async optional<T>(p: Permission | null, fn: () => Promise<T[]>): Promise<T[]> {
    if (p !== null && !this.permissions.has(p)) return [];
    try { return await fn(); } catch (e) { if (e instanceof CrmClientError && (e.code === 'FORBIDDEN' || e.code === 'CM_PERMISSION_DENIED')) return []; throw e; }
  }

  // ------------------------------------------------------------------------------------------------- session / catalog
  async session(): Promise<Session> {
    const s = await this.get<{ account: Account; permissions: Permission[] }>('/session');
    this.permissions = new Set(s.permissions);
    return { account: s.account, permissions: this.permissions };
  }
  accounts(): Promise<Account[]> { return this.get('/accounts'); }
  provinces(): Promise<Province[]> { return this.get('/references/provinces'); }
  regions(): Promise<{ regions: { code: string; name: string }[]; macroRegions: { code: string; name: string }[] }> { return this.get('/references/regions'); }
  groups(): Promise<Group[]> { return this.get('/groups'); }

  // ---------------------------------------------------------------------------------------------------------- customers
  listCustomers(q: CustomerQuery): Promise<Page<CustomerView>> {
    return this.get('/customers', { ...q, includeHidden: q.includeHidden === undefined ? undefined : String(q.includeHidden) });
  }
  visibleCustomers(): Promise<Customer[]> { return this.get('/customers/visible'); }
  async customerBundle(customerId: string): Promise<CustomerBundle> {
    const id = encodeURIComponent(customerId);
    const core = await this.get<Omit<CustomerBundle, 'handovers' | 'appointments' | 'tasks' | 'reports'>>(`/customers/${id}/bundle`);
    const [handovers, appointments, tasks, reports] = await Promise.all([
      this.optional('crm.assignment.read', () => this.get<Handover[]>('/handovers', { customerId })),
      this.optional(null, () => this.get<Appointment[]>('/appointments', { ...WIDE, customerId, includeCancelled: 'true' })),
      this.optional(null, () => this.listTasks({ customerId })),
      this.optional(null, () => this.get<WorkReport[]>('/work-reports', { customerId })),
    ]);
    return { ...core, handovers, appointments, tasks, reports: [...reports].sort((a, b) => b.workDate.localeCompare(a.workDate)) };
  }
  checkIdentity(type: IdentifierType, value: string, countryCode: string, name?: string) {
    return this.call<{ normalized: string | null; duplicate: boolean; similarNameCount: number }>('POST', '/customers/check-identity',
      fields({ identifierType: type, identifier: value, countryCode, name }));
  }
  createCustomer(input: CustomerInput): Promise<{ customer: Customer; warnings: string[] }> { return this.call('POST', '/customers', input); }
  createCustomerFull(input: CustomerCreateBundle): Promise<{ customer: Customer; warnings: string[] }> { return this.call('POST', '/customers/full', input); }
  updateCustomer(customerId: string, patch: CustomerPatch): Promise<Customer> { return this.call('PATCH', `/customers/${encodeURIComponent(customerId)}`, patch); }
  verifyCustomer(customerId: string, input: Partial<CustomerInput>): Promise<Customer> {
    return this.call('POST', `/customers/${encodeURIComponent(customerId)}/verify`, input);
  }
  hideCustomer(customerId: string): Promise<Customer> { return this.call('POST', `/customers/${encodeURIComponent(customerId)}/hide`, {}); }
  exportCustomersCsv(q: CustomerQuery): Promise<string> {
    return this.call<string>('POST', '/customers/export', fields({ ...q, includeHidden: q.includeHidden === undefined ? undefined : String(q.includeHidden), page: undefined, pageSize: undefined }), true);
  }
  async setCustomerGroups(customerId: string, groupIds: string[]): Promise<void> {
    await this.call('PUT', `/customers/${encodeURIComponent(customerId)}/groups`, { groupIds });
  }
  createGroup(input: { groupCode: string; groupName: string; parentGroupId?: string | null; description?: string | null }): Promise<Group> {
    return this.call('POST', '/groups', input);
  }
  updateGroup(groupId: string, patch: { groupName?: string; parentGroupId?: string | null; description?: string | null; isActive?: boolean }): Promise<Group> {
    return this.call('PATCH', `/groups/${encodeURIComponent(groupId)}`, patch);
  }

  // ----------------------------------------------------------------------------------------------------------- contacts
  createContact(customerId: string, input: ContactInput): Promise<Contact> { return this.call('POST', `/customers/${encodeURIComponent(customerId)}/contacts`, input); }
  updateContact(contactId: string, patch: Partial<ContactInput>): Promise<Contact> { return this.call('PATCH', `/contacts/${encodeURIComponent(contactId)}`, patch); }
  deactivateContact(contactId: string): Promise<Contact> { return this.call('POST', `/contacts/${encodeURIComponent(contactId)}/deactivate`, {}); }

  // ------------------------------------------------------------------------------------------- assignments / handovers
  addAssignment(customerId: string, saleAccountId: string, role: AssignmentRole): Promise<Assignment> {
    return this.call('POST', `/customers/${encodeURIComponent(customerId)}/assignments`, { saleAccountId, role });
  }
  endAssignment(assignmentId: string): Promise<Assignment> { return this.call('POST', `/assignments/${encodeURIComponent(assignmentId)}/end`, {}); }
  listHandovers(): Promise<Handover[]> { return this.optional('crm.assignment.read', () => this.get<Handover[]>('/handovers')); }
  async requestHandover(customerId: string, mode: HandoverMode, toSaleAccountId: string, note?: string | null): Promise<Handover> {
    return (await this.call<{ handover: Handover }>('POST', `/customers/${encodeURIComponent(customerId)}/handovers`, { mode, toSaleAccountId, note: note ?? null })).handover;
  }
  async approveHandover(handoverId: string): Promise<Handover> {
    return (await this.call<{ handover: Handover }>('POST', `/handovers/${encodeURIComponent(handoverId)}/approve`, {})).handover;
  }
  async acknowledgeHandover(handoverId: string, overrideReason?: string | null): Promise<Handover> {
    return (await this.call<{ handover: Handover }>('POST', `/handovers/${encodeURIComponent(handoverId)}/acknowledge`, overrideReason ? { overrideReason } : {})).handover;
  }
  async rejectHandover(handoverId: string, reason: string): Promise<Handover> {
    return (await this.call<{ handover: Handover }>('POST', `/handovers/${encodeURIComponent(handoverId)}/reject`, { reason })).handover;
  }

  // ------------------------------------------------------------------------------------------------------- legal change
  listLegalChanges(): Promise<LegalChange[]> { return this.optional('crm.legal_change.read', () => this.get<LegalChange[]>('/legal-changes')); }
  requestLegalChange(customerId: string, input: LegalChangeInput): Promise<LegalChange> {
    return this.call('POST', `/customers/${encodeURIComponent(customerId)}/legal-changes`, input);
  }
  decideLegalChange(changeRequestId: string, stage: 'MANAGEMENT' | 'ACCOUNTING', decision: 'APPROVED' | 'REJECTED', note?: string | null): Promise<LegalChange> {
    return this.call('POST', `/legal-changes/${encodeURIComponent(changeRequestId)}/decisions`, { stage, decision, note: note ?? null });
  }

  // --------------------------------------------------------------------------------------------------------- activities
  recentActivities(limit: number): Promise<Activity[]> { return this.optional('crm.activity.read', () => this.get<Activity[]>('/activities/recent', { limit })); }
  createActivity(customerId: string, input: ActivityInput): Promise<Activity> { return this.call('POST', `/customers/${encodeURIComponent(customerId)}/activities`, input); }
  updateActivity(activityId: string, patch: Partial<ActivityInput> & { activityStatus?: 'OPEN' | 'CANCELLED' }): Promise<Activity> {
    const { activityType: _type, occurredAt: _at, ...rest } = patch; // history fields are not editable (backend rule)
    return this.call('PATCH', `/activities/${encodeURIComponent(activityId)}`, rest);
  }
  completeActivity(activityId: string): Promise<Activity> { return this.call('POST', `/activities/${encodeURIComponent(activityId)}/complete`, {}); }

  // ---------------------------------------------------------------------------------------------------------- documents
  // Upload: the backend answers 503 STORAGE_UNAVAILABLE (no approved Storage service) — shown as is, nothing is faked.
  createDocument(customerId: string, _input: DocumentInput, _supersedesDocumentId?: string | null): Promise<CrmDocument> {
    return this.call('POST', `/customers/${encodeURIComponent(customerId)}/documents`, {});
  }
  updateDocumentMetadata(documentId: string, patch: DocumentMetadata): Promise<CrmDocument> { return this.call('PATCH', `/documents/${encodeURIComponent(documentId)}`, patch); }
  expiringDocuments(withinDays: number): Promise<CrmDocument[]> {
    return this.optional('crm.document.read', () => this.get<CrmDocument[]>('/documents/expiring', { withinDays }));
  }

  // ------------------------------------------------------------------------------------------------------- appointments
  listAppointments(q: AppointmentQuery): Promise<Appointment[]> {
    return this.get('/appointments', { from: bound(q.from, WIDE.from), to: bound(q.to, WIDE.to), customerId: q.customerId, mineOnly: q.mineOnly ? 'true' : undefined,
      includeCancelled: q.includeCancelled === false ? 'false' : 'true' });
  }
  createAppointment(input: AppointmentInput): Promise<Appointment> { return this.call('POST', '/appointments', input); }
  updateAppointment(appointmentId: string, patch: Partial<AppointmentInput>): Promise<Appointment> {
    return this.call('PATCH', `/appointments/${encodeURIComponent(appointmentId)}`, patch);
  }
  cancelAppointment(appointmentId: string, reason: string): Promise<Appointment> {
    return this.call('POST', `/appointments/${encodeURIComponent(appointmentId)}/cancel`, { reason });
  }
  completeAppointment(appointmentId: string, outcome: string): Promise<Appointment> {
    return this.call('POST', `/appointments/${encodeURIComponent(appointmentId)}/complete`, { outcome });
  }
  // The server's clock decides what is due (the `now` argument of the mock is not sent).
  dueReminders(_now: Date): Promise<Reminder[]> { return this.get('/appointments/reminders/due'); }
  async dismissReminder(appointmentId: string): Promise<void> {
    await this.call('POST', `/appointments/${encodeURIComponent(appointmentId)}/reminder-dismissals`, {});
  }

  // ------------------------------------------------------------------------------------------------------------- tasks
  async listTasks(q: TaskQuery): Promise<Task[]> {
    const rows = await this.get<(Omit<Task, 'history'> & { history?: Task['history'] })[]>('/tasks', {
      status: q.status, customerId: q.customerId, mineOnly: q.mineOnly ? 'true' : undefined, q: q.q, overdueOnly: q.overdueOnly ? 'true' : undefined });
    return rows.map((t) => ({ ...t, history: t.history ?? [] }));
  }
  createTask(input: TaskInput): Promise<Task> { return this.call('POST', '/tasks', input); }
  updateTask(taskId: string, patch: Partial<TaskInput> & { status?: Task['status'] }): Promise<Task> {
    const id = encodeURIComponent(taskId);
    const { status, ...rest } = patch;
    if (status === 'DONE') return this.completeTask(taskId);
    // Cancelling needs a reason (POST /tasks/:id/cancel); the Gate 1 form has none — refused honestly, nothing is sent.
    if (status === 'CANCELLED') return Promise.reject(new CrmClientError('CM_VALIDATION_FAILED', 'Hủy công việc cần nhập lý do.'));
    return this.call('PATCH', `/tasks/${id}`, status === undefined ? rest : { ...rest, status });
  }
  completeTask(taskId: string): Promise<Task> { return this.call('POST', `/tasks/${encodeURIComponent(taskId)}/complete`, {}); }

  // ----------------------------------------------------------------------------------------------------------- reports
  listReports(q: ReportQuery): Promise<WorkReport[]> { return this.get('/work-reports', { ...q }); }
  createReport(input: ReportInput): Promise<WorkReport> { return this.call('POST', '/work-reports', input); }
  updateReport(reportId: string, patch: Partial<ReportInput>): Promise<WorkReport> { return this.call('PATCH', `/work-reports/${encodeURIComponent(reportId)}`, patch); }
  submitReport(reportId: string): Promise<WorkReport> { return this.call('POST', `/work-reports/${encodeURIComponent(reportId)}/submit`, {}); }
}
