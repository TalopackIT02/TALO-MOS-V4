// Contract values of AUTH-API-v1 (Phase B0 / SC5-V1 / B1.1). Durations are PostgreSQL interval literals because every
// security decision is taken on database time (F2-07b). Production code always uses DEFAULT_AUTH_SETTINGS; tests may
// inject shorter intervals in-process to exercise expiry branches without waiting (never through environment variables).

export interface AuthSettings {
  readonly maxAttempts: number; // AD-5 K1
  readonly lockInterval: string; // AD-5 K1
  readonly attemptDeadline: string; // SC5 H-b, D
  readonly activationTtl: string; // P-1
  readonly sessionTtl: string; // AD-4
  readonly idleTimeout: string; // AD-4
  readonly idleTimeoutMs: number; // same value, for idleExpiresAt = last_seen_at + idle
  readonly touchInterval: string; // last_seen_at written at most once per interval
  readonly secureCookie: boolean; // + Secure in production
}

export const DEFAULT_AUTH_SETTINGS: AuthSettings = Object.freeze({
  maxAttempts: 5,
  lockInterval: '15 minutes',
  attemptDeadline: '30 seconds',
  activationTtl: '15 minutes',
  sessionTtl: '10 hours',
  idleTimeout: '60 minutes',
  idleTimeoutMs: 60 * 60 * 1000,
  touchInterval: '1 minute',
  secureCookie: false,
});

export const ASSURANCE_ACTIVATION = 0;
export const ASSURANCE_AUTHENTICATED = 1;

// Password limits (AD-6 PW3 / P-4).
export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 128;
export const PASSWORD_MAX_BYTES = 512;
export const USERNAME_MAX_LENGTH = 80;
