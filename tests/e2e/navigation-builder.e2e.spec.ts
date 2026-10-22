import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

// NAVIGATION BUILDER (owner decisions of 22/10/2026) — MOCK level: the API is intercepted, what is checked is what the shell
// and the Builder SHOW and SEND. The server rules (validation, revision, transaction, B08) are covered by the backend unit
// and PostgreSQL tests. NAV-* = acceptance items of the master prompt.

const CAPS = ['foundation.module_registry.read', 'foundation.navigation.manage', 'iam.accounts.read', 'iam.roles.manage'];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SALES = uuid(900);
const DI = uuid(901);
const ST = uuid(902);
const FN = { order: uuid(910), report: uuid(911), catalog: uuid(912), runner: uuid(913) };
const ID = { area: uuid(1), menuA: uuid(2), link: uuid(3), menuB: uuid(4), develop: uuid(5), legacy: uuid(6) };

// GET /api/foundation/navigation: one Function (route /system-test) linked from two menus + the DEVELOP area.
const node = (id: string, title: string, routePath: string | null, children: unknown[] = [], developArea = false) => ({
  navigationId: id, moduleId: null, functionId: routePath ? FN.order : null, menuTitle: title, sortOrder: 0, routePath, screenKey: null, developArea, children,
});
const MENU = [
  node(ID.area, 'Kinh doanh', null, [
    node(ID.menuA, 'Bán hàng', null, [node(ID.link, 'Đơn hàng', '/system-test')]),
    node(ID.menuB, 'Báo cáo nhanh', null, [node(uuid(7), 'Đơn hàng (lối tắt)', '/system-test')]),
  ]),
  node(ID.develop, 'Phát triển', null, [], true),
];

const LAYOUT = {
  revision: 'a'.repeat(64), developAreaId: ID.develop,
  areas: [
    { id: ID.area, moduleId: null, title: 'Kinh doanh', visible: true, develop: false, menus: [
      { id: ID.menuA, moduleId: null, title: 'Bán hàng', visible: true, items: [{ id: ID.link, functionId: FN.order, moduleId: SALES, title: 'Đơn hàng', visible: true }] },
      { id: ID.menuB, moduleId: null, title: 'Báo cáo nhanh', visible: true, items: [] },
    ] },
    { id: ID.develop, moduleId: null, title: 'Phát triển', visible: true, develop: true, menus: [] },
  ],
  legacy: [{ id: ID.legacy, kind: 'function', functionId: FN.catalog, moduleId: DI, title: 'Data Inspector', visible: true, path: [], inDevelop: false, reason: 'FUNCTION_AT_ROOT' }],
};
const fn = (functionId: string, moduleId: string, moduleKey: string, moduleName: string, functionKey: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  functionId, moduleId, moduleKey, moduleName, functionKey, displayName, assignable: true, reason: null, developer: false, ...extra,
});
const FUNCTIONS = [
  fn(FN.order, SALES, 'SALES', 'Bán hàng', 'ORDER', 'Đơn hàng'),
  fn(FN.report, SALES, 'SALES', 'Bán hàng', 'REPORT', 'Báo cáo', { assignable: false, reason: 'NO_ROUTE_OR_PERMISSION' }),
  fn(FN.catalog, DI, 'DATA_INSPECTOR', 'Data Inspector', 'CATALOG', 'Danh mục bảng', { developer: true }),
  fn(FN.runner, ST, 'SYSTEM_TEST', 'System Test', 'TEST_RUNNER', 'Chạy test', { developer: true }),
];

interface Mock { puts: unknown[]; previews: unknown[]; menuReads: number; putStatus: number }
// The draft sent by the Builder (PUT body), shape checked by the assertions of each test.
interface SentDraft {
  revision: string;
  areas: { id: string | null; title: string; visible: boolean; develop: boolean; menus: { id: string | null; title: string; visible: boolean; items: { id: string | null; functionId: string; title: string; visible: boolean }[] }[] }[];
  legacy: { id: string; visible: boolean }[];
}
const sent = (mock: Mock, index = 0): SentDraft => JSON.parse(JSON.stringify(mock.puts[index] ?? null));

async function open(page: Page, putStatus = 200): Promise<Mock> {
  const mock: Mock = { puts: [], previews: [], menuReads: 0, putStatus };
  await page.route('**/api/**', async (route) => {
    const request: Request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: uuid(800), username: 'tester', fullName: 'Kiểm thử điều hướng' }, expiresAt: '2026-10-23T00:00:00.000Z', serverTime: '2026-10-22T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') {
      mock.menuReads += 1;
      return json({ navigation: MENU });
    }
    if (path === '/api/iam/admin/me/capabilities') return json({ permissions: Object.fromEntries(CAPS.map((c) => [c, true])) });
    if (path === '/api/foundation/navigation/builder' && request.method() === 'GET') return json({ layout: LAYOUT });
    if (path === '/api/foundation/navigation/builder' && request.method() === 'PUT') {
      mock.puts.push(request.postDataJSON());
      if (mock.putStatus === 409) return json({ error: { code: 'NAVIGATION_CONFLICT', message: 'x', requestId: 'r' } }, 409);
      return json({ layout: LAYOUT });
    }
    if (path === '/api/foundation/navigation/builder/functions') return json({ functions: FUNCTIONS });
    if (path === '/api/foundation/navigation/builder/preview') {
      mock.previews.push(request.postDataJSON());
      return json({ navigation: [node(ID.area, 'Kinh doanh', null, [node(ID.menuB, 'Báo cáo nhanh', null, [node('draft:0', 'Đơn hàng', '/system-test')])])] });
    }
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return mock;
}

const sidebar = (page: Page) => page.locator('aside.sidebar');
const crumb = (page: Page) => page.locator('#crumb');
const row = (page: Page, title: string) => page.locator('.nb-row', { has: page.locator('.nb-title', { hasText: new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`) }) });
const fnRow = (page: Page, name: string) => page.locator('.nb-fn', { has: page.locator('.nb-fn-name', { hasText: new RegExp(`^${name}$`) }) });
async function builder(page: Page) {
  await page.goto('/foundation/navigation');
  await page.locator('#tabs button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Kho chức năng' })).toBeVisible();
  await page.getByRole('button', { name: 'Mở tất cả' }).click();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('NAV-01 / NAV-02 sidebar: no fixed "Quản trị" heading; the DEVELOP area (stored title) holds the system screens', async ({ page }) => {
  await open(page);
  await page.goto('/');
  await expect(sidebar(page).locator('.nav-section')).toHaveCount(0);
  await expect(sidebar(page).getByText('Quản trị', { exact: true })).toHaveCount(0);
  await expect(sidebar(page).getByRole('button', { name: 'Kinh doanh', exact: true })).toBeVisible();
  const top = await sidebar(page).locator('nav > .menu-entry > .nav-btn .nav-label').allInnerTexts();
  expect(top).toEqual(['Trang chủ', 'Kinh doanh', 'Phát triển']);
  await sidebar(page).getByRole('button', { name: 'Phát triển', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Foundation', exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /IAM/ })).toBeVisible();
  // A system screen opened by URL: its crumb follows the sidebar tree (Develop › Foundation › screen).
  await page.goto('/foundation/modules');
  await expect(crumb(page)).toHaveText('Phát triển › Foundation › Quản lý Module');
});

test('NAV-05 / NAV-12 multi-link: each link keeps its own active item and crumb; reload, back / forward; a direct URL picks the first link', async ({ page }) => {
  await open(page);
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: 'Kinh doanh', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Báo cáo nhanh', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Đơn hàng (lối tắt)' }).click();
  await expect(page).toHaveURL(/\/system-test$/);
  const active = sidebar(page).locator('.sub .nav-fn.active');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText('Đơn hàng (lối tắt)');
  await expect(crumb(page)).toHaveText('Kinh doanh › Báo cáo nhanh › Đơn hàng (lối tắt)');
  await page.reload();
  await expect(sidebar(page).locator('.sub .nav-fn.active')).toHaveText('Đơn hàng (lối tắt)');
  await expect(crumb(page)).toHaveText('Kinh doanh › Báo cáo nhanh › Đơn hàng (lối tắt)');
  await sidebar(page).getByRole('button', { name: 'Bán hàng', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Đơn hàng', exact: true }).click(); // same path, other link → new entry
  await expect(sidebar(page).locator('.sub .nav-fn.active')).toHaveText('Đơn hàng');
  await expect(crumb(page)).toHaveText('Kinh doanh › Bán hàng › Đơn hàng');
  await page.goBack();
  await expect(sidebar(page).locator('.sub .nav-fn.active')).toHaveText('Đơn hàng (lối tắt)');
  await page.goForward();
  await expect(sidebar(page).locator('.sub .nav-fn.active')).toHaveText('Đơn hàng');
  // A direct URL (no link chosen): the first link in tree order, deterministically.
  const fresh = await page.context().newPage();
  await open(fresh);
  await fresh.goto('/system-test');
  await expect(sidebar(fresh).locator('.sub .nav-fn.active')).toHaveText('Đơn hàng');
  await expect(crumb(fresh)).toHaveText('Kinh doanh › Bán hàng › Đơn hàng');
});

test('NAV-03 / NAV-04 / NAV-07 inventory: real Functions with module + key and where linked; "Đã có trong menu"; not assignable / Developer blocked outside Develop', async ({ page }) => {
  await open(page);
  await builder(page);
  await expect(page.locator('.nb-fn')).toHaveCount(4);
  await expect(fnRow(page, 'Đơn hàng')).toContainText('SALES · ORDER');
  await expect(fnRow(page, 'Đơn hàng')).toContainText('Đang gắn: Kinh doanh › Bán hàng');
  await row(page, 'Bán hàng').click();
  await expect(fnRow(page, 'Đơn hàng')).toContainText('Đã có trong menu');
  await expect(fnRow(page, 'Đơn hàng').getByRole('checkbox')).toBeDisabled();
  await expect(fnRow(page, 'Báo cáo').getByRole('checkbox')).toBeDisabled();
  await expect(fnRow(page, 'Chạy test').getByRole('checkbox')).toBeDisabled();
  await expect(fnRow(page, 'Chạy test')).toContainText('Developer Function chỉ được đặt trong Develop');
  // Inside Develop the Developer Function is allowed.
  await row(page, 'Phát triển').click();
  await page.getByRole('button', { name: '+ Thêm menu' }).click();
  await expect(fnRow(page, 'Chạy test').getByRole('checkbox')).toBeEnabled();
});

test('NAV-05 / NAV-06 / NAV-09 / NAV-10 draft: add a second link of one Function, unsaved marker, cancel restores, save sends the whole draft once and reloads the sidebar', async ({ page }) => {
  const mock = await open(page);
  await builder(page);
  await expect(page.getByText('Không có thay đổi')).toBeVisible();
  await row(page, 'Báo cáo nhanh').click();
  await fnRow(page, 'Đơn hàng').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Thêm 1 chức năng vào “Báo cáo nhanh”' }).click();
  await expect(page.locator('.nb-unsaved')).toHaveText('● Có thay đổi chưa lưu');
  await expect(row(page, 'Báo cáo nhanh').locator('xpath=..').locator('.nb-link .nb-title')).toHaveText(['Đơn hàng']);
  await expect(page.locator('.nb-dot').first()).toBeVisible();
  expect(mock.puts).toHaveLength(0); // nothing written while editing
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Hủy thay đổi' }).click();
  await expect(page.getByText('Không có thay đổi')).toBeVisible();
  // Again, then save.
  await row(page, 'Báo cáo nhanh').click();
  await fnRow(page, 'Đơn hàng').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Thêm 1 chức năng vào “Báo cáo nhanh”' }).click();
  await page.locator('.nb-panel input').first().waitFor();
  const reads = mock.menuReads;
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText('Đã lưu cấu hình điều hướng.')).toBeVisible();
  expect(mock.puts).toHaveLength(1);
  const body = sent(mock);
  expect(body.revision).toBe(LAYOUT.revision);
  expect(body.areas.map((a) => a.id)).toEqual([ID.area, ID.develop]);
  expect(body.areas[0]?.menus[1]?.items).toEqual([{ id: null, functionId: FN.order, title: 'Đơn hàng', visible: true }]);
  expect(body.areas[0]?.menus[0]?.items).toEqual([{ id: ID.link, functionId: FN.order, title: 'Đơn hàng', visible: true }]);
  expect(JSON.stringify(body)).not.toMatch(/icon|sortOrder/i); // the backend computes sort_order; no icon (Q13)
  await expect.poll(() => mock.menuReads).toBeGreaterThan(reads); // sidebar reloaded without a new sign-in
});

test('NAV-08 drag & drop: Function from the inventory into a menu, a link to another menu (re-link), a menu to another area; refused drops explain why', async ({ page }) => {
  const mock = await open(page);
  await builder(page);
  await fnRow(page, 'Đơn hàng').dragTo(row(page, 'Báo cáo nhanh'));
  await expect(page.locator('.nb-unsaved')).toBeVisible();
  // Duplicate refused: a second visible ORDER into "Bán hàng".
  await fnRow(page, 'Đơn hàng').dragTo(row(page, 'Bán hàng'));
  await expect(row(page, 'Bán hàng').locator('xpath=..').locator('.nb-link')).toHaveCount(1);
  // Move the stored link of "Bán hàng" to the new menu of Develop? Refused (Báo cáo nhanh already has ORDER) → move to Develop menu instead.
  await row(page, 'Phát triển').click();
  await page.getByRole('button', { name: '+ Thêm menu' }).click();
  await page.locator('.nb-panel input').first().fill('Công cụ');
  await row(page, 'Bán hàng').locator('xpath=..').locator('.nb-link .nb-handle').first().dragTo(row(page, 'Công cụ'));
  await expect(row(page, 'Công cụ').locator('xpath=..').locator('.nb-link .nb-title')).toHaveText(['Đơn hàng']);
  // Menu "Báo cáo nhanh" dragged onto the Develop area.
  await row(page, 'Báo cáo nhanh').locator('.nb-handle').dragTo(row(page, 'Phát triển'));
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect.poll(() => mock.puts.length).toBe(1);
  const body = sent(mock);
  expect(body.areas[0]?.menus.map((m) => m.id)).toEqual([ID.menuA]);
  expect(body.areas[0]?.menus[0]?.items).toEqual([]);
  expect(body.areas[1]?.menus.map((m) => [m.id, m.title])).toEqual([[null, 'Công cụ'], [ID.menuB, 'Báo cáo nhanh']]);
  expect(body.areas[1]?.menus[0]?.items.map((i) => i.id)).toEqual([ID.link]); // the stored link moved (server re-links)
});

test('NAV-11 remove a menu with Functions: move them to another menu then hide it (no DELETE), applied on save', async ({ page }) => {
  const mock = await open(page);
  await builder(page);
  await row(page, 'Bán hàng').click();
  await page.getByRole('button', { name: 'Gỡ menu' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ẩn cả nhánh');
  await dialog.getByLabel(/Chuyển các chức năng sang menu khác/).check();
  await dialog.getByRole('button', { name: 'Áp dụng vào bản nháp' }).click();
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect.poll(() => mock.puts.length).toBe(1);
  const body = sent(mock);
  expect(body.areas[0]?.menus.map((m) => [m.id, m.visible, m.items.map((i) => i.id)])).toEqual([[ID.menuA, false, []], [ID.menuB, true, [ID.link]]]);
});

test('NAV-13 Developer Function outside Develop: one click moves it into Develop (legacy row hidden, never deleted)', async ({ page }) => {
  const mock = await open(page);
  await builder(page);
  await expect(page.locator('.nb-devnote')).toContainText('1 Developer Function đang nằm ngoài Develop');
  await page.getByRole('button', { name: 'Chuyển Developer Function vào Develop' }).click();
  await expect(row(page, 'Data Inspector')).toHaveCount(2); // the new Develop menu and its link
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect.poll(() => mock.puts.length).toBe(1);
  const body = sent(mock);
  expect(body.areas.find((a) => a.develop)?.menus).toEqual([{ id: null, title: 'Data Inspector', visible: true, items: [{ id: null, functionId: FN.catalog, title: 'Data Inspector', visible: true }] }]);
  expect(body.legacy).toEqual([{ id: ID.legacy, visible: false }]);
});

test('NAV-14 preview: design tree and "as this account" (POST preview, nothing saved)', async ({ page }) => {
  const mock = await open(page);
  await builder(page);
  await fnRow(page, 'Đơn hàng').dragTo(row(page, 'Báo cáo nhanh'));
  await page.getByRole('button', { name: 'Xem trước' }).click();
  const preview = page.getByRole('region', { name: 'Xem trước' });
  await expect(preview).toContainText('Màn hình hệ thống (Foundation, IAM)');
  await preview.getByRole('button', { name: 'Theo tài khoản hiện tại' }).click();
  await expect.poll(() => mock.previews.length).toBe(1);
  await expect(preview).toContainText('Báo cáo nhanh');
  expect(mock.puts).toHaveLength(0);
});

test('NAV-15 conflict and leaving: 409 keeps the draft and offers a reload; leaving with unsaved changes asks first', async ({ page }) => {
  const mock = await open(page, 409);
  await builder(page);
  await fnRow(page, 'Đơn hàng').dragTo(row(page, 'Báo cáo nhanh'));
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByRole('button', { name: 'Tải lại cấu hình mới nhất' })).toBeVisible();
  await expect(page.locator('.nb-unsaved')).toBeVisible(); // the draft is still there
  expect(mock.puts).toHaveLength(1);
  page.once('dialog', (d) => void d.dismiss());
  await sidebar(page).getByRole('button', { name: 'Trang chủ' }).click();
  await expect(page).toHaveURL(/\/foundation\/navigation$/);
  page.once('dialog', (d) => void d.accept());
  await sidebar(page).getByRole('button', { name: 'Trang chủ' }).click();
  await expect(page).toHaveURL(/\/$/);
});
