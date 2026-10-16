import type { Router } from 'express';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import type { AuthService } from '../auth/auth.service.js';
import { prismaFoundationDb, SqlFoundationRepository } from './foundation.repository.js';
import type { FoundationRepository } from './foundation.repository.js';
import { foundationRouter } from './foundation.routes.js';
import { FoundationService } from './foundation.service.js';

export interface FoundationModuleOptions {
  readonly prisma: PrismaClient;
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly logger: Logger;
  readonly secureCookie: boolean;
  // Test seam (in-process only): replaces the SQL repository.
  readonly repository?: FoundationRepository;
}

export interface FoundationModule {
  readonly router: Router;
  readonly service: FoundationService;
}

export function createFoundationModule(options: FoundationModuleOptions): FoundationModule {
  const repository = options.repository ?? new SqlFoundationRepository(prismaFoundationDb(options.prisma));
  const service = new FoundationService({ repository, logger: options.logger });
  const router = foundationRouter({ authService: options.authService, service, secureCookie: options.secureCookie });
  return { router, service };
}
