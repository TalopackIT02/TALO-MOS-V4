import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { FoundationError, serviceBusy } from './foundation.errors.js';
import { buildMenu, menuCandidates } from './foundation.navigation.js';
import type { MenuFunction, MenuNode, NavigationItem } from './foundation.navigation.js';
import {
  DEVELOP_ANCHOR_ORDER, developAreaId, draftSchema, isDeveloperFunction, planDraft, previewItems, readLayout, validateDraft,
} from './foundation.navigation.builder.js';
import type { BuilderIssue, Draft, FunctionFacts, Layout } from './foundation.navigation.builder.js';
import { NavigationConflictError, NavigationNotFoundError, NavigationReferenceError } from './foundation.navigation.repository.js';
import type { MenuSources, NavigationRepository } from './foundation.navigation.repository.js';
import { NAVIGATION_MANAGE, evaluateAccess } from './foundation.permissions.js';
import type { FoundationRepository } from './foundation.repository.js';
import { uuidParam } from './foundation.versions.validation.js';

// FBE-06 — Navigation service (owner decisions N1–N10) + Navigation Builder (owner decisions of 22/10/2026).
//   POST / PATCH: AccessGuard first (foundation.navigation.manage; DENIED → B08 DENIED), then input, then the transaction
//   (write + B08 SUCCESS together; any failure → 503, nothing kept). PATCH changes menuTitle / sortOrder / isVisible only.
//   GET: any authenticated session; the menu of THIS actor. A Function is offered only when its module is ENABLED with
//   one ACTIVE version, the stored MIC is intact, MIC-04 gives exactly one route, and at least one of its Actions passes
//   the shared evaluateAccess() on the K05 permission definition AND the MIC-07 minimum assurance. Visibility in B09 is
//   never a grant; the menu grants no API access (N10). Developer Functions only below DEVELOP.
//   Builder (foundation.navigation.manage): layout (every row, hidden ones included), Function inventory, preview of a
//   draft for THIS actor (nothing written), apply of a whole draft (revision check, validation of the final tree, INSERT /
//   UPDATE of the allowed columns, one B08 row — all or nothing).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The sort order of the DEVELOP system anchor is reserved (never set through the API).
const INT32 = z.number().int().min(-2147483648).max(2147483647).refine((n) => n !== DEVELOP_ANCHOR_ORDER);
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
  NAVIGATION_CONFLICT: 'Cấu hình điều hướng đã được thay đổi từ khi bạn mở. Tải lại để xem cấu hình mới nhất; bản nháp chưa được lưu.',
  NAVIGATION_LAYOUT_INVALID: 'Cấu hình điều hướng không hợp lệ; không có thay đổi nào được lưu.',
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

class LayoutInvalidError extends Error {
  constructor(readonly issues: readonly BuilderIssue[]) {
    super('navigation layout invalid');
    this.name = 'LayoutInvalidError';
  }
}

const ACTION_CODE = {
  CREATE: 'NAVIGATION.CREATE', UPDATE: 'NAVIGATION.UPDATE', BUILDER_READ: 'NAVIGATION.BUILDER.READ', LAYOUT_APPLY: 'NAVIGATION.LAYOUT.APPLY',
} as const;
const DENIED_TARGET = 'NAVIGATION';
const TARGET_TYPE = 'NAVIGATION_ITEM';
const LAYOUT_TARGET = 'NAVIGATION_LAYOUT';

export type InventoryReason = 'MODULE_DISABLED' | 'NO_ACTIVE_VERSION' | 'NO_ROUTE_OR_PERMISSION';

export interface InventoryFunction {
  readonly functionId: string;
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly moduleName: string;
  readonly functionKey: string;
  readonly displayName: string;
  readonly assignable: boolean;
  readonly reason: InventoryReason | null;
  readonly developer: boolean;
}

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

const issueFields = (issues: readonly BuilderIssue[]) => [...new Set(issues.map((i) => `${i.code}:${i.ref}`))].slice(0, 100);

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
      return buildMenu(sources.items, await this.allowedFunctions(actor, sources), developAreaId(sources.items));
    } catch (error) {
      this.guard.logFailure('navigation menu failed', actor, error);
      throw serviceBusy();
    }
  }

  // ------------------------------------------------------------------------------------------------- Navigation Builder
  async layout(actor: Actor): Promise<Layout> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.BUILDER_READ, DENIED_TARGET);
    try {
      return readLayout(await this.navigation.layoutItems());
    } catch (error) {
      this.guard.logFailure('navigation layout read failed', actor, error);
      throw serviceBusy();
    }
  }

  async inventory(actor: Actor): Promise<InventoryFunction[]> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.BUILDER_READ, DENIED_TARGET);
    try {
      return await this.inventoryFunctions();
    } catch (error) {
      this.guard.logFailure('navigation inventory read failed', actor, error);
      throw serviceBusy();
    }
  }

  // The menu THIS actor would see with the draft (nothing written). Same evaluation as GET /foundation/navigation.
  async preview(actor: Actor, body: unknown): Promise<MenuNode[]> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.BUILDER_READ, DENIED_TARGET);
    const draft = this.parseDraft(body);
    try {
      const sources = await this.navigation.menuSources();
      const facts = await this.functionFacts();
      const issues = validateDraft(draft, sources.items, facts);
      if (issues.length > 0) throw new LayoutInvalidError(issues);
      const items = previewItems(sources.items, planDraft(draft, sources.items, facts));
      return buildMenu(items, await this.allowedFunctions(actor, sources), developAreaId(items));
    } catch (error) {
      if (error instanceof LayoutInvalidError) throw new NavigationError(422, 'NAVIGATION_LAYOUT_INVALID', issueFields(error.issues));
      this.guard.logFailure('navigation preview failed', actor, error);
      throw serviceBusy();
    }
  }

  async apply(actor: Actor, body: unknown): Promise<Layout> {
    await this.guard.authorize(actor, NAVIGATION_MANAGE, ACTION_CODE.LAYOUT_APPLY, DENIED_TARGET);
    const draft = this.parseDraft(body);
    try {
      const facts = await this.functionFacts();
      const items = await this.navigation.applyLayout(draft.revision, (stored) => {
        const issues = validateDraft(draft, stored, facts);
        if (issues.length > 0) throw new LayoutInvalidError(issues);
        return planDraft(draft, stored, facts);
      }, (applied) => {
        const base = this.guard.auditRecord(actor, ACTION_CODE.LAYOUT_APPLY, 'SUCCESS', null, LAYOUT_TARGET, null, 'APPLIED');
        return {
          ...base,
          metadata: {
            ...base.metadata, revisionBefore: draft.revision, inserted: applied.inserted.length, updated: applied.updated.length, relinked: applied.relinked,
            insertedIds: applied.inserted.slice(0, 50).join(','), updatedIds: applied.updated.slice(0, 50).join(','),
          },
        };
      });
      return readLayout(items);
    } catch (error) {
      if (error instanceof LayoutInvalidError) throw new NavigationError(422, 'NAVIGATION_LAYOUT_INVALID', issueFields(error.issues));
      if (error instanceof NavigationConflictError) throw new NavigationError(409, 'NAVIGATION_CONFLICT');
      this.guard.logFailure('navigation layout apply failed (rolled back)', actor, error);
      throw serviceBusy();
    }
  }

  private parseDraft(body: unknown): Draft {
    const parsed = draftSchema.safeParse(body ?? null);
    if (!parsed.success) throw invalid(parsed.error);
    return parsed.data;
  }

  // Functions the actor may open (module ENABLED + ACTIVE + intact MIC + one MIC-04 route + one Action allowed by IAM).
  private async allowedFunctions(actor: Actor, sources: MenuSources): Promise<Map<string, MenuFunction>> {
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
        if (permitted) {
          allowed.set(candidate.functionId, { moduleId: candidate.moduleId, routePath: candidate.routePath, screenKey: candidate.screenKey, developer: candidate.developer });
        }
      }
    }
    return allowed;
  }

  private async inventoryFunctions(): Promise<InventoryFunction[]> {
    const sources = await this.navigation.menuSources();
    const offered = new Set<string>();
    for (const version of sources.versions) for (const c of menuCandidates(version, sources.functions)) offered.add(c.functionId);
    return (await this.navigation.inventory()).map((r) => {
      const reason: InventoryReason | null = !r.moduleEnabled ? 'MODULE_DISABLED' : !r.hasActiveVersion ? 'NO_ACTIVE_VERSION'
        : offered.has(r.functionId) ? null : 'NO_ROUTE_OR_PERMISSION';
      return {
        functionId: r.functionId, moduleId: r.moduleId, moduleKey: r.moduleKey, moduleName: r.moduleName, functionKey: r.functionKey,
        displayName: r.displayName ?? r.functionKey, assignable: reason === null, reason, developer: isDeveloperFunction(r.moduleKey, r.functionKey),
      };
    });
  }

  private async functionFacts(): Promise<Map<string, FunctionFacts>> {
    return new Map((await this.inventoryFunctions()).map((f) => [f.functionId, {
      functionId: f.functionId, moduleId: f.moduleId, moduleKey: f.moduleKey, functionKey: f.functionKey, assignable: f.assignable, developer: f.developer,
    }]));
  }

  private audit(actor: Actor, actionCode: string, item: NavigationItem, reason: string, fields: string) {
    const base = this.guard.auditRecord(actor, actionCode, 'SUCCESS', item.moduleId, TARGET_TYPE, item.navigationId, reason);
    return { ...base, metadata: { ...base.metadata, fields } };
  }
}
