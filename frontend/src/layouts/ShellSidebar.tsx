import { SCREENS } from '../routes/shellScreens';
import type { ShellPath } from '../routes/shellScreens';
import type { NavTreeNode } from '../contexts/ShellData';
import { NavIcon } from '../components/icons/NavIcon';

// Sidebar (WS01 + owner rule "MENU vs FUNCTION"): Trang chủ, then the BUSINESS tree of the account (GET
// /api/foundation/navigation — B09 filtered by the backend; nothing hard-coded here), then the ADMIN menus the session may
// open (capabilities, WS06).
//   MENU     = icon (navigation SVG library) + bold title + chevron; contains menus / functions; any depth.
//   FUNCTION = NO icon (no placeholder either) + normal title, indented under its menu with a tree line; active state.
// Expanded sidebar: a menu click opens / closes it. Compact sidebar: top-level menus show their icon; a click pins a
// flyout with the same tree (functions still without icon). On mobile the same sidebar is the drawer.

export interface ShellSidebarProps {
  readonly path: string;
  readonly homeActive: boolean;
  readonly compact: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly pinnedFlyout: string | null;
  readonly business: readonly NavTreeNode[] | null;
  readonly admin: readonly NavTreeNode[];
  readonly onHome: () => void;
  readonly onOpenPath: (path: ShellPath) => void;
  readonly onToggleGroup: (id: string) => void;
  readonly onToggleCompact: () => void;
}

interface TreeProps {
  readonly path: string;
  readonly expanded: ReadonlySet<string>;
  readonly onOpenPath: (path: ShellPath) => void;
  readonly onToggle: (id: string) => void;
}

const containsActive = (n: NavTreeNode, path: string): boolean =>
  n.kind === 'function' ? n.path !== null && n.path === path : n.children.some((c) => containsActive(c, path));

// Two letters of a top-level Function, shown only in the compact sidebar (text, not an icon).
const abbreviation = (title: string) => title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('').toLocaleUpperCase('vi');

export function ShellSidebar(props: ShellSidebarProps) {
  const { path, homeActive, compact, expanded, pinnedFlyout, business, admin, onHome, onOpenPath, onToggleGroup, onToggleCompact } = props;
  const tree = { path, expanded, onOpenPath, onToggle: onToggleGroup };
  const top = (n: NavTreeNode) => (n.kind === 'menu'
    ? <TopMenu key={n.id} node={n} flyoutOpen={pinnedFlyout === n.id} {...tree} />
    : <TopFunction key={n.id} node={n} {...tree} />);
  return (
    <aside className="sidebar">
      <nav className="nav" id="nav" aria-label="Điều hướng">
        <div className="menu-entry">
          <button type="button" className={homeActive ? 'nav-btn nav-menu active' : 'nav-btn nav-menu'} title={SCREENS.home.name} aria-label={SCREENS.home.name}
            aria-current={homeActive ? 'page' : undefined} onClick={onHome}>
            <span className="icon"><NavIcon name="home" /></span>
            <span className="nav-label">{SCREENS.home.name}</span>
          </button>
        </div>
        {business === null && <p className="nav-note">Đang tải menu…</p>}
        {(business ?? []).map(top)}
        {admin.length > 0 && <p className="nav-section">Quản trị</p>}
        {admin.map(top)}
      </nav>
      <div className="foot">
        <button type="button" id="collapse-button" onClick={onToggleCompact}>
          <span>{compact ? '›' : '‹'}</span> <span className="foot-label">{compact ? 'Mở rộng' : 'Thu gọn'}</span>
        </button>
      </div>
    </aside>
  );
}

type MenuNodeT = Extract<NavTreeNode, { kind: 'menu' }>;
type FunctionNodeT = Extract<NavTreeNode, { kind: 'function' }>;

function TopMenu({ node, flyoutOpen, ...tree }: TreeProps & { node: MenuNodeT; flyoutOpen: boolean }) {
  const open = tree.expanded.has(node.id);
  const entryClass = ['menu-entry', open && 'expanded', flyoutOpen && 'flyout-open'].filter(Boolean).join(' ');
  return (
    <div className={entryClass} data-group={node.id}>
      <button type="button" className={containsActive(node, tree.path) ? 'nav-btn nav-menu parent-active' : 'nav-btn nav-menu'} aria-expanded={open}
        title={node.title} aria-label={node.title} onClick={() => tree.onToggle(node.id)}>
        <span className="icon"><NavIcon name={node.icon} /></span>
        <span className="nav-label">{node.title}</span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
      <div className="sub" role="group" aria-label={node.title}>
        {node.children.map((c) => <TreeItem key={c.id} node={c} {...tree} />)}
      </div>
      <div className="flyout" role="group" aria-label={node.title}>
        <strong>{node.title}</strong>
        <FlyoutTree nodes={node.children} {...tree} />
      </div>
    </div>
  );
}

function TopFunction({ node, ...tree }: TreeProps & { node: FunctionNodeT }) {
  const active = node.path !== null && node.path === tree.path;
  return (
    <div className="menu-entry">
      <button type="button" className={active ? 'nav-btn nav-fn-top active' : 'nav-btn nav-fn-top'} title={node.path ? node.title : `${node.title} (màn hình chưa được cài đặt)`}
        aria-label={node.title} disabled={node.path === null} aria-current={active ? 'page' : undefined} onClick={() => { if (node.path) tree.onOpenPath(node.path); }}>
        <span className="nav-abbr" aria-hidden="true">{abbreviation(node.title)}</span>
        <span className="nav-label">{node.title}</span>
      </button>
    </div>
  );
}

// Inside an expanded menu: nested menus keep icon + bold title + chevron; functions have no icon.
function TreeItem({ node, ...tree }: TreeProps & { node: NavTreeNode }) {
  if (node.kind === 'function') return <FunctionButton node={node} {...tree} />;
  const open = tree.expanded.has(node.id);
  return (
    <div className={open ? 'nav-nested expanded' : 'nav-nested'}>
      <button type="button" className={containsActive(node, tree.path) ? 'nav-menu-nested parent-active' : 'nav-menu-nested'} aria-expanded={open}
        aria-label={node.title} title={node.title} onClick={() => tree.onToggle(node.id)}>
        <NavIcon name={node.icon} size={17} />
        <span className="nav-label">{node.title}</span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
      <div className="sub" role="group" aria-label={node.title}>
        {node.children.map((c) => <TreeItem key={c.id} node={c} {...tree} />)}
      </div>
    </div>
  );
}

function FunctionButton({ node, path, onOpenPath }: TreeProps & { node: FunctionNodeT }) {
  const active = node.path !== null && node.path === path;
  return (
    <button type="button" className={active ? 'nav-fn active' : 'nav-fn'} aria-current={active ? 'page' : undefined} disabled={node.path === null}
      title={node.path ? node.title : 'Màn hình chưa được cài đặt'} onClick={() => { if (node.path) onOpenPath(node.path); }}>
      {node.title}
    </button>
  );
}

// Compact flyout: the whole sub-tree at once (nested menu titles with icon, functions without icon).
function FlyoutTree({ nodes, ...tree }: TreeProps & { nodes: readonly NavTreeNode[] }) {
  return (
    <>
      {nodes.map((n) => (n.kind === 'function' ? <FunctionButton key={n.id} node={n} {...tree} /> : (
        <div key={n.id} className="flyout-menu">
          <span className="flyout-menu-title"><NavIcon name={n.icon} size={16} /><b>{n.title}</b></span>
          <div className="flyout-children"><FlyoutTree nodes={n.children} {...tree} /></div>
        </div>
      )))}
    </>
  );
}
