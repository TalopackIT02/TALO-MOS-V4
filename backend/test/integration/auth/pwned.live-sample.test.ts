import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWNED_FORMAT, PwnedPasswordsStore, caseVariants, sha1Hex } from '../../../src/modules/auth/pwnedPasswords.js';
import type { PwnedManifest } from '../../../src/modules/auth/pwnedPasswords.js';
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

  it('lookup cost with real range sizes (5 variants = up to 5 file reads)', async () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) await store.isBreached(SURELY_ABSENT);
    const perCheck = (performance.now() - start) / 50;
    console.log(`[HIBP live sample] full miss (all variants) ${perCheck.toFixed(2)} ms per check`);
    expect(perCheck).toBeLessThan(200);
  });
});
