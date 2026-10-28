import {ArchitectureTab} from './ArchitectureTab';
import {AccessMatrixTab} from './AccessMatrixTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { RunnerTab } from './RunnerTab';
import { DataInspectorScreen } from './DataInspectorScreen';
import { SystemLogsTab } from './SystemLogsTab';

// Four tabs under one Host screen and one moduleKey. All APIs remain server-side authorized.
export function SystemTestScreen({tab,onSessionLost}:{tab:number;onSessionLost:()=>void}) {
  if (tab === 3) return <ArchitectureTab onSessionLost={onSessionLost}/>;
  if (tab === 4) return <AccessMatrixTab onSessionLost={onSessionLost}/>;
  if (tab === 1) return <RunnerTab onSessionLost={onSessionLost}/>;
  if (tab === 2) return <DataInspectorScreen tab={tab} onSessionLost={onSessionLost}/>;
  if (tab === 5) return <SystemLogsTab onSessionLost={onSessionLost}/>;
  return <DiagnosticsTab onSessionLost={onSessionLost}/>;
}
export const screens = { 'system.controller.center': SystemTestScreen };
