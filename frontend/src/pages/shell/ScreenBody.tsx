import type { ScreenId, ShellPath } from '../../routes/shellScreens';
import { FeedbackLine } from '../foundation/common';
import { ModuleScreen } from '../foundation/ModuleScreen';
import { MenuTree, NavigationScreen, useMenu } from '../foundation/NavigationScreen';
import { SystemTestScreen } from '../system-test/SystemTestScreen';

// Block 4 of the AppShell screens. FE-01: Foundation screens call the Foundation API; the home screen shows the business
// menu of the account (GET /api/foundation/navigation). IAM administration has no backend API yet: those screens say so
// and offer no action (no sample data, no form that looks functional).

function NotAvailable({ what }: { what: string }) {
  return (
    <>
      <p className="info">Chức năng {what} chưa được triển khai vì Backend chưa có API quản trị IAM tương ứng.</p>
      <div className="note">Tài khoản quản trị ban đầu được cấp bằng công cụ khởi tạo phía máy chủ; vai trò và quyền được gán theo mô hình IAM chuẩn.</div>
    </>
  );
}

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
        <div className="card"><b>IAM</b><p>Quản trị tài khoản, vai trò: chưa có API, chưa triển khai.</p></div>
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
      return <NotAvailable what="quản lý tài khoản" />;
    case 'roles':
      return <NotAvailable what="quản lý vai trò và quyền" />;
    case 'systemTest':
      return <SystemTestScreen tab={tab} onSessionLost={onSessionLost} />;
  }
}
