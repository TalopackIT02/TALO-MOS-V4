import { DataViewerTab } from './DataViewerTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { RunnerTab } from './RunnerTab';

// MOD-TEST-01 — SYSTEM_TEST screen (route /system-test, tabs = MIC-04 routes /system-test, /system-test/data,
// /system-test/runner). The screen is opened from the Foundation menu; every call is authorised by the server (IAM +
// module lifecycle), so a refused call is shown as returned and never worked around.

// Frontend entry of the package (module.json "frontendEntry"): `screens` maps each screenKey of module.json to its component.
export function SystemTestScreen({ tab, onSessionLost }: { tab: number; onSessionLost: () => void }) {
  if (tab === 1) return <DataViewerTab onSessionLost={onSessionLost} />;
  if (tab === 2) return <RunnerTab onSessionLost={onSessionLost} />;
  return <DiagnosticsTab onSessionLost={onSessionLost} />;
}

export const screens = { 'system.test': SystemTestScreen };
