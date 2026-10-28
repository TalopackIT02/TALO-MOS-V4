// Shared mock of the Candidate Workspace API (FOUNDATION-REV-01): a small stateful server model used by the workspace specs.
import { expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// FOUNDATION-REV-01 REV-B — Quản lý Module list + Candidate Workspace (/foundation/modules/candidates/:candidateId).
// MOCK level: the API is intercepted by a small stateful server model. Checked: routing (direct URL, reload, back), the
// stepper, check details in the right drawer, plan with MIC diff / B09 placement / blockers, install confirmed in a popup,
// the journal states (AWAITING_RESTART → RESTART_PENDING → POSTCHECK_INCOMPLETE → INSTALLED_ACTIVE) read from the server,
// keyboard (Escape, focus) and mobile width. The engine / state machine are covered by the backend unit and DB tests.

export const READ = 'foundation.module_registry.read';
export const CREATE = 'foundation.module_registry.create';
export const ACTIVATE = 'foundation.module_version.activate';
export const VREAD = 'foundation.module_version.read';
export const HASH = 'a'.repeat(64);
export const CID = '22222222-2222-4222-8222-222222222222';
export const RID = '33333333-3333-4333-8333-333333333333';
export const IID = '44444444-4444-4444-8444-444444444444';
export const WS = `/foundation/modules/candidates/${CID}`;
const scanChecks = Array.from({ length: 20 }, (_, i) => ({ id: `MS-${String(i + 1).padStart(2, '0')}`, status: 'PASS', code: 'OK', path: null, message: 'ok' }));
export const REPORT = {
  scanId: '11111111-2222-4333-8444-555555555555', status: 'COMPLETED', scannedAt: '2026-10-23T02:00:00.000Z', durationMs: 42, registryAvailable: true,
  summary: { total: 1, passed: 1, warnings: 0, failed: 0, unavailable: 0 },
  modules: [{ folder: 'CUSTOMER_MANAGEMENT', moduleKey: 'CUSTOMER_MANAGEMENT', moduleName: 'Quản lý khách hàng', packageVersion: '0.1.0', classification: 'NEW_MODULE',
    foundationVersionStatus: null, registeredVersions: [], scanStatus: 'PASS', eligibleForPreflight: true, packageHash: HASH, micFormat: 'JSON', fileCount: 12,
    routes: ['/customers'], checks: scanChecks, issues: [] }],
};
const KEYS = ['PACKAGE_INTEGRITY', 'STATIC_SCAN', 'BACKEND_TYPECHECK', 'FRONTEND_TYPECHECK', 'PACKAGE_TESTS', 'HOST_HANDSHAKE', 'DATABASE_CONTRACT', 'DATABASE_TESTS', 'RUNTIME_SMOKE', 'INSTALLED_RUNTIME', 'AUTHENTICATED_IAM_SMOKE'];
const IDS = ['P0', 'P1', 'P2a', 'P2b', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P7', 'P8'];
const statusOf = (key: string, fail: boolean) => (fail && key === 'HOST_HANDSHAKE' ? 'FAIL' : key === 'DATABASE_TESTS' ? 'NOT_APPLICABLE' : key === 'AUTHENTICATED_IAM_SMOKE' ? 'NOT_TESTED' : 'PASS');
const runOf = (status: 'RUNNING' | 'COMPLETED', fail = false) => ({
  runId: RID, candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', packageVersion: '0.1.0', packageHash: HASH, status, result: status === 'RUNNING' ? null : fail ? 'NEEDS_FIX' : 'READY',
  startedAt: '2026-10-23T02:01:00.000Z', finishedAt: status === 'RUNNING' ? null : '2026-10-23T02:01:20.000Z', environment: { database: 'talo_mos_v4_test', nodeEnv: 'development' },
  reportHash: status === 'RUNNING' ? null : 'b'.repeat(64), limitations: ['Static-only PASS không phải runtime PASS.'],
  checks: KEYS.map((key, i) => ({
    id: IDS[i], key, label: key, required: key !== 'AUTHENTICATED_IAM_SMOKE', status: status === 'RUNNING' && i > 2 ? 'NOT_TESTED' : statusOf(key, fail), detail: `${key} detail`,
    startedAt: null, finishedAt: null, durationMs: 10, exitCode: 0, logHash: 'c'.repeat(64), limitations: key === 'AUTHENTICATED_IAM_SMOKE' ? ['Chỉ kiểm ở hậu kiểm ACCESS_VERIFIED.'] : [],
    issues: fail && key === 'HOST_HANDSHAKE' ? [{ message: 'API khai báo trong MIC-05 nhưng không được mount.', field: 'mic05Api', expected: 'GET /customers/list', actual: '(không có)' }] : [],
  })),
});
const STEPS = ['VERIFY', 'RELEASE', 'REGISTER', 'VERSION', 'MIC', 'SUBMIT', 'APPROVE', 'LOCK', 'RESTART', 'ACTIVATE', 'ENABLE', 'IAM_CATALOG', 'NAVIGATION', 'POSTCHECK'];
export const steps = (n: number) => STEPS.map((key, i) => ({ key, label: `Bước ${key}`, status: i < n ? 'DONE' : 'PENDING', at: null, detail: '' }));
export const POSTCHECK = ['B02_ACTIVE', 'RUNTIME_RELEASE', 'IAM_CATALOG', 'IAM_POLICY', 'NAVIGATION', 'API_SMOKE', 'ACCESS_VERIFIED'];
export const install = (state: string, o: Record<string, unknown> = {}) => ({ installId: IID, candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', packageVersion: '0.1.0', packageHash: HASH,
  classification: 'UPGRADE', state, expiresAt: '2026-10-23T03:00:00.000Z', blockers: [], warnings: ['Chưa có deploy supervisor: DEPLOY_RESTART_REQUIRED.'], steps: steps(0), postcheck: [], recovery: [],
  nextActions: [], navigationPlan: { area: 'Quản lý khách hàng', menu: 'Khách hàng', links: [{ functionKey: 'CUSTOMER', title: 'Danh sách khách hàng', developer: false }] },
  micDiff: [{ section: 'mic02Functions', draft: 1, candidate: 3, changed: true }, { section: 'mic05Api', draft: 0, candidate: 7, changed: true }, { section: 'mic01Identity', draft: 1, candidate: 1, changed: false }], ...o });
export const releases = [{ moduleKey: 'DATA_INSPECTOR', packageVersion: '0.1.0', packageHash: '45c4a3a06901074d474d25da3271b193b73ac5deec22b36e1a1a2eb30b14f8cc' }, { moduleKey: 'SYSTEM_TEST', packageVersion: '1.1.1', packageHash: '4cc97571bbc67dbbffa0b73fbe6ccfcd5cf34f5470801106482d9bcefc8566b6' }];

export interface Model { calls: string[]; polls: number; fail: boolean; restart: 'pending' | 'incomplete' | 'done'; blockers: { code: string; message: string }[]; status: string; installId: string | null }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function open(page: Page, caps: readonly string[] = [READ, CREATE, ACTIVATE, VREAD], status = 'SCANNED'): Promise<Model> {
  const m: Model = { calls: [], polls: 0, fail: false, restart: 'pending', blockers: [], status, installId: null };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === '/api/auth/session') return json(route, { status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-000000000009', username: 'tester', fullName: 'Kiểm thử' }, expiresAt: '2026-10-24T00:00:00.000Z', serverTime: '2026-10-23T00:00:00.000Z' });
    if (path === '/api/foundation/navigation') return json(route, { navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') return json(route, { permissions: Object.fromEntries([READ, CREATE, ACTIVATE, VREAD].map((c) => [c, caps.includes(c)])) });
    if (path === '/api/foundation/modules') return json(route, { modules: [] });
    if (path === '/api/foundation/module-packages/scan') return json(route, REPORT);
    if (path === '/api/foundation/runtime-release') return json(route, { runtime: { backend: releases, frontend: releases, lock: releases, matches: true, supervisor: 'NONE', environment: { database: 'talo_mos_v4_test', nodeEnv: 'development' } } });
    const candidate = () => ({ candidateId: CID, moduleKey: 'CUSTOMER_MANAGEMENT', moduleName: 'System Control Center', packageVersion: '0.1.0', folder: 'CUSTOMER_MANAGEMENT', scanId: REPORT.scanId,
      sourceHash: HASH, classification: 'NEW_MODULE', status: m.status, createdAt: '2026-10-23T02:00:30.000Z', updatedAt: '2026-10-23T02:00:30.000Z',
      latestRunId: m.status === 'SCANNED' ? null : RID, readyRunId: m.status === 'READY' ? RID : null, latestInstallId: m.installId });
    m.calls.push(`${method} ${path}`);
    if (path === '/api/foundation/module-candidates' && method === 'GET') return json(route, { candidates: [candidate()] });
    if (path === '/api/foundation/module-candidates' && method === 'POST') return json(route, { candidate: candidate() }, 201);
    if (path === `/api/foundation/module-candidates/${CID}`) return json(route, { candidate: candidate() });
    if (path === `/api/foundation/module-candidates/${CID}/preflight`) { m.status = 'VALIDATING'; return json(route, { runId: RID, status: 'RUNNING' }, 202); }
    if (path === `/api/foundation/module-candidates/${CID}/preflight/${RID}`) {
      m.polls += 1;
      if (m.status === 'VALIDATING' && m.polls < 2) return json(route, { run: runOf('RUNNING') });
      m.status = m.fail ? 'NEEDS_FIX' : 'READY';
      return json(route, { run: runOf('COMPLETED', m.fail) });
    }
    if (path === `/api/foundation/module-candidates/${CID}/preflight/${RID}/report.txt`) return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="preflight-CUSTOMER_MANAGEMENT-0.1.0-33333333.txt"' }, body: 'REPORT' });
    if (path === `/api/foundation/module-candidates/${CID}/install/prepare`) { m.installId = IID; return json(route, { installation: install(m.blockers.length > 0 ? 'BLOCKED' : 'PREPARED', { blockers: m.blockers }) }); }
    if (path === `/api/foundation/module-candidates/${CID}/install/commit`) {
      expect(JSON.parse(req.postData() ?? '{}')).toEqual({ planId: IID, acknowledge: true });
      return json(route, { installation: install('AWAITING_RESTART', { steps: steps(8) }) });
    }
    if (path === `/api/foundation/module-installations/${IID}/continue`) {
      if (m.restart === 'pending') return json(route, { error: { code: 'RESTART_PENDING', message: 'x', requestId: 'req-restart' } }, 409);
      if (m.restart === 'incomplete') return json(route, { installation: install('POSTCHECK_INCOMPLETE', { steps: steps(13), postcheck: POSTCHECK.map((key) => ({ key, status: key === 'IAM_POLICY' || key === 'ACCESS_VERIFIED' ? 'NOT_TESTED' : 'PASS', detail: key })), nextActions: ['Chưa gán quyền module: mở IAM › Vai trò và quyền.'] }) });
      return json(route, { installation: install('INSTALLED_ACTIVE', { steps: steps(14), postcheck: POSTCHECK.map((key) => ({ key, status: 'PASS', detail: key })) }) });
    }
    if (path === `/api/foundation/module-installations/${IID}`) return json(route, { installation: install('AWAITING_RESTART', { steps: steps(8) }) });
    return json(route, { error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
  return m;
}

export const ws = (page: Page) => page.getByRole('region', { name: 'Candidate Workspace' });
export async function toReady(page: Page) {
  await page.goto('/foundation/modules');
  await page.getByRole('button', { name: 'Quét Module' }).click();
  await page.getByRole('button', { name: 'Kiểm tra & Chạy thử' }).first().click(); // scan row → candidate → workspace route
  await expect(page).toHaveURL(new RegExp(`${WS}$`));
  await expect(ws(page)).toContainText('Đã quét');
  await ws(page).getByRole('button', { name: 'Kiểm tra & Chạy thử' }).click();
  await expect(ws(page)).toContainText('Kết luận:', { timeout: 15_000 });
}

