import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { IAM_TEXT, iamApi } from '../../services/iam/iamApi';
import type { Account, ActiveModule, DirectGrant, Effective, MenuItem, ModuleFunction, Permission, Role, RoleAssignment, RolePermission } from '../../services/iam/iamApi';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { describeFailure } from '../../services/foundation/foundationMessages';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';

// IAM Management screens (/iam/accounts, /iam/roles). Every list comes from the IAM API (reload / F5 shows the stored
// data); every change goes through the API, which authorises it (IAM permission + one transaction + IAM audit). The UI
// decides nothing: a 403 / 409 / 422 / 503 is shown with its reference. B09 menus are created / changed only through the
// existing Foundation API (POST / PATCH /api/foundation/navigation/items); the IAM adapter only lists names.

function useSettle(onSessionLost: () => void, setFeedback: (f: Feedback | null) => void) {
  return useCallback(<T,>(result: ApiResult<T>): T | null => {
    if (result.ok) return result.data;
    if (result.status === 401) {
      onSessionLost();
      return null;
    }
    const own = IAM_TEXT[result.code];
    const reference = result.requestId ? ` Mã tham chiếu: ${result.requestId}.` : '';
    setFeedback({ tone: 'error', text: own ? `${own}${reference}` : describeFailure(result) + (result.status < 500 ? reference : '') });
    return null;
  }, [onSessionLost, setFeedback]);
}

const statusTag = (active: boolean, text: string) => <span className={active ? 'tag fx-status-active' : 'tag'}>{text}</span>;

// ============================================================================================================ Accounts
const PAGE_SIZE = 25;

export function AccountsScreen({ onSessionLost }: { onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ accounts: Account[]; total: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = settle(await iamApi.accounts(search, page, PAGE_SIZE));
    setResult(data ?? { accounts: [], total: 0 });
  }, [settle, search, page]);
  useEffect(() => { void load(); }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    setPage(1);
    setSearch(query.trim());
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  return (
    <>
      <form className="fx-toolbar" onSubmit={submit}>
        <input className="search" aria-label="Tìm tài khoản" placeholder="Username / mã nhân viên / họ tên" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="fx-btn">Tìm kiếm</button>
        <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại</button>
        {result && <span className="muted">{result.total} tài khoản</span>}
      </form>
      <FeedbackLine feedback={feedback} />
      {selected && <AccountDetail key={selected} accountId={selected} onSessionLost={onSessionLost} onClose={() => setSelected(null)} />}
      {result === null ? <p className="info">Đang tải…</p> : result.accounts.length === 0 ? <p className="info">Không có tài khoản phù hợp hoặc bạn không có quyền xem.</p> : (
        <div className="fx-module-list">
          <table>
            <thead><tr><th>Tài khoản</th><th>Nhân viên</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {result.accounts.map((a) => (
                <tr key={a.accountId} className={a.accountId === selected ? 'fx-selected' : undefined}>
                  <td><b>{a.username}</b></td>
                  <td>{a.employeeCode} — {a.fullName}</td>
                  <td>{statusTag(a.accountStatus === 'ACTIVE' && !a.disabled, a.disabled ? `${a.accountStatus} · vô hiệu` : a.accountStatus)}</td>
                  <td><button type="button" className="fx-btn" onClick={() => setSelected(a.accountId)}>Chi tiết</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="fx-toolbar" style={{ marginTop: 10 }}>
          <button type="button" className="fx-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</button>
          <span className="muted">Trang {page} / {pages}</span>
          <button type="button" className="fx-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau ›</button>
        </div>
      )}
    </>
  );
}

function AccountDetail({ accountId, onSessionLost, onClose }: { accountId: string; onSessionLost: () => void; onClose: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [account, setAccount] = useState<Account | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [direct, setDirect] = useState<DirectGrant[]>([]);
  const [effective, setEffective] = useState<Effective[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
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
  useEffect(() => {
    void Promise.all([iamApi.roles(), iamApi.permissions()]).then(([r, p]) => {
      setRoles(settle(r) ?? []);
      setPermissions(settle(p) ?? []);
    });
  }, [settle]);

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

  const shown = onlyAllowed ? effective.filter((x) => x.allowed) : effective;
  return (
    <div className="fx-version-area fx-section">
      <div className="fx-toolbar">
        <h3 style={{ margin: 0 }}>{account ? `${account.username} — ${account.fullName}` : 'Tài khoản'}</h3>
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

      <h4>Vai trò được gán (lịch sử)</h4>
      {assignments.length === 0 ? <p className="muted">Chưa có vai trò.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Vai trò</th><th>Gán lúc</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{assignments.map((a) => (
            <tr key={a.userRoleId}>
              <td><b>{a.roleCode}</b> — {a.roleName}{a.roleActive ? '' : ' (vai trò không hoạt động)'}</td>
              <td>{formatTime(a.assignedAt)}</td>
              <td>{a.revokedAt ? `Đã thu hồi ${formatTime(a.revokedAt)}` : statusTag(true, 'Hiệu lực')}</td>
              <td>{!a.revokedAt && <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(iamApi.revokeRole(accountId, a.userRoleId), `Đã thu hồi vai trò ${a.roleCode}.`, `Thu hồi vai trò ${a.roleCode}?`)}>Thu hồi</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="fx-toolbar" style={{ marginTop: 10 }}>
        <select aria-label="Vai trò" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Chọn vai trò…</option>
          {roles.filter((r) => r.isActive).map((r) => <option key={r.roleId} value={r.roleId}>{r.roleCode} — {r.roleName}</option>)}
        </select>
        <button type="button" className="fx-btn primary" disabled={!roleId || busy} onClick={() => void act(iamApi.assignRole(accountId, roleId), 'Đã gán vai trò.')}>Gán vai trò</button>
      </div>

      <h4>Quyền trực tiếp (Direct ALLOW / DENY)</h4>
      {direct.length === 0 ? <p className="muted">Chưa có quyền trực tiếp.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Permission</th><th>Hiệu ứng</th><th>Lý do</th><th>Hết hạn</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{direct.map((d) => (
            <tr key={d.userPermissionId}>
              <td>{d.permissionCode}</td>
              <td>{statusTag(d.effect === 'ALLOW', d.effect)}</td>
              <td>{d.reason ?? '—'}</td>
              <td>{formatTime(d.expiresAt)}</td>
              <td>{d.revokedAt ? `Đã thu hồi ${formatTime(d.revokedAt)}` : d.expired ? 'Hết hạn' : 'Hiệu lực'}</td>
              <td>{!d.revokedAt && <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(iamApi.revokeDirect(accountId, d.userPermissionId), 'Đã thu hồi quyền trực tiếp.', `Thu hồi ${d.effect} ${d.permissionCode}?`)}>Thu hồi</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <form className="fx-form" style={{ marginTop: 10 }} onSubmit={grant}>
        <label>Permission
          <select value={permissionId} onChange={(e) => setPermissionId(e.target.value)}>
            <option value="">Chọn permission…</option>
            {permissions.map((p) => <option key={p.permissionId} value={p.permissionId}>{p.permissionCode} ({p.moduleCode}/{p.resourceCode}/{p.operation})</option>)}
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

      <h4>Quyền hiệu lực</h4>
      <p className="muted">
        Tính bằng bộ đánh giá IAM chung với giả định phiên của tài khoản này đạt mức assurance tối thiểu của từng permission
        (không dùng phiên của người đang xem). Module chỉ hiện khi đồng thời ACTIVE + ENABLED và có mục menu.
      </p>
      <label className="muted"><input type="checkbox" checked={onlyAllowed} onChange={(e) => setOnlyAllowed(e.target.checked)} /> Chỉ hiện quyền đang ALLOW</label>
      <div className="tablewrap"><table>
        <thead><tr><th>Permission</th><th>Kết quả</th><th>Lý do</th><th>Assurance giả định</th></tr></thead>
        <tbody>{shown.map((x) => (
          <tr key={x.permissionId}><td>{x.permissionCode}</td><td>{statusTag(x.allowed, x.allowed ? 'ALLOW' : 'DENY')}</td><td>{x.reason}</td><td>{x.assumedAssuranceLevel}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// =============================================================================================================== Roles
export function RolesScreen({ tab, onSessionLost }: { tab: number; onSessionLost: () => void }) {
  if (tab === 1) return <PermissionCatalog onSessionLost={onSessionLost} />;
  if (tab === 2) return <FunctionMenus onSessionLost={onSessionLost} />;
  return <RoleManagement onSessionLost={onSessionLost} />;
}

function RoleManagement({ onSessionLost }: { onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<RolePermission[]>([]);
  const [roleCode, setRoleCode] = useState('');
  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [permissionId, setPermissionId] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [r, p] = await Promise.all([iamApi.roles(), iamApi.permissions()]);
    setRoles(settle(r) ?? []);
    setPermissions(settle(p) ?? []);
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
    if (await act(iamApi.addRole({ roleCode: roleCode.trim(), roleName: roleName.trim(), ...(description.trim() ? { description: description.trim() } : {}) }), `Đã tạo vai trò ${roleCode.trim()}.`)) {
      setRoleCode('');
      setRoleName('');
      setDescription('');
    }
  }

  const available = permissions.filter((p) => !assigned.some((a) => a.permissionId === p.permissionId));
  return (
    <>
      <FeedbackLine feedback={feedback} />
      {selected && (
        <div className="fx-version-area fx-section">
          <div className="fx-toolbar">
            <h3 style={{ margin: 0 }}>{selected.roleCode} — {selected.roleName}</h3>
            {statusTag(selected.isActive, selected.isActive ? 'ACTIVE' : 'INACTIVE')}
            {selected.isSystem && <span className="tag">Vai trò hệ thống (khóa)</span>}
            <button type="button" className="fx-btn" onClick={() => setSelectedId(null)}>Đóng</button>
          </div>
          {selected.isSystem ? <p className="muted">Vai trò hệ thống chỉ được cấp qua quy trình khởi tạo đã phê duyệt; giao diện chỉ hiển thị.</p> : (
            <form className="fx-form" onSubmit={(e) => { e.preventDefault(); void act(iamApi.updateRole(selected.roleId, { roleName: editName.trim(), description: editDescription.trim() || null }), 'Đã cập nhật vai trò.'); }}>
              <label>Tên vai trò<input required maxLength={150} value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
              <label>Mô tả<input maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></label>
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
          <h4>Permission của vai trò ({assigned.length})</h4>
          {assigned.length === 0 ? <p className="muted">Chưa có permission.</p> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Permission</th><th>Module / Resource / Operation</th><th /></tr></thead>
              <tbody>{assigned.map((a) => (
                <tr key={a.permissionId}>
                  <td>{a.permissionCode}</td><td>{a.moduleCode} / {a.resourceCode} / {a.operation}</td>
                  <td>{!selected.isSystem && <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(iamApi.revokeRolePermission(selected.roleId, a.permissionId), 'Đã bỏ permission khỏi vai trò.', `Bỏ ${a.permissionCode} khỏi ${selected.roleCode}?`)}>Bỏ quyền</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {!selected.isSystem && (
            <div className="fx-toolbar" style={{ marginTop: 10 }}>
              <select aria-label="Permission cho vai trò" value={permissionId} onChange={(e) => setPermissionId(e.target.value)}>
                <option value="">Chọn permission…</option>
                {available.map((p) => <option key={p.permissionId} value={p.permissionId}>{p.permissionCode} ({p.moduleCode}/{p.resourceCode}/{p.operation})</option>)}
              </select>
              <button type="button" className="fx-btn primary" disabled={!permissionId || busy} onClick={() => { void act(iamApi.assignRolePermission(selected.roleId, permissionId), 'Đã gán permission cho vai trò.'); setPermissionId(''); }}>Gán permission</button>
            </div>
          )}
        </div>
      )}
      <form className="fx-form" onSubmit={(e) => void create(e)}>
        <label>Mã vai trò<input required maxLength={80} pattern="[A-Za-z][A-Za-z0-9_.\-]*" placeholder="SYSTEM_TEST_USER" value={roleCode} onChange={(e) => setRoleCode(e.target.value)} /></label>
        <label>Tên vai trò<input required maxLength={150} value={roleName} onChange={(e) => setRoleName(e.target.value)} /></label>
        <label>Mô tả<input maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div><button type="submit" className="fx-btn primary" disabled={busy || !roleCode.trim() || !roleName.trim()}>Tạo vai trò</button></div>
      </form>
      {roles === null ? <p className="info">Đang tải…</p> : (
        <div className="fx-module-list"><table>
          <thead><tr><th>Mã</th><th>Tên</th><th>Trạng thái</th><th>Permission</th><th>Đang gán</th><th /></tr></thead>
          <tbody>{roles.map((r) => (
            <tr key={r.roleId} className={r.roleId === selectedId ? 'fx-selected' : undefined}>
              <td><b>{r.roleCode}</b>{r.isSystem ? ' · hệ thống' : ''}</td><td>{r.roleName}</td>
              <td>{statusTag(r.isActive, r.isActive ? 'ACTIVE' : 'INACTIVE')}</td><td>{r.permissionCount}</td><td>{r.activeAssignments}</td>
              <td><button type="button" className="fx-btn" onClick={() => setSelectedId(r.roleId)}>Quản lý</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

// Distinct Functions of the adapter rows (one row per Function × Action).
function byFunction(rows: readonly ModuleFunction[]) {
  const map = new Map<string, { functionId: string; functionKey: string; displayName: string; actions: string[] }>();
  for (const r of rows) {
    const f = map.get(r.functionId) ?? { functionId: r.functionId, functionKey: r.functionKey, displayName: r.displayName, actions: [] };
    if (r.actionKey) f.actions.push(r.actionKey);
    map.set(r.functionId, f);
  }
  return [...map.values()];
}

function useModuleFunctions(settle: <T>(r: ApiResult<T>) => T | null) {
  const [modules, setModules] = useState<ActiveModule[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [functions, setFunctions] = useState<ModuleFunction[]>([]);
  useEffect(() => { void iamApi.activeModules().then((r) => setModules(settle(r) ?? [])); }, [settle]);
  useEffect(() => {
    setFunctions([]);
    if (moduleId) void iamApi.functions(moduleId).then((r) => setFunctions(settle(r) ?? []));
  }, [moduleId, settle]);
  return { modules, moduleId, setModuleId, functions, module: modules.find((m) => m.moduleId === moduleId) ?? null };
}

function PermissionCatalog({ onSessionLost }: { onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [filter, setFilter] = useState('');
  const { modules, moduleId, setModuleId, functions, module } = useModuleFunctions(settle);
  const [action, setAction] = useState('');
  const [code, setCode] = useState('');
  const [assurance, setAssurance] = useState(1);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setPermissions(settle(await iamApi.permissions()) ?? []), [settle]);
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
    setBusy(false);
  }

  const q = filter.trim().toLowerCase();
  const shown = (permissions ?? []).filter((p) => !q || `${p.permissionCode} ${p.moduleCode} ${p.resourceCode} ${p.operation}`.toLowerCase().includes(q));
  return (
    <>
      <FeedbackLine feedback={feedback} />
      <form className="fx-section" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }} onSubmit={(e) => void create(e)}>
        <h3>Tạo permission từ MIC-07 (K05)</h3>
        <p className="muted">Chọn Module đang ACTIVE và cặp Function / Action đã khai báo; máy chủ chỉ chấp nhận bộ ba khớp đúng một ánh xạ MIC-07 của phiên bản ACTIVE. Permission quản trị IAM / FOUNDATION không tạo ở đây.</p>
        <div className="fx-form">
          <label>Module
            <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setAction(''); setCode(''); }}>
              <option value="">Chọn module…</option>
              {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.moduleKey} {m.activeVersion}{m.isEnabled ? '' : ' (đang tắt)'}</option>)}
            </select>
          </label>
          <label>Function / Action
            <select value={action} onChange={(e) => pick(e.target.value)} disabled={!moduleId}>
              <option value="">Chọn…</option>
              {pairs.map((p) => <option key={p.key} value={p.key}>{p.name} — {p.key}{module && exists(module.moduleKey, p.functionKey, p.actionKey) ? ' (đã có permission)' : ''}</option>)}
            </select>
          </label>
          <label>Permission code<input required maxLength={160} pattern="[a-z][a-z0-9_.]*" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <label>Assurance tối thiểu (theo MIC-07)
            <select value={assurance} onChange={(e) => setAssurance(e.target.value === '2' ? 2 : 1)}><option value={1}>1</option><option value={2}>2</option></select>
          </label>
          <label>Mô tả<input maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        <button type="submit" className="fx-btn primary" disabled={busy || !chosen || !code.trim()}>Tạo permission</button>
      </form>
      <div className="fx-section">
        <div className="fx-toolbar">
          <h3 style={{ margin: 0 }}>Danh mục Permission</h3>
          <input className="search" aria-label="Lọc permission" placeholder="Lọc theo code / module / resource / operation" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="fx-btn" onClick={() => void reload()}>Tải lại</button>
          <span className="muted">{shown.length} / {permissions?.length ?? 0}</span>
        </div>
        {permissions === null ? <p className="info">Đang tải…</p> : (
          <div className="fx-module-list"><table>
            <thead><tr><th>Permission code</th><th>Module</th><th>Resource</th><th>Operation</th><th>Assurance</th></tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.permissionId}><td><b>{p.permissionCode}</b></td><td>{p.moduleCode}</td><td>{p.resourceCode}</td><td>{p.operation}</td><td>{p.minimumAssuranceLevel}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function FunctionMenus({ onSessionLost }: { onSessionLost: () => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const { modules, moduleId, setModuleId, functions, module } = useModuleFunctions(settle);
  const [functionId, setFunctionId] = useState('');
  const [parentId, setParentId] = useState('');
  const [title, setTitle] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editOrder, setEditOrder] = useState('0');
  const [editVisible, setEditVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setItems(settle(await iamApi.navigationItems()) ?? []), [settle]);
  useEffect(() => { void reload(); }, [reload]);

  const fns = useMemo(() => byFunction(functions), [functions]);
  const groups = (items ?? []).filter((i) => i.functionId === null && (i.moduleId === null || i.moduleId === moduleId));
  const hasItem = (fid: string) => (items ?? []).some((i) => i.functionId === fid);

  async function save<T>(work: Promise<ApiResult<T>>, done: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    const ok = settle(await work) !== null;
    if (ok) setFeedback({ tone: 'success', text: done });
    await reload();
    setBusy(false);
    return ok;
  }

  async function create(event: FormEvent, kind: 'group' | 'function') {
    event.preventDefault();
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
    const ok = await save(foundationApi.createItem({
      parentId: parentId || null, moduleId: moduleId || null, functionId: kind === 'function' ? functionId : null, menuTitle: title.trim(), sortOrder: order, isVisible: true,
    }), kind === 'group' ? `Đã tạo nhóm menu “${title.trim()}”.` : `Đã tạo mục menu “${title.trim()}”.`);
    if (ok) { setTitle(''); setFunctionId(''); }
  }

  function edit(item: MenuItem) {
    setEditId(item.navigationId);
    setEditTitle(item.menuTitle);
    setEditOrder(String(item.sortOrder));
    setEditVisible(item.isVisible);
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    const order = Number(editOrder);
    if (!editId || !Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
    if (await save(foundationApi.updateItem(editId, { menuTitle: editTitle.trim(), sortOrder: order, isVisible: editVisible }), 'Đã cập nhật mục menu.')) setEditId(null);
  }

  return (
    <>
      <FeedbackLine feedback={feedback} />
      <p className="info">Tạo và sửa mục menu (B09) qua API Foundation hiện có (quyền foundation.navigation.manage). Module / Function được chọn theo tên từ phiên bản ACTIVE; menu chỉ hiện với tài khoản có quyền IAM hiệu lực và khi Module ACTIVE + ENABLED.</p>
      <form className="fx-form" onSubmit={(e) => void create(e, functionId ? 'function' : 'group')}>
        <label>Module
          <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setFunctionId(''); setParentId(''); }}>
            <option value="">Chọn module…</option>
            {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.moduleKey} {m.activeVersion}{m.isEnabled ? '' : ' (đang tắt)'}</option>)}
          </select>
        </label>
        <label>Function (để trống = nhóm menu)
          <select value={functionId} onChange={(e) => { setFunctionId(e.target.value); const f = fns.find((x) => x.functionId === e.target.value); if (f) setTitle(f.displayName); }} disabled={!moduleId}>
            <option value="">— Nhóm menu —</option>
            {fns.map((f) => <option key={f.functionId} value={f.functionId}>{f.displayName} ({f.functionKey}){hasItem(f.functionId) ? ' · đã có menu' : ''}</option>)}
          </select>
        </label>
        <label>Menu cha
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— Gốc —</option>
            {groups.map((g) => <option key={g.navigationId} value={g.navigationId}>{g.menuTitle}{g.moduleKey ? ` (${g.moduleKey})` : ''}</option>)}
          </select>
        </label>
        <label>Tiêu đề<input required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Thứ tự<input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
        <div><button type="submit" className="fx-btn primary" disabled={busy || !title.trim() || (!moduleId && !!functionId)}>{functionId ? 'Tạo mục chức năng' : 'Tạo nhóm menu'}</button></div>
      </form>
      {module && <p className="muted">{module.moduleKey} {module.activeVersion}: {fns.length} Function — {fns.filter((f) => hasItem(f.functionId)).length} đã có mục menu.</p>}

      {editId && (
        <form className="fx-form fx-section" onSubmit={(e) => void update(e)}>
          <label>Tiêu đề<input required maxLength={150} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
          <label>Thứ tự<input inputMode="numeric" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} /></label>
          <label>Hiển thị<select value={editVisible ? 'true' : 'false'} onChange={(e) => setEditVisible(e.target.value === 'true')}><option value="true">Có</option><option value="false">Không</option></select></label>
          <div className="fx-toolbar" style={{ marginBottom: 0 }}>
            <button type="submit" className="fx-btn primary" disabled={busy || !editTitle.trim()}>Lưu mục menu</button>
            <button type="button" className="fx-btn" onClick={() => setEditId(null)}>Hủy</button>
          </div>
        </form>
      )}
      <div className="fx-section">
        <div className="fx-toolbar"><h3 style={{ margin: 0 }}>Mục menu đang lưu (B09)</h3><button type="button" className="fx-btn" onClick={() => void reload()}>Tải lại</button></div>
        {items === null ? <p className="info">Đang tải…</p> : items.length === 0 ? <p className="muted">Chưa có mục menu.</p> : (
          <div className="fx-module-list"><table>
            <thead><tr><th>Tiêu đề</th><th>Menu cha</th><th>Module</th><th>Function</th><th>Thứ tự</th><th>Hiển thị</th><th /></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.navigationId} className={i.navigationId === editId ? 'fx-selected' : undefined}>
                <td><b>{i.menuTitle}</b></td><td>{i.parentTitle ?? '—'}</td><td>{i.moduleKey ?? '—'}</td><td>{i.functionKey ?? '(nhóm)'}</td>
                <td>{i.sortOrder}</td><td>{i.isVisible ? 'Có' : 'Không'}</td>
                <td><button type="button" className="fx-btn" onClick={() => edit(i)}>Sửa</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
