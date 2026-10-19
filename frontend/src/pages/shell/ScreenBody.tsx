import { AccountsScreen, RolesScreen } from '../iam/IamManagementScreens';
import { MODULE_SCREENS } from '../../routes/shellScreens';
import type { ScreenId, ShellPath } from '../../routes/shellScreens';
import { FeedbackLine } from '../foundation/common';
import { ModuleScreen } from '../foundation/ModuleScreen';
import { MenuTree, NavigationScreen, useMenu } from '../foundation/NavigationScreen';

// Block 4 of the AppShell screens. FE-01: Foundation screens call the Foundation API; the home screen shows the business
// menu of the account (GET /api/foundation/navigation). IAM administration has no backend API yet: those screens say so
// and offer no action (no sample data, no form that looks functional).

function Home({ onSessionLost, onOpenPath }: { onSessionLost: () => void; onOpenPath: (path: ShellPath) => void }) {
  const { menu, feedback } = useMenu(onSessionLost);
  return (
    <>
      <FeedbackLine feedback={feedback} />
      {menu === null ? <p className="info">Đang tải…</p> : menu.length === 0
        ? <p className="info">Chưa có chức năng nghiệp vụ nào được cấp quyền cho tài khoản này. Các màn hình quản trị nền tảng nằm trong menu Foundation.</p>
        : <MenuTree nodes={menu} onOpen={onOpenPath} />}
      <div className="cards" style={{ marginTop: 18 }}>
        <div className="card"><b>Quản lý Module</b><p>Đăng ký module, phiên bản, hồ sơ MIC, phê duyệt và kích hoạt.</p></div>
        <div className="card"><b>Điều hướng</b><p>Cây menu ứng dụng, lọc theo quyền IAM hiệu lực của từng tài khoản.</p></div>
        <div className="card"><b>IAM</b><p>Quản trị tài khoản, vai trò và quyền IAM.</p></div>
      </div>
    </>
  );
}

export function ScreenBody({ screen, tab, onSessionLost, onOpenPath }: { screen: ScreenId; tab: number; onSessionLost: () => void; onOpenPath: (path: ShellPath) => void }) {
  switch (screen) {
    case 'home':
      return <Home onSessionLost={onSessionLost} onOpenPath={onOpenPath} />;
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
