import { useCallback, useEffect, useState } from 'react';
import { FirstChangePage } from './pages/auth/FirstChangePage';
import { LoginPage } from './pages/auth/LoginPage';
import { WelcomePage } from './pages/auth/WelcomePage';
import { pushPath, replacePath, usePopState } from './routes/navigation';
import type { AppPath } from './routes/navigation';
import { authApi } from './services/auth/authApi';
import type { AccountSummary, SessionInfo } from './services/auth/authApi';
import { messageForFailure } from './services/auth/errorMessages';
import type { UiMessage } from './services/auth/errorMessages';

// Screen selection follows the server session (AUTH-API-v1 §6): GET /api/auth/session once at start and on
// back/forward navigation — never polled.

export type AuthView =
  | { kind: 'loading' }
  | { kind: 'login'; flash?: UiMessage }
  | { kind: 'first-change'; username: string; remainingMs: number }
  | { kind: 'welcome'; account: AccountSummary };

function viewOf(session: SessionInfo): AuthView {
  if (session.status === 'AUTHENTICATED') return { kind: 'welcome', account: session.account };
  // D-UI-2: remaining time from expiresAt − serverTime (both PostgreSQL time), never from the client clock.
  const remainingMs = Math.max(0, Date.parse(session.expiresAt) - Date.parse(session.serverTime));
  return { kind: 'first-change', username: session.account.username, remainingMs };
}

const PATH: Record<Exclude<AuthView['kind'], 'loading'>, AppPath> = { login: '/login', 'first-change': '/first-change', welcome: '/' };

export function App() {
  const [view, setView] = useState<AuthView>({ kind: 'loading' });

  const checkSession = useCallback(async () => {
    const result = await authApi.session();
    if (result.ok) setView(viewOf(result.data));
    else if (result.status === 401) setView({ kind: 'login' });
    else setView({ kind: 'login', flash: messageForFailure('session', result) });
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);
  usePopState(checkSession);

  useEffect(() => {
    if (view.kind !== 'loading') replacePath(PATH[view.kind]);
  }, [view]);

  const go = useCallback((next: AuthView) => {
    if (next.kind !== 'loading') pushPath(PATH[next.kind]);
    setView(next);
  }, []);

  switch (view.kind) {
    case 'loading':
      return null;
    case 'login':
      return <LoginPage key="login" flash={view.flash} onSession={(session) => go(viewOf(session))} />;
    case 'first-change':
      return (
        <FirstChangePage
          key={`first-change-${view.username}`}
          username={view.username}
          remainingMs={view.remainingMs}
          onBackToLogin={(flash) => go(flash ? { kind: 'login', flash } : { kind: 'login' })}
        />
      );
    case 'welcome':
      return <WelcomePage account={view.account} onLoggedOut={(flash) => go({ kind: 'login', flash })} />;
  }
}
