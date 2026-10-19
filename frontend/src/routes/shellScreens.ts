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
  readonly icon: string;
  readonly children: readonly AdminScreenId[];
}

export const SCREENS = {
  home: { id: 'home', path: '/', name: 'Trang chủ', desc: 'Chức năng nghiệp vụ được cấp cho tài khoản và các màn hình quản trị nền tảng.', tabs: ['Chức năng của tôi'] },
  module: { id: 'module', path: '/foundation/modules', name: 'Quản lý Module', desc: 'Đăng ký module, quản lý phiên bản, hồ sơ MIC và vòng đời phê duyệt – kích hoạt.', tabs: ['Module & Phiên bản', 'Đăng ký Module'] },
  navigation: { id: 'navigation', path: '/foundation/navigation', name: 'Điều hướng', desc: 'Cây menu ứng dụng do Foundation quản lý, lọc theo quyền IAM của từng tài khoản.', tabs: ['Menu của tôi', 'Quản trị menu'] },
  accounts: { id: 'accounts', path: '/iam/accounts', name: 'Quản lý tài khoản', desc: 'Tìm tài khoản, xem vai trò, quyền trực tiếp và quyền hiệu lực; gán và thu hồi.', tabs: ['Danh sách tài khoản'] },
  roles: { id: 'roles', path: '/iam/roles', name: 'Vai trò và quyền', desc: 'Vai trò và permission của vai trò, danh mục permission theo MIC-07, mục menu chức năng (B09).', tabs: ['Vai trò', 'Danh mục Permission', 'Menu chức năng (B09)'] },
} as const satisfies Record<AdminScreenId, ShellScreen>;

const ADMIN_LIST: readonly ShellScreen[] = Object.values(SCREENS);
// Installed module screens (a path already used by the shell is refused).
export const MODULE_SCREENS: readonly ModuleScreen[] = moduleScreens(INSTALLED, new Set(ADMIN_LIST.map((s) => s.path)));
// Every tab path of a module screen: same screen, tab = index (tab 0 = the screen path).
const SUB_ROUTES = MODULE_SCREENS.flatMap((m) => m.tabPaths.map((path, tab) => ({ path, screen: m.id, tab })));

// A path of an administration screen or of an installed module tab (validated by toShellPath / shellPathOf).
export type ShellPath = string;

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'foundation', name: 'Foundation', icon: '⚙', children: ['module', 'navigation'] },
  { id: 'iam', name: 'IAM · Tài khoản và quyền', icon: '♙', children: ['accounts', 'roles'] },
];

const SCREEN_LIST: readonly ShellScreen[] = [...ADMIN_LIST, ...MODULE_SCREENS];

export function screenById(id: ScreenId): ShellScreen {
  return SCREEN_LIST.find((s) => s.id === id) ?? SCREENS.home;
}

export function screenOfPath(path: string): ShellScreen | undefined {
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
  return SUB_ROUTES.find((r) => r.path === path)?.path ?? SCREEN_LIST.find((screen) => screen.path === path)?.path ?? SCREENS.home.path;
}

export function groupOf(id: ScreenId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.children.some((child) => child === id));
}

// Client-side screen search of the approved HTML: first screen whose name contains the query.
export function findScreen(query: string): ShellScreen | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return ADMIN_LIST.find((screen) => screen.name.toLowerCase().includes(q));
}
