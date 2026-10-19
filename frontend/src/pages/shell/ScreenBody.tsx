import { AccountsScreen, RolesScreen } from '../iam/IamManagementScreens';
import { MODULE_SCREENS, SCREENS, visibleGroups } from '../../routes/shellScreens';
import type { ScreenId, ShellPath } from '../../routes/shellScreens';
import { useShellData } from '../../contexts/ShellData';
import { FeedbackLine } from '../foundation/common';
import { ModuleScreen } from '../foundation/ModuleScreen';
import { MenuTree, NavigationScreen } from '../foundation/NavigationScreen';

// Block 4 of the AppShell screens. Home (WS01 / WS06): the business menu of the account — the SAME list as the sidebar
// (GET /api/foundation/navigation, filtered by the backend) — and cards of the admin screens the session may open
// (capabilities; a screen without permission is not listed).

function Home({ onOpenPath }: { onOpenPath: (path: ShellPath) => void }) {
  const { menu, menuFeedback, capabilities, capabilitiesFailed, can } = useShellData();
  const cards = capabilities === null ? [] : visibleGroups(can).flatMap((g) => g.children.map((id) => ({ group: g.name, screen: SCREENS[id] })));
  return (
    <>
      <FeedbackLine feedback={menuFeedback} />
      {menu === null ? <p className="info">Đang tải…</p> : menu.length === 0
        ? <p className="info">Chưa có chức năng nghiệp vụ nào được cấp quyền cho tài khoản này.</p>
        : <MenuTree nodes={menu} onOpen={onOpenPath} />}
      {cards.length > 0 && (
        <>
          <h3 className="home-section">Quản trị nền tảng</h3>
          <div className="cards">
            {cards.map(({ group, screen }) => (
              <button type="button" className="card" key={screen.id} onClick={() => onOpenPath(screen.path)}>
                <b>{screen.name}</b>
                <p>{group} · {screen.desc}</p>
              </button>
            ))}
          </div>
        </>
      )}
      {capabilitiesFailed && <p className="muted">Không đọc được quyền quản trị của phiên; các màn hình quản trị được ẩn.</p>}
    </>
  );
}

export function ScreenBody({ screen, tab, onSessionLost, onOpenPath }: { screen: ScreenId; tab: number; onSessionLost: () => void; onOpenPath: (path: ShellPath) => void }) {
  switch (screen) {
    case 'home':
      return <Home onOpenPath={onOpenPath} />;
    case 'module':
      return <ModuleScreen tab={tab} onSessionLost={onSessionLost} />;
    case 'navigation':
      return <NavigationScreen tab={tab} onSessionLost={onSessionLost} />;
    case 'accounts':
      return <AccountsScreen onSessionLost={onSessionLost} />;
    case 'roles':
      return <RolesScreen tab={tab} onSessionLost={onSessionLost} />;
    default: {
      // MOD-TEST-02: an installed module screen (component exported by the package entry).
      const Module = MODULE_SCREENS.find((m) => m.id === screen)?.component;
      return Module ? <Module tab={tab} onSessionLost={onSessionLost} /> : null;
    }
  }
}
