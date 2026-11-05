import { z } from 'zod';
import type { ModuleActor, ReadQuery } from '../../host.js';
import { NOW } from '../../host.js';
import { invalid, notFound, refuse } from '../errors.js';
import { P, POLICY } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, parseRows, requireCustomer, s, ts } from '../runtime.js';
import type { CrmCtx, CrmScope } from '../runtime.js';
import { asRead, parse } from './appointments.js';
import { accountActive, contactInput, legalRow, legalSelect, loadCustomer, view } from './customers.js';

// Hồ sơ khách hàng: liên hệ (BR-04), phân công Sale (BR-09), nhóm ngành, hoạt động & kết quả (BR-11), tài liệu (metadata).
// Every object is reached through its customer: a customer outside the caller's scope answers 404 (never 403, BR-17).
// File upload: BLOCKED (no Storage service approved) — the metadata of existing documents is fully served.

const optText = (max: number) => z.string().trim().max(max).transform((x) => (x === '' ? null : x)).nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- contacts ------------------------------------------------------------------------------------------------------------
const contactRow = z.object({ contactId: s, customerId: s, fullName: s, positionTitle: ns, phone: ns, zaloPhone: ns, email: ns, isPrimary: z.boolean(), isActive: z.boolean() });
const CONTACT_SELECT = `SELECT ct.contact_id::text AS "contactId", ct.customer_id::text AS "customerId", ct.full_name AS "fullName", ct.position_title AS "positionTitle",
  ct.phone, ct.zalo_phone AS "zaloPhone", ct.email, ct.is_primary AS "isPrimary", ct.is_active AS "isActive" FROM cm.cm_customer_contacts AS ct`;
export const contactPatch = contactInput.partial();

// ---- assignments ---------------------------------------------------------------------------------------------------------
const assignmentRow = z.object({ assignmentId: s, customerId: s, saleAccountId: s, role: z.enum(['PRIMARY', 'SUPPORT']), assignedAt: s, assignedByAccountId: ns,
  endedAt: ns, endedByAccountId: ns, handoverToAccountId: ns });
const ASSIGNMENT_SELECT = `SELECT a.assignment_id::text AS "assignmentId", a.customer_id::text AS "customerId", a.sale_account_id::text AS "saleAccountId",
  a.assignment_role_code AS role, ${ts('a.assigned_at')} AS "assignedAt", a.assigned_by_account_id::text AS "assignedByAccountId", ${ts('a.ended_at')} AS "endedAt",
  a.ended_by_account_id::text AS "endedByAccountId", a.handover_to_account_id::text AS "handoverToAccountId" FROM cm.cm_customer_assignments AS a`;
export const assignmentBody = z.strictObject({ saleAccountId: UUID, role: z.enum(['PRIMARY', 'SUPPORT']) });

// ---- groups --------------------------------------------------------------------------------------------------------------
const groupRow = z.object({ groupId: s, groupCode: s, groupName: s, parentGroupId: ns, description: ns, isActive: z.boolean() });
const GROUP_SELECT = `SELECT g.group_id::text AS "groupId", g.group_code AS "groupCode", g.group_name AS "groupName", g.parent_group_id::text AS "parentGroupId",
  g.description, g.is_active AS "isActive" FROM cm.cm_customer_groups AS g`;
export const groupBody = z.strictObject({ groupCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/), groupName: z.string().trim().min(1).max(150),
  parentGroupId: UUID.nullable().optional(), description: optText(4000) });
export const groupPatch = z.strictObject({ groupName: z.string().trim().min(1).max(150).optional(), parentGroupId: UUID.nullable().optional(),
  description: optText(4000), isActive: z.boolean().optional() });
export const groupIdsBody = z.strictObject({ groupIds: z.array(UUID).max(50) });

// ---- activities ----------------------------------------------------------------------------------------------------------
const ACTIVITY_TYPES = ['NOTE', 'CALL', 'MEETING', 'TASK', 'FOLLOW_UP'] as const;
const activityRow = z.object({ activityId: s, customerId: s, activityType: z.enum([...ACTIVITY_TYPES, 'HANDOVER']), activityStatus: z.enum(['OPEN', 'DONE', 'CANCELLED']),
  title: s, description: ns, occurredAt: s, dueAt: ns, assignedToAccountId: ns, createdByAccountId: z.string().nullable().transform((x) => x ?? ''), completedAt: ns });
const ACTIVITY_SELECT = `SELECT ac.activity_id::text AS "activityId", ac.customer_id::text AS "customerId", ac.activity_type_code AS "activityType",
  ac.activity_status_code AS "activityStatus", ac.title, ac.description, ${ts('ac.occurred_at')} AS "occurredAt", ${ts('ac.due_at')} AS "dueAt",
  ac.assigned_to_account_id::text AS "assignedToAccountId", ac.created_by_account_id::text AS "createdByAccountId", ${ts('ac.completed_at')} AS "completedAt"
  FROM cm.cm_customer_activities AS ac`;
const isoTs = z.string().datetime({ offset: true });
export const activityBody = z.strictObject({ activityType: z.enum(ACTIVITY_TYPES), title: z.string().trim().min(1).max(255), description: optText(10000),
  occurredAt: isoTs.optional(), dueAt: isoTs.nullable().optional(), assignedToAccountId: UUID.nullable().optional() });
export const activityPatch = z.strictObject({ title: z.string().trim().min(1).max(255).optional(), description: optText(10000), dueAt: isoTs.nullable().optional(),
  assignedToAccountId: UUID.nullable().optional(), activityStatus: z.enum(['OPEN', 'CANCELLED']).optional() });
export const recentQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(200).optional() });

// ---- documents -----------------------------------------------------------------------------------------------------------
const DOCUMENT_TYPES = ['LEGAL', 'CONTRACT', 'AUTHORIZATION', 'OTHER'] as const;
const documentRow = z.object({ documentId: s, customerId: s, documentName: s, documentType: z.enum(DOCUMENT_TYPES), fileName: s, fileType: s, fileSize: z.number(),
  uploadedByAccountId: z.string().nullable().transform((x) => x ?? ''), uploadedAt: s, note: ns, signedDate: ns, effectiveDate: ns, expiryDate: ns,
  supersedesDocumentId: ns, mockOnly: z.boolean() });
const DOCUMENT_SELECT = `SELECT d.document_id::text AS "documentId", d.customer_id::text AS "customerId", d.document_name AS "documentName",
  d.document_type_code AS "documentType", d.file_name AS "fileName", d.file_type AS "fileType", d.file_size::float8 AS "fileSize",
  d.uploaded_by_account_id::text AS "uploadedByAccountId", ${ts('d.uploaded_at')} AS "uploadedAt", d.note, to_char(d.signed_date, 'YYYY-MM-DD') AS "signedDate",
  to_char(d.effective_date, 'YYYY-MM-DD') AS "effectiveDate", to_char(d.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
  d.supersedes_document_id::text AS "supersedesDocumentId", false AS "mockOnly" FROM cm.cm_customer_documents AS d`;
export const documentPatch = z.strictObject({ documentName: z.string().trim().min(1).max(255).optional(), documentType: z.enum(DOCUMENT_TYPES).optional(),
  note: optText(4000), signedDate: date.nullable().optional(), effectiveDate: date.nullable().optional(), expiryDate: date.nullable().optional() });
export const expiringQuery = z.strictObject({ withinDays: z.coerce.number().int().min(0).max(3650).optional() });

// Object → its customer (404 when the object does not exist or its customer is out of scope).
async function ownerOf(q: ReadQuery, scope: CrmScope, table: string, idColumn: string, id: string): Promise<string> {
  const [row] = await q.query(`SELECT customer_id::text AS id FROM cm.${table} WHERE ${idColumn} = $1::uuid`, [id]);
  if (row === undefined) throw notFound();
  const customerId = z.object({ id: s }).parse(row).id;
  await requireCustomer(q, scope, customerId);
  return customerId;
}

async function one<T extends z.ZodTypeAny>(q: ReadQuery, schema: T, sql: string, id: string): Promise<z.infer<T>> {
  const [row] = await q.query(sql, [id]);
  if (row === undefined) throw notFound();
  return schema.parse(row);
}

export class RelationService {
  constructor(private readonly rt: CrmRuntime) {}

  // Customer profile (Gate 1 "Hồ sơ khách hàng"): each part only with its own READ right, like the accepted screens.
  // Appointments / To-dos / Work reports of the customer come from their own endpoints (?customerId=).
  async bundle(actor: ModuleActor, id: string) {
    const customerId = parse(UUID, id);
    return this.rt.read(actor, P.customerRead, async (ctx, q) => {
      const customer = await loadCustomer(q, ctx.scope, customerId);
      const can = async (p: Parameters<CrmCtx['allowed']>[0]) => ctx.allowed(p);
      const assignmentsAll = await can(P.assignmentRead);
      return {
        customer: view(customer, await can(POLICY.identifierViewPermission)),
        contacts: (await can(P.contactRead)) ? parseRows(contactRow, await q.query(`${CONTACT_SELECT} WHERE ct.customer_id = $1::uuid
          ORDER BY ct.is_active DESC, ct.is_primary DESC, ct.full_name, ct.contact_id`, [customerId])) : [],
        assignments: parseRows(assignmentRow, await q.query(`${ASSIGNMENT_SELECT} WHERE a.customer_id = $1::uuid AND ($2::boolean OR a.ended_at IS NULL)
          ORDER BY a.assigned_at, a.assignment_id`, [customerId, assignmentsAll])),
        legalChanges: (await can(P.legalRead)) ? parseRows(legalRow, await q.query(legalSelect(`r.customer_id = $1::uuid ORDER BY r.requested_at DESC, r.change_request_id`),
          [customerId])) : [],
        activities: (await can(P.activityRead)) ? parseRows(activityRow, await q.query(`${ACTIVITY_SELECT} WHERE ac.customer_id = $1::uuid
          ORDER BY ac.occurred_at DESC, ac.activity_id LIMIT 500`, [customerId])) : [],
        documents: (await can(P.documentRead)) ? parseRows(documentRow, await q.query(`${DOCUMENT_SELECT} WHERE d.customer_id = $1::uuid
          ORDER BY d.uploaded_at DESC, d.document_id`, [customerId])) : [],
      };
    });
  }

  // ------------------------------------------------------------------------------------------------------- contacts
  async createContact(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const b = parse(contactInput, body);
    if (!b.phone && !b.zaloPhone) throw refuse(422, 'CM_VALIDATION_FAILED', 'CONTACT_PHONE_REQUIRED');
    return this.rt.write(actor, P.contactManage, { targetType: 'CM_CUSTOMER_CONTACT' }, async (ctx, tx) => {
      const q = asRead(tx);
      await requireCustomer(q, ctx.scope, cid);
      if (b.isPrimary) {
        // Concurrent primaries: uq_cm_customer_contacts_primary_active is the last guard (→ CM_VALIDATION_FAILED).
        const other = await q.query(`SELECT 1 FROM cm.cm_customer_contacts WHERE customer_id = $1::uuid AND is_primary AND is_active`, [cid]);
        if (other.length > 0) throw refuse(422, 'CM_VALIDATION_FAILED', 'PRIMARY_CONTACT_EXISTS');
      }
      const [row] = await tx.insert('CM_CUSTOMER_CONTACTS', { customer_id: cid, full_name: b.fullName, position_title: b.positionTitle ?? null, phone: b.phone ?? null,
        zalo_phone: b.zaloPhone ?? null, email: b.email ?? null, is_primary: b.isPrimary ?? false, created_account_id: ctx.actor.userAccountId }, ['contact_id']);
      const id = String(row?.['contact_id']);
      tx.setAuditTarget(id);
      return one(q, contactRow, `${CONTACT_SELECT} WHERE ct.contact_id = $1::uuid`, id);
    });
  }

  async updateContact(actor: ModuleActor, contactId: string, body: unknown) {
    const id = parse(UUID, contactId);
    const b = parse(contactPatch, body);
    return this.rt.write(actor, P.contactManage, { targetType: 'CM_CUSTOMER_CONTACT', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      const cid = await ownerOf(q, ctx.scope, 'cm_customer_contacts', 'contact_id', id);
      // Concurrent primaries: uq_cm_customer_contacts_primary_active is the last guard (→ CM_VALIDATION_FAILED).
      await tx.lock('CM_CUSTOMER_CONTACTS', { contact_id: id }, ['contact_id']);
      const cur = await one(q, contactRow, `${CONTACT_SELECT} WHERE ct.contact_id = $1::uuid`, id);
      const next = {
        fullName: b.fullName ?? cur.fullName, positionTitle: b.positionTitle === undefined ? cur.positionTitle : b.positionTitle,
        phone: b.phone === undefined ? cur.phone : b.phone, zaloPhone: b.zaloPhone === undefined ? cur.zaloPhone : b.zaloPhone,
        email: b.email === undefined ? cur.email : b.email, isPrimary: b.isPrimary ?? cur.isPrimary,
      };
      if (!next.phone && !next.zaloPhone) throw refuse(422, 'CM_VALIDATION_FAILED', 'CONTACT_PHONE_REQUIRED');
      if (next.isPrimary && cur.isActive) {
        const other = await q.query(`SELECT 1 FROM cm.cm_customer_contacts WHERE customer_id = $1::uuid AND contact_id <> $2::uuid AND is_primary AND is_active`, [cid, id]);
        if (other.length > 0) throw refuse(422, 'CM_VALIDATION_FAILED', 'PRIMARY_CONTACT_EXISTS');
      }
      await tx.update('CM_CUSTOMER_CONTACTS', { contact_id: id }, { full_name: next.fullName, position_title: next.positionTitle ?? null, phone: next.phone ?? null,
        zalo_phone: next.zaloPhone ?? null, email: next.email ?? null, is_primary: next.isPrimary, updated_at: NOW });
      return one(q, contactRow, `${CONTACT_SELECT} WHERE ct.contact_id = $1::uuid`, id);
    });
  }

  async deactivateContact(actor: ModuleActor, contactId: string) {
    const id = parse(UUID, contactId);
    return this.rt.write(actor, P.contactManage, { targetType: 'CM_CUSTOMER_CONTACT', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      await ownerOf(q, ctx.scope, 'cm_customer_contacts', 'contact_id', id);
      await tx.update('CM_CUSTOMER_CONTACTS', { contact_id: id, is_active: true }, { is_active: false, updated_at: NOW });
      return one(q, contactRow, `${CONTACT_SELECT} WHERE ct.contact_id = $1::uuid`, id);
    });
  }

  // ---------------------------------------------------------------------------------------------------- assignments
  // BR-09: a PRIMARY is added only when the customer has none (replacing it = handover); only a SUPPORT is ended here.
  async addAssignment(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const b = parse(assignmentBody, body);
    return this.rt.write(actor, P.assignmentManage, { targetType: 'CM_CUSTOMER_ASSIGNMENT' }, async (ctx, tx) => {
      const q = asRead(tx);
      await requireCustomer(q, ctx.scope, cid);
      // Concurrent adds: uq_cm_customer_assignments_active_primary / _active_sale are the last guard (→ CM_VALIDATION_FAILED).
      if (!(await accountActive(q, b.saleAccountId))) throw invalid();
      const active = parseRows(assignmentRow, await q.query(`${ASSIGNMENT_SELECT} WHERE a.customer_id = $1::uuid AND a.ended_at IS NULL`, [cid]));
      if (b.role === 'PRIMARY' && active.some((a) => a.role === 'PRIMARY')) throw refuse(409, 'CM_VALIDATION_FAILED', 'ASSIGNMENT_CONFLICT');
      if (active.some((a) => a.saleAccountId === b.saleAccountId)) throw refuse(409, 'CM_VALIDATION_FAILED', 'ASSIGNMENT_CONFLICT');
      const [row] = await tx.insert('CM_CUSTOMER_ASSIGNMENTS', { customer_id: cid, sale_account_id: b.saleAccountId, assigned_by_account_id: ctx.actor.userAccountId,
        assignment_role_code: b.role }, ['assignment_id']);
      const id = String(row?.['assignment_id']);
      tx.setAuditTarget(id);
      return one(q, assignmentRow, `${ASSIGNMENT_SELECT} WHERE a.assignment_id = $1::uuid`, id);
    });
  }

  async endAssignment(actor: ModuleActor, assignmentId: string) {
    const id = parse(UUID, assignmentId);
    return this.rt.write(actor, P.assignmentManage, { targetType: 'CM_CUSTOMER_ASSIGNMENT', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      await ownerOf(q, ctx.scope, 'cm_customer_assignments', 'assignment_id', id);
      const r = await tx.update('CM_CUSTOMER_ASSIGNMENTS', { assignment_id: id, assignment_role_code: 'SUPPORT', ended_at: null }, {
        ended_at: NOW, ended_by_account_id: ctx.actor.userAccountId,
      });
      if (r.count !== 1) throw refuse(409, 'CM_VALIDATION_FAILED', 'ASSIGNMENT_CONFLICT');
      return one(q, assignmentRow, `${ASSIGNMENT_SELECT} WHERE a.assignment_id = $1::uuid`, id);
    });
  }

  // --------------------------------------------------------------------------------------------------------- groups
  async groups(actor: ModuleActor) {
    return this.rt.read(actor, P.groupRead, async (_ctx, q) => parseRows(groupRow, await q.query(`${GROUP_SELECT} ORDER BY g.group_code`, [])));
  }

  async createGroup(actor: ModuleActor, body: unknown) {
    const b = parse(groupBody, body);
    return this.rt.write(actor, P.groupManage, { targetType: 'CM_CUSTOMER_GROUP' }, async (_ctx, tx) => {
      const q = asRead(tx);
      if ((await q.query(`SELECT 1 FROM cm.cm_customer_groups WHERE group_code = $1`, [b.groupCode])).length > 0) throw refuse(409, 'CM_VALIDATION_FAILED', 'GROUP_CODE_EXISTS');
      if (b.parentGroupId && (await q.query(`SELECT 1 FROM cm.cm_customer_groups WHERE group_id = $1::uuid`, [b.parentGroupId])).length === 0) throw invalid();
      const [row] = await tx.insert('CM_CUSTOMER_GROUPS', { group_code: b.groupCode, group_name: b.groupName, parent_group_id: b.parentGroupId ?? null,
        description: b.description ?? null, created_account_id: _ctx.actor.userAccountId }, ['group_id']);
      const id = String(row?.['group_id']);
      tx.setAuditTarget(id);
      return one(q, groupRow, `${GROUP_SELECT} WHERE g.group_id = $1::uuid`, id);
    });
  }

  async updateGroup(actor: ModuleActor, groupId: string, body: unknown) {
    const id = parse(UUID, groupId);
    const b = parse(groupPatch, body);
    return this.rt.write(actor, P.groupManage, { targetType: 'CM_CUSTOMER_GROUP', targetId: id }, async (_ctx, tx) => {
      const q = asRead(tx);
      await tx.lock('CM_CUSTOMER_GROUPS', { group_id: id }, ['group_id']);
      await one(q, groupRow, `${GROUP_SELECT} WHERE g.group_id = $1::uuid`, id);
      if (b.parentGroupId) {
        // No cycle: the new parent is neither the group itself nor one of its descendants.
        const cyc = await q.query(`WITH RECURSIVE up AS (SELECT group_id, parent_group_id, 1 AS depth FROM cm.cm_customer_groups WHERE group_id = $1::uuid
            UNION ALL SELECT g.group_id, g.parent_group_id, up.depth + 1 FROM cm.cm_customer_groups AS g JOIN up ON g.group_id = up.parent_group_id WHERE up.depth < 64)
          SELECT count(*) FILTER (WHERE group_id = $2::uuid)::int AS hit, count(*)::int AS n FROM up`, [b.parentGroupId, id]);
        const r = z.object({ hit: z.number(), n: z.number() }).parse(cyc[0]);
        if (r.n === 0 || r.hit > 0) throw invalid();
      }
      const set: Record<string, string | boolean | null> = {};
      if (b.groupName !== undefined) set['group_name'] = b.groupName;
      if (b.parentGroupId !== undefined) set['parent_group_id'] = b.parentGroupId;
      if (b.description !== undefined) set['description'] = b.description;
      if (b.isActive !== undefined) set['is_active'] = b.isActive;
      if (Object.keys(set).length === 0) throw invalid();
      await tx.update('CM_CUSTOMER_GROUPS', { group_id: id }, set);
      return one(q, groupRow, `${GROUP_SELECT} WHERE g.group_id = $1::uuid`, id);
    });
  }

  // Replaces the customer's groups (active groups only); removed memberships are deleted (DELETE granted on this table only).
  async setCustomerGroups(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const ids = [...new Set(parse(groupIdsBody, body).groupIds)];
    return this.rt.write(actor, P.groupAssign, { targetType: 'CM_CUSTOMER', targetId: cid }, async (ctx, tx) => {
      const q = asRead(tx);
      await requireCustomer(q, ctx.scope, cid);
      const okIds = ids.length === 0 ? [] : await q.query(`SELECT group_id::text AS id FROM cm.cm_customer_groups WHERE group_id = ANY($1::uuid[]) AND is_active`, [ids]);
      if (okIds.length !== ids.length) throw invalid();
      const cur = (await q.query(`SELECT group_id::text AS id FROM cm.cm_customer_group_members WHERE customer_id = $1::uuid`, [cid]))
        .map((r) => z.object({ id: s }).parse(r).id);
      for (const g of cur.filter((x) => !ids.includes(x))) await tx.delete('CM_CUSTOMER_GROUP_MEMBERS', { customer_id: cid, group_id: g });
      for (const g of ids.filter((x) => !cur.includes(x))) {
        await tx.insert('CM_CUSTOMER_GROUP_MEMBERS', { customer_id: cid, group_id: g, assigned_account_id: ctx.actor.userAccountId });
      }
      return { customerId: cid, groupIds: ids.sort() };
    });
  }

  // ----------------------------------------------------------------------------------------------------- activities
  async recentActivities(actor: ModuleActor, query: unknown) {
    const f = parse(recentQuery, query);
    return this.rt.read(actor, P.activityRead, async (ctx, q) => parseRows(activityRow, await q.query(`${ACTIVITY_SELECT}
        WHERE EXISTS (SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = ac.customer_id AND ${customerScope(1, 2)})
        ORDER BY ac.occurred_at DESC, ac.activity_id LIMIT $3`, [ctx.scope.readAll, ctx.scope.actorId, f.limit ?? 20])));
  }

  async createActivity(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const b = parse(activityBody, body);
    return this.rt.write(actor, P.activityCreate, { targetType: 'CM_CUSTOMER_ACTIVITY' }, async (ctx, tx) => {
      const q = asRead(tx);
      await requireCustomer(q, ctx.scope, cid);
      const assignee = b.assignedToAccountId === undefined ? ctx.actor.userAccountId : b.assignedToAccountId;
      if (assignee !== null && !(await accountActive(q, assignee))) throw invalid();
      const note = b.activityType === 'NOTE'; // a note is a record, already done
      const occurred = b.occurredAt ? new Date(b.occurredAt) : NOW;
      const [row] = await tx.insert('CM_CUSTOMER_ACTIVITIES', { customer_id: cid, activity_type_code: b.activityType, activity_status_code: note ? 'DONE' : 'OPEN',
        title: b.title, description: b.description ?? null, occurred_at: occurred, due_at: b.dueAt ? new Date(b.dueAt) : null, assigned_to_account_id: assignee,
        created_by_account_id: ctx.actor.userAccountId, completed_at: note ? occurred : null }, ['activity_id']);
      const id = String(row?.['activity_id']);
      tx.setAuditTarget(id);
      return one(q, activityRow, `${ACTIVITY_SELECT} WHERE ac.activity_id = $1::uuid`, id);
    });
  }

  // Only an OPEN activity changes (no rewriting of history).
  async updateActivity(actor: ModuleActor, activityId: string, body: unknown) {
    const id = parse(UUID, activityId);
    const b = parse(activityPatch, body);
    return this.rt.write(actor, P.activityUpdate, { targetType: 'CM_CUSTOMER_ACTIVITY', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      await ownerOf(q, ctx.scope, 'cm_customer_activities', 'activity_id', id);
      if (b.assignedToAccountId && !(await accountActive(q, b.assignedToAccountId))) throw invalid();
      const set: Record<string, string | Date | null> = {};
      if (b.title !== undefined) set['title'] = b.title;
      if (b.description !== undefined) set['description'] = b.description;
      if (b.dueAt !== undefined) set['due_at'] = b.dueAt === null ? null : new Date(b.dueAt);
      if (b.assignedToAccountId !== undefined) set['assigned_to_account_id'] = b.assignedToAccountId;
      if (b.activityStatus !== undefined) set['activity_status_code'] = b.activityStatus;
      if (Object.keys(set).length === 0) throw invalid();
      const r = await tx.update('CM_CUSTOMER_ACTIVITIES', { activity_id: id, activity_status_code: 'OPEN' }, set);
      if (r.count !== 1) throw invalid();
      return one(q, activityRow, `${ACTIVITY_SELECT} WHERE ac.activity_id = $1::uuid`, id);
    });
  }

  async completeActivity(actor: ModuleActor, activityId: string) {
    const id = parse(UUID, activityId);
    return this.rt.write(actor, P.activityComplete, { targetType: 'CM_CUSTOMER_ACTIVITY', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      await ownerOf(q, ctx.scope, 'cm_customer_activities', 'activity_id', id);
      const r = await tx.update('CM_CUSTOMER_ACTIVITIES', { activity_id: id, activity_status_code: 'OPEN' }, { activity_status_code: 'DONE', completed_at: NOW });
      if (r.count !== 1) throw invalid();
      return one(q, activityRow, `${ACTIVITY_SELECT} WHERE ac.activity_id = $1::uuid`, id);
    });
  }

  // ------------------------------------------------------------------------------------------------------ documents
  // Upload needs a Storage service (no approved one): refused with an explicit reason, nothing is written.
  async createDocument(actor: ModuleActor, customerId: string) {
    const cid = parse(UUID, customerId);
    return this.rt.read(actor, P.documentManage, async (ctx, q) => {
      await requireCustomer(q, ctx.scope, cid);
      throw refuse(503, 'MODULE_UNAVAILABLE', 'STORAGE_UNAVAILABLE');
    });
  }

  async updateDocumentMetadata(actor: ModuleActor, documentId: string, body: unknown) {
    const id = parse(UUID, documentId);
    const b = parse(documentPatch, body);
    return this.rt.write(actor, P.documentManage, { targetType: 'CM_CUSTOMER_DOCUMENT', targetId: id }, async (ctx, tx) => {
      const q = asRead(tx);
      await ownerOf(q, ctx.scope, 'cm_customer_documents', 'document_id', id);
      await tx.lock('CM_CUSTOMER_DOCUMENTS', { document_id: id }, ['document_id']);
      const cur = await one(q, documentRow, `${DOCUMENT_SELECT} WHERE d.document_id = $1::uuid`, id);
      const eff = b.effectiveDate === undefined ? cur.effectiveDate : b.effectiveDate;
      const exp = b.expiryDate === undefined ? cur.expiryDate : b.expiryDate;
      if (eff && exp && eff > exp) throw invalid();
      const set: Record<string, string | null> = {};
      if (b.documentName !== undefined) set['document_name'] = b.documentName;
      if (b.documentType !== undefined) set['document_type_code'] = b.documentType;
      if (b.note !== undefined) set['note'] = b.note;
      if (b.signedDate !== undefined) set['signed_date'] = b.signedDate;
      if (b.effectiveDate !== undefined) set['effective_date'] = b.effectiveDate;
      if (b.expiryDate !== undefined) set['expiry_date'] = b.expiryDate;
      if (Object.keys(set).length === 0) throw invalid();
      await tx.update('CM_CUSTOMER_DOCUMENTS', { document_id: id }, set);
      return one(q, documentRow, `${DOCUMENT_SELECT} WHERE d.document_id = $1::uuid`, id);
    });
  }

  // D06: documents expiring within N days (default 30), visible not-hidden customers, superseded versions excluded.
  async expiringDocuments(actor: ModuleActor, query: unknown) {
    const f = parse(expiringQuery, query);
    return this.rt.read(actor, P.documentRead, async (ctx, q) => parseRows(documentRow, await q.query(`${DOCUMENT_SELECT}
        WHERE d.expiry_date IS NOT NULL AND d.expiry_date <= current_date + $3::int
          AND NOT EXISTS (SELECT 1 FROM cm.cm_customer_documents AS n WHERE n.supersedes_document_id = d.document_id)
          AND EXISTS (SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = d.customer_id AND NOT c.is_hidden AND ${customerScope(1, 2)})
        ORDER BY d.expiry_date, d.document_id LIMIT 1000`, [ctx.scope.readAll, ctx.scope.actorId, f.withinDays ?? POLICY.expiringSoonDays])));
  }
}
