// Audit metadata (P-8, AUTH-API-v1 §11): built only here. Keys are limited to
// { v, reason, requestId, ip, ua, slot?, policy? }; ip and ua are truncated to 256 characters. Never passwords, tokens,
// hashes, attempted usernames or request bodies.

export type AuditAction = 'LOGIN' | 'CHANGE_PASSWORD' | 'ACCOUNT_ACTIVATED' | 'LOGOUT' | 'SESSION_INVALIDATED';
export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface ClientInfo {
  readonly requestId: string;
  readonly ip: string | null;
  readonly ua: string | null;
}

export interface AuditMetadata {
  readonly v: 1;
  readonly reason: string;
  readonly requestId: string;
  readonly ip: string | null;
  readonly ua: string | null;
  readonly slot?: number;
  readonly policy?: string;
}

export interface AuditEntry {
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly targetType: 'USER_ACCOUNT' | 'SESSION';
  readonly targetId: string | null;
  readonly actorAccountId: string | null;
  readonly membershipId: string | null;
  readonly sessionId: string | null;
  readonly metadata: AuditMetadata;
}

const MAX_FIELD = 256;

function truncate(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return [...value].slice(0, MAX_FIELD).join('');
}

export function clientInfo(requestId: string, ip: string | undefined, userAgent: string | undefined): ClientInfo {
  return { requestId, ip: truncate(ip), ua: truncate(userAgent) };
}

export function auditMetadata(client: ClientInfo, reason: string, extra: { slot?: number; policy?: string } = {}): AuditMetadata {
  return {
    v: 1,
    reason,
    requestId: client.requestId,
    ip: client.ip,
    ua: client.ua,
    ...(extra.slot !== undefined ? { slot: extra.slot } : {}),
    ...(extra.policy !== undefined ? { policy: extra.policy } : {}),
  };
}
