// AppShell administration screens (frontend only). They are NOT the business menu: the business menu comes from
// GET /api/foundation/navigation, filtered by the backend (enabled module, ACTIVE version, effective IAM grant).
// FE-01: Foundation screens are connected to the Foundation API; the server decides every permission (403 shown as is).
// IAM screens stay informational until an IAM administration API exists.

// MOD-TEST-01: module screens (systemTest) are not administration screens: they are reached from the Foundation menu
// (GET /api/foundation/navigation) and never listed in the sidebar or the screen search.
export type ScreenId = 'home' | 'module' | 'navigation' | 'accounts' | 'roles' | 'systemTest';
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
  readonly children: readonly ScreenId[];
}

export const SCREENS = {
  home: { id: 'home', path: '/', name: 'Trang chủ', desc: 'Chức năng nghiệp vụ được cấp cho tài khoản và các màn hình quản trị nền tảng.', tabs: ['Chức năng của tôi'] },
  module: { id: 'module', path: '/foundation/modules', name: 'Quản lý Module', desc: 'Đăng ký module, quản lý phiên bản, hồ sơ MIC và vòng đời phê duyệt – kích hoạt.', tabs: ['Module & Phiên bản', 'Đăng ký Module'] },
  navigation: { id: 'navigation', path: '/foundation/navigation', name: 'Điều hướng', desc: 'Cây menu ứng dụng do Foundation quản lý, lọc theo quyền IAM của từng tài khoản.', tabs: ['Menu của tôi', 'Quản trị menu'] },
  accounts: { id: 'accounts', path: '/iam/accounts', name: 'Quản lý tài khoản', desc: 'Chưa triển khai: chưa có API quản trị tài khoản IAM.', tabs: ['Danh sách tài khoản'] },
  roles: { id: 'roles', path: '/iam/roles', name: 'Vai trò và quyền', desc: 'Chưa triển khai: chưa có API quản trị vai trò và quyền IAM.', tabs: ['Danh sách vai trò'] },
  systemTest: {
    id: 'systemTest', path: '/system-test', name: 'System Test & Diagnostics',
    desc: 'Chẩn đoán hệ thống, xem dữ liệu Foundation ở chế độ chỉ đọc và kết quả kiểm thử. Quyền do máy chủ quyết định.',
    tabs: ['Kiểm tra hệ thống', 'Xem bảng dữ liệu', 'Chạy test & xem kết quả'],
  },
} as const satisfies Record<ScreenId, ShellScreen>;

// Sub-routes of a module screen (MIC-04 routes of SYSTEM_TEST): same screen, another tab.
const SUB_ROUTES = [
  { path: '/system-test/data', screen: 'systemTest', tab: 1 },
  { path: '/system-test/runner', screen: 'systemTest', tab: 2 },
] as const;
const MODULE_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(['systemTest']);

export type ShellPath = (typeof SCREENS)[ScreenId]['path'] | (typeof SUB_ROUTES)[number]['path'];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'foundation', name: 'Foundation', icon: '⚙', children: ['module', 'navigation'] },
  { id: 'iam', name: 'IAM · Tài khoản và quyền', icon: '♙', children: ['accounts', 'roles'] },
];

const SCREEN_LIST = Object.values(SCREENS);

export function screenOfPath(path: string): ShellScreen | undefined {
  const sub = SUB_ROUTES.find((r) => r.path === path);
  return sub ? SCREENS[sub.screen] : SCREEN_LIST.find((screen) => screen.path === path);
}

// Tab opened by a path (0 for a screen path).
export function tabOfPath(path: string): number {
  return SUB_ROUTES.find((r) => r.path === path)?.tab ?? 0;
}

// Path of a tab of a screen that has sub-routes (the screen path for tab 0 or a screen without sub-routes).
export function pathOfTab(id: ScreenId, tab: number): ShellPath {
  return SUB_ROUTES.find((r) => r.screen === id && r.tab === tab)?.path ?? SCREENS[id].path;
}

// A menu route (B09 / MIC-04) the shell can open, or undefined.
export function shellPathOf(path: string): ShellPath | undefined {
  return SUB_ROUTES.find((r) => r.path === path)?.path ?? SCREEN_LIST.find((screen) => MODULE_SCREENS.has(screen.id) && screen.path === path)?.path;
}

// Any path that is not a shell screen (including /login and /first-change for an authenticated session) opens home.
export function toShellPath(path: string): ShellPath {
  return SUB_ROUTES.find((r) => r.path === path)?.path ?? SCREEN_LIST.find((screen) => screen.path === path)?.path ?? SCREENS.home.path;
}

export function groupOf(id: ScreenId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.children.includes(id));
}

// Client-side screen search of the approved HTML: first screen whose name contains the query.
export function findScreen(query: string): ShellScreen | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return SCREEN_LIST.find((screen) => !MODULE_SCREENS.has(screen.id) && screen.name.toLowerCase().includes(q));
}
