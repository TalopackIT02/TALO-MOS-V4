import { Router } from 'express';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import type { AppConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/core/logging/logger.js';
import { healthRouter } from '../../src/modules/health/health.routes.js';

export const TEST_ORIGIN = 'http://127.0.0.1:5173';
export const FAKE_SECRET_URL = 'postgresql://talo_app:S3cr3t-Value@db.internal:5432/talo';

// Routes that exist only in the test harness, to exercise the core middleware (no auth endpoints exist in F1).
function harnessRouter(): Router {
  const router = Router();
  router.post('/__test/echo', (req, res) => {
    res.json({ ok: true, keys: Object.keys(req.body ?? {}) });
  });
  router.get('/__test/boom', () => {
    throw new Error(`connect failed for ${FAKE_SECRET_URL}`);
  });
  router.get('/__test/prisma-boom', () => {
    const error = new Error(`Invalid invocation: password authentication failed (${FAKE_SECRET_URL})`);
    error.name = 'PrismaClientKnownRequestError';
    Object.assign(error, { code: 'P1000' });
    throw error;
  });
  router.get('/__test/client', (req, res) => {
    res.json({ ip: req.ip, protocol: req.protocol });
  });
  return router;
}

export interface TestApp {
  app: Express;
  logs: string[];
  config: AppConfig;
}

export function buildTestApp(env: NodeJS.ProcessEnv = {}): TestApp {
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN, ...env });
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const app = createApp({ config, logger, apiRouters: [healthRouter(), harnessRouter()] });
  return { app, logs, config };
}
