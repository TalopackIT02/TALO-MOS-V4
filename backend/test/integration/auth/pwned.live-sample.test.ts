import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWNED_FORMAT, PwnedPasswordsStore, caseVariants, sha1Hex } from '../../../src/modules/auth/pwnedPasswords.js';
import type { PwnedManifest } from '../../../src/modules/auth/pwnedPasswords.js';
import { openCompactDataset } from '../../../src/modules/auth/pwnedCompact.js';
import { activateCompact, convertToCompact, verifyCompact } from '../../../src/modules/auth/tools/pwnedCompact.js';
import { treeChecksum } from '../../../src/modules/auth/tools/pwnedManifest.js';

// Real-format check of the offline lookup with a TINY live sample of the Pwned Passwords range API (a few ~75 kB range
// files, SHA-1 hashes only). Not the dataset download. Runs only with TALO_HIBP_LIVE=1; files go to the OS temp
// directory (outside Git) and are deleted afterwards. Candidate strings are public, well-known weak passwords.

const enabled = process.env['TALO_HIBP_LIVE'] === '1';
const KNOWN_BREACHED = ['passwordpassword', '123456789012345', 'qwertyuiopasdfghjkl'];
const SURELY_ABSENT = `talo ${Date.now()} ${Math.random()} unlikely passphrase`;

describe.skipIf(!enabled)('Pwned Passwords offline lookup on a live HIBP sample', { timeout: 120_000 }, () => {
  let dir: string;
  let store: PwnedPasswordsStore;
  const stats = { files: 0, bytes: 0, lines: 0 };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'talo-pwned-live-'));
    const candidates = [...KNOWN_BREACHED, SURELY_ABSENT].flatMap((value) => caseVariants(value));
    const prefixes = [...new Set(candidates.map((value) => sha1Hex(value).slice(0, 5)))];
    for (const prefix of prefixes) {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'User-Agent': 'TALO-MOS-V4 auth test' } });
      expect(response.status, prefix).toBe(200);
      const text = await response.text();
      await writeFile(join(dir, `${prefix}.txt`), text);
      stats.files += 1;
      stats.bytes += text.length;
      stats.lines += text.split('\n').length;
    }
    const { count, treeSha256 } = await treeChecksum(dir);
    const manifest: PwnedManifest = {
      format: PWNED_FORMAT, source: 'live sample of https://api.pwnedpasswords.com/range/', downloader: 'pwned.live-sample.test.ts',
      createdAt: new Date().toISOString(), prefixCount: count, treeSha256, partial: true,
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    store = await PwnedPasswordsStore.open(dir, { production: false });
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    console.log(`[HIBP live sample] ${stats.files} range files, ${(stats.bytes / 1024).toFixed(0)} kB, ${stats.lines} lines — deleted`);
  });

  it('detects real breached passwords (as typed and through the bounded case variants) and accepts an absent one', async () => {
    for (const value of KNOWN_BREACHED) {
      expect(await store.isBreached(value), value).toBe(true);
      expect(await store.isBreached(value.toUpperCase()), `${value} upper`).toBe(true);
    }
    expect(await store.isBreached(SURELY_ABSENT)).toBe(false);
  });

  it('HIBP Compact on real range density: same answers, no false positive on random probes, size, lookup speed', async () => {
    const compactDir = join(dir, 'compact');
    await mkdir(compactDir);
    const converted = await convertToCompact(dir, join(compactDir, 'hibp-sample.bin'));
    await activateCompact(compactDir, 'hibp-sample.bin', converted.sourceTreeSha256);
    const { store: compact } = await openCompactDataset(compactDir, { production: false });
    try {
      for (const value of [...KNOWN_BREACHED, ...KNOWN_BREACHED.map((v) => v.toUpperCase()), SURELY_ABSENT]) {
        expect(await compact.isBreached(value), value).toBe(await store.isBreached(value));
      }
      // Random probes inside the downloaded ranges (densest real data): the 64-bit key must not add false positives.
      const prefixes = KNOWN_BREACHED.map((v) => sha1Hex(v).slice(0, 5));
      const real = new Set<string>();
      for (const prefix of prefixes) {
        for (const line of (await readFile(join(dir, `${prefix}.txt`), 'utf8')).split('\n')) real.add(`${prefix}${line.trim().slice(0, 35)}`);
        for (const hash of real) if (hash.startsWith(prefix)) expect(await compact.containsHash(hash), hash).toBe(true);
      }
      let falsePositives = 0;
      for (let i = 0; i < 20_000; i++) {
        const hash = `${prefixes[i % prefixes.length]}${sha1Hex(`probe ${i} ${Math.random()}`).slice(5)}`;
        if ((await compact.containsHash(hash)) !== real.has(hash)) falsePositives++;
      }
      expect(falsePositives).toBe(0);
      expect(compact.entries).toBe(converted.entries);
      const time = async (s: { isBreached(p: string): Promise<boolean> }) => {
        const start = performance.now();
        for (let i = 0; i < 100; i++) await s.isBreached(SURELY_ABSENT);
        return (performance.now() - start) / 100;
      };
      const [textMs, compactMs] = [await time(store), await time(compact)];
      const keysBytes = converted.entries * 8;
      console.log([
        `[HIBP compact, real density] ${converted.entries} hashes in ${stats.files} ranges (${(converted.entries / stats.files).toFixed(0)} per range)`,
        `  text ${(stats.bytes / converted.entries).toFixed(1)} B/hash vs compact keys 8 B/hash (+ 8 MiB fixed index)`,
        `  full miss (5 variants): text ${textMs.toFixed(3)} ms, compact ${compactMs.toFixed(3)} ms`,
        `  extrapolated to 2^20 ranges: text ≈ ${((stats.bytes / stats.files) * 2 ** 20 / 1e9).toFixed(1)} GB in 1,048,576 files; compact ≈ ${((keysBytes / stats.files) * 2 ** 20 / 1e9 + 0.008).toFixed(1)} GB in 1 file`,
      ].join('\n'));
      expect((await verifyCompact(join(compactDir, 'hibp-sample.bin'))).ok).toBe(true);
    } finally {
      await compact.close();
    }
  });

  it('lookup cost with real range sizes (5 variants = up to 5 file reads)', async () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) await store.isBreached(SURELY_ABSENT);
    const perCheck = (performance.now() - start) / 50;
    console.log(`[HIBP live sample] full miss (all variants) ${perCheck.toFixed(2)} ms per check`);
    expect(perCheck).toBeLessThan(200);
  });
});
