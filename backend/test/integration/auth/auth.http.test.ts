import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { silentLogger } from '../../../src/core/logging/logger.js';
import type { AuthRepository } from '../../../src/modules/auth/auth.repository.js';
import { authRouter } from '../../../src/modules/auth/auth.routes.js';
import { AuthService } from '../../../src/modules/auth/auth.service.js';
import { DEFAULT_AUTH_SETTINGS } from '../../../src/modules/auth/auth.settings.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';

// Branches that must be answered BEFORE any database access or Argon2 work (CT-L6, CT-L7, CT-X1, CT-O1 without a
// cookie, CT-S1 without a cookie). The repository fails the test on any call; the hasher counts its calls.

class ForbiddenRepository implements AuthRepository {
  calls: string[] = [];
  private fail(name: string): never {
    this.calls.push(name);
    throw new Error(`database accessed: ${name}`);
  }
  lookup() { return this.fail('lookup'); }
  reserve() { return this.fail('reserve'); }
  withinDeadline() { return this.fail('withinDeadline'); }
  insertAudit() { return this.fail('insertAudit'); }
  loginSuccess() { return this.fail('loginSuccess'); }
  findSession() { return this.fail('findSession'); }
  touchSession() { return this.fail('touchSession'); }
  revokeSession() { return this.fail('revokeSession'); }
  revokeLiveSessionByToken() { return this.fail('revokeLiveSessionByToken'); }
  readPasswordContext() { return this.fail('readPasswordContext'); }
  firstChange() { return this.fail('firstChange'); }
}

class CountingHasher extends PasswordHasher {
  verifies = 0;
  override async verifyPassword(stored: string | null, password: string): Promise<boolean> {
    this.verifies++;
    return super.verifyPassword(stored, password);
  }
}

async function build(limit = 60) {
  const repository = new ForbiddenRepository();
  const hasher = new CountingHasher();
  await hasher.init();
  const service = new AuthService({ repository, hasher, settings: DEFAULT_AUTH_SETTINGS, logger: silentLogger });
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN });
  const app = createApp({
    config, logger: silentLogger,
    apiRouters: [authRouter({ service, loginLimiter: new SlidingWindowRateLimiter({ limit, windowMs: 15 * 60_000 }), secureCookie: false })],
  });
  return { app, repository, hasher };
}

const post = (app: Parameters<typeof request>[0], path: string, body?: unknown) => {
  const req = request(app).post(path).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');
  return body === undefined ? req : req.send(JSON.stringify(body));
};

describe('auth HTTP — branches without database access', () => {
  it('CT-L6: malformed login input → 400 VALIDATION_ERROR, no DB, no Argon2', async () => {
    const { app, repository, hasher } = await build();
    const cases: unknown[] = [
      {}, { username: 'a' }, { password: 'x' }, { username: 1, password: 'x' }, { username: 'a', password: 2 },
      { username: '   ', password: 'x' }, { username: 'a'.repeat(81), password: 'x' }, { username: 'a', password: '' },
      { username: 'a', password: 'x'.repeat(129) }, { username: 'a', password: 'tab\there' }, { username: 'a', password: 'del\u007F' },
      { username: 'a', password: 'c1\u0085' }, { username: 'a', password: 'x', remember: true }, ['a', 'b'],
    ];
    for (const body of cases) {
      const res = await post(app, '/api/auth/login', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    const scalar = await post(app, '/api/auth/login', 'text'); // strict JSON parser: top-level scalar
    expect(scalar.status).toBe(400);
    expect(scalar.body.error.code).toBe('INVALID_JSON');
    expect(repository.calls).toEqual([]);
    expect(hasher.verifies).toBe(0);
  });

  it('CT-L7: the 61st login request from one IP within the window → 429 before validation and Argon2', async () => {
    const { app, repository, hasher } = await build(3);
    for (let i = 0; i < 3; i++) expect((await post(app, '/api/auth/login', {})).status).toBe(400);
    const res = await post(app, '/api/auth/login', { username: 'a', password: 'b' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(repository.calls).toEqual([]);
    expect(hasher.verifies).toBe(0);
  });

  it('CT-X1: POST without Origin / foreign Origin / non-JSON → 403 / 415, no CORS headers, no DB', async () => {
    const { app, repository } = await build();
    for (const path of ['/api/auth/login', '/api/auth/password/first-change', '/api/auth/logout']) {
      const noOrigin = await request(app).post(path).set('Content-Type', 'application/json').send('{}');
      expect(noOrigin.status).toBe(403);
      expect(noOrigin.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      const foreign = await request(app).post(path).set('Origin', 'http://localhost:5173').set('Content-Type', 'application/json').send('{}');
      expect(foreign.status).toBe(403);
      const form = await request(app).post(path).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/x-www-form-urlencoded').send('a=b');
      expect(form.status).toBe(415);
      for (const res of [noOrigin, foreign, form]) expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(repository.calls).toEqual([]);
  });

  it('CT-O1 / CT-S1: no cookie or a malformed cookie → logout 204 + cleared cookie, session 401 + cleared cookie', async () => {
    const { app, repository } = await build();
    for (const cookie of [undefined, 'talo_sid=not-a-token', 'other=1']) {
      const out = post(app, '/api/auth/logout');
      const res = await (cookie ? out.set('Cookie', cookie) : out);
      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']).toEqual(['talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/']);
      const get = request(app).get('/api/auth/session');
      const session = await (cookie ? get.set('Cookie', cookie) : get);
      expect(session.status).toBe(401);
      expect(session.body.error.code).toBe('SESSION_INVALID');
      expect(session.headers['set-cookie']).toEqual(['talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/']);
      const change = await post(app, '/api/auth/password/first-change', { newPassword: 'x' });
      expect(change.status).toBe(401);
    }
    expect(repository.calls).toEqual([]);
  });

  it('CT-X2: no-store, X-Request-Id and no ETag on auth responses', async () => {
    const { app } = await build();
    const res = await post(app, '/api/auth/login', {});
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.etag).toBeUndefined();
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
