// AppShell administration screens (frontend only). They are NOT the business menu: the business menu comes from
// GET /api/foundation/navigation, filtered by the backend (enabled module, ACTIVE version, effective IAM grant).
// FE-01: Foundation screens are connected to the Foundation API; the server decides every permission (403 shown as is).
// IAM screens use the IAM Management API (TALO-IAM-NEXT).

import { INSTALLED, moduleScreens } from './moduleScreens';
import type { ModuleScreen } from './moduleScreens';

// MOD-TEST-02: module screens come from the installed packages (routes/moduleScreens.ts), not from this file. They are
// reached from the Foundation menu (GET /api/foundation/navigation) and never listed in the sidebar or the screen search.
export type AdminScreenId = 'home' | 'module' | 'navigation' | 'accounts' | 'roles';
export type ScreenId = AdminScreenId | ModuleScreen['id'];
export type GroupId = 'foundation' | 'iam';

export interface ShellScreen {
  readonly id: ScreenId;
  readonly path: string;
  readonly name: string;
  readonly desc: string;
  readonly tabs: readonly string[];
}

export interface NavGroup {
  readonly id: GroupId;
  readonly name: string;
  readonly icon: string; // key of the navigation icon library (public/assets/icons/navigation/<key>.svg)
  readonly children: readonly AdminScreenId[];
}

export const SCREENS = {
  home: { id: 'home', path: '/', name: 'Trang chủ', desc: 'Chức năng nghiệp vụ được cấp cho tài khoản và các màn hình quản trị nền tảng.', tabs: ['Chức năng của tôi'] },
  module: { id: 'module', path: '/foundation/modules', name: 'Quản lý Module', desc: 'Đăng ký module, quản lý phiên bản, hồ sơ MIC và vòng đời phê duyệt – kích hoạt.', tabs: ['Module & Phiên bản', 'Đăng ký Module'] },
  navigation: { id: 'navigation', path: '/foundation/navigation', name: 'Điều hướng', desc: 'Nơi duy nhất cấu hình menu (B09): vùng → menu → chức năng, kéo-thả, một chức năng ở nhiều menu, vùng Develop; chỉnh trên bản nháp và lưu một lần.', tabs: ['Menu của tôi', 'Quản trị menu (B09)'] },
  accounts: { id: 'accounts', path: '/iam/accounts', name: 'Quản lý tài khoản', desc: 'Tạo tài khoản, khóa / vô hiệu hóa, cấp lại mật khẩu tạm, phiên đăng nhập; vai trò, quyền trực tiếp, quyền hiệu lực và nhật ký IAM.', tabs: ['Danh sách tài khoản', 'Nhật ký IAM'] },
  roles: { id: 'roles', path: '/iam/roles', name: 'Vai trò và quyền', desc: 'Vai trò và quyền theo cây Module → Chức năng → Thao tác; danh mục permission theo MIC-07. Menu (B09) quản lý tại Foundation › Điều hướng.', tabs: ['Vai trò', 'Danh mục Permission'] },
} as const satisfies Record<AdminScreenId, ShellScreen>;

const ADMIN_LIST: readonly ShellScreen[] = Object.values(SCREENS);
// Installed module screens (a path already used by the shell is refused).
export const MODULE_SCREENS: readonly ModuleScreen[] = moduleScreens(INSTALLED, new Set(ADMIN_LIST.map((s) => s.path)));
// Every tab path of a module screen: same screen, tab = index (tab 0 = the screen path).
const SUB_ROUTES = MODULE_SCREENS.flatMap((m) => m.tabPaths.map((path, tab) => ({ path, screen: m.id, tab })));

// A path of an administration screen or of an installed module tab (validated by toShellPath / shellPathOf).
export type ShellPath = string;

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'foundation', name: 'Foundation', icon: 'settings', children: ['module', 'navigation'] },
  { id: 'iam', name: 'IAM · Tài khoản và quyền', icon: 'shield-lock', children: ['accounts', 'roles'] },
];

const SCREEN_LIST: readonly ShellScreen[] = [...ADMIN_LIST, ...MODULE_SCREENS];

export function screenById(id: ScreenId): ShellScreen {
  return SCREEN_LIST.find((s) => s.id === id) ?? SCREENS.home;
}

// IAM-B-UI-01: account management workspace /iam/accounts/:accountId — a page of the "accounts" screen (same access
// rule), opened from the account list. Only a UUID is accepted; anything else is not a shell path (→ home).
const ACCOUNT_WORKSPACE = /^\/iam\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function accountWorkspacePath(accountId: string): ShellPath {
  return `${SCREENS.accounts.path}/${accountId.toLowerCase()}`;
}

// The account of a workspace path, or null.
export function accountIdOfPath(path: string): string | null {
  return ACCOUNT_WORKSPACE.exec(path)?.[1]?.toLowerCase() ?? null;
}

export function screenOfPath(path: string): ShellScreen | undefined {
  if (accountIdOfPath(path) !== null) return SCREENS.accounts;
  const sub = SUB_ROUTES.find((r) => r.path === path);
  return sub ? screenById(sub.screen) : SCREEN_LIST.find((screen) => screen.path === path);
}

// Tab opened by a path (0 for a screen path).
export function tabOfPath(path: string): number {
  return SUB_ROUTES.find((r) => r.path === path)?.tab ?? 0;
}

// Path of a tab of a screen that has sub-routes (the screen path for tab 0 or a screen without sub-routes).
export function pathOfTab(id: ScreenId, tab: number): ShellPath {
  return SUB_ROUTES.find((r) => r.screen === id && r.tab === tab)?.path ?? screenById(id).path;
}

// A menu route (B09 / MIC-04) the shell can open, or undefined.
export function shellPathOf(path: string): ShellPath | undefined {
  return SUB_ROUTES.find((r) => r.path === path)?.path;
}

// Any path that is not a shell screen (including /login and /first-change for an authenticated session) opens home.
export function toShellPath(path: string): ShellPath {
  const accountId = accountIdOfPath(path);
  if (accountId !== null) return accountWorkspacePath(accountId);
  // FIX-02: /iam/accounts/<not a UUID> opens the account list (the screen's own guard applies), not a stray page.
  if (path.startsWith(`${SCREENS.accounts.path}/`)) return SCREENS.accounts.path;
  return SUB_ROUTES.find((r) => r.path === path)?.path ?? SCREEN_LIST.find((screen) => screen.path === path)?.path ?? SCREENS.home.path;
}

export function groupOf(id: ScreenId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.children.some((child) => child === id));
}

// ------------------------------------------------------------------------------------------------- WS06 screen access
// Screen → permission(s) that open it (any one), and per tab. The values are the codes evaluated for the session by
// GET /api/iam/admin/me/capabilities (evaluateAccess()); the API of each screen checks the same permissions again, so
// this only decides what is SHOWN (menu, home cards, search, breadcrumb, direct URL) — never what is allowed.
//   module     → foundation.module_registry.read      (tab "Đăng ký Module" → foundation.module_registry.create)
//   navigation → foundation.navigation.manage         (GET/POST/PATCH B09 items)
//   accounts   → iam.accounts.read | iam.audit.read     (tab 0 list / detail: accounts.read; tab 1 IAM audit: audit.read;
//                actions: accounts.create, accounts.manage, credentials.reissue, sessions.manage, assignments.manage)
//   roles      → iam.roles.manage | iam.permissions.manage | iam.assignments.manage (catalog reads accept any of them)
type Can = (code: string) => boolean;
const ROLES_ANY = ['iam.roles.manage', 'iam.permissions.manage', 'iam.assignments.manage'] as const;
export const SCREEN_ACCESS: Readonly<Record<Exclude<AdminScreenId, 'home'>, { readonly open: readonly string[]; readonly tabs: readonly (readonly string[])[] }>> = {
  module: { open: ['foundation.module_registry.read'], tabs: [['foundation.module_registry.read'], ['foundation.module_registry.create']] },
  navigation: { open: ['foundation.navigation.manage'], tabs: [['foundation.navigation.manage'], ['foundation.navigation.manage']] },
  accounts: { open: ['iam.accounts.read', 'iam.audit.read'], tabs: [['iam.accounts.read'], ['iam.audit.read']] },
  roles: { open: ROLES_ANY, tabs: [ROLES_ANY, ROLES_ANY] },
};

const isAdminScreen = (id: ScreenId): id is Exclude<AdminScreenId, 'home'> => id === 'module' || id === 'navigation' || id === 'accounts' || id === 'roles';

// Whether an ADMIN screen may be shown (home always; module screens are decided by the menu — see AppShell).
export function canOpenAdmin(id: ScreenId, can: Can): boolean {
  if (id === 'home') return true;
  return isAdminScreen(id) && SCREEN_ACCESS[id].open.some(can);
}

// Indexes of the tabs of an admin screen that may be shown.
export function adminTabs(id: ScreenId, can: Can): number[] {
  if (!isAdminScreen(id)) return screenById(id).tabs.map((_, i) => i);
  return SCREEN_ACCESS[id].tabs.flatMap((codes, i) => (codes.some(can) ? [i] : []));
}

// Admin groups with only the screens the session may open (an empty group is not shown).
export function visibleGroups(can: Can): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, children: g.children.filter((id) => canOpenAdmin(id, can)) })).filter((g) => g.children.length > 0);
}

// Search target: an allowed admin screen or a business menu entry (built by AppShell from the filtered lists).
export interface SearchTarget {
  readonly name: string;
  readonly path: ShellPath;
}

// Client-side screen search: first target whose name contains the query (only targets the session may open).
export function findTarget(query: string, targets: readonly SearchTarget[]): SearchTarget | undefined {
  const q = query.trim().toLocaleLowerCase('vi');
  if (!q) return undefined;
  return targets.find((t) => t.name.toLocaleLowerCase('vi').includes(q));
}
