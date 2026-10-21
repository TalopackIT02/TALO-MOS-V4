import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// IAM Phase C PC-01 — "+ Tạo tài khoản": right-hand drawer, username only, account created PENDING_MEMBERSHIP (no membership,
// no password, no P-4e). API intercepted (MOCK) with a small stateful account list: the server rules themselves are covered
// by the backend unit tests and the PostgreSQL clone run of the PC-01 package.

const ADMIN = '30000000-0000-4000-8000-0000000000aa';
const idOf = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ALL = ['iam.accounts.read', 'iam.accounts.create', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read', 'iam.assignments.manage'];

interface Row { accountId: string; username: string; accountStatus: string; disabled: boolean; membershipId: string | null; employeeCode: string | null; fullName: string | null; membershipStatus: string | null; isRoot: boolean }
interface Setup { readonly caps?: readonly string[]; readonly feature?: 'READY' | 'DISABLED'; readonly dbMissing?: boolean; readonly delayMs?: number }

const member = (n: number): Row => ({
  accountId: idOf(n), username: `nv${String(n).padStart(4, '0')}`, accountStatus: 'ACTIVE', disabled: false, membershipId: `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  employeeCode: `E${String(n).padStart(4, '0')}`, fullName: `Nhân viên ${n}`, membershipStatus: 'ACTIVE', isRoot: false,
});

async function open(page: Page, setup: Setup = {}) {
  const caps = setup.caps ?? ALL;
  const accounts: Row[] = Array.from({ length: 12 }, (_, i) => member(i + 1));
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body: unknown = request.method() === 'GET' ? null : request.postDataJSON();
    calls.push({ method: request.method(), path, search: url.search, body });
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: ADMIN, username: 'admin2', fullName: 'Quản trị 2' }, expiresAt: '2026-10-22T00:00:00.000Z', serverTime: '2026-10-21T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') {
      return json({ permissions: Object.fromEntries(ALL.map((c) => [c, caps.includes(c)])), features: { temporaryCredentials: setup.feature ?? 'READY' } });
    }
    if (path === '/api/iam/admin/accounts/pending' && request.method() === 'POST') {
      if (!caps.includes('iam.accounts.create')) return json({ error: { code: 'FORBIDDEN', requestId: 'f' } }, 403);
      if (setup.delayMs) await new Promise((r) => setTimeout(r, setup.delayMs));
      if (setup.dbMissing) return json({ error: { code: 'PENDING_ACCOUNT_DB_MISSING', requestId: 'r-db' } }, 503);
      const username = typeof body === 'object' && body !== null && 'username' in body ? String(body.username) : '';
      if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) return json({ error: { code: 'USERNAME_TAKEN', requestId: 'r-dup' } }, 409);
      const row: Row = { accountId: idOf(900 + accounts.length), username, accountStatus: 'PENDING_MEMBERSHIP', disabled: false, membershipId: null, employeeCode: null, fullName: null, membershipStatus: null, isRoot: false };
      accounts.push(row);
      return json({ account: { accountId: row.accountId, username, accountStatus: 'PENDING_MEMBERSHIP', createdAt: '2026-10-21T08:00:00.000Z', membershipId: null } }, 201);
    }
    if (path === '/api/iam/admin/accounts' && request.method() === 'GET') {
      const status = url.searchParams.get('status');
      const rows = accounts.filter((a) => !status || a.accountStatus === status);
      return json({ accounts: rows.slice(0, 25), total: rows.length, page: 1, pageSize: 25 });
    }
    const m = /^\/api\/iam\/admin\/accounts\/([0-9a-f-]+)(\/.*)?$/.exec(path);
    if (m) {
      const acc = accounts.find((a) => a.accountId === m[1]);
      const rest = m[2] ?? '';
      if (!acc) return json({ error: { code: 'NOT_FOUND', requestId: 'nf' } }, 404);
      if (rest === '') return json({ account: acc });
      if (rest === '/roles') return json({ roles: [] });
      if (rest === '/permissions') return json({ direct: [], effective: [], assumption: 'x' });
      if (rest === '/sessions') return json({ sessions: [] });
      if (rest === '/details') {
        const pending = acc.membershipId === null;
        return json({ details: { createdAt: '2026-10-21T08:00:00Z', activatedAt: null, disabledAt: null, createdByUsername: 'admin2', joinedAt: null, leftAt: null,
          hasCredential: !pending, mustChangePassword: pending ? null : false, failedAttempts: pending ? null : 0, loginLockedUntil: null } });
      }
    }
    if (path === '/api/iam/admin/audit') return json({ events: [], total: 0, page: 1, pageSize: 25 });
    if (path === '/api/iam/admin/roles') return json({ roles: [] });
    if (path === '/api/iam/admin/permission-tree') return json({ tree: { modules: [], platform: [], unbound: [] } });
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return calls;
}

const createDrawer = (page: Page) => page.locator('.acc-drawer[data-drawer="create"]');
const detailDrawer = (page: Page) => page.locator('.acc-drawer[data-account]');
const usernameInput = (page: Page) => createDrawer(page).getByLabel(/Tên đăng nhập/);
const createButton = (page: Page) => page.getByRole('button', { name: '+ Tạo tài khoản' });
const submit = (page: Page) => createDrawer(page).getByRole('button', { name: 'Tạo tài khoản', exact: true });
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/iam/admin/accounts/pending');

test.use({ viewport: { width: 1440, height: 900 } });

test('UC-01 / UC-02: "+ Tạo tài khoản" opens a right-hand drawer over the list; closing keeps the table and its query', async ({ page }) => {
  await open(page);
  await page.goto('/iam/accounts?status=ACTIVE&size=10');
  await expect(page.getByRole('row', { name: /nv0001/ })).toBeVisible();
  const grid = await page.locator('.dt-grid').boundingBox();
  await createButton(page).click();
  await expect(createDrawer(page)).toBeVisible();
  await expect(createDrawer(page).getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
  await expect(usernameInput(page)).toBeFocused();
  const box = await createDrawer(page).boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1430);
  expect(await page.locator('.dt-grid').boundingBox()).toEqual(grid); // not pushed down
  await expect(createDrawer(page)).toContainText('Tài khoản sẽ được tạo ở trạng thái Chờ Membership. Bạn có thể gán nhân viên và cấp mật khẩu sau.');
  await expect(createDrawer(page).locator('dl')).toContainText('MembershipChưa gán');
  await expect(createDrawer(page).locator('dl')).toContainText('Mật khẩuChưa cấp');
  await expect(createDrawer(page).locator('dl')).toContainText('Trạng tháiChờ Membership');
  await page.keyboard.press('Escape');
  await expect(createDrawer(page)).toHaveCount(0);
  await expect(createButton(page)).toBeFocused();
  await createButton(page).click();
  await createDrawer(page).getByRole('button', { name: 'Đóng tạo tài khoản' }).click();
  await createButton(page).click();
  await createDrawer(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(createDrawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/iam\/accounts\?status=ACTIVE&size=10$/);
  await expect(page.getByLabel('Lọc trạng thái')).toHaveValue('ACTIVE');
});

test('UC-03 / UC-04: empty or invalid username — clear message, nothing sent', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await submit(page).click();
  await expect(createDrawer(page).getByRole('alert')).toHaveText('Nhập tên đăng nhập.');
  await usernameInput(page).fill('nv test');
  await expect(createDrawer(page).getByRole('alert')).toHaveText('Tên đăng nhập không được chứa khoảng trắng hoặc ký tự điều khiển.');
  await expect(submit(page)).toBeDisabled();
  await usernameInput(page).fill('   ');
  await expect(createDrawer(page).getByRole('alert')).toHaveText('Nhập tên đăng nhập.');
  expect(await usernameInput(page).getAttribute('maxlength')).toBe('80');
  expect(posts(calls)).toEqual([]);
});

test('UC-05: an existing username (any letter case) is refused by the server and shown at the field; nothing created', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await usernameInput(page).fill('NV0001');
  await submit(page).click();
  await expect(createDrawer(page).getByRole('alert')).toHaveText('Tên đăng nhập đã tồn tại. Chọn tên khác.');
  await expect(createDrawer(page)).toBeVisible();
  await expect(page.locator('.fx-msg.success')).toHaveCount(0);
  expect(posts(calls)).toHaveLength(1);
  await usernameInput(page).fill('nv_new_9');
  await expect(createDrawer(page).getByRole('alert')).toHaveText('');
});

test('UC-06 / UC-07 / UC-08: valid username → saved, drawer closes, success message, list reloaded with the pending account; detail + workspace show "Chưa gán"', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await usernameInput(page).fill('  nv_test_001 ');
  const listCalls = calls.filter((c) => c.path === '/api/iam/admin/accounts').length;
  await submit(page).click();
  await expect(createDrawer(page)).toHaveCount(0);
  await expect(page.locator('.fx-msg.success')).toContainText('Đã tạo tài khoản nv_test_001 ở trạng thái Chờ Membership');
  expect(posts(calls).map((c) => c.body)).toEqual([{ username: 'nv_test_001' }]); // trimmed; username only
  await expect.poll(() => calls.filter((c) => c.path === '/api/iam/admin/accounts').length).toBeGreaterThan(listCalls);
  const row = page.getByRole('row', { name: /nv_test_001/ });
  await expect(row).toContainText('Chờ Membership');
  await expect(row.getByRole('cell').nth(1)).toHaveText('—');
  // Open it from the message → detail drawer; then the workspace.
  await page.locator('.fx-msg.success').getByRole('button', { name: 'Xem tài khoản' }).click();
  await expect(detailDrawer(page)).toContainText('nv_test_001');
  await expect(detailDrawer(page).locator('dl')).toContainText('MembershipChưa gán');
  await expect(detailDrawer(page).locator('dl')).toContainText('Họ tên—');
  await detailDrawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await expect(page.locator('.acc-ws-title')).toContainText('nv_test_001');
  await expect(page.getByText('Mật khẩu: Chưa cấp')).toBeVisible();
  await expect(page.locator('.acc-facts')).toContainText('MembershipChưa gán');
  await page.getByRole('tab', { name: 'Trạng thái & Credential' }).click();
  await expect(page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' })).toBeDisabled();
  await expect(page.getByText('Chưa cấp mật khẩu: tài khoản đang chờ Membership.')).toBeVisible();
  await expect(page.getByLabel('Thao tác trạng thái')).toHaveCount(0);
  expect(calls.some((c) => c.path.endsWith('/credential/reissue'))).toBe(false);
  // Back: the list with its query, filterable by the new status.
  await page.getByRole('button', { name: '← Quay lại danh sách' }).click();
  await page.getByLabel('Lọc trạng thái').selectOption('PENDING_MEMBERSHIP');
  await expect.poll(() => calls.some((c) => c.path === '/api/iam/admin/accounts' && c.search.includes('status=PENDING_MEMBERSHIP'))).toBe(true);
  await expect(page.locator('.dt-grid tbody tr')).toHaveCount(1);
});

test('No double submit: while saving the button is busy and disabled — exactly one request', async ({ page }) => {
  const calls = await open(page, { delayMs: 700 });
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await usernameInput(page).fill('nv_once');
  await submit(page).click();
  await expect(createDrawer(page).getByRole('button', { name: 'Đang tạo…' })).toBeDisabled();
  await page.keyboard.press('Escape'); // ignored while saving
  await expect(createDrawer(page)).toBeVisible();
  await usernameInput(page).press('Enter');
  await expect(createDrawer(page)).toHaveCount(0);
  expect(posts(calls)).toHaveLength(1);
});

test('UC-09: P-4e disabled does not block creating a pending account', async ({ page }) => {
  const calls = await open(page, { feature: 'DISABLED' });
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await usernameInput(page).fill('nv_p4e_off');
  await submit(page).click();
  await expect(page.locator('.fx-msg.success')).toContainText('nv_p4e_off');
  expect(posts(calls)).toHaveLength(1);
});

test('UC-10: without iam.accounts.create there is no create button (the API refuses too — backend unit test)', async ({ page }) => {
  await open(page, { caps: ['iam.accounts.read', 'iam.accounts.manage'] });
  await page.goto('/iam/accounts');
  await expect(page.getByRole('row', { name: /nv0001/ })).toBeVisible();
  await expect(createButton(page)).toHaveCount(0);
});

test('Database package not installed yet: the server answer is shown in the drawer, nothing is created', async ({ page }) => {
  await open(page, { dbMissing: true });
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await usernameInput(page).fill('nv_before_db');
  await submit(page).click();
  await expect(createDrawer(page)).toContainText('gói IAM Phase C PC-01 chờ phê duyệt');
  await expect(createDrawer(page)).toBeVisible();
  await expect(page.locator('.fx-msg.success')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /nv_before_db/ })).toHaveCount(0);
});

test('One drawer at a time: the detail drawer closes the create drawer and the other way round', async ({ page }) => {
  await open(page);
  await page.goto('/iam/accounts');
  await createButton(page).click();
  await page.getByRole('row', { name: /nv0002/ }).getByRole('button', { name: 'nv0002' }).click();
  await expect(createDrawer(page)).toHaveCount(0);
  await expect(detailDrawer(page)).toContainText('nv0002');
  await page.keyboard.press('Escape'); // the toolbar button sits under the detail drawer: close it first (×, Esc)
  await createButton(page).click();
  await expect(detailDrawer(page)).toHaveCount(0);
  await expect(createDrawer(page)).toBeVisible();
});
