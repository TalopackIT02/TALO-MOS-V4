import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../backend/src/app.js';
import { loadConfig } from '../../../backend/src/config/env.js';
import { createLogger } from '../../../backend/src/core/logging/logger.js';
import { createPrismaClient } from '../../../backend/src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../backend/src/infrastructure/prisma/generated/client.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../backend/src/modules/foundation/foundation.repository.js';
import { createHostCapabilities } from '../../../backend/src/module-host/capabilities.js';
import type { HostCapabilities } from '../../../backend/src/module-host/contract.js';
import { PsqlSession, lit, uuidArray } from '../../../backend/test/integration/sc5/harness.js';
import { FakeAuth, TEST_ORIGIN, token } from '../../../backend/test/unit/foundation/fakes.js';
import { createModule } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/index.js';
import { tableKeyOf } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.sql.js';
import type { DataInspectorBinding } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.permissions.js';

// DI-03B — DATA_INSPECTOR IAM runtime on PostgreSQL TEST with a FIXTURE K05 binding (evidence "DI-IAM-DB (FIXTURE)").
// What is REAL: the IAM rows on talo_mos_v4_test, Foundation's SqlFoundationRepository.loadAccessFacts + evaluateAccess
// (AccessGuard) as talo_app, the B08 DENIED audit INSERT, the Host READ ONLY executor and the module's `admin` account
// gate on the real iam.iam_user_accounts. What is NOT real: the Auth session store (no password of `admin` is used) and
// the module lifecycle (stub ENABLED + 1 ACTIVE — no fixture module is registered in the Foundation registry).
// The permissions are FIXTURE permissions (module code FBET_DI_<RUN>), NOT the real data_inspector.* permissions.
//
// Writes (talo_test_harness, existing grants FBE-01B / FBE-06B; no SQL GRANT, no schema change), all tagged with the run:
//   iam_permissions ×2, iam_memberships ×1, iam_user_accounts ×1 (non-admin fixture), iam_roles ×1 (is_system = false),
//   iam_role_permissions ×2, iam_user_roles ×1, iam_user_permissions (per scenario; on the REAL admin only by recorded id).
// The real `admin` account row is never written. B08 DENIED audit rows (talo_app) are append-only and are KEPT.
// Cleanup deletes only recorded ids with ownership proof; any failure → BLOCKED (the suite fails, nothing else runs).
//
// Runs ONLY with TALO_DATA_INSPECTOR_IAM_DB=1 (owner EXEC approval) and TALO_DI_IAM_BACKUP=<path of a fresh dump>.

const enabled = process.env['TALO_DATA_INSPECTOR_IAM_DB'] === '1';
const RUN = `FBET_DI_${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 4).toUpperCase()}`;
const CODE_PREFIX = `fbet-di-${RUN.slice('FBET_DI_'.length).toLowerCase()}`;
const REASON = `${RUN} fixture`;
const BINDING: DataInspectorBinding = {
  moduleKey: RUN,
  catalogRead: { permissionCode: `${CODE_PREFIX}.catalog.read`, moduleCode: RUN, resourceCode: 'CATALOG', operation: 'READ' },
  rowsRead: { permissionCode: `${CODE_PREFIX}.rows.read`, moduleCode: RUN, resourceCode: 'ROWS', operation: 'READ' },
};

// Recorded ids of every row this run creates (cleanup deletes these and nothing else).
const created = {
  permissions: [] as string[], memberships: [] as string[], accounts: [] as string[], roles: [] as string[], userRoles: [] as string[],
  userPermissions: [] as string[],
};

describe.runIf(enabled)('DI-IAM-DB (FIXTURE) — DATA_INSPECTOR IAM runtime on PostgreSQL TEST', { timeout: 300_000 }, () => {
  let h: PsqlSession;
  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  const auth = new FakeAuth();
  const logs: string[] = [];
  let adminId = '';
  let fixtureAccountId = '';
  let roleId = '';
  let pCatalog = '';
  let pRows = '';
  let tableKey = '';
  let adminSnapshot = '';
  let systemRoleSnapshot = '';
  let preflightOk = false;
  const evidence: Record<string, string> = {};

  const one = async (sql: string): Promise<string> => (await h.ok(sql))[0]?.[0] ?? '';
  const get = (path: string, who: 'admin' | 'fixture') => request(app).get(`/api/data-inspector${path}`).set('Cookie', `talo_sid=${token(who)}`);
  const deniedAudits = async (requestId: string) => h.ok(`
    SELECT action_code, outcome, target_type, metadata->>'reason' FROM foundation.fnd_audit_logs
     WHERE metadata->>'requestId' = ${lit(requestId)} ORDER BY occurred_at`);
  // Snapshot of every IAM fact of the REAL admin (direct grants + roles): must be identical before / after the run.
  const adminFacts = async () => (await h.ok(`
    SELECT x FROM (
      SELECT 'U:' || a.username || ':' || a.account_status || ':' || (a.disabled_at IS NULL) AS x FROM iam.iam_user_accounts a WHERE a.user_account_id = ${lit(adminId)}
      UNION ALL SELECT 'P:' || up.user_permission_id || ':' || up.effect || ':' || coalesce(up.revoked_at::text, '-') FROM iam.iam_user_permissions up WHERE up.user_account_id = ${lit(adminId)}
      UNION ALL SELECT 'R:' || ur.user_role_id || ':' || coalesce(ur.revoked_at::text, '-') FROM iam.iam_user_roles ur WHERE ur.user_account_id = ${lit(adminId)}
    ) s ORDER BY 1`)).map((r) => r[0]).join('\n');
  const systemRoles = async () => (await h.ok(`
    SELECT r.role_code || ':' || r.is_system || ':' || count(rp.permission_id) FROM iam.iam_roles r LEFT JOIN iam.iam_role_permissions rp ON rp.role_id = r.role_id
     WHERE r.is_system GROUP BY r.role_code, r.is_system ORDER BY 1`)).map((r) => r[0]).join('\n');

  // Direct grant on one account, recorded by id (assigned / expires / revoked offsets in hours relative to now).
  async function direct(accountId: string, permissionId: string, effect: 'ALLOW' | 'DENY', opts: { assignedH?: number; expiresH?: number; revokedH?: number } = {}): Promise<string> {
    const id = randomUUID();
    created.userPermissions.push(id);
    const at = (hours: number | undefined) => (hours === undefined ? 'NULL' : `statement_timestamp() + interval '${hours} hours'`);
    await h.ok(`INSERT INTO iam.iam_user_permissions (user_permission_id, user_account_id, permission_id, effect, reason, assigned_at, expires_at, revoked_at)
      VALUES (${lit(id)}, ${lit(accountId)}, ${lit(permissionId)}, ${lit(effect)}, ${lit(REASON)},
              ${opts.assignedH === undefined ? 'statement_timestamp()' : at(opts.assignedH)}, ${at(opts.expiresH)}, ${at(opts.revokedH)})`);
    return id;
  }

  // Deletes recorded direct grants of THIS run only (id + account + permission + reason must all match).
  async function dropDirect(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const proof = await one(`SELECT count(*) FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${uuidArray(ids)})
      AND NOT (user_account_id = ANY(${uuidArray([adminId, fixtureAccountId].filter(Boolean))}) AND permission_id = ANY(${uuidArray(created.permissions)}) AND reason = ${lit(REASON)})`);
    if (proof !== '0') throw new Error('BLOCKED: direct grant ownership could not be proven');
    await h.ok(`DELETE FROM iam.iam_user_permissions WHERE user_permission_id = ANY(${uuidArray(ids)}) AND reason = ${lit(REASON)}`);
    for (const id of ids) created.userPermissions.splice(created.userPermissions.indexOf(id), 1);
  }

  beforeAll(async () => {
    // ---------------------------------------------------------------- PRECHECK (read only — nothing written before it passes)
    const backup = process.env['TALO_DI_IAM_BACKUP'];
    if (backup === undefined || !existsSync(backup) || statSync(backup).size === 0) throw new Error('PRECHECK: TALO_DI_IAM_BACKUP must name an existing, non-empty dump of talo_mos_v4_test');
    evidence['backup'] = `${backup} (${statSync(backup).size} bytes, ${statSync(backup).mtime.toISOString()})`;
    const url = process.env['DATABASE_URL'];
    if (url === undefined) throw new Error('PRECHECK: DATABASE_URL is not set');
    h = new PsqlSession();
    const [who] = await h.ok(`SELECT current_database(), current_user`);
    if (who?.[0] !== 'talo_mos_v4_test' || who[1] !== 'talo_test_harness') throw new Error(`PRECHECK: harness target refused ${String(who)}`);
    prisma = createPrismaClient(url);
    const db = prismaFoundationDb(prisma);
    const [app0] = await db.query(`SELECT current_database() AS d, current_user AS u`, []) as { d: string; u: string }[];
    if (app0?.d !== 'talo_mos_v4_test' || app0.u !== 'talo_app') throw new Error('PRECHECK: API connection must be talo_app on talo_mos_v4_test');
    const privileges = await h.ok(`SELECT
        has_any_column_privilege('iam.iam_permissions', 'INSERT') AND has_table_privilege('iam.iam_permissions', 'DELETE'),
        has_table_privilege('iam.iam_user_permissions', 'INSERT') AND has_table_privilege('iam.iam_user_permissions', 'DELETE'),
        has_table_privilege('iam.iam_roles', 'INSERT') AND has_table_privilege('iam.iam_roles', 'DELETE'),
        has_table_privilege('iam.iam_role_permissions', 'INSERT') AND has_table_privilege('iam.iam_role_permissions', 'DELETE'),
        has_table_privilege('iam.iam_user_roles', 'INSERT') AND has_table_privilege('iam.iam_user_roles', 'DELETE'),
        has_table_privilege('iam.iam_user_accounts', 'INSERT') AND has_table_privilege('iam.iam_user_accounts', 'DELETE'),
        has_table_privilege('iam.iam_memberships', 'INSERT') AND has_table_privilege('iam.iam_memberships', 'DELETE'),
        has_table_privilege('foundation.fnd_audit_logs', 'SELECT')`);
    if ((privileges[0] ?? []).some((v) => v !== 't')) throw new Error(`PRECHECK: harness privileges missing ${JSON.stringify(privileges[0])}`);
    // Residue: any earlier FBET_DI fixture, or any real data_inspector permission / module → refuse (owner must inspect).
    const residue = await one(`SELECT
        (SELECT count(*) FROM iam.iam_permissions WHERE module_code LIKE 'FBET\\_DI\\_%' OR permission_code LIKE 'fbet-di-%' OR module_code = 'DATA_INSPECTOR' OR permission_code LIKE 'data\\_inspector.%')
      + (SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE 'FBET\\_DI\\_%')
      + (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE 'FBET\\_DI\\_%')
      + (SELECT count(*) FROM iam.iam_user_accounts WHERE username LIKE 'fbet\\_di\\_%')
      + (SELECT count(*) FROM iam.iam_user_permissions WHERE reason LIKE 'FBET\\_DI\\_%')
      + (SELECT count(*) FROM foundation.fnd_modules WHERE module_key LIKE 'FBET\\_DI\\_%' OR module_key = 'DATA_INSPECTOR')`);
    if (residue !== '0') throw new Error(`PRECHECK: ${residue} FBET_DI / data_inspector rows already exist — inspect before running`);
    const [admin] = await h.ok(`SELECT user_account_id, account_status, (disabled_at IS NULL) FROM iam.iam_user_accounts WHERE username = 'admin'`);
    if (admin?.[1] !== 'ACTIVE' || admin[2] !== 't') throw new Error('PRECHECK: no ACTIVE `admin` account');
    adminId = admin[0] ?? '';
    adminSnapshot = await adminFacts();
    // Table used by the column / row requests (key computed like the module does, independent of test order).
    const [rel] = await h.ok(`SELECT c.oid::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'foundation' AND c.relname = 'fnd_modules'`);
    tableKey = tableKeyOf({ oid: rel?.[0] ?? '', schema: 'foundation', table: 'fnd_modules', relkind: 'r' });
    systemRoleSnapshot = await systemRoles();
    preflightOk = true;

    // ---------------------------------------------------------------- FIXTURE (harness, one transaction, recorded ids)
    pCatalog = randomUUID();
    pRows = randomUUID();
    const membershipId = randomUUID();
    fixtureAccountId = randomUUID();
    roleId = randomUUID();
    created.permissions.push(pCatalog, pRows);
    created.memberships.push(membershipId);
    created.accounts.push(fixtureAccountId);
    created.roles.push(roleId);
    const userRoleId = randomUUID();
    created.userRoles.push(userRoleId);
    await h.ok('BEGIN');
    try {
      await h.ok(`INSERT INTO iam.iam_permissions (permission_id, permission_code, module_code, resource_code, operation, minimum_assurance_level) VALUES
        (${lit(pCatalog)}, ${lit(BINDING.catalogRead.permissionCode)}, ${lit(RUN)}, 'CATALOG', 'READ', 1),
        (${lit(pRows)}, ${lit(BINDING.rowsRead.permissionCode)}, ${lit(RUN)}, 'ROWS', 'READ', 1)`);
      await h.ok(`INSERT INTO iam.iam_memberships (membership_id, employee_id, employee_code, full_name, membership_status, joined_at)
        VALUES (${lit(membershipId)}, ${lit(randomUUID())}, ${lit(`${RUN}-M1`)}, ${lit(`${RUN} synthetic`)}, 'ACTIVE', current_date - 30)`);
      await h.ok(`INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, activated_at)
        VALUES (${lit(fixtureAccountId)}, ${lit(membershipId)}, ${lit(`${RUN.toLowerCase()}-u1`)}, 'ACTIVE', statement_timestamp())`);
      await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`${RUN}-R1`)}, ${lit(`${RUN} fixture role`)}, true, false)`);
      await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(pCatalog)}), (${lit(roleId)}, ${lit(pRows)})`);
      await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(userRoleId)}, ${lit(fixtureAccountId)}, ${lit(roleId)})`);
      await h.ok('COMMIT');
    } catch (error) {
      await h.query('ROLLBACK');
      throw error;
    }

    // ---------------------------------------------------------------- REAL Host over talo_app (lifecycle stub only)
    const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
    auth.authenticated(token('admin'), adminId);
    auth.authenticated(token('fixture'), fixtureAccountId);
    const real = createHostCapabilities(RUN, {
      db, access: new SqlFoundationRepository(db), authService: auth, logger, secureCookie: false, navigation: { menu: async () => [] },
    });
    const host: HostCapabilities = { ...real, lifecycle: async (key) => (key === RUN ? { isEnabled: true, activeVersions: 1 } : null) };
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [createModule(host, { binding: BINDING }).router] });
  });

  afterAll(async () => {
    // ---------------------------------------------------------------- CLEANUP (recorded ids + ownership proof; audit kept)
    let blocked: string | null = null;
    try {
      if (h !== undefined && preflightOk) {
        await dropDirect([...created.userPermissions]);
        const perms = uuidArray(created.permissions);
        const proof = await one(`SELECT
            (SELECT count(*) FROM iam.iam_user_permissions WHERE permission_id = ANY(${perms}))
          + (SELECT count(*) FROM iam.iam_role_permissions WHERE permission_id = ANY(${perms}) AND NOT role_id = ANY(${uuidArray(created.roles)}))
          + (SELECT count(*) FROM iam.iam_user_roles WHERE role_id = ANY(${uuidArray(created.roles)}) AND NOT user_role_id = ANY(${uuidArray(created.userRoles)}))
          + (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ANY(${uuidArray(created.accounts)}) AND NOT (membership_id = ANY(${uuidArray(created.memberships)}) AND username LIKE ${lit(`${RUN.toLowerCase()}-%`)}))`);
        if (proof !== '0') throw new Error(`BLOCKED: cleanup ownership proof failed (${proof} foreign references)`);
        await h.ok('BEGIN');
        const steps: [string, string][] = [
          ['user_roles', `DELETE FROM iam.iam_user_roles WHERE user_role_id = ANY(${uuidArray(created.userRoles)}) AND user_account_id = ANY(${uuidArray(created.accounts)})`],
          ['role_permissions', `DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${uuidArray(created.roles)}) AND permission_id = ANY(${perms})`],
          ['roles', `DELETE FROM iam.iam_roles WHERE role_id = ANY(${uuidArray(created.roles)}) AND role_code LIKE ${lit(`${RUN}-%`)} AND NOT is_system`],
          ['accounts', `DELETE FROM iam.iam_user_accounts WHERE user_account_id = ANY(${uuidArray(created.accounts)}) AND username LIKE ${lit(`${RUN.toLowerCase()}-%`)}`],
          ['memberships', `DELETE FROM iam.iam_memberships WHERE membership_id = ANY(${uuidArray(created.memberships)}) AND employee_code LIKE ${lit(`${RUN}-%`)}`],
          ['permissions', `DELETE FROM iam.iam_permissions WHERE permission_id = ANY(${perms}) AND module_code = ${lit(RUN)} AND permission_code LIKE ${lit(`${CODE_PREFIX}.%`)}`],
        ];
        for (const [name, sql] of steps) {
          const r = await h.query(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`);
          if (r.error) {
            await h.query('ROLLBACK');
            throw new Error(`BLOCKED: cleanup failed at ${name} [${r.sqlstate}]`);
          }
          evidence[`deleted.${name}`] = r.rows[0]?.[0] ?? '?';
        }
        await h.ok('COMMIT');
        const remaining = await one(`SELECT
            (SELECT count(*) FROM iam.iam_permissions WHERE module_code = ${lit(RUN)} OR permission_code LIKE ${lit(`${CODE_PREFIX}.%`)})
          + (SELECT count(*) FROM iam.iam_roles WHERE role_code LIKE ${lit(`${RUN}-%`)})
          + (SELECT count(*) FROM iam.iam_memberships WHERE employee_code LIKE ${lit(`${RUN}-%`)})
          + (SELECT count(*) FROM iam.iam_user_accounts WHERE username LIKE ${lit(`${RUN.toLowerCase()}-%`)})
          + (SELECT count(*) FROM iam.iam_user_permissions WHERE reason = ${lit(REASON)})`);
        evidence['remaining'] = remaining;
        if (remaining !== '0') throw new Error(`BLOCKED: ${remaining} fixture rows remain after cleanup`);
        if ((await adminFacts()) !== adminSnapshot) throw new Error('BLOCKED: IAM facts of the real admin differ from the pre-run snapshot');
        if ((await systemRoles()) !== systemRoleSnapshot) throw new Error('BLOCKED: system roles differ from the pre-run snapshot');
        evidence['auditKept'] = await one(`SELECT count(*) FROM foundation.fnd_audit_logs WHERE target_type = 'DATA_INSPECTOR_API' AND action_code IN ('DATA_INSPECTOR.CATALOG.READ', 'DATA_INSPECTOR.ROWS.READ')`);
      }
    } catch (error) {
      blocked = error instanceof Error ? error.message : 'BLOCKED: cleanup failed';
    }
    process.stdout.write(`[DI-IAM-DB] run ${RUN} evidence ${JSON.stringify(evidence)}${blocked ? ` ${blocked}` : ''}\n`);
    await h?.close();
    await prisma?.$disconnect();
    expect(blocked).toBeNull();
  });

  it('IAM-01 admin with Direct ALLOW (both fixture permissions) → 200 on tables / columns / rows, no DENIED audit', async () => {
    const ids = [await direct(adminId, pCatalog, 'ALLOW'), await direct(adminId, pRows, 'ALLOW')];
    try {
      const tables = await get('/tables', 'admin');
      expect(tables.status).toBe(200);
      expect((tables.body.tables as { tableKey: string }[]).some((t) => t.tableKey === tableKey)).toBe(true);
      expect((await get(`/tables/${tableKey}/columns`, 'admin')).status).toBe(200);
      const rows = await get(`/tables/${tableKey}/rows?pageSize=5`, 'admin');
      expect(rows.status).toBe(200);
      evidence['IAM-01'] = 'PASS';
    } finally {
      await dropDirect(ids);
    }
  });

  it('IAM-02 admin without any grant → 403 on all three APIs, one B08 DENIED per request (NO_VALID_ALLOW)', async () => {
    for (const [path, action] of [['/tables', 'DATA_INSPECTOR.CATALOG.READ'], [`/tables/${tableKey}/columns`, 'DATA_INSPECTOR.CATALOG.READ'], [`/tables/${tableKey}/rows`, 'DATA_INSPECTOR.ROWS.READ']] as const) {
      const res = await get(path, 'admin');
      expect([path, res.status, res.body.error?.code]).toEqual([path, 403, 'FORBIDDEN']);
      expect(await deniedAudits(res.body.error.requestId)).toEqual([[action, 'DENIED', 'DATA_INSPECTOR_API', 'NO_VALID_ALLOW']]);
    }
    evidence['IAM-02'] = 'PASS';
  });

  it('IAM-03 Direct DENY wins over Role ALLOW (fixture account): 403 by IAM with B08 DENIED reason DIRECT_DENY', async () => {
    const ids = [await direct(fixtureAccountId, pCatalog, 'DENY')];
    try {
      const res = await get('/tables', 'fixture');
      expect(res.status).toBe(403);
      expect(await deniedAudits(res.body.error.requestId)).toEqual([['DATA_INSPECTOR.CATALOG.READ', 'DENIED', 'DATA_INSPECTOR_API', 'DIRECT_DENY']]);
      evidence['IAM-03'] = 'PASS';
    } finally {
      await dropDirect(ids);
    }
  });

  it('IAM-04 non-admin account with Role ALLOW passes IAM but is refused 403 by the username gate (no B08 DENIED)', async () => {
    for (const path of ['/tables', `/tables/${tableKey}/columns`, `/tables/${tableKey}/rows`]) {
      const res = await get(path, 'fixture');
      expect([path, res.status, res.body.error?.code]).toEqual([path, 403, 'FORBIDDEN']);
      expect(await deniedAudits(res.body.error.requestId)).toEqual([]); // IAM allowed → no IAM DENIED row
    }
    expect(logs.filter((l) => l.includes('DATA_INSPECTOR.ACCESS_DENIED') && l.includes(fixtureAccountId)).length).toBeGreaterThanOrEqual(3);
    evidence['IAM-04'] = 'PASS';
  });

  it('IAM-05 only CATALOG.READ → tables / columns 200, rows 403; only ROWS.READ → rows 200, tables / columns 403', async () => {
    let ids = [await direct(adminId, pCatalog, 'ALLOW')];
    try {
      expect((await get('/tables', 'admin')).status).toBe(200);
      expect((await get(`/tables/${tableKey}/columns`, 'admin')).status).toBe(200);
      const rows = await get(`/tables/${tableKey}/rows`, 'admin');
      expect(rows.status).toBe(403);
      expect(await deniedAudits(rows.body.error.requestId)).toEqual([['DATA_INSPECTOR.ROWS.READ', 'DENIED', 'DATA_INSPECTOR_API', 'NO_VALID_ALLOW']]);
    } finally {
      await dropDirect(ids);
    }
    ids = [await direct(adminId, pRows, 'ALLOW')];
    try {
      expect((await get(`/tables/${tableKey}/rows?pageSize=5`, 'admin')).status).toBe(200);
      expect((await get('/tables', 'admin')).status).toBe(403);
      expect((await get(`/tables/${tableKey}/columns`, 'admin')).status).toBe(403);
      evidence['IAM-05'] = 'PASS';
    } finally {
      await dropDirect(ids);
    }
  });

  it('IAM-06 revoked, expired and not-yet-started Direct ALLOW are not accepted (403 NO_VALID_ALLOW)', async () => {
    for (const [label, opts] of [
      ['revoked', { assignedH: -2, revokedH: -1 }], ['expired', { assignedH: -48, expiresH: -1 }], ['not started', { assignedH: 24 }],
    ] as const) {
      const ids = [await direct(adminId, pCatalog, 'ALLOW', opts)];
      try {
        const res = await get('/tables', 'admin');
        expect([label, res.status]).toEqual([label, 403]);
        expect(await deniedAudits(res.body.error.requestId)).toEqual([['DATA_INSPECTOR.CATALOG.READ', 'DENIED', 'DATA_INSPECTOR_API', 'NO_VALID_ALLOW']]);
      } finally {
        await dropDirect(ids);
      }
    }
    evidence['IAM-06'] = 'PASS';
  });

  it('IAM-07 fixture permissions are held by no system role; the only role holding them is the non-system fixture role', async () => {
    const holders = await h.ok(`SELECT r.role_code, r.is_system FROM iam.iam_role_permissions rp JOIN iam.iam_roles r ON r.role_id = rp.role_id
      WHERE rp.permission_id IN (${lit(pCatalog)}, ${lit(pRows)}) GROUP BY r.role_code, r.is_system ORDER BY 1`);
    expect(holders).toEqual([[`${RUN}-R1`, 'f']]);
    expect(await systemRoles()).toBe(systemRoleSnapshot);
    expect(await one(`SELECT count(*) FROM iam.iam_user_roles WHERE user_account_id = ${lit(adminId)} AND role_id = ${lit(roleId)}`)).toBe('0');
    evidence['IAM-07'] = 'PASS';
  });
});
