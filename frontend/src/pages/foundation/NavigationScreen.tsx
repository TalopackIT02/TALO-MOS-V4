import type { MenuNode } from '../../services/foundation/foundationApi';
import { shellPathOf } from '../../routes/shellScreens';
import type { ShellPath } from '../../routes/shellScreens';
import { useShellData } from '../../contexts/ShellData';
import { FeedbackLine } from './common';
import type { ScreenProps } from './common';
import { NavigationBuilder } from './NavigationBuilder';

// FE-06 / WS02 — Navigation, the ONLY manager of the menu (B09). Tab 0: the menu of the signed-in account (the same list
// as the sidebar and the home screen). Tab 1: the Navigation Builder (owner decisions of 22/10/2026) — areas, menus and
// Function links edited as a draft and saved at once through PUT /api/foundation/navigation/builder
// (permission foundation.navigation.manage). No DELETE: "Gỡ" hides a row. Menus keep the default icon (Q13).

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
  if (tab === 1) return <NavigationBuilder onSessionLost={onSessionLost} />;
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

