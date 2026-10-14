import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { UNKNOWN_IDS_FILE } from './auth-e2e.setup';

// AUTH-IMPLEMENTATION-E2E: Login → First change → Login again → Authenticated → Logout, in a real browser against the
// real backend (talo_app) and the PostgreSQL test database. Accounts come from auth-e2e.setup.ts.

interface Fixture { username: string; password: string; fullName: string }
interface Fixtures { runId: string; provisioned: Fixture; active: Fixture }

function fixtures(): Fixtures {
  const raw = process.env['AUTH_E2E_FIXTURES'];
  if (!raw) throw new Error('AUTH_E2E_FIXTURES missing (global setup did not run)');
  const parsed: Fixtures = JSON.parse(raw);
  return parsed;
}

const NEW_PASSWORD = 'mua thu ha noi co nang vang';
const SHOTS = 'test-results/auth-e2e/screens';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

async function login(page: Page, username: string, password: string, remember = true) {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  const box = page.locator('#remember');
  if ((await box.isChecked()) !== remember) await box.click();
  await page.locator('.login-button').click();
}

async function storageSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
}

test('unknown user / wrong password → uniform message, no cookie', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('h1')).toHaveText('ĐĂNG NHẬP HỆ THỐNG');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
  const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
  await login(page, `${fixtures().runId}-nobody`, 'wrong password value');
  const requestId = (await response).headers()['x-request-id'] ?? '';
  mkdirSync(dirname(UNKNOWN_IDS_FILE), { recursive: true });
  appendFileSync(UNKNOWN_IDS_FILE, `${requestId}
`); // audit ownership factor for cleanup (not a secret)
  await expect(page.locator('#message')).toHaveText('Tên đăng nhập hoặc mật khẩu không đúng. Nếu nhập sai nhiều lần, bạn sẽ tạm thời không đăng nhập được trong 15 phút.');
  await page.screenshot({ path: `${SHOTS}/02-login-invalid.png` });
  expect((await context.cookies()).filter((c) => c.name === 'talo_sid')).toEqual([]);
});

test('provisioned account: first change, relogin, authenticated, logout', async ({ page, context }) => {
  const { provisioned } = fixtures();
  await page.goto('/login');
  await login(page, provisioned.username, provisioned.password);

  // First change screen (Activation Session).
  await expect(page).toHaveURL(/\/first-change$/);
  await expect(page.locator('h1')).toHaveText('ĐỔI MẬT KHẨU LẦN ĐẦU');
  await expect(page.locator('#account-line')).toHaveText(`Tài khoản: ${provisioned.username}`);
  await expect(page.locator('#countdown-text')).toHaveText(/^Thời gian còn lại để đổi mật khẩu: 1[45] phút\.$/);
  const [cookie] = (await context.cookies()).filter((c) => c.name === 'talo_sid');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', secure: false });
  expect(cookie?.expires).toBe(-1); // session cookie: no Max-Age / Expires
  await page.screenshot({ path: `${SHOTS}/03-first-change.png` });

  // Client validation, then a server policy error (same as the temporary password).
  await page.locator('#new-password').fill(NEW_PASSWORD);
  await page.locator('#confirm-password').fill(`${NEW_PASSWORD} x`);
  await page.locator('#submit-button').click();
  await expect(page.locator('#message')).toHaveText('Mật khẩu xác nhận không khớp với mật khẩu mới.');
  await expect(page.locator('#confirm-password')).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: `${SHOTS}/04-first-change-mismatch.png` });
  await page.locator('#new-password').fill(provisioned.password);
  await page.locator('#confirm-password').fill(provisioned.password);
  await page.locator('#submit-button').click();
  await expect(page.locator('#message')).toHaveText('Mật khẩu mới phải khác mật khẩu tạm hiện tại.');
  // Breached password (offline Pwned Passwords fixture), typed in another case than stored.
  await page.locator('#new-password').fill('MATKHAUMOI123456');
  await page.locator('#confirm-password').fill('MATKHAUMOI123456');
  await page.locator('#submit-button').click();
  await expect(page.locator('#message')).toHaveText('Mật khẩu này quá phổ biến hoặc dễ đoán. Vui lòng chọn mật khẩu khác.');

  // Valid change → relogin required.
  await page.locator('#new-password').fill(NEW_PASSWORD);
  await page.locator('#confirm-password').fill(NEW_PASSWORD);
  await expect(page.locator('#hint-length')).toHaveAttribute('data-state', 'ok');
  await page.locator('#submit-button').click();
  await expect(page.locator('#after-message')).toHaveText('Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.');
  await page.screenshot({ path: `${SHOTS}/05-first-change-success.png` });
  expect((await context.cookies()).filter((c) => c.name === 'talo_sid')).toEqual([]);
  await page.locator('#back-to-login').click();
  await expect(page).toHaveURL(/\/login$/);

  // Old temporary password no longer works; the new one opens an Authenticated Session.
  await login(page, provisioned.username, provisioned.password);
  await expect(page.locator('#message')).toContainText('Tên đăng nhập hoặc mật khẩu không đúng.');
  await login(page, provisioned.username, NEW_PASSWORD, true);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('h1')).toHaveText('ĐĂNG NHẬP THÀNH CÔNG');
  await expect(page.locator('#welcome-greeting')).toContainText(provisioned.fullName);
  await page.screenshot({ path: `${SHOTS}/06-welcome.png` });

  // Client storage: only the remembered username, never a token / session id / password.
  const storage = await storageSnapshot(page);
  expect(JSON.parse(storage)).toEqual({ local: { 'talo.auth.rememberedUsername': provisioned.username }, session: {} });
  const token = (await context.cookies()).find((c) => c.name === 'talo_sid')?.value ?? '';
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  for (const secret of [token, NEW_PASSWORD, provisioned.password]) expect(storage).not.toContain(secret);
  expect(await page.evaluate(() => document.cookie)).not.toContain('talo_sid'); // HttpOnly

  // Reload keeps the session (GET /api/auth/session); logout ends it.
  await page.reload();
  await expect(page.locator('h1')).toHaveText('ĐĂNG NHẬP THÀNH CÔNG');
  await page.locator('#welcome-logout').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('#message')).toHaveText('Bạn đã đăng xuất.');
  await expect(page.locator('#username')).toHaveValue(provisioned.username); // remembered username only
  await page.screenshot({ path: `${SHOTS}/07-logged-out.png` });
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('active account, "Ghi nhớ" unchecked → username removed; /first-change is not reachable without activation', async ({ page }) => {
  const { active } = fixtures();
  await page.goto('/login');
  await login(page, active.username, active.password, false);
  await expect(page.locator('h1')).toHaveText('ĐĂNG NHẬP THÀNH CÔNG');
  expect(JSON.parse(await storageSnapshot(page))).toEqual({ local: {}, session: {} });
  await page.goto('/first-change');
  await expect(page).toHaveURL(/\/$/); // Authenticated Session → welcome, never the first-change screen
  await page.locator('#welcome-logout').click();
  await expect(page).toHaveURL(/\/login$/);
});

test('responsive screenshots of the working screens (desktop / tablet / mobile)', async ({ browser }) => {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 1024, height: 768 }], ['mobile', { width: 390, height: 844 }]] as const) {
    const context = await browser.newContext({ viewport, userAgent: `${fixtures().runId} auth-tests` });
    const page = await context.newPage();
    await page.goto('/login');
    await page.screenshot({ path: `${SHOTS}/login-${name}.png` });
    await context.close();
  }
});
