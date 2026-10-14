import { defineConfig } from '@playwright/test';

// AUTH-LOGIN-001 Phase A.
// "demo" renders the approved HTML v2 file and writes the reference screenshots;
// "react-dev" (Vite dev server) and "react-preview" (production build) are compared against them.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0, animations: 'disabled', caret: 'hide' },
  },
  use: {
    browserName: 'chromium',
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'demo' },
    { name: 'react-dev', use: { baseURL: 'http://127.0.0.1:5173' } },
    { name: 'react-preview', use: { baseURL: 'http://127.0.0.1:4173' } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../frontend',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
    },
    {
      command: 'npm run build && npm run preview',
      cwd: '../frontend',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
