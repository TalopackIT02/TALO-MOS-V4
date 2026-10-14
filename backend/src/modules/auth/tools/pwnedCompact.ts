import { createHash, randomBytes } from 'node:crypto';
import { open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  COMPACT_HEADER, COMPACT_INDEX_BYTES, COMPACT_KEY, COMPACT_MAGIC, COMPACT_POINTER, COMPACT_POINTER_FORMAT, COMPACT_PREFIXES,
  COMPACT_TRAILER, keyOfSuffix,
} from '../pwnedCompact.js';
import type { CompactPointer } from '../pwnedCompact.js';
import { readManifest } from '../pwnedPasswords.js';

// Maintenance CLI for HIBP Compact (outside Git / outside the database). Memory: one range + the 8 MiB index.
//   npm run pwned:compact -- convert  <textDir> <outFile.bin>                        strict, checked against the text manifest
//   npm run pwned:compact -- verify   <file.bin>                                     streaming SHA-256 + per-range key ordering
//   npm run pwned:compact -- activate <datasetDir> <file.bin> <sourceTreeSha256>     verify, then atomic switch of current.json

const RANGE_FILE = /^([0-9A-F]{5})\.txt$/;
const LINE = /^([0-9A-Fa-f]{35}|[0-9A-Fa-f]{40}):\d+$/;

export interface ConvertResult {
  readonly entries: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceTreeSha256: string;
  readonly partial: boolean;
}

// Strict, streaming conversion. The text dataset must carry a manifest; its tree checksum is recomputed from the very
// bytes being converted and must match. Any malformed line or mismatch aborts and removes the output.
export async function convertToCompact(textDir: string, outFile: string): Promise<ConvertResult> {
  const manifest = await readManifest(textDir);
  const files = new Map<number, string>();
  for (const name of await readdir(textDir)) {
    const match = RANGE_FILE.exec(name);
    if (match?.[1]) files.set(Number.parseInt(match[1], 16), name);
  }
  if (files.size !== manifest.prefixCount) throw new Error(`range files (${files.size}) differ from the manifest (${manifest.prefixCount})`);
  if (!manifest.partial && files.size !== COMPACT_PREFIXES) throw new Error(`expected ${COMPACT_PREFIXES} range files, found ${files.size}`);
  const index = Buffer.alloc(COMPACT_INDEX_BYTES);
  const tree = createHash('sha256');
  const out = await open(outFile, 'wx+'); // never overwrite an existing version
  let entries = 0;
  try {
    for (let prefix = 0; prefix < COMPACT_PREFIXES; prefix++) {
      index.writeBigUInt64LE(BigInt(entries), prefix * 8);
      const name = files.get(prefix);
      if (!name) continue;
      const raw = await readFile(join(textDir, name));
      tree.update(`${name}\t${createHash('sha256').update(raw).digest('hex')}\n`);
      const keys: Buffer[] = [];
      for (const rawLine of raw.toString('utf8').split('\n')) {
        const line = rawLine.trim();
        if (line === '') continue;
        const match = LINE.exec(line);
        if (!match?.[1]) throw new Error(`malformed line in ${name}`);
        const hex = match[1].toUpperCase();
        keys.push(keyOfSuffix(hex.length === 40 ? hex.slice(5) : hex));
      }
      keys.sort(Buffer.compare);
      const unique = keys.filter((k, i) => i === 0 || !k.equals(keys[i - 1] ?? Buffer.alloc(0)));
      if (unique.length > 0) {
        await out.write(Buffer.concat(unique), 0, unique.length * COMPACT_KEY, COMPACT_HEADER + COMPACT_INDEX_BYTES + entries * COMPACT_KEY);
        entries += unique.length;
      }
    }
    const sourceTreeSha256 = tree.digest('hex');
    if (sourceTreeSha256 !== manifest.treeSha256) throw new Error('text dataset differs from its manifest (tree checksum)');
    index.writeBigUInt64LE(BigInt(entries), COMPACT_PREFIXES * 8);
    const header = Buffer.alloc(COMPACT_HEADER);
    COMPACT_MAGIC.copy(header, 0);
    header.writeUInt32LE(1, 8);
    header.writeUInt32LE(COMPACT_KEY, 12);
    header.writeUInt32LE(manifest.partial ? 1 : 0, 16);
    header.writeBigUInt64LE(BigInt(entries), 24);
    await out.write(header, 0, COMPACT_HEADER, 0);
    await out.write(index, 0, COMPACT_INDEX_BYTES, COMPACT_HEADER);
    const bodyLength = COMPACT_HEADER + COMPACT_INDEX_BYTES + entries * COMPACT_KEY;
    const trailer = await hashRegion(out, bodyLength);
    await out.write(trailer, 0, COMPACT_TRAILER, bodyLength);
    await out.close();
    return { entries, bytes: bodyLength + COMPACT_TRAILER, sha256: trailer.toString('hex'), sourceTreeSha256, partial: manifest.partial === true };
  } catch (error) {
    await out.close().catch(() => undefined);
    await rm(outFile, { force: true });
    throw error;
  }
}

async function hashRegion(handle: FileHandle, length: number): Promise<Buffer> {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  for (let offset = 0; offset < length;) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, length - offset), offset);
    if (bytesRead === 0) throw new Error('unexpected end of file');
    hash.update(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest();
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly entries?: number;
  readonly sha256?: string;
  readonly partial?: boolean;
}

// Deep verification in ONE streaming pass: header, index (monotonic, bounds), keys strictly ascending inside each
// prefix range, SHA-256 trailer. Constant memory (index + one 4 MiB chunk).
export async function verifyCompact(file: string): Promise<VerifyResult> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < COMPACT_HEADER + COMPACT_INDEX_BYTES + COMPACT_TRAILER) return { ok: false, reason: 'too small' };
    const head = Buffer.alloc(COMPACT_HEADER + COMPACT_INDEX_BYTES);
    await handle.read(head, 0, head.length, 0);
    if (!head.subarray(0, 8).equals(COMPACT_MAGIC) || head.readUInt32LE(8) !== 1 || head.readUInt32LE(12) !== COMPACT_KEY) return { ok: false, reason: 'header' };
    const entries = Number(head.readBigUInt64LE(24));
    if (size !== head.length + entries * COMPACT_KEY + COMPACT_TRAILER) return { ok: false, reason: 'size' };
    const indexAt = (p: number) => Number(head.readBigUInt64LE(COMPACT_HEADER + p * 8));
    for (let p = 0; p < COMPACT_PREFIXES; p++) if (indexAt(p + 1) < indexAt(p)) return { ok: false, reason: 'index not monotonic' };
    if (indexAt(0) !== 0 || indexAt(COMPACT_PREFIXES) !== entries) return { ok: false, reason: 'index bounds' };
    const hash = createHash('sha256').update(head);
    const chunkKeys = 512 * 1024;
    const chunk = Buffer.alloc(chunkKeys * COMPACT_KEY);
    let prefix = 0;
    let previous: Buffer | null = null;
    for (let key = 0; key < entries;) {
      const count = Math.min(chunkKeys, entries - key);
      const { bytesRead } = await handle.read(chunk, 0, count * COMPACT_KEY, head.length + key * COMPACT_KEY);
      if (bytesRead !== count * COMPACT_KEY) return { ok: false, reason: 'short read' };
      hash.update(chunk.subarray(0, bytesRead));
      for (let i = 0; i < count; i++, key++) {
        while (indexAt(prefix + 1) <= key) {
          prefix++;
          previous = null;
        }
        const current = chunk.subarray(i * COMPACT_KEY, i * COMPACT_KEY + COMPACT_KEY);
        if (previous && Buffer.compare(previous, current) >= 0) return { ok: false, reason: `keys not strictly ascending in prefix ${prefix.toString(16)}` };
        previous = Buffer.from(current);
      }
    }
    const trailer = Buffer.alloc(COMPACT_TRAILER);
    await handle.read(trailer, 0, COMPACT_TRAILER, size - COMPACT_TRAILER);
    const digest = hash.digest();
    if (!digest.equals(trailer)) return { ok: false, reason: 'checksum' };
    return { ok: true, entries, sha256: digest.toString('hex'), partial: (head.readUInt32LE(16) & 1) === 1 };
  } finally {
    await handle.close();
  }
}

// Verifies the file, then switches the active version by an atomic rename of current.json (temp file in the same
// directory). The previous version file is kept; processes pick the new version at their next start.
export async function activateCompact(datasetDir: string, fileName: string, sourceTreeSha256: string): Promise<CompactPointer> {
  if (basename(fileName) !== fileName) throw new Error('file must be a name inside the dataset directory');
  const result = await verifyCompact(join(datasetDir, fileName));
  if (!result.ok || result.sha256 === undefined || result.entries === undefined) throw new Error(`refusing to activate: ${result.reason ?? 'invalid'}`);
  const pointer: CompactPointer = {
    format: COMPACT_POINTER_FORMAT, file: fileName, sha256: result.sha256, entries: result.entries,
    partial: result.partial === true, sourceTreeSha256, activatedAt: new Date().toISOString(),
  };
  const temp = join(datasetDir, `${COMPACT_POINTER}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(temp, `${JSON.stringify(pointer, null, 2)}\n`, { flag: 'wx' });
  try {
    await rename(temp, join(datasetDir, COMPACT_POINTER));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return pointer;
}

async function main(): Promise<void> {
  const [command, a, b, c] = process.argv.slice(2);
  if (command === 'convert' && a && b) {
    const r = await convertToCompact(a, b);
    process.stdout.write(`converted ${r.entries} hashes, ${r.bytes} bytes, sha256 ${r.sha256}, source tree ${r.sourceTreeSha256}\n`);
  } else if (command === 'verify' && a) {
    const r = await verifyCompact(a);
    process.stdout.write(`${r.ok ? 'VERIFIED' : `INVALID (${r.reason ?? ''})`} ${r.entries ?? ''} ${r.sha256 ?? ''}\n`);
    if (!r.ok) process.exitCode = 1;
  } else if (command === 'activate' && a && b && c) {
    const p = await activateCompact(a, b, c);
    process.stdout.write(`active: ${p.file} (${p.entries} hashes, sha256 ${p.sha256})\n`);
  } else {
    throw new Error('usage: convert <textDir> <out.bin> | verify <file.bin> | activate <datasetDir> <file.bin> <sourceTreeSha256>');
  }
}

if (process.argv[1] && /tools[\\/]pwnedCompact\.[tj]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'error'}\n`);
    process.exit(1);
  });
}
