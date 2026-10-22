import express from 'express';
import type { Express, Router } from 'express';
import type { AppConfig } from './config/env.js';
import { errorHandler } from './core/http/errorHandler.js';
import { notFoundHandler } from './core/http/notFoundHandler.js';
import type { Logger } from './core/logging/logger.js';
import { requestLogger } from './core/logging/requestLogger.js';
import { originCheck, requireJson } from './core/middleware/originCheck.js';
import { requestId } from './core/middleware/requestId.js';
import { noStore, securityHeaders } from './core/middleware/securityHeaders.js';
import { MANIFEST_ROUTE, manifestJsonParser } from './modules/foundation/foundation.json.js';
import { NAVIGATION_BUILDER_ROUTE, NAVIGATION_PREVIEW_ROUTE, navigationBuilderJsonParser } from './modules/foundation/foundation.navigation.routes.js';
import { healthRouter } from './modules/health/health.routes.js';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  // Module routers mounted under /api. Defaults to the modules shipped in this phase.
  readonly apiRouters?: readonly Router[];
}

export function createApp({ config, logger, apiRouters }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  // No ETag: it is derived from the body (which carries the random requestId) and would make otherwise identical
  // responses differ in a header (INV-10); every API response is no-store anyway.
  app.set('etag', false);
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(noStore);
  app.use(requestLogger(logger));

  const api = express.Router();
  api.use(originCheck(config.appOrigins));
  api.use(requireJson);
  // FBE-02B P-1: PUT …/manifest only — 256 KiB parser, before the global one. body-parser skips a request whose body
  // has already been read, so the body is parsed once; every other API keeps the 10 kB limit.
  api.put(MANIFEST_ROUTE, manifestJsonParser);
  // Navigation Builder: a whole layout draft (apply / preview) — 1 MiB parser for these two routes only.
  api.put(NAVIGATION_BUILDER_ROUTE, navigationBuilderJsonParser);
  api.post(NAVIGATION_PREVIEW_ROUTE, navigationBuilderJsonParser);
  api.use(express.json({ limit: '10kb' }));
  for (const router of apiRouters ?? [healthRouter()]) api.use(router);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger, { exposeDiagnostics: config.nodeEnv !== 'production' }));

  return app;
}
