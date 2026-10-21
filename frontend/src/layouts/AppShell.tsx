import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountIdOfPath, adminTabs, canOpenAdmin, groupOf, MODULE_SCREENS, pathOfTab, screenById, screenOfPath, SCREENS, tabOfPath, visibleGroups } from '../routes/shellScreens';
import { backOrOpen } from '../routes/navigation';
import type { NavState, OpenPath } from '../routes/navigation';
import { ShellPageContext } from '../contexts/ShellPage';
import type { ScreenId, SearchTarget, ShellPath } from '../routes/shellScreens';
import { businessTree, menuAncestors, menuPaths, menuTrail, ShellDataContext, treeFunctions, useShellDataSource } from '../contexts/ShellData';
import type { NavTreeNode } from '../contexts/ShellData';
import { DEFAULT_MENU_ICON } from '../components/icons/NavIcon';
import { authApi } from '../services/auth/authApi';
import type { AccountSummary } from '../services/auth/authApi';
import type { UiMessage } from '../services/auth/errorMessages';
import { t } from '../services/auth/messages';
import { MobileAccountPanel, MobileBottomNav } from './ShellMobileNav';
import { ShellSidebar } from './ShellSidebar';
import { ShellTopbar } from './ShellTopbar';
import { ShellWorkspace } from './ShellWorkspace';
import type { CrumbNav } from './ShellWorkspace';
import '../styles/app-shell.css';

// TASK F1 — AppShell after login (React port of frontend/TALO-MOS-V4-Appshell.html). The account shown is the one of
// GET /api/auth/session; logout is POST /api/auth/logout. No company or branch data exists in the session contract, so none
// is shown. Menus and admin screens follow the backend menu and the session's capabilities (WS01 / WS06).

const MOBILE_QUERY = '(max-width:760px)';

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

// Menus to open so that the screen / path is visible: its admin menu, or every B09 menu above the Function of the path.
function parentKeys(id: ScreenId, path: string, business: readonly NavTreeNode[]): string[] {
  const admin = groupOf(id);
  return admin ? [admin.id] : menuAncestors(business, path);
}

function withParents(expanded: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  if (keys.every((k) => expanded.has(k))) return expanded;
  return new Set([...expanded, ...keys]);
}

export type ScreenAccess = 'checking' | 'allowed' | 'denied';

export interface AppShellProps {
  readonly account: AccountSummary;
  readonly path: ShellPath;
  readonly onNavigate: OpenPath;
  readonly onLoggedOut: (flash: UiMessage, reason: 'logout' | 'session-lost') => void;
}

export function AppShell({ account, path, onNavigate, onLoggedOut }: AppShellProps) {
  const screen = screenOfPath(path) ?? SCREENS.home;
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => withParents(new Set<string>(), parentKeys(screen.id, path, [])));
  const [pinnedFlyout, setPinnedFlyout] = useState<string | null>(null);
  const [tab, setTab] = useState<{ screen: ScreenId; index: number }>({ screen: screen.id, index: tabOfPath(path) });
  const [loggingOut, setLoggingOut] = useState(false);
  const [pageLabel, setPageLabel] = useState<string | null>(null);

  // An API answer 401 inside a screen: the session is gone — back to the login screen (App re-reads the session).
  const onSessionLost = useCallback(() => {
    onLoggedOut({ text: t('SESSION.INVALID'), tone: 'warning' }, 'session-lost');
  }, [onLoggedOut]);

  // WS01 / WS06: one business menu + the session's admin capabilities for the sidebar, home, search, crumb and guard.
  const shellData = useShellDataSource(onSessionLost);
  const { menu, capabilities, can } = shellData;
  const business = useMemo(() => (menu === null ? null : businessTree(menu, DEFAULT_MENU_ICON)), [menu]);
  const groups = useMemo(() => (capabilities === null ? [] : visibleGroups(can)), [capabilities, can]);
  // Admin menus as sidebar menus (icon key of the library) with their screens as Functions.
  const admin = useMemo<NavTreeNode[]>(() => groups.map((g) => ({
    kind: 'menu', id: g.id, title: g.name, icon: g.icon, children: g.children.map((id) => ({ kind: 'function', id, title: SCREENS[id].name, path: SCREENS[id].path })),
  })), [groups]);
  const routes = useMemo(() => menuPaths(menu ?? []), [menu]);
  const moduleScreen = MODULE_SCREENS.find((m) => m.id === screen.id);

  // Screen access shown by the shell (layer 2). Admin screens: capabilities; module screens: the path must be one of the
  // account's menu routes (the module API checks Session + IAM + ACTIVE + ENABLED again).
  const access: ScreenAccess = screen.id === 'home' ? 'allowed'
    : moduleScreen ? (menu === null ? 'checking' : routes.has(path) ? 'allowed' : 'denied')
      : capabilities === null ? 'checking' : canOpenAdmin(screen.id, can) ? 'allowed' : 'denied';
  // IAM-B-UI-01: the account workspace (/iam/accounts/:id) is a page of the accounts screen without the screen tabs;
  // the sidebar keeps "Quản lý tài khoản" active.
  const workspace = accountIdOfPath(path) !== null;
  const menuPath = workspace ? screen.path : path;
  const tabs = workspace ? [] : moduleScreen ? moduleScreen.tabPaths.flatMap((p, i) => (routes.has(p) ? [i] : [])) : adminTabs(screen.id, can);
  const wanted = tab.screen === screen.id ? tab.index : 0;
  const activeTab = tabs.includes(wanted) ? wanted : tabs[0] ?? 0;
  const pageTitle = workspace ? 'Quản trị tài khoản' : undefined;
  const crumb = groupOf(screen.id) ? [groupOf(screen.id)?.name ?? '', screen.name, ...(pageTitle ? [pageTitle] : [])]
    : moduleScreen ? (menuTrail(menu ?? [], path).length > 0 ? menuTrail(menu ?? [], path) : [screen.name]) : [screen.name];

  // Search only offers what the session may open (allowed admin screens + business menu entries).
  const targets = useMemo<SearchTarget[]>(() => [
    SCREENS.home,
    ...groups.flatMap((g) => g.children.map((id) => SCREENS[id])),
    ...treeFunctions(business ?? []).flatMap((f) => (f.path ? [{ name: f.title, path: f.path }] : [])),
  ], [groups, business]);

  // Back/forward, a reload on a sub-screen or the menu arriving: open the parent group as a menu click would.
  useEffect(() => {
    setExpanded((current) => withParents(current, parentKeys(screen.id, path, business ?? [])));
  }, [screen.id, path, business]);

  // MOD-TEST-01/02: a module tab route (declared by its package) opens that tab, also on back/forward.
  useEffect(() => {
    setTab({ screen: screen.id, index: tabOfPath(path) });
  }, [path, screen.id]);

  // A route of the business menu (module screen) or an admin screen path.
  const openPath = useCallback((target: ShellPath, state?: NavState) => {
    setMobileOpen(false);
    setAccountPanelOpen(false);
    setAccountMenuOpen(false);
    setPinnedFlyout(null);
    onNavigate(target, state);
  }, [onNavigate]);

  // IAM-B-UI-01 FIX-03: breadcrumb of the account workspace "← IAM / Quản lý tài khoản / <username>". The back icon and
  // "Quản lý tài khoản" do what "← Quay lại danh sách" does (browser Back to the list it came from, with its query, or
  // the list as a new entry) — the accounts screen keeps its own access guard.
  const crumbNav: CrumbNav | undefined = workspace && access === 'allowed' ? {
    onBack: () => backOrOpen(SCREENS.accounts.path, openPath),
    items: [
      { label: groupOf(screen.id)?.name.split(' · ')[0] ?? '' },
      { label: screen.name, onOpen: () => backOrOpen(SCREENS.accounts.path, openPath) },
      { label: pageLabel ?? pageTitle ?? '', current: true },
    ],
  } : undefined;

  // Tabs of a module screen with sub-routes keep the path in step; other screens keep their path.
  function selectTab(index: number) {
    setTab({ screen: screen.id, index });
    const target = pathOfTab(screen.id, index);
    if (target !== path) onNavigate(target);
  }

  const navigate = useCallback((id: ScreenId) => {
    setTab({ screen: id, index: 0 });
    openPath(screenById(id).path);
  }, [openPath]);

  function toggleGroup(id: string) {
    const flip = (current: ReadonlySet<string>) => {
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

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const result = await authApi.logout();
    onLoggedOut(result.ok ? { text: t('LOGOUT.DONE'), tone: 'info' } : { text: t('LOGOUT.FAILED'), tone: 'error' }, 'logout');
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
    <ShellDataContext.Provider value={shellData}>
      <ShellPageContext.Provider value={setPageLabel}>
        <div className={shellClass}>
          <ShellTopbar
            account={account}
            menuOpen={accountMenuOpen}
            loggingOut={loggingOut}
            targets={targets}
            onToggleMenu={() => setAccountMenuOpen((current) => !current)}
            onSearch={(target) => { if (target !== path) openPath(target); }}
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
              homeActive={screen.id === 'home'}
              path={menuPath}
              compact={compact}
              expanded={expanded}
              pinnedFlyout={pinnedFlyout}
              business={business}
              admin={admin}
              onHome={() => navigate('home')}
              onOpenPath={openPath}
              onToggleGroup={toggleGroup}
              onToggleCompact={toggleCompact}
            />
            <ShellWorkspace
              screen={screen}
              crumb={crumb}
              crumbNav={crumbNav}
              access={access}
              path={path}
              title={pageTitle}
              tabs={tabs}
              activeTab={activeTab}
              onTab={selectTab}
              onSessionLost={onSessionLost}
              onOpenPath={openPath}
            />
          </div>
        </div>
      </ShellPageContext.Provider>
    </ShellDataContext.Provider>
  );
}
