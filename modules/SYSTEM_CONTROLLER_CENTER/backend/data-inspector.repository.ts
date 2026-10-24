import { z } from 'zod';
import type { ReadOnlyQuery as SqlExecutor } from './host.js';
import { MASK, maskJsonText } from './data-inspector.masking.js';
import type { MaskMode } from './data-inspector.masking.js';
import { CATALOG_MAX, CELL_MAX_CHARS, DATA_INSPECTOR_SQL, pageSql } from './data-inspector.sql.js';

// DATA_INSPECTOR — reads of one request, each given the executor of the Host's READ ONLY transaction (the service opens
// it once per request, so the admin gate and the data read see the same snapshot). Rows are parsed strictly; a value
// of an unexpected shape is a failure, never a guess.

export interface AdminAccountRow {
  readonly username: string;
  readonly accountStatus: string;
  readonly disabled: boolean;
}

export interface CatalogRow {
  readonly oid: string;
  readonly schema: string;
  readonly table: string;
  readonly relkind: string;
  readonly rowSecurity: boolean;
  readonly schemaUsage: boolean | null;
  readonly tableSelect: boolean | null;
  readonly anyColumnSelect: boolean | null;
}

export interface ColumnRow {
  readonly ordinalPosition: number;
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly selectPrivilege: boolean | null;
}

export interface CatalogRead {
  readonly rows: readonly CatalogRow[];
  readonly complete: boolean;
}

export interface PageRows {
  readonly cells: readonly (readonly (string | null)[])[];
  readonly truncated: readonly (readonly number[])[]; // per row: indexes of cells cut to CELL_MAX_CHARS
  readonly masked: readonly (readonly number[])[]; // per row: indexes of cells whose value was (partly) replaced by MASK
}

const flag = z.boolean().nullable();
const adminRow = z.object({ username: z.string(), account_status: z.string(), disabled_at: z.unknown() });
const catalogRow = z.object({
  relation_oid: z.string(), schema_name: z.string(), table_name: z.string(), relkind: z.string(), row_security: z.boolean(),
  schema_usage: flag, table_select: flag, any_column_select: flag.optional(),
});
const columnRow = z.object({
  ordinal_position: z.number().int(), column_name: z.string(), data_type: z.string(), nullable: z.boolean(), primary_key: z.boolean(), select_privilege: flag,
});
const cell = z.string().nullable();

function toCatalog(row: unknown): CatalogRow {
  const r = catalogRow.parse(row);
  return {
    oid: r.relation_oid, schema: r.schema_name, table: r.table_name, relkind: r.relkind, rowSecurity: r.row_security,
    schemaUsage: r.schema_usage, tableSelect: r.table_select, anyColumnSelect: r.any_column_select ?? null,
  };
}

// Zero rows → []; the caller decides (exactly one row is required).
export async function adminAccounts(tx: SqlExecutor, userAccountId: string): Promise<AdminAccountRow[]> {
  return (await tx.query(DATA_INSPECTOR_SQL.adminAccount, [userAccountId])).map((row) => {
    const r = adminRow.parse(row);
    return { username: r.username, accountStatus: r.account_status, disabled: r.disabled_at !== null && r.disabled_at !== undefined };
  });
}

export async function catalog(tx: SqlExecutor): Promise<CatalogRead> {
  const rows = (await tx.query(DATA_INSPECTOR_SQL.catalog, [CATALOG_MAX + 1])).map(toCatalog);
  return { rows: rows.slice(0, CATALOG_MAX), complete: rows.length <= CATALOG_MAX };
}

export async function relation(tx: SqlExecutor, oid: string): Promise<CatalogRow | null> {
  const [row] = await tx.query(DATA_INSPECTOR_SQL.relation, [oid]);
  return row === undefined ? null : toCatalog(row);
}

export async function columns(tx: SqlExecutor, oid: string): Promise<ColumnRow[]> {
  return (await tx.query(DATA_INSPECTOR_SQL.columns, [oid])).map((row) => {
    const r = columnRow.parse(row);
    return {
      ordinalPosition: r.ordinal_position, name: r.column_name, dataType: r.data_type, nullable: r.nullable, primaryKey: r.primary_key,
      selectPrivilege: r.select_privilege,
    };
  });
}

// FIX-01: masking happens here, before anything leaves the module — FULL cells are the constant MASK whatever the SQL
// returned (the SQL does not read them anyway), JSON_KEYS cells are masked by key, then the display bound applies.
export async function page(
  tx: SqlExecutor, schema: string, table: string, shown: readonly string[], orderBy: readonly string[], limit: number, offset: number,
  modes: readonly MaskMode[] = [],
): Promise<PageRows> {
  const cells: (string | null)[][] = [];
  const truncated: number[][] = [];
  const masked: number[][] = [];
  for (const row of await tx.query(pageSql(schema, table, shown, orderBy, modes), [limit, offset])) {
    const record = z.record(z.string(), cell).parse(row);
    const cut: number[] = [];
    const hidden: number[] = [];
    cells.push(shown.map((_, i) => {
      const mode = modes[i] ?? 'NONE';
      if (mode === 'FULL') {
        hidden.push(i);
        return MASK;
      }
      let v = record[`c${i}`] ?? null;
      if (v !== null && mode === 'JSON_KEYS') {
        const m = maskJsonText(v);
        if (m.masked) hidden.push(i);
        v = m.text;
      }
      if (v === null || v.length <= CELL_MAX_CHARS) return v;
      // PostgreSQL left() counts characters (code points), JavaScript length counts UTF-16 units.
      const chars = Array.from(v);
      if (chars.length <= CELL_MAX_CHARS) return v;
      cut.push(i);
      throw new Error('CELL_LIMIT_EXCEEDED');
    }));
    truncated.push(cut);
    masked.push(hidden);
  }
  return { cells, truncated, masked };
}
