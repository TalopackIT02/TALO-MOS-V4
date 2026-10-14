import { useState } from 'react';
import logoUrl from '../../assets/images/talopack-logo.png';
import warehouseUrl from '../../assets/images/warehouse-illustration.png';
import { authApi } from '../../services/auth/authApi';
import type { AccountSummary } from '../../services/auth/authApi';
import type { UiMessage } from '../../services/auth/errorMessages';
import { t } from '../../services/auth/messages';
import '../../styles/auth-first-change.css';

// Minimal screen confirming an Authenticated Session (no AppShell, no business module). Uses the First Change shell.

export interface WelcomePageProps {
  readonly account: AccountSummary;
  readonly onLoggedOut: (flash: UiMessage) => void;
}

export function WelcomePage({ account, onLoggedOut }: WelcomePageProps) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    const result = await authApi.logout();
    setBusy(false);
    onLoggedOut(result.ok ? { text: t('LOGOUT.DONE'), tone: 'info' } : { text: t('LOGOUT.FAILED'), tone: 'error' });
  }

  return (
    <div className="auth-first-change-page">
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="welcome-title">
          <img className="logo" src={logoUrl} alt="TALOPACK" />
          <h1 id="welcome-title">{t('WELCOME.TITLE')}</h1>
          <p className="subtitle">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7.2" r="4.1" /><path d="M3.2 21v-2.2c0-4 3.8-6.6 8.8-6.6s8.8 2.6 8.8 6.6V21Z" /></svg>
            <span id="welcome-greeting">{t('WELCOME.GREETING', { fullName: account.fullName })} (<strong>{account.username}</strong>)</span>
          </p>
          <div className="after">
            <p className="welcome-note">{t('WELCOME.NOTE')}</p>
            <button className="login-button" type="button" id="welcome-logout" disabled={busy} onClick={() => void logout()}>
              {busy ? t('LOGOUT.LOADING') : t('WELCOME.LOGOUT')}
            </button>
          </div>
          <footer className="footer">© 2026 TALOPACK</footer>
        </section>
        <aside className="illustration" aria-label="Minh họa nhà kho TALOPACK"><img src={warehouseUrl} alt="Nhà kho và hoạt động vận chuyển TALOPACK" /></aside>
      </main>
    </div>
  );
}
