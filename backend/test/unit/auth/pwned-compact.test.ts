import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPACT_HEADER, COMPACT_INDEX_BYTES, COMPACT_POINTER, CompactPwnedStore, openCompactDataset } from '../../../src/modules/auth/pwnedCompact.js';
import { BlocklistUnavailableError, PWNED_FORMAT, PwnedPasswordsStore, sha1Hex } from '../../../src/modules/auth/pwnedPasswords.js';
import type { PwnedManifest } from '../../../src/modules/auth/pwnedPasswords.js';
import { activateCompact, convertToCompact, verifyCompact } from '../../../src/modules/auth/tools/pwnedCompact.js';
import { treeChecksum } from '../../../src/modules/auth/tools/pwnedManifest.js';
import { FIXTURE_BREACHED, createPwnedFixture, removePwnedFixture } from '../../support/pwnedFixture.js';

// HIBP Compact: reader, converter, deep verify, atomic activation — on the existing synthetic fixture plus small
// hand-made range sets. Everything lives in the OS temp directory (outside Git) and is removed afterwards.

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'talo-pwned-compact-'));
  temps.push(dir);
  return dir;
}

// Text dataset from explicit range lines (exact HIBP layout) + manifest, for crafted cases.
async function textDataset(ranges: Record<string, string[]>): Promise<string> {
  const dir = await tempDir();
  for (const [prefix, lines] of Object.entries(ranges)) await writeFile(join(dir, `${prefix}.txt`), lines.join('\r\n'));
  const { count, treeSha256 } = await treeChecksum(dir);
  const manifest: PwnedManifest = { format: PWNED_FORMAT, source: 'test', downloader: 'test', createdAt: new Date().toISOString(), prefixCount: count, treeSha256, partial: true };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

const suffixOf = (value: string) => sha1Hex(value).slice(5);
const prefixOf = (value: string) => sha1Hex(value).slice(0, 5);

describe('HIBP Compact', { timeout: 180_000 }, () => {
  let fixtureDir: string;
  let datasetDir: string;
  let text: PwnedPasswordsStore;
  let compact: CompactPwnedStore;
  const memory = { convertPeakArrayBuffers: 0, convertPeakRss: 0, openArrayBuffers: 0 };

  beforeAll(async () => {
    fixtureDir = await createPwnedFixture(FIXTURE_BREACHED, 8_000);
    datasetDir = await tempDir();
    // Absolute peaks sampled during conversion (GC makes deltas meaningless at this size).
    const sample = () => {
      const m = process.memoryUsage();
      memory.convertPeakArrayBuffers = Math.max(memory.convertPeakArrayBuffers, m.arrayBuffers);
      memory.convertPeakRss = Math.max(memory.convertPeakRss, m.rss);
    };
    const sampler = setInterval(sample, 2);
    const converted = await convertToCompact(fixtureDir, join(datasetDir, 'v1.bin'));
    clearInterval(sampler);
    sample();
    await activateCompact(datasetDir, 'v1.bin', converted.sourceTreeSha256);
    text = await PwnedPasswordsStore.open(fixtureDir, { production: false });
    compact = (await openCompactDataset(datasetDir, { production: false })).store;
    memory.openArrayBuffers = process.memoryUsage().arrayBuffers;
  }, 180_000);
  afterAll(async () => {
    await compact?.close();
    if (fixtureDir) await removePwnedFixture(fixtureDir);
    for (const dir of temps) await rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('answers exactly like the text store (variants, decoys, random misses — no false positive observed)', async () => {
    const probes = [
      ...FIXTURE_BREACHED, 'MATKHAUMOI123456', 'passwordpassword1', 'correct horse battery', 'passwordpassword9',
      ...Array.from({ length: 300 }, (_, i) => `decoy-${i * 26}`),
      ...Array.from({ length: 5_000 }, (_, i) => `absent value ${i} ${Math.random()}`),
    ];
    let hits = 0;
    let disagreements = 0;
    for (const probe of probes) {
      const expected = await text.isBreached(probe);
      if ((await compact.isBreached(probe)) !== expected) disagreements++;
      if (expected) hits++;
    }
    expect(disagreements).toBe(0);
    expect(hits).toBeGreaterThan(300);
  });

  it('truncation: a hash sharing prefix + first 64 suffix bits is reported (documented false positive); one differing bit is not', async () => {
    const real = sha1Hex('matkhaumoi123456');
    const tail = real.slice(21);
    const sameKey = `${real.slice(0, 21)}${tail === '0'.repeat(19) ? '1'.repeat(19) : '0'.repeat(19)}`;
    expect(sameKey).not.toBe(real);
    expect(await compact.containsHash(real)).toBe(true);
    expect(await compact.containsHash(sameKey)).toBe(true); // only the first 64 suffix bits are stored
    const lastKeyNibble = Number.parseInt(real.charAt(20), 16);
    const otherKey = `${real.slice(0, 20)}${((lastKeyNibble + 1) % 16).toString(16).toUpperCase()}${tail}`;
    expect(await compact.containsHash(otherKey)).toBe(false);
  });

  it('memory: conversion and the open store stay bounded (index 8 MiB + one range + 4 MiB chunk, no whole-file buffers)', () => {
    const mib = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;
    console.log(`[HIBP compact] convert peak: arrayBuffers ${mib(memory.convertPeakArrayBuffers)}, rss ${mib(memory.convertPeakRss)}; after open: arrayBuffers ${mib(memory.openArrayBuffers)}`);
    expect(memory.convertPeakArrayBuffers).toBeLessThan(64 * 1048576);
    expect(memory.openArrayBuffers).toBeLessThan(64 * 1048576);
  });

  it('deep verify: detects keys out of order inside a range, a damaged checksum and truncation', async () => {
    const a = suffixOf('alpha value one');
    const prefix = prefixOf('alpha value one');
    const keys = [a, `${a.slice(0, 15)}F${a.slice(16)}`, `${a.slice(0, 14)}FF${a.slice(16)}`].map((s) => `${s}:1`);
    const src = await textDataset({ [prefix]: keys });
    const dir = await tempDir();
    await convertToCompact(src, join(dir, 'x.bin'));
    expect((await verifyCompact(join(dir, 'x.bin'))).ok).toBe(true);
    const data = await readFile(join(dir, 'x.bin'));
    const firstKey = COMPACT_HEADER + COMPACT_INDEX_BYTES;
    const swapped = Buffer.from(data);
    data.copy(swapped, firstKey, firstKey + 8, firstKey + 16);
    data.copy(swapped, firstKey + 8, firstKey, firstKey + 8);
    await writeFile(join(dir, 'swapped.bin'), swapped);
    expect((await verifyCompact(join(dir, 'swapped.bin'))).reason).toMatch(/not strictly ascending/);
    const badTrailer = Buffer.from(data);
    badTrailer[badTrailer.length - 1] = (badTrailer[badTrailer.length - 1] ?? 0) ^ 1;
    await writeFile(join(dir, 'trailer.bin'), badTrailer);
    expect((await verifyCompact(join(dir, 'trailer.bin'))).reason).toBe('checksum');
    await writeFile(join(dir, 'short.bin'), data.subarray(0, data.length - 8));
    expect((await verifyCompact(join(dir, 'short.bin'))).ok).toBe(false);
    await expect(CompactPwnedStore.open(join(dir, 'short.bin'), { production: false })).rejects.toBeInstanceOf(BlocklistUnavailableError);
  });

  it('converter is strict: malformed line, text differing from its manifest, existing output — abort, nothing left behind', async () => {
    const prefix = prefixOf('beta');
    const bad = await textDataset({ [prefix]: [`${suffixOf('beta')}:3`, 'NOT-A-HASH:1'] });
    const dir = await tempDir();
    await expect(convertToCompact(bad, join(dir, 'bad.bin'))).rejects.toThrow(/malformed line/);
    const drift = await textDataset({ [prefix]: [`${suffixOf('beta')}:3`] });
    await writeFile(join(drift, `${prefix}.txt`), `${suffixOf('beta')}:4`); // changed after the manifest
    await expect(convertToCompact(drift, join(dir, 'drift.bin'))).rejects.toThrow(/differs from its manifest/);
    expect((await readdir(dir)).filter((n) => n.endsWith('.bin'))).toEqual([]);
    const good = await textDataset({ [prefix]: [`${suffixOf('beta')}:3`] });
    await convertToCompact(good, join(dir, 'good.bin'));
    await expect(convertToCompact(good, join(dir, 'good.bin'))).rejects.toThrow(); // never overwrite a version
    expect((await verifyCompact(join(dir, 'good.bin'))).ok).toBe(true);
  });

  it('atomic version switch: an open store keeps its version, a new open sees the new one, no temp files remain', async () => {
    const dir = await tempDir();
    const v1src = await textDataset({ [prefixOf('gamma one')]: [`${suffixOf('gamma one')}:1`] });
    const v2src = await textDataset({ [prefixOf('gamma two')]: [`${suffixOf('gamma two')}:1`] });
    const c1 = await convertToCompact(v1src, join(dir, 'hibp-v1.bin'));
    await activateCompact(dir, 'hibp-v1.bin', c1.sourceTreeSha256);
    const old = (await openCompactDataset(dir, { production: false })).store;
    const c2 = await convertToCompact(v2src, join(dir, 'hibp-v2.bin'));
    await activateCompact(dir, 'hibp-v2.bin', c2.sourceTreeSha256);
    const fresh = await openCompactDataset(dir, { production: false });
    try {
      expect(await old.isBreached('gamma one')).toBe(true);
      expect(await old.isBreached('gamma two')).toBe(false);
      expect(fresh.pointer.file).toBe('hibp-v2.bin');
      expect(await fresh.store.isBreached('gamma two')).toBe(true);
      expect(await fresh.store.isBreached('gamma one')).toBe(false);
      expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
      // A damaged file is refused at activation and the active pointer stays unchanged.
      const damaged = await readFile(join(dir, 'hibp-v1.bin'));
      damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 1;
      await writeFile(join(dir, 'hibp-v3.bin'), damaged);
      await expect(activateCompact(dir, 'hibp-v3.bin', c1.sourceTreeSha256)).rejects.toThrow(/refusing to activate/);
      expect(JSON.parse(await readFile(join(dir, COMPACT_POINTER), 'utf8')).file).toBe('hibp-v2.bin');
      await expect(activateCompact(dir, '../hibp-v2.bin', c2.sourceTreeSha256)).rejects.toThrow(/inside the dataset directory/);
    } finally {
      await old.close();
      await fresh.store.close();
    }
  });

  it('fails closed: missing / invalid / traversal pointer, checksum or entry mismatch, partial in production', async () => {
    const dir = await tempDir();
    await expect(openCompactDataset(dir, { production: false })).rejects.toBeInstanceOf(BlocklistUnavailableError);
    const src = await textDataset({ [prefixOf('delta')]: [`${suffixOf('delta')}:1`] });
    const c = await convertToCompact(src, join(dir, 'd.bin'));
    const pointer = await activateCompact(dir, 'd.bin', c.sourceTreeSha256);
    const write = (value: unknown) => writeFile(join(dir, COMPACT_POINTER), JSON.stringify(value));
    for (const broken of [
      { ...pointer, sha256: '0'.repeat(64) },
      { ...pointer, entries: pointer.entries + 1 },
      { ...pointer, file: '../d.bin' },
      { ...pointer, file: 'missing.bin' },
      { ...pointer, partial: false },
      { ...pointer, format: 'other' },
    ]) {
      await write(broken);
      await expect(openCompactDataset(dir, { production: false }), JSON.stringify(broken).slice(0, 60)).rejects.toBeInstanceOf(BlocklistUnavailableError);
    }
    await write(pointer);
    await expect(openCompactDataset(dir, { production: true })).rejects.toThrow(/partial/);
    const ok = await openCompactDataset(dir, { production: false });
    await ok.store.close();
    expect((await stat(join(dir, 'd.bin'))).size).toBe(c.bytes);
  });
});
