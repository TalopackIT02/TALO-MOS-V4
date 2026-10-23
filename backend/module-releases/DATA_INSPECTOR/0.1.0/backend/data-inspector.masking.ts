// DATA_INSPECTOR FIX-01 — Sensitive Data Masking (owner decision: BL-05 APPROVED, masking mandatory in the backend).
// Applies to every schema / table. Decided on the server from pg_catalog names and types only; nothing of the request
// can switch it off. Three modes per shown column:
//   FULL      — sensitive column name: the value is NEVER selected; the page SQL emits the constant '[MASKED]' instead
//               (also for NULL / empty values, so that not even presence is revealed).
//   JSON_KEYS — json / jsonb: selected (bounded), parsed, every value under a sensitive key masked recursively; a value
//               that is too long to parse whole, or not valid JSON, is masked entirely.
//   NONE      — shown as read.
// Protection is by NAME (column name, JSON key). A secret stored under a neutral name or inside free text is NOT
// detected — see the FIX-01 report.

export const MASK = '[MASKED]';
export type MaskMode = 'NONE' | 'FULL' | 'JSON_KEYS';

// Longest json / jsonb text parsed for key masking; longer values are masked whole (cannot be proven safe when cut).
export const JSON_PARSE_MAX_CHARS = 65_536;

// Name segments (snake_case / camelCase / kebab split, lower case) that mark a secret on their own.
const SECRET_SEGMENTS = new Set([
  'password', 'passwords', 'passwd', 'passphrase', 'pwd', 'secret', 'secrets', 'token', 'tokens', 'credential', 'credentials',
  'apikey', 'privatekey', 'salt', 'otp', 'totp', 'cookie', 'cookies', 'conninfo', 'umoptions', 'bearer',
]);
// Segment pairs that mark a secret together (api_key, private_key, client_secret …).
const SECRET_PAIRS = [
  ['api', 'key'], ['private', 'key'], ['access', 'key'], ['secret', 'key'], ['signing', 'key'], ['encryption', 'key'], ['auth', 'code'],
  ['authorization', 'code'], ['recovery', 'code'], ['session', 'key'],
] as const;
// A name ending in one of these is an identifier / timestamp / counter ABOUT a secret, not the secret (credential_id, token_count).
const DESCRIPTOR_TAIL = new Set(['id', 'ids', 'at', 'count']);
// Column types that cannot carry a secret value (password_changed_at, must_change_password, failed_attempt_count).
const SAFE_TYPE = /^(boolean|smallint|integer|bigint|numeric(\(.*\))?|real|double precision|date|time(stamp)?( ?\(\d+\))?( with(out)? time zone)?|interval.*)$/;
// Structured types whose inner names cannot be inspected here → masked whole.
const OPAQUE_STRUCTURED = /^(jsonb?\[\]|hstore(\[\])?)$/;

export function nameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((s) => s !== '');
}

export function isSensitiveName(name: string): boolean {
  const parts = nameSegments(name);
  if (parts.length === 0) return false;
  if (DESCRIPTOR_TAIL.has(parts[parts.length - 1] ?? '') && parts.length > 1) return false;
  // Substrings catch fused system names: rolpassword, subconninfo.
  if (parts.some((p) => SECRET_SEGMENTS.has(p) || p.includes('password') || p.includes('passwd') || p.includes('conninfo'))) return true;
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (SECRET_PAIRS.some(([a, b]) => parts[i] === a && parts[i + 1] === b)) return true;
  }
  return false;
}

export function maskModeOf(columnName: string, dataType: string): MaskMode {
  const type = dataType.trim().toLowerCase();
  if (isSensitiveName(columnName) && !SAFE_TYPE.test(type)) return 'FULL';
  if (OPAQUE_STRUCTURED.test(type)) return 'FULL';
  if (type === 'json' || type === 'jsonb') return 'JSON_KEYS';
  return 'NONE';
}

function maskValue(value: unknown): { value: unknown; masked: boolean } {
  if (Array.isArray(value)) {
    let masked = false;
    const out = value.map((v) => {
      const r = maskValue(v);
      masked ||= r.masked;
      return r.value;
    });
    return { value: out, masked };
  }
  if (typeof value === 'object' && value !== null) {
    let masked = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveName(k)) {
        out[k] = MASK;
        masked = true;
      } else {
        const r = maskValue(v);
        masked ||= r.masked;
        out[k] = r.value;
      }
    }
    return { value: out, masked };
  }
  return { value, masked: false };
}

// JSON text of one cell (already bounded by the page SQL to JSON_PARSE_MAX_CHARS + 1). Unchanged text when nothing is
// sensitive; re-serialised text when keys were masked; MASK when it cannot be parsed whole.
export function maskJsonText(text: string): { text: string; masked: boolean } {
  if (Array.from(text).length > JSON_PARSE_MAX_CHARS) return { text: MASK, masked: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text: MASK, masked: true };
  }
  const r = maskValue(parsed);
  return r.masked ? { text: JSON.stringify(r.value), masked: true } : { text, masked: false };
}
