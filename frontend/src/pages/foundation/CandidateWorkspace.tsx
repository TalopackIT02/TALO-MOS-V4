import { useCallback, useEffect, useRef, useState } from 'react';
import { installerApi } from '../../services/foundation/moduleScanApi';
import type { Candidate, Installation, PreflightCheckView, PreflightRunView, PreflightStatus, RuntimeReleaseView } from '../../services/foundation/moduleScanApi';
import type { ApiFailure, ApiResult } from '../../services/foundation/foundationApi';
import { INSTALLED } from '../../routes/moduleScreens';
import { SCREENS } from '../../routes/shellScreens';
import type { OpenPath } from '../../routes/navigation';
import { formatTime } from './common';
import { ConfirmModal, Drawer } from './Overlay';
import '../../styles/module-scan.css';

// FOUNDATION-REV-01 REV-B — Candidate Workspace (/foundation/modules/candidates/:candidateId), a page of "Quản lý Module".
// Stepper 1 Quét → 2 Kiểm tra & Chạy thử → 3 Kế hoạch → 4 Cài đặt & Hậu kiểm. Everything shown is read from the server
// (candidate, last run, last installation journal: it survives a reload or a server restart). Details of one check open
// in the right drawer; the install is confirmed in a popup (the server re-checks every gate). READY ≠ installable ≠ ACTIVE:
// only the server state INSTALLED_ACTIVE (B02 ACTIVE + runtime + IAM catalog / policy / access + B09 + postcheck) says so.

const PF_TEXT: Record<PreflightStatus, string> = { PASS: 'Đạt', WARN: 'Cảnh báo', FAIL: 'Lỗi', NOT_TESTED: 'Chưa kiểm', UNAVAILABLE: 'Chưa xác minh', NOT_APPLICABLE: 'Không áp dụng' };
const CANDIDATE_TEXT: Record<string, string> = {
  SCANNED: 'Đã quét', VALIDATING: 'Đang kiểm tra', NEEDS_FIX: 'Cần sửa', READY: 'Sẵn sàng (READY — chưa phải ACTIVE)', INVALIDATED: 'Mất hiệu lực (package đã đổi)', CANCELLED: 'Đã hủy', ERROR: 'Lỗi engine',
};
const STATE_TEXT: Record<string, string> = {
  PREPARED: 'Kế hoạch hợp lệ (chưa thực hiện)', BLOCKED: 'Bị chặn', PREPARING: 'Đang chuẩn bị', STAGED: 'Đã lưu release', PUBLISHING: 'Đang ghi B01 / B02 / MIC',
  AWAITING_RESTART: 'Chờ khởi động lại', CUTTING_OVER: 'Đang kích hoạt', POSTCHECK: 'Đang hậu kiểm', INSTALLED_ACTIVE: 'Đã cài đặt & hoạt động',
  POSTCHECK_INCOMPLETE: 'Đã cài, hậu kiểm chưa đủ (chưa chứng minh truy cập)', RECOVERY_REQUIRED: 'Cần phục hồi', RECOVERY_AWAITING_RESTART: 'Đã khôi phục lock (và B02 nếu cần) — chờ khởi động lại để xác minh', RECOVERED: 'Đã phục hồi phiên bản trước (đã xác minh — không phải INSTALLED_ACTIVE)', FAILED_SAFE: 'Dừng an toàn', EXPIRED: 'Kế hoạch hết hạn',
};
const FAILURES: Record<string, string> = {
  NETWORK: 'Không kết nối được máy chủ.', FORBIDDEN: 'Bạn không có đủ quyền cho thao tác này.', CANDIDATE_NOT_FOUND: 'Không tìm thấy candidate (đường dẫn sai hoặc đã bị xóa).',
  PACKAGE_CHANGED: 'Package đã thay đổi sau lần quét: bấm Quét Module lại.', PREFLIGHT_IN_PROGRESS: 'Đang có lượt kiểm tra khác, vui lòng chờ.',
  CANDIDATE_STATE_CONFLICT: 'Candidate không ở trạng thái cho phép thao tác này.', PLAN_EXPIRED: 'Kế hoạch đã hết hạn hoặc không còn hợp lệ: lập kế hoạch lại.',
  PLAN_BLOCKED: 'Kế hoạch còn điều kiện chặn: không thực hiện.', RESTART_PENDING: 'Backend / Frontend chưa nạp release mới: khởi động lại rồi bấm Tiếp tục.',
  INSTALL_IN_PROGRESS: 'Module đang có một lượt cài đặt khác.', INSTALL_STATE_CONFLICT: 'Lượt cài đặt không ở trạng thái cho phép thao tác này.',
  UPGRADE_RECOVERY_UNAVAILABLE: 'Module có phiên bản ACTIVE nhưng không có điểm phục hồi hợp lệ (lock / release cũ): cutover bị chặn.',
  UPGRADE_STATE_MISMATCH: 'Trạng thái phiên bản không khớp điểm phục hồi của lượt cài đặt: không tiếp tục (không đoán).',
  CLOSE_NOT_APPLICABLE: 'Chỉ đóng được lượt cài đặt module mới thất bại (RECOVERY_REQUIRED, không phải nâng cấp).',
  JOURNAL_STATE_MISMATCH: 'Module / phiên bản hiện tại không khớp nhật ký cài đặt: không đóng (không đoán). Kiểm tra trong Quản lý Module.',
  SERVICE_BUSY: 'Hệ thống đang bận (không kiểm tra được quyền).', UNEXPECTED_RESPONSE: 'API trả dữ liệu không đúng hợp đồng; dữ liệu không được hiển thị.', VALIDATION_ERROR: 'Yêu cầu không hợp lệ.',
};
function failureText(f: ApiFailure): string {
  const base = FAILURES[f.code] ?? `Thao tác không thành công (HTTP ${f.status}, ${f.code}).`;
  return `${base}${f.details.length > 0 ? ` (${f.details.join(', ')})` : ''}${f.requestId ? ` Mã tham chiếu: ${f.requestId}.` : ''}`;
}
const short = (h: string | null) => (h ? `${h.slice(0, 12)}…` : '—');
const POLL_MS = 2000;
const MAX_POLLS = 600;

function Tag({ status }: { status: PreflightStatus | 'PASS' | 'FAIL' | 'NOT_TESTED' }) {
  const tone = status === 'NOT_TESTED' || status === 'NOT_APPLICABLE' ? 'unavailable' : status.toLowerCase();
  return <span className={`ms-tag ms-${tone}`}>{PF_TEXT[status]}</span>;
}

type StepState = 'done' | 'current' | 'blocked' | 'todo';

export function CandidateWorkspace({ candidateId, canInstall, onSessionLost, onOpenPath }: { candidateId: string; canInstall: boolean; onSessionLost: () => void; onOpenPath: OpenPath }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [run, setRun] = useState<PreflightRunView | null>(null);
  const [plan, setPlan] = useState<Installation | null>(null);
  const [runtime, setRuntime] = useState<RuntimeReleaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<PreflightCheckView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
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
    else setNote(`Không đọc được thông tin runtime: ${failureText(r)}`);
    return null;
  }, [onSessionLost]);

  const poll = useCallback((runId: string, n = 0) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const r = settle(await installerApi.getRun(candidateId, runId));
      if (r === null) return;
      setRun(r);
      if (r.status === 'RUNNING' && n < MAX_POLLS) poll(runId, n + 1);
      else {
        const c = settle(await installerApi.getCandidate(candidateId));
        if (c) setCandidate(c);
      }
    }, POLL_MS);
  }, [candidateId, settle]);

  // Everything from the server: candidate → its last run → its last installation (journal survives any restart).
  const load = useCallback(async () => {
    const r = await installerApi.getCandidate(candidateId);
    if (!r.ok) {
      if (r.status === 401) onSessionLost();
      else setLoadFailure(failureText(r));
      return;
    }
    setCandidate(r.data);
    if (r.data.latestRunId) {
      const pr = settle(await installerApi.getRun(candidateId, r.data.latestRunId));
      if (pr) {
        setRun(pr);
        if (pr.status === 'RUNNING') poll(pr.runId);
      }
    }
    if (r.data.latestInstallId) setPlan(settle(await installerApi.getInstallation(r.data.latestInstallId)));
    setRuntime(quiet(await installerApi.runtimeRelease()));
  }, [candidateId, onSessionLost, settle, quiet, poll]);

  useEffect(() => {
    void load();
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [load]);

  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }
  const startRun = () => act(async () => {
    const r = settle(await installerApi.startPreflight(candidateId));
    if (r && candidate) {
      setCandidate({ ...candidate, status: 'VALIDATING', latestRunId: r.runId });
      setRun(null);
      setPlan(null);
      poll(r.runId);
    }
  });
  const prepare = () => act(async () => { setPlan(settle(await installerApi.prepare(candidateId))); });
  const commit = () => act(async () => {
    if (!plan) return;
    const r = settle(await installerApi.commit(candidateId, plan.installId));
    setConfirm(false);
    if (r) setPlan(r);
    setRuntime(quiet(await installerApi.runtimeRelease()));
  });
  const closeFailed = () => act(async () => {
    if (!plan) return;
    const r = settle(await installerApi.closeFailed(plan.installId));
    setCloseConfirm(false);
    const fresh = r ?? settle(await installerApi.getInstallation(plan.installId));
    if (fresh) setPlan(fresh);
  });
  const resume = () => act(async () => {
    if (!plan) return;
    const r = settle(await installerApi.continueInstall(plan.installId));
    const fresh = r ?? settle(await installerApi.getInstallation(plan.installId));
    if (fresh) setPlan(fresh);
    setRuntime(quiet(await installerApi.runtimeRelease()));
  });

  const back = <button type="button" className="fx-btn" onClick={() => onOpenPath(SCREENS.module.path)}>← Quản lý Module</button>;
  if (loadFailure) return <><div className="fx-toolbar">{back}</div><div className="fx-msg error" role="alert">{loadFailure}</div></>;
  if (!candidate) return <><div className="fx-toolbar">{back}</div><p className="info" role="status">Đang tải candidate…</p></>;

  const required = run?.checks.filter((c) => c.required) ?? [];
  const accepted = required.filter((c) => c.status === 'PASS' || c.status === 'NOT_APPLICABLE').length;
  const requiredOpen = required.filter((c) => c.status === 'NOT_TESTED' || c.status === 'UNAVAILABLE').length;
  const optionalOpen = run?.checks.filter((c) => !c.required && c.status !== 'PASS').length ?? 0;
  const count = (s: PreflightStatus) => run?.checks.filter((c) => c.status === s).length ?? 0;
  const ready = candidate.status === 'READY';
  const step = (n: number): StepState => {
    if (n === 1) return 'done';
    if (n === 2) return ready ? 'done' : candidate.status === 'INVALIDATED' || candidate.status === 'NEEDS_FIX' ? 'blocked' : 'current';
    if (n === 3) return !ready ? 'todo' : plan === null ? 'current' : plan.state === 'BLOCKED' ? 'blocked' : plan.state === 'PREPARED' ? 'current' : 'done';
    if (plan === null || plan.state === 'PREPARED' || plan.state === 'BLOCKED') return 'todo';
    return plan.state === 'INSTALLED_ACTIVE' ? 'done' : plan.state === 'RECOVERY_REQUIRED' || plan.state === 'FAILED_SAFE' || plan.state === 'RECOVERED' ? 'blocked' : 'current';
  };
  const steps = ['1. Quét', '2. Kiểm tra & Chạy thử', '3. Kế hoạch', '4. Cài đặt & Hậu kiểm'];
  const bundle = INSTALLED.map((m) => ({ moduleKey: m.manifest.moduleKey, packageVersion: m.manifest.packageVersion, packageHash: m.manifest.packageHash ?? null }));

  return (
    <section className="ms-installer" aria-label="Candidate Workspace">
      <div className="fx-toolbar">{back}<span className="muted">Candidate <code>{candidate.candidateId.slice(0, 8)}</code> · cập nhật {formatTime(candidate.updatedAt)}</span></div>
      <h3>{candidate.moduleName} <small className="muted">{candidate.moduleKey} {candidate.packageVersion} · {candidate.classification}</small></h3>
      <p className="cw-status">Trạng thái: <b>{CANDIDATE_TEXT[candidate.status] ?? candidate.status}</b> · Package SHA-256 <code title={candidate.sourceHash}>{short(candidate.sourceHash)}</code>{' '}
        <button type="button" className="fx-btn" onClick={() => { void navigator.clipboard?.writeText(candidate.sourceHash); }}>Sao chép hash</button></p>
      <ol className="cw-stepper" aria-label="Các bước">
        {steps.map((s, i) => { const st = step(i + 1); return <li key={s} className={st === 'todo' ? '' : `cw-${st}`} aria-current={st === 'current' ? 'step' : undefined}>{s}</li>; })}
      </ol>
      {error && <div className="fx-msg error" role="alert">{error}</div>}
      {note && <p className="muted">{note}</p>}
      {candidate.status === 'INVALIDATED' && <p className="fx-msg error">Package đã thay đổi sau lần quét: quay lại Quản lý Module, bấm Quét Module rồi chọn lại package. Bằng chứng cũ không còn áp dụng.</p>}

      <div className="cw-grid">
        <div className="cw-card">
          <h4>Kiểm tra & Chạy thử</h4>
          <div className="fx-toolbar">
            <button type="button" className="fx-btn primary" disabled={busy || candidate.status === 'VALIDATING' || candidate.status === 'INVALIDATED' || candidate.status === 'CANCELLED'} onClick={() => void startRun()}>
              {candidate.status === 'VALIDATING' ? <><span className="ms-spinner" aria-hidden="true" /> Đang kiểm tra…</> : 'Kiểm tra & Chạy thử'}
            </button>
            {run && run.status !== 'RUNNING' && (
              <>
                <button type="button" className="fx-btn" onClick={() => void installerApi.downloadRunReport(candidateId, run.runId, 'txt').then(settle)}>Tải báo cáo TXT</button>
                <button type="button" className="fx-btn" onClick={() => void installerApi.downloadRunReport(candidateId, run.runId, 'json').then(settle)}>Tải JSON</button>
              </>
            )}
          </div>
          {run === null ? <p className="muted">Chưa có lượt kiểm tra.</p> : (
            <>
              <p>Lượt <code>{run.runId.slice(0, 8)}</code> · {run.status === 'RUNNING' ? 'đang chạy…' : `kết thúc ${formatTime(run.finishedAt)}`}{run.result && <> · Kết luận: <b>{run.result}</b></>}</p>
              <div className="cw-summary" aria-label="Tổng hợp kiểm tra">
                <p><span className="ms-tag ms-fail">Lỗi {count('FAIL')}</span> <span className="ms-tag ms-warn">Cảnh báo {count('WARN')}</span> <span className="ms-tag ms-pass">Đạt {count('PASS')}</span>{' '}
                  <span className="ms-tag ms-unavailable">Không áp dụng (N/A) {count('NOT_APPLICABLE')}</span></p>
                <p>Bắt buộc: <b>{accepted}/{required.length} chấp nhận</b> (PASS hoặc N/A){requiredOpen > 0 ? <> · <b>{requiredOpen} bắt buộc chưa kiểm / chưa xác minh</b></> : null} · Tùy chọn chưa chạy {optionalOpen} (không chặn READY)</p>
                <p className="muted">N/A không phải PASS. READY chỉ khi mọi check bắt buộc được chấp nhận với cùng package hash — READY chưa phải INSTALLED_ACTIVE.</p>
              </div>
            </>
          )}
        </div>
        <div className="cw-card">
          <h4>Runtime đang chạy</h4>
          {runtime === null ? <p className="muted">Chưa đọc được.</p> : (
            <>
              <p>{runtime.matches ? <span className="ms-tag ms-pass">Backend = Frontend = lock</span> : <span className="ms-tag ms-fail">Lệch lock — cần khởi động lại</span>} <span className="muted">DB {runtime.environment.database} · supervisor: {runtime.supervisor === 'NONE' ? 'không có (khởi động lại thủ công)' : runtime.supervisor}</span></p>
              <div className="cw-scroll"><table className="cw-table" aria-label="Runtime đang chạy">
                <thead><tr><th scope="col">Module</th><th scope="col">Lock</th><th scope="col">Backend</th><th scope="col">Bundle trình duyệt</th></tr></thead>
                <tbody>{runtime.lock.map((l) => {
                  const cell = (list: { moduleKey: string; packageVersion: string; packageHash: string | null }[]) => { const x = list.find((m) => m.moduleKey === l.moduleKey); return x ? `${x.packageVersion} · ${short(x.packageHash)}` : '—'; };
                  return <tr key={l.moduleKey}><td>{l.moduleKey}</td><td title={l.packageHash ?? ''}>{l.packageVersion} · {short(l.packageHash)}</td><td>{cell(runtime.backend)}</td><td>{cell(bundle)}</td></tr>;
                })}</tbody>
              </table></div>
            </>
          )}
        </div>
      </div>

      {run && (
        <div className="cw-card">
          <h4>Các phép kiểm ({run.checks.length})</h4>
          <div className="cw-scroll"><table className="cw-table" aria-label="Các phép kiểm">
            <thead><tr><th scope="col">Mã</th><th scope="col">Phép kiểm</th><th scope="col">Kết quả</th><th scope="col">Chi tiết</th><th scope="col"><span className="sr-only">Mở</span></th></tr></thead>
            <tbody>
              {run.checks.map((c) => (
                <tr key={c.id} className="cw-row" onClick={() => setDetail(c)}>
                  <td><b>{c.id}</b></td><td>{c.label}{!c.required && <small className="muted"> (tùy chọn)</small>}</td><td><Tag status={c.status} /></td><td>{c.detail}</td>
                  <td><button type="button" className="fx-btn" aria-label={`Chi tiết ${c.id}`} onClick={(e) => { e.stopPropagation(); setDetail(c); }}>Chi tiết</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {ready && canInstall && (plan === null || plan.state === 'EXPIRED' || plan.state === 'FAILED_SAFE') && (
        <div className="fx-toolbar"><button type="button" className="fx-btn primary" disabled={busy} onClick={() => void prepare()}>Lập kế hoạch cài đặt</button></div>
      )}
      {ready && !canInstall && <p className="muted">Cần quyền foundation.module_version.activate để lập kế hoạch cài đặt.</p>}

      {plan && (
        <div className="cw-card ms-plan">
          <h4>Kế hoạch & nhật ký cài đặt</h4>
          <p><b>{plan.moduleKey} {plan.packageVersion}</b> ({plan.classification === 'UPGRADE' ? 'nâng cấp module đã đăng ký' : 'module mới'}) · trạng thái: <b>{STATE_TEXT[plan.state] ?? plan.state}</b>{plan.state === 'PREPARED' && <> · hết hạn {formatTime(plan.expiresAt)}</>}</p>
          {plan.blockers.length > 0 && <ul className="ms-issues">{plan.blockers.map((b) => <li key={b.code} className="ms-issue ms-sev-error"><b>{b.code}</b><p>{b.message}</p></li>)}</ul>}
          {plan.warnings.length > 0 && <ul>{plan.warnings.map((w) => <li key={w} className="muted">{w}</li>)}</ul>}
          {plan.micDiff.length > 0 && (
            <details>
              <summary>Khác biệt MIC: DRAFT hiện có → MIC của Candidate ({plan.micDiff.filter((d) => d.changed).length} mục thay đổi)</summary>
              <div className="cw-scroll"><table className="cw-table" aria-label="Khác biệt MIC">
                <thead><tr><th scope="col">Mục</th><th scope="col">DRAFT</th><th scope="col">Candidate</th><th scope="col">Thay đổi</th></tr></thead>
                <tbody>{plan.micDiff.map((d) => <tr key={d.section}><td>{d.section}</td><td>{d.draft ?? '— (chưa có DRAFT)'}</td><td>{d.candidate}</td><td>{d.changed ? 'Có' : 'Không'}</td></tr>)}</tbody>
              </table></div>
            </details>
          )}
          {plan.navigationPlan && (
            <p>Vị trí menu (Navigation Builder, AREA → MENU → FUNCTION): <b>{plan.navigationPlan.area}</b> › <b>{plan.navigationPlan.menu}</b> — {plan.navigationPlan.links.map((l) => `${l.title}${l.developer ? ' (Develop)' : ''}`).join(', ') || '(không có chức năng có route)'}</p>
          )}
          <ol className="ms-steps">
            {plan.steps.map((s) => <li key={s.key}><span className={`ms-tag ms-${s.status === 'DONE' ? 'pass' : s.status === 'FAILED' ? 'fail' : 'unavailable'}`}>{s.status}</span> {s.label}{s.detail && <small className="muted"> — {s.detail}</small>}</li>)}
          </ol>
          {plan.postcheck.length > 0 && <ul className="ms-checks">{plan.postcheck.map((p) => <li key={p.key}><Tag status={p.status} /> <b>{p.key}</b><span>{p.detail}</span></li>)}</ul>}
          {plan.nextActions.length > 0 && <div className="fx-msg info">{plan.nextActions.map((x) => <p key={x}>{x}</p>)}</div>}
          {plan.recovery.length > 0 && <div className="fx-msg error">{plan.recovery.map((x) => <p key={x}>{x}</p>)}</div>}
          <div className="fx-toolbar">
            {plan.state === 'PREPARED' && <button type="button" className="fx-btn primary" disabled={busy || plan.blockers.length > 0} onClick={() => setConfirm(true)}>Cài đặt & Kích hoạt</button>}
            {(plan.state === 'BLOCKED' || plan.state === 'EXPIRED') && <button type="button" className="fx-btn" disabled={busy} onClick={() => void prepare()}>Lập kế hoạch lại</button>}
            {(plan.state === 'AWAITING_RESTART' || plan.state === 'RECOVERY_REQUIRED' || plan.state === 'POSTCHECK_INCOMPLETE' || plan.state === 'RECOVERY_AWAITING_RESTART') && (
              <>
                {plan.state === 'RECOVERY_AWAITING_RESTART' && <span className="info">Khởi động lại Backend và Frontend để chạy lại release cũ, rồi bấm Tiếp tục để xác minh phục hồi.</span>}
                {plan.state === 'AWAITING_RESTART' && <span className="info">Chưa có deploy supervisor: khởi động lại Backend và Frontend (npm run dev / build) rồi bấm Tiếp tục. Trạng thái được lưu trên máy chủ.</span>}
                <button type="button" className="fx-btn primary" disabled={busy} onClick={() => void resume()}>Tiếp tục</button>
              </>
            )}
            {plan.state === 'RECOVERY_REQUIRED' && plan.classification === 'NEW_MODULE' && !plan.hasRecoveryPoint && <button type="button" className="fx-btn" disabled={busy} onClick={() => setCloseConfirm(true)}>Đóng lượt cài đặt thất bại…</button>}
            {plan.state !== 'PREPARED' && plan.state !== 'BLOCKED' && <button type="button" className="fx-btn" onClick={() => void installerApi.downloadInstallReport(plan.installId).then(settle)}>Tải báo cáo cài đặt</button>}
          </div>
          {plan.state === 'RECOVERED' && <div className="fx-msg info">Nâng cấp thất bại và đã phục hồi phiên bản trước: runtime, B02, B01, menu và API đã được xác minh. Phiên bản mới không hoạt động.</div>}
          {plan.state === 'INSTALLED_ACTIVE' && <div className="fx-msg success">Đã cài đặt: B02 ACTIVE, runtime khớp, danh mục + chính sách IAM, menu và hậu kiểm truy cập đều PASS.</div>}
        </div>
      )}

      {detail && (
        <Drawer kicker={`KIỂM TRA · ${detail.id}`} title={detail.label} onClose={() => setDetail(null)}>
          <dl className="ms-dl">
            <dt>Kết quả</dt><dd><Tag status={detail.status} /> {detail.required ? 'bắt buộc' : 'tùy chọn (không chặn READY)'}</dd>
            <dt>Chi tiết</dt><dd>{detail.detail}</dd>
            <dt>Thời gian</dt><dd>{formatTime(detail.startedAt)} → {formatTime(detail.finishedAt)} ({detail.durationMs} ms) · exit {detail.exitCode ?? '—'}</dd>
            <dt>Log đã lọc</dt><dd>{detail.logHash ? <code className="ms-hash">{detail.logHash}</code> : '—'} (nội dung đầy đủ trong báo cáo TXT/JSON)</dd>
          </dl>
          <h4>Vấn đề ({detail.issues.length})</h4>
          {detail.issues.length === 0 ? <p className="muted">Không có vấn đề.</p> : (
            <ul className="ms-issues">
              {detail.issues.map((i, n) => (
                <li key={n} className="ms-issue ms-sev-error">
                  <p>{i.message}</p>
                  {i.path && <div><small className="muted">Tệp:</small> <code>{i.path}</code></div>}
                  {i.field && <div><small className="muted">Trường / endpoint:</small> <code>{i.field}</code></div>}
                  {i.expected && <div><small className="muted">Mong đợi:</small> <code>{i.expected}</code></div>}
                  {i.actual && <div><small className="muted">Thực tế:</small> <code>{i.actual}</code></div>}
                </li>
              ))}
            </ul>
          )}
          {detail.limitations.length > 0 && <><h4>Giới hạn</h4><ul>{detail.limitations.map((l) => <li key={l}>{l}</li>)}</ul></>}
        </Drawer>
      )}

      {closeConfirm && plan && (
        <ConfirmModal
          busy={busy}
          spec={{
            title: 'Đóng lượt cài đặt thất bại', object: `${plan.moduleKey} ${plan.packageVersion} · lượt ${plan.installId.slice(0, 8)} (module mới)`,
            transition: 'RECOVERY_REQUIRED → FAILED_SAFE',
            impact: [
              'Nếu module đang BẬT: TẮT qua Lifecycle (có B07 / B08) — route, menu và API của module ngừng phục vụ.',
              'Giữ nguyên phiên bản B02, B07 / B08, kho release, lock triển khai và menu B09; không xóa dữ liệu.',
              'Lượt cài đặt kết thúc; có thể lập kế hoạch cài đặt mới (ví dụ phiên bản sửa lỗi) cho module.',
            ],
            irreversible: 'Không mở lại được lượt cài đặt này; bật lại module phải qua Quản lý Module.', confirmLabel: 'Đóng lượt cài đặt',
          }}
          onConfirm={() => void closeFailed()}
          onCancel={() => setCloseConfirm(false)}
        />
      )}

      {confirm && plan && (
        <ConfirmModal
          busy={busy}
          spec={{
            title: 'Cài đặt & Kích hoạt module', object: `${plan.moduleKey} ${plan.packageVersion} (${plan.classification === 'UPGRADE' ? 'module đã đăng ký' : 'module mới'})`,
            transition: `Candidate READY → B02 APPROVED + lock triển khai → chờ khởi động lại → ACTIVE + ENABLED → hậu kiểm`,
            impact: [
              `Ghi release bất biến và lock triển khai (hash ${short(plan.packageHash)}); runtime chỉ đổi sau khi khởi động lại.`,
              plan.micDiff.some((d) => d.draft !== null) ? 'Thay MIC của DRAFT hiện có bằng MIC của Candidate (xem bảng khác biệt).' : 'Tạo B01 / B02 khi chưa có; MIC lấy từ Candidate.',
              'Tạo danh mục quyền IAM theo MIC-07 (không tự gán cho người dùng) và menu B09 theo kế hoạch.',
            ],
            irreversible: 'Phiên bản sau khi APPROVE / ACTIVE không sửa được MIC; B07 / B08 ghi lại mọi bước.', confirmLabel: 'Cài đặt & Kích hoạt',
          }}
          onConfirm={() => void commit()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </section>
  );
}
