import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import { InstallerError } from './foundation.installer.service.js';
import type { ModuleInstallerService } from './foundation.installer.service.js';

// FMI-02 / FMI-03 routes (06_API_UI_CONTRACT.md). Same session wrapper, Origin / JSON protection, request id, no-store
// and error envelope {error:{code,message,requestId,details?}} as every Foundation router. Bodies carry ids and fixed
// enums only (strict); paths, commands, SQL or evidence are never accepted from the client.
//   POST /foundation/module-candidates                                    {scanId, moduleKey}  → 201 {candidate} (200 when it already exists)
//   GET  /foundation/module-candidates                                                         → 200 {candidates}
//   GET  /foundation/module-candidates/:candidateId                                            → 200 {candidate}
//   POST /foundation/module-candidates/:candidateId/preflight              {}                   → 202 {runId, status}
//   GET  /foundation/module-candidates/:candidateId/preflight/:runId                           → 200 {run}
//   GET  /foundation/module-candidates/:candidateId/preflight/:runId/report.(txt|json)         → 200 attachment
//   POST /foundation/module-candidates/:candidateId/install/prepare        {}                   → 200 {installation} (dryRun plan)
//   POST /foundation/module-candidates/:candidateId/install/commit         {planId, acknowledge:true} → 200 {installation}
//   GET  /foundation/module-installations/:installId                                           → 200 {installation}
//   POST /foundation/module-installations/:installId/continue              {}                   → 200 {installation}
//   POST /foundation/module-installations/:installId/close-failed          {acknowledge:true}   → 200 {installation} FAILED_SAFE
//   GET  /foundation/module-installations/:installId/report.txt                                → 200 attachment
//   GET  /foundation/runtime-release                                                           → 200 {runtime}

export interface ModuleInstallerRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: ModuleInstallerService;
  readonly secureCookie: boolean;
}

function fail(res: Response, error: unknown): void {
  if (!(error instanceof InstallerError)) throw error;
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.details ? { details: error.details } : {}) } });
}

async function answer(res: Response, status: number, run: () => Promise<object>): Promise<void> {
  try {
    res.status(status).json(await run());
  } catch (error) {
    fail(res, error);
  }
}

async function download(res: Response, type: string, run: () => Promise<{ name: string; content: string }>): Promise<void> {
  try {
    const { name, content } = await run();
    res.status(200).type(type).set('Content-Disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '_')}"`).send(content);
  } catch (error) {
    fail(res, error);
  }
}

export function moduleInstallerRouter({ authService, service, secureCookie }: ModuleInstallerRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });
  const C = '/foundation/module-candidates';
  router.post(C, handle(async (req, res, actor) => {
    try {
      const { candidate, created } = await service.createCandidate(actor, req.body);
      res.status(created ? 201 : 200).json({ candidate });
    } catch (error) {
      fail(res, error);
    }
  }));
  router.get(C, handle(async (_req, res, actor) => answer(res, 200, async () => ({ candidates: await service.listCandidates(actor) }))));
  router.get(`${C}/:candidateId`, handle(async (req, res, actor) => answer(res, 200, async () => ({ candidate: await service.getCandidate(actor, req.params['candidateId']) }))));
  router.post(`${C}/:candidateId/preflight`, handle(async (req, res, actor) => answer(res, 202, async () => service.startPreflight(actor, req.params['candidateId'], req.body))));
  router.get(`${C}/:candidateId/preflight/:runId`, handle(async (req, res, actor) => answer(res, 200, async () => ({ run: await service.getRun(actor, req.params['candidateId'], req.params['runId']) }))));
  router.get(`${C}/:candidateId/preflight/:runId/report.txt`, handle(async (req, res, actor) => download(res, 'text/plain; charset=utf-8', async () => service.report(actor, req.params['candidateId'], req.params['runId'], 'txt'))));
  router.get(`${C}/:candidateId/preflight/:runId/report.json`, handle(async (req, res, actor) => download(res, 'application/json; charset=utf-8', async () => service.report(actor, req.params['candidateId'], req.params['runId'], 'json'))));
  router.post(`${C}/:candidateId/install/prepare`, handle(async (req, res, actor) => answer(res, 200, async () => ({ installation: await service.prepare(actor, req.params['candidateId'], req.body) }))));
  router.post(`${C}/:candidateId/install/commit`, handle(async (req, res, actor) => answer(res, 200, async () => ({ installation: await service.commit(actor, req.params['candidateId'], req.body) }))));
  router.get('/foundation/module-installations/:installId', handle(async (req, res, actor) => answer(res, 200, async () => ({ installation: await service.getInstall(actor, req.params['installId']) }))));
  router.post('/foundation/module-installations/:installId/continue', handle(async (req, res, actor) => answer(res, 200, async () => ({ installation: await service.continueInstall(actor, req.params['installId'], req.body, { cookie: req.get('Cookie'), userAgent: req.get('User-Agent') }) }))));
  router.post('/foundation/module-installations/:installId/close-failed', handle(async (req, res, actor) => answer(res, 200, async () => ({ installation: await service.closeFailedInstall(actor, req.params['installId'], req.body) }))));
  router.get('/foundation/module-installations/:installId/report.txt', handle(async (req, res, actor) => download(res, 'text/plain; charset=utf-8', async () => service.installReport(actor, req.params['installId']))));
  router.get('/foundation/runtime-release', handle(async (_req, res, actor) => answer(res, 200, async () => ({ runtime: await service.runtimeRelease(actor) }))));
  return router;
}
