import { useEffect } from 'react';
import type { ShellPath } from './shellScreens';

// Minimal history-based navigation (no router dependency). The screen shown is decided by the session state in App;
// the path only mirrors it so reload and the back button behave predictably. Inside the AppShell the path selects the
// screen (routes/shellScreens.ts). The query string belongs to the screen (e.g. the account list keeps its table state
// there) and is never compared or rewritten here.

export type AppPath = '/login' | '/first-change' | ShellPath;

// State written into a history entry by a screen that opens a sub-page: the list URL it came from. A "back" button reads
// it to know that the previous entry is that list (history.back()) instead of guessing.
// Navigation Builder (multi-link): `navId` = the sidebar link that opened the entry, so that the same path opened from
// two menus keeps its own active item, open menus and breadcrumb (also on back / forward / reload).
export interface NavState {
  readonly returnTo?: string;
  readonly navId?: string;
}

export function currentPath(): string {
  return window.location.pathname;
}

export function replacePath(path: AppPath): void {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

// A new entry when the path changes, or when another sidebar link of the same path is opened.
export function pushPath(path: AppPath, state?: NavState): void {
  const otherLink = state?.navId !== undefined && currentNavState()?.navId !== state.navId;
  if (window.location.pathname !== path || otherLink) window.history.pushState(state ?? null, '', path);
}

// The current entry's NavState, if this entry was opened by a screen with one.
export function currentNavState(): NavState | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return null;
  const returnTo = 'returnTo' in state && typeof state.returnTo === 'string' ? state.returnTo : undefined;
  const navId = 'navId' in state && typeof state.navId === 'string' ? state.navId : undefined;
  if (returnTo === undefined && navId === undefined) return null;
  return { ...(returnTo !== undefined ? { returnTo } : {}), ...(navId !== undefined ? { navId } : {}) };
}

// Navigation Builder: a screen with unsaved changes registers a question; in-app navigation asks it first (the browser
// asks on its own for a reload / tab close through `beforeunload`, registered by that screen).
let leaveGuard: (() => boolean) | null = null;
export function setLeaveGuard(guard: (() => boolean) | null): void {
  leaveGuard = guard;
}
export function mayLeave(): boolean {
  return leaveGuard === null || leaveGuard();
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

// A new entry for a shell location that may carry its query (e.g. the screen reopened after a sign-in).
export function pushLocation(location: string): void {
  if (`${window.location.pathname}${window.location.search}` !== location) window.history.pushState(null, '', location);
}

// Back to a list page from one of its sub-pages: browser Back when the current entry was opened from that list (its
// NavState says so — the list comes back with its query), otherwise the list is opened as a new entry. Never a blind
// history.back(), never a loop.
export function backOrOpen(listPath: ShellPath, open: OpenPath): void {
  if (currentNavState()?.returnTo?.split('?')[0] === listPath) window.history.back();
  else open(listPath);
}
