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
