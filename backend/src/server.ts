import type { Router } from 'express';
import { createApp } from './app.js';
import { describeDatabaseUrl } from './config/database.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger } from './core/logging/logger.js';
import { createPrismaClient, disconnectPrismaClient, getPrismaClient } from './infrastructure/prisma/client.js';
import { createAuthModule } from './modules/auth/index.js';
import { compatibilityEnvironment } from './modules/foundation/foundation.compatibility.js';
import { createFoundationModule } from './modules/foundation/index.js';
import { healthRouter } from './modules/health/health.routes.js';
import { connectIamAdmin } from './modules/iam-admin/iam.admin.connection.js';
import type { IamAdminConnection } from './modules/iam-admin/iam.admin.connection.js';
import { connectProvisioner } from './modules/iam-admin/iam.admin.provisioner.js';
import type { ProvisionerConnection } from './modules/iam-admin/iam.admin.provisioner.js';
import { iamAdminRouter } from './modules/iam-admin/iam.admin.routes.js';
import { INSTALLED_MODULES } from './installed-modules/registry.js';
import { mountModuleMap } from './module-host/loader.js';
import { createIamCatalog } from './modules/foundation/foundation.installer.iam.js';
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
  let iamAdmin: IamAdminConnection | undefined;
  let provisioner: ProvisionerConnection | undefined;
  if (config.databaseUrl) {
    // Prepares the dummy Argon2id hash before the first request (P-5).
    const auth = await createAuthModule({
      prisma: getPrismaClient(config.databaseUrl), logger, production: config.nodeEnv === 'production',
    });
    apiRouters.push(auth.router);
    // IAM Management is additive: independent routes, sharing the existing Auth and IAM evaluator. IAM-NEXT B1: it
    // reads / writes IAM through its own role (IAM_ADMIN_DATABASE_URL, talo_iam_admin); talo_app never writes IAM.
    iamAdmin = await connectIamAdmin({
      iamUrl: config.iamAdminDatabaseUrl, apiClient: getPrismaClient(config.databaseUrl), createClient: createPrismaClient, logger,
    });
    // FMI-02 / FMI-03: the installer sees what THIS process runs (generated registry + the routers mounted below).
    const moduleRouters = new Map<string, Router>();
    const runtime = {
      modules: INSTALLED_MODULES.map((m) => ({ moduleKey: m.manifest.moduleKey, packageVersion: m.manifest.packageVersion, packageHash: m.manifest.packageHash ?? null })),
      routers: moduleRouters,
    };
    // Foundation Module Registry (FBE-01A): sessions are validated by the auth service only.
    const foundation = createFoundationModule({
      prisma: getPrismaClient(config.databaseUrl), authService: auth.service, logger, secureCookie: config.nodeEnv === 'production',
      environment: compatibilityEnvironment(config.nodeEnv),
      installer: {
        runtime, iam: iamAdmin.dedicated ? createIamCatalog(iamAdmin.db, config.iamRootAdminAccountId ?? null) : null,
        environment: { label: 'TEST', database: describeDatabaseUrl(config.databaseUrl)?.database ?? 'unknown', nodeEnv: config.nodeEnv },
      },
    });
    apiRouters.push(foundation.router);
    // IAM Phase B: account creation / re-issue from the AppShell only when the owner enabled it AND talo_provisioner checks out.
    provisioner = await connectProvisioner({
      enabled: config.iamUiTemporaryCredentials, url: config.provisionerDatabaseUrl, apiClient: getPrismaClient(config.databaseUrl),
      createClient: createPrismaClient, logger,
    });
    apiRouters.push(iamAdminRouter({
      db: iamAdmin.db, authService: auth.service, secureCookie: config.nodeEnv === 'production', rootAccountId: config.iamRootAdminAccountId ?? null,
      provisioner, hasher: auth.hasher,
    }));
    logger.info('IAM Management: root administrator protection', { configured: config.iamRootAdminAccountId !== undefined });
    // MOD-TEST-02: module packages of modules/ (generated registry), mounted through the Host capabilities; every module
    // request is still checked for Session + IAM + ACTIVE + ENABLED by those capabilities.
    const db = prismaFoundationDb(getPrismaClient(config.databaseUrl));
    const mounted = mountModuleMap(INSTALLED_MODULES, {
      db, access: new SqlFoundationRepository(db), authService: auth.service, navigation: foundation.navigationService, logger,
      secureCookie: config.nodeEnv === 'production',
    }, logger);
    for (const [key, router] of mounted) moduleRouters.set(key, router);
    apiRouters.push(...mounted.values());
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
      Promise.all([disconnectPrismaClient(), iamAdmin?.close(), provisioner?.close()]).then(
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
