// TASK F1 navigation, declared in the frontend only and copied from the approved TALO-MOS-V4-Appshell.html.
// It is NOT a module registry: it does not mean that a module is registered, enabled or granted to the account
// (MOD-03 / IAM-04). Menu visibility by effective grants needs an IAM API that does not exist yet (BLOCKED).

export type ScreenId = 'home' | 'module' | 'capability' | 'accounts' | 'roles';
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
  home: { id: 'home', path: '/', name: 'Trang chủ', desc: 'Điều hướng đến những màn hình nền tảng đang được ưu tiên triển khai.', tabs: ['Màn hình ưu tiên'] },
  module: { id: 'module', path: '/foundation/modules', name: 'Quản lý Module', desc: 'Tiếp nhận và quản lý thông tin module được đăng ký với Foundation.', tabs: ['Danh sách Module', 'Thông tin khai báo'] },
  capability: { id: 'capability', path: '/foundation/capabilities', name: 'Quản lý chức năng', desc: 'Quản lý danh mục chức năng và hành động do module công bố.', tabs: ['Cây chức năng', 'Danh sách Action'] },
  accounts: { id: 'accounts', path: '/iam/accounts', name: 'Quản lý tài khoản', desc: 'Giao diện quản trị tài khoản thuộc IAM, chưa kết nối dữ liệu thực.', tabs: ['Danh sách tài khoản', 'Chi tiết tài khoản'] },
  roles: { id: 'roles', path: '/iam/roles', name: 'Vai trò và quyền', desc: 'Giao diện quản trị vai trò và quyền truy cập ứng dụng.', tabs: ['Danh sách vai trò', 'Phân quyền'] },
} as const satisfies Record<ScreenId, ShellScreen>;

export type ShellPath = (typeof SCREENS)[ScreenId]['path'];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'foundation', name: 'Foundation', icon: '⚙', children: ['module', 'capability'] },
  { id: 'iam', name: 'IAM · Tài khoản và quyền', icon: '♙', children: ['accounts', 'roles'] },
];

const SCREEN_LIST = Object.values(SCREENS);

export function screenOfPath(path: string): ShellScreen | undefined {
  return SCREEN_LIST.find((screen) => screen.path === path);
}

// Any path that is not a shell screen (including /login and /first-change for an authenticated session) opens home.
export function toShellPath(path: string): ShellPath {
  return SCREEN_LIST.find((screen) => screen.path === path)?.path ?? SCREENS.home.path;
}

export function groupOf(id: ScreenId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.children.includes(id));
}

// Client-side screen search of the approved HTML: first screen whose name contains the query.
export function findScreen(query: string): ShellScreen | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return SCREEN_LIST.find((screen) => screen.name.toLowerCase().includes(q));
}
