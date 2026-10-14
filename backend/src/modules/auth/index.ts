import type { Router } from 'express';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import { PrismaAuthRepository } from './auth.repository.js';
import type { AuthRepository } from './auth.repository.js';
import { authRouter } from './auth.routes.js';
import { AuthService } from './auth.service.js';
import type { AuthTestHooks } from './auth.service.js';
import { DEFAULT_AUTH_SETTINGS } from './auth.settings.js';
import type { AuthSettings } from './auth.settings.js';
import { PasswordHasher } from './passwordHasher.js';
import { LOGIN_RATE_LIMIT, SlidingWindowRateLimiter } from './rateLimiter.js';

export interface AuthModuleOptions {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  readonly production: boolean;
  // Test seams (in-process only): repository wrapper, shorter intervals, hasher/limiter instances, fault hooks.
  readonly wrapRepository?: (repository: AuthRepository) => AuthRepository;
  readonly settings?: Partial<AuthSettings>;
  readonly hasher?: PasswordHasher;
  readonly loginLimiter?: SlidingWindowRateLimiter;
  readonly hooks?: AuthTestHooks;
}

export interface AuthModule {
  readonly router: Router;
  readonly service: AuthService;
  readonly hasher: PasswordHasher;
}

export async function createAuthModule(options: AuthModuleOptions): Promise<AuthModule> {
  const settings: AuthSettings = { ...DEFAULT_AUTH_SETTINGS, secureCookie: options.production, ...options.settings };
  const hasher = options.hasher ?? new PasswordHasher();
  await hasher.init();
  const base = new PrismaAuthRepository(options.prisma);
  const repository = options.wrapRepository ? options.wrapRepository(base) : base;
  const service = new AuthService({ repository, hasher, settings, logger: options.logger, ...(options.hooks ? { hooks: options.hooks } : {}) });
  const router = authRouter({
    service,
    loginLimiter: options.loginLimiter ?? new SlidingWindowRateLimiter(LOGIN_RATE_LIMIT),
    secureCookie: settings.secureCookie,
  });
  return { router, service, hasher };
}
