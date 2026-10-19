import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { iamApi, isPlatformPermission } from '../../services/iam/iamApi';
import type { Account, AccountField, DirectGrant, Effective, GrantSource, Permission, PermissionTree, Role, RoleAssignment, RolePermission } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { useShellData } from '../../contexts/ShellData';
import { DataTable, FIRST_QUERY, NameCode } from '../../components/DataTable';
import type { Column, TableQuery } from '../../components/DataTable';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { isTestModuleKey, moduleLabel, statusTag, useModuleFunctions, useSettle } from './iamShared';

// IAM Management screens (/iam/accounts, /iam/roles). Every list comes from the IAM API (reload / F5 shows the stored
// data); every change goes through the API, which authorises it (IAM permission + one transaction + IAM audit). The UI
// decides nothing: a 403 / 409 / 422 / 503 is shown with its reference; controls the session may not use are hidden
// (capabilities). Permissions are shown as Module → Function → Action (names of the ACTIVE version, MIC) → permission.
// Menu items (B09) are managed only in Foundation › Điều hướng.

// ---------------------------------------------------------------------------------------------- permission names (tree)
interface PermissionName {
  readonly moduleName: string;
  readonly functionName: string;
  readonly actionName: string;
}

// permissionId → names from the tree (platform / unbound permissions have no declared names).
function namesOf(tree: PermissionTree | null): Map<string, PermissionName> {
  const out = new Map<string, PermissionName>();
  for (const m of tree?.modules ?? []) {
    for (const f of m.functions) {
      for (const a of f.actions) {
        if (a.permission) out.set(a.permission.permissionId, { moduleName: m.moduleName || m.moduleKey, functionName: f.functionName || f.functionKey, actionName: a.actionName || a.actionKey });
      }
    }
  }
  return out;
}

function usePermissionTree(settle: <T>(r: ApiResult<T>) => T | null) {
  const [tree, setTree] = useState<PermissionTree | null>(null);
  const reload = useCallback(async () => setTree(settle(await iamApi.permissionTree())), [settle]);
  useEffect(() => { void reload(); }, [reload]);
  return { tree, names: useMemo(() => namesOf(tree), [tree]), reload };
}

const SOURCE_TEXT: Record<GrantSource, { text: string; tone: string }> = {
  ROLE: { text: 'Vai trò', tone: 'role' },
  DIRECT_ALLOW: { text: 'Direct ALLOW', tone: 'allow' },
  DIRECT_DENY: { text: 'Direct DENY', tone: 'deny' },
};

const RootBadge = () => <span className="badge root" title="Tài khoản quản trị gốc: vai trò hệ thống và quyền quản trị nền tảng không thu hồi được qua giao diện">Quản trị gốc</span>;

// ============================================================================================================ Accounts
const ACCOUNT_FIELDS: readonly AccountField[] = ['username', 'employeeCode', 'fullName', 'accountStatus'];
const toField = (key: string | null): AccountField | null => ACCOUNT_FIELDS.find((f) => f === key) ?? null;
const STATUSES = ['PROVISIONED', 'ACTIVE', 'LOCKED', 'DISABLED'] as const;

// Server mode: search / field / status / sort / paging are sent to GET /iam/admin/accounts (column allowlist there).
const ACCOUNT_COLUMNS: Column<Account>[] = [
  { key: 'username', label: 'Tài khoản', value: (a) => a.username, render: (a) => <><b>{a.username}</b> {a.isRoot && <RootBadge />}</> },
  { key: 'fullName', label: 'Họ tên', value: (a) => a.fullName },
  { key: 'employeeCode', label: 'Mã nhân viên', value: (a) => a.employeeCode },
  { key: 'accountStatus', label: 'Trạng thái', value: (a) => a.accountStatus, render: (a) => statusTag(a.accountStatus === 'ACTIVE' && !a.disabled, a.disabled ? `${a.accountStatus} · vô hiệu` : a.accountStatus) },
];

export function AccountsScreen({ onSessionLost }: { onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [query, setQuery] = useState<TableQuery>({ ...FIRST_QUERY, sort: 'username' });
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<{ accounts: Account[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = settle(await iamApi.accounts({
      search: query.search, field: toField(query.field), status: status || null, sort: toField(query.sort) ?? 'username', dir: query.dir, page: query.page, pageSize: query.pageSize,
    }));
    setResult(data ?? { accounts: [], total: 0 });
    setLoading(false);
  }, [settle, query, status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <FeedbackLine feedback={feedback} />
      {selected && <AccountDetail key={selected} accountId={selected} onSessionLost={onSessionLost} onClose={() => setSelected(null)} />}
      <DataTable
        label="tài khoản"
        columns={ACCOUNT_COLUMNS}
        rows={result?.accounts ?? null}
        rowKey={(a) => a.accountId}
        loading={loading}
        selectedKey={selected}
        emptyText="Không có tài khoản phù hợp."
        onRefresh={() => void load()}
        server={{ total: result?.total ?? 0, query, onQuery: setQuery }}
        toolbar={(
          <select aria-label="Lọc trạng thái" value={status} onChange={(e) => { setStatus(e.target.value); setQuery((q) => ({ ...q, page: 1 })); }}>
            <option value="">Mọi trạng thái</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        actions={(a) => <button type="button" className="fx-btn" onClick={() => setSelected(a.accountId)}>Chi tiết</button>}
      />
    </>
  );
}

function AccountDetail({ accountId, onSessionLost, onClose }: { accountId: string; onSessionLost: () => void; onClose: () => void }) {
  const { can } = useShellData();
  const manage = can('iam.assignments.manage');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { tree, names } = usePermissionTree(settle);
  const [account, setAccount] = useState<Account | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [direct, setDirect] = useState<DirectGrant[]>([]);
  const [effective, setEffective] = useState<Effective[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState('');
  const [permissionId, setPermissionId] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [onlyAllowed, setOnlyAllowed] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [a, r, p] = await Promise.all([iamApi.account(accountId), iamApi.accountRoles(accountId), iamApi.accountPermissions(accountId)]);
    setAccount(settle(a));
    setAssignments(settle(r) ?? []);
    const perms = settle(p);
    setDirect(perms?.direct ?? []);
    setEffective(perms?.effective ?? []);
  }, [accountId, settle]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void iamApi.roles().then((r) => setRoles(settle(r) ?? [])); }, [settle]);

  async function act(work: Promise<ApiResult<true>>, done: string, confirmText?: string) {
    if (busy || (confirmText && !window.confirm(confirmText))) return;
    setBusy(true);
    setFeedback(null);
    if (settle(await work)) setFeedback({ tone: 'success', text: done });
    await reload();
    setBusy(false);
  }

  function grant(event: FormEvent) {
    event.preventDefault();
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && Number.isNaN(expiry.getTime())) return setFeedback({ tone: 'error', text: 'Thời điểm hết hạn không hợp lệ.' });
    void act(iamApi.assignDirect(accountId, { permissionId, effect, reason: reason.trim(), expiresAt: expiry ? expiry.toISOString() : null }),
      `Đã cấp quyền trực tiếp ${effect}.`, effect === 'DENY' ? 'Direct DENY luôn thắng mọi ALLOW của permission này. Tiếp tục?' : undefined);
  }

  const isSystemRole = (id: string) => roles.some((r) => r.roleId === id && r.isSystem);
  const label = (id: string, code: string) => {
    const n = names.get(id);
    return n ? `${n.moduleName} › ${n.functionName} › ${n.actionName}` : code;
  };
  const effectiveColumns: Column<Effective>[] = [
    { key: 'module', label: 'Module', value: (x) => names.get(x.permissionId)?.moduleName ?? x.moduleCode, render: (x) => <NameCode name={names.get(x.permissionId)?.moduleName} code={x.moduleCode} /> },
    { key: 'function', label: 'Chức năng › Thao tác', value: (x) => (names.has(x.permissionId) ? `${names.get(x.permissionId)?.functionName} › ${names.get(x.permissionId)?.actionName}` : `${x.resourceCode} › ${x.operation}`) },
    { key: 'permissionCode', label: 'Permission', value: (x) => x.permissionCode, render: (x) => <code>{x.permissionCode}</code> },
    { key: 'allowed', label: 'Kết quả', value: (x) => (x.allowed ? 'ALLOW' : 'DENY'), render: (x) => statusTag(x.allowed, x.allowed ? 'ALLOW' : 'DENY') },
    { key: 'sources', label: 'Nguồn', value: (x) => x.sources.map((s) => SOURCE_TEXT[s].text).join(' '), render: (x) => (x.sources.length === 0 ? <span className="muted">—</span> : x.sources.map((s) => <span key={s} className={`badge ${SOURCE_TEXT[s].tone}`}>{SOURCE_TEXT[s].text}</span>)) },
    { key: 'reason', label: 'Lý do (bộ đánh giá)', value: (x) => x.reason },
  ];
  const grantable = (tree?.modules ?? []).filter((m) => !isTestModuleKey(m.moduleKey));

  return (
    <div className="fx-version-area fx-section">
      <div className="fx-toolbar">
        <h3 style={{ margin: 0 }}>{account ? `${account.fullName || account.username} (${account.username})` : 'Tài khoản'}</h3>
        {account?.isRoot && <RootBadge />}
        <button type="button" className="fx-btn" onClick={() => void reload()}>Tải lại</button>
        <button type="button" className="fx-btn" onClick={onClose}>Đóng</button>
      </div>
      <FeedbackLine feedback={feedback} />
      {account && (
        <div className="fx-meta">
          <span><b>Mã nhân viên:</b> {account.employeeCode}</span>
          <span><b>Tài khoản:</b> {account.accountStatus}{account.disabled ? ' (vô hiệu)' : ''}</span>
          <span><b>Membership:</b> {account.membershipStatus}</span>
        </div>
      )}
      {account?.isRoot && <p className="muted">Tài khoản quản trị gốc: máy chủ chặn thu hồi vai trò hệ thống và chặn Direct DENY / thu hồi quyền quản trị nền tảng của tài khoản này (ghi audit). Bộ đánh giá quyền không có ngoại lệ.</p>}

      <h4>Vai trò được gán (lịch sử)</h4>
      {assignments.length === 0 ? <p className="muted">Chưa có vai trò.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Vai trò</th><th>Gán lúc</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{assignments.map((a) => (
            <tr key={a.userRoleId}>
              <td><NameCode name={a.roleName} code={a.roleCode} />{a.roleActive ? '' : ' (vai trò không hoạt động)'}{isSystemRole(a.roleId) && <span className="badge">hệ thống</span>}</td>
              <td>{formatTime(a.assignedAt)}</td>
              <td>{a.revokedAt ? `Đã thu hồi ${formatTime(a.revokedAt)}` : statusTag(true, 'Hiệu lực')}</td>
              <td>{manage && !a.revokedAt && !(isSystemRole(a.roleId) && account?.isRoot) && (
                <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(iamApi.revokeRole(accountId, a.userRoleId), `Đã thu hồi vai trò ${a.roleName}.`,
                  isSystemRole(a.roleId) ? `Thu hồi VAI TRÒ HỆ THỐNG ${a.roleCode}? Tài khoản sẽ mất quyền quản trị của vai trò này.` : `Thu hồi vai trò ${a.roleName}?`)}>Thu hồi</button>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {manage && (
        <div className="fx-toolbar" style={{ marginTop: 10 }}>
          <select aria-label="Vai trò" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Chọn vai trò…</option>
            {roles.filter((r) => r.isActive && !r.isSystem).map((r) => <option key={r.roleId} value={r.roleId}>{r.roleName} ({r.roleCode})</option>)}
          </select>
          <button type="button" className="fx-btn primary" disabled={!roleId || busy} onClick={() => void act(iamApi.assignRole(accountId, roleId), 'Đã gán vai trò.')}>Gán vai trò</button>
        </div>
      )}

      <h4>Quyền trực tiếp (Direct ALLOW / DENY)</h4>
      {direct.length === 0 ? <p className="muted">Chưa có quyền trực tiếp.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Quyền</th><th>Hiệu ứng</th><th>Lý do</th><th>Hết hạn</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{direct.map((d) => (
            <tr key={d.userPermissionId}>
              <td><NameCode name={names.has(d.permissionId) ? label(d.permissionId, d.permissionCode) : null} code={d.permissionCode} /></td>
              <td><span className={`badge ${d.effect === 'DENY' ? 'deny' : 'allow'}`}>{d.effect}</span></td>
              <td>{d.reason ?? '—'}</td>
              <td>{formatTime(d.expiresAt)}</td>
              <td>{d.revokedAt ? `Đã thu hồi ${formatTime(d.revokedAt)}` : d.expired ? 'Hết hạn' : 'Hiệu lực'}</td>
              <td>{manage && !d.revokedAt && <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(iamApi.revokeDirect(accountId, d.userPermissionId), 'Đã thu hồi quyền trực tiếp.', `Thu hồi ${d.effect} ${d.permissionCode}?`)}>Thu hồi</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {manage && (
        <form className="fx-form" style={{ marginTop: 10 }} onSubmit={grant}>
          <label>Quyền (Module › Chức năng › Thao tác)
            <select value={permissionId} onChange={(e) => setPermissionId(e.target.value)}>
              <option value="">Chọn quyền…</option>
              {grantable.map((m) => (
                <optgroup key={m.moduleKey} label={`${m.moduleName || m.moduleKey} (${m.moduleKey} ${m.moduleVersion})`}>
                  {m.functions.flatMap((f) => f.actions.flatMap((a) => (a.permission && !isPlatformPermission(a.permission) ? [
                    <option key={a.permission.permissionId} value={a.permission.permissionId}>{f.functionName || f.functionKey} › {a.actionName || a.actionKey} — {a.permission.permissionCode}</option>,
                  ] : [])))}
                </optgroup>
              ))}
              {(tree?.unbound.length ?? 0) > 0 && (
                <optgroup label="Permission không gắn Thao tác đang khai báo">
                  {tree?.unbound.map((p) => <option key={p.permissionId} value={p.permissionId}>{p.permissionCode}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label>Hiệu ứng
            <select value={effect} onChange={(e) => setEffect(e.target.value === 'DENY' ? 'DENY' : 'ALLOW')}>
              <option value="ALLOW">ALLOW</option>
              <option value="DENY">DENY (thắng mọi ALLOW)</option>
            </select>
          </label>
          <label>Lý do<input required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <label>Hết hạn (tùy chọn)<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
          <div><button type="submit" className="fx-btn primary" disabled={!permissionId || !reason.trim() || busy}>Cấp quyền trực tiếp</button></div>
        </form>
      )}
      <p className="muted">Vai trò hệ thống và permission quản trị nền tảng (IAM / FOUNDATION) chỉ được cấp qua quy trình khởi tạo đã phê duyệt; không tự cấp hoặc thu hồi quyền của chính mình.</p>

      <h4>Quyền hiệu lực</h4>
      <p className="muted">
        Kết quả do bộ đánh giá IAM của máy chủ tính (Direct DENY thắng mọi ALLOW), giả định phiên của tài khoản này đạt mức assurance tối
        thiểu của từng permission. “Nguồn” là các cấp quyền còn hiệu lực mà bộ đánh giá nhìn thấy.
      </p>
      <DataTable
        label="quyền hiệu lực"
        compact
        columns={effectiveColumns}
        rows={effective === null ? null : onlyAllowed ? effective.filter((x) => x.allowed || x.sources.length > 0) : effective}
        rowKey={(x) => x.permissionId}
        initial={{ sort: 'module' }}
        emptyText="Tài khoản chưa có quyền nào."
        toolbar={<label className="muted"><input type="checkbox" checked={onlyAllowed} onChange={(e) => setOnlyAllowed(e.target.checked)} /> Chỉ quyền có cấp phát</label>}
      />
    </div>
  );
}

// =============================================================================================================== Roles
export function RolesScreen({ tab, onSessionLost }: { tab: number; onSessionLost: () => void }) {
  if (tab === 1) return <PermissionCatalog onSessionLost={onSessionLost} />;
  return <RoleManagement onSessionLost={onSessionLost} />;
}

const ROLE_COLUMNS: Column<Role>[] = [
  { key: 'roleName', label: 'Vai trò', value: (r) => `${r.roleName} ${r.roleCode}`, render: (r) => <><NameCode name={r.roleName} code={r.roleCode} />{r.isSystem && <span className="badge">hệ thống</span>}</> },
  { key: 'description', label: 'Mô tả', value: (r) => r.description ?? '', render: (r) => r.description ?? <span className="muted">—</span> },
  { key: 'isActive', label: 'Trạng thái', value: (r) => (r.isActive ? 'ACTIVE' : 'INACTIVE'), render: (r) => statusTag(r.isActive, r.isActive ? 'ACTIVE' : 'INACTIVE') },
  { key: 'permissionCount', label: 'Số quyền', value: (r) => String(r.permissionCount).padStart(6, '0'), render: (r) => r.permissionCount, searchable: false },
  { key: 'activeAssignments', label: 'Đang gán', value: (r) => String(r.activeAssignments).padStart(6, '0'), render: (r) => r.activeAssignments, searchable: false },
];

function RoleManagement({ onSessionLost }: { onSessionLost: () => void }) {
  const { can } = useShellData();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { tree } = usePermissionTree(settle);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<RolePermission[]>([]);
  const [roleCode, setRoleCode] = useState('');
  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [treeFilter, setTreeFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setRoles(settle(await iamApi.roles()) ?? []);
    setLoading(false);
  }, [settle]);
  useEffect(() => { void reload(); }, [reload]);
  const loadAssigned = useCallback(async (id: string) => setAssigned(settle(await iamApi.rolePermissions(id)) ?? []), [settle]);
  useEffect(() => { if (selectedId) void loadAssigned(selectedId); }, [selectedId, loadAssigned]);

  const selected = roles?.find((r) => r.roleId === selectedId) ?? null;
  useEffect(() => {
    setEditName(selected?.roleName ?? '');
    setEditDescription(selected?.description ?? '');
  }, [selected?.roleId, selected?.roleName, selected?.description]);

  async function act(work: Promise<ApiResult<true>>, done: string, confirmText?: string) {
    if (busy || (confirmText && !window.confirm(confirmText))) return false;
    setBusy(true);
    setFeedback(null);
    const ok = settle(await work) !== null;
    if (ok) setFeedback({ tone: 'success', text: done });
    await reload();
    if (selectedId) await loadAssigned(selectedId);
    setBusy(false);
    return ok;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (await act(iamApi.addRole({ roleCode: roleCode.trim(), roleName: roleName.trim(), ...(description.trim() ? { description: description.trim() } : {}) }), `Đã tạo vai trò ${roleName.trim()}.`)) {
      setRoleCode('');
      setRoleName('');
      setDescription('');
    }
  }

  // Checkbox = the role holds the permission: tick → POST (assign), untick → DELETE (revoke); the server decides.
  function toggle(role: Role, p: Permission, checked: boolean, name: string) {
    if (checked) void act(iamApi.assignRolePermission(role.roleId, p.permissionId), `Đã cấp “${name}” cho vai trò.`);
    else void act(iamApi.revokeRolePermission(role.roleId, p.permissionId), `Đã bỏ “${name}” khỏi vai trò.`, `Bỏ quyền “${name}” (${p.permissionCode}) khỏi vai trò ${role.roleName}?`);
  }

  const held = new Set(assigned.map((a) => a.permissionId));
  const editable = selected !== null && !selected.isSystem && can('iam.assignments.manage');
  const q = treeFilter.trim().toLocaleLowerCase('vi');
  const match = (...texts: (string | null)[]) => q === '' || texts.some((t) => (t ?? '').toLocaleLowerCase('vi').includes(q));
  // Test fixtures (FBET_*) are hidden unless the role holds one of their permissions.
  const modules = (tree?.modules ?? []).filter((m) => !isTestModuleKey(m.moduleKey) || m.functions.some((f) => f.actions.some((a) => a.permission && held.has(a.permission.permissionId))));
  const platformHeld = (tree?.platform ?? []).filter((p) => held.has(p.permissionId));
  const unboundHeld = (tree?.unbound ?? []).filter((p) => held.has(p.permissionId));

  return (
    <>
      <FeedbackLine feedback={feedback} />
      {selected && (
        <div className="fx-version-area fx-section">
          <div className="fx-toolbar">
            <h3 style={{ margin: 0 }}>{selected.roleName} <small className="muted">{selected.roleCode}</small></h3>
            {statusTag(selected.isActive, selected.isActive ? 'ACTIVE' : 'INACTIVE')}
            {selected.isSystem && <span className="tag">Vai trò hệ thống (khóa)</span>}
            <button type="button" className="fx-btn" onClick={() => setSelectedId(null)}>Đóng</button>
          </div>
          {selected.isSystem ? <p className="muted">Vai trò hệ thống chỉ được cấp qua quy trình khởi tạo đã phê duyệt; giao diện chỉ hiển thị.</p> : can('iam.roles.manage') && (
            <form className="fx-form" onSubmit={(e) => { e.preventDefault(); void act(iamApi.updateRole(selected.roleId, { roleName: editName.trim(), description: editDescription.trim() || null }), 'Đã cập nhật vai trò.'); }}>
              <label>Tên hiển thị<input required maxLength={150} value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
              <label>Mô tả / ghi chú<input maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></label>
              <div className="fx-toolbar" style={{ marginBottom: 0 }}>
                <button type="submit" className="fx-btn primary" disabled={busy || !editName.trim()}>Lưu</button>
                <button type="button" className={selected.isActive ? 'fx-btn danger' : 'fx-btn'} disabled={busy}
                  onClick={() => void act(iamApi.updateRole(selected.roleId, { isActive: !selected.isActive }), selected.isActive ? 'Đã vô hiệu hóa vai trò.' : 'Đã kích hoạt vai trò.',
                    selected.isActive ? 'Vô hiệu hóa vai trò? Mọi tài khoản đang được gán sẽ mất quyền từ vai trò này.' : undefined)}>
                  {selected.isActive ? 'Vô hiệu hóa' : 'Kích hoạt'}
                </button>
              </div>
            </form>
          )}
          <div className="fx-toolbar">
            <h4 style={{ margin: 0 }}>Quyền của vai trò ({assigned.length})</h4>
            <input className="search" aria-label="Lọc cây quyền" placeholder="Lọc theo module / chức năng / thao tác" value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} />
            {!editable && !selected.isSystem && <span className="muted">Cần quyền iam.assignments.manage để thay đổi.</span>}
          </div>
          {tree === null ? <p className="info">Đang tải cây quyền…</p> : modules.map((m) => {
            const fns = m.functions.filter((f) => match(m.moduleName, m.moduleKey, f.functionName, f.functionKey, ...f.actions.flatMap((a) => [a.actionName, a.actionKey])));
            if (fns.length === 0) return null;
            const count = m.functions.reduce((n, f) => n + f.actions.filter((a) => a.permission && held.has(a.permission.permissionId)).length, 0);
            return (
              <details key={m.moduleKey} className="pt-module" open={q !== '' || count > 0}>
                <summary><b>{m.moduleName || m.moduleKey}</b> <small>{m.moduleKey} · {m.moduleVersion}{m.isEnabled ? '' : ' · đang tắt'}</small> <span className="badge role">{count} quyền</span></summary>
                {fns.map((f) => (
                  <div key={f.functionKey} className="pt-fn">
                    <b>{f.functionName || f.functionKey}<small>{f.functionKey}</small></b>
                    {f.actions.map((a) => {
                      const name = `${f.functionName || f.functionKey} › ${a.actionName || a.actionKey}`;
                      const p = a.permission;
                      return (
                        <label key={a.actionKey} className="pt-action">
                          <input type="checkbox" checked={p !== null && held.has(p.permissionId)} disabled={!p || !editable || busy}
                            onChange={(e) => { if (p) toggle(selected, p, e.target.checked, name); }} />
                          <span>{a.actionName || a.actionKey}</span>
                          {p ? <code>{p.permissionCode}</code> : <span className="muted">(chưa có permission — tạo ở tab Danh mục Permission)</span>}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </details>
            );
          })}
          {(platformHeld.length > 0 || unboundHeld.length > 0) && (
            <div className="pt-module" style={{ padding: '10px 12px' }}>
              <b>Quyền quản trị nền tảng / không gắn thao tác (chỉ xem)</b>
              {[...platformHeld, ...unboundHeld].map((p) => <div key={p.permissionId} className="pt-action"><input type="checkbox" checked disabled readOnly /><code>{p.permissionCode}</code>{p.description && <span className="muted">{p.description}</span>}</div>)}
            </div>
          )}
        </div>
      )}
      {can('iam.roles.manage') && (
        <form className="fx-form" onSubmit={(e) => void create(e)} aria-label="Tạo vai trò">
          <label>Mã vai trò (kỹ thuật)<input required maxLength={80} pattern="[A-Za-z][A-Za-z0-9_.\-]*" placeholder="SYSTEM_TEST_USER" value={roleCode} onChange={(e) => setRoleCode(e.target.value)} /></label>
          <label>Tên hiển thị<input required maxLength={150} value={roleName} onChange={(e) => setRoleName(e.target.value)} /></label>
          <label>Mô tả / ghi chú<input maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div><button type="submit" className="fx-btn primary" disabled={busy || !roleCode.trim() || !roleName.trim()}>Tạo vai trò</button></div>
        </form>
      )}
      <DataTable
        label="vai trò"
        columns={ROLE_COLUMNS}
        rows={roles}
        rowKey={(r) => r.roleId}
        loading={loading}
        selectedKey={selectedId}
        onRefresh={() => void reload()}
        emptyText="Chưa có vai trò."
        initial={{ sort: 'roleName' }}
        actions={(r) => <button type="button" className="fx-btn" onClick={() => setSelectedId(r.roleId)}>Quản lý</button>}
      />
    </>
  );
}

function PermissionCatalog({ onSessionLost }: { onSessionLost: () => void }) {
  const { can } = useShellData();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { names, reload: reloadTree } = usePermissionTree(settle);
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { modules, moduleId, setModuleId, functions, module } = useModuleFunctions(settle);
  const [action, setAction] = useState('');
  const [code, setCode] = useState('');
  const [assurance, setAssurance] = useState(1);
  const [description, setDescription] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setPermissions(settle(await iamApi.permissions()) ?? []);
    setLoading(false);
  }, [settle]);
  useEffect(() => { void reload(); }, [reload]);

  const pairs = useMemo(() => functions.filter((f) => f.actionKey).map((f) => ({ key: `${f.functionKey}.${f.actionKey ?? ''}`, functionKey: f.functionKey, actionKey: f.actionKey ?? '', name: f.displayName })), [functions]);
  const chosen = pairs.find((p) => p.key === action) ?? null;
  const exists = (m: string, r: string, o: string) => (permissions ?? []).some((p) => p.moduleCode === m && p.resourceCode === r && p.operation === o);

  function pick(key: string) {
    setAction(key);
    const p = pairs.find((x) => x.key === key);
    if (p && module) setCode(`${module.moduleKey}.${p.functionKey}.${p.actionKey}`.toLowerCase());
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!module || !chosen || busy) return;
    setBusy(true);
    setFeedback(null);
    const ok = settle(await iamApi.addPermission({
      permissionCode: code.trim(), moduleCode: module.moduleKey, resourceCode: chosen.functionKey, operation: chosen.actionKey, minimumAssuranceLevel: assurance,
      ...(description.trim() ? { description: description.trim() } : {}),
    }));
    if (ok) setFeedback({ tone: 'success', text: `Đã tạo permission ${code.trim()}.` });
    await reload();
    await reloadTree();
    setBusy(false);
  }

  const columns: Column<Permission>[] = [
    { key: 'module', label: 'Module', value: (p) => `${names.get(p.permissionId)?.moduleName ?? ''} ${p.moduleCode}`, render: (p) => <NameCode name={names.get(p.permissionId)?.moduleName} code={p.moduleCode} /> },
    { key: 'function', label: 'Chức năng', value: (p) => `${names.get(p.permissionId)?.functionName ?? ''} ${p.resourceCode}`, render: (p) => <NameCode name={names.get(p.permissionId)?.functionName} code={p.resourceCode} /> },
    { key: 'action', label: 'Thao tác', value: (p) => `${names.get(p.permissionId)?.actionName ?? ''} ${p.operation}`, render: (p) => <NameCode name={names.get(p.permissionId)?.actionName} code={p.operation} /> },
    { key: 'permissionCode', label: 'Permission code', value: (p) => p.permissionCode, render: (p) => <code>{p.permissionCode}</code> },
    { key: 'description', label: 'Mô tả', value: (p) => p.description ?? '' },
    { key: 'assurance', label: 'Assurance', value: (p) => String(p.minimumAssuranceLevel), searchable: false },
    { key: 'kind', label: 'Loại', value: (p) => (isPlatformPermission(p) ? 'Nền tảng (khóa)' : names.has(p.permissionId) ? 'Module' : 'Không gắn thao tác') },
  ];

  return (
    <>
      <FeedbackLine feedback={feedback} />
      {can('iam.permissions.manage') && (
        <form className="fx-section" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }} onSubmit={(e) => void create(e)}>
          <h3>Tạo permission từ MIC-07 (K05)</h3>
          <p className="muted">Chọn Module đang ACTIVE và cặp Chức năng / Thao tác đã khai báo; máy chủ chỉ chấp nhận bộ ba khớp đúng một ánh xạ MIC-07 của phiên bản ACTIVE. Permission quản trị IAM / FOUNDATION không tạo ở đây.</p>
          <div className="fx-form">
            <label>Module
              <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setAction(''); setCode(''); }}>
                <option value="">Chọn module…</option>
                {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{moduleLabel(m)}</option>)}
              </select>
            </label>
            <label>Chức năng / Thao tác
              <select value={action} onChange={(e) => pick(e.target.value)} disabled={!moduleId}>
                <option value="">Chọn…</option>
                {pairs.map((p) => <option key={p.key} value={p.key} disabled={module !== null && exists(module.moduleKey, p.functionKey, p.actionKey)}>{p.name} › {p.actionKey} ({p.key}){module && exists(module.moduleKey, p.functionKey, p.actionKey) ? ' · đã có permission' : ''}</option>)}
              </select>
            </label>
            <label>Permission code<input required maxLength={160} pattern="[a-z][a-z0-9_.]*" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label>Assurance tối thiểu (theo MIC-07)
              <select value={assurance} onChange={(e) => setAssurance(e.target.value === '2' ? 2 : 1)}><option value={1}>1</option><option value={2}>2</option></select>
            </label>
            <label>Mô tả / ghi chú<input maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
          <button type="submit" className="fx-btn primary" disabled={busy || !chosen || !code.trim()}>Tạo permission</button>
        </form>
      )}
      <div className="fx-section">
        <h3>Danh mục Permission</h3>
        <DataTable
          label="permission"
          columns={columns}
          rows={permissions === null ? null : permissions.filter((p) => showTest || !isTestModuleKey(p.moduleCode))}
          rowKey={(p) => p.permissionId}
          loading={loading}
          onRefresh={() => { void reload(); void reloadTree(); }}
          emptyText="Chưa có permission."
          initial={{ sort: 'module' }}
          toolbar={<label className="muted"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Hiện module kiểm thử (FBET_)</label>}
        />
      </div>
    </>
  );
}
