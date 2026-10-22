import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { foundationApi } from '../services/foundation/foundationApi';
import type { MenuNode } from '../services/foundation/foundationApi';
import { describeFailure } from '../services/foundation/foundationMessages';
import { iamApi } from '../services/iam/iamApi';
import type { Capabilities } from '../services/iam/iamApi';
import { shellPathOf } from '../routes/shellScreens';
import type { ShellPath } from '../routes/shellScreens';
import type { Feedback } from '../pages/foundation/common';

// WS01 / WS06 — data shared by the whole AppShell (sidebar, home, search, breadcrumb, screen guard):
//  - menu: the business menu of the account, GET /api/foundation/navigation (B09 filtered by the backend: enabled module,
//    ACTIVE version, effective IAM grant) — ONE source for the sidebar and the home screen;
//  - capabilities: the session's own admin permissions, GET /api/iam/admin/me/capabilities (evaluateAccess()).
// A failed capability read shows nothing administrative (fail closed); every API still checks again on the server.

export interface ShellData {
  readonly menu: MenuNode[] | null;
  readonly menuFeedback: Feedback | null;
  readonly reloadMenu: () => Promise<void>;
  readonly capabilities: Capabilities | null; // null = loading
  readonly capabilitiesFailed: boolean;
  readonly can: (code: string) => boolean;
}

const EMPTY: ShellData = { menu: [], menuFeedback: null, reloadMenu: async () => {}, capabilities: {}, capabilitiesFailed: false, can: () => false };
export const ShellDataContext = createContext<ShellData>(EMPTY);

export function useShellData(): ShellData {
  return useContext(ShellDataContext);
}

export function useShellDataSource(onSessionLost: () => void): ShellData {
  const [menu, setMenu] = useState<MenuNode[] | null>(null);
  const [menuFeedback, setMenuFeedback] = useState<Feedback | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilitiesFailed, setCapabilitiesFailed] = useState(false);

  const reloadMenu = useCallback(async () => {
    setMenuFeedback(null);
    const r = await foundationApi.menu();
    if (r.ok) return setMenu(r.data);
    if (r.status === 401) return onSessionLost();
    setMenuFeedback({ tone: 'error', text: describeFailure(r) });
    setMenu([]);
  }, [onSessionLost]);

  useEffect(() => {
    void reloadMenu();
    void iamApi.capabilities().then((r) => {
      if (r.ok) return setCapabilities(r.data);
      if (r.status === 401) return onSessionLost();
      setCapabilitiesFailed(true);
      setCapabilities({});
    });
  }, [reloadMenu, onSessionLost]);

  const can = useCallback((code: string) => capabilities?.[code] === true, [capabilities]);
  return useMemo(() => ({ menu, menuFeedback, reloadMenu, capabilities, capabilitiesFailed, can }), [menu, menuFeedback, reloadMenu, capabilities, capabilitiesFailed, can]);
}

// ------------------------------------------------------------------------------------------------- sidebar tree
// Sidebar model (owner rule): a MENU has an icon, a bold title and children; a FUNCTION has no icon, a normal title and
// opens a screen. Built from the B09 tree as returned by the backend (any depth, no limit added here).
export type NavTreeNode =
  | { readonly kind: 'menu'; readonly id: string; readonly title: string; readonly icon: string; readonly children: readonly NavTreeNode[] }
  | { readonly kind: 'function'; readonly id: string; readonly title: string; readonly path: ShellPath | null }; // null = no installed screen

const pathOf = (n: MenuNode): ShellPath | null => (n.routePath ? shellPathOf(n.routePath) ?? null : null);

// B09 → sidebar tree. A node with children is a MENU (its own route, if any, becomes its first Function); a leaf with a
// route is a FUNCTION; a menu with nothing to open below it is not shown. B09 stores no icon yet: every B09 menu uses the
// default menu icon until an icon key can be stored (pending database approval).
export function businessTree(menu: readonly MenuNode[], icon: string): NavTreeNode[] {
  return menu.flatMap((n): NavTreeNode[] => {
    if (n.children.length === 0) return n.routePath ? [{ kind: 'function', id: n.navigationId, title: n.menuTitle, path: pathOf(n) }] : [];
    const own: NavTreeNode[] = n.routePath ? [{ kind: 'function', id: `${n.navigationId}:self`, title: n.menuTitle, path: pathOf(n) }] : [];
    const children = [...own, ...businessTree(n.children, icon)];
    return children.length > 0 ? [{ kind: 'menu', id: `b09:${n.navigationId}`, title: n.menuTitle, icon, children }] : [];
  });
}

// Navigation Builder (owner decisions 22/10/2026): the whole sidebar is ONE tree. The DEVELOP area of B09 (marked by the
// backend) also holds the protected SYSTEM screens (Foundation / IAM groups the session may open — capabilities); they
// are not B03 Functions and are never stored in B09. Without a stored DEVELOP area (not configured yet) a virtual
// "Develop" area at the end holds them. An area with nothing to open is not shown.
export const VIRTUAL_DEVELOP_ID = 'develop:virtual';
export const DEFAULT_DEVELOP_TITLE = 'Develop';

export function shellTree(menu: readonly MenuNode[], icon: string, system: readonly NavTreeNode[]): NavTreeNode[] {
  const hasDevelop = menu.some((n) => n.developArea);
  const out = menu.flatMap((n): NavTreeNode[] => {
    if (!n.developArea) return businessTree([n], icon);
    const children = [...system, ...businessTree(n.children, icon)];
    return children.length > 0 ? [{ kind: 'menu', id: `b09:${n.navigationId}`, title: n.menuTitle, icon, children }] : [];
  });
  if (!hasDevelop && system.length > 0) out.push({ kind: 'menu', id: VIRTUAL_DEVELOP_ID, title: DEFAULT_DEVELOP_TITLE, icon, children: [...system] });
  return out;
}

// Multi-link (§6): several Function nodes may open the same path. The ACTIVE link is the one chosen (its node id, kept in
// the history entry) when it still opens that path; otherwise the first one in tree order (deterministic).
export function activeLinkId(nodes: readonly NavTreeNode[], path: string, chosen: string | null): string | null {
  let first: string | null = null;
  let match = false;
  const walk = (list: readonly NavTreeNode[]) => list.forEach((n) => {
    if (n.kind === 'menu') return walk(n.children);
    if (n.path === null || n.path !== path) return;
    first ??= n.id;
    if (n.id === chosen) match = true;
  });
  walk(nodes);
  return match ? chosen : first;
}

// Menus above a node (outermost first) and the titles from the root to it (breadcrumb); [] when the node is absent.
export function linkAncestors(nodes: readonly NavTreeNode[], id: string): NavTreeNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    if (n.kind === 'menu') {
      const below = linkAncestors(n.children, id);
      if (below.length > 0) return [n, ...below];
    }
  }
  return [];
}

// Every Function of a tree (search targets).
export function treeFunctions(nodes: readonly NavTreeNode[]): { title: string; path: ShellPath | null }[] {
  return nodes.flatMap((n) => (n.kind === 'function' ? [{ title: n.title, path: n.path }] : treeFunctions(n.children)));
}

// Ids of the menus that contain the Function opening `path` (outermost first), or [] when none does.
export function menuAncestors(nodes: readonly NavTreeNode[], path: string): string[] {
  for (const n of nodes) {
    if (n.kind === 'function') continue;
    if (n.children.some((c) => c.kind === 'function' && c.path === path)) return [n.id];
    const below = menuAncestors(n.children, path);
    if (below.length > 0) return [n.id, ...below];
  }
  return [];
}

// Every shell path the menu opens (module screens may be opened only through these).
export function menuPaths(menu: readonly MenuNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: readonly MenuNode[]) => nodes.forEach((n) => {
    const p = n.routePath ? shellPathOf(n.routePath) : undefined;
    if (p) out.add(p);
    walk(n.children);
  });
  walk(menu);
  return out;
}

// Titles from the root to the item that opens `path` (breadcrumb), or [] when the menu does not contain it.
export function menuTrail(menu: readonly MenuNode[], path: string): string[] {
  for (const n of menu) {
    if (n.routePath && shellPathOf(n.routePath) === path) return [n.menuTitle];
    const below = menuTrail(n.children, path);
    if (below.length > 0) return [n.menuTitle, ...below];
  }
  return [];
}
