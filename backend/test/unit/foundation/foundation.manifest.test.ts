import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { MANIFEST_SQL } from '../../../src/modules/foundation/foundation.manifest.repository.js';
import { REGISTRY_SQL } from '../../../src/modules/foundation/foundation.registry.repository.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import {
  ACCOUNT_A, PERM_VCREATE_ID, PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, pgError, seedModule,
  seedVersion, token,
} from './fakes.js';
import type { GrantRow, Harness } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-02B — PUT manifest / SUBMIT over HTTP. Mock/unit only: FakeDb (transaction mock, B02 CHECK D-04 / N-03, FKs)
// + FakeAuth. No PostgreSQL: row-lock serialisation of concurrent requests is NOT_TESTED here (FBE-02C).

const TOKEN = token('manifestSessionToken');
const LIMIT = 262144;
const all = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID].map((permissionId) => ({ permissionId, row: VALID_ROLE }));
// insertVersionAudit parameter positions.
const VA = { moduleId: 1, versionId: 2, actor: 3, action: 4, targetType: 5, targetId: 6, outcome: 7, correlation: 8, metadata: 10 } as const;

function harness(grants: { permissionId: string; row: GrantRow }[] = all): Harness {
  const iam = defaultIam();
  iam.grants = grants.map((g) => ({ accountId: ACCOUNT_A, ...g }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return h;
}

function setup(grants?: { permissionId: string; row: GrantRow }[]) {
  const h = harness(grants);
  const m = seedModule(h.db, 'SALES');
  const v = seedVersion(h.db, m.module_id, '1.0.0');
  return { h, m, v };
}

const path = (moduleId: string, versionId: string) => `/api/foundation/modules/${moduleId}/versions/${versionId}`;
const sendJson = (h: Harness, method: 'put' | 'post', url: string, text: string) =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(text);
const put = (h: Harness, moduleId: string, versionId: string, body: unknown) => sendJson(h, 'put', `${path(moduleId, versionId)}/manifest`, JSON.stringify(body));
const putRaw = (h: Harness, moduleId: string, versionId: string, text: string) => sendJson(h, 'put', `${path(moduleId, versionId)}/manifest`, text);
const submit = (h: Harness, moduleId: string, versionId: string, body: unknown = {}) => sendJson(h, 'post', `${path(moduleId, versionId)}/submit`, JSON.stringify(body));
const row = (h: Harness, versionId: string) => h.db.state.versions.find((x) => x.version_id === versionId);
const txSql = (h: Harness) => h.db.statements.filter((s) => s.inTransaction).map((s) => s.sql);
const meta = (params: readonly unknown[] | undefined) => JSON.parse(String(params?.[VA.metadata]));

describe('FBE-02B body limits and raw JSON rules (P-1, P-14)', () => {
  it('PUT manifest accepts up to 262144 bytes (exact limit) and returns 413 above; other APIs keep 10 kB', async () => {
    const { h, m, v } = setup();
    const frame = JSON.stringify({ manifest: { pad: '' } }).length;
    const exact = JSON.stringify({ manifest: { pad: 'x'.repeat(LIMIT - frame) } });
    expect(Buffer.byteLength(exact)).toBe(LIMIT);
    const ok = await putRaw(h, m.module_id, v.version_id, exact);
    expect(ok.status).toBe(200);
    const over = JSON.stringify({ manifest: { pad: 'x'.repeat(LIMIT - frame + 1) } });
    const tooBig = await putRaw(h, m.module_id, v.version_id, over);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    // 11 kB to other endpoints (including SUBMIT and version create) → 413 from the global 10 kB parser.
    const eleven = JSON.stringify({ moduleKey: 'X', pad: 'x'.repeat(11 * 1024) });
    for (const url of ['/api/foundation/modules', `/api/foundation/modules/${m.module_id}/versions`, `${path(m.module_id, v.version_id)}/submit`]) {
      expect((await sendJson(h, 'post', url, eleven)).status, url).toBe(413);
    }
    // A 200 kB body on a non-PUT method of the manifest path is still limited to 10 kB.
    expect((await sendJson(h, 'post', `${path(m.module_id, v.version_id)}/manifest`, eleven)).status).toBe(413);
  });

  it('invalid JSON → 400 INVALID_JSON; duplicate keys (also escaped) → 400 VALIDATION_ERROR; nothing written', async () => {
    const { h, m, v } = setup();
    expect((await putRaw(h, m.module_id, v.version_id, '{"manifest": {')).body.error.code).toBe('INVALID_JSON');
    for (const text of ['{"manifest":{"a":1,"a":2}}', '{"manifest":{"a":1,"\\u0061":2}}', '{"manifest":{"x":[{"k":1,"k":2}]}}', '{"manifest":{},"manifest":null}']) {
      const res = await putRaw(h, m.module_id, v.version_id, text);
      expect(res.status, text).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(h.db.txLog).toEqual([]);
    expect(row(h, v.version_id)?.manifest_json).toBeNull();
  });

  it('unsafe integers, real numbers, lone surrogates (value / key) and wrong body shapes → 400; nothing repaired or written', async () => {
    const { h, m, v } = setup();
    const texts = [
      '{"manifest":{"n":9007199254740993}}', '{"manifest":{"n":1.5}}', '{"manifest":{"n":1e300}}', '{"manifest":{"s":"\\ud800"}}',
      '{"manifest":{"\\udc00":1}}', '{"manifest":[1]}', '{"manifest":"text"}', '{"manifest":1}', '{}', '{"manifest":{},"extra":1}', '[{"manifest":{}}]',
    ];
    for (const text of texts) expect((await putRaw(h, m.module_id, v.version_id, text)).status, text).toBe(400);
    expect(h.db.txLog).toEqual([]);
  });

  it('authorisation before validation: without UPDATE, a duplicate-key / unknown-version body gets 403 + DENIED, never 400/404', async () => {
    const { h, m, v } = setup([{ permissionId: PERM_VREAD_ID, row: VALID_ROLE }, { permissionId: PERM_VSUBMIT_ID, row: VALID_ROLE }]);
    for (const res of [
      await putRaw(h, m.module_id, v.version_id, '{"manifest":{"a":1,"a":2}}'), await put(h, randomUUID(), randomUUID(), { manifest: {} }),
      await put(h, m.module_id, v.version_id, { manifest: validMic() }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(h.db.state.audits.map((a) => [a[3], a[4], a[5], a[1], a[6]])).toEqual(Array.from({ length: 3 }, () => ['MODULE_VERSION.UPDATE_MANIFEST', 'MODULE_VERSION', null, null, 'DENIED']));
    const noSubmit = setup([{ permissionId: PERM_VUPDATE_ID, row: VALID_ROLE }]);
    const res = await submit(noSubmit.h, noSubmit.m.module_id, noSubmit.v.version_id, { expectedManifestHash: 'bad' });
    expect(res.status).toBe(403);
    expect(noSubmit.h.db.state.audits[0]?.[3]).toBe('MODULE_VERSION.SUBMIT');
  });
});

describe('FBE-02B PUT manifest (DRAFT)', () => {
  it('stores manifest_json, keeps manifest_hash NULL, status unchanged; lock → UPDATE → B08 SUCCESS in one transaction', async () => {
    const { h, m, v } = setup();
    const partial = { mic01Identity: { moduleKey: 'SALES' }, draftNote: 'incomplete is fine in DRAFT' };
    const res = await put(h, m.module_id, v.version_id, { manifest: partial });
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ versionId: v.version_id, status: 'DRAFT', manifestJson: partial, manifestHash: null });
    expect(row(h, v.version_id)).toMatchObject({ status: 'DRAFT', manifest_json: partial, manifest_hash: null });
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT']);
    expect(txSql(h)).toEqual([MANIFEST_SQL.lockVersion, MANIFEST_SQL.updateManifest, VERSION_SQL.insertVersionAudit]);
    const [audit] = h.db.state.versionAudits;
    expect([audit?.[VA.moduleId], audit?.[VA.versionId], audit?.[VA.actor], audit?.[VA.action], audit?.[VA.targetType], audit?.[VA.targetId], audit?.[VA.outcome]])
      .toEqual([m.module_id, v.version_id, ACCOUNT_A, 'MODULE_VERSION.UPDATE_MANIFEST', 'MODULE_VERSION', v.version_id, 'SUCCESS']);
    expect(meta(audit)).toEqual({ v: 1, reason: 'MANIFEST_UPDATED', requestId: res.headers['x-request-id'] });
    expect(audit?.[VA.correlation]).toBe(res.headers['x-request-id']);
    expect(h.db.state.events).toHaveLength(0); // no B07 for PUT
  });

  it('{manifest: null} clears the draft to SQL NULL (not JSON null); audit reason MANIFEST_CLEARED', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, { manifest: { a: 1 } });
    const res = await put(h, m.module_id, v.version_id, { manifest: null });
    expect(res.status).toBe(200);
    expect(res.body.version.manifestJson).toBeNull();
    expect(h.db.statements.filter((s) => s.sql === MANIFEST_SQL.updateManifest).map((s) => s.params[2])).toEqual(['{"a":1}', null]);
    expect(row(h, v.version_id)?.manifest_json).toBeNull();
    expect(meta(h.db.state.versionAudits[1]).reason).toBe('MANIFEST_CLEARED');
  });

  it('PUT on a non-DRAFT version → 409 VERSION_NOT_DRAFT; another module path → 404; other versions untouched', async () => {
    const { h, m, v } = setup();
    const other = seedModule(h.db, 'STOCK');
    const ov = seedVersion(h.db, other.module_id, '1.0.0');
    for (const status of ['IN_REVIEW', 'APPROVED', 'REJECTED']) {
      const s = seedVersion(h.db, m.module_id, status === 'IN_REVIEW' ? '2.0.0' : status === 'APPROVED' ? '3.0.0' : '4.0.0', status);
      const res = await put(h, m.module_id, s.version_id, { manifest: { a: 1 } });
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_NOT_DRAFT');
      expect(row(h, s.version_id)?.manifest_json).toEqual({ seeded: true });
    }
    const cross = await put(h, m.module_id, ov.version_id, { manifest: { a: 1 } });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('VERSION_NOT_FOUND');
    expect(row(h, ov.version_id)?.manifest_json).toBeNull();
    expect(row(h, v.version_id)?.manifest_json).toBeNull();
    expect(h.db.state.versionAudits).toHaveLength(0);
  });

  it('B08 SUCCESS fails → 503 and the UPDATE is rolled back', async () => {
    const { h, m, v } = setup();
    h.db.failOn.set(VERSION_SQL.insertVersionAudit, pgError('23514'));
    const res = await put(h, m.module_id, v.version_id, { manifest: { a: 1 } });
    expect(res.status).toBe(503);
    expect(h.db.txLog).toEqual(['BEGIN', 'ROLLBACK']);
    expect(row(h, v.version_id)?.manifest_json).toBeNull();
  });
});

describe('FBE-02B SUBMIT (DRAFT → IN_REVIEW)', () => {
  it('valid MIC → 200 IN_REVIEW; server hash of the stored MIC; B02 + B07 SUBMIT + B08 SUCCESS in one transaction', async () => {
    const { h, m, v } = setup();
    const mic = validMic();
    expect((await put(h, m.module_id, v.version_id, { manifest: mic })).status).toBe(200);
    const statementsBefore = h.db.statements.length;
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(200);
    const hash = canonicalDigest(mic).sha256;
    expect(res.body.version).toMatchObject({ status: 'IN_REVIEW', manifestHash: hash, submittedByAccountId: ACCOUNT_A, manifestJson: mic });
    expect(row(h, v.version_id)).toMatchObject({ status: 'IN_REVIEW', manifest_hash: hash, submitted_by_account_id: ACCOUNT_A });
    // FBE-03: B03/B04 identities (function_key then action_key order: ORDER, REPORT / CREATE, READ), then B05/B06 in MIC
    // order, all before the status change; B07 / B08 unchanged.
    const R = REGISTRY_SQL;
    expect(h.db.statements.slice(statementsBefore).filter((s) => s.inTransaction).map((s) => s.sql)).toEqual([
      MANIFEST_SQL.lockVersion, MANIFEST_SQL.otherVersions,
      R.insertFunction, R.selectFunction, R.insertFunction, R.selectFunction,
      R.insertAction, R.selectAction, R.insertAction, R.selectAction, R.insertAction, R.selectAction,
      R.insertVersionFunction, R.insertVersionAction, R.insertVersionAction, R.insertVersionFunction, R.insertVersionAction,
      MANIFEST_SQL.submitVersion, MANIFEST_SQL.insertSubmitEvent, VERSION_SQL.insertVersionAudit,
    ]);
    expect(h.db.txLog).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    const [event] = h.db.state.events;
    expect(event?.slice(0, 4)).toEqual(['SUBMIT', m.module_id, v.version_id, ACCOUNT_A]);
    expect(JSON.parse(String(event?.[4]))).toEqual({ status: 'DRAFT' });
    expect(JSON.parse(String(event?.[5]))).toEqual({ status: 'IN_REVIEW', manifest_hash: hash });
    expect(event?.[6]).toBe(res.headers['x-request-id']);
    const audit = h.db.state.versionAudits[1];
    expect([audit?.[VA.action], audit?.[VA.outcome], audit?.[VA.targetId], audit?.[VA.versionId]]).toEqual(['MODULE_VERSION.SUBMIT', 'SUCCESS', v.version_id, v.version_id]);
    expect(meta(audit)).toEqual({ v: 1, reason: 'SUBMITTED', requestId: res.headers['x-request-id'], manifestHash: hash });
  });

  it('expectedManifestHash: same data in another key order matches (200); mismatch → 409 rolled back; bad format → 400', async () => {
    const mic = validMic();
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(mic).reverse())));
    const hash = canonicalDigest(reordered).sha256;
    const ok = setup();
    await put(ok.h, ok.m.module_id, ok.v.version_id, { manifest: mic });
    expect((await submit(ok.h, ok.m.module_id, ok.v.version_id, { expectedManifestHash: hash })).status).toBe(200);

    const bad = setup();
    await put(bad.h, bad.m.module_id, bad.v.version_id, { manifest: mic });
    const res = await submit(bad.h, bad.m.module_id, bad.v.version_id, { expectedManifestHash: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MANIFEST_HASH_MISMATCH');
    expect(row(bad.h, bad.v.version_id)).toMatchObject({ status: 'DRAFT', manifest_hash: null });
    expect(bad.h.db.state.events).toHaveLength(0);
    for (const body of [{ expectedManifestHash: hash.toUpperCase() }, { expectedManifestHash: 'abc' }, { expectedManifestHash: 1 }, { other: 1 }]) {
      const r = await submit(bad.h, bad.m.module_id, bad.v.version_id, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('invalid MIC → 422 MIC_INVALID with codes; B08 FAILURE outside the rolled-back transaction, no MIC content', async () => {
    const { h, m, v } = setup();
    const mic = validMic();
    const broken = { ...mic, mic04Navigation: [{ menuLabel: 'SECRET-MARKER', functionKey: 'GHOST' }], mic07IamMapping: mic.mic07IamMapping.slice(1) };
    await put(h, m.module_id, v.version_id, { manifest: broken });
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'MIC_INVALID', details: { errors: ['NAVIGATION_FUNCTION_UNKNOWN', 'IAM_MAPPING_MISSING'] } });
    expect(row(h, v.version_id)).toMatchObject({ status: 'DRAFT', manifest_hash: null, submitted_by_account_id: null });
    expect(h.db.txLog.slice(-2)).toEqual(['BEGIN', 'ROLLBACK']);
    const failure = h.db.state.versionAudits[1];
    expect([failure?.[VA.moduleId], failure?.[VA.versionId], failure?.[VA.action], failure?.[VA.targetType], failure?.[VA.targetId], failure?.[VA.outcome]])
      .toEqual([m.module_id, v.version_id, 'MODULE_VERSION.SUBMIT', 'MODULE_VERSION', v.version_id, 'FAILURE']);
    expect(meta(failure)).toEqual({ v: 1, reason: 'MIC_INVALID', errors: ['NAVIGATION_FUNCTION_UNKNOWN', 'IAM_MAPPING_MISSING'], requestId: res.headers['x-request-id'] });
    expect(JSON.stringify(failure)).not.toContain('SECRET-MARKER');
    const failureStatement = h.db.statements.filter((s) => s.sql === VERSION_SQL.insertVersionAudit).at(-1);
    expect(failureStatement?.inTransaction).toBe(false);
    expect(h.db.state.events).toHaveLength(0);
  });

  it('missing / schema-invalid MIC → 422 MIC_SCHEMA_INVALID; cross-reference errors → 422 with their codes', async () => {
    const cases: { manifest: unknown; errors: string[] }[] = [
      { manifest: null, errors: ['MIC_SCHEMA_INVALID'] },
      { manifest: { mic01Identity: validMic().mic01Identity }, errors: ['MIC_SCHEMA_INVALID'] },
      { manifest: { ...validMic(), mic05Api: [{ method: 'GET', path: '/x', functionKey: 'REPORT', actionKey: 'CREATE', errors: [] }] }, errors: ['API_ACTION_UNKNOWN'] },
      { manifest: { ...validMic(), mic07IamMapping: validMic().mic07IamMapping.map((x) => ({ ...x, moduleCode: 'OTHER' })) }, errors: ['IAM_MAPPING_K05_MISMATCH'] },
      { manifest: { ...validMic(), mic01Identity: { ...validMic().mic01Identity, moduleKey: 'STOCK' } }, errors: ['IDENTITY_MODULE_KEY_MISMATCH', 'IAM_MAPPING_K05_MISMATCH'] },
    ];
    for (const c of cases) {
      const { h, m, v } = setup();
      if (c.manifest !== null) await put(h, m.module_id, v.version_id, { manifest: c.manifest });
      const res = await submit(h, m.module_id, v.version_id);
      expect(res.status, JSON.stringify(c.errors)).toBe(422);
      expect(res.body.error.details.errors).toEqual(c.errors);
    }
  });

  it('MIC-09 against the real history: INITIAL after an APPROVED version → 422; CHANGE from it → 200', async () => {
    const h = harness();
    const m = seedModule(h.db, 'SALES');
    seedVersion(h.db, m.module_id, '1.0.0', 'APPROVED');
    const v = seedVersion(h.db, m.module_id, '2.0.0');
    await put(h, m.module_id, v.version_id, { manifest: validMic('SALES', '2.0.0') });
    const initial = await submit(h, m.module_id, v.version_id);
    expect(initial.status).toBe(422);
    expect(initial.body.error.details.errors).toEqual(['COMPATIBILITY_KIND_INVALID']);
    const change = { ...validMic('SALES', '2.0.0'), mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['Thêm báo cáo'] } };
    await put(h, m.module_id, v.version_id, { manifest: change });
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
  });

  it('FAILURE audit write fails → 503 (not 422); version unchanged', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, { manifest: { incomplete: true } });
    h.db.failOn.set(VERSION_SQL.insertVersionAudit, pgError('42501'));
    const res = await submit(h, m.module_id, v.version_id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_BUSY');
    expect(row(h, v.version_id)?.status).toBe('DRAFT');
    expect(h.logs.some((l) => l.includes('MIC_INVALID FAILURE audit write failed'))).toBe(true);
  });

  it('B07 SUBMIT fails → B02 rolled back; B08 SUCCESS fails → B02 + B07 rolled back', async () => {
    for (const failing of [MANIFEST_SQL.insertSubmitEvent, VERSION_SQL.insertVersionAudit]) {
      const { h, m, v } = setup();
      await put(h, m.module_id, v.version_id, { manifest: validMic() });
      const auditsBefore = h.db.state.versionAudits.length;
      h.db.failOn.set(failing, pgError('23503'));
      const res = await submit(h, m.module_id, v.version_id);
      expect(res.status).toBe(503);
      expect(row(h, v.version_id)).toMatchObject({ status: 'DRAFT', manifest_hash: null, submitted_by_account_id: null });
      expect(h.db.state.events).toHaveLength(0);
      expect(h.db.state.versionAudits).toHaveLength(auditsBefore);
      expect(h.db.txLog.slice(-2)).toEqual(['BEGIN', 'ROLLBACK']);
    }
  });

  it('after IN_REVIEW: SUBMIT again → 409, PUT → 409 (MIC locked); unknown version → 404', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, { manifest: validMic() });
    expect((await submit(h, m.module_id, v.version_id)).status).toBe(200);
    const again = await submit(h, m.module_id, v.version_id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('VERSION_NOT_DRAFT');
    const edit = await put(h, m.module_id, v.version_id, { manifest: { changed: true } });
    expect(edit.status).toBe(409);
    expect(row(h, v.version_id)?.manifest_json).toEqual(validMic());
    expect(h.db.state.events).toHaveLength(1);
    expect((await submit(h, m.module_id, randomUUID())).status).toBe(404);
    expect((await submit(h, m.module_id, 'nope')).status).toBe(404);
  });

  it('concurrency (mock): both flows lock the row first and re-check DRAFT in the UPDATE; a status change between lock and UPDATE → 409 + rollback', async () => {
    // Simulates a competing transaction that changed the row (what the PostgreSQL row lock prevents; real DB: FBE-02C).
    const flip = (versionId: string) => (state: { versions: { version_id: string; status: string }[] }) => {
      const i = state.versions.findIndex((x) => x.version_id === versionId);
      const current = state.versions[i];
      if (current) state.versions[i] = { ...current, status: 'IN_REVIEW' };
    };
    const a = setup();
    await put(a.h, a.m.module_id, a.v.version_id, { manifest: validMic() });
    a.h.db.before.set(MANIFEST_SQL.submitVersion, flip(a.v.version_id));
    const s = await submit(a.h, a.m.module_id, a.v.version_id);
    expect(s.status).toBe(409);
    expect(a.h.db.txLog.slice(-2)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(a.h.db.state.events).toHaveLength(0);
    expect(row(a.h, a.v.version_id)?.status).toBe('DRAFT'); // the flip happened in the rolled-back staged copy

    const b = setup();
    b.h.db.before.set(MANIFEST_SQL.updateManifest, flip(b.v.version_id));
    const p = await put(b.h, b.m.module_id, b.v.version_id, { manifest: { a: 1 } });
    expect(p.status).toBe(409);
    expect(row(b.h, b.v.version_id)?.manifest_json).toBeNull();
    expect(b.h.db.state.versionAudits).toHaveLength(0);
    for (const sql of [MANIFEST_SQL.updateManifest, MANIFEST_SQL.submitVersion]) expect(sql).toMatch(/AND v\.status = 'DRAFT'/);
    expect(MANIFEST_SQL.lockVersion).toMatch(/FOR UPDATE OF v/);
  });
});

describe('FBE-02B scope', () => {
  it('fixed SQL only; MANIFEST_SQL updates only B02 DRAFT rows, inserts only B07 SUBMIT; REGISTRY_SQL inserts only B03–B06; no DELETE / IAM / B09–B14', async () => {
    const { h, m, v } = setup();
    await put(h, m.module_id, v.version_id, { manifest: validMic() });
    await submit(h, m.module_id, v.version_id);
    const known = new Set<string>([...Object.values(FOUNDATION_SQL), ...Object.values(VERSION_SQL), ...Object.values(MANIFEST_SQL), ...Object.values(REGISTRY_SQL)]);
    // FBE-03: the registry statements touch exactly B03–B06, INSERT / SELECT only.
    for (const sql of Object.values(REGISTRY_SQL)) {
      expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|GRANT|ALTER|DROP|CREATE)\b/i);
      expect(sql).not.toMatch(/\biam\./i);
      expect(sql).not.toMatch(/fnd_(modules|module_versions|module_events|audit_logs|navigation_items|data_|compatibility_)/);
    }
    expect(Object.values(REGISTRY_SQL).map((sql) => /^\s*INSERT INTO (\S+)/.exec(sql)?.[1]).filter((t) => t !== undefined))
      .toEqual(['foundation.fnd_functions', 'foundation.fnd_actions', 'foundation.fnd_version_functions', 'foundation.fnd_version_actions']);
    for (const s of h.db.statements) expect(known.has(s.sql)).toBe(true);
    for (const sql of Object.values(MANIFEST_SQL)) {
      expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|GRANT|ALTER|DROP|CREATE)\b/i);
      expect(sql).not.toMatch(/\biam\./i);
      expect(sql).not.toMatch(/fnd_(functions|actions|version_functions|version_actions|navigation_items|data_|compatibility_)/);
    }
    // Write statements only (a statement starting with UPDATE / INSERT INTO; "FOR UPDATE OF v" is a row lock, not a write).
    expect(Object.values(MANIFEST_SQL).map((sql) => /^\s*(?:UPDATE|INSERT INTO) (\S+)/.exec(sql)?.[1]).filter((t) => t !== undefined))
      .toEqual(['foundation.fnd_module_versions', 'foundation.fnd_module_versions', 'foundation.fnd_module_events']);
    expect(MANIFEST_SQL.insertSubmitEvent).toContain("'SUBMIT'");
  });
});
