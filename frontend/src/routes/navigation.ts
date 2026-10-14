import { useEffect, useState } from 'react';

// Minimal history-based navigation for the three auth screens (no router dependency). The screen shown is decided by
// the session state in App; the path only mirrors it so reload and the back button behave predictably.

export type AppPath = '/login' | '/first-change' | '/';

export function currentPath(): string {
  return window.location.pathname;
}

export function replacePath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

export function pushPath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
}

// Re-renders on back/forward so App can re-check the session.
export function usePopState(onPop: () => void): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => {
      setTick((n) => n + 1);
      onPop();
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [onPop]);
}
