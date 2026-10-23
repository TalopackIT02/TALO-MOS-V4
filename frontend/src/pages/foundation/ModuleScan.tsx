import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { moduleScanApi } from '../../services/foundation/moduleScanApi';
import type { CheckStatus, Classification, MicFormat, ScanReport, ScannedModule } from '../../services/foundation/moduleScanApi';
import type { ApiFailure } from '../../services/foundation/foundationApi';
import { formatTime } from './common';
import '../../styles/module-scan.css';

// FMI-01 — Manual Module Scan in Foundation › Quản lý Module › Module & Phiên bản. The scan runs ONLY when the user presses
// "Quét Module" (no effect, no timer, no retry). The result is a static preview of modules/: it registers, installs or
// activates nothing and is not runtime evidence. Hidden unless the session holds foundation.module_registry.read AND
// .create (the server checks both again).

export const SCAN_PERMISSIONS = ['foundation.module_registry.read', 'foundation.module_registry.create'] as const;
const LAST_SCAN_KEY = 'talo.fmi01.lastScanId';

type ScanState =
  | { readonly kind: 'INITIAL' }
  | { readonly kind: 'LOADING'; readonly previous: ScanReport | null }
  | { readonly kind: 'DONE'; readonly report: ScanReport; readonly stale: boolean }
  | { readonly kind: 'ERROR'; readonly failure: ApiFailure; readonly previous: ScanReport | null };

const CLASS_TEXT: Record<Classification, string> = {
  NEW_MODULE: 'Module mới', UPGRADE_CANDIDATE: 'Bản nâng cấp', EXISTING_VERSION: 'Phiên bản đã có', OLDER_PACKAGE: 'Bản cũ hơn',
  INVALID_PACKAGE: 'Package lỗi', REGISTRY_UNKNOWN: 'Không rõ (Registry lỗi)',
};
const MIC_TEXT: Record<MicFormat, string> = { JSON: 'JSON', LEGACY_TS: 'TS (cũ)', MISSING: 'Thiếu', INVALID: 'Lỗi' };
const STATUS_TEXT: Record<CheckStatus, string> = { PASS: 'Đạt', WARN: 'Cảnh báo', FAIL: 'Lỗi', UNAVAILABLE: 'Chưa xác minh' };

function failureText(f: ApiFailure): string {
  const base: Record<string, string> = {
    NETWORK: 'Không kết nối được máy chủ.',
    FORBIDDEN: 'Bạn không có đủ quyền quét module (cần đồng thời quyền xem và tạo Module Registry).',
    SCAN_IN_PROGRESS: 'Đang có lượt quét khác. Chờ lượt đó xong rồi bấm Quét Module lại.',
    SCAN_NOT_FOUND: 'Kết quả quét đã hết hạn (10 phút) hoặc không còn trên máy chủ. Bấm Quét Module để quét lại.',
    SCAN_LIMIT_EXCEEDED: 'Thư mục modules có quá nhiều package (tối đa 250).',
    SCAN_ROOT_UNAVAILABLE: 'Máy chủ không đọc được thư mục modules.',
    SCAN_INTERNAL_ERROR: 'Lỗi không xác định khi quét module.',
    SERVICE_BUSY: 'Hệ thống đang bận (không kiểm tra được quyền). Vui lòng thử lại sau.',
    UNEXPECTED_RESPONSE: 'Kết quả quét không đúng hợp đồng API; không hiển thị dữ liệu này.',
    VALIDATION_ERROR: 'Yêu cầu quét không hợp lệ.',
  };
  const text = base[f.code] ?? `Quét không thành công (HTTP ${f.status}).`;
  const detail = f.code === 'UNEXPECTED_RESPONSE' && f.details.length > 0 ? ` (${f.details.join(' — trường ')})` : '';
  return `${text}${detail}${f.requestId ? ` Mã tham chiếu: ${f.requestId}.` : ''}`;
}

const readLast = (): string | null => { try { return sessionStorage.getItem(LAST_SCAN_KEY); } catch { return null; } };
const writeLast = (id: string) => { try { sessionStorage.setItem(LAST_SCAN_KEY, id); } catch { /* storage unavailable: ignored */ } };

export function useModuleScan(onSessionLost: () => void) {
  const [state, setState] = useState<ScanState>({ kind: 'INITIAL' });
  const busy = useRef(false);
  const lastScanId = useMemo(() => readLast(), []);
  const settleResult = useCallback((r: Awaited<ReturnType<typeof moduleScanApi.scan>>, previous: ScanReport | null) => {
    if (r.ok) {
      writeLast(r.data.scanId);
      setState({ kind: 'DONE', report: r.data, stale: false });
    } else if (r.status === 401) onSessionLost();
    else setState({ kind: 'ERROR', failure: r, previous });
  }, [onSessionLost]);
  const current = (s: ScanState): ScanReport | null => (s.kind === 'DONE' ? s.report : s.kind === 'INITIAL' ? null : s.previous);
  // Manual only: called by the button, never by an effect.
  const scan = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const previous = current(state);
    setState({ kind: 'LOADING', previous });
    settleResult(await moduleScanApi.scan(), previous);
    busy.current = false;
  }, [state, settleResult]);
  // Reads the stored snapshot of the last scan of this browser tab (no new scan).
  const reopen = useCallback(async () => {
    if (busy.current || lastScanId === null) return;
    busy.current = true;
    setState({ kind: 'LOADING', previous: null });
    const r = await moduleScanApi.snapshot(lastScanId);
    if (r.ok) setState({ kind: 'DONE', report: r.data, stale: true });
    else if (r.status === 401) onSessionLost();
    else setState({ kind: 'ERROR', failure: r, previous: null });
    busy.current = false;
  }, [lastScanId, onSessionLost]);
  return { state, scan, reopen, lastScanId };
}

export function ModuleScanButton({ loading, onScan }: { loading: boolean; onScan: () => void }) {
  return (
    <button type="button" className="fx-btn primary" disabled={loading} aria-busy={loading} onClick={onScan}>
      {loading ? <><span className="ms-spinner" aria-hidden="true" /> Đang quét…</> : 'Quét Module'}
    </button>
  );
}

function StatusTag({ status }: { status: CheckStatus }) {
  return <span className={`ms-tag ms-${status.toLowerCase()}`}>{STATUS_TEXT[status]}</span>;
}

function Bars({ report }: { report: ScanReport }) {
  const { total, failed, warnings, passed, unavailable } = report.summary;
  const bar = (label: string, count: number, tone: string) => (
    <div className={`ms-bar ms-bar-${tone}`}>
      <span className="ms-bar-label">{label}</span>
      <span className="ms-bar-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
        <span className="ms-bar-fill" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
      </span>
      <b>{count}</b>
    </div>
  );
  return (
    <div className="ms-bars" aria-label="Tổng hợp kết quả quét">
      {bar('Lỗi (FAIL)', failed, 'fail')}
      {bar('Cảnh báo (WARN)', warnings, 'warn')}
      {bar('Đạt (PASS)', passed, 'pass')}
      <p className="ms-unavailable">Chưa xác minh được (UNAVAILABLE): <b>{unavailable}</b> — không tính là đạt.</p>
    </div>
  );
}

export function ModuleScanResults({ state, lastScanId, onReopen, onPreflight }: { state: ScanState; lastScanId: string | null; onReopen: () => void; onPreflight?: (scanId: string, moduleKey: string) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | CheckStatus>('ALL');
  const [detail, setDetail] = useState<ScannedModule | null>(null);
  const report = state.kind === 'DONE' ? state.report : state.kind === 'INITIAL' ? null : state.previous;
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('vi');
    return (report?.modules ?? []).filter((m) => (status === 'ALL' || m.scanStatus === status)
      && (!q || `${m.moduleName ?? ''} ${m.moduleKey ?? ''} ${m.folder}`.toLocaleLowerCase('vi').includes(q)));
  }, [report, query, status]);

  return (
    <section className="ms-panel" aria-label="Quét Module">
      {state.kind === 'ERROR' && <div className="fx-msg error" role="alert">{failureText(state.failure)}</div>}
      {state.kind === 'INITIAL' && (
        <div className="ms-empty">
          <span className="ms-empty-icon" aria-hidden="true">⌕</span>
          <p>Chép thư mục package vào <code>modules/MODULE_KEY</code> rồi bấm <b>Quét Module</b> để kiểm tra tĩnh manifest, MIC, phiên bản và route.
            Quét không đăng ký, không cài đặt và không kích hoạt module.</p>
          {lastScanId && <button type="button" className="fx-btn" onClick={onReopen}>Xem lại kết quả lần quét trước</button>}
        </div>
      )}
      {state.kind === 'LOADING' && <p className="info" role="status"><span className="ms-spinner" aria-hidden="true" /> Đang quét thư mục modules…</p>}
      {report && (
        <>
          <div className="ms-head">
            {(state.kind === 'ERROR' || (state.kind === 'LOADING' && state.previous)) && <span className="ms-tag ms-unavailable">Kết quả lần quét trước</span>}
            {state.kind === 'DONE' && state.stale && <span className="ms-tag">Kết quả đã lưu trên máy chủ</span>}
            <span>Quét lúc <b>{formatTime(report.scannedAt)}</b> · {report.summary.total} thư mục · {report.durationMs} ms</span>
            {!report.registryAvailable && <span className="ms-tag ms-unavailable">Registry không đọc được — phân loại chưa xác minh</span>}
          </div>
          {report.summary.total === 0 ? <p className="info">Đã quét xong: không có thư mục package nào trong modules/.</p> : (
            <>
              <Bars report={report} />
              <div className="fx-toolbar ms-filters">
                <input type="search" placeholder="Tìm theo tên hoặc mã module…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm module đã quét" />
                <select value={status} onChange={(e) => setStatus(e.target.value === 'ALL' ? 'ALL' : (['PASS', 'WARN', 'FAIL', 'UNAVAILABLE'] as const).find((s) => s === e.target.value) ?? 'ALL')} aria-label="Lọc theo kết quả">
                  <option value="ALL">Mọi kết quả</option>
                  <option value="FAIL">Lỗi</option>
                  <option value="WARN">Cảnh báo</option>
                  <option value="PASS">Đạt</option>
                  <option value="UNAVAILABLE">Chưa xác minh</option>
                </select>
                <span className="muted">{rows.length}/{report.modules.length} module</span>
              </div>
              <div className="ms-table-wrap">
                <table className="ms-table">
                  <thead>
                    <tr><th scope="col">Module</th><th scope="col">Phiên bản</th><th scope="col">Phân loại</th><th scope="col">MIC</th><th scope="col">Kiểm tra (đạt / cảnh báo / lỗi)</th><th scope="col">Kết quả</th><th scope="col">Preflight</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const n = (s: CheckStatus) => m.checks.filter((c) => c.status === s).length;
                      return (
                        <tr key={m.folder}>
                          <td><b>{m.moduleName ?? m.folder}</b><br /><small className="muted">{m.moduleKey ?? m.folder}</small></td>
                          <td>{m.packageVersion ?? '—'}</td>
                          <td>{CLASS_TEXT[m.classification]}{m.foundationVersionStatus ? <><br /><small className="muted">{m.foundationVersionStatus}</small></> : null}</td>
                          <td>{MIC_TEXT[m.micFormat]}</td>
                          <td>{n('PASS')} / {n('WARN')} / {n('FAIL')}{n('UNAVAILABLE') > 0 ? ` · ${n('UNAVAILABLE')} chưa xác minh` : ''}</td>
                          <td><StatusTag status={m.scanStatus} /></td>
                          <td>{m.eligibleForPreflight ? 'Đủ điều kiện' : 'Chưa'}</td>
                          <td>
                            <button type="button" className="fx-btn" onClick={() => setDetail(m)} aria-label={`Chi tiết ${m.folder}`}>Chi tiết</button>
                            {onPreflight && m.eligibleForPreflight && m.moduleKey !== null && state.kind === 'DONE' && (
                              <button type="button" className="fx-btn primary" onClick={() => onPreflight(report.scanId, m.moduleKey ?? '')}>Kiểm tra &amp; Chạy thử</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={8} className="muted">Không có module phù hợp bộ lọc.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {detail && <ScanDetailDrawer module={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function ScanDetailDrawer({ module: m, onClose }: { module: ScannedModule; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [onClose]);
  const title = `Chi tiết quét ${m.moduleKey ?? m.folder}`;
  return (
    <div className="ms-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="ms-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ms-drawer-head">
          <div><small className="muted">QUÉT MODULE · {m.folder}</small><h3>{m.moduleName ?? m.folder}</h3></div>
          <button ref={closeRef} type="button" className="ms-close" aria-label="Đóng chi tiết" onClick={onClose}>×</button>
        </header>
        <div className="ms-drawer-body">
          <h4>Tổng quan</h4>
          <dl className="ms-dl">
            <dt>Kết quả</dt><dd><StatusTag status={m.scanStatus} /></dd>
            <dt>Mã module</dt><dd>{m.moduleKey ?? '—'}</dd>
            <dt>Phiên bản</dt><dd>{m.packageVersion ?? '—'}</dd>
            <dt>Phân loại</dt><dd>{CLASS_TEXT[m.classification]}</dd>
            <dt>Đủ điều kiện Preflight</dt><dd>{m.eligibleForPreflight ? 'Có (chưa phải đã sẵn sàng kích hoạt)' : 'Chưa'}</dd>
          </dl>
          <h4>Tệp và MIC</h4>
          <dl className="ms-dl">
            <dt>Định dạng MIC</dt><dd>{MIC_TEXT[m.micFormat]}</dd>
            <dt>Số tệp</dt><dd>{m.fileCount}</dd>
            <dt>Route</dt><dd>{m.routes.length > 0 ? m.routes.join(', ') : '—'}</dd>
          </dl>
          <h4>Các phép kiểm ({m.checks.length})</h4>
          <ul className="ms-checks">
            {m.checks.map((c) => (
              <li key={c.id}><StatusTag status={c.status} /> <b>{c.id}</b> <code>{c.code}</code><span>{c.message}</span></li>
            ))}
          </ul>
          <h4>Vấn đề ({m.issues.length})</h4>
          {m.issues.length === 0 ? <p className="muted">Không có vấn đề.</p> : (
            <ul className="ms-issues">
              {m.issues.map((i, n) => (
                <li key={`${i.checkId}-${i.code}-${n}`} className={`ms-issue ms-sev-${i.severity.toLowerCase()}`}>
                  <div><b>{i.code}</b> <small>{i.severity} · {i.checkId}</small></div>
                  <p>{i.message}</p>
                  {i.path && <div><small className="muted">Tệp:</small> <code>{i.path}</code></div>}
                  {i.field && <div><small className="muted">Trường:</small> <code>{i.field}</code></div>}
                  {i.expected !== null && <div><small className="muted">Mong đợi:</small> <code>{i.expected}</code></div>}
                  {i.actual !== null && <div><small className="muted">Thực tế:</small> <code>{i.actual}</code></div>}
                  {i.remediation && <div className="ms-fix">Cách sửa: {i.remediation}</div>}
                </li>
              ))}
            </ul>
          )}
          <h4>Registry</h4>
          {m.registeredVersions.length === 0 ? <p className="muted">{m.classification === 'REGISTRY_UNKNOWN' ? 'Không đọc được Registry.' : 'Chưa có phiên bản nào đã đăng ký.'}</p> : (
            <ul className="ms-versions">{m.registeredVersions.map((v) => <li key={v.moduleVersion}>{v.moduleVersion} — {v.status}</li>)}</ul>
          )}
          <h4>Mã băm package</h4>
          <p>{m.packageHash ? <code className="ms-hash">{m.packageHash}</code> : <span className="muted">Không có (package không an toàn, vượt giới hạn hoặc thay đổi trong lúc quét).</span>}</p>
          <p className="muted ms-note">Kết quả quét là xem trước tĩnh: không đăng ký, không cài đặt, không kích hoạt và không phải bằng chứng kiểm thử runtime (MIC-10).</p>
        </div>
        <footer className="ms-drawer-foot"><button type="button" className="fx-btn" onClick={onClose}>Đóng</button></footer>
      </section>
    </div>
  );
}
