import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { LIFECYCLE_SQL, mic04Routes } from '../../../src/modules/foundation/foundation.lifecycle.repository.js';
import { VERSION_SQL } from '../../../src/modules/foundation/foundation.versions.repository.js';
import {
  ACCOUNT_A, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_DISABLE_ID, PERM_ENABLE_ID, PERM_REJECT_ID, PERM_RETIRE_ID, PERM_VCREATE_ID, PERM_VREAD_ID,
  PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, seedModule, seedVersion, token,
} from './fakes.js';
import type { FakeDb, Harness, ModuleRow, VersionRow } from './fakes.js';
import { validMic } from './mic.fixture.js';

// REV01-D3 — route conflict guard on ENABLE (Lifecycle Service). Mock/unit: real service + repository over FakeDb.

const TOKEN = token('routeGuardSessionToken');
const ALL = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, PERM_APPROVE_ID, PERM_REJECT_ID, PERM_ACTIVATE_ID, PERM_RETIRE_ID, PERM_ENABLE_ID, PERM_DISABLE_ID];

function setup() {
  const iam = defaultIam();
  iam.grants = ALL.map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return h;
}
const send = (h: Harness, url: string, body: unknown = {}, method: 'post' | 'put' = 'post') =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const murl = (m: ModuleRow, action: string) => `/api/foundation/modules/${m.module_id}/${action}`;
const vurl = (m: ModuleRow, v: VersionRow, action: string) => `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/${action}`;
const mod = (h: Harness, m: ModuleRow) => h.db.state.modules.find((x) => x.module_id === m.module_id);

function micWithRoutes(moduleKey: string, routes: string[]) {
  const mic = validMic(moduleKey, '1.0.0');
  return {
    ...mic,
    mic06DataResources: mic.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB'),
    mic04Navigation: [{ menuLabel: 'Nhóm' }, ...routes.map((routePath, i) => ({ menuLabel: `Màn ${i}`, routePath, screenKey: `s.${i}`, functionKey: 'ORDER' }))],
  };
}
// The module under test goes through the real lifecycle (manifest → submit → approve → activate).
async function activeModule(h: Harness, moduleKey: string, routes: string[]): Promise<ModuleRow> {
  const m = seedModule(h.db, moduleKey);
  const v = seedVersion(h.db, m.module_id, '1.0.0');
  expect((await send(h, `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest: micWithRoutes(moduleKey, routes) }, 'put')).status).toBe(200);
  for (const step of ['submit', 'approve', 'activate']) expect((await send(h, vurl(m, v, step))).status).toBe(200);
  return m;
}
// Another module already present in B01/B02 (fixture rows), with its own status and enable flag.
function holder(db: FakeDb, moduleKey: string, routes: string[], opts: { enabled: boolean; status?: string }) {
  const m = seedModule(db, moduleKey);
  const mic = micWithRoutes(moduleKey, routes);
  db.state.modules = db.state.modules.map((x) => (x.module_id === m.module_id ? { ...x, is_enabled: opts.enabled } : x));
  db.state.versions.push({
    ...seedVersion(db, m.module_id, '1.0.0', opts.status ?? 'ACTIVE'), manifest_json: mic, manifest_hash: canonicalDigest(mic).sha256,
    activated_at: '2026-10-17T07:30:00.000000Z',
  });
  db.state.versions = db.state.versions.filter((x, i, all) => all.findLastIndex((y) => y.version_id === x.version_id) === i);
  return m;
}
const fingerprint = (h: Harness) => JSON.stringify({ modules: h.db.state.modules, events: h.db.state.events, audits: h.db.state.audits, versions: h.db.state.versions });

describe('REV01-D3 route conflict guard on ENABLE', () => {
  it('D3-1 a route held by another ACTIVE + ENABLED module → 409 MODULE_ROUTE_CONFLICT with route@module; is_enabled, B07, B08 unchanged', async () => {
    const h = setup();
    const m = await activeModule(h, 'SALES', ['/sales/orders']);
    holder(h.db, 'OTHER', ['/sales/orders'], { enabled: true });
    const before = fingerprint(h);
    const res = await send(h, murl(m, 'enable'));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'MODULE_ROUTE_CONFLICT', details: { errors: ['/sales/orders@OTHER'] } });
    expect(mod(h, m)?.is_enabled).toBe(false);
    expect(fingerprint(h)).toBe(before); // no ENABLE event, no B08 row (gate refusal policy), nothing committed
    expect(h.db.txLog.at(-1)).toBe('ROLLBACK');
  });

  it('D3-2 FBET-style: /system-test and /system-test/runner both reported, sorted, with every holding module', async () => {
    const h = setup();
    const m = await activeModule(h, 'SYSTEM_TEST', ['/system-test', '/system-test/runner', '/system-test/runner']);
    holder(h.db, 'FBET_B', ['/system-test/runner'], { enabled: true });
    holder(h.db, 'FBET_A', ['/system-test'], { enabled: true });
    const res = await send(h, murl(m, 'enable'));
    expect(res.status).toBe(409);
    expect(res.body.error.details.errors).toEqual(['/system-test@FBET_A', '/system-test/runner@FBET_B']);
    expect(mod(h, m)?.is_enabled).toBe(false);
  });

  it('D3-3 not a conflict: holder disabled, holder only RETIRED / APPROVED, distinct route, module without routes', async () => {
    const h = setup();
    holder(h.db, 'OFF', ['/a'], { enabled: false });
    holder(h.db, 'OLD', ['/a'], { enabled: true, status: 'RETIRED' });
    holder(h.db, 'NEXT', ['/a'], { enabled: true, status: 'APPROVED' });
    holder(h.db, 'ELSE', ['/b'], { enabled: true });
    const m = await activeModule(h, 'SALES', ['/a']);
    expect((await send(h, murl(m, 'enable'))).status).toBe(200);
    expect(mod(h, m)?.is_enabled).toBe(true);
    const n = await activeModule(h, 'BARE', []);
    expect((await send(h, murl(n, 'enable'))).status).toBe(200);
  });

  it('D3-4 the module itself is excluded: DISABLE then ENABLE again with its own route stays allowed', async () => {
    const h = setup();
    const m = await activeModule(h, 'SALES', ['/sales/orders']);
    expect((await send(h, murl(m, 'enable'))).status).toBe(200);
    expect((await send(h, murl(m, 'disable'))).status).toBe(200);
    expect((await send(h, murl(m, 'enable'))).status).toBe(200);
  });

  it('D3-5 competing ENABLEs: the route lock is taken inside the transaction before the holders read; the second one is refused', async () => {
    const h = setup();
    const a = await activeModule(h, 'ALPHA', ['/shared']);
    const b = await activeModule(h, 'BETA', ['/shared']);
    const [ra, rb] = await Promise.all([send(h, murl(a, 'enable')), send(h, murl(b, 'enable'))]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect([mod(h, a)?.is_enabled, mod(h, b)?.is_enabled].filter(Boolean)).toHaveLength(1);
    const inTx = h.db.statements.filter((s) => s.inTransaction).map((s) => s.sql);
    const lock = inTx.indexOf(LIFECYCLE_SQL.lockRouteClaims);
    expect(lock).toBeGreaterThan(inTx.indexOf(VERSION_SQL.lockModuleVersions)); // module lock first, then the single route key
    expect(inTx.indexOf(LIFECYCLE_SQL.routeHolders, lock)).toBeGreaterThan(lock);
    expect(h.db.statements.filter((s) => s.sql === LIFECYCLE_SQL.lockRouteClaims).every((s) => s.inTransaction)).toBe(true);
    expect(LIFECYCLE_SQL.lockRouteClaims).toMatch(/pg_advisory_xact_lock/); // released by COMMIT / ROLLBACK, never leaks
  });

  it('D3-6 DISABLE never takes the route lock; the holders SQL reads ACTIVE + ENABLED other modules only', async () => {
    const h = setup();
    const m = await activeModule(h, 'SALES', ['/x']);
    await send(h, murl(m, 'enable'));
    const n = h.db.statements.length;
    await send(h, murl(m, 'disable'));
    expect(h.db.statements.slice(n).some((s) => s.sql === LIFECYCLE_SQL.lockRouteClaims)).toBe(false);
    expect(LIFECYCLE_SQL.routeHolders).toMatch(/v\.status = 'ACTIVE'/);
    expect(LIFECYCLE_SQL.routeHolders).toMatch(/m\.is_enabled AND m\.module_id <> \$1::uuid/);
    expect(mic04Routes({ mic04Navigation: [{ routePath: '/a' }, { routePath: ' ' }, { menuLabel: 'g' }, { routePath: '/a' }] })).toEqual(['/a']);
    expect(mic04Routes(null)).toEqual([]);
  });
});
