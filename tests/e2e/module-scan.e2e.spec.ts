import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// FMI-01 — Manual Module Scan UI (Foundation › Quản lý Module › Module & Phiên bản). MOCK level: the API is intercepted;
// what is checked is that the scan runs ONLY on the button, and how the result / errors are shown. The scanner itself is
// covered by the backend unit tests.

const READ = 'foundation.module_registry.read';
const CREATE = 'foundation.module_registry.create';
const check = (id: string, status: string, code: string) => ({ id, status, code, path: null, message: `${id} ${code}` });
const checks = (overrides: Record<string, [string, string]> = {}) =>
  Array.from({ length: 20 }, (_, i) => {
    const id = `MS-${String(i + 1).padStart(2, '0')}`;
    const o = overrides[id];
    return check(id, o?.[0] ?? 'PASS', o?.[1] ?? 'OK');
  });
const MODULES = [
  { folder: 'CUSTOMER_MANAGEMENT', moduleKey: 'CUSTOMER_MANAGEMENT', moduleName: 'Quản lý khách hàng', packageVersion: '0.1.0', classification: 'NEW_MODULE',
    foundationVersionStatus: null, registeredVersions: [], scanStatus: 'WARN', eligibleForPreflight: true, packageHash: 'a'.repeat(64), micFormat: 'JSON', fileCount: 12,
    routes: ['/customers'], checks: checks({ 'MS-19': ['WARN', 'TEST_EVIDENCE_UNVERIFIED'] }),
    issues: [{ checkId: 'MS-19', code: 'TEST_EVIDENCE_UNVERIFIED', severity: 'WARNING', message: 'MIC-10 chưa xác minh runtime.', path: 'CUSTOMER_MANAGEMENT/mic/module.mic.json', field: 'mic10Manifest.testEvidence' }] },
  { folder: 'BROKEN_PKG', moduleKey: 'BROKEN_PKG', moduleName: 'Package lỗi', packageVersion: '1.0.0', classification: 'NEW_MODULE', foundationVersionStatus: null,
    registeredVersions: [], scanStatus: 'FAIL', eligibleForPreflight: false, packageHash: 'b'.repeat(64), micFormat: 'JSON', fileCount: 5, routes: ['/broken'],
    checks: checks({ 'MS-14': ['FAIL', 'MIC_IDENTITY_MISMATCH'], 'MS-19': ['WARN', 'TEST_EVIDENCE_PENDING'] }),
    issues: [{ checkId: 'MS-14', code: 'MIC_IDENTITY_MISMATCH', severity: 'ERROR', message: 'mic01Identity.moduleVersion không khớp module.json.', path: 'BROKEN_PKG/mic/module.mic.json',
      field: 'mic01Identity.moduleVersion', expected: '1.0.0', actual: '1.0.1', remediation: 'Sửa MIC-01.' }] },
  { folder: 'SYSTEM_TEST', moduleKey: 'SYSTEM_TEST', moduleName: 'System Test & Diagnostics', packageVersion: '1.1.1', classification: 'EXISTING_VERSION',
    foundationVersionStatus: 'DRAFT', registeredVersions: [{ moduleVersion: '1.0.3', status: 'ACTIVE' }, { moduleVersion: '1.1.1', status: 'DRAFT' }], scanStatus: 'WARN',
    eligibleForPreflight: false, packageHash: 'c'.repeat(64), micFormat: 'LEGACY_TS', fileCount: 40, routes: ['/system-test', '/system-test/runner'],
    checks: checks({ 'MS-12': ['WARN', 'LEGACY_MIC_FORMAT'] }), issues: [] },
  { folder: 'NO_REGISTRY', moduleKey: 'NO_REGISTRY', moduleName: 'Chưa rõ', packageVersion: '1.0.0', classification: 'REGISTRY_UNKNOWN', foundationVersionStatus: null,
    registeredVersions: [], scanStatus: 'UNAVAILABLE', eligibleForPreflight: false, packageHash: 'd'.repeat(64), micFormat: 'JSON', fileCount: 3, routes: [],
    checks: checks({ 'MS-17': ['UNAVAILABLE', 'REGISTRY_UNAVAILABLE'] }), issues: [] },
];
const REPORT = {
  scanId: '11111111-2222-4333-8444-555555555555', status: 'COMPLETED', scannedAt: '2026-10-23T02:00:00.000Z', durationMs: 42, registryAvailable: true,
  summary: { total: 4, passed: 0, warnings: 2, failed: 1, unavailable: 1 }, modules: MODULES,
};

interface Mock { posts: number; gets: number; scanAnswer: (route: Route) => Promise<void>; snapshotAnswer: (route: Route) => Promise<void> }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, caps: readonly string[] = [READ, CREATE]): Promise<Mock> {
  const mock: Mock = { posts: 0, gets: 0, scanAnswer: (r) => json(r, REPORT), snapshotAnswer: (r) => json(r, REPORT) };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/auth/session') return json(route, { status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử' }, expiresAt: '2026-10-24T00:00:00.000Z', serverTime: '2026-10-23T00:00:00.000Z' });
    if (path === '/api/foundation/navigation') return json(route, { navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') return json(route, { permissions: Object.fromEntries([READ, CREATE].map((c) => [c, caps.includes(c)])) });
    if (path === '/api/foundation/modules') return json(route, { modules: [] });
    if (path === '/api/foundation/module-packages/scan' && req.method() === 'POST') { mock.posts += 1; return mock.scanAnswer(route); }
    if (path.startsWith('/api/foundation/module-packages/scans/')) { mock.gets += 1; return mock.snapshotAnswer(route); }
    return json(route, { error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return mock;
}
const scanButton = (page: Page) => page.getByRole('button', { name: 'Quét Module' });

test.use({ viewport: { width: 1440, height: 900 } });

test('T01 no scan without the button: page load, tab switch and reload send no scan request; the button needs READ + CREATE', async ({ page }) => {
  const mock = await open(page);
  await page.goto('/foundation/modules');
  await expect(scanButton(page)).toBeVisible();
  await expect(page.getByText('Chép thư mục package vào')).toBeVisible();
  await page.locator('#tabs button').nth(1).click();
  await page.locator('#tabs button').nth(0).click();
  await page.reload();
  await expect(scanButton(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect([mock.posts, mock.gets]).toEqual([0, 0]);
  const readOnly = await page.context().newPage();
  const m2 = await open(readOnly, [READ]);
  await readOnly.goto('/foundation/modules');
  await expect(readOnly.getByRole('button', { name: 'Tải lại' })).toBeVisible();
  await expect(scanButton(readOnly)).toHaveCount(0);
  expect(m2.posts).toBe(0);
});

test('T21 scan: loading (button disabled, one request), three bars by package, UNAVAILABLE apart, table, search and status filter', async ({ page }) => {
  const mock = await open(page);
  let release: () => void = () => {};
  mock.scanAnswer = async (route) => { await new Promise<void>((r) => { release = r; }); await json(route, REPORT); };
  await page.goto('/foundation/modules');
  await scanButton(page).click();
  await expect(page.getByRole('button', { name: /Đang quét/ })).toBeDisabled();
  await page.getByRole('button', { name: /Đang quét/ }).click({ force: true });
  release();
  await expect(page.getByRole('table')).toBeVisible();
  expect(mock.posts).toBe(1);
  await expect(page.getByRole('meter', { name: 'Lỗi (FAIL)' })).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByRole('meter', { name: 'Cảnh báo (WARN)' })).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByRole('meter', { name: 'Đạt (PASS)' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.ms-unavailable').filter({ hasText: 'UNAVAILABLE' })).toContainText('1');
  await expect(page.locator('.ms-table tbody tr')).toHaveCount(4);
  await page.getByLabel('Tìm module đã quét').fill('khách hàng');
  await expect(page.locator('.ms-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Tìm module đã quét').fill('');
  await page.getByLabel('Lọc theo kết quả').selectOption('FAIL');
  await expect(page.locator('.ms-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.ms-table tbody tr')).toContainText('BROKEN_PKG');
  expect(mock.posts).toBe(1); // filtering never scans
});

test('T21 detail drawer: right panel ≤ 680px, dialog with focus, issue field / expected / actual, closes by ×, Escape and backdrop; focus returns', async ({ page }) => {
  await open(page);
  await page.goto('/foundation/modules');
  await scanButton(page).click();
  const opener = page.getByRole('button', { name: 'Chi tiết BROKEN_PKG' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết quét BROKEN_PKG' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('button', { name: 'Đóng chi tiết' })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(680);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1430); // anchored to the right edge
  for (const text of ['MIC_IDENTITY_MISMATCH', 'mic01Identity.moduleVersion', '1.0.1', 'Sửa MIC-01.', 'Các phép kiểm (20)', 'Mã băm package']) await expect(dialog).toContainText(text);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(100, 450); // backdrop
  await expect(dialog).toHaveCount(0);
  await opener.click();
  await page.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.ms-table')).toBeVisible(); // not expanded under the table
});

test('errors: 409 / 403 shown without retry; offline keeps the previous result labelled; malformed answer → UNEXPECTED_RESPONSE, nothing shown', async ({ page }) => {
  const mock = await open(page);
  await page.goto('/foundation/modules');
  await scanButton(page).click();
  await expect(page.locator('.ms-table tbody tr')).toHaveCount(4);
  mock.scanAnswer = (r) => json(r, { error: { code: 'SCAN_IN_PROGRESS', message: 'x', requestId: 'req-409' } }, 409);
  await scanButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Đang có lượt quét khác');
  await expect(page.getByText('Kết quả lần quét trước')).toBeVisible();
  await page.waitForTimeout(400);
  expect(mock.posts).toBe(2); // no automatic retry
  mock.scanAnswer = (r) => r.abort('internetdisconnected');
  await scanButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Không kết nối được máy chủ');
  await expect(page.locator('.ms-table tbody tr')).toHaveCount(4);
  mock.scanAnswer = (r) => json(r, { ...REPORT, summary: { ...REPORT.summary, total: 9 } });
  await scanButton(page).click();
  await expect(page.getByRole('alert')).toContainText('không đúng hợp đồng API');
  await expect(page.getByRole('alert')).toContainText('body.summary');
  mock.scanAnswer = (r) => json(r, { error: { code: 'FORBIDDEN', message: 'x', requestId: 'r' } }, 403);
  await scanButton(page).click();
  await expect(page.getByRole('alert')).toContainText('không có đủ quyền');
});

test('an expired snapshot is not rescanned: "Xem lại kết quả lần quét trước" → 404 SCAN_NOT_FOUND message; empty folder result', async ({ page }) => {
  const mock = await open(page);
  mock.scanAnswer = (r) => json(r, { ...REPORT, modules: [], summary: { total: 0, passed: 0, warnings: 0, failed: 0, unavailable: 0 } });
  await page.goto('/foundation/modules');
  await scanButton(page).click();
  await expect(page.getByText('không có thư mục package nào')).toBeVisible();
  await page.reload();
  mock.snapshotAnswer = (r) => json(r, { error: { code: 'SCAN_NOT_FOUND', message: 'x', requestId: 'r' } }, 404);
  await page.getByRole('button', { name: 'Xem lại kết quả lần quét trước' }).click();
  await expect(page.getByRole('alert')).toContainText('hết hạn');
  expect([mock.posts, mock.gets]).toEqual([1, 1]);
});

test('mobile: the drawer takes the full width and stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.goto('/foundation/modules');
  await scanButton(page).click();
  await page.getByRole('button', { name: 'Chi tiết CUSTOMER_MANAGEMENT' }).click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  await page.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('401 during a scan hands over to the existing session-lost flow (login screen)', async ({ page }) => {
  const mock = await open(page);
  await page.goto('/foundation/modules');
  await expect(scanButton(page)).toBeVisible();
  mock.scanAnswer = (r) => json(r, { error: { code: 'SESSION_INVALID', message: 'x', requestId: 'r' } }, 401);
  await page.route('**/api/auth/session', (r) => json(r, { error: { code: 'SESSION_INVALID', message: 'x', requestId: 'r' } }, 401));
  await scanButton(page).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.posts).toBe(1);
});
