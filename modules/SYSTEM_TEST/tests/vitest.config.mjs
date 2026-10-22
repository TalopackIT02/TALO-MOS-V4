// From backend/: npx vitest run --config ../modules/SYSTEM_TEST/tests/vitest.config.mjs
// Resolve bare package imports from the Host's dependency tree.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../backend');
export default {
  root: backend,
  resolve: { dedupe: ['vitest', 'express', 'react', 'zod'] },
  test: { dir: here, include: ['**/*.test.ts'], environment: 'node', env: {NODE_ENV:'test'} },
};
