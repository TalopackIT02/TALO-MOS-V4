import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import type { Actor } from '../../../src/modules/foundation/foundation.access.js';
import { canonicalDigest } from '../../../src/modules/foundation/foundation.json.js';
import { validateMic } from '../../../src/modules/foundation/foundation.mic.js';
import type { MenuNode } from '../../../src/modules/foundation/foundation.navigation.js';
import type { AccessFacts, PermissionRef } from '../../../src/modules/foundation/foundation.permissions.js';
import type { AuditRecord } from '../../../src/modules/foundation/foundation.repository.js';
import { CHECK_COMPONENTS, evaluateChecks } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.checks.js';
import type { CheckFacts, IamFact } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.checks.js';
import { systemTestMic } from '../../../src/installed-modules/SYSTEM_TEST/mic/system-test.mic.js';
import { SYSTEM_TEST_ACTION, SYSTEM_TEST_BINDING } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.permissions.js';
import { SYSTEM_TEST_SQL } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.repository.js';
import type { DiagnosticsSnapshot, ModuleState, OperationsSnapshot, SystemTestRepository } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.repository.js';
import { REGRESSION_FORMAT, parseRegressionResults } from '../../../src/installed-modules/SYSTEM_TEST/backend/system-test.results.js';
import * as moduleEntry from '../../../src/installed-modules/SYSTEM_TEST/backend/index.js';
import { createModule } from '../../../src/installed-modules/SYSTEM_TEST/backend/index.js';
import { SUITES, redact, testCounts } from '../../system-test/regression.support.js';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../foundation/fakes.js';
import { HOST_SQL, createHostCapabilities } from '../../../src/module-host/capabilities.js';
import type { HostCapabilities } from '../../../src/module-host/contract.js';
import { sqlstateOf } from '../../../src/modules/auth/sqlstate.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';

// MOD-TEST-01 — SYSTEM_TEST module, unit / mock level (no database). The DB level is test/integration/system-test.
// MOD-TEST-02: Host compatibility test of the package (installed copy) mounted through the REAL Host capabilities
// (session, AccessGuard, evaluateAccess, MIC inspection) over fakes; only lifecycle and the module repository are faked.
// SYSTEM_TEST 1.1.1 (migration of the 1.0.x suite, HOST-TEST-MIGRATION.md): two Functions (DIAGNOSTICS, TEST_RUNNER), three
// APIs, 22 checks; the Data Viewer (Function, API, MIC, source) is gone — its retired routes must answer 404.

const ACCOUNT = '30000000-0000-4000-8000-000000000001';
const EVIDENCE = [{ name: 'unit', result: 'PASS' as const, reference: 'test/unit/system-test' }];
const WRITE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|MERGE|CALL|DO)\b/i;
const ROUTES = ['/system-test', '/system-test/runner'];

// ---------------------------------------------------------------------------------------------------------- fakes
class FakeAccess {
  readonly audits: AuditRecord[] = [];
  readonly allowed = new Set<string>(); // permission codes
  readonly denied = new Set<string>(); // Direct DENY
  failLookup = false;

  async loadAccessFacts(_userAccountId: string, permission: PermissionRef): Promise<AccessFacts> {
    if (this.failLookup) throw pgError('08006');
    const grant = { roleActive: true, notRevoked: true, started: true, notExpired: true };
    return {
      permissions: [{ permissionId: '40000000-0000-4000-8000-000000000001', minimumAssuranceLevel: 1 }],
      account: { accountStatus: 'ACTIVE', notDisabled: true },
      grants: [
        ...(this.allowed.has(permission.permissionCode) ? [{ source: 'ROLE' as const, effect: 'ALLOW', ...grant }] : []),
        ...(this.denied.has(permission.permissionCode) ? [{ source: 'DIRECT' as const, effect: 'DENY', ...grant }] : []),
      ],
    };
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audits.push(record);
  }
}

function snapshotFor(moduleKey: string, overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
  const mic = systemTestMic(moduleKey, EVIDENCE);
  return {
    identity: { databaseName: 'talo_mos_v4_test', roleName: 'talo_app', serverVersion: '18.6' },
    module: { moduleId: '50000000-0000-4000-8000-000000000001', isEnabled: true, activeVersions: 1 },
    activeVersions: [{ versionId: '60000000-0000-4000-8000-000000000001', moduleVersion: '1.1.1', manifestJson: mic, manifestHash: canonicalDigest(mic).sha256 }],
    functions: ['DIAGNOSTICS', 'TEST_RUNNER'],
    actions: ['DIAGNOSTICS.READ', 'TEST_RUNNER.EXECUTE'],
    contracts: [
      { resourceKey: 'SYSTEM_STATUS', interfaceKind: 'API', fields: 5 },
      { resourceKey: 'TEST_RESULTS', interfaceKind: 'API', fields: 6 },
    ],
    compatibility: { checkResult: 'WARN', blocking: 0 },
    ...overrides,
  };
}

const OPERATIONS: OperationsSnapshot = {
  fleet: { state: 'AVAILABLE', value: [{ moduleKey: 'SYSTEM_TEST', enabled: true, versionCount: 7, activeVersions: 1 }] },
  activity: { state: 'AVAILABLE', value: { connections: 5, maxConnections: 100, deadlocks: 0, commits: 1000, rollbacks: 1, statsReset: null } },
  audit: { state: 'UNAVAILABLE', sqlstate: '42501' }, // talo_app cannot read B08: reported as UNAVAILABLE, never as 0
};

class FakeRepo implements SystemTestRepository {
  state: ModuleState | null = { moduleId: '50000000-0000-4000-8000-000000000001', isEnabled: true, activeVersions: 1 };
  snapshot: DiagnosticsSnapshot | Error = snapshotFor('SYSTEM_TEST');
  ops: OperationsSnapshot | Error = OPERATIONS;
  readonly calls: string[] = [];

  async diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot> {
    this.calls.push(`diagnostics:${moduleKey}`);
    if (this.snapshot instanceof Error) throw this.snapshot;
    return this.snapshot;
  }

  async operations(): Promise<OperationsSnapshot> {
    this.calls.push('operations');
    if (this.ops instanceof Error) throw this.ops;
    return this.ops;
  }
}

// The module repository is faked; any direct database use by the Host would be a defect here.
const NO_DB: FoundationDb = {
  query: async () => { throw new Error('unexpected database use'); },
  execute: async () => { throw new Error('unexpected database use'); },
  transaction: async () => { throw new Error('unexpected database use'); },
};

const menuOf = (routes: readonly string[]): MenuNode[] => [{
  navigationId: 'g', moduleId: 'm', functionId: null, menuTitle: 'System Test', sortOrder: 0, routePath: null, screenKey: null, developArea: false,
  children: routes.map((r, i) => ({ navigationId: `n${i}`, moduleId: 'm', functionId: `f${i}`, menuTitle: r, sortOrder: i, routePath: r, screenKey: null, developArea: false, children: [] })),
}];

function build() {
  const access = new FakeAccess();
  const repo = new FakeRepo();
  const nav = { routes: [...ROUTES], fail: false };
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const auth = new FakeAuth();
  auth.authenticated(token('st'), ACCOUNT);
  const base = createHostCapabilities('SYSTEM_TEST', {
    db: NO_DB, access, authService: auth, logger, secureCookie: false, resultsFile: join(tmpdir(), `st-missing-${process.pid}.json`),
    navigation: { menu: async () => { if (nav.fail) throw pgError('57014'); return menuOf(nav.routes); } },
  });
  const host: HostCapabilities = { ...base, lifecycle: async (key) => { repo.calls.push(`moduleState:${key}`); return repo.state; } };
  const { service, router } = createModule(host, { repository: repo });
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [router] });
  const allowAll = () => {
    for (const p of [SYSTEM_TEST_BINDING.diagnosticsRead, SYSTEM_TEST_BINDING.testRunnerExecute]) access.allowed.add(p.permissionCode);
  };
  return { access, repo, nav, service, app, logs, allowAll };
}

const actor: Actor = { userAccountId: ACCOUNT, assuranceLevel: 1, requestId: '70000000-0000-4000-8000-000000000001' };
const cookie = `talo_sid=${token('st')}`;
const statusMap = (results: readonly { key: string; status: string }[]) => Object.fromEntries(results.map((r) => [r.key, r.status]));

// ------------------------------------------------------------------------------------------------------------ MIC
describe('SYSTEM_TEST MIC-1.0 (ST-01, source level) — 1.1.1 CHANGE of the ACTIVE 1.0.3', () => {
  const ctx = (otherVersions: { moduleVersion: string; status: string }[]) => ({ moduleKey: 'SYSTEM_TEST', moduleVersion: '1.1.1', contractVersion: 'MIC-1.0', otherVersions });
  const history = [
    { moduleVersion: '1.0.0', status: 'APPROVED' }, { moduleVersion: '1.0.1', status: 'REJECTED' }, { moduleVersion: '1.0.2', status: 'APPROVED' },
    { moduleVersion: '1.0.3', status: 'ACTIVE' }, { moduleVersion: '1.1.0', status: 'APPROVED' },
  ];

  it('passes the Foundation MIC validator against the real version history of SYSTEM_TEST (CHANGE from 1.0.3)', () => {
    expect(validateMic(systemTestMic('SYSTEM_TEST', EVIDENCE), ctx(history))).toMatchObject({ ok: true });
  });

  it('is refused when 1.0.3 does not exist, when no version is eligible, or for another module version / key', () => {
    expect(validateMic(systemTestMic('SYSTEM_TEST', EVIDENCE), ctx(history.filter((v) => v.moduleVersion !== '1.0.3'))))
      .toMatchObject({ ok: false, errors: expect.arrayContaining(['COMPATIBILITY_FROM_VERSION_INVALID']) });
    expect(validateMic(systemTestMic('SYSTEM_TEST', EVIDENCE), ctx([]))).toMatchObject({ ok: false, errors: expect.arrayContaining(['COMPATIBILITY_KIND_INVALID']) });
    expect(validateMic(systemTestMic('SYSTEM_TEST', EVIDENCE), { ...ctx(history), moduleVersion: '1.1.0' }))
      .toMatchObject({ ok: false, errors: expect.arrayContaining(['IDENTITY_MODULE_VERSION_MISMATCH']) });
    expect(validateMic(systemTestMic('OTHER', EVIDENCE), ctx(history))).toMatchObject({ ok: false, errors: expect.arrayContaining(['IDENTITY_MODULE_KEY_MISMATCH']) });
  });

  it('two Functions / Actions with the exact K05 mapping, API data resources only, two routes, three APIs; no Data Viewer anywhere', () => {
    const mic = systemTestMic('SYSTEM_TEST', EVIDENCE);
    expect(mic.mic03Actions.map((a) => `${a.functionKey}.${a.actionKey}`)).toEqual(['DIAGNOSTICS.READ', 'TEST_RUNNER.EXECUTE']);
    expect(mic.mic07IamMapping.map((m) => [m.moduleCode, m.resourceCode, m.operation, m.minimumAssuranceLevel])).toEqual([
      ['SYSTEM_TEST', 'DIAGNOSTICS', 'READ', 1], ['SYSTEM_TEST', 'TEST_RUNNER', 'EXECUTE', 1],
    ]);
    const binding = SYSTEM_TEST_BINDING;
    expect([binding.diagnosticsRead, binding.testRunnerExecute].map((p) => [p.permissionCode, p.moduleCode, p.resourceCode, p.operation])).toEqual([
      ['system_test.diagnostics.read', 'SYSTEM_TEST', 'DIAGNOSTICS', 'READ'], ['system_test.test_runner.execute', 'SYSTEM_TEST', 'TEST_RUNNER', 'EXECUTE'],
    ]);
    expect(Object.keys(binding).sort()).toEqual(['diagnosticsRead', 'moduleKey', 'testRunnerExecute']);
    expect(Object.values(SYSTEM_TEST_ACTION)).toEqual(['SYSTEM_TEST.DIAGNOSTICS.READ', 'SYSTEM_TEST.TEST_RUNNER.EXECUTE']);
    expect(mic.mic06DataResources.map((r) => [r.resourceKey, r.interfaceKind, r.columns.length])).toEqual([['SYSTEM_STATUS', 'API', 5], ['TEST_RESULTS', 'API', 6]]);
    expect(mic.mic04Navigation.filter((n) => n.routePath).map((n) => [n.routePath, n.functionKey, n.screenKey])).toEqual([
      ['/system-test', 'DIAGNOSTICS', 'system.test'], ['/system-test/runner', 'TEST_RUNNER', 'system.test'],
    ]);
    expect(mic.mic05Api.map((a) => `${a.method} ${a.path} ${a.functionKey}.${a.actionKey}`)).toEqual([
      'GET /api/system-test/health DIAGNOSTICS.READ', 'POST /api/system-test/checks/run DIAGNOSTICS.READ', 'GET /api/system-test/results TEST_RUNNER.EXECUTE',
    ]);
    expect(mic.mic09Compatibility).toMatchObject({ kind: 'CHANGE', fromVersion: '1.0.3' });
    expect(JSON.stringify(mic)).not.toMatch(/"DATA_VIEWER"|TABLE_PREVIEW|\/system-test\/data|\/api\/system-test\/tables/);
    expect(Object.keys(moduleEntry).sort()).toEqual(['HOST_PROTOCOL', 'REQUIRED_CAPABILITIES', 'createModule']); // no viewer export
  });

  it('the default MIC-10 evidence of the source stays NOT_TESTED (real evidence is supplied with the submitted manifest)', () => {
    expect(systemTestMic().mic10Manifest.testEvidence.map((e) => e.result)).toEqual(['NOT_TESTED']);
  });
});

// -------------------------------------------------------------------------------------------------------- SQL
describe('Read-only SQL (ST-06 / ST-07, source level)', () => {
  it('every statement is a SELECT / SET (no write, no DDL, no IAM secret table); the Host executor is READ ONLY', () => {
    for (const sql of [...Object.values(SYSTEM_TEST_SQL), ...Object.values(HOST_SQL)]) {
      expect(sql.trim()).toMatch(/^(SELECT|SET)\b/);
      expect(sql).not.toMatch(WRITE);
      expect(sql).not.toMatch(/iam_credentials|iam_sessions|password/);
    }
    expect(Object.keys(SYSTEM_TEST_SQL).sort()).toEqual(['activeVersions', 'activity', 'audit', 'dataContracts', 'fleet', 'identity', 'latestCompatibility',
      'moduleState', 'versionActions', 'versionFunctions']);
    expect(HOST_SQL.readOnly).toBe('SET TRANSACTION READ ONLY');
  });
});

// ------------------------------------------------------------------------------------------------- quick checks
describe('quick checks (ST-09, evaluation level) — 22 components', () => {
  const allow = (functionKey: string, allowed = true): IamFact => ({
    functionKey, permissionCode: `x.${functionKey}`, decision: allowed ? { allowed: true } : { allowed: false, reason: 'NO_VALID_ALLOW' },
  });
  const facts = (overrides: Partial<CheckFacts> = {}): CheckFacts => ({
    moduleKey: 'SYSTEM_TEST', assuranceLevel: 1, snapshot: snapshotFor('SYSTEM_TEST'),
    iam: [allow('DIAGNOSTICS'), allow('TEST_RUNNER')], menuRoutes: [...ROUTES],
    manifest: { intact: true, micValid: true }, operations: { ...OPERATIONS, audit: { state: 'AVAILABLE', value: { denied: 0, failures: 0 } } }, ...overrides,
  });
  const statusOf = (f: CheckFacts) => statusMap(evaluateChecks(f, sqlstateOf));

  it('every component is reported; consistent facts give PASS except the two the Host cannot prove (deployment sync, regression)', () => {
    const results = evaluateChecks(facts());
    expect(results.map((r) => r.key)).toEqual(CHECK_COMPONENTS.map((c) => c[0]));
    expect(results).toHaveLength(22);
    expect(results.filter((r) => r.status !== 'PASS').map((r) => [r.key, r.status])).toEqual([['DEPLOYMENT_SYNC', 'NOT_TESTED'], ['REGRESSION', 'NOT_TESTED']]);
  });

  it('defects are FAIL, unreadable sources UNAVAILABLE, missing prerequisites NOT_TESTED — never PASS', () => {
    const base = snapshotFor('SYSTEM_TEST');
    expect(statusOf(facts({ manifest: { intact: true, micValid: false } }))).toMatchObject({ VERSION_MIC: 'FAIL', FUNCTION_ACTION: 'NOT_TESTED' });
    expect(statusOf(facts({ manifest: null }))).toMatchObject({ VERSION_MIC: 'FAIL' });
    expect(statusOf(facts({ manifest: { intact: false, micValid: true } }))).toMatchObject({
      VERSION_MIC: 'FAIL', FUNCTION_ACTION: 'NOT_TESTED', DATA_CONTRACTS: 'NOT_TESTED', COMPATIBILITY: 'NOT_TESTED', NAVIGATION: 'NOT_TESTED',
    });
    expect(statusOf(facts({ snapshot: { ...base, functions: ['DIAGNOSTICS', 'TEST_RUNNER', 'DATA_VIEWER'] } }))).toMatchObject({ FUNCTION_ACTION: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, contracts: base.contracts.slice(1) } }))).toMatchObject({ DATA_CONTRACTS: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, compatibility: null } }))).toMatchObject({ COMPATIBILITY: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, compatibility: { checkResult: 'PASS', blocking: 1 } } }))).toMatchObject({ COMPATIBILITY: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, module: { moduleId: 'm', isEnabled: false, activeVersions: 1 } } }))).toMatchObject({ LIFECYCLE: 'FAIL', REGISTRY: 'PASS' });
    expect(statusOf(facts({ snapshot: { ...base, module: null } }))).toMatchObject({ REGISTRY: 'FAIL', LIFECYCLE: 'FAIL' });
    expect(statusOf(facts({ menuRoutes: ['/system-test'] }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), allow('TEST_RUNNER', false)], menuRoutes: ['/system-test'] }))).toMatchObject({ NAVIGATION: 'PASS', IAM: 'PASS' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), allow('TEST_RUNNER', false)] }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ menuRoutes: { error: pgError('57014') } }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), { functionKey: 'TEST_RUNNER', permissionCode: 'x', decision: { error: pgError('08006') } }] }))).toMatchObject({ IAM: 'FAIL' });
    expect(statusOf(facts({ snapshot: { error: pgError('42501') } }))).toMatchObject({ POSTGRESQL: 'UNAVAILABLE', REGISTRY: 'UNAVAILABLE', LIFECYCLE: 'UNAVAILABLE', NAVIGATION: 'NOT_TESTED' });
    expect(statusOf(facts({ snapshot: { error: pgError('08006') } }))).toMatchObject({ POSTGRESQL: 'FAIL', VERSION_MIC: 'UNAVAILABLE' });
    expect(statusOf(facts({ assuranceLevel: 0 }))).toMatchObject({ SESSION: 'FAIL' });
    expect(statusOf(facts({ operations: { error: pgError('08006') } }))).toMatchObject({ FLEET_DISCOVERY: 'UNAVAILABLE', DB_CONNECTIONS: 'UNAVAILABLE', AUDIT_DENIED: 'UNAVAILABLE' });
    expect(statusOf(facts({ operations: OPERATIONS }))).toMatchObject({ AUDIT_DENIED: 'UNAVAILABLE', AUDIT_FAILURE: 'UNAVAILABLE', FLEET_DISCOVERY: 'PASS' });
    expect(statusOf(facts({ regression: { state: 'INVALID' } }))).toMatchObject({ REGRESSION: 'WARN' });
  });
});

// ------------------------------------------------------------------------------------------------------ service
describe('SystemTestService (mock) — IAM first, then module lifecycle, then the read', () => {
  it('ST-04: no grant / Direct DENY → 403 with one B08 DENIED row; the lifecycle state is not even read', async () => {
    const t = build();
    await expect(t.service.health(actor)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    t.access.allowed.add(SYSTEM_TEST_BINDING.testRunnerExecute.permissionCode);
    t.access.denied.add(SYSTEM_TEST_BINDING.testRunnerExecute.permissionCode);
    await expect(t.service.results(actor)).rejects.toMatchObject({ status: 403 });
    expect(t.access.audits.map((a) => [a.actionCode, a.outcome, a.targetType, a.targetId, a.moduleId, a.metadata['reason']])).toEqual([
      ['SYSTEM_TEST.DIAGNOSTICS.READ', 'DENIED', 'SYSTEM_TEST_API', null, null, 'NO_VALID_ALLOW'],
      ['SYSTEM_TEST.TEST_RUNNER.EXECUTE', 'DENIED', 'SYSTEM_TEST_API', null, null, 'DIRECT_DENY'],
    ]);
    expect(t.repo.calls).toEqual([]);
    t.access.failLookup = true;
    await expect(t.service.results(actor)).rejects.toMatchObject({ status: 503, code: 'SERVICE_BUSY' });
  });

  it('ST-11: module missing / DISABLED / no ACTIVE / two ACTIVE → 503 MODULE_UNAVAILABLE, nothing processed', async () => {
    const t = build();
    t.allowAll();
    for (const state of [null, { moduleId: 'm', isEnabled: false, activeVersions: 1 }, { moduleId: 'm', isEnabled: true, activeVersions: 0 }, { moduleId: 'm', isEnabled: true, activeVersions: 2 }]) {
      t.repo.state = state;
      for (const call of [() => t.service.health(actor), () => t.service.runChecks(actor, {}), () => t.service.results(actor)]) {
        await expect(call()).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
      }
    }
    expect(t.repo.calls.every((c) => c === 'moduleState:SYSTEM_TEST')).toBe(true);
  });

  it('ST-09: quick check reads facts (IAM of the 2 permissions, snapshot, operations, menu) and returns real statuses; body must be {}', async () => {
    const t = build();
    t.access.allowed.add(SYSTEM_TEST_BINDING.diagnosticsRead.permissionCode);
    t.nav.routes = ['/system-test'];
    const run = await t.service.runChecks(actor, {});
    expect(run.results).toHaveLength(22);
    // TEST_RUNNER denied → regression not read (NOT_TESTED); B08 not readable → UNAVAILABLE; deployment sync never proven.
    expect(run.summary).toEqual({ PASS: 18, FAIL: 0, WARN: 0, NOT_TESTED: 2, UNAVAILABLE: 2 });
    expect(statusMap(run.results)).toMatchObject({ NAVIGATION: 'PASS', AUDIT_DENIED: 'UNAVAILABLE', REGRESSION: 'NOT_TESTED', DEPLOYMENT_SYNC: 'NOT_TESTED', FLEET_LIFECYCLE: 'PASS' });
    expect(run.results.find((r) => r.key === 'IAM')?.detail).toBe('DIAGNOSTICS: ALLOW; TEST_RUNNER: DENY (NO_VALID_ALLOW)');
    expect([run.fleet.length, run.fleetComplete]).toEqual([1, true]);
    t.repo.snapshot = pgError('08006');
    t.repo.ops = pgError('08006');
    t.nav.fail = true;
    const broken = await t.service.runChecks(actor, {});
    expect(broken.summary.PASS).toBe(4); // AUTHENTICATION, SESSION, IAM, MODULE_API
    expect(statusMap(broken.results)).toMatchObject({ POSTGRESQL: 'FAIL', NAVIGATION: 'NOT_TESTED', FLEET_DISCOVERY: 'UNAVAILABLE' });
    expect(broken.fleetComplete).toBe(false);
    await expect(t.service.runChecks(actor, { sql: 'SELECT 1' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(t.service.runChecks(actor, null)).rejects.toMatchObject({ status: 400 });
    expect(t.access.audits).toEqual([]); // allowed reads write nothing
  });

  it('ST-10: results return the last quick check of THIS account only, never another account\'s', async () => {
    const t = build();
    t.allowAll();
    const mine = await t.service.runChecks(actor, {});
    expect((await t.service.results(actor)).quickCheck?.runId).toBe(mine.runId);
    expect((await t.service.results({ ...actor, userAccountId: '30000000-0000-4000-8000-000000000099' })).quickCheck).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- results file
describe('Full Regression results file (ST-10, Host reader + module parser)', () => {
  let dir = '';
  const readRegressionResults = async (file: string) => parseRegressionResults(await createHostCapabilities('SYSTEM_TEST', {
    db: NO_DB, access: new FakeAccess(), authService: new FakeAuth(), navigation: { menu: async () => [] }, logger: createLogger({ level: 'error' }),
    secureCookie: false, resultsFile: file,
  }).regressionResults());
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'st-results-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('missing → NOT_RUN; malformed / wrong format / extra field → INVALID; valid → AVAILABLE', async () => {
    expect(await readRegressionResults(join(dir, 'none.json'))).toEqual({ state: 'NOT_RUN' });
    const run = {
      format: REGRESSION_FORMAT, runId: 'R1', startedAt: '2026-10-19T00:00:00.000Z', finishedAt: '2026-10-19T00:01:00.000Z',
      target: { database: 'talo_mos_v4_test', host: '127.0.0.1', nodeEnv: 'test' }, status: 'PASS',
      suites: [{ key: 'NON_DB', label: 'Non-DB', command: 'npx vitest run', status: 'PASS', exitCode: 0, durationMs: 10, tests: { passed: 1, failed: 0, skipped: 0 }, summary: [] }],
    };
    const file = join(dir, 'r.json');
    await writeFile(file, JSON.stringify(run));
    expect(await readRegressionResults(file)).toEqual({ state: 'AVAILABLE', run });
    for (const bad of ['{', JSON.stringify({ ...run, format: 'X' }), JSON.stringify({ ...run, secret: 'x' }), JSON.stringify({ ...run, suites: [{ ...run.suites[0], status: 'OK' }] })]) {
      await writeFile(file, bad);
      expect(await readRegressionResults(file)).toEqual({ state: 'INVALID' });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------- HTTP
describe('SYSTEM_TEST HTTP routes (mock)', () => {
  it('401 without session; 200 envelopes; POST needs Origin + JSON; retired Data Viewer routes and any runner route → 404', async () => {
    const t = build();
    expect((await request(t.app).get('/api/system-test/health')).status).toBe(401);
    t.allowAll();
    const health = await request(t.app).get('/api/system-test/health').set('Cookie', cookie);
    expect(health.status).toBe(200);
    expect(health.body.health).toMatchObject({ moduleKey: 'SYSTEM_TEST', enabled: true, activeVersions: 1 });
    for (const retired of ['/api/system-test/tables', '/api/system-test/tables/B01/rows', '/api/system-test/tables/B01/rows?page=1&pageSize=2']) {
      expect([retired, (await request(t.app).get(retired).set('Cookie', cookie)).status]).toEqual([retired, 404]);
    }
    expect((await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Content-Type', 'application/json').send('{}')).status).toBe(403); // no Origin
    expect((await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).send('x')).status).toBe(415);
    const run = await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}');
    expect([run.status, run.body.run.results.length]).toEqual([200, 22]);
    const results = await request(t.app).get('/api/system-test/results').set('Cookie', cookie);
    expect(results.body.results).toMatchObject({ regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } });
    expect(results.body.results.quickCheck.runId).toBe(run.headers['x-request-id']);
    t.repo.state = null;
    const off = await request(t.app).get('/api/system-test/health').set('Cookie', cookie);
    expect([off.status, off.body.error.code, typeof off.body.error.requestId]).toEqual([503, 'MODULE_UNAVAILABLE', 'string']);
    // No route executes anything: unknown methods / paths are not handled by the module.
    expect((await request(t.app).post('/api/system-test/regression/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}')).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ runner (CLI)
describe('Full Regression runner — fixed suites and redaction (ST-10, source level)', () => {
  it('runs only the existing suites, by fixed constants; no shell metacharacter in any argument', () => {
    expect(SUITES.map((s) => s.key)).toEqual(['BACKEND_TYPECHECK', 'BACKEND_BUILD', 'NON_DB', 'FOUNDATION_UNIT', 'FBE01_DB', 'FBE02_DB', 'FBE03_DB', 'FBE04_DB',
      'FBE05_DB', 'FBE06_DB', 'FBE07_DB', 'SYSTEM_TEST_DB', 'IAM_ADMIN_DB', 'AUTH_DB', 'IAM_SCHEMA', 'IAM_ADMIN_E2E', 'AUTH_PRIVILEGES', 'DB_SMOKE', 'FRONTEND_BUILD']);
    for (const s of SUITES) {
      expect(['npm', 'npx']).toContain(s.command);
      for (const a of s.args) expect(a).toMatch(/^[A-Za-z0-9_./:-]+$/);
    }
  });

  it('keeps summary lines only and masks URLs / credentials / cookies', () => {
    const esc = String.fromCharCode(27);
    const out = [`${esc}[32m Test Files  2 passed (2)${esc}[39m`, '      Tests  10 passed | 1 failed | 3 skipped (14)', 'debug postgresql://talo_app:pw@127.0.0.1/db',
      ' FAIL  test/x.test.ts > case password=hunter2 postgresql://u:p@h/d', 'random noise line', ' FAIL  cookie: talo_sid=abc'].join(String.fromCharCode(10));
    const lines = redact(out);
    expect(lines).toEqual(['Test Files  2 passed (2)', 'Tests  10 passed | 1 failed | 3 skipped (14)', 'FAIL  test/x.test.ts > case password=[redacted] [url]',
      'FAIL  cookie=[redacted]']);
    expect(testCounts(lines)).toEqual({ passed: 10, failed: 1, skipped: 3 });
    expect(testCounts(['Smoke PASS'])).toBeNull();
  });
});
