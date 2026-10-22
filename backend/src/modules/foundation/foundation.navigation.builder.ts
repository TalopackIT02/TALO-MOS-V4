import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NavigationItem } from './foundation.navigation.js';

// Navigation Builder (owner decisions of 22/10/2026) — pure model over B09 foundation.fnd_navigation_items; no database
// access here. The database structure is unchanged; this file decides how the existing rows are read as a 3-level layout
// and which INSERT / UPDATE statements a saved draft becomes.
//
//   Level 1 AREA     = root group               (parent NULL, function NULL)
//   Level 2 MENU     = group whose parent is an AREA
//   Level 3 FUNCTION = Function item whose parent is a MENU (several links may open the same Function, Q05 / §6)
//   Anything else (Function at the root or under an AREA, deeper levels) is LEGACY: shown apart, untouched unless its
//   visibility is changed, still rendered by the sidebar (compatibility).
//
// DEVELOP identity (§5.3): the AREA that holds the system ANCHOR — a hidden group (module NULL, function NULL,
// is_visible false) with sort_order = DEVELOP_ANCHOR_ORDER. Independent of any title; the APIs refuse that sort order
// for every other row, and the anchor is never shown or edited.
//
// MOVE (§7.2): the API role may update menu_title / sort_order / is_visible of B09 but not parent_id (column privilege of
// talo_app, not changed here). A row that changes parent is therefore RE-LINKED: a new row at the target (same Function /
// module / title / visibility) and the old row hidden, in the same transaction. navigation_id changes in that case only.

export const DEVELOP_ANCHOR_ORDER = -2147483648;
export const DEVELOP_ANCHOR_TITLE = 'Develop (neo hệ thống)';
export const MAX_TITLE = 150;

// Developer Functions (§5.3): explicit registry by technical identity (module key + Function key) — never by name, never
// "every Function of an INTERNAL module". Test / diagnostic tools only. A link to one of them may exist in DEVELOP only.
export const DEVELOPER_FUNCTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['SYSTEM_TEST', new Set(['TEST_RUNNER', 'DIAGNOSTICS', 'DATA_VIEWER'])],
  ['DATA_INSPECTOR', new Set(['CATALOG', 'ROWS'])],
]);

export function isDeveloperFunction(moduleKey: string, functionKey: string): boolean {
  return DEVELOPER_FUNCTIONS.get(moduleKey)?.has(functionKey) === true;
}

// ----------------------------------------------------------------------------------------------------- read model
export interface LayoutLink {
  readonly id: string;
  readonly functionId: string;
  readonly moduleId: string;
  readonly title: string;
  readonly visible: boolean;
}

export interface LayoutMenu {
  readonly id: string;
  readonly moduleId: string | null;
  readonly title: string;
  readonly visible: boolean;
  readonly items: LayoutLink[];
}

export interface LayoutArea {
  readonly id: string;
  readonly moduleId: string | null;
  readonly title: string;
  readonly visible: boolean;
  readonly develop: boolean;
  readonly menus: LayoutMenu[];
}

export interface LegacyItem {
  readonly id: string;
  readonly kind: 'function' | 'group';
  readonly functionId: string | null;
  readonly moduleId: string | null;
  readonly title: string;
  readonly visible: boolean;
  readonly path: string[]; // titles of the ancestors (root first)
  readonly inDevelop: boolean; // below the DEVELOP area (a Developer Function may be shown there only)
  readonly reason: 'FUNCTION_AT_ROOT' | 'FUNCTION_UNDER_AREA' | 'TOO_DEEP' | 'UNREACHABLE';
}

export interface Layout {
  readonly revision: string;
  readonly developAreaId: string | null;
  readonly areas: LayoutArea[];
  readonly legacy: LegacyItem[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const itemOrder = (a: NavigationItem, b: NavigationItem) =>
  a.sortOrder - b.sortOrder || byCodeUnit(a.menuTitle, b.menuTitle) || byCodeUnit(a.navigationId, b.navigationId);

export function isAnchor(item: NavigationItem): boolean {
  return item.parentId !== null && item.functionId === null && item.moduleId === null && !item.isVisible && item.sortOrder === DEVELOP_ANCHOR_ORDER;
}

// The DEVELOP area: the root group holding the oldest anchor (deterministic if two anchors ever exist).
export function developAreaId(items: readonly NavigationItem[]): string | null {
  const byId = new Map(items.map((i) => [i.navigationId, i]));
  const anchors = items.filter(isAnchor).filter((a) => {
    const parent = a.parentId === null ? undefined : byId.get(a.parentId);
    return parent !== undefined && parent.parentId === null && parent.functionId === null;
  }).sort((a, b) => byCodeUnit(a.createdAt, b.createdAt) || byCodeUnit(a.navigationId, b.navigationId));
  return anchors[0]?.parentId ?? null;
}

// Revision of the stored layout: digest of every B09 row (hidden ones included). Any change by anyone changes it.
export function revisionOf(items: readonly NavigationItem[]): string {
  const lines = items.map((i) => [i.navigationId, i.parentId ?? '', i.moduleId ?? '', i.functionId ?? '', i.menuTitle, String(i.sortOrder), i.isVisible ? '1' : '0'].join('\u0001'))
    .sort(byCodeUnit);
  return createHash('sha256').update(lines.join('\u0002'), 'utf8').digest('hex');
}

export function readLayout(items: readonly NavigationItem[]): Layout {
  const develop = developAreaId(items);
  const byId = new Map(items.map((i) => [i.navigationId, i]));
  const children = new Map<string | null, NavigationItem[]>();
  for (const i of items) {
    if (isAnchor(i)) continue;
    const list = children.get(i.parentId) ?? [];
    list.push(i);
    children.set(i.parentId, list);
  }
  const kids = (id: string | null) => [...(children.get(id) ?? [])].sort(itemOrder);
  const legacy: LegacyItem[] = [];
  const seen = new Set<string>();
  const addLegacy = (i: NavigationItem, path: string[], reason: LegacyItem['reason']) => {
    seen.add(i.navigationId);
    legacy.push({ id: i.navigationId, kind: i.functionId === null ? 'group' : 'function', functionId: i.functionId, moduleId: i.moduleId, title: i.menuTitle, visible: i.isVisible, path, inDevelop: insideDevelop(i, byId, develop), reason });
  };
  const deep = (i: NavigationItem, path: string[]) => { // everything below level 3 (or below a legacy row) is legacy
    for (const c of kids(i.navigationId)) {
      if (seen.has(c.navigationId)) continue;
      addLegacy(c, path, 'TOO_DEEP');
      deep(c, [...path, c.menuTitle]);
    }
  };
  const areas: LayoutArea[] = [];
  for (const root of kids(null)) {
    seen.add(root.navigationId);
    if (root.functionId !== null) {
      addLegacy(root, [], 'FUNCTION_AT_ROOT');
      deep(root, [root.menuTitle]);
      continue;
    }
    const menus: LayoutMenu[] = [];
    for (const m of kids(root.navigationId)) {
      seen.add(m.navigationId);
      if (m.functionId !== null) {
        addLegacy(m, [root.menuTitle], 'FUNCTION_UNDER_AREA');
        deep(m, [root.menuTitle, m.menuTitle]);
        continue;
      }
      const links: LayoutLink[] = [];
      for (const f of kids(m.navigationId)) {
        seen.add(f.navigationId);
        if (f.functionId === null || f.moduleId === null) {
          addLegacy(f, [root.menuTitle, m.menuTitle], 'TOO_DEEP');
          deep(f, [root.menuTitle, m.menuTitle, f.menuTitle]);
          continue;
        }
        links.push({ id: f.navigationId, functionId: f.functionId, moduleId: f.moduleId, title: f.menuTitle, visible: f.isVisible });
        deep(f, [root.menuTitle, m.menuTitle, f.menuTitle]);
      }
      menus.push({ id: m.navigationId, moduleId: m.moduleId, title: m.menuTitle, visible: m.isVisible, items: links });
    }
    areas.push({ id: root.navigationId, moduleId: root.moduleId, title: root.menuTitle, visible: root.isVisible, develop: root.navigationId === develop, menus });
  }
  // Rows whose parent chain never reaches a root (cycle / broken parent): listed, never shown by the sidebar either.
  for (const i of items) if (!isAnchor(i) && !seen.has(i.navigationId)) addLegacy(i, [], 'UNREACHABLE');
  return { revision: revisionOf(items), developAreaId: develop, areas, legacy };
}

// ----------------------------------------------------------------------------------------------------- draft model
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID).transform((s) => s.toLowerCase());
const title = z.string().trim().min(1).max(MAX_TITLE);
const draftLink = z.strictObject({ id: id.nullable(), functionId: id, title, visible: z.boolean() });
const draftMenu = z.strictObject({ id: id.nullable(), title, visible: z.boolean(), items: z.array(draftLink).max(2000) });
const draftArea = z.strictObject({ id: id.nullable(), title, visible: z.boolean(), develop: z.boolean(), menus: z.array(draftMenu).max(2000) });
export const draftSchema = z.strictObject({
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  areas: z.array(draftArea).min(1).max(2000),
  legacy: z.array(z.strictObject({ id, visible: z.boolean() })).max(10000),
});
export type Draft = z.infer<typeof draftSchema>;

// What the validator needs to know about a Function (from B03 + the ACTIVE version + MIC-04, read by the repository).
export interface FunctionFacts {
  readonly functionId: string;
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly functionKey: string;
  readonly assignable: boolean; // module ENABLED, ACTIVE version with an intact MIC, exactly one MIC-04 route, an IAM requirement
  readonly developer: boolean;
}

export type BuilderErrorCode =
  | 'LAYOUT_ITEM_UNKNOWN' | 'LAYOUT_ITEM_REPEATED' | 'LAYOUT_INCOMPLETE' | 'LAYOUT_LEVEL_INVALID' | 'DEVELOP_AREA_REQUIRED'
  | 'DEVELOP_AREA_PROTECTED' | 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP' | 'FUNCTION_DUPLICATE_IN_MENU' | 'FUNCTION_NOT_ASSIGNABLE'
  | 'FUNCTION_MODULE_MISMATCH' | 'FUNCTION_CHANGED';

export interface BuilderIssue {
  readonly code: BuilderErrorCode;
  readonly ref: string; // navigationId or position "areaIndex.menuIndex.itemIndex"
}

// Validation of the WHOLE final draft against the stored rows (never the order of the drag operations).
export function validateDraft(draft: Draft, items: readonly NavigationItem[], functions: ReadonlyMap<string, FunctionFacts>): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  const stored = readLayout(items);
  const byId = new Map(items.map((i) => [i.navigationId, i]));
  const kindOf = new Map<string, 'area' | 'menu' | 'link'>();
  for (const a of stored.areas) {
    kindOf.set(a.id, 'area');
    for (const m of a.menus) {
      kindOf.set(m.id, 'menu');
      for (const l of m.items) kindOf.set(l.id, 'link');
    }
  }
  const legacyIds = new Set(stored.legacy.map((l) => l.id));
  const used = new Set<string>();
  const use = (nid: string, kind: 'area' | 'menu' | 'link', ref: string) => {
    if (used.has(nid)) issues.push({ code: 'LAYOUT_ITEM_REPEATED', ref: nid });
    used.add(nid);
    const k = kindOf.get(nid);
    if (k === undefined) issues.push({ code: 'LAYOUT_ITEM_UNKNOWN', ref: nid });
    else if (k !== kind) issues.push({ code: 'LAYOUT_LEVEL_INVALID', ref });
  };
  const developAreas = draft.areas.filter((a) => a.develop);
  // At most one DEVELOP area. Once one is stored it must stay (exactly one); before that a save may leave it out, so that
  // DEVELOP is created only by the save that also relocates the Developer Functions (no state where they are unreachable).
  if (developAreas.length > 1 || (stored.developAreaId !== null && developAreas.length !== 1)) issues.push({ code: 'DEVELOP_AREA_REQUIRED', ref: 'areas' });
  draft.areas.forEach((a, ai) => {
    if (a.id !== null) use(a.id, 'area', `${ai}`);
    // The DEVELOP area keeps its identity and stays visible (it carries the system screens).
    if (a.develop && stored.developAreaId !== null && a.id !== stored.developAreaId) issues.push({ code: 'DEVELOP_AREA_PROTECTED', ref: `${ai}` });
    if (!a.develop && a.id !== null && a.id === stored.developAreaId) issues.push({ code: 'DEVELOP_AREA_PROTECTED', ref: `${ai}` });
    if (a.develop && !a.visible) issues.push({ code: 'DEVELOP_AREA_PROTECTED', ref: `${ai}` });
    const areaModule = a.id !== null ? byId.get(a.id)?.moduleId ?? null : null;
    a.menus.forEach((m, mi) => {
      if (m.id !== null) use(m.id, 'menu', `${ai}.${mi}`);
      const storedMenu = m.id !== null ? byId.get(m.id) : undefined;
      // A menu kept in place keeps its module; a new or re-linked menu belongs to its area's module (NULL = all modules).
      const menuModule = storedMenu !== undefined && storedMenu.parentId === a.id ? storedMenu.moduleId : areaModule;
      const visibleFunctions = new Set<string>();
      m.items.forEach((l, li) => {
        const ref = `${ai}.${mi}.${li}`;
        if (l.id !== null) {
          use(l.id, 'link', ref);
          const s = byId.get(l.id);
          if (s !== undefined && s.functionId !== l.functionId) issues.push({ code: 'FUNCTION_CHANGED', ref: l.id });
        }
        const fn = functions.get(l.functionId);
        const isNew = l.id === null;
        const relinked = !isNew && (m.id === null || byId.get(l.id ?? '')?.parentId !== m.id || storedMenu?.parentId !== a.id);
        // A new / re-linked row needs an assignable Function now; a row kept in place stays as stored (no forced removal).
        if ((isNew || relinked) && fn?.assignable !== true) issues.push({ code: 'FUNCTION_NOT_ASSIGNABLE', ref });
        if (fn !== undefined && (isNew || relinked) && menuModule !== null && fn.moduleId !== menuModule) issues.push({ code: 'FUNCTION_MODULE_MISMATCH', ref });
        // Never placed / shown again outside DEVELOP. A row already stored visible there is kept (the sidebar removes it at
        // runtime) so that a save never forces a change of rows the user did not touch; hiding it is always allowed.
        const turnedOn = l.visible && !isNew && byId.get(l.id ?? '')?.isVisible === false;
        if (fn?.developer === true && !a.develop && (isNew || relinked || turnedOn)) issues.push({ code: 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP', ref });
        if (l.visible) {
          if (visibleFunctions.has(l.functionId)) issues.push({ code: 'FUNCTION_DUPLICATE_IN_MENU', ref });
          visibleFunctions.add(l.functionId);
        }
      });
    });
  });
  for (const [nid] of kindOf) if (!used.has(nid)) issues.push({ code: 'LAYOUT_INCOMPLETE', ref: nid });
  const legacySeen = new Set<string>();
  for (const l of draft.legacy) {
    if (!legacyIds.has(l.id)) issues.push({ code: 'LAYOUT_ITEM_UNKNOWN', ref: l.id });
    if (legacySeen.has(l.id)) issues.push({ code: 'LAYOUT_ITEM_REPEATED', ref: l.id });
    legacySeen.add(l.id);
    // A legacy Developer Function hidden outside DEVELOP may not be shown again (§5.3 rule 3).
    const s = byId.get(l.id);
    const fn = s?.functionId ? functions.get(s.functionId) : undefined;
    if (l.visible && s?.isVisible === false && fn?.developer && !insideDevelop(s, byId, stored.developAreaId)) issues.push({ code: 'DEVELOPER_FUNCTION_OUTSIDE_DEVELOP', ref: l.id });
  }
  return issues;
}

function insideDevelop(item: NavigationItem | undefined, byId: ReadonlyMap<string, NavigationItem>, develop: string | null): boolean {
  let cur = item;
  const seen = new Set<string>();
  while (cur !== undefined && cur.parentId !== null && !seen.has(cur.navigationId)) {
    seen.add(cur.navigationId);
    cur = byId.get(cur.parentId);
  }
  return develop !== null && cur?.navigationId === develop;
}

// ------------------------------------------------------------------------------------------------- write planning
// Rows to insert (parent by reference to an earlier insert or an existing id) and updates of the allowed columns only.
export type ParentRef = { readonly existing: string } | { readonly inserted: number } | null;

export interface PlannedInsert {
  readonly parent: ParentRef;
  readonly moduleId: string | null;
  readonly functionId: string | null;
  readonly title: string;
  readonly sortOrder: number;
  readonly visible: boolean;
  readonly kind: 'area' | 'menu' | 'link' | 'anchor';
  readonly replaces: string | null; // re-link: the hidden old row
}

export interface PlannedUpdate {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly visible: boolean;
}

export interface Plan {
  readonly inserts: PlannedInsert[];
  readonly updates: PlannedUpdate[];
}

// sort_order of one sibling list (draft order). `places[i]` = the stored id of a row kept under the same parent, null for a
// new / re-linked row. When the kept rows are still in their stored order and every new row comes after them, the stored
// values are kept and new rows continue after the largest one — a save never rewrites rows the user did not reorder.
// Otherwise the list is numbered 0..n-1.
function siblingOrders(places: readonly (string | null)[], byId: ReadonlyMap<string, NavigationItem>): number[] {
  const kept = places.flatMap((id) => (id === null ? [] : byId.get(id) ?? []));
  const sorted = [...kept].sort(itemOrder);
  const sameOrder = kept.every((k, i) => k.navigationId === sorted[i]?.navigationId);
  const firstNew = places.findIndex((id) => id === null);
  const newAtEnd = firstNew === -1 || places.slice(firstNew).every((id) => id === null);
  let next = kept.length === 0 ? 0 : Math.max(...kept.map((k) => k.sortOrder)) + 1;
  if (sameOrder && newAtEnd && next + places.length <= 2147483647) {
    return places.map((id) => (id === null ? next++ : byId.get(id)?.sortOrder ?? 0));
  }
  return places.map((_, i) => i);
}

// Pre-condition: validateDraft() returned no issue.
export function planDraft(draft: Draft, items: readonly NavigationItem[], functions: ReadonlyMap<string, FunctionFacts>): Plan {
  const byId = new Map(items.map((i) => [i.navigationId, i]));
  const inserts: PlannedInsert[] = [];
  const updates = new Map<string, PlannedUpdate>();
  const setRow = (rowId: string, change: Partial<Omit<PlannedUpdate, 'id'>>) => {
    const s = byId.get(rowId);
    if (s === undefined) return;
    const prev = updates.get(rowId) ?? { id: rowId, title: s.menuTitle, sortOrder: s.sortOrder, visible: s.isVisible };
    updates.set(rowId, { ...prev, ...change });
  };
  const insert = (row: PlannedInsert): ParentRef => {
    inserts.push(row);
    return { inserted: inserts.length - 1 };
  };
  const areaOrders = siblingOrders(draft.areas.map((a) => a.id), byId);
  draft.areas.forEach((a, ai) => {
    let areaRef: ParentRef;
    let areaModule: string | null = null;
    const areaOrder = areaOrders[ai] ?? ai;
    if (a.id !== null) {
      setRow(a.id, { title: a.title, sortOrder: areaOrder, visible: a.visible });
      areaRef = { existing: a.id };
      areaModule = byId.get(a.id)?.moduleId ?? null;
    } else {
      areaRef = insert({ parent: null, moduleId: null, functionId: null, title: a.title, sortOrder: areaOrder, visible: a.visible, kind: 'area', replaces: null });
      if (a.develop) insert({ parent: areaRef, moduleId: null, functionId: null, title: DEVELOP_ANCHOR_TITLE, sortOrder: DEVELOP_ANCHOR_ORDER, visible: false, kind: 'anchor', replaces: null });
    }
    const menuPlaces = a.menus.map((m) => {
      const stored = m.id !== null ? byId.get(m.id) : undefined;
      return stored !== undefined && a.id !== null && stored.parentId === a.id ? stored.navigationId : null;
    });
    const menuOrders = siblingOrders(menuPlaces, byId);
    a.menus.forEach((m, mi) => {
      const inPlace = menuPlaces[mi] !== null && menuPlaces[mi] !== undefined;
      const menuOrder = menuOrders[mi] ?? mi;
      let menuRef: ParentRef;
      if (inPlace && m.id !== null) {
        setRow(m.id, { title: m.title, sortOrder: menuOrder, visible: m.visible });
        menuRef = { existing: m.id };
      } else {
        // A new or moved menu belongs to its area's module (NULL = a menu for Functions of every module).
        menuRef = insert({ parent: areaRef, moduleId: areaModule, functionId: null, title: m.title, sortOrder: menuOrder, visible: m.visible, kind: 'menu', replaces: m.id });
        if (m.id !== null) setRow(m.id, { visible: false }); // moved menu: the old one is hidden (children kept, §7.4)
      }
      const linkPlaces = m.items.map((l) => {
        const s = l.id !== null ? byId.get(l.id) : undefined;
        return s !== undefined && inPlace && m.id !== null && s.parentId === m.id ? s.navigationId : null;
      });
      const linkOrders = siblingOrders(linkPlaces, byId);
      m.items.forEach((l, li) => {
        const linkOrder = linkOrders[li] ?? li;
        if (linkPlaces[li] && l.id !== null) {
          setRow(l.id, { title: l.title, sortOrder: linkOrder, visible: l.visible });
          return;
        }
        const s = l.id !== null ? byId.get(l.id) : undefined;
        const fn = functions.get(l.functionId);
        insert({ parent: menuRef, moduleId: fn?.moduleId ?? s?.moduleId ?? null, functionId: l.functionId, title: l.title, sortOrder: linkOrder, visible: l.visible, kind: 'link', replaces: l.id });
        if (l.id !== null) setRow(l.id, { visible: false }); // moved link: the old row is hidden (never a second visible copy)
      });
    });
  });
  for (const l of draft.legacy) setRow(l.id, { visible: l.visible });
  const changed = [...updates.values()].filter((u) => {
    const s = byId.get(u.id);
    return s !== undefined && (s.menuTitle !== u.title || s.sortOrder !== u.sortOrder || s.isVisible !== u.visible);
  });
  return { inserts, updates: changed };
}

// Rows of the draft as they would be stored (preview): existing ids kept, inserted rows get "draft:<n>" ids.
export function previewItems(items: readonly NavigationItem[], plan: Plan): NavigationItem[] {
  const updated = new Map(plan.updates.map((u) => [u.id, u]));
  const out: NavigationItem[] = items.map((i) => {
    const u = updated.get(i.navigationId);
    return u ? { ...i, menuTitle: u.title, sortOrder: u.sortOrder, isVisible: u.visible } : i;
  });
  plan.inserts.forEach((r, n) => {
    const parentId = r.parent === null ? null : 'existing' in r.parent ? r.parent.existing : `draft:${r.parent.inserted}`;
    out.push({ navigationId: `draft:${n}`, parentId, moduleId: r.moduleId, functionId: r.functionId, menuTitle: r.title, sortOrder: r.sortOrder, isVisible: r.visible, createdAt: '9999-12-31T00:00:00.000000Z' });
  });
  return out;
}
