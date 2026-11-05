import type { Router } from 'express';
import type { ModuleHost } from './host.js';
import { crmRouter } from './src/api/router.js';
import type { CrmServices } from './src/api/router.js';
import { CrmRuntime } from './src/runtime.js';
import { AppointmentService } from './src/services/appointments.js';
import { CatalogService } from './src/services/catalog.js';
import { CustomerService } from './src/services/customers.js';
import { HandoverService } from './src/services/handovers.js';
import { RelationService } from './src/services/relations.js';
import { ReportService } from './src/services/reports.js';
import { TaskService } from './src/services/tasks.js';

// CRM — backend entry of the package (module.json "backendEntry", Host protocol TALO-MODULE-HOST-1).
// STATUS 0.2.0-candidate: NOT_ACTIVATED. Business writes go through the Host capability `controlledWrite` only (no database
// connection of its own, no raw write SQL). Needs a Host that provides `controlledWrite`; the package is not installed,
// registered or enabled anywhere by this source.
// Served: session / accounts / references, customers (+ composite create, verify, hide, export), legal change (two-step
// approval), contacts, groups, assignments, handovers (request / approve / acknowledge / reject + OD-07 / OD-19),
// activities, document metadata, appointments, To-dos, work reports.
// Not served: document file upload (no Storage service: 503 STORAGE_UNAVAILABLE), handover override (D05 / OD-15 PENDING).

export { HOST_PROTOCOL } from './host.js';
export const REQUIRED_CAPABILITIES = ['session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'sqlstate', 'logger', 'controlledWrite'] as const;
export const CRM_BACKEND_STATUS = 'CANDIDATE_NOT_ACTIVATED' as const;

export interface CrmModule extends CrmServices {
  readonly router: Router;
}

export function createModule(host: ModuleHost): CrmModule {
  const rt = new CrmRuntime(host);
  const services: CrmServices = {
    catalog: new CatalogService(rt), customers: new CustomerService(rt), relations: new RelationService(rt),
    appointments: new AppointmentService(rt), tasks: new TaskService(rt), reports: new ReportService(rt), handovers: new HandoverService(rt),
  };
  return { router: crmRouter(host, services), ...services };
}
