import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// IAM-B-UI-01 FIX-04 / FIX-05 — the Direct ALLOW / DENY form (account workspace › Chức năng & Quyền) and the MIC-07 (K05)
// permission form (Vai trò và quyền › Danh mục Permission) with LONG option texts: no field may overlap another or leave
// its form, at 1366×768, 1024×768, 768×1024 and 390×844. API intercepted (MOCK); layout only.
// EVIDENCE_DIR=<folder> also writes a screenshot of each form per viewport.

const USER = '30000000-0000-4000-8000-000000000001';
const LONG = 'Quản lý kho thành phẩm và điều phối xuất nhập theo lô sản xuất';
const CAPS = ['iam.accounts.read', 'iam.assignments.manage', 'iam.permissions.manage', 'iam.roles.manage'];

const permission = (i: number) => ({
  permissionId: `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`, permissionCode: `warehouse_finished_goods.dispatch_by_production_lot.action_${i}`,
  moduleCode: 'WAREHOUSE_FINISHED_GOODS', resourceCode: 'DISPATCH', operation: `ACTION_${i}`, minimumAssuranceLevel: 1, description: null,
});

async function open(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/api/auth/session') {
      return json({ status: 'AUTHENTICATED', account: { userAccountId: '30000000-0000-4000-8000-0000000000aa', username: 'admin2', fullName: 'Quản trị 2' }, expiresAt: '2026-10-22T00:00:00.000Z', serverTime: '2026-10-21T00:00:00.000Z' });
    }
    if (path === '/api/foundation/navigation') return json({ navigation: [] });
    if (path === '/api/iam/admin/me/capabilities') return json({ permissions: Object.fromEntries(CAPS.map((c) => [c, true])), features: { temporaryCredentials: 'READY' } });
    if (path === `/api/iam/admin/accounts/${USER}`) {
      return json({ account: { accountId: USER, username: 'nv0101', accountStatus: 'ACTIVE', disabled: false, employeeCode: 'E0101', fullName: 'Nguyễn Văn A', membershipStatus: 'ACTIVE', isRoot: false } });
    }
    if (path === `/api/iam/admin/accounts/${USER}/permissions`) return json({ direct: [], effective: [], assumption: 'x' });
    if (path === `/api/iam/admin/accounts/${USER}/details`) return json({ details: null });
    if (path === '/api/iam/admin/permission-tree') {
      return json({ tree: { modules: [{ moduleKey: 'WAREHOUSE_FINISHED_GOODS', moduleName: LONG, description: null, isEnabled: true, moduleVersion: '1.0.0', functions: [
        { functionKey: 'DISPATCH_BY_PRODUCTION_LOT', functionName: `${LONG} — điều phối`, actions: Array.from({ length: 6 }, (_, i) => ({ actionKey: `ACTION_${i}`, actionName: `Phê duyệt phiếu xuất kho thành phẩm theo lô ${i}`, actionDescription: null, permission: permission(i) })) },
      ] }], platform: [], unbound: [] } });
    }
    if (path === '/api/iam/admin/permissions') return json({ permissions: Array.from({ length: 6 }, (_, i) => permission(i)) });
    if (path === '/api/iam/admin/roles') return json({ roles: [] });
    if (path === '/api/iam/admin/foundation/modules') {
      return json({ modules: [{ moduleId: '50000000-0000-4000-8000-000000000001', moduleKey: 'WAREHOUSE_FINISHED_GOODS', moduleName: LONG, isEnabled: true, activeVersion: '1.0.0' }] });
    }
    if (path === '/api/iam/admin/foundation/modules/50000000-0000-4000-8000-000000000001/functions') {
      return json({ functions: Array.from({ length: 8 }, (_, i) => ({ functionId: `60000000-0000-4000-8000-00000000000${i}`, functionKey: `DISPATCH_BY_PRODUCTION_LOT_${i}`, displayName: `${LONG} — chức năng ${i}`, actionKey: `APPROVE_FINISHED_GOODS_ISSUE_${i}` })) });
    }
    return json({ error: { code: 'NOT_IN_TEST', requestId: 'test' } }, 503);
  });
}

// Every field (label / button) of the form: inside the form, and no two boxes intersect.
async function expectNoOverlap(form: Locator, fields: Locator) {
  const frame = await form.boundingBox();
  expect(frame).not.toBeNull();
  const boxes = [];
  for (const field of await fields.all()) {
    const box = await field.boundingBox();
    if (box) boxes.push(box);
  }
  expect(boxes.length).toBeGreaterThan(2);
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual((frame?.x ?? 0) - 1);
    expect(b.x + b.width).toBeLessThanOrEqual((frame?.x ?? 0) + (frame?.width ?? 0) + 1);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b) continue;
      const overlap = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
      expect(overlap, `fields ${i} and ${j} overlap`).toBe(false);
    }
  }
  // Each control stays inside its own field (a long option text never spills over the next field).
  for (const control of await form.locator('select, input:not([type=checkbox])').all()) {
    const c = await control.boundingBox();
    const parent = await control.locator('xpath=..').boundingBox();
    if (c && parent) expect(c.x + c.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
  }
}

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test(`CSS-01/03 Direct ALLOW/DENY form — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page);
    await page.goto(`/iam/accounts/${USER}?section=permissions`);
    const form = page.locator('form', { has: page.getByRole('button', { name: 'Cấp quyền trực tiếp' }) });
    await expect(form).toBeVisible();
    await form.locator('select').first().selectOption({ index: 3 }); // the longest kind of option text
    if (process.env['EVIDENCE_DIR']) await form.screenshot({ path: `${process.env['EVIDENCE_DIR']}/direct-grant-${vp.name}.png` });
    await expectNoOverlap(form, form.locator(':scope > label, :scope > div'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`CSS-02/03 MIC-07 permission form — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page);
    await page.goto('/iam/roles');
    await page.locator('#tabs button', { hasText: 'Danh mục Permission' }).click();
    const form = page.locator('form', { has: page.getByRole('button', { name: 'Tạo permission' }) });
    await expect(form).toBeVisible();
    await form.getByLabel('Module').selectOption({ index: 1 });
    await form.getByLabel('Chức năng / Thao tác').selectOption({ index: 1 });
    const fields = form.locator('.fx-form');
    if (process.env['EVIDENCE_DIR']) await form.screenshot({ path: `${process.env['EVIDENCE_DIR']}/mic07-${vp.name}.png` });
    await expectNoOverlap(fields, fields.locator(':scope > label'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
