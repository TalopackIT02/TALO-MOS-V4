import { z } from 'zod';
import type { ModuleActor as Actor, ModuleHost, ModulePermission as PermissionRef } from './host.js';
import { deploymentTiers, evaluateChecks, packageStates, summarize } from './system-controller-center.checks.js';
import type { CheckResult, CheckStatus, DeploymentFacts, IamFact, PackageState } from './system-controller-center.checks.js';
import { SYSTEM_CONTROLLER_CENTER_ACTION, SYSTEM_CONTROLLER_CENTER_DENIED_TARGET } from './system-controller-center.permissions.js';
import type { SystemTestBinding } from './system-controller-center.permissions.js';
import type { FleetCounts, FleetModule, SystemTestRepository } from './system-controller-center.repository.js';
import { parseRegressionResults } from './system-controller-center.results.js';
import type { RegressionRead } from './system-controller-center.results.js';

export const SYSTEM_CONTROLLER_CENTER_MESSAGES = {
  MODULE_UNAVAILABLE: 'Module System Controller chưa được bật hoặc không có đúng một phiên bản ACTIVE.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
} as const;
export type SystemTestErrorCode = keyof typeof SYSTEM_CONTROLLER_CENTER_MESSAGES;
export class SystemTestError extends Error {
  readonly fields: readonly string[] | undefined;
  constructor(readonly status: number, readonly code: SystemTestErrorCode, fields?: readonly string[]) {
    super(SYSTEM_CONTROLLER_CENTER_MESSAGES[code]); this.name = 'SystemTestError'; this.fields = fields;
  }
}

export interface QuickCheckRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly moduleKey: string;
  readonly results: readonly CheckResult[];
  readonly summary: Record<CheckStatus, number>;
  // Bounded list for the browser (SCC 0.1.3: non-fixture modules + lifecycle anomalies of the whole registry, ≤ 200).
  readonly fleet: readonly FleetModule[];
  // true when the list above holds every non-fixture module AND every lifecycle anomaly (the counts are always complete).
  readonly fleetComplete: boolean;
  // SCC 0.1.3 (additive): whole-registry counts; null when the registry could not be read.
  readonly fleetSummary: FleetSummaryView | null;
}
export interface FleetSummaryView {
  readonly scope: 'FULL_REGISTRY';
  readonly all: FleetCounts;
  readonly fixtureCandidates: FleetCounts;
  readonly versionStatuses: Readonly<Record<string, number>>;
  readonly tiers: { readonly registered: number; readonly active: number; readonly installed: number | null; readonly loaded: number | null; readonly serving: number | null };
  readonly packages: readonly { readonly moduleKey: string; readonly packageVersion: string; readonly state: PackageState; readonly activeVersion: string | null }[] | null;
}
export interface ResultsView {
  readonly quickCheck: QuickCheckRun | null;
  readonly regression: RegressionRead;
  readonly runner: { readonly apiExecution: false; readonly mode: 'CLI' };
}
export interface SystemTestServiceDeps {
  readonly host: Omit<ModuleHost, 'session' | 'readOnly'>;
  readonly repository: SystemTestRepository;
  readonly binding: SystemTestBinding;
  readonly now?: () => Date;
}
const emptyBody = z.strictObject({});

export class SystemTestService {
  private readonly host: SystemTestServiceDeps['host'];
  private readonly repository: SystemTestRepository;
  private readonly binding: SystemTestBinding;
  private readonly now: () => Date;
  // Avoid leaking IAM evaluation of one user to a different Test Runner account.
  private readonly recent = new Map<string, QuickCheckRun>();

  constructor(deps: SystemTestServiceDeps) {
    this.host = deps.host; this.repository = deps.repository; this.binding = deps.binding;
    this.now = deps.now ?? (() => new Date());
  }

  private async enter(actor: Actor, permission: PermissionRef, actionCode: string): Promise<void> {
    await this.host.authorize(actor, permission, actionCode, SYSTEM_CONTROLLER_CENTER_DENIED_TARGET);
    let state;
    try { state = await this.host.lifecycle(this.binding.moduleKey); }
    catch (error) { this.logFailure('system-controller lifecycle check failed', actor, error); throw new SystemTestError(503, 'SERVICE_BUSY'); }
    if (!state || !state.isEnabled || state.activeVersions !== 1) throw new SystemTestError(503, 'MODULE_UNAVAILABLE');
  }

  async health(actor: Actor): Promise<{ moduleKey: string; enabled: true; activeVersions: 1; checkedAt: string }> {
    await this.enter(actor, this.binding.diagnosticsRead, SYSTEM_CONTROLLER_CENTER_ACTION.DIAGNOSTICS_READ);
    return { moduleKey: this.binding.moduleKey, enabled: true, activeVersions: 1, checkedAt: this.now().toISOString() };
  }

  async runChecks(actor: Actor, body: unknown): Promise<QuickCheckRun> {
    await this.enter(actor, this.binding.diagnosticsRead, SYSTEM_CONTROLLER_CENTER_ACTION.DIAGNOSTICS_READ);
    if (!emptyBody.safeParse(body ?? null).success) throw new SystemTestError(400, 'VALIDATION_ERROR', ['body']);
    const start = this.now();
    const iam: IamFact[] = [];
    for (const [functionKey, permission] of [['DIAGNOSTICS', this.binding.diagnosticsRead], ['TEST_RUNNER', this.binding.testRunnerExecute]] as const) {
      try { iam.push({ functionKey, permissionCode: permission.permissionCode, decision: await this.host.evaluate(actor, permission) }); }
      catch (error) { iam.push({ functionKey, permissionCode: permission.permissionCode, decision: { error } }); }
    }
    const snapshot = await this.repository.diagnostics(this.binding.moduleKey).catch((error: unknown) => ({ error }));
    const operations = await this.repository.operations().catch((error: unknown) => ({ error }));
    const menuRoutes = await this.host.menuRoutes(actor).catch((error: unknown) => ({ error }));
    const active = 'error' in snapshot ? null : snapshot.activeVersions.length === 1 ? snapshot.activeVersions[0] : null;
    const manifest = active ? this.host.inspectManifest(active.manifestJson, active.manifestHash) : null;
    const runner = iam.find((i) => i.functionKey === 'TEST_RUNNER')?.decision;
    let regression: RegressionRead | null = null;
    if (runner && 'allowed' in runner && runner.allowed) {
      try { regression = parseRegressionResults(await this.host.regressionResults()); }
      catch { regression = { state: 'INVALID' }; }
    }
    // SCC 0.1.3: deployment view only when the Host offers the optional capability (never assumed, never inferred).
    let deployment: DeploymentFacts | { error: unknown } | null = null;
    const deploymentState = this.host.deploymentState;
    if (typeof deploymentState === 'function') {
      try {
        const state = await deploymentState.call(this.host);
        deployment = { state, registry: await this.repository.deploymentRegistry(state.packages.map((p) => p.moduleKey)) };
      } catch (error) { deployment = { error }; }
    }
    const results = evaluateChecks({ moduleKey: this.binding.moduleKey, assuranceLevel: actor.assuranceLevel,
      snapshot, iam, menuRoutes, manifest, operations, regression, deployment }, (e) => this.host.sqlstate(e));
    for (const r of results) if (r.status === 'FAIL') this.host.logger.warn('system-controller critical check',
      { requestId: actor.requestId, check: r.key, status: r.status });
    const end = this.now();
    const fleetValue = 'error' in operations || operations.fleet.state === 'UNAVAILABLE' ? null : operations.fleet.value;
    // Browser list: every non-fixture module, then the lifecycle anomalies (fixture candidates included), de-duplicated.
    const combined = fleetValue ? [...fleetValue.modules, ...fleetValue.anomalies.filter((m) => !fleetValue.modules.some((x) => x.moduleKey === m.moduleKey))] : [];
    const fleet = combined.slice(0, 200);
    const facts = deployment !== null && !('error' in deployment) ? deployment : null;
    const tiers = fleetValue ? deploymentTiers(fleetValue.all, facts) : null;
    const fleetSummary: FleetSummaryView | null = fleetValue && tiers ? {
      scope: 'FULL_REGISTRY', all: fleetValue.all, fixtureCandidates: fleetValue.fixtureCandidates, versionStatuses: fleetValue.versionStatuses,
      tiers,
      packages: facts ? packageStates(facts) : null,
    } : null;
    const run: QuickCheckRun = {
      runId: actor.requestId, startedAt: start.toISOString(), finishedAt: end.toISOString(),
      durationMs: Math.max(0, end.getTime() - start.getTime()), moduleKey: this.binding.moduleKey,
      results, summary: summarize(results), fleet,
      fleetComplete: fleetValue !== null && !fleetValue.anomaliesTruncated && !fleetValue.modulesTruncated && combined.length <= 200,
      fleetSummary,
    };
    if (this.recent.size >= 100 && !this.recent.has(actor.userAccountId)) this.recent.delete(this.recent.keys().next().value ?? '');
    this.recent.set(actor.userAccountId, run);
    return run;
  }

  async results(actor: Actor): Promise<ResultsView> {
    await this.enter(actor, this.binding.testRunnerExecute, SYSTEM_CONTROLLER_CENTER_ACTION.TEST_RUNNER_EXECUTE);
    let regression: RegressionRead;
    try { regression = parseRegressionResults(await this.host.regressionResults()); }
    catch { regression = { state: 'INVALID' }; }
    return { quickCheck: this.recent.get(actor.userAccountId) ?? null, regression, runner: { apiExecution: false, mode: 'CLI' } };
  }

  private logFailure(message: string, actor: Actor, error: unknown): void {
    this.host.logger.error(message, { requestId: actor.requestId,
      errorName: error instanceof Error ? error.name : typeof error, sqlstate: this.host.sqlstate(error) });
  }
}
