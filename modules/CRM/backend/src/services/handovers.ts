import { z } from 'zod';
import type { ModuleActor, ReadQuery, WriteTx } from '../../host.js';
import { NOW } from '../../host.js';
import { CrmError, invalid, notFound } from '../errors.js';
import { P } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, requireCustomer, s, ts } from '../runtime.js';
import type { CrmCtx } from '../runtime.js';
import { asRead, parse } from './appointments.js';

// Bàn giao khách hàng (REV01 BR-09/10/11, flows A / B) + Gate 2 additions in the SAME completion transaction:
//   OD-07: open To-dos (TODO / IN_PROGRESS) of the previous sale that are linked to the handed-over customer move to the
//          receiver; one HANDOVER history row each (previous = the previous sale, changed_by = the operator).
//   OD-19: SCHEDULED future appointments of the previous sale with that customer keep their owner and get the review flag
//          (review_handover_id + review_flagged_at). Past appointments are untouched. Clearing the flag: OD-19b PENDING.
// Not in this candidate: override by a third person (D05 / OD-15 PENDING), cancel endpoint (no REV01 actor defined).
// Serialisation: every step locks the customer's open PRIMARY assignment row first, then the handover row.

const OPEN = ['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK'] as const;

const handoverRow = z.object({
  handoverId: s, customerId: s, fromAssignmentId: s, currentSaleAccountId: s, toSaleAccountId: s, initiatedByAccountId: s,
  mode: z.enum(['MANAGER_INITIATED', 'SALE_INITIATED']), status: z.enum(['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  requestedAt: s, managerApprovedByAccountId: ns, completedAt: ns, note: ns, currentAckByAccountId: ns, currentAckOverrideByAccountId: ns,
  currentAckOverrideReason: ns, receiverAckByAccountId: ns, rejectedByAccountId: ns, rejectionReason: ns, transferredActivityIds: z.array(s),
  transferredTaskIds: z.array(s),
});
type Handover = z.infer<typeof handoverRow>;

const SELECT = `SELECT h.handover_id::text AS "handoverId", h.customer_id::text AS "customerId", h.from_assignment_id::text AS "fromAssignmentId",
  fa.sale_account_id::text AS "currentSaleAccountId", h.to_sale_account_id::text AS "toSaleAccountId", h.initiated_by_account_id::text AS "initiatedByAccountId",
  h.handover_mode_code AS mode, h.status_code AS status, ${ts('h.requested_at')} AS "requestedAt",
  h.manager_approved_by_account_id::text AS "managerApprovedByAccountId", ${ts('h.completed_at')} AS "completedAt", h.handover_note AS note,
  h.current_ack_by_account_id::text AS "currentAckByAccountId", h.current_ack_override_by_account_id::text AS "currentAckOverrideByAccountId",
  h.current_ack_override_reason AS "currentAckOverrideReason", h.receiver_ack_by_account_id::text AS "receiverAckByAccountId",
  h.rejected_by_account_id::text AS "rejectedByAccountId", h.rejection_reason AS "rejectionReason",
  coalesce((SELECT array_agg(t.activity_id::text ORDER BY t.activity_id) FROM cm.cm_customer_handover_activity_transfers AS t
     WHERE t.handover_id = h.handover_id), '{}') AS "transferredActivityIds",
  coalesce((SELECT array_agg(th.task_id::text ORDER BY th.task_id) FROM cm.cm_task_assignment_history AS th
     WHERE th.handover_id = h.handover_id), '{}') AS "transferredTaskIds"
  FROM cm.cm_customer_handovers AS h JOIN cm.cm_customer_assignments AS fa ON fa.assignment_id = h.from_assignment_id`;

export const handoverBody = z.strictObject({
  mode: z.enum(['MANAGER_INITIATED', 'SALE_INITIATED']), toSaleAccountId: UUID, note: z.string().trim().max(4000).nullable().optional(),
});
export const rejectBody = z.strictObject({ reason: z.string().trim().min(1).max(4000) });
export const acknowledgeBody = z.strictObject({ overrideReason: z.string().trim().max(4000).nullable().optional() });

async function load(q: ReadQuery, id: string): Promise<Handover> {
  const [row] = await q.query(`${SELECT} WHERE h.handover_id = $1::uuid`, [id]);
  if (row === undefined) throw notFound();
  return handoverRow.parse(row);
}

async function accountActive(q: ReadQuery, accountId: string): Promise<boolean> {
  const rows = await q.query(`SELECT 1 FROM iam.iam_user_accounts WHERE user_account_id = $1::uuid AND account_status = 'ACTIVE' AND disabled_at IS NULL`, [accountId]);
  return rows.length === 1;
}

// Locks the customer's current PRIMARY assignment (serialises every handover step of that customer).
async function lockPrimary(tx: WriteTx, customerId: string): Promise<{ assignmentId: string; saleAccountId: string } | undefined> {
  const [row] = await tx.lock('CM_CUSTOMER_ASSIGNMENTS', { customer_id: customerId, ended_at: null, assignment_role_code: 'PRIMARY' }, ['assignment_id', 'sale_account_id']);
  return row === undefined ? undefined : { assignmentId: String(row['assignment_id']), saleAccountId: String(row['sale_account_id']) };
}

async function lockHandover(tx: WriteTx, id: string): Promise<Handover> {
  const h = await load(asRead(tx), id);
  await lockPrimary(tx, h.customerId);
  const [locked] = await tx.lock('CM_CUSTOMER_HANDOVERS', { handover_id: id }, ['status_code']);
  if (locked === undefined) throw notFound();
  return load(asRead(tx), id);
}

export class HandoverService {
  constructor(private readonly rt: CrmRuntime) {}

  // Handovers the caller takes part in, or of customers in the caller's scope (ASSIGNMENT.READ, as the Gate 1 screen).
  async list(actor: ModuleActor, customerId?: string) {
    const cid = customerId === undefined ? null : parse(UUID, customerId);
    return this.rt.read(actor, P.assignmentRead, async (ctx, q) => {
      const rows = await q.query(`${SELECT} WHERE ($3::uuid IS NULL OR h.customer_id = $3::uuid)
          AND ($2::uuid IN (h.initiated_by_account_id, h.to_sale_account_id, fa.sale_account_id)
            OR EXISTS (SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = h.customer_id AND ${customerScope(1, 2)}))
        ORDER BY h.requested_at DESC, h.handover_id LIMIT 1000`, [ctx.scope.readAll, ctx.scope.actorId, cid]);
      return rows.map((r) => handoverRow.parse(r));
    });
  }

  // REV01: only the party expected at the current step refuses it, with a reason.
  async reject(actor: ModuleActor, id: string, body: unknown) {
    const handoverId = parse(UUID, id);
    const b = parse(rejectBody, body);
    return this.rt.write(actor, P.handoverReject, { targetType: 'CM_CUSTOMER_HANDOVER', targetId: handoverId }, async (ctx, tx) => {
      const h = await lockHandover(tx, handoverId);
      const me = ctx.actor.userAccountId;
      if (h.status === 'PENDING_APPROVAL') {
        if (!(await ctx.allowed(P.handoverApprove))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
        await requireCustomer(asRead(tx), ctx.scope, h.customerId);
      } else if (h.status === 'PENDING_CURRENT_ACK') {
        if (h.currentSaleAccountId !== me) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      } else if (h.status === 'PENDING_RECEIVER_ACK') {
        if (h.toSaleAccountId !== me) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      } else {
        throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
      }
      await tx.update('CM_CUSTOMER_HANDOVERS', { handover_id: handoverId, status_code: h.status }, {
        status_code: 'REJECTED', rejected_by_account_id: me, rejected_at: NOW, rejection_reason: b.reason,
      });
      return { handover: await load(asRead(tx), handoverId) };
    });
  }

  async request(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const b = parse(handoverBody, body);
    return this.rt.write(actor, P.handoverRequest, { targetType: 'CM_CUSTOMER_HANDOVER' }, async (ctx, tx) => {
      await requireCustomer(asRead(tx), ctx.scope, cid);
      const primary = await lockPrimary(tx, cid);
      if (primary === undefined) throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
      // Flow B: only the current PRIMARY sale proposes; flow A: the initiator holds HANDOVER.APPROVE.
      if (b.mode === 'SALE_INITIATED' && primary.saleAccountId !== ctx.actor.userAccountId) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if (b.mode === 'MANAGER_INITIATED' && !(await ctx.allowed(P.handoverApprove))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if (b.toSaleAccountId === primary.saleAccountId || !(await accountActive(asRead(tx), b.toSaleAccountId))) throw invalid();
      const open = await tx.read(`SELECT 1 FROM cm.cm_customer_handovers WHERE customer_id = $1::uuid AND status_code = ANY($2::text[])`, [cid, [...OPEN]]);
      if (open.length > 0) throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
      const [row] = await tx.insert('CM_CUSTOMER_HANDOVERS', {
        customer_id: cid, from_assignment_id: primary.assignmentId, to_sale_account_id: b.toSaleAccountId, initiated_by_account_id: ctx.actor.userAccountId,
        handover_mode_code: b.mode, status_code: b.mode === 'MANAGER_INITIATED' ? 'PENDING_CURRENT_ACK' : 'PENDING_APPROVAL', handover_note: b.note ?? null,
      }, ['handover_id']);
      const id = String(row?.['handover_id']);
      tx.setAuditTarget(id);
      return { handover: await load(asRead(tx), id) };
    });
  }

  async approve(actor: ModuleActor, id: string) {
    const handoverId = parse(UUID, id);
    return this.rt.write(actor, P.handoverApprove, { targetType: 'CM_CUSTOMER_HANDOVER', targetId: handoverId }, async (ctx, tx) => {
      const h = await lockHandover(tx, handoverId);
      await requireCustomer(asRead(tx), ctx.scope, h.customerId);
      if (h.status !== 'PENDING_APPROVAL') throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
      // D04 (PROPOSAL, OD-16 PENDING) would forbid self-approval; REV01 does not, so it is not enforced here.
      await tx.update('CM_CUSTOMER_HANDOVERS', { handover_id: handoverId, status_code: 'PENDING_APPROVAL' }, {
        manager_approved_by_account_id: ctx.actor.userAccountId, manager_approved_at: NOW, status_code: 'PENDING_RECEIVER_ACK',
      });
      return { handover: await load(asRead(tx), handoverId) };
    });
  }

  async acknowledge(actor: ModuleActor, id: string, body: unknown) {
    const handoverId = parse(UUID, id);
    const b = parse(acknowledgeBody, body ?? {});
    // D05 override (OD-15 PENDING): not implemented.
    if (b.overrideReason) throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
    return this.rt.write(actor, P.handoverAcknowledge, { targetType: 'CM_CUSTOMER_HANDOVER', targetId: handoverId }, async (ctx, tx) => {
      const h = await lockHandover(tx, handoverId);
      const me = ctx.actor.userAccountId;
      if (h.status === 'PENDING_CURRENT_ACK') {
        if (h.currentSaleAccountId !== me) throw new CrmError(403, 'CM_PERMISSION_DENIED');
        await tx.update('CM_CUSTOMER_HANDOVERS', { handover_id: handoverId, status_code: 'PENDING_CURRENT_ACK' }, {
          current_ack_by_account_id: me, current_ack_at: NOW, status_code: 'PENDING_RECEIVER_ACK',
        });
        return { handover: await load(asRead(tx), handoverId), transferred: null };
      }
      if (h.status !== 'PENDING_RECEIVER_ACK') throw new CrmError(409, 'CM_HANDOVER_INVALID_STATE');
      if (h.toSaleAccountId !== me) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      await this.complete(tx, ctx, h);
      return { handover: await load(asRead(tx), handoverId), transferred: await this.summary(tx, handoverId) };
    });
  }

  private async summary(tx: WriteTx, handoverId: string) {
    const [r] = await tx.read(`SELECT
        (SELECT count(*)::int FROM cm.cm_customer_handover_activity_transfers WHERE handover_id = $1::uuid) AS activities,
        (SELECT count(*)::int FROM cm.cm_task_assignment_history WHERE handover_id = $1::uuid) AS tasks,
        (SELECT count(*)::int FROM cm.cm_appointments WHERE review_handover_id = $1::uuid) AS "flaggedAppointments"`, [handoverId]);
    return z.object({ activities: z.number().int(), tasks: z.number().int(), flaggedAppointments: z.number().int() }).parse(r);
  }

  // Completion (receiver acknowledgement): ONE transaction — any failure rolls back every step below.
  private async complete(tx: WriteTx, ctx: CrmCtx, h: Handover): Promise<void> {
    const me = ctx.actor.userAccountId;
    const [from] = await tx.lock('CM_CUSTOMER_ASSIGNMENTS', { assignment_id: h.fromAssignmentId }, ['ended_at', 'assignment_role_code', 'sale_account_id']);
    if (from === undefined || from['ended_at'] !== null || from['assignment_role_code'] !== 'PRIMARY') throw new CrmError(409, 'CM_CONCURRENT_UPDATE');
    const previous = String(from['sale_account_id']);

    // REV01: close the PRIMARY, close the receiver's SUPPORT (if any), open the receiver's PRIMARY.
    await tx.update('CM_CUSTOMER_ASSIGNMENTS', { assignment_id: h.fromAssignmentId }, {
      ended_at: NOW, ended_by_account_id: me, handover_to_account_id: me, handover_note: h.note, handover_accepted_at: NOW, handover_accepted_by_account_id: me,
    });
    await tx.update('CM_CUSTOMER_ASSIGNMENTS', { customer_id: h.customerId, sale_account_id: me, ended_at: null, assignment_role_code: 'SUPPORT' }, {
      ended_at: NOW, ended_by_account_id: me,
    });
    await tx.insert('CM_CUSTOMER_ASSIGNMENTS', {
      customer_id: h.customerId, sale_account_id: me, assigned_by_account_id: h.managerApprovedByAccountId ?? h.initiatedByAccountId, assignment_role_code: 'PRIMARY',
    });

    // REV01 BR-11: OPEN activities of the previous sale move to the receiver, with a transfer row each.
    for (const a of await tx.lock('CM_CUSTOMER_ACTIVITIES', { customer_id: h.customerId, activity_status_code: 'OPEN', assigned_to_account_id: previous }, ['activity_id'])) {
      const activityId = String(a['activity_id']);
      await tx.insert('CM_CUSTOMER_HANDOVER_ACTIVITY_TRANSFERS', {
        handover_id: h.handoverId, activity_id: activityId, customer_id: h.customerId, previous_assignee_account_id: previous,
        new_assignee_account_id: me, transferred_by_account_id: me,
      });
      await tx.update('CM_CUSTOMER_ACTIVITIES', { activity_id: activityId }, { assigned_to_account_id: me });
    }

    // OD-07: open To-dos of the previous sale linked to this customer.
    for (const status of ['TODO', 'IN_PROGRESS'] as const) {
      for (const t of await tx.lock('CM_TASKS', { customer_id: h.customerId, assignee_account_id: previous, status_code: status }, ['task_id'])) {
        const taskId = String(t['task_id']);
        await tx.update('CM_TASKS', { task_id: taskId }, { assignee_account_id: me, updated_at: NOW, updated_by_account_id: me });
        await tx.insert('CM_TASK_ASSIGNMENT_HISTORY', {
          task_id: taskId, customer_id: h.customerId, previous_assignee_account_id: previous, new_assignee_account_id: me, changed_by_account_id: me,
          reason_code: 'HANDOVER', handover_id: h.handoverId,
        });
      }
    }

    // OD-19: future SCHEDULED appointments of the previous sale with this customer get the review flag (owner unchanged).
    const future = await tx.read(`SELECT appointment_id::text AS id FROM cm.cm_appointments
        WHERE customer_id = $1::uuid AND owner_account_id = $2::uuid AND status_code = 'SCHEDULED' AND start_at > now()`, [h.customerId, previous]);
    for (const a of future) {
      const appointmentId = z.object({ id: s }).parse(a).id;
      await tx.update('CM_APPOINTMENTS', { appointment_id: appointmentId, status_code: 'SCHEDULED' }, { review_handover_id: h.handoverId, review_flagged_at: NOW });
    }

    await tx.update('CM_CUSTOMER_HANDOVERS', { handover_id: h.handoverId, status_code: 'PENDING_RECEIVER_ACK' }, {
      receiver_ack_by_account_id: me, receiver_ack_at: NOW, status_code: 'COMPLETED', completed_at: NOW,
    });
  }
}
