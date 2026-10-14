import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

export type Viewport = { width: number; height: number };

// Desktop, short desktop (max-height:620px rule), tablet band 641–1080, mobile ≤640 and ≤360.
export const VIEWPORTS: Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 760 },
  { width: 1366, height: 600 },
  { width: 1080, height: 800 },
  { width: 1024, height: 768 },
  { width: 800, height: 1280 },
  { width: 641, height: 900 },
  { width: 640, height: 900 },
  { width: 390, height: 844 },
  { width: 360, height: 740 },
  { width: 320, height: 640 },
];

export const STATE_VIEWPORTS: Viewport[] = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

export const DEMO_FILE = resolve(__dirname, '../../frontend/TALO-MOS-Login-Demo-Responsive-v2.html');
export const DEMO_SHA256 = 'cbaedf91e3aff8b63569c2c53c7038edeff2dbf3a36b16e7e93895661af2246b';

export function viewportName({ width, height }: Viewport): string {
  return `${width}x${height}`;
}

// Opens the approved demo (project "demo") or the React app (react-dev / react-preview).
export async function openLogin(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name === 'demo') {
    const sha = createHash('sha256').update(readFileSync(DEMO_FILE)).digest('hex');
    expect(sha, 'Approved HTML v2 demo file has changed').toBe(DEMO_SHA256);
    await page.goto(pathToFileURL(DEMO_FILE).href);
  } else {
    await page.goto('/');
  }
  await waitForAssets(page);
}

// Waits for fonts, <img> elements and the mobile ::before background image.
export async function waitForAssets(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((image) => image.decode()));
    const shell = document.querySelector('.login-shell');
    if (!shell) return;
    const match = /url\("?([^")]+)"?\)/.exec(getComputedStyle(shell, '::before').backgroundImage);
    const url = match?.[1];
    if (url) {
      const image = new Image();
      image.src = url;
      await image.decode();
    }
  });
}
