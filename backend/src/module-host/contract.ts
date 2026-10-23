import type { Request, RequestHandler, Response, Router } from 'express';

// MOD-TEST-02 — Host protocol TALO-MODULE-HOST-1, Host side. A module package declares the same protocol with its own
// types; the generated registry (installed-modules/registry.ts) is type-checked against InstalledModule, so a package
// whose entry does not accept these capabilities fails the build (compile-time handshake). At load time the Host also
// checks the protocol name and the required capability list (runtime handshake, loader.ts).

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';

export const HOST_CAPABILITIES = [
  'session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'menuRoutes', 'inspectManifest', 'sqlstate', 'regressionResults', 'logger',
] as const;

export interface HostActor {
  readonly userAccountId: string;
  readonly assuranceLevel: number;
  readonly requestId: string;
}

export interface HostPermission {
  readonly permissionCode: string;
  readonly moduleCode: string;
  readonly resourceCode: string;
  readonly operation: string;
}

export interface HostQuery {
  query(sql: string, params: readonly unknown[]): Promise<unknown[]>;
}

export interface HostLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface HostCapabilities {
  readonly protocol: typeof HOST_PROTOCOL;
  readonly moduleKey: string;
  readonly logger: HostLogger;
  session(handler: (req: Request, res: Response, actor: HostActor) => Promise<void>): RequestHandler;
  authorize(actor: HostActor, permission: HostPermission, actionCode: string, deniedTargetType: string): Promise<void>;
  evaluate(actor: HostActor, permission: HostPermission): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly reason: string }>;
  lifecycle(moduleKey: string): Promise<{ readonly isEnabled: boolean; readonly activeVersions: number } | null>;
  readOnly<R>(fn: (db: HostQuery) => Promise<R>): Promise<R>;
  menuRoutes(actor: HostActor): Promise<string[]>;
  inspectManifest(manifest: unknown, manifestHash: string | null): { readonly intact: boolean; readonly micValid: boolean };
  sqlstate(error: unknown): string | undefined;
  regressionResults(): Promise<string | null>;
}

// Backend entry of a package (module.json "backendEntry").
export interface ModuleEntry {
  readonly HOST_PROTOCOL: string;
  readonly REQUIRED_CAPABILITIES: readonly string[];
  createModule(host: HostCapabilities): { readonly router: Router };
}

export interface InstalledManifest {
  readonly moduleKey: string;
  readonly name: string;
  readonly packageVersion: string;
  // FMI-02/03: TALO-PACKAGE-HASH-1 of the release the copy was made from (generated registry; absent in test fixtures).
  readonly packageHash?: string | null;
  readonly contractVersion: string;
  readonly hostProtocol: string;
  readonly requiredCapabilities: readonly string[];
}

export interface InstalledModule {
  readonly manifest: InstalledManifest;
  readonly entry: ModuleEntry;
}
