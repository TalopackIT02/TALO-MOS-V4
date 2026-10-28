import type { ApiResult } from './foundationApi';

// FMI-01 — Manual Module Scan client. POST /api/foundation/module-packages/scan is called ONLY from the "Quét Module"
// button (never on mount, navigation, login or a timer) and never retried automatically. GET …/scans/:scanId only reads
// a stored snapshot. Every 200 body is validated field by field: a mismatch is UNEXPECTED_RESPONSE with the endpoint and
// the FIELD PATH in `details` (never a value), and nothing of that body is shown.

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNAVAILABLE';
export type Classification = 'NEW_MODULE' | 'UPGRADE_CANDIDATE' | 'EXISTING_VERSION' | 'OLDER_PACKAGE' | 'INVALID_PACKAGE' | 'REGISTRY_UNKNOWN';
export type MicFormat = 'JSON' | 'LEGACY_TS' | 'MISSING' | 'INVALID';
export type VersionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED';
export type Severity = 'WARNING' | 'ERROR' | 'UNAVAILABLE';

export interface ScanCheck { id: string; status: CheckStatus; code: string; path: string | null; message: string }
export interface ScanIssue {
  checkId: string; code: string; severity: Severity; message: string;
  path: string | null; field: string | null; expected: string | null; actual: string | null; remediation: string | null;
}
export interface ScannedModule {
  folder: string; moduleKey: string | null; moduleName: string | null; packageVersion: string | null; classification: Classification;
  foundationVersionStatus: VersionStatus | null; registeredVersions: { moduleVersion: string; status: VersionStatus }[]; scanStatus: CheckStatus;
  eligibleForPreflight: boolean; packageHash: string | null; micFormat: MicFormat; fileCount: number; routes: string[]; checks: ScanCheck[]; issues: ScanIssue[];
}
export interface ScanSummary { total: number; passed: number; warnings: number; failed: number; unavailable: number }
export interface ScanReport {
  scanId: string; status: 'COMPLETED'; scannedAt: string; durationMs: number; registryAvailable: boolean; summary: ScanSummary; modules: ScannedModule[];
}

export class ContractError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = 'ContractError';
  }
}
type Json = Record<string, unknown>;
const isJson = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
function obj(x: unknown, at: string): Json {
  if (!isJson(x)) throw new ContractError(at);
  return x;
}
function str(x: Json, k: string, at: string): string {
  const v = x[k];
  if (typeof v !== 'string') throw new ContractError(`${at}.${k}`);
  return v;
}
function strOrNull(x: Json, k: string, at: string): string | null {
  const v = x[k];
  if (v === null) return null;
  if (typeof v !== 'string') throw new ContractError(`${at}.${k}`);
  return v;
}
// Optional string field of an issue: absent or a string.
function opt(x: Json, k: string, at: string): string | null {
  const v = x[k];
  if (v === undefined) return null;
  if (typeof v !== 'string') throw new ContractError(`${at}.${k}`);
  return v;
}
function num(x: Json, k: string, at: string): number {
  const v = x[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new ContractError(`${at}.${k}`);
  return v;
}
function bool(x: Json, k: string, at: string): boolean {
  const v = x[k];
  if (typeof v !== 'boolean') throw new ContractError(`${at}.${k}`);
  return v;
}
function arr(x: Json, k: string, at: string): unknown[] {
  const v = x[k];
  if (!Array.isArray(v)) throw new ContractError(`${at}.${k}`);
  return v;
}
function oneOf<T extends string>(x: Json, k: string, values: readonly T[], at: string): T {
  const v = x[k];
  const found = values.find((value) => value === v);
  if (found === undefined) throw new ContractError(`${at}.${k}`);
  return found;
}

const CHECK: readonly CheckStatus[] = ['PASS', 'WARN', 'FAIL', 'UNAVAILABLE'];
const CLASSES: readonly Classification[] = ['NEW_MODULE', 'UPGRADE_CANDIDATE', 'EXISTING_VERSION', 'OLDER_PACKAGE', 'INVALID_PACKAGE', 'REGISTRY_UNKNOWN'];
const MIC: readonly MicFormat[] = ['JSON', 'LEGACY_TS', 'MISSING', 'INVALID'];
const VERSIONS: readonly VersionStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'];
const SEVERITIES: readonly Severity[] = ['WARNING', 'ERROR', 'UNAVAILABLE'];
const HEX64 = /^[0-9a-f]{64}$/;

function parseModule(v: unknown, at: string): ScannedModule {
  const x = obj(v, at);
  const hash = strOrNull(x, 'packageHash', at);
  if (hash !== null && !HEX64.test(hash)) throw new ContractError(`${at}.packageHash`);
  const versionStatus = x['foundationVersionStatus'] === null ? null : oneOf(x, 'foundationVersionStatus', VERSIONS, at);
  return {
    folder: str(x, 'folder', at), moduleKey: strOrNull(x, 'moduleKey', at), moduleName: strOrNull(x, 'moduleName', at), packageVersion: strOrNull(x, 'packageVersion', at),
    classification: oneOf(x, 'classification', CLASSES, at), foundationVersionStatus: versionStatus,
    registeredVersions: arr(x, 'registeredVersions', at).map((r, i) => {
      const o = obj(r, `${at}.registeredVersions[${i}]`);
      return { moduleVersion: str(o, 'moduleVersion', `${at}.registeredVersions[${i}]`), status: oneOf(o, 'status', VERSIONS, `${at}.registeredVersions[${i}]`) };
    }),
    scanStatus: oneOf(x, 'scanStatus', CHECK, at), eligibleForPreflight: bool(x, 'eligibleForPreflight', at), packageHash: hash,
    micFormat: oneOf(x, 'micFormat', MIC, at), fileCount: num(x, 'fileCount', at),
    routes: arr(x, 'routes', at).map((r, i) => { if (typeof r !== 'string') throw new ContractError(`${at}.routes[${i}]`); return r; }),
    checks: arr(x, 'checks', at).map((c, i) => {
      const p = `${at}.checks[${i}]`;
      const o = obj(c, p);
      return { id: str(o, 'id', p), status: oneOf(o, 'status', CHECK, p), code: str(o, 'code', p), path: strOrNull(o, 'path', p), message: str(o, 'message', p) };
    }),
    issues: arr(x, 'issues', at).map((c, i) => {
      const p = `${at}.issues[${i}]`;
      const o = obj(c, p);
      return {
        checkId: str(o, 'checkId', p), code: str(o, 'code', p), severity: oneOf(o, 'severity', SEVERITIES, p), message: str(o, 'message', p),
        path: opt(o, 'path', p), field: opt(o, 'field', p), expected: opt(o, 'expected', p), actual: opt(o, 'actual', p), remediation: opt(o, 'remediation', p),
      };
    }),
  };
}

export function parseScanReport(v: unknown, at = 'body'): ScanReport {
  const x = obj(v, at);
  if (x['status'] !== 'COMPLETED') throw new ContractError(`${at}.status`);
  const s = obj(x['summary'], `${at}.summary`);
  const summary = {
    total: num(s, 'total', `${at}.summary`), passed: num(s, 'passed', `${at}.summary`), warnings: num(s, 'warnings', `${at}.summary`),
    failed: num(s, 'failed', `${at}.summary`), unavailable: num(s, 'unavailable', `${at}.summary`),
  };
  const modules = arr(x, 'modules', at).map((m, i) => parseModule(m, `${at}.modules[${i}]`));
  if (summary.total !== modules.length || summary.passed + summary.warnings + summary.failed + summary.unavailable !== summary.total) throw new ContractError(`${at}.summary`);
  return {
    scanId: str(x, 'scanId', at), status: 'COMPLETED', scannedAt: str(x, 'scannedAt', at), durationMs: num(x, 'durationMs', at),
    registryAvailable: bool(x, 'registryAvailable', at), summary, modules,
  };
}

async function call(method: 'GET' | 'POST', path: string): Promise<ApiResult<ScanReport>> {
  const endpoint = `${method} /api${path}`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  const requestId = response.headers.get('x-request-id') ?? '';
  if (response.ok) {
    try {
      return { ok: true, data: parseScanReport(payload) };
    } catch (error) {
      const field = error instanceof ContractError ? error.field : 'body';
      console.warn('[FMI-01] module scan API contract mismatch', { endpoint, field, requestId }); // developer diagnostics: no values
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [endpoint, field], requestId };
    }
  }
  const error = isJson(payload) && isJson(payload['error']) ? payload['error'] : {};
  return { ok: false, status: response.status, code: typeof error['code'] === 'string' ? error['code'] : 'UNKNOWN', details: [], requestId: typeof error['requestId'] === 'string' ? error['requestId'] : requestId };
}

export const moduleScanApi = {
  scan: () => call('POST', '/foundation/module-packages/scan'),
  snapshot: (scanId: string) => call('GET', `/foundation/module-packages/scans/${encodeURIComponent(scanId)}`),
};

// ------------------------------------------------------------------------------------------------------------------
// FMI-02 / FMI-03 — Candidate Workspace, "Kiểm tra & Chạy thử" (preflight) and "Cài đặt & Kích hoạt" (installer).
// Bodies carry ids and fixed values only. Polling of a run is driven by the screen (bounded); nothing here scans
// modules/ or retries by itself. 200 bodies are validated field by field (UNEXPECTED_RESPONSE + field path).
export type CandidateStatus = 'SCANNED' | 'VALIDATING' | 'NEEDS_FIX' | 'READY' | 'INVALIDATED' | 'CANCELLED' | 'ERROR';
export type PreflightStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_TESTED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
export interface Candidate {
  candidateId: string; moduleKey: string; moduleName: string; packageVersion: string; folder: string; scanId: string; sourceHash: string;
  classification: string; status: CandidateStatus; createdAt: string; updatedAt: string; latestRunId: string | null; readyRunId: string | null;
  latestInstallId: string | null;
}
export interface CheckIssueView { message: string; path: string | null; field: string | null; expected: string | null; actual: string | null }
export interface PreflightCheckView {
  id: string; key: string; label: string; required: boolean; status: PreflightStatus; detail: string; startedAt: string | null; finishedAt: string | null; durationMs: number;
  exitCode: number | null; logHash: string | null; issues: CheckIssueView[]; limitations: string[];
}
export interface PreflightRunView {
  runId: string; candidateId: string; moduleKey: string; packageVersion: string; packageHash: string; status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  result: 'READY' | 'NEEDS_FIX' | 'INVALIDATED' | null; startedAt: string; finishedAt: string | null; environment: { database: string; nodeEnv: string };
  checks: PreflightCheckView[]; reportHash: string | null; limitations: string[];
}
export type InstallState = 'PREPARED' | 'BLOCKED' | 'PREPARING' | 'STAGED' | 'PUBLISHING' | 'AWAITING_RESTART' | 'CUTTING_OVER' | 'POSTCHECK'
  | 'INSTALLED_ACTIVE' | 'POSTCHECK_INCOMPLETE' | 'RECOVERY_REQUIRED' | 'RECOVERY_AWAITING_RESTART' | 'RECOVERED' | 'FAILED_SAFE' | 'EXPIRED';
export interface Installation {
  installId: string; candidateId: string; moduleKey: string; packageVersion: string; packageHash: string; classification: string; state: InstallState;
  // An upgrade journal carries a recovery point (rollback path); a NEW_MODULE one does not.
  hasRecoveryPoint: boolean;
  expiresAt: string; blockers: { code: string; message: string }[]; warnings: string[];
  steps: { key: string; label: string; status: 'PENDING' | 'DONE' | 'SKIPPED' | 'FAILED'; at: string | null; detail: string }[];
  postcheck: { key: string; status: 'PASS' | 'FAIL' | 'NOT_TESTED'; detail: string }[]; recovery: string[];
  micDiff: { section: string; draft: number | null; candidate: number; changed: boolean }[];
  navigationPlan: { area: string; menu: string; links: { functionKey: string; title: string; developer: boolean }[] } | null;
  nextActions: string[];
}
export interface ReleaseView { moduleKey: string; packageVersion: string; packageHash: string | null }
export interface RuntimeReleaseView {
  backend: ReleaseView[]; frontend: ReleaseView[]; lock: ReleaseView[]; matches: boolean; environment: { database: string; nodeEnv: string }; supervisor: string;
}

const CANDIDATE_STATUSES: readonly CandidateStatus[] = ['SCANNED', 'VALIDATING', 'NEEDS_FIX', 'READY', 'INVALIDATED', 'CANCELLED', 'ERROR'];
const PF_STATUSES: readonly PreflightStatus[] = ['PASS', 'WARN', 'FAIL', 'NOT_TESTED', 'UNAVAILABLE', 'NOT_APPLICABLE'];
const INSTALL_STATES: readonly InstallState[] = ['PREPARED', 'BLOCKED', 'PREPARING', 'STAGED', 'PUBLISHING', 'AWAITING_RESTART', 'CUTTING_OVER', 'POSTCHECK',
  'INSTALLED_ACTIVE', 'POSTCHECK_INCOMPLETE', 'RECOVERY_REQUIRED', 'RECOVERY_AWAITING_RESTART', 'RECOVERED', 'FAILED_SAFE', 'EXPIRED'];
const strs = (x: Json, k: string, at: string): string[] => arr(x, k, at).map((v, i) => {
  if (typeof v !== 'string') throw new ContractError(`${at}.${k}[${i}]`);
  return v;
});
const numOrNull = (x: Json, k: string, at: string): number | null => {
  const v = x[k];
  if (v === null) return null;
  if (typeof v !== 'number') throw new ContractError(`${at}.${k}`);
  return v;
};

export function parseCandidate(v: unknown, at = 'candidate'): Candidate {
  const x = obj(v, at);
  return {
    candidateId: str(x, 'candidateId', at), moduleKey: str(x, 'moduleKey', at), moduleName: str(x, 'moduleName', at), packageVersion: str(x, 'packageVersion', at),
    folder: str(x, 'folder', at), scanId: str(x, 'scanId', at), sourceHash: str(x, 'sourceHash', at), classification: str(x, 'classification', at),
    status: oneOf(x, 'status', CANDIDATE_STATUSES, at), createdAt: str(x, 'createdAt', at), updatedAt: str(x, 'updatedAt', at),
    latestRunId: strOrNull(x, 'latestRunId', at), readyRunId: strOrNull(x, 'readyRunId', at),
    latestInstallId: x['latestInstallId'] === undefined ? null : strOrNull(x, 'latestInstallId', at),
  };
}

export function parseRun(v: unknown, at = 'run'): PreflightRunView {
  const x = obj(v, at);
  const env = obj(x['environment'], `${at}.environment`);
  const result = x['result'] === null ? null : oneOf(x, 'result', ['READY', 'NEEDS_FIX', 'INVALIDATED'] as const, at);
  return {
    runId: str(x, 'runId', at), candidateId: str(x, 'candidateId', at), moduleKey: str(x, 'moduleKey', at), packageVersion: str(x, 'packageVersion', at),
    packageHash: str(x, 'packageHash', at), status: oneOf(x, 'status', ['RUNNING', 'COMPLETED', 'ERROR'] as const, at), result,
    startedAt: str(x, 'startedAt', at), finishedAt: strOrNull(x, 'finishedAt', at), reportHash: strOrNull(x, 'reportHash', at),
    environment: { database: str(env, 'database', `${at}.environment`), nodeEnv: str(env, 'nodeEnv', `${at}.environment`) },
    limitations: strs(x, 'limitations', at),
    checks: arr(x, 'checks', at).map((c, i) => {
      const p = `${at}.checks[${i}]`;
      const o = obj(c, p);
      return {
        id: str(o, 'id', p), key: str(o, 'key', p), label: str(o, 'label', p), required: bool(o, 'required', p), status: oneOf(o, 'status', PF_STATUSES, p), detail: str(o, 'detail', p),
        startedAt: strOrNull(o, 'startedAt', p), finishedAt: strOrNull(o, 'finishedAt', p), durationMs: num(o, 'durationMs', p), exitCode: numOrNull(o, 'exitCode', p),
        logHash: strOrNull(o, 'logHash', p), limitations: strs(o, 'limitations', p),
        issues: arr(o, 'issues', p).map((s, j) => {
          const q = `${p}.issues[${j}]`;
          const io = obj(s, q);
          return { message: str(io, 'message', q), path: opt(io, 'path', q), field: opt(io, 'field', q), expected: opt(io, 'expected', q), actual: opt(io, 'actual', q) };
        }),
      };
    }),
  };
}

export function parseInstallation(v: unknown, at = 'installation'): Installation {
  const x = obj(v, at);
  return {
    installId: str(x, 'installId', at), candidateId: str(x, 'candidateId', at), moduleKey: str(x, 'moduleKey', at), packageVersion: str(x, 'packageVersion', at),
    packageHash: str(x, 'packageHash', at), classification: str(x, 'classification', at), state: oneOf(x, 'state', INSTALL_STATES, at), expiresAt: str(x, 'expiresAt', at),
    hasRecoveryPoint: x['recoveryPoint'] !== undefined && x['recoveryPoint'] !== null,
    blockers: arr(x, 'blockers', at).map((b, i) => {
      const o = obj(b, `${at}.blockers[${i}]`);
      return { code: str(o, 'code', `${at}.blockers[${i}]`), message: str(o, 'message', `${at}.blockers[${i}]`) };
    }),
    warnings: strs(x, 'warnings', at),
    steps: arr(x, 'steps', at).map((s, i) => {
      const p = `${at}.steps[${i}]`;
      const o = obj(s, p);
      return { key: str(o, 'key', p), label: str(o, 'label', p), status: oneOf(o, 'status', ['PENDING', 'DONE', 'SKIPPED', 'FAILED'] as const, p), at: strOrNull(o, 'at', p), detail: str(o, 'detail', p) };
    }),
    postcheck: arr(x, 'postcheck', at).map((s, i) => {
      const p = `${at}.postcheck[${i}]`;
      const o = obj(s, p);
      return { key: str(o, 'key', p), status: oneOf(o, 'status', ['PASS', 'FAIL', 'NOT_TESTED'] as const, p), detail: str(o, 'detail', p) };
    }),
    recovery: strs(x, 'recovery', at),
    micDiff: arr(x, 'micDiff', at).map((d, i) => {
      const p = `${at}.micDiff[${i}]`;
      const o = obj(d, p);
      return { section: str(o, 'section', p), draft: o['draft'] === null ? null : num(o, 'draft', p), candidate: num(o, 'candidate', p), changed: bool(o, 'changed', p) };
    }),
    navigationPlan: x['navigationPlan'] === null ? null : (() => {
      const p = `${at}.navigationPlan`;
      const o = obj(x['navigationPlan'], p);
      return { area: str(o, 'area', p), menu: str(o, 'menu', p), links: arr(o, 'links', p).map((l, i) => {
        const q = `${p}.links[${i}]`;
        const lo = obj(l, q);
        return { functionKey: str(lo, 'functionKey', q), title: str(lo, 'title', q), developer: bool(lo, 'developer', q) };
      }) };
    })(),
    nextActions: strs(x, 'nextActions', at),
  };
}

function release(v: unknown, at: string): ReleaseView {
  const o = obj(v, at);
  return { moduleKey: str(o, 'moduleKey', at), packageVersion: str(o, 'packageVersion', at), packageHash: strOrNull(o, 'packageHash', at) };
}
export function parseRuntime(v: unknown, at = 'runtime'): RuntimeReleaseView {
  const x = obj(v, at);
  const env = obj(x['environment'], `${at}.environment`);
  return {
    backend: arr(x, 'backend', at).map((r, i) => release(r, `${at}.backend[${i}]`)), frontend: arr(x, 'frontend', at).map((r, i) => release(r, `${at}.frontend[${i}]`)),
    lock: arr(x, 'lock', at).map((r, i) => release(r, `${at}.lock[${i}]`)), matches: bool(x, 'matches', at), supervisor: str(x, 'supervisor', at),
    environment: { database: str(env, 'database', `${at}.environment`), nodeEnv: str(env, 'nodeEnv', `${at}.environment`) },
  };
}

async function jsonCall<T>(method: 'GET' | 'POST', path: string, body: object | undefined, parse: (payload: Json) => T): Promise<ApiResult<T>> {
  const endpoint = `${method} /api${path}`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  const requestId = response.headers.get('x-request-id') ?? '';
  if (response.ok) {
    try {
      return { ok: true, data: parse(obj(payload, 'body')) };
    } catch (error) {
      const field = error instanceof ContractError ? error.field : 'body';
      console.warn('[FMI-02/03] installer API contract mismatch', { endpoint, field, requestId }); // developer diagnostics: no values
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [endpoint, field], requestId };
    }
  }
  const error = isJson(payload) && isJson(payload['error']) ? payload['error'] : {};
  const det = isJson(error['details']) ? error['details'] : {};
  const details = [...(Array.isArray(det['blockers']) ? det['blockers'] : []), ...(Array.isArray(det['fields']) ? det['fields'] : [])].filter((d): d is string => typeof d === 'string');
  return { ok: false, status: response.status, code: typeof error['code'] === 'string' ? error['code'] : 'UNKNOWN', details, requestId: typeof error['requestId'] === 'string' ? error['requestId'] : requestId };
}

// Report download (same-origin session): the file is handed to the browser as an attachment.
async function download(path: string): Promise<ApiResult<string>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  if (!response.ok) {
    let code = 'UNKNOWN';
    try {
      const p: unknown = await response.json();
      if (isJson(p) && isJson(p['error']) && typeof p['error']['code'] === 'string') code = p['error']['code'];
    } catch { /* not JSON */ }
    return { ok: false, status: response.status, code, details: [], requestId: response.headers.get('x-request-id') ?? '' };
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'report.txt';
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, data: name };
}

const CANDIDATES = '/foundation/module-candidates';
const enc = encodeURIComponent;
export const installerApi = {
  createCandidate: (scanId: string, moduleKey: string) => jsonCall('POST', CANDIDATES, { scanId, moduleKey }, (b) => parseCandidate(b['candidate'])),
  listCandidates: () => jsonCall('GET', CANDIDATES, undefined, (b) => arr(b, 'candidates', 'body').map((c, i) => parseCandidate(c, `candidates[${i}]`))),
  getCandidate: (id: string) => jsonCall('GET', `${CANDIDATES}/${enc(id)}`, undefined, (b) => parseCandidate(b['candidate'])),
  startPreflight: (id: string) => jsonCall('POST', `${CANDIDATES}/${enc(id)}/preflight`, {}, (b) => ({ runId: str(b, 'runId', 'body') })),
  getRun: (id: string, runId: string) => jsonCall('GET', `${CANDIDATES}/${enc(id)}/preflight/${enc(runId)}`, undefined, (b) => parseRun(b['run'])),
  downloadRunReport: (id: string, runId: string, kind: 'txt' | 'json') => download(`${CANDIDATES}/${enc(id)}/preflight/${enc(runId)}/report.${kind}`),
  prepare: (id: string) => jsonCall('POST', `${CANDIDATES}/${enc(id)}/install/prepare`, {}, (b) => parseInstallation(b['installation'])),
  commit: (id: string, planId: string) => jsonCall('POST', `${CANDIDATES}/${enc(id)}/install/commit`, { planId, acknowledge: true }, (b) => parseInstallation(b['installation'])),
  getInstallation: (installId: string) => jsonCall('GET', `/foundation/module-installations/${enc(installId)}`, undefined, (b) => parseInstallation(b['installation'])),
  continueInstall: (installId: string) => jsonCall('POST', `/foundation/module-installations/${enc(installId)}/continue`, {}, (b) => parseInstallation(b['installation'])),
  closeFailed: (installId: string) => jsonCall('POST', `/foundation/module-installations/${enc(installId)}/close-failed`, { acknowledge: true }, (b) => parseInstallation(b['installation'])),
  downloadInstallReport: (installId: string) => download(`/foundation/module-installations/${enc(installId)}/report.txt`),
  runtimeRelease: () => jsonCall('GET', '/foundation/runtime-release', undefined, (b) => parseRuntime(b['runtime'])),
};
