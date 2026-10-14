import { open, readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { BlocklistUnavailableError, caseVariants, sha1Hex } from './pwnedPasswords.js';
import type { BreachedPasswordChecker } from './pwnedPasswords.js';

// HIBP Compact (target format, P-4b): the Pwned Passwords SHA-1 ranges in ONE file, 8 bytes per hash.
// Layout "TALOPWN1", little-endian:
//   header 32 B   magic "TALOPWN1" | version u32 = 1 | keyBytes u32 = 8 | flags u32 (bit0 = partial) | reserved u32 | entries u64
//   index         (2^20 + 1) × u64 — first entry number of each 20-bit prefix (+ end sentinel)
//   keys          entries × 8 B — first 64 bits of the 140-bit suffix, strictly ascending within each prefix
//   trailer 32 B  SHA-256 of everything before it
// Truncation to 64 bits can only cause false positives (a non-breached password reported as breached), probability
// ≈ (keys in the range) / 2^64 ≈ 1e-16 per lookup — the safe direction for a blocklist.
//
// Versions: <dir>/current.json names the active file and binds it to its SHA-256 and entry count. A new version is a new
// file; switching is an atomic rename of current.json (tools/pwnedCompact.ts activate) and takes effect at the next
// process start. The runtime never falls back to another dataset: any inconsistency fails closed.

export const COMPACT_MAGIC = Buffer.from('TALOPWN1', 'ascii');
export const COMPACT_PREFIXES = 1 << 20;
export const COMPACT_HEADER = 32;
export const COMPACT_INDEX_BYTES = (COMPACT_PREFIXES + 1) * 8;
export const COMPACT_KEY = 8;
export const COMPACT_TRAILER = 32;
export const COMPACT_POINTER = 'current.json';
export const COMPACT_POINTER_FORMAT = 'talo.hibp-compact-pointer/v1';
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.bin$/;

export interface CompactPointer {
  readonly format: string;
  readonly file: string; // basename inside the dataset directory
  readonly sha256: string; // trailer of the file (hex)
  readonly entries: number;
  readonly partial: boolean;
  readonly sourceTreeSha256: string; // manifest checksum of the text ranges it was converted from
  readonly activatedAt: string;
}

export function keyOfSuffix(suffixHex: string): Buffer {
  return Buffer.from(suffixHex.slice(0, 16), 'hex');
}

function isPointer(value: unknown): value is CompactPointer {
  if (typeof value !== 'object' || value === null) return false;
  const get = (key: string): unknown => Reflect.get(value, key);
  return get('format') === COMPACT_POINTER_FORMAT && typeof get('file') === 'string' && SAFE_FILE.test(String(get('file')))
    && typeof get('sha256') === 'string' && /^[0-9a-f]{64}$/.test(String(get('sha256')))
    && Number.isSafeInteger(get('entries')) && Number(get('entries')) >= 0 && typeof get('partial') === 'boolean'
    && typeof get('sourceTreeSha256') === 'string' && typeof get('activatedAt') === 'string';
}

export async function readCompactPointer(dir: string): Promise<CompactPointer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, COMPACT_POINTER), 'utf8'));
  } catch {
    throw new BlocklistUnavailableError('compact pointer missing or unreadable');
  }
  if (!isPointer(parsed)) throw new BlocklistUnavailableError('compact pointer invalid');
  return parsed;
}

export class CompactPwnedStore implements BreachedPasswordChecker {
  private constructor(private readonly handle: FileHandle, private readonly index: Buffer, readonly entries: number, readonly partial: boolean) {}

  // Structural checks (header, exact size, monotonic index, end sentinel) and, when given, binding to the expected
  // trailer checksum and entry count. The full checksum + per-range ordering is verified by the tools before activation.
  static async open(file: string, options: { production: boolean; expectedSha256?: string; expectedEntries?: number }): Promise<CompactPwnedStore> {
    let handle: FileHandle;
    try {
      handle = await open(file, 'r');
    } catch {
      throw new BlocklistUnavailableError('compact dataset missing');
    }
    try {
      const header = Buffer.alloc(COMPACT_HEADER);
      await handle.read(header, 0, COMPACT_HEADER, 0);
      if (!header.subarray(0, 8).equals(COMPACT_MAGIC) || header.readUInt32LE(8) !== 1 || header.readUInt32LE(12) !== COMPACT_KEY) {
        throw new BlocklistUnavailableError('compact dataset header invalid');
      }
      const partial = (header.readUInt32LE(16) & 1) === 1;
      if (partial && options.production) throw new BlocklistUnavailableError('partial (fixture) dataset refused in production');
      const entries = Number(header.readBigUInt64LE(24));
      const { size } = await handle.stat();
      if (size !== COMPACT_HEADER + COMPACT_INDEX_BYTES + entries * COMPACT_KEY + COMPACT_TRAILER) {
        throw new BlocklistUnavailableError('compact dataset size mismatch');
      }
      if (options.expectedEntries !== undefined && options.expectedEntries !== entries) {
        throw new BlocklistUnavailableError('compact dataset entry count differs from the pointer');
      }
      if (options.expectedSha256 !== undefined) {
        const trailer = Buffer.alloc(COMPACT_TRAILER);
        await handle.read(trailer, 0, COMPACT_TRAILER, size - COMPACT_TRAILER);
        if (trailer.toString('hex') !== options.expectedSha256) throw new BlocklistUnavailableError('compact dataset checksum differs from the pointer');
      }
      const index = Buffer.alloc(COMPACT_INDEX_BYTES);
      await handle.read(index, 0, COMPACT_INDEX_BYTES, COMPACT_HEADER);
      let previous = 0n;
      for (let p = 0; p <= COMPACT_PREFIXES; p++) {
        const value = index.readBigUInt64LE(p * 8);
        if (value < previous) throw new BlocklistUnavailableError('compact dataset index not monotonic');
        previous = value;
      }
      if (index.readBigUInt64LE(0) !== 0n || Number(previous) !== entries) throw new BlocklistUnavailableError('compact dataset index bounds invalid');
      return new CompactPwnedStore(handle, index, entries, partial);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  async isBreached(normalizedPassword: string): Promise<boolean> {
    for (const variant of caseVariants(normalizedPassword)) {
      if (await this.containsHash(sha1Hex(variant))) return true;
    }
    return false;
  }

  // Lookup by full SHA-1 (40 hex, upper case). Public for collision / false-positive tests.
  async containsHash(hash: string): Promise<boolean> {
    const prefix = Number.parseInt(hash.slice(0, 5), 16);
    const start = Number(this.index.readBigUInt64LE(prefix * 8));
    const end = Number(this.index.readBigUInt64LE((prefix + 1) * 8));
    if (end <= start) return false;
    const range = Buffer.alloc((end - start) * COMPACT_KEY);
    const { bytesRead } = await this.handle.read(range, 0, range.length, COMPACT_HEADER + COMPACT_INDEX_BYTES + start * COMPACT_KEY);
    if (bytesRead !== range.length) throw new BlocklistUnavailableError('compact dataset short read');
    const key = keyOfSuffix(hash.slice(5));
    let low = 0;
    let high = end - start - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const order = Buffer.compare(range.subarray(mid * COMPACT_KEY, mid * COMPACT_KEY + COMPACT_KEY), key);
      if (order === 0) return true;
      if (order < 0) low = mid + 1;
      else high = mid - 1;
    }
    return false;
  }
}

// Opens the ACTIVE version of a compact dataset directory (pointer → file, bound by checksum and entry count).
export async function openCompactDataset(dir: string, options: { production: boolean }): Promise<{ store: CompactPwnedStore; pointer: CompactPointer }> {
  const pointer = await readCompactPointer(dir);
  if (pointer.partial && options.production) throw new BlocklistUnavailableError('partial (fixture) dataset refused in production');
  const store = await CompactPwnedStore.open(join(dir, pointer.file), {
    production: options.production, expectedSha256: pointer.sha256, expectedEntries: pointer.entries,
  });
  if (store.partial !== pointer.partial) {
    await store.close();
    throw new BlocklistUnavailableError('compact dataset partial flag differs from the pointer');
  }
  return { store, pointer };
}
