import type { Request, RequestHandler, Response } from 'express';

// DATA_INSPECTOR — Host protocol TALO-MODULE-HOST-1, as seen by this module. Types only: the module imports nothing from
// the Host's source. The Host (Foundation / Auth) owns session validation, IAM evaluation + DENIED audit, the module
// lifecycle state and the READ ONLY database executor; the module only uses these five capabilities. A Host that does
// not provide them (structurally at build time, by protocol name / capability list at load time) cannot load it.

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';

// Host session actor: no username here — the account's username is looked up on the server (data-inspector.admin.ts).
export interface ModuleActor {
  readonly userAccountId: string;
  readonly assuranceLevel: number;
  readonly requestId: string;
}

// K05 permission reference (permissionCode + moduleCode / resourceCode / operation).
export interface ModulePermission {
  readonly permissionCode: string;
  readonly moduleCode: string;
  readonly resourceCode: string;
  readonly operation: string;
}

export interface ModuleLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ReadOnlyQuery {
  query(sql: string, params: readonly unknown[]): Promise<unknown[]>;
}

export interface ModuleHost {
  readonly protocol: typeof HOST_PROTOCOL;
  readonly moduleKey: string;
  readonly logger: ModuleLogger;
  // Session: the Host validates the session (401 / 403 PASSWORD_CHANGE_REQUIRED) and renders its own errors, including
  // those thrown by `authorize`.
  session(handler: (req: Request, res: Response, actor: ModuleActor) => Promise<void>): RequestHandler;
  // IAM: resolves when the permission is effective (Direct DENY first); otherwise the Host writes its DENIED audit and
  // throws (403 / 503).
  authorize(actor: ModuleActor, permission: ModulePermission, actionCode: string, deniedTargetType: string): Promise<void>;
  // Lifecycle of a registered module: null when not registered.
  lifecycle(moduleKey: string): Promise<{ readonly isEnabled: boolean; readonly activeVersions: number } | null>;
  // READ ONLY transaction with a statement timeout, as the Host's API database role (no extra privilege).
  readOnly<R>(fn: (db: ReadOnlyQuery) => Promise<R>): Promise<R>;
}

export const REQUIRED_CAPABILITIES = ['session', 'authorize', 'lifecycle', 'readOnly', 'logger'] as const;
