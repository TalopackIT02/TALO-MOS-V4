import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { NO_ROWS_VIEW, systemTestApi } from './systemTestApi';
import type { RowsView, TableInfo, TableRows } from './systemTestApi';
import { FeedbackLine } from './common';
import type { Feedback } from './common';
import { settleSt } from './common';

// TAB 2 — Xem bảng dữ liệu (read only). Left: the server allowlist B01…B14 (a table the API role cannot SELECT says so);
// right: one page of rows (default 50, max 100), header fixed, horizontal scroll. Search (all shown columns or one
// column) and sort (click a column header) run on the server against the allowlist only — no SQL, no free table or
// column name, no edit / add / delete / import / export.

const PAGE_SIZES = [25, 50, 100] as const;

export function DataViewerTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [view, setView] = useState<RowsView>(NO_ROWS_VIEW);
  const [draft, setDraft] = useState('');
  const [draftField, setDraftField] = useState<string | null>(null);
  const [data, setData] = useState<TableRows | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [listFeedback, setListFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    void systemTestApi.tables().then((r) => setTables(settleSt(r, onSessionLost, setListFeedback) ?? []));
  }, [onSessionLost]);

  const load = useCallback(async (tableKey: string, nextPage: number, size: number, nextView: RowsView) => {
    setLoading(true);
    setFeedback(null);
    const result = settleSt(await systemTestApi.rows(tableKey, nextPage, size, nextView), onSessionLost, setFeedback);
    setData(result);
    setLoading(false);
  }, [onSessionLost]);

  function choose(t: TableInfo) {
    setSelected(t.tableKey);
    setPage(1);
    setData(null);
    setView(NO_ROWS_VIEW);
    setDraft('');
    setDraftField(null);
    if (t.readable) void load(t.tableKey, 1, pageSize, NO_ROWS_VIEW);
    else setFeedback({ tone: 'info', text: 'Không có quyền xem: vai trò API của hệ thống không được cấp quyền SELECT trên bảng này.' });
  }

  function go(nextPage: number, nextView: RowsView = view, size: number = pageSize) {
    if (!selected) return;
    setPage(nextPage);
    setView(nextView);
    void load(selected, nextPage, size, nextView);
  }

  function resize(size: number) {
    setPageSize(size);
    go(1, view, size);
  }

  function search(e: FormEvent) {
    e.preventDefault();
    go(1, { ...view, search: draft.trim(), field: draftField });
  }

  function clearSearch() {
    setDraft('');
    setDraftField(null);
    go(1, { ...view, search: '', field: null });
  }

  function sortBy(column: string) {
    const dir = view.sort === column && view.dir === 'asc' ? 'desc' : 'asc';
    go(1, { ...view, sort: column, dir });
  }

  const current = tables?.find((t) => t.tableKey === selected) ?? null;
  const pages = data ? Math.max(1, Math.ceil(data.totalRows / data.pageSize)) : 1;
  const from = data && data.rows.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? from + data.rows.length - (data.rows.length > 0 ? 1 : 0) : 0;
  const filtered = view.search !== '';
  const arrow = (c: string) => (view.sort === c ? (view.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="st-viewer">
      <aside className="st-tables" aria-label="Danh sách bảng">
        <FeedbackLine feedback={listFeedback} />
        {tables === null ? <p className="muted">Đang tải…</p> : tables.map((t) => (
          <button type="button" key={t.tableKey} className={t.tableKey === selected ? 'st-table active' : 'st-table'} onClick={() => choose(t)}>
            <b>{t.tableKey}</b> <span>{t.label}</span>
            <small>{t.schema}.{t.table}</small>
            {!t.readable && <em>Không có quyền xem</em>}
          </button>
        ))}
      </aside>
      <section className="st-content">
        <div className="st-content-bar">
          <div>
            <b>{current ? `${current.tableKey} · ${current.label}` : 'Chọn một bảng'}</b>
            {current && <span className="muted"> · {current.schema}.{current.table}</span>}
            {data && <span className="muted"> · {from}–{to} / {data.totalRows} dòng{filtered ? ' (đã lọc)' : ''}</span>}
          </div>
          <div className="fx-toolbar" style={{ marginBottom: 0 }}>
            <label className="muted">Số dòng/trang{' '}
              <select value={pageSize} onChange={(e) => resize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className="fx-btn" disabled={!current?.readable || loading} onClick={() => go(page)}>Tải lại</button>
          </div>
        </div>
        {current?.readable && (
          <form className="fx-toolbar st-search" onSubmit={search} role="search">
            <select aria-label="Tìm trong cột" value={draftField ?? ''} onChange={(e) => setDraftField(e.target.value === '' ? null : e.target.value)}>
              <option value="">Tất cả cột</option>
              {current.columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input aria-label="Từ khóa" placeholder="Tìm kiếm…" maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="fx-btn" disabled={loading}>Tìm</button>
            {filtered && <button type="button" className="fx-btn" disabled={loading} onClick={clearSearch}>Bỏ lọc</button>}
          </form>
        )}
        <FeedbackLine feedback={feedback} />
        {current && current.hiddenColumns.length > 0 && <p className="muted st-hidden">Cột không hiển thị: {current.hiddenColumns.join(', ')}.</p>}
        {loading && <p className="muted">Đang tải…</p>}
        {data && (
          <div className="st-grid">
            <table>
              <thead><tr>{data.table.columns.map((c) => (
                <th key={c} aria-sort={view.sort === c ? (view.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="st-sort" title="Sắp xếp theo cột này" onClick={() => sortBy(c)}>{c}{arrow(c)}</button>
                </th>
              ))}</tr></thead>
              <tbody>
                {data.rows.length === 0
                  ? <tr><td colSpan={data.table.columns.length} className="muted">{filtered ? 'Không có dòng nào khớp điều kiện lọc.' : 'Không có dòng nào ở trang này.'}</td></tr>
                  : data.rows.map((row, i) => (
                    <tr key={`${data.page}-${i}`}>{row.map((v, j) => <td key={data.table.columns[j] ?? j} className={v === null ? 'st-null' : undefined}>{v ?? 'NULL'}</td>)}</tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="st-pager">
            <button type="button" className="fx-btn" disabled={loading || data.page <= 1} onClick={() => go(data.page - 1)}>‹ Trước</button>
            <span className="muted">Trang {data.page} / {pages} · sắp xếp theo {[...(view.sort ? [`${view.sort} ${view.dir}`] : []), ...data.orderBy].join(', ')}</span>
            <button type="button" className="fx-btn" disabled={loading || data.page >= pages} onClick={() => go(data.page + 1)}>Sau ›</button>
          </div>
        )}
      </section>
    </div>
  );
}
