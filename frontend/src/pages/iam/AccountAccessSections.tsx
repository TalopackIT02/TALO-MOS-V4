import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { iamApi, isPlatformPermission } from '../../services/iam/iamApi';
import type { Account, DirectGrant, Effective, GrantSource, PermissionTree, Role, RoleAssignment } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { useShellData } from '../../contexts/ShellData';
import { DataTable, NameCode } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { isTestModuleKey, statusTag, useSettle } from './iamShared';

// Roles and direct permissions of ONE account (IAM-B-UI-01: sections of the account workspace; formerly the inline
// account detail). Every change goes through the IAM API, which decides (permission, root / self protection, platform
// lock, one transaction + IAM audit); controls follow the session's capabilities (iam.assignments.manage).

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

export function usePermissionTree(settle: <T>(r: ApiResult<T>) => T | null) {
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

export const RootBadge = () => <span className="badge root" title="Tài khoản quản trị gốc: vai trò hệ thống và quyền quản trị nền tảng không thu hồi được qua giao diện">Quản trị gốc</span>;

// One change at a time per section: confirm → API → feedback → reload.
function useAct(settle: <T>(r: ApiResult<T>) => T | null, setFeedback: (f: Feedback | null) => void, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (work: () => Promise<ApiResult<true>>, done: string, confirmText?: string) => {
    if (busy || (confirmText && !window.confirm(confirmText))) return;
    setBusy(true);
    setFeedback(null);
    if (settle(await work())) setFeedback({ tone: 'success', text: done });
    await reload();
    setBusy(false);
  }, [busy, settle, setFeedback, reload]);
  return { busy, act };
}

// ------------------------------------------------------------------------------------------------------------- roles
export function AccountRolesSection({ account, onSessionLost }: { account: Account; onSessionLost: () => void }) {
  const { can } = useShellData();
  const manage = can('iam.assignments.manage');
  const accountId = account.accountId;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [assignments, setAssignments] = useState<RoleAssignment[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState('');

  const reload = useCallback(async () => setAssignments(settle(await iamApi.accountRoles(accountId)) ?? []), [accountId, settle]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void iamApi.roles().then((r) => setRoles(settle(r) ?? [])); }, [settle]);
  const { busy, act } = useAct(settle, setFeedback, reload);

  const isSystemRole = (id: string) => roles.some((r) => r.roleId === id && r.isSystem);
  return (
    <div className="acc-section">
      <FeedbackLine feedback={feedback} />
      <h4>Vai trò được gán (lịch sử cấp / thu hồi)</h4>
      {assignments === null ? <p className="muted">Đang tải…</p> : assignments.length === 0 ? <p className="muted">Chưa có vai trò.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Vai trò</th><th>Gán lúc</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{assignments.map((a) => (
            <tr key={a.userRoleId}>
              <td><NameCode name={a.roleName} code={a.roleCode} />{a.roleActive ? '' : ' (vai trò không hoạt động)'}{isSystemRole(a.roleId) && <span className="badge">hệ thống</span>}</td>
              <td>{formatTime(a.assignedAt)}</td>
              <td>{a.revokedAt ? `Đã thu hồi ${formatTime(a.revokedAt)}` : statusTag(true, 'Hiệu lực')}</td>
              <td>{manage && !a.revokedAt && !(isSystemRole(a.roleId) && account.isRoot) && (
                <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(() => iamApi.revokeRole(accountId, a.userRoleId), `Đã thu hồi vai trò ${a.roleName}.`,
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
          <button type="button" className="fx-btn primary" disabled={!roleId || busy} onClick={() => void act(() => iamApi.assignRole(accountId, roleId), 'Đã gán vai trò.')}>Gán vai trò</button>
        </div>
      )}
      <p className="muted">Vai trò hệ thống chỉ được cấp qua quy trình khởi tạo đã phê duyệt; không tự cấp hoặc thu hồi quyền của chính mình.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- direct + effective grants
export function AccountPermissionsSection({ account, onSessionLost }: { account: Account; onSessionLost: () => void }) {
  const { can } = useShellData();
  const manage = can('iam.assignments.manage');
  const accountId = account.accountId;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const { tree, names } = usePermissionTree(settle);
  const [direct, setDirect] = useState<DirectGrant[]>([]);
  const [effective, setEffective] = useState<Effective[] | null>(null);
  const [permissionId, setPermissionId] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [onlyAllowed, setOnlyAllowed] = useState(true);

  const reload = useCallback(async () => {
    const perms = settle(await iamApi.accountPermissions(accountId));
    setDirect(perms?.direct ?? []);
    setEffective(perms?.effective ?? []);
  }, [accountId, settle]);
  useEffect(() => { void reload(); }, [reload]);
  const { busy, act } = useAct(settle, setFeedback, reload);

  function grant(event: FormEvent) {
    event.preventDefault();
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && Number.isNaN(expiry.getTime())) return setFeedback({ tone: 'error', text: 'Thời điểm hết hạn không hợp lệ.' });
    void act(() => iamApi.assignDirect(accountId, { permissionId, effect, reason: reason.trim(), expiresAt: expiry ? expiry.toISOString() : null }),
      `Đã cấp quyền trực tiếp ${effect}.`, effect === 'DENY' ? 'Direct DENY luôn thắng mọi ALLOW của permission này. Tiếp tục?' : undefined);
  }

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
    <div className="acc-section">
      <FeedbackLine feedback={feedback} />
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
              <td>{manage && !d.revokedAt && <button type="button" className="fx-btn danger" disabled={busy} onClick={() => void act(() => iamApi.revokeDirect(accountId, d.userPermissionId), 'Đã thu hồi quyền trực tiếp.', `Thu hồi ${d.effect} ${d.permissionCode}?`)}>Thu hồi</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {manage && (
        <form className="fx-form acc-grant-form" style={{ marginTop: 10 }} onSubmit={grant} aria-label="Cấp quyền trực tiếp">
          <label className="acc-grant-perm">Quyền (Module › Chức năng › Thao tác)
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
      <p className="muted">Permission quản trị nền tảng (IAM / FOUNDATION) chỉ được cấp qua quy trình khởi tạo đã phê duyệt; không tự cấp hoặc thu hồi quyền của chính mình.</p>

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
