import { ScreenBody } from '../pages/shell/ScreenBody';
import { groupOf } from '../routes/shellScreens';
import type { ShellScreen } from '../routes/shellScreens';

// Workspace in the four logical blocks: 1 breadcrumb, 2 title + description, 3 screen actions (tabs directly under the
// description, no label and no card of their own), 4 content of the selected action.

export interface ShellWorkspaceProps {
  readonly screen: ShellScreen;
  readonly activeTab: number;
  readonly onTab: (index: number) => void;
}

export function ShellWorkspace({ screen, activeTab, onTab }: ShellWorkspaceProps) {
  const parent = groupOf(screen.id);
  return (
    <main className="workspace">
      <div className="crumb" id="crumb">{parent ? `${parent.name} › ${screen.name}` : screen.name}</div>
      <div className="page-heading">
        <h1 id="title">{screen.name.toLocaleUpperCase('vi')}</h1>
        <p id="desc">{screen.desc}</p>
        <div className="tabs" id="tabs" aria-label="Chức năng">
          {screen.tabs.map((label, index) => (
            <button type="button" key={label} className={index === activeTab ? 'tab active' : 'tab'} aria-pressed={index === activeTab} onClick={() => onTab(index)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading"><h2 id="bodyTitle">{screen.tabs[activeTab]}</h2></div>
        <div className="panel-body" id="body"><ScreenBody screen={screen.id} tab={activeTab} /></div>
      </section>
      <div className="footer">Các màn hình Foundation và IAM chưa kết nối API quản trị · Các thao tác thay đổi dữ liệu chưa được kích hoạt.</div>
    </main>
  );
}
