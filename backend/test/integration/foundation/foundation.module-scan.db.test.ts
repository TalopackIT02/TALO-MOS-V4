import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import type { ScanReport } from '../../../src/modules/foundation/foundation.module-scan.types.js';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FMI-01 — Manual Module Scan on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1. The real app
// (auth + Foundation as talo_app) scans the REAL repository modules/ (read only) against the REAL Registry. Proves: an
// authorised scan changes no Foundation table (B01–B14 identical before / after); a refused one writes exactly one B08
// DENIED row (existing AccessGuard rule). IAM fixtures (AUTHT- accounts, FBET- roles) are removed by UUID afterwards.

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const NIL = '00000000-0000-0000-0000-000000000000';
const TABLES = ['fnd_modules', 'fnd_module_versions', 'fnd_functions', 'fnd_actions', 'fnd_version_functions', 'fnd_version_actions', 'fnd_module_events',
  'fnd_audit_logs', 'fnd_navigation_items', 'fnd_data_contracts', 'fnd_data_fields', 'fnd_data_access_rules', 'fnd_compatibility_checks', 'fnd_compatibility_changes'];

describe.skipIf(!enabled)('FMI-01 Manual Module Scan — PostgreSQL (talo_mos_v4_test)', { timeout: 180_000 }, () => {
  let prisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let app: Express;
  const roles: { roleId: string; userRoleId: string; code: string; accountId: string }[] = [];
  const run = `FBET-FMI01-${Date.now().toString(36).toUpperCase()}`;
  const evidence: Record<string, unknown> = {};
  const repo = resolve(import.meta.dirname, '../../../..');

  const counts = async () => (await h.ok(`SELECT ${TABLES.map((t) => `(SELECT count(*) FROM foundation.${t})`).join(', ')}`))[0] ?? [];
  const digest = async () => (await h.ok(`SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
      SELECT 'm' || module_id || module_key || is_enabled || updated_at AS x FROM foundation.fnd_modules
      UNION ALL SELECT 'v' || version_id || status || coalesce(manifest_hash, '') || coalesce(activated_at::text, '') FROM foundation.fnd_module_versions
      UNION ALL SELECT 'n' || navigation_id || menu_title || sort_order || is_visible FROM foundation.fnd_navigation_items) s`))[0]?.[0];

  async function login(permissionCodes: readonly string[]): Promise<string> {
    const acc = await fx.create();
    if (permissionCodes.length > 0) {
      const ids = await h.ok(`SELECT permission_id::text FROM iam.iam_permissions WHERE module_code = 'FOUNDATION' AND permission_code = ANY(ARRAY[${permissionCodes.map(lit).join(',')}]::text[])`);
      expect(ids).toHaveLength(permissionCodes.length);
      const r = { roleId: randomUUID(), userRoleId: randomUUID(), code: `${run}-R${roles.length + 1}`, accountId: acc.accountId };
      roles.push(r);
      await h.ok('BEGIN');
      await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(r.roleId)}, ${lit(r.code)}, 'FBET FMI-01 scan', true, false)`);
      for (const p of ids) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(r.roleId)}, ${lit(p[0] ?? '')})`);
      await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(r.userRoleId)}, ${lit(acc.accountId)}, ${lit(r.roleId)})`);
      await h.ok('COMMIT');
    }
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', fx.userAgent)
      .send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0] ?? '';
    expect(cookie.startsWith('talo_sid=')).toBe(true);
    return cookie;
  }
  const scan = (cookie: string) => request(app).post('/api/foundation/module-packages/scan').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json')
    .set('User-Agent', fx.userAgent).set('Cookie', cookie).send('{}');

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const [identity] = await prisma.$queryRawUnsafe<{ db: string; usr: string }[]>('SELECT current_database() AS db, current_user AS usr');
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app') throw new Error('guard: API must run as talo_app on talo_mos_v4_test');
    evidence['runtime'] = identity;
    const logger = createLogger({ level: 'warn', sink: () => {} });
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({ prisma, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }) });
    const foundation = createFoundationModule({ prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST' });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    const [left] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE 'FBET-%'`);
    if (left?.[0] !== '0') throw new Error('fixture guard: leftover FBET- roles');
  });

  afterEach(async () => {
    const ids = uuidArray(roles.length ? roles.map((r) => r.roleId) : [NIL]);
    const userRoles = uuidArray(roles.length ? roles.map((r) => r.userRoleId) : [NIL]);
    const [foreign] = await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_id = ANY(${ids}) AND role_code NOT LIKE ${lit(`${run}-R%`)}`);
    if (foreign?.[0] !== '0') throw new Error('cleanup refused: role ownership not proven');
    await h.ok('BEGIN');
    await h.ok(`DELETE FROM iam.iam_user_roles WHERE user_role_id = ANY(${userRoles}) AND role_id = ANY(${ids})`);
    await h.ok(`DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${ids})`);
    await h.ok(`DELETE FROM iam.iam_roles WHERE role_id = ANY(${ids}) AND role_code LIKE ${lit(`${run}-R%`)}`);
    await h.ok('COMMIT');
    roles.length = 0;
    evidence['authCleanup'] = await fx.cleanup();
  });

  afterAll(async () => {
    const remaining = fx ? await fx.remaining() : -1;
    const [roleLeft] = h ? await h.ok(`SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${run}-%`)}`) : [['-1']];
    console.log(`[fmi01-db] evidence ${JSON.stringify({ ...evidence, remaining, roleLeftovers: roleLeft?.[0] })}`);
    await h?.close();
    await prisma?.$disconnect();
    expect(remaining).toBe(0);
    expect(roleLeft?.[0]).toBe('0');
  });

  it('authorised scan of the real modules/ against the real Registry: B01–B14 unchanged; installed packages classified, hash = deployment lock', async () => {
    const cookie = await login(['foundation.module_registry.read', 'foundation.module_registry.create']);
    const before = await counts();
    const digestBefore = await digest();
    const res = await scan(cookie);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const report: ScanReport = res.body;
    expect(await counts()).toEqual(before);
    expect(await digest()).toBe(digestBefore);
    expect(report.registryAvailable).toBe(true);
    const lock: { modules: { moduleKey: string; packageVersion: string; packageHash: string }[] } = JSON.parse(readFileSync(join(repo, 'backend', 'module-deployments.json'), 'utf8'));
    for (const d of lock.modules) {
      // FMI-02/03: the deployed package is the release in the store (exact pinned hash); modules/<KEY> is the candidate
      // drop zone and may already hold a newer package of the same key (e.g. SYSTEM_TEST 1.2.0 while 1.1.1 runs).
      const rel = join(repo, 'backend', 'module-releases', d.moduleKey, d.packageVersion);
      expect([d.moduleKey, hashPackage(rel, walkPackage(rel)).hash]).toEqual([d.moduleKey, d.packageHash]);
      const m = report.modules.find((x) => x.folder === d.moduleKey);
      if (m?.packageHash !== d.packageHash) {
        expect([d.moduleKey, m?.packageVersion === d.packageVersion]).toEqual([d.moduleKey, false]);
        // the candidate must carry no error (the route-holding FBET fixture is DISABLED: WARN with its key, never silent)
        expect((m?.issues ?? []).filter((i) => i.severity === 'ERROR').map((i) => i.code)).toEqual([]);
        evidence[`${d.moduleKey}Candidate`] = `${m?.packageVersion ?? '?'}:${m?.classification ?? '?'}:${m?.scanStatus ?? '?'}`;
        continue;
      }
      const [row] = await h.ok(`SELECT v.status FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE m.module_key = ${lit(d.moduleKey)} AND v.module_version = ${lit(d.packageVersion)}`);
      expect([d.moduleKey, m?.packageVersion, m?.packageHash, m?.micFormat]).toEqual([d.moduleKey, d.packageVersion, d.packageHash, 'LEGACY_TS']);
      expect([d.moduleKey, m?.classification, m?.foundationVersionStatus]).toEqual([d.moduleKey, row ? 'EXISTING_VERSION' : m?.classification, row?.[0] ?? null]);
      expect(m?.eligibleForPreflight).toBe(false);
      // TEST data: an append-only FBET_ST_* fixture left ACTIVE by an interrupted SYSTEM_TEST DB run carries the SYSTEM_TEST
      // routes — a REAL registry conflict the scanner must report. Any other FAIL is a defect.
      const errors = (m?.issues ?? []).filter((i) => i.severity === 'ERROR');
      for (const e of errors) expect([d.moduleKey, e.code, /module ACTIVE FBET_/.test(e.message)]).toEqual([d.moduleKey, 'MODULE_ROUTE_CONFLICT', true]);
      evidence[`${d.moduleKey}Errors`] = errors.map((e) => e.message);
    }
    expect(JSON.stringify(report)).not.toContain(repo);
    evidence['authorised'] = { status: res.status, summary: report.summary, modules: report.modules.map((m) => `${m.folder}@${m.packageVersion}:${m.classification}/${m.foundationVersionStatus}:${m.scanStatus}`), b01b14: before };
  });

  it('refused scans (READ only, no grant): 403 and exactly one B08 DENIED MODULE_PACKAGE.SCAN each; nothing else written', async () => {
    for (const perms of [['foundation.module_registry.read'], []]) {
      const cookie = await login(perms);
      const before = await counts();
      const res = await scan(cookie);
      expect(res.status).toBe(403);
      const requestId = String(res.headers['x-request-id']);
      const audits = await h.ok(`SELECT action_code, outcome, target_type FROM foundation.fnd_audit_logs WHERE correlation_id = ${lit(requestId)}`);
      expect(audits).toEqual([['MODULE_PACKAGE.SCAN', 'DENIED', 'MODULE_PACKAGE']]);
      const after = await counts();
      expect(after.map((c, i) => Number(c) - Number(before[i]))).toEqual(TABLES.map((t) => (t === 'fnd_audit_logs' ? 1 : 0)));
      evidence[`refused${perms.length}`] = { status: res.status, audit: audits };
    }
  });
});
