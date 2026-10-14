import type { ApiResult } from './authApi';
import { MESSAGES, t } from './messages';
import type { MessageId } from './messages';

// Mapping error.code → UI message per endpoint (design/auth-b1/AUTH-B1.3-messages-vi.md §7).
// error.message from the server is never displayed. The reference (requestId) is shown only for 500 / 503.

export type Tone = 'error' | 'warning' | 'success' | 'info';

export interface UiMessage {
  readonly text: string;
  readonly tone: Tone;
  readonly reference?: string;
}

type Endpoint = 'login' | 'firstChange' | 'session' | 'logout';

const COMMON_INVALID: MessageId = 'COMMON.REQUEST_INVALID';

function idFor(endpoint: Endpoint, code: string, reason: string | undefined): MessageId {
  switch (code) {
    case 'VALIDATION_ERROR':
      return endpoint === 'firstChange' ? 'FC.VALIDATION_ERROR' : 'LOGIN.VALIDATION_ERROR';
    case 'PASSWORD_POLICY': {
      const id = `POLICY.${reason ?? ''}`;
      return isMessageId(id) ? id : 'POLICY.UNKNOWN';
    }
    case 'INVALID_CREDENTIALS':
      return 'LOGIN.INVALID_CREDENTIALS';
    case 'ACCOUNT_NOT_ALLOWED':
      return 'LOGIN.ACCOUNT_NOT_ALLOWED';
    case 'SESSION_INVALID':
      return endpoint === 'firstChange' ? 'SESSION.ACTIVATION_EXPIRED' : 'SESSION.INVALID';
    case 'NOT_REQUIRED':
      return 'FC.NOT_REQUIRED';
    case 'PASSWORD_CHANGE_REQUIRED':
      return 'SESSION.PASSWORD_CHANGE_REQUIRED';
    case 'RATE_LIMITED':
      return 'COMMON.RATE_LIMITED';
    case 'SERVICE_BUSY':
      return endpoint === 'firstChange' ? 'FC.SERVICE_BUSY' : 'COMMON.SERVICE_BUSY';
    case 'INTERNAL_ERROR':
      return endpoint === 'firstChange' ? 'FC.INTERNAL_ERROR' : 'COMMON.INTERNAL_ERROR';
    default:
      return COMMON_INVALID;
  }
}

function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(MESSAGES, value);
}

export function messageForFailure(endpoint: Endpoint, result: Exclude<ApiResult<unknown>, { ok: true }>): UiMessage {
  // No response, or a gateway answer without the API envelope (proxy / Nginx 502-504: backend unreachable) → network.
  const unreachable = result.error === null || (result.error.code === 'UNKNOWN' && result.status >= 502 && result.status <= 504);
  if (unreachable) return { text: t(endpoint === 'logout' ? 'LOGOUT.FAILED' : 'COMMON.NETWORK'), tone: 'error' };
  if (endpoint === 'logout') return { text: t('LOGOUT.FAILED'), tone: 'error' };
  const { code, requestId, reason } = result.error ?? { code: 'UNKNOWN', requestId: '', reason: undefined };
  const id = idFor(endpoint, code, reason);
  const tone: Tone = code === 'RATE_LIMITED' || code === 'SERVICE_BUSY' ? 'warning' : 'error';
  const withReference = (code === 'INTERNAL_ERROR' || code === 'SERVICE_BUSY') && requestId !== '';
  return { text: t(id), tone, ...(withReference ? { reference: t('COMMON.REFERENCE', { requestId }) } : {}) };
}
