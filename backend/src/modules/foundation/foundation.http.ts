import type { Request, Response } from 'express';
import { clientInfo } from '../auth/audit.js';
import { AUTH_MESSAGES } from '../auth/auth.messages.js';
import { AuthError } from '../auth/auth.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { clearSessionCookie, readSessionToken } from '../auth/sessionCookie.js';
import type { Actor } from './foundation.access.js';
import { FoundationError } from './foundation.errors.js';

// Shared request wrapper of every Foundation router (extracted unchanged from the FBE-01A router). The session is
// validated only by AuthService.describeSession() — the same validator as GET /api/auth/session (no second validator).
//   AuthError → auth envelope (401 clears the cookie); activation session → 403 PASSWORD_CHANGE_REQUIRED (no audit);
//   FoundationError → its envelope; anything else → global error handler (500).

export interface SessionHandlerDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly secureCookie: boolean;
}

export type FoundationHandler = (req: Request, res: Response, actor: Actor) => Promise<void>;

function sendAuthError(res: Response, error: AuthError, secureCookie: boolean): void {
  if (error.clearCookie) clearSessionCookie(res, secureCookie);
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId } });
}

function sendFoundationError(res: Response, error: FoundationError): void {
  res.status(error.status).json({
    error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.details ? { details: error.details } : {}) },
  });
}

export function sessionHandler({ authService, secureCookie }: SessionHandlerDeps) {
  return (fn: FoundationHandler) => async (req: Request, res: Response) => {
    try {
      const session = await authService.describeSession(readSessionToken(req), clientInfo(res.locals.requestId, req.ip, req.get('User-Agent')));
      if (session.status !== 'AUTHENTICATED') {
        // Activation session: only first-change is allowed (no Foundation audit).
        res.status(403).json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: AUTH_MESSAGES.PASSWORD_CHANGE_REQUIRED, requestId: res.locals.requestId } });
        return;
      }
      await fn(req, res, { userAccountId: session.account.userAccountId, assuranceLevel: session.assuranceLevel, requestId: res.locals.requestId });
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(res, error, secureCookie);
      if (error instanceof FoundationError) return sendFoundationError(res, error);
      throw error;
    }
  };
}
