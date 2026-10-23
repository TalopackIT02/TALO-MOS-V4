import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Router } from 'express';
import { moduleInstallerRouter } from './foundation.installer.routes.js';
import { ModuleInstallerService } from './foundation.installer.service.js';
import type { IamCatalog, InstallerRuntime } from './foundation.installer.service.js';
import { InstallerStore } from './foundation.installer.store.js';
import type { Exec, PreflightEnvironment, PreflightPaths } from './foundation.preflight.js';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CompatibilityEnvironment } from './foundation.compatibility.js';
import { SqlLifecycleRepository } from './foundation.lifecycle.repository.js';
import type { LifecycleRepository } from './foundation.lifecycle.repository.js';
import { moduleLifecycleRouter } from './foundation.lifecycle.routes.js';
import { ModuleLifecycleService } from './foundation.lifecycle.service.js';
import { SqlNavigationRepository } from './foundation.navigation.repository.js';
import type { NavigationRepository } from './foundation.navigation.repository.js';
import { navigationRouter } from './foundation.navigation.routes.js';
import { NavigationService } from './foundation.navigation.service.js';
import { SqlManifestRepository } from './foundation.manifest.repository.js';
import type { ManifestRepository } from './foundation.manifest.repository.js';
import { moduleManifestRouter } from './foundation.manifest.routes.js';
import { ModuleManifestService } from './foundation.manifest.service.js';
import { moduleScanRouter } from './foundation.module-scan.routes.js';
import { ModuleScanService, SqlModuleScanRegistry } from './foundation.module-scan.service.js';
import type { ModuleScanRegistry } from './foundation.module-scan.types.js';
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
  readonly lifecycleRepository?: LifecycleRepository;
  readonly navigationRepository?: NavigationRepository;
  readonly moduleScanRegistry?: ModuleScanRegistry;
  readonly moduleScanRoot?: string;
  // FMI-02 / FMI-03: Candidate Workspace, Preflight and Installer — mounted only when the server provides it.
  readonly installer?: InstallerOptions;
}

export interface InstallerOptions {
  readonly runtime: InstallerRuntime;
  readonly iam: IamCatalog | null;
  readonly environment: PreflightEnvironment;
  readonly allowedDatabase?: string;
  readonly paths?: Partial<PreflightPaths>;
  readonly storeRoot?: string;
  readonly exec?: Exec;
  readonly now?: () => number;
  readonly planTtlMs?: number;
}

// <repo>/backend from this file (src/… and dist/… have the same depth).
const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export function defaultInstallerPaths(): PreflightPaths {
  return {
    backendDir: BACKEND_DIR, frontendDir: resolve(BACKEND_DIR, '../frontend'), modulesRoot: resolve(BACKEND_DIR, '../modules'),
    releasesDir: resolve(BACKEND_DIR, 'module-releases'), lockFile: resolve(BACKEND_DIR, 'module-deployments.json'),
  };
}

export interface FoundationModule {
  readonly router: Router;
  readonly service: FoundationService;
  readonly versionService: ModuleVersionService;
  readonly manifestService: ModuleManifestService;
  readonly lifecycleService: ModuleLifecycleService;
  readonly navigationService: NavigationService;
  readonly moduleScanService: ModuleScanService;
  readonly installerService: ModuleInstallerService | null;
}

export function createFoundationModule(options: FoundationModuleOptions): FoundationModule {
  // One executor over the shared Prisma client (no connection is opened here).
  const db = prismaFoundationDb(options.prisma);
  const repository = options.repository ?? new SqlFoundationRepository(db);
  const versionRepository = options.versionRepository ?? new SqlModuleVersionRepository(db);
  const manifestRepository = options.manifestRepository ?? new SqlManifestRepository(db, options.environment);
  const lifecycleRepository = options.lifecycleRepository ?? new SqlLifecycleRepository(db);
  const service = new FoundationService({ repository, logger: options.logger });
  const versionService = new ModuleVersionService({ access: repository, versions: versionRepository, logger: options.logger });
  const manifestService = new ModuleManifestService({ access: repository, manifests: manifestRepository, logger: options.logger });
  // FBE-05: lifecycle (APPROVE / REJECT / ACTIVATE / RETIRE, ENABLE / DISABLE).
  const lifecycleService = new ModuleLifecycleService({ access: repository, lifecycle: lifecycleRepository, logger: options.logger });
  // FBE-06: navigation (B09 management, permission-filtered menu).
  const navigationService = new NavigationService({
    access: repository, navigation: options.navigationRepository ?? new SqlNavigationRepository(db), logger: options.logger,
  });
  // FMI-01: Manual Module Scan (read-only preview of modules/, triggered only by the user).
  const moduleScanService = new ModuleScanService({
    access: repository, registry: options.moduleScanRegistry ?? new SqlModuleScanRegistry(db), logger: options.logger,
    ...(options.moduleScanRoot ? { modulesRoot: options.moduleScanRoot } : {}),
  });
  const router = express.Router();
  router.use(foundationRouter({ authService: options.authService, service, secureCookie: options.secureCookie }));
  router.use(moduleVersionRouter({ authService: options.authService, service: versionService, secureCookie: options.secureCookie }));
  router.use(moduleManifestRouter({ authService: options.authService, service: manifestService, secureCookie: options.secureCookie }));
  router.use(moduleLifecycleRouter({ authService: options.authService, service: lifecycleService, secureCookie: options.secureCookie }));
  router.use(navigationRouter({ authService: options.authService, service: navigationService, secureCookie: options.secureCookie }));
  router.use(moduleScanRouter({ authService: options.authService, service: moduleScanService, secureCookie: options.secureCookie }));
  let installerService: ModuleInstallerService | null = null;
  if (options.installer) {
    const i = options.installer;
    const paths = { ...defaultInstallerPaths(), ...(options.moduleScanRoot ? { modulesRoot: options.moduleScanRoot } : {}), ...i.paths };
    installerService = new ModuleInstallerService({
      access: repository, db, registry: options.moduleScanRegistry ?? new SqlModuleScanRegistry(db), scans: moduleScanService, modules: service,
      versions: versionService, manifests: manifestService, lifecycle: lifecycleService, navigation: navigationService, iam: i.iam, runtime: i.runtime,
      paths, store: new InstallerStore(i.storeRoot), environment: i.environment, allowedDatabase: i.allowedDatabase ?? 'talo_mos_v4_test', logger: options.logger,
      ...(i.exec ? { exec: i.exec } : {}), ...(i.now ? { now: i.now } : {}), ...(i.planTtlMs ? { planTtlMs: i.planTtlMs } : {}),
    });
    router.use(moduleInstallerRouter({ authService: options.authService, service: installerService, secureCookie: options.secureCookie }));
  }
  return { router, service, versionService, manifestService, lifecycleService, navigationService, moduleScanService, installerService };
}
