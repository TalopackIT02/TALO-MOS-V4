import { describe, expect, it } from 'vitest';
import { auditMetadata, clientInfo } from '../../../src/modules/auth/audit.js';
import { HashQueueBusyError, PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import {
  checkContext, checkPasswordShape, codePointLength, contextualCandidates, hasControlCharacters, isAcceptableLoginPassword, normalizePassword,
} from '../../../src/modules/auth/passwordPolicy.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { hashSessionToken, newSessionToken } from '../../../src/modules/auth/sessionCookie.js';
import { isRetryable, sqlstateOf } from '../../../src/modules/auth/sqlstate.js';

const context = { username: 'nv0001', employeeCode: 'NV-0001', fullName: 'Nguyễn Văn An' };

describe('password policy (AD-6 / P-4)', () => {
  it('normalises to NFC and counts code points, not UTF-16 units', () => {
    const decomposed = 'é'.repeat(15); // é as e + combining acute
    expect(codePointLength(normalizePassword(decomposed))).toBe(15);
    expect(codePointLength('😀'.repeat(15))).toBe(15);
  });

  it('rejects C0, DEL and C1 control characters (P-4c)', () => {
    for (const c of ['\u0000', '\u0009', '\u001F', '\u007F', '\u0080', '\u009F']) {
      expect(hasControlCharacters(`abc${c}def`)).toBe(true);
    }
    expect(hasControlCharacters('mật khẩu có dấu và khoảng trắng')).toBe(false);
    expect(checkPasswordShape('a quite long phrase\twith tab')?.reason).toBe('CONTROL_CHARACTERS');
  });

  it('enforces 15–128 code points and 512 bytes with details', () => {
    expect(checkPasswordShape('short phrase')).toEqual({ reason: 'TOO_SHORT', minLength: 15 });
    expect(checkPasswordShape('x'.repeat(129))).toEqual({ reason: 'TOO_LONG', maxLength: 128 });
    // 128 code points × at most 4 UTF-8 bytes = 512: the byte limit is reached exactly at the code-point limit.
    expect(checkPasswordShape('😀'.repeat(128))).toBeNull();
    expect(checkPasswordShape('mua thu ha noi co nang vang')).toBeNull();
    expect(checkPasswordShape('  leading and trailing spaces  ')).toBeNull(); // no trimming
  });

  it('rejects contextual whole-password matches (username, employee code, name variants, brand + suffix)', () => {
    expect(checkContext('TaloPack@123456', context)?.reason).toBe('CONTEXT_MATCH');
    expect(checkContext('NguyenVanAn2026!', { ...context }) ?? { reason: 'none' }).toEqual({ reason: 'none' }); // suffix "2026!" not in list
    expect(checkContext('nguyenvanan123456', context)?.reason).toBe('CONTEXT_MATCH');
    expect(checkContext('Nguyễn Văn An 2026', context)).toBeNull();
    expect(contextualCandidates(context).has('nv0001nv0001123')).toBe(true);
  });

  it('accepts login input up to the upper bounds only', () => {
    expect(isAcceptableLoginPassword('a')).toBe(true);
    expect(isAcceptableLoginPassword('')).toBe(false);
    expect(isAcceptableLoginPassword('x'.repeat(129))).toBe(false);
    expect(isAcceptableLoginPassword('😀'.repeat(129))).toBe(false);
    expect(isAcceptableLoginPassword('ok\u007F')).toBe(false);
  });
});

describe('rate limiter (P-7 local 60 / 15 min / IP)', () => {
  it('allows 60 requests per IP in the window, then refuses; other IPs are independent', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter({ limit: 60, windowMs: 15 * 60_000, now: () => now });
    for (let i = 0; i < 60; i++) expect(limiter.consume('10.0.0.1')).toBe(true);
    expect(limiter.consume('10.0.0.1')).toBe(false);
    expect(limiter.consume('10.0.0.2')).toBe(true);
    now = 15 * 60_000 + 1;
    expect(limiter.consume('10.0.0.1')).toBe(true);
  });
});

describe('session token and audit metadata', () => {
  it('issues 32-byte base64url tokens and stores SHA-256 hex', () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionToken()).not.toBe(token);
  });

  it('keeps only the allowed keys and truncates ip / ua to 256 characters', () => {
    const client = clientInfo('rid', '127.0.0.1', 'U'.repeat(300));
    const meta = auditMetadata(client, 'BAD_PASSWORD', { slot: 2 });
    expect(Object.keys(meta).sort()).toEqual(['ip', 'reason', 'requestId', 'slot', 'ua', 'v']);
    expect(meta.ua).toHaveLength(256);
    expect(clientInfo('rid', undefined, undefined)).toEqual({ requestId: 'rid', ip: null, ua: null });
  });
});

describe('SQLSTATE extraction', () => {
  it('finds nested codes and classifies 40P01 / 40001 as retryable', () => {
    expect(sqlstateOf({ name: 'PrismaClientKnownRequestError', code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } })).toBe('40P01');
    expect(isRetryable({ cause: { code: '40001' } })).toBe(true);
    expect(isRetryable({ code: '23505' })).toBe(false);
    expect(sqlstateOf(new Error('x'))).toBeUndefined();
  });
});

describe('password hasher (Argon2id, shared queue — IB-3)', () => {
  it('hashes with Argon2id and the local baseline, verifies, and the dummy never matches', async () => {
    const hasher = new PasswordHasher();
    await hasher.init();
    const stored = await hasher.hashPassword('mua thu ha noi co nang vang');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hasher.verifyPassword(stored, 'mua thu ha noi co nang vang')).toBe(true);
    expect(await hasher.verifyPassword(stored, 'wrong')).toBe(false);
    expect(await hasher.verifyPassword(null, 'anything')).toBe(false);
    expect(await hasher.verifyPassword('not-a-phc-string', 'anything')).toBe(false);
  });

  it('rejects with HashQueueBusyError when the global queue is full, for every caller alike', async () => {
    const hasher = new PasswordHasher(undefined, { maxConcurrent: 1, maxQueued: 1, queueTimeoutMs: 5_000 });
    await hasher.init();
    const first = hasher.verifyPassword(null, 'a');
    const second = hasher.verifyPassword(null, 'b');
    await expect(hasher.verifyPassword(null, 'c')).rejects.toBeInstanceOf(HashQueueBusyError);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  });

  it('times out queued work with HashQueueBusyError', async () => {
    const hasher = new PasswordHasher(undefined, { maxConcurrent: 1, maxQueued: 5, queueTimeoutMs: 1 });
    await hasher.init();
    const running = hasher.hashPassword('long running hash input');
    await expect(hasher.verifyPassword(null, 'queued')).rejects.toBeInstanceOf(HashQueueBusyError);
    await running;
  });
});
