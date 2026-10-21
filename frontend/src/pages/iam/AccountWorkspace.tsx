import { useCallback, useEffect, useRef, useState } from 'react';
import { iamApi, iamLifecycleApi } from '../../services/iam/iamApi';
import type { Account, AccountDetails, RoleAssignment } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { useShellData } from '../../contexts/ShellData';
import { useShellPageLabel } from '../../contexts/ShellPage';
import { backOrOpen, replaceSearch } from '../../routes/navigation';
import type { OpenPath } from '../../routes/navigation';
import { SCREENS } from '../../routes/shellScreens';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { statusTag, useSettle } from './iamShared';
import { AccountPermissionsSection, AccountRolesSection, RootBadge } from './AccountAccessSections';
import { AccountFacts, AccountSessionsSection, AccountStatusSection, IamAuditViewer, accountStatusText, useAccountDetails } from './AccountLifecycle';
import '../../styles/iam-account-workspace.css';

// IAM-B-UI-01 — level 2 (detail drawer over the account list) and level 3 (account management workspace,
// /iam/accounts/:accountId). Both only rearrange the existing IAM Phase B functions: every read and change goes through
// the IAM API, controls follow the session's capabilities, the server decides (root / self protection, P-4e gate).

const dash = (v: string | null | undefined) => (v && v.trim() !== '' ? v : '—');

export function AccountStatusTag({ account }: { account: Account }) {
  return statusTag(account.accountStatus === 'ACTIVE' && !account.disabled, account.disabled ? `${accountStatusText(account.accountStatus)} · kết thúc vòng đời` : accountStatusText(account.accountStatus));
}

// ======================================================================================================= detail drawer
type DrawerData =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly account: Account; readonly roles: RoleAssignment[] | null; readonly details: AccountDetails | null };

// Quick view of one account, over the list (fixed position: the table keeps its size, rows, scroll and query). Not
// modal: the list stays usable and choosing another account updates the drawer. Closes with ×, Escape, or when the
// list unmounts (another screen / tab / the workspace).
export function AccountDetailDrawer({ accountId, onClose, onManage, onSessionLost }: { accountId: string; onClose: () => void; onManage: (accountId: string) => void; onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [data, setData] = useState<DrawerData>({ kind: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    setData({ kind: 'loading' });
    setFeedback(null);
    void Promise.all([iamApi.account(accountId), iamApi.accountRoles(accountId), iamLifecycleApi.details(accountId)]).then(([a, r, d]) => {
      if (!current) return; // another account was chosen meanwhile
      const account = settle(a);
      if (account === null) return setData({ kind: 'error' });
      setData({ kind: 'ready', account, roles: r.ok ? r.data : null, details: d.ok ? d.data : null });
    });
    return () => { current = false; };
  }, [accountId, settle]);

  useEffect(() => { closeRef.current?.focus(); }, [accountId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const live = data.kind === 'ready' && data.roles !== null ? data.roles.filter((r) => r.revokedAt === null) : [];
  return (
    <aside className="acc-drawer" role="dialog" aria-modal="false" aria-labelledby="acc-drawer-title" data-account={accountId}>
      <header className="acc-drawer-head">
        <h3 id="acc-drawer-title">Chi tiết tài khoản</h3>
        <button type="button" className="acc-drawer-close" ref={closeRef} aria-label="Đóng chi tiết" title="Đóng (Esc)" onClick={onClose}>×</button>
      </header>
      <div className="acc-drawer-body" aria-busy={data.kind === 'loading'}>
        <FeedbackLine feedback={feedback} />
        {data.kind === 'loading' && <p className="muted">Đang tải…</p>}
        {data.kind === 'error' && <p className="muted">Không tải được thông tin tài khoản. Danh sách vẫn dùng được; thử chọn lại hoặc tải lại danh sách.</p>}
        {data.kind === 'ready' && (
          <>
            <div className="acc-drawer-name">
              <b>{data.account.username}</b> {data.account.isRoot && <RootBadge />}
            </div>
            <dl className="acc-facts">
              <dt>Họ tên</dt><dd>{dash(data.account.fullName)}</dd>
              <dt>Mã nhân viên</dt><dd>{dash(data.account.employeeCode)}</dd>
              <dt>Membership</dt><dd>{dash(data.account.membershipStatus)}</dd>
              <dt>Trạng thái</dt><dd><AccountStatusTag account={data.account} /></dd>
              <dt>Vai trò</dt>
              <dd>{data.roles === null ? <span className="muted">Không khả dụng</span> : live.length === 0 ? <span className="muted">Chưa có vai trò</span>
                : live.map((r) => <span key={r.userRoleId} className="badge">{r.roleName}</span>)}</dd>
              <dt>Tạo lúc</dt><dd>{data.details === null ? <span className="muted">Không khả dụng</span> : formatTime(data.details.createdAt)}</dd>
              <dt>Kích hoạt lúc</dt><dd>{data.details === null ? <span className="muted">Không khả dụng</span> : formatTime(data.details.activatedAt)}</dd>
            </dl>
            {data.account.isRoot && <p className="muted">Tài khoản quản trị gốc: vai trò hệ thống, khóa / vô hiệu hóa và cấp lại mật khẩu được máy chủ bảo vệ.</p>}
          </>
        )}
      </div>
      <footer className="acc-drawer-foot">
        <button type="button" className="fx-btn primary" disabled={data.kind !== 'ready'} onClick={() => onManage(accountId)}>Quản lý tài khoản</button>
      </footer>
    </aside>
  );
}

// ================================================================================================== account workspace
type SectionId = 'overview' | 'roles' | 'permissions' | 'status' | 'sessions' | 'audit';

const SECTIONS: readonly { readonly id: SectionId; readonly name: string; readonly codes: readonly string[] }[] = [
  { id: 'overview', name: 'Tổng quan', codes: ['iam.accounts.read'] },
  { id: 'roles', name: 'Vai trò', codes: ['iam.accounts.read'] },
  { id: 'permissions', name: 'Chức năng & Quyền', codes: ['iam.accounts.read'] },
  { id: 'status', name: 'Trạng thái & Credential', codes: ['iam.accounts.manage', 'iam.credentials.reissue'] },
  { id: 'sessions', name: 'Phiên đăng nhập', codes: ['iam.sessions.manage'] },
  { id: 'audit', name: 'Nhật ký tài khoản', codes: ['iam.audit.read'] },
];

// The section of the workspace is kept in the query (?section=…, replaced — never a new history entry) so a reload
// shows the same section.
function sectionFromUrl(): SectionId {
  const wanted = new URLSearchParams(window.location.search).get('section');
  return SECTIONS.find((s) => s.id === wanted)?.id ?? 'overview';
}

function useAccount(accountId: string, settle: <T>(r: ApiResult<T>) => T | null) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const reload = useCallback(async () => {
    const a = settle(await iamApi.account(accountId));
    setAccount((current) => a ?? (current === undefined ? null : current));
  }, [accountId, settle]);
  useEffect(() => { void reload(); }, [reload]);
  return { account, reload };
}

export function AccountWorkspace({ accountId, onSessionLost, onOpenPath }: { accountId: string; onSessionLost: () => void; onOpenPath: OpenPath }) {
  const { can } = useShellData();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { account, reload } = useAccount(accountId, settle);
  const { details, reload: reloadDetails } = useAccountDetails(accountId, settle);
  const [section, setSection] = useState<SectionId>(sectionFromUrl);
  const visible = SECTIONS.filter((s) => s.codes.some(can));
  const active = visible.find((s) => s.id === section)?.id ?? visible[0]?.id ?? 'overview';

  useEffect(() => { replaceSearch(active === 'overview' ? '' : `section=${active}`); }, [active]);

  // "← Quay lại danh sách" (same as the breadcrumb): browser Back when this entry was opened from the account list (its
  // NavState says so); otherwise (direct URL, a link in a new tab, after a sign-in) the list is opened as a new entry.
  const back = useCallback(() => backOrOpen(SCREENS.accounts.path, onOpenPath), [onOpenPath]);
  useShellPageLabel(account ? account.username : null);

  const refresh = () => { void reload(); void reloadDetails(); };

  return (
    <div className="acc-ws">
      <div className="acc-ws-head">
        <button type="button" className="fx-btn" onClick={back}>← Quay lại danh sách</button>
        <div className="acc-ws-title">
          {account ? (
            <>
              <h3>{account.username} {account.isRoot && <RootBadge />}</h3>
              <span className="muted">{dash(account.fullName)} · {dash(account.employeeCode)}</span>
              <AccountStatusTag account={account} />
            </>
          ) : <h3>Tài khoản</h3>}
        </div>
        <button type="button" className="fx-btn" onClick={refresh}>Tải lại</button>
      </div>
      <FeedbackLine feedback={feedback} />
      {!can('iam.accounts.read') ? (
        <div className="guard" role="alert"><b>Cần quyền xem tài khoản (iam.accounts.read).</b><p>Phiên hiện tại không đọc được thông tin tài khoản này.</p></div>
      ) : account === undefined ? <p className="muted">Đang tải…</p> : account === null ? (
        <p className="muted">Không tải được tài khoản này (không tồn tại hoặc không đọc được). Dùng “← Quay lại danh sách” để chọn tài khoản khác.</p>
      ) : (
        <>
          <div className="acc-ws-tabs" role="tablist" aria-label="Quản trị tài khoản">
            {visible.map((s) => (
              <button type="button" role="tab" key={s.id} id={`acc-tab-${s.id}`} aria-selected={s.id === active} aria-controls="acc-ws-panel"
                className={s.id === active ? 'tab active' : 'tab'} onClick={() => setSection(s.id)}>{s.name}</button>
            ))}
          </div>
          <div className="acc-ws-panel" id="acc-ws-panel" role="tabpanel" aria-labelledby={`acc-tab-${active}`}>
            {active === 'overview' && (
              <div className="acc-section">
                <dl className="acc-facts">
                  <dt>Tài khoản</dt><dd>{account.username}</dd>
                  <dt>Họ tên</dt><dd>{dash(account.fullName)}</dd>
                  <dt>Mã nhân viên</dt><dd>{dash(account.employeeCode)}</dd>
                  <dt>Membership</dt><dd>{dash(account.membershipStatus)}</dd>
                  <dt>Trạng thái</dt><dd><AccountStatusTag account={account} /></dd>
                </dl>
                <h4>Vòng đời</h4>
                <AccountFacts account={account} details={details} />
                {account.isRoot && <p className="muted">Tài khoản quản trị gốc: máy chủ chặn thu hồi vai trò hệ thống, chặn Direct DENY / thu hồi quyền quản trị nền tảng, khóa / vô hiệu hóa và cấp lại mật khẩu của tài khoản này (ghi audit). Bộ đánh giá quyền không có ngoại lệ.</p>}
              </div>
            )}
            {active === 'roles' && <AccountRolesSection account={account} onSessionLost={onSessionLost} />}
            {active === 'permissions' && <AccountPermissionsSection account={account} onSessionLost={onSessionLost} />}
            {active === 'status' && <AccountStatusSection account={account} onSessionLost={onSessionLost} onChanged={refresh} />}
            {active === 'sessions' && <AccountSessionsSection account={account} onSessionLost={onSessionLost} />}
            {active === 'audit' && <IamAuditViewer account={account.accountId} onSessionLost={onSessionLost} />}
          </div>
        </>
      )}
    </div>
  );
}
