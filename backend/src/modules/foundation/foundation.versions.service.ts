import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { FoundationError, serviceBusy } from './foundation.errors.js';
import { MODULE_VERSION_CREATE, MODULE_VERSION_READ } from './foundation.permissions.js';
import type { FoundationRepository } from './foundation.repository.js';
import { ModuleNotFoundError, VersionExistsError, VersionNotIncreasingError } from './foundation.versions.repository.js';
import type { ModuleVersionRepository, VersionRecord } from './foundation.versions.repository.js';
import { parseCreateVersion, uuidParam } from './foundation.versions.validation.js';

// FBE-02A — Module Version DRAFT service (owner approved).
//   Authorisation first (shared AccessGuard: same evaluator, same B08 DENIED path as FBE-01), then input checks, so a
//   caller without the permission learns nothing about modules, versions or input rules.
//   Audit: MODULE_VERSION.READ (DENIED only) / MODULE_VERSION.CREATE (SUCCESS + DENIED), target_type MODULE_VERSION.
//   No B07 for a DRAFT. Any database / audit failure → 503 (create is rolled back as a whole).

const ACTION_CODE = { READ: 'MODULE_VERSION.READ', CREATE: 'MODULE_VERSION.CREATE' } as const;
const TARGET_TYPE = 'MODULE_VERSION';

export interface ModuleVersionServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly versions: ModuleVersionRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

export class ModuleVersionService {
  private readonly versions: ModuleVersionRepository;
  private readonly guard: AccessGuard;

  constructor(deps: ModuleVersionServiceDeps) {
    this.versions = deps.versions;
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger, ...(deps.newEventId ? { newEventId: deps.newEventId } : {}) });
  }

  async listVersions(actor: Actor, moduleIdParam: unknown): Promise<VersionRecord[]> {
    await this.guard.authorize(actor, MODULE_VERSION_READ, ACTION_CODE.READ, TARGET_TYPE);
    const moduleId = uuidParam(moduleIdParam);
    if (!moduleId) throw new FoundationError(404, 'MODULE_NOT_FOUND');
    let exists: boolean;
    let versions: VersionRecord[];
    try {
      exists = await this.versions.moduleExists(moduleId);
      versions = exists ? await this.versions.listVersions(moduleId) : [];
    } catch (error) {
      this.guard.logFailure('list versions failed', actor, error);
      throw serviceBusy();
    }
    if (!exists) throw new FoundationError(404, 'MODULE_NOT_FOUND');
    return versions;
  }

  async getVersion(actor: Actor, moduleIdParam: unknown, versionIdParam: unknown): Promise<VersionRecord> {
    await this.guard.authorize(actor, MODULE_VERSION_READ, ACTION_CODE.READ, TARGET_TYPE);
    const moduleId = uuidParam(moduleIdParam);
    const versionId = uuidParam(versionIdParam);
    if (!moduleId || !versionId) throw new FoundationError(404, 'VERSION_NOT_FOUND');
    let version: VersionRecord | null;
    try {
      version = await this.versions.getVersion(moduleId, versionId);
    } catch (error) {
      this.guard.logFailure('get version failed', actor, error);
      throw serviceBusy();
    }
    // Missing, or belonging to another module: the same 404.
    if (!version) throw new FoundationError(404, 'VERSION_NOT_FOUND');
    return version;
  }

  async createVersion(actor: Actor, moduleIdParam: unknown, body: unknown): Promise<VersionRecord> {
    await this.guard.authorize(actor, MODULE_VERSION_CREATE, ACTION_CODE.CREATE, TARGET_TYPE);
    const moduleId = uuidParam(moduleIdParam);
    if (!moduleId) throw new FoundationError(404, 'MODULE_NOT_FOUND');
    const input = parseCreateVersion(body);
    try {
      return await this.versions.createVersion({
        moduleId,
        input,
        audit: (version) => ({
          ...this.guard.auditRecord(actor, ACTION_CODE.CREATE, 'SUCCESS', version.moduleId, TARGET_TYPE, version.versionId, 'CREATED'),
          versionId: version.versionId,
        }),
      });
    } catch (error) {
      if (error instanceof ModuleNotFoundError) throw new FoundationError(404, 'MODULE_NOT_FOUND');
      if (error instanceof VersionExistsError) throw new FoundationError(409, 'VERSION_EXISTS');
      if (error instanceof VersionNotIncreasingError) throw new FoundationError(409, 'VERSION_NOT_INCREASING');
      this.guard.logFailure('create version failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }
}
