import type { ScreenId } from '../routes/shellScreens';
import type { AccountSummary } from '../services/auth/authApi';
import { t } from '../services/auth/messages';
import { displayName, SHELL_TEXT } from './shellText';

// Mobile only (≤ 760px, hidden by CSS on desktop): bottom navigation with exactly three icons — Menu (drawer),
// Trang chủ, Cá nhân (account panel with logout).

export interface MobileBottomNavProps {
  readonly screenId: ScreenId;
  readonly menuOpen: boolean;
  readonly accountOpen: boolean;
  readonly onMenu: () => void;
  readonly onHome: () => void;
  readonly onAccount: () => void;
}

export function MobileBottomNav({ screenId, menuOpen, accountOpen, onMenu, onHome, onAccount }: MobileBottomNavProps) {
  const homeActive = screenId === 'home' && !menuOpen && !accountOpen;
  return (
    <nav className="mobile-bottom-nav" aria-label="Điều hướng điện thoại">
      <button id="mobileBottomMenu" type="button" className={menuOpen ? 'active' : undefined} onClick={onMenu} aria-label="Menu" title="Menu" aria-expanded={menuOpen}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <button id="mobileBottomHome" type="button" className={homeActive ? 'active' : undefined} onClick={onHome} aria-label="Trang chủ" title="Trang chủ">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7" /></svg>
      </button>
      <button id="mobileBottomAccount" type="button" className={accountOpen ? 'active' : undefined} onClick={onAccount} aria-label="Cá nhân" title="Cá nhân" aria-expanded={accountOpen}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>
      </button>
    </nav>
  );
}

export interface MobileAccountPanelProps {
  readonly account: AccountSummary;
  readonly open: boolean;
  readonly loggingOut: boolean;
  readonly onLogout: () => void;
}

export function MobileAccountPanel({ account, open, loggingOut, onLogout }: MobileAccountPanelProps) {
  return (
    <div className={open ? 'mobile-account-panel open' : 'mobile-account-panel'} id="mobileAccountPanel" aria-hidden={!open}>
      <strong>{SHELL_TEXT.personal}</strong>
      <p>{displayName(account)}<br />{SHELL_TEXT.username}: {account.username}</p>
      <button type="button" className="account-logout" id="mobile-logout" disabled={loggingOut} onClick={onLogout}>
        {loggingOut ? t('LOGOUT.LOADING') : SHELL_TEXT.logout}
      </button>
    </div>
  );
}
