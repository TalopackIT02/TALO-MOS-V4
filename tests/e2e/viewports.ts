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

// Accepted colour palette M-2 (design/auth-b1/AUTH-B1-color-accessibility.md §4, AUTH-B1 design acceptance) — colour
// properties only. The frozen demo file is never edited (SHA-256 checked below); for the comparison the reference is
// "demo layout + M-2 colours", produced by appending exactly these overrides at test time.
export const M2_DEMO_OVERRIDE = `
  :root { --muted:#4b5563; --line:#8a94a3; }
  .field input::placeholder { color:#6b7280; }
  .forgot { color:#076b38; }
  .login-button { background:#0b8043; }
  .login-button:hover { background:#086d37; }
  .login-button:focus-visible, .forgot:focus-visible, .password-toggle:focus-visible { outline-color:#0b8043; }
  .footer { color:#4b5563; }
`;

export const isDemo = (testInfo: TestInfo) => testInfo.project.name === 'demo';

// Opens the approved demo (project "demo", + M-2 colours) or the React app (react-dev / react-preview). The React app
// asks GET /api/auth/session at start; it is answered inside the browser with "no session" (401) so the page is in its
// initial Login state and no request leaves the browser. Other /api calls are answered by the individual tests.
export async function openLogin(page: Page, testInfo: TestInfo): Promise<void> {
  if (isDemo(testInfo)) {
    const sha = createHash('sha256').update(readFileSync(DEMO_FILE)).digest('hex');
    expect(sha, 'Approved HTML v2 demo file has changed').toBe(DEMO_SHA256);
    await page.goto(pathToFileURL(DEMO_FILE).href);
    await page.addStyleTag({ content: M2_DEMO_OVERRIDE });
  } else {
    await page.route('**/api/auth/session', (route) => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SESSION_INVALID', message: '', requestId: '00000000-0000-4000-8000-000000000000' } }),
    }));
    await page.goto('/');
    await page.locator('#login-form').waitFor();
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
