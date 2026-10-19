import { useCallback, useEffect, useState } from 'react';
import { systemTestApi } from './systemTestApi';
import type { TableInfo, TableRows } from './systemTestApi';
import { FeedbackLine } from './common';
import type { Feedback } from './common';
import { settleSt } from './common';

// TAB 2 — Xem bảng dữ liệu (read only). Left: the server allowlist B01…B14 (a table the API role cannot SELECT says so);
// right: one page of rows (default 50, max 100, order fixed by the server), header fixed, horizontal scroll. No filter,
// no SQL, no free table name, no edit / add / delete / import / export.

const PAGE_SIZES = [25, 50, 100] as const;

export function DataViewerTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [data, setData] = useState<TableRows | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [listFeedback, setListFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    void systemTestApi.tables().then((r) => setTables(settleSt(r, onSessionLost, setListFeedback) ?? []));
  }, [onSessionLost]);

  const load = useCallback(async (tableKey: string, nextPage: number, size: number) => {
    setLoading(true);
    setFeedback(null);
    const result = settleSt(await systemTestApi.rows(tableKey, nextPage, size), onSessionLost, setFeedback);
    setData(result);
    setLoading(false);
  }, [onSessionLost]);

  function choose(t: TableInfo) {
    setSelected(t.tableKey);
    setPage(1);
    setData(null);
    if (t.readable) void load(t.tableKey, 1, pageSize);
    else setFeedback({ tone: 'info', text: 'Không có quyền xem: vai trò API của hệ thống không được cấp quyền SELECT trên bảng này.' });
  }

  function go(nextPage: number) {
    if (!selected) return;
    setPage(nextPage);
    void load(selected, nextPage, pageSize);
  }

  function resize(size: number) {
    setPageSize(size);
    setPage(1);
    if (selected) void load(selected, 1, size);
  }

  const current = tables?.find((t) => t.tableKey === selected) ?? null;
  const pages = data ? Math.max(1, Math.ceil(data.totalRows / data.pageSize)) : 1;
  const from = data && data.rows.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? from + data.rows.length - (data.rows.length > 0 ? 1 : 0) : 0;

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
            <b>{current ? `${current.tableKey} · ${current.schema}.${current.table}` : 'Chọn một bảng'}</b>
            {data && <span className="muted"> · Đang hiển thị {from}–{to} / {data.totalRows} dòng</span>}
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
        <FeedbackLine feedback={feedback} />
        {current && current.hiddenColumns.length > 0 && <p className="muted st-hidden">Cột không hiển thị: {current.hiddenColumns.join(', ')}.</p>}
        {loading && <p className="muted">Đang tải…</p>}
        {data && (
          <div className="st-grid">
            <table>
              <thead><tr>{data.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {data.rows.length === 0
                  ? <tr><td colSpan={data.table.columns.length} className="muted">Không có dòng nào ở trang này.</td></tr>
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
            <span className="muted">Trang {data.page} / {pages} · sắp xếp theo {data.orderBy.join(', ')}</span>
            <button type="button" className="fx-btn" disabled={loading || data.page >= pages} onClick={() => go(data.page + 1)}>Sau ›</button>
          </div>
        )}
      </section>
    </div>
  );
}
