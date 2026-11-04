import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { evaluateChecks, packageStates } from '../backend/system-controller-center.checks.js';
import type { CheckFacts, DeploymentFacts } from '../backend/system-controller-center.checks.js';
import type { FleetCounts, FleetSnapshot } from '../backend/system-controller-center.repository.js';
import { parseRegressionResults, REGRESSION_FORMAT, REGRESSION_FORMAT_V2 } from '../backend/system-controller-center.results.js';
import { readStatusOf } from '../backend/data-inspector.service.js';

// SCC 0.1.3 — pure evaluation rules. The counts below are inputs of the rules, not expectations about any database: the
// real numbers are checked against the clone by backend/test/integration/scc013/scc013.clone.db.test.ts.

const counts = (o: Partial<FleetCounts>): FleetCounts => ({ registered: 0, enabled: 0, withActive: 0, enabledActive: 0, enabledWithoutActive: 0,
  multiActive: 0, noVersion: 0, enabledNoVersion: 0, versions: 0, ...o });
const fleet = (all: Partial<FleetCounts>, fx: Partial<FleetCounts>, extra: Partial<FleetSnapshot> = {}): FleetSnapshot => ({
  all: counts(all), fixtureCandidates: counts(fx), versionStatuses: { ACTIVE: 3 }, anomalies: [], anomaliesTruncated: false, modules: [], modulesTruncated: false, ...extra });
const facts = (f: FleetSnapshot, more: Partial<CheckFacts> = {}): CheckFacts => ({
  moduleKey: 'SYSTEM_CONTROLLER_CENTER', assuranceLevel: 1, iam: [], menuRoutes: [], manifest: null,
  snapshot: { identity: { databaseName: 'db_x', roleName: 'talo_module_reader', serverVersion: '18' }, module: null, activeVersions: [], functions: [], actions: [], contracts: [], compatibility: null },
  operations: { fleet: { state: 'AVAILABLE', value: f }, activity: { state: 'UNAVAILABLE' }, audit: { state: 'UNAVAILABLE' } }, ...more });
const result = (f: CheckFacts, key: string) => evaluateChecks(f).find((r) => r.key === key);

describe('SCC 0.1.3 fleet over the whole registry', () => {
  it('counts every module (no 200-row cut) and keeps fixture candidates inside the totals', () => {
    const r = result(facts(fleet({ registered: 2500, enabled: 300, enabledActive: 250 }, { registered: 2400, enabled: 290, enabledActive: 249 })), 'FLEET_DISCOVERY');
    expect(r?.status).toBe('PASS');
    expect(r?.detail).toContain('2.500 module');
    expect(r?.detail).toContain('2.400 ứng viên fixture');
    expect(r?.detail).not.toContain('200+');
  });
  it('FLEET_LIFECYCLE fails on every ENABLED module without exactly one ACTIVE, fixture candidates included', () => {
    const only = facts(fleet({ registered: 10, enabled: 5, enabledWithoutActive: 3 }, { registered: 8, enabled: 4, enabledWithoutActive: 3 }));
    const r = result(only, 'FLEET_LIFECYCLE');
    expect(r?.status).toBe('FAIL');
    expect(r?.detail).toContain('3 module ENABLED không có đúng 1 ACTIVE');
    expect(r?.detail).toContain('ứng viên fixture FBET_*: 3');
  });
  it('FLEET_RELEASES: a module without a version is valid while DISABLED, a breach while ENABLED; several ACTIVE fail', () => {
    expect(result(facts(fleet({ registered: 4, noVersion: 2, versions: 5 }, {})), 'FLEET_RELEASES')?.status).toBe('PASS');
    expect(result(facts(fleet({ registered: 4, noVersion: 2, enabledNoVersion: 1 }, {})), 'FLEET_RELEASES')?.status).toBe('WARN');
    expect(result(facts(fleet({ registered: 4, multiActive: 1 }, {})), 'FLEET_RELEASES')?.status).toBe('FAIL');
  });
});

describe('SCC 0.1.3 DEPLOYMENT_SYNC', () => {
  const pkg = (k: string, v: string, o: Partial<DeploymentFacts['state']['packages'][number]> = {}) => ({
    moduleKey: k, packageVersion: v, packageHash: 'a'.repeat(64), releaseVerified: true, backendInstalled: true, frontendInstalled: true, loaded: true, ...o });
  const dep = (packages: DeploymentFacts['state']['packages'], rows: DeploymentFacts['registry']['rows'], ro = { fixture: 0, other: 0, otherKeys: [] as string[] }): DeploymentFacts =>
    ({ state: { checkedAt: 'x', lockMatchesRuntime: true, packages }, registry: { rows, registryOnly: ro } });
  const f = fleet({ registered: 3, withActive: 2, enabledActive: 1 }, {});
  it('is NOT_TESTED without the Host capability (never inferred from ACTIVE)', () => {
    expect(result(facts(f, { deployment: null }), 'DEPLOYMENT_SYNC')?.status).toBe('NOT_TESTED');
  });
  it('separates SERVING, LOADED_DISABLED and VERSION_DRIFT', () => {
    const d = dep([pkg('A', '1.0.0'), pkg('B', '2.0.0'), pkg('C', '3.0.0')], [
      { moduleKey: 'A', isEnabled: true, activeVersions: 1, activeVersion: '1.0.0' },
      { moduleKey: 'B', isEnabled: false, activeVersions: 1, activeVersion: '2.0.0' },
      { moduleKey: 'C', isEnabled: true, activeVersions: 1, activeVersion: '2.9.0' }]);
    expect(packageStates(d).map((s) => s.state)).toEqual(['SERVING', 'LOADED_DISABLED', 'VERSION_DRIFT']);
    expect(result(facts(f, { deployment: d }), 'DEPLOYMENT_SYNC')?.status).toBe('FAIL'); // ENABLED module runs another version
  });
  it('registry-only fixture candidates → WARN; a registry-only non-fixture module → FAIL', () => {
    const ok = [{ moduleKey: 'A', isEnabled: true, activeVersions: 1, activeVersion: '1.0.0' }];
    expect(result(facts(f, { deployment: dep([pkg('A', '1.0.0')], ok) }), 'DEPLOYMENT_SYNC')?.status).toBe('PASS');
    expect(result(facts(f, { deployment: dep([pkg('A', '1.0.0')], ok, { fixture: 5, other: 0, otherKeys: [] }) }), 'DEPLOYMENT_SYNC')?.status).toBe('WARN');
    expect(result(facts(f, { deployment: dep([pkg('A', '1.0.0')], ok, { fixture: 0, other: 1, otherKeys: ['CRM'] }) }), 'DEPLOYMENT_SYNC')?.status).toBe('FAIL');
    expect(result(facts(f, { deployment: dep([pkg('A', '1.0.0', { releaseVerified: false })], ok) }), 'DEPLOYMENT_SYNC')?.status).toBe('FAIL');
  });
});

describe('SCC 0.1.3 regression artifact', () => {
  const suites = [{ key: 'NON_DB', label: 'x', command: 'npx vitest run', status: 'PASS', exitCode: 0, durationMs: 1, tests: { passed: 1, failed: 0, skipped: 0 }, summary: [] }];
  const now = new Date().toISOString();
  const v2 = (environment: 'TEST' | 'CLONE', database = 'db_x') => JSON.stringify({ format: REGRESSION_FORMAT_V2, environment, runId: 'r1', startedAt: now, finishedAt: now,
    target: { database, host: '127.0.0.1', port: '5440', nodeEnv: 'test' }, source: { commit: 'b'.repeat(40), dirty: true, lock: [] }, status: 'PASS', suites });
  it('reads format 1 and 2 and reports the sha256 of the text', () => {
    const t = v2('CLONE');
    const r = parseRegressionResults(t);
    expect(r.state).toBe('AVAILABLE');
    expect(r.state === 'AVAILABLE' && r.sha256).toBe(createHash('sha256').update(t).digest('hex'));
    const v1 = JSON.stringify({ format: REGRESSION_FORMAT, runId: 'r0', startedAt: now, finishedAt: now, target: { database: 'db_x', host: 'h', nodeEnv: 'test' }, status: 'PASS', suites });
    expect(parseRegressionResults(v1).state).toBe('AVAILABLE');
    expect(parseRegressionResults(v2('CLONE').replace('"CLONE"', '"PROD"')).state).toBe('INVALID');
  });
  it('a PASS from a CLONE (or another database) is never shown as PASS of this runtime', () => {
    const clone = result(facts(fleet({}, {}), { regression: parseRegressionResults(v2('CLONE')) }), 'REGRESSION');
    expect(clone?.status).toBe('WARN');
    expect(clone?.detail).toContain('Môi trường nguồn: CLONE');
    expect(result(facts(fleet({}, {}), { regression: parseRegressionResults(v2('TEST', 'other_db')) }), 'REGRESSION')?.status).toBe('WARN');
    expect(result(facts(fleet({}, {}), { regression: parseRegressionResults(v2('TEST')) }), 'REGRESSION')?.status).toBe('PASS');
  });
});

describe('SCC 0.1.3 Data Inspection read status (RO-D6)', () => {
  const row = { oid: '1', schema: 's', table: 't', relkind: 'r', rowSecurity: false, schemaUsage: true };
  it('column grants covering every column → READABLE; a withheld column → PARTIAL; none → NOT_READABLE', () => {
    expect(readStatusOf({ ...row, tableSelect: false, anyColumnSelect: true, allColumnsSelect: true })).toBe('READABLE');
    expect(readStatusOf({ ...row, tableSelect: false, anyColumnSelect: true, allColumnsSelect: false })).toBe('PARTIAL');
    expect(readStatusOf({ ...row, tableSelect: false, anyColumnSelect: true, allColumnsSelect: null })).toBe('PARTIAL');
    expect(readStatusOf({ ...row, tableSelect: false, anyColumnSelect: false, allColumnsSelect: false })).toBe('NOT_READABLE');
    expect(readStatusOf({ ...row, tableSelect: true, anyColumnSelect: true })).toBe('READABLE');
  });
});
