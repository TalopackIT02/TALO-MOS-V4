// CRM V1 — client domain model. Names follow the accepted Data Dictionary (cm.*, 15 tables / 173 columns) in camelCase.
// Appointment, Task and WorkReport are DISTINCT business objects (owner order IV): they have no table yet (Gate 2,
// CRM_V1_DB_EXTENSION_APPROVAL) and only exist in the Mock Adapter.

export type CustomerType = 'COMPANY' | 'BRANCH' | 'HOUSEHOLD' | 'PERSON' | 'FOREIGN_NO_VN_REG';
export type CustomerStatus = 'PROSPECT' | 'NEW' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type RecordStatus = 'DRAFT' | 'VERIFIED';
export type IdentifierType = 'VN_TAX_ID' | 'VN_PERSONAL_ID' | 'FOREIGN_REG';

export interface Account {
  readonly accountId: string;
  readonly fullName: string;
  readonly title: string;
  readonly active: boolean;
}

export interface Ward { readonly code: string; readonly name: string }
export interface Province { readonly code: string; readonly name: string; readonly region: string; readonly macro: string; readonly wards: readonly Ward[] }

export interface Customer {
  customerId: string;
  customerCode: string;
  displayName: string;
  legalName: string | null;
  customerType: CustomerType;
  customerStatus: CustomerStatus;
  recordStatus: RecordStatus;
  legalIdentifierType: IdentifierType | null;
  legalIdentifier: string | null;
  representativeName: string | null;
  representativePhone: string | null;
  addressLine: string | null;
  provinceCode: string | null;
  wardCode: string | null;
  countryCode: string;
  foreignLocality: string | null;
  foreignStateProvince: string | null;
  registeredAddress: string | null;
  internalNote: string | null;
  isHidden: boolean;
  groupIds: string[];
  createdAt: string;
  createdAccountId: string;
  updatedAt: string | null;
}

export interface Contact {
  contactId: string;
  customerId: string;
  fullName: string;
  positionTitle: string | null;
  phone: string | null;
  zaloPhone: string | null;
  email: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface Group { groupId: string; groupCode: string; groupName: string; parentGroupId: string | null; description: string | null; isActive: boolean }

export type AssignmentRole = 'PRIMARY' | 'SUPPORT';
export interface Assignment {
  assignmentId: string;
  customerId: string;
  saleAccountId: string;
  role: AssignmentRole;
  assignedAt: string;
  assignedByAccountId: string | null;
  endedAt: string | null;
  endedByAccountId: string | null;
  handoverToAccountId: string | null;
}

export type HandoverMode = 'MANAGER_INITIATED' | 'SALE_INITIATED';
export type HandoverStatus = 'PENDING_APPROVAL' | 'PENDING_CURRENT_ACK' | 'PENDING_RECEIVER_ACK' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export interface Handover {
  handoverId: string;
  customerId: string;
  fromAssignmentId: string;
  currentSaleAccountId: string;
  toSaleAccountId: string;
  initiatedByAccountId: string;
  mode: HandoverMode;
  status: HandoverStatus;
  requestedAt: string;
  note: string | null;
  managerApprovedByAccountId: string | null;
  currentAckByAccountId: string | null;
  currentAckOverrideByAccountId: string | null;
  currentAckOverrideReason: string | null;
  receiverAckByAccountId: string | null;
  rejectedByAccountId: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  transferredActivityIds: string[];
}

export type LegalStatus = 'PENDING_MANAGEMENT' | 'PENDING_ACCOUNTING' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
export interface LegalDecision { stage: 'MANAGEMENT' | 'ACCOUNTING'; decision: 'APPROVED' | 'REJECTED'; decidedByAccountId: string; decidedAt: string; note: string | null }
export interface LegalChange {
  changeRequestId: string;
  customerId: string;
  requestedByAccountId: string;
  requestedAt: string;
  status: LegalStatus;
  reason: string;
  evidenceDocumentId: string;
  oldLegalName: string | null;
  newLegalName: string;
  oldCustomerType: CustomerType;
  newCustomerType: CustomerType;
  oldIdentifierType: IdentifierType | null;
  newIdentifierType: IdentifierType;
  oldIdentifier: string | null;
  newIdentifier: string;
  oldCountryCode: string;
  newCountryCode: string;
  decisions: LegalDecision[];
  appliedAt: string | null;
}

export type ActivityType = 'NOTE' | 'CALL' | 'MEETING' | 'TASK' | 'FOLLOW_UP' | 'HANDOVER';
export type ActivityStatus = 'OPEN' | 'DONE' | 'CANCELLED';
// cm_customer_activities: "Hoạt động & Kết quả" of a customer (business log), not a calendar entry nor a to-do.
export interface Activity {
  activityId: string;
  customerId: string;
  activityType: ActivityType;
  activityStatus: ActivityStatus;
  title: string;
  description: string | null;
  occurredAt: string;
  dueAt: string | null;
  assignedToAccountId: string | null;
  createdByAccountId: string;
  completedAt: string | null;
}

export type DocumentType = 'LEGAL' | 'CONTRACT' | 'AUTHORIZATION' | 'OTHER';
export interface CrmDocument {
  documentId: string;
  customerId: string;
  documentName: string;
  documentType: DocumentType;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedByAccountId: string;
  uploadedAt: string;
  note: string | null;
  signedDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  supersedesDocumentId: string | null;
  mockOnly: boolean; // true = metadata created by the mock (no real file stored)
}

// ---- Not in the accepted database (Gate 2): mock-only business objects -----------------------------------------
export type AppointmentStatus = 'SCHEDULED' | 'DONE' | 'CANCELLED';
export interface Appointment {
  appointmentId: string;
  title: string;
  customerId: string | null;
  contactId: string | null;
  ownerAccountId: string;
  startAt: string;
  endAt: string;
  location: string | null;
  description: string | null;
  remindMinutes: number | null;
  status: AppointmentStatus;
  cancelReason: string | null;
  outcome: string | null;
  createdAt: string;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export interface Task {
  taskId: string;
  title: string;
  description: string | null;
  customerId: string | null;
  assigneeAccountId: string;
  createdByAccountId: string;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number; // 0..100
  completedAt: string | null;
  createdAt: string;
}

export type ReportStatus = 'DRAFT' | 'SUBMITTED';
export interface WorkReport {
  reportId: string;
  authorAccountId: string;
  workDate: string; // YYYY-MM-DD
  workDone: string;
  results: string;
  issues: string | null;
  nextSteps: string | null;
  customerIds: string[];
  appointmentIds: string[];
  taskIds: string[];
  status: ReportStatus;
  submittedAt: string | null;
  updatedAt: string;
}

// Permission codes of the CRM catalogue (K05: crm.<function>.<action>).
export type Permission =
  | 'crm.customer.read' | 'crm.customer.read_all' | 'crm.customer.create' | 'crm.customer.update' | 'crm.customer.verify' | 'crm.customer.hide'
  | 'crm.customer.export' | 'crm.legal_change.read' | 'crm.legal_change.request' | 'crm.legal_change.approve_management'
  | 'crm.legal_change.approve_accounting' | 'crm.contact.read' | 'crm.contact.manage' | 'crm.group.read' | 'crm.group.manage' | 'crm.group.assign'
  | 'crm.assignment.read' | 'crm.assignment.manage' | 'crm.handover.request' | 'crm.handover.approve' | 'crm.handover.acknowledge'
  | 'crm.handover.reject' | 'crm.handover.override' | 'crm.activity.read' | 'crm.activity.create' | 'crm.activity.update'
  | 'crm.activity.complete' | 'crm.document.read' | 'crm.document.manage' | 'crm.reference.read';

export interface Session {
  readonly account: Account;
  readonly permissions: ReadonlySet<Permission>;
}
