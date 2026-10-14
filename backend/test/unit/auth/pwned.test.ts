import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlocklistUnavailableError, PwnedPasswordsStore, UnavailableBlocklist, caseVariants, readManifest, sha1Hex } from '../../../src/modules/auth/pwnedPasswords.js';
import { treeChecksum } from '../../../src/modules/auth/tools/pwnedManifest.js';
import { createPwnedFixture, removePwnedFixture } from '../../support/pwnedFixture.js';

// Offline Pwned Passwords lookup against a small synthetic fixture in the exact HIBP range layout.

describe('Pwned Passwords offline store', () => {
  let dir: string;
  let store: PwnedPasswordsStore;

  beforeAll(async () => {
    dir = await createPwnedFixture();
    store = await PwnedPasswordsStore.open(dir, { production: false });
  });
  afterAll(async () => removePwnedFixture(dir));

  it('uses the HIBP SHA-1 key (known vector) and the range layout', () => {
    expect(sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('detects breached passwords as stored and through the bounded case variants', async () => {
    expect(await store.isBreached('matkhaumoi123456')).toBe(true);
    expect(await store.isBreached('MATKHAUMOI123456')).toBe(true); // lower-case variant
    expect(await store.isBreached('passwordpassword1')).toBe(true); // capitalised variant of the stored spelling
    expect(await store.isBreached('PASSWORDPASSWORD1')).toBe(true);
    expect(await store.isBreached('correct horse battery')).toBe(true); // title-case variant
  });

  it('accepts passwords that are not in the dataset', async () => {
    expect(await store.isBreached('mua thu ha noi co nang vang')).toBe(false);
    expect(await store.isBreached('decoy-999')).toBe(false);
  });

  it('documents the P-4d limit: spellings outside the bounded variants are NOT detected', async () => {
    expect(await store.isBreached('pAsswordPassword9')).toBe(true); // exact spelling
    expect(caseVariants('passwordpassword9')).not.toContain('pAsswordPassword9');
    expect(await store.isBreached('passwordpassword9')).toBe(false); // same letters, other case: NOT detected
  });

  it('P-4d (amended) contract and code agree: at most 5 named variants, documented limit, fail closed 503', async () => {
    expect(caseVariants('xin chào hà nội')).toEqual(['xin chào hà nội', 'XIN CHÀO HÀ NỘI', 'Xin chào hà nội', 'Xin Chào Hà Nội']);
    expect(caseVariants('mIxEd cAsE pAss')).toEqual(['mIxEd cAsE pAss', 'mixed case pass', 'MIXED CASE PASS', 'Mixed case pass', 'Mixed Case Pass']);
    const contract = await readFile(join(import.meta.dirname, '../../../src/modules/auth/AUTH-API-v1.md'), 'utf8');
    const openApi = await readFile(join(import.meta.dirname, '../../../src/modules/auth/AUTH-API-v1.yaml'), 'utf8');
    expect(contract).toContain('**at most 5 case variants**: as typed, lower case, UPPER CASE, Capitalised, Title Case');
    expect(contract).toContain('This is **not** a full case-insensitive match');
    expect(contract).toContain('Dataset missing or invalid → `503 SERVICE_BUSY` (fail closed)');
    expect(contract).toContain('contextual checks: whole-password, case-insensitive');
    expect(openApi).toMatch(/case-insensitive whole-password contextual checks/);
    expect(openApi).toMatch(/at most 5 case variants\s+—\s+not full case-insensitivity/);
  });

  it('is NFC-based: a decomposed input is normalised by the caller before lookup', async () => {
    const decomposed = 'Café Café Café 2026';
    expect(sha1Hex(decomposed)).not.toBe(sha1Hex(decomposed.normalize('NFC')));
  });

  it('manifest checksum detects any change of a range file', async () => {
    const before = await treeChecksum(dir);
    const manifest = await readManifest(dir);
    expect(before.treeSha256).toBe(manifest.treeSha256);
    const file = join(dir, `${sha1Hex('decoy-1').slice(0, 5)}.txt`);
    await writeFile(file, 'TAMPERED:1', { flag: 'a' });
    expect((await treeChecksum(dir)).treeSha256).not.toBe(manifest.treeSha256);
  });

  it('fails closed: missing / invalid manifest, partial data in production, missing range file in a full dataset', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'talo-pwned-empty-'));
    try {
      await expect(PwnedPasswordsStore.open(empty, { production: false })).rejects.toBeInstanceOf(BlocklistUnavailableError);
      await writeFile(join(empty, 'manifest.json'), '{"format":"other"}');
      await expect(PwnedPasswordsStore.open(empty, { production: false })).rejects.toBeInstanceOf(BlocklistUnavailableError);
      await writeFile(join(empty, 'manifest.json'), JSON.stringify({ format: 'talo.hibp-pwned-passwords-sha1-range/v1', source: 's', downloader: 'd', createdAt: 'c', prefixCount: 1048576, treeSha256: '0'.repeat(64) }));
      await expect(PwnedPasswordsStore.open(empty, { production: true })).rejects.toThrow(/range file 00000\.txt missing/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
    await expect(PwnedPasswordsStore.open(dir, { production: true })).rejects.toThrow(/partial/);
    await expect(new UnavailableBlocklist('not configured').isBreached('anything')).rejects.toBeInstanceOf(BlocklistUnavailableError);
  });
});
