import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// IAM Phase B — AppShell UI over an intercepted API: READ ≠ MANAGE (controls follow capabilities), one-time temporary
// password (shown once, gone after closing, never in storage / URL), lifecycle actions send action + reason, root hides
// lock / disable, sessions and IAM audit viewer (filters as query parameters, safe metadata only).

const ROOT = '0e7b0190-0173-4bc2-8e35-816730a4002b';
const USER = '30000000-0000-4000-8000-000000000001';
const SESSION = '70000000-0000-4000-8000-000000000001';
const PHASE_B = ['iam.accounts.read', 'iam.accounts.create', 'iam.accounts.manage', 'iam.credentials.reissue', 'iam.sessions.manage', 'iam.audit.read'];
const PASSWORD = 'Tmp#Pass-0123456789abcdef'.slice(0, 24);

const account = (id: string, username: string, status: string, isRoot = false) => ({
  accountId: id, username, accountStatus: status, disabled: false, employeeCode: `E-${username}`, fullName: `Họ tên ${username}`, membershipStatus: 'ACTIVE', isRoot,
});

interface Setup { readonly caps: readonly string[]; readonly feature?: 'READY' | 'DISABLED' }

async function open(page: Page, setup: Setup) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body: unknown = request.method() === 'GET' ? null : request.postDataJSON();
    calls.push({ method: request.method(), path, search: url.search, body });
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-0000000000aa', username: 'admin2', fullName: 'Quản trị 2' }, expiresAt: '2026-10-21T00:00:00.000Z', serverTime: '2026-10-20T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') {
      return json({ permissions: Object.fromEntries(PHASE_B.map((c) => [c, setup.caps.includes(c)])), features: { temporaryCredentials: setup.feature ?? 'READY' } });
    }
    if (path === '/api/iam/admin/accounts' && request.method() === 'GET') return json({ accounts: [account(USER, 'nv0101', 'ACTIVE'), account(ROOT, 'admin', 'ACTIVE', true)], total: 2, page: 1, pageSize: 25 });
    if (path === '/api/iam/admin/accounts' && request.method() === 'POST') {
      return json({ account: { accountId: USER, username: 'nv0202', membershipCreated: true, temporaryPassword: PASSWORD } }, 201);
    }
    const m = /^\/api\/iam\/admin\/accounts\/([0-9a-f-]+)(\/.*)?$/.exec(path);
    if (m) {
      const id = m[1] ?? '';
      const rest = m[2] ?? '';
      const acc = id === ROOT ? account(ROOT, 'admin', 'ACTIVE', true) : account(USER, 'nv0101', 'ACTIVE');
      if (rest === '') return json({ account: acc });
      if (rest === '/roles') return json({ roles: [] });
      if (rest === '/permissions') return json({ direct: [], effective: [], assumption: 'x' });
      if (rest === '/details') return json({ details: { createdAt: '2026-10-17T07:32:13Z', activatedAt: '2026-10-17T08:00:00Z', disabledAt: null, createdByUsername: 'admin', joinedAt: '2026-10-01', leftAt: null, mustChangePassword: false, failedAttempts: 0, loginLockedUntil: null } });
      if (rest === '/sessions') return json({ sessions: [{ sessionId: SESSION, assuranceLevel: 1, createdAt: '2026-10-20T01:00:00Z', expiresAt: '2026-10-20T11:00:00Z', lastSeenAt: '2026-10-20T01:30:00Z', revokedAt: null, status: 'ACTIVE' }] });
      if (rest === '/status') return json({ result: { previousStatus: 'ACTIVE', status: 'LOCKED', revokedSessions: 1 } });
      if (rest === '/sessions/revoke') return json({ result: { revokedSessions: 1 } });
      if (rest === '/login-lock/clear') return json({ result: { cleared: false } });
      if (rest === '/credential/reissue') return json({ credential: { accountId: id, username: acc.username, revokedSessions: 1, temporaryPassword: PASSWORD } });
    }
    if (path === '/api/iam/admin/audit') {
      return json({ events: [{ auditId: '1', occurredAt: '2026-10-20T02:00:00Z', action: 'IAM.ACCOUNT.LOCK', outcome: 'SUCCESS', actorId: 'a', actorUsername: 'admin2', targetType: 'USER_ACCOUNT', targetId: USER, targetUsername: 'nv0101', metadata: { reason: 'Nghỉ phép', requestId: 'r1' } }], total: 1, page: 1, pageSize: 25 });
    }
    if (path === '/api/iam/admin/roles') return json({ roles: [] });
    if (path === '/api/iam/admin/permission-tree') return json({ tree: { modules: [], platform: [], unbound: [] } });
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return calls;
}

const tabs = (page: Page) => page.locator('#tabs button');
const drawer = (page: Page) => page.locator('.acc-drawer');
const sections = (page: Page) => page.getByRole('tablist', { name: 'Quản trị tài khoản' }).getByRole('tab');
// IAM-B-UI-01: Chi tiết → drawer → Quản lý tài khoản → workspace of that account.
async function manage(page: Page, username: RegExp) {
  await page.getByRole('row', { name: username }).first().getByRole('button', { name: 'Chi tiết' }).click();
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await expect(page.getByRole('button', { name: '← Quay lại danh sách' })).toBeVisible();
}
const storageHas = (page: Page, secret: string) => page.evaluate((s) => [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), location.href].some((v) => v.includes(s)), secret);

test.use({ viewport: { width: 1440, height: 900 } });

test('READ only: list + detail info, no create / status / reissue / sessions controls, no audit tab', async ({ page }) => {
  await open(page, { caps: ['iam.accounts.read'] });
  await page.goto('/iam/accounts');
  await expect(tabs(page)).toHaveText(['Danh sách tài khoản']);
  await expect(page.getByRole('button', { name: 'Tạo tài khoản' })).toHaveCount(0);
  await page.getByRole('row', { name: /nv0101/ }).getByRole('button', { name: 'Chi tiết' }).click();
  await expect(drawer(page).getByText('Tạo lúc')).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Quản lý tài khoản' }).click();
  await expect(sections(page)).toHaveText(['Tổng quan', 'Vai trò', 'Chức năng & Quyền']);
  await expect(page.getByText('Tạo lúc:')).toBeVisible();
  for (const section of ['Tổng quan', 'Vai trò', 'Chức năng & Quyền']) {
    await sections(page).filter({ hasText: section }).click();
    for (const name of ['Thực hiện', 'Cấp lại mật khẩu tạm', 'Mở khóa đăng nhập sai', /Thu hồi tất cả/, 'Gán vai trò', 'Cấp quyền trực tiếp']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await page.goto('/iam/accounts');
});

test('create account: password shown once in the dialog, gone after closing, never in storage or URL', async ({ page }) => {
  const calls = await open(page, { caps: PHASE_B });
  await page.goto('/iam/accounts');
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  const form = page.getByLabel('Tạo tài khoản');
  await form.getByLabel('Mã nhân viên').fill('NV0202');
  await form.getByLabel('Họ tên').fill('Trần Thị C');
  await form.getByLabel('Tên đăng nhập').fill('nv0202');
  await form.getByLabel('Ngày vào làm').fill('2026-10-01');
  await form.getByRole('button', { name: 'Tạo tài khoản' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('temporary-password')).toHaveText(PASSWORD);
  await expect(dialog).toContainText('chỉ hiển thị một lần');
  expect(calls.find((c) => c.method === 'POST' && c.path === '/api/iam/admin/accounts')?.body).toEqual({ employeeCode: 'NV0202', fullName: 'Trần Thị C', username: 'nv0202', joinedAt: '2026-10-01' });
  expect(await storageHas(page, PASSWORD)).toBe(false);
  await dialog.getByRole('button', { name: /Đóng/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(PASSWORD);
  await page.reload();
  await expect(page.locator('body')).not.toContainText(PASSWORD);
});

test('P-4e flag off: create form explains and the submit stays disabled; reissue disabled', async ({ page }) => {
  await open(page, { caps: PHASE_B, feature: 'DISABLED' });
  await page.goto('/iam/accounts');
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(page.getByText('chưa được bật (quyết định P-4e')).toBeVisible();
  await expect(page.getByLabel('Tạo tài khoản').getByRole('button', { name: 'Tạo tài khoản' })).toBeDisabled();
});

test('lifecycle: lock sends action + reason; root hides lock / disable and reissue; sessions revoke; reissue shows the password once', async ({ page }) => {
  const calls = await open(page, { caps: PHASE_B });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('Đã xác minh qua điện thoại') : d.accept()));
  await page.goto('/iam/accounts');
  await manage(page, /nv0101/);
  await sections(page).filter({ hasText: 'Trạng thái & Credential' }).click();
  await page.getByLabel('Thao tác trạng thái').selectOption('LOCK');
  await page.getByLabel('Lý do').fill('Nghỉ phép dài ngày');
  await page.getByRole('button', { name: 'Thực hiện' }).click();
  await expect(page.getByText('Đã thực hiện: Khóa tài khoản.')).toBeVisible();
  expect(calls.find((c) => c.path.endsWith('/status'))?.body).toEqual({ action: 'LOCK', reason: 'Nghỉ phép dài ngày' });
  await sections(page).filter({ hasText: 'Phiên đăng nhập' }).click();
  await page.getByRole('button', { name: /Thu hồi tất cả/ }).click();
  await expect.poll(() => calls.find((c) => c.path.endsWith('/sessions/revoke'))?.body).toEqual({ sessionId: null, reason: 'Đã xác minh qua điện thoại' });
  await sections(page).filter({ hasText: 'Trạng thái & Credential' }).click();
  await page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' }).click();
  await expect(page.getByRole('dialog').getByTestId('temporary-password')).toHaveText(PASSWORD);
  expect(await storageHas(page, PASSWORD)).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: /Đóng/ }).click();
  await expect(page.locator('body')).not.toContainText(PASSWORD);
  // Root administrator
  await page.getByRole('button', { name: '← Quay lại danh sách' }).click();
  await manage(page, /admin/);
  await sections(page).filter({ hasText: 'Trạng thái & Credential' }).click();
  await expect(page.getByText('Tài khoản Admin gốc: không khóa')).toBeVisible();
  await expect(page.getByLabel('Thao tác trạng thái')).toHaveCount(0); // ACTIVE root: only LOCK / DISABLE would apply
  await expect(page.getByRole('button', { name: 'Cấp lại mật khẩu tạm' })).toBeDisabled();
});

test('IAM audit tab: filters become query parameters; only safe metadata is shown; read only', async ({ page }) => {
  const calls = await open(page, { caps: ['iam.audit.read'] });
  await page.goto('/iam/accounts');
  await expect(tabs(page)).toHaveText(['Nhật ký IAM']);
  await expect(page.getByRole('cell', { name: 'IAM.ACCOUNT.LOCK' })).toBeVisible();
  await expect(page.getByText('reason: Nghỉ phép')).toBeVisible();
  await page.getByLabel('Mã thao tác (tiền tố)').fill('IAM.ACCOUNT');
  await page.getByLabel('Kết quả').selectOption('FAILURE');
  await expect.poll(() => calls.filter((c) => c.path === '/api/iam/admin/audit').some((c) => c.search.includes('action=IAM.ACCOUNT') && c.search.includes('outcome=FAILURE'))).toBe(true);
  await page.getByRole('button', { name: 'nv0101' }).click();
  await expect.poll(() => calls.some((c) => c.path === '/api/iam/admin/audit' && c.search.includes(`accountId=${USER}`))).toBe(true);
  for (const name of ['Sửa', 'Xóa']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
});
