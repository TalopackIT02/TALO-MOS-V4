import { NAV_GROUPS, SCREENS } from '../routes/shellScreens';
import type { AdminScreenId, GroupId, NavGroup as NavGroupData, ScreenId } from '../routes/shellScreens';

// Sidebar: Trang chủ + groups with sub-menus. Expanded sidebar: a group click opens/closes its sub-menu. Compact
// sidebar: a group click pins its flyout (click again, Escape, a click outside or choosing an item closes it; one
// flyout at a time). On mobile the same sidebar is the drawer.

export interface ShellSidebarProps {
  readonly selected: ScreenId;
  readonly compact: boolean;
  readonly expanded: ReadonlySet<GroupId>;
  readonly pinnedFlyout: GroupId | null;
  readonly onSelect: (id: ScreenId) => void;
  readonly onToggleGroup: (id: GroupId) => void;
  readonly onToggleCompact: () => void;
}

export function ShellSidebar({ selected, compact, expanded, pinnedFlyout, onSelect, onToggleGroup, onToggleCompact }: ShellSidebarProps) {
  return (
    <aside className="sidebar">
      <nav className="nav" id="nav" aria-label="Điều hướng">
        <div className="menu-entry">
          <NavItem id="home" icon="⌂" active={selected === 'home'} onSelect={onSelect} />
        </div>
        {NAV_GROUPS.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            selected={selected}
            expanded={expanded.has(group.id)}
            flyoutOpen={pinnedFlyout === group.id}
            onSelect={onSelect}
            onToggle={onToggleGroup}
          />
        ))}
      </nav>
      <div className="foot">
        <button type="button" id="collapse-button" onClick={onToggleCompact}>
          <span>{compact ? '›' : '‹'}</span> <span className="foot-label">{compact ? 'Mở rộng' : 'Thu gọn'}</span>
        </button>
      </div>
    </aside>
  );
}

interface NavItemProps {
  readonly id: AdminScreenId;
  readonly icon: string;
  readonly active: boolean;
  readonly onSelect: (id: ScreenId) => void;
}

function NavItem({ id, icon, active, onSelect }: NavItemProps) {
  const name = SCREENS[id].name;
  return (
    <button type="button" className={active ? 'nav-btn active' : 'nav-btn'} title={name} aria-current={active ? 'page' : undefined} onClick={() => onSelect(id)}>
      <span className="icon">{icon}</span>
      <span className="nav-label">{name}</span>
    </button>
  );
}

interface NavGroupProps {
  readonly group: NavGroupData;
  readonly selected: ScreenId;
  readonly expanded: boolean;
  readonly flyoutOpen: boolean;
  readonly onSelect: (id: ScreenId) => void;
  readonly onToggle: (id: GroupId) => void;
}

function NavGroup({ group, selected, expanded, flyoutOpen, onSelect, onToggle }: NavGroupProps) {
  const entryClass = ['menu-entry', expanded && 'expanded', flyoutOpen && 'flyout-open'].filter(Boolean).join(' ');
  return (
    <div className={entryClass} data-group={group.id}>
      <button
        type="button"
        className={group.children.some((child) => child === selected) ? 'nav-btn parent-active' : 'nav-btn'}
        aria-expanded={expanded}
        title={group.name}
        onClick={() => onToggle(group.id)}
      >
        <span className="icon">{group.icon}</span>
        <span className="nav-label">{group.name}</span>
        <span className="chevron">›</span>
      </button>
      <div className="sub">
        {group.children.map((id) => (
          <button type="button" key={id} className={selected === id ? 'active' : undefined} aria-current={selected === id ? 'page' : undefined} onClick={() => onSelect(id)}>
            {SCREENS[id].name}
          </button>
        ))}
      </div>
      <div className="flyout">
        <strong>{group.name}</strong>
        {group.children.map((id) => (
          <button type="button" key={id} onClick={() => onSelect(id)}>{SCREENS[id].name}</button>
        ))}
      </div>
    </div>
  );
}
