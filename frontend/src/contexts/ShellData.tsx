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

// ------------------------------------------------------------------------------------------------- business menu helpers
export interface MenuLink {
  readonly id: string;
  readonly title: string;
  readonly path: ShellPath | null; // null = the route has no installed screen in this shell
}

export type BusinessEntry =
  | { readonly kind: 'link'; readonly link: MenuLink }
  | { readonly kind: 'group'; readonly id: string; readonly title: string; readonly links: readonly MenuLink[] };

const linkOf = (n: MenuNode): MenuLink => ({ id: n.navigationId, title: n.menuTitle, path: n.routePath ? shellPathOf(n.routePath) ?? null : null });

// Leaves of a subtree that open something (a group's own route, if any, comes first).
function leaves(n: MenuNode, prefix: readonly string[]): MenuLink[] {
  const own = n.routePath ? [{ ...linkOf(n), title: [...prefix, n.menuTitle].join(' › ') }] : [];
  return [...own, ...n.children.flatMap((c) => leaves(c, [...prefix, n.menuTitle]))];
}

// Sidebar entries: a root item with a route is a link; a root group lists the routed items below it (nested groups are
// flattened with their title as prefix). A group without any routed item is not shown (nothing to open).
export function businessEntries(menu: readonly MenuNode[]): BusinessEntry[] {
  return menu.flatMap((n): BusinessEntry[] => {
    if (n.children.length === 0) return n.routePath ? [{ kind: 'link', link: linkOf(n) }] : [];
    const links = n.children.flatMap((c) => leaves(c, []));
    return links.length > 0 ? [{ kind: 'group', id: `b09:${n.navigationId}`, title: n.menuTitle, links }] : [];
  });
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
