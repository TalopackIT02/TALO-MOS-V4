import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FAKE_SECRET_URL, TEST_ORIGIN, buildTestApp } from '../helpers/testApp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GET /api/health', () => {
  it('returns 200 with the exact contract', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'talo-mos-backend' });
  });

  it('does not depend on a database (none configured, or unreachable)', async () => {
    for (const env of [{}, { DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none' }]) {
      const { app } = buildTestApp(env);
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'talo-mos-backend' });
    }
  });

  it('does not expose version, runtime or configuration details', async () => {
    const { app } = buildTestApp({ DATABASE_URL: FAKE_SECRET_URL });
    const res = await request(app).get('/api/health');
    const raw = JSON.stringify({ headers: res.headers, body: res.body });
    expect(raw).not.toMatch(/S3cr3t|postgresql:|node|v24|express/i);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('not found and errors', () => {
  it('returns a structured 404 for unknown paths and methods', async () => {
    const { app } = buildTestApp();
    for (const res of [
      await request(app).get('/api/does-not-exist'),
      await request(app).get('/'),
      await request(app).get('/api/auth/login'),
      await request(app).delete('/api/health').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json'),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.requestId).toMatch(UUID);
    }
  });

  it('hides stack traces and internal messages', async () => {
    const { app, logs } = buildTestApp();
    const res = await request(app).get('/api/__test/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String), requestId: expect.stringMatching(UUID) } });
    expect(JSON.stringify(res.body)).not.toMatch(/S3cr3t|connect failed|at |\.ts/);
    const errorLog = logs.map((line) => JSON.parse(line)).find((entry) => entry.msg === 'unhandled error');
    expect(errorLog?.requestId).toBe(res.body.error.requestId);
    expect(JSON.stringify(logs)).not.toContain('S3cr3t-Value');
  });

  it('does not expose Prisma errors to the client', async () => {
    const { app, logs } = buildTestApp();
    const res = await request(app).get('/api/__test/prisma-boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/Prisma|P1000|password|S3cr3t/i);
    expect(JSON.stringify(logs)).not.toContain('S3cr3t-Value');
    expect(logs.some((line) => line.includes('"errorCode":"P1000"'))).toBe(true);
  });

  it('logs only name/code (no message or stack) in production', async () => {
    const { app, logs } = buildTestApp({ NODE_ENV: 'production', PWNED_PASSWORDS_DIR: '/srv/pwned', APP_ORIGIN: 'https://erp.example.internal' });
    await request(app).get('/api/__test/boom');
    const errorLog = logs.map((line) => JSON.parse(line)).find((entry) => entry.msg === 'unhandled error');
    expect(errorLog).toMatchObject({ errorName: 'Error' });
    expect(errorLog?.errorMessage).toBeUndefined();
    expect(errorLog?.stack).toBeUndefined();
  });
});

describe('JSON body handling', () => {
  const post = (app: Parameters<typeof request>[0]) =>
    request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json');

  it('accepts a small JSON body', async () => {
    const { app } = buildTestApp();
    const res = await post(app).send(JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, keys: ['a'] });
  });

  it('rejects bodies over 10 kB with 413', async () => {
    const { app } = buildTestApp();
    const res = await post(app).send(JSON.stringify({ blob: 'x'.repeat(10 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with a structured 400', async () => {
    const { app } = buildTestApp();
    const res = await post(app).send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected/);
  });

  it('rejects state-changing requests without a JSON content type (415)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN).set('Content-Type', 'text/plain').send('a=1');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('accepts a bodyless state-changing request that declares JSON, rejects one that does not', async () => {
    const { app } = buildTestApp();
    const declared = await request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json; charset=utf-8');
    expect(declared.status).toBe(200);
    const undeclared = await request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN);
    expect(undeclared.status).toBe(415);
  });
});

describe('security headers and request id', () => {
  it('sets Helmet headers and no-store caching', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('issues a fresh server-side request id and ignores a client-supplied one', async () => {
    const { app } = buildTestApp();
    const a = await request(app).get('/api/health').set('X-Request-Id', 'forged-id');
    const b = await request(app).get('/api/health');
    expect(a.headers['x-request-id']).toMatch(UUID);
    expect(a.headers['x-request-id']).not.toBe('forged-id');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('origin allowlist (CSRF X1) and CORS', () => {
  it('allows unsafe methods only from an allowlisted Origin', async () => {
    const { app } = buildTestApp();
    const send = (origin?: string) => {
      const req = request(app).post('/api/__test/echo').set('Content-Type', 'application/json');
      return (origin === undefined ? req : req.set('Origin', origin)).send('{}');
    };
    expect((await send(TEST_ORIGIN)).status).toBe(200);
    for (const origin of [undefined, 'http://evil.example', 'null', 'http://127.0.0.1:5174', 'http://localhost:5173']) {
      const res = await send(origin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('lets safe methods through regardless of Origin', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.status).toBe(200);
  });

  it('honours a configured VPN origin list', async () => {
    const { app } = buildTestApp({ NODE_ENV: 'production', PWNED_PASSWORDS_DIR: '/srv/pwned', APP_ORIGIN: 'https://erp.talo.internal,https://erp2.talo.internal' });
    const ok = await request(app).post('/api/__test/echo').set('Origin', 'https://erp2.talo.internal').set('Content-Type', 'application/json').send('{}');
    const blocked = await request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}');
    expect(ok.status).toBe(200);
    expect(blocked.status).toBe(403);
  });

  it('never emits CORS headers, including on preflight', async () => {
    const { app } = buildTestApp();
    const responses = [
      await request(app).options('/api/health').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'POST'),
      await request(app).get('/api/health').set('Origin', TEST_ORIGIN),
      await request(app).post('/api/__test/echo').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}'),
    ];
    for (const res of responses) {
      expect(Object.keys(res.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });
});

describe('trust proxy', () => {
  it('ignores X-Forwarded-* by default', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/__test/client').set('X-Forwarded-For', '203.0.113.9').set('X-Forwarded-Proto', 'https');
    expect(res.body.ip).not.toBe('203.0.113.9');
    expect(res.body.protocol).toBe('http');
  });

  it('honours X-Forwarded-For only when a proxy hop is configured', async () => {
    const { app } = buildTestApp({ TRUST_PROXY: '1' });
    const res = await request(app).get('/api/__test/client').set('X-Forwarded-For', '203.0.113.9').set('X-Forwarded-Proto', 'https');
    expect(res.body.ip).toBe('203.0.113.9');
    expect(res.body.protocol).toBe('https');
  });
});

describe('logging hygiene', () => {
  it('never logs bodies, cookies, Authorization headers or passwords', async () => {
    const { app, logs } = buildTestApp();
    await request(app)
      .post('/api/__test/echo?token=QueryToken123')
      .set('Origin', TEST_ORIGIN)
      .set('Content-Type', 'application/json')
      .set('Cookie', 'talo_sid=CookieSecret123')
      .set('Authorization', 'Bearer AuthSecret123')
      .send(JSON.stringify({ username: 'NV0001', password: 'PasswordSecret123' }));
    const joined = logs.join('\n');
    for (const secret of ['CookieSecret123', 'AuthSecret123', 'PasswordSecret123', 'QueryToken123', 'NV0001', 'talo_sid']) {
      expect(joined).not.toContain(secret);
    }
    const access = logs.map((line) => JSON.parse(line)).find((entry) => entry.msg === 'request');
    expect(access).toMatchObject({ method: 'POST', path: '/api/__test/echo', status: 200 });
  });
});
