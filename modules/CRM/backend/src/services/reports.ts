import { z } from 'zod';
import type { ModuleActor, ReadQuery, WriteTx } from '../../host.js';
import { NOW } from '../../host.js';
import { CrmError, invalid, notFound } from '../errors.js';
import { P } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, parseRows, requireCustomer, s, ts } from '../runtime.js';
import type { CrmCtx } from '../runtime.js';
import { asRead, parse } from './appointments.js';

// Work Report (G2, OD-12/18/21). WR-R01…WR-R10 of 04_BUSINESS_RULES_DELTA.md. Data: CM_WORK_REPORTS + the three link
// resources. DRAFT → SUBMITTED, no approval; only the author changes a DRAFT (content + links) and submits it. After
// SUBMITTED the database trigger refuses every change of the report and of its links (55000) — even if a code path here
// were wrong. Visible: the author's own reports; SUBMITTED reports of others with WORK_REPORT.READ_ALL (OD-11 b proposal).
// work_date: the DB default is the Asia/Ho_Chi_Minh business date (OD-21); a client value is accepted as YYYY-MM-DD.

const COLS = `r.report_id::text AS "reportId", r.author_account_id::text AS "authorAccountId", to_char(r.work_date, 'YYYY-MM-DD') AS "workDate",
  r.work_done AS "workDone", r.results, r.issues, r.next_steps AS "nextSteps", r.status_code AS status, ${ts('r.submitted_at')} AS "submittedAt",
  ${ts('r.created_at')} AS "createdAt", ${ts('r.updated_at')} AS "updatedAt",
  ARRAY(SELECT x.customer_id::text FROM cm.cm_work_report_customers AS x WHERE x.report_id = r.report_id ORDER BY 1) AS "customerIds",
  ARRAY(SELECT x.appointment_id::text FROM cm.cm_work_report_appointments AS x WHERE x.report_id = r.report_id ORDER BY 1) AS "appointmentIds",
  ARRAY(SELECT x.task_id::text FROM cm.cm_work_report_tasks AS x WHERE x.report_id = r.report_id ORDER BY 1) AS "taskIds"`;

export const reportRow = z.object({
  reportId: s, authorAccountId: s, workDate: s, workDone: s, results: s, issues: ns, nextSteps: ns, status: z.enum(['DRAFT', 'SUBMITTED']),
  submittedAt: ns, createdAt: s, updatedAt: s, customerIds: z.array(s), appointmentIds: z.array(s), taskIds: z.array(s),
});
export type ReportDto = z.infer<typeof reportRow>;

const VISIBLE = (author: number, readAll: number) => `(r.author_account_id = $${author}::uuid OR (r.status_code = 'SUBMITTED' AND $${readAll}::boolean))`;

const ids = z.array(UUID).max(200).optional();
export const reportBody = z.strictObject({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), workDone: z.string().trim().min(1).max(8000), results: z.string().trim().min(1).max(8000),
  issues: z.string().trim().max(8000).nullable().optional(), nextSteps: z.string().trim().max(8000).nullable().optional(),
  customerIds: ids, appointmentIds: ids, taskIds: ids,
});
export const reportPatch = reportBody.partial();
export const reportQuery = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), authorAccountId: UUID.optional(),
  customerId: UUID.optional(), status: z.enum(['DRAFT', 'SUBMITTED']).optional(),
});

const LINKS = [
  { key: 'customerIds', resource: 'CM_WORK_REPORT_CUSTOMERS', column: 'customer_id' },
  { key: 'appointmentIds', resource: 'CM_WORK_REPORT_APPOINTMENTS', column: 'appointment_id' },
  { key: 'taskIds', resource: 'CM_WORK_REPORT_TASKS', column: 'task_id' },
] as const;

async function load(q: ReadQuery, actorId: string, readAll: boolean, id: string): Promise<ReportDto> {
  const [row] = await q.query(`SELECT ${COLS} FROM cm.cm_work_reports AS r WHERE r.report_id = $1::uuid AND ${VISIBLE(2, 3)}`, [id, actorId, readAll]);
  if (row === undefined) throw notFound();
  return reportRow.parse(row);
}

// WR-R05: only objects in the author's scope can be linked (customers in scope; own / in-scope appointments and tasks).
async function checkTargets(q: ReadQuery, ctx: CrmCtx, b: { customerIds?: string[]; appointmentIds?: string[]; taskIds?: string[] }): Promise<void> {
  for (const id of b.customerIds ?? []) await requireCustomer(q, ctx.scope, id);
  const scope = [ctx.scope.readAll, ctx.scope.actorId];
  for (const id of b.appointmentIds ?? []) {
    const r = await q.query(`SELECT 1 FROM cm.cm_appointments AS a WHERE a.appointment_id = $3::uuid AND (a.owner_account_id = $2::uuid OR (a.customer_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = a.customer_id AND ${customerScope(1, 2)})))`, [...scope, id]);
    if (r.length !== 1) throw notFound();
  }
  for (const id of b.taskIds ?? []) {
    const r = await q.query(`SELECT 1 FROM cm.cm_tasks AS t WHERE t.task_id = $3::uuid AND (t.assignee_account_id = $2::uuid OR t.created_by_account_id = $2::uuid
      OR (t.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = t.customer_id AND ${customerScope(1, 2)})))`, [...scope, id]);
    if (r.length !== 1) throw notFound();
  }
}

// Replaces the links of one kind: deletes the removed, inserts the added (WR-R04: no duplicates).
async function replaceLinks(tx: WriteTx, reportId: string, current: readonly string[], wanted: readonly string[], resource: string, column: string): Promise<void> {
  const next = new Set(wanted);
  for (const id of current) if (!next.has(id)) await tx.delete(resource, { report_id: reportId, [column]: id });
  const have = new Set(current);
  for (const id of next) if (!have.has(id)) await tx.insert(resource, { report_id: reportId, [column]: id });
}

async function lockDraft(tx: WriteTx, ctx: CrmCtx, id: string): Promise<ReportDto> {
  const current = await load(asRead(tx), ctx.actor.userAccountId, false, id);
  const [locked] = await tx.lock('CM_WORK_REPORTS', { report_id: id }, ['status_code', 'author_account_id']);
  if (locked === undefined) throw notFound();
  if (locked['author_account_id'] !== ctx.actor.userAccountId) throw new CrmError(403, 'CM_PERMISSION_DENIED');
  if (locked['status_code'] !== 'DRAFT') throw invalid();
  return current;
}

export class ReportService {
  constructor(private readonly rt: CrmRuntime) {}

  async list(actor: ModuleActor, query: unknown) {
    const f = parse(reportQuery, query);
    return this.rt.read(actor, P.reportRead, async (ctx, q) => {
      const readAll = await ctx.allowed(P.reportReadAll);
      const params: unknown[] = [ctx.actor.userAccountId, readAll];
      let where = VISIBLE(1, 2);
      if (f.from) { params.push(f.from); where += ` AND r.work_date >= $${params.length}::date`; }
      if (f.to) { params.push(f.to); where += ` AND r.work_date <= $${params.length}::date`; }
      if (f.authorAccountId) { params.push(f.authorAccountId); where += ` AND r.author_account_id = $${params.length}::uuid`; }
      if (f.status) { params.push(f.status); where += ` AND r.status_code = $${params.length}`; }
      if (f.customerId) {
        params.push(f.customerId);
        where += ` AND EXISTS (SELECT 1 FROM cm.cm_work_report_customers AS x WHERE x.report_id = r.report_id AND x.customer_id = $${params.length}::uuid)`;
      }
      return parseRows(reportRow, await q.query(`SELECT ${COLS} FROM cm.cm_work_reports AS r WHERE ${where} ORDER BY r.work_date DESC, r.created_at DESC, r.report_id LIMIT 1000`, params));
    });
  }

  async get(actor: ModuleActor, id: string) {
    const reportId = parse(UUID, id);
    return this.rt.read(actor, P.reportRead, async (ctx, q) => load(q, ctx.actor.userAccountId, await ctx.allowed(P.reportReadAll), reportId));
  }

  async create(actor: ModuleActor, body: unknown) {
    const b = parse(reportBody, body);
    return this.rt.write(actor, P.reportCreate, { targetType: 'CM_WORK_REPORT' }, async (ctx, tx) => {
      await checkTargets(asRead(tx), ctx, b);
      const [row] = await tx.insert('CM_WORK_REPORTS', {
        author_account_id: ctx.actor.userAccountId, work_done: b.workDone, results: b.results, issues: b.issues ?? null, next_steps: b.nextSteps ?? null,
        ...(b.workDate ? { work_date: b.workDate } : {}),
      }, ['report_id']);
      const id = String(row?.['report_id']);
      tx.setAuditTarget(id);
      for (const l of LINKS) await replaceLinks(tx, id, [], [...new Set(b[l.key] ?? [])], l.resource, l.column);
      return load(asRead(tx), ctx.actor.userAccountId, false, id);
    });
  }

  async update(actor: ModuleActor, id: string, body: unknown) {
    const reportId = parse(UUID, id);
    const b = parse(reportPatch, body);
    return this.rt.write(actor, P.reportCreate, { targetType: 'CM_WORK_REPORT', targetId: reportId }, async (ctx, tx) => {
      const current = await lockDraft(tx, ctx, reportId);
      await checkTargets(asRead(tx), ctx, b);
      await tx.update('CM_WORK_REPORTS', { report_id: reportId, status_code: 'DRAFT' }, {
        work_done: b.workDone ?? current.workDone, results: b.results ?? current.results,
        issues: b.issues === undefined ? current.issues : b.issues, next_steps: b.nextSteps === undefined ? current.nextSteps : b.nextSteps,
        work_date: b.workDate ?? current.workDate, updated_at: NOW,
      });
      for (const l of LINKS) {
        const wanted = b[l.key];
        if (wanted !== undefined) await replaceLinks(tx, reportId, current[l.key], [...new Set(wanted)], l.resource, l.column);
      }
      return load(asRead(tx), ctx.actor.userAccountId, false, reportId);
    });
  }

  async submit(actor: ModuleActor, id: string) {
    const reportId = parse(UUID, id);
    return this.rt.write(actor, P.reportSubmit, { targetType: 'CM_WORK_REPORT', targetId: reportId }, async (ctx, tx) => {
      await lockDraft(tx, ctx, reportId);
      await tx.update('CM_WORK_REPORTS', { report_id: reportId, status_code: 'DRAFT' }, { status_code: 'SUBMITTED', submitted_at: NOW, updated_at: NOW });
      return load(asRead(tx), ctx.actor.userAccountId, false, reportId);
    });
  }
}
