import { useEffect } from 'react';
import type { ShellPath } from './shellScreens';

// Minimal history-based navigation (no router dependency). The screen shown is decided by the session state in App;
// the path only mirrors it so reload and the back button behave predictably. Inside the AppShell the path selects the
// screen (routes/shellScreens.ts).

export type AppPath = '/login' | '/first-change' | ShellPath;

export function currentPath(): string {
  return window.location.pathname;
}

export function replacePath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

export function pushPath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
}

// Back/forward: App re-reads the path and re-checks the session.
export function usePopState(onPop: () => void): void {
  useEffect(() => {
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onPop]);
}
