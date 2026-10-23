import express from 'express';
import type { Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModule } from '../backend/index.js';
import type { ModuleActor, ModuleHost } from '../backend/host.js';
import type { DiagnosticsSnapshot, OperationsSnapshot, SystemTestRepository } from '../backend/system-test.repository.js';
import { REGRESSION_FORMAT } from '../backend/system-test.results.js';
import { systemTestMic } from '../mic/system-test.mic.js';
import {
  CHECK_STATUSES, ContractError, describeSystemTestFailure, parseEnvelope, parseHealth, parseRegression, parseResults, parseRun,
} from '../frontend/systemTestApi.js';

// SYSTEM_TEST 1.1.1 API contract — ONE contract for both sides: the module's real router + service answer over HTTP and the
// browser's own parsers (frontend/systemTestApi.ts) read those exact bodies. Only the Host capabilities and the read-only
// repository are faked (no database); no value is invented by the parsers.

const ACTOR: ModuleActor = { userAccountId: '30000000-0000-4000-8000-000000000001', assuranceLevel: 1, requestId: '70000000-0000-4000-8000-000000000001' };
const MIC = systemTestMic('SYSTEM_TEST', [{ name: 'contract', result: 'PASS', reference: 'tests/api-contract.test.ts' }]);
const SNAPSHOT: DiagnosticsSnapshot = {
  identity: { databaseName: 'talo_mos_v4_test', roleName: 'talo_app', serverVersion: '18.6' },
  module: { moduleId: 'm', isEnabled: true, activeVersions: 1 },
  activeVersions: [{ versionId: 'v', moduleVersion: '1.1.1', manifestJson: MIC, manifestHash: 'h' }],
  functions: ['DIAGNOSTICS', 'TEST_RUNNER'], actions: ['DIAGNOSTICS.READ', 'TEST_RUNNER.EXECUTE'],
  contracts: [{ resourceKey: 'SYSTEM_STATUS', interfaceKind: 'API', fields: 5 }, { resourceKey: 'TEST_RESULTS', interfaceKind: 'API', fields: 6 }],
  compatibility: { checkResult: 'WARN', blocking: 0 },
};
// As measured on TEST: B08 not readable by the API role (UNAVAILABLE), cumulative deadlocks (WARN), fleet over 200 (WARN).
const OPERATIONS: OperationsSnapshot = {
  fleet: { state: 'AVAILABLE', value: Array.from({ length: 201 }, (_, i) => ({ moduleKey: `M${String(i).padStart(3, '0')}`, enabled: true, versionCount: 1, activeVersions: 1 })) },
  activity: { state: 'AVAILABLE', value: { connections: 10, maxConnections: 100, deadlocks: 3, commits: 1000, rollbacks: 2, statsReset: null } },
  audit: { state: 'UNAVAILABLE', sqlstate: '42501' },
};
const repository: SystemTestRepository = { diagnostics: async () => SNAPSHOT, operations: async () => OPERATIONS };

let regressionText: string | null = null;
const host: ModuleHost = {
  protocol: 'TALO-MODULE-HOST-1',
  moduleKey: 'SYSTEM_TEST',
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  session: (handler) => (req: Request, res: Response, next) => { res.locals['requestId'] = ACTOR.requestId; handler(req, res, ACTOR).catch(next); },
  authorize: async () => {},
  evaluate: async () => ({ allowed: true }),
  lifecycle: async () => ({ isEnabled: true, activeVersions: 1 }),
  readOnly: async () => { throw new Error('the repository is faked'); },
  menuRoutes: async () => ['/system-test', '/system-test/runner'],
  inspectManifest: () => ({ intact: true, micValid: true }),
  sqlstate: () => undefined,
  regressionResults: async () => regressionText,
};

let base = '';
let close: () => void = () => {};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createModule(host, { repository }).router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${(address satisfies AddressInfo).port}/api/system-test`;
  close = () => server.close();
});
afterAll(() => close());

const http = async (method: 'GET' | 'POST', path: string) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const keys = (v: unknown) => (v !== null && typeof v === 'object' ? Object.keys(v).sort() : []);
const contractField = (fn: () => unknown): string => {
  try { fn(); } catch (error) { if (error instanceof ContractError) return error.field; throw error; }
  return 'no error';
};

describe('SYSTEM_TEST 1.1.1 API contract (backend answer → frontend parser)', () => {
  it('GET /health → { health } with moduleKey / enabled / activeVersions / checkedAt; parsed by the browser', async () => {
    const res = await http('GET', '/health');
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(['health']);
    const health = parseEnvelope(res.body, 'health', parseHealth);
    expect(health).toMatchObject({ moduleKey: 'SYSTEM_TEST', enabled: true, activeVersions: 1 });
    expect(keys((res.body as { health: unknown }).health)).toEqual(['activeVersions', 'checkedAt', 'enabled', 'moduleKey']);
  });

  it('GET /results before any run → quickCheck null, regression NOT_RUN (no invented result), runner CLI only', async () => {
    regressionText = null;
    const res = await http('GET', '/results');
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(['results']);
    const view = parseEnvelope(res.body, 'results', parseResults);
    expect(view).toEqual({ quickCheck: null, regression: { state: 'NOT_RUN' }, runner: { apiExecution: false, mode: 'CLI' } });
  });

  it('POST /checks/run → { run } with every field the screen reads; 22 checks; WARN / UNAVAILABLE / NOT_TESTED kept, never turned into PASS', async () => {
    const res = await http('POST', '/checks/run');
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(['run']);
    const raw = (res.body as { run: unknown }).run;
    expect(keys(raw)).toEqual(['durationMs', 'finishedAt', 'fleet', 'fleetComplete', 'moduleKey', 'results', 'runId', 'startedAt', 'summary']);
    const run = parseEnvelope(res.body, 'run', parseRun);
    expect(run.results).toHaveLength(22);
    expect(keys(run.summary)).toEqual([...CHECK_STATUSES].sort());
    expect(Object.values(run.summary).reduce((a, b) => a + b, 0)).toBe(22);
    const byKey = Object.fromEntries(run.results.map((r) => [r.key, r.status]));
    expect(byKey).toMatchObject({ AUDIT_DENIED: 'UNAVAILABLE', AUDIT_FAILURE: 'UNAVAILABLE', DB_DEADLOCKS: 'WARN', FLEET_DISCOVERY: 'WARN', DEPLOYMENT_SYNC: 'NOT_TESTED' });
    expect(run.summary.WARN).toBeGreaterThan(0);
    expect([run.fleet.length, run.fleetComplete]).toEqual([200, false]); // capped list is said, not hidden
    expect(run.runId).toBe(ACTOR.requestId);
  });

  it('GET /results after a run → quickCheck of the account + a CLI artifact with null exit code / tests and an ABORTED run', async () => {
    regressionText = JSON.stringify({
      format: REGRESSION_FORMAT, runId: 'R1', startedAt: '2026-10-23T00:00:00.000Z', finishedAt: '2026-10-23T00:01:00.000Z',
      target: { database: 'talo_mos_v4_test', host: '127.0.0.1', nodeEnv: 'test' }, status: 'ABORTED',
      suites: [{ key: 'NON_DB', label: 'Non-DB', command: 'npx vitest run', status: 'NOT_RUN', exitCode: null, durationMs: 0, tests: null, summary: [] }],
    });
    const view = parseEnvelope((await http('GET', '/results')).body, 'results', parseResults);
    expect(view.quickCheck?.results).toHaveLength(22);
    expect(view.regression).toMatchObject({ state: 'AVAILABLE', run: { status: 'ABORTED', suites: [{ status: 'NOT_RUN', exitCode: null, tests: null }] } });
    regressionText = '{ not json';
    expect(parseEnvelope((await http('GET', '/results')).body, 'results', parseResults).regression).toEqual({ state: 'INVALID' });
    regressionText = null;
  });

  it('a mismatch names the field (never a value): missing field, 1.0.x answer, wrong envelope, unknown status, unknown regression state', async () => {
    const res = await http('POST', '/checks/run');
    const run = (res.body as { run: Record<string, unknown> }).run;
    const without = (k: string) => ({ run: Object.fromEntries(Object.entries(run).filter(([key]) => key !== k)) });
    expect(contractField(() => parseEnvelope(without('fleetComplete'), 'run', parseRun))).toBe('run.fleetComplete');
    expect(contractField(() => parseEnvelope(without('durationMs'), 'run', parseRun))).toBe('run.durationMs');
    // The answer of the SYSTEM_TEST 1.0.x backend (no durationMs / fleet / fleetComplete, summary without WARN).
    const legacy = { run: { runId: 'r', startedAt: 's', finishedAt: 'f', moduleKey: 'SYSTEM_TEST', results: [], summary: { PASS: 12, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0 } } };
    expect(contractField(() => parseEnvelope(legacy, 'run', parseRun))).toBe('run.summary.WARN');
    expect(contractField(() => parseEnvelope({ data: run }, 'run', parseRun))).toBe('run');
    const badStatus = { run: { ...run, results: [{ key: 'X', label: 'x', status: 'OK', detail: 'd' }] } };
    expect(contractField(() => parseEnvelope(badStatus, 'run', parseRun))).toBe('run.results[0].status');
    expect(contractField(() => parseRegression({ state: 'DONE' }))).toBe('results.regression.state');
    expect(contractField(() => parseHealth({ moduleKey: 'SYSTEM_TEST', checkedAt: 'x', activeVersions: 1 }))).toBe('health.enabled'); // missing ≠ false
    const message = describeSystemTestFailure({ ok: false, status: 200, code: 'UNEXPECTED_RESPONSE', details: ['POST /api/system-test/checks/run', 'run.fleetComplete (boolean)'], requestId: 'r1' });
    expect(message).toContain('POST /api/system-test/checks/run');
    expect(message).toContain('run.fleetComplete');
    expect(message).toContain('khởi động lại backend');
  });

  it('no table data: the retired Data Viewer routes and any other path are 404; answers carry no rows', async () => {
    for (const path of ['/tables', '/tables/B01/rows', '/tables/B01/rows?page=1&pageSize=2']) expect([path, (await http('GET', path)).status]).toEqual([path, 404]);
    expect((await http('POST', '/regression/run')).status).toBe(404);
    const body = JSON.stringify((await http('POST', '/checks/run')).body);
    expect(body).not.toMatch(/"rows"|"tables"|"columns"/);
  });
});
