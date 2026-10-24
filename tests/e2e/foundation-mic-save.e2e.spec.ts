import { expect, test } from '@playwright/test';

// FIX-FE-MIC-SAVE-01 regression: a saved MIC must remain the source of the textarea after the panel reloads and after
// a full browser refresh. API interception isolates the React state transition; the PostgreSQL integration suite covers
// PUT -> B02 -> GET/listVersions with the same manifest.

const MODULE_ID = '10000000-0000-4000-8000-000000000001';
const VERSION_ID = '20000000-0000-4000-8000-000000000001';

const moduleRecord = {
  moduleId: MODULE_ID,
  moduleKey: 'SALES',
  moduleName: 'Bán hàng',
  description: null,
  moduleType: 'INTERNAL',
  isEnabled: true,
  createdAt: '2026-10-19T00:00:00.000000Z',
  updatedAt: '2026-10-19T00:00:00.000000Z',
};

const initialVersion = {
  versionId: VERSION_ID,
  moduleId: MODULE_ID,
  moduleVersion: '1.0.2',
  contractVersion: 'MIC-1.0',
  status: 'DRAFT',
  manifestJson: null as unknown,
  manifestHash: null,
  submittedByAccountId: null,
  createdAt: '2026-10-19T00:00:00.000000Z',
  reviewedByAccountId: null,
  reviewedAt: null,
  activatedAt: null,
};

const savedMic = {
  mic01Identity: { moduleKey: 'SALES', moduleName: 'Bán hàng', moduleVersion: '1.0.2', micStandard: 'MIC-1.0' },
  mic02Functions: [{ functionKey: 'ORDER', name: 'Đơn hàng' }],
  mic03Actions: [{ functionKey: 'ORDER', actionKey: 'READ', name: 'Xem đơn hàng', nature: 'READ' }],
  mic04Navigation: [{ menuLabel: 'Bán hàng' }, { menuLabel: 'Đơn hàng', routePath: '/sales/orders', screenKey: 'sales.orders', functionKey: 'ORDER' }],
  mic05Api: [],
  mic06DataResources: [],
  mic07IamMapping: [{ functionKey: 'ORDER', actionKey: 'READ', moduleCode: 'SALES', resourceCode: 'ORDER', operation: 'READ', minimumAssuranceLevel: 1 }],
  mic08EventsAudit: { eventCodes: [], auditActionCodes: [] },
  mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: [] },
  mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [] },
};

test.use({ viewport: { width: 1440, height: 900 } });

test('Lưu MIC -> Tải lại -> F5 keeps the stored 1.0.2 manifest; no MAIN template by default (REV-01 A01)', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let storedManifest: unknown = null;
  let putCount = 0;
  let detailCount = 0;
  let listCount = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/session') {
      return json({
        status: 'AUTHENTICATED',
        account: { userAccountId: '30000000-0000-4000-8000-000000000001', username: 'tester', fullName: 'Kiểm thử MIC' },
        expiresAt: '2026-10-20T00:00:00.000Z',
        serverTime: '2026-10-19T00:00:00.000Z',
      });
    }
    // WS01 / WS06: the AppShell reads the business menu and the session's admin capabilities once.
    if (path === '/api/foundation/navigation') return json({ navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') {
      return json({ permissions: { 'foundation.module_registry.read': true, 'foundation.module_version.read': true, 'foundation.module_version.update': true } });
    }
    if (path === '/api/foundation/modules') return json({ modules: [moduleRecord] });
    if (path === `/api/foundation/modules/${MODULE_ID}/versions` && request.method() === 'GET') {
      listCount += 1;
      return json({ versions: [{ ...initialVersion, manifestJson: storedManifest }] });
    }
    if (path === `/api/foundation/modules/${MODULE_ID}/versions/${VERSION_ID}` && request.method() === 'GET') {
      detailCount += 1;
      return json({ version: { ...initialVersion, manifestJson: storedManifest } });
    }
    if (path === `/api/foundation/modules/${MODULE_ID}/versions/${VERSION_ID}/manifest` && request.method() === 'PUT') {
      putCount += 1;
      const body: unknown = request.postDataJSON();
      expect(body).toEqual({ manifest: savedMic });
      storedManifest = savedMic;
      return json({ version: { ...initialVersion, manifestJson: storedManifest } });
    }
    // REV-01: the module list also reads the recent candidates (passive read).
    if (path === '/api/foundation/module-candidates' && request.method() === 'GET') return json({ candidates: [] });
    return json({ error: { code: 'UNEXPECTED_TEST_REQUEST', requestId: 'test' } }, 500);
  });

  const openVersion = async () => {
    await page.getByRole('button', { name: 'Phiên bản', exact: true }).click();
    await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
    await expect(page.locator('#fx-mic')).toBeVisible();
  };

  await page.goto('/foundation/modules');
  await expect(page).toHaveURL(/\/foundation\/modules$/);
  await expect(page.locator('#title')).toHaveText('QUẢN LÝ MODULE');
  await openVersion();

  const textarea = page.locator('#fx-mic');
  // FOUNDATION-REV-01 A01: a DRAFT without stored MIC is no longer pre-filled with the MAIN.READ template.
  await expect(page.getByText('CHƯA ĐỒNG BỘ MIC TỪ CANDIDATE.')).toBeVisible();
  await expect(textarea).toHaveValue('');
  await textarea.fill(JSON.stringify(savedMic, null, 2));
  await page.getByRole('button', { name: 'Lưu MIC', exact: true }).click();
  await expect(page.getByText('Đã lưu hồ sơ MIC (bản nháp) và đọc lại xác nhận khớp.')).toBeVisible();
  await expect(textarea).toContainText('"functionKey": "ORDER"');
  await expect(textarea).not.toContainText('"functionKey": "MAIN"');
  expect(putCount).toBe(1);
  expect(detailCount).toBe(1);

  await page.getByRole('dialog').getByRole('button', { name: 'Tải lại', exact: true }).click(); // REV-01: versions in the module drawer
  await expect(textarea).toContainText('"functionKey": "ORDER"');
  await expect(textarea).not.toContainText('"functionKey": "MAIN"');

  await page.reload();
  await openVersion();
  await expect(page.locator('#fx-mic')).toContainText('"functionKey": "ORDER"');
  await expect(page.locator('#fx-mic')).not.toContainText('"functionKey": "MAIN"');
  expect(listCount).toBeGreaterThanOrEqual(3);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  const evidencePath = process.env['MIC_EVIDENCE_SCREENSHOT'];
  if (evidencePath && test.info().project.name === 'react-preview') {
    const finalTextarea = page.locator('#fx-mic');
    await finalTextarea.evaluate((element) => { element.style.height = '760px'; });
    await finalTextarea.screenshot({ path: evidencePath });
  }
});
