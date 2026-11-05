import { z } from 'zod';
import type { ModuleActor, ModuleHost, ModulePermission, ReadQuery, WriteTx } from '../host.js';
import { CrmError, mapDbError, notFound } from './errors.js';
import { CRM_MODULE_KEY, P, actionCode } from './permissions.js';

// Every CRM operation enters here. Order: lifecycle (ENABLED + exactly one ACTIVE version, 503 MODULE_UNAVAILABLE) →
//   read : IAM via host.authorize (DENIED audit by the Host) → host.readOnly;
//   write: host.write — the Host itself checks IAM (DENIED audit), the ACTIVE version, the enabled B12 rules and writes
//          the SUCCESS / FAILURE audit row; DB errors are mapped to CRM errors after the rollback.
// The actor always comes from host.session (never from the request body). Object scope (assignments / ownership) is
// decided by the services below, inside the same read or write transaction.

export const DENIED_TARGET = 'CRM_API';

export interface CrmScope {
  readonly actorId: string;
  readonly readAll: boolean;
}

export interface CrmCtx {
  readonly actor: ModuleActor;
  readonly scope: CrmScope;
  allowed(permission: ModulePermission): Promise<boolean>;
}

export interface WriteAudit {
  readonly targetType: string;
  readonly targetId?: string | null;
}

export class CrmRuntime {
  constructor(readonly host: ModuleHost) {}

  private async lifecycle(): Promise<void> {
    let state;
    try {
      state = await this.host.lifecycle(CRM_MODULE_KEY);
    } catch {
      throw new CrmError(503, 'SERVICE_BUSY');
    }
    if (state === null || !state.isEnabled || state.activeVersions !== 1) throw new CrmError(503, 'MODULE_UNAVAILABLE');
  }

  private async ctx(actor: ModuleActor): Promise<CrmCtx> {
    const allowed = async (permission: ModulePermission) => {
      try {
        return (await this.host.evaluate(actor, permission)).allowed;
      } catch {
        throw new CrmError(503, 'SERVICE_BUSY');
      }
    };
    return { actor, scope: { actorId: actor.userAccountId, readAll: await allowed(P.customerReadAll) }, allowed };
  }

  // IAM evaluation without DENIED audit (choosing between two accepted rights, session permission list).
  async allowedFor(actor: ModuleActor, permission: ModulePermission): Promise<boolean> {
    return (await this.ctx(actor)).allowed(permission);
  }

  // Lifecycle + session only (no K05 permission): reminders of the caller's own appointments.
  async readSelf<R>(actor: ModuleActor, fn: (ctx: CrmCtx, q: ReadQuery) => Promise<R>): Promise<R> {
    await this.lifecycle();
    const ctx = await this.ctx(actor);
    return this.host.readOnly((q) => fn(ctx, q));
  }

  async read<R>(actor: ModuleActor, permission: ModulePermission, fn: (ctx: CrmCtx, q: ReadQuery) => Promise<R>): Promise<R> {
    await this.lifecycle();
    await this.host.authorize(actor, permission, actionCode(permission), DENIED_TARGET);
    const ctx = await this.ctx(actor);
    return this.host.readOnly((q) => fn(ctx, q));
  }

  async write<R>(actor: ModuleActor, permission: ModulePermission, audit: WriteAudit, fn: (ctx: CrmCtx, tx: WriteTx) => Promise<R>): Promise<R> {
    await this.lifecycle();
    const ctx = await this.ctx(actor);
    try {
      return await this.host.write(actor, { permission, auditActionCode: actionCode(permission), targetType: audit.targetType, targetId: audit.targetId ?? null },
        (tx) => fn(ctx, tx));
    } catch (error) {
      throw mapDbError(this.host.sqlstate(error), error);
    }
  }
}

// ---- shared SQL helpers (fixed identifiers; values are bind parameters) -----------------------------------------------

export const ts = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const s = z.string();
export const ns = z.string().nullable();

// Customer `c` in scope: $a = readAll, $b = actor.
export const customerScope = (a: number, b: number): string =>
  `($${a}::boolean OR EXISTS (SELECT 1 FROM cm.cm_customer_assignments AS sa
     WHERE sa.customer_id = c.customer_id AND sa.ended_at IS NULL AND sa.sale_account_id = $${b}::uuid))`;

export async function customerVisible(q: ReadQuery, scope: CrmScope, customerId: string): Promise<boolean> {
  const rows = await q.query(`SELECT 1 FROM cm.cm_customers AS c WHERE c.customer_id = $1::uuid AND ${customerScope(2, 3)}`,
    [customerId, scope.readAll, scope.actorId]);
  return rows.length === 1;
}

export async function requireCustomer(q: ReadQuery, scope: CrmScope, customerId: string): Promise<void> {
  if (!(await customerVisible(q, scope, customerId))) throw notFound();
}

export function parseRows<T extends z.ZodTypeAny>(schema: T, raw: unknown[]): z.infer<T>[] {
  return raw.map((r) => schema.parse(r));
}

export const UUID = z.string().uuid();
