import type { Router } from 'express';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import type { AuthService } from '../auth/auth.service.js';
import type { NavigationService } from '../foundation/foundation.navigation.service.js';
import { prismaFoundationDb, SqlFoundationRepository } from '../foundation/foundation.repository.js';
import { SYSTEM_TEST_BINDING } from './system-test.permissions.js';
import type { SystemTestBinding } from './system-test.permissions.js';
import { SqlSystemTestRepository } from './system-test.repository.js';
import type { SystemTestRepository } from './system-test.repository.js';
import { regressionResultsFile } from './system-test.results.js';
import { systemTestRouter } from './system-test.routes.js';
import { SystemTestService } from './system-test.service.js';

// MOD-TEST-01 — SYSTEM_TEST (System Test & Diagnostics) module: diagnostics, read-only Data Viewer and test results,
// mounted under /api/system-test. It reuses the Foundation session wrapper, AccessGuard, IAM facts and navigation
// service unchanged; it reads through the API role (talo_app) only.

export interface SystemTestModuleOptions {
  readonly prisma: PrismaClient;
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly navigation: Pick<NavigationService, 'menu'>;
  readonly logger: Logger;
  readonly secureCookie: boolean;
  // Test seams (in-process only).
  readonly binding?: SystemTestBinding;
  readonly repository?: SystemTestRepository;
  readonly resultsFile?: string;
}

export interface SystemTestModule {
  readonly router: Router;
  readonly service: SystemTestService;
}

export function createSystemTestModule(options: SystemTestModuleOptions): SystemTestModule {
  const db = prismaFoundationDb(options.prisma);
  const service = new SystemTestService({
    access: new SqlFoundationRepository(db),
    repository: options.repository ?? new SqlSystemTestRepository(db),
    navigation: options.navigation,
    logger: options.logger,
    binding: options.binding ?? SYSTEM_TEST_BINDING,
    resultsFile: options.resultsFile ?? regressionResultsFile(),
  });
  return { router: systemTestRouter({ authService: options.authService, service, secureCookie: options.secureCookie }), service };
}
