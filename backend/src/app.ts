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
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(noStore);
  app.use(requestLogger(logger));

  const api = express.Router();
  api.use(originCheck(config.appOrigins));
  api.use(requireJson);
  api.use(express.json({ limit: '10kb' }));
  for (const router of apiRouters ?? [healthRouter()]) api.use(router);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger, { exposeDiagnostics: config.nodeEnv !== 'production' }));

  return app;
}
