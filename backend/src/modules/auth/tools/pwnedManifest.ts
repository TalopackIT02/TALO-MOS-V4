import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FULL_PREFIX_COUNT, PWNED_FORMAT, readManifest } from '../pwnedPasswords.js';
import type { PwnedManifest } from '../pwnedPasswords.js';

// Maintenance CLI for the offline Pwned Passwords dataset (outside Git / outside the database).
//   npm run pwned:manifest -- <dir> --downloader "<tool and version>"   writes <dir>/manifest.json (version + checksum)
//   npm run pwned:verify   -- <dir>                                     recomputes the checksum and compares
// treeSha256 = SHA-256 over the sorted lines "<file name>\t<sha256(file)>\n" of all range files.

const RANGE_FILE = /^[0-9A-F]{5}\.txt$/;

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

export async function treeChecksum(dir: string, onProgress?: (done: number, total: number) => void): Promise<{ count: number; treeSha256: string }> {
  const files = (await readdir(dir)).filter((name) => RANGE_FILE.test(name)).sort();
  const tree = createHash('sha256');
  for (const [index, name] of files.entries()) {
    tree.update(`${name}\t${await fileSha256(join(dir, name))}\n`);
    if (onProgress && index % 65_536 === 0) onProgress(index, files.length);
  }
  return { count: files.length, treeSha256: tree.digest('hex') };
}

async function main(): Promise<void> {
  const [command, dir, ...rest] = process.argv.slice(2);
  if ((command !== 'create' && command !== 'verify') || !dir) throw new Error('usage: pwnedManifest.ts create|verify <dir> [--downloader "<tool version>"] [--partial]');
  const progress = (done: number, total: number) => process.stderr.write(`  ${done}/${total}\n`);
  if (command === 'create') {
    const downloaderIndex = rest.indexOf('--downloader');
    const downloader = downloaderIndex >= 0 ? rest[downloaderIndex + 1] : undefined;
    if (!downloader) throw new Error('--downloader "<tool and version>" is required');
    const partial = rest.includes('--partial');
    const { count, treeSha256 } = await treeChecksum(dir, progress);
    if (!partial && count !== FULL_PREFIX_COUNT) throw new Error(`expected ${FULL_PREFIX_COUNT} range files, found ${count}`);
    const manifest: PwnedManifest = {
      format: PWNED_FORMAT,
      source: 'Have I Been Pwned — Pwned Passwords SHA-1 ranges (https://api.pwnedpasswords.com/range/)',
      downloader, createdAt: new Date().toISOString(), prefixCount: count, treeSha256, ...(partial ? { partial: true } : {}),
    };
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`manifest written: ${count} range files, treeSha256 ${treeSha256}\n`);
  } else {
    const manifest = await readManifest(dir);
    const { count, treeSha256 } = await treeChecksum(dir, progress);
    const ok = count === manifest.prefixCount && treeSha256 === manifest.treeSha256;
    process.stdout.write(`${ok ? 'VERIFIED' : 'MISMATCH'}: ${count} files, treeSha256 ${treeSha256} (manifest ${manifest.treeSha256}, created ${manifest.createdAt})\n`);
    if (!ok) process.exitCode = 1;
  }
}

if (process.argv[1] && /pwnedManifest\.[tj]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'error'}\n`);
    process.exit(1);
  });
}

