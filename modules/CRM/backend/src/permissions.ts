import type { ModulePermission } from '../host.js';

// CRM K05 catalogue: moduleCode = 'CRM', resourceCode = function key, operation = action key,
// permission_code = lower('CRM.<FUNCTION>.<ACTION>'). NONE of these rows exists on TEST (no MIC / IAM registration yet).
//   REV01 functions (CM-BE-SPEC-REV01, unchanged): CUSTOMER, LEGAL_CHANGE, CONTACT, GROUP, ASSIGNMENT, HANDOVER, ACTIVITY,
//   DOCUMENT, REFERENCE — the permission codes are exactly the ones the accepted Gate 1 frontend uses (types/domain.ts).
//   APPOINTMENT / TASK / WORK_REPORT: OD-11 option (b) — PROPOSAL, PENDING. Option (a) would map them onto ACTIVITY.*;
//   only this table changes. APPOINTMENT.REMIND_DISMISS is a Gate 3 addition (every Host write needs a K05 action) — OD-G3-03.

export const CRM_MODULE_KEY = 'CRM';

function perm(functionKey: string, actionKey: string): ModulePermission {
  return { permissionCode: `crm.${functionKey}.${actionKey}`.toLowerCase(), moduleCode: CRM_MODULE_KEY, resourceCode: functionKey, operation: actionKey };
}

export const P = {
  customerRead: perm('CUSTOMER', 'READ'),
  customerReadAll: perm('CUSTOMER', 'READ_ALL'),
  customerCreate: perm('CUSTOMER', 'CREATE'),
  customerUpdate: perm('CUSTOMER', 'UPDATE'),
  customerVerify: perm('CUSTOMER', 'VERIFY'),
  customerHide: perm('CUSTOMER', 'HIDE'),
  customerExport: perm('CUSTOMER', 'EXPORT'),
  legalRead: perm('LEGAL_CHANGE', 'READ'),
  legalRequest: perm('LEGAL_CHANGE', 'REQUEST'),
  legalApproveManagement: perm('LEGAL_CHANGE', 'APPROVE_MANAGEMENT'),
  legalApproveAccounting: perm('LEGAL_CHANGE', 'APPROVE_ACCOUNTING'),
  contactRead: perm('CONTACT', 'READ'),
  contactManage: perm('CONTACT', 'MANAGE'),
  groupRead: perm('GROUP', 'READ'),
  groupManage: perm('GROUP', 'MANAGE'),
  groupAssign: perm('GROUP', 'ASSIGN'),
  assignmentRead: perm('ASSIGNMENT', 'READ'),
  assignmentManage: perm('ASSIGNMENT', 'MANAGE'),
  handoverRequest: perm('HANDOVER', 'REQUEST'),
  handoverApprove: perm('HANDOVER', 'APPROVE'),
  handoverAcknowledge: perm('HANDOVER', 'ACKNOWLEDGE'),
  handoverReject: perm('HANDOVER', 'REJECT'),
  handoverOverride: perm('HANDOVER', 'OVERRIDE'),
  activityRead: perm('ACTIVITY', 'READ'),
  activityCreate: perm('ACTIVITY', 'CREATE'),
  activityUpdate: perm('ACTIVITY', 'UPDATE'),
  activityComplete: perm('ACTIVITY', 'COMPLETE'),
  documentRead: perm('DOCUMENT', 'READ'),
  documentManage: perm('DOCUMENT', 'MANAGE'),
  referenceRead: perm('REFERENCE', 'READ'),
  appointmentRead: perm('APPOINTMENT', 'READ'),
  appointmentCreate: perm('APPOINTMENT', 'CREATE'),
  appointmentUpdate: perm('APPOINTMENT', 'UPDATE'),
  appointmentRemindDismiss: perm('APPOINTMENT', 'REMIND_DISMISS'),
  taskRead: perm('TASK', 'READ'),
  taskCreate: perm('TASK', 'CREATE'),
  taskUpdate: perm('TASK', 'UPDATE'),
  taskAssign: perm('TASK', 'ASSIGN'),
  reportRead: perm('WORK_REPORT', 'READ'),
  reportReadAll: perm('WORK_REPORT', 'READ_ALL'),
  reportCreate: perm('WORK_REPORT', 'CREATE'),
  reportSubmit: perm('WORK_REPORT', 'SUBMIT'),
} as const satisfies Record<string, ModulePermission>;

// Session permission list (GET /cm/session): the frontend shows / hides actions with it; every API re-checks IAM itself.
export const SESSION_PERMISSIONS: readonly ModulePermission[] = Object.values(P);

// MIC-08 audit action code: 'CRM.<FUNCTION>.<ACTION>'.
export const actionCode = (p: ModulePermission): string => `${p.moduleCode}.${p.resourceCode}.${p.operation}`;

// Decisions still PENDING are isolated here (one place to change once the owner decides). Defaults keep REV01 as written.
export const POLICY = {
  // OD-05 (proposal, Gate 1 UI behaviour): the full legal identifier is shown / searchable only with this right.
  identifierViewPermission: P.legalRead,
  // FE-G01 (mock-only behaviour, PENDING): a creator without READ_ALL becomes PRIMARY of the customer they create.
  autoAssignCreatorAsPrimary: false,
  // D04 / OD-16 (PROPOSAL, PENDING): forbid approving one's own handover / legal-change request. REV01 does not.
  forbidSelfApproval: false,
  // D06 (default 30 days): "expiring soon" threshold for documents.
  expiringSoonDays: 30,
} as const;
