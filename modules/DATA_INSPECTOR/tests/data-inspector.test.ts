import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../backend/src/app.js';
import { loadConfig } from '../../../backend/src/config/env.js';
import { createLogger } from '../../../backend/src/core/logging/logger.js';
import { validateMic } from '../../../backend/src/modules/foundation/foundation.mic.js';
import type { AccessFacts, PermissionRef } from '../../../backend/src/modules/foundation/foundation.permissions.js';
import type { AuditRecord, FoundationDb } from '../../../backend/src/modules/foundation/foundation.repository.js';
import { HOST_SQL, createHostCapabilities } from '../../../backend/src/module-host/capabilities.js';
import { handshake } from '../../../backend/src/module-host/loader.js';
import { syncModules, validateManifest } from '../../../backend/scripts/modules-sync.mjs';
import { FakeAuth, TEST_ORIGIN, pgError, token } from '../../../backend/test/unit/foundation/fakes.js';
import * as entry from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/index.js';
import { DATA_INSPECTOR_BINDING } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.permissions.js';
import {
  CELL_MAX_CHARS, DATA_INSPECTOR_SQL, pageSql, parseTableKey, quoteIdent, tableKeyOf,
} from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.sql.js';
import type { RelationIdentity } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.sql.js';
import { JSON_PARSE_MAX_CHARS, MASK, isSensitiveName, maskJsonText, maskModeOf } from '../../../backend/src/installed-modules/DATA_INSPECTOR/backend/data-inspector.masking.js';
import { DATA_INSPECTOR_EVIDENCE_RUN, DATA_INSPECTOR_IAM_FIXTURE_RUN, DATA_INSPECTOR_MIC10_CANDIDATE, dataInspectorMic } from '../../../backend/src/installed-modules/DATA_INSPECTOR/mic/data-inspector.mic.js';
import { canonicalDigest } from '../../../backend/src/modules/foundation/foundation.json.js';
import { activationBlockers } from '../../../backend/src/modules/foundation/foundation.lifecycle.service.js';

// DATA_INSPECTOR — package / Host-compatibility tests, mock level (no database). The installed copy of the package is
// mounted through the REAL Host capabilities (session wrapper, AccessGuard + evaluateAccess + DENIED audit, READ ONLY
// executor with its SET TRANSACTION READ ONLY / statement timeout / read-only check). Only the Auth session store, the
// IAM facts and the database answers are fakes; every SQL text the Host or the module sends is recorded and checked.

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(here, '..');
const SPEC_DIR = resolve(here, '../../../documents/module-specs/MODULE-DATA_INSPECTOR-SPEC-v0.2');
const WRITE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|MERGE|CALL|DO|SET\s+ROLE|SET\s+SESSION|LOCK|VACUUM|REINDEX|CLUSTER|COMMENT|SECURITY)\b/i;

// Page SELECT of the module (its first item may be a column or the FIX-01 mask constant).
const isPage = (sql: string) => sql.startsWith('SELECT ') && sql.endsWith(' LIMIT $1 OFFSET $2');

const ADMIN_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_ID = '30000000-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------------------------------------- fakes
class FakeAccess {
  readonly audits: AuditRecord[] = [];
  readonly allowed = new Set<string>();
  readonly denied = new Set<string>(); // Direct DENY

  async loadAccessFacts(_userAccountId: string, permission: PermissionRef): Promise<AccessFacts> {
    const grant = { roleActive: true, notRevoked: true, started: true, notExpired: true };
    return {
      permissions: [{ permissionId: '40000000-0000-4000-8000-000000000001', minimumAssuranceLevel: 1 }],
      account: { accountStatus: 'ACTIVE', notDisabled: true },
      grants: [
        ...(this.allowed.has(permission.permissionCode) ? [{ source: 'DIRECT' as const, effect: 'ALLOW', ...grant }] : []),
        ...(this.denied.has(permission.permissionCode) ? [{ source: 'DIRECT' as const, effect: 'DENY', ...grant }] : []),
      ],
    };
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audits.push(record);
  }
}

interface Rel { oid: string; schema: string; table: string; relkind: string; rls?: boolean; usage?: boolean; select?: boolean; anyColumn?: boolean }
interface Col { name: string; type: string; pk?: boolean; select?: boolean; nullable?: boolean }

// Scripted PostgreSQL: answers the Host statements and the module's catalog / table reads; records every statement.
class FakePg {
  readonly log: { sql: string; params: readonly unknown[]; inTx: boolean }[] = [];
  lifecycle: { is_enabled: boolean; active_versions: number } | null = { is_enabled: true, active_versions: 1 };
  accounts = new Map<string, { username: string; account_status: string; disabled_at: Date | null }>([
    [ADMIN_ID, { username: 'admin', account_status: 'ACTIVE', disabled_at: null }],
    [OTHER_ID, { username: 'nv0001', account_status: 'ACTIVE', disabled_at: null }],
  ]);
  accountError: Error | null = null;
  pageError: Error | null = null;
  readOnlyOn = true;
  rels: Rel[] = [
    { oid: '16400', schema: 'foundation', table: 'fnd_modules', relkind: 'r' },
    { oid: '16500', schema: 'iam', table: 'iam_credentials', relkind: 'r', select: false, anyColumn: false },
    { oid: '16600', schema: 'iam', table: 'iam_user_accounts', relkind: 'r', select: false, anyColumn: true },
    { oid: '1259', schema: 'pg_catalog', table: 'pg_class', relkind: 'r' },
    { oid: '1260', schema: 'pg_catalog', table: 'pg_authid', relkind: 'r', select: false, anyColumn: false },
    { oid: '16700', schema: 'public', table: 'events', relkind: 'p', rls: true },
    { oid: '16800', schema: 'odd', table: 'we"ird; DROP TABLE x; --', relkind: 'r' },
    { oid: '16900', schema: 'public', table: 'a_view', relkind: 'v' },
    { oid: '17000', schema: 'secret', table: 'hidden', relkind: 'r', usage: false },
  ];
  cols = new Map<string, Col[]>([
    ['16400', [{ name: 'module_id', type: 'uuid', pk: true, nullable: false }, { name: 'module_key', type: 'text', nullable: false }, { name: 'manifest', type: 'jsonb' }]],
    ['16500', [{ name: 'credential_id', type: 'uuid', pk: true, select: false }, { name: 'password_hash', type: 'text', select: false }]],
    ['16600', [{ name: 'user_account_id', type: 'uuid', pk: true, select: false }, { name: 'username', type: 'text', select: true }, { name: 'account_status', type: 'text', select: true }]],
    ['16700', [{ name: 'payload', type: 'bytea' }, { name: 'note', type: 'text' }]],
    ['16800', [{ name: 'c0', type: 'integer', pk: true }, { name: 'x"y', type: 'text' }]],
  ]);
  pageRows: Record<string, string | null>[] = [];

  private relRow(r: Rel) {
    return {
      relation_oid: r.oid, schema_name: r.schema, table_name: r.table, relkind: r.relkind, row_security: r.rls ?? false,
      schema_usage: r.usage ?? true, table_select: r.select ?? true,
    };
  }

  private answer(sql: string, params: readonly unknown[]): unknown[] {
    if (sql === HOST_SQL.readOnlyState) return [{ read_only: this.readOnlyOn ? 'on' : 'off' }];
    if (sql === HOST_SQL.lifecycle) return this.lifecycle === null ? [] : [this.lifecycle];
    if (sql === DATA_INSPECTOR_SQL.adminAccount) {
      if (this.accountError) throw this.accountError;
      const a = this.accounts.get(String(params[0]));
      return a === undefined ? [] : [a];
    }
    if (sql === DATA_INSPECTOR_SQL.catalog) {
      return this.rels.filter((r) => r.relkind === 'r' || r.relkind === 'p').slice(0, Number(params[0]))
        .map((r) => ({ ...this.relRow(r), any_column_select: (r.select ?? true) || (r.anyColumn ?? false) }));
    }
    if (sql === DATA_INSPECTOR_SQL.relation) {
      const r = this.rels.find((x) => x.oid === params[0]);
      return r === undefined ? [] : [this.relRow(r)];
    }
    if (sql === DATA_INSPECTOR_SQL.columns) {
      return (this.cols.get(String(params[0])) ?? []).map((c, i) => ({
        ordinal_position: i + 1, column_name: c.name, data_type: c.type, nullable: c.nullable ?? true, primary_key: c.pk ?? false, select_privilege: c.select ?? true,
      }));
    }
    if (isPage(sql)) {
      if (this.pageError) throw this.pageError;
      const [limit, offset] = params.map(Number);
      return this.pageRows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 0));
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  }

  readonly db: FoundationDb = {
    query: async (sql, params) => {
      this.log.push({ sql, params, inTx: false });
      return this.answer(sql, params) as never;
    },
    execute: async (sql, params) => {
      this.log.push({ sql, params, inTx: false });
      return 0;
    },
    transaction: async (fn) => fn({
      query: async (sql: string, params: readonly unknown[]) => {
        this.log.push({ sql, params, inTx: true });
        return this.answer(sql, params) as never;
      },
      execute: async (sql: string, params: readonly unknown[]) => {
        this.log.push({ sql, params, inTx: true });
        return 0;
      },
    } as never),
  };

  sqls(): string[] {
    return this.log.map((l) => l.sql);
  }
}

function build() {
  const pg = new FakePg();
  const access = new FakeAccess();
  const auth = new FakeAuth();
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  auth.authenticated(token('admin'), ADMIN_ID);
  auth.authenticated(token('other'), OTHER_ID);
  auth.activation(token('activation'));
  const host = createHostCapabilities('DATA_INSPECTOR', {
    db: pg.db, access, authService: auth, logger, secureCookie: false, navigation: { menu: async () => [] },
  });
  const { router } = entry.createModule(host);
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [router] });
  const allowAll = () => {
    access.allowed.add(DATA_INSPECTOR_BINDING.catalogRead.permissionCode);
    access.allowed.add(DATA_INSPECTOR_BINDING.rowsRead.permissionCode);
  };
  return { pg, access, app, logs, allowAll };
}

const ADMIN = `talo_sid=${token('admin')}`;
const OTHER = `talo_sid=${token('other')}`;
const keyOf = (oid: string, schema: string, table: string, relkind = 'r') => tableKeyOf({ oid, schema, table, relkind } satisfies RelationIdentity);
const MODULES_KEY = keyOf('16400', 'foundation', 'fnd_modules');
const CREDENTIALS_KEY = keyOf('16500', 'iam', 'iam_credentials');
const ACCOUNTS_KEY = keyOf('16600', 'iam', 'iam_user_accounts');
const EVENTS_KEY = keyOf('16700', 'public', 'events', 'p');
const ODD_KEY = keyOf('16800', 'odd', 'we"ird; DROP TABLE x; --');
const ENDPOINTS = ['/api/data-inspector/tables', `/api/data-inspector/tables/${MODULES_KEY}/columns`, `/api/data-inspector/tables/${MODULES_KEY}/rows`];
const moduleSql = (pg: FakePg) => pg.sqls().filter((s) => !(Object.values(HOST_SQL) as string[]).includes(s));

// --------------------------------------------------------------------------------------------- package + manifest
describe('DATA_INSPECTOR package (TC-20 / TC-21 / TC-22, static)', () => {
  it('module.json is the spec 09-module.json and passes the Host loader validation', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE_DIR, 'module.json'), 'utf8'));
    expect(manifest).toEqual(JSON.parse(readFileSync(join(SPEC_DIR, '09-module.json'), 'utf8')));
    expect(validateManifest(manifest, 'DATA_INSPECTOR', PACKAGE_DIR)).toEqual([]);
  });

  it('syncs into a Host (backend: backend + mic, frontend: frontend) and passes the runtime handshake', async () => {
    const out = await mkdtemp(join(tmpdir(), 'di-sync-'));
    try {
      const lines: string[] = [];
      const backendOut = join(out, 'b', 'installed-modules');
      const frontendOut = join(out, 'f', 'installed-modules');
      expect(syncModules({ target: 'backend', modulesDir: resolve(PACKAGE_DIR, '..'), outDir: backendOut, log: (l) => lines.push(l) })).toContain('DATA_INSPECTOR');
      expect(syncModules({ target: 'frontend', modulesDir: resolve(PACKAGE_DIR, '..'), outDir: frontendOut, log: (l) => lines.push(l) })).toContain('DATA_INSPECTOR');
      expect(lines.filter((l) => l.includes('skip'))).toEqual([]);
      expect(await readFile(join(backendOut, 'registry.ts'), 'utf8')).toContain("from './DATA_INSPECTOR/backend/index.js'");
      expect(await readFile(join(frontendOut, 'registry.ts'), 'utf8')).toContain("from './DATA_INSPECTOR/frontend/index'");
      await expect(readFile(join(backendOut, 'DATA_INSPECTOR', 'mic', 'data-inspector.mic.ts'), 'utf8')).resolves.toContain('dataInspectorMic');
      await expect(readFile(join(backendOut, 'DATA_INSPECTOR', 'tests', 'data-inspector.test.ts'), 'utf8')).rejects.toThrow(); // tests are not shipped
    } finally {
      await rm(out, { recursive: true, force: true });
    }
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'module.json'), 'utf8')) as { moduleKey: string; requiredCapabilities: string[] };
    expect([...entry.REQUIRED_CAPABILITIES]).toEqual(manifest.requiredCapabilities);
    expect(handshake({ manifest: { ...manifest, name: 'x', packageVersion: '0.1.0', contractVersion: 'MIC-1.0', hostProtocol: 'TALO-MODULE-HOST-1' }, entry })).toEqual([]);
  });

  it('MIC is the spec 08-MIC-1.0.json, valid for the Host MIC-1.0 validator; MIC-07 is K05 1:1 with the IAM binding; MIC-10 NOT_TESTED', () => {
    const mic = dataInspectorMic();
    expect(mic).toEqual(JSON.parse(readFileSync(join(SPEC_DIR, '08-MIC-1.0.json'), 'utf8')));
    const result = validateMic(mic, { moduleKey: 'DATA_INSPECTOR', moduleVersion: '0.1.0', contractVersion: 'MIC-1.0', otherVersions: [] });
    expect(result.ok ? 'ok' : result.errors).toBe('ok');
    const b = DATA_INSPECTOR_BINDING;
    expect(mic.mic07IamMapping.map((m) => [m.moduleCode, m.resourceCode, m.operation, m.minimumAssuranceLevel])).toEqual(
      [b.catalogRead, b.rowsRead].map((p) => [p.moduleCode, p.resourceCode, p.operation, 1]),
    );
    expect([b.catalogRead.permissionCode, b.rowsRead.permissionCode]).toEqual(['data_inspector.catalog.read', 'data_inspector.rows.read']);
    expect(mic.mic05Api.map((a) => a.method)).toEqual(['GET', 'GET', 'GET']);
    expect(mic.mic10Manifest.testEvidence.map((e) => e.result)).toEqual(['NOT_TESTED']);
  });
});

// --------------------------------------------------------------------------------------------------- SQL + keys
// ------------------------------------------------------------------------------------------ DI-02 MIC-10 candidate
describe('DI-02 MIC-10 candidate', () => {
  const candidate = () => dataInspectorMic('DATA_INSPECTOR', DATA_INSPECTOR_MIC10_CANDIDATE);
  const factsOf = (mic: unknown) => ({
    version: {
      versionId: 'v', moduleId: 'm', moduleVersion: '0.1.0', contractVersion: 'MIC-1.0', status: 'APPROVED', manifestJson: mic, manifestHash: canonicalDigest(mic).sha256,
      submittedByAccountId: null, createdAt: '2026-10-22T00:00:00.000Z', reviewedByAccountId: null, reviewedAt: null, activatedAt: null,
    },
    checks: [{ checkId: 'c', checkResult: 'PASS' }], blockingChanges: 0, directDbContracts: 0,
  });

  it('only MIC-10 differs from the spec MIC; the candidate passes the Foundation MIC-1.0 validator', () => {
    const mic = candidate();
    const { mic10Manifest: _c, ...rest } = mic;
    const { mic10Manifest: _s, ...spec } = dataInspectorMic();
    expect(rest).toEqual(spec);
    const result = validateMic(mic, { moduleKey: 'DATA_INSPECTOR', moduleVersion: '0.1.0', contractVersion: 'MIC-1.0', otherVersions: [] });
    expect(result.ok ? 'ok' : result.errors).toBe('ok');
  });

  it('eight pre-activation groups, every one PASS with a log of a real evidence run; DI-IAM-DB is declared as FIXTURE', () => {
    expect(DATA_INSPECTOR_MIC10_CANDIDATE.map((x) => x.name.split(' ')[0])).toEqual(['DI-UNIT', 'DI-DB', 'DI-MASK', 'DI-MIC', 'DI-HOST', 'DI-TYPECHECK', 'DI-REGRESSION', 'DI-IAM-DB']);
    for (const e of DATA_INSPECTOR_MIC10_CANDIDATE) {
      expect([e.name.split(' ')[0], e.result]).toEqual([e.name.split(' ')[0], 'PASS']);
      for (const ref of e.reference.split('; ')) {
        expect(ref).toMatch(new RegExp(`^modules/DATA_INSPECTOR/evidence/(${DATA_INSPECTOR_EVIDENCE_RUN}|${DATA_INSPECTOR_IAM_FIXTURE_RUN})/0[1-9]-[a-z-]+\\.log$`));
      }
    }
    expect(DATA_INSPECTOR_MIC10_CANDIDATE.find((x) => x.name.startsWith('DI-IAM-DB'))?.name).toMatch(/^DI-IAM-DB \(FIXTURE\).*NOT the real data_inspector\.\* permissions/);
  });

  it('the REAL Foundation activation gate accepts the final candidate and still blocks the spec default (NOT_TESTED)', () => {
    expect(activationBlockers(factsOf(candidate()))).toEqual([]);
    expect(activationBlockers(factsOf(dataInspectorMic()))).toEqual(['TEST_EVIDENCE_NOT_PASSED']);
  });

  // Run after the evidence run (TALO_DI_EVIDENCE_VERIFY=1): referenced logs exist, their step exited 0, and test logs report no failure.
  it.runIf(process.env['TALO_DI_EVIDENCE_VERIFY'] === '1')('evidence files referenced by PASS entries exist and record a successful step', () => {
    const repo = resolve(here, '../../..');
    for (const e of DATA_INSPECTOR_MIC10_CANDIDATE.filter((x) => x.result === 'PASS')) {
      for (const ref of e.reference.split('; ')) {
        const log = readFileSync(join(repo, ref), 'utf8');
        const run = readFileSync(join(repo, ref, '..', '00-run.txt'), 'utf8');
        const step = ref.split('/').at(-1)?.replace(/\.log$/, '') ?? '';
        // Multi-step run: "<step> | … | exit=0 |"; single-step run (DI-03B): "exit=0 start=…".
        const ok = new RegExp(`^${step} \\|[^\\n]*\\| exit=0 \\|`, 'm').test(run) || (!run.includes(' | exit=') && /^exit=0 /m.test(run));
        expect([step, ok]).toEqual([step, true]);
        expect([step, /Tests\s+\d+ failed|Test Files\s+\d+ failed|error TS/.test(log)]).toEqual([step, false]);
      }
    }
  });
});

describe('SQL and table keys (TC-11 / TC-24, static)', () => {
  it('every fixed statement is a SELECT with bound parameters; no write / DDL / role switch', () => {
    for (const sql of Object.values(DATA_INSPECTOR_SQL)) {
      expect(sql.trim()).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(WRITE);
    }
    expect(DATA_INSPECTOR_SQL.adminAccount).toContain('WHERE a.user_account_id = $1::uuid');
    expect(DATA_INSPECTOR_SQL.catalog).toContain("c.relkind IN ('r', 'p')");
    expect(DATA_INSPECTOR_SQL.catalog).not.toMatch(/nspname\s*(=|IN|<>|NOT)/); // no schema allowlist / exclusion
  });

  it('identifiers from the catalog are double-quoted with embedded quotes doubled; paging is $1 / $2', () => {
    expect(quoteIdent('we"ird; DROP TABLE x; --')).toBe('"we""ird; DROP TABLE x; --"');
    expect(() => quoteIdent('')).toThrow();
    expect(() => quoteIdent('a\u0000b')).toThrow();
    const sql = pageSql('odd', 'we"ird', ['c0', 'x"y'], ['c0']);
    expect(sql).toBe(`SELECT pg_catalog.left(t."c0"::text, ${CELL_MAX_CHARS + 1}) AS "c0", pg_catalog.left(t."x""y"::text, ${CELL_MAX_CHARS + 1}) AS "c1" FROM "odd"."we""ird" AS t ORDER BY t."c0" LIMIT $1 OFFSET $2`);
    expect(pageSql('s', 't', ['a'], [])).not.toContain('ORDER BY');
  });

  it('table keys: only t_<oid>_<16 hex>; injection / traversal / overflow forms are refused', () => {
    expect(parseTableKey(MODULES_KEY)).toEqual({ oid: '16400', digest: MODULES_KEY.slice(-16) });
    for (const bad of [
      undefined, 42, '', 't_0_0123456789abcdef', 't_4294967296_0123456789abcdef', 't_16400_0123456789ABCDEF', 't_16400_0123', "t_1_0123456789abcdef' OR 1=1",
      't_1_0123456789abcdef;DROP', '../t_1_0123456789abcdef', 'foundation.fnd_modules', 'SELECT 1', `${MODULES_KEY} `,
    ]) expect(parseTableKey(bad)).toBeNull();
    expect(keyOf('16400', 'foundation', 'fnd_modules')).not.toBe(keyOf('16400', 'foundation', 'fnd_modules_renamed'));
  });
});

// ------------------------------------------------------------------------------------- admin gate + IAM + lifecycle
describe('access: session → IAM → lifecycle → admin account gate (TC-04 … TC-07, TC-16 … TC-19, TC-23, TC-25)', () => {
  it('admin with IAM ALLOW: catalog of every schema (incl. pg_catalog / iam), r + p only, read status per table', async () => {
    const h = build();
    h.allowAll();
    const res = await request(h.app).get('/api/data-inspector/tables').set('Cookie', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('CURRENT_DATABASE_ALL_SCHEMAS');
    expect(res.body.catalogComplete).toBe(true);
    const byName = Object.fromEntries((res.body.tables as { schema: string; table: string; readStatus: string; kind: string; tableKey: string }[])
      .map((t) => [`${t.schema}.${t.table}`, t]));
    expect(Object.keys(byName)).toEqual([
      'foundation.fnd_modules', 'iam.iam_credentials', 'iam.iam_user_accounts', 'pg_catalog.pg_class', 'pg_catalog.pg_authid', 'public.events',
      'odd.we"ird; DROP TABLE x; --', 'secret.hidden',
    ]);
    expect(byName['foundation.fnd_modules']).toMatchObject({ readStatus: 'READABLE', kind: 'BASE_TABLE', tableKey: MODULES_KEY });
    expect(byName['iam.iam_credentials']?.readStatus).toBe('NOT_READABLE');
    expect(byName['iam.iam_user_accounts']?.readStatus).toBe('PARTIAL');
    expect(byName['pg_catalog.pg_authid']?.readStatus).toBe('NOT_READABLE');
    expect(byName['secret.hidden']?.readStatus).toBe('NOT_READABLE'); // no USAGE on the schema
    expect(byName['public.events']).toMatchObject({ kind: 'PARTITIONED_TABLE', rowSecurity: true });
  });

  it('every statement runs in ONE Host transaction that is READ ONLY with the timeout, admin gate first', async () => {
    const h = build();
    h.allowAll();
    expect((await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN)).status).toBe(200);
    const tx = h.pg.log.filter((l) => l.inTx).map((l) => l.sql);
    expect(tx.slice(0, 4)).toEqual([HOST_SQL.readOnly, HOST_SQL.timeout, HOST_SQL.readOnlyState, DATA_INSPECTOR_SQL.adminAccount]);
    expect(h.pg.log.filter((l) => !l.inTx).map((l) => l.sql)).toEqual([HOST_SQL.lifecycle]);
    for (const sql of moduleSql(h.pg)) {
      expect(sql.trim()).toMatch(/^SELECT\b/);
    }
    expect(h.pg.log.find((l) => l.sql === DATA_INSPECTOR_SQL.adminAccount)?.params).toEqual([ADMIN_ID]);
  });

  it('the username comes from the database row of the session account — the session / request cannot claim `admin`', async () => {
    const h = build();
    h.allowAll();
    // FakeAuth's session describes username "nv0001" for every account; only the DB row decides.
    expect((await request(h.app).get('/api/data-inspector/tables').set('Cookie', ADMIN)).status).toBe(200);
    for (const path of ENDPOINTS) {
      const res = await request(h.app).get(`${path}?username=admin&userAccountId=${ADMIN_ID}`).set('Cookie', OTHER)
        .set('X-Username', 'admin').set('X-User-Account-Id', ADMIN_ID);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body).not.toHaveProperty('tables');
    }
  });

  it('non-admin with a mis-granted IAM ALLOW gets 403 on all three APIs before any catalog / table read (TC-04 / TC-23)', async () => {
    const h = build();
    h.allowAll();
    for (const path of ENDPOINTS) {
      const res = await request(h.app).get(path).set('Cookie', OTHER);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(moduleSql(h.pg).every((s) => s === DATA_INSPECTOR_SQL.adminAccount)).toBe(true);
    const denied = h.logs.filter((l) => l.includes('DATA_INSPECTOR.ACCESS_DENIED'));
    expect(denied).toHaveLength(3);
    expect(denied.join('\n')).not.toContain('nv0001'); // no username in the log
  });

  it('usernames that only look like admin are refused (case, spaces, prefix); admin not ACTIVE / disabled is refused', async () => {
    for (const account of [
      { username: 'Admin', account_status: 'ACTIVE', disabled_at: null }, { username: 'ADMIN', account_status: 'ACTIVE', disabled_at: null },
      { username: ' admin', account_status: 'ACTIVE', disabled_at: null }, { username: 'admin ', account_status: 'ACTIVE', disabled_at: null },
      { username: 'administrator', account_status: 'ACTIVE', disabled_at: null }, { username: 'admin', account_status: 'LOCKED', disabled_at: null },
      { username: 'admin', account_status: 'DISABLED', disabled_at: new Date() }, { username: 'admin', account_status: 'ACTIVE', disabled_at: new Date() },
      { username: 'admin', account_status: 'PROVISIONED', disabled_at: null },
    ]) {
      const h = build();
      h.allowAll();
      h.pg.accounts.set(ADMIN_ID, account);
      const res = await request(h.app).get('/api/data-inspector/tables').set('Cookie', ADMIN);
      expect([account.username, res.status]).toEqual([account.username, 403]);
    }
    const h = build();
    h.allowAll();
    h.pg.accounts.delete(ADMIN_ID); // no account row
    expect((await request(h.app).get('/api/data-inspector/tables').set('Cookie', ADMIN)).status).toBe(403);
  });

  it('account lookup failure (e.g. no SELECT on iam.iam_user_accounts, 42501) fails closed with 503, nothing read (TC-25)', async () => {
    const h = build();
    h.allowAll();
    h.pg.accountError = pgError('42501');
    for (const path of ENDPOINTS) {
      const res = await request(h.app).get(path).set('Cookie', ADMIN);
      expect([res.status, res.body.error.code]).toEqual([503, 'SERVICE_BUSY']);
    }
    expect(moduleSql(h.pg).every((s) => s === DATA_INSPECTOR_SQL.adminAccount)).toBe(true);
  });

  it('IAM: no grant → 403 + Host DENIED audit; admin with Direct DENY → 403; nothing reaches the database (TC-16 / TC-17)', async () => {
    const h = build();
    for (const path of ENDPOINTS) expect((await request(h.app).get(path).set('Cookie', ADMIN)).status).toBe(403);
    expect(h.access.audits.map((a) => [a.actionCode, a.targetType, a.outcome])).toEqual([
      ['DATA_INSPECTOR.CATALOG.READ', 'DATA_INSPECTOR_API', 'DENIED'], ['DATA_INSPECTOR.CATALOG.READ', 'DATA_INSPECTOR_API', 'DENIED'],
      ['DATA_INSPECTOR.ROWS.READ', 'DATA_INSPECTOR_API', 'DENIED'],
    ]);
    h.allowAll();
    h.access.denied.add(DATA_INSPECTOR_BINDING.catalogRead.permissionCode);
    h.access.denied.add(DATA_INSPECTOR_BINDING.rowsRead.permissionCode);
    for (const path of ENDPOINTS) expect((await request(h.app).get(path).set('Cookie', ADMIN)).status).toBe(403);
    expect(h.pg.log).toEqual([]);
    // ROWS.READ alone does not open the catalog (and vice versa).
    const only = build();
    only.access.allowed.add(DATA_INSPECTOR_BINDING.rowsRead.permissionCode);
    expect((await request(only.app).get('/api/data-inspector/tables').set('Cookie', ADMIN)).status).toBe(403);
  });

  it('session: none → 401, activation session → 403 PASSWORD_CHANGE_REQUIRED; nothing read (TC-18)', async () => {
    const h = build();
    h.allowAll();
    for (const path of ENDPOINTS) {
      expect((await request(h.app).get(path)).status).toBe(401);
      const act = await request(h.app).get(path).set('Cookie', `talo_sid=${token('activation')}`);
      expect([act.status, act.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
    }
    expect(h.pg.log).toEqual([]);
  });

  it('lifecycle: not registered / DISABLED / 0 or 2 ACTIVE versions → 503 before the account gate (TC-19)', async () => {
    for (const state of [null, { is_enabled: false, active_versions: 1 }, { is_enabled: true, active_versions: 0 }, { is_enabled: true, active_versions: 2 }]) {
      const h = build();
      h.allowAll();
      h.pg.lifecycle = state;
      for (const path of ENDPOINTS) {
        const res = await request(h.app).get(path).set('Cookie', ADMIN);
        expect([res.status, res.body.error.code]).toEqual([503, 'SERVICE_BUSY']);
      }
      expect(h.pg.sqls()).toEqual([HOST_SQL.lifecycle, HOST_SQL.lifecycle, HOST_SQL.lifecycle]);
    }
  });

  it('a Host transaction that is not READ ONLY is refused by the Host: nothing read', async () => {
    const h = build();
    h.allowAll();
    h.pg.readOnlyOn = false;
    expect((await request(h.app).get('/api/data-inspector/tables').set('Cookie', ADMIN)).status).toBe(503);
    expect(h.pg.sqls()).not.toContain(DATA_INSPECTOR_SQL.adminAccount);
  });

  it('no write method exists: POST / PUT / PATCH / DELETE → 404, no database use (TC-10)', async () => {
    const h = build();
    h.allowAll();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      for (const path of ENDPOINTS) {
        const res = await request(h.app)[method](path).set('Cookie', ADMIN).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').send('{}');
        expect(res.status).toBe(404);
      }
    }
    expect(h.pg.log).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------- columns and rows
describe('structure and rows (TC-02 / TC-03 / TC-09 / TC-12 … TC-15, TC-24)', () => {
  it('columns: type, nullable, primary key, column SELECT right; also for a NOT_READABLE table (metadata only)', async () => {
    const h = build();
    h.allowAll();
    const res = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/columns`).set('Cookie', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tableKey: MODULES_KEY, schema: 'foundation', table: 'fnd_modules', readStatus: 'READABLE' });
    expect(res.body.columns[0]).toEqual({ name: 'module_id', dataType: 'uuid', ordinalPosition: 1, nullable: false, primaryKey: true, selectPrivilege: true, masking: 'NONE' });
    const locked = await request(h.app).get(`/api/data-inspector/tables/${CREDENTIALS_KEY}/columns`).set('Cookie', ADMIN);
    expect(locked.status).toBe(200);
    expect(locked.body.readStatus).toBe('NOT_READABLE');
    expect(locked.body.columns.map((c: { selectPrivilege: boolean }) => c.selectPrivilege)).toEqual([false, false]);
  });

  it('rows: default page 1 / 50 (LIMIT 51 OFFSET 0), page 3 / 100 (LIMIT 101 OFFSET 200), hasNext, PK order, NULL kept', async () => {
    const h = build();
    h.allowAll();
    h.pg.pageRows = Array.from({ length: 120 }, (_, i) => ({ c0: `id-${i}`, c1: `KEY_${i}`, c2: i % 2 === 0 ? null : '{"a":1}' }));
    const first = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      page: 1, pageSize: 50, hasNext: true, columns: ['module_id', 'module_key', 'manifest'], columnTypes: ['uuid', 'text', 'jsonb'], readStatus: 'READABLE',
      ordering: 'PRIMARY_KEY', orderBy: ['module_id'], rowVisibility: 'DB_ROLE_AND_RLS', rowSecurity: false, columnsLimited: false,
    });
    expect(first.body.rows).toHaveLength(50);
    expect(first.body.rows[0]).toEqual({ cells: ['id-0', 'KEY_0', null] });
    const pageQuery = (pg: FakePg) => pg.log.filter((l) => isPage(l.sql)).at(-1);
    expect(pageQuery(h.pg)?.params).toEqual([51, 0]);
    expect(pageQuery(h.pg)?.sql).toContain('FROM "foundation"."fnd_modules" AS t ORDER BY t."module_id" LIMIT $1 OFFSET $2');
    const last = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows?page=3&pageSize=50`).set('Cookie', ADMIN);
    expect([last.body.rows.length, last.body.hasNext]).toEqual([20, false]);
    await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows?page=3&pageSize=100`).set('Cookie', ADMIN);
    expect(pageQuery(h.pg)?.params).toEqual([101, 200]);
  });

  it('paging validation: pageSize > 100, 0, negative, non-numeric, repeated, unknown parameter → 400 (TC-12)', async () => {
    const h = build();
    h.allowAll();
    for (const q of ['pageSize=101', 'pageSize=0', 'page=0', 'page=-1', 'page=1.5', 'pageSize=abc', 'page=100001', 'page=1&page=2', 'sql=SELECT%201', 'q=x', 'pageSize=1e2']) {
      const res = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows?${q}`).set('Cookie', ADMIN);
      expect([q, res.status, res.body.error?.code]).toEqual([q, 400, 'VALIDATION_ERROR']);
    }
    expect(h.pg.sqls().some((s) => isPage(s))).toBe(false);
  });

  it('a non-admin never reaches paging validation or the table key check (403 before 400 / 404)', async () => {
    const h = build();
    h.allowAll();
    for (const path of [`/api/data-inspector/tables/${MODULES_KEY}/rows?pageSize=999`, '/api/data-inspector/tables/garbage/rows', '/api/data-inspector/tables/garbage/columns']) {
      expect((await request(h.app).get(path).set('Cookie', OTHER)).status).toBe(403);
    }
  });

  it('NOT_READABLE table → 403 TABLE_NOT_READABLE without a data query; PARTIAL → only the granted columns (TC-08 / TC-14)', async () => {
    const h = build();
    h.allowAll();
    const denied = await request(h.app).get(`/api/data-inspector/tables/${CREDENTIALS_KEY}/rows`).set('Cookie', ADMIN);
    expect([denied.status, denied.body.error.code]).toEqual([403, 'TABLE_NOT_READABLE']);
    expect(h.pg.sqls().some((s) => isPage(s))).toBe(false);
    h.pg.pageRows = [{ c0: 'admin', c1: 'ACTIVE' }];
    const partial = await request(h.app).get(`/api/data-inspector/tables/${ACCOUNTS_KEY}/rows`).set('Cookie', ADMIN);
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ readStatus: 'PARTIAL', columns: ['username', 'account_status'], ordering: 'UNSTABLE_NO_KEY', orderBy: [] });
    const sql = h.pg.sqls().filter((s) => isPage(s)).at(-1) ?? '';
    expect(sql).not.toContain('user_account_id'); // the PK column without SELECT is neither selected nor used for ORDER BY
  });

  it('SQLSTATE 42501 during the read → 403 TABLE_NOT_READABLE; 57014 (statement timeout) → 503 QUERY_TIMEOUT; other → 503', async () => {
    const h = build();
    h.allowAll();
    h.pg.pageError = pgError('42501');
    expect((await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN)).body.error.code).toBe('TABLE_NOT_READABLE');
    h.pg.pageError = pgError('57014');
    const timeout = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN);
    expect([timeout.status, timeout.body.error.code]).toEqual([503, 'QUERY_TIMEOUT']);
    h.pg.pageError = pgError('08006');
    expect((await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN)).body.error.code).toBe('SERVICE_BUSY');
  });

  it('RLS table: rows are those the role sees, flagged; partitioned parent readable; no PK → unstable order, no ORDER BY (TC-13)', async () => {
    const h = build();
    h.allowAll();
    h.pg.pageRows = [{ c0: '\\x00ff', c1: null }];
    const res = await request(h.app).get(`/api/data-inspector/tables/${EVENTS_KEY}/rows`).set('Cookie', ADMIN);
    expect(res.body).toMatchObject({ rowSecurity: true, rowVisibility: 'DB_ROLE_AND_RLS', ordering: 'UNSTABLE_NO_KEY', columnTypes: ['bytea', 'text'] });
    expect(h.pg.sqls().filter((s) => isPage(s)).at(-1)).not.toContain('ORDER BY');
  });

  it('stale keys: renamed / moved (digest mismatch) or dropped OID → 409 CATALOG_CHANGED; malformed or not a table → 404 (TC-15)', async () => {
    const h = build();
    h.allowAll();
    const renamed = keyOf('16400', 'foundation', 'fnd_modules_old');
    const dropped = keyOf('99999', 'foundation', 'gone');
    const view = keyOf('16900', 'public', 'a_view', 'v');
    for (const [key, status, code] of [
      [renamed, 409, 'CATALOG_CHANGED'], [dropped, 409, 'CATALOG_CHANGED'], [view, 404, 'TABLE_NOT_FOUND'], ['B01', 404, 'TABLE_NOT_FOUND'],
    ] as const) {
      for (const suffix of ['columns', 'rows']) {
        const res = await request(h.app).get(`/api/data-inspector/tables/${encodeURIComponent(key)}/${suffix}`).set('Cookie', ADMIN);
        expect([key, suffix, res.status, res.body.error?.code]).toEqual([key, suffix, status, code]);
      }
    }
  });

  it('injection payloads in the table key never reach SQL text; catalog names are quoted (TC-24)', async () => {
    const h = build();
    h.allowAll();
    for (const bad of ["t_1_0123456789abcdef' OR '1'='1", 'foundation.fnd_modules; DROP TABLE iam.iam_credentials', '"; SELECT pg_sleep(10); --', '%27%3B']) {
      const res = await request(h.app).get(`/api/data-inspector/tables/${encodeURIComponent(bad)}/rows`).set('Cookie', ADMIN);
      expect(res.status).toBe(404);
    }
    for (const l of h.pg.log) {
      expect(l.sql).not.toMatch(/OR '1'='1|pg_sleep|iam_credentials/);
    }
    h.pg.pageRows = [{ c0: '1', c1: '<script>alert(1)</script>' }];
    const odd = await request(h.app).get(`/api/data-inspector/tables/${ODD_KEY}/rows`).set('Cookie', ADMIN);
    expect(odd.status).toBe(200);
    expect(odd.body.rows[0].cells).toEqual(['1', '<script>alert(1)</script>']); // returned as JSON text; the UI renders it as text
    expect(h.pg.sqls().filter((s) => isPage(s)).at(-1)).toContain('FROM "odd"."we""ird; DROP TABLE x; --" AS t ORDER BY t."c0"');
  });

  it('long values are cut at CELL_MAX_CHARS characters (code points) and marked; nothing of the rows is logged', async () => {
    const h = build();
    h.allowAll();
    const long = 'x'.repeat(CELL_MAX_CHARS + 1);
    const emoji = '😀'.repeat(CELL_MAX_CHARS); // 1000 code points = 2000 UTF-16 units: not cut
    // Text columns here (a jsonb column would be parsed / masked by FIX-01, see below).
    h.pg.cols.set('16400', [{ name: 'module_id', type: 'uuid', pk: true }, { name: 'module_key', type: 'text' }, { name: 'note', type: 'text' }]);
    h.pg.pageRows = [{ c0: 'id-SECRETVALUE', c1: long, c2: emoji }];
    const res = await request(h.app).get(`/api/data-inspector/tables/${MODULES_KEY}/rows`).set('Cookie', ADMIN);
    expect(res.body.rows[0].truncated).toEqual([1]);
    expect(res.body.rows[0].cells[1]).toHaveLength(CELL_MAX_CHARS);
    expect(res.body.rows[0].cells[2]).toBe(emoji);
    expect(res.body.cellMaxChars).toBe(CELL_MAX_CHARS);
    expect(h.logs.join('\n')).not.toContain('SECRETVALUE');
    expect(h.logs.some((l) => l.includes('DATA_INSPECTOR.ROWS.READ'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------ FIX-01 masking
// Canary values: fake secrets that must never appear in any response body (serialised JSON), log line or SQL text.
const CANARY = {
  password: 'CANARY-PASSWORD-HASH-7f3a', session: 'CANARY-SESSION-TOKEN-91bc', api: 'CANARY-API-KEY-55d0', secret: 'CANARY-CLIENT-SECRET-0e42',
  json: 'CANARY-JSON-NESTED-a1b2', jsonArray: 'CANARY-JSON-ARRAY-c3d4', refresh: 'CANARY-REFRESH-TOKEN-e5f6', options: 'CANARY-UMOPTIONS-1234',
} as const;
const CANARIES = Object.values(CANARY);

function withSecretTables(h: ReturnType<typeof build>) {
  h.pg.rels.push(
    { oid: '18000', schema: 'iam', table: 'iam_credentials_fx', relkind: 'r' },
    { oid: '18100', schema: 'iam', table: 'iam_sessions_fx', relkind: 'r' },
    { oid: '18200', schema: 'billing', table: 'integrations', relkind: 'r' },
  );
  h.pg.cols.set('18000', [
    { name: 'credential_id', type: 'uuid', pk: true }, { name: 'password_hash', type: 'text' }, { name: 'password_changed_at', type: 'timestamp with time zone' },
    { name: 'must_change_password', type: 'boolean' }, { name: 'failed_attempt_count', type: 'integer' },
  ]);
  h.pg.cols.set('18100', [
    { name: 'session_id', type: 'uuid', pk: true }, { name: 'session_token_hash', type: 'text' }, { name: 'refreshToken', type: 'character varying(200)' },
  ]);
  h.pg.cols.set('18200', [
    { name: 'id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'api_key', type: 'text' }, { name: 'client_secret', type: 'text' },
    { name: 'settings', type: 'jsonb' }, { name: 'umoptions', type: 'text[]' },
  ]);
  return {
    credentials: keyOf('18000', 'iam', 'iam_credentials_fx'),
    sessions: keyOf('18100', 'iam', 'iam_sessions_fx'),
    integrations: keyOf('18200', 'billing', 'integrations'),
  };
}

describe('FIX-01 sensitive data masking', () => {
  it('name rule: secrets masked in every schema; descriptors, booleans, timestamps, counters and ids are not', () => {
    for (const [name, type] of [
      ['password', 'text'], ['password_hash', 'text'], ['passwd', 'text'], ['session_token', 'text'], ['session_token_hash', 'text'],
      ['verification_token_hash', 'text'], ['access_token', 'text'], ['refresh_token', 'text'], ['refreshToken', 'character varying(200)'],
      ['auth_token', 'text'], ['secret', 'text'], ['client_secret', 'text'], ['clientSecret', 'text'], ['api_key', 'text'], ['apiKey', 'text'],
      ['API_KEY', 'text'], ['private_key', 'bytea'], ['privateKey', 'text'], ['rolpassword', 'text'], ['subconninfo', 'text'], ['umoptions', 'text[]'],
      ['credentials', 'jsonb'], ['otp_seed', 'text'], ['token', 'uuid'], ['metadata', 'jsonb[]'],
    ] as const) expect([name, maskModeOf(name, type)]).toEqual([name, 'FULL']);
    for (const [name, type] of [
      ['password_changed_at', 'timestamp with time zone'], ['must_change_password', 'boolean'], ['failed_attempt_count', 'integer'],
      ['subpasswordrequired', 'boolean'], ['credential_id', 'uuid'], ['token_id', 'uuid'], ['session_id', 'uuid'], ['manifest_hash', 'character(64)'],
      ['username', 'character varying(80)'], ['full_name', 'character varying(200)'], ['email', 'character varying(320)'], ['module_key', 'text'],
      ['primary_key', 'boolean'], ['description', 'text'],
    ] as const) expect([name, maskModeOf(name, type)]).toEqual([name, 'NONE']);
    expect([maskModeOf('metadata', 'jsonb'), maskModeOf('manifest_json', 'json')]).toEqual(['JSON_KEYS', 'JSON_KEYS']);
    for (const key of ['primaryKey', 'resourceKey', 'moduleKey', 'ownerKey', 'functionKey', 'hashAlgorithm', 'tokenId']) expect([key, isSensitiveName(key)]).toEqual([key, false]);
  });

  it('JSON: nested keys masked recursively (objects, arrays); clean JSON unchanged; invalid or too long JSON masked whole', () => {
    const nested = JSON.stringify({ a: { b: { password: CANARY.json } }, list: [{ apiKey: CANARY.jsonArray }, 1], ok: 'visible', n: null });
    const r = maskJsonText(nested);
    expect(r.masked).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ a: { b: { password: MASK } }, list: [{ apiKey: MASK }, 1], ok: 'visible', n: null });
    expect(maskJsonText('{"tokens": {"x": 1}}').text).toBe(JSON.stringify({ tokens: MASK })); // a whole sub-tree under a secret key
    const clean = '{"moduleKey": "X", "primaryKey": true}';
    expect(maskJsonText(clean)).toEqual({ text: clean, masked: false });
    expect(maskJsonText('{"password": "x"')).toEqual({ text: MASK, masked: true });
    expect(maskJsonText(`"${'x'.repeat(JSON_PARSE_MAX_CHARS + 1)}"`)).toEqual({ text: MASK, masked: true });
    expect(maskJsonText('{"password":"a","password":"b"}').text).toBe(JSON.stringify({ password: MASK })); // duplicate keys
  });

  it('page SQL never reads a FULL-masked column; masking is in the SELECT list, not in the frontend', () => {
    const sql = pageSql('iam', 'iam_credentials', ['credential_id', 'password_hash', 'settings'], ['credential_id'], ['NONE', 'FULL', 'JSON_KEYS']);
    expect(sql).toContain(`'${MASK}'::text AS "c1"`);
    expect(sql).not.toContain('password_hash');
    expect(sql).toContain(`pg_catalog.left(t."settings"::text, ${JSON_PARSE_MAX_CHARS + 1}) AS "c2"`);
    expect(sql).not.toMatch(WRITE);
  });

  it('rows API: password / session token / api key / client secret / umoptions → [MASKED] (also NULL and empty); normal columns intact; no canary in the JSON body', async () => {
    const h = build();
    h.allowAll();
    const keys = withSecretTables(h);
    // The fake returns the canaries even for the masked aliases: the backend must mask regardless of what SQL returned.
    h.pg.pageRows = [{ c0: 'cred-1', c1: CANARY.password, c2: '2026-10-01 10:00:00+07', c3: 'true', c4: '0' }];
    const cred = await request(h.app).get(`/api/data-inspector/tables/${keys.credentials}/rows`).set('Cookie', ADMIN);
    expect(cred.status).toBe(200);
    expect(cred.body.rows[0]).toEqual({ cells: ['cred-1', MASK, '2026-10-01 10:00:00+07', 'true', '0'], masked: [1] });
    expect(cred.body.columnMasking).toEqual(['NONE', 'FULL', 'NONE', 'NONE', 'NONE']);
    expect(cred.body.columns).toContain('password_hash'); // metadata kept
    expect(h.pg.sqls().filter(isPage).at(-1)).not.toContain('password_hash');

    h.pg.pageRows = [{ c0: 'sess-1', c1: CANARY.session, c2: CANARY.refresh }];
    const sess = await request(h.app).get(`/api/data-inspector/tables/${keys.sessions}/rows`).set('Cookie', ADMIN);
    expect(sess.body.rows[0].cells).toEqual(['sess-1', MASK, MASK]);

    const settings = JSON.stringify({ region: 'vn', auth: { client_secret: CANARY.secret }, hooks: [{ access_token: CANARY.json }] });
    h.pg.pageRows = [
      { c0: '1', c1: 'ERP', c2: CANARY.api, c3: CANARY.secret, c4: settings, c5: `{user=a,password=${CANARY.options}}` },
      { c0: '2', c1: 'Empty', c2: null, c3: '', c4: null, c5: null },
    ];
    const integ = await request(h.app).get(`/api/data-inspector/tables/${keys.integrations}/rows`).set('Cookie', ADMIN);
    expect(integ.body.columnMasking).toEqual(['NONE', 'NONE', 'FULL', 'FULL', 'JSON_KEYS', 'FULL']);
    const [first, second] = integ.body.rows as { cells: (string | null)[]; masked?: number[] }[];
    expect(first?.cells.slice(0, 4)).toEqual(['1', 'ERP', MASK, MASK]);
    expect(JSON.parse(first?.cells[4] ?? 'null')).toEqual({ region: 'vn', auth: { client_secret: MASK }, hooks: [{ access_token: MASK }] });
    expect(first?.cells[5]).toBe(MASK);
    expect(first?.masked).toEqual([2, 3, 4, 5]);
    expect(second).toEqual({ cells: ['2', 'Empty', MASK, MASK, null, MASK], masked: [2, 3, 5] }); // NULL / '' of a secret column: always [MASKED]

    for (const res of [cred, sess, integ]) {
      const body = JSON.stringify(res.body);
      for (const c of CANARIES) expect(body.includes(c)).toBe(false);
    }
    const logText = h.logs.join('\n');
    for (const c of CANARIES) expect(logText.includes(c)).toBe(false);
  });

  it('columns API: metadata shown normally with the masking mode; no value is returned', async () => {
    const h = build();
    h.allowAll();
    const keys = withSecretTables(h);
    const res = await request(h.app).get(`/api/data-inspector/tables/${keys.integrations}/columns`).set('Cookie', ADMIN);
    expect(res.body.columns.map((c: { name: string; dataType: string; masking: string }) => [c.name, c.dataType, c.masking])).toEqual([
      ['id', 'integer', 'NONE'], ['name', 'text', 'NONE'], ['api_key', 'text', 'FULL'], ['client_secret', 'text', 'FULL'], ['settings', 'jsonb', 'JSON_KEYS'],
      ['umoptions', 'text[]', 'FULL'],
    ]);
  });

  it('masking cannot be switched off by query parameters, headers or another route', async () => {
    const h = build();
    h.allowAll();
    const keys = withSecretTables(h);
    h.pg.pageRows = [{ c0: 'cred-1', c1: CANARY.password, c2: null, c3: 'false', c4: '1' }];
    for (const q of ['mask=false', 'unmask=1', 'masking=NONE', 'raw=true', 'columns=password_hash', 'debug=1']) {
      const res = await request(h.app).get(`/api/data-inspector/tables/${keys.credentials}/rows?${q}`).set('Cookie', ADMIN);
      expect([q, res.status, res.body.error?.code]).toEqual([q, 400, 'VALIDATION_ERROR']);
      expect(JSON.stringify(res.body).includes(CANARY.password)).toBe(false);
    }
    const res = await request(h.app).get(`/api/data-inspector/tables/${keys.credentials}/rows`).set('Cookie', ADMIN)
      .set('X-Unmask', '1').set('X-Debug', 'true');
    expect(res.body.rows[0].cells[1]).toBe(MASK);
    for (const path of [`/api/data-inspector/tables/${keys.credentials}/raw`, `/api/data-inspector/tables/${keys.credentials}/rows/unmasked`, '/api/data-inspector/unmasked']) {
      expect((await request(h.app).get(path).set('Cookie', ADMIN)).status).toBe(404);
    }
  });

  it('database errors carrying a secret in their message do not leak it (response, logs)', async () => {
    const h = build();
    h.allowAll();
    const keys = withSecretTables(h);
    for (const code of ['42501', '57014', '22P02', 'XX000']) {
      h.pg.pageError = Object.assign(new Error(`invalid input "${CANARY.password}" detail ${CANARY.secret}`), { code, detail: CANARY.secret });
      const res = await request(h.app).get(`/api/data-inspector/tables/${keys.credentials}/rows`).set('Cookie', ADMIN);
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = JSON.stringify(res.body);
      expect(body.includes(CANARY.password) || body.includes(CANARY.secret)).toBe(false);
    }
    const logText = h.logs.join('\n');
    expect(logText.includes(CANARY.password) || logText.includes(CANARY.secret)).toBe(false);
  });
});
