import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { AccessGuard } from '../foundation/foundation.access.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { MenuNode } from '../foundation/foundation.navigation.js';
import type { NavigationService } from '../foundation/foundation.navigation.service.js';
import { evaluateAccess } from '../foundation/foundation.permissions.js';
import type { PermissionRef } from '../foundation/foundation.permissions.js';
import type { FoundationRepository } from '../foundation/foundation.repository.js';
import { evaluateChecks, summarize } from './system-test.checks.js';
import type { CheckResult, CheckStatus, IamFact } from './system-test.checks.js';
import { SYSTEM_TEST_ACTION, SYSTEM_TEST_DENIED_TARGET } from './system-test.permissions.js';
import type { SystemTestBinding } from './system-test.permissions.js';
import { TableNotReadableError } from './system-test.repository.js';
import type { SystemTestRepository } from './system-test.repository.js';
import { readRegressionResults } from './system-test.results.js';
import type { RegressionRead } from './system-test.results.js';
import { PAGE_MAX, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, VIEWER_TABLES, viewerTable } from './system-test.tables.js';

// MOD-TEST-01 — SYSTEM_TEST module API. Every operation: (1) AccessGuard on the operation's K05 permission (DENIED →
// B08 + 403, lookup failure → 503), (2) lifecycle gate — the module must be ENABLED with exactly one ACTIVE version,
// otherwise 503 MODULE_UNAVAILABLE and nothing is processed (closes the FBE-07 gap: a module API answering after
// DISABLE / RETIRE), (3) the read itself. Nothing here writes to the database; Foundation Lifecycle is not changed.

export const SYSTEM_TEST_MESSAGES = {
  MODULE_UNAVAILABLE: 'Module System Test chưa được bật hoặc không có phiên bản ACTIVE.',
  TABLE_NOT_FOUND: 'Bảng không nằm trong danh sách được phép xem.',
  TABLE_NOT_READABLE: 'Không có quyền xem bảng này.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
} as const;

export type SystemTestErrorCode = keyof typeof SYSTEM_TEST_MESSAGES;

export class SystemTestError extends Error {
  readonly status: number;
  readonly code: SystemTestErrorCode;
  readonly fields: readonly string[] | undefined;

  constructor(status: number, code: SystemTestErrorCode, fields?: readonly string[]) {
    super(SYSTEM_TEST_MESSAGES[code]);
    this.name = 'SystemTestError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface QuickCheckRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly moduleKey: string;
  readonly results: readonly CheckResult[];
  readonly summary: Record<CheckStatus, number>;
}

export interface TableInfo {
  readonly tableKey: string;
  readonly label: string;
  readonly schema: string;
  readonly table: string;
  readonly readable: boolean;
  readonly columns: readonly string[];
  readonly hiddenColumns: readonly string[];
}

export interface TableRows {
  readonly table: TableInfo;
  readonly orderBy: readonly string[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalRows: number;
  readonly rows: readonly (readonly (string | null)[])[];
}

export interface ResultsView {
  readonly quickCheck: QuickCheckRun | null;
  readonly regression: RegressionRead;
  readonly runner: { readonly apiExecution: false; readonly mode: 'CLI' };
}

export interface SystemTestServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly repository: SystemTestRepository;
  readonly navigation: Pick<NavigationService, 'menu'>;
  readonly logger: Logger;
  readonly binding: SystemTestBinding;
  readonly resultsFile: string;
  readonly now?: () => Date;
}

const emptyBody = z.strictObject({});
const TABLE_KEY = /^B(0[1-9]|1[0-4])$/;
const intParam = (min: number, max: number, fallback: number) =>
  z.union([z.undefined(), z.string().regex(/^[0-9]{1,6}$/)]).transform((v) => (v === undefined ? fallback : Number(v))).pipe(z.number().int().min(min).max(max));
const pagingSchema = z.object({ page: intParam(1, PAGE_MAX, 1), pageSize: intParam(1, PAGE_SIZE_MAX, PAGE_SIZE_DEFAULT) });

function routesOf(nodes: readonly MenuNode[]): string[] {
  return nodes.flatMap((n) => [...(n.routePath === null ? [] : [n.routePath]), ...routesOf(n.children)]);
}

export class SystemTestService {
  private readonly guard: AccessGuard;
  private readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  private readonly repository: SystemTestRepository;
  private readonly navigation: Pick<NavigationService, 'menu'>;
  private readonly logger: Logger;
  private readonly binding: SystemTestBinding;
  private readonly resultsFile: string;
  private readonly now: () => Date;
  private lastQuickCheck: QuickCheckRun | null = null;

  constructor(deps: SystemTestServiceDeps) {
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger });
    this.access = deps.access;
    this.repository = deps.repository;
    this.navigation = deps.navigation;
    this.logger = deps.logger;
    this.binding = deps.binding;
    this.resultsFile = deps.resultsFile;
    this.now = deps.now ?? (() => new Date());
  }

  // (1) IAM, then (2) lifecycle. Any lookup failure → 503 (fail closed).
  private async enter(actor: Actor, permission: PermissionRef, actionCode: string): Promise<void> {
    await this.guard.authorize(actor, permission, actionCode, SYSTEM_TEST_DENIED_TARGET);
    let state;
    try {
      state = await this.repository.moduleState(this.binding.moduleKey);
    } catch (error) {
      this.guard.logFailure('system-test lifecycle check failed', actor, error);
      throw new SystemTestError(503, 'SERVICE_BUSY');
    }
    if (state === null || !state.isEnabled || state.activeVersions !== 1) throw new SystemTestError(503, 'MODULE_UNAVAILABLE');
  }

  async health(actor: Actor): Promise<{ moduleKey: string; enabled: true; activeVersions: 1; checkedAt: string }> {
    await this.enter(actor, this.binding.diagnosticsRead, SYSTEM_TEST_ACTION.DIAGNOSTICS_READ);
    return { moduleKey: this.binding.moduleKey, enabled: true, activeVersions: 1, checkedAt: this.now().toISOString() };
  }

  async runChecks(actor: Actor, body: unknown): Promise<QuickCheckRun> {
    await this.enter(actor, this.binding.diagnosticsRead, SYSTEM_TEST_ACTION.DIAGNOSTICS_READ);
    if (!emptyBody.safeParse(body ?? null).success) throw new SystemTestError(400, 'VALIDATION_ERROR', ['body']);
    const startedAt = this.now().toISOString();
    const b = this.binding;
    const iam: IamFact[] = [];
    for (const [functionKey, permission] of [['DIAGNOSTICS', b.diagnosticsRead], ['DATA_VIEWER', b.dataViewerRead], ['TEST_RUNNER', b.testRunnerExecute]] as const) {
      try {
        iam.push({ functionKey, permissionCode: permission.permissionCode, decision: evaluateAccess(await this.access.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel) });
      } catch (error) {
        iam.push({ functionKey, permissionCode: permission.permissionCode, decision: { error } });
      }
    }
    const snapshot = await this.repository.diagnostics(b.moduleKey).catch((error: unknown) => ({ error }));
    const menuRoutes = await this.navigation.menu(actor).then(routesOf, (error: unknown) => ({ error }));
    const results = evaluateChecks({ moduleKey: b.moduleKey, assuranceLevel: actor.assuranceLevel, snapshot, iam, menuRoutes });
    for (const r of results) if (r.status === 'FAIL' || r.status === 'UNAVAILABLE') this.logger.warn('system-test check not passed', { requestId: actor.requestId, check: r.key, status: r.status });
    const run: QuickCheckRun = {
      runId: actor.requestId, startedAt, finishedAt: this.now().toISOString(), moduleKey: b.moduleKey, results, summary: summarize(results),
    };
    this.lastQuickCheck = run;
    return run;
  }

  async tables(actor: Actor): Promise<TableInfo[]> {
    await this.enter(actor, this.binding.dataViewerRead, SYSTEM_TEST_ACTION.DATA_VIEWER_READ);
    let readable;
    try {
      readable = await this.repository.readableTables(VIEWER_TABLES);
    } catch (error) {
      this.guard.logFailure('system-test table privileges failed', actor, error);
      throw new SystemTestError(503, 'SERVICE_BUSY');
    }
    return VIEWER_TABLES.map((t) => ({
      tableKey: t.tableKey, label: t.label, schema: t.schema, table: t.table, readable: readable.get(t.tableKey) === true, columns: t.columns, hiddenColumns: t.hiddenColumns,
    }));
  }

  async rows(actor: Actor, tableKeyParam: unknown, query: unknown): Promise<TableRows> {
    await this.enter(actor, this.binding.dataViewerRead, SYSTEM_TEST_ACTION.DATA_VIEWER_READ);
    const table = typeof tableKeyParam === 'string' && TABLE_KEY.test(tableKeyParam) ? viewerTable(tableKeyParam) : undefined;
    if (table === undefined) throw new SystemTestError(404, 'TABLE_NOT_FOUND');
    const paging = pagingSchema.safeParse(typeof query === 'object' && query !== null ? { page: Reflect.get(query, 'page'), pageSize: Reflect.get(query, 'pageSize') } : {});
    if (!paging.success) throw new SystemTestError(400, 'VALIDATION_ERROR', [...new Set(paging.error.issues.map((i) => String(i.path[0] ?? 'query')))]);
    const { page, pageSize } = paging.data;
    let result;
    try {
      result = await this.repository.tablePage(table, pageSize, (page - 1) * pageSize);
    } catch (error) {
      if (error instanceof TableNotReadableError || sqlstateOf(error) === '42501') throw new SystemTestError(403, 'TABLE_NOT_READABLE');
      this.guard.logFailure('system-test table read failed', actor, error);
      throw new SystemTestError(503, 'SERVICE_BUSY');
    }
    return {
      table: { tableKey: table.tableKey, label: table.label, schema: table.schema, table: table.table, readable: true, columns: table.columns, hiddenColumns: table.hiddenColumns },
      orderBy: table.orderBy, page, pageSize, totalRows: result.totalRows, rows: result.rows,
    };
  }

  async results(actor: Actor): Promise<ResultsView> {
    await this.enter(actor, this.binding.testRunnerExecute, SYSTEM_TEST_ACTION.TEST_RUNNER_EXECUTE);
    return { quickCheck: this.lastQuickCheck, regression: await readRegressionResults(this.resultsFile), runner: { apiExecution: false, mode: 'CLI' } };
  }
}
