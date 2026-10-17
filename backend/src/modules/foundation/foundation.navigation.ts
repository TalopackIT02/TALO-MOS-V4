import { z } from 'zod';
import { canonicalDigest } from './foundation.json.js';

// FBE-06 — Navigation: pure route / IAM-requirement resolution and menu-tree construction (owner decisions N1–N7).
//   Route (N6): MIC-04 of the ACTIVE version only, after the stored manifest is checked against manifest_hash; exactly one
//   MIC-04 entry for the Function with a non-blank routePath, otherwise the Function is not offered (never guessed).
//   IAM (N5): one requirement per Action declared in B06 for the ACTIVE version AND mapped exactly once in MIC-07 with the
//   K05 identity (moduleCode = moduleKey, resourceCode = functionKey, operation = actionKey). The requirement is evaluated
//   by the shared evaluateAccess() (service); MIC-07 never grants anything by itself.
//   Tree (N7): built top-down from the roots, so a node whose parent chain is broken or cyclic is unreachable and never
//   shown; a hidden node hides its whole branch; a Function item needs an allowed Function of its own module; a group is
//   kept only with at least one shown descendant. Order: sortOrder, menuTitle, navigationId (code-unit order).

export interface NavigationItem {
  readonly navigationId: string;
  readonly parentId: string | null;
  readonly moduleId: string | null;
  readonly functionId: string | null;
  readonly menuTitle: string;
  readonly sortOrder: number;
  readonly isVisible: boolean;
  readonly createdAt: string;
}

export interface ActiveVersionSource {
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly versionId: string;
  readonly manifestJson: unknown;
  readonly manifestHash: string | null;
}

// One row per (Function declared in B05, Action declared in B06) of an ACTIVE version; actionKey NULL = no action.
export interface ActiveFunctionRow {
  readonly versionId: string;
  readonly functionId: string;
  readonly functionKey: string;
  readonly actionKey: string | null;
}

export interface IamRequirement {
  readonly moduleCode: string;
  readonly resourceCode: string;
  readonly operation: string;
  readonly minimumAssuranceLevel: number;
}

export interface MenuFunctionCandidate {
  readonly moduleId: string;
  readonly functionId: string;
  readonly routePath: string;
  readonly screenKey: string | null;
  readonly requirements: readonly IamRequirement[];
}

export interface MenuFunction {
  readonly moduleId: string;
  readonly routePath: string;
  readonly screenKey: string | null;
}

export interface MenuNode {
  readonly navigationId: string;
  readonly moduleId: string | null;
  readonly functionId: string | null;
  readonly menuTitle: string;
  readonly sortOrder: number;
  readonly routePath: string | null;
  readonly screenKey: string | null;
  readonly children: MenuNode[];
}

// Only the sections Navigation reads; the rest of the stored MIC is ignored here.
const storedMic = z.object({
  mic04Navigation: z.array(z.looseObject({ functionKey: z.string().optional(), routePath: z.string().optional(), screenKey: z.string().optional() })),
  mic07IamMapping: z.array(z.looseObject({
    functionKey: z.string(), actionKey: z.string(), moduleCode: z.string(), resourceCode: z.string(), operation: z.string(), minimumAssuranceLevel: z.number().int(),
  })),
});

function manifestIntact(version: ActiveVersionSource): boolean {
  if (version.manifestJson === null || version.manifestHash === null) return false;
  try {
    return canonicalDigest(version.manifestJson).sha256 === version.manifestHash;
  } catch {
    return false;
  }
}

export function menuCandidates(version: ActiveVersionSource, rows: readonly ActiveFunctionRow[]): MenuFunctionCandidate[] {
  if (!manifestIntact(version)) return [];
  const mic = storedMic.safeParse(version.manifestJson);
  if (!mic.success) return [];
  const byFunction = new Map<string, { functionKey: string; actions: Set<string> }>();
  for (const r of rows) {
    if (r.versionId !== version.versionId) continue;
    const entry = byFunction.get(r.functionId) ?? { functionKey: r.functionKey, actions: new Set<string>() };
    if (r.actionKey !== null) entry.actions.add(r.actionKey);
    byFunction.set(r.functionId, entry);
  }
  const out: MenuFunctionCandidate[] = [];
  for (const [functionId, f] of byFunction) {
    const routes = mic.data.mic04Navigation.filter((n) => n.functionKey === f.functionKey);
    const [route] = routes;
    if (routes.length !== 1 || route === undefined || route.routePath === undefined || route.routePath.trim() === '') continue;
    const requirements: IamRequirement[] = [];
    for (const actionKey of [...f.actions].sort()) {
      const maps = mic.data.mic07IamMapping.filter((m) => m.functionKey === f.functionKey && m.actionKey === actionKey);
      const [m] = maps;
      if (maps.length !== 1 || m === undefined) continue;
      if (m.moduleCode !== version.moduleKey || m.resourceCode !== f.functionKey || m.operation !== actionKey) continue;
      requirements.push({ moduleCode: m.moduleCode, resourceCode: m.resourceCode, operation: m.operation, minimumAssuranceLevel: m.minimumAssuranceLevel });
    }
    if (requirements.length === 0) continue;
    out.push({ moduleId: version.moduleId, functionId, routePath: route.routePath, screenKey: route.screenKey ?? null, requirements });
  }
  return out;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: NavigationItem, b: NavigationItem) =>
  a.sortOrder - b.sortOrder || byCodeUnit(a.menuTitle, b.menuTitle) || byCodeUnit(a.navigationId, b.navigationId);

export function buildMenu(items: readonly NavigationItem[], allowed: ReadonlyMap<string, MenuFunction>): MenuNode[] {
  const children = new Map<string | null, NavigationItem[]>();
  const ids = new Set(items.map((i) => i.navigationId));
  for (const item of items) {
    const key = item.parentId;
    if (key !== null && !ids.has(key)) continue; // orphan: unreachable, never shown
    const list = children.get(key) ?? [];
    list.push(item);
    children.set(key, list);
  }
  const visited = new Set<string>();
  const render = (item: NavigationItem): MenuNode | null => {
    if (visited.has(item.navigationId)) return null; // defensive: a node is rendered once
    visited.add(item.navigationId);
    if (!item.isVisible) return null; // hides the whole branch
    let routePath: string | null = null;
    let screenKey: string | null = null;
    if (item.functionId !== null) {
      const fn = allowed.get(item.functionId);
      if (fn === undefined || fn.moduleId !== item.moduleId) return null; // hides the branch below a refused Function
      routePath = fn.routePath;
      screenKey = fn.screenKey;
    }
    const kids = [...(children.get(item.navigationId) ?? [])].sort(order).map(render).filter((n): n is MenuNode => n !== null);
    if (item.functionId === null && kids.length === 0) return null; // empty group
    return {
      navigationId: item.navigationId, moduleId: item.moduleId, functionId: item.functionId, menuTitle: item.menuTitle, sortOrder: item.sortOrder,
      routePath, screenKey, children: kids,
    };
  };
  return [...(children.get(null) ?? [])].sort(order).map(render).filter((n): n is MenuNode => n !== null);
}
