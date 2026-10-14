import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { STATE_VIEWPORTS, VIEWPORTS, openLogin, viewportName } from './viewports';

// Screenshots are named without the project, so "demo" writes the reference image
// and the React projects are compared pixel-for-pixel against it.

// Screenshot tolerance (approved 2026-10-14, Phase A option a): the React page shows non-deterministic
// anti-aliasing noise on rounded corners/icons that the demo does not (measured max ≈ 0.0178 YIQ,
// ≤ 4 pixels above 0.01 per image, in both layout and interaction-state screenshots).
// Pixels within threshold 0.01 are ignored; at most 10 pixels may exceed it. Negative controls
// (1px shift, 4/255 colour change, 1px radius change) produce 222+ pixels above 0.01 and still fail.
// Computed-style and geometry assertions below have no tolerance.
const SCREENSHOT_TOLERANCE = { threshold: 0.01, maxDiffPixels: 10 };

for (const viewport of VIEWPORTS) {
  const name = viewportName(viewport);

  test.describe(`viewport ${name}`, () => {
    test.use({ viewport });

    test('layout matches HTML v2', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await expect(page).toHaveScreenshot(`layout-${name}.png`, SCREENSHOT_TOLERANCE);
    });

    test('no page overflow and every control reachable', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return {
          horizontal: root.scrollWidth - root.clientWidth,
          vertical: root.scrollHeight - root.clientHeight,
        };
      });
      expect(overflow, 'page must not scroll').toEqual({ horizontal: 0, vertical: 0 });

      for (const selector of ['#username', '#password', '.login-button']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 1 });
      }
    });

    test('no opacity applied to brand, text or controls', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      const selectors = ['.logo', 'h1', '.subtitle', '#username', '#password', '.login-button', '.forgot', '.remember', '.footer'];
      for (const selector of selectors) {
        const opacities = await page.locator(selector).evaluate((element) => {
          const values: string[] = [];
          for (let node: Element | null = element; node; node = node.parentElement) {
            values.push(getComputedStyle(node).opacity);
          }
          return values;
        });
        expect(opacities.every((value) => value === '1'), `${selector} and its ancestors must be fully opaque`).toBe(true);
      }
    });
  });
}

test.describe('responsive contract', () => {
  async function gridRatio(page: Page): Promise<number> {
    const columns = await page.locator('.login-shell').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    const [left, right] = columns.split(' ').map((value) => Number.parseFloat(value));
    if (left === undefined || right === undefined) throw new Error(`Unexpected grid columns: ${columns}`);
    return left / (left + right);
  }

  async function style(locator: Locator, property: string, pseudo?: string): Promise<string> {
    return locator.evaluate(
      (element, args) => getComputedStyle(element, args.pseudo ?? null).getPropertyValue(args.property),
      { property, pseudo },
    );
  }

  test('desktop 1440x900: 40/60 grid, 760px max height, centred', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLogin(page, testInfo);
    const shell = page.locator('.login-shell');
    expect(await gridRatio(page)).toBeCloseTo(0.4, 3);
    expect(await style(shell, 'max-height')).toBe('760px');
    const box = await shell.boundingBox();
    if (!box) throw new Error('login-shell has no box');
    expect(box.height).toBe(760);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(0.5);
  });

  test('tablet 1024x768: 46/54 grid, no max height', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openLogin(page, testInfo);
    expect(await gridRatio(page)).toBeCloseTo(0.46, 3);
    expect(await style(page.locator('.login-shell'), 'max-height')).toBe('none');
  });

  test('mobile 390x844: warehouse background with 82% white veil, full 100dvh', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLogin(page, testInfo);
    const shell = page.locator('.login-shell');
    expect(await style(shell, 'background-image', '::before')).toContain('warehouse-illustration');
    expect(await style(shell, 'background-color', '::after')).toBe('rgba(255, 255, 255, 0.82)');
    expect(await style(page.locator('.illustration'), 'display')).toBe('none');
    const box = await shell.boundingBox();
    expect(box?.height).toBe(844);
  });

  test('images come from the original assets', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLogin(page, testInfo);
    const logo = page.locator('img.logo');
    const warehouse = page.locator('.illustration img');
    expect(await logo.getAttribute('src')).toContain('talopack-logo');
    expect(await warehouse.getAttribute('src')).toContain('warehouse-illustration');
    expect(await logo.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1424, 841]);
    expect(await warehouse.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1448, 1086]);
  });
});

for (const viewport of STATE_VIEWPORTS) {
  const name = viewportName(viewport);

  test.describe(`states ${name}`, () => {
    test.use({ viewport });

    test('username focused', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await page.locator('#username').focus();
      await expect(page).toHaveScreenshot(`state-focus-${name}.png`, SCREENSHOT_TOLERANCE);
    });

    test('password visible', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await page.locator('#password').fill('MatKhau@2026');
      await page.locator('#password-toggle').click();
      await page.mouse.move(0, 0);
      await page.locator('#password').blur();
      await expect(page).toHaveScreenshot(`state-password-visible-${name}.png`, SCREENSHOT_TOLERANCE);
    });

    test('validation error message', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await page.locator('.login-button').click();
      await page.mouse.move(0, 0);
      await page.locator('.login-button').blur();
      await expect(page).toHaveScreenshot(`state-error-${name}.png`, SCREENSHOT_TOLERANCE);
    });

    test('demo success message', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await page.locator('#username').fill('NV0001');
      await page.locator('#password').fill('MatKhau@2026');
      await page.locator('.login-button').click();
      await page.mouse.move(0, 0);
      await page.locator('.login-button').blur();
      await expect(page).toHaveScreenshot(`state-success-${name}.png`, SCREENSHOT_TOLERANCE);
    });

    test('login button hover', async ({ page }, testInfo) => {
      await openLogin(page, testInfo);
      await page.locator('.login-button').hover();
      await expect(page).toHaveScreenshot(`state-hover-${name}.png`, SCREENSHOT_TOLERANCE);
    });
  });
}
