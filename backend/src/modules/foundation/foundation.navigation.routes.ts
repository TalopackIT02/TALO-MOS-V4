import express from 'express';
import type { Response, Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import type { NavigationItem } from './foundation.navigation.js';
import { NavigationError } from './foundation.navigation.service.js';
import type { NavigationService } from './foundation.navigation.service.js';

// FBE-06 — Navigation routes (owner decision N3). Same session wrapper, origin / JSON protection, request id and error
// envelope as every Foundation router. POST 201 {item}, PATCH 200 {item}, GET 200 {navigation: MenuNode[]}.
// Navigation Builder (22/10/2026, foundation.navigation.manage):
//   GET  /foundation/navigation/builder            200 {layout}     every B09 row as areas / menus / Function links + legacy
//   GET  /foundation/navigation/builder/functions  200 {functions}  Function inventory (assignable or not, with the reason)
//   POST /foundation/navigation/builder/preview    200 {navigation} the menu of THIS account with the draft (no write)
//   PUT  /foundation/navigation/builder            200 {layout}     apply the whole draft atomically (409 on a revision conflict)
// A draft is larger than the global 10 kB body limit: the two Builder bodies get their own 1 MiB parser (app.ts).

export const NAVIGATION_BUILDER_ROUTE = '/foundation/navigation/builder';
export const NAVIGATION_PREVIEW_ROUTE = '/foundation/navigation/builder/preview';
export const navigationBuilderJsonParser = express.json({ limit: 1048576 });

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

  router.get(NAVIGATION_BUILDER_ROUTE, handle(async (_req, res, actor) => answer(res, 200, async () => ({ layout: await service.layout(actor) }))));

  router.get(`${NAVIGATION_BUILDER_ROUTE}/functions`, handle(async (_req, res, actor) => answer(res, 200, async () => ({ functions: await service.inventory(actor) }))));

  router.post(NAVIGATION_PREVIEW_ROUTE, handle(async (req, res, actor) => answer(res, 200, async () => ({ navigation: await service.preview(actor, req.body) }))));

  router.put(NAVIGATION_BUILDER_ROUTE, handle(async (req, res, actor) => answer(res, 200, async () => ({ layout: await service.apply(actor, req.body) }))));

  return router;
}
