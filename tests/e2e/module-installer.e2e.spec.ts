import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// FMI-02 / FMI-03 — "Kiểm tra & Chạy thử" and "Cài đặt & Kích hoạt" UI in Foundation › Quản lý Module. MOCK level: the API
// is intercepted with a small stateful server model; what is checked is the flow and how states / blockers / evidence are
// shown (never ACTIVE from a 200 alone). The engine and the state machine are covered by the backend unit / DB tests.

const READ = 'foundation.module_registry.read';
const CREATE = 'foundation.module_registry.create';
const ACTIVATE = 'foundation.module_version.activate';
const HASH = 'a'.repeat(64);
const CID = '22222222-2222-4222-8222-222222222222';
const RID = '33333333-3333-4333-8333-333333333333';
const IID = '44444444-4444-4444-8444-444444444444';
const scanChecks = Array.from({ length: 20 }, (_, i) => ({ id: `MS-${String(i + 1).padStart(2, '0')}`, status: 'PASS', code: 'OK', path: null, message: 'ok' }));
const REPORT = {
  scanId: '11111111-2222-4333-8444-555555555555', status: 'COMPLETED', scannedAt: '2026-10-23T02:00:00.000Z', durationMs: 42, registryAvailable: true,
  summary: { total: 1, passed: 1, warnings: 0, failed: 0, unavailable: 0 },
  modules: [{ folder: 'CUSTOMER_MANAGEMENT', moduleKey: 'CUSTOMER_MANAGEMENT', moduleName: 'Quản lý khách hàng', packageVersion: '0.1.0', classification: 'NEW_MODULE',
    foundationVersionStatus: null, registeredVersions: [], scanStatus: 'PASS', eligibleForPreflight: true, packageHash: HASH, micFormat: 'JSON', fileCount: 12,
    routes: ['/customers'], checks: scanChecks, issues: [] }],
};
const KEYS = ['PACKAGE_INTEGRITY', 'STATIC_SCAN', 'BACKEND_TYPECHECK', 'FRONTEND_TYPECHECK', 'PACKAGE_TESTS', 'HOST_HANDSHAKE', 'DATABASE_CONTRACT', 'DATABASE_TESTS', 'RUNTIME_SMOKE', 'INSTALLED_RUNTIME'];
const IDS = ['P0', 'P1', 'P2a', 'P2b', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P7'];
const runOf = (status: 'RUNNING' | 'COMPLETED', fail = false) => ({
  runId: RID, candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', packageVersion: '0.1.0', packageHash: HASH, status, result: status === 'RUNNING' ? null : fail ? 'NEEDS_FIX' : 'READY',
  startedAt: '2026-10-23T02:01:00.000Z', finishedAt: status === 'RUNNING' ? null : '2026-10-23T02:01:20.000Z', environment: { database: 'talo_mos_v4_test', nodeEnv: 'development' },
  reportHash: status === 'RUNNING' ? null : 'b'.repeat(64), limitations: ['Static-only PASS không phải runtime PASS.'],
  checks: KEYS.map((key, i) => ({
    id: IDS[i], key, label: key, status: status === 'RUNNING' && i > 2 ? 'NOT_TESTED' : fail && key === 'HOST_HANDSHAKE' ? 'FAIL' : 'PASS', detail: `${key} detail`,
    startedAt: null, finishedAt: null, durationMs: 10, exitCode: 0, logHash: 'c'.repeat(64), limitations: [],
    issues: fail && key === 'HOST_HANDSHAKE' ? [{ message: 'API khai báo trong MIC-05 nhưng không được mount.', field: 'mic05Api', expected: 'GET /customers/list', actual: '(không có)' }] : [],
  })),
});
const steps = (done: readonly string[]) => ['VERIFY', 'RELEASE', 'REGISTER', 'VERSION', 'MIC', 'SUBMIT', 'APPROVE', 'LOCK', 'RESTART', 'ACTIVATE', 'ENABLE', 'IAM_CATALOG', 'NAVIGATION', 'POSTCHECK']
  .map((key) => ({ key, label: `Bước ${key}`, status: done.includes(key) ? 'DONE' : 'PENDING', at: null, detail: '' }));
const install = (state: string, o: Record<string, unknown> = {}) => ({ installId: IID, candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', packageVersion: '0.1.0', packageHash: HASH,
  classification: 'NEW_MODULE', state, expiresAt: '2026-10-23T03:00:00.000Z', blockers: [], warnings: ['Chưa có deploy supervisor: DEPLOY_RESTART_REQUIRED.'], steps: steps([]), postcheck: [], recovery: [], ...o });
const releases = [{ moduleKey: 'SYSTEM_TEST', packageVersion: '1.1.1', packageHash: 'd'.repeat(64) }];

interface Model { calls: string[]; polls: number; fail: boolean; restartPending: boolean; blockers: { code: string; message: string }[] }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, caps: readonly string[] = [READ, CREATE, ACTIVATE]): Promise<Model> {
  const m: Model = { calls: [], polls: 0, fail: false, restartPending: true, blockers: [] };
  let candidateStatus = 'SCANNED';
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === '/api/auth/session') return json(route, { status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử' }, expiresAt: '2026-10-24T00:00:00.000Z', serverTime: '2026-10-23T00:00:00.000Z' });
    if (path === '/api/foundation/navigation') return json(route, { navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') return json(route, { permissions: Object.fromEntries([READ, CREATE, ACTIVATE].map((c) => [c, caps.includes(c)])) });
    if (path === '/api/foundation/modules') return json(route, { modules: [] });
    if (path === '/api/foundation/module-packages/scan') return json(route, REPORT);
    if (path === '/api/foundation/runtime-release') return json(route, { runtime: { backend: releases, frontend: releases, lock: releases, matches: true, supervisor: 'NONE', environment: { database: 'talo_mos_v4_test', nodeEnv: 'development' } } });
    const candidate = () => ({ candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', moduleName: 'Quản lý khách hàng', packageVersion: '0.1.0', folder: 'CUSTOMER_MANAGEMENT', scanId: REPORT.scanId,
      sourceHash: HASH, classification: 'NEW_MODULE', status: candidateStatus, createdAt: '2026-10-23T02:00:30.000Z', updatedAt: '2026-10-23T02:00:30.000Z', latestRunId: candidateStatus === 'SCANNED' ? null : RID, readyRunId: candidateStatus === 'READY' ? RID : null });
    m.calls.push(`${method} ${path}`);
    if (path === '/api/foundation/module-candidates' && method === 'GET') return json(route, { candidates: [] });
    if (path === '/api/foundation/module-candidates' && method === 'POST') {
      expect(JSON.parse(req.postData() ?? '{}')).toEqual({ scanId: REPORT.scanId, moduleKey: 'CUSTOMER_MANAGEMENT' });
      return json(route, { candidate: candidate() }, 201);
    }
    if (path === `/api/foundation/module-candidates/${CID}`) return json(route, { candidate: candidate() });
    if (path === `/api/foundation/module-candidates/${CID}/preflight`) { candidateStatus = 'VALIDATING'; return json(route, { runId: RID, status: 'RUNNING' }, 202); }
    if (path === `/api/foundation/module-candidates/${CID}/preflight/${RID}`) {
      m.polls += 1;
      if (m.polls < 2) return json(route, { run: runOf('RUNNING') });
      candidateStatus = m.fail ? 'NEEDS_FIX' : 'READY';
      return json(route, { run: runOf('COMPLETED', m.fail) });
    }
    if (path === `/api/foundation/module-candidates/${CID}/preflight/${RID}/report.txt`) return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="preflight-CUSTOMER_MANAGEMENT-0.1.0-33333333.txt"' }, body: 'REPORT' });
    if (path === `/api/foundation/module-candidates/${CID}/install/prepare`) return json(route, { installation: install(m.blockers.length > 0 ? 'BLOCKED' : 'PREPARED', { blockers: m.blockers }) });
    if (path === `/api/foundation/module-candidates/${CID}/install/commit`) {
      expect(JSON.parse(req.postData() ?? '{}')).toEqual({ planId: IID, acknowledge: true });
      return json(route, { installation: install('AWAITING_RESTART', { steps: steps(['VERIFY', 'RELEASE', 'REGISTER', 'VERSION', 'MIC', 'SUBMIT', 'APPROVE', 'LOCK']) }) });
    }
    if (path === `/api/foundation/module-installations/${IID}/continue`) {
      if (m.restartPending) return json(route, { error: { code: 'RESTART_PENDING', message: 'x', requestId: 'req-restart' } }, 409);
      return json(route, { installation: install('INSTALLED_ACTIVE', { steps: steps(['VERIFY', 'RELEASE', 'REGISTER', 'VERSION', 'MIC', 'SUBMIT', 'APPROVE', 'LOCK', 'RESTART', 'ACTIVATE', 'ENABLE', 'IAM_CATALOG', 'NAVIGATION', 'POSTCHECK']),
        postcheck: ['B02_ACTIVE', 'RUNTIME_RELEASE', 'IAM_CATALOG', 'NAVIGATION', 'API_SMOKE'].map((key) => ({ key, status: 'PASS', detail: `${key} ok` })) }) });
    }
    if (path === `/api/foundation/module-installations/${IID}`) return json(route, { installation: install('AWAITING_RESTART') });
    return json(route, { error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return m;
}

async function toReady(page: Page) {
  await page.goto('/foundation/modules');
  await page.getByRole('button', { name: 'Quét Module' }).click();
  await page.getByRole('button', { name: 'Kiểm tra & Chạy thử' }).first().click(); // the scan row button → candidate
  const panel = page.getByRole('region', { name: 'Kiểm tra và cài đặt module' });
  await expect(panel).toContainText('Đã quét');
  await panel.getByRole('button', { name: 'Kiểm tra & Chạy thử' }).click();
  await expect(panel).toContainText('Kết luận:', { timeout: 15_000 });
  return panel;
}

test.use({ viewport: { width: 1440, height: 900 } });

test('PF-UI: scan row → candidate → preflight polled until it ends → checks, bars, TXT download; runtime release shown with hashes', async ({ page }) => {
  const m = await open(page);
  const panel = await toReady(page);
  await expect(panel).toContainText('Kết luận: READY');
  await expect(panel.locator('.ms-checks > li')).toHaveCount(10);
  await expect(panel).toContainText('Đạt 10');
  await expect(panel).toContainText('Chưa kiểm / chưa xác minh: 0');
  await expect(panel).toContainText('Runtime đang chạy:');
  await expect(panel).toContainText('Backend = Frontend = lock');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Tải báo cáo TXT' }).click();
  expect((await download).suggestedFilename()).toBe('preflight-CUSTOMER_MANAGEMENT-0.1.0-33333333.txt');
  expect(m.calls.filter((c) => c.endsWith(`/preflight/${RID}`)).length).toBeGreaterThanOrEqual(2); // polled, then stopped
  const polls = m.polls;
  await page.waitForTimeout(2500);
  expect(m.polls).toBe(polls); // no polling after the end
});

test('PF-UI NEEDS_FIX: a failing check opens its issue detail (field / expected / actual); no install action', async ({ page }) => {
  const m = await open(page);
  m.fail = true;
  const panel = await toReady(page);
  await expect(panel).toContainText('Kết luận: NEEDS_FIX');
  const row = panel.locator('.ms-checks > li').filter({ hasText: 'HOST_HANDSHAKE' });
  await row.getByRole('button', { name: 'Chi tiết' }).click();
  for (const t of ['mic05Api', 'GET /customers/list', '(không có)']) await expect(row).toContainText(t);
  await expect(panel.getByRole('button', { name: 'Xem kế hoạch cài đặt' })).toHaveCount(0);
});

test('IN-UI: plan → acknowledge → Cài đặt & Kích hoạt → AWAITING_RESTART (not active) → RESTART_PENDING → INSTALLED_ACTIVE with postcheck', async ({ page }) => {
  const m = await open(page);
  const panel = await toReady(page);
  await panel.getByRole('button', { name: 'Xem kế hoạch cài đặt' }).click();
  await expect(panel).toContainText('Kế hoạch hợp lệ (chưa thực hiện)');
  await expect(panel).toContainText('DEPLOY_RESTART_REQUIRED');
  const installBtn = panel.getByRole('button', { name: 'Cài đặt & Kích hoạt' });
  await expect(installBtn).toBeDisabled(); // not acknowledged
  await panel.getByLabel('Tôi đã đọc kế hoạch và cảnh báo').check();
  await installBtn.click();
  await expect(panel).toContainText('Chờ khởi động lại');
  await expect(panel).not.toContainText('Đã cài đặt & hoạt động');
  await panel.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('alert')).toContainText('khởi động lại');
  m.restartPending = false;
  await panel.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(panel).toContainText('Đã cài đặt & hoạt động');
  await expect(panel.locator('.ms-plan .ms-checks > li')).toHaveCount(5);
  await expect(panel).toContainText('Gán quyền cho người dùng trong màn hình IAM');
});

test('IN-UI blockers: a blocked plan lists its codes and offers no install button; without ACTIVATE no plan button at all', async ({ page }) => {
  const m = await open(page);
  m.blockers = [{ code: 'UPGRADE_RECOVERY_UNAVAILABLE', message: 'Không có đường RETIRED → ACTIVE đã kiểm thử.' }, { code: 'IAM_DB_GRANT_MISSING', message: 'Thiếu grant.' }];
  const panel = await toReady(page);
  await panel.getByRole('button', { name: 'Xem kế hoạch cài đặt' }).click();
  await expect(panel).toContainText('Bị chặn');
  for (const t of ['UPGRADE_RECOVERY_UNAVAILABLE', 'IAM_DB_GRANT_MISSING']) await expect(panel).toContainText(t);
  await expect(panel.getByRole('button', { name: 'Cài đặt & Kích hoạt' })).toHaveCount(0);
  const other = await page.context().newPage();
  await open(other, [READ, CREATE]);
  const p2 = await toReady(other);
  await expect(p2.getByRole('button', { name: 'Xem kế hoạch cài đặt' })).toHaveCount(0);
});
