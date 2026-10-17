import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { DuplicateModuleKeyError, FoundationError, serviceBusy } from './foundation.errors.js';
import { MODULE_REGISTRY_CREATE, MODULE_REGISTRY_READ } from './foundation.permissions.js';
import type { FoundationRepository, ModuleRecord } from './foundation.repository.js';
import { parseRegisterModule } from './foundation.validation.js';

// Module Registry service (FBE-01A, owner decisions B-4 / B-5 / B-6).
//   401 — no Foundation audit (handled before this service is reached).
//   403 — missing READ/CREATE: B08 DENIED is written; if that write fails the request is still denied and answered 503.
//   POST success — B01 + B07 REGISTER + B08 SUCCESS in one transaction; any failure rolls back everything.
// Authorisation and audit records come from AccessGuard (shared with Module Version, FBE-02A).

export { SOURCE_SERVICE } from './foundation.access.js';
export type { Actor } from './foundation.access.js';

const ACTION_CODE: Record<'READ' | 'CREATE', string> = { READ: 'MODULE_REGISTRY.READ', CREATE: 'MODULE_REGISTRY.CREATE' };

export interface FoundationServiceDeps {
  readonly repository: FoundationRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

export class FoundationService {
  private readonly repository: FoundationRepository;
  private readonly guard: AccessGuard;

  constructor(deps: FoundationServiceDeps) {
    this.repository = deps.repository;
    this.guard = new AccessGuard(deps);
  }

  async listModules(actor: Actor): Promise<ModuleRecord[]> {
    await this.guard.authorize(actor, MODULE_REGISTRY_READ, ACTION_CODE.READ, 'MODULE_REGISTRY');
    try {
      return await this.repository.listModules();
    } catch (error) {
      this.guard.logFailure('list modules failed', actor, error);
      throw serviceBusy();
    }
  }

  async registerModule(actor: Actor, body: unknown): Promise<ModuleRecord> {
    await this.guard.authorize(actor, MODULE_REGISTRY_CREATE, ACTION_CODE.CREATE, 'MODULE_REGISTRY');
    // Validated only after authorisation: callers without CREATE learn nothing about the input rules.
    const input = parseRegisterModule(body);
    try {
      return await this.repository.registerModule({
        input,
        actorAccountId: actor.userAccountId,
        correlationId: actor.requestId,
        audit: (module) => this.guard.auditRecord(actor, ACTION_CODE.CREATE, 'SUCCESS', module.moduleId, 'MODULE', module.moduleId, 'REGISTERED'),
      });
    } catch (error) {
      if (error instanceof DuplicateModuleKeyError) throw new FoundationError(409, 'MODULE_KEY_EXISTS');
      this.guard.logFailure('register module failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }
}
