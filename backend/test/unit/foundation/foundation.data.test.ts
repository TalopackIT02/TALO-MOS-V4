import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { COMPAT_SQL } from '../../../src/modules/foundation/foundation.compatibility.repository.js';
import { dataPlan } from '../../../src/modules/foundation/foundation.data.js';
import { DATA_SQL } from '../../../src/modules/foundation/foundation.data.repository.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { MANIFEST_SQL } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { validateMic } from '../../../src/modules/foundation/foundation.mic.js';
import type { Mic, MicContext } from '../../../src/modules/foundation/foundation.mic.js';
import { REGISTRY_SQL } from '../../../src/modules/foundation/foundation.registry.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import {
  ACCOUNT_A, PERM_VCREATE_ID, PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, pgError, seedModule,
  seedVersion, token,
} from './fakes.js';
import type { Harness } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-04 — MIC-06 extension (Q3–Q6) and the B10 / B11 / B12 materialisation in the SUBMIT transaction (Q1, Q7).
// Mock/unit only: FakeDb models B10–B14 with the DDL FKs, UNIQUEs, CHECKs and VARCHAR widths. No PostgreSQL.

const TOKEN = token('dataContractSessionToken');
const DATA = new Set<string>([...Object.values(DATA_SQL), ...Object.values(COMPAT_SQL)]);
const ctx = (over: Partial<MicContext> = {}): MicContext => ({ moduleKey: 'SALES', moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', otherVersions: [], ...over });

function setup() {
  const iam = defaultIam();
  iam.grants = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID].map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  const m = seedModule(h.db, 'SALES');
  const v = seedVersion(h.db, m.module_id, '1.0.0');
  return { h, m, v };
}
const sendJson = (h: Harness, method: 'put' | 'post', url: string, body: unknown) =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const base = (moduleId: string, versionId: string) => `/api/foundation/modules/${moduleId}/versions/${versionId}`;
const put = (h: Harness, moduleId: string, versionId: string, manifest: unknown) => sendJson(h, 'put', `${base(moduleId, versionId)}/manifest`, { manifest });
const submit = (h: Harness, moduleId: string, versionId: string, body: unknown = {}) => sendJson(h, 'post', `${base(moduleId, versionId)}/submit`, body);
const dataStatements = (h: Harness) => h.db.statements.filter((s) => DATA.has(s.sql)).length;
const snapshot = (h: Harness) => ({
  functions: h.db.state.functions.length, actions: h.db.state.actions.length, versionFunctions: h.db.state.versionFunctions.length,
  versionActions: h.db.state.versionActions.length, dataContracts: h.db.state.dataContracts.length, dataFields: h.db.state.dataFields.length,
  accessRules: h.db.state.accessRules.length, compatChecks: h.db.state.compatChecks.length, compatChanges: h.db.state.compatChanges.length,
  events: h.db.state.events.length, versionAudits: h.db.state.versionAudits.length,
});
const row = (h: Harness, versionId: string) => h.db.state.versions.find((x) => x.version_id === versionId);

function withResources(resources: readonly unknown[]) {
  return { ...validMic(), mic06DataResources: resources };
}
function resource(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { resourceKey: 'RES', interfaceKind: 'API', columns: [], relations: [], access: [], ...over };
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([k, x]) => [k, reverseKeys(x)]));
}
function errorsOf(manifest: unknown): readonly string[] {
  const r = validateMic(manifest, ctx());
  return r.ok ? [] : r.errors;
}
function parsed(manifest: unknown = validMic()): Mic {
  const r = validateMic(manifest, ctx());
  if (!r.ok) throw new Error(`fixture invalid: ${r.errors.join(',')}`);
  return r.mic;
}

describe('FBE-04 MIC-06 schema (Q3) and DATA_* cross-validation (Q5, Q6)', () => {
  it('D1 the extended fixture is valid; the old MIC-06 shape (columns as strings, no resourceKey / access) is MIC_SCHEMA_INVALID', () => {
    expect(validateMic(validMic(), ctx()).ok).toBe(true);
    const old = { interfaceKind: 'DIRECT_DB', schema: 'sales', table: 'orders', columns: ['order_id'], relations: [] };
    expect(errorsOf(withResources([old]))).toEqual(['MIC_SCHEMA_INVALID']);
    expect(errorsOf(withResources([resource({ resourceKey: undefined })]))).toEqual(['MIC_SCHEMA_INVALID']);
    expect(errorsOf(withResources([resource({ access: undefined })]))).toEqual(['MIC_SCHEMA_INVALID']);
    expect(errorsOf(withResources([resource({ extra: 1 })]))).toEqual(['MIC_SCHEMA_INVALID']);
  });

  it('D2 field formats and widths: resourceKey K01 ≤ 120, ownerKey K01 ≤ 80, schema / table ≤ 100, column name / type ≤ 100, references ≤ 250, workflowKey ≤ 120', () => {
    const ok = (over: Record<string, unknown>) => errorsOf(withResources([resource(over)]));
    expect(ok({ resourceKey: 'R'.repeat(120) })).toEqual([]);
    expect(ok({ resourceKey: 'R'.repeat(121) })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ resourceKey: 'orders' })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ ownerKey: 'O'.repeat(80) })).toEqual([]);
    expect(ok({ ownerKey: 'O'.repeat(81) })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ ownerKey: 'crm' })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ schema: 's'.repeat(100), table: 't'.repeat(100) })).toEqual([]);
    expect(ok({ schema: 's'.repeat(101) })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ table: 't'.repeat(101) })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ columns: [{ name: 'n'.repeat(100), type: 't'.repeat(100), references: `a.b.${'c'.repeat(246)}` }] })).toEqual([]);
    expect(ok({ columns: [{ name: 'n'.repeat(101), type: 'uuid' }] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ columns: [{ name: 'id', type: 't'.repeat(101) }] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ columns: [{ name: 'id', type: 'uuid', references: `a.b.${'c'.repeat(247)}` }] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ columns: [{ name: 'id' }] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ columns: [{ name: 'id', type: 'uuid', required: 'yes' }] })).toEqual(['MIC_SCHEMA_INVALID']);
    const rule = (over: Record<string, unknown>) => ({ functionKey: 'ORDER', actionKey: 'READ', operation: 'SELECT', ...over });
    expect(ok({ access: [rule({ workflowKey: 'W'.repeat(120) })] })).toEqual([]);
    expect(ok({ access: [rule({ workflowKey: 'W'.repeat(121) })] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ access: [rule({ operation: 'MERGE' })] })).toEqual(['MIC_SCHEMA_INVALID']);
    expect(ok({ access: [rule({ approvalMode: 'UNSPECIFIED' })] })).toEqual(['MIC_SCHEMA_INVALID']); // absent = UNSPECIFIED
  });

  it('D3 DATA_RESOURCE_KEY_DUPLICATE / DATA_FIELD_DUPLICATE', () => {
    expect(errorsOf(withResources([resource(), resource()]))).toEqual(['DATA_RESOURCE_KEY_DUPLICATE']);
    expect(errorsOf(withResources([resource(), resource({ resourceKey: 'RES2' })]))).toEqual([]);
    const dup = [{ name: 'id', type: 'uuid' }, { name: 'id', type: 'text' }];
    expect(errorsOf(withResources([resource({ columns: dup })]))).toEqual(['DATA_FIELD_DUPLICATE']);
    // The same field name in two resources is fine (UNIQUE is per contract).
    expect(errorsOf(withResources([resource({ columns: [dup[0]] }), resource({ resourceKey: 'RES2', columns: [dup[1]] })]))).toEqual([]);
  });

  it('D4 DATA_DIRECT_DB_TARGET_MISSING (N-11: non-blank schema AND table for DIRECT_DB only)', () => {
    const direct = (over: Record<string, unknown>) => errorsOf(withResources([resource({ interfaceKind: 'DIRECT_DB', schema: 'sales', table: 'orders', ...over })]));
    expect(direct({})).toEqual([]);
    for (const over of [{ schema: undefined }, { table: undefined }, { schema: '   ' }, { table: ' \t' }]) {
      expect(direct(over), JSON.stringify(over)).toEqual(['DATA_DIRECT_DB_TARGET_MISSING']);
    }
    for (const kind of ['API', 'VIEW', 'EVENT']) expect(errorsOf(withResources([resource({ interfaceKind: kind })]))).toEqual([]);
  });

  it('D5 DATA_REFERENCE_INVALID (Q5: schema.table.column, lowercase identifiers)', () => {
    const ref = (references: string) => errorsOf(withResources([resource({ columns: [{ name: 'id', type: 'uuid', references }] })]));
    for (const good of ['crm.customers.customer_id', '_a._b._c', 'a1.b2.c3']) expect(ref(good), good).toEqual([]);
    for (const bad of ['crm.customers', 'crm.customers.customer_id.x', 'CRM.customers.id', '1a.b.c', 'crm.cust-omers.id', 'crm..id', 'crmXcustomersXid', '"crm".a.b']) {
      expect(ref(bad), bad).toEqual(['DATA_REFERENCE_INVALID']);
    }
  });

  it('D6 DATA_ACCESS_ACTION_UNKNOWN / DATA_ACCESS_DUPLICATE (per resource: action + operation)', () => {
    const access = (rules: unknown[]) => errorsOf(withResources([resource({ access: rules })]));
    expect(access([{ functionKey: 'ORDER', actionKey: 'DELETE', operation: 'DELETE' }])).toEqual(['DATA_ACCESS_ACTION_UNKNOWN']);
    expect(access([{ functionKey: 'GHOST', actionKey: 'READ', operation: 'SELECT' }])).toEqual(['DATA_ACCESS_ACTION_UNKNOWN']);
    expect(access([{ functionKey: 'REPORT', actionKey: 'CREATE', operation: 'INSERT' }])).toEqual(['DATA_ACCESS_ACTION_UNKNOWN']); // pair, not keys apart
    const read = { functionKey: 'ORDER', actionKey: 'READ', operation: 'SELECT' };
    expect(access([read, { ...read, approvalMode: 'NOT_REQUIRED' }])).toEqual(['DATA_ACCESS_DUPLICATE']);
    expect(access([read, { ...read, operation: 'UPDATE' }, { ...read, actionKey: 'CREATE' }])).toEqual([]);
    expect(errorsOf(withResources([resource({ access: [read] }), resource({ resourceKey: 'RES2', access: [read] })]))).toEqual([]);
  });

  it('D7 DATA_WORKFLOW_REQUIRED (D-09: REQUIRED needs a non-blank workflowKey); NOT_REQUIRED / absent need none', () => {
    const access = (over: Record<string, unknown>) => errorsOf(withResources([resource({ access: [{ functionKey: 'ORDER', actionKey: 'CREATE', operation: 'INSERT', ...over }] })]));
    expect(access({ approvalMode: 'REQUIRED' })).toEqual(['DATA_WORKFLOW_REQUIRED']);
    expect(access({ approvalMode: 'REQUIRED', workflowKey: '   ' })).toEqual(['DATA_WORKFLOW_REQUIRED']);
    expect(access({ approvalMode: 'REQUIRED', workflowKey: 'WF' })).toEqual([]);
    expect(access({ approvalMode: 'NOT_REQUIRED' })).toEqual([]);
    expect(access({})).toEqual([]);
    expect(access({ workflowKey: 'WF' })).toEqual([]);
  });

  it('D8 all seven codes together, in the approved order, after the earlier codes', () => {
    const bad = withResources([
      resource({ interfaceKind: 'DIRECT_DB', columns: [{ name: 'a', type: 't', references: 'x' }, { name: 'a', type: 't' }],
        access: [{ functionKey: 'X', actionKey: 'Y', operation: 'SELECT' }, { functionKey: 'X', actionKey: 'Y', operation: 'SELECT', approvalMode: 'REQUIRED' }] }),
      resource(),
    ]);
    expect(errorsOf({ ...bad, mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }] })).toEqual([
      'NAVIGATION_FUNCTION_UNKNOWN', 'DATA_RESOURCE_KEY_DUPLICATE', 'DATA_FIELD_DUPLICATE', 'DATA_DIRECT_DB_TARGET_MISSING', 'DATA_REFERENCE_INVALID',
      'DATA_ACCESS_ACTION_UNKNOWN', 'DATA_ACCESS_DUPLICATE', 'DATA_WORKFLOW_REQUIRED',
    ]);
  });
});

describe('FBE-04 dataPlan (Q3, Q4, Q7)', () => {
  it('D9 B10 mapping: resource_key, data_owner_key = ownerKey else moduleKey, schema_version = moduleVersion, contract_spec = element, contract_hash = RFC 8785 SHA-256', () => {
    const mic = parsed();
    const [feed, orders] = dataPlan(mic);
    const [feedSpec, ordersSpec] = mic.mic06DataResources;
    expect(feed).toMatchObject({
      resourceKey: 'ORDER_FEED', dataOwnerKey: 'SALES', interfaceKind: 'API', schemaName: null, tableName: null, schemaVersion: '1.0.0', contractSpec: feedSpec,
      contractHash: canonicalDigest(feedSpec).sha256, fields: [],
    });
    expect(orders).toMatchObject({
      resourceKey: 'ORDERS', dataOwnerKey: 'SALES_DATA', interfaceKind: 'DIRECT_DB', schemaName: 'sales', tableName: 'orders', schemaVersion: '1.0.0',
      contractSpec: ordersSpec, contractHash: canonicalDigest(ordersSpec).sha256,
    });
    // Key order of the element is irrelevant to the hash (RFC 8785).
    expect(canonicalDigest(reverseKeys(ordersSpec)).sha256).toBe(orders?.contractHash);
    expect(JSON.stringify(reverseKeys(ordersSpec))).not.toBe(JSON.stringify(ordersSpec));
  });

  it('D10 B11 fields (default_expression never planned) and B12 rules (approval_mode absent → UNSPECIFIED; is_enabled never planned)', () => {
    const [feed, orders] = dataPlan(parsed());
    expect(orders?.fields).toEqual([
      { fieldName: 'order_id', fieldType: 'uuid', isRequired: true, isPrimaryKey: true, referencesTarget: null, description: null },
      { fieldName: 'customer_id', fieldType: 'uuid', isRequired: false, isPrimaryKey: false, referencesTarget: 'crm.customers.customer_id', description: 'Khách hàng' },
    ]);
    expect(feed?.access).toEqual([{ functionKey: 'REPORT', actionKey: 'READ', dataOperation: 'SELECT', approvalMode: 'UNSPECIFIED', workflowKey: null }]);
    expect(orders?.access).toEqual([
      { functionKey: 'ORDER', actionKey: 'READ', dataOperation: 'SELECT', approvalMode: 'NOT_REQUIRED', workflowKey: null },
      { functionKey: 'ORDER', actionKey: 'CREATE', dataOperation: 'INSERT', approvalMode: 'REQUIRED', workflowKey: 'SALES_ORDER_APPROVAL' },
    ]);
    expect(DATA_SQL.insertField).not.toMatch(/default_expression/);
    expect(DATA_SQL.insertAccessRule).not.toMatch(/is_enabled/);
  });
});

describe('FBE-04 SUBMIT materialisation of B10–B12 (Q1)', () => {
  it('D11 valid SUBMIT → B10 / B11 / B12 rows exactly as planned, B12 bound to the B06 rows of this version; IN_REVIEW', async () => {
    const { h, m, v } = setup();
    const mic = validMic();
    await put(h, m.module_id, v.version_id, mic);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    expect(row(h, v.version_id)?.status).toBe('IN_REVIEW');
    const contracts = h.db.state.dataContracts;
    expect(contracts.map((c) => [c.version_id, c.resource_key, c.data_owner_key, c.interface_kind, c.schema_name, c.table_name, c.schema_version, c.contract_hash])).toEqual([
      [v.version_id, 'ORDER_FEED', 'SALES', 'API', null, null, '1.0.0', canonicalDigest(mic.mic06DataResources[0]).sha256],
      [v.version_id, 'ORDERS', 'SALES_DATA', 'DIRECT_DB', 'sales', 'orders', '1.0.0', canonicalDigest(mic.mic06DataResources[1]).sha256],
    ]);
    expect(contracts.map((c) => c.contract_spec)).toEqual(mic.mic06DataResources); // JSONB round trip
    const ordersId = contracts[1]?.data_contract_id;
    expect(h.db.state.dataFields.map((f) => [f.data_contract_id, f.field_name, f.field_type, f.is_required, f.is_primary_key, f.references_target, f.description, f.default_expression])).toEqual([
      [ordersId, 'order_id', 'uuid', true, true, null, null, null],
      [ordersId, 'customer_id', 'uuid', false, false, 'crm.customers.customer_id', 'Khách hàng', null],
    ]);
    const va = (fk: string, ak: string) => {
      const f = h.db.state.functions.find((x) => x.module_id === m.module_id && x.function_key === fk);
      const a = h.db.state.actions.find((x) => x.function_id === f?.function_id && x.action_key === ak);
      const vf = h.db.state.versionFunctions.find((x) => x.version_id === v.version_id && x.function_id === f?.function_id);
      return h.db.state.versionActions.find((x) => x.version_function_id === vf?.version_function_id && x.action_id === a?.action_id)?.version_action_id;
    };
    expect(h.db.state.accessRules.map((r) => [r.data_contract_id, r.version_action_id, r.data_operation, r.approval_mode, r.workflow_key, r.is_enabled])).toEqual([
      [contracts[0]?.data_contract_id, va('REPORT', 'READ'), 'SELECT', 'UNSPECIFIED', null, false],
      [ordersId, va('ORDER', 'READ'), 'SELECT', 'NOT_REQUIRED', null, false],
      [ordersId, va('ORDER', 'CREATE'), 'INSERT', 'REQUIRED', 'SALES_ORDER_APPROVAL', false],
    ]);
    expect(h.db.statements.filter((s) => DATA.has(s.sql)).every((s) => s.inTransaction)).toBe(true);
    expect(h.db.statements.filter((s) => s.sql === DATA_SQL.versionActions).map((s) => s.params)).toEqual([[v.version_id]]);
  });

  it('D12 same Version: a second version of the module (same keys) binds B12 only to its own B06 rows', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    const v2 = seedVersion(h.db, m.module_id, '1.1.0');
    await put(h, m.module_id, v2.version_id, validMic('SALES', '1.1.0'));
    expect((await submit(h, m.module_id, v2.version_id)).status).toBe(200); // v1 is IN_REVIEW: INITIAL is still the right kind
    const ownActions = (versionId: string) => {
      const vfs = new Set(h.db.state.versionFunctions.filter((x) => x.version_id === versionId).map((x) => x.version_function_id));
      return new Set(h.db.state.versionActions.filter((x) => vfs.has(x.version_function_id)).map((x) => x.version_action_id));
    };
    for (const version of [v.version_id, v2.version_id]) {
      const contracts = new Set(h.db.state.dataContracts.filter((c) => c.version_id === version).map((c) => c.data_contract_id));
      const rules = h.db.state.accessRules.filter((r) => contracts.has(r.data_contract_id));
      expect(rules).toHaveLength(3);
      const own = ownActions(version);
      expect(rules.every((r) => own.has(r.version_action_id))).toBe(true);
    }
    expect(h.db.state.functions).toHaveLength(2); // B03 / B04 identities are shared, B10–B12 are per version
    expect(h.db.state.dataContracts).toHaveLength(4);
  });

  it('D13 a B12 action that is not among the B06 rows of this version fails closed: 503, full rollback', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    const before = snapshot(h);
    // The lookup sees no row (impossible after B06 was written in the same transaction; proves the guard).
    h.db.before.set(DATA_SQL.versionActions, (state) => {
      state.versionFunctions = state.versionFunctions.filter((x) => x.version_id !== v.version_id);
    });
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(503);
    expect(snapshot(h)).toEqual(before);
    expect(row(h, v.version_id)?.status).toBe('DRAFT');
    expect(h.logs.some((l) => l.includes('submit version failed (rolled back)'))).toBe(true);
  });

  it('D14 a failure of any DATA_SQL / COMPAT_SQL statement → 503 and full rollback (B02 DRAFT, no B03–B14 / B07 / B08)', async () => {
    const statements: string[] = [...Object.values(DATA_SQL), ...Object.values(COMPAT_SQL).filter((s) => s !== COMPAT_SQL.fromVersion)];
    for (const sql of statements) {
      const { h, m, v } = setup();
      await put(h, m.module_id, v.version_id, validMic());
      const before = snapshot(h);
      h.db.failOn.set(sql, pgError('42501'));
      const res = await submit(h, m.module_id, v.version_id);
      expect(res.status, sql.trim().slice(0, 50)).toBe(503);
      expect(snapshot(h), sql.trim().slice(0, 50)).toEqual(before);
      expect(row(h, v.version_id)).toMatchObject({ status: 'DRAFT', manifest_hash: null, submitted_by_account_id: null });
      expect(h.db.txLog.at(-1)).toBe('ROLLBACK');
    }
  });

  it('D15 real constraint failures from the DB layer (23505 / 23514 / 22001) also roll everything back', async () => {
    for (const code of ['23505', '23514', '22001', '23503']) {
      const { h, m, v } = setup();
      await put(h, m.module_id, v.version_id, validMic());
      const before = snapshot(h);
      h.db.failOn.set(DATA_SQL.insertField, pgError(code));
      expect((await submit(h, m.module_id, v.version_id)).status).toBe(503);
      expect(snapshot(h)).toEqual(before);
    }
  });

  it('D16 MIC_INVALID (incl. a DATA_* code), hash mismatch or a non-DRAFT version → no B10–B14 statement', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, withResources([resource(), resource()]));
    let count = dataStatements(h);
    const invalid = await submit(h, m.module_id, v.version_id);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toMatchObject({ code: 'MIC_INVALID', details: { errors: ['DATA_RESOURCE_KEY_DUPLICATE'] } });
    expect(dataStatements(h)).toBe(count);
    await put(h, m.module_id, v.version_id, validMic());
    count = dataStatements(h);
    expect((await submit(h, m.module_id, v.version_id, { expectedManifestHash: 'f'.repeat(64) })).status).toBe(409);
    expect(dataStatements(h)).toBe(count);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    count = dataStatements(h);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(409);
    expect(dataStatements(h)).toBe(count);
  });

  it('D17 no data resources → no B10–B12 statement; a resource without access rules → no B06 lookup', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, withResources([]));
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    expect(h.db.statements.filter((s) => Object.values(DATA_SQL).some((x) => x === s.sql))).toHaveLength(0);
    expect(snapshot(h)).toMatchObject({ dataContracts: 0, dataFields: 0, accessRules: 0, compatChecks: 1 });
    const second = setup();
    await put(second.h, second.m.module_id, second.v.version_id, withResources([resource()]));
    expect((await submit(second.h, second.m.module_id, second.v.version_id)).status).toBe(200);
    expect(second.h.db.statements.some((s) => s.sql === DATA_SQL.versionActions)).toBe(false); // no access rule to resolve
    expect(snapshot(second.h)).toMatchObject({ dataContracts: 1, dataFields: 0, accessRules: 0 });
  });

  it('D18 write order: B03–B06 → B10 → B11 → B06 lookup → B12 → B13 → B14 → B02 IN_REVIEW → B07 → B08', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    const from = h.db.statements.length;
    await submit(h, m.module_id, v.version_id);
    const tx = h.db.statements.slice(from).filter((s) => s.inTransaction).map((s) => s.sql);
    const last = (sql: string) => tx.lastIndexOf(sql);
    const first = (sql: string) => tx.indexOf(sql);
    expect(last(REGISTRY_SQL.insertVersionAction)).toBeLessThan(first(DATA_SQL.insertContract));
    expect(last(DATA_SQL.insertField)).toBeLessThan(first(DATA_SQL.versionActions));
    expect(last(DATA_SQL.insertAccessRule)).toBeLessThan(first(COMPAT_SQL.insertCheck));
    expect(last(COMPAT_SQL.insertChange)).toBeLessThan(first(MANIFEST_SQL.submitVersion));
    expect(first(MANIFEST_SQL.submitVersion)).toBeLessThan(first(MANIFEST_SQL.insertSubmitEvent));
    expect(first(MANIFEST_SQL.insertSubmitEvent)).toBeLessThan(first(VERSION_SQL.insertVersionAudit));
  });

  it('D19 CREATE version and PUT manifest never run B10–B14 statements', async () => {
    const { h, m } = setup();
    const created = await sendJson(h, 'post', `/api/foundation/modules/${m.module_id}/versions`, { moduleVersion: '3.0.0', contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    expect((await put(h, m.module_id, created.body.version.versionId, validMic('SALES', '3.0.0'))).status).toBe(200);
    expect(dataStatements(h)).toBe(0);
  });

  it('D20 B07 / B08 contract unchanged: same event and audit metadata as FBE-03', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    const res = await submit(h, m.module_id, v.version_id);
    const hash = canonicalDigest(validMic()).sha256;
    const event = h.db.state.events.at(-1);
    expect(event?.slice(0, 4)).toEqual(['SUBMIT', m.module_id, v.version_id, ACCOUNT_A]);
    expect(JSON.parse(String(event?.[5]))).toEqual({ status: 'IN_REVIEW', manifest_hash: hash });
    const audit = h.db.state.versionAudits.at(-1);
    expect(JSON.parse(String(audit?.[10]))).toEqual({ v: 1, reason: 'SUBMITTED', requestId: res.headers['x-request-id'], manifestHash: hash });
  });
});
