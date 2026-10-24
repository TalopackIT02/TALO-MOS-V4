import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/modules/foundation/foundation.access.js';
import { LIFECYCLE_SQL } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import {
  ACCOUNT_A, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_DISABLE_ID, PERM_ENABLE_ID, PERM_REJECT_ID, PERM_RETIRE_ID, PERM_VCREATE_ID, PERM_VREAD_ID,
  PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, seedModule, seedVersion, token,
} from './fakes.js';
import type { Harness, ModuleRow, VersionRow } from './fakes.js';
import { validMic } from './mic.fixture.js';

// REV01-D1 — Lifecycle recoverUpgrade: the controlled inverse of ONE activation (internal, installer only). Mock/unit:
// the real service + SQL repository over FakeDb (B02 D-06 CHECK, one-ACTIVE index, B07 N-08, transaction rollback).

const TOKEN = token('recoverySessionToken');
const ALL = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, PERM_APPROVE_ID, PERM_REJECT_ID, PERM_ACTIVATE_ID, PERM_RETIRE_ID, PERM_ENABLE_ID, PERM_DISABLE_ID];
const ACTOR: Actor = { userAccountId: ACCOUNT_A, assuranceLevel: 1, requestId: 'req-recovery' };
const INSTALL = '7a1f0000-0000-4000-8000-0000000000aa';

function setup(perms = ALL) {
  const iam = defaultIam();
  iam.grants = perms.map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return { h, m: seedModule(h.db, 'SALES') };
}
const send = (h: Harness, url: string, body: unknown = {}, method: 'post' | 'put' = 'post') =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const vurl = (m: ModuleRow, v: VersionRow, action: string) => `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/${action}`;
function mic(version: string, from?: string) {
  const x = validMic('SALES', version);
  return { ...x, mic06DataResources: x.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB'), ...(from ? { mic09Compatibility: { kind: 'CHANGE', fromVersion: from, changes: ['x'] } } : {}) };
}
async function activeVersion(h: Harness, m: ModuleRow, version: string, from?: string) {
  const v = seedVersion(h.db, m.module_id, version);
  expect((await send(h, `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest: mic(version, from) }, 'put')).status).toBe(200);
  for (const step of ['submit', 'approve']) expect((await send(h, vurl(m, v, step))).status).toBe(200);
  const prior = h.db.state.versions.find((x) => x.module_id === m.module_id && x.status === 'ACTIVE');
  const res = await send(h, vurl(m, v, 'activate'));
  expect(res.status).toBe(200);
  return { v, activatedAt: String(res.body.version.activatedAt), retired: prior && status(h, prior.version_id) === 'RETIRED' ? prior.version_id : undefined };
}
const status = (h: Harness, id: string) => h.db.state.versions.find((x) => x.version_id === id)?.status;
const fingerprint = (h: Harness) => JSON.stringify([h.db.state.versions, h.db.state.events, h.db.state.versionAudits]);

describe('REV01-D1 Lifecycle recoverUpgrade (internal)', () => {
  it('R1 restores the ACTIVE version retired by the activation: failed → RETIRED, old → ACTIVE, exactly one ACTIVE, B07 RETIRE + ROLLBACK, B08 ROLLBACK with installId, one transaction', async () => {
    const { h, m } = setup();
    const one = await activeVersion(h, m, '1.0.0');
    const two = await activeVersion(h, m, '1.1.0', '1.0.0');
    expect(two.retired).toBe(one.v.version_id);
    const events = h.db.state.events.length;
    const audits = h.db.state.versionAudits.length;
    const tx = h.db.txLog.length;
    const res = await h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL });
    expect([res.version.versionId, res.version.status, res.retired?.versionId, res.retired?.status]).toEqual([one.v.version_id, 'ACTIVE', two.v.version_id, 'RETIRED']);
    expect([status(h, one.v.version_id), status(h, two.v.version_id)]).toEqual(['ACTIVE', 'RETIRED']);
    expect(h.db.state.versions.filter((x) => x.module_id === m.module_id && x.status === 'ACTIVE')).toHaveLength(1);
    // activated_at of the first activation is kept (D-06), nothing re-dated
    expect(h.db.state.versions.find((x) => x.version_id === one.v.version_id)?.activated_at).toBe(one.activatedAt);
    expect(h.db.state.events.slice(events).map((e) => [e[2], e[3], JSON.parse(String(e[5])), JSON.parse(String(e[6]))])).toEqual([
      [two.v.version_id, 'RETIRE', { status: 'ACTIVE' }, { status: 'RETIRED' }],
      [one.v.version_id, 'ROLLBACK', { status: 'RETIRED' }, { status: 'ACTIVE' }],
    ]);
    const audit = h.db.state.versionAudits.slice(audits);
    expect(audit).toHaveLength(1);
    expect([audit[0]?.[4], audit[0]?.[7]]).toEqual(['MODULE_VERSION.ROLLBACK', 'SUCCESS']);
    expect(JSON.parse(String(audit[0]?.[10]))).toMatchObject({ failedVersionId: two.v.version_id, installId: INSTALL });
    expect(h.db.txLog.slice(tx)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('R2 proof mismatch (another activated_at = a later activation) → 409 RECOVERY_PROOF_MISMATCH; restore not RETIRED → VERSION_STATE_CONFLICT; nothing changed', async () => {
    const { h, m } = setup();
    const one = await activeVersion(h, m, '1.0.0');
    const two = await activeVersion(h, m, '1.1.0', '1.0.0');
    const before = fingerprint(h);
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: '2026-01-01T00:00:00.000000Z', installId: INSTALL }))
      .rejects.toMatchObject({ status: 409, code: 'RECOVERY_PROOF_MISMATCH' });
    // the ACTIVE one as "failed" with itself as restore, or a restore that is not RETIRED
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: two.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ code: 'RECOVERY_PROOF_MISMATCH' });
    const draft = seedVersion(h.db, m.module_id, '1.2.0');
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: draft.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ code: 'VERSION_STATE_CONFLICT' });
    // failed version no longer ACTIVE (already recovered / retired) → refused, no second rollback
    await h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL });
    const after = fingerprint(h);
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ code: 'VERSION_STATE_CONFLICT' });
    expect(fingerprint(h)).toBe(after);
    expect(before).not.toBe(after);
  });

  it('R3 a write failing midway (B08 insert) rolls the whole recovery back: both versions unchanged, no B07 row', async () => {
    const { h, m } = setup();
    const one = await activeVersion(h, m, '1.0.0');
    const two = await activeVersion(h, m, '1.1.0', '1.0.0');
    const before = fingerprint(h);
    h.db.failOn.set(LIFECYCLE_SQL.reactivateVersion, new Error('connection lost'));
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ status: 503 });
    expect(fingerprint(h)).toBe(before);
    expect(h.db.txLog.at(-1)).toBe('ROLLBACK');
    expect([status(h, one.v.version_id), status(h, two.v.version_id)]).toEqual(['RETIRED', 'ACTIVE']);
  });

  it('R4 needs ACTIVATE and RETIRE (403 + B08 DENIED); a tampered restore manifest is refused (422 MANIFEST_INTEGRITY_INVALID)', async () => {
    const { h, m } = setup(ALL.filter((p) => p !== PERM_RETIRE_ID));
    const one = await activeVersion(h, m, '1.0.0');
    const two = await activeVersion(h, m, '1.1.0', '1.0.0');
    await expect(h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: m.module_id, failedVersionId: two.v.version_id, restoreVersionId: one.v.version_id, failedActivatedAt: two.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ status: 403 });
    expect(h.db.state.audits.at(-1)?.[3]).toBe('MODULE_VERSION.ROLLBACK');
    const full = setup();
    const a = await activeVersion(full.h, full.m, '1.0.0');
    const b = await activeVersion(full.h, full.m, '1.1.0', '1.0.0');
    full.h.db.state.versions = full.h.db.state.versions.map((x) => (x.version_id === a.v.version_id ? { ...x, manifest_hash: 'e'.repeat(64) } : x));
    await expect(full.h.lifecycleService.recoverUpgrade(ACTOR, { moduleId: full.m.module_id, failedVersionId: b.v.version_id, restoreVersionId: a.v.version_id, failedActivatedAt: b.activatedAt, installId: INSTALL }))
      .rejects.toMatchObject({ status: 422, errors: ['MANIFEST_INTEGRITY_INVALID'] });
    expect(status(full.h, b.v.version_id)).toBe('ACTIVE');
  });

  it('R5 no generic RETIRED → ACTIVE: there is no HTTP route, and ACTIVATE of a RETIRED version stays refused', async () => {
    const { h, m } = setup();
    const one = await activeVersion(h, m, '1.0.0');
    await activeVersion(h, m, '1.1.0', '1.0.0');
    for (const action of ['rollback', 'recover', 'reactivate', 'restore']) expect((await send(h, vurl(m, one.v, action))).status).toBe(404);
    const res = await send(h, vurl(m, one.v, 'activate'));
    expect([res.status, res.body.error.code]).toEqual([409, 'VERSION_STATE_CONFLICT']);
    expect(status(h, one.v.version_id)).toBe('RETIRED');
  });
});
