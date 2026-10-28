import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dataInspectorApi, describeFailure } from './dataInspectorApi';
import type { ApiResult, ColumnsView, ReadStatus, RowsView, TableEntry, TablesView } from './dataInspectorApi';
import './data-inspector.css';

// DATA_INSPECTOR screen `data.inspector` (route /data-inspector, one tab "Xem dữ liệu"), inside the Host AppShell.
// Left: every table of the current database (all schemas) with its read status, filtered locally by schema / name.
// Right: structure of the selected table and one page of its rows (default 50, max 100). Read only: no add / edit /
// delete / import / export / SQL / grant control exists. Every request is re-authorised by the server (IAM + lifecycle +
// the `admin` account gate); a refusal is shown as returned, never worked around. Values are rendered as text (React
// escapes them), NULL is shown distinctly, and excessively large cells are rejected rather than silently cut.

const PAGE_SIZES = [25, 50, 100] as const;

interface Feedback {
  readonly tone: 'error' | 'info';
  readonly text: string;
  readonly stale?: boolean; // the tableKey no longer matches the catalog → offer a catalog refresh
}

const STATUS_LABEL: Record<ReadStatus, string> = {
  READABLE: 'Đọc được',
  PARTIAL: 'Một phần cột',
  NOT_READABLE: 'Không có quyền SELECT',
  UNKNOWN: 'Không xác định',
};

function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return <div className={`fx-msg ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div>;
}

function StatusBadge({ status }: { status: ReadStatus }) {
  return <span className={`di-badge di-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

function cellClass(type: string | undefined, value: string | null): string | undefined {
  if (value === null) return 'di-null';
  if (type === 'json' || type === 'jsonb') return 'di-json';
  if (type === 'bytea') return 'di-bytea';
  return undefined;
}

export function DataInspectorScreen({ onSessionLost }: { tab: number; onSessionLost: () => void }) {
  const [catalog, setCatalog] = useState<TablesView | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFeedback, setCatalogFeedback] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<TableEntry | null>(null);
  const [structure, setStructure] = useState<ColumnsView | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureFeedback, setStructureFeedback] = useState<Feedback | null>(null);
  const [data, setData] = useState<RowsView | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsFeedback, setRowsFeedback] = useState<Feedback | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  // Only the latest request of each kind may update the screen (a slow answer for a previous table is dropped).
  const seq = useRef({ catalog: 0, structure: 0, rows: 0 });

  const settle = useCallback(<T,>(result: ApiResult<T>, report: (f: Feedback) => void): T | null => {
    if (result.ok) return result.data;
    if (result.status === 401) {
      onSessionLost();
      return null;
    }
    report({ tone: 'error', text: describeFailure(result), stale: result.code === 'CATALOG_CHANGED' || result.code === 'TABLE_NOT_FOUND' });
    return null;
  }, [onSessionLost]);

  const loadCatalog = useCallback(async () => {
    const id = ++seq.current.catalog;
    setCatalogLoading(true);
    setCatalogFeedback(null);
    const result = await dataInspectorApi.tables();
    if (id !== seq.current.catalog) return;
    setCatalog(settle(result, setCatalogFeedback));
    setCatalogLoading(false);
  }, [settle]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadRows = useCallback(async (tableKey: string, nextPage: number, size: number) => {
    const id = ++seq.current.rows;
    setRowsLoading(true);
    setRowsFeedback(null);
    const result = await dataInspectorApi.rows(tableKey, nextPage, size);
    if (id !== seq.current.rows) return;
    const rows = settle(result, setRowsFeedback);
    setData(rows);
    if (rows) setPage(rows.page);
    setRowsLoading(false);
  }, [settle]);

  const loadStructure = useCallback(async (tableKey: string) => {
    const id = ++seq.current.structure;
    setStructureLoading(true);
    setStructureFeedback(null);
    const result = await dataInspectorApi.columns(tableKey);
    if (id !== seq.current.structure) return;
    setStructure(settle(result, setStructureFeedback));
    setStructureLoading(false);
  }, [settle]);

  function choose(t: TableEntry) {
    setSelected(t);
    setStructure(null);
    setData(null);
    setRowsFeedback(null);
    setPage(1);
    seq.current.rows += 1; // drop a pending page of the previous table
    setRowsLoading(false);
    void loadStructure(t.tableKey);
    if (t.readStatus === 'NOT_READABLE') {
      setRowsFeedback({ tone: 'info', text: 'Bảng tồn tại nhưng vai trò PostgreSQL của hệ thống không được cấp quyền SELECT: chỉ hiển thị cấu trúc, không hiển thị dữ liệu.' });
    } else {
      void loadRows(t.tableKey, 1, pageSize);
    }
  }

  function go(nextPage: number, size: number = pageSize) {
    if (!selected || selected.readStatus === 'NOT_READABLE') return;
    void loadRows(selected.tableKey, nextPage, size);
  }

  function resize(size: number) {
    setPageSize(size);
    go(1, size);
  }

  function refreshCatalog() {
    setSelected(null);
    setStructure(null);
    setData(null);
    setStructureFeedback(null);
    setRowsFeedback(null);
    void loadCatalog();
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = catalog?.tables ?? [];
    return q === '' ? all : all.filter((t) => `${t.schema}.${t.table}`.toLowerCase().includes(q));
  }, [catalog, filter]);

  const from = data && data.rows.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? from + Math.max(0, data.rows.length - 1) : 0;
  const stale = rowsFeedback?.stale === true || structureFeedback?.stale === true;

  return (
    <div className="di-screen">
      <div className="di-head">
        <span className="di-readonly" title="Không có thao tác ghi dữ liệu">CHỈ ĐỌC</span>
        <span className="muted">Database hiện tại · tất cả schema · bảng thường và bảng phân vùng · dữ liệu tài khoản bị chặn ở Backend; bảng khác hiển thị nguyên giá trị khi PostgreSQL cho phép</span>
      </div>
      <div className="di-layout">
        <aside className="di-catalog" aria-label="Danh sách bảng">
          <div className="di-catalog-bar">
            <input type="search" aria-label="Tìm schema hoặc tên bảng" placeholder="Tìm schema / tên bảng…" maxLength={128} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="fx-btn" disabled={catalogLoading} onClick={refreshCatalog}>Làm mới</button>
          </div>
          <FeedbackLine feedback={catalogFeedback} />
          {catalog && !catalog.catalogComplete && <div className="fx-msg info" role="status">Danh mục bị giới hạn số lượng: chưa hiển thị toàn bộ bảng.</div>}
          {catalogLoading && <p className="muted">Đang tải danh mục…</p>}
          {catalog && <p className="muted di-count">{visible.length} / {catalog.tables.length} bảng</p>}
          {catalog && !catalogLoading && visible.length === 0 && <p className="muted">{catalog.tables.length === 0 ? 'Không có bảng nào.' : 'Không có bảng phù hợp từ khóa.'}</p>}
          <div className="di-list">
            {visible.map((t) => (
              <button type="button" key={t.tableKey} className={t.tableKey === selected?.tableKey ? 'di-item active' : 'di-item'} onClick={() => choose(t)}>
                <span className="di-name"><small>{t.schema}.</small>{t.table}</span>
                <span className="di-flags">
                  {t.readStatus !== 'READABLE' && <StatusBadge status={t.readStatus} />}
                  {t.kind === 'PARTITIONED_TABLE' && <span className="di-badge di-unknown" title="Bảng phân vùng">P</span>}
                  {t.rowSecurity && <span className="di-badge di-partial" title="Row Level Security đang bật">RLS</span>}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="di-viewer" aria-live="polite">
          {!selected && <p className="muted">Chọn một bảng ở danh sách bên trái để xem cấu trúc và dữ liệu.</p>}
          {selected && (
            <>
              <div className="di-title">
                <b>{selected.schema}.{selected.table}</b>
                <StatusBadge status={selected.readStatus} />
                {selected.rowSecurity && <span className="muted">· RLS bật: chỉ thấy các dòng mà vai trò PostgreSQL được phép xem</span>}
              </div>
              {stale && <button type="button" className="fx-btn" onClick={refreshCatalog}>Làm mới danh sách bảng</button>}

              <h4 className="di-section">Cấu trúc</h4>
              <FeedbackLine feedback={structureFeedback} />
              {structureLoading && <p className="muted">Đang tải cấu trúc…</p>}
              {structure && (
                <div className="di-grid di-grid-short">
                  <table>
                    <thead><tr><th>#</th><th>Cột</th><th>Kiểu dữ liệu</th><th>Cho phép NULL</th><th>Khóa chính</th><th>Quyền SELECT</th><th>Che dữ liệu</th></tr></thead>
                    <tbody>
                      {structure.columns.length === 0
                        ? <tr><td colSpan={7} className="muted">Bảng không có cột.</td></tr>
                        : structure.columns.map((c) => (
                          <tr key={c.ordinalPosition}>
                            <td>{c.ordinalPosition}</td><td><b>{c.name}</b></td><td>{c.dataType}</td>
                            <td>{c.nullable ? 'Có' : 'Không'}</td><td>{c.primaryKey ? 'PK' : ''}</td><td>{c.selectPrivilege ? 'Có' : 'Không'}</td>
                            <td>{c.masking === 'FULL' ? <span className="di-badge di-masked">MASKED</span> : c.masking === 'JSON_KEYS' ? <span className="muted">khóa nhạy cảm trong JSON</span> : ''}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="di-rows-bar">
                <h4 className="di-section">Dữ liệu</h4>
                <div className="fx-toolbar di-toolbar">
                  <label className="muted">Số dòng/trang{' '}
                    <select value={pageSize} disabled={rowsLoading} onChange={(e) => resize(Number(e.target.value))}>
                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <FeedbackLine feedback={rowsFeedback} />
              {rowsLoading && <p className="muted">Đang tải dữ liệu…</p>}
              {data && (
                <>
                  {data.readStatus === 'PARTIAL' && <div className="fx-msg info" role="status">Chỉ hiển thị các cột mà vai trò PostgreSQL được cấp quyền SELECT; đây không phải toàn bộ dữ liệu bảng.</div>}
                  {data.columnsLimited && <div className="fx-msg info" role="status">Bảng có nhiều cột: chỉ hiển thị {data.columns.length} cột đầu tiên.</div>}
                  {data.ordering === 'UNSTABLE_NO_KEY' && <div className="fx-msg info" role="status">Bảng không có khóa chính đọc được: thứ tự dòng giữa các trang không ổn định.</div>}
                  <div className="di-grid">
                    <table>
                      <thead><tr>{data.columns.map((c, i) => <th key={c} title={data.columnTypes[i]}>{c}{data.columnMasking[i] === 'FULL' && <span className="di-badge di-masked">MASKED</span>}<small>{data.columnTypes[i]}</small></th>)}</tr></thead>
                      <tbody>
                        {data.rows.length === 0
                          ? <tr><td colSpan={data.columns.length} className="muted">{data.page === 1 ? 'Bảng không có dòng nào (trong phạm vi được phép xem).' : 'Không có dòng nào ở trang này.'}</td></tr>
                          : data.rows.map((row, i) => (
                            <tr key={`${data.page}-${i}`}>
                              {row.cells.map((v, j) => {
                                const cut = row.truncated.includes(j);
                                const hidden = row.masked.includes(j);
                                return (
                                  <td key={data.columns[j] ?? j} className={hidden ? 'di-masked-cell' : cellClass(data.columnTypes[j], v)} title={v === null ? 'NULL' : cut ? `${v}… (đã cắt ở ${data.cellMaxChars} ký tự)` : v}>
                                    {v === null ? 'NULL' : v}{cut && <span className="di-cut">… (đã cắt)</span>}{hidden && <span className="di-badge di-masked">MASKED</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="di-pager">
                    <button type="button" className="fx-btn" disabled={rowsLoading || data.page <= 1} onClick={() => go(data.page - 1)}>‹ Trước</button>
                    <span className="muted">Trang {data.page} · dòng {from}–{to}{data.ordering === 'PRIMARY_KEY' ? ` · sắp xếp theo ${data.orderBy.join(', ')}` : ''}</span>
                    <button type="button" className="fx-btn" disabled={rowsLoading || !data.hasNext} onClick={() => go(data.page + 1)}>Tiếp ›</button>
                    <button type="button" className="fx-btn" disabled={rowsLoading} onClick={() => go(page)}>Làm mới</button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
