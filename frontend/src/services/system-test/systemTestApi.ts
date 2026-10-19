import type { ApiFailure, ApiResult } from '../foundation/foundationApi';
import { describeFailure } from '../foundation/foundationMessages';

// MOD-TEST-01 — client of the SYSTEM_TEST module API (/api/system-test/*). Same rules as the Foundation client: same-
// origin cookie session, no token storage, no retry of a request with side effects, the server decides every permission.
// No request carries SQL, a table name outside B01…B14, a command or a file path.

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_TESTED' | 'UNAVAILABLE';

export interface CheckResult {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface QuickCheckRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  moduleKey: string;
  results: CheckResult[];
  summary: Record<CheckStatus, number>;
}

export interface TableInfo {
  tableKey: string;
  label: string;
  schema: string;
  table: string;
  readable: boolean;
  columns: string[];
  hiddenColumns: string[];
}

export interface TableRows {
  table: TableInfo;
  orderBy: string[];
  page: number;
  pageSize: number;
  totalRows: number;
  rows: (string | null)[][];
}

export interface RegressionSuite {
  key: string;
  label: string;
  command: string;
  status: string;
  exitCode: number | null;
  durationMs: number;
  tests: { passed: number; failed: number; skipped: number } | null;
  summary: string[];
}

export interface RegressionRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  target: { database: string; host: string; nodeEnv: string };
  status: string;
  suites: RegressionSuite[];
}

export type RegressionState = { state: 'NOT_RUN' } | { state: 'INVALID' } | { state: 'AVAILABLE'; run: RegressionRun };

export interface ResultsView {
  quickCheck: QuickCheckRun | null;
  regression: RegressionState;
}

export interface Health {
  moduleKey: string;
  checkedAt: string;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const STATUSES: readonly CheckStatus[] = ['PASS', 'FAIL', 'NOT_TESTED', 'UNAVAILABLE'];

function str(v: Json, key: string): string {
  const value = v[key];
  if (typeof value !== 'string') throw new Error(`field ${key}`);
  return value;
}

function num(v: Json, key: string): number {
  const value = v[key];
  if (typeof value !== 'number') throw new Error(`field ${key}`);
  return value;
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((x): x is string => typeof x === 'string')) throw new Error('strings');
  return v;
}

function obj(v: unknown): Json {
  if (!isObject(v)) throw new Error('object');
  return v;
}

function toCheck(v: unknown): CheckResult {
  const o = obj(v);
  const status = STATUSES.find((s) => s === o.status);
  if (!status) throw new Error('status');
  return { key: str(o, 'key'), label: str(o, 'label'), status, detail: str(o, 'detail') };
}

function toRun(v: unknown): QuickCheckRun {
  const o = obj(v);
  const s = obj(o.summary);
  if (!Array.isArray(o.results)) throw new Error('results');
  return {
    runId: str(o, 'runId'), startedAt: str(o, 'startedAt'), finishedAt: str(o, 'finishedAt'), moduleKey: str(o, 'moduleKey'), results: o.results.map(toCheck),
    summary: { PASS: num(s, 'PASS'), FAIL: num(s, 'FAIL'), NOT_TESTED: num(s, 'NOT_TESTED'), UNAVAILABLE: num(s, 'UNAVAILABLE') },
  };
}

function toTable(v: unknown): TableInfo {
  const o = obj(v);
  if (typeof o.readable !== 'boolean') throw new Error('readable');
  return {
    tableKey: str(o, 'tableKey'), label: str(o, 'label'), schema: str(o, 'schema'), table: str(o, 'table'), readable: o.readable,
    columns: strings(o.columns), hiddenColumns: strings(o.hiddenColumns),
  };
}

function toRows(v: unknown): TableRows {
  const o = obj(v);
  if (!Array.isArray(o.rows)) throw new Error('rows');
  const rows = o.rows.map((r) => {
    if (!Array.isArray(r)) throw new Error('row');
    return r.map((c) => (typeof c === 'string' ? c : null));
  });
  return { table: toTable(o.table), orderBy: strings(o.orderBy), page: num(o, 'page'), pageSize: num(o, 'pageSize'), totalRows: num(o, 'totalRows'), rows };
}

function toSuite(v: unknown): RegressionSuite {
  const o = obj(v);
  const t = o.tests === null ? null : obj(o.tests);
  return {
    key: str(o, 'key'), label: str(o, 'label'), command: str(o, 'command'), status: str(o, 'status'),
    exitCode: typeof o.exitCode === 'number' ? o.exitCode : null, durationMs: num(o, 'durationMs'),
    tests: t ? { passed: num(t, 'passed'), failed: num(t, 'failed'), skipped: num(t, 'skipped') } : null, summary: strings(o.summary),
  };
}

function toRegression(v: unknown): RegressionState {
  const o = obj(v);
  if (o.state === 'NOT_RUN') return { state: 'NOT_RUN' };
  if (o.state !== 'AVAILABLE') return { state: 'INVALID' };
  const r = obj(o.run);
  const target = obj(r.target);
  if (!Array.isArray(r.suites)) throw new Error('suites');
  return {
    state: 'AVAILABLE',
    run: {
      runId: str(r, 'runId'), startedAt: str(r, 'startedAt'), finishedAt: str(r, 'finishedAt'), status: str(r, 'status'), suites: r.suites.map(toSuite),
      target: { database: str(target, 'database'), host: str(target, 'host'), nodeEnv: str(target, 'nodeEnv') },
    },
  };
}

function toResults(v: unknown): ResultsView {
  const o = obj(v);
  return { quickCheck: o.quickCheck === null ? null : toRun(o.quickCheck), regression: toRegression(o.regression) };
}

async function call<T>(method: 'GET' | 'POST', path: string, key: string, parse: (payload: unknown) => T): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/system-test${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok) {
    try {
      return { ok: true, data: parse(isObject(payload) ? payload[key] : undefined) };
    } catch {
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [], requestId: '' };
    }
  }
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const details = isObject(error.details) && Array.isArray(error.details.fields) ? error.details.fields.filter((x): x is string => typeof x === 'string') : [];
  return {
    ok: false, status: response.status, code: typeof error.code === 'string' ? error.code : 'UNKNOWN', details,
    requestId: typeof error.requestId === 'string' ? error.requestId : '',
  };
}

export const systemTestApi = {
  health: () => call('GET', '/health', 'health', (v) => {
    const o = obj(v);
    return { moduleKey: str(o, 'moduleKey'), checkedAt: str(o, 'checkedAt') };
  }),
  runChecks: () => call('POST', '/checks/run', 'run', toRun),
  tables: () => call('GET', '/tables', 'tables', (v) => {
    if (!Array.isArray(v)) throw new Error('tables');
    return v.map(toTable);
  }),
  rows: (tableKey: string, page: number, pageSize: number) =>
    call('GET', `/tables/${encodeURIComponent(tableKey)}/rows?page=${page}&pageSize=${pageSize}`, 'data', toRows),
  results: () => call('GET', '/results', 'results', toResults),
};

const SYSTEM_TEST_TEXT: Record<string, string> = {
  MODULE_UNAVAILABLE: 'Module System Test chưa được bật hoặc không có phiên bản ACTIVE.',
  TABLE_NOT_FOUND: 'Bảng không nằm trong danh sách được phép xem.',
  TABLE_NOT_READABLE: 'Không có quyền xem bảng này.',
};

export function describeSystemTestFailure(failure: ApiFailure): string {
  const own = SYSTEM_TEST_TEXT[failure.code];
  return own ?? describeFailure(failure);
}
