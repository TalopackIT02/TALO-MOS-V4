import { createApp } from './app.js';
import { describeDatabaseUrl } from './config/database.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger } from './core/logging/logger.js';
import { disconnectPrismaClient } from './infrastructure/prisma/client.js';

function main(): void {
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
  const app = createApp({ config, logger });
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

main();
