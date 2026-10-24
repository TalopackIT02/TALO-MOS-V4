import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEFAULT_MENU_ICON, FALLBACK_ICON, loadIconNames, resolveIcon } from '../../frontend/src/components/icons/iconLibrary';

// SIDEBAR & ICON MANAGEMENT REFINEMENT — MENU = SVG icon + bold title + hierarchy; FUNCTION = no icon + normal weight +
// indentation; icon library keys only (fallback for anything else); menus keep the default icon (Q13 — no picker, no
// icon field in B09). System screens live in the DEVELOP area. API intercepted (what the shell renders is under test).

const ALL_CAPS = [
  'foundation.module_registry.read', 'foundation.module_version.read', 'foundation.navigation.manage',
  'iam.accounts.read', 'iam.roles.manage', 'iam.permissions.manage', 'iam.assignments.manage',
];
const node = (id: string, title: string, routePath: string | null, children: unknown[] = []) => ({
  navigationId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, moduleId: null, functionId: null, menuTitle: title, sortOrder: 0, routePath, screenKey: null, children,
});
// Nested B09 tree: Test System › (Kiểm tra hệ thống, Dữ liệu › (the runner route of SYSTEM_TEST 1.1.1 with a long title)).
const LONG = 'Xem bảng dữ liệu nền tảng Foundation và các bảng điều hướng có tiêu đề rất dài';
const MENU = [node('1', 'Test System', null, [node('2', 'Kiểm tra hệ thống', '/system-test'), node('4', 'Dữ liệu', null, [node('3', LONG, '/system-test/runner')])])];

async function open(page: Page, caps: readonly string[] = ALL_CAPS) {
  const posts: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử menu' }, expiresAt: '2026-10-21T00:00:00.000Z', serverTime: '2026-10-20T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: MENU });
    if (path === '/api/iam/admin/me/capabilities') return json({ permissions: Object.fromEntries(ALL_CAPS.map((c) => [c, caps.includes(c)])) });
    if (path === '/api/iam/admin/foundation/navigation/items') return json({ items: [] });
    if (path === '/api/iam/admin/foundation/modules') return json({ modules: [] });
    if (path === '/api/foundation/navigation/builder') return json({ layout: { revision: '0'.repeat(64), developAreaId: null, areas: [], legacy: [] } });
    if (path === '/api/foundation/navigation/builder/functions') return json({ functions: [] });
    if (path === '/api/foundation/navigation/items' && request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
    }
    if (path === '/api/foundation/modules') return json({ modules: [] });
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return posts;
}

const sidebar = (page: Page) => page.locator('aside.sidebar');
const weight = (page: Page, selector: string) => sidebar(page).locator(selector).first().evaluate((el) => Number(getComputedStyle(el).fontWeight));

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('menus: SVG icons of the library (no Alt-code / emoji), bold; functions: no icon, normal weight, indented', async ({ page }) => {
    await open(page);
    await page.goto('/');
    await sidebar(page).getByRole('button', { name: 'Test System', exact: true }).click();
    await sidebar(page).getByRole('button', { name: 'Dữ liệu', exact: true }).click();
    await sidebar(page).getByRole('button', { name: 'Develop', exact: true }).click(); // system screens live in DEVELOP
    await sidebar(page).getByRole('button', { name: 'Foundation', exact: true }).click();
    // 1. Menu icons are library SVGs.
    const icons = await sidebar(page).locator('.nav-menu .nav-icon, .nav-menu-nested .nav-icon').evaluateAll((els) => els.map((e) => [e.getAttribute('data-icon'), getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage]));
    expect(icons.map(([k]) => k)).toEqual(['home', DEFAULT_MENU_ICON, DEFAULT_MENU_ICON, DEFAULT_MENU_ICON, 'settings', 'shield-lock']);
    for (const [key, mask] of icons) expect(mask).toContain(`/assets/icons/navigation/${key}.svg`);
    for (const key of ['home', 'folder', 'settings', 'shield-lock', FALLBACK_ICON]) {
      const res = await page.request.get(`/assets/icons/navigation/${key}.svg`);
      expect([key, res.status(), (await res.text()).includes('<svg')]).toEqual([key, 200, true]);
    }
    // No Alt-code / Unicode symbol / emoji left in the navigation text.
    const navText = await sidebar(page).locator('nav').innerText();
    expect(navText).not.toMatch(/[⌂⚙♙▣▤\p{Extended_Pictographic}]/u);
    // 2. Functions have no icon and no icon slot.
    const fns = sidebar(page).locator('.nav-fn, .nav-fn-top');
    expect(await fns.count()).toBeGreaterThanOrEqual(4);
    expect(await sidebar(page).locator('.nav-fn .nav-icon, .nav-fn .icon, .nav-fn-top .nav-icon, .nav-fn-top .icon').count()).toBe(0);
    // 3. Menu bold, function normal.
    expect(await weight(page, '.nav-menu .nav-label')).toBeGreaterThanOrEqual(600);
    expect(await weight(page, '.nav-menu-nested')).toBeGreaterThanOrEqual(600);
    expect(await weight(page, '.nav-fn:not(.active)')).toBe(400);
    // 4. Indentation: top menu < nested menu < its function.
    const x = async (name: string) => (await sidebar(page).getByRole('button', { name, exact: true }).boundingBox())?.x ?? -1;
    const [top, nested, fn, fn1] = [await x('Test System'), await x('Dữ liệu'), await x(LONG), await x('Kiểm tra hệ thống')];
    expect(top).toBeLessThan(fn1);
    expect(fn1).toBeLessThanOrEqual(nested + 1);
    expect(nested).toBeLessThan(fn);
  });

  test('chevron opens / closes; active function marked; collapsed sidebar keeps menu icons and a flyout without function icons', async ({ page }) => {
    await open(page);
    await page.goto('/');
    const group = sidebar(page).getByRole('button', { name: 'Test System', exact: true });
    // 5. Chevron.
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('button', { name: 'Kiểm tra hệ thống' })).toBeVisible();
    await group.click();
    await expect(sidebar(page).getByRole('button', { name: 'Kiểm tra hệ thống' })).toBeHidden();
    // 6. Active: opening a function by URL expands every menu above it and marks it.
    await page.goto('/system-test/runner');
    const active = sidebar(page).locator('.sub .nav-fn.active');
    await expect(active).toHaveText(LONG);
    await expect(active).toHaveAttribute('aria-current', 'page');
    expect(await active.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await expect(sidebar(page).getByRole('button', { name: 'Dữ liệu', exact: true })).toHaveAttribute('aria-expanded', 'true');
    // 7. Compact + flyout.
    await page.locator('#collapse-button').click();
    await expect(sidebar(page).locator('.nav-menu .nav-icon').first()).toBeVisible();
    await expect(sidebar(page).locator('.nav-menu .nav-label').first()).toBeHidden();
    await group.click();
    const flyout = sidebar(page).locator('.flyout-open .flyout');
    await expect(flyout).toBeVisible();
    await expect(flyout.getByRole('button', { name: 'Kiểm tra hệ thống' })).toBeVisible();
    expect(await flyout.locator('.nav-fn .nav-icon').count()).toBe(0);
    await expect(flyout.locator('.flyout-menu-title')).toContainText('Dữ liệu'); // nested menu keeps its title (+ icon)
    await flyout.getByRole('button', { name: 'Kiểm tra hệ thống' }).click();
    await expect(page).toHaveURL(/\/system-test$/);
  });

  // Owner decision Q13 (Navigation Builder, 22/10/2026): menus keep the default icon — no icon picker, nothing stored.
  test('Q13: no icon picker in the Navigation Builder; menus keep the default library icon', async ({ page }) => {
    await open(page);
    await page.goto('/foundation/navigation');
    await page.locator('#tabs button').nth(1).click();
    await expect(page.getByRole('list', { name: 'Cấu hình điều hướng (bản nháp)' })).toBeVisible();
    // REV-01: the editor is a drawer — open an area editor: still no icon picker.
    await page.locator('.nb-area').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('group', { name: /Icon của menu/ })).toHaveCount(0);
    await expect(page.getByLabel('Tìm icon theo tên')).toHaveCount(0);
    await expect(page.locator('#body')).not.toContainText('.svg');
    await page.keyboard.press('Escape');
    const icons = await page.locator('.nb-tree .nav-icon').evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')));
    expect(icons.length).toBeGreaterThan(0);
    expect(new Set(icons)).toEqual(new Set([DEFAULT_MENU_ICON]));
  });

  test('IAM still decides: without admin capabilities no admin menu appears (icons do not change visibility)', async ({ page }) => {
    await open(page, []);
    await page.goto('/');
    await expect(sidebar(page).getByRole('button', { name: 'Foundation', exact: true })).toHaveCount(0);
    await expect(sidebar(page).getByText('Quản trị')).toHaveCount(0);
    await expect(sidebar(page).getByRole('button', { name: 'Test System', exact: true })).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer keeps the hierarchy, no horizontal overflow, long function titles wrap', async ({ page }) => {
    await open(page);
    await page.goto('/system-test/runner');
    await page.locator('#mobileBottomMenu').click();
    await expect(sidebar(page)).toBeInViewport();
    await expect(sidebar(page).locator('.sub .nav-fn.active')).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: 'Dữ liệu', exact: true }).locator('.nav-icon')).toBeVisible();
    const nav = await sidebar(page).locator('nav').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
    expect(nav.scroll).toBeLessThanOrEqual(nav.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const fnBox = await sidebar(page).locator('.sub .nav-fn.active').boundingBox();
    expect(fnBox?.height ?? 0).toBeGreaterThan(30); // wrapped onto more than one line
  });
});

test('library rules: manifest = SVG folder; unknown / malformed / path-like keys fall back safely', async () => {
  const dir = resolve(__dirname, '../../frontend/public/assets/icons/navigation');
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
  const library = await loadIconNames();
  expect([...library].sort()).toEqual(files);
  for (const key of ['home', 'settings', 'shield-lock', DEFAULT_MENU_ICON, FALLBACK_ICON]) expect(library.has(key)).toBe(true);
  expect(resolveIcon('settings', library)).toBe('settings');
  for (const bad of ['khong-ton-tai', '../../etc/passwd', 'Settings', 'home.svg', 'http://x/y', '', null, undefined, 'a'.repeat(65)]) {
    expect(resolveIcon(bad, library)).toBe(FALLBACK_ICON);
  }
});
