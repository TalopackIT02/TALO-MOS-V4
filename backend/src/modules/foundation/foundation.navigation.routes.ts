import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import type { NavigationItem } from './foundation.navigation.js';
import { NavigationError } from './foundation.navigation.service.js';
import type { NavigationService } from './foundation.navigation.service.js';

// FBE-06 — Navigation routes (owner decision N3). Same session wrapper, origin / JSON protection, request id and error
// envelope as every Foundation router. POST 201 {item}, PATCH 200 {item}, GET 200 {navigation: MenuNode[]}.

export interface NavigationRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: NavigationService;
  readonly secureCookie: boolean;
}

function itemBody(n: NavigationItem) {
  return {
    navigationId: n.navigationId, parentId: n.parentId, moduleId: n.moduleId, functionId: n.functionId, menuTitle: n.menuTitle,
    sortOrder: n.sortOrder, isVisible: n.isVisible, createdAt: n.createdAt,
  };
}

async function answer(res: Response, status: number, run: () => Promise<object>): Promise<void> {
  try {
    const body = await run();
    res.status(status).json(body);
  } catch (error) {
    if (!(error instanceof NavigationError)) throw error;
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.fields ? { details: { fields: [...error.fields] } } : {}) },
    });
  }
}

export function navigationRouter({ authService, service, secureCookie }: NavigationRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });

  router.get('/foundation/navigation', handle(async (_req, res, actor) => answer(res, 200, async () => ({ navigation: await service.menu(actor) }))));

  router.post('/foundation/navigation/items', handle(async (req, res, actor) =>
    answer(res, 201, async () => ({ item: itemBody(await service.createItem(actor, req.body)) }))));

  router.patch('/foundation/navigation/items/:navigationId', handle(async (req, res, actor) =>
    answer(res, 200, async () => ({ item: itemBody(await service.updateItem(actor, req.params['navigationId'], req.body)) }))));

  return router;
}
