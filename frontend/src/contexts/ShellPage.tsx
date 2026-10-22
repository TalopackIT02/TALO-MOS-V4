import { createContext, useContext, useEffect } from 'react';

// Label of the page shown inside a screen (IAM-B-UI-01 FIX-03: the username of the account workspace), reported by the
// page to the AppShell breadcrumb. The page clears it when it unmounts.
export const ShellPageContext = createContext<(label: string | null) => void>(() => undefined);

export function useShellPageLabel(label: string | null): void {
  const setLabel = useContext(ShellPageContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}
