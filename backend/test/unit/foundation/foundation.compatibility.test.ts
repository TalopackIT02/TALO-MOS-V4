import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CompatibilitySourceError, compareDefinitions, compatibilityEnvironment, previousDefinitions, proposedDefinitions,
} from '../../../src/modules/foundation/foundation.compatibility.js';
import { COMPAT_SQL } from '../../../src/modules/foundation/foundation.compatibility.repository.js';
import { dataPlan } from '../../../src/modules/foundation/foundation.data.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { SqlManifestRepository } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { validateMic } from '../../../src/modules/foundation/foundation.mic.js';
import type { Mic, MicContext } from '../../../src/modules/foundation/foundation.mic.js';
import { registryPlan } from '../../../src/modules/foundation/foundation.registry.js';
import {
  ACCOUNT_A, FakeDb, PERM_VCREATE_ID, PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, seedModule,
  seedVersion, token,
} from './fakes.js';
import type { Harness } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-04 — B13 / B14 compatibility check written by SUBMIT (Q8 environment, Q9 rules, Q10 fingerprint NULL).
// Mock/unit only. The CHANGE branch needs an APPROVED / ACTIVE / RETIRED version, which no approved flow can produce yet:
// it is covered here with a seeded version only (NOT_TESTED on PostgreSQL, same reason as owner decision H1).

const TOKEN = token('compatibilitySessionToken');
const ctx = (over: Partial<MicContext> = {}): MicContext => ({ moduleKey: 'SALES', moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', otherVersions: [], ...over });

function parsed(manifest: unknown, over: Partial<MicContext> = {}): Mic {
  const r = validateMic(manifest, ctx(over));
  if (!r.ok) throw new Error(`fixture invalid: ${r.errors.join(',')}`);
  return r.mic;
}

function setup() {
  const iam = defaultIam();
  iam.grants = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID].map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  const m = seedModule(h.db, 'SALES');
  return { h, m };
}
const sendJson = (h: Harness, method: 'put' | 'post', url: string, body: unknown) =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const base = (moduleId: string, versionId: string) => `/api/foundation/modules/${moduleId}/versions/${versionId}`;
const put = (h: Harness, moduleId: string, versionId: string, manifest: unknown) => sendJson(h, 'put', `${base(moduleId, versionId)}/manifest`, { manifest });
const submit = (h: Harness, moduleId: string, versionId: string) => sendJson(h, 'post', `${base(moduleId, versionId)}/submit`, {});

// v2.0.0 against v1.0.0: REPORT renamed (MODIFIED), ORDER.CREATE removed (REMOVED), APPROVAL / APPROVAL.APPROVE added,
// ORDERS unchanged, ORDER_FEED removed, AUDIT_LOG added.
function changedMic() {
  const mic = validMic('SALES', '2.0.0');
  const orders = mic.mic06DataResources[1];
  return {
    ...mic,
    mic02Functions: [mic.mic02Functions[0], { functionKey: 'REPORT', name: 'Báo cáo tổng hợp' }, { functionKey: 'APPROVAL', name: 'Phê duyệt' }],
    mic03Actions: [mic.mic03Actions[0], mic.mic03Actions[2], { functionKey: 'APPROVAL', actionKey: 'APPROVE', name: 'Duyệt', nature: 'WRITE' }],
    mic05Api: [mic.mic05Api[0]],
    mic06DataResources: [
      { ...orders, access: [orders?.access[0]] },
      { resourceKey: 'AUDIT_LOG', interfaceKind: 'EVENT', columns: [], relations: [], access: [] },
    ],
    mic07IamMapping: [mic.mic07IamMapping[0], mic.mic07IamMapping[2],
      { functionKey: 'APPROVAL', actionKey: 'APPROVE', moduleCode: 'SALES', resourceCode: 'APPROVAL', operation: 'APPROVE', minimumAssuranceLevel: 1 }],
    mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['Đổi tên báo cáo'] },
  };
}

describe('FBE-04 environment (Q8) and definitions', () => {
  it('C1 NODE_ENV → B13.environment: development → DEV, test → TEST, production → PROD', () => {
    expect(compatibilityEnvironment('development')).toBe('DEV');
    expect(compatibilityEnvironment('test')).toBe('TEST');
    expect(compatibilityEnvironment('production')).toBe('PROD');
  });

  it('C2 definitions: keys FUNCTION:<fk> / ACTION:<fk>.<ak> / DATA:<resourceKey>; hash = B05 / B06 definition_hash and B10 contract_hash', () => {
    const mic = parsed(validMic());
    const defs = proposedDefinitions(mic);
    expect(defs.map((d) => d.objectKey)).toEqual([
      'FUNCTION:ORDER', 'FUNCTION:REPORT', 'ACTION:ORDER.READ', 'ACTION:ORDER.CREATE', 'ACTION:REPORT.READ', 'DATA:ORDER_FEED', 'DATA:ORDERS',
    ]);
    const registry = registryPlan(mic);
    const data = dataPlan(mic);
    expect(defs.filter((d) => d.area === 'FUNCTION').map((d) => d.hash)).toEqual(registry.map((f) => f.definitionHash));
    expect(defs.filter((d) => d.area === 'ACTION').map((d) => d.hash)).toEqual(registry.flatMap((f) => f.actions.map((a) => a.definitionHash)));
    expect(defs.filter((d) => d.area === 'DATA').map((d) => d.hash)).toEqual(data.map((c) => c.contractHash));
    expect(defs.map((d) => d.value)).toEqual([...mic.mic02Functions, ...mic.mic03Actions, ...mic.mic06DataResources]);
  });

  it('C3 previousDefinitions reads the stored MIC (same hashes as proposed); fails closed without comparable sections', () => {
    const mic = validMic();
    expect(previousDefinitions(JSON.parse(JSON.stringify(mic)))).toEqual(proposedDefinitions(parsed(mic)));
    const old = { ...mic, mic06DataResources: [{ interfaceKind: 'API', columns: ['a'], relations: [] }] }; // pre-FBE-04 MIC-06 shape
    for (const bad of [null, { seeded: true }, old, { ...mic, mic03Actions: 'x' }]) {
      expect(() => previousDefinitions(bad)).toThrow(CompatibilitySourceError);
    }
    const dup = { ...mic, mic02Functions: [mic.mic02Functions[0], mic.mic02Functions[0]] };
    expect(() => compareDefinitions(previousDefinitions(dup), [])).toThrow(CompatibilitySourceError);
  });
});

describe('FBE-04 compareDefinitions (Q9)', () => {
  it('C4 INITIAL_REGISTRATION: every definition ADDED / INFO, previous NULL, PASS; empty MIC → PASS without changes', () => {
    const mic = parsed(validMic());
    const result = compareDefinitions(null, proposedDefinitions(mic));
    expect(result.checkResult).toBe('PASS');
    expect(result.changes.map((c) => [c.changeArea, c.objectKey, c.changeType, c.severity, c.previousValue])).toEqual([
      ['FUNCTION', 'FUNCTION:ORDER', 'ADDED', 'INFO', null], ['FUNCTION', 'FUNCTION:REPORT', 'ADDED', 'INFO', null],
      ['ACTION', 'ACTION:ORDER.CREATE', 'ADDED', 'INFO', null], ['ACTION', 'ACTION:ORDER.READ', 'ADDED', 'INFO', null],
      ['ACTION', 'ACTION:REPORT.READ', 'ADDED', 'INFO', null], ['DATA', 'DATA:ORDERS', 'ADDED', 'INFO', null], ['DATA', 'DATA:ORDER_FEED', 'ADDED', 'INFO', null],
    ]);
    expect(result.changes.find((c) => c.objectKey === 'DATA:ORDERS')?.proposedValue).toEqual(mic.mic06DataResources[1]);
    expect(compareDefinitions(null, [])).toEqual({ checkResult: 'PASS', changes: [] });
  });

  it('C5 CHANGE: ADDED → INFO, MODIFIED / REMOVED → WARNING, unchanged → no row; any WARNING → WARN; never BLOCKING', () => {
    const before = previousDefinitions(validMic());
    const after = proposedDefinitions(parsed(changedMic(), { moduleVersion: '2.0.0', otherVersions: [{ moduleVersion: '1.0.0', status: 'APPROVED' }] }));
    const result = compareDefinitions(before, after);
    expect(result.checkResult).toBe('WARN');
    expect(result.changes.map((c) => [c.objectKey, c.changeType, c.severity])).toEqual([
      ['FUNCTION:APPROVAL', 'ADDED', 'INFO'], ['FUNCTION:REPORT', 'MODIFIED', 'WARNING'],
      ['ACTION:APPROVAL.APPROVE', 'ADDED', 'INFO'], ['ACTION:ORDER.CREATE', 'REMOVED', 'WARNING'],
      ['DATA:AUDIT_LOG', 'ADDED', 'INFO'], ['DATA:ORDERS', 'MODIFIED', 'WARNING'], ['DATA:ORDER_FEED', 'REMOVED', 'WARNING'],
    ]);
    const modified = result.changes.find((c) => c.objectKey === 'FUNCTION:REPORT');
    expect(modified).toMatchObject({ previousValue: { functionKey: 'REPORT', name: 'Báo cáo' }, proposedValue: { functionKey: 'REPORT', name: 'Báo cáo tổng hợp' } });
    expect(result.changes.find((c) => c.changeType === 'REMOVED')?.proposedValue).toBeNull();
    expect(result.changes.some((c) => String(c.severity) === 'BLOCKING')).toBe(false);
  });

  it('C6 CHANGE with only additions (or nothing) → PASS; identical MIC → PASS without changes; key order irrelevant', () => {
    const v1 = validMic();
    expect(compareDefinitions(previousDefinitions(v1), proposedDefinitions(parsed(v1)))).toEqual({ checkResult: 'PASS', changes: [] });
    const reordered = JSON.parse(JSON.stringify(v1, null, 1));
    reordered.mic02Functions = reordered.mic02Functions.map((f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).reverse()));
    expect(compareDefinitions(previousDefinitions(reordered), proposedDefinitions(parsed(v1))).changes).toEqual([]);
    const added = { ...v1, mic02Functions: [...v1.mic02Functions, { functionKey: 'EXTRA', name: 'Thêm' }] };
    const result = compareDefinitions(previousDefinitions(v1), proposedDefinitions(parsed(added)));
    expect(result).toEqual({ checkResult: 'PASS', changes: [expect.objectContaining({ objectKey: 'FUNCTION:EXTRA', changeType: 'ADDED', severity: 'INFO' })] });
  });
});

describe('FBE-04 SUBMIT writes B13 / B14 (Q1, Q8–Q10)', () => {
  it('C7 INITIAL_REGISTRATION → one B13 (from NULL, to = version, TEST, PASS, fingerprint NULL, completed ≥ started) + 7 B14 ADDED / INFO / OPEN', async () => {
    const { h, m } = setup();
    const v = seedVersion(h.db, m.module_id, '1.0.0');
    const mic = validMic();
    await put(h, m.module_id, v.version_id, mic);
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    expect(h.db.state.compatChecks).toHaveLength(1);
    const [check] = h.db.state.compatChecks;
    expect(check).toMatchObject({ module_id: m.module_id, from_version_id: null, to_version_id: v.version_id, environment: 'TEST', check_result: 'PASS', database_fingerprint: null });
    expect(String(check?.completed_at) >= String(check?.started_at)).toBe(true);
    const changes = h.db.state.compatChanges;
    expect(changes).toHaveLength(7);
    expect(changes.every((c) => c.check_id === check?.check_id && c.change_type === 'ADDED' && c.severity === 'INFO' && c.resolution_status === 'OPEN')).toBe(true);
    expect(changes.every((c) => c.previous_value === null && c.details === null)).toBe(true);
    expect(changes.find((c) => c.object_key === 'ACTION:ORDER.CREATE')?.proposed_value).toEqual(mic.mic03Actions[1]); // JSONB round trip
    expect(COMPAT_SQL.insertCheck).not.toMatch(/database_fingerprint|started_at/);
    expect(COMPAT_SQL.insertChange).not.toMatch(/resolution_status|details/);
  });

  it('C8 CHANGE from an APPROVED version → B13 from = that version, WARN, B14 per C5', async () => {
    const { h, m } = setup();
    const v1 = seedVersion(h.db, m.module_id, '1.0.0', 'APPROVED');
    v1.manifest_json = validMic();
    const v2 = seedVersion(h.db, m.module_id, '2.0.0');
    await put(h, m.module_id, v2.version_id, changedMic());
    const res = await submit(h, m.module_id, v2.version_id);
    expect(res.status).toBe(200);
    const [check] = h.db.state.compatChecks;
    expect(check).toMatchObject({ from_version_id: v1.version_id, to_version_id: v2.version_id, environment: 'TEST', check_result: 'WARN' });
    expect(h.db.state.compatChanges.map((c) => [c.change_area, c.object_key, c.change_type, c.severity])).toEqual([
      ['FUNCTION', 'FUNCTION:APPROVAL', 'ADDED', 'INFO'], ['FUNCTION', 'FUNCTION:REPORT', 'MODIFIED', 'WARNING'],
      ['ACTION', 'ACTION:APPROVAL.APPROVE', 'ADDED', 'INFO'], ['ACTION', 'ACTION:ORDER.CREATE', 'REMOVED', 'WARNING'],
      ['DATA', 'DATA:AUDIT_LOG', 'ADDED', 'INFO'], ['DATA', 'DATA:ORDERS', 'MODIFIED', 'WARNING'], ['DATA', 'DATA:ORDER_FEED', 'REMOVED', 'WARNING'],
    ]);
    const removed = h.db.state.compatChanges.find((c) => c.object_key === 'DATA:ORDER_FEED');
    expect(removed).toMatchObject({ previous_value: validMic().mic06DataResources[0], proposed_value: null });
    expect(h.db.statements.filter((s) => s.sql === COMPAT_SQL.fromVersion).map((s) => s.params)).toEqual([[m.module_id, '1.0.0']]);
  });

  it('C9 CHANGE whose from-version MIC is not comparable fails closed: 503, full rollback, DRAFT', async () => {
    const { h, m } = setup();
    seedVersion(h.db, m.module_id, '1.0.0', 'APPROVED'); // manifest_json {seeded: true}
    const v2 = seedVersion(h.db, m.module_id, '2.0.0');
    await put(h, m.module_id, v2.version_id, changedMic());
    const res = await submit(h, m.module_id, v2.version_id);
    expect(res.status).toBe(503);
    expect(h.db.state.versions.find((x) => x.version_id === v2.version_id)?.status).toBe('DRAFT');
    expect(h.db.state.compatChecks).toHaveLength(0);
    expect(h.db.state.dataContracts).toHaveLength(0);
    expect(h.db.state.functions).toHaveLength(0);
    expect(h.logs.some((l) => l.includes('submit version failed (rolled back)'))).toBe(true);
  });

  it('C10 the repository writes the environment it was built with (DEV / PROD), not a constant', async () => {
    for (const environment of ['DEV', 'PROD'] as const) {
      const db = new FakeDb();
      const m = seedModule(db, 'SALES');
      const v = seedVersion(db, m.module_id, '1.0.0');
      v.manifest_json = validMic();
      const mic = parsed(validMic());
      const repo = new SqlManifestRepository(db, environment);
      await repo.submitVersion({
        moduleId: m.module_id, versionId: v.version_id, actorAccountId: ACCOUNT_A, correlationId: 'req-1',
        prepare: () => ({ manifestHash: canonicalDigest(mic).sha256, registry: registryPlan(mic), data: dataPlan(mic), compatibility: { kind: 'INITIAL_REGISTRATION', proposed: proposedDefinitions(mic) } }),
        audit: (version) => ({
          eventId: '30000000-0000-4000-8000-000000000001', moduleId: version.moduleId, versionId: version.versionId, actorAccountId: ACCOUNT_A,
          actionCode: 'MODULE_VERSION.SUBMIT', targetType: 'MODULE_VERSION', targetId: version.versionId, outcome: 'SUCCESS', correlationId: 'req-1',
          sourceService: 'talo-mos-backend', metadata: { v: 1 },
        }),
      });
      expect(db.state.compatChecks.map((c) => c.environment)).toEqual([environment]);
    }
  });
});
