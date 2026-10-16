import express from 'express';
import type { Request, Response, Router } from 'express';
import { clientInfo } from '../auth/audit.js';
import { AUTH_MESSAGES } from '../auth/auth.messages.js';
import { AuthError } from '../auth/auth.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { clearSessionCookie, readSessionToken } from '../auth/sessionCookie.js';
import { FoundationError } from './foundation.errors.js';
import type { ModuleRecord } from './foundation.repository.js';
import type { Actor, FoundationService } from './foundation.service.js';

// /api/foundation/modules (FBE-01A). The session is validated only by AuthService.describeSession() — the same
// validator as GET /api/auth/session (no second validator). CSRF X1, JSON limit, request id and no-store come from the
// /api stack in app.ts.

export interface FoundationRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: FoundationService;
  readonly secureCookie: boolean;
}

function sendAuthError(res: Response, error: AuthError, secureCookie: boolean): void {
  if (error.clearCookie) clearSessionCookie(res, secureCookie);
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId } });
}

function sendFoundationError(res: Response, error: FoundationError): void {
  res.status(error.status).json({
    error: { code: error.code, message: error.message, requestId: res.locals.requestId, ...(error.details ? { details: error.details } : {}) },
  });
}

function moduleBody(m: ModuleRecord) {
  return {
    moduleId: m.moduleId, moduleKey: m.moduleKey, moduleName: m.moduleName, description: m.description, moduleType: m.moduleType,
    isEnabled: m.isEnabled, createdAt: m.createdAt, updatedAt: m.updatedAt, createdByAccountId: m.createdByAccountId,
  };
}

export function foundationRouter({ authService, service, secureCookie }: FoundationRouterDeps): Router {
  const router = express.Router();

  // AuthError → auth envelope (401 clears the cookie); FoundationError → its envelope; anything else → 500 handler.
  const handle = (fn: (req: Request, res: Response, actor: Actor) => Promise<void>) => async (req: Request, res: Response) => {
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

  router.get('/foundation/modules', handle(async (_req, res, actor) => {
    const modules = await service.listModules(actor);
    res.status(200).json({ modules: modules.map(moduleBody) });
  }));

  router.post('/foundation/modules', handle(async (req, res, actor) => {
    const module = await service.registerModule(actor, req.body);
    res.status(201).json({ module: moduleBody(module) });
  }));

  return router;
}
