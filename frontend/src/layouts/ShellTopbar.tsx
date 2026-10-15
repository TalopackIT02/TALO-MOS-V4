import { useState } from 'react';
import nameUrl from '../assets/images/talopack-name.png';
import symbolUrl from '../assets/images/talopack-symbol.png';
import { findScreen } from '../routes/shellScreens';
import type { ScreenId } from '../routes/shellScreens';
import type { AccountSummary } from '../services/auth/authApi';
import { t } from '../services/auth/messages';
import { accountInitial, displayName, SHELL_TEXT } from './shellText';

// Topbar: brand zone (same width as the sidebar), company name (display text only — no company selection), screen
// search, and the signed-in account from the session with its menu (logout).

export interface ShellTopbarProps {
  readonly account: AccountSummary;
  readonly menuOpen: boolean;
  readonly loggingOut: boolean;
  readonly onToggleMenu: () => void;
  readonly onSearch: (id: ScreenId) => void;
  readonly onLogout: () => void;
}

export function ShellTopbar({ account, menuOpen, loggingOut, onToggleMenu, onSearch, onLogout }: ShellTopbarProps) {
  const [query, setQuery] = useState('');
  const name = displayName(account);

  return (
    <header className="top">
      <div className="brand-zone">
        <div className="brand">
          <img className="brand-symbol" src={symbolUrl} alt="Biểu tượng Tăng Long Pack" />
          <img className="brand-name" src={nameUrl} alt="TALOPACK" />
        </div>
      </div>
      <div className="top-main">
        <div className="company">{SHELL_TEXT.company}</div>
        <div className="grow" />
        <input
          className="search"
          type="search"
          id="search"
          placeholder="Tìm kiếm màn hình..."
          aria-label="Tìm màn hình"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            const screen = findScreen(event.target.value);
            if (screen) onSearch(screen.id);
          }}
        />
        <div className="user-menu">
          <button type="button" className="user" id="account-button" aria-haspopup="true" aria-expanded={menuOpen} onClick={onToggleMenu}>
            <span className="avatar" aria-hidden="true">{accountInitial(account)}</span>
            <span className="user-text"><strong id="account-name">{name}</strong><small id="account-username">{account.username}</small></span>
          </button>
          {menuOpen && (
            <div className="account-menu" id="account-menu">
              <strong>{name}</strong>
              <small>{account.username}</small>
              <button type="button" id="account-logout" disabled={loggingOut} onClick={onLogout}>
                {loggingOut ? t('LOGOUT.LOADING') : SHELL_TEXT.logout}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
