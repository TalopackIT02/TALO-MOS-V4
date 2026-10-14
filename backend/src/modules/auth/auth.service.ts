import type { Logger } from '../../core/logging/logger.js';
import { auditMetadata } from './audit.js';
import type { AuditAction, AuditEntry, AuditOutcome, ClientInfo } from './audit.js';
import { AUTH_MESSAGES } from './auth.messages.js';
import { deniedReason } from './auth.repository.js';
import type {
  AuthRepository, FirstChangeAuditKind, FirstChangeTxResult, LoginAuditKind, LoginTxResult, SessionRow, TxHooks,
} from './auth.repository.js';
import type { AuthSettings } from './auth.settings.js';
import { ASSURANCE_ACTIVATION, USERNAME_MAX_LENGTH } from './auth.settings.js';
import { HashQueueBusyError } from './passwordHasher.js';
import type { PasswordHasher } from './passwordHasher.js';
import { checkContext, checkPasswordShape, isAcceptableLoginPassword, normalizePassword } from './passwordPolicy.js';
import { BlocklistUnavailableError } from './pwnedPasswords.js';
import type { BreachedPasswordChecker } from './pwnedPasswords.js';
import type { PolicyDetails } from './passwordPolicy.js';
import { hashSessionToken, newSessionToken } from './sessionCookie.js';
import { isRetryable, sqlstateOf } from './sqlstate.js';

// Authentication flows of AUTH-API-v1 (§4 login, §5 first-change, §6 session, §7 logout).

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: PolicyDetails | undefined;
  readonly clearCookie: boolean;

  constructor(status: number, code: keyof typeof AUTH_MESSAGES, options: { details?: PolicyDetails; clearCookie?: boolean } = {}) {
    super(AUTH_MESSAGES[code]);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.clearCookie = options.clearCookie ?? false;
  }
}

const invalidCredentials = () => new AuthError(401, 'INVALID_CREDENTIALS');
const sessionInvalid = () => new AuthError(401, 'SESSION_INVALID', { clearCookie: true });
const serviceBusy = () => new AuthError(503, 'SERVICE_BUSY');
const validationError = () => new AuthError(400, 'VALIDATION_ERROR');

export interface AuthTestHooks {
  readonly loginTx?: (attempt: number) => TxHooks | undefined;
  readonly firstChangeTx?: (attempt: number) => TxHooks | undefined;
}

export interface AccountSummary {
  readonly userAccountId: string;
  readonly username: string;
  readonly fullName: string;
}

export type LoginBody =
  | { status: 'AUTHENTICATED'; account: AccountSummary; assuranceLevel: 1; expiresAt: string; serverTime: string }
  | { status: 'PASSWORD_CHANGE_REQUIRED'; account: { username: string }; expiresAt: string; serverTime: string };

export type SessionBody =
  | { status: 'AUTHENTICATED'; account: AccountSummary; assuranceLevel: 1; expiresAt: string; idleExpiresAt: string; serverTime: string }
  | { status: 'PASSWORD_CHANGE_REQUIRED'; account: { username: string }; expiresAt: string; serverTime: string };

interface ValidSession {
  readonly row: SessionRow;
  readonly activation: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// LoginRequest: exactly { username, password }, strings; unknown properties rejected (AUTH-API-v1.yaml).
function parseLogin(body: unknown): { username: string; password: string } {
  if (!isPlainObject(body)) throw validationError();
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('username') || !keys.includes('password')) throw validationError();
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string') throw validationError();
  const trimmed = username.trim();
  if (trimmed.length < 1 || trimmed.length > USERNAME_MAX_LENGTH) throw validationError();
  const normalized = normalizePassword(password);
  if (!isAcceptableLoginPassword(normalized)) throw validationError();
  return { username: trimmed, password: normalized };
}

function parseFirstChange(body: unknown): string {
  if (!isPlainObject(body)) throw validationError();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'newPassword' || typeof body.newPassword !== 'string') throw validationError();
  return normalizePassword(body.newPassword);
}

export interface AuthServiceDeps {
  readonly repository: AuthRepository;
  readonly hasher: PasswordHasher;
  readonly settings: AuthSettings;
  readonly logger: Logger;
  readonly breachedPasswords: BreachedPasswordChecker;
  readonly hooks?: AuthTestHooks;
}

export class AuthService {
  private readonly repo: AuthRepository;
  private readonly hasher: PasswordHasher;
  private readonly settings: AuthSettings;
  private readonly logger: Logger;
  private readonly breached: BreachedPasswordChecker;
  private readonly hooks: AuthTestHooks;

  constructor(deps: AuthServiceDeps) {
    this.breached = deps.breachedPasswords;
    this.repo = deps.repository;
    this.hasher = deps.hasher;
    this.settings = deps.settings;
    this.logger = deps.logger;
    this.hooks = deps.hooks ?? {};
  }

  // ---------------- login (§4) ----------------

  async login(body: unknown, client: ClientInfo): Promise<{ token: string; body: LoginBody }> {
    const input = parseLogin(body);
    const found = await this.repo.lookup(input.username);
    const accountId = found?.hasCredential ? found.userAccountId : null;
    // RESERVE always runs; for an unknown username / no credential it is the same statement on a nil id (IB-1).
    const reservation = await this.repo.reserve(accountId, this.settings);
    // Exactly one Argon2id verification per request: real hash when a slot was granted, otherwise the dummy hash.
    const match = await this.verify(reservation?.passwordHash ?? null, input.password);

    if (!match || !reservation || accountId === null) {
      const targetId = found?.userAccountId ?? null;
      const [outcome, reason]: [AuditOutcome, string] =
        !found ? ['FAILURE', 'UNKNOWN_USERNAME']
          : !found.hasCredential ? ['FAILURE', 'NO_CREDENTIAL']
            : !reservation ? ['DENIED', 'TEMP_LOCKED']
              : reservation.slot >= this.settings.maxAttempts ? ['FAILURE', 'LOCK_TRIGGERED']
                : ['FAILURE', 'BAD_PASSWORD'];
      await this.repo.insertAudit(this.entry('LOGIN', outcome, client, reason, {
        targetType: 'USER_ACCOUNT', targetId, ...(reservation ? { slot: reservation.slot } : {}),
      }));
      throw invalidCredentials();
    }

    const token = newSessionToken();
    const result = await this.loginTransaction(accountId, reservation.reservedAt, client, (attemptHooks) =>
      this.repo.loginSuccess({
        userAccountId: accountId,
        reservation,
        tokenHash: hashSessionToken(token),
        audit: (kind, extra) => this.loginAudit(kind, accountId, reservation.slot, client, extra),
      }, this.settings, attemptHooks));

    switch (result.kind) {
      case 'CREDENTIAL_CHANGED':
      case 'ATTEMPT_EXPIRED':
      case 'TEMP_LOCKED':
        throw invalidCredentials();
      case 'DENIED':
        throw new AuthError(403, 'ACCOUNT_NOT_ALLOWED');
      case 'SESSION': {
        const e = result.eligibility;
        const body: LoginBody = result.activation
          ? { status: 'PASSWORD_CHANGE_REQUIRED', account: { username: e.username }, expiresAt: result.expiresAt.toISOString(), serverTime: result.serverTime.toISOString() }
          : {
              status: 'AUTHENTICATED',
              account: { userAccountId: accountId, username: e.username, fullName: e.fullName },
              assuranceLevel: 1,
              expiresAt: result.expiresAt.toISOString(),
              serverTime: result.serverTime.toISOString(),
            };
        return { token, body };
      }
    }
  }

  private async loginTransaction(
    accountId: string, reservedAt: string, client: ClientInfo,
    run: (hooks: TxHooks | undefined) => Promise<LoginTxResult>,
  ): Promise<LoginTxResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(this.hooks.loginTx?.(attempt));
      } catch (error) {
        if (!isRetryable(error)) throw error;
        // One retry, only while still inside D (§9); never a second reservation or a second Argon2 verification.
        if (attempt === 0 && await this.repo.withinDeadline(reservedAt, this.settings).catch(() => false)) continue;
        await this.auditTransient('LOGIN', accountId, null, null, client, error);
        throw serviceBusy();
      }
    }
  }

  private loginAudit(kind: LoginAuditKind, accountId: string, slot: number, client: ClientInfo,
    extra: { sessionId?: string; membershipId?: string }): AuditEntry {
    const success = kind === 'OK' || kind === 'PASSWORD_CHANGE_REQUIRED';
    const outcome: AuditOutcome = success ? 'SUCCESS'
      : kind === 'CREDENTIAL_CHANGED' || kind === 'ATTEMPT_EXPIRED' ? 'FAILURE' : 'DENIED';
    return {
      action: 'LOGIN', outcome, targetType: 'USER_ACCOUNT', targetId: accountId,
      actorAccountId: success ? accountId : null,
      membershipId: extra.membershipId ?? null,
      sessionId: extra.sessionId ?? null,
      metadata: auditMetadata(client, kind, { slot }),
    };
  }

  // ---------------- session validation (§3.3) ----------------

  private async validate(token: string | undefined, client: ClientInfo): Promise<ValidSession> {
    if (token === undefined) throw sessionInvalid();
    const row = await this.repo.findSession(hashSessionToken(token), this.settings);
    if (!row || row.revoked) throw sessionInvalid();
    const activation = row.mustChangePassword;
    let reason: string | null = null;
    if (row.expired) reason = activation ? 'ACTIVATION_EXPIRED' : 'SESSION_EXPIRED';
    else if (activation && row.olderThanActivation) reason = 'ACTIVATION_EXPIRED';
    else if (!activation && row.idle) reason = 'SESSION_IDLE';
    else if (deniedReason(row.eligibility, activation)) reason = 'ELIGIBILITY_LOST';
    else if (activation && row.liveSessions > 1) reason = 'ACTIVATION_INVARIANT_VIOLATION'; // AS-1: fail closed
    else if (!activation && row.assuranceLevel === ASSURANCE_ACTIVATION) reason = 'ACTIVATION_INVARIANT_VIOLATION';
    if (reason !== null) {
      // Lazy revocation; audited once (only the request that actually revoked it).
      if (await this.repo.revokeSession(row.sessionId)) {
        await this.repo.insertAudit(this.entry('SESSION_INVALIDATED', 'DENIED', client, reason, {
          targetType: 'SESSION', targetId: row.sessionId, actorAccountId: row.userAccountId,
          membershipId: row.membershipId, sessionId: row.sessionId,
        }));
      }
      throw sessionInvalid();
    }
    return { row, activation };
  }

  // ---------------- GET /session (§6) ----------------

  async describeSession(token: string | undefined, client: ClientInfo): Promise<SessionBody> {
    const { row, activation } = await this.validate(token, client);
    if (activation) {
      // Never extends an Activation Session.
      return { status: 'PASSWORD_CHANGE_REQUIRED', account: { username: row.username }, expiresAt: row.expiresAt.toISOString(), serverTime: row.serverTime.toISOString() };
    }
    const touched = await this.repo.touchSession(row.sessionId, this.settings);
    const lastSeen = touched ?? row.lastSeenAt ?? row.serverTime;
    return {
      status: 'AUTHENTICATED',
      account: { userAccountId: row.userAccountId, username: row.username, fullName: row.fullName },
      assuranceLevel: 1,
      expiresAt: row.expiresAt.toISOString(),
      idleExpiresAt: new Date(lastSeen.getTime() + this.settings.idleTimeoutMs).toISOString(),
      serverTime: row.serverTime.toISOString(),
    };
  }

  // ---------------- first-change (§5) ----------------

  async firstChange(token: string | undefined, body: unknown, client: ClientInfo): Promise<void> {
    const { row, activation } = await this.validate(token, client);
    if (!activation) throw new AuthError(403, 'NOT_REQUIRED');
    const newPassword = parseFirstChange(body);
    const accountId = row.userAccountId;
    const context = await this.repo.readPasswordContext(accountId);
    if (!context) throw sessionInvalid();

    const policyFailure = async (details: PolicyDetails): Promise<never> => {
      await this.repo.insertAudit(this.changeAudit('FAILURE', 'POLICY_VIOLATION', accountId, row, client, details.reason));
      throw new AuthError(400, 'PASSWORD_POLICY', { details });
    };
    const shape = checkPasswordShape(newPassword);
    if (shape) await policyFailure(shape);
    if (await this.isBreached(newPassword)) await policyFailure({ reason: 'BLOCKLISTED' });
    const contextual = checkContext(newPassword, context);
    if (contextual) await policyFailure(contextual);
    // SAME_AS_CURRENT: Argon2id verify of the NFC new password against the current hash; no plaintext kept.
    if (await this.verify(context.passwordHash, newPassword)) await policyFailure({ reason: 'SAME_AS_CURRENT' });
    const newHash = await this.hash(newPassword);

    let result: FirstChangeTxResult | undefined;
    for (let attempt = 0; result === undefined; attempt++) {
      try {
        result = await this.repo.firstChange({
          userAccountId: accountId,
          sessionId: row.sessionId,
          expectedHash: context.passwordHash,
          newHash,
          audit: (kind, membershipId) => this.firstChangeAudit(kind, accountId, membershipId, row.sessionId, client),
        }, this.settings, this.hooks.firstChangeTx?.(attempt));
      } catch (error) {
        if (!isRetryable(error)) throw error;
        if (attempt === 0) continue; // the transaction re-checks that the Activation Session is still valid
        await this.auditTransient('CHANGE_PASSWORD', accountId, row.membershipId, row.sessionId, client, error);
        throw serviceBusy();
      }
    }

    switch (result.kind) {
      case 'CHANGED':
        return;
      case 'SESSION_GONE':
        await this.repo.insertAudit(this.changeAudit('DENIED', 'SESSION_INVALID', accountId, row, client));
        throw sessionInvalid();
      case 'CONCURRENT_CHANGE':
      case 'DENIED':
        throw sessionInvalid(); // audited inside the transaction
    }
  }

  private changeAudit(outcome: AuditOutcome, reason: string, accountId: string, row: SessionRow, client: ClientInfo, policy?: string): AuditEntry {
    return {
      action: 'CHANGE_PASSWORD', outcome, targetType: 'USER_ACCOUNT', targetId: accountId, actorAccountId: accountId,
      membershipId: row.membershipId, sessionId: row.sessionId,
      metadata: auditMetadata(client, reason, policy !== undefined ? { policy } : {}),
    };
  }

  private firstChangeAudit(kind: FirstChangeAuditKind, accountId: string, membershipId: string, sessionId: string, client: ClientInfo): AuditEntry {
    const base = { targetType: 'USER_ACCOUNT' as const, targetId: accountId, actorAccountId: accountId, membershipId, sessionId };
    switch (kind) {
      case 'OK':
        return { ...base, action: 'CHANGE_PASSWORD', outcome: 'SUCCESS', metadata: auditMetadata(client, 'OK') };
      case 'ACTIVATED':
        return { ...base, action: 'ACCOUNT_ACTIVATED', outcome: 'SUCCESS', metadata: auditMetadata(client, 'OK') };
      case 'CONCURRENT_CHANGE':
        return { ...base, action: 'CHANGE_PASSWORD', outcome: 'DENIED', metadata: auditMetadata(client, 'CONCURRENT_CHANGE') };
      case 'ACCOUNT_NOT_ALLOWED':
        return { ...base, action: 'CHANGE_PASSWORD', outcome: 'DENIED', metadata: auditMetadata(client, 'ACCOUNT_NOT_ALLOWED') };
    }
  }

  // ---------------- logout (§7) ----------------

  async logout(token: string | undefined, client: ClientInfo): Promise<void> {
    if (token === undefined) return;
    const revoked = await this.repo.revokeLiveSessionByToken(hashSessionToken(token));
    if (!revoked) return;
    await this.repo.insertAudit(this.entry('LOGOUT', 'SUCCESS', client, 'OK', {
      targetType: 'SESSION', targetId: revoked.sessionId, actorAccountId: revoked.userAccountId,
      membershipId: revoked.membershipId, sessionId: revoked.sessionId,
    }));
  }

  // ---------------- helpers ----------------

  private async verify(stored: string | null, password: string): Promise<boolean> {
    try {
      return await this.hasher.verifyPassword(stored, password);
    } catch (error) {
      if (error instanceof HashQueueBusyError) throw serviceBusy();
      throw error;
    }
  }

  // Offline Pwned Passwords lookup. Fail closed: without a usable dataset no new password is accepted (503).
  private async isBreached(password: string): Promise<boolean> {
    try {
      return await this.breached.isBreached(password);
    } catch (error) {
      this.logger.error('password blocklist unavailable', { reason: error instanceof BlocklistUnavailableError ? error.message : 'lookup error' });
      throw serviceBusy();
    }
  }

  private async hash(password: string): Promise<string> {
    try {
      return await this.hasher.hashPassword(password);
    } catch (error) {
      if (error instanceof HashQueueBusyError) throw serviceBusy();
      throw error;
    }
  }

  // Decided fallback (B1.2/B1.3 acceptance): one INSERT after rollback, no retry; if it fails, one minimal structured
  // log line — requestId, action, reason, SQLSTATE — and the response stays 503. No SQL text or driver message.
  private async auditTransient(action: AuditAction, accountId: string, membershipId: string | null, sessionId: string | null,
    client: ClientInfo, cause: unknown): Promise<void> {
    try {
      await this.repo.insertAudit(this.entry(action, 'FAILURE', client, 'TRANSIENT_DB_ERROR', {
        targetType: 'USER_ACCOUNT', targetId: accountId, actorAccountId: action === 'LOGIN' ? null : accountId, membershipId, sessionId,
      }));
    } catch (auditError) {
      this.logger.warn('audit insert failed', {
        requestId: client.requestId, action, reason: 'TRANSIENT_DB_ERROR',
        sqlstate: sqlstateOf(auditError) ?? sqlstateOf(cause) ?? null,
      });
    }
  }

  private entry(action: AuditAction, outcome: AuditOutcome, client: ClientInfo, reason: string, fields: {
    targetType: 'USER_ACCOUNT' | 'SESSION'; targetId: string | null; actorAccountId?: string | null;
    membershipId?: string | null; sessionId?: string | null; slot?: number;
  }): AuditEntry {
    return {
      action, outcome, targetType: fields.targetType, targetId: fields.targetId,
      actorAccountId: fields.actorAccountId ?? null, membershipId: fields.membershipId ?? null, sessionId: fields.sessionId ?? null,
      metadata: auditMetadata(client, reason, fields.slot !== undefined ? { slot: fields.slot } : {}),
    };
  }
}
