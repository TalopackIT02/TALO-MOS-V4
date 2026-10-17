import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { FoundationError, serviceBusy } from './foundation.errors.js';
import { buildMenu, menuCandidates } from './foundation.navigation.js';
import type { MenuFunction, MenuNode, NavigationItem } from './foundation.navigation.js';
import { NavigationNotFoundError, NavigationReferenceError } from './foundation.navigation.repository.js';
import type { NavigationRepository } from './foundation.navigation.repository.js';
import { NAVIGATION_MANAGE, evaluateAccess } from './foundation.permissions.js';
import type { FoundationRepository } from './foundation.repository.js';
import { uuidParam } from './foundation.versions.validation.js';

// FBE-06 — Navigation service (owner decisions N1–N10).
//   POST / PATCH: AccessGuard first (foundation.navigation.manage; DENIED → B08 DENIED), then input, then the transaction
//   (write + B08 SUCCESS together; any failure → 503, nothing kept). PATCH changes menuTitle / sortOrder / isVisible only.
//   GET: any authenticated session; the menu of THIS actor. A Function is offered only when its module is ENABLED with
//   one ACTIVE version, the stored MIC is intact, MIC-04 gives exactly one route, and at least one of its Actions passes
//   the shared evaluateAccess() on the K05 permission definition AND the MIC-07 minimum assurance. Visibility in B09 is
//   never a grant; the menu grants no API access (N10).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT32 = z.number().int().min(-2147483648).max(2147483647);
const title = z.string().max(150).refine((s) => s.trim() !== '');
const ref = z.string().regex(UUID).nullable().optional();

const createSchema = z.strictObject({
  parentId: ref, moduleId: ref, functionId: ref, menuTitle: title, sortOrder: INT32.optional(), isVisible: z.boolean().optional(),
});
const patchSchema = z.strictObject({ menuTitle: title.optional(), sortOrder: INT32.optional(), isVisible: z.boolean().optional() })
  .refine((b) => b.menuTitle !== undefined || b.sortOrder !== undefined || b.isVisible !== undefined);

export const NAVIGATION_MESSAGES = {
  NAVIGATION_NOT_FOUND: 'Không tìm thấy mục menu.',
  NAVIGATION_REFERENCE_INVALID: 'Module, Function hoặc menu cha không hợp lệ cho mục menu này.',
} as const;
export type NavigationErrorCode = keyof typeof NAVIGATION_MESSAGES;

export class NavigationError extends Error {
  readonly status: number;
  readonly code: NavigationErrorCode;
  readonly fields: readonly string[] | undefined;

  constructor(status: number, code: NavigationErrorCode, fields?: readonly string[]) {
    super(NAVIGATION_MESSAGES[code]);
    this.name = 'NavigationError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const ACTION_CODE = { CREATE: 'NAVIGATION.CREATE', UPDATE: 'NAVIGATION.UPDATE' } as const;
const DENIED_TARGET = 'NAVIGATION';
const TARGET_TYPE = 'NAVIGATION_ITEM';

export interface NavigationServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly navigation: NavigationRepository;
  readonly logger: Logger;
  readonly newEventId?: () => string;
}

function invalid(error: z.ZodError): FoundationError {
  const fields = error.issues.some((i) => i.code === 'unrecognized_keys') ? ['UNKNOWN_FIELD'] : [...new Set(error.issues.map((i) => String(i.path[0] ?? 'body')))];
  return new FoundationError(400, 'VALIDATION_ERROR', { details: { fields } });
}

export class NavigationService {
  private readonly navigation: NavigationRepository;
  private readonly guard: AccessGuard;

  constructor(deps: NavigationServiceDeps) {
    this.navigation = deps.navigation;
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger, ...(deps.newEventId ? { newEventId: deps.newEventId } : {}) });
  }

  async createItem(actor: Actor, body: unknown): Promise<NavigationItem> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.CREATE, DENIED_TARGET);
    const parsed = createSchema.safeParse(body ?? null);
    if (!parsed.success) throw invalid(parsed.error);
    const b = parsed.data;
    const input = {
      parentId: b.parentId?.toLowerCase() ?? null, moduleId: b.moduleId?.toLowerCase() ?? null, functionId: b.functionId?.toLowerCase() ?? null,
      menuTitle: b.menuTitle, sortOrder: b.sortOrder ?? null, isVisible: b.isVisible ?? null,
    };
    try {
      return await this.navigation.createItem(input, (item) => this.audit(actor, ACTION_CODE.CREATE, item, 'CREATED', 'parentId,moduleId,functionId,menuTitle,sortOrder,isVisible'));
    } catch (error) {
      if (error instanceof NavigationReferenceError) throw new NavigationError(422, 'NAVIGATION_REFERENCE_INVALID', [error.field]);
      this.guard.logFailure('create navigation item failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }

  async updateItem(actor: Actor, navigationIdParam: unknown, body: unknown): Promise<NavigationItem> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.UPDATE, DENIED_TARGET);
    const navigationId = uuidParam(navigationIdParam);
    if (!navigationId) throw new NavigationError(404, 'NAVIGATION_NOT_FOUND');
    const parsed = patchSchema.safeParse(body ?? null);
    if (!parsed.success) throw invalid(parsed.error);
    const b = parsed.data;
    const fields = [b.menuTitle !== undefined ? 'menuTitle' : '', b.sortOrder !== undefined ? 'sortOrder' : '', b.isVisible !== undefined ? 'isVisible' : ''].filter((f) => f !== '');
    try {
      return await this.navigation.updateItem(
        { navigationId, menuTitle: b.menuTitle ?? null, sortOrder: b.sortOrder ?? null, isVisible: b.isVisible ?? null },
        (item) => this.audit(actor, ACTION_CODE.UPDATE, item, 'UPDATED', fields.join(',')),
      );
    } catch (error) {
      if (error instanceof NavigationNotFoundError) throw new NavigationError(404, 'NAVIGATION_NOT_FOUND');
      this.guard.logFailure('update navigation item failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }

  // N5–N7: the permission-filtered menu of the actor. Any read / evaluation failure → 503 (never a partial menu).
  async menu(actor: Actor): Promise<MenuNode[]> {
    try {
      const sources = await this.navigation.menuSources();
      const allowed = new Map<string, MenuFunction>();
      for (const version of sources.versions) {
        for (const candidate of menuCandidates(version, sources.functions)) {
          let permitted = false;
          for (const req of candidate.requirements) {
            if (actor.assuranceLevel < req.minimumAssuranceLevel) continue; // MIC-07 assurance
            const facts = await this.navigation.accessFactsByTriple(actor.userAccountId, req.moduleCode, req.resourceCode, req.operation);
            if (evaluateAccess(facts, actor.assuranceLevel).allowed) {
              permitted = true;
              break;
            }
          }
          if (permitted) allowed.set(candidate.functionId, { moduleId: candidate.moduleId, routePath: candidate.routePath, screenKey: candidate.screenKey });
        }
      }
      return buildMenu(sources.items, allowed);
    } catch (error) {
      this.guard.logFailure('navigation menu failed', actor, error);
      throw serviceBusy();
    }
  }

  private audit(actor: Actor, actionCode: string, item: NavigationItem, reason: string, fields: string) {
    const base = this.guard.auditRecord(actor, actionCode, 'SUCCESS', item.moduleId, TARGET_TYPE, item.navigationId, reason);
    return { ...base, metadata: { ...base.metadata, fields } };
  }
}
