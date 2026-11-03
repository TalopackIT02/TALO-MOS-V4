import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import express from 'express';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createHostCapabilities } from '../../../src/module-host/capabilities.js';
import type { HostCapabilities, HostQuery } from '../../../src/module-host/contract.js';
import { sqlstateOf } from '../../../src/modules/auth/sqlstate.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { INSTALLED_MODULES } from '../../../src/installed-modules/registry.js';

// MODULE_HOST_READONLY_SECURITY_FIX — security + compatibility on a DISPOSABLE PostgreSQL server (container talo-ro-clone,
// same image as TEST) holding a restore of talo_mos_v4_test with the SQL candidate 01 applied (role talo_module_reader).
// Nothing here touches the TEST server. Runs only with TALO_RO_CLONE_DB=talo_ro_clone_<14 digits> and the two URLs
// (talo_app / talo_module_reader of the clone server) passed by the runner — never printed.
//   "legacy" = the Host readOnly as it is on TEST today (talo_app, module SQL as-is): used to REPRODUCE the escape.
//   "fixed"  = the candidate (talo_module_reader, sub-query + Host bind parameter, always rolled back).

const CLONE = process.env['TALO_RO_CLONE_DB'] ?? '';
const enabled = /^talo_ro_clone_\d{14}$/.test(CLONE) && !!process.env['TALO_RO_APP_URL'] && !!process.env['TALO_RO_READER_URL'];
const EVIDENCE = process.env['TALO_RO_EVIDENCE_FILE'];
const note = (line: string) => { if (EVIDENCE) appendFileSync(EVIDENCE, `${line}\n`); };
const logger = createLogger({ level: 'error' });

function admin(sql: string): string[][] {
  const out = execFileSync('docker', ['exec', '-i', 'talo-ro-clone', 'psql', '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-U', 'admin', '-d', CLONE], { input: sql, encoding: 'utf8', timeout: 60_000 });
  return out.split('\n').filter((l) => l.trim() !== '').map((l) => l.split('\t'));
}
const one = (sql: string) => admin(sql)[0]?.[0] ?? '';

async function outcome(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) {
    const code = Reflect.get(Object(e), 'code');
    const status = Reflect.get(Object(e), 'status');
    if (typeof status === 'number' && typeof code === 'string') return `${status}:${code}`;
    return `DB:${sqlstateOf(e) ?? (e instanceof Error ? e.message.slice(0, 80) : String(e))}`;
  }
}

describe.skipIf(!enabled)(`READONLY SECURITY FIX on disposable clone ${CLONE}`, { timeout: 240_000 }, () => {
  let appPrisma: PrismaClient;
  let readerPrisma: PrismaClient;
  let appDb: FoundationDb;
  let readerDb: FoundationDb;
  let legacy: HostCapabilities;
  let fixed: HostCapabilities;
  let adminAccount = '';
  let current = '';
  const marker = `RO-${Date.now().toString(36)}`;

  const deps = (readerDbArg: FoundationDb | null | undefined) => ({
    db: appDb, access: new SqlFoundationRepository(appDb), logger, secureCookie: false, navigation: { menu: async () => [] }, readerDb: readerDbArg,
    authService: { describeSession: async () => ({ status: 'AUTHENTICATED', account: { userAccountId: current }, assuranceLevel: 2 }) },
  }) as never;
  const customers = () => Number(one(`SELECT count(*) FROM cm.cm_customers WHERE display_name LIKE '${marker}%'`));
  const run = (host: HostCapabilities, fn: (q: HostQuery) => Promise<unknown>) => outcome(host.readOnly(fn));

  beforeAll(async () => {
    appPrisma = createPrismaClient(process.env['TALO_RO_APP_URL']!);
    readerPrisma = createPrismaClient(process.env['TALO_RO_READER_URL']!);
    appDb = prismaFoundationDb(appPrisma);
    readerDb = prismaFoundationDb(readerPrisma);
    expect(await appDb.query('SELECT current_user::text AS u, current_database()::text AS d', [])).toEqual([{ u: 'talo_app', d: CLONE }]);
    expect(await readerDb.query('SELECT current_user::text AS u, current_database()::text AS d', [])).toEqual([{ u: 'talo_module_reader', d: CLONE }]);
    legacy = createHostCapabilities('SYSTEM_TEST', deps(undefined));
    fixed = createHostCapabilities('SYSTEM_TEST', deps(readerDb));
    // Synthetic administrator (clone only) for the module compatibility calls.
    const m = one(`INSERT INTO iam.iam_memberships (employee_id, employee_code, full_name, membership_status, joined_at)
      VALUES (gen_random_uuid(), '${marker}-ADM', '${marker} admin', 'ACTIVE', current_date) RETURNING membership_id`);
    adminAccount = one(`INSERT INTO iam.iam_user_accounts (membership_id, username, account_status, activated_at)
      VALUES ('${m}', '${marker.toLowerCase()}-adm', 'ACTIVE', now()) RETURNING user_account_id`);
    admin(`INSERT INTO iam.iam_user_roles (user_account_id, role_id, assigned_at) SELECT '${adminAccount}', role_id, now() - interval '1 minute' FROM iam.iam_roles WHERE role_code = 'TALO_SYSTEM_ADMIN';
      UPDATE foundation.fnd_modules SET is_enabled = true WHERE module_key IN ('DATA_INSPECTOR', 'SYSTEM_TEST', 'SYSTEM_CONTROLLER_CENTER');
      INSERT INTO iam.iam_user_permissions (user_account_id, permission_id, effect, assigned_at) SELECT '${adminAccount}', permission_id, 'ALLOW', now() - interval '1 minute'
        FROM iam.iam_permissions WHERE module_code = 'DATA_INSPECTOR';`);
    note(`# readOnly fix clone run ${marker} on ${CLONE} at ${new Date().toISOString()}`);
  });
  afterAll(async () => { await appPrisma?.$disconnect(); await readerPrisma?.$disconnect(); });

  // ------------------------------------------------------------------------------------------- the two escapes found
  describe('the two escapes of Gate 3', () => {
    const insert = `INSERT INTO cm.cm_customers (display_name, customer_type_code) VALUES ('${marker} escape', 'COMPANY')`;
    it('REPRODUCED on the legacy executor (today\'s TEST behaviour): COMMIT then write, and a multi-statement call', async () => {
      const before = customers();
      const r1 = await run(legacy, async (q) => { await q.query('COMMIT', []); await q.query(insert, []); });
      const r2 = await run(legacy, (q) => q.query(`SELECT 1; COMMIT; ${insert}`, []));
      const after = customers();
      note(`legacy: commit-escape=${r1} multi-statement=${r2} rows written=${after - before}`);
      expect(after - before).toBe(2);
      admin(`DELETE FROM cm.cm_customers WHERE display_name LIKE '${marker}%'`);
    });
    it('FIXED: both refused, nothing written', async () => {
      const r1 = await run(fixed, async (q) => { await q.query('COMMIT', []); await q.query(insert, []); });
      const r2 = await run(fixed, (q) => q.query(`SELECT 1; COMMIT; ${insert}`, []));
      note(`fixed: commit-escape=${r1} multi-statement=${r2}`);
      expect(r1).toBe('DB:42601'); // COMMIT is not a query: syntax error inside the Host sub-query
      expect(r2).toBe('DB:42601'); // one prepared statement: a second command is refused by the protocol
      expect(customers()).toBe(0);
    });
    it('FIXED: the same text through the sub-query break-out attempts', async () => {
      for (const sql of [`SELECT 1) AS x; COMMIT; ${insert}; (SELECT 1`, `SELECT 1) AS x; ${insert} --`, `WITH d AS (${insert} RETURNING 1) SELECT * FROM d`]) {
        expect([sql.slice(0, 30), await run(fixed, (q) => q.query(sql, []))]).toEqual([sql.slice(0, 30), expect.stringMatching(/^DB:(42601|0A000|25006|42501)$/)]);
      }
      expect(customers()).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------- no write anywhere
  describe('no write into CRM, IAM, Foundation; no escalation; indirect paths', () => {
    const attempts: [string, string][] = [
      ['CRM data-modifying CTE', `WITH d AS (UPDATE cm.cm_customers SET display_name = 'x' RETURNING 1) SELECT count(*) FROM d`],
      ['IAM data-modifying CTE', `WITH d AS (UPDATE iam.iam_user_accounts SET account_status = 'LOCKED' RETURNING 1) SELECT count(*) FROM d`],
      ['Foundation insert CTE', `WITH d AS (INSERT INTO foundation.fnd_audit_logs (event_id, action_code, target_type, outcome, occurred_at, source_service) VALUES (gen_random_uuid(), 'X', 'X', 'SUCCESS', now(), 'x') RETURNING 1) SELECT * FROM d`],
      ['sequence nextval', `SELECT nextval('cm.customer_code_seq')`],
      ['SELECT FOR UPDATE', `SELECT 1 FROM cm.cm_customers FOR UPDATE`],
      ['SECURITY DEFINER writer (IAM admin)', `SELECT iam.admin_set_account_status(gen_random_uuid(), gen_random_uuid(), 'LOCKED', 'x', gen_random_uuid())`],
      ['SECURITY DEFINER writer (credential reissue)', `SELECT iam.reissue_temporary_credential('x', 'y', gen_random_uuid())`],
      ['escalate: set_config role', `SELECT set_config('role', 'talo_app', false)`],
      ['escalate: set_config session_authorization', `SELECT set_config('session_authorization', 'talo_app', false)`],
      ['leave read-only: set_config', `SELECT set_config('transaction_read_only', 'off', true)`],
      ['large object create', `SELECT lo_create(0)`],
      ['secret column: password_hash', `SELECT password_hash FROM iam.iam_credentials LIMIT 1`],
      ['secret column: session_token_hash', `SELECT session_token_hash FROM iam.iam_sessions LIMIT 1`],
      ['SET ROLE statement', `SET ROLE talo_app`],
      ['CALL / DO', `DO $$ BEGIN END $$`],
    ];
    for (const [name, sql] of attempts) {
      it(name, async () => {
        const fp = one(`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM cm.cm_customers AS t`)
          + one(`SELECT md5(string_agg(account_status, ',' ORDER BY user_account_id)) FROM iam.iam_user_accounts`) + one(`SELECT count(*) FROM foundation.fnd_audit_logs`)
          + one(`SELECT last_value::text FROM cm.customer_code_seq`);
        const r = await run(fixed, (q) => q.query(sql, []));
        note(`fixed: ${name} → ${r}`);
        expect(r).toMatch(/^DB:(42501|25006|25001|42601|0A000|55000)$/);
        const after = one(`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM cm.cm_customers AS t`)
          + one(`SELECT md5(string_agg(account_status, ',' ORDER BY user_account_id)) FROM iam.iam_user_accounts`) + one(`SELECT count(*) FROM foundation.fnd_audit_logs`)
          + one(`SELECT last_value::text FROM cm.customer_code_seq`);
        expect(after).toBe(fp);
      });
    }
    it('session state never survives a call: set_config(…, false) undone, advisory locks released, role and READ ONLY re-checked', async () => {
      expect(await run(fixed, (q) => q.query(`SELECT set_config('search_path', 'cm', false) AS sp, pg_advisory_lock(424242) IS NULL AS l`, []))).toBe('OK');
      const [state] = await fixed.readOnly((q) => q.query(`SELECT current_setting('search_path') AS sp, current_user::text AS u, current_setting('transaction_read_only') AS ro`, [])) as { sp: string; u: string; ro: string }[];
      expect(state).toEqual({ sp: '"$user", public', u: 'talo_module_reader', ro: 'on' });
      expect(one(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 424242`)).toBe('0');
      // Also when the module fails after taking the lock.
      expect(await run(fixed, async (q) => { await q.query('SELECT pg_advisory_lock(424243) IS NULL AS l', []); await q.query('SELECT 1/0', []); })).toBe('DB:22012');
      expect(one(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 424243`)).toBe('0');
    });
    it('fail closed: reader not configured → 503; executor connected as talo_app (misconfiguration) → 503, module code never runs', async () => {
      let ran = false;
      const off = createHostCapabilities('SYSTEM_TEST', deps(null));
      expect(await run(off, async () => { ran = true; })).toBe('503:SERVICE_BUSY');
      const wrong = createHostCapabilities('SYSTEM_TEST', deps(appDb));
      expect(await run(wrong, async () => { ran = true; })).toBe('503:SERVICE_BUSY');
      expect(ran).toBe(false);
    });
    it('approved reads keep working: plain SELECT with parameters / ORDER BY / LIMIT, catalog, the 5 reader functions', async () => {
      const rows = await fixed.readOnly((q) => q.query(`SELECT province_code FROM cm.cm_ref_provinces WHERE province_code >= $1 ORDER BY province_code DESC LIMIT $2`, ['00', 3]));
      const direct = admin(`SELECT province_code FROM cm.cm_ref_provinces WHERE province_code >= '00' ORDER BY province_code DESC LIMIT 3`).map((r) => ({ province_code: r[0] }));
      expect(rows).toEqual(direct);
      for (const sql of [
        `SELECT count(*)::int AS n FROM audit_api.read_foundation_audit(now() - interval '7 days', now(), 'ALL', '', NULL, 10)`,
        `SELECT count(*)::int AS n FROM audit_api.read_iam_audit(now() - interval '7 days', now(), 'ALL', '', NULL, 10)`,
        `SELECT count(*)::int AS n FROM audit_api.read_foundation_audit_summary(now() - interval '1 day', now())`,
        `SELECT count(*)::int AS n FROM foundation_read_api.read_module_events(now() - interval '90 days', now(), NULL, '', 10, 0)`,
        `SELECT count(*)::int AS n FROM foundation_read_api.read_data_access_rules(NULL, NULL, 10, 0)`,
      ]) expect([sql.slice(9, 60), await run(fixed, (q) => q.query(sql, []))]).toEqual([sql.slice(9, 60), 'OK']);
    });
  });

  // ------------------------------------------------------------------------------------------- module compatibility
  describe('DATA_INSPECTOR, SCC, SYSTEM_TEST — same answers through legacy and fixed readOnly', () => {
    const app = (router: Router) => {
      const a = express();
      a.use(express.json());
      a.use((_q, res, next) => { res.locals['requestId'] = 'req'; next(); });
      a.use('/api', router);
      return a;
    };
    const normalize = (v: unknown): unknown => JSON.parse(JSON.stringify(v)
      .replace(/talo_module_reader|talo_app/g, '<api-role>')
      .replace(/"(generatedAt|checkedAt|startedAt|finishedAt|durationMs|elapsedMs|at|ts|requestId|now)":("[^"]*"|\d+)/g, '"$1":"<t>"')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
      .replace(/"ms":\d+/g, '"ms":0'));
    const diffs: string[] = [];
    const compare = async (key: string, method: 'get' | 'post', path: string) => {
      const pkg = INSTALLED_MODULES.find((m) => m.manifest.moduleKey === key)!;
      current = adminAccount;
      const a = await request(app(pkg.entry.createModule(createHostCapabilities(key, deps(undefined))).router))[method](`/api${path}`).send({});
      const b = await request(app(pkg.entry.createModule(createHostCapabilities(key, deps(readerDb))).router))[method](`/api${path}`).send({});
      const same = JSON.stringify(normalize(a.body)) === JSON.stringify(normalize(b.body));
      note(`compat ${key} ${method.toUpperCase()} ${path}: legacy=${a.status} fixed=${b.status} body=${same ? 'SAME' : 'DIFF'}`);
      if (!same) {
        diffs.push(`${key} ${path}`);
        if (EVIDENCE) {
          const base = `${EVIDENCE.replace(/notes.txt$/, '')}diff_${diffs.length}`;
          writeFileSync(`${base}_legacy.json`, JSON.stringify({ path, status: a.status, body: normalize(a.body) }, null, 1));
          writeFileSync(`${base}_fixed.json`, JSON.stringify({ path, status: b.status, body: normalize(b.body) }, null, 1));
        }
      }
      if (a.status === 403) note(`  403 body: ${JSON.stringify(a.body).slice(0, 200)}`);
      return { a, b, same };
    };
    // Live server counters inside check texts are not behaviour (connections / transactions change between two calls).
    const live = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replace(/"detail":"[^"]*(kết nối đang mở|rollback \/)[^"]*"/g, '"detail":"<live-metric>"'));
    type Entry = { tableKey: string; schema: string; table: string; readStatus?: string };
    const entries = (body: unknown): Entry[] => {
      const out: Entry[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v !== 'object' || v === null) return;
        const o = v as Record<string, unknown>;
        if (typeof o['tableKey'] === 'string' && typeof o['schema'] === 'string' && typeof o['table'] === 'string') out.push(o as unknown as Entry);
        Object.values(o).forEach(walk);
      };
      walk(body);
      return out;
    };
    const alignStatus = (body: unknown) => JSON.parse(JSON.stringify(body).replace(/"readStatus":"(READABLE|PARTIAL)"/g, '"readStatus":"<r>"'));
    const SECRET_TABLES = new Set(['iam.iam_credentials', 'iam.iam_sessions']);
    const catalogCheck = (a: unknown, b: unknown) => {
      const ea = entries(a); const eb = entries(b);
      expect(eb.map((e) => `${e.schema}.${e.table}`)).toEqual(ea.map((e) => `${e.schema}.${e.table}`));
      const changed = eb.filter((e, i) => e.readStatus !== ea[i]?.readStatus).map((e) => `${e.schema}.${e.table}:${ea.find((x) => x.tableKey === e.tableKey)?.readStatus ?? '?'}→${e.readStatus}`);
      note(`  catalog readStatus changes: ${changed.join(', ') || 'none'}`);
      // v2 grants are column-level only (a column added later is not readable): every approved table is PARTIAL, nothing else changes.
      for (const c of changed) expect(c).toMatch(/^(cm|foundation|iam)\.[a-z_]+:READABLE→PARTIAL$/);
      expect(changed).toHaveLength(43);
      // Everything else identical once the two intended readStatus values are aligned.
      const align = (body: unknown) => JSON.parse(JSON.stringify(body).replace(/"readStatus":"(READABLE|PARTIAL)"/g, '"readStatus":"<r>"'));
      expect(JSON.stringify(align(normalize(b)))).toBe(JSON.stringify(align(normalize(a))));
      return eb;
    };
    it('SYSTEM_TEST health / results / checks — identical (checks: identical except live server counters)', async () => {
      for (const [m, p] of [['get', '/system-test/health'], ['get', '/system-test/results'], ['post', '/system-test/checks/run']] as const) {
        const { a, b } = await compare('SYSTEM_TEST', m, p);
        expect([p, b.status]).toEqual([p, a.status]);
        expect([p, JSON.stringify(live(normalize(b.body)))]).toEqual([p, JSON.stringify(live(normalize(a.body)))]);
      }
    });
    it('SCC health / results / checks / audit logs / data catalog + columns + rows (approved readers, IAM projections, secret tables)', async () => {
      for (const [m, p] of [['get', '/system-controller-center/health'], ['get', '/system-controller-center/results'], ['post', '/system-controller-center/checks/run'],
        ['get', '/system-controller-center/audit/logs']] as const) {
        const { a, b } = await compare('SYSTEM_CONTROLLER_CENTER', m, p);
        expect([p, b.status]).toEqual([p, a.status]);
        expect([p, JSON.stringify(live(normalize(b.body)))]).toEqual([p, JSON.stringify(live(normalize(a.body)))]);
      }
      const { a, b } = await compare('SYSTEM_CONTROLLER_CENTER', 'get', '/system-controller-center/data/tables');
      expect([a.status, b.status]).toEqual([200, 200]);
      const list = catalogCheck(a.body, b.body);
      note(`SCC data tables: ${list.length}`);
      const wanted = list.filter((e) => /^(fnd_module_events|fnd_data_access_rules|iam_sessions|iam_memberships|fnd_modules|cm_customers|iam_credentials|iam_user_accounts|fnd_audit_logs)$/.test(e.table));
      expect(wanted.length).toBeGreaterThanOrEqual(6);
      for (const e of wanted) {
        for (const suffix of ['columns', 'rows']) {
          const r = await compare('SYSTEM_CONTROLLER_CENTER', 'get', `/system-controller-center/data/tables/${encodeURIComponent(e.tableKey)}/${suffix}`);
          expect([e.table, suffix, r.b.status]).toEqual([e.table, suffix, r.a.status]);
          if (!SECRET_TABLES.has(`${e.schema}.${e.table}`)) expect([e.table, suffix, JSON.stringify(alignStatus(normalize(r.b.body)))]).toEqual([e.table, suffix, JSON.stringify(alignStatus(normalize(r.a.body)))]);
        }
      }
    });
    it('DATA_INSPECTOR (hard-coded account gate: the clone\'s own "admin" account) tables / columns / rows', async () => {
      const saved = adminAccount;
      adminAccount = one(`SELECT user_account_id FROM iam.iam_user_accounts WHERE username = 'admin'`);
      try {
        const { a, b } = await compare('DATA_INSPECTOR', 'get', '/data-inspector/tables');
        note(`DATA_INSPECTOR tables status legacy=${a.status} fixed=${b.status}`);
        expect([a.status, b.status]).toEqual([200, 200]);
        const list = catalogCheck(a.body, b.body);
        note(`DATA_INSPECTOR tables: ${list.length}`);
        const wanted = list.filter((e) => /^(cm_customers|cm_tasks|fnd_modules|fnd_module_versions|iam_user_accounts|iam_credentials|iam_sessions|iam_roles|fnd_audit_logs)$/.test(e.table));
        for (const e of wanted) {
          for (const suffix of ['columns', 'rows']) {
            const r = await compare('DATA_INSPECTOR', 'get', `/data-inspector/tables/${encodeURIComponent(e.tableKey)}/${suffix}`);
            expect([e.table, suffix, r.b.status]).toEqual([e.table, suffix, r.a.status]);
            if (!SECRET_TABLES.has(`${e.schema}.${e.table}`)) expect([e.table, suffix, JSON.stringify(alignStatus(normalize(r.b.body)))]).toEqual([e.table, suffix, JSON.stringify(alignStatus(normalize(r.a.body)))]);
            else note(`  secret table ${e.schema}.${e.table} ${suffix}: legacy=${r.a.status} fixed=${r.b.status} same=${r.same}`);
          }
        }
      } finally {
        adminAccount = saved;
      }
      note(`compat DIFF list: ${diffs.join(' | ') || 'none'}`);
    });
  });

  // ------------------------------------------------------------------------------------------- database layer alone
  describe('database layer alone: a raw talo_module_reader connection that bypasses every Host check', () => {
    const raw = (sql: string, readWrite = true) => outcome(readerDb.transaction(async (tx) => {
      if (readWrite) await tx.execute('SET TRANSACTION READ WRITE', []); // the role default (read only) is only a default
      return tx.query(sql, []);
    }));
    const fingerprint = () => one(`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM cm.cm_customers AS t`)
      + one(`SELECT md5(string_agg(account_status, ',' ORDER BY user_account_id)) FROM iam.iam_user_accounts`) + one(`SELECT count(*) FROM foundation.fnd_audit_logs`)
      + one(`SELECT count(*) FROM pg_class WHERE relname LIKE 'ro_probe%'`);
    const cases: [string, string, RegExp][] = [
      ['INSERT CRM', `INSERT INTO cm.cm_customers (display_name, customer_type_code) VALUES ('${marker} raw', 'COMPANY')`, /^DB:42501$/],
      ['UPDATE IAM', `UPDATE iam.iam_user_accounts SET account_status = 'LOCKED'`, /^DB:42501$/],
      ['INSERT Foundation audit', `INSERT INTO foundation.fnd_audit_logs (event_id, action_code, target_type, outcome, occurred_at, source_service) VALUES (gen_random_uuid(), 'X', 'X', 'SUCCESS', now(), 'x')`, /^DB:42501$/],
      ['nextval', `SELECT nextval('cm.customer_code_seq')`, /^DB:42501$/],
      ['CREATE TABLE in cm', `CREATE TABLE cm.ro_probe (x int)`, /^DB:42501$/],
      ['CREATE TABLE in public', `CREATE TABLE public.ro_probe (x int)`, /^DB:42501$/],
      ['CREATE TEMP TABLE', `CREATE TEMP TABLE ro_probe (x int)`, /^DB:42501$/],
      ['SET ROLE talo_app', `SET ROLE talo_app`, /^DB:42501$/],
      ['SET SESSION AUTHORIZATION', `SET SESSION AUTHORIZATION talo_app`, /^DB:42501$/],
      ['IAM SECURITY DEFINER writer', `SELECT iam.admin_set_account_status(gen_random_uuid(), gen_random_uuid(), 'LOCKED', 'x', gen_random_uuid())`, /^DB:42501$/],
      ['read server file', `SELECT pg_read_file('/etc/passwd')`, /^DB:42501$/],
      ['terminate a backend of another role', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'admin' LIMIT 1`, /^(DB:42501|OK)$/],
      ['secret column (direct)', `SELECT password_hash FROM iam.iam_credentials LIMIT 1`, /^DB:42501$/],
      ['secret column (whole-row reference)', `SELECT t FROM iam.iam_credentials AS t LIMIT 1`, /^DB:42501$/],
      ['secret column (predicate oracle)', `SELECT count(*) FROM iam.iam_sessions WHERE session_token_hash LIKE 'a%'`, /^DB:42501$/],
      ['secret column (row_to_json)', `SELECT row_to_json(t) FROM iam.iam_sessions AS t LIMIT 1`, /^DB:42501$/],
    ];
    for (const [name, sql, expected] of cases) {
      it(name, async () => {
        const before = fingerprint();
        const r = await raw(sql);
        note(`raw reader: ${name} → ${r}`);
        expect([name, r]).toEqual([name, expect.stringMatching(expected)]);
        expect(fingerprint()).toBe(before);
      });
    }
    it('secret columns are not exposed through statistics, views or the 5 reader functions', async () => {
      const stats = await readerDb.query(`SELECT count(*)::int AS n FROM pg_stats WHERE (tablename, attname) IN (('iam_credentials', 'password_hash'), ('iam_sessions', 'session_token_hash'))`, []);
      expect(stats).toEqual([{ n: 0 }]);
      expect(one(`SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
        WHERE d.refobjid IN ('iam.iam_credentials'::regclass, 'iam.iam_sessions'::regclass) AND v.oid NOT IN ('iam.iam_credentials'::regclass, 'iam.iam_sessions'::regclass)
          AND has_table_privilege('talo_module_reader', v.oid, 'SELECT')`)).toBe('0');
      const outCols = admin(`SELECT p.proname, coalesce(array_to_string(p.proargnames, ','), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('audit_api', 'foundation_read_api') AND has_function_privilege('talo_module_reader', p.oid, 'EXECUTE')`);
      expect(outCols).toHaveLength(5);
      for (const [name, cols] of outCols) expect([name, /password|token_hash|session_token/.test(cols ?? '')]).toEqual([name, false]);
      note('secret indirect paths: pg_stats rows=0, readable views over the 2 tables=0, reader functions without secret outputs=5');
    });
    it('what the DB layer alone still permits (documented residuals; the Host layer blocks the first one)', async () => {
      const lo = await raw(`SELECT lo_create(0) AS oid`);
      const loCount = one(`SELECT count(*) FROM pg_largeobject_metadata WHERE lomowner = 'talo_module_reader'::regrole`);
      const notify = await raw(`SELECT pg_notify('ro_probe', 'x')`, false);
      const lock = await raw(`SELECT pg_try_advisory_xact_lock(1) AS l`, false);
      note(`raw reader residual: lo_create in a READ WRITE transaction → ${lo} (large objects owned by the reader now=${loCount}); pg_notify → ${notify}; xact advisory lock → ${lock}`);
      if (Number(loCount) > 0) admin(`SELECT lo_unlink(oid) FROM pg_largeobject_metadata WHERE lomowner = 'talo_module_reader'::regrole`);
      expect(await run(fixed, (q) => q.query('SELECT lo_create(0)', []))).toBe('DB:25006');
    });
    it('effective privileges of talo_module_reader (all schemas, incl. PUBLIC) = the approved set', async () => {
      const rows = admin(`SELECT
          (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'talo_module_reader' AND privilege_type = 'SELECT'),
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r','v','m','p','f') AND has_table_privilege('talo_module_reader', c.oid, 'SELECT')),
          (SELECT count(DISTINCT c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r','v','m','p','f') AND has_any_column_privilege('talo_module_reader', c.oid, 'SELECT')),
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind = 'S' AND (has_sequence_privilege('talo_module_reader', c.oid, 'USAGE') OR has_sequence_privilege('talo_module_reader', c.oid, 'SELECT'))),
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND has_function_privilege('talo_module_reader', p.oid, 'EXECUTE')),
          (SELECT string_agg(nspname, ',' ORDER BY nspname) FROM pg_namespace WHERE has_schema_privilege('talo_module_reader', oid, 'USAGE') AND nspname !~ '^pg_' AND nspname <> 'information_schema'),
          (SELECT count(*) FROM pg_namespace WHERE has_schema_privilege('talo_module_reader', oid, 'CREATE')),
          (SELECT string_agg(datname || ':' || has_database_privilege('talo_module_reader', datname, 'CONNECT')::text || '/' || has_database_privilege('talo_module_reader', datname, 'TEMP')::text, ',' ORDER BY datname) FROM pg_database WHERE NOT datistemplate)`)[0]!;
      note(`effective privileges: selectColumns=${rows[0]} tableLevelSelect=${rows[1]} tablesWithReadableColumns=${rows[2]} sequences=${rows[3]} functions=${rows[4]} schemasUsage=${rows[5]} schemasCreate=${rows[6]} databases(connect/temp)=${rows[7]}`);
      expect(rows.slice(0, 7)).toEqual(['394', '0', '43', '0', '5', 'audit_api,cm,foundation,foundation_read_api,iam', '0']);
    });
    it('the 5 amended reader functions: same rows for talo_app and talo_module_reader; still refused for any other caller', async () => {
      const calls = [
        `SELECT * FROM audit_api.read_foundation_audit(now() - interval '7 days', now(), 'ALL', '', NULL, 50) ORDER BY 1`,
        `SELECT * FROM audit_api.read_iam_audit(now() - interval '7 days', now(), 'ALL', '', NULL, 50) ORDER BY 1`,
        `SELECT * FROM audit_api.read_foundation_audit_summary(now() - interval '1 day', now())`,
        `SELECT * FROM foundation_read_api.read_module_events(now() - interval '90 days', now(), NULL, '', 50, 0) ORDER BY 1`,
        `SELECT * FROM foundation_read_api.read_data_access_rules(NULL, NULL, 50, 0) ORDER BY 1`,
      ];
      for (const sql of calls) {
        const asApp = await appDb.query(sql, []);
        const asReader = await readerDb.query(sql, []);
        expect([sql.slice(14, 60), JSON.stringify(asReader)]).toEqual([sql.slice(14, 60), JSON.stringify(asApp)]);
      }
      expect(one(`SELECT has_function_privilege('talo_test_harness', 'foundation_read_api.read_module_events(timestamp with time zone,timestamp with time zone,uuid,text,integer,integer)', 'EXECUTE')::text`)).toBe('false');
      expect(one(`SELECT has_function_privilege('public', 'audit_api.read_iam_audit(timestamp with time zone,timestamp with time zone,text,text,uuid,integer)', 'EXECUTE')::text`)).toBe('false');
      note('5 reader functions: identical rows talo_app vs talo_module_reader; PUBLIC / talo_test_harness have no EXECUTE');
    });
  });
});
