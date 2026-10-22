import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../backend/src/app.js';
import { loadConfig } from '../../../backend/src/config/env.js';
import { createLogger } from '../../../backend/src/core/logging/logger.js';
import { createPrismaClient } from '../../../backend/src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../backend/src/infrastructure/prisma/generated/client.js';
import type { AccessFacts, PermissionRef } from '../../../backend/src/modules/foundation/foundation.permissions.js';
import { prismaFoundationDb } from '../../../backend/src/modules/foundation/foundation.repository.js';
import { createHostCapabilities } from '../../../backend/src/module-host/capabilities.js';
import type { HostCapabilities } from '../../../backend/src/module-host/contract.js';
import { FakeAuth, TEST_ORIGIN, token } from '../../../backend/test/unit/foundation/fakes.js';
import { createModule } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/index.js';
import { MASK } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.masking.js';
import { tableKeyOf } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.sql.js';

// DATA_INSPECTOR on PostgreSQL (TEST database talo_mos_v4_test, role talo_app from DATABASE_URL). Runs only with
// TALO_DATA_INSPECTOR_DB=1 and refuses any other database / role. READ ONLY: every statement goes through the REAL Host
// `readOnly` capability (SET TRANSACTION READ ONLY + statement timeout + read-only check); the test itself only reads
// (account ids, catalog counts) inside the same capability. Nothing is registered, granted, inserted or changed.
//
// Faked here, and why: the Auth session store (no login is performed — a login would write sessions) and the IAM facts
// (the permissions data_inspector.catalog.read / rows.read are NOT provisioned — BL-02); the module lifecycle is the REAL
// Host query in the first test (DATA_INSPECTOR is not registered → 503) and a stub (ENABLED, 1 ACTIVE) afterwards.
// The account gate, catalog, columns and rows are real.

const enabled = process.env['TALO_DATA_INSPECTOR_DB'] === '1';
const OK_LIFECYCLE = { isEnabled: true, activeVersions: 1 } as const;

class AllowAllAccess {
  async loadAccessFacts(_userAccountId: string, _permission: PermissionRef): Promise<AccessFacts> {
    const grant = { roleActive: true, notRevoked: true, started: true, notExpired: true };
    return {
      permissions: [{ permissionId: '40000000-0000-4000-8000-000000000001', minimumAssuranceLevel: 1 }],
      account: { accountStatus: 'ACTIVE', notDisabled: true },
      grants: [{ source: 'DIRECT' as const, effect: 'ALLOW', ...grant }],
    };
  }

  async insertAudit(): Promise<void> {
    throw new Error('no DENIED audit expected');
  }
}

describe.runIf(enabled)('DATA_INSPECTOR on PostgreSQL TEST (read only)', () => {
  let prisma: PrismaClient;
  let realHost: HostCapabilities;
  const logs: string[] = [];
  const auth = new FakeAuth();
  let adminId = '';
  let otherId = '';
  let lifecycleStub = false;
  const moduleSqls: string[] = []; // every statement the module sent through the Host readOnly executor (texts only)
  let app: ReturnType<typeof createApp>;
  const read = async (sql: string, params: readonly unknown[] = []) => realHost.readOnly((tx) => tx.query(sql, params)) as Promise<Record<string, unknown>[]>;
  const get = (path: string, who: 'admin' | 'other') => request(app).get(`/api/data-inspector${path}`).set('Cookie', `talo_sid=${token(who)}`);

  beforeAll(async () => {
    const url = process.env['DATABASE_URL'];
    if (url === undefined) throw new Error('DATABASE_URL is not set');
    prisma = createPrismaClient(url);
    const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
    realHost = createHostCapabilities('DATA_INSPECTOR', {
      db: prismaFoundationDb(prisma), access: new AllowAllAccess(), authService: auth, logger, secureCookie: false, navigation: { menu: async () => [] },
    });
    const [identity] = await read(`SELECT current_database() AS db, current_user AS role, current_setting('transaction_read_only') AS ro`);
    if (identity?.['db'] !== 'talo_mos_v4_test' || identity['role'] !== 'talo_app') throw new Error(`refused target: ${String(identity?.['db'])} / ${String(identity?.['role'])}`);
    expect(identity['ro']).toBe('on');
    const [admin] = await read(`SELECT user_account_id::text AS id FROM iam.iam_user_accounts WHERE username = 'admin' AND account_status = 'ACTIVE' AND disabled_at IS NULL`);
    const [other] = await read(`SELECT user_account_id::text AS id FROM iam.iam_user_accounts WHERE username <> 'admin' ORDER BY username LIMIT 1`);
    if (typeof admin?.['id'] !== 'string' || typeof other?.['id'] !== 'string') throw new Error('TEST database has no ACTIVE `admin` account or no second account');
    adminId = admin['id'];
    otherId = other['id'];
    auth.authenticated(token('admin'), adminId);
    auth.authenticated(token('other'), otherId);
    const host: HostCapabilities = {
      ...realHost,
      lifecycle: async (key) => (lifecycleStub ? OK_LIFECYCLE : realHost.lifecycle(key)),
      readOnly: (fn) => realHost.readOnly((tx) => fn({ query: (sql, params) => { moduleSqls.push(sql); return tx.query(sql, params); } })),
    };
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [createModule(host).router] });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('real lifecycle: DATA_INSPECTOR is not registered on TEST → 503 for admin, before any catalog read (TC-19)', async () => {
    const [registered] = await read(`SELECT count(*)::int AS n FROM foundation.fnd_modules WHERE module_key = 'DATA_INSPECTOR'`);
    expect(registered?.['n']).toBe(0);
    for (const path of ['/tables', `/tables/t_1_0123456789abcdef/columns`, `/tables/t_1_0123456789abcdef/rows`]) {
      const res = await get(path, 'admin');
      expect([res.status, res.body.error.code]).toEqual([503, 'SERVICE_BUSY']);
    }
    lifecycleStub = true;
  });

  it('account gate on the real iam.iam_user_accounts as talo_app: admin allowed, another real account 403 on all APIs (TC-04 / TC-25)', async () => {
    expect((await get('/tables', 'admin')).status).toBe(200);
    for (const path of ['/tables', `/tables/t_1_0123456789abcdef/columns`, `/tables/t_1_0123456789abcdef/rows`]) {
      const res = await get(path, 'other');
      expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
    }
  });

  it('catalog = every r / p table of the current database, all schemas, same count as pg_class (TC-01 / TC-08)', async () => {
    const res = await get('/tables', 'admin');
    expect(res.status).toBe(200);
    const tables = res.body.tables as { schema: string; table: string; readStatus: string; kind: string; tableKey: string }[];
    const [count] = await read(`SELECT count(*)::int AS n FROM pg_catalog.pg_class WHERE relkind IN ('r', 'p')`);
    expect(res.body.catalogComplete).toBe(true);
    expect(tables.length).toBe(count?.['n']);
    const names = new Set(tables.map((t) => `${t.schema}.${t.table}`));
    for (const n of ['pg_catalog.pg_class', 'pg_catalog.pg_authid', 'iam.iam_user_accounts', 'iam.iam_credentials', 'foundation.fnd_modules', 'foundation.fnd_audit_logs']) {
      expect([n, names.has(n)]).toEqual([n, true]);
    }
    const status = Object.fromEntries(tables.map((t) => [`${t.schema}.${t.table}`, t.readStatus]));
    expect(status['pg_catalog.pg_class']).toBe('READABLE');
    expect(status['pg_catalog.pg_authid']).toBe('NOT_READABLE');
    expect(status['foundation.fnd_modules']).toBe('READABLE');
    const summary: Record<string, number> = {};
    for (const t of tables) summary[t.readStatus] = (summary[t.readStatus] ?? 0) + 1;
    const schemas = [...new Set(tables.map((t) => t.schema))].sort();
    // Evidence for the report (no row values): read status per schema-level summary and the IAM tables' status.
    process.stdout.write(`[DI-DB] tables=${tables.length} schemas=${schemas.join(',')} status=${JSON.stringify(summary)}\n`);
    process.stdout.write(`[DI-DB] iam=${JSON.stringify(Object.fromEntries(Object.entries(status).filter(([k]) => k.startsWith('iam.'))))}\n`);
    process.stdout.write(`[DI-DB] foundation_not_readable=${JSON.stringify(Object.entries(status).filter(([k, v]) => k.startsWith('foundation.') && v !== 'READABLE'))}\n`);
  });

  it('columns + rows of foundation.fnd_modules: structure, PK ordering, bounded page (TC-02 / TC-03 / TC-12)', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string }[];
    const key = tables.find((t) => t.schema === 'foundation' && t.table === 'fnd_modules')?.tableKey ?? '';
    const cols = await get(`/tables/${key}/columns`, 'admin');
    expect(cols.status).toBe(200);
    expect(cols.body.columns.find((c: { name: string }) => c.name === 'module_key')).toMatchObject({ dataType: expect.any(String), primaryKey: false, selectPrivilege: true });
    expect(cols.body.columns.filter((c: { primaryKey: boolean }) => c.primaryKey).map((c: { name: string }) => c.name)).toEqual(['module_id']);
    const rows = await get(`/tables/${key}/rows?page=1&pageSize=2`, 'admin');
    expect(rows.status).toBe(200);
    expect(rows.body).toMatchObject({ page: 1, pageSize: 2, ordering: 'PRIMARY_KEY', orderBy: ['module_id'], readStatus: 'READABLE' });
    const [n] = await read(`SELECT count(*)::int AS n FROM foundation.fnd_modules`);
    expect(rows.body.rows.length).toBe(Math.min(2, Number(n?.['n'])));
    expect(rows.body.hasNext).toBe(Number(n?.['n']) > 2);
  });

  it('a NOT_READABLE table (pg_catalog.pg_authid): structure shown, rows 403 TABLE_NOT_READABLE, no privilege raised (TC-14)', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string }[];
    const key = tables.find((t) => t.schema === 'pg_catalog' && t.table === 'pg_authid')?.tableKey ?? '';
    expect((await get(`/tables/${key}/columns`, 'admin')).status).toBe(200);
    const rows = await get(`/tables/${key}/rows`, 'admin');
    expect([rows.status, rows.body.error.code]).toEqual([403, 'TABLE_NOT_READABLE']);
    const [still] = await read(`SELECT has_table_privilege('pg_catalog.pg_authid', 'SELECT') AS s`);
    expect(still?.['s']).toBe(false);
  });

  it('large system table (pg_catalog.pg_attribute) pages 1 / 2 at pageSize 100 within the timeout, ordered by its catalog PK (TC-12)', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string }[];
    const key = tables.find((t) => t.schema === 'pg_catalog' && t.table === 'pg_attribute')?.tableKey ?? '';
    const p1 = await get(`/tables/${key}/rows?page=1&pageSize=100`, 'admin');
    const p2 = await get(`/tables/${key}/rows?page=2&pageSize=100`, 'admin');
    expect([p1.status, p2.status]).toEqual([200, 200]);
    expect([p1.body.rows.length, p1.body.hasNext, p1.body.ordering, p1.body.orderBy]).toEqual([100, true, 'PRIMARY_KEY', ['attrelid', 'attnum']]);
    expect(p2.body.rows[0].cells).not.toEqual(p1.body.rows[0].cells);
    expect(p2.body.page).toBe(2);
    expect((await get(`/tables/${key}/rows?pageSize=101`, 'admin')).status).toBe(400);
  });

  it('stale / forged / injected keys: 409 or 404, nothing executed from the key (TC-15 / TC-24)', async () => {
    const [rel] = await read(`SELECT c.oid::text AS oid FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = 'foundation' AND c.relname = 'fnd_modules'`);
    const oid = String(rel?.['oid']);
    const renamed = tableKeyOf({ oid, schema: 'foundation', table: 'fnd_modules_renamed', relkind: 'r' });
    expect((await get(`/tables/${renamed}/rows`, 'admin')).body.error.code).toBe('CATALOG_CHANGED');
    expect((await get(`/tables/t_4294967295_0123456789abcdef/rows`, 'admin')).body.error.code).toBe('CATALOG_CHANGED');
    for (const bad of ["foundation.fnd_modules", "t_1_0123456789abcdef' OR '1'='1", '"; DROP TABLE foundation.fnd_modules; --']) {
      expect((await get(`/tables/${encodeURIComponent(bad)}/rows`, 'admin')).status).toBe(404);
    }
    const [still] = await read(`SELECT to_regclass('foundation.fnd_modules') IS NOT NULL AS present`);
    expect(still?.['present']).toBe(true);
  });

  it('FIX-01: masking plan of every readable table on TEST (column names / types only, no value)', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string; readStatus: string }[];
    const full: string[] = [];
    const json: string[] = [];
    for (const t of tables) {
      const res = await get(`/tables/${t.tableKey}/columns`, 'admin');
      expect(res.status).toBe(200);
      for (const c of res.body.columns as { name: string; dataType: string; masking: string; selectPrivilege: boolean }[]) {
        const id = `${t.schema}.${t.table}.${c.name} (${c.dataType}${c.selectPrivilege ? '' : ', no SELECT'}, table ${t.readStatus})`;
        if (c.masking === 'FULL') full.push(id);
        if (c.masking === 'JSON_KEYS') json.push(id);
      }
    }
    for (const must of ['iam.iam_credentials.password_hash', 'iam.iam_sessions.session_token_hash', 'iam.iam_account_verifications.verification_token_hash', 'pg_catalog.pg_authid.rolpassword']) {
      expect([must, full.some((f) => f.startsWith(`${must} `))]).toEqual([must, true]);
    }
    for (const plain of ['iam.iam_credentials.password_changed_at', 'iam.iam_credentials.must_change_password', 'iam.iam_credentials.credential_id', 'iam.iam_user_accounts.username']) {
      expect([plain, full.some((f) => f.startsWith(`${plain} `))]).toEqual([plain, false]);
    }
    process.stdout.write(`[DI-DB] FULL=${JSON.stringify(full)}\n[DI-DB] JSON_KEYS=${JSON.stringify(json)}\n`);
  });

  it('FIX-01: iam.iam_credentials / iam.iam_sessions rows — every secret cell [MASKED], no stored hash in the body, secret columns never selected', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string }[];
    // Stored secrets are read here ONLY to prove they are absent from the API body; they are never printed (boolean asserts).
    const stored = new Set<string>();
    for (const r of await read(`SELECT password_hash AS v FROM iam.iam_credentials WHERE password_hash IS NOT NULL`)) stored.add(String(r['v']));
    for (const r of await read(`SELECT session_token_hash AS v FROM iam.iam_sessions WHERE session_token_hash IS NOT NULL LIMIT 5000`)) stored.add(String(r['v']));
    expect(stored.size > 0).toBe(true);
    const checked: string[] = [];
    for (const [table, column] of [['iam_credentials', 'password_hash'], ['iam_sessions', 'session_token_hash']] as const) {
      const key = tables.find((t) => t.schema === 'iam' && t.table === table)?.tableKey ?? '';
      moduleSqls.length = 0;
      for (let page = 1; page <= 3; page += 1) {
        const res = await get(`/tables/${key}/rows?page=${page}&pageSize=100`, 'admin');
        expect(res.status).toBe(200);
        const i = (res.body.columns as string[]).indexOf(column);
        expect(i >= 0 && res.body.columnMasking[i] === 'FULL').toBe(true);
        const rows = res.body.rows as { cells: (string | null)[] }[];
        expect(rows.every((r) => r.cells[i] === MASK)).toBe(true);
        const body = JSON.stringify(res.body);
        expect([...stored].some((v) => body.includes(v))).toBe(false);
        expect(/\$argon2|\$2[aby]\$/.test(body)).toBe(false);
        checked.push(`${table}: page ${page} rows=${rows.length}`);
        if (!res.body.hasNext) break;
      }
      const pageSqls = moduleSqls.filter((q) => q.endsWith(' LIMIT $1 OFFSET $2'));
      expect(pageSqls.length > 0 && pageSqls.every((q) => !q.includes(column))).toBe(true);
    }
    process.stdout.write(`[DI-DB] masked-check ${checked.join('; ')}\n`);
  });

  it('FIX-01: JSONB tables on TEST read through key masking; every module statement is a SELECT', async () => {
    const tables = (await get('/tables', 'admin')).body.tables as { schema: string; table: string; tableKey: string; readStatus: string }[];
    const summary: string[] = [];
    for (const name of ['fnd_module_versions', 'fnd_data_contracts', 'fnd_version_actions', 'fnd_compatibility_changes']) {
      const t = tables.find((x) => x.schema === 'foundation' && x.table === name);
      if (t === undefined || t.readStatus === 'NOT_READABLE') continue;
      const res = await get(`/tables/${t.tableKey}/rows?pageSize=100`, 'admin');
      expect(res.status).toBe(200);
      const rows = res.body.rows as { masked?: number[] }[];
      summary.push(`${name}: rows=${rows.length} jsonCols=${(res.body.columnMasking as string[]).filter((m) => m === 'JSON_KEYS').length} maskedCells=${rows.reduce((n, r) => n + (r.masked?.length ?? 0), 0)}`);
    }
    expect(moduleSqls.every((q) => /^\s*SELECT\b/.test(q) && !/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|MERGE|CALL)\b/i.test(q.replace(/"[^"]*"/g, '""')))).toBe(true);
    process.stdout.write(`[DI-DB] json ${summary.join('; ')}\n`);
  });

  it('logs carry no row value and no username', () => {
    const text = logs.join('\n');
    expect(text).not.toMatch(/"username"|password_hash|"cells"/);
  });
});
