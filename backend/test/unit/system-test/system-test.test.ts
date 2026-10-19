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
import { evaluateChecks } from '../../../src/modules/system-test/system-test.checks.js';
import type { CheckFacts, IamFact } from '../../../src/modules/system-test/system-test.checks.js';
import { systemTestMic } from '../../../src/modules/system-test/system-test.mic.js';
import { SYSTEM_TEST_BINDING } from '../../../src/modules/system-test/system-test.permissions.js';
import { SYSTEM_TEST_SQL, TableNotReadableError } from '../../../src/modules/system-test/system-test.repository.js';
import type { DiagnosticsSnapshot, ModuleState, SystemTestRepository, TablePage } from '../../../src/modules/system-test/system-test.repository.js';
import { REGRESSION_FORMAT, readRegressionResults } from '../../../src/modules/system-test/system-test.results.js';
import { systemTestRouter } from '../../../src/modules/system-test/system-test.routes.js';
import { SystemTestError, SystemTestService } from '../../../src/modules/system-test/system-test.service.js';
import { VIEWER_TABLES, countSql, rowsSql } from '../../../src/modules/system-test/system-test.tables.js';
import type { ViewerTable } from '../../../src/modules/system-test/system-test.tables.js';
import { SUITES, redact, testCounts } from '../../system-test/regression.support.js';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../foundation/fakes.js';

// MOD-TEST-01 — SYSTEM_TEST module, unit / mock level (no database). The DB level is test/integration/system-test.

const ACCOUNT = '30000000-0000-4000-8000-000000000001';
const EVIDENCE = [{ name: 'unit', result: 'PASS' as const, reference: 'test/unit/system-test' }];
const WRITE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|MERGE|CALL|DO)\b/i;

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
    activeVersions: [{ versionId: '60000000-0000-4000-8000-000000000001', moduleVersion: '1.0.0', manifestJson: mic, manifestHash: canonicalDigest(mic).sha256 }],
    functions: ['DATA_VIEWER', 'DIAGNOSTICS', 'TEST_RUNNER'],
    actions: ['DATA_VIEWER.READ', 'DIAGNOSTICS.READ', 'TEST_RUNNER.EXECUTE'],
    contracts: [
      { resourceKey: 'SYSTEM_STATUS', interfaceKind: 'API', fields: 4 },
      { resourceKey: 'TABLE_PREVIEW', interfaceKind: 'API', fields: 5 },
      { resourceKey: 'TEST_RESULTS', interfaceKind: 'API', fields: 6 },
    ],
    compatibility: { checkResult: 'PASS', blocking: 0 },
    ...overrides,
  };
}

class FakeRepo implements SystemTestRepository {
  state: ModuleState | null = { moduleId: '50000000-0000-4000-8000-000000000001', isEnabled: true, activeVersions: 1 };
  readable = new Set(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B09', 'B10', 'B11', 'B13', 'B14']);
  snapshot: DiagnosticsSnapshot | Error = snapshotFor('SYSTEM_TEST');
  pageError: Error | null = null;
  readonly calls: string[] = [];
  lastPage: { table: string; limit: number; offset: number } | null = null;

  async moduleState(moduleKey: string): Promise<ModuleState | null> {
    this.calls.push(`moduleState:${moduleKey}`);
    return this.state;
  }

  async readableTables(tables: readonly ViewerTable[]): Promise<ReadonlyMap<string, boolean>> {
    this.calls.push('readableTables');
    return new Map(tables.map((t) => [t.tableKey, this.readable.has(t.tableKey)]));
  }

  async tablePage(table: ViewerTable, limit: number, offset: number): Promise<TablePage> {
    this.calls.push(`tablePage:${table.tableKey}`);
    this.lastPage = { table: table.tableKey, limit, offset };
    if (this.pageError) throw this.pageError;
    if (!this.readable.has(table.tableKey)) throw new TableNotReadableError();
    return { totalRows: 2, rows: [table.columns.map(() => 'x'), table.columns.map(() => null)] };
  }

  async diagnostics(moduleKey: string): Promise<DiagnosticsSnapshot> {
    this.calls.push(`diagnostics:${moduleKey}`);
    if (this.snapshot instanceof Error) throw this.snapshot;
    return this.snapshot;
  }
}

const menuOf = (routes: readonly string[]): MenuNode[] => [{
  navigationId: 'g', moduleId: 'm', functionId: null, menuTitle: 'System Test', sortOrder: 0, routePath: null, screenKey: null,
  children: routes.map((r, i) => ({ navigationId: `n${i}`, moduleId: 'm', functionId: `f${i}`, menuTitle: r, sortOrder: i, routePath: r, screenKey: null, children: [] })),
}];

function build() {
  const access = new FakeAccess();
  const repo = new FakeRepo();
  const nav = { routes: ['/system-test', '/system-test/data', '/system-test/runner'], fail: false };
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const service = new SystemTestService({
    access, repository: repo, logger, binding: SYSTEM_TEST_BINDING, resultsFile: join(tmpdir(), `st-missing-${process.pid}.json`),
    navigation: { menu: async () => { if (nav.fail) throw pgError('57014'); return menuOf(nav.routes); } },
  });
  const auth = new FakeAuth();
  auth.authenticated(token('st'), ACCOUNT);
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [systemTestRouter({ authService: auth, service, secureCookie: false })] });
  const allowAll = () => {
    for (const p of [SYSTEM_TEST_BINDING.diagnosticsRead, SYSTEM_TEST_BINDING.dataViewerRead, SYSTEM_TEST_BINDING.testRunnerExecute]) access.allowed.add(p.permissionCode);
  };
  return { access, repo, nav, service, app, logs, allowAll };
}

const actor: Actor = { userAccountId: ACCOUNT, assuranceLevel: 1, requestId: '70000000-0000-4000-8000-000000000001' };
const cookie = `talo_sid=${token('st')}`;

// ------------------------------------------------------------------------------------------------------------ MIC
describe('SYSTEM_TEST MIC-1.0 (ST-01, source level)', () => {
  it('passes the Foundation MIC validator for SYSTEM_TEST 1.0.0 / MIC-1.0 / INITIAL_REGISTRATION', () => {
    const result = validateMic(systemTestMic('SYSTEM_TEST', EVIDENCE), { moduleKey: 'SYSTEM_TEST', moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', otherVersions: [] });
    expect(result.ok).toBe(true);
  });

  it('three Functions / Actions with the exact K05 mapping, API data resources only (no DIRECT_DB), routes and screen key', () => {
    const mic = systemTestMic('SYSTEM_TEST', EVIDENCE);
    expect(mic.mic03Actions.map((a) => `${a.functionKey}.${a.actionKey}`)).toEqual(['DIAGNOSTICS.READ', 'DATA_VIEWER.READ', 'TEST_RUNNER.EXECUTE']);
    expect(mic.mic07IamMapping.map((m) => [m.moduleCode, m.resourceCode, m.operation, m.minimumAssuranceLevel])).toEqual([
      ['SYSTEM_TEST', 'DIAGNOSTICS', 'READ', 1], ['SYSTEM_TEST', 'DATA_VIEWER', 'READ', 1], ['SYSTEM_TEST', 'TEST_RUNNER', 'EXECUTE', 1],
    ]);
    const binding = SYSTEM_TEST_BINDING;
    expect([binding.diagnosticsRead, binding.dataViewerRead, binding.testRunnerExecute].map((p) => [p.permissionCode, p.moduleCode, p.resourceCode, p.operation])).toEqual([
      ['system_test.diagnostics.read', 'SYSTEM_TEST', 'DIAGNOSTICS', 'READ'], ['system_test.data_viewer.read', 'SYSTEM_TEST', 'DATA_VIEWER', 'READ'],
      ['system_test.test_runner.execute', 'SYSTEM_TEST', 'TEST_RUNNER', 'EXECUTE'],
    ]);
    expect(mic.mic06DataResources.map((r) => [r.resourceKey, r.interfaceKind])).toEqual([['SYSTEM_STATUS', 'API'], ['TABLE_PREVIEW', 'API'], ['TEST_RESULTS', 'API']]);
    expect(mic.mic04Navigation.filter((n) => n.routePath).map((n) => [n.routePath, n.functionKey])).toEqual([
      ['/system-test', 'DIAGNOSTICS'], ['/system-test/data', 'DATA_VIEWER'], ['/system-test/runner', 'TEST_RUNNER'],
    ]);
    expect(mic.mic04Navigation[1]?.screenKey).toBe('system.test');
    expect(mic.mic05Api.map((a) => `${a.method} ${a.path}`)).toEqual([
      'GET /api/system-test/health', 'POST /api/system-test/checks/run', 'GET /api/system-test/tables', 'GET /api/system-test/tables/{tableKey}/rows', 'GET /api/system-test/results',
    ]);
    expect(mic.mic09Compatibility.kind).toBe('INITIAL_REGISTRATION');
  });
});

// ---------------------------------------------------------------------------------------------- allowlist + SQL
describe('Data Viewer allowlist and SQL (ST-06 / ST-07, source level)', () => {
  it('lists exactly B01…B14 of schema foundation; no IAM table; no secret or audit-metadata column', () => {
    expect(VIEWER_TABLES.map((t) => t.tableKey)).toEqual(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13', 'B14']);
    expect(new Set(VIEWER_TABLES.map((t) => t.schema))).toEqual(new Set(['foundation']));
    for (const t of VIEWER_TABLES) {
      expect(t.table.startsWith('fnd_')).toBe(true);
      for (const c of t.columns) expect(c).not.toMatch(/password|token|secret|credential|session|metadata|_state$|manifest_json|_spec$|previous_value|proposed_value/);
      expect(t.orderBy.at(-1)).toBe(t.columns[0]); // primary key last → deterministic order
    }
    const b07 = VIEWER_TABLES.find((t) => t.tableKey === 'B07');
    const b08 = VIEWER_TABLES.find((t) => t.tableKey === 'B08');
    expect(b07?.hiddenColumns).toEqual(['before_state', 'after_state']);
    expect(b08?.hiddenColumns).toEqual(['session_id', 'metadata']);
  });

  it('every statement is a SELECT / SET (no write, no DDL); paging is bound as $1 / $2', () => {
    for (const sql of Object.values(SYSTEM_TEST_SQL)) {
      expect(sql.trim()).toMatch(/^(SELECT|SET)\b/);
      expect(sql).not.toMatch(WRITE);
    }
    for (const t of VIEWER_TABLES) {
      const rows = rowsSql(t);
      expect(rows).toMatch(/^SELECT /);
      expect(rows).not.toMatch(WRITE);
      expect(rows.endsWith('LIMIT $1 OFFSET $2')).toBe(true);
      expect(rows).toContain(`FROM "foundation"."${t.table}" ORDER BY `);
      expect(countSql(t)).toBe(`SELECT count(*)::int AS n FROM "foundation"."${t.table}"`);
    }
    expect(SYSTEM_TEST_SQL.readOnly).toBe('SET TRANSACTION READ ONLY');
  });
});

// ------------------------------------------------------------------------------------------------- quick checks
describe('quick checks (ST-09, evaluation level)', () => {
  const allow = (functionKey: string, allowed = true): IamFact => ({
    functionKey, permissionCode: `x.${functionKey}`, decision: allowed ? { allowed: true } : { allowed: false, reason: 'NO_VALID_ALLOW' },
  });
  const facts = (overrides: Partial<CheckFacts> = {}): CheckFacts => ({
    moduleKey: 'SYSTEM_TEST', assuranceLevel: 1, snapshot: snapshotFor('SYSTEM_TEST'),
    iam: [allow('DIAGNOSTICS'), allow('DATA_VIEWER'), allow('TEST_RUNNER')], menuRoutes: ['/system-test', '/system-test/data', '/system-test/runner'], ...overrides,
  });
  const statusOf = (f: CheckFacts) => Object.fromEntries(evaluateChecks(f).map((r) => [r.key, r.status]));

  it('all twelve components PASS only when every fact is consistent', () => {
    const results = evaluateChecks(facts());
    expect(results.map((r) => r.key)).toEqual(['AUTHENTICATION', 'SESSION', 'IAM', 'POSTGRESQL', 'REGISTRY', 'VERSION_MIC', 'FUNCTION_ACTION', 'DATA_CONTRACTS',
      'COMPATIBILITY', 'LIFECYCLE', 'NAVIGATION', 'MODULE_API']);
    expect(results.every((r) => r.status === 'PASS')).toBe(true);
  });

  it('defects are FAIL, unreadable sources UNAVAILABLE, missing prerequisites NOT_TESTED — never PASS', () => {
    const base = snapshotFor('SYSTEM_TEST');
    const [v] = base.activeVersions;
    expect(statusOf(facts({ snapshot: { ...base, activeVersions: v ? [{ ...v, manifestHash: 'f'.repeat(64) }] : [] } }))).toMatchObject({
      VERSION_MIC: 'FAIL', FUNCTION_ACTION: 'NOT_TESTED', DATA_CONTRACTS: 'NOT_TESTED', COMPATIBILITY: 'NOT_TESTED', NAVIGATION: 'NOT_TESTED',
    });
    expect(statusOf(facts({ snapshot: { ...base, functions: ['DIAGNOSTICS'] } }))).toMatchObject({ FUNCTION_ACTION: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, contracts: base.contracts.slice(1) } }))).toMatchObject({ DATA_CONTRACTS: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, compatibility: null } }))).toMatchObject({ COMPATIBILITY: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, compatibility: { checkResult: 'PASS', blocking: 1 } } }))).toMatchObject({ COMPATIBILITY: 'FAIL' });
    expect(statusOf(facts({ snapshot: { ...base, module: { moduleId: 'm', isEnabled: false, activeVersions: 1 } } }))).toMatchObject({ LIFECYCLE: 'FAIL', REGISTRY: 'PASS' });
    expect(statusOf(facts({ snapshot: { ...base, module: null } }))).toMatchObject({ REGISTRY: 'FAIL', LIFECYCLE: 'FAIL' });
    expect(statusOf(facts({ menuRoutes: ['/system-test'] }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), allow('DATA_VIEWER', false), allow('TEST_RUNNER', false)], menuRoutes: ['/system-test'] })))
      .toMatchObject({ NAVIGATION: 'PASS', IAM: 'PASS' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), allow('DATA_VIEWER', false), allow('TEST_RUNNER')] }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ menuRoutes: { error: pgError('57014') } }))).toMatchObject({ NAVIGATION: 'FAIL' });
    expect(statusOf(facts({ iam: [allow('DIAGNOSTICS'), { functionKey: 'DATA_VIEWER', permissionCode: 'x', decision: { error: pgError('08006') } }] }))).toMatchObject({ IAM: 'FAIL' });
    const denied = statusOf(facts({ snapshot: { error: pgError('42501') } }));
    expect(denied).toMatchObject({ POSTGRESQL: 'UNAVAILABLE', REGISTRY: 'UNAVAILABLE', LIFECYCLE: 'UNAVAILABLE', NAVIGATION: 'NOT_TESTED' });
    expect(statusOf(facts({ snapshot: { error: pgError('08006') } }))).toMatchObject({ POSTGRESQL: 'FAIL', VERSION_MIC: 'UNAVAILABLE' });
    expect(statusOf(facts({ assuranceLevel: 0 }))).toMatchObject({ SESSION: 'FAIL' });
  });
});

// ------------------------------------------------------------------------------------------------------ service
describe('SystemTestService (mock) — IAM first, then module lifecycle, then the read', () => {
  it('ST-04: no grant / Direct DENY → 403 with one B08 DENIED row; the lifecycle state is not even read', async () => {
    const t = build();
    await expect(t.service.health(actor)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    t.access.allowed.add(SYSTEM_TEST_BINDING.dataViewerRead.permissionCode);
    t.access.denied.add(SYSTEM_TEST_BINDING.dataViewerRead.permissionCode);
    await expect(t.service.tables(actor)).rejects.toMatchObject({ status: 403 });
    expect(t.access.audits.map((a) => [a.actionCode, a.outcome, a.targetType, a.targetId, a.moduleId, a.metadata['reason']])).toEqual([
      ['SYSTEM_TEST.DIAGNOSTICS.READ', 'DENIED', 'SYSTEM_TEST_API', null, null, 'NO_VALID_ALLOW'],
      ['SYSTEM_TEST.DATA_VIEWER.READ', 'DENIED', 'SYSTEM_TEST_API', null, null, 'DIRECT_DENY'],
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
      for (const call of [() => t.service.health(actor), () => t.service.runChecks(actor, {}), () => t.service.tables(actor), () => t.service.rows(actor, 'B01', {}), () => t.service.results(actor)]) {
        await expect(call()).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
      }
    }
    expect(t.repo.calls.filter((c) => !c.startsWith('moduleState'))).toEqual([]);
    expect(t.repo.calls.every((c) => c === 'moduleState:SYSTEM_TEST')).toBe(true);
  });

  it('ST-08: paging — default 50, max 100, page ≥ 1, offset = (page − 1) × size; bad input 400; unknown table 404', async () => {
    const t = build();
    t.allowAll();
    const page = await t.service.rows(actor, 'B02', {});
    expect([page.page, page.pageSize, page.totalRows, page.rows.length, t.repo.lastPage]).toEqual([1, 50, 2, 2, { table: 'B02', limit: 50, offset: 0 }]);
    await t.service.rows(actor, 'B13', { page: '3', pageSize: '100' });
    expect(t.repo.lastPage).toEqual({ table: 'B13', limit: 100, offset: 200 });
    for (const q of [{ pageSize: '101' }, { pageSize: '0' }, { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: ['1', '2'] }, { pageSize: 'abc' }, { page: '100001' }]) {
      await expect(t.service.rows(actor, 'B01', q)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
    for (const key of ['B15', 'b01', 'fnd_modules', 'iam_credentials', 'B01; DROP TABLE x', '', 'B00']) {
      await expect(t.service.rows(actor, key, {})).rejects.toMatchObject({ status: 404, code: 'TABLE_NOT_FOUND' });
    }
  });

  it('ST-06: a table without SELECT (B07 / B08 / B12 for talo_app) → 403 TABLE_NOT_READABLE; 42501 likewise; other errors 503', async () => {
    const t = build();
    t.allowAll();
    const tables = await t.service.tables(actor);
    expect(tables.filter((x) => !x.readable).map((x) => x.tableKey)).toEqual(['B07', 'B08', 'B12']);
    for (const key of ['B07', 'B08', 'B12']) await expect(t.service.rows(actor, key, {})).rejects.toMatchObject({ status: 403, code: 'TABLE_NOT_READABLE' });
    t.repo.pageError = pgError('42501');
    await expect(t.service.rows(actor, 'B01', {})).rejects.toMatchObject({ status: 403, code: 'TABLE_NOT_READABLE' });
    t.repo.pageError = pgError('57014');
    await expect(t.service.rows(actor, 'B01', {})).rejects.toMatchObject({ status: 503, code: 'SERVICE_BUSY' });
  });

  it('ST-09: quick check reads facts (IAM of the 3 permissions, snapshot, menu) and returns real statuses; body must be {}', async () => {
    const t = build();
    t.access.allowed.add(SYSTEM_TEST_BINDING.diagnosticsRead.permissionCode);
    t.nav.routes = ['/system-test'];
    const run = await t.service.runChecks(actor, {});
    expect(run.summary).toEqual({ PASS: 12, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0 });
    expect(run.results.find((r) => r.key === 'IAM')?.detail).toBe('DIAGNOSTICS: ALLOW; DATA_VIEWER: DENY (NO_VALID_ALLOW); TEST_RUNNER: DENY (NO_VALID_ALLOW)');
    t.repo.snapshot = pgError('08006');
    t.nav.fail = true;
    const broken = await t.service.runChecks(actor, {});
    expect(broken.summary.PASS).toBe(4); // AUTHENTICATION, SESSION, IAM, MODULE_API
    expect(Object.fromEntries(broken.results.map((r) => [r.key, r.status]))).toMatchObject({ POSTGRESQL: 'FAIL', NAVIGATION: 'NOT_TESTED' });
    await expect(t.service.runChecks(actor, { sql: 'SELECT 1' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(t.service.runChecks(actor, null)).rejects.toMatchObject({ status: 400 });
    expect(t.access.audits).toEqual([]); // allowed reads write nothing
  });
});

// ------------------------------------------------------------------------------------------------- results file
describe('Full Regression results file (ST-10, reader)', () => {
  let dir = '';
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
  it('401 without session; 200 envelopes; POST needs Origin + JSON; error envelope with requestId', async () => {
    const t = build();
    expect((await request(t.app).get('/api/system-test/health')).status).toBe(401);
    t.allowAll();
    const health = await request(t.app).get('/api/system-test/health').set('Cookie', cookie);
    expect(health.status).toBe(200);
    expect(health.body.health).toMatchObject({ moduleKey: 'SYSTEM_TEST', enabled: true, activeVersions: 1 });
    const tables = await request(t.app).get('/api/system-test/tables').set('Cookie', cookie);
    expect(tables.body.tables).toHaveLength(14);
    const rows = await request(t.app).get('/api/system-test/tables/B01/rows?page=1&pageSize=2').set('Cookie', cookie);
    expect(rows.status).toBe(200);
    expect(rows.body.data).toMatchObject({ page: 1, pageSize: 2, totalRows: 2, orderBy: ['created_at', 'module_id'] });
    const nf = await request(t.app).get('/api/system-test/tables/B99/rows').set('Cookie', cookie);
    expect([nf.status, nf.body.error.code, typeof nf.body.error.requestId]).toEqual([404, 'TABLE_NOT_FOUND', 'string']);
    expect((await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Content-Type', 'application/json').send('{}')).status).toBe(403); // no Origin
    expect((await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).send('x')).status).toBe(415);
    const run = await request(t.app).post('/api/system-test/checks/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}');
    expect([run.status, run.body.run.summary.PASS]).toEqual([200, 12]);
    const results = await request(t.app).get('/api/system-test/results').set('Cookie', cookie);
    expect(results.body.results).toMatchObject({ regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } });
    expect(results.body.results.quickCheck.runId).toBe(run.headers['x-request-id']);
    t.repo.state = null;
    const off = await request(t.app).get('/api/system-test/health').set('Cookie', cookie);
    expect([off.status, off.body.error.code]).toEqual([503, 'MODULE_UNAVAILABLE']);
    // No route executes anything: unknown methods / paths are not handled by the module.
    expect((await request(t.app).post('/api/system-test/regression/run').set('Cookie', cookie).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}')).status).toBe(404);
    expect(new SystemTestError(403, 'TABLE_NOT_READABLE').message).toBe('Không có quyền xem bảng này.');
  });
});

// ------------------------------------------------------------------------------------------------ runner (CLI)
describe('Full Regression runner — fixed suites and redaction (ST-10, source level)', () => {
  it('runs only the existing suites, by fixed constants; no shell metacharacter in any argument', () => {
    expect(SUITES.map((s) => s.key)).toEqual(['BACKEND_TYPECHECK', 'BACKEND_BUILD', 'NON_DB', 'FOUNDATION_UNIT', 'FBE01_DB', 'FBE02_DB', 'FBE03_DB', 'FBE04_DB',
      'FBE05_DB', 'FBE06_DB', 'FBE07_DB', 'SYSTEM_TEST_DB', 'AUTH_DB', 'AUTH_PRIVILEGES', 'DB_SMOKE', 'FRONTEND_BUILD']);
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
