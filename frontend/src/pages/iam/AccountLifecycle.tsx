import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { iamLifecycleApi } from '../../services/iam/iamApi';
import type { Account, AccountDetails, AuditEvent, CredentialFeature, IssuedCredential, SessionRow, StatusAction } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { useShellData } from '../../contexts/ShellData';
import { DataTable, FIRST_QUERY } from '../../components/DataTable';
import type { Column, TableQuery } from '../../components/DataTable';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { statusTag, useSettle } from './iamShared';
import '../../styles/iam-lifecycle.css';

// IAM Phase B screens (inside /iam/accounts): account creation, lifecycle (lock / unlock / disable / reactivate, failed-login
// lock), temporary password re-issue, sessions and the IAM audit. Every action is decided by the server (permission, root
// and self protection, writer protocol in the database); controls follow the session's capabilities. A temporary password
// is held only in the one-time dialog's state and dropped when it closes — never stored, logged or put in a URL.

const STATUS_TEXT: Record<string, string> = { PROVISIONED: 'Chờ kích hoạt', ACTIVE: 'Hoạt động', LOCKED: 'Đang khóa', DISABLED: 'Vô hiệu hóa' };
export const accountStatusText = (s: string) => STATUS_TEXT[s] ?? s;

const ACTIONS: Record<StatusAction, { label: string; danger: boolean; confirm: string }> = {
  LOCK: { label: 'Khóa tài khoản', danger: true, confirm: 'Khóa tài khoản? Mọi phiên đăng nhập bị thu hồi; tài khoản không đăng nhập được cho đến khi mở khóa.' },
  UNLOCK: { label: 'Mở khóa', danger: false, confirm: 'Mở khóa tài khoản?' },
  DISABLE: { label: 'Vô hiệu hóa', danger: true, confirm: 'Vô hiệu hóa tài khoản? Mọi phiên đăng nhập bị thu hồi; có thể kích hoạt lại sau.' },
  REACTIVATE: { label: 'Kích hoạt lại', danger: false, confirm: 'Kích hoạt lại tài khoản?' },
};

// Transitions offered for the current status (the database function checks them again).
export function allowedActions(status: string, retired: boolean): StatusAction[] {
  if (retired) return [];
  if (status === 'ACTIVE') return ['LOCK', 'DISABLE'];
  if (status === 'LOCKED') return ['UNLOCK', 'DISABLE'];
  if (status === 'PROVISIONED') return ['DISABLE'];
  if (status === 'DISABLED') return ['REACTIVATE'];
  return [];
}

// ----------------------------------------------------------------------------------------------- one-time secret
export function OneTimeSecret({ credential, title, onClose }: { credential: IssuedCredential; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="otp-backdrop">
      <div className="otp-dialog" role="dialog" aria-modal="true" aria-labelledby="otp-title">
        <h3 id="otp-title">{title}</h3>
        <p>Tài khoản <b>{credential.username}</b>{credential.revokedSessions !== null ? ` · ${credential.revokedSessions} phiên đăng nhập đã bị thu hồi` : ''}.</p>
        <p className="otp-label">Mật khẩu tạm — <b>chỉ hiển thị một lần</b>:</p>
        <code className="otp-secret" data-testid="temporary-password">{credential.temporaryPassword}</code>
        <ul className="otp-rules">
          <li>Bàn giao qua <b>kênh riêng</b> sau khi xác minh người nhận; không gửi kèm tên đăng nhập.</li>
          <li>Không chụp màn hình, không lưu vào tệp hoặc tin nhắn.</li>
          <li>Người dùng bắt buộc đổi mật khẩu ở lần đăng nhập tiếp theo. Đóng hộp thoại này thì mật khẩu không xem lại được.</li>
        </ul>
        <div className="fx-toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="fx-btn" onClick={() => void copy()}>{copied ? 'Đã sao chép' : 'Sao chép'}</button>
          <button type="button" className="fx-btn primary" ref={closeRef} onClick={onClose}>Tôi đã bàn giao — Đóng</button>
        </div>
      </div>
    </div>
  );
}

function credentialNotice(feature: CredentialFeature): string | null {
  if (feature === 'DISABLED') return 'Cấp mật khẩu tạm trên giao diện chưa được bật (quyết định P-4e hiện hành: chỉ qua công cụ CLI của IT).';
  if (feature === 'UNAVAILABLE') return 'Kết nối cấp tài khoản (talo_provisioner) chưa sẵn sàng.';
  return null;
}

export function useCredentialFeature(): CredentialFeature | null {
  const [feature, setFeature] = useState<CredentialFeature | null>(null);
  useEffect(() => { void iamLifecycleApi.features().then((r) => setFeature(r.ok ? r.data : 'UNAVAILABLE')); }, []);
  return feature;
}

// ------------------------------------------------------------------------------------------------- create account
export function CreateAccountPanel({ onSessionLost, onCreated, onClose }: { onSessionLost: () => void; onCreated: () => void; onClose: () => void }) {
  const feature = useCredentialFeature();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [joinedAt, setJoinedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const data = settle(await iamLifecycleApi.createAccount({ employeeCode: employeeCode.trim(), fullName: fullName.trim(), username: username.trim(), joinedAt }));
    setBusy(false);
    if (data) {
      setIssued(data);
      setEmployeeCode('');
      setFullName('');
      setUsername('');
      setJoinedAt('');
      onCreated();
    }
  }

  const notice = feature === null ? null : credentialNotice(feature);
  return (
    <div className="fx-version-area fx-section" aria-label="Tạo tài khoản">
      <div className="fx-toolbar"><h3 style={{ margin: 0 }}>Tạo tài khoản</h3><button type="button" className="fx-btn" onClick={onClose}>Đóng</button></div>
      <p className="muted">Dùng dịch vụ cấp tài khoản P-4e hiện hữu: tài khoản ở trạng thái “Chờ kích hoạt”, mật khẩu tạm 24 ký tự, bắt buộc đổi ở lần đăng nhập đầu. Mã nhân viên đã có hồ sơ thì dùng lại hồ sơ đó (mỗi nhân viên tối đa một tài khoản hiện hành).</p>
      {notice && <p className="fx-msg info" role="note">{notice}</p>}
      <FeedbackLine feedback={feedback} />
      <form className="fx-form" onSubmit={(e) => void submit(e)}>
        <label>Mã nhân viên<input required maxLength={50} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></label>
        <label>Họ tên<input required maxLength={200} value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
        <label>Tên đăng nhập<input required maxLength={80} pattern="\S+" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Ngày vào làm<input required type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} /></label>
        <div><button type="submit" className="fx-btn primary" disabled={busy || feature !== 'READY'} aria-busy={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button></div>
      </form>
      {issued && <OneTimeSecret credential={issued} title="Đã tạo tài khoản" onClose={() => setIssued(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- account facts (details)
// GET /details of one account (created / activated / lifecycle end / password state). null = not readable.
export function useAccountDetails(accountId: string, settle: <T>(r: ApiResult<T>) => T | null) {
  const [details, setDetails] = useState<AccountDetails | null | undefined>(undefined);
  const reload = useCallback(async () => setDetails(settle(await iamLifecycleApi.details(accountId)) ?? null), [accountId, settle]);
  useEffect(() => { void reload(); }, [reload]);
  return { details, reload };
}

export function AccountFacts({ account, details }: { account: Account; details: AccountDetails | null | undefined }) {
  if (details === undefined) return <p className="muted">Đang tải…</p>;
  if (details === null) return <p className="muted">Ngày tạo / kích hoạt và trạng thái mật khẩu hiện không đọc được.</p>;
  return (
    <div className="fx-meta">
      <span><b>Trạng thái:</b> {accountStatusText(account.accountStatus)}{account.disabled ? ' · đã kết thúc vòng đời' : ''}</span>
      <span><b>Tạo lúc:</b> {formatTime(details.createdAt)}{details.createdByUsername ? ` bởi ${details.createdByUsername}` : ''}</span>
      <span><b>Kích hoạt lúc:</b> {formatTime(details.activatedAt)}</span>
      <span><b>Kết thúc vòng đời:</b> {formatTime(details.disabledAt)}</span>
      <span><b>Ngày vào / rời:</b> {details.joinedAt ?? '—'} / {details.leftAt ?? '—'}</span>
      <span><b>Mật khẩu:</b> {details.mustChangePassword ? 'mật khẩu tạm — phải đổi khi đăng nhập' : 'đã đặt bởi người dùng'}</span>
      <span><b>Đăng nhập sai:</b> {details.failedAttempts ?? 0} lần{details.loginLockedUntil ? ` · khóa tạm đến ${formatTime(details.loginLockedUntil)}` : ''}</span>
    </div>
  );
}

// ------------------------------------------------------------------------------------- status & credential section
// Lock / unlock / disable / reactivate, failed-login lock, temporary password re-issue (P-4e feature gate unchanged).
export function AccountStatusSection({ account, onSessionLost, onChanged }: { account: Account; onSessionLost: () => void; onChanged: () => void }) {
  const { can } = useShellData();
  const feature = useCredentialFeature();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { details, reload } = useAccountDetails(account.accountId, settle);
  const [action, setAction] = useState<StatusAction | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const id = account.accountId;

  async function act<T>(work: Promise<ApiResult<T>>, done: (data: T) => string) {
    setBusy(true);
    setFeedback(null);
    const data = settle(await work);
    if (data !== null) setFeedback({ tone: 'success', text: done(data) });
    setBusy(false);
    setReason('');
    setAction('');
    onChanged();
    await reload();
    return data;
  }

  function changeStatus(event: FormEvent) {
    event.preventDefault();
    if (!action || !reason.trim() || busy || !window.confirm(ACTIONS[action].confirm)) return;
    void act(iamLifecycleApi.setStatus(id, action, reason.trim()), () => `Đã thực hiện: ${ACTIONS[action].label}.`);
  }

  async function reissue() {
    const why = window.prompt('Lý do cấp lại mật khẩu tạm (bắt buộc, ghi vào nhật ký IAM):');
    if (!why?.trim() || busy) return;
    if (!window.confirm('Cấp lại mật khẩu tạm? Mật khẩu hiện tại hết hiệu lực và mọi phiên đăng nhập của tài khoản bị thu hồi.')) return;
    const data = await act(iamLifecycleApi.reissue(id, why.trim()), (c) => `Đã cấp lại mật khẩu tạm; ${c.revokedSessions ?? 0} phiên bị thu hồi.`);
    if (data) setIssued(data);
  }

  async function clearLock() {
    const why = window.prompt('Lý do mở khóa đăng nhập sai (bắt buộc):');
    if (!why?.trim() || busy) return;
    await act(iamLifecycleApi.clearLoginLock(id, why.trim()), (cleared) => (cleared ? 'Đã xóa khóa tạm do đăng nhập sai.' : 'Tài khoản không có khóa tạm do đăng nhập sai.'));
  }

  const options = allowedActions(account.accountStatus, account.disabled).filter((a) => !(account.isRoot && (a === 'LOCK' || a === 'DISABLE')));

  return (
    <div className="acc-section lc-panel">
      <FeedbackLine feedback={feedback} />
      <AccountFacts account={account} details={details} />

      {can('iam.accounts.manage') && (
        <>
          <h4>Trạng thái tài khoản</h4>
          {account.isRoot && <p className="muted">Tài khoản Admin gốc: không khóa / vô hiệu hóa qua giao diện (máy chủ chặn và ghi audit).</p>}
          {options.length === 0 ? <p className="muted">Không có thao tác trạng thái phù hợp.</p> : (
            <form className="fx-toolbar" onSubmit={changeStatus} aria-label="Đổi trạng thái tài khoản">
              <select aria-label="Thao tác trạng thái" value={action} onChange={(e) => setAction(options.find((o) => o === e.target.value) ?? '')}>
                <option value="">Chọn thao tác…</option>
                {options.map((o) => <option key={o} value={o}>{ACTIONS[o].label}</option>)}
              </select>
              <input aria-label="Lý do" placeholder="Lý do (bắt buộc, ghi nhật ký)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="submit" className={action && ACTIONS[action].danger ? 'fx-btn danger' : 'fx-btn primary'} disabled={!action || !reason.trim() || busy}>Thực hiện</button>
            </form>
          )}
          <div className="fx-toolbar">
            <button type="button" className="fx-btn" disabled={busy} onClick={() => void clearLock()}>Mở khóa đăng nhập sai</button>
            <span className="muted">Khóa tạm do nhập sai mật khẩu nhiều lần (khác với “Khóa tài khoản”).</span>
          </div>
        </>
      )}

      {can('iam.credentials.reissue') && (
        <>
          <h4>Mật khẩu</h4>
          {feature !== null && credentialNotice(feature) && <p className="fx-msg info" role="note">{credentialNotice(feature)}</p>}
          <div className="fx-toolbar">
            <button type="button" className="fx-btn" disabled={busy || feature !== 'READY' || account.isRoot} onClick={() => void reissue()}>Cấp lại mật khẩu tạm</button>
            <span className="muted">{account.isRoot ? 'Không áp dụng cho Admin gốc.' : 'Thu hồi mọi phiên; người dùng phải đổi mật khẩu ở lần đăng nhập tiếp theo.'}</span>
          </div>
        </>
      )}
      {issued && <OneTimeSecret credential={issued} title="Đã cấp lại mật khẩu tạm" onClose={() => setIssued(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- sessions section
export function AccountSessionsSection({ account, onSessionLost }: { account: Account; onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = account.accountId;

  const reload = useCallback(async () => {
    const s = await iamLifecycleApi.sessions(id);
    if (s.ok) { setSessions(s.data); setSessionsError(null); } else if (s.status === 401) onSessionLost(); else { setSessions([]); setSessionsError(s.code); }
  }, [id, onSessionLost]);
  useEffect(() => { void reload(); }, [reload]);

  async function revoke(sessionId: string | null) {
    const why = window.prompt(sessionId ? 'Lý do thu hồi phiên này (bắt buộc):' : 'Lý do thu hồi TẤT CẢ phiên của tài khoản (bắt buộc):');
    if (!why?.trim() || busy) return;
    setBusy(true);
    setFeedback(null);
    const n = settle(await iamLifecycleApi.revokeSessions(id, sessionId, why.trim()));
    if (n !== null) setFeedback({ tone: 'success', text: `Đã thu hồi ${n} phiên đăng nhập.` });
    setBusy(false);
    await reload();
  }

  const sessionColumns: Column<SessionRow>[] = [
    { key: 'status', label: 'Trạng thái', value: (s) => s.status, render: (s) => statusTag(s.status === 'ACTIVE', s.status) },
    { key: 'createdAt', label: 'Đăng nhập lúc', value: (s) => s.createdAt, render: (s) => formatTime(s.createdAt), searchable: false },
    { key: 'lastSeenAt', label: 'Hoạt động gần nhất', value: (s) => s.lastSeenAt ?? '', render: (s) => formatTime(s.lastSeenAt), searchable: false },
    { key: 'expiresAt', label: 'Hết hạn', value: (s) => s.expiresAt, render: (s) => formatTime(s.expiresAt), searchable: false },
    { key: 'revokedAt', label: 'Thu hồi lúc', value: (s) => s.revokedAt ?? '', render: (s) => formatTime(s.revokedAt), searchable: false },
  ];
  const liveSessions = (sessions ?? []).filter((s) => s.status === 'ACTIVE' || s.status === 'IDLE' || s.status === 'ACTIVATION').length;

  return (
    <div className="acc-section lc-panel">
      <FeedbackLine feedback={feedback} />
      <div className="fx-toolbar"><h4 style={{ margin: 0 }}>Phiên đăng nhập</h4>
        <button type="button" className="fx-btn danger" disabled={busy || liveSessions === 0} onClick={() => void revoke(null)}>Thu hồi tất cả ({liveSessions})</button></div>
      {sessionsError ? <p className="muted">{sessionsError === 'IAM_DB_PRIVILEGE_MISSING' ? 'Danh sách phiên chưa đọc được (thiếu quyền cơ sở dữ liệu IAM Phase B).' : `Không tải được danh sách phiên (${sessionsError}).`}</p> : (
        <DataTable label="phiên đăng nhập" compact columns={sessionColumns} rows={sessions} rowKey={(s) => s.sessionId} emptyText="Tài khoản chưa có phiên nào."
          initial={{ sort: 'createdAt', dir: 'desc', pageSize: 10 }}
          actions={(s) => (s.status === 'REVOKED' || s.status === 'EXPIRED' ? null : <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void revoke(s.sessionId)}>Thu hồi</button>)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ IAM audit viewer
const OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;

// `account` fixes the account filter (account workspace: the IAM audit of that account only).
export function IamAuditViewer({ onSessionLost, account }: { onSessionLost: () => void; account?: string }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [query, setQuery] = useState<TableQuery>({ ...FIRST_QUERY, sort: 'occurredAt', dir: 'desc' });
  const [action, setActionFilter] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setAccountId] = useState<string | null>(null);
  const accountId = account ?? picked;
  const [result, setResult] = useState<{ events: AuditEvent[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const day = (d: string, end: boolean) => (d ? new Date(`${d}T00:00:00`).getTime() + (end ? 86_400_000 : 0) : null);
    const f = day(from, false);
    const t = day(to, true);
    const data = settle(await iamLifecycleApi.audit({
      accountId, action: action.trim(), outcome: outcome || null, from: f === null ? null : new Date(f).toISOString(), to: t === null ? null : new Date(t).toISOString(),
      page: query.page, pageSize: query.pageSize,
    }));
    setResult(data ?? { events: [], total: 0 });
    setLoading(false);
  }, [settle, accountId, action, outcome, from, to, query.page, query.pageSize]);
  useEffect(() => { void load(); }, [load]);

  const columns: Column<AuditEvent>[] = [
    { key: 'occurredAt', label: 'Thời gian', value: (e) => e.occurredAt, render: (e) => formatTime(e.occurredAt), sortable: false, searchable: false },
    { key: 'actor', label: 'Người thực hiện', value: (e) => e.actorUsername ?? '', render: (e) => (e.actorUsername ?? (e.actorId ? '(tài khoản khác)' : 'hệ thống / CLI')), sortable: false, searchable: false },
    { key: 'action', label: 'Thao tác', value: (e) => e.action, render: (e) => <code>{e.action}</code>, sortable: false, searchable: false },
    { key: 'target', label: 'Đối tượng', value: (e) => e.targetUsername ?? e.targetType ?? '', render: (e) => (e.targetUsername && !account ? <button type="button" className="fx-link" onClick={() => { setAccountId(e.targetId); setQuery((q) => ({ ...q, page: 1 })); }}>{e.targetUsername}</button> : (e.targetUsername ?? e.targetType ?? '—')), sortable: false, searchable: false },
    { key: 'outcome', label: 'Kết quả', value: (e) => e.outcome, render: (e) => statusTag(e.outcome === 'SUCCESS', e.outcome), sortable: false, searchable: false },
    { key: 'metadata', label: 'Chi tiết', value: (e) => Object.entries(e.metadata).map(([k, v]) => `${k}=${v}`).join(' '), render: (e) => <span className="lc-meta">{Object.entries(e.metadata).filter(([k]) => k !== 'requestId').map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</span>, sortable: false, searchable: false },
  ];

  return (
    <>
      <FeedbackLine feedback={feedback} />
      <form className="fx-toolbar lc-filters" onSubmit={(e) => { e.preventDefault(); setQuery((q) => ({ ...q, page: 1 })); void load(); }} aria-label="Lọc nhật ký IAM">
        <input aria-label="Mã thao tác (tiền tố)" placeholder="Thao tác, vd: IAM.ACCOUNT, LOGIN" maxLength={80} value={action} onChange={(e) => setActionFilter(e.target.value.replace(/[^A-Za-z0-9_.]/g, ''))} />
        <select aria-label="Kết quả" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Mọi kết quả</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label className="muted">Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="muted">Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {picked && !account && <button type="button" className="fx-btn" onClick={() => setAccountId(null)}>Bỏ lọc tài khoản</button>}
      </form>
      <p className="muted">Nhật ký chỉ đọc (không sửa / xóa). Chi tiết chỉ gồm các trường an toàn; không hiển thị địa chỉ IP, trình duyệt hay dữ liệu xác thực.</p>
      <DataTable
        label="nhật ký IAM"
        searchable={false}
        columns={columns}
        rows={result?.events ?? null}
        rowKey={(e) => e.auditId}
        loading={loading}
        emptyText="Không có sự kiện phù hợp."
        onRefresh={() => void load()}
        server={{ total: result?.total ?? 0, query, onQuery: setQuery }}
      />
    </>
  );
}
