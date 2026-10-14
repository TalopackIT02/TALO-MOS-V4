// Client for /api/auth/* (AUTH-API-v1). The session lives only in the HttpOnly `talo_sid` cookie, sent by the browser
// (same origin via the Vite proxy / Nginx). The frontend never reads or stores tokens, session ids or passwords.

export interface AccountSummary {
  userAccountId: string;
  username: string;
  fullName: string;
}

export type SessionInfo =
  | { status: 'AUTHENTICATED'; account: AccountSummary; expiresAt: string; serverTime: string }
  | { status: 'PASSWORD_CHANGE_REQUIRED'; account: { username: string }; expiresAt: string; serverTime: string };

export interface ApiErrorBody {
  code: string;
  requestId: string;
  reason: string | undefined; // details.reason (PASSWORD_POLICY only)
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiErrorBody }
  | { ok: false; status: 0; error: null }; // no response (network failure)

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseError(payload: unknown): ApiErrorBody {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const details = isObject(error.details) ? error.details : {};
  return { code: str(error.code) ?? 'UNKNOWN', requestId: str(error.requestId) ?? '', reason: str(details.reason) };
}

function parseSession(payload: unknown): SessionInfo | undefined {
  if (!isObject(payload) || !isObject(payload.account)) return undefined;
  const expiresAt = str(payload.expiresAt);
  const serverTime = str(payload.serverTime);
  const username = str(payload.account.username);
  if (!expiresAt || !serverTime || !username) return undefined;
  if (payload.status === 'PASSWORD_CHANGE_REQUIRED') return { status: 'PASSWORD_CHANGE_REQUIRED', account: { username }, expiresAt, serverTime };
  const userAccountId = str(payload.account.userAccountId);
  const fullName = str(payload.account.fullName);
  if (payload.status === 'AUTHENTICATED' && userAccountId && fullName !== undefined) {
    return { status: 'AUTHENTICATED', account: { userAccountId, username, fullName }, expiresAt, serverTime };
  }
  return undefined;
}

async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, parse: (payload: unknown, status: number) => T | undefined): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (response.ok) {
    const data = parse(payload, response.status);
    if (data !== undefined) return { ok: true, data };
    return { ok: false, status: response.status, error: { code: 'UNEXPECTED_RESPONSE', requestId: '', reason: undefined } };
  }
  return { ok: false, status: response.status, error: parseError(payload) };
}

export const authApi = {
  login: (username: string, password: string) => call('POST', '/auth/login', { username, password }, parseSession),
  session: () => call('GET', '/auth/session', undefined, parseSession),
  firstChange: (newPassword: string) =>
    call('POST', '/auth/password/first-change', { newPassword },
      (payload) => (isObject(payload) && payload.status === 'PASSWORD_CHANGED_RELOGIN' ? true : undefined)),
  logout: () => call('POST', '/auth/logout', undefined, (_payload, status) => (status === 204 ? true : undefined)),
};
