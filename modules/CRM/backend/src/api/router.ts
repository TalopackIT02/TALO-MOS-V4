import express from 'express';
import type { Request, Response, Router } from 'express';
import type { ModuleActor, ModuleHost } from '../../host.js';
import { CrmError } from '../errors.js';
import type { AppointmentService } from '../services/appointments.js';
import type { CatalogService } from '../services/catalog.js';
import type { CustomerService } from '../services/customers.js';
import type { HandoverService } from '../services/handovers.js';
import type { RelationService } from '../services/relations.js';
import type { ReportService } from '../services/reports.js';
import type { TaskService } from '../services/tasks.js';

// CRM API, mounted by the Host under /api. Prefix /cm = the CM-BE-SPEC-REV01 proposal (05_API_CONTRACT_DELTA).
// Every route goes through host.session (401 / 403 PASSWORD_CHANGE_REQUIRED rendered by the Host); the actor is the
// session's, never a body field. CrmError → { error: { code, message, requestId, details?: { reason } } }; Host errors
// (FORBIDDEN / SERVICE_BUSY) are rendered by the Host's session wrapper.

export interface CrmServices {
  readonly catalog: CatalogService;
  readonly customers: CustomerService;
  readonly relations: RelationService;
  readonly appointments: AppointmentService;
  readonly tasks: TaskService;
  readonly reports: ReportService;
  readonly handovers: HandoverService;
}

type Handler = (req: Request, actor: ModuleActor) => Promise<unknown>;

const param = (req: Request, name: string): string => String(req.params[name] ?? '');
const optionalCustomer = (req: Request): string | undefined => (typeof req.query['customerId'] === 'string' ? req.query['customerId'] : undefined);

export function crmRouter(host: Pick<ModuleHost, 'session'>, s: CrmServices): Router {
  const router = express.Router();
  const session = host.session.bind(host);
  const fail = (res: Response, error: unknown): void => {
    if (!(error instanceof CrmError)) throw error;
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals['requestId'],
      ...(error.reason ? { details: { reason: error.reason } } : {}) } });
  };
  const route = (status: number, fn: Handler) => session(async (req, res: Response, actor) => {
    try {
      res.status(status).json({ data: await fn(req, actor) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/cm/session', route(200, (_req, a) => s.catalog.session(a)));
  router.get('/cm/accounts', route(200, (_req, a) => s.catalog.accounts(a)));
  router.get('/cm/references/provinces', route(200, (_req, a) => s.catalog.provinces(a)));
  router.get('/cm/references/regions', route(200, (_req, a) => s.catalog.regions(a)));

  router.get('/cm/groups', route(200, (_req, a) => s.relations.groups(a)));
  router.post('/cm/groups', route(201, (req, a) => s.relations.createGroup(a, req.body)));
  router.patch('/cm/groups/:id', route(200, (req, a) => s.relations.updateGroup(a, param(req, 'id'), req.body)));

  router.get('/cm/customers', route(200, (req, a) => s.customers.list(a, req.query)));
  router.get('/cm/customers/visible', route(200, (_req, a) => s.customers.visible(a)));
  // POST (no row change): check-identity takes the identifier in the body, never in a URL / access log; export writes the
  // export audit row (rt.write), so it is not a GET. Every GET without a path parameter answers 200 JSON (FMI-03 postcheck).
  router.post('/cm/customers/check-identity', route(200, (req, a) => s.customers.checkIdentity(a, req.body)));
  router.post('/cm/customers/export', session(async (req, res, actor) => {
    try {
      const csv = await s.customers.exportCsv(actor, req.body);
      res.status(200).type('text/csv; charset=utf-8').setHeader('Content-Disposition', 'attachment; filename="crm-customers.csv"');
      res.send(csv);
    } catch (error) {
      fail(res, error);
    }
  }));
  router.post('/cm/customers', route(201, (req, a) => s.customers.create(a, req.body)));
  router.post('/cm/customers/full', route(201, (req, a) => s.customers.createFull(a, req.body)));
  router.get('/cm/customers/:id', route(200, (req, a) => s.customers.get(a, param(req, 'id'))));
  router.get('/cm/customers/:id/bundle', route(200, (req, a) => s.relations.bundle(a, param(req, 'id'))));
  router.patch('/cm/customers/:id', route(200, (req, a) => s.customers.update(a, param(req, 'id'), req.body)));
  router.post('/cm/customers/:id/verify', route(200, (req, a) => s.customers.verify(a, param(req, 'id'), req.body)));
  router.post('/cm/customers/:id/hide', route(200, (req, a) => s.customers.hide(a, param(req, 'id'))));
  router.put('/cm/customers/:id/groups', route(200, (req, a) => s.relations.setCustomerGroups(a, param(req, 'id'), req.body)));

  router.get('/cm/legal-changes', route(200, (req, a) => s.customers.listLegalChanges(a, optionalCustomer(req))));
  router.post('/cm/customers/:id/legal-changes', route(201, (req, a) => s.customers.requestLegalChange(a, param(req, 'id'), req.body)));
  router.post('/cm/legal-changes/:id/decisions', route(200, (req, a) => s.customers.decide(a, param(req, 'id'), req.body)));

  router.post('/cm/customers/:id/contacts', route(201, (req, a) => s.relations.createContact(a, param(req, 'id'), req.body)));
  router.patch('/cm/contacts/:id', route(200, (req, a) => s.relations.updateContact(a, param(req, 'id'), req.body)));
  router.post('/cm/contacts/:id/deactivate', route(200, (req, a) => s.relations.deactivateContact(a, param(req, 'id'))));

  router.post('/cm/customers/:id/assignments', route(201, (req, a) => s.relations.addAssignment(a, param(req, 'id'), req.body)));
  router.post('/cm/assignments/:id/end', route(200, (req, a) => s.relations.endAssignment(a, param(req, 'id'))));

  router.get('/cm/handovers', route(200, (req, a) => s.handovers.list(a, optionalCustomer(req))));
  router.post('/cm/customers/:id/handovers', route(201, (req, a) => s.handovers.request(a, param(req, 'id'), req.body)));
  router.post('/cm/handovers/:id/approve', route(200, (req, a) => s.handovers.approve(a, param(req, 'id'))));
  router.post('/cm/handovers/:id/acknowledge', route(200, (req, a) => s.handovers.acknowledge(a, param(req, 'id'), req.body)));
  router.post('/cm/handovers/:id/reject', route(200, (req, a) => s.handovers.reject(a, param(req, 'id'), req.body)));

  router.get('/cm/activities/recent', route(200, (req, a) => s.relations.recentActivities(a, req.query)));
  router.post('/cm/customers/:id/activities', route(201, (req, a) => s.relations.createActivity(a, param(req, 'id'), req.body)));
  router.patch('/cm/activities/:id', route(200, (req, a) => s.relations.updateActivity(a, param(req, 'id'), req.body)));
  router.post('/cm/activities/:id/complete', route(200, (req, a) => s.relations.completeActivity(a, param(req, 'id'))));

  router.get('/cm/documents/expiring', route(200, (req, a) => s.relations.expiringDocuments(a, req.query)));
  router.post('/cm/customers/:id/documents', route(201, (req, a) => s.relations.createDocument(a, param(req, 'id'))));
  router.patch('/cm/documents/:id', route(200, (req, a) => s.relations.updateDocumentMetadata(a, param(req, 'id'), req.body)));

  router.get('/cm/appointments/reminders/due', route(200, (_req, a) => s.appointments.dueReminders(a)));
  router.get('/cm/appointments', route(200, (req, a) => s.appointments.list(a, req.query)));
  router.get('/cm/appointments/:id', route(200, (req, a) => s.appointments.get(a, param(req, 'id'))));
  router.post('/cm/appointments', route(201, (req, a) => s.appointments.create(a, req.body)));
  router.patch('/cm/appointments/:id', route(200, (req, a) => s.appointments.update(a, param(req, 'id'), req.body)));
  router.post('/cm/appointments/:id/cancel', route(200, (req, a) => s.appointments.cancel(a, param(req, 'id'), req.body)));
  router.post('/cm/appointments/:id/complete', route(200, (req, a) => s.appointments.complete(a, param(req, 'id'), req.body)));
  router.post('/cm/appointments/:id/reminder-dismissals', route(200, (req, a) => s.appointments.dismissReminder(a, param(req, 'id'))));

  router.get('/cm/tasks', route(200, (req, a) => s.tasks.list(a, req.query)));
  router.get('/cm/tasks/:id', route(200, (req, a) => s.tasks.get(a, param(req, 'id'))));
  router.post('/cm/tasks', route(201, (req, a) => s.tasks.create(a, req.body)));
  router.patch('/cm/tasks/:id', route(200, (req, a) => s.tasks.update(a, param(req, 'id'), req.body)));
  router.post('/cm/tasks/:id/complete', route(200, (req, a) => s.tasks.complete(a, param(req, 'id'))));
  router.post('/cm/tasks/:id/cancel', route(200, (req, a) => s.tasks.cancel(a, param(req, 'id'), req.body)));

  router.get('/cm/work-reports', route(200, (req, a) => s.reports.list(a, req.query)));
  router.get('/cm/work-reports/:id', route(200, (req, a) => s.reports.get(a, param(req, 'id'))));
  router.post('/cm/work-reports', route(201, (req, a) => s.reports.create(a, req.body)));
  router.patch('/cm/work-reports/:id', route(200, (req, a) => s.reports.update(a, param(req, 'id'), req.body)));
  router.post('/cm/work-reports/:id/submit', route(200, (req, a) => s.reports.submit(a, param(req, 'id'))));
  return router;
}
