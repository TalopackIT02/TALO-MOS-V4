import { resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { silentLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import type { AuthRepository } from '../../../src/modules/auth/auth.repository.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { lit } from '../sc5/harness.js';
import type { PsqlSession } from '../sc5/harness.js';

// IB-2 timing analysis (measured and reported; never asserted as "indistinguishable"). TALO_AUTH_DB=1 + TALO_AUTH_TIMING=1.
// Branches are interleaved round-robin. Per request the server-side phases are timed: lookup, RESERVE, Argon2 (incl. queue
// wait), audit, and the client-observed HTTP total. AUC(A,B) = P(time_A > time_B): 0.5 = not separable, 0 or 1 = fully.

const enabled = process.env['TALO_AUTH_DB'] === '1' && process.env['TALO_AUTH_TIMING'] === '1';
const SAMPLES = Number(process.env['TALO_AUTH_TIMING_SAMPLES'] ?? 120);

type Phase = 'lookup' | 'reserve' | 'argon2' | 'audit' | 'http';
const PHASES: Phase[] = ['lookup', 'reserve', 'argon2', 'audit', 'http'];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
function p90(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.9)] ?? 0;
}
function auc(a: number[], b: number[]): number {
  let wins = 0;
  for (const x of a) for (const y of b) wins += x > y ? 1 : x === y ? 0.5 : 0;
  return wins / (a.length * b.length);
}

describe.skipIf(!enabled)('IB-2 timing analysis (talo_mos_v4_test)', { timeout: 600_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let hasher: PasswordHasher;

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    hasher = new PasswordHasher();
    await hasher.init();
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
  });
  afterEach(async () => {
    const deleted = await fx.cleanup();
    console.log(`[IB-2] cleanup ${JSON.stringify(deleted)}`);
  });
  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
  });

  it('per-branch, per-phase timing and pairwise separability', async () => {
    let current: Partial<Record<Phase, number>> = {};
    const timed = <A extends unknown[], R>(phase: Phase, fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
      const start = performance.now();
      try {
        return await fn(...args);
      } finally {
        current[phase] = (current[phase] ?? 0) + performance.now() - start;
      }
    };
    class TimedHasher extends PasswordHasher {
      override verifyPassword = timed('argon2', (stored: string | null, password: string) => hasher.verifyPassword(stored, password));
    }
    const wrap = (repo: AuthRepository): AuthRepository => ({
      lookup: timed('lookup', repo.lookup.bind(repo)), reserve: timed('reserve', repo.reserve.bind(repo)),
      withinDeadline: repo.withinDeadline.bind(repo), insertAudit: timed('audit', repo.insertAudit.bind(repo)),
      loginSuccess: repo.loginSuccess.bind(repo), findSession: repo.findSession.bind(repo), touchSession: repo.touchSession.bind(repo),
      revokeSession: repo.revokeSession.bind(repo), revokeLiveSessionByToken: repo.revokeLiveSessionByToken.bind(repo),
      readPasswordContext: repo.readPasswordContext.bind(repo), firstChange: repo.firstChange.bind(repo),
    });
    const timedHasher = new TimedHasher();
    await timedHasher.init();
    const auth = await createAuthModule({ prisma, logger: silentLogger, production: false, hasher: timedHasher, wrapRepository: wrap,
      loginLimiter: new SlidingWindowRateLimiter({ limit: 1_000_000, windowMs: 60_000 }) });
    const app: Express = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: silentLogger, apiRouters: [auth.router] });

    const noCred = await fx.create({ withCredential: false });
    const open = await fx.create();
    const locked = await fx.create();
    const login = async (username: string): Promise<number> => {
      const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
        .set('User-Agent', fx.userAgent).send(JSON.stringify({ username, password: 'definitely the wrong password' }));
      if (!fx.isFixtureUsername(username)) fx.registerUnknownAttempt(res.headers['x-request-id']);
      expect(res.status).toBe(401);
      return res.status;
    };
    for (let i = 0; i < 5; i++) await login(locked.username);
    // Keeps the "open" account inside a cycle with free slots (outside the timed region).
    const reopen = () => h.ok(`UPDATE iam.iam_credentials SET locked_until = statement_timestamp() - interval '1 second',
      updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
      WHERE user_account_id = ${lit(open.accountId)} AND failed_attempt_count >= 4`);

    const branches: Record<string, { prepare?: () => Promise<unknown>; username: string }> = {
      'unknown username': { username: `${fx.runId}-nobody` },
      'no credential': { username: noCred.username },
      'wrong password (slot)': { prepare: reopen, username: open.username },
      'temporarily locked': { username: locked.username },
    };
    const data: Record<string, Record<Phase, number[]>> = {};
    for (const name of Object.keys(branches)) data[name] = { lookup: [], reserve: [], argon2: [], audit: [], http: [] };
    for (let warm = 0; warm < 10; warm++) for (const b of Object.values(branches)) { await b.prepare?.(); await login(b.username); }
    for (let i = 0; i < SAMPLES; i++) {
      for (const [name, b] of Object.entries(branches)) {
        await b.prepare?.();
        current = {};
        const start = performance.now();
        await login(b.username);
        const http = performance.now() - start;
        const row = data[name];
        if (!row) continue;
        row.http.push(http);
        for (const phase of PHASES) if (phase !== 'http') row[phase].push(current[phase] ?? 0);
      }
    }
    const lines = [`[IB-2] ${SAMPLES} samples/branch, interleaved — median / p90 in ms`];
    lines.push(`  ${'branch'.padEnd(24)}${PHASES.map((p) => p.padStart(16)).join('')}`);
    for (const [name, row] of Object.entries(data)) {
      lines.push(`  ${name.padEnd(24)}${PHASES.map((p) => `${median(row[p]).toFixed(2)} / ${p90(row[p]).toFixed(2)}`.padStart(16)).join('')}`);
    }
    const ref = data['unknown username'];
    if (ref) {
      lines.push('  AUC of HTTP total vs "unknown username" (0.5 = not separable):');
      for (const [name, row] of Object.entries(data)) {
        if (name === 'unknown username') continue;
        lines.push(`    ${name.padEnd(24)} http ${auc(row.http, ref.http).toFixed(3)}   reserve ${auc(row.reserve, ref.reserve).toFixed(3)}   audit ${auc(row.audit, ref.audit).toFixed(3)}   argon2 ${auc(row.argon2, ref.argon2).toFixed(3)}`);
      }
    }
    console.log(lines.join('\n'));
  });
});
