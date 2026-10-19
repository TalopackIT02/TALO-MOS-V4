import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from '../foundation/foundation.http.js';
import { SystemTestError } from './system-test.service.js';
import type { SystemTestService } from './system-test.service.js';

// MOD-TEST-01 — SYSTEM_TEST module routes (MIC-05). Same session wrapper, origin / JSON protection, request id and
// error envelope as the Foundation routers. No route accepts SQL, a table name, a command or a file path.

export interface SystemTestRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: SystemTestService;
  readonly secureCookie: boolean;
}

async function answer(res: Response, run: () => Promise<object>): Promise<void> {
  try {
    res.status(200).json(await run());
  } catch (error) {
    if (!(error instanceof SystemTestError)) throw error;
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.fields ? { details: { fields: [...error.fields] } } : {}) },
    });
  }
}

export function systemTestRouter({ authService, service, secureCookie }: SystemTestRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });

  router.get('/system-test/health', handle(async (_req, res, actor) => answer(res, async () => ({ health: await service.health(actor) }))));
  router.post('/system-test/checks/run', handle(async (req, res, actor) => answer(res, async () => ({ run: await service.runChecks(actor, req.body) }))));
  router.get('/system-test/tables', handle(async (_req, res, actor) => answer(res, async () => ({ tables: await service.tables(actor) }))));
  router.get('/system-test/tables/:tableKey/rows', handle(async (req, res, actor) =>
    answer(res, async () => ({ data: await service.rows(actor, req.params['tableKey'], req.query) }))));
  router.get('/system-test/results', handle(async (_req, res, actor) => answer(res, async () => ({ results: await service.results(actor) }))));

  return router;
}
