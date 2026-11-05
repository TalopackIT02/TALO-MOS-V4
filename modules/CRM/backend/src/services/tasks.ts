import { z } from 'zod';
import type { ModuleActor, ReadQuery, WriteTx } from '../../host.js';
import { NOW } from '../../host.js';
import { CrmError, invalid, notFound } from '../errors.js';
import { P } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, parseRows, requireCustomer, s, ts } from '../runtime.js';
import type { CrmCtx, CrmScope } from '../runtime.js';
import { asRead, parse } from './appointments.js';

// To-do (G2, OD-06/07). TK-R01…TK-R10 of 04_BUSINESS_RULES_DELTA.md. Data: CM_TASKS, CM_TASK_ASSIGNMENT_HISTORY.
// Visible: assignee, creator, or a task of a customer in scope. Changed by its assignee or creator; giving the task to
// someone else needs TASK.ASSIGN (OD-11 b proposal) and writes a REASSIGN history row in the same transaction.
// DONE / CANCELLED are final; a task is never deleted.

const COLS = `t.task_id::text AS "taskId", t.title, t.description, t.customer_id::text AS "customerId",
  t.assignee_account_id::text AS "assigneeAccountId", t.created_by_account_id::text AS "createdByAccountId", ${ts('t.due_at')} AS "dueAt",
  t.priority_code AS priority, t.status_code AS status, t.progress_percent::int AS progress, ${ts('t.completed_at')} AS "completedAt",
  ${ts('t.cancelled_at')} AS "cancelledAt", t.cancel_reason AS "cancelReason", ${ts('t.created_at')} AS "createdAt", ${ts('t.updated_at')} AS "updatedAt"`;

const historyRow = z.object({ at: s, fromAccountId: s, toAccountId: s, changedByAccountId: s, reason: z.enum(['HANDOVER', 'REASSIGN']), handoverId: ns });
export const taskRow = z.object({
  taskId: s, title: s, description: ns, customerId: ns, assigneeAccountId: s, createdByAccountId: s, dueAt: ns,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']), status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']), progress: z.number().int(),
  completedAt: ns, cancelledAt: ns, cancelReason: ns, createdAt: s, updatedAt: ns,
});
export type TaskDto = z.infer<typeof taskRow> & { history: z.infer<typeof historyRow>[] };

const VISIBLE = (a: number, b: number) => `(t.assignee_account_id = $${b}::uuid OR t.created_by_account_id = $${b}::uuid OR (t.customer_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = t.customer_id AND ${customerScope(a, b)})))`;

const iso = z.string().datetime({ offset: true });
export const taskBody = z.strictObject({
  title: z.string().trim().min(1).max(255), description: z.string().trim().max(4000).nullable().optional(), customerId: UUID.nullable(),
  assigneeAccountId: UUID.optional(), dueAt: iso.nullable().optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});
export const taskPatch = taskBody.partial().extend({ status: z.enum(['TODO', 'IN_PROGRESS']).optional() });
export const taskQuery = z.strictObject({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'OPEN']).optional(), customerId: UUID.optional(),
  mineOnly: z.enum(['true', 'false']).optional(), q: z.string().trim().max(100).optional(), overdueOnly: z.enum(['true', 'false']).optional(),
});
const cancelBody = z.strictObject({ reason: z.string().trim().min(1).max(2000) });

async function load(q: ReadQuery, scope: CrmScope, id: string): Promise<TaskDto> {
  const [row] = await q.query(`SELECT ${COLS} FROM cm.cm_tasks AS t WHERE t.task_id = $1::uuid AND ${VISIBLE(2, 3)}`, [id, scope.readAll, scope.actorId]);
  if (row === undefined) throw notFound();
  const history = parseRows(historyRow, await q.query(`SELECT ${ts('h.changed_at')} AS at, h.previous_assignee_account_id::text AS "fromAccountId",
      h.new_assignee_account_id::text AS "toAccountId", h.changed_by_account_id::text AS "changedByAccountId", h.reason_code AS reason,
      h.handover_id::text AS "handoverId" FROM cm.cm_task_assignment_history AS h WHERE h.task_id = $1::uuid ORDER BY h.changed_at, h.history_id`, [id]));
  return { ...taskRow.parse(row), history };
}

// Locks an open, visible task the caller may change: its assignee, its creator, or a holder of TASK.ASSIGN (candidate
// rule — the Frontend V1 mock lets anyone who sees the task change it; open decision OD-G3-06).
async function lockOpen(tx: WriteTx, ctx: CrmCtx, id: string): Promise<TaskDto> {
  const current = await load(asRead(tx), ctx.scope, id);
  const [locked] = await tx.lock('CM_TASKS', { task_id: id }, ['status_code', 'assignee_account_id', 'created_by_account_id']);
  if (locked === undefined) throw notFound();
  const me = ctx.actor.userAccountId;
  if (locked['assignee_account_id'] !== me && locked['created_by_account_id'] !== me && !(await ctx.allowed(P.taskAssign))) {
    throw new CrmError(403, 'CM_PERMISSION_DENIED');
  }
  if (locked['status_code'] !== 'TODO' && locked['status_code'] !== 'IN_PROGRESS') throw invalid();
  return current;
}

export class TaskService {
  constructor(private readonly rt: CrmRuntime) {}

  async list(actor: ModuleActor, query: unknown) {
    const f = parse(taskQuery, query);
    return this.rt.read(actor, P.taskRead, async (ctx, q) => {
      const params: unknown[] = [ctx.scope.readAll, ctx.scope.actorId];
      let where = VISIBLE(1, 2);
      if (f.status === 'OPEN') where += ` AND t.status_code IN ('TODO', 'IN_PROGRESS')`;
      else if (f.status) { params.push(f.status); where += ` AND t.status_code = $${params.length}`; }
      if (f.customerId) { params.push(f.customerId); where += ` AND t.customer_id = $${params.length}::uuid`; }
      if (f.mineOnly === 'true') where += ' AND t.assignee_account_id = $2::uuid';
      if (f.q) { params.push(`%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); where += ` AND t.title ILIKE $${params.length}`; }
      // TK-R05: overdue is computed, never stored.
      if (f.overdueOnly === 'true') where += ` AND t.due_at < now() AND t.status_code IN ('TODO', 'IN_PROGRESS')`;
      return parseRows(taskRow, await q.query(`SELECT ${COLS} FROM cm.cm_tasks AS t WHERE ${where} ORDER BY t.due_at NULLS LAST, t.created_at, t.task_id LIMIT 1000`, params));
    });
  }

  async get(actor: ModuleActor, id: string) {
    const taskId = parse(UUID, id);
    return this.rt.read(actor, P.taskRead, (ctx, q) => load(q, ctx.scope, taskId));
  }

  async create(actor: ModuleActor, body: unknown) {
    const b = parse(taskBody, body);
    return this.rt.write(actor, P.taskCreate, { targetType: 'CM_TASK' }, async (ctx, tx) => {
      const me = ctx.actor.userAccountId;
      const assignee = b.assigneeAccountId ?? me;
      if (assignee !== me && !(await ctx.allowed(P.taskAssign))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if (b.customerId !== null) await requireCustomer(asRead(tx), ctx.scope, b.customerId);
      const progress = b.progress ?? 0;
      const [row] = await tx.insert('CM_TASKS', {
        title: b.title, description: b.description ?? null, customer_id: b.customerId, created_by_account_id: me, assignee_account_id: assignee,
        due_at: b.dueAt ?? null, priority_code: b.priority ?? 'MEDIUM', progress_percent: progress, status_code: progress > 0 ? 'IN_PROGRESS' : 'TODO',
      }, ['task_id']);
      const id = String(row?.['task_id']);
      tx.setAuditTarget(id);
      return load(asRead(tx), ctx.scope, id);
    });
  }

  async update(actor: ModuleActor, id: string, body: unknown) {
    const taskId = parse(UUID, id);
    const b = parse(taskPatch, body);
    return this.rt.write(actor, P.taskUpdate, { targetType: 'CM_TASK', targetId: taskId }, async (ctx, tx) => {
      const current = await lockOpen(tx, ctx, taskId);
      const me = ctx.actor.userAccountId;
      const progress = b.progress ?? current.progress;
      let status = b.status ?? current.status;
      // TK-R03: leaving TODO needs progress > 0; progress > 0 on a TODO task moves it to IN_PROGRESS.
      if (status === 'IN_PROGRESS' && progress === 0) throw invalid();
      if (status === 'TODO' && progress > 0) status = 'IN_PROGRESS';
      const customerId = b.customerId === undefined ? current.customerId : b.customerId;
      if (customerId !== null && customerId !== current.customerId) await requireCustomer(asRead(tx), ctx.scope, customerId);
      const assignee = b.assigneeAccountId ?? current.assigneeAccountId;
      // Giving a task to another person is TASK.ASSIGN (OD-11 b proposal).
      if (assignee !== current.assigneeAccountId && !(await ctx.allowed(P.taskAssign))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      await tx.update('CM_TASKS', { task_id: taskId }, {
        title: b.title ?? current.title, description: b.description === undefined ? current.description : b.description, customer_id: customerId,
        due_at: b.dueAt === undefined ? current.dueAt : b.dueAt, priority_code: b.priority ?? current.priority, progress_percent: progress,
        status_code: status, assignee_account_id: assignee, updated_at: NOW, updated_by_account_id: me,
      });
      // TK-R06: a change of assignee is recorded (immutable history), same transaction.
      if (assignee !== current.assigneeAccountId) {
        await tx.insert('CM_TASK_ASSIGNMENT_HISTORY', {
          task_id: taskId, previous_assignee_account_id: current.assigneeAccountId, new_assignee_account_id: assignee, changed_by_account_id: me,
          reason_code: 'REASSIGN',
        });
      }
      return load(asRead(tx), ctx.scope, taskId);
    });
  }

  async complete(actor: ModuleActor, id: string) {
    const taskId = parse(UUID, id);
    return this.rt.write(actor, P.taskUpdate, { targetType: 'CM_TASK', targetId: taskId }, async (ctx, tx) => {
      await lockOpen(tx, ctx, taskId);
      await tx.update('CM_TASKS', { task_id: taskId }, {
        status_code: 'DONE', progress_percent: 100, completed_at: NOW, updated_at: NOW, updated_by_account_id: ctx.actor.userAccountId,
      });
      return load(asRead(tx), ctx.scope, taskId);
    });
  }

  async cancel(actor: ModuleActor, id: string, body: unknown) {
    const taskId = parse(UUID, id);
    const b = parse(cancelBody, body);
    return this.rt.write(actor, P.taskUpdate, { targetType: 'CM_TASK', targetId: taskId }, async (ctx, tx) => {
      await lockOpen(tx, ctx, taskId);
      await tx.update('CM_TASKS', { task_id: taskId }, {
        status_code: 'CANCELLED', cancelled_at: NOW, cancel_reason: b.reason, updated_at: NOW, updated_by_account_id: ctx.actor.userAccountId,
      });
      return load(asRead(tx), ctx.scope, taskId);
    });
  }
}
