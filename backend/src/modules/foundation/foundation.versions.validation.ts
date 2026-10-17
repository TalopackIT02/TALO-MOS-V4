import { z } from 'zod';
import { FoundationError } from './foundation.errors.js';

// FBE-02A — Module Version input rules (owner approved).
//   module_version  MAJOR.MINOR.PATCH, non-negative integers, no leading zero except "0"; VARCHAR(40) in B02.
//   contract_version exactly "MIC-1.0".
// Strict body: status, manifest, hash, actor and timestamps cannot be supplied by the client (unknown key → 400).

export const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const CONTRACT_VERSION = 'MIC-1.0';
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const createVersionSchema = z.strictObject({
  moduleVersion: z.string().max(40).regex(SEMVER_PATTERN),
  contractVersion: z.literal(CONTRACT_VERSION),
});

export interface CreateVersionInput {
  readonly moduleVersion: string;
  readonly contractVersion: typeof CONTRACT_VERSION;
}

export function parseCreateVersion(body: unknown): CreateVersionInput {
  const result = createVersionSchema.safeParse(body);
  if (!result.success) {
    // Only known field names are echoed; unknown keys (client text) are reported as a fixed marker.
    const fields = [...new Set(result.error.issues.map((issue) => (issue.code === 'unrecognized_keys' ? 'UNKNOWN_FIELD' : String(issue.path[0] ?? ''))))];
    throw new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: fields.filter((f) => f !== '').sort() } });
  }
  return { moduleVersion: result.data.moduleVersion, contractVersion: result.data.contractVersion };
}

// Path identifiers: a value that is not a UUID cannot identify a row, so it is answered like a missing row (404);
// it is never sent to PostgreSQL (no ::uuid cast error). Normalised to lower case.
export function uuidParam(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export type SemVer = readonly [bigint, bigint, bigint];

// Arbitrary-size components (BigInt): "9007199254740993.0.0" compares exactly.
export function parseSemVer(value: string): SemVer | null {
  const m = SEMVER_PATTERN.exec(value);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return [BigInt(m[1]), BigInt(m[2]), BigInt(m[3])];
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0n;
    const y = b[i] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
