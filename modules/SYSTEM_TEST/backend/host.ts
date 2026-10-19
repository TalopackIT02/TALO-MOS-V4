import type { Request, RequestHandler, Response } from 'express';

// MOD-TEST-02 — Host protocol TALO-MODULE-HOST-1, as seen by this module. Types only: the module imports nothing from
// the Host's source. The Host (Foundation) owns session validation, IAM evaluation + DENIED audit, module lifecycle,
// the read-only database executor, navigation, MIC inspection and regression results; the module only uses these
// capabilities. A Host that does not provide them (structurally, at build time, and by protocol name / capability
// list, at load time) cannot load the module.

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';

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

export type ModuleAccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

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
  // IAM: resolves when the permission is effective; otherwise the Host writes its DENIED audit and throws (403 / 503).
  authorize(actor: ModuleActor, permission: ModulePermission, actionCode: string, deniedTargetType: string): Promise<void>;
  // IAM decision without audit (diagnostics only).
  evaluate(actor: ModuleActor, permission: ModulePermission): Promise<ModuleAccessDecision>;
  // Lifecycle of a registered module: null when not registered.
  lifecycle(moduleKey: string): Promise<{ readonly isEnabled: boolean; readonly activeVersions: number } | null>;
  // READ ONLY transaction with a statement timeout, as the Host's API database role (no extra privilege).
  readOnly<R>(fn: (db: ReadOnlyQuery) => Promise<R>): Promise<R>;
  // Route paths of the actor's IAM-filtered Foundation menu.
  menuRoutes(actor: ModuleActor): Promise<string[]>;
  // MIC contract inspection by the Host's own validator: stored manifest vs its hash, and MIC schema validity.
  inspectManifest(manifest: unknown, manifestHash: string | null): { readonly intact: boolean; readonly micValid: boolean };
  // SQLSTATE of a database error (never the message).
  sqlstate(error: unknown): string | undefined;
  // Latest regression results written for this module by the Host's local runner: raw text, or null when none.
  regressionResults(): Promise<string | null>;
}

export const REQUIRED_CAPABILITIES = [
  'session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'menuRoutes', 'inspectManifest', 'sqlstate', 'regressionResults', 'logger',
] as const;
