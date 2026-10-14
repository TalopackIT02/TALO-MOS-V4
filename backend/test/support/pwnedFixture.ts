import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PWNED_FORMAT, sha1Hex } from '../../src/modules/auth/pwnedPasswords.js';
import type { PwnedManifest } from '../../src/modules/auth/pwnedPasswords.js';
import { treeChecksum } from '../../src/modules/auth/tools/pwnedManifest.js';

// Small, synthetic Pwned-Passwords-format dataset for tests: range files in the exact HIBP layout
// ("<35 hex suffix>:<count>", CRLF, one file per 5-hex prefix) built from SHA-1 hashes of strings chosen by the test.
// Written to the OS temp directory (outside Git), marked partial, removed by the caller.

export const FIXTURE_BREACHED = [
  'matkhaumoi123456',          // stored lower case
  'Passwordpassword1',         // stored capitalised: user variants "passwordpassword1" / "PASSWORDPASSWORD1" must match
  'Correct Horse Battery',     // stored title case
  'qwertyuiopasdfghjkl',
  'xinchao123456789',
  'pAsswordPassword9',         // irregular case: shows the P-4d limit (only reachable when typed exactly)
];

export async function createPwnedFixture(entries: readonly string[] = FIXTURE_BREACHED, extraDecoys = 40): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'talo-pwned-fixture-'));
  const ranges = new Map<string, string[]>();
  const add = (hash: string, count: number) => {
    const list = ranges.get(hash.slice(0, 5)) ?? [];
    list.push(`${hash.slice(5)}:${count}`);
    ranges.set(hash.slice(0, 5), list);
  };
  for (const entry of entries) add(sha1Hex(entry.normalize('NFC')), 1000);
  for (let i = 0; i < extraDecoys; i++) add(sha1Hex(`decoy-${i}`), i + 1); // other ranges and same-range neighbours
  for (const [prefix, lines] of ranges) await writeFile(join(dir, `${prefix}.txt`), `${lines.sort().join('\r\n')}`);
  const { count, treeSha256 } = await treeChecksum(dir);
  const manifest: PwnedManifest = {
    format: PWNED_FORMAT, source: 'synthetic test fixture', downloader: 'test/support/pwnedFixture.ts',
    createdAt: new Date().toISOString(), prefixCount: count, treeSha256, partial: true,
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

export async function removePwnedFixture(dir: string): Promise<void> {
  // Guard: only ever delete a directory created by createPwnedFixture.
  const manifest: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const downloader = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'downloader') : undefined;
  if (downloader !== 'test/support/pwnedFixture.ts' || !dir.includes('talo-pwned-fixture-')) throw new Error('refusing to delete a non-fixture directory');
  await rm(dir, { recursive: true, force: true });
}
