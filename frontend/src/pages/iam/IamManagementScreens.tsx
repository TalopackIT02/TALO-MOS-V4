import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { iamApi, isPlatformPermission } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import type { Account, AccountField, Permission, Role, RolePermission } from '../../services/iam/iamApi';
import { useShellData } from '../../contexts/ShellData';
import { DataTable, FIRST_QUERY, NameCode } from '../../components/DataTable';
import type { Column, TableQuery } from '../../components/DataTable';
import { replaceSearch } from '../../routes/navigation';
import type { OpenPath } from '../../routes/navigation';
import { accountIdOfPath, accountWorkspacePath } from '../../routes/shellScreens';
import type { ShellPath } from '../../routes/shellScreens';
import { FeedbackLine } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { isTestModuleKey, moduleLabel, statusTag, useModuleFunctions, useSettle } from './iamShared';
import { IamAuditViewer, accountStatusText } from './AccountLifecycle';
import { RootBadge, usePermissionTree } from './AccountAccessSections';
import { AccountDetailDrawer, AccountStatusTag, AccountWorkspace, CreateAccountDrawer } from './AccountWorkspace';
import type { CreatedAccount } from './AccountWorkspace';

// IAM Management screens (/iam/accounts, /iam/roles). Every list comes from the IAM API (reload / F5 shows the stored
// data); every change goes through the API, which authorises it (IAM permission + one transaction + IAM audit). The UI
// decides nothing: a 403 / 409 / 422 / 503 is shown with its reference; controls the session may not use are hidden
// (capabilities). Permissions are shown as Module → Function → Action (names of the ACTIVE version, MIC) → permission.
// Menu items (B09) are managed only in Foundation › Điều hướng.
// IAM-B-UI-01: /iam/accounts = list (+ detail drawer); /iam/accounts/:accountId = account management workspace.

// ============================================================================================================ Accounts
const ACCOUNT_FIELDS: readonly AccountField[] = ['username', 'employeeCode', 'fullName', 'accountStatus'];
const toField = (key: string | null): AccountField | null => ACCOUNT_FIELDS.find((f) => f === key) ?? null;
const STATUSES = ['PENDING_MEMBERSHIP', 'PROVISIONED', 'ACTIVE', 'LOCKED', 'DISABLED'] as const;
const PAGE_SIZES = [10, 25, 50, 100] as const;

// ------------------------------------------------------------------------------------- list state ⇄ URL query string
// The list state lives in the query of /iam/accounts (q, field, status, sort, dir, page, size; defaults omitted). It is
// written with replaceState (no history entry per keystroke) and read when the list mounts — so browser Back from the
// workspace, a reload or a shared link show the same table.
interface ListState {
  readonly query: TableQuery;
  readonly status: string;
}

const DEFAULT_LIST: ListState = { query: { ...FIRST_QUERY, sort: 'username' }, status: '' };

function positive(raw: string | null, fallback: number): number {
  const n = raw !== null && /^[0-9]{1,6}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export function listStateFromSearch(search: string): ListState {
  const p = new URLSearchParams(search);
  const size = positive(p.get('size'), DEFAULT_LIST.query.pageSize);
  const status = p.get('status') ?? '';
  return {
    query: {
      search: (p.get('q') ?? '').trim().slice(0, 100),
      field: toField(p.get('field')),
      sort: toField(p.get('sort')) ?? 'username',
      dir: p.get('dir') === 'desc' ? 'desc' : 'asc',
      page: positive(p.get('page'), 1),
      pageSize: PAGE_SIZES.find((s) => s === size) ?? DEFAULT_LIST.query.pageSize,
    },
    status: STATUSES.find((s) => s === status) ?? '',
  };
}

export function listStateToSearch({ query, status }: ListState): string {
  const p = new URLSearchParams();
  if (query.search) p.set('q', query.search);
  if (query.field) p.set('field', query.field);
  if (status) p.set('status', status);
  if (query.sort && query.sort !== 'username') p.set('sort', query.sort);
  if (query.dir === 'desc') p.set('dir', 'desc');
  if (query.page > 1) p.set('page', String(query.page));
  if (query.pageSize !== DEFAULT_LIST.query.pageSize) p.set('size', String(query.pageSize));
  return p.toString();
}

// Server mode: search / field / status / sort / paging are sent to GET /iam/admin/accounts (column allowlist there).
function accountColumns(onPick: (a: Account, opener: HTMLElement) => void): Column<Account>[] {
  return [
    { key: 'username', label: 'Tài khoản', value: (a) => a.username, render: (a) => (
      <><button type="button" className="fx-link acc-pick" onClick={(e) => onPick(a, e.currentTarget)}><b>{a.username}</b></button> {a.isRoot && <RootBadge />}</>
    ) },
    // No membership yet (PENDING_MEMBERSHIP): no employee data — shown as a dash.
    { key: 'fullName', label: 'Họ tên', value: (a) => a.fullName ?? '', render: (a) => a.fullName ?? <span className="muted">—</span> },
    { key: 'employeeCode', label: 'Mã nhân viên', value: (a) => a.employeeCode ?? '', render: (a) => a.employeeCode ?? <span className="muted">—</span> },
    { key: 'accountStatus', label: 'Trạng thái', value: (a) => a.accountStatus, render: (a) => <AccountStatusTag account={a} /> },
  ];
}

// Tab 0: accounts — list, or the workspace of one account (path /iam/accounts/:id); tab 1: IAM audit (iam.audit.read).
export function AccountsScreen({ tab, path, onSessionLost, onOpenPath }: { tab: number; path: ShellPath; onSessionLost: () => void; onOpenPath: OpenPath }) {
  const accountId = accountIdOfPath(path);
  if (accountId !== null) return <AccountWorkspace key={accountId} accountId={accountId} onSessionLost={onSessionLost} onOpenPath={onOpenPath} />;
  if (tab === 1) return <IamAuditViewer onSessionLost={onSessionLost} />;
  return <AccountList onSessionLost={onSessionLost} onOpenPath={onOpenPath} />;
}

function AccountList({ onSessionLost, onOpenPath }: { onSessionLost: () => void; onOpenPath: OpenPath }) {
  const { can } = useShellData();
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [list, setList] = useState<ListState>(() => listStateFromSearch(window.location.search));
  const { query, status } = list;
  const [result, setResult] = useState<{ accounts: Account[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { replaceSearch(listStateToSearch(list)); }, [list]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = settle(await iamApi.accounts({
      search: query.search, field: toField(query.field), status: status || null, sort: toField(query.sort) ?? 'username', dir: query.dir, page: query.page, pageSize: query.pageSize,
    }));
    setResult(data ?? { accounts: [], total: 0 });
    setLoading(false);
  }, [settle, query, status]);
  useEffect(() => { void load(); }, [load]);

  // One drawer at a time: opening the detail closes the create drawer and the other way round.
  const pick = useCallback((accountId: string, from: HTMLElement) => {
    opener.current = from;
    setCreating(false);
    setSelected(accountId);
  }, []);
  const openCreate = () => {
    setSelected(null);
    setCreatedAccount(null);
    setCreating(true);
  };
  const closeCreate = useCallback(() => {
    setCreating(false);
    createButton.current?.focus();
  }, []);
  // Saved by the server: close the drawer, say so, reload the list (its query unchanged); the new account opens from the message.
  const created = useCallback((account: CreatedAccount) => {
    setCreating(false);
    setFeedback(null);
    setCreatedAccount(account);
    void load();
  }, [load]);
  const closeDrawer = useCallback(() => {
    setSelected(null);
    opener.current?.focus();
  }, []);
  // Level 3: a new history entry that remembers this list (with its query) — browser Back and "← Quay lại danh sách" return here.
  const manage = useCallback((accountId: string) => {
    onOpenPath(accountWorkspacePath(accountId), { returnTo: `${window.location.pathname}${window.location.search}` });
  }, [onOpenPath]);

  return (
    <>
      <FeedbackLine feedback={feedback} />
      {createdAccount && (
        <div className="fx-msg success" role="status">
          Đã tạo tài khoản <b>{createdAccount.username}</b> ở trạng thái Chờ Membership (chưa gán nhân viên, chưa cấp mật khẩu).{' '}
          <button type="button" className="fx-link" onClick={(e) => pick(createdAccount.accountId, e.currentTarget)}>Xem tài khoản</button>
        </div>
      )}
      <DataTable
        label="tài khoản"
        columns={accountColumns((a, el) => pick(a.accountId, el))}
        rows={result?.accounts ?? null}
        rowKey={(a) => a.accountId}
        loading={loading}
        selectedKey={selected}
        emptyText="Không có tài khoản phù hợp."
        onRefresh={() => void load()}
        server={{ total: result?.total ?? 0, query, onQuery: (q) => setList((l) => ({ ...l, query: q })) }}
        toolbar={(
          <>
            <select aria-label="Lọc trạng thái" value={status} onChange={(e) => { const s = e.target.value; setList((l) => ({ status: s, query: { ...l.query, page: 1 } })); }}>
              <option value="">Mọi trạng thái</option>
              {STATUSES.map((s) => <option key={s} value={s}>{accountStatusText(s)}</option>)}
            </select>
            {can('iam.accounts.create') && <button type="button" ref={createButton} className="fx-btn primary" aria-expanded={creating} onClick={openCreate}>+ Tạo tài khoản</button>}
          </>
        )}
        actions={(a) => <button type="button" className="fx-btn" aria-expanded={selected === a.accountId} onClick={(e) => pick(a.accountId, e.currentTarget)}>Chi tiết</button>}
      />
      {selected && <AccountDetailDrawer accountId={selected} onClose={closeDrawer} onManage={manage} onSessionLost={onSessionLost} />}
      {creating && <CreateAccountDrawer onClose={closeCreate} onCreated={created} onSessionLost={onSessionLost} />}
    </>
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
          <div className="fx-form iam-k05-form">
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
            <label className="iam-span-all">Mô tả / ghi chú<input maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
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
