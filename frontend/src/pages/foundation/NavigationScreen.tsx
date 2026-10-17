import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { MenuNode, ModuleRecord, NavigationItem } from '../../services/foundation/foundationApi';
import { FeedbackLine, settle } from './common';
import type { Feedback, ScreenProps } from './common';

// FE-06 — Navigation. Tab 0: the menu of the signed-in account (GET /foundation/navigation, already filtered by the
// backend: enabled module, ACTIVE version, effective IAM grant). Tab 1: B09 management (POST item, PATCH title / order /
// visibility). The backend offers no "list all items" nor "list functions" API: the parent and the function are entered
// by id (items created or changed in this session are listed for convenience). No DELETE, no parent change.

export function MenuTree({ nodes }: { nodes: readonly MenuNode[] }) {
  return (
    <ul className="fx-tree">
      {nodes.map((n) => (
        <li key={n.navigationId}>
          <b>{n.menuTitle}</b>
          {n.routePath && <small>{n.routePath}{n.screenKey ? ` · ${n.screenKey}` : ''}</small>}
          {n.children.length > 0 && <MenuTree nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export function useMenu(onSessionLost: () => void) {
  const [menu, setMenu] = useState<MenuNode[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const load = useCallback(async () => {
    setFeedback(null);
    const data = settle(await foundationApi.menu(), onSessionLost, setFeedback);
    setMenu(data ?? []);
  }, [onSessionLost]);
  useEffect(() => {
    void load();
  }, [load]);
  return { menu, feedback, load };
}

export function NavigationScreen({ tab, onSessionLost }: ScreenProps) {
  const { menu, feedback, load } = useMenu(onSessionLost);
  if (tab === 1) return <ManageMenu onSessionLost={onSessionLost} />;
  return (
    <>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại</button>
        <span className="muted">Menu chỉ gồm chức năng của module đang bật, có phiên bản ACTIVE và bạn có quyền IAM hiệu lực.</span>
      </div>
      <FeedbackLine feedback={feedback} />
      {menu === null ? <p className="info">Đang tải…</p> : menu.length === 0
        ? <p className="info">Chưa có chức năng nghiệp vụ nào được cấp quyền cho tài khoản này.</p>
        : <MenuTree nodes={menu} />}
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ManageMenu({ onSessionLost }: { onSessionLost: () => void }) {
  const [modules, setModules] = useState<ModuleRecord[]>([]);
  const [items, setItems] = useState<NavigationItem[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'group' | 'function'>('group');
  const [menuTitle, setMenuTitle] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isVisible, setIsVisible] = useState(true);
  const [parentId, setParentId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [functionId, setFunctionId] = useState('');
  const [editId, setEditId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editOrder, setEditOrder] = useState('');
  const [editVisible, setEditVisible] = useState<'' | 'true' | 'false'>('');

  useEffect(() => {
    void foundationApi.listModules().then((r) => setModules(settle(r, onSessionLost, setFeedback) ?? []));
  }, [onSessionLost]);

  function remember(item: NavigationItem) {
    setItems((current) => [item, ...current.filter((x) => x.navigationId !== item.navigationId)]);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
    if (parentId && !UUID.test(parentId.trim())) return setFeedback({ tone: 'error', text: 'Mã menu cha phải là UUID.' });
    if (kind === 'function' && (!moduleId || !UUID.test(functionId.trim()))) return setFeedback({ tone: 'error', text: 'Mục chức năng cần chọn module và nhập Function ID (UUID).' });
    setBusy(true);
    setFeedback(null);
    const data = settle(await foundationApi.createItem({
      parentId: parentId.trim() || null, moduleId: moduleId || null, functionId: kind === 'function' ? functionId.trim() : null,
      menuTitle: menuTitle.trim(), sortOrder: order, isVisible,
    }), onSessionLost, setFeedback);
    setBusy(false);
    if (data) {
      remember(data);
      setFeedback({ tone: 'success', text: `Đã tạo mục menu “${data.menuTitle}” (${data.navigationId}).` });
      setMenuTitle('');
    }
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!UUID.test(editId.trim())) return setFeedback({ tone: 'error', text: 'Mã mục menu phải là UUID.' });
    const change: { menuTitle?: string; sortOrder?: number; isVisible?: boolean } = {};
    if (editTitle.trim()) change.menuTitle = editTitle.trim();
    if (editOrder.trim()) {
      const order = Number(editOrder);
      if (!Number.isInteger(order)) return setFeedback({ tone: 'error', text: 'Thứ tự phải là số nguyên.' });
      change.sortOrder = order;
    }
    if (editVisible) change.isVisible = editVisible === 'true';
    if (Object.keys(change).length === 0) return setFeedback({ tone: 'error', text: 'Chọn ít nhất một thông tin cần sửa.' });
    setBusy(true);
    setFeedback(null);
    const data = settle(await foundationApi.updateItem(editId.trim(), change), onSessionLost, setFeedback);
    setBusy(false);
    if (data) {
      remember(data);
      setFeedback({ tone: 'success', text: `Đã cập nhật mục menu “${data.menuTitle}”.` });
    }
  }

  return (
    <>
      <p className="info">Thao tác quản trị cần quyền foundation.navigation.manage. Function ID lấy từ khai báo của module (chưa có API liệt kê chức năng).</p>
      <FeedbackLine feedback={feedback} />
      <form onSubmit={(e) => void create(e)}>
        <h3>Tạo mục menu</h3>
        <div className="fx-form">
          <label>Loại
            <select value={kind} onChange={(e) => setKind(e.target.value === 'function' ? 'function' : 'group')}>
              <option value="group">Nhóm menu</option>
              <option value="function">Mục chức năng</option>
            </select>
          </label>
          <label>Tiêu đề<input required maxLength={150} value={menuTitle} onChange={(e) => setMenuTitle(e.target.value)} /></label>
          <label>Thứ tự<input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
          <label>Hiển thị
            <select value={isVisible ? 'true' : 'false'} onChange={(e) => setIsVisible(e.target.value === 'true')}>
              <option value="true">Có</option>
              <option value="false">Không</option>
            </select>
          </label>
          <label>Module {kind === 'group' ? '(để trống = nhóm chung)' : ''}
            <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">—</option>
              {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.moduleKey}</option>)}
            </select>
          </label>
          <label>Menu cha (UUID, tùy chọn)<input value={parentId} onChange={(e) => setParentId(e.target.value)} list="fx-known-items" /></label>
          {kind === 'function' && <label>Function ID (UUID)<input value={functionId} onChange={(e) => setFunctionId(e.target.value)} /></label>}
        </div>
        <button type="submit" className="fx-btn primary" disabled={busy}>Tạo mục menu</button>
      </form>
      <form className="fx-section" onSubmit={(e) => void update(e)}>
        <h3>Sửa mục menu (tiêu đề, thứ tự, hiển thị)</h3>
        <div className="fx-form">
          <label>Mã mục menu (UUID)<input value={editId} onChange={(e) => setEditId(e.target.value)} list="fx-known-items" /></label>
          <label>Tiêu đề mới<input maxLength={150} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
          <label>Thứ tự mới<input inputMode="numeric" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} /></label>
          <label>Hiển thị
            <select value={editVisible} onChange={(e) => setEditVisible(e.target.value === 'true' ? 'true' : e.target.value === 'false' ? 'false' : '')}>
              <option value="">Giữ nguyên</option>
              <option value="true">Có</option>
              <option value="false">Không</option>
            </select>
          </label>
        </div>
        <button type="submit" className="fx-btn primary" disabled={busy}>Lưu thay đổi</button>
      </form>
      <datalist id="fx-known-items">{items.map((x) => <option key={x.navigationId} value={x.navigationId}>{x.menuTitle}</option>)}</datalist>
      {items.length > 0 && (
        <div className="fx-section">
          <h3>Mục menu đã tạo / sửa trong phiên này</h3>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Tiêu đề</th><th>Mã</th><th>Thứ tự</th><th>Hiển thị</th><th>Function</th></tr></thead>
              <tbody>{items.map((x) => (
                <tr key={x.navigationId}><td>{x.menuTitle}</td><td>{x.navigationId}</td><td>{x.sortOrder}</td><td>{x.isVisible ? 'Có' : 'Không'}</td><td>{x.functionId ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
