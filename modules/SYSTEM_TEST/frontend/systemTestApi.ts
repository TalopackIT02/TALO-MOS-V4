// Browser client: same-origin session, read-only checks and pre-existing CLI regression artifacts.
export interface ApiFailure { ok: false; status: number; code: string; details: string[]; requestId: string }
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;
export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED' | 'UNAVAILABLE';
export interface CheckResult { key: string; label: string; status: CheckStatus; detail: string }
export interface FleetModule { moduleKey: string; enabled: boolean; versionCount: number; activeVersions: number }
export interface QuickCheckRun {
  runId: string; startedAt: string; finishedAt: string; durationMs: number; moduleKey: string;
  results: CheckResult[]; summary: Record<CheckStatus, number>; fleet: FleetModule[]; fleetComplete: boolean;
}
export interface RegressionSuite {
  key: string; label: string; command: string; status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'NOT_RUN'; exitCode: number | null;
  durationMs: number; tests: { passed: number; failed: number; skipped: number } | null; summary: string[];
}
export interface RegressionRun { runId: string; startedAt: string; finishedAt: string;
  target: { database: string; host: string; nodeEnv: string }; status: 'PASS' | 'FAIL' | 'ABORTED'; suites: RegressionSuite[] }
export type RegressionState = { state: 'NOT_RUN' } | { state: 'INVALID' } | { state: 'AVAILABLE'; run: RegressionRun };
export interface ResultsView { quickCheck: QuickCheckRun | null; regression: RegressionState; runner: { apiExecution: false; mode: 'CLI' } }
export interface Health { moduleKey: string; enabled: boolean; activeVersions: number; checkedAt: string }

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new Error('expected object');
  return x as Json;
};
const str = (x: Json, k: string): string => { if (typeof x[k] !== 'string') throw new Error(k); return x[k] as string; };
const num = (x: Json, k: string): number => { if (typeof x[k] !== 'number' || !Number.isFinite(x[k])) throw new Error(k); return x[k] as number; };
const statuses = ['PASS', 'FAIL', 'WARN', 'NOT_TESTED', 'UNAVAILABLE'] as const;
const check = (v: unknown): CheckResult => {
  const x = obj(v), status = str(x, 'status');
  if (!statuses.includes(status as CheckStatus)) throw new Error('check status');
  return { key: str(x, 'key'), label: str(x, 'label'), status: status as CheckStatus, detail: str(x, 'detail') };
};
const fleet = (v: unknown): FleetModule => {
  const x = obj(v);
  if (typeof x.enabled !== 'boolean') throw new Error('enabled');
  return { moduleKey: str(x,'moduleKey'), enabled: x.enabled, versionCount: num(x,'versionCount'), activeVersions: num(x,'activeVersions') };
};
const quick = (v: unknown): QuickCheckRun => {
  const x = obj(v), s = obj(x.summary);
  if (!Array.isArray(x.results) || !Array.isArray(x.fleet) || typeof x.fleetComplete !== 'boolean') throw new Error('quick result');
  return { runId: str(x,'runId'), startedAt: str(x,'startedAt'), finishedAt: str(x,'finishedAt'),
    durationMs: num(x,'durationMs'), moduleKey: str(x,'moduleKey'), results: x.results.map(check),
    summary: { PASS:num(s,'PASS'), FAIL:num(s,'FAIL'), WARN:num(s,'WARN'), NOT_TESTED:num(s,'NOT_TESTED'), UNAVAILABLE:num(s,'UNAVAILABLE') },
    fleet: x.fleet.map(fleet), fleetComplete: x.fleetComplete };
};
const stringList = (x: unknown): string[] => { if (!Array.isArray(x) || x.some((v) => typeof v !== 'string')) throw new Error('array'); return x; };
const suite = (v: unknown): RegressionSuite => {
  const x = obj(v), status = str(x,'status');
  if (!['PASS','FAIL','TIMEOUT','NOT_RUN'].includes(status)) throw new Error('suite status');
  const t = x.tests === null ? null : obj(x.tests);
  return { key: str(x,'key'), label: str(x,'label'), command: str(x,'command'), status: status as RegressionSuite['status'],
    exitCode: x.exitCode === null ? null : num(x,'exitCode'), durationMs: num(x,'durationMs'),
    tests: t ? {passed:num(t,'passed'), failed:num(t,'failed'), skipped:num(t,'skipped')} : null,
    summary: stringList(x.summary) };
};
const regression = (v: unknown): RegressionState => {
  const x = obj(v);
  if (x.state === 'NOT_RUN') return { state:'NOT_RUN' };
  if (x.state !== 'AVAILABLE') return { state:'INVALID' };
  const run = obj(x.run), target = obj(run.target), status = str(run,'status');
  if (!Array.isArray(run.suites) || !['PASS','FAIL','ABORTED'].includes(status)) throw new Error('regression');
  return { state:'AVAILABLE', run: { runId:str(run,'runId'), startedAt:str(run,'startedAt'), finishedAt:str(run,'finishedAt'),
    target:{database:str(target,'database'),host:str(target,'host'),nodeEnv:str(target,'nodeEnv')},
    status:status as RegressionRun['status'], suites:run.suites.map(suite) } };
};
async function call<T>(method: 'GET' | 'POST', path: string, name: string, parse: (x: unknown) => T): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/system-test${path}`, { method, credentials:'same-origin', cache:'no-store',
      headers: method === 'GET' ? {Accept:'application/json'} : {'Content-Type':'application/json',Accept:'application/json'},
      ...(method === 'POST' ? {body:'{}'} : {}) });
  } catch { return {ok:false,status:0,code:'NETWORK',details:[],requestId:''}; }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.ok) {
    try { return {ok:true,data:parse(obj(payload)[name])}; }
    catch { return {ok:false,status:response.status,code:'UNEXPECTED_RESPONSE',details:[],requestId:''}; }
  }
  let error: Json = {};
  try { error = obj(obj(payload).error); } catch { /* untrusted error body */ }
  let details: string[] = [];
  try { details = stringList(obj(error.details).fields); } catch { /* optional */ }
  return {ok:false,status:response.status,code:typeof error.code === 'string'?error.code:'UNKNOWN',
    details,requestId:typeof error.requestId === 'string'?error.requestId:''};
}
export const systemTestApi = {
  health: () => call('GET','/health','health', (v) => {
    const x = obj(v);
    return {moduleKey:str(x,'moduleKey'),checkedAt:str(x,'checkedAt'),enabled:x.enabled===true,activeVersions:num(x,'activeVersions')};
  }),
  runChecks: () => call('POST','/checks/run','run',quick),
  results: () => call('GET','/results','results',(v) => {
    const x=obj(v); return {quickCheck:x.quickCheck===null?null:quick(x.quickCheck),regression:regression(x.regression),
      runner:{apiExecution:false as const,mode:'CLI' as const}};
  }),
};
const CODES: Record<string,string> = {
  MODULE_UNAVAILABLE:'SYSTEM_TEST chưa ENABLED hoặc không có đúng một phiên bản ACTIVE.',
  VALIDATION_ERROR:'Payload kiểm tra không hợp lệ.',
  SESSION_INVALID:'Phiên đăng nhập đã hết hạn.',
  PASSWORD_CHANGE_REQUIRED:'Cần đổi mật khẩu để tiếp tục.',
  FORBIDDEN:'Tài khoản chưa được cấp quyền cho chức năng này.',
  SERVICE_BUSY:'Không truy vấn được dịch vụ. Không coi là PASS.',
  NETWORK:'Không kết nối được backend.',
  UNEXPECTED_RESPONSE:'API trả dữ liệu không đúng hợp đồng.',
};
export function describeSystemTestFailure(e: ApiFailure): string {
  return `${CODES[e.code] ?? `Yêu cầu không thành công (HTTP ${e.status}).`}${e.requestId ? ` Mã tham chiếu: ${e.requestId}.` : ''}`;
}
