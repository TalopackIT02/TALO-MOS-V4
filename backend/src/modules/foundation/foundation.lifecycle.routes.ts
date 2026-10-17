import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import type { Actor } from './foundation.access.js';
import { sessionHandler } from './foundation.http.js';
import { LifecycleError } from './foundation.lifecycle.service.js';
import type { ModuleLifecycleService } from './foundation.lifecycle.service.js';
import type { ModuleRecord } from './foundation.repository.js';
import type { VersionRecord } from './foundation.versions.repository.js';

// FBE-05 — lifecycle routes (owner decision L7). POST only, body absent or {}; same session wrapper, CSRF / origin
// protection, request id and error envelope as every Foundation router. 200 with {version} or {module}.

export interface LifecycleRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: ModuleLifecycleService;
  readonly secureCookie: boolean;
}

function versionBody(v: VersionRecord) {
  return {
    versionId: v.versionId, moduleId: v.moduleId, moduleVersion: v.moduleVersion, contractVersion: v.contractVersion, status: v.status,
    manifestJson: v.manifestJson, manifestHash: v.manifestHash, submittedByAccountId: v.submittedByAccountId, createdAt: v.createdAt,
    reviewedByAccountId: v.reviewedByAccountId, reviewedAt: v.reviewedAt, activatedAt: v.activatedAt,
  };
}

function moduleBody(m: ModuleRecord) {
  return {
    moduleId: m.moduleId, moduleKey: m.moduleKey, moduleName: m.moduleName, description: m.description, moduleType: m.moduleType,
    isEnabled: m.isEnabled, createdAt: m.createdAt, updatedAt: m.updatedAt, createdByAccountId: m.createdByAccountId,
  };
}

// Same envelope as FoundationError; `details.errors` carries the gate codes of a 422.
async function answer(res: Response, run: () => Promise<object>): Promise<void> {
  try {
    res.status(200).json(await run());
  } catch (error) {
    if (!(error instanceof LifecycleError)) throw error;
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.errors ? { details: { errors: [...error.errors] } } : {}) },
    });
  }
}

const VERSION_PATH = '/foundation/modules/:moduleId/versions/:versionId';

export function moduleLifecycleRouter({ authService, service, secureCookie }: LifecycleRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });
  const versionRoute = (action: string, run: (actor: Actor, moduleId: unknown, versionId: unknown, body: unknown) => Promise<VersionRecord>) =>
    router.post(`${VERSION_PATH}/${action}`, handle(async (req, res, actor) =>
      answer(res, async () => ({ version: versionBody(await run(actor, req.params['moduleId'], req.params['versionId'], req.body)) }))));
  const moduleRoute = (action: string, run: (actor: Actor, moduleId: unknown, body: unknown) => Promise<ModuleRecord>) =>
    router.post(`/foundation/modules/:moduleId/${action}`, handle(async (req, res, actor) =>
      answer(res, async () => ({ module: moduleBody(await run(actor, req.params['moduleId'], req.body)) }))));

  versionRoute('approve', (a, m, v, b) => service.approve(a, m, v, b));
  versionRoute('reject', (a, m, v, b) => service.reject(a, m, v, b));
  versionRoute('activate', async (a, m, v, b) => (await service.activate(a, m, v, b)).version);
  versionRoute('retire', (a, m, v, b) => service.retire(a, m, v, b));
  moduleRoute('enable', (a, m, b) => service.enable(a, m, b));
  moduleRoute('disable', (a, m, b) => service.disable(a, m, b));
  return router;
}
