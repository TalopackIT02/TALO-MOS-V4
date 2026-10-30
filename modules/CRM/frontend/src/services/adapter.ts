import type {
  Account, Activity, ActivityType, Appointment, Assignment, AssignmentRole, Contact, CrmDocument, Customer, CustomerStatus, CustomerType,
  DocumentType, Group, Handover, HandoverMode, IdentifierType, LegalChange, Province, Session, Task, TaskPriority, TaskStatus, WorkReport,
} from '../types/domain';

// CRM client adapter boundary (owner order III): screens only talk to this interface. Implementations:
//   MockCrmAdapter  — in-browser data + the CM-BE-SPEC-REV01 business rules (current, labelled "Mô phỏng");
//   API adapter     — /api/cm/* through the Module Host once the write capability exists (BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY).
// Every call is async and may reject with CrmClientError (same codes as the backend error catalogue).

export class CrmClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CrmClientError';
  }
}

export type IntegrationState = 'MOCK' | 'INTEGRATED' | 'BLOCKED';

// Where each capability currently comes from — shown to the user so mock behaviour is never mistaken for real data.
export interface CapabilityStatus {
  readonly feature: string;
  readonly state: IntegrationState;
  readonly reason: string;
}

export interface Page<T> { readonly items: T[]; readonly total: number; readonly page: number; readonly pageSize: number }

export interface CustomerQuery {
  q?: string;
  customerType?: CustomerType | '';
  customerStatus?: CustomerStatus | '';
  recordStatus?: 'DRAFT' | 'VERIFIED' | '';
  provinceCode?: string;
  saleAccountId?: string;
  groupId?: string;
  includeHidden?: boolean;
  sort?: 'code' | 'name' | 'createdAt';
  page?: number;
  pageSize?: number;
}

export interface CustomerBundle {
  customer: Customer;
  contacts: Contact[];
  assignments: Assignment[];
  handovers: Handover[];
  legalChanges: LegalChange[];
  activities: Activity[];
  documents: CrmDocument[];
  appointments: Appointment[];
  tasks: Task[];
}

export interface CustomerInput {
  customerType: CustomerType;
  displayName: string;
  customerStatus?: CustomerStatus;
  legalName?: string | null;
  legalIdentifierType?: IdentifierType | null;
  legalIdentifier?: string | null;
  representativeName?: string | null;
  representativePhone?: string | null;
  addressLine?: string | null;
  provinceCode?: string | null;
  wardCode?: string | null;
  countryCode?: string;
  foreignLocality?: string | null;
  foreignStateProvince?: string | null;
  internalNote?: string | null;
}

export type CustomerPatch = Partial<Pick<CustomerInput, 'displayName' | 'customerStatus' | 'representativeName' | 'representativePhone' | 'addressLine'
  | 'provinceCode' | 'wardCode' | 'foreignLocality' | 'foreignStateProvince' | 'internalNote'>>;

export interface LegalChangeInput {
  reason: string;
  evidenceDocumentId: string;
  newLegalName: string;
  newCustomerType: CustomerType;
  newIdentifierType: IdentifierType;
  newIdentifier: string;
  newCountryCode: string;
}

export interface ContactInput { fullName: string; positionTitle?: string | null; phone?: string | null; zaloPhone?: string | null; email?: string | null; isPrimary?: boolean }
export interface ActivityInput { activityType: Exclude<ActivityType, 'HANDOVER'>; title: string; description?: string | null; occurredAt?: string; dueAt?: string | null; assignedToAccountId?: string | null }
export interface DocumentInput { documentName: string; documentType: DocumentType; fileName: string; fileType: string; fileSize: number; note?: string | null; signedDate?: string | null; effectiveDate?: string | null; expiryDate?: string | null }
export type DocumentMetadata = Partial<Pick<DocumentInput, 'documentName' | 'documentType' | 'note' | 'signedDate' | 'effectiveDate' | 'expiryDate'>>;
export interface AppointmentInput { title: string; customerId: string | null; contactId?: string | null; startAt: string; endAt: string; location?: string | null; description?: string | null; remindMinutes?: number | null }
export interface AppointmentQuery { from: string; to: string; customerId?: string; mineOnly?: boolean; includeCancelled?: boolean }
export interface TaskInput { title: string; description?: string | null; customerId: string | null; assigneeAccountId?: string; dueAt?: string | null; priority?: TaskPriority; progress?: number }
export interface TaskQuery { status?: TaskStatus | 'OPEN' | ''; customerId?: string; mineOnly?: boolean; q?: string; overdueOnly?: boolean }
export interface ReportInput { workDate: string; workDone: string; results: string; issues?: string | null; nextSteps?: string | null; customerIds?: string[]; appointmentIds?: string[]; taskIds?: string[] }
export interface ReportQuery { from?: string; to?: string; authorAccountId?: string; status?: 'DRAFT' | 'SUBMITTED' | '' }
export interface Reminder { appointment: Appointment; minutesLeft: number }

export interface CrmAdapter {
  readonly kind: 'MOCK' | 'API';
  capabilities(): CapabilityStatus[];
  subscribe(listener: () => void): () => void;

  session(): Promise<Session>;
  accounts(): Promise<Account[]>;
  provinces(): Promise<Province[]>;
  groups(): Promise<Group[]>;

  listCustomers(q: CustomerQuery): Promise<Page<Customer>>;
  visibleCustomers(): Promise<Customer[]>;
  customerBundle(customerId: string): Promise<CustomerBundle>;
  checkIdentity(type: IdentifierType, value: string, countryCode: string, name?: string): Promise<{ normalized: string | null; duplicate: boolean; similarNameCount: number }>;
  createCustomer(input: CustomerInput): Promise<{ customer: Customer; warnings: string[] }>;
  updateCustomer(customerId: string, patch: CustomerPatch): Promise<Customer>;
  verifyCustomer(customerId: string, input: Partial<CustomerInput>): Promise<Customer>;
  hideCustomer(customerId: string): Promise<Customer>;
  exportCustomersCsv(q: CustomerQuery): Promise<string>;
  setCustomerGroups(customerId: string, groupIds: string[]): Promise<void>;
  createGroup(input: { groupCode: string; groupName: string; parentGroupId?: string | null; description?: string | null }): Promise<Group>;
  updateGroup(groupId: string, patch: { groupName?: string; parentGroupId?: string | null; description?: string | null; isActive?: boolean }): Promise<Group>;

  createContact(customerId: string, input: ContactInput): Promise<Contact>;
  updateContact(contactId: string, patch: Partial<ContactInput>): Promise<Contact>;
  deactivateContact(contactId: string): Promise<Contact>;

  addAssignment(customerId: string, saleAccountId: string, role: AssignmentRole): Promise<Assignment>;
  endAssignment(assignmentId: string): Promise<Assignment>;
  listHandovers(): Promise<Handover[]>;
  requestHandover(customerId: string, mode: HandoverMode, toSaleAccountId: string, note?: string | null): Promise<Handover>;
  approveHandover(handoverId: string): Promise<Handover>;
  acknowledgeHandover(handoverId: string, overrideReason?: string | null): Promise<Handover>;
  rejectHandover(handoverId: string, reason: string): Promise<Handover>;

  listLegalChanges(): Promise<LegalChange[]>;
  requestLegalChange(customerId: string, input: LegalChangeInput): Promise<LegalChange>;
  decideLegalChange(changeRequestId: string, stage: 'MANAGEMENT' | 'ACCOUNTING', decision: 'APPROVED' | 'REJECTED', note?: string | null): Promise<LegalChange>;

  recentActivities(limit: number): Promise<Activity[]>;
  createActivity(customerId: string, input: ActivityInput): Promise<Activity>;
  updateActivity(activityId: string, patch: Partial<ActivityInput> & { activityStatus?: 'OPEN' | 'CANCELLED' }): Promise<Activity>;
  completeActivity(activityId: string): Promise<Activity>;

  createDocument(customerId: string, input: DocumentInput, supersedesDocumentId?: string | null): Promise<CrmDocument>;
  updateDocumentMetadata(documentId: string, patch: DocumentMetadata): Promise<CrmDocument>;
  expiringDocuments(withinDays: number): Promise<CrmDocument[]>;

  listAppointments(q: AppointmentQuery): Promise<Appointment[]>;
  createAppointment(input: AppointmentInput): Promise<Appointment>;
  updateAppointment(appointmentId: string, patch: Partial<AppointmentInput>): Promise<Appointment>;
  cancelAppointment(appointmentId: string, reason: string): Promise<Appointment>;
  completeAppointment(appointmentId: string, outcome: string): Promise<Appointment>;
  dueReminders(now: Date): Promise<Reminder[]>;
  dismissReminder(appointmentId: string): Promise<void>;

  listTasks(q: TaskQuery): Promise<Task[]>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(taskId: string, patch: Partial<TaskInput> & { status?: TaskStatus }): Promise<Task>;
  completeTask(taskId: string): Promise<Task>;

  listReports(q: ReportQuery): Promise<WorkReport[]>;
  createReport(input: ReportInput): Promise<WorkReport>;
  updateReport(reportId: string, patch: Partial<ReportInput>): Promise<WorkReport>;
  submitReport(reportId: string): Promise<WorkReport>;
}
