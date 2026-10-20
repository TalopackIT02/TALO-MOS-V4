import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ApiResult, MenuNode } from '../../services/foundation/foundationApi';
import { iamApi } from '../../services/iam/iamApi';
import type { MenuItem } from '../../services/iam/iamApi';
import { shellPathOf } from '../../routes/shellScreens';
import type { ShellPath } from '../../routes/shellScreens';
import { useShellData } from '../../contexts/ShellData';
import { DataTable, NameCode } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { byFunction, isTestModuleKey, moduleLabel, useModuleFunctions, useSettle } from '../iam/iamShared';
import { FeedbackLine } from './common';
import { DEFAULT_MENU_ICON, NavIcon } from '../../components/icons/NavIcon';
import { IconPicker } from '../../components/icons/IconPicker';
import type { Feedback, ScreenProps } from './common';

// FE-06 / WS02 — Navigation, the ONLY manager of the menu items (B09). Tab 0: the menu of the signed-in account (the same
// list as the sidebar and the home screen). Tab 1: B09 management — Module / Function / parent chosen by NAME from the
// stored data (IAM adapter, read only), no id typed by hand; writes go through the existing Foundation API
// (POST / PATCH /api/foundation/navigation/items — permission foundation.navigation.manage). No DELETE, no parent change
// (the PATCH contract changes title / order / visibility only), one visible item per Function (no duplicate).

// MOD-TEST-01: a menu route that the shell can open (module screen) is a link when `onOpen` is given.
export function MenuTree({ nodes, onOpen }: { nodes: readonly MenuNode[]; onOpen?: (path: ShellPath) => void }) {
  return (
    <ul className="fx-tree">
      {nodes.map((n) => {
        const target = onOpen && n.routePath ? shellPathOf(n.routePath) : undefined;
        return (
          <li key={n.navigationId}>
            {target && onOpen
              ? <button type="button" className="fx-menu-link" onClick={() => onOpen(target)}>{n.menuTitle}</button>
              : <b>{n.menuTitle}</b>}
            {n.routePath && <small>{n.routePath}</small>}
            {n.children.length > 0 && <MenuTree nodes={n.children} onOpen={onOpen} />}
          </li>
        );
      })}
    </ul>
  );
}

export function NavigationScreen({ tab, onSessionLost }: ScreenProps) {
  const { menu, menuFeedback, reloadMenu } = useShellData();
  if (tab === 1) return <ManageMenu onSessionLost={onSessionLost} onChanged={reloadMenu} />;
  return (
    <>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn" onClick={() => void reloadMenu()}>Tải lại</button>
        <span className="muted">Cùng danh sách với Sidebar và Trang chủ: chỉ gồm chức năng của module đang bật, có phiên bản ACTIVE và bạn có quyền IAM hiệu lực.</span>
      </div>
      <FeedbackLine feedback={menuFeedback} />
      {menu === null ? <p className="info">Đang tải…</p> : menu.length === 0
        ? <p className="info">Chưa có chức năng nghiệp vụ nào được cấp quyền cho tài khoản này.</p>
        : <MenuTree nodes={menu} />}
    </>
  );
}

const yesNo = (v: boolean) => (v ? 'Có' : 'Không');

function ManageMenu({ onSessionLost, onChanged }: { onSessionLost: () => void; onChanged: () => Promise<void> }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const settle = useSettle(onSessionLost, setFeedback);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { modules, moduleId, setModuleId, functions, module } = useModuleFunctions(settle);
  const [functionId, setFunctionId] = useState('');
  // An explicit kind: a Function item needs a Function (a group with a Function's name never opens anything).
  const [kind, setKind] = useState<'function' | 'group'>('function');
  const [parentId, setParentId] = useState('');
  const [title, setTitle] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [visible, setVisible] = useState(true);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editOrder, setEditOrder] = useState('0');
  const [editVisible, setEditVisible] = useState(true);
  const [showTest, setShowTest] = useState(false);
  // Icon of a MENU item: chosen from the library for preview only — B09 has no icon column, nothing is sent or stored.
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setItems(settle(await iamApi.navigationItems()) ?? []);
    setLoading(false);
  }, [settle]);
  useEffect(() => { void reload(); }, [reload]);

  const fns = useMemo(() => byFunction(functions), [functions]);
  // Parents: groups (no Function) — global ones and those of the chosen module.
  const groups = (items ?? []).filter((i) => i.functionId === null && !isTestModuleKey(i.moduleKey) && (i.moduleId === null || i.moduleId === moduleId));
  // One visible menu item per Function (a second one would show the same screen twice).
  const hasItem = (fid: string) => (items ?? []).some((i) => i.functionId === fid && i.isVisible);
  const shown = (items ?? []).filter((i) => showTest || !isTestModuleKey(i.moduleKey));

  async function save<T>(work: Promise<ApiResult<T>>, done: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    const ok = settle(await work) !== null;
    if (ok) setFeedback({ tone: 'success', text: done });
    await reload();
    if (ok) await onChanged(); // sidebar + home follow the stored menu
    setBusy(false);
    return ok;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
    if (kind === 'function' && (!functionId || hasItem(functionId))) return setFeedback({ tone: 'error', text: 'Chọn một Chức năng chưa có mục menu đang hiển thị.' });
    const ok = await save(foundationApi.createItem({
      parentId: parentId || null, moduleId: moduleId || null, functionId: kind === 'function' ? functionId : null, menuTitle: title.trim(), sortOrder: order, isVisible: visible,
    }), kind === 'group' ? `Đã tạo nhóm menu “${title.trim()}”.` : `Đã tạo mục chức năng “${title.trim()}”.`);
    if (ok) { setTitle(''); setFunctionId(''); }
  }

  function edit(item: MenuItem) {
    setEditing(item);
    setEditTitle(item.menuTitle);
    setEditOrder(String(item.sortOrder));
    setEditVisible(item.isVisible);
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    const order = Number(editOrder);
    if (!editing) return;
    if (!Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
    // Showing again a hidden Function item would make a duplicate when another visible item opens the same Function.
    if (editVisible && !editing.isVisible && editing.functionId && hasItem(editing.functionId)) {
      return setFeedback({ tone: 'error', text: 'Chức năng này đã có một mục menu đang hiển thị; không hiển thị thêm mục trùng.' });
    }
    if (await save(foundationApi.updateItem(editing.navigationId, { menuTitle: editTitle.trim(), sortOrder: order, isVisible: editVisible }), 'Đã cập nhật mục menu.')) setEditing(null);
  }

  const columns: Column<MenuItem>[] = [
    { key: 'menuTitle', label: 'Tiêu đề', value: (i) => i.menuTitle, render: (i) => (i.functionId ? i.menuTitle : <span className="nav-item-title"><NavIcon name={DEFAULT_MENU_ICON} size={16} /><b>{i.menuTitle}</b></span>) },
    { key: 'kind', label: 'Loại', value: (i) => (i.functionId ? 'Chức năng' : 'Nhóm') },
    { key: 'parent', label: 'Menu cha', value: (i) => i.parentTitle ?? '— Gốc —' },
    { key: 'module', label: 'Module', value: (i) => `${i.moduleName ?? ''} ${i.moduleKey ?? ''}`.trim() || '—', render: (i) => (i.moduleKey ? <NameCode name={i.moduleName} code={i.moduleKey} /> : '— (chung)') },
    { key: 'function', label: 'Chức năng', value: (i) => `${i.functionName ?? ''} ${i.functionKey ?? ''}`.trim() || '—', render: (i) => (i.functionKey ? <NameCode name={i.functionName} code={i.functionKey} /> : '—') },
    { key: 'sortOrder', label: 'Thứ tự', value: (i) => String(i.sortOrder).padStart(6, '0'), render: (i) => i.sortOrder, searchable: false },
    { key: 'isVisible', label: 'Hiển thị', value: (i) => yesNo(i.isVisible) },
  ];

  return (
    <>
      <FeedbackLine feedback={feedback} />
      <p className="info">Module / Chức năng được chọn theo tên của phiên bản ACTIVE. Mục chức năng chỉ hiện với tài khoản có quyền IAM hiệu lực và khi Module ACTIVE + ENABLED. Không xóa mục menu; ẩn bằng “Hiển thị: Không”.</p>
      <form className="fx-form" onSubmit={(e) => void create(e)} aria-label="Tạo mục menu">
        <label>Loại mục
          <select value={kind} onChange={(e) => { const k = e.target.value === 'group' ? 'group' : 'function'; setKind(k); if (k === 'group') setFunctionId(''); }}>
            <option value="function">Mục chức năng (mở màn hình của Chức năng)</option>
            <option value="group">Nhóm menu (chỉ để chứa mục con)</option>
          </select>
        </label>
        <label>Module{kind === 'group' ? ' (để trống = nhóm chung)' : ''}
          <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setFunctionId(''); setParentId(''); }}>
            <option value="">{kind === 'group' ? '— Nhóm chung —' : 'Chọn module…'}</option>
            {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{moduleLabel(m)}</option>)}
          </select>
        </label>
        {kind === 'function' && <label>Chức năng
          <select required value={functionId} disabled={!moduleId} onChange={(e) => { setFunctionId(e.target.value); const f = fns.find((x) => x.functionId === e.target.value); if (f) setTitle(f.displayName); }}>
            <option value="">Chọn chức năng…</option>
            {fns.map((f) => <option key={f.functionId} value={f.functionId} disabled={hasItem(f.functionId)}>{f.displayName} ({f.functionKey}){hasItem(f.functionId) ? ' · đã có menu' : ''}</option>)}
          </select>
        </label>}
        <label>Menu cha
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— Gốc —</option>
            {groups.map((g) => <option key={g.navigationId} value={g.navigationId}>{g.menuTitle}{g.moduleName || g.moduleKey ? ` (${g.moduleName ?? g.moduleKey})` : ' (chung)'}</option>)}
          </select>
        </label>
        <label>Tiêu đề hiển thị<input required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Thứ tự<input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
        <label>Hiển thị
          <select value={visible ? 'true' : 'false'} onChange={(e) => setVisible(e.target.value === 'true')}><option value="true">Có</option><option value="false">Không</option></select>
        </label>
        <div><button type="submit" className="fx-btn primary" disabled={busy || !title.trim() || (kind === 'function' && (!moduleId || !functionId || hasItem(functionId)))}>{kind === 'function' ? 'Tạo mục chức năng' : 'Tạo nhóm menu'}</button></div>
      </form>
      {kind === 'group' && <IconPreviewOnly value={iconPreview} onChange={setIconPreview} />}
      {kind === 'group' && fns.some((f) => f.displayName.trim().toLowerCase() === title.trim().toLowerCase()) && (
        <p className="fx-msg error">Tiêu đề trùng tên một Chức năng: nhóm menu không mở chức năng. Chọn “Mục chức năng” để tạo mục mở màn hình.</p>
      )}
      {module && <p className="muted">{moduleLabel(module)}: {fns.length} chức năng — {fns.filter((f) => hasItem(f.functionId)).length} đã có mục menu.</p>}

      {editing && (
        <form className="fx-version-area fx-section" onSubmit={(e) => void update(e)} aria-label="Sửa mục menu">
          <h3>Sửa mục “{editing.menuTitle}” {editing.functionKey ? `· ${editing.functionName ?? editing.functionKey}` : '· nhóm'}</h3>
          <div className="fx-form">
            <label>Tiêu đề hiển thị<input required maxLength={150} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
            <label>Thứ tự<input inputMode="numeric" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} /></label>
            <label>Hiển thị<select value={editVisible ? 'true' : 'false'} onChange={(e) => setEditVisible(e.target.value === 'true')}><option value="true">Có</option><option value="false">Không</option></select></label>
          </div>
          <p className="muted">Menu cha: {editing.parentTitle ?? '— Gốc —'} (API Foundation không đổi menu cha của mục đã tạo).</p>
          {!editing.functionId && <IconPreviewOnly value={iconPreview} onChange={setIconPreview} />}
          <div className="fx-toolbar" style={{ marginBottom: 0 }}>
            <button type="submit" className="fx-btn primary" disabled={busy || !editTitle.trim()}>Lưu mục menu</button>
            <button type="button" className="fx-btn" onClick={() => setEditing(null)}>Hủy</button>
          </div>
        </form>
      )}
      <div className="fx-section">
        <h3>Mục menu đang lưu (B09)</h3>
        <DataTable
          label="mục menu"
          columns={columns}
          rows={items === null ? null : shown}
          rowKey={(i) => i.navigationId}
          loading={loading}
          selectedKey={editing?.navigationId ?? null}
          onRefresh={() => void reload()}
          emptyText="Chưa có mục menu."
          initial={{ sort: 'sortOrder' }}
          toolbar={<label className="muted"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Hiện mục của module kiểm thử (FBET_)</label>}
          actions={(i) => <button type="button" className="fx-btn" onClick={() => edit(i)}>Sửa</button>}
        />
      </div>
    </>
  );
}

// MENU icon (owner rule): chosen by name from the fixed SVG library. Foundation B09 has no field for an icon key yet, so
// the choice is a PREVIEW only — it is not sent to the API and not stored; the sidebar keeps the default menu icon until
// the database change is approved. Function items never get an icon (this block is not shown for them).
function IconPreviewOnly({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  return (
    <div className="icon-preview-only">
      <p className="fx-msg info" role="note">
        <b>Icon của menu — chỉ xem trước, CHƯA lưu.</b> Bảng menu (B09) hiện chưa có trường lưu icon; mọi menu đang dùng icon
        mặc định “{DEFAULT_MENU_ICON}”. Lưu icon cần thay đổi cơ sở dữ liệu và đang chờ chủ dự án phê duyệt.
      </p>
      <IconPicker value={value} onChange={onChange} label="Icon của menu (xem trước)" />
    </div>
  );
}
