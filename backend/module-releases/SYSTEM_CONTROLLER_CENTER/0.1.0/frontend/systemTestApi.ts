// Browser client: same-origin session, read-only checks and pre-existing CLI regression artifacts.
// API contract 1.1.1 (one source for the browser and the contract tests): every 200 answer is validated field by field.
// A mismatch is never patched with a default (no missing value becomes PASS / normal): the call fails with
// UNEXPECTED_RESPONSE, the endpoint and the FIELD PATH (never a value) are kept in `details` for the developer.
export interface ApiFailure { ok: false; status: number; code: string; details: string[]; requestId: string }
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;
export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED' | 'UNAVAILABLE';
export interface CheckResult { key: string; label: string; status: CheckStatus; detail: string }
export interface FleetModule { moduleKey: string; enabled: boolean; versionCount: number; activeVersions: number }
export interface QuickCheckRun {
  runId: string; startedAt: string; finishedAt: string; durationMs: number; moduleKey: string;
  results: CheckResult[]; summary: Record<CheckStatus, number>; fleet: FleetModule[]; fleetComplete: boolean;
}
export type SuiteStatus = 'PASS' | 'FAIL' | 'TIMEOUT' | 'NOT_RUN';
export interface RegressionSuite {
  key: string; label: string; command: string; status: SuiteStatus; exitCode: number | null;
  durationMs: number; tests: { passed: number; failed: number; skipped: number } | null; summary: string[];
}
export type RunStatus = 'PASS' | 'FAIL' | 'ABORTED';
export interface RegressionRun { runId: string; startedAt: string; finishedAt: string;
  target: { database: string; host: string; nodeEnv: string }; status: RunStatus; suites: RegressionSuite[] }
export type RegressionState = { state: 'NOT_RUN' } | { state: 'INVALID' } | { state: 'AVAILABLE'; run: RegressionRun };
export interface ResultsView { quickCheck: QuickCheckRun | null; regression: RegressionState; runner: { apiExecution: false; mode: 'CLI' } }
export interface Health { moduleKey: string; enabled: boolean; activeVersions: number; checkedAt: string }

// A contract mismatch: `field` is the path inside the response body (e.g. "run.fleetComplete"), never its value.
export class ContractError extends Error {
  constructor(readonly field: string, readonly expected: string) {
    super(`${field}: ${expected}`);
    this.name = 'ContractError';
  }
}

type Json = Record<string, unknown>;
const isJson = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x);
function obj(x: unknown, at: string): Json {
  if (!isJson(x)) throw new ContractError(at, 'object');
  return x;
}
function arr(x: Json, k: string, at: string): unknown[] {
  const v = x[k];
  if (!Array.isArray(v)) throw new ContractError(`${at}.${k}`, 'array');
  return v;
}
function str(x: Json, k: string, at: string): string {
  const v = x[k];
  if (typeof v !== 'string') throw new ContractError(`${at}.${k}`, 'string');
  return v;
}
function num(x: Json, k: string, at: string): number {
  const v = x[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ContractError(`${at}.${k}`, 'number');
  return v;
}
function bool(x: Json, k: string, at: string): boolean {
  const v = x[k];
  if (typeof v !== 'boolean') throw new ContractError(`${at}.${k}`, 'boolean');
  return v;
}
function oneOf<T extends string>(x: Json, k: string, values: readonly T[], at: string): T {
  const v = x[k];
  const found = values.find((value) => value === v);
  if (found === undefined) throw new ContractError(`${at}.${k}`, values.join('|'));
  return found;
}
const nullableNum = (x: Json, k: string, at: string): number | null => (x[k] === null ? null : num(x, k, at));

export const CHECK_STATUSES: readonly CheckStatus[] = ['PASS', 'FAIL', 'WARN', 'NOT_TESTED', 'UNAVAILABLE'];
const SUITE_STATUSES: readonly SuiteStatus[] = ['PASS', 'FAIL', 'TIMEOUT', 'NOT_RUN'];
const RUN_STATUSES: readonly RunStatus[] = ['PASS', 'FAIL', 'ABORTED'];

function check(v: unknown, at: string): CheckResult {
  const x = obj(v, at);
  return { key: str(x, 'key', at), label: str(x, 'label', at), status: oneOf(x, 'status', CHECK_STATUSES, at), detail: str(x, 'detail', at) };
}
function fleetModule(v: unknown, at: string): FleetModule {
  const x = obj(v, at);
  return { moduleKey: str(x, 'moduleKey', at), enabled: bool(x, 'enabled', at), versionCount: num(x, 'versionCount', at), activeVersions: num(x, 'activeVersions', at) };
}
export function parseHealth(v: unknown, at = 'health'): Health {
  const x = obj(v, at);
  return { moduleKey: str(x, 'moduleKey', at), checkedAt: str(x, 'checkedAt', at), enabled: bool(x, 'enabled', at), activeVersions: num(x, 'activeVersions', at) };
}
export function parseRun(v: unknown, at = 'run'): QuickCheckRun {
  const x = obj(v, at);
  const s = obj(x['summary'], `${at}.summary`);
  const summary = { PASS: 0, FAIL: 0, WARN: 0, NOT_TESTED: 0, UNAVAILABLE: 0 };
  for (const status of CHECK_STATUSES) summary[status] = num(s, status, `${at}.summary`);
  return {
    runId: str(x, 'runId', at), startedAt: str(x, 'startedAt', at), finishedAt: str(x, 'finishedAt', at), durationMs: num(x, 'durationMs', at),
    moduleKey: str(x, 'moduleKey', at), results: arr(x, 'results', at).map((r, i) => check(r, `${at}.results[${i}]`)), summary,
    fleet: arr(x, 'fleet', at).map((m, i) => fleetModule(m, `${at}.fleet[${i}]`)), fleetComplete: bool(x, 'fleetComplete', at),
  };
}
function suite(v: unknown, at: string): RegressionSuite {
  const x = obj(v, at);
  const t = x['tests'] === null ? null : obj(x['tests'], `${at}.tests`);
  return {
    key: str(x, 'key', at), label: str(x, 'label', at), command: str(x, 'command', at), status: oneOf(x, 'status', SUITE_STATUSES, at),
    exitCode: nullableNum(x, 'exitCode', at), durationMs: num(x, 'durationMs', at),
    tests: t ? { passed: num(t, 'passed', `${at}.tests`), failed: num(t, 'failed', `${at}.tests`), skipped: num(t, 'skipped', `${at}.tests`) } : null,
    summary: arr(x, 'summary', at).map((line, i) => { if (typeof line !== 'string') throw new ContractError(`${at}.summary[${i}]`, 'string'); return line; }),
  };
}
// The server answers NOT_RUN / INVALID / AVAILABLE; any other state is a contract error (never shown as a result).
export function parseRegression(v: unknown, at = 'results.regression'): RegressionState {
  const x = obj(v, at);
  const state = oneOf(x, 'state', ['NOT_RUN', 'INVALID', 'AVAILABLE'] as const, at);
  if (state !== 'AVAILABLE') return { state };
  const run = obj(x['run'], `${at}.run`);
  const target = obj(run['target'], `${at}.run.target`);
  return { state, run: {
    runId: str(run, 'runId', `${at}.run`), startedAt: str(run, 'startedAt', `${at}.run`), finishedAt: str(run, 'finishedAt', `${at}.run`),
    target: { database: str(target, 'database', `${at}.run.target`), host: str(target, 'host', `${at}.run.target`), nodeEnv: str(target, 'nodeEnv', `${at}.run.target`) },
    status: oneOf(run, 'status', RUN_STATUSES, `${at}.run`), suites: arr(run, 'suites', `${at}.run`).map((s, i) => suite(s, `${at}.run.suites[${i}]`)),
  } };
}
export function parseResults(v: unknown, at = 'results'): ResultsView {
  const x = obj(v, at);
  const runner = obj(x['runner'], `${at}.runner`);
  if (runner['apiExecution'] !== false) throw new ContractError(`${at}.runner.apiExecution`, 'false');
  if (runner['mode'] !== 'CLI') throw new ContractError(`${at}.runner.mode`, 'CLI');
  return {
    quickCheck: x['quickCheck'] === null ? null : parseRun(x['quickCheck'], `${at}.quickCheck`),
    regression: parseRegression(x['regression'], `${at}.regression`),
    runner: { apiExecution: false, mode: 'CLI' },
  };
}
// The envelope of each endpoint: { health } / { run } / { results }.
export function parseEnvelope<T>(payload: unknown, name: string, parse: (v: unknown, at: string) => T): T {
  const body = obj(payload, 'body');
  if (!(name in body)) throw new ContractError(name, 'present');
  return parse(body[name], name);
}

async function call<T>(method: 'GET' | 'POST', path: string, name: string, parse: (x: unknown, at: string) => T): Promise<ApiResult<T>> {
  const endpoint = `${method} /api/system-controller-center${path}`;
  let response: Response;
  try {
    response = await fetch(`/api/system-controller-center${path}`, { method, credentials:'same-origin', cache:'no-store',
      headers: method === 'GET' ? {Accept:'application/json'} : {'Content-Type':'application/json',Accept:'application/json'},
      ...(method === 'POST' ? {body:'{}'} : {}) });
  } catch { return {ok:false,status:0,code:'NETWORK',details:[endpoint],requestId:''}; }
  let payload: unknown = null;
  let jsonBody = true;
  try { payload = await response.json(); } catch { jsonBody = false; }
  const requestId = response.headers.get('x-request-id') ?? '';
  if (response.ok) {
    try {
      if (!jsonBody) throw new ContractError('body', 'JSON');
      return {ok:true,data:parseEnvelope(payload,name,parse)};
    } catch (error) {
      const field = error instanceof ContractError ? `${error.field} (${error.expected})` : 'body';
      // Developer diagnostics: endpoint + field path only (no value, no cookie, no token, no row data).
      console.warn('[SYSTEM_CONTROLLER_CENTER] API contract mismatch', { endpoint, field, requestId });
      return {ok:false,status:response.status,code:'UNEXPECTED_RESPONSE',details:[endpoint,field],requestId};
    }
  }
  const error = isJson(payload) && isJson(payload['error']) ? payload['error'] : {};
  const detailsBody = isJson(error['details']) ? error['details'] : {};
  const fields = Array.isArray(detailsBody['fields']) ? detailsBody['fields'].filter((f): f is string => typeof f === 'string') : [];
  return {ok:false,status:response.status,code:typeof error['code'] === 'string'?error['code']:'UNKNOWN',
    details:fields,requestId:typeof error['requestId'] === 'string'?error['requestId']:requestId};
}
export const systemTestApi = {
  health: () => call('GET','/health','health',parseHealth),
  runChecks: () => call('POST','/checks/run','run',parseRun),
  results: () => call('GET','/results','results',parseResults),
};
const CODES: Record<string,string> = {
  MODULE_UNAVAILABLE:'SYSTEM_CONTROLLER_CENTER chưa ENABLED hoặc không có đúng một phiên bản ACTIVE.',
  VALIDATION_ERROR:'Payload kiểm tra không hợp lệ.',
  SESSION_INVALID:'Phiên đăng nhập đã hết hạn.',
  PASSWORD_CHANGE_REQUIRED:'Cần đổi mật khẩu để tiếp tục.',
  FORBIDDEN:'Tài khoản chưa được cấp quyền cho chức năng này.',
  SERVICE_BUSY:'Không truy vấn được dịch vụ. Không coi là PASS.',
  NETWORK:'Không kết nối được backend.',
  UNEXPECTED_RESPONSE:'API trả dữ liệu không đúng hợp đồng.',
};
export function describeSystemTestFailure(e: ApiFailure): string {
  const base = CODES[e.code] ?? `Yêu cầu không thành công (HTTP ${e.status}).`;
  const contract = e.code === 'UNEXPECTED_RESPONSE' && e.details.length > 0
    ? ` ${e.details.join(' — trường ')}. Kết quả không được hiển thị; nếu module vừa được cập nhật, hãy khởi động lại backend để nạp phiên bản mới.` : '';
  return `${base}${contract}${e.requestId ? ` Mã tham chiếu: ${e.requestId}.` : ''}`;
}
