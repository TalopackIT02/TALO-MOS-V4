import { createHash } from 'node:crypto';
import { MASK } from './data-inspector.masking.js';
import type { MaskMode } from './data-inspector.masking.js';

// DATA_INSPECTOR — every statement of the module (spec v0.2 §05). SELECT only, always inside the Host's READ ONLY
// transaction (statement timeout 5 s). Values (account id, OID, LIMIT / OFFSET) travel as bind parameters. The only
// dynamic SQL is the page SELECT, whose schema / table / column identifiers are taken from pg_catalog on the server
// (re-resolved by OID for every request) and double-quoted here; nothing from the request is ever put into SQL text.
// No SET ROLE, no GRANT, no RLS switch: what the Host's API role may read is asked to PostgreSQL (has_*_privilege).

export const DATA_INSPECTOR_SQL = {
  // Hard-coded account gate (§03): username of the session's own account, read on the server.
  adminAccount: `
    SELECT a.username, a.account_status, a.disabled_at
      FROM iam.iam_user_accounts AS a
     WHERE a.user_account_id = $1::uuid`,
  // Every base (r) / partitioned (p) table of the CURRENT database, all schemas, no allowlist. $1 = row cap + 1.
  catalog: `
    SELECT c.oid::text AS relation_oid, n.nspname::text AS schema_name, c.relname::text AS table_name, c.relkind::text AS relkind,
           c.relrowsecurity AS row_security,
           pg_catalog.has_schema_privilege(n.oid, 'USAGE') AS schema_usage,
           pg_catalog.has_table_privilege(c.oid, 'SELECT') AS table_select,
           EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')) AS any_column_select
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
     ORDER BY n.nspname, c.relname
     LIMIT $1`,
  // Re-resolution of one table by its OID (stale / renamed / dropped detection).
  relation: `
    SELECT c.oid::text AS relation_oid, n.nspname::text AS schema_name, c.relname::text AS table_name, c.relkind::text AS relkind,
           c.relrowsecurity AS row_security,
           pg_catalog.has_schema_privilege(n.oid, 'USAGE') AS schema_usage,
           pg_catalog.has_table_privilege(c.oid, 'SELECT') AS table_select
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE c.oid = $1::oid`,
  // Live (not dropped) columns with type, nullability, primary-key membership and the API role's column SELECT right.
  columns: `
    SELECT a.attnum::int AS ordinal_position, a.attname::text AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           NOT a.attnotnull AS nullable,
           EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i
                    WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY (i.indkey)) AS primary_key,
           pg_catalog.has_column_privilege(a.attrelid, a.attnum, 'SELECT') AS select_privilege
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
} as const;

export const TABLE_KINDS = { r: 'BASE_TABLE', p: 'PARTITIONED_TABLE' } as const;
export type Relkind = keyof typeof TABLE_KINDS;
export const isTableKind = (k: string): k is Relkind => k === 'r' || k === 'p';

// Limits (spec §05 / REQ-006): page size default 50, max 100; bounded cell text and column count per page.
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;
export const PAGE_MAX = 100_000;
export const CELL_MAX_CHARS = 2_000_000;
export const ROW_COLUMNS_MAX = 1600;
export const CATALOG_MAX = 5_000;

// ------------------------------------------------------------------------------------------------------- table key
// `t_<oid>_<digest>`: digest = first 16 hex of SHA-256 over (oid, schema, table, relkind). It only detects a stale key
// (rename / move / drop + OID reuse) — it is NOT a permission token: every request is gated again.
const TABLE_KEY = /^t_([1-9][0-9]{0,9})_([0-9a-f]{16})$/;
const OID_MAX = 4_294_967_295;

export interface RelationIdentity {
  readonly oid: string;
  readonly schema: string;
  readonly table: string;
  readonly relkind: string;
}

export function tableDigest(r: RelationIdentity): string {
  return createHash('sha256').update(JSON.stringify([r.oid, r.schema, r.table, r.relkind]), 'utf8').digest('hex').slice(0, 16);
}

export function tableKeyOf(r: RelationIdentity): string {
  return `t_${r.oid}_${tableDigest(r)}`;
}

// Syntax only; null when the key cannot be one of ours.
export function parseTableKey(value: unknown): { readonly oid: string; readonly digest: string } | null {
  if (typeof value !== 'string') return null;
  const m = TABLE_KEY.exec(value);
  if (m === null || m[1] === undefined || m[2] === undefined || Number(m[1]) > OID_MAX) return null;
  return { oid: m[1], digest: m[2] };
}

// ------------------------------------------------------------------------------------------------------- page SQL
// PostgreSQL identifier quoting: wrap in double quotes, double every embedded quote. Names come from pg_catalog only.
export function quoteIdent(name: string): string {
  if (name === '' || name.includes('\u0000')) throw new Error('invalid identifier from catalog');
  return `"${name.replace(/"/g, '""')}"`;
}

// One bounded page: each shown column as text cut to CELL_MAX_CHARS + 1 (the extra char tells "truncated"), positional
// aliases (c0, c1 …) and table-qualified ORDER BY so that no column name can collide with an alias. $1 = LIMIT, $2 = OFFSET.
// FIX-01: a FULL-masked column is never read — the constant MASK takes its place; a JSON_KEYS column is read up to
// JSON_PARSE_MAX_CHARS + 1 so that it can be parsed whole and masked by key (data-inspector.masking.ts).
export function pageSql(schema: string, table: string, columns: readonly string[], orderBy: readonly string[], modes: readonly MaskMode[] = []): string {
  if (columns.length === 0) throw new Error('no column to select');
  const list = columns.map((c, i) => {
    const mode = modes[i] ?? 'NONE';
    if (mode === 'FULL') return `'${MASK}'::text AS "c${i}"`;
    return `t.${quoteIdent(c)}::text AS "c${i}"`;
  }).join(', ');
  const order = orderBy.length === 0 ? '' : ` ORDER BY ${orderBy.map((c) => `t.${quoteIdent(c)}`).join(', ')}`;
  return `SELECT ${list} FROM ${quoteIdent(schema)}.${quoteIdent(table)} AS t${order} LIMIT $1 OFFSET $2`;
}
