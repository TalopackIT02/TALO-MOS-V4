import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { LIFECYCLE_SQL } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import type { ActivationFacts } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import { ACTIVATION_BLOCKERS, activationBlockers, enableBlockers } from '../../../src/modules/foundation/foundation.lifecycle.service.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import type { VersionRecord } from '../../../src/modules/foundation/foundation.versions.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import {
  ACCOUNT_A, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_DISABLE_ID, PERM_ENABLE_ID, PERM_REJECT_ID, PERM_RETIRE_ID, PERM_VCREATE_ID, PERM_VREAD_ID,
  PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_DIRECT_DENY, VALID_ROLE, buildHarness, defaultIam, pgError, seedModule, seedVersion, token,
} from './fakes.js';
import type { GrantRow, Harness, ModuleRow, VersionRow } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-05 — Module & Version lifecycle (owner decisions L1–L8). Mock/unit only: the real service, repository and routes
// over FakeDb, which models B02 D-04 / D-05 / D-06, the Q01 one-ACTIVE index, B07 N-08 and transaction rollback.

const TOKEN = token('lifecycleSessionToken');
const LIFECYCLE_PERMS = [PERM_APPROVE_ID, PERM_REJECT_ID, PERM_ACTIVATE_ID, PERM_RETIRE_ID, PERM_ENABLE_ID, PERM_DISABLE_ID];
const ALL = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, ...LIFECYCLE_PERMS];
const VA = { moduleId: 1, versionId: 2, actor: 3, action: 4, targetType: 5, targetId: 6, outcome: 7, metadata: 10 } as const;
const MA = { moduleId: 1, actor: 2, action: 3, targetType: 4, targetId: 5, outcome: 6, metadata: 9 } as const;

function setup(grants: { permissionId: string; row: GrantRow }[] = ALL.map((permissionId) => ({ permissionId, row: VALID_ROLE }))) {
  const iam = defaultIam();
  iam.grants = grants.map((g) => ({ accountId: ACCOUNT_A, ...g }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  const m = seedModule(h.db, 'SALES');
  return { h, m };
}
const send = (h: Harness, url: string, body: unknown = {}, method: 'post' | 'put' = 'post') =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const vurl = (m: ModuleRow, versionId: string, action: string) => `/api/foundation/modules/${m.module_id}/versions/${versionId}/${action}`;
const murl = (m: ModuleRow, action: string) => `/api/foundation/modules/${m.module_id}/${action}`;
const row = (h: Harness, versionId: string) => h.db.state.versions.find((x) => x.version_id === versionId);
const mod = (h: Harness, moduleId: string) => h.db.state.modules.find((x) => x.module_id === moduleId);
const lifecycleEvents = (h: Harness) => h.db.state.events.filter((e) => e[0] === 'EVENT').map((e) => [e[2], e[3], JSON.parse(String(e[5])), JSON.parse(String(e[6]))]);

// A valid MIC without a DIRECT_DB resource (L3 refuses DIRECT_DB); CHANGE from `from` when given.
function cleanMic(moduleVersion: string, from?: string) {
  const mic = validMic('SALES', moduleVersion);
  return {
    ...mic,
    mic06DataResources: mic.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB'),
    mic09Compatibility: from === undefined ? mic.mic09Compatibility : { kind: 'CHANGE', fromVersion: from, changes: ['Thay đổi'] },
  };
}

async function inReview(h: Harness, m: ModuleRow, moduleVersion: string, mic: unknown = cleanMic(moduleVersion)): Promise<VersionRow> {
  const v = seedVersion(h.db, m.module_id, moduleVersion);
  expect((await send(h, `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest: mic }, 'put')).status).toBe(200);
  expect((await send(h, vurl(m, v.version_id, 'submit'))).status).toBe(200);
  return v;
}
async function approved(h: Harness, m: ModuleRow, moduleVersion: string, mic?: unknown): Promise<VersionRow> {
  const v = await inReview(h, m, moduleVersion, mic);
  expect((await send(h, vurl(m, v.version_id, 'approve'))).status).toBe(200);
  return v;
}
async function active(h: Harness, m: ModuleRow, moduleVersion: string, mic?: unknown): Promise<VersionRow> {
  const v = await approved(h, m, moduleVersion, mic);
  expect((await send(h, vurl(m, v.version_id, 'activate'))).status).toBe(200);
  return v;
}
const snapshot = (h: Harness) => JSON.stringify({ versions: h.db.state.versions, modules: h.db.state.modules, events: h.db.state.events, audits: h.db.state.audits, versionAudits: h.db.state.versionAudits });
const definitions = (h: Harness) => JSON.stringify([h.db.state.functions, h.db.state.actions, h.db.state.versionFunctions, h.db.state.versionActions, h.db.state.dataContracts,
  h.db.state.dataFields, h.db.state.accessRules, h.db.state.compatChecks, h.db.state.compatChanges]);

function versionRecord(over: Partial<VersionRecord> = {}): VersionRecord {
  const mic = cleanMic('1.0.0');
  return {
    versionId: 'v', moduleId: 'm', moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', status: 'APPROVED', manifestJson: mic, manifestHash: canonicalDigest(mic).sha256,
    submittedByAccountId: ACCOUNT_A, createdAt: 't', reviewedByAccountId: ACCOUNT_A, reviewedAt: 't', activatedAt: null, ...over,
  };
}
const facts = (over: Partial<ActivationFacts> = {}): ActivationFacts => ({
  version: versionRecord(), checks: [{ checkId: 'k', checkResult: 'PASS' }], blockingChanges: 0, directDbContracts: 0, ...over,
});

describe('FBE-05 activation gate (L3) and enable gate (L5) — pure', () => {
  it('G1 a clean APPROVED version passes; PASS and WARN are accepted', () => {
    expect(activationBlockers(facts())).toEqual([]);
    expect(activationBlockers(facts({ checks: [{ checkId: 'k', checkResult: 'WARN' }] }))).toEqual([]);
  });

  it('G2 B13: missing, ambiguous, BLOCK / FAILED / PENDING → refused', () => {
    expect(activationBlockers(facts({ checks: [] }))).toEqual(['COMPATIBILITY_CHECK_MISSING']);
    expect(activationBlockers(facts({ checks: [{ checkId: 'a', checkResult: 'PASS' }, { checkId: 'b', checkResult: 'PASS' }] }))).toEqual(['COMPATIBILITY_CHECK_AMBIGUOUS']);
    for (const r of ['BLOCK', 'FAILED', 'PENDING', 'pass']) expect(activationBlockers(facts({ checks: [{ checkId: 'k', checkResult: r }] })), r).toEqual(['COMPATIBILITY_RESULT_NOT_ACCEPTED']);
  });

  it('G3 B14 BLOCKING change → refused even with a PASS result', () => {
    expect(activationBlockers(facts({ blockingChanges: 1 }))).toEqual(['COMPATIBILITY_BLOCKING_CHANGE']);
  });

  it('G4 MIC-10 evidence FAIL / NOT_TESTED / empty → refused', () => {
    for (const result of ['FAIL', 'NOT_TESTED']) {
      const mic = { ...cleanMic('1.0.0'), mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'a', result: 'PASS', reference: 'r' }, { name: 'b', result, reference: 'r' }] } };
      expect(activationBlockers(facts({ version: versionRecord({ manifestJson: mic, manifestHash: canonicalDigest(mic).sha256 }) })), result).toEqual(['TEST_EVIDENCE_NOT_PASSED']);
    }
    const empty = { ...cleanMic('1.0.0'), mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [] } };
    expect(activationBlockers(facts({ version: versionRecord({ manifestJson: empty, manifestHash: canonicalDigest(empty).sha256 }) }))).toEqual(['TEST_EVIDENCE_NOT_PASSED']);
  });

  it('G5 DIRECT_DB in the stored MIC or in B10 → refused (separate approval has no evidence)', () => {
    const mic = validMic();
    expect(activationBlockers(facts({ version: versionRecord({ manifestJson: mic, manifestHash: canonicalDigest(mic).sha256 }) }))).toEqual(['DIRECT_DB_APPROVAL_MISSING']);
    expect(activationBlockers(facts({ directDbContracts: 1 }))).toEqual(['DIRECT_DB_APPROVAL_MISSING']);
  });

  it('G6 stored MIC / hash integrity: tampered hash, NULL manifest, unreadable MIC → refused', () => {
    expect(activationBlockers(facts({ version: versionRecord({ manifestHash: 'f'.repeat(64) }) }))).toEqual(['MANIFEST_INTEGRITY_INVALID']);
    expect(activationBlockers(facts({ version: versionRecord({ manifestJson: null }) }))).toEqual(['MANIFEST_INTEGRITY_INVALID']);
    const odd = { seeded: true };
    expect(activationBlockers(facts({ version: versionRecord({ manifestJson: odd, manifestHash: canonicalDigest(odd).sha256 }) }))).toEqual(['MANIFEST_INTEGRITY_INVALID']);
  });

  it('G7 every blocker together, in the declared order; enable needs exactly one ACTIVE version that still passes', () => {
    const mic = { ...validMic(), mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'a', result: 'FAIL', reference: 'r' }] } };
    expect(activationBlockers(facts({ version: versionRecord({ manifestJson: mic, manifestHash: 'f'.repeat(64) }), checks: [{ checkId: 'k', checkResult: 'BLOCK' }], blockingChanges: 2 })))
      .toEqual(['MANIFEST_INTEGRITY_INVALID', 'TEST_EVIDENCE_NOT_PASSED', 'COMPATIBILITY_RESULT_NOT_ACCEPTED', 'COMPATIBILITY_BLOCKING_CHANGE', 'DIRECT_DB_APPROVAL_MISSING']);
    expect(ACTIVATION_BLOCKERS).toHaveLength(7);
    expect(enableBlockers(0, null)).toEqual(['NO_ACTIVE_VERSION']);
    expect(enableBlockers(2, facts())).toEqual(['NO_ACTIVE_VERSION']);
    expect(enableBlockers(1, facts())).toEqual([]);
    expect(enableBlockers(1, facts({ checks: [] }))).toEqual(['COMPATIBILITY_CHECK_MISSING']);
  });
});

describe('FBE-05 state machine (L1) and review metadata (L2)', () => {
  it('L1 APPROVE: IN_REVIEW → APPROVED, reviewer = actor, reviewed_at set, manifest / hash / activated_at unchanged; B07 APPROVE + B08 SUCCESS', async () => {
    const { h, m } = setup();
    const v = await inReview(h, m, '1.0.0');
    const before = row(h, v.version_id);
    const res = await send(h, vurl(m, v.version_id, 'approve'));
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ status: 'APPROVED', reviewedByAccountId: ACCOUNT_A, activatedAt: null, manifestHash: before?.manifest_hash });
    expect(res.body.version.reviewedAt).toMatch(/Z$/);
    expect(row(h, v.version_id)?.manifest_json).toEqual(before?.manifest_json);
    expect(lifecycleEvents(h)).toEqual([[v.version_id, 'APPROVE', { status: 'IN_REVIEW' }, { status: 'APPROVED' }]]);
    const audit = h.db.state.versionAudits.at(-1);
    expect([audit?.[VA.action], audit?.[VA.outcome], audit?.[VA.targetType], audit?.[VA.targetId], audit?.[VA.versionId], audit?.[VA.actor]])
      .toEqual(['MODULE_VERSION.APPROVE', 'SUCCESS', 'MODULE_VERSION', v.version_id, v.version_id, ACCOUNT_A]);
    expect(JSON.parse(String(audit?.[VA.metadata]))).toEqual({ v: 1, reason: 'APPROVED', requestId: res.headers['x-request-id'] });
  });

  it('L1 REJECT: IN_REVIEW → REJECTED with review metadata; REJECTED is final', async () => {
    const { h, m } = setup();
    const v = await inReview(h, m, '1.0.0');
    const res = await send(h, vurl(m, v.version_id, 'reject'));
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ status: 'REJECTED', reviewedByAccountId: ACCOUNT_A, activatedAt: null });
    expect(lifecycleEvents(h)).toEqual([[v.version_id, 'REJECT', { status: 'IN_REVIEW' }, { status: 'REJECTED' }]]);
    for (const action of ['approve', 'reject', 'activate', 'retire']) {
      const r = await send(h, vurl(m, v.version_id, action));
      expect(r.status, action).toBe(409);
      expect(r.body.error.code, action).toBe('VERSION_STATE_CONFLICT');
    }
    expect(row(h, v.version_id)?.status).toBe('REJECTED');
  });

  it('L1 forbidden transitions → 409 with nothing written (DRAFT, IN_REVIEW → ACTIVE, APPROVED → REJECTED, RETIRED → ACTIVE, …)', async () => {
    const { h, m } = setup();
    const draft = seedVersion(h.db, m.module_id, '0.1.0');
    const review = await inReview(h, m, '1.0.0');
    const cases: [string, string][] = [
      [draft.version_id, 'approve'], [draft.version_id, 'reject'], [draft.version_id, 'activate'], [draft.version_id, 'retire'],
      [review.version_id, 'activate'], [review.version_id, 'retire'],
    ];
    const updates = new Set<string>([LIFECYCLE_SQL.approveVersion, LIFECYCLE_SQL.rejectVersion, LIFECYCLE_SQL.activateVersion, LIFECYCLE_SQL.retireVersion, LIFECYCLE_SQL.retireCurrentActive]);
    for (const [id, action] of cases) {
      const before = snapshot(h);
      const from = h.db.statements.length;
      const r = await send(h, vurl(m, id, action));
      expect(r.status, `${action}`).toBe(409);
      expect(snapshot(h), action).toBe(before);
      expect(h.db.statements.slice(from).some((x) => updates.has(x.sql)), action).toBe(false); // refused before any UPDATE
    }
    const ok = await approved(h, m, '2.0.0', cleanMic('2.0.0'));
    for (const action of ['approve', 'reject', 'retire']) expect((await send(h, vurl(m, ok.version_id, action))).status, action).toBe(409);
    await send(h, vurl(m, ok.version_id, 'activate'));
    for (const action of ['approve', 'reject', 'activate']) expect((await send(h, vurl(m, ok.version_id, action))).status, action).toBe(409);
    expect((await send(h, vurl(m, ok.version_id, 'retire'))).status).toBe(200);
    for (const action of ['approve', 'reject', 'activate', 'retire']) expect((await send(h, vurl(m, ok.version_id, action))).status, action).toBe(409); // RETIRED: no rollback route
    expect(row(h, ok.version_id)?.status).toBe('RETIRED');
  });

  it('L1 MIC / hash never change after DRAFT: PUT manifest and SUBMIT on APPROVED / ACTIVE → 409; Function / Data rows untouched by lifecycle', async () => {
    const { h, m } = setup();
    const v = await approved(h, m, '1.0.0');
    const defs = definitions(h);
    expect((await send(h, `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest: cleanMic('1.0.0') }, 'put')).status).toBe(409);
    expect((await send(h, vurl(m, v.version_id, 'submit'))).status).toBe(409);
    await send(h, vurl(m, v.version_id, 'activate'));
    await send(h, murl(m, 'enable'));
    await send(h, murl(m, 'disable'));
    await send(h, vurl(m, v.version_id, 'retire'));
    expect(definitions(h)).toBe(defs);
    const r = row(h, v.version_id);
    expect(r?.manifest_hash).toBe(canonicalDigest(cleanMic('1.0.0')).sha256);
  });

  it('L1 unknown / foreign / malformed ids → 404 after authorisation; body other than {} → 400', async () => {
    const { h, m } = setup();
    const other = seedModule(h.db, 'OTHER');
    const v = await inReview(h, m, '1.0.0');
    expect((await send(h, vurl(other, v.version_id, 'approve'))).body.error.code).toBe('VERSION_NOT_FOUND');
    expect((await send(h, vurl(m, '00000000-0000-4000-8000-000000000000', 'approve'))).status).toBe(404);
    expect((await send(h, `/api/foundation/modules/${m.module_id}/versions/not-a-uuid/approve`)).status).toBe(404);
    expect((await send(h, '/api/foundation/modules/00000000-0000-4000-8000-000000000000/enable')).body.error.code).toBe('MODULE_NOT_FOUND');
    for (const body of [{ reason: 'x' }, [], 'x', null]) {
      const r = await send(h, vurl(m, v.version_id, 'approve'), body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(row(h, v.version_id)?.status).toBe('IN_REVIEW');
    // No content at all (JSON content type, empty payload) is accepted like {}.
    const empty = await request(h.app).post(vurl(m, v.version_id, 'approve')).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`);
    expect(empty.status).toBe(200);
  });
});

describe('FBE-05 conditional UPDATE layer', () => {
  it('C1 the status changes between the locked read and the UPDATE → 0 rows → 409, nothing written (APPROVE / REJECT / ACTIVATE / RETIRE)', async () => {
    const flows: [string, string, (h: Harness, m: ModuleRow) => Promise<VersionRow>][] = [
      ['approve', LIFECYCLE_SQL.approveVersion, (h, m) => inReview(h, m, '1.0.0')],
      ['reject', LIFECYCLE_SQL.rejectVersion, (h, m) => inReview(h, m, '1.0.0')],
      ['activate', LIFECYCLE_SQL.activateVersion, (h, m) => approved(h, m, '1.0.0')],
      ['retire', LIFECYCLE_SQL.retireVersion, (h, m) => active(h, m, '1.0.0')],
    ];
    for (const [action, sql, prepare] of flows) {
      const { h, m } = setup();
      const v = await prepare(h, m);
      const before = snapshot(h);
      h.db.before.set(sql, (state) => {
        state.versions = state.versions.map((x) => (x.version_id === v.version_id ? { ...x, status: 'REJECTED', reviewed_at: 't', reviewed_by_account_id: ACCOUNT_A, activated_at: null } : x));
      });
      const res = await send(h, vurl(m, v.version_id, action));
      expect(res.status, action).toBe(409);
      expect(res.body.error.code, action).toBe('VERSION_STATE_CONFLICT');
      expect(snapshot(h), action).toBe(before);
    }
  });

  it('C2 activated_at keeps the first activation (coalesce), status conditions are in every UPDATE', () => {
    expect(LIFECYCLE_SQL.activateVersion).toContain("activated_at = coalesce(v.activated_at, now())");
    expect(LIFECYCLE_SQL.approveVersion).toContain("AND v.status = 'IN_REVIEW'");
    expect(LIFECYCLE_SQL.rejectVersion).toContain("AND v.status = 'IN_REVIEW'");
    expect(LIFECYCLE_SQL.activateVersion).toContain("AND v.status = 'APPROVED'");
    expect(LIFECYCLE_SQL.retireVersion).toContain("AND v.status = 'ACTIVE'");
    expect(LIFECYCLE_SQL.retireCurrentActive).toContain("v.status = 'ACTIVE' AND v.version_id <> $2::uuid");
    expect(LIFECYCLE_SQL.enableModule).toContain("AND m.is_enabled = false");
    expect(LIFECYCLE_SQL.disableModule).toContain("AND m.is_enabled = true");
    for (const sql of [LIFECYCLE_SQL.retireVersion, LIFECYCLE_SQL.retireCurrentActive]) expect(sql.split('WHERE')[0]).not.toContain('activated_at'); // SET keeps it
  });
});

describe('FBE-05 ACTIVATE / RETIRE (L3, L4)', () => {
  it('A1 APPROVED → ACTIVE: activated_at set once, review fields kept; B07 ACTIVATE + B08 SUCCESS without retired id', async () => {
    const { h, m } = setup();
    const v = await approved(h, m, '1.0.0');
    const reviewedAt = row(h, v.version_id)?.reviewed_at;
    const res = await send(h, vurl(m, v.version_id, 'activate'));
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ status: 'ACTIVE', reviewedByAccountId: ACCOUNT_A, reviewedAt });
    expect(res.body.version.activatedAt).toMatch(/Z$/);
    expect(lifecycleEvents(h).slice(-1)).toEqual([[v.version_id, 'ACTIVATE', { status: 'APPROVED' }, { status: 'ACTIVE' }]]);
    const audit = h.db.state.versionAudits.at(-1);
    expect([audit?.[VA.action], audit?.[VA.outcome], audit?.[VA.versionId]]).toEqual(['MODULE_VERSION.ACTIVATE', 'SUCCESS', v.version_id]);
    expect(JSON.parse(String(audit?.[VA.metadata]))).toEqual({ v: 1, reason: 'ACTIVATED', requestId: res.headers['x-request-id'] });
    expect(mod(h, m.module_id)?.is_enabled).toBe(false); // L5: activation never enables the module
  });

  it('A2 V2 (CHANGE from V1) activation retires V1 first, in one transaction: events RETIRE(V1) then ACTIVATE(V2); V1 activated_at kept; B08 names V1', async () => {
    const { h, m } = setup();
    const v1 = await active(h, m, '1.0.0');
    const v1ActivatedAt = row(h, v1.version_id)?.activated_at;
    const v2 = await approved(h, m, '2.0.0', cleanMic('2.0.0', '1.0.0'));
    expect(h.db.state.compatChecks.find((k) => k.to_version_id === v2.version_id)?.from_version_id).toBe(v1.version_id);
    const before = h.db.statements.length;
    const res = await send(h, vurl(m, v2.version_id, 'activate'));
    expect(res.status).toBe(200);
    expect(row(h, v1.version_id)).toMatchObject({ status: 'RETIRED', activated_at: v1ActivatedAt });
    expect(row(h, v2.version_id)?.status).toBe('ACTIVE');
    expect(h.db.state.versions.filter((x) => x.module_id === m.module_id && x.status === 'ACTIVE')).toHaveLength(1);
    expect(lifecycleEvents(h).slice(-2)).toEqual([
      [v1.version_id, 'RETIRE', { status: 'ACTIVE' }, { status: 'RETIRED' }], [v2.version_id, 'ACTIVATE', { status: 'APPROVED' }, { status: 'ACTIVE' }],
    ]);
    const tx = h.db.statements.slice(before).filter((s) => s.inTransaction).map((s) => s.sql);
    expect(tx.indexOf(LIFECYCLE_SQL.retireCurrentActive)).toBeLessThan(tx.indexOf(LIFECYCLE_SQL.activateVersion));
    expect(tx[0]).toBe(VERSION_SQL.lockModuleVersions);
    const audit = h.db.state.versionAudits.at(-1);
    expect(JSON.parse(String(audit?.[VA.metadata]))).toMatchObject({ reason: 'ACTIVATED', retiredVersionId: v1.version_id });
    expect(h.db.txLog.at(-1)).toBe('COMMIT');
  });

  it('A3 activation gate over HTTP: DIRECT_DB, failed evidence, BLOCK result, BLOCKING change (even RESOLVED), missing / ambiguous check, tampered hash → 422, nothing written', async () => {
    const { h, m } = setup();
    const direct = await approved(h, m, '1.0.0', validMic('SALES', '1.0.0'));
    // After an APPROVED version, MIC-09 requires CHANGE (APPROVED is change-eligible).
    const failing = await approved(h, m, '1.1.0', { ...cleanMic('1.1.0', '1.0.0'), mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'u', result: 'NOT_TESTED', reference: 'r' }] } });
    const blocked = await approved(h, m, '1.2.0', cleanMic('1.2.0', '1.0.0'));
    const blocking = await approved(h, m, '1.3.0', cleanMic('1.3.0', '1.0.0'));
    const missing = await approved(h, m, '1.4.0', cleanMic('1.4.0', '1.0.0'));
    const ambiguous = await approved(h, m, '1.5.0', cleanMic('1.5.0', '1.0.0'));
    const tampered = await approved(h, m, '1.6.0', cleanMic('1.6.0', '1.0.0'));
    const check = (v: VersionRow) => h.db.state.compatChecks.find((k) => k.to_version_id === v.version_id);
    h.db.state.compatChecks = h.db.state.compatChecks.map((k) => (k.to_version_id === blocked.version_id ? { ...k, check_result: 'BLOCK' } : k));
    const blockingCheck = check(blocking);
    h.db.state.compatChanges.push({
      change_id: 'c', check_id: blockingCheck?.check_id ?? '', change_area: 'DATA', object_key: 'DATA:X', change_type: 'MODIFIED', severity: 'BLOCKING',
      previous_value: null, proposed_value: null, resolution_status: 'RESOLVED', details: null,
    });
    h.db.state.compatChecks = h.db.state.compatChecks.filter((k) => k.to_version_id !== missing.version_id);
    const amb = check(ambiguous);
    if (amb) h.db.state.compatChecks.push({ ...amb, check_id: 'second' });
    h.db.state.versions = h.db.state.versions.map((x) => (x.version_id === tampered.version_id ? { ...x, manifest_hash: 'e'.repeat(64) } : x));
    const cases: [VersionRow, string][] = [
      [direct, 'DIRECT_DB_APPROVAL_MISSING'], [failing, 'TEST_EVIDENCE_NOT_PASSED'], [blocked, 'COMPATIBILITY_RESULT_NOT_ACCEPTED'],
      [blocking, 'COMPATIBILITY_BLOCKING_CHANGE'], [missing, 'COMPATIBILITY_CHECK_MISSING'], [ambiguous, 'COMPATIBILITY_CHECK_AMBIGUOUS'], [tampered, 'MANIFEST_INTEGRITY_INVALID'],
    ];
    for (const [v, code] of cases) {
      const before = snapshot(h);
      const res = await send(h, vurl(m, v.version_id, 'activate'));
      expect(res.status, code).toBe(422);
      expect(res.body.error, code).toMatchObject({ code: 'ACTIVATION_BLOCKED', details: { errors: [code] } });
      expect(snapshot(h), code).toBe(before);
      expect(h.db.txLog.at(-1), code).toBe('ROLLBACK');
    }
  });

  it('A4 RETIRE: ACTIVE → RETIRED, activated_at kept, no other version activated; B07 RETIRE + B08 SUCCESS', async () => {
    const { h, m } = setup();
    const v1 = await active(h, m, '1.0.0');
    const v2 = await approved(h, m, '2.0.0', cleanMic('2.0.0', '1.0.0'));
    const at = row(h, v1.version_id)?.activated_at;
    const res = await send(h, vurl(m, v1.version_id, 'retire'));
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ status: 'RETIRED', activatedAt: at });
    expect(row(h, v1.version_id)?.activated_at).toBe(at);
    expect(row(h, v2.version_id)?.status).toBe('APPROVED');
    expect(h.db.state.versions.some((x) => x.status === 'ACTIVE')).toBe(false);
    expect(lifecycleEvents(h).slice(-1)).toEqual([[v1.version_id, 'RETIRE', { status: 'ACTIVE' }, { status: 'RETIRED' }]]);
    expect(h.db.state.versionAudits.at(-1)?.[VA.action]).toBe('MODULE_VERSION.RETIRE');
  });

  it('A5 one ACTIVE per module: a concurrent ACTIVE appearing inside the transaction → 23505 → 503 and full rollback', async () => {
    const { h, m } = setup();
    const v1 = await approved(h, m, '1.0.0');
    const v2 = await approved(h, m, '1.1.0', cleanMic('1.1.0', '1.0.0'));
    const before = snapshot(h);
    // Another activation committed between the retire step and the activate step (impossible under the module lock; proves the index guard).
    h.db.before.set(LIFECYCLE_SQL.activateVersion, (state) => {
      state.versions = state.versions.map((x) => (x.version_id === v2.version_id ? { ...x, status: 'ACTIVE', activated_at: '2026-10-17T12:00:00.000000Z' } : x));
    });
    const res = await send(h, vurl(m, v1.version_id, 'activate'));
    expect(res.status).toBe(503);
    expect(snapshot(h)).toBe(before);
    expect(h.logs.some((l) => l.includes('activate version failed (rolled back)') && l.includes('23505'))).toBe(true);
  });

  it('A6 atomicity: a failure of any write (UPDATE B02, B07, B08) → 503, nothing kept, previous ACTIVE stays ACTIVE', async () => {
    const failures: [string, string][] = [
      [LIFECYCLE_SQL.retireCurrentActive, '42501'], [LIFECYCLE_SQL.activateVersion, '42501'], [LIFECYCLE_SQL.insertLifecycleEvent, '23503'],
      [VERSION_SQL.insertVersionAudit, '23514'], [LIFECYCLE_SQL.latestChecks, '42501'], [VERSION_SQL.lockModuleVersions, '55P03'],
    ];
    for (const [sql, code] of failures) {
      const { h, m } = setup();
      const v1 = await active(h, m, '1.0.0');
      const v2 = await approved(h, m, '2.0.0', cleanMic('2.0.0', '1.0.0'));
      const before = snapshot(h);
      h.db.failOn.set(sql, pgError(code));
      const res = await send(h, vurl(m, v2.version_id, 'activate'));
      expect(res.status, sql.trim().slice(0, 40)).toBe(503);
      expect(snapshot(h), sql.trim().slice(0, 40)).toBe(before);
      expect(row(h, v1.version_id)?.status).toBe('ACTIVE');
    }
  });

  it('A7 atomicity of APPROVE / REJECT / RETIRE / ENABLE / DISABLE: B07 or B08 failure → 503, nothing kept', async () => {
    const flows: [string, (h: Harness, m: ModuleRow) => Promise<string>][] = [
      ['approve', async (h, m) => vurl(m, (await inReview(h, m, '1.0.0')).version_id, 'approve')],
      ['reject', async (h, m) => vurl(m, (await inReview(h, m, '1.0.0')).version_id, 'reject')],
      ['retire', async (h, m) => vurl(m, (await active(h, m, '1.0.0')).version_id, 'retire')],
      ['enable', async (h, m) => { await active(h, m, '1.0.0'); return murl(m, 'enable'); }],
      ['disable', async (h, m) => { await active(h, m, '1.0.0'); await send(h, murl(m, 'enable')); return murl(m, 'disable'); }],
    ];
    for (const [name, prepare] of flows) {
      const audit = name === 'enable' || name === 'disable' ? FOUNDATION_SQL.insertAudit : VERSION_SQL.insertVersionAudit;
      for (const sql of [LIFECYCLE_SQL.insertLifecycleEvent, audit]) {
        const { h, m } = setup();
        const url = await prepare(h, m);
        const before = snapshot(h);
        h.db.failOn.set(sql, pgError('23514'));
        const res = await send(h, url);
        expect(res.status, name).toBe(503);
        expect(snapshot(h), name).toBe(before);
      }
    }
  });
});

describe('FBE-05 ENABLE / DISABLE (L5)', () => {
  it('E1 ENABLE needs one ACTIVE version: none → 422 NO_ACTIVE_VERSION; then 200, updated_at moves, B07 ENABLE (no version) + B08 SUCCESS', async () => {
    const { h, m } = setup();
    const r0 = await send(h, murl(m, 'enable'));
    expect(r0.status).toBe(422);
    expect(r0.body.error).toMatchObject({ code: 'MODULE_ENABLE_BLOCKED', details: { errors: ['NO_ACTIVE_VERSION'] } });
    await approved(h, m, '1.0.0');
    expect((await send(h, murl(m, 'enable'))).body.error.details.errors).toEqual(['NO_ACTIVE_VERSION']); // APPROVED is not ACTIVE
    await send(h, vurl(m, h.db.state.versions.find((x) => x.status === 'APPROVED')?.version_id ?? '', 'activate'));
    const updatedBefore = mod(h, m.module_id)?.updated_at;
    const res = await send(h, murl(m, 'enable'));
    expect(res.status).toBe(200);
    expect(res.body.module).toMatchObject({ moduleId: m.module_id, isEnabled: true });
    expect(mod(h, m.module_id)?.updated_at).not.toBe(updatedBefore);
    const event = h.db.state.events.at(-1);
    expect([event?.[0], event?.[1], event?.[2], event?.[3], JSON.parse(String(event?.[5])), JSON.parse(String(event?.[6]))])
      .toEqual(['EVENT', m.module_id, null, 'ENABLE', { is_enabled: false }, { is_enabled: true }]);
    const audit = h.db.state.audits.at(-1);
    expect([audit?.[MA.action], audit?.[MA.outcome], audit?.[MA.targetType], audit?.[MA.targetId], audit?.[MA.moduleId]]).toEqual(['MODULE_REGISTRY.ENABLE', 'SUCCESS', 'MODULE', m.module_id, m.module_id]);
    expect((await send(h, murl(m, 'enable'))).body.error.code).toBe('MODULE_STATE_CONFLICT');
  });

  it('E2 DISABLE keeps the ACTIVE version; activating while disabled does not enable; RETIRE does not disable', async () => {
    const { h, m } = setup();
    const v1 = await active(h, m, '1.0.0');
    await send(h, murl(m, 'enable'));
    const res = await send(h, murl(m, 'disable'));
    expect(res.status).toBe(200);
    expect(res.body.module.isEnabled).toBe(false);
    expect(row(h, v1.version_id)?.status).toBe('ACTIVE');
    expect(h.db.state.events.at(-1)?.[3]).toBe('DISABLE');
    expect(h.db.state.audits.at(-1)?.[MA.action]).toBe('MODULE_REGISTRY.DISABLE');
    expect((await send(h, murl(m, 'disable'))).body.error.code).toBe('MODULE_STATE_CONFLICT');
    const v2 = await approved(h, m, '2.0.0', cleanMic('2.0.0', '1.0.0'));
    expect((await send(h, vurl(m, v2.version_id, 'activate'))).status).toBe(200);
    expect(mod(h, m.module_id)?.is_enabled).toBe(false);
    await send(h, murl(m, 'enable'));
    expect((await send(h, vurl(m, v2.version_id, 'retire'))).status).toBe(200);
    expect(mod(h, m.module_id)?.is_enabled).toBe(true);
    expect((await send(h, murl(m, 'enable'))).body.error.code).toBe('MODULE_STATE_CONFLICT'); // already enabled, checked before the gate
  });

  it('E3 ENABLE re-checks the ACTIVE version (tampered hash → 422), DIRECT_DB never reaches ACTIVE', async () => {
    const { h, m } = setup();
    const v = await active(h, m, '1.0.0');
    h.db.state.versions = h.db.state.versions.map((x) => (x.version_id === v.version_id ? { ...x, manifest_hash: 'd'.repeat(64) } : x));
    const res = await send(h, murl(m, 'enable'));
    expect(res.status).toBe(422);
    expect(res.body.error.details.errors).toEqual(['MANIFEST_INTEGRITY_INVALID']);
    expect(mod(h, m.module_id)?.is_enabled).toBe(false);
  });
});

describe('FBE-05 authorisation (L6)', () => {
  const endpoints: [string, number, (h: Harness, m: ModuleRow, versionId: string) => string, string][] = [
    ['approve', 0, (_h, m, id) => vurl(m, id, 'approve'), 'MODULE_VERSION.APPROVE'],
    ['reject', 1, (_h, m, id) => vurl(m, id, 'reject'), 'MODULE_VERSION.REJECT'],
    ['activate', 2, (_h, m, id) => vurl(m, id, 'activate'), 'MODULE_VERSION.ACTIVATE'],
    ['retire', 3, (_h, m, id) => vurl(m, id, 'retire'), 'MODULE_VERSION.RETIRE'],
    ['enable', 4, (_h, m) => murl(m, 'enable'), 'MODULE_REGISTRY.ENABLE'],
    ['disable', 5, (_h, m) => murl(m, 'disable'), 'MODULE_REGISTRY.DISABLE'],
  ];

  it('Z1 each endpoint needs its own permission: without it → 403 + one B08 DENIED (target NULL), before any lookup; other lifecycle grants do not help', async () => {
    for (const [name, index, url, action] of endpoints) {
      const without = ALL.filter((p) => p !== LIFECYCLE_PERMS[index]).map((permissionId) => ({ permissionId, row: VALID_ROLE }));
      const { h, m } = setup(without);
      const v = await inReview(h, m, '1.0.0');
      const before = JSON.stringify([h.db.state.versions, h.db.state.modules, h.db.state.versionAudits]);
      const auditsBefore = h.db.state.audits.length;
      const res = await send(h, url(h, m, v.version_id));
      expect(res.status, name).toBe(403);
      expect(res.body.error.code, name).toBe('FORBIDDEN');
      expect(JSON.stringify([h.db.state.versions, h.db.state.modules, h.db.state.versionAudits]), name).toBe(before);
      const denied = h.db.state.audits.slice(auditsBefore);
      expect(denied.map((a) => [a[MA.action], a[MA.outcome], a[MA.moduleId], a[MA.targetId]]), name).toEqual([[action, 'DENIED', null, null]]);
      expect(JSON.parse(String(denied[0]?.[MA.metadata])).reason, name).toBe('NO_VALID_ALLOW');
      // A non-existent target is not revealed before authorisation either.
      expect((await send(h, url(h, { ...m, module_id: '00000000-0000-4000-8000-000000000000' }, '00000000-0000-4000-8000-000000000000'))).status, name).toBe(403);
      expect((await send(h, url(h, { ...m, module_id: 'not-a-uuid' }, 'not-a-uuid'))).status, name).toBe(403);
      expect((await send(h, url(h, m, v.version_id), { unexpected: true })).status, name).toBe(403);
    }
  });

  it('Z2 Direct DENY wins over a role ALLOW; insufficient assurance and an undefined permission are denied', async () => {
    const deny = setup([...ALL.map((permissionId) => ({ permissionId, row: VALID_ROLE })), { permissionId: PERM_APPROVE_ID, row: VALID_DIRECT_DENY }]);
    const v = await inReview(deny.h, deny.m, '1.0.0');
    expect((await send(deny.h, vurl(deny.m, v.version_id, 'approve'))).status).toBe(403);
    expect(JSON.parse(String(deny.h.db.state.audits.at(-1)?.[MA.metadata])).reason).toBe('DIRECT_DENY');
    const weak = setup();
    weak.h.db.iam.permissions = weak.h.db.iam.permissions.map((p) => (p.permission_id === PERM_ACTIVATE_ID ? { ...p, minimum_assurance_level: 2 } : p));
    const w = await approved(weak.h, weak.m, '1.0.0');
    expect((await send(weak.h, vurl(weak.m, w.version_id, 'activate'))).status).toBe(403);
    expect(JSON.parse(String(weak.h.db.state.audits.at(-1)?.[MA.metadata])).reason).toBe('ASSURANCE_INSUFFICIENT');
    const undef = setup();
    undef.h.db.iam.permissions = undef.h.db.iam.permissions.filter((p) => p.permission_id !== PERM_ENABLE_ID);
    expect((await send(undef.h, murl(undef.m, 'enable'))).status).toBe(403);
    expect(JSON.parse(String(undef.h.db.state.audits.at(-1)?.[MA.metadata])).reason).toBe('PERMISSION_NOT_DEFINED');
  });

  it('Z3 scope: lifecycle SQL writes only B01 (is_enabled, updated_at), B02 (status, review, activation), B07, B08; no DELETE / IAM / manifest change', () => {
    const writes = Object.values(LIFECYCLE_SQL).map((sql) => /^\s*(UPDATE|INSERT INTO) (\S+)/.exec(sql)).filter((x) => x !== null).map((x) => `${x[1]} ${x[2]}`);
    expect([...new Set(writes)].sort()).toEqual(['INSERT INTO foundation.fnd_module_events', 'UPDATE foundation.fnd_module_versions', 'UPDATE foundation.fnd_modules']);
    for (const sql of Object.values(LIFECYCLE_SQL)) {
      expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|GRANT|ALTER|DROP|CREATE)\b/i);
      expect(sql).not.toMatch(/\biam\./i);
      expect(sql).not.toMatch(/SET[\s\S]*manifest_(json|hash)\s*=/);
    }
    const setCols = Object.values(LIFECYCLE_SQL).flatMap((sql) => [...sql.matchAll(/(?:SET|,)\s+(\w+)\s*=/g)].map((x) => x[1]));
    expect([...new Set(setCols)].sort()).toEqual(['activated_at', 'is_enabled', 'reviewed_at', 'reviewed_by_account_id', 'status', 'updated_at']);
  });
});
