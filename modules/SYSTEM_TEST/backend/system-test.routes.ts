import express from 'express';
import type { Response, Router } from 'express';
import type { ModuleHost } from './host.js';
import { SystemTestError } from './system-test.service.js';
import type { SystemTestService } from './system-test.service.js';

export interface SystemTestRouterDeps {
  readonly host: Pick<ModuleHost, 'session'>;
  readonly service: SystemTestService;
}
async function answer(res: Response, run: () => Promise<object>): Promise<void> {
  try { res.status(200).json(await run()); }
  catch (error) {
    if (!(error instanceof SystemTestError)) throw error;
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId,
      ...(error.fields ? { details: { fields: [...error.fields] } } : {}) } });
  }
}
export function systemTestRouter({ host, service }: SystemTestRouterDeps): Router {
  const router = express.Router();
  const session = host.session.bind(host);
  router.get('/system-test/health', session(async (_req, res, actor) => answer(res, async () => ({ health: await service.health(actor) }))));
  router.post('/system-test/checks/run', session(async (req, res, actor) => answer(res, async () => ({ run: await service.runChecks(actor, req.body) }))));
  router.get('/system-test/results', session(async (_req, res, actor) => answer(res, async () => ({ results: await service.results(actor) }))));
  // No table-viewer route, no arbitrary SQL and no route to invoke shell commands.
  return router;
}
