// FMI-02 P3 — fixed Host-owned Vitest configuration for a candidate's own package tests (the package's vitest config is
// NOT used: no candidate configuration is executed). The preflight engine passes the STAGED test folder through
// TALO_PREFLIGHT_TESTS; bare imports resolve from backend/ (the Host toolchain). PostgreSQL suites (*.db.test.ts) are
// excluded here: they need an isolated database (P5, reported NOT_TESTED).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.TALO_PREFLIGHT_TESTS;
if (!dir) throw new Error('TALO_PREFLIGHT_TESTS is required');

export default {
  root: resolve(here, '../..'),
  resolve: { dedupe: ['vitest', 'supertest', 'express', 'zod', 'react'] },
  test: {
    dir,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/*.db.test.ts', '**/node_modules/**'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
    testTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 1,
  },
};
