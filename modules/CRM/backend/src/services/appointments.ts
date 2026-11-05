import { z } from 'zod';
import type { ModuleActor, ReadQuery, WriteTx } from '../../host.js';
import { NOW } from '../../host.js';
import { CrmError, invalid, notFound } from '../errors.js';
import { P } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, parseRows, requireCustomer, s, ts } from '../runtime.js';
import type { CrmScope } from '../runtime.js';

// Lịch hẹn (G2, OD-17/19/20/21). AP-R01…AP-R11 of 04_BUSINESS_RULES_DELTA.md. Data: CM_APPOINTMENTS,
// CM_APPOINTMENT_REMINDER_DISMISSALS. Owner = creator = the session actor (OD-20); only the owner edits / cancels /
// completes, and only while SCHEDULED (AP-R05); an appointment is never deleted (AP-R10).

export const asRead = (tx: WriteTx): ReadQuery => ({ query: (sql, params) => tx.read(sql, params) });

const COLS = `a.appointment_id::text AS "appointmentId", a.title, a.customer_id::text AS "customerId", a.contact_id::text AS "contactId",
  a.owner_account_id::text AS "ownerAccountId", ${ts('a.start_at')} AS "startAt", ${ts('a.end_at')} AS "endAt", a.location, a.description,
  a.remind_minutes AS "remindMinutes", a.status_code AS status, a.cancel_reason AS "cancelReason", a.outcome, ${ts('a.created_at')} AS "createdAt",
  ${ts('a.updated_at')} AS "updatedAt", a.review_handover_id::text AS "reviewHandoverId", ${ts('a.review_flagged_at')} AS "reviewFlaggedAt"`;

export const appointmentRow = z.object({
  appointmentId: s, title: s, customerId: ns, contactId: ns, ownerAccountId: s, startAt: s, endAt: s, location: ns, description: ns,
  remindMinutes: z.number().int().nullable(), status: z.enum(['SCHEDULED', 'DONE', 'CANCELLED']), cancelReason: ns, outcome: ns, createdAt: s,
  updatedAt: ns, reviewHandoverId: ns, reviewFlaggedAt: ns,
});
export type AppointmentDto = z.infer<typeof appointmentRow>;

// Visible: own appointment, or appointment of a customer in scope.
const VISIBLE = (a: number, b: number) => `(a.owner_account_id = $${b}::uuid OR (a.customer_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = a.customer_id AND ${customerScope(a, b)})))`;

const iso = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).nullable().optional();

export const appointmentBody = z.strictObject({
  title: text(255), customerId: UUID.nullable(), contactId: UUID.nullable().optional(), startAt: iso, endAt: iso,
  location: opt(255), description: opt(4000), remindMinutes: z.number().int().min(1).max(10080).nullable().optional(),
});
export const appointmentPatch = appointmentBody.partial();
export const appointmentQuery = z.strictObject({
  from: iso.optional(), to: iso.optional(), customerId: UUID.optional(), mineOnly: z.enum(['true', 'false']).optional(), includeCancelled: z.enum(['true', 'false']).optional(),
  needsReview: z.enum(['true', 'false']).optional(),
});
const DAY_MS = 86_400_000;
const DEFAULT_BACK_MS = 7 * DAY_MS;
const DEFAULT_AHEAD_MS = 31 * DAY_MS;
export const reasonBody = z.strictObject({ reason: text(2000) });
export const outcomeBody = z.strictObject({ outcome: text(4000) });

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw invalid();
  return r.data;
}

async function load(q: ReadQuery, scope: CrmScope, id: string): Promise<AppointmentDto> {
  const [row] = await q.query(`SELECT ${COLS} FROM cm.cm_appointments AS a WHERE a.appointment_id = $1::uuid AND ${VISIBLE(2, 3)}`,
    [id, scope.readAll, scope.actorId]);
  if (row === undefined) throw notFound();
  return appointmentRow.parse(row);
}

// AP-R03 / AP-R04: the contact belongs to the chosen customer and is active.
async function checkContact(q: ReadQuery, customerId: string | null, contactId: string | null | undefined): Promise<void> {
  if (contactId === null || contactId === undefined) return;
  if (customerId === null) throw invalid();
  const rows = await q.query(`SELECT 1 FROM cm.cm_customer_contacts WHERE contact_id = $1::uuid AND customer_id = $2::uuid AND is_active`, [contactId, customerId]);
  if (rows.length !== 1) throw invalid();
}

// Locks the row (owner only, SCHEDULED only) before any change.
async function lockOwned(tx: WriteTx, scope: CrmScope, id: string): Promise<AppointmentDto> {
  const current = await load(asRead(tx), scope, id);
  const [locked] = await tx.lock('CM_APPOINTMENTS', { appointment_id: id }, ['status_code', 'owner_account_id']);
  if (locked === undefined) throw notFound();
  if (locked['owner_account_id'] !== scope.actorId) throw new CrmError(403, 'CM_PERMISSION_DENIED');
  if (locked['status_code'] !== 'SCHEDULED') throw invalid();
  return current;
}

export class AppointmentService {
  constructor(private readonly rt: CrmRuntime) {}

  async list(actor: ModuleActor, query: unknown) {
    const f = parse(appointmentQuery, query);
    // Both bounds or neither: without a range the list is the default window (7 days back, 31 days ahead).
    if ((f.from === undefined) !== (f.to === undefined)) throw invalid();
    const now = Date.now();
    const from = f.from ?? new Date(now - DEFAULT_BACK_MS).toISOString();
    const to = f.to ?? new Date(now + DEFAULT_AHEAD_MS).toISOString();
    if (Date.parse(to) <= Date.parse(from)) throw invalid();
    return this.rt.read(actor, P.appointmentRead, async (ctx, q) => {
      const params: unknown[] = [ctx.scope.readAll, ctx.scope.actorId, from, to];
      let where = `${VISIBLE(1, 2)} AND a.start_at < $4::timestamptz AND a.end_at > $3::timestamptz`;
      if (f.customerId) { params.push(f.customerId); where += ` AND a.customer_id = $${params.length}::uuid`; }
      if (f.mineOnly === 'true') where += ' AND a.owner_account_id = $2::uuid';
      if (f.includeCancelled !== 'true') where += ` AND a.status_code <> 'CANCELLED'`;
      if (f.needsReview === 'true') where += ' AND a.review_handover_id IS NOT NULL';
      return parseRows(appointmentRow, await q.query(`SELECT ${COLS} FROM cm.cm_appointments AS a WHERE ${where} ORDER BY a.start_at, a.appointment_id LIMIT 1000`, params));
    });
  }

  async get(actor: ModuleActor, id: string) {
    const appointmentId = parse(UUID, id);
    return this.rt.read(actor, P.appointmentRead, (ctx, q) => load(q, ctx.scope, appointmentId));
  }

  async create(actor: ModuleActor, body: unknown) {
    const b = parse(appointmentBody, body);
    if (Date.parse(b.endAt) <= Date.parse(b.startAt)) throw invalid();
    return this.rt.write(actor, P.appointmentCreate, { targetType: 'CM_APPOINTMENT' }, async (ctx, tx) => {
      if (b.customerId !== null) await requireCustomer(asRead(tx), ctx.scope, b.customerId);
      await checkContact(asRead(tx), b.customerId, b.contactId);
      const [row] = await tx.insert('CM_APPOINTMENTS', {
        title: b.title, customer_id: b.customerId, contact_id: b.contactId ?? null, owner_account_id: ctx.actor.userAccountId,
        created_by_account_id: ctx.actor.userAccountId, start_at: b.startAt, end_at: b.endAt, location: b.location ?? null,
        description: b.description ?? null, remind_minutes: b.remindMinutes ?? null,
      }, ['appointment_id']);
      const id = String(row?.['appointment_id']);
      tx.setAuditTarget(id);
      return load(asRead(tx), ctx.scope, id);
    });
  }

  async update(actor: ModuleActor, id: string, body: unknown) {
    const appointmentId = parse(UUID, id);
    const b = parse(appointmentPatch, body);
    return this.rt.write(actor, P.appointmentUpdate, { targetType: 'CM_APPOINTMENT', targetId: appointmentId }, async (ctx, tx) => {
      const current = await lockOwned(tx, ctx.scope, appointmentId);
      const customerId = b.customerId === undefined ? current.customerId : b.customerId;
      const contactId = b.contactId === undefined ? (b.customerId === undefined ? current.contactId : null) : b.contactId;
      const startAt = b.startAt ?? current.startAt;
      const endAt = b.endAt ?? current.endAt;
      if (Date.parse(endAt) <= Date.parse(startAt)) throw invalid();
      if (customerId !== null && customerId !== current.customerId) await requireCustomer(asRead(tx), ctx.scope, customerId);
      await checkContact(asRead(tx), customerId, contactId);
      await tx.update('CM_APPOINTMENTS', { appointment_id: appointmentId }, {
        title: b.title ?? current.title, customer_id: customerId, contact_id: contactId, start_at: startAt, end_at: endAt,
        location: b.location === undefined ? current.location : b.location, description: b.description === undefined ? current.description : b.description,
        remind_minutes: b.remindMinutes === undefined ? current.remindMinutes : b.remindMinutes,
        updated_at: NOW, updated_by_account_id: ctx.actor.userAccountId,
      });
      return load(asRead(tx), ctx.scope, appointmentId);
    });
  }

  async cancel(actor: ModuleActor, id: string, body: unknown) {
    const appointmentId = parse(UUID, id);
    const b = parse(reasonBody, body);
    return this.rt.write(actor, P.appointmentUpdate, { targetType: 'CM_APPOINTMENT', targetId: appointmentId }, async (ctx, tx) => {
      await lockOwned(tx, ctx.scope, appointmentId);
      await tx.update('CM_APPOINTMENTS', { appointment_id: appointmentId, status_code: 'SCHEDULED' }, {
        status_code: 'CANCELLED', cancel_reason: b.reason, cancelled_at: NOW, cancelled_by_account_id: ctx.actor.userAccountId,
        updated_at: NOW, updated_by_account_id: ctx.actor.userAccountId,
      });
      return load(asRead(tx), ctx.scope, appointmentId);
    });
  }

  async complete(actor: ModuleActor, id: string, body: unknown) {
    const appointmentId = parse(UUID, id);
    const b = parse(outcomeBody, body);
    return this.rt.write(actor, P.appointmentUpdate, { targetType: 'CM_APPOINTMENT', targetId: appointmentId }, async (ctx, tx) => {
      await lockOwned(tx, ctx.scope, appointmentId);
      await tx.update('CM_APPOINTMENTS', { appointment_id: appointmentId, status_code: 'SCHEDULED' }, {
        status_code: 'DONE', outcome: b.outcome, completed_at: NOW, updated_at: NOW, updated_by_account_id: ctx.actor.userAccountId,
      });
      return load(asRead(tx), ctx.scope, appointmentId);
    });
  }

  // Due reminders of the caller's own SCHEDULED appointments (no background job; window computed on instants, OD-21).
  async dueReminders(actor: ModuleActor) {
    return this.rt.readSelf(actor, async (ctx, q) => {
      const rows = await q.query(`SELECT ${COLS}, GREATEST(0, ceil(extract(epoch FROM (a.start_at - now())) / 60))::int AS "minutesLeft"
          FROM cm.cm_appointments AS a
         WHERE a.owner_account_id = $1::uuid AND a.status_code = 'SCHEDULED' AND a.remind_minutes IS NOT NULL
           AND now() >= a.start_at - make_interval(mins => a.remind_minutes) AND now() < a.start_at
           AND NOT EXISTS (SELECT 1 FROM cm.cm_appointment_reminder_dismissals AS d WHERE d.appointment_id = a.appointment_id AND d.account_id = $1::uuid)
         ORDER BY a.start_at, a.appointment_id`, [ctx.actor.userAccountId]);
      return rows.map((r) => ({ appointment: appointmentRow.parse(r), minutesLeft: z.object({ minutesLeft: z.number().int() }).parse(r).minutesLeft }));
    });
  }

  // OD-17: one dismissal per (appointment, account); a repeated dismissal — also a concurrent one that loses the race on
  // the primary key (23505, the whole write rolled back) — is a success (idempotent).
  async dismissReminder(actor: ModuleActor, id: string) {
    try {
      return await this.dismissOnce(actor, id);
    } catch (error) {
      if (error instanceof CrmError && error.sqlstate === '23505') return { dismissed: true };
      throw error;
    }
  }

  private async dismissOnce(actor: ModuleActor, id: string) {
    const appointmentId = parse(UUID, id);
    return this.rt.write(actor, P.appointmentRemindDismiss, { targetType: 'CM_APPOINTMENT', targetId: appointmentId }, async (ctx, tx) => {
      const own = await tx.read(`SELECT 1 FROM cm.cm_appointments WHERE appointment_id = $1::uuid AND owner_account_id = $2::uuid`, [appointmentId, ctx.actor.userAccountId]);
      if (own.length !== 1) throw notFound();
      const done = await tx.read(`SELECT 1 FROM cm.cm_appointment_reminder_dismissals WHERE appointment_id = $1::uuid AND account_id = $2::uuid`,
        [appointmentId, ctx.actor.userAccountId]);
      if (done.length === 0) await tx.insert('CM_APPOINTMENT_REMINDER_DISMISSALS', { appointment_id: appointmentId, account_id: ctx.actor.userAccountId });
      return { dismissed: true };
    });
  }
}
