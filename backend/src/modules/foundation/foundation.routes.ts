import express from 'express';
import type { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import type { ModuleRecord } from './foundation.repository.js';
import type { FoundationService } from './foundation.service.js';

// /api/foundation/modules (FBE-01A). The session is validated only by AuthService.describeSession() — the same
// validator as GET /api/auth/session (no second validator), through the shared sessionHandler. CSRF X1, JSON limit,
// request id and no-store come from the /api stack in app.ts.

export interface FoundationRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: FoundationService;
  readonly secureCookie: boolean;
}

function moduleBody(m: ModuleRecord) {
  return {
    moduleId: m.moduleId, moduleKey: m.moduleKey, moduleName: m.moduleName, description: m.description, moduleType: m.moduleType,
    isEnabled: m.isEnabled, createdAt: m.createdAt, updatedAt: m.updatedAt, createdByAccountId: m.createdByAccountId,
  };
}

export function foundationRouter({ authService, service, secureCookie }: FoundationRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });

  router.get('/foundation/modules', handle(async (_req, res, actor) => {
    const modules = await service.listModules(actor);
    res.status(200).json({ modules: modules.map(moduleBody) });
  }));

  router.post('/foundation/modules', handle(async (req, res, actor) => {
    const module = await service.registerModule(actor, req.body);
    res.status(201).json({ module: moduleBody(module) });
  }));

  return router;
}
