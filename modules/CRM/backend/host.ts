import type { Request, RequestHandler, Response } from 'express';

// CRM — Host protocol TALO-MODULE-HOST-1 as seen by this package. Types only: the package imports nothing from the Host's
// source. The Host owns session validation, IAM evaluation + DENIED audit, lifecycle, the read-only executor and — Gate 3
// candidate — `controlledWrite`: one write transaction in which the package names Data Contract resources of its ACTIVE
// version and the Host builds the statements, checks the enabled B12 rules and writes the Foundation audit row.

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';

export interface ModuleActor {
  readonly userAccountId: string;
  readonly assuranceLevel: number;
  readonly requestId: string;
}

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

export interface ReadQuery {
  query(sql: string, params: readonly unknown[]): Promise<unknown[]>;
}

export type WriteValue = string | number | boolean | Date | null | { readonly $host: 'NOW' };
export const NOW: WriteValue = Object.freeze({ $host: 'NOW' as const });

export interface WriteBinding {
  readonly permission: ModulePermission;
  readonly auditActionCode: string;
  readonly targetType: string;
  readonly targetId?: string | null;
}

export interface WriteTx {
  read(sql: string, params: readonly unknown[]): Promise<unknown[]>;
  insert(resourceKey: string, values: Readonly<Record<string, WriteValue>>, returning?: readonly string[]): Promise<Record<string, unknown>[]>;
  update(
    resourceKey: string, match: Readonly<Record<string, WriteValue>>, values: Readonly<Record<string, WriteValue>>, returning?: readonly string[],
  ): Promise<{ readonly count: number; readonly rows: Record<string, unknown>[] }>;
  delete(resourceKey: string, match: Readonly<Record<string, WriteValue>>): Promise<number>;
  lock(resourceKey: string, match: Readonly<Record<string, WriteValue>>, columns: readonly string[]): Promise<Record<string, unknown>[]>;
  setAuditTarget(targetId: string): void;
}

export interface ModuleHost {
  readonly protocol: typeof HOST_PROTOCOL;
  readonly moduleKey: string;
  readonly logger: ModuleLogger;
  session(handler: (req: Request, res: Response, actor: ModuleActor) => Promise<void>): RequestHandler;
  authorize(actor: ModuleActor, permission: ModulePermission, actionCode: string, deniedTargetType: string): Promise<void>;
  evaluate(actor: ModuleActor, permission: ModulePermission): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly reason: string }>;
  lifecycle(moduleKey: string): Promise<{ readonly isEnabled: boolean; readonly activeVersions: number } | null>;
  readOnly<R>(fn: (db: ReadQuery) => Promise<R>): Promise<R>;
  sqlstate(error: unknown): string | undefined;
  write<R>(actor: ModuleActor, binding: WriteBinding, fn: (tx: WriteTx) => Promise<R>): Promise<R>;
}
