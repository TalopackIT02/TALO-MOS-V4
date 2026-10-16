import { randomUUID } from 'node:crypto';
import type { Logger } from '../../core/logging/logger.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { DuplicateModuleKeyError, FoundationError, forbidden, serviceBusy } from './foundation.errors.js';
import { evaluateAccess, MODULE_REGISTRY_CREATE, MODULE_REGISTRY_READ } from './foundation.permissions.js';
import type { PermissionRef } from './foundation.permissions.js';
import type { AuditRecord, FoundationRepository, ModuleRecord } from './foundation.repository.js';
import { parseRegisterModule } from './foundation.validation.js';

// Module Registry service (FBE-01A, owner decisions B-4 / B-5 / B-6).
//   401 — no Foundation audit (handled before this service is reached).
//   403 — missing READ/CREATE: B08 DENIED is written; if that write fails the request is still denied and answered 503.
//   POST success — B01 + B07 REGISTER + B08 SUCCESS in one transaction; any failure rolls back everything.

export const SOURCE_SERVICE = 'talo-mos-backend';

const ACTION_CODE: Record<'READ' | 'CREATE', string> = { READ: 'MODULE_REGISTRY.READ', CREATE: 'MODULE_REGISTRY.CREATE' };

export interface Actor {
  readonly userAccountId: string;
  readonly assuranceLevel: number;
  readonly requestId: string;
}

export interface FoundationServiceDeps {
  readonly repository: FoundationRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

export class FoundationService {
  private readonly repository: FoundationRepository;
  private readonly logger: Logger;
  private readonly newEventId: () => string;

  constructor(deps: FoundationServiceDeps) {
    this.repository = deps.repository;
    this.logger = deps.logger;
    this.newEventId = deps.newEventId ?? randomUUID;
  }

  async listModules(actor: Actor): Promise<ModuleRecord[]> {
    await this.authorize(actor, MODULE_REGISTRY_READ, 'READ');
    try {
      return await this.repository.listModules();
    } catch (error) {
      this.logFailure('list modules failed', actor, error);
      throw serviceBusy();
    }
  }

  async registerModule(actor: Actor, body: unknown): Promise<ModuleRecord> {
    await this.authorize(actor, MODULE_REGISTRY_CREATE, 'CREATE');
    // Validated only after authorisation: callers without CREATE learn nothing about the input rules.
    const input = parseRegisterModule(body);
    try {
      return await this.repository.registerModule({
        input,
        actorAccountId: actor.userAccountId,
        correlationId: actor.requestId,
        audit: (module) => this.auditRecord(actor, 'CREATE', 'SUCCESS', module.moduleId, 'MODULE', module.moduleId, 'REGISTERED'),
      });
    } catch (error) {
      if (error instanceof DuplicateModuleKeyError) throw new FoundationError(409, 'MODULE_KEY_EXISTS');
      this.logFailure('register module failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }

  // Fail closed: a permission lookup error is a 503 (never an allow). A determined denial writes B08 DENIED.
  private async authorize(actor: Actor, permission: PermissionRef, operation: 'READ' | 'CREATE'): Promise<void> {
    let decision;
    try {
      decision = evaluateAccess(await this.repository.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel);
    } catch (error) {
      this.logFailure('permission check failed', actor, error);
      throw serviceBusy();
    }
    if (decision.allowed) return;

    try {
      await this.repository.insertAudit(this.auditRecord(actor, operation, 'DENIED', null, 'MODULE_REGISTRY', null, decision.reason));
    } catch (error) {
      this.logFailure('DENIED audit write failed: request denied', actor, error);
      throw serviceBusy();
    }
    this.logger.warn('foundation access denied', { requestId: actor.requestId, permission: permission.permissionCode, reason: decision.reason });
    throw forbidden();
  }

  private auditRecord(
    actor: Actor, operation: 'READ' | 'CREATE', outcome: AuditRecord['outcome'], moduleId: string | null, targetType: string, targetId: string | null, reason: string,
  ): AuditRecord {
    return {
      eventId: this.newEventId(),
      moduleId,
      actorAccountId: actor.userAccountId,
      actionCode: ACTION_CODE[operation],
      targetType,
      targetId,
      outcome,
      correlationId: actor.requestId,
      sourceService: SOURCE_SERVICE,
      metadata: { v: 1, reason, requestId: actor.requestId },
    };
  }

  private logFailure(message: string, actor: Actor, error: unknown): void {
    this.logger.error(message, { requestId: actor.requestId, errorName: error instanceof Error ? error.name : typeof error, sqlstate: sqlstateOf(error) });
  }
}
