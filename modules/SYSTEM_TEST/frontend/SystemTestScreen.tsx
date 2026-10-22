import { DiagnosticsTab } from './DiagnosticsTab';
import { RunnerTab } from './RunnerTab';

// SCREEN system.test — two tabs; data viewer was retired in 1.1.0.
// Host provides tab index according to package manifest; all data access stays server-side.
export function SystemTestScreen({tab,onSessionLost}:{tab:number;onSessionLost:()=>void}) {
  return tab===1 ? <RunnerTab onSessionLost={onSessionLost}/> : <DiagnosticsTab onSessionLost={onSessionLost}/>;
}
export const screens = { 'system.test': SystemTestScreen };
