import { useCallback, useEffect, useState } from 'react';
import { groupOf, pathOfTab, screenById, screenOfPath, SCREENS, tabOfPath } from '../routes/shellScreens';
import type { GroupId, ScreenId, ShellPath } from '../routes/shellScreens';
import { authApi } from '../services/auth/authApi';
import type { AccountSummary } from '../services/auth/authApi';
import type { UiMessage } from '../services/auth/errorMessages';
import { t } from '../services/auth/messages';
import { MobileAccountPanel, MobileBottomNav } from './ShellMobileNav';
import { ShellSidebar } from './ShellSidebar';
import { ShellTopbar } from './ShellTopbar';
import { ShellWorkspace } from './ShellWorkspace';
import '../styles/app-shell.css';

// TASK F1 — AppShell after login (React port of frontend/TALO-MOS-V4-Appshell.html). The account shown is the one of
// GET /api/auth/session; logout is POST /api/auth/logout. No role, permission, company or branch data exists in the
// session contract, so none is shown or inferred.

const MOBILE_QUERY = '(max-width:760px)';

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function withParentExpanded(expanded: ReadonlySet<GroupId>, id: ScreenId): ReadonlySet<GroupId> {
  const parent = groupOf(id);
  if (!parent || expanded.has(parent.id)) return expanded;
  return new Set(expanded).add(parent.id);
}

export interface AppShellProps {
  readonly account: AccountSummary;
  readonly path: ShellPath;
  readonly onNavigate: (path: ShellPath) => void;
  readonly onLoggedOut: (flash: UiMessage) => void;
}

export function AppShell({ account, path, onNavigate, onLoggedOut }: AppShellProps) {
  const screen = screenOfPath(path) ?? SCREENS.home;
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<GroupId>>(() => withParentExpanded(new Set<GroupId>(['foundation']), screen.id));
  const [pinnedFlyout, setPinnedFlyout] = useState<GroupId | null>(null);
  const [tab, setTab] = useState<{ screen: ScreenId; index: number }>({ screen: screen.id, index: tabOfPath(path) });
  const [loggingOut, setLoggingOut] = useState(false);
  const activeTab = tab.screen === screen.id ? tab.index : 0;

  // Back/forward or a reload on a sub-screen: open its group as a menu click would.
  useEffect(() => {
    setExpanded((current) => withParentExpanded(current, screen.id));
  }, [screen.id]);

  // MOD-TEST-01/02: a module tab route (declared by its package) opens that tab, also on back/forward.
  useEffect(() => {
    setTab({ screen: screen.id, index: tabOfPath(path) });
  }, [path, screen.id]);

  // A route of the Foundation menu (module screen) opened from the home screen.
  const openPath = useCallback((target: ShellPath) => {
    setMobileOpen(false);
    setAccountPanelOpen(false);
    onNavigate(target);
  }, [onNavigate]);

  // Tabs of a module screen with sub-routes keep the path in step; other screens keep their path.
  function selectTab(index: number) {
    setTab({ screen: screen.id, index });
    const target = pathOfTab(screen.id, index);
    if (target !== path) onNavigate(target);
  }

  const navigate = useCallback((id: ScreenId) => {
    setMobileOpen(false);
    setAccountPanelOpen(false);
    setAccountMenuOpen(false);
    setPinnedFlyout(null);
    setTab({ screen: id, index: 0 });
    setExpanded((current) => withParentExpanded(current, id));
    onNavigate(screenById(id).path);
  }, [onNavigate]);

  function toggleGroup(id: GroupId) {
    const flip = (current: ReadonlySet<GroupId>) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    };
    if (isMobile()) {
      setExpanded(flip);
    } else if (compact) {
      setPinnedFlyout((current) => (current === id ? null : id));
    } else {
      setExpanded(flip);
      setPinnedFlyout(null);
    }
  }

  function toggleCompact() {
    setPinnedFlyout(null);
    setCompact((current) => !current);
  }

  function toggleMobileMenu() {
    setAccountPanelOpen(false);
    setMobileOpen((current) => !current);
  }

  function toggleAccountPanel() {
    setMobileOpen(false);
    setAccountPanelOpen((current) => !current);
  }

  function closeOverlays() {
    setMobileOpen(false);
    setAccountPanelOpen(false);
  }

  // An API answer 401 inside a screen: the session is gone — back to the login screen (App re-reads the session).
  const onSessionLost = useCallback(() => {
    onLoggedOut({ text: t('SESSION.INVALID'), tone: 'warning' });
  }, [onLoggedOut]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const result = await authApi.logout();
    onLoggedOut(result.ok ? { text: t('LOGOUT.DONE'), tone: 'info' } : { text: t('LOGOUT.FAILED'), tone: 'error' });
  }

  // A pinned flyout closes on a click outside the menu entries and the collapse button; the account menu on a click
  // outside itself.
  useEffect(() => {
    if (!pinnedFlyout && !accountMenuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.menu-entry, .foot')) setPinnedFlyout(null);
      if (!target?.closest('.user-menu')) setAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pinnedFlyout, accountMenuOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      setAccountPanelOpen(false);
      setAccountMenuOpen(false);
      setPinnedFlyout(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const shellClass = ['app-shell', compact && 'sidebar-compact', mobileOpen && 'mobile-open', accountPanelOpen && 'mobile-account-open']
    .filter(Boolean).join(' ');

  return (
    <div className={shellClass}>
      <ShellTopbar
        account={account}
        menuOpen={accountMenuOpen}
        loggingOut={loggingOut}
        onToggleMenu={() => setAccountMenuOpen((current) => !current)}
        onSearch={(id) => { if (id !== screen.id) navigate(id); }}
        onLogout={() => void logout()}
      />
      <div className="mobile-overlay" onClick={closeOverlays} />
      <MobileAccountPanel account={account} open={accountPanelOpen} loggingOut={loggingOut} onLogout={() => void logout()} />
      <MobileBottomNav
        screenId={screen.id}
        menuOpen={mobileOpen}
        accountOpen={accountPanelOpen}
        onMenu={toggleMobileMenu}
        onHome={() => navigate('home')}
        onAccount={toggleAccountPanel}
      />
      <div className={compact ? 'layout compact' : 'layout'}>
        <ShellSidebar
          selected={screen.id}
          compact={compact}
          expanded={expanded}
          pinnedFlyout={pinnedFlyout}
          onSelect={navigate}
          onToggleGroup={toggleGroup}
          onToggleCompact={toggleCompact}
        />
        <ShellWorkspace
          screen={screen}
          activeTab={activeTab}
          onTab={selectTab}
          onSessionLost={onSessionLost}
          onOpenPath={openPath}
        />
      </div>
    </div>
  );
}
