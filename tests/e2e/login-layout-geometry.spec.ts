import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEMO_FILE, VIEWPORTS, viewportName } from './viewports';

// AUTH-IMPLEMENTATION-E2E: the Login received palette M-2 (colours only). Pixel comparisons against the frozen HTML v2
// demo therefore differ by design; this test proves the LAYOUT is unchanged: every element box of the React login
// equals the demo's at all Phase A viewports. Runs on react-dev / react-preview; /api is answered inside the browser
// (no request leaves it) with "no session" so the page is in its initial state.

const ELEMENTS = ['.login-shell', '.login-panel', '.logo', 'h1', '.subtitle', '#username', '#password', '#password-toggle',
  '.options', '.remember', '.forgot', '.login-button', '.footer', '.illustration'];

async function boxes(page: Page): Promise<Record<string, number[]>> {
  return page.evaluate((selectors) => {
    const out: Record<string, number[]> = {};
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const r = element?.getBoundingClientRect();
      out[selector] = r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2) : [];
    }
    return out;
  }, ELEMENTS);
}

for (const viewport of VIEWPORTS) {
  test(`layout geometry ${viewportName(viewport)}: React login boxes equal HTML v2`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name === 'demo', 'compares React against the demo');
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(DEMO_FILE).href);
    await page.waitForLoadState('load');
    const demo = await boxes(page);

    await page.route('**/api/**', (route) => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SESSION_INVALID', message: '', requestId: '00000000-0000-4000-8000-000000000000' } }),
    }));
    await page.goto(`${baseURL ?? ''}/login`);
    await page.locator('#login-form').waitFor();
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    const react = await boxes(page);
    expect(react).toEqual(demo);
  });
}
