import { expect, test } from '@playwright/test';
import { openLogin } from './viewports';

// Runs identically against the approved demo and the React app, so the demo itself proves the expectations.

const ERROR_COLOR = 'rgb(173, 57, 57)';
const SUCCESS_COLOR = 'rgb(11, 142, 74)';

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }, testInfo) => {
  await openLogin(page, testInfo);
});

test('page title and static content', async ({ page }) => {
  await expect(page).toHaveTitle('TALOPACK | Đăng nhập hệ thống (Demo)');
  await expect(page.locator('h1')).toHaveText('ĐĂNG NHẬP HỆ THỐNG');
  await expect(page.locator('.subtitle')).toHaveText('Quản lý sản xuất - Kho vận - Kinh doanh - Toàn diện');
  await expect(page.locator('.login-button')).toHaveText('ĐĂNG NHẬP');
  await expect(page.locator('.footer')).toHaveText('© 2026 TALOPACK');
  await expect(page.locator('#message')).toHaveAttribute('role', 'status');
  await expect(page.locator('#message')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#message')).toBeHidden();
});

test('password visibility toggle', async ({ page }) => {
  const password = page.locator('#password');
  const toggle = page.locator('#password-toggle');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Hiện mật khẩu');

  await toggle.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Ẩn mật khẩu');

  await toggle.click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Hiện mật khẩu');
});

test('remember checkbox is checked by default and toggles', async ({ page }) => {
  const remember = page.locator('.remember input[type="checkbox"]');
  await expect(remember).toBeChecked();
  await page.locator('.remember').click();
  await expect(remember).not.toBeChecked();
});

test('forgot password shows the demo notice', async ({ page }) => {
  await page.locator('#forgot-button').click();
  const message = page.locator('#message');
  await expect(message).toHaveText('Chức năng quên mật khẩu chưa được tích hợp trong bản demo.');
  await expect(message).toHaveCSS('color', ERROR_COLOR);
});

test('submit with empty or blank fields shows validation error', async ({ page }) => {
  const message = page.locator('#message');
  await page.locator('.login-button').click();
  await expect(message).toHaveText('Vui lòng nhập tên đăng nhập và mật khẩu.');
  await expect(message).toHaveCSS('color', ERROR_COLOR);

  await page.locator('#username').fill('   ');
  await page.locator('#password').fill('x');
  await page.locator('.login-button').click();
  await expect(message).toHaveText('Vui lòng nhập tên đăng nhập và mật khẩu.');
});

test('submit with both fields shows the demo success notice (Enter key)', async ({ page }) => {
  await page.locator('#username').fill('NV0001');
  await page.locator('#password').fill('MatKhau@2026');
  await page.locator('#password').press('Enter');
  const message = page.locator('#message');
  await expect(message).toHaveText('Đây là bản demo giao diện, chưa kết nối hệ thống đăng nhập.');
  await expect(message).toHaveCSS('color', SUCCESS_COLOR);
});

test('keyboard order and focus-visible outline', async ({ page }) => {
  const order = ['username', 'password', 'password-toggle', null, 'forgot-button', null];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (const expectedId of order) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    if (expectedId) expect(id).toBe(expectedId);
  }
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    return element ? { className: element.className, outline: getComputedStyle(element).outline } : null;
  });
  expect(focused?.className).toBe('login-button');
  expect(focused?.outline).toBe('rgb(160, 230, 197) solid 3px');
});
