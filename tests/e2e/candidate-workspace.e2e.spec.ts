import { expect, test } from '@playwright/test';
import { ACTIVATE, CREATE, READ, VREAD, WS, open, toReady, ws } from './support/candidate-mock';

// FOUNDATION-REV-01 REV-B — Quản lý Module list + Candidate Workspace (mock API: ./support/candidate-mock.ts).

test.use({ viewport: { width: 1440, height: 900 } });

test('B02 / B07: scan row → workspace route; preflight polled to the end; stepper; N/A and optional NOT_TESTED kept apart; reload keeps the candidate', async ({ page }) => {
  const m = await open(page);
  await toReady(page);
  await expect(ws(page)).toContainText('Kết luận: READY');
  await expect(ws(page).locator('.cw-stepper li.cw-done')).toHaveText(['1. Quét', '2. Kiểm tra & Chạy thử']);
  await expect(ws(page).locator('.cw-stepper li[aria-current="step"]')).toHaveText('3. Kế hoạch');
  await expect(ws(page)).toContainText('Không áp dụng (N/A) 1'); // UI-01 summary wording
  await expect(ws(page).getByRole('table', { name: 'Các phép kiểm' }).locator('tbody tr')).toHaveCount(11);
  await expect(ws(page)).toContainText('READY chưa phải INSTALLED_ACTIVE');
  await expect(page.locator('#crumb')).toContainText('Candidate Workspace');
  const polls = m.polls;
  await page.waitForTimeout(2500);
  expect(m.polls).toBe(polls); // polling stopped
  await page.reload();
  await expect(ws(page)).toContainText('Kết luận: READY'); // read from the server again
  await ws(page).getByRole('button', { name: '← Quản lý Module' }).click();
  await expect(page).toHaveURL(/\/foundation\/modules$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${WS}$`));
});

test('B06 / B10: a check row opens the right drawer (issue field / expected / actual), Escape closes it and focus returns; the TXT report still downloads', async ({ page }) => {
  const m = await open(page);
  m.fail = true;
  await toReady(page);
  await expect(ws(page)).toContainText('Kết luận: NEEDS_FIX');
  const opener = ws(page).getByRole('button', { name: 'Chi tiết P4' });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'HOST_HANDSHAKE' });
  await expect(drawer).toBeVisible();
  for (const t of ['mic05Api', 'GET /customers/list', '(không có)', 'bắt buộc']) await expect(drawer).toContainText(t);
  const box = await drawer.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(680);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(ws(page).getByRole('button', { name: 'Lập kế hoạch cài đặt' })).toHaveCount(0); // NEEDS_FIX: no plan
  const download = page.waitForEvent('download');
  await ws(page).getByRole('button', { name: 'Tải báo cáo TXT' }).click();
  expect((await download).suggestedFilename()).toBe('preflight-CUSTOMER_MANAGEMENT-0.1.0-33333333.txt');
});

test('B08 / E2E-02 / E2E-06: plan shows MIC diff + B09 placement; install confirmed in a popup; AWAITING_RESTART → RESTART_PENDING → POSTCHECK_INCOMPLETE → INSTALLED_ACTIVE', async ({ page }) => {
  const m = await open(page);
  await toReady(page);
  await ws(page).getByRole('button', { name: 'Lập kế hoạch cài đặt' }).click();
  await expect(ws(page)).toContainText('Kế hoạch hợp lệ (chưa thực hiện)');
  await ws(page).getByText(/Khác biệt MIC/).click();
  await expect(ws(page).getByRole('table', { name: 'Khác biệt MIC' }).locator('tbody tr')).toHaveCount(3);
  await expect(ws(page)).toContainText('Quản lý khách hàng › Khách hàng — Danh sách khách hàng');
  await ws(page).getByRole('button', { name: 'Cài đặt & Kích hoạt' }).click();
  const modal = page.getByRole('dialog', { name: 'Cài đặt & Kích hoạt module' });
  await expect(modal).toContainText('Thay MIC của DRAFT hiện có bằng MIC của Candidate');
  await modal.getByRole('button', { name: 'Hủy' }).click(); // cancel: nothing sent
  expect(m.calls.some((c) => c.endsWith('/install/commit'))).toBe(false);
  await ws(page).getByRole('button', { name: 'Cài đặt & Kích hoạt' }).click();
  await page.getByRole('dialog', { name: 'Cài đặt & Kích hoạt module' }).getByRole('button', { name: 'Cài đặt & Kích hoạt' }).click();
  await expect(ws(page)).toContainText('Chờ khởi động lại');
  await expect(ws(page)).not.toContainText('Đã cài đặt & hoạt động');
  await page.reload(); // the journal comes back from the server (latestInstallId)
  await expect(ws(page)).toContainText('Chờ khởi động lại');
  await ws(page).getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('alert')).toContainText('khởi động lại');
  m.restart = 'incomplete';
  await ws(page).getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(ws(page)).toContainText('hậu kiểm chưa đủ');
  await expect(ws(page)).toContainText('Chưa gán quyền module');
  await expect(ws(page)).not.toContainText('Đã cài đặt & hoạt động');
  m.restart = 'done';
  await ws(page).getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(ws(page)).toContainText('Đã cài đặt & hoạt động');
  await expect(ws(page).locator('.ms-plan .ms-checks > li')).toHaveCount(7);
});

test('blocked plan lists its codes, no install button; without ACTIVATE no plan; an invalid workspace id opens the module list', async ({ page }) => {
  const m = await open(page);
  m.blockers = [{ code: 'UPGRADE_RECOVERY_UNAVAILABLE', message: 'Không có đường RETIRED → ACTIVE đã kiểm thử.' }, { code: 'IAM_DB_GRANT_MISSING', message: 'Thiếu grant.' }];
  await toReady(page);
  await ws(page).getByRole('button', { name: 'Lập kế hoạch cài đặt' }).click();
  await expect(ws(page)).toContainText('Bị chặn');
  for (const t of ['UPGRADE_RECOVERY_UNAVAILABLE', 'IAM_DB_GRANT_MISSING']) await expect(ws(page)).toContainText(t);
  await expect(ws(page).getByRole('button', { name: 'Cài đặt & Kích hoạt' })).toHaveCount(0);
  await expect(ws(page).locator('.cw-stepper li.cw-blocked')).toHaveText(['3. Kế hoạch']);
  const other = await page.context().newPage();
  await open(other, [READ, CREATE], 'READY');
  await other.goto(WS); // direct URL
  await expect(ws(other)).toContainText('Kết luận: READY');
  await expect(ws(other).getByRole('button', { name: 'Lập kế hoạch cài đặt' })).toHaveCount(0);
  await expect(ws(other)).toContainText('Cần quyền foundation.module_version.activate');
  await other.goto('/foundation/modules/candidates/not-a-uuid');
  await expect(other).toHaveURL(/\/foundation\/modules$/);
});

test('B10 mobile: the check drawer takes the full width', async ({ page }) => {
  const m = await open(page, [READ, CREATE, ACTIVATE, VREAD], 'READY');
  m.status = 'READY';
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(WS);
  await ws(page).getByRole('button', { name: 'Chi tiết P0' }).click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(375);
});
