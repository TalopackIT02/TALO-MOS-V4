import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// MASTER CONTRACT 2026-10-20 — WS01 (dynamic sidebar) / WS02 (one B09 manager) / WS03 (DataTable) / WS06 (layers 1 + 2:
// menu visibility and direct-URL screen access) for six session profiles. The API is intercepted: what is checked here is
// what the AppShell SHOWS for a given menu + capability answer, and which admin APIs it does NOT call. Layer 3 (the API
// refuses) is covered by the backend unit / PostgreSQL tests.

const ALL_CAPS = [
  'foundation.module_registry.read', 'foundation.module_registry.create', 'foundation.module_version.read', 'foundation.module_version.create',
  'foundation.module_version.update', 'foundation.module_version.submit', 'foundation.module_version.approve', 'foundation.module_version.reject',
  'foundation.module_version.activate', 'foundation.module_version.retire', 'foundation.module_registry.enable', 'foundation.module_registry.disable',
  'foundation.navigation.manage', 'iam.accounts.read', 'iam.roles.manage', 'iam.permissions.manage', 'iam.assignments.manage',
];
const caps = (allowed: readonly string[]) => Object.fromEntries(ALL_CAPS.map((c) => [c, allowed.includes(c)]));

const node = (id: string, title: string, routePath: string | null, children: unknown[] = []) => ({
  navigationId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, moduleId: null, functionId: null, menuTitle: title, sortOrder: 0, routePath, screenKey: null, children,
});
const SYSTEM_TEST_MENU = [node('1', 'Test System', null, [node('2', 'Kiểm tra hệ thống', '/system-test'), node('3', 'Chạy test & xem kết quả', '/system-test/runner')])]; // SYSTEM_TEST 1.1.1 routes

const ACCOUNT = {
  accountId: '30000000-0000-4000-8000-000000000001', username: 'nv.an', accountStatus: 'ACTIVE', disabled: false, employeeCode: 'NV001', fullName: 'Nguyễn An',
  membershipStatus: 'ACTIVE', isRoot: false,
};

interface Profile {
  readonly caps: readonly string[];
  readonly menu: unknown[];
}

async function open(page: Page, profile: Profile) {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    calls.push(`${request.method()} ${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') {
      return json({
        status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử quyền' },
        expiresAt: '2026-10-21T00:00:00.000Z', serverTime: '2026-10-20T00:00:00.000Z',
      });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: profile.menu });
    if (path === '/api/iam/admin/me/capabilities') return json({ permissions: caps(profile.caps) });
    if (path === '/api/foundation/modules') return json({ modules: [] });
    if (path === '/api/iam/admin/accounts') return json({ accounts: [ACCOUNT], total: 1, page: 1, pageSize: 25 });
    if (path === `/api/iam/admin/accounts/${ACCOUNT.accountId}`) return json({ account: ACCOUNT });
    if (path === `/api/iam/admin/accounts/${ACCOUNT.accountId}/roles`) return json({ roles: [] });
    if (path === `/api/iam/admin/accounts/${ACCOUNT.accountId}/permissions`) return json({ direct: [], effective: [], assumption: 'TARGET_SESSION_MEETS_MINIMUM_ASSURANCE' });
    if (path === '/api/iam/admin/roles') return json({ roles: [] });
    if (path === '/api/iam/admin/permissions') return json({ permissions: [] });
    if (path === '/api/iam/admin/permission-tree') return json({ tree: { modules: [], platform: [], unbound: [] } });
    if (path === '/api/iam/admin/foundation/navigation/items') return json({ items: [] });
    if (path === '/api/iam/admin/foundation/modules') return json({ modules: [] });
    if (path === '/api/foundation/navigation/builder') return json({ layout: { revision: '0'.repeat(64), developAreaId: null, areas: [], legacy: [] } });
    if (path === '/api/foundation/navigation/builder/functions') return json({ functions: [] });
    // Module (SYSTEM_TEST) screen APIs are not under test here.
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return calls;
}

const sidebar = (page: Page) => page.locator('aside.sidebar');
const guard = (page: Page) => page.getByText('Bạn không có quyền truy cập màn hình này.');
const tabs = (page: Page) => page.locator('#tabs button');

test.use({ viewport: { width: 1440, height: 900 } });

test('P1 no rights at all: only Home, no admin section / cards; admin URL → notice and no admin API call', async ({ page }) => {
  const calls = await open(page, { caps: [], menu: [] });
  await page.goto('/');
  await expect(page.getByText('Chưa có chức năng nghiệp vụ nào được cấp quyền cho tài khoản này.')).toBeVisible();
  await expect(sidebar(page).locator('.nav-btn')).toHaveCount(1);
  await expect(sidebar(page).getByText('Quản trị')).toHaveCount(0);
  await expect(page.locator('.cards')).toHaveCount(0);
  for (const url of ['/iam/accounts', '/iam/roles', '/foundation/modules', '/foundation/navigation']) {
    await page.goto(url);
    await expect(guard(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  }
  expect(calls.filter((c) => /\/api\/(iam\/admin\/(?!me\/capabilities)|foundation\/modules)/.test(c))).toEqual([]);
});

test('P2 SYSTEM_TEST only: sidebar group from B09 (no hard-coding), Home = same menu, retired route opens Home', async ({ page }) => {
  await open(page, { caps: [], menu: SYSTEM_TEST_MENU });
  await page.goto('/');
  await expect(sidebar(page).getByRole('button', { name: 'Test System' })).toBeVisible();
  await expect(sidebar(page).getByText('Quản trị')).toHaveCount(0);
  await expect(page.locator('#body').getByRole('button', { name: 'Chạy test & xem kết quả' })).toBeVisible(); // home menu
  await sidebar(page).getByRole('button', { name: 'Test System' }).click();
  await sidebar(page).locator('.sub').getByRole('button', { name: 'Chạy test & xem kết quả' }).click();
  await expect(page).toHaveURL(/\/system-test\/runner$/);
  await expect(page.locator('#crumb')).toHaveText('Test System › Chạy test & xem kết quả');
  await expect(tabs(page)).toHaveText(['System Diagnostics', 'Test Runner & Results']); // both tabs are menu routes
  await expect(sidebar(page).locator('.sub button.active')).toHaveText('Chạy test & xem kết quả');
  // The retired Data Viewer route (SYSTEM_TEST 1.0.x) is no shell screen any more: it opens Home.
  await page.goto('/system-test/data');
  await expect(page).toHaveURL(/\/$/);
  // Search offers only what the menu / capabilities allow.
  await page.goto('/');
  await page.locator('#search').fill('Quản lý tài khoản');
  await expect(page).toHaveURL(/\/$/);
  await page.locator('#search').fill('xem kết quả');
  await expect(page).toHaveURL(/\/system-test\/runner$/);
});

test('P3 Foundation view only: Foundation › Quản lý Module only; register tab and navigation hidden; IAM hidden', async ({ page }) => {
  await open(page, { caps: ['foundation.module_registry.read', 'foundation.module_version.read'], menu: [] });
  await page.goto('/');
  await expect(page.locator('.cards .card')).toHaveCount(1);
  await sidebar(page).getByRole('button', { name: 'Develop', exact: true }).click(); // system screens live in DEVELOP
  await sidebar(page).getByRole('button', { name: 'Foundation' }).click();
  await expect(sidebar(page).locator('.sub .nav-fn')).toHaveText(['Quản lý Module']);
  await expect(sidebar(page).getByRole('button', { name: /IAM/ })).toHaveCount(0);
  await page.goto('/foundation/modules');
  await expect(tabs(page)).toHaveText(['Module & Phiên bản']);
  await page.goto('/foundation/navigation');
  await expect(guard(page)).toBeVisible();
});

test('P4 IAM READ only: accounts with server Field Search / sort; roles refused; no write controls', async ({ page }) => {
  const calls = await open(page, { caps: ['iam.accounts.read'], menu: [] });
  await page.goto('/iam/accounts');
  await expect(page.locator('#title')).toHaveText('QUẢN LÝ TÀI KHOẢN');
  await expect(page.getByRole('cell', { name: /nv\.an/ })).toBeVisible();
  await page.getByLabel('Trường tìm kiếm').selectOption({ label: 'Họ tên' });
  await page.getByLabel('Từ khóa').fill('An');
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect.poll(() => calls.some((c) => c.includes('/api/iam/admin/accounts?') && c.includes('field=fullName') && c.includes('search=An'))).toBe(true);
  await page.getByRole('button', { name: /^Mã nhân viên/ }).click();
  await expect.poll(() => calls.some((c) => c.includes('sort=employeeCode') && c.includes('dir=asc'))).toBe(true);
  await page.getByRole('button', { name: 'Chi tiết' }).click();
  await expect(page.locator('.acc-drawer')).toContainText('Nguyễn An');
  await page.locator('.acc-drawer').getByRole('button', { name: 'Quản lý tài khoản' }).click();
  for (const section of ['Vai trò', 'Chức năng & Quyền']) {
    await page.getByRole('tab', { name: section }).click();
    await expect(page.getByRole('button', { name: 'Gán vai trò' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cấp quyền trực tiếp' })).toHaveCount(0);
  }
  await sidebar(page).getByRole('button', { name: /IAM/ }).click();
  await expect(sidebar(page).locator('.sub .nav-fn')).toHaveText(['Quản lý tài khoản']);
  await page.goto('/iam/roles');
  await expect(guard(page)).toBeVisible();
});

test('P5 role manager: roles screen with two tabs (no B09 tab in IAM), accounts hidden and refused', async ({ page }) => {
  await open(page, { caps: ['iam.roles.manage'], menu: [] });
  await page.goto('/iam/roles');
  await expect(tabs(page)).toHaveText(['Vai trò', 'Danh mục Permission']);
  await expect(page.getByRole('button', { name: 'Tạo vai trò' })).toBeVisible();
  await page.goto('/iam/accounts');
  await expect(guard(page)).toBeVisible();
});

test('P6 root admin: every admin screen; B09 managed in Foundation by name (no UUID field); compact flyout works', async ({ page }) => {
  await open(page, { caps: ALL_CAPS, menu: SYSTEM_TEST_MENU });
  await page.goto('/');
  await expect(page.locator('.cards .card')).toHaveCount(4);
  await page.goto('/foundation/navigation');
  await expect(tabs(page)).toHaveText(['Menu của tôi', 'Quản trị menu (B09)']);
  await tabs(page).nth(1).click();
  await expect(page.getByRole('list', { name: 'Cấu hình điều hướng (bản nháp)' })).toBeVisible(); // Navigation Builder (REV-01: inventory in a drawer)
  await expect(page.getByRole('button', { name: 'Lưu cấu hình' })).toBeVisible();
  await expect(page.locator('#body')).not.toContainText('UUID');
  await page.goto('/iam/roles');
  await expect(tabs(page)).toHaveText(['Vai trò', 'Danh mục Permission']);
  // Compact sidebar: a business group opens its flyout with the B09 items.
  await page.locator('#collapse-button').click();
  await sidebar(page).getByRole('button', { name: 'Test System' }).click();
  await expect(sidebar(page).locator('.flyout-open .flyout')).toContainText('Chạy test & xem kết quả');
});
