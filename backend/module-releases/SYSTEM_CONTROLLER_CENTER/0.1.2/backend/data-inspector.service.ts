import { z } from 'zod';
import type { ModuleActor as Actor, ModuleHost, ModulePermission as PermissionRef, ReadOnlyQuery as SqlExecutor } from './host.js';
import { DATA_INSPECTOR_ACTION, DATA_INSPECTOR_DENIED_TARGET } from './data-inspector.permissions.js';
import type { DataInspectorBinding } from './data-inspector.permissions.js';
import * as repo from './data-inspector.repository.js';
import type { CatalogRow, ColumnRow } from './data-inspector.repository.js';
import { maskModeOf, isProtectedAccountTable } from './data-inspector.masking.js';
import { categoryOf, controlledProjectionOf } from './data-inspector.controlled.js';
import type { ControlledProjection, ProjectionSource, TableCategory } from './data-inspector.controlled.js';
import type { MaskMode } from './data-inspector.masking.js';
import {
  CELL_MAX_CHARS, PAGE_MAX, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, ROW_COLUMNS_MAX, TABLE_KINDS, isTableKind, parseTableKey, tableDigest, tableKeyOf,
} from './data-inspector.sql.js';

// SCC database explorer: effective session is checked in administratorOnlyHost(), then
// Host.authorize() + lifecycle, then one read-only PostgreSQL transaction.
// Other than protected account tables no column masking; DB role/RLS remain in effect.

export const DATA_INSPECTOR_MESSAGES = {
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  ACCOUNT_DATA_PROTECTED: 'Dữ liệu tài khoản được bảo vệ, không thể xem trực tiếp trong Data Explorer.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ.',
  TABLE_NOT_FOUND: 'Không tìm thấy bảng theo khóa đã chọn.',
  TABLE_NOT_READABLE: 'Vai trò PostgreSQL của hệ thống không được cấp quyền SELECT trên dữ liệu bảng này.',
  CATALOG_CHANGED: 'Danh mục bảng đã thay đổi (bảng bị đổi tên, chuyển schema hoặc xóa). Vui lòng làm mới danh sách.',
  QUERY_TIMEOUT: 'Truy vấn vượt quá giới hạn thời gian cho phép.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
  MODULE_UNAVAILABLE: 'Module chưa ACTIVE hoặc chưa bật.',
  CONTROLLED_READ_UNAVAILABLE: 'Cơ chế đọc có kiểm soát cho bảng này chưa sẵn sàng trên database (cần Database Access Gate đã duyệt).',
} as const;

export type DataInspectorErrorCode = keyof typeof DATA_INSPECTOR_MESSAGES;

export class DataInspectorError extends Error {
  readonly status: number;
  readonly code: DataInspectorErrorCode;
  readonly fields: readonly string[] | undefined;

  constructor(status: number, code: DataInspectorErrorCode, fields?: readonly string[]) {
    super(DATA_INSPECTOR_MESSAGES[code]);
    this.name = 'DataInspectorError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type ReadStatus = 'READABLE' | 'PARTIAL' | 'NOT_READABLE' | 'UNKNOWN';
export type TableKind = (typeof TABLE_KINDS)[keyof typeof TABLE_KINDS];

// SCC 0.1.2: how the rows of a table can be seen. DIRECT = generic page (PostgreSQL SELECT); CONTROLLED = an approved
// projection (DB function or fixed backend column list); PROTECTED = account / credential data, never shown;
// NOT_READABLE = PostgreSQL grants no SELECT and no approved projection exists.
export type AccessPath = 'DIRECT' | 'CONTROLLED' | 'PROTECTED' | 'NOT_READABLE';

export interface TableEntry {
  readonly tableKey: string;
  readonly schema: string;
  readonly table: string;
  readonly kind: TableKind;
  readonly readStatus: ReadStatus;
  readonly rowSecurity: boolean;
  readonly category: TableCategory;
  readonly access: AccessPath;
}

export interface ProjectionInfo {
  readonly key: ControlledProjection['key'];
  readonly source: ProjectionSource;
  readonly reader: string;
  readonly columns: readonly string[];
  readonly withheldColumns: readonly string[];
  readonly note: string;
}

export interface TablesView {
  readonly scope: 'CURRENT_DATABASE_ALL_SCHEMAS';
  readonly tables: readonly TableEntry[];
  readonly catalogComplete: boolean;
}

export interface ColumnEntry {
  readonly name: string;
  readonly dataType: string;
  readonly ordinalPosition: number;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly selectPrivilege: boolean;
  readonly masking: MaskMode; // FIX-01: how the values of this column leave the API (metadata itself is never masked)
}

export interface ColumnsView extends TableEntry {
  readonly columns: readonly ColumnEntry[];
  readonly projection?: ProjectionInfo;
}

export interface RowsView {
  readonly tableKey: string;
  readonly schema: string;
  readonly table: string;
  readonly readStatus: 'READABLE' | 'PARTIAL';
  readonly page: number;
  readonly pageSize: number;
  readonly hasNext: boolean;
  readonly columns: readonly string[];
  readonly columnTypes: readonly string[];
  readonly columnMasking: readonly MaskMode[];
  readonly columnsLimited: boolean;
  readonly rows: readonly { readonly cells: readonly (string | null)[]; readonly truncated?: readonly number[]; readonly masked?: readonly number[] }[];
  readonly cellMaxChars: number;
  readonly rowVisibility: 'DB_ROLE_AND_RLS';
  readonly rowSecurity: boolean;
  readonly ordering: 'PRIMARY_KEY' | 'UNSTABLE_NO_KEY' | 'PROJECTION_ORDER';
  readonly orderBy: readonly string[];
  readonly access: 'DIRECT' | 'CONTROLLED';
  readonly projection?: ProjectionInfo;
}

export interface DataInspectorServiceDeps {
  readonly host: Pick<ModuleHost, 'authorize' | 'lifecycle' | 'readOnly' | 'logger'>;
  readonly binding: DataInspectorBinding;
}

// SQLSTATE of a database error (the five-character code only, never the message), as nested by Prisma / the pg adapter.
const SQLSTATE = /^[0-9A-Z]{5}$/;
export function sqlstateOf(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): string | undefined => {
    if (typeof value !== 'object' || value === null || depth > 6 || seen.has(value)) return undefined;
    seen.add(value);
    for (const key of ['code', 'originalCode', 'sqlState', 'sqlstate']) {
      const code: unknown = Reflect.get(value, key);
      if (typeof code === 'string' && SQLSTATE.test(code) && !code.startsWith('P')) return code;
    }
    for (const key of ['cause', 'meta', 'driverAdapterError', 'error']) {
      const found = visit(Reflect.get(value, key), depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(error, 0);
}

const INSUFFICIENT_PRIVILEGE = '42501';
// Missing approved reader (schema / function not installed by the Database Access Gate) or no EXECUTE.
const CONTROLLED_UNAVAILABLE = new Set(['42501', '42883', '3F000', '42P01']);
const INVALID_PARAMETER = '22023';
const QUERY_CANCELED = '57014'; // statement_timeout of the Host's READ ONLY transaction

const intParam = (min: number, max: number, fallback: number) =>
  z.union([z.undefined(), z.string().regex(/^[0-9]{1,6}$/)]).transform((v) => (v === undefined ? fallback : Number(v))).pipe(z.number().int().min(min).max(max));
const pagingSchema = z.strictObject({ page: intParam(1, PAGE_MAX, 1), pageSize: intParam(1, PAGE_SIZE_MAX, PAGE_SIZE_DEFAULT) });

export function readStatusOf(r: CatalogRow): ReadStatus {
  if (r.schemaUsage === null || r.tableSelect === null) return 'UNKNOWN';
  if (!r.schemaUsage) return 'NOT_READABLE';
  if (r.tableSelect) return 'READABLE';
  if (r.anyColumnSelect === null) return 'UNKNOWN';
  return r.anyColumnSelect ? 'PARTIAL' : 'NOT_READABLE';
}

export function accessOf(schema: string, table: string, readStatus: ReadStatus): AccessPath {
  if (controlledProjectionOf(schema, table)) return 'CONTROLLED';
  if (isProtectedAccountTable(schema, table)) return 'PROTECTED';
  return readStatus === 'READABLE' || readStatus === 'PARTIAL' ? 'DIRECT' : 'NOT_READABLE';
}

function entryOf(r: CatalogRow & { readonly relkind: 'r' | 'p' }, readStatus: ReadStatus): TableEntry {
  return { tableKey: tableKeyOf(r), schema: r.schema, table: r.table, kind: TABLE_KINDS[r.relkind], readStatus, rowSecurity: r.rowSecurity,
    category: categoryOf(r.schema), access: accessOf(r.schema, r.table, readStatus) };
}

function projectionInfo(p: ControlledProjection): ProjectionInfo {
  return { key: p.key, source: p.source, reader: p.reader, columns: p.columns.map((c) => c.name), withheldColumns: p.withheld, note: p.note };
}

function toColumn(c: ColumnRow): ColumnEntry {
  return {
    name: c.name, dataType: c.dataType, ordinalPosition: c.ordinalPosition, nullable: c.nullable, primaryKey: c.primaryKey, selectPrivilege: c.selectPrivilege === true,
    masking: maskModeOf(c.name, c.dataType),
  };
}

export class DataInspectorService {
  private readonly host: DataInspectorServiceDeps['host'];
  private readonly binding: DataInspectorBinding;

  constructor(deps: DataInspectorServiceDeps) {
    this.host = deps.host;
    this.binding = deps.binding;
  }

  // GET /api/data-inspector/tables — every r / p table of the current database, all schemas, with its read status.
  async tables(actor: Actor): Promise<TablesView> {
    return this.run(actor, this.binding.catalogRead, DATA_INSPECTOR_ACTION.CATALOG_READ, 'tables', 'QUERY_TIMEOUT', async (tx) => {
      const read = await repo.catalog(tx);
      const tables: TableEntry[] = [];
      for (const r of read.rows) {
        const relkind = r.relkind;
        if (isTableKind(relkind)) tables.push(entryOf({ ...r, relkind }, readStatusOf(r)));
      }
      return { scope: 'CURRENT_DATABASE_ALL_SCHEMAS', tables, catalogComplete: read.complete && tables.length === read.rows.length };
    });
  }

  // GET /api/data-inspector/tables/{tableKey}/columns — structure of one table (metadata, also for NOT_READABLE tables).
  async columns(actor: Actor, tableKeyParam: unknown): Promise<ColumnsView> {
    return this.run(actor, this.binding.catalogRead, DATA_INSPECTOR_ACTION.CATALOG_READ, 'columns', 'SERVICE_BUSY', async (tx) => {
      const { entry, oid } = await this.resolve(tx, tableKeyParam);
      const projection = controlledProjectionOf(entry.schema, entry.table);
      return { ...entry, columns: (await repo.columns(tx, oid)).map(toColumn), ...(projection ? { projection: projectionInfo(projection) } : {}) };
    });
  }

  // GET /api/data-inspector/tables/{tableKey}/rows?page=&pageSize= — one bounded page, only what the API role may SELECT.
  async rows(actor: Actor, tableKeyParam: unknown, query: unknown): Promise<RowsView> {
    return this.run(actor, this.binding.rowsRead, DATA_INSPECTOR_ACTION.ROWS_READ, 'rows', 'QUERY_TIMEOUT', async (tx) => {
      // Every known key present (undefined = default), unknown keys kept so that the strict schema refuses them.
      const raw: Record<string, unknown> = typeof query === 'object' && query !== null ? { ...query } : {};
      const paging = pagingSchema.safeParse({ ...raw, page: raw['page'], pageSize: raw['pageSize'] });
      if (!paging.success) throw new DataInspectorError(400, 'VALIDATION_ERROR', [...new Set(paging.error.issues.map((i) => String(i.path[0] ?? 'query')))]);
      const { page, pageSize } = paging.data;
      const { entry, oid } = await this.resolve(tx, tableKeyParam);
      const projection = controlledProjectionOf(entry.schema, entry.table);
      if (projection) return this.controlledPage(tx, entry, projection, page, pageSize);
      if (isProtectedAccountTable(entry.schema, entry.table)) throw new DataInspectorError(403, 'ACCOUNT_DATA_PROTECTED');
      if (entry.readStatus !== 'READABLE' && entry.readStatus !== 'PARTIAL') throw new DataInspectorError(403, 'TABLE_NOT_READABLE');
      const cols = await repo.columns(tx, oid);
      const readable = cols.filter((c) => c.selectPrivilege === true);
      if (readable.length === 0) throw new DataInspectorError(403, 'TABLE_NOT_READABLE');
      const shown = readable.slice(0, ROW_COLUMNS_MAX);
      const key = cols.filter((c) => c.primaryKey);
      const orderBy = key.length > 0 && key.every((c) => c.selectPrivilege === true) ? key.map((c) => c.name) : [];
      // FIX-01: the masking mode is derived on the server from pg_catalog only; no request value can change it.
      const modes = shown.map((c) => maskModeOf(c.name, c.dataType));
      const data = await repo.page(tx, entry.schema, entry.table, shown.map((c) => c.name), orderBy, pageSize + 1, (page - 1) * pageSize, modes);
      const rows = data.cells.slice(0, pageSize).map((cells, i) => {
        const cut = data.truncated[i] ?? [];
        const hidden = data.masked[i] ?? [];
        return { cells, ...(cut.length > 0 ? { truncated: cut } : {}), ...(hidden.length > 0 ? { masked: hidden } : {}) };
      });
      return {
        tableKey: entry.tableKey, schema: entry.schema, table: entry.table,
        readStatus: readable.length === cols.length ? 'READABLE' : 'PARTIAL',
        page, pageSize, hasNext: data.cells.length > pageSize,
        columns: shown.map((c) => c.name), columnTypes: shown.map((c) => c.dataType), columnMasking: modes, columnsLimited: readable.length > shown.length,
        rows, cellMaxChars: CELL_MAX_CHARS, rowVisibility: 'DB_ROLE_AND_RLS', rowSecurity: entry.rowSecurity,
        ordering: orderBy.length > 0 ? 'PRIMARY_KEY' : 'UNSTABLE_NO_KEY', orderBy, access: 'DIRECT',
      };
    });
  }

  // SCC 0.1.2: one bounded page of an approved projection. Its failures are told apart from a missing table SELECT:
  // a reader that is not installed / not executable is CONTROLLED_READ_UNAVAILABLE (503), never a fallback to raw rows.
  private async controlledPage(tx: SqlExecutor, entry: TableEntry, p: ControlledProjection, page: number, pageSize: number): Promise<RowsView> {
    const offset = (page - 1) * pageSize;
    if (offset > p.maxOffset) throw new DataInspectorError(400, 'VALIDATION_ERROR', ['page']);
    const { sql, params } = p.statement(pageSize + 1, offset, new Date());
    let raw: unknown[];
    try {
      raw = await tx.query(sql, params);
    } catch (error) {
      const sqlstate = sqlstateOf(error);
      if (sqlstate !== undefined && CONTROLLED_UNAVAILABLE.has(sqlstate)) {
        this.host.logger.warn('data-inspector controlled read unavailable', { projection: p.key, sqlstate });
        throw new DataInspectorError(503, 'CONTROLLED_READ_UNAVAILABLE');
      }
      if (sqlstate === INVALID_PARAMETER) throw new DataInspectorError(400, 'VALIDATION_ERROR', ['page']);
      throw error;
    }
    const names = p.columns.map((c) => c.name);
    const rows = raw.slice(0, pageSize).map((row) => {
      const record = z.record(z.string(), z.union([z.string(), z.null()])).parse(row);
      const cells = names.map((n) => {
        const v = record[n];
        if (v === undefined) throw new Error('projection column missing');
        if (v !== null && Array.from(v).length > CELL_MAX_CHARS) throw new Error('CELL_LIMIT_EXCEEDED');
        return v;
      });
      return { cells };
    });
    return {
      tableKey: entry.tableKey, schema: entry.schema, table: entry.table,
      readStatus: p.withheld.length > 0 ? 'PARTIAL' : 'READABLE',
      page, pageSize, hasNext: raw.length > pageSize,
      columns: names, columnTypes: p.columns.map((c) => c.type), columnMasking: names.map((): MaskMode => 'NONE'), columnsLimited: false,
      rows, cellMaxChars: CELL_MAX_CHARS, rowVisibility: 'DB_ROLE_AND_RLS', rowSecurity: entry.rowSecurity,
      ordering: 'PROJECTION_ORDER', orderBy: p.orderBy, access: 'CONTROLLED', projection: projectionInfo(p),
    };
  }

  // (1) IAM → (2) lifecycle → (3) READ ONLY transaction: admin gate, then `read`. Database failures of the read are
  // mapped to their code (42501 → TABLE_NOT_READABLE, 57014 → `timeoutCode`, else 503); nothing is retried.
  private async run<R>(
    actor: Actor, permission: PermissionRef, actionCode: string, route: string, timeoutCode: 'QUERY_TIMEOUT' | 'SERVICE_BUSY',
    read: (tx: SqlExecutor) => Promise<R>,
  ): Promise<R> {
    await this.host.authorize(actor, permission, actionCode, DATA_INSPECTOR_DENIED_TARGET);
    let state;
    try {
      state = await this.host.lifecycle(this.binding.moduleKey);
    } catch (error) {
      this.logFailure('data-inspector lifecycle check failed', actor, route, error);
      throw new DataInspectorError(503, 'SERVICE_BUSY');
    }
    if (state === null || !state.isEnabled || state.activeVersions !== 1) {
      this.host.logger.warn('data-inspector module not available', { requestId: actor.requestId, route, outcome: 'DENIED', reason: 'LIFECYCLE' });
      throw new DataInspectorError(503, 'MODULE_UNAVAILABLE');
    }
    try {
      const result = await this.host.readOnly(async (tx) => {
        return read(tx);
      });
      this.host.logger.info('data-inspector read', { event: actionCode, requestId: actor.requestId, route, outcome: 'SUCCESS' });
      return result;
    } catch (error) {
      if (error instanceof DataInspectorError) throw error;
      const sqlstate = sqlstateOf(error);
      if (sqlstate === INSUFFICIENT_PRIVILEGE && route === 'rows') throw new DataInspectorError(403, 'TABLE_NOT_READABLE');
      if (sqlstate === QUERY_CANCELED) {
        this.host.logger.warn('data-inspector query timeout', { requestId: actor.requestId, route, sqlstate });
        throw new DataInspectorError(503, timeoutCode);
      }
      this.logFailure('data-inspector read failed', actor, route, error);
      throw new DataInspectorError(503, 'SERVICE_BUSY');
    }
  }

  // tableKey → the table as it is NOW in pg_catalog. Malformed / not a table → 404; dropped, renamed or moved → 409.
  private async resolve(tx: SqlExecutor, tableKeyParam: unknown): Promise<{ entry: TableEntry; oid: string }> {
    const key = parseTableKey(tableKeyParam);
    if (key === null) throw new DataInspectorError(404, 'TABLE_NOT_FOUND');
    const r = await repo.relation(tx, key.oid);
    if (r === null) throw new DataInspectorError(409, 'CATALOG_CHANGED');
    const relkind = r.relkind;
    if (tableDigest(r) !== key.digest) throw new DataInspectorError(409, 'CATALOG_CHANGED');
    if (!isTableKind(relkind)) throw new DataInspectorError(404, 'TABLE_NOT_FOUND');
    // The relation query carries no column privilege: a table without table-level SELECT is PARTIAL / NOT_READABLE
    // according to its columns, decided by the caller from the column list.
    const columnLevel = r.schemaUsage === true && r.tableSelect === false ? (await repo.columns(tx, r.oid)).some((c) => c.selectPrivilege === true) : null;
    return { entry: entryOf({ ...r, relkind }, readStatusOf({ ...r, anyColumnSelect: columnLevel ?? r.anyColumnSelect })), oid: r.oid };
  }

  private logFailure(message: string, actor: Actor, route: string, error: unknown): void {
    this.host.logger.error(message, { requestId: actor.requestId, route, errorName: error instanceof Error ? error.name : typeof error, sqlstate: sqlstateOf(error) });
  }
}
