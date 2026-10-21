import { ScreenBody } from '../pages/shell/ScreenBody';
import type { OpenPath } from '../routes/navigation';
import type { ShellPath, ShellScreen } from '../routes/shellScreens';
import type { ScreenAccess } from './AppShell';

// Workspace in the four logical blocks: 1 breadcrumb, 2 title + description, 3 screen actions (tabs directly under the
// description, no label and no card of their own), 4 content of the selected action.
// WS06 layer 2: a screen the session may not open (direct URL) shows a notice only — its content (and its API calls) is
// not rendered; the tabs shown are those the session may open. The API checks every request again (layer 3).
// A page of a screen without tabs (IAM-B-UI-01 account workspace) gives its own `title` for block 4.

export interface ShellWorkspaceProps {
  readonly screen: ShellScreen;
  readonly path: ShellPath;
  readonly title?: string;
  readonly crumb: readonly string[];
  readonly access: ScreenAccess;
  readonly tabs: readonly number[];
  readonly activeTab: number;
  readonly onTab: (index: number) => void;
  readonly onSessionLost: () => void;
  readonly onOpenPath: OpenPath;
}

export function ShellWorkspace({ screen, path, title, crumb, access, tabs, activeTab, onTab, onSessionLost, onOpenPath }: ShellWorkspaceProps) {
  const open = access === 'allowed';
  return (
    <main className="workspace">
      <div className="crumb" id="crumb">{open ? crumb.join(' › ') : screen.name}</div>
      <div className="page-heading">
        <h1 id="title">{screen.name.toLocaleUpperCase('vi')}</h1>
        <p id="desc">{open ? screen.desc : ''}</p>
        {open && tabs.length > 0 && (
          <div className="tabs" id="tabs" aria-label="Chức năng">
            {tabs.map((index) => (
              <button type="button" key={screen.tabs[index] ?? index} className={index === activeTab ? 'tab active' : 'tab'} aria-pressed={index === activeTab} onClick={() => onTab(index)}>
                {screen.tabs[index]}
              </button>
            ))}
          </div>
        )}
      </div>
      <section className="panel">
        <div className="panel-heading"><h2 id="bodyTitle">{open ? title ?? screen.tabs[activeTab] : 'Truy cập màn hình'}</h2></div>
        <div className="panel-body" id="body">
          {access === 'checking' && <p className="info">Đang kiểm tra quyền truy cập…</p>}
          {access === 'denied' && (
            <div className="guard" role="alert">
              <b>Bạn không có quyền truy cập màn hình này.</b>
              <p>Tài khoản chưa được cấp quyền IAM cần thiết, hoặc chức năng không còn trong menu của bạn. Liên hệ quản trị hệ thống nếu cần quyền.</p>
            </div>
          )}
          {open && <ScreenBody screen={screen.id} path={path} tab={activeTab} onSessionLost={onSessionLost} onOpenPath={onOpenPath} />}
        </div>
      </section>
      <div className="footer">Dữ liệu lấy trực tiếp từ máy chủ · Menu và màn hình hiển thị theo quyền IAM hiệu lực · Máy chủ kiểm tra lại quyền ở mọi thao tác.</div>
    </main>
  );
}
