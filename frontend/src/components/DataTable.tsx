import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import '../styles/data-table.css';

// Standard DataTable of the admin screens (master contract WS03): quick search, search in one field, sort by a column
// header, pagination, page size, total, refresh, loading / empty / error. Two modes:
//  - client: `rows` is the whole (small) list; search / sort / paging run in the browser on the column `value` text.
//  - server: `rows` is one page; every change of the query is handed to `server.onQuery` (the API filters with its own
//    column allowlist — the table only sends column keys it was given).

export interface Column<T> {
  readonly key: string;
  readonly label: string;
  // Text used for search and sort (client mode) — also the cell content when no `render` is given.
  readonly value: (row: T) => string;
  readonly render?: (row: T) => ReactNode;
  readonly sortable?: boolean; // default true
  readonly searchable?: boolean; // default true
  readonly width?: string;
}

export interface TableQuery {
  readonly search: string;
  readonly field: string | null; // null = every searchable column
  readonly sort: string | null;
  readonly dir: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
}

export const FIRST_QUERY: TableQuery = { search: '', field: null, sort: null, dir: 'asc', page: 1, pageSize: 25 };

export interface DataTableProps<T> {
  readonly label: string;
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[] | null; // null = loading (first load)
  readonly rowKey: (row: T) => string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly emptyText?: string;
  readonly selectedKey?: string | null;
  readonly actions?: (row: T) => ReactNode;
  readonly toolbar?: ReactNode;
  readonly onRefresh?: () => void;
  readonly pageSizes?: readonly number[];
  readonly initial?: Partial<TableQuery>;
  readonly compact?: boolean;
  readonly server?: { readonly total: number; readonly query: TableQuery; readonly onQuery: (q: TableQuery) => void };
}

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

export function DataTable<T>(props: DataTableProps<T>) {
  const { label, columns, rows, rowKey, loading = false, error = null, emptyText = 'Không có dữ liệu.', selectedKey = null, actions, toolbar, onRefresh, server, compact } = props;
  const pageSizes = props.pageSizes ?? [10, 25, 50, 100];
  const [local, setLocal] = useState<TableQuery>({ ...FIRST_QUERY, ...props.initial });
  const query = server ? server.query : local;
  const [draft, setDraft] = useState(query.search);
  const [draftField, setDraftField] = useState<string | null>(query.field);
  useEffect(() => { setDraft(query.search); setDraftField(query.field); }, [query.search, query.field]);

  const change = (next: Partial<TableQuery>) => {
    const q = { ...query, ...next };
    if (server) server.onQuery(q);
    else setLocal(q);
  };

  const searchable = columns.filter((c) => c.searchable !== false);

  // Client mode: filter → sort → page.
  const view = useMemo(() => {
    if (server || rows === null) return { total: server?.total ?? 0, page: rows ?? [] };
    const needle = query.search.trim().toLocaleLowerCase('vi');
    const cols = query.field === null ? searchable : searchable.filter((c) => c.key === query.field);
    const filtered = needle === '' ? [...rows] : rows.filter((r) => cols.some((c) => c.value(r).toLocaleLowerCase('vi').includes(needle)));
    const sortCol = columns.find((c) => c.key === query.sort);
    if (sortCol) {
      const sign = query.dir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => sign * collator.compare(sortCol.value(a), sortCol.value(b)));
    }
    const start = (query.page - 1) * query.pageSize;
    return { total: filtered.length, page: filtered.slice(start, start + query.pageSize) };
  }, [server, rows, query, columns, searchable]);

  const pages = Math.max(1, Math.ceil(view.total / query.pageSize));
  // A page beyond the end after a filter / refresh goes back to the last page.
  useEffect(() => {
    if (rows !== null && !loading && query.page > pages) change({ page: pages });
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    change({ search: draft.trim(), field: draftField, page: 1 });
  }

  function sortBy(key: string) {
    change({ sort: key, dir: query.sort === key && query.dir === 'asc' ? 'desc' : 'asc', page: 1 });
  }

  const from = view.total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const to = Math.min(view.total, query.page * query.pageSize);
  const filtered = query.search !== '';
  const colSpan = columns.length + (actions ? 1 : 0);

  return (
    <div className={compact ? 'dt dt-compact' : 'dt'}>
      <form className="dt-bar" role="search" aria-label={`Tìm trong ${label}`} onSubmit={submit}>
        <select aria-label="Trường tìm kiếm" value={draftField ?? ''} onChange={(e) => {
          const f = e.target.value === '' ? null : e.target.value;
          setDraftField(f);
          if (!server) change({ field: f, page: 1 });
        }}>
          <option value="">Tất cả trường</option>
          {searchable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input type="search" aria-label="Từ khóa" placeholder="Tìm nhanh…" maxLength={100} value={draft} onChange={(e) => {
          setDraft(e.target.value);
          if (!server) change({ search: e.target.value.trim(), field: draftField, page: 1 });
        }} />
        {server && <button type="submit" className="fx-btn">Tìm</button>}
        {filtered && <button type="button" className="fx-btn" onClick={() => { setDraft(''); change({ search: '', field: null, page: 1 }); setDraftField(null); }}>Bỏ lọc</button>}
        {onRefresh && <button type="button" className="fx-btn" disabled={loading} onClick={onRefresh}>Tải lại</button>}
        {toolbar}
        <span className="dt-total muted">{rows === null ? '' : `${view.total} dòng${filtered ? ' (đã lọc)' : ''}`}</span>
      </form>
      {error && <div className="fx-msg error" role="alert">{error}</div>}
      <div className="dt-grid" aria-busy={loading || rows === null}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = query.sort === c.key;
                return (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined} aria-sort={sorted ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortable === false ? c.label : (
                      <button type="button" className="dt-sort" onClick={() => sortBy(c.key)} title="Sắp xếp">
                        {c.label}<span aria-hidden="true">{sorted ? (query.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span>
                      </button>
                    )}
                  </th>
                );
              })}
              {actions && <th aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {rows === null || (loading && view.page.length === 0) ? <tr><td colSpan={colSpan} className="muted">Đang tải…</td></tr>
              : view.page.length === 0 ? <tr><td colSpan={colSpan} className="muted">{filtered ? 'Không có dòng nào khớp điều kiện tìm kiếm.' : emptyText}</td></tr>
                : view.page.map((r) => {
                  const key = rowKey(r);
                  return (
                    <tr key={key} className={key === selectedKey ? 'fx-selected' : undefined}>
                      {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : c.value(r)}</td>)}
                      {actions && <td className="dt-actions">{actions(r)}</td>}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      <div className="dt-pager">
        <span className="muted">{view.total === 0 ? '0' : `${from}–${to}`} / {view.total}</span>
        <label className="muted">Số dòng/trang{' '}
          <select value={query.pageSize} onChange={(e) => change({ pageSize: Number(e.target.value), page: 1 })}>
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="fx-btn" disabled={loading || query.page <= 1} onClick={() => change({ page: 1 })} aria-label="Trang đầu">«</button>
        <button type="button" className="fx-btn" disabled={loading || query.page <= 1} onClick={() => change({ page: query.page - 1 })}>‹ Trước</button>
        <span className="muted">Trang {Math.min(query.page, pages)} / {pages}</span>
        <button type="button" className="fx-btn" disabled={loading || query.page >= pages} onClick={() => change({ page: query.page + 1 })}>Sau ›</button>
        <button type="button" className="fx-btn" disabled={loading || query.page >= pages} onClick={() => change({ page: pages })} aria-label="Trang cuối">»</button>
      </div>
    </div>
  );
}

// Name first, technical code muted (WS04).
export function NameCode({ name, code }: { name: string | null | undefined; code: string | null | undefined }) {
  const n = name?.trim() ? name : null;
  return (
    <span className="dt-namecode">
      <b>{n ?? code ?? '—'}</b>
      {n && code && <small>{code}</small>}
    </span>
  );
}
