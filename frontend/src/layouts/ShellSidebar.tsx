import { SCREENS } from '../routes/shellScreens';
import type { NavGroup as NavGroupData, ScreenId, ShellPath } from '../routes/shellScreens';
import type { BusinessEntry } from '../contexts/ShellData';

// Sidebar (WS01): Trang chủ, then the BUSINESS menu of the account (GET /api/foundation/navigation — B09 filtered by the
// backend; nothing hard-coded here), then the ADMIN groups the session may open (capabilities, WS06). Expanded sidebar: a
// group click opens / closes its sub-menu. Compact sidebar: a group click pins its flyout (click again, Escape, a click
// outside or choosing an item closes it; one flyout at a time). On mobile the same sidebar is the drawer.

export interface ShellSidebarProps {
  readonly selected: ScreenId;
  readonly path: string;
  readonly compact: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly pinnedFlyout: string | null;
  readonly business: readonly BusinessEntry[] | null;
  readonly groups: readonly NavGroupData[];
  readonly onSelect: (id: ScreenId) => void;
  readonly onOpenPath: (path: ShellPath) => void;
  readonly onToggleGroup: (id: string) => void;
  readonly onToggleCompact: () => void;
}

interface Item {
  readonly key: string;
  readonly label: string;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

export function ShellSidebar(props: ShellSidebarProps) {
  const { selected, path, compact, expanded, pinnedFlyout, business, groups, onSelect, onOpenPath, onToggleGroup, onToggleCompact } = props;
  const homeActive = selected === 'home';
  return (
    <aside className="sidebar">
      <nav className="nav" id="nav" aria-label="Điều hướng">
        <div className="menu-entry">
          <button type="button" className={homeActive ? 'nav-btn active' : 'nav-btn'} title={SCREENS.home.name} aria-label={SCREENS.home.name} aria-current={homeActive ? 'page' : undefined} onClick={() => onSelect('home')}>
            <span className="icon">⌂</span>
            <span className="nav-label">{SCREENS.home.name}</span>
          </button>
        </div>
        {business === null && <p className="nav-note">Đang tải menu…</p>}
        {(business ?? []).map((entry) => {
          if (entry.kind === 'link') {
            const { link } = entry;
            const active = link.path !== null && link.path === path;
            return (
              <div className="menu-entry" key={link.id}>
                <button type="button" className={active ? 'nav-btn active' : 'nav-btn'} title={link.path ? link.title : `${link.title} (màn hình chưa được cài đặt)`}
                  aria-label={link.title} disabled={link.path === null} aria-current={active ? 'page' : undefined} onClick={() => { if (link.path) onOpenPath(link.path); }}>
                  <span className="icon">▣</span>
                  <span className="nav-label">{link.title}</span>
                </button>
              </div>
            );
          }
          return (
            <Group key={entry.id} id={entry.id} name={entry.title} icon="▤" expanded={expanded.has(entry.id)} flyoutOpen={pinnedFlyout === entry.id} onToggle={onToggleGroup}
              items={entry.links.map((l) => ({
                key: l.id, label: l.title, active: l.path !== null && l.path === path, disabled: l.path === null,
                onClick: () => { if (l.path) onOpenPath(l.path); },
              }))} />
          );
        })}
        {groups.length > 0 && <p className="nav-section">Quản trị</p>}
        {groups.map((g) => (
          <Group key={g.id} id={g.id} name={g.name} icon={g.icon} expanded={expanded.has(g.id)} flyoutOpen={pinnedFlyout === g.id} onToggle={onToggleGroup}
            items={g.children.map((id) => ({ key: id, label: SCREENS[id].name, active: selected === id, onClick: () => onSelect(id) }))} />
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

interface GroupProps {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly items: readonly Item[];
  readonly expanded: boolean;
  readonly flyoutOpen: boolean;
  readonly onToggle: (id: string) => void;
}

function Group({ id, name, icon, items, expanded, flyoutOpen, onToggle }: GroupProps) {
  const entryClass = ['menu-entry', expanded && 'expanded', flyoutOpen && 'flyout-open'].filter(Boolean).join(' ');
  return (
    <div className={entryClass} data-group={id}>
      <button type="button" className={items.some((i) => i.active) ? 'nav-btn parent-active' : 'nav-btn'} aria-expanded={expanded} title={name} aria-label={name} onClick={() => onToggle(id)}>
        <span className="icon">{icon}</span>
        <span className="nav-label">{name}</span>
        <span className="chevron">›</span>
      </button>
      <div className="sub">
        {items.map((i) => (
          <button type="button" key={i.key} className={i.active ? 'active' : undefined} aria-current={i.active ? 'page' : undefined} disabled={i.disabled}
            title={i.disabled ? 'Màn hình chưa được cài đặt' : undefined} onClick={i.onClick}>
            {i.label}
          </button>
        ))}
      </div>
      <div className="flyout">
        <strong>{name}</strong>
        {items.map((i) => (
          <button type="button" key={i.key} className={i.active ? 'active' : undefined} disabled={i.disabled} onClick={i.onClick}>{i.label}</button>
        ))}
      </div>
    </div>
  );
}
