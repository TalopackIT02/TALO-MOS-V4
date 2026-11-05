import { z } from 'zod';
import type { ModuleActor, ReadQuery, WriteTx } from '../../host.js';
import { NOW } from '../../host.js';
import { CrmError, invalid, notFound, refuse } from '../errors.js';
import { P, POLICY } from '../permissions.js';
import { CrmRuntime, UUID, customerScope, ns, parseRows, s, ts } from '../runtime.js';
import type { CrmCtx, CrmScope } from '../runtime.js';
import { asRead, parse } from './appointments.js';

// Khách hàng (REV01 BR-02, 05, 06, 08, 17, 18) + thay đổi pháp lý (BR-03, hai cấp duyệt). Ported from the archived core
// source onto the Host capabilities (no own DB connection): reads through host.readOnly, every write through host.write
// (controlledWrite: IAM + ACTIVE version + enabled B12 rule + audit in the same transaction).
// D01-a: a customer is created DRAFT unless the composite create verifies it in the same transaction; PATCH never touches
// legal fields / record status (409 CM_APPROVAL_REQUIRED); a VERIFIED customer never returns to DRAFT.

export const CUSTOMER_TYPES = ['COMPANY', 'BRANCH', 'HOUSEHOLD', 'PERSON', 'FOREIGN_NO_VN_REG'] as const;
export const CUSTOMER_STATUSES = ['PROSPECT', 'NEW', 'ACTIVE', 'PAUSED', 'CLOSED'] as const;
export const IDENTIFIER_TYPES = ['VN_TAX_ID', 'VN_PERSONAL_ID', 'FOREIGN_REG'] as const;
type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

// BR-06: VN_TAX_ID = 10 digits or 10 + 3 (branch); VN_PERSONAL_ID = 12 digits; FOREIGN_REG = letters / digits, max 128.
export function normalizeIdentifier(type: IdentifierType, raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (type === 'VN_TAX_ID') {
    const d = v.replace(/[\s.-]/g, '');
    return /^[0-9]{10}([0-9]{3})?$/.test(d) ? d : null;
  }
  if (type === 'VN_PERSONAL_ID') {
    const d = v.replace(/\s/g, '');
    return /^[0-9]{12}$/.test(d) ? d : null;
  }
  const d = v.replace(/[\s./-]/g, '');
  return /^[A-Z0-9]{1,128}$/.test(d) ? d : null;
}

// OD-05 proposal (one place): masked like the accepted Gate 1 screens.
export function maskIdentifier(v: string | null): string | null {
  if (!v) return v;
  return v.length <= 3 ? '•••' : '•'.repeat(Math.min(8, v.length - 3)) + v.slice(-3);
}

const optText = (max: number) => z.string().trim().max(max).transform((x) => (x === '' ? null : x)).nullable().optional();
const text = (max: number) => z.string().trim().min(1).max(max);
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const province = z.string().regex(/^[0-9]{2}$/);
const ward = z.string().regex(/^[0-9]{5}$/);
const phone = z.string().trim().regex(/^\+?[0-9 .-]{8,20}$/).transform((x) => x.replace(/[ .-]/g, ''));

const addressFields = {
  addressLine: optText(2000), provinceCode: province.nullable().optional(), wardCode: ward.nullable().optional(), countryCode: country.optional(),
  foreignLocality: optText(150), foreignStateProvince: optText(150),
};
const legalFields = { legalName: optText(255), legalIdentifierType: z.enum(IDENTIFIER_TYPES).nullable().optional(), legalIdentifier: z.string().max(160).nullable().optional() };

export const customerBody = z.strictObject({
  customerType: z.enum(CUSTOMER_TYPES), displayName: text(200), customerStatus: z.enum(CUSTOMER_STATUSES).optional(),
  representativeName: optText(150), representativePhone: phone.nullable().optional(), internalNote: optText(4000), ...legalFields, ...addressFields,
});
export const contactInput = z.strictObject({
  fullName: text(150), positionTitle: optText(100), phone: phone.nullable().optional(), zaloPhone: phone.nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(), isPrimary: z.boolean().optional(),
});
export const customerFullBody = z.strictObject({
  customer: customerBody, contacts: z.array(contactInput).max(20), primarySaleAccountId: UUID.nullable(), supportSaleAccountIds: z.array(UUID).max(20),
  groupIds: z.array(UUID).max(50), verify: z.boolean(),
});
const LEGAL_PATCH_KEYS = ['legalName', 'legalIdentifierType', 'legalIdentifier', 'customerType', 'countryCode', 'recordStatus', 'customerCode'] as const;
export const customerPatch = z.strictObject({
  displayName: text(200).optional(), customerStatus: z.enum(CUSTOMER_STATUSES).optional(), representativeName: optText(150),
  representativePhone: phone.nullable().optional(), internalNote: optText(4000), addressLine: optText(2000), provinceCode: province.nullable().optional(),
  wardCode: ward.nullable().optional(), foreignLocality: optText(150), foreignStateProvince: optText(150),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export const verifyBody = z.strictObject({ ...legalFields, ...addressFields, customerType: z.enum(CUSTOMER_TYPES).optional() });
const bool = z.enum(['true', 'false']).optional();
export const listQuery = z.strictObject({
  q: z.string().trim().max(200).optional(), customerType: z.enum(CUSTOMER_TYPES).or(z.literal('')).optional(),
  customerStatus: z.enum(CUSTOMER_STATUSES).or(z.literal('')).optional(), recordStatus: z.enum(['DRAFT', 'VERIFIED']).or(z.literal('')).optional(),
  provinceCode: province.or(z.literal('')).optional(), macroRegionCode: z.string().max(30).optional(), regionCode: z.string().max(30).optional(),
  saleAccountId: UUID.or(z.literal('')).optional(), saleRole: z.enum(['PRIMARY', 'SUPPORT']).or(z.literal('')).optional(), groupId: UUID.or(z.literal('')).optional(),
  includeHidden: bool, sort: z.enum(['code', 'name', 'createdAt']).optional(), sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const checkIdentityQuery = z.strictObject({
  identifierType: z.enum(IDENTIFIER_TYPES), identifier: z.string().min(1).max(160), countryCode: country.optional(), name: z.string().trim().max(255).optional(),
});
export const legalChangeBody = z.strictObject({
  reason: text(4000), evidenceDocumentId: UUID, newLegalName: text(255), newCustomerType: z.enum(CUSTOMER_TYPES),
  newIdentifierType: z.enum(IDENTIFIER_TYPES), newIdentifier: z.string().min(1).max(160), newCountryCode: country,
});
export const decisionBody = z.strictObject({ stage: z.enum(['MANAGEMENT', 'ACCOUNTING']), decision: z.enum(['APPROVED', 'REJECTED']), note: optText(4000) });

// ---- DTO (shape of the Gate 1 frontend types: Customer / CustomerView / LegalChange) --------------------------------------
const VIEW_COLS = `c.customer_id::text AS "customerId", c.customer_code AS "customerCode", c.display_name AS "displayName", c.legal_name AS "legalName",
  c.customer_type_code AS "customerType", c.customer_status_code AS "customerStatus", c.record_status_code AS "recordStatus",
  c.legal_identifier_type_code AS "legalIdentifierType", c.legal_identifier_normalized AS "legalIdentifier", c.representative_name AS "representativeName",
  c.representative_phone AS "representativePhone", c.address_line AS "addressLine", c.province_code::text AS "provinceCode", c.ward_code::text AS "wardCode",
  c.country_code::text AS "countryCode", c.foreign_locality AS "foreignLocality", c.foreign_state_province AS "foreignStateProvince",
  c.registered_address AS "registeredAddress", c.internal_note AS "internalNote", c.is_hidden AS "isHidden",
  coalesce((SELECT array_agg(gm.group_id::text ORDER BY gm.group_id) FROM cm.cm_customer_group_members AS gm WHERE gm.customer_id = c.customer_id), '{}') AS "groupIds",
  ${ts('c.created_at')} AS "createdAt", coalesce(c.created_account_id::text, '') AS "createdAccountId", ${ts('c.updated_at')} AS "updatedAt",
  (SELECT pa.sale_account_id::text FROM cm.cm_customer_assignments AS pa WHERE pa.customer_id = c.customer_id AND pa.ended_at IS NULL
     AND pa.assignment_role_code = 'PRIMARY') AS "primarySaleAccountId",
  coalesce((SELECT array_agg(sa2.sale_account_id::text ORDER BY sa2.assigned_at, sa2.assignment_id) FROM cm.cm_customer_assignments AS sa2
     WHERE sa2.customer_id = c.customer_id AND sa2.ended_at IS NULL AND sa2.assignment_role_code = 'SUPPORT'), '{}') AS "supportSaleAccountIds",
  (SELECT rm.region_code FROM cm.cm_ref_province_region_map AS rm WHERE rm.province_code = c.province_code
     AND (rm.valid_to IS NULL OR rm.valid_to >= current_date) ORDER BY rm.valid_from DESC LIMIT 1) AS "regionCode",
  (SELECT rm.macro_region_code FROM cm.cm_ref_province_region_map AS rm WHERE rm.province_code = c.province_code
     AND (rm.valid_to IS NULL OR rm.valid_to >= current_date) ORDER BY rm.valid_from DESC LIMIT 1) AS "macroRegionCode"`;

export const customerRow = z.object({
  customerId: s, customerCode: s, displayName: s, legalName: ns, customerType: z.enum(CUSTOMER_TYPES), customerStatus: z.enum(CUSTOMER_STATUSES),
  recordStatus: z.enum(['DRAFT', 'VERIFIED']), legalIdentifierType: z.enum(IDENTIFIER_TYPES).nullable(), legalIdentifier: ns, representativeName: ns,
  representativePhone: ns, addressLine: ns, provinceCode: ns, wardCode: ns, countryCode: s, foreignLocality: ns, foreignStateProvince: ns, registeredAddress: ns,
  internalNote: ns, isHidden: z.boolean(), groupIds: z.array(s), createdAt: s, createdAccountId: s, updatedAt: ns, primarySaleAccountId: ns,
  supportSaleAccountIds: z.array(s), regionCode: ns, macroRegionCode: ns,
});
type CustomerRow = z.infer<typeof customerRow>;
export type CustomerView = CustomerRow & { identifierMasked: boolean };

export function view(row: CustomerRow, canViewIdentifier: boolean): CustomerView {
  const masked = !canViewIdentifier && row.legalIdentifier !== null;
  return { ...row, legalIdentifier: masked ? maskIdentifier(row.legalIdentifier) : row.legalIdentifier, identifierMasked: masked };
}

export async function loadCustomer(q: ReadQuery, scope: CrmScope, id: string): Promise<CustomerRow> {
  const [row] = await q.query(`SELECT ${VIEW_COLS} FROM cm.cm_customers AS c WHERE c.customer_id = $1::uuid AND ${customerScope(2, 3)}`, [id, scope.readAll, scope.actorId]);
  if (row === undefined) throw notFound();
  return customerRow.parse(row);
}

const LEGAL_COLS = `r.change_request_id::text AS "changeRequestId", r.customer_id::text AS "customerId", r.requested_by_account_id::text AS "requestedByAccountId",
  ${ts('r.requested_at')} AS "requestedAt", r.status_code AS status, r.reason, r.evidence_document_id::text AS "evidenceDocumentId",
  r.old_legal_name AS "oldLegalName", r.new_legal_name AS "newLegalName", r.old_country_code::text AS "oldCountryCode", r.new_country_code::text AS "newCountryCode",
  r.old_customer_type_code AS "oldCustomerType", r.new_customer_type_code AS "newCustomerType", r.old_identifier_type_code AS "oldIdentifierType",
  r.new_identifier_type_code AS "newIdentifierType", r.old_identifier_normalized AS "oldIdentifier", r.new_identifier_normalized AS "newIdentifier",
  ${ts('r.applied_at')} AS "appliedAt",
  coalesce((SELECT json_agg(json_build_object('stage', a.stage_code, 'decision', a.decision_code, 'decidedByAccountId', a.decided_by_account_id::text,
     'decidedAt', ${ts('a.decided_at')}, 'note', a.decision_note) ORDER BY a.decided_at) FROM cm.cm_customer_legal_change_approvals AS a
     WHERE a.change_request_id = r.change_request_id), '[]'::json) AS decisions`;
const decisionRow = z.object({ stage: z.enum(['MANAGEMENT', 'ACCOUNTING']), decision: z.enum(['APPROVED', 'REJECTED']), decidedByAccountId: s, decidedAt: s, note: ns });
export const legalRow = z.object({
  changeRequestId: s, customerId: s, requestedByAccountId: s, requestedAt: s,
  status: z.enum(['PENDING_MANAGEMENT', 'PENDING_ACCOUNTING', 'APPLIED', 'REJECTED', 'CANCELLED']), reason: s, evidenceDocumentId: s,
  oldLegalName: ns, newLegalName: s, oldCountryCode: s, newCountryCode: s, oldCustomerType: z.enum(CUSTOMER_TYPES).nullable(), newCustomerType: z.enum(CUSTOMER_TYPES),
  oldIdentifierType: z.enum(IDENTIFIER_TYPES).nullable(), newIdentifierType: z.enum(IDENTIFIER_TYPES), oldIdentifier: ns, newIdentifier: s, appliedAt: ns,
  decisions: z.array(decisionRow),
});
export const legalSelect = (where: string) => `SELECT ${LEGAL_COLS} FROM cm.cm_customer_legal_change_requests AS r WHERE ${where}`;

// ---- address / identifier rules ---------------------------------------------------------------------------------------
interface AddressIn { addressLine?: string | null | undefined; provinceCode?: string | null | undefined; wardCode?: string | null | undefined;
  countryCode?: string | undefined; foreignLocality?: string | null | undefined; foreignStateProvince?: string | null | undefined }
interface Address { addressLine: string | null; provinceCode: string | null; wardCode: string | null; countryCode: string; foreignLocality: string | null;
  foreignStateProvince: string | null; registeredAddress: string | null }
const NO_ADDRESS: Omit<Address, 'registeredAddress'> = { addressLine: null, provinceCode: null, wardCode: null, countryCode: 'VN', foreignLocality: null, foreignStateProvince: null };

// BR-08: Vietnamese address = province + ward of that province (reference data required); foreign address = no VN codes.
async function resolveAddress(q: ReadQuery, input: AddressIn, base: Omit<Address, 'registeredAddress'>, customerType: string): Promise<Address> {
  const pick = (k: keyof AddressIn, fallback: string | null): string | null => {
    const v = input[k];
    return v === undefined ? fallback : (v ?? null);
  };
  const countryCode = input.countryCode ?? base.countryCode;
  const a = { addressLine: pick('addressLine', base.addressLine), provinceCode: pick('provinceCode', base.provinceCode), wardCode: pick('wardCode', base.wardCode),
    countryCode, foreignLocality: pick('foreignLocality', base.foreignLocality), foreignStateProvince: pick('foreignStateProvince', base.foreignStateProvince) };
  if (customerType === 'FOREIGN_NO_VN_REG' && countryCode === 'VN') throw invalid();
  if (countryCode !== 'VN') {
    if (a.provinceCode !== null || a.wardCode !== null) throw invalid();
    const parts = [a.addressLine, a.foreignLocality, a.foreignStateProvince, countryCode].filter((x): x is string => !!x);
    return { ...a, registeredAddress: a.addressLine ? parts.join(', ') : null };
  }
  if (a.foreignLocality !== null || a.foreignStateProvince !== null) throw invalid();
  if (a.wardCode !== null && a.provinceCode === null) throw new CrmError(422, 'CM_INVALID_PROVINCE_WARD');
  let names: { ward_name: string; province_name: string } | undefined;
  if (a.provinceCode !== null) {
    const [ref] = await q.query(`SELECT (SELECT count(*)::int FROM cm.cm_ref_wards) AS n`, []);
    if (z.object({ n: z.number() }).parse(ref).n === 0) throw new CrmError(503, 'CM_REFERENCE_UNAVAILABLE');
    if (a.wardCode !== null) {
      const [w] = await q.query(`SELECT w.ward_name, p.province_name FROM cm.cm_ref_wards AS w JOIN cm.cm_ref_provinces AS p ON p.province_code = w.province_code
        WHERE w.ward_code = $1 AND w.province_code = $2 AND w.is_active AND p.is_active`, [a.wardCode, a.provinceCode]);
      if (w === undefined) throw new CrmError(422, 'CM_INVALID_PROVINCE_WARD');
      names = z.object({ ward_name: s, province_name: s }).parse(w);
    } else {
      const p = await q.query(`SELECT 1 FROM cm.cm_ref_provinces WHERE province_code = $1 AND is_active`, [a.provinceCode]);
      if (p.length === 0) throw new CrmError(422, 'CM_INVALID_PROVINCE_WARD');
    }
  }
  return { ...a, registeredAddress: a.addressLine && names ? `${a.addressLine}, ${names.ward_name}, ${names.province_name}` : a.addressLine };
}

function identifier(type: IdentifierType | null | undefined, raw: string | null | undefined): { type: IdentifierType | null; value: string | null } {
  if ((type ?? null) === null && (raw ?? null) === null) return { type: null, value: null };
  if (!type || !raw) throw invalid();
  const value = normalizeIdentifier(type, raw);
  if (value === null) throw invalid(); // TC-08
  return { type, value };
}

// BR-06: duplicates over EVERY customer (hidden included), excluding the customer itself. Answer is yes / no only.
async function identifierTaken(q: ReadQuery, country: string, type: string, value: string, exceptId: string | null): Promise<boolean> {
  const rows = await q.query(`SELECT 1 FROM cm.cm_customers WHERE country_code = $1 AND legal_identifier_type_code = $2 AND legal_identifier_normalized = $3
      AND ($4::uuid IS NULL OR customer_id <> $4::uuid) LIMIT 1`, [country, type, value, exceptId]);
  return rows.length > 0;
}

// TC-07: same display / legal name (case and outer spaces ignored), counted only among the caller's in-scope customers.
async function similarNames(q: ReadQuery, scope: CrmScope, name: string | null | undefined, exceptId: string | null): Promise<number> {
  if (!name) return 0;
  const [r] = await q.query(`SELECT count(*)::int AS n FROM cm.cm_customers AS c WHERE ($2::uuid IS NULL OR c.customer_id <> $2::uuid) AND ${customerScope(3, 4)}
      AND (lower(btrim(c.display_name)) = lower(btrim($1)) OR lower(btrim(coalesce(c.legal_name, ''))) = lower(btrim($1)))`, [name, exceptId, scope.readAll, scope.actorId]);
  return z.object({ n: z.number() }).parse(r).n;
}

const missingForVerified = (c: { legalName: string | null; legalIdentifierType: string | null; legalIdentifier: string | null; addressLine: string | null;
  countryCode: string; provinceCode: string | null; wardCode: string | null }): string[] => {
  const m: string[] = [];
  if (!c.legalName?.trim()) m.push('legalName');
  if (!c.legalIdentifierType) m.push('legalIdentifierType');
  if (!c.legalIdentifier?.trim()) m.push('legalIdentifier');
  if (!c.addressLine?.trim()) m.push('addressLine');
  if (c.countryCode === 'VN' && (!c.provinceCode || !c.wardCode)) m.push('provinceCode/wardCode');
  return m;
};

export async function accountActive(q: ReadQuery, accountId: string): Promise<boolean> {
  const rows = await q.query(`SELECT 1 FROM iam.iam_user_accounts WHERE user_account_id = $1::uuid AND account_status = 'ACTIVE' AND disabled_at IS NULL`, [accountId]);
  return rows.length === 1;
}

const escapeLike = (v: string) => `%${v.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
const ORDER = { code: 'c.customer_code', name: 'lower(c.display_name)', createdAt: 'c.created_at' } as const;

// List filters → WHERE. The scope is always the first condition (before COUNT and paging: BR-17 / TC-48).
function filter(ctx: CrmCtx, canId: boolean, f: z.infer<typeof listQuery>): { where: string; params: unknown[] } {
  const params: unknown[] = [ctx.scope.readAll, ctx.scope.actorId];
  const w: string[] = [customerScope(1, 2)];
  const add = (sql: (n: number) => string, v: unknown) => { params.push(v); w.push(sql(params.length)); };
  if (!(f.includeHidden === 'true' && ctx.scope.readAll)) w.push('NOT c.is_hidden');
  // OD-05: without the identifier right the identifier is not a search field either.
  if (f.q) add((n) => `(c.customer_code ILIKE $${n} OR c.display_name ILIKE $${n} OR c.legal_name ILIKE $${n}${canId ? ` OR c.legal_identifier_normalized ILIKE $${n}` : ''})`, escapeLike(f.q));
  if (f.customerType) add((n) => `c.customer_type_code = $${n}`, f.customerType);
  if (f.customerStatus) add((n) => `c.customer_status_code = $${n}`, f.customerStatus);
  if (f.recordStatus) add((n) => `c.record_status_code = $${n}`, f.recordStatus);
  if (f.provinceCode) add((n) => `c.province_code = $${n}`, f.provinceCode);
  const regionSql = (col: string) => (n: number) => `EXISTS (SELECT 1 FROM cm.cm_ref_province_region_map AS fr WHERE fr.province_code = c.province_code
    AND (fr.valid_to IS NULL OR fr.valid_to >= current_date) AND fr.${col} = $${n})`;
  if (f.regionCode) add(regionSql('region_code'), f.regionCode);
  if (f.macroRegionCode) add(regionSql('macro_region_code'), f.macroRegionCode);
  if (f.saleAccountId || f.saleRole) {
    params.push(f.saleAccountId || ctx.scope.actorId);
    const n = params.length;
    let role = '';
    if (f.saleRole) { params.push(f.saleRole); role = ` AND fa.assignment_role_code = $${params.length}`; }
    w.push(`EXISTS (SELECT 1 FROM cm.cm_customer_assignments AS fa WHERE fa.customer_id = c.customer_id AND fa.ended_at IS NULL AND fa.sale_account_id = $${n}::uuid${role})`);
  }
  if (f.groupId) add((n) => `EXISTS (SELECT 1 FROM cm.cm_customer_group_members AS gm WHERE gm.customer_id = c.customer_id AND gm.group_id = $${n}::uuid)`, f.groupId);
  return { where: w.join(' AND '), params };
}

const csvSafe = (v: string | null): string => {
  if (v === null) return '';
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // TC-49: never start a cell with a formula character
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};
export const EXPORT_MAX_ROWS = 5000;

export class CustomerService {
  constructor(private readonly rt: CrmRuntime) {}

  private async canId(ctx: CrmCtx): Promise<boolean> {
    return ctx.allowed(POLICY.identifierViewPermission);
  }

  async list(actor: ModuleActor, query: unknown) {
    const f = parse(listQuery, query);
    return this.rt.read(actor, P.customerRead, async (ctx, q) => {
      const canId = await this.canId(ctx);
      const { where, params } = filter(ctx, canId, f);
      const page = f.page ?? 1;
      const pageSize = f.pageSize ?? 20;
      const [cnt] = await q.query(`SELECT count(*)::int AS n FROM cm.cm_customers AS c WHERE ${where}`, params);
      const dir = f.sortDir === 'desc' ? 'DESC' : 'ASC';
      const rows = parseRows(customerRow, await q.query(`SELECT ${VIEW_COLS} FROM cm.cm_customers AS c WHERE ${where}
        ORDER BY ${ORDER[f.sort ?? 'code']} ${dir}, c.customer_id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]));
      return { items: rows.map((r) => view(r, canId)), total: z.object({ n: z.number() }).parse(cnt).n, page, pageSize };
    });
  }

  // Pickers (appointments / tasks / reports): every visible, not hidden customer (bounded).
  async visible(actor: ModuleActor) {
    return this.rt.read(actor, P.customerRead, async (ctx, q) => {
      const canId = await this.canId(ctx);
      const rows = parseRows(customerRow, await q.query(`SELECT ${VIEW_COLS} FROM cm.cm_customers AS c WHERE ${customerScope(1, 2)} AND NOT c.is_hidden
        ORDER BY c.customer_code LIMIT 2000`, [ctx.scope.readAll, ctx.scope.actorId]));
      return rows.map((r) => view(r, canId));
    });
  }

  async get(actor: ModuleActor, id: string) {
    const customerId = parse(UUID, id);
    return this.rt.read(actor, P.customerRead, async (ctx, q) => view(await loadCustomer(q, ctx.scope, customerId), await this.canId(ctx)));
  }

  async checkIdentity(actor: ModuleActor, query: unknown) {
    const f = parse(checkIdentityQuery, query);
    const permission = (await this.rt.allowedFor(actor, P.customerCreate)) ? P.customerCreate : P.customerUpdate;
    return this.rt.read(actor, permission, async (ctx, q) => {
      const value = normalizeIdentifier(f.identifierType, f.identifier);
      if (value === null) return { normalized: null, duplicate: false, similarNameCount: await similarNames(q, ctx.scope, f.name, null) };
      return { normalized: value, duplicate: await identifierTaken(q, f.countryCode ?? 'VN', f.identifierType, value, null), similarNameCount: await similarNames(q, ctx.scope, f.name, null) };
    });
  }

  async create(actor: ModuleActor, body: unknown) {
    const b = parse(customerBody, body);
    return this.createFull(actor, { customer: b, contacts: [], primarySaleAccountId: null, supportSaleAccountIds: [], groupIds: [], verify: false });
  }

  // Composite create (Gate 1 form: customer + contacts + sales + groups + optional verification) in ONE transaction
  // (GAP-API-01 closed): any failure rolls back everything. Each part keeps its own IAM right.
  async createFull(actor: ModuleActor, body: unknown) {
    const b = parse(customerFullBody, body);
    return this.rt.write(actor, P.customerCreate, { targetType: 'CM_CUSTOMER' }, async (ctx, tx) => {
      const q = asRead(tx);
      const c = b.customer;
      if (b.contacts.length && !(await ctx.allowed(P.contactManage))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if ((b.primarySaleAccountId || b.supportSaleAccountIds.length) && !(await ctx.allowed(P.assignmentManage))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if (b.groupIds.length && !(await ctx.allowed(P.groupAssign))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      if (b.verify && !(await ctx.allowed(P.customerVerify))) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      const id = identifier(c.legalIdentifierType, c.legalIdentifier);
      const addr = await resolveAddress(q, c, NO_ADDRESS, c.customerType);
      if (id.type && id.value && await identifierTaken(q, addr.countryCode, id.type, id.value, null)) throw new CrmError(409, 'CM_IDENTITY_DUPLICATE');
      if (b.verify && missingForVerified({ legalName: c.legalName ?? null, legalIdentifierType: id.type, legalIdentifier: id.value, ...addr }).length > 0) throw invalid();
      const me = ctx.actor.userAccountId;
      const [row] = await tx.insert('CM_CUSTOMERS', {
        display_name: c.displayName, legal_name: c.legalName ?? null, registered_address: addr.registeredAddress, representative_name: c.representativeName ?? null,
        representative_phone: c.representativePhone ?? null, customer_type_code: c.customerType, customer_status_code: c.customerStatus ?? 'PROSPECT',
        internal_note: c.internalNote ?? null, created_account_id: me, legal_identifier_type_code: id.type, legal_identifier_normalized: id.value,
        address_line: addr.addressLine, province_code: addr.provinceCode, ward_code: addr.wardCode, country_code: addr.countryCode,
        foreign_locality: addr.foreignLocality, foreign_state_province: addr.foreignStateProvince, record_status_code: b.verify ? 'VERIFIED' : 'DRAFT',
      }, ['customer_id']);
      const customerId = String(row?.['customer_id']);
      tx.setAuditTarget(customerId);

      // Contacts: at most one active primary (DB partial unique index as the last guard).
      if (b.contacts.filter((x) => x.isPrimary).length > 1) throw refuse(422, 'CM_VALIDATION_FAILED', 'PRIMARY_CONTACT_EXISTS');
      for (const ct of b.contacts) {
        if (!ct.phone && !ct.zaloPhone) throw refuse(422, 'CM_VALIDATION_FAILED', 'CONTACT_PHONE_REQUIRED');
        await tx.insert('CM_CUSTOMER_CONTACTS', { customer_id: customerId, full_name: ct.fullName, position_title: ct.positionTitle ?? null, phone: ct.phone ?? null,
          zalo_phone: ct.zaloPhone ?? null, email: ct.email ?? null, is_primary: ct.isPrimary ?? false, created_account_id: me });
      }
      // Sales (BR-09): one PRIMARY, any number of distinct SUPPORT sales, all ACTIVE accounts.
      let primary = b.primarySaleAccountId;
      if (primary === null && POLICY.autoAssignCreatorAsPrimary && !ctx.scope.readAll) primary = me; // FE-G01 (PENDING, off)
      const supports = [...new Set(b.supportSaleAccountIds)];
      if (primary !== null && supports.includes(primary)) throw refuse(409, 'CM_VALIDATION_FAILED', 'ASSIGNMENT_CONFLICT');
      for (const [sale, role] of [...(primary ? [[primary, 'PRIMARY'] as const] : []), ...supports.map((x) => [x, 'SUPPORT'] as const)]) {
        if (!(await accountActive(q, sale))) throw invalid();
        await tx.insert('CM_CUSTOMER_ASSIGNMENTS', { customer_id: customerId, sale_account_id: sale, assigned_by_account_id: me, assignment_role_code: role });
      }
      // Groups: active groups only.
      for (const g of [...new Set(b.groupIds)]) {
        const ok = await q.query(`SELECT 1 FROM cm.cm_customer_groups WHERE group_id = $1::uuid AND is_active`, [g]);
        if (ok.length !== 1) throw invalid();
        await tx.insert('CM_CUSTOMER_GROUP_MEMBERS', { customer_id: customerId, group_id: g, assigned_account_id: me });
      }
      const created = await q.query(`SELECT ${VIEW_COLS} FROM cm.cm_customers AS c WHERE c.customer_id = $1::uuid`, [customerId]);
      const similar = await similarNames(q, ctx.scope, c.legalName ?? c.displayName, customerId);
      return { customer: view(customerRow.parse(created[0]), await this.canId(ctx)), warnings: similar > 0 ? [`CM_SIMILAR_NAME:${similar}`] : [] };
    });
  }

  async update(actor: ModuleActor, id: string, body: unknown) {
    const customerId = parse(UUID, id);
    if (typeof body === 'object' && body !== null && LEGAL_PATCH_KEYS.some((k) => k in body)) throw new CrmError(409, 'CM_APPROVAL_REQUIRED'); // TC-19
    const b = parse(customerPatch, body);
    return this.rt.write(actor, P.customerUpdate, { targetType: 'CM_CUSTOMER', targetId: customerId }, async (ctx, tx) => {
      const q = asRead(tx);
      const cur = await loadCustomer(q, ctx.scope, customerId);
      await tx.lock('CM_CUSTOMERS', { customer_id: customerId }, ['updated_at']);
      const fresh = await loadCustomer(q, ctx.scope, customerId);
      if (b.expectedUpdatedAt !== undefined && (b.expectedUpdatedAt === null ? fresh.updatedAt !== null
        : fresh.updatedAt === null || Date.parse(fresh.updatedAt) !== Date.parse(b.expectedUpdatedAt))) throw new CrmError(409, 'CM_CONCURRENT_UPDATE');
      const touchesAddress = (['addressLine', 'provinceCode', 'wardCode', 'foreignLocality', 'foreignStateProvince'] as const).some((k) => b[k] !== undefined);
      const addr = touchesAddress ? await resolveAddress(q, b, cur, cur.customerType) : null;
      const set: Record<string, string | boolean | null> = {};
      if (b.displayName !== undefined) set['display_name'] = b.displayName;
      if (b.customerStatus !== undefined) set['customer_status_code'] = b.customerStatus;
      if (b.representativeName !== undefined) set['representative_name'] = b.representativeName;
      if (b.representativePhone !== undefined) set['representative_phone'] = b.representativePhone;
      if (b.internalNote !== undefined) set['internal_note'] = b.internalNote;
      if (addr) {
        // A VERIFIED customer keeps a complete registered address (CHECK official profile + Gate 1 rule).
        if (cur.recordStatus === 'VERIFIED' && missingForVerified({ ...cur, ...addr }).length > 0) throw invalid();
        Object.assign(set, { address_line: addr.addressLine, province_code: addr.provinceCode, ward_code: addr.wardCode, foreign_locality: addr.foreignLocality,
          foreign_state_province: addr.foreignStateProvince, registered_address: addr.registeredAddress });
      }
      if (Object.keys(set).length === 0) throw invalid();
      await tx.update('CM_CUSTOMERS', { customer_id: customerId }, { ...set, updated_at: NOW, updated_account_id: ctx.actor.userAccountId });
      return view(await loadCustomer(q, ctx.scope, customerId), await this.canId(ctx));
    });
  }

  async verify(actor: ModuleActor, id: string, body: unknown) {
    const customerId = parse(UUID, id);
    const b = parse(verifyBody, body ?? {});
    return this.rt.write(actor, P.customerVerify, { targetType: 'CM_CUSTOMER', targetId: customerId }, async (ctx, tx) => {
      const q = asRead(tx);
      await loadCustomer(q, ctx.scope, customerId);
      await tx.lock('CM_CUSTOMERS', { customer_id: customerId }, ['record_status_code']);
      const cur = await loadCustomer(q, ctx.scope, customerId);
      if (cur.recordStatus === 'VERIFIED') throw refuse(409, 'CM_VALIDATION_FAILED', 'ALREADY_VERIFIED');
      const type = b.customerType ?? cur.customerType;
      const idIn = b.legalIdentifierType !== undefined || b.legalIdentifier !== undefined
        ? identifier(b.legalIdentifierType ?? cur.legalIdentifierType, b.legalIdentifier ?? cur.legalIdentifier)
        : { type: cur.legalIdentifierType, value: cur.legalIdentifier };
      const addr = await resolveAddress(q, b, cur, type);
      const legalName = b.legalName === undefined ? cur.legalName : b.legalName;
      if (missingForVerified({ legalName, legalIdentifierType: idIn.type, legalIdentifier: idIn.value, ...addr }).length > 0) throw invalid(); // TC-03
      if (await identifierTaken(q, addr.countryCode, idIn.type ?? '', idIn.value ?? '', customerId)) throw new CrmError(409, 'CM_IDENTITY_DUPLICATE');
      const r = await tx.update('CM_CUSTOMERS', { customer_id: customerId, record_status_code: 'DRAFT' }, {
        customer_type_code: type, legal_name: legalName, legal_identifier_type_code: idIn.type, legal_identifier_normalized: idIn.value, address_line: addr.addressLine,
        province_code: addr.provinceCode, ward_code: addr.wardCode, country_code: addr.countryCode, foreign_locality: addr.foreignLocality,
        foreign_state_province: addr.foreignStateProvince, registered_address: addr.registeredAddress, record_status_code: 'VERIFIED', updated_at: NOW,
        updated_account_id: ctx.actor.userAccountId,
      });
      if (r.count !== 1) throw new CrmError(409, 'CM_CONCURRENT_UPDATE');
      return view(await loadCustomer(q, ctx.scope, customerId), await this.canId(ctx));
    });
  }

  async hide(actor: ModuleActor, id: string) {
    const customerId = parse(UUID, id);
    return this.rt.write(actor, P.customerHide, { targetType: 'CM_CUSTOMER', targetId: customerId }, async (ctx, tx) => {
      const q = asRead(tx);
      const cur = await loadCustomer(q, ctx.scope, customerId);
      if (!cur.isHidden) await tx.update('CM_CUSTOMERS', { customer_id: customerId }, { is_hidden: true, updated_at: NOW, updated_account_id: ctx.actor.userAccountId });
      return view(await loadCustomer(q, ctx.scope, customerId), await this.canId(ctx));
    });
  }

  // BR-18: allowed fields only (no internal note / phone / audit columns); audited as CRM.CUSTOMER.EXPORT (no DB write).
  async exportCsv(actor: ModuleActor, query: unknown): Promise<string> {
    const f = parse(listQuery, query);
    return this.rt.write(actor, P.customerExport, { targetType: 'CM_CUSTOMER' }, async (ctx, tx) => {
      const q = asRead(tx);
      const canId = await this.canId(ctx);
      const { where, params } = filter(ctx, canId, f);
      const [cnt] = await q.query(`SELECT count(*)::int AS n FROM cm.cm_customers AS c WHERE ${where}`, params);
      if (z.object({ n: z.number() }).parse(cnt).n > EXPORT_MAX_ROWS) throw invalid();
      const rows = parseRows(customerRow, await q.query(`SELECT ${VIEW_COLS} FROM cm.cm_customers AS c WHERE ${where} ORDER BY c.customer_code, c.customer_id`, params))
        .map((r) => view(r, canId));
      const header = ['customer_code', 'display_name', 'legal_name', 'customer_type', 'customer_status', 'record_status', 'identifier_type', 'identifier',
        'address', 'province_code', 'ward_code', 'country_code'];
      const lines = rows.map((c) => [c.customerCode, c.displayName, c.legalName, c.customerType, c.customerStatus, c.recordStatus, c.legalIdentifierType,
        c.legalIdentifier, c.registeredAddress, c.provinceCode, c.wardCode, c.countryCode].map(csvSafe).join(','));
      return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
    });
  }

  // ------------------------------------------------------------------------------------------- legal change (BR-03)
  async listLegalChanges(actor: ModuleActor, customerId?: string) {
    const cid = customerId === undefined ? null : parse(UUID, customerId);
    return this.rt.read(actor, P.legalRead, async (ctx, q) => parseRows(legalRow, await q.query(legalSelect(`EXISTS (SELECT 1 FROM cm.cm_customers AS c
        WHERE c.customer_id = r.customer_id AND ${customerScope(1, 2)}) AND ($3::uuid IS NULL OR r.customer_id = $3::uuid) ORDER BY r.requested_at DESC, r.change_request_id`),
      [ctx.scope.readAll, ctx.scope.actorId, cid])));
  }

  async requestLegalChange(actor: ModuleActor, customerId: string, body: unknown) {
    const cid = parse(UUID, customerId);
    const b = parse(legalChangeBody, body);
    return this.rt.write(actor, P.legalRequest, { targetType: 'CM_LEGAL_CHANGE' }, async (ctx, tx) => {
      const q = asRead(tx);
      await loadCustomer(q, ctx.scope, cid);
      // No customer row lock (LEGAL_CHANGE.REQUEST has no write rule on cm_customers): the partial unique index
      // uq_cm_legal_request_one_pending_customer is the last guard; the ACCOUNTING step re-checks the snapshot (TC-24).
      const cur = await loadCustomer(q, ctx.scope, cid);
      if (cur.recordStatus !== 'VERIFIED') throw new CrmError(409, 'CM_DRAFT_NOT_ELIGIBLE'); // a DRAFT is completed through /verify
      const value = normalizeIdentifier(b.newIdentifierType, b.newIdentifier);
      if (value === null) throw invalid();
      if (b.newCustomerType === 'FOREIGN_NO_VN_REG' && b.newCountryCode === 'VN') throw invalid();
      if (cur.legalName === b.newLegalName && cur.customerType === b.newCustomerType && cur.countryCode === b.newCountryCode
        && cur.legalIdentifierType === b.newIdentifierType && cur.legalIdentifier === value) throw refuse(422, 'CM_VALIDATION_FAILED', 'NOT_DIFFERENT');
      const pending = await q.query(`SELECT 1 FROM cm.cm_customer_legal_change_requests WHERE customer_id = $1::uuid AND status_code IN ('PENDING_MANAGEMENT', 'PENDING_ACCOUNTING')`, [cid]);
      if (pending.length > 0) throw refuse(409, 'CM_APPROVAL_REQUIRED', 'LEGAL_CHANGE_PENDING');
      const doc = await q.query(`SELECT 1 FROM cm.cm_customer_documents WHERE document_id = $1::uuid AND customer_id = $2::uuid`, [b.evidenceDocumentId, cid]);
      if (doc.length === 0) throw refuse(422, 'CM_VALIDATION_FAILED', 'EVIDENCE_REQUIRED'); // TC-20
      if (await identifierTaken(q, b.newCountryCode, b.newIdentifierType, value, cid)) throw new CrmError(409, 'CM_IDENTITY_DUPLICATE');
      const [row] = await tx.insert('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', {
        customer_id: cid, requested_by_account_id: ctx.actor.userAccountId, reason: b.reason, evidence_document_id: b.evidenceDocumentId,
        old_legal_name: cur.legalName, new_legal_name: b.newLegalName, old_country_code: cur.countryCode, new_country_code: b.newCountryCode,
        old_customer_type_code: cur.customerType, new_customer_type_code: b.newCustomerType, old_identifier_type_code: cur.legalIdentifierType,
        new_identifier_type_code: b.newIdentifierType, old_identifier_normalized: cur.legalIdentifier, new_identifier_normalized: value,
      }, ['change_request_id']);
      const requestId = String(row?.['change_request_id']);
      tx.setAuditTarget(requestId);
      return legalRow.parse((await q.query(legalSelect('r.change_request_id = $1::uuid'), [requestId]))[0]);
    });
  }

  // BR-03 two-step decision. MANAGEMENT: PENDING_MANAGEMENT → PENDING_ACCOUNTING | REJECTED. ACCOUNTING: PENDING_ACCOUNTING →
  // APPLIED (customer legal fields replaced from the request snapshot, same transaction) | REJECTED. A rejection states why.
  async decide(actor: ModuleActor, requestId: string, body: unknown) {
    const rid = parse(UUID, requestId);
    const b = parse(decisionBody, body);
    if (b.decision === 'REJECTED' && !b.note) throw invalid();
    const permission = b.stage === 'MANAGEMENT' ? P.legalApproveManagement : P.legalApproveAccounting;
    return this.rt.write(actor, permission, { targetType: 'CM_LEGAL_CHANGE', targetId: rid }, async (ctx, tx) => {
      const q = asRead(tx);
      const [owner] = await q.query(`SELECT customer_id::text AS id FROM cm.cm_customer_legal_change_requests WHERE change_request_id = $1::uuid`, [rid]);
      if (owner === undefined) throw notFound();
      const customerId = z.object({ id: s }).parse(owner).id;
      await loadCustomer(q, ctx.scope, customerId);
      if (b.stage === 'ACCOUNTING') await tx.lock('CM_CUSTOMERS', { customer_id: customerId }, ['record_status_code']); // applies to the customer
      await tx.lock('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', { change_request_id: rid }, ['status_code']);
      const cur = await loadCustomer(q, ctx.scope, customerId);
      const req = legalRow.parse((await q.query(legalSelect('r.change_request_id = $1::uuid'), [rid]))[0]);
      if (req.status !== (b.stage === 'MANAGEMENT' ? 'PENDING_MANAGEMENT' : 'PENDING_ACCOUNTING')) throw refuse(409, 'CM_APPROVAL_REQUIRED', 'LEGAL_CHANGE_INVALID_STATE');
      if (POLICY.forbidSelfApproval && req.requestedByAccountId === ctx.actor.userAccountId) throw refuse(403, 'CM_PERMISSION_DENIED', 'SELF_APPROVAL'); // D04 (off)
      await tx.insert('CM_CUSTOMER_LEGAL_CHANGE_APPROVALS', { change_request_id: rid, stage_code: b.stage, decision_code: b.decision,
        decided_by_account_id: ctx.actor.userAccountId, decision_note: b.note ?? null });
      if (b.decision === 'REJECTED') {
        await tx.update('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', { change_request_id: rid }, { status_code: 'REJECTED', resolved_at: NOW });
      } else if (b.stage === 'MANAGEMENT') {
        await tx.update('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', { change_request_id: rid }, { status_code: 'PENDING_ACCOUNTING' });
      } else {
        // The snapshot must still describe the customer (no concurrent legal change): TC-24.
        const same = cur.legalName === req.oldLegalName && cur.countryCode === req.oldCountryCode && cur.customerType === req.oldCustomerType
          && cur.legalIdentifierType === req.oldIdentifierType && cur.legalIdentifier === req.oldIdentifier;
        if (!same) throw new CrmError(409, 'CM_CONCURRENT_UPDATE');
        if (await identifierTaken(q, req.newCountryCode, req.newIdentifierType, req.newIdentifier, customerId)) throw new CrmError(409, 'CM_IDENTITY_DUPLICATE');
        await tx.update('CM_CUSTOMERS', { customer_id: customerId }, { legal_name: req.newLegalName, country_code: req.newCountryCode,
          customer_type_code: req.newCustomerType, legal_identifier_type_code: req.newIdentifierType, legal_identifier_normalized: req.newIdentifier,
          updated_at: NOW, updated_account_id: ctx.actor.userAccountId });
        await tx.update('CM_CUSTOMER_LEGAL_CHANGE_REQUESTS', { change_request_id: rid }, { status_code: 'APPLIED', applied_at: NOW, resolved_at: NOW,
          applied_by_account_id: ctx.actor.userAccountId });
      }
      return legalRow.parse((await q.query(legalSelect('r.change_request_id = $1::uuid'), [rid]))[0]);
    });
  }
}

export type { CustomerRow, WriteTx };
