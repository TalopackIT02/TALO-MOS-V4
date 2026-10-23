// DATA_INSPECTOR package tests — run from backend/ with the Host's own toolchain (no dependency of the package):
//   cd backend && npm run modules:sync && npx vitest run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs
// The tests exercise the INSTALLED copy (backend/src/installed-modules/DATA_INSPECTOR, what the Host really loads) through
// the REAL Host capabilities. Bare imports are resolved from backend/ (dedupe), since the package has no node_modules.
// The PostgreSQL suite (*.db.test.ts) is skipped unless TALO_DATA_INSPECTOR_DB=1 (TEST database only, read only).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../backend');

export default {
  root: backend,
  resolve: { dedupe: ['vitest', 'supertest', 'express', 'zod'] },
  test: {
    dir: here,
    include: ['**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
  },
};
