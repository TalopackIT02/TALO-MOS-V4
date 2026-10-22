import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { buildMenu, menuCandidates } from '../../../src/modules/foundation/foundation.navigation.js';
import type { NavigationItem } from '../../../src/modules/foundation/foundation.navigation.js';
import { NAVIGATION_SQL } from '../../../src/modules/foundation/foundation.navigation.repository.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import {
  ACCOUNT_A, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_DISABLE_ID, PERM_ENABLE_ID, PERM_NAV_ID, PERM_REJECT_ID, PERM_RETIRE_ID, PERM_VCREATE_ID,
  PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_DIRECT_ALLOW, VALID_DIRECT_DENY, VALID_ROLE, buildHarness, defaultIam, pgError,
  seedModule, seedVersion, token,
} from './fakes.js';
import type { GrantRow, Harness, ModuleRow, VersionRow } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FBE-06 — Navigation (owner decisions N1–N10). Mock/unit only: real service, repository, routes and evaluator over FakeDb
// (B09 FKs / N-02 / width, IAM facts). Lifecycle states are reached through the FBE-05 API, never written directly.

const TOKEN = token('navigationSessionToken');
const ADMIN = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, PERM_APPROVE_ID, PERM_REJECT_ID, PERM_ACTIVATE_ID, PERM_RETIRE_ID, PERM_ENABLE_ID, PERM_DISABLE_ID, PERM_NAV_ID];
// Business permissions of module SALES (K05: SALES / <functionKey> / <actionKey>).
const SALES = {
  ORDER_READ: '30000000-0000-4000-8000-000000000001', ORDER_CREATE: '30000000-0000-4000-8000-000000000002', REPORT_READ: '30000000-0000-4000-8000-000000000003',
} as const;
const MA = { moduleId: 1, actor: 2, action: 3, targetType: 4, targetId: 5, outcome: 6, metadata: 9 } as const;

function setup(extra: { permissionId: string; row: GrantRow }[] = [{ permissionId: SALES.ORDER_READ, row: VALID_ROLE }], admin: readonly string[] = ADMIN) {
  const iam = defaultIam();
  iam.permissions.push(
    { permission_id: SALES.ORDER_READ, permission_code: 'sales.order.read', module_code: 'SALES', resource_code: 'ORDER', operation: 'READ', minimum_assurance_level: 1 },
    { permission_id: SALES.ORDER_CREATE, permission_code: 'sales.order.create', module_code: 'SALES', resource_code: 'ORDER', operation: 'CREATE', minimum_assurance_level: 1 },
    { permission_id: SALES.REPORT_READ, permission_code: 'sales.report.read', module_code: 'SALES', resource_code: 'REPORT', operation: 'READ', minimum_assurance_level: 1 },
  );
  iam.grants = [...admin.map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE })), ...extra.map((g) => ({ accountId: ACCOUNT_A, ...g }))];
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  const m = seedModule(h.db, 'SALES');
  return { h, m };
}
const send = (h: Harness, method: 'post' | 'put' | 'patch', url: string, body: unknown = {}) =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const menu = async (h: Harness) => {
  const res = await request(h.app).get('/api/foundation/navigation').set('Cookie', `talo_sid=${TOKEN}`);
  expect(res.status).toBe(200);
  return res.body.navigation;
};
const vurl = (m: ModuleRow, v: VersionRow, action: string) => `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/${action}`;

// A valid MIC without DIRECT_DB; CHANGE from `from`; optional route of ORDER.
function mic(moduleVersion: string, from?: string, route = '/sales/orders') {
  const base = validMic('SALES', moduleVersion);
  return {
    ...base,
    mic04Navigation: base.mic04Navigation.map((n) => (n.functionKey === 'ORDER' ? { ...n, routePath: route } : n)),
    mic06DataResources: base.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB'),
    mic09Compatibility: from === undefined ? base.mic09Compatibility : { kind: 'CHANGE', fromVersion: from, changes: ['Thay đổi'] },
  };
}
async function activate(h: Harness, m: ModuleRow, moduleVersion: string, manifest: unknown = mic(moduleVersion)): Promise<VersionRow> {
  const v = seedVersion(h.db, m.module_id, moduleVersion);
  expect((await send(h, 'put', `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest })).status).toBe(200);
  for (const action of ['submit', 'approve', 'activate']) expect((await send(h, 'post', vurl(m, v, action))).status, action).toBe(200);
  return v;
}
async function enable(h: Harness, m: ModuleRow): Promise<void> {
  expect((await send(h, 'post', `/api/foundation/modules/${m.module_id}/enable`)).status).toBe(200);
}
const fid = (h: Harness, m: ModuleRow, key: string) => h.db.state.functions.find((f) => f.module_id === m.module_id && f.function_key === key)?.function_id ?? '';
async function createItem(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await send(h, 'post', '/api/foundation/navigation/items', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return String(res.body.item.navigationId);
}
// Group "Kinh doanh" (global) → "Bán hàng" (module group) → ORDER item; REPORT item directly under the module group.
async function standardTree(h: Harness, m: ModuleRow) {
  const root = await createItem(h, { menuTitle: 'Kinh doanh', sortOrder: 1 });
  const group = await createItem(h, { parentId: root, moduleId: m.module_id, menuTitle: 'Bán hàng' });
  const order = await createItem(h, { parentId: group, moduleId: m.module_id, functionId: fid(h, m, 'ORDER'), menuTitle: 'Đơn hàng', sortOrder: 2 });
  const report = await createItem(h, { parentId: group, moduleId: m.module_id, functionId: fid(h, m, 'REPORT'), menuTitle: 'Báo cáo', sortOrder: 1 });
  return { root, group, order, report };
}
async function liveModule() {
  const s = setup();
  const v = await activate(s.h, s.m, '1.0.0');
  await enable(s.h, s.m);
  const tree = await standardTree(s.h, s.m);
  return { ...s, v, tree };
}
interface TitleNode { readonly menuTitle: string; readonly children: readonly TitleNode[] }
const titles = (nodes: readonly TitleNode[]): unknown[] => nodes.map((n) => [n.menuTitle, ...(n.children.length ? [titles(n.children)] : [])]);

describe('FBE-06 B09 management API (N2, N3, N4, N9)', () => {
  it('T1 creates a global group, a module group and a Function item; 201 camelCase; B08 SUCCESS per write in the same transaction; no B07', async () => {
    const { h, m } = setup();
    await activate(h, m, '1.0.0');
    const eventsBefore = h.db.state.events.length;
    const res = await send(h, 'post', '/api/foundation/navigation/items', { menuTitle: 'Kinh doanh' });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ parentId: null, moduleId: null, functionId: null, menuTitle: 'Kinh doanh', sortOrder: 0, isVisible: true });
    expect(Object.keys(res.body.item).sort()).toEqual(['createdAt', 'functionId', 'isVisible', 'menuTitle', 'moduleId', 'navigationId', 'parentId', 'sortOrder']);
    const tree = await standardTree(h, m);
    expect(h.db.state.navigation.find((n) => n.navigation_id === tree.order)).toMatchObject({ parent_id: tree.group, module_id: m.module_id, function_id: fid(h, m, 'ORDER') });
    const audits = h.db.state.audits.filter((a) => a[MA.action] === 'NAVIGATION.CREATE');
    expect(audits).toHaveLength(5);
    const last = audits.at(-1);
    expect([last?.[MA.outcome], last?.[MA.targetType], last?.[MA.targetId], last?.[MA.moduleId]]).toEqual(['SUCCESS', 'NAVIGATION_ITEM', tree.report, m.module_id]);
    expect(Object.keys(JSON.parse(String(last?.[MA.metadata]))).sort()).toEqual(['fields', 'reason', 'requestId', 'v']); // no MIC content
    expect(h.db.state.events.length).toBe(eventsBefore);
  });

  it('T2 parent: same module or Foundation-wide group accepted; another module, unknown parent → 422 parentId', async () => {
    const { h, m } = setup();
    await activate(h, m, '1.0.0');
    const other = seedModule(h.db, 'OTHER');
    const global = await createItem(h, { menuTitle: 'Chung' });
    const otherGroup = await createItem(h, { moduleId: other.module_id, menuTitle: 'Khác' });
    await createItem(h, { parentId: global, moduleId: m.module_id, functionId: fid(h, m, 'ORDER'), menuTitle: 'Đơn hàng' });
    const sameGroup = await createItem(h, { moduleId: m.module_id, menuTitle: 'Bán hàng' });
    await createItem(h, { parentId: sameGroup, moduleId: m.module_id, functionId: fid(h, m, 'REPORT'), menuTitle: 'Báo cáo' });
    for (const body of [
      { parentId: otherGroup, moduleId: m.module_id, menuTitle: 'x' }, { parentId: otherGroup, menuTitle: 'x' },
      { parentId: '00000000-0000-4000-8000-000000000000', menuTitle: 'x' },
    ]) {
      const res = await send(h, 'post', '/api/foundation/navigation/items', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error, JSON.stringify(body)).toMatchObject({ code: 'NAVIGATION_REFERENCE_INVALID', details: { fields: ['parentId'] } });
    }
  });

  it('T3 Function of another module, Function without module (N-02), unknown module / function → 422; nothing written', async () => {
    const { h, m } = setup();
    await activate(h, m, '1.0.0');
    const other = seedModule(h.db, 'OTHER');
    const before = h.db.state.navigation.length;
    const cases: [Record<string, unknown>, string][] = [
      [{ moduleId: other.module_id, functionId: fid(h, m, 'ORDER'), menuTitle: 'x' }, 'functionId'],
      [{ functionId: fid(h, m, 'ORDER'), menuTitle: 'x' }, 'moduleId'],
      [{ moduleId: '00000000-0000-4000-8000-000000000000', menuTitle: 'x' }, 'moduleId'],
      [{ moduleId: m.module_id, functionId: '00000000-0000-4000-8000-000000000000', menuTitle: 'x' }, 'functionId'],
    ];
    for (const [body, field] of cases) {
      const res = await send(h, 'post', '/api/foundation/navigation/items', body);
      expect(res.status, field).toBe(422);
      expect(res.body.error.details.fields, field).toEqual([field]);
    }
    expect(h.db.state.navigation.length).toBe(before);
  });

  it('T4 input validation: unknown field, blank / long title, non-integer sortOrder, malformed uuid → 400; no cycle can be built (parent is CREATE-only)', async () => {
    const { h } = setup();
    for (const body of [
      { menuTitle: 'x', navigationId: '00000000-0000-4000-8000-000000000000' }, { menuTitle: '   ' }, { menuTitle: 'x'.repeat(151) }, { menuTitle: 'x', sortOrder: 1.5 },
      { menuTitle: 'x', sortOrder: 2 ** 31 }, { menuTitle: 'x', parentId: 'nope' }, { menuTitle: 'x', isVisible: 'yes' }, {}, [], null,
    ]) expect((await send(h, 'post', '/api/foundation/navigation/items', body)).status, JSON.stringify(body)).toBe(400);
    const a = await createItem(h, { menuTitle: 'A' });
    const b = await createItem(h, { parentId: a, menuTitle: 'B' });
    for (const body of [{ parentId: b }, { moduleId: null }, { functionId: null }, { navigationId: b }, { createdAt: 'x' }]) {
      const res = await send(h, 'patch', `/api/foundation/navigation/items/${a}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.details.fields).toEqual(['UNKNOWN_FIELD']);
    }
    expect(h.db.state.navigation.find((n) => n.navigation_id === a)?.parent_id).toBeNull();
  });

  it('T5 PATCH changes only menuTitle / sortOrder / isVisible (partial), 200, B08 names the changed fields; {} → 400; unknown id → 404', async () => {
    const { h } = setup();
    const id = await createItem(h, { menuTitle: 'A', sortOrder: 3 });
    const before = h.db.state.navigation.find((n) => n.navigation_id === id);
    const res = await send(h, 'patch', `/api/foundation/navigation/items/${id}`, { sortOrder: 7, isVisible: false });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ navigationId: id, menuTitle: 'A', sortOrder: 7, isVisible: false, parentId: null, createdAt: before?.created_at });
    const audit = h.db.state.audits.at(-1);
    expect([audit?.[MA.action], audit?.[MA.outcome]]).toEqual(['NAVIGATION.UPDATE', 'SUCCESS']);
    expect(JSON.parse(String(audit?.[MA.metadata])).fields).toBe('sortOrder,isVisible');
    expect((await send(h, 'patch', `/api/foundation/navigation/items/${id}`, { menuTitle: 'B' })).body.item).toMatchObject({ menuTitle: 'B', sortOrder: 7, isVisible: false });
    expect((await send(h, 'patch', `/api/foundation/navigation/items/${id}`, {})).status).toBe(400);
    expect((await send(h, 'patch', '/api/foundation/navigation/items/00000000-0000-4000-8000-000000000000', { menuTitle: 'x' })).body.error.code).toBe('NAVIGATION_NOT_FOUND');
  });

  it('T6 authorisation before validation and lookup: without foundation.navigation.manage → 403 + B08 DENIED, even for invalid input / unknown id', async () => {
    const { h } = setup([], ADMIN.filter((p) => p !== PERM_NAV_ID));
    const cases: [string, 'post' | 'patch', unknown][] = [
      ['/api/foundation/navigation/items', 'post', { menuTitle: 'x' }], ['/api/foundation/navigation/items', 'post', { bogus: true }],
      ['/api/foundation/navigation/items/not-a-uuid', 'patch', { menuTitle: 'x' }], ['/api/foundation/navigation/items/00000000-0000-4000-8000-000000000000', 'patch', {}],
    ];
    for (const [url, method, body] of cases) {
      const before = h.db.state.audits.length;
      const res = await send(h, method, url, body);
      expect(res.status, url).toBe(403);
      const denied = h.db.state.audits.slice(before);
      expect(denied.map((a) => [a[MA.action], a[MA.outcome], a[MA.targetType], a[MA.targetId]]), url).toEqual([[method === 'post' ? 'NAVIGATION.CREATE' : 'NAVIGATION.UPDATE', 'DENIED', 'NAVIGATION', null]]);
    }
    expect(h.db.state.navigation).toHaveLength(0);
  });

  it('T7 atomicity: B08 or B09 failure → 503, no B09 row / no change kept', async () => {
    for (const sql of [FOUNDATION_SQL.insertAudit, NAVIGATION_SQL.insertItem]) {
      const { h } = setup();
      h.db.failOn.set(sql, pgError('23514'));
      expect((await send(h, 'post', '/api/foundation/navigation/items', { menuTitle: 'x' })).status).toBe(503);
      expect(h.db.state.navigation).toHaveLength(0);
      expect(h.db.state.audits.filter((a) => a[MA.outcome] === 'SUCCESS')).toHaveLength(0);
    }
    for (const sql of [FOUNDATION_SQL.insertAudit, NAVIGATION_SQL.updateItem]) {
      const { h } = setup();
      const id = await createItem(h, { menuTitle: 'x' });
      const before = JSON.stringify(h.db.state.navigation);
      h.db.failOn.set(sql, pgError('23514'));
      expect((await send(h, 'patch', `/api/foundation/navigation/items/${id}`, { menuTitle: 'y' })).status).toBe(503);
      expect(JSON.stringify(h.db.state.navigation)).toBe(before);
    }
  });

  it('T8 scope: B09 is the only table written by NAVIGATION_SQL, never deleted; parent / module / function never updated; GET writes nothing', async () => {
    const writes = Object.values(NAVIGATION_SQL).map((sql) => /^\s*(UPDATE|INSERT INTO|DELETE FROM) (\S+)/.exec(sql)).filter((x) => x !== null).map((x) => `${x[1]} ${x[2]}`);
    expect([...new Set(writes)].sort()).toEqual(['INSERT INTO foundation.fnd_navigation_items', 'UPDATE foundation.fnd_navigation_items']);
    for (const sql of Object.values(NAVIGATION_SQL)) expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|GRANT|ALTER|DROP|CREATE)\b/i);
    const set = NAVIGATION_SQL.updateItem.split('WHERE')[0] ?? '';
    for (const col of ['parent_id', 'module_id', 'function_id', 'navigation_id', 'created_at']) expect(set).not.toContain(col);
    const { h } = await liveModule();
    const before = JSON.stringify([h.db.state.versions, h.db.state.modules, h.db.state.functions, h.db.state.versionFunctions, h.db.state.dataContracts, h.db.state.navigation, h.db.state.audits, h.db.state.events]);
    const from = h.db.statements.length;
    await menu(h);
    expect(h.db.statements.slice(from).every((s) => /^\s*SELECT/.test(s.sql))).toBe(true);
    expect(JSON.stringify([h.db.state.versions, h.db.state.modules, h.db.state.functions, h.db.state.versionFunctions, h.db.state.dataContracts, h.db.state.navigation, h.db.state.audits, h.db.state.events])).toBe(before);
  });
});

describe('FBE-06 permission-filtered menu (N5–N8)', () => {
  it('M1 enabled + ACTIVE + MIC-04 route + effective IAM → ORDER offered with its route; REPORT (no MIC-04 route / no grant) hidden; structure and order', async () => {
    const { h, m, tree } = await liveModule();
    const nav = await menu(h);
    expect(nav).toEqual([{
      navigationId: tree.root, moduleId: null, functionId: null, menuTitle: 'Kinh doanh', sortOrder: 1, routePath: null, screenKey: null, developArea: false,
      children: [{
        navigationId: tree.group, moduleId: m.module_id, functionId: null, menuTitle: 'Bán hàng', sortOrder: 0, routePath: null, screenKey: null, developArea: false,
        children: [{ navigationId: tree.order, moduleId: m.module_id, functionId: fid(h, m, 'ORDER'), menuTitle: 'Đơn hàng', sortOrder: 2, routePath: '/sales/orders', screenKey: 'sales.orders', developArea: false, children: [] }],
      }],
    }]);
  });

  it('M2 lifecycle is read live: DISABLE hides, ENABLE shows, RETIRE without ACTIVE hides; no ACTIVE at all → nothing', async () => {
    const { h, m, v } = await liveModule();
    expect(titles(await menu(h))).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]]]);
    expect((await send(h, 'post', `/api/foundation/modules/${m.module_id}/disable`)).status).toBe(200);
    expect(await menu(h)).toEqual([]);
    await enable(h, m);
    expect(titles(await menu(h))).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]]]);
    expect((await send(h, 'post', vurl(m, v, 'retire'))).status).toBe(200);
    expect(await menu(h)).toEqual([]);
    const fresh = setup();
    await activate(fresh.h, fresh.m, '1.0.0');
    await standardTree(fresh.h, fresh.m);
    expect(await menu(fresh.h)).toEqual([]); // ACTIVE but module not enabled
  });

  it('M3 ACTIVATE V2 → the route of the new ACTIVE version is used; earlier versions never provide routes', async () => {
    const { h, m } = await liveModule();
    await activate(h, m, '2.0.0', mic('2.0.0', '1.0.0', '/sales/orders-v2'));
    expect(h.db.state.versions.filter((x) => x.status === 'ACTIVE').map((x) => x.module_version)).toEqual(['2.0.0']);
    const order = (await menu(h))[0].children[0].children[0];
    expect(order).toMatchObject({ routePath: '/sales/orders-v2', menuTitle: 'Đơn hàng' }); // title stays the B09 title
    const v3 = seedVersion(h.db, m.module_id, '3.0.0');
    await send(h, 'put', `/api/foundation/modules/${m.module_id}/versions/${v3.version_id}/manifest`, { manifest: mic('3.0.0', '1.0.0', '/sales/orders-v3') });
    await send(h, 'post', vurl(m, v3, 'submit'));
    await send(h, 'post', vurl(m, v3, 'approve'));
    expect((await menu(h))[0].children[0].children[0].routePath).toBe('/sales/orders-v2'); // APPROVED v3 is not used
  });

  it('M4 IAM: role ALLOW, direct ALLOW show; direct DENY beats role ALLOW; no grant, revoked, expired, not started → hidden; any one allowed Action suffices', async () => {
    const show = async (grants: { permissionId: string; row: GrantRow }[]) => {
      const s = setup(grants);
      await activate(s.h, s.m, '1.0.0');
      await enable(s.h, s.m);
      await standardTree(s.h, s.m);
      return (await menu(s.h)).length > 0;
    };
    expect(await show([{ permissionId: SALES.ORDER_READ, row: VALID_ROLE }])).toBe(true);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: VALID_DIRECT_ALLOW }])).toBe(true);
    expect(await show([{ permissionId: SALES.ORDER_CREATE, row: VALID_ROLE }])).toBe(true);
    expect(await show([])).toBe(false);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: VALID_ROLE }, { permissionId: SALES.ORDER_READ, row: VALID_DIRECT_DENY }])).toBe(false);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: { ...VALID_ROLE, not_revoked: false } }])).toBe(false);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: { ...VALID_DIRECT_ALLOW, not_expired: false } }])).toBe(false);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: { ...VALID_ROLE, started: false } }])).toBe(false);
    expect(await show([{ permissionId: SALES.ORDER_READ, row: { ...VALID_ROLE, role_active: false } }])).toBe(false);
    expect(await show([{ permissionId: SALES.REPORT_READ, row: VALID_ROLE }])).toBe(false); // REPORT has no MIC-04 route
  });

  it('M5 permission definition missing or ambiguous, assurance below definition or MIC-07, inactive account → hidden; nothing leaks', async () => {
    const variants: [string, (h: Harness) => void][] = [
      ['undefined', (h) => { h.db.iam.permissions = h.db.iam.permissions.filter((p) => p.module_code !== 'SALES'); }],
      ['ambiguous', (h) => { h.db.iam.permissions.push({ permission_id: '30000000-0000-4000-8000-0000000000ff', permission_code: 'sales.order.read2', module_code: 'SALES', resource_code: 'ORDER', operation: 'READ', minimum_assurance_level: 1 }); }],
      ['definition assurance', (h) => { h.db.iam.permissions = h.db.iam.permissions.map((p) => (p.permission_id === SALES.ORDER_READ ? { ...p, minimum_assurance_level: 2 } : p)); }],
      ['account disabled', (h) => { h.db.iam.accounts.set(ACCOUNT_A, { account_status: 'ACTIVE', not_disabled: false }); }],
    ];
    for (const [name, mutate] of variants) {
      const { h } = await liveModule();
      mutate(h);
      const res = await request(h.app).get('/api/foundation/navigation').set('Cookie', `talo_sid=${TOKEN}`);
      expect(res.status, name).toBe(200);
      expect(res.body.navigation, name).toEqual([]);
      expect(JSON.stringify(res.body), name).not.toContain('/sales/orders');
    }
    const s = setup();
    const high = mic('1.0.0');
    await activate(s.h, s.m, '1.0.0', { ...high, mic07IamMapping: high.mic07IamMapping.map((x) => ({ ...x, minimumAssuranceLevel: 2 })) });
    await enable(s.h, s.m);
    await standardTree(s.h, s.m);
    expect(await menu(s.h)).toEqual([]); // MIC-07 assurance 2 > session 1
  });

  it('M6 is_visible=false hides the node and its whole branch; a group without an offered descendant is not shown', async () => {
    const { h, tree } = await liveModule();
    const hide = async (id: string, isVisible: boolean) => expect((await send(h, 'patch', `/api/foundation/navigation/items/${id}`, { isVisible })).status).toBe(200);
    await hide(tree.root, false);
    expect(await menu(h)).toEqual([]);
    await hide(tree.root, true);
    await hide(tree.order, false);
    expect(await menu(h)).toEqual([]); // the module group only had REPORT (not offered) left
    await hide(tree.order, true);
    expect(titles(await menu(h))).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]]]);
    await createItem(h, { menuTitle: 'Trống' });
    expect(titles(await menu(h))).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]]]);
  });

  it('M7 stored MIC not trusted or route ambiguous / missing → the Function is not offered', async () => {
    const tamper = await liveModule();
    tamper.h.db.state.versions = tamper.h.db.state.versions.map((x) => (x.status === 'ACTIVE' ? { ...x, manifest_hash: 'c'.repeat(64) } : x));
    expect(await menu(tamper.h)).toEqual([]);
    const version = { moduleId: 'm', moduleKey: 'SALES', versionId: 'v', manifestJson: mic('1.0.0'), manifestHash: canonicalDigest(mic('1.0.0')).sha256 };
    const rows = [{ versionId: 'v', functionId: 'f1', functionKey: 'ORDER', actionKey: 'READ' }];
    expect(menuCandidates(version, rows).map((c) => [c.functionId, c.routePath, c.screenKey])).toEqual([['f1', '/sales/orders', 'sales.orders']]);
    const variant = (change: (m: ReturnType<typeof mic>) => unknown) => {
      const manifest = change(mic('1.0.0'));
      return menuCandidates({ ...version, manifestJson: manifest, manifestHash: canonicalDigest(manifest).sha256 }, rows);
    };
    expect(variant((m) => ({ ...m, mic04Navigation: [...m.mic04Navigation, { menuLabel: 'Dup', routePath: '/x', functionKey: 'ORDER' }] }))).toEqual([]);
    expect(variant((m) => ({ ...m, mic04Navigation: m.mic04Navigation.map((n) => (n.functionKey === 'ORDER' ? { menuLabel: n.menuLabel, functionKey: 'ORDER' } : n)) }))).toEqual([]);
    expect(variant((m) => ({ ...m, mic04Navigation: m.mic04Navigation.map((n) => (n.functionKey === 'ORDER' ? { ...n, routePath: '  ' } : n)) }))).toEqual([]);
    expect(variant((m) => ({ ...m, mic07IamMapping: m.mic07IamMapping.map((x) => ({ ...x, moduleCode: 'OTHER' })) }))).toEqual([]); // K05 broken
    expect(variant((m) => ({ ...m, mic07IamMapping: [...m.mic07IamMapping, m.mic07IamMapping[0]] }))).toEqual([]); // duplicated mapping refused → no requirement left
    expect(menuCandidates({ ...version, manifestHash: null }, rows)).toEqual([]);
    expect(menuCandidates(version, [{ versionId: 'v', functionId: 'f1', functionKey: 'ORDER', actionKey: null }])).toEqual([]); // no action → no requirement → not offered
  });
});

describe('FBE-06 menu SQL and IAM facts', () => {
  it('S1 menu sources read only ENABLED modules and ACTIVE versions; IAM grants are read only for exactly one definition', async () => {
    for (const sql of [NAVIGATION_SQL.activeVersions, NAVIGATION_SQL.activeFunctions]) {
      expect(sql).toContain("v.status = 'ACTIVE'");
      expect(sql).toContain('WHERE m.is_enabled');
    }
    expect(NAVIGATION_SQL.activeFunctions).toContain('f.module_id = m.module_id');
    const { h } = await liveModule();
    h.db.iam.permissions.push({ permission_id: '30000000-0000-4000-8000-0000000000ff', permission_code: 'sales.order.read2', module_code: 'SALES', resource_code: 'ORDER', operation: 'READ', minimum_assurance_level: 1 });
    const from = h.db.statements.length;
    expect(await menu(h)).toEqual([]);
    const grantReads = h.db.statements.slice(from).filter((x) => x.sql === FOUNDATION_SQL.grantFacts).map((x) => x.params[1]);
    expect(grantReads).not.toContain(SALES.ORDER_READ); // ambiguous READ: no grant lookup
    expect(grantReads).toContain(SALES.ORDER_CREATE); // the unambiguous CREATE definition is still evaluated
  });
});

describe('FBE-06 buildMenu (N7) — pure', () => {
  const item = (over: Partial<NavigationItem> & { navigationId: string }): NavigationItem => ({
    parentId: null, moduleId: null, functionId: null, menuTitle: over.navigationId, sortOrder: 0, isVisible: true, createdAt: 't', ...over,
  });
  const allowed = new Map([['f1', { moduleId: 'm', routePath: '/a', screenKey: null, developer: false }], ['f2', { moduleId: 'm', routePath: '/b', screenKey: 's', developer: false }]]);

  it('P1 ordering by sortOrder, then menuTitle, then navigationId (stable); a Function of another module than its node is refused', () => {
    const items = [
      item({ navigationId: 'g' }),
      item({ navigationId: 'c', parentId: 'g', moduleId: 'm', functionId: 'f1', menuTitle: 'B', sortOrder: 1 }),
      item({ navigationId: 'b', parentId: 'g', moduleId: 'm', functionId: 'f2', menuTitle: 'A', sortOrder: 1 }),
      item({ navigationId: 'a', parentId: 'g', moduleId: 'm', functionId: 'f1', menuTitle: 'A', sortOrder: 1 }),
      item({ navigationId: 'z', parentId: 'g', moduleId: 'm', functionId: 'f2', menuTitle: 'Z', sortOrder: -5 }),
      item({ navigationId: 'x', parentId: 'g', moduleId: 'other', functionId: 'f1', menuTitle: 'X' }),
    ];
    const [g] = buildMenu(items, allowed);
    expect(g?.children.map((n) => n.navigationId)).toEqual(['z', 'a', 'b', 'c']);
    expect(buildMenu([...items].reverse(), allowed)).toEqual(buildMenu(items, allowed));
  });

  it('P2 cycles and orphans fail closed without looping; a refused Function hides its sub-branch', () => {
    const items = [
      item({ navigationId: 'c1', parentId: 'c2', moduleId: 'm', functionId: 'f1' }), item({ navigationId: 'c2', parentId: 'c1', moduleId: 'm', functionId: 'f2' }),
      item({ navigationId: 'o', parentId: 'missing', moduleId: 'm', functionId: 'f1' }),
      item({ navigationId: 's', parentId: 's', moduleId: 'm', functionId: 'f1' }),
      item({ navigationId: 'r' }), item({ navigationId: 'denied', parentId: 'r', moduleId: 'm', functionId: 'f9' }),
      item({ navigationId: 'under', parentId: 'denied', moduleId: 'm', functionId: 'f1' }),
    ];
    expect(buildMenu(items, allowed)).toEqual([]);
  });
});
