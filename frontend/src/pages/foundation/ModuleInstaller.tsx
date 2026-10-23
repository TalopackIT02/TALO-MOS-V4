import { useCallback, useEffect, useRef, useState } from 'react';
import { installerApi } from '../../services/foundation/moduleScanApi';
import type { Candidate, Installation, PreflightRunView, PreflightStatus, RuntimeReleaseView } from '../../services/foundation/moduleScanApi';
import type { ApiFailure, ApiResult } from '../../services/foundation/foundationApi';
import { INSTALLED } from '../../routes/moduleScreens';
import { formatTime } from './common';
import '../../styles/module-scan.css';

// FMI-02 / FMI-03 — "Kiểm tra & Chạy thử" and "Cài đặt & Kích hoạt" in Foundation › Quản lý Module. A candidate is created
// from a stored scan result (button on a scanned package); the preflight runs on the server (this screen only polls the
// run, at most every 2 s, and stops when it ends); the install plan is a dry run until "Cài đặt & Kích hoạt" is confirmed.
// ACTIVE is never shown from an HTTP 200 alone: only the server state INSTALLED_ACTIVE (postcheck PASS) says so.

export interface CandidateRequest { readonly scanId: string; readonly moduleKey: string; readonly nonce: number }

const PF_TEXT: Record<PreflightStatus, string> = { PASS: 'Đạt', WARN: 'Cảnh báo', FAIL: 'Lỗi', NOT_TESTED: 'Chưa kiểm', UNAVAILABLE: 'Chưa xác minh' };
const CANDIDATE_TEXT: Record<string, string> = {
  SCANNED: 'Đã quét', VALIDATING: 'Đang kiểm tra', NEEDS_FIX: 'Cần sửa', READY: 'Sẵn sàng (READY)', INVALIDATED: 'Mất hiệu lực', CANCELLED: 'Đã hủy', ERROR: 'Lỗi engine',
};
const STATE_TEXT: Record<string, string> = {
  PREPARED: 'Kế hoạch hợp lệ (chưa thực hiện)', BLOCKED: 'Bị chặn', PREPARING: 'Đang chuẩn bị', STAGED: 'Đã lưu release', PUBLISHING: 'Đang ghi B01/B02/MIC',
  AWAITING_RESTART: 'Chờ khởi động lại', CUTTING_OVER: 'Đang kích hoạt', POSTCHECK: 'Đang hậu kiểm', INSTALLED_ACTIVE: 'Đã cài đặt & hoạt động',
  RECOVERY_REQUIRED: 'Cần phục hồi', FAILED_SAFE: 'Dừng an toàn', EXPIRED: 'Kế hoạch hết hạn',
};
const FAILURES: Record<string, string> = {
  NETWORK: 'Không kết nối được máy chủ.', FORBIDDEN: 'Bạn không có đủ quyền cho thao tác này.', SCAN_NOT_FOUND: 'Kết quả quét đã hết hạn (10 phút). Bấm Quét Module lại.',
  CANDIDATE_NOT_ELIGIBLE: 'Package chưa đủ điều kiện kiểm tra (còn lỗi quét tĩnh).', PACKAGE_CHANGED: 'Package đã thay đổi sau lần quét: bấm Quét Module lại.',
  PREFLIGHT_IN_PROGRESS: 'Đang có lượt kiểm tra khác, vui lòng chờ.', CANDIDATE_STATE_CONFLICT: 'Candidate không ở trạng thái cho phép thao tác này.',
  PLAN_EXPIRED: 'Kế hoạch đã hết hạn hoặc không còn hợp lệ: lập kế hoạch lại.', PLAN_BLOCKED: 'Kế hoạch còn điều kiện chặn: không thực hiện.',
  RESTART_PENDING: 'Backend / Frontend chưa nạp release mới: khởi động lại rồi bấm Tiếp tục.', INSTALL_IN_PROGRESS: 'Module đang có một lượt cài đặt khác.',
  INSTALL_STATE_CONFLICT: 'Lượt cài đặt không ở trạng thái cho phép thao tác này.', SERVICE_BUSY: 'Hệ thống đang bận (không kiểm tra được quyền).',
  UNEXPECTED_RESPONSE: 'API trả dữ liệu không đúng hợp đồng; dữ liệu không được hiển thị.', VALIDATION_ERROR: 'Yêu cầu không hợp lệ.',
};
function failureText(f: ApiFailure): string {
  const base = FAILURES[f.code] ?? `Thao tác không thành công (HTTP ${f.status}, ${f.code}).`;
  const details = f.details.length > 0 ? ` (${f.details.join(', ')})` : '';
  return `${base}${details}${f.requestId ? ` Mã tham chiếu: ${f.requestId}.` : ''}`;
}
const short = (h: string | null) => (h ? `${h.slice(0, 12)}…` : '—');
const POLL_MS = 2000;
const MAX_POLLS = 600;

function Tag({ status }: { status: PreflightStatus | 'PASS' | 'FAIL' }) {
  return <span className={`ms-tag ms-${status === 'NOT_TESTED' ? 'unavailable' : status.toLowerCase()}`}>{PF_TEXT[status]}</span>;
}

export function ModuleInstaller({ request, canInstall, onSessionLost }: { request: CandidateRequest | null; canInstall: boolean; onSessionLost: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [run, setRun] = useState<PreflightRunView | null>(null);
  const [plan, setPlan] = useState<Installation | null>(null);
  const [ack, setAck] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeReleaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Passive reads (runtime, recent candidates): a failure is a quiet note, never an alert (alerts = the user's actions).
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const settle = useCallback(<T,>(r: ApiResult<T>): T | null => {
    if (r.ok) return r.data;
    if (r.status === 401) onSessionLost();
    else setError(failureText(r));
    return null;
  }, [onSessionLost]);

  const quiet = useCallback(<T,>(r: ApiResult<T>): T | null => {
    if (r.ok) return r.data;
    if (r.status === 401) onSessionLost();
    else setNote(`Không đọc được thông tin runtime / candidate: ${failureText(r)}`);
    return null;
  }, [onSessionLost]);
  const loadRuntime = useCallback(async () => setRuntime(quiet(await installerApi.runtimeRelease())), [quiet]);
  const loadCandidates = useCallback(async () => setCandidates(quiet(await installerApi.listCandidates()) ?? []), [quiet]);
  useEffect(() => {
    void loadRuntime();
    void loadCandidates();
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [loadRuntime, loadCandidates]);

  const poll = useCallback((c: Candidate, runId: string, n = 0) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const r = settle(await installerApi.getRun(c.candidateId, runId));
      if (r === null) return;
      setRun(r);
      if (r.status === 'RUNNING' && n < MAX_POLLS) poll(c, runId, n + 1);
      else {
        const fresh = settle(await installerApi.getCandidate(c.candidateId));
        if (fresh) setCandidate(fresh);
        void loadCandidates();
      }
    }, POLL_MS);
  }, [settle, loadCandidates]);

  const openCandidate = useCallback(async (c: Candidate) => {
    setCandidate(c);
    setPlan(null);
    setAck(false);
    setError(null);
    setRun(null);
    if (c.latestRunId) {
      const r = settle(await installerApi.getRun(c.candidateId, c.latestRunId));
      if (r) {
        setRun(r);
        if (r.status === 'RUNNING') poll(c, r.runId);
      }
    }
  }, [settle, poll]);

  // A new request from the scan table: create (or reuse) the candidate of that scan result.
  useEffect(() => {
    if (request === null) return;
    void (async () => {
      setBusy(true);
      setError(null);
      const c = settle(await installerApi.createCandidate(request.scanId, request.moduleKey));
      setBusy(false);
      if (c) {
        await openCandidate(c);
        void loadCandidates();
      }
    })();
  }, [request, settle, openCandidate, loadCandidates]);

  async function startRun() {
    if (!candidate || busy) return;
    setBusy(true);
    setError(null);
    setPlan(null);
    const r = settle(await installerApi.startPreflight(candidate.candidateId));
    setBusy(false);
    if (r) {
      setCandidate({ ...candidate, status: 'VALIDATING', latestRunId: r.runId });
      setRun(null);
      poll(candidate, r.runId);
    }
  }

  async function prepare() {
    if (!candidate || busy) return;
    setBusy(true);
    setError(null);
    setAck(false);
    setPlan(settle(await installerApi.prepare(candidate.candidateId)));
    setBusy(false);
  }

  async function commit() {
    if (!candidate || !plan || busy || !ack) return;
    setBusy(true);
    setError(null);
    const r = settle(await installerApi.commit(candidate.candidateId, plan.installId));
    if (r) setPlan(r);
    setBusy(false);
    void loadRuntime();
  }

  async function resume() {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    const r = settle(await installerApi.continueInstall(plan.installId));
    if (r) setPlan(r);
    else {
      const fresh = settle(await installerApi.getInstallation(plan.installId));
      if (fresh) setPlan(fresh);
    }
    setBusy(false);
    void loadRuntime();
  }

  const count = (s: PreflightStatus) => run?.checks.filter((c) => c.status === s).length ?? 0;
  const bundle = INSTALLED.map((m) => ({ moduleKey: m.manifest.moduleKey, packageVersion: m.manifest.packageVersion, packageHash: m.manifest.packageHash ?? null }));
  const canCommit = plan !== null && plan.state === 'PREPARED' && plan.blockers.length === 0 && ack && !busy;

  return (
    <section className="ms-panel ms-installer" aria-label="Kiểm tra và cài đặt module">
      <h3>Kiểm tra & Cài đặt module</h3>
      {error && <div className="fx-msg error" role="alert">{error}</div>}
      {note && <p className="muted">{note}</p>}

      <details className="ms-runtime" open={runtime !== null && !runtime.matches}>
        <summary>
          Runtime đang chạy: {runtime === null ? 'chưa đọc được' : runtime.matches ? <span className="ms-tag ms-pass">Backend = Frontend = lock</span> : <span className="ms-tag ms-fail">Lệch lock — cần khởi động lại</span>}
          {runtime && <span className="muted"> · DB {runtime.environment.database} · supervisor: {runtime.supervisor === 'NONE' ? 'không có (khởi động lại thủ công)' : runtime.supervisor}</span>}
        </summary>
        {runtime && (
          <table className="ms-table">
            <thead><tr><th scope="col">Module</th><th scope="col">Lock</th><th scope="col">Backend đang chạy</th><th scope="col">Frontend (registry)</th><th scope="col">Trình duyệt (bundle)</th></tr></thead>
            <tbody>
              {runtime.lock.map((l) => {
                const cell = (list: { moduleKey: string; packageVersion: string; packageHash: string | null }[]) => {
                  const x = list.find((m) => m.moduleKey === l.moduleKey);
                  return x ? `${x.packageVersion} · ${short(x.packageHash)}` : '—';
                };
                return <tr key={l.moduleKey}><td>{l.moduleKey}</td><td>{l.packageVersion} · {short(l.packageHash)}</td><td>{cell(runtime.backend)}</td><td>{cell(runtime.frontend)}</td><td>{cell(bundle)}</td></tr>;
              })}
            </tbody>
          </table>
        )}
      </details>

      {candidates.length > 0 && (
        <div className="ms-candidates">
          <b>Candidate gần đây:</b>
          {candidates.slice(0, 8).map((c) => (
            <button key={c.candidateId} type="button" className={`fx-btn${candidate?.candidateId === c.candidateId ? ' primary' : ''}`} onClick={() => void openCandidate(c)}>
              {c.moduleKey} {c.packageVersion} · {CANDIDATE_TEXT[c.status] ?? c.status}
            </button>
          ))}
        </div>
      )}
      {candidate === null ? (
        <p className="muted">Bấm <b>Kiểm tra & Chạy thử</b> ở một package đủ điều kiện trong kết quả quét để tạo candidate.</p>
      ) : (
        <div className="ms-candidate">
          <dl className="ms-dl">
            <dt>Module</dt><dd><b>{candidate.moduleName}</b> <small className="muted">{candidate.moduleKey} {candidate.packageVersion} · {candidate.classification}</small></dd>
            <dt>Trạng thái</dt><dd>{CANDIDATE_TEXT[candidate.status] ?? candidate.status}</dd>
            <dt>Package SHA-256</dt><dd><code className="ms-hash">{candidate.sourceHash}</code></dd>
            <dt>Thư mục</dt><dd><code>modules/{candidate.folder}</code> · quét {candidate.scanId.slice(0, 8)}</dd>
          </dl>
          <div className="fx-toolbar">
            <button type="button" className="fx-btn primary" disabled={busy || candidate.status === 'VALIDATING' || candidate.status === 'INVALIDATED' || candidate.status === 'CANCELLED'} onClick={() => void startRun()}>
              {candidate.status === 'VALIDATING' ? <><span className="ms-spinner" aria-hidden="true" /> Đang kiểm tra…</> : 'Kiểm tra & Chạy thử'}
            </button>
            {run && run.status !== 'RUNNING' && (
              <>
                <button type="button" className="fx-btn" onClick={() => void installerApi.downloadRunReport(candidate.candidateId, run.runId, 'txt').then(settle)}>Tải báo cáo TXT</button>
                <button type="button" className="fx-btn" onClick={() => void installerApi.downloadRunReport(candidate.candidateId, run.runId, 'json').then(settle)}>Tải JSON</button>
              </>
            )}
            {candidate.status === 'INVALIDATED' && <span className="muted">Package đã thay đổi: bấm Quét Module lại rồi chọn lại package.</span>}
          </div>

          {run && (
            <>
              <p>Lượt <code>{run.runId.slice(0, 8)}</code> · bắt đầu {formatTime(run.startedAt)} · {run.status === 'RUNNING' ? 'đang chạy…' : `kết thúc ${formatTime(run.finishedAt)}`}
                {run.result && <> · Kết luận: <b>{run.result}</b></>}{run.reportHash && <> · báo cáo <code>{short(run.reportHash)}</code></>}</p>
              <div className="ms-bars" aria-label="Tổng hợp kiểm tra">
                <p><span className="ms-tag ms-fail">Lỗi {count('FAIL')}</span> <span className="ms-tag ms-warn">Cảnh báo {count('WARN')}</span> <span className="ms-tag ms-pass">Đạt {count('PASS')}</span></p>
                <p className="ms-unavailable">Chưa kiểm / chưa xác minh: <b>{count('NOT_TESTED') + count('UNAVAILABLE')}</b> — không tính là đạt, chặn READY.</p>
              </div>
              <ul className="ms-checks">
                {run.checks.map((c) => (
                  <li key={c.id}>
                    <Tag status={c.status} /> <b>{c.id}</b> {c.label}<span>{c.detail}</span>
                    {(c.issues.length > 0 || c.limitations.length > 0 || c.logHash) && (
                      <button type="button" className="fx-btn" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Ẩn chi tiết' : 'Chi tiết'}</button>
                    )}
                    {open === c.id && (
                      <div className="ms-issue">
                        {c.issues.map((i, n) => (
                          <div key={n}>
                            <p>{i.message}</p>
                            {i.path && <div><small className="muted">Tệp:</small> <code>{i.path}</code></div>}
                            {i.field && <div><small className="muted">Trường / endpoint:</small> <code>{i.field}</code></div>}
                            {i.expected && <div><small className="muted">Mong đợi:</small> <code>{i.expected}</code></div>}
                            {i.actual && <div><small className="muted">Thực tế:</small> <code>{i.actual}</code></div>}
                          </div>
                        ))}
                        {c.limitations.map((l) => <p key={l} className="muted">Giới hạn: {l}</p>)}
                        {c.logHash && <p className="muted">Log đã lọc (trong báo cáo): sha256 {short(c.logHash)} · exit {c.exitCode ?? '—'} · {c.durationMs} ms</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {candidate.status === 'READY' && canInstall && (
            <div className="fx-toolbar">
              <button type="button" className="fx-btn" disabled={busy} onClick={() => void prepare()}>Xem kế hoạch cài đặt</button>
            </div>
          )}
          {plan && (
            <div className="ms-plan">
              <p><b>Cài đặt {plan.moduleKey} {plan.packageVersion}</b> ({plan.classification}) · trạng thái: <b>{STATE_TEXT[plan.state] ?? plan.state}</b>
                {plan.state === 'PREPARED' && <> · hết hạn {formatTime(plan.expiresAt)}</>}</p>
              {plan.blockers.length > 0 && (
                <ul className="ms-issues">{plan.blockers.map((b) => <li key={b.code} className="ms-issue ms-sev-error"><b>{b.code}</b><p>{b.message}</p></li>)}</ul>
              )}
              {plan.warnings.length > 0 && <ul>{plan.warnings.map((w) => <li key={w} className="muted">{w}</li>)}</ul>}
              <ol className="ms-steps">
                {plan.steps.map((s) => <li key={s.key}><span className={`ms-tag ms-${s.status === 'DONE' ? 'pass' : s.status === 'FAILED' ? 'fail' : 'unavailable'}`}>{s.status}</span> {s.label}{s.detail && <small className="muted"> — {s.detail}</small>}</li>)}
              </ol>
              {plan.postcheck.length > 0 && <ul className="ms-checks">{plan.postcheck.map((p) => <li key={p.key}><Tag status={p.status} /> <b>{p.key}</b><span>{p.detail}</span></li>)}</ul>}
              {plan.recovery.length > 0 && <div className="fx-msg error">{plan.recovery.map((x) => <p key={x}>{x}</p>)}</div>}
              {plan.state === 'PREPARED' && (
                <div className="fx-toolbar">
                  <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi đã đọc kế hoạch và cảnh báo</label>
                  <button type="button" className="fx-btn primary" disabled={!canCommit} onClick={() => void commit()}>Cài đặt & Kích hoạt</button>
                </div>
              )}
              {(plan.state === 'AWAITING_RESTART' || plan.state === 'RECOVERY_REQUIRED') && (
                <div className="fx-toolbar">
                  {plan.state === 'AWAITING_RESTART' && <span className="info">Chưa có deploy supervisor: khởi động lại Backend và Frontend (npm run dev) rồi bấm Tiếp tục.</span>}
                  <button type="button" className="fx-btn primary" disabled={busy} onClick={() => void resume()}>Tiếp tục</button>
                </div>
              )}
              {plan.state !== 'PREPARED' && plan.state !== 'BLOCKED' && (
                <button type="button" className="fx-btn" onClick={() => void installerApi.downloadInstallReport(plan.installId).then(settle)}>Tải báo cáo cài đặt</button>
              )}
              {plan.state === 'INSTALLED_ACTIVE' && <div className="fx-msg success">Đã cài đặt: B02 ACTIVE, runtime khớp, danh mục IAM và menu đã sẵn sàng, hậu kiểm PASS. Gán quyền cho người dùng trong màn hình IAM.</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
