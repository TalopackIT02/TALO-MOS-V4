import { randomUUID } from 'node:crypto';
import type { Logger } from '../../core/logging/logger.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { forbidden, serviceBusy } from './foundation.errors.js';
import { evaluateAccess } from './foundation.permissions.js';
import type { PermissionRef } from './foundation.permissions.js';
import type { AuditRecord, FoundationRepository } from './foundation.repository.js';

// Shared authorisation + audit-record building for every Foundation service (extracted unchanged from the FBE-01A
// FoundationService so that Module Registry and Module Version use ONE evaluator and ONE DENIED-audit path).
//   403 — permission not effective: B08 DENIED is written; if that write fails the request is still denied (503).
//   permission lookup error — 503, never an allow (fail closed).

export const SOURCE_SERVICE = 'talo-mos-backend';

export interface Actor {
  readonly userAccountId: string;
  readonly assuranceLevel: number;
  readonly requestId: string;
}

export interface AccessGuardDeps {
  readonly repository: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

export class AccessGuard {
  private readonly repository: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  private readonly logger: Logger;
  private readonly newEventId: () => string;

  constructor(deps: AccessGuardDeps) {
    this.repository = deps.repository;
    this.logger = deps.logger;
    this.newEventId = deps.newEventId ?? randomUUID;
  }

  // `deniedTargetType` is the B08 target_type of a DENIED row (target_id and module_id are NULL, B-5).
  async authorize(actor: Actor, permission: PermissionRef, actionCode: string, deniedTargetType: string): Promise<void> {
    let decision;
    try {
      decision = evaluateAccess(await this.repository.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel);
    } catch (error) {
      this.logFailure('permission check failed', actor, error);
      throw serviceBusy();
    }
    if (decision.allowed) return;

    try {
      await this.repository.insertAudit(this.auditRecord(actor, actionCode, 'DENIED', null, deniedTargetType, null, decision.reason));
    } catch (error) {
      this.logFailure('DENIED audit write failed: request denied', actor, error);
      throw serviceBusy();
    }
    this.logger.warn('foundation access denied', { requestId: actor.requestId, permission: permission.permissionCode, reason: decision.reason });
    throw forbidden();
  }

  auditRecord(
    actor: Actor, actionCode: string, outcome: AuditRecord['outcome'], moduleId: string | null, targetType: string, targetId: string | null, reason: string,
  ): AuditRecord {
    return {
      eventId: this.newEventId(),
      moduleId,
      actorAccountId: actor.userAccountId,
      actionCode,
      targetType,
      targetId,
      outcome,
      correlationId: actor.requestId,
      sourceService: SOURCE_SERVICE,
      metadata: { v: 1, reason, requestId: actor.requestId },
    };
  }

  logFailure(message: string, actor: Actor, error: unknown): void {
    this.logger.error(message, { requestId: actor.requestId, errorName: error instanceof Error ? error.name : typeof error, sqlstate: sqlstateOf(error) });
  }
}
