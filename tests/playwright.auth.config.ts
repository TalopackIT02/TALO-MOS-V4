import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// AUTH-IMPLEMENTATION-E2E — real browser flow against the real backend and PostgreSQL test database.
// Own ports so a developer's running servers are not disturbed: backend 127.0.0.1:3100, frontend 127.0.0.1:5174.
// The backend reads DATABASE_URL (talo_app@talo_mos_v4_test) from the git-ignored root .env.
// Fixtures: created in global setup and deleted in teardown (backend/test/support/e2eFixtures.ts, role talo_test_harness).

process.env['AUTH_E2E_RUN'] ??= `AUTHT-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const runId = process.env['AUTH_E2E_RUN'];
const FRONTEND = 'http://127.0.0.1:5174';
const BACKEND = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  testMatch: /auth-flow\.e2e\.spec\.ts/,
  outputDir: './test-results/auth-e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/auth-e2e.setup.ts',
  use: {
    browserName: 'chromium',
    baseURL: FRONTEND,
    deviceScaleFactor: 1,
    userAgent: `${runId} auth-tests`, // tags unknown-username audit rows of this run for cleanup
  },
  webServer: [
    {
      command: 'npx tsx --env-file-if-exists=../.env src/server.ts',
      cwd: '../backend',
      url: `${BACKEND}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: '3100', HOST: '127.0.0.1', APP_ORIGIN: FRONTEND, NODE_ENV: 'development', LOG_LEVEL: 'warn' },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      cwd: '../frontend',
      url: FRONTEND,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { TALO_API_TARGET: BACKEND },
    },
  ],
});
