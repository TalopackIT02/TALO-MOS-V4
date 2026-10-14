import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Offline breached-password check (P-4a/b, AUTH-E2E final completion): Have I Been Pwned "Pwned Passwords" SHA-1
// range files, downloaded with the official HaveIBeenPwned/PwnedPasswordsDownloader in directory mode. The data lives
// OUTSIDE Git and outside the IAM database (directory given by PWNED_PASSWORDS_DIR); it contains SHA-1 hashes only,
// never plaintext. SHA-1 is used solely as the lookup key of this dataset; password storage stays Argon2id.
//
// Layout (one file per 5-hex-digit prefix, exactly as the Pwned Passwords range API):
//   <dir>/00000.txt … <dir>/FFFFF.txt   lines "<35 hex suffix>:<count>"   (1,048,576 files)
//   <dir>/manifest.json                 written by `npm run pwned:manifest` after the download, see PwnedManifest
//
// P-4d LIMIT (case-insensitive matching): the dataset holds hashes of the exact strings people used, so a case-insensitive
// comparison cannot be computed for an arbitrary spelling. This module checks a bounded set of case variants of the
// NFC value: as typed, lower case, UPPER CASE, first letter capitalised, and Each Word Capitalised. A breached spelling
// outside these variants (e.g. "pAssWord…") is NOT detected. Full P-4d for breached passwords is therefore not achieved.

export const PWNED_FORMAT = 'talo.hibp-pwned-passwords-sha1-range/v1';
export const FULL_PREFIX_COUNT = 1 << 20;

export interface PwnedManifest {
  readonly format: string;
  readonly source: string;
  readonly downloader: string;
  readonly createdAt: string;
  readonly prefixCount: number;
  readonly treeSha256: string; // SHA-256 over sorted "<file>\t<sha256(file)>\n" lines, see tools/pwnedManifest.ts
  readonly partial?: boolean; // test fixtures only; refused in production
}

export class BlocklistUnavailableError extends Error {
  constructor(reason: string) {
    super(`password blocklist unavailable: ${reason}`);
    this.name = 'BlocklistUnavailableError';
  }
}

export interface BreachedPasswordChecker {
  // Throws BlocklistUnavailableError when the dataset cannot be used (fail closed).
  isBreached(normalizedPassword: string): Promise<boolean>;
}

// Bounded case variants (see P-4d LIMIT above). Input is already NFC.
export function caseVariants(value: string): string[] {
  const lower = value.toLowerCase();
  const capitalised = lower.charAt(0).toUpperCase() + lower.slice(1);
  const title = lower.replace(/(^|\s)(\S)/gu, (_, space: string, first: string) => space + first.toUpperCase());
  return [...new Set([value, lower, value.toUpperCase(), capitalised, title].map((v) => v.normalize('NFC')))];
}

export function sha1Hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

function isManifest(value: unknown): value is PwnedManifest {
  if (typeof value !== 'object' || value === null) return false;
  const get = (key: string): unknown => Reflect.get(value, key);
  const partial = get('partial');
  return typeof get('format') === 'string' && typeof get('source') === 'string' && typeof get('downloader') === 'string'
    && typeof get('createdAt') === 'string' && typeof get('prefixCount') === 'number' && typeof get('treeSha256') === 'string'
    && (partial === undefined || typeof partial === 'boolean');
}

export async function readManifest(dir: string): Promise<PwnedManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new BlocklistUnavailableError('manifest.json missing or unreadable');
  }
  if (!isManifest(parsed) || parsed.format !== PWNED_FORMAT || !/^[0-9a-f]{64}$/.test(parsed.treeSha256)) {
    throw new BlocklistUnavailableError('manifest.json invalid');
  }
  return parsed;
}

export class PwnedPasswordsStore implements BreachedPasswordChecker {
  private constructor(private readonly dir: string, readonly manifest: PwnedManifest) {}

  // Opens a dataset. Production refuses partial datasets; a full dataset must declare all 1,048,576 prefixes and the
  // first/last/middle range files must exist (cheap startup check — the full checksum is verified by `pwned:verify`).
  static async open(dir: string, options: { production: boolean }): Promise<PwnedPasswordsStore> {
    const manifest = await readManifest(dir);
    if (manifest.partial) {
      if (options.production) throw new BlocklistUnavailableError('partial (fixture) dataset refused in production');
    } else {
      if (manifest.prefixCount !== FULL_PREFIX_COUNT) throw new BlocklistUnavailableError('incomplete dataset');
      for (const prefix of ['00000', '7FFFF', 'FFFFF']) {
        try {
          await readFile(join(dir, `${prefix}.txt`), 'utf8');
        } catch {
          throw new BlocklistUnavailableError(`range file ${prefix}.txt missing`);
        }
      }
    }
    return new PwnedPasswordsStore(dir, manifest);
  }

  async isBreached(normalizedPassword: string): Promise<boolean> {
    for (const variant of caseVariants(normalizedPassword)) {
      if (await this.contains(sha1Hex(variant))) return true;
    }
    return false;
  }

  private async contains(hash: string): Promise<boolean> {
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    let text: string;
    try {
      text = await readFile(join(this.dir, `${prefix}.txt`), 'utf8');
    } catch {
      if (this.manifest.partial) return false; // fixture: ranges not included are empty
      throw new BlocklistUnavailableError(`range file ${prefix}.txt missing`);
    }
    for (const line of text.split('\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toUpperCase();
      const candidate = key.length === 40 ? key.slice(5) : key; // tolerate full-hash lines
      if (candidate === suffix && Number.parseInt(line.slice(colon + 1), 10) > 0) return true;
    }
    return false;
  }
}

// Used when no dataset is configured or it failed to open: every check fails closed.
export class UnavailableBlocklist implements BreachedPasswordChecker {
  constructor(private readonly reason: string) {}
  async isBreached(_normalizedPassword: string): Promise<boolean> {
    throw new BlocklistUnavailableError(this.reason);
  }
}
