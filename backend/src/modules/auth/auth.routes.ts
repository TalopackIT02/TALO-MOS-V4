import express from 'express';
import type { Request, Response, Router } from 'express';
import { clientInfo } from './audit.js';
import { AuthError } from './auth.service.js';
import type { AuthService } from './auth.service.js';
import type { SlidingWindowRateLimiter } from './rateLimiter.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './sessionCookie.js';

// /api/auth/* (AUTH-API-v1.yaml). CSRF X1 (Origin allowlist + application/json), the 10 kB JSON limit, request ids,
// no-store and Helmet headers are applied by the /api stack in app.ts before these handlers run.

export interface AuthRouterDeps {
  readonly service: AuthService;
  readonly loginLimiter: SlidingWindowRateLimiter;
  readonly secureCookie: boolean;
}

function client(req: Request, res: Response) {
  return clientInfo(res.locals.requestId, req.ip, req.get('User-Agent'));
}

function sendAuthError(res: Response, error: AuthError, secureCookie: boolean): void {
  if (error.clearCookie) clearSessionCookie(res, secureCookie);
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      requestId: res.locals.requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

export function authRouter({ service, loginLimiter, secureCookie }: AuthRouterDeps): Router {
  const router = express.Router();

  // Wraps a handler: AuthError → contract envelope; anything else → global error handler (500 INTERNAL_ERROR).
  const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(res, error, secureCookie);
      throw error;
    }
  };

  router.post('/auth/login', handle(async (req, res) => {
    // P-7: counted per client IP before validation and before any Argon2 work.
    if (!loginLimiter.consume(req.ip ?? 'unknown')) throw new AuthError(429, 'RATE_LIMITED');
    const { token, body } = await service.login(req.body, client(req, res));
    setSessionCookie(res, token, secureCookie);
    res.status(200).json(body);
  }));

  router.post('/auth/password/first-change', handle(async (req, res) => {
    // Rate limit for this endpoint: threshold PENDING (P-7, AUTH-API-v1 §13.2) — not applied.
    await service.firstChange(readSessionToken(req), req.body, client(req, res));
    clearSessionCookie(res, secureCookie);
    res.status(200).json({ status: 'PASSWORD_CHANGED_RELOGIN' });
  }));

  router.get('/auth/session', handle(async (req, res) => {
    const body = await service.describeSession(readSessionToken(req), client(req, res));
    res.status(200).json(body);
  }));

  router.post('/auth/logout', handle(async (req, res) => {
    await service.logout(readSessionToken(req), client(req, res));
    clearSessionCookie(res, secureCookie);
    res.status(204).end();
  }));

  return router;
}

