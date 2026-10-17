import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import { proposedDefinitions } from './foundation.compatibility.js';
import type { CompatibilityPlan } from './foundation.compatibility.js';
import { dataPlan } from './foundation.data.js';
import type { Actor } from './foundation.access.js';
import { FoundationError, serviceBusy } from './foundation.errors.js';
import { canonicalDigest, hasNoDuplicateKeys, isPlainObject, jsonViolation } from './foundation.json.js';
import { VersionNotDraftError, VersionNotFoundError } from './foundation.manifest.repository.js';
import type { ManifestAuditRecord, ManifestRepository } from './foundation.manifest.repository.js';
import { validateMic } from './foundation.mic.js';
import { registryPlan } from './foundation.registry.js';
import type { Mic, MicErrorCode } from './foundation.mic.js';
import { MODULE_VERSION_SUBMIT, MODULE_VERSION_UPDATE } from './foundation.permissions.js';
import type { FoundationRepository } from './foundation.repository.js';
import type { VersionRecord } from './foundation.versions.repository.js';
import { uuidParam } from './foundation.versions.validation.js';

// FBE-02B — PUT manifest (DRAFT) and SUBMIT (DRAFT → IN_REVIEW), owner decisions P-2, P-6…P-10, P-13…P-17.
//   Authorisation first (shared AccessGuard; DENIED → B08 DENIED, target_id / module_id NULL), then ids, body and
//   business validation — a caller without the permission learns nothing.
//   PUT   : body {manifest: object | null}; duplicate keys / lone surrogates / unsafe numbers → 400. B02 + B08 SUCCESS.
//   SUBMIT: body {expectedManifestHash?}; MIC invalid → 422 MIC_INVALID + B08 FAILURE written OUTSIDE the rolled-back
//           transaction (503 if that audit write fails); hash mismatch → 409. B02 + B07 SUBMIT + B08 SUCCESS.

const ACTION_CODE = { UPDATE: 'MODULE_VERSION.UPDATE_MANIFEST', SUBMIT: 'MODULE_VERSION.SUBMIT' } as const;
const TARGET_TYPE = 'MODULE_VERSION';
const SHA256_HEX = /^[0-9a-f]{64}$/;

const submitBodySchema = z.strictObject({ expectedManifestHash: z.string().regex(SHA256_HEX).optional() });

export class MicInvalidError extends Error {
  readonly errors: readonly MicErrorCode[];

  constructor(errors: readonly MicErrorCode[]) {
    super('MIC is not valid for SUBMIT');
    this.name = 'MicInvalidError';
    this.errors = errors;
  }
}

export class ManifestHashMismatchError extends Error {
  constructor() {
    super('expectedManifestHash does not match the server hash');
    this.name = 'ManifestHashMismatchError';
  }
}

export interface ModuleManifestServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly manifests: ManifestRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

// MIC-09 → compatibility plan. validateMic guarantees fromVersion for CHANGE; its absence is refused, never guessed.
function compatibilityPlan(mic: Mic): CompatibilityPlan {
  const proposed = proposedDefinitions(mic);
  const compat = mic.mic09Compatibility;
  if (compat.kind === 'INITIAL_REGISTRATION') return { kind: compat.kind, proposed };
  if (compat.fromVersion === undefined) throw new MicInvalidError(['COMPATIBILITY_FROM_VERSION_INVALID']);
  return { kind: compat.kind, fromVersion: compat.fromVersion, proposed };
}

const invalid = (field: string) => new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: [field] } });

export class ModuleManifestService {
  private readonly manifests: ManifestRepository;
  private readonly guard: AccessGuard;

  constructor(deps: ModuleManifestServiceDeps) {
    this.manifests = deps.manifests;
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger, ...(deps.newEventId ? { newEventId: deps.newEventId } : {}) });
  }

  async updateManifest(actor: Actor, moduleIdParam: unknown, versionIdParam: unknown, body: unknown, rawBody: string | undefined): Promise<VersionRecord> {
    await this.guard.authorize(actor, MODULE_VERSION_UPDATE, ACTION_CODE.UPDATE, TARGET_TYPE);
    const { moduleId, versionId } = this.ids(moduleIdParam, versionIdParam);
    const manifest = this.parseManifestBody(actor, body, rawBody);
    try {
      return await this.manifests.updateManifest({
        moduleId,
        versionId,
        manifest,
        audit: (version) => this.audit(actor, ACTION_CODE.UPDATE, 'SUCCESS', version, manifest === null ? 'MANIFEST_CLEARED' : 'MANIFEST_UPDATED'),
      });
    } catch (error) {
      throw this.mapFailure(actor, error, 'update manifest failed (rolled back)');
    }
  }

  async submit(actor: Actor, moduleIdParam: unknown, versionIdParam: unknown, body: unknown): Promise<VersionRecord> {
    await this.guard.authorize(actor, MODULE_VERSION_SUBMIT, ACTION_CODE.SUBMIT, TARGET_TYPE);
    const { moduleId, versionId } = this.ids(moduleIdParam, versionIdParam);
    const parsed = submitBodySchema.safeParse(body ?? {});
    if (!parsed.success) throw invalid(parsed.error.issues.some((i) => i.code === 'unrecognized_keys') ? 'UNKNOWN_FIELD' : 'expectedManifestHash');
    const expected = parsed.data.expectedManifestHash;
    let submittedHash = '';
    try {
      return await this.manifests.submitVersion({
        moduleId,
        versionId,
        actorAccountId: actor.userAccountId,
        correlationId: actor.requestId,
        prepare: (locked, others) => {
          // P-14 on the stored draft, then P-16 / P-17, then P-15 hash over the whole stored MIC.
          if (jsonViolation(locked.manifestJson) !== null) throw new MicInvalidError(['MIC_SCHEMA_INVALID']);
          const result = validateMic(locked.manifestJson, {
            moduleKey: locked.moduleKey, moduleVersion: locked.moduleVersion, contractVersion: locked.contractVersion, otherVersions: others,
          });
          if (!result.ok) throw new MicInvalidError(result.errors);
          const { sha256 } = canonicalDigest(locked.manifestJson);
          if (expected !== undefined && expected !== sha256) throw new ManifestHashMismatchError();
          submittedHash = sha256;
          // FBE-03: Function / Action registry rows materialised in the same SUBMIT transaction.
          // FBE-04: Data Contracts (B10–B12) and the compatibility check (B13 / B14), same transaction.
          return { manifestHash: sha256, registry: registryPlan(result.mic), data: dataPlan(result.mic), compatibility: compatibilityPlan(result.mic) };
        },
        audit: (version) => this.audit(actor, ACTION_CODE.SUBMIT, 'SUCCESS', version, 'SUBMITTED', { manifestHash: submittedHash }),
      });
    } catch (error) {
      if (error instanceof MicInvalidError) {
        await this.recordMicFailure(actor, moduleId, versionId, error.errors);
        throw new FoundationError(422, 'MIC_INVALID', { details: { errors: [...error.errors] } });
      }
      if (error instanceof ManifestHashMismatchError) throw new FoundationError(409, 'MANIFEST_HASH_MISMATCH');
      throw this.mapFailure(actor, error, 'submit version failed (rolled back)');
    }
  }

  private ids(moduleIdParam: unknown, versionIdParam: unknown): { moduleId: string; versionId: string } {
    const moduleId = uuidParam(moduleIdParam);
    const versionId = uuidParam(versionIdParam);
    if (!moduleId || !versionId) throw new FoundationError(404, 'VERSION_NOT_FOUND');
    return { moduleId, versionId };
  }

  // {manifest: object | null}, exactly; P-14 checks on the raw text and on the parsed value. Nothing is repaired.
  private parseManifestBody(actor: Actor, body: unknown, rawBody: string | undefined): Readonly<Record<string, unknown>> | null {
    if (!isPlainObject(body)) throw invalid('manifest');
    const keys = Object.keys(body);
    if (keys.some((k) => k !== 'manifest')) throw invalid('UNKNOWN_FIELD');
    if (!keys.includes('manifest')) throw invalid('manifest');
    const manifest = body['manifest'];
    if (manifest !== null && !isPlainObject(manifest)) throw invalid('manifest');
    if (rawBody === undefined) {
      // The dedicated manifest parser (app.ts) did not run: refuse rather than skip the duplicate-key check.
      this.guard.logFailure('manifest raw body unavailable', actor, new Error('raw body missing'));
      throw serviceBusy();
    }
    if (!hasNoDuplicateKeys(rawBody)) throw invalid('manifest');
    if (jsonViolation(manifest) !== null) throw invalid('manifest');
    return manifest;
  }

  private audit(
    actor: Actor, actionCode: string, outcome: ManifestAuditRecord['outcome'], version: VersionRecord, reason: string, extra: Readonly<Record<string, string>> = {},
  ): ManifestAuditRecord {
    const base = this.guard.auditRecord(actor, actionCode, outcome, version.moduleId, TARGET_TYPE, version.versionId, reason);
    return { ...base, versionId: version.versionId, metadata: { ...base.metadata, ...extra } };
  }

  // P-8 decision 8: B08 FAILURE outside the version transaction; codes and requestId only. Audit failure → 503.
  private async recordMicFailure(actor: Actor, moduleId: string, versionId: string, errors: readonly MicErrorCode[]): Promise<void> {
    const base = this.guard.auditRecord(actor, ACTION_CODE.SUBMIT, 'FAILURE', moduleId, TARGET_TYPE, versionId, 'MIC_INVALID');
    try {
      await this.manifests.insertAudit({ ...base, versionId, metadata: { v: 1, reason: 'MIC_INVALID', errors: [...errors], requestId: actor.requestId } });
    } catch (error) {
      this.guard.logFailure('MIC_INVALID FAILURE audit write failed', actor, error);
      throw serviceBusy();
    }
  }

  private mapFailure(actor: Actor, error: unknown, message: string): FoundationError {
    if (error instanceof VersionNotFoundError) return new FoundationError(404, 'VERSION_NOT_FOUND');
    if (error instanceof VersionNotDraftError) return new FoundationError(409, 'VERSION_NOT_DRAFT');
    this.guard.logFailure(message, actor, error);
    return serviceBusy();
  }
}
