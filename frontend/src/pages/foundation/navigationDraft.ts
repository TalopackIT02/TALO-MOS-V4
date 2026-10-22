import type { DraftLayout, InventoryFunction, LegacyItem, NavigationLayout } from '../../services/foundation/foundationApi';

// Navigation Builder — the in-memory DRAFT (owner decision Q09 option B): nothing is written before "Lưu". Every edit
// returns a new draft; the backend validates the whole draft again on preview / save (it is the authority). The rules
// checked here only explain early to the user what the server would refuse.
//   AREA (root group) → MENU (group) → LINK (Function). A LINK that changes menu, or a MENU that changes area, is saved
//   as a new row and its old row hidden (B09 parent_id is not updatable by the API role) — the draft only keeps `id`.

export interface BLink {
  readonly key: string; readonly id: string | null; readonly storedMenu: string | null; readonly storedVisible: boolean | null; readonly functionId: string; readonly moduleId: string; title: string; visible: boolean;
}
export interface BMenu {
  readonly key: string; readonly id: string | null; readonly storedArea: string | null; readonly storedModule: string | null;
  title: string; visible: boolean; items: BLink[];
}
export interface BArea { readonly key: string; readonly id: string | null; readonly moduleId: string | null; title: string; visible: boolean; readonly develop: boolean; menus: BMenu[] }
export interface BDraft { readonly revision: string; areas: BArea[]; legacy: { id: string; visible: boolean }[] }

export const DEVELOP_TITLE = 'Develop';
export const MAX_TITLE = 150;

let counter = 0;
const newKey = () => `new:${++counter}`;

export function fromLayout(layout: NavigationLayout): BDraft {
  const areas: BArea[] = layout.areas.map((a) => ({
    key: a.id, id: a.id, moduleId: a.moduleId, title: a.title, visible: a.visible, develop: a.develop,
    menus: a.menus.map((m) => ({
      key: m.id, id: m.id, storedArea: a.id, storedModule: m.moduleId, title: m.title, visible: m.visible,
      items: m.items.map((l) => ({ key: l.id, id: l.id, storedMenu: m.id, storedVisible: l.visible, functionId: l.functionId, moduleId: l.moduleId, title: l.title, visible: l.visible })),
    })),
  }));
  // No DEVELOP area stored yet: the draft proposes one (created with its system anchor on the first save).
  if (!areas.some((a) => a.develop)) areas.push({ key: 'develop:new', id: null, moduleId: null, title: DEVELOP_TITLE, visible: true, develop: true, menus: [] });
  return { revision: layout.revision, areas, legacy: layout.legacy.map((l) => ({ id: l.id, visible: l.visible })) };
}

export function toPayload(d: BDraft): DraftLayout {
  return {
    revision: d.revision,
    areas: d.areas.map((a) => ({
      id: a.id, title: a.title.trim(), visible: a.visible, develop: a.develop,
      menus: a.menus.map((m) => ({ id: m.id, title: m.title.trim(), visible: m.visible, items: m.items.map((l) => ({ id: l.id, functionId: l.functionId, title: l.title.trim(), visible: l.visible })) })),
    })),
    legacy: d.legacy.map((l) => ({ ...l })),
  };
}

export const sameDraft = (a: BDraft, b: BDraft) => JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));

const clone = (d: BDraft): BDraft => ({
  revision: d.revision,
  areas: d.areas.map((a) => ({ ...a, menus: a.menus.map((m) => ({ ...m, items: m.items.map((l) => ({ ...l })) })) })),
  legacy: d.legacy.map((l) => ({ ...l })),
});

// ------------------------------------------------------------------------------------------------- lookup
export type Found =
  | { kind: 'area'; area: BArea; ai: number }
  | { kind: 'menu'; area: BArea; menu: BMenu; ai: number; mi: number }
  | { kind: 'link'; area: BArea; menu: BMenu; link: BLink; ai: number; mi: number; li: number };

export function find(d: BDraft, key: string): Found | null {
  for (const [ai, area] of d.areas.entries()) {
    if (area.key === key) return { kind: 'area', area, ai };
    for (const [mi, menu] of area.menus.entries()) {
      if (menu.key === key) return { kind: 'menu', area, menu, ai, mi };
      for (const [li, link] of menu.items.entries()) if (link.key === key) return { kind: 'link', area, menu, link, ai, mi, li };
    }
  }
  return null;
}

// Module of a menu in its current area: kept when the menu stays where it is stored, else the area's (NULL = all modules).
export const menuModule = (menu: BMenu, area: BArea): string | null => (menu.id !== null && menu.storedArea === area.id ? menu.storedModule : area.moduleId);

const hasVisible = (menu: BMenu, functionId: string, except?: string) => menu.items.some((l) => l.visible && l.functionId === functionId && l.key !== except);

// ------------------------------------------------------------------------------------------------- placement rules
export type Facts = ReadonlyMap<string, InventoryFunction>;

// Why a Function link cannot be shown (visible) in this menu, or null.
export function linkRefusal(facts: Facts, area: BArea, menu: BMenu, functionId: string, isNew: boolean, exceptKey?: string): string | null {
  const fn = facts.get(functionId);
  if (isNew && fn?.assignable !== true) return 'Chức năng chưa thể gắn menu (module tắt, không có phiên bản ACTIVE hoặc MIC-04 không có route).';
  if (fn?.developer === true && !area.develop) return 'Developer Function chỉ được đặt trong Develop.';
  const module = menuModule(menu, area);
  if (fn !== undefined && module !== null && fn.moduleId !== module) return 'Menu này thuộc một module khác với module của chức năng.';
  if (hasVisible(menu, functionId, exceptKey)) return 'Đã có trong menu.';
  return null;
}

// ------------------------------------------------------------------------------------------------- edits (pure)
export function moveArea(d: BDraft, key: string, to: number): BDraft {
  const out = clone(d);
  const from = out.areas.findIndex((a) => a.key === key);
  if (from < 0) return d;
  const [area] = out.areas.splice(from, 1);
  if (area) out.areas.splice(Math.max(0, Math.min(to > from ? to - 1 : to, out.areas.length)), 0, area);
  return out;
}

export function moveMenu(d: BDraft, key: string, areaKey: string, to: number): BDraft {
  const out = clone(d);
  const f = find(out, key);
  const target = out.areas.find((a) => a.key === areaKey);
  if (f?.kind !== 'menu' || !target) return d;
  f.area.menus.splice(f.mi, 1);
  const index = f.area === target && to > f.mi ? to - 1 : to;
  target.menus.splice(Math.max(0, Math.min(index, target.menus.length)), 0, f.menu);
  return out;
}

export function moveLink(d: BDraft, key: string, menuKey: string, to: number): BDraft {
  const out = clone(d);
  const f = find(out, key);
  const t = find(out, menuKey);
  if (f?.kind !== 'link' || t?.kind !== 'menu') return d;
  f.menu.items.splice(f.li, 1);
  const index = f.menu === t.menu && to > f.li ? to - 1 : to;
  t.menu.items.splice(Math.max(0, Math.min(index, t.menu.items.length)), 0, f.link);
  return out;
}

export function addLinks(d: BDraft, menuKey: string, fns: readonly InventoryFunction[], at?: number): BDraft {
  const out = clone(d);
  const t = find(out, menuKey);
  if (t?.kind !== 'menu') return d;
  const links = fns.map((fn) => ({ key: newKey(), id: null, storedMenu: null, storedVisible: null, functionId: fn.functionId, moduleId: fn.moduleId, title: fn.displayName.slice(0, MAX_TITLE), visible: true }));
  t.menu.items.splice(at ?? t.menu.items.length, 0, ...links);
  return out;
}

export function addArea(d: BDraft, title: string): { draft: BDraft; key: string } {
  const out = clone(d);
  const key = newKey();
  const developAt = out.areas.findIndex((a) => a.develop);
  out.areas.splice(developAt < 0 ? out.areas.length : developAt, 0, { key, id: null, moduleId: null, title, visible: true, develop: false, menus: [] });
  return { draft: out, key };
}

export function addMenu(d: BDraft, areaKey: string, title: string): { draft: BDraft; key: string } {
  const out = clone(d);
  const area = out.areas.find((a) => a.key === areaKey);
  const key = newKey();
  area?.menus.push({ key, id: null, storedArea: null, storedModule: null, title, visible: true, items: [] });
  return { draft: out, key };
}

export function edit(d: BDraft, key: string, change: { title?: string; visible?: boolean }): BDraft {
  const out = clone(d);
  const f = find(out, key);
  const node = f === null ? null : f.kind === 'area' ? f.area : f.kind === 'menu' ? f.menu : f.link;
  if (node) Object.assign(node, change);
  return out;
}

// "Gỡ" a menu with Function links (§7.4): its visible links go to another menu (a Function already visible there is
// moved hidden — never a duplicate), then the menu is hidden. One draft step, saved atomically.
export function moveChildrenAndHide(d: BDraft, menuKey: string, targetKey: string): { draft: BDraft; hiddenDuplicates: number } {
  const out = clone(d);
  const f = find(out, menuKey);
  const t = find(out, targetKey);
  if (f?.kind !== 'menu' || t?.kind !== 'menu' || f.menu === t.menu) return { draft: d, hiddenDuplicates: 0 };
  let hiddenDuplicates = 0;
  for (const link of f.menu.items) {
    if (link.visible && hasVisible(t.menu, link.functionId)) {
      link.visible = false;
      hiddenDuplicates += 1;
    }
    t.menu.items.push(link);
  }
  f.menu.items = [];
  f.menu.visible = false;
  return { draft: out, hiddenDuplicates };
}

export function setLegacy(d: BDraft, id: string, visible: boolean): BDraft {
  const out = clone(d);
  const row = out.legacy.find((l) => l.id === id);
  if (row) row.visible = visible;
  return out;
}

// One click (§5.3): every visible Developer Function link outside DEVELOP — and every visible legacy Developer row — is
// re-linked into a menu of DEVELOP named after its module (created when missing); the old rows are hidden.
export function relocateDeveloper(d: BDraft, legacy: readonly LegacyItem[], facts: Facts): { draft: BDraft; moved: number; skipped: number } {
  const out = clone(d);
  const develop = out.areas.find((a) => a.develop);
  if (!develop) return { draft: d, moved: 0, skipped: 0 };
  let moved = 0;
  let skipped = 0;
  const menuFor = (fn: InventoryFunction): BMenu => {
    const title = (fn.moduleName || fn.moduleKey).slice(0, MAX_TITLE);
    const existing = develop.menus.find((m) => m.visible && m.title === title && (menuModule(m, develop) === null || menuModule(m, develop) === fn.moduleId));
    if (existing) return existing;
    const menu: BMenu = { key: newKey(), id: null, storedArea: null, storedModule: null, title, visible: true, items: [] };
    develop.menus.push(menu);
    return menu;
  };
  for (const area of out.areas) {
    if (area.develop) continue;
    for (const menu of area.menus) {
      menu.items = menu.items.filter((link) => {
        const fn = facts.get(link.functionId);
        if (!fn?.developer || !link.visible) return true;
        if (!fn.assignable) { skipped += 1; return true; }
        const target = menuFor(fn);
        if (hasVisible(target, link.functionId)) link.visible = false;
        target.items.push(link);
        moved += 1;
        return false;
      });
    }
  }
  for (const row of legacy) {
    const fn = row.functionId ? facts.get(row.functionId) : undefined;
    const state = out.legacy.find((l) => l.id === row.id);
    if (!fn?.developer || !state?.visible) continue;
    if (!fn.assignable) { skipped += 1; continue; }
    const target = menuFor(fn);
    if (!hasVisible(target, fn.functionId)) target.items.push({ key: newKey(), id: null, storedMenu: null, storedVisible: null, functionId: fn.functionId, moduleId: fn.moduleId, title: row.title, visible: true });
    state.visible = false;
    moved += 1;
  }
  return { draft: out, moved, skipped };
}

// ------------------------------------------------------------------------------------------------- whole-draft check
export interface DraftIssue { readonly key: string; readonly text: string }

// A row is saved as NEW when it was never stored or when it leaves the parent it was read under (re-link).
export const linkRelinked = (link: BLink, menu: BMenu, area: BArea) => link.id !== null && (menu.id === null || menu.storedArea !== area.id || link.storedMenu !== menu.id);

// Same rules as the server (validateDraft), on the final draft — never on the order of the edits.
export function draftIssues(d: BDraft, facts: Facts, legacy: readonly LegacyItem[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (d.areas.filter((a) => a.develop).length !== 1) issues.push({ key: '', text: 'Cần đúng một vùng Develop.' });
  for (const area of d.areas) {
    if (!area.title.trim()) issues.push({ key: area.key, text: 'Vùng chưa có tiêu đề.' });
    if (area.develop && !area.visible) issues.push({ key: area.key, text: 'Không ẩn được vùng Develop.' });
    for (const menu of area.menus) {
      if (!menu.title.trim()) issues.push({ key: menu.key, text: `Menu trong “${area.title}” chưa có tiêu đề.` });
      const shown = new Set<string>();
      for (const link of menu.items) {
        const isNew = link.id === null || linkRelinked(link, menu, area);
        const fn = facts.get(link.functionId);
        if (!link.title.trim()) issues.push({ key: link.key, text: `Liên kết trong “${menu.title}” chưa có tiêu đề.` });
        const turnedOn = link.visible && link.storedVisible === false;
        if (fn?.developer && !area.develop && (isNew || turnedOn)) issues.push({ key: link.key, text: `“${link.title}” là Developer Function: chỉ được đặt trong Develop.` });
        if (isNew && fn?.assignable !== true) issues.push({ key: link.key, text: `“${link.title}”: chức năng chưa thể gắn menu.` });
        const module = menuModule(menu, area);
        if (isNew && fn && module !== null && fn.moduleId !== module) issues.push({ key: link.key, text: `“${link.title}”: menu “${menu.title}” thuộc module khác.` });
        if (link.visible) {
          if (shown.has(link.functionId)) issues.push({ key: link.key, text: `“${link.title}” trùng chức năng đang hiển thị trong menu “${menu.title}”.` });
          shown.add(link.functionId);
        }
      }
    }
  }
  for (const row of legacy) {
    const fn = row.functionId ? facts.get(row.functionId) : undefined;
    const shown = d.legacy.find((l) => l.id === row.id)?.visible === true;
    if (fn?.developer && shown && !row.visible && !row.inDevelop) issues.push({ key: row.id, text: `“${row.title}” (cấu trúc cũ) là Developer Function ngoài Develop: không hiện lại được.` });
  }
  return issues;
}

// Rows that differ from the stored layout (new, moved, renamed, re-ordered, shown / hidden) — the draft marker of the tree.
export function changedKeys(base: BDraft, draft: BDraft): Set<string> {
  const sig = (d: BDraft) => {
    const out = new Map<string, string>();
    d.areas.forEach((a, ai) => {
      out.set(a.key, `${ai}|${a.title}|${a.visible}`);
      a.menus.forEach((m, mi) => {
        out.set(m.key, `${a.key}|${mi}|${m.title}|${m.visible}`);
        m.items.forEach((l, li) => out.set(l.key, `${m.key}|${li}|${l.title}|${l.visible}`));
      });
    });
    return out;
  };
  const before = sig(base);
  const changed = new Set<string>();
  for (const [key, value] of sig(draft)) if (before.get(key) !== value) changed.add(key);
  return changed;
}

// Why a menu (with its links) cannot go to this area, or null.
export function menuRefusal(facts: Facts, menu: BMenu, area: BArea): string | null {
  const module = menu.id !== null && menu.storedArea === area.id ? menu.storedModule : area.moduleId;
  for (const link of menu.items) {
    const fn = facts.get(link.functionId);
    if (fn?.developer && !area.develop) return 'Menu chứa Developer Function: chỉ được đặt trong Develop.';
    if (fn && module !== null && fn.moduleId !== module) return 'Vùng này thuộc một module khác với chức năng trong menu.';
    if (link.id !== null && fn?.assignable !== true && !(menu.id !== null && menu.storedArea === area.id)) return 'Menu chứa chức năng hiện không gắn được (module tắt / không ACTIVE): không chuyển được.';
  }
  return null;
}
