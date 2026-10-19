import type { Router } from 'express';
import { createApp } from './app.js';
import { describeDatabaseUrl } from './config/database.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger } from './core/logging/logger.js';
import { disconnectPrismaClient, getPrismaClient } from './infrastructure/prisma/client.js';
import { createAuthModule } from './modules/auth/index.js';
import { compatibilityEnvironment } from './modules/foundation/foundation.compatibility.js';
import { createFoundationModule } from './modules/foundation/index.js';
import { healthRouter } from './modules/health/health.routes.js';
import { INSTALLED_MODULES } from './installed-modules/registry.js';
import { mountModules } from './module-host/loader.js';
import { prismaFoundationDb, SqlFoundationRepository } from './modules/foundation/foundation.repository.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error:\n${error.issues.map((issue) => `  - ${issue}`).join('\n')}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const apiRouters: Router[] = [healthRouter()];
  if (config.databaseUrl) {
    // Prepares the dummy Argon2id hash before the first request (P-5).
    const auth = await createAuthModule({
      prisma: getPrismaClient(config.databaseUrl), logger, production: config.nodeEnv === 'production',
    });
    apiRouters.push(auth.router);
    // Foundation Module Registry (FBE-01A): sessions are validated by the auth service only.
    const foundation = createFoundationModule({
      prisma: getPrismaClient(config.databaseUrl), authService: auth.service, logger, secureCookie: config.nodeEnv === 'production',
      environment: compatibilityEnvironment(config.nodeEnv),
    });
    apiRouters.push(foundation.router);
    // MOD-TEST-02: module packages of modules/ (generated registry), mounted through the Host capabilities; every module
    // request is still checked for Session + IAM + ACTIVE + ENABLED by those capabilities.
    const db = prismaFoundationDb(getPrismaClient(config.databaseUrl));
    apiRouters.push(...mountModules(INSTALLED_MODULES, {
      db, access: new SqlFoundationRepository(db), authService: auth.service, navigation: foundation.navigationService, logger,
      secureCookie: config.nodeEnv === 'production',
    }, logger));
  } else {
    logger.warn('DATABASE_URL not configured: /api/auth/* is not mounted');
  }

  const app = createApp({ config, logger, apiRouters });
  const database = config.databaseUrl ? describeDatabaseUrl(config.databaseUrl) : undefined;

  const server = app.listen(config.port, config.host, () => {
    logger.info('server started', {
      env: config.nodeEnv,
      host: config.host,
      port: config.port,
      trustProxy: config.trustProxy === false ? 'false' : String(config.trustProxy),
      database: database ? `${database.host}:${database.port}/${database.database}` : 'not configured',
    });
  });

  const shutdown = (signal: string) => {
    logger.info('shutdown requested', { signal });
    server.close(() => {
      disconnectPrismaClient().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  process.stderr.write(`Startup failed: ${error instanceof Error ? error.name : 'unknown error'}\n`);
  process.exit(1);
});
