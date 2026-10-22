import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { InventoryFunction, LegacyItem, MenuNode, NavigationLayout } from '../../services/foundation/foundationApi';
import { describeFailure } from '../../services/foundation/foundationMessages';
import { shellTree, useShellData } from '../../contexts/ShellData';
import type { NavTreeNode } from '../../contexts/ShellData';
import { setLeaveGuard } from '../../routes/navigation';
import { SCREENS, visibleGroups } from '../../routes/shellScreens';
import { DEFAULT_MENU_ICON, NavIcon } from '../../components/icons/NavIcon';
import { isTestModuleKey } from '../iam/iamShared';
import { FeedbackLine } from './common';
import type { Feedback } from './common';
import {
  addArea, addLinks, addMenu, changedKeys, draftIssues, edit, find, fromLayout, linkRefusal, linkRelinked, MAX_TITLE, menuModule, menuRefusal, moveArea,
  moveChildrenAndHide, moveLink, moveMenu, relocateDeveloper, sameDraft, setLegacy, toPayload,
} from './navigationDraft';
import type { BArea, BDraft, BMenu, Facts } from './navigationDraft';
import '../../styles/navigation-builder.css';

// Navigation Builder (owner decisions of 22/10/2026) — tab "Quản trị menu" of Foundation › Điều hướng.
//   Left: the tree shaped like the sidebar (AREA → MENU → Function LINK), drag handles, collapse, draft markers.
//   Right: the panel of the selected row, then the Function inventory (every real Function, where it is linked).
// Every edit changes the in-memory draft only; "Lưu cấu hình" sends the whole draft (PUT, one transaction, B08 audit),
// "Hủy thay đổi" restores the snapshot. The sidebar itself is never edited in place. System screens (Foundation / IAM)
// are a fixed virtual node of DEVELOP — they are not B03 Functions and are not stored in B09.

const SYSTEM_KEY = 'system:screens';

type Drag = { readonly kind: 'area' | 'menu' | 'link'; readonly key: string } | { readonly kind: 'fn'; readonly ids: readonly string[] };
type Target = { readonly kind: 'area' | 'menu' | 'link'; readonly key: string };
type DropPlan = { readonly draft: BDraft } | { readonly error: string };

const REASON_TEXT: Record<string, string> = {
  MODULE_DISABLED: 'Module đang tắt', NO_ACTIVE_VERSION: 'Không có phiên bản ACTIVE', NO_ROUTE_OR_PERMISSION: 'MIC-04 không có route / quyền IAM',
};
const LEGACY_TEXT: Record<LegacyItem['reason'], string> = {
  FUNCTION_AT_ROOT: 'Chức năng ở gốc', FUNCTION_UNDER_AREA: 'Chức năng ngay dưới vùng', TOO_DEEP: 'Sâu hơn 3 cấp', UNREACHABLE: 'Không nối tới gốc',
};
const ISSUE_TEXT: Record<string, string> = {
  LAYOUT_ITEM_UNKNOWN: 'mục không còn tồn tại', LAYOUT_ITEM_REPEATED: 'mục xuất hiện hai lần', LAYOUT_INCOMPLETE: 'thiếu mục đang lưu',
  LAYOUT_LEVEL_INVALID: 'sai cấp', DEVELOP_AREA_REQUIRED: 'cần đúng một vùng Develop', DEVELOP_AREA_PROTECTED: 'vùng Develop được bảo vệ',
  DEVELOPER_FUNCTION_OUTSIDE_DEVELOP: 'Developer Function ngoài Develop', FUNCTION_DUPLICATE_IN_MENU: 'trùng chức năng trong cùng menu',
  FUNCTION_NOT_ASSIGNABLE: 'chức năng chưa gắn được', FUNCTION_MODULE_MISMATCH: 'chức năng khác module của menu', FUNCTION_CHANGED: 'liên kết đổi chức năng',
};

export function NavigationBuilder({ onSessionLost }: { onSessionLost: () => void }) {
  const { reloadMenu, can, capabilities } = useShellData();
  const [layout, setLayout] = useState<NavigationLayout | null>(null);
  const [inventory, setInventory] = useState<InventoryFunction[] | null>(null);
  const [base, setBase] = useState<BDraft | null>(null);
  const [draft, setDraft] = useState<BDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showHidden, setShowHidden] = useState(true);
  const [filter, setFilter] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ mode: 'design' | 'account'; nodes: MenuNode[] | null } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const facts: Facts = useMemo(() => new Map((inventory ?? []).map((f) => [f.functionId, f])), [inventory]);
  const system = useMemo<NavTreeNode[]>(() => (capabilities === null ? [] : visibleGroups(can).map((g) => ({
    kind: 'menu', id: g.id, title: g.name, icon: g.icon, children: g.children.map((id) => ({ kind: 'function', id, title: SCREENS[id].name, path: SCREENS[id].path })),
  }))), [capabilities, can]);

  const load = useCallback(async () => {
    setBusy(true);
    const [l, f] = await Promise.all([foundationApi.builderLayout(), foundationApi.builderFunctions()]);
    setBusy(false);
    for (const r of [l, f]) {
      if (r.ok) continue;
      if (r.status === 401) return onSessionLost();
      return setFeedback({ tone: 'error', text: describeFailure(r) });
    }
    if (!l.ok || !f.ok) return;
    const d = fromLayout(l.data);
    setLayout(l.data);
    setInventory(f.data);
    setBase(d);
    setDraft(d);
    setConflict(false);
    setServerIssues([]);
    setOpen(new Set(d.areas.filter((a) => a.develop).map((a) => a.key)));
  }, [onSessionLost]);
  useEffect(() => { void load(); }, [load]);

  const changed = draft !== null && base !== null && !sameDraft(draft, base);
  const needsDevelop = layout !== null && layout.developAreaId === null;
  const issues = useMemo(() => (draft ? draftIssues(draft, facts, layout?.legacy ?? []) : []), [draft, facts, layout]);
  const marks = useMemo(() => (draft && base ? changedKeys(base, draft) : new Set<string>()), [draft, base]);
  const issueKeys = useMemo(() => new Set(issues.map((i) => i.key)), [issues]);

  // Unsaved draft: the browser asks before a reload / close; the shell asks before another screen or tab.
  useEffect(() => {
    if (!changed) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    setLeaveGuard(() => window.confirm('Cấu hình điều hướng có thay đổi chưa lưu. Rời màn hình và bỏ các thay đổi?'));
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      setLeaveGuard(null);
    };
  }, [changed]);

  const update = (next: BDraft) => {
    setDraft(next);
    setServerIssues([]);
    setPreview(null);
  };
  const toggle = (key: string) => setOpen((cur) => {
    const next = new Set(cur);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const reveal = (keys: readonly string[]) => setOpen((cur) => new Set([...cur, ...keys]));

  if (!draft || !base || !layout || !inventory) {
    return <><FeedbackLine feedback={feedback} />{busy && <p className="info">Đang tải cấu hình điều hướng…</p>}</>;
  }

  // Narrowed once: the handlers below (hoisted function declarations) use these, never a type assertion.
  const current: BDraft = draft;
  const stored: BDraft = base;
  const sel = selected === null || selected === SYSTEM_KEY ? null : find(draft, selected);
  const selMenu = sel?.kind === 'menu' ? { area: sel.area, menu: sel.menu } : sel?.kind === 'link' ? { area: sel.area, menu: sel.menu } : null;

  // ----------------------------------------------------------------------------------------------- drag & drop (6 cases)
  function plan(d: BDraft, from: Drag, to: Target): DropPlan | null {
    const t = find(d, to.key);
    if (!t) return null;
    if (from.kind === 'fn') {
      if (t.kind === 'area') return { error: 'Kéo chức năng vào một menu (cấp 2) — không đặt chức năng trực tiếp dưới vùng.' };
      const fns = from.ids.flatMap((id) => facts.get(id) ?? []);
      const refused = fns.map((fn) => linkRefusal(facts, t.area, t.menu, fn.functionId, true)).find((r) => r !== null);
      if (refused) return { error: refused };
      return { draft: addLinks(d, t.menu.key, fns, t.kind === 'link' ? t.li : undefined) };
    }
    if (from.key === to.key) return null;
    const f = find(d, from.key);
    if (!f || f.kind !== from.kind) return null;
    if (f.kind === 'area') return t.kind === 'area' ? { draft: moveArea(d, f.area.key, t.ai) } : { error: 'Vùng chỉ đổi thứ tự giữa các vùng.' };
    if (f.kind === 'menu') {
      if (t.kind === 'link') return { error: 'Menu chỉ đặt dưới một vùng (tối đa 3 cấp).' };
      const refused = menuRefusal(facts, f.menu, t.area);
      if (refused) return { error: refused };
      return { draft: t.kind === 'area' ? moveMenu(d, f.menu.key, t.area.key, t.area.menus.length) : moveMenu(d, f.menu.key, t.area.key, t.mi) };
    }
    if (t.kind === 'area') return { error: 'Chức năng chỉ đặt trong một menu (cấp 3).' };
    if (t.menu !== f.menu) {
      const refused = f.link.visible ? linkRefusal(facts, t.area, t.menu, f.link.functionId, true, f.link.key) : facts.get(f.link.functionId)?.developer && !t.area.develop
        ? 'Developer Function chỉ được đặt trong Develop.' : null;
      if (refused) return { error: refused };
    }
    return { draft: moveLink(d, f.link.key, t.menu.key, t.kind === 'link' ? t.li : t.menu.items.length) };
  }
  function dragStart(event: DragEvent, from: Drag) {
    drag.current = from;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', from.kind === 'fn' ? from.ids.join(',') : from.key);
  }
  function dragOver(event: DragEvent, to: Target) {
    if (!drag.current || !draft) return;
    const p = plan(draft, drag.current, to);
    if (p && 'draft' in p) {
      event.preventDefault();
      setDropKey(to.key);
    }
  }
  function drop(event: DragEvent, to: Target) {
    event.preventDefault();
    const from = drag.current;
    drag.current = null;
    setDropKey(null);
    if (!from || !draft) return;
    const p = plan(draft, from, to);
    if (!p) return;
    if ('error' in p) return setFeedback({ tone: 'error', text: p.error });
    update(p.draft);
    reveal([to.key]);
    setFeedback(null);
  }
  // A refused drop explains why (dragover does not accept it, the drop event still reaches the row on some browsers).
  function dragEnter(to: Target) {
    if (!drag.current || !draft) return;
    const p = plan(draft, drag.current, to);
    if (p && 'error' in p) setFeedback({ tone: 'info', text: `Không thả được ở đây: ${p.error}` });
  }
  const dnd = (to: Target) => ({
    onDragOver: (e: DragEvent) => dragOver(e, to), onDrop: (e: DragEvent) => drop(e, to), onDragEnter: () => dragEnter(to),
    onDragLeave: () => setDropKey((k) => (k === to.key ? null : k)),
  });

  // ----------------------------------------------------------------------------------------------- actions
  const applyPlan = (p: DropPlan | null) => {
    if (!p) return;
    if ('error' in p) return setFeedback({ tone: 'error', text: p.error });
    update(p.draft);
    setFeedback(null);
  };
  const shift = (key: string, delta: -1 | 1) => {
    const f = find(draft, key);
    if (!f) return;
    if (f.kind === 'area') return update(moveArea(draft, key, f.ai + (delta < 0 ? -1 : 2)));
    if (f.kind === 'menu') return update(moveMenu(draft, key, f.area.key, f.mi + (delta < 0 ? -1 : 2)));
    update(moveLink(draft, key, f.menu.key, f.li + (delta < 0 ? -1 : 2)));
  };
  const hide = (key: string) => {
    const f = find(draft, key);
    if (f?.kind === 'menu' && f.menu.items.some((l) => l.visible)) return setRemoving(key);
    update(edit(draft, key, { visible: false }));
  };
  const restore = (key: string) => {
    const f = find(draft, key);
    if (f?.kind === 'link') {
      const refused = linkRefusal(facts, f.area, f.menu, f.link.functionId, linkRelinked(f.link, f.menu, f.area), f.link.key);
      if (refused) return setFeedback({ tone: 'error', text: `Không khôi phục được: ${refused}` });
    }
    update(edit(draft, key, { visible: true }));
  };
  function newArea() {
    const r = addArea(current, 'Vùng mới');
    update(r.draft);
    setSelected(r.key);
  }
  function newMenu(areaKey: string) {
    const r = addMenu(current, areaKey, 'Menu mới');
    update(r.draft);
    reveal([areaKey]);
    setSelected(r.key);
  }
  function relocate() {
    const r = relocateDeveloper(current, layout?.legacy ?? [], facts);
    update(r.draft);
    const develop = r.draft.areas.find((a) => a.develop);
    if (develop) reveal([develop.key, ...develop.menus.map((m) => m.key)]);
    setFeedback({ tone: 'info', text: `Đã chuyển ${r.moved} Developer Function vào Develop trong bản nháp${r.skipped ? `; ${r.skipped} mục không chuyển được (chức năng hiện không gắn được) — hãy để ẩn` : ''}. Bấm “Lưu cấu hình” để áp dụng.` });
  }

  async function save() {
    if (busy || !draft) return;
    setBusy(true);
    setFeedback(null);
    setServerIssues([]);
    const r = await foundationApi.builderApply(toPayload(draft));
    setBusy(false);
    if (r.ok) {
      const d = fromLayout(r.data);
      setLayout(r.data);
      setBase(d);
      setDraft(d);
      setSelected(null);
      setPreview(null);
      setFeedback({ tone: 'success', text: 'Đã lưu cấu hình điều hướng. Sidebar đã được tải lại theo cấu hình mới.' });
      await reloadMenu(); // the sidebar follows the stored menu without a new sign-in
      return;
    }
    if (r.status === 401) return onSessionLost();
    if (r.status === 409) setConflict(true);
    setServerIssues(r.details);
    setFeedback({ tone: 'error', text: describeFailure({ ...r, details: [] }) });
  }
  function discard() {
    if (changed && !window.confirm('Bỏ mọi thay đổi chưa lưu và quay về cấu hình đang lưu?')) return;
    update(stored);
    setFeedback({ tone: 'info', text: 'Đã khôi phục cấu hình đang lưu.' });
  }
  async function showPreview(mode: 'design' | 'account') {
    if (mode === 'design') return setPreview({ mode, nodes: null });
    setPreview({ mode, nodes: null });
    const r = await foundationApi.builderPreview(toPayload(current));
    if (r.ok) return setPreview({ mode, nodes: r.data });
    if (r.status === 401) return onSessionLost();
    setServerIssues(r.details);
    setPreview(null);
    setFeedback({ tone: 'error', text: describeFailure({ ...r, details: [] }) });
  }

  // ----------------------------------------------------------------------------------------------- tree
  const q = filter.trim().toLocaleLowerCase('vi');
  const hit = (title: string) => q === '' || title.toLocaleLowerCase('vi').includes(q);
  const devCount = draft.areas.filter((a) => !a.develop).flatMap((a) => a.menus.flatMap((m) => m.items)).filter((l) => l.visible && facts.get(l.functionId)?.developer).length
    + layout.legacy.filter((row) => !row.inDevelop && row.functionId && facts.get(row.functionId)?.developer && draft.legacy.find((l) => l.id === row.id)?.visible).length;

  function rowClass(key: string, visible: boolean, extra = '') {
    return ['nb-row', extra, selected === key && 'selected', !visible && 'hidden-row', dropKey === key && 'drop', issueKeys.has(key) && 'invalid'].filter(Boolean).join(' ');
  }
  const mark = (key: string) => (marks.has(key) ? <span className="nb-dot" title="Thay đổi chưa lưu" aria-label="Thay đổi chưa lưu">●</span> : null);
  const handle = (from: Drag, label: string) => (
    <span className="nb-handle" draggable onDragStart={(e) => dragStart(e, from)} onDragEnd={() => { drag.current = null; setDropKey(null); }} title={`Kéo để di chuyển ${label}`} aria-hidden="true">⋮⋮</span>
  );

  const tree = (
    <ul className="nb-tree" aria-label="Cấu hình điều hướng (bản nháp)">
      {draft.areas.map((area) => {
        const menus = area.menus.filter((m) => (showHidden || m.visible) && (hit(area.title) || hit(m.title) || m.items.some((l) => hit(l.title))));
        if (!showHidden && !area.visible) return null;
        if (q !== '' && !hit(area.title) && menus.length === 0 && !(area.develop && hit('màn hình hệ thống'))) return null;
        const expanded = open.has(area.key) || q !== '';
        return (
          <li key={area.key}>
            <div className={rowClass(area.key, area.visible, 'nb-area')} {...dnd({ kind: 'area', key: area.key })} onClick={() => setSelected(area.key)}>
              {handle({ kind: 'area', key: area.key }, 'vùng')}
              <button type="button" className="nb-twist" aria-expanded={expanded} aria-label={expanded ? `Thu gọn ${area.title}` : `Mở ${area.title}`} onClick={(e) => { e.stopPropagation(); toggle(area.key); }}>{expanded ? '▾' : '▸'}</button>
              <NavIcon name={DEFAULT_MENU_ICON} size={16} />
              <b className="nb-title">{area.title || '(chưa có tiêu đề)'}</b>
              {area.develop && <span className="tag nb-develop">Develop</span>}
              {area.id === null && <span className="tag">mới</span>}
              {!area.visible && <span className="tag">đã gỡ</span>}
              {mark(area.key)}
            </div>
            {expanded && (
              <ul>
                {area.develop && (
                  <li>
                    <div className={rowClass(SYSTEM_KEY, true, 'nb-system')} onClick={() => setSelected(SYSTEM_KEY)}>
                      <span className="nb-handle locked" aria-hidden="true">🔒</span>
                      <b className="nb-title">Màn hình hệ thống</b>
                      <span className="muted">{system.length > 0 ? system.map((s) => s.title).join(' · ') : 'Foundation · IAM'}</span>
                      <span className="tag">cố định</span>
                    </div>
                  </li>
                )}
                {menus.map((menu) => menuRow(area, menu))}
                {menus.length === 0 && !area.develop && <li className="nb-empty muted">Chưa có menu — kéo menu vào đây hoặc bấm “Thêm menu”.</li>}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  function menuRow(area: BArea, menu: BMenu) {
    const expanded = open.has(menu.key) || q !== '';
    const links = menu.items.filter((l) => (showHidden || l.visible) && (q === '' || hit(l.title) || hit(menu.title) || hit(area.title)));
    const mod = menuModule(menu, area);
    return (
      <li key={menu.key}>
        <div className={rowClass(menu.key, menu.visible, 'nb-menu')} {...dnd({ kind: 'menu', key: menu.key })} onClick={() => setSelected(menu.key)}>
          {handle({ kind: 'menu', key: menu.key }, 'menu')}
          <button type="button" className="nb-twist" aria-expanded={expanded} aria-label={expanded ? `Thu gọn ${menu.title}` : `Mở ${menu.title}`} onClick={(e) => { e.stopPropagation(); toggle(menu.key); }}>{expanded ? '▾' : '▸'}</button>
          <NavIcon name={DEFAULT_MENU_ICON} size={15} />
          <b className="nb-title">{menu.title || '(chưa có tiêu đề)'}</b>
          {mod && <span className="muted nb-mod">{moduleKeyOf(mod)}</span>}
          <span className="muted">{menu.items.filter((l) => l.visible).length}</span>
          {menu.id === null && <span className="tag">mới</span>}
          {!menu.visible && <span className="tag">đã gỡ</span>}
          {mark(menu.key)}
        </div>
        {expanded && (
          <ul>
            {links.map((link) => {
              const li = menu.items.indexOf(link);
              const fn = facts.get(link.functionId);
              return (
                <li key={link.key}>
                  <div className={rowClass(link.key, link.visible, 'nb-link')} {...dnd({ kind: 'link', key: link.key })} onClick={() => setSelected(link.key)} data-index={li}>
                    {handle({ kind: 'link', key: link.key }, 'liên kết')}
                    <span className="nb-title">{link.title || '(chưa có tiêu đề)'}</span>
                    <span className="muted nb-mod">{fn ? `${fn.moduleKey} · ${fn.functionKey}` : 'chức năng không còn'}</span>
                    {fn?.developer && <span className="tag nb-dev">Developer</span>}
                    {link.id === null && <span className="tag">mới</span>}
                    {!link.visible && <span className="tag">đã gỡ</span>}
                    {mark(link.key)}
                  </div>
                </li>
              );
            })}
            {links.length === 0 && <li className="nb-empty muted">Chưa có chức năng — kéo từ kho chức năng vào đây.</li>}
          </ul>
        )}
      </li>
    );
  }

  function moduleKeyOf(moduleId: string) {
    return inventory?.find((f) => f.moduleId === moduleId)?.moduleKey ?? 'module';
  }

  // ----------------------------------------------------------------------------------------------- panel
  const allMenus = draft.areas.flatMap((a) => a.menus.map((m) => ({ area: a, menu: m })));
  let panel: ReactNode = <p className="muted">Chọn một vùng, menu hoặc liên kết trong cây để sửa. Kéo ⋮⋮ để di chuyển; kéo chức năng từ kho vào một menu để thêm liên kết.</p>;
  if (selected === SYSTEM_KEY) {
    panel = (
      <div className="nb-panel">
        <h3>Màn hình hệ thống (cố định)</h3>
        <p className="muted">Quản lý Module, Điều hướng, Quản lý tài khoản, Vai trò và quyền là màn hình của nền tảng, không phải Chức năng B03 nên không lưu trong B09.
          Chúng luôn nằm trong vùng Develop và chỉ hiện với tài khoản có quyền tương ứng; vị trí và tiêu đề không chỉnh được ở đây.</p>
      </div>
    );
  } else if (sel?.kind === 'area') {
    const { area, ai } = sel;
    panel = (
      <div className="nb-panel">
        <h3>Vùng {area.develop && <span className="tag nb-develop">Develop</span>}</h3>
        <label>Tiêu đề<input maxLength={MAX_TITLE} value={area.title} onChange={(e) => update(edit(draft, area.key, { title: e.target.value }))} /></label>
        <p className="muted">{area.moduleId ? `Module: ${moduleKeyOf(area.moduleId)} — menu mới trong vùng này thuộc module đó.` : 'Dùng chung mọi module.'} {area.id ? '' : 'Vùng mới — tạo khi Lưu.'}</p>
        {area.develop && <p className="muted">Develop được nhận diện bằng định danh kỹ thuật (không theo tiêu đề): đổi tên, đổi thứ tự được; không gỡ được. Developer Function chỉ đặt ở đây.</p>}
        <div className="fx-toolbar">
          <button type="button" className="fx-btn" disabled={ai === 0} onClick={() => shift(area.key, -1)}>↑ Lên</button>
          <button type="button" className="fx-btn" disabled={ai === draft.areas.length - 1} onClick={() => shift(area.key, 1)}>↓ Xuống</button>
          <button type="button" className="fx-btn" onClick={() => newMenu(area.key)}>+ Thêm menu</button>
          {area.visible
            ? <button type="button" className="fx-btn danger" disabled={area.develop} onClick={() => hide(area.key)}>Gỡ vùng</button>
            : <button type="button" className="fx-btn" onClick={() => restore(area.key)}>Khôi phục</button>}
        </div>
      </div>
    );
  } else if (sel?.kind === 'menu') {
    const { area, menu, mi } = sel;
    panel = (
      <div className="nb-panel">
        <h3>Menu</h3>
        <label>Tiêu đề<input maxLength={MAX_TITLE} value={menu.title} onChange={(e) => update(edit(draft, menu.key, { title: e.target.value }))} /></label>
        <label>Thuộc vùng
          <select value={area.key} onChange={(e) => applyPlan(plan(draft, { kind: 'menu', key: menu.key }, { kind: 'area', key: e.target.value }))}>
            {draft.areas.map((a) => <option key={a.key} value={a.key} disabled={a.key !== area.key && menuRefusal(facts, menu, a) !== null}>{a.title}{a.develop ? ' (Develop)' : ''}</option>)}
          </select>
        </label>
        <p className="muted">{menuModule(menu, area) ? `Module: ${moduleKeyOf(menuModule(menu, area) ?? '')}` : 'Dùng chung mọi module.'} {menu.items.filter((l) => l.visible).length} liên kết đang hiển thị.
          {menu.id !== null && menu.storedArea !== area.id ? ' Đã chuyển vùng: khi Lưu, menu được tạo lại ở vùng mới và menu cũ được ẩn.' : ''}</p>
        <div className="fx-toolbar">
          <button type="button" className="fx-btn" disabled={mi === 0} onClick={() => shift(menu.key, -1)}>↑ Lên</button>
          <button type="button" className="fx-btn" disabled={mi === area.menus.length - 1} onClick={() => shift(menu.key, 1)}>↓ Xuống</button>
          {menu.visible
            ? <button type="button" className="fx-btn danger" onClick={() => hide(menu.key)}>Gỡ menu</button>
            : <button type="button" className="fx-btn" onClick={() => restore(menu.key)}>Khôi phục</button>}
        </div>
      </div>
    );
  } else if (sel?.kind === 'link') {
    const { area, menu, link, li } = sel;
    const fn = facts.get(link.functionId);
    panel = (
      <div className="nb-panel">
        <h3>Liên kết chức năng {fn?.developer && <span className="tag nb-dev">Developer</span>}</h3>
        <label>Tiêu đề trên menu<input maxLength={MAX_TITLE} value={link.title} onChange={(e) => update(edit(draft, link.key, { title: e.target.value }))} /></label>
        {fn && link.title !== fn.displayName && <button type="button" className="fx-btn" onClick={() => update(edit(draft, link.key, { title: fn.displayName.slice(0, MAX_TITLE) }))}>Dùng tên mặc định “{fn.displayName}”</button>}
        <p className="muted">Chức năng: <b>{fn?.displayName ?? '—'}</b> ({fn ? `${fn.moduleKey} · ${fn.functionKey}` : link.functionId}). {link.id ? '' : 'Liên kết mới — tạo khi Lưu.'}
          {linkRelinked(link, menu, area) ? ' Đã chuyển menu: khi Lưu, liên kết được tạo ở menu mới và liên kết cũ được ẩn.' : ''}</p>
        <label>Thuộc menu
          <select value={menu.key} onChange={(e) => applyPlan(plan(draft, { kind: 'link', key: link.key }, { kind: 'menu', key: e.target.value }))}>
            {allMenus.map(({ area: a, menu: m }) => (
              <option key={m.key} value={m.key} disabled={m.key !== menu.key && link.visible && linkRefusal(facts, a, m, link.functionId, true, link.key) !== null}>{a.title} › {m.title}</option>
            ))}
          </select>
        </label>
        <div className="fx-toolbar">
          <button type="button" className="fx-btn" disabled={li === 0} onClick={() => shift(link.key, -1)}>↑ Lên</button>
          <button type="button" className="fx-btn" disabled={li === menu.items.length - 1} onClick={() => shift(link.key, 1)}>↓ Xuống</button>
          {link.visible
            ? <button type="button" className="fx-btn danger" onClick={() => hide(link.key)}>Gỡ khỏi menu</button>
            : <button type="button" className="fx-btn" onClick={() => restore(link.key)}>Khôi phục</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="nb">
      <div className="fx-toolbar nb-bar">
        <button type="button" className="fx-btn primary" disabled={busy || issues.length > 0 || (!changed && !needsDevelop)} onClick={() => void save()}>Lưu cấu hình</button>
        <button type="button" className="fx-btn" disabled={busy || !changed} onClick={discard}>Hủy thay đổi</button>
        <button type="button" className="fx-btn" disabled={busy} onClick={() => void showPreview('design')}>Xem trước</button>
        <button type="button" className="fx-btn" onClick={newArea}>+ Thêm vùng</button>
        {changed ? <span className="nb-unsaved" role="status">● Có thay đổi chưa lưu</span> : needsDevelop ? <span className="nb-unsaved" role="status">Vùng Develop chưa được lưu — bấm “Lưu cấu hình” để tạo.</span> : <span className="muted">Không có thay đổi</span>}
      </div>
      <FeedbackLine feedback={feedback} />
      {conflict && <p className="fx-msg error">Cấu hình đã bị thay đổi ở nơi khác. <button type="button" className="fx-btn" onClick={() => { if (!changed || window.confirm('Tải lại cấu hình mới nhất và bỏ bản nháp hiện tại?')) void load(); }}>Tải lại cấu hình mới nhất</button></p>}
      {serverIssues.length > 0 && (
        <div className="fx-msg error" role="alert"><b>Máy chủ từ chối bản nháp:</b>
          <ul>{serverIssues.slice(0, 20).map((s) => { const [code = '', ref = ''] = s.split(':'); return <li key={s}>{ISSUE_TEXT[code] ?? code} {ref && <small>({ref})</small>}</li>; })}</ul>
        </div>
      )}
      {issues.length > 0 && (
        <div className="fx-msg error" role="alert"><b>Chưa lưu được — cần sửa {issues.length} điểm:</b>
          <ul>{issues.slice(0, 12).map((i, n) => <li key={`${i.key}-${n}`}>{i.key && find(draft, i.key) ? <button type="button" className="nb-linkbtn" onClick={() => setSelected(i.key)}>{i.text}</button> : i.text}</li>)}</ul>
        </div>
      )}
      {devCount > 0 && (
        <div className="fx-msg info nb-devnote" role="note">
          <b>{devCount} Developer Function đang nằm ngoài Develop.</b> {needsDevelop ? 'Sau lần lưu tạo vùng Develop, Sidebar sẽ không hiển thị chúng ở vị trí này' : 'Sidebar không hiển thị chúng ở vị trí này'} (chỉ Develop được phép). Chuyển chúng vào Develop để người có quyền tiếp tục mở được.
          <button type="button" className="fx-btn" onClick={relocate}>Chuyển Developer Function vào Develop</button>
        </div>
      )}
      <div className="nb-panes">
        <section className="nb-left" aria-label="Cây điều hướng">
          <div className="fx-toolbar">
            <input className="nb-search" placeholder="Lọc theo tiêu đề…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Lọc cây theo tiêu đề" />
            <label className="muted"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Hiện mục đã gỡ</label>
            <button type="button" className="fx-btn" onClick={() => setOpen(new Set(draft.areas.flatMap((a) => [a.key, ...a.menus.map((m) => m.key)])))}>Mở tất cả</button>
            <button type="button" className="fx-btn" onClick={() => setOpen(new Set())}>Thu gọn</button>
          </div>
          {tree}
          <LegacyList legacy={layout.legacy} draft={draft} facts={facts} onChange={(id, visible) => update(setLegacy(draft, id, visible))} />
        </section>
        <section className="nb-right" aria-label="Chi tiết và kho chức năng">
          {panel}
          <Inventory
            inventory={inventory}
            draft={draft}
            target={selMenu}
            facts={facts}
            onDragStart={dragStart}
            onAdd={(fns) => {
              if (!selMenu) return;
              const ok = fns.filter((fn) => linkRefusal(facts, selMenu.area, selMenu.menu, fn.functionId, true) === null);
              update(addLinks(draft, selMenu.menu.key, ok));
              reveal([selMenu.area.key, selMenu.menu.key]);
              setFeedback({ tone: 'info', text: `Đã thêm ${ok.length} liên kết vào “${selMenu.menu.title}” trong bản nháp${ok.length < fns.length ? `; ${fns.length - ok.length} chức năng bị bỏ qua (đã có trong menu / không được đặt ở đây)` : ''}.` });
            }}
          />
        </section>
      </div>
      {preview && (
        <section className="fx-section nb-preview" aria-label="Xem trước">
          <div className="fx-toolbar">
            <h3>Xem trước bản nháp</h3>
            <button type="button" className={preview.mode === 'design' ? 'fx-btn primary' : 'fx-btn'} onClick={() => void showPreview('design')}>Cây thiết kế</button>
            <button type="button" className={preview.mode === 'account' ? 'fx-btn primary' : 'fx-btn'} onClick={() => void showPreview('account')}>Theo tài khoản hiện tại</button>
            <button type="button" className="fx-btn" onClick={() => setPreview(null)}>Đóng</button>
          </div>
          {preview.mode === 'design'
            ? <><p className="muted">Toàn bộ mục đang hiển thị của bản nháp (chưa xét quyền).</p><PreviewTree nodes={designTree(draft, system.length > 0)} /></>
            : preview.nodes === null ? <p className="info">Đang tính menu theo quyền IAM và trạng thái module…</p>
              : <><p className="muted">Menu tài khoản đang đăng nhập sẽ thấy sau khi lưu (cùng quy tắc IAM, vòng đời module và Developer như Sidebar).</p><PreviewTree nodes={shellTree(preview.nodes, DEFAULT_MENU_ICON, system)} /></>}
        </section>
      )}
      {removing && (
        <RemoveMenuDialog
          draft={draft}
          menuKey={removing}
          facts={facts}
          onCancel={() => setRemoving(null)}
          onHide={() => { update(edit(draft, removing, { visible: false })); setRemoving(null); }}
          onMove={(target) => {
            const r = moveChildrenAndHide(draft, removing, target);
            update(r.draft);
            setRemoving(null);
            setFeedback({ tone: 'info', text: `Đã chuyển chức năng sang menu khác và gỡ menu trong bản nháp${r.hiddenDuplicates ? `; ${r.hiddenDuplicates} chức năng đã có ở menu đích được chuyển ở trạng thái ẩn` : ''}.` });
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- pieces
function designTree(d: BDraft, withSystem: boolean): NavTreeNode[] {
  return d.areas.filter((a) => a.visible).flatMap((a): NavTreeNode[] => {
    const menus: NavTreeNode[] = a.menus.filter((m) => m.visible).flatMap((m): NavTreeNode[] => {
      const links: NavTreeNode[] = m.items.filter((l) => l.visible).map((l) => ({ kind: 'function', id: l.key, title: l.title, path: null }));
      return links.length > 0 ? [{ kind: 'menu', id: m.key, title: m.title, icon: DEFAULT_MENU_ICON, children: links }] : [];
    });
    const children: NavTreeNode[] = a.develop && withSystem ? [{ kind: 'function', id: SYSTEM_KEY, title: 'Màn hình hệ thống (Foundation, IAM)', path: null }, ...menus] : menus;
    return children.length > 0 ? [{ kind: 'menu', id: a.key, title: a.title, icon: DEFAULT_MENU_ICON, children }] : [];
  });
}

function PreviewTree({ nodes }: { nodes: readonly NavTreeNode[] }) {
  if (nodes.length === 0) return <p className="info">Không có mục nào hiển thị.</p>;
  return (
    <ul className="fx-tree">
      {nodes.map((n) => (
        <li key={n.id}>{n.kind === 'menu' ? <><b>{n.title}</b><PreviewTree nodes={n.children} /></> : n.title}</li>
      ))}
    </ul>
  );
}

interface InventoryProps {
  readonly inventory: readonly InventoryFunction[];
  readonly draft: BDraft;
  readonly target: { area: BArea; menu: BMenu } | null;
  readonly facts: Facts;
  readonly onDragStart: (event: DragEvent, from: Drag) => void;
  readonly onAdd: (fns: InventoryFunction[]) => void;
}

function Inventory({ inventory, draft, target, facts, onDragStart, onAdd }: InventoryProps) {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const modules = [...new Map(inventory.map((f) => [f.moduleId, f])).values()].filter((f) => showTest || !isTestModuleKey(f.moduleKey));
  const q = query.trim().toLocaleLowerCase('vi');
  const rows = inventory.filter((f) => (showTest || !isTestModuleKey(f.moduleKey)) && (!module || f.moduleId === module)
    && (q === '' || `${f.displayName} ${f.functionKey} ${f.moduleKey} ${f.moduleName}`.toLocaleLowerCase('vi').includes(q)));
  // Where each Function is linked now (visible links of the draft).
  const placed = new Map<string, string[]>();
  for (const a of draft.areas) for (const m of a.menus) for (const l of m.items) {
    if (!l.visible || !a.visible || !m.visible) continue;
    placed.set(l.functionId, [...(placed.get(l.functionId) ?? []), `${a.title} › ${m.title}`]);
  }
  const chosen = rows.filter((f) => picked.has(f.functionId));
  const flip = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <div className="nb-inventory">
      <h3>Kho chức năng</h3>
      <div className="fx-toolbar">
        <input className="nb-search" placeholder="Tìm theo tên, mã chức năng, module…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm chức năng" />
        <select value={module} onChange={(e) => setModule(e.target.value)} aria-label="Lọc theo module">
          <option value="">Mọi module</option>
          {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.moduleName || m.moduleKey} ({m.moduleKey})</option>)}
        </select>
        <label className="muted"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Module kiểm thử (FBET_)</label>
      </div>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn primary" disabled={!target || chosen.length === 0} onClick={() => { onAdd(chosen); setPicked(new Set()); }}>
          {target ? `Thêm ${chosen.length} chức năng vào “${target.menu.title}”` : 'Chọn một menu để thêm chức năng'}
        </button>
      </div>
      <ul className="nb-fns">
        {rows.map((f) => {
          const refused = target ? linkRefusal(facts, target.area, target.menu, f.functionId, true) : f.assignable ? null : REASON_TEXT[f.reason ?? ''] ?? 'Không gắn được';
          const inMenu = target?.menu.items.some((l) => l.visible && l.functionId === f.functionId) === true;
          const where = placed.get(f.functionId) ?? [];
          return (
            <li key={f.functionId} className={refused ? 'nb-fn disabled' : 'nb-fn'} draggable={!refused}
              onDragStart={(e) => onDragStart(e, { kind: 'fn', ids: picked.has(f.functionId) ? chosen.map((c) => c.functionId) : [f.functionId] })}>
              <label>
                <input type="checkbox" disabled={refused !== null} checked={picked.has(f.functionId)} onChange={() => flip(f.functionId)} aria-label={`Chọn ${f.displayName}`} />
                <span className="nb-fn-name">{f.displayName}</span>
                <small className="muted">{f.moduleKey} · {f.functionKey}</small>
                {f.developer && <span className="tag nb-dev">Developer</span>}
                {inMenu && <span className="tag">Đã có trong menu</span>}
                {!f.assignable && <span className="tag">{REASON_TEXT[f.reason ?? ''] ?? 'Không gắn được'}</span>}
              </label>
              <small className="muted nb-where">{where.length > 0 ? `Đang gắn: ${where.slice(0, 3).join('; ')}${where.length > 3 ? ` (+${where.length - 3})` : ''}` : 'Chưa gắn menu nào'}
                {refused && !inMenu && f.assignable ? ` — ${refused}` : ''}</small>
            </li>
          );
        })}
        {rows.length === 0 && <li className="muted">Không có chức năng phù hợp.</li>}
      </ul>
    </div>
  );
}

function LegacyList({ legacy, draft, facts, onChange }: { legacy: readonly LegacyItem[]; draft: BDraft; facts: Facts; onChange: (id: string, visible: boolean) => void }) {
  if (legacy.length === 0) return null;
  return (
    <details className="nb-legacy">
      <summary>Cấu trúc cũ ngoài mô hình 3 cấp ({legacy.length}) — giữ nguyên, chỉ đổi hiển thị</summary>
      <p className="muted">Các mục này được tạo trước Navigation Builder (chức năng ở gốc, dưới vùng, hoặc sâu hơn 3 cấp). Không tự xóa; Sidebar vẫn hiển thị chúng nếu đang bật.</p>
      <ul>
        {legacy.map((row) => {
          const visible = draft.legacy.find((l) => l.id === row.id)?.visible ?? row.visible;
          const fn = row.functionId ? facts.get(row.functionId) : undefined;
          const lockShow = fn?.developer === true && !row.inDevelop && !row.visible;
          return (
            <li key={row.id} className={visible ? '' : 'hidden-row'}>
              <span>{row.path.length > 0 ? `${row.path.join(' › ')} › ` : ''}<b>{row.title}</b></span>
              <small className="muted"> {LEGACY_TEXT[row.reason]}{fn ? ` · ${fn.moduleKey} · ${fn.functionKey}` : row.kind === 'group' ? ' · nhóm' : ''}</small>
              {fn?.developer && <span className="tag nb-dev">Developer</span>}
              {visible
                ? <button type="button" className="fx-btn" onClick={() => onChange(row.id, false)}>Ẩn</button>
                : <button type="button" className="fx-btn" disabled={lockShow} title={lockShow ? 'Developer Function chỉ hiện trong Develop' : undefined} onClick={() => onChange(row.id, true)}>Hiện</button>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

interface RemoveProps {
  readonly draft: BDraft;
  readonly menuKey: string;
  readonly facts: Facts;
  readonly onCancel: () => void;
  readonly onHide: () => void;
  readonly onMove: (target: string) => void;
}

function RemoveMenuDialog({ draft, menuKey, facts, onCancel, onHide, onMove }: RemoveProps) {
  const [mode, setMode] = useState<'hide' | 'move'>('hide');
  const f = find(draft, menuKey);
  const menu = f?.kind === 'menu' ? f.menu : null;
  const visibleLinks = menu?.items.filter((l) => l.visible) ?? [];
  // A target must accept every visible link (Developer / module rules); duplicates are moved hidden, never shown twice.
  const targets = draft.areas.flatMap((a) => a.menus.filter((m) => m.key !== menuKey && m.visible).map((m) => ({ area: a, menu: m })))
    .filter(({ area, menu: m }) => visibleLinks.every((l) => {
      const r = linkRefusal(facts, area, m, l.functionId, true);
      return r === null || r === 'Đã có trong menu.';
    }));
  const [target, setTarget] = useState(targets[0]?.menu.key ?? '');
  const dest = targets.find((t) => t.menu.key === target)?.menu;
  const dups = dest ? visibleLinks.filter((l) => dest.items.some((x) => x.visible && x.functionId === l.functionId)).length : 0;
  if (!menu) return null;
  return (
    <div className="nb-dialog-backdrop">
      <div className="nb-dialog" role="dialog" aria-modal="true" aria-label={`Gỡ menu ${menu.title}`}>
        <h3>Gỡ menu “{menu.title}”</h3>
        <p>Menu đang có {visibleLinks.length} chức năng hiển thị. Chọn cách xử lý (áp dụng khi Lưu; không xóa dữ liệu):</p>
        <label className="nb-choice"><input type="radio" name="nb-remove" checked={mode === 'hide'} onChange={() => setMode('hide')} /> Ẩn cả nhánh (menu bị ẩn nên mọi chức năng bên trong không còn hiển thị)</label>
        <label className="nb-choice"><input type="radio" name="nb-remove" checked={mode === 'move'} disabled={targets.length === 0} onChange={() => setMode('move')} /> Chuyển các chức năng sang menu khác rồi ẩn menu này</label>
        {mode === 'move' && (
          <label className="nb-choice">Menu đích
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {targets.map(({ area, menu: m }) => <option key={m.key} value={m.key}>{area.title} › {m.title}</option>)}
            </select>
          </label>
        )}
        {mode === 'move' && dups > 0 && <p className="fx-msg info">{dups} chức năng đã có trong menu đích: được chuyển sang ở trạng thái ẩn (không tạo mục trùng).</p>}
        {targets.length === 0 && <p className="muted">Không có menu nào nhận được toàn bộ chức năng này (quy tắc Developer / module).</p>}
        <div className="fx-toolbar">
          <button type="button" className="fx-btn primary" disabled={mode === 'move' && !target} onClick={() => (mode === 'hide' ? onHide() : onMove(target))}>Áp dụng vào bản nháp</button>
          <button type="button" className="fx-btn" onClick={onCancel}>Hủy</button>
        </div>
      </div>
    </div>
  );
}
