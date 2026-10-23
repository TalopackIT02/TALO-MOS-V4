// DATA_INSPECTOR — client of /api/data-inspector/* (three GET). Same rules as the Host clients: same-origin cookie
// session, no token storage, no automatic retry, the server decides every permission (IAM + lifecycle + the `admin`
// account gate). No request carries SQL, a schema / table name or a username — a table is named by the server's tableKey.
// Self-contained result envelope (no import of the Host's services).

export interface ApiFailure {
  ok: false;
  status: number; // 0 = no response (network)
  code: string;
  details: string[];
  requestId: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// FIX-01: values are masked by the server; the client only shows the marker it receives.
export type MaskMode = 'NONE' | 'FULL' | 'JSON_KEYS';
const MASK_MODES: readonly MaskMode[] = ['NONE', 'FULL', 'JSON_KEYS'];
const maskMode = (v: unknown): MaskMode => {
  const m = MASK_MODES.find((x) => x === v);
  if (!m) throw new Error('masking');
  return m;
};

export type ReadStatus = 'READABLE' | 'PARTIAL' | 'NOT_READABLE' | 'UNKNOWN';

export interface TableEntry {
  tableKey: string;
  schema: string;
  table: string;
  kind: 'BASE_TABLE' | 'PARTITIONED_TABLE';
  readStatus: ReadStatus;
  rowSecurity: boolean;
}

export interface TablesView {
  tables: TableEntry[];
  catalogComplete: boolean;
}

export interface ColumnEntry {
  name: string;
  dataType: string;
  ordinalPosition: number;
  nullable: boolean;
  primaryKey: boolean;
  selectPrivilege: boolean;
  masking: MaskMode;
}

export interface ColumnsView extends TableEntry {
  columns: ColumnEntry[];
}

export interface RowsView {
  tableKey: string;
  readStatus: 'READABLE' | 'PARTIAL';
  page: number;
  pageSize: number;
  hasNext: boolean;
  columns: string[];
  columnTypes: string[];
  columnMasking: MaskMode[];
  columnsLimited: boolean;
  rows: { cells: (string | null)[]; truncated: number[]; masked: number[] }[];
  cellMaxChars: number;
  rowSecurity: boolean;
  ordering: 'PRIMARY_KEY' | 'UNSTABLE_NO_KEY';
  orderBy: string[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const READ_STATUSES: readonly ReadStatus[] = ['READABLE', 'PARTIAL', 'NOT_READABLE', 'UNKNOWN'];

function obj(v: unknown): Json {
  if (!isObject(v)) throw new Error('object');
  return v;
}

function str(o: Json, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new Error(`field ${key}`);
  return v;
}

function num(o: Json, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`field ${key}`);
  return v;
}

function bool(o: Json, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new Error(`field ${key}`);
  return v;
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((x): x is string => typeof x === 'string')) throw new Error('strings');
  return v;
}

function toEntry(v: unknown): TableEntry {
  const o = obj(v);
  const readStatus = READ_STATUSES.find((s) => s === o.readStatus);
  const kind = o.kind === 'BASE_TABLE' || o.kind === 'PARTITIONED_TABLE' ? o.kind : undefined;
  if (!readStatus || !kind) throw new Error('entry');
  return { tableKey: str(o, 'tableKey'), schema: str(o, 'schema'), table: str(o, 'table'), kind, readStatus, rowSecurity: bool(o, 'rowSecurity') };
}

function toTables(v: unknown): TablesView {
  const o = obj(v);
  if (!Array.isArray(o.tables)) throw new Error('tables');
  return { tables: o.tables.map(toEntry), catalogComplete: bool(o, 'catalogComplete') };
}

function toColumns(v: unknown): ColumnsView {
  const o = obj(v);
  if (!Array.isArray(o.columns)) throw new Error('columns');
  return {
    ...toEntry(o),
    columns: o.columns.map((c) => {
      const x = obj(c);
      return {
        name: str(x, 'name'), dataType: str(x, 'dataType'), ordinalPosition: num(x, 'ordinalPosition'), nullable: bool(x, 'nullable'),
        primaryKey: bool(x, 'primaryKey'), selectPrivilege: bool(x, 'selectPrivilege'), masking: maskMode(x.masking),
      };
    }),
  };
}

function toRows(v: unknown): RowsView {
  const o = obj(v);
  if (!Array.isArray(o.rows)) throw new Error('rows');
  const columns = strings(o.columns);
  const rows = o.rows.map((r) => {
    const x = obj(r);
    if (!Array.isArray(x.cells) || x.cells.length !== columns.length) throw new Error('cells');
    const indexes = (v: unknown): number[] => {
      const list = v === undefined ? [] : v;
      if (!Array.isArray(list) || !list.every((i): i is number => typeof i === 'number')) throw new Error('indexes');
      return list;
    };
    return { cells: x.cells.map((c) => (typeof c === 'string' ? c : null)), truncated: indexes(x.truncated), masked: indexes(x.masked) };
  });
  const readStatus = o.readStatus === 'READABLE' || o.readStatus === 'PARTIAL' ? o.readStatus : undefined;
  const ordering = o.ordering === 'PRIMARY_KEY' || o.ordering === 'UNSTABLE_NO_KEY' ? o.ordering : undefined;
  if (!readStatus || !ordering) throw new Error('rows view');
  return {
    tableKey: str(o, 'tableKey'), readStatus, page: num(o, 'page'), pageSize: num(o, 'pageSize'), hasNext: bool(o, 'hasNext'), columns,
    columnTypes: strings(o.columnTypes), columnMasking: Array.isArray(o.columnMasking) ? o.columnMasking.map(maskMode) : [], columnsLimited: bool(o, 'columnsLimited'), rows, cellMaxChars: num(o, 'cellMaxChars'),
    rowSecurity: bool(o, 'rowSecurity'), ordering, orderBy: strings(o.orderBy),
  };
}

async function get<T>(path: string, parse: (payload: unknown) => T): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/data-inspector${path}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok) {
    try {
      return { ok: true, data: parse(payload) };
    } catch {
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [], requestId: '' };
    }
  }
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const details = isObject(error.details) && Array.isArray(error.details.fields) ? error.details.fields.filter((x): x is string => typeof x === 'string') : [];
  return {
    ok: false, status: response.status, code: typeof error.code === 'string' ? error.code : 'UNKNOWN', details,
    requestId: typeof error.requestId === 'string' ? error.requestId : '',
  };
}

export const dataInspectorApi = {
  tables: () => get('/tables', toTables),
  columns: (tableKey: string) => get(`/tables/${encodeURIComponent(tableKey)}/columns`, toColumns),
  rows: (tableKey: string, page: number, pageSize: number) =>
    get(`/tables/${encodeURIComponent(tableKey)}/rows?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) }).toString()}`, toRows),
};

const BY_CODE: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền sử dụng Trình xem PostgreSQL.',
  VALIDATION_ERROR: 'Tham số trang không hợp lệ.',
  TABLE_NOT_FOUND: 'Không tìm thấy bảng theo khóa đã chọn. Vui lòng làm mới danh sách.',
  TABLE_NOT_READABLE: 'Vai trò PostgreSQL của hệ thống không được cấp quyền SELECT trên dữ liệu bảng này.',
  CATALOG_CHANGED: 'Danh mục bảng đã thay đổi (bảng bị đổi tên, chuyển schema hoặc xóa). Vui lòng làm mới danh sách.',
  QUERY_TIMEOUT: 'Truy vấn vượt quá giới hạn thời gian cho phép (5 giây). Hãy thử trang khác hoặc giảm số dòng/trang.',
  SESSION_INVALID: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
  PASSWORD_CHANGE_REQUIRED: 'Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.',
  SERVICE_BUSY: 'Hệ thống đang bận hoặc module chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
  UNEXPECTED_RESPONSE: 'Phản hồi từ máy chủ không đúng định dạng mong đợi.',
};

const BY_STATUS: Record<number, string> = {
  0: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy dữ liệu yêu cầu.',
  503: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
};

export function describeFailure(failure: ApiFailure): string {
  const base = BY_CODE[failure.code] ?? BY_STATUS[failure.status] ?? 'Đã xảy ra lỗi không xác định.';
  const details = failure.details.length > 0 ? ` (${failure.details.join(', ')})` : '';
  const reference = failure.status >= 500 && failure.requestId ? ` Mã tham chiếu: ${failure.requestId}.` : '';
  return `${base}${details}${reference}`;
}
