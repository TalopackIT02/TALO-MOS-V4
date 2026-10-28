import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { IID, WS, install, open, steps, ws } from './support/candidate-mock';

// SCC handoff WP3 — Candidate Workspace: close a FAILED NEW_MODULE installation as FAILED_SAFE (mock API). The button only
// exists for RECOVERY_REQUIRED + NEW_MODULE without an upgrade recovery point; the request carries {acknowledge:true}.

test.use({ viewport: { width: 1440, height: 900 } });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const failedNew = install('RECOVERY_REQUIRED', { classification: 'NEW_MODULE', steps: steps(13), recoveryPoint: null,
  recovery: ['Nguyên nhân: hậu kiểm FAIL: ACCESS_VERIFIED.', 'Đã TẮT module (DISABLE, có audit).'] });

async function withJournal(page: Page, journal: Record<string, unknown>, closes: unknown[]) {
  const m = await open(page, undefined, 'READY');
  m.installId = IID;
  await page.route(`**/api/foundation/module-installations/${IID}/close-failed`, async (route) => {
    closes.push(JSON.parse(route.request().postData() ?? 'null'));
    return json(route, { installation: install('FAILED_SAFE', { classification: 'NEW_MODULE', steps: steps(13), recovery: ['Đóng lượt cài đặt thất bại (FAILED_SAFE).'] }) });
  });
  await page.route(`**/api/foundation/module-installations/${IID}`, (route) => json(route, { installation: journal }));
  await page.goto(WS);
  return m;
}

test('failed NEW_MODULE journal: confirm modal (RECOVERY_REQUIRED → FAILED_SAFE) → POST {acknowledge:true} once → "Dừng an toàn", no Continue', async ({ page }) => {
  const closes: unknown[] = [];
  await withJournal(page, failedNew, closes);
  const button = ws(page).getByRole('button', { name: 'Đóng lượt cài đặt thất bại…' });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('RECOVERY_REQUIRED → FAILED_SAFE');
  await expect(dialog).toContainText('Giữ nguyên phiên bản B02');
  expect(closes).toEqual([]); // nothing sent before the confirmation
  await dialog.getByRole('button', { name: 'Đóng lượt cài đặt' }).click();
  await expect(ws(page)).toContainText('Dừng an toàn');
  expect(closes).toEqual([{ acknowledge: true }]);
  await expect(ws(page).getByRole('button', { name: 'Đóng lượt cài đặt thất bại…' })).toHaveCount(0);
  await expect(ws(page).getByRole('button', { name: 'Tiếp tục' })).toHaveCount(0);
});

test('cancel sends nothing; an UPGRADE journal (recovery point) or a finished one has no close button', async ({ page }) => {
  const closes: unknown[] = [];
  await withJournal(page, failedNew, closes);
  await ws(page).getByRole('button', { name: 'Đóng lượt cài đặt thất bại…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click();
  expect(closes).toEqual([]);
  for (const journal of [install('RECOVERY_REQUIRED', { classification: 'UPGRADE', recoveryPoint: { activeVersion: '0.1.0' } }), install('INSTALLED_ACTIVE', { classification: 'NEW_MODULE' })]) {
    await page.unroute(`**/api/foundation/module-installations/${IID}`);
    await page.route(`**/api/foundation/module-installations/${IID}`, (route) => json(route, { installation: journal }));
    await page.reload();
    await expect(ws(page)).toContainText('Kết luận: READY');
    await expect(ws(page).getByRole('button', { name: 'Đóng lượt cài đặt thất bại…' })).toHaveCount(0);
  }
});
