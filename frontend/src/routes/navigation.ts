import { useEffect } from 'react';
import type { ShellPath } from './shellScreens';

// Minimal history-based navigation (no router dependency). The screen shown is decided by the session state in App;
// the path only mirrors it so reload and the back button behave predictably. Inside the AppShell the path selects the
// screen (routes/shellScreens.ts). The query string belongs to the screen (e.g. the account list keeps its table state
// there) and is never compared or rewritten here.

export type AppPath = '/login' | '/first-change' | ShellPath;

// State written into a history entry by a screen that opens a sub-page: the list URL it came from. A "back" button reads
// it to know that the previous entry is that list (history.back()) instead of guessing.
export interface NavState {
  readonly returnTo: string;
}

export function currentPath(): string {
  return window.location.pathname;
}

export function replacePath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

export function pushPath(path: AppPath, state?: NavState): void {
  if (window.location.pathname !== path) window.history.pushState(state ?? null, '', path);
}

// The current entry's NavState, if this entry was opened by a screen with one.
export function currentNavState(): NavState | null {
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && 'returnTo' in state && typeof state.returnTo === 'string') return { returnTo: state.returnTo };
  return null;
}

// Keeps the query string of the current entry in step with a screen's state: replaces the entry (no new history entry,
// the entry's state is kept) and only when the query actually differs.
export function replaceSearch(search: string): void {
  const next = search === '' || search === '?' ? '' : search.startsWith('?') ? search : `?${search}`;
  if (window.location.search !== next) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}`);
}

// Back/forward: App re-reads the path and re-checks the session.
export function usePopState(onPop: () => void): void {
  useEffect(() => {
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onPop]);
}

// Opens a shell path as a new history entry (optionally with the NavState of that entry).
export type OpenPath = (path: ShellPath, state?: NavState) => void;
