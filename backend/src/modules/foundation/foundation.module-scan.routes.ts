import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import { ModuleScanError } from './foundation.module-scan.service.js';
import type { ModuleScanService } from './foundation.module-scan.service.js';

// FMI-01 — Manual Module Scan routes (03_API_CONTRACT.md). Same session wrapper, Origin / JSON protection, request id and
// Foundation error envelope as every Foundation router.
//   POST /foundation/module-packages/scan            body exactly {}  → 200 ScanReport (one scan; 409 when one is running)
//   GET  /foundation/module-packages/scans/:scanId                     → 200 the stored ScanReport (never scans again)

export interface ModuleScanRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: ModuleScanService;
  readonly secureCookie: boolean;
}

async function answer(res: Response, run: () => Promise<object>): Promise<void> {
  try {
    res.status(200).json(await run());
  } catch (error) {
    if (!(error instanceof ModuleScanError)) throw error;
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId } });
  }
}

export function moduleScanRouter({ authService, service, secureCookie }: ModuleScanRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });
  router.post('/foundation/module-packages/scan', handle(async (req, res, actor) => answer(res, async () => service.scan(actor, req.body))));
  router.get('/foundation/module-packages/scans/:scanId', handle(async (req, res, actor) => answer(res, async () => service.snapshot(actor, req.params['scanId']))));
  return router;
}
