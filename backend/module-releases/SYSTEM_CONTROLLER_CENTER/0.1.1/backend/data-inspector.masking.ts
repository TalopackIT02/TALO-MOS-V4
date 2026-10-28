// SCC: no content masking on non-account database tables. Account-owned rows are denied at route data service.
// This check applies to any schema to prevent personal account data in copied or renamed database.
export type MaskMode = 'NONE' | 'FULL' | 'JSON_KEYS';
export const MASK = '[ACCOUNT_PROTECTED]';
export const JSON_PARSE_MAX_CHARS = 1_000_000;
const ACCOUNT_EXACT = new Set([
  'iam_user_accounts','iam_credentials','iam_sessions','iam_memberships','iam_account_verifications','iam_audit_logs',
  'iam_user_roles','iam_user_permissions','iam_role_permissions',
  'user_accounts','user_credentials','user_sessions','user_permissions','account_verifications',
]);
export function isProtectedAccountTable(schema: string, table: string): boolean {
  const s=schema.toLowerCase(), t=table.toLowerCase();
  return ACCOUNT_EXACT.has(t) || ((s==='iam'||s==='auth'||s==='authentication') &&
    /(?:user|account|credential|session|membership|verification|password|token|secret)/.test(t));
}
export function maskModeOf(_columnName: string, _dataType: string): MaskMode { return 'NONE'; }
export function maskJsonText(text: string): {text:string; masked:boolean} { return {text, masked:false}; }
