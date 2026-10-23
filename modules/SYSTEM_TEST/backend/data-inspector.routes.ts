import express from 'express';
import type { Response, Router } from 'express';
import type { ModuleHost } from './host.js';
import { DataInspectorError } from './data-inspector.service.js';
import type { DataInspectorService } from './data-inspector.service.js';

// DATA_INSPECTOR routes (MIC-05): three GET, nothing else — no POST / PUT / PATCH / DELETE, no SQL, no schema / table
// name and no account / username is accepted from the request. The Host session wrapper (401 / PASSWORD_CHANGE_REQUIRED),
// origin protection, request id and the IAM error envelope (403 / 503) are those of the Foundation routers.

export interface DataInspectorRouterDeps {
  readonly host: Pick<ModuleHost, 'session'>;
  readonly service: DataInspectorService;
}

async function answer(res: Response, run: () => Promise<object>): Promise<void> {
  try {
    res.status(200).json(await run());
  } catch (error) {
    if (!(error instanceof DataInspectorError)) throw error;
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.fields ? { details: { fields: [...error.fields] } } : {}) },
    });
  }
}

export function dataInspectorRouter({ host, service }: DataInspectorRouterDeps): Router {
  const router = express.Router();
  const handle = host.session.bind(host);

  router.get('/system-test/data/tables', handle(async (_req, res, actor) => answer(res, () => service.tables(actor))));
  router.get('/system-test/data/tables/:tableKey/columns', handle(async (req, res, actor) => answer(res, () => service.columns(actor, req.params['tableKey']))));
  router.get('/system-test/data/tables/:tableKey/rows', handle(async (req, res, actor) => answer(res, () => service.rows(actor, req.params['tableKey'], req.query))));

  return router;
}
