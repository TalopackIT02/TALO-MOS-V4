// CRM — MIC source (module.json "micEntry") for package 0.2.0. MIC-1.0 CANDIDATE, NOT REGISTERED. The Package Scanner and
// the Installer read mic/module.mic.json (data, never executed): it is GENERATED from this file by
// `scripts/export-mic.mts` and must be regenerated after every change here (the package hash covers both files).
// Registration, IAM K05 rows and the enabling of B12 rules are owner gates (Foundation installer + data-access review).
//   mic06 DIRECT_DB resources (cm.*) = the tables the backend writes, with the exact columns it names, and one access rule
//   per (action, operation) it performs. approvalMode NOT_REQUIRED is DECLARED here; B12 rows are still created with
//   is_enabled = FALSE by SUBMIT, and nothing in the package can enable them.
//   UPDATE rules marked "lock" exist only because SELECT … FOR UPDATE through the Host needs an UPDATE / DELETE rule
//   (Host contract G3-02 §5; a separate LOCK operation would need a B12 CHECK change — open decision OD-G3-05).
//   The Host checks every operation of a transaction against the ONE action the API is bound to, so a composite write
//   (e.g. CUSTOMER.CREATE with contacts / sales / groups) declares a rule of that action on each table it touches.
// K05 catalogue: REV01 functions as written; APPOINTMENT / TASK / WORK_REPORT follow OD-11 option (b) — PROPOSAL, PENDING.

const MODULE_KEY = 'CRM';
const VERSION = '0.2.0';

const FUNCTIONS: Record<string, { name: string; actions: Record<string, string> }> = {
  CUSTOMER: {
    name: 'Khách hàng',
    actions: {
      READ: 'Xem khách hàng trong phạm vi', READ_ALL: 'Xem toàn bộ khách hàng', CREATE: 'Tạo khách hàng', UPDATE: 'Sửa thông tin thường',
      VERIFY: 'Xác minh hồ sơ (DRAFT → VERIFIED)', HIDE: 'Ẩn khách hàng', EXPORT: 'Xuất danh sách khách hàng',
    },
  },
  LEGAL_CHANGE: {
    name: 'Thay đổi pháp lý',
    actions: { READ: 'Xem đề nghị và định danh đầy đủ', REQUEST: 'Đề nghị thay đổi pháp lý', APPROVE_MANAGEMENT: 'Duyệt cấp quản lý', APPROVE_ACCOUNTING: 'Duyệt cấp kế toán' },
  },
  CONTACT: { name: 'Người liên hệ', actions: { READ: 'Xem người liên hệ', MANAGE: 'Thêm / sửa / ngừng người liên hệ' } },
  GROUP: { name: 'Nhóm ngành', actions: { READ: 'Xem nhóm', MANAGE: 'Quản lý danh mục nhóm', ASSIGN: 'Gán nhóm cho khách hàng' } },
  ASSIGNMENT: { name: 'Phân công Sale', actions: { READ: 'Xem lịch sử phân công', MANAGE: 'Thêm Sale / kết thúc Sale hỗ trợ' } },
  HANDOVER: {
    name: 'Bàn giao khách hàng',
    actions: { REQUEST: 'Đề nghị bàn giao', APPROVE: 'Duyệt bàn giao', ACKNOWLEDGE: 'Xác nhận bàn giao', REJECT: 'Từ chối bàn giao', OVERRIDE: 'Xác nhận thay (chưa mở)' },
  },
  ACTIVITY: { name: 'Hoạt động & kết quả', actions: { READ: 'Xem hoạt động', CREATE: 'Ghi hoạt động', UPDATE: 'Sửa / hủy hoạt động mở', COMPLETE: 'Hoàn thành hoạt động' } },
  DOCUMENT: { name: 'Tài liệu khách hàng', actions: { READ: 'Xem tài liệu', MANAGE: 'Cập nhật metadata tài liệu' } },
  REFERENCE: { name: 'Danh mục tham chiếu', actions: { READ: 'Xem tỉnh / phường / vùng' } },
  APPOINTMENT: {
    name: 'Lịch hẹn',
    actions: { READ: 'Xem lịch hẹn', CREATE: 'Tạo lịch hẹn', UPDATE: 'Sửa / hủy / ghi kết quả lịch hẹn', REMIND_DISMISS: 'Tắt nhắc lịch' },
  },
  TASK: { name: 'Công việc (To-do)', actions: { READ: 'Xem công việc', CREATE: 'Tạo công việc', UPDATE: 'Cập nhật công việc', ASSIGN: 'Giao việc cho người khác' } },
  WORK_REPORT: {
    name: 'Báo cáo công việc',
    actions: { READ: 'Xem báo cáo của mình', READ_ALL: 'Xem báo cáo đã nộp của người khác', CREATE: 'Lập / sửa báo cáo nháp', SUBMIT: 'Nộp báo cáo' },
  },
};

const READ_NATURE = new Set(['READ', 'READ_ALL']);
const ERRORS = ['CM_VALIDATION_FAILED', 'CM_CUSTOMER_NOT_FOUND', 'CM_PERMISSION_DENIED', 'CM_CONCURRENT_UPDATE', 'MODULE_UNAVAILABLE', 'SERVICE_BUSY', 'FORBIDDEN'];
const CUSTOMER_ERRORS = [...ERRORS, 'CM_IDENTITY_DUPLICATE', 'CM_INVALID_PROVINCE_WARD', 'CM_REFERENCE_UNAVAILABLE', 'CM_APPROVAL_REQUIRED', 'CM_DRAFT_NOT_ELIGIBLE'];
const HANDOVER_ERRORS = [...ERRORS, 'CM_HANDOVER_INVALID_STATE'];

type Op = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
const col = (name: string, type: string, extra: { required?: boolean; primaryKey?: boolean } = {}) => ({ name, type, ...extra });
const rule = (functionKey: string, actionKey: string, operation: Op) =>
  ({ functionKey, actionKey, operation, ...(operation === 'SELECT' ? {} : { approvalMode: 'NOT_REQUIRED' as const }) });
const resource = (resourceKey: string, table: string, columns: ReturnType<typeof col>[], access: ReturnType<typeof rule>[]) =>
  ({ resourceKey, interfaceKind: 'DIRECT_DB' as const, schema: 'cm', table, columns, relations: [], access });

const uuid = (n: string, extra = {}) => col(n, 'uuid', extra);
const tz = (n: string, extra = {}) => col(n, 'timestamptz', extra);
const txt = (n: string, extra = {}) => col(n, 'text', extra);
const vc = (n: string, extra = {}) => col(n, 'varchar', extra);
const bool = (n: string, extra = {}) => col(n, 'bool', extra);
const chr = (n: string, extra = {}) => col(n, 'bpchar', extra);
const day = (n: string, extra = {}) => col(n, 'date', extra);

// MIC-05 path parameters are written {name} (MIC-1.0; the Host maps them to Express :name).
const api = (method: string, path: string, functionKey: string, actionKey: string, errors: string[] = ERRORS) =>
  ({ method, path: `/api/cm${path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`, functionKey, actionKey, errors });

export const CRM_MIC = {
  mic01Identity: { moduleKey: MODULE_KEY, moduleName: 'Quản lý khách hàng (CRM)', moduleVersion: VERSION, micStandard: 'MIC-1.0' },
  mic02Functions: Object.entries(FUNCTIONS).map(([functionKey, f]) => ({ functionKey, name: f.name })),
  mic03Actions: Object.entries(FUNCTIONS).flatMap(([functionKey, f]) => Object.entries(f.actions).map(([actionKey, name]) => ({
    functionKey, actionKey, name, nature: READ_NATURE.has(actionKey) ? 'READ' : 'WRITE',
  }))),
  mic04Navigation: [
    { menuLabel: 'CRM' },
    // Navigation Builder offers a Function only with exactly ONE MIC-04 route: the Sale workspace (every widget is gated
    // per permission) hangs on REFERENCE, which every CRM user holds for /session; CUSTOMER keeps /crm/customers.
    { routePath: '/crm', screenKey: 'crm.workspace', menuLabel: 'Tổng quan công việc', functionKey: 'REFERENCE' },
    { routePath: '/crm/customers', screenKey: 'crm.customers', menuLabel: 'Khách hàng', functionKey: 'CUSTOMER' },
    { routePath: '/crm/calendar', screenKey: 'crm.calendar', menuLabel: 'Lịch hẹn', functionKey: 'APPOINTMENT' },
    { routePath: '/crm/tasks', screenKey: 'crm.tasks', menuLabel: 'Công việc', functionKey: 'TASK' },
    { routePath: '/crm/reports', screenKey: 'crm.reports', menuLabel: 'Báo cáo', functionKey: 'WORK_REPORT' },
  ],
  mic05Api: [
    api('GET', '/session', 'REFERENCE', 'READ'), // session only: the permission list is evaluated per action
    api('GET', '/accounts', 'CUSTOMER', 'READ'),
    api('GET', '/references/provinces', 'REFERENCE', 'READ', [...ERRORS, 'CM_REFERENCE_UNAVAILABLE']),
    api('GET', '/references/regions', 'REFERENCE', 'READ'),
    api('GET', '/groups', 'GROUP', 'READ'),
    api('POST', '/groups', 'GROUP', 'MANAGE'),
    api('PATCH', '/groups/:id', 'GROUP', 'MANAGE'),
    api('GET', '/customers', 'CUSTOMER', 'READ'),
    api('GET', '/customers/visible', 'CUSTOMER', 'READ'),
    api('POST', '/customers/check-identity', 'CUSTOMER', 'CREATE'),
    api('POST', '/customers/export', 'CUSTOMER', 'EXPORT'),
    api('POST', '/customers', 'CUSTOMER', 'CREATE', CUSTOMER_ERRORS),
    api('POST', '/customers/full', 'CUSTOMER', 'CREATE', CUSTOMER_ERRORS),
    api('GET', '/customers/:id', 'CUSTOMER', 'READ'),
    api('GET', '/customers/:id/bundle', 'CUSTOMER', 'READ'),
    api('PATCH', '/customers/:id', 'CUSTOMER', 'UPDATE', CUSTOMER_ERRORS),
    api('POST', '/customers/:id/verify', 'CUSTOMER', 'VERIFY', CUSTOMER_ERRORS),
    api('POST', '/customers/:id/hide', 'CUSTOMER', 'HIDE'),
    api('PUT', '/customers/:id/groups', 'GROUP', 'ASSIGN'),
    api('GET', '/legal-changes', 'LEGAL_CHANGE', 'READ'),
    api('POST', '/customers/:id/legal-changes', 'LEGAL_CHANGE', 'REQUEST', CUSTOMER_ERRORS),
    api('POST', '/legal-changes/:id/decisions', 'LEGAL_CHANGE', 'APPROVE_MANAGEMENT', CUSTOMER_ERRORS), // ACCOUNTING stage: APPROVE_ACCOUNTING
    api('POST', '/customers/:id/contacts', 'CONTACT', 'MANAGE'),
    api('PATCH', '/contacts/:id', 'CONTACT', 'MANAGE'),
    api('POST', '/contacts/:id/deactivate', 'CONTACT', 'MANAGE'),
    api('POST', '/customers/:id/assignments', 'ASSIGNMENT', 'MANAGE'),
    api('POST', '/assignments/:id/end', 'ASSIGNMENT', 'MANAGE'),
    api('GET', '/handovers', 'ASSIGNMENT', 'READ'),
    api('POST', '/customers/:id/handovers', 'HANDOVER', 'REQUEST', HANDOVER_ERRORS),
    api('POST', '/handovers/:id/approve', 'HANDOVER', 'APPROVE', HANDOVER_ERRORS),
    api('POST', '/handovers/:id/acknowledge', 'HANDOVER', 'ACKNOWLEDGE', HANDOVER_ERRORS),
    api('POST', '/handovers/:id/reject', 'HANDOVER', 'REJECT', HANDOVER_ERRORS),
    api('GET', '/activities/recent', 'ACTIVITY', 'READ'),
    api('POST', '/customers/:id/activities', 'ACTIVITY', 'CREATE'),
    api('PATCH', '/activities/:id', 'ACTIVITY', 'UPDATE'),
    api('POST', '/activities/:id/complete', 'ACTIVITY', 'COMPLETE'),
    api('GET', '/documents/expiring', 'DOCUMENT', 'READ'),
    api('POST', '/customers/:id/documents', 'DOCUMENT', 'MANAGE'), // upload: 503 STORAGE_UNAVAILABLE (no Storage service)
    api('PATCH', '/documents/:id', 'DOCUMENT', 'MANAGE'),
    api('GET', '/appointments/reminders/due', 'APPOINTMENT', 'READ'),
    api('GET', '/appointments', 'APPOINTMENT', 'READ'),
    api('GET', '/appointments/:id', 'APPOINTMENT', 'READ'),
    api('POST', '/appointments', 'APPOINTMENT', 'CREATE'),
    api('PATCH', '/appointments/:id', 'APPOINTMENT', 'UPDATE'),
    api('POST', '/appointments/:id/cancel', 'APPOINTMENT', 'UPDATE'),
    api('POST', '/appointments/:id/complete', 'APPOINTMENT', 'UPDATE'),
    api('POST', '/appointments/:id/reminder-dismissals', 'APPOINTMENT', 'REMIND_DISMISS'),
    api('GET', '/tasks', 'TASK', 'READ'),
    api('GET', '/tasks/:id', 'TASK', 'READ'),
    api('POST', '/tasks', 'TASK', 'CREATE'),
    api('PATCH', '/tasks/:id', 'TASK', 'UPDATE'),
    api('POST', '/tasks/:id/complete', 'TASK', 'UPDATE'),
    api('POST', '/tasks/:id/cancel', 'TASK', 'UPDATE'),
    api('GET', '/work-reports', 'WORK_REPORT', 'READ'),
    api('GET', '/work-reports/:id', 'WORK_REPORT', 'READ'),
    api('POST', '/work-reports', 'WORK_REPORT', 'CREATE'),
    api('PATCH', '/work-reports/:id', 'WORK_REPORT', 'CREATE'),
    api('POST', '/work-reports/:id/submit', 'WORK_REPORT', 'SUBMIT'),
  ],
  mic06DataResources: [
    resource('CM_CUSTOMERS', 'cm_customers', [
      uuid('customer_id', { primaryKey: true }), vc('display_name', { required: true }), vc('legal_name'), txt('registered_address'), vc('representative_name'),
      vc('representative_phone'), vc('customer_type_code', { required: true }), vc('customer_status_code', { required: true }), txt('internal_note'),
      uuid('created_account_id'), tz('updated_at'), uuid('updated_account_id'), bool('is_hidden', { required: true }), vc('legal_identifier_type_code'),
      vc('legal_identifier_normalized'), txt('address_line'), chr('province_code'), chr('ward_code'), chr('country_code', { required: true }), vc('foreign_locality'),
      vc('foreign_state_province'), vc('record_status_code', { required: true }),
    ], [
      rule('CUSTOMER', 'READ', 'SELECT'), rule('CUSTOMER', 'CREATE', 'INSERT'), rule('CUSTOMER', 'UPDATE', 'UPDATE'), rule('CUSTOMER', 'VERIFY', 'UPDATE'),
      rule('CUSTOMER', 'HIDE', 'UPDATE'),
      rule('LEGAL_CHANGE', 'APPROVE_ACCOUNTING', 'UPDATE'), // applies the approved legal snapshot
    ]),
    resource('CM_CUSTOMER_CONTACTS', 'cm_customer_contacts', [
      uuid('contact_id', { primaryKey: true }), uuid('customer_id', { required: true }), vc('full_name', { required: true }), vc('position_title'), vc('phone'),
      vc('zalo_phone'), vc('email'), bool('is_primary', { required: true }), bool('is_active', { required: true }), tz('updated_at'), uuid('created_account_id'),
    ], [rule('CONTACT', 'READ', 'SELECT'), rule('CONTACT', 'MANAGE', 'INSERT'), rule('CONTACT', 'MANAGE', 'UPDATE'), rule('CUSTOMER', 'CREATE', 'INSERT')]),
    resource('CM_CUSTOMER_GROUPS', 'cm_customer_groups', [
      uuid('group_id', { primaryKey: true }), vc('group_code', { required: true }), vc('group_name', { required: true }), uuid('parent_group_id'), txt('description'),
      bool('is_active', { required: true }), uuid('created_account_id'),
    ], [rule('GROUP', 'READ', 'SELECT'), rule('GROUP', 'MANAGE', 'INSERT'), rule('GROUP', 'MANAGE', 'UPDATE')]),
    resource('CM_CUSTOMER_GROUP_MEMBERS', 'cm_customer_group_members', [
      uuid('customer_id', { primaryKey: true }), uuid('group_id', { primaryKey: true }), uuid('assigned_account_id'),
    ], [rule('GROUP', 'ASSIGN', 'INSERT'), rule('GROUP', 'ASSIGN', 'DELETE'), rule('CUSTOMER', 'CREATE', 'INSERT')]),
    resource('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', 'cm_customer_legal_change_requests', [
      uuid('change_request_id', { primaryKey: true }), uuid('customer_id', { required: true }), uuid('requested_by_account_id', { required: true }),
      vc('status_code', { required: true }), txt('reason', { required: true }), uuid('evidence_document_id', { required: true }), vc('old_legal_name'),
      vc('new_legal_name', { required: true }), chr('old_country_code', { required: true }), chr('new_country_code', { required: true }), vc('old_customer_type_code'),
      vc('new_customer_type_code', { required: true }), vc('old_identifier_type_code'), vc('new_identifier_type_code', { required: true }),
      vc('old_identifier_normalized'), vc('new_identifier_normalized', { required: true }), tz('resolved_at'), tz('applied_at'), uuid('applied_by_account_id'),
    ], [
      rule('LEGAL_CHANGE', 'READ', 'SELECT'), rule('LEGAL_CHANGE', 'REQUEST', 'INSERT'), rule('LEGAL_CHANGE', 'APPROVE_MANAGEMENT', 'UPDATE'),
      rule('LEGAL_CHANGE', 'APPROVE_ACCOUNTING', 'UPDATE'),
    ]),
    resource('CM_CUSTOMER_LEGAL_CHANGE_APPROVALS', 'cm_customer_legal_change_approvals', [
      uuid('approval_id', { primaryKey: true }), uuid('change_request_id', { required: true }), vc('stage_code', { required: true }), vc('decision_code', { required: true }),
      uuid('decided_by_account_id', { required: true }), txt('decision_note'),
    ], [rule('LEGAL_CHANGE', 'APPROVE_MANAGEMENT', 'INSERT'), rule('LEGAL_CHANGE', 'APPROVE_ACCOUNTING', 'INSERT')]),
    resource('CM_CUSTOMER_DOCUMENTS', 'cm_customer_documents', [
      uuid('document_id', { primaryKey: true }), uuid('customer_id', { required: true }), vc('document_name', { required: true }), vc('document_type_code', { required: true }),
      txt('note'), day('signed_date'), day('effective_date'), day('expiry_date'),
    ], [rule('DOCUMENT', 'READ', 'SELECT'), rule('DOCUMENT', 'MANAGE', 'UPDATE')]),
    resource('CM_APPOINTMENTS', 'cm_appointments', [
      uuid('appointment_id', { primaryKey: true }), vc('title', { required: true }), uuid('customer_id'), uuid('contact_id'), uuid('owner_account_id', { required: true }),
      uuid('created_by_account_id', { required: true }), tz('start_at', { required: true }), tz('end_at', { required: true }), vc('location'), txt('description'),
      col('remind_minutes', 'int4'), vc('status_code', { required: true }), txt('cancel_reason'), tz('cancelled_at'), uuid('cancelled_by_account_id'), txt('outcome'),
      tz('completed_at'), tz('created_at'), tz('updated_at'), uuid('updated_by_account_id'), uuid('review_handover_id'), tz('review_flagged_at'),
    ], [
      rule('APPOINTMENT', 'READ', 'SELECT'), rule('APPOINTMENT', 'CREATE', 'INSERT'), rule('APPOINTMENT', 'UPDATE', 'UPDATE'),
      rule('HANDOVER', 'ACKNOWLEDGE', 'UPDATE'), // OD-19 review flag
    ]),
    resource('CM_APPOINTMENT_REMINDER_DISMISSALS', 'cm_appointment_reminder_dismissals', [
      uuid('appointment_id', { primaryKey: true }), uuid('account_id', { primaryKey: true }), tz('dismissed_at'),
    ], [rule('APPOINTMENT', 'REMIND_DISMISS', 'INSERT')]),
    resource('CM_TASKS', 'cm_tasks', [
      uuid('task_id', { primaryKey: true }), vc('title', { required: true }), txt('description'), uuid('customer_id'), uuid('created_by_account_id', { required: true }),
      uuid('assignee_account_id', { required: true }), tz('due_at'), vc('priority_code', { required: true }), col('progress_percent', 'int2', { required: true }),
      vc('status_code', { required: true }), tz('completed_at'), tz('cancelled_at'), txt('cancel_reason'), tz('created_at'), tz('updated_at'), uuid('updated_by_account_id'),
    ], [
      rule('TASK', 'READ', 'SELECT'), rule('TASK', 'CREATE', 'INSERT'), rule('TASK', 'UPDATE', 'UPDATE'),
      rule('HANDOVER', 'ACKNOWLEDGE', 'UPDATE'), // OD-07 transfer
    ]),
    resource('CM_TASK_ASSIGNMENT_HISTORY', 'cm_task_assignment_history', [
      uuid('history_id', { primaryKey: true }), uuid('task_id', { required: true }), uuid('customer_id'), uuid('previous_assignee_account_id', { required: true }),
      uuid('new_assignee_account_id', { required: true }), uuid('changed_by_account_id', { required: true }), tz('changed_at'), vc('reason_code', { required: true }),
      uuid('handover_id'),
    ], [rule('TASK', 'UPDATE', 'INSERT'), rule('HANDOVER', 'ACKNOWLEDGE', 'INSERT')]),
    resource('CM_WORK_REPORTS', 'cm_work_reports', [
      uuid('report_id', { primaryKey: true }), uuid('author_account_id', { required: true }), col('work_date', 'date'), txt('work_done', { required: true }),
      txt('results', { required: true }), txt('issues'), txt('next_steps'), vc('status_code', { required: true }), tz('submitted_at'), tz('created_at'), tz('updated_at'),
    ], [
      rule('WORK_REPORT', 'READ', 'SELECT'), rule('WORK_REPORT', 'CREATE', 'INSERT'), rule('WORK_REPORT', 'CREATE', 'UPDATE'), rule('WORK_REPORT', 'SUBMIT', 'UPDATE'),
    ]),
    ...([['CM_WORK_REPORT_CUSTOMERS', 'cm_work_report_customers', 'customer_id'], ['CM_WORK_REPORT_APPOINTMENTS', 'cm_work_report_appointments', 'appointment_id'],
      ['CM_WORK_REPORT_TASKS', 'cm_work_report_tasks', 'task_id']] as const).map(([key, table, other]) => resource(key, table,
      [uuid('report_id', { primaryKey: true }), uuid(other, { primaryKey: true })], [rule('WORK_REPORT', 'CREATE', 'INSERT'), rule('WORK_REPORT', 'CREATE', 'DELETE')])),
    resource('CM_CUSTOMER_HANDOVERS', 'cm_customer_handovers', [
      uuid('handover_id', { primaryKey: true }), uuid('customer_id', { required: true }), uuid('from_assignment_id', { required: true }),
      uuid('to_sale_account_id', { required: true }), uuid('initiated_by_account_id', { required: true }), vc('handover_mode_code', { required: true }),
      vc('status_code', { required: true }), tz('requested_at'), uuid('manager_approved_by_account_id'), tz('manager_approved_at'), uuid('current_ack_by_account_id'),
      tz('current_ack_at'), uuid('receiver_ack_by_account_id'), tz('receiver_ack_at'), tz('completed_at'), txt('handover_note'), uuid('rejected_by_account_id'),
      tz('rejected_at'), txt('rejection_reason'),
    ], [
      rule('HANDOVER', 'REQUEST', 'INSERT'), rule('HANDOVER', 'APPROVE', 'UPDATE'), rule('HANDOVER', 'ACKNOWLEDGE', 'UPDATE'), rule('HANDOVER', 'REJECT', 'UPDATE'),
    ]),
    resource('CM_CUSTOMER_ASSIGNMENTS', 'cm_customer_assignments', [
      uuid('assignment_id', { primaryKey: true }), uuid('customer_id', { required: true }), uuid('sale_account_id', { required: true }), uuid('assigned_by_account_id'),
      tz('assigned_at'), tz('ended_at'), uuid('ended_by_account_id'), uuid('handover_to_account_id'), txt('handover_note'), tz('handover_accepted_at'),
      uuid('handover_accepted_by_account_id'), vc('assignment_role_code', { required: true }),
    ], [
      rule('ASSIGNMENT', 'READ', 'SELECT'), rule('ASSIGNMENT', 'MANAGE', 'INSERT'), rule('ASSIGNMENT', 'MANAGE', 'UPDATE'), rule('CUSTOMER', 'CREATE', 'INSERT'),
      rule('HANDOVER', 'REQUEST', 'UPDATE'), // lock only
      rule('HANDOVER', 'APPROVE', 'UPDATE'), // lock only
      rule('HANDOVER', 'REJECT', 'UPDATE'), // lock only
      rule('HANDOVER', 'ACKNOWLEDGE', 'UPDATE'), rule('HANDOVER', 'ACKNOWLEDGE', 'INSERT'),
    ]),
    resource('CM_CUSTOMER_ACTIVITIES', 'cm_customer_activities', [
      uuid('activity_id', { primaryKey: true }), uuid('customer_id', { required: true }), vc('activity_type_code', { required: true }),
      vc('activity_status_code', { required: true }), vc('title', { required: true }), txt('description'), tz('occurred_at'), tz('due_at'), uuid('assigned_to_account_id'),
      uuid('created_by_account_id'), tz('completed_at'),
    ], [
      rule('ACTIVITY', 'READ', 'SELECT'), rule('ACTIVITY', 'CREATE', 'INSERT'), rule('ACTIVITY', 'UPDATE', 'UPDATE'), rule('ACTIVITY', 'COMPLETE', 'UPDATE'),
      rule('HANDOVER', 'ACKNOWLEDGE', 'UPDATE'),
    ]),
    resource('CM_CUSTOMER_HANDOVER_ACTIVITY_TRANSFERS', 'cm_customer_handover_activity_transfers', [
      uuid('transfer_id', { primaryKey: true }), uuid('handover_id', { required: true }), uuid('activity_id', { required: true }), uuid('customer_id', { required: true }),
      uuid('previous_assignee_account_id', { required: true }), uuid('new_assignee_account_id', { required: true }), uuid('transferred_by_account_id', { required: true }),
      tz('transferred_at'),
    ], [rule('HANDOVER', 'ACKNOWLEDGE', 'INSERT')]),
  ],
  mic07IamMapping: Object.entries(FUNCTIONS).flatMap(([functionKey, f]) => Object.keys(f.actions).map((actionKey) => ({
    functionKey, actionKey, moduleCode: MODULE_KEY, resourceCode: functionKey, operation: actionKey, minimumAssuranceLevel: 1,
  }))),
  mic08EventsAudit: {
    eventCodes: [],
    auditActionCodes: Object.entries(FUNCTIONS).flatMap(([functionKey, f]) => Object.keys(f.actions).map((actionKey) => `${MODULE_KEY}.${functionKey}.${actionKey}`)),
  },
  mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: ['CRM 0.2.0 candidate: first registration (customers, legal change, contacts, groups, assignments, handovers, activities, document metadata, appointments, To-dos, work reports)'] },
  mic10Manifest: {
    manifestVersion: 'MIC-1.0',
    hashAlgorithm: 'SHA-256',
    testEvidence: [{ name: 'CRM 0.2.0 candidate (clone only)', result: 'NOT_TESTED', reference: 'CRM_IMPLEMENTATION_PROGRESS_REPORT' }],
  },
};

export const CRM_MIC_STATUS = 'CANDIDATE_NOT_REGISTERED' as const;
export const MIC_JSON_PATH = 'mic/module.mic.json' as const;
