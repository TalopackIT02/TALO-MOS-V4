import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../backend/src/app.js';
import { loadConfig } from '../../../backend/src/config/env.js';
import { createLogger } from '../../../backend/src/core/logging/logger.js';
import { createPrismaClient } from '../../../backend/src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../backend/src/infrastructure/prisma/generated/client.js';
import type { MenuNode } from '../../../backend/src/modules/foundation/foundation.navigation.js';
import { SqlNavigationRepository } from '../../../backend/src/modules/foundation/foundation.navigation.repository.js';
import { NavigationService } from '../../../backend/src/modules/foundation/foundation.navigation.service.js';
import { evaluateAccess } from '../../../backend/src/modules/foundation/foundation.permissions.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../backend/src/modules/foundation/foundation.repository.js';
import { createHostCapabilities } from '../../../backend/src/module-host/capabilities.js';
import { PsqlSession, lit, uuidArray } from '../../../backend/test/integration/sc5/harness.js';
import { FakeAuth, TEST_ORIGIN, token } from '../../../backend/test/unit/foundation/fakes.js';
import { createModule } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/index.js';
import { DATA_INSPECTOR_BINDING } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.permissions.js';

// DI-04 H3 / F1 — post-activation acceptance of DATA_INSPECTOR on PostgreSQL TEST with the REAL registration (module
// ENABLED + 1 ACTIVE), the REAL permissions data_inspector.* and the REAL Foundation menu (NavigationService). Nothing is
// stubbed except the Auth session store of ONE non-admin FIXTURE account (no login, so no IAM audit row that would pin
// the fixture account). The admin side is accepted with the real admin session by the owner helper (DI-04 helper).
// Writes (talo_test_harness, existing grants): 1 membership + 1 account (FBET_DIA_<RUN>) and, for the mis-grant case,
// 2 Direct ALLOW of the real permissions to that fixture account — all deleted by recorded id; B08 DENIED rows kept.
// Runs ONLY with TALO_DATA_INSPECTOR_ACCEPT_DB=1 after the module is ENABLED. DI_API (default http://127.0.0.1:3100/api)
// is the running TEST backend used for the 401 checks.

const enabled = process.env['TALO_DATA_INSPECTOR_ACCEPT_DB'] === '1';
const API = process.env['DI_API'] ?? 'http://127.0.0.1:3100/api';
const RUN = `FBET_DIA_${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 4).toUpperCase()}`;
const REASON = `${RUN} fixture`;
const created = { memberships: [] as string[], accounts: [] as string[], userPermissions: [] as string[] };

const routesOf = (nodes: readonly MenuNode[]): string[] => nodes.flatMap((n) => [...(n.routePath === null ? [] : [n.routePath]), ...routesOf(n.children)]);

describe.runIf(enabled)('DI-04 acceptance — DATA_INSPECTOR registered on PostgreSQL TEST (real lifecycle, permissions, menu)', { timeout: 300_000 }, () => {
  let h: PsqlSession;
  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let navigation: NavigationService;
  let repository: SqlFoundationRepository;
  let host: ReturnType<typeof createHostCapabilities>;
  const auth = new FakeAuth();
  const logs: string[] = [];
  let adminId = '';
  let userId = '';
  let perms: string[] = [];
  let tableKey = '';
  let holdersBefore = '';
  const evidence: Record<string, string> = {};
  const one = async (sql: string): Promise<string> => (await h.ok(sql))[0]?.[0] ?? '';
  const get = (path: string) => request(app).get(`/api/data-inspector${path}`).set('Cookie', `talo_sid=${token('user')}`);
  const audits = async (requestId: string) => h.ok(`SELECT action_code, outcome, metadata->>'reason' FROM foundation.fnd_audit_logs WHERE metadata->>'requestId' = ${lit(requestId)}`);
  const holders = async () => (await h.ok(`SELECT a.username || ':' || up.effect || ':' || p.permission_code FROM iam.iam_user_permissions up
    JOIN iam.iam_user_accounts a ON a.user_account_id = up.user_account_id JOIN iam.iam_permissions p ON p.permission_id = up.permission_id
    WHERE p.module_code = 'DATA_INSPECTOR' AND up.revoked_at IS NULL ORDER BY 1`)).map((r) => r[0]).join(',');

  beforeAll(async () => {
    const url = process.env['DATABASE_URL'];
    if (url === undefined) throw new Error('PRECHECK: DATABASE_URL is not set');
    h = new PsqlSession();
    const [who] = await h.ok(`SELECT current_database(), current_user`);
    if (who?.[0] !== 'talo_mos_v4_test' || who[1] !== 'talo_test_harness') throw new Error('PRECHECK: harness target refused');
    prisma = createPrismaClient(url);
    const db = prismaFoundationDb(prisma);
    const [id] = await db.query(`SELECT current_database() AS d, current_user AS u`, []) as { d: string; u: string }[];
    if (id?.d !== 'talo_mos_v4_test' || id.u !== 'talo_app') throw new Error('PRECHECK: API connection must be talo_app on talo_mos_v4_test');
    const [life] = await h.ok(`SELECT m.is_enabled, (SELECT count(*) FROM foundation.fnd_module_versions v WHERE v.module_id = m.module_id AND v.status = 'ACTIVE')
      FROM foundation.fnd_modules m WHERE m.module_key = 'DATA_INSPECTOR'`);
    if (life?.[0] !== 't' || life[1] !== '1') throw new Error('PRECHECK: DATA_INSPECTOR must be ENABLED with exactly one ACTIVE version');
    if (await one(`SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE 'FBET\\_DIA\\_%'`) !== '0') throw new Error('PRECHECK: FBET_DIA residue exists');
    perms = (await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE module_code = 'DATA_INSPECTOR' ORDER BY permission_code`)).map((r) => r[0] ?? '');
    if (perms.length !== 2) throw new Error('PRECHECK: the two data_inspector permissions must exist');
    adminId = await one(`SELECT user_account_id FROM iam.iam_user_accounts WHERE username = 'admin'`);
    holdersBefore = await holders();
    const [rel] = await h.ok(`SELECT c.oid::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'foundation' AND c.relname = 'fnd_modules'`);
    const { tableKeyOf } = await import('../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.sql.js');
    tableKey = tableKeyOf({ oid: rel?.[0] ?? '', schema: 'foundation', table: 'fnd_modules', relkind: 'r' });

    const membershipId = randomUUID();
    userId = randomUUID();
    created.memberships.push(membershipId);
    created.accounts.push(userId);
    await h.ok('BEGIN');
    try {
      await h.ok(`INSERT INTO iam.iam_memberships (membership_id, employee_id, employee_code, full_name, membership_status, joined_at)
        VALUES (${lit(membershipId)}, ${lit(randomUUID())}, ${lit(`${RUN}-M1`)}, ${lit(`${RUN} synthetic`)}, 'ACTIVE', current_date - 30)`);
      await h.ok(`INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, activated_at)
        VALUES (${lit(userId)}, ${lit(membershipId)}, ${lit(`${RUN.toLowerCase()}-u1`)}, 'ACTIVE', statement_timestamp())`);
      await h.ok('COMMIT');
    } catch (error) {
      await h.query('ROLLBACK');
      throw error;
    }
    const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
    auth.authenticated(token('user'), userId);
    repository = new SqlFoundationRepository(db);
    navigation = new NavigationService({ access: repository, navigation: new SqlNavigationRepository(db), logger });
    host = createHostCapabilities('DATA_INSPECTOR', { db, access: repository, authService: auth, logger, secureCookie: false, navigation });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [createModule(host).router] });
  });

  afterAll(async () => {
    let blocked: string | null = null;
    try {
      if (h !== undefined && created.accounts.length > 0) {
        const accounts = uuidArray(created.accounts);
        const proof = await one(`SELECT count(*) FROM iam.iam_user_permissions WHERE user_account_id = ANY(${accounts}) AND NOT (user_permission_id = ANY(${uuidArray(created.userPermissions)}) AND reason = ${lit(REASON)})`);
        if (proof !== '0') throw new Error('BLOCKED: fixture grant ownership could not be proven');
        await h.ok('BEGIN');
        for (const [name, sql] of [
          ['user_permissions', `DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${uuidArray(created.userPermissions)}) AND user_account_id = ANY(${accounts}) AND reason = ${lit(REASON)}`],
          ['accounts', `DELETE FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}) AND username LIKE ${lit(`${RUN.toLowerCase()}-%`)}`],
          ['memberships', `DELETE FROM iam.iam_memberships WHERE membership_id = ANY(${uuidArray(created.memberships)}) AND employee_code LIKE ${lit(`${RUN}-%`)}`],
        ] as const) {
          const r = await h.query(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`);
          if (r.error) {
            await h.query('ROLLBACK');
            throw new Error(`BLOCKED: cleanup failed at ${name} [${r.sqlstate}]`);
          }
          evidence[`deleted.${name}`] = r.rows[0]?.[0] ?? '?';
        }
        await h.ok('COMMIT');
        evidence['remaining'] = await one(`SELECT (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${RUN}-%`)})
          + (SELECT count(*) FROM iam.iam_user_accounts WHERE username LIKE ${lit(`${RUN.toLowerCase()}-%`)}) + (SELECT count(*) FROM iam.iam_user_permissions WHERE reason = ${lit(REASON)})`);
        if (evidence['remaining'] !== '0') throw new Error('BLOCKED: fixture rows remain');
        if ((await holders()) !== holdersBefore) throw new Error('BLOCKED: data_inspector holders differ from before the run');
        evidence['holdersAfter'] = holdersBefore;
      }
    } catch (error) {
      blocked = error instanceof Error ? error.message : 'BLOCKED';
    }
    process.stdout.write(`[DI-04-ACCEPT] run ${RUN} evidence ${JSON.stringify(evidence)}${blocked ? ` ${blocked}` : ''}\n`);
    await h?.close();
    await prisma?.$disconnect();
    expect(blocked).toBeNull();
  });

  it('ACC-01 real registration: lifecycle ENABLED + 1 ACTIVE, admin is the only holder (Direct ALLOW, no role), IAM evaluates ALLOW for admin', async () => {
    expect(await host.lifecycle('DATA_INSPECTOR')).toEqual({ isEnabled: true, activeVersions: 1 });
    expect(holdersBefore).toBe('admin:ALLOW:data_inspector.catalog.read,admin:ALLOW:data_inspector.rows.read');
    expect(await one(`SELECT count(*) FROM iam.iam_role_permissions WHERE permission_id = ANY(${uuidArray(perms)})`)).toBe('0');
    for (const p of [DATA_INSPECTOR_BINDING.catalogRead, DATA_INSPECTOR_BINDING.rowsRead]) {
      expect([p.permissionCode, evaluateAccess(await repository.loadAccessFacts(adminId, p), 1)]).toEqual([p.permissionCode, { allowed: true }]);
    }
    evidence['ACC-01'] = 'PASS';
  });

  it('ACC-02 non-admin without permission: menu has no /data-inspector; the three APIs → 403 by IAM (B08 DENIED NO_VALID_ALLOW)', async () => {
    expect(routesOf(await navigation.menu({ userAccountId: userId, assuranceLevel: 1, requestId: randomUUID() }))).not.toContain('/data-inspector');
    for (const path of ['/tables', `/tables/${tableKey}/columns`, `/tables/${tableKey}/rows`]) {
      const res = await get(path);
      expect([path, res.status, res.body.error?.code]).toEqual([path, 403, 'FORBIDDEN']);
      expect((await audits(res.body.error.requestId)).map((r) => [r[1], r[2]])).toEqual([['DENIED', 'NO_VALID_ALLOW']]);
    }
    evidence['ACC-02'] = 'PASS';
  });

  it('ACC-03 non-admin with a mis-granted Direct ALLOW: the menu shows /data-inspector (known B09 limit) but the APIs → 403 by the username gate', async () => {
    for (const p of perms) {
      const id = randomUUID();
      created.userPermissions.push(id);
      await h.ok(`INSERT INTO iam.iam_user_permissions (user_permission_id, user_account_id, permission_id, effect, reason) VALUES (${lit(id)}, ${lit(userId)}, ${lit(p)}, 'ALLOW', ${lit(REASON)})`);
    }
    expect(routesOf(await navigation.menu({ userAccountId: userId, assuranceLevel: 1, requestId: randomUUID() }))).toContain('/data-inspector');
    for (const path of ['/tables', `/tables/${tableKey}/columns`, `/tables/${tableKey}/rows`]) {
      const res = await get(path);
      expect([path, res.status, res.body.error?.code]).toEqual([path, 403, 'FORBIDDEN']);
      expect(await audits(res.body.error.requestId)).toEqual([]); // IAM allowed; the module's account gate refused
    }
    expect(logs.filter((l) => l.includes('DATA_INSPECTOR.ACCESS_DENIED')).length).toBeGreaterThanOrEqual(3);
    await h.ok(`DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${uuidArray(created.userPermissions)}) AND user_account_id = ${lit(userId)} AND reason = ${lit(REASON)}`);
    created.userPermissions.length = 0;
    evidence['ACC-03'] = 'PASS';
  });

  it('ACC-04 running TEST backend: no session / forged session → 401 on the three APIs', async () => {
    for (const path of ['/data-inspector/tables', `/data-inspector/tables/${tableKey}/columns`, `/data-inspector/tables/${tableKey}/rows`]) {
      for (const headers of [{}, { Cookie: `talo_sid=${'x'.repeat(43)}` }]) {
        const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json', ...headers } });
        expect([path, res.status]).toEqual([path, 401]);
      }
    }
    evidence['ACC-04'] = 'PASS';
  });
});
