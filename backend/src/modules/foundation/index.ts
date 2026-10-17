import express from 'express';
import type { Router } from 'express';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CompatibilityEnvironment } from './foundation.compatibility.js';
import { SqlManifestRepository } from './foundation.manifest.repository.js';
import type { ManifestRepository } from './foundation.manifest.repository.js';
import { moduleManifestRouter } from './foundation.manifest.routes.js';
import { ModuleManifestService } from './foundation.manifest.service.js';
import { prismaFoundationDb, SqlFoundationRepository } from './foundation.repository.js';
import type { FoundationRepository } from './foundation.repository.js';
import { foundationRouter } from './foundation.routes.js';
import { FoundationService } from './foundation.service.js';
import { SqlModuleVersionRepository } from './foundation.versions.repository.js';
import type { ModuleVersionRepository } from './foundation.versions.repository.js';
import { moduleVersionRouter } from './foundation.versions.routes.js';
import { ModuleVersionService } from './foundation.versions.service.js';

export interface FoundationModuleOptions {
  readonly prisma: PrismaClient;
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly logger: Logger;
  readonly secureCookie: boolean;
  // FBE-04 (Q8): B13.environment, mapped from NODE_ENV by the caller.
  readonly environment: CompatibilityEnvironment;
  // Test seams (in-process only): replace the SQL repositories.
  readonly repository?: FoundationRepository;
  readonly versionRepository?: ModuleVersionRepository;
  readonly manifestRepository?: ManifestRepository;
}

export interface FoundationModule {
  readonly router: Router;
  readonly service: FoundationService;
  readonly versionService: ModuleVersionService;
  readonly manifestService: ModuleManifestService;
}

export function createFoundationModule(options: FoundationModuleOptions): FoundationModule {
  // One executor over the shared Prisma client (no connection is opened here).
  const db = prismaFoundationDb(options.prisma);
  const repository = options.repository ?? new SqlFoundationRepository(db);
  const versionRepository = options.versionRepository ?? new SqlModuleVersionRepository(db);
  const manifestRepository = options.manifestRepository ?? new SqlManifestRepository(db, options.environment);
  const service = new FoundationService({ repository, logger: options.logger });
  const versionService = new ModuleVersionService({ access: repository, versions: versionRepository, logger: options.logger });
  const manifestService = new ModuleManifestService({ access: repository, manifests: manifestRepository, logger: options.logger });
  const router = express.Router();
  router.use(foundationRouter({ authService: options.authService, service, secureCookie: options.secureCookie }));
  router.use(moduleVersionRouter({ authService: options.authService, service: versionService, secureCookie: options.secureCookie }));
  router.use(moduleManifestRouter({ authService: options.authService, service: manifestService, secureCookie: options.secureCookie }));
  return { router, service, versionService, manifestService };
}
