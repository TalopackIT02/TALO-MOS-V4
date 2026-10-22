import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './layouts/AppShell';
import { FirstChangePage } from './pages/auth/FirstChangePage';
import { LoginPage } from './pages/auth/LoginPage';
import { currentPath, pushLocation, pushPath, replacePath, usePopState } from './routes/navigation';
import type { AppPath, NavState } from './routes/navigation';
import { SCREENS, toShellPath } from './routes/shellScreens';
import type { ShellPath } from './routes/shellScreens';
import { authApi } from './services/auth/authApi';
import type { AccountSummary, SessionInfo } from './services/auth/authApi';
import { messageForFailure } from './services/auth/errorMessages';
import type { UiMessage } from './services/auth/errorMessages';

// Screen selection follows the server session (AUTH-API-v1 §6): GET /api/auth/session at start, on back/forward and on
// a user navigation inside the AppShell — never polled.

export type AuthView =
  | { kind: 'loading' }
  | { kind: 'login'; flash?: UiMessage }
  | { kind: 'first-change'; username: string; remainingMs: number }
  | { kind: 'shell'; account: AccountSummary };

function viewOf(session: SessionInfo): AuthView {
  if (session.status === 'AUTHENTICATED') return { kind: 'shell', account: session.account };
  // D-UI-2: remaining time from expiresAt − serverTime (both PostgreSQL time), never from the client clock.
  const remainingMs = Math.max(0, Date.parse(session.expiresAt) - Date.parse(session.serverTime));
  return { kind: 'first-change', username: session.account.username, remainingMs };
}

// IAM-B-UI-01 FIX-01/02: the shell location (path + query) being opened when the session turned out to be missing or
// expired (reload, back / forward, a link opened in a new tab, an API 401). It is reopened right after the next sign-in
// instead of Home — once; an explicit logout forgets it. Only a shell path is kept (no foreign URL); the screen guard and
// the API check the new session's rights as for any navigation.
function resumableLocation(): string | null {
  const path = window.location.pathname;
  const shell = toShellPath(path);
  if (shell === SCREENS.home.path) return null;
  return shell === path ? `${shell}${window.location.search}` : shell;
}

function pathOf(view: Exclude<AuthView, { kind: 'loading' }>, shellPath: ShellPath): AppPath {
  if (view.kind === 'login') return '/login';
  if (view.kind === 'first-change') return '/first-change';
  return shellPath;
}

export function App() {
  const [view, setView] = useState<AuthView>({ kind: 'loading' });
  const [shellPath, setShellPath] = useState<ShellPath>(() => toShellPath(currentPath()));
  const resume = useRef<string | null>(null);

  const checkSession = useCallback(async () => {
    const here = resumableLocation(); // before the login screen replaces the path
    const result = await authApi.session();
    if (result.ok) {
      setView(viewOf(result.data));
      return;
    }
    resume.current = here ?? resume.current;
    if (result.status === 401) setView({ kind: 'login' });
    else setView({ kind: 'login', flash: messageForFailure('session', result) });
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const onPopState = useCallback(() => {
    setShellPath(toShellPath(currentPath()));
    void checkSession();
  }, [checkSession]);
  usePopState(onPopState);

  useEffect(() => {
    if (view.kind !== 'loading') replacePath(pathOf(view, shellPath));
  }, [view, shellPath]);

  const go = useCallback((next: AuthView) => {
    if (next.kind === 'shell') {
      const target = resume.current ?? SCREENS.home.path;
      resume.current = null;
      setShellPath(toShellPath(target.split('?')[0] ?? SCREENS.home.path));
      pushLocation(target);
    } else if (next.kind !== 'loading') {
      pushPath(pathOf(next, '/'));
    }
    setView(next);
  }, []);

  // Leaving the shell: a lost session keeps the location to reopen after sign-in; an explicit logout does not.
  const leaveShell = useCallback((flash: UiMessage, reason: 'logout' | 'session-lost') => {
    // Several API calls of a screen can answer 401 together: the later ones (already on /login) keep the first location.
    resume.current = reason === 'session-lost' ? resumableLocation() ?? resume.current : null;
    go({ kind: 'login', flash });
  }, [go]);

  // Menu navigation inside the AppShell. The session is re-checked as on back/forward; only an invalid session (401)
  // leaves the shell — a transient failure keeps the current screen, since no shell screen depends on the API yet.
  // `state` marks the new entry (e.g. the account workspace remembers the list it was opened from).
  const navigate = useCallback((path: ShellPath, state?: NavState) => {
    pushPath(path, state);
    setShellPath(path);
    void authApi.session().then((result) => {
      if (result.ok) setView(viewOf(result.data));
      else if (result.status === 401) {
        resume.current = resumableLocation() ?? resume.current;
        setView({ kind: 'login' });
      }
    });
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
    case 'shell':
      return (
        <AppShell
          key={view.account.userAccountId}
          account={view.account}
          path={shellPath}
          onNavigate={navigate}
          onLoggedOut={leaveShell}
        />
      );
  }
}
