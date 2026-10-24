import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WS, open, ws } from './support/candidate-mock';

// FOUNDATION-REV-01 UI-01 — Candidate Workspace layout: no horizontal overflow of the page or of .workspace, every block
// (title, status, stepper, cards, toolbars, tables, plan / MIC diff / journal) inside the content area beside the
// Sidebar (open and collapsed), wide tables scroll only inside their own wrapper, drawer / modal keyboard behaviour.
// Measured with DOM rectangles / scrollWidth (not by eye). Mock API (./support/candidate-mock.ts), READY candidate with
// a prepared plan, long hashes / identifiers.

const VIEWPORTS = [
  { w: 1440, h: 900, desktop: true }, { w: 1366, h: 768, desktop: true }, { w: 1280, h: 720, desktop: true },
  { w: 1024, h: 768, desktop: true }, { w: 768, h: 1024, desktop: false }, { w: 390, h: 844, desktop: false },
];

interface Overflow { readonly doc: number; readonly docClient: number; readonly wsScroll: number; readonly wsClient: number; readonly outside: string[] }

// Everything inside the workspace region must stay within the workspace content box (1px tolerance). Elements inside an
// element that scrolls horizontally by design (.cw-scroll) are measured against that scroller instead.
async function measure(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');
    const region = document.querySelector<HTMLElement>('[aria-label="Candidate Workspace"]');
    if (!workspace || !region) throw new Error('workspace not rendered');
    const box = workspace.getBoundingClientRect();
    const style = getComputedStyle(workspace);
    const left = box.left + parseFloat(style.paddingLeft) - 1;
    const right = box.right - parseFloat(style.paddingRight) + 1;
    const outside: string[] = [];
    for (const el of Array.from(region.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest('.cw-scroll') && !el.classList.contains('cw-scroll')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < left || r.right > right) outside.push(`${el.tagName.toLowerCase()}.${el.className || ''} [${Math.round(r.left)}..${Math.round(r.right)}] vs [${Math.round(left)}..${Math.round(right)}]`);
    }
    return { doc: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth, wsScroll: workspace.scrollWidth, wsClient: workspace.clientWidth, outside: outside.slice(0, 12) };
  });
}

async function workspaceWithPlan(page: Page) {
  const m = await open(page, undefined, 'READY');
  m.status = 'READY';
  await page.goto(WS);
  await expect(ws(page)).toContainText('Kết luận: READY');
  await ws(page).getByRole('button', { name: 'Lập kế hoạch cài đặt' }).click();
  await expect(ws(page)).toContainText('Kế hoạch hợp lệ');
  await ws(page).getByText(/Khác biệt MIC/).click(); // open the MIC diff table too
  return m;
}

for (const vp of VIEWPORTS) {
  for (const collapsed of vp.desktop ? [false, true] : [false]) {
    test(`UI-01 ${vp.w}×${vp.h}${vp.desktop ? (collapsed ? ' sidebar thu gọn' : ' sidebar mở') : ''}: no horizontal overflow, every block inside the content area`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await workspaceWithPlan(page);
      if (collapsed) {
        await page.getByRole('button', { name: /Thu gọn/ }).click();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: test.info().outputPath(`ui01-${vp.w}x${vp.h}${collapsed ? '-collapsed' : ''}.png`) });
      for (const where of ['top', 'bottom'] as const) {
        if (where === 'bottom') await page.locator('.workspace').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const o = await measure(page);
        expect(o.doc, `${where}: document scrollWidth ${o.doc} > clientWidth ${o.docClient}`).toBeLessThanOrEqual(o.docClient + 1);
        expect(o.wsScroll, `${where}: .workspace scrollWidth ${o.wsScroll} > clientWidth ${o.wsClient}`).toBeLessThanOrEqual(o.wsClient + 1);
        expect(o.outside, `${where}: elements outside the content area`).toEqual([]);
      }
      await page.locator('.workspace').evaluate((el) => { el.scrollTop = 0; });
      // title, status line and the 4 steps are fully visible (not clipped by the Sidebar)
      const sidebarRight = await page.locator('aside.sidebar').evaluate((el) => el.getBoundingClientRect().right).catch(() => 0);
      for (const target of [ws(page).locator('h3').first(), ws(page).locator('.cw-status'), ws(page).locator('.cw-stepper')]) {
        const r = await target.boundingBox();
        expect(r).not.toBeNull();
        expect(r?.x ?? 0).toBeGreaterThanOrEqual(vp.desktop ? sidebarRight - 1 : 0);
      }
      await expect(ws(page).locator('.cw-stepper li')).toHaveCount(4);
    });
  }
}

test('UI-01 wide runtime / check tables scroll inside their own wrapper only; full hash reachable (title + copy)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await workspaceWithPlan(page);
  const wrappers = ws(page).locator('.cw-scroll');
  expect(await wrappers.count()).toBeGreaterThanOrEqual(3);
  for (const w of await wrappers.all()) {
    const overflowX = await w.evaluate((el) => getComputedStyle(el).overflowX);
    expect(['auto', 'scroll']).toContain(overflowX);
  }
  const hash = ws(page).locator('.cw-status code').first();
  await expect(hash).toHaveAttribute('title', 'a'.repeat(64));
  await expect(ws(page).getByRole('button', { name: 'Sao chép hash' })).toBeVisible();
  await expect(ws(page).getByRole('table', { name: 'Runtime đang chạy' })).toContainText('4cc97571bbc6…');
});

test('UI-01 summary: READY by required gates, optional NOT_TESTED and N/A kept apart, READY ≠ INSTALLED_ACTIVE', async ({ page }) => {
  await workspaceWithPlan(page);
  const summary = ws(page).locator('.cw-summary');
  await expect(summary).toContainText('Bắt buộc: 10/10 chấp nhận');
  await expect(summary).toContainText('Đạt 9');
  await expect(summary).toContainText('Lỗi 0');
  await expect(summary).toContainText('Không áp dụng (N/A) 1');
  await expect(summary).toContainText('Tùy chọn chưa chạy 1');
  await expect(summary).toContainText('READY chưa phải INSTALLED_ACTIVE');
});

test('UI-01 drawer and modal at 1366: Escape, focus kept inside and restored; reload / back / forward keep the layout', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await workspaceWithPlan(page);
  const opener = ws(page).getByRole('button', { name: 'Chi tiết P5b' });
  await opener.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true); // focus trapped
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await ws(page).getByRole('button', { name: 'Cài đặt & Kích hoạt' }).click();
  const modal = page.getByRole('dialog', { name: 'Cài đặt & Kích hoạt module' });
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(ws(page)).toContainText('Kết luận: READY');
  let o = await measure(page);
  expect(o.doc).toBeLessThanOrEqual(o.docClient + 1);
  expect(o.outside).toEqual([]);
  await page.goto('/foundation/modules');
  await page.goBack();
  await expect(ws(page)).toContainText('Kết luận: READY');
  o = await measure(page);
  expect(o.wsScroll).toBeLessThanOrEqual(o.wsClient + 1);
  await page.goForward();
  await expect(page).toHaveURL(/\/foundation\/modules$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
