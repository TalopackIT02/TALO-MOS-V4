import type { AccountSummary } from '../services/auth/authApi';

// AppShell copy that is not part of the auth P-11 messages. The company name is display text from the approved HTML;
// there is no company or branch selection (FND-02).

export const SHELL_TEXT = {
  company: 'Công ty TNHH Tăng Long Pack',
  logout: 'Đăng xuất',
  personal: 'Cá nhân',
  username: 'Tên đăng nhập',
} as const;

// fullName comes from the session; it may be empty, then the username is shown.
export function displayName(account: AccountSummary): string {
  return account.fullName.trim() || account.username;
}

export function accountInitial(account: AccountSummary): string {
  return displayName(account).charAt(0).toLocaleUpperCase('vi');
}
