import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountIdOfPath, adminTabs, candidateIdOfPath, canOpenAdmin, groupOf, MODULE_SCREENS, pathOfTab, screenById, screenOfPath, SCREENS, tabOfPath, visibleGroups } from '../routes/shellScreens';
import { backOrOpen, currentNavState, mayLeave, usePopState } from '../routes/navigation';
import type { NavState, OpenPath } from '../routes/navigation';
import { ShellPageContext } from '../contexts/ShellPage';
import type { ScreenId, SearchTarget, ShellPath } from '../routes/shellScreens';
import { activeLinkId, linkAncestors, menuPaths, shellTree, ShellDataContext, treeFunctions, useShellDataSource } from '../contexts/ShellData';
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

// Menus to open so that the active link is visible (every menu above it in the sidebar tree).
function parentKeys(tree: readonly NavTreeNode[], activeId: string | null): string[] {
  return activeId === null ? [] : linkAncestors(tree, activeId).filter((n) => n.kind === 'menu').map((n) => n.id);
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  // Multi-link: the sidebar link that opened this history entry (kept by the entry: back / forward / reload).
  const [navId, setNavId] = useState<string | null>(() => currentNavState()?.navId ?? null);
  usePopState(useCallback(() => setNavId(currentNavState()?.navId ?? null), []));
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
  const groups = useMemo(() => (capabilities === null ? [] : visibleGroups(can)), [capabilities, can]);
  // System screens (Foundation / IAM, by capability): protected virtual menus inside DEVELOP — never B09 rows.
  const system = useMemo<NavTreeNode[]>(() => groups.map((g) => ({
    kind: 'menu', id: g.id, title: g.name, icon: g.icon, children: g.children.map((id) => ({ kind: 'function', id, title: SCREENS[id].name, path: SCREENS[id].path })),
  })), [groups]);
  const tree = useMemo(() => (menu === null ? null : shellTree(menu, DEFAULT_MENU_ICON, system)), [menu, system]);
  const routes = useMemo(() => menuPaths(menu ?? []), [menu]);
  const moduleScreen = MODULE_SCREENS.find((m) => m.id === screen.id);

  // Screen access shown by the shell (layer 2). Admin screens: capabilities; module screens: the path must be one of the
  // account's menu routes (the module API checks Session + IAM + ACTIVE + ENABLED again).
  const access: ScreenAccess = screen.id === 'home' ? 'allowed'
    : moduleScreen ? (menu === null ? 'checking' : routes.has(path) ? 'allowed' : 'denied')
      : capabilities === null ? 'checking' : canOpenAdmin(screen.id, can) ? 'allowed' : 'denied';
  // IAM-B-UI-01: the account workspace (/iam/accounts/:id) is a page of the accounts screen without the screen tabs;
  // the sidebar keeps "Quản lý tài khoản" active.
  const candidate = candidateIdOfPath(path) !== null;
  const workspace = accountIdOfPath(path) !== null || candidate;
  const menuPath = workspace ? screen.path : path;
  const tabs = workspace ? [] : moduleScreen ? moduleScreen.tabPaths.flatMap((p, i) => (routes.has(p) ? [i] : [])) : adminTabs(screen.id, can);
  const wanted = tab.screen === screen.id ? tab.index : 0;
  const activeTab = tabs.includes(wanted) ? wanted : tabs[0] ?? 0;
  const pageTitle = candidate ? 'Candidate Workspace' : workspace ? 'Quản trị tài khoản' : undefined;
  // The active link (chosen one, else the first one of the path) drives the open menus, the active item and the crumb.
  const activeId = screen.id === 'home' ? null : activeLinkId(tree ?? [], menuPath, navId);
  const trail = activeId === null ? [] : linkAncestors(tree ?? [], activeId).map((n) => n.title);
  const crumb = trail.length > 0 ? [...trail, ...(pageTitle ? [pageTitle] : [])]
    : groupOf(screen.id) ? [groupOf(screen.id)?.name ?? '', screen.name, ...(pageTitle ? [pageTitle] : [])] : [screen.name];

  // Search only offers what the session may open (home + every link of the sidebar tree, one entry per path).
  const targets = useMemo<SearchTarget[]>(() => {
    const seen = new Set<string>([SCREENS.home.path]);
    return [SCREENS.home, ...treeFunctions(tree ?? []).flatMap((f) => {
      if (!f.path || seen.has(f.path)) return [];
      seen.add(f.path);
      return [{ name: f.title, path: f.path }];
    })];
  }, [tree]);

  // Back/forward, a reload on a sub-screen or the menu arriving: open the parent menus as a menu click would.
  useEffect(() => {
    setExpanded((current) => withParents(current, parentKeys(tree ?? [], activeId)));
  }, [tree, activeId]);

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
    setNavId(currentNavState()?.navId ?? null); // unchanged when the navigation was refused (unsaved Builder draft)
  }, [onNavigate]);
  // A sidebar link: the entry remembers which link opened it.
  const openLink = useCallback((target: ShellPath, id: string) => openPath(target, { navId: id }), [openPath]);

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
    if (index !== activeTab && !mayLeave()) return; // unsaved Navigation Builder draft
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
              activeId={activeId}
              compact={compact}
              expanded={expanded}
              pinnedFlyout={pinnedFlyout}
              tree={tree}
              onHome={() => navigate('home')}
              onOpenLink={openLink}
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
