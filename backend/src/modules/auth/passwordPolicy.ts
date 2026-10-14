import { PASSWORD_MAX_BYTES, PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from './auth.settings.js';

// Password rules (AD-6 PW3, P-4, AUTH-API-v1 §5.3). Values are NFC-normalised and never trimmed. No composition rules.

export type PolicyReason =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'TOO_LONG_BYTES'
  | 'CONTROL_CHARACTERS'
  | 'BLOCKLISTED'
  | 'CONTEXT_MATCH'
  | 'SAME_AS_CURRENT';

export interface PolicyDetails {
  readonly reason: PolicyReason;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly maxBytes?: number;
}

// C0 (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F) — P-4c.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

export function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function hasControlCharacters(value: string): boolean {
  return CONTROL.test(value);
}

// Login input check (input only, no account involved): 1–128 code points, ≤ 512 bytes, no control characters.
export function isAcceptableLoginPassword(normalized: string): boolean {
  const length = codePointLength(normalized);
  return length >= 1 && length <= PASSWORD_MAX_CODE_POINTS && utf8Length(normalized) <= PASSWORD_MAX_BYTES
    && !hasControlCharacters(normalized);
}

export interface PasswordContext {
  readonly username: string;
  readonly employeeCode: string;
  readonly fullName: string;
}

// Case-insensitive comparison key (P-4d): Unicode default case folding approximated by toLowerCase on the NFC value.
function foldCase(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC');
}

const BRAND_TERMS = ['talopack', 'talo pack', 'talo-pack', 'talo_pack', 'talomos', 'talo-mos', 'talo mos', 'talo'];
const FIXED_SUFFIXES = ['', '1', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '123456789', '2025', '2026', '2027',
  '@123', '@1234', '@12345', '@123456', '@2025', '@2026', '@2027', '!', '!!', '#1', '.com', '.vn', '.com.vn'];

// Whole-password contextual candidates: username, employee code, name variants, brand names — each with fixed suffixes.
export function contextualCandidates(context: PasswordContext): ReadonlySet<string> {
  const bases = new Set<string>();
  const name = context.fullName.trim();
  const plainName = stripDiacritics(name);
  for (const value of [context.username, context.employeeCode, name, plainName,
    name.replace(/\s+/g, ''), plainName.replace(/\s+/g, ''), ...BRAND_TERMS]) {
    if (value.trim() !== '') bases.add(foldCase(value.trim()));
  }
  const candidates = new Set<string>();
  for (const base of bases) {
    for (const suffix of FIXED_SUFFIXES) {
      candidates.add(base + suffix);
      candidates.add(base + base + suffix);
    }
  }
  return candidates;
}

// Order of the checks (§5.3): shape (control characters, length, bytes) → BLOCKLISTED (offline Pwned Passwords, async,
// done by the caller between the two functions) → CONTEXT_MATCH → SAME_AS_CURRENT (Argon2id verify, caller).
export function checkPasswordShape(normalized: string): PolicyDetails | null {
  if (hasControlCharacters(normalized)) return { reason: 'CONTROL_CHARACTERS' };
  const length = codePointLength(normalized);
  if (length < PASSWORD_MIN_CODE_POINTS) return { reason: 'TOO_SHORT', minLength: PASSWORD_MIN_CODE_POINTS };
  if (length > PASSWORD_MAX_CODE_POINTS) return { reason: 'TOO_LONG', maxLength: PASSWORD_MAX_CODE_POINTS };
  if (utf8Length(normalized) > PASSWORD_MAX_BYTES) return { reason: 'TOO_LONG_BYTES', maxBytes: PASSWORD_MAX_BYTES };
  return null;
}

export function checkContext(normalized: string, context: PasswordContext): PolicyDetails | null {
  return contextualCandidates(context).has(foldCase(normalized)) ? { reason: 'CONTEXT_MATCH' } : null;
}
