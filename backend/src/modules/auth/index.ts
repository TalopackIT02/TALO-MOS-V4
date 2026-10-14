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
import { openCompactDataset } from './pwnedCompact.js';
import { PwnedPasswordsStore, UnavailableBlocklist } from './pwnedPasswords.js';
import type { BreachedPasswordChecker } from './pwnedPasswords.js';

export interface AuthModuleOptions {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  readonly production: boolean;
  // Offline Pwned Passwords dataset directory (PWNED_PASSWORDS_DIR). Production: required and must open, else startup
  // fails. Elsewhere: when missing or invalid, first-change fails closed (503) and an error is logged.
  readonly pwnedPasswordsDir?: string | undefined;
  readonly pwnedPasswordsFormat?: 'text' | 'compact';
  readonly breachedPasswords?: BreachedPasswordChecker;
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
  const breachedPasswords = options.breachedPasswords ?? await openBlocklist(options);
  const service = new AuthService({ repository, hasher, settings, logger: options.logger, breachedPasswords, ...(options.hooks ? { hooks: options.hooks } : {}) });
  const router = authRouter({
    service,
    loginLimiter: options.loginLimiter ?? new SlidingWindowRateLimiter(LOGIN_RATE_LIMIT),
    secureCookie: settings.secureCookie,
  });
  return { router, service, hasher };
}

async function openBlocklist(options: AuthModuleOptions): Promise<BreachedPasswordChecker> {
  const dir = options.pwnedPasswordsDir;
  if (dir === undefined) {
    if (options.production) throw new Error('PWNED_PASSWORDS_DIR is required in production');
    options.logger.warn('PWNED_PASSWORDS_DIR not set: first-change is refused (blocklist unavailable, fail closed)');
    return new UnavailableBlocklist('PWNED_PASSWORDS_DIR not set');
  }
  const format = options.pwnedPasswordsFormat ?? 'text';
  try {
    if (format === 'compact') {
      // No fallback to the text store: a missing or inconsistent compact dataset fails closed.
      const { store, pointer } = await openCompactDataset(dir, { production: options.production });
      options.logger.info('password blocklist ready', { format, file: pointer.file, entries: pointer.entries, activated: pointer.activatedAt, partial: pointer.partial });
      return store;
    }
    const store = await PwnedPasswordsStore.open(dir, { production: options.production });
    options.logger.info('password blocklist ready', { format, prefixes: store.manifest.prefixCount, created: store.manifest.createdAt, partial: store.manifest.partial === true });
    return store;
  } catch (error) {
    if (options.production) throw error;
    const reason = error instanceof Error ? error.message : 'open failed';
    options.logger.error('password blocklist unavailable: first-change is refused (fail closed)', { reason });
    return new UnavailableBlocklist(reason);
  }
}
