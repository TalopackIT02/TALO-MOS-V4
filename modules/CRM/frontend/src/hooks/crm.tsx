import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CrmClientError } from '../services/adapter';
import type { CrmAdapter } from '../services/adapter';
import { MockCrmAdapter } from '../services/mockAdapter';
import type { Account, Permission, Session } from '../types/domain';

// One adapter + session per browser tab, shared by the 5 CRM screens so that a change made in a customer profile is
// seen by the overview / calendar / tasks / reports screens (same data source, owner order IV).

export type Navigate = (screen: 'workspace' | 'customers' | 'calendar' | 'tasks' | 'reports', params?: Record<string, string>) => void;

interface CrmContextValue {
  adapter: CrmAdapter;
  session: Session | null;
  accounts: Account[];
  revision: number;
  can: (p: Permission) => boolean;
  accountName: (id: string | null | undefined) => string;
  navigate: Navigate;
  notify: (kind: 'ok' | 'error' | 'info', text: string) => void;
  toasts: { id: number; kind: 'ok' | 'error' | 'info'; text: string }[];
  dismissToast: (id: number) => void;
}

const Ctx = createContext<CrmContextValue | null>(null);

let sharedAdapter: CrmAdapter | null = null;
export function crmAdapter(): CrmAdapter {
  // API adapter: BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY — the mock is the only implementation in this release.
  sharedAdapter ??= new MockCrmAdapter();
  return sharedAdapter;
}

const SCREEN_PATHS = { workspace: '/crm', customers: '/crm/customers', calendar: '/crm/calendar', tasks: '/crm/tasks', reports: '/crm/reports' } as const;

// Host navigation is owned by the AppShell (B09 menu). A module screen changes screen by URL; a dev harness may
// inject its own navigator through `window.__TALO_CRM_NAVIGATE__`.
export const defaultNavigate: Navigate = (screen, params) => {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  const hook = (globalThis as { __TALO_CRM_NAVIGATE__?: (path: string) => void }).__TALO_CRM_NAVIGATE__;
  const path = `${SCREEN_PATHS[screen]}${qs}`;
  if (hook) hook(path);
  else globalThis.location?.assign(path);
};

export function CrmProvider({ children, onSessionLost }: { children: ReactNode; onSessionLost?: () => void }) {
  const adapter = crmAdapter();
  const [session, setSession] = useState<Session | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [revision, setRevision] = useState(0);
  const [toasts, setToasts] = useState<CrmContextValue['toasts']>([]);
  const seq = useRef(0);
  useEffect(() => adapter.subscribe(() => setRevision((r) => r + 1)), [adapter]);
  useEffect(() => {
    let live = true;
    Promise.all([adapter.session(), adapter.accounts()]).then(([s, a]) => {
      if (live) { setSession(s); setAccounts(a); }
    }).catch((e: unknown) => {
      if (e instanceof CrmClientError && e.code === 'UNAUTHENTICATED') onSessionLost?.();
    });
    return () => { live = false; };
  }, [adapter, revision, onSessionLost]);
  const notify = useCallback((kind: 'ok' | 'error' | 'info', text: string) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const value = useMemo<CrmContextValue>(() => ({
    adapter, session, accounts, revision,
    can: (p) => session?.permissions.has(p) ?? false,
    accountName: (id) => (id ? accounts.find((a) => a.accountId === id)?.fullName ?? 'Tài khoản không xác định' : '—'),
    navigate: defaultNavigate,
    notify, toasts, dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
  }), [adapter, session, accounts, revision, notify, toasts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm(): CrmContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('CrmProvider missing');
  return v;
}

// Re-runs `load` when its deps change or when the adapter reports a data change.
export function useQuery<T>(load: () => Promise<T>, deps: readonly unknown[]): { data: T | undefined; error: string | null; loading: boolean } {
  const { revision } = useCrm();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load().then((data) => { if (live) setState({ data, error: null, loading: false }); })
      .catch((e: unknown) => { if (live) setState({ data: undefined, error: e instanceof Error ? e.message : 'Lỗi không xác định', loading: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ...deps]);
  return state;
}

// Runs a mutation, shows its outcome as a toast, returns true on success.
export function useAction() {
  const { notify } = useCrm();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okText?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      if (okText) notify('ok', okText);
      return true;
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Thao tác thất bại.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [notify]);
  return { run, busy };
}

export function useUrlParam(name: string): string | null {
  const [value] = useState(() => {
    try { return new URLSearchParams(globalThis.location?.search ?? '').get(name); } catch { return null; }
  });
  return value;
}
