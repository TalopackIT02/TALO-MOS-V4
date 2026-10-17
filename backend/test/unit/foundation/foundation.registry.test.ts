import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { MANIFEST_SQL } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { validateMic } from '../../../src/modules/foundation/foundation.mic.js';
import type { MicContext } from '../../../src/modules/foundation/foundation.mic.js';
import { registryPlan } from '../../../src/modules/foundation/foundation.registry.js';
import { REGISTRY_SQL } from '../../../src/modules/foundation/foundation.registry.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import {
  ACCOUNT_A, PERM_VCREATE_ID, PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, pgError, seedModule,
  seedVersion, token,
} from './fakes.js';
import type { Harness } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-03 — Function / Action registry materialised in the SUBMIT transaction (R1–R11). Mock/unit only: FakeDb models
// B03–B06 with UNIQUE, FKs, ON CONFLICT DO NOTHING and CHECK N-04 / N-05 / D-02 / D-03. No PostgreSQL.

const TOKEN = token('registrySessionToken');
const REGISTRY = new Set<string>(Object.values(REGISTRY_SQL));
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
const registryStatements = (h: Harness) => h.db.statements.filter((s) => REGISTRY.has(s.sql)).length;
// Snapshot of everything a SUBMIT may write, to compare before / after ONE request (not with rows of earlier calls).
const snapshot = (h: Harness) => ({
  functions: h.db.state.functions.length, actions: h.db.state.actions.length, versionFunctions: h.db.state.versionFunctions.length,
  versionActions: h.db.state.versionActions.length, events: h.db.state.events.length, versionAudits: h.db.state.versionAudits.length,
});
const row = (h: Harness, versionId: string) => h.db.state.versions.find((x) => x.version_id === versionId);

// A valid MIC whose module has one more Function / Action (keeps P-16 / P-17: mapping, API and navigation consistent).
function micWithExtra(moduleKey: string, moduleVersion: string) {
  const mic = validMic(moduleKey, moduleVersion);
  return {
    ...mic,
    mic02Functions: [...mic.mic02Functions, { functionKey: 'APPROVAL', name: 'Phê duyệt' }],
    mic03Actions: [...mic.mic03Actions, { functionKey: 'APPROVAL', actionKey: 'APPROVE', name: 'Duyệt đơn', nature: 'WRITE' }],
    mic07IamMapping: [...mic.mic07IamMapping, { functionKey: 'APPROVAL', actionKey: 'APPROVE', moduleCode: moduleKey, resourceCode: 'APPROVAL', operation: 'APPROVE', minimumAssuranceLevel: 1 }],
  };
}

describe('FBE-03 registry plan (R1) and P-16 name limit (R2)', () => {
  it('R1 registryPlan: approved mapping, RFC 8785 hashes of the mic02 / mic03 elements, MIC order kept, key order irrelevant', () => {
    const parsed = validateMic(validMic(), ctx());
    if (!parsed.ok) throw new Error('fixture must be valid');
    const plan = registryPlan(parsed.mic);
    const mic = validMic();
    expect(plan.map((f) => f.functionKey)).toEqual(['ORDER', 'REPORT']);
    expect(plan[0]).toMatchObject({ displayName: 'Đơn hàng', definitionHash: canonicalDigest(mic.mic02Functions[0]).sha256 });
    expect(plan[1]?.definitionHash).toBe(canonicalDigest(mic.mic02Functions[1]).sha256);
    expect(plan[0]?.actions.map((a) => a.actionKey)).toEqual(['READ', 'CREATE']); // MIC order
    expect(plan[0]?.actions[1]).toEqual({
      actionKey: 'CREATE', description: 'Tạo đơn hàng', actionSpec: mic.mic03Actions[1], definitionHash: canonicalDigest(mic.mic03Actions[1]).sha256,
    });
    expect(plan[1]?.actions.map((a) => [a.actionKey, a.description])).toEqual([['READ', 'Xem báo cáo']]);
    // Same element, other key order → same hash.
    const fn = { description: 'Quản lý đơn hàng bán', name: 'Đơn hàng', functionKey: 'ORDER' };
    expect(canonicalDigest(fn).sha256).toBe(plan[0]?.definitionHash);
    for (const f of plan) {
      expect(f.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      for (const a of f.actions) expect(a.definitionHash).toBe(canonicalDigest(a.actionSpec).sha256);
    }
  });

  it('R2 mic02 name: 150 characters valid, 151 → MIC_SCHEMA_INVALID; over HTTP 422 + B08 FAILURE, no B03–B06, DRAFT kept', async () => {
    const mic = validMic();
    const named = (n: number) => ({ ...mic, mic02Functions: [{ ...mic.mic02Functions[0], name: 'x'.repeat(n) }, ...mic.mic02Functions.slice(1)] });
    expect(validateMic(named(150), ctx()).ok).toBe(true);
    const r = validateMic(named(151), ctx());
    expect(r.ok ? [] : r.errors).toEqual(['MIC_SCHEMA_INVALID']);
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, named(151));
    const before = snapshot(h);
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(422);
    expect(res.body.error.details.errors).toEqual(['MIC_SCHEMA_INVALID']);
    expect(row(h, v.version_id)?.status).toBe('DRAFT');
    const after = snapshot(h);
    expect(after).toEqual({ ...before, versionAudits: before.versionAudits + 1 }); // only the FAILURE audit
    expect(JSON.parse(String(h.db.state.versionAudits.at(-1)?.[10])).reason).toBe('MIC_INVALID');
  });
});

describe('FBE-03 SUBMIT materialisation (R3–R11)', () => {
  it('R3 valid SUBMIT writes B03 / B04 / B05 / B06 with the approved values; B07 / B08 unchanged', async () => {
    const { h, m, v } = setup();
    const mic = validMic();
    await put(h, m.module_id, v.version_id, mic);
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(200);
    const { functions, actions, versionFunctions, versionActions } = h.db.state;
    expect(functions.map((f) => [f.module_id, f.function_key, f.retired_at, f.replaces_function_id])).toEqual([
      [m.module_id, 'ORDER', null, null], [m.module_id, 'REPORT', null, null],
    ]);
    const fid = (key: string) => functions.find((f) => f.function_key === key)?.function_id;
    expect(actions.map((a) => [a.function_id, a.action_key, a.retired_at])).toEqual([
      [fid('ORDER'), 'CREATE', null], [fid('ORDER'), 'READ', null], [fid('REPORT'), 'READ', null], // key order
    ]);
    expect(versionFunctions.map((x) => [x.version_id, x.function_id, x.display_name, x.route_key, x.is_deprecated, x.definition_hash])).toEqual([
      [v.version_id, fid('ORDER'), 'Đơn hàng', null, false, canonicalDigest(mic.mic02Functions[0]).sha256],
      [v.version_id, fid('REPORT'), 'Báo cáo', null, false, canonicalDigest(mic.mic02Functions[1]).sha256],
    ]);
    const aid = (fk: string, ak: string) => actions.find((a) => a.function_id === fid(fk) && a.action_key === ak)?.action_id;
    const vfid = (fk: string) => versionFunctions.find((x) => x.function_id === fid(fk))?.version_function_id;
    expect(versionActions.map((x) => [x.version_function_id, x.action_id, x.description, x.action_spec, x.definition_hash, x.is_deprecated])).toEqual([
      [vfid('ORDER'), aid('ORDER', 'READ'), 'Xem đơn hàng', mic.mic03Actions[0], canonicalDigest(mic.mic03Actions[0]).sha256, false],
      [vfid('ORDER'), aid('ORDER', 'CREATE'), 'Tạo đơn hàng', mic.mic03Actions[1], canonicalDigest(mic.mic03Actions[1]).sha256, false],
      [vfid('REPORT'), aid('REPORT', 'READ'), 'Xem báo cáo', mic.mic03Actions[2], canonicalDigest(mic.mic03Actions[2]).sha256, false],
    ]);
    // B07 / B08 contract unchanged.
    const hash = canonicalDigest(mic).sha256;
    const [event] = h.db.state.events;
    expect(JSON.parse(String(event?.[5]))).toEqual({ status: 'IN_REVIEW', manifest_hash: hash });
    expect(JSON.parse(String(h.db.state.versionAudits.at(-1)?.[10]))).toEqual({ v: 1, reason: 'SUBMITTED', requestId: res.headers['x-request-id'], manifestHash: hash });
    // Materialisation happens before the status change, inside the transaction.
    const tx = h.db.statements.filter((s) => s.inTransaction).map((s) => s.sql);
    expect(tx.indexOf(REGISTRY_SQL.insertVersionAction)).toBeLessThan(tx.indexOf(MANIFEST_SQL.submitVersion));
    expect(h.db.statements.filter((s) => REGISTRY.has(s.sql)).every((s) => s.inTransaction)).toBe(true);
    // Functions of the version's own module only; actions only under their function.
    expect(h.db.statements.filter((s) => s.sql === REGISTRY_SQL.insertFunction || s.sql === REGISTRY_SQL.selectFunction).every((s) => s.params[0] === m.module_id)).toBe(true);
  });

  it('R4 identities are stable across versions of a module (reused, only new keys inserted); another module gets its own identities', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    const firstIds = h.db.state.functions.map((f) => [f.function_key, f.function_id]);
    const firstActions = h.db.state.actions.map((a) => a.action_id);
    const v2 = seedVersion(h.db, m.module_id, '2.0.0');
    await put(h, m.module_id, v2.version_id, micWithExtra('SALES', '2.0.0'));
    expect((await submit(h, m.module_id, v2.version_id)).status).toBe(200);
    expect(h.db.state.functions.filter((f) => f.module_id === m.module_id).map((f) => f.function_key).sort()).toEqual(['APPROVAL', 'ORDER', 'REPORT']);
    for (const [key, id] of firstIds) expect(h.db.state.functions.find((f) => f.function_key === key)?.function_id).toBe(id);
    expect(h.db.state.actions).toHaveLength(4);
    for (const id of firstActions) expect(h.db.state.actions.some((a) => a.action_id === id)).toBe(true);
    const v2Functions = h.db.state.versionFunctions.filter((x) => x.version_id === v2.version_id);
    expect(v2Functions).toHaveLength(3);
    expect(v2Functions.find((x) => x.function_id === firstIds[0]?.[1])).toBeDefined(); // same function_id, new B05 row
    expect(h.db.state.versionActions).toHaveLength(3 + 4);
    // Another module with the same keys → separate B03 / B04 rows.
    const other = seedModule(h.db, 'STOCK');
    const ov = seedVersion(h.db, other.module_id, '1.0.0');
    await put(h, other.module_id, ov.version_id, validMic('STOCK', '1.0.0'));
    expect((await submit(h, other.module_id, ov.version_id)).status).toBe(200);
    const stockOrder = h.db.state.functions.find((f) => f.module_id === other.module_id && f.function_key === 'ORDER');
    expect(stockOrder?.function_id).not.toBe(firstIds.find(([k]) => k === 'ORDER')?.[1]);
    expect(h.db.state.versionFunctions.filter((x) => x.version_id === ov.version_id).every((x) => h.db.state.functions.find((f) => f.function_id === x.function_id)?.module_id === other.module_id)).toBe(true);
  });

  it('R5 ON CONFLICT DO NOTHING: a row created by a concurrent SUBMIT is found and reused, never duplicated', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    const concurrentId = randomUUID();
    // Simulates the committed row of another transaction appearing just before our INSERT of ORDER.
    h.db.before.set(REGISTRY_SQL.insertFunction, (state) => {
      if (!state.functions.some((f) => f.module_id === m.module_id && f.function_key === 'ORDER')) {
        state.functions.push({ function_id: concurrentId, module_id: m.module_id, function_key: 'ORDER', created_at: 'x', retired_at: null, replaces_function_id: null });
      }
    });
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    expect(h.db.state.functions.filter((f) => f.function_key === 'ORDER')).toHaveLength(1);
    expect(h.db.state.versionFunctions.find((x) => x.display_name === 'Đơn hàng')?.function_id).toBe(concurrentId);
    expect(h.db.state.actions.filter((a) => a.function_id === concurrentId).map((a) => a.action_key)).toEqual(['CREATE', 'READ']);
  });

  it('R5b B03 / B04 are written in key order (deadlock avoidance) while B05 / B06 keep the MIC order; hashes unchanged', async () => {
    const { h, m, v } = setup();
    const mic = validMic();
    // MIC lists REPORT before ORDER, and ORDER's actions as READ, CREATE.
    const reversed = { ...mic, mic02Functions: [mic.mic02Functions[1], mic.mic02Functions[0]] };
    await put(h, m.module_id, v.version_id, reversed);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    const params = (sql: string) => h.db.statements.filter((s) => s.sql === sql).map((s) => s.params[1]);
    expect(params(REGISTRY_SQL.insertFunction)).toEqual(['ORDER', 'REPORT']);
    expect(params(REGISTRY_SQL.insertAction)).toEqual(['CREATE', 'READ', 'READ']);
    expect(h.db.state.versionFunctions.map((x) => x.display_name)).toEqual(['Báo cáo', 'Đơn hàng']); // MIC order
    expect(h.db.state.versionFunctions.map((x) => x.definition_hash)).toEqual([canonicalDigest(mic.mic02Functions[1]).sha256, canonicalDigest(mic.mic02Functions[0]).sha256]);
  });

  it('R6 a failure of any registry statement → 503 and full rollback of this transaction (B02 DRAFT, no B03–B06 / B07 / B08)', async () => {
    for (const sql of Object.values(REGISTRY_SQL)) {
      const { h, m, v } = setup();
      await put(h, m.module_id, v.version_id, validMic());
      const before = snapshot(h);
      h.db.failOn.set(sql, pgError('42501'));
      const res = await submit(h, m.module_id, v.version_id);
      expect(res.status, sql.trim().slice(0, 40)).toBe(503);
      expect(snapshot(h), sql.trim().slice(0, 40)).toEqual(before);
      expect(row(h, v.version_id)).toMatchObject({ status: 'DRAFT', manifest_hash: null, submitted_by_account_id: null });
      expect(h.db.txLog.at(-1)).toBe('ROLLBACK');
    }
  });

  it('R7 B07 or B08 failure after materialisation also rolls back B03–B06', async () => {
    for (const sql of [MANIFEST_SQL.insertSubmitEvent, VERSION_SQL.insertVersionAudit]) {
      const { h, m, v } = setup();
      await put(h, m.module_id, v.version_id, validMic());
      const before = snapshot(h);
      h.db.failOn.set(sql, pgError('23503'));
      const res = await submit(h, m.module_id, v.version_id);
      expect(res.status).toBe(503);
      expect(h.db.statements.some((s) => s.sql === REGISTRY_SQL.insertVersionAction)).toBe(true); // registry ran …
      expect(snapshot(h)).toEqual(before); // … and was rolled back
      expect(row(h, v.version_id)?.status).toBe('DRAFT');
    }
  });

  it('R8 MIC_INVALID, hash mismatch or a non-DRAFT version → no registry statement is executed', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, { ...validMic(), mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }] });
    let count = registryStatements(h);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(422);
    expect(registryStatements(h)).toBe(count);
    await put(h, m.module_id, v.version_id, validMic());
    count = registryStatements(h);
    expect((await submit(h, m.module_id, v.version_id, { expectedManifestHash: 'f'.repeat(64) })).status).toBe(409);
    expect(registryStatements(h)).toBe(count);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    count = registryStatements(h);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(409); // already IN_REVIEW
    expect(registryStatements(h)).toBe(count);
  });

  it('R9 a valid MIC without Functions / Actions (P-16 / P-17 unchanged) → 200, no B03–B06 rows, no registry statement', async () => {
    const { h, m, v } = setup();
    const empty = { ...validMic(), mic02Functions: [], mic03Actions: [], mic04Navigation: [{ menuLabel: 'Bán hàng' }], mic05Api: [], mic07IamMapping: [] };
    expect(validateMic(empty, ctx()).ok).toBe(true);
    await put(h, m.module_id, v.version_id, empty);
    const count = registryStatements(h);
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(200);
    expect(registryStatements(h)).toBe(count);
    expect(snapshot(h)).toMatchObject({ functions: 0, actions: 0, versionFunctions: 0, versionActions: 0 });
  });

  it('R10 CREATE version and PUT manifest never run registry statements', async () => {
    const { h, m } = setup();
    const created = await sendJson(h, 'post', `/api/foundation/modules/${m.module_id}/versions`, { moduleVersion: '3.0.0', contractVersion: 'MIC-1.0' });
    expect(created.status).toBe(201);
    expect((await put(h, m.module_id, created.body.version.versionId, validMic('SALES', '3.0.0'))).status).toBe(200);
    expect(registryStatements(h)).toBe(0);
  });

  it('R11 a resolved id count that differs from the plan fails closed: 503 and rollback', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, validMic());
    const before = snapshot(h);
    // Two B03 rows answer the lookup of ORDER (impossible under the real UNIQUE; proves the guard).
    h.db.before.set(REGISTRY_SQL.selectFunction, (state) => {
      const existing = state.functions.find((f) => f.module_id === m.module_id && f.function_key === 'ORDER');
      if (existing && state.functions.filter((f) => f.function_key === 'ORDER').length === 1) state.functions.push({ ...existing, function_id: randomUUID() });
    });
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(503);
    expect(snapshot(h)).toEqual(before);
    expect(row(h, v.version_id)?.status).toBe('DRAFT');
    expect(h.logs.some((l) => l.includes('submit version failed (rolled back)'))).toBe(true);
  });
});
