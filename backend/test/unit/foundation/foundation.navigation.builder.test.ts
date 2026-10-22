import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  DEVELOP_ANCHOR_ORDER, developAreaId, planDraft, readLayout, revisionOf, validateDraft,
} from '../../../src/modules/foundation/foundation.navigation.builder.js';
import type { Draft, FunctionFacts, Layout } from '../../../src/modules/foundation/foundation.navigation.builder.js';
import { buildMenu } from '../../../src/modules/foundation/foundation.navigation.js';
import type { MenuFunction, NavigationItem } from '../../../src/modules/foundation/foundation.navigation.js';
import { NAVIGATION_SQL } from '../../../src/modules/foundation/foundation.navigation.repository.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import {
  ACCOUNT_A, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_ENABLE_ID, PERM_NAV_ID, PERM_VCREATE_ID, PERM_VREAD_ID, PERM_VSUBMIT_ID, PERM_VUPDATE_ID,
  TEST_ORIGIN, VALID_ROLE, buildHarness, defaultIam, pgError, seedModule, seedVersion, token,
} from './fakes.js';
import type { Harness, ModuleRow } from './fakes.js';
import { validMic } from './mic.fixture.js';

// Navigation Builder (owner decisions of 22/10/2026). Mock/unit only: real service, repository, routes and evaluator over
// FakeDb. Pure model tests use hand-built B09 rows; HTTP tests reach lifecycle states through the FBE-05 API.

const TOKEN = token('navigationBuilderSessionToken');
const LIFECYCLE = [PERM_VREAD_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, PERM_APPROVE_ID, PERM_ACTIVATE_ID, PERM_ENABLE_ID];
const ORDER_READ = '30000000-0000-4000-8000-000000000001';
const MA = { action: 3, targetType: 4, targetId: 5, outcome: 6, metadata: 9 } as const;

function setup(manage = true) {
  const iam = defaultIam();
  iam.permissions.push({ permission_id: ORDER_READ, permission_code: 'sales.order.read', module_code: 'SALES', resource_code: 'ORDER', operation: 'READ', minimum_assurance_level: 1 });
  const perms = [...LIFECYCLE, ...(manage ? [PERM_NAV_ID] : []), ORDER_READ];
  iam.grants = perms.map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const h = buildHarness({ iam });
  h.auth.authenticated(TOKEN, ACCOUNT_A);
  return { h, m: seedModule(h.db, 'SALES') };
}
const send = (h: Harness, method: 'post' | 'put' | 'patch', url: string, body: unknown = {}) =>
  request(h.app)[method](url).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send(JSON.stringify(body));
const get = (h: Harness, url: string) => request(h.app).get(url).set('Cookie', `talo_sid=${TOKEN}`);

async function live(manage = true) {
  const { h, m } = setup(manage);
  const v = seedVersion(h.db, m.module_id, '1.0.0');
  const base = validMic('SALES', '1.0.0');
  const manifest = { ...base, mic06DataResources: base.mic06DataResources.filter((r) => r.interfaceKind !== 'DIRECT_DB') };
  expect((await send(h, 'put', `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/manifest`, { manifest })).status).toBe(200);
  for (const action of ['submit', 'approve', 'activate']) expect((await send(h, 'post', `/api/foundation/modules/${m.module_id}/versions/${v.version_id}/${action}`)).status, action).toBe(200);
  expect((await send(h, 'post', `/api/foundation/modules/${m.module_id}/enable`)).status).toBe(200);
  return { h, m };
}
const fid = (h: Harness, m: ModuleRow, key: string) => h.db.state.functions.find((f) => f.module_id === m.module_id && f.function_key === key)?.function_id ?? '';
async function createItem(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await send(h, 'post', '/api/foundation/navigation/items', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return String(res.body.item.navigationId);
}
// Area "Kinh doanh" (global) → menu "Bán hàng" (SALES) → links ORDER "Đơn hàng"; area "Khác" → menu "Trống".
async function tree(h: Harness, m: ModuleRow) {
  const area = await createItem(h, { menuTitle: 'Kinh doanh' });
  const menu = await createItem(h, { parentId: area, moduleId: m.module_id, menuTitle: 'Bán hàng' });
  const order = await createItem(h, { parentId: menu, moduleId: m.module_id, functionId: fid(h, m, 'ORDER'), menuTitle: 'Đơn hàng' });
  const other = await createItem(h, { menuTitle: 'Khác', sortOrder: 1 });
  const empty = await createItem(h, { parentId: other, menuTitle: 'Trống' });
  return { area, menu, order, other, empty };
}
async function layout(h: Harness): Promise<Layout> {
  const res = await get(h, '/api/foundation/navigation/builder');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.layout;
}
// The stored layout as a draft (nothing changed) — the starting point of every edit.
function draftOf(l: Layout): Draft {
  return {
    revision: l.revision,
    areas: l.areas.map((a) => ({
      id: a.id, title: a.title, visible: a.visible, develop: a.develop,
      menus: a.menus.map((mn) => ({ id: mn.id, title: mn.title, visible: mn.visible, items: mn.items.map((i) => ({ id: i.id, functionId: i.functionId, title: i.title, visible: i.visible })) })),
    })),
    legacy: l.legacy.map((x) => ({ id: x.id, visible: x.visible })),
  };
}
const withDevelop = (d: Draft): Draft => ({ ...d, areas: [...d.areas, { id: null, title: 'Develop', visible: true, develop: true, menus: [] }] });
const fields = (body: { error?: { details?: { fields?: string[] } } }) => body.error?.details?.fields ?? [];
interface TitleNode { readonly menuTitle: string; readonly children: readonly TitleNode[] }
const titles = (nodes: readonly TitleNode[]): unknown[] => nodes.map((n) => [n.menuTitle, ...(n.children.length ? [titles(n.children)] : [])]);

describe('Navigation Builder API', () => {
  it('B1 every Builder endpoint requires foundation.navigation.manage (403, nothing written)', async () => {
    const { h, m } = await live(false);
    const before = h.db.state.navigation.length;
    expect((await get(h, '/api/foundation/navigation/builder')).status).toBe(403);
    expect((await get(h, '/api/foundation/navigation/builder/functions')).status).toBe(403);
    const draft = { revision: '0'.repeat(64), areas: [{ id: null, title: 'Develop', visible: true, develop: true, menus: [] }], legacy: [] };
    expect((await send(h, 'post', '/api/foundation/navigation/builder/preview', draft)).status).toBe(403);
    expect((await send(h, 'put', '/api/foundation/navigation/builder', draft)).status).toBe(403);
    expect(h.db.state.navigation.length).toBe(before);
    expect(fid(h, m, 'ORDER')).not.toBe('');
  });

  it('B2 layout reads areas / menus / links; inventory lists every Function with its assignability', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const l = await layout(h);
    expect(l.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(l.developAreaId).toBeNull();
    expect(l.areas.map((a) => [a.id, a.title, a.menus.map((mn) => [mn.id, mn.items.map((i) => i.id)])])).toEqual([
      [t.area, 'Kinh doanh', [[t.menu, [t.order]]]], [t.other, 'Khác', [[t.empty, []]]],
    ]);
    const inv = (await get(h, '/api/foundation/navigation/builder/functions')).body.functions as { functionKey: string; assignable: boolean; reason: string | null; developer: boolean }[];
    expect(inv.map((f) => [f.functionKey, f.assignable, f.reason, f.developer]).sort()).toEqual([['ORDER', true, null, false], ['REPORT', false, 'NO_ROUTE_OR_PERMISSION', false]]);
  });

  it('B3 apply: Develop created with its anchor, same Function linked in two menus, B08 audit, sidebar reloaded from B09', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    const order = fid(h, m, 'ORDER');
    d.areas[1]?.menus[0]?.items.push({ id: null, functionId: order, title: 'Đơn hàng (lối tắt)', visible: true });
    const eventsBefore = h.db.state.events.length;
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after: Layout = res.body.layout;
    expect(after.developAreaId).not.toBeNull();
    expect(after.areas.find((a) => a.develop)?.title).toBe('Develop');
    const anchor = h.db.state.navigation.find((n) => n.parent_id === after.developAreaId && n.sort_order === DEVELOP_ANCHOR_ORDER);
    expect(anchor).toMatchObject({ is_visible: false, module_id: null, function_id: null });
    const links = h.db.state.navigation.filter((n) => n.function_id === order && n.is_visible);
    expect(links).toHaveLength(2);
    expect(new Set(links.map((n) => n.parent_id))).toEqual(new Set([t.menu, t.empty]));
    // The empty-area rule hides nothing here; the sidebar shows both links (multi-link, distinct navigation ids).
    const nav = (await get(h, '/api/foundation/navigation')).body.navigation;
    expect(titles(nav)).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]], ['Khác', [['Trống', [['Đơn hàng (lối tắt)']]]]], ['Develop']]);
    const audit = h.db.state.audits.filter((a) => a[MA.action] === 'NAVIGATION.LAYOUT.APPLY');
    expect(audit).toHaveLength(1);
    expect([audit[0]?.[MA.outcome], audit[0]?.[MA.targetType]]).toEqual(['SUCCESS', 'NAVIGATION_LAYOUT']);
    expect(JSON.parse(String(audit[0]?.[MA.metadata]))).toMatchObject({ inserted: 3, relinked: 0 });
    expect(h.db.state.events.length).toBe(eventsBefore); // no B07 event
  });

  it('B4 duplicate visible link in the same menu → 422 (nothing written); a hidden duplicate is allowed', async () => {
    const { h, m } = await live();
    await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    const rows = h.db.state.navigation.length;
    const audits = h.db.state.audits.length;
    d.areas[0]?.menus[0]?.items.push({ id: null, functionId: fid(h, m, 'ORDER'), title: 'Lần hai', visible: true });
    const bad = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('NAVIGATION_LAYOUT_INVALID');
    expect(fields(bad.body)).toContain('FUNCTION_DUPLICATE_IN_MENU:0.0.1');
    expect(h.db.state.navigation.length).toBe(rows);
    expect(h.db.state.audits.length).toBe(audits);
    const item = d.areas[0]?.menus[0]?.items[1];
    if (item) item.visible = false;
    expect((await send(h, 'put', '/api/foundation/navigation/builder', d)).status).toBe(200);
  });

  it('B5 stale revision → 409 NAVIGATION_CONFLICT; the change made by someone else is kept', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    expect((await send(h, 'patch', `/api/foundation/navigation/items/${t.order}`, { menuTitle: 'Đổi bởi người khác' })).status).toBe(200);
    const rows = JSON.stringify(h.db.state.navigation);
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NAVIGATION_CONFLICT');
    expect(JSON.stringify(h.db.state.navigation)).toBe(rows);
  });

  it('B6 MOVE re-links (new row at the target, old row hidden, same Function / title); remove = hide, never DELETE', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    const moved = d.areas[0]?.menus[0]?.items.pop();
    expect(moved?.id).toBe(t.order);
    if (moved) d.areas[1]?.menus[0]?.items.push(moved);
    const menuB = d.areas[0]?.menus[0];
    if (menuB) menuB.visible = false; // "Gỡ" the now-empty menu
    const rows = h.db.state.navigation.length;
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(h.db.state.navigation.length).toBe(rows + 3); // develop area + anchor + re-linked row; nothing deleted
    expect(h.db.state.navigation.find((n) => n.navigation_id === t.order)?.is_visible).toBe(false);
    expect(h.db.state.navigation.find((n) => n.navigation_id === t.menu)?.is_visible).toBe(false);
    const relinked = h.db.state.navigation.find((n) => n.parent_id === t.empty);
    expect(relinked).toMatchObject({ function_id: fid(h, m, 'ORDER'), module_id: m.module_id, menu_title: 'Đơn hàng', is_visible: true, sort_order: 0 });
    const meta = JSON.parse(String(h.db.state.audits.find((a) => a[MA.action] === 'NAVIGATION.LAYOUT.APPLY')?.[MA.metadata]));
    expect(meta.relinked).toBe(1);
  });

  it('B7 sort_order is computed from the draft order; unchanged rows are not updated', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    d.areas.reverse(); // Develop, Khác, Kinh doanh
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(res.status).toBe(200);
    const order = (id: string) => h.db.state.navigation.find((n) => n.navigation_id === id)?.sort_order;
    expect([order(t.other), order(t.area)]).toEqual([1, 2]);
    const meta = JSON.parse(String(h.db.state.audits.find((a) => a[MA.action] === 'NAVIGATION.LAYOUT.APPLY')?.[MA.metadata]));
    expect(meta.updated).toBe(1); // "Kinh doanh" 0 → 2; "Khác" stays 1
  });

  it('B8 Develop is protected: optional before it exists, then required once, cannot be hidden, swapped or doubled; its anchor is invisible to the item API', async () => {
    const { h, m } = await live();
    await tree(h, m);
    const twice = withDevelop(withDevelop(draftOf(await layout(h))));
    expect(fields((await send(h, 'put', '/api/foundation/navigation/builder', twice)).body)).toContain('DEVELOP_AREA_REQUIRED:areas');
    // No DEVELOP stored yet: a save without it is accepted and creates none (it comes with the save that relocates).
    expect((await send(h, 'put', '/api/foundation/navigation/builder', draftOf(await layout(h)))).status).toBe(200);
    expect((await layout(h)).developAreaId).toBeNull();
    expect((await send(h, 'put', '/api/foundation/navigation/builder', withDevelop(draftOf(await layout(h))))).status).toBe(200);
    const l = await layout(h);
    const devIdx = l.areas.findIndex((a) => a.develop);
    const hide = draftOf(l);
    const dev = hide.areas[devIdx];
    if (dev) dev.visible = false;
    const r1 = await send(h, 'put', '/api/foundation/navigation/builder', hide);
    expect(fields(r1.body)).toContain(`DEVELOP_AREA_PROTECTED:${devIdx}`);
    const dropped = draftOf(l);
    dropped.areas.forEach((a) => { a.develop = false; });
    expect(fields((await send(h, 'put', '/api/foundation/navigation/builder', dropped)).body)).toContain('DEVELOP_AREA_REQUIRED:areas');
    const swap = draftOf(l);
    swap.areas.forEach((a) => { a.develop = !a.develop && a.title === 'Khác'; });
    const r2 = await send(h, 'put', '/api/foundation/navigation/builder', swap);
    expect(r2.status).toBe(422);
    expect(fields(r2.body).filter((f) => f.startsWith('DEVELOP_AREA_PROTECTED'))).toHaveLength(2);
    const anchor = h.db.state.navigation.find((n) => n.sort_order === DEVELOP_ANCHOR_ORDER);
    expect((await send(h, 'patch', `/api/foundation/navigation/items/${anchor?.navigation_id}`, { menuTitle: 'x' })).status).toBe(404);
    expect((await send(h, 'post', '/api/foundation/navigation/items', { menuTitle: 'x', sortOrder: DEVELOP_ANCHOR_ORDER })).status).toBe(400);
    expect(l.areas.flatMap((a) => a.menus).some((mn) => mn.title.includes('neo'))).toBe(false);
  });

  it('B9 a stored row must be present (LAYOUT_INCOMPLETE), at its level, once; unknown ids are refused', async () => {
    const { h, m } = await live();
    const t = await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    d.areas[1]?.menus.pop();
    d.areas[0]?.menus.push({ id: t.area, title: 'x', visible: true, items: [] });
    d.legacy.push({ id: '99999999-0000-4000-8000-000000000000', visible: true });
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual(expect.arrayContaining([`LAYOUT_INCOMPLETE:${t.empty}`, `LAYOUT_ITEM_REPEATED:${t.area}`, 'LAYOUT_LEVEL_INVALID:0.1', 'LAYOUT_ITEM_UNKNOWN:99999999-0000-4000-8000-000000000000']));
    expect((await send(h, 'put', '/api/foundation/navigation/builder', { ...d, extra: 1 })).status).toBe(400);
  });

  it('B10 a non-assignable Function cannot be linked (REPORT has no MIC-04 route)', async () => {
    const { h, m } = await live();
    await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    d.areas[0]?.menus[0]?.items.push({ id: null, functionId: fid(h, m, 'REPORT'), title: 'Báo cáo', visible: true });
    const res = await send(h, 'put', '/api/foundation/navigation/builder', d);
    expect(fields(res.body)).toContain('FUNCTION_NOT_ASSIGNABLE:0.0.1');
  });

  it('B11 atomic: a B08 or B09 failure during apply → 503 and no row changed', async () => {
    for (const sql of [FOUNDATION_SQL.insertAudit, NAVIGATION_SQL.insertItem, NAVIGATION_SQL.updateItem]) {
      const { h, m } = await live();
      await tree(h, m);
      const d = withDevelop(draftOf(await layout(h)));
      d.areas.reverse();
      const before = JSON.stringify(h.db.state.navigation);
      h.db.failOn.set(sql, pgError('23514'));
      expect((await send(h, 'put', '/api/foundation/navigation/builder', d)).status, sql.slice(0, 30)).toBe(503);
      expect(JSON.stringify(h.db.state.navigation)).toBe(before);
    }
  });

  it('B12 preview returns the menu of this account with the draft and writes nothing', async () => {
    const { h, m } = await live();
    await tree(h, m);
    const d = withDevelop(draftOf(await layout(h)));
    d.areas[1]?.menus[0]?.items.push({ id: null, functionId: fid(h, m, 'ORDER'), title: 'Xem trước', visible: true });
    const rows = JSON.stringify(h.db.state.navigation);
    const audits = h.db.state.audits.length;
    const res = await send(h, 'post', '/api/foundation/navigation/builder/preview', d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(titles(res.body.navigation)).toEqual([['Kinh doanh', [['Bán hàng', [['Đơn hàng']]]]], ['Khác', [['Trống', [['Xem trước']]]]], ['Develop']]);
    expect(res.body.navigation[2].developArea).toBe(true);
    expect(JSON.stringify(h.db.state.navigation)).toBe(rows);
    expect(h.db.state.audits.filter((a) => a[MA.action] === 'NAVIGATION.LAYOUT.APPLY')).toHaveLength(0);
    expect(h.db.state.audits.length).toBeGreaterThanOrEqual(audits);
  });
});

// ------------------------------------------------------------------------------------------------- pure model
const MOD = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEV_MOD = 'aaaaaaaa-0000-4000-8000-000000000002';
const FN = 'bbbbbbbb-0000-4000-8000-000000000001';
const DEV_FN = 'bbbbbbbb-0000-4000-8000-000000000002';
const n = (k: number) => `cccccccc-0000-4000-8000-${String(k).padStart(12, '0')}`;
const row = (k: number, parent: number | null, extra: Partial<NavigationItem> = {}): NavigationItem => ({
  navigationId: n(k), parentId: parent === null ? null : n(parent), moduleId: null, functionId: null, menuTitle: `R${k}`, sortOrder: k, isVisible: true,
  createdAt: `2026-10-22T00:00:${String(k).padStart(2, '0')}.000000Z`, ...extra,
});
const facts = new Map<string, FunctionFacts>([
  [FN, { functionId: FN, moduleId: MOD, moduleKey: 'SALES', functionKey: 'ORDER', assignable: true, developer: false }],
  [DEV_FN, { functionId: DEV_FN, moduleId: DEV_MOD, moduleKey: 'SYSTEM_TEST', functionKey: 'TEST_RUNNER', assignable: true, developer: true }],
]);
// 1 area → 2 menu → 3 link(FN); 4 Develop area (anchor 5) → 6 menu; legacy: 7 Function at the root, 8 → 9 Function under an area,
// 2 → 3 → 10 too deep; 11 ↔ 12 cycle.
const ITEMS: NavigationItem[] = [
  row(1, null), row(2, 1), row(3, 2, { moduleId: MOD, functionId: FN }),
  row(4, null, { menuTitle: 'Develop' }), row(5, 4, { isVisible: false, sortOrder: DEVELOP_ANCHOR_ORDER }), row(6, 4),
  row(7, null, { moduleId: DEV_MOD, functionId: DEV_FN }), row(8, null), row(9, 8, { moduleId: MOD, functionId: FN }),
  row(10, 3), row(11, 12), row(12, 11),
];
function storedDraft(items: readonly NavigationItem[]): Draft {
  const l = readLayout(items);
  return {
    revision: l.revision,
    areas: l.areas.map((a) => ({ id: a.id, title: a.title, visible: a.visible, develop: a.develop, menus: a.menus.map((mn) => ({ id: mn.id, title: mn.title, visible: mn.visible, items: mn.items.map((i) => ({ id: i.id, functionId: i.functionId, title: i.title, visible: i.visible })) })) })),
    legacy: [],
  };
}

describe('Navigation Builder model', () => {
  it('M1 readLayout: 3 levels, Develop by its anchor (never by title), legacy classified, anchor never listed', () => {
    const l = readLayout(ITEMS);
    expect(l.developAreaId).toBe(n(4));
    expect(l.areas.map((a) => [a.id, a.develop, a.menus.map((mn) => mn.id)])).toEqual([[n(1), false, [n(2)]], [n(4), true, [n(6)]], [n(8), false, []]]);
    expect(l.legacy.map((x) => [x.id, x.reason]).sort()).toEqual([
      [n(10), 'TOO_DEEP'], [n(11), 'UNREACHABLE'], [n(12), 'UNREACHABLE'], [n(7), 'FUNCTION_AT_ROOT'], [n(9), 'FUNCTION_UNDER_AREA'],
    ].sort());
    expect(JSON.stringify(l)).not.toContain(n(5));
    expect(l.legacy.filter((x) => x.inDevelop)).toEqual([]);
    const deep = readLayout([...ITEMS, row(13, 6, { moduleId: DEV_MOD, functionId: DEV_FN }), row(14, 13)]);
    expect(deep.legacy.find((x) => x.id === n(14))).toMatchObject({ reason: 'TOO_DEEP', inDevelop: true, path: ['Develop', 'R6', 'R13'] });
    expect(developAreaId(ITEMS.map((i) => (i.navigationId === n(5) ? { ...i, isVisible: true } : i)))).toBeNull();
    expect(developAreaId(ITEMS.map((i) => (i.navigationId === n(4) ? { ...i, menuTitle: 'Tên mới' } : i)))).toBe(n(4));
  });

  it('M2 revision changes with any stored value, not with row order', () => {
    const r = revisionOf(ITEMS);
    expect(revisionOf([...ITEMS].reverse())).toBe(r);
    expect(revisionOf(ITEMS.map((i) => (i.navigationId === n(10) ? { ...i, isVisible: false } : i)))).not.toBe(r);
  });

  it('M3 Developer Function: rejected outside Develop (even hidden when new), accepted inside Develop', () => {
    const outside = storedDraft(ITEMS);
    outside.areas[0]?.menus[0]?.items.push({ id: null, functionId: DEV_FN, title: 'x', visible: false });
    expect(validateDraft(outside, ITEMS, facts)).toContainEqual({ code: 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP', ref: '0.0.1' });
    const inside = storedDraft(ITEMS);
    inside.areas[1]?.menus[0]?.items.push({ id: null, functionId: DEV_FN, title: 'x', visible: true });
    expect(validateDraft(inside, ITEMS, facts)).toEqual([]);
    // A misplaced row already stored VISIBLE is kept (the sidebar removes it); a hidden one may not be shown again.
    expect(validateDraft({ ...storedDraft(ITEMS), legacy: [{ id: n(7), visible: true }] }, ITEMS, facts)).toEqual([]);
    const hiddenItems = ITEMS.map((i) => (i.navigationId === n(7) ? { ...i, isVisible: false } : i));
    expect(validateDraft({ ...storedDraft(hiddenItems), legacy: [{ id: n(7), visible: true }] }, hiddenItems, facts))
      .toContainEqual({ code: 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP', ref: n(7) });
    const placed = [...ITEMS, row(20, 2, { moduleId: DEV_MOD, functionId: DEV_FN })];
    expect(validateDraft(storedDraft(placed), placed, facts)).toEqual([]);
    const placedHidden = placed.map((i) => (i.navigationId === n(20) ? { ...i, isVisible: false } : i));
    const reShown = storedDraft(placedHidden);
    const again = reShown.areas[0]?.menus[0]?.items[1];
    if (again) again.visible = true;
    expect(validateDraft(reShown, placedHidden, facts)).toContainEqual({ code: 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP', ref: '0.0.1' });
  });

  it('M8 sort_order: an unchanged order keeps the stored values; new rows continue after them; a reorder renumbers', () => {
    const items = [row(1, null, { sortOrder: 10 }), row(2, 1, { sortOrder: 5 }), row(3, 2, { moduleId: MOD, functionId: FN, sortOrder: 40 }),
      row(4, null, { sortOrder: 20, menuTitle: 'Develop' }), row(5, 4, { isVisible: false, sortOrder: DEVELOP_ANCHOR_ORDER })];
    expect(planDraft(storedDraft(items), items, facts)).toEqual({ inserts: [], updates: [] });
    const add = storedDraft(items);
    add.areas[0]?.menus.push({ id: null, title: 'Mới', visible: true, items: [] });
    expect(planDraft(add, items, facts)).toMatchObject({ inserts: [{ kind: 'menu', sortOrder: 6 }], updates: [] });
    const swap = storedDraft(items);
    swap.areas.reverse();
    expect(planDraft(swap, items, facts).updates.map((u) => [u.id, u.sortOrder])).toEqual([[n(4), 0], [n(1), 1]]);
  });

  it('M4 module rule: a link under a module-scoped menu must belong to that module', () => {
    const items = [...ITEMS, row(20, 1, { moduleId: DEV_MOD })];
    const d = storedDraft(items);
    const menu = d.areas[0]?.menus.find((mn) => mn.id === n(20));
    menu?.items.push({ id: null, functionId: FN, title: 'x', visible: true });
    expect(validateDraft(d, items, facts)).toContainEqual({ code: 'FUNCTION_MODULE_MISMATCH', ref: '0.1.0' });
  });

  it('M5 a link may not change its Function; hidden duplicates do not block; restoring re-checks', () => {
    const d = storedDraft(ITEMS);
    const link = d.areas[0]?.menus[0]?.items[0];
    if (link) link.functionId = DEV_FN;
    expect(validateDraft(d, ITEMS, facts).map((i) => i.code)).toContain('FUNCTION_CHANGED');
    const dup = storedDraft(ITEMS);
    dup.areas[0]?.menus[0]?.items.push({ id: null, functionId: FN, title: 'ẩn', visible: false });
    expect(validateDraft(dup, ITEMS, facts)).toEqual([]);
    const shown = dup.areas[0]?.menus[0]?.items[1];
    if (shown) shown.visible = true;
    expect(validateDraft(dup, ITEMS, facts)).toContainEqual({ code: 'FUNCTION_DUPLICATE_IN_MENU', ref: '0.0.1' });
  });

  it('M6 planDraft: moving a menu re-links the menu and its links, hides the old menu; no-op draft plans nothing', () => {
    // sort_order is the position in the draft: the first save normalises it, a second identical save plans nothing.
    const first = planDraft(storedDraft(ITEMS), ITEMS, facts);
    expect(first.inserts).toEqual([]);
    const byUpdate = new Map(first.updates.map((u) => [u.id, u]));
    const normalised = ITEMS.map((i) => ({ ...i, sortOrder: byUpdate.get(i.navigationId)?.sortOrder ?? i.sortOrder }));
    expect(planDraft(storedDraft(normalised), normalised, facts)).toEqual({ inserts: [], updates: [] });
    const d = storedDraft(normalised);
    const menu = d.areas[0]?.menus.pop();
    if (menu) d.areas[1]?.menus.push(menu);
    expect(validateDraft(d, normalised, facts)).toEqual([]);
    const p = planDraft(d, normalised, facts);
    expect(p.inserts.map((i) => [i.kind, i.replaces, i.parent])).toEqual([['menu', n(2), { existing: n(4) }], ['link', n(3), { inserted: 0 }]]);
    expect(p.updates.map((u) => [u.id, u.visible])).toEqual([[n(2), false], [n(3), false]]);
  });

  it('M7 runtime sidebar removes a Developer Function outside Develop and keeps the empty Develop area', () => {
    const allowed = new Map<string, MenuFunction>([[DEV_FN, { moduleId: DEV_MOD, routePath: '/dev', screenKey: 'dev', developer: true }]]);
    const items = [row(1, null), row(2, 1), row(3, 2, { moduleId: DEV_MOD, functionId: DEV_FN }), row(4, null, { menuTitle: 'Develop' }), row(5, 4, { isVisible: false, sortOrder: DEVELOP_ANCHOR_ORDER })];
    const out = buildMenu(items, allowed, n(4));
    expect(titles(out)).toEqual([['Develop']]);
    expect(out[0]?.developArea).toBe(true);
    const inside = [...items, row(6, 4), row(7, 6, { moduleId: DEV_MOD, functionId: DEV_FN })];
    expect(titles(buildMenu(inside, allowed, n(4)))).toEqual([['Develop', [['R6', [['R7']]]]]]);
    // No DEVELOP area stored yet: the stored menu is kept as it was (module screens stay reachable until relocated).
    expect(titles(buildMenu(items.slice(0, 3), allowed, null))).toEqual([['R1', [['R2', [['R3']]]]]]);
  });
});
