import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// SYSTEM_TEST 1.1.1 screen (package frontend inside the AppShell) — MOCK level: the module API is intercepted with answers
// shaped like the real service; the statuses below are those measured by the PostgreSQL TEST suite (MOD-TEST-01, talo_app):
// nothing here is invented as PASS. Two tabs, 22 checks, drawer, no Data Viewer, no regression run through the browser.

const STATUSES: [string, string, string][] = [
  ['AUTHENTICATION', 'Authentication', 'PASS'], ['SESSION', 'Session', 'PASS'], ['IAM', 'IAM permission evaluation', 'PASS'],
  ['POSTGRESQL', 'PostgreSQL connectivity', 'PASS'], ['REGISTRY', 'Foundation Registry', 'PASS'], ['VERSION_MIC', 'Version / MIC', 'PASS'],
  ['FUNCTION_ACTION', 'Function & Action', 'PASS'], ['DATA_CONTRACTS', 'Data Contracts', 'PASS'], ['COMPATIBILITY', 'Compatibility', 'PASS'],
  ['LIFECYCLE', 'Lifecycle', 'PASS'], ['NAVIGATION', 'Navigation', 'PASS'], ['MODULE_API', 'Module API', 'PASS'],
  ['FLEET_DISCOVERY', 'Danh mục module đã đăng ký', 'WARN'], ['FLEET_LIFECYCLE', 'Sức khỏe vòng đời các module', 'WARN'],
  ['FLEET_RELEASES', 'Phiên bản module đang hoạt động', 'WARN'], ['DEPLOYMENT_SYNC', 'Đối chiếu source package / deployed registry', 'NOT_TESTED'],
  ['DB_CONNECTIONS', 'Mức sử dụng kết nối PostgreSQL', 'PASS'], ['DB_DEADLOCKS', 'Deadlock từ PostgreSQL statistics', 'WARN'],
  ['DB_ROLLBACKS', 'Transaction rollback (thống kê tích lũy)', 'PASS'], ['AUDIT_DENIED', 'IAM/Foundation DENIED trong 60 phút', 'UNAVAILABLE'],
  ['AUDIT_FAILURE', 'Foundation audit FAILURE trong 60 phút', 'UNAVAILABLE'], ['REGRESSION', 'Tín hiệu Full Regression gần nhất', 'NOT_TESTED'],
];
const RUN = {
  runId: '7a1c0000-0000-4000-8000-000000000001', startedAt: '2026-10-22T16:00:00.000Z', finishedAt: '2026-10-22T16:00:00.250Z', durationMs: 250, moduleKey: 'SYSTEM_TEST',
  results: STATUSES.map(([key, label, status]) => ({ key, label, status, detail: `${key} detail (SQLSTATE 42501 when unavailable)` })),
  summary: { PASS: 14, FAIL: 0, WARN: 4, NOT_TESTED: 2, UNAVAILABLE: 2 },
  fleet: [{ moduleKey: 'DATA_INSPECTOR', enabled: true, versionCount: 1, activeVersions: 1 }, { moduleKey: 'SYSTEM_TEST', enabled: true, versionCount: 7, activeVersions: 1 }],
  fleetComplete: false,
};
const node = (id: string, title: string, routePath: string | null, children: unknown[] = []) => ({
  navigationId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, moduleId: null, functionId: null, menuTitle: title, sortOrder: 0, routePath, screenKey: null, children,
});
const MENU = [node('1', 'Test System', null, [node('2', 'Kiểm tra hệ thống', '/system-test'), node('3', 'Chạy test & xem kết quả', '/system-test/runner')])];

async function open(page: Page) {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${path}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') return json({ status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử' }, expiresAt: '2026-10-23T00:00:00.000Z', serverTime: '2026-10-22T00:00:00.000Z' });
    if (path === '/api/foundation/navigation') return json({ navigation: MENU });
    if (path === '/api/iam/admin/me/capabilities') return json({ permissions: {} });
    if (path === '/api/system-test/health') return json({ health: { moduleKey: 'SYSTEM_TEST', enabled: true, activeVersions: 1, checkedAt: '2026-10-22T16:00:00.000Z' } });
    if (path === '/api/system-test/checks/run' && request.method() === 'POST') return json({ run: RUN });
    if (path === '/api/system-test/results') return json({ results: { quickCheck: calls.some((c) => c.endsWith('/checks/run')) ? RUN : null, regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } } });
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return calls;
}

test.use({ viewport: { width: 1440, height: 900 } });

test('Diagnostics tab: no PASS before a run; 22 checks after it; filters and drawer; no Data Viewer', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/system-test');
  await expect(page.locator('#tabs button')).toHaveText(['System Diagnostics', 'Test Runner & Results']);
  await expect(page.locator('.st-hero-version')).toHaveText('SYSTEM_TEST · V1.1.1');
  await expect(page.getByText('Chưa có lượt kiểm tra')).toBeVisible();
  await expect(page.locator('.st-matrix-row')).toHaveCount(0); // nothing shown as PASS before the backend answers
  await page.getByRole('button', { name: /Chạy kiểm tra hệ thống/ }).click();
  await expect(page.locator('.st-matrix-row')).toHaveCount(22);
  await expect(page.locator('.st-section-count').first()).toHaveText('22 / 22 mục');
  await expect(page.getByText('Không lấy được đầy đủ danh sách module')).toBeVisible(); // fleetComplete false is said, not hidden
  await page.getByRole('button', { name: 'Vàng · Warning' }).click();
  await expect(page.locator('.st-matrix-row')).toHaveCount(8); // WARN 4 + NOT_TESTED 2 + UNAVAILABLE 2: never shown as normal
  await page.getByRole('button', { name: 'Đỏ · Critical' }).click();
  await expect(page.locator('.st-matrix-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tất cả' }).click();
  await page.locator('.st-matrix-row', { hasText: 'AUDIT_DENIED' }).click();
  const drawer = page.getByRole('dialog', { name: /Chi tiết IAM\/Foundation DENIED/ });
  await expect(drawer).toContainText('UNAVAILABLE');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('#body')).not.toContainText(/Data Viewer|Xem bảng dữ liệu/);
  expect(calls.filter((c) => c.includes('/api/system-test/tables'))).toEqual([]);
  expect(calls.filter((c) => c === 'POST /api/system-test/checks/run')).toHaveLength(1);
});

test('Runner tab: quick test of this account, regression NOT_RUN is not PASS, CLI only (no run through HTTP)', async ({ page }) => {
  const calls = await open(page);
  await page.goto('/system-test/runner');
  await expect(page.locator('.st-hero-version')).toHaveText('TEST EXECUTION · V1.1.1');
  await expect(page.getByText('Chưa có Quick Test của tài khoản')).toBeVisible();
  await expect(page.getByText('Chưa tìm thấy artifact từ CLI. Không đánh dấu kết quả PASS.')).toBeVisible();
  await page.getByRole('button', { name: /Chạy quick tests/ }).click();
  await expect(page.locator('.st-inline-score')).toHaveText(/14 PASS.*0 FAIL.*4 WARN.*2 UNAVAILABLE.*2 NOT TESTED/);
  await expect(page.locator('.st-command-bar code')).toHaveText('cd backend; npx tsx test/system-test/regression.cli.ts');
  expect(calls.filter((c) => c.startsWith('POST') && !c.endsWith('/checks/run'))).toEqual([]);
});

test('Contract mismatch (the answer of a SYSTEM_TEST 1.0.x backend): endpoint + field shown, no result, nothing green, screen stays usable', async ({ page }) => {
  await open(page);
  // The 1.0.x quick check answer: no durationMs / fleet / fleetComplete, summary without WARN.
  const legacy = { run: { runId: RUN.runId, startedAt: RUN.startedAt, finishedAt: RUN.finishedAt, moduleKey: 'SYSTEM_TEST', results: RUN.results.slice(0, 12).map((r) => ({ ...r, status: 'PASS' })),
    summary: { PASS: 12, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0 } } };
  await page.route('**/api/system-test/checks/run', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-request-id': 'req-legacy-1' }, body: JSON.stringify(legacy) }));
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.goto('/system-test');
  await page.getByRole('button', { name: /Chạy kiểm tra hệ thống/ }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('API trả dữ liệu không đúng hợp đồng.');
  await expect(alert).toContainText('POST /api/system-test/checks/run');
  await expect(alert).toContainText('run.summary.WARN');
  await expect(alert).toContainText('khởi động lại backend');
  await expect(page.locator('.st-matrix-row')).toHaveCount(0); // nothing of the invalid answer is shown
  await expect(page.getByText('Hệ thống đạt các phép kiểm tra')).toHaveCount(0);
  await expect(page.locator('.st-overview h2')).toHaveText('Chưa có dữ liệu kiểm tra');
  await expect(page.locator('.st-meter-footnote')).toHaveText('Chưa có kết quả đo. Không hiển thị trạng thái xanh mặc định.');
  await expect(page.locator('#tabs button')).toHaveCount(2); // the shell and the screen are still there
  await expect.poll(() => warnings.some((w) => w.includes('[SYSTEM_TEST] API contract mismatch'))).toBe(true);
  expect(warnings.join(' ')).not.toMatch(/talo_sid|password|cookie/i);
});

test('Runner tab: an invalid /results answer is reported, never shown as a regression result', async ({ page }) => {
  await open(page);
  await page.route('**/api/system-test/results', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: { quickCheck: null, regression: { state: 'DONE' }, runner: { apiExecution: false, mode: 'CLI' } } }) }));
  await page.goto('/system-test/runner');
  await expect(page.getByRole('alert')).toContainText('results.regression.state');
  await expect(page.getByText('Không đọc được kết quả từ API. Không hiển thị trạng thái nào.')).toBeVisible();
  await expect(page.locator('.st-hero-footer')).toContainText('KHÔNG ĐỌC ĐƯỢC');
  await expect(page.locator('.st-suite-row')).toHaveCount(0);
});
