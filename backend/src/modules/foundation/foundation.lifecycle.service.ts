import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { FoundationError, serviceBusy } from './foundation.errors.js';
import { canonicalDigest, isPlainObject } from './foundation.json.js';
import {
  LifecycleVersionNotFoundError, ModuleStateConflictError, RecoveryProofError, RouteConflictError, VersionStateConflictError,
} from './foundation.lifecycle.repository.js';
import type { ActivationFacts, ActivationResult, LifecycleRepository } from './foundation.lifecycle.repository.js';
import {
  MODULE_REGISTRY_DISABLE, MODULE_REGISTRY_ENABLE, MODULE_VERSION_ACTIVATE, MODULE_VERSION_APPROVE, MODULE_VERSION_REJECT, MODULE_VERSION_RETIRE,
} from './foundation.permissions.js';
import type { PermissionRef } from './foundation.permissions.js';
import type { FoundationRepository, ModuleRecord } from './foundation.repository.js';
import { ModuleNotFoundError } from './foundation.versions.repository.js';
import type { VersionAuditRecord, VersionRecord } from './foundation.versions.repository.js';
import { uuidParam } from './foundation.versions.validation.js';

// FBE-05 — Module & Version lifecycle service (owner decisions L1–L8).
//   Authorisation first (shared AccessGuard: same evaluator, no admin bypass / wildcard, Direct DENY wins, undefined
//   permission → DENIED, B08 DENIED), then ids and body, then the transaction. Body: absent or {} only.
//   L1 transitions: IN_REVIEW → APPROVED | REJECTED, APPROVED → ACTIVE (current ACTIVE → RETIRED first), ACTIVE → RETIRED.
//   Anything else → 409 VERSION_STATE_CONFLICT. No rollback (RETIRED → ACTIVE) route.
//   L3 activation gate (activationBlockers): stored MIC + manifest_hash intact; MIC-10 test evidence all PASS; the latest
//   B13 check of this version exists, is unique and is PASS or WARN; no BLOCKING B14 change in it (whatever its
//   resolution_status); no DIRECT_DB data contract (its separate approval has no evidence yet → fail closed).
//   L5 ENABLE: exactly one ACTIVE version that still passes the activation gate. DISABLE: no condition on versions.
//   Success: 200 with the version / module; B07 + B08 SUCCESS in the same transaction (failure → 503, nothing kept).

export const ACTIVATION_BLOCKERS = [
  'MANIFEST_INTEGRITY_INVALID',
  'TEST_EVIDENCE_NOT_PASSED',
  'COMPATIBILITY_CHECK_MISSING',
  'COMPATIBILITY_CHECK_AMBIGUOUS',
  'COMPATIBILITY_RESULT_NOT_ACCEPTED',
  'COMPATIBILITY_BLOCKING_CHANGE',
  'DIRECT_DB_APPROVAL_MISSING',
] as const;
export type ActivationBlocker = (typeof ACTIVATION_BLOCKERS)[number];
export type EnableBlocker = ActivationBlocker | 'NO_ACTIVE_VERSION';

const ACCEPTED_RESULTS = new Set(['PASS', 'WARN']);

// Only the sections the gate reads; everything else of the stored MIC is ignored here.
const storedMic = z.object({
  mic06DataResources: z.array(z.looseObject({ interfaceKind: z.string() })),
  mic10Manifest: z.looseObject({ testEvidence: z.array(z.looseObject({ result: z.string() })) }),
});

function manifestIntact(version: VersionRecord): boolean {
  if (version.manifestJson === null || version.manifestHash === null) return false;
  try {
    return canonicalDigest(version.manifestJson).sha256 === version.manifestHash;
  } catch {
    return false;
  }
}

// Pure L3 gate; an empty list = activation allowed.
export function activationBlockers(facts: ActivationFacts): ActivationBlocker[] {
  const found = new Set<ActivationBlocker>();
  if (!manifestIntact(facts.version)) found.add('MANIFEST_INTEGRITY_INVALID');
  const mic = storedMic.safeParse(facts.version.manifestJson);
  if (!mic.success) {
    found.add('MANIFEST_INTEGRITY_INVALID');
  } else {
    const evidence = mic.data.mic10Manifest.testEvidence;
    if (evidence.length === 0 || evidence.some((e) => e.result !== 'PASS')) found.add('TEST_EVIDENCE_NOT_PASSED');
    if (mic.data.mic06DataResources.some((r) => r.interfaceKind === 'DIRECT_DB')) found.add('DIRECT_DB_APPROVAL_MISSING');
  }
  const [check] = facts.checks;
  if (facts.checks.length === 0 || check === undefined) found.add('COMPATIBILITY_CHECK_MISSING');
  else if (facts.checks.length > 1) found.add('COMPATIBILITY_CHECK_AMBIGUOUS');
  else if (!ACCEPTED_RESULTS.has(check.checkResult)) found.add('COMPATIBILITY_RESULT_NOT_ACCEPTED');
  if (facts.blockingChanges > 0) found.add('COMPATIBILITY_BLOCKING_CHANGE');
  if (facts.directDbContracts > 0) found.add('DIRECT_DB_APPROVAL_MISSING');
  return ACTIVATION_BLOCKERS.filter((b) => found.has(b));
}

export function enableBlockers(activeVersions: number, facts: ActivationFacts | null): EnableBlocker[] {
  if (activeVersions !== 1 || facts === null) return ['NO_ACTIVE_VERSION'];
  return activationBlockers(facts);
}

// Lifecycle answers that the shared FoundationError catalogue does not contain (kept local to this module).
export const LIFECYCLE_MESSAGES = {
  VERSION_STATE_CONFLICT: 'Phiên bản không ở trạng thái cho phép thao tác này.',
  ACTIVATION_BLOCKED: 'Phiên bản chưa đủ điều kiện để kích hoạt.',
  MODULE_STATE_CONFLICT: 'Module đã ở trạng thái được yêu cầu.',
  MODULE_ENABLE_BLOCKED: 'Module chưa đủ điều kiện để bật.',
  MODULE_ROUTE_CONFLICT: 'Route của module đang được một module khác (ACTIVE, đang bật) sử dụng: không bật được.',
  RECOVERY_PROOF_MISMATCH: 'Trạng thái phiên bản không khớp nhật ký cài đặt: không phục hồi (không đoán).',
} as const;
export type LifecycleErrorCode = keyof typeof LIFECYCLE_MESSAGES;

export class LifecycleError extends Error {
  readonly status: number;
  readonly code: LifecycleErrorCode;
  readonly errors: readonly string[] | undefined;

  constructor(status: number, code: LifecycleErrorCode, errors?: readonly string[]) {
    super(LIFECYCLE_MESSAGES[code]);
    this.name = 'LifecycleError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

class GateRefusedError extends Error {
  readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super('lifecycle gate refused');
    this.name = 'GateRefusedError';
    this.blockers = blockers;
  }
}

const ACTION_CODE = {
  APPROVE: 'MODULE_VERSION.APPROVE', REJECT: 'MODULE_VERSION.REJECT', ACTIVATE: 'MODULE_VERSION.ACTIVATE', RETIRE: 'MODULE_VERSION.RETIRE',
  ENABLE: 'MODULE_REGISTRY.ENABLE', DISABLE: 'MODULE_REGISTRY.DISABLE', ROLLBACK: 'MODULE_VERSION.ROLLBACK',
} as const;
const VERSION_TARGET = 'MODULE_VERSION';
const REGISTRY_TARGET = 'MODULE_REGISTRY';

export interface LifecycleServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly lifecycle: LifecycleRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

const invalidBody = () => new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: ['UNKNOWN_FIELD'] } });

export class ModuleLifecycleService {
  private readonly lifecycle: LifecycleRepository;
  private readonly guard: AccessGuard;

  constructor(deps: LifecycleServiceDeps) {
    this.lifecycle = deps.lifecycle;
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger, ...(deps.newEventId ? { newEventId: deps.newEventId } : {}) });
  }

  approve(actor: Actor, moduleId: unknown, versionId: unknown, body: unknown): Promise<VersionRecord> {
    return this.review(actor, 'APPROVE', MODULE_VERSION_APPROVE, moduleId, versionId, body);
  }

  reject(actor: Actor, moduleId: unknown, versionId: unknown, body: unknown): Promise<VersionRecord> {
    return this.review(actor, 'REJECT', MODULE_VERSION_REJECT, moduleId, versionId, body);
  }

  async activate(actor: Actor, moduleIdParam: unknown, versionIdParam: unknown, body: unknown): Promise<ActivationResult> {
    await this.guard.authorize(actor, MODULE_VERSION_ACTIVATE, ACTION_CODE.ACTIVATE, VERSION_TARGET);
    const { moduleId, versionId } = this.versionIds(moduleIdParam, versionIdParam, body);
    try {
      return await this.lifecycle.activateVersion({
        moduleId, versionId, actorAccountId: actor.userAccountId, correlationId: actor.requestId,
        gate: (facts) => {
          const blockers = activationBlockers(facts);
          if (blockers.length > 0) throw new GateRefusedError(blockers);
        },
        audit: (version, retired) => this.versionAudit(actor, ACTION_CODE.ACTIVATE, version, 'ACTIVATED', retired ? { retiredVersionId: retired.versionId } : {}),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'ACTIVATION_BLOCKED', 'activate version failed (rolled back)');
    }
  }

  async retire(actor: Actor, moduleIdParam: unknown, versionIdParam: unknown, body: unknown): Promise<VersionRecord> {
    await this.guard.authorize(actor, MODULE_VERSION_RETIRE, ACTION_CODE.RETIRE, VERSION_TARGET);
    const { moduleId, versionId } = this.versionIds(moduleIdParam, versionIdParam, body);
    try {
      return await this.lifecycle.retireVersion({
        moduleId, versionId, actorAccountId: actor.userAccountId, correlationId: actor.requestId,
        audit: (version) => this.versionAudit(actor, ACTION_CODE.RETIRE, version, 'RETIRED'),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'ACTIVATION_BLOCKED', 'retire version failed (rolled back)');
    }
  }

  // REV01-D1 — controlled recovery of ONE failed upgrade activation, called by the installer only (no HTTP route): the
  // installer passes its journal facts (the version it activated, the activated_at returned, the version retired by that
  // activation); the repository re-checks them under the module lock. Needs both ACTIVATE and RETIRE permissions.
  async recoverUpgrade(actor: Actor, input: { moduleId: string; failedVersionId: string; restoreVersionId: string; failedActivatedAt: string; installId: string }): Promise<ActivationResult> {
    await this.guard.authorize(actor, MODULE_VERSION_ACTIVATE, ACTION_CODE.ROLLBACK, VERSION_TARGET);
    await this.guard.authorize(actor, MODULE_VERSION_RETIRE, ACTION_CODE.ROLLBACK, VERSION_TARGET);
    const moduleId = uuidParam(input.moduleId);
    const failedVersionId = uuidParam(input.failedVersionId);
    const restoreVersionId = uuidParam(input.restoreVersionId);
    if (!moduleId || !failedVersionId || !restoreVersionId) throw new FoundationError(404, 'VERSION_NOT_FOUND');
    try {
      return await this.lifecycle.recoverUpgrade({
        moduleId, failedVersionId, restoreVersionId, failedActivatedAt: input.failedActivatedAt, actorAccountId: actor.userAccountId, correlationId: actor.requestId,
        gate: (restore) => { if (!manifestIntact(restore)) throw new GateRefusedError(['MANIFEST_INTEGRITY_INVALID']); },
        audit: (restored) => this.versionAudit(actor, ACTION_CODE.ROLLBACK, restored, 'ROLLED_BACK', { failedVersionId, installId: input.installId }),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'ACTIVATION_BLOCKED', 'upgrade recovery failed (rolled back)');
    }
  }

  enable(actor: Actor, moduleId: unknown, body: unknown): Promise<ModuleRecord> {
    return this.toggle(actor, true, moduleId, body);
  }

  disable(actor: Actor, moduleId: unknown, body: unknown): Promise<ModuleRecord> {
    return this.toggle(actor, false, moduleId, body);
  }

  private async review(
    actor: Actor, decision: 'APPROVE' | 'REJECT', permission: PermissionRef, moduleIdParam: unknown, versionIdParam: unknown, body: unknown,
  ): Promise<VersionRecord> {
    await this.guard.authorize(actor, permission, ACTION_CODE[decision], VERSION_TARGET);
    const { moduleId, versionId } = this.versionIds(moduleIdParam, versionIdParam, body);
    try {
      return await this.lifecycle.reviewVersion({
        moduleId, versionId, decision, actorAccountId: actor.userAccountId, correlationId: actor.requestId,
        audit: (version) => this.versionAudit(actor, ACTION_CODE[decision], version, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'ACTIVATION_BLOCKED', `${decision.toLowerCase()} version failed (rolled back)`);
    }
  }

  private async toggle(actor: Actor, enable: boolean, moduleIdParam: unknown, body: unknown): Promise<ModuleRecord> {
    const action = enable ? ACTION_CODE.ENABLE : ACTION_CODE.DISABLE;
    await this.guard.authorize(actor, enable ? MODULE_REGISTRY_ENABLE : MODULE_REGISTRY_DISABLE, action, REGISTRY_TARGET);
    const moduleId = uuidParam(moduleIdParam);
    if (!moduleId) throw new FoundationError(404, 'MODULE_NOT_FOUND');
    this.emptyBody(body);
    try {
      return await this.lifecycle.setModuleEnabled({
        moduleId, enable, actorAccountId: actor.userAccountId, correlationId: actor.requestId,
        gate: (activeVersions, facts) => {
          const blockers = enableBlockers(activeVersions, facts);
          if (blockers.length > 0) throw new GateRefusedError(blockers);
        },
        audit: (module) => this.guard.auditRecord(actor, action, 'SUCCESS', module.moduleId, 'MODULE', module.moduleId, enable ? 'ENABLED' : 'DISABLED'),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'MODULE_ENABLE_BLOCKED', `${enable ? 'enable' : 'disable'} module failed (rolled back)`);
    }
  }

  private versionIds(moduleIdParam: unknown, versionIdParam: unknown, body: unknown): { moduleId: string; versionId: string } {
    const moduleId = uuidParam(moduleIdParam);
    const versionId = uuidParam(versionIdParam);
    if (!moduleId || !versionId) throw new FoundationError(404, 'VERSION_NOT_FOUND');
    this.emptyBody(body);
    return { moduleId, versionId };
  }

  // L7: no business parameter — an absent body or exactly {}.
  private emptyBody(body: unknown): void {
    if (body === undefined) return;
    if (!isPlainObject(body) || Object.keys(body).length > 0) throw invalidBody();
  }

  private versionAudit(
    actor: Actor, actionCode: string, version: VersionRecord, reason: string, extra: Readonly<Record<string, string>> = {},
  ): VersionAuditRecord {
    const base = this.guard.auditRecord(actor, actionCode, 'SUCCESS', version.moduleId, VERSION_TARGET, version.versionId, reason);
    return { ...base, versionId: version.versionId, metadata: { ...base.metadata, ...extra } };
  }

  private mapFailure(actor: Actor, error: unknown, gateCode: 'ACTIVATION_BLOCKED' | 'MODULE_ENABLE_BLOCKED', message: string): Error {
    if (error instanceof LifecycleVersionNotFoundError) return new FoundationError(404, 'VERSION_NOT_FOUND');
    if (error instanceof ModuleNotFoundError) return new FoundationError(404, 'MODULE_NOT_FOUND');
    if (error instanceof VersionStateConflictError) return new LifecycleError(409, 'VERSION_STATE_CONFLICT');
    if (error instanceof ModuleStateConflictError) return new LifecycleError(409, 'MODULE_STATE_CONFLICT');
    if (error instanceof GateRefusedError) return new LifecycleError(422, gateCode, error.blockers);
    if (error instanceof RouteConflictError) return new LifecycleError(409, 'MODULE_ROUTE_CONFLICT', error.conflicts.map((c) => `${c.routePath}@${c.moduleKey}`));
    if (error instanceof RecoveryProofError) return new LifecycleError(409, 'RECOVERY_PROOF_MISMATCH');
    this.guard.logFailure(message, actor, error);
    return serviceBusy();
  }
}
