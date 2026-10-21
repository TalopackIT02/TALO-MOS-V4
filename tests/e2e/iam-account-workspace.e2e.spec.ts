import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// IAM-B-UI-01 — account list (state in the URL query), detail drawer over the list (no layout shift), account management
// workspace /iam/accounts/:id, browser Back / Forward and "← Quay lại danh sách". API intercepted (MOCK): only the UI and
// the navigation are under test here; the server rules are covered by the backend suites.

const ROOT = '0e7b0190-0173-4bc2-8e35-816730a4002b';
const idOf = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = '70000000-0000-4000-8000-000000000001';
const ALL = ['iam.accounts.read', 'iam.accounts.create', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read', 'iam.assignments.manage'];

const account = (n: number) => ({
  accountId: idOf(n), username: `nv${String(n).padStart(4, '0')}`, accountStatus: 'ACTIVE', disabled: false,
  employeeCode: `E${String(n).padStart(4, '0')}`, fullName: `Nhân viên ${n}`, membershipStatus: 'ACTIVE', isRoot: false,
});
const rootAccount = { accountId: ROOT, username: 'admin', accountStatus: 'ACTIVE', disabled: false, employeeCode: 'ADMIN', fullName: 'Quản trị gốc', membershipStatus: 'ACTIVE', isRoot: true };
const ACCOUNTS = [rootAccount, ...Array.from({ length: 60 }, (_, i) => account(i + 1))];

interface Setup { readonly caps?: readonly string[]; readonly feature?: 'READY' | 'DISABLED' }

async function open(page: Page, setup: Setup = {}) {
  const caps = setup.caps ?? ALL;
  const calls: { method: string; path: string; search: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    calls.push({ method: request.method(), path, search: url.search });
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-0000000000aa', username: 'admin2', fullName: 'Quản trị 2' }, expiresAt: '2026-10-22T00:00:00.000Z', serverTime: '2026-10-21T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') {
      return json({ permissions: Object.fromEntries([...ALL, 'iam.roles.manage', 'iam.permissions.manage'].map((c) => [c, caps.includes(c)])), features: { temporaryCredentials: setup.feature ?? 'READY' } });
    }
    if (path === '/api/iam/admin/accounts' && request.method() === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const size = Number(url.searchParams.get('pageSize') ?? '25');
      const rows = url.searchParams.get('dir') === 'desc' ? [...ACCOUNTS].reverse() : ACCOUNTS;
      return json({ accounts: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size });
    }
    const m = /^\/api\/iam\/admin\/accounts\/([0-9a-f-]+)(\/.*)?$/.exec(path);
    if (m) {
      const acc = ACCOUNTS.find((a) => a.accountId === m[1]);
      const rest = m[2] ?? '';
      if (!acc) return json({ error: { code: 'NOT_FOUND', requestId: 'nf' } }, 404);
      if (rest === '') return json({ account: acc });
      if (rest === '/roles') return json({ roles: [{ userRoleId: 'ur1', roleId: 'r1', roleCode: 'WH_CLERK', roleName: 'Thủ kho', roleActive: true, assignedAt: '2026-10-18T01:00:00Z', revokedAt: null }] });
      if (rest === '/permissions') return json({ direct: [], effective: [], assumption: 'x' });
      if (rest === '/details') return json({ details: { createdAt: '2026-10-17T07:32:13Z', activatedAt: '2026-10-17T08:00:00Z', disabledAt: null, createdByUsername: 'admin', joinedAt: '2026-10-01', leftAt: null, mustChangePassword: false, failedAttempts: 0, loginLockedUntil: null } });
      if (rest === '/sessions') return json({ sessions: [{ sessionId: SESSION, assuranceLevel: 1, createdAt: '2026-10-21T01:00:00Z', expiresAt: '2026-10-21T11:00:00Z', lastSeenAt: '2026-10-21T01:30:00Z', revokedAt: null, status: 'ACTIVE' }] });
    }
    if (path === '/api/iam/admin/audit') {
      return json({ events: [{ auditId: '1', occurredAt: '2026-10-21T02:00:00Z', action: 'IAM.ACCOUNT.ROLE.ASSIGN', outcome: 'SUCCESS', actorId: 'a', actorUsername: 'admin2', targetType: 'USER_ACCOUNT', targetId: idOf(1), targetUsername: 'nv0001', metadata: { requestId: 'r1' } }], total: 1, page: 1, pageSize: 25 });
    }
    if (path === '/api/iam/admin/roles') return json({ roles: [] });
    if (path === '/api/iam/admin/permission-tree') return json({ tree: { modules: [], platform: [], unbound: [] } });
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return calls;
}

const drawer = (page: Page) => page.locator('.acc-drawer');
const grid = (page: Page) => page.locator('.dt-grid');
const sections = (page: Page) => page.getByRole('tablist', { name: 'Quản trị tài khoản' }).getByRole('tab');
const backButton = (page: Page) => page.getByRole('button', { name: '← Quay lại danh sách' });
const row = (page: Page, username: string) => page.getByRole('row', { name: new RegExp(username) });
const lastListCall = (calls: { path: string; search: string }[]) => [...calls].reverse().find((c) => c.path === '/api/iam/admin/accounts')?.search ?? '';

test.use({ viewport: { width: 1440, height: 900 } });

test('UI-B01..B06: drawer opens on the right over the list, no layout shift, switches account, closes by ×, Escape and leaving', async ({ page }) => {
  await open(page);
  await page.goto('/iam/accounts');
  await expect(row(page, 'nv0001')).toBeVisible();
  const before = await grid(page).boundingBox();
  const rowsBefore = await page.locator('.dt-grid tbody tr').count();

  await row(page, 'nv0001').getByRole('button', { name: 'Chi tiết' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toContainText('nv0001');
  await expect(drawer(page)).toContainText('Thủ kho');
  const box = await drawer(page).boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1430); // right edge
  expect(await grid(page).boundingBox()).toEqual(before); // UI-B02: not pushed, not resized
  expect(await page.locator('.dt-grid tbody tr').count()).toBe(rowsBefore);

  await row(page, 'nv0002').getByRole('button', { name: 'nv0002' }).click(); // UI-B04 (username link stays reachable)
  await expect(drawer(page)).toHaveAttribute('data-account', idOf(2));
  await expect(drawer(page)).toContainText('Nhân viên 2');

  await page.keyboard.press('Escape'); // UI-B05
  await expect(drawer(page)).toHaveCount(0);
  await expect(row(page, 'nv0002')).toBeVisible(); // UI-B03

  await row(page, 'nv0003').getByRole('button', { name: 'Chi tiết' }).click();
  await drawer(page).getByRole('button', { name: 'Đóng chi tiết' }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(row(page, 'nv0003').getByRole('button', { name: 'Chi tiết' })).toBeFocused();

  await row(page, 'nv0003').getByRole('button', { name: 'Chi tiết' }).click();
  await page.locator('#tabs button', { hasText: 'Nhật ký IAM' }).click(); // UI-B06: another content of the AppShell
  await expect(drawer(page)).toHaveCount(0);
  await page.locator('#tabs button', { hasText: 'Danh sách tài khoản' }).click();
  await row(page, 'nv0003').getByRole('button', { name: 'Chi tiết' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Trang chủ' }).click();
  await expect(drawer(page)).toHaveCount(0);
});

test('UI-B07: small screen — drawer fits the device width, no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.goto('/iam/accounts');
  await row(page, 'nv0001').getByRole('button', { name: 'nv0001' }).click();
  await expect(drawer(page)).toBeVisible();
  const box = await drawer(page).boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(drawer(page).getByRole('button', { name: 'Quản lý tài khoản' })).toBeInViewport();
});

test('NAV-01..08, NAV-11: table state kept in the URL; Chrome Back / Forward and the UI back button return to the same list', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/iam/accounts');
  await expect(row(page, 'nv0001')).toBeVisible();
  const start = await page.evaluate(() => history.length);
  await page.getByLabel('Từ khóa').fill('nv');
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await page.getByLabel('Lọc trạng thái').selectOption('ACTIVE');
  await page.getByRole('button', { name: /^Tài khoản/ }).click(); // username asc → desc
  await page.getByLabel('Số dòng/trang').selectOption('10');
  await page.getByRole('button', { name: 'Sau ›' }).click();
  await page.getByRole('button', { name: 'Sau ›' }).click();
  await expect(page.getByText('Trang 3 / 7')).toBeVisible();
  await expect(page).toHaveURL(/\/iam\/accounts\?q=nv&status=ACTIVE&dir=desc&page=3&size=10$/);
  expect(await page.evaluate(() => history.length)).toBe(start); // no history entry per change

  const listUrl = page.url();
  const target = page.locator('.dt-grid tbody tr').first();
  const username = (await target.locator('.acc-pick').innerText()).trim();
  await target.getByRole('button', { name: 'Chi tiết' }).click();
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await expect(page).toHaveURL(/\/iam\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.locator('.acc-ws-title')).toContainText(username);
  const workspaceUrl = page.url();

  const expectList = async () => {
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByLabel('Từ khóa')).toHaveValue('nv'); // NAV-03
    await expect(page.getByLabel('Lọc trạng thái')).toHaveValue('ACTIVE'); // NAV-04
    await expect(page.getByRole('columnheader', { name: /Tài khoản/ })).toHaveAttribute('aria-sort', 'descending'); // NAV-05
    await expect(page.getByText('Trang 3 / 7')).toBeVisible(); // NAV-06
    await expect(page.getByLabel('Số dòng/trang')).toHaveValue('10'); // NAV-07
    await expect(drawer(page)).toHaveCount(0); // NAV-11
    await expect(row(page, username)).toBeVisible();
    await expect.poll(() => lastListCall(calls)).toContain('page=3');
    const q = new URLSearchParams(lastListCall(calls));
    expect([q.get('search'), q.get('status'), q.get('sort'), q.get('dir'), q.get('pageSize')]).toEqual(['nv', 'ACTIVE', 'username', 'desc', '10']);
  };

  await page.goBack(); // NAV-01
  await expectList();
  await page.goForward(); // NAV-08
  await expect(page).toHaveURL(workspaceUrl);
  await expect(backButton(page)).toBeVisible();
  await backButton(page).click(); // NAV-02 (same result as Chrome Back)
  await expectList();
  await page.goForward();
  await expect(page).toHaveURL(workspaceUrl);
});

test('NAV-09, NAV-10, NAV-12: direct URL, reload on the workspace, repeated Back / Forward', async ({ page }) => {
  await open(page);
  // NAV-09: direct URL — loads the right account; the UI back button falls back to /iam/accounts.
  await page.goto(`/iam/accounts/${idOf(7)}?section=roles`);
  await expect(page.locator('.acc-ws-title')).toContainText('nv0007');
  await expect(sections(page).filter({ hasText: 'Vai trò' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#crumb')).toHaveText('IAM · Tài khoản và quyền › Quản lý tài khoản › Quản trị tài khoản');
  await backButton(page).click();
  await expect(page).toHaveURL(/\/iam\/accounts$/);
  await expect(row(page, 'nv0001')).toBeVisible();

  // NAV-12: from the list into a workspace, reload there, then back to the list.
  await page.getByLabel('Lọc trạng thái').selectOption('ACTIVE');
  await row(page, 'nv0005').getByRole('button', { name: 'Chi tiết' }).click();
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await sections(page).filter({ hasText: 'Phiên đăng nhập' }).click();
  await expect(page).toHaveURL(new RegExp(`/iam/accounts/${idOf(5)}\\?section=sessions$`));
  await page.reload();
  await expect(page.locator('.acc-ws-title')).toContainText('nv0005');
  await expect(sections(page).filter({ hasText: 'Phiên đăng nhập' })).toHaveAttribute('aria-selected', 'true');
  await backButton(page).click(); // the entry still knows it was opened from the list → history back
  await expect(page).toHaveURL(/\/iam\/accounts\?status=ACTIVE$/);
  await expect(page.getByLabel('Lọc trạng thái')).toHaveValue('ACTIVE');

  // NAV-10: Back / Forward several times — always the right page, no error screen.
  for (let i = 0; i < 3; i += 1) {
    await page.goForward();
    await expect(page.locator('.acc-ws-title')).toContainText('nv0005');
    await page.goBack();
    await expect(page.getByLabel('Lọc trạng thái')).toHaveValue('ACTIVE');
  }
  await expect(page.locator('.guard')).toHaveCount(0);
});

test('UI-W01..W08: workspace sections follow the capabilities; audit is filtered on the account', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/iam/accounts');
  await row(page, 'nv0001').getByRole('button', { name: 'Chi tiết' }).click();
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await expect(sections(page)).toHaveText(['Tổng quan', 'Vai trò', 'Chức năng & Quyền', 'Trạng thái & Credential', 'Phiên đăng nhập', 'Nhật ký tài khoản']);
  await expect(page.locator('#tabs')).toHaveCount(0); // the screen tabs are not shown in the workspace
  await expect(page.getByText('Tạo lúc:')).toBeVisible(); // W02
  await sections(page).filter({ hasText: 'Vai trò' }).click(); // W03
  await expect(page.getByRole('button', { name: 'Gán vai trò' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thu hồi' })).toBeVisible();
  await sections(page).filter({ hasText: 'Chức năng & Quyền' }).click(); // W04
  await expect(page.getByRole('button', { name: 'Cấp quyền trực tiếp' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quyền hiệu lực' })).toBeVisible();
  await sections(page).filter({ hasText: 'Trạng thái & Credential' }).click(); // W05 / W06
  await expect(page.getByLabel('Thao tác trạng thái')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mở khóa đăng nhập sai' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' })).toBeEnabled();
  await sections(page).filter({ hasText: 'Phiên đăng nhập' }).click(); // W07
  await expect(page.getByRole('button', { name: /Thu hồi tất cả \(1\)/ })).toBeVisible();
  await sections(page).filter({ hasText: 'Nhật ký tài khoản' }).click(); // W08
  await expect(page.getByRole('cell', { name: 'IAM.ACCOUNT.ROLE.ASSIGN' })).toBeVisible();
  await expect.poll(() => calls.some((c) => c.path === '/api/iam/admin/audit' && c.search.includes(`accountId=${idOf(1)}`))).toBe(true);
  await expect(page.getByRole('button', { name: 'Bỏ lọc tài khoản' })).toHaveCount(0);
});

test('UI-W06, UI-W09: P-4e off disables only the re-issue; root keeps its protections', async ({ page }) => {
  await open(page, { feature: 'DISABLED' });
  await page.goto(`/iam/accounts/${idOf(1)}?section=status`);
  await expect(page.getByText('chưa được bật (quyết định P-4e')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' })).toBeDisabled();
  await expect(page.getByLabel('Thao tác trạng thái')).toBeVisible(); // other lifecycle actions stay usable
  await backButton(page).click();
  await row(page, 'admin').getByRole('button', { name: 'Chi tiết' }).click();
  await expect(drawer(page)).toContainText('Quản trị gốc');
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await sections(page).filter({ hasText: 'Trạng thái & Credential' }).click();
  await expect(page.getByText('Tài khoản Admin gốc: không khóa')).toBeVisible();
  await expect(page.getByLabel('Thao tác trạng thái')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' })).toBeDisabled();
});

test('UI-W10 + guard: READ-only session sees no write control; audit-only session cannot read the workspace account', async ({ page }) => {
  await open(page, { caps: ['iam.accounts.read'] });
  await page.goto(`/iam/accounts/${idOf(2)}`);
  await expect(sections(page)).toHaveText(['Tổng quan', 'Vai trò', 'Chức năng & Quyền']);
  for (const section of ['Vai trò', 'Chức năng & Quyền']) {
    await sections(page).filter({ hasText: section }).click();
    for (const name of ['Gán vai trò', 'Thu hồi', 'Cấp quyền trực tiếp']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, { caps: ['iam.audit.read'] });
  await page.goto(`/iam/accounts/${idOf(2)}`);
  await expect(page.getByText('Cần quyền xem tài khoản (iam.accounts.read).')).toBeVisible();
  await page.goto('/iam/accounts/not-a-uuid');
  await expect(page.locator('#title')).toHaveText('TRANG CHỦ'); // not a shell path → home (unchanged rule)
});
