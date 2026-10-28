import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLLED_PROJECTIONS, CONTROLLED_SQL, categoryOf, controlledProjectionOf } from '../backend/data-inspector.controlled.js';
import { DataInspectorError, DataInspectorService, accessOf } from '../backend/data-inspector.service.js';
import { DATA_INSPECTOR_BINDING } from '../backend/data-inspector.permissions.js';
import { DATA_INSPECTOR_SQL, tableKeyOf } from '../backend/data-inspector.sql.js';
import { AuditError, SystemAuditService } from '../backend/system-audit.service.js';
import type { ModuleHost } from '../backend/host.js';

// SCC 0.1.2 — controlled reads in Data Inspection, catalog classification and MODULE_UNAVAILABLE.
const root = join(import.meta.dirname, '..');
const actor = { userAccountId: '00000000-0000-4000-8000-000000000001', assuranceLevel: 1, requestId: 'REQ-012' };
const dbError = (code: string) => Object.assign(new Error(`db ${code}`), { code });
type Query = (sql: string, args: readonly unknown[]) => Promise<unknown[]>;

function relationRow(schema: string, table: string, oid = '4242', select = true) {
  return { relation_oid: oid, schema_name: schema, table_name: table, relkind: 'r', row_security: false, schema_usage: true, table_select: select };
}
function keyOf(schema: string, table: string, oid = '4242') { return tableKeyOf({ oid, schema, table, relkind: 'r' }); }
function service(query: Query, lifecycle = { isEnabled: true, activeVersions: 1 }, warnings: unknown[] = []) {
  const host = {
    authorize: async () => undefined,
    lifecycle: async () => lifecycle,
    readOnly: async <T,>(fn: (tx: { query: Query }) => Promise<T>): Promise<T> => fn({ query }),
    logger: { info: () => undefined, warn: (m: string, x: unknown) => warnings.push({ m, x }), error: () => undefined },
  } as unknown as ModuleHost;
  return new DataInspectorService({ host, binding: DATA_INSPECTOR_BINDING });
}
// tx.query dispatcher: catalog lookups answer from `rel`, everything else goes to `data`.
function dispatcher(rel: ReturnType<typeof relationRow>, data: Query, seen: string[] = []): Query {
  return async (sql, args) => {
    seen.push(sql);
    if (sql === DATA_INSPECTOR_SQL.relation) return [rel];
    if (sql === DATA_INSPECTOR_SQL.columns) return [{ ordinal_position: 1, column_name: 'x', data_type: 'text', nullable: true, primary_key: true, select_privilege: true }];
    return data(sql, args);
  };
}

describe('SCC 0.1.2 controlled projections', () => {
  it('never names a secret column and never reads the two Foundation tables directly', () => {
    const all = Object.values(CONTROLLED_SQL).join('\n');
    for (const secret of ['session_token_hash', 'password_hash', 'verification_token_hash', 'employee_id', 'before_state', 'after_state']) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toMatch(/FROM\s+foundation\.fnd_module_events/i);
    expect(all).not.toMatch(/FROM\s+foundation\.fnd_data_access_rules/i);
    expect(CONTROLLED_SQL.moduleEvents).toContain('foundation_read_api.read_module_events(');
    expect(CONTROLLED_SQL.dataAccessRules).toContain('foundation_read_api.read_data_access_rules(');
    expect(all).not.toMatch(/SELECT\s+\*/i);
    for (const p of CONTROLLED_PROJECTIONS) expect(p.columns.every((c) => !p.withheld.includes(c.name))).toBe(true);
  });

  it('matches the approved IAM policy column by column (memberships / sessions)', () => {
    const cols = (key: string) => CONTROLLED_PROJECTIONS.find((p) => p.key === key)?.columns.map((c) => c.name);
    expect(cols('IAM_MEMBERSHIPS')).toEqual(['membership_id', 'employee_code', 'full_name', 'membership_status', 'joined_at', 'left_at', 'created_at', 'linked_accounts']);
    expect(cols('IAM_SESSION_METADATA')).toEqual(['session_id', 'username', 'user_account_id', 'session_state', 'assurance_level', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at']);
    // Every selected expression is named in the projection: nothing else can leave the query.
    for (const [key, sql] of [['IAM_MEMBERSHIPS', CONTROLLED_SQL.memberships], ['IAM_SESSION_METADATA', CONTROLLED_SQL.sessions]] as const) {
      const aliases = [...sql.matchAll(/\bAS\s+([a-z_]+)\s*(?:,|\n\s+FROM)/g)].map((m) => m[1]);
      expect(aliases).toEqual(cols(key));
      expect(sql).not.toMatch(/token|password|cookie|secret|refresh|credential|employee_id/i);
    }
    // 0.1.2 adds no write path: the controlled SQL is SELECT only.
    expect(Object.values(CONTROLLED_SQL).every((s) => /^\s*SELECT\b/i.test(s) && !/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT)\b/i.test(s))).toBe(true);
  });

  it('classifies catalogs and access paths on the server', () => {
    expect(categoryOf('pg_catalog')).toBe('SYSTEM_CATALOG');
    expect(categoryOf('information_schema')).toBe('SYSTEM_CATALOG');
    expect(categoryOf('foundation')).toBe('BUSINESS');
    expect(accessOf('foundation', 'fnd_module_events', 'NOT_READABLE')).toBe('CONTROLLED');
    expect(accessOf('foundation', 'fnd_data_access_rules', 'NOT_READABLE')).toBe('CONTROLLED');
    expect(accessOf('iam', 'iam_memberships', 'READABLE')).toBe('CONTROLLED');
    expect(accessOf('iam', 'iam_sessions', 'READABLE')).toBe('CONTROLLED');
    expect(accessOf('iam', 'iam_credentials', 'READABLE')).toBe('PROTECTED');
    expect(accessOf('iam', 'iam_account_verifications', 'NOT_READABLE')).toBe('PROTECTED');
    expect(accessOf('iam', 'iam_audit_logs', 'NOT_READABLE')).toBe('PROTECTED');
    expect(accessOf('foundation', 'fnd_audit_logs', 'NOT_READABLE')).toBe('NOT_READABLE');
    expect(accessOf('foundation', 'fnd_modules', 'READABLE')).toBe('DIRECT');
    expect(controlledProjectionOf('iam', 'iam_credentials')).toBeUndefined();
  });

  it('serves a controlled page with its projection, bound parameters and hasNext', async () => {
    const seen: string[] = [];
    let bound: readonly unknown[] = [];
    const svc = service(dispatcher(relationRow('iam', 'iam_sessions'), async (_sql, args) => {
      bound = args;
      return [1, 2, 3].map((i) => ({ session_id: `s${i}`, username: 'admin', user_account_id: 'u', session_state: 'ACTIVE', assurance_level: '1',
        created_at: 't', last_seen_at: null, expires_at: 't', revoked_at: null }));
    }, seen));
    const view = await svc.rows(actor, keyOf('iam', 'iam_sessions'), { page: '1', pageSize: '2' });
    expect(view.access).toBe('CONTROLLED');
    expect(view.projection?.withheldColumns).toEqual(['session_token_hash']);
    expect(view.readStatus).toBe('PARTIAL');
    expect(view.rows).toHaveLength(2);
    expect(view.hasNext).toBe(true);
    expect(view.columns).not.toContain('session_token_hash');
    expect(bound).toEqual([3, 0]);
    expect(seen.some((s) => s === CONTROLLED_SQL.sessions)).toBe(true);
  });

  it('module events use the 366-day window of the database reader', async () => {
    let bound: readonly unknown[] = [];
    const svc = service(dispatcher(relationRow('foundation', 'fnd_module_events', '4242', false), async (_sql, args) => { bound = args; return []; }));
    const view = await svc.rows(actor, keyOf('foundation', 'fnd_module_events'), {});
    expect(view.access).toBe('CONTROLLED');
    expect(view.projection?.source).toBe('DB_FUNCTION');
    const [limit, offset, from, to] = bound as [number, number, string, string];
    expect([limit, offset]).toEqual([51, 0]);
    expect(Date.parse(to) - Date.parse(from)).toBe(366 * 86_400_000);
  });

  it('a missing / not executable reader is CONTROLLED_READ_UNAVAILABLE, never a raw fallback', async () => {
    for (const code of ['42883', '3F000', '42501']) {
      const seen: string[] = [];
      const svc = service(dispatcher(relationRow('foundation', 'fnd_data_access_rules', '4242', false), async () => { throw dbError(code); }, seen));
      await expect(svc.rows(actor, keyOf('foundation', 'fnd_data_access_rules'), {})).rejects.toMatchObject({ status: 503, code: 'CONTROLLED_READ_UNAVAILABLE' });
      expect(seen.some((s) => /FROM\s+"foundation"\."fnd_data_access_rules"/.test(s))).toBe(false);
    }
  });

  it('keeps credentials and verifications protected', async () => {
    for (const table of ['iam_credentials', 'iam_account_verifications', 'iam_user_accounts']) {
      const svc = service(dispatcher(relationRow('iam', table), async () => { throw new Error('must not read'); }));
      await expect(svc.rows(actor, keyOf('iam', table), {})).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_DATA_PROTECTED' });
    }
  });

  it('refuses a page beyond the reader offset bound', async () => {
    const svc = service(dispatcher(relationRow('foundation', 'fnd_module_events', '4242', false), async () => []));
    await expect(svc.rows(actor, keyOf('foundation', 'fnd_module_events'), { page: '2002', pageSize: '50' }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('labels the catalog with category and access', async () => {
    const svc = service(async (sql) => {
      if (sql !== DATA_INSPECTOR_SQL.catalog) throw new Error('unexpected');
      return [
        { ...relationRow('foundation', 'fnd_modules', '1'), any_column_select: true },
        { ...relationRow('foundation', 'fnd_module_events', '2', false), any_column_select: false },
        { ...relationRow('pg_catalog', 'pg_class', '3'), any_column_select: true },
      ];
    });
    const view = await svc.tables(actor);
    expect(view.tables.map((t) => [t.table, t.category, t.access])).toEqual([
      ['fnd_modules', 'BUSINESS', 'DIRECT'], ['fnd_module_events', 'BUSINESS', 'CONTROLLED'], ['pg_class', 'SYSTEM_CATALOG', 'DIRECT'],
    ]);
  });
});

describe('SCC 0.1.2 MODULE_UNAVAILABLE when the module is disabled', () => {
  it('Data Inspection and Audit Logs answer 503 MODULE_UNAVAILABLE (not SERVICE_BUSY)', async () => {
    const svc = service(async () => { throw new Error('must not read'); }, { isEnabled: false, activeVersions: 1 });
    await expect(svc.tables(actor)).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
    await expect(svc.rows(actor, keyOf('foundation', 'fnd_modules'), {})).rejects.toBeInstanceOf(DataInspectorError);
    const host = { authorize: async () => undefined, lifecycle: async () => ({ isEnabled: false, activeVersions: 1 }), logger: { warn: () => undefined } } as unknown as ModuleHost;
    await expect(new SystemAuditService(host).list(actor, {})).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
    const failing = { authorize: async () => undefined, lifecycle: async () => { throw new Error('db down'); }, logger: { warn: () => undefined } } as unknown as ModuleHost;
    await expect(new SystemAuditService(failing).list(actor, {})).rejects.toBeInstanceOf(AuditError);
    await expect(new SystemAuditService(failing).list(actor, {})).rejects.toMatchObject({ code: 'SERVICE_BUSY' });
  });
});

describe('SCC 0.1.2 contract and database proposal', () => {
  const mic = JSON.parse(readFileSync(join(root, 'mic', 'module.mic.json'), 'utf8')) as {
    mic01Identity: { moduleVersion: string }; mic09Compatibility: { kind: string; fromVersion?: string };
    mic06DataResources: { resourceKey: string; access: { functionKey: string; actionKey: string; operation: string }[] }[];
  };
  it('declares 0.1.2 as a CHANGE from 0.1.1 with four ROWS.READ resources', () => {
    expect(mic.mic01Identity.moduleVersion).toBe('0.1.2');
    expect(mic.mic09Compatibility).toMatchObject({ kind: 'CHANGE', fromVersion: '0.1.1' });
    for (const key of ['SYSTEM_MODULE_EVENTS', 'SYSTEM_DATA_ACCESS_RULES', 'IAM_MEMBERSHIP_ADMIN_VIEW', 'IAM_SESSION_METADATA']) {
      const r = mic.mic06DataResources.find((x) => x.resourceKey === key);
      expect(r?.access).toEqual([expect.objectContaining({ functionKey: 'ROWS', actionKey: 'READ', operation: 'SELECT' })]);
    }
  });
  it('database proposal: definer readers, EXECUTE to talo_app only, no table SELECT for talo_app', () => {
    const dir = join(root, 'database', 'foundation-read');
    const grants = readFileSync(join(dir, '02-grant-owner-test-database.sql'), 'utf8');
    const functions = readFileSync(join(dir, '03-create-functions-test-database.sql'), 'utf8');
    const statements = `${grants}\n${functions}`.split(';').map((s) => s.trim());
    expect(functions.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(functions.match(/session_user <> 'talo_app'/g)).toHaveLength(2);
    expect(functions).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC/i);
    expect(statements.filter((s) => /^GRANT\s+SELECT/i.test(s) && /\bTO\s+talo_app\b/i.test(s))).toEqual([]);
    expect(statements.filter((s) => /^GRANT\s+SELECT/i.test(s)).every((s) => /TO talo_foundation_reader$/.test(s))).toBe(true);
    expect(functions).not.toMatch(/RETURNS TABLE[^)]*jsonb/i);
  });
});
